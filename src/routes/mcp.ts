import { Router } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { buildMcpServer } from '../mcp/tools.js'
import { logger } from '../lib/logger.js'

export const mcpRouter = Router()

// POST /api/mcp — endpoint MCP (Streamable HTTP), pra registrar como conector
// customizado no Claude. Stateless de propósito: cada requisição cria um
// McpServer + transport novos e descarta no final — não guarda sessão em
// memória (não sobreviveria entre invocações de uma função serverless).
async function handleMcp(req: import('express').Request, res: import('express').Response) {
  const server = buildMcpServer()
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  res.on('close', () => {
    transport.close()
    server.close()
  })

  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (err) {
    logger.error('Erro no endpoint MCP:', err)
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      })
    }
  }
}

mcpRouter.post('/', asyncHandler(handleMcp))
mcpRouter.get('/', asyncHandler(handleMcp))
mcpRouter.delete('/', asyncHandler(handleMcp))
