"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured, hasServiceKey } from "@/lib/supabase/server";
import type { MailboxProvider } from "@/lib/supabase/database.types";

type Result = { ok: boolean; error?: string };

const NEED_OPERATOR =
  "Pro ukládání doplň servisní klíč Supabase (SUPABASE_SECRET_KEY) nebo se přihlas jako super admin.";

/** Uloží hodnoty integrací. Prázdné hodnoty u tajných klíčů přeskočí (nepřepíše). */
export async function saveIntegrationSettings(
  values: Record<string, string>,
  secretKeys: string[],
): Promise<Result> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase není nakonfigurováno — nelze uložit." };
  }
  try {
    const db = await createOperatorClient();
    const secrets = new Set(secretKeys);
    const updates = Object.entries(values).filter(
      ([key, val]) => !(secrets.has(key) && val.trim() === ""), // tajné prázdné = ponechat
    );
    let changed = 0;
    for (const [key, val] of updates) {
      const { data, error } = await db
        .from("integration_settings")
        .update({ value: val.trim() === "" ? null : val.trim() } as never)
        .eq("key", key)
        .select("key");
      if (error) return { ok: false, error: error.message };
      changed += data?.length ?? 0;
    }
    if (changed === 0) return { ok: false, error: hasServiceKey() ? "Nic se neuložilo." : NEED_OPERATOR };
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba ukládání" };
  }
}

export async function addMailbox(
  provider: MailboxProvider,
  email: string,
  displayName: string,
): Promise<Result> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  if (!email.trim()) return { ok: false, error: "Zadej e-mailovou adresu." };
  try {
    const db = await createOperatorClient();
    const { data, error } = await db
      .from("mailboxes")
      .insert({ provider, email: email.trim(), display_name: displayName.trim() || null } as never)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: NEED_OPERATOR };
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}

export async function deleteMailbox(id: string): Promise<Result> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  try {
    const db = await createOperatorClient();
    const { error } = await db.from("mailboxes").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}
