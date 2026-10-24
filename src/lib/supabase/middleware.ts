import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, isSupabaseConfigured } from "./config";

/** Veřejné stránky — dostupné bez přihlášení (přihlášení, obnova hesla, průvodce nastavením). */
const PUBLIC_PATHS = ["/login", "/setup", "/forgot-password", "/reset-password", "/auth"];

/**
 * API bez přihlášení: průvodce nastavením (před vytvořením admina) a cron
 * (chráněný vlastním CRON_SECRET uvnitř route). Vše ostatní pod /api vyžaduje session.
 */
const PUBLIC_API = ["/api/setup", "/api/cron"];

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isPublicPath(pathname: string): boolean {
  return matches(pathname, PUBLIC_PATHS) || matches(pathname, PUBLIC_API);
}

/**
 * Obnova Supabase session v Next.js middleware (auth cookies)
 * + povinné přihlášení: bez session se stránky přesměrují na /login a API vrací 401.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api");

  // Bez platné konfigurace (prázdné / placeholder / neplatná URL) → průvodce nastavením.
  // API nechá projít — bez DB stejně vrací bezpečné prázdné výsledky.
  if (!isSupabaseConfigured()) {
    if (isApi || isPublicPath(pathname)) return supabaseResponse;
    const url = request.nextUrl.clone();
    url.pathname = "/setup";
    url.search = "";
    return NextResponse.redirect(url);
  }
  const { url, key } = getSupabaseEnv() as { url: string; key: string };

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  let user: { id: string } | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }

  if (!user && !isPublicPath(pathname)) {
    if (isApi) {
      return NextResponse.json({ error: "Nepřihlášen — přihlas se znovu." }, { status: 401 });
    }
    // Login-first: nepřihlášený uživatel smí jen na veřejné cesty.
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    // kam se po přihlášení vrátit (např. odkaz „Otevřít nabídku“ z e-mailu); ověří safeNextPath při přihlášení
    if (pathname !== "/") redirectUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    const redirectResponse = NextResponse.redirect(redirectUrl);
    // přenes případné obnovené auth cookies
    supabaseResponse.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  return supabaseResponse;
}
