import { describe, it, expect } from "vitest";
import { buildTechCard, routeText, techNextAction, techSummary, type TechCardInput, type TechCardView } from "./technology-overview";
import { HRUBY, NOVAK, TEPKAL, addDays, item, op, purchaseOrder, quote, stepPo, supplierRef } from "./__fixtures__/technology";
import type { FlowActionKey } from "@/lib/jobs/flow-status";

const TODAY = "2026-10-30";
const ALL = (_f: string) => true;

function input(over: Partial<TechCardInput>): TechCardInput {
  return {
    stage: "naceneni", items: [], ops: [], quotes: [], purchaseOrders: [], finalDate: null, today: TODAY, canSeePrices: true, currency: "CZK",
    ...over,
  };
}
const steps = (v: TechCardView) => v.groups.flatMap((g) => g.steps);
const next = (v: TechCardView, stage: TechCardInput["stage"], flowNext: { key: FlowActionKey; label: string } | null = null, can = ALL) =>
  techNextAction(v, { stage, flowNext, can });

const ITEMS = [
  item({ id: "i1", position: 0, drawingNumber: "PR-20", name: "Příruba", quantity: 2, tech: { procedure: "1. frézovat\n2. kalit", complete: false, completeBy: null, supplierNote: "pozor popsat na čele" } }),
  item({ id: "i2", position: 1, drawingNumber: "PR-21", name: "Pouzdro", quantity: 1 }),
];

describe("Karta Technologie — model", () => {
  it("poptávka bez kroků a bez postupu = prázdný stav s „Nastavit technologii“", () => {
    const v = buildTechCard(input({ stage: "poptavka", items: [item({ id: "i1", drawingNumber: "PR-10" })] }));
    expect(v.empty).toBe(true);
    expect(techSummary(v)).toBe("Technologie zatím nenastavena");
    expect(next(v, "poptavka")).toMatchObject({ key: "production.plan", label: "Nastavit technologii" });
  });

  it("nacenění: krok bez firmy s nabídkou bez ceny = „Čeká na nabídku dodavatele“ (ne „bez dodavatele“), cena z nabídky Nováka", () => {
    const qN = quote({ id: "qn", supplier: supplierRef(NOVAK), total: 8200, operationKinds: ["frezovani"], leadTimeDays: 21 });
    const qT = quote({ id: "qt", supplier: supplierRef(TEPKAL), total: null, operationKinds: ["tepelne_zpracovani"] });
    const v = buildTechCard(input({
      items: ITEMS, quotes: [qN, qT],
      ops: [
        op({ id: "a", position: 0, supplier: NOVAK, supplierQuoteId: "qn" }),
        op({ id: "b", position: 1, kind: "tepelne_zpracovani", label: "Tepelné zpracování" }),
      ],
    }));
    const [a, b] = steps(v);
    expect(v.groups).toHaveLength(1);
    expect(v.groups[0].title).toBe("Všechny díly (2)");
    expect(routeText(v.groups[0])).toBe("Frézování → Tepelné zpracování");
    expect(a).toMatchObject({ phase: "k_objednani", status: "Nabídka s cenou", whoText: NOVAK.name, cost: { amount: 8200, source: "nabidka" }, po: null, current: false });
    expect(a.deadline?.text).toBe("dle nabídky 3 týdny");
    expect(b.phase).toBe("ceka_na_nabidku");
    expect(b.status).toBe("Čeká na nabídku dodavatele");
    expect(b.quotePending).toBe(TEPKAL.name);
    expect(v.cost).toEqual({ amount: 8200, currency: "CZK", pending: 1 });
    expect(v.groups[0].items[0].supplierNote).toBe("pozor popsat na čele");
    expect(next(v, "naceneni")).toMatchObject({ key: "pricing.supplierPrice", label: "Zadat cenu dodavatele" });
    expect(next(v, "naceneni")?.hint).toContain("2. Tepelné zpracování");
  });

  it("bez práva na ceny: žádné náklady ani nabídky, krok bez firmy → „Doplnit, kdo to dělá“", () => {
    const v = buildTechCard(input({
      items: ITEMS, quotes: null, purchaseOrders: null, canSeePrices: false,
      ops: [op({ id: "a", supplier: NOVAK }), op({ id: "b", position: 1, kind: "tepelne_zpracovani", label: "Tepelné zpracování" })],
    }));
    expect(steps(v).every((s) => s.cost === null && s.quotePending === null)).toBe(true);
    expect(v.cost).toBeNull();
    expect(steps(v)[1].phase).toBe("bez_firmy");
    const can = (f: string) => f !== "margins";
    expect(next(v, "naceneni", null, can)).toMatchObject({ key: "production.plan", label: "Doplnit, kdo to dělá" });
  });

  it("nacenění: firma kroku bez nabídky → „Bez nabídky“ a „Poptat dodavatele“", () => {
    const v = buildTechCard(input({ items: ITEMS, ops: [op({ id: "a", supplier: NOVAK })] }));
    expect(steps(v)[0]).toMatchObject({ phase: "k_objednani", status: "Bez nabídky", cost: null });
    expect(next(v, "naceneni")).toMatchObject({ key: "pricing.supplierPrice", label: "Poptat dodavatele" });
    expect(next(v, "naceneni")?.hint).toContain(`${NOVAK.name} — zatím bez nabídky`);
    // bez práva na ceny nevíme, jestli nabídka je → jen „K objednání“, bez tlačítka na Nákup
    const w = buildTechCard(input({ items: ITEMS, ops: [op({ id: "a", supplier: NOVAK })], canSeePrices: false, quotes: null }));
    expect(steps(w)[0].status).toBe("K objednání");
    expect(next(w, "naceneni", null, (f) => f !== "margins")).toBeNull();
  });

  it("nacenění bez nabídek: krok bez firmy → „Poptat dodavatele“ (Nákup)", () => {
    const v = buildTechCard(input({ items: ITEMS, ops: [op({ id: "a", kind: "brouseni", label: "Broušení" })] }));
    expect(steps(v)[0]).toMatchObject({ phase: "bez_firmy", status: "Vybrat, kdo to dělá" });
    expect(next(v, "naceneni")).toMatchObject({ key: "pricing.supplierPrice", label: "Poptat dodavatele" });
  });

  it("potvrzeno, dvě položky s jinou technologií: dvě skupiny, termín kalení za termínem zákazníka červeně, další krok z hlavičky", () => {
    const due = addDays(TODAY, 20);
    const v = buildTechCard(input({
      stage: "potvrzeno",
      items: [item({ id: "i1", drawingNumber: "PR-30", name: "Matrice", quantity: 4 }), item({ id: "i2", position: 1, drawingNumber: "PR-31", name: "Vodicí čep", quantity: 10 })],
      finalDate: { date: due, source: "due_date" },
      ops: [
        op({ id: "a", position: 0, supplier: NOVAK, plannedEnd: addDays(TODAY, 12), orderItemIds: ["i1"], deadlineState: "dohodnuto" }),
        op({ id: "b", position: 1, kind: "tepelne_zpracovani", label: "Tepelné zpracování", supplier: TEPKAL, plannedEnd: addDays(TODAY, 24), orderItemIds: ["i1"] }),
        op({ id: "c", position: 2, kind: "soustruzeni", label: "Soustružení", inHouse: true, plannedEnd: addDays(TODAY, 15), orderItemIds: ["i2"], deadlineState: "plan" }),
      ],
    }));
    expect(v.groups.map((g) => g.title)).toEqual(["PR-30 · Matrice", "PR-31 · Vodicí čep"]);
    expect(v.groups.map(routeText)).toEqual(["Frézování → Tepelné zpracování", "Soustružení"]);
    const [a, b, c] = steps(v);
    expect(a.deadline).toMatchObject({ tone: "green" });
    expect(a.deadline?.text).toMatch(/^do \d+\. \d+\. · dohodnuto$/);
    expect(b.deadline?.tone).toBe("red");
    expect(b.deadline?.text).toContain("po termínu zákazníka");
    expect(c).toMatchObject({ whoText: "U nás", phase: "ceka", status: "Čeká" });
    expect(v.final).toMatchObject({ tone: "red" });
    expect(v.risk).toContain("po konečném termínu");
    expect(techSummary(v)).toBe(`3 kroky · ${NOVAK.name}, ${TEPKAL.name} + u nás`);
    // potvrzená objednávka: hlavička nabízí předání → karta stejné tlačítko
    expect(next(v, "potvrzeno", { key: "production.handoff", label: "Předat do výroby…" })).toMatchObject({ key: "production.handoff", label: "Předat do výroby…" });
    // bez dalšího kroku z hlavičky karta předání nabídne sama
    expect(next(v, "potvrzeno")).toMatchObject({ key: "production.handoff" });
  });

  it("ve výrobě 3 kroky: běží u Nováka (objednáno, potvrzeno), kalení s neodeslanou objednávkou, broušení u nás s konečným termínem", () => {
    const p1 = purchaseOrder({ id: "p1", number: "OV-2026-041", status: "potvrzena", total: 9600, sentAt: "2026-10-26T08:00:00Z", confirmedDate: addDays(TODAY, 6) });
    const p2 = purchaseOrder({ id: "p2", number: "OV-2026-042", status: "vystavena", total: 1800 });
    const v = buildTechCard(input({
      stage: "ve_vyrobe", items: [item({ id: "i1", drawingNumber: "PR-40", name: "Razník", quantity: 6 })], purchaseOrders: [p1, p2],
      finalDate: { date: addDays(TODAY, 18), source: "due_date" },
      ops: [
        op({ id: "a", supplier: NOVAK, status: "probiha", startedAt: "2026-10-27T08:00:00Z", plannedEnd: addDays(TODAY, 6), purchaseOrderId: "p1", purchaseOrder: stepPo(p1), deadlineState: "potvrzeno" }),
        op({ id: "b", position: 1, kind: "tepelne_zpracovani", label: "Tepelné zpracování", supplier: TEPKAL, plannedEnd: addDays(TODAY, 11), purchaseOrderId: "p2", purchaseOrder: stepPo(p2) }),
        op({ id: "c", position: 2, kind: "brouseni", label: "Broušení", inHouse: true, plannedEnd: addDays(TODAY, 18), endsAtCustomerDate: true, deadlineState: "plan" }),
      ],
    }));
    const [a, b, c] = steps(v);
    expect(a).toMatchObject({ phase: "ve_vyrobe", status: "Ve výrobě u dodavatele od 27. 10.", current: true, cost: { amount: 9600, source: "objednavka", ref: "OV-2026-041" } });
    expect(a.po).toContain("OV-2026-041 · potvrzena na");
    expect(b).toMatchObject({ phase: "k_odeslani", poNumber: "OV-2026-042" });
    expect(b.po).toBe("OV-2026-042 · čeká na odeslání");
    expect(c).toMatchObject({ phase: "ceka", whoText: "U nás" });
    expect(c.deadline?.text).toMatch(/^konečný .* · zákazník$/);
    expect(v.cost).toEqual({ amount: 11400, currency: "CZK", pending: 0 });
    expect(v.risk).toBeNull();
    // hlavička: „Posunout dál…" (technologický krok) → karta stejné
    expect(next(v, "ve_vyrobe", { key: "production.advance", label: "Posunout dál…" })).toMatchObject({ key: "production.advance", label: "Posunout dál…" });
    expect(next(v, "ve_vyrobe", { key: "production.advance", label: "Posunout dál…" })?.hint).toContain("1. Frézování");
    // bez technologického kroku v hlavičce: neodeslaná objednávka
    expect(next(v, "ve_vyrobe", { key: "order.sendConfirmation", label: "Odeslat potvrzení" })).toMatchObject({ key: "production.sendPo", label: "Odeslat objednávku" });
  });

  it("krok po termínu: červeně „N dní po termínu“; dodavatel potvrdil později než mezitermín", () => {
    const p = purchaseOrder({ id: "p", number: "OV-1", status: "potvrzena", confirmedDate: addDays(TODAY, 9) });
    const v = buildTechCard(input({
      stage: "ve_vyrobe", items: ITEMS,
      ops: [
        op({ id: "a", supplier: NOVAK, status: "probiha", plannedEnd: addDays(TODAY, -3) }),
        op({ id: "b", position: 1, supplier: TEPKAL, kind: "tepelne_zpracovani", label: "Tepelné zpracování", plannedEnd: addDays(TODAY, 5), purchaseOrderId: "p", purchaseOrder: stepPo(p) }),
      ],
    }));
    const [a, b] = steps(v);
    expect(a.deadline).toMatchObject({ tone: "red" });
    expect(a.deadline?.text).toContain("3 dny po termínu");
    expect(b.deadline?.tone).toBe("red");
    expect(b.deadline?.text).toContain("dodavatel potvrdil až");
    expect(b.phase).toBe("objednano");
  });

  it("částečně dodáno: převzata 1 ze 2 položek objednávky, zákazníkovi dodány 2 z 8 ks", () => {
    const p = purchaseOrder({ id: "p", number: "OV-51", status: "potvrzena", total: 11000, receipt: { done: 1, total: 2, partial: true } });
    const v = buildTechCard(input({
      stage: "ve_vyrobe", purchaseOrders: [p],
      items: [
        item({ id: "i1", drawingNumber: "PR-50", quantity: 5, deliveredQuantity: 2, tech: { procedure: null, complete: true, completeBy: HRUBY.name, supplierNote: null } }),
        item({ id: "i2", position: 1, drawingNumber: "PR-51", quantity: 3, tech: { procedure: null, complete: true, completeBy: HRUBY.name, supplierNote: null } }),
      ],
      ops: [op({ id: "a", kind: "kompletni_dodavka", label: "Kompletní dodávka", supplier: HRUBY, status: "probiha", purchaseOrderId: "p", purchaseOrder: stepPo(p) })],
    }));
    const [a] = steps(v);
    expect(a).toMatchObject({ phase: "castecne_dodano", status: "Částečně dodáno k nám (1/2 položky)", whoRole: "dodavatel" });
    expect(v.groups[0].delivered).toEqual({ done: 2, total: 8, unit: "ks" });
    expect(v.groups[0].items.every((i) => i.complete && i.completeBy === HRUBY.name)).toBe(true);
    expect(next(v, "ve_vyrobe", { key: "delivery.record", label: "Dodat zbytek" })).toMatchObject({ key: "delivery.record", label: "Dodat zbytek" });
  });

  it("dodáno zákazníkovi: kroky „Dodáno k nám / Hotovo“ s datem, žádné termíny ani další krok", () => {
    const p = purchaseOrder({ id: "p", number: "OV-61", status: "dodana", total: 4000 });
    const v = buildTechCard(input({
      stage: "dodano_zakaznikovi", purchaseOrders: [p], finalDate: { date: addDays(TODAY, -2), source: "due_date" },
      items: [item({ id: "i1", drawingNumber: "PR-60", quantity: 2, deliveredQuantity: 2 })],
      ops: [
        op({ id: "a", supplier: NOVAK, status: "hotovo", finishedAt: "2026-10-24T10:00:00Z", purchaseOrderId: "p", purchaseOrder: stepPo(p), plannedEnd: addDays(TODAY, -6) }),
        op({ id: "b", position: 1, kind: "kontrola", label: "Kontrola / měření", inHouse: true, status: "hotovo", finishedAt: "2026-10-26T10:00:00Z" }),
        op({ id: "c", position: 2, kind: "doprava", label: "Doprava", inHouse: true, status: "ceka" }),
      ],
    }));
    const [a, b, c] = steps(v);
    expect(a).toMatchObject({ phase: "dodano", status: "Dodáno k nám 24. 10.", deadline: null });
    expect(b).toMatchObject({ phase: "hotovo", status: "Hotovo 26. 10." });
    expect(c.phase).toBe("uzavreno");
    expect(v.final?.tone).toBe("grey");
    expect(v.groups[0].delivered).toEqual({ done: 2, total: 2, unit: "ks" });
    expect(next(v, "dodano_zakaznikovi", { key: "payment.invoice", label: "Vystavit fakturu" })).toBeNull();
  });

  it("jen postup technologa bez kroků: ne prázdné, „Doplnit technologii“ u položky bez postupu", () => {
    const v = buildTechCard(input({ stage: "objednavka", items: ITEMS }));
    expect(v.empty).toBe(false);
    expect(v.groups[0].steps).toHaveLength(0);
    expect(techSummary(v)).toContain("kroky výroby zatím nenaplánované");
    expect(next(v, "objednavka")).toMatchObject({ key: "production.plan", label: "Doplnit technologii" });
  });

  it("krok bez firmy s nabídkami s cenou: „Vybrat z 2 nabídek“ a k nim „Doplnit, kdo to dělá“ (ne Poptat)", () => {
    const v = buildTechCard(input({
      items: ITEMS,
      quotes: [
        quote({ id: "q1", supplier: supplierRef(NOVAK), total: 900, operationKinds: ["tepelne_zpracovani"] }),
        quote({ id: "q2", supplier: supplierRef(TEPKAL), total: 800, operationKinds: ["tepelne_zpracovani"] }),
      ],
      ops: [op({ id: "a", kind: "tepelne_zpracovani", label: "Tepelné zpracování" })],
    }));
    expect(steps(v)[0]).toMatchObject({ phase: "bez_firmy", status: "Vybrat z 2 nabídek", quoteCount: 2 });
    expect(next(v, "naceneni")).toMatchObject({ key: "production.plan", label: "Doplnit, kdo to dělá" });
  });

  it("přeskočený krok se nepočítá; krok s neznámými díly patří všem", () => {
    const v = buildTechCard(input({
      stage: "ve_vyrobe", items: ITEMS,
      ops: [op({ id: "a", supplier: NOVAK, status: "preskoceno" }), op({ id: "b", position: 1, inHouse: true, kind: "brouseni", label: "Broušení", orderItemIds: ["smazana"] })],
    }));
    expect(v.skipped).toBe(1);
    expect(v.groups).toHaveLength(1);
    expect(steps(v).map((s) => s.no)).toEqual([1]);
  });
});
