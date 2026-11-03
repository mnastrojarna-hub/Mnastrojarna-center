import { describe, expect, it } from "vitest";
import { drawingView, drawingsForItems, type PricingDrawingSource } from "./pricing-drawings";

const f = (p: Partial<PricingDrawingSource> & { id: string; filename: string }): PricingDrawingSource => ({
  kind: "vykres", mimeType: null, itemId: null, createdAt: "2026-11-01T10:00:00Z", ...p,
});

describe("drawingsForItems — výkresy k položkám na Nacenění", () => {
  const items = [
    { id: "i1", drawingNumber: "H-20" },
    { id: "i2", drawingNumber: "H-200" },
    { id: "i3", drawingNumber: "VK 2291/A" },
    { id: "i4", drawingNumber: null },
  ];

  it("vazba order_item_id má přednost před názvem; cizí vazba se podle názvu nepřiřadí", () => {
    const out = drawingsForItems(items, [
      f({ id: "a", filename: "H-200_revB.pdf", itemId: "i1" }),
      f({ id: "b", filename: "H-20.pdf", itemId: "jina-polozka" }),
    ]);
    expect(out.i1.map((d) => d.id)).toEqual(["a"]);
    expect(out.i2).toBeUndefined();
  });

  it("podle čísla výkresu v názvu — nejdelší shoda vyhraje (H-200 ≠ H-20), normalizace mezer a lomítek", () => {
    const out = drawingsForItems(items, [
      f({ id: "a", filename: "H-200 rev B.pdf" }),
      f({ id: "b", filename: "h20.png", mimeType: "image/png" }),
      f({ id: "c", filename: "VK2291A_sestava.step", kind: "model_3d" }),
      f({ id: "d", filename: "scan001.pdf" }),
    ]);
    expect(out.i2.map((d) => d.id)).toEqual(["a"]);
    expect(out.i1).toEqual([{ id: "b", filename: "h20.png", view: "image" }]);
    expect(out.i3).toEqual([{ id: "c", filename: "VK2291A_sestava.step", view: "model" }]);
    expect(out.i4).toBeUndefined();
  });

  it("pořadí: PDF, obrázek, model; v rámci druhu nejnovější první", () => {
    const out = drawingsForItems([{ id: "i", drawingNumber: "D-1234" }], [
      f({ id: "m", filename: "D-1234.step", kind: "model_3d", createdAt: "2026-11-03T00:00:00Z" }),
      f({ id: "old", filename: "D-1234_A.pdf", createdAt: "2026-10-01T00:00:00Z" }),
      f({ id: "new", filename: "D-1234_B.pdf", createdAt: "2026-11-02T00:00:00Z" }),
      f({ id: "img", filename: "D-1234.jpg" }),
    ]);
    expect(out.i.map((d) => d.id)).toEqual(["new", "old", "img", "m"]);
  });

  it("drawingView podle přípony / MIME / druhu", () => {
    expect(drawingView("x.PDF")).toBe("pdf");
    expect(drawingView("x", "application/pdf")).toBe("pdf");
    expect(drawingView("x.dxf")).toBe("model");
    expect(drawingView("x.bin", null, "model_3d")).toBe("model");
    expect(drawingView("x.webp")).toBe("image");
    expect(drawingView("x.tif")).toBe("other");
  });
});
