-- =============================================================================
-- SEED DEMONSTRATIVO — Gestão Global da Carteira | Aposentadoria 70
-- =============================================================================
-- ⚠️ TODOS OS NÚMEROS AQUI SÃO EXEMPLO, NÃO DADOS OFICIAIS.
-- Cada ativo criado leva is_demo = TRUE. A UI deve exibir aviso enquanto
-- existir qualquer registro demonstrativo na base.
--
-- Reproduz o perfil descrito no briefing:
--   patrimônio financeiro   R$ 1.045.000
--   imóvel (fora da conta)  R$ 1.300.000
--   idade 57, aposentadoria aos 70, aporte R$ 10.000/mês reais
--   meta R$ 25.000/mês reais, retorno real base 5% a.a.
--
-- DESTAQUE: GOOGL aparece na Avenue E na Interactive Brokers. É o caso que
-- demonstra o princípio fundamental — custódia separada, exposição somada.
--
-- USO
--   O seed precisa de um usuário existente no Supabase Auth. Ele usa, nesta
--   ordem: app.seed_user_id (se definido) ou o usuário mais antigo do projeto.
--
--     psql "$DATABASE_URL" -f supabase/seed.sql
--     psql "$DATABASE_URL" -c "set app.seed_user_id='<uuid>'" -f supabase/seed.sql
--
--   IDs são derivados por md5(user || chave), então o seed é IDEMPOTENTE:
--   rodar duas vezes atualiza em vez de duplicar.
-- =============================================================================

do $$
declare
  v_user       uuid;
  v_usdbrl     numeric := 5.42;
  v_ref_date   date    := date '2026-06-30';
  v_prev_date  date    := date '2026-05-31';
  -- Fator para derivar o fechamento anterior (R$ 1.020.000 / R$ 1.045.000)
  v_prev_ratio numeric := 1020000.0 / 1045000.0;
  v_snap_jun   uuid;
  v_snap_mai   uuid;
begin
  -- ---------------------------------------------------------------------------
  -- Usuário alvo
  -- ---------------------------------------------------------------------------
  v_user := coalesce(
    nullif(current_setting('app.seed_user_id', true), '')::uuid,
    (select id from auth.users order by created_at limit 1)
  );

  if v_user is null then
    raise exception
      'Nenhum usuário encontrado. Crie a conta pelo login da aplicação e rode o seed novamente.';
  end if;

  insert into profiles (id, full_name, display_name, base_currency)
  values (v_user, 'Investidor (demo)', 'Investidor', 'BRL')
  on conflict (id) do nothing;

  raise notice 'Semeando dados demonstrativos para o usuário %', v_user;

  -- ---------------------------------------------------------------------------
  -- Plano de aposentadoria — TUDO EM REAIS REAIS
  -- ---------------------------------------------------------------------------
  -- birth_date em vez de idade: 15/03/1969 => 57 anos em julho de 2026.
  -- O aporte de R$ 10.000 é REAL e constante em poder de compra.
  insert into retirement_plan (
    id, user_id, birth_date, retirement_age,
    monthly_real_income_target, monthly_real_contribution,
    expected_real_return, reference_withdrawal_rate, withdrawal_rates, is_active
  ) values (
    md5(v_user::text || 'plan:main')::uuid, v_user,
    date '1969-03-15', 70,
    25000.00, 10000.00,
    0.05, 0.04, array[0.035, 0.039, 0.040], true
  )
  on conflict (id) do update set
    monthly_real_income_target = excluded.monthly_real_income_target,
    monthly_real_contribution  = excluded.monthly_real_contribution,
    expected_real_return       = excluded.expected_real_return;

  -- ---------------------------------------------------------------------------
  -- Imóvel — fora do patrimônio financeiro investível
  -- ---------------------------------------------------------------------------
  insert into real_estate (
    id, user_id, description, estimated_value, currency,
    include_in_retirement_portfolio, valuation_date
  ) values (
    md5(v_user::text || 'imovel:residencia')::uuid, v_user,
    'Imóvel residencial (demo)', 1300000.00, 'BRL', false, v_ref_date
  )
  on conflict (id) do update set estimated_value = excluded.estimated_value;

  -- ---------------------------------------------------------------------------
  -- Política de investimentos
  -- ---------------------------------------------------------------------------
  -- Caixa BR: alvo 0%, banda 0-3% — colchão operacional temporário, não classe
  -- estratégica. Os alvos centrais somam 100% sem ele.
  insert into allocation_targets (
    id, user_id, asset_class, target_percentage, minimum_percentage, maximum_percentage
  )
  select md5(v_user::text || 'target:' || c.cls)::uuid, v_user, c.cls::asset_class, c.tgt, c.mn, c.mx
  from (values
    ('RF_BRASIL',                35.0, 28.0, 42.0),
    ('ACOES_BRASIL',             15.0, 10.0, 20.0),
    ('ACOES_ETF_EXTERIOR',       30.0, 24.0, 36.0),
    ('RF_CAIXA_EXTERIOR',         8.0,  4.0, 12.0),
    ('FII_IMOBILIARIO',           9.0,  6.0, 13.0),
    ('MULTIMERCADO_ALTERNATIVO',  3.0,  0.0,  6.0),
    ('CAIXA_BR',                  0.0,  0.0,  3.0)
  ) as c(cls, tgt, mn, mx)
  on conflict (id) do update set
    target_percentage  = excluded.target_percentage,
    minimum_percentage = excluded.minimum_percentage,
    maximum_percentage = excluded.maximum_percentage;

  -- ---------------------------------------------------------------------------
  -- Limites de risco (avaliados sobre a exposição CONSOLIDADA)
  -- ---------------------------------------------------------------------------
  -- CORE tem faixa de atenção explícita (5,00%–5,50%): oscilação de preço não
  -- deve virar ordem de venda. DEFENSIVE isenta o Tesouro — teto individual
  -- mede risco de emissor único, e soberano é monitorado por outros recortes.
  insert into risk_limits (
    id, user_id, scope, scope_key,
    max_percentage, warn_percentage, exempt_asset_types, description
  )
  select md5(v_user::text || 'limit:' || l.scope || ':' || coalesce(l.key, '*'))::uuid,
         v_user, l.scope::risk_limit_scope, l.key, l.pct, l.warn, l.exempt, l.descr
  from (values
    ('SINGLE_ASSET', 'CORE',        5.50,  5.00::numeric, '{}'::text[],
     'Ação core: atenção a partir de 5%, violação acima de 5,5%'),
    ('SINGLE_ASSET', 'GROWTH',      3.00,  null,          '{}'::text[],
     'Growth individual: máximo 3%'),
    ('SINGLE_ASSET', 'SATELLITE',   2.00,  null,          '{}'::text[],
     'Satélite individual: máximo 2%'),
    ('SINGLE_ASSET', 'ASYMMETRIC',  0.50,  null,          '{}'::text[],
     'Posição assimétrica: máximo 0,50%'),
    ('SINGLE_ASSET', 'DEFENSIVE',   3.00,  null,          '{TESOURO_DIRETO}'::text[],
     'Defensiva individual: máximo 3%; Tesouro Direto isento'),
    ('SECTOR',       null,         25.00,  null,          '{}'::text[],
     'Concentração máxima por setor'),
    ('COUNTRY',      'BR',         70.00,  null,          '{}'::text[],
     'Concentração máxima em Brasil'),
    ('CURRENCY',     'BRL',        75.00,  null,          '{}'::text[],
     'Exposição máxima a BRL')
  ) as l(scope, key, pct, warn, exempt, descr)
  on conflict (id) do update set
    max_percentage     = excluded.max_percentage,
    warn_percentage    = excluded.warn_percentage,
    exempt_asset_types = excluded.exempt_asset_types,
    description        = excluded.description;

  -- ---------------------------------------------------------------------------
  -- Benchmarks (valores mensais entram manualmente no MVP)
  -- ---------------------------------------------------------------------------
  insert into benchmarks (id, user_id, code, name, value_kind)
  select md5(v_user::text || 'bench:' || b.code)::uuid, v_user, b.code, b.nm, b.kind
  from (values
    ('CDI',      'CDI',                  'PERCENTUAL_MENSAL'),
    ('IPCA',     'IPCA',                 'PERCENTUAL_MENSAL'),
    ('IBOVESPA', 'Ibovespa',             'PERCENTUAL_MENSAL'),
    ('SP500',    'S&P 500',              'PERCENTUAL_MENSAL'),
    ('USDBRL',   'Dólar comercial (PTAX)', 'NIVEL')
  ) as b(code, nm, kind)
  on conflict (id) do nothing;

  -- IPCA de junho/2026: sem ele o retorno REAL do mês seria exibido como "—"
  insert into benchmark_values (id, user_id, benchmark_id, reference_month, value)
  values (
    md5(v_user::text || 'benchval:IPCA:2026-06')::uuid, v_user,
    md5(v_user::text || 'bench:IPCA')::uuid, date '2026-06-01', 0.32
  )
  on conflict (id) do update set value = excluded.value;

  -- ---------------------------------------------------------------------------
  -- Câmbio
  -- ---------------------------------------------------------------------------
  insert into fx_rates (id, user_id, date, currency_from, currency_to, rate, source)
  values
    (md5(v_user::text || 'fx:2026-06-30')::uuid, v_user, v_ref_date,  'USD', 'BRL', v_usdbrl, 'demo'),
    (md5(v_user::text || 'fx:2026-05-31')::uuid, v_user, v_prev_date, 'USD', 'BRL', 5.38,     'demo')
  on conflict (id) do update set rate = excluded.rate;

  -- ---------------------------------------------------------------------------
  -- Corretoras e contas
  -- ---------------------------------------------------------------------------
  insert into brokers (id, user_id, name, country, base_currency)
  select md5(v_user::text || 'broker:' || b.nm)::uuid, v_user, b.nm, b.ctry, b.cur
  from (values
    ('XP Investimentos',   'BR', 'BRL'),
    ('BTG Pactual',        'BR', 'BRL'),
    ('Avenue',             'US', 'USD'),
    ('Interactive Brokers','US', 'USD')
  ) as b(nm, ctry, cur)
  on conflict (id) do nothing;

  insert into accounts (id, user_id, broker_id, name, currency)
  select md5(v_user::text || 'account:' || a.nm)::uuid, v_user,
         md5(v_user::text || 'broker:' || a.broker)::uuid, a.nm, a.cur
  from (values
    ('XP - Conta Principal',  'XP Investimentos',    'BRL'),
    ('BTG - Conta Principal', 'BTG Pactual',         'BRL'),
    ('Avenue - Conta USD',    'Avenue',              'USD'),
    ('IBKR - Conta USD',      'Interactive Brokers', 'USD')
  ) as a(nm, broker, cur)
  on conflict (id) do nothing;

  -- ---------------------------------------------------------------------------
  -- Catálogo de ativos
  -- ---------------------------------------------------------------------------
  insert into assets (
    id, user_id, ticker, name, exchange, asset_type, asset_class,
    country, currency, sector, risk_bucket, indexador, investment_style, is_demo
  )
  select md5(v_user::text || 'asset:' || a.tk)::uuid, v_user, a.tk, a.nm, a.exch,
         a.atype::asset_type, a.acls::asset_class, a.ctry, a.cur, a.sect,
         a.bucket::risk_bucket, a.idx::rate_index, a.style::investment_style, true
  from (values
    -- Renda Fixa Brasil
    ('TESOURO_IPCA_2035','Tesouro IPCA+ 2035','N/A','TESOURO_DIRETO','RF_BRASIL','BR','BRL',null,'DEFENSIVE','IPCA','RENDA'),
    ('TESOURO_SELIC_2029','Tesouro Selic 2029','N/A','TESOURO_DIRETO','RF_BRASIL','BR','BRL',null,'DEFENSIVE','SELIC','RENDA'),
    ('CDB_BTG_110','CDB BTG 110% CDI','N/A','CDB','RF_BRASIL','BR','BRL',null,'DEFENSIVE','CDI','RENDA'),
    ('DEB_ENGIE_28','Debênture Incentivada Engie 2028','N/A','DEBENTURE','RF_BRASIL','BR','BRL','Energia','DEFENSIVE','IPCA','RENDA'),
    ('CRI_HABITAT_30','CRI Habitat 2030','N/A','CRI','RF_BRASIL','BR','BRL','Imobiliário','DEFENSIVE','IPCA','RENDA'),
    ('CRA_RAIZEN_29','CRA Raízen 2029','N/A','CRA','RF_BRASIL','BR','BRL','Consumo','DEFENSIVE','CDI','RENDA'),
    -- Ações Brasil
    ('ITUB4','Itaú Unibanco PN','B3','ACAO','ACOES_BRASIL','BR','BRL','Financeiro','CORE','NONE','VALUE'),
    ('PETR4','Petrobras PN','B3','ACAO','ACOES_BRASIL','BR','BRL','Energia','CORE','NONE','VALUE'),
    ('WEGE3','WEG ON','B3','ACAO','ACOES_BRASIL','BR','BRL','Industriais','CORE','NONE','QUALIDADE'),
    ('VALE3','Vale ON','B3','ACAO','ACOES_BRASIL','BR','BRL','Materiais','CORE','NONE','VALUE'),
    ('TOTS3','Totvs ON','B3','ACAO','ACOES_BRASIL','BR','BRL','Tecnologia','GROWTH','NONE','GROWTH'),
    -- Ações/ETFs Exterior
    ('VOO','Vanguard S&P 500 ETF','ARCA','ETF','ACOES_ETF_EXTERIOR','US','USD',null,'CORE','NONE','INDICE'),
    ('GOOGL','Alphabet Inc. Class A','NASDAQ','ACAO','ACOES_ETF_EXTERIOR','US','USD','Tecnologia','CORE','NONE','GROWTH'),
    ('MSFT','Microsoft Corporation','NASDAQ','ACAO','ACOES_ETF_EXTERIOR','US','USD','Tecnologia','CORE','NONE','QUALIDADE'),
    ('BRK.B','Berkshire Hathaway Class B','NYSE','ACAO','ACOES_ETF_EXTERIOR','US','USD','Financeiro','CORE','NONE','VALUE'),
    ('VWO','Vanguard Emerging Markets ETF','ARCA','ETF','ACOES_ETF_EXTERIOR','CN','USD',null,'SATELLITE','NONE','INDICE'),
    ('NVDA','NVIDIA Corporation','NASDAQ','ACAO','ACOES_ETF_EXTERIOR','US','USD','Tecnologia','GROWTH','NONE','GROWTH'),
    -- Renda Fixa / Caixa Exterior
    ('SHY','iShares 1-3 Year Treasury Bond ETF','ARCA','ETF','RF_CAIXA_EXTERIOR','US','USD',null,'DEFENSIVE','USD_FIXED','RENDA'),
    ('CASH_USD','Caixa em dólar','N/A','CAIXA','RF_CAIXA_EXTERIOR','US','USD',null,'CASH','NONE','NAO_APLICAVEL'),
    -- FIIs
    ('HGLG11','CSHG Logística FII','B3','FII','FII_IMOBILIARIO','BR','BRL','Imobiliário','CORE','NONE','DIVIDENDOS'),
    ('KNRI11','Kinea Renda Imobiliária FII','B3','FII','FII_IMOBILIARIO','BR','BRL','Imobiliário','CORE','NONE','DIVIDENDOS'),
    ('MXRF11','Maxi Renda FII','B3','FII','FII_IMOBILIARIO','BR','BRL','Imobiliário','CORE','NONE','DIVIDENDOS'),
    ('XPML11','XP Malls FII','B3','FII','FII_IMOBILIARIO','BR','BRL','Imobiliário','CORE','NONE','DIVIDENDOS'),
    -- Multimercados
    ('FUNDO_VERDE','Verde AM Scorpion FIC FIM','N/A','FUNDO','MULTIMERCADO_ALTERNATIVO','BR','BRL',null,'SATELLITE','NONE','NAO_APLICAVEL')
  ) as a(tk, nm, exch, atype, acls, ctry, cur, sect, bucket, idx, style)
  on conflict (id) do update set
    asset_class = excluded.asset_class,
    risk_bucket = excluded.risk_bucket;

  -- GOOGL34 (BDR) declarado como instrumento distinto que representa a MESMA
  -- exposição econômica de GOOGL. Sem posição no MVP: existe para demonstrar o
  -- modelo de identidade (underlying_asset_id + exposure_ratio).
  insert into assets (
    id, user_id, ticker, name, exchange, asset_type, asset_class,
    country, currency, sector, risk_bucket, underlying_asset_id, exposure_ratio, is_demo
  ) values (
    md5(v_user::text || 'asset:GOOGL34')::uuid, v_user, 'GOOGL34',
    'Alphabet BDR', 'B3', 'ACAO', 'ACOES_ETF_EXTERIOR', 'US', 'BRL', 'Tecnologia', 'CORE',
    md5(v_user::text || 'asset:GOOGL')::uuid, 0.0833333333, true
  )
  on conflict (id) do nothing;

  -- Aliases: como cada corretora nomeia o mesmo papel nos seus arquivos
  insert into asset_aliases (id, user_id, asset_id, broker_id, external_ticker)
  select md5(v_user::text || 'alias:' || al.broker || ':' || al.ext)::uuid, v_user,
         md5(v_user::text || 'asset:' || al.tk)::uuid,
         md5(v_user::text || 'broker:' || al.broker)::uuid, al.ext
  from (values
    ('GOOGL', 'Avenue',              'GOOGL'),
    ('GOOGL', 'Interactive Brokers', 'GOOGL US EQUITY'),
    ('BRK.B', 'Avenue',              'BRK.B'),
    ('BRK.B', 'Interactive Brokers', 'BRK B'),
    ('VOO',   'Avenue',              'VOO')
  ) as al(tk, broker, ext)
  on conflict (id) do nothing;

  -- ---------------------------------------------------------------------------
  -- Posições em 30/06/2026 — total R$ 1.045.000
  -- ---------------------------------------------------------------------------
  -- GOOGL aparece DUAS VEZES, em corretoras diferentes. É o caso de teste vivo
  -- do princípio custódia-vs-exposição.
  insert into positions (
    id, user_id, account_id, asset_id, quantity, average_cost, current_price, reference_date
  )
  select md5(v_user::text || 'pos:' || p.acct || ':' || p.tk)::uuid, v_user,
         md5(v_user::text || 'account:' || p.acct)::uuid,
         md5(v_user::text || 'asset:' || p.tk)::uuid,
         p.qty, p.avg_cost, p.price, v_ref_date
  from (values
    -- Renda Fixa Brasil — R$ 480.700 (46%)
    ('XP - Conta Principal',  'TESOURO_IPCA_2035',   30.0,          3750.00,  4000.00),
    ('XP - Conta Principal',  'TESOURO_SELIC_2029',   6.0,         14500.00, 15000.00),
    ('BTG - Conta Principal', 'CDB_BTG_110',     110700.0,             1.00,     1.00),
    ('XP - Conta Principal',  'DEB_ENGIE_28',        50.0,          1150.00,  1200.00),
    ('XP - Conta Principal',  'CRI_HABITAT_30',      50.0,          1050.00,  1100.00),
    ('XP - Conta Principal',  'CRA_RAIZEN_29',       50.0,           880.00,   900.00),
    -- Ações Brasil — R$ 156.750 (15%)
    ('XP - Conta Principal',  'ITUB4',         1304.34782609,         28.40,    34.50),
    ('XP - Conta Principal',  'PETR4',         1000.0,                31.20,    38.00),
    ('XP - Conta Principal',  'WEGE3',          615.38461538,         44.80,    52.00),
    ('XP - Conta Principal',  'VALE3',          500.0,                61.30,    53.50),
    ('XP - Conta Principal',  'TOTS3',          400.0,                29.90,    37.50),
    -- Ações/ETFs Exterior — US$ 38.560,8856 => R$ 209.000 (20%)
    ('Avenue - Conta USD',    'VOO',             22.01834862,        472.30,   545.00),
    ('Avenue - Conta USD',    'GOOGL',           22.40896359,        141.80,   178.50),  -- << mesma
    ('IBKR - Conta USD',      'GOOGL',           19.60784314,        152.40,   178.50),  -- << empresa
    ('IBKR - Conta USD',      'MSFT',            14.11764706,        372.10,   425.00),
    ('Avenue - Conta USD',    'BRK.B',           10.75268817,        408.60,   465.00),
    ('IBKR - Conta USD',      'VWO',             86.02150538,         41.20,    46.50),
    ('Avenue - Conta USD',    'NVDA',            31.72567188,         96.40,   128.00),
    -- Renda Fixa / Caixa Exterior — US$ 5.784,1328 => R$ 31.350 (3%)
    ('IBKR - Conta USD',      'SHY',             36.36363636,         81.90,    82.50),
    ('Avenue - Conta USD',    'CASH_USD',      2784.1328,              1.00,     1.00),
    -- FIIs — R$ 135.850 (13%)
    ('XP - Conta Principal',  'HGLG11',         250.0,               152.30,   160.00),
    ('XP - Conta Principal',  'KNRI11',         250.0,               133.70,   140.00),
    ('XP - Conta Principal',  'MXRF11',        2995.14563107,          9.85,    10.30),
    ('XP - Conta Principal',  'XPML11',         300.0,                94.20,   100.00),
    -- Multimercados — R$ 31.350 (3%)
    ('BTG - Conta Principal', 'FUNDO_VERDE',  10000.0,                 2.87,     3.135)
  ) as p(acct, tk, qty, avg_cost, price)
  on conflict (id) do update set
    quantity      = excluded.quantity,
    current_price = excluded.current_price;

  -- ---------------------------------------------------------------------------
  -- Fluxos de caixa — aporte é APORTE, não rentabilidade
  -- ---------------------------------------------------------------------------
  insert into portfolio_cash_flows (
    id, user_id, date, flow_type, amount, currency, fx_rate_used, notes
  )
  -- Datas REAIS de aporte (dia 10 de cada mês), não o último dia do período.
  -- O Modified Dietz pondera cada fluxo pelo tempo em que ficou investido:
  -- um aporte no dia 10 de um período de 30 dias pesa 2/3, não 0,5.
  select md5(v_user::text || 'flow:' || f.dt)::uuid, v_user, f.dt::date,
         'CONTRIBUTION'::cash_flow_type, 10000.00, 'BRL', 1, 'Aporte mensal (demo)'
  from (values ('2026-04-10'), ('2026-05-11'), ('2026-06-10')) as f(dt)
  on conflict (id) do nothing;

  -- ---------------------------------------------------------------------------
  -- Fechamentos mensais
  -- ---------------------------------------------------------------------------
  -- Dois meses fechados para que a rentabilidade do mês seja CALCULÁVEL.
  -- Com apenas um snapshot, o sistema exibiria "—" em vez de inventar retorno.
  --
  --   maio/2026:  R$ 1.020.000
  --   junho/2026: R$ 1.045.000, com aporte de R$ 10.000
  --   ganho de mercado = 1.045.000 − 1.020.000 − 10.000 = R$ 15.000
  --
  -- Os snapshots nascem RASCUNHO, recebem as linhas congeladas e só então são
  -- FECHADOS — a partir daí os triggers da migration 0009 os tornam imutáveis.
  -- ---------------------------------------------------------------------------
  v_snap_mai := md5(v_user::text || 'snapshot:2026-05')::uuid;
  v_snap_jun := md5(v_user::text || 'snapshot:2026-06')::uuid;

  -- Remove fechamentos anteriores do seed para permitir re-execução limpa
  set local app.allow_snapshot_mutation = 'on';
  delete from portfolio_snapshots where id in (v_snap_mai, v_snap_jun);
  set local app.allow_snapshot_mutation = 'off';

  insert into portfolio_snapshots (
    id, user_id, reference_date, status, total_value_brl, real_estate_value_brl,
    contributions_month, withdrawals_month, usd_brl_rate, notes
  ) values
    (v_snap_mai, v_user, v_prev_date, 'RASCUNHO', 1020000.00, 1300000.00, 10000.00, 0, 5.38,
     'Fechamento demonstrativo'),
    (v_snap_jun, v_user, v_ref_date,  'RASCUNHO', 1045000.00, 1300000.00, 10000.00, 0, v_usdbrl,
     'Fechamento demonstrativo');

  -- Junho: fotografia congelada a partir das posições correntes
  insert into snapshot_positions (
    id, user_id, snapshot_id, asset_id, account_id,
    ticker, asset_name, broker_name, account_name,
    asset_class, risk_bucket, country, sector, currency,
    quantity, average_cost, price, value_original, fx_rate_to_brl, value_brl
  )
  select
    md5(v_user::text || 'snappos:2026-06:' || p.id::text)::uuid, v_user, v_snap_jun,
    p.asset_id, p.account_id,
    a.ticker, a.name, b.name, ac.name,
    a.asset_class, a.risk_bucket, a.country, a.sector, a.currency,
    p.quantity, p.average_cost, p.current_price,
    round(p.quantity * p.current_price, 2),
    case when a.currency = 'BRL' then 1 else v_usdbrl end,
    round(p.quantity * p.current_price * case when a.currency = 'BRL' then 1 else v_usdbrl end, 2)
  from positions p
  join assets   a  on a.id  = p.asset_id
  join accounts ac on ac.id = p.account_id
  join brokers  b  on b.id  = ac.broker_id
  where p.user_id = v_user and p.reference_date = v_ref_date;

  -- Maio: derivado de junho por um fator, mantendo a estrutura idêntica
  insert into snapshot_positions (
    id, user_id, snapshot_id, asset_id, account_id,
    ticker, asset_name, broker_name, account_name,
    asset_class, risk_bucket, country, sector, currency,
    quantity, average_cost, price, value_original, fx_rate_to_brl, value_brl
  )
  select
    md5(v_user::text || 'snappos:2026-05:' || sp.asset_id::text || sp.account_id::text)::uuid,
    v_user, v_snap_mai, sp.asset_id, sp.account_id,
    sp.ticker, sp.asset_name, sp.broker_name, sp.account_name,
    sp.asset_class, sp.risk_bucket, sp.country, sp.sector, sp.currency,
    sp.quantity, sp.average_cost,
    round(sp.price * v_prev_ratio, 8),
    round(sp.value_original * v_prev_ratio, 2),
    case when sp.currency = 'BRL' then 1 else 5.38 end,
    round(sp.value_original * v_prev_ratio * case when sp.currency = 'BRL' then 1 else 5.38 end, 2)
  from snapshot_positions sp
  where sp.snapshot_id = v_snap_jun;

  -- Alocação por classe, com a política vigente congelada junto
  insert into snapshot_allocations (
    id, user_id, snapshot_id, asset_class, value_brl, percentage,
    target_percentage, minimum_percentage, maximum_percentage
  )
  select
    md5(v_user::text || 'snapalloc:' || s.id::text || ':' || sp.asset_class::text)::uuid,
    v_user, s.id, sp.asset_class,
    sum(sp.value_brl),
    round(100 * sum(sp.value_brl) / nullif(s.total_value_brl, 0), 4),
    t.target_percentage, t.minimum_percentage, t.maximum_percentage
  from snapshot_positions sp
  join portfolio_snapshots s on s.id = sp.snapshot_id
  join allocation_targets t on t.user_id = v_user and t.asset_class = sp.asset_class
  where s.id in (v_snap_mai, v_snap_jun)
  group by s.id, s.total_value_brl, sp.asset_class,
           t.target_percentage, t.minimum_percentage, t.maximum_percentage;

  -- CONFIRMA os fechamentos: a partir daqui, imutáveis
  update portfolio_snapshots
     set status = 'FECHADO'
   where id in (v_snap_mai, v_snap_jun);

  raise notice 'Seed concluído. Patrimônio financeiro: R$ 1.045.000 | Imóvel: R$ 1.300.000 (fora da projeção)';
  raise notice 'GOOGL custodiado na Avenue e na Interactive Brokers — exposição consolidada.';
end;
$$;
