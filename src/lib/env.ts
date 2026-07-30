import { z } from "zod";

/**
 * VALIDAÇÃO DE VARIÁVEIS DE AMBIENTE
 * ===================================
 *
 * Nenhum segredo no código. Tudo vem do ambiente e é validado antes do uso.
 *
 * A validação é PREGUIÇOSA (dentro de função, não no topo do módulo) de
 * propósito: assim `next build` não quebra num ambiente de CI sem credenciais,
 * mas qualquer requisição real falha imediatamente com mensagem clara em vez
 * de estourar num `fetch` obscuro do Supabase.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url("NEXT_PUBLIC_SUPABASE_URL deve ser uma URL válida."),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY é obrigatória."),
});

export type PublicEnv = z.infer<typeof publicSchema>;

/**
 * Credenciais públicas do Supabase (anon key + URL).
 *
 * A anon key é pública por design: toda a proteção dos dados vem da RLS
 * combinada com a sessão autenticada do usuário. Ela NÃO é um segredo.
 */
export function getPublicEnv(): PublicEnv {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.message}`).join("\n");
    throw new Error(
      `Configuração do Supabase ausente ou inválida:\n${issues}\n\n` +
        `Copie .env.example para .env.local e preencha os valores.`,
    );
  }

  return parsed.data;
}

/**
 * Service role key — PODER TOTAL, IGNORA RLS.
 *
 * ⚠️ Uso restrito a administração fora do runtime normal da aplicação:
 * migrations, seed e scripts operacionais.
 *
 * NUNCA deve ser lida por código que atende requisição de usuário, e nunca
 * pode ter prefixo NEXT_PUBLIC_ (o que a exporia ao browser).
 */
export function getServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY não configurada. " +
        "Ela só deve existir no ambiente local/CI para migrations e seed — " +
        "jamais no runtime da aplicação.",
    );
  }

  return key;
}
