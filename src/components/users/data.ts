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
      const withFull = await db.from("profiles")
        .select(`${base}, quote_needs_approval, quote_approval_changed_by, quote_approval_changed_at, `
          + "can_approve_quotes, quote_approver_changed_by, quote_approver_changed_at, can_rfq, full_access")
        .order("created_at", { ascending: true });
      // DB bez migrace 20261102100000 (full_access) → bez plného přístupu
      if (!withFull.error || !/full_access/.test(withFull.error.message ?? "")) return withFull;
      const withRfq = await db.from("profiles")
        .select(`${base}, quote_needs_approval, quote_approval_changed_by, quote_approval_changed_at, `
          + "can_approve_quotes, quote_approver_changed_by, quote_approver_changed_at, can_rfq")
        .order("created_at", { ascending: true }) as typeof withFull;
      // DB bez migrace 20261031160000 (can_rfq) → bez příznaku poptávek
      if (!withRfq.error || !/can_rfq/.test(withRfq.error.message ?? "")) return withRfq;
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
    const [profilesRes, mailboxesRes, rules, stageChangers, salesContacts, queueMargins, activity] = await Promise.all([
      loadProfiles(),
      db
        .from("mailboxes")
        .select("id, email, display_name, owner_id, active, provider")
        .order("email", { ascending: true }),
      fetchCommissionRules(db, null, { withAuthors: true }).catch((): CommissionRuleView[] => []),
      // „Smí ručně měnit stav zakázky" zvlášť — DB bez migrace 20261109100000 → bez něj (správa uživatelů jede dál)
      Promise.resolve(db.from("profiles").select("id, can_change_stage"))
        .then(({ data, error }) => new Set(error ? [] : ((data ?? []) as { id: string; can_change_stage: boolean | null }[])
          .filter((r) => r.can_change_stage === true).map((r) => r.id)))
        .catch(() => new Set<string>()),
      // „Kontakt pro obchod a ceny" zvlášť — DB bez migrace 20261103130000 → bez něj (správa uživatelů jede dál)
      Promise.resolve(db.from("profiles").select("id, sales_contact_id"))
        .then(({ data, error }) => new Map(error ? [] : ((data ?? []) as { id: string; sales_contact_id: string | null }[])
          .map((r) => [r.id, r.sales_contact_id ?? null] as const)))
        .catch(() => new Map<string, string | null>()),
      // 9. 11. „Smí řešit frontu ke schválení" a „Vidí nákupní ceny a marže" zvlášť — DB bez migrace 20261109130000 → bez nich
      Promise.resolve(db.from("profiles").select("id, can_resolve_queue, can_see_margins"))
        .then(({ data, error }) => new Map(error ? [] : ((data ?? []) as { id: string; can_resolve_queue: boolean | null; can_see_margins: boolean | null }[])
          .map((r) => [r.id, { queue: r.can_resolve_queue === true, margins: r.can_see_margins === true }] as const)))
        .catch(() => new Map<string, { queue: boolean; margins: boolean }>()),
      // 9. 11. poslední aktivita (kliknutí v aplikaci) zvlášť — DB bez migrace 20261109140000 → bez ní
      Promise.resolve(db.from("profiles").select("id, last_active_at, last_active_path"))
        .then(({ data, error }) => new Map(error ? [] : ((data ?? []) as { id: string; last_active_at: string | null; last_active_path: string | null }[])
          .map((r) => [r.id, { at: r.last_active_at ?? null, path: r.last_active_path ?? null }] as const)))
        .catch(() => new Map<string, { at: string | null; path: string | null }>()),
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
      lastActiveAt: activity.get(p.id)?.at ?? null,
      lastActivePath: activity.get(p.id)?.path ?? null,
      createdAt: p.created_at,
      commissionRules: rules.filter((r) => r.ownerId === p.id),
      quoteNeedsApproval: p.quote_needs_approval !== false,
      quoteApprovalChangedBy: p.quote_approval_changed_by ? nameOf.get(p.quote_approval_changed_by) ?? null : null,
      quoteApprovalChangedAt: p.quote_approval_changed_at ?? null,
      canApproveQuotes: p.role === "super_admin" || p.can_approve_quotes === true,
      quoteApproverChangedBy: p.quote_approver_changed_by ? nameOf.get(p.quote_approver_changed_by) ?? null : null,
      quoteApproverChangedAt: p.quote_approver_changed_at ?? null,
      canRfq: p.role !== "zamestnanec" || (p as Profile & { can_rfq?: boolean | null }).can_rfq === true,
      fullAccess: p.role !== "super_admin" && (p as Profile & { full_access?: boolean | null }).full_access === true,
      canChangeStage: p.role !== "zamestnanec" || stageChangers.has(p.id),
      canResolveQueue: p.role === "super_admin" || queueMargins.get(p.id)?.queue === true,
      canSeeMargins: p.role !== "zamestnanec" || queueMargins.get(p.id)?.margins === true,
      salesContactId: salesContacts.get(p.id) ?? null,
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
