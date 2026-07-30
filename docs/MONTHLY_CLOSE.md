# Fechamento mensal

> **Estrutura de dados pronta na Entrega 1. A interface do wizard chega na
> Entrega 4.** Este documento descreve o comportamento contratado.

## Por que existe

O fechamento registra uma **fotografia imutável** da carteira. É o que permite
ao dashboard histórico mostrar a alocação de janeiro *como ela era em janeiro* —
e não recalculada com os preços e a classificação de hoje.

Sem isso, toda mudança de preço reescreveria o passado, e a evolução
patrimonial viraria ficção.

## As sete etapas

| # | Etapa | O que acontece |
|---|---|---|
| 1 | **Selecionar mês** | Cria `portfolio_snapshots` com status `RASCUNHO`. `UNIQUE (user_id, reference_date)` impede dois fechamentos do mesmo mês |
| 2 | **Importar posições** | CSV/XLSX ou entrada manual. `asset_aliases` resolve o ticker de cada corretora para o ativo canônico |
| 3 | **Revisar erros** | Ticker desconhecido, corretora desconhecida, moeda inválida, quantidade inválida, duplicidade. Cada linha rejeitada fica em `import_rows` com o motivo |
| 4 | **Revisar câmbio** | Confirma a taxa USD/BRL do fechamento. Ela será **congelada** no snapshot |
| 5 | **Conferir patrimônio** | Total consolidado, quebra por classe e por corretora, para conferência visual |
| 6 | **Informar aporte líquido** | Grava em `portfolio_cash_flows`. É o que impede o aporte de virar rentabilidade |
| 7 | **Confirmar** | `RASCUNHO → FECHADO`. A partir daqui é imutável |

## O que é congelado

Ao confirmar, cada posição vira uma linha em `snapshot_positions` com:

- quantidade, custo médio e **preço** do momento;
- **taxa de câmbio** usada e valor em BRL;
- **classificação completa**: classe, risk bucket, país, setor, moeda;
- nomes de corretora e conta.

E `snapshot_allocations` congela os pesos por classe **junto com a política
vigente** (alvo, mínimo, máximo) daquele mês.

### Por que congelar a classificação, e não só o valor

Se amanhã GOOGL for reclassificado de `CORE` para `GROWTH`, ou o setor de um
FII for corrigido, o histórico **não muda**. A denormalização é deliberada.

Um sistema que reclassifica o passado não consegue responder "eu estava dentro
da política em março?" — que é uma das oito perguntas que este sistema existe
para responder.

## Imutabilidade

Garantida por trigger no banco (migration `0009`), não pela aplicação:

```sql
-- UPDATE ou DELETE em snapshot FECHADO
ERROR: Snapshot de 06/2026 está FECHADO e é imutável.

-- INSERT, UPDATE ou DELETE nas linhas de um snapshot FECHADO
ERROR: O fechamento de 06/2026 está FECHADO.
       Suas posições congeladas não podem ser alteradas.
```

Uma regra crítica de negócio não pode depender da disciplina do código que a
chama — nem de um bug futuro num Server Action.

### Corrigir um fechamento errado

Existe uma válvula de escape administrativa, para uso deliberado e raro:

```sql
begin;
  set local app.allow_snapshot_mutation = 'on';
  -- correção pontual
commit;
```

Requisitos: `SET LOCAL` (não vaza para outras sessões), dentro de transação, e
executada por administrador fora do runtime da aplicação. O runtime nunca
aciona esta válvula.

## Cálculo de performance

Com **dois** fechamentos consecutivos, o retorno do mês sai por Modified Dietz:

```
R = (V₁ − V₀ − F) / (V₀ + Σ wᵢ·Fᵢ)
```

onde wᵢ é a fração do período em que o fluxo i ficou investido.

Exemplo com os dados do seed — aporte no **dia 10** de um período de 30 dias:

```
maio/2026   V₀ = R$ 1.020.000
junho/2026  V₁ = R$ 1.045.000
aporte       F = R$ 10.000 em 10/06/2026

peso do fluxo    = (30 − 10) / 30                  = 0,6667
ganho de mercado = 1.045.000 − 1.020.000 − 10.000  = R$ 15.000
capital médio    = 1.020.000 + 0,6667 × 10.000     = R$ 1.026.667
retorno do mês   = 15.000 / 1.026.667               = 1,4610%
```

O aporte de R$ 10.000 **não** entra como rentabilidade.

### Ponderação temporal real

O sistema usa **sempre** a data real de cada fluxo registrado em
`portfolio_cash_flows`. Um aporte feito no dia 5 e outro no dia 25 recebem
pesos diferentes, porque ficaram investidos por prazos diferentes.

O peso fixo de meio de período (0,5) é **fallback exclusivo** para o caso em que
só existe o agregado do mês, sem nenhum fluxo datado. Quando isso acontece, o
card do Dashboard informa: *"fluxo agregado, timing no meio do mês"*. Com datas
reais, informa *"Modified Dietz com datas reais dos aportes"*.

`computePeriodReturn()` devolve o método usado (`DIETZ_DATADO` ou
`DIETZ_MEIO_PERIODO`) para que a UI nunca esconda qual premissa foi aplicada.

### Quando não há dados suficientes

Com menos de dois fechamentos, a interface mostra `—` e explica o motivo.
**O sistema não estima rentabilidade.**

O mesmo vale para o retorno real: sem IPCA registrado em `benchmark_values`,
o campo fica `—` em vez de exibir o retorno nominal disfarçado de real.

## YTD

O acumulado do ano é o **encadeamento geométrico** dos retornos mensais:

```
TWR = [(1+r₁)·(1+r₂)·…·(1+rₙ)] − 1
```

É o TWR do MVP e neutraliza o efeito dos aportes — que é justamente o objetivo.
Somar os retornos mensais daria resultado errado: 1% em três meses é 3,0301%,
não 3%.
