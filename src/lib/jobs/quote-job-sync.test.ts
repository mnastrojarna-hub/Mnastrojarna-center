import { describe, it, expect } from "vitest";
import {
  currentOffer, offerSyncMessage, parseOfferSyncState, planOfferDueDate, planOfferItems,
  type OfferJobItem, type OfferQuoteItem, type OfferSyncState,
} from "@/lib/jobs/quote-job-sync";

function qi(position: number, p: Partial<OfferQuoteItem> = {}): OfferQuoteItem {
  return {
    position, drawingId: null, drawingNumber: null, name: null, description: null, material: null,
    quantity: 1, unit: "ks", unitPrice: null, purchaseUnitPrice: null, ...p,
  };
}
function ji(id: string, position: number, p: Partial<OfferJobItem> = {}): OfferJobItem {
  return { id, position, drawingNumber: null, name: null, quantity: 1, unitPrice: null, purchaseUnitPrice: null, ...p };
}
const PREV = (p: Partial<OfferSyncState> = {}): OfferSyncState => ({
  quoteId: "q1", number: "NAB-1", itemsKey: "k", dueDate: null, leadDays: 31, at: "2026-11-03T10:00:00Z", ...p,
});

describe("aktuální nabídka zakázky", () => {
  const q = (id: string, p: Record<string, unknown> = {}) => ({ id, status: "ke_schvaleni", state: "ke_schvaleni", archived: false, revision: 1, createdAt: "2026-11-01T10:00:00Z", ...p });

  it("přijatá nabídka má přednost i před novější verzí", () => {
    const list = [q("a", { revision: 1, status: "prijato", state: "prijata" }), q("b", { revision: 2 })];
    expect(currentOffer(list, null)?.id).toBe("a");
    expect(currentOffer([q("a", { revision: 1, archived: true }), q("b", { revision: 2 })], "a")?.id).toBe("a");
  });

  it("jinak nejnovější platná verze — bez archivních a zamítnutých", () => {
    const list = [
      q("r1", { revision: 1, archived: true }),
      q("r2", { revision: 2 }),
      q("r3", { revision: 3, status: "zamitnuto", state: "zamitnuta" }),
      q("r4", { revision: 4, state: "archivovana" }),
    ];
    expect(currentOffer(list, null)?.id).toBe("r2");
  });

  it("zamítnutá přijatá (quote_id zůstal) zakázku neřídí; bez platné nabídky null", () => {
    expect(currentOffer([q("x", { status: "zamitnuto", state: "zamitnuta" })], "x")).toBeNull();
    expect(currentOffer([q("x", { archived: true })], null)).toBeNull();
    expect(currentOffer([], null)).toBeNull();
  });

  it("stejná revize → novější podle založení", () => {
    const list = [q("old", { revision: 1, createdAt: "2026-11-01T10:00:00Z" }), q("new", { revision: 1, createdAt: "2026-11-02T10:00:00Z" })];
    expect(currentOffer(list, null)?.id).toBe("new");
  });
});

describe("položky nabídky → zakázka", () => {
  it("zakázka bez položek: všechny položky nabídky (pozice od 0, ceny i nákup)", () => {
    const plan = planOfferItems([], [
      qi(2, { drawingNumber: "C", unitPrice: 30 }),
      qi(0, { drawingNumber: "A", name: "Příruba", unitPrice: 16830, purchaseUnitPrice: 9000, quantity: 1 }),
      qi(1, { drawingNumber: "B", unitPrice: 8540 }),
    ]);
    expect(plan.fromScratch).toBe(true);
    expect(plan.create.map((c) => [c.drawingNumber, c.position])).toEqual([["A", 0], ["B", 1], ["C", 2]]);
    expect(plan.create[0]).toMatchObject({ unitPrice: 16830, purchaseUnitPrice: 9000, name: "Příruba" });
    expect(plan.update).toEqual([]);
  });

  it("zakázka s položkami: ceny podle nabídky, počty zůstanou, chybějící přibude, vlastní položka zůstane", () => {
    const job = [
      ji("j1", 0, { drawingNumber: "A", quantity: 10, unitPrice: 100 }),
      ji("j2", 1, { drawingNumber: "B", quantity: 5, unitPrice: 50, purchaseUnitPrice: 20 }),
      ji("j3", 2, { drawingNumber: "Z", quantity: 1, unitPrice: 7 }), // jen v zakázce
    ];
    const quote = [
      qi(0, { drawingNumber: "A", quantity: 12, unitPrice: 120, purchaseUnitPrice: 60 }),
      qi(1, { drawingNumber: "B", quantity: 5, unitPrice: 50, purchaseUnitPrice: 25 }),
      qi(2, { drawingNumber: "C", quantity: 3, unitPrice: 40 }),
    ];
    const plan = planOfferItems(job, quote);
    expect(plan.fromScratch).toBe(false);
    // A: nová cena + doplněná nákupní; B: beze změny (nákupní v zakázce už je)
    expect(plan.update).toEqual([{ id: "j1", unitPrice: 120, purchaseUnitPrice: 60 }]);
    expect(plan.pricesUpdated).toBe(1);
    expect(plan.purchaseFilled).toBe(1);
    expect(plan.create.map((c) => [c.drawingNumber, c.position, c.quantity])).toEqual([["C", 3, 3]]);
  });

  it("položka nabídky bez ceny cenu zakázky nemaže; prázdná nabídka nic", () => {
    const plan = planOfferItems([ji("j1", 0, { drawingNumber: "A", unitPrice: 100 })], [qi(0, { drawingNumber: "A", unitPrice: null })]);
    expect(plan.update).toEqual([]);
    expect(planOfferItems([ji("j1", 0)], [])).toMatchObject({ create: [], update: [] });
  });

  it("párování podle názvu a pozice (bez výkresů)", () => {
    const plan = planOfferItems(
      [ji("j1", 0, { name: "Hřídel" }), ji("j2", 1, { name: "Deska" })],
      [qi(0, { name: "Deska", unitPrice: 5 }), qi(1, { name: "Hřídel", unitPrice: 9 })],
    );
    expect(plan.update).toEqual([{ id: "j1", unitPrice: 9 }, { id: "j2", unitPrice: 5 }]);
    expect(plan.create).toEqual([]);
  });
});

describe("termín dodání z nabídky", () => {
  const base = { stage: "nabidka", jobDueDate: null, previous: null, leadDays: 31, orderDate: null, quoteDate: "2026-11-03" };

  it("prázdný termín = odeslání nabídky + lhůta (3. 11. + 31 dní = 4. 12.)", () => {
    expect(planOfferDueDate(base)).toMatchObject({ computed: "2026-12-04", set: "2026-12-04", base: "quote", derived: true });
  });

  it("lhůta běží od data objednávky, je-li", () => {
    expect(planOfferDueDate({ ...base, orderDate: "2026-11-10" })).toMatchObject({ set: "2026-12-11", base: "order" });
  });

  it("termín odvozený z dřívější nabídky se posune, ruční termín nikdy", () => {
    expect(planOfferDueDate({ ...base, jobDueDate: "2026-12-01", previous: PREV({ dueDate: "2026-12-01" }) }).set).toBe("2026-12-04");
    expect(planOfferDueDate({ ...base, jobDueDate: "2026-12-20", previous: PREV({ dueDate: "2026-12-01" }) })).toMatchObject({ set: null, derived: false });
    expect(planOfferDueDate({ ...base, jobDueDate: "2026-12-20", previous: null }).set).toBeNull();
  });

  it("bez lhůty, bez data nebo u dodané / uzavřené zakázky nic", () => {
    expect(planOfferDueDate({ ...base, leadDays: null }).set).toBeNull();
    expect(planOfferDueDate({ ...base, leadDays: 0 }).set).toBeNull();
    expect(planOfferDueDate({ ...base, quoteDate: null }).set).toBeNull();
    expect(planOfferDueDate({ ...base, stage: "dodano_zakaznikovi" }).set).toBeNull();
    expect(planOfferDueDate({ ...base, stage: "dokonceno" }).set).toBeNull();
    // stejný termín = nic k zápisu
    expect(planOfferDueDate({ ...base, jobDueDate: "2026-12-04", previous: PREV({ dueDate: "2026-12-04" }) }).set).toBeNull();
  });
});

describe("stav a zpráva propsání", () => {
  it("stav z DB (neplatný = null)", () => {
    expect(parseOfferSyncState(null)).toBeNull();
    expect(parseOfferSyncState({ number: "x" })).toBeNull();
    expect(parseOfferSyncState({ quoteId: "q", itemsKey: "k", dueDate: "2026-12-04", leadDays: 31 })).toMatchObject({ quoteId: "q", dueDate: "2026-12-04", leadDays: 31 });
    expect(parseOfferSyncState({ quoteId: "q", dueDate: "nesmysl" })?.dueDate).toBeNull();
  });

  it("jedna věta do historie", () => {
    const plain = (t: string) => t.replace(/\s/g, " ");
    expect(plain(offerSyncMessage({
      number: "NAB-2026-011", fromScratch: true, created: 8, pricesUpdated: 0, purchaseFilled: 0,
      value: 96100, valueChanged: true, dueDate: "2026-12-04",
    }))).toBe("Z nabídky NAB-2026-011 doplněno: 8 položek, hodnota 96 100 Kč, termín dodání 4. 12. 2026");
    expect(plain(offerSyncMessage({
      number: "NAB-7", fromScratch: false, created: 1, pricesUpdated: 2, purchaseFilled: 0,
      value: 500, valueChanged: true, dueDate: null,
    }))).toBe("Z nabídky NAB-7 srovnáno: přidána 1 položka, ceny 2 položek, hodnota 500 Kč");
  });
});
