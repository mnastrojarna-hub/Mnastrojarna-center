import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_COMMANDS, docStatusText, FEATURE_TYPES, normalizeFeatures, parseAgentText, parseEntity, selectEdges, selectFaces, topAt, type Bbox } from "./agent";
import { emptyDoc, type CadDoc, type Feature } from "./types";

const feat = (p: ReturnType<typeof parseAgentText>, i: number) => {
  const op = p.ops[i];
  if (op.k !== "feature" && op.k !== "select") throw new Error(`op ${i} není prvek: ${op.k}`);
  return op.feature;
};

describe("textové příkazy → prvky", () => {
  it("příruba: skica s kružnicí, vysunutí, trubka, díra na horní ploše, kruhové pole, sražení", () => {
    const p = parseAgentText(`nový díl Příruba DN50
materiál nerez
skica XY: kružnice 165
vysunout 18
trubka 88 61 30 v 0 0 18
díra 18 skrz v 62,5 0
pole kruhové 4
srazit 1,5`);
    expect(p.errors).toEqual([]);
    expect(p.ops.map((o) => o.k)).toEqual(["new", "meta", "feature", "entities", "feature", "feature", "feature", "feature", "feature"]);
    expect(p.ops[0]).toMatchObject({ k: "new", name: "Příruba DN50", assembly: false });
    expect(p.ops[1]).toMatchObject({ k: "meta", patch: { material: "nerez" } });
    expect(feat(p, 2)).toMatchObject({ type: "sketch", plane: { kind: "base", name: "XY", offset: 0 } });
    expect(p.ops[3]).toMatchObject({ k: "entities", entities: [{ type: "circle", cx: 0, cy: 0, r: 82.5 }] });
    expect(feat(p, 4)).toMatchObject({ type: "extrude", sketchId: "$last", distance: 18, symmetric: false });
    expect(feat(p, 5)).toMatchObject({ type: "tube", outer: 88, inner: 61, height: 30, position: [0, 0, 18], axis: "Z", mode: "add" });
    expect(feat(p, 6)).toMatchObject({ type: "hole", diameter: 18, depth: 0, position: [62.5, 0, 0], axis: "Z" });
    expect(p.ops[6]).toMatchObject({ fillTop: true });
    expect(feat(p, 7)).toMatchObject({ type: "pattern", kind: "circular", count: 4, angle: 360, axis: "Z", featureId: "$last" });
    expect(feat(p, 8)).toMatchObject({ type: "chamfer", distance: 1.5, edges: "all" });
  });

  it("anglicky, desetinná čárka i tečka, Ø, komentáře, pojmenování", () => {
    const p = parseAgentText(`# deska
box 100 60 12.5 name Deska
hole Ø8,5 depth 10 at 20 30 12.5 counterbore 15 5   // zahloubená
cylinder 20 40 axis X at 50 30 6 cut`);
    expect(p.errors).toEqual([]);
    expect(feat(p, 0)).toMatchObject({ type: "box", size: [100, 60, 12.5], name: "Deska", centered: false });
    expect(feat(p, 1)).toMatchObject({ type: "hole", diameter: 8.5, depth: 10, position: [20, 30, 12.5], kind: "counterbore", cbDiameter: 15, cbDepth: 5 });
    expect(p.ops[1]).not.toMatchObject({ fillTop: true });
    expect(feat(p, 2)).toMatchObject({ type: "cylinder", radius: 10, height: 40, axis: "X", mode: "cut" });
  });

  it("entity skici: obdélník roh / střed, mnohoúhelník, drážka, čára uzavřená, pomocná úsečka", () => {
    expect(parseEntity(["obdélník", "60", "40"])).toMatchObject({ type: "rect", cx: 0, cy: 0, w: 60, h: 40, r: 0 });
    expect(parseEntity(["obdélník", "60", "40", "roh", "10", "5", "zaoblení-rohů", "3"])).toMatchObject({ type: "rect", cx: 40, cy: 25, w: 60, h: 40, r: 3 });
    expect(parseEntity(["čtverec", "50", "střed"])).toMatchObject({ type: "rect", w: 50, h: 50 });
    expect(parseEntity(["mnohoúhelník", "6", "30", "v", "10", "-5"])).toMatchObject({ type: "polygon", sides: 6, r: 15, cx: 10, cy: -5 });
    expect(parseEntity(["drážka", "40", "10", "úhel", "45"])).toMatchObject({ type: "slot", length: 40, width: 10, angle: 45 });
    expect(parseEntity(["čára", "0", "0", "50", "0", "50", "30", "uzavřít"])).toMatchObject({ type: "polyline", points: [[0, 0], [50, 0], [50, 30]], closed: true });
    expect(parseEntity(["pomocná", "úsečka", "0", "0", "10", "10"])).toMatchObject({ type: "line", construction: true, a: [0, 0], b: [10, 10] });
    expect(parseEntity(["kružnice", "poloměr", "7"])).toMatchObject({ type: "circle", r: 7 });
    expect(() => parseEntity(["kružnice"])).toThrow(/průměr/);
  });

  it("skica s entitami na dalších řádcích, vysunutí skrz s odebráním, rotace kolem osy X", () => {
    const p = parseAgentText(`skica XZ odsazení 5
obdélník 20 10 v 30 0
kružnice 6 v 30 0
vysunout skrz odebrat symetricky
rotovat 180 osa X`);
    expect(p.errors).toEqual([]);
    expect(feat(p, 0)).toMatchObject({ type: "sketch", plane: { name: "XZ", offset: 5 } });
    expect(p.ops[1]).toMatchObject({ k: "entities" });
    expect((p.ops[1] as { entities: unknown[] }).entities).toHaveLength(1);
    expect((p.ops[2] as { entities: unknown[] }).entities).toHaveLength(1);
    expect(feat(p, 3)).toMatchObject({ type: "extrude", extent: { kind: "throughAll" }, mode: "cut", symmetric: true });
    expect(feat(p, 4)).toMatchObject({ type: "revolve", angle: 180, axisDef: { kind: "global", axis: "X" } });
  });

  it("zaoblení / sražení / skořepina s pravidly jdou jako výběr, bez pravidla jako prvek; pole lineární 2D; zrcadlení; text", () => {
    const p = parseAgentText(`zaoblit 2 hrany svislé
srazit 1 hrany horní kruhové poloměr 9
skořepina 2 otevřít +Z
zaoblit 3
pole 4 rozteč 25 směr X 3 rozteč 20 směr Y
zrcadlit YZ
text "MN" výška 8 hloubka 1 v 10 20 gravírovat
smazat poslední
stav
zobraz horní`);
    expect(p.errors).toEqual([]);
    expect(p.ops[0]).toMatchObject({ k: "select", rule: ["svisle"], feature: { type: "fillet", radius: 2 } });
    expect(p.ops[1]).toMatchObject({ k: "select", rule: ["horni", "kruhove", "r=9"], feature: { type: "chamfer", distance: 1 } });
    expect(p.ops[2]).toMatchObject({ k: "select", rule: ["+z"], feature: { type: "shell", thickness: 2 } });
    expect(p.ops[3]).toMatchObject({ k: "feature", feature: { type: "fillet", radius: 3, edges: "all" } });
    expect(feat(p, 4)).toMatchObject({ type: "pattern", kind: "linear", count: 4, spacing: 25, direction: [1, 0, 0], count2: 3, spacing2: 20, direction2: [0, 1, 0] });
    expect(feat(p, 5)).toMatchObject({ type: "mirror", plane: "YZ", keepOriginal: true });
    expect(feat(p, 6)).toMatchObject({ type: "text", text: "MN", height: 8, depth: 1, position: [10, 20], mode: "cut" });
    expect(p.ops[6]).toMatchObject({ fillTop: true });
    expect(p.ops.slice(7).map((o) => o.k)).toEqual(["pop", "status", "view"]);
    expect(p.ops[9]).toMatchObject({ k: "view", view: "top" });
  });

  it("materiál: známá třída → hustota, jiný text → označení do razítka", () => {
    const p = parseAgentText("materiál nerez\nmateriál ČSN 11 423\nmaterial Hliník");
    expect(p.errors).toEqual([]);
    expect(p.ops[0]).toMatchObject({ k: "meta", patch: { material: "nerez" } });
    expect(p.ops[1]).toMatchObject({ k: "meta", patch: { materialName: "ČSN 11 423" } });
    expect(p.ops[2]).toMatchObject({ k: "meta", patch: { material: "hlinik" } });
    const t = docStatusText({ ...emptyDoc("X"), material: "ocel", materialName: "ČSN 11 423" }, null);
    expect(t).toContain("materiál ČSN 11 423 (hustota podle: Ocel)");
  });

  it("chyby jsou po řádcích se srozumitelným textem, ostatní řádky se provedou", () => {
    const p = parseAgentText(`kvádr 10 10
blabla 5
válec 20 30`);
    expect(p.ops).toHaveLength(1);
    expect(feat(p, 0)).toMatchObject({ type: "cylinder" });
    expect(p.errors).toHaveLength(2);
    expect(p.errors[0]).toMatchObject({ line: 1, message: expect.stringMatching(/kvádr X Y Z/) });
    expect(p.errors[1]).toMatchObject({ line: 2, message: expect.stringMatching(/neznámý příkaz „blabla“/) });
    expect(parseAgentText("   ").errors[0].message).toMatch(/Prázdný/);
  });
});

describe("JSON vstup", () => {
  it("celý dokument .mncad → op doc; pole prvků → op features s doplněnými id, názvy a výchozími poli", () => {
    const doc = { app: "mnastrojarna-cad", version: 2, name: "Deska", material: "ocel", features: [{ type: "box", size: [10, 20, 5] }] };
    const p = parseAgentText(JSON.stringify(doc));
    expect(p.errors).toEqual([]);
    expect(p.ops[0].k).toBe("doc");
    const d = (p.ops[0] as { doc: CadDoc }).doc;
    expect(d.features[0]).toMatchObject({ type: "box", size: [10, 20, 5], position: [0, 0, 0], centered: false, mode: "add", name: "Kvádr 1" });
    expect(typeof d.features[0].id).toBe("string");
    const p2 = parseAgentText(JSON.stringify([{ type: "cylinder", radius: 5, height: 10 }, { type: "fillet", radius: 1 }]));
    expect(p2.ops[0]).toMatchObject({ k: "features" });
    const fs = (p2.ops[0] as { features: Feature[] }).features;
    expect(fs[0]).toMatchObject({ type: "cylinder", axis: "Z", mode: "add", name: "Válec 1" });
    expect(fs[1]).toMatchObject({ type: "fillet", edges: "all", name: "Zaoblení 1" });
    const p3 = parseAgentText('{"type":"sphere","radius":4}');
    expect((p3.ops[0] as { features: Feature[] }).features[0]).toMatchObject({ type: "sphere", radius: 4, position: [0, 0, 0] });
  });
  it("neznámý typ a rozbitý JSON hlásí chybu", () => {
    const { features, errors } = normalizeFeatures([{ type: "warp" }, "x", { type: "box", size: [1, 1, 1] }]);
    expect(features).toHaveLength(1);
    expect(errors[0]).toMatch(/neznámý typ „warp“/);
    expect(errors[1]).toMatch(/není objekt/);
    expect(parseAgentText("{nope").errors[0].message).toMatch(/JSON nelze přečíst/);
  });
  it("FEATURE_TYPES odpovídá typům v types.ts", () => {
    const src = readFileSync(new URL("./types.ts", import.meta.url), "utf8");
    const block = src.slice(src.indexOf("export type Feature ="), src.indexOf("export type FeatureType"));
    const inTypes = new Set([...block.matchAll(/\|\s*\{\s*type: "([a-zA-Z]+)"/g)].map((m) => m[1]));
    expect([...inTypes].sort()).toEqual([...FEATURE_TYPES].sort());
  });
});

describe("výběr hran a ploch pravidlem", () => {
  const bbox: Bbox = [[0, 0, 0], [100, 50, 20]];
  const edges = [
    { index: 0, curve: "Úsečka", dir: [1, 0, 0] as [number, number, number], center: [50, 0, 20] as [number, number, number], length: 100 },
    { index: 1, curve: "Úsečka", dir: [0, 0, 1] as [number, number, number], center: [0, 0, 10] as [number, number, number], length: 20 },
    { index: 2, curve: "Kružnice", radius: 9, center: [30, 25, 20] as [number, number, number], length: 56.5 },
    { index: 3, curve: "Kružnice", radius: 9, center: [30, 25, 0] as [number, number, number], length: 56.5 },
    { index: 4, curve: "Úsečka", dir: [0, 1, 0] as [number, number, number], center: [100, 25, 0] as [number, number, number], length: 50 },
  ];
  it("horní, spodní, svislé, vodorovné, kruhové, poloměr, délka, kombinace", () => {
    expect(selectEdges(["horni"], edges, bbox)).toEqual([0, 2]);
    expect(selectEdges(["spodni"], edges, bbox)).toEqual([3, 4]);
    expect(selectEdges(["svisle"], edges, bbox)).toEqual([1]);
    expect(selectEdges(["vodorovne"], edges, bbox)).toEqual([0, 4]);
    expect(selectEdges(["kruhove"], edges, bbox)).toEqual([2, 3]);
    expect(selectEdges(["horni", "kruhove"], edges, bbox)).toEqual([2]);
    expect(selectEdges(["r=9"], edges, bbox)).toEqual([2, 3]);
    expect(selectEdges(["len>60"], edges, bbox)).toEqual([0]);
    expect(selectEdges(["+x"], edges, bbox)).toEqual([4]);
    expect(() => selectEdges(["modre"], edges, bbox)).toThrow(/neznámé pravidlo/);
  });
  it("plochy: +Z (nejvýš položená rovinná plocha s normálou +Z), boční, válcové, největší", () => {
    const faces = [
      { index: 0, planar: true, normal: [0, 0, 1] as [number, number, number], center: [50, 25, 20] as [number, number, number], area: 5000 },
      { index: 1, planar: true, normal: [0, 0, 1] as [number, number, number], center: [10, 10, 10] as [number, number, number], area: 100 },
      { index: 2, planar: true, normal: [1, 0, 0] as [number, number, number], center: [100, 25, 10] as [number, number, number], area: 1000 },
      { index: 3, planar: false, surface: "Válec", center: [30, 25, 10] as [number, number, number], area: 300 },
    ];
    expect(selectFaces(["+z"], faces, bbox)).toEqual([0]);
    expect(selectFaces(["horni"], faces, bbox)).toEqual([0]);
    expect(selectFaces(["bocni"], faces, bbox)).toEqual([2]);
    expect(selectFaces(["valcove"], faces, bbox)).toEqual([3]);
    expect(selectFaces(["nejvetsi"], faces, bbox)).toEqual([0]);
    expect(selectFaces(["+x"], faces, bbox)).toEqual([2]);
  });
});

describe("stav dokumentu jako text", () => {
  it("shrne dokument, rozměry, prvky se stavem a souhrnem", () => {
    const doc: CadDoc = { ...emptyDoc("Deska"), features: [
      { id: "s1", name: "Skica 1", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "e1", type: "rect", cx: 0, cy: 0, w: 100, h: 50, r: 0, angle: 0 }] },
      { id: "x1", name: "Vysunutí 1", type: "extrude", sketchId: "s1", distance: 20, symmetric: false, reverse: false, mode: "new" },
      { id: "h1", name: "Díra 1", type: "hole", position: [30, 25, 20], axis: "Z", flip: false, diameter: 18, depth: 0, cbDiameter: 0, cbDepth: 0 },
    ] };
    const t = docStatusText(doc, { status: [{ id: "s1", ok: true }, { id: "x1", ok: true }, { id: "h1", ok: false, error: "Díra je mimo těleso." }], mesh: null, metrics: { volume: 97456, area: 1, bbox: [[-50, -25, 0], [50, 25, 20]], faces: 8, edges: 18 }, bodies: [{ name: "Těleso 1", faces: [], edges: [], volume: 1, area: 1, createdBy: "x1" }], ms: 3 });
    expect(t).toContain("Dokument: „Deska“ · díl · materiál Ocel (7.85 g/cm³) · prvků 3 (2 ✓, 1 ✗) · těles 1");
    expect(t).toContain("Rozměry: 100 × 50 × 20 mm");
    expect(t).toContain("objem 97,46 cm³ · ploch 8 · hran 18");
    expect(t).toContain("1. Skica 1 [sketch, id s1] ✓ – rovina XY, 1 entit: obdélník 100×50");
    expect(t).toContain("2. Vysunutí 1 [extrude, id x1] ✓ – 20 mm, new");
    expect(t).toContain("3. Díra 1 [hole, id h1] ✗ Díra je mimo těleso. – Ø18 skrz v [30; 25; 20], osa Z");
  });
  it("seznam příkazů existuje pro nápovědu", () => {
    expect(AGENT_COMMANDS.length).toBeGreaterThan(15);
    expect(AGENT_COMMANDS.some((c) => c.cmd.startsWith("díra"))).toBe(true);
  });
});

describe("povrch tělesa v daném místě (síť)", () => {
  // deska 0..100 × 0..60 ve výšce z=10 (2 trojúhelníky) + „náboj“ 40..60 × 20..40 ve výšce z=30
  const V = new Float32Array([0, 0, 10, 100, 0, 10, 100, 60, 10, 0, 60, 10, 40, 20, 30, 60, 20, 30, 60, 40, 30, 40, 40, 30]);
  const T = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  it("vrátí výšku desky vedle náboje, výšku náboje nad ním a null mimo těleso", () => {
    expect(topAt({ vertices: V, triangles: T }, "Z", 20, 30)).toBe(10);
    expect(topAt({ vertices: V, triangles: T }, "Z", 50, 30)).toBe(30);
    expect(topAt({ vertices: V, triangles: T }, "Z", 150, 30)).toBeNull();
    expect(topAt(null, "Z", 1, 1)).toBeNull();
  });
});
