/**
 * Testy převodu DWG → 2D výkres.
 *
 * Fixtures `__fixtures__/dwg-*` jsou ukázkové výkresy z testovacích dat projektu LibreDWG
 * (https://github.com/LibreDWG/libredwg, adresář test/test-data, GPL-3.0 — stejná licence jako
 * použitá knihovna @mlightcad/libredwg-web):
 *  - dwg-sample.dwg              ← sample_2000.dwg        (R2000, AC1015)
 *  - dwg-entities2d-r2000.dwg/.dxf ← 2000/entities-2d.*   (R2000, AC1015, palce; DXF téhož výkresu)
 *  - dwg-example-r2004.dwg       ← example_2004.dwg       (R2004, AC1018)
 *  - dwg-mtext-r2007.dwg         ← 2007/Text.dwg          (R2007, AC1021, palce)
 *  - dwg-blocks-meters-r2010.dwg ← 2010/gh209_1.dwg       (R2010, AC1024, metry)
 *  - dwg-dims-r2013.dwg          ← 2013/gh109_1.dwg       (R2013, AC1027, kóty, čínské texty)
 *  - dwg-example-r2018.dwg       ← example_2018.dwg       (R2018, AC1032; týž výkres jako r2004)
 * Druhá polovina testů skládá syntetickou `DwgDatabase` (MINSERT, vnoření, OCS, šrafy…).
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Dwg_Object_Type, type DwgDatabase, type LibreDwgEx } from "@mlightcad/libredwg-web";
import { describe, expect, it } from "vitest";
import type { DrawEntity, Drawing2D, Pt } from "../drawing2d";
import { ModelImportError } from "../types";
import { LIBREDWG_WASM_DIR } from "../worker-protocol";
import { DWG_READ_ERROR, dwgDatabaseToDrawing, parseDwg, repairLegacyText, supplementDatabase } from "./dwg";

// wasm, který jde do prohlížeče (public/vendor — s nižší počáteční pamětí, viz tools/vendor-occt.mjs);
// bez spuštěného vendor skriptu originál z node_modules
const VENDOR_DIR = fileURLToPath(new URL(`../../../../public${LIBREDWG_WASM_DIR}`, import.meta.url));
const WASM_DIR = existsSync(`${VENDOR_DIR}libredwg-web.wasm`)
  ? VENDOR_DIR
  : fileURLToPath(new URL("../../../../node_modules/@mlightcad/libredwg-web/wasm/", import.meta.url));
const fixturePath = (name: string) => fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));
const fixture = (name: string) => new Uint8Array(readFileSync(fixturePath(name)));
const load = (name: string) => parseDwg(fixture(name), WASM_DIR);

type Kind = DrawEntity["kind"];
type Of<K extends Kind> = Extract<DrawEntity, { kind: K }>;

function kinds(d: Drawing2D): Partial<Record<Kind, number>> {
  const out: Partial<Record<Kind, number>> = {};
  for (const e of d.entities) out[e.kind] = (out[e.kind] ?? 0) + 1;
  return out;
}
const ofKind = <K extends Kind>(d: Drawing2D, k: K) => d.entities.filter((e): e is Of<K> => e.kind === k);
const texts = (d: Drawing2D) => ofKind(d, "text").map((t) => t.text);
const near = (a: Pt, b: Pt, eps = 1e-6) => Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;

function bounds(d: Drawing2D): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const acc = (p: Pt) => {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  };
  for (const e of d.entities) {
    if (e.kind === "line") {
      acc(e.a);
      acc(e.b);
    } else if (e.kind === "polyline" || e.kind === "curve") e.points.forEach(acc);
    else if (e.kind === "circle") {
      acc([e.c[0] - e.r, e.c[1] - e.r]);
      acc([e.c[0] + e.r, e.c[1] + e.r]);
    } else if (e.kind === "text" || e.kind === "point") acc(e.p);
    else acc(e.c);
  }
  return [x0, y0, x1, y1];
}

// ─────────────────── minimální čtečka DXF (referenční data téhož výkresu) ───────────────────

interface DxfEntity {
  type: string;
  codes: Map<number, string>;
}
function readDxf(text: string): { header: Map<string, Map<number, string>>; entities: DxfEntity[] } {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  const header = new Map<string, Map<number, string>>();
  const entities: DxfEntity[] = [];
  let section = "";
  let curVar: Map<number, string> | null = null;
  let curEnt: DxfEntity | null = null;
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i];
    if (code === 0 && value === "SECTION") {
      section = pairs[i + 1]?.[1] ?? "";
      i++;
      continue;
    }
    if (code === 0 && value === "ENDSEC") {
      section = "";
      curEnt = null;
      continue;
    }
    if (section === "HEADER") {
      if (code === 9) header.set(value, (curVar = new Map()));
      else if (curVar && !curVar.has(code)) curVar.set(code, value);
    } else if (section === "ENTITIES") {
      if (code === 0) entities.push((curEnt = { type: value, codes: new Map() }));
      else if (curEnt && !curEnt.codes.has(code)) curEnt.codes.set(code, value);
    }
  }
  return { header, entities };
}

// ───────────────────────────── skutečné soubory DWG ─────────────────────────────

describe("parseDwg — skutečné výkresy", () => {
  it("R2000 (AC1015): základní entity, hladina s barvou, text", async () => {
    const d = await load("dwg-sample.dwg");
    expect(d.format).toBe("DWG (AC1015)");
    expect(d.warnings).toEqual([]);
    expect(d.layers).toEqual([
      { name: "0", color: "fg" },
      { name: "Tavolo 1", color: [1, 1, 0] },
    ]);
    expect(kinds(d)).toEqual({ circle: 1, text: 1, polyline: 1, line: 3 });
    const [c] = ofKind(d, "circle");
    expect(c.r).toBeCloseTo(20, 9);
    expect(c.c[0]).toBeCloseTo(199.681263, 5);
    expect(c.c[1]).toBeCloseTo(24.695759, 5);
    expect(c.layer).toBe("Tavolo 1");
    const [t] = ofKind(d, "text");
    expect(t.text).toBe("Jen teksto simpla, cxu ne?");
    expect([t.hAlign, t.vAlign]).toEqual(["center", "middle"]);
    expect(t.height).toBeCloseTo(5);
    const [pl] = ofKind(d, "polyline");
    expect(pl.closed).toBe(true);
    expect(pl.points).toHaveLength(4);
  });

  it("R2000 v palcích: převod na mm, bloky, kóta, zarovnání textu — a shoda s DXF téhož výkresu", async () => {
    const d = await load("dwg-entities2d-r2000.dwg");
    expect(d.format).toBe("DWG (AC1015)");
    expect(kinds(d)).toEqual({ point: 1, line: 5, arc: 1, circle: 1, text: 2, polyline: 5 });
    expect(d.layers.map((l) => l.name)).toEqual(["0"]);
    // SHAPE neumíme — jedno souhrnné upozornění
    expect(d.warnings).toEqual(["Některé prvky výkresu se nezobrazí — nepodporované typy: SHAPE 1×."]);

    const dxf = readDxf(readFileSync(fixturePath("dwg-entities2d-r2000.dxf"), "latin1"));
    expect(dxf.header.get("$INSUNITS")?.get(70)).toBe("1"); // palce
    const inch = 25.4;
    const dxfOf = (t: string) => dxf.entities.filter((e) => e.type === t);
    const g = (e: DxfEntity, code: number) => Number(e.codes.get(code));
    // počty entit podle DXF (TEXT + ATTRIB → text; ATTDEF a SHAPE se nekreslí)
    expect(ofKind(d, "arc")).toHaveLength(dxfOf("ARC").length);
    expect(ofKind(d, "circle")).toHaveLength(dxfOf("CIRCLE").length);
    expect(ofKind(d, "point")).toHaveLength(dxfOf("POINT").length);
    expect(ofKind(d, "text")).toHaveLength(dxfOf("TEXT").length + dxfOf("ATTRIB").length);
    // geometrie = DXF × 25,4
    const [dc] = dxfOf("CIRCLE");
    const [c] = ofKind(d, "circle");
    expect(c.r).toBeCloseTo(g(dc, 40) * inch, 9);
    expect(near(c.c, [g(dc, 10) * inch, g(dc, 20) * inch])).toBe(true);
    expect(near(c.c, [76.2, 25.4])).toBe(true);
    const [da] = dxfOf("ARC");
    const [a] = ofKind(d, "arc");
    expect(a.r).toBeCloseTo(g(da, 40) * inch, 9);
    // DWG úhly v radiánech, DXF ve stupních
    expect(a.start).toBeCloseTo((g(da, 50) * Math.PI) / 180, 9);
    expect(a.end).toBeCloseTo((g(da, 51) * Math.PI) / 180, 9);
    const [dl] = dxfOf("LINE");
    expect(ofKind(d, "line").some((l) => near(l.a, [g(dl, 10) * inch, g(dl, 20) * inch]) && near(l.b, [g(dl, 11) * inch, g(dl, 21) * inch]))).toBe(true);
    // rozsah výkresu leží v $EXTMIN / $EXTMAX z DXF
    const ext = (v: string) => [Number(dxf.header.get(v)?.get(10)) * inch, Number(dxf.header.get(v)?.get(20)) * inch];
    const [x0, y0, x1, y1] = bounds(d);
    const [ex0, ey0] = ext("$EXTMIN");
    const [ex1, ey1] = ext("$EXTMAX");
    expect(x0).toBeGreaterThanOrEqual(ex0 - 0.05);
    expect(y0).toBeGreaterThanOrEqual(ey0 - 0.05);
    expect(x1).toBeLessThanOrEqual(ex1 + 0.05);
    expect(y1).toBeLessThanOrEqual(ey1 + 0.05);
    expect(x0).toBeCloseTo(ex0, 1);
    expect(y0).toBeCloseTo(ey0, 1);

    // INSERT BLOCK1 (bod (6,1), měřítko 0,5, rotace 30°) s úsečkou (0,0)–(1,1) z bloku
    const k = 0.5 * Math.SQRT2;
    const end: Pt = [(6 + k * Math.cos((75 * Math.PI) / 180)) * inch, (1 + k * Math.sin((75 * Math.PI) / 180)) * inch];
    expect(ofKind(d, "line").some((l) => near(l.a, [6 * inch, inch]) && near(l.b, end))).toBe(true);
    // ALIGNED text „FOO" mezi (1,4) a (3,4) → střed, účaří
    const foo = ofKind(d, "text").find((t) => t.text === "FOO")!;
    expect(near(foo.p, [2 * inch, 4 * inch])).toBe(true);
    expect([foo.hAlign, foo.vAlign]).toEqual(["center", "baseline"]);
    expect(foo.height).toBeCloseTo(0.75 * inch);
    // atribut vložení
    const attr = ofKind(d, "text").find((t) => t.text === "4")!;
    expect(attr.rotation).toBeCloseTo(Math.PI / 2);
    // SOLID: pořadí rohů 1-2-4-3
    expect(ofKind(d, "polyline").some((p) => p.points.length === 4 && near(p.points[2], [8 * inch, 4 * inch]) && near(p.points[3], [7 * inch, 3 * inch]))).toBe(true);
    // kóta: blok *D3 (3 úsečky + 2 šipky), definiční body z hladiny Defpoints se nekreslí
    expect(d.entities.filter((e) => e.kind === "line" && e.a[1] > 7 * inch)).toHaveLength(3);
    expect(ofKind(d, "polyline").filter((p) => p.points.length === 3 && p.closed)).toHaveLength(2);
  });

  it("R2004 a R2018: týž výkres → stejný výsledek; bloky, MTEXT, atributy, kóty včetně ARC_DIMENSION", async () => {
    const a = await load("dwg-example-r2004.dwg");
    const b = await load("dwg-example-r2018.dwg");
    expect(a.format).toBe("DWG (AC1018)");
    expect(b.format).toBe("DWG (AC1032)");
    const round = (d: Drawing2D) => JSON.stringify(d.entities, (_, v) => (typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v));
    expect(round(a)).toBe(round(b));
    expect(a.layers).toEqual(b.layers);

    const d = b;
    expect(d.layers).toEqual([
      { name: "0", color: "fg" },
      { name: "Tavolo 2", color: [1, 1, 0] },
      { name: "Tavolo 3", color: [0, 1, 1] },
    ]);
    expect(kinds(d)).toEqual({ line: 41, polyline: 33, arc: 5, curve: 2, ellipse: 1, point: 97, text: 16, circle: 8 });
    // blok CIRKLO_PUNKTOJ vložený 8× (kružnice r = 130,049 + 12 bodů)
    const circles = ofKind(d, "circle");
    expect(circles.every((c) => Math.abs(c.r - 130.049005) < 1e-5)).toBe(true);
    expect(circles.some((c) => near(c.c, [8482.030567, -1381.341268], 1e-5))).toBe(true);
    expect(circles.some((c) => near(c.c, [9101.460565, -1582.968414], 1e-5))).toBe(true);
    expect(ofKind(d, "point")).toHaveLength(8 * 12 + 1);
    // MTEXT: formátovací kódy → řádky, šířka odstavce, zarovnání nahoru vlevo
    const mt = ofKind(d, "text").find((t) => t.text.startsWith("Teksto granda"))!;
    expect(mt.text).toBe("Teksto granda nur por testi.\nAlia linio.\nAlia pli.");
    expect(mt.width).toBeCloseTo(1465.765285, 5);
    expect([mt.hAlign, mt.vAlign]).toEqual(["left", "top"]);
    // atributy vložených bloků
    expect(texts(d)).toEqual(expect.arrayContaining(["valoro de la teksto en bloko", "valoro", "teksto simpla", "xx", "xx\nxx"]));
    // kóty z anonymních bloků *D… (texty kót), včetně ARC_DIMENSION, kterou convert() vynechává
    expect(texts(d)).toEqual(expect.arrayContaining(["1504,68", "4177,65", "108°", "277,87", "2675,62"]));
    const dimText = ofKind(d, "text").find((t) => t.text === "1504,68")!;
    expect(dimText.rotation).toBeCloseTo(Math.atan2(0.960311, 0.278932), 5);
    // spliny z fit bodů procházejí body
    const [spline] = ofKind(d, "curve");
    expect(near(spline.points[0], [-1160.708289, 1466.299598], 1e-5)).toBe(true);
    // nepodporované typy (i ty, které convert() tiše zahodí) v jednom upozornění
    expect(d.warnings).toHaveLength(1);
    expect(d.warnings![0]).toMatch(/^Některé prvky výkresu se nezobrazí — nepodporované typy: /);
    for (const t of ["REGION 2×", "3DSOLID 1×", "ACAD_TABLE 1×", "TOLERANCE 1×"]) expect(d.warnings![0]).toContain(t);
    // rozsah: minimum přesně $EXTMIN z DXF téhož výkresu (example_2018.dxf), maximum uvnitř $EXTMAX
    const [x0, y0, x1, y1] = bounds(d);
    expect(x0).toBeCloseTo(-2680430.068109198, 4);
    expect(y0).toBeCloseTo(-1672547.179547557, 4);
    expect(x1).toBeLessThanOrEqual(860276.0217899826);
    expect(y1).toBeLessThanOrEqual(1053820.515069022);
  });

  it("R2007 (AC1021): MTEXT v palcích", async () => {
    const d = await load("dwg-mtext-r2007.dwg");
    expect(d.format).toBe("DWG (AC1021)");
    expect(d.entities).toHaveLength(1);
    const [t] = ofKind(d, "text");
    expect(t.text).toBe("This a multiline text to check if libredwg is able to read this in the current file format version");
    expect(t.height).toBeCloseTo(0.2 * 25.4, 9);
    expect(t.width).toBeCloseTo(13.031885 * 25.4, 4);
    expect(near(t.p, [7.332978 * 25.4, 14.115798 * 25.4], 1e-4)).toBe(true);
  });

  it("R2010 (AC1024) v metrech: ×1000, entity bloku na hladině 0 přebírají hladinu vložení, atributy na středu", async () => {
    const d = await load("dwg-blocks-meters-r2010.dwg");
    expect(d.format).toBe("DWG (AC1024)");
    expect(d.warnings).toEqual([]);
    expect(kinds(d)).toEqual({ polyline: 2, text: 5, circle: 3 });
    expect(d.layers.map((l) => l.name)).toEqual(["0", "Border", "Work", "Symbol_Work", "Symbol_Border"]);
    const circles = ofKind(d, "circle");
    expect(circles.map((c) => c.layer).sort()).toEqual(["Symbol_Border", "Symbol_Work", "Symbol_Work"]);
    for (const c of circles) expect(c.r).toBeCloseTo(19.751, 3); // 0,019751 m
    const work = circles.find((c) => near(c.c, [7735.766, 13134.376], 1e-3));
    expect(work?.layer).toBe("Symbol_Work");
    // atributy zarovnané na střed → poloha = bod zarovnání (střed kroužku)
    const a888 = ofKind(d, "text").find((t) => t.text === "888")!;
    expect([a888.hAlign, a888.vAlign]).toEqual(["center", "middle"]);
    expect(near(a888.p, work!.c, 1e-6)).toBe(true);
    expect(a888.height).toBeCloseTo(53.645, 3);
    expect(texts(d).sort()).toEqual(["1", "456", "888", "9456/23", "CLOSED"]);
    const border = ofKind(d, "polyline").find((p) => p.layer === "Border")!;
    expect(border.color).toEqual([1, 0, 1]);
    expect(border.closed).toBe(true);
  });

  it("R2013 (AC1027): kóty, šrafa (obrys), UTF-8 texty, objekty aplikací do upozornění", async () => {
    const d = await load("dwg-dims-r2013.dwg");
    expect(d.format).toBe("DWG (AC1027)");
    expect(texts(d)).toEqual(expect.arrayContaining(["房间", "185.39", "天正单行文字输入", "隔日1", "900", "9657"]));
    // obrys šrafy = uzavřená polyčára
    expect(ofKind(d, "polyline").some((p) => p.closed && p.points.length === 9 && near(p.points[0], [2680, 4277.483808], 1e-5))).toBe(true);
    expect(d.warnings).toHaveLength(1);
    expect(d.warnings![0]).toContain("TCH_WALL 9×");
  });

  it("výkon: všechny fixtures do pár sekund", async () => {
    const names = ["dwg-sample.dwg", "dwg-entities2d-r2000.dwg", "dwg-example-r2004.dwg", "dwg-mtext-r2007.dwg", "dwg-blocks-meters-r2010.dwg", "dwg-dims-r2013.dwg", "dwg-example-r2018.dwg"];
    const t0 = performance.now();
    for (const n of names) await load(n);
    expect(performance.now() - t0).toBeLessThan(10_000);
  });
});

describe("parseDwg — chyby", () => {
  it("soubor bez hlavičky DWG", async () => {
    await expect(parseDwg(new TextEncoder().encode("  0\nSECTION\n  2\nHEADER\n"), WASM_DIR)).rejects.toThrow(ModelImportError);
    await expect(parseDwg(new Uint8Array(0), WASM_DIR)).rejects.toThrow(/není výkres DWG/);
  });

  it("poškozený / useknutý DWG → srozumitelná chyba, další soubor se načte", async () => {
    const good = fixture("dwg-example-r2018.dwg");
    const garbage = new Uint8Array(50_000);
    garbage.set(new TextEncoder().encode("AC1032"));
    for (let i = 6; i < garbage.length; i++) garbage[i] = (i * 2654435761) >>> 24;
    await expect(parseDwg(garbage, WASM_DIR)).rejects.toThrow(DWG_READ_ERROR);
    await expect(parseDwg(good.subarray(0, good.length >> 1), WASM_DIR)).rejects.toThrow(ModelImportError);
    const d = await parseDwg(good, WASM_DIR);
    expect(d.entities.length).toBeGreaterThan(200);
  });

  it("nenačtený modul WASM", async () => {
    await expect(parseDwg(fixture("dwg-sample.dwg"), "/neexistujici/adresar/")).rejects.toThrow(/WebAssembly/);
  });
});

// ───────────────────────────── syntetická databáze ─────────────────────────────

type AnyEnt = Record<string, any>;
interface Blk {
  entities: AnyEnt[];
  basePoint?: { x: number; y: number; z: number };
  flags?: number;
  handle?: string;
}
function mkDb(blocks: Record<string, Blk>, opts: { layers?: AnyEnt[]; header?: AnyEnt } = {}): DwgDatabase {
  const layers = opts.layers ?? [{ name: "0", colorIndex: 7, color: 0xffffff }];
  return {
    tables: {
      BLOCK_RECORD: {
        entries: Object.entries(blocks).map(([name, b], i) => ({
          name, handle: b.handle ?? `B${i}`, flags: b.flags ?? 0, basePoint: b.basePoint ?? { x: 0, y: 0, z: 0 }, entities: b.entities,
        })),
      },
      LAYER: { entries: layers.map((l, i) => ({ handle: `L${i}`, off: false, frozen: false, color: 0xffffff, ...l })) },
    },
    header: opts.header ?? {},
    entities: [],
  } as unknown as DwgDatabase;
}
const line = (x0: number, y0: number, x1: number, y1: number, extra: AnyEnt = {}): AnyEnt => ({
  type: "LINE", layer: "0", colorIndex: 256, startPoint: { x: x0, y: y0, z: 0 }, endPoint: { x: x1, y: y1, z: 0 }, ...extra,
});
const insert = (name: string, extra: AnyEnt = {}): AnyEnt => ({
  type: "INSERT", layer: "0", colorIndex: 256, name, insertionPoint: { x: 0, y: 0, z: 0 }, xScale: 1, yScale: 1, zScale: 1, rotation: 0,
  columnCount: 0, rowCount: 0, columnSpacing: 0, rowSpacing: 0, extrusionDirection: { x: 0, y: 0, z: 1 }, attribs: [], ...extra,
});
const Z_DOWN = { x: 0, y: 0, z: -1 };

describe("dwgDatabaseToDrawing — bloky, barvy, transformace", () => {
  it("MINSERT: pole 3 × 2 s roztečemi v otočeném souřadném systému, základní bod bloku", () => {
    const db = mkDb({
      "*Model_Space": { entities: [insert("B", { insertionPoint: { x: 100, y: 0, z: 0 }, rotation: Math.PI / 2, columnCount: 3, rowCount: 2, columnSpacing: 10, rowSpacing: 20 })] },
      B: { basePoint: { x: 1, y: 0, z: 0 }, entities: [line(1, 0, 2, 0)] },
    });
    const d = dwgDatabaseToDrawing(db);
    const lines = ofKind(d, "line");
    expect(lines).toHaveLength(6);
    // sloupce podél otočené osy X (= +Y světa), řádky podél otočené osy Y (= −X světa)
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const ax = 100 - r * 20;
        const ay = c * 10;
        expect(lines.some((l) => near(l.a, [ax, ay]) && near(l.b, [ax, ay + 1]))).toBe(true);
      }
    }
  });

  it("vnořené bloky: hladina 0 a BYBLOCK se dědí přes dvě úrovně, true color má přednost", () => {
    const db = mkDb(
      {
        "*Model_Space": { entities: [insert("OUTER", { layer: "A", colorIndex: 1, insertionPoint: { x: 10, y: 0, z: 0 }, xScale: 2, yScale: 2 })] },
        OUTER: { entities: [insert("INNER", { colorIndex: 0, insertionPoint: { x: 1, y: 1, z: 0 } }), line(0, 0, 1, 0, { layer: "B" })] },
        INNER: {
          entities: [
            line(0, 0, 1, 0, { colorIndex: 0 }), // BYBLOCK na hladině 0 → hladina A, barva vložení (červená)
            line(0, 0, 0, 1, { colorIndex: 256 }), // BYLAYER na hladině 0 → barva hladiny A
            line(0, 0, 1, 1, { colorIndex: 3, color: 0x123456 }), // true color
          ],
        },
      },
      { layers: [{ name: "0", colorIndex: 7 }, { name: "A", colorIndex: 5 }, { name: "B", colorIndex: 2 }] },
    );
    const d = dwgDatabaseToDrawing(db);
    const lines = ofKind(d, "line");
    expect(lines).toHaveLength(4);
    const byblock = lines.find((l) => near(l.a, [12, 2]) && near(l.b, [14, 2]))!;
    expect(byblock.layer).toBe("A");
    expect(byblock.color).toEqual([1, 0, 0]);
    const bylayer = lines.find((l) => near(l.b, [12, 4]))!;
    expect(bylayer.layer).toBe("A");
    expect(bylayer.color).toEqual([0, 0, 1]);
    const tc = lines.find((l) => near(l.b, [14, 4]))!;
    expect(tc.color).toEqual([0x12 / 255, 0x34 / 255, 0x56 / 255]);
    const own = lines.find((l) => l.layer === "B")!;
    expect(own.color).toEqual([1, 1, 0]);
    expect(near(own.a, [10, 0]) && near(own.b, [12, 0])).toBe(true);
    expect(d.layers.map((l) => l.name)).toEqual(["A", "B"]);
  });

  it("zrcadlené vložení (záporné měřítko): oblouk zůstane obloukem, bulge změní znaménko", () => {
    const db = mkDb({
      "*Model_Space": { entities: [insert("M", { xScale: -1 })] },
      M: {
        entities: [
          { type: "ARC", layer: "0", colorIndex: 256, center: { x: 5, y: 0, z: 0 }, radius: 2, startAngle: 0, endAngle: Math.PI / 2, extrusionDirection: { x: 0, y: 0, z: 1 } },
          { type: "LWPOLYLINE", layer: "0", colorIndex: 256, flag: 0, elevation: 0, extrusionDirection: { x: 0, y: 0, z: 1 }, vertices: [{ x: 0, y: 0, bulge: 1 }, { x: 2, y: 0, bulge: 0 }] },
        ],
      },
    });
    const d = dwgDatabaseToDrawing(db);
    const [arc] = ofKind(d, "arc");
    expect(near(arc.c, [-5, 0])).toBe(true);
    expect(arc.r).toBeCloseTo(2);
    // původně 0°→90° kolem (5,0); zrcadlo → 90°→180° kolem (−5,0)
    expect(arc.start).toBeCloseTo(Math.PI / 2);
    expect(arc.end).toBeCloseTo(Math.PI);
    const [pl] = ofKind(d, "polyline");
    expect(pl.bulges).toEqual([-1, -0]);
    expect(near(pl.points[1], [-2, 0])).toBe(true);
  });

  it("nerovnoměrné měřítko: kružnice → elipsa, oblouk polyčáry se rozloží na body", () => {
    const db = mkDb({
      "*Model_Space": { entities: [insert("S", { xScale: 3, yScale: 1 })] },
      S: {
        entities: [
          { type: "CIRCLE", layer: "0", colorIndex: 256, center: { x: 1, y: 0, z: 0 }, radius: 1, extrusionDirection: { x: 0, y: 0, z: 1 } },
          { type: "LWPOLYLINE", layer: "0", colorIndex: 256, flag: 0, elevation: 0, extrusionDirection: { x: 0, y: 0, z: 0 }, vertices: [{ x: 0, y: 0, bulge: 1 }, { x: 2, y: 0, bulge: 0 }] },
        ],
      },
    });
    const d = dwgDatabaseToDrawing(db);
    const [el] = ofKind(d, "ellipse");
    expect(near(el.c, [3, 0])).toBe(true);
    expect(Math.hypot(...el.major)).toBeCloseTo(3);
    expect(el.ratio).toBeCloseTo(1 / 3);
    expect([el.start, el.end]).toEqual([0, Math.PI * 2]);
    const [pl] = ofKind(d, "polyline");
    expect(pl.bulges).toBeUndefined();
    expect(pl.points.length).toBeGreaterThan(10);
    // půlkruh (0,0)→(2,0) přes (1,−1) → po měřítku přes (3,−1)
    expect(pl.points.some((p) => near(p, [3, -1], 1e-9))).toBe(true);
    expect(near(pl.points[pl.points.length - 1], [6, 0])).toBe(true);
  });

  it("OCS s normálou (0,0,−1): kružnice, oblouk, polyčára a text zrcadlené podle osy Y", () => {
    const db = mkDb({
      "*Model_Space": {
        entities: [
          { type: "CIRCLE", layer: "0", colorIndex: 256, center: { x: 4, y: 1, z: 0 }, radius: 1, extrusionDirection: Z_DOWN },
          { type: "ARC", layer: "0", colorIndex: 256, center: { x: 4, y: 1, z: 0 }, radius: 1, startAngle: 0, endAngle: Math.PI / 2, extrusionDirection: Z_DOWN },
          { type: "LWPOLYLINE", layer: "0", colorIndex: 256, flag: 512, elevation: 0, extrusionDirection: Z_DOWN, vertices: [{ x: 1, y: 0, bulge: 0 }, { x: 2, y: 0, bulge: 0 }, { x: 2, y: 1, bulge: 0 }] },
          { type: "TEXT", layer: "0", colorIndex: 256, text: "OCS", startPoint: { x: 3, y: 2 }, endPoint: { x: 0, y: 0 }, textHeight: 2, rotation: 0, halign: 0, valign: 0, extrusionDirection: Z_DOWN },
        ],
      },
    });
    const d = dwgDatabaseToDrawing(db);
    expect(near(ofKind(d, "circle")[0].c, [-4, 1])).toBe(true);
    const [arc] = ofKind(d, "arc");
    expect(near(arc.c, [-4, 1])).toBe(true);
    expect(arc.start).toBeCloseTo(Math.PI / 2);
    expect(arc.end).toBeCloseTo(Math.PI);
    const [pl] = ofKind(d, "polyline");
    expect(pl.closed).toBe(true);
    expect(pl.points.map((p) => [p[0], p[1]])).toEqual([[-1, 0], [-2, 0], [-2, 1]]);
    const [t] = ofKind(d, "text");
    expect(near(t.p, [-3, 2])).toBe(true);
    expect(t.height).toBeCloseTo(2);
    expect(Math.abs(t.rotation)).toBeCloseTo(Math.PI);
  });

  it("zarovnání TEXT: vlevo/účaří = bod vložení, jinak bod zarovnání (i 0,0); FIT mezi body", () => {
    const base = { type: "TEXT", layer: "0", colorIndex: 256, textHeight: 1, rotation: 0, extrusionDirection: { x: 0, y: 0, z: 1 } };
    const db = mkDb({
      "*Model_Space": {
        entities: [
          { ...base, text: "L", startPoint: { x: 1, y: 1 }, endPoint: { x: 0, y: 0 }, halign: 0, valign: 0 },
          { ...base, text: "TR", startPoint: { x: 5, y: 5 }, endPoint: { x: 0, y: 0 }, halign: 2, valign: 3 },
          { ...base, text: "M", startPoint: { x: 5, y: 5 }, endPoint: { x: 7, y: 8 }, halign: 4, valign: 0 },
          { ...base, text: "F", startPoint: { x: 0, y: 0 }, endPoint: { x: 0, y: 10 }, halign: 5, valign: 0 },
          { ...base, text: "%%c20 %%p0,1 %%d", startPoint: { x: 0, y: 0 }, endPoint: { x: 0, y: 0 }, halign: 0, valign: 0 },
        ],
      },
    });
    const d = dwgDatabaseToDrawing(db);
    const by = (s: string) => ofKind(d, "text").find((t) => t.text === s)!;
    expect(by("L").p).toEqual([1, 1]);
    expect(by("TR").p).toEqual([0, 0]);
    expect([by("TR").hAlign, by("TR").vAlign]).toEqual(["right", "top"]);
    expect(by("M").p).toEqual([7, 8]);
    expect([by("M").hAlign, by("M").vAlign]).toEqual(["center", "middle"]);
    expect(by("F").p).toEqual([0, 5]);
    expect(by("F").rotation).toBeCloseTo(Math.PI / 2);
    expect(by("Ø20 ±0,1 °")).toBeDefined();
  });

  it("MTEXT: kotva 1–9, rotace ze směru osy X", () => {
    const db = mkDb({
      "*Model_Space": {
        entities: [
          { type: "MTEXT", layer: "0", colorIndex: 256, text: "{\\fArial|b1;Ahoj}\\Psvěte", insertionPoint: { x: 1, y: 2, z: 0 }, textHeight: 3, rectWidth: 50, attachmentPoint: 9, direction: { x: 0, y: 1, z: 0 }, rotation: 0 },
        ],
      },
    });
    const [t] = ofKind(dwgDatabaseToDrawing(db), "text");
    expect(t.text).toBe("Ahoj\nsvěte");
    expect([t.hAlign, t.vAlign]).toEqual(["right", "bottom"]);
    expect(t.rotation).toBeCloseTo(Math.PI / 2);
    expect(t.width).toBe(50);
    expect(t.height).toBe(3);
  });

  it("kóta: blok *D s identitou, BYBLOCK = barva kóty; bez bloku aspoň naměřená hodnota", () => {
    const db = mkDb(
      {
        "*Model_Space": {
          entities: [
            { type: "DIMENSION", layer: "DIM", colorIndex: 1, name: "*D1", textPoint: { x: 0, y: 0 } },
            { type: "DIMENSION", layer: "DIM", colorIndex: 256, name: "*D404", measurement: 12.345, text: "", textPoint: { x: 7, y: 8 }, dimensionType: 32 },
            { type: "DIMENSION", layer: "DIM", colorIndex: 256, name: "*D405", measurement: 5, text: "R<> mm", textPoint: { x: 1, y: 1 }, dimensionType: 4 },
          ],
        },
        "*D1": {
          entities: [
            line(0, 0, 10, 0, { colorIndex: 0 }),
            { type: "POINT", layer: "Defpoints", colorIndex: 0, position: { x: 0, y: 0, z: 0 } },
          ],
        },
      },
      { layers: [{ name: "0", colorIndex: 7 }, { name: "DIM", colorIndex: 3 }, { name: "Defpoints", colorIndex: 7 }] },
    );
    const d = dwgDatabaseToDrawing(db);
    const [l] = ofKind(d, "line");
    expect(l.layer).toBe("DIM");
    expect(l.color).toEqual([1, 0, 0]);
    expect(ofKind(d, "point")).toHaveLength(0);
    expect(texts(d)).toEqual(["12,35", "R5 mm"]);
    expect(near(ofKind(d, "text")[0].p, [7, 8])).toBe(true);
  });

  it("šrafa: obrys z polyčáry s bulge i z hran (úsečky + oblouk po směru hodin) navazuje", () => {
    const db = mkDb({
      "*Model_Space": {
        entities: [
          {
            type: "HATCH", layer: "0", colorIndex: 256, extrusionDirection: { x: 0, y: 0, z: 1 },
            boundaryPaths: [
              { boundaryPathTypeFlag: 2, hasBulge: true, isClosed: true, vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 4, y: 0, bulge: 1 }, { x: 4, y: 4, bulge: 0 }] },
              {
                boundaryPathTypeFlag: 1,
                edges: [
                  { type: 1, start: { x: 10, y: 0 }, end: { x: 20, y: 0 } },
                  // po směru hodin z (20,0) do (10,0) kolem (15,0) → spodem přes (15,−5);
                  // DWG/DXF u oblouku po směru hodin ukládá zrcadlené úhly: skutečné 0 → −π uloženo jako 0 a π
                  { type: 2, center: { x: 15, y: 0 }, radius: 5, startAngle: 0, endAngle: Math.PI, isCCW: false },
                ],
              },
            ],
          },
        ],
      },
    });
    const d = dwgDatabaseToDrawing(db);
    const pls = ofKind(d, "polyline");
    expect(pls[0].closed).toBe(true);
    expect(pls[0].bulges).toEqual([0, 1, 0]);
    expect(pls[1].points).toEqual([[10, 0], [20, 0]]);
    const [arc] = ofKind(d, "arc");
    const pt = (a: number): Pt => [arc.c[0] + arc.r * Math.cos(a), arc.c[1] + arc.r * Math.sin(a)];
    // oblouk navazuje na konce úsečky a vede spodem (y < 0)
    const ends = [pt(arc.start), pt(arc.end)];
    expect(ends.some((p) => near(p, [20, 0], 1e-9))).toBe(true);
    expect(ends.some((p) => near(p, [10, 0], 1e-9))).toBe(true);
    let sweep = arc.end - arc.start;
    if (sweep <= 0) sweep += Math.PI * 2;
    expect(pt(arc.start + sweep / 2)[1]).toBeCloseTo(-5);
  });

  it("SPLINE s řídicími body a vahami, LEADER, 3DFACE s neviditelnou hranou, MLINE", () => {
    const w = Math.SQRT1_2;
    const db = mkDb({
      "*Model_Space": {
        entities: [
          { type: "SPLINE", layer: "0", colorIndex: 256, degree: 2, knots: [0, 0, 0, 1, 1, 1], weights: [1, w, 1], controlPoints: [{ x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }], fitPoints: [] },
          { type: "LEADER", layer: "0", colorIndex: 256, isSpline: false, vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 3, y: 1, z: 0 }] },
          { type: "3DFACE", layer: "0", colorIndex: 256, corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 1, y: 0, z: 5 }, corner3: { x: 1, y: 1, z: 0 }, corner4: { x: 0, y: 1, z: 0 }, flag: 2 },
          {
            type: "MLINE", layer: "0", colorIndex: 256, flags: 0,
            vertices: [
              { vertex: { x: 0, y: 0, z: 0 }, miterDirection: { x: 0, y: 1, z: 0 }, lines: [{ segmentParams: [0] }, { segmentParams: [-2] }] },
              { vertex: { x: 10, y: 0, z: 0 }, miterDirection: { x: 0, y: 1, z: 0 }, lines: [{ segmentParams: [0] }, { segmentParams: [-2] }] },
            ],
          },
        ],
      },
    });
    const d = dwgDatabaseToDrawing(db);
    const [curve] = ofKind(d, "curve");
    for (const p of curve.points) expect(Math.hypot(p[0], p[1])).toBeCloseTo(1, 9);
    const pls = ofKind(d, "polyline");
    expect(pls[0].points).toEqual([[0, 0], [1, 1], [3, 1]]);
    expect(pls[0].closed).toBe(false);
    // 3DFACE: hrana 2 (1,0)→(1,1) neviditelná → 3 úsečky
    expect(ofKind(d, "line")).toHaveLength(3);
    expect(ofKind(d, "line").some((l) => near(l.a, [1, 0]) && near(l.b, [1, 1]))).toBe(false);
    expect(pls.slice(1).map((p) => p.points)).toEqual([[[0, 0], [10, 0]], [[0, -2], [10, -2]]]);
  });

  it("neviditelné entity a atributy, ATTDEF, XLINE se nekreslí bez upozornění", () => {
    const db = mkDb({
      "*Model_Space": {
        entities: [
          line(0, 0, 1, 1, { isVisible: false }),
          { type: "ATTDEF", layer: "0", colorIndex: 256, text: { text: "TAG" } },
          { type: "XLINE", layer: "0", colorIndex: 256 },
          insert("A", {
            attribs: [
              { type: "ATTRIB", layer: "0", colorIndex: 256, flags: 1, text: { text: "skrytý", startPoint: { x: 0, y: 0 }, endPoint: { x: 0, y: 0 }, textHeight: 1, rotation: 0, halign: 0, valign: 0 } },
              { type: "ATTRIB", layer: "0", colorIndex: 256, flags: 0, text: { text: "viditelný", startPoint: { x: 0, y: 0 }, endPoint: { x: 0, y: 0 }, textHeight: 1, rotation: 0, halign: 0, valign: 0 } },
            ],
          }),
        ],
      },
      A: { entities: [] },
    });
    const d = dwgDatabaseToDrawing(db);
    expect(texts(d)).toEqual(["viditelný"]);
    expect(d.entities).toHaveLength(1);
    expect(d.warnings).toEqual([]);
  });

  it("cyklický blok, chybějící blok, xref a vynechané typy → upozornění, žádné zacyklení", () => {
    const db = mkDb({
      "*Model_Space": { entities: [insert("LOOP"), insert("CHYBI"), insert("XREF"), insert("R"), insert("R"), { type: "3DSOLID", layer: "0" }] },
      LOOP: { entities: [line(0, 0, 1, 0), insert("LOOP", { insertionPoint: { x: 1, y: 0, z: 0 } })] },
      XREF: { flags: 4, entities: [] },
      R: { entities: [line(0, 0, 0, 1)] },
    });
    const dropped = new Map([["R", new Map([["REGION", 1]])], ["*MODEL_SPACE", new Map([["HELIX", 2]])]]);
    const d = dwgDatabaseToDrawing(db, { version: "AC1032", dropped });
    expect(d.format).toBe("DWG (AC1032)");
    expect(ofKind(d, "line").length).toBeGreaterThanOrEqual(3);
    const w = d.warnings!.join("\n");
    expect(w).toContain("HELIX 2×");
    expect(w).toContain("REGION 2×"); // blok R vložený dvakrát
    expect(w).toContain("3DSOLID 1×");
    expect(w).toContain("Chybí definice bloků (CHYBI)");
    expect(w).toContain("Externí reference (XREF)");
    expect(w).toContain("Bloky LOOP");
  });

  it("jednotky: $INSUNITS = 5 (cm) → ×10; prázdný model → rozvržení (paper space)", () => {
    const d = dwgDatabaseToDrawing(
      mkDb({ "*Model_Space": { entities: [] }, "*Paper_Space": { entities: [line(0, 0, 1, 0), { type: "VIEWPORT", layer: "0" }] } }, { header: { INSUNITS: 5 } }),
    );
    expect(ofKind(d, "line")[0].b).toEqual([10, 0]);
    expect(d.warnings).toEqual(["Modelový prostor je prázdný — zobrazuje se rozvržení (paper space) bez obsahu výřezů."]);
    // jinak se paper space ignoruje
    const m = dwgDatabaseToDrawing(mkDb({ "*Model_Space": { entities: [line(0, 0, 2, 0)] }, "*Paper_Space": { entities: [line(0, 0, 1, 0)] } }));
    expect(ofKind(m, "line")).toHaveLength(1);
    expect(ofKind(m, "line")[0].b).toEqual([2, 0]);
  });

  it("hladiny: vypnutá i zmrazená → off, true color hladiny, chybějící hladina", () => {
    const db = mkDb(
      { "*Model_Space": { entities: [line(0, 0, 1, 0, { layer: "OFF" }), line(0, 0, 1, 0, { layer: "FRZ" }), line(0, 0, 1, 0, { layer: "TC" }), line(0, 0, 1, 0, { layer: "NIC" })] } },
      {
        layers: [
          { name: "0", colorIndex: 7 },
          { name: "OFF", colorIndex: 1, off: true },
          { name: "FRZ", colorIndex: 2, frozen: true },
          { name: "TC", colorIndex: 256, color: 0x00ff00 },
        ],
      },
    );
    const d = dwgDatabaseToDrawing(db);
    expect(d.layers).toEqual([
      { name: "OFF", color: [1, 0, 0], off: true },
      { name: "FRZ", color: [1, 1, 0], off: true },
      { name: "TC", color: [0, 1, 0] },
      { name: "NIC", color: "fg" },
    ]);
    expect(ofKind(d, "line").find((l) => l.layer === "TC")!.color).toEqual([0, 1, 0]);
  });

  it("vadná entita se přeskočí, zbytek výkresu zůstane", () => {
    const bad = { type: "LWPOLYLINE", layer: "0", colorIndex: 256, get vertices(): never { throw new Error("poškozeno"); } };
    const d = dwgDatabaseToDrawing(mkDb({ "*Model_Space": { entities: [bad, line(0, 0, 1, 0)] } }));
    expect(ofKind(d, "line")).toHaveLength(1);
    expect(d.warnings).toEqual(["1 prvek výkresu se nepodařilo převést (poškozená data) — výkres nemusí být úplný."]);
  });
});

describe("supplementDatabase — doplnění entit, které convert() vynechává", () => {
  it("MINSERT → pole vložení, ARC_DIMENSION → blok kóty, neznámé třídy a REGION → upozornění", () => {
    const T = Dwg_Object_Type as unknown as Record<string, number>;
    // dvě definice bloků: *Model_Space (jméno z BLOCK) a BLK (jméno jen z dynapi)
    const owned: Record<number, number[]> = {
      10001: [1, 2, 3, 4, 5, 6], // model: LINE, MINSERT, ARC_DIMENSION, REGION, UNKNOWN_ENT (TCH_WALL), LIGHT
      10002: [7], // BLK: LINE
    };
    const fixed: Record<number, number> = {
      1: T.DWG_TYPE_LINE, 2: T.DWG_TYPE_MINSERT, 3: T.DWG_TYPE_ARC_DIMENSION, 4: T.DWG_TYPE_REGION,
      5: T.DWG_TYPE_UNKNOWN_ENT, 6: T.DWG_TYPE_LIGHT, 7: T.DWG_TYPE_LINE,
    };
    const fields: Record<string, unknown> = {
      "102:ins_pt": { x: 100, y: 50, z: 0 }, "102:scale": { x: 2, y: 2, z: 1 }, "102:rotation": 0,
      "102:num_cols": 3, "102:num_rows": 2, "102:col_spacing": 10, "102:row_spacing": 5,
      "102:extrusion": { x: 0, y: 0, z: 1 }, "102:block_header": 555,
      "103:act_measurement": 12.5, "103:text_midpt": { x: 1, y: 2 }, "103:user_text": "", "103:extrusion": { x: 0, y: 0, z: 1 },
      "1002:name": "BLK",
    };
    const lib = {
      dwg_get_num_objects: () => 100,
      dwg_get_num_classes: () => 3,
      dwg_getall_BLOCK_HEADER: () => [1001, 1002],
      dwg_obj_generic_to_object: (tio: number) => tio + 9000,
      dwg_entity_block_header_get_block: (tio: number) => ({ name: tio === 1001 ? "*Model_Space" : tio === 778 ? "BLK" : "" }),
      get_first_owned_entity: (obj: number) => owned[obj]?.[0] ?? 0,
      get_next_owned_entity: (obj: number, cur: number) => {
        const list = owned[obj] ?? [];
        return list[list.indexOf(cur) + 1] ?? 0;
      },
      dwg_object_get_fixedtype: (cur: number) => fixed[cur],
      dwg_object_to_entity: (cur: number) => cur + 50,
      dwg_object_to_entity_tio: (cur: number) => cur + 100,
      dwg_object_entity_get_color_object: () => ({ index: 3, rgb: 0, method: 195 }),
      dwg_object_entity_get_layer_object_ref: () => ({ handleref: { value: BigInt(0x2a) } }),
      dwg_object_entity_get_invisible: () => 0,
      dwg_obj_get_handle_value: (cur: number) => BigInt(cur),
      dwg_dynapi_entity_data: (tio: number, field: string) => fields[`${tio}:${field}`],
      dwg_ref_get_object: (ref: number) => (ref === 555 ? 777 : 0),
      dwg_object_to_object_tio: (o: number) => o + 1,
      dwg_entity_get_block_name: () => "*D9",
      dwg_object_get_dxfname: (cur: number) => (cur === 4 ? "REGION" : cur === 6 ? "LIGHT" : "UNKNOWN_ENT"),
      dwg_object_get_type: () => 502,
      dwg_get_class: (_d: number, i: number) => ({ dxfname: i === 2 ? "TCH_WALL" : "X" }),
    } as unknown as LibreDwgEx;

    const db = mkDb(
      {
        "*Model_Space": { entities: [line(0, 0, 1, 0)] },
        BLK: { entities: [line(0, 0, 1, 0)] },
        "*D9": { entities: [line(0, 0, 0, 7, { colorIndex: 0 })] },
      },
      { layers: [{ name: "0", colorIndex: 7 }, { name: "VRSTVA", colorIndex: 1, handle: "2A" }] },
    );
    const dropped = supplementDatabase(lib, Dwg_Object_Type as unknown as Record<string, number>, 1, db);
    expect([...(dropped.get("*MODEL_SPACE") ?? new Map())]).toEqual([["REGION", 1], ["TCH_WALL", 1]]);

    const d = dwgDatabaseToDrawing(db, { dropped });
    const lines = ofKind(d, "line");
    // 1 úsečka modelu + 3 × 2 kopie BLK (měřítko 2, rozteč 10 / 5) + 1 úsečka kóty
    expect(lines).toHaveLength(8);
    for (const [ox, oy] of [[0, 0], [10, 0], [20, 0], [0, 5], [10, 5], [20, 5]]) {
      expect(lines.some((l) => near(l.a, [100 + ox, 50 + oy]) && near(l.b, [102 + ox, 50 + oy]) && l.layer === "VRSTVA")).toBe(true);
    }
    const dim = lines.find((l) => near(l.b, [0, 7]))!;
    expect(dim.layer).toBe("VRSTVA");
    expect(dim.color).toEqual([0, 1, 0]); // BYBLOCK → barva kóty (ACI 3)
    expect(d.warnings).toEqual(["Některé prvky výkresu se nezobrazí — nepodporované typy: REGION 1×, TCH_WALL 1×."]);
  });
});

describe("repairLegacyText", () => {
  it("text MULTILEADER z R2004 načtený jako UTF-16 → zpět na 8bitový text", () => {
    expect(repairLegacyText("硸停灜瑸㬱硸", "AC1018")).toBe("xx\\P\\pxt1;xx");
    expect(repairLegacyText("硸停灜瑸㬱硸", "AC1032")).toBe("硸停灜瑸㬱硸"); // R2007+ je UTF-16 správně
    expect(repairLegacyText("Ahoj", "AC1018")).toBe("Ahoj");
    // lichý počet bajtů: poslední znak má jen dolní bajt
    expect(repairLegacyText(String.fromCharCode(0x6261, 0x63), "AC1015")).toBe("abc");
    // čeština v kódové stránce 1250 (č = 0xE8, š = 0x9A)
    expect(repairLegacyText(String.fromCharCode(0x9ae8), "AC1018", "windows-1250")).toBe("čš");
  });
});
