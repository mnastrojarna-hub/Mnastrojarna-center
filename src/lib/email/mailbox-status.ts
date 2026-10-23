import "server-only";
import { createHmac } from "node:crypto";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { SYSTEM_ACTOR } from "@/lib/supabase/actor-headers";
import { resolveIncoming } from "@/lib/email/mail-config";
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
 * může u hosting90 zablokovat IP). Ruční „Stáhnout poštu" funguje dál.
 */
export function isAuthBlocked(
  status: Pick<MailboxStatus, "last_sync_error_kind" | "last_sync_auth_fp"> | null | undefined,
  box: { provider: MailboxProvider; email: string; config: MailboxConfig | null | undefined },
): boolean {
  if (status?.last_sync_error_kind !== "auth" || !status.last_sync_auth_fp) return false;
  return status.last_sync_auth_fp === credentialFingerprint(box.provider, box.email, box.config);
}

/** Text pro UI / výsledek synchronizace u zablokovaného automatického stahování. */
export function authBlockedMessage(email: string): string {
  return `${email}: Heslo odmítnuto — oprav ho v Nastavení → E-mailové schránky (Upravit schránku → Změnit heslo), případně požádej admina. Automatické stahování je do opravy pozastavené (ochrana před zablokováním IP); ručně: Stáhnout poštu.`;
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
