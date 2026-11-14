/**
 * Vlna 15 (předloha, test 959) – import objektů AutoCAD Mechanical a věrnost předlohy:
 *  – neznámé entity vlastních tříd s náhradní grafikou (DXF 92/310) se převedou na blok + vložení s `ext.acm`
 *    (dřív je acad-ts bez hlášení zahodil: poznámka importu „nic nechybí“, ve výkresu chyběly pozice, kusovník, normálie),
 *  – texty náhradní grafiky (Text2 – acad-ts vrací jen syrové bajty) se dekódují,
 *  – data tříd (řetězce v bitovém proudu) se čtou při všech 8 posunech; normálie STDPART2D → norma, druh, pohled, označení,
 *  – zobrazený text kóty z bloku *D se uchová (`ext.shown`) a rozpor s geometrií jde do poznámky importu,
 *  – neviditelné entity (DXF 60) se nekreslí, nevybírají ani nepočítají do rozsahu,
 *  – zaokrouhlení kót s tolerancí poloviny (4,349999999999909 → 4,4 jako AutoCAD).
 * Skutečný výkres 959 (AutoCAD Mechanical, R2004) je v reference/reference-959.test.ts (bez souboru se přeskočí).
 */
import { describe, expect, it } from "vitest";
import "../index";
import { GraphicsType, ProxyCircularArc, ProxyModelTransform, ProxyRawGeometry, Matrix4, XYZ } from "@node-projects/acad-ts";
import { newDraftModel } from "../doc";
import type { DraftEntity, DraftModel } from "../model";
import { draftFromFile, draftToDxfFile } from "./files";
import { importNoteText } from "./index";
import { checkDimText, dimPlain, parseDimText } from "./dimtext";
import { codePageDecoder, decodeProxyText, payloadStrings, proxyToEntities, stdPartInfo } from "./proxy";
import { toFixedDec } from "../annot/dimstyle";
import { extents } from "../status";
import { plotModel } from "../layout/plot";
import { pickEntity } from "../select";
import { spatialIndex } from "../spatial";
import type { DDimension } from "../annot/types";

const dec = codePageDecoder("ANSI_1250");

/** záznam Text2 náhradní grafiky (stejné rozložení jako zapisuje AutoCAD Mechanical) */
function text2(p: [number, number], s: string, h = 2.5, dir: [number, number] = [1, 0]): Uint8Array {
  const str = new Uint8Array([...s].map((c) => c.charCodeAt(0)));
  const strLen = (str.length + 1 + 3) & ~3;
  const buf = new ArrayBuffer(72 + strLen + 8 + 32 + 20 + 8);
  const dv = new DataView(buf);
  const f = (o: number, v: number) => dv.setFloat64(o, v, true);
  f(0, p[0]);
  f(8, p[1]);
  f(16, 0);
  f(24, 0);
  f(32, 0);
  f(40, 1);
  f(48, dir[0]);
  f(56, dir[1]);
  f(64, 0);
  new Uint8Array(buf, 72, str.length).set(str);
  let o = 72 + strLen;
  dv.setInt32(o, str.length, true);
  dv.setInt32(o + 4, 0, true);
  o += 8;
  f(o, h);
  f(o + 8, 1);
  f(o + 16, 0);
  f(o + 24, 0);
  return new Uint8Array(buf);
}
const P = (x: number, y: number) => new XYZ(x, y, 0);

/** zápis náhradní grafiky (formát DWG/DXF: celková délka, počet, záznamy [délka, typ, data]) */
function writeGraphics(recs: [number, number[] | Uint8Array][]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [type, data] of recs) {
    const body = data instanceof Uint8Array ? data : new Uint8Array(new Float64Array(data).buffer);
    const head = new Uint8Array(8);
    new DataView(head.buffer).setInt32(0, body.length + 8, true);
    new DataView(head.buffer).setInt32(4, type, true);
    parts.push(head, body);
  }
  const total = 8 + parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  new DataView(out.buffer).setInt32(0, total, true);
  new DataView(out.buffer).setInt32(4, recs.length, true);
  let o = 8;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}
const u32 = (v: number) => new Uint8Array(new Uint32Array([v]).buffer);
/** body jako int32 počet + 3×f64 */
function pts(list: [number, number][]): Uint8Array {
  const b = new Uint8Array(4 + list.length * 24);
  const dv = new DataView(b.buffer);
  dv.setInt32(0, list.length, true);
  list.forEach(([x, y], i) => (dv.setFloat64(4 + i * 24, x, true), dv.setFloat64(12 + i * 24, y, true), dv.setFloat64(20 + i * 24, 0, true)));
  return b;
}

/** náhradní grafika pozice (ACMBALLOON): kružnice, odkazová čára, plný trojúhelník šipky, číslo pozice */
function balloonGraphics(n: string, at: [number, number]): Uint8Array {
  return writeGraphics([
    [GraphicsType.SubentColor, u32(3)],
    [GraphicsType.Circle, [at[0], at[1], 0, 5, 0, 0, 1]],
    [GraphicsType.Polyline, pts([[at[0] - 5, at[1]], [at[0] - 30, at[1] - 20]])],
    [GraphicsType.SubentFillon, u32(1)],
    [GraphicsType.Polygon, pts([[at[0] - 30, at[1] - 20], [at[0] - 27, at[1] - 17], [at[0] - 26, at[1] - 19]])],
    [GraphicsType.SubentFillon, u32(0)],
    [GraphicsType.Text2, text2([at[0] - 1.2, at[1] - 1.25], n)],
  ]);
}

/** DXF R2018 s vlastní třídou ACMBALLOON (jako AutoCAD Mechanical: CLASSES + entita s 92/310) */
function dxfWithCustomEntity(): string {
  const m = newDraftModel();
  m.entities.push({ id: "e1", type: "line", layer: "0", a: [0, 0], b: [100, 0] } as DraftEntity);
  m.seq = 1;
  let text = draftToDxfFile(m).text!;
  const cls = ["  0", "CLASS", "  1", "ACMBALLOON", "  2", "AcmBalloon", "  3", "AcMechanical", " 90", "1025", " 91", "1", "280", "0", "281", "1"].join("\n");
  text = text.replace(/(  2\r?\nCLASSES\r?\n)/, `$1${cls}\n`);
  const g = balloonGraphics("7", [50, 40]);
  const hex = [...g].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
  const chunks: string[] = [];
  for (let i = 0; i < hex.length; i += 254) chunks.push("310", hex.slice(i, i + 254));
  const ent = ["  0", "ACMBALLOON", "  5", "7A1", "100", "AcDbEntity", "  8", "AM_5", " 92", String(g.length), ...chunks, "100", "AcmBalloon", " 70", "1"].join("\n");
  return text.replace(/(  2\r?\nENTITIES\r?\n)/, `$1${ent}\n`);
}

describe("AutoCAD Mechanical – objekty vlastních tříd s náhradní grafikou", () => {
  it("DXF: pozice ACMBALLOON se převede na blok + vložení (dřív tiše zmizela) a je v poznámce importu", () => {
    const raw = dxfWithCustomEntity();
    const r = draftFromFile("pozice.dxf", new TextEncoder().encode(raw));
    expect(r.note.converted.ACMBALLOON).toBe(1);
    const ins = r.model.entities.find((e) => e.ext?.acm) as (DraftEntity & { block: string }) | undefined;
    expect(ins?.type).toBe("insert");
    expect(ins?.layer).toBe("AM_5");
    expect(ins?.ext?.dxf).toBe("ACMBALLOON");
    expect(ins?.ext?.acm).toMatchObject({ cls: "ACMBALLOON", h: "7A1", texts: ["7"] });
    const blk = r.model.blocks?.find((b) => b.name === ins!.block);
    expect(blk?.anonymous).toBe(true);
    const types = blk!.entities.map((e) => e.type).sort();
    expect(types).toEqual(["circle", "hatch", "line", "text"]);
    const c = blk!.entities.find((e) => e.type === "circle") as DraftEntity & { c: [number, number]; r: number; color?: number };
    expect(c.c).toEqual([50, 40]);
    expect(c.r).toBe(5);
    expect(c.color).toBe(3);
    expect(importNoteText(r.note, r.version)).toContain("ACMBALLOON 1");
    // rozsah výkresu obsahuje pozici
    const ex = extents(r.model, r.model.entities)!;
    expect(ex.y1).toBeCloseTo(45, 6);
    // tisk pozici nakreslí (text „7“ je v obsahu stránky)
    const page = plotModel(r.model, { paper: { w: 297, h: 210 } } as never);
    expect(JSON.stringify(page).includes('"7"')).toBe(true);
  });

  it("náhradní grafika: oblouk, transformace modelu, text Text2 s \\U+2205 (Ø)", () => {
    const arc = new ProxyCircularArc();
    arc.center = P(0, 0);
    arc.radius = 10;
    arc.normal = new XYZ(0, 0, 1);
    arc.startVectorDirection = new XYZ(1, 0, 0);
    arc.sweepAngle = Math.PI / 2;
    // posun o (100, 50) a měřítko 2
    const m = new Matrix4([2, 0, 0, 100, 0, 2, 0, 50, 0, 0, 2, 0, 0, 0, 0, 1]);
    const geoms = [new ProxyModelTransform(GraphicsType.PushModelTransform, m), arc, new ProxyRawGeometry(GraphicsType.Text2, text2([1, 2], "\\U+22058H7", 2.5, [0, 1])), new ProxyRawGeometry(GraphicsType.PopModelTransform, new Uint8Array(0))];
    const r = proxyToEntities(geoms, dec);
    const a = r.entities.find((e) => e.type === "arc") as unknown as { c: number[]; r: number; a0: number; a1: number };
    expect(a.c).toEqual([100, 50]);
    expect(a.r).toBe(20);
    expect([a.a0, a.a1]).toEqual([0, 90]);
    const t = r.entities.find((e) => e.type === "text") as unknown as { p: number[]; h: number; s: string; rot: number };
    expect(t.s).toBe("∅8H7");
    expect(t.p).toEqual([102, 54]);
    expect(t.h).toBe(5);
    expect(t.rot).toBe(90);
    expect(r.texts).toEqual(["∅8H7"]);
  });

  it("text Text2: dekodér syrových bajtů (počátek, směr, výška, řetězec v kódové stránce výkresu)", () => {
    const x = decodeProxyText(GraphicsType.Text2, text2([3, 4], "KALIT 60+2 HRc", 3.5), dec)!;
    expect(x.s).toBe("KALIT 60+2 HRc");
    expect(x.p.slice(0, 2)).toEqual([3, 4]);
    expect(x.h).toBe(3.5);
    expect(x.dir.slice(0, 2)).toEqual([1, 0]);
  });

  it("data třídy: řetězce v bitovém proudu při libovolném posunu, údaje normálie STDPART2D", () => {
    const s = "/AMSTD/DIN/FEAT/ITHREAD/THRGH/XX0001/T";
    const d = "DIN 13 T1 - M8";
    const bytes = [0x11, 0x92, ...[...s].map((c) => c.charCodeAt(0)), 0x01, 0x03, ...[...d].map((c) => c.charCodeAt(0)), 0x02];
    // posun o 3 bity (řetězec nezačíná na celém bajtu)
    const bits = bytes.map((b) => b.toString(2).padStart(8, "0")).join("") + "00000000";
    const sh = "101" + bits;
    const u8 = new Uint8Array(Math.ceil(sh.length / 8));
    for (let i = 0; i < u8.length; i++) u8[i] = parseInt(sh.slice(i * 8, i * 8 + 8).padEnd(8, "0"), 2);
    const strs = payloadStrings(u8, dec);
    expect(strs).toContain(s);
    expect(strs).toContain(d);
    expect(stdPartInfo(strs)).toEqual({ branch: s, std: "DIN", type: "FEAT/ITHREAD/THRGH", view: "T", desig: d });
    expect(stdPartInfo(["/AMSTD/ISO/FSTN/PIN/CYL/IS2338/F", "ISO 2338 - 8 m6 x 60 - A"])).toMatchObject({ type: "FSTN/PIN/CYL", view: "F", desig: "ISO 2338 - 8 m6 x 60 - A" });
  });
});

describe("zobrazený text kóty (blok *D) a rozpor s geometrií", () => {
  it("rozbor textu: Ø, tolerance zlomkem, uložení, závit, sražení, informativní kóta, počet", () => {
    expect(parseDimText("\\A1;%%c14{\\H0.7x;\\S+0.018^ 0;}")).toMatchObject({ dia: true, value: 14, tol: { upper: 0.018, lower: 0 } });
    expect(parseDimText("\\A1;(34.4)")).toMatchObject({ reference: true, value: 34.4, decimals: 1 });
    expect(parseDimText("%%c8H7")).toMatchObject({ dia: true, value: 8, fit: "H7" });
    expect(parseDimText("26%%p0.05")).toMatchObject({ value: 26, tol: { upper: 0.05, lower: -0.05 } });
    expect(parseDimText("185 -0.1")).toMatchObject({ value: 185, tol: { upper: 0, lower: -0.1 } });
    expect(parseDimText("M8")).toMatchObject({ thread: "M8" });
    expect(parseDimText("2*45%%d")).toMatchObject({ chamfer: { size: 2, angle: 45 } });
    expect(parseDimText("4x %%c9")).toMatchObject({ count: 4, dia: true, value: 9 });
    expect(dimPlain("\\A2;19,8")).toBe("19,8");
    expect(checkDimText(parseDimText("19.8"), 19.9)).toBe("mismatch");
    expect(checkDimText(parseDimText("17.9"), 17.858943)).toBe("rounded");
    expect(checkDimText(parseDimText("74.175"), 74.175)).toBe("ok");
    expect(checkDimText(parseDimText("M8"), 8)).toBe("none");
  });

  it("import: kóta s textem 19.8 u geometrie 19.9 → ext.shown + varování v poznámce (dřív se text přepsal a rozpor zmizel)", () => {
    const m: DraftModel = newDraftModel();
    m.entities.push({ id: "e1", type: "dimension", layer: "0", kind: "linear", p1: [0, 0], p2: [19.9, 0], line: [0, -10], text: "19.8" } as unknown as DraftEntity);
    m.entities.push({ id: "e2", type: "dimension", layer: "0", kind: "linear", p1: [0, 20], p2: [40, 20], line: [0, 30] } as unknown as DraftEntity);
    m.seq = 2;
    const back = draftFromFile("k.dxf", draftToDxfFile(m).data);
    const d1 = back.model.entities.find((e) => e.type === "dimension" && Math.abs((e as DDimension & { p2: number[] }).p2[0] - 19.9) < 1e-9)!;
    expect(dimPlain(d1.ext?.shown ?? "")).toBe("19.8");
    expect(back.note.dimText?.length).toBe(1);
    expect(back.note.dimText?.[0]).toMatchObject({ shown: "19.8", measured: 19.9 });
    expect(importNoteText(back.note)).toMatch(/ukazuje 19\.8, geometrie 19\.9/);
  });

  it("zaokrouhlení s tolerancí poloviny: 4,349999999999909 → 4,4 (jako AutoCAD), ostatní beze změny", () => {
    expect(toFixedDec(4.349999999999909, 1)).toBe("4.4");
    expect(toFixedDec(21.84, 1)).toBe("21.8");
    expect(toFixedDec(1.005, 2)).toBe("1.01");
    expect(toFixedDec(2.675, 2)).toBe("2.68");
    expect(toFixedDec(-4.349999999999909, 1)).toBe("-4.4");
    expect(toFixedDec(74.175317, 3)).toBe("74.175");
  });
});

describe("neviditelné entity (DXF 60)", () => {
  const model = (): DraftModel => {
    const m = newDraftModel();
    m.entities.push({ id: "e1", type: "line", layer: "0", a: [0, 0], b: [10, 0] } as DraftEntity);
    m.entities.push({ id: "e2", type: "point", layer: "0", p: [5000, 5000], ext: { invisible: true } } as unknown as DraftEntity);
    m.entities.push({ id: "e3", type: "insert", layer: "0", block: "RAM", p: [0, 0], sx: 1, sy: 1, rot: 0 } as unknown as DraftEntity);
    m.blocks = [{ name: "RAM", base: [0, 0], entities: [{ id: "e4", type: "line", layer: "0", a: [0, 0], b: [0, 10] } as DraftEntity, { id: "e5", type: "text", layer: "0", p: [-900, -900], h: 2.5, s: "!GENTITLE-MAX", ext: { invisible: true } } as unknown as DraftEntity] }];
    m.seq = 5;
    return m;
  };
  it("rozsah, tisk a výběr je vynechají (dřív rozsah i s nimi a bludné popisky rámečků „!GENTITLE-…“)", () => {
    const m = model();
    const ex = extents(m, m.entities)!;
    expect([ex.x0, ex.y0, ex.x1, ex.y1]).toEqual([0, 0, 10, 10]);
    const page = JSON.stringify(plotModel(m, { paper: { w: 297, h: 210 } } as never));
    expect(page.includes("GENTITLE")).toBe(false);
    const idx = spatialIndex(m.entities, { model: m });
    expect(pickEntity(m, idx, [5000, 5000], 1)).toBeNull();
    // zůstanou v modelu pro zápis zpět
    const back = draftFromFile("n.dxf", draftToDxfFile(m).data);
    expect(back.model.entities.some((e) => e.type === "point" && e.ext?.invisible)).toBe(true);
  });
});
