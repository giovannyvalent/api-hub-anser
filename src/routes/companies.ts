import { Router } from 'express'
import { getSupabase } from '../lib/supabase.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { listCompanies } from '../data/nibo.js'

export const companiesRouter = Router()

// GET /api/companies?active=true
// Cada empresa vem com "platforms": string[] (ex: ["nibo"]) — quais sistemas
// ela tem credencial ativa, sem nunca expor o token.
companiesRouter.get(
  '/api/companies',
  asyncHandler(async (req, res) => {
    const active = req.query.active !== undefined ? req.query.active === 'true' : undefined
    const data = await listCompanies({ active })
    res.json({ data })
  }),
)

// POST /api/companies  { name, nibo_customer_id?, notes? }
companiesRouter.post(
  '/api/companies',
  asyncHandler(async (req, res) => {
    const { name, nibo_customer_id, notes } = req.body ?? {}
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: '"name" é obrigatório' })
    }
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('companies')
      .insert({ name, nibo_customer_id: nibo_customer_id ?? null, notes: notes ?? null })
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    res.status(201).json({ data })
  }),
)

// PATCH /api/companies/:id
companiesRouter.patch(
  '/api/companies/:id',
  asyncHandler(async (req, res) => {
    const { name, nibo_customer_id, notes, active } = req.body ?? {}
    const patch: Record<string, unknown> = {}
    if (name !== undefined) patch.name = name
    if (nibo_customer_id !== undefined) patch.nibo_customer_id = nibo_customer_id
    if (notes !== undefined) patch.notes = notes
    if (active !== undefined) patch.active = active

    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('companies')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    if (!data) return res.status(404).json({ error: 'Company não encontrada' })
    res.json({ data })
  }),
)

// DELETE /api/companies/:id
companiesRouter.delete(
  '/api/companies/:id',
  asyncHandler(async (req, res) => {
    const supabase = getSupabase()
    const { error } = await supabase.from('companies').delete().eq('id', req.params.id)
    if (error) return res.status(500).json({ error: error.message })
    res.status(204).send()
  }),
)
