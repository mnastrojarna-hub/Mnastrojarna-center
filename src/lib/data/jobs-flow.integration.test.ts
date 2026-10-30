import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveFlow, snapshotKeysFromView } from "@/lib/jobs/flow-status";
import { rowFlowView } from "@/components/jobs/book/book-flow";

/**
 * Kniha zakázek a karta zakázky (Balík 1) proti lokálnímu Supabase: fakta toku v řádcích Knihy
 * (JOB_LIST_SELECT) sedí s job_flow_v, filtry podrobných stavů a „Změnil", náhled korekce,
 * faktura / potvrzený DL při částečném dodání stav neposunou, prodloužení platnosti nabídky,
 * autor operace ze sloupců. Mockuje se jen přihlášení a revalidace. Vlastní zakázky Z-E2E-BOOK-*.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/data/jobs-flow.integration.test.ts
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const PREFIX = `Z-E2E-BOOK-${Date.now().toString(36)}`;

const who = vi.hoisted(() => ({
  users: {} as Record<string, { id: string; email: string; fullName: string; role: "super_admin" | "obchodnik" | "zamestnanec" }>,
  current: "sales" as "sales" | "worker" | "admin",
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", async () => {
  const local = await import("@/test/local-supabase");
  const headers = await import("@/lib/supabase/actor-headers");
  const current = () => {
    const u = who.users[who.current];
    return headers.userActor(u ? { id: u.id } : null);
  };
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: (opts: { actor?: unknown } = {}) => local.localAdmin((opts.actor as never) ?? headers.SYSTEM_ACTOR),
    createOperatorClient: async (opts: { actor?: unknown } = {}) =>
      local.localAdmin(opts.actor !== undefined ? (opts.actor as never) : current()),
    createClient: async () => {
      throw new Error("Bez session (test).");
    },
  };
});

vi.mock("@/lib/auth/session", async () => {
  const perms = await import("@/lib/auth/permissions");
  const user = () => {
    const u = who.users[who.current];
    return { ...u, initials: "XX", roleLabel: u.role, aiAccess: true, active: true, hasProfile: true, mustChangePassword: false };
  };
  const can = (f: string) => perms.can(user(), f as never, perms.DEFAULT_ACCESS_CONTEXT);
  return {
    getSessionUser: async () => user(),
    getAccess: async () => ({ user: user(), ctx: perms.DEFAULT_ACCESS_CONTEXT, features: perms.allowedFeatures(user(), perms.DEFAULT_ACCESS_CONTEXT), can }),
    checkFeature: async (f: string) => (can(f) ? { user: user() } : { error: "K této akci nemáš oprávnění." }),
    apiRequire: async () => ({ user: user() }),
    requireUser: async () => user(),
    requireFeature: async () => user(),
  };
});

type Row = Record<string, unknown>;
const KEYS = ["inquiry", "pricing", "quote", "order", "fulfilment", "confirmation", "delivery", "payment"];

describe.skipIf(!ENABLED)("Kniha a karta zakázky — podrobné stavy ↔ lokální Supabase", () => {
  let svc: SupabaseClient;
  let data: typeof import("@/lib/data/jobs");
  let flow: typeof import("@/app/actions/flow-status");
  let jf: typeof import("@/app/actions/job-flow");
  let prod: typeof import("@/app/actions/production");
  let prodData: typeof import("@/lib/data/production");
  const jobs: string[] = [];
  let n = 0;
  const as = (u: "sales" | "worker" | "admin") => { who.current = u; };
  const id = (u: "sales" | "worker" | "admin") => who.users[u].id;

  async function newJob(patch: Row = {}, items: Row[] = []): Promise<string> {
    n += 1;
    const { localAdmin } = await import("@/test/local-supabase");
    const { userActor } = await import("@/lib/supabase/actor-headers");
    const db = localAdmin(userActor({ id: id("sales") }));
    const { data: row, error } = await db.from("orders").insert({
      number: `${PREFIX}-${n}`, title: `Kniha ${n}`, source: "email", status: "poptavka", inquiry_date: "2026-10-20",
      owner_id: id("sales"), ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    const jobId = (row as { id: string }).id;
    jobs.push(jobId);
    if (items.length) {
      const { error: iErr } = await db.from("order_items").insert(items.map((it, i) => ({ order_id: jobId, position: i, unit: "ks", ...it })));
      if (iErr) throw new Error(iErr.message);
    }
    return jobId;
  }
  const job = async (jobId: string) => (await svc.from("orders").select("*").eq("id", jobId).single()).data as Row;

  beforeAll(async () => {
    const local = await import("@/test/local-supabase");
    const env = local.loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    svc = local.localAdmin();
    const { data: profiles } = await svc.from("profiles").select("id, email, full_name, role")
      .in("email", [local.DEMO.sales.email, local.DEMO.worker.email, local.DEMO.admin.email]);
    for (const r of (profiles ?? []) as { id: string; email: string; full_name: string; role: "super_admin" | "obchodnik" | "zamestnanec" }[]) {
      const key = r.role === "super_admin" ? "admin" : r.role === "obchodnik" ? "sales" : "worker";
      who.users[key] = { id: r.id, email: r.email, fullName: r.full_name, role: r.role };
    }
    expect(Object.keys(who.users).sort()).toEqual(["admin", "sales", "worker"]);
    data = await import("@/lib/data/jobs");
    flow = await import("@/app/actions/flow-status");
    jf = await import("@/app/actions/job-flow");
    prod = await import("@/app/actions/production");
    prodData = await import("@/lib/data/production");
  }, 60_000);

  afterAll(async () => {
    if (!svc || !jobs.length) return;
    await svc.from("job_operations").delete().in("job_id", jobs);
    await svc.from("job_payments").delete().in("job_id", jobs);
    await svc.from("invoices").delete().in("order_id", jobs); // A2: faktura zapsaná ručně = řádek v evidenci
    await svc.from("quotes").delete().in("job_id", jobs);
    await svc.from("orders").delete().in("id", jobs);
    await svc.from("audit_log").delete().in("entity_id", jobs);
    await svc.from("audit_log").delete().in("diff->>jobId", jobs);
  }, 60_000);

  it("řádky Knihy nesou fakta toku a odvození sedí s job_flow_v u všech zakázek", async () => {
    as("admin");
    const list = await data.listJobs({ group: "vse" });
    expect(list.length).toBeGreaterThanOrEqual(16);
    const { data: view } = await svc.from("job_flow_v").select("*");
    const byId = new Map(((view ?? []) as Row[]).map((v) => [String(v.id), v]));
    for (const j of list) {
      expect(j.flow, j.number).toBeTruthy();
      const v = byId.get(j.id);
      if (!v) continue;
      const s = deriveFlow(j.flow!, j.flowQuotes ?? []);
      const pick = (x: Record<string, unknown>) => Object.fromEntries(KEYS.map((k) => [k, x[k] ?? null]));
      expect(pick(s as unknown as Record<string, unknown>), j.number).toEqual(pick(snapshotKeysFromView(v) as unknown as Record<string, unknown>));
    }
    const z101 = list.find((j) => j.number === "Z-2026-101");
    expect(z101 && rowFlowView(z101).chip?.key).toBe("prijata");
  });

  it("filtry podrobných stavů (poptávka, objednávka / plnění, dodání) = job_flow_v", async () => {
    as("admin");
    const { data: view } = await svc.from("job_flow_v").select("id, inquiry_key, order_key, fulfilment_key, delivery_key");
    const rows = (view ?? []) as Row[];
    const ids = (pred: (r: Row) => boolean) => rows.filter(pred).map((r) => String(r.id)).sort();
    const got = async (f: Parameters<typeof data.listJobs>[0]) => (await data.listJobs({ group: "vse", ...f })).map((j) => j.id).sort();
    expect(await got({ inquiry: ["prijata"] })).toEqual(ids((r) => r.inquiry_key === "prijata"));
    expect(await got({ order: ["dorucena", "ve_vyrobe"] })).toEqual(ids((r) => r.order_key === "dorucena" || r.fulfilment_key === "ve_vyrobe"));
    expect(await got({ delivery: ["dodano"] })).toEqual(ids((r) => r.delivery_key === "dodano"));
  });

  it("„Změnil“: korekce stavu obchodníkem → filtr i razítko v řádku, náhled dopadu korekce", async () => {
    const jobId = await newJob({ status: "nabidka" });
    const { data: q } = await svc.from("quotes").insert({
      number: `${PREFIX}-Q1`, job_id: jobId, status: "odeslano", sent_at: new Date().toISOString(), total: 1000, revision: 1,
      valid_until: "2099-01-01", owner_id: id("sales"),
    }).select("id").single();
    expect(q).toBeTruthy();
    as("sales");
    const preview = await jf.previewJobStage(jobId, "nerealizovano");
    expect(preview).toMatchObject({ ok: true, from: "nabidka", reasonRequired: true, allowed: true });
    expect(preview.lines?.join("\n")).toContain(`Nabídka ${PREFIX}-Q1 → Zamítnutá`);
    as("worker");
    expect((await jf.previewJobStage(jobId, "nerealizovano")).allowed).toBe(false);
    as("sales");
    expect(await flow.moveJobStage(jobId, "objednavka", { note: "telefonem" })).toMatchObject({ ok: true, stage: "objednavka", orderStatus: "dorucena" });
    const mine = await data.listJobs({ group: "vse", changedBy: id("sales") });
    const row = mine.find((j) => j.id === jobId);
    expect(row).toBeTruthy();
    const v = rowFlowView(row!, { features: ["orders", "workflow", "margins"], userId: id("sales"), role: "obchodnik" });
    expect(v.stamp?.by?.id).toBe(id("sales"));
    expect(v.chip?.key).toBe("dorucena");
    expect(v.next?.key).toBe("order.confirm");
    expect((await data.listJobs({ group: "vse", changedBy: id("worker") })).some((j) => j.id === jobId)).toBe(false);
    const detail = await data.getJob(jobId);
    expect(detail?.flowQuotes?.[0]).toMatchObject({ state: "prijata" }); // jediná odeslaná nabídka se přijala korekcí (M2)
    expect(detail?.quotes[0]).toMatchObject({ state: "prijata" });
  });

  it("faktura a potvrzený DL při částečném dodání stav neposunou; úplné dodání ano", async () => {
    const jobId = await newJob({ status: "ve_vyrobe", order_date: "2026-10-01", value: 2000 }, [
      { name: "Deska A", quantity: 2, unit_price: 500 },
      { name: "Deska B", quantity: 2, unit_price: 500 },
    ]);
    as("sales");
    const items = ((await svc.from("order_items").select("id, name").eq("order_id", jobId).order("position")).data ?? []) as { id: string }[];
    expect(await flow.setDeliveredQuantities(jobId, [{ itemId: items[0].id, delivered: 2 }])).toMatchObject({ ok: true, stage: "ve_vyrobe" });
    const inv = await prod.setInvoiceInfo(jobId, { invoiceNumber: `${PREFIX}-FA`, invoiceDate: "2026-10-22" });
    expect(inv).toMatchObject({ ok: true, stage: "ve_vyrobe" });
    expect((await job(jobId)).invoice_number).toBe(`${PREFIX}-FA`);
    expect(await prod.confirmDeliveryNote(jobId, { date: "2026-10-22" })).toMatchObject({ ok: true, stage: "ve_vyrobe" });
    const detail = await data.getJob(jobId);
    expect(detail && rowFlowView(detail).snapshot?.delivery).toBe("castecne");
    expect(await flow.setDeliveredQuantities(jobId, [{ itemId: items[1].id, delivered: 2 }])).toMatchObject({ ok: true, stage: "dodano_zakaznikovi" });
    expect(await job(jobId)).toMatchObject({ stage_changed_via: "automaticky", stage_change_cause: "dodani", stage_changed_by: id("sales") });
  });

  it("prodloužení platnosti odeslané nabídky: vypršela → odeslaná, s autorem v historii", async () => {
    const jobId = await newJob({ status: "nabidka" });
    const { data: q } = await svc.from("quotes").insert({
      number: `${PREFIX}-Q2`, job_id: jobId, status: "odeslano", sent_at: "2026-09-01T10:00:00Z", total: 1000, revision: 1,
      valid_until: "2026-09-15", owner_id: id("sales"),
    }).select("id").single();
    const qId = (q as { id: string }).id;
    as("sales");
    expect((await jf.extendQuoteValidity(qId, "2020-01-01")).error).toContain("dnes nebo později");
    const r = await jf.extendQuoteValidity(qId, "2099-12-31");
    expect(r).toMatchObject({ ok: true, validUntil: "2099-12-31" });
    const { data: ev } = await svc.from("job_events").select("message, actor_id, type").eq("job_id", jobId).eq("type", "quote");
    expect((ev ?? []).some((e) => (e as Row).actor_id === id("sales") && String((e as Row).message).includes("platnost prodloužena"))).toBe(true);
    const detail = await data.getJob(jobId);
    expect(detail && rowFlowView(detail).snapshot?.quote).toBe("odeslana");
  });

  it("operace nese autora změny stavu ze sloupců (status_changed_*)", async () => {
    const jobId = await newJob({ status: "potvrzeno", order_date: "2026-10-01" });
    const { data: op } = await svc.from("job_operations").insert({ job_id: jobId, position: 0, kind: "frezovani", in_house: true, status: "ceka" }).select("id").single();
    as("sales");
    expect(await prod.setJobOperationStatus((op as { id: string }).id, "probiha")).toMatchObject({ ok: true });
    const ops = await prodData.getJobOperations(jobId);
    expect(ops[0]).toMatchObject({ status: "probiha", changedBy: { id: id("sales") } });
    expect((await job(jobId)).status).toBe("ve_vyrobe");
  });
});
