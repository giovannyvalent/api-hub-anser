import { getSupabase } from '../../lib/supabase.js'
import { logger } from '../../lib/logger.js'
import type { SyncReport, SyncResourceResult } from '../types.js'
import { NiboAccountantClient, NiboEmpresaClient } from './client.js'

async function logSync(params: {
  companyId: string | null
  resource: string
  status: 'success' | 'error'
  recordsSynced: number
  errorMessage?: string
  startedAt: string
}) {
  const supabase = getSupabase()
  await supabase.from('sync_logs').insert({
    company_id: params.companyId,
    platform: 'nibo',
    resource: params.resource,
    status: params.status,
    records_synced: params.recordsSynced,
    error_message: params.errorMessage ?? null,
    started_at: params.startedAt,
    finished_at: new Date().toISOString(),
  })
}

async function runResource(
  companyId: string | null,
  resource: string,
  fn: () => Promise<number>,
): Promise<SyncResourceResult> {
  const startedAt = new Date().toISOString()
  try {
    const recordsSynced = await fn()
    await logSync({ companyId, resource, status: 'success', recordsSynced, startedAt })
    return { resource, recordsSynced }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    logger.error(`nibo sync "${resource}" falhou para company=${companyId}:`, message)
    await logSync({ companyId, resource, status: 'error', recordsSynced: 0, errorMessage: message, startedAt })
    return { resource, recordsSynced: 0 }
  }
}

// ============================================================================
// Sync por empresa-cliente (API "empresas")
// ============================================================================

export async function syncCompanyNibo(companyId: string, apiToken: string): Promise<SyncReport> {
  const startedAt = new Date().toISOString()
  const supabase = getSupabase()
  const client = new NiboEmpresaClient(apiToken)

  const results: SyncResourceResult[] = []

  results.push(
    await runResource(companyId, 'accounts', async () => {
      const accounts = await client.listAccounts()
      if (accounts.length === 0) return 0
      const rows = accounts.map((a) => ({
        company_id: companyId,
        nibo_id: a.id,
        name: a.name,
        bank_name: a.bankName ?? '',
        type: a.type ?? '',
        is_archived: a.isArchived ?? false,
        raw: a,
        synced_at: new Date().toISOString(),
      }))
      const { error } = await supabase.from('nibo_accounts').upsert(rows, { onConflict: 'company_id,nibo_id' })
      if (error) throw new Error(error.message)
      return rows.length
    }),
  )

  results.push(
    await runResource(companyId, 'categories', async () => {
      const categories = await client.listCategories()
      if (categories.length === 0) return 0
      const rows = categories.map((c) => ({
        company_id: companyId,
        nibo_id: c.id,
        name: c.name,
        type: c.type ?? null,
        parent_id: c.parentId ?? null,
        is_deleted: c.isDeleted ?? false,
        raw: c,
        synced_at: new Date().toISOString(),
      }))
      const { error } = await supabase.from('nibo_categories').upsert(rows, { onConflict: 'company_id,nibo_id' })
      if (error) throw new Error(error.message)
      return rows.length
    }),
  )

  results.push(
    await runResource(companyId, 'cost_centers', async () => {
      const costCenters = await client.listCostCenters()
      if (costCenters.length === 0) return 0
      const rows = costCenters.map((c) => ({
        company_id: companyId,
        nibo_id: c.id,
        name: c.description || c.name || '',
        is_deleted: c.isDeleted ?? false,
        raw: c,
        synced_at: new Date().toISOString(),
      }))
      const { error } = await supabase.from('nibo_cost_centers').upsert(rows, { onConflict: 'company_id,nibo_id' })
      if (error) throw new Error(error.message)
      return rows.length
    }),
  )

  results.push(
    await runResource(companyId, 'schedules', async () => {
      // Janela padrão: últimos 12 meses até 12 meses à frente. Cobre tanto o
      // histórico (extrato) quanto os agendamentos futuros (contas a pagar/receber).
      const now = new Date()
      const from = new Date(now)
      from.setMonth(from.getMonth() - 12)
      const to = new Date(now)
      to.setMonth(to.getMonth() + 12)
      const fmt = (d: Date) => d.toISOString().split('T')[0]

      const schedules = await client.listSchedules({ from: fmt(from), to: fmt(to) })
      if (schedules.length === 0) return 0
      const rows = schedules.map((s) => ({
        company_id: companyId,
        nibo_id: s.id,
        schedule_date: s.scheduleDate ?? null,
        due_date: s.dueDate ?? null,
        description: s.description ?? '',
        value: s.value ?? 0,
        open_value: s.openValue ?? 0,
        paid_value: s.paidValue ?? 0,
        is_paid: s.isPaid ?? false,
        is_entry: s.isEntry ?? null,
        category_id: s.category?.id ?? null,
        category_name: s.category?.name ?? '',
        category_type: s.category?.type ?? null,
        cost_center_id: s.costCenter?.id ?? null,
        cost_center_name: s.costCenter?.description || s.costCenter?.name || '',
        stakeholder_id: s.stakeholder?.id ?? null,
        stakeholder_name: s.stakeholder?.name ?? '',
        raw: s,
        synced_at: new Date().toISOString(),
      }))
      const { error } = await supabase.from('nibo_schedules').upsert(rows, { onConflict: 'company_id,nibo_id' })
      if (error) throw new Error(error.message)
      return rows.length
    }),
  )

  return { platform: 'nibo', companyId, results, startedAt, finishedAt: new Date().toISOString() }
}

// ============================================================================
// Sync em nível de escritório (API "accountant")
// ============================================================================

export async function syncFirmNibo(referenceDate = new Date()): Promise<SyncReport> {
  const startedAt = new Date().toISOString()
  const supabase = getSupabase()
  const client = new NiboAccountantClient()

  const results: SyncResourceResult[] = []

  results.push(
    await runResource(null, 'firm_customers', async () => {
      const customers = await client.listCustomers()
      if (customers.length === 0) return 0
      const rows = customers.map((c) => ({
        nibo_id: c.id,
        name: c.name,
        document_number: c.documentNumber ?? '',
        code: c.code ?? '',
        raw: c,
        synced_at: new Date().toISOString(),
      }))
      const { error } = await supabase.from('nibo_firm_customers').upsert(rows, { onConflict: 'nibo_id' })
      if (error) throw new Error(error.message)
      return rows.length
    }),
  )

  results.push(
    await runResource(null, 'firm_tasks', async () => {
      const deadLine = referenceDate.toISOString().split('T')[0]
      const tasks = await client.listTasksByDate(deadLine)
      if (tasks.length === 0) return 0
      const rows = tasks.map((t) => ({
        nibo_id: t.id,
        name: t.name,
        description: t.description ?? '',
        dead_line: t.deadLine ?? null,
        status: t.status ?? null,
        completed_at: t.completedAt ?? null,
        customer_id: t.customer?.id ?? null,
        customer_name: t.customer?.name ?? '',
        in_charge_user_id: t.inChargeUser?.id ?? null,
        in_charge_user_name: t.inChargeUser?.name ?? '',
        raw: t,
        synced_at: new Date().toISOString(),
      }))
      const { error } = await supabase.from('nibo_firm_tasks').upsert(rows, { onConflict: 'nibo_id' })
      if (error) throw new Error(error.message)
      return rows.length
    }),
  )

  return { platform: 'nibo', companyId: null, results, startedAt, finishedAt: new Date().toISOString() }
}

// Sincroniza todas as empresas com credencial Nibo ativa. Usado pelo cron e
// por um eventual "sync tudo" manual.
export async function syncAllCompaniesNibo(): Promise<SyncReport[]> {
  const supabase = getSupabase()
  const { data: credentials, error } = await supabase
    .from('integration_credentials')
    .select('company_id, credentials')
    .eq('platform', 'nibo')
    .eq('active', true)

  if (error) throw new Error(error.message)

  const reports: SyncReport[] = []
  for (const cred of credentials ?? []) {
    const apiToken = (cred as any).credentials?.apiToken
    if (!apiToken) continue
    reports.push(await syncCompanyNibo((cred as any).company_id, apiToken))
  }
  return reports
}
