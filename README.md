# Gestão Global da Carteira | Aposentadoria 70

Aplicação pessoal de gestão patrimonial: consolida patrimônio financeiro
distribuído entre corretoras brasileiras e internacionais, monitora aderência à
política de investimentos e projeta a renda sustentável na aposentadoria.

Não é um app de cotações. O objetivo é responder oito perguntas:

1. Quanto vale meu patrimônio?
2. Como ele está distribuído?
3. Onde estou concentrado?
4. Estou dentro da minha política de investimentos?
5. Onde devo direcionar os próximos aportes?
6. Como minha carteira evoluiu no mês?
7. Estou no caminho para financiar minha aposentadoria?
8. Qual renda mensal real minha carteira poderá sustentar aos 70 anos?

> **Aviso.** Este software não é consultor financeiro automatizado. Ele monitora
> uma política definida pelo próprio gestor e calcula métricas determinísticas.
> As projeções são **simulações**, não previsão nem garantia de retorno.
> Ver [`docs/INVESTMENT_POLICY.md`](docs/INVESTMENT_POLICY.md).

---

## Status: Entrega 1 — Fundação

| Entrega | Escopo | Situação |
|---|---|---|
| **1** | Scaffold, Supabase, schema, RLS, triggers, seed, domínio, testes | ✅ concluída |
| 2 | Dashboard, Carteira consolidada, detalhe do ativo | aguardando aprovação |
| 3 | Alocação Atual × Alvo, Aposentadoria 70 | aguardando aprovação |
| 4 | Import Center (CSV), Fechamento Mensal | aguardando aprovação |

A Entrega 1 não contém telas de negócio — apenas login e uma página de status
que comprova sessão autenticada e acesso via RLS.

---

## Stack

- **Next.js 16** (App Router, React Server Components) · **React 19**
- **TypeScript** em modo estrito, com `noUncheckedIndexedAccess`
- **Tailwind CSS 4** + primitivos no padrão **shadcn/ui**
- **Supabase**: PostgreSQL, Auth (magic link), Storage
- **Vitest** para a camada de domínio
- **Recharts** para gráficos (a partir da Entrega 2)
- **Vercel** como ambiente de deploy

---

## Os cinco invariantes

Tudo no sistema decorre destes cinco pontos:

### 1. Custódia ≠ exposição econômica

`positions` é sempre `(conta, ativo)`. A exposição é a soma de todas as
custódias do mesmo ativo. Um GOOGL a 3% na Avenue **mais** 3% em outra
corretora soma 6% e viola um teto de 5% — nenhuma leitura isolada por corretora
enxergaria isso.

Toda regra de risco e de peso opera sobre `AssetExposure`, nunca sobre
`PositionInput`.

### 2. O passado é imutável

Snapshots fechados congelam preço, câmbio **e toda a classificação** do ativo.
Reclassificar GOOGL de `CORE` para `GROWTH` amanhã não reescreve o histórico.
A imutabilidade é imposta por *trigger no banco*, não por disciplina do código.

### 3. Reais reais ≠ nominais

As projeções operam em poder de compra de hoje. O aporte de R$ 10.000 é **real
e constante** — o que implica reajustá-lo pela inflação ao longo dos anos.
`RealBRL` e `NominalBRL` são tipos distintos: o TypeScript recusa somá-los.

### 4. Aporte não é rentabilidade

O aumento de patrimônio causado por aporte nunca aparece como retorno.
Sem dados suficientes, a interface mostra `—`. **O sistema não inventa
rentabilidade.**

### 5. Nenhum acoplamento a fornecedor de preços

`PriceProvider`, `FxProvider` e `BenchmarkProvider` são interfaces. O MVP traz
apenas o adapter manual (lê o que o usuário importou). Conectar B3, Yahoo ou
BCB depois é escrever um adapter novo — domínio e UI não mudam.

---

## Como rodar

### 1. Pré-requisitos

- Node.js 20+
- Um projeto Supabase (região `sa-east-1` recomendada para o Brasil)
- `psql` disponível no PATH

### 2. Configuração

```bash
npm install
cp .env.example .env.local
```

Preencha `.env.local` com os valores do painel do Supabase
(*Project Settings → API* e *→ Database*).

### 3. Banco de dados

```bash
npm run db:migrate   # aplica supabase/migrations/*.sql em ordem
npm run db:seed      # carrega o seed DEMONSTRATIVO
```

O seed exige um usuário já existente no Supabase Auth: faça login pela
aplicação uma vez antes de rodá-lo. Ele é idempotente (IDs derivados por
`md5(user || chave)`), então pode ser reaplicado sem duplicar dados.

### 4. Desenvolvimento

```bash
npm run dev          # http://localhost:3000
npm test             # 100 testes de domínio
npm run lint
npm run build
```

---

## Estrutura

```
src/
├── app/            Rotas (App Router). Renderiza — não calcula.
├── domain/         PURO: sem React, Next, Supabase ou I/O. 100% testável.
│   ├── money/          tipos reais vs nominais, conversão cambial
│   ├── consolidation/  custódia -> exposição econômica
│   ├── allocation/     pesos, gaps, status, destino do aporte
│   ├── risk/           limites por bucket, setor, país, moeda
│   ├── retirement/     projeção real, taxas de retirada, solvers reversos
│   └── performance/    Modified Dietz, encadeamento TWR, retorno real
├── services/       Casos de uso: orquestram domínio + dados
├── data/           Repositórios Supabase e clientes
├── providers/      Portas de mercado + adapter manual
├── components/     UI (shadcn/ui, gráficos, blocos de carteira)
└── lib/            Formatação pt-BR, validação de ambiente

supabase/
├── migrations/     10 migrations versionadas
├── seed.sql        Seed demonstrativo (R$ 1.045.000)
└── local/          Shim de auth para validar migrations em Postgres puro

docs/               ARCHITECTURE · DATA_MODEL · INVESTMENT_POLICY · MONTHLY_CLOSE
tests/domain/       Testes unitários das regras financeiras
```

**Regra de ouro:** se uma função calcula peso, gap, status de banda, retorno ou
projeção, ela mora em `src/domain/` e tem teste. Um componente React que faça
`.reduce()` sobre valores monetários é um bug de arquitetura — e o ESLint
bloqueia a inversão de dependência.

---

## Segurança

- **Row Level Security** habilitada *e forçada* em todas as 22 tabelas. As
  policies usam `(select auth.uid()) = user_id`; nenhuma tabela sensível fica
  sem proteção — a migration `0010` falha se alguma escapar.
- **Chaves estrangeiras compostas** `(id, user_id)` impedem, no nível do banco,
  que uma conta aponte para a corretora de outro usuário.
- **A anon key é pública por desenho.** A proteção vem da RLS + sessão
  autenticada, nunca de esconder a chave.
- **`service_role` nunca no runtime.** Ela ignora RLS e serve apenas a
  migrations e scripts. `src/data/supabase/admin.ts` falha explicitamente se
  chamada dentro do Next.js, e o ESLint bloqueia sua importação em `app/`.
- Nenhum segredo no código. `.env*` está no `.gitignore`.

---

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Camadas, dependências, portas e adapters |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Tabelas, relacionamentos e decisões de modelagem |
| [`docs/INVESTMENT_POLICY.md`](docs/INVESTMENT_POLICY.md) | Política, limites de risco e limites do software |
| [`docs/MONTHLY_CLOSE.md`](docs/MONTHLY_CLOSE.md) | Workflow do fechamento mensal e imutabilidade |
