import { NextResponse, type NextRequest } from "next/server";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { originFrom, safeNextPath } from "@/lib/auth/reset-code";

/**
 * Návrat z e-mailového odkazu Supabase (PKCE): ?code=… → session → `next`.
 * `next` smí být jen relativní cesta v aplikaci (ochrana proti open redirectu).
 */
export async function GET(request: NextRequest) {
  const origin = originFrom({
    proto: request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", ""),
    host: request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host,
    fallback: process.env.NEXT_PUBLIC_APP_URL,
  });
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get("next"), "/orders");
  const fail = (message: string) =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, origin));

  if (!isSupabaseConfigured()) return NextResponse.redirect(new URL("/setup", origin));

  const providerError = params.get("error_description") || params.get("error");
  if (providerError) {
    return fail(
      /expired|invalid/i.test(providerError)
        ? "Odkaz je neplatný nebo vypršel — vyžádej si nový na stránce Zapomenuté heslo."
        : providerError,
    );
  }

  const code = params.get("code");
  if (!code) return fail("Odkaz je neúplný — vyžádej si nový na stránce Zapomenuté heslo.");

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return fail(
        "Odkaz je neplatný nebo vypršel. Otevři ho ve stejném prohlížeči, kde jsi o obnovu žádal(a), nebo použij kód z e-mailu.",
      );
    }
  } catch {
    return fail("Přihlášení z odkazu se nepovedlo — zkus to prosím znovu.");
  }
  return NextResponse.redirect(new URL(next, origin));
}
