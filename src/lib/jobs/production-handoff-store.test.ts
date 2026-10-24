import { describe, it, expect } from "vitest";
import {
  buildHandoffPlan, checkHandoffInputShape, deriveHandoffKind, marginsOnlyViolation, noteWithoutMaterial, stepInputFromOperation,
  type HandoffContext,
} from "./production-handoff-store";
import { purchasePriceOnlyChanges } from "./purchase-order-docs";
import type { HandoffInput } from "./production-handoff-types";
import type { JobOperation } from "./production-types";

/**
 * Předání do výroby — čisté části serverového jádra (bez DB): předvyplněný plán (nejlevnější nabídka
 * primárně i proti vítězi z Nákupu, postup z výkresu, objednávka teď / až při předání, existující objednávka
 * se použije), ceny jen s právem „margins", druh předání z faktů, tvar vstupu z prohlížeče, práva k příznakům,
 * poznámka položky bez materiálu, „jen cena" u odeslané objednávky.
 */

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const I1 = U(1);
const I2 = U(2);
const NOVAK = U(11);
const HRUBY = U(12);
const TEPKAL = U(13);

function ctx(over: Partial<HandoffContext> = {}): HandoffContext {
  const suppliers = new Map([
    [NOVAK, { id: NOVAK, name: "Frézy Novák s.r.o.", email: "novak@example.cz", address: "Dlouhá 1, 530 02 Pardubice", technologies: ["frezovani_3osy"], leadDays: 10, rating: 4, ico: null }],
    [HRUBY, { id: HRUBY, name: "Kovoobrábění Hrubý s.r.o.", email: "hruby@example.cz", address: null, technologies: ["soustruzeni"], leadDays: 7, rating: 5, ico: null }],
    [TEPKAL, { id: TEPKAL, name: "TepKal s.r.o.", email: "tepkal@example.cz", address: null, technologies: ["tepelne_zpracovani"], leadDays: 5, rating: 3, ico: null }],
  ]);
  const base = (id: string, supplierId: string, name: string, note: string, prices: [number | null, number | null], extra: Record<string, unknown> = {}) => ({
    id, supplierId, supplierName: name, number: `NAB-${id.slice(-2)}`, quoteDate: "2026-10-20", validUntil: null, leadTimeDays: 21, deliveryDate: null,
    currency: "CZK", total: null, selected: false, note, operationKinds: null,
    items: [
      { drawingNumber: "PR-20", name: "Příruba", quantity: 200, unit: "ks", unitPrice: prices[0], note: null },
      { drawingNumber: "PR-21", name: "Pouzdro", quantity: 100, unit: "ks", unitPrice: prices[1], note: null },
    ],
    supplierTechnologies: suppliers.get(supplierId)?.technologies ?? null, supplierRating: null, supplierLeadDays: null,
    supplierEmail: suppliers.get(supplierId)?.email ?? null, ...extra,
  });
  return {
    job: {
      id: U(100), number: "Z-2026-120", title: "Příruby", status: "potvrzeno", currency: "CZK", dueDate: "2026-12-18",
      customerRequiredDate: null, maxToleratedDate: null, ownerId: U(200), customerName: "Zákazník a.s.",
    },
    items: [
      { id: I1, drawingNumber: "PR-20", name: "Příruba", quantity: 200, unit: "ks", weightKg: 1.2, heatTreatment: "kalit 58–60 HRC", materialDesignation: "1.2379", material: "1.2379" },
      { id: I2, drawingNumber: "PR-21", name: "Pouzdro", quantity: 100, unit: "ks", material: "11 523" },
    ],
    ops: [],
    quotes: [
      base(U(21), NOVAK, "Frézy Novák s.r.o.", "frézování", [40, 42]),                                      // 12 200
      base(U(22), HRUBY, "Kovoobrábění Hrubý s.r.o.", "soustružení", [50, 50], { selected: true }),         // 15 000, vítěz Nákupu
      { ...base(U(23), TEPKAL, "TepKal s.r.o.", "kalení", [5, null]), items: [{ drawingNumber: "PR-20", name: "Příruba kalení", quantity: 200, unit: "ks", unitPrice: 5, note: null }] },
    ],
    purchaseOrders: [],
    suppliers,
    history: { drawings: [], operations: [], suppliers: [] },
    routeVersion: "rv-1",
    pendingCapturedQuotes: 0,
    lastPredani: null,
    today: "2026-10-24",
    ...over,
  };
}

const opts = { margins: true, mailAll: false, actorId: U(200), automationMode: "approval" as const, senderEmail: "obchod@example.cz" };

describe("buildHandoffPlan", () => {
  it("předání: výroba u nejlevnější (ne u vítěze Nákupu), kalení jen pro díl s kalením, objednávka teď jen u startu", () => {
    const p = buildHandoffPlan(ctx(), opts);
    expect(p).toMatchObject({ kind: "predani", stage: "potvrzeno", routeVersion: "rv-1", routeSource: "nabidky" });
    expect(p.steps.map((s) => s.kind)).toEqual(["vyroba", "tepelne_zpracovani"]);
    const [s1, s2] = p.steps;
    expect(s1).toMatchObject({ who: { type: "supplier", id: NOVAK }, whoSource: "nejlevnejsi_nabidka", supplierQuoteId: U(21), start: true, po: { mode: "vystavit" } });
    expect(s1.suggestions.primary).toMatchObject({ price: 12_200, reason: "Nejlevnější nabídka" });
    expect(s1.suggestions.alternatives[0]).toMatchObject({ supplierQuoteId: U(22), source: "nabidka" });
    expect(s1.poPreview).toMatchObject({ supplierName: "Frézy Novák s.r.o.", itemCount: 2, unpriced: 0, total: 12_200, blockers: [] });
    expect(s1.label).toBe("Výroba 1");                                                  // postup má víc kroků
    expect(s1.performerRole).toBe("částečný dodavatel");
    expect(s1.deadlineState).toBe("odhad");
    expect(s1.plannedEnd! >= "2026-11-14").toBe(true);
    expect(s2).toMatchObject({ who: { type: "supplier", id: TEPKAL }, orderItemIds: [I1], po: { mode: "pri_predani" } });
    expect(s2.start).toBeUndefined();
    expect(s2.poPreview).toBeNull();
    expect(s2.plannedEnd! > s1.plannedEnd!).toBe(true);
    expect(p.routes.find((r) => r.selected)).toMatchObject({ complete: true, total: 13_200 });
    expect(p.automation).toMatchObject({ mode: "approval", sendDefault: false, senderEmail: "obchod@example.cz" });
    expect(p.issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("bez práva na marže: žádná částka (návrhy, náhled objednávky, postupy), pořadí a firmy stejné", () => {
    const p = buildHandoffPlan(ctx(), { ...opts, margins: false });
    expect(p.permissions).toEqual({ canSeePrices: false, canConfirmCustomerDate: false, canReceive: false, canSend: false, canCancelSent: false });
    expect(p.steps[0].who).toMatchObject({ id: NOVAK });
    expect(p.steps[0].suggestions.primary).toMatchObject({ price: null, diffToBest: null, reason: "Doporučeno podle nabídek" });
    expect(p.steps[0].poPreview?.total).toBeNull();
    expect(p.routes.every((r) => r.total === null)).toBe(true);
    const json = JSON.stringify(p);
    expect(json).not.toMatch(/12\s?200|13\s?200|Kč/);
    expect(p.automation.reason).toMatch(/obchodník nebo admin/);
  });

  it("vystavená objednávka téže firmy z Nákupu se použije (žádná druhá) — i předaná z dialogu vystavení", () => {
    const po = {
      id: U(31), number: "OV-2026-012", status: "vystavena" as const, supplierId: NOVAK, supplierName: "Frézy Novák s.r.o.", supplierEmail: null,
      supplierQuoteId: U(21), requiredDate: "2026-11-20", confirmedDate: null, handoffId: null, fileId: null, revision: 1, linked: false, items: [],
    };
    const p = buildHandoffPlan(ctx({ purchaseOrders: [po] }), opts);
    expect(p.steps[0]).toMatchObject({ who: { id: NOVAK }, whoSource: "objednavka", po: { mode: "existujici", existingId: U(31) } });
    expect(p.steps[0].poPreview?.existing).toMatchObject({ number: "OV-2026-012" });
    expect(p.openPurchaseOrders).toEqual([{ id: U(31), number: "OV-2026-012", supplierName: "Frézy Novák s.r.o.", status: "vystavena" }]);
    const p2 = buildHandoffPlan(ctx({ purchaseOrders: [{ ...po, supplierId: HRUBY, supplierName: "Kovoobrábění Hrubý s.r.o." }] }), { ...opts, existingPurchaseOrderId: U(31) });
    expect(p2.steps[0]).toMatchObject({ who: { id: HRUBY }, whoSource: "objednavka", po: { mode: "existujici", existingId: U(31) } });
  });

  it("připravený postup (čekající kroky) má přednost; ve výrobě s běžícím krokem = další krok", () => {
    const op = (id: string, kind: JobOperation["kind"], status: JobOperation["status"], position: number, extra: Partial<JobOperation> = {}): JobOperation => ({
      id, jobId: U(100), position, kind, title: null, label: kind, supplier: null, supplierName: null, inHouse: false, location: "—",
      status, plannedStart: null, plannedEnd: null, startedAt: null, finishedAt: null, note: null, purchaseOrderId: null, purchaseOrderNumber: null,
      createdBy: null, createdAt: `2026-10-2${position}T10:00:00Z`, updatedAt: "2026-10-22T10:00:00Z", overdue: false, ...extra,
    });
    const planned = [op(U(41), "vyroba", "ceka", 0, { inHouse: true, location: "U nás", plannedEnd: "2026-11-06" }), op(U(42), "tepelne_zpracovani", "ceka", 1)];
    const p = buildHandoffPlan(ctx({ ops: planned }), opts);
    expect(p.routeSource).toBe("planovane");
    expect(p.steps.map((s) => s.operationId)).toEqual([U(41), U(42)]);
    expect(p.steps[0]).toMatchObject({ who: { type: "u_nas" }, plannedEnd: "2026-11-06", po: { mode: null }, start: true, deadlineState: "plan", label: "Výroba 1" });
    expect(p.steps[1].who).toMatchObject({ type: "supplier", id: TEPKAL });                       // AI předvyplní kalírnu z nabídky

    const running = [op(U(41), "vyroba", "probiha", 0, { inHouse: true, location: "U nás", plannedEnd: "2026-11-06" }), op(U(42), "tepelne_zpracovani", "ceka", 1)];
    const d = buildHandoffPlan(ctx({ ops: running, job: { ...ctx().job, status: "ve_vyrobe" } }), opts);
    expect(d.kind).toBe("dalsi_krok");
    expect(d.current).toMatchObject({ id: U(41), status: "probiha" });
    expect(d.steps).toHaveLength(1);
    expect(d.steps[0]).toMatchObject({ operationId: U(42), start: true, po: { mode: "vystavit" } });
  });

  it("zápis výroby zpětně: hotový krok dnes, bez objednávky („Zapsáno zpětně“)", () => {
    const p = buildHandoffPlan(ctx(), { ...opts, kind: "zaznam", target: "dodano_k_nam" });
    expect(p.target).toBe("dodano_k_nam");
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0]).toMatchObject({ done: true, plannedEnd: "2026-10-24", po: { mode: "neobjednavat", noneReason: "Zapsáno zpětně" } });
  });
});

describe("pomocníci jádra", () => {
  it("druh předání z faktů", () => {
    expect(deriveHandoffKind("nabidka", [])).toMatchObject({ code: "NO_CUSTOMER_ORDER" });
    expect(deriveHandoffKind("dokonceno", [])).toMatchObject({ code: "STAGE_CHANGED" });
    expect(deriveHandoffKind("objednavka", [])).toEqual({ kind: "predani" });
    expect(deriveHandoffKind("pozastaveno", [])).toEqual({ kind: "predani" });
    expect(deriveHandoffKind("dodano_k_nam", [])).toEqual({ kind: "predani" });
    expect(deriveHandoffKind("ve_vyrobe", [{ status: "probiha", inHouse: false, supplier: null, supplierName: null, plannedEnd: "2026-11-01" }])).toEqual({ kind: "doplneni" });
    expect(deriveHandoffKind("ve_vyrobe", [{ status: "ceka", inHouse: false, supplier: { id: NOVAK, name: "N" }, supplierName: null, plannedEnd: "2026-11-01" }])).toEqual({ kind: "dalsi_krok" });
  });

  it("tvar vstupu z prohlížeče", () => {
    const ok: HandoffInput = {
      token: U(90), kind: "predani", expectedStage: "potvrzeno", expectedRouteVersion: "rv",
      steps: [{ kind: "vyroba", who: { type: "supplier", id: NOVAK }, plannedEnd: "2026-11-20", endsAtCustomerDate: false, deadlineAgreed: false, po: { mode: "vystavit" } }],
    };
    expect(checkHandoffInputShape(ok)).toBeNull();
    expect(checkHandoffInputShape({ ...ok, token: "x" })).toMatch(/identifikátor/);
    expect(checkHandoffInputShape({ ...ok, kind: "nevim" as never })).toMatch(/Neznámý druh/);
    expect(checkHandoffInputShape({ ...ok, steps: Array.from({ length: 13 }, () => ok.steps[0]) })).toMatch(/nejvýš 12/);
    expect(checkHandoffInputShape({ ...ok, steps: [{ ...ok.steps[0], who: { type: "supplier", id: "zlo" } }] })).toMatch(/neplatný dodavatel/);
    expect(checkHandoffInputShape({ ...ok, steps: [{ ...ok.steps[0], po: { mode: "vystavit", quantities: { [I1]: -1 } } }] })).toMatch(/neplatné množství/);
    expect(checkHandoffInputShape({ ...ok, complete: { operationId: U(1), receipts: [{ itemId: U(2), received: -5 }] } })).toMatch(/převzaté/);
    expect(checkHandoffInputShape({ ...ok, finalDate: { date: "20. 11.", confirmed: true } })).toMatch(/konečný termín/);
    expect(checkHandoffInputShape({ ...ok, note: "x".repeat(501) })).toMatch(/max\. 500/);
  });

  it("příznaky jen pro obchodníka / admina", () => {
    const job = { job: { dueDate: "2026-12-18" } } as Pick<HandoffContext, "job">;
    const base = { token: U(90), kind: "predani", expectedStage: "potvrzeno", expectedRouteVersion: "rv", steps: [] } as HandoffInput;
    expect(marginsOnlyViolation(base, job)).toBeNull();
    expect(marginsOnlyViolation({ ...base, finalDate: { date: "2026-12-18", confirmed: true } }, job)).toBeNull(); // potvrzení beze změny
    expect(marginsOnlyViolation({ ...base, finalDate: { date: "2026-12-20", confirmed: true } }, job)).toMatch(/Potvrzený termín/);
    expect(marginsOnlyViolation({ ...base, updateCustomerDate: true }, job)).toMatch(/Konečný termín/);
    expect(marginsOnlyViolation({ ...base, complete: { operationId: U(1), receipts: [{ itemId: U(2), received: 1 }] } }, job)).toMatch(/Převzetí/);
    expect(marginsOnlyViolation({ ...base, sendNow: ["po:s1"] }, job)).toMatch(/odešle/);
    expect(marginsOnlyViolation({ ...base, finish: { target: "dodano_k_nam", cancelSentPurchaseOrderIds: [U(3)] } }, job)).toMatch(/zruší/);
  });

  it("poznámka položky objednávky bez materiálu (ten má PDF ve vlastním řádku)", () => {
    expect(noteWithoutMaterial("1.2379 · kalit 58–60 HRC · 1,2 kg/ks", "1.2379")).toBe("kalit 58–60 HRC · 1,2 kg/ks");
    expect(noteWithoutMaterial("11 523", "11 523")).toBeNull();
    expect(noteWithoutMaterial("mimo nabídku — prosíme o nacenění · 1.2379", "1.2379")).toBe("mimo nabídku — prosíme o nacenění");
    expect(noteWithoutMaterial(null, "x")).toBeNull();
    expect(noteWithoutMaterial("a · b", null)).toBe("a · b");
  });

  it("odeslaná objednávka: z formuláře projde jen změna ceny týchž položek", () => {
    const cur = [
      { id: U(51), drawingNumber: "PR-20", name: "Příruba", material: "1.2379", quantity: 200, unit: "ks", note: null },
      { id: U(52), drawingNumber: "PR-21", name: "Pouzdro", material: null, quantity: 100, unit: "ks", note: "x" },
    ];
    const row = (i: number, over: Record<string, unknown> = {}) => ({
      drawing_number: cur[i].drawingNumber, name: cur[i].name, material: cur[i].material, quantity: cur[i].quantity, unit: cur[i].unit, note: cur[i].note, unit_price: 10, ...over,
    });
    expect(purchasePriceOnlyChanges(cur, [row(0, { unit_price: 40 }), row(1, { unit_price: null })])).toEqual([{ itemId: U(51), unitPrice: 40 }, { itemId: U(52), unitPrice: null }]);
    expect(purchasePriceOnlyChanges(cur, [row(0), row(1, { quantity: 101 })])).toBeNull();
    expect(purchasePriceOnlyChanges(cur, [row(0), row(1, { name: "Jiné" })])).toBeNull();
    expect(purchasePriceOnlyChanges(cur, [row(0)])).toBeNull();
    expect(purchasePriceOnlyChanges([{ ...cur[0], id: null }], [row(0)])).toBeNull();
  });

  it("vstup kroku z existujícího kroku zachová kdo, termín a objednávku", () => {
    const op = {
      id: U(61), jobId: U(100), position: 0, kind: "vyroba", title: null, label: "Výroba", supplier: { id: NOVAK, name: "Novák" }, supplierName: null,
      inHouse: false, location: "Novák", status: "ceka", plannedStart: null, plannedEnd: "2026-11-20", startedAt: null, finishedAt: null, note: null,
      purchaseOrderId: U(31), purchaseOrderNumber: "OV-1", createdBy: null, createdAt: "", updatedAt: "", overdue: false,
      purchaseOrder: { id: U(31), number: "OV-1", status: "odeslana", sentAt: null, confirmedDate: null, fileId: null }, deadlineState: "pozadovano",
    } as JobOperation;
    expect(stepInputFromOperation(op, { start: true })).toMatchObject({
      operationId: U(61), who: { type: "supplier", id: NOVAK }, plannedEnd: "2026-11-20", start: true, po: { mode: "existujici", existingId: U(31) },
    });
    expect(stepInputFromOperation({ ...op, purchaseOrderId: null, purchaseOrder: null, poMode: "neobjednavat", poNoneReason: "telefonem" }).po)
      .toEqual({ mode: "neobjednavat", noneReason: "telefonem" });
    expect(stepInputFromOperation({ ...op, inHouse: true, supplier: null }).po).toEqual({ mode: null });
  });
});
