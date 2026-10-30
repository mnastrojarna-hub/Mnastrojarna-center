import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { COMPANY } from "@/lib/company";
import {
  renderInvoicePdf, renderQuotePdf, renderDeliveryNotePdf, renderConfirmationPdf,
  sampleInvoice, sampleQuote, sampleDeliveryNote, sampleConfirmation,
} from "./render";
import { computeTotals, czDate, czk, leadTimeLabel, addDaysIso, isPlaceholder, UNAPPROVED_BANNER, UNAPPROVED_WATERMARK, type DocItem } from "./types";
import { QuoteDocument } from "./quote";
import { isValidElement, type ReactNode } from "react";
import {
  buildQuoteDoc, buildConfirmationDoc, buildDeliveryNoteDoc, buildInvoiceDoc, pdfFileName, pickPricedItems,
  confirmationNumber, unpricedCount,
} from "./job-docs";
import type { JobDetail, JobQuote } from "@/lib/jobs/types";

const PREVIEW = process.env.PDF_PREVIEW === "1";
const PREVIEW_DIR = "/tmp/claude-0/pdf-preview";

function isPdf(buf: Buffer, minBytes = 5 * 1024) {
  expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  expect(buf.length).toBeGreaterThan(minBytes);
}

function save(name: string, buf: Buffer) {
  if (!PREVIEW) return;
  mkdirSync(PREVIEW_DIR, { recursive: true });
  writeFileSync(path.join(PREVIEW_DIR, name), buf);
}

function manyItems(n: number): DocItem[] {
  return Array.from({ length: n }, (_, i) => ({
    drawingNumber: `VK-${3000 + i}`,
    revision: String.fromCharCode(65 + (i % 4)),
    description: i % 5 === 0 ? "Frézovaný díl s dlouhým popisem — upínací přípravek pro obráběcí centrum, kaleno a broušeno" : `Díl č. ${i + 1}`,
    material: i % 3 === 0 ? "1.2379" : undefined,
    quantity: (i % 7) + 1,
    unit: "ks",
    unitPrice: 100 + i * 17.5,
    vatRate: 21,
  }));
}

describe("výpočty a formáty", () => {
  it("rekapitulace DPH po sazbách", () => {
    const t = computeTotals([
      { description: "a", quantity: 3, unit: "ks", unitPrice: 33.33, vatRate: 21 },
      { description: "b", quantity: 1, unit: "ks", unitPrice: 100, vatRate: 12 },
    ]);
    expect(t.subtotal).toBe(199.99);
    expect(t.breakdown.map((r) => r.rate)).toEqual([21, 12]);
    expect(t.breakdown[0].vat).toBe(21);
    expect(t.breakdown[1].vat).toBe(12);
    expect(t.total).toBe(232.99);
  });

  it("české formáty", () => {
    expect(czDate("2026-01-05")).toBe("5. 1. 2026");
    expect(czDate("2026-10-22T23:30:00Z")).toBe("22. 10. 2026");
    expect(czk(1180).replace(/\s/g, " ")).toBe("1 180,00 Kč");
    expect(leadTimeLabel(21)).toBe("3 týdny");
    expect(leadTimeLabel(7)).toBe("1 týden");
    expect(leadTimeLabel(10)).toBe("10 dní");
    expect(leadTimeLabel(3)).toBe("3 dny");
    expect(addDaysIso("2026-12-30", 3)).toBe("2027-01-02");
    expect(isPlaceholder("Spisová značka — doplnit (Městský soud v Praze)")).toBe(true);
    expect(isPlaceholder("C 123456 vedená u Městského soudu v Praze")).toBe(false);
  });
});

describe("PDF doklady — ukázky", () => {
  it("nabídka", async () => {
    const buf = await renderQuotePdf(sampleQuote());
    isPdf(buf);
    save("nabidka.pdf", buf);
  });

  it("potvrzení objednávky", async () => {
    const buf = await renderConfirmationPdf(sampleConfirmation());
    isPdf(buf);
    save("potvrzeni.pdf", buf);
  });

  it("dodací list", async () => {
    const buf = await renderDeliveryNotePdf(sampleDeliveryNote());
    isPdf(buf);
    save("dodaci-list.pdf", buf);
  });

  it("faktura bez bankovních údajů (bez QR)", async () => {
    const buf = await renderInvoicePdf(sampleInvoice());
    isPdf(buf);
    save("faktura-bez-uctu.pdf", buf);
  });

  it("faktura s IBAN → QR Platba", async () => {
    const backup = { ...COMPANY.bank };
    // Testovací (veřejně publikovaný vzorový) IBAN — jen pro náhled, do aplikace se nepropisuje
    Object.assign(COMPANY.bank, {
      accountNumber: "19-2000145399/0800",
      iban: "CZ65 0800 0000 1920 0014 5399",
      swift: "GIBACZPX",
      bankName: "Česká spořitelna",
    });
    try {
      const buf = await renderInvoicePdf(sampleInvoice());
      isPdf(buf);
      save("faktura.pdf", buf);
    } finally {
      Object.assign(COMPANY.bank, backup);
    }
  });

  it("starší volání s minimem polí stále funguje", async () => {
    const buf = await renderInvoicePdf({
      number: "20260001",
      variableSymbol: "20260001",
      issueDate: "2026-10-22",
      taxableDate: "2026-10-22",
      dueDate: "2026-11-05",
      paymentMethod: "Bankovní převod",
      currency: "CZK",
      supplier: { name: "MNástrojárna s.r.o." },
      customer: { name: "Zákazník" },
      items: [{ description: "Položka", quantity: 1, unit: "ks", unitPrice: 100, vatRate: 21 }],
    });
    isPdf(buf, 2000);
    const dl = await renderDeliveryNotePdf({
      number: "DL-1",
      issueDate: "2026-10-22",
      orderNumber: "Z-2026-001",
      supplier: { name: "MNástrojárna s.r.o." },
      customer: { name: "Zákazník" },
      items: [{ description: "Díl", quantity: 2, unit: "ks" }],
    });
    isPdf(dl, 2000);
  });

  it("okrajové případy: dlouhé tokeny, EUR, více sazeb, zahraniční odběratel, dlouhá poznámka", async () => {
    const items: DocItem[] = [
      {
        drawingNumber: "3D-ZK-2026-000145-REV-B-SESTAVA",
        revision: "AB12",
        description: "Sestava_upinaciho_pripravku_pro_petiosou_frezku_DMU65_monoBLOCK_varianta_2",
        material: "1.4404 / X2CrNiMo17-12-2",
        quantity: 1250.5,
        unit: "kg",
        unitPrice: 98765.43,
        vatRate: 21,
      },
      { description: "Doprava", quantity: 1, unit: "ks", unitPrice: 2500, vatRate: 12 },
      { description: "Vzorky zdarma", quantity: 3, unit: "ks", unitPrice: 0, vatRate: 0 },
      { description: "Cena na dotaz", quantity: 2, unit: "ks", unitPrice: 0, vatRate: 21, unpriced: true },
    ];
    const q = await renderQuotePdf({
      ...sampleQuote(),
      currency: "EUR",
      customer: { name: "Präzisionsteile Müller GmbH & Co. KG", street: "Industriestraße 7", zip: "80331", city: "München", country: "DE", dic: "DE123456789" },
      items,
      note: "Dlouhá poznámka. ".repeat(80),
    });
    isPdf(q);
    save("okraje.pdf", q);
  }, 30_000);

  it("40 položek přes více stran", async () => {
    const items = manyItems(40);
    const q = await renderQuotePdf({ ...sampleQuote(), items });
    isPdf(q);
    save("nabidka-40.pdf", q);
    const inv = await renderInvoicePdf({ ...sampleInvoice(), items });
    isPdf(inv);
    const dl = await renderDeliveryNotePdf({ ...sampleDeliveryNote(), items });
    isPdf(dl);
    save("dodaci-list-40.pdf", dl);
    const c = await renderConfirmationPdf({ ...sampleConfirmation(), items });
    isPdf(c);
  }, 30_000);
});

// ── Doklady ze zakázky (JobDetail) ──────────────────────────

const person = (id: string, name: string) => ({ id, name });

function fixtureQuote(): JobQuote {
  return {
    id: "q1",
    number: "NAB-2026-031",
    revision: 2,
    title: "Frézované díly VK-2291",
    status: "accepted" as JobQuote["status"],
    total: 62_460,
    currency: "CZK",
    validUntil: "2026-11-20",
    leadTimeDays: 21,
    deliveryTerms: "DAP Čelákovice",
    paymentTerms: null,
    note: "Cena včetně kalení.",
    createdBy: person("u2", "Jan Dvořák"),
    approvedBy: person("u1", "Ing. Martin Novotný"),
    approvedAt: "2026-10-15T08:00:00Z",
    sentAt: "2026-10-15T09:00:00Z",
    createdAt: "2026-10-14T22:30:00Z",
    archived: false,
    aiGenerated: false,
    accepted: true,
    items: [
      {
        id: "qi1", position: 0, drawingNumber: "VK-2291", name: "Upínací deska", description: "frézovaný díl, kaleno",
        material: null, quantity: 50, unit: "ks", unitPrice: 1180, vatRate: 21, purchaseUnitPrice: null, note: null,
      },
      {
        id: "qi2", position: 1, drawingNumber: null, name: "Měřicí protokol 3D", description: null,
        material: null, quantity: 1, unit: "ks", unitPrice: 3460, vatRate: 21, purchaseUnitPrice: null, note: null,
      },
    ],
  };
}

function fixtureJob(): JobDetail {
  return {
    id: "j1",
    number: "Z-2026-014",
    title: "Upínací desky VK-2291",
    stage: "ve_vyrobe" as JobDetail["stage"],
    priority: "normal" as JobDetail["priority"],
    customer: { id: "c1", name: "Strojmetal Čelákovice a.s.", customerNumber: "ZAK-0042", ico: "45274649" },
    customerOrderNumber: "PO-4471/26",
    customerInquiryNumber: "RFQ-2026-0912",
    drawingNumbers: ["VK-2291"],
    itemCount: 1,
    totalQuantity: 50,
    value: 62_460,
    purchaseCost: null,
    currency: "CZK",
    inquiryDate: "2026-10-10",
    orderDate: "2026-10-20",
    customerRequiredDate: "2026-11-20",
    dueDate: "2026-11-13",
    expectedDeliveryDate: null,
    supplierPromisedDate: null,
    maxToleratedDate: null,
    receivedAt: null,
    deliveredAt: "2026-11-12T10:00:00Z",
    owner: person("u1", "Ing. Martin Novotný"),
    assignee: person("u2", "Jan Dvořák"),
    createdBy: person("u2", "Jan Dvořák"),
    supplier: null,
    quoteCount: 1,
    fileCount: 0,
    aiFilled: false,
    source: "manual" as JobDetail["source"],
    createdAt: "2026-10-10T08:00:00Z",
    updatedAt: "2026-10-20T08:00:00Z",
    stageChangedAt: null,
    note: null,
    tags: [],
    technology: "frézování",
    manufacturingLocation: null,
    specificRequirements: null,
    deliveryMethod: "Vlastní doprava",
    supplierOrderNumber: null,
    invoiceNumber: null,
    deliveryNoteNumber: "DL-2026-0211",
    customerContact: "Ing. Petra Svobodová",
    customerContactEmail: "svobodova@strojmetal.cz",
    customerContactPhone: null,
    pricedBy: person("u2", "Jan Dvořák"),
    approvedBy: person("u1", "Ing. Martin Novotný"),
    approvedAt: null,
    confirmedAt: null,
    productionStartedAt: null,
    shippedAt: null,
    invoicedAt: null,
    emailId: null,
    aiConfidence: null,
    acceptedQuoteId: "q1",
    margin: null,
    customerDetail: {
      id: "c1",
      name: "Strojmetal Čelákovice a.s.",
      customerNumber: "ZAK-0042",
      supplierNumberAtCustomer: "D-10577",
      ico: "45274649",
      dic: "CZ45274649",
      street: "Průmyslová 124",
      city: "Čelákovice",
      zip: "250 88",
      country: "CZ",
      email: "nakup@strojmetal.cz",
      phone: null,
      contactPerson: "Ing. Petra Svobodová",
      deliveryAddress: null,
      paymentTermsDays: 30,
    },
    items: [
      {
        id: "i1", position: 0, drawingNumber: "VK-2291", revision: "C", name: "Upínací deska", description: null,
        material: "1.2379", quantity: 50, unit: "ks", unitPrice: null, purchaseUnitPrice: null, note: null,
      },
    ],
    quotes: [fixtureQuote()],
    files: [],
    events: [],
  };
}

describe("doklady ze zakázky", () => {
  it("názvy souborů ASCII", () => {
    expect(pdfFileName("nabidka", "NAB-2026-031")).toBe("Nabidka_NAB-2026-031.pdf");
    expect(pdfFileName("faktura", "FV 2026/0158")).toBe("Faktura_FV-2026-0158.pdf");
    expect(pdfFileName("potvrzeni", "POT-Č.14")).toBe("Potvrzeni_objednavky_POT-C.14.pdf");
    expect(pdfFileName("dodaci_list", "")).toBe("Dodaci_list_bez-cisla.pdf");
    expect(confirmationNumber("Z-2026-014")).toBe("POT-2026-014");
  });

  it("položky bez cen v zakázce → přijatá nabídka (s revizí výkresu ze zakázky)", () => {
    const items = pickPricedItems(fixtureJob());
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ drawingNumber: "VK-2291", revision: "C", material: "1.2379", unitPrice: 1180 });
    expect(items[0].note).toBe("frézovaný díl, kaleno");
    expect(unpricedCount(items)).toBe(0);
  });

  it("bez položek a nabídek → souhrnný řádek z hodnoty zakázky", () => {
    const job = { ...fixtureJob(), items: [], quotes: [], acceptedQuoteId: null };
    const items = pickPricedItems(job);
    expect(items).toEqual([
      expect.objectContaining({ description: "Upínací desky VK-2291", quantity: 50, unitPrice: 1249.2, unpriced: false }),
    ]);
  });

  it("nabídka", async () => {
    const job = fixtureJob();
    const doc = await buildQuoteDoc(job, job.quotes[0]);
    expect(doc).toMatchObject({
      number: "NAB-2026-031",
      issueDate: "2026-10-15", // 22:30 UTC = 0:30 v Praze
      jobNumber: "Z-2026-014",
      customerInquiryNumber: "RFQ-2026-0912",
      customerNumber: "ZAK-0042",
      supplierNumberAtCustomer: "D-10577",
      leadTimeText: "3 týdny od potvrzení objednávky",
      paymentTerms: "Splatnost faktury 30 dní od vystavení",
      preparedBy: "Jan Dvořák",
      approvedBy: "Ing. Martin Novotný",
      revision: 2,
    });
    expect(doc.customerOrderNumber).toBeUndefined();
    const buf = await renderQuotePdf(doc);
    isPdf(buf);
    save("zakazka-nabidka.pdf", buf);
  });

  it("potvrzení objednávky", async () => {
    const doc = await buildConfirmationDoc(fixtureJob());
    expect(doc).toMatchObject({
      number: "POT-2026-014",
      confirmedDeliveryDate: "2026-11-13",
      quoteNumber: "NAB-2026-031",
      customerOrderNumber: "PO-4471/26",
      customerOrderDate: "2026-10-20",
      preparedBy: "Jan Dvořák",
    });
    const buf = await renderConfirmationPdf(doc);
    isPdf(buf);
    save("zakazka-potvrzeni.pdf", buf);
  });

  it("dodací list", async () => {
    const doc = await buildDeliveryNoteDoc(fixtureJob(), { number: "DL-2026-0211", issueDate: "2026-11-12" });
    expect(doc.items).toEqual([
      expect.objectContaining({ drawingNumber: "VK-2291", revision: "C", quantity: 50, description: "Upínací deska" }),
    ]);
    expect(doc.items[0]).not.toHaveProperty("unitPrice");
    expect(doc.transport).toBe("Vlastní doprava");
    const buf = await renderDeliveryNotePdf(doc);
    isPdf(buf);
    save("zakazka-dodaci-list.pdf", buf);
  });

  it("faktura", async () => {
    const doc = await buildInvoiceDoc(fixtureJob(), { number: "FV-2026-0158", issueDate: "2026-11-12" });
    expect(doc).toMatchObject({
      variableSymbol: "20260158",
      taxableDate: "2026-11-12",
      dueDate: "2026-12-12",
      deliveryNoteNumber: "DL-2026-0211",
      customerOrderNumber: "PO-4471/26",
    });
    // bez IBANu v Nastavení se nic nevymýšlí
    expect(doc.bank?.iban ?? undefined).toBe(COMPANY.bank.iban || undefined);
    const buf = await renderInvoicePdf(doc);
    isPdf(buf);
    save("zakazka-faktura.pdf", buf);
  });
});

// ── #25 neschválená nabídka: vodoznak, autor, ceny jen ze schválené ──
/** Všechny texty stromu dokladu (rozbalí funkční komponenty — PDF komponenty jsou čisté funkce). */
function treeText(node: ReactNode): string[] {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (n === null || n === undefined || typeof n === "boolean") return;
    if (typeof n === "string" || typeof n === "number") { out.push(String(n)); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (isValidElement(n)) {
      const el = n as { type: unknown; props: Record<string, unknown> };
      if (typeof el.type === "function") {
        try { walk((el.type as (p: unknown) => unknown)(el.props)); } catch { /* komponenta s hooky — přeskočit */ }
        return;
      }
      walk(el.props.children);
    }
  };
  walk(node);
  return out;
}

function pendingQuote(over: Partial<JobQuote> = {}): JobQuote {
  return {
    ...fixtureQuote(), status: "ke_schvaleni" as JobQuote["status"], state: "ke_schvaleni", accepted: false, sentAt: null,
    approvedBy: null, approvedAt: null, adminApprovalRequired: true, approvalRequired: true,
    createdBy: person("u3", "Petr Obchodník"), ...over,
  };
}

describe("neschválená nabídka (#25)", () => {
  it("vodoznak jen u nabídky, kterou zákazník ještě nesmí dostat", async () => {
    const job = fixtureJob();
    const pending = await buildQuoteDoc({ ...job, quotes: [pendingQuote()] }, pendingQuote(), { preparedBy: "Super Admin" });
    expect(pending.watermark).toBe(UNAPPROVED_WATERMARK);
    expect(pending.watermark).toBe("NESCHVÁLENO — NEODESÍLAT");
    // „Vypracoval“ = autor nabídky, ne ten, kdo náhled otevřel
    expect(pending.preparedBy).toBe("Petr Obchodník");
    expect(pending.approvedBy).toBeUndefined();
    const texts = treeText(QuoteDocument({ data: pending }));
    expect(texts).toContain("NESCHVÁLENO — NEODESÍLAT");
    expect(texts).toContain(UNAPPROVED_BANNER);
    const buf = await renderQuotePdf(pending);
    isPdf(buf);
    save("zakazka-nabidka-neschvalena.pdf", buf);

    // schválená nabídka ne-admina: bez vodoznaku, „Schválil“ s datem
    const approvedQ = pendingQuote({ state: "schvalena", approvedBy: person("u1", "Jan Semorád"), approvedAt: "2026-10-23T07:30:00Z" });
    const approved = await buildQuoteDoc({ ...job, quotes: [approvedQ] }, approvedQ);
    expect(approved.watermark).toBeUndefined();
    expect(approved.approvedBy).toBe("Jan Semorád");
    expect(approved.approvedAt).toBe("2026-10-23");
    const at = treeText(QuoteDocument({ data: approved }));
    expect(at).not.toContain("NESCHVÁLENO — NEODESÍLAT");
    expect(at.join(" ")).toContain(czDate("2026-10-23"));
    isPdf(await renderQuotePdf(approved));

    // nabídka super admina bez nutnosti schválení: bez vodoznaku
    const own = await buildQuoteDoc(job, job.quotes[0]);
    expect(own.watermark).toBeUndefined();
    // AI nabídka v režimu se schválením, neodeslaná, neschválená → vodoznak
    const ai = pendingQuote({ adminApprovalRequired: false, aiGenerated: true });
    expect((await buildQuoteDoc({ ...job, quotes: [ai] }, ai)).watermark).toBe(UNAPPROVED_WATERMARK);
  });

  it("nabídka ke schválení nebere položky zakázky (schvaluje se obsah nabídky)", async () => {
    const job = fixtureJob();
    const empty = pendingQuote({ items: [] });
    const doc = await buildQuoteDoc({ ...job, quotes: [empty] }, empty);
    expect(doc.items).toEqual([]);
    // nabídka super admina bez položek dál bere položky zakázky
    const adminEmpty = { ...fixtureQuote(), items: [] };
    expect((await buildQuoteDoc({ ...job, quotes: [adminEmpty] }, adminEmpty)).items).toHaveLength(1);
  });

  it("potvrzení / faktura neberou ceny z neschválené nabídky", () => {
    const job = { ...fixtureJob(), acceptedQuoteId: null, quotes: [pendingQuote()] };
    const items = pickPricedItems(job);
    expect(items.some((i) => i.unitPrice === 1180)).toBe(false);
    // schválená ano
    const ok = { ...job, quotes: [pendingQuote({ state: "schvalena", approvedBy: person("u1", "Jan Semorád") })] };
    expect(pickPricedItems(ok)[0]).toMatchObject({ unitPrice: 1180 });
  });
});

// A2: dlouhé číslo výkresu se nesmí přelít do popisu ani useknout („VYK-…" → „YK-…")
describe("fitFontSize — kód na jeden řádek sloupce", async () => {
  const { fitFontSize } = await import("./components");
  it("krátký kód zůstává, dlouhý se zmenší, aby se vešel; text s mezerami se nemění", () => {
    expect(fitFontSize("KR-1", 78, 8.8)).toBe(8.8);
    const s = fitFontSize("VYK-MVUAOT9F-A", 78, 8.8);
    expect(s).toBeLessThan(8.8);
    expect(14 * 0.66 * s).toBeLessThanOrEqual(78);
    expect(fitFontSize("Upínací deska dlouhý popis", 20, 8.8)).toBe(8.8);
    expect(fitFontSize("A".repeat(60), 78, 8.8)).toBe(5.4); // minimum
    expect(fitFontSize(null, 78, 8.8)).toBe(8.8);
  });
});
