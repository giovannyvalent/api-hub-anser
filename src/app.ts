import express from 'express'
import { apiKeyAuth } from './middleware/apiKeyAuth.js'
import { cronAuth } from './middleware/cronAuth.js'
import { errorHandler } from './middleware/errorHandler.js'
import { healthRouter } from './routes/health.js'
import { companiesRouter } from './routes/companies.js'
import { credentialsRouter } from './routes/credentials.js'
import { syncRouter } from './routes/sync.js'
import { cronRouter } from './routes/cron.js'
import { niboDataRouter } from './routes/data/nibo.js'

export const app = express()

app.use(express.json())

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

// Cron (autenticação própria via CRON_SECRET, ver middleware/cronAuth.ts).
app.use('/api/cron', cronAuth, cronRouter)

// Demais rotas — todas exigem x-api-key.
app.use(apiKeyAuth)
app.use(companiesRouter)
app.use(credentialsRouter)
app.use(syncRouter)
app.use(niboDataRouter)

app.use(errorHandler)
