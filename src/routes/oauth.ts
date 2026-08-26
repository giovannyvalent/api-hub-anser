// Authorization server OAuth mínimo — existe só porque o conector customizado
// do Claude exige OAuth 2.0 pra servidores MCP remotos (não aceita um header
// estático simples). O "login" aqui é uma única senha (a própria HUB_API_KEY);
// não há multi-usuário nem consentimento granular — é um servidor interno de
// uso único. O access_token emitido É a HUB_API_KEY: as ferramentas MCP
// continuam validando exatamente como antes (ver middleware/mcpAuth.ts).
import { Router } from 'express'
import { env } from '../config/env.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { createAuthCode, consumeAuthCode, verifyPkce } from '../oauth/store.js'

export const oauthRouter = Router()

function baseUrl(req: import('express').Request) {
  const proto = req.header('x-forwarded-proto') || req.protocol
  const host = req.header('x-forwarded-host') || req.header('host')
  return `${proto}://${host}`
}

// Só redireciona pra hosts que fazem sentido (Claude ou localhost em dev) —
// não é uma allowlist rígida de produto multi-tenant, é uma checagem simples
// contra open-redirect nesse endpoint público.
function isAllowedRedirect(uri: string): boolean {
  try {
    const u = new URL(uri)
    return u.hostname === 'claude.ai' || u.hostname.endsWith('.claude.ai') || u.hostname === 'localhost'
  } catch {
    return false
  }
}

oauthRouter.get(
  '/.well-known/oauth-authorization-server',
  asyncHandler(async (req, res) => {
    const base = baseUrl(req)
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256', 'plain'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    })
  }),
)

oauthRouter.get(
  '/.well-known/oauth-protected-resource',
  asyncHandler(async (req, res) => {
    const base = baseUrl(req)
    res.json({
      resource: `${base}/api/mcp`,
      authorization_servers: [base],
    })
  }),
)

// Dynamic Client Registration (RFC 7591) — aceita qualquer registro; não há
// distinção real de cliente nesse servidor de uso único, então não persiste
// nada, só devolve um client_id novo pra satisfazer clientes que exigem DCR.
oauthRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {}
    res.status(201).json({
      client_id: `anon-${Date.now().toString(36)}`,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: body.redirect_uris ?? [],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    })
  }),
)

function renderAuthorizeForm(params: Record<string, string>, error?: string) {
  const hidden = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}">`)
    .join('\n')
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Anser Data Hub — Autorizar</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  form{background:#1e293b;padding:32px;border-radius:12px;width:320px;box-shadow:0 10px 30px rgba(0,0,0,.3)}
  h1{font-size:18px;margin:0 0 4px}
  p{font-size:13px;color:#94a3b8;margin:0 0 20px}
  input[type=password]{width:100%;padding:10px 12px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:14px;box-sizing:border-box}
  button{width:100%;margin-top:16px;padding:10px;border-radius:8px;border:none;background:#7c3aed;color:white;font-weight:600;cursor:pointer;font-size:14px}
  button:hover{background:#6d28d9}
  .err{color:#f87171;font-size:12px;margin-top:8px}
</style></head>
<body>
  <form method="POST" action="/authorize">
    ${hidden}
    <h1>Anser Data Hub</h1>
    <p>Autorize o acesso somente-leitura aos dados do hub.</p>
    <input type="password" name="password" placeholder="Chave de acesso" autofocus required>
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
    <button type="submit">Autorizar</button>
  </form>
</body></html>`
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function authorizeParams(source: Record<string, unknown>) {
  return {
    response_type: String(source.response_type ?? 'code'),
    client_id: String(source.client_id ?? ''),
    redirect_uri: String(source.redirect_uri ?? ''),
    state: String(source.state ?? ''),
    code_challenge: String(source.code_challenge ?? ''),
    code_challenge_method: String(source.code_challenge_method ?? ''),
    scope: String(source.scope ?? ''),
  }
}

oauthRouter.get('/authorize', (req, res) => {
  const params = authorizeParams(req.query)
  if (!params.redirect_uri || !isAllowedRedirect(params.redirect_uri)) {
    return res.status(400).send('redirect_uri ausente ou não permitido')
  }
  res.type('html').send(renderAuthorizeForm(params))
})

oauthRouter.post(
  '/authorize',
  asyncHandler(async (req, res) => {
    const params = authorizeParams(req.body ?? {})
    if (!params.redirect_uri || !isAllowedRedirect(params.redirect_uri)) {
      return res.status(400).send('redirect_uri ausente ou não permitido')
    }

    const password = String((req.body ?? {}).password ?? '')
    if (password !== env.hubApiKey) {
      return res.status(401).type('html').send(renderAuthorizeForm(params, 'Chave incorreta.'))
    }

    const code = await createAuthCode({
      redirectUri: params.redirect_uri,
      codeChallenge: params.code_challenge || undefined,
      codeChallengeMethod: params.code_challenge_method || undefined,
      clientId: params.client_id || undefined,
    })

    const redirect = new URL(params.redirect_uri)
    redirect.searchParams.set('code', code)
    if (params.state) redirect.searchParams.set('state', params.state)
    res.redirect(302, redirect.toString())
  }),
)

oauthRouter.post(
  '/token',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {}
    const grantType = body.grant_type

    if (grantType === 'authorization_code') {
      const authCode = await consumeAuthCode(String(body.code ?? ''))
      if (!authCode) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'Código inválido ou expirado' })
      }
      if (!verifyPkce(body.code_verifier ? String(body.code_verifier) : undefined, authCode.codeChallenge, authCode.codeChallengeMethod)) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE inválido' })
      }
      return res.json({
        access_token: env.hubApiKey,
        token_type: 'Bearer',
        expires_in: 31536000,
        refresh_token: env.hubApiKey,
      })
    }

    if (grantType === 'refresh_token') {
      // Token estático — só reemite o mesmo access_token.
      return res.json({ access_token: env.hubApiKey, token_type: 'Bearer', expires_in: 31536000 })
    }

    res.status(400).json({ error: 'unsupported_grant_type' })
  }),
)
