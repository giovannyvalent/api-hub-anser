import crypto from 'node:crypto'
import { getSupabase } from '../lib/supabase.js'

const CODE_TTL_MS = 5 * 60 * 1000 // 5 minutos — só o tempo do handshake

export interface AuthCode {
  code: string
  redirectUri: string
  codeChallenge?: string
  codeChallengeMethod?: string
  clientId?: string
}

export async function createAuthCode(params: {
  redirectUri: string
  codeChallenge?: string
  codeChallengeMethod?: string
  clientId?: string
}): Promise<string> {
  const code = crypto.randomBytes(32).toString('base64url')
  const supabase = getSupabase()
  const { error } = await supabase.from('oauth_codes').insert({
    code,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge ?? null,
    code_challenge_method: params.codeChallengeMethod ?? null,
    client_id: params.clientId ?? null,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
  if (error) throw new Error(error.message)
  return code
}

// Consome o código (uso único) — retorna null se não existir/expirado.
export async function consumeAuthCode(code: string): Promise<AuthCode | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase.from('oauth_codes').select('*').eq('code', code).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null

  await supabase.from('oauth_codes').delete().eq('code', code)

  if (new Date((data as any).expires_at).getTime() < Date.now()) return null

  return {
    code,
    redirectUri: (data as any).redirect_uri,
    codeChallenge: (data as any).code_challenge ?? undefined,
    codeChallengeMethod: (data as any).code_challenge_method ?? undefined,
    clientId: (data as any).client_id ?? undefined,
  }
}

export function verifyPkce(codeVerifier: string | undefined, challenge: string | undefined, method: string | undefined): boolean {
  if (!challenge) return true // fluxo sem PKCE
  if (!codeVerifier) return false
  if (method === 'plain') return codeVerifier === challenge
  // default/'S256'
  const hash = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  return hash === challenge
}
