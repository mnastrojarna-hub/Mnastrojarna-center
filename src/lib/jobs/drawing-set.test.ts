import { describe, expect, it } from "vitest";
import {
  drawingNumberText, drawingQuantityText, drawingSheetKind, isServerRasterName, isSwipeDrawing, jobDrawingSet, stepIndex, viewerSetIndex,
  type DrawingSetFile, type DrawingSetItem,
} from "./drawing-set";

const file = (id: string, filename: string, over: Partial<DrawingSetFile> = {}): DrawingSetFile => ({
  id, kind: "vykres", filename, mimeType: null, archived: false, createdAt: `2026-11-0${id.length}T10:00:00Z`, version: 1, ...over,
});
const item = (id: string, position: number, over: Partial<DrawingSetItem> = {}): DrawingSetItem => ({
  id, position, drawingNumber: null, revision: null, name: null, material: null, quantity: 1, unit: "ks", ...over,
});

describe("sada výkresů zakázky (swipe v prohlížeči)", () => {
  it("jen aktuální 2D výkresy: PDF, obrázky, TIFF / HEIC — ne 3D, ne DXF, ne doklady, ne archiv, ne zamčené", () => {
    expect(isSwipeDrawing(file("a", "V-1.pdf"))).toBe(true);
    expect(isSwipeDrawing(file("a", "V-1.PNG"))).toBe(true);
    expect(isSwipeDrawing(file("a", "sken.tif"))).toBe(true);
    expect(isSwipeDrawing(file("a", "foto.heic"))).toBe(true);
    expect(isSwipeDrawing(file("a", "V-1.dxf"))).toBe(false);
    expect(isSwipeDrawing(file("a", "V-1.step", { kind: "model_3d" }))).toBe(false);
    expect(isSwipeDrawing(file("a", "objednavka.pdf", { kind: "objednavka" }))).toBe(false);
    expect(isSwipeDrawing(file("a", "V-1.pdf", { archived: true }))).toBe(false);
    expect(isSwipeDrawing(file("a", "V-1.pdf", { locked: "price" }))).toBe(false);
    expect(isSwipeDrawing(file("a", "bez-pripony", { mimeType: "application/pdf" }))).toBe(true);
    expect(drawingSheetKind("x.svg", "image/svg+xml")).toBeNull();
    expect(isServerRasterName("A.TIFF")).toBe(true);
    expect(isServerRasterName(null, "image/heic")).toBe(true);
    expect(isServerRasterName("a.png", "image/tiff")).toBe(false);
  });

  it("pořadí jako v Dokumentech (nejnovější nahoře, při shodě vyšší verze) a pozice odkazu", () => {
    const set = jobDrawingSet(
      [
        file("a", "A.pdf", { createdAt: "2026-11-01T10:00:00Z" }),
        file("bb", "B.pdf", { createdAt: "2026-11-03T10:00:00Z" }),
        file("ccc", "C.tif", { createdAt: "2026-11-02T10:00:00Z" }),
        file("m", "M.step", { kind: "model_3d", createdAt: "2026-11-05T10:00:00Z" }),
      ],
      [],
    );
    expect(set.map((e) => e.filename)).toEqual(["B.pdf", "C.tif", "A.pdf"]);
    expect(set[0].href).toBe("/api/jobs/files/bb");
    expect(viewerSetIndex(set, "/api/jobs/files/ccc")).toBe(1);
    expect(viewerSetIndex(set, "/api/jobs/files/ccc?download=1")).toBe(1);
    expect(viewerSetIndex(set, "/api/jobs/files/m")).toBe(-1);
  });

  it("položka k výkresu: vazba order_item_id, číslo přečtené AI, číslo v názvu (nejdelší shoda); bez vazby nic", () => {
    const items = [
      item("i1", 0, { drawingNumber: "H-20", name: "Hřídel", material: "1.4301", quantity: 25, revision: "B" }),
      item("i2", 1, { drawingNumber: "H-200", name: "Příruba", material: "", quantity: 2.5, unit: "kg" }),
      item("i3", 2, { drawingNumber: "4711-02", name: "Kolík", quantity: 0 }),
    ];
    const set = jobDrawingSet(
      [
        file("a", "scan.pdf", { orderItemId: "i3", createdAt: "2026-11-05T10:00:00Z" }),
        file("b", "H-200_rev_A.pdf", { createdAt: "2026-11-04T10:00:00Z" }),
        file("c", "vykres.pdf", { drawingNumber: "h 20", createdAt: "2026-11-03T10:00:00Z" }),
        file("d", "neznamy.pdf", { createdAt: "2026-11-02T10:00:00Z" }),
        file("e", "H-20.pdf", { orderItemId: "cizí-položka", createdAt: "2026-11-01T10:00:00Z" }),
      ],
      items,
    );
    expect(set.map((e) => e.info?.name ?? null)).toEqual(["Kolík", "Příruba", "Hřídel", null, null]);
    expect(set[0].info?.quantity).toBeNull(); // 0 ks = neuvedeno
    expect(set[1].info).toMatchObject({ drawingNumber: "H-200", material: null, quantity: 2.5, unit: "kg" });
    expect(drawingQuantityText(set[1].info)).toBe("2,5 kg");
    expect(drawingQuantityText(set[2].info)).toBe("25 ks");
    expect(drawingNumberText(set[2].info)).toBe("H-20 rev. B");
    expect(set[2].info?.material).toBe("1.4301");
    expect(drawingQuantityText(null)).toBeNull();
    // žádné ceny v údajích
    expect(Object.keys(set[2].info ?? {}).sort()).toEqual(["drawingNumber", "material", "name", "quantity", "revision", "unit"]);
  });

  it("listování v kruhu", () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(0);
  });
});
