import { Router } from 'express'
import { getSupabase } from '../lib/supabase.js'
import { asyncHandler } from '../middleware/errorHandler.js'

export const credentialsRouter = Router()

const PLATFORMS = ['nibo', 'omie']

// GET /api/credentials?companyId=&platform=
// Nunca retorna o conteúdo de "credentials" (token/appSecret) — só metadados.
credentialsRouter.get(
  '/api/credentials',
  asyncHandler(async (req, res) => {
    const supabase = getSupabase()
    let query = supabase
      .from('integration_credentials')
      .select('id, company_id, platform, active, created_at, updated_at')
      .order('created_at', { ascending: false })

    if (req.query.companyId) query = query.eq('company_id', String(req.query.companyId))
    if (req.query.platform) query = query.eq('platform', String(req.query.platform))

    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    res.json({ data })
  }),
)

// POST /api/credentials  { companyId, platform, credentials: {...}, active? }
// Upsert por (company_id, platform). Para o Nibo: credentials = { apiToken }.
credentialsRouter.post(
  '/api/credentials',
  asyncHandler(async (req, res) => {
    const { companyId, platform, credentials, active } = req.body ?? {}
    if (!companyId || !platform) {
      return res.status(400).json({ error: '"companyId" e "platform" são obrigatórios' })
    }
    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ error: `"platform" deve ser um de: ${PLATFORMS.join(', ')}` })
    }
    if (!credentials || typeof credentials !== 'object') {
      return res.status(400).json({ error: '"credentials" é obrigatório (objeto)' })
    }

    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('integration_credentials')
      .upsert(
        {
          company_id: companyId,
          platform,
          credentials,
          active: active ?? true,
        },
        { onConflict: 'company_id,platform' },
      )
      .select('id, company_id, platform, active, created_at, updated_at')
      .single()

    if (error) return res.status(500).json({ error: error.message })
    res.status(201).json({ data })
  }),
)

// DELETE /api/credentials/:id
credentialsRouter.delete(
  '/api/credentials/:id',
  asyncHandler(async (req, res) => {
    const supabase = getSupabase()
    const { error } = await supabase.from('integration_credentials').delete().eq('id', req.params.id)
    if (error) return res.status(500).json({ error: error.message })
    res.status(204).send()
  }),
)
