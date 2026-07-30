import { EmptyState } from "@/components/portfolio/EmptyState";
import { PortfolioTable } from "@/components/portfolio/PortfolioTable";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/data/supabase/server";
import { getPortfolioView } from "@/services/portfolio";
import { formatBRL, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CarteiraPage() {
  const db = await createClient();
  const view = await getPortfolioView(db);

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Carteira consolidada</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {view.referenceDate
              ? `${formatBRL(view.totalBRL)} · posições até ${formatDate(view.referenceDate)}${
                  view.hasMixedDates ? " (fontes em datas diferentes)" : ""
                }`
              : "Nenhuma posição importada"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {view.hasStaleSources ? (
            <Badge variant="attention">Fonte desatualizada</Badge>
          ) : null}
          {view.hasDemoData ? (
            <Badge variant="attention">Dados demonstrativos</Badge>
          ) : null}
        </div>
      </header>

      {view.rows.length === 0 ? (
        <EmptyState
          title="Nenhuma posição para consolidar"
          description="Assim que houver posições importadas, cada linha aqui representará uma exposição econômica — somando o mesmo ativo entre todas as corretoras."
        />
      ) : (
        <>
          <PortfolioTable rows={view.rows} />
          <p className="mt-6 text-xs text-[var(--muted-foreground)]">
            Cada linha é uma exposição econômica consolidada. A coluna
            “Corretoras” indica onde ela está custodiada — corretora é custódia,
            nunca exposição.
          </p>
        </>
      )}
    </main>
  );
}
