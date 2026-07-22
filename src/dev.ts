import 'dotenv/config'
import { app } from './app.js'
import { logger } from './lib/logger.js'

const port = Number(process.env.PORT) || 3333

app.listen(port, () => {
  logger.info(`anser-data-hub rodando em http://localhost:${port}`)
})
