import { Router } from 'express'
import { getSupabase } from '../lib/supabase.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { syncAllCompaniesNibo, syncCompanyNibo, syncFirmNibo } from '../integrations/nibo/sync.js'

export const syncRouter = Router()

// POST /api/sync/nibo/:companyId — sincroniza os dados de UMA empresa (accounts,
// categories, cost_centers, schedules) usando o token salvo em integration_credentials.
syncRouter.post(
  '/api/sync/nibo/:companyId',
  asyncHandler(async (req, res) => {
    const companyId = String(req.params.companyId)
    const supabase = getSupabase()
    const { data: cred, error } = await supabase
      .from('integration_credentials')
      .select('credentials, active')
      .eq('company_id', companyId)
      .eq('platform', 'nibo')
      .maybeSingle()

    if (error) return res.status(500).json({ error: error.message })
    if (!cred || !(cred as any).active) {
      return res.status(404).json({ error: 'Credencial Nibo não encontrada/ativa para essa empresa' })
    }
    const apiToken = (cred as any).credentials?.apiToken
    if (!apiToken) return res.status(400).json({ error: 'Credencial Nibo sem "apiToken"' })

    const report = await syncCompanyNibo(companyId, apiToken)
    res.json({ data: report })
  }),
)

// POST /api/sync/nibo — sincroniza TODAS as empresas com credencial Nibo ativa.
syncRouter.post(
  '/api/sync/nibo',
  asyncHandler(async (_req, res) => {
    const reports = await syncAllCompaniesNibo()
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
