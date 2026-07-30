# Exposição multidimensional

## O erro que este modelo corrige

A primeira versão tratava todos os fatores como um conjunto único e **rateava**
o valor do ativo entre eles, para que o total global somasse 100%.

Isso é conceitualmente errado. R$ 100 mil em GOOGL não são R$ 50 mil de Equity
EUA mais R$ 50 mil de Tecnologia — são R$ 100 mil expostos às **duas coisas ao
mesmo tempo**. O mesmo dinheiro carrega as duas exposições simultaneamente.

Ratear **subestimava sistematicamente toda concentração**: uma carteira com
metade em tecnologia apareceria com 25%.

## O modelo correto

As exposições vivem em **dimensões independentes**. Cada dimensão é uma
partição completa do patrimônio:

- **dentro** de uma dimensão os pesos somam 100%;
- **entre** dimensões não há soma alguma.

GOOGL a R$ 100 mil aparece como:

| Dimensão | Tag | Valor |
|---|---|---:|
| Classe econômica | Ações/ETFs Exterior | R$ 100.000 |
| Geografia | Estados Unidos | R$ 100.000 |
| Moeda | USD | R$ 100.000 |
| Setor / Tema | Tecnologia / AI | R$ 100.000 |
| Estilo | Core | R$ 100.000 |
| Fatores macro | Equity EUA | R$ 100.000 |

Seis leituras do **mesmo** dinheiro, cada uma respondendo a uma pergunta
diferente. Nenhuma divisão artificial.

## As sete dimensões

| Dimensão | Pergunta que responde | Origem |
|---|---|---|
| `CLASSE` | Em que classe o dinheiro está alocado? | `asset_class` |
| `GEOGRAFIA` | A que economia está exposto? | `country` |
| `MOEDA` | Em que moeda está denominado? | `currency` |
| `SETOR_TEMA` | A que setor ou tema está exposto? | `sector` + tipo |
| `ESTILO` | Que tipo de retorno o ativo busca? | `investment_style` |
| `RISK_BUCKET` | Que papel cumpre e quanto pode pesar? | `risk_bucket` |
| `MACRO` | A que choque macro reage? | tipo + classe + `indexador` |

### Estilo ≠ risk bucket

Eram a mesma dimensão e não deviam ser. `risk_bucket` é decisão de
**dimensionamento** (CORE pode pesar 5%, GROWTH 3%, ASYMMETRIC 0,5%);
estilo é característica do **ativo** (value, growth, dividendos, índice).

O termo "growth" existia nos dois com sentidos diferentes. Um ETF de índice
pode ser `ESTILO=INDICE` e `RISK_BUCKET=CORE` simultaneamente — e uma ação
growth pode ser dimensionada como CORE se o gestor assim decidir.

**Tecnologia/AI vive em `SETOR_TEMA`, não em `MACRO`** — e é justamente essa
separação que impede GOOGL de ser rateado entre "Equity EUA" e "Tecnologia".

## Quando a divisão dentro de uma dimensão é legítima

Dividir só acontece quando é **economicamente real** — quando o próprio papel
carrega dois riscos que não se separam:

| Ativo | Dimensão MACRO |
|---|---|
| Tesouro **IPCA** | Inflação BR 70% · Juros BR 30% |
| Tesouro **Selic/prefixado** | Juros BR 100% |
| CDB **CDI** | Juros BR 85% · Crédito BR 15% |
| Debênture **IPCA** | Crédito BR 55% · Inflação BR 45% |
| Debênture **CDI** | Crédito BR 60% · Juros BR 40% |
| CRI | Crédito BR 50% · Imobiliário 30% · Inflação BR 20% |
| CRA | Crédito BR 50% · Commodities 30% · Inflação BR 20% |
| Petrobras / Vale | Equity BR 60% · Commodities 40% |
| REIT | Imobiliário 70% · Equity EUA 30% |
| Multimercado | Juros BR 50% · Equity BR 50% (convenção) |

A mesma debênture é **100% Energia** em `SETOR_TEMA` e **100% Brasil** em
`GEOGRAFIA`. A divisão de MACRO não contamina as outras dimensões.

### O fator inflação vem do INDEXADOR

Antes, qualquer papel cujo nome contivesse "incentivada" recebia o fator
inflação. Isso confunde duas coisas: **incentivada é regime tributário**
(isenção de IR, Lei 12.431) e nada diz sobre indexação.

Uma debênture incentivada **CDI+** não carrega risco de inflação nenhum; uma
debênture comum **IPCA+** carrega. Agora só `indexador ∈ {IPCA, IGPM}` gera o
fator, e o nome do papel é irrelevante para o cálculo.

## Derivação automática e sobreposição

Tudo é derivado de atributos que o ativo já tem. A carteira real chega por
importação sem classificação nenhuma — exigir classificação manual de dezenas
de ativos faria as telas nascerem vazias.

`asset_exposure_tags` guarda apenas as **exceções**, e a sobreposição é **por
dimensão**: definir MACRO à mão não afeta GEOGRAFIA. Pesos sobrepostos são
renormalizados para somar 1 dentro da dimensão.

O campo `tag` é texto validado no domínio, não ENUM — acrescentar um tema novo
(`DEFESA`, `BIOTECH`) não exige migration.

## Equity emergentes

O fator antes chamado `EQUITY_GLOBAL` passou a `EQUITY_EMERGENTES`, que é o que
ele de fato representa: equity de mercados emergentes fora de Brasil e EUA.

## FIIs: estrutura ≠ magnitude

`fii_type = PAPEL` e o tema `CREDITO_IMOBILIARIO` dizem **o que o fundo é** —
não **quanto do NAV** está exposto a cada fator.

Atribuir 100% do patrimônio de um FII de papel a `CREDITO_BR` afirmaria que
todo o fundo é crédito, quando parte pode estar em caixa, LCI ou cotas de
outros FIIs. E a repartição entre IPCA e CDI depende da carteira de CRIs, que
muda a cada mês.

Por isso:

| | Fatores macro |
|---|---|
| FII de tijolo | `IMOBILIARIO` |
| FII de papel / híbrido / FOF | `IMOBILIARIO` + `NAO_CLASSIFICADO` |

Crédito, IPCA e CDI só entram com **look-through datado e proporcional**
(`fund_exposure_snapshots`, fase futura). Até lá a parcela aparece como
pendente — visível, não estimada. O mesmo vale para os fundos multimercado.

Um `indexador` declarado num FII é ignorado pelos fatores macro.

## Congelamento histórico

`snapshot_dimension_exposures` congela a exposição de cada dimensão no
fechamento, com a mesma proteção de imutabilidade das demais tabelas de
snapshot. `percentage` é sempre relativo à **dimensão**, nunca ao agregado.
