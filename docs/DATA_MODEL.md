# Modelo de dados

24 tabelas, todas com UUID, `user_id` e RLS. Migrations em
`supabase/migrations/`, aplicadas em ordem numérica.

## Mapa

```
auth.users (Supabase Auth)
    │
    └── profiles
          ├── brokers ──── accounts ──┬── positions ──── assets
          │                            ├── transactions ─┤
          │                            └── income ───────┘
          │                                                │
          │                                          asset_aliases
          │                                          (ticker externo -> ativo)
          ├── portfolio_cash_flows      (aportes e retiradas)
          ├── fx_rates                  (câmbio por data)
          │
          ├── portfolio_snapshots ──┬── snapshot_positions    (congelados)
          │                          └── snapshot_allocations  (congelados)
          │
          ├── allocation_targets        (política de investimentos)
          ├── risk_limits               (limites configuráveis)
          ├── retirement_plan           (premissas, em reais reais)
          ├── real_estate               (fora do patrimônio investível)
          │
          ├── asset_risk_factors       (sobreposição de fatores)
          ├── snapshot_factor_exposures (fatores congelados)
          │
          ├── column_mappings ── import_batches ── import_rows
          └── benchmarks ──────── benchmark_values
```

## Decisões de modelagem

### `assets` tem `user_id`

`asset_class` e `risk_bucket` são **decisões do gestor**, não fatos de mercado.
O mesmo GOOGL pode ser `CORE` para um investidor e `GROWTH` para outro. O
catálogo é, portanto, pessoal.

### Identidade de instrumentos

Unicidade por `(user_id, ticker, exchange, currency)`.

`exchange` é `NOT NULL DEFAULT 'N/A'` porque `NULL` quebraria a unicidade
(em SQL, `NULL <> NULL`), permitindo silenciosamente duplicar o mesmo ativo.

Três colunas preparam a consolidação por exposição econômica:

| Coluna | Papel |
|---|---|
| `isin` | Identificador internacional, opcional |
| `underlying_asset_id` | Aponta o instrumento derivado ao principal (GOOGL34 → GOOGL) |
| `exposure_ratio` | Unidades do subjacente por unidade do instrumento (BDRs são frações) |

GOOGL (NASDAQ/USD) e GOOGL34 (B3/BRL) são **instrumentos diferentes que
representam a mesma exposição econômica**. No MVP a consolidação segue por
`asset_id`, conforme aprovado; estas colunas são a base para a fase seguinte.

### `asset_aliases`

Cada corretora nomeia o mesmo papel de um jeito: a Avenue exporta `GOOGL`, outra
exporta `GOOGL US EQUITY`. Esta tabela resolve o ticker externo para o ativo
canônico **no momento da importação**. Sem ela, o princípio custódia-vs-exposição
dependeria de digitação perfeita a cada mês.

### Chaves estrangeiras compostas

Todas as tabelas filhas referenciam `(id, user_id)` do pai, não apenas `id`:

```sql
constraint accounts_broker_fk
  foreign key (broker_id, user_id) references brokers (id, user_id)
```

Isso torna **impossível** uma conta apontar para a corretora de outro usuário —
garantia estrutural, não dependente da aplicação. É o que permite desnormalizar
`user_id` com segurança e usar policies de RLS diretas.

### Colunas geradas

`positions.current_value`, `income.net_amount` e
`portfolio_cash_flows.amount_brl` são `GENERATED ALWAYS AS ... STORED`.
Elimina a possibilidade de o valor divergir de seus componentes.

### `snapshot_positions` — a decisão central

`portfolio_snapshots` guarda apenas totais. Com isso, um gráfico de "alocação em
janeiro" precisaria reler `positions` e reclassificar com os `assets` de hoje —
exatamente o que o briefing proíbe.

Por isso cada linha do snapshot congela, denormalizado de propósito:

```
ticker · asset_name · broker_name · account_name
asset_class · risk_bucket · country · sector · currency
quantity · average_cost · price
value_original · fx_rate_to_brl · value_brl
```

Reclassificar um ativo amanhã não reescreve o histórico. É essa denormalização
deliberada que separa um sistema de controle patrimonial de uma planilha.

`snapshot_allocations` congela também a **política vigente na época**, o que
permite responder "eu estava dentro da banda naquele mês?" mesmo depois de a
política mudar.

### `portfolio_cash_flows`

Fonte de verdade para separar aporte de rentabilidade. `amount` é sempre
positivo; a direção vem de `flow_type` (`CONTRIBUTION`/`WITHDRAWAL`) — nunca do
sinal, que seria ambíguo em agregações.

O Modified Dietz usa a **data real de cada fluxo** para ponderá-lo pelo tempo
em que ficou investido. Um aporte no dia 10 de um período de 30 dias pesa 2/3,
não 0,5. O peso fixo de meio de período é fallback exclusivo para quando só se
conhece o agregado do mês — e, nesse caso, a UI informa explicitamente.
XIRR virá sobre a mesma fonte, sem migration adicional.

### `retirement_plan`

Guarda `birth_date`, não `current_age` — idade armazenada envelhece errado.

Todos os valores monetários estão em **reais reais**. `monthly_real_contribution`
= R$ 10.000 é poder de compra de hoje, o que na prática implica reajustar o
aporte nominal pela inflação a cada ano.

Não existe coluna de "capital-alvo fixo". O capital necessário é **derivado**
da taxa de retirada:

```
capital = renda_mensal × 12 ÷ taxa
```

R$ 7,5 milhões é apenas o capital da meta de R$ 25.000/mês **a 4%**. A 3,5% a
mesma meta exige ~R$ 8,57 milhões. `withdrawal_rates` guarda o array de taxas
avaliadas; `reference_withdrawal_rate` define qual aparece em destaque.

### Fatores de risco (migration 0011)

`asset_risk_factors` guarda apenas as **exceções**: a classificação padrão é
derivada no domínio a partir de tipo, classe, setor e país. Assim a exposição
fatorial funciona imediatamente para uma carteira real recém-importada, sem
nenhuma classificação manual. Ver [`RISK_FACTORS.md`](RISK_FACTORS.md).

`snapshot_factor_exposures` congela a exposição fatorial no fechamento, com a
mesma proteção de imutabilidade das demais tabelas de snapshot.

### Imutabilidade (migration 0009)

Três triggers:

| Trigger | Efeito |
|---|---|
| `guard_closed_snapshot` | Bloqueia `UPDATE`/`DELETE` em snapshot `FECHADO`. Permite a transição `RASCUNHO → FECHADO` |
| `guard_closed_snapshot_child` | Bloqueia `INSERT`/`UPDATE`/`DELETE` nas linhas de um snapshot fechado |
| `stamp_snapshot_closure` | Carimba `closed_at` automaticamente na transição |

Válvula de escape: `SET LOCAL app.allow_snapshot_mutation = 'on'`, para
operações administrativas legítimas (exclusão de usuário em cascata, correção
de fechamento comprovadamente errado). Nunca usada pelo runtime.

## RLS

Padrão em todas as tabelas:

```sql
using ((select auth.uid()) = user_id)
```

O `select` envolvendo `auth.uid()` faz o Postgres tratá-la como InitPlan,
avaliando uma vez por consulta em vez de uma vez por linha — diferença
relevante em `snapshot_positions`.

Todas usam `FORCE ROW LEVEL SECURITY`: nem o dono da tabela escapa das policies.

A migration `0010` termina com uma verificação que **falha** se qualquer tabela
do schema `public` ficar sem RLS. Não é possível esquecer uma.

## Validação local

`supabase/local/00_auth_shim.sql` recria `auth.users`, `auth.uid()` e os papéis
`anon`/`authenticated`/`service_role` num Postgres puro, permitindo testar
migrations, triggers e policies sem projeto remoto:

```bash
psql -d meu_banco -f supabase/local/00_auth_shim.sql
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -d meu_banco -f "$f"; done
```

Este arquivo **não é uma migration** e nunca deve rodar no Supabase.
