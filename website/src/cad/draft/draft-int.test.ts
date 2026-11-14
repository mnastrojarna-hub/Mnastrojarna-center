/**
 * Integrace vlny 9 (jádro + balíky edit, annot, layout, io): výkres nástrojaře textem pro agenty od hladin po tisk PDF
 * a DWG / DXF tam a zpět, mezibalíkové případy (kóta v bloku, šrafa v rozvržení, anotativní kóty ve výřezu, úchopy kóty,
 * MTEXT v DWG) a požadavky balíků na jádro (zkratky voleb, protokol neúspěšného příkazu, DraftTx.restore, PSLTSCALE,
 * „alle“, výchozí volba výzvy, bod vložení bloku v DXF).
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import "./index";
import { setLang } from "../i18n";
import type { CadDoc } from "../types";
import { applyDraftText, draftLine } from "./agent";
import { annoScaledList } from "./annot/anno";
import { dimGeom } from "./annot/kinds-annot";
import type { DDimension, DHatch } from "./annot/types";
import { findCommand, kw, matchKw, promptDefault, promptText, runCommandLine, runScript } from "./commands";
import { newDraftModel } from "./doc";
import { draftExport, draftImport } from "./io";
import { kindOf } from "./kinds";
import { vpDrawList } from "./layout/kinds";
import { setPdfFont } from "./layout/pdf";
import type { DInsert, DViewport } from "./layout/types";
import type { DraftEntity, DraftModel } from "./model";
import { sessionFor } from "./session";
import { DraftTx } from "./tx";

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThanOrEqual(eps);
const newDoc = () => ({ app: "mnastrojarna-cad", version: 2, name: "x", material: "ocel", features: [] }) as unknown as CadDoc;

/** výkres nástrojaře jen textem `2d …` (stejný postup jako e2e cad-w9-2d) */
export const TOOLMAKER = `
2d nový Deska mm
2d hladina nová OBRYS barva 7 tloušťka 0.5; hladina nová OSY barva 1 typčáry CENTER tloušťka 0.25; hladina nová KÓTY barva 3; hladina nová ŠRAFY barva 8; hladina nová RAZÍTKO barva 7
2d hladina aktuální OBRYS
2d čára 0,0 120,0 120,80 0,80 uzavřít
2d zaoblit poloměr 10 e2@120,70 e3@110,80
2d zaoblit poloměr 10 e3@10,80 e4@0,70
2d oblouk střed 60,0 75,0 45,0
2d kružnice 30,40 6; kružnice 90,40 6
2d ekvidistanta 5 e1 60,40
2d čára -10,20 130,20
2d oříznout řezné-hrany e2 e4 "" e11@-5,20 e11@125,20
2d hladina aktuální OSY; čára 24,40 36,40; čára 30,34 30,46
2d hladina aktuální ŠRAFY
2d šrafa vzor ANSI31 měřítko 1 60,60
2d hladina aktuální KÓTY
2d kóta-lineární 0,0 30,40 15,-15
2d kóta-základnicová 90,40; kóta-základnicová 120,0
2d kóta-lineární 120,0 120,40 140,20; kóta-řetězová 120,80
2d kóta-průměr e8 30,55
2d kóta-poloměr e6 -10,95
2d mtext 130,80 @60,-20 "Neoznačená sražení 1×45°\\PDrsnost Ra 3,2"
2d tolerance poloha ø0.05M A,B 130,40
2d hladina aktuální RAZÍTKO
2d obdélník 0,-60 @80,-20
2d definice-atributu NAZEV "Název" "Deska" 2,-68 3.5 0
2d definice-atributu CISLO "Číslo výkresu" "V-000" 2,-75 3.5 0
2d blok RAZITKO 0,-80 okno -1,-81 81,-59 smazat
2d hladina aktuální OBRYS; čára 0,-30 100,-30
2d rozvržení nové Výroba A3 bez-výřezu bez-razítka
2d výřez 15,35 175,285 1:1
2d výřez střed poslední 60,30
2d výřez 180,35 410,285 2:1
2d výřez střed poslední 50,-30
2d vložit RAZITKO 330,8 1 1 0 "V-001" "Deska 120×80"
2d tisk mono název Deska
`;

/** úsečky obsahu PDF (souřadnice v mm po „cm“): [x1, y1, x2, y2] */
export function pdfSegments(pdf: Uint8Array): number[][] {
  const s = Buffer.from(pdf).toString("latin1");
  const segs: number[][] = [];
  const re = /<<([^]*?)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const len = Number(/\/Length (\d+)/.exec(m[1])?.[1] ?? -1);
    const end = len >= 0 ? start + len : s.indexOf("endstream", start);
    let body = Buffer.from(s.slice(start, end), "latin1");
    if (/FlateDecode/.test(m[1])) {
      try {
        body = inflateSync(body);
      } catch {
        continue;
      }
    }
    const txt = body.toString("latin1");
    const ops = txt.split(/\n/);
    for (let i = 1; i < ops.length; i++) {
      const a = /^(-?[\d.]+) (-?[\d.]+) m$/.exec(ops[i - 1]);
      const b = /^(-?[\d.]+) (-?[\d.]+) l$/.exec(ops[i]);
      if (a && b) segs.push([+a[1], +a[2], +b[1], +b[2]]);
    }
  }
  return segs;
}

async function runAll(text: string, start = newDoc()) {
  let doc = start;
  const all: Awaited<ReturnType<typeof applyDraftText>>["results"] = [];
  for (const l of text.split("\n").map((x) => x.trim()).filter(Boolean)) {
    const r = await applyDraftText(doc, draftLine(l)!);
    all.push(...r.results);
    doc = r.newDoc ?? r.doc;
  }
  return { doc, all, m: doc.draft as DraftModel };
}

describe("integrace 2D: výkres nástrojaře textem (agent)", () => {
  it("deska: obrys, zaoblení, ekvidistanta, ořez, šrafa, kóty ISO-25, MTEXT, GD&T, razítko s atributy, A3 1:1 + 2:1, PDF, DWG / DXF zpět", async () => {
    setLang("cs");
    setPdfFont(new Uint8Array(readFileSync("public/fonts/Roboto-Regular.ttf")));
    const { all, m } = await runAll(TOOLMAKER);
    for (const r of all) expect(r.error, r.input).toBeUndefined();
    const E = (id: string) => m.entities.find((e) => e.id === id) as DraftEntity & Record<string, unknown>;
    // zaoblení R10 tečně k hranám, ekvidistanta, ořez
    expect(E("e5")).toMatchObject({ type: "arc", c: [110, 70], r: 10, a0: 0, a1: 90 });
    expect(E("e6")).toMatchObject({ type: "arc", c: [10, 70], r: 10, a0: 90, a1: 180 });
    expect(E("e2")).toMatchObject({ a: [120, 0], b: [120, 70] });
    expect(E("e10")).toMatchObject({ type: "line", a: [0, 5], b: [120, 5] });
    expect(E("e11")).toMatchObject({ type: "line", a: [0, 20], b: [120, 20] });
    // šrafa: oblast nad úsečkou y = 20 bez rohů a dvou děr Ø12
    const h = m.entities.find((e) => e.type === "hatch") as DHatch;
    expect(h.layer).toBe("ŠRAFY");
    const area = all.find((r) => r.cmd === "HATCH")!.data!.area as number;
    close(area, 120 * 60 - 2 * (100 - 25 * Math.PI) - 2 * Math.PI * 36, 1e-6);
    // kóty ISO-25 (desetinná čárka, bez koncových nul)
    const dims = m.entities.filter((e) => e.type === "dimension") as DDimension[];
    const val = dims.map((d) => [d.kind, Math.round(dimGeom(d, { model: m }).measured * 1e9) / 1e9]);
    expect(val).toEqual([["linear", 30], ["linear", 90], ["linear", 120], ["linear", 40], ["linear", 40], ["diameter", 12], ["radius", 10]]);
    expect(dims.every((d) => d.style === "ISO-25" && d.layer === "KÓTY")).toBe(true);
    expect(m.entities.some((e) => e.type === "mtext")).toBe(true);
    expect(m.entities.some((e) => e.type === "tolerance")).toBe(true);
    // razítko: blok se dvěma atributy, vložený do rozvržení s hodnotami
    const blk = m.blocks!.find((b) => b.name === "RAZITKO")!;
    expect(blk.entities.filter((e) => e.type === "attdef")).toHaveLength(2);
    const lay = m.layouts!.find((l) => l.name === "Výroba")!;
    const ins = lay.entities.find((e) => e.type === "insert" && (e as DInsert).block === "RAZITKO") as DInsert;
    expect(Object.fromEntries(ins.attribs!.map((a) => [a.tag, a.value]))).toEqual({ CISLO: "V-001", NAZEV: "Deska 120×80" });
    const vps = lay.entities.filter((e) => e.type === "viewport") as DViewport[];
    expect(vps.map((v) => v.scale)).toEqual([1, 2]);
    // PDF: úsečka 100 mm modelu = 100 mm na papíře (1:1) a 200 mm (2:1)
    const file = all.find((r) => r.cmd === "PLOT")!.data!.file as { base64: string; name: string };
    expect(file.name).toBe("Deska.pdf");
    const pdf = Uint8Array.from(Buffer.from(file.base64, "base64"));
    const segs = pdfSegments(pdf);
    const len = (s: number[]) => Math.hypot(s[2] - s[0], s[3] - s[1]);
    const at = (vp: DViewport, x: number, y: number) => [vp.c[0] + (x - vp.viewCenter[0]) * vp.scale, vp.c[1] + (y - vp.viewCenter[1]) * vp.scale];
    for (const vp of vps) {
      const a = at(vp, 0, -30);
      const b = at(vp, 100, -30);
      const hit = segs.find((s) => Math.abs(s[0] - a[0]) < 1e-3 && Math.abs(s[1] - a[1]) < 1e-3 && Math.abs(s[2] - b[0]) < 1e-3 && Math.abs(s[3] - b[1]) < 1e-3);
      expect(hit, `úsečka ve výřezu ${vp.scale}:1`).toBeTruthy();
      close(len(hit!), 100 * vp.scale, 1e-6);
    }
    // DWG a DXF tam a zpět: stejné počty entit (model, rozvržení, bloky)
    const sig = (x: DraftModel) => ({
      model: x.entities.length,
      byType: Object.entries(x.entities.reduce<Record<string, number>>((o, e) => ((o[e.type] = (o[e.type] ?? 0) + 1), o), {})).sort(),
      layouts: (x.layouts ?? []).map((l) => [l.name, l.entities.length]),
      blocks: (x.blocks ?? []).filter((b) => !/^\*/.test(b.name)).map((b) => [b.name, b.entities.length]),
      layers: x.layers.map((l) => l.name).sort(),
    });
    for (const fmt of ["dwg", "dxf"] as const) {
      const f = await draftExport(m, fmt, { version: "R2013" });
      const back = (await draftImport(`Deska.${fmt}`, f.data)).model;
      expect(sig(back), fmt).toEqual(sig(m));
      const bd = back.entities.filter((e) => e.type === "dimension") as DDimension[];
      expect(bd.map((d) => Math.round(dimGeom(d, { model: back }).measured * 1e9) / 1e9), fmt).toEqual(val.map((v) => v[1]));
    }
  }, 120000);
});

describe("integrace 2D: mezibalíkové případy", () => {
  it("kóta uvnitř bloku: vložení v měřítku 2 kreslí kótu 2×, rozložení vrátí kótu, DXF / DWG zpět s blokem", async () => {
    setLang("cs");
    const { all, m } = await runAll(`2d nový B mm
2d čára 0,0 100,0; kóta-lineární 0,0 100,0 50,-10
2d blok DÍL 0,0 e1 e2 smazat
2d vložit DÍL 0,0 2 2 0`);
    for (const r of all) expect(r.error, r.input).toBeUndefined();
    const blk = m.blocks!.find((b) => b.name === "DÍL")!;
    expect(blk.entities.map((e) => e.type)).toEqual(["line", "dimension"]);
    const ins = m.entities.find((e) => e.type === "insert")!;
    expect(kindOf(ins)!.bbox(ins, { model: m })!.x1).toBeCloseTo(200, 6);
    const parts = kindOf(ins)!.explode!(ins, { model: m })!;
    const pd = parts.find((p) => p.type === "dimension") as unknown as DDimension;
    expect(pd).toBeTruthy();
    close(dimGeom({ ...pd, id: "x", layer: "0" } as DDimension, { model: m }).measured, 200, 1e-9);
    for (const fmt of ["dxf", "dwg"] as const) {
      const back = (await draftImport(`b.${fmt}`, (await draftExport(m, fmt)).data)).model;
      const b2 = back.blocks!.find((b) => b.name === "DÍL")!;
      expect(b2.entities.map((e) => e.type), fmt).toEqual(["line", "dimension"]);
      close(dimGeom(b2.entities[1] as DDimension, { model: back }).measured, 100, 1e-9);
    }
  });

  it("šrafa v rozvržení (papírový prostor) se vykreslí i vytiskne jako výplň", async () => {
    setLang("cs");
    setPdfFont(new Uint8Array(readFileSync("public/fonts/Roboto-Regular.ttf")));
    const { all, m } = await runAll(`2d nový Š mm
2d rozvržení nové L A4 bez-výřezu bez-razítka bez-rámečku
2d obdélník 20,20 @40,30; šrafa plná 40,35
2d tisk název S`);
    for (const r of all) expect(r.error, r.input).toBeUndefined();
    const lay = m.layouts![0];
    const h = lay.entities.find((e) => e.type === "hatch") as DHatch;
    expect(h && h.solid).toBe(true);
    const pdf = Uint8Array.from(Buffer.from((all.at(-1)!.data!.file as { base64: string }).base64, "base64"));
    const txt = Buffer.from(pdf).toString("latin1");
    const streams = [...txt.matchAll(/stream\r?\n([^]*?)\r?\nendstream/g)].map((x) => {
      try {
        return inflateSync(Buffer.from(x[1], "latin1")).toString("latin1");
      } catch {
        return x[1];
      }
    });
    expect(streams.some((s) => /20 20 m\n60 20 l\n60 50 l\n20 50 l\n(20 20 l\n)?(h\n)?f\*/.test(s))).toBe(true);
  });

  it("anotativní kóta ve výřezu 1:2 má velikost na papíře (seznam výřezu = kopie s měřítkem 2)", async () => {
    setLang("cs");
    const { all, m } = await runAll(`2d nový A mm
2d kótovací-styl nový ANNO z ISO-25 dimanno 1; kótovací-styl aktuální ANNO
2d kóta-lineární 0,0 100,0 50,-10
2d rozvržení nové L A4 bez-výřezu bez-razítka bez-rámečku
2d výřez 10,10 200,140 1:2`);
    for (const r of all) expect(r.error, r.input).toBeUndefined();
    const vp = m.layouts![0].entities.find((e) => e.type === "viewport") as DViewport;
    const list = vpDrawList(m, vp);
    const d = list.find((e) => e.type === "dimension") as DraftEntity & { __anno?: number };
    expect(d.__anno).toBe(2);
    expect(annoScaledList(m.entities, 2, m)).toBe(list); // stabilní identita (mezipaměti)
    // text kóty na papíře 2,5 mm: ve výkrese 5 mm (× 2), přes výřez 1:2 zpět 2,5 mm
    const g = dimGeom(d as unknown as DDimension, { model: m });
    const th = (g as unknown as { textH?: number }).textH;
    if (th !== undefined) close(th, 5, 1e-9);
  });

  it("úchopy kóty: přesun definičního bodu přepočítá hodnotu (asociativně na body)", () => {
    setLang("cs");
    const m0 = newDraftModel({ units: "mm" });
    const m = runScript(m0, sessionFor(m0), "kóta-lineární 0,0 100,0 50,-10").model;
    const d = m.entities[0] as DDimension;
    const k = kindOf(d)!;
    const grips = k.grips(d, { model: m });
    const gi = grips.findIndex((p) => Math.abs(p[0] - 100) < 1e-9 && Math.abs(p[1]) < 1e-9);
    expect(gi).toBeGreaterThanOrEqual(0);
    const d2 = k.moveGrip!(d, gi, [150, 0], { model: m }) as DDimension;
    close(dimGeom(d2, { model: m }).measured, 150, 1e-12);
  });

  it("PEDIT Spline: rám křivky přežije DXF i DWG a Vyrovnat po znovuotevření vrátí původní vrcholy", async () => {
    setLang("cs");
    const m0 = newDraftModel({ units: "mm" });
    const m = runScript(m0, sessionFor(m0), "křivka 0,0 50,0 50,50 100,50; upravit-křivku e1 spline").model;
    expect((m.entities[0].ext as { pedit?: unknown }).pedit).toBeTruthy();
    for (const fmt of ["dxf", "dwg"] as const) {
      const back = (await draftImport(`p.${fmt}`, (await draftExport(m, fmt)).data)).model;
      expect((back.entities[0].ext as { pedit?: unknown }).pedit, fmt).toEqual((m.entities[0].ext as { pedit?: unknown }).pedit);
      const r = runScript(back, sessionFor(back), "upravit-křivku e1 vyrovnat");
      expect(r.results[0].error, fmt).toBeUndefined();
      expect((r.model.entities[0] as unknown as { type: string; pts: number[][] }).pts, fmt).toEqual([[0, 0], [50, 0], [50, 50], [100, 50]]);
    }
  });

  it("MTEXT s formátováním a odstavci projde DWG R2000 i R2018 beze změny", async () => {
    setLang("cs");
    const m0 = newDraftModel({ units: "mm" });
    const m = runScript(m0, sessionFor(m0), 'mtext 0,0 @80,-20 "{\\fArial|b1;Tučně}\\PDruhý řádek ø10 H7"').model;
    const s = (m.entities[0] as unknown as { s: string }).s;
    for (const v of ["R2000", "R2018"] as const) {
      const back = (await draftImport("t.dwg", (await draftExport(m, "dwg", { version: v })).data)).model;
      expect((back.entities[0] as unknown as { s: string }).s, v).toBe(s);
    }
  });

  it("io: měřítko poznámek, DIMANNO, anotativní příznak, směr osy souřadnicové kóty a poloha textu odkazu přežijí DXF i DWG", async () => {
    setLang("cs");
    const m0 = newDraftModel({ units: "mm" });
    const m = runScript(m0, sessionFor(m0), ["kótovací-styl nový Anno z ISO-25 dimanno 1", "kótovací-styl měřítko-poznámek 1:50", "kóta-souřadnicová 50,20 50,60", "otočit poslední 0,0 30", 'odkaz 10,10 30,25 "Sražení 1×45°"', "proměnná psltscale 0"].join("\n")).model;
    const src = m.entities.map((e) => ({ ...e }));
    for (const fmt of ["dxf", "dwg"] as const) {
      const back = (await draftImport(`t.${fmt}`, (await draftExport(m, fmt)).data)).model;
      expect(back.vars.cannoscale, fmt).toBeCloseTo(0.02, 12);
      expect(back.vars.psltscale, fmt).toBe(0);
      expect(back.dimStyles!.find((s) => s.name === "Anno")!.dimanno, fmt).toBe(true);
      const od = back.entities.find((e) => e.type === "dimension") as DDimension;
      close(od.hdir!, (src.find((e) => e.type === "dimension") as unknown as DDimension).hdir!, 1e-9);
      expect(od.annotative, fmt).toBe(true);
      const L = back.entities.find((e) => e.type === "leader") as unknown as { textPos?: unknown; textH: number; annotative: boolean };
      expect(L.textPos, fmt).toBeUndefined();
      expect(L.textH, fmt).toBe(2.5);
      expect(L.annotative, fmt).toBe(true);
    }
  });
});

describe("integrace 2D: podklad DWG bez kót", () => {
  it("metrický výkres bez kót → DWG / DXF → nová kóta má styl ISO-25 (text 2,5 mm), ne palcový Standard knihovny", async () => {
    setLang("cs");
    const m0 = newDraftModel({ units: "mm" });
    const m = runScript(m0, sessionFor(m0), "čára 0,0 100,0").model;
    expect(m.dimStyles?.length ?? 0).toBe(0);
    for (const fmt of ["dwg", "dxf"] as const) {
      const back = (await draftImport(`p.${fmt}`, (await draftExport(m, fmt)).data)).model;
      expect(back.vars.dimstyle, fmt).toBe("ISO-25");
      const r = runScript(back, sessionFor(back), "kóta-lineární 0,0 100,0 50,-10");
      expect(r.results[0].error, fmt).toBeUndefined();
      const d = r.model.entities.find((e) => e.type === "dimension") as DDimension;
      expect(d.style, fmt).toBe("ISO-25");
      const g = dimGeom(d, { model: r.model }) as unknown as { measured: number; textH?: number };
      close(g.measured, 100, 1e-12);
      const st = r.model.dimStyles!.find((s) => s.name === "ISO-25")!;
      expect(st.dimtxt, fmt).toBe(2.5);
    }
  });
});

describe("integrace 2D: požadavky balíků na jádro", () => {
  it("DXF: každý blok má svůj bod vložení (acad-ts sdílel jeden objekt)", async () => {
    setLang("cs");
    const { all, m } = await runAll(`2d nový Body mm
2d čára 0,0 10,0; blok A 0,0 poslední smazat
2d čára 50,50 60,50; blok B 50,50 poslední smazat
2d vložit A 100,0; vložit B 200,0`);
    for (const r of all) expect(r.error, r.input).toBeUndefined();
    for (const fmt of ["dxf", "dwg"] as const) {
      const back = (await draftImport(`b.${fmt}`, (await draftExport(m, fmt)).data)).model;
      expect(back.blocks!.find((b) => b.name === "A")!.base, fmt).toEqual([0, 0]);
      expect(back.blocks!.find((b) => b.name === "B")!.base, fmt).toEqual([50, 50]);
    }
  });

  it("SMAZAT po „vyber vše“ přeskočí zamčenou hladinu; „alle“ (DE) vybere vše", () => {
    setLang("cs");
    const m0 = newDraftModel({ units: "mm" });
    let m = runScript(m0, sessionFor(m0), "čára 0,0 10,0; hladina nová Z; hladina aktuální Z; čára 0,5 10,5; hladina aktuální 0; hladina Z zamknout").model;
    const s = sessionFor(m);
    m = runScript(m, s, "vyber alle").model;
    expect(s.sel).toHaveLength(2);
    const r = runCommandLine(m, s, "smazat");
    expect(r.result.ok).toBe(true);
    expect(r.model.entities.map((e) => e.layer)).toEqual(["Z"]);
  });

  it("zkratky voleb AutoCADu: TRIM T / O / R / E, CHAMFER E / M; výchozí volba se ukazuje názvem", () => {
    setLang("en");
    const TRIM = findCommand("TRIM")!;
    expect(TRIM).toBeTruthy();
    const list = [kw("cuttingedges", "Řezné-hrany", "Cutting-edges", "Schnittkanten", ["t"]), kw("mode", "Režim", "Mode", "Modus", ["o"]), kw("edge", "Hrana", "Edge", "Kante", ["e"]), kw("erase", "Smazat", "Erase", "Löschen", ["r"])];
    expect(matchKw("t", list)?.id).toBe("cuttingedges");
    expect(matchKw("o", list)?.id).toBe("mode");
    expect(matchKw("e", list)?.id).toBe("edge");
    expect(matchKw("r", list)?.id).toBe("erase");
    expect(matchKw("era", list)?.id).toBe("erase");
    // skutečné příkazy: CHAMFER M = Vícekrát, E = Metoda; TRIM T = řezné hrany
    const m0 = newDraftModel({ units: "mm" });
    const m = runScript(m0, sessionFor(m0), "line 0,0 100,0; line 100,0 100,50; line -10,20 110,20").model;
    const t = runCommandLine(m, sessionFor(m), 'trim t e2 "" e3@105,20');
    expect(t.result.error).toBeUndefined();
    expect((t.model.entities[2] as unknown as { b: number[] }).b[0]).toBeCloseTo(100, 9);
    for (const t of ["chamfer e distance distance 2 2 e1@50,0 e2@100,25", "chamfer m distance 2 2 e1@50,0 e2@100,25"]) {
      const ch = runCommandLine(m, sessionFor(m), t);
      expect(ch.result.error, t).toBeUndefined();
      expect(ch.result.created, t).toHaveLength(1);
    }
    const p = { k: "kw" as const, msg: "Continue?", kw: [kw("yes", "Ano", "Yes", "Ja"), kw("no", "Ne", "No", "Nein")], def: "no" };
    expect(promptDefault(p)).toBe("No");
    expect(promptText(p)).toBe("Continue? [Yes/No] <No>:");
    setLang("cs");
  });

  it("neúspěšný příkaz vrací i protokol; PSLTSCALE textem; DraftTx.restore vrátí smazanou entitu na místo", () => {
    setLang("cs");
    const m0 = newDraftModel({ units: "mm" });
    const m = runScript(m0, sessionFor(m0), "čára 0,0 10,0; čára 0,5 10,5; čára 0,9 10,9").model;
    const bad = runCommandLine(m, sessionFor(m), "kružnice 0,0 abc");
    expect(bad.result.ok).toBe(false);
    expect(Array.isArray(bad.result.log)).toBe(true);
    const ps = runCommandLine(m, sessionFor(m), "proměnná psltscale 0");
    expect(ps.result.error).toBeUndefined();
    expect(ps.model.vars.psltscale).toBe(0);
    const tx = new DraftTx(m);
    const e2 = tx.get("e2")!;
    tx.remove("e2");
    expect(tx.deleted).toEqual(["e2"]);
    expect(tx.restore(e2, 1)).toBe(true);
    expect(tx.entities.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(tx.deleted).toEqual([]);
    expect(tx.changed).toEqual([]);
    expect(tx.model.entities[1]).toBe(e2);
  });
});
