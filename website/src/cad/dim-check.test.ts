import { describe, expect, it } from "vitest";
import { dimCheck, expectedDims, presentDims } from "./dim-check";
import { emptyDoc, type CadDoc } from "./types";

const doc: CadDoc = {
  ...emptyDoc("Deska"),
  features: [
    { id: "s1", name: "Skica 1", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "e1", type: "rect", cx: 50, cy: 30, w: 100, h: 60, r: 0, angle: 0 }, { id: "e2", type: "slot", cx: 50, cy: 30, length: 40, width: 14, angle: 0 }] },
    { id: "x1", name: "Vysunutí 1", type: "extrude", sketchId: "s1", distance: 10, symmetric: false, reverse: false, mode: "new" },
    { id: "h1", name: "Díra 1", type: "hole", position: [20, 15, 10], axis: "Z", flip: false, diameter: 30, depth: 0, cbDiameter: 0, cbDepth: 0 },
    { id: "p1", name: "Pole 1", type: "pattern", featureId: "h1", kind: "circular", count: 6, angle: 360, axis: "Z", center: [50, 30, 0] },
    { id: "h2", name: "Díra 2", type: "hole", position: [50, 30, 10], axis: "Z", flip: false, diameter: 50, depth: 0, cbDiameter: 0, cbDepth: 0 },
    { id: "h3", name: "Díra 3", type: "hole", position: [0, 30, 5], axis: "X", flip: false, diameter: 5, depth: 12, cbDiameter: 0, cbDepth: 0, kind: "tapped", thread: "M6" },
    { id: "p2", name: "Pole 2", type: "pattern", featureId: "h3", kind: "linear", count: 2, spacing: 60, direction: [0, 1, 0] },
    { id: "f1", name: "Zaoblení 1", type: "fillet", radius: 3, edges: "all" },
  ],
};
const bbox: [[number, number, number], [number, number, number]] = [[0, 0, 0], [100, 60, 10]];

describe("očekávané kóty z historie prvků", () => {
  it("zahrnuje celkové rozměry, díry s počtem, závit s označením a hloubkou, drážku, zaoblení", () => {
    const e = expectedDims(doc, bbox);
    const labels = e.map((x) => x.label);
    expect(labels).toContain("100 (délka X)");
    expect(labels).toContain("6× Ø30 skrz");
    expect(labels).toContain("Ø50 skrz");
    expect(labels).toContain("2× M6 hl. 12");
    expect(labels).toContain("12 (hloubka díry)");
    expect(labels).toContain("14 (šířka drážky)");
    expect(labels).toContain("40 (délka drážky)");
    expect(labels).toContain("R3");
    expect(e.find((x) => x.label === "2× M6 hl. 12")).toMatchObject({ kind: "thread", value: 6, source: "Díra 3" });
    // stejná hodnota jen jednou (100 je délka X i šířka obdélníku)
    expect(e.filter((x) => x.kind === "lin" && x.value === 100)).toHaveLength(1);
  });
});

describe("kóty na listu", () => {
  it("čte Ø, R, M, počty a hloubky z textů vrstvy dim", () => {
    const p = presentDims([
      { s: "6× Ø30", layer: "dim" },
      { s: "Ø50 H8", layer: "dim" },
      { s: "R3", layer: "dim" },
      { s: "2× M6 hl. 12", layer: "dim" },
      { s: "100", layer: "dim" },
      { s: "Nepředepsané tolerance", layer: "text" },
    ]);
    expect(p).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "dia", value: 30 }),
      expect.objectContaining({ kind: "dia", value: 50 }),
      expect.objectContaining({ kind: "rad", value: 3 }),
      expect.objectContaining({ kind: "thread", value: 6 }),
      expect.objectContaining({ kind: "lin", value: 12 }),
      expect.objectContaining({ kind: "lin", value: 100 }),
    ]));
    expect(p.some((x) => x.text.includes("tolerance"))).toBe(false);
  });
  it("kontrola označí přítomné a chybějící", () => {
    const r = dimCheck(doc, bbox, [{ s: "6× Ø30", layer: "dim" }, { s: "100", layer: "dim" }, { s: "60", layer: "dim" }, { s: "10", layer: "dim" }]);
    const by = (l: string) => r.find((x) => x.label === l)!;
    expect(by("6× Ø30 skrz").present).toBe(true);
    expect(by("100 (délka X)").present).toBe(true);
    expect(by("Ø50 skrz").present).toBe(false);
    expect(by("14 (šířka drážky)").present).toBe(false);
    expect(by("2× M6 hl. 12").present).toBe(false);
    expect(r.filter((x) => !x.present).length).toBeGreaterThanOrEqual(4);
  });
});
