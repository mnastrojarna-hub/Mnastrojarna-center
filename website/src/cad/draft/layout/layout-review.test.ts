/**
 * BALÍK 3 (layout) – regresní testy z kontroly: hladina výřezu (jen rám), PSLTSCALE na obrazovce = tisk, okraje tisku,
 * atributy při nestejnoměrném měřítku, PURGE / BCLOSE při úpravě bloku, zamčené hladiny výřezů, MVIEW Střed / Vejít /
 * Objekt, vložení bloku do sebe, změna formátu s výchozím výřezem, WBLOCK (verze, nezapsané entity), CSV atributů,
 * klíče překladů a německá slova.
 */
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setLang, tr } from "../../i18n";
import "../index";
import { runScript, runScriptAsync } from "../commands";
import { newDraftModel } from "../doc";
import { entityPrims, kindOf, type Prim } from "../kinds";
import type { DraftEntity, DraftModel, Vec2 } from "../model";
import { sessionFor, type DraftSession } from "../session";
import { findBlock, rowsToCsv, attributeRows } from "./blocks";
import { blockWordPrompts, unq } from "./cmd-blocks";
import { layoutWordPrompts } from "./cmd-layout";
import { viewportContent } from "./kinds";
import { setPdfFont } from "./pdf";
import { plotLayout, type PlotItem } from "./plot";
import { layoutState } from "./state";
import { TITLE_BLOCK } from "./sheets";
import type { DAttrib, DInsert, DViewport } from "./types";

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
const runA = async (text: string) => {
  const r = await runScriptAsync(m, s, text);
  m = r.model;
  return r.results;
};
const lay = (i = 0) => (m.layouts ?? [])[i];
const vpOf = (i = 0) => lay(i).entities.find((e) => e.type === "viewport") as DViewport;
const strokes = (items: PlotItem[]) => items.filter((i): i is Extract<PlotItem, { k: "stroke" }> => i.k === "stroke");
const bbox = (it: Extract<PlotItem, { k: "stroke" }>) => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of it.cmds)
    if (c.k !== "Z")
      for (const p of c.k === "C" ? [c.c1, c.c2, c.p] : [c.p]) {
        x0 = Math.min(x0, p[0]);
        y0 = Math.min(y0, p[1]);
        x1 = Math.max(x1, p[0]);
        y1 = Math.max(y1, p[1]);
      }
  return [x0, y0, x1, y1].map((v) => Math.round(v * 1e6) / 1e6);
};
const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThanOrEqual(eps);
const closeP = (p: Vec2, q: Vec2, eps = 1e-9) => {
  close(p[0], q[0], eps);
  close(p[1], q[1], eps);
};
/** entity obsahu výřezu tak, jak je dostane renderer plátna (vnitřní entita → sub) */
const canvasContent = (vp: DViewport): DraftEntity[] => {
  const inner = (entityPrims(vp, { model: m }).find((p) => p.k === "sub") as Extract<Prim, { k: "sub" }>).entities[0];
  return (entityPrims(inner, { model: m })[0] as Extract<Prim, { k: "sub" }>).entities;
};

beforeAll(() => {
  setPdfFont(new Uint8Array(readFileSync("public/fonts/Roboto-Regular.ttf")));
});
beforeEach(() => {
  setLang("cs");
  m = newDraftModel();
  s = sessionFor(m);
});

describe("hladina výřezu řídí jen rám", () => {
  const setup = () => ok("hladina nová VP; hladina nová A; hladina aktuální A; čára 0,0 100,0; hladina aktuální VP; rozvržení nové L1 A4 bez-razítka bez-rámečku měřítko 1:1; hladina aktuální 0");
  it("vypnutá i zmrazená hladina výřezu: obsah se tiskne, rám ne", () => {
    setup();
    const all = strokes(plotLayout(m, lay().id).items).length;
    expect(all).toBe(2); // čára + rám
    ok("hladina VP vypnout");
    const off = strokes(plotLayout(m, lay().id).items);
    expect(off.length).toBe(1);
    expect(bbox(off[0])[2] - bbox(off[0])[0]).toBeCloseTo(100, 9);
    ok("hladina VP zapnout; hladina VP zmrazit");
    expect(strokes(plotLayout(m, lay().id).items).length).toBe(1);
    // GUI kreslí obsah takového výřezu zvlášť (jádro přeskočí celou entitu na skryté hladině)
    expect(viewportContent(vpOf()).length).toBe(1);
    ok("hladina VP rozmrazit; hladina VP netisknout");
    expect(strokes(plotLayout(m, lay().id).items).length).toBe(1);
  });
  it("výřez vypnout (on = false) skryje obsah", () => {
    setup();
    ok(`výřez vypnout ${vpOf().id}`);
    expect(strokes(plotLayout(m, lay().id).items).length).toBe(1);
    expect(viewportContent(vpOf())).toEqual([]);
  });
});

describe("PSLTSCALE: vzor čar ve výřezu na obrazovce = tisk", () => {
  it("1:5 → kopie s LTSCALE 5 (5 × 0,2 = 1 mm papíru na mm vzoru), PSLTSCALE 0 → bez kopií", () => {
    ok("hladina nová OSY barva 1 typčáry CENTER; obdélník 0,0 @1000,500; hladina aktuální OSY; čára 0,250 1000,250; hladina aktuální 0; rozvržení nové P A3 měřítko 1:5");
    const vp = vpOf();
    close(vp.scale, 0.2);
    const list = canvasContent(vp);
    expect(list.map((e) => e.ltscale)).toEqual([5, 5]);
    // renderer násobí vzor LTSCALE objektu × měřítkem transformace výřezu → 5 × 0,2 = 1 (jako tisk s PSLTSCALE 1)
    for (const e of list) close((e.ltscale ?? 1) * vp.scale, 1);
    // stabilní identita (prostorový index, mezipaměť geometrie)
    expect(canvasContent(vpOf())[0]).toBe(list[0]);
    ok("vzhled-stránky psltscale 0");
    expect(m.vars.psltscale).toBe(0);
    expect(canvasContent(vpOf()).map((e) => e.ltscale)).toEqual([undefined, undefined]);
  });
  it("tisk 1:50: první čárka CENTER = 31,75 mm papíru, při PSLTSCALE 0 = 31,75 / 50", () => {
    ok("hladina nová OSY typčáry CENTER; hladina aktuální OSY; čára 0,0 10000,0; hladina aktuální 0; rozvržení nové P A3 bez-razítka bez-rámečku měřítko 1:50");
    const dashLen = () => {
      const st = strokes(plotLayout(m, lay().id).items).find((x) => x.cmds.length > 4)!;
      const [a, b] = [st.cmds[0], st.cmds[1]];
      return Math.hypot(b.k === "L" ? b.p[0] - (a as { p: Vec2 }).p[0] : 0, 0);
    };
    close(dashLen(), 31.75, 1e-6);
    ok("vzhled-stránky psltscale 0");
    close(dashLen(), 31.75 / 50, 1e-6);
  });
  it("bloky v modelu dostanou stejný násobek i vnořeně", () => {
    ok("hladina nová OSY typčáry CENTER; hladina aktuální OSY; čára 0,0 1000,0; hladina aktuální 0; blok B 0,0 e1; rozvržení nové P A3 měřítko 1:10");
    const vp = vpOf();
    const ins = canvasContent(vp).find((e) => e.type === "insert")!;
    close(ins.ltscale!, 10);
    const sub = entityPrims(ins, { model: m }).find((p) => p.k === "sub") as Extract<Prim, { k: "sub" }>;
    expect(sub.entities.map((e) => e.ltscale)).toEqual([10]);
  });
});

describe("okraje tisku (vzhled-stránky okraje)", () => {
  it("list zůstane na místě papíru, tisk ořízne netisknutelnou plochu; okraje 0 vrátí souřadnice", () => {
    ok("obdélník 0,0 @100,50; rozvržení nové L A4 na-šířku bez-razítka");
    const before = strokes(plotLayout(m, lay().id).items).map(bbox);
    const frame0 = lay().entities.find((e) => e.type === "insert") as DInsert;
    closeP(frame0.p, [0, 0]);
    ok("vzhled-stránky okraje 5,5,5,5");
    const page = plotLayout(m, lay().id);
    expect([page.w, page.h]).toEqual([297, 210]);
    expect(strokes(page.items).map(bbox)).toEqual(before);
    const clip = page.items.find((i) => i.k === "clip") as Extract<PlotItem, { k: "clip" }>;
    expect(clip.poly).toEqual([
      [5, 5],
      [292, 5],
      [292, 205],
      [5, 205],
    ]);
    // počátek papíru = roh tisknutelné plochy → entity listu posunuté o −5
    closeP((lay().entities.find((e) => e.type === "insert") as DInsert).p, [-5, -5]);
    ok("vzhled-stránky okraje 0,0,0,0");
    closeP((lay().entities.find((e) => e.type === "insert") as DInsert).p, [0, 0]);
    expect(run("vzhled-stránky okraje 150,0,150,0")[0].error).toMatch(/větší než list/);
  });
  it("změna formátu s okraji: rámeček a razítko v rozích listu", () => {
    ok("obdélník 0,0 @100,50; rozvržení nové L A3; vzhled-stránky okraje 5,5,5,5; vzhled-stránky A4 na-výšku");
    const fr = lay().entities.find((e) => e.type === "insert" && (e as DInsert).block.startsWith("ISO5457")) as DInsert;
    const tb = lay().entities.find((e) => e.type === "insert" && (e as DInsert).block === TITLE_BLOCK) as DInsert;
    closeP(fr.p, [-5, -5]);
    closeP(tb.p, [210 - 10 - 5, 10 - 5]);
  });
});

describe("změna formátu: výchozí výřez se přizpůsobí", () => {
  it("A1 → A4: výřez = kreslicí plocha A4, měřítko vejít přepočteno, razítko MERITKO", () => {
    ok("obdélník 0,0 @1000,500; rozvržení nové L A1");
    expect(vpOf().scale).toBe(0.5);
    const r = ok("vzhled-stránky A4 na-výšku");
    const vp = vpOf();
    closeP(vp.c, [110, 171.5]);
    close(vp.w, 170);
    close(vp.h, 221);
    close(vp.scale, 0.1);
    const tb = lay().entities.find((e) => e.type === "insert" && (e as DInsert).block === TITLE_BLOCK) as DInsert;
    expect(tb.attribs!.find((a) => a.tag === "MERITKO")!.value).toBe("1:10");
    expect(r[0].log.some((l) => l.includes("mimo list"))).toBe(false);
  });
  it("vlastní výřez mimo nový list → varování", () => {
    ok("obdélník 0,0 @100,50; rozvržení nové L A1 bez-výřezu; výřez 500,400 800,550 1:1");
    const r = ok("vzhled-stránky A4");
    expect(r[0].log.join("\n")).toMatch(/mimo list/);
  });
});

describe("atributy vložení při nestejnoměrném měřítku", () => {
  const setup = (ins = "vložit B 0,0 1 1 0 v") => ok(`čára 0,0 20,0; definice-atributu T "T" "x" 20,5 2.5 0; blok B 0,0 e1 e2 smazat; ${ins}`);
  const att = (): DAttrib => (m.entities.find((e) => e.type === "insert") as DInsert).attribs![0];
  it("nastavit sx=2 posune atribut s geometrií a dá šířkový faktor, rot=90 ho otočí", () => {
    setup();
    ok("nastavit e5 sx=2");
    closeP(att().p, [40, 5]);
    close(att().h, 2.5);
    close(att().wf!, 2);
    ok("nastavit e5 rot=90");
    closeP(att().p, [-5, 40]);
    expect(att().rot).toBe(90);
  });
  it("VLOŽIT s měřítky 2 × 1: výška × sy, šířkový faktor sx / sy", () => {
    setup("vložit B 0,0 2 1 0 v");
    closeP(att().p, [40, 5]);
    close(att().h, 2.5);
    close(att().wf!, 2);
    ok("čára 0,0 1,0; vložit B 0,0 1 3 0 w");
    const a = (m.entities.filter((e) => e.type === "insert")[1] as DInsert).attribs![0];
    closeP(a.p, [20, 15]);
    close(a.h, 7.5);
    close(a.wf!, 1 / 3);
  });
  it("zrcadlení nestejnoměrným záporným měřítkem: text zůstane čitelný (ne vzhůru nohama)", () => {
    setup("vložit B 0,0 2 1 0 v");
    ok("nastavit e5 sx=-1");
    expect(att().rot ?? 0).toBe(0);
    expect(att().wf ?? 1).toBeCloseTo(1, 12);
    expect(att().p[0]).toBeLessThan(-20 + 1e-9);
    close(att().p[1], 5);
  });
});

describe("úprava bloku: PURGE, BCLOSE, vložení do sebe", () => {
  it("PURGE při úpravě bloku nesmaže upravovaný blok (ani bloky v něm vložené)", () => {
    ok("čára 0,0 10,0; blok Q 0,0 e1 smazat; čára 0,0 10,0; blok P 0,0 e3 smazat; upravit-blok P; vložit Q 0,0 1 1 0");
    const r = ok("vyčistit bloky");
    expect((r[0].data as { purged: { blocks: string[] } }).purged.blocks).toEqual([]);
    ok("čára 0,0 5,5; zavřít-blok");
    expect(findBlock(m, "P")!.entities.length).toBe(3);
    expect(m.entities.length).toBe(0);
    const r2 = ok("vyčistit bloky");
    expect((r2[0].data as { purged: { blocks: string[] } }).purged.blocks.sort()).toEqual(["P", "Q"]);
  });
  it("BCLOSE bez definice bloku: chyba a návrat do modelu (žádné tiché kreslení mimo blok)", () => {
    ok("čára 0,0 10,0; blok P 0,0 e1 smazat; upravit-blok P");
    m = { ...m, blocks: [] };
    const r = run("zavřít-blok");
    expect(r[0].error).toMatch(/už není/);
    expect(s.space).toBe("model");
    expect(layoutState(s).bedit).toBeNull();
  });
  it("VLOŽIT v úpravě bloku odmítne blok sám do sebe i vnořeně", () => {
    ok("čára 0,0 10,0; blok A 0,0 e1; blok B 0,0 e3; čára 0,0 3,3");
    ok(`blok C 0,0 ${m.entities[m.entities.length - 1].id}; upravit-blok A`);
    expect(run("vložit A 5,5 1 1 0")[0].error).toMatch(/sám sebe/);
    expect(run("vložit B 5,5 1 1 0")[0].error).toMatch(/sám sebe/);
    ok("vložit C 5,5 1 1 0");
  });
});

describe("zamčená hladina výřezu", () => {
  const setup = () => {
    ok("obdélník 0,0 @100,50; hladina nová VP; hladina aktuální VP; rozvržení nové L A4 bez-razítka; hladina aktuální 0; hladina VP zamknout");
    return vpOf().id;
  };
  it("MVIEW Měřítko / Zamknout / Vypnout / Střed a VPLAYER výřez na zamčené hladině nezmění", () => {
    const id = setup();
    const before = JSON.stringify(vpOf());
    for (const cmd of [`výřez měřítko ${id} 1:2`, `výřez zamknout ${id}`, `výřez vypnout ${id}`, `výřez střed ${id} 0,0`, `hladiny-výřezu zmrazit VP výřez ${id}`]) {
      const r = run(cmd);
      expect(r[0].error, cmd).toMatch(/zamčen/);
    }
    expect(JSON.stringify(vpOf())).toBe(before);
    ok("hladina VP odemknout");
    ok(`výřez měřítko ${id} 1:2`);
    expect(vpOf().scale).toBe(0.5);
  });
  it("výběr dvou výřezů, jeden na zamčené hladině: druhý se změní, varování", () => {
    ok("obdélník 0,0 @100,50; hladina nová VP; rozvržení nové L A3 bez-výřezu; výřez 10,10 100,100 1:1; hladina aktuální VP; výřez 110,10 200,100 1:1; hladina aktuální 0; hladina VP zamknout");
    const [a, b] = lay().entities.filter((e) => e.type === "viewport") as DViewport[];
    const r = ok(`výřez měřítko ${a.id} ${b.id} 1:2`);
    expect(r[0].log.join("\n")).toMatch(/zamčené hladině/);
    const [a2, b2] = lay().entities.filter((e) => e.type === "viewport") as DViewport[];
    expect([a2.scale, b2.scale]).toEqual([0.5, 1]);
  });
});

describe("MVIEW Střed, Vejít, Objekt", () => {
  it("Střed: bod modelu (výraz, relativně od středu), zamčený výřez = chyba; prostor se vrátí na list", () => {
    ok("obdélník 0,0 @100,50; rozvržení nové L A4 bez-razítka");
    const id = vpOf().id;
    ok(`výřez střed ${id} 1e3,2e2`);
    expect(vpOf().viewCenter).toEqual([1000, 200]);
    expect(s.space).toBe(`layout:${lay().id}`);
    ok(`výřez střed ${id} @10,0`);
    expect(vpOf().viewCenter).toEqual([1010, 200]);
    ok(`výřez zamknout ${id}`);
    expect(run(`výřez střed ${id} 0,0`)[0].error).toMatch(/zamčený/);
    expect(vpOf().viewCenter).toEqual([1010, 200]);
  });
  it("Vejít u modelu bez plochy (jediný bod) = 1:1, ne obří měřítko", () => {
    ok("bod 10,10; rozvržení nové L A4 bez-výřezu; výřez vejít vejít");
    expect(vpOf().scale).toBe(1);
    expect(vpOf().viewCenter).toEqual([10, 10]);
    m = newDraftModel();
    s = sessionFor(m);
    ok("čára 0,0 100,0; rozvržení nové L A4 bez-výřezu; výřez vejít vejít");
    close(vpOf().scale, (170 / 100) * 0.98);
  });
  it("Objekt: otevřená spline se odmítne, uzavřená křivka projde", () => {
    ok('čára 0,0 100,100; rozvržení nové L A4 bez-výřezu; spline 10,10 50,80 100,10 150,80 ""');
    const sp = lay().entities[lay().entities.length - 1];
    expect(sp.type).toBe("spline");
    expect(run(`výřez objekt ${sp.id} 1:1`)[0].error).toBeTruthy();
    ok("obdélník 20,20 @50,50");
    const pl = lay().entities[lay().entities.length - 1];
    ok(`výřez objekt ${pl.id} 1:1`);
    expect(vpOf().clip?.length).toBe(4);
  });
});

describe("ULOŽIT-BLOK (WBLOCK)", () => {
  it("neplatná verze = chyba, „2013“ = R2013", async () => {
    ok("čára 0,0 10,0; blok A 0,0 e1");
    expect((await runA("uložit-blok A dwg verze R9"))[0].error).toMatch(/verze/);
    const r = await runA("uložit-blok A dxf verze 2013");
    expect(r[0].error).toBeUndefined();
    expect((r[0].data as { file: { text: string } }).file.text).toMatch(/AC1027/);
  });
  it("entity, které převodník nezapíše, se hlásí (ne tichý úspěch)", async () => {
    ok('kružnice 0,0 20; čára 0,0 20,0; definice-atributu T "T" "d" 20,10 2.5 0; blok IN 0,0 e1; blok OUT 0,0 e2 e3 smazat; blok OUT2 0,0 vše');
    const io = await import("../io");
    const probe = (await io.draftExport(newDraftModel(), "dxf")) as { warnings?: string[] };
    const r1 = await runA("uložit-blok OUT dxf");
    const r2 = await runA("uložit-blok OUT2 dxf");
    if (Array.isArray(probe.warnings)) {
      // balík io zapíše vše (vložení, atributy) – úspěch
      expect(r1[0].error).toBeUndefined();
      expect(r2[0].error).toBeUndefined();
    } else {
      expect(r1[0].error).toBeUndefined();
      expect((r1[0].data as { dropped: Record<string, number> }).dropped).toEqual({ attdef: 1 });
      expect((r1[0].data as { written: number }).written).toBe(1);
      expect(r2[0].error).toMatch(/neumí zapsat/);
    }
  });
});

describe("CSV atributů (ATTEXT) – ochrana proti vzorcům", () => {
  it("= + - @ na začátku textu dostane apostrof, čísla zůstanou", () => {
    ok('čára 0,0 20,0; definice-atributu T "T" "x" 20,5 2.5 0; blok B 0,0 e1 e2 smazat; vložit B 0,0 1 1 0 v');
    ok("upravit-atributy e5 T==SUM(A1)");
    expect(rowsToCsv(attributeRows(m))).toContain(";'=SUM(A1)\r\n");
    ok("upravit-atributy e5 T=-5");
    expect(rowsToCsv(attributeRows(m))).toContain(";-5\r\n");
    ok("upravit-atributy e5 T=@cmd");
    expect(rowsToCsv(attributeRows(m))).toContain(";'@cmd\r\n");
    ok('upravit-atributy e5 "T=+420 123"');
    expect(rowsToCsv(attributeRows(m))).toContain(";'+420 123\r\n");
  });
});

describe("výzvy na jedno slovo, názvy v uvozovkách, překlady", () => {
  it("unq odstraní uvozovky kolem názvu s mezerou", () => {
    expect(unq('  "MUJ BLOK" ')).toBe("MUJ BLOK");
    expect(unq("„MŮJ BLOK“")).toBe("MŮJ BLOK");
    expect(unq("KOLO")).toBe("KOLO");
  });
  it("seznam výzev na jedno slovo odpovídá textům výzev (cs / en / de)", () => {
    for (const l of ["cs", "en", "de"] as const) {
      setLang(l);
      const w = [...blockWordPrompts(), ...layoutWordPrompts()];
      expect(w.every((x) => x.length > 5)).toBe(true);
      expect(w[0]).toBe(tr("Zadejte název bloku nebo [?]"));
    }
  });
  it("výřez má vlastní klíč (ne „Výřez“ = Cut-out jádra), „Co tisknout“ je přeložené", () => {
    setLang("en");
    expect(kindOf("viewport")!.label()).toBe("Viewport");
    expect(tr("Co tisknout")).toBe("What to plot");
    setLang("de");
    expect(kindOf("viewport")!.label()).toBe("Ansichtsfenster");
    expect(tr("Co tisknout")).toBe("Was drucken");
  });
  it("německá slova modell / alles / alle", async () => {
    setLang("de");
    ok("rechteck 0,0 @100,50; layout neu L A4; layout modell");
    expect(s.space).toBe("model");
    ok("layout L; mansfen maßstab alles 1:10");
    expect(vpOf().scale).toBe(0.1);
    ok("afebene frieren 0 alles; afebene tauen 0 alle");
    const r = await runA("drucken modell fenster 0,0 100,50 A4");
    expect(r[0].error).toBeUndefined();
    expect((r[0].data as { plot: { name: string }[] }).plot[0].name).toBe("Model");
  });
});
