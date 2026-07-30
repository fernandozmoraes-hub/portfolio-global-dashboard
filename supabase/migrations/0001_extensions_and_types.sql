-- =============================================================================
-- 0001 — Extensões, tipos e funções utilitárias
-- =============================================================================
-- Gestão Global da Carteira | Aposentadoria 70
--
-- Os ENUMs abaixo são espelhados em src/domain/shared/types.ts. Alterar um
-- exige alterar o outro.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Classes econômicas da política de investimentos
-- -----------------------------------------------------------------------------
create type asset_class as enum (
  'RF_BRASIL',
  'ACOES_BRASIL',
  'ACOES_ETF_EXTERIOR',
  'RF_CAIXA_EXTERIOR',
  'FII_IMOBILIARIO',
  'MULTIMERCADO_ALTERNATIVO',
  'CAIXA_BR'
);

-- -----------------------------------------------------------------------------
-- Instrumento: o "que" do ativo (independente da classe econômica)
-- -----------------------------------------------------------------------------
create type asset_type as enum (
  'ACAO',
  'ETF',
  'FII',
  'TESOURO_DIRETO',
  'CDB',
  'LCI_LCA',
  'DEBENTURE',
  'CRI',
  'CRA',
  'FUNDO',
  'BOND',
  'REIT',
  'CAIXA'
);

-- -----------------------------------------------------------------------------
-- Balde de risco: define o peso máximo individual permitido
-- -----------------------------------------------------------------------------
create type risk_bucket as enum (
  'CORE',
  'GROWTH',
  'SATELLITE',
  'ASYMMETRIC',
  'DEFENSIVE',
  'CASH'
);

create type transaction_type as enum (
  'COMPRA',
  'VENDA',
  'APORTE',
  'RETIRADA',
  'TRANSF_ENTRADA',
  'TRANSF_SAIDA',
  'TAXA',
  'IMPOSTO'
);

create type income_type as enum (
  'DIVIDENDO',
  'JCP',
  'RENDIMENTO',
  'CUPOM',
  'AMORTIZACAO',
  'ALUGUEL'
);

-- Fluxos de caixa do investidor no portfólio (fonte para Dietz/TWR/XIRR)
create type cash_flow_type as enum (
  'CONTRIBUTION',
  'WITHDRAWAL'
);

-- Um snapshot nasce RASCUNHO e, ao ser confirmado, torna-se FECHADO e imutável
create type snapshot_status as enum (
  'RASCUNHO',
  'FECHADO'
);

create type risk_limit_scope as enum (
  'SINGLE_ASSET',
  'RISK_BUCKET',
  'SECTOR',
  'COUNTRY',
  'CURRENCY'
);

create type import_status as enum (
  'PENDENTE',
  'VALIDADO',
  'ERRO',
  'IMPORTADO',
  'IGNORADO'
);

-- -----------------------------------------------------------------------------
-- Domínio de moeda: restringe às moedas suportadas sem o custo de um ENUM
-- (adicionar moeda vira UPDATE de constraint, não ALTER TYPE)
-- -----------------------------------------------------------------------------
create domain currency_code as char(3)
  check (value in ('BRL', 'USD', 'EUR'));

-- -----------------------------------------------------------------------------
-- Mantém updated_at coerente sem depender da aplicação
-- -----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function set_updated_at() is
  'Trigger de manutenção de updated_at. Aplicada a todas as tabelas mutáveis.';
