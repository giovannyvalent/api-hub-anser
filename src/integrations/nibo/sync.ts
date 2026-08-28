import { getSupabase } from '../../lib/supabase.js'
import { logger } from '../../lib/logger.js'
import type { SyncReport, SyncResourceResult } from '../types.js'
import { NiboAccountantClient, NiboEmpresaClient } from './client.js'
import type { NiboStakeholderKind } from './types.js'

type SyncMode = 'full' | 'incremental'

// ============================================================================
// Reconciliação de exclusões — o upsert nunca some com nada; se um registro
// foi deletado no Nibo, ele só some da resposta da API, sem aviso. Isso
// compara o que a Nibo retornou AGORA com o que já está no nosso banco (no
// mesmo escopo: mesma empresa, mesmo recurso, e — quando aplicável — mesma
// janela de data que foi realmente buscada) e apaga o que sobrou.
// Só faz sentido no full sync: o incremental busca uma fatia ("o que mudou
// desde X"), nunca a lista completa, então não tem como detectar exclusão.
// ============================================================================
async function reconcileDeletes(params: {
  table: string
  match: Record<string, string | boolean>
  currentNiboIds: string[]
  niboIdColumn?: string
  dateRange?: { column: string; gte: string; lte: string }
}): Promise<number> {
  const supabase = getSupabase()
  const col = params.niboIdColumn ?? 'nibo_id'

  let query = supabase.from(params.table).select(col)
  for (const [k, v] of Object.entries(params.match)) query = query.eq(k, v)
  if (params.dateRange) {
    query = query.gte(params.dateRange.column, params.dateRange.gte).lte(params.dateRange.column, params.dateRange.lte)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const currentSet = new Set(params.currentNiboIds)
  const toDelete = (data ?? []).map((r: any) => r[col]).filter((id: string) => !currentSet.has(id))
  if (toDelete.length === 0) return 0

  let delQuery = supabase.from(params.table).delete().in(col, toDelete)
  for (const [k, v] of Object.entries(params.match)) delQuery = delQuery.eq(k, v)
  if (params.dateRange) {
    delQuery = delQuery.gte(params.dateRange.column, params.dateRange.gte).lte(params.dateRange.column, params.dateRange.lte)
  }
  const { error: delError } = await delQuery
  if (delError) throw new Error(delError.message)
  return toDelete.length
}

async function logSync(params: {
  companyId: string | null
  resource: string
  mode: SyncMode
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
    mode: params.mode,
    status: params.status,
    records_synced: params.recordsSynced,
    error_message: params.errorMessage ?? null,
    started_at: params.startedAt,
    finished_at: new Date().toISOString(),
  })
}

async function getCursor(companyId: string, resource: string): Promise<string | null> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('sync_state')
    .select('last_synced_at')
    .eq('company_id', companyId)
    .eq('platform', 'nibo')
    .eq('resource', resource)
    .maybeSingle()
  return (data as any)?.last_synced_at ?? null
}

async function setCursor(companyId: string, resource: string, timestamp: string) {
  const supabase = getSupabase()
  await supabase
    .from('sync_state')
    .upsert(
      { company_id: companyId, platform: 'nibo', resource, last_synced_at: timestamp },
      { onConflict: 'company_id,platform,resource' },
    )
}

async function runResource(
  companyId: string | null,
  resource: string,
  mode: SyncMode,
  fn: () => Promise<number>,
): Promise<SyncResourceResult> {
  const startedAt = new Date().toISOString()
  try {
    const recordsSynced = await fn()
    await logSync({ companyId, resource, mode, status: 'success', recordsSynced, startedAt })
    return { resource, recordsSynced }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    logger.error(`nibo sync "${resource}" (${mode}) falhou para company=${companyId}:`, message)
    await logSync({ companyId, resource, mode, status: 'error', recordsSynced: 0, errorMessage: message, startedAt })
    return { resource, recordsSynced: 0 }
  }
}

const STAKEHOLDER_KINDS: NiboStakeholderKind[] = ['customer', 'supplier', 'partner', 'employee']

// ============================================================================
// Recursos de baixo churn — sincronizados só no full sync (cadastros).
// ============================================================================

async function syncAccounts(companyId: string, client: NiboEmpresaClient) {
  const supabase = getSupabase()
  const accounts = await client.listAccounts()
  const rows = accounts.map((a) => ({
    company_id: companyId,
    nibo_id: a.id,
    name: a.name,
    type: a.type ?? '',
    bank_id: a.bankId ?? null,
    bank_name: a.bankName ?? '',
    bank_agency: a.bankAgency ?? '',
    bank_account: a.bankAccount ?? '',
    bank_account_verification_number: a.bankAccountVerificationNumber ?? null,
    open_balance: a.openBalance ?? 0,
    date_of_open_balance: a.dateOfOpenBalance ?? null,
    is_virtual: a.isVirtual ?? false,
    is_reconcilable: a.isReconcilable ?? true,
    is_archived: a.isArchived ?? false,
    scraping_enabled: a.scrapingEnabled ?? false,
    has_payment_operation: a.hasPaymentOperation ?? false,
    boleto_enabled: a.boletoEnabled ?? false,
    is_automated: a.isAutomated ?? false,
    can_be_automated: a.canBeAutomated ?? false,
    automation_last_sync_date: a.automationLastSyncDate ?? null,
    automation_requires_migration: a.automationRequiresMigration ?? false,
    automated_account_open_balance_date: a.automatedAccountOpenBalanceDate ?? null,
    has_mfa: a.hasMFA ?? false,
    is_mfa_required: a.isMFARequired ?? false,
    is_open_finance: a.isOpenFinance ?? false,
    link_id: a.linkId ?? null,
    cnab_enabled: a.cnabEnabled ?? false,
    update_date: a.updateDate ?? null,
    update_user: a.updateUser ?? '',
    raw: a,
    synced_at: new Date().toISOString(),
  }))
  if (rows.length > 0) {
    const { error } = await supabase.from('nibo_accounts').upsert(rows, { onConflict: 'company_id,nibo_id' })
    if (error) throw new Error(error.message)
  }
  await reconcileDeletes({ table: 'nibo_accounts', match: { company_id: companyId }, currentNiboIds: accounts.map((a) => a.id) })
  return rows.length
}

async function syncCategories(companyId: string, client: NiboEmpresaClient) {
  const supabase = getSupabase()
  const categories = await client.listCategories()
  const rows = categories.map((c) => ({
    company_id: companyId,
    nibo_id: c.id,
    name: c.name,
    type: c.type ?? null,
    order_index: c.order ?? null,
    group_id: c.group?.id ?? null,
    group_name: c.group?.name ?? '',
    group_type: c.groupType ?? null,
    subgroup_id: c.subgroupId ?? null,
    subgroup_name: c.subgroupName ?? '',
    is_editable: c.isEditable ?? true,
    is_deleted: c.isDeleted ?? false,
    raw: c,
    synced_at: new Date().toISOString(),
  }))
  if (rows.length > 0) {
    const { error } = await supabase.from('nibo_categories').upsert(rows, { onConflict: 'company_id,nibo_id' })
    if (error) throw new Error(error.message)
  }
  await reconcileDeletes({ table: 'nibo_categories', match: { company_id: companyId }, currentNiboIds: categories.map((c) => c.id) })
  return rows.length
}

async function syncCostCenters(companyId: string, client: NiboEmpresaClient) {
  const supabase = getSupabase()
  const costCenters = await client.listCostCenters()
  const rows = costCenters.map((c) => ({
    company_id: companyId,
    nibo_id: c.costCenterId,
    name: c.description ?? '',
    is_deleted: c.isDeleted ?? false,
    update_date: c.updateDate ?? null,
    update_user: c.updateUser ?? '',
    raw: c,
    synced_at: new Date().toISOString(),
  }))
  if (rows.length > 0) {
    const { error } = await supabase.from('nibo_cost_centers').upsert(rows, { onConflict: 'company_id,nibo_id' })
    if (error) throw new Error(error.message)
  }
  await reconcileDeletes({ table: 'nibo_cost_centers', match: { company_id: companyId }, currentNiboIds: costCenters.map((c) => c.costCenterId) })
  return rows.length
}

async function syncStakeholders(companyId: string, client: NiboEmpresaClient, kind: NiboStakeholderKind) {
  const supabase = getSupabase()
  const items = await client.listStakeholders(kind)
  const rows = items.map((s) => ({
    company_id: companyId,
    kind,
    nibo_id: s.id,
    person_type: s.personType ?? null,
    name: s.name,
    initials_name: s.initialsName ?? '',
    document_number: s.document?.number ?? '',
    document_type: s.document?.type ?? '',
    email: s.email ?? s.communication?.email ?? '',
    company_name: s.companyInformation?.companyName ?? '',
    is_company: s.isCompany ?? false,
    is_archived: s.isArchived ?? false,
    is_deleted: s.isDeleted ?? false,
    address: s.address ?? {},
    bank_account_info: s.bankAccountInformation ?? {},
    update_date: s.updateDate ?? null,
    update_user: s.updateUser ?? '',
    raw: s,
    synced_at: new Date().toISOString(),
  }))
  if (rows.length > 0) {
    const { error } = await supabase.from('nibo_stakeholders').upsert(rows, { onConflict: 'company_id,kind,nibo_id' })
    if (error) throw new Error(error.message)
  }
  await reconcileDeletes({
    table: 'nibo_stakeholders',
    match: { company_id: companyId, kind },
    currentNiboIds: items.map((s) => s.id),
  })
  return rows.length
}

async function syncOrganization(companyId: string, client: NiboEmpresaClient) {
  const supabase = getSupabase()
  const org = await client.getOrganization()
  if (!org) return 0
  const { error } = await supabase.from('nibo_organization').upsert(
    {
      company_id: companyId,
      organization_id: org.organizationId,
      name: org.name,
      cnpj: org.cnpj ?? '',
      invoice_enabled: org.invoiceEnabled ?? null,
      plan: org.plan ?? '',
      subscription_plan: org.subscriptionPlan ?? '',
      type: org.type ?? null,
      accountant_id: org.accountantId ?? '',
      accountant_name: org.accountantName ?? '',
      address: org.address ?? {},
      features: org.features ?? [],
      users: org.users ?? [],
      raw: org,
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'company_id' },
  )
  if (error) throw new Error(error.message)
  return 1
}

async function syncUsers(companyId: string, client: NiboEmpresaClient) {
  const supabase = getSupabase()
  const users = await client.listUsers()
  const rows = users.map((u) => ({
    company_id: companyId,
    nibo_id: u.id,
    email: u.email,
    first_name: u.firstName ?? '',
    last_name: u.lastName ?? '',
    phone: u.phone ?? '',
    area_code: u.areaCode ?? '',
    is_organization_owner: u.isOrganizationOwner ?? false,
    is_organization_user: u.isOrganizationUser ?? false,
    is_accountant_user: u.isAccountantUser ?? false,
    create_date: u.createDate ?? null,
    accept_date: u.acceptDate ?? null,
    roles_text: u.rolesText ?? '',
    raw: u,
    synced_at: new Date().toISOString(),
  }))
  if (rows.length > 0) {
    const { error } = await supabase.from('nibo_users').upsert(rows, { onConflict: 'company_id,nibo_id' })
    if (error) throw new Error(error.message)
  }
  await reconcileDeletes({ table: 'nibo_users', match: { company_id: companyId }, currentNiboIds: users.map((u) => u.id) })
  return rows.length
}

// ============================================================================
// Recursos de alto churn — financeiro. Sincronizados no full E no incremental.
// ============================================================================

async function syncAccountBalances(companyId: string, client: NiboEmpresaClient) {
  const supabase = getSupabase()
  const balances = await client.listAccountBalances()
  if (balances.length === 0) return 0
  const rows = balances.map((b) => ({
    company_id: companyId,
    account_nibo_id: b.accountId,
    account_name: b.accountName ?? '',
    balance: b.balance ?? 0,
    agency: b.agency ?? '',
    account_number: b.accountNumber ?? '',
    account_verification_number: b.accountVerificationNumber ?? null,
    is_virtual: b.isVirtual ?? false,
    is_reconcilable: b.isReconcilable ?? true,
    is_pj_waiting_approve: b.isPJBankVirtualAccountWaitingApprove ?? false,
    bank_id: b.bank?.id ?? null,
    bank_code: b.bank?.code ?? '',
    bank_name: b.bank?.name ?? '',
    bank_balance: b.bankBalance ?? 0,
    bank_balance_changed_at: b.bankBalanceChangedDate ?? null,
    pending_reconciliation_count: b.pendingReconciliationCount ?? 0,
    total_open_reconciliations: b.totalOpenReconciliations ?? 0,
    is_account_automated: b.isAccountAutomated ?? false,
    raw: b,
    synced_at: new Date().toISOString(),
  }))
  // Snapshot histórico — insert, não upsert (queremos o histórico de saldo ao longo do tempo).
  const { error } = await supabase.from('nibo_account_balances').insert(rows)
  if (error) throw new Error(error.message)
  return rows.length
}

function statementEntryKey(entryId: string | undefined, index: number): string {
  return entryId || `start-${index}`
}

async function syncStatementForAccounts(
  companyId: string,
  client: NiboEmpresaClient,
  accounts: { id: string; from: string; to: string }[],
) {
  const supabase = getSupabase()
  let total = 0
  for (const { id: accountId, from, to } of accounts) {
    const entries = await client.getAccountStatement(accountId, from, to)
    const rows = entries.map((e) => ({
      company_id: companyId,
      account_nibo_id: accountId,
      entry_key: statementEntryKey(e.entryId, e.index),
      entry_index: e.index,
      value: e.value ?? 0,
      entry_date: e.date ?? null,
      current_balance: e.currentBalance ?? 0,
      is_transfer: e.isTransfer ?? false,
      transfer_id: e.transferId ?? null,
      type: e.type ?? '',
      is_reconciliated: e.isReconciliated ?? false,
      description: e.description ?? '',
      category_id: e.categoryId ?? null,
      category_name: e.categoryName ?? '',
      stakeholder_id: e.stakeholderId ?? null,
      stakeholder_name: e.stakeholderName ?? '',
      stakeholder_is_deleted: e.stakeholderIsDeleted ?? false,
      create_date: e.createDate ?? null,
      raw: e,
      synced_at: new Date().toISOString(),
    }))
    if (rows.length > 0) {
      const { error } = await supabase
        .from('nibo_statement')
        .upsert(rows, { onConflict: 'company_id,account_nibo_id,entry_key' })
      if (error) throw new Error(error.message)
    }
    await reconcileDeletes({
      table: 'nibo_statement',
      match: { company_id: companyId, account_nibo_id: accountId },
      currentNiboIds: entries.map((e) => statementEntryKey(e.entryId, e.index)),
      niboIdColumn: 'entry_key',
      dateRange: { column: 'entry_date', gte: from, lte: to },
    })
    total += rows.length
  }
  return total
}

function scheduleRows(companyId: string, schedules: Awaited<ReturnType<NiboEmpresaClient['listSchedules']>>) {
  return schedules.map((s) => ({
    company_id: companyId,
    nibo_id: s.scheduleId,
    type: s.type,
    schedule_date: s.scheduleDate ?? null,
    due_date: s.dueDate ?? null,
    accrual_date: s.accrualDate ?? null,
    description: s.description ?? '',
    reference: s.reference ?? '',
    value: s.value ?? 0,
    open_value: s.openValue ?? 0,
    paid_value: s.paidValue ?? 0,
    is_paid: s.isPaid ?? false,
    is_entry: s.isEntry ?? null,
    is_bill: s.isBill ?? false,
    is_debit_note: s.isDebitNote ?? false,
    is_flagged: s.isFlagged ?? false,
    is_dued: s.isDued ?? false,
    cost_center_value_type: s.costCenterValueType ?? null,
    category_id: s.category?.id ?? null,
    category_name: s.category?.name ?? '',
    category_type: s.category?.type ?? null,
    categories_split: s.categories ?? [],
    cost_center_id: s.costCenter?.id ?? null,
    cost_center_name: s.costCenter?.description ?? '',
    cost_centers_split: s.costCenters ?? [],
    stakeholder_id: s.stakeholder?.id ?? null,
    stakeholder_name: s.stakeholder?.name ?? '',
    stakeholder_type: s.stakeholder?.type ?? '',
    stakeholder_document: s.stakeholder?.cpfCnpj ?? '',
    has_installment: s.hasInstallment ?? false,
    has_recurrence: s.hasRecurrence ?? false,
    recurrence: s.recurrence ?? null,
    has_open_entry_promise: s.hasOpenEntryPromise ?? false,
    has_entry_promise: s.hasEntryPromise ?? false,
    last_entry_promise: s.lastEntryPromise ?? null,
    auto_generate_entry_promise: s.autoGenerateEntryPromise ?? false,
    has_invoice: s.hasInvoice ?? false,
    has_pending_invoice: s.hasPendingInvoice ?? false,
    has_schedule_invoice: s.hasScheduleInvoice ?? false,
    custom_attributes: s.customAttributes ?? {},
    service_provision_location_type: s.serviceProvisionLocationType ?? null,
    auto_generate_nfse_type: s.autoGenerateNFSeType ?? null,
    auto_generate_collection_type: s.autoGenerateCollectionType ?? null,
    is_payment_scheduled: s.isPaymentScheduled ?? false,
    create_date: s.createDate ?? null,
    create_user: s.createUser ?? '',
    update_date: s.updateDate ?? null,
    update_user: s.updateUser ?? '',
    raw: s,
    synced_at: new Date().toISOString(),
  }))
}

async function upsertSchedules(rows: ReturnType<typeof scheduleRows>) {
  if (rows.length === 0) return 0
  const supabase = getSupabase()
  const { error } = await supabase.from('nibo_schedules').upsert(rows, { onConflict: 'company_id,nibo_id' })
  if (error) throw new Error(error.message)
  return rows.length
}

// ============================================================================
// Sync FULL por empresa-cliente — cadastros + histórico financeiro amplo.
// Pesado: rodar 1x/dia (ou sob demanda), não a cada poucos minutos.
// ============================================================================

export async function syncCompanyNiboFull(companyId: string, apiToken: string): Promise<SyncReport> {
  const startedAt = new Date().toISOString()
  const client = new NiboEmpresaClient(apiToken)
  const results: SyncResourceResult[] = []

  results.push(await runResource(companyId, 'accounts', 'full', () => syncAccounts(companyId, client)))
  results.push(await runResource(companyId, 'categories', 'full', () => syncCategories(companyId, client)))
  results.push(await runResource(companyId, 'cost_centers', 'full', () => syncCostCenters(companyId, client)))
  results.push(await runResource(companyId, 'organization', 'full', () => syncOrganization(companyId, client)))
  results.push(await runResource(companyId, 'users', 'full', () => syncUsers(companyId, client)))

  for (const kind of STAKEHOLDER_KINDS) {
    results.push(
      await runResource(companyId, `stakeholders_${kind}`, 'full', () => syncStakeholders(companyId, client, kind)),
    )
  }

  results.push(await runResource(companyId, 'account_balances', 'full', () => syncAccountBalances(companyId, client)))

  // Janela ampla: 24 meses atrás até 24 meses à frente.
  const now = new Date()
  const from = new Date(now)
  from.setMonth(from.getMonth() - 24)
  const to = new Date(now)
  to.setMonth(to.getMonth() + 24)
  const fmt = (d: Date) => d.toISOString().split('T')[0]

  const cursorTimestamp = new Date().toISOString()

  for (const kind of ['debit', 'credit'] as const) {
    results.push(
      await runResource(companyId, `schedules_${kind}`, 'full', async () => {
        const schedules = await client.listSchedules(kind, { from: fmt(from), to: fmt(to) }, 300)
        const count = await upsertSchedules(scheduleRows(companyId, schedules))
        await reconcileDeletes({
          table: 'nibo_schedules',
          match: { company_id: companyId, type: kind === 'debit' ? 'Debit' : 'Credit' },
          currentNiboIds: schedules.map((s) => s.scheduleId),
          dateRange: { column: 'due_date', gte: fmt(from), lte: fmt(to) },
        })
        await setCursor(companyId, `schedules_${kind}`, cursorTimestamp)
        return count
      }),
    )
  }

  results.push(
    await runResource(companyId, 'statement', 'full', async () => {
      // Inclui contas arquivadas também — o extrato histórico delas continua
      // sendo dado real e útil (auditoria, conferência de saldo de abertura etc.).
      // Qualquer conta (ativa ou arquivada) cuja data de abertura real
      // (dateOfOpenBalance) seja mais antiga que a janela padrão de 24 meses
      // usa a data de abertura como "from" — senão o começo do histórico
      // dela fica de fora. Ex: "04 - Cartão de Crédito" abriu em 2024-02-28,
      // ~6 meses antes da janela padrão, e ficava sem esses 6 meses iniciais.
      // Arquivada sem dateOfOpenBalance cai num fallback bem largo (10 anos).
      const niboAccounts = await client.listAccounts()
      const wideFrom = new Date(now)
      wideFrom.setFullYear(wideFrom.getFullYear() - 10)
      const standardFrom = fmt(from)
      const accountRanges = niboAccounts.map((a) => {
        const openDate = a.dateOfOpenBalance ? a.dateOfOpenBalance.split('T')[0] : null
        let effectiveFrom = standardFrom
        if (openDate && openDate < standardFrom) effectiveFrom = openDate
        else if (a.isArchived && !openDate) effectiveFrom = fmt(wideFrom)
        return { id: a.id, from: effectiveFrom, to: fmt(to) }
      })
      return syncStatementForAccounts(companyId, client, accountRanges)
    }),
  )

  return { platform: 'nibo', companyId, results, startedAt, finishedAt: new Date().toISOString() }
}

// ============================================================================
// Sync INCREMENTAL por empresa-cliente — só o financeiro, janela curta.
// Feito para rodar com frequência alta (ex: a cada 5 minutos via cron).
// ============================================================================

export async function syncCompanyNiboIncremental(companyId: string, apiToken: string): Promise<SyncReport> {
  const startedAt = new Date().toISOString()
  const client = new NiboEmpresaClient(apiToken)
  const results: SyncResourceResult[] = []

  const cursorTimestamp = new Date().toISOString()
  const defaultLookback = new Date()
  defaultLookback.setDate(defaultLookback.getDate() - 3)

  for (const kind of ['debit', 'credit'] as const) {
    results.push(
      await runResource(companyId, `schedules_${kind}`, 'incremental', async () => {
        const since = (await getCursor(companyId, `schedules_${kind}`)) ?? defaultLookback.toISOString()
        const schedules = await client.listSchedules(kind, { updatedSince: since }, 20)
        const count = await upsertSchedules(scheduleRows(companyId, schedules))
        await setCursor(companyId, `schedules_${kind}`, cursorTimestamp)
        return count
      }),
    )
  }

  results.push(await runResource(companyId, 'account_balances', 'incremental', () => syncAccountBalances(companyId, client)))

  results.push(
    await runResource(companyId, 'statement', 'incremental', async () => {
      // Conta arquivada não tem movimento novo — o histórico dela já foi
      // pego inteiro no full sync, não precisa checar de novo a cada ciclo.
      const accounts = await client.listAccounts().then((list) => list.filter((a) => !a.isArchived))
      const to = new Date()
      const from = new Date(to)
      from.setDate(from.getDate() - 3)
      const fmt = (d: Date) => d.toISOString().split('T')[0]
      const accountRanges = accounts.map((a) => ({ id: a.id, from: fmt(from), to: fmt(to) }))
      return syncStatementForAccounts(companyId, client, accountRanges)
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
    await runResource(null, 'firm_customers', 'full', async () => {
      const customers = await client.listCustomers()
      const rows = customers.map((c) => ({
        nibo_id: c.id,
        name: c.name,
        document_number: c.documentNumber ?? '',
        code: c.code ?? '',
        raw: c,
        synced_at: new Date().toISOString(),
      }))
      if (rows.length > 0) {
        const { error } = await supabase.from('nibo_firm_customers').upsert(rows, { onConflict: 'nibo_id' })
        if (error) throw new Error(error.message)
      }
      await reconcileDeletes({ table: 'nibo_firm_customers', match: {}, currentNiboIds: customers.map((c) => c.id) })
      return rows.length
    }),
  )

  results.push(
    await runResource(null, 'firm_tasks', 'full', async () => {
      const deadLine = referenceDate.toISOString().split('T')[0]
      const tasks = await client.listTasksByDate(deadLine)
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
      if (rows.length > 0) {
        const { error } = await supabase.from('nibo_firm_tasks').upsert(rows, { onConflict: 'nibo_id' })
        if (error) throw new Error(error.message)
      }
      await reconcileDeletes({
        table: 'nibo_firm_tasks',
        match: { dead_line: deadLine },
        currentNiboIds: tasks.map((t) => t.id),
      })
      return rows.length
    }),
  )

  return { platform: 'nibo', companyId: null, results, startedAt, finishedAt: new Date().toISOString() }
}

// ============================================================================
// Helpers para rodar sobre todas as empresas com credencial Nibo ativa
// (usados pelas rotas de cron).
// ============================================================================

async function activeNiboCredentials(): Promise<{ companyId: string; apiToken: string }[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('integration_credentials')
    .select('company_id, credentials')
    .eq('platform', 'nibo')
    .eq('active', true)
  if (error) throw new Error(error.message)
  return (data ?? [])
    .map((c: any) => ({ companyId: c.company_id as string, apiToken: c.credentials?.apiToken as string | undefined }))
    .filter((c): c is { companyId: string; apiToken: string } => Boolean(c.apiToken))
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Espaçamento entre empresas — cada empresa já é sequencial internamente
// (não paralelo), isso só evita rajadas quando o número de empresas cresce.
const INTER_COMPANY_DELAY_MS = 250

export async function syncAllCompaniesNiboFull(): Promise<SyncReport[]> {
  const credentials = await activeNiboCredentials()
  const reports: SyncReport[] = []
  for (const { companyId, apiToken } of credentials) {
    reports.push(await syncCompanyNiboFull(companyId, apiToken))
    await sleep(INTER_COMPANY_DELAY_MS)
  }
  return reports
}

export async function syncAllCompaniesNiboIncremental(): Promise<SyncReport[]> {
  const credentials = await activeNiboCredentials()
  const reports: SyncReport[] = []
  for (const { companyId, apiToken } of credentials) {
    reports.push(await syncCompanyNiboIncremental(companyId, apiToken))
    await sleep(INTER_COMPANY_DELAY_MS)
  }
  return reports
}
