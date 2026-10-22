"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkFeature } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit";

/**
 * Přiřazení e-mailové schránky uživateli — vlastník (a super admin) vidí její
 * přijatou i odeslanou poštu. Používá správa uživatelů i správa schránek.
 */
export async function setMailboxOwner(
  mailboxId: string,
  ownerId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const access = await checkFeature("users");
  if ("error" in access) return { ok: false, error: access.error };
  if (!isSupabaseConfigured() || !hasServiceKey()) {
    return { ok: false, error: "Nejdřív dokonči připojení Supabase (servisní klíč)." };
  }
  try {
    const db = createAdminClient();
    const { error } = await db.from("mailboxes").update({ owner_id: ownerId } as never).eq("id", mailboxId);
    if (error) return { ok: false, error: error.message };
    // Už stažená pošta schránky patří novému vlastníkovi
    await db.from("emails").update({ owner_id: ownerId } as never).eq("mailbox_id", mailboxId);
    await logAudit({ action: "mailbox_owner_set", entity: "mailboxes", entityId: mailboxId, diff: { owner_id: ownerId } });
    revalidatePath("/settings");
    revalidatePath("/users");
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}
