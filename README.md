# Anser Data Hub

HUB de API da Anser: extrai dados de plataformas externas (Nibo, Omie, ...),
armazena no Supabase (um schema/tabelas por integração) e expõe rotas
("conectores") para o BI da Anser consumir por empresa e período.

```
Plataforma (Nibo, Omie, ...) → extração/sync → Supabase (deste hub) → API REST → BI
```

Projeto isolado — não compartilha código nem banco com o `anser-sete-insight`
(front-end) nem com nenhum outro projeto já em produção.

## Arquitetura

- **Express** rodando como função serverless única na Vercel (`api/index.ts`
  exporta o app; `vercel.json` reescreve todas as rotas para essa função —
  mesmo padrão do [exemplo oficial Vercel+Express](https://github.com/vercel/examples/tree/main/solutions/express)).
- **Supabase** dedicado (projeto novo, separado de qualquer outro já existente)
  guarda os dados extraídos. Uma tabela por recurso/plataforma
  (`nibo_accounts`, `nibo_schedules`, `nibo_firm_customers`, futuramente
  `omie_*`, etc). Ver [src/db/schema.sql](src/db/schema.sql).
- **Credenciais por empresa+plataforma** ficam em `integration_credentials`
  (ex: token Nibo de cada empresa-cliente). Nunca são retornadas pela API de
  leitura — só o backend as usa para chamar a plataforma de origem.
- **Sync**: manual via rota POST, ou automático via Vercel Cron
  (`/api/cron/sync-nibo`, configurado em `vercel.json`).

### Duas credenciais Nibo diferentes

A Anser usa duas APIs do Nibo, com autenticações distintas:

1. **API "empresas"** (`api.nibo.com.br/empresas/v1/...`, header `apitoken`) —
   um token por empresa-cliente. Fica salvo em `integration_credentials`
   (`platform = 'nibo'`, `credentials = { "apiToken": "..." }`). Usado para
   `accounts`, `categories`, `costcenters`, `schedules`.
2. **API "accountant"** (`api.nibo.com.br/accountant/api/v1/...`, header
   `X-API-Key`) — uma única credencial do escritório contábil da Anser
   (`NIBO_ACCOUNTANT_API_KEY` + `NIBO_ACCOUNTANT_FIRM_ID`, env vars globais).
   Usado para `customers` (empresas cadastradas no Nibo Contador) e `tasks`.

## Setup

### 1. Criar o Supabase dedicado

Crie um projeto Supabase novo (não reaproveite nenhum outro) e rode o
conteúdo de [src/db/schema.sql](src/db/schema.sql) no SQL Editor.

### 2. Variáveis de ambiente

```
cp .env.example .env
```

Preencha:

| Variável | Descrição |
|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | do projeto Supabase criado no passo 1 |
| `HUB_API_KEY` | chave que o BI (e você) usam no header `x-api-key` para chamar o hub. Gere algo aleatório forte |
| `CRON_SECRET` | mesmo valor deve ser configurado no dashboard da Vercel ("Cron Job protection") |
| `NIBO_ACCOUNTANT_API_KEY` / `NIBO_ACCOUNTANT_FIRM_ID` | credencial única do escritório (opcional — só necessário para sincronizar `firm-customers`/`firm-tasks`) |

### 3. Instalar e rodar localmente

```
npm install
npm run dev
```

Sobe em `http://localhost:3333`. Todas as rotas exceto `/api/health` exigem
o header `x-api-key: <HUB_API_KEY>`.

### 4. Deploy na Vercel

```
vercel
```

Configure as mesmas env vars do `.env` no dashboard do projeto Vercel
(Settings → Environment Variables). O cron definido em `vercel.json`
(`/api/cron/sync-nibo`) roda 1x/dia às 6h UTC por padrão — no plano **Hobby**
a Vercel só permite crons diários; se o projeto for **Pro**, pode aumentar a
frequência editando o `schedule` em `vercel.json`.

## Uso — cadastrar uma empresa e sincronizar

```bash
# 1. Criar a empresa no hub
curl -X POST https://<seu-hub>.vercel.app/api/companies \
  -H "x-api-key: $HUB_API_KEY" -H "Content-Type: application/json" \
  -d '{"name": "Empresa Exemplo Ltda"}'
# -> retorna { data: { id: "<companyId>", ... } }

# 2. Salvar o token Nibo dessa empresa
curl -X POST https://<seu-hub>.vercel.app/api/credentials \
  -H "x-api-key: $HUB_API_KEY" -H "Content-Type: application/json" \
  -d '{"companyId": "<companyId>", "platform": "nibo", "credentials": {"apiToken": "<token-nibo-da-empresa>"}}'

# 3. Disparar o sync manualmente (ou esperar o cron)
curl -X POST https://<seu-hub>.vercel.app/api/sync/nibo/<companyId> \
  -H "x-api-key: $HUB_API_KEY"

# 4. Consumir os dados extraídos (o BI faz isso)
curl "https://<seu-hub>.vercel.app/api/data/nibo/schedules?companyId=<companyId>&from=2026-01-01&to=2026-12-31" \
  -H "x-api-key: $HUB_API_KEY"
```

## Rotas

Todas exigem `x-api-key: <HUB_API_KEY>`, exceto `/api/health`.

**Empresas**
- `GET /api/companies`
- `POST /api/companies` `{ name, nibo_customer_id?, notes? }`
- `PATCH /api/companies/:id`
- `DELETE /api/companies/:id`

**Credenciais**
- `GET /api/credentials?companyId=&platform=` (nunca retorna o token, só metadados)
- `POST /api/credentials` `{ companyId, platform, credentials, active? }`
- `DELETE /api/credentials/:id`

**Sync (grava no Supabase)**
- `POST /api/sync/nibo/:companyId` — sincroniza uma empresa
- `POST /api/sync/nibo` — sincroniza todas as empresas com credencial ativa
- `POST /api/sync/nibo-firm` — sincroniza customers/tasks do escritório
- `GET /api/cron/sync-nibo` — alvo do Vercel Cron (auth via `CRON_SECRET`, não `x-api-key`)

**Dados (o BI consome estas)**
- `GET /api/data/nibo/accounts?companyId=&includeArchived=`
- `GET /api/data/nibo/categories?companyId=&type=in|out`
- `GET /api/data/nibo/cost-centers?companyId=`
- `GET /api/data/nibo/schedules?companyId=&from=&to=&isPaid=&isEntry=&categoryType=&limit=&offset=`
- `GET /api/data/nibo/firm-customers`
- `GET /api/data/nibo/firm-tasks?date=YYYY-MM-DD`
- `GET /api/data/nibo/sync-logs?companyId=&resource=`

## Adicionar uma nova plataforma (ex: Omie)

Siga o padrão já usado pelo Nibo:

1. `src/integrations/omie/client.ts` — implementar os métodos reais (esqueleto
   já criado, com os endpoints documentados em comentário).
2. `src/integrations/omie/sync.ts` — copiar o padrão de
   `src/integrations/nibo/sync.ts` (`runResource` + `logSync` + upsert por tabela).
3. `src/db/schema.sql` — criar as tabelas `omie_<recurso>`.
4. `src/routes/sync.ts` e `src/routes/data/omie.ts` — expor as rotas de sync e leitura.
5. `vercel.json` — adicionar um cron `/api/cron/sync-omie`, se quiser automático.
