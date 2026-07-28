import { Router } from 'express'
import { getSupabase } from '../../lib/supabase.js'
import { asyncHandler } from '../../middleware/errorHandler.js'

export const niboDataRouter = Router()

function pagination(req: import('express').Request) {
  const limit = Math.min(Number(req.query.limit) || 200, 1000)
  const offset = Number(req.query.offset) || 0
  return { limit, offset }
}

// GET /api/data/nibo/accounts?companyId=&includeArchived=
niboDataRouter.get(
  '/api/data/nibo/accounts',
  asyncHandler(async (req, res) => {
    const { companyId, includeArchived } = req.query
    if (!companyId) return res.status(400).json({ error: '"companyId" é obrigatório' })

    const supabase = getSupabase()
    let query = supabase.from('nibo_accounts').select('*').eq('company_id', String(companyId))
    if (includeArchived !== 'true') query = query.eq('is_archived', false)

    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data })
  }),
)

// GET /api/data/nibo/categories?companyId=&type=in|out
niboDataRouter.get(
  '/api/data/nibo/categories',
  asyncHandler(async (req, res) => {
    const { companyId, type } = req.query
    if (!companyId) return res.status(400).json({ error: '"companyId" é obrigatório' })

    const supabase = getSupabase()
    let query = supabase
      .from('nibo_categories')
      .select('*')
      .eq('company_id', String(companyId))
      .eq('is_deleted', false)
    if (type) query = query.eq('type', String(type))

    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data })
  }),
)

// GET /api/data/nibo/cost-centers?companyId=
niboDataRouter.get(
  '/api/data/nibo/cost-centers',
  asyncHandler(async (req, res) => {
    const { companyId } = req.query
    if (!companyId) return res.status(400).json({ error: '"companyId" é obrigatório' })

    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('nibo_cost_centers')
      .select('*')
      .eq('company_id', String(companyId))
      .eq('is_deleted', false)
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data })
  }),
)

// GET /api/data/nibo/schedules?companyId=&from=&to=&isPaid=&type=Debit|Credit&categoryType=in|out&limit=&offset=
// type=Debit -> contas a pagar; type=Credit -> contas a receber (campo nativo do Nibo, mais confiável que category_type/isEntry).
niboDataRouter.get(
  '/api/data/nibo/schedules',
  asyncHandler(async (req, res) => {
    const { companyId, from, to, isPaid, type, categoryType } = req.query
    if (!companyId) return res.status(400).json({ error: '"companyId" é obrigatório' })

    const { limit, offset } = pagination(req)
    const supabase = getSupabase()
    let query = supabase
      .from('nibo_schedules')
      .select('*', { count: 'exact' })
      .eq('company_id', String(companyId))
      .order('due_date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (from) query = query.gte('due_date', String(from))
    if (to) query = query.lte('due_date', String(to))
    if (isPaid !== undefined) query = query.eq('is_paid', isPaid === 'true')
    if (type) query = query.eq('type', String(type))
    if (categoryType) query = query.eq('category_type', String(categoryType))

    const { data, error, count } = await query
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data, count, limit, offset })
  }),
)

// GET /api/data/nibo/stakeholders?companyId=&kind=customer|supplier|partner|employee
niboDataRouter.get(
  '/api/data/nibo/stakeholders',
  asyncHandler(async (req, res) => {
    const { companyId, kind } = req.query
    if (!companyId) return res.status(400).json({ error: '"companyId" é obrigatório' })

    const supabase = getSupabase()
    let query = supabase
      .from('nibo_stakeholders')
      .select('*')
      .eq('company_id', String(companyId))
      .eq('is_deleted', false)
    if (kind) query = query.eq('kind', String(kind))

    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data })
  }),
)

// GET /api/data/nibo/account-balances?companyId=&accountId=&latest=true
// latest=true (default) retorna só o snapshot mais recente de cada conta; senão, o histórico completo.
niboDataRouter.get(
  '/api/data/nibo/account-balances',
  asyncHandler(async (req, res) => {
    const { companyId, accountId, latest } = req.query
    if (!companyId) return res.status(400).json({ error: '"companyId" é obrigatório' })

    const { limit, offset } = pagination(req)
    const supabase = getSupabase()
    let query = supabase
      .from('nibo_account_balances')
      .select('*')
      .eq('company_id', String(companyId))
      .order('synced_at', { ascending: false })

    if (accountId) query = query.eq('account_nibo_id', String(accountId))

    if (latest === 'false') {
      const { data, error } = await query.range(offset, offset + limit - 1)
      if (error) return res.status(500).json({ error: error.message })
      return res.json({ data, limit, offset })
    }

    // "latest": pega tudo ordenado por synced_at desc e fica só com a 1a ocorrência por conta.
    const { data, error } = await query.limit(1000)
    if (error) return res.status(500).json({ error: error.message })
    const seen = new Set<string>()
    const latestByAccount = (data ?? []).filter((row: any) => {
      if (seen.has(row.account_nibo_id)) return false
      seen.add(row.account_nibo_id)
      return true
    })
    res.json({ data: latestByAccount })
  }),
)

// GET /api/data/nibo/statement?companyId=&accountId=&from=&to=&limit=&offset=
niboDataRouter.get(
  '/api/data/nibo/statement',
  asyncHandler(async (req, res) => {
    const { companyId, accountId, from, to } = req.query
    if (!companyId) return res.status(400).json({ error: '"companyId" é obrigatório' })

    const { limit, offset } = pagination(req)
    const supabase = getSupabase()
    let query = supabase
      .from('nibo_statement')
      .select('*', { count: 'exact' })
      .eq('company_id', String(companyId))
      .order('entry_date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (accountId) query = query.eq('account_nibo_id', String(accountId))
    if (from) query = query.gte('entry_date', String(from))
    if (to) query = query.lte('entry_date', String(to))

    const { data, error, count } = await query
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data, count, limit, offset })
  }),
)

// GET /api/data/nibo/organization?companyId=
niboDataRouter.get(
  '/api/data/nibo/organization',
  asyncHandler(async (req, res) => {
    const { companyId } = req.query
    if (!companyId) return res.status(400).json({ error: '"companyId" é obrigatório' })

    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('nibo_organization')
      .select('*')
      .eq('company_id', String(companyId))
      .maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data })
  }),
)

// GET /api/data/nibo/firm-customers
niboDataRouter.get(
  '/api/data/nibo/firm-customers',
  asyncHandler(async (_req, res) => {
    const supabase = getSupabase()
    const { data, error } = await supabase.from('nibo_firm_customers').select('*').order('name')
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data })
  }),
)

// GET /api/data/nibo/firm-tasks?date=YYYY-MM-DD
niboDataRouter.get(
  '/api/data/nibo/firm-tasks',
  asyncHandler(async (req, res) => {
    const { date } = req.query
    const supabase = getSupabase()
    let query = supabase.from('nibo_firm_tasks').select('*').order('dead_line', { ascending: true })
    if (date) query = query.eq('dead_line', String(date))
    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data })
  }),
)

// GET /api/data/nibo/sync-logs?companyId=&resource=
niboDataRouter.get(
  '/api/data/nibo/sync-logs',
  asyncHandler(async (req, res) => {
    const { companyId, resource } = req.query
    const { limit, offset } = pagination(req)
    const supabase = getSupabase()
    let query = supabase
      .from('sync_logs')
      .select('*')
      .eq('platform', 'nibo')
      .order('finished_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (companyId) query = query.eq('company_id', String(companyId))
    if (resource) query = query.eq('resource', String(resource))
    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data })
  }),
)
