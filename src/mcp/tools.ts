// Ferramentas MCP — somente leitura, de propósito. Espelham as rotas
// GET /api/data/nibo/* e GET /api/companies (mesmas funções de
// src/data/nibo.ts), pra qualquer colaborador conectado via um conector MCP
// no Claude poder pedir dados e montar seus próprios relatórios/artifacts,
// sem nunca ver token nenhum de plataforma nem poder escrever no hub.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import * as niboData from '../data/nibo.js'

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function fail(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : 'Unknown error'
  return { content: [{ type: 'text', text: `Erro: ${message}` }], isError: true }
}

async function safe(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn())
  } catch (err) {
    return fail(err)
  }
}

const companyIdField = z.string().uuid().describe('id da empresa no hub (ver a ferramenta list_companies)')

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'anser-data-hub', version: '1.0.0' })

  server.registerTool(
    'list_companies',
    {
      title: 'Listar empresas',
      description:
        'Lista as empresas-cliente cadastradas no hub, com os sistemas (platforms) que cada uma tem conectado (ex: ["nibo"]). Use isso primeiro para descobrir o companyId antes de chamar qualquer outra ferramenta.',
      inputSchema: { active: z.boolean().optional().describe('filtra só empresas ativas quando true') },
    },
    async ({ active }) => safe(() => niboData.listCompanies({ active })),
  )

  server.registerTool(
    'get_nibo_accounts',
    {
      title: 'Contas bancárias (Nibo)',
      description: 'Lista as contas bancárias de uma empresa no Nibo.',
      inputSchema: {
        companyId: companyIdField,
        includeArchived: z.boolean().optional().describe('inclui contas arquivadas (padrão: false)'),
      },
    },
    async ({ companyId, includeArchived }) => safe(() => niboData.getAccounts(companyId, { includeArchived })),
  )

  server.registerTool(
    'get_nibo_account_balances',
    {
      title: 'Saldo por conta (Nibo)',
      description:
        'Saldo bancário por conta. latest=true (padrão) retorna só o snapshot mais recente de cada conta; latest=false retorna o histórico.',
      inputSchema: {
        companyId: companyIdField,
        accountId: z.string().optional().describe('filtra por uma conta específica (nibo_id da conta)'),
        latest: z.boolean().optional().describe('padrão true — false retorna histórico completo'),
        limit: z.number().int().min(1).max(1000).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ companyId, accountId, latest, limit, offset }) =>
      safe(() => niboData.getAccountBalances(companyId, { accountId, latest, limit, offset })),
  )

  server.registerTool(
    'get_nibo_statement',
    {
      title: 'Extrato bancário (Nibo)',
      description: 'Extrato real (ledger) de uma ou todas as contas de uma empresa, num período.',
      inputSchema: {
        companyId: companyIdField,
        accountId: z.string().optional(),
        from: z.string().optional().describe('data inicial YYYY-MM-DD'),
        to: z.string().optional().describe('data final YYYY-MM-DD'),
        limit: z.number().int().min(1).max(1000).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ companyId, accountId, from, to, limit, offset }) =>
      safe(() => niboData.getStatement(companyId, { accountId, from, to, limit, offset })),
  )

  server.registerTool(
    'get_nibo_categories',
    {
      title: 'Categorias (Nibo)',
      description: 'Categorias de receita/despesa cadastradas na empresa.',
      inputSchema: { companyId: companyIdField, type: z.enum(['in', 'out']).optional() },
    },
    async ({ companyId, type }) => safe(() => niboData.getCategories(companyId, { type })),
  )

  server.registerTool(
    'get_nibo_cost_centers',
    {
      title: 'Centros de custo (Nibo)',
      description: 'Centros de custo cadastrados na empresa.',
      inputSchema: { companyId: companyIdField },
    },
    async ({ companyId }) => safe(() => niboData.getCostCenters(companyId)),
  )

  server.registerTool(
    'get_nibo_users',
    {
      title: 'Usuários com acesso à empresa (Nibo)',
      description: 'Usuários com acesso ao Nibo da empresa (ativos e inativos) — distinto de funcionários (RH/folha).',
      inputSchema: { companyId: companyIdField },
    },
    async ({ companyId }) => safe(() => niboData.getUsers(companyId)),
  )

  server.registerTool(
    'get_nibo_stakeholders',
    {
      title: 'Clientes/fornecedores/sócios/funcionários (Nibo)',
      description: 'Cadastro de pessoas/empresas relacionadas — filtre por "kind" para um tipo específico.',
      inputSchema: {
        companyId: companyIdField,
        kind: z.enum(['customer', 'supplier', 'partner', 'employee']).optional(),
      },
    },
    async ({ companyId, kind }) => safe(() => niboData.getStakeholders(companyId, { kind })),
  )

  server.registerTool(
    'get_nibo_organization',
    {
      title: 'Perfil da empresa (Nibo)',
      description: 'Dados cadastrais da empresa no Nibo (razão social, CNPJ, plano, escritório contábil vinculado).',
      inputSchema: { companyId: companyIdField },
    },
    async ({ companyId }) => safe(() => niboData.getOrganization(companyId)),
  )

  server.registerTool(
    'get_nibo_schedules',
    {
      title: 'Contas a pagar / a receber (Nibo)',
      description:
        'Lançamentos financeiros: type=Debit são contas a pagar, type=Credit são contas a receber. Filtre por período (from/to, sobre due_date), status de pagamento (isPaid) e categoria.',
      inputSchema: {
        companyId: companyIdField,
        from: z.string().optional().describe('due_date inicial YYYY-MM-DD'),
        to: z.string().optional().describe('due_date final YYYY-MM-DD'),
        isPaid: z.boolean().optional(),
        type: z.enum(['Debit', 'Credit']).optional(),
        categoryType: z.enum(['in', 'out']).optional(),
        limit: z.number().int().min(1).max(1000).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ companyId, from, to, isPaid, type, categoryType, limit, offset }) =>
      safe(() => niboData.getSchedules(companyId, { from, to, isPaid, type, categoryType, limit, offset })),
  )

  server.registerTool(
    'get_nibo_firm_customers',
    {
      title: 'Empresas do Nibo Contador (escritório)',
      description: 'Lista as empresas-cliente cadastradas no Nibo Contador da Anser (nível escritório).',
      inputSchema: {},
    },
    async () => safe(() => niboData.getFirmCustomers()),
  )

  server.registerTool(
    'get_nibo_firm_tasks',
    {
      title: 'Tarefas/obrigações do escritório (Nibo)',
      description: 'Tarefas do escritório contábil da Anser, opcionalmente filtradas por prazo (deadLine).',
      inputSchema: { date: z.string().optional().describe('data YYYY-MM-DD') },
    },
    async ({ date }) => safe(() => niboData.getFirmTasks({ date })),
  )

  server.registerTool(
    'get_sync_logs',
    {
      title: 'Histórico de sincronização',
      description: 'Log das sincronizações do hub com o Nibo — útil para checar se os dados de uma empresa estão atualizados.',
      inputSchema: {
        companyId: z.string().uuid().optional(),
        resource: z.string().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async ({ companyId, resource, limit, offset }) =>
      safe(() => niboData.getSyncLogs({ companyId, resource, limit, offset })),
  )

  return server
}
