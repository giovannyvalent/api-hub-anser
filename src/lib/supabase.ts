import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from '../config/env.js'

// Sem um "Database" gerado (supabase gen types), tipamos como "any" nas
// tabelas para não perder produtividade com generics — as rotas validam o
// shape dos dados manualmente antes de gravar.
let _client: SupabaseClient<any, any, any> | null = null

export function getSupabase(): SupabaseClient<any, any, any> {
  if (!_client) {
    _client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false },
    })
  }
  return _client
}
