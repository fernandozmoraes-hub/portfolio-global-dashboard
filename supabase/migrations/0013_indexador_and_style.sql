-- =============================================================================
-- 0013 — Indexador e estilo de investimento
-- =============================================================================
-- DUAS CORREÇÕES DE SEMÂNTICA
--
-- 1. INDEXADOR ≠ BENEFÍCIO FISCAL
--    A derivação anterior atribuía o fator "inflação" a qualquer papel cujo
--    nome contivesse "incentivada". Isso confunde duas coisas distintas:
--    "incentivada" é tratamento TRIBUTÁRIO (isenção de IR, Lei 12.431), e nada
--    diz sobre indexação. Uma debênture incentivada pode perfeitamente ser
--    CDI+ — e nesse caso não carrega risco de inflação nenhum.
--    O indexador passa a ser um campo próprio e explícito.
--
-- 2. RISK BUCKET ≠ ESTILO DE INVESTIMENTO
--    `risk_bucket` responde "que papel esta posição cumpre e quanto ela pode
--    pesar" (CORE 5%, GROWTH 3%, ASYMMETRIC 0,5%) — é uma decisão de
--    DIMENSIONAMENTO.
--    Estilo responde "que tipo de retorno este ativo busca" (value, growth,
--    dividendos, índice) — é uma característica do ATIVO.
--    O termo GROWTH existia nos dois com significados diferentes, o que
--    tornava a leitura ambígua. Agora são campos separados.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Indexador: a que indicador a remuneração do papel está atrelada
-- -----------------------------------------------------------------------------
create type rate_index as enum (
  'IPCA',        -- inflação oficial brasileira
  'IGPM',        -- inflação (aluguéis, contratos)
  'CDI',         -- juros pós-fixado Brasil
  'SELIC',       -- juros pós-fixado soberano
  'PREFIXADO',   -- taxa nominal travada
  'USD_FIXED',   -- taxa fixa em dólar
  'NONE'         -- renda variável e demais casos sem indexador
);

comment on type rate_index is
  'Indexador da remuneração. Determina o fator de inflação — não o regime tributário.';

-- -----------------------------------------------------------------------------
-- Estilo de investimento: característica do ativo, não do dimensionamento
-- -----------------------------------------------------------------------------
create type investment_style as enum (
  'VALUE',
  'GROWTH',
  'BLEND',
  'QUALIDADE',
  'DIVIDENDOS',
  'INDICE',
  'RENDA',
  'NAO_APLICAVEL'
);

comment on type investment_style is
  'Tipo de retorno buscado pelo ativo. Independente de risk_bucket, que dimensiona a posição.';

alter table assets
  add column indexador        rate_index       not null default 'NONE',
  add column investment_style investment_style not null default 'NAO_APLICAVEL';

comment on column assets.indexador is
  'Indexador da remuneração (IPCA, CDI, PREFIXADO…). Fonte única do fator inflação.';
comment on column assets.investment_style is
  'Estilo (value, growth, dividendos, índice). NÃO confundir com risk_bucket.';
comment on column assets.risk_bucket is
  'Papel e limite de tamanho da posição (CORE 5%, GROWTH 3%, ASYMMETRIC 0,5%). Decisão de dimensionamento, não característica do ativo.';

create index idx_assets_indexador on assets (user_id, indexador)
  where indexador <> 'NONE';

-- -----------------------------------------------------------------------------
-- Congelar também no snapshot
-- -----------------------------------------------------------------------------
-- Mesma regra das demais colunas de classificação: reclassificar um ativo
-- amanhã não pode reescrever a leitura de um mês já fechado.
-- -----------------------------------------------------------------------------
alter table snapshot_positions
  add column indexador        rate_index       not null default 'NONE',
  add column investment_style investment_style not null default 'NAO_APLICAVEL';

-- -----------------------------------------------------------------------------
-- Freshness das posições
-- -----------------------------------------------------------------------------
-- Cada corretora fecha e exporta em datas diferentes. A carteira corrente é
-- montada pegando, POR CONTA, a data mais recente disponível — e não uma data
-- global, que descartaria silenciosamente contas atualizadas em outro dia.
--
-- Esta view expõe a data de cada fonte para que a UI possa mostrar a
-- defasagem em vez de escondê-la.
-- -----------------------------------------------------------------------------
create view account_position_freshness
with (security_invoker = true) as
select
  a.user_id,
  a.id                          as account_id,
  a.name                        as account_name,
  b.id                          as broker_id,
  b.name                        as broker_name,
  max(p.reference_date)         as latest_reference_date,
  count(*) filter (where p.reference_date = (
    select max(p2.reference_date) from positions p2 where p2.account_id = a.id
  ))                            as position_count
from accounts a
join brokers b on b.id = a.broker_id
join positions p on p.account_id = a.id
group by a.user_id, a.id, a.name, b.id, b.name;

comment on view account_position_freshness is
  'Data da posição mais recente de cada conta. security_invoker: respeita a RLS do usuário.';
