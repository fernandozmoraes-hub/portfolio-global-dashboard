import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/portfolio/KpiCard";
import { createClient } from "@/data/supabase/server";
import { getAssetDetail } from "@/services/portfolio";
import {
  ASSET_CLASS_LABELS,
  RISK_BUCKET_LABELS,
  type AssetClass,
  type RiskBucket,
} from "@/domain/shared/types";
import {
  DIMENSION_LABELS,
  labelFor,
} from "@/domain/exposure/dimensions";
import { labelForSharedTag } from "@/domain/exposure/derive";
import {
  formatBRL,
  formatCurrency,
  formatDate,
  formatOrDash,
  formatPercent,
  NO_DATA,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  const { assetId } = await params;
  const db = await createClient();
  const detail = await getAssetDetail(db, assetId);

  if (!detail) notFound();

  const { exposure } = detail;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <Link
        href="/carteira"
        className="text-sm text-[var(--muted-foreground)] hover:underline"
      >
        ← Carteira
      </Link>

      <header className="mt-4 mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {exposure.ticker}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {exposure.assetName} ·{" "}
            {ASSET_CLASS_LABELS[exposure.assetClass as AssetClass]} ·{" "}
            {exposure.country} · {exposure.currency}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="neutral">
            {RISK_BUCKET_LABELS[exposure.riskBucket as RiskBucket]}
          </Badge>
          <Badge
            variant={
              detail.severity === "VIOLACAO"
                ? "violation"
                : detail.severity === "ATENCAO"
                  ? "attention"
                  : "ok"
            }
          >
            {detail.severity === "VIOLACAO"
              ? "Acima do limite"
              : detail.severity === "ATENCAO"
                ? "Perto do limite"
                : "Dentro do limite"}
          </Badge>
        </div>
      </header>

      {/* ---- Posição consolidada ---- */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Exposição consolidada"
          value={formatBRL(exposure.valueBRL)}
          hint={`${exposure.custodyCount} ${exposure.custodyCount > 1 ? "corretoras" : "corretora"}`}
        />
        <KpiCard
          title="Peso na carteira"
          value={formatPercent(detail.weight, 2)}
          hint={
            detail.maxWeight === null
              ? "Sem teto definido"
              : `Peso máximo ${formatPercent(detail.maxWeight, 1)}`
          }
        />
        <KpiCard
          title="Quantidade"
          value={exposure.quantity.toLocaleString("pt-BR", {
            maximumFractionDigits: 8,
          })}
          hint={`Custo médio ${
            exposure.averageCost === null
              ? NO_DATA
              : formatCurrency(exposure.averageCost, exposure.currency, 2)
          }`}
        />
        <KpiCard
          title="Resultado não realizado"
          value={formatOrDash(exposure.unrealizedResultBRL, formatBRL)}
          tone={
            exposure.unrealizedResultBRL === null
              ? "neutral"
              : exposure.unrealizedResultBRL >= 0
                ? "positive"
                : "negative"
          }
          hint={
            exposure.unrealizedResultPercent === null
              ? "Custo médio desconhecido"
              : formatPercent(exposure.unrealizedResultPercent, 2)
          }
        />
      </section>

      {/* ---- Custódia ---- */}
      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Posição por corretora (custódia)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-[var(--border)]">
              {exposure.custodies.map((custody) => (
                <li
                  key={custody.accountId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{custody.brokerName}</p>
                    <p className="truncate text-xs text-[var(--muted-foreground)]">
                      {custody.accountName}
                    </p>
                  </div>
                  <div className="tabular text-right text-sm">
                    <p>{formatBRL(custody.valueBRL)}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {custody.quantity.toLocaleString("pt-BR", {
                        maximumFractionDigits: 8,
                      })}{" "}
                      un · {formatPercent(custody.shareOfAsset, 1)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-[var(--muted-foreground)]">
              A soma destas custódias é a exposição econômica acima. Limites de
              risco são avaliados sobre o total, nunca por corretora.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Exposição por dimensão</CardTitle>
            <p className="text-xs text-[var(--muted-foreground)]">
              A posição inteira conta em cada dimensão — não há rateio entre elas.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {detail.dimensions.map((entry) => (
                <li
                  key={entry.dimension}
                  className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                >
                  <span className="text-[var(--muted-foreground)]">
                    {DIMENSION_LABELS[entry.dimension]}
                  </span>
                  <span className="text-right">
                    {entry.tags.map((tag) => (
                      <span key={tag.tag} className="ml-2 inline-block">
                        {labelForSharedTag(entry.dimension, tag.tag) ??
                          labelFor(entry.dimension, tag.tag)}
                        {entry.tags.length > 1 ? (
                          <span className="tabular ml-1 text-xs text-[var(--muted-foreground)]">
                            {formatPercent(tag.weight * 100, 0)}
                          </span>
                        ) : null}
                      </span>
                    ))}
                    {entry.isOverridden ? (
                      <Badge variant="neutral" className="ml-2">
                        manual
                      </Badge>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-[var(--muted-foreground)]">
              Percentual só aparece quando a dimensão é genuinamente dividida —
              caso de uma debênture que é parte crédito, parte inflação.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* ---- Movimentações ---- */}
      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Transações</CardTitle>
          </CardHeader>
          <CardContent>
            {detail.transactions.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                Nenhuma transação registrada para este ativo.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
                {detail.transactions.map((transaction) => (
                  <li
                    key={transaction.id}
                    className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <span>
                      {formatDate(transaction.date)}{" "}
                      <span className="text-[var(--muted-foreground)]">
                        {transaction.type} · {transaction.brokerName}
                      </span>
                    </span>
                    <span className="tabular text-right">
                      {transaction.quantity?.toLocaleString("pt-BR") ?? NO_DATA} ×{" "}
                      {transaction.price === null
                        ? NO_DATA
                        : formatCurrency(transaction.price, transaction.currency, 2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rendimentos</CardTitle>
          </CardHeader>
          <CardContent>
            {detail.income.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                Nenhum provento registrado para este ativo.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
                {detail.income.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <span>
                      {formatDate(item.date)}{" "}
                      <span className="text-[var(--muted-foreground)]">
                        {item.type} · {item.brokerName}
                      </span>
                    </span>
                    <span className="tabular text-right">
                      {formatCurrency(item.netAmount, item.currency, 2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
