-- =============================================================================
-- 0007 — Política de investimentos, limites de risco, plano e imóvel
-- =============================================================================
-- Nenhum número de política vive no código. Tudo aqui é editável pelo gestor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- allocation_targets — a política de investimentos
-- -----------------------------------------------------------------------------
create table allocation_targets (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references profiles (id) on delete cascade,
  asset_class        asset_class not null,

  target_percentage  numeric(7, 4) not null,
  minimum_percentage numeric(7, 4) not null,
  maximum_percentage numeric(7, 4) not null,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint allocation_targets_range check (
    target_percentage between 0 and 100
    and minimum_percentage between 0 and 100
    and maximum_percentage between 0 and 100
  ),
  -- A banda tem de conter o alvo
  constraint allocation_targets_band_contains_target check (
    minimum_percentage <= target_percentage
    and target_percentage <= maximum_percentage
  ),
  constraint allocation_targets_unique_class unique (user_id, asset_class)
);

comment on table allocation_targets is
  'Política de investimentos por classe. A soma dos alvos deve ser 100%.';

create trigger trg_allocation_targets_updated_at
  before update on allocation_targets
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- risk_limits — limites configuráveis de concentração
-- -----------------------------------------------------------------------------
-- Avaliados sempre sobre a EXPOSIÇÃO CONSOLIDADA entre corretoras.
-- scope_key NULL significa "vale para todos os itens do escopo".
-- -----------------------------------------------------------------------------
create table risk_limits (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles (id) on delete cascade,

  scope          risk_limit_scope not null,
  scope_key      text,
  max_percentage numeric(7, 4) not null,
  description    text,
  is_active      boolean not null default true,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint risk_limits_percentage_range check (max_percentage between 0 and 100)
);

comment on table risk_limits is
  'Limites de concentração. scope_key NULL = aplica-se a todos do escopo.';

create unique index idx_risk_limits_unique_scoped
  on risk_limits (user_id, scope, scope_key)
  where scope_key is not null;

create unique index idx_risk_limits_unique_global
  on risk_limits (user_id, scope)
  where scope_key is null;

create trigger trg_risk_limits_updated_at
  before update on risk_limits
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- retirement_plan — premissas do plano Aposentadoria 70
-- -----------------------------------------------------------------------------
-- TODOS os valores monetários aqui estão em REAIS REAIS (poder de compra de
-- hoje). O aporte mensal é real e constante: na prática significa reajustá-lo
-- pela inflação ao longo dos anos.
-- -----------------------------------------------------------------------------
create table retirement_plan (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references profiles (id) on delete cascade,

  -- Data de nascimento em vez de idade fixa: idade armazenada envelhece errado
  birth_date                  date not null,
  retirement_age              integer not null,

  -- META PRINCIPAL: renda mensal real aos 70
  monthly_real_income_target  numeric(20, 2) not null,
  -- Aporte mensal em poder de compra de hoje
  monthly_real_contribution   numeric(20, 2) not null,
  -- Retorno real anual esperado (0.0500 = 5% a.a. acima da inflação)
  expected_real_return        numeric(8, 6) not null,

  -- Taxa de retirada de referência para exibir o capital-alvo principal.
  -- O capital necessário NÃO é um número fixo: é derivado da taxa adotada.
  -- R$ 7,5 mi é apenas o capital da meta a 4%.
  reference_withdrawal_rate   numeric(8, 6) not null default 0.04,
  withdrawal_rates            numeric(8, 6)[] not null default array[0.035, 0.039, 0.040],

  is_active                   boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint retirement_plan_retirement_age_valid check (retirement_age between 40 and 110),
  constraint retirement_plan_income_positive check (monthly_real_income_target > 0),
  constraint retirement_plan_contribution_not_negative check (monthly_real_contribution >= 0),
  constraint retirement_plan_return_sane check (expected_real_return between -0.5 and 0.5),
  constraint retirement_plan_withdrawal_rate_valid check (reference_withdrawal_rate > 0 and reference_withdrawal_rate <= 0.2)
);

comment on table retirement_plan is
  'Premissas do plano. Todos os valores em reais reais (poder de compra de hoje).';
comment on column retirement_plan.monthly_real_contribution is
  'Aporte REAL constante. Implica reajuste nominal pela inflação a cada ano.';
comment on column retirement_plan.reference_withdrawal_rate is
  'Taxa usada para o capital-alvo em destaque. O capital é derivado, não fixo.';

-- Apenas um plano ativo por usuário
create unique index idx_retirement_plan_one_active
  on retirement_plan (user_id) where is_active;

create trigger trg_retirement_plan_updated_at
  before update on retirement_plan
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- real_estate — patrimônio imobiliário
-- -----------------------------------------------------------------------------
-- Por decisão do briefing, o imóvel residencial NÃO entra no patrimônio
-- financeiro investível usado nas projeções de aposentadoria. O default do
-- flag reflete isso.
-- -----------------------------------------------------------------------------
create table real_estate (
  id                              uuid primary key default gen_random_uuid(),
  user_id                         uuid not null references profiles (id) on delete cascade,

  description                     text not null,
  estimated_value                 numeric(20, 2) not null,
  currency                        currency_code not null default 'BRL',
  include_in_retirement_portfolio boolean not null default false,
  valuation_date                  date,

  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),

  constraint real_estate_value_not_negative check (estimated_value >= 0),
  constraint real_estate_description_not_blank check (length(btrim(description)) > 0)
);

comment on table real_estate is
  'Patrimônio imobiliário, separado do financeiro investível.';
comment on column real_estate.include_in_retirement_portfolio is
  'FALSE por padrão: o imóvel residencial não financia a aposentadoria.';

create index idx_real_estate_user on real_estate (user_id);

create trigger trg_real_estate_updated_at
  before update on real_estate
  for each row execute function set_updated_at();
