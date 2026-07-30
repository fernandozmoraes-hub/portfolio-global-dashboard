import { AllocationDonut } from "@/components/charts/AllocationDonut";
import { BreakdownBars } from "@/components/charts/BreakdownBars";
import { EvolutionChart } from "@/components/charts/EvolutionChart";
import { AlertList } from "@/components/portfolio/AlertList";
import { EmptyState } from "@/components/portfolio/EmptyState";
import { KpiCard } from "@/components/portfolio/KpiCard";
import { TargetBars } from "@/components/portfolio/TargetBars";
import { TopExposures } from "@/components/portfolio/TopExposures";
import { SourceFreshnessPanel } from "@/components/portfolio/SourceFreshness";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/data/supabase/server";
import { getDashboardData } from "@/services/dashboard";
import { ASSET_CLASS_LABELS } from "@/domain/shared/types";
import {
  formatBRL,
  formatDate,
  formatOrDash,
  formatPercent,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const db = await createClient();
  const data = await getDashboardData(db);

  const monthlyReturn = data.monthlyReturn;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Gestão Global da Carteira
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {data.referenceDate
              ? `Posições até ${formatDate(data.referenceDate)}${
                  data.hasMixedDates ? " · fontes em datas diferentes" : ""
                }`
              : "Nenhuma posição importada"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.hasStaleSources ? (
            <Badge variant="attention">Fonte desatualizada</Badge>
          ) : null}
          {data.hasDemoData ? (
            <Badge variant="attention">Dados demonstrativos</Badge>
          ) : null}
        </div>
      </header>

      {data.isEmpty ? (
        <EmptyState
          title="Carteira ainda sem posições"
          description="Importe suas posições pelo Import Center (Entrega 4) ou carregue o seed demonstrativo com npm run db:seed. Todos os blocos abaixo passam a funcionar automaticamente."
        />
      ) : null}

      {/* ---------------- Cards principais ---------------- */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Patrimônio financeiro"
          value={data.isEmpty ? null : formatBRL(data.totalFinancialBRL)}
          hint="Não inclui o imóvel"
        />
        <KpiCard
          title="Patrimônio total"
          value={
            data.totalWithRealEstateBRL === 0
              ? null
              : formatBRL(data.totalWithRealEstateBRL)
          }
          hint={`Inclui imóvel de ${formatBRL(data.realEstateBRL)}`}
        />
        <KpiCard
          title="Aporte do mês"
          value={formatOrDash(data.contributionsMonth, formatBRL)}
          hint="Registrado no fechamento"
        />
        <KpiCard
          title="Rentabilidade do mês"
          value={
            monthlyReturn
              ? formatPercent(monthlyReturn.returnPercent, 2)
              : null
          }
          tone={
            monthlyReturn
              ? monthlyReturn.returnPercent >= 0
                ? "positive"
                : "negative"
              : "neutral"
          }
          hint={
            monthlyReturn
              ? monthlyReturn.method === "DIETZ_DATADO"
                ? "Modified Dietz com datas reais dos aportes"
                : "Modified Dietz · fluxo agregado, timing no meio do mês"
              : `Requer 2 fechamentos (há ${data.closedMonthsCount})`
          }
        />
      </section>

      <section className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Rentabilidade YTD"
          value={formatOrDash(data.ytdReturnPercent, (v) => formatPercent(v, 2))}
          hint="Encadeamento dos meses fechados"
        />
        <KpiCard
          title="Ganho de mercado do mês"
          value={
            monthlyReturn ? formatBRL(monthlyReturn.marketGainBRL) : null
          }
          hint="Já descontado o aporte"
        />
        <KpiCard
          title="Brasil / Exterior"
          value={
            data.brazilPercent === null
              ? null
              : `${formatPercent(data.brazilPercent)} / ${formatPercent(data.foreignPercent ?? 0)}`
          }
          hint="Por país do ativo"
        />
        <KpiCard
          title="BRL / USD"
          value={
            data.brlPercent === null
              ? null
              : `${formatPercent(data.brlPercent)} / ${formatPercent(data.usdPercent ?? 0)}`
          }
          hint="Exposição cambial"
        />
      </section>

      {/* ---------------- Evolução ---------------- */}
      <section className="mt-8">
        <Card>
          <CardHeader>
            <CardTitle>Evolução do patrimônio</CardTitle>
          </CardHeader>
          <CardContent>
            {data.evolution.length >= 2 ? (
              <>
                <EvolutionChart data={data.evolution} />
                <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                  A linha tracejada é o total aportado. A distância entre as duas
                  é o ganho de mercado — aporte não é rentabilidade.
                </p>
              </>
            ) : (
              <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">
                A série histórica aparece a partir de dois fechamentos mensais
                confirmados.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ---------------- Alocação ---------------- */}
      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Alocação por classe</CardTitle>
          </CardHeader>
          <CardContent>
            {data.allocation.some((row) => row.currentValueBRL > 0) ? (
              <AllocationDonut
                data={data.allocation
                  .filter((row) => row.currentValueBRL > 0)
                  .map((row) => ({
                    label: ASSET_CLASS_LABELS[row.assetClass],
                    valueBRL: row.currentValueBRL,
                    percentage: row.currentPercentage,
                  }))}
              />
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">
                Sem posições para distribuir por classe.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Atual × Alvo</CardTitle>
          </CardHeader>
          <CardContent>
            <TargetBars rows={data.allocation} />
          </CardContent>
        </Card>
      </section>

      {/* ---------------- Atualização das fontes ---------------- */}
      <section className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Atualização por fonte</CardTitle>
            <p className="text-xs text-[var(--muted-foreground)]">
              Cada conta entra com a sua última data disponível.
            </p>
          </CardHeader>
          <CardContent>
            <SourceFreshnessPanel
              sources={data.sources}
              hasMixedDates={data.hasMixedDates}
            />
          </CardContent>
        </Card>
      </section>

      {/* ---------------- Exposições e alertas ---------------- */}
      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Maiores exposições consolidadas</CardTitle>
          </CardHeader>
          <CardContent>
            <TopExposures
              exposures={data.topExposures}
              totalBRL={data.totalFinancialBRL}
            />
            <p className="mt-4 text-xs text-[var(--muted-foreground)]">
              Soma de todas as corretoras. Corretora é custódia, nunca exposição
              econômica.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alertas de limite</CardTitle>
          </CardHeader>
          <CardContent>
            <AlertList alerts={data.alerts} />
          </CardContent>
        </Card>
      </section>

      {/* ---------------- Exposição multidimensional ---------------- */}
      <section className="mt-8">
        <div className="mb-4 flex flex-col gap-1">
          <h2 className="text-sm font-semibold tracking-tight">
            Exposição por dimensão
          </h2>
          <p className="max-w-3xl text-xs text-[var(--muted-foreground)]">
            Cada dimensão é uma leitura independente do <strong>mesmo</strong>{" "}
            patrimônio: dentro de cada uma os percentuais somam 100%, e entre
            dimensões não há soma. R$ 100 mil em GOOGL são R$ 100 mil em Equity
            EUA <em>e</em> R$ 100 mil em Tecnologia — não R$ 50 mil em cada.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {data.dimensions.map((dimension) => (
            <Card key={dimension.dimension}>
              <CardHeader>
                <CardTitle>{dimension.label}</CardTitle>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {dimension.question}
                </p>
              </CardHeader>
              <CardContent>
                <BreakdownBars
                  items={dimension.buckets.map((bucket) => ({
                    key: bucket.tag,
                    label: bucket.label,
                    valueBRL: bucket.valueBRL,
                    weight: bucket.percentage,
                  }))}
                  emptyMessage="Sem posições nesta dimensão."
                />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <footer className="mt-10 border-t border-[var(--border)] pt-6 text-xs text-[var(--muted-foreground)]">
        Métricas que não podem ser calculadas corretamente aparecem como “—”. O
        sistema não estima rentabilidade. Este software não é consultor
        financeiro automatizado.
      </footer>
    </main>
  );
}
