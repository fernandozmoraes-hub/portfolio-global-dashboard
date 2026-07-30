import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/data/supabase/server";
import { signOut } from "@/app/login/actions";

/**
 * Página de status da fundação (Entrega 1).
 *
 * Deliberadamente NÃO é o Dashboard: as telas de negócio começam na Entrega 2.
 * O que esta página prova é que autenticação, sessão e acesso via RLS estão
 * funcionando de ponta a ponta.
 */
export const dynamic = "force-dynamic";

const ENTREGUE = [
  "Schema completo: 22 tabelas, ENUMs, constraints e índices",
  "RLS habilitada e forçada em todas as tabelas sensíveis",
  "Triggers de imutabilidade dos fechamentos mensais",
  "Camada de domínio pura e testável (100 testes)",
  "Portas de preços, câmbio e benchmarks com adapter manual",
  "Fluxos de caixa e snapshots congelados linha a linha",
  "Seed demonstrativo de R$ 1.045.000",
];

const PROXIMO = [
  "Dashboard com cards e gráficos",
  "Carteira consolidada e detalhe do ativo",
  "Alocação Atual × Alvo e destino do próximo aporte",
  "Aposentadoria 70 com cenários e solvers",
  "Import Center (CSV) e Fechamento Mensal",
];

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-10 flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border)] pb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Gestão Global da Carteira
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Aposentadoria 70 · Fundação instalada
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="ok">Entrega 1</Badge>
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              Sair
            </Button>
          </form>
        </div>
      </header>

      {user ? (
        <p className="mb-8 text-sm text-[var(--muted-foreground)]">
          Sessão autenticada como{" "}
          <span className="font-medium text-[var(--foreground)]">
            {user.email}
          </span>
          . Toda leitura passa pela Row Level Security.
        </p>
      ) : null}

      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Concluído nesta entrega</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {ENTREGUE.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden className="text-[var(--status-ok)]">
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Aguardando aprovação (Entrega 2+)</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm text-[var(--muted-foreground)]">
              {PROXIMO.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden>·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <p className="mt-10 border-t border-[var(--border)] pt-6 text-xs text-[var(--muted-foreground)]">
        Os dados de demonstração são exemplo, não posição oficial. As projeções
        de aposentadoria são simulações determinísticas sobre premissas do
        usuário e não constituem garantia de retorno nem consultoria financeira.
      </p>
    </main>
  );
}
