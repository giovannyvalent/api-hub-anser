import { Router } from 'express'
import { getSupabase } from '../../lib/supabase.js'
import { asyncHandler } from '../../middleware/errorHandler.js'

export const niboDataRouter = Router()

function pagination(req: import('express').Request) {
  const limit = Math.min(Number(req.query.limit) || 200, 1000)
  const offset = Number(req.query.offset) || 0
  return { limit, offset }
}

// GET /api/data/nibo/accounts?companyId=&includeArchived=
niboDataRouter.get(
  '/api/data/nibo/accounts',
  asyncHandler(async (req, res) => {
    const { companyId, includeArchived } = req.query
    if (!companyId) return res.status(400).json({ error: '"companyId" é obrigatório' })

    const supabase = getSupabase()
    let query = supabase.from('nibo_accounts').select('*').eq('company_id', String(companyId))
    if (includeArchived !== 'true') query = query.eq('is_archived', false)

    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data })
  }),
)

// GET /api/data/nibo/categories?companyId=&type=in|out
niboDataRouter.get(
  '/api/data/nibo/categories',
  asyncHandler(async (req, res) => {
    const { companyId, type } = req.query
    if (!companyId) return res.status(400).json({ error: '"companyId" é obrigatório' })

    const supabase = getSupabase()
    let query = supabase
      .from('nibo_categories')
      .select('*')
      .eq('company_id', String(companyId))
      .eq('is_deleted', false)
    if (type) query = query.eq('type', String(type))

    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data })
  }),
)

// GET /api/data/nibo/cost-centers?companyId=
niboDataRouter.get(
  '/api/data/nibo/cost-centers',
  asyncHandler(async (req, res) => {
    const { companyId } = req.query
    if (!companyId) return res.status(400).json({ error: '"companyId" é obrigatório' })

    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('nibo_cost_centers')
      .select('*')
      .eq('company_id', String(companyId))
      .eq('is_deleted', false)
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data })
  }),
)

// GET /api/data/nibo/schedules?companyId=&from=&to=&isPaid=&isEntry=&categoryType=in|out&limit=&offset=
niboDataRouter.get(
  '/api/data/nibo/schedules',
  asyncHandler(async (req, res) => {
    const { companyId, from, to, isPaid, isEntry, categoryType } = req.query
    if (!companyId) return res.status(400).json({ error: '"companyId" é obrigatório' })

    const { limit, offset } = pagination(req)
    const supabase = getSupabase()
    let query = supabase
      .from('nibo_schedules')
      .select('*', { count: 'exact' })
      .eq('company_id', String(companyId))
      .order('due_date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (from) query = query.gte('due_date', String(from))
    if (to) query = query.lte('due_date', String(to))
    if (isPaid !== undefined) query = query.eq('is_paid', isPaid === 'true')
    if (isEntry !== undefined) query = query.eq('is_entry', isEntry === 'true')
    if (categoryType) query = query.eq('category_type', String(categoryType))

    const { data, error, count } = await query
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data, count, limit, offset })
  }),
)

// GET /api/data/nibo/firm-customers
niboDataRouter.get(
  '/api/data/nibo/firm-customers',
  asyncHandler(async (_req, res) => {
    const supabase = getSupabase()
    const { data, error } = await supabase.from('nibo_firm_customers').select('*').order('name')
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data })
  }),
)

// GET /api/data/nibo/firm-tasks?date=YYYY-MM-DD
niboDataRouter.get(
  '/api/data/nibo/firm-tasks',
  asyncHandler(async (req, res) => {
    const { date } = req.query
    const supabase = getSupabase()
    let query = supabase.from('nibo_firm_tasks').select('*').order('dead_line', { ascending: true })
    if (date) query = query.eq('dead_line', String(date))
    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data })
  }),
)

// GET /api/data/nibo/sync-logs?companyId=&resource=
niboDataRouter.get(
  '/api/data/nibo/sync-logs',
  asyncHandler(async (req, res) => {
    const { companyId, resource } = req.query
    const { limit, offset } = pagination(req)
    const supabase = getSupabase()
    let query = supabase
      .from('sync_logs')
      .select('*')
      .eq('platform', 'nibo')
      .order('finished_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (companyId) query = query.eq('company_id', String(companyId))
    if (resource) query = query.eq('resource', String(resource))
    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data })
  }),
)
