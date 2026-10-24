import { describe, expect, it } from "vitest";
import { isOurQuoteFile, isPriceDocument, maskPurchaseOrderListItem } from "@/lib/auth/price-visibility";
import type { PurchaseOrderListItem } from "@/lib/jobs/purchasing-types";

const NONE = new Set<string>();

describe("isPriceDocument — nákupní doklad (dvojče SQL job_file_is_price_doc)", () => {
  it.each<[string, { kind: string; issuer?: string | null; origin?: string | null }, boolean]>([
    ["naše objednávka dodavateli", { kind: "objednavka_vydana", issuer: "my", origin: "generated" }, true],
    ["nabídka dodavatele (foto)", { kind: "naceneni", issuer: "dodavatel", origin: "capture" }, true],
    ["potvrzení od dodavatele", { kind: "potvrzeni", issuer: "dodavatel" }, true],
    ["faktura dodavatele", { kind: "faktura", issuer: "dodavatel" }, true],
    ["dodací list dodavatele", { kind: "dodaci_list", issuer: "dodavatel" }, true],
    ["výkres od dodavatele — bez ceny", { kind: "vykres", issuer: "dodavatel" }, false],
    ["3D model od dodavatele — bez ceny", { kind: "model_3d", issuer: "dodavatel" }, false],
    ["nabídka bez vystavitele (nahraná) — fail closed", { kind: "nabidka", issuer: null, origin: "upload" }, true],
    ["faktura bez vystavitele", { kind: "faktura", issuer: null }, true],
    ["nacenění bez vystavitele", { kind: "naceneni" }, true],
    ["potvrzení bez vystavitele", { kind: "potvrzeni", issuer: null, origin: "email" }, true],
    ["naše vystavená nabídka", { kind: "nabidka", issuer: "my", origin: "generated" }, false],
    ["vystavená, vystavitel zatím neuveden", { kind: "potvrzeni", issuer: null, origin: "generated" }, false],
    ["naše faktura", { kind: "faktura", issuer: "my" }, false],
    ["objednávka zákazníka", { kind: "objednavka", issuer: "zakaznik" }, false],
    ["výkres zákazníka", { kind: "vykres", issuer: null }, false],
    ["poptávka", { kind: "poptavka", issuer: null }, false],
  ])("%s", (_l, f, expected) => {
    expect(isPriceDocument({ id: "f1", ...f }, NONE)).toBe(expected);
  });

  it("soubor navázaný na objednávku / nabídku dodavatele je nákupní i bez druhu", () => {
    expect(isPriceDocument({ id: "f1", kind: "ostatni", issuer: "my" }, new Set(["f1"]))).toBe(true);
    expect(isPriceDocument({ id: "f2", kind: "ostatni", issuer: "my" }, new Set(["f1"]))).toBe(false);
  });
});

describe("isOurQuoteFile", () => {
  it("naše nabídka = druh nabídka, nevystavil dodavatel", () => {
    expect(isOurQuoteFile({ kind: "nabidka", issuer: "my" })).toBe(true);
    expect(isOurQuoteFile({ kind: "nabidka", issuer: null })).toBe(true);
    expect(isOurQuoteFile({ kind: "nabidka" })).toBe(true);
    expect(isOurQuoteFile({ kind: "nabidka", issuer: "dodavatel" })).toBe(false);
    expect(isOurQuoteFile({ kind: "naceneni", issuer: "my" })).toBe(false);
  });
});

describe("maskPurchaseOrderListItem — bez práva na nákupní ceny", () => {
  const stamp = (note: string | null) => ({ by: { id: "u1", name: "Petr" }, byName: "Petr", at: "2026-10-20T08:00:00Z", via: null, kind: "user" as const, note });
  const po: PurchaseOrderListItem = {
    id: "po1", jobId: "j1", number: "OV-2026-004", status: "zrusena",
    supplier: { id: "s1", name: "Kalírna Brno", email: "k@k.cz", phone: null, ico: null, dic: null, address: null, contactPerson: null, country: "CZ" },
    supplierQuote: { id: "sq1", number: "NAB-DOD-77", quoteDate: "2026-10-01" },
    orderDate: "2026-10-02", requiredDate: "2026-10-30", confirmedDate: null, currency: "CZK", total: 98765.43,
    deliveryTerms: "DAP Hradec tajné", paymentTerms: "splatnost 14 dní tajné", deliveryAddress: "Dílna 1", note: "sleva 7 % tajné",
    supplierReference: "ZAK-55", fileId: "file-po", sentAt: "2026-10-03T08:00:00Z", createdBy: { id: "u1", name: "Petr" },
    createdAt: "2026-10-02T08:00:00Z", updatedAt: "2026-10-03T08:00:00Z",
    items: [{
      id: "i1", position: 1, drawingNumber: "V-100", name: "Kalení", material: "C45", quantity: 3, unit: "ks",
      unitPrice: 4321.5, note: "cena dle dohody tajné", receivedQuantity: 1, receiptClosed: true, receiptClosedReason: "zmetky tajné",
    }],
    cancelReason: "dražší než konkurence tajné",
    stamps: { created: stamp(null), status: stamp("storno tajné"), sent: null, confirmed: null, delivered: null, cancelled: stamp("důvod tajné"), received: null },
    job: { id: "j1", number: "Z-2026-001", title: "Hřídel", stage: "objednavka" },
    customer: { id: "c1", name: "StrojMetal" }, itemCount: 1, drawingNumbers: ["V-100"],
  };

  it("žádná cena ani volný text v ničem, co jde do prohlížeče", () => {
    const masked = maskPurchaseOrderListItem(po);
    const json = JSON.stringify(masked);
    for (const secret of ["98765", "98 765", "4321", "4 321", "tajné", "NAB-DOD-77", "file-po"]) expect(json, secret).not.toContain(secret);
    expect(masked).toMatchObject({
      total: 0, note: null, paymentTerms: null, deliveryTerms: null, supplierQuote: null, fileId: null, cancelReason: null, pricesHidden: true,
    });
    expect(masked.items[0]).toMatchObject({ unitPrice: null, note: null, receiptClosedReason: null, quantity: 3, drawingNumber: "V-100" });
  });

  it("zůstane, co je vidět všem: číslo, stav, dodavatel, zakázka, termíny, položky bez cen", () => {
    const masked = maskPurchaseOrderListItem(po);
    expect(masked).toMatchObject({
      number: "OV-2026-004", status: "zrusena", supplier: { name: "Kalírna Brno" }, job: { number: "Z-2026-001" },
      requiredDate: "2026-10-30", supplierReference: "ZAK-55", itemCount: 1,
    });
    expect(masked.stamps?.status?.by?.name).toBe("Petr");
    // originál se nemění
    expect(po.total).toBe(98765.43);
  });
});
