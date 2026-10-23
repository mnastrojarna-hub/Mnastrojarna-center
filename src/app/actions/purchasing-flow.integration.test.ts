import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Nákup ↔ podrobné stavy a „kdo to udělal" proti lokálnímu Supabase (spec 1.8, 2.7):
 * převzetí po položkách (částečně / uzavřít s menším množstvím), pravidlo „Dodáno k nám"
 * (materiál stav neposouvá, kooperace uprostřed postupu také ne, poslední kooperace ano),
 * navázaná operace → hotovo, zrušení s důvodem, razítka ze sloupců (autor z hlavičky).
 * Klient nese hlavičky autora jako produkční server.ts. Vlastní zakázky Z-E2E-NAKUP-*.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/app/actions/purchasing-flow.integration.test.ts
 */

const ENABLED = process.env.LOCAL_SUPABASE === "1";
const TAG = Date.now().toString(36);
const PREFIX = `Z-E2E-NAKUP-${TAG}`;

const who = vi.hoisted(() => ({
  users: {} as Record<string, { id: string; email: string; fullName: string; role: "super_admin" | "obchodnik" | "zamestnanec" }>,
  current: "sales" as "sales" | "worker" | "admin",
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

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
    createOperatorClient: async (opts: { actor?: unknown } = {}) => local.localAdmin(opts.actor !== undefined ? (opts.actor as never) : current()),
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
    getAccess: async () => ({ user: user(), ctx: perms.DEFAULT_ACCESS_CONTEXT, features: [], can }),
    checkFeature: async (f: string) => (can(f) ? { user: user() } : { error: "K této akci nemáš oprávnění." }),
    apiRequire: async () => ({ user: user() }),
    requireUser: async () => user(),
    requireFeature: async () => user(),
  };
});

type Actions = typeof import("./purchasing");
type Row = Record<string, unknown>;

describe.skipIf(!ENABLED)("nákup ↔ podrobné stavy a autor (lokální Supabase)", () => {
  let svc: SupabaseClient;
  let a: Actions;
  const jobs: string[] = [];
  let n = 0;
  const as = (u: "sales" | "worker" | "admin") => { who.current = u; };
  const id = (u: "sales" | "worker" | "admin") => who.users[u].id;

  async function newJob(status: string): Promise<string> {
    n += 1;
    const { data, error } = await svc.from("orders").insert({
      number: `${PREFIX}-${n}`, title: `Nákup ${n}`, source: "manual", status, inquiry_date: "2026-10-01", order_date: "2026-10-05", value: 50_000,
    }).select("id").single();
    if (error) throw new Error(error.message);
    jobs.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }

  async function newPo(jobId: string, k: string, items: { drawing: string; qty: number }[], status = "potvrzena"): Promise<{ id: string; items: string[] }> {
    const { data, error } = await svc.from("purchase_orders").insert({
      job_id: jobId, number: `OV-E2E-${TAG}-${k}`, status, total: 1000, required_date: "2099-12-31",
    }).select("id").single();
    if (error) throw new Error(error.message);
    const poId = (data as { id: string }).id;
    const { data: its, error: e2 } = await svc.from("purchase_order_items").insert(items.map((it, i) => ({
      purchase_order_id: poId, position: i, drawing_number: it.drawing, name: `Díl ${it.drawing}`, quantity: it.qty, unit: "ks", unit_price: 10,
    }))).select("id, position");
    if (e2) throw new Error(e2.message);
    return { id: poId, items: ((its ?? []) as { id: string; position: number }[]).sort((x, y) => x.position - y.position).map((r) => r.id) };
  }

  async function addOps(jobId: string, ops: { kind: string; inHouse: boolean; status: string; po?: string }[]): Promise<string[]> {
    const { data, error } = await svc.from("job_operations").insert(ops.map((o, i) => ({
      job_id: jobId, position: i, kind: o.kind, in_house: o.inHouse, status: o.status, purchase_order_id: o.po ?? null,
    }))).select("id, position");
    if (error) throw new Error(error.message);
    return ((data ?? []) as { id: string; position: number }[]).sort((x, y) => x.position - y.position).map((r) => r.id);
  }

  const job = async (jobId: string) => (await svc.from("orders").select("*").eq("id", jobId).single()).data as Row;
  const po = async (poId: string) => (await svc.from("purchase_orders").select("*").eq("id", poId).single()).data as Row;

  beforeAll(async () => {
    const { localAdmin, profileId, DEMO } = await import("@/test/local-supabase");
    svc = localAdmin();
    who.users.sales = { id: await profileId(svc, DEMO.sales.email), email: DEMO.sales.email, fullName: "Petr Obchodník", role: "obchodnik" };
    who.users.worker = { id: await profileId(svc, DEMO.worker.email), email: DEMO.worker.email, fullName: "Pavel Dílna", role: "zamestnanec" };
    who.users.admin = { id: await profileId(svc, DEMO.admin.email), email: DEMO.admin.email, fullName: "Super Admin", role: "super_admin" };
    a = await import("./purchasing");
  }, 60_000);

  afterAll(async () => {
    if (!svc || !jobs.length) return;
    await svc.from("job_operations").delete().in("job_id", jobs);
    await svc.from("purchase_orders").delete().in("job_id", jobs);
    await svc.from("orders").delete().in("id", jobs);
    await svc.from("audit_log").delete().in("entity_id", jobs);
    await svc.from("audit_log").delete().in("diff->>job_id", jobs);
  }, 60_000);

  it("materiál: částečné převzetí → čeká na zbytek; uzavření s menším množstvím → dodána, stav zakázky se nemění", async () => {
    const jobId = await newJob("ve_vyrobe");
    await addOps(jobId, [{ kind: "frezovani", inHouse: true, status: "probiha" }]);
    const mat = await newPo(jobId, "MAT", [{ drawing: "M-1", qty: 10 }, { drawing: "M-2", qty: 5 }]);
    as("worker");
    expect((await a.setPurchaseReceived(mat.id, [{ itemId: mat.items[0], received: 10 }])).error).toMatch(/oprávnění/);

    as("sales");
    const r1 = await a.setPurchaseReceived(mat.id, [{ itemId: mat.items[0], received: 10 }, { itemId: mat.items[1], received: 2 }]);
    expect(r1).toMatchObject({ ok: true, complete: false, done: 1, total: 2 });
    expect(r1.hint).toMatch(/1\/2/);
    expect((await po(mat.id)).status).toBe("potvrzena");
    const { data: its } = await svc.from("purchase_order_items").select("id, received_quantity, received_changed_by").eq("purchase_order_id", mat.id);
    for (const it of (its ?? []) as Row[]) expect(it.received_changed_by).toBe(id("sales"));

    // náhled: částečně dodaná + razítko převzetí ze sloupců
    const view = await import("@/lib/data/purchasing").then((m) => m.fetchPurchaseOrder(svc as never, mat.id));
    expect(view?.receipt).toEqual({ done: 1, total: 2, partial: true });
    expect(view?.stamps?.received?.by?.name).toBe("Petr Obchodník");
    const { purchaseExtraStates } = await import("@/lib/jobs/purchasing");
    expect(purchaseExtraStates(view!, "2026-10-23")).toEqual(["castecne_dodana"]);

    expect((await a.setPurchaseReceived(mat.id, [{ itemId: mat.items[1], received: 4, close: true }])).error).toMatch(/důvod/);
    const r2 = await a.setPurchaseReceived(mat.id, [{ itemId: mat.items[1], received: 4, close: true, closeReason: "1 ks zmetek" }]);
    expect(r2).toMatchObject({ ok: true, complete: true, done: 2, total: 2 });
    expect(r2.hint).toMatch(/Materiál převzat/);
    const p = await po(mat.id);
    expect(p).toMatchObject({ status: "dodana", delivered_by: id("sales"), status_changed_by: id("sales") });
    expect((await job(jobId)).status).toBe("ve_vyrobe");

    const { data: ev } = await svc.from("job_events").select("message, data, actor_id").eq("job_id", jobId).eq("data->>purchaseOrderId", mat.id);
    const msgs = ((ev ?? []) as Row[]).map((e) => String(e.message));
    expect(msgs.some((m) => /převzato 1\/2 položky|převzato 1\/2 položek/.test(m))).toBe(true);
    expect(msgs.some((m) => m.includes("uzavřeno: 1 ks zmetek"))).toBe(true);
    for (const e of (ev ?? []) as Row[]) {
      expect(String(e.message)).not.toMatch(/Kč/);
      expect(e.actor_id).toBe(id("sales"));
    }
  }, 60_000);

  it("kooperace uprostřed postupu: operace → hotovo, zakázka zůstává; poslední kooperace → Dodáno k nám (autor = kdo převzal)", async () => {
    const mid = await newJob("ve_vyrobe");
    const midPo = await newPo(mid, "KOOP1", [{ drawing: "K-1", qty: 3 }]);
    const midOps = await addOps(mid, [
      { kind: "tepelne_zpracovani", inHouse: false, status: "probiha", po: midPo.id },
      { kind: "brouseni", inHouse: true, status: "ceka" },
    ]);
    as("sales");
    const r = await a.updatePurchaseOrder(midPo.id, { status: "dodana" });
    expect(r.ok, r.error).toBe(true);
    expect(r.stage).toBeUndefined();
    expect(r.hint).toMatch(/Kooperace hotová/);
    const { data: op } = await svc.from("job_operations").select("status, status_changed_by").eq("id", midOps[0]).single();
    expect(op).toMatchObject({ status: "hotovo", status_changed_by: id("sales") });
    expect((await job(mid)).status).toBe("ve_vyrobe");
    // ruční „Dodáno k nám" dopsalo převzaté množství
    const { data: it } = await svc.from("purchase_order_items").select("received_quantity").eq("purchase_order_id", midPo.id).single();
    expect(Number((it as Row).received_quantity)).toBe(3);

    const last = await newJob("ve_vyrobe");
    const lastPo = await newPo(last, "KOOP2", [{ drawing: "K-2", qty: 2 }, { drawing: "K-3", qty: 1 }]);
    await addOps(last, [
      { kind: "frezovani", inHouse: true, status: "hotovo" },
      { kind: "povrchova_uprava", inHouse: false, status: "probiha", po: lastPo.id },
    ]);
    const rec = await a.setPurchaseReceived(lastPo.id, [{ itemId: lastPo.items[0], received: 2 }, { itemId: lastPo.items[1], received: 1 }], { note: "DL 4471" });
    expect(rec).toMatchObject({ ok: true, complete: true, stage: "dodano_k_nam" });
    const j = await job(last);
    expect(j).toMatchObject({ status: "dodano_k_nam", stage_changed_by: id("sales") });
  }, 60_000);

  it("zakázka bez operací: dodání všech nezrušených objednávek → Dodáno k nám, jinak čeká", async () => {
    const jobId = await newJob("potvrzeno");
    const p1 = await newPo(jobId, "B1", [{ drawing: "B-1", qty: 1 }]);
    const p2 = await newPo(jobId, "B2", [{ drawing: "B-2", qty: 1 }], "odeslana");
    as("sales");
    const r1 = await a.updatePurchaseOrder(p1.id, { status: "dodana" });
    expect(r1.stage).toBeUndefined();
    expect(r1.hint).toMatch(/Čeká se ještě na 1 objednávku/);
    const r2 = await a.updatePurchaseOrder(p2.id, { status: "dodana" });
    expect(r2.stage).toBe("dodano_k_nam");
  }, 60_000);

  it("zrušení s důvodem: kdo a proč zůstane na objednávce, obnovení důvod smaže", async () => {
    const jobId = await newJob("ve_vyrobe");
    const p = await newPo(jobId, "ZR", [{ drawing: "Z-1", qty: 1 }], "odeslana");
    as("admin");
    const r = await a.updatePurchaseOrder(p.id, { status: "zrusena", cancelReason: "Objednáno jinde — levněji" });
    expect(r.ok, r.error).toBe(true);
    expect(await po(p.id)).toMatchObject({ status: "zrusena", cancel_reason: "Objednáno jinde — levněji", cancelled_by: id("admin") });
    const view = await import("@/lib/data/purchasing").then((m) => m.fetchPurchaseOrder(svc as never, p.id));
    expect(view?.cancelReason).toBe("Objednáno jinde — levněji");
    expect(view?.stamps?.cancelled?.by?.name).toBe("Super Admin");
    expect((await a.setPurchaseReceived(p.id, [{ itemId: p.items[0], received: 1 }])).error).toMatch(/Zrušená/);
    expect((await a.updatePurchaseOrder(p.id, { status: "vystavena" })).ok).toBe(true);
    expect((await po(p.id)).cancel_reason).toBeNull();
    const { data: ev } = await svc.from("job_events").select("message").eq("job_id", jobId).eq("data->>purchaseOrderId", p.id);
    expect(((ev ?? []) as Row[]).map((e) => String(e.message)).join("\n")).toMatch(/důvod: Objednáno jinde/);
  }, 60_000);
});
