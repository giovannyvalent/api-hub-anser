import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env.js'

// Protege as rotas do hub (companies, credentials, sync, data/*).
// O BI e qualquer outro consumidor deve enviar: x-api-key: <HUB_API_KEY>
export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const provided = req.header('x-api-key')
  if (!provided || provided !== env.hubApiKey) {
    return res.status(401).json({ error: 'Unauthorized: missing or invalid x-api-key' })
  }
  next()
}
