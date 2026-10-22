import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * E2E provizí proti lokálnímu Supabase (tools/local-supabase): pásmová provize
 * z inkasa (modelový příklad 1 200 000 / 600 000 → 40 000 Kč) přes DB triggery,
 * předběžný odhad, čtení přehledu (getCommissionOverview), výplata vyúčtování
 * a její vrácení, smlouva obchodníka (uložení → přepočet → smazání).
 * Mockuje se jen přihlášení (super admin) a revalidace Next.js. Spuštění:
 *   LOCAL_SUPABASE=1 npx vitest run src/app/actions/commission-rules.integration.test.ts
 * Vše po sobě uklidí.
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const VIT = "4b27a72c-e981-4023-bab7-1e40adf303bd"; // Vít Volný — pásmová smlouva z inkasa
const PETR = "156c7996-b488-4c53-a3f5-e51dd004f4ad"; // Petr Obchodník — 10 % ze zisku (profil)

function loadEnv(): Record<string, string> {
  const file = path.resolve(process.cwd(), ".local-supabase/env");
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock("@/lib/supabase/server", async () => {
  const fs = await import("node:fs");
  const p = await import("node:path");
  const sb = await import("@supabase/supabase-js");
  const env: Record<string, string> = {};
  const file = p.resolve(process.cwd(), ".local-supabase/env");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) env[m[1]] = m[2];
    }
  }
  const admin = () => sb.createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: admin,
    createOperatorClient: async () => admin(),
    createClient: async () => {
      throw new Error("Bez session (test).");
    },
  };
});

vi.mock("@/lib/auth/session", () => {
  const user = {
    id: "5ff3e3a5-29d4-4eba-845d-75b2fb8c5041", email: "admin@local.test", fullName: "Super Admin", role: "super_admin",
    initials: "SA", roleLabel: "Super admin", aiAccess: true, active: true, hasProfile: true, mustChangePassword: false,
  };
  return {
    getSessionUser: async () => user,
    getAccess: async () => ({ user, ctx: {}, features: [], can: () => true }),
    checkFeature: async () => ({ user }),
    apiRequire: async () => ({ user }),
    requireUser: async () => user,
    requireFeature: async () => user,
  };
});

type Actions = typeof import("./commission-rules");
type Data = typeof import("@/lib/data/commissions");

describe.skipIf(!ENABLED)("provize ↔ lokální Supabase (E2E)", () => {
  let db: SupabaseClient;
  let a: Actions;
  let data: Data;
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const tmpJobs: string[] = [];
  const ruleIds: string[] = [];
  let month = "";
  let paidStatementId = "";
  let entrySnapshot: { id: string; status: string; commission: string }[] = [];
  const errors = vi.spyOn(console, "error");

  beforeAll(async () => {
    const env = loadEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    month = `${new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date()).slice(0, 7)}-01`;
    a = await import("./commission-rules");
    data = await import("@/lib/data/commissions");
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    if (paidStatementId) await a.markStatementPaid(paidStatementId, null).catch(() => null);
    for (const id of ruleIds) await db.from("commission_rules").delete().eq("id", id);
    if (tmpJobs.length) {
      await db.from("commission_entries").delete().in("order_id", tmpJobs);
      await db.from("orders").delete().in("id", tmpJobs);
      await db.rpc("recompute_owner_month", { p_owner: VIT, p_period: month });
    }
    await db.from("audit_log").delete().gte("created_at", startedAt).in("entity", ["commission_rules", "commission_statements"]);
  });

  it("pásmová provize z inkasa: 1 200 000 inkaso, zisk 600 000 → 40 000 Kč", async () => {
    const { data: jobs, error } = await db.from("orders").insert([
      { title: "E2E provize — inkasováno", value: 1_200_000, purchase_cost: 600_000, owner_id: VIT, status: "dokonceno", order_date: month },
    ]).select("id");
    expect(error).toBeNull();
    tmpJobs.push(...((jobs ?? []) as { id: string }[]).map((j) => j.id));

    const o = await data.getCommissionOverview({ ownerId: VIT });
    expect(o).not.toBeNull();
    expect(o!.canSeeAll).toBe(true);
    expect(o!.owners.some((x) => x.id === VIT && x.rule?.base === "margin_tiered")).toBe(true);
    const st = o!.statements.find((s) => s.period === month && s.ownerId === VIT);
    expect(st).toMatchObject({ basis: "collected", revenue: 1_200_000, profit: 600_000, commission: 40_000, status: "otevrena" });
    expect(st!.bands.map((b) => b.commission)).toEqual([0, 25_000, 15_000, 0]);
    const entry = o!.entries.find((e) => e.job?.id === tmpJobs[0]);
    expect(entry).toMatchObject({ collected: true, base: "margin_tiered", commission: 40_000, status: "k_vyplate" });
    expect(entry!.job?.title).toBe("E2E provize — inkasováno");
  });

  it("neinkasovaná zakázka: předběžný odhad dle pásma (1,5 mil. → 15 %)", async () => {
    const { data: jobs } = await db.from("orders").insert([
      { title: "E2E provize — čeká na inkaso", value: 300_000, purchase_cost: 100_000, owner_id: VIT, status: "objednavka", order_date: month },
    ]).select("id");
    tmpJobs.push(...((jobs ?? []) as { id: string }[]).map((j) => j.id));
    const o = await data.getCommissionOverview({ ownerId: VIT });
    const pending = o!.entries.find((e) => e.job?.id === tmpJobs[1]);
    expect(pending).toMatchObject({ collected: false, estimatedCommission: 30_000, commission: 0, status: "predbezna" });
    // otevřený měsíc nejde vyplatit
    const st = o!.statements.find((s) => s.period === month && s.ownerId === VIT)!;
    expect(await a.markStatementPaid(st.id, "2026-10-01")).toMatchObject({ ok: false, error: expect.stringMatching(/neskončil/) });
  });

  it("výplata vyúčtování a vrácení (kdo označil = audit log)", async () => {
    const { data: rows } = await db.from("commission_statements").select("id, period, status").eq("owner_id", PETR).eq("status", "k_vyplate").order("period").limit(1);
    const st = ((rows ?? []) as { id: string; period: string }[])[0];
    expect(st).toBeTruthy();
    const { data: before } = await db.from("commission_entries").select("id, status, commission").eq("owner_id", PETR).eq("period", st.period).order("id");
    entrySnapshot = (before ?? []) as typeof entrySnapshot;

    paidStatementId = st.id;
    expect(await a.markStatementPaid(st.id, "2099-01-01")).toMatchObject({ ok: false });
    expect(await a.markStatementPaid(st.id, "2026-10-15")).toEqual({ ok: true, status: "vyplaceno" });
    const { data: after } = await db.from("commission_entries").select("status").eq("owner_id", PETR).eq("period", st.period);
    expect(((after ?? []) as { status: string }[]).every((e) => e.status === "vyplaceno")).toBe(true);

    const o = await data.getCommissionOverview({ ownerId: PETR });
    expect(o!.statements.find((s) => s.id === st.id)).toMatchObject({ status: "vyplaceno", paidAt: "2026-10-15", paidBy: "Super Admin" });

    expect(await a.markStatementPaid(st.id, null)).toEqual({ ok: true, status: "k_vyplate" });
    paidStatementId = "";
    const { data: restored } = await db.from("commission_entries").select("id, status, commission").eq("owner_id", PETR).eq("period", st.period).order("id");
    expect(restored).toEqual(entrySnapshot);
  });

  it("smlouva obchodníka: uložení přepočítá provize, smazání vrátí sazbu z profilu", async () => {
    const bad = await a.saveCommissionRule({ ownerId: PETR, base: "margin_tiered", tiers: [{ from: 0, to: 100, rate: 0 }, { from: 200, to: null, rate: 10 }] });
    expect(bad).toMatchObject({ ok: false, error: expect.stringMatching(/navazovat/) });

    const res = await a.saveCommissionRule({ ownerId: PETR, base: "margin", rate: "12", validFrom: "2000-01-01", name: "E2E smlouva" });
    expect(res.ok).toBe(true);
    ruleIds.push(res.id as string);
    const { data: e1 } = await db.from("commission_entries").select("rate, profit, commission, cost_known, status").eq("owner_id", PETR).not("order_id", "is", null).neq("status", "vyplaceno").eq("cost_known", true).limit(1).single();
    const row = e1 as { rate: string; profit: string; commission: string };
    expect(Number(row.rate)).toBeCloseTo(0.12, 4);
    expect(Number(row.commission)).toBeCloseTo(Math.max(0, Number(row.profit)) * 0.12, 1);

    const list = await a.listCommissionRules(PETR);
    expect(list.rules?.[0]).toMatchObject({ id: res.id, name: "E2E smlouva", rate: 0.12, changedBy: "Super Admin" });

    expect(await a.deleteCommissionRule(res.id as string)).toEqual({ ok: true });
    ruleIds.length = 0;
    const { data: e2 } = await db.from("commission_entries").select("rate").eq("owner_id", PETR).not("order_id", "is", null).neq("status", "vyplaceno").eq("cost_known", true).limit(1).single();
    expect(Number((e2 as { rate: string }).rate)).toBeCloseTo(0.1, 4);
  });

  it("historie objednávek dodavatelům se načte bez chyby", async () => {
    const { fetchPurchaseOrderEvents } = await import("@/components/jobs/purchasing/activity-data");
    const { data: pos } = await db.from("purchase_orders").select("id").limit(20);
    const events = await fetchPurchaseOrderEvents(((pos ?? []) as { id: string }[]).map((p) => p.id));
    expect(Array.isArray(events)).toBe(true);
    const supabaseErrors = errors.mock.calls.filter((c) => String(c[0]).includes("Supabase chyba"));
    expect(supabaseErrors).toEqual([]);
  });
});
