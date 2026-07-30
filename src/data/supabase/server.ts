import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/lib/env";

/**
 * Cliente Supabase para Server Components, Server Actions e Route Handlers.
 *
 * Usa a ANON KEY e a sessão autenticada do usuário — portanto toda leitura e
 * escrita passa pela RLS. Este é o único caminho de acesso a dados no runtime
 * normal da aplicação.
 */
export async function createClient() {
  const env = getPublicEnv();
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // `set` lança quando chamado de um Server Component puro.
            // O refresh de sessão acontece no proxy.ts, então ignorar é seguro.
          }
        },
      },
    },
  );
}

/**
 * Usuário autenticado da requisição atual, ou `null`.
 *
 * Usa `getUser()` (valida o token no servidor Supabase) e não `getSession()`,
 * que apenas lê o cookie e pode ser forjado.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
