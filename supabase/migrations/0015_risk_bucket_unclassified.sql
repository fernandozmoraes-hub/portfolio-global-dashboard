-- =============================================================================
-- 0015 — Risk bucket não classificado
-- =============================================================================
-- A coluna risk_bucket é NOT NULL, então uma carga sem classificação precisava
-- de um default — e o default virou CORE. Isso é preenchimento automático
-- disfarçado: todo ativo passaria a ter teto de 5%, inclusive posições que o
-- gestor classificaria como GROWTH (3%) ou ASSIMÉTRICA (0,5%).
--
-- Um valor explícito de "não classificado" é honesto: o dado aparece como
-- pendente na UI e nenhum limite por bucket é aplicado sobre ele.
-- =============================================================================

alter type risk_bucket add value if not exists 'NAO_CLASSIFICADO';

comment on column assets.risk_bucket is
  'Papel e limite de tamanho da posição. NAO_CLASSIFICADO = pendente de decisão do gestor; nenhum teto por bucket se aplica.';
