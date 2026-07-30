# Política de investimentos

## O que este software é — e o que não é

**Este sistema não é um consultor financeiro automatizado.**

As regras aqui descritas refletem uma política definida pelo próprio
usuário/gestor. O software:

- **monitora** desvios entre a carteira real e essa política;
- **calcula** métricas determinísticas (pesos, gaps, concentração, projeções);
- **sinaliza** quando um limite configurado é ultrapassado.

O software **não**:

- recomenda ativos, papéis ou momentos de compra e venda;
- opina sobre o mérito da política definida;
- executa ordens;
- garante retorno.

O algoritmo de destino do próximo aporte identifica qual **classe** está mais
subalocada frente à política. Ele nunca escolhe ativo — a decisão do papel é do
gestor, fora do sistema.

Toda projeção de aposentadoria é uma **simulação determinística** sobre
premissas informadas pelo usuário. Retorno real de 5% ao ano é uma premissa de
planejamento, não uma previsão. Resultados passados ou projetados não garantem
resultados futuros.

---

## Alocação-alvo por classe

| Classe | Alvo | Mínimo | Máximo |
|---|---:|---:|---:|
| Renda Fixa Brasil | 35% | 28% | 42% |
| Ações Brasil | 15% | 10% | 20% |
| Ações/ETFs Exterior | 30% | 24% | 36% |
| Renda Fixa / Caixa Exterior | 8% | 4% | 12% |
| FIIs / Imobiliário | 9% | 6% | 13% |
| Multimercados / Alternativos | 3% | 0% | 6% |
| **Caixa BR** | **0%** | **0%** | **3%** |
| **Soma dos alvos** | **100%** | | |

### Caixa BR

Alvo 0%, banda 0–3%. É um **colchão operacional temporário**, não classe
estratégica: dinheiro parado em reais aguardando alocação. Acima de 3% o
sistema alerta.

**Caixa em USD não pertence a esta classe** — ele integra *Renda Fixa / Caixa
Exterior*, junto com os títulos de renda fixa internacional. Por isso os alvos
centrais continuam somando 100% sem contar o Caixa BR.

### Status e semáforo

| Situação | Status | Semáforo |
|---|---|---|
| Acima da banda máxima | SOBREPESO | 🔴 fora da política |
| Abaixo da banda mínima | SUBPESO | 🔴 fora da política |
| Dentro da banda, a menos de 20% da largura de uma borda | NEUTRO | 🟡 atenção |
| Dentro da banda, longe das bordas | NEUTRO | 🟢 dentro da política |

Cor é reservada exclusivamente a este uso. Ela significa compliance, nunca
decoração.

---

## Limites de risco

Todos avaliados sobre a **exposição consolidada entre corretoras**.

| Escopo | Chave | Teto |
|---|---|---:|
| Ativo individual | `CORE` | 5,0% |
| Ativo individual | `GROWTH` | 3,0% |
| Ativo individual | `SATELLITE` | 3,0% |
| Ativo individual | `ASYMMETRIC` | 0,5% |
| Setor | todos | 25,0% |
| País | `BR` | 70,0% |
| Moeda | `BRL` | 75,0% |

O alerta fica amarelo a partir de 90% do teto e vermelho ao ultrapassá-lo.

### Baldes de risco

| Balde | Significado |
|---|---|
| `CORE` | Posição estrutural de longo prazo |
| `GROWTH` | Crescimento, maior volatilidade |
| `SATELLITE` | Posição tática ou temática |
| `ASYMMETRIC` | Aposta de alta assimetria, posição pequena por desenho |
| `DEFENSIVE` | Renda fixa e proteção |
| `CASH` | Caixa |

### Por que consolidar importa

Um ativo a 3% na Avenue e 3% em outra corretora **não viola** o teto de 5% em
nenhuma leitura isolada. Consolidado, são 6% — violação.

Este é o caso de uso central do sistema, e há teste automatizado cobrindo
exatamente ele (`tests/domain/risk.test.ts`).

Todos os limites vivem em `risk_limits` e são editáveis. Nenhum número de
política está no código.

---

## Plano de aposentadoria

| Premissa | Valor |
|---|---|
| Idade atual | 57 anos |
| Idade de aposentadoria | 70 anos |
| Horizonte | 13 anos |
| Meta de renda | **R$ 25.000/mês, em reais de hoje** |
| Aporte mensal | R$ 10.000, em reais de hoje |
| Retorno real esperado (base) | 5% a.a. |
| Cenários | 3% (conservador), 5% (base), 7% (otimista) |
| Taxas de retirada avaliadas | 3,5% · 3,9% · 4,0% |

### Tudo em reais reais

O aporte de R$ 10.000 é **real e constante em poder de compra**. Na prática,
isso significa que o valor nominal aportado precisa ser reajustado pela
inflação ao longo dos 13 anos — caso contrário o plano real não se cumpre.

Nenhum valor nominal entra nas projeções. Os tipos `RealBRL` e `NominalBRL`
impedem a mistura em tempo de compilação.

### A meta é de RENDA, não de capital

A meta principal é **R$ 25.000/mês reais aos 70 anos**.

O capital de referência é derivado dinamicamente da taxa de retirada:

```
capital necessário = renda mensal × 12 ÷ taxa de retirada
```

| Taxa de retirada | Capital necessário |
|---:|---:|
| 3,5% | ~R$ 8.571.429 |
| 3,9% | ~R$ 7.692.308 |
| 4,0% | ~R$ 7.500.000 |

**R$ 7,5 milhões não é "a meta oficial"** — é apenas o capital correspondente à
meta usando 4% de retirada. O sistema exibe, para cada taxa: capital
necessário, patrimônio projetado, renda projetada e gap.

### Imóvel

O imóvel residencial (~R$ 1,3 milhão) **não integra** o patrimônio financeiro
investível e não entra nas projeções de aposentadoria. Aparece separadamente
como patrimônio imobiliário. O flag
`real_estate.include_in_retirement_portfolio` tem default `false`.

---

## Revisão

Esta política é editável a qualquer momento pelo gestor, nas tabelas
`allocation_targets` e `risk_limits`. Alterações passam a valer para as
avaliações seguintes — os fechamentos já confirmados guardam a política vigente
na época e não são reescritos.
