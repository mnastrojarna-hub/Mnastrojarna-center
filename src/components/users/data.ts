import "server-only";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { commissionToPercent } from "@/components/users/user-rules";
import { fetchCommissionRules } from "@/lib/data/commissions";
import type { CommissionRuleView } from "@/components/commissions/model";
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
    const base = "id, email, full_name, role, active, ai_access, phone, position, commission_rate, last_seen_at, created_at";
    const loadProfiles = async () => {
      const res = await db.from("profiles")
        .select(`${base}, quote_needs_approval, quote_approval_changed_by, quote_approval_changed_at, `
          + "can_approve_quotes, quote_approver_changed_by, quote_approver_changed_at")
        .order("created_at", { ascending: true });
      // DB bez migrace 20261030200000 — správa uživatelů jede dál (schvalování = výchozí „ano")
      if (res.error && /quote_|can_approve/.test(res.error.message ?? "")) {
        return await db.from("profiles").select(base).order("created_at", { ascending: true }) as typeof res;
      }
      return res;
    };
    const [profilesRes, mailboxesRes, rules] = await Promise.all([
      loadProfiles(),
      db
        .from("mailboxes")
        .select("id, email, display_name, owner_id, active, provider")
        .order("email", { ascending: true }),
      fetchCommissionRules(db, null, { withAuthors: true }).catch((): CommissionRuleView[] => []),
    ]);
    if (profilesRes.error) return { users: [], mailboxes: [], ready: true, error: profilesRes.error.message };

    const profiles = (profilesRes.data ?? []) as Profile[];
    const nameOf = new Map(profiles.map((p) => [p.id, p.full_name || p.email || "—"]));
    const users: ManagedUser[] = profiles.map((p) => ({
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
      commissionRules: rules.filter((r) => r.ownerId === p.id),
      quoteNeedsApproval: p.quote_needs_approval !== false,
      quoteApprovalChangedBy: p.quote_approval_changed_by ? nameOf.get(p.quote_approval_changed_by) ?? null : null,
      quoteApprovalChangedAt: p.quote_approval_changed_at ?? null,
      canApproveQuotes: p.role === "super_admin" || p.can_approve_quotes === true,
      quoteApproverChangedBy: p.quote_approver_changed_by ? nameOf.get(p.quote_approver_changed_by) ?? null : null,
      quoteApproverChangedAt: p.quote_approver_changed_at ?? null,
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
