/**
 * Předloha (cad/reference): výtah z vygenerovaného výkresu desky (DXF i DWG zapsané 2D zapisovačem), vektorové PDF
 * (výkres modelu exportovaný do PDF a přečtený pdf.js), porovnání promítnutého modelu s pohledem předlohy (pokrytí,
 * úseky mimo toleranci, SVG), kontrola kót, textové příkazy CS / EN / DE a jejich provedení nad dokumentem.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import "../draft/index";
import { setLang } from "../i18n";
import { makeDrawing, type DrawingOptions } from "../drawing";
import { drawingToPdf } from "../pdf";
import { draftFromFile, draftToDwgFile, draftToDxfFile } from "../draft/io/files";
import type { CadDoc } from "../types";
import { extractReference, viewGeometry } from "./extract";
import { checkDims, compareGeo, modelGeo, refGeo, type ModelEnt } from "./compare";
import { loadReference } from "./load";
import { parseReferenceLine } from "./parse";
import { pdfPagesToDraft, readPdfPages, type PdfJsLike } from "./pdf";
import { runReferenceCmd, type RefEnv } from "./run";
import { referenceStore } from "./store";
import { extractLines, statusLines } from "./text";
import { plateReference } from "./__fixtures__/plate-ref";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

/** deska 120 × 80 × 20, díry Ø8 v (±45, ±25), středová díra (výchozí Ø20); `shift` posune díru (45, 25) v ose X */
const plate = (dc = 20, shift = 0) => {
  let s = r.makeBox([-60, -40, 0], [60, 40, 20]) as r.Shape3D;
  s = s.cut(r.makeCylinder(dc / 2, 40, [0, 0, -10], [0, 0, 1]));
  for (const [x, y] of [[-45, -25], [45, -25], [-45, 25], [45 + shift, 25]]) s = s.cut(r.makeCylinder(4, 40, [x, y, -10], [0, 0, 1]));
  return s;
};
const VIEWS: Partial<DrawingOptions> = { views: { front: true, top: true, left: true, right: true, back: true, bottom: true, iso: false }, hidden: true, dimensions: "none", centerLines: false, balloons: false, scale: 1 };
const fixtureDxf = () => draftToDxfFile(plateReference()).data;

describe("výtah z předlohy DXF / DWG (vygenerovaný výkres desky)", () => {
  for (const fmt of ["dxf", "dwg"] as const) {
    it(`${fmt.toUpperCase()}: list A3 1:1 s razítkem, 2 pohledy, kóty s tolerancí / uložením / počtem, díry, kusovník, pozice, rozpory`, () => {
      const bytes = fmt === "dxf" ? fixtureDxf() : draftToDwgFile(plateReference()).data;
      const back = draftFromFile(`deska.${fmt}`, bytes);
      const ex = extractReference(back.model, { name: `deska.${fmt}`, format: fmt });
      expect(ex.sheets).toHaveLength(1);
      expect(ex.sheets[0]).toMatchObject({ size: "A3", w: 420, h: 297, scale: "1:1", scaleValue: 1, source: "insert" });
      expect(ex.titles[0]).toMatchObject({ name: "DESKA 120x80", number: "RD-001", material: "S235JR", scale: "1:1", pos: "1", dim: "20*80*120" });
      // pohledy: půdorys 120 × 80 (obrys + 5 kružnic), nárys 120 × 20 (obrys + skryté hrany děr)
      expect(ex.views.map((v) => [v.id, v.w, v.h])).toEqual([["1.1", 120, 80], ["1.2", 120, 20]]);
      expect(ex.views.every((v) => v.geomScale === 1)).toBe(true);
      // kóty: hodnota, tolerance, uložení, počet, změřená hodnota
      expect(ex.dims).toHaveLength(7);
      const by = (t: string) => ex.dims.find((d) => d.text.replace(/\s+/g, "") === t);
      expect(by("120")).toMatchObject({ value: 120, measured: 120, view: "1.1", check: "ok" });
      expect(ex.dims.find((d) => d.tol)).toMatchObject({ value: 80, tol: { upper: 0.1, lower: -0.1 } });
      expect(ex.dims.find((d) => d.fit)).toMatchObject({ value: 20, fit: "H7", dia: true, kind: "diameter" });
      expect(ex.dims.find((d) => d.count)).toMatchObject({ value: 8, count: 4, dia: true });
      // díry z kružnic půdorysu (soustředné skupiny)
      expect(ex.holes.map((h) => h.dias[0]).sort((a, b) => a - b)).toEqual([8, 8, 8, 8, 20]);
      // kusovník: hlavička a řádek z čar a textů
      expect(ex.boms[0].header).toEqual(["Poz", "Ks", "Název", "Materiál", "Rozměr"]);
      expect(ex.boms[0].rows[0]).toMatchObject({ pos: "1", qty: 1, name: "DESKA", material: "S235JR", dim: "20*80*125" });
      expect(ex.balloons).toEqual([expect.objectContaining({ sheet: 1, pos: "1", target: [190, 230] })]);
      expect(ex.notes.map((n) => n.text)).toEqual(["Nekótované hrany sražení 0,5x45°"]);
      expect(ex.symbols).toEqual([expect.objectContaining({ kind: "roughness", text: "3,2" })]);
      // rozpory: text kóty 19.8 u geometrie 20, kusovník × razítko
      expect(ex.contradictions.map((c) => c.kind)).toEqual(["dim-text", "title-bom"]);
      expect(ex.contradictions[0].text).toMatch(/ukazuje 19\.8, geometrie 20/);
      expect(ex.contradictions[1].text).toMatch(/20\*80\*125.*20\*80\*120/);
    });
  }

  it("zapsaná předloha pro e2e (__fixtures__/deska-predloha.dxf) dává stejný výtah jako generátor", () => {
    const file = path.resolve(__dirname, "__fixtures__/deska-predloha.dxf");
    if (process.env.REF_FIXTURE_WRITE) fs.writeFileSync(file, fixtureDxf());
    const a = extractReference(draftFromFile("deska.dxf", new Uint8Array(fs.readFileSync(file))).model, { name: "deska.dxf", format: "dxf" });
    const b = extractReference(draftFromFile("deska.dxf", fixtureDxf()).model, { name: "deska.dxf", format: "dxf" });
    const sig = (x: typeof a) => JSON.stringify({ s: x.sheets.map((v) => [v.size, v.scale]), v: x.views.map((v) => [v.w, v.h]), d: x.dims.map((d) => [d.text, d.measured, d.check]), c: x.contradictions.map((c) => c.kind), b: x.boms.map((t) => t.rows.length) });
    expect(sig(a)).toBe(sig(b));
  });

  it("stav a výtah v protokolu: počty, list, rozpor; výtah kót s polohou a změřenou hodnotou", () => {
    setLang("cs");
    const back = draftFromFile("deska.dxf", fixtureDxf());
    const ex = extractReference(back.model, { name: "deska.dxf", format: "dxf" });
    const st = { info: { name: "deska.dxf", format: "dxf" as const, bytes: 36000, id: "x", summary: {} }, model: back.model, extract: ex, note: "" };
    const lines = statusLines(st);
    expect(lines[0]).toMatch(/^✓ předloha „deska\.dxf“ \(DXF, 35 kB\): listy 1 \(1× A3\), pohledy 2, kóty 7/);
    expect(lines.some((l) => /^✗ text kóty ≠ geometrie: 1/.test(l))).toBe(true);
    expect(lines.some((l) => /^✗ rozpor: pozice 1/.test(l))).toBe(true);
    const dims = extractLines(ex, "dims");
    expect(dims.find((l) => l.includes("19.8"))).toMatch(/^✗ 1\.2 .*19\.8 · změřeno 20/);
    expect(extractLines(ex, "dims", { sheet: 2 })).toEqual([]);
    // sloupce v pořadí hlavičky předlohy (Poz | Ks | Název | Materiál | Rozměr)
    expect(extractLines(ex, "bom")[1]).toBe("1 | 1 | DESKA | S235JR | 20*80*125");
  });
});

describe("porovnání promítnutého modelu s předlohou a kontrola kót", () => {
  const back = () => draftFromFile("deska.dxf", fixtureDxf());
  it("model shodný s předlohou: půdorys i nárys 100 % v toleranci 0,06 mm, kóty ✓ (19.8 ✗ – předloha si odporuje)", () => {
    const b = back();
    const ex = extractReference(b.model, { name: "deska.dxf", format: "dxf" });
    const d = makeDrawing(plate(), { name: "D", material: "S" }, VIEWS);
    const top = modelGeo(d.views.find((v) => v.key === "top")!.ents as ModelEnt[]);
    const front = modelGeo(d.views.find((v) => v.key === "front")!.ents as ModelEnt[]);
    const rv1 = ex.views[0];
    const rv2 = ex.views[1];
    const c1 = compareGeo(refGeo(viewGeometry(b.model, ex, "1.1"), rv1), top, { view: "top", refView: "1.1" })!;
    expect(c1.coverage).toBe(100);
    expect(c1.modelCoverage).toBe(100);
    expect(c1.mismatches).toEqual([]);
    expect(c1.svg).toMatch(/^<svg [^>]*data-ref-view="1\.1"/);
    const c2 = compareGeo(refGeo(viewGeometry(b.model, ex, "1.2"), rv2), front, { view: "front", refView: "1.2" })!;
    expect([c2.coverage, c2.modelCoverage]).toEqual([100, 100]);
    // nesouhlasné pohledy se nesesouhlasí (obálky 120 × 80 a 120 × 20)
    expect(compareGeo(refGeo(viewGeometry(b.model, ex, "1.2"), rv2), top, { view: "top", refView: "1.2" })).toBeNull();
    const k1 = checkDims(ex.dims.filter((x) => x.view === "1.1"), rv1, top, c1.align);
    expect(k1.map((x) => [x.dim.text.replace(/\s/g, ""), x.ok, x.model])).toEqual([["120", true, 120], ["80±0,10", true, 80], ["90", true, 90], ["50", true, 50], ["Ø20H7", true, 20], ["4xØ8", true, 8]]);
    const k2 = checkDims(ex.dims.filter((x) => x.view === "1.2"), rv2, front, c2.align);
    // text 19.8 × geometrie předlohy 20: model 20 odpovídá geometrii, ne textu – rozpor předlohy, ne ✓ „zaokrouhleno“
    expect(k2[0]).toMatchObject({ ok: false, how: "value", model: 20 });
    expect(k2[0].note).toMatch(/předloha si odporuje: text 19\.8, geometrie předlohy 20/);
  });

  it("model s menší středovou dírou (Ø18) a posunutou dírou: pokrytí pod 100 %, úseky mimo toleranci na místě děr, kóty ✗", () => {
    const b = back();
    const ex = extractReference(b.model, { name: "deska.dxf", format: "dxf" });
    const d = makeDrawing(plate(18, 1), { name: "D", material: "S" }, VIEWS);
    const top = modelGeo(d.views.find((v) => v.key === "top")!.ents as ModelEnt[]);
    const c = compareGeo(refGeo(viewGeometry(b.model, ex, "1.1"), ex.views[0]), top, { view: "top", refView: "1.1" })!;
    expect(c.align).toMatchObject({ rot: 0, mirror: false });
    expect(c.coverage).toBeLessThan(90);
    expect(c.coverage).toBeGreaterThan(80);
    // díra Ø20 ve středu pohledu (60; 40 od levého dolního rohu) chybí, díra (105; 65) posunutá
    const near = (p: number[], q: number[], t: number) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= t;
    expect(c.mismatches.some((m) => m.side === "ref" && near(m.at, [60, 40], 0.5) && Math.abs(m.length - 62.83) < 0.5)).toBe(true);
    expect(c.mismatches.some((m) => m.side === "ref" && near(m.at, [105, 65], 4))).toBe(true);
    const k = checkDims(ex.dims.filter((x) => x.view === "1.1"), ex.views[0], top, c.align);
    const bad = k.filter((x) => !x.ok).map((x) => [x.dim.text.replace(/\s/g, ""), x.model]);
    expect(bad).toEqual([["Ø20H7", 18]]);
  });
});

describe("vektorové PDF jako předloha (výkres modelu → PDF → pdf.js)", () => {
  const pdfjs = async () => ({ lib: (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJsLike, docOptions: { verbosity: 0 } });
  const font = (n: string) => {
    const b = fs.readFileSync(path.resolve(__dirname, "../../../public/fonts", n));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  it("stránka = list A3, měřítko 1:2 z razítka, pohledy v měřítku listu, kóty z textů, porovnání s modelem 100 %", async () => {
    const d = makeDrawing(plate(), { name: "Deska", material: "S235" }, { views: { front: true, top: true, left: false, right: false, back: false, bottom: false, iso: false }, hidden: false, dimensions: "overall", centerLines: false, scale: 0.5, sheet: "A3" });
    const blob = await drawingToPdf(d, { regular: font("Roboto-Regular.ttf"), bold: font("Roboto-Bold.ttf") });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const st = await loadReference("deska.pdf", bytes, { pdfjs });
    const ex = st.extract;
    expect(ex.format).toBe("pdf");
    expect(ex.sheets).toHaveLength(1);
    expect(ex.sheets[0]).toMatchObject({ size: "A3", source: "page", scaleValue: 0.5 });
    // pohled půdorysu: 120 × 80 mm skutečné velikosti = 60 × 40 mm papíru
    const plan = ex.views.find((v) => Math.abs(v.w / v.geomScale - 120) < 0.5 && Math.abs(v.h / v.geomScale - 80) < 0.5);
    expect(plan).toBeTruthy();
    expect(plan!.geomScale).toBe(0.5);
    // kóty z textů u kótovacích čar: rozměr 120 a 80 s geometrií v měřítku 1:2
    const v120 = ex.dims.find((x) => x.value === 120);
    expect(v120?.measured).toBeCloseTo(120, 1);
    expect(v120?.check === "ok" || v120?.check === "rounded").toBe(true);
    // porovnání: model × pohled PDF (geometrie ÷ měřítko listu)
    const mv = makeDrawing(plate(), { name: "D", material: "S" }, VIEWS);
    const top = modelGeo(mv.views.find((v) => v.key === "top")!.ents as ModelEnt[], { hidden: false });
    const c = compareGeo(refGeo(viewGeometry(st.model, ex, plan!.id), plan!, { hidden: false }), top, { view: "top", refView: plan!.id, tol: 0.1 })!;
    expect(c.coverage).toBeGreaterThan(97);
    expect(c.modelCoverage).toBeGreaterThan(97);
  }, 60_000);

  it("čárkované cesty (setDash) → typ čáry skrytá / osa", () => {
    const m = pdfPagesToDraft([{ w: 595, h: 842, view: [1, 0, 0, -1, 0, 842], texts: [{ str: "1:2", transform: [10, 0, 0, 10, 500, 30] }], paths: [{ start: [10, 10], segs: [{ k: "L", b: [100, 10] }], closed: false, stroke: true, fill: false, dash: [3, 1.5] }, { start: [10, 20], segs: [{ k: "L", b: [100, 20] }], closed: false, stroke: true, fill: false, dash: [8, 1.5, 1.5, 1.5] }, { start: [10, 30], segs: [{ k: "L", b: [100, 30] }], closed: false, stroke: true, fill: false }] }]);
    const lts = m.entities.filter((e) => e.type === "line").map((e) => e.linetype ?? "solid").sort();
    expect(lts).toEqual(["CENTER", "HIDDEN", "solid"]);
    const t = m.entities.find((e) => e.type === "text") as unknown as { p: number[]; h: number; s: string };
    expect(t.s).toBe("1:2");
    expect(t.h).toBeCloseTo((10 * 25.4) / 72, 6);
    expect(m.ext?.pdfPages?.[0]).toMatchObject({ x0: 0, y1: 0 });
  });
});

describe("textové příkazy předlohy (CS / EN / DE)", () => {
  it("rozbor řádků", () => {
    expect(parseReferenceLine('předloha "deska.dwg"')).toEqual({ kind: "load", name: "deska.dwg" });
    expect(parseReferenceLine('reference "plate.dxf" data:application/dxf;base64,AAAA')).toEqual({ kind: "load", name: "plate.dxf", data: "data:application/dxf;base64,AAAA" });
    expect(parseReferenceLine("vorlage status")).toEqual({ kind: "status" });
    expect(parseReferenceLine("předloha výtah kóty list 14")).toEqual({ kind: "extract", what: "dims", sheet: 14 });
    expect(parseReferenceLine("reference extract holes view 14.2 all")).toEqual({ kind: "extract", what: "holes", view: "14.2", all: true });
    expect(parseReferenceLine("vorlage auszug stückliste")).toEqual({ kind: "extract", what: "bom" });
    expect(parseReferenceLine("předloha otevřít")).toEqual({ kind: "open" });
    expect(parseReferenceLine("porovnat předloha pohled přední tolerance 0,06")).toEqual({ kind: "compare", view: "front", tol: 0.06 });
    expect(parseReferenceLine("compare reference view top 14.2 no-hidden rotation 90")).toEqual({ kind: "compare", view: "top", refView: "14.2", hidden: false, align: { rot: 90 } });
    expect(parseReferenceLine("vergleichen vorlage ansicht oben blatt 3 versatz 1 -2")).toEqual({ kind: "compare", view: "top", sheet: 3, align: { dx: 1, dy: -2 } });
    expect(parseReferenceLine("kontrola kót")).toEqual({ kind: "checkDims" });
    expect(parseReferenceLine("check dimensions view front 1.1")).toEqual({ kind: "checkDims", view: "front", refView: "1.1" });
    expect(parseReferenceLine("maße prüfen blatt 2")).toEqual({ kind: "checkDims", sheet: 2 });
    expect(parseReferenceLine("kvádr 10 10 10")).toBeNull();
    expect(() => parseReferenceLine("porovnat předloha")).toThrow(/chybí pohled/);
    expect(() => parseReferenceLine("předloha výtah něco")).toThrow(/neznámá volba/);
  });

  it("příkazy nad dokumentem: připojit → stav → výtah → porovnat (SVG ke stažení, výsledek v dokumentu) → kontrola kót → otevřít → odebrat", async () => {
    setLang("cs");
    const files = new Map([["deska.dxf", fixtureDxf()]]);
    const downloads: string[] = [];
    const env: RefEnv = {
      drawing: async (_doc, _meta, opts) => makeDrawing(plate(18), { name: "D", material: "S" }, opts as Partial<DrawingOptions>) as never,
      file: (n) => (files.has(n) ? { name: n, bytes: files.get(n)! } : null),
      attached: () => [...files.keys()].join(", "),
      download: async (n) => void downloads.push(n),
      load: { worker: false },
    };
    let doc: CadDoc = { app: "mnastrojarna-cad", version: 2, name: "Deska", material: "ocel", features: [{ id: "b", name: "Kvádr", type: "box", size: [120, 80, 20] } as never] };
    await expect(runReferenceCmd({ kind: "status" }, doc, env)).rejects.toThrow(/není připojená předloha/);
    await expect(runReferenceCmd({ kind: "load", name: "jiny.dwg" }, doc, env)).rejects.toThrow(/není připojený.*připojené: deska\.dxf/);
    const a = await runReferenceCmd({ kind: "load", name: "deska.dxf" }, doc, env);
    expect(a.log[0]).toMatch(/^✓ připojeno: předloha „deska\.dxf“/);
    doc = a.doc!;
    expect(doc.reference).toMatchObject({ name: "deska.dxf", format: "dxf", summary: { sheets: 1, views: 2, dims: 7, contradictions: 2 } });
    expect((await runReferenceCmd({ kind: "extract", what: "title" }, doc, env)).log[0]).toMatch(/NAZEV=DESKA 120x80/);
    const c = await runReferenceCmd({ kind: "compare", view: "top" }, doc, env);
    expect(c.log[0]).toMatch(/^✗ porovnání pohled horní × předloha 1\.1 \(tolerance 0,06 mm\): předloha pokryta modelem \d+(,\d)? %/);
    expect(downloads).toEqual(["porovnani-horni-1.1.svg"]);
    doc = c.doc!;
    expect(doc.reference?.checks?.compare?.top).toMatchObject({ refView: "1.1" });
    const k = await runReferenceCmd({ kind: "checkDims" }, doc, env);
    expect(k.log.some((l) => /^✗ kóta \w+ „Ø20 H7“ .*model 18/.test(l))).toBe(true);
    doc = k.doc!;
    // Ø20 H7 × model 18 a rozpor předlohy 19.8 × 20
    expect(doc.reference?.checks?.dims).toMatchObject({ bad: 2, skipped: 0 });
    expect((await runReferenceCmd({ kind: "status" }, doc, env)).log.some((l) => /^✗ poslední kontrola kót \([^)]+\): \d+ ✓, 2 ✗/.test(l))).toBe(true);
    const o = await runReferenceCmd({ kind: "open" }, doc, env);
    expect(o.newDoc?.kind).toBe("draft");
    expect(o.newDoc?.draft?.entities.length).toBeGreaterThan(20);
    // relace bez souboru v paměti (obnovená stránka): stav ho načte znovu z připojených souborů
    referenceStore.delete(doc.reference!.id);
    expect((await runReferenceCmd({ kind: "status" }, doc, env)).log[0]).toMatch(/^✓ předloha „deska\.dxf“/);
    const rm = await runReferenceCmd({ kind: "remove" }, doc, env);
    expect(rm.doc?.reference).toBeUndefined();
  }, 60_000);
});
