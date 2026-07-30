-- =============================================================================
-- 0005 — Fluxos de caixa do portfólio e câmbio
-- =============================================================================
-- portfolio_cash_flows é a FONTE DE VERDADE para separar aporte de
-- rentabilidade. O aumento de patrimônio causado por aporte nunca pode aparecer
-- como retorno — é o que estes registros tornam auditável.
--
-- No MVP o fechamento mensal grava um único fluxo líquido (data = último dia do
-- mês) e o Modified Dietz assume timing no meio do período. A estrutura já
-- suporta fluxos datados individualmente, de modo que TWR preciso e XIRR
-- passam a funcionar sem migration adicional assim que as datas reais forem
-- registradas.
-- =============================================================================

create table portfolio_cash_flows (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles (id) on delete cascade,

  date          date not null,
  flow_type     cash_flow_type not null,
  -- Valor sempre POSITIVO. A direção vem de flow_type, nunca do sinal.
  amount        numeric(20, 2) not null,
  currency      currency_code not null,
  fx_rate_used  numeric(20, 10) not null,
  -- Gerado: impossível o valor em BRL divergir de amount × taxa
  amount_brl    numeric(30, 10) generated always as (amount * fx_rate_used) stored,

  -- Opcional: nem todo fluxo é atribuível a uma conta específica
  account_id    uuid,
  notes         text,
  created_at    timestamptz not null default now(),

  constraint cash_flows_amount_positive check (amount > 0),
  constraint cash_flows_fx_positive check (fx_rate_used > 0),
  -- Coerência: fluxo em BRL tem de usar taxa 1
  constraint cash_flows_brl_rate_is_one
    check (currency <> 'BRL' or fx_rate_used = 1),

  constraint cash_flows_account_fk
    foreign key (account_id, user_id) references accounts (id, user_id) on delete set null
);

comment on table portfolio_cash_flows is
  'Aportes e retiradas. Fonte para Modified Dietz, TWR e XIRR.';
comment on column portfolio_cash_flows.amount is
  'Sempre positivo. A direção é dada por flow_type.';

create index idx_cash_flows_user_date on portfolio_cash_flows (user_id, date desc);
create index idx_cash_flows_type on portfolio_cash_flows (user_id, flow_type, date desc);
create index idx_cash_flows_account on portfolio_cash_flows (account_id)
  where account_id is not null;

-- -----------------------------------------------------------------------------
-- fx_rates — câmbio por data
-- -----------------------------------------------------------------------------
create table fx_rates (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles (id) on delete cascade,
  date          date not null,
  currency_from currency_code not null,
  currency_to   currency_code not null,
  rate          numeric(20, 10) not null,
  source        text not null default 'manual',
  created_at    timestamptz not null default now(),

  constraint fx_rates_positive check (rate > 0),
  constraint fx_rates_different_currencies check (currency_from <> currency_to),
  constraint fx_rates_unique_per_date unique (user_id, date, currency_from, currency_to)
);

comment on table fx_rates is
  'Câmbio por data. Ausência de taxa é erro explícito no domínio — nunca assume 1.';

create index idx_fx_rates_lookup
  on fx_rates (user_id, currency_from, currency_to, date desc);
