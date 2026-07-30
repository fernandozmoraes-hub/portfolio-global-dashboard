-- =============================================================================
-- 0011 — Fatores de risco
-- =============================================================================
-- POR QUE ESTA TABELA EXISTE
--
-- Classe de ativo responde "onde está o dinheiro". Fator de risco responde
-- "ao que esse dinheiro reage".
--
-- São perguntas diferentes. Uma debênture incentivada de energia indexada ao
-- IPCA está em "Renda Fixa Brasil", mas carrega crédito corporativo, inflação
-- brasileira e, indiretamente, commodities. Um CRI está em RF Brasil e carrega
-- risco imobiliário. Olhar só por classe esconde que dois ativos de classes
-- diferentes podem estar apostando na mesma coisa.
--
-- MODELO
-- Um ativo tem N fatores com pesos que somam 1. A alocação padrão é DERIVADA
-- no domínio a partir de (asset_type, asset_class, sector, country) — ver
-- src/domain/factors/derive.ts. Esta tabela guarda apenas as EXCEÇÕES que o
-- gestor quiser sobrepor.
--
-- Consequência importante: a exposição por fator funciona imediatamente para
-- uma carteira real recém-importada, sem nenhuma classificação manual.
-- =============================================================================

create type risk_factor_code as enum (
  'JUROS_BR',
  'INFLACAO_BR',
  'CREDITO_BR',
  'EQUITY_BR',
  'EQUITY_US',
  'TECH_AI',
  'COMMODITIES',
  'IMOBILIARIO',
  'DURATION_USD',
  -- Residual explícito: o que a derivação padrão não souber classificar
  -- aparece aqui, visível, em vez de sumir da soma.
  'OUTROS'
);

-- -----------------------------------------------------------------------------
-- asset_risk_factors — sobreposição manual da derivação padrão
-- -----------------------------------------------------------------------------
create table asset_risk_factors (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles (id) on delete cascade,
  asset_id    uuid not null,

  factor_code risk_factor_code not null,
  -- Peso do fator dentro do ativo (0 a 1). A soma por ativo deve ser 1.
  weight      numeric(9, 6) not null,

  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint asset_risk_factors_weight_range check (weight > 0 and weight <= 1),
  constraint asset_risk_factors_unique unique (asset_id, factor_code),
  constraint asset_risk_factors_asset_fk
    foreign key (asset_id, user_id) references assets (id, user_id) on delete cascade
);

comment on table asset_risk_factors is
  'Sobreposição manual dos fatores de risco. Ausência = usa a derivação padrão do domínio.';
comment on column asset_risk_factors.weight is
  'Peso do fator no ativo (0-1). A soma dos pesos de um ativo deve ser 1.';

create index idx_asset_risk_factors_asset on asset_risk_factors (asset_id);
create index idx_asset_risk_factors_user on asset_risk_factors (user_id);

create trigger trg_asset_risk_factors_updated_at
  before update on asset_risk_factors
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- Congela os fatores no snapshot, como o resto da classificação
-- -----------------------------------------------------------------------------
-- Mesmo princípio de snapshot_positions: mudar a classificação de fator amanhã
-- não pode reescrever a exposição fatorial de um mês já fechado.
-- -----------------------------------------------------------------------------
create table snapshot_factor_exposures (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles (id) on delete cascade,
  snapshot_id uuid not null,

  factor_code risk_factor_code not null,
  value_brl   numeric(20, 2) not null,
  percentage  numeric(7, 4) not null,

  created_at  timestamptz not null default now(),

  constraint snapshot_factor_exposures_percentage_range
    check (percentage >= 0 and percentage <= 100),
  constraint snapshot_factor_exposures_unique unique (snapshot_id, factor_code),
  constraint snapshot_factor_exposures_snapshot_fk
    foreign key (snapshot_id, user_id) references portfolio_snapshots (id, user_id)
    on delete cascade
);

comment on table snapshot_factor_exposures is
  'Exposição por fator congelada no fechamento.';

create index idx_snapshot_factor_exposures_snapshot
  on snapshot_factor_exposures (snapshot_id);

-- Herda a mesma proteção de imutabilidade das demais tabelas de snapshot
create trigger trg_guard_snapshot_factors
  before insert or update or delete on snapshot_factor_exposures
  for each row execute function guard_closed_snapshot_child();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['asset_risk_factors', 'snapshot_factor_exposures'] loop
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
