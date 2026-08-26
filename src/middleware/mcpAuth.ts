import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env.js'

// Conectores MCP customizados normalmente enviam "Authorization: Bearer <token>"
// (configurado uma vez ao cadastrar o conector no Claude) — reaproveita a
// HUB_API_KEY como esse token, mesmo modelo de segurança do resto do hub.
export function mcpAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.header('authorization') || ''
  const bearerOk = authHeader === `Bearer ${env.hubApiKey}`
  const apiKeyOk = req.header('x-api-key') === env.hubApiKey

  if (!bearerOk && !apiKeyOk) {
    return res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized: missing or invalid bearer token' },
      id: null,
    })
  }
  next()
}
