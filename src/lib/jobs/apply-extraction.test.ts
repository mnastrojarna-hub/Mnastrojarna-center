import { describe, it, expect } from "vitest";
import type { CaptureDocKind, DocIssuer, ExtractedBusinessDoc } from "./capture-types";
import type { JobItem } from "./types";
import type { JobStage } from "@/lib/supabase/database.types";
import { docKindToStage, planJobUpdate, planNewJob, planFieldMeta, type JobSnapshot } from "./apply-extraction";
import { normalizeExtracted } from "./extracted-normalize";
import objednavkaFixture from "./__fixtures__/capture/objednavka-strojmetal.json";
import poptavkaFixture from "./__fixtures__/capture/poptavka-novy-zakaznik.json";
import dodaciListFixture from "./__fixtures__/capture/dodaci-list-dodavatel.json";

function doc(over: Record<string, unknown>): ExtractedBusinessDoc {
  return normalizeExtracted(over);
}

function item(over: Partial<JobItem> & { id: string }): JobItem {
  return {
    position: 0, drawingNumber: null, revision: null, name: null, description: null, material: null,
    quantity: 0, unit: "ks", unitPrice: null, purchaseUnitPrice: null, note: null, ...over,
  };
}

function snapshot(over: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    stage: "poptavka", title: "", customer: { id: "c1", name: "Strojmetal a.s.", customerNumber: "ZAK-0001", ico: "45274649" },
    customerOrderNumber: null, customerInquiryNumber: null,
    customerContact: null, customerContactEmail: null, customerContactPhone: null,
    inquiryDate: null, orderDate: null, customerRequiredDate: null, dueDate: null,
    expectedDeliveryDate: null, supplierPromisedDate: null, value: null, items: [],
    supplier: null, supplierOrderNumber: null, invoiceNumber: null, deliveryNoteNumber: null,
    ...over,
  };
}

const PO = normalizeExtracted(objednavkaFixture);
const RFQ = normalizeExtracted(poptavkaFixture);
const SUPPLIER_DL = normalizeExtracted(dodaciListFixture);

describe("docKindToStage", () => {
  const cases: [CaptureDocKind, DocIssuer, JobStage | null][] = [
    ["poptavka", "zakaznik", "poptavka"],
    ["poptavka", "neznamy", "poptavka"],
    ["poptavka", "my", "naceneni"],
    ["poptavka", "dodavatel", null],
    ["nabidka", "my", "nabidka"],
    ["nabidka", "dodavatel", "naceneni"],
    ["nabidka", "zakaznik", null],
    ["nabidka", "neznamy", null],
    ["objednavka", "zakaznik", "objednavka"],
    ["objednavka", "neznamy", "objednavka"],
    ["objednavka", "my", null],
    ["objednavka", "dodavatel", null],
    ["potvrzeni", "my", "potvrzeno"],
    ["potvrzeni", "dodavatel", "ve_vyrobe"],
    ["potvrzeni", "zakaznik", null],
    ["potvrzeni", "neznamy", null],
    ["dodaci_list", "dodavatel", "dodano_k_nam"],
    ["dodaci_list", "my", "dodano_zakaznikovi"],
    ["dodaci_list", "neznamy", null],
    ["dodaci_list", "zakaznik", null],
    ["faktura", "my", "fakturovano"],
    ["faktura", "dodavatel", null],
    ["faktura", "neznamy", null],
    ["vykres", "zakaznik", null],
    ["ostatni", "my", null],
  ];
  it.each(cases)("%s od %s → %s", (kind, issuer, stage) => {
    expect(docKindToStage(kind, issuer)).toBe(stage);
  });
});

describe("planJobUpdate — objednávka zákazníka (fixture)", () => {
  it("vyplní prázdná pole, přidá položky, posune stav na objednávku", () => {
    const plan = planJobUpdate(snapshot({ stage: "nabidka" }), PO);
    expect(plan.patch).toEqual({
      customerOrderNumber: "4795-2026",
      customerContact: "Ing. Jan Dvořák",
      customerContactEmail: "dvorak@strojmetal.cz",
      customerContactPhone: "+420 603 111 222",
      orderDate: "2026-10-21",
      customerRequiredDate: "2026-11-27",
      value: 107000,
      title: "Upínka frézovaná VK-2291 + 1 další",
    });
    expect(plan.stageTo).toBe("objednavka");
    expect(plan.newItems).toHaveLength(2);
    expect(plan.newItems[0]).toEqual({
      drawingNumber: "VK-2291", revision: "B", name: "Upínka frézovaná",
      description: "Frézovaný díl dle výkresu, odjehlit, bez ostrých hran", material: "1.2379",
      quantity: 50, unit: "ks", unitPrice: 1180, note: "Termín položky 2026-11-27",
    });
    expect(plan.itemUpdates).toEqual([]);
    expect(plan.filledColumns).toEqual([
      "customer_order_number", "customer_contact", "customer_contact_email", "customer_contact_phone",
      "order_date", "customer_required_date", "value", "title",
    ]);
    expect(plan.filled).toContain("Číslo objednávky zákazníka");
    expect(plan.filled).toContain("Požadovaný termín zákazníkem");
    expect(plan.filled).toContain("Nové položky (2)");
  });

  it("nikdy nepřepíše ruční údaje", () => {
    const plan = planJobUpdate(snapshot({
      stage: "nabidka",
      title: "Upínky pro Strojmetal",
      customerOrderNumber: "PO-RUCNE",
      customerContact: "Jana Malá",
      orderDate: "2026-10-01",
      customerRequiredDate: "2026-12-01",
      value: 99000,
    }), PO);
    expect(plan.patch).toEqual({
      customerContactEmail: "dvorak@strojmetal.cz",
      customerContactPhone: "+420 603 111 222",
    });
    expect(plan.filledColumns).not.toContain("customer_order_number");
    expect(plan.filledColumns).not.toContain("title");
  });

  it("stav jen dopředu — potvrzená zakázka zůstane", () => {
    expect(planJobUpdate(snapshot({ stage: "potvrzeno" }), PO).stageTo).toBeNull();
    expect(planJobUpdate(snapshot({ stage: "objednavka" }), PO).stageTo).toBeNull();
    expect(planJobUpdate(snapshot({ stage: "poptavka" }), PO).stageTo).toBe("objednavka");
  });

  it("speciální stav se nikdy nemění", () => {
    for (const stage of ["pozastaveno", "reklamace", "nerealizovano", "zruseno"] as JobStage[]) {
      expect(planJobUpdate(snapshot({ stage }), PO).stageTo).toBeNull();
    }
  });
});

describe("planJobUpdate — slučování položek", () => {
  it("doplní prázdné údaje položek podle čísla výkresu a přidá neznámé", () => {
    const job = snapshot({
      stage: "nabidka",
      items: [
        item({ id: "i1", drawingNumber: "vk 2291", name: null, material: null, quantity: 50, unitPrice: 1100 }),
      ],
    });
    const plan = planJobUpdate(job, PO);
    // zakázka bez objednávky: dohodnutá cena platí podle objednávky (override), prázdné údaje se doplní
    expect(plan.itemUpdates).toEqual([
      {
        id: "i1",
        patch: {
          material: "1.2379", name: "Upínka frézovaná", revision: "B", unitPrice: 1180,
          description: "Frézovaný díl dle výkresu, odjehlit, bez ostrých hran", note: "Termín položky 2026-11-27",
        },
        override: ["unitPrice"],
      },
    ]);
    expect(plan.newItems.map((i) => i.drawingNumber)).toEqual(["VK-2292"]);
    expect(plan.filled).toContain("Doplněná položka (1)");
    expect(plan.filled).toContain("Nová položka (1)");
  });

  it("bez výkresu páruje podle názvu, duplicitní řádky dokladu nepřidá dvakrát", () => {
    const job = snapshot({ items: [item({ id: "i1", name: "Pouzdro bronzové", quantity: 0 })] });
    const d = doc({
      docKind: "objednavka", issuer: "zakaznik",
      items: [
        { name: "pouzdro BRONZOVÉ", quantity: 220, unitPrice: 190 },
        { drawingNumber: "PB-200", quantity: 5 },
        { drawingNumber: "PB 200", quantity: 5 },
      ],
    });
    const plan = planJobUpdate(job, d);
    expect(plan.itemUpdates).toEqual([{ id: "i1", patch: { quantity: 220, unitPrice: 190 } }]);
    expect(plan.newItems).toHaveLength(1);
    expect(plan.newItems[0].drawingNumber).toBe("PB-200");
  });

  it("vyplněné položky nechá být (zakázka už objednávku má = revize)", () => {
    const job = snapshot({
      customerOrderNumber: "4795-2026",
      items: [item({ id: "i1", drawingNumber: "VK-2291", revision: "A", name: "Upínka", description: "Frézovaný díl", material: "C45", quantity: 40, unitPrice: 1000, note: "Termín položky 2026-11-27" })],
    });
    const plan = planJobUpdate(job, doc({ docKind: "objednavka", issuer: "zakaznik", items: [PO.items[0]] }));
    expect(plan.itemUpdates).toEqual([]);
    expect(plan.newItems).toEqual([]);
  });

  it("objednávka k zakázce bez objednávky: počet a cena podle objednávky, číslo výkresu / revize / materiál zůstanou", () => {
    const job = snapshot({
      items: [item({ id: "i1", drawingNumber: "VK-2291", revision: "A", name: "Upínka", description: "Frézovaný díl", material: "C45", quantity: 40, unitPrice: 1000 })],
    });
    const plan = planJobUpdate(job, doc({ docKind: "objednavka", issuer: "zakaznik", items: [PO.items[0]] }));
    expect(plan.newItems).toEqual([]);
    expect(plan.itemUpdates).toEqual([
      { id: "i1", patch: { quantity: 50, unitPrice: 1180, note: "Řádek objednávky: Frézovaný díl dle výkresu, odjehlit, bez ostrých hran · Termín položky 2026-11-27" }, override: ["quantity", "unitPrice"] },
    ]);
  });
});

describe("planJobUpdate — další druhy dokladů", () => {
  it("poptávka zákazníka → číslo a datum poptávky, požadovaný termín", () => {
    const plan = planJobUpdate(snapshot({ customer: null }), RFQ);
    expect(plan.patch).toMatchObject({
      customerInquiryNumber: "RFQ-26-0412",
      inquiryDate: "2026-10-22",
      customerRequiredDate: "2026-12-15",
      customerContact: "Lenka Horáková",
    });
    expect(plan.patch.orderDate).toBeUndefined();
    expect(plan.patch.value).toBeUndefined();
    expect(plan.stageTo).toBeNull(); // poptávka → poptávka není posun
  });

  it("naše potvrzení → potvrzený termín dodání, stav potvrzeno", () => {
    const d = doc({
      docKind: "potvrzeni", issuer: "my", documentNumber: "POT-2026-011",
      customerOrderNumber: "4795-2026", promisedDeliveryDate: "20. 11. 2026", requiredDeliveryDate: "2026-11-27",
    });
    const plan = planJobUpdate(snapshot({ stage: "objednavka", customerOrderNumber: "4795-2026" }), d);
    expect(plan.patch).toEqual({ dueDate: "2026-11-20" });
    expect(plan.filledColumns).toEqual(["due_date"]);
    expect(plan.stageTo).toBe("potvrzeno");
  });

  it("potvrzení dodavatele → slíbený termín dodavatele + naše objednávka u dodavatele, ve výrobě", () => {
    const d = doc({
      docKind: "potvrzeni", issuer: "dodavatel", documentNumber: "AB-5531",
      customerOrderNumber: "OBJ-2026-045", promisedDeliveryDate: "2026-11-10",
      customer: { name: "Strojmetal a.s.", contactPerson: "Ing. Jan Dvořák" },
      items: [{ drawingNumber: "VK-2291", quantity: 50, unitPrice: 700 }],
    });
    const plan = planJobUpdate(snapshot({ stage: "potvrzeno", items: [item({ id: "i1", drawingNumber: "VK-2291", quantity: 50, unitPrice: 1180 })] }), d);
    expect(plan.patch).toEqual({ supplierOrderNumber: "OBJ-2026-045", supplierPromisedDate: "2026-11-10", title: "VK-2291" });
    expect(plan.patch.customerOrderNumber).toBeUndefined();
    expect(plan.patch.customerContact).toBeUndefined();
    // cena dodavatele = nákupní, prodejní zůstane
    expect(plan.itemUpdates).toEqual([{ id: "i1", patch: { purchaseUnitPrice: 700 } }]);
    expect(plan.stageTo).toBe("ve_vyrobe");
  });

  it("dodací list dodavatele (fixture) → dodáno k nám, neznámé položky nepřidá", () => {
    const job = snapshot({ stage: "ve_vyrobe", title: "Příruby", items: [item({ id: "i1", drawingNumber: "XX-1", quantity: 10 })] });
    const plan = planJobUpdate(job, SUPPLIER_DL);
    expect(plan.stageTo).toBe("dodano_k_nam");
    expect(plan.patch).toEqual({ supplierOrderNumber: "OBJ-2026-045" });
    expect(plan.newItems).toEqual([]);
    expect(plan.patch.deliveryNoteNumber).toBeUndefined();
  });

  it("dodací list dodavatele u zakázky bez položek položky založí", () => {
    const plan = planJobUpdate(snapshot({ stage: "ve_vyrobe" }), SUPPLIER_DL);
    expect(plan.newItems).toEqual([{ drawingNumber: "PR-7075-20", revision: "A", name: "Příruba", material: "AL 7075-T6", quantity: 200, unit: "ks" }]);
  });

  it("náš dodací list → číslo DL a dodáno zákazníkovi", () => {
    const d = doc({ docKind: "dodaci_list", issuer: "my", documentNumber: "DL-2026-0042", customerOrderNumber: "4795-2026" });
    const plan = planJobUpdate(snapshot({ stage: "na_sklade" }), d);
    expect(plan.patch).toEqual({ customerOrderNumber: "4795-2026", deliveryNoteNumber: "DL-2026-0042" });
    expect(plan.stageTo).toBe("dodano_zakaznikovi");
  });

  it("naše faktura → číslo faktury a vyfakturováno, hodnota se z faktury nebere", () => {
    const d = doc({ docKind: "faktura", issuer: "my", documentNumber: "FV-2026-0107", totalWithoutVat: 107000 });
    const plan = planJobUpdate(snapshot({ stage: "dodano_zakaznikovi" }), d);
    expect(plan.patch).toEqual({ invoiceNumber: "FV-2026-0107" });
    expect(plan.stageTo).toBe("fakturovano");
  });

  it("faktura dodavatele stav nemění a nic zákaznického nevyplní", () => {
    const d = doc({ docKind: "faktura", issuer: "dodavatel", documentNumber: "2026100", customerOrderNumber: "OBJ-2026-045", totalWithoutVat: 50000 });
    const plan = planJobUpdate(snapshot({ stage: "dodano_k_nam" }), d);
    expect(plan.stageTo).toBeNull();
    expect(plan.patch).toEqual({ supplierOrderNumber: "OBJ-2026-045" });
  });

  it("naše nabídka → předpokládaný termín, hodnota (i ze součtu položek), stav nabídka", () => {
    const d = doc({
      docKind: "nabidka", issuer: "my", documentNumber: "NAB-2026-040", promisedDeliveryDate: "2026-12-01",
      items: [{ drawingNumber: "A-1", quantity: 10, unitPrice: 100 }, { drawingNumber: "A-2", quantity: 2, unitPrice: 50 }],
    });
    const plan = planJobUpdate(snapshot({ stage: "naceneni" }), d);
    expect(plan.patch).toMatchObject({ expectedDeliveryDate: "2026-12-01", value: 1100 });
    expect(plan.stageTo).toBe("nabidka");
  });

  it("naše objednávka u dodavatele → číslo naší objednávky, stav beze změny", () => {
    const d = doc({ docKind: "objednavka", issuer: "my", documentNumber: "OBJ-2026-051", totalWithoutVat: 30000 });
    const plan = planJobUpdate(snapshot({ stage: "potvrzeno" }), d);
    expect(plan.patch).toEqual({ supplierOrderNumber: "OBJ-2026-051" });
    expect(plan.stageTo).toBeNull();
  });

  it("výkres jen doplní název z položky", () => {
    const d = doc({ docKind: "vykres", issuer: "zakaznik", items: [{ drawingNumber: "HR-4016", name: "Hřídel" }] });
    const plan = planJobUpdate(snapshot({ stage: "naceneni" }), d);
    expect(plan.patch).toEqual({ title: "Hřídel HR-4016" });
    expect(plan.stageTo).toBeNull();
  });
});

describe("planNewJob", () => {
  it("objednávka (fixture) → zakázka ve stavu objednávka se vším vyplněným", () => {
    const plan = planNewJob(PO);
    expect(plan.input).toMatchObject({
      stage: "objednavka",
      title: "Upínka frézovaná VK-2291 + 1 další",
      customerName: "STROJMETAL, a. s.",
      customerOrderNumber: "4795-2026",
      orderDate: "2026-10-21",
      customerRequiredDate: "2026-11-27",
      value: 107000,
      currency: "CZK",
      deliveryMethod: "DAP Kladno",
    });
    expect(plan.items).toHaveLength(2);
    expect(plan.filledColumns).toContain("customer_id");
    expect(plan.filledColumns).toContain("currency");
    expect(new Set(plan.filledColumns).size).toBe(plan.filledColumns.length);
  });

  it("poptávka nového zákazníka (fixture) → stav poptávka", () => {
    const plan = planNewJob(RFQ);
    expect(plan.input).toMatchObject({
      stage: "poptavka",
      title: "Těleso ventilu HM-1050-03 + 1 další",
      customerName: "Hydraulika Morava s.r.o.",
      customerInquiryNumber: "RFQ-26-0412",
      inquiryDate: "2026-10-22",
    });
    expect(plan.input.value).toBeUndefined();
    expect(plan.items.map((i) => i.quantity)).toEqual([400, 400]);
  });

  it("dodavatelský doklad → celková částka jako nákupní náklady", () => {
    const d = doc({ docKind: "nabidka", issuer: "dodavatel", totalWithoutVat: 42000, items: [{ name: "Kalení čepů", quantity: 300 }] });
    const plan = planNewJob(d);
    expect(plan.input.stage).toBe("naceneni");
    expect(plan.input.purchaseCost).toBe(42000);
    expect(plan.input.value).toBeUndefined();
  });

  it("bez položek vezme název ze shrnutí, jinak z druhu a čísla dokladu", () => {
    expect(planNewJob(doc({ docKind: "ostatni", summary: "Reklamace rozměru 24h7 u 6 ks. Zákazník žádá výměnu." })).input.title)
      .toBe("Reklamace rozměru 24h7 u 6 ks");
    expect(planNewJob(doc({ docKind: "faktura", issuer: "my", documentNumber: "FV-1" })).input.title).toBe("Faktura FV-1");
    expect(planNewJob(doc({})).input).toMatchObject({ title: "Nová zakázka z dokladu", stage: "poptavka" });
    expect(planNewJob(doc({ docKind: "objednavka", issuer: "zakaznik" })).input.title).toBe("Objednávka");
    const long = planNewJob(doc({ items: [{ name: "x".repeat(300) }] })).input.title!;
    expect(long.length).toBeLessThanOrEqual(120);
  });
});

describe("planFieldMeta", () => {
  it("vrací sloupec a popisek", () => {
    expect(planFieldMeta("customerRequiredDate")).toEqual({ column: "customer_required_date", label: "Požadovaný termín zákazníkem" });
    expect(planFieldMeta("nesmysl")).toBeNull();
  });
});
