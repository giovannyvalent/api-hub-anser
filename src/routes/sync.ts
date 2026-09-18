import { Router } from 'express'
import { getSupabase } from '../lib/supabase.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import {
  FULL_SYNC_RESOURCE_NAMES,
  syncAllCompaniesNiboFull,
  syncAllCompaniesNiboIncremental,
  syncCompanyNiboFull,
  syncCompanyNiboFullResource,
  syncCompanyNiboIncremental,
  syncFirmNibo,
} from '../integrations/nibo/sync.js'

export const syncRouter = Router()

async function getApiToken(companyId: string): Promise<string> {
  const supabase = getSupabase()
  const { data: cred, error } = await supabase
    .from('integration_credentials')
    .select('credentials, active')
    .eq('company_id', companyId)
    .eq('platform', 'nibo')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!cred || !(cred as any).active) {
    throw Object.assign(new Error('Credencial Nibo não encontrada/ativa para essa empresa'), { status: 404 })
  }
  const apiToken = (cred as any).credentials?.apiToken
  if (!apiToken) throw Object.assign(new Error('Credencial Nibo sem "apiToken"'), { status: 400 })
  return apiToken
}

// POST /api/sync/nibo/:companyId/full — cadastros + histórico financeiro amplo (pesado).
syncRouter.post(
  '/api/sync/nibo/:companyId/full',
  asyncHandler(async (req, res) => {
    const companyId = String(req.params.companyId)
    const apiToken = await getApiToken(companyId)
    const report = await syncCompanyNiboFull(companyId, apiToken)
    res.json({ data: report })
  }),
)

// POST /api/sync/nibo/:companyId/full/:resource — full sync de UM recurso só.
// Útil pra clientes grandes o suficiente pra estourar os 300s da função
// fazendo o full sync inteiro numa chamada: dá pra rodar recurso por
// recurso, cada chamada com seu próprio orçamento de 300s. Recursos válidos
// em FULL_SYNC_RESOURCE_NAMES (accounts, categories, schedules_debit, etc).
syncRouter.post(
  '/api/sync/nibo/:companyId/full/:resource',
  asyncHandler(async (req, res) => {
    const companyId = String(req.params.companyId)
    const resource = String(req.params.resource)
    if (!FULL_SYNC_RESOURCE_NAMES.includes(resource)) {
      return res.status(400).json({ error: `recurso inválido. Use um de: ${FULL_SYNC_RESOURCE_NAMES.join(', ')}` })
    }
    const apiToken = await getApiToken(companyId)
    // from/to opcionais: fatiam a janela padrão de 48 meses em pedaços
    // menores, pra clientes grandes o suficiente pra estourar 300s mesmo
    // com o recurso isolado (só vale pra schedules_debit/schedules_credit).
    const { from, to } = req.query
    const range = typeof from === 'string' && typeof to === 'string' ? { from, to } : undefined
    const report = await syncCompanyNiboFullResource(companyId, apiToken, resource, range)
    res.json({ data: report })
  }),
)

// POST /api/sync/nibo/:companyId/incremental — só financeiro, janela curta (rápido).
syncRouter.post(
  '/api/sync/nibo/:companyId/incremental',
  asyncHandler(async (req, res) => {
    const companyId = String(req.params.companyId)
    const apiToken = await getApiToken(companyId)
    const report = await syncCompanyNiboIncremental(companyId, apiToken)
    res.json({ data: report })
  }),
)

// POST /api/sync/nibo/full — todas as empresas com credencial ativa (full).
syncRouter.post(
  '/api/sync/nibo/full',
  asyncHandler(async (_req, res) => {
    const reports = await syncAllCompaniesNiboFull()
    res.json({ data: reports })
  }),
)

// POST /api/sync/nibo/incremental — todas as empresas com credencial ativa (incremental).
syncRouter.post(
  '/api/sync/nibo/incremental',
  asyncHandler(async (_req, res) => {
    const reports = await syncAllCompaniesNiboIncremental()
    res.json({ data: reports })
  }),
)

// POST /api/sync/nibo-firm — sincroniza dados de nível escritório (customers, tasks).
syncRouter.post(
  '/api/sync/nibo-firm',
  asyncHandler(async (_req, res) => {
    const report = await syncFirmNibo()
    res.json({ data: report })
  }),
)
