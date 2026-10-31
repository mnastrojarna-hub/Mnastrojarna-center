import { describe, it, expect } from "vitest";
import {
  DEFAULT_RFQ_WEIGHTS, addWorkdays, compareRfq, customerLeakGuard, extractRfqNumbers, findLeaks, needsReminder, neutralFileName,
  normalizeWeights, parseQuantities, parseSupplierReply, qualityScore, rankRfqSuppliers, redactCustomer, rfqDefaultDates, rfqMail,
  rfqReminderMail, rfqSummary, rfqThanksMail, type RfqItem, type RfqRecipientView, type RfqRoundView, type SupplierQuality,
} from "./model";

const TODAY = "2026-10-30"; // pátek

function rec(id: string, name: string, over: Partial<RfqRecipientView> = {}): RfqRecipientView {
  return {
    id, supplierId: `s-${id}`, supplierName: name, emails: [`${id}@dod.test`], status: "odeslano", rank: null, recommendReason: null,
    sentAt: "2026-10-30T08:00:00Z", sentBy: "Dominik Šponer", error: null, remindedAt: null, reminderCount: 0, repliedAt: null,
    replyEmailId: null, replySubject: null, supplierQuoteId: null, declinedAt: null, declineNote: null, thankedAt: null, queueId: null, outboxId: null,
    ...over,
  };
}

const ITEMS: RfqItem[] = [
  { orderItemId: "i1", ref: "PD-2026-004/1", drawingNumber: "VK-2291", revision: "C", name: "Upínací deska", material: "1.2379", unit: "ks", quantities: [50, 100], customerQty: 50 },
  { orderItemId: "i2", ref: "PD-2026-004/2", drawingNumber: "VK-2292", revision: "A", name: "Vodicí lišta", material: "C45", unit: "ks", quantities: [24], customerQty: 24 },
];

describe("poptávky dodavatelům — výchozí hodnoty a texty", () => {
  it("váhy: výchozí 50/30/20, přepočet na 100 %, nesmysl = výchozí", () => {
    expect(normalizeWeights(undefined)).toEqual(DEFAULT_RFQ_WEIGHTS);
    expect(normalizeWeights("{\"price\":1,\"deadline\":1,\"quality\":2}")).toEqual({ price: 25, deadline: 25, quality: 50 });
    expect(normalizeWeights({ price: -1, deadline: 1, quality: 1 })).toEqual(DEFAULT_RFQ_WEIGHTS);
    expect(normalizeWeights("x")).toEqual(DEFAULT_RFQ_WEIGHTS);
  });

  it("termín = termín zákazníka − 5 pracovních dní, odpověď do = za 3 pracovní dny (nejpozději týden před)", () => {
    expect(addWorkdays("2026-11-20", -5)).toBe("2026-11-13");
    expect(rfqDefaultDates({ today: TODAY, customerDate: "2026-11-20" })).toEqual({ requiredDate: "2026-11-13", replyBy: "2026-11-04" });
    // bez termínu zákazníka za 3 týdny (pracovní den)
    expect(rfqDefaultDates({ today: TODAY, customerDate: null }).requiredDate).toBe("2026-11-20");
    // zákazník spěchá: nejdřív za 5 pracovních dní, odpověď nejdřív zítra (pracovní den)
    const rush = rfqDefaultDates({ today: TODAY, customerDate: "2026-11-02" });
    expect(rush.requiredDate).toBe("2026-11-06");
    expect(rush.replyBy).toBe("2026-11-02");
  });

  it("varianty množství: zákazník první, bez duplicit, nejvýš 4", () => {
    expect(parseQuantities("10, 50; 100 ks", 50)).toEqual([50, 10, 100]);
    expect(parseQuantities("", 2.5)).toEqual([2.5]);
    expect(parseQuantities("1 2 3 4 5", 7)).toHaveLength(4);
  });

  it("anonymizace: jméno, výrazné slovo, IČO, číslo objednávky zákazníka a kontakt se odstraní a hlídají", () => {
    const g = customerLeakGuard({ name: "Strojmetal Čelákovice a.s.", ico: "45274649", numbers: ["PO-4471/26", "RFQ-2026-0912"], contact: "Petra Svobodová", email: "nakup@strojmetal.cz" });
    const r = redactCustomer("Deska pro STROJMETAL dle PO 4471/26 (IČ 45274649)", g);
    expect(r.text).not.toMatch(/strojmetal/i);
    expect(r.text).not.toContain("4471");
    expect(r.text).not.toContain("45274649");
    expect(r.hits.length).toBeGreaterThan(0);
    expect(findLeaks(["Poptávka PD-2026-004", "VK-2291_C.pdf"], g)).toEqual([]);
    expect(findLeaks(["Díl pro Strojmetal"], g)).not.toEqual([]);
    expect(findLeaks(["kontakt Petra Svobodová"], g)).not.toEqual([]);
    // celý název i s právní formou, osiřelé „pro …" pryč; víc řádků zůstane
    expect(redactCustomer("Hřídel pro Strojmetal Čelákovice a.s.", g).text).toBe("Hřídel");
    expect(redactCustomer("Atest 3.1\n\nBalení: Strojmetal s.r.o. paleta", g).text).toBe("Atest 3.1\n\nBalení: … paleta");
    // naše firma se nikdy nemaže
    expect(customerLeakGuard({ name: "Mnástrojárna s.r.o." }).terms).toHaveLength(0);
  });

  it("neutrální názvy příloh: číslo výkresu + revize, jinak naše číslo poptávky", () => {
    expect(neutralFileName({ drawingNumber: "VK-2291", revision: "C", ext: "PDF", roundNumber: "PD-2026-004", index: 1 })).toBe("VK-2291_C.pdf");
    expect(neutralFileName({ drawingNumber: null, ext: "step", roundNumber: "PD-2026-004", index: 2 })).toBe("PD-2026-004-V2.step");
  });

  it("e-mail poptávky: vykání / tykání, naše čísla, termíny, varianty, bez zákazníka", () => {
    const vy = rfqMail({ number: "PD-2026-004", scope: "dil", operationKinds: [], items: ITEMS, requiredDate: "2026-11-13", replyBy: "2026-11-04", salutation: "Dobrý den, pane Nováku,", address: "vy", signature: "Dominik Šponer\nMnástrojárna s.r.o.", drawingCount: 2 });
    expect(vy.subject).toBe("Poptávka PD-2026-004");
    expect(vy.body).toContain("poptáváme u Vás výrobu dílů");
    expect(vy.body).toContain("PD-2026-004/1: VK-2291 rev. C — Upínací deska, materiál 1.2379 — 50 ks / 100 ks");
    expect(vy.body).toContain("Požadovaný termín dodání: 13. 11. 2026.");
    expect(vy.body).toContain("do 4. 11. 2026");
    expect(vy.body).toContain("Pošlete prosím cenu pro každé uvedené množství.");
    expect(vy.body).toContain("\n-- \nDominik Šponer");
    const ty = rfqMail({ number: "PD-2026-004", scope: "operace", operationKinds: ["tepelne_zpracovani"], items: [ITEMS[1]], requiredDate: null, replyBy: null, salutation: "Ahoj Pavle,", address: "ty", signature: "", drawingCount: 0 });
    expect(ty.subject).toBe("Poptávka PD-2026-004 — tepelné zpracování");
    expect(ty.body).toContain("poptávám u tebe tepelné zpracování");
    expect(ty.body).toContain("Výkresy pošlu na vyžádání.");
    expect(rfqReminderMail({ number: "PD-2026-004", replyBy: "2026-11-04", salutation: "Dobrý den,", address: "vy", signature: "" }, "2026-11-03").body).toContain("nabídku potřebujeme do 4. 11. 2026");
    expect(rfqThanksMail({ number: "PD-2026-004", salutation: "Ahoj,", address: "ty", signature: "" }).body).toContain("Tentokrát jsme zakázku zadali jinde");
  });

  it("číslo poptávky v odpovědi: PD-2026-004, „PD 2026/4“ i v citaci", () => {
    expect(extractRfqNumbers("Re: Poptávka PD-2026-004", "viz PD 2026/12")).toEqual(["PD-2026-004", "PD-2026-012"]);
    expect(extractRfqNumbers("Nabídka 2026-004")).toEqual([]);
  });

  it("urgovat den před „odpověď do“ (a ne dvakrát za den)", () => {
    expect(needsReminder(rec("a", "A"), "2026-11-04", "2026-11-02")).toBe(false);
    expect(needsReminder(rec("a", "A"), "2026-11-04", "2026-11-03")).toBe(true);
    expect(needsReminder(rec("a", "A", { remindedAt: "2026-11-03T09:00:00Z" }), "2026-11-04", "2026-11-03")).toBe(false);
    expect(needsReminder(rec("a", "A", { status: "nabidka" }), "2026-11-04", "2026-11-05")).toBe(false);
  });

  it("souhrn kola „Poptáno: 3 · odpověděli 1“ (bez neodeslaných)", () => {
    const s = rfqSummary({ recipients: [rec("a", "A", { status: "nabidka" }), rec("b", "B"), rec("c", "C", { status: "ceka_na_anonymizaci" }), rec("d", "D", { status: "chyba" })] });
    expect(s).toMatchObject({ asked: 3, answered: 1, offers: 1, text: "Poptáno: 3 · odpověděli 1" });
  });
});

describe("kvalita a doporučení dodavatelů", () => {
  const q = (over: Partial<SupplierQuality>): SupplierQuality => ({ supplierId: "x", rating: null, certifications: [], ordersDone: 0, onTime: 0, late: 0, avgDelayDays: null, issues: 0, jobs: 0, ...over });

  it("bez dat = neutrální „bez historie“, hodnocení + včas + problémy", () => {
    expect(qualityScore(null)).toMatchObject({ score: 0.5, noHistory: true, text: "bez historie" });
    const good = qualityScore(q({ rating: 5, ordersDone: 10, onTime: 10, jobs: 8 }));
    expect(good.noHistory).toBe(false);
    expect(good.stars).toBe(5);
    expect(good.text).toBe("kvalita 5/5 · včas 10 z 10");
    const bad = qualityScore(q({ rating: 2, ordersDone: 4, onTime: 1, late: 3, issues: 2, jobs: 4 }));
    expect(bad.score).toBeLessThan(0.4);
    expect(bad.text).toContain("2 problémy");
  });

  it("pořadí: technologie, historie výkresu (nejlevněji), kvalita; předvybere 3 se shodou a e-mailem", () => {
    const sup = (id: string, technologies: string[], over = {}) => ({ id, name: id, technologies, materials: [], certifications: [], leadDays: null, rating: null, email: `${id}@x.test`, ...over });
    const ranked = rankRfqSuppliers({
      suppliers: [
        sup("Kalírna", ["tepelne_zpracovani"]),
        sup("Hruby", ["frezovani_3osy"], { rating: 4.8 }),
        sup("Novak", ["soustruzeni"], { materials: ["1.2379"] }),
        sup("Bezmailu", ["frezovani"], { email: null }),
        sup("Levny", ["frezovani"]),
        sup("Pozde", ["frezovani"], { leadDays: 40 }),
      ],
      scope: "dil", kinds: [], materials: ["1.2379"], drawingNumbers: ["VK-2291"],
      history: { drawings: [{ drawingNumber: "VK 2291", supplierId: "Levny", unitPrice: 900 }, { drawingNumber: "VK-2291", supplierId: "Hruby", unitPrice: 1100 }], operations: [] },
      quality: new Map([["Hruby", q({ supplierId: "Hruby", ordersDone: 5, onTime: 5, jobs: 5 })]]),
    });
    const names = ranked.map((r) => r.supplier.name);
    expect(names.slice(0, 3).sort()).toEqual(["Hruby", "Levny", "Novak"]);
    expect(ranked.filter((r) => r.recommended).map((r) => r.supplier.name).sort()).toEqual(["Hruby", "Levny", "Novak"]);
    expect(ranked.find((r) => r.supplier.name === "Levny")?.reasons).toContain("dělal tento výkres nejlevněji");
    expect(ranked.find((r) => r.supplier.name === "Kalírna")?.techMatch).toBe(false);
    expect(ranked.find((r) => r.supplier.name === "Bezmailu")?.recommended).toBe(false);
    // jen operace: kalírna nahoře
    const heat = rankRfqSuppliers({
      suppliers: [sup("Kalírna", ["tepelne_zpracovani"]), sup("Hruby", ["frezovani_3osy"])], scope: "operace", kinds: ["tepelne_zpracovani"],
      materials: [], drawingNumbers: [], history: { drawings: [], operations: [] }, quality: new Map(),
    });
    expect(heat[0].supplier.name).toBe("Kalírna");
    expect(heat[0].recommended).toBe(true);
    expect(heat[1].recommended).toBe(false);
  });
});

describe("porovnání nabídek a „Doporučujeme“", () => {
  function round(): Pick<RfqRoundView, "items" | "recipients" | "offers" | "selections" | "requiredDate"> {
    return {
      items: ITEMS,
      requiredDate: "2026-11-20",
      recipients: [rec("a", "Alfa", { status: "nabidka" }), rec("b", "Beta", { status: "nabidka" }), rec("c", "Gama", { status: "nabidka" }), rec("d", "Delta", { status: "odmitl" })],
      selections: [],
      offers: [
        { recipientId: "a", quoteId: "qa", number: "A1", quoteDate: "2026-10-30", total: 0, currency: "CZK", leadTimeDays: 14, deliveryDate: null, validUntil: "2026-11-30", note: null,
          lines: [{ orderItemId: "i1", drawingNumber: "VK-2291", quantity: 50, unitPrice: 1000 }, { orderItemId: "i1", drawingNumber: "VK-2291", quantity: 100, unitPrice: 900 }, { orderItemId: "i2", drawingNumber: "VK-2292", quantity: 24, unitPrice: 500 }] },
        { recipientId: "b", quoteId: "qb", number: null, quoteDate: "2026-10-30", total: 0, currency: "CZK", leadTimeDays: null, deliveryDate: "2026-11-27", validUntil: null, note: "pozdě",
          lines: [{ orderItemId: "i1", drawingNumber: "VK-2291", quantity: 50, unitPrice: 880 }, { orderItemId: "i2", drawingNumber: "VK-2292", quantity: 24, unitPrice: 450 }] },
        { recipientId: "c", quoteId: "qc", number: null, quoteDate: "2026-10-30", total: 0, currency: "CZK", leadTimeDays: 10, deliveryDate: null, validUntil: null, note: null,
          lines: [{ orderItemId: null, drawingNumber: "VK 2291", quantity: 50, unitPrice: 1200 }] },
      ],
    };
  }

  it("nejlevnější / nejrychlejší, pozdní termín silně penalizovaný, doporučení s důvodem", () => {
    const cmp = compareRfq(round(), new Map(), DEFAULT_RFQ_WEIGHTS);
    const r1 = cmp.rows[0];
    expect(r1.cells.map((c) => c.supplierName)).toEqual(["Alfa", "Beta", "Gama"]);
    const beta = r1.cells.find((c) => c.supplierName === "Beta")!;
    expect(beta.cheapest).toBe(true);
    expect(beta.bufferDays).toBe(-7);
    expect(r1.cells.find((c) => c.supplierName === "Gama")!.fastest).toBe(true);
    // Beta je nejlevnější, ale o týden po termínu → doporučená Alfa (stihne s rezervou)
    expect(r1.recommended?.recipientId).toBe("a");
    expect(r1.recommended?.reason).toBe("o 14 % dražší než nejlevnější, termín 7 dní před naším termínem, bez historie");
    const alfa = r1.cells.find((c) => c.supplierName === "Alfa")!;
    expect(alfa.variants).toEqual([{ quantity: 100, unitPrice: 900 }]);
    expect(alfa.total).toBe(50_000);
    // celá poptávka: Gama nepokryje položku 2
    expect(cmp.rows[1].cells.map((c) => c.supplierName)).toEqual(["Alfa", "Beta"]);
    expect(cmp.overall?.recipientId).toBe("a");
    expect(cmp.overall?.reason).toContain("nejlepší u všech položek");
  });

  it("celé kolo: z celkové ceny (váha podle hodnoty položek), ne průměr položek", () => {
    const r = round();
    // Beta stihne termín a je levnější u drahé položky, Alfa jen u levné → celkově Beta
    r.offers[1] = { ...r.offers[1], deliveryDate: "2026-11-12" };
    r.offers[0] = { ...r.offers[0], lines: [{ orderItemId: "i1", drawingNumber: "VK-2291", quantity: 50, unitPrice: 1000 }, { orderItemId: "i2", drawingNumber: "VK-2292", quantity: 24, unitPrice: 400 }] };
    const cmp = compareRfq(r, new Map(), DEFAULT_RFQ_WEIGHTS);
    expect(cmp.rows[0].recommended?.recipientId).toBe("b");
    expect(cmp.rows[1].recommended?.recipientId).toBe("a");
    expect(cmp.overall?.recipientId).toBe("b");
    expect(cmp.overall?.reason).toMatch(/^celkem nejlevnější o \d+ %, termín \d+ dní před naším termínem, bez historie$/);
  });

  it("váhy z Nastavení: jen cena → nejlevnější i po termínu; kvalita mění pořadí", () => {
    const priceOnly = compareRfq(round(), new Map(), { price: 100, deadline: 0, quality: 0 });
    expect(priceOnly.rows[0].recommended?.recipientId).toBe("b");
    expect(priceOnly.rows[0].recommended?.reason).toMatch(/^nejlevnější o 12 %/);
    const quality = new Map([["s-b", { supplierId: "s-b", rating: 5, certifications: [], ordersDone: 9, onTime: 9, late: 0, avgDelayDays: null, issues: 0, jobs: 9 }]]);
    const q = compareRfq(round(), quality, { price: 40, deadline: 10, quality: 50 });
    expect(q.rows[0].recommended?.recipientId).toBe("b");
    expect(q.rows[0].recommended?.reason).toContain("kvalita 5/5");
  });

  it("odpověď dodavatele → předvyplnění cen po výkresech, lhůty, platnosti a čísla", () => {
    const text = [
      "Dobrý den,", "posíláme nabídku č. NAB-77/26 k poptávce PD-2026-004:",
      "VK-2291 rev C … 1 180,- Kč / 1 050 Kč", "VK 2292: 455,50 Kč", "Dodací lhůta 3 týdny od objednávky.", "Platnost nabídky do 30. 11. 2026",
      "-- ", "Jan Kalírna",
    ].join("\n");
    const p = parseSupplierReply(text, ITEMS, TODAY);
    expect(p.found).toBe(2);
    expect(p.lines).toEqual([
      { orderItemId: "i1", quantity: 50, unitPrice: 1180 }, { orderItemId: "i1", quantity: 100, unitPrice: 1050 }, { orderItemId: "i2", quantity: 24, unitPrice: 455.5 },
    ]);
    expect(p.leadTimeDays).toBe(21);
    expect(p.validUntil).toBe("2026-11-30");
    expect(p.number).toBe("NAB-77/26");
    // jedna položka, cena kdekoli v textu
    expect(parseSupplierReply("Cena 640 Kč/ks, dodání 10 pracovních dní", [ITEMS[1]], TODAY)).toMatchObject({ found: 1, leadTimeDays: 14, lines: [{ orderItemId: "i2", quantity: 24, unitPrice: 640 }] });
  });
});
