import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, isSupabaseConfigured } from "./config";

/**
 * Obnova Supabase session v Next.js middleware (auth cookies).
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Bez platné konfigurace (prázdné / placeholder / neplatná URL) necháváme průchod.
  if (!isSupabaseConfigured()) return supabaseResponse;
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

  await supabase.auth.getUser();

  return supabaseResponse;
}
