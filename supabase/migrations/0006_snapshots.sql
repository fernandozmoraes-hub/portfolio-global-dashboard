-- =============================================================================
-- 0006 — Snapshots mensais (fotografia imutável da carteira)
-- =============================================================================
-- REQUISITO FUNDAMENTAL DO BRIEFING:
-- os dashboards históricos usam snapshots fechados e NUNCA recalculam o passado
-- com preços atuais.
--
-- Para isso, snapshot_positions congela não só o valor, mas TODA a
-- classificação do ativo (classe, bucket, setor, país, moeda) e o câmbio usado.
-- Se GOOGL for reclassificado de CORE para GROWTH amanhã, o histórico não se
-- reescreve. É essa denormalização deliberada que separa um sistema de controle
-- patrimonial de uma planilha.
-- =============================================================================

create table portfolio_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references profiles (id) on delete cascade,

  reference_date        date not null,
  status                snapshot_status not null default 'RASCUNHO',

  -- Patrimônio FINANCEIRO investível (não inclui imóvel)
  total_value_brl       numeric(20, 2) not null default 0,
  -- Patrimônio imobiliário, registrado à parte por decisão de projeto
  real_estate_value_brl numeric(20, 2) not null default 0,

  contributions_month   numeric(20, 2) not null default 0,
  withdrawals_month     numeric(20, 2) not null default 0,

  -- Câmbio congelado do fechamento: posições em USD nunca são reavaliadas
  usd_brl_rate          numeric(20, 10),

  notes                 text,
  closed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint snapshots_values_not_negative check (
    total_value_brl >= 0 and real_estate_value_brl >= 0
    and contributions_month >= 0 and withdrawals_month >= 0
  ),
  constraint snapshots_usd_rate_positive check (usd_brl_rate is null or usd_brl_rate > 0),
  -- Um snapshot FECHADO precisa ter data de fechamento e câmbio registrados
  constraint snapshots_closed_requires_metadata check (
    status <> 'FECHADO' or (closed_at is not null and usd_brl_rate is not null)
  ),
  constraint snapshots_unique_per_month unique (user_id, reference_date),
  constraint snapshots_id_user_unique unique (id, user_id)
);

comment on table portfolio_snapshots is
  'Fechamento mensal. Ao passar para FECHADO torna-se imutável (migration 0009).';
comment on column portfolio_snapshots.total_value_brl is
  'Patrimônio financeiro investível. NÃO inclui o imóvel residencial.';

create index idx_snapshots_user_date on portfolio_snapshots (user_id, reference_date desc);
create index idx_snapshots_closed
  on portfolio_snapshots (user_id, reference_date desc)
  where status = 'FECHADO';

create trigger trg_snapshots_updated_at
  before update on portfolio_snapshots
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- snapshot_positions — a fotografia linha a linha
-- -----------------------------------------------------------------------------
create table snapshot_positions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles (id) on delete cascade,
  snapshot_id     uuid not null,

  -- Referências mantidas apenas para drill-down na UI.
  -- ON DELETE RESTRICT: apagar um ativo não pode furar o histórico.
  asset_id        uuid not null,
  account_id      uuid not null,

  -- ---- FOTOGRAFIA CONGELADA (denormalizada de propósito) ----
  ticker          text not null,
  asset_name      text not null,
  broker_name     text not null,
  account_name    text not null,
  asset_class     asset_class not null,
  risk_bucket     risk_bucket not null,
  country         text not null,
  sector          text,
  currency        currency_code not null,

  quantity        numeric(20, 8) not null,
  average_cost    numeric(20, 8),
  price           numeric(20, 8) not null,
  value_original  numeric(20, 2) not null,
  fx_rate_to_brl  numeric(20, 10) not null,
  value_brl       numeric(20, 2) not null,

  created_at      timestamptz not null default now(),

  constraint snapshot_positions_quantity_not_negative check (quantity >= 0),
  constraint snapshot_positions_fx_positive check (fx_rate_to_brl > 0),
  constraint snapshot_positions_unique unique (snapshot_id, account_id, asset_id),

  constraint snapshot_positions_snapshot_fk
    foreign key (snapshot_id, user_id) references portfolio_snapshots (id, user_id)
    on delete cascade,
  constraint snapshot_positions_asset_fk
    foreign key (asset_id, user_id) references assets (id, user_id) on delete restrict,
  constraint snapshot_positions_account_fk
    foreign key (account_id, user_id) references accounts (id, user_id) on delete restrict
);

comment on table snapshot_positions is
  'Posições congeladas no fechamento. Reclassificar um ativo não altera o histórico.';

create index idx_snapshot_positions_snapshot on snapshot_positions (snapshot_id);
create index idx_snapshot_positions_asset on snapshot_positions (asset_id);
create index idx_snapshot_positions_class on snapshot_positions (snapshot_id, asset_class);

-- -----------------------------------------------------------------------------
-- snapshot_allocations — pesos por classe congelados
-- -----------------------------------------------------------------------------
-- Derivável de snapshot_positions, mas materializado: o gráfico histórico de
-- alocação é a leitura mais frequente do sistema, e congelar também os ALVOS
-- vigentes na época permite responder "eu estava dentro da política naquele
-- mês?" mesmo depois de a política mudar.
-- -----------------------------------------------------------------------------
create table snapshot_allocations (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references profiles (id) on delete cascade,
  snapshot_id        uuid not null,

  asset_class        asset_class not null,
  value_brl          numeric(20, 2) not null,
  percentage         numeric(7, 4) not null,
  -- Política vigente no momento do fechamento
  target_percentage  numeric(7, 4) not null,
  minimum_percentage numeric(7, 4) not null,
  maximum_percentage numeric(7, 4) not null,

  created_at         timestamptz not null default now(),

  constraint snapshot_allocations_percentage_range check (percentage >= 0 and percentage <= 100),
  constraint snapshot_allocations_unique unique (snapshot_id, asset_class),
  constraint snapshot_allocations_snapshot_fk
    foreign key (snapshot_id, user_id) references portfolio_snapshots (id, user_id)
    on delete cascade
);

comment on table snapshot_allocations is
  'Pesos por classe e política vigente, congelados no fechamento.';

create index idx_snapshot_allocations_snapshot on snapshot_allocations (snapshot_id);
