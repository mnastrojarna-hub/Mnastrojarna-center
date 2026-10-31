import { describe, it, expect } from "vitest";
import {
  documentTypeLabel, invoiceFileKind, isAcceptedInvoiceFile, isInvoiceDocument, recordResultMessage, rejectTypeMessage,
} from "@/lib/supplier-invoices/record-types";
import { normalizeSupplierInvoice } from "@/lib/supplier-invoices/extract";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const FMT = { money: (n: number, c: string) => `${n} ${c}`, date: (d: string) => d.split("-").reverse().join(". ") };

describe("Zanést fakturu — jen PDF / obrázek", () => {
  it("prohlížeč: typ nebo přípona", () => {
    expect(isAcceptedInvoiceFile({ name: "faktura.pdf", type: "application/pdf" })).toBe(true);
    expect(isAcceptedInvoiceFile({ name: "IMG_1.HEIC", type: "image/heic" })).toBe(true);
    expect(isAcceptedInvoiceFile({ name: "IMG_1.HEIC", type: "" })).toBe(true);
    expect(isAcceptedInvoiceFile({ name: "foto.jpg", type: "image/jpeg" })).toBe(true);
    expect(isAcceptedInvoiceFile({ name: "faktury.zip", type: "application/zip" })).toBe(false);
    expect(isAcceptedInvoiceFile({ name: "faktura.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBe(false);
    expect(isAcceptedInvoiceFile({ name: "faktura.xlsx", type: "" })).toBe(false);
    expect(isAcceptedInvoiceFile({ name: "vykres.dxf", type: "application/octet-stream" })).toBe(false);
  });
  it("server: obsah souboru", () => {
    expect(invoiceFileKind(ascii("%PDF-1.4\n"))).toBe("pdf");
    expect(invoiceFileKind(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image");
    expect(invoiceFileKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image");
    expect(invoiceFileKind(ascii("RIFF\0\0\0\0WEBPVP8 "))).toBe("image");
    expect(invoiceFileKind(ascii("\0\0\0\x18ftypheic\0\0\0\0"))).toBe("heic");
    expect(invoiceFileKind(ascii("\0\0\0\x18ftypisom\0\0\0\0"))).toBeNull(); // video
    expect(invoiceFileKind(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull(); // zip
    expect(invoiceFileKind(new Uint8Array())).toBeNull();
    expect(rejectTypeMessage("faktury.zip")).toMatch(/„faktury\.zip" není faktura v PDF ani obrázek/);
  });
  it("druh dokladu: faktura / zálohová / dobropis ano, dodací list ne; chybějící = faktura", () => {
    expect(isInvoiceDocument("faktura")).toBe(true);
    expect(isInvoiceDocument("dobropis")).toBe(true);
    expect(isInvoiceDocument(undefined)).toBe(true);
    expect(isInvoiceDocument("dodaci_list")).toBe(false);
    expect(documentTypeLabel("dodaci_list")).toBe("dodací list");
    expect(normalizeSupplierInvoice({}).documentType).toBe("faktura");
    expect(normalizeSupplierInvoice({ documentType: "Dodaci_list" }).documentType).toBe("dodaci_list");
    expect(normalizeSupplierInvoice({ documentType: "nesmysl" }).documentType).toBe("faktura");
    expect(normalizeSupplierInvoice({ vatBreakdown: [{ rate: 21, base: 1000, vat: 210 }, { rate: 500, base: 1, vat: 1 }, { rate: 12, base: 0, vat: 0 }] }).vatBreakdown)
      .toEqual([{ rate: 21, base: 1000, vat: 210 }]);
  });
  it("věty výsledku", () => {
    const head = { supplierName: "Hrubý s.r.o.", number: "FA-1", amount: 38115, currency: "CZK", dueDate: "2026-11-14", documentType: "faktura" as const };
    expect(recordResultMessage({ ok: true, kind: "recorded", aiFilled: true, head }, FMT))
      .toBe("Faktura zapsána ✓ — Hrubý s.r.o., č. FA-1, částka 38115 CZK, splatnost 14. 11. 2026");
    expect(recordResultMessage({ ok: true, kind: "recorded", aiFilled: false, head }, FMT)).toBe("Faktura zapsána ✓ — údaje doplní účetní.");
    expect(recordResultMessage({ ok: true, kind: "duplicate", recordedAt: "2026-10-30T08:00:00Z", recordedBy: "Jan", head }, FMT))
      .toBe("Tahle faktura už je zapsaná (30. 10. 2026, Jan).");
    expect(recordResultMessage({ ok: true, kind: "not_invoice", documentType: "dodaci_list", label: "dodací list", head: null }, FMT))
      .toBe("Tohle nevypadá jako faktura — AI v dokladu vidí dodací list.");
  });
});
