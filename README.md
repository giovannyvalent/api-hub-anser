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
  guarda os dados extraídos. Uma tabela por recurso/plataforma. Ver
  [src/db/schema.sql](src/db/schema.sql).
- **Credenciais por empresa+plataforma** ficam em `integration_credentials`
  (ex: token Nibo de cada empresa-cliente). Nunca são retornadas pela API de
  leitura — só o backend as usa para chamar a plataforma de origem.
- **Sync em dois níveis** (ver seção "Sync" abaixo): incremental (rápido,
  alta frequência) e full (lento, cadastros + histórico amplo).

### Duas credenciais Nibo diferentes

A Anser usa duas APIs do Nibo, com autenticações distintas:

1. **API "empresas"** (`api.nibo.com.br/empresas/v1/...`, header `apitoken`) —
   um token por empresa-cliente. Fica salvo em `integration_credentials`
   (`platform = 'nibo'`, `credentials = { "apiToken": "..." }`). Cobre quase
   todos os dados financeiros: contas, saldo, extrato, categorias, centros de
   custo, contas a pagar/receber, clientes/fornecedores/sócios/funcionários,
   perfil da empresa.
2. **API "accountant"** (`api.nibo.com.br/accountant/api/v1/...`, header
   `X-API-Key`) — uma única credencial do escritório contábil da Anser
   (`NIBO_ACCOUNTANT_API_KEY` + `NIBO_ACCOUNTANT_FIRM_ID`, env vars globais).
   Usado para `customers` (empresas cadastradas no Nibo Contador) e `tasks`
   (obrigações/tarefas do escritório).

## Mapeamento completo dos endpoints Nibo consumidos

Todos os campos abaixo foram validados com chamadas reais à API (não só a
documentação), então os nomes de campo no schema (`src/db/schema.sql`)
refletem o formato de resposta real do Nibo.

### API "empresas" (por empresa-cliente, header `apitoken`)

| Recurso | Endpoint | Tabela | Chave |
|---|---|---|---|
| Contas bancárias | `GET /accounts` | `nibo_accounts` | `nibo_id` (=`id`) |
| Saldo por conta | `GET /accounts/views/balance` | `nibo_account_balances` (snapshot histórico, append-only) | — |
| Extrato/ledger real | `GET /accounts/{accountId}/views/statement?startDate&endDate` | `nibo_statement` | `entry_key` (=`entryId`, ou `start-<index>` quando não há) |
| Categorias | `GET /categories` | `nibo_categories` | `nibo_id` (=`id`) |
| Centros de custo | `GET /costcenters` | `nibo_cost_centers` | `nibo_id` (=`costCenterId`, **não** `id`) |
| Clientes | `GET /customers` | `nibo_stakeholders` (`kind='customer'`) | `nibo_id` (=`id`) |
| Fornecedores | `GET /suppliers` | `nibo_stakeholders` (`kind='supplier'`) | `nibo_id` |
| Sócios | `GET /partners` | `nibo_stakeholders` (`kind='partner'`) | `nibo_id` |
| Funcionários | `GET /employees` | `nibo_stakeholders` (`kind='employee'`) | `nibo_id` |
| Perfil da empresa | `GET /organizations` | `nibo_organization` (1 linha por empresa) | `company_id` |
| Contas a pagar | `GET /schedules/debit` | `nibo_schedules` (`type='Debit'`) | `nibo_id` (=`scheduleId`, **não** `id`) |
| Contas a receber | `GET /schedules/credit` | `nibo_schedules` (`type='Credit'`) | `nibo_id` |

`customers`/`suppliers`/`partners`/`employees` retornam exatamente a mesma
forma na API do Nibo — por isso foram unificados em uma única tabela
`nibo_stakeholders` com a coluna `kind` (em vez de 4 tabelas quase idênticas).

`schedules/debit` e `schedules/credit` trazem `categories[]`/`costCenters[]`
(rateio, quando o lançamento é dividido entre várias categorias/CCs) e
`recurrence` (recorrência) — guardados como jsonb (`categories_split`,
`cost_centers_split`, `recurrence`) além dos campos "principais" já
normalizados em colunas.

### API "accountant" (nível escritório, header `X-API-Key`)

| Recurso | Endpoint | Tabela |
|---|---|---|
| Empresas-cliente cadastradas no Nibo Contador | `GET /accountingfirms/{firmId}/customers` | `nibo_firm_customers` |
| Tarefas/obrigações do escritório | `GET /accountingfirms/{firmId}/tasks?$filter=deadLine eq {data}` | `nibo_firm_tasks` |

### Fora do escopo (deliberadamente)

O hub é **somente leitura/extração** — não implementa os endpoints de
escrita do Nibo (criar/editar/excluir conta, transferência, cliente, nota
fiscal, cobrança, conciliação manual, upload de arquivo, etc.). Se algum dia
for necessário escrever de volta no Nibo, é um projeto à parte — misturar
escrita num hub de BI é arriscado (BI acidentalmente alterando dados
financeiros reais).

## Sync — dois níveis

**Incremental** (`syncCompanyNiboIncremental`, rotas
`POST /api/sync/nibo/:companyId/incremental` e cron
`GET /api/cron/sync-nibo-financial`): roda com alta frequência (alvo: a cada
5 minutos). Só financeiro:
- `schedules/debit` e `schedules/credit` filtrados por `updateDate ge <cursor>`
  — o Nibo atualiza esse campo em qualquer mudança (novo lançamento, baixa de
  pagamento, edição). O cursor fica salvo em `sync_state` por empresa+recurso;
  sem cursor prévio, olha os últimos 3 dias.
- `account_balances` — sempre busca tudo (é uma lista pequena), grava um
  snapshot novo (histórico de saldo ao longo do tempo).
- `statement` — janela curta (últimos 3 dias) por conta ativa.

**Full** (`syncCompanyNiboFull`, rotas `POST /api/sync/nibo/:companyId/full`
e cron `GET /api/cron/sync-nibo-full`): roda com baixa frequência (alvo:
1x/dia). Cadastros (accounts, categories, cost_centers, stakeholders,
organization) + histórico financeiro amplo (24 meses para trás e para
frente) + dados de escritório (firm customers/tasks).

Rode o full manualmente depois de cadastrar uma empresa nova (para
popular o histórico) — depois disso o incremental mantém tudo atualizado.

### ⚠️ Cron de 5 em 5 minutos e o plano da Vercel

O plano **Hobby** da Vercel só permite crons com frequência de **1x/dia**.
Para rodar `/api/cron/sync-nibo-financial` de fato a cada 5 minutos como
configurado em `vercel.json`, o projeto precisa estar no plano **Pro** (ou
superior). Duas opções se for ficar no Hobby:
1. Fazer upgrade do projeto na Vercel para Pro.
2. Manter `vercel.json` só com o cron diário (full) e disparar o incremental
   de fora, com um scheduler externo gratuito (ex: [cron-job.org](https://cron-job.org),
   GitHub Actions com `schedule`, EasyCron) fazendo
   `GET https://<seu-hub>.vercel.app/api/cron/sync-nibo-financial` a cada 5
   min com o header `Authorization: Bearer <CRON_SECRET>`.

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
(Settings → Environment Variables). Veja a seção acima sobre o plano
necessário para o cron de 5 minutos funcionar de verdade.

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

# 3. Rodar o full sync (popula o histórico) — depois disso o incremental assume
curl -X POST https://<seu-hub>.vercel.app/api/sync/nibo/<companyId>/full \
  -H "x-api-key: $HUB_API_KEY"

# 4. Consumir os dados extraídos (o BI faz isso)
curl "https://<seu-hub>.vercel.app/api/data/nibo/schedules?companyId=<companyId>&type=Debit&from=2026-01-01&to=2026-12-31" \
  -H "x-api-key: $HUB_API_KEY"
```

## Rotas

Todas exigem `x-api-key: <HUB_API_KEY>`, exceto `/api/health` e `/api/cron/*`
(que usam `CRON_SECRET` — ver `src/middleware/cronAuth.ts`).

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
- `POST /api/sync/nibo/:companyId/full` — cadastros + histórico amplo (uma empresa)
- `POST /api/sync/nibo/:companyId/incremental` — só financeiro, janela curta (uma empresa)
- `POST /api/sync/nibo/full` — full em todas as empresas com credencial ativa
- `POST /api/sync/nibo/incremental` — incremental em todas as empresas com credencial ativa
- `POST /api/sync/nibo-firm` — customers/tasks do escritório
- `GET /api/cron/sync-nibo-financial` — alvo do cron de 5 min (incremental, todas as empresas)
- `GET /api/cron/sync-nibo-full` — alvo do cron diário (full, todas as empresas + escritório)

**Dados (o BI consome estas)**
- `GET /api/data/nibo/accounts?companyId=&includeArchived=`
- `GET /api/data/nibo/account-balances?companyId=&accountId=&latest=true|false`
- `GET /api/data/nibo/statement?companyId=&accountId=&from=&to=&limit=&offset=`
- `GET /api/data/nibo/categories?companyId=&type=in|out`
- `GET /api/data/nibo/cost-centers?companyId=`
- `GET /api/data/nibo/stakeholders?companyId=&kind=customer|supplier|partner|employee`
- `GET /api/data/nibo/organization?companyId=`
- `GET /api/data/nibo/schedules?companyId=&from=&to=&isPaid=&type=Debit|Credit&categoryType=in|out&limit=&offset=`
- `GET /api/data/nibo/firm-customers`
- `GET /api/data/nibo/firm-tasks?date=YYYY-MM-DD`
- `GET /api/data/nibo/sync-logs?companyId=&resource=`

## Adicionar uma nova plataforma (ex: Omie)

Siga o padrão já usado pelo Nibo:

1. `src/integrations/omie/client.ts` — implementar os métodos reais (esqueleto
   já criado, com os endpoints documentados em comentário).
2. `src/integrations/omie/sync.ts` — copiar o padrão de
   `src/integrations/nibo/sync.ts` (`runResource` + `logSync` + upsert por tabela,
   com a mesma separação full/incremental se fizer sentido para o volume de dados).
3. `src/db/schema.sql` — criar as tabelas `omie_<recurso>`.
4. `src/routes/sync.ts`, `src/routes/cron.ts` e `src/routes/data/omie.ts` — expor as rotas.
5. `vercel.json` — adicionar os crons correspondentes.
