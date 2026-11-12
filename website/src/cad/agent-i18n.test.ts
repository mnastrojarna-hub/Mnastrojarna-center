import { afterEach, describe, expect, it } from "vitest";
import { featureSummary, parseAgentText, selectEdges, selectFaces, type Bbox } from "./agent";
import { setLang } from "./i18n";
import type { Feature } from "./types";

const feat = (p: ReturnType<typeof parseAgentText>, i: number) => {
  const op = p.ops[i];
  if (op.k !== "feature" && op.k !== "select") throw new Error(`op ${i} není prvek: ${op.k}`);
  return op.feature;
};

afterEach(() => setLang("cs"));

describe("textové příkazy anglicky (kanonická jména)", () => {
  it("new part, material, box, hole, pattern, fillet edges vertical, sketch, extrude, chamfer, shell, view, undo, status", () => {
    const p = parseAgentText(`new part Plate
material stainless steel
box 100 60 12 center
hole 8.5 depth 10 at 20 30 12 counterbore 15 5
pattern 4 spacing 25 direction X
fillet 2 edges vertical
sketch XY: rect 60 40; circle 20 at 10 5
extrude 20 symmetric cut
chamfer 1 edges top circular
shell 2 open +Z
view front
undo
status`);
    expect(p.errors).toEqual([]);
    expect(p.ops[0]).toMatchObject({ k: "new", name: "Plate", assembly: false });
    expect(p.ops[1]).toMatchObject({ k: "meta", patch: { material: "nerez" } });
    expect(feat(p, 2)).toMatchObject({ type: "box", size: [100, 60, 12], centered: true });
    expect(feat(p, 3)).toMatchObject({ type: "hole", diameter: 8.5, depth: 10, position: [20, 30, 12], cbDiameter: 15, cbDepth: 5 });
    expect(feat(p, 4)).toMatchObject({ type: "pattern", kind: "linear", count: 4, spacing: 25, direction: [1, 0, 0] });
    expect(p.ops[5]).toMatchObject({ k: "select", rule: ["vertical"], feature: { type: "fillet", radius: 2 } });
    expect(feat(p, 6)).toMatchObject({ type: "sketch", plane: { name: "XY" } });
    expect(p.ops[7]).toMatchObject({ k: "entities", entities: [{ type: "rect", w: 60, h: 40 }, { type: "circle", cx: 10, cy: 5, r: 10 }] });
    expect(feat(p, 8)).toMatchObject({ type: "extrude", distance: 20, symmetric: true, mode: "cut" });
    expect(p.ops[9]).toMatchObject({ k: "select", rule: ["top", "circular"], feature: { type: "chamfer", distance: 1 } });
    expect(p.ops[10]).toMatchObject({ k: "select", rule: ["+z"], feature: { type: "shell", thickness: 2 } });
    expect(p.ops.slice(11).map((o) => o.k)).toEqual(["view", "pop", "status"]);
    expect(p.ops[11]).toMatchObject({ k: "view", view: "front" });
  });
});

describe("textové příkazy německy (synonyma)", () => {
  it("neues teil, werkstoff, quader, bohrung, muster, verrunden, skizze, extrudieren, fase, schale, ansicht, rückgängig, status, gewinde", () => {
    const p = parseAgentText(`neues teil Platte
werkstoff edelstahl
quader 100 60 12 mitte
bohrung 8,5 tiefe 10 bei 20 30 12 senkung 15 5
muster 4 abstand 25 richtung X
verrunden 2 kanten senkrecht
skizze XY: rechteck 60 40; kreis 20 bei 10 5
extrudieren 20 symmetrisch abziehen
fase 1 kanten oben rund
schale 2 öffnen +Z
muster kreisförmig 6 winkel 360 achse Z
ansicht vorne
rückgängig
status
gewinde M18×1,5 länge 20 bei 0 0 10 achse Z innen modellieren`);
    expect(p.errors).toEqual([]);
    expect(p.ops[0]).toMatchObject({ k: "new", name: "Platte", assembly: false });
    expect(p.ops[1]).toMatchObject({ k: "meta", patch: { material: "nerez" } });
    expect(feat(p, 2)).toMatchObject({ type: "box", size: [100, 60, 12], centered: true });
    expect(feat(p, 3)).toMatchObject({ type: "hole", diameter: 8.5, depth: 10, position: [20, 30, 12], cbDiameter: 15, cbDepth: 5 });
    expect(feat(p, 4)).toMatchObject({ type: "pattern", kind: "linear", count: 4, spacing: 25, direction: [1, 0, 0] });
    expect(p.ops[5]).toMatchObject({ k: "select", rule: ["senkrecht"], feature: { type: "fillet", radius: 2 } });
    expect(feat(p, 6)).toMatchObject({ type: "sketch", plane: { name: "XY" } });
    expect(p.ops[7]).toMatchObject({ k: "entities", entities: [{ type: "rect", w: 60, h: 40 }, { type: "circle", cx: 10, cy: 5, r: 10 }] });
    expect(feat(p, 8)).toMatchObject({ type: "extrude", distance: 20, symmetric: true, mode: "cut" });
    expect(p.ops[9]).toMatchObject({ k: "select", rule: ["oben", "rund"], feature: { type: "chamfer", distance: 1 } });
    expect(p.ops[10]).toMatchObject({ k: "select", rule: ["+z"], feature: { type: "shell", thickness: 2 } });
    expect(feat(p, 11)).toMatchObject({ type: "pattern", kind: "circular", count: 6, angle: 360, axis: "Z" });
    expect(p.ops[12]).toMatchObject({ k: "view", view: "front" });
    expect(p.ops.slice(13, 15).map((o) => o.k)).toEqual(["pop", "status"]);
    expect(feat(p, 15)).toMatchObject({ type: "thread", designation: "M18×1,5", length: 20, position: [0, 0, 10], axis: "Z", internal: true, modeled: true });
  });

  it("neznámý příkaz hlásí chybu v jazyce rozhraní", () => {
    setLang("de");
    // seznam příkazů v hlášce pochází z tabulky příkazů (stejný jako v nápovědě), v jazyce rozhraní
    expect(parseAgentText("foo 1 2").errors[0].message).toMatch(/^unbekannter Befehl „foo“ – Befehle: neu teil, neu baugruppe, name, werkstoff, farbe, quader/);
    setLang("en");
    expect(parseAgentText("foo 1 2").errors[0].message).toMatch(/^unknown command “foo” – commands: new part, new assembly, name, material, color, box/);

    expect(parseAgentText("box 1").errors[0].message).toBe("box needs three positive dimensions: box X Y Z");
    setLang("cs");
    expect(parseAgentText("foo 1 2").errors[0].message).toMatch(/^neznámý příkaz „foo“ – příkazy: nový díl, nová sestava, název, materiál, barva, kvádr, válec/);
  });
});

describe("pravidla hran a ploch anglicky a německy", () => {
  const bbox: Bbox = [[0, 0, 0], [100, 50, 20]];
  const edges = [
    { index: 0, curve: "Úsečka", dir: [1, 0, 0] as [number, number, number], center: [50, 0, 20] as [number, number, number], length: 100 },
    { index: 1, curve: "Úsečka", dir: [0, 0, 1] as [number, number, number], center: [0, 0, 10] as [number, number, number], length: 20 },
    { index: 2, curve: "Kružnice", radius: 9, center: [30, 25, 20] as [number, number, number], length: 56.5 },
    { index: 3, curve: "Kružnice", radius: 9, center: [30, 25, 0] as [number, number, number], length: 56.5 },
    { index: 4, curve: "Úsečka", dir: [0, 1, 0] as [number, number, number], center: [100, 25, 0] as [number, number, number], length: 50 },
  ];
  const faces = [
    { index: 0, planar: true, normal: [0, 0, 1] as [number, number, number], center: [50, 25, 20] as [number, number, number], area: 5000 },
    { index: 1, planar: true, normal: [0, 0, 1] as [number, number, number], center: [10, 10, 10] as [number, number, number], area: 100 },
    { index: 2, planar: true, normal: [1, 0, 0] as [number, number, number], center: [100, 25, 10] as [number, number, number], area: 1000 },
    { index: 3, planar: false, surface: "Válec", center: [30, 25, 10] as [number, number, number], area: 300 },
  ];
  it("hrany: top/bottom/vertical/horizontal/circular/straight/all, oben/unten/senkrecht/waagerecht/rund/gerade/alle", () => {
    expect(selectEdges(["top"], edges, bbox)).toEqual([0, 2]);
    expect(selectEdges(["oben"], edges, bbox)).toEqual([0, 2]);
    expect(selectEdges(["bottom"], edges, bbox)).toEqual([3, 4]);
    expect(selectEdges(["unten"], edges, bbox)).toEqual([3, 4]);
    expect(selectEdges(["vertical"], edges, bbox)).toEqual([1]);
    expect(selectEdges(["senkrecht"], edges, bbox)).toEqual([1]);
    expect(selectEdges(["horizontal"], edges, bbox)).toEqual([0, 4]);
    expect(selectEdges(["waagerecht"], edges, bbox)).toEqual([0, 4]);
    expect(selectEdges(["circular"], edges, bbox)).toEqual([2, 3]);
    expect(selectEdges(["rund"], edges, bbox)).toEqual([2, 3]);
    expect(selectEdges(["straight"], edges, bbox)).toEqual([0, 1, 4]);
    expect(selectEdges(["gerade"], edges, bbox)).toEqual([0, 1, 4]);
    expect(selectEdges(["top", "all"], edges, bbox)).toEqual([0, 1, 2, 3, 4]);
    expect(selectEdges(["alle"], edges, bbox)).toEqual([0, 1, 2, 3, 4]);
  });
  it("plochy: top/side/cylindrical/planar/largest, oben/seitlich/zylindrisch/eben/grösste", () => {
    expect(selectFaces(["top"], faces, bbox)).toEqual([0]);
    expect(selectFaces(["oben"], faces, bbox)).toEqual([0]);
    expect(selectFaces(["side"], faces, bbox)).toEqual([2]);
    expect(selectFaces(["seitlich"], faces, bbox)).toEqual([2]);
    expect(selectFaces(["cylindrical"], faces, bbox)).toEqual([3]);
    expect(selectFaces(["zylindrisch"], faces, bbox)).toEqual([3]);
    expect(selectFaces(["planar"], faces, bbox)).toEqual([0, 1, 2]);
    expect(selectFaces(["eben"], faces, bbox)).toEqual([0, 1, 2]);
    expect(selectFaces(["largest"], faces, bbox)).toEqual([0]);
    expect(selectFaces(["grösste"], faces, bbox)).toEqual([0]);
    setLang("en");
    expect(() => selectFaces(["blue"], faces, bbox)).toThrow(/unknown face rule “blue” – \+Z/);
  });
});

describe("souhrn prvku ve stavovém textu je přeložený", () => {
  const hole: Feature = { id: "h", name: "Díra 1", type: "hole", diameter: 8.5, depth: 10, position: [20, 30, 12], axis: "Z", cbDiameter: 15, cbDepth: 5, csDiameter: 0, kind: "simple" } as unknown as Feature;
  const ext: Feature = { id: "e", name: "Vysunutí 1", type: "extrude", sketchId: "s", distance: 20, symmetric: true, reverse: false, mode: "cut" } as unknown as Feature;
  it("čeština", () => {
    expect(featureSummary(hole)).toBe("Ø8,50 hloubka 10 zahl. Ø15×5 v [20; 30; 12], osa Z");
    expect(featureSummary(ext)).toBe("20 mm, symetricky, cut");
  });
  it("angličtina (desetinná tečka) a němčina (desetinná čárka)", () => {
    setLang("en");
    expect(featureSummary(hole)).toBe("Ø8.50 depth 10 cbore Ø15×5 at [20; 30; 12], axis Z");
    expect(featureSummary(ext)).toBe("20 mm, symmetric, cut");
    setLang("de");
    expect(featureSummary(hole)).toBe("Ø8,50 Tiefe 10 Senkung Ø15×5 bei [20; 30; 12], Achse Z");
    expect(featureSummary(ext)).toBe("20 mm, symmetrisch, cut");
  });
});
