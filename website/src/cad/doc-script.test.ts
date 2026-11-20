/**
 * Dokument → textový skript (doc-script.ts): zápis podle typu prvku, čísla a uvozovky, jazyky, stabilita, názvy, otisky,
 * sestava (díl jednou, vložení N×, vazby #k, pohyb), výkresy, zápasní zápisy (obecný prvek, JSON). Bez jádra – kontrolu
 * geometrie tam a zpět dělá doc-script.roundtrip.test.ts.
 */
import { describe, expect, it } from "vitest";
import { parseAgentText, type AgentOp } from "./agent";
import { docToScript, scriptNum, scriptQuote, SCRIPT_SHEET_DEFAULTS } from "./doc-script";
import { NEW_DRAWING_OPTIONS } from "./drawing-agent";
import type { CadDoc, Feature } from "./types";
import "./ext/index";
import "./feat/index";

const part = (name: string, features: unknown[], extra: Partial<CadDoc> = {}): CadDoc => ({ app: "mnastrojarna-cad", version: 2, name, material: "ocel", kind: "part", features: features as Feature[], ...extra });
const body = (text: string) => text.split("\n").filter((l) => l && !l.startsWith("#"));
/** typy prvků tak, jak je skript přečte konzole (bez chyb) */
function reparse(text: string) {
  const p = parseAgentText(text);
  expect(p.errors.map((e) => `${e.line}: ${e.message}`)).toEqual([]);
  const feats: Feature[] = [];
  for (const op of p.ops as AgentOp[]) {
    if (op.k === "feature" || op.k === "select" || op.k === "sketchOn") feats.push(op.feature);
    else if (op.k === "features") feats.push(...op.features);
  }
  return { ops: p.ops as AgentOp[], feats };
}

describe("čísla a uvozovky", () => {
  it("nejkratší přesný zápis bez exponentu", () => {
    expect(scriptNum(0.1)).toBe("0.1");
    expect(scriptNum(-0)).toBe("0");
    expect(scriptNum(1e-7)).toBe("0.0000001");
    expect(scriptNum(1e21)).toBe("1000000000000000000000");
    expect(scriptNum(0.1 + 0.2)).toBe("0.30000000000000004");
    expect(scriptNum(-12.5)).toBe("-12.5");
    for (const v of [1 / 3, 2.5e-9, 123456.789, 5e-324]) expect(Number(scriptNum(v))).toBe(v);
  });
  it("uvozovky jen když jsou potřeba; text s „#“ / „//“ jde do uvozovek, konec řádku zapsat nejde", () => {
    expect(scriptQuote("Deska")).toBe("Deska");
    expect(scriptQuote("Deska horní")).toBe('"Deska horní"');
    expect(scriptQuote('Čep 1/2"')).toBe('„Čep 1/2"“');
    expect(scriptQuote('a " „b“')).toBe("'a \" „b“'");
    expect(scriptQuote("12")).toBe('"12"');
    expect(scriptQuote("Deska", true)).toBe('"Deska"');
    expect(scriptQuote("levá // pravá")).toBe('"levá // pravá"');
    expect(scriptQuote("a #b")).toBe('"a #b"');
    expect(scriptQuote("a\nb")).toBeNull();
  });
});

/** označení závitu tak, jak ho ukládá textový příkaz */
const M18 = (parseAgentText("závit M18×1,5 délka 12").ops[0] as { feature: { designation: string } }).feature.designation;
const ALL_TYPES = part("Vzorek", [
  { id: "b", name: "Kvádr 1", type: "box", size: [80, 60, 20], position: [0, 0, 0], centered: false, mode: "new" },
  { id: "c", name: "Válec 1", type: "cylinder", radius: 5, height: 30, position: [10, 10, 0], axis: "X", mode: "cut" },
  { id: "sp", name: "Koule 1", type: "sphere", radius: 4, position: [40, 30, 20], mode: "add" },
  { id: "co", name: "Kužel 1", type: "cone", radius1: 6, radius2: 0, height: 5, position: [20, 20, 20], axis: "Z", mode: "cut", dirDef: { kind: "vector", v: [0, 0, -1] } },
  { id: "tu", name: "Trubka 1", type: "tube", outer: 20, inner: 12, height: 8, position: [60, 30, 20], axis: "Z", mode: "add" },
  { id: "s1", name: "Skica 1", type: "sketch", plane: { kind: "base", name: "XY", offset: 20 }, entities: [
    { id: "e1", type: "rect", cx: 20, cy: 15, w: 10, h: 6, r: 1, angle: 30 },
    { id: "e2", type: "circle", cx: 0, cy: 0, r: 2.5, construction: true },
    { id: "e3", type: "polygon", cx: 50, cy: 40, r: 5, sides: 6, angle: 0 },
    { id: "e4", type: "slot", cx: 60, cy: 10, length: 12, width: 4, angle: 90 },
    { id: "e5", type: "ellipse", cx: 30, cy: 45, rx: 6, ry: 3, angle: 0 },
    { id: "e6", type: "point", p: [1, 2] },
  ] },
  { id: "x1", name: "Vysunutí 1", type: "extrude", sketchId: "s1", distance: 3, symmetric: false, reverse: true, mode: "cut" },
  { id: "s2", name: "Skica 2", type: "sketch", plane: { kind: "custom", origin: [0, 0, 20], normal: [0, 0.6, 0.8], xDir: [1, 0, 0] }, entities: [
    { id: "e1", type: "polyline", points: [[5, 5], [15, 5], [15, 12]], closed: true },
    { id: "e2", type: "line", a: [0, 0], b: [3, 0], construction: true },
    { id: "e3", type: "arc", a: [0, 0], b: [1, 1], c: [2, 0], construction: true },
    { id: "e4", type: "spline", points: [[0, 0], [2, 3], [5, 1]], closed: false, construction: true },
  ] },
  { id: "x2", name: "Kapsa", type: "extrude", sketchId: "s2", distance: 1, symmetric: false, reverse: false, mode: "cut", extent: { kind: "throughAll" }, draftAngle: -2, draftLand: 1.5, draftCorners: "sharp" },
  { id: "s3", name: "Skica 3", type: "sketch", plane: { kind: "base", name: "XZ", offset: 0 }, entities: [{ id: "e1", type: "polyline", points: [[0, 30], [4, 30], [4, 34], [0, 34]], closed: true }] },
  { id: "r1", name: "Rotace 1", type: "revolve", sketchId: "s3", angle: 180, axis: "y", mode: "add", axisDef: { kind: "global", axis: "Z" } },
  { id: "h1", name: "Díra 1", type: "hole", position: [10, 50, 20], axis: "Z", flip: false, diameter: 6.6, depth: 0, cbDiameter: 11, cbDepth: 6.5, kind: "counterbore", points: [{ kind: "xyz", p: [10, 50, 20] }, { kind: "xyz", p: [70, 50, 20] }] },
  { id: "h2", name: "Díra 2", type: "hole", position: [40, 10, 20], axis: "Z", flip: false, diameter: 6.8, depth: 14, cbDiameter: 0, cbDepth: 0, kind: "tapped", thread: "M8", threadDepth: 10 },
  { id: "h3", name: "Šikmá", type: "hole", position: [40, 50, 20], axis: "Z", flip: true, diameter: 4, depth: 0, cbDiameter: 0, cbDepth: 0, dirDef: { kind: "vector", v: [0, 0.6, -0.8] } },
  { id: "p1", name: "Pole 1", type: "pattern", featureId: "h3", kind: "linear", count: 3, spacing: 8, direction: [1, 0, 0] },
  { id: "f1", name: "Zaoblení 1", type: "fillet", radius: 2, edges: [3, 0] },
  { id: "ch", name: "Sražení 1", type: "chamfer", distance: 1, edges: "all" },
  { id: "sh", name: "Skořepina 1", type: "shell", thickness: 2, faces: [4] },
  { id: "mi", name: "Zrcadlení 1", type: "mirror", plane: "YZ", offset: 5, keepOriginal: true },
  { id: "tx", name: "Text 1", type: "text", text: "MN 17", height: 6, depth: 0.5, plane: { kind: "base", name: "XY", offset: 20 }, position: [5, 30], angle: 0, mode: "cut" },
  { id: "th", name: "Závit 1", type: "thread", designation: M18, position: [0, 0, 20], axis: "Z", length: 12, modeled: false, internal: true },
  { id: "sb", name: "Rozdělení 1", type: "splitBodies", plane: "XY", offset: 10, nameB: "Spodek" },
  { id: "cb", name: "Kopie tělesa 1", type: "copyBody", source: "Spodek", translate: [0, 0, -30], newName: "Kopie" },
  { id: "cm", name: "Sloučení 1", type: "combine", target: "Těleso 1", tool: "Kopie", op: "add", keepTool: false },
]);

describe("zápis prvků vlastními příkazy", () => {
  const r = docToScript(ALL_TYPES);
  it("každý typ má vlastní příkaz a skript se čte bez chyb", () => {
    for (const [type, s] of Object.entries(r.stats.byType)) expect(s, type).toMatchObject({ generic: 0, json: 0 });
    expect(r.stats.dedicated).toBe(ALL_TYPES.features.length);
    const { feats } = reparse(r.text);
    expect(feats.map((f) => f.type)).toEqual(ALL_TYPES.features.map((f) => f.type));
    expect(r.notes).toEqual([]);
  });
  it("čitelné řádky: čísla bez nul navíc, výchozí názvy se nepíšou, vlastní název v uvozovkách", () => {
    const l = body(r.text);
    expect(l[0]).toBe('nový díl "Vzorek"');
    expect(l).toContain("kvádr 80 60 20");
    expect(l).toContain("válec 10 30 v 10 10 0 osa X odebrat");
    expect(l).toContain("kužel 12 0 5 v 20 20 20 osa -Z odebrat");
    expect(l).toContain("skica XY odsazení 20");
    expect(l).toContain("  obdélník 10 6 v 20 15 zaoblení-rohů 1 úhel 30");
    expect(l).toContain("  pomocná kružnice 5");
    expect(l).toContain("  čára 5 5 15 5 15 12 uzavřít");
    expect(l).toContain("vysunout 3 obráceně odebrat");
    expect(l).toContain('vysunout skrz odebrat úkos -2 břit 1.5 název "Kapsa"');
    expect(l).toContain("rotovat 180 osa Z");
    expect(l).toContain("díra 6.6 skrz v 10 50 20 v 70 50 20 zahloubení 11 6.5");
    expect(l).toContain("díra 6.8 hloubka 14 v 40 10 20 závit M8 hloubka-závitu 10");
    expect(l).toContain('díra 4 skrz v 40 50 20 směr 0 0.6 -0.8 název "Šikmá"');
    expect(l).toContain("pole 3 rozteč 8 směr X");
    expect(l).toContain("zaoblit 2 hrany E4 E1");
    expect(l).toContain("skořepina 2 otevřít F5");
    expect(l).toContain("zrcadlit YZ odsazení 5");
    expect(l).toContain('text "MN 17" výška 6 hloubka 0.5 v 5 30 20 gravírovat');
    expect(l).toContain('rozdělit XY odsazení 10 jako "Spodek"');
    expect(l).toContain('sloučit "Těleso 1" "Kopie"');
  });
  it("stejný dokument → stejný text; anglicky a německy stejné pokrytí a čitelný skript", () => {
    expect(docToScript(ALL_TYPES).text).toBe(r.text);
    for (const lang of ["en", "de"] as const) {
      const x = docToScript(ALL_TYPES, { lang });
      expect(x.stats.dedicated, lang).toBe(r.stats.dedicated);
      expect(reparse(x.text).feats.map((f) => f.type)).toEqual(ALL_TYPES.features.map((f) => f.type));
    }
    // skript pro anglické / německé rozhraní: české automatické názvy by tam vznikly jinak („Cylinder 1“) → názvy výslovně
    expect(body(docToScript(ALL_TYPES, { lang: "en" }).text)).toContain('cylinder 10 30 at 10 10 0 axis X cut name "Válec 1"');
    expect(body(docToScript(ALL_TYPES, { lang: "de" }).text)).toContain('zylinder 10 30 bei 10 10 0 achse X abziehen name "Válec 1"');
  });
  it('names: "all" píše název u každého prvku; komentáře lze vypnout', () => {
    const x = docToScript(ALL_TYPES, { names: "all", comments: false });
    expect(x.text.startsWith("nový díl")).toBe(true);
    expect(body(x.text)).toContain('kvádr 80 60 20 název "Kvádr 1"');
    expect(reparse(x.text).feats.map((f) => f.name)).toEqual(ALL_TYPES.features.map((f) => f.name));
  });
});

describe("záložní zápisy a ověření", () => {
  it("prvek bez vlastního příkazu = obecný `prvek`, co nejde ani tak = jednořádkový JSON", () => {
    const d = part("Z", [
      { id: "b", name: "Kvádr 1", type: "box", size: [10, 10, 10], position: [0, 0, 0], centered: false, mode: "new" },
      { id: "t", name: "Přesun 1", type: "transform", translate: [5, 0, 0], rotateAxis: "Z", rotateAngle: 0, scale: 1 },
      // spline s tečnami textový příkaz skici nemá → celá skica jako JSON
      { id: "s", name: "Skica 1", type: "sketch", plane: { kind: "base", name: "XY", offset: 10 }, entities: [{ id: "q7", type: "spline", points: [[0, 0], [5, 5], [10, 0]], closed: false, tangents: [45, null, null] }] },
    ]);
    const r = docToScript(d);
    expect(r.stats).toMatchObject({ dedicated: 1, generic: 1, json: 1 });
    const l = body(r.text);
    expect(l[2]).toBe("prvek transform translate=5;0;0 rotateAxis=Z rotateAngle=0 scale=1");
    expect(l[3].startsWith('{"id":"s","name":"Skica 1","type":"sketch"')).toBe(true);
    expect(reparse(r.text).feats.map((f) => f.type)).toEqual(["box", "transform", "sketch"]);
  });
  it("název, který je zároveň slovem volby („Střed“), se nezapíše chybně", () => {
    const d = part("N", [{ id: "b", name: "Střed", type: "box", size: [10, 10, 10], position: [0, 0, 0], centered: false, mode: "new" }]);
    const r = docToScript(d);
    // „kvádr 10 10 10 název "Střed"“ by parser četl jako vystředěný kvádr → vlastní příkaz bez názvu a přejmenování
    expect(body(r.text).slice(1)).toEqual(["kvádr 10 10 10", 'přejmenovat poslední na "Střed"']);
    const f = reparse(r.text).feats[0] as Extract<Feature, { type: "box" }>;
    expect(f.centered).toBe(false);
    expect(r.stats.dedicated).toBe(1);
  });
  it("otisky výběru: výchozí zápis je zachová obecným příkazem (poznámka), sigs: drop píše jen uložená čísla", () => {
    const sig = { t: "line", c: [0, 0, 5], s: 10 };
    const d = part("S", [
      { id: "b", name: "Kvádr 1", type: "box", size: [10, 10, 10], position: [0, 0, 0], centered: false, mode: "new" },
      { id: "c", name: "Sražení 1", type: "chamfer", distance: 1, edges: [2, 5], edgeSigs: { "2": sig, "5": sig } },
    ]);
    const drop = docToScript(d, { sigs: "drop" });
    expect(body(drop.text)[2]).toBe("srazit 1 hrany E3 E6");
    expect(drop.notes.join(" ")).toContain("otisky výběru");
    for (const keep of [docToScript(d), docToScript(d, { sigs: "keep" })]) {
      expect(keep.stats.byType.chamfer).toEqual({ dedicated: 0, generic: 1, json: 0 });
      expect((reparse(keep.text).feats[1] as { edgeSigs?: unknown }).edgeSigs).toEqual({ "2": sig, "5": sig });
      expect(keep.notes.join(" ")).toContain("otisky výběru");
    }
  });
  it("vazby a kóty skici vlastními příkazy; proměnné, vazba parametru, potlačení a konfigurace jako úpravy", () => {
    const d = part("V", [
      { id: "s", name: "Skica 1", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "e1", type: "line", a: [0, 0], b: [40, 0] }, { id: "e2", type: "line", a: [40, 0], b: [40, 25] }], constraints: [{ id: "c1", type: "horizontal", refs: [{ e: "e1", k: "self" }] }, { id: "c2", type: "perpendicular", refs: [{ e: "e1", k: "self" }, { e: "e2", k: "self" }] }], dims: [{ id: "k1", type: "length", refs: [{ e: "e1", k: "self" }], value: 40, driving: true }] },
      { id: "b", name: "Kvádr 1", type: "box", size: [10, 10, 10], position: [0, 0, 0], centered: false, mode: "new", suppressed: true },
    ], { variables: [{ name: "L", expr: "2*5 + 10" }], bindings: { "b:size.0": "L" }, configs: [{ id: "k", name: "Krátká", values: { L: 12 }, suppressed: ["b"] }], activeConfig: "k" });
    const r = docToScript(d);
    const l = body(r.text);
    expect(l).toContain("proměnná L = 2*5 + 10");
    expect(l).toContain("  vazba vodorovně e1");
    expect(l).toContain("  vazba kolmo e1 e2");
    expect(l).toContain("  kóta délka e1 40");
    // potlačení a vazba parametru míří na poslední prvek; konfigurace na název – ten je proto u prvku výslovně
    expect(l).toContain('kvádr 10 10 10 název "Kvádr 1"');
    expect(l).toContain("upravit poslední size.0==L");
    expect(l).toContain("potlačit poslední");
    expect(l).toContain('konfigurace "Krátká" L=12 potlačit "Kvádr 1"');
    expect(l).toContain('konfigurace aktivní "Krátká"');
    expect(r.stats.byType.sketch.dedicated).toBe(1);
    expect(r.stats.byType.box.dedicated).toBe(1);
    const kinds = reparse(r.text).ops.filter((o) => o.k === "edit").map((o) => (o as { cmd: { kind: string } }).cmd.kind);
    expect(kinds).toEqual(["var", "edit", "suppress", "config", "configActive"]);
  });
  it("2D výkres = jeden řádek JSON, který konzole otevře jako dokument", () => {
    const d = { app: "mnastrojarna-cad", version: 2, name: "Výkres 2D", material: "ocel", kind: "draft", features: [], draft: { v: 1, id: "x", seq: 1, vars: {}, layers: [], linetypes: [], textStyles: [], entities: [{ id: "e1", type: "line", layer: "0", a: [0, 0], b: [10, 0] }] } } as unknown as CadDoc;
    const r = docToScript(d);
    expect(r.notes.join(" ")).toContain("2D výkres");
    const p = parseAgentText(body(r.text).join("\n"));
    expect(p.errors).toEqual([]);
    expect(p.ops[0].k).toBe("doc");
  });
});

describe("sestava", () => {
  const plate = part("Deska", [{ id: "b", name: "Kvádr 1", type: "box", size: [100, 60, 10], position: [0, 0, 0], centered: false, mode: "new" }], { props: { number: "MN-01" } });
  const pin = part("Čep", [{ id: "c", name: "Válec 1", type: "cylinder", radius: 4, height: 30, position: [0, 0, 0], axis: "Z", mode: "new" }], { materialName: "ČSN 11 600" });
  const asm: CadDoc = {
    app: "mnastrojarna-cad", version: 2, name: "Sestava A", material: "ocel", kind: "assembly", features: [],
    components: [
      { id: "k1", name: "Deska", source: { kind: "part", doc: plate }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] }, fixed: true, group: "Desky" },
      { id: "k2", name: "Čep", source: { kind: "part", doc: pin }, placement: { position: [20, 30, 10], rotation: [0, 0, 0] } },
      { id: "k3", name: "Čep levý", source: { kind: "part", doc: pin }, placement: { position: [80, 30, 10], rotation: [180, 0, 0] }, hidden: true },
    ],
    mates: [
      { id: "m1", type: "concentric", a: { compId: "k2", face: 0 }, b: { compId: "k1", face: 6 } },
      { id: "m2", type: "distance", a: { compId: "k2", face: 1 }, b: { compId: "k1", face: 5 }, value: 12.5, name: "Vůle" },
      { id: "m3", type: "lock", a: { compId: "k3", face: -1 }, b: { compId: "k1", face: -1 }, rel: { position: [80, 30, 10], rotation: [180, 0, 0] }, suppressed: true },
      { id: "m4", type: "limitDistance", a: { compId: "k2", face: 1 }, b: { compId: "k1", face: 5 }, min: 0, max: 20 },
      { id: "m5", type: "mate", a: { compId: "k3", face: 2 }, b: { compId: "k1", face: 2 }, center: true },
      { id: "m6", type: "mate", a: { compId: "k3", face: 1 }, b: { compId: "k1", face: 4 }, flip: true },
    ],
    motion: { motors: [{ id: "mo", kind: "linear", mate: "m2", from: 12.5, to: 2 }], duration: 2, steps: 9, collisions: true },
  };
  const r = docToScript(asm);
  it("stejný díl jednou, vložení s polohou, údaje komponent, vazby pořadím #k, pohyb", () => {
    const l = body(r.text);
    expect(l.filter((x) => x.startsWith("nový díl"))).toEqual(['nový díl "Deska"', 'nový díl "Čep"']);
    expect(l).toContain("materiál ČSN 11 600");
    expect(l).toContain('nová sestava "Sestava A"');
    expect(l).toContain('vložit "Deska" ukotvit');
    expect(l).toContain('sestava komponenta #1 číslo "MN-01" skupina "Desky"');
    expect(l).toContain('vložit "Čep" v 20 30 10');
    expect(l).toContain('vložit "Čep" v 80 30 10 otočení 180 0 0');
    expect(l).toContain('sestava komponenta #3 název "Čep levý" skrýt');
    expect(l).toContain("sestava vazba souosost #2 F1 #1 F7");
    expect(l).toContain('sestava vazba vzdálenost #2 F2 #1 F6 hodnota 12.5 název "Vůle"');
    expect(l).toContain("sestava vazba zámek #3 #1");
    expect(l).toContain("sestava vazba mez vzdálenosti #2 F2 #1 F6 min 0 max 20");
    expect(l).toContain("sestava vazba vystředit #3 F3 #1 F3");
    expect(l).toContain("sestava vazba kontakt #3 F2 #1 F5 obráceně");
    expect(l).toContain("sestava vazba 3 potlačit");
    expect(l).toContain("pohyb motor lineární vazba 2 12.5..2 kroky 9 čas 2 kolize");
    expect(r.stats).toMatchObject({ parts: 2, components: 3, mates: 6, matesText: 6 });
    expect(r.notes.join(" ")).not.toContain("vazbu sestavy");
  });
  it("skript se čte bez chyb česky, anglicky i německy", () => {
    for (const lang of ["cs", "en", "de"] as const) {
      const { ops } = reparse(docToScript(asm, { lang }).text);
      expect(ops.filter((o) => o.k === "insert").length, lang).toBe(3);
      const asmOps = ops.filter((o) => o.k === "asm").map((o) => (o as { cmd: { k: string; kind?: string; cmd?: { op: string } } }).cmd);
      expect(asmOps.filter((c) => c.k === "mate").map((c) => c.kind), lang).toEqual(["concentric", "distance", "lock", "limitDistance", "center", "mate"]);
      expect(asmOps.filter((c) => c.k === "motion").map((c) => c.cmd?.op), lang).toEqual(["motor"]);
    }
  });
  it("dva různé díly se stejným názvem dostanou ve skriptu různé názvy záložek (poznámka)", () => {
    const other = part("Čep", [{ id: "c", name: "Válec 1", type: "cylinder", radius: 5, height: 30, position: [0, 0, 0], axis: "Z", mode: "new" }]);
    const d: CadDoc = { ...asm, mates: [], motion: undefined, components: [...asm.components!, { id: "k4", name: "Čep", source: { kind: "part", doc: other }, placement: { position: [0, 0, 50], rotation: [0, 0, 0] } }] };
    const x = docToScript(d);
    const l = body(x.text);
    expect(l).toContain('nový díl "Čep (2)"');
    expect(l).toContain('vložit "Čep (2)" v 0 0 50');
    expect(l).toContain('sestava komponenta #4 název "Čep"');
    expect(x.notes.join(" ")).toContain("stejný název");
  });
  it("komponenta z importovaného souboru se nepřenáší a skript to řekne", () => {
    const d: CadDoc = { ...asm, mates: [{ id: "m9", type: "lock", a: { compId: "kf", face: -1 }, b: { compId: "k1", face: -1 } }], motion: undefined, components: [...asm.components!, { id: "kf", name: "Import", source: { kind: "file", fileName: "a.step", format: "step", data: "" }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } }] };
    const x = docToScript(d);
    expect(x.stats).toMatchObject({ components: 3, mates: 1, matesText: 0 });
    const notes = x.notes.join(" | ");
    expect(notes).toContain("komponenty z importovaného souboru a podsestavy se do skriptu nepřenášejí: 1 z 4");
    expect(notes).toContain("vazbu sestavy č. 1 (lock) nejde zapsat textem");
  });
});

describe("výkresy", () => {
  it("výchozí volby nového listu odpovídají aplikaci (jinak by skript vynechal volbu, která výchozí není)", () => {
    for (const [k, v] of Object.entries(SCRIPT_SHEET_DEFAULTS)) expect((NEW_DRAWING_OPTIONS as unknown as Record<string, unknown>)[k], k).toEqual(v);
  });
  it("listy, volby, razítko a kóty", () => {
    const d = part("Hřídel", [{ id: "c", name: "Válec 1", type: "cylinder", radius: 10, height: 80, position: [0, 0, 0], axis: "Z", mode: "new" }], {
      drawings: [
        { id: "d1", name: "List 1", options: { sheet: "A3", orientation: "landscape", scale: 0.5, projection: "E", views: { front: true, top: true, left: false, right: false, back: false, bottom: false, iso: true }, hidden: true, section: { plane: "XZ", offset: -5, kind: "half" }, centerLines: true, dimensions: "smart", holeTable: true, smartGen: "g" }, meta: { name: "Hřídel", number: "MN-7", author: "AI", revision: "", tolerance: "ISO 2768-mK", date: "14. 11. 2026" }, annotations: [{ id: "a1", view: "front", auto: "ov:x", type: "dim", kind: "horizontal", a: [0, 0], b: [20, 0], offset: 8, suffix: " h6" }] },
        { id: "d2", name: "Detail", options: { sheet: "A4", orientation: "portrait", scale: 2, dimensions: "none", views: { front: true, top: false, left: false, right: false, back: false, bottom: false, iso: false } }, meta: {}, annotations: [] },
      ],
    });
    const r = docToScript(d);
    const l = body(r.text);
    expect(l).toContain("výkres A3 měřítko 1:2 pohledy přední,horní,iso řez XZ odsazení 5 poloviční skryté ano tabulka děr ano");
    expect(l).toContain('výkres razítko číslo="MN-7" kreslil="AI" datum="14. 11. 2026" nepředepsané="ISO 2768-mK"');
    expect(l).toContain("kótovat chytře");
    expect(l).toContain('výkres list nový "Detail"');
    expect(l).toContain("výkres A4 na výšku měřítko 2:1 pohledy přední");
    expect(l).toContain("kótovat nic");
    expect(r.stats.sheets).toBe(2);
    expect(r.notes.join(" ")).toContain("úpravy vygenerovaných kót");
    // list 2 s prázdným razítkem: „výkres list nový“ by převzal razítko listu 1 – skript zděděná pole vyprázdní (vlna E)
    expect(l).toContain('výkres razítko číslo="" kreslil="" datum="" nepředepsané=""');
    const cmds = reparse(r.text).ops.filter((o) => o.k === "drawingCmd").map((o) => (o as { cmd: { k: string } }).cmd.k);
    expect(cmds).toEqual(["set", "title", "dim", "sheet", "set", "title", "dim"]);
    // pro německé / anglické rozhraní navíc přejmenování prvního listu („List 1“ by se tam jmenoval „Blatt 1“ / „Sheet 1“)
    expect(body(docToScript(d, { lang: "de" }).text)).toContain('zeichnung blatt umbenennen "List 1"');
    expect(reparse(docToScript(d, { lang: "de" }).text).ops.filter((o) => o.k === "drawingCmd").length).toBe(8);
    expect(reparse(docToScript(d, { lang: "en" }).text).ops.filter((o) => o.k === "drawingCmd").length).toBe(8);
  });
});
