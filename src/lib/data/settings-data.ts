import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Mailbox } from "@/lib/supabase/database.types";
import { getMailboxStatuses } from "@/lib/email/mailbox-status";

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
    const db = await createOperatorClient();
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

/** Všichni uživatelé (jen pro super admina — čte se admin klientem). */
export async function getUsers() {
  if (!isSupabaseConfigured()) return [];
  try {
    const db = await createOperatorClient();
    const { data, error } = await db
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return data as import("@/lib/supabase/database.types").Profile[];
  } catch {
    return [];
  }
}

const SECRET_MAILBOX_KEYS = ["imap_password", "smtp_password", "ms_graph_client_secret"] as const;

/**
 * Schránky pro správu v Nastavení — BEZ hesel (upraví se jen zadáním nového), ale s příznakem,
 * která hesla jsou uložená („heslo uloženo ✓"), a se stavem stahování / posledního testu.
 */
export async function getMailboxes(): Promise<Mailbox[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const db = await createOperatorClient();
    const { data, error } = await db.from("mailboxes").select("*").order("created_at", { ascending: false });
    if (error || !data) return [];
    const statuses = await getMailboxStatuses((data as Mailbox[]).map((m) => m.id));
    // Hesla a tajné klíče schránek nikdy neposílat do prohlížeče
    return (data as Mailbox[]).map((m) => {
      const config = { ...(m.config ?? {}) } as Mailbox["config"];
      const secrets_set = {
        imap_password: Boolean(config.imap_password),
        smtp_password: Boolean(config.smtp_password || config.imap_password),
        ms_graph_client_secret: Boolean(config.ms_graph_client_secret),
      };
      for (const key of SECRET_MAILBOX_KEYS) delete config[key];
      const st = statuses.get(m.id);
      // stav inkrementálního stahování (UID / UIDL) do prohlížeče nepatří
      const status = st ? { ...st, sync_state: {} } : null;
      return { ...m, config, secrets_set, status };
    });
  } catch {
    return [];
  }
}
