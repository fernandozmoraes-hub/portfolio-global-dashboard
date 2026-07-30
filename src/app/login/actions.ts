"use server";

import { createClient } from "@/data/supabase/server";

/**
 * Login por magic link (OTP por e-mail).
 *
 * Escolhido em vez de senha: aplicação de usuário único, sem senha para
 * vazar, girar ou esquecer. O Supabase Auth cuida do token e da expiração.
 */
export async function signInWithEmail(
  _prev: { error?: string; sent?: boolean },
  formData: FormData,
): Promise<{ error?: string; sent?: boolean }> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email || !email.includes("@")) {
    return { error: "Informe um e-mail válido." };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: process.env.NEXT_PUBLIC_SITE_URL
          ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/confirm`
          : undefined,
      },
    });

    if (error) return { error: error.message };
    return { sent: true };
  } catch (cause) {
    return {
      error:
        cause instanceof Error
          ? cause.message
          : "Não foi possível enviar o link de acesso.",
    };
  }
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
