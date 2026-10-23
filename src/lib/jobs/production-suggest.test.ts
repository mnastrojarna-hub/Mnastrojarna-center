import { describe, it, expect } from "vitest";
import {
  leadTimeLabel, money, normalizeDrawingNumber, operationFamily, operationKindsOfSupplier, operationKindsOfText,
  purchaseItemsForStep, quoteKinds, quoteStepMatch, quoteValue, rankQuotesForStep, stepPurchaseOrderNote,
  suggestRoute, suggestStepDeadline, suggestWhoForStep, unitClass,
  type SuggestItem, type SuggestQuote,
} from "./production-suggest";

/**
 * Kdo to dělá, do kdy a jaký postup — realistická dílna: příruba (kalená 58–60 HRC, 1,2 kg) a pouzdro,
 * obrábění u Nováka nebo kompletně u Hrubého, kalení v kalírně TepKal za kg.
 */
const TODAY = "2026-10-23"; // pátek

const PRIRUBA: SuggestItem = {
  id: "11111111-1111-4111-8111-111111111120", drawingNumber: "PR-7075-20", name: "Příruba", materialDesignation: "1.2379",
  material: "nástrojová ocel", quantity: 200, unit: "ks", weightKg: 1.2, heatTreatment: "kalit", hardness: "58–60 HRC",
};
const POUZDRO: SuggestItem = {
  id: "11111111-1111-4111-8111-111111111121", drawingNumber: "PR-7075-21", name: "Pouzdro", material: "11 523",
  quantity: 100, unit: "ks", weightKg: 0.4, purchaseUnitPrice: 35,
};
const ITEMS = [PRIRUBA, POUZDRO];

function quote(over: Partial<SuggestQuote> & Pick<SuggestQuote, "id" | "supplierName">): SuggestQuote {
  return {
    supplierId: `sup-${over.id}`, number: `N-${over.id}`, quoteDate: "2026-10-15", validUntil: "2026-12-31", leadTimeDays: null,
    deliveryDate: null, currency: "CZK", total: null, selected: false, note: null, operationKinds: null, items: [], ...over,
  };
}

const HRUBY = quote({
  id: "hruby", supplierName: "Kovoobrábění Hrubý s.r.o.", operationKinds: ["kompletni_dodavka"], leadTimeDays: 28, total: 15_000,
  selected: true, selectedBy: "Petr Obchodník", selectedAt: "2026-10-20T08:00:00Z",
  items: [
    { drawingNumber: "PR-7075-20", name: "Příruba kalená", quantity: 200, unit: "ks", unitPrice: 50, note: null },
    { drawingNumber: "PR-7075-21", name: "Pouzdro", quantity: 100, unit: "ks", unitPrice: 50, note: null },
  ],
});
const NOVAK = quote({
  id: "novak", supplierName: "Frézy Novák s.r.o.", note: "Frézování dle výkresu", leadTimeDays: 21,
  items: [
    { drawingNumber: "PR 7075/20", name: "Příruba", quantity: 200, unit: "ks", unitPrice: 40, note: null },
    { drawingNumber: "pr-7075.21", name: "Pouzdro", quantity: 100, unit: "ks", unitPrice: 42, note: null },
  ],
});
const LEVNA_PROSLA = quote({
  id: "levna", supplierName: "Levná Fréza s.r.o.", note: "frézování", validUntil: "2026-10-01", leadTimeDays: 14,
  items: [
    { drawingNumber: "PR-7075-20", name: "Příruba", quantity: 200, unit: "ks", unitPrice: 30, note: null },
    { drawingNumber: "PR-7075-21", name: "Pouzdro", quantity: 100, unit: "ks", unitPrice: 30, note: null },
  ],
});
const TEPKAL = quote({
  id: "tepkal", supplierName: "TepKal s.r.o.", operationKinds: ["tepelne_zpracovani"], leadTimeDays: 5,
  items: [{ drawingNumber: "PR-7075-20", name: "Kalení na 58–60 HRC", quantity: 240, unit: "kg", unitPrice: 8.75, note: null }],
});

const CTX = { items: ITEMS, currency: "CZK", today: TODAY };

describe("druhy kroků z textu a technologií", () => {
  it("kalení je tepelné zpracování, kalibrace ne; frézování + kalení = obojí; PVD povlak = povrch", () => {
    expect(operationKindsOfText("kalení 58-60 HRC")).toEqual(["tepelne_zpracovani"]);
    expect(operationKindsOfText("kalibrace měřidel")).toEqual([]);
    expect(operationKindsOfText("Frézování + kalení")).toEqual(["frezovani", "tepelne_zpracovani"]);
    expect(operationKindsOfText("PVD povlak")).toEqual(["povrchova_uprava"]);
    expect(operationKindsOfText("soustružení a broušení; zinkování")).toEqual(["soustruzeni", "brouseni", "povrchova_uprava"]);
    expect(operationKindsOfText("žíhání na odstranění pnutí")).toEqual(["tepelne_zpracovani"]);
    expect(operationKindsOfText(null)).toEqual([]);
  });

  it("technologie dodavatele jen z jedné rodiny; kdo obrábí i kalí, nic neprozradí", () => {
    expect(operationKindsOfSupplier(["frezovani_3osy", "soustruzeni"])).toEqual(["frezovani", "soustruzeni"]);
    expect(operationKindsOfSupplier(["Kalení", "Nitridace"])).toEqual(["tepelne_zpracovani"]);
    expect(operationKindsOfSupplier(["frezovani_5os", "tepelne_zpracovani"])).toEqual([]);
    expect(operationKindsOfSupplier([])).toEqual([]);
  });

  it("druhy nabídky: zadané → text → technologie → neznámé", () => {
    expect(quoteKinds(TEPKAL)).toEqual({ kinds: ["tepelne_zpracovani"], source: "explicit" });
    expect(quoteKinds(NOVAK)).toEqual({ kinds: ["frezovani"], source: "text" });
    expect(quoteKinds({ ...quote({ id: "x", supplierName: "X" }), supplierTechnologies: ["Kalení"] })).toEqual({ kinds: ["tepelne_zpracovani"], source: "supplier" });
    expect(quoteKinds(quote({ id: "y", supplierName: "Y" }))).toEqual({ kinds: [], source: "unknown" });
  });

  it("shoda nabídky s krokem (3 přesně, 2 rodina / komplet↔obrábění, 1 neznámé u obrábění, 0 jinak)", () => {
    expect(quoteStepMatch(["frezovani"], "frezovani")).toBe(3);
    expect(quoteStepMatch(["frezovani"], "vyroba")).toBe(2);
    expect(quoteStepMatch(["kompletni_dodavka"], "vyroba")).toBe(2);
    expect(quoteStepMatch(["frezovani"], "kompletni_dodavka")).toBe(2);
    expect(quoteStepMatch([], "vyroba")).toBe(1);
    expect(quoteStepMatch([], "kompletni_dodavka")).toBe(1);
    expect(quoteStepMatch([], "tepelne_zpracovani")).toBe(0);
    expect(quoteStepMatch([], "povrchova_uprava")).toBe(0);
    expect(quoteStepMatch(["frezovani"], "tepelne_zpracovani")).toBe(0);
    expect(quoteStepMatch(["kompletni_dodavka"], "tepelne_zpracovani")).toBe(0);
    expect(quoteStepMatch(["tepelne_zpracovani"], "tepelne_zpracovani")).toBe(3);
    expect(operationFamily("vyroba")).toBe("obrabeni");
    expect(operationFamily("svarovani")).toBe("obrabeni");
  });
});

describe("porovnatelná cena nabídky", () => {
  it("čísla výkresů se porovnávají bez mezer, teček, pomlček a lomítek (= SQL drawing_norm)", () => {
    expect(normalizeDrawingNumber("pr 7075/20")).toBe("PR707520");
    expect(normalizeDrawingNumber(" PR-7075.20 ")).toBe("PR707520");
    expect(normalizeDrawingNumber("")).toBeNull();
    expect(unitClass("Ks")).toBe("piece");
    expect(unitClass("kg")).toBe("weight");
    expect(unitClass("kpl")).toBe("lot");
    expect(unitClass("m")).toBe("other");
  });

  it("ks × množství zakázky; plné pokrytí", () => {
    const v = quoteValue(NOVAK, ITEMS);
    expect(v).toMatchObject({ value: 12_200, basis: "prepocet_mnozstvi", coverage: { matched: 2, total: 2, uncovered: [] }, quantityMismatch: null });
  });

  it("kalení za kg × hmotnost × kusy; bez hmotnosti nejde porovnat („za kg“)", () => {
    expect(quoteValue(TEPKAL, [PRIRUBA])).toMatchObject({ value: 2_100, basis: "prepocet_mnozstvi" });
    const noWeight = quoteValue(TEPKAL, [{ ...PRIRUBA, weightKg: null }]);
    expect(noWeight).toMatchObject({ value: null, perKgNoWeight: true });
  });

  it("komplet (kpl) = cena × nabízené množství; jiné množství v ks se hlásí", () => {
    const kpl = quote({ id: "kpl", supplierName: "K", items: [{ drawingNumber: "PR-7075-20", name: "Sada", quantity: 1, unit: "kpl", unitPrice: 9_000, note: null }] });
    expect(quoteValue(kpl, [PRIRUBA])).toMatchObject({ value: 9_000 });
    const less = quote({ id: "q100", supplierName: "Q", items: [{ drawingNumber: "PR-7075-20", name: "Příruba", quantity: 100, unit: "ks", unitPrice: 45, note: null }] });
    expect(quoteValue(less, [PRIRUBA])).toMatchObject({ value: 9_000, quantityMismatch: { quoted: 100, ordered: 200, unit: "ks" } });
  });

  it("jen celková cena = plné pokrytí; částečná nabídka = část položek", () => {
    expect(quoteValue(quote({ id: "t", supplierName: "T", total: 14_000 }), ITEMS)).toMatchObject({ value: 14_000, basis: "celkem" });
    const half = quote({ id: "h", supplierName: "H", items: [{ drawingNumber: "PR-7075-20", name: "Příruba", quantity: 200, unit: "ks", unitPrice: 35, note: null }] });
    expect(quoteValue(half, ITEMS)).toMatchObject({ value: 7_000, basis: "cast_polozek", coverage: { matched: 1, total: 2, uncovered: [POUZDRO.id] } });
  });

  it("bez čísel výkresů se páruje po pořadí, když sedí počet; chybějící cena = nelze porovnat", () => {
    const anon = quote({ id: "a", supplierName: "A", items: [
      { drawingNumber: null, name: "díl 1", quantity: 200, unit: "ks", unitPrice: 10, note: null },
      { drawingNumber: null, name: "díl 2", quantity: 100, unit: "ks", unitPrice: 20, note: null },
    ] });
    expect(quoteValue(anon, ITEMS)).toMatchObject({ value: 4_000 });
    const unpriced = quote({ id: "u", supplierName: "U", items: [{ ...NOVAK.items[0], unitPrice: null }, NOVAK.items[1]] });
    expect(quoteValue(unpriced, ITEMS).value).toBeNull();
  });
});

describe("kdo to dělá — nejlevnější nabídka primárně", () => {
  it("obrábění: Novák je nejlevnější platná; prošlá levnější nevyhrává; vítěz z Nákupu je první alternativa s „dražší“", () => {
    const r = suggestWhoForStep({ step: { kind: "vyroba" }, quotes: [HRUBY, NOVAK, LEVNA_PROSLA, TEPKAL], ctx: CTX, canSeePrices: true });
    expect(r.primary).toMatchObject({
      source: "nejlevnejsi_nabidka", reason: "Nejlevnější nabídka", price: 12_200, supplierQuoteId: "novak",
      who: { type: "supplier", id: "sup-novak", name: "Frézy Novák s.r.o." },
    });
    expect(r.primary?.badges).toContain("nejlevnejsi");
    expect(r.alternatives[0]).toMatchObject({ supplierQuoteId: "hruby", diffToBest: 2_800 });
    expect(r.alternatives[0].reason).toBe("Vybraná v Nákupu (Petr Obchodník, 20. 10.) · o 2 800 Kč dražší");
    expect(r.alternatives[0].badges).toContain("vybrana");
    const prosla = r.alternatives.find((a) => a.supplierQuoteId === "levna");
    expect(prosla?.badges).toContain("vyprsela");
    expect(r.alternatives.some((a) => a.supplierQuoteId === "tepkal")).toBe(false);   // kalírna se na obrábění nehodí
    expect(r.warning).toBeNull();
  });

  it("jen prošlé nabídky → nejlevnější prošlá s varováním", () => {
    const r = suggestWhoForStep({ step: { kind: "vyroba" }, quotes: [LEVNA_PROSLA], ctx: CTX, canSeePrices: true });
    expect(r.primary).toMatchObject({ supplierQuoteId: "levna", expired: true, reason: "Jediná nabídka" });
    expect(r.warning).toBe("Nabídka vypršela 1. 10. — ověř cenu u dodavatele.");
  });

  it("nabídka v cizí měně nikdy není primární (bez kurzů), má štítek „jina_mena“", () => {
    const eur = quote({ id: "eur", supplierName: "Fräsen GmbH", currency: "EUR", note: "frézování",
      items: NOVAK.items.map((i) => ({ ...i, unitPrice: 1 })) });
    const r = suggestWhoForStep({ step: { kind: "vyroba" }, quotes: [eur, NOVAK], ctx: CTX, canSeePrices: true });
    expect(r.primary?.supplierQuoteId).toBe("novak");
    const alt = r.alternatives.find((a) => a.supplierQuoteId === "eur");
    expect(alt?.badges).toContain("jina_mena");
    expect(alt?.reason).toBe("v EUR — porovnej ručně");
    // jen nabídka v EUR: ani tak není primární — zůstane alternativou „v EUR — porovnej ručně"
    const only = suggestWhoForStep({ step: { kind: "vyroba" }, quotes: [eur], ctx: CTX, canSeePrices: true });
    expect(only.primary).toBeNull();
    expect(only.alternatives.map((a) => [a.supplierQuoteId, a.reason])).toEqual([["eur", "v EUR — porovnej ručně"]]);
    const withHistory = suggestWhoForStep({ step: { kind: "vyroba" }, quotes: [eur], ctx: CTX, canSeePrices: true,
      history: { operations: [{ kind: "vyroba", inHouse: true, supplierId: null, supplierName: null, jobNumber: "Z-2026-090", material: null }] } });
    expect(withHistory.primary).toMatchObject({ source: "posledni_operace", who: { type: "u_nas" } });
    // nesrovnatelná v CZK (bez ceny) před cizí měnou
    const noPrice = quote({ id: "np", supplierName: "Bez ceny", note: "frézování", items: NOVAK.items.map((i) => ({ ...i, unitPrice: null })) });
    expect(suggestWhoForStep({ step: { kind: "vyroba" }, quotes: [eur, noPrice], ctx: CTX, canSeePrices: true }).primary)
      .toMatchObject({ source: "nabidka", supplierQuoteId: "np", reason: "Nabídka bez porovnatelné ceny — porovnej ručně" });
  });

  it("nabídka za 0 Kč (chybějící cena) nevyhraje „Nejlevnější nabídka“", () => {
    const zero = quote({ id: "zero", supplierName: "Nula s.r.o.", note: "frézování", total: 0 });
    const r = suggestWhoForStep({ step: { kind: "vyroba" }, quotes: [zero, NOVAK], ctx: CTX, canSeePrices: true });
    expect(r.primary).toMatchObject({ supplierQuoteId: "novak", reason: "Jediná nabídka" });
    expect(rankQuotesForStep({ kind: "vyroba" }, [zero, NOVAK], CTX).comparable.map((x) => x.quote.id)).toEqual(["novak"]);
  });

  it("poznámka položky s požadavky výkresu (kalit, povrch Ra) neurčuje, na co je nabídka", () => {
    const hrubyCheap = quote({ id: "hc", supplierName: "Hrubý", note: null, items: [
      { drawingNumber: "PR-7075-20", name: "Příruba", quantity: 200, unit: "ks", unitPrice: 30, note: "1.2379, kalit 58–60 HRC dle výkresu" },
      { drawingNumber: "PR-7075-21", name: "Pouzdro", quantity: 100, unit: "ks", unitPrice: 30, note: "povrch Ra 0,8" },
    ] });
    expect(quoteKinds(hrubyCheap)).toEqual({ kinds: [], source: "unknown" });
    const r = suggestWhoForStep({ step: { kind: "vyroba" }, quotes: [hrubyCheap, NOVAK], ctx: CTX, canSeePrices: true });
    expect(r.primary).toMatchObject({ supplierQuoteId: "hc", reason: "Nejlevnější nabídka", price: 9_000 });
    expect(rankQuotesForStep({ kind: "tepelne_zpracovani" }, [hrubyCheap], CTX).comparable).toEqual([]);
    // materiál není povrchová úprava; pochromování / niklování / povrchová úprava ano
    expect(operationKindsOfText("Materiál 1.4301 chromniklová ocel, frézování")).toEqual(["frezovani"]);
    expect(operationKindsOfText("povrch Ra 0,8")).toEqual([]);
    expect(operationKindsOfText("pochromování")).toEqual(["povrchova_uprava"]);
    expect(operationKindsOfText("tvrdý chrom 20 µm")).toEqual(["povrchova_uprava"]);
    expect(operationKindsOfText("chemické niklování")).toEqual(["povrchova_uprava"]);
    expect(operationKindsOfText("Povrchová úprava: černění")).toEqual(["povrchova_uprava"]);
  });

  it("pořadí nezávisí na pořadí vstupu (remíza = stejná cena v celých Kč)", () => {
    const mk = (id: string, total: number, deliveryDate: string) => quote({ id, supplierName: id, note: "frézování", total, deliveryDate });
    const A = mk("A", 100.0, "2026-11-20");
    const B = mk("B", 100.4, "2026-11-10");
    const C = mk("C", 100.8, "2026-11-01");
    const perms = [[A, B, C], [A, C, B], [B, A, C], [B, C, A], [C, A, B], [C, B, A]];
    const orders = new Set(perms.map((p) => rankQuotesForStep({ kind: "frezovani" }, p, CTX).comparable.map((x) => x.quote.id).join("")));
    expect([...orders]).toEqual(["BAC"]);   // 100 Kč: B (10. 11.) před A (20. 11.); 101 Kč: C
  });

  it("částečné pokrytí je za plným, i když je levnější; štítek „cast“", () => {
    const half = quote({ id: "half", supplierName: "Půlka s.r.o.", note: "frézování",
      items: [{ drawingNumber: "PR-7075-20", name: "Příruba", quantity: 200, unit: "ks", unitPrice: 20, note: null }] });
    const ranked = rankQuotesForStep({ kind: "vyroba" }, [half, NOVAK], CTX);
    expect(ranked.comparable.map((r) => r.quote.id)).toEqual(["novak", "half"]);
    const r = suggestWhoForStep({ step: { kind: "vyroba" }, quotes: [half, NOVAK], ctx: CTX, canSeePrices: true });
    expect(r.alternatives.find((a) => a.supplierQuoteId === "half")?.badges).toContain("cast");
  });

  it("remíza do 0,5 Kč → dřívější dodání; pak firma souseda v postupu; pak hodnocení", () => {
    const a = quote({ ...NOVAK, id: "a", supplierName: "Alfa", leadTimeDays: 30 });
    const b = quote({ ...NOVAK, id: "b", supplierName: "Beta", leadTimeDays: 10, items: NOVAK.items.map((i, k) => ({ ...i, unitPrice: k === 0 ? 40.001 : 42 })) });
    expect(rankQuotesForStep({ kind: "vyroba" }, [a, b], CTX).comparable.map((r) => r.quote.id)).toEqual(["b", "a"]);
    const c = quote({ ...NOVAK, id: "c", supplierId: "sup-c", supplierName: "Cé", leadTimeDays: 21, supplierRating: 5 });
    const d = quote({ ...NOVAK, id: "d", supplierId: "sup-d", supplierName: "Dé", leadTimeDays: 21, supplierRating: 2 });
    expect(rankQuotesForStep({ kind: "vyroba" }, [d, c], CTX).comparable.map((r) => r.quote.id)).toEqual(["c", "d"]);
    expect(rankQuotesForStep({ kind: "vyroba" }, [c, d], { ...CTX, neighbourSupplierIds: ["sup-d"] }).comparable.map((r) => r.quote.id)).toEqual(["d", "c"]);
  });

  it("kalení dílu jen pro příruby: jediná porovnatelná nabídka TepKal za kg", () => {
    const r = suggestWhoForStep({ step: { kind: "tepelne_zpracovani", orderItemIds: [PRIRUBA.id] }, quotes: [HRUBY, NOVAK, TEPKAL], ctx: CTX, canSeePrices: true });
    expect(r.primary).toMatchObject({ supplierQuoteId: "tepkal", reason: "Jediná nabídka", price: 2_100 });
    expect(r.primary?.badges).toContain("nejlevnejsi");
    expect(r.alternatives).toEqual([]);
  });

  it("existující otevřená objednávka z Nákupu má přednost (nevystavuje se druhá)", () => {
    const r = suggestWhoForStep({
      step: { kind: "vyroba" }, quotes: [NOVAK, HRUBY], ctx: CTX, canSeePrices: true,
      openPurchaseOrders: [{ id: "po1", number: "OV-2026-012", status: "odeslana", supplierId: "sup-hruby", supplierName: "Kovoobrábění Hrubý s.r.o.",
        supplierQuoteId: "hruby", requiredDate: "2026-11-13", confirmedDate: null, kinds: ["kompletni_dodavka"] }],
    });
    expect(r.primary).toMatchObject({ source: "objednavka", purchaseOrder: { id: "po1", number: "OV-2026-012", status: "odeslana" } });
    expect(r.primary?.reason).toBe("Použije se vystavená objednávka OV-2026-012 (Kovoobrábění Hrubý s.r.o., odeslaná)");
    // nabídka téže firmy se znovu nenabízí (výběr by chtěl druhou objednávku u Hrubého = po_duplicate)
    expect(r.alternatives.map((a) => a.supplierQuoteId)).toEqual(["novak"]);
  });

  it("bez nabídky: poslední dodavatel výkresu → poslední operace u materiálu → technologie → nic", () => {
    const base = { step: { kind: "tepelne_zpracovani" as const, orderItemIds: [PRIRUBA.id] }, quotes: [], ctx: CTX, canSeePrices: true };
    const drawings = [{ drawingNumber: "PR 7075-20", supplierId: "s-kal", supplierName: "Kalírna XY", poNumber: "OV-2026-031", orderDate: "2026-09-14", unitPrice: 9.5, kind: "tepelne_zpracovani" as const }];
    expect(suggestWhoForStep({ ...base, history: { drawings } }).primary).toMatchObject({
      source: "posledni_vykres", reason: "Naposledy dělal výkres PR 7075-20: Kalírna XY (OV-2026-031, 14. 9. 2026) · naposledy 9,50 Kč/ks",
    });
    const operations = [{ kind: "tepelne_zpracovani" as const, inHouse: false, supplierId: "s-tk", supplierName: "TepKal s.r.o.", jobNumber: "Z-2026-088", material: "1.2379" }];
    expect(suggestWhoForStep({ ...base, history: { operations } }).primary).toMatchObject({
      source: "posledni_operace", reason: "Naposledy dělal tepelné zpracování 1.2379: TepKal s.r.o. (Z-2026-088)",
    });
    expect(suggestWhoForStep({ ...base, history: { operations: [{ ...operations[0], inHouse: true }] } }).primary?.reason)
      .toBe("Naposledy jsme to dělali u nás (Z-2026-088)");
    const suppliers = [
      { id: "s1", name: "Kalírna A", technologies: ["Kalení", "Nitridace"], leadDays: 5, rating: 4 },
      { id: "s2", name: "Obrobna B", technologies: ["frezovani_3osy", "tepelne_zpracovani"], leadDays: 3, rating: 5 },
    ];
    expect(suggestWhoForStep({ ...base, history: { suppliers } }).primary).toMatchObject({ source: "technologie", reason: "Umí: Kalení, Nitridace · obvykle 5 dní" });
    const none = suggestWhoForStep(base);
    expect(none.primary).toBeNull();
    expect(none.message).toBe("K tomuto kroku nemáme nabídku — vyber firmu, nebo „U nás“.");
  });

  it("bez práva na marže: žádné částky ani rozdíly, popisek „Doporučeno podle nabídek“", () => {
    const r = suggestWhoForStep({ step: { kind: "vyroba" }, quotes: [HRUBY, NOVAK, LEVNA_PROSLA], ctx: CTX, canSeePrices: false });
    expect(r.primary).toMatchObject({ reason: "Doporučeno podle nabídek", price: null, diffToBest: null });
    for (const a of r.alternatives) {
      expect(a.price).toBeNull();
      expect(a.diffToBest).toBeNull();
      expect(a.reason).not.toMatch(/Kč/);
    }
    expect(r.alternatives[0].reason).toBe("Vybraná v Nákupu (Petr Obchodník, 20. 10.)");
  });
});

describe("termín kroku", () => {
  it("explicitní termín z nabídky má přednost před lhůtou", () => {
    expect(suggestStepDeadline({ today: TODAY, quote: { deliveryDate: "2026-11-10", leadTimeDays: 21 } }))
      .toEqual({ date: "2026-11-10", source: "nabidka_dodavatele", caption: "z nabídky (termín 10. 11.)", state: "odhad" });
    expect(suggestStepDeadline({ today: TODAY, quote: { deliveryDate: null, leadTimeDays: 21 } }))
      .toEqual({ date: "2026-11-13", source: "nabidka_dodavatele", caption: "z nabídky (3 týdny)", state: "odhad" });
  });

  it("další krok u jiné firmy: od konce předchozího + 1 pracovní den na dopravu", () => {
    // výroba končí pá 13. 11. → doprava po 16. 11. → kalení 5 dní → 21. 11.
    expect(suggestStepDeadline({ today: TODAY, previousEnd: "2026-11-13", performerChanged: true, quote: { deliveryDate: null, leadTimeDays: 5 } }))
      .toMatchObject({ date: "2026-11-21", caption: "z nabídky (5 dní) + 1 den doprava" });
    // termín z nabídky před koncem předchozího kroku se nepoužije
    expect(suggestStepDeadline({ today: TODAY, previousEnd: "2026-11-13", quote: { deliveryDate: "2026-11-01", leadTimeDays: null }, supplierLeadDays: 7 }))
      .toMatchObject({ date: "2026-11-20", source: "lhuta_dodavatele", caption: "obvyklá lhůta dodavatele (1 týden)" });
  });

  it("poslední krok: konečný termín − 3 pracovní dny (28. 10. je svátek)", () => {
    expect(suggestStepDeadline({ today: TODAY, isLast: true, finalDate: "2026-10-30" }))
      .toEqual({ date: "2026-10-26", source: "termin_zakaznika", caption: "konečný termín − 3 pracovní dny", state: "odhad" });
  });

  it("bez podkladů odhad +5 pracovních dní; u nás stav „plán“", () => {
    // pá 23. 10. + 5 prac. dní: 26., 27., (28. svátek), 29., 30., 2. 11.
    expect(suggestStepDeadline({ today: TODAY, inHouse: true }))
      .toEqual({ date: "2026-11-02", source: "odhad", caption: "odhad (+5 pracovních dní) — uprav podle dohody", state: "plan" });
  });

  it("lhůta slovy", () => {
    expect(leadTimeLabel(1)).toBe("1 den");
    expect(leadTimeLabel(3)).toBe("3 dny");
    expect(leadTimeLabel(5)).toBe("5 dní");
    expect(leadTimeLabel(7)).toBe("1 týden");
    expect(leadTimeLabel(21)).toBe("3 týdny");
    expect(leadTimeLabel(35)).toBe("5 týdnů");
    expect(money(14_300)).toBe("14 300 Kč");
    expect(money(8.75, "EUR")).toBe("8,75 EUR");
  });
});

describe("postup z výkresu a nabídek", () => {
  it("nejlevnější kompletní postup: Novák + TepKal (14 300) proti kompletně u Hrubého (15 000); kalení jen pro přírubu", () => {
    const r = suggestRoute({ items: ITEMS, quotes: [HRUBY, NOVAK, LEVNA_PROSLA, TEPKAL], currency: "CZK", today: TODAY, canSeePrices: true });
    expect(r.source).toBe("nabidky");
    expect(r.banner).toBe("Nejlevnější postup: Frézy Novák + TepKal 14 300 Kč (kompletně u Kovoobrábění Hrubý 15 000 Kč)");
    expect(r.steps.map((s) => [s.kind, s.supplierQuoteId, s.orderItemIds])).toEqual([
      ["vyroba", "novak", null],
      ["tepelne_zpracovani", "tepkal", [PRIRUBA.id]],
    ]);
    expect(r.steps[1].note).toBe("kalit 58–60 HRC");
    expect(r.chips).toEqual(["+ Tepelné zpracování (výkres: kalit 58–60 HRC)"]);
    expect(r.routes.find((x) => x.selected)?.total).toBe(14_300);
  });

  it("dražší rozdělený postup prohraje s kompletní dodávkou; remíza → méně kroků", () => {
    const drahyNovak = quote({ ...NOVAK, items: NOVAK.items.map((i) => ({ ...i, unitPrice: 50 })) }); // 15 000 + 2 100
    const r = suggestRoute({ items: ITEMS, quotes: [HRUBY, drahyNovak, TEPKAL], currency: "CZK", today: TODAY, canSeePrices: true });
    expect(r.steps.map((s) => s.kind)).toEqual(["kompletni_dodavka"]);
    const tie = quote({ ...HRUBY, total: 14_300, items: HRUBY.items.map((i, k) => ({ ...i, unitPrice: k === 0 ? 49 : 45 })) }); // 9 800 + 4 500
    expect(suggestRoute({ items: ITEMS, quotes: [tie, NOVAK, TEPKAL], currency: "CZK", today: TODAY, canSeePrices: true }).steps.map((s) => s.kind))
      .toEqual(["kompletni_dodavka"]);
  });

  it("připravené kroky mají přednost; bez prav na marže bez částek", () => {
    const planned = [{ kind: "vyroba" as const, orderItemIds: null, note: null, supplierQuoteId: null, who: { type: "u_nas" as const }, operationId: "op1" }];
    expect(suggestRoute({ items: ITEMS, plannedSteps: planned, quotes: [NOVAK], currency: "CZK", today: TODAY, canSeePrices: true }))
      .toMatchObject({ source: "planovane", steps: planned, banner: "Podle připraveného postupu — zkontroluj a potvrď." });
    const r = suggestRoute({ items: ITEMS, quotes: [HRUBY, NOVAK, TEPKAL], currency: "CZK", today: TODAY, canSeePrices: false });
    expect(r.banner).toBe("Doporučený postup podle nabídek: Frézy Novák → TepKal");
    expect(r.routes.every((x) => x.total === null)).toBe(true);
  });

  it("bez nabídek podle výkresu: výroba + kalení (+ povrch zinek)", () => {
    const items = [PRIRUBA, { ...POUZDRO, surfaceTreatment: "zinek žlutý" }];
    const r = suggestRoute({ items, quotes: [], currency: "CZK", today: TODAY, canSeePrices: true });
    expect(r.source).toBe("vykres");
    expect(r.steps.map((s) => [s.kind, s.orderItemIds])).toEqual([
      ["vyroba", null], ["tepelne_zpracovani", [PRIRUBA.id]], ["povrchova_uprava", [POUZDRO.id]],
    ]);
    expect(r.banner).toBe("Předvyplnila AI podle nabídek dodavatelů a výkresu — zkontroluj a potvrď.");
    expect(r.chips).toContain("+ Povrchová úprava (zinek žlutý)");
    expect(suggestRoute({ items: [POUZDRO], quotes: [], currency: "CZK", today: TODAY, canSeePrices: true }))
      .toMatchObject({ source: "vychozi", chips: ["+ Výroba"] });
  });
});

describe("objednávka dodavateli pro krok", () => {
  it("kalení: jen příruba, převod na kg, poznámka z výkresu, vazba na díl", () => {
    const r = purchaseItemsForStep({ step: { kind: "tepelne_zpracovani", orderItemIds: [PRIRUBA.id] }, items: ITEMS, quote: TEPKAL });
    expect(r.items).toEqual([{
      drawingNumber: "PR-7075-20", name: "Příruba — tepelné zpracování", material: "1.2379", quantity: 240, unit: "kg", unitPrice: 8.75,
      note: "200 ks · 1.2379 · kalit 58–60 HRC · 1,2 kg/ks", orderItemId: PRIRUBA.id,
    }]);
    expect(r.uncovered).toEqual([]);
  });

  it("cena za kg bez hmotnosti → bez ceny s poznámkou, ať se dopočítá", () => {
    const r = purchaseItemsForStep({ step: { kind: "tepelne_zpracovani", orderItemIds: [PRIRUBA.id] }, items: [{ ...PRIRUBA, weightKg: null }], quote: TEPKAL });
    expect(r.items[0]).toMatchObject({ quantity: 200, unit: "ks", unitPrice: null });
    expect(r.items[0].note).toContain("cena 8,75 Kč/kg dle nabídky N-tepkal");
  });

  it("díly mimo nabídku: vynechat (další krok) nebo objednat bez ceny", () => {
    const half = quote({ id: "h", supplierName: "H", items: [{ drawingNumber: "PR-7075-20", name: "Příruba", quantity: 200, unit: "ks", unitPrice: 35, note: null }] });
    const out = purchaseItemsForStep({ step: { kind: "vyroba" }, items: ITEMS, quote: half });
    expect(out.items.map((i) => [i.orderItemId, i.unitPrice])).toEqual([[PRIRUBA.id, 35]]);
    expect(out.uncovered).toEqual([POUZDRO.id]);
    const all = purchaseItemsForStep({ step: { kind: "vyroba" }, items: ITEMS, quote: half, includeUncovered: true });
    expect(all.items.map((i) => [i.orderItemId, i.unitPrice, i.note?.startsWith("mimo nabídku")])).toEqual([[PRIRUBA.id, 35, false], [POUZDRO.id, null, true]]);
  });

  it("bez nabídky: položky zakázky; nákupní cena jen u jediného výrobního kroku; upravené množství", () => {
    const single = purchaseItemsForStep({ step: { kind: "vyroba" }, items: ITEMS, singleStepRoute: true, quantities: { [POUZDRO.id]: 120 } });
    expect(single.items.map((i) => [i.name, i.quantity, i.unitPrice])).toEqual([["Příruba", 200, null], ["Pouzdro", 120, 35]]);
    const multi = purchaseItemsForStep({ step: { kind: "vyroba" }, items: ITEMS, singleStepRoute: false });
    expect(multi.items.every((i) => i.unitPrice === null)).toBe(true);
  });

  it("nabídka jen s celkovou cenou: jeden díl → cena/ks, víc dílů → bez cen s upozorněním", () => {
    const tot = quote({ id: "t", supplierName: "T", total: 2_000 });
    expect(purchaseItemsForStep({ step: { kind: "tepelne_zpracovani", orderItemIds: [PRIRUBA.id] }, items: ITEMS, quote: tot }).items[0].unitPrice).toBe(10);
    const many = purchaseItemsForStep({ step: { kind: "vyroba" }, items: ITEMS, quote: tot });
    expect(many.items.every((i) => i.unitPrice === null)).toBe(true);
    expect(many.warnings).toEqual(["Nabídka dodavatele má jen celkovou cenu — doplň ceny jednotlivých položek."]);
    // upravené množství v dialogu: cena za kus z celkové ceny a množství, na které je nabídka (ne 2 000 / 120)
    const edited = purchaseItemsForStep({ step: { kind: "tepelne_zpracovani", orderItemIds: [PRIRUBA.id] }, items: ITEMS, quote: tot, quantities: { [PRIRUBA.id]: 120 } });
    expect(edited.items.map((i) => [i.quantity, i.unitPrice])).toEqual([[120, 10]]);
    const unpricedItems = quote({ id: "u", supplierName: "U", total: 10_000,
      items: [{ drawingNumber: "PR-7075-20", name: "Příruba", quantity: 250, unit: "ks", unitPrice: null, note: null }] });
    expect(purchaseItemsForStep({ step: { kind: "vyroba", orderItemIds: [PRIRUBA.id] }, items: ITEMS, quote: unpricedItems, quantities: { [PRIRUBA.id]: 120 } })
      .items.map((i) => [i.quantity, i.unitPrice])).toEqual([[120, 40]]);
  });

  it("jedna nabídka na obrábění i kalení = jeden krok a jedna cena v postupu", () => {
    const both = quote({ id: "fk", supplierName: "Fréza a Kalírna s.r.o.", note: "Frézování + kalení", items: [
      { drawingNumber: "PR-7075-20", name: "Příruba", quantity: 200, unit: "ks", unitPrice: 50, note: null },
      { drawingNumber: "PR-7075-21", name: "Pouzdro", quantity: 100, unit: "ks", unitPrice: 50, note: null },
    ] });
    const r = suggestRoute({ items: ITEMS, quotes: [both], currency: "CZK", today: TODAY, canSeePrices: true });
    expect(r.steps.map((s) => [s.kind, s.supplierQuoteId])).toEqual([["vyroba", "fk"]]);
    expect(r.steps[0].note).toBe("vč. tepelného zpracování (kalit 58–60 HRC)");
    expect(r.routes.find((x) => x.key === "rodiny")?.total).toBe(15_000);
    expect(r.banner).toBe("Nejlevnější postup: Fréza a Kalírna 15 000 Kč");
    // krok po kroku: nabídka už použitá jiným krokem se nenabízí znovu
    expect(rankQuotesForStep({ kind: "tepelne_zpracovani" }, [both], { ...CTX, excludeQuoteIds: ["fk"] }).comparable).toEqual([]);
  });

  it("poznámka objednávky: zakázka, výkresy, operace a navazující krok (slovo „mezitermín“ nikdy)", () => {
    const note = stepPurchaseOrderNote({
      jobNumber: "Z-2026-104", drawings: ["PR-7075-20"], stepLabel: "Tepelné zpracování", stepNo: 2, stepCount: 3,
      next: { label: "Výroba 2", elsewhere: true },
    });
    expect(note).toBe("Objednávka k naší zakázce Z-2026-104. Výroba dle výkresů: PR-7075-20. Operace: Tepelné zpracování (krok 2 ze 3). Navazuje: Výroba 2 — termín prosíme dodržet.");
    expect(note).not.toMatch(/mezitermín/i);
    expect(stepPurchaseOrderNote({ jobNumber: "Z-1", drawings: [], stepLabel: "Výroba", stepNo: 1, stepCount: 1 })).toBe("Objednávka k naší zakázce Z-1. Operace: Výroba.");
  });
});
