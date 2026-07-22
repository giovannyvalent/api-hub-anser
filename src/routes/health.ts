import { Router } from 'express'

export const healthRouter = Router()

healthRouter.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'anser-data-hub', time: new Date().toISOString() })
})
