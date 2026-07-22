import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'

// Rotas de cron (/api/cron/*) são chamadas pela infra da Vercel, que envia
// automaticamente "Authorization: Bearer <CRON_SECRET>" quando essa env var
// está configurada no projeto Vercel. Também aceitamos x-api-key, para
// permitir disparo manual do mesmo endpoint (ex: correr um sync fora do horário).
export function cronAuth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.header('x-api-key')
  if (apiKey && apiKey === env.hubApiKey) return next()

  if (!env.cronSecret) {
    logger.warn('CRON_SECRET não configurado — permitindo chamada sem autenticação (defina CRON_SECRET em produção).')
    return next()
  }

  const authHeader = req.header('authorization') || ''
  if (authHeader === `Bearer ${env.cronSecret}`) return next()

  return res.status(401).json({ error: 'Unauthorized: invalid cron secret' })
}
