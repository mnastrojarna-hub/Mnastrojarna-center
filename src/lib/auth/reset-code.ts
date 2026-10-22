import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Obnova hesla kódem z e-mailu — čistá logika bez DB (testovaná).
 * Kód se nikdy neukládá v čisté podobě: v DB je jen sha256(userId:kód:secret),
 * secret = SUPABASE_SECRET_KEY (jen na serveru).
 */

export const RESET_CODE_LENGTH = 6;
/** Platnost kódu v minutách. */
export const RESET_CODE_TTL_MIN = 15;
/** Kolik špatných pokusů snese jeden kód. */
export const RESET_MAX_ATTEMPTS = 5;
/** Kolik kódů lze na jeden e-mail vyžádat za RESET_CODE_TTL_MIN minut. */
export const RESET_MAX_REQUESTS = 3;
/** Strop pokusů na jeden e-mail za 24 h přes všechny kódy (proti hádání s novými kódy). */
export const RESET_MAX_DAILY_ATTEMPTS = 20;

/** Náhodný 6místný kód (kryptograficky bezpečný, s úvodními nulami). */
export function generateResetCode(): string {
  return String(randomInt(0, 10 ** RESET_CODE_LENGTH)).padStart(RESET_CODE_LENGTH, "0");
}

export function hashResetCode(userId: string, code: string, secret: string): string {
  return createHash("sha256").update(`${userId}:${code}:${secret}`).digest("hex");
}

/** Porovnání v konstantním čase (nevyzradí shodu podle doby odezvy). */
export function verifyResetCode(hash: string, userId: string, code: string, secret: string): boolean {
  if (!hash || !/^[0-9a-f]+$/i.test(hash)) return false;
  const expected = Buffer.from(hashResetCode(userId, code, secret), "hex");
  const actual = Buffer.from(hash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Z uživatelského vstupu nechá jen číslice („123 456" → „123456"). */
export function normalizeResetCode(input: string | null | undefined): string {
  return String(input ?? "").replace(/\D/g, "");
}

/** Náš kód: přesně 6 číslic. Supabase OTP může mít 6–10 číslic. */
export function isResetCodeFormat(code: string, kind: "own" | "otp" = "own"): boolean {
  return kind === "own" ? /^\d{6}$/.test(code) : /^\d{6,10}$/.test(code);
}

export function normalizeEmail(input: string | null | undefined): string {
  return String(input ?? "").trim().toLowerCase();
}

export function isPlausibleEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function resetCodeExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + RESET_CODE_TTL_MIN * 60_000);
}

/** Začátek okna pro limit počtu vyžádaných kódů. */
export function resetWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - RESET_CODE_TTL_MIN * 60_000);
}

/** Začátek 24h okna pro denní strop pokusů. */
export function dailyWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - 24 * 60 * 60_000);
}

/** Součet pokusů napříč kódy — dosažený denní strop blokuje další ověřování. */
export function dailyAttemptsExceeded(rows: { attempts: number }[]): boolean {
  return rows.reduce((sum, r) => sum + Math.max(0, r.attempts || 0), 0) >= RESET_MAX_DAILY_ATTEMPTS;
}

export function remainingAttempts(attempts: number): number {
  return Math.max(0, RESET_MAX_ATTEMPTS - attempts);
}

/** „Zbývají 3 pokusy" — české skloňování. */
export function attemptsLabel(n: number): string {
  if (n === 1) return "Zbývá 1 pokus";
  if (n >= 2 && n <= 4) return `Zbývají ${n} pokusy`;
  return `Zbývá ${n} pokusů`;
}

/**
 * Cíl přesměrování po přihlášení z odkazu — jen relativní cesta v rámci aplikace
 * (ochrana proti open redirectu: „//evil.cz", „/\evil.cz", „https://…").
 */
export function safeNextPath(next: string | null | undefined, fallback = "/orders"): string {
  if (!next || next.length > 512) return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  if (/[\\\s\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    // relativní cesta musí zůstat na stejném originu
    const base = "http://local.invalid";
    const url = new URL(next, base);
    if (url.origin !== base) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

/** Origin aplikace z hlaviček proxy (Vercel) s fallbackem na NEXT_PUBLIC_APP_URL. */
export function originFrom(input: {
  proto?: string | null;
  host?: string | null;
  fallback?: string | null;
}): string {
  const host = input.host?.split(",")[0]?.trim();
  if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
    const rawProto = input.proto?.split(",")[0]?.trim().toLowerCase();
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
    const proto = rawProto === "http" || rawProto === "https" ? rawProto : isLocal ? "http" : "https";
    return `${proto}://${host}`;
  }
  const fb = input.fallback?.trim();
  if (fb && /^https?:\/\//i.test(fb)) return fb.replace(/\/+$/, "");
  return "http://localhost:3000";
}
