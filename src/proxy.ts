import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * PROXY (no Next.js 16, o antigo "middleware").
 *
 * Duas responsabilidades:
 *   1. renovar a sessão do Supabase a cada requisição, para o token não expirar
 *      no meio da navegação;
 *   2. barrar acesso anônimo às rotas autenticadas.
 *
 * ⚠️ Isto é uma verificação OTIMISTA de roteamento, NÃO a camada de segurança.
 * A proteção real dos dados é a RLS no banco: mesmo que alguém contorne este
 * proxy, nenhuma linha de outro usuário é legível. Nunca troque RLS por
 * verificação no proxy.
 */

const PUBLIC_ROUTES = ["/login", "/auth"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Sem configuração não há sessão a renovar; deixa a página renderizar o erro
  // de configuração, que é muito mais útil do que um loop de redirecionamento.
  if (!url || !anonKey) {
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() valida o token no servidor do Supabase.
  // getSession() apenas lê o cookie e pode ser forjado — não serve aqui.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Todas as rotas, exceto estáticos e imagens — que não têm sessão a renovar
     * e só gastariam uma chamada por asset.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
