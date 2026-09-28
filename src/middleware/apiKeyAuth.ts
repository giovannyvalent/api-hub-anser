import type { NextFunction, Request, Response } from 'express'
import { env } from '../config/env.js'

// Único middleware pra companies/credentials/sync/data, ciente do caminho —
// não dá pra separar isso em vários app.use('/prefixo', mw, router): as
// rotas desses routers já usam caminho ABSOLUTO dentro de si mesmas (ex:
// companiesRouter.get('/api/companies', ...)), pensadas pra serem montadas
// sem prefixo (app.use(router)). Um app.use(mw, router) SEM caminho roda
// "mw" incondicionalmente pra QUALQUER request que chegue até ali na
// cadeia — antes até do router decidir se a rota é dele — então, com
// vários desses em sequência, o apiKeyAuth de um bloqueava toda requisição
// (inclusive pra /api/data/*) antes dela alcançar o dataKeyAuth mais
// abaixo. Um middleware só, decidindo pelo path, evita isso de vez.
//
// /api/data/* aceita a HUB_API_KEY mestra OU a HUB_REPORT_KEY (só-leitura)
// — essa segunda existe pros relatórios HTML em public/relatorios/*, que
// ficam publicamente acessíveis sem login e por isso nunca podem embutir a
// chave mestra (que também abre escrita: criar/apagar empresa, trocar
// credencial, disparar sync). Todo o resto exige só a mestra.
//
// GET /api/companies é a única exceção fora de /api/data/: os relatórios e
// o cockpit de monitoramento precisam da lista de empresas (id -> nome) só
// pra exibição, e essa rota não devolve nada sensível (sem credenciais/
// token). POST/PATCH/DELETE em /api/companies continuam exigindo a mestra
// — a checagem de método garante isso.
export function hubAuth(req: Request, res: Response, next: NextFunction) {
  const provided = req.header('x-api-key')
  const isReadOnlyRoute = req.path.startsWith('/api/data/') || (req.method === 'GET' && req.path === '/api/companies')
  const validKeys = isReadOnlyRoute ? [env.hubApiKey, env.hubReportKey].filter(Boolean) : [env.hubApiKey]
  if (!provided || !validKeys.includes(provided)) {
    return res.status(401).json({ error: 'Unauthorized: missing or invalid x-api-key' })
  }
  next()
}
