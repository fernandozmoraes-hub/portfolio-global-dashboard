import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";

/**
 * Cliente Supabase para Client Components.
 *
 * Só a anon key chega ao browser. A proteção dos dados vem inteiramente da
 * RLS + sessão autenticada — nunca de esconder a chave.
 */
export function createClient() {
  const env = getPublicEnv();
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
