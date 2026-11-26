import "server-only";
import { after } from "next/server";
import { createAdminClient, hasServiceKey } from "@/lib/supabase/server";
import { cronActor } from "@/lib/supabase/actor-headers";
import type { AnonDb } from "@/lib/anonymize/send-queue";

/**
 * Neodeslané e-maily (majitel 23. 11.: „odeslaný mail, který neodejde, nesmí zapadnout"): kliknuté odeslání,
 * které po 2 minutách stále neodešlo — fronta odeslání s výkresy (anon_send_queue) a K odeslání (mail_outbox,
 * selhal SMTP). Vidí ho autor; super admin vidí všechny.
 */
export interface UnsentMailItem {
  id: string;
  source: "vykresy" | "posta";
  subject: string;
  to: string;
  reason: string | null;
  createdAt: string;
  href: string;
  mine: boolean;
}

const GRACE_MS = 2 * 60_000;

type QueueRow = { id: string; job_id: string | null; payload: { subject?: string; to?: string[] } | null; reason: string | null; created_at: string; created_by: string | null };
type OutboxRow = { id: string; payload: { subject?: string; to?: string } | null; last_error: string | null; created_at: string; created_by: string };

export async function listUnsentMail(user: { id: string; role: string }): Promise<UnsentMailItem[]> {
  if (!hasServiceKey()) return [];
  const db = createAdminClient();
  const admin = user.role === "super_admin";
  const before = new Date(Date.now() - GRACE_MS).toISOString();
  let q1 = db.from("anon_send_queue").select("id, job_id, payload, reason, created_at, created_by")
    .in("status", ["waiting", "blocked", "failed", "sending"]).lt("created_at", before).order("created_at", { ascending: true }).limit(50);
  let q2 = db.from("mail_outbox").select("id, payload, last_error, created_at, created_by")
    .in("status", ["waiting", "failed", "sending"]).lt("created_at", before).order("created_at", { ascending: true }).limit(50);
  if (!admin) {
    q1 = q1.eq("created_by", user.id);
    q2 = q2.eq("created_by", user.id);
  }
  const [a, b] = await Promise.all([q1, q2]);
  const out: UnsentMailItem[] = [];
  for (const r of (a.data ?? []) as QueueRow[]) {
    out.push({
      id: r.id, source: "vykresy", subject: r.payload?.subject ?? "(bez předmětu)", to: (r.payload?.to ?? []).join(", "),
      reason: r.reason, createdAt: r.created_at, href: r.job_id ? `/orders/${r.job_id}?tab=historie` : "/mail", mine: r.created_by === user.id,
    });
  }
  for (const r of (b.data ?? []) as OutboxRow[]) {
    out.push({
      id: r.id, source: "posta", subject: r.payload?.subject ?? "(bez předmětu)", to: r.payload?.to ?? "",
      reason: r.last_error, createdAt: r.created_at, href: "/mail", mine: r.created_by === user.id,
    });
  }
  return out;
}

/**
 * Pojistka po každém zobrazení stránky (po odpovědi, nezdržuje): co ve frontě odeslání s výkresy visí déle
 * než 2 minuty, se odešle (výkres, který se nepovedl / nestihl anonymizovat, jako originál). Po nasazení tak
 * odejde vše, co dřív ve frontě zůstalo. Řádek se odesílá jen jednou (claim v flushSendQueue).
 */
export function flushStuckSendQueueAfterResponse(): void {
  if (!hasServiceKey()) return;
  const task = async () => {
    try {
      const db = createAdminClient({ actor: cronActor("fronta-odeslani") }) as AnonDb;
      const before = new Date(Date.now() - GRACE_MS).toISOString();
      const { data } = await db.from("anon_send_queue").select("id").in("status", ["waiting", "blocked"]).lt("created_at", before).limit(10);
      const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
      if (!ids.length) return;
      const { flushSendQueue } = await import("@/lib/anonymize/send-queue");
      await flushSendQueue(db, { ids, anyway: "all", limit: 10 });
    } catch (err) {
      console.error(`[fronta-odeslani] Odeslání čekajících e-mailů selhalo: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  try {
    after(task);
  } catch {
    void task();
  }
}
