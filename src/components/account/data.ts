import "server-only";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Mailbox, Profile } from "@/lib/supabase/database.types";

export interface AccountData {
  phone: string | null;
  position: string | null;
  createdAt: string | null;
  lastSeenAt: string | null;
  mailboxes: { id: string; email: string; displayName: string | null; active: boolean; lastSyncAt: string | null }[];
}

/** Vlastní profil a schránky přihlášeného uživatele (čte jen řádky daného uživatele). */
export async function loadAccountData(userId: string): Promise<AccountData> {
  const empty: AccountData = { phone: null, position: null, createdAt: null, lastSeenAt: null, mailboxes: [] };
  if (!userId || !isSupabaseConfigured() || !hasServiceKey()) return empty;
  try {
    const db = createAdminClient();
    const [profileRes, mailboxRes] = await Promise.all([
      db.from("profiles").select("phone, position, created_at, last_seen_at").eq("id", userId).maybeSingle(),
      db
        .from("mailboxes")
        .select("id, email, display_name, active, last_sync_at")
        .eq("owner_id", userId)
        .order("email", { ascending: true }),
    ]);
    const p = profileRes.data as Pick<Profile, "phone" | "position" | "created_at" | "last_seen_at"> | null;
    const boxes = (mailboxRes.data ?? []) as Pick<Mailbox, "id" | "email" | "display_name" | "active" | "last_sync_at">[];
    return {
      phone: p?.phone ?? null,
      position: p?.position ?? null,
      createdAt: p?.created_at ?? null,
      lastSeenAt: p?.last_seen_at ?? null,
      mailboxes: boxes.map((b) => ({
        id: b.id,
        email: b.email,
        displayName: b.display_name,
        active: b.active !== false,
        lastSyncAt: b.last_sync_at,
      })),
    };
  } catch {
    return empty;
  }
}
