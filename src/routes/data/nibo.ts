import { Router } from 'express'
import { asyncHandler } from '../../middleware/errorHandler.js'
import * as niboData from '../../data/nibo.js'

export const niboDataRouter = Router()

function pagination(req: import('express').Request) {
  const limit = Math.min(Number(req.query.limit) || 200, 1000)
  const offset = Number(req.query.offset) || 0
  return { limit, offset }
}

function requireCompanyId(req: import('express').Request, res: import('express').Response): string | null {
  const { companyId } = req.query
  if (!companyId) {
    res.status(400).json({ error: '"companyId" é obrigatório' })
    return null
  }
  return String(companyId)
}

// GET /api/data/nibo/accounts?companyId=&includeArchived=
niboDataRouter.get(
  '/api/data/nibo/accounts',
  asyncHandler(async (req, res) => {
    const companyId = requireCompanyId(req, res)
    if (!companyId) return
    const data = await niboData.getAccounts(companyId, { includeArchived: req.query.includeArchived === 'true' })
    res.json({ data })
  }),
)

// GET /api/data/nibo/categories?companyId=&type=in|out
niboDataRouter.get(
  '/api/data/nibo/categories',
  asyncHandler(async (req, res) => {
    const companyId = requireCompanyId(req, res)
    if (!companyId) return
    const data = await niboData.getCategories(companyId, { type: req.query.type ? String(req.query.type) : undefined })
    res.json({ data })
  }),
)

// GET /api/data/nibo/cost-centers?companyId=
niboDataRouter.get(
  '/api/data/nibo/cost-centers',
  asyncHandler(async (req, res) => {
    const companyId = requireCompanyId(req, res)
    if (!companyId) return
    const data = await niboData.getCostCenters(companyId)
    res.json({ data })
  }),
)

// GET /api/data/nibo/schedules?companyId=&from=&to=&isPaid=&type=Debit|Credit&categoryType=in|out&limit=&offset=
// type=Debit -> contas a pagar; type=Credit -> contas a receber (campo nativo do Nibo, mais confiável que category_type/isEntry).
niboDataRouter.get(
  '/api/data/nibo/schedules',
  asyncHandler(async (req, res) => {
    const companyId = requireCompanyId(req, res)
    if (!companyId) return
    const { limit, offset } = pagination(req)
    const { from, to, isPaid, type, categoryType } = req.query
    const result = await niboData.getSchedules(companyId, {
      from: from ? String(from) : undefined,
      to: to ? String(to) : undefined,
      isPaid: isPaid !== undefined ? isPaid === 'true' : undefined,
      type: type ? String(type) : undefined,
      categoryType: categoryType ? String(categoryType) : undefined,
      limit,
      offset,
    })
    res.json(result)
  }),
)

// GET /api/data/nibo/stakeholders?companyId=&kind=customer|supplier|partner|employee
niboDataRouter.get(
  '/api/data/nibo/stakeholders',
  asyncHandler(async (req, res) => {
    const companyId = requireCompanyId(req, res)
    if (!companyId) return
    const data = await niboData.getStakeholders(companyId, { kind: req.query.kind ? String(req.query.kind) : undefined })
    res.json({ data })
  }),
)

// GET /api/data/nibo/account-balances?companyId=&accountId=&latest=true
// latest=true (default) retorna só o snapshot mais recente de cada conta; senão, o histórico completo.
niboDataRouter.get(
  '/api/data/nibo/account-balances',
  asyncHandler(async (req, res) => {
    const companyId = requireCompanyId(req, res)
    if (!companyId) return
    const { limit, offset } = pagination(req)
    const { accountId, latest } = req.query
    const data = await niboData.getAccountBalances(companyId, {
      accountId: accountId ? String(accountId) : undefined,
      latest: latest !== 'false',
      limit,
      offset,
    })
    res.json({ data })
  }),
)

// GET /api/data/nibo/statement?companyId=&accountId=&from=&to=&limit=&offset=
niboDataRouter.get(
  '/api/data/nibo/statement',
  asyncHandler(async (req, res) => {
    const companyId = requireCompanyId(req, res)
    if (!companyId) return
    const { limit, offset } = pagination(req)
    const { accountId, from, to } = req.query
    const result = await niboData.getStatement(companyId, {
      accountId: accountId ? String(accountId) : undefined,
      from: from ? String(from) : undefined,
      to: to ? String(to) : undefined,
      limit,
      offset,
    })
    res.json(result)
  }),
)

// GET /api/data/nibo/organization?companyId=
niboDataRouter.get(
  '/api/data/nibo/organization',
  asyncHandler(async (req, res) => {
    const companyId = requireCompanyId(req, res)
    if (!companyId) return
    const data = await niboData.getOrganization(companyId)
    res.json({ data })
  }),
)

// GET /api/data/nibo/firm-customers
niboDataRouter.get(
  '/api/data/nibo/firm-customers',
  asyncHandler(async (_req, res) => {
    const data = await niboData.getFirmCustomers()
    res.json({ data })
  }),
)

// GET /api/data/nibo/firm-tasks?date=YYYY-MM-DD
niboDataRouter.get(
  '/api/data/nibo/firm-tasks',
  asyncHandler(async (req, res) => {
    const data = await niboData.getFirmTasks({ date: req.query.date ? String(req.query.date) : undefined })
    res.json({ data })
  }),
)

// GET /api/data/nibo/sync-logs?companyId=&resource=
niboDataRouter.get(
  '/api/data/nibo/sync-logs',
  asyncHandler(async (req, res) => {
    const { limit, offset } = pagination(req)
    const { companyId, resource } = req.query
    const data = await niboData.getSyncLogs({
      companyId: companyId ? String(companyId) : undefined,
      resource: resource ? String(resource) : undefined,
      limit,
      offset,
    })
    res.json({ data })
  }),
)
