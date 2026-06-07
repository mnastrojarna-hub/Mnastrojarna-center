import "server-only";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Mailbox } from "@/lib/supabase/database.types";

/** Metadata nastavení (bez tajných hodnot — jen příznak „nastaveno"). */
export interface SettingMeta {
  key: string;
  label: string;
  category: string;
  is_secret: boolean;
  isSet: boolean;
  value: string; // u tajných prázdné, u veřejných skutečná hodnota
}

export async function getIntegrationSettingsMeta(): Promise<SettingMeta[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const db = await createClient();
    const { data, error } = await db
      .from("integration_settings")
      .select("key, label, category, is_secret, value")
      .order("category");
    if (error || !data) return [];
    return (data as { key: string; label: string; category: string; is_secret: boolean; value: string | null }[]).map(
      (r) => ({
        key: r.key,
        label: r.label,
        category: r.category,
        is_secret: r.is_secret,
        isSet: Boolean(r.value),
        value: r.is_secret ? "" : r.value ?? "",
      }),
    );
  } catch {
    return [];
  }
}

export async function getMailboxes(): Promise<Mailbox[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const db = await createClient();
    const { data, error } = await db.from("mailboxes").select("*").order("created_at", { ascending: false });
    if (error || !data) return [];
    return data as Mailbox[];
  } catch {
    return [];
  }
}
