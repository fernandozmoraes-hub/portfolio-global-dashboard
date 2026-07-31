-- =============================================================================
-- 0016 — Faixa de atenção e isenções nos limites de risco
-- =============================================================================
-- Dois furos que só aparecem com carteira real:
--
-- 1. FAIXA DE ATENÇÃO. Até aqui o amarelo era fixo em 90% do teto. Uma ação
--    core com teto de 5% ficava amarela a partir de 4,5% e vermelha a 5,01% —
--    o que transforma oscilação de preço em ordem de venda. Com warn e max
--    separados (5,00% e 5,50%), a faixa entre os dois é de monitoramento, não
--    de ação.
--
-- 2. ISENÇÃO POR TIPO DE ATIVO. Teto individual mede risco de emissor único.
--    Concentrar em NTN-B não é o mesmo risco que concentrar numa empresa: o
--    soberano é monitorado por classe, emissor, duration e vencimento. Sem
--    isenção, a única saída seria não ter limite nenhum no bucket inteiro.
--
-- Ambas as colunas são opcionais: limite sem warn continua usando 90% do teto,
-- e limite sem isenção continua valendo para todos os tipos.
-- =============================================================================

alter table risk_limits
  add column if not exists warn_percentage numeric(7, 4),
  add column if not exists exempt_asset_types text[] not null default '{}';

-- Faixa de atenção precisa estar dentro do intervalo e abaixo do teto: warn
-- acima do max nunca dispararia, e o limite ficaria silenciosamente sem
-- alerta amarelo.
alter table risk_limits
  drop constraint if exists risk_limits_warn_percentage_valid;

alter table risk_limits
  add constraint risk_limits_warn_percentage_valid check (
    warn_percentage is null
    or (warn_percentage >= 0 and warn_percentage <= max_percentage)
  );

comment on column risk_limits.warn_percentage is
  'Início da faixa de atenção, em % da carteira. Nulo = 90% do teto. Separa ruído de mercado de decisão de rebalanceamento.';

comment on column risk_limits.exempt_asset_types is
  'Tipos de ativo aos quais o teto NÃO se aplica (ex.: TESOURO_DIRETO no bucket DEFENSIVE). Vazio = vale para todos.';
