import express from 'express'
import { apiKeyAuth, dataKeyAuth } from './middleware/apiKeyAuth.js'
import { cronAuth } from './middleware/cronAuth.js'
import { errorHandler } from './middleware/errorHandler.js'
import { healthRouter } from './routes/health.js'
import { companiesRouter } from './routes/companies.js'
import { credentialsRouter } from './routes/credentials.js'
import { syncRouter } from './routes/sync.js'
import { cronRouter } from './routes/cron.js'
import { niboDataRouter } from './routes/data/nibo.js'
import { mcpRouter } from './routes/mcp.js'
import { mcpAuth } from './middleware/mcpAuth.js'
import { oauthRouter } from './routes/oauth.js'

export const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true })) // POST /authorize e /token vêm como form (application/x-www-form-urlencoded)

// CORS — libera o BI/front-end a consumir o hub.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(204).end()
  next()
})

// Rota pública (sem API key) — usada por health checks externos.
app.use(healthRouter)

// OAuth (authorization server) — deliberadamente pública/sem x-api-key: é o
// próprio mecanismo de login que o conector MCP do Claude exige. Ver
// routes/oauth.ts para o porquê disso existir.
app.use(oauthRouter)

// Cron (autenticação própria via CRON_SECRET, ver middleware/cronAuth.ts).
app.use('/api/cron', cronAuth, cronRouter)

// MCP (autenticação própria via Bearer token, ver middleware/mcpAuth.ts) —
// somente leitura, é o que os conectores customizados no Claude usam.
app.use('/api/mcp', mcpAuth, mcpRouter)

// Escrita/administração — só a HUB_API_KEY mestra. apiKeyAuth é passado direto
// pra cada router (em vez de um app.use(apiKeyAuth) solto) porque um
// middleware montado sem path se aplica a TUDO que vem depois dele na
// cadeia — incluiria o niboDataRouter também, que precisa aceitar a
// HUB_REPORT_KEY (ver abaixo).
app.use(apiKeyAuth, companiesRouter)
app.use(apiKeyAuth, credentialsRouter)
app.use(apiKeyAuth, syncRouter)

// Leitura de dados — aceita a mestra OU a HUB_REPORT_KEY (só-leitura, ver
// middleware/apiKeyAuth.ts), pra relatórios HTML públicos não precisarem
// embutir a chave que também abre escrita.
app.use(dataKeyAuth, niboDataRouter)

app.use(errorHandler)

// Export default além do nomeado: a detecção automática de framework "Express"
// da Vercel roteia a raiz "/" direto pra este módulo e exige um default export
// que seja a app/handler — sem isso a função crasha em runtime com
// "Invalid export found in module... The default export must be a function or server."
export default app
