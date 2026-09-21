import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env.js'

// Protege as rotas de escrita/administração do hub (companies, credentials,
// sync). Só a HUB_API_KEY mestra passa aqui — essa chave nunca deve ir pra
// nenhum HTML público, só pro BI, colaboradores (curl) e pro conector MCP.
export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const provided = req.header('x-api-key')
  if (!provided || provided !== env.hubApiKey) {
    return res.status(401).json({ error: 'Unauthorized: missing or invalid x-api-key' })
  }
  next()
}

// Protege as rotas de LEITURA de dados (data/*). Aceita a HUB_API_KEY mestra
// OU a HUB_REPORT_KEY (só-leitura) — essa segunda existe especificamente pra
// relatórios HTML hospedados em public/relatorios/*, que ficam publicamente
// acessíveis sem login e por isso nunca podem embutir a chave mestra (que
// também abre escrita: criar/apagar empresa, trocar credencial, disparar
// sync). Se HUB_REPORT_KEY não estiver configurada, só a mestra funciona.
export function dataKeyAuth(req: Request, res: Response, next: NextFunction) {
  const provided = req.header('x-api-key')
  const validKeys = [env.hubApiKey, env.hubReportKey].filter(Boolean)
  if (!provided || !validKeys.includes(provided)) {
    return res.status(401).json({ error: 'Unauthorized: missing or invalid x-api-key' })
  }
  next()
}
