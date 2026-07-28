import type { NextFunction, Request, Response } from 'express'
import { logger } from '../lib/logger.js'

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const message = err instanceof Error ? err.message : 'Unknown error'
  const status = (err as { status?: number })?.status ?? 500
  if (status >= 500) logger.error('Unhandled error:', err)
  res.status(status).json({ error: message })
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next)
  }
}
