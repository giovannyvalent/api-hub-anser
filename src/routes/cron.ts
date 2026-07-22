import { Router } from 'express'
import { asyncHandler } from '../middleware/errorHandler.js'
import { logger } from '../lib/logger.js'
import { syncAllCompaniesNibo, syncFirmNibo } from '../integrations/nibo/sync.js'

export const cronRouter = Router()

// GET /api/cron/sync-nibo — alvo do Vercel Cron (ver vercel.json).
// Sincroniza todas as empresas (API "empresas") + dados de escritório (API "accountant").
cronRouter.get(
  '/sync-nibo',
  asyncHandler(async (_req, res) => {
    logger.info('cron sync-nibo: iniciando')
    const companyReports = await syncAllCompaniesNibo()

    let firmReport = null
    try {
      firmReport = await syncFirmNibo()
    } catch (err) {
      // Credencial de escritório é opcional até ser configurada — não derruba o cron.
      logger.warn('cron sync-nibo: sync de escritório pulado —', err instanceof Error ? err.message : err)
    }

    logger.info(`cron sync-nibo: concluído para ${companyReports.length} empresa(s)`)
    res.json({ data: { companies: companyReports, firm: firmReport } })
  }),
)
