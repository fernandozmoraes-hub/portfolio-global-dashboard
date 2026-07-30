-- =============================================================================
-- SHIM DE AUTENTICAÇÃO PARA VALIDAÇÃO LOCAL
-- =============================================================================
-- ⚠️ ESTE ARQUIVO NÃO É UMA MIGRATION E NUNCA DEVE RODAR NO SUPABASE.
--
-- No Supabase, o schema `auth`, a tabela `auth.users`, a função `auth.uid()` e
-- os papéis anon/authenticated/service_role já existem. Este shim os recria num
-- Postgres puro para que `supabase/migrations/*` possa ser validado localmente
-- (constraints, triggers de imutabilidade e policies de RLS) sem depender de um
-- projeto remoto.
--
-- Uso:
--   psql -d gestao_global_carteira -f supabase/local/00_auth_shim.sql
--   psql -d gestao_global_carteira -f supabase/migrations/0001_....sql
--   ...
-- =============================================================================

create schema if not exists auth;

-- Papéis usados pelas policies
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Reproduz auth.uid() lendo o JWT da sessão, como no Supabase.
-- Nos testes locais, define-se com: set local request.jwt.claims = '{"sub":"<uuid>"}'
create or replace function auth.uid()
returns uuid
language plpgsql
stable
as $$
declare
  v_claims text;
  v_sub    text;
begin
  v_sub := nullif(current_setting('request.jwt.claim.sub', true), '');

  if v_sub is null then
    v_claims := nullif(current_setting('request.jwt.claims', true), '');
    if v_claims is null then
      return null;  -- sem sessão: as policies negam tudo
    end if;
    begin
      v_sub := nullif(v_claims::jsonb ->> 'sub', '');
    exception when others then
      return null;  -- claims malformadas equivalem a não ter sessão
    end;
  end if;

  return v_sub::uuid;
end;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
alter default privileges in schema public
  grant all on tables to authenticated, service_role;
