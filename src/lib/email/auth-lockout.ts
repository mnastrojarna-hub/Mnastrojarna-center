/**
 * Ochrana před zablokováním přihlášení u poskytovatele (2. 11.) — čistý modul (bez sítě, bez DB), sdílí ho
 * server i UI.
 *
 * Produkční případ: nová schránka kolegy na hosting90 nejdřív vrátila „Heslo odmítnuto", pak každý test
 * IMAP i SMTP skončil „Server mail.hosting90.cz:993 neodpovídá (časový limit)" — server i port správně,
 * schránka majitele na stejném serveru fungovala. hosting90 po chybných přihlášeních dočasně blokuje IP.
 *
 *  1) Po odmítnutém heslu (stahování, test připojení, test odeslání) se schránka do změny hesla / uživatele
 *     nebo do uplynutí 60 min NEpřihlašuje — ani automaticky (živá pošta, plánovač), ani opakovaným
 *     ručním testem / stažením. Tlačítka ukážou důvod a nejbližší čas dalšího pokusu.
 *  2) Časový limit / němý server na ZNÁMÉM serveru (předvolba poskytovatele nebo server, na kterém jiná
 *     schránka nedávno fungovala) krátce po odmítnutém hesle → místo „špatný server nebo port" vysvětlení
 *     dočasné blokace (LOCKOUT_TEXT).
 *
 * Stav je v mailbox_status (auth_fail_at, auth_fail_count, auth_fail_fp, auth_fail_where — migrace
 * 20261102120000_ui_prefs.sql). Otisk údajů (lockoutFingerprint) počítá server (HMAC, mailbox-status.ts).
 */
import { HOSTING90_RE, PRESETS, type MailErrorKind } from "@/lib/email/mail-config";

/** Jak dlouho po odmítnutém hesle se znovu nepřihlašovat (stejné údaje). */
export const AUTH_LOCK_MS = 60 * 60_000;
/** Jak dlouho po odmítnutém hesle vysvětlovat časový limit dočasnou blokací poskytovatele. */
export const HOST_LOCK_SUSPECT_MS = 3 * 60 * 60_000;
/** Okno pro počítání opakovaných odmítnutí. */
export const AUTH_FAIL_WINDOW_MS = 60 * 60_000;

/** Hláška při podezření na dočasnou blokaci (zadání majitele 2. 11.). */
export const LOCKOUT_TEXT =
  "Hosting pravděpodobně dočasně zablokoval přihlášení po chybných heslech. Ověř heslo ve webmailu (u hosting90 webmail.hosting90.cz) a zkus to znovu asi za hodinu.";

/** Kde přihlášení selhalo; "host" = časový limit vysvětlený blokací poskytovatele (blokace se obnoví). */
export type AuthFailWhere = "sync" | "test" | "smtp" | "send" | "host";

/** Stav odmítnutých přihlášení schránky (sloupce mailbox_status). */
export interface AuthFailState {
  auth_fail_at?: string | null;
  auth_fail_count?: number | null;
  auth_fail_fp?: string | null;
  auth_fail_where?: string | null;
}

export interface AuthLock {
  /** Další přihlášení se stejnými údaji teď nezkoušet. */
  blocked: boolean;
  /** Nejbližší čas dalšího pokusu (ISO), je-li blokováno. */
  until: string | null;
  /** Česky pro tlačítka a výsledek akce. */
  reason: string | null;
}

const NOT_BLOCKED: AuthLock = { blocked: false, until: null, reason: null };

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** „14:05" (Praha) — čas dalšího pokusu do hlášky. */
export function retryClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
}

/** Text blokace: proč a kdy znovu. */
export function authLockReason(until: string, opts: { hostLock?: boolean } = {}): string {
  const when = retryClock(until);
  return (
    (opts.hostLock ? `${LOCKOUT_TEXT} ` : "Heslo bylo odmítnuto — další pokusy o přihlášení jsou pozastavené, aby hosting nezablokoval přihlášení. ") +
    `Změň heslo (Upravit → nové heslo), nebo to zkus znovu${when ? ` po ${when}` : " za hodinu"}.`
  );
}

/**
 * Smí se teď schránka přihlásit? Blokováno, když poslední odmítnutí je mladší než 60 min A údaje
 * (otisk) se od té doby nezměnily. Nový otisk (změněné heslo / uživatel / server) = hned znovu.
 */
export function authLockOf(state: AuthFailState | null | undefined, currentFp: string | null | undefined, now = Date.now()): AuthLock {
  const at = ms(state?.auth_fail_at);
  if (at === null || !state?.auth_fail_fp) return NOT_BLOCKED;
  if (currentFp && currentFp !== state.auth_fail_fp) return NOT_BLOCKED;
  const until = at + AUTH_LOCK_MS;
  if (now >= until) return NOT_BLOCKED;
  const iso = new Date(until).toISOString();
  return { blocked: true, until: iso, reason: authLockReason(iso, { hostLock: state.auth_fail_where === "host" }) };
}

/** Nový stav po odmítnutém hesle (počet odmítnutí v posledních 60 min). */
export function recordAuthFailure(prev: AuthFailState | null | undefined, fp: string | null, where: AuthFailWhere, now = Date.now()): Required<AuthFailState> {
  const last = ms(prev?.auth_fail_at);
  const within = last !== null && now - last < AUTH_FAIL_WINDOW_MS;
  return {
    auth_fail_at: new Date(now).toISOString(),
    auth_fail_count: (within ? Math.max(0, prev?.auth_fail_count ?? 0) : 0) + 1,
    auth_fail_fp: fp,
    auth_fail_where: where,
  };
}

/** Časový limit vysvětlený blokací poskytovatele → blokace pokusů znovu na 60 min (počet odmítnutí beze změny). */
export function recordHostLockout(prev: AuthFailState | null | undefined, fp: string | null, now = Date.now()): Required<AuthFailState> {
  return { auth_fail_at: new Date(now).toISOString(), auth_fail_count: Math.max(1, prev?.auth_fail_count ?? 1), auth_fail_fp: fp, auth_fail_where: "host" };
}

/** Přihlášení prošlo → stav odmítnutí smazat. */
export const CLEARED_AUTH_FAIL: Required<AuthFailState> = { auth_fail_at: null, auth_fail_count: 0, auth_fail_fp: null, auth_fail_where: null };

/** Druhy chyb, které při blokaci IP vypadají jako „server neodpovídá". */
const LOCKOUT_KINDS: ReadonlySet<MailErrorKind> = new Set<MailErrorKind>(["timeout", "greeting", "reset"]);

/** Server předvolby poskytovatele (hosting90, Gmail, …) — ví se, že funguje. */
export function isPresetHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h) return false;
  if (HOSTING90_RE.test(h)) return true;
  return Object.values(PRESETS).some((p) => [...p.imap, ...p.pop3, ...p.smtp].some((e) => e.host.toLowerCase() === h));
}

/**
 * Časový limit (nebo němé spojení) na známém serveru krátce po odmítnutém hesle (≤ 3 h, nebo ≥ 2 odmítnutí
 * za hodinu) → nejspíš dočasná blokace IP u poskytovatele, ne špatný server.
 * `knownGoodHosts` = servery, na kterých jiná schránka nedávno fungovala (+ testovací poskytovatelé).
 */
export function isLikelyHostLockout(
  kind: MailErrorKind | string | null | undefined,
  host: string | null | undefined,
  state: AuthFailState | null | undefined,
  knownGoodHosts: Iterable<string> = [],
  now = Date.now(),
): boolean {
  if (!kind || !host || !LOCKOUT_KINDS.has(kind as MailErrorKind)) return false;
  const at = ms(state?.auth_fail_at);
  if (at === null) return false;
  const age = now - at;
  const recent = age >= 0 && age <= HOST_LOCK_SUSPECT_MS;
  const repeated = age >= 0 && age <= AUTH_FAIL_WINDOW_MS && (state?.auth_fail_count ?? 0) >= 2;
  if (!recent && !repeated) return false;
  const h = host.trim().toLowerCase();
  if (isPresetHost(h)) return true;
  for (const k of knownGoodHosts) if (k && k.trim().toLowerCase() === h) return true;
  return false;
}

/** Hláška chyby s vysvětlením blokace (adresa schránky zůstane na začátku, je-li). */
export function lockoutMessage(prefix?: string): string {
  return prefix ? `${prefix}: ${LOCKOUT_TEXT}` : LOCKOUT_TEXT;
}
