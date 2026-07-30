# Fatores de risco

## Por que existem, além das classes

Classe de ativo responde **onde está o dinheiro**.
Fator de risco responde **ao que esse dinheiro reage**.

São perguntas diferentes, e a segunda é a que revela concentração escondida:

- Uma alta de juros no Brasil atinge, ao mesmo tempo, Tesouro prefixado (RF
  Brasil), FIIs de papel (Imobiliário) e ações de consumo (Ações Brasil). A
  visão por classe mostra três linhas independentes; a visão por fator mostra
  uma aposta só.
- Um CRI está em *Renda Fixa Brasil*, mas carrega risco imobiliário — o mesmo
  fator de um FII, que está em outra classe.
- Uma debênture incentivada de energia carrega crédito corporativo, inflação
  brasileira e, indiretamente, commodities.

Sem esta visão, é possível estar dentro de todas as bandas de classe e ainda
assim ter metade do patrimônio dependendo do mesmo fator.

## Os fatores

| Código | Rótulo | O que captura |
|---|---|---|
| `JUROS_BR` | Juros Brasil | Curva de juros brasileira (pré e pós, Selic/DI) |
| `INFLACAO_BR` | Inflação Brasil | Indexação ao IPCA |
| `CREDITO_BR` | Crédito Brasil | Crédito corporativo (debêntures, CRIs, CRAs) |
| `EQUITY_BR` | Equity Brasil | Renda variável brasileira |
| `EQUITY_US` | Equity EUA | Renda variável norte-americana |
| `TECH_AI` | Tecnologia / AI | Concentração em tecnologia, dentro ou fora do país |
| `COMMODITIES` | Commodities | Petróleo, mineração, agro, materiais básicos |
| `IMOBILIARIO` | Imobiliário | Imóveis, FIIs, REITs, crédito com lastro imobiliário |
| `DURATION_USD` | Duration USD | Sensibilidade à curva de juros em dólar |
| `OUTROS` | Não classificado | Residual explícito da derivação automática |

## Como um ativo é classificado

Um ativo tem **N fatores com pesos que somam 1**. O valor do ativo é rateado
entre eles: R$ 100 mil com 50% `EQUITY_US` e 50% `TECH_AI` contribui R$ 50 mil
para cada fator.

### Derivação automática

A classificação é **derivada** de atributos que o ativo já tem — tipo, classe,
setor e país — em `src/domain/factors/derive.ts`.

Essa decisão é deliberada: a carteira real chega por importação, sem nenhuma
classificação de fator. Exigir que o gestor classifique dezenas de ativos à mão
antes de ver qualquer coisa faria a tela nascer vazia e inútil.

Regras principais:

| Ativo | Fatores derivados |
|---|---|
| Tesouro IPCA+ | `INFLACAO_BR` 70% · `JUROS_BR` 30% |
| Tesouro Selic / prefixado | `JUROS_BR` 100% |
| CDB, LCI/LCA | `JUROS_BR` 85% · `CREDITO_BR` 15% |
| Debênture (IPCA) | `CREDITO_BR` 55% · `INFLACAO_BR` 45% |
| CRI | `CREDITO_BR` 45% · `IMOBILIARIO` 35% · `INFLACAO_BR` 20% |
| CRA | `CREDITO_BR` 45% · `COMMODITIES` 35% · `INFLACAO_BR` 20% |
| Ação BR (tecnologia) | `EQUITY_BR` 50% · `TECH_AI` 50% |
| Ação BR (energia/materiais) | `EQUITY_BR` 60% · `COMMODITIES` 40% |
| Ação/ETF EUA | `EQUITY_US` 100% (metade em `TECH_AI` se do setor) |
| ETF de RF internacional | `DURATION_USD` 100% |
| FII | `IMOBILIARIO` 100% |
| REIT | `IMOBILIARIO` 70% · `EQUITY_US` 30% |
| Multimercado | `JUROS_BR` 50% · `EQUITY_BR` 50% |
| Caixa | *nenhum fator* |

São **heurísticas explícitas e auditáveis**, não um modelo estatístico.
Representam uma leitura razoável e conservadora, e podem ser revistas sem tocar
em código.

### Sobreposição manual

A tabela `asset_risk_factors` guarda apenas as **exceções**. Quando existe
sobreposição para um ativo, ela substitui integralmente a derivação (e é
renormalizada para somar 1). Sem registro, vale a derivação automática.

É o caminho certo para um multimercado cuja composição real o gestor conhece,
ou para um ETF temático que a heurística não captura.

## Detalhes de cálculo

**Sempre sobre a exposição consolidada.** GOOGL da Avenue e GOOGL da
Interactive Brokers são somados **antes** de fatorar. Corretora é custódia;
fator é propriedade econômica do ativo. Fatorar por corretora esconderia
exatamente a concentração que se quer medir.

**Caixa fica fora da base.** Caixa não reage a fator de risco algum. O
denominador é o capital *exposto*, de modo que os percentuais somam 100% do que
efetivamente corre risco.

**O residual é visível.** O que a derivação não classifica vai para `OUTROS`,
não some da conta. `unclassifiedShare()` informa o percentual afetado.

### Limitação conhecida

Equity fora de Brasil e EUA — mercados emergentes, Europa, Ásia — não tem fator
próprio na lista inicial e cai em `OUTROS`. No seed demonstrativo isso afeta o
VWO (~2% da carteira).

Duas saídas, ambas disponíveis hoje: classificar o ativo manualmente em
`asset_risk_factors`, ou acrescentar um fator novo (`EQUITY_GLOBAL`,
`EQUITY_EMERGENTES`) ao enum `risk_factor_code` e à derivação.

## Congelamento histórico

`snapshot_factor_exposures` congela a exposição fatorial em cada fechamento,
com a mesma proteção de imutabilidade das demais tabelas de snapshot.

Mudar a classificação de fator de um ativo amanhã **não reescreve** a exposição
fatorial de um mês já fechado — mesmo princípio de `snapshot_positions`.
