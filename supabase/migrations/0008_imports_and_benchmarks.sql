-- =============================================================================
-- 0008 — Import Center e benchmarks
-- =============================================================================
-- Estrutura criada na Entrega 1; as telas chegam na Entrega 4.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- column_mappings — mapeamento de colunas por corretora
-- -----------------------------------------------------------------------------
-- Cada corretora exporta com cabeçalhos diferentes. O mapa é salvo uma vez e
-- reaproveitado nos meses seguintes.
-- -----------------------------------------------------------------------------
create table column_mappings (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  broker_id  uuid,
  name       text not null,
  -- { "ticker": "Símbolo", "quantity": "Qtde", "market_value": "Valor de Mercado" }
  mapping    jsonb not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint column_mappings_mapping_is_object check (jsonb_typeof(mapping) = 'object'),
  constraint column_mappings_unique_name unique (user_id, name),
  constraint column_mappings_broker_fk
    foreign key (broker_id, user_id) references brokers (id, user_id) on delete cascade
);

comment on table column_mappings is
  'Mapa de colunas do arquivo de cada corretora para os campos padrão.';

create trigger trg_column_mappings_updated_at
  before update on column_mappings
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- import_batches — um arquivo importado
-- -----------------------------------------------------------------------------
create table import_batches (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles (id) on delete cascade,
  broker_id      uuid,

  filename       text not null,
  reference_date date not null,
  status         import_status not null default 'PENDENTE',

  total_rows     integer not null default 0,
  valid_rows     integer not null default 0,
  error_rows     integer not null default 0,

  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  error_message  text,

  constraint import_batches_counts_not_negative check (
    total_rows >= 0 and valid_rows >= 0 and error_rows >= 0
  ),
  constraint import_batches_id_user_unique unique (id, user_id),
  constraint import_batches_broker_fk
    foreign key (broker_id, user_id) references brokers (id, user_id) on delete set null
);

comment on table import_batches is 'Log de importação. Um registro por arquivo.';

create index idx_import_batches_user on import_batches (user_id, started_at desc);

-- -----------------------------------------------------------------------------
-- import_rows — cada linha do arquivo, com o erro que a reprovou
-- -----------------------------------------------------------------------------
create table import_rows (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles (id) on delete cascade,
  batch_id       uuid not null,

  row_number     integer not null,
  -- Linha crua como veio do arquivo, para auditoria posterior
  raw_data       jsonb not null,
  status         import_status not null default 'PENDENTE',
  error_message  text,

  -- Preenchidos quando a linha é resolvida com sucesso
  resolved_asset_id   uuid,
  resolved_account_id uuid,

  created_at     timestamptz not null default now(),

  constraint import_rows_row_number_positive check (row_number > 0),
  constraint import_rows_unique_per_batch unique (batch_id, row_number),
  constraint import_rows_batch_fk
    foreign key (batch_id, user_id) references import_batches (id, user_id) on delete cascade,
  constraint import_rows_asset_fk
    foreign key (resolved_asset_id, user_id) references assets (id, user_id) on delete set null,
  constraint import_rows_account_fk
    foreign key (resolved_account_id, user_id) references accounts (id, user_id) on delete set null
);

comment on table import_rows is
  'Linha a linha da importação, com o motivo da rejeição quando houver.';

create index idx_import_rows_batch on import_rows (batch_id, row_number);
create index idx_import_rows_errors on import_rows (batch_id)
  where status = 'ERRO';

-- -----------------------------------------------------------------------------
-- benchmarks — CDI, IPCA, Ibovespa, S&P 500, USD/BRL
-- -----------------------------------------------------------------------------
-- Valores mensais registrados manualmente no MVP; providers automáticos depois.
-- IPCA é obrigatório para calcular retorno REAL — sem ele o sistema exibe "—"
-- em vez de inventar um número.
-- -----------------------------------------------------------------------------
create table benchmarks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles (id) on delete cascade,
  code        text not null,
  name        text not null,
  -- PERCENTUAL_MENSAL (variação no mês) ou NIVEL (pontos do índice)
  value_kind  text not null default 'PERCENTUAL_MENSAL',
  created_at  timestamptz not null default now(),

  constraint benchmarks_code_valid
    check (code in ('CDI', 'IPCA', 'IBOVESPA', 'SP500', 'USDBRL')),
  constraint benchmarks_value_kind_valid
    check (value_kind in ('PERCENTUAL_MENSAL', 'NIVEL')),
  constraint benchmarks_unique_code unique (user_id, code),
  constraint benchmarks_id_user_unique unique (id, user_id)
);

comment on table benchmarks is 'Índices de referência acompanhados pelo sistema.';

create table benchmark_values (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles (id) on delete cascade,
  benchmark_id    uuid not null,
  -- Sempre o dia 1 do mês de referência
  reference_month date not null,
  value           numeric(20, 8) not null,
  created_at      timestamptz not null default now(),

  constraint benchmark_values_first_day_of_month
    check (extract(day from reference_month) = 1),
  constraint benchmark_values_unique unique (benchmark_id, reference_month),
  constraint benchmark_values_benchmark_fk
    foreign key (benchmark_id, user_id) references benchmarks (id, user_id) on delete cascade
);

comment on table benchmark_values is
  'Série mensal de cada benchmark. reference_month sempre no dia 1.';

create index idx_benchmark_values_lookup
  on benchmark_values (benchmark_id, reference_month desc);
