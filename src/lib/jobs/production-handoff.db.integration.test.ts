import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, DEMO, localAdmin, localSession, localSql, profileId } from "@/test/local-supabase";
import { userActor } from "@/lib/supabase/actor-headers";
import type { ApplyPurchaseOrder, ApplyStep, ProductionApplyPayload, ProductionApplyResult } from "@/lib/jobs/production-handoff-types";
import { PURCHASE_ORDER_SELECT, purchasingTotals, rowToCommissionView, rowToPurchaseOrderView, type PurchaseOrderDbRow } from "@/lib/jobs/purchasing";

/**
 * Předání do výroby na úrovni DB (migrace 20261023150000): RPC production_apply (atomicita, idempotence
 * tokenem, zámky stavu a verze postupu, objednávka + položky + fronta + události v jedné transakci),
 * trigger objednávka → kroky / fronta, recompute_job_production, job_cost a provize „čeká na nákupní cenu",
 * brány vypnuté (production_handoff_enforced() = false), ochrana souhrnu, dopočet spuštěný dvakrát.
 * Pracuje jen s vlastními zakázkami Z-E2E-PH-* a dodavateli „E2E-PH …"; vše po sobě smaže.
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/jobs/production-handoff.db.integration.test.ts
 */

const STAMP = Date.now().toString(36);
const PREFIX = `Z-E2E-PH-${STAMP}`;
const SUP_PREFIX = `E2E-PH ${STAMP}`;

type Row = Record<string, unknown>;

describe.skipIf(!LOCAL_ENABLED)("předání do výroby ↔ lokální Supabase (DB, RPC production_apply)", () => {
  let svc: SupabaseClient;
  let app: SupabaseClient;      // náš server jako obchodník (ctx app)
  let sales = "";
  const jobs: string[] = [];
  const suppliers: string[] = [];
  let n = 0;
  let novak = "";
  let tepkal = "";

  async function newSupplier(name: string, email: string | null = null): Promise<string> {
    const { data, error } = await svc.from("suppliers").insert({ name: `${SUP_PREFIX} ${name}`, email, technologies: [] }).select("id").single();
    if (error) throw new Error(error.message);
    suppliers.push((data as { id: string }).id);
    return (data as { id: string }).id;
  }

  async function newJob(patch: Row = {}): Promise<{ id: string; items: string[] }> {
    n += 1;
    const { data, error } = await svc.from("orders").insert({
      number: `${PREFIX}-${n}`, title: "E2E předání do výroby", source: "manual", status: "potvrzeno", order_date: "2026-10-20",
      owner_id: sales, value: 50_000, currency: "CZK", due_date: "2026-11-20", ...patch,
    }).select("id").single();
    if (error) throw new Error(error.message);
    const id = (data as { id: string }).id;
    jobs.push(id);
    const { data: items, error: ie } = await svc.from("order_items").insert([
      { order_id: id, position: 0, drawing_number: "PR-7075-20", name: "Příruba", material: "1.2379", quantity: 200, unit: "ks" },
      { order_id: id, position: 1, drawing_number: "PR-7075-21", name: "Pouzdro", material: "11 523", quantity: 100, unit: "ks" },
    ]).select("id, position");
    if (ie) throw new Error(ie.message);
    return { id, items: ((items ?? []) as { id: string; position: number }[]).sort((a, b) => a.position - b.position).map((r) => r.id) };
  }

  async function newQuote(jobId: string, supplierId: string, prices: [number | null, number | null]): Promise<string> {
    const { data, error } = await svc.from("supplier_quotes").insert({
      job_id: jobId, supplier_id: supplierId, number: `NAB-${STAMP}-${n}`, currency: "CZK", lead_time_days: 21, source: "manual",
      total: (prices[0] ?? 0) * 200 + (prices[1] ?? 0) * 100,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  async function job(id: string): Promise<Row> {
    const { data } = await svc.from("orders").select("*").eq("id", id).single();
    return data as Row;
  }
  async function ops(jobId: string): Promise<Row[]> {
    const { data } = await svc.from("job_operations").select("*").eq("job_id", jobId).order("position").order("created_at");
    return (data ?? []) as Row[];
  }
  async function pos(jobId: string): Promise<Row[]> {
    const { data } = await svc.from("purchase_orders").select("*, items:purchase_order_items(*)").eq("job_id", jobId).order("created_at");
    return (data ?? []) as Row[];
  }
  async function queue(jobId: string): Promise<Row[]> {
    const { data } = await svc.from("approval_queue").select("*").eq("order_id", jobId).order("created_at");
    return (data ?? []) as Row[];
  }
  async function events(jobId: string): Promise<Row[]> {
    const { data } = await svc.from("job_events").select("*").eq("job_id", jobId).order("created_at");
    return (data ?? []) as Row[];
  }
  async function handoffs(jobId: string): Promise<Row[]> {
    const { data } = await svc.from("production_handoffs").select("*").eq("job_id", jobId).order("created_at");
    return (data ?? []) as Row[];
  }
  async function route(jobId: string): Promise<string> {
    const { data, error } = await svc.rpc("production_route_version", { p_job: jobId });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async function apply(db: SupabaseClient, jobId: string, kind: string, payload: ProductionApplyPayload,
    opts: { token?: string; stage?: string; route?: string } = {}) {
    const stage = opts.stage ?? String((await job(jobId)).status);
    const r = opts.route ?? (await route(jobId));
    return db.rpc("production_apply", {
      p_job: jobId, p_token: opts.token ?? randomUUID(), p_kind: kind, p_expected_stage: stage, p_expected_route: r, p_payload: payload,
    });
  }

  function poOf(group: string, supplierId: string, items: string[], prices: [number | null, number | null], over: Partial<ApplyPurchaseOrder> = {}): ApplyPurchaseOrder {
    const lines = [
      { position: 0, drawing_number: "PR-7075-20", name: "Příruba", material: "1.2379", quantity: 200, unit: "ks", unit_price: prices[0], note: null, order_item_id: items[0] },
      { position: 1, drawing_number: "PR-7075-21", name: "Pouzdro", material: "11 523", quantity: 100, unit: "ks", unit_price: prices[1], note: null, order_item_id: items[1] },
    ];
    return {
      group, supplierId, requiredDate: "2026-11-13", currency: "CZK", deliveryTerms: "DAP Mnástrojárna", paymentTerms: "Splatnost 30 dní",
      note: "Objednávka k naší zakázce.", stepsLabel: "krok 1: Výroba 1", items: lines,
      queue: { title: "Objednávka — E2E", summary: "Výroba 1 · požadovaný termín 13. 11.", target: "dodavatel@example.cz", payload: { subject: "Objednávka", body: "Dobrý den", to: "dodavatel@example.cz" } },
      ...over,
    };
  }

  function step(over: Partial<ApplyStep>): ApplyStep {
    return {
      index: 1, kind: "vyroba", inHouse: false, plannedEnd: "2026-11-13", endsAtCustomerDate: false, deadlineState: "odhad",
      deadlineSource: "nabidka_dodavatele", whoSource: "nejlevnejsi_nabidka", poMode: "vystavit", ...over,
    };
  }

  /** Standardní předání: výroba u Nováka (objednávka teď, start) → kalení v TepKal (objednávka až při předání, konečný termín). */
  function handoffPayload(items: string[], quoteId: string | null, prices: [number | null, number | null] = [40, 42]): ProductionApplyPayload {
    return {
      summary: "Předáno do výroby: 1) Výroba 1 · Novák → 2) Tepelné zpracování · TepKal",
      purchaseOrders: [poOf("g1", novak, items, prices, { supplierQuoteId: quoteId })],
      steps: [
        step({ supplierId: novak, supplierQuoteId: quoteId, poGroup: "g1", start: true }),
        step({ index: 2, kind: "tepelne_zpracovani", supplierId: tepkal, plannedEnd: "2026-11-20", endsAtCustomerDate: true, orderItemIds: [items[0]], poMode: "pri_predani", whoSource: "nabidka" }),
      ],
    };
  }

  beforeAll(async () => {
    svc = localAdmin();
    sales = await profileId(svc, DEMO.sales.email);
    app = localAdmin(userActor({ id: sales }));
    novak = await newSupplier("Frézy Novák s.r.o.", "novak@example.cz");
    tepkal = await newSupplier("TepKal s.r.o.", "tepkal@example.cz");
  }, 60_000);

  afterAll(async () => {
    if (!svc) return;
    if (jobs.length) {
      await svc.from("approval_queue").delete().in("order_id", jobs);
      await svc.from("orders").delete().in("id", jobs);
      await svc.from("audit_log").delete().in("entity_id", jobs);
      await svc.from("audit_log").delete().in("diff->>jobId", jobs);
    }
    if (suppliers.length) {
      await svc.from("suppliers").delete().in("id", suppliers);
      await svc.from("audit_log").delete().in("entity_id", suppliers);
    }
    localSql(`delete from suppliers where name like '${SUP_PREFIX}%'`);
  }, 60_000);

  // ── stav jobů napříč testy ──
  let A: { id: string; items: string[] } = { id: "", items: [] };
  let aPo1 = "";

  it("brány jsou vypnuté a RPC smí jen server (session → 42501)", async () => {
    expect(localSql("select production_handoff_enforced()")).toBe("f");
    const s = await localSession(DEMO.sales.email, DEMO.sales.password);
    const j = await newJob();
    const res = await s.rpc("production_apply", {
      p_job: j.id, p_token: randomUUID(), p_kind: "predani", p_expected_stage: "potvrzeno", p_expected_route: await route(j.id), p_payload: {},
    });
    expect(res.error?.code).toBe("42501");
    // bez předání a bez kdo/termínu: v aplikaci zatím projde vše jako dřív (vynucení až WP4)
    const { error: e1 } = await app.from("job_operations").insert({ job_id: j.id, kind: "vyroba", status: "probiha" });
    expect(e1).toBeNull();
    expect((await job(j.id)).status).toBe("ve_vyrobe");              // pojistka „výroba začala" (brány vypnuté)
    const j2 = await newJob();
    const { error: e2 } = await app.from("orders").update({ status: "ve_vyrobe" }).eq("id", j2.id);
    expect(e2).toBeNull();
  });

  it("předání: kroky, objednávka s položkami a vazbou na díly, fronta, zakázka, události — vše jedním voláním", async () => {
    A = await newJob();
    const quoteId = await newQuote(A.id, novak, [40, 42]);
    const token = randomUUID();
    const { data, error } = await apply(app, A.id, "predani", handoffPayload(A.items, quoteId), { token });
    expect(error).toBeNull();
    const r = data as ProductionApplyResult;
    expect(r).toMatchObject({ kind: "predani", stageFrom: "potvrzeno", stage: "ve_vyrobe", replayed: false });
    expect(r.operationIds).toHaveLength(2);
    expect(r.purchaseOrders).toHaveLength(1);
    expect(r.purchaseOrders[0].number).toMatch(/^OV-\d{4}-\d{3,}$/);
    expect(r.purchaseOrders[0].queueId).toBeTruthy();

    const [po] = await pos(A.id);
    aPo1 = String(po.id);
    expect(po).toMatchObject({ status: "vystavena", supplier_id: novak, supplier_quote_id: quoteId, total: 12_200, created_by: sales,
      handoff_id: r.handoffId, required_date: "2026-11-13", revision: 1 });
    expect(po.order_date).toBe(localSql("select app_today()"));
    const items = (po.items as Row[]).sort((a, b) => Number(a.position) - Number(b.position));
    expect(items.map((i) => [i.order_item_id, Number(i.unit_price)])).toEqual([[A.items[0], 40], [A.items[1], 42]]);

    const q = await queue(A.id);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ type: "purchase_order", status: "pending", owner_id: sales, purchase_order_id: po.id, target: "dodavatel@example.cz" });
    expect((q[0].payload as Row).kind).toBe("issue");

    const j = await job(A.id);
    expect(j).toMatchObject({
      status: "ve_vyrobe", supplier_id: novak, supplier_order_number: po.number,
      production_step: "vyroba", production_step_no: 1, production_step_kind_no: 1, production_total: 2, production_due: "2026-11-13",
      production_due_final: false, production_due_state: "odhad", production_po_status: "vystavena",
      production_end: "2026-11-20", production_final_end: "2026-11-20", production_location: `${SUP_PREFIX} Frézy Novák s.r.o.`,
    });

    const [o1, o2] = await ops(A.id);
    expect(o1).toMatchObject({ status: "probiha", purchase_order_id: po.id, po_mode: "vystavit", created_by: sales, handoff_id: r.handoffId,
      deadline_changed_by: sales, deadline_changed_via: "rucne", who_changed_by: sales, who_source: "nejlevnejsi_nabidka", supplier_quote_id: quoteId });
    expect(o2).toMatchObject({ status: "ceka", ends_at_customer_date: true, order_item_ids: [A.items[0]], po_mode: "pri_predani", purchase_order_id: null });

    const ev = await events(A.id);
    const summary = ev.find((e) => (e.data as Row)?.production === "predani");
    expect(summary).toMatchObject({ actor_id: sales, actor_kind: "user", via: "rucne", entity: "job", message: "Předáno do výroby: 1) Výroba 1 · Novák → 2) Tepelné zpracování · TepKal" });
    expect((summary?.data as Row).handoffId).toBe(r.handoffId);
    const issued = ev.find((e) => String(e.message).startsWith(`Vystavena objednávka ${po.number} dodavateli`));
    expect(issued).toMatchObject({ actor_id: sales, entity: "purchase_order", entity_id: po.id });
    expect(String(issued?.message)).toContain("požadovaný termín 13. 11. 2026 (krok 1: Výroba 1)");
    const stage = ev.filter((e) => e.type === "stage");
    expect(stage).toHaveLength(1);
    expect(stage[0]).toMatchObject({ actor_id: sales });
    expect((stage[0].data as Row)).toMatchObject({ from: "potvrzeno", to: "ve_vyrobe" });
    expect(ev.find((e) => e.message === "Výroba: Výroba 1 → Probíhá (předáno do výroby)")).toMatchObject({ actor_id: sales, entity: "operation" });

    const [h] = await handoffs(A.id);
    expect(h).toMatchObject({ token, kind: "predani", stage_from: "potvrzeno", stage_to: "ve_vyrobe", created_by: sales, created_via: "rucne" });
    expect((h.result as Row).handoffId).toBe(h.id);

    const { data: ce } = await svc.from("commission_entries").select("*").eq("order_id", A.id).maybeSingle();
    expect(ce).toMatchObject({ cost_known: true, cost_pending_po: null });
    expect(Number((ce as Row).cost)).toBe(12_200);

    // stejný token = výsledek prvního volání, nic nového
    const again = await apply(app, A.id, "predani", handoffPayload(A.items, quoteId), { token, stage: "potvrzeno", route: "x" });
    expect(again.error).toBeNull();
    expect(again.data).toMatchObject({ handoffId: r.handoffId, replayed: true });
    expect(await pos(A.id)).toHaveLength(1);
    expect(await queue(A.id)).toHaveLength(1);
    expect(await handoffs(A.id)).toHaveLength(1);
  });

  it("dva souběžné požadavky se stejným tokenem → jedna objednávka a jeden řádek fronty", async () => {
    const B = await newJob();
    const token = randomUUID();
    const r = await route(B.id);
    const [x, y] = await Promise.all([
      apply(app, B.id, "predani", handoffPayload(B.items, null), { token, stage: "potvrzeno", route: r }),
      apply(app, B.id, "predani", handoffPayload(B.items, null), { token, stage: "potvrzeno", route: r }),
    ]);
    expect(x.error).toBeNull();
    expect(y.error).toBeNull();
    expect([(x.data as ProductionApplyResult).replayed, (y.data as ProductionApplyResult).replayed].sort()).toEqual([false, true]);
    expect(await pos(B.id)).toHaveLength(1);
    expect(await queue(B.id)).toHaveLength(1);
    expect(await ops(B.id)).toHaveLength(2);
  });

  it("atomicita: nabídka cizí zakázky → nic se nezapíše (kroky, objednávka, stav, předání, nový dodavatel, fronta, čítač)", async () => {
    const C = await newJob();
    const foreignQuote = await newQuote(A.id, novak, [1, 1]);
    const counter = localSql("select counter from doc_counters where doc_type = 'OV'");
    const payload = handoffPayload(C.items, null);
    payload.newSuppliers = [{ key: "n1", name: `${SUP_PREFIX} Kalírna Atom`, email: "atom@example.cz" }];
    payload.purchaseOrders = [poOf("g1", novak, C.items, [40, 42], { supplierQuoteId: foreignQuote })];
    const { error } = await apply(app, C.id, "predani", payload);
    expect(error?.message).toBe("Nabídka dodavatele nepatří k této zakázce.");
    expect(error?.hint).toBe("VALIDATION");
    expect(await ops(C.id)).toEqual([]);
    expect(await pos(C.id)).toEqual([]);
    expect(await queue(C.id)).toEqual([]);
    expect(await handoffs(C.id)).toEqual([]);
    expect((await job(C.id)).status).toBe("potvrzeno");
    expect(localSql(`select count(*) from suppliers where name = '${SUP_PREFIX} Kalírna Atom'`)).toBe("0");
    expect(localSql("select counter from doc_counters where doc_type = 'OV'")).toBe(counter);

    // firma mimo adresář se založí v transakci a nabídka bez dodavatele se doplní
    const { data: q } = await svc.from("supplier_quotes").insert({ job_id: C.id, supplier_name: "Kalírna Atom", currency: "CZK", source: "manual" }).select("id").single();
    const ok = handoffPayload(C.items, null);
    ok.newSuppliers = [{ key: "n1", name: `${SUP_PREFIX} Kalírna Atom`, email: "atom@example.cz" }];
    ok.purchaseOrders = [poOf("g1", "", C.items, [40, 42], { supplierId: null, supplierKey: "n1", supplierQuoteId: (q as { id: string }).id })];
    ok.steps = [step({ supplierKey: "n1", poGroup: "g1", start: true, supplierQuoteId: (q as { id: string }).id })];
    const res = await apply(app, C.id, "predani", ok);
    expect(res.error).toBeNull();
    const created = localSql(`select id from suppliers where name = '${SUP_PREFIX} Kalírna Atom'`);
    expect(created).toMatch(/^[0-9a-f-]{36}$/);
    suppliers.push(created);
    const { data: q2 } = await svc.from("supplier_quotes").select("supplier_id").eq("id", (q as { id: string }).id).single();
    expect((q2 as Row).supplier_id).toBe(created);
    expect((await ops(C.id))[0]).toMatchObject({ supplier_id: created, status: "probiha" });
    expect((await events(C.id)).some((e) => e.message === `Nový dodavatel v adresáři: ${SUP_PREFIX} Kalírna Atom (při předání do výroby)`)).toBe(true);
    // druhá objednávka u stejného dodavatele (nenavázaná) se odmítne
    const extra = await svc.from("purchase_orders").insert({ job_id: C.id, supplier_id: tepkal, number: `OV-E2E-${STAMP}-1`, status: "vystavena", total: 0 }).select("id").single();
    expect(extra.error).toBeNull();
    const dup = await apply(app, C.id, "plan", { purchaseOrders: [poOf("g9", tepkal, C.items, [1, 1])], steps: [step({ supplierId: tepkal, poGroup: "g9", poMode: "vystavit", plannedEnd: "2026-11-18" })] });
    expect(dup.error?.message).toBe(`${SUP_PREFIX} TepKal s.r.o. už má k zakázce objednávku OV-E2E-${STAMP}-1 — použij ji, nebo ji nejdřív zruš.`);
  });

  it("zámky: jiný stav → STAGE_CHANGED, jiná verze postupu → STEP_CHANGED; dva souběžné „posunout dál“ → jeden uspěje", async () => {
    const st = await apply(app, A.id, "dalsi_krok", {}, { stage: "potvrzeno" });
    expect(st.error?.hint).toBe("STAGE_CHANGED");
    const rt = await apply(app, A.id, "doplneni", {}, { route: "zastaralá" });
    expect(rt.error?.hint).toBe("STEP_CHANGED");

    const [o1, o2] = await ops(A.id);
    const next: ProductionApplyPayload = {
      complete: { operationId: String(o1.id), nextText: "Tepelné zpracování · TepKal · konečný termín 20. 11." },
      purchaseOrders: [poOf("g2", tepkal, A.items, [10.5, null], { requiredDate: "2026-11-20",
        items: [{ position: 0, drawing_number: "PR-7075-20", name: "Příruba — tepelné zpracování", material: "1.2379", quantity: 240, unit: "kg", unit_price: 8.75, note: "200 ks", order_item_id: A.items[0] }] })],
      steps: [step({ index: 2, operationId: String(o2.id), kind: "tepelne_zpracovani", supplierId: tepkal, plannedEnd: "2026-11-20", endsAtCustomerDate: true, orderItemIds: [A.items[0]], poGroup: "g2", start: true })],
    };
    const r = await route(A.id);
    const [x, y] = await Promise.all([
      apply(app, A.id, "dalsi_krok", next, { stage: "ve_vyrobe", route: r }),
      apply(app, A.id, "dalsi_krok", next, { stage: "ve_vyrobe", route: r }),
    ]);
    const errs = [x.error, y.error].filter(Boolean);
    expect(errs).toHaveLength(1);
    expect(errs[0]?.hint).toBe("STEP_CHANGED");
    const after = await ops(A.id);
    expect(after.map((o) => o.status)).toEqual(["hotovo", "probiha"]);
    expect(await pos(A.id)).toHaveLength(2);
    expect((await events(A.id)).some((e) => e.message === "Výroba: Výroba 1 → Hotovo · díl jde dál: Tepelné zpracování · TepKal · konečný termín 20. 11.")).toBe(true);
    expect(await job(A.id)).toMatchObject({ status: "ve_vyrobe", production_step: "tepelne_zpracovani", production_step_no: 2, production_due_final: true });
  });

  it("dokončit jde jen běžící krok (čekající → STEP_CHANGED, nic se nezapíše)", async () => {
    const D = await newJob();
    expect((await apply(app, D.id, "predani", handoffPayload(D.items, null))).error).toBeNull();
    const [, waiting] = await ops(D.id);
    const before = await handoffs(D.id);
    const res = await apply(app, D.id, "dalsi_krok", { complete: { operationId: String(waiting.id) } });
    expect(res.error?.hint).toBe("STEP_CHANGED");
    expect(await handoffs(D.id)).toHaveLength(before.length);
    expect((await ops(D.id)).map((o) => o.status)).toEqual(["probiha", "ceka"]);
  });

  it("objednávka → kroky a fronta: odeslána = požadováno, potvrzený termín posune krok, konečný jen varuje, zrušení zamítne issue/change", async () => {
    const E = await newJob();
    expect((await apply(app, E.id, "predani", handoffPayload(E.items, null))).error).toBeNull();
    const [po] = await pos(E.id);
    const [o1] = await ops(E.id);
    // odeslaná → fronta issue schválena, termín „požadováno"
    expect((await app.from("purchase_orders").update({ status: "odeslana" }).eq("id", po.id)).error).toBeNull();
    expect((await queue(E.id))[0]).toMatchObject({ status: "approved" });
    expect((await ops(E.id))[0]).toMatchObject({ deadline_state: "pozadovano" });
    // potvrzený jiný termín → krok se posune, potvrzeno, událost s autorem
    expect((await app.from("purchase_orders").update({ status: "potvrzena", confirmed_date: "2026-11-16" }).eq("id", po.id)).error).toBeNull();
    const moved = (await ops(E.id))[0];
    expect(moved).toMatchObject({ id: o1.id, planned_end: "2026-11-16", deadline_source: "potvrzeni_dodavatele", deadline_state: "potvrzeno" });
    const ev = (await events(E.id)).find((e) => String(e.message).startsWith("Výroba: Výroba 1 — termín 13. 11. → 16. 11. (potvrdil dodavatel"));
    expect(ev).toMatchObject({ actor_id: sales, actor_kind: "user", via: "rucne", entity: "operation", entity_id: o1.id });
    expect(await job(E.id)).toMatchObject({ production_due: "2026-11-16", production_due_state: "potvrzeno", production_po_status: "potvrzena" });

    // konečný krok: pozdější potvrzení nic nepřepíše, jen varuje
    const F = await newJob();
    const fin = handoffPayload(F.items, null);
    fin.steps = [step({ supplierId: novak, poGroup: "g1", start: true, plannedEnd: "2026-11-20", endsAtCustomerDate: true })];
    expect((await apply(app, F.id, "predani", fin)).error).toBeNull();
    const [fpo] = await pos(F.id);
    expect((await app.from("purchase_orders").update({ confirmed_date: "2026-11-24" }).eq("id", fpo.id)).error).toBeNull();
    expect((await ops(F.id))[0]).toMatchObject({ planned_end: "2026-11-20", deadline_state: "odhad" });
    expect((await events(F.id)).some((e) => String(e.message).startsWith("Dodavatel potvrdil 24. 11. — později než konečný termín (zákazník) 20. 11."))).toBe(true);
    expect((await app.from("purchase_orders").update({ confirmed_date: "2026-11-19" }).eq("id", fpo.id)).error).toBeNull();
    expect((await ops(F.id))[0]).toMatchObject({ planned_end: "2026-11-20", deadline_state: "potvrzeno" });
    // zrušení: issue + change zamítnuté, cancel zůstává
    expect((await svc.from("approval_queue").insert([
      { type: "purchase_order", title: "Změna", status: "pending", order_id: F.id, purchase_order_id: fpo.id, payload: { kind: "change" } },
      { type: "purchase_order", title: "Storno", status: "pending", order_id: F.id, purchase_order_id: fpo.id, payload: { kind: "cancel" } },
    ])).error).toBeNull();
    expect((await app.from("purchase_orders").update({ status: "zrusena", cancel_reason: "test" }).eq("id", fpo.id)).error).toBeNull();
    const q = await queue(F.id);
    const byKind = Object.fromEntries(q.map((r) => [String((r.payload as Row).kind), r.status]));
    expect(byKind).toEqual({ issue: "rejected", change: "rejected", cancel: "pending" });

    // potvrzená bez odeslání → issue zamítnuto („vyřízena jinak")
    const G = await newJob();
    expect((await apply(app, G.id, "predani", handoffPayload(G.items, null))).error).toBeNull();
    const [gpo] = await pos(G.id);
    expect((await app.from("purchase_orders").update({ status: "potvrzena" }).eq("id", gpo.id)).error).toBeNull();
    const [gq] = await queue(G.id);
    expect(gq.status).toBe("rejected");
    expect(String(gq.summary)).toContain("Neodesláno — objednávka vyřízena jinak");
    expect((await ops(G.id))[0]).toMatchObject({ deadline_state: "potvrzeno" });

    // vrácení předání s odeslanou objednávkou → odmítnuto
    const [eh] = await handoffs(E.id);
    const undo = await apply(app, E.id, "zpet", { undoHandoffId: String(eh.id) });
    expect(undo.error?.message).toBe(`Objednávka ${po.number} už odešla dodavateli — nejdřív ji stornuj v Nákupu (obchodník/admin), pak předání vrať.`);
  });

  it("vrácení předání: kroky čekají, nevyslaná objednávka zrušená, fronta zamítnutá, stav zpět", async () => {
    const H = await newJob();
    expect((await apply(app, H.id, "predani", handoffPayload(H.items, null))).error).toBeNull();
    const [h] = await handoffs(H.id);
    const res = await apply(app, H.id, "zpet", { undoHandoffId: String(h.id), note: "omyl" });
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ kind: "zpet", stage: "potvrzeno", undoneHandoffId: h.id });
    expect((await ops(H.id)).map((o) => [o.status, o.purchase_order_id, o.po_mode])).toEqual([["ceka", null, "vystavit"], ["ceka", null, "pri_predani"]]);
    const [po] = await pos(H.id);
    expect(po).toMatchObject({ status: "zrusena", cancel_reason: "Předání vráceno" });
    expect((await queue(H.id))[0].status).toBe("rejected");
    expect(await job(H.id)).toMatchObject({ status: "potvrzeno", production_started_at: null });
    const hs = await handoffs(H.id);
    expect(hs[0].undone_at).not.toBeNull();
    expect(hs[0].undone_by).toBe(sales);
    expect((await events(H.id)).some((e) => e.message === "Předání do výroby vráceno — omyl")).toBe(true);
    // podruhé už nejde
    expect((await apply(app, H.id, "zpet", { undoHandoffId: String(h.id) }, { stage: "potvrzeno" })).error?.hint).toBe("STAGE_CHANGED");
  });

  it("ukončení výroby: převzetí, přeskočení zbylých kroků, zrušení jejich objednávky, sdílená objednávka se jen odpojí", async () => {
    // A: krok 1 hotovo (Novák), krok 2 kalení běží (TepKal, PO2). Naplánuj krok 3 (TepKal, sdílí PO2) a krok 4 (Novák, nová PO3).
    const [, o2] = await ops(A.id);
    const allPos = await pos(A.id);
    const po2 = allPos.find((p) => p.supplier_id === tepkal) as Row;
    const plan = await apply(app, A.id, "plan", {
      resetFinal: true,
      purchaseOrders: [poOf("g3", novak, A.items, [5, 5], { requiredDate: "2026-11-27" })],
      steps: [
        step({ index: 3, kind: "kontrola", supplierId: tepkal, plannedEnd: "2026-11-24", poMode: "existujici", existingPurchaseOrderId: String(po2.id), position: 2 }),
        step({ index: 4, kind: "povrchova_uprava", supplierId: novak, plannedEnd: "2026-11-27", endsAtCustomerDate: true, poGroup: "g3", position: 3 }),
      ],
    });
    expect(plan.error).toBeNull();
    let route4 = await ops(A.id);
    expect(route4.map((o) => [o.kind, o.status, o.ends_at_customer_date])).toEqual([
      ["vyroba", "hotovo", false], ["tepelne_zpracovani", "probiha", false], ["kontrola", "ceka", false], ["povrchova_uprava", "ceka", true],
    ]);
    expect((await events(A.id)).some((e) => String(e.message).startsWith(`Objednávka ${po2.number} přiřazena ke kroku 3: Kontrola / měření`))).toBe(true);

    // částečné převzetí bez „poslat dál" → krok by běžel dál → ukončit nejde a nic se nezapíše
    const poItem = ((po2.items as Row[])[0]).id as string;
    const partial = await apply(app, A.id, "ukonceni", {
      stageTo: "dodano_k_nam", finish: { skipReason: "zákazník chce díly hned" },
      complete: { operationId: String(o2.id), receipts: [{ itemId: poItem, received: 120 }] },
    });
    expect(partial.error?.message).toBe("Krok výroby ještě běží — nejdřív ho dokonči.");
    expect(localSql(`select received_quantity from purchase_order_items where id = '${poItem}'`)).toBe("0.000");

    const res = await apply(app, A.id, "ukonceni", {
      stageTo: "dodano_k_nam", finish: { skipReason: "zákazník chce díly hned" },
      complete: { operationId: String(o2.id), receipts: [{ itemId: poItem, received: 120 }], continueWithoutRest: true },
    });
    expect(res.error).toBeNull();
    route4 = await ops(A.id);
    expect(route4.map((o) => o.status)).toEqual(["hotovo", "hotovo", "preskoceno", "preskoceno"]);
    expect(route4[2]).toMatchObject({ purchase_order_id: null });                // sdílená PO2: jen odpojit
    expect(String(route4[2].note)).toContain("Přeskočeno: zákazník chce díly hned");
    const after = await pos(A.id);
    expect(after.find((p) => p.id === po2.id)).toMatchObject({ status: "vystavena" });   // částečně převzatá zůstává otevřená
    expect(after.find((p) => p.supplier_id === novak && p.id !== aPo1)).toMatchObject({ status: "zrusena", cancel_reason: "Výroba ukončena dřív — krok přeskočen" });
    expect(localSql(`select received_quantity from purchase_order_items where id = '${poItem}'`)).toBe("120.000");
    const j = await job(A.id);
    expect(j.status).toBe("dodano_k_nam");
    expect(j.production_finished_at).not.toBeNull();
    expect(j.production_finished_by).toBe(sales);
    const ev = await events(A.id);
    expect(ev.some((e) => String(e.message).startsWith(`Převzato od ${SUP_PREFIX} TepKal s.r.o.: PR-7075-20 120/240 kg (objednávka ${po2.number})`))).toBe(true);
    expect(ev.find((e) => (e.data as Row)?.production === "ukonceni")?.message).toBe("Výroba ukončena — 2 kroky hotové; přeskočeno 2; dodáno k nám");
  });

  it("zápis výroby zpětně: hotový krok a rovnou cílový stav (bez mezikroku Ve výrobě)", async () => {
    const Z = await newJob();
    const res = await apply(app, Z.id, "zaznam", {
      stageTo: "dodano_k_nam",
      steps: [step({ supplierId: novak, plannedEnd: "2026-10-20", done: true, poMode: "neobjednavat", poNoneReason: "Zapsáno zpětně", whoSource: "rucne", deadlineSource: "rucne" })],
    });
    expect(res.error).toBeNull();
    expect((await ops(Z.id))[0]).toMatchObject({ status: "hotovo", po_mode: "neobjednavat", supplier_id: novak });
    const stages = (await events(Z.id)).filter((e) => e.type === "stage").map((e) => [(e.data as Row).from, (e.data as Row).to]);
    expect(stages).toEqual([["potvrzeno", "dodano_k_nam"]]);
  });

  it("job_cost: objednávka s položkou bez ceny = náklad neznámý → provize „čeká na nákupní cenu“; doplnění ceny přepočítá samo", async () => {
    const K = await newJob();
    expect((await apply(app, K.id, "predani", handoffPayload(K.items, null, [40, null]))).error).toBeNull();
    const [po] = await pos(K.id);
    expect(localSql(`select known from job_cost('${K.id}')`)).toBe("f");
    const { data: ce } = await svc.from("commission_entries").select("*").eq("order_id", K.id).single();
    expect(ce).toMatchObject({ cost_known: false, cost_pending_po: [po.number], commission: 0, profit: 0 });
    const period = String((ce as Row).period);
    expect(Number(localSql(`select unknown_cost_jobs from commission_statements where owner_id = '${sales}' and period = '${period}'`))).toBeGreaterThanOrEqual(1);
    // čistá logika panelu marže (purchasingTotals) dává totéž jako DB job_cost
    const totalsOf = async () => {
      const { data: rows } = await svc.from("purchase_orders").select(PURCHASE_ORDER_SELECT).eq("job_id", K.id);
      return purchasingTotals({ revenue: 50_000, plannedCost: null, purchaseOrders: ((rows ?? []) as unknown as PurchaseOrderDbRow[]).map(rowToPurchaseOrderView) });
    };
    expect(await totalsOf()).toMatchObject({ cost: null, costSource: "neuplna", profit: null, unpricedItems: 1, unpricedPurchaseOrders: [po.number] });
    expect(rowToCommissionView(ce as never, "Obchodník").pendingPurchaseOrders).toEqual([po.number]);

    // doplnění ceny (jako updatePurchaseOrder: položky + součet) → přepočet bez dalšího zásahu
    const unpriced = (po.items as Row[]).find((i) => i.unit_price === null) as Row;
    expect((await app.from("purchase_order_items").update({ unit_price: 42 }).eq("id", unpriced.id)).error).toBeNull();
    expect((await svc.from("commission_entries").select("cost_known, cost_pending_po").eq("order_id", K.id).single()).data)
      .toMatchObject({ cost_known: true, cost_pending_po: null });
    expect((await app.from("purchase_orders").update({ total: 12_200 }).eq("id", po.id)).error).toBeNull();
    expect(localSql(`select known, cost from job_cost('${K.id}')`)).toBe("t|12200.00");
    const { data: ce2 } = await svc.from("commission_entries").select("*").eq("order_id", K.id).single();
    expect(ce2).toMatchObject({ cost_known: true, cost_pending_po: null });
    expect(Number((ce2 as Row).cost)).toBe(12_200);
    expect(Number((ce2 as Row).profit)).toBe(37_800);
    expect(await totalsOf()).toMatchObject({ cost: 12_200, costSource: "objednavky", profit: 37_800 });
  });

  it("souhrn výroby na zakázce přes REST nepřepíšeš; přepočet ho dál drží", async () => {
    const s = await localSession(DEMO.sales.email, DEMO.sales.password);
    const before = await job(A.id);
    await s.from("orders").update({ production_step_no: 99, production_due: "2030-01-01", note: "REST" }).eq("id", A.id);
    const after = await job(A.id);
    expect(after).toMatchObject({ production_step_no: before.production_step_no, production_due: before.production_due, note: "REST" });
    const L = await newJob();
    expect((await apply(app, L.id, "predani", handoffPayload(L.items, null))).error).toBeNull();
    const [o1] = await ops(L.id);
    expect((await app.from("job_operations").update({ planned_end: "2026-11-12" }).eq("id", o1.id)).error).toBeNull();
    expect(await job(L.id)).toMatchObject({ production_due: "2026-11-12" });
  });

  // ── nálezy review WP1 ──
  it("objednávky A,B,A a existující objednávka u A → žádné falešné „už má objednávku“; objednávka bez čísla se počítá", async () => {
    const Q = await newJob();
    const aba = await apply(app, Q.id, "predani", {
      purchaseOrders: [poOf("a1", novak, Q.items, [40, 42]), poOf("b", tepkal, Q.items, [1, 1], { requiredDate: "2026-11-16" }),
        poOf("a2", novak, Q.items, [2, 2], { requiredDate: "2026-11-18" })],
      steps: [
        step({ supplierId: novak, poGroup: "a1", start: true }),
        step({ index: 2, kind: "tepelne_zpracovani", supplierId: tepkal, poGroup: "b", plannedEnd: "2026-11-16" }),
        step({ index: 3, kind: "brouseni", supplierId: novak, poGroup: "a2", plannedEnd: "2026-11-18" }),
      ],
    });
    expect(aba.error).toBeNull();
    const qOps = await ops(Q.id);
    const supplierOfPo = new Map((await pos(Q.id)).map((p) => [p.id, p.supplier_id]));
    expect(supplierOfPo.size).toBe(3);
    expect(qOps.map((o) => supplierOfPo.get(o.purchase_order_id))).toEqual([novak, tepkal, novak]);   // každý krok svou objednávku

    // existující volná objednávka u A použitá krokem 1, krok 3 u A s novou objednávkou
    const R = await newJob();
    const ex = await svc.from("purchase_orders").insert({ job_id: R.id, supplier_id: novak, number: `OV-E2E-${STAMP}-R`, status: "vystavena", total: 0 }).select("id").single();
    expect(ex.error).toBeNull();
    const reuse = await apply(app, R.id, "predani", {
      purchaseOrders: [poOf("a2", novak, R.items, [2, 2], { requiredDate: "2026-11-18" })],
      steps: [
        step({ supplierId: novak, poMode: "existujici", existingPurchaseOrderId: String((ex.data as Row).id), start: true }),
        step({ index: 2, kind: "tepelne_zpracovani", supplierId: tepkal, poMode: "pri_predani", plannedEnd: "2026-11-16" }),
        step({ index: 3, kind: "brouseni", supplierId: novak, poGroup: "a2", plannedEnd: "2026-11-18" }),
      ],
    });
    expect(reuse.error).toBeNull();
    expect((await ops(R.id)).map((o) => o.purchase_order_id === (ex.data as Row).id)).toEqual([true, false, false]);

    // volná objednávka bez čísla u TepKal → druhá se nevystaví
    const S = await newJob();
    expect((await svc.from("purchase_orders").insert({ job_id: S.id, supplier_id: tepkal, status: "vystavena", total: 0 })).error).toBeNull();
    const dup = await apply(app, S.id, "plan", { purchaseOrders: [poOf("g", tepkal, S.items, [1, 1])], steps: [step({ supplierId: tepkal, poGroup: "g" })] });
    expect(dup.error?.message).toBe(`${SUP_PREFIX} TepKal s.r.o. už má k zakázce objednávku (bez čísla) — použij ji, nebo ji nejdřív zruš.`);
  });

  it("payload: dvě objednávky jedné skupiny, objednávka bez kroku a nabídka cizí zakázky u kroku → odmítnuto, nic nezapsáno", async () => {
    const T = await newJob();
    const counter = localSql("select counter from doc_counters where doc_type = 'OV'");
    const twice = await apply(app, T.id, "plan", {
      purchaseOrders: [poOf("g", novak, T.items, [1, 1]), poOf("g", tepkal, T.items, [1, 1])], steps: [step({ supplierId: novak, poGroup: "g" })],
    });
    expect(twice.error?.message).toBe("Dvě objednávky pro stejnou skupinu kroků.");
    const orphan = await apply(app, T.id, "plan", { purchaseOrders: [poOf("g", novak, T.items, [1, 1])], steps: [step({ supplierId: novak, poMode: "pri_predani" })] });
    expect(orphan.error?.message).toMatch(/^Objednávka OV-\d{4}-\d+ nepatří k žádnému kroku\.$/);
    const foreignQuote = await newQuote(A.id, novak, [1, 1]);
    const fq = await apply(app, T.id, "plan", { steps: [step({ supplierId: novak, poMode: "pri_predani", supplierQuoteId: foreignQuote })] });
    expect(fq.error?.message).toBe("Nabídka dodavatele nepatří k této zakázce.");
    expect(await pos(T.id)).toEqual([]);
    expect(await ops(T.id)).toEqual([]);
    expect(localSql("select counter from doc_counters where doc_type = 'OV'")).toBe(counter);
  });

  it("jen obchodník / admin: potvrdit nový termín zákazníkovi přes RPC zaměstnanec nesmí (FORBIDDEN)", async () => {
    const worker = localAdmin(userActor({ id: await profileId(svc, DEMO.worker.email) }));
    const W = await newJob();
    const res = await apply(worker, W.id, "plan", { finalDate: { date: "2027-01-31", confirmed: true }, steps: [] });
    expect(res.error).toMatchObject({ code: "42501", hint: "FORBIDDEN" });
    expect((await job(W.id)).due_date).toBe("2026-11-20");
    // stejný (už potvrzený) termín = žádná změna → smí
    expect((await apply(worker, W.id, "plan", { finalDate: { date: "2026-11-20", confirmed: true }, steps: [] })).error).toBeNull();
  });

  it("„uvnitř předání“ platí jen po dobu volání RPC; události předání jdou v pořadí vzniku", async () => {
    const U = await newJob();
    const out = localSql(`
      begin;
      select (production_apply('${U.id}', gen_random_uuid(), 'plan', 'potvrzeno', production_route_version('${U.id}'),
        '{"steps":[{"index":1,"kind":"vyroba","inHouse":true,"plannedEnd":"2026-11-13"}]}'::jsonb)->>'kind');
      select 'x' || coalesce(current_setting('app.production_handoff', true), '');
      rollback;`);
    expect(out.split("\n")).toEqual(["plan", "x"]);

    const { data } = await apply(app, U.id, "predani", handoffPayload(U.items, null));
    const hid = (data as ProductionApplyResult).handoffId;
    const ev = (await events(U.id)).filter((e) => (e.data as Row)?.handoffId === hid);
    expect(ev.length).toBeGreaterThanOrEqual(3);
    expect(new Set(ev.map((e) => e.created_at)).size).toBe(ev.length);
    expect((ev[ev.length - 1].data as Row).production).toBe("predani");     // souhrn je poslední
  });

  it("vrácení předání po doplnění kroku: krok z předání čeká, objednávka zrušená a odpojená, zakázka zpět", async () => {
    const V = await newJob();
    const first = await apply(app, V.id, "predani", handoffPayload(V.items, null));
    expect(first.error).toBeNull();
    const h1 = (first.data as ProductionApplyResult).handoffId;
    const [s1] = await ops(V.id);
    const dopl = await apply(app, V.id, "doplneni", { steps: [step({ operationId: String(s1.id), supplierId: novak, plannedEnd: "2026-11-16", poMode: "vystavit" })] });
    expect(dopl.error).toBeNull();
    expect((await ops(V.id))[0].handoff_id).not.toBe(h1);
    const undo = await apply(app, V.id, "zpet", { undoHandoffId: h1 });
    expect(undo.error).toBeNull();
    expect((await ops(V.id)).map((o) => [o.status, o.purchase_order_id])).toEqual([["ceka", null], ["ceka", null]]);
    expect((await pos(V.id))[0]).toMatchObject({ status: "zrusena" });
    expect(await job(V.id)).toMatchObject({ status: "potvrzeno", production_started_at: null });
    expect((await events(V.id)).some((e) => e.message === "Výroba: Výroba 1 → Čeká (předání vráceno)")).toBe(true);
  });

  it("zápis výroby zpětně: naplánovaný krok označený hotový se uzavře; neoznačený otevřený krok = chyba", async () => {
    const Z = await newJob();
    const plan = await apply(app, Z.id, "plan", { steps: [
      step({ inHouse: true, poMode: null, deadlineState: null }),
      step({ index: 2, kind: "kontrola", inHouse: true, poMode: null, deadlineState: null, plannedEnd: "2026-11-16" }),
    ] });
    expect(plan.error).toBeNull();
    const [p1, p2] = await ops(Z.id);
    const done = (o: Row, end: string) => step({ operationId: String(o.id), inHouse: true, poMode: null, plannedEnd: end, done: true, kind: String(o.kind) as ApplyStep["kind"] });
    const partial = await apply(app, Z.id, "zaznam", { stageTo: "dodano_k_nam", steps: [done(p1, "2026-10-20")] });
    expect(partial.error?.message).toBe("Krok „Kontrola / měření“ je ještě otevřený — v zápisu výroby ho označ jako hotový (nebo ho nejdřív přeskoč).");
    expect((await job(Z.id)).status).toBe("potvrzeno");
    const ok = await apply(app, Z.id, "zaznam", { stageTo: "dodano_k_nam", steps: [done(p1, "2026-10-20"), done(p2, "2026-10-21")] });
    expect(ok.error).toBeNull();
    expect((await ops(Z.id)).map((o) => o.status)).toEqual(["hotovo", "hotovo"]);
    expect(await job(Z.id)).toMatchObject({ status: "dodano_k_nam", production_done: 2, production_total: 2 });
    expect((await events(Z.id)).filter((e) => e.type === "stage").map((e) => [(e.data as Row).from, (e.data as Row).to])).toEqual([["potvrzeno", "dodano_k_nam"]]);
  });

  it("stav termínu i mimo předání: odhad / plán dílny, odeslaná objednávka = požadováno, změna firmy = zpět odhad", async () => {
    const X = await newJob();
    const po = await svc.from("purchase_orders").insert({ job_id: X.id, supplier_id: novak, number: `OV-E2E-${STAMP}-X`, status: "vystavena", total: 0, required_date: "2026-11-13" }).select("id").single();
    const poId = String((po.data as Row).id);
    const ins = await app.from("job_operations").insert([
      { job_id: X.id, position: 0, kind: "frezovani", in_house: false, supplier_id: novak, planned_end: "2026-11-13", purchase_order_id: poId },
      { job_id: X.id, position: 1, kind: "kontrola", in_house: true, supplier_id: null, planned_end: "2026-11-16", purchase_order_id: null },
    ]);
    expect(ins.error).toBeNull();
    expect((await ops(X.id)).map((o) => o.deadline_state)).toEqual(["odhad", "plan"]);
    expect((await app.from("purchase_orders").update({ status: "odeslana" }).eq("id", poId)).error).toBeNull();
    const [o1] = await ops(X.id);
    expect(o1.deadline_state).toBe("pozadovano");
    expect((await app.from("job_operations").update({ supplier_id: tepkal }).eq("id", o1.id)).error).toBeNull();
    expect((await ops(X.id))[0].deadline_state).toBe("odhad");
    // „Potvrzena" v Nákupu (potvrzený = požadovaný termín) termín kroku nehýbe, jen stav
    expect((await app.from("job_operations").update({ supplier_id: novak, planned_end: "2026-11-11" }).eq("id", o1.id)).error).toBeNull();
    expect((await app.from("purchase_orders").update({ status: "potvrzena", confirmed_date: "2026-11-13" }).eq("id", poId)).error).toBeNull();
    expect((await ops(X.id))[0]).toMatchObject({ planned_end: "2026-11-11", deadline_state: "potvrzeno" });
    expect((await events(X.id)).some((e) => String(e.message).includes("(potvrdil dodavatel"))).toBe(false);
  });

  it("zrušená objednávka kroku = krok objednávku nemá (připravenost plánu)", async () => {
    const Y = await newJob();
    expect((await apply(app, Y.id, "plan", { purchaseOrders: [poOf("g", novak, Y.items, [40, 42])], steps: [step({ supplierId: novak, poGroup: "g" })] })).error).toBeNull();
    expect(localSql(`select production_plan_ready('${Y.id}')`)).toBe("t");
    const [po] = await pos(Y.id);
    expect((await app.from("purchase_orders").update({ status: "zrusena", cancel_reason: "test" }).eq("id", po.id)).error).toBeNull();
    expect(localSql(`select production_plan_ready('${Y.id}')`)).toBe("f");
  });

  it("provize čekající na nákupní cenu: výplata měsíce ji nezamkne; cena doplněná u odeslané objednávky → provize v aktuálním měsíci", async () => {
    const P = await newJob({ order_date: "2026-09-10" });
    expect((await apply(app, P.id, "predani", handoffPayload(P.items, null, [40, null]))).error).toBeNull();
    const [po] = await pos(P.id);
    expect((await app.from("purchase_orders").update({ status: "odeslana" }).eq("id", po.id)).error).toBeNull();
    const entry = () => `select concat_ws('|', status, cost_known, period, cost_pending_po is null, commission > 0) from commission_entries where order_id = '${P.id}'`;
    // vše v transakci, která se vrátí (sdílená DB: výplata obchodníka za září se nesmí zapsat)
    const out = localSql(`
      begin;
      update commission_statements set status = 'vyplaceno', paid_at = current_date where owner_id = '${sales}' and period = '2026-09-01';
      update commission_entries set status = 'vyplaceno' where owner_id = '${sales}' and period = '2026-09-01';
      ${entry()};
      update purchase_order_items set unit_price = 42 where purchase_order_id = '${po.id}' and unit_price is null;
      update purchase_orders set total = 12200 where id = '${po.id}';
      ${entry()};
      select status from commission_statements where owner_id = '${sales}' and period = '2026-09-01';
      rollback;`);
    const [paid, filled, stmt] = out.split("\n");
    expect(paid).toBe("predbezna|f|2026-09-01|f|f");                       // nezamčená, ne „K výplatě", čeká
    const month = localSql("select date_trunc('month', app_today())::date");
    expect(filled).toBe(`predbezna|t|${month}|t|t`);                       // dopočítaná, v aktuálním měsíci
    expect(stmt).toBe("vyplaceno");                                         // vyplacené září se nemění
  });

  it("dopočet starých dat spuštěný dvakrát: stejný výsledek, žádné události, updated_at ani stav se nemění", async () => {
    // „stará" zakázka ve výrobě: krok bez termínu (běží), krok u dodavatele s odeslanou objednávkou, poslední krok u nás na potvrzený termín
    const M = await newJob({ status: "ve_vyrobe" });
    const N = await newJob({ status: "ve_vyrobe", due_date: "2026-11-30", customer_required_date: "2026-11-20" });
    const legacyPo = `OV-E2E-${STAMP}-L`;
    localSql(`
      begin;
      set local session_replication_role = replica;
      insert into purchase_orders (job_id, supplier_id, number, status, total) values ('${M.id}', '${tepkal}', '${legacyPo}', 'odeslana', 100);
      insert into job_operations (job_id, position, kind, status, supplier_id, planned_end) values ('${M.id}', 0, 'soustruzeni', 'probiha', '${novak}', null);
      insert into job_operations (job_id, position, kind, status, supplier_id, planned_end, purchase_order_id)
        select '${M.id}', 1, 'tepelne_zpracovani', 'ceka', '${tepkal}', '2026-11-18', id from purchase_orders where number = '${legacyPo}';
      insert into job_operations (job_id, position, kind, status, in_house, planned_end) values ('${M.id}', 2, 'kontrola', 'ceka', true, '2026-11-20');
      insert into job_operations (job_id, position, kind, status, in_house, planned_end) values ('${N.id}', 0, 'frezovani', 'probiha', true, '2026-11-20');
      update orders set production_step = null, production_step_no = null where id in ('${M.id}', '${N.id}');
      commit;`);
    const snap = () => localSql(`
      select string_agg(concat_ws('|', o.kind, o.status, o.deadline_state, o.deadline_source, o.deadline_changed_at, o.deadline_changed_by,
                                  o.deadline_changed_via, o.who_source, o.who_changed_by, o.po_mode, o.ends_at_customer_date, o.updated_at), ';' order by o.job_id, o.position)
      from job_operations o where o.job_id in ('${M.id}', '${N.id}')`);
    const jobSnap = () => localSql(`
      select string_agg(concat_ws('|', status, updated_at, stage_changed_at, production_step_no, production_step_kind_no, production_due,
                                  production_due_final, production_due_state, production_po_status, production_end, production_final_end), ';' order by number)
      from orders where id in ('${M.id}', '${N.id}')`);
    const evCount = () => localSql(`select count(*) from job_events where job_id in ('${M.id}', '${N.id}')`);
    const updatedBefore = localSql(`select string_agg(updated_at::text, ',' order by position) from job_operations where job_id = '${M.id}'`);
    const ordersBefore = localSql(`select string_agg(concat_ws('|', status, updated_at), ';' order by number) from orders where id in ('${M.id}', '${N.id}')`);
    const ev0 = evCount();

    // dopočet z migrace (funkce) — ne celá migrace: ta by na sdílené DB přepsala pozdější verze funkcí (WP4)
    const runBackfill = () => localSql("select production_handoff_backfill()");
    runBackfill();
    const s1 = snap();
    const j1 = jobSnap();
    runBackfill();
    expect(snap()).toBe(s1);
    expect(jobSnap()).toBe(j1);
    expect(evCount()).toBe(ev0);
    expect(localSql(`select string_agg(updated_at::text, ',' order by position) from job_operations where job_id = '${M.id}'`)).toBe(updatedBefore);
    expect(localSql(`select string_agg(concat_ws('|', status, updated_at), ';' order by number) from orders where id in ('${M.id}', '${N.id}')`)).toBe(ordersBefore);

    const m = await ops(M.id);
    expect(m.map((o) => [o.deadline_state, o.deadline_source, o.who_source, o.po_mode, o.ends_at_customer_date, o.deadline_changed_by, o.who_changed_by])).toEqual([
      [null, null, "import", null, false, null, null],                       // bez termínu: stav termínu nevzniká
      ["pozadovano", "import", "import", "existujici", false, null, null],   // odeslaná objednávka = požadováno
      ["plan", "import", "import", null, true, null, null],                 // poslední na potvrzený termín = konečný
    ]);
    expect(m.map((o) => o.deadline_changed_via)).toEqual([null, "import", "import"]);
    expect((await ops(N.id))[0]).toMatchObject({ ends_at_customer_date: false, deadline_state: "plan" });   // jen požadavek zákazníka ≠ konečný
    expect(await job(M.id)).toMatchObject({
      status: "ve_vyrobe", production_step_no: 1, production_step_kind_no: 1, production_due: null, production_po_status: null,
      production_end: "2026-11-20", production_final_end: "2026-11-20",
    });
    expect((await job(N.id))).toMatchObject({ production_step_no: 1, production_due: "2026-11-20", production_due_state: "plan", production_final_end: null });
  }, 120_000);
});
