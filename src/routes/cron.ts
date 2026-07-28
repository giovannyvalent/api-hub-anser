import { Router } from 'express'
import { asyncHandler } from '../middleware/errorHandler.js'
import { logger } from '../lib/logger.js'
import { syncAllCompaniesNiboFull, syncAllCompaniesNiboIncremental, syncFirmNibo } from '../integrations/nibo/sync.js'

export const cronRouter = Router()

// GET /api/cron/sync-nibo-financial — alvo de cron de ALTA frequência (ideal:
// a cada 5 min). Só financeiro (schedules debit/credit incremental, saldo,
// extrato recente) — rápido e barato de rodar com frequência.
cronRouter.get(
  '/sync-nibo-financial',
  asyncHandler(async (_req, res) => {
    logger.info('cron sync-nibo-financial: iniciando')
    const reports = await syncAllCompaniesNiboIncremental()
    logger.info(`cron sync-nibo-financial: concluído para ${reports.length} empresa(s)`)
    res.json({ data: reports })
  }),
)

// GET /api/cron/sync-nibo-full — alvo de cron de BAIXA frequência (ideal: 1x/dia).
// Cadastros (accounts, categories, cost centers, stakeholders, organization)
// + histórico financeiro amplo (24 meses) + dados de escritório (customers/tasks).
cronRouter.get(
  '/sync-nibo-full',
  asyncHandler(async (_req, res) => {
    logger.info('cron sync-nibo-full: iniciando')
    const companyReports = await syncAllCompaniesNiboFull()

    let firmReport = null
    try {
      firmReport = await syncFirmNibo()
    } catch (err) {
      // Credencial de escritório é opcional até ser configurada — não derruba o cron.
      logger.warn('cron sync-nibo-full: sync de escritório pulado —', err instanceof Error ? err.message : err)
    }

    logger.info(`cron sync-nibo-full: concluído para ${companyReports.length} empresa(s)`)
    res.json({ data: { companies: companyReports, firm: firmReport } })
  }),
)
