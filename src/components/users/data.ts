import "server-only";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { commissionToPercent } from "@/components/users/user-rules";
import type { Mailbox, Profile } from "@/lib/supabase/database.types";
import type { ManagedUser, MailboxOption, UsersPageData } from "@/components/users/types";

/**
 * Data pro správu uživatelů — čte servisním klíčem (obchází RLS),
 * proto ji smí volat jen stránka chráněná requireFeature("users").
 */
export async function loadUsersPageData(): Promise<UsersPageData> {
  if (!isSupabaseConfigured() || !hasServiceKey()) {
    return { users: [], mailboxes: [], ready: false };
  }
  try {
    const db = createAdminClient();
    const [profilesRes, mailboxesRes] = await Promise.all([
      db
        .from("profiles")
        .select("id, email, full_name, role, active, ai_access, phone, position, commission_rate, last_seen_at, created_at")
        .order("created_at", { ascending: true }),
      db
        .from("mailboxes")
        .select("id, email, display_name, owner_id, active, provider")
        .order("email", { ascending: true }),
    ]);
    if (profilesRes.error) return { users: [], mailboxes: [], ready: true, error: profilesRes.error.message };

    const users: ManagedUser[] = ((profilesRes.data ?? []) as Profile[]).map((p) => ({
      id: p.id,
      email: p.email ?? "",
      fullName: p.full_name || p.email || "Bez jména",
      role: p.role,
      active: p.active !== false,
      aiAccess: Boolean(p.ai_access),
      phone: p.phone ?? null,
      position: p.position ?? null,
      commissionPercent: commissionToPercent(p.commission_rate),
      lastSeenAt: p.last_seen_at ?? null,
      createdAt: p.created_at,
    }));

    const mailboxes: MailboxOption[] = ((mailboxesRes.data ?? []) as Mailbox[]).map((m) => ({
      id: m.id,
      email: m.email,
      displayName: m.display_name,
      ownerId: m.owner_id ?? null,
      active: m.active !== false,
      provider: m.provider,
    }));

    return { users, mailboxes, ready: true };
  } catch (err) {
    return { users: [], mailboxes: [], ready: true, error: err instanceof Error ? err.message : "Chyba" };
  }
}
