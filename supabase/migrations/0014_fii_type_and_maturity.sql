-- =============================================================================
-- 0014 — Tipo de FII e data de vencimento
-- =============================================================================
-- DUAS CORREÇÕES
--
-- 1. INDEXADOR NÃO É PROPRIEDADE ESTRUTURAL DE FII
--    A derivação anterior lia `indexador` do FII e concluía exposição a IPCA
--    ou CDI. Isso é errado por dois motivos: um FII de tijolo não tem
--    indexador algum, e um FII de papel tem uma CARTEIRA de CRIs com
--    indexadores variados — transformar o indexador predominante em 100% do
--    NAV inventa um número.
--    O que o FII tem estruturalmente é o TIPO: tijolo, papel ou híbrido.
--    A exposição real a IPCA/CDI virá do look-through, ponderado e datado
--    (fund_exposure_snapshots, fase futura). Até lá, não se inventa.
--
-- 2. VENCIMENTO
--    `maturity_date` é NULLABLE e só deve ser preenchido quando o vencimento
--    for efetivamente conhecido. NUNCA derivar do ano no ticker ou no nome:
--    "TESOURO_IPCA_2035" sugere 2035, mas a data exata (15/05/2035) é um fato
--    a ser confirmado, não deduzido de uma string.
--    Duration e DV01 serão métricas separadas e datadas, calculadas a partir
--    daqui — não armazenadas como atributo estático do ativo.
-- =============================================================================

create type fii_type as enum (
  'TIJOLO',        -- imóveis físicos
  'PAPEL',         -- carteira de CRIs e recebíveis
  'HIBRIDO',       -- ambos
  'FOF',           -- fundo de fundos
  'NAO_APLICAVEL'  -- não é FII
);

comment on type fii_type is
  'Natureza do FII. A exposição a indexadores vem do look-through, não daqui.';

alter table assets
  add column fii_type      fii_type not null default 'NAO_APLICAVEL',
  add column maturity_date date;

comment on column assets.fii_type is
  'TIJOLO/PAPEL/HIBRIDO. Substitui o uso indevido de indexador em FIIs.';
comment on column assets.maturity_date is
  'Vencimento, quando CONHECIDO. Jamais derivar do ano no ticker ou no nome.';

-- Coerência: só FII pode ter fii_type diferente de NAO_APLICAVEL
alter table assets add constraint assets_fii_type_requires_fii
  check (fii_type = 'NAO_APLICAVEL' or asset_type = 'FII');

-- Congela no snapshot, como o resto da classificação
alter table snapshot_positions
  add column fii_type      fii_type not null default 'NAO_APLICAVEL',
  add column maturity_date date;

create index idx_assets_maturity on assets (user_id, maturity_date)
  where maturity_date is not null;
