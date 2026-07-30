-- =============================================================================
-- 0012 — Exposição multidimensional (substitui o modelo de fatores de 0011)
-- =============================================================================
-- CORREÇÃO DE MODELAGEM
--
-- A migration 0011 tratava todos os fatores como um conjunto único e rateava o
-- valor do ativo entre eles para que o total global somasse 100%. Isso
-- subestimava sistematicamente a concentração: R$ 100 mil em GOOGL viravam
-- R$ 50 mil de "Equity EUA" mais R$ 50 mil de "Tecnologia", quando na verdade
-- são R$ 100 mil expostos às DUAS coisas ao mesmo tempo.
--
-- O modelo correto organiza as exposições em DIMENSÕES INDEPENDENTES:
--
--   CLASSE · GEOGRAFIA · MOEDA · SETOR_TEMA · ESTILO · MACRO
--
--   - dentro de uma dimensão os pesos somam 1;
--   - entre dimensões não há relação: o mesmo real é contado integralmente
--     em cada uma.
--
-- Tecnologia saiu de MACRO para SETOR_TEMA justamente para que Equity EUA e
-- Tecnologia deixem de competir pelo mesmo 100%.
--
-- SEGURANÇA DA SUBSTITUIÇÃO: as tabelas de 0011 nunca chegaram a receber dados
-- (não há projeto Supabase provisionado e o seed não as populava). O DROP é,
-- portanto, seguro. Mantê-lo aqui em vez de reescrever 0011 preserva o
-- histórico de migrations reproduzível do zero.
-- =============================================================================

drop table if exists snapshot_factor_exposures;
drop table if exists asset_risk_factors;
drop type if exists risk_factor_code;

-- -----------------------------------------------------------------------------
-- Dimensões
-- -----------------------------------------------------------------------------
create type exposure_dimension as enum (
  'CLASSE',
  'GEOGRAFIA',
  'MOEDA',
  'SETOR_TEMA',
  'ESTILO',
  'MACRO'
);

comment on type exposure_dimension is
  'Cada dimensão é uma partição completa e independente do patrimônio.';

-- -----------------------------------------------------------------------------
-- asset_exposure_tags — sobreposição manual, por ativo E por dimensão
-- -----------------------------------------------------------------------------
-- Ausência de linha = usa a derivação automática do domínio
-- (src/domain/exposure/derive.ts). Sobrepor MACRO não afeta GEOGRAFIA.
--
-- `tag` é texto livre validado no domínio, não ENUM: acrescentar um tema novo
-- (ex.: "DEFESA", "BIOTECH") não pode exigir migration.
-- -----------------------------------------------------------------------------
create table asset_exposure_tags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  asset_id   uuid not null,

  dimension  exposure_dimension not null,
  tag        text not null,
  -- Peso da tag DENTRO da dimensão (0 a 1). A soma por (ativo, dimensão) é 1.
  weight     numeric(9, 6) not null,

  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint asset_exposure_tags_weight_range check (weight > 0 and weight <= 1),
  constraint asset_exposure_tags_tag_not_blank check (length(btrim(tag)) > 0),
  constraint asset_exposure_tags_unique unique (asset_id, dimension, tag),
  constraint asset_exposure_tags_asset_fk
    foreign key (asset_id, user_id) references assets (id, user_id) on delete cascade
);

comment on table asset_exposure_tags is
  'Sobreposição manual das tags por dimensão. Sem linha, vale a derivação automática.';
comment on column asset_exposure_tags.weight is
  'Peso DENTRO da dimensão. Soma 1 por (ativo, dimensão) — nunca entre dimensões.';

create index idx_asset_exposure_tags_asset on asset_exposure_tags (asset_id);
create index idx_asset_exposure_tags_lookup
  on asset_exposure_tags (user_id, dimension);

create trigger trg_asset_exposure_tags_updated_at
  before update on asset_exposure_tags
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- snapshot_dimension_exposures — congelamento histórico
-- -----------------------------------------------------------------------------
-- `percentage` é o peso DENTRO da dimensão. Somar percentuais de dimensões
-- diferentes não tem significado — daí a unicidade por (snapshot, dimensão, tag).
-- -----------------------------------------------------------------------------
create table snapshot_dimension_exposures (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles (id) on delete cascade,
  snapshot_id uuid not null,

  dimension   exposure_dimension not null,
  tag         text not null,
  value_brl   numeric(20, 2) not null,
  percentage  numeric(7, 4) not null,

  created_at  timestamptz not null default now(),

  constraint snapshot_dimension_exposures_percentage_range
    check (percentage >= 0 and percentage <= 100),
  constraint snapshot_dimension_exposures_unique
    unique (snapshot_id, dimension, tag),
  constraint snapshot_dimension_exposures_snapshot_fk
    foreign key (snapshot_id, user_id) references portfolio_snapshots (id, user_id)
    on delete cascade
);

comment on table snapshot_dimension_exposures is
  'Exposição por dimensão congelada no fechamento. percentage é relativo à dimensão.';

create index idx_snapshot_dimension_exposures_snapshot
  on snapshot_dimension_exposures (snapshot_id, dimension);

-- Mesma proteção de imutabilidade das demais tabelas de snapshot
create trigger trg_guard_snapshot_dimensions
  before insert or update or delete on snapshot_dimension_exposures
  for each row execute function guard_closed_snapshot_child();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['asset_exposure_tags', 'snapshot_dimension_exposures'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);

    execute format($p$
      create policy %I on %I for select to authenticated
      using ((select auth.uid()) = user_id)
    $p$, t || '_select_own', t);

    execute format($p$
      create policy %I on %I for insert to authenticated
      with check ((select auth.uid()) = user_id)
    $p$, t || '_insert_own', t);

    execute format($p$
      create policy %I on %I for update to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id)
    $p$, t || '_update_own', t);

    execute format($p$
      create policy %I on %I for delete to authenticated
      using ((select auth.uid()) = user_id)
    $p$, t || '_delete_own', t);
  end loop;
end;
$$;

-- Revalida: nenhuma tabela pode ficar sem RLS
do $$
declare
  unprotected text;
begin
  select string_agg(c.relname, ', ')
    into unprotected
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  if unprotected is not null then
    raise exception 'Tabelas sem RLS habilitada: %', unprotected;
  end if;
end;
$$;
