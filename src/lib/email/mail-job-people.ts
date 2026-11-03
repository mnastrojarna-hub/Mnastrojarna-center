import "server-only";
import type { JobsDb } from "@/lib/jobs/events";

/**
 * Lidé zakázky z e-mailu (#25): vlastník schránky a obchodník zákazníka. Sdílí „Založit zakázku"
 * (actions/mail.ts) i roztřídění příloh e-mailu dávkou focení (mail-capture.ts).
 */

/** Vlastník schránky e-mailu (emails.owner_id, jinak vlastník schránky) — jen aktivní účet. */
export async function mailboxOwnerOf(db: JobsDb, ownerId: string | null, mailboxId: string | null): Promise<{ id: string; role: string } | null> {
  let id = ownerId;
  if (!id && mailboxId) {
    const { data } = await db.from("mailboxes").select("owner_id").eq("id", mailboxId).maybeSingle();
    id = (data as { owner_id: string | null } | null)?.owner_id ?? null;
  }
  if (!id) return null;
  const { data: p } = await db.from("profiles").select("id, role, active").eq("id", id).maybeSingle();
  const prof = p as { id: string; role: string; active: boolean } | null;
  return prof && prof.active !== false ? { id: prof.id, role: prof.role } : null;
}

export async function customerOwnerOf(db: JobsDb, customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const { data } = await db.from("customers").select("owner_id").eq("id", customerId).maybeSingle();
  return (data as { owner_id: string | null } | null)?.owner_id ?? null;
}
