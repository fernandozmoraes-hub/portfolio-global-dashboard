import Link from "next/link";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/login/actions";

/**
 * Shell da área autenticada: navegação lateral no desktop, superior no mobile.
 * Sóbrio por decisão de projeto — a navegação não deve competir com os números.
 */

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/carteira", label: "Carteira" },
];

const NAV_FUTURO = [
  { label: "Alocação", entrega: "Entrega 3" },
  { label: "Aposentadoria 70", entrega: "Entrega 3" },
  { label: "Importação", entrega: "Entrega 4" },
  { label: "Fechamento", entrega: "Entrega 4" },
];

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="shrink-0 border-b border-[var(--border)] lg:w-60 lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col gap-6 p-5">
          <div>
            <p className="text-sm font-semibold leading-tight tracking-tight">
              Gestão Global
              <br />
              da Carteira
            </p>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Aposentadoria 70
            </p>
          </div>

          <nav className="flex gap-1 lg:flex-col">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden flex-col gap-1 lg:flex">
            {NAV_FUTURO.map((item) => (
              <span
                key={item.label}
                className="flex items-center justify-between px-3 py-2 text-sm text-[var(--muted-foreground)]"
                title={`Disponível na ${item.entrega}`}
              >
                {item.label}
                <span className="text-[10px] uppercase tracking-wide opacity-70">
                  {item.entrega.replace("Entrega ", "E")}
                </span>
              </span>
            ))}
          </div>

          <form action={signOut} className="mt-auto hidden lg:block">
            <Button type="submit" variant="ghost" size="sm" className="w-full">
              Sair
            </Button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
