"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { isCurrentUserSuperAdmin } from "@/lib/setup/guard";
import { logAudit } from "@/lib/audit";
import type { UserRole } from "@/lib/supabase/database.types";

type Result = { ok: boolean; error?: string };

const GUARD = "Správa uživatelů je jen pro přihlášeného super admina.";

async function requireSuperAdmin(): Promise<string | null> {
  if (!isSupabaseConfigured() || !hasServiceKey()) {
    return "Nejdřív dokonči připojení Supabase (servisní klíč).";
  }
  if (!(await isCurrentUserSuperAdmin())) return GUARD;
  return null;
}

/** Vytvoří uživatele (obchodník / zaměstnanec / super admin) s heslem a provizní sazbou. */
export async function createUser(input: {
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
  commissionRate?: number; // v procentech, např. 8
}): Promise<Result> {
  const guard = await requireSuperAdmin();
  if (guard) return { ok: false, error: guard };
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) return { ok: false, error: "Vyplň e-mail a heslo." };
  if (input.password.length < 8) return { ok: false, error: "Heslo musí mít alespoň 8 znaků." };

  try {
    const db = createAdminClient();
    const { data, error } = await db.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.fullName.trim(), role: input.role },
    });
    if (error) return { ok: false, error: error.message };
    const id = data.user?.id;
    if (id) {
      await db.from("profiles").upsert({
        id,
        email,
        full_name: input.fullName.trim() || email,
        role: input.role,
        commission_rate: (input.commissionRate ?? 0) / 100,
        active: true,
      } as never);
    }
    await logAudit({ action: "user_created", entity: "profiles", entityId: id, diff: { email, role: input.role } });
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}

/** Úprava role, provizní sazby, jména či aktivity uživatele. */
export async function updateUser(
  id: string,
  changes: { role?: UserRole; commissionRate?: number; active?: boolean; fullName?: string },
): Promise<Result> {
  const guard = await requireSuperAdmin();
  if (guard) return { ok: false, error: guard };
  try {
    const db = createAdminClient();
    const update: Record<string, unknown> = {};
    if (changes.role) update.role = changes.role;
    if (changes.commissionRate !== undefined) update.commission_rate = changes.commissionRate / 100;
    if (changes.active !== undefined) update.active = changes.active;
    if (changes.fullName !== undefined) update.full_name = changes.fullName.trim();
    if (Object.keys(update).length === 0) return { ok: true };

    const { error } = await db.from("profiles").update(update).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await logAudit({ action: "user_updated", entity: "profiles", entityId: id, diff: update });
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}
