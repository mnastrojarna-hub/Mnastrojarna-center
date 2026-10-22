import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { originFrom, safeNextPath } from "@/lib/auth/reset-code";

const OTP_TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Ověření odkazu ze šablony Supabase ve tvaru
 * {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
 * Funguje i v jiném prohlížeči / na mobilu (na rozdíl od PKCE kódu).
 */
export async function GET(request: NextRequest) {
  const origin = originFrom({
    proto: request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", ""),
    host: request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host,
    fallback: process.env.NEXT_PUBLIC_APP_URL,
  });
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const rawType = params.get("type") as EmailOtpType | null;
  const type = rawType && OTP_TYPES.includes(rawType) ? rawType : null;
  const next = safeNextPath(params.get("next"), type === "recovery" ? "/reset-password" : "/orders");
  const fail = (message: string) =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, origin));

  if (!isSupabaseConfigured()) return NextResponse.redirect(new URL("/setup", origin));
  if (!tokenHash || !type) return fail("Odkaz je neúplný — vyžádej si nový na stránce Zapomenuté heslo.");

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return fail("Odkaz je neplatný nebo vypršel — vyžádej si nový na stránce Zapomenuté heslo.");
  } catch {
    return fail("Ověření odkazu se nepovedlo — zkus to prosím znovu.");
  }
  return NextResponse.redirect(new URL(next, origin));
}
