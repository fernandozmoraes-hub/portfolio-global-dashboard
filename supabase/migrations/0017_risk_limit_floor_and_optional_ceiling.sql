-- =============================================================================
-- 0017 — Piso de vigilância e teto opcional nos limites de risco
-- =============================================================================
-- Nem todo risco é excesso. Um bucket de caixa que seca deixa a carteira sem
-- colchão para resgate e sem munição para oportunidade — e nenhum teto
-- detectaria isso, porque caixa baixo é justamente o que um teto aprova.
--
-- Duas consequências no schema:
--
-- 1. TETO OPCIONAL. Caixa não tem teto de risco: o problema com caixa é
--    faltar, não sobrar. `max_percentage` deixa de ser obrigatório para que um
--    limite possa ter só o lado do piso. O check garante que todo limite tenha
--    pelo menos um dos dois lados — um limite sem teto e sem piso não limita
--    nada e seria linha morta na tabela.
--
-- 2. PISO DE VIGILÂNCIA. Abaixo de `warn_below_percentage` o alerta é de
--    SUBEXPOSIÇÃO. Não existe lado duro no piso: falta de caixa é sinal para
--    olhar, não regra que se viola.
--
-- O piso só se aplica a escopos AGREGADOS (bucket, setor, país, moeda). Em
-- SINGLE_ASSET ele é ignorado pelo domínio: um piso por ativo individual
-- acusaria toda posição pequena da carteira, o que não é informação.
-- =============================================================================

alter table risk_limits
  add column if not exists warn_below_percentage numeric(7, 4);

alter table risk_limits
  alter column max_percentage drop not null;

alter table risk_limits
  drop constraint if exists risk_limits_has_some_bound;

alter table risk_limits
  add constraint risk_limits_has_some_bound check (
    max_percentage is not null or warn_below_percentage is not null
  );

-- Piso acima do teto descreveria uma faixa vazia: toda exposição estaria
-- simultaneamente abaixo do piso e acima do teto.
alter table risk_limits
  drop constraint if exists risk_limits_floor_below_ceiling;

alter table risk_limits
  add constraint risk_limits_floor_below_ceiling check (
    warn_below_percentage is null
    or max_percentage is null
    or warn_below_percentage <= max_percentage
  );

comment on column risk_limits.max_percentage is
  'Teto em % da carteira global. Nulo = limite sem lado de teto (ex.: piso de caixa).';

comment on column risk_limits.warn_below_percentage is
  'Piso de vigilância em %. Abaixo disso o alerta é de subexposição. Só se aplica a escopos agregados.';
