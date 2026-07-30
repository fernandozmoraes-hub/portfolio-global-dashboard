-- =============================================================================
-- 0010 — Row Level Security
-- =============================================================================
-- Aplicação pessoal: um usuário só enxerga os próprios dados, sem exceção.
--
-- PADRÃO USADO: `(select auth.uid()) = user_id`.
-- O `select` envolvendo auth.uid() faz o Postgres tratá-la como InitPlan,
-- avaliando uma única vez por consulta em vez de uma vez por linha — diferença
-- relevante em tabelas como snapshot_positions.
--
-- Todas as tabelas usam FORCE ROW LEVEL SECURITY: nem o dono da tabela escapa
-- das policies. O service_role continua ignorando RLS por desenho do Postgres
-- (BYPASSRLS), e por isso seu uso é restrito a scripts administrativos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles: a coluna de posse é `id`, não `user_id`
-- -----------------------------------------------------------------------------
alter table profiles enable row level security;
alter table profiles force row level security;

create policy "profiles_select_own" on profiles
  for select to authenticated using ((select auth.uid()) = id);

create policy "profiles_update_own" on profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- INSERT é feito pelo trigger handle_new_user (security definer).
-- DELETE acontece em cascata a partir de auth.users — nunca pela aplicação.

-- -----------------------------------------------------------------------------
-- Demais tabelas: posse por user_id, mesmo padrão em todas
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  owned_tables text[] := array[
    'brokers',
    'accounts',
    'assets',
    'asset_aliases',
    'positions',
    'transactions',
    'income',
    'portfolio_cash_flows',
    'fx_rates',
    'portfolio_snapshots',
    'snapshot_positions',
    'snapshot_allocations',
    'allocation_targets',
    'risk_limits',
    'retirement_plan',
    'real_estate',
    'column_mappings',
    'import_batches',
    'import_rows',
    'benchmarks',
    'benchmark_values'
  ];
begin
  foreach t in array owned_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);

    execute format($p$
      create policy %I on %I
        for select to authenticated
        using ((select auth.uid()) = user_id)
    $p$, t || '_select_own', t);

    execute format($p$
      create policy %I on %I
        for insert to authenticated
        with check ((select auth.uid()) = user_id)
    $p$, t || '_insert_own', t);

    execute format($p$
      create policy %I on %I
        for update to authenticated
        using ((select auth.uid()) = user_id)
        with check ((select auth.uid()) = user_id)
    $p$, t || '_update_own', t);

    execute format($p$
      create policy %I on %I
        for delete to authenticated
        using ((select auth.uid()) = user_id)
    $p$, t || '_delete_own', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Verificação: nenhuma tabela do schema public pode ficar sem RLS
-- -----------------------------------------------------------------------------
-- Falha a migration em vez de deixar passar uma tabela desprotegida.
-- -----------------------------------------------------------------------------
do $$
declare
  unprotected text;
begin
  select string_agg(c.relname, ', ')
    into unprotected
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity;

  if unprotected is not null then
    raise exception 'Tabelas sem RLS habilitada: %', unprotected;
  end if;
end;
$$;
