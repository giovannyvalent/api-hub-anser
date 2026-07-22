import { env } from '../../config/env.js'
import type {
  NiboAccount,
  NiboCategory,
  NiboCostCenter,
  NiboFirmCustomer,
  NiboFirmTask,
  NiboListResponse,
  NiboSchedule,
} from './types.js'

const EMPRESAS_BASE = 'https://api.nibo.com.br/empresas/v1'
const ACCOUNTANT_BASE = 'https://api.nibo.com.br/accountant/api/v1'

const PAGE_SIZE = 100
const MAX_PAGES = 50

class NiboApiError extends Error {
  constructor(public status: number, public url: string, public body: string) {
    super(`Nibo API error ${status} on ${url}: ${body}`)
  }
}

async function fetchJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json', ...headers } })
  if (!res.ok) {
    const body = await res.text()
    throw new NiboApiError(res.status, url, body)
  }
  return res.json() as Promise<T>
}

// Pagina um endpoint OData-like ($top/$skip) até esgotar os resultados.
async function paginate<T>(
  buildUrl: (top: number, skip: number) => string,
  headers: Record<string, string>,
): Promise<T[]> {
  const all: T[] = []
  let page = 0
  let hasMore = true

  while (hasMore && page < MAX_PAGES) {
    const url = buildUrl(PAGE_SIZE, page * PAGE_SIZE)
    const data = await fetchJson<NiboListResponse<T>>(url, headers)
    const items = data.items ?? data.value ?? []
    all.push(...items)
    hasMore = items.length === PAGE_SIZE
    page++
  }

  return all
}

// ============================================================================
// API "empresas" — por empresa-cliente, autenticada com o apiToken daquela empresa.
// ============================================================================

export class NiboEmpresaClient {
  constructor(private apiToken: string) {}

  private headers() {
    return { apitoken: this.apiToken }
  }

  async listAccounts(): Promise<NiboAccount[]> {
    const data = await fetchJson<NiboListResponse<NiboAccount>>(
      `${EMPRESAS_BASE}/accounts`,
      this.headers(),
    )
    return data.items ?? []
  }

  async listCategories(): Promise<NiboCategory[]> {
    const data = await fetchJson<NiboListResponse<NiboCategory>>(
      `${EMPRESAS_BASE}/categories`,
      this.headers(),
    )
    return data.items ?? []
  }

  async listCostCenters(): Promise<NiboCostCenter[]> {
    const data = await fetchJson<NiboListResponse<NiboCostCenter>>(
      `${EMPRESAS_BASE}/costcenters`,
      this.headers(),
    )
    return data.items ?? []
  }

  // schedules = contas a pagar/receber (agendamentos + já baixados/pagos).
  // from/to filtram por dueDate (formato YYYY-MM-DD).
  async listSchedules(opts: { from?: string; to?: string } = {}): Promise<NiboSchedule[]> {
    const filters: string[] = []
    if (opts.from) filters.push(`dueDate ge ${opts.from}`)
    if (opts.to) filters.push(`dueDate le ${opts.to}`)
    const filter = filters.join(' and ')

    return paginate<NiboSchedule>((top, skip) => {
      const url = new URL(`${EMPRESAS_BASE}/schedules`)
      url.searchParams.set('$top', String(top))
      url.searchParams.set('$skip', String(skip))
      url.searchParams.set('$orderby', 'dueDate asc')
      if (filter) url.searchParams.set('$filter', filter)
      return url.toString()
    }, this.headers())
  }
}

// ============================================================================
// API "accountant" — nível escritório contábil, credencial única da Anser.
// ============================================================================

export class NiboAccountantClient {
  private apiKey: string
  private firmId: string

  constructor(apiKey = env.niboAccountantApiKey, firmId = env.niboAccountantFirmId) {
    if (!apiKey || !firmId) {
      throw new Error('NIBO_ACCOUNTANT_API_KEY / NIBO_ACCOUNTANT_FIRM_ID não configurados')
    }
    this.apiKey = apiKey
    this.firmId = firmId
  }

  private headers() {
    return { 'X-API-Key': this.apiKey }
  }

  async listCustomers(): Promise<NiboFirmCustomer[]> {
    return paginate<NiboFirmCustomer>((top, skip) => {
      const url = new URL(
        `${ACCOUNTANT_BASE}/accountingfirms/${this.firmId}/customers`,
      )
      url.searchParams.set('$top', String(top))
      url.searchParams.set('$skip', String(skip))
      return url.toString()
    }, this.headers())
  }

  // deadLine no formato YYYY-MM-DD.
  async listTasksByDate(deadLine: string): Promise<NiboFirmTask[]> {
    return paginate<NiboFirmTask>((top, skip) => {
      const url = new URL(`${ACCOUNTANT_BASE}/accountingfirms/${this.firmId}/tasks`)
      url.searchParams.set('$filter', `deadLine eq ${deadLine}`)
      url.searchParams.set('$orderby', 'deadLine desc')
      url.searchParams.set('$top', String(top))
      url.searchParams.set('$skip', String(skip))
      return url.toString()
    }, this.headers())
  }
}
