# Carteira real (Entrega 2.5)

O seed de R$ 1.045.000 é **exclusivamente demonstrativo**, para testes e
desenvolvimento. A carteira real entra por este caminho e nunca se mistura com
ele: todo ativo importado recebe `is_demo = false`, e o aviso "Dados
demonstrativos" some quando não há mais nenhum registro de seed.

O Import Center com interface chega na Entrega 4. Até lá, a carga é feita por
script — o suficiente para validar Dashboard e Carteira com dados de verdade.

## Formato

Um CSV com uma linha por posição **em cada corretora**. Se o mesmo ativo está
em duas corretoras, são **duas linhas** — é assim que o sistema separa custódia
de exposição econômica.

```
broker,account,ticker,asset_name,exchange,asset_type,asset_class,country,currency,sector,risk_bucket,quantity,average_cost,current_price,reference_date
```

| Campo | Obrigatório | Observação |
|---|---|---|
| `broker` | sim | Nome da corretora |
| `account` | sim | Conta dentro da corretora |
| `ticker` | sim | Como você identifica o ativo |
| `asset_name` | sim | Nome por extenso |
| `exchange` | não | `B3`, `NASDAQ`, `NYSE`, `ARCA`… Vazio vira `N/A` |
| `asset_type` | não | `ACAO`, `ETF`, `FII`, `TESOURO_DIRETO`, `CDB`, `LCI_LCA`, `DEBENTURE`, `CRI`, `CRA`, `FUNDO`, `BOND`, `REIT`, `CAIXA` |
| `asset_class` | sim | `RF_BRASIL`, `ACOES_BRASIL`, `ACOES_ETF_EXTERIOR`, `RF_CAIXA_EXTERIOR`, `FII_IMOBILIARIO`, `MULTIMERCADO_ALTERNATIVO`, `CAIXA_BR` |
| `country` | sim | `BR`, `US`, `CN`, `EU`… |
| `currency` | sim | `BRL`, `USD`, `EUR` |
| `sector` | não | Melhora a classificação de Setor/Tema |
| `risk_bucket` | sim | `CORE`, `GROWTH`, `SATELLITE`, `ASYMMETRIC`, `DEFENSIVE`, `CASH` |
| `quantity` | sim | Aceita `1.234,56` ou `1234.56` |
| `average_cost` | não | Vazio = desconhecido (**não** zero) |
| `current_price` | sim | Na moeda do ativo |
| `reference_date` | sim | `AAAA-MM-DD` |

Modelo pronto em [`carteira-real.modelo.csv`](../carteira-real.modelo.csv).

## Uso

```bash
# 1. conferir sem gravar nada
node scripts/importar-carteira.mjs carteira.csv --usdbrl 5.42 --validar

# 2. gerar o SQL
node scripts/importar-carteira.mjs carteira.csv --usdbrl 5.42 > carga.sql

# 3. aplicar
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f carga.sql
```

A cotação USD/BRL é **obrigatória** quando há qualquer posição em moeda
estrangeira — o sistema nunca assume câmbio 1.

## Validações

Nada é gerado se houver erro. O script recusa: campo obrigatório vazio, classe
/ tipo / bucket / moeda inválidos, quantidade ou preço não numéricos, valor
negativo, data fora do formato, posição duplicada (mesma conta + ativo + data)
e câmbio ausente para moeda estrangeira.

Antes de gerar, imprime patrimônio consolidado, quebra por classe e **a lista
de ativos custodiados em mais de uma corretora** — o ponto que mais importa
conferir.

O SQL é idempotente (IDs derivados de `md5(user || chave)`): reexecutar
atualiza, não duplica.

## O que conferir depois da carga

1. **Patrimônio consolidado** bate com a soma dos extratos
2. **Ativos repetidos** aparecem uma vez na Carteira, com "N corretoras"
3. **Classes** somam 100% e batem com a leitura do gestor
4. **Países e moedas** conferem
5. **Dimensões** (setor, estilo, macro) fazem sentido — o que estiver errado se
   corrige em `asset_exposure_tags`, sem tocar em código
6. **Top 10 exposições** — nenhuma surpresa
7. **Alertas de concentração** — cada um precisa ser explicável
