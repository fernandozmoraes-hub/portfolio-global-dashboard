-- =============================================================================
-- 0003 — Catálogo de ativos e identidade de instrumentos
-- =============================================================================
-- Por que assets tem user_id: asset_class e risk_bucket são DECISÕES DO GESTOR,
-- não fatos de mercado. O mesmo GOOGL pode ser CORE para um investidor e GROWTH
-- para outro. O catálogo é, portanto, pessoal.
-- =============================================================================

create table assets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles (id) on delete cascade,

  ticker       text not null,
  name         text not null,
  -- Bolsa/mercado de negociação. 'N/A' para RF, fundos e caixa.
  -- NOT NULL com default porque NULL quebraria a unicidade (NULL <> NULL).
  exchange     text not null default 'N/A',
  isin         text,

  asset_type   asset_type  not null,
  asset_class  asset_class not null,
  country      text not null,
  currency     currency_code not null,
  sector       text,
  industry     text,
  risk_bucket  risk_bucket not null,

  -- IDENTIDADE ECONÔMICA (preparação para ADR/BDR)
  -- GOOGL (NASDAQ) e GOOGL34 (B3) são instrumentos DIFERENTES que representam
  -- a MESMA exposição econômica. underlying_asset_id liga o derivado ao
  -- principal; exposure_ratio informa quantas unidades do subjacente cada
  -- unidade deste instrumento representa (BDRs costumam ser frações).
  --
  -- No MVP a consolidação segue por asset_id, como aprovado. Estes campos são
  -- a base para a consolidação por exposição econômica numa fase futura.
  underlying_asset_id uuid,
  exposure_ratio      numeric(18, 8) not null default 1,

  is_active    boolean not null default true,
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint assets_ticker_not_blank check (length(btrim(ticker)) > 0),
  constraint assets_exposure_ratio_positive check (exposure_ratio > 0),
  constraint assets_no_self_reference check (underlying_asset_id is null or underlying_asset_id <> id),
  constraint assets_isin_format check (isin is null or isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),

  -- UNICIDADE PREFERENCIAL: user + ticker + exchange + moeda.
  -- Permite coexistir GOOGL/NASDAQ/USD e GOOGL34/B3/BRL como ativos distintos.
  constraint assets_unique_identity unique (user_id, ticker, exchange, currency),
  constraint assets_id_user_unique unique (id, user_id),

  constraint assets_underlying_fk
    foreign key (underlying_asset_id, user_id) references assets (id, user_id)
    on delete set null
);

comment on table assets is
  'Catálogo pessoal de ativos. Unicidade por (user, ticker, exchange, moeda).';
comment on column assets.underlying_asset_id is
  'Instrumento subjacente (ex.: GOOGL34 -> GOOGL). Base para ADR/BDR.';
comment on column assets.exposure_ratio is
  'Unidades do subjacente representadas por 1 unidade deste instrumento.';
comment on column assets.is_demo is
  'TRUE para dados do seed demonstrativo. Nunca confundir com dado oficial.';

create index idx_assets_user_active on assets (user_id) where is_active;
create index idx_assets_class on assets (user_id, asset_class);
create index idx_assets_bucket on assets (user_id, risk_bucket);
create index idx_assets_underlying on assets (underlying_asset_id)
  where underlying_asset_id is not null;

create trigger trg_assets_updated_at
  before update on assets
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- asset_aliases — como cada corretora chama o mesmo ativo
-- -----------------------------------------------------------------------------
-- É o mecanismo que faz a consolidação funcionar NO MOMENTO DA IMPORTAÇÃO:
-- a Avenue exporta "GOOGL", outra corretora exporta "GOOGL US EQUITY". Sem esta
-- tabela, o princípio de custódia-vs-exposição dependeria de digitação perfeita.
-- -----------------------------------------------------------------------------
create table asset_aliases (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles (id) on delete cascade,
  asset_id        uuid not null,
  broker_id       uuid,
  external_ticker text not null,
  created_at      timestamptz not null default now(),

  constraint asset_aliases_ticker_not_blank check (length(btrim(external_ticker)) > 0),
  constraint asset_aliases_asset_fk
    foreign key (asset_id, user_id) references assets (id, user_id) on delete cascade,
  constraint asset_aliases_broker_fk
    foreign key (broker_id, user_id) references brokers (id, user_id) on delete cascade
);

comment on table asset_aliases is
  'Mapeia o ticker externo de cada corretora para o ativo canônico.';

-- Um mesmo texto externo não pode apontar para dois ativos na mesma corretora.
-- Índice parcial porque broker_id NULL representa alias global do usuário.
create unique index idx_asset_aliases_unique_per_broker
  on asset_aliases (user_id, broker_id, upper(external_ticker))
  where broker_id is not null;

create unique index idx_asset_aliases_unique_global
  on asset_aliases (user_id, upper(external_ticker))
  where broker_id is null;

create index idx_asset_aliases_asset on asset_aliases (asset_id);
