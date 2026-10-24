/**
 * Srozumitelné důvody neúspěšného přihlášení — čistá logika (testováno).
 *
 * Supabase vrací pro neexistující účet i špatné heslo stejné „Invalid login
 * credentials". Interní aplikace firmy potřebuje vědět, co přesně je špatně
 * (překlep v e-mailu × heslo už změněné × počáteční heslo od admina).
 */

export const INACTIVE = "Účet není aktivní. Požádej super admina o aktivaci.";

/** Stav účtu dohledaný přes service key (profiles); null = nepodařilo se zjistit. */
export interface LoginAccountState {
  exists: boolean;
  active: boolean;
  /** Účet má pořád počáteční heslo od super admina (profiles.password_change_required). */
  initialPassword: boolean;
}

/** Přeloží chybu Supabase Auth do češtiny (bez znalosti účtu). */
export function loginError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Nesprávný e-mail nebo heslo.";
  if (m.includes("email not confirmed")) return "E-mail ještě není potvrzený — požádej super admina o aktivaci účtu.";
  if (m.includes("banned")) return INACTIVE;
  if (m.includes("rate limit") || m.includes("too many")) return "Příliš mnoho pokusů — chvíli počkej a zkus to znovu.";
  if (m.includes("database error") || m.includes("unexpected_failure") || m.includes("querying schema")) {
    return "Přihlášení selhalo v databázi účtů (Supabase). Super admin může účtu v Uživatelé nastavit heslo znovu.";
  }
  return message;
}

export function isInvalidCredentials(message: string | null | undefined): boolean {
  return String(message ?? "").toLowerCase().includes("invalid login credentials");
}

/** Přesná hláška pro „Invalid login credentials" podle stavu účtu. */
export function describeInvalidCredentials(email: string, state: LoginAccountState | null): string {
  if (!state) return "Nesprávný e-mail nebo heslo.";
  if (!state.exists) {
    return `Účet ${email} v systému není. Zkontroluj e-mail, nebo ať ho super admin založí v Uživatelé.`;
  }
  if (!state.active) return INACTIVE;
  if (state.initialPassword) {
    return `Nesprávné heslo k účtu ${email}. Účet má zatím počáteční heslo od super admina — když nefunguje, super admin ho nastaví znovu v Uživatelé → Nastavit heslo.`;
  }
  return `Nesprávné heslo k účtu ${email}. Uživatel už má vlastní heslo — když ho zapomněl, použij „Zapomenuté heslo?“.`;
}

/** /login s chybou a zadaným e-mailem (pole zůstane vyplněné tím, co uživatel napsal). */
export function loginRedirectUrl(error: string, email?: string | null, next?: string | null): string {
  const params = new URLSearchParams({ error });
  const e = (email ?? "").trim();
  if (e && e.length <= 254) params.set("email", e);
  const n = safeNextPath(next);
  if (n) params.set("next", n);
  return `/login?${params.toString()}`;
}

/**
 * Kam po přihlášení (odkaz z e-mailu „Otevřít nabídku“ přežije přihlášení): jen cesta v této aplikaci
 * („/…“, ne „//host“ ani „/\host“), bez řídicích znaků, ne zpět na přihlašovací stránky. Jinak null.
 */
export function safeNextPath(raw: string | string[] | null | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const s = String(value ?? "");
  if (!s || s.length > 2000 || !s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) return null;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x5c) return null; // řídicí znaky a „\“
  }
  let url: URL;
  try {
    url = new URL(s, "http://app.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "http://app.invalid") return null;
  if (/^\/(login|auth|setup|forgot-password|reset-password|api)(\/|$)/.test(url.pathname)) return null;
  const out = `${url.pathname}${url.search}${url.hash}`;
  // po normalizaci („/.//host", „/..//host", „/%2e//host" → „//host") znovu: nikdy protokolově relativní adresa
  if (out.startsWith("//") || out.startsWith("/\\")) return null;
  return out;
}

/** E-mail z URL pro předvyplnění formuláře — jen rozumná adresa, jinak prázdno. */
export function prefillEmail(raw: string | string[] | undefined | null): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const e = String(value ?? "").trim();
  return e.length <= 254 && /^[^\s@<>"]+@[^\s@<>"]+$/.test(e) ? e : "";
}
