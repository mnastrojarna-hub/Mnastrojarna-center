import { describe, it, expect } from "vitest";
import { invoiceBalance, invoicePaymentLabel, invoicePaymentsFromRows } from "./invoice-payments";
import { renderInvoicePdf, sampleInvoice } from "./render";
import { invoiceSpd } from "./invoice";
import { invoiceBankWarning } from "./qr";
import { pdfText as rawPdfText, squash } from "@/test/pdf-text";
import { documentEmailBody } from "@/lib/jobs/document-emails";
import type { DocItem, InvoiceData } from "./types";

/** Faktura 25 000 bez DPH (21 %) = 30 250 s DPH. */
const ITEMS: DocItem[] = [
  { description: "Upínací deska", quantity: 5, unit: "ks", unitPrice: 3000, vatRate: 21 },
  { description: "Vodicí lišta", quantity: 10, unit: "ks", unitPrice: 1000, vatRate: 21 },
];

const IBAN = "CZ6508000000192000145399";
const flat = squash;

async function pdfText(buf: Buffer): Promise<string> {
  return flat(await rawPdfText(buf));
}

function invoice(extra: Partial<InvoiceData> = {}): InvoiceData {
  const s = sampleInvoice();
  return {
    ...s, issueDate: "2026-10-30", taxableDate: "2026-10-30", dueDate: "2026-11-13",
    bank: { accountNumber: "19-2000145399/0800", iban: IBAN, bankName: "Česká spořitelna" },
    items: ITEMS, ...extra,
  };
}

describe("úhrady na faktuře (čisté funkce)", () => {
  it("záloha 3 000 bez DPH → odečte se 3 630 s DPH, zbývá 26 620", () => {
    const { payments, settled } = invoicePaymentsFromRows([{ paid_on: "2026-10-12", amount: 3000, settles: false }], ITEMS, "2026-10-30");
    expect(settled).toBe(false);
    expect(payments).toEqual([{ date: "2026-10-12", amount: 3630, net: 3000, kind: "zaloha" }]);
    expect(invoiceBalance(ITEMS, payments, settled)).toEqual({ total: 30250, paid: 3630, due: 26620 });
    expect(invoicePaymentLabel(payments[0])).toBe("Uhrazeno zálohou 12. 10. 2026");
  });

  it("platba v den vystavení a později = „platbou“; řazení podle data; neplatné částky se vynechají", () => {
    const { payments } = invoicePaymentsFromRows([
      { paid_on: "2026-11-02", amount: "1000", settles: false },
      { paid_on: "2026-10-30", amount: 500, settles: false },
      { paid_on: "2026-10-01", amount: 0, settles: false },
      { paid_on: "2026-10-02", amount: "x", settles: false },
    ], ITEMS, "2026-10-30");
    expect(payments.map((p) => [p.date, p.kind, p.amount])).toEqual([["2026-10-30", "platba", 605], ["2026-11-02", "platba", 1210]]);
  });

  it("„celá / zbývající částka“ (bez částky) dorovná zbytek; vyrovnaná zakázka = zbývá 0", () => {
    const r = invoicePaymentsFromRows([
      { paid_on: "2026-10-10", amount: 3000, settles: false },
      { paid_on: "2026-10-20", amount: null, settles: true },
    ], ITEMS, "2026-10-30");
    expect(r.settled).toBe(true);
    expect(r.payments.map((p) => p.amount)).toEqual([3630, 26620]);
    expect(invoiceBalance(ITEMS, r.payments, r.settled)).toEqual({ total: 30250, paid: 30250, due: 0 });
    // vyrovnání se slevou: zaplaceno méně, ale zakázka vyrovnaná → nic nezbývá
    const disc = invoicePaymentsFromRows([{ paid_on: "2026-10-20", amount: 24000, settles: true }], ITEMS, "2026-10-30");
    expect(invoiceBalance(ITEMS, disc.payments, disc.settled).due).toBe(0);
  });

  it("přeplatek nikdy nedá zápornou částku; více sazeb DPH poměrně", () => {
    const over = invoicePaymentsFromRows([{ paid_on: "2026-10-10", amount: 40000 }], ITEMS, "2026-10-30");
    expect(invoiceBalance(ITEMS, over.payments, over.settled).due).toBe(0);
    const mixed: DocItem[] = [
      { description: "a", quantity: 1, unit: "ks", unitPrice: 1000, vatRate: 21 },
      { description: "b", quantity: 1, unit: "ks", unitPrice: 1000, vatRate: 12 },
    ];
    // celkem 2 330 / 2 000 → 1 000 bez DPH = 1 165 s DPH
    expect(invoicePaymentsFromRows([{ paid_on: "2026-10-10", amount: 1000 }], mixed, "2026-10-30").payments[0].amount).toBe(1165);
    expect(invoicePaymentsFromRows(null, ITEMS, "2026-10-30")).toEqual({ payments: [], settled: false });
  });
});

describe("faktura PDF se zálohou", () => {
  it("řádky „Uhrazeno zálohou …“, „Zbývá uhradit“, QR na zbytek; rekapitulace DPH za celé plnění", async () => {
    const { payments, settled } = invoicePaymentsFromRows([{ paid_on: "2026-10-12", amount: 3000 }], ITEMS, "2026-10-30");
    const data = invoice({ payments, settled });
    const buf = await renderInvoicePdf(data);
    if (process.env.PDF_PREVIEW_DIR) {
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync(process.env.PDF_PREVIEW_DIR, { recursive: true });
      writeFileSync(`${process.env.PDF_PREVIEW_DIR}/faktura-zaloha.pdf`, buf);
    }
    const text = await pdfText(buf);
    expect(text).toContain(flat("Uhrazeno zálohou 12. 10. 2026"));
    expect(text).toContain(flat("−3 630,00 Kč"));
    expect(text).toContain(flat("Zbývá uhradit"));
    expect(text).toContain(flat("26 620,00 Kč"));
    expect(text).toContain(flat("Celkem s DPH30 250,00 Kč"));
    // rekapitulace DPH = celé zdanitelné plnění (ne snížená o zálohu)
    expect(text).toContain(flat("21 %25 000,00 Kč5 250,00 Kč30 250,00 Kč"));
    expect(text).toContain(flat("rekapitulace DPH platí pro celé zdanitelné plnění"));
    expect(text).not.toContain(flat("K úhradě30 250,00"));
    expect(invoiceSpd(data)).toContain("*AM:26620.00*");
  }, 60_000);

  it("bez úhrad beze změny: „K úhradě“ celá částka, QR na celou částku", async () => {
    const data = invoice();
    const text = await pdfText(await renderInvoicePdf(data));
    expect(text).toContain(flat("K úhradě30 250,00 Kč"));
    expect(text).not.toContain(flat("Zbývá uhradit"));
    expect(invoiceSpd(data)).toContain("*AM:30250.00*");
  }, 60_000);

  it("uhrazeno vše: zbývá 0, žádný QR k placení", async () => {
    const r = invoicePaymentsFromRows([{ paid_on: "2026-10-12", amount: null, settles: true }], ITEMS, "2026-10-30");
    const data = invoice(r);
    const text = await pdfText(await renderInvoicePdf(data));
    expect(text).toContain(flat("Zbývá uhradit0,00 Kč"));
    expect(text).toContain(flat("Faktura je uhrazena"));
    expect(invoiceSpd(data)).toBeNull();
  }, 60_000);

  it("bez IBAN žádný QR (faktura se vystaví, varování dává dialog)", () => {
    expect(invoiceSpd(invoice({ bank: { accountNumber: "19-2000145399/0800" } }))).toBeNull();
    expect(invoiceBankWarning({})).toBe("Faktura bude bez QR a čísla účtu — doplň bankovní účet v Nastavení → Firemní údaje.");
    expect(invoiceBankWarning({ accountNumber: " ", iban: "" })).toContain("bez QR a čísla účtu");
    expect(invoiceBankWarning({ accountNumber: "19-2000145399/0800" })).toBe("Faktura bude bez QR platby — doplň IBAN v Nastavení → Firemní údaje.");
    expect(invoiceBankWarning({ accountNumber: "19-2000145399/0800" }, "EUR")).toBeNull();
    expect(invoiceBankWarning({ iban: "CZ0000000000000000000000" })).toContain("není platný");
    expect(invoiceBankWarning({ iban: IBAN })).toBeNull();
  });
});

describe("e-mail k faktuře se zálohou", () => {
  const sender = { name: "Jan Novák" };
  const company = { name: "MNástrojárna s.r.o." };
  it("zbývá uhradit = částka po zálohách", () => {
    const body = flat(documentEmailBody({ kind: "faktura", number: "FV-1", amount: 26620, invoiceTotal: 30250, paidAmount: 3630, currency: "CZK", sender, company }));
    expect(body).toContain(flat("• Celkem s DPH: 30 250,00 Kč"));
    expect(body).toContain(flat("• Uhrazeno (zálohy a platby): 3 630,00 Kč"));
    expect(body).toContain(flat("• Zbývá uhradit: 26 620,00 Kč"));
    expect(body).not.toContain(flat("Částka k úhradě"));
  });
  it("vše uhrazeno → žádná výzva k platbě", () => {
    const body = flat(documentEmailBody({ kind: "faktura", number: "FV-1", amount: 0, invoiceTotal: 30250, paidAmount: 30250, currency: "CZK", sender, company }));
    expect(body).toContain(flat("Faktura je již uhrazena"));
    expect(body).not.toContain(flat("za úhradu v termínu splatnosti"));
  });
});
