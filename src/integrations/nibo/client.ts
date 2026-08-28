import { env } from '../../config/env.js'
import type {
  NiboAccount,
  NiboAccountBalance,
  NiboCategory,
  NiboCostCenter,
  NiboFirmCustomer,
  NiboFirmTask,
  NiboListResponse,
  NiboOrganization,
  NiboSchedule,
  NiboStakeholder,
  NiboStakeholderKind,
  NiboStatementEntry,
  NiboUser,
} from './types.js'

const EMPRESAS_BASE = 'https://api.nibo.com.br/empresas/v1'
const ACCOUNTANT_BASE = 'https://api.nibo.com.br/accountant/api/v1'

const PAGE_SIZE = 100

// Retry com backoff pra absorver picos de rate limit (429) e instabilidade
// transitória (502/503/504) do Nibo, sem esperar o próximo ciclo do cron.
const RETRYABLE_STATUS = new Set([429, 502, 503, 504])
const MAX_RETRIES = 4
const BASE_DELAY_MS = 800

class NiboApiError extends Error {
  constructor(public status: number, public url: string, public body: string) {
    super(`Nibo API error ${status} on ${url}: ${body}`)
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function midDate(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00Z`).getTime()
  const e = new Date(`${end}T00:00:00Z`).getTime()
  return new Date(s + Math.floor((e - s) / 2)).toISOString().split('T')[0]
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

function retryDelayMs(res: Response, attempt: number): number {
  const retryAfter = res.headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (!Number.isNaN(seconds)) return seconds * 1000
  }
  // backoff exponencial com jitter: ~0.8s, 1.6s, 3.2s, 6.4s
  return BASE_DELAY_MS * 2 ** attempt + Math.random() * 300
}

// ---------------------------------------------------------------------------
// Throttle global: teto de requisições/segundo pra QUALQUER chamada ao Nibo,
// não importa se veio de uma empresa só, de um sync completo ou do cron. Isso
// evita bater no limite em vez de só reagir depois que já bateu (retry acima
// cobre o resto — picos que passarem do teto por concorrência externa, etc).
// A Nibo não documenta o limite exato publicamente, então usamos um valor
// conservador; ajustável via env var se descobrirmos o limite real deles.
// ---------------------------------------------------------------------------
const MIN_REQUEST_INTERVAL_MS = Number(process.env.NIBO_MIN_REQUEST_INTERVAL_MS) || 200 // ~5 req/s
let queueTail: Promise<void> = Promise.resolve()
let lastRequestAt = 0

async function throttle(): Promise<void> {
  const myTurn = queueTail
  let release: () => void
  queueTail = new Promise((resolve) => { release = resolve })
  await myTurn

  const wait = Math.max(0, lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now())
  if (wait > 0) await sleep(wait)
  lastRequestAt = Date.now()

  release!()
}

async function fetchJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await throttle()
    const res = await fetch(url, { headers: { accept: 'application/json', ...headers } })
    if (res.ok) return res.json() as Promise<T>

    if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
      await sleep(retryDelayMs(res, attempt))
      continue
    }

    const body = await res.text()
    throw new NiboApiError(res.status, url, body)
  }
  // inalcançável (o loop sempre retorna ou lança), só pra satisfazer o TS
  throw new NiboApiError(0, url, 'retries exhausted')
}

// Pagina um endpoint OData-like ($top/$skip) até esgotar os resultados.
// maxPages limita o custo de uma chamada só (sync incremental usa um valor
// baixo; o full backfill usa um valor bem mais alto).
//
// IMPORTANTE: a API do Nibo (LINQ-to-Entities por trás) exige um $orderby
// sempre que $skip é usado, senão retorna 500 ("the method 'Skip' is only
// supported for sorted input... 'OrderBy' must be called before 'Skip'").
// orderBy é obrigatório aqui de propósito, pra nunca esquecer de novo.
async function paginate<T>(
  buildUrl: (top: number, skip: number) => string,
  headers: Record<string, string>,
  maxPages: number,
): Promise<T[]> {
  const all: T[] = []
  let page = 0
  let hasMore = true

  while (hasMore && page < maxPages) {
    const url = buildUrl(PAGE_SIZE, page * PAGE_SIZE)
    const data = await fetchJson<NiboListResponse<T>>(url, headers)
    const items = data.items ?? data.value ?? []
    all.push(...items)
    hasMore = items.length === PAGE_SIZE
    page++
  }

  return all
}

const STAKEHOLDER_ENDPOINT: Record<NiboStakeholderKind, string> = {
  customer: 'customers',
  supplier: 'suppliers',
  partner: 'partners',
  employee: 'employees',
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
    const data = await fetchJson<NiboListResponse<NiboAccount>>(`${EMPRESAS_BASE}/accounts`, this.headers())
    return data.items ?? []
  }

  async listAccountBalances(): Promise<NiboAccountBalance[]> {
    return paginate<NiboAccountBalance>((top, skip) => {
      const url = new URL(`${EMPRESAS_BASE}/accounts/views/balance`)
      url.searchParams.set('$top', String(top))
      url.searchParams.set('$skip', String(skip))
      url.searchParams.set('$orderby', 'accountName asc')
      return url.toString()
    }, this.headers(), 20)
  }

  // Extrato real da conta (ledger) — diferente de schedules (agendado/competência).
  // Esse endpoint NÃO suporta $top/$skip (trava com erro se tentar paginar
  // via OData) e corta silenciosamente em 500 itens por chamada quando o
  // período pedido tem mais que isso. IMPORTANTE (achado numa auditoria):
  // o corte NÃO é um recorte cronológico limpo — pedir um período largo com
  // >500 lançamentos reais pode descartar registros espalhados no MEIO do
  // período, não só depois da última data retornada. Ou seja, "avançar a
  // partir da última data da página anterior" não garante nada.
  //
  // A única estratégia confiável é bisseção: se uma chamada devolve 500
  // (= pode ter sido truncada), divide o período em dois e repete cada
  // metade recursivamente, até cada pedaço vir com menos de 500 — aí, e só
  // aí, dá pra confiar que aquele pedaço veio completo.
  async getAccountStatement(accountId: string, startDate: string, endDate: string): Promise<NiboStatementEntry[]> {
    const raw = await this.fetchStatementRange(accountId, startDate, endDate, startDate, 0)

    // Dedup defensivo por entryId — não deveria haver sobreposição real com
    // bisseção (os intervalos não se tocam), mas serve de rede de segurança.
    const seen = new Set<string>()
    return raw.filter((it) => {
      const key = it.entryId || `${it.type}-${it.date}-${it.index}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  private async fetchStatementRange(
    accountId: string,
    start: string,
    end: string,
    originalStart: string,
    depth: number,
  ): Promise<NiboStatementEntry[]> {
    const PAGE_LIMIT = 500
    const MAX_DEPTH = 14 // 2^14 subdivisões — jamais deveria chegar perto disso na prática

    const url = new URL(`${EMPRESAS_BASE}/accounts/${accountId}/views/statement`)
    url.searchParams.set('startDate', start)
    url.searchParams.set('endDate', end)
    const data = await fetchJson<NiboListResponse<NiboStatementEntry>>(url.toString(), this.headers())
    const items = data.items ?? []

    // "StartAccountBalance" é um pseudo-lançamento (saldo de abertura no
    // início do período PEDIDO NESSA CHAMADA) — só é um dado real quando
    // "start" é o início do período que o chamador pediu de fato; em
    // qualquer subdivisão interna da bisseção ele é um artefato do corte.
    const clean = items.filter((it) => it.type !== 'StartAccountBalance' || start === originalStart)

    if (items.length < PAGE_LIMIT || start === end || depth >= MAX_DEPTH) {
      return clean
    }

    const mid = midDate(start, end)
    const nextStart = addDays(mid, 1)
    if (nextStart > end) return clean // não dá mais pra subdividir

    const [left, right] = await Promise.all([
      this.fetchStatementRange(accountId, start, mid, originalStart, depth + 1),
      this.fetchStatementRange(accountId, nextStart, end, originalStart, depth + 1),
    ])
    return [...left, ...right]
  }

  async listCategories(): Promise<NiboCategory[]> {
    const data = await fetchJson<NiboListResponse<NiboCategory>>(`${EMPRESAS_BASE}/categories`, this.headers())
    return data.items ?? []
  }

  async listCostCenters(): Promise<NiboCostCenter[]> {
    const data = await fetchJson<NiboListResponse<NiboCostCenter>>(`${EMPRESAS_BASE}/costcenters`, this.headers())
    return data.items ?? []
  }

  // customers / suppliers / partners / employees: mesma forma de resposta na
  // API do Nibo, só o path muda — ver STAKEHOLDER_ENDPOINT.
  async listStakeholders(kind: NiboStakeholderKind): Promise<NiboStakeholder[]> {
    return paginate<NiboStakeholder>((top, skip) => {
      const url = new URL(`${EMPRESAS_BASE}/${STAKEHOLDER_ENDPOINT[kind]}`)
      url.searchParams.set('$top', String(top))
      url.searchParams.set('$skip', String(skip))
      url.searchParams.set('$orderby', 'name asc')
      return url.toString()
    }, this.headers(), 50)
  }

  // Usuários com acesso à empresa no Nibo — distinto de "employees"
  // (cadastro de RH/folha). Inclui ativos e inativos: a API não expõe um
  // filtro de status aqui, então tudo que ela retorna é sincronizado.
  async listUsers(): Promise<NiboUser[]> {
    return paginate<NiboUser>((top, skip) => {
      const url = new URL(`${EMPRESAS_BASE}/users`)
      url.searchParams.set('$top', String(top))
      url.searchParams.set('$skip', String(skip))
      url.searchParams.set('$orderby', 'email asc')
      return url.toString()
    }, this.headers(), 20)
  }

  async getOrganization(): Promise<NiboOrganization | null> {
    const data = await fetchJson<NiboListResponse<NiboOrganization>>(`${EMPRESAS_BASE}/organizations`, this.headers())
    return (data.items ?? [])[0] ?? null
  }

  // kind: 'debit' = contas a pagar, 'credit' = contas a receber.
  // opts.updatedSince filtra por updateDate (sync incremental). opts.from/to
  // filtram por dueDate (usado no backfill completo).
  async listSchedules(
    kind: 'debit' | 'credit',
    opts: { updatedSince?: string; from?: string; to?: string } = {},
    maxPages = 50,
  ): Promise<NiboSchedule[]> {
    const filters: string[] = []
    if (opts.updatedSince) filters.push(`updateDate ge ${opts.updatedSince}`)
    if (opts.from) filters.push(`dueDate ge ${opts.from}`)
    if (opts.to) filters.push(`dueDate le ${opts.to}`)
    const filter = filters.join(' and ')

    return paginate<NiboSchedule>((top, skip) => {
      const url = new URL(`${EMPRESAS_BASE}/schedules/${kind}`)
      url.searchParams.set('$top', String(top))
      url.searchParams.set('$skip', String(skip))
      url.searchParams.set('$orderby', opts.updatedSince ? 'updateDate asc' : 'dueDate asc')
      if (filter) url.searchParams.set('$filter', filter)
      return url.toString()
    }, this.headers(), maxPages)
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
      const url = new URL(`${ACCOUNTANT_BASE}/accountingfirms/${this.firmId}/customers`)
      url.searchParams.set('$top', String(top))
      url.searchParams.set('$skip', String(skip))
      url.searchParams.set('$orderby', 'name asc')
      return url.toString()
    }, this.headers(), 20)
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
    }, this.headers(), 10)
  }
}
