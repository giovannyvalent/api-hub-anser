// Funções de consulta compartilhadas entre a API REST (src/routes/data/nibo.ts)
// e o servidor MCP (src/mcp/tools.ts) — uma única fonte de verdade pras
// queries, os dois protocolos só formatam a resposta de um jeito diferente.
import { getSupabase } from '../lib/supabase.js'

export interface Pagination {
  limit?: number
  offset?: number
}

function clampLimit(limit?: number) {
  return Math.min(limit ?? 200, 1000)
}

export async function listCompanies(opts: { active?: boolean } = {}) {
  const supabase = getSupabase()
  let query = supabase.from('companies').select('*').order('name', { ascending: true })
  if (opts.active !== undefined) query = query.eq('active', opts.active)
  const { data, error } = await query
  if (error) throw new Error(error.message)

  const { data: creds, error: credsError } = await supabase
    .from('integration_credentials')
    .select('company_id, platform, active')
    .eq('active', true)
  if (credsError) throw new Error(credsError.message)

  const platformsByCompany = new Map<string, string[]>()
  for (const c of creds ?? []) {
    const list = platformsByCompany.get((c as any).company_id) ?? []
    list.push((c as any).platform)
    platformsByCompany.set((c as any).company_id, list)
  }

  return (data ?? []).map((company: any) => ({
    ...company,
    platforms: platformsByCompany.get(company.id) ?? [],
  }))
}

export async function getAccounts(companyId: string, opts: { includeArchived?: boolean } = {}) {
  const supabase = getSupabase()
  let query = supabase.from('nibo_accounts').select('*').eq('company_id', companyId)
  if (!opts.includeArchived) query = query.eq('is_archived', false)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getAccountBalances(
  companyId: string,
  opts: { accountId?: string; latest?: boolean } & Pagination = {},
) {
  const supabase = getSupabase()
  let query = supabase
    .from('nibo_account_balances')
    .select('*')
    .eq('company_id', companyId)
    .order('synced_at', { ascending: false })

  if (opts.accountId) query = query.eq('account_nibo_id', opts.accountId)

  if (opts.latest === false) {
    const limit = clampLimit(opts.limit)
    const offset = opts.offset ?? 0
    const { data, error } = await query.range(offset, offset + limit - 1)
    if (error) throw new Error(error.message)
    return data ?? []
  }

  const { data, error } = await query.limit(1000)
  if (error) throw new Error(error.message)
  const seen = new Set<string>()
  return (data ?? []).filter((row: any) => {
    if (seen.has(row.account_nibo_id)) return false
    seen.add(row.account_nibo_id)
    return true
  })
}

export async function getStatement(
  companyId: string,
  opts: { accountId?: string; from?: string; to?: string } & Pagination = {},
) {
  const supabase = getSupabase()
  const limit = clampLimit(opts.limit)
  const offset = opts.offset ?? 0
  let query = supabase
    .from('nibo_statement')
    .select('*', { count: 'exact' })
    .eq('company_id', companyId)
    .order('entry_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (opts.accountId) query = query.eq('account_nibo_id', opts.accountId)
  if (opts.from) query = query.gte('entry_date', opts.from)
  if (opts.to) query = query.lte('entry_date', opts.to)

  const { data, error, count } = await query
  if (error) throw new Error(error.message)
  return { data: data ?? [], count: count ?? 0, limit, offset }
}

export async function getCategories(companyId: string, opts: { type?: string } = {}) {
  const supabase = getSupabase()
  let query = supabase.from('nibo_categories').select('*').eq('company_id', companyId).eq('is_deleted', false)
  if (opts.type) query = query.eq('type', opts.type)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getCostCenters(companyId: string) {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('nibo_cost_centers')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_deleted', false)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getStakeholders(companyId: string, opts: { kind?: string } = {}) {
  const supabase = getSupabase()
  let query = supabase
    .from('nibo_stakeholders')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_deleted', false)
  if (opts.kind) query = query.eq('kind', opts.kind)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getOrganization(companyId: string) {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('nibo_organization')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ?? null
}

export async function getSchedules(
  companyId: string,
  opts: {
    from?: string
    to?: string
    isPaid?: boolean
    type?: string
    categoryType?: string
  } & Pagination = {},
) {
  const supabase = getSupabase()
  const limit = clampLimit(opts.limit)
  const offset = opts.offset ?? 0
  let query = supabase
    .from('nibo_schedules')
    .select('*', { count: 'exact' })
    .eq('company_id', companyId)
    .order('due_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (opts.from) query = query.gte('due_date', opts.from)
  if (opts.to) query = query.lte('due_date', opts.to)
  if (opts.isPaid !== undefined) query = query.eq('is_paid', opts.isPaid)
  if (opts.type) query = query.eq('type', opts.type)
  if (opts.categoryType) query = query.eq('category_type', opts.categoryType)

  const { data, error, count } = await query
  if (error) throw new Error(error.message)
  return { data: data ?? [], count: count ?? 0, limit, offset }
}

export async function getFirmCustomers() {
  const supabase = getSupabase()
  const { data, error } = await supabase.from('nibo_firm_customers').select('*').order('name')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getFirmTasks(opts: { date?: string } = {}) {
  const supabase = getSupabase()
  let query = supabase.from('nibo_firm_tasks').select('*').order('dead_line', { ascending: true })
  if (opts.date) query = query.eq('dead_line', opts.date)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getSyncLogs(opts: { companyId?: string; resource?: string } & Pagination = {}) {
  const supabase = getSupabase()
  const limit = clampLimit(opts.limit)
  const offset = opts.offset ?? 0
  let query = supabase
    .from('sync_logs')
    .select('*')
    .eq('platform', 'nibo')
    .order('finished_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (opts.companyId) query = query.eq('company_id', opts.companyId)
  if (opts.resource) query = query.eq('resource', opts.resource)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}
