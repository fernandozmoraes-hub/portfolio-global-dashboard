import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv, getServiceRoleKey } from "@/lib/env";

/**
 * ⚠️ CLIENTE ADMINISTRATIVO — IGNORA RLS POR COMPLETO.
 *
 * Uso EXCLUSIVO em administração fora do runtime normal da aplicação:
 * scripts de migration, seed e manutenção operacional.
 *
 * NÃO importe este módulo em Server Components, Server Actions, Route Handlers
 * ou qualquer código que atenda requisição de usuário. O runtime da aplicação
 * opera com Supabase Auth + RLS + sessão do usuário, conforme a política de
 * segurança do projeto.
 *
 * A guarda abaixo é intencionalmente ruidosa: se esta função for chamada num
 * processo Next.js servindo requisições, ela falha em vez de vazar privilégio.
 */
export function createAdminClient() {
  if (process.env.NEXT_RUNTIME !== undefined) {
    throw new Error(
      "createAdminClient() foi chamado dentro do runtime Next.js. " +
        "O service_role ignora RLS e só pode ser usado em scripts administrativos.",
    );
  }

  const env = getPublicEnv();

  return createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    getServiceRoleKey(),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
