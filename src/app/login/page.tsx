"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { signInWithEmail } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signInWithEmail, {});

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <h1 className="text-lg font-semibold tracking-tight">
            Gestão Global da Carteira
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Aposentadoria 70
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardDescription>
              Informe seu e-mail para receber um link de acesso.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {state.sent ? (
              <p
                className="rounded-md border border-[var(--border)] bg-[var(--muted)] p-3 text-sm"
                role="status"
              >
                Link enviado. Verifique sua caixa de entrada para entrar.
              </p>
            ) : (
              <form action={formAction} className="flex flex-col gap-3">
                <label htmlFor="email" className="sr-only">
                  E-mail
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="voce@exemplo.com"
                  className="h-10 w-full rounded-md border border-[var(--input)] bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />

                {state.error ? (
                  <p
                    className="text-sm text-[var(--status-violation)]"
                    role="alert"
                  >
                    {state.error}
                  </p>
                ) : null}

                <Button type="submit" disabled={pending}>
                  {pending ? "Enviando…" : "Receber link de acesso"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-[var(--muted-foreground)]">
          Uso pessoal. Seus dados são isolados por Row Level Security.
        </p>
      </div>
    </main>
  );
}
