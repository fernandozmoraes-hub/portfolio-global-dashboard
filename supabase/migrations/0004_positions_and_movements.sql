-- =============================================================================
-- 0004 — Posições, transações e rendimentos
-- =============================================================================
-- positions é sempre (conta, ativo, data): é a CUSTÓDIA.
-- A EXPOSIÇÃO econômica é derivada somando as posições do mesmo ativo entre
-- corretoras — feito em src/domain/consolidation/consolidate.ts.
-- =============================================================================

create table positions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles (id) on delete cascade,
  account_id     uuid not null,
  asset_id       uuid not null,

  quantity       numeric(20, 8) not null,
  -- Custo médio por unidade na moeda do ativo. NULL = desconhecido (não zero).
  average_cost   numeric(20, 8),
  current_price  numeric(20, 8) not null,
  -- Coluna gerada: elimina a chance de valor divergir de quantidade × preço.
  current_value  numeric(30, 8) generated always as (quantity * current_price) stored,

  reference_date date not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint positions_quantity_not_negative check (quantity >= 0),
  constraint positions_price_not_negative check (current_price >= 0),
  constraint positions_average_cost_not_negative check (average_cost is null or average_cost >= 0),

  -- TRAVA CONTRA DUPLICIDADE: reimportar o mesmo mês atualiza, não duplica.
  constraint positions_unique_per_date unique (account_id, asset_id, reference_date),

  constraint positions_account_fk
    foreign key (account_id, user_id) references accounts (id, user_id) on delete cascade,
  constraint positions_asset_fk
    foreign key (asset_id, user_id) references assets (id, user_id) on delete restrict
);

comment on table positions is
  'Posição custodiada em uma conta. A exposição global é derivada, não armazenada.';
comment on constraint positions_unique_per_date on positions is
  'Impede posição duplicada na reimportação do mesmo mês.';

create index idx_positions_user_date on positions (user_id, reference_date desc);
create index idx_positions_account_date on positions (account_id, reference_date desc);
create index idx_positions_asset on positions (asset_id);

create trigger trg_positions_updated_at
  before update on positions
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- transactions — movimentações de compra/venda e afins
-- -----------------------------------------------------------------------------
create table transactions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles (id) on delete cascade,
  account_id       uuid not null,
  -- NULL para movimentos puramente financeiros (taxa de custódia, IOF)
  asset_id         uuid,

  transaction_type transaction_type not null,
  date             date not null,
  quantity         numeric(20, 8),
  price            numeric(20, 8),
  fees             numeric(20, 2) not null default 0,
  taxes            numeric(20, 2) not null default 0,
  currency         currency_code not null,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint transactions_fees_not_negative check (fees >= 0),
  constraint transactions_taxes_not_negative check (taxes >= 0),
  -- Movimento com ativo precisa de quantidade e preço; sem ativo, não faz sentido tê-los
  constraint transactions_asset_requires_quantity
    check (asset_id is null or (quantity is not null and price is not null)),

  constraint transactions_account_fk
    foreign key (account_id, user_id) references accounts (id, user_id) on delete cascade,
  constraint transactions_asset_fk
    foreign key (asset_id, user_id) references assets (id, user_id) on delete restrict
);

comment on table transactions is
  'Movimentações. Base futura para custo médio calculado e XIRR por ativo.';

create index idx_transactions_account_date on transactions (account_id, date desc);
create index idx_transactions_asset_date on transactions (asset_id, date desc)
  where asset_id is not null;
create index idx_transactions_user_date on transactions (user_id, date desc);

create trigger trg_transactions_updated_at
  before update on transactions
  for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- income — proventos recebidos
-- -----------------------------------------------------------------------------
create table income (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles (id) on delete cascade,
  account_id   uuid not null,
  asset_id     uuid not null,

  date         date not null,
  income_type  income_type not null,
  gross_amount numeric(20, 2) not null,
  taxes        numeric(20, 2) not null default 0,
  -- Gerado: líquido nunca diverge de bruto − impostos
  net_amount   numeric(20, 2) generated always as (gross_amount - taxes) stored,
  currency     currency_code not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint income_gross_not_negative check (gross_amount >= 0),
  constraint income_taxes_not_negative check (taxes >= 0),
  constraint income_taxes_not_above_gross check (taxes <= gross_amount),

  constraint income_account_fk
    foreign key (account_id, user_id) references accounts (id, user_id) on delete cascade,
  constraint income_asset_fk
    foreign key (asset_id, user_id) references assets (id, user_id) on delete restrict
);

comment on table income is 'Proventos: dividendos, JCP, cupons, aluguéis.';

create index idx_income_asset_date on income (asset_id, date desc);
create index idx_income_user_date on income (user_id, date desc);

create trigger trg_income_updated_at
  before update on income
  for each row execute function set_updated_at();
