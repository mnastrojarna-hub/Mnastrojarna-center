import "server-only";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { SYSTEM_ACTOR, type ActorContext } from "@/lib/supabase/actor-headers";
import { logAudit } from "@/lib/audit";
import type { MailboxConfig } from "@/lib/supabase/database.types";

/**
 * Samooprava zastaralého vlastního SMTP hesla: server odmítl uložené `smtp_password`, ale přijal heslo
 * příchozí pošty → `smtp_password` se smaže (SMTP pak používá heslo schránky, jako po každé změně hesla).
 * Smaže se jen to heslo, které server odmítl (mezitím uložené nové zůstane). Zápis do auditu bez hesel.
 */
export async function healSmtpPassword(
  mailboxId: string,
  rejectedPassword: string,
  ctx: { reason: "send" | "test"; actor?: ActorContext | null } = { reason: "send" },
): Promise<boolean> {
  if (!mailboxId || !isSupabaseConfigured() || !hasServiceKey()) return false;
  try {
    const db = createAdminClient({ actor: ctx.actor ?? SYSTEM_ACTOR });
    const { data } = await db.from("mailboxes").select("config, email").eq("id", mailboxId).maybeSingle();
    const row = data as { config: MailboxConfig | null; email: string } | null;
    const cfg = { ...(row?.config ?? {}) } as MailboxConfig;
    if (!row || !cfg.smtp_password || cfg.smtp_password !== rejectedPassword) return false;
    delete cfg.smtp_password;
    const { error } = await db.from("mailboxes").update({ config: cfg } as never).eq("id", mailboxId);
    if (error) return false;
    await logAudit({
      action: "mailbox_smtp_password_healed",
      entity: "mailboxes",
      entityId: mailboxId,
      diff: {
        email: row.email,
        changes: { smtp_password: "odebráno" },
        reason: `server odmítl uložené vlastní SMTP heslo a přijal heslo příchozí pošty (${ctx.reason === "test" ? "test odesílání" : "odeslání"}) — SMTP teď používá heslo schránky`,
      },
      actor: ctx.actor ?? SYSTEM_ACTOR,
    });
    return true;
  } catch {
    return false; // samooprava je best-effort — e-mail už odešel
  }
}
