/**
 * Balík 4 (io) – DWG / DXF tam a zpět: všechny druhy entit (jádro + smluvní druhy balíků 2 a 3), hladiny, typy čar,
 * textové a kótovací styly, bloky s atributy, rozvržení s výřezy, XDATA; DXF R2000–R2018 ASCII i binární, DWG R2000–R2018,
 * DXF R12 (vlastní zapisovač), reálné soubory (AutoCAD přes LibreDWG test-data, vlastní DXF cp1250, LibreCAD / DraftSight
 * styl), kódové stránky, zrcadlené OCS, poznámka importu, příkazy EXPORT / IMPORT textem (cs / en / de).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import "../index";
import { setLang } from "../../i18n";
import { applyDraftText } from "../agent";
import { emptyDraftDoc, normalizeDraftDoc } from "../doc";
import type { DraftEntity, DraftModel } from "../model";
import { allEntityLists } from "../model";
import { DwgObjectWriter } from "@node-projects/acad-ts";
import { fullModel } from "./__fixtures__/full-model";
import { draftExport, draftImport, DXF_VERSIONS, fromB64 } from "./index";
import { draftFromFile, draftToDwgFile, draftToDxfFile, encodeCp1250 } from "./files";
import { dimensionGeometry, fmtDim, dimStyleOf } from "./dimgeom";
import { patternLines } from "./hatchpat";
import { hatchPatternSegments, solidTriangles } from "./hatch-explode";
import type { DHatch, DDimension } from "../annot/types";

const FIX = (name: string) => fileURLToPath(new URL(`../../../../../src/lib/viewer3d/formats/__fixtures__/${name}`, import.meta.url));
const FIX2 = (name: string) => fileURLToPath(new URL(`../../../../../src/lib/viewer3d/__fixtures__/${name}`, import.meta.url));
const OWN = (name: string) => fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));

/** zaokrouhlení čísel (porovnání s přesností 1e-9 relativně) a vynechání výchozích hodnot */
function canon(x: unknown, key = ""): unknown {
  if (typeof x === "number") return Math.abs(x) < 1e-9 ? 0 : +x.toPrecision(10);
  if (Array.isArray(x)) return x.map((v) => canon(v));
  if (x && typeof x === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
      if (v === undefined || k === "ext" || k === "measurement") continue;
      if ((k === "rot" || k === "textRot" || k === "twist") && v === 0) continue;
      o[k] = canon(v, k);
    }
    return o;
  }
  void key;
  return x;
}
const ents = (l: DraftEntity[]) => l.map((e) => canon(e));
const layersOf = (m: DraftModel) => canon(m.layers.map(({ ext: _e, ...l }) => (void _e, l)));

function expectSameModel(back: DraftModel, m: DraftModel, opts: { arcDimension?: boolean } = {}) {
  expect(layersOf(back)).toEqual(layersOf(m));
  for (const lt of m.linetypes) expect(back.linetypes.find((x) => x.name === lt.name)?.pattern.map((v) => +v.toFixed(9))).toEqual(lt.pattern.map((v) => +v.toFixed(9)));
  expect(canon(back.textStyles.find((s) => s.name === "Popis"))).toEqual(canon(m.textStyles.find((s) => s.name === "Popis")));
  const ds = back.dimStyles?.find((d) => d.name === "ISO-25");
  for (const [k, v] of Object.entries(m.dimStyles![0])) expect([k, (ds as unknown as Record<string, unknown> | undefined)?.[k]]).toEqual([k, v]);
  expect(back.vars).toMatchObject({ units: "mm", ltscale: 0.5, prec: 3, clayer: "OBRYS", dimstyle: "ISO-25", textstyle: "Popis" });
  const want = m.entities.filter((e) => opts.arcDimension !== false || !(e.type === "dimension" && (e as DDimension).kind === "arc"));
  const got = back.entities.filter((e) => opts.arcDimension !== false || !(e.type === "dimension" && (e as DDimension).kind === "arc"));
  expect(got.map((e) => e.type)).toEqual(want.map((e) => e.type));
  for (let i = 0; i < want.length; i++) expect(ents([got[i]]), `${want[i].id} ${want[i].type}`).toEqual(ents([want[i]]));
  // bloky (bez anonymních – ty jsou geometrie kót)
  const named = (back.blocks ?? []).filter((b) => !(b as { anonymous?: boolean }).anonymous);
  expect(named.map((b) => b.name).sort()).toEqual(m.blocks!.map((b) => b.name).sort());
  for (const b of m.blocks!) {
    const bb = named.find((x) => x.name === b.name)!;
    expect(canon({ ...bb, entities: ents(bb.entities) })).toEqual(canon({ ...b, entities: ents(b.entities) }));
  }
  expect(back.layouts?.map((l) => l.name)).toEqual(m.layouts!.map((l) => l.name));
  for (const l of m.layouts!) {
    const ll = back.layouts!.find((x) => x.name === l.name)!;
    expect(canon((ll as unknown as { paper: unknown }).paper)).toEqual(canon((l as unknown as { paper: unknown }).paper));
    expect(ents(ll.entities)).toEqual(ents(l.entities));
  }
  // XDATA cizí aplikace
  expect(back.entities[1].ext?.xdata?.MOJEAPP).toEqual([[1000, "hodnota"], [1040, 3.25], [1070, 7], [1010, [1, 2, 0]]]);
}

describe("DXF / DWG tam a zpět – všechny druhy, tabulky, bloky, rozvržení", () => {
  it("DXF R2018 ASCII: model → DXF → model beze ztráty", async () => {
    const m = fullModel();
    const f = await draftExport(m, "dxf");
    expect(f.warnings).toEqual([]);
    expect(f.text).toContain("AC1032");
    const back = (await draftImport("t.dxf", f.data)).model;
    expectSameModel(back, m);
  });
  for (const v of ["R2013", "R2010", "R2007", "R2004", "R2000"] as const)
    it(`DXF ${v} ASCII beze ztráty (do R2004 cp1250 / \\U+)`, async () => {
      const m = fullModel();
      const f = await draftExport(m, "dxf", { version: v });
      const back = (await draftImport("t.dxf", f.data)).model;
      expectSameModel(back, m);
    });
  it("binární DXF (R2018, R2000) beze ztráty", async () => {
    const m = fullModel();
    for (const v of ["R2018", "R2000"] as const) {
      const f = await draftExport(m, "dxf", { version: v, binary: true });
      expect(new TextDecoder().decode(f.data.subarray(0, 18))).toBe("AutoCAD Binary DXF");
      const r = await draftImport("t.dxf", f.data);
      expect(r.version).toMatch(/binary$/);
      expectSameModel(r.model, m);
    }
  });
  for (const v of ["R2018", "R2013", "R2010", "R2007", "R2004", "R2000"] as const)
    it(`DWG ${v} beze ztráty`, async () => {
      const m = fullModel();
      const f = await draftExport(m, "dwg", { version: v });
      expect(f.data.length).toBeGreaterThan(5000);
      expect(new TextDecoder().decode(f.data.subarray(0, 6))).toBe({ R2018: "AC1032", R2013: "AC1027", R2010: "AC1024", R2007: "AC1021", R2004: "AC1018", R2000: "AC1015" }[v]);
      const back = (await draftImport("t.dwg", f.data)).model;
      expectSameModel(back, m);
    }, 60000);
  it("id entit, handle a XDATA přežijí dvě kola (DWG → model → DXF → model)", async () => {
    const m = fullModel();
    const a = (await draftImport("a.dwg", (await draftExport(m, "dwg")).data)).model;
    const b = (await draftImport("b.dxf", (await draftExport(a, "dxf")).data)).model;
    expect(b.entities.map((e) => e.id)).toEqual(m.entities.map((e) => e.id));
    expect(b.entities[1].ext?.handle).toBe(a.entities[1].ext?.handle);
    expect(b.entities[1].ext?.xdata?.MOJEAPP?.[0]).toEqual([1000, "hodnota"]);
    expect(b.seq).toBeGreaterThanOrEqual(m.entities.length);
  }, 60000);
  it("kóty: blok geometrie *D se zapíše (čáry, šipky SOLID, text) a jeho hodnota sedí", async () => {
    const m = fullModel();
    const f = await draftExport(m, "dxf");
    const back = (await draftImport("t.dxf", f.data)).model;
    const lin = back.entities.find((e) => e.type === "dimension" && (e as DDimension).kind === "linear") as DDimension;
    expect(lin.measurement).toBeCloseTo(100, 9);
    const blk = back.blocks!.find((b) => b.name === lin.ext?.block)!;
    expect(blk).toBeTruthy();
    expect(blk.entities.filter((e) => e.type === "line").length).toBe(3); // 2 vynášecí + kótovací
    expect(blk.entities.filter((e) => e.type === "hatch").length).toBe(2); // šipky (SOLID)
    // text kóty: s balíkem annot MTEXT (jako AutoCAD), bez něj TEXT
    const txt = blk.entities.find((e) => e.type === "text" || e.type === "mtext") as { s: string } | undefined;
    expect(txt?.s).toBe("100");
    // úhlová 45° a průměr Ø20 (text v bloku)
    const ang = back.entities.find((e) => e.type === "dimension" && (e as DDimension).kind === "angular") as DDimension;
    expect(ang.measurement).toBeCloseTo(Math.PI / 4, 9); // acad-ts měří v radiánech
    const g = dimensionGeometry(ang, back);
    expect(g.measurement).toBeCloseTo(45, 9);
    const dia = back.entities.find((e) => e.type === "dimension" && (e as DDimension).kind === "diameter") as DDimension;
    expect(dimensionGeometry(dia, back).ents.find((e) => e.type === "text")).toMatchObject({ s: "Ø20" });
  });
  it("šrafa: vzor ANSI31 se zapíše s řádky vzoru (DXF 53/43/44/45/46) a ostrov se zachová", async () => {
    const m = fullModel();
    const f = await draftExport(m, "dxf");
    const t = f.text!;
    const i = t.search(/ANSI31\r?\n/);
    expect(i).toBeGreaterThan(0);
    const seg = t.slice(i, i + 2500);
    expect(seg).toMatch(/\n\s*53\r?\n45(\.0)?\r?\n/);
    expect(seg).toMatch(/\n\s*45\r?\n-2\.24/);
    const back = (await draftImport("t.dxf", f.data)).model;
    const h = back.entities.find((e) => e.type === "hatch") as DHatch;
    expect(h.loops.length).toBe(2);
    expect(h.loops[0].outer).toBe(true);
    expect(h.ext?.pat?.[0].angle).toBeCloseTo(45, 9);
  });
});

describe("knihovní části", () => {
  it("vzory šraf: ANSI31 metrický = rozteč 3,175 natočená o 45°, měřítko a úhel", () => {
    const l = patternLines("ANSI31", 1, 0, true)![0];
    expect(l.angle).toBe(45);
    expect(Math.hypot(...l.offset)).toBeCloseTo(3.175, 12);
    expect(l.offset[0]).toBeCloseTo(-3.175 / Math.SQRT2, 12);
    const l2 = patternLines("ANSI31", 2, 30, false)![0];
    expect(l2.angle).toBe(75);
    expect(Math.hypot(...l2.offset)).toBeCloseTo(0.25, 12);
    expect(patternLines("NEZNAMY", 1, 0, true)).toBeNull();
  });
  it("rozklad šrafy: ANSI31 ve čtverci 10×10 = úsečky jen uvnitř, ostrov vynechán; plná výplň = trojúhelníky", () => {
    const h = { type: "hatch", id: "h", layer: "0", pattern: "ANSI31", scale: 1, angle: 0, loops: [{ pts: [[0, 0], [10, 0], [10, 10], [0, 10]], outer: true }, { pts: [[4, 4], [6, 4], [6, 6], [4, 6]] }] } as unknown as DHatch;
    const segs = hatchPatternSegments(h, true);
    expect(segs.length).toBeGreaterThan(5);
    for (const [a, b] of segs) for (const p of [a, b]) expect(p[0] >= -1e-9 && p[0] <= 10 + 1e-9 && p[1] >= -1e-9 && p[1] <= 10 + 1e-9).toBe(true);
    // žádná úsečka neprochází středem ostrova
    for (const [a, b] of segs) {
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      expect(mx > 4.01 && mx < 5.99 && my > 4.01 && my < 5.99).toBe(false);
    }
    const tris = solidTriangles({ ...h, loops: [h.loops[0]] })!;
    const area = tris.reduce((s, [a, b, c]) => s + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2, 0);
    expect(area).toBeCloseTo(100, 9);
  });
  it("hodnota kóty podle stylu ISO-25: 100 → „100“, 12,5 → „12,5“, DIMDEC 1, DIMLFAC", () => {
    const m = fullModel();
    const st = dimStyleOf(m, "ISO-25");
    expect(fmtDim(100, st)).toBe("100");
    expect(fmtDim(12.5, st)).toBe("12,5");
    expect(fmtDim(12.345, { ...st, dimdec: 1 })).toBe("12,3");
    expect(fmtDim(10, { ...st, dimlfac: 2 })).toBe("20");
  });
  it("kódování cp1250 pro DXF před R2007 (čeština přímo, ostatní \\U+)", () => {
    expect(Array.from(encodeCp1250("Žluť"))).toEqual([0x8e, 0x6c, 0x75, 0x9d]);
    expect(new TextDecoder().decode(encodeCp1250("€✓"))).toBe("\u0080\\U+2713".replace("\u0080", new TextDecoder().decode(encodeCp1250("€"))));
  });
  it("oprava acad-ts: zápis DWG bloku je lineární (100 000 entit < 10 s) a bajtově shodný", () => {
    // _writeBlockHeader je nahrazen (acad-patch.ts)
    expect(String((DwgObjectWriter as unknown as { prototype: { _writeBlockHeader: () => void } }).prototype._writeBlockHeader.name)).toBe("writeBlockHeaderLinear");
    const m = normalizeDraftDoc(emptyDraftDoc("x")).draft!;
    const list: DraftEntity[] = [];
    for (let i = 0; i < 100000; i++) list.push({ id: `e${i + 1}`, layer: "0", type: "line", a: [i, 0], b: [i + 5, 3] } as DraftEntity);
    const t0 = performance.now();
    const r = draftToDwgFile({ ...m, entities: list, seq: 100000 });
    const t = performance.now() - t0;
    expect(r.data.length).toBeGreaterThan(1e6);
    expect(t).toBeLessThan(30000);
  }, 120000);
});

describe("DXF R12 (vlastní zapisovač)", () => {
  it("R12: hlavička AC1009, jen entity R12, čtení zpět (acad-ts) – souřadnice přesně", async () => {
    const m = fullModel();
    const f = await draftExport(m, "dxf", { version: "R12" });
    const t = f.text!;
    expect(t).toContain("AC1009");
    for (const bad of ["LWPOLYLINE", "MTEXT", "HATCH", "ELLIPSE", "SPLINE", "LEADER", "TOLERANCE", "XLINE"]) expect(t.includes(`\r\n${bad}\r\n`), bad).toBe(false);
    expect(t).toContain("\r\nPOLYLINE\r\n");
    expect(t).toContain("\r\nDIMENSION\r\n");
    expect(f.warnings.some((w) => /rozvržení/.test(w))).toBe(true);
    const back = (await draftImport("r12.dxf", f.data)).model;
    const types = new Set(back.entities.map((e) => e.type));
    for (const k of ["point", "line", "polyline", "circle", "arc", "text", "dimension", "insert", "hatch"]) expect(types.has(k as DraftEntity["type"]), k).toBe(true);
    const ln = back.entities.find((e) => e.type === "line" && e.layer === "OBRYS") as { a: number[]; b: number[] };
    expect(ln.b[0]).toBe(100.125);
    const pl = back.entities.find((e) => e.type === "polyline" && (e as { closed?: boolean }).closed && e.layer === "OBRYS") as { bulges?: number[] };
    expect(pl.bulges?.[1]).toBeCloseTo(0.4142135623730951, 12);
    const tx = back.entities.find((e) => e.type === "text" && (e as { s: string }).s.startsWith("Žluť")) as { s: string };
    expect(tx.s).toBe("Žluťoučký kůň Ø20 ±0,1 °");
    expect(back.blocks?.some((b) => b.name === "RAZITKO")).toBe(true);
    const ins = back.entities.find((e) => e.type === "insert" && (e as { block: string }).block === "RAZITKO") as { attribs: { tag: string; value: string }[] };
    expect(ins.attribs.find((a) => a.tag === "NAZEV")?.value).toBe("Deska Č.1");
  });
});

describe("reálné soubory", () => {
  const files = ["dwg-sample.dwg", "dwg-entities2d-r2000.dwg", "dwg-entities2d-r2000.dxf", "dwg-example-r2004.dwg", "dwg-mtext-r2007.dwg", "dwg-blocks-meters-r2010.dwg", "dwg-dims-r2013.dwg", "dwg-example-r2018.dwg"];
  for (const f of files)
    it(`${f} (AutoCAD, LibreDWG test-data) – bez výjimky, entity, hladiny, a zpět do DWG / DXF`, async () => {
      const bytes = new Uint8Array(readFileSync(FIX(f)));
      const r = await draftImport(f, bytes);
      expect(r.model.entities.length + (r.model.blocks?.length ?? 0)).toBeGreaterThan(0);
      expect(r.note).toMatch(/Načteno/);
      // a zpět: zápis a znovu čtení beze změny počtu entit modelového prostoru
      for (const fmt of ["dwg", "dxf"] as const) {
        const out = await draftExport(r.model, fmt);
        const again = (await draftImport(`x.${fmt}`, out.data)).model;
        expect(again.entities.length, `${f} → ${fmt}`).toBe(r.model.entities.length);
        expect(again.entities.map((e) => e.type)).toEqual(r.model.entities.map((e) => e.type));
      }
    }, 60000);
  it("example_2018: převody SOLID → šrafa, 3DFACE, WIPEOUT, MLINE, MULTILEADER, ACAD_TABLE; REGION/3DSOLID uchované; ARC_DIMENSION", async () => {
    const r = await draftImport("ex.dwg", new Uint8Array(readFileSync(FIX("dwg-example-r2018.dwg"))));
    const c = r.report.converted;
    expect(c.SOLID).toBeGreaterThanOrEqual(1); // + šipky v blocích kót
    expect(c["3DFACE"]).toBe(2);
    expect(c.WIPEOUT).toBe(2);
    expect(c.MLINE).toBe(1);
    expect(c.MULTILEADER).toBe(1);
    expect(c.ACAD_TABLE).toBe(1);
    expect((r.report.kept.REGION ?? 0) + (r.report.kept["3DSOLID"] ?? 0)).toBeGreaterThanOrEqual(1);
    const types = r.model.entities.map((e) => e.type);
    expect(types.filter((t) => t === "dimension").length).toBe(10);
    expect(r.model.entities.some((e) => e.type === "dimension" && (e as DDimension).kind === "arc")).toBe(true);
    expect(types).toContain("tolerance");
    expect(types).toContain("leader");
    expect(r.model.layouts?.length).toBeGreaterThanOrEqual(1);
    // REGION / 3DSOLID se zapíší zpět
    const out = await draftExport(r.model, "dwg");
    const again = await draftImport("x.dwg", out.data);
    expect(Object.values(again.report.kept).reduce((s, x) => s + x, 0)).toBe(Object.values(r.report.kept).reduce((s, x) => s + x, 0));
  }, 60000);
  it("DXF cp1250 (vlastní výkres příruby): čeština, blok vložený 4×, %%c, MTEXT", async () => {
    const r = await draftImport("priruba.dxf", new Uint8Array(readFileSync(FIX2("priruba-cp1250.dxf"))));
    const m = r.model;
    expect(m.layers.map((l) => l.name)).toEqual(expect.arrayContaining(["KONTURA", "OSY", "KOTY", "POPIS"]));
    expect(m.entities.filter((e) => e.type === "insert").length).toBe(4);
    const texts = m.entities.filter((e) => e.type === "text" || e.type === "mtext").map((e) => (e as { s: string }).s).join(" | ");
    expect(texts).toMatch(/Ø/);
    expect(texts).toMatch(/[ěščřžýáíéůú]/i);
  });
  for (const f of ["librecad-r2000.dxf", "draftsight-r2013.dxf", "r12-cam.dxf", "mirrored-ocs.dxf"])
    it(`${f} – styl jiného programu`, async () => {
      const r = await draftImport(f, new Uint8Array(readFileSync(OWN(f))));
      expect(r.model.entities.length).toBeGreaterThan(0);
      if (f === "mirrored-ocs.dxf") {
        // oblouk s normálou −Z: střed (−10, 5) → WCS (10, 5), úhly 0–90 → 90–180
        const a = r.model.entities.find((e) => e.type === "arc") as { c: number[]; a0: number; a1: number };
        expect(a.c).toEqual([10, 5]);
        expect([a.a0, a.a1]).toEqual([90, 180]);
        const ci = r.model.entities.find((e) => e.type === "circle") as { c: number[] };
        expect(ci.c).toEqual([20, 0]);
      }
      if (f === "r12-cam.dxf") {
        const pl = r.model.entities.find((e) => e.type === "polyline") as { pts: number[][]; bulges?: number[]; closed?: boolean };
        expect(pl.closed).toBe(true);
        expect(pl.bulges?.some((b) => Math.abs(b - 1) < 1e-12)).toBe(true);
      }
      if (f === "librecad-r2000.dxf" || f === "draftsight-r2013.dxf") {
        expect(r.model.layers.find((l) => l.name === "Vrstva 1")).toBeTruthy();
        const off = r.model.layers.find((l) => l.name === "Vypnutá");
        expect(off?.on).toBe(false);
        expect(off?.color).toBe(3);
      }
    });
});

describe("příkazy EXPORT / IMPORT textem (cs / en / de) a API", () => {
  it("2d export dxf verze R12 / binární / dwg verze R2000; chybná volba = chyba", async () => {
    setLang("cs");
    const doc = { ...emptyDraftDoc("Deska"), draft: fullModel() };
    let r = await applyDraftText(doc, "export dxf verze R12");
    let f = r.results[0].data!.file as { name: string; text: string; version: string };
    expect(f.version).toBe("R12");
    expect(f.text).toContain("AC1009");
    r = await applyDraftText(doc, "export dxf binární");
    f = r.results[0].data!.file as { name: string; text: string; version: string };
    expect(f.version).toBe("R2018 binary");
    r = await applyDraftText(doc, "export dwg verze R2000 název Plech");
    const g = r.results[0].data!.file as { name: string; base64: string; version: string };
    expect(g.name).toBe("Plech.dwg");
    expect(new TextDecoder().decode(fromB64(g.base64).subarray(0, 6))).toBe("AC1015");
    r = await applyDraftText(doc, "export dwg verze R12");
    expect(r.results[0].ok).toBe(false);
    r = await applyDraftText(doc, "export dxf verze R2099");
    expect(r.results[0].error).toMatch(/R2099/);
    // en / de
    r = await applyDraftText(doc, "dxfout dxf version R2013");
    expect((r.results[0].data!.file as { version: string }).version).toBe("R2013");
    r = await applyDraftText(doc, "exportieren dxf binary");
    expect(r.results[0].ok).toBe(true);
  }, 60000);
  it("2d import \"x.dwg\" <base64> = nová záložka s modelem; poznámka s převody", async () => {
    const dwg = await draftExport(fullModel(), "dwg");
    const doc = emptyDraftDoc("Prázdný");
    const r = await applyDraftText(doc, `import "deska.dwg" ${dwg.base64}`);
    expect(r.results[0].ok).toBe(true);
    expect(r.newDoc?.draft?.entities.length).toBe(fullModel().entities.length);
    expect(r.newDoc?.name).toBe("deska");
    expect(r.log[0]).toMatch(/Načteno \d+ entit/);
    expect((r.results[0].data!.import as { format: string }).format).toBe("dwg");
  }, 60000);
  it("všechny verze exportu DXF jsou v nabídce", () => {
    expect(DXF_VERSIONS).toEqual(["R2018", "R2013", "R2010", "R2007", "R2004", "R2000", "R12"]);
  });
  it("prostory: entity ve všech prostorech mají jedinečné id", async () => {
    const back = (await draftImport("t.dwg", (await draftExport(fullModel(), "dwg")).data)).model;
    const ids = allEntityLists(back).flatMap((s) => s.list.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
  }, 60000);
});

describe("STL (3D) – co existuje", () => {
  it("binární STL tam a zpět beze ztráty float32 (parseSTL / writeBinarySTL)", async () => {
    const { parseSTL, writeBinarySTL } = await import("../../formats/mesh-io");
    const positions = new Float32Array([0, 0, 0, 10.125, 0, 0, 0, 7.3333335, 1e-3, 0, 0, 0, 0, 7.3333335, 1e-3, -4.5, 2.25, 9.875]);
    const mesh = { positions, indices: new Uint32Array([0, 1, 2, 3, 4, 5]) };
    const back = parseSTL(writeBinarySTL(mesh));
    expect(Array.from(back.positions)).toEqual(Array.from(positions));
    const cube = parseSTL(new Uint8Array(readFileSync(FIX2("cube-10mm.stl"))));
    expect(cube.positions.length / 9).toBe(12);
  });
});

describe("pomůcky", () => {
  it("draftFromFile: DWG starší než R2000 = srozumitelná chyba", () => {
    const fake = new TextEncoder().encode("AC1014" + "\0".repeat(200));
    expect(() => draftFromFile("old.dwg", fake)).toThrow(/R2000–R2018/);
  });
  it("draftToDxfFile R2000: hlavička $DWGCODEPAGE ANSI_1250 a čeština v cp1250", () => {
    const r = draftToDxfFile(fullModel(), { version: "R2000" });
    expect(r.text).toContain("ANSI_1250");
    const bytes = r.data;
    // „Ž“ = 0x8E v cp1250
    expect(bytes.includes(0x8e)).toBe(true);
  });
});
