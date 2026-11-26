"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit";
import { createAdminClient, hasServiceKey } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Křížek na liště „X e-mailů neodešlo" (majitel 25. 11.: „když ji zavřu, tak jednou provždy"): uvedené
 * neodeslané e-maily se natrvalo zruší — už se nezkouší odeslat a lišta se pro ně nevrátí. Autor ruší
 * své, super admin kterékoli. Audit.
 */
export async function dismissUnsentMail(items: { source: "vykresy" | "posta"; id: string }[]): Promise<{ ok: boolean; error?: string; dismissed?: number }> {
  const { user } = await getAccess();
  if (!user || !user.active) return { ok: false, error: "Nepřihlášen." };
  if (!hasServiceKey()) return { ok: false, error: "Chybí servisní klíč." };
  const list = (Array.isArray(items) ? items : []).filter((x) => x && UUID_RE.test(String(x.id)) && (x.source === "vykresy" || x.source === "posta")).slice(0, 100);
  if (!list.length) return { ok: true, dismissed: 0 };
  const admin = user.role === "super_admin";
  const db = createAdminClient({ actor: userActor(user) });
  const now = new Date().toISOString();
  let dismissed = 0;
  const outbox = list.filter((x) => x.source === "posta").map((x) => x.id);
  const queue = list.filter((x) => x.source === "vykresy").map((x) => x.id);
  if (outbox.length) {
    let q = db.from("mail_outbox").update({ status: "cancelled", updated_at: now }).in("id", outbox).in("status", ["waiting", "failed", "sending"]);
    if (!admin) q = q.eq("created_by", user.id);
    const { data, error } = await q.select("id");
    if (error) return { ok: false, error: error.message };
    dismissed += (data ?? []).length;
  }
  if (queue.length) {
    let q = db.from("anon_send_queue").update({ status: "cancelled", reason: "Zavřeno na liště neodeslaných", updated_at: now })
      .in("id", queue).in("status", ["waiting", "blocked", "failed", "sending"]);
    if (!admin) q = q.eq("created_by", user.id);
    const { data, error } = await q.select("id");
    if (error) return { ok: false, error: error.message };
    dismissed += (data ?? []).length;
  }
  await logAudit({ action: "unsent_mail_dismissed", entity: "mail_outbox", diff: { outbox, queue, dismissed }, actor: userActor(user) });
  revalidatePath("/", "layout");
  return { ok: true, dismissed };
}
