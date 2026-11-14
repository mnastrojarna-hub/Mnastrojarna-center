import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseDxf } from "./formats/dxf";
import { applyDrawingEdits, drawingItemIds, drawingToModel, DrawingEditsMismatch } from "./drawing-model";
import type { Drawing2D } from "./drawing2d";

const g = (pairs: (string | number)[]) => {
  const out: string[] = [];
  for (let i = 0; i < pairs.length; i += 2) out.push(String(pairs[i]), String(pairs[i + 1]));
  return out.join("\n");
};

/** Deska: 4 úsečky, kružnice, polyčára, blok (2 entity), kóta bez bloku, text. */
function deska(): Uint8Array {
  return new TextEncoder().encode([
    g([0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1021", 9, "$INSUNITS", 70, 4, 0, "ENDSEC"]),
    g([0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LAYER", 70, 2,
      0, "LAYER", 2, "OBRYS", 70, 0, 62, 7, 6, "CONTINUOUS", 0, "LAYER", 2, "KOTY", 70, 0, 62, 3, 6, "CONTINUOUS", 0, "ENDTAB", 0, "ENDSEC"]),
    g([0, "SECTION", 2, "BLOCKS",
      0, "BLOCK", 8, "0", 2, "SROUB", 70, 0, 10, 0, 20, 0, 30, 0, 3, "SROUB",
      0, "CIRCLE", 8, "0", 10, 0, 20, 0, 30, 0, 40, 2,
      0, "LINE", 8, "0", 10, -3, 20, 0, 30, 0, 11, 3, 21, 0, 31, 0,
      0, "ENDBLK", 8, "0", 0, "ENDSEC"]),
    g([0, "SECTION", 2, "ENTITIES",
      0, "LINE", 8, "OBRYS", 10, 0, 20, 0, 30, 0, 11, 100, 21, 0, 31, 0,
      0, "LINE", 8, "OBRYS", 10, 100, 20, 0, 30, 0, 11, 100, 21, 50, 31, 0,
      0, "LINE", 8, "OBRYS", 10, 100, 20, 50, 30, 0, 11, 0, 21, 50, 31, 0,
      0, "LINE", 8, "OBRYS", 10, 0, 20, 50, 30, 0, 11, 0, 21, 0, 31, 0,
      0, "CIRCLE", 8, "OBRYS", 10, 50, 20, 25, 30, 0, 40, 10,
      0, "LWPOLYLINE", 8, "OBRYS", 90, 3, 70, 0, 10, 10, 20, 10, 10, 20, 20, 10, 10, 20, 20, 20,
      0, "INSERT", 8, "OBRYS", 2, "SROUB", 10, 80, 20, 40, 30, 0,
      0, "DIMENSION", 5, "D1", 8, "KOTY", 3, "STANDARD", 10, 100, 20, 60, 30, 0, 11, 50, 21, 62, 31, 0, 70, 32, 13, 0, 23, 0, 33, 0, 14, 100, 24, 0, 34, 0, 50, 0,
      0, "TEXT", 8, "KOTY", 10, 0, 20, -10, 30, 0, 40, 5, 1, "DESKA",
      0, "ENDSEC", 0, "EOF"]),
  ].join("\n"));
}

describe("prvky výkresu pro výběr oknem", () => {
  it("blok a kóta jsou skupiny = jeden prvek, polyčára jeden prvek", () => {
    const d = parseDxf(deska());
    expect(d.groups?.map((x) => x.kind)).toEqual(["insert", "dimension"]);
    expect(d.groups?.[0].name).toBe("SROUB");
    const { ids, items } = drawingItemIds(d);
    expect(items.slice(0, 6)).toEqual(["line", "line", "line", "line", "circle", "polyline"]);
    expect(items).toContain("insert");
    expect(items).toContain("dimension");
    expect(items[items.length - 1]).toBe("text");
    // entity bloku sdílejí prvek
    const ins = items.indexOf("insert");
    expect([...ids].filter((i) => i === ins).length).toBe(2);
    // kóta: čáry + doplněný text hodnoty → jeden prvek
    const dim = items.indexOf("dimension");
    const dimEnts = d.entities.filter((_, i) => ids[i] === dim);
    expect(dimEnts.length).toBeGreaterThan(1);
    expect(dimEnts.some((e) => e.kind === "text")).toBe(true);
  });

  it("model: křivky a texty nesou prvek, polyčára = 2 křivky jednoho prvku", () => {
    const d = parseDxf(deska());
    const { model, topology } = drawingToModel(d);
    const items = model.drawing!.items!;
    const obrys = topology[model.parts.findIndex((p) => p.name === "OBRYS")];
    const poly = items.indexOf("polyline");
    expect(obrys.curves.filter((c) => c.item === poly)).toHaveLength(2);
    expect(model.drawing!.texts.find((t) => t.text === "DESKA")!.item).toBe(items.length - 1);
    expect(obrys.curves.every((c) => typeof c.item === "number")).toBe(true);
  });

  it("DXF z fixtures: prvky deterministicky (prohlížeč i server čtou stejně)", () => {
    const bytes = readFileSync(path.join(__dirname, "__fixtures__/priruba-cp1250.dxf"));
    const a = drawingItemIds(parseDxf(bytes));
    const b = drawingItemIds(parseDxf(bytes));
    expect(a.items).toEqual(b.items);
    expect([...a.ids]).toEqual([...b.ids]);
  });
});

describe("úpravy výkresu z prohlížeče (smazané prvky, hladiny)", () => {
  it("smazané prvky a skryté hladiny pryč, zapnutá hladina viditelná, originál beze změny", () => {
    const d = parseDxf(deska());
    const { items } = drawingItemIds(d);
    const n0 = d.entities.length;
    const out = applyDrawingEdits(d, { itemCount: items.length, deletedItems: [4, items.indexOf("insert")], hiddenLayers: ["KOTY"], shownLayers: [] });
    expect(d.entities.length).toBe(n0);
    expect(out.entities.some((e) => e.kind === "circle" && e.r === 10)).toBe(false);
    expect(out.entities.some((e) => e.group === 0)).toBe(false);
    expect(out.entities.some((e) => e.layer === "KOTY")).toBe(false);
    expect(out.entities.filter((e) => e.kind === "line")).toHaveLength(4);
    expect(out.layers.find((l) => l.name === "KOTY")!.off).toBe(true);
    const off: Drawing2D = { ...d, layers: d.layers.map((l) => (l.name === "OBRYS" ? { ...l, off: true } : l)) };
    expect(applyDrawingEdits(off, { itemCount: items.length, deletedItems: [], hiddenLayers: [], shownLayers: ["OBRYS"] }).layers.find((l) => l.name === "OBRYS")!.off).toBe(false);
  });
  it("jiný počet prvků (výkres se změnil) → chyba", () => {
    const d = parseDxf(deska());
    expect(() => applyDrawingEdits(d, { itemCount: 3, deletedItems: [0], hiddenLayers: [], shownLayers: [] })).toThrow(DrawingEditsMismatch);
  });
});
