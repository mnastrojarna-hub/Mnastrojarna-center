/**
 * Ověřené přihlášení BEZ síťového volání na Supabase Auth (rychlost: dřív 2× GET /auth/v1/user na každý
 * požadavek — middleware + stránka — tj. 2 round-tripy do Supabase před prvním dotazem).
 *
 * Podpis access tokenu (JWT ze session cookie) se ověří lokálně:
 *  - asymetrické klíče projektu (ES256 / RS256, Supabase „JWT Signing Keys") → supabase.auth.getClaims()
 *    ověří podpis proti JWKS (veřejné klíče, cache v paměti instance),
 *  - starší sdílený klíč (HS256) → HMAC zde, pokud je v prostředí SUPABASE_JWT_SECRET (nesedí-li podpis,
 *    rozhodne síťové ověření níže — špatně opsaný klíč nikoho neodhlásí),
 *  - jinak (HS256 bez klíče) → getClaims() spadne na getUser() = síťové ověření jako dřív.
 * Prošlý token obnoví getSession() (refresh token) stejně jako dřív getUser(). Token s neplatným
 * podpisem / prošlý / bez `sub` = nepřihlášen. Deaktivaci účtu dál hlídá profil (active) při každém
 * požadavku; odhlášení na jiném zařízení platí nejpozději do vypršení access tokenu (výchozí 1 h) —
 * stejně jako pro PostgREST, který token ověřuje také jen podpisem.
 *
 * Bez závislosti na next/headers a server-only — používá ho i middleware (edge runtime).
 */

export interface VerifiedAuthUser {
  id: string;
  email: string | null;
  user_metadata: Record<string, unknown>;
}

/** Minimální rozhraní Supabase Auth klienta (server i middleware). */
export interface AuthLike {
  auth: {
    getSession(): Promise<{ data: { session: { access_token: string } | null }; error: unknown }>;
    getClaims(): Promise<{ data: { claims: Record<string, unknown> } | null; error: unknown }>;
  };
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

let hmacKey: { secret: string; key: Promise<CryptoKey> } | null = null;

function hmacKeyFor(secret: string): Promise<CryptoKey> {
  if (!hmacKey || hmacKey.secret !== secret) {
    hmacKey = {
      secret,
      key: crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]),
    };
  }
  return hmacKey.key;
}

/** Ověří HS256 JWT sdíleným klíčem (podpis + exp). Vrací claims, jinak null. */
export async function verifyHs256(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((p) => BASE64URL.test(p))) return null;
  const header = b64urlToJson(parts[0]);
  if (!header || header.alg !== "HS256") return null;
  const payload = b64urlToJson(parts[1]);
  if (!payload) return null;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC", await hmacKeyFor(secret), b64urlToBytes(parts[2]) as BufferSource, new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;
  } catch {
    return null;
  }
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp <= nowSec) return null;
  return payload;
}

/** Algoritmus podpisu z hlavičky JWT (bez ověření). */
export function jwtAlg(token: string): string | null {
  const head = token.split(".")[0];
  if (!head || !BASE64URL.test(head)) return null;
  const h = b64urlToJson(head);
  return typeof h?.alg === "string" ? h.alg : null;
}

function toUser(claims: Record<string, unknown> | null | undefined): VerifiedAuthUser | null {
  if (!claims) return null;
  const sub = typeof claims.sub === "string" ? claims.sub : "";
  // token bez subjektu (anon / servisní klíč) není přihlášený uživatel
  if (!sub || claims.role === "anon" || claims.role === "service_role") return null;
  const meta = claims.user_metadata;
  return {
    id: sub,
    email: typeof claims.email === "string" ? claims.email : null,
    user_metadata: meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {},
  };
}

/** Přihlášený uživatel z ověřeného access tokenu (null = nepřihlášen / neplatný token). */
export async function getVerifiedAuthUser(supabase: AuthLike): Promise<VerifiedAuthUser | null> {
  try {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (secret) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return null;
      if (jwtAlg(token) === "HS256") {
        const claims = await verifyHs256(token, secret);
        if (claims) return toUser(claims);
        // nesedí podpis (jiný / starý klíč v prostředí?) → rozhodne Supabase Auth (níže), nikoho neodhlásit omylem
      }
    }
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data) return null;
    return toUser(data.claims);
  } catch {
    return null;
  }
}
