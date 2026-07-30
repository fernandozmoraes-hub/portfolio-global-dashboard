# Arquitetura

## Camadas

Dependência estritamente unidirecional:

```
┌──────────────────────────────────────────────────────────────┐
│  src/app/          App Router · Server Components · Actions   │
│                    Renderiza e formata. Não calcula nada      │
│                    financeiro.                                │
├──────────────────────────────────────────────────────────────┤
│  src/services/     Casos de uso. Buscam dados via repositório │
│                    e aplicam funções de domínio.              │
├───────────────────────────┬──────────────────────────────────┤
│  src/domain/              │  src/data/                        │
│  TypeScript puro.         │  Repositórios Supabase,           │
│  Zero React, Next,        │  mapeadores DB↔domínio.           │
│  Supabase ou I/O.         │                                   │
│  Testável sem mock.       │  src/providers/                   │
│                           │  Portas de mercado + adapters.    │
└───────────────────────────┴──────────────────────────────────┘
```

### Por que o domínio é isolado

As regras que importam neste sistema — consolidar o mesmo ativo entre
corretoras, calcular gap de alocação, projetar aposentadoria em reais reais,
separar aporte de rentabilidade — são exatamente as que ninguém quer descobrir
quebradas seis meses depois.

Isoladas em funções puras, elas rodam em 125 testes que levam menos de três
segundo, sem banco de pé. Espalhadas por componentes React, precisariam de
navegador, sessão e dados de verdade para serem verificadas — na prática,
nunca seriam.

A regra é imposta pelo ESLint (`no-restricted-imports` em `src/domain/**`),
não por convenção. Tentar importar Supabase dentro do domínio falha o lint.

## Fluxo de uma requisição

```
Requisição
   ↓
proxy.ts .......... renova a sessão Supabase; barra rota autenticada
   ↓                (verificação OTIMISTA — a segurança real é a RLS)
Server Component .. chama um service
   ↓
service ........... repositório busca dados (RLS aplicada no banco)
   ↓                domínio calcula sobre os dados recebidos
   ↓
Componente ........ recebe o resultado pronto e apenas formata
```

O componente nunca recebe linhas cruas para somar. Recebe `AssetExposure[]`,
`ClassAllocation[]`, `RetirementScenario[]` — estruturas já calculadas.

## Portas e adapters

O briefing exige não acoplar o sistema a nenhum fornecedor de preços.
Três interfaces em `src/providers/ports.ts`:

```ts
interface PriceProvider     { getQuotes(requests, asOf): Promise<Quote[]> }
interface FxProvider        { getRate(from, to, asOf): Promise<FxRate | null> }
interface BenchmarkProvider { getSeries(code, from, to): Promise<BenchmarkPoint[]> }
```

No MVP existe apenas `ManualProvider`, que lê o que o usuário importou. Ele não
faz chamada de rede e não depende de API key — logo, não introduz segredo algum
no runtime.

Conectar um provider automático depois significa implementar a interface e
trocar o factory. Nenhuma linha de domínio ou de UI muda.

## Decisões técnicas

| Decisão | Razão |
|---|---|
| Server Components por padrão | Dados de carteira não trafegam para o cliente |
| `numeric` no Postgres, `number` no TS | Persistência sem perda; no TS, double tem ~15-16 dígitos significativos — folgado para milhões com 2 casas, e as projeções usam fórmula fechada, sem acúmulo iterativo |
| Parse explícito de `numeric` | `supabase-js` devolve `numeric` como *string*; a conversão é centralizada nos repositórios |
| `user_id` desnormalizado + FK composta | Policies diretas (`user_id = auth.uid()`) em vez de subconsultas; a FK `(id, user_id)` garante coerência no banco |
| `date` em vez de `timestamp` para referências | Elimina toda uma classe de bug de fuso horário |
| Branded types `RealBRL`/`NominalBRL` | Custo zero em runtime; impede somar real com nominal em tempo de compilação |
| Magic link em vez de senha | Usuário único; nenhuma senha para vazar, girar ou esquecer |
| Imutabilidade por trigger | Regra crítica de negócio não pode depender da disciplina do código que a chama |
| Validação de ambiente preguiçosa | `next build` funciona em CI sem credenciais; requisição real falha com mensagem clara |

## Precisão numérica

Valores monetários usam `number` (double IEEE-754) no domínio, com
arredondamento explícito (`round2`) na fronteira de exibição e comparação.
Justificativa: patrimônio de 7 dígitos com 2 decimais precisa de ~9 dígitos
significativos; o double oferece ~15-16. As projeções são fórmulas fechadas
(`FV = P₀(1+i)ⁿ + A·[((1+i)ⁿ−1)/i]`), não somatórios iterativos que acumulariam
erro.

Regra: **nunca comparar dinheiro por igualdade sem passar por `round2`.**

Taxas usam `round6`, alinhado ao `numeric(8,6)` de
`retirement_plan.expected_real_return`.

## Versões

O projeto é padronizado em **Next.js 16.2 + React 19.2**. Não há suporte nem
compatibilidade pretendida com Next.js 15.

Diferenças que afetam este código:

| Mudança no Next 16 | Onde aparece |
|---|---|
| `middleware.ts` renomeado para **`proxy.ts`** | `src/proxy.ts`, exportando `proxy()` e `config` |
| `params` de rota dinâmica são `Promise` | `src/app/(app)/carteira/[assetId]/page.tsx` |
| `cookies()` é assíncrono | `src/data/supabase/server.ts` |
| Turbopack no build de produção | padrão, sem configuração adicional |

React 19 traz `useActionState`, usado no formulário de login.
