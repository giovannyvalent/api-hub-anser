-- ============================================================================
-- Anser Data Hub — schema do Supabase dedicado
-- Rode este arquivo inteiro no SQL Editor do projeto Supabase novo (dedicado
-- ao hub, separado do Supabase do anser-sete-insight).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- companies: cadastro das empresas-cliente da Anser dentro do hub.
-- Independente da tabela "companies" do anser-sete-insight (bancos separados).
-- nibo_customer_id referencia o id do "customer" retornado pela API accountant
-- do Nibo (GET /accountant/api/v1/accountingfirms/{firmId}/customers).
-- ----------------------------------------------------------------------------
create table if not exists public.companies (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  nibo_customer_id  text,
  active            boolean not null default true,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists companies_nibo_customer_id_key
  on public.companies (nibo_customer_id)
  where nibo_customer_id is not null;

-- ----------------------------------------------------------------------------
-- integration_credentials: credenciais por empresa+plataforma.
-- Para o Nibo, credentials = { "apiToken": "..." } (token da API "empresas",
-- por empresa-cliente). Para o Omie, credentials = { "appKey": "...", "appSecret": "..." }.
-- Nunca é exposta via API de leitura pública do hub — só o backend lê o token.
-- ----------------------------------------------------------------------------
create table if not exists public.integration_credentials (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  platform      text not null check (platform in ('nibo', 'omie')),
  credentials   jsonb not null default '{}'::jsonb,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, platform)
);

-- ----------------------------------------------------------------------------
-- sync_logs: histórico de execuções de sincronização (manual ou via cron).
-- company_id nulo = sync em nível de escritório (ex: nibo_firm_customers/tasks).
-- ----------------------------------------------------------------------------
create table if not exists public.sync_logs (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references public.companies(id) on delete cascade,
  platform        text not null,
  resource        text not null,
  mode            text not null default 'full', -- 'full' | 'incremental'
  status          text not null check (status in ('success', 'error')),
  records_synced  integer not null default 0,
  error_message   text,
  started_at      timestamptz not null,
  finished_at     timestamptz not null default now()
);

create index if not exists sync_logs_company_platform_idx
  on public.sync_logs (company_id, platform, finished_at desc);

-- ----------------------------------------------------------------------------
-- sync_state: cursor por empresa+recurso, usado pelo sync incremental (a cada
-- poucos minutos) para buscar só o que mudou desde a última execução com
-- sucesso (filtro updateDate ge <last_synced_at> na API do Nibo).
-- ----------------------------------------------------------------------------
create table if not exists public.sync_state (
  company_id      uuid not null references public.companies(id) on delete cascade,
  platform        text not null,
  resource        text not null,
  last_synced_at  timestamptz not null,
  primary key (company_id, platform, resource)
);

-- ============================================================================
-- Nibo — API "empresas" (por empresa-cliente, um apiToken por empresa)
-- ============================================================================

create table if not exists public.nibo_accounts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  nibo_id       text not null,
  name          text not null default '',
  type          text default '',
  bank_id       text,
  bank_name     text default '',
  bank_agency   text default '',
  bank_account  text default '',
  is_virtual    boolean not null default false,
  is_reconcilable boolean not null default true,
  is_archived   boolean not null default false,
  is_automated  boolean not null default false,
  is_open_finance boolean not null default false,
  raw           jsonb not null default '{}'::jsonb,
  synced_at     timestamptz not null default now(),
  unique (company_id, nibo_id)
);

-- Snapshot de saldo por conta — append-only (histórico ao longo do tempo, não
-- upsert), alimentado a cada sync incremental (5 min). O BI usa isso para
-- gráfico de saldo diário/intradiário por conta.
create table if not exists public.nibo_account_balances (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  account_nibo_id       text not null,
  account_name          text default '',
  balance               numeric(14,2) default 0,
  bank_balance          numeric(14,2) default 0,
  bank_balance_changed_at timestamptz,
  pending_reconciliation_count integer default 0,
  total_open_reconciliations   integer default 0,
  raw                   jsonb not null default '{}'::jsonb,
  synced_at             timestamptz not null default now()
);

create index if not exists nibo_account_balances_lookup_idx
  on public.nibo_account_balances (company_id, account_nibo_id, synced_at desc);

-- Extrato real (ledger) de cada conta — GET /accounts/{id}/views/statement.
-- Diferente de nibo_schedules: aqui é o que de fato passou na conta.
create table if not exists public.nibo_statement (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  account_nibo_id   text not null,
  entry_key         text not null, -- entryId do Nibo, ou "start-<index>" quando não há entryId (ex: saldo inicial)
  entry_index       integer,
  value             numeric(14,2) default 0,
  entry_date        date,
  current_balance   numeric(14,2) default 0,
  is_transfer       boolean not null default false,
  transfer_id       text,
  type              text default '', -- "StartAccountBalance" | "Transfer" | "Entry" | ...
  is_reconciliated  boolean not null default false,
  description       text default '',
  category_id       text,
  category_name     text default '',
  stakeholder_id    text,
  stakeholder_name  text default '',
  raw               jsonb not null default '{}'::jsonb,
  synced_at         timestamptz not null default now(),
  unique (company_id, account_nibo_id, entry_key)
);

create index if not exists nibo_statement_company_date_idx
  on public.nibo_statement (company_id, account_nibo_id, entry_date desc);

create table if not exists public.nibo_categories (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  nibo_id       text not null,
  name          text not null default '',
  type          text, -- 'in' | 'out'
  order_index   integer,
  group_id      text,
  group_name    text default '',
  group_type    integer,
  subgroup_id   text,
  subgroup_name text default '',
  is_deleted    boolean not null default false,
  raw           jsonb not null default '{}'::jsonb,
  synced_at     timestamptz not null default now(),
  unique (company_id, nibo_id)
);

create table if not exists public.nibo_cost_centers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  nibo_id     text not null, -- costCenterId no Nibo
  name        text not null default '', -- "description" no Nibo
  is_deleted  boolean not null default false,
  raw         jsonb not null default '{}'::jsonb,
  synced_at   timestamptz not null default now(),
  unique (company_id, nibo_id)
);

-- Unifica customers / suppliers / partners / employees: a API do Nibo retorna
-- exatamente a mesma forma para os quatro, só o endpoint (e o campo "type")
-- muda. "kind" aqui é o que dispara qual endpoint foi chamado.
create table if not exists public.nibo_stakeholders (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  kind              text not null check (kind in ('customer', 'supplier', 'partner', 'employee')),
  nibo_id           text not null,
  name              text not null default '',
  document_number   text default '',
  document_type     text default '',
  email             text default '',
  is_company        boolean not null default false,
  is_archived       boolean not null default false,
  is_deleted        boolean not null default false,
  address           jsonb not null default '{}'::jsonb,
  bank_account_info jsonb not null default '{}'::jsonb,
  raw               jsonb not null default '{}'::jsonb,
  synced_at         timestamptz not null default now(),
  unique (company_id, kind, nibo_id)
);

create index if not exists nibo_stakeholders_company_kind_idx
  on public.nibo_stakeholders (company_id, kind);

-- Contas a pagar (type='Debit', endpoint /schedules/debit) e a receber
-- (type='Credit', endpoint /schedules/credit). categories_split/cost_centers_split
-- guardam o rateio (quando o lançamento é dividido entre múltiplas categorias/CCs).
create table if not exists public.nibo_schedules (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  nibo_id             text not null, -- scheduleId no Nibo
  type                text not null, -- 'Debit' | 'Credit'
  schedule_date       date,
  due_date            date,
  accrual_date        date, -- competência
  description         text default '',
  reference           text default '',
  value               numeric(14,2) default 0,
  open_value          numeric(14,2) default 0,
  paid_value          numeric(14,2) default 0,
  is_paid             boolean not null default false,
  is_entry            boolean,
  is_bill             boolean not null default false,
  is_debit_note       boolean not null default false,
  is_flagged          boolean not null default false,
  is_dued             boolean not null default false,
  category_id         text,
  category_name       text default '',
  category_type       text, -- 'in' | 'out'
  categories_split     jsonb not null default '[]'::jsonb,
  cost_center_id      text,
  cost_center_name    text default '',
  cost_centers_split   jsonb not null default '[]'::jsonb,
  stakeholder_id      text,
  stakeholder_name    text default '',
  stakeholder_type    text default '',
  stakeholder_document text default '',
  has_installment     boolean not null default false,
  has_recurrence      boolean not null default false,
  recurrence          jsonb,
  has_invoice         boolean not null default false,
  is_payment_scheduled boolean not null default false,
  create_date         timestamptz,
  create_user         text default '',
  update_date         timestamptz,
  update_user         text default '',
  raw                 jsonb not null default '{}'::jsonb,
  synced_at           timestamptz not null default now(),
  unique (company_id, nibo_id)
);

create index if not exists nibo_schedules_company_due_date_idx
  on public.nibo_schedules (company_id, due_date);
create index if not exists nibo_schedules_update_date_idx
  on public.nibo_schedules (company_id, update_date desc);

-- Perfil da empresa no Nibo (GET /organizations) — um registro por empresa.
create table if not exists public.nibo_organization (
  company_id          uuid primary key references public.companies(id) on delete cascade,
  organization_id     text not null,
  name                text not null default '',
  cnpj                text default '',
  plan                text default '',
  subscription_plan   text default '',
  accountant_id       text default '',
  accountant_name     text default '',
  features            jsonb not null default '[]'::jsonb,
  users               jsonb not null default '[]'::jsonb,
  raw                 jsonb not null default '{}'::jsonb,
  synced_at           timestamptz not null default now()
);

-- ============================================================================
-- Nibo — API "accountant" (nível escritório, credencial única da Anser)
-- ============================================================================

create table if not exists public.nibo_firm_customers (
  id               uuid primary key default gen_random_uuid(),
  nibo_id          text not null unique,
  name             text not null default '',
  document_number  text default '',
  code             text default '',
  raw              jsonb not null default '{}'::jsonb,
  synced_at        timestamptz not null default now()
);

create table if not exists public.nibo_firm_tasks (
  id                    uuid primary key default gen_random_uuid(),
  nibo_id               text not null unique,
  name                  text not null default '',
  description           text default '',
  dead_line             date,
  status                integer,
  completed_at          timestamptz,
  customer_id           text,
  customer_name         text default '',
  in_charge_user_id     text,
  in_charge_user_name   text default '',
  raw                   jsonb not null default '{}'::jsonb,
  synced_at             timestamptz not null default now()
);

create index if not exists nibo_firm_tasks_dead_line_idx
  on public.nibo_firm_tasks (dead_line);

-- ============================================================================
-- Omie — placeholder. Estrutura real a definir quando tivermos credenciais
-- e o mapeamento de campos da API do Omie. Mantido aqui só para reservar o
-- padrão de nomenclatura (omie_<recurso>) usado pelo restante do hub.
-- ============================================================================

-- create table if not exists public.omie_clientes ( ... );

-- ============================================================================
-- updated_at automático em companies / integration_credentials
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on public.companies;
create trigger set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.integration_credentials;
create trigger set_updated_at
  before update on public.integration_credentials
  for each row execute function public.set_updated_at();

-- Nota: este Supabase é acessado exclusivamente pelo backend do hub via
-- SUPABASE_SERVICE_ROLE_KEY (nunca pelo browser), então RLS não é habilitado
-- aqui de propósito — o controle de acesso é feito pela HUB_API_KEY na API.
