import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, isSupabaseConfigured } from "./config";

/** Veřejné cesty — dostupné bez přihlášení. */
const PUBLIC_PATHS = ["/login", "/setup"];

function isPublicPath(pathname: string): boolean {
  if (pathname.startsWith("/api")) return true; // API mají vlastní ochranu (servisní klíč / RLS)
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Obnova Supabase session v Next.js middleware (auth cookies)
 * + povinné přihlášení: bez session se vše kromě /login a /setup přesměruje.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Bez platné konfigurace (prázdné / placeholder / neplatná URL) → průvodce nastavením.
  if (!isSupabaseConfigured()) {
    if (isPublicPath(request.nextUrl.pathname)) return supabaseResponse;
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Login-first: nepřihlášený uživatel smí jen na veřejné cesty.
  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    const redirectResponse = NextResponse.redirect(redirectUrl);
    // přenes případné obnovené auth cookies
    supabaseResponse.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  return supabaseResponse;
}
