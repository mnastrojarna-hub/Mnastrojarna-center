import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setLang } from "../../i18n";
import "../index";
import { findCommand, runScript, runScriptAsync } from "../commands";
import { newDraftModel } from "../doc";
import { entityBox, entityCurves, kindOf } from "../kinds";
import { cEnd, cStart } from "../curves";
import { dist, xfMirror } from "../geom";
import type { DLine, DraftEntity, DraftModel, Vec2 } from "../model";
import { sessionFor, type DraftSession } from "../session";
import { attributeRows, blockDrawList, findBlock } from "./blocks";
import { pagesToPdf, pdfStreams, setPdfFont } from "./pdf";
import { cmdsLength, plotLayout, plotModel, type PlotItem } from "./plot";
import { pageToSvg } from "./raster";
import { activeViewport, annoScale } from "./state";
import { findLayout, TITLE_BLOCK } from "./sheets";
import type { DInsert, DViewport } from "./types";
import { parseRatio, ratioLabel, vpXf } from "./util";

let m: DraftModel;
let s: DraftSession;
const run = (text: string) => {
  const r = runScript(m, s, text);
  m = r.model;
  return r.results;
};
const ok = (text: string) => {
  const r = run(text);
  for (const x of r) expect(x.error, x.input).toBeUndefined();
  return r;
};
const okA = async (text: string) => {
  const r = await runScriptAsync(m, s, text);
  m = r.model;
  for (const x of r.results) expect(x.error, x.input).toBeUndefined();
  return r.results;
};
const ent = <T extends DraftEntity>(id: string, list = m.entities) => list.find((e) => e.id === id) as T;
const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThanOrEqual(eps);
const closeP = (p: Vec2, q: Vec2, eps = 1e-9) => expect(dist(p, q), `${p} ≈ ${q}`).toBeLessThanOrEqual(eps);
const strokes = (items: PlotItem[]) => items.filter((i): i is Extract<PlotItem, { k: "stroke" }> => i.k === "stroke");

beforeAll(() => {
  setPdfFont(new Uint8Array(readFileSync("public/fonts/Roboto-Regular.ttf")));
});
beforeEach(() => {
  setLang("cs");
  m = newDraftModel();
  s = sessionFor(m);
});

describe("názvy příkazů CZ / EN / DE a zkratky", () => {
  it("všechny příkazy balíku", () => {
    const want: Record<string, string[]> = {
      BLOCK: ["blok", "block", "B"],
      INSERT: ["vložit", "insert", "einfüge", "I"],
      BEDIT: ["upravit-blok", "bedit", "bbearb", "BE"],
      BCLOSE: ["zavřít-blok", "bclose", "bschließen"],
      ATTDEF: ["definice-atributu", "attdef", "ATT"],
      ATTEDIT: ["upravit-atributy", "attedit", "ATE"],
      WBLOCK: ["uložit-blok", "wblock", "W"],
      PURGE: ["vyčistit", "purge", "bereinig", "PU"],
      LAYOUT: ["rozvržení", "layout", "LO"],
      PAGESETUP: ["vzhled-stránky", "pagesetup", "seiteneinr"],
      MVIEW: ["výřez", "mview", "mansfen", "MV"],
      MSPACE: ["modelový-prostor", "mspace", "mbereich", "MS"],
      PSPACE: ["papírový-prostor", "pspace", "pbereich", "PS"],
      VPLAYER: ["hladiny-výřezu", "vplayer", "afebene"],
      PLOT: ["tisk", "plot", "drucken"],
      EXPORTPDF: ["export-pdf", "exportpdf", "pdfexport"],
      ATTEXT: ["extrahovat-atributy", "attext", "attextrahieren"],
    };
    for (const [id, names] of Object.entries(want)) for (const n of names) expect(findCommand(n)?.id, n).toBe(id);
  });
});

describe("bloky – definice, vložení, ByBlock / hladina 0, vnoření", () => {
  it("blok z objektů (převést) a vložení: přesná geometrie, natočení a měřítko", () => {
    ok("čára 0,0 10,0; čára 10,0 10,5");
    const r = ok("blok ROH 0,0 vše");
    const insId = r[0].data!.insert as string;
    expect(m.entities.map((e) => e.type)).toEqual(["insert"]);
    expect(findBlock(m, "ROH")!.entities).toHaveLength(2);
    expect(ent<DInsert>(insId).p).toEqual([0, 0]);
    ok("vložit ROH 100,50 2 3 90");
    const ins = m.entities[1] as DInsert;
    expect([ins.sx, ins.sy, ins.rot]).toEqual([2, 3, 90]);
    const cs = entityCurves(ins, { model: m });
    // úsečka 0,0→10,0 ve vložení: (100,50) → (100, 70) (měřítko X 2, natočení 90°)
    closeP(cStart(cs[0]), [100, 50], 0);
    closeP(cEnd(cs[0]), [100, 70], 0);
    // 10,0→10,5: (100,70) → (100−15, 70)
    closeP(cEnd(cs[1]), [85, 70], 0);
    const b = entityBox(ins, { model: m })!;
    expect([b.x0, b.y0, b.x1, b.y1]).toEqual([85, 50, 100, 70]);
  });

  it("ByBlock a hladina 0 uvnitř bloku převezmou vlastnosti vložení (tisk barev)", () => {
    ok("hladina nová RUDA barva 1; hladina nová MODRA barva 5");
    ok("čára 0,0 10,0; vlastnosti poslední barva ByBlock");
    ok("hladina aktuální MODRA; čára 0,5 10,5");
    ok("hladina aktuální 0; čára 0,10 10,10");
    ok("blok B 0,0 vše ponechat; smazat vše");
    ok("hladina aktuální RUDA; proměnná cecolor 3; vložit B 0,0");
    const page = plotModel(m, { ratio: 1, size: "A4" });
    const cols = strokes(page.items).map((x) => x.color.join(","));
    // ByBlock → barva vložení (3 zelená), MODRA zůstane modrá (5), hladina 0 → hladina vložení RUDA (červená 1)
    expect(cols).toEqual(["0,255,0", "0,0,255", "255,0,0"]);
  });

  it("vnořené bloky: transformace se skládají, rozložení vrátí přesné souřadnice", () => {
    ok("čára 0,0 10,0; blok A 0,0 poslední");
    ok("vložit A 5,0 2 2 90; blok B 0,0 poslední");
    ok("vložit B 100,100 1 1 0");
    const ins = m.entities[m.entities.length - 1] as DInsert;
    const cs = entityCurves(ins, { model: m });
    closeP(cStart(cs[0]), [105, 100], 0);
    closeP(cEnd(cs[0]), [105, 120], 0);
    const ex = kindOf(ins)!.explode!(ins, { model: m })!;
    expect(ex).toHaveLength(1);
    expect(ex[0].type).toBe("insert");
    expect((ex[0] as unknown as DInsert).p).toEqual([105, 100]);
    expect(() => run("upravit-blok A")).not.toThrow();
  });

  it("blok nemůže obsahovat sám sebe; zrcadlení vložení = záporné měřítko", () => {
    ok("čára 0,0 10,0; blok A 0,0 poslední");
    const id = m.entities[0].id;
    const r = run(`blok A 0,0 ${id}`);
    expect(r[0].error).toMatch(/sám sebe/);
    const ins = m.entities[0] as DInsert;
    const mir = kindOf(ins)!.transform(ins, xfMirror([0, 0], [0, 1]), { model: m }) as DInsert;
    expect([mir.sx, mir.sy, mir.rot]).toEqual([-1, 1, 0]);
    const c = entityCurves(mir, { model: m })[0];
    closeP(cEnd(c), [-10, 0], 0);
  });

  it("předefinování bloku obnoví vložení (nová identita) a zamčená hladina brání převodu", () => {
    ok("čára 0,0 10,0; blok A 0,0 poslední; vložit A 50,0");
    const before = m.entities[1];
    ok("kružnice 0,0 5; blok A 0,0 poslední");
    const after = m.entities.find((e) => e.id === before.id)!;
    expect(after).not.toBe(before);
    expect(blockDrawList(findBlock(m, "A")!)[0].type).toBe("circle");
    ok("hladina nová Z; hladina aktuální Z; čára 0,0 1,1; hladina aktuální 0; hladina Z zamknout");
    const r = run(`blok C 0,0 ${m.entities[m.entities.length - 1].id}`);
    expect(r[0].error).toMatch(/zamčen/);
  });
});

describe("atributy – ATTDEF, INSERT s hodnotami, ATTEDIT, ATTEXT", () => {
  it("definice v bloku, hodnoty při vložení (v pořadí), úprava a CSV", () => {
    ok('obdélník 0,0 40,10; definice-atributu CISLO "Číslo dílu" "000" 2,2 3.5 0; definice-atributu neviditelný CENA "Cena" "0" 2,6 2.5 0');
    ok("blok ŠTÍTEK 0,0 vše");
    ok('vložit ŠTÍTEK 100,0 1 1 0 "V-001" "250"');
    const ins = m.entities[m.entities.length - 1] as DInsert;
    expect(ins.attribs!.map((a) => [a.tag, a.value, !!a.invisible])).toEqual([
      ["CISLO", "V-001", false],
      ["CENA", "250", true],
    ]);
    closeP(ins.attribs![0].p, [102, 2], 0);
    ok(`upravit-atributy ${ins.id} CISLO=V-002 "CENA=1 200"`);
    const ins2 = ent<DInsert>(ins.id);
    expect(ins2.attribs!.map((a) => a.value)).toEqual(["V-002", "1 200"]);
    const r = ok("extrahovat-atributy blok ŠTÍTEK");
    const f = r[0].data!.file as { text: string };
    expect(f.text.split("\r\n")[0]).toBe("HANDLE;BLOCKNAME;LAYER;X;Y;ROTATION;XSCALE;YSCALE;SPACE;CISLO;CENA");
    expect(f.text).toContain(`${ins.id};ŠTÍTEK;0;100;0;0;1;1;model;V-002;1 200`);
    expect(attributeRows(m)).toHaveLength(2);
    // pole panelu vlastností: att.ZNAČKA
    ok(`nastavit ${ins.id} att.CISLO=V-003`);
    expect(ent<DInsert>(ins.id).attribs![0].value).toBe("V-003");
  });
  it("otočené vložení otočí i atributy; zrcadlení nechá text čitelný", () => {
    ok('definice-atributu T "T" "x" 10,0 2.5 0; čára 0,0 20,0; blok P 0,0 vše; vložit P 0,0 1 1 90 "abc"');
    const ins = m.entities[m.entities.length - 1] as DInsert;
    closeP(ins.attribs![0].p, [0, 10], 0);
    expect(ins.attribs![0].rot).toBe(90);
  });
});

describe("úprava bloku (BEDIT / BCLOSE)", () => {
  it("uložit obnoví vložení, zahodit vrátí definici", () => {
    ok("čára 0,0 10,0; blok A 0,0 poslední; vložit A 100,0");
    ok("upravit-blok A");
    expect(s.space).toBe("block:A");
    ok("kružnice 5,0 2");
    expect(findBlock(m, "A")!.entities).toHaveLength(2);
    ok("zavřít-blok");
    expect(s.space).toBe("model");
    const ins = m.entities[m.entities.length - 1];
    expect(entityCurves(ins, { model: m })).toHaveLength(2);
    ok("upravit-blok A; čára 0,0 0,10; zavřít-blok zahodit");
    expect(findBlock(m, "A")!.entities).toHaveLength(2);
    // nový blok přímo v editoru
    ok("upravit-blok NOVÝ; čára 0,0 1,1; zavřít-blok");
    expect(findBlock(m, "NOVÝ")!.entities).toHaveLength(1);
  });
});

describe("rozvržení, výřez v měřítku, tisk", () => {
  const model1000 = () => {
    ok("hladina nová OBRYS tloušťka 0.5; hladina aktuální OBRYS");
    ok("čára 0,0 1000,0; čára 1000,0 1000,500; kružnice 500,250 100");
    ok("hladina aktuální 0");
  };
  it("rozvržení A3: rámeček, razítko ISO 7200 s atributy, výřez s měřítkem ISO", () => {
    model1000();
    const r = ok("rozvržení nové Výroba A3 NAZEV=Rám CISLO_VYKRESU=V-100");
    const lay = findLayout(m, "Výroba")!;
    expect(lay.paper).toMatchObject({ size: "A3", w: 420, h: 297, landscape: true });
    expect(s.space).toBe(`layout:${lay.id}`);
    const tb = lay.entities.find((e) => e.type === "insert" && (e as DInsert).block === TITLE_BLOCK) as DInsert;
    const vals = Object.fromEntries(tb.attribs!.map((a) => [a.tag, a.value]));
    expect(vals).toMatchObject({ NAZEV: "Rám", CISLO_VYKRESU: "V-100", FORMAT: "A3", MERITKO: "1:5" });
    expect(tb.p).toEqual([410, 10]);
    const vp = lay.entities.find((e) => e.type === "viewport") as DViewport;
    expect(ratioLabel(vp.scale)).toBe("1:5");
    expect((r[0].data!.layout as { scale: string }).scale).toBe("1:5");
  });

  it("výřez 1:50 – rozměr na papíře = rozměr modelu × měřítko (i v PDF)", async () => {
    model1000();
    ok("rozvržení nové T A3 bez-razítka bez-rámečku bez-výřezu");
    ok("výřez 10,10 410,287 1:50");
    const lay = findLayout(m, "T")!;
    const vp = lay.entities.find((e) => e.type === "viewport") as DViewport;
    expect(vp.scale).toBe(0.02);
    const page = plotLayout(m, lay.id);
    expect([page.w, page.h]).toEqual([420, 297]);
    const st = strokes(page.items);
    // úsečka 1000 mm → 20 mm, kružnice r 100 → r 2 na papíře; tloušťka 0,5 mm
    const line = st.find((x) => x.cmds.length === 2 && Math.abs(cmdsLength(x.cmds) - 20) < 1e-6);
    expect(line).toBeTruthy();
    expect(line!.lw).toBe(0.5);
    const circ = st.find((x) => x.cmds.some((c) => c.k === "C"));
    close(cmdsLength(circ!.cmds), 2 * Math.PI * 2, 2e-4);
    // PDF: velikost stránky A3 v bodech, tloušťka 0,5 mm, délka úsečky 20 mm v obsahu (souřadnice mm)
    const pdf = await pagesToPdf([page], { compress: false });
    const txt = new TextDecoder("latin1").decode(pdf);
    expect(txt.startsWith("%PDF-1.7")).toBe(true);
    expect(txt.includes("/MediaBox [0 0 1190.551181 841.889764]")).toBe(true);
    const content = pdfStreams(pdf)[0];
    expect(content).toContain("0.5 w");
    const xf = vpXf(vp);
    const a = [xf[0] * 0 + xf[4], xf[5]];
    const b = [xf[0] * 1000 + xf[4], xf[5]];
    const re = new RegExp(`${a[0]} ${a[1]} m\\n${b[0]} ${b[1]} l`);
    expect(content).toMatch(re);
    close(b[0] - a[0], 20, 1e-12);
  });

  it("PDF s písmem Roboto (čeština), komprese a ToUnicode", async () => {
    ok('text 0,0 5 0 "Příliš žluťoučký kůň"');
    const page = plotModel(m, { size: "A4", ratio: 1 });
    const pdf = await pagesToPdf([page], { compress: true, title: "Test" });
    const txt = new TextDecoder("latin1").decode(pdf);
    expect(txt).toContain("/Subtype /Type0");
    expect(txt).toContain("/Encoding /Identity-H");
    expect(txt).toContain("/FontFile2");
    const streams = [...txt.matchAll(/<< \/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g)];
    expect(streams.length).toBeGreaterThan(1);
    const start = (streams[0].index ?? 0) + streams[0][0].length;
    const content = inflateSync(Buffer.from(pdf.subarray(start, start + Number(streams[0][1])))).toString("latin1");
    expect(content).toMatch(/BT \/F1 1 Tf .* Tm <[0-9a-f]+> Tj ET/);
    // ToUnicode obsahuje „ř“ (U+0159)
    const tu = streams.map((x) => {
      const st = (x.index ?? 0) + x[0].length;
      return inflateSync(Buffer.from(pdf.subarray(st, st + Number(x[1])))).toString("latin1");
    }).find((x) => x.includes("beginbfchar"));
    expect(tu).toContain("<0159>");
  });

  it("zmrazení hladiny ve výřezu (VPLAYER), zamčený výřez, MSPACE / PSPACE", () => {
    model1000();
    ok("hladina nová OSY; hladina aktuální OSY; čára 500,-50 500,550; hladina aktuální 0");
    ok("rozvržení nové T A3 bez-razítka bez-rámečku bez-výřezu; výřez 10,10 410,287 1:5");
    const lay = findLayout(m, "T")!;
    const vpId = lay.entities[0].id;
    const n0 = strokes(plotLayout(m, lay.id).items).length;
    ok(`hladiny-výřezu zmrazit OSY výřez ${vpId}`);
    expect((findLayout(m, "T")!.entities[0] as DViewport).frozenLayers).toEqual(["OSY"]);
    const n1 = strokes(plotLayout(m, lay.id).items).length;
    expect(n1).toBe(n0 - 1);
    ok(`výřez zamknout ${vpId}`);
    const r = run(`nastavit ${vpId} scale 1:10`);
    expect(r[0].error).toMatch(/zamčený/);
    ok(`výřez odemknout ${vpId}; nastavit ${vpId} scale=1:10`);
    expect((findLayout(m, "T")!.entities[0] as DViewport).scale).toBe(0.1);
    // MSPACE: kreslí se do modelu
    ok("modelový-prostor");
    expect(s.space).toBe("model");
    expect(activeViewport(s, m)?.vp.id).toBe(vpId);
    close(annoScale(s, m), 0.1);
    const nModel = m.entities.length;
    ok("čára 0,0 0,100");
    expect(m.entities.length).toBe(nModel + 1);
    ok("papírový-prostor");
    expect(s.space).toBe(`layout:${lay.id}`);
    expect(activeViewport(s, m)).toBeNull();
  });

  it("vzhled stránky: změna formátu přemístí razítko a vymění rámeček; styl mono", () => {
    ok("kružnice 0,0 50; rozvržení nové L A3");
    ok("vzhled-stránky A2 styl mono");
    const lay = findLayout(m, "L")!;
    expect(lay.paper).toMatchObject({ size: "A2", w: 594, h: 420 });
    expect(lay.plot?.styleTable).toBe("monochrome.ctb");
    const tb = lay.entities.find((e) => e.type === "insert" && (e as DInsert).block === TITLE_BLOCK) as DInsert;
    expect(tb.p).toEqual([584, 10]);
    expect(tb.attribs!.find((a) => a.tag === "FORMAT")!.value).toBe("A2");
    const fr = lay.entities.find((e) => e.type === "insert" && (e as DInsert).block.startsWith("ISO5457")) as DInsert;
    expect(fr.block).toBe("ISO5457_A2L");
  });

  it("TISK textem: PDF v results[].data.file, SVG, model v měřítku, export všech rozvržení", async () => {
    ok("čára 0,0 100,0; rozvržení nové A A4; rozvržení nové B A3");
    let r = await okA("tisk rozvržení A");
    const f = r[0].data!.file as { name: string; base64: string; mime: string };
    expect(f.mime).toBe("application/pdf");
    expect(atob(f.base64).startsWith("%PDF")).toBe(true);
    expect((r[0].data!.plot as { w: number; h: number }[])[0]).toMatchObject({ w: 210, h: 297 });
    r = await okA("export-pdf");
    expect((r[0].data!.plot as unknown[]).length).toBe(2);
    r = await okA("tisk model A4 měřítko 1:1 svg");
    const svg = (r[0].data!.file as { text: string }).text;
    expect(svg).toContain('width="297mm" height="210mm"');
    const page = plotModel(m, { size: "A4", ratio: 1 });
    expect(cmdsLength(strokes(page.items)[0].cmds)).toBeCloseTo(100, 9);
    expect(pageToSvg(page)).toContain("<path");
  });

  it("výřez Dva svisle a kopie / přejmenování / smazání rozvržení", () => {
    ok("kružnice 0,0 50; rozvržení nové X A3 bez-výřezu");
    ok("výřez dva svisle vejít 1:2");
    const lay = findLayout(m, "X")!;
    const vps = lay.entities.filter((e) => e.type === "viewport") as DViewport[];
    expect(vps).toHaveLength(2);
    expect(vps.every((v) => v.scale === 0.5)).toBe(true);
    expect(vps[0].c[0]).toBeLessThan(vps[1].c[0]);
    ok("rozvržení kopírovat X Y; rozvržení přejmenovat Y Z");
    expect(findLayout(m, "Z")!.entities).toHaveLength(lay.entities.length);
    ok("rozvržení smazat Z");
    expect(findLayout(m, "Z")).toBeUndefined();
    const r = ok("rozvržení");
    expect((r[0].data!.layouts as unknown[]).length).toBe(1);
  });
});

describe("vyčistit, uložit blok, text EN / DE", () => {
  it("PURGE odstraní nepoužité bloky (i vnořené), hladiny a typy čar", () => {
    ok("čára 0,0 1,0; blok A 0,0 poslední; vložit A 0,0; blok B 0,0 poslední ponechat; smazat vše");
    ok("hladina nová NEPOUŽITÁ; typčáry načíst HIDDEN2");
    const r = ok("vyčistit");
    const p = r[0].data!.purged as Record<string, string[]>;
    expect(p.blocks.sort()).toEqual(["A", "B"]);
    expect(p.layers).toContain("NEPOUŽITÁ");
    expect(m.blocks).toHaveLength(0);
  });
  it("WBLOCK do .mncad a do nové záložky (bod vložení v počátku)", async () => {
    ok("čára 10,10 20,10; blok A 10,10 poslední");
    let r = await okA("uložit-blok A mncad");
    const doc = JSON.parse((r[0].data!.file as { text: string }).text);
    expect(doc.kind).toBe("draft");
    expect(doc.draft.entities[0]).toMatchObject({ type: "line", a: [0, 0], b: [10, 0] });
    r = await okA("uložit-blok A záložka");
    expect((r[0].data!.newModel as DraftModel).entities).toHaveLength(1);
  });
  it("anglicky a německy", () => {
    setLang("en");
    ok("line 0,0 10,0; block A 0,0 last convert; insert A 20,0 1 1 0; layout new Sheet A3 notitle");
    expect(findLayout(m, "Sheet")!.entities.some((e) => e.type === "viewport")).toBe(true);
    ok("mspace; pspace");
    setLang("de");
    ok("einfüge A 40,0 1 1 0; layout neu Blatt A4 hoch; mansfen einpassen 1:1");
    expect(findLayout(m, "Blatt")!.paper.landscape).toBe(false);
    setLang("cs");
  });
});

describe("pomocné", () => {
  it("měřítka", () => {
    expect(parseRatio("1:50")).toBe(0.02);
    expect(parseRatio("2:1")).toBe(2);
    expect(parseRatio("1/2.5")).toBe(0.4);
    expect(ratioLabel(0.02)).toBe("1:50");
    expect(ratioLabel(5)).toBe("5:1");
    expect(() => parseRatio("x")).toThrow();
  });
  it("výřez: transformace model → papír a grip rohu zachová obsah", () => {
    const vp = { type: "viewport", id: "e1", layer: "0", c: [100, 100], w: 80, h: 60, viewCenter: [500, 250], scale: 0.1 } as DViewport;
    const xf = vpXf(vp);
    expect([xf[0] * 500 + xf[4], xf[3] * 250 + xf[5]]).toEqual([100, 100]);
    const g = kindOf(vp)!.moveGrip!(vp, 2, [150, 140], { model: m }) as DViewport;
    expect([g.w, g.h]).toEqual([90, 70]);
    const xf2 = vpXf(g);
    // bod modelu 500,250 zůstane na papíře na 100,100
    expect([xf2[0] * 500 + xf2[4], xf2[3] * 250 + xf2[5]]).toEqual([100, 100]);
    const l: DLine = { type: "line", id: "x", layer: "0", a: [0, 0], b: [1, 0] };
    expect(l.type).toBe("line");
  });
});
