import "server-only";
import { createHmac } from "node:crypto";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { SYSTEM_ACTOR } from "@/lib/supabase/actor-headers";
import { resolveIncoming, resolveSmtp } from "@/lib/email/mail-config";
import {
  authLockOf, CLEARED_AUTH_FAIL, isLikelyHostLockout, recordAuthFailure, recordHostLockout,
  type AuthFailState, type AuthFailWhere, type AuthLock,
} from "@/lib/email/auth-lockout";
import type { MailboxConfig, MailboxProvider, MailboxStatus } from "@/lib/supabase/database.types";

/**
 * Otisk přihlašovacích údajů příchozí pošty (server, port, šifrování, uživatel, heslo) — HMAC,
 * heslo se z něj zpět získat nedá. Změní se, jakmile někdo opraví heslo nebo server.
 */
export function credentialFingerprint(provider: MailboxProvider, email: string, config: MailboxConfig | null | undefined): string | null {
  if (provider === "outlook") return null;
  const ep = resolveIncoming(config, email);
  if (!ep) return null;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "mnastrojarna-mail";
  return createHmac("sha256", key)
    .update(JSON.stringify([ep.protocol, ep.host, ep.port, ep.tls, ep.user, ep.password]))
    .digest("hex")
    .slice(0, 32);
}

/**
 * Server naposledy odmítl heslo a od té doby se přihlašovací údaje nezměnily → automatické
 * stahování (otevření pošty, plánovač) se přihlásit NEzkouší (opakované špatné přihlášení
 * může u hosting90 zablokovat IP). Ruční „Přijmout a odeslat" funguje dál.
 */
export function isAuthBlocked(
  status: Pick<MailboxStatus, "last_sync_error_kind" | "last_sync_auth_fp"> | null | undefined,
  box: { provider: MailboxProvider; email: string; config: MailboxConfig | null | undefined },
): boolean {
  if (status?.last_sync_error_kind !== "auth" || !status.last_sync_auth_fp) return false;
  return status.last_sync_auth_fp === credentialFingerprint(box.provider, box.email, box.config);
}

/**
 * Otisk přihlašovacích údajů pro blokaci po odmítnutém hesle (auth-lockout.ts): uživatel + heslo + server
 * příchozí i odchozí pošty (port a šifrování ne — jiný port téhož serveru blokaci IP neobejde).
 * Změna hesla nebo uživatele = nový otisk = blokace neplatí.
 */
export function lockoutFingerprint(provider: MailboxProvider, email: string, config: MailboxConfig | null | undefined): string | null {
  if (provider === "outlook") return null;
  const inc = resolveIncoming(config, email);
  const smtp = resolveSmtp(config, email);
  if (!inc && !smtp) return null;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "mnastrojarna-mail";
  return createHmac("sha256", key)
    .update(JSON.stringify(["lock", inc?.host.toLowerCase() ?? null, inc?.user ?? null, inc?.password ?? null, smtp?.host.toLowerCase() ?? null, smtp?.user ?? null, smtp?.password ?? null]))
    .digest("hex")
    .slice(0, 32);
}

/** Blokace přihlášení schránky (odmítnuté heslo před < 60 min, stejné údaje). */
export function authLockFor(
  status: AuthFailState | null | undefined,
  box: { provider: MailboxProvider; email: string; config: MailboxConfig | null | undefined },
  now = Date.now(),
): AuthLock {
  return authLockOf(status, lockoutFingerprint(box.provider, box.email, box.config), now);
}

/** Stav odmítnutí jedné schránky (bez migrace / bez klíče = žádný). */
export async function getAuthFailState(mailboxId: string | null | undefined): Promise<AuthFailState | null> {
  if (!mailboxId || !isSupabaseConfigured() || !hasServiceKey()) return null;
  try {
    const { data, error } = await db().from("mailbox_status")
      .select("auth_fail_at, auth_fail_count, auth_fail_fp, auth_fail_where").eq("mailbox_id", mailboxId).maybeSingle();
    if (error) return null;
    return (data as AuthFailState | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Zápis stavu odmítnutí zvlášť (neaplikovaná migrace 20261102120000 nesmí shodit zápis ostatního stavu).
 */
async function writeAuthFail(mailboxId: string, patch: AuthFailState): Promise<void> {
  if (!isSupabaseConfigured() || !hasServiceKey()) return;
  try {
    const { error } = await db().from("mailbox_status")
      .upsert({ mailbox_id: mailboxId, ...patch, updated_at: new Date().toISOString() } as never, { onConflict: "mailbox_id" });
    if (error && !/auth_fail_/.test(error.message ?? "")) console.error(`[mail:status] Uložení odmítnutí selhalo: ${error.message}`);
  } catch {
    // best-effort
  }
}

/** Server odmítl heslo (stahování / test / SMTP / test odeslání) → blokace dalších pokusů na 60 min. */
export async function noteAuthFailure(
  mailboxId: string | null | undefined,
  box: { provider: MailboxProvider; email: string; config: MailboxConfig | null | undefined },
  where: AuthFailWhere,
): Promise<void> {
  if (!mailboxId) return;
  const prev = await getAuthFailState(mailboxId);
  await writeAuthFail(mailboxId, recordAuthFailure(prev, lockoutFingerprint(box.provider, box.email, box.config), where));
}

/** Časový limit vysvětlený blokací poskytovatele → další pokusy znovu až za 60 min (nebo po změně hesla). */
export async function noteHostLockout(
  mailboxId: string | null | undefined,
  box: { provider: MailboxProvider; email: string; config: MailboxConfig | null | undefined },
  prev: AuthFailState | null,
): Promise<void> {
  if (!mailboxId) return;
  await writeAuthFail(mailboxId, recordHostLockout(prev, lockoutFingerprint(box.provider, box.email, box.config)));
}

/** Přihlášení prošlo → blokace pryč (i známé odmítnuté heslo automatického stahování). */
export async function clearAuthFailure(mailboxId: string | null | undefined, opts: { syncAuth?: boolean } = {}): Promise<void> {
  if (!mailboxId) return;
  await writeAuthFail(mailboxId, CLEARED_AUTH_FAIL);
  if (opts.syncAuth) {
    try {
      await db().from("mailbox_status").update({ last_sync_error_kind: null, last_sync_auth_fp: null, last_sync_error: null } as never)
        .eq("mailbox_id", mailboxId).eq("last_sync_error_kind", "auth");
    } catch {
      // best-effort
    }
  }
}

/** Hosty testovacích poskytovatelů (E2E, MAIL_TEST_PROVIDERS) — „známý server" jako předvolba. */
function testProviderHosts(): string[] {
  const raw = process.env.MAIL_TEST_PROVIDERS;
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as { imap?: { host: string }[]; pop3?: { host: string }[]; smtp?: { host: string }[] }[];
    return list.flatMap((p) => [...(p.imap ?? []), ...(p.pop3 ?? []), ...(p.smtp ?? [])].map((e) => String(e.host ?? "")));
  } catch {
    return [];
  }
}

/** Ověřený server: jiná schránka se na něm za posledních 24 h úspěšně přihlásila. */
const KNOWN_GOOD_MS = 24 * 60 * 60_000;

/** Servery, o kterých se ví, že fungují (jiná schránka nedávno stažena / otestována + testovací poskytovatelé). */
export async function knownGoodHosts(exceptMailboxId?: string | null): Promise<string[]> {
  const out = new Set(testProviderHosts().map((h) => h.toLowerCase()));
  if (!isSupabaseConfigured() || !hasServiceKey()) return [...out];
  try {
    const since = new Date(Date.now() - KNOWN_GOOD_MS).toISOString();
    const client = db();
    const { data: st } = await client.from("mailbox_status").select("mailbox_id, last_sync_ok_at, last_test_ok, last_test_at")
      .or(`last_sync_ok_at.gte.${since},and(last_test_ok.eq.true,last_test_at.gte.${since})`);
    const ids = ((st ?? []) as { mailbox_id: string }[]).map((r) => r.mailbox_id).filter((id) => id !== exceptMailboxId);
    if (!ids.length) return [...out];
    const { data: boxes } = await client.from("mailboxes").select("id, config").in("id", ids);
    for (const b of (boxes ?? []) as { config: MailboxConfig | null }[]) {
      const c = b.config ?? {};
      if (c.imap_host) out.add(String(c.imap_host).toLowerCase());
      if (c.smtp_host) out.add(String(c.smtp_host).toLowerCase());
    }
  } catch {
    // best-effort
  }
  return [...out];
}

/**
 * Chyba spojení (časový limit / němý server) — není to dočasná blokace po chybných heslech? Ano → zapíše
 * blokaci dalších pokusů (60 min) a vrátí true; volající nahradí hlášku textem LOCKOUT_TEXT.
 */
export async function explainHostLockout(
  mailboxId: string | null | undefined,
  box: { provider: MailboxProvider; email: string; config: MailboxConfig | null | undefined },
  kind: string | null | undefined,
  host: string | null | undefined,
  prev?: AuthFailState | null,
): Promise<boolean> {
  if (!mailboxId || !kind || !host) return false;
  const state = prev === undefined ? await getAuthFailState(mailboxId) : prev;
  if (!state?.auth_fail_at) return false;
  if (!isLikelyHostLockout(kind, host, state, await knownGoodHosts(mailboxId))) return false;
  await noteHostLockout(mailboxId, box, state);
  return true;
}

/** Text pro UI / výsledek synchronizace u zablokovaného automatického stahování. */
export function authBlockedMessage(email: string): string {
  return `${email}: Heslo odmítnuto — oprav ho v Nastavení pošty (Pošta → ozubené kolo → Schránka → Upravit → nové heslo); firemní schránku opraví super admin v Nastavení → E-mailové schránky. Automatické stahování je do opravy pozastavené (ochrana před zablokováním IP); ručně (Přijmout a odeslat) nejdřív hodinu po odmítnutí.`;
}

/**
 * Stav schránek (tabulka mailbox_status): poslední stažení / chyba, poslední test, stav
 * inkrementálního stahování a zámek proti souběžnému stahování. Zapisuje se servisním klientem
 * jako „Systém" — mailboxes.updated_by zůstává autorem NASTAVENÍ schránky.
 * Best-effort: chybějící tabulka (neaplikovaná migrace) nesmí rozbít stahování.
 */

function db() {
  return createAdminClient({ actor: SYSTEM_ACTOR });
}

export async function getMailboxStatuses(ids: string[]): Promise<Map<string, MailboxStatus>> {
  const out = new Map<string, MailboxStatus>();
  if (!ids.length || !isSupabaseConfigured() || !hasServiceKey()) return out;
  try {
    const { data, error } = await db().from("mailbox_status").select("*").in("mailbox_id", ids);
    if (error) return out;
    for (const r of (data ?? []) as MailboxStatus[]) out.set(r.mailbox_id, r);
  } catch {
    // tabulka nemusí existovat
  }
  return out;
}

export async function updateMailboxStatus(mailboxId: string, patch: Partial<Omit<MailboxStatus, "mailbox_id">>): Promise<void> {
  if (!isSupabaseConfigured() || !hasServiceKey()) return;
  try {
    await db()
      .from("mailbox_status")
      .upsert({ mailbox_id: mailboxId, ...patch, updated_at: new Date().toISOString() } as never, { onConflict: "mailbox_id" });
  } catch (err) {
    console.error(`[mail:status] Uložení stavu schránky selhalo: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Zámek stahování (souběžný cron + tlačítko + automatické stažení). Vrací false, když schránku
 * právě stahuje někdo jiný, nebo (minIntervalMs) když poslední pokus proběhl před chvílí.
 */
export async function acquireSyncLock(mailboxId: string, lockMs: number, minIntervalMs = 0): Promise<boolean> {
  if (!isSupabaseConfigured() || !hasServiceKey()) return true;
  try {
    const client = db();
    await client.from("mailbox_status").upsert({ mailbox_id: mailboxId } as never, { onConflict: "mailbox_id", ignoreDuplicates: true });
    const now = new Date();
    if (minIntervalMs > 0) {
      const { data: cur } = await client.from("mailbox_status").select("last_sync_attempt_at").eq("mailbox_id", mailboxId).maybeSingle();
      const last = (cur as { last_sync_attempt_at: string | null } | null)?.last_sync_attempt_at;
      if (last && now.getTime() - Date.parse(last) < minIntervalMs) return false;
    }
    // Počet změněných řádků (count=exact, bez RETURNING) — PostgREST 12 by filtr `or` použil i na
    // vrácené (už zamčené) řádky a vrátil prázdno.
    const { count, error } = await client
      .from("mailbox_status")
      .update(
        { sync_lock_until: new Date(now.getTime() + lockMs).toISOString(), last_sync_attempt_at: now.toISOString(), updated_at: now.toISOString() } as never,
        { count: "exact" },
      )
      .eq("mailbox_id", mailboxId)
      .or(`sync_lock_until.is.null,sync_lock_until.lt.${now.toISOString()}`);
    if (error) {
      // neaplikovaná migrace (tabulka chybí) = stahovat bez zámku; jiná chyba = raději nestahovat souběžně
      const missingTable = error.code === "42P01" || error.code === "PGRST205" || /could not find the table/i.test(error.message);
      if (!missingTable) console.error(`[mail:status] Zámek schránky selhal: ${error.message}`);
      return missingTable;
    }
    return (count ?? 0) > 0;
  } catch {
    return true;
  }
}

export async function releaseSyncLock(mailboxId: string, patch: Partial<Omit<MailboxStatus, "mailbox_id">> = {}): Promise<void> {
  await updateMailboxStatus(mailboxId, { ...patch, sync_lock_until: null });
}

/** Průběžné uložení stavu stahování (po každé dávce) — při násilném přerušení se nic nestáhne dvakrát. */
export async function saveSyncProgress(mailboxId: string, syncState: Record<string, unknown>): Promise<void> {
  await updateMailboxStatus(mailboxId, { sync_state: syncState });
}
