-- =============================================================================
-- 0009 — Imutabilidade dos snapshots fechados
-- =============================================================================
-- O briefing marca como FUNDAMENTAL que o passado não seja reescrito.
--
-- DECISÃO DE ARQUITETURA: essa garantia é imposta pelo BANCO, não pela
-- aplicação. Uma regra crítica de negócio não pode depender da disciplina do
-- código que a chama — nem de um bug futuro num Server Action.
--
-- Válvula de escape: `app.allow_snapshot_mutation = 'on'` na sessão. Existe
-- para operações administrativas legítimas (exclusão de conta de usuário em
-- cascata, correção de fechamento com erro comprovado). Deve ser usada com
-- `SET LOCAL`, dentro de transação, e jamais pelo runtime da aplicação.
-- =============================================================================

create or replace function mutation_is_allowed()
returns boolean
language plpgsql
stable
as $$
begin
  return coalesce(current_setting('app.allow_snapshot_mutation', true), 'off') = 'on';
end;
$$;

comment on function mutation_is_allowed() is
  'Válvula de escape administrativa para alterar snapshots fechados.';

-- -----------------------------------------------------------------------------
-- Guarda do snapshot em si
-- -----------------------------------------------------------------------------
-- Permite a transição RASCUNHO -> FECHADO (OLD.status ainda é RASCUNHO).
-- A partir daí, qualquer UPDATE ou DELETE é rejeitado.
-- -----------------------------------------------------------------------------
create or replace function guard_closed_snapshot()
returns trigger
language plpgsql
as $$
begin
  if mutation_is_allowed() then
    return coalesce(new, old);
  end if;

  if old.status = 'FECHADO' then
    raise exception
      'Snapshot de % está FECHADO e é imutável. Fechamentos não podem ser alterados nem excluídos.',
      to_char(old.reference_date, 'MM/YYYY')
      using errcode = 'integrity_constraint_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger trg_guard_closed_snapshot
  before update or delete on portfolio_snapshots
  for each row execute function guard_closed_snapshot();

-- -----------------------------------------------------------------------------
-- Guarda das tabelas filhas
-- -----------------------------------------------------------------------------
-- Bloqueia INSERT também: não se pode acrescentar uma posição a um fechamento
-- já confirmado.
-- -----------------------------------------------------------------------------
create or replace function guard_closed_snapshot_child()
returns trigger
language plpgsql
as $$
declare
  v_snapshot_id uuid;
  v_status      snapshot_status;
  v_date        date;
begin
  if mutation_is_allowed() then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    v_snapshot_id := old.snapshot_id;
  else
    v_snapshot_id := new.snapshot_id;
  end if;

  select status, reference_date
    into v_status, v_date
    from portfolio_snapshots
   where id = v_snapshot_id;

  -- Snapshot já removido (cascata autorizada em outro nível): nada a proteger.
  if v_status is null then
    return coalesce(new, old);
  end if;

  if v_status = 'FECHADO' then
    raise exception
      'O fechamento de % está FECHADO. Suas posições congeladas não podem ser alteradas.',
      to_char(v_date, 'MM/YYYY')
      using errcode = 'integrity_constraint_violation';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger trg_guard_snapshot_positions
  before insert or update or delete on snapshot_positions
  for each row execute function guard_closed_snapshot_child();

create trigger trg_guard_snapshot_allocations
  before insert or update or delete on snapshot_allocations
  for each row execute function guard_closed_snapshot_child();

-- -----------------------------------------------------------------------------
-- Carimbo automático de fechamento
-- -----------------------------------------------------------------------------
-- Garante que closed_at seja sempre coerente com a transição de status,
-- satisfazendo snapshots_closed_requires_metadata sem depender da aplicação.
-- -----------------------------------------------------------------------------
create or replace function stamp_snapshot_closure()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'FECHADO' and (old.status is distinct from 'FECHADO') then
    new.closed_at := coalesce(new.closed_at, now());
  end if;
  return new;
end;
$$;

-- BEFORE UPDATE, registrado após a guarda (ordem alfabética dos nomes de
-- trigger: "trg_guard_..." vem antes de "trg_stamp_...").
create trigger trg_stamp_snapshot_closure
  before update on portfolio_snapshots
  for each row execute function stamp_snapshot_closure();
