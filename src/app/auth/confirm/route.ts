import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/data/supabase/server";

/**
 * Destino do magic link: troca o código recebido por uma sessão em cookie.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirect") ?? "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?erro=link_invalido`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?erro=link_expirado`);
  }

  return NextResponse.redirect(`${origin}${redirectTo}`);
}
