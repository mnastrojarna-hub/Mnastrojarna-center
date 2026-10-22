import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderPurchaseOrderPdf, samplePurchaseOrder } from "./render-purchase";
import { computeTotals, type DocItem } from "./types";

const PREVIEW = process.env.PDF_PREVIEW === "1";
const PREVIEW_DIR = "/tmp/claude-0/pdf-preview";

function isPdf(buf: Buffer, minBytes = 5 * 1024) {
  expect(Buffer.isBuffer(buf)).toBe(true);
  expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  expect(buf.length).toBeGreaterThan(minBytes);
}

function save(name: string, buf: Buffer) {
  if (!PREVIEW) return;
  mkdirSync(PREVIEW_DIR, { recursive: true });
  writeFileSync(path.join(PREVIEW_DIR, name), buf);
}

function pageCount(buf: Buffer): number {
  return (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

function manyItems(n: number): DocItem[] {
  return Array.from({ length: n }, (_, i) => ({
    drawingNumber: `VK-${3000 + i}`,
    revision: i % 4 === 0 ? undefined : String.fromCharCode(65 + (i % 4)),
    description: i % 5 === 0
      ? "Frézovaný díl s dlouhým popisem — upínací přípravek pro obráběcí centrum, kaleno a broušeno"
      : `Díl č. ${i + 1}`,
    material: i % 3 === 0 ? "1.2379" : undefined,
    note: i % 7 === 0 ? "Odjehlit, hrany sražené 0,5 × 45°" : undefined,
    quantity: (i % 7) + 1,
    unit: "ks",
    unitPrice: 80 + i * 12.5,
    vatRate: 21,
    unpriced: i === 13,
  }));
}

describe("PDF objednávka dodavateli", () => {
  it("ukázková objednávka → PDF", async () => {
    const buf = await renderPurchaseOrderPdf(samplePurchaseOrder());
    save("objednavka-vydana.pdf", buf);
    isPdf(buf);
    expect(pageCount(buf)).toBe(1);
  }, 30_000);

  it("40 položek → víc stran, hlavička tabulky se opakuje", async () => {
    const data = { ...samplePurchaseOrder(), items: manyItems(40) };
    const buf = await renderPurchaseOrderPdf(data);
    isPdf(buf, 10 * 1024);
    expect(pageCount(buf)).toBeGreaterThan(1);
    save("objednavka-vydana-40.pdf", buf);
  }, 30_000);

  it("minimum údajů (bez nabídky, termínu, poznámky, výkresů)", async () => {
    const s = samplePurchaseOrder();
    const buf = await renderPurchaseOrderPdf({
      number: "OV-2026-005",
      issueDate: s.issueDate,
      currency: "EUR",
      buyer: s.buyer,
      supplier: { name: "Dodavatel bez adresy", country: "DE" },
      items: [{ description: "Kooperace — tepelné zpracování", quantity: 1, unit: "ks", unitPrice: 0, vatRate: 0, unpriced: true }],
      totalsHint: "Přenesená daňová povinnost",
    });
    isPdf(buf, 3 * 1024);
    save("objednavka-vydana-minimum.pdf", buf);
  }, 30_000);

  it("součty ukázky sedí (bez DPH, DPH 21 %, s DPH)", () => {
    const t = computeTotals(samplePurchaseOrder().items);
    expect(t.subtotal).toBe(50 * 760 + 24 * 545 + 120 * 138.5);
    expect(t.total).toBe(Math.round(t.subtotal * 1.21 * 100) / 100);
  });
});
