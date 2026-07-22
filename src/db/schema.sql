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
-- company_id nulo = sync em nível de escritório (ex: nibo_customers, nibo_tasks).
-- ----------------------------------------------------------------------------
create table if not exists public.sync_logs (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references public.companies(id) on delete cascade,
  platform        text not null,
  resource        text not null,
  status          text not null check (status in ('success', 'error')),
  records_synced  integer not null default 0,
  error_message   text,
  started_at      timestamptz not null,
  finished_at     timestamptz not null default now()
);

create index if not exists sync_logs_company_platform_idx
  on public.sync_logs (company_id, platform, finished_at desc);

-- ============================================================================
-- Nibo — API "empresas" (por empresa-cliente, um apiToken por empresa)
-- ============================================================================

create table if not exists public.nibo_accounts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  nibo_id     text not null,
  name        text not null default '',
  bank_name   text default '',
  type        text default '',
  is_archived boolean not null default false,
  raw         jsonb not null default '{}'::jsonb,
  synced_at   timestamptz not null default now(),
  unique (company_id, nibo_id)
);

create table if not exists public.nibo_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  nibo_id     text not null,
  name        text not null default '',
  type        text, -- 'in' | 'out'
  parent_id   text,
  is_deleted  boolean not null default false,
  raw         jsonb not null default '{}'::jsonb,
  synced_at   timestamptz not null default now(),
  unique (company_id, nibo_id)
);

create table if not exists public.nibo_cost_centers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  nibo_id     text not null,
  name        text not null default '',
  is_deleted  boolean not null default false,
  raw         jsonb not null default '{}'::jsonb,
  synced_at   timestamptz not null default now(),
  unique (company_id, nibo_id)
);

-- Contas a pagar/receber (schedules) e extrato (schedules/debit) — mesma forma.
create table if not exists public.nibo_schedules (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  nibo_id             text not null,
  schedule_date       date,
  due_date            date,
  description         text default '',
  value               numeric(14,2) default 0,
  open_value          numeric(14,2) default 0,
  paid_value          numeric(14,2) default 0,
  is_paid             boolean not null default false,
  is_entry            boolean,
  category_id         text,
  category_name       text default '',
  category_type       text, -- 'in' | 'out'
  cost_center_id      text,
  cost_center_name    text default '',
  stakeholder_id      text,
  stakeholder_name    text default '',
  raw                 jsonb not null default '{}'::jsonb,
  synced_at           timestamptz not null default now(),
  unique (company_id, nibo_id)
);

create index if not exists nibo_schedules_company_due_date_idx
  on public.nibo_schedules (company_id, due_date);

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
