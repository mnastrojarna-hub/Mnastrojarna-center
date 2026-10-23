import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/session";
import { cleanNumber, isUuid, one, personRef, todayIso, type PersonEmbed } from "@/lib/jobs/mapping";
import { isJobStage } from "@/lib/jobs/stages";
import type { JobsDb } from "@/lib/jobs/events";
import {
  currentRule, isCommissionBase, isCommissionStatus, isStatementStatus, lastMonths,
  type CommissionBandView, type CommissionEntryView, type CommissionOverview, type CommissionOwnerView,
  type CommissionRuleView, type CommissionStatementView, type CommissionTierView,
} from "@/components/commissions/model";

/**
 * Datová vrstva provizí: měsíční vyúčtování (s rozpadem do pásem), provize
 * zakázek, smlouvy obchodníků. Čte servisním klíčem → práva hlídá sama:
 * super admin („commissions_all") vidí všechny, obchodník jen sebe.
 * Nic nepočítá — vše přepočítává DB (triggery).
 */

const MAX_ROWS = 5000;

function warn(scope: string, error: { message: string } | null | undefined) {
  if (error) console.error(`[data:commissions:${scope}] Supabase chyba: ${error.message}`);
}

const num = (v: unknown) => cleanNumber(v) ?? 0;

// ── Řádky DB → view ─────────────────────────────────────────
export interface CommissionRuleRow {
  id: string;
  owner_id: string;
  name?: string | null;
  base?: string | null;
  basis?: string | null;
  rate?: number | string | null;
  tiers?: unknown;
  valid_from: string;
  payout_days?: number | null;
  note?: string | null;
  created_at: string;
}

function tiersOf(raw: unknown): CommissionTierView[] | null {
  if (!Array.isArray(raw)) return null;
  const out: CommissionTierView[] = [];
  for (const t of raw as { from?: unknown; to?: unknown; rate?: unknown }[]) {
    if (!t || typeof t !== "object") continue;
    const to = t.to === null || t.to === undefined || t.to === "" ? null : cleanNumber(t.to);
    out.push({ from: num(t.from), to, rate: num(t.rate) });
  }
  return out.sort((a, b) => a.from - b.from);
}

export function rowToCommissionRule(r: CommissionRuleRow): CommissionRuleView {
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name ?? null,
    base: isCommissionBase(r.base) ? r.base : "margin",
    basis: r.basis === "collected" ? "collected" : "ordered",
    rate: num(r.rate),
    tiers: tiersOf(r.tiers),
    validFrom: r.valid_from,
    payoutDays: r.payout_days ?? 20,
    note: r.note ?? null,
    createdAt: r.created_at,
  };
}

interface StatementRow {
  id: string;
  owner_id: string;
  period: string;
  rule_name?: string | null;
  basis?: string | null;
  revenue?: number | string | null;
  cost?: number | string | null;
  profit?: number | string | null;
  commission?: number | string | null;
  bands?: unknown;
  jobs_count?: number | null;
  unknown_cost_jobs?: number | null;
  due_date?: string | null;
  status?: string | null;
  paid_at?: string | null;
  updated_at?: string | null;
}

function bandsOf(raw: unknown): CommissionBandView[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .filter((b) => b && typeof b === "object")
    .map((b) => ({
      from: num(b.from),
      to: b.to === null || b.to === undefined || b.to === "" ? null : cleanNumber(b.to),
      rate: num(b.rate),
      revenue: num(b.revenue),
      profit: num(b.profit),
      commission: num(b.commission),
    }))
    .sort((a, b) => a.from - b.from);
}

function rowToStatement(r: StatementRow, ownerName: string): CommissionStatementView {
  return {
    id: r.id,
    ownerId: r.owner_id,
    ownerName,
    period: r.period,
    ruleName: r.rule_name ?? null,
    basis: r.basis === "collected" ? "collected" : "ordered",
    revenue: num(r.revenue),
    cost: num(r.cost),
    profit: num(r.profit),
    commission: num(r.commission),
    bands: bandsOf(r.bands),
    jobsCount: r.jobs_count ?? 0,
    unknownCostJobs: r.unknown_cost_jobs ?? 0,
    dueDate: r.due_date ?? null,
    status: isStatementStatus(r.status) ? r.status : "otevrena",
    paidAt: r.paid_at ?? null,
    updatedAt: r.updated_at ?? null,
  };
}

type Embed<T> = T | T[] | null | undefined;
interface EntryRow {
  id: string;
  owner_id: string;
  order_id: string | null;
  period: string;
  revenue?: number | string | null;
  cost?: number | string | null;
  profit?: number | string | null;
  margin?: number | string | null;
  rate?: number | string | null;
  base?: string | null;
  commission?: number | string | null;
  estimated_commission?: number | string | null;
  status?: string | null;
  cost_known?: boolean | null;
  collected?: boolean | null;
  cost_pending_po?: string[] | null;
  job?: Embed<{
    id: string; number: string | null; title: string | null; status: string; paid_at?: string | null;
    customer?: Embed<{ id: string; name: string }>;
  }>;
}

function rowToEntry(r: EntryRow): CommissionEntryView {
  const job = one(r.job);
  const customer = job ? one(job.customer) : null;
  return {
    id: r.id,
    ownerId: r.owner_id,
    job: job
      ? {
        id: job.id,
        number: job.number ?? "—",
        title: job.title ?? "",
        stage: isJobStage(job.status) ? job.status : "poptavka",
        customerName: customer?.name ?? null,
        paidAt: job.paid_at ?? null,
      }
      : null,
    period: r.period,
    revenue: num(r.revenue),
    cost: num(r.cost),
    profit: num(r.profit),
    margin: num(r.margin),
    rate: num(r.rate),
    base: isCommissionBase(r.base) ? r.base : "margin",
    commission: num(r.commission),
    estimatedCommission: cleanNumber(r.estimated_commission),
    status: isCommissionStatus(r.status) ? r.status : "predbezna",
    costKnown: r.cost_known !== false,
    collected: Boolean(r.collected),
    ...(r.cost_known === false && Array.isArray(r.cost_pending_po) && r.cost_pending_po.length
      ? { costPendingPo: r.cost_pending_po.filter((x) => typeof x === "string" && x) }
      : {}),
  };
}

const ENTRY_SELECT =
  "*, job:orders!order_id(id, number, title, status, paid_at, customer:customers!customer_id(id, name))";

// ── Kdo co změnil (audit log) ───────────────────────────────
interface AuditRow {
  entity_id: string | null;
  action: string;
  created_at: string;
  diff?: Record<string, unknown> | null;
  actor?: Embed<PersonEmbed>;
}

/** Poslední záznam auditu pro každou entitu: jméno účtu a čas. */
export async function lastAuditActors(
  db: JobsDb,
  entity: string,
  actions: string[],
  ids: string[],
): Promise<Map<string, { by: string | null; at: string; action: string }>> {
  const out = new Map<string, { by: string | null; at: string; action: string }>();
  if (!ids.length) return out;
  const { data, error } = await db
    .from("audit_log")
    .select("entity_id, action, created_at, diff, actor:profiles!actor_id(id, full_name, email)")
    .eq("entity", entity)
    .in("action", actions)
    .in("entity_id", ids.slice(0, 500))
    .order("created_at", { ascending: false })
    .limit(2000);
  warn("audit", error);
  for (const r of (data ?? []) as unknown as AuditRow[]) {
    if (!r.entity_id || out.has(r.entity_id)) continue;
    const fallback = typeof r.diff?.byName === "string" ? r.diff.byName : null;
    out.set(r.entity_id, { by: personRef(r.actor)?.name ?? fallback, at: r.created_at, action: r.action });
  }
  return out;
}

// ── Načítání ────────────────────────────────────────────────
export async function fetchCommissionRules(
  db: JobsDb,
  ownerIds: string[] | null,
  opts: { withAuthors?: boolean } = {},
): Promise<CommissionRuleView[]> {
  let q = db.from("commission_rules").select("*");
  if (ownerIds) {
    if (!ownerIds.length) return [];
    q = q.in("owner_id", ownerIds);
  }
  const { data, error } = await q.order("valid_from", { ascending: false }).order("created_at", { ascending: false });
  warn("rules", error);
  const rules = ((data ?? []) as CommissionRuleRow[]).map(rowToCommissionRule);
  if (!opts.withAuthors || !rules.length) return rules;
  const who = await lastAuditActors(db, "commission_rules", ["commission_rule_created", "commission_rule_updated"], rules.map((r) => r.id));
  return rules.map((r) => {
    const w = who.get(r.id);
    return w ? { ...r, changedBy: w.by, changedAt: w.at } : r;
  });
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  active: boolean | null;
  commission_rate: number | string | null;
}

/**
 * Přehled provizí. Obchodník vždy jen sám sebe (ownerId se ignoruje), super admin
 * libovolného obchodníka, bez ownerId všechny. null = bez práva na provize.
 */
export async function getCommissionOverview(
  opts: { ownerId?: string | null; months?: number } = {},
): Promise<CommissionOverview | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const access = await getAccess();
    const user = access.user;
    if (!user || !user.active || !access.can("commissions")) return null;
    const canSeeAll = access.can("commissions_all");
    const ownerId = canSeeAll ? (isUuid(opts.ownerId) ? opts.ownerId : null) : user.id;
    const today = todayIso();
    const months = lastMonths(today, Math.min(36, Math.max(1, opts.months ?? 12)));
    const from = months[months.length - 1] ?? today;
    const db = await createOperatorClient();

    // obchodníci: super admin vidí všechny, kdo mají smlouvu, provize nebo roli obchodníka
    let profileQuery = db.from("profiles").select("id, full_name, email, role, active, commission_rate");
    if (!canSeeAll) profileQuery = profileQuery.eq("id", user.id);
    const stQuery = () => {
      let q = db.from("commission_statements").select("*").gte("period", from);
      if (ownerId) q = q.eq("owner_id", ownerId);
      return q.order("period", { ascending: false });
    };
    const entryQuery = (rangeFrom: number, rangeTo: number) => {
      let q = db
        .from("commission_entries")
        .select(ENTRY_SELECT)
        .or(`period.gte.${from},and(base.eq.margin_tiered,collected.is.false)`);
      if (ownerId) q = q.eq("owner_id", ownerId);
      return q.order("period", { ascending: false }).order("id").range(rangeFrom, rangeTo);
    };

    const [profilesRes, stRes, entryRows, ownerRows] = await Promise.all([
      profileQuery,
      stQuery(),
      (async () => {
        const out: EntryRow[] = [];
        for (let i = 0; i < MAX_ROWS; i += 1000) {
          const { data, error } = await entryQuery(i, i + 999);
          warn("entries", error);
          if (error) break;
          const rows = (data ?? []) as unknown as EntryRow[];
          out.push(...rows);
          if (rows.length < 1000) break;
        }
        return out;
      })(),
      // všichni, kdo kdy měli provizi (přepínač obchodníků je pak stejný v každém pohledu)
      canSeeAll ? db.from("commission_entries").select("owner_id").limit(10_000) : Promise.resolve({ data: [] as { owner_id: string }[], error: null }),
    ]);
    warn("profiles", profilesRes.error);
    warn("statements", stRes.error);

    const profiles = (profilesRes.data ?? []) as ProfileRow[];
    const statementsRaw = (stRes.data ?? []) as StatementRow[];
    const entries = entryRows.map(rowToEntry);

    const paidIds = statementsRaw.filter((st) => st.status === "vyplaceno").map((st) => st.id);
    const [allRules, payers] = await Promise.all([
      fetchCommissionRules(db, canSeeAll ? null : [user.id], { withAuthors: true }),
      lastAuditActors(db, "commission_statements", ["commission_statement_paid"], paidIds),
    ]);
    const involved = new Set<string>([
      ...statementsRaw.map((s) => s.owner_id), ...entries.map((e) => e.ownerId), ...allRules.map((r) => r.ownerId),
      ...((ownerRows.data ?? []) as { owner_id: string }[]).map((r) => r.owner_id),
    ]);
    const ownersList = canSeeAll
      ? profiles.filter((p) => involved.has(p.id) || (p.active !== false && p.role === "obchodnik"))
      : profiles;

    const nameOf = new Map(profiles.map((p) => [p.id, (p.full_name ?? "").trim() || (p.email ?? "").trim() || "Neznámý obchodník"]));
    const owners: CommissionOwnerView[] = ownersList
      .map((p) => ({
        id: p.id,
        name: nameOf.get(p.id) ?? "Neznámý obchodník",
        email: p.email ?? null,
        role: p.role,
        rule: currentRule(allRules.filter((r) => r.ownerId === p.id), today),
        profileRate: num(p.commission_rate),
      }))
      .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name, "cs") : a.role === "obchodnik" ? -1 : 1));

    const shownOwners = new Set(ownerId ? [ownerId] : owners.map((o) => o.id));
    return {
      viewerId: user.id,
      canSeeAll,
      ownerId,
      owners,
      months,
      statements: statementsRaw.map((s) => {
        const view = rowToStatement(s, nameOf.get(s.owner_id) ?? "Neznámý obchodník");
        const paid = payers.get(s.id);
        return paid && view.status === "vyplaceno" ? { ...view, paidBy: paid.by, paidMarkedAt: paid.at } : view;
      }),
      entries,
      rules: allRules.filter((r) => shownOwners.has(r.ownerId)),
      today,
    };
  } catch (err) {
    console.error(`[data:commissions] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
