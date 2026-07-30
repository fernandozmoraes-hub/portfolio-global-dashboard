-- =============================================================================
-- 0002 — Identidade e estrutura de custódia
-- =============================================================================
-- profiles -> brokers -> accounts
--
-- NOTA DE ARQUITETURA: user_id é DESNORMALIZADO em todas as tabelas filhas.
-- Isso permite policies de RLS diretas (`user_id = auth.uid()`) em vez de
-- subconsultas subindo a cadeia de FKs — mais rápido e muito mais fácil de
-- auditar. A coerência é garantida por CHAVES ESTRANGEIRAS COMPOSTAS, não por
-- disciplina da aplicação: é impossível uma conta apontar para um broker de
-- outro usuário.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles — espelha auth.users, que é a fonte de verdade da identidade
-- -----------------------------------------------------------------------------
create table profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text,
  display_name text,
  base_currency currency_code not null default 'BRL',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table profiles is
  'Dados do investidor. PK = auth.users.id (Supabase Auth é a fonte de verdade).';

create trigger trg_profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- Cria o profile automaticamente no primeiro login, evitando estado
-- intermediário em que o usuário existe no Auth mas não na aplicação.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- -----------------------------------------------------------------------------
-- brokers — corretoras, brasileiras e internacionais
-- -----------------------------------------------------------------------------
create table brokers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles (id) on delete cascade,
  name          text not null,
  country       text not null,
  base_currency currency_code not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint brokers_name_not_blank check (length(btrim(name)) > 0),
  constraint brokers_unique_name_per_user unique (user_id, name),
  -- Alvo das FKs compostas das tabelas filhas
  constraint brokers_id_user_unique unique (id, user_id)
);

comment on table brokers is 'Corretoras onde o patrimônio está custodiado.';

create index idx_brokers_user on brokers (user_id) where is_active;

create trigger trg_brokers_updated_at
  before update on brokers
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- accounts — contas dentro de uma corretora (ex.: conta BRL e conta USD)
-- -----------------------------------------------------------------------------
create table accounts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  broker_id  uuid not null,
  name       text not null,
  currency   currency_code not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint accounts_name_not_blank check (length(btrim(name)) > 0),
  constraint accounts_unique_name_per_broker unique (broker_id, name),
  -- FK COMPOSTA: garante que a conta e a corretora pertencem ao mesmo usuário
  constraint accounts_broker_fk
    foreign key (broker_id, user_id) references brokers (id, user_id)
    on delete cascade,
  constraint accounts_id_user_unique unique (id, user_id)
);

comment on table accounts is
  'Contas por corretora. A FK composta impede cruzar dados entre usuários.';

create index idx_accounts_broker on accounts (broker_id);
create index idx_accounts_user on accounts (user_id) where is_active;

create trigger trg_accounts_updated_at
  before update on accounts
  for each row execute function set_updated_at();
