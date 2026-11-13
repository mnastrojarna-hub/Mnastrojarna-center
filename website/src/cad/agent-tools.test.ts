import { describe, expect, it } from "vitest";
import "./ext/index";
import { parseAgentText } from "./agent";
import {
  applySettingsPatch,
  apiActions,
  captureActionApi,
  checkScreenshotOptions,
  coolingReport,
  curvatureReport,
  draftReport,
  ejectorsReport,
  meshInFrame,
  parseApiCommand,
  parseSelectionId,
  partingPlane,
  partingReport,
  resolveAction,
  sectionReport,
  shotSize,
  thicknessReport,
  type ApiCmd,
} from "./agent-api";
import { wallThickness } from "./analysis";
import { coolingCircuit, defaultCooling, draftAnalysis, suggestEjectors } from "./mold";
import { DEFAULT_SETTINGS } from "./settings";
import type { MeshData, Vec3 } from "./types";

const p = (line: string) => parseApiCommand(line.split(/\s+/));
/** první operace programu textových příkazů – jako by řádek prošel konzolí */
const op = (line: string) => {
  const prog = parseAgentText(line);
  if (prog.errors.length) throw new Error(prog.errors[0].message);
  return prog.ops[0];
};
const err = (line: string) => parseAgentText(line).errors[0]?.message ?? "";

/* ── sítě se známým výsledkem ── */
const flat = (v: number[][], faces: number[][]): MeshData => {
  const vertices = new Float32Array(v.flat());
  return { vertices, normals: new Float32Array(vertices.length), triangles: new Uint32Array(faces.flat()), faceGroups: new Int32Array(0), lines: new Float32Array(0), edgeGroups: new Int32Array(0) };
};
/** komolý jehlan (základna size × size, výška h, úkos stěn draftDeg), normály ven */
function frustum(size: number, h: number, draftDeg: number): MeshData {
  const s = size / 2;
  const t = s - h * Math.tan((draftDeg * Math.PI) / 180);
  return flat(
    [[-s, -s, 0], [s, -s, 0], [s, s, 0], [-s, s, 0], [-t, -t, h], [t, -t, h], [t, t, h], [-t, t, h]],
    [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]],
  );
}
/** dvojitý jehlan: čtverec 20 × 20 v z = 5, vrcholy v z = 0 a z = 10 (největší obvod uprostřed) */
const bipyramid = () =>
  flat(
    [[-10, -10, 5], [10, -10, 5], [10, 10, 5], [-10, 10, 5], [0, 0, 0], [0, 0, 10]],
    [[0, 1, 5], [1, 2, 5], [2, 3, 5], [3, 0, 5], [1, 0, 4], [2, 1, 4], [3, 2, 4], [0, 3, 4]],
  );
/** kvádr sx × sy × sz se zjemněnými stěnami (n × n), každá stěna má vlastní vrcholy a normály – pro tloušťku stěn */
function plate(sx: number, sy: number, sz: number, n = 4): MeshData {
  const V: number[] = [];
  const N: number[] = [];
  const T: number[] = [];
  const face = (o: Vec3, u: Vec3, v: Vec3, nrm: Vec3) => {
    const base = V.length / 3;
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        V.push(o[0] + (u[0] * i) / n + (v[0] * j) / n, o[1] + (u[1] * i) / n + (v[1] * j) / n, o[2] + (u[2] * i) / n + (v[2] * j) / n);
        N.push(...nrm);
      }
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = base + j * (n + 1) + i;
        T.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
      }
  };
  face([0, 0, sz], [sx, 0, 0], [0, sy, 0], [0, 0, 1]);
  face([0, sy, 0], [sx, 0, 0], [0, -sy, 0], [0, 0, -1]);
  face([0, 0, 0], [sx, 0, 0], [0, 0, sz], [0, -1, 0]);
  face([sx, sy, 0], [-sx, 0, 0], [0, 0, sz], [0, 1, 0]);
  face([sx, 0, 0], [0, sy, 0], [0, 0, sz], [1, 0, 0]);
  face([0, sy, 0], [0, -sy, 0], [0, 0, sz], [-1, 0, 0]);
  return { vertices: new Float32Array(V), normals: new Float32Array(N), triangles: new Uint32Array(T), faceGroups: new Int32Array(0), lines: new Float32Array(0), edgeGroups: new Int32Array(0) };
}

describe("řez textem (cs / en / de)", () => {
  it("osa, poloha, obráceně a vypnutí", () => {
    expect(p("řez X 25 obráceně")).toEqual({ kind: "section", axis: "X", offset: 25, flip: true });
    expect(p("section y 10,5 flip")).toEqual({ kind: "section", axis: "Y", offset: 10.5, flip: true });
    expect(p("schnitt z -5 umkehren")).toEqual({ kind: "section", axis: "Z", offset: -5, flip: true });
    expect(p("řez Z")).toEqual({ kind: "section", axis: "Z", offset: null, flip: false });
    expect(p("řez XY 3")).toEqual({ kind: "section", axis: "Z", offset: 3, flip: false });
    for (const t of ["řez vyp", "section off", "schnitt aus"]) expect(p(t)).toEqual({ kind: "sectionOff" });
  });
  it("chyby: poloha bez osy, neznámé slovo", () => {
    expect(() => p("řez 25")).toThrow(/osu/);
    expect(() => p("řez X 25 nahoru")).toThrow(/neznámé slovo „nahoru“/);
    expect(op("řez X 25")).toMatchObject({ k: "api", cmd: { kind: "section", axis: "X", offset: 25 } });
  });
  it("text do protokolu s rozsahem modelu", () => {
    expect(sectionReport({ axis: "X", offset: 25, flip: true }, [[0, 0, 0], [50, 20, 10]])).toBe("✓ řez kolmo na X v 25 mm, obráceně (model X 0…50 mm)");
    expect(sectionReport(null)).toBe("✓ řez vypnut");
  });
});

describe("styl zobrazení", () => {
  it("styly a přizpůsobení cs / en / de", () => {
    const cases: [string, ApiCmd][] = [
      ["zobraz drátový", { kind: "display", mode: "wireframe" }],
      ["view wireframe", { kind: "display", mode: "wireframe" }],
      ["ansicht drahtmodell", { kind: "display", mode: "wireframe" }],
      ["zobraz stínovaný", { kind: "display", mode: "shaded" }],
      ["zobraz stínovaný s hranami", { kind: "display", mode: "shadedEdges" }],
      ["view edges", { kind: "display", mode: "shadedEdges" }],
      ["zobraz skryté hrany", { kind: "display", mode: "hiddenLine" }],
      ["ansicht verdeckt", { kind: "display", mode: "hiddenLine" }],
      ["zobraz průhledný", { kind: "display", mode: "xray" }],
      ["ansicht röntgen", { kind: "display", mode: "xray" }],
      ["zobraz přizpůsobit", { kind: "fit" }],
      ["view fit", { kind: "fit" }],
      ["ansicht einpassen", { kind: "fit" }],
    ];
    for (const [t, c] of cases) expect(p(t), t).toEqual(c);
  });
  it("pohledy zůstávají stávajícímu příkazu, neznámé slovo je chyba", () => {
    expect(p("zobraz iso")).toBeNull();
    expect(op("zobraz přední")).toMatchObject({ k: "view", view: "front" });
    expect(op("ansicht oben")).toMatchObject({ k: "view", view: "top" });
    expect(err("zobraz duhový")).toMatch(/neznámý pohled ani styl/);
  });
});

describe("barva plochy", () => {
  it("čísla, pravidlo, výchozí barva", () => {
    expect(p("barva plochy F3 F5 #E03930")).toEqual({ kind: "faceColor", faces: [2, 4], rule: [], color: "#e03930" });
    expect(p("color face F1,F2 default")).toEqual({ kind: "faceColor", faces: [0, 1], rule: [], color: null });
    expect(p("farbe fläche oben #00f")).toEqual({ kind: "faceColor", faces: [], rule: ["oben"], color: "#0000ff" });
    expect(p("barva plochy válcové červená")).toEqual({ kind: "faceColor", faces: [], rule: ["valcove"], color: "#e03930" });
  });
  it("přes konzoli: #hex za mezerou není komentář (i u barvy dílu)", () => {
    expect(op("barva plochy F3 #e03930")).toMatchObject({ k: "api", cmd: { kind: "faceColor", faces: [2], color: "#e03930" } });
    expect(op("barva #e03930")).toMatchObject({ k: "meta", patch: { color: "#e03930" } });
    expect(op("kvádr 10 10 10 # komentář")).toMatchObject({ k: "feature", feature: { type: "box" } });
  });
  it("chyby", () => {
    expect(() => p("barva plochy F3")).toThrow(/potřebuje barvu/);
    expect(() => p("barva plochy #fff")).toThrow(/čísla ploch nebo pravidlo/);
    expect(() => p("barva plochy F0 #fff")).toThrow(/F1/);
  });
});

describe("akce rozšíření", () => {
  it("id, popisek a zkratky cs / en / de", () => {
    expect(p("akce sheet.dxf")).toEqual({ kind: "action", id: "sheet.dxf" });
    expect(p("akce rozvin dxf")).toEqual({ kind: "action", id: "sheet.dxf" });
    expect(p("akce Rozvin → SVG")).toEqual({ kind: "action", id: "sheet.svg" });
    expect(p("akce tabulka ohybů")).toEqual({ kind: "action", id: "sheet.table" });
    expect(p("action bend table")).toEqual({ kind: "action", id: "sheet.table" });
    expect(p("akce kusovník řezů")).toEqual({ kind: "action", id: "weld.cutList" });
    expect(p("action cut list")).toEqual({ kind: "action", id: "weld.cutList" });
    expect(p("aktion schweißnahttabelle")).toEqual({ kind: "action", id: "weld.weldTable" });
    expect(p("akce tloušťka stěn")).toEqual({ kind: "action", id: "adv.wallThickness" });
    expect(p("aktion wandstärke")).toEqual({ kind: "action", id: "adv.wallThickness" });
    expect(p("akce skica dxf")).toEqual({ kind: "action", id: "sketch.dxf" });
    expect(p("akce")).toEqual({ kind: "action", id: "" });
    expect(apiActions().map((a) => a.id)).toEqual(expect.arrayContaining(["sheet.dxf", "sheet.svg", "sheet.table", "weld.cutList", "weld.weldTable", "adv.wallThickness", "sketch.dxf"]));
  });
  it("chyby: neznámá akce, prvek místo akce, „prvek <akce>“ odkazuje na akce", () => {
    expect(() => resolveAction("blbost")).toThrow(/neznámá akce „blbost“ – akce: .*sheet.dxf/); // pořadí akcí určuje registr (první může být analýza ploch)
    expect(() => resolveAction("sheet.bend")).toThrow(/není akce, ale prvek – .*prvek sheet.bend/);
    expect(err("prvek sheet.dxf")).toMatch(/není prvek, ale akce .*akce sheet.dxf/);
    expect(err("prvek \"Tabulka ohybů\"")).toMatch(/akce sheet.table/);
  });
  it("zachytávací API: okno → protokol, stažení → base64", async () => {
    const cap = captureActionApi({ doc: null as unknown, result: null });
    cap.api.flash("Rozvin uložen.");
    cap.api.notice("Tabulka ohybů", "1  90°  R2");
    cap.api.download("a.dxf", "0\nSECTION\n", "application/dxf");
    cap.api.download("b.bin", new Uint8Array([1, 2, 3]), "application/octet-stream");
    const out = await cap.done();
    expect(out.log).toBe("Rozvin uložen.\nTabulka ohybů\n1  90°  R2");
    expect(out.files).toEqual([
      { name: "a.dxf", mime: "application/dxf", bytes: 10, base64: btoa("0\nSECTION\n") },
      { name: "b.bin", mime: "application/octet-stream", bytes: 3, base64: "AQID" },
    ]);
  });
});

describe("analýzy a formařské nástroje – rozbor", () => {
  it("analýza úkosů / tloušťky / křivosti / zebra / vyp", () => {
    expect(p("analýza úkosů směr -Z min 2 zobrazit")).toEqual({ kind: "analyze", what: "draft", dir: [0, 0, -1], min: 2, show: true });
    expect(p("analyze draft direction 0 1 0 min 0.5 show")).toEqual({ kind: "analyze", what: "draft", dir: [0, 1, 0], min: 0.5, show: true });
    expect(p("analyse formschräge richtung +Z min 1 anzeigen")).toEqual({ kind: "analyze", what: "draft", dir: [0, 0, 1], min: 1, show: true });
    expect(p("analýza úkosů")).toEqual({ kind: "analyze", what: "draft", dir: [0, 0, 1], min: 1, show: false });
    expect(p("analýza tloušťky stěn limit 2")).toEqual({ kind: "analyze", what: "thickness", limit: 2, show: false });
    expect(p("analyze thickness limit 1.5 show")).toEqual({ kind: "analyze", what: "thickness", limit: 1.5, show: true });
    expect(p("analyse wandstärke grenze 2")).toEqual({ kind: "analyze", what: "thickness", limit: 2, show: false });
    expect(p("analýza křivosti zobrazit")).toEqual({ kind: "analyze", what: "curvature", show: true });
    expect(p("analyse krümmung")).toEqual({ kind: "analyze", what: "curvature", show: false });
    expect(p("analýza zebra")).toEqual({ kind: "analyze", what: "zebra" });
    for (const t of ["analýza vyp", "analyze off", "analyse aus"]) expect(p(t)).toEqual({ kind: "analyze", what: "off" });
    expect(() => p("analýza barev")).toThrow(/neznámý druh/);
    expect(() => p("analýza úkosů směr šikmo")).toThrow(/směr se píše/);
  });
  it("dělicí rovina, vyhazovače, chlazení, smrštění", () => {
    expect(p("dělicí rovina směr +Y")).toEqual({ kind: "parting", dir: [0, 1, 0] });
    expect(p("parting plane")).toEqual({ kind: "parting", dir: [0, 0, 1] });
    expect(p("trennebene richtung -Z")).toEqual({ kind: "parting", dir: [0, 0, -1] });
    expect(p("vyhazovače Ø 6 rozteč 60 směr +Z díry")).toEqual({ kind: "ejectors", d: 6, spacing: 60, dir: [0, 0, 1], mode: "holes" });
    expect(p("ejectors d 6 spacing 60 assembly")).toEqual({ kind: "ejectors", d: 6, spacing: 60, dir: [0, 0, 1], mode: "assembly" });
    expect(p("auswerfer ø6 teilung 50 bohrungen")).toEqual({ kind: "ejectors", d: 6, spacing: 50, dir: [0, 0, 1], mode: "holes" });
    expect(p("vyhazovače")).toEqual({ kind: "ejectors", dir: [0, 0, 1], mode: "list" });
    expect(p("chlazení Ø8 hloubka 15 větve 4 přesah 10 díl")).toEqual({ kind: "cooling", d: 8, depth: 15, rows: 4, overhang: 10, dir: [0, 0, 1], mode: "part" });
    expect(p("cooling d8 depth 15 rows 4 overhang 10 assembly")).toEqual({ kind: "cooling", d: 8, depth: 15, rows: 4, overhang: 10, dir: [0, 0, 1], mode: "assembly" });
    expect(p("kühlung ø8 tiefe 15 reihen 4 überstand 10 teil")).toEqual({ kind: "cooling", d: 8, depth: 15, rows: 4, overhang: 10, dir: [0, 0, 1], mode: "part" });
    expect(p("smrštění 0,5")).toEqual({ kind: "shrinkage", pct: 0.5 });
    expect(p("shrinkage 0.5")).toEqual({ kind: "shrinkage", pct: 0.5 });
    expect(p("schwindung 0,5%")).toEqual({ kind: "shrinkage", pct: 0.5 });
    expect(p("smrštění ABS")).toEqual({ kind: "shrinkage", pct: 0.55, label: "ABS" });
    expect(() => p("smrštění")).toThrow(/procenta nebo materiál/);
    expect(() => p("chlazení větve 2,5")).toThrow(/celé číslo/);
    expect(() => p("vyhazovače 6")).toThrow(/bez významu/);
    expect(() => p("vyhazovače díry sestava")).toThrow(/buď díry, nebo sestava/);
  });
  it("přes konzoli jako operace api; neznámý příkaz vyjmenuje nové příkazy", () => {
    expect(op("vyhazovače Ø 5 díry")).toMatchObject({ k: "api", cmd: { kind: "ejectors", d: 5, mode: "holes" } });
    expect(op("dělicí rovina")).toMatchObject({ k: "api", cmd: { kind: "parting" } });
    expect(err("foo")).toMatch(/řez.*akce.*analýza.*dělicí.*vyhazovače.*chlazení.*smrštění/);
  });
});

describe("analýzy – textové výsledky nad sítí se známým výsledkem", () => {
  it("komolý jehlan s úkosem 5° ve směru vyhození: bez podkosu", () => {
    const res = draftAnalysis(frustum(40, 10, 5), [0, 0, 1], 1);
    const t = draftReport(res, [0, 0, 1], 1);
    expect(t).toBe("Úkosy (směr vyhození +Z, min. 1°): Dostatečný 100,0 % · Malý 0,0 % · Svislá stěna 0,0 % · Podkos 0,0 % – bez podkosů, úkosy dostatečné");
  });
  it("obrácený směr vyhození: podkos, nelze vyhodit", () => {
    const res = draftAnalysis(frustum(40, 10, 5), [0, 0, -1], 1);
    const t = draftReport(res, [0, 0, -1], 1);
    expect(t).toMatch(/^Úkosy \(směr vyhození -Z, min\. 1°\): Dostatečný [\d,]+ % · Malý 0,0 % · Svislá stěna 0,0 % · Podkos [\d,]+ % – nelze vyhodit bez posuvných čelistí$/);
    expect(res.undercutRatio).toBeGreaterThan(0.3);
  });
  it("kvádr: svislé stěny bez úkosu", () => {
    const res = draftAnalysis(frustum(40, 10, 0), [0, 0, 1], 1);
    expect(draftReport(res, [0, 0, 1], 1)).toMatch(/Svislá stěna 33,3 % · Podkos 0,0 % – bez podkosů – svislé stěny/);
  });
  it("tloušťka stěn desky 40 × 30 × 4: nejtenčí 4 mm, místo na čele", () => {
    const w = wallThickness(plate(40, 30, 4), 5);
    expect(w.min).toBeCloseTo(4, 3);
    expect(w.at).not.toBeNull();
    expect([0, 4]).toContain(Math.round(w.at![2]));
    const t = thicknessReport(w, 5);
    expect(t).toMatch(/^Tloušťka stěn: nejtenčí 4 mm u \[[\d,;. -]+\] · průměr [\d,]+ mm · pod limitem 5 mm: [\d,]+ % vzorků$/);
    expect(thicknessReport({ min: 0, avg: 0, below: 0 }, 1)).toMatch(/nepodařilo změřit/);
  });
  it("křivost jako text", () => {
    expect(curvatureReport({ min: -0.05, max: 0.1, range: 0.1 })).toBe("Křivost: min -0,05 · max 0,1 1/mm (nejmenší poloměr ≈ 10 mm)");
    expect(curvatureReport({ min: 0, max: 0, range: 0 })).toMatch(/jen rovinné plochy/);
  });
  it("dělicí rovina dvojitého jehlanu leží uprostřed (i pro směr -Z a v rámu formy)", () => {
    const m = bipyramid();
    const a = partingPlane(m, [0, 0, 1]);
    expect(a.offset).toBeCloseTo(5, 1);
    expect(a.section).toEqual({ axis: "Z", offset: expect.closeTo(5, 1), flip: false });
    expect(partingReport(a, [0, 0, 1])).toMatch(/^Dělicí rovina: Z = 5 mm \(největší obvod průřezu 80 mm\)/);
    const b = partingPlane(m, [0, 0, -1]);
    expect(b.section.axis).toBe("Z");
    expect(b.section.offset).toBeCloseTo(5, 1);
    expect(meshInFrame(m, [1, 0, 0]).vertices).not.toBe(m.vertices);
    const c = partingPlane(m, [1, 0, 0]);
    expect(c.section.axis).toBe("X");
  });
  it("vyhazovače a chlazení jako text", () => {
    const bbox: [Vec3, Vec3] = [[0, 0, 0], [100, 60, 20]];
    const list = suggestEjectors(bbox, { diameter: 6 });
    expect(ejectorsReport(list, [0, 0, 1])).toMatch(new RegExp(`^Vyhazovače: ${list.length}× Ø6 ve směru \\+Z – polohy \\(X; Y v půdorysu\\): \\[`));
    const prm = { ...defaultCooling(bbox), diameter: 8, rows: 3 };
    const c = coolingCircuit(prm);
    expect(coolingReport(prm, c)).toMatch(/^Chladicí okruh: 3 větví Ø8 mm, .* 5 vrtů, celková délka/);
  });
});

describe("nastavení, výběr, snímek", () => {
  it("setSettings: povolené klíče a hodnoty, jinak chyba", () => {
    const n = applySettingsPatch(DEFAULT_SETTINGS, { askWhereToSave: false, meshQuality: "fine", decimals: 3, author: "AI", gridStep: 2.5 });
    expect(n).toMatchObject({ askWhereToSave: false, meshQuality: "fine", decimals: 3, author: "AI", gridStep: 2.5 });
    expect(n.shortcuts).toBe(DEFAULT_SETTINGS.shortcuts);
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { shortcuts: {} })).toThrow(/nelze měnit přes API – povolené klíče: askWhereToSave/);
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { meshQuality: "ultra" })).toThrow(/"draft" \| "normal" \| "fine"/);
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { askWhereToSave: "ne" })).toThrow(/true \/ false/);
    expect(() => applySettingsPatch(DEFAULT_SETTINGS, { defaultMaterial: "zlato" })).toThrow(/ocel/);
  });
  it("id výběru", () => {
    expect(parseSelectionId("F3")).toEqual({ kind: "face", index: 2 });
    expect(parseSelectionId("e12")).toEqual({ kind: "edge", index: 11 });
    expect(parseSelectionId("Čep:V5")).toEqual({ kind: "vertex", index: 4, comp: "Čep" });
    expect(parseSelectionId("comp:Čep 2")).toEqual({ kind: "component", name: "Čep 2" });
    expect(parseSelectionId("feature:Díra 1")).toEqual({ kind: "feature", name: "Díra 1" });
    expect(parseSelectionId("těleso")).toEqual({ kind: "body" });
    expect(() => parseSelectionId("F0")).toThrow(/začínají 1/);
    expect(() => parseSelectionId("X9")).toThrow(/neznámé id výběru/);
  });
  it("volby snímku a výsledný rozměr", () => {
    expect(checkScreenshotOptions({ view: "iso", width: 800, section: { axis: "X", offset: 10 } })).toMatchObject({ view: "iso", width: 800 });
    expect(() => checkScreenshotOptions({ view: "shora" })).toThrow(/view je iso/);
    expect(() => checkScreenshotOptions({ width: 9000 })).toThrow(/16 až 4096/);
    expect(() => checkScreenshotOptions({ zoom: 2 })).toThrow(/neznámá volba „zoom“/);
    expect(shotSize(1600, 1000, {})).toEqual({ width: 1600, height: 1000 });
    expect(shotSize(1600, 1000, { width: 800 })).toEqual({ width: 800, height: 500 });
    expect(shotSize(1600, 1000, { width: 300, height: 300 })).toEqual({ width: 300, height: 300 });
  });
});
