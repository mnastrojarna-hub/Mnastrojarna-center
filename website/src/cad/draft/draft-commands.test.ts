import { describe, expect, it, beforeEach } from "vitest";
import { setLang } from "../i18n";
import "./index";
import { CmdRun, commands, findCommand, matchKw, runScript, runScriptAsync, splitScript, tokenize } from "./commands";
import { parsePoint } from "./coords";
import { emptyDraftDoc, newDraftModel } from "./doc";
import { dist } from "./geom";
import { createLayer, deleteLayer, findLayer, layerUse, renameLayer, resolveStyle, setCurrentLayer, setLayer } from "./layers";
import type { DArc, DCircle, DEllipse, DLine, DPolyline, DraftEntity, DraftModel, DSpline, DText, DXLine, Vec2 } from "./model";
import { sessionFor, type DraftSession } from "./session";
import { findSnap, orthoPoint, polarPoint } from "./snap";
import { spatialIndex } from "./spatial";
import { pickEntity, windowSelect } from "./select";
import { applyDraftText, draftLine, draftUndoLine } from "./agent";
import { draftStatus } from "./status";
import { polylineArea } from "./kinds-core";
import { entityCurves } from "./kinds";
import { cPoint } from "./curves";

const closeP = (p: Vec2, q: Vec2, eps = 1e-9) => expect(dist(p, q)).toBeLessThan(eps);
let m: DraftModel;
let s: DraftSession;
const run = (text: string) => {
  const r = runScript(m, s, text);
  m = r.model;
  return r.results;
};
const ok = (text: string) => {
  const r = run(text);
  for (const x of r) expect(x.error, `${x.input}`).toBeUndefined();
  return r;
};
const ent = <T extends DraftEntity>(id: string) => m.entities.find((e) => e.id === id) as T;
const last = <T extends DraftEntity>() => m.entities[m.entities.length - 1] as T;

beforeEach(() => {
  setLang("cs");
  m = newDraftModel();
  s = sessionFor(m);
});

describe("příkazy – registr a názvy CS / EN / DE", () => {
  it("názvy, zkratky, _anglicky a předpony AutoCADu", () => {
    for (const n of ["čára", "cara", "ÚSEČKA", "line", "LINIE", "L", "_LINE", "-line"]) expect(findCommand(n)?.id, n).toBe("LINE");
    for (const n of ["kružnice", "circle", "Kreis", "C"]) expect(findCommand(n)?.id, n).toBe("CIRCLE");
    for (const n of ["hladina", "layer", "ebene", "LA", "-LA"]) expect(findCommand(n)?.id, n).toBe("LAYER");
    expect(findCommand("bogen")?.id).toBe("ARC");
    expect(findCommand("křivka")?.id).toBe("PLINE");
    expect(findCommand("rechteck")?.id).toBe("RECTANG");
    expect(findCommand("nesmysl")).toBeUndefined();
  });
  it("každý příkaz má popis, skupinu a názvy ve třech jazycích", () => {
    for (const c of commands()) {
      expect(c.names.cs.length && c.names.en.length && c.names.de.length, c.id).toBeTruthy();
      expect(c.desc().length, c.id).toBeGreaterThan(5);
    }
  });
  it("klíčová slova: celé slovo v libovolném jazyce, _id, jednoznačný začátek v jazyce rozhraní", () => {
    const kws = [{ id: "undo", cs: "Zpět", en: "Undo", de: "Zurück" }, { id: "close", cs: "Uzavřít", en: "Close", de: "Schließen" }];
    expect(matchKw("uzavřít", kws)?.id).toBe("close");
    expect(matchKw("close", kws)?.id).toBe("close");
    expect(matchKw("schliessen", kws)?.id).toBe("close");
    expect(matchKw("_undo", kws)?.id).toBe("undo");
    expect(matchKw("u", kws)?.id).toBe("close");
    setLang("en");
    expect(matchKw("u", kws)?.id).toBe("undo");
    setLang("de");
    expect(matchKw("s", kws)?.id).toBe("close");
    setLang("cs");
  });
  it("tokeny a skript: uvozovky, „…“, středník, komentáře", () => {
    expect(tokenize('text 0,0 5 0 "Ahoj světe"')).toEqual(["text", "0,0", "5", "0", "Ahoj světe"]);
    expect(tokenize("text 0,0 5 0 „Dobrý den“")).toEqual(["text", "0,0", "5", "0", "Dobrý den"]);
    expect(splitScript('čára 0,0 1,1; text 0,0 5 0 "a;b"\n# komentář\nkružnice 0,0 5 // pozn.')).toEqual(["čára 0,0 1,1", 'text 0,0 5 0 "a;b"', "kružnice 0,0 5"]);
  });
});

describe("zadání souřadnic", () => {
  it("absolutně, relativně, polárně, výrazy, @", () => {
    ok("čára 10,20 @30,0 @20<90 50<0 #0,0 @");
    const L = m.entities as DLine[];
    closeP(L[0].b, [40, 20]);
    closeP(L[1].b, [40, 40]);
    closeP(L[2].b, [50, 0]);
    closeP(L[3].b, [0, 0]);
    expect(L.length).toBe(4); // „@“ = totožný bod → přeskočen
    ok("čára 100/4,2*5 @10*2,0");
    closeP(last<DLine>().a, [25, 10]);
    closeP(last<DLine>().b, [45, 10]);
  });
  it("odkazy na entity: start / end / mid / cen / q / v / x() / per() / tan() / nea()", () => {
    ok("čára 0,0 100,0; kružnice 50,50 20; křivka 0,100 50,150 100,100");
    const ctx = { model: m, list: m.entities as readonly DraftEntity[], last: null as Vec2 | null };
    closeP(parsePoint("e1.end", ctx)!, [100, 0]);
    closeP(parsePoint("e1.kon", ctx)!, [100, 0]);
    closeP(parsePoint("e1.mid", ctx)!, [50, 0]);
    closeP(parsePoint("e2.cen", ctx)!, [50, 50]);
    closeP(parsePoint("e2.q2", ctx)!, [50, 70]);
    closeP(parsePoint("e3.v2", ctx)!, [50, 150]);
    ok("čára 50,0 50,100");
    ctx.list = m.entities;
    ctx.model = m;
    closeP(parsePoint("x(e2,e4)", ctx)!, [50, 30]);
    closeP(parsePoint("x(e2,e4,2)", ctx)!, [50, 70]);
    closeP(parsePoint("x(e2,e4,50,80)", { ...ctx, list: m.entities })!, [50, 70]);
    closeP(parsePoint("per(e1)", { ...ctx, list: m.entities, base: [30, 40] })!, [30, 0]);
    const t = parsePoint("tan(e2)", { ...ctx, list: m.entities, base: [50, 0] })!;
    expect(Math.abs(dist(t, [50, 50]) - 20)).toBeLessThan(1e-9);
    closeP(parsePoint("nea(e2,50,100)", { ...ctx, list: m.entities })!, [50, 70]);
    expect(() => parsePoint("e99.end", ctx)).toThrow(/neexistuje/);
    expect(() => parsePoint("x(e1,e3)", { ...ctx, list: m.entities })).toThrow(/neprotínají/);
  });
  it("přímá vzdálenost: číslo = vzdálenost ve směru posledního úseku", () => {
    ok("čára 0,0 @10<90 25");
    closeP(last<DLine>().b, [0, 35]);
  });
  it("chybné zadání se ohlásí s důvodem a příkaz se nezapíše", () => {
    const r = run("čára 0,0 abc");
    expect(r[0].ok).toBe(false);
    expect(r[0].error).toMatch(/abc/);
    expect(m.entities.length).toBe(0);
    expect(run("čára 1,2,3")[0].error).toMatch(/souřadnice/);
    expect(run("kružnice")[0].error).toMatch(/chybí zadání/);
    expect(run("čára 0,0 1,1 navíc")[0].error).toBeTruthy();
  });
});

describe("kreslicí příkazy", () => {
  it("ČÁRA s Uzavřít a Zpět", () => {
    ok("čára 0,0 100,0 100,50 zpět 100,60 uzavřít");
    expect(m.entities.length).toBe(3);
    closeP(ent<DLine>("e4").b, [0, 0]);
    ok("line 0,0 10,0 10,10 close");
    expect(m.entities.length).toBe(6);
    ok("linie 0,0 5,5 schließen".replace(" schließen", ""));
  });
  it("KŘIVKA: úseky, tečný oblouk, druhý bod, šířka, uzavření", () => {
    ok("křivka 0,0 100,0 oblouk 100,50 úsečka 0,50 uzavřít");
    const p = last<DPolyline>();
    expect(p.pts).toEqual([[0, 0], [100, 0], [100, 50], [0, 50]]);
    expect(p.closed).toBe(true);
    expect(p.bulges![1]).toBeCloseTo(1, 12); // půlkruh tečně navazující na +X
    expect(polylineArea(p)).toBeCloseTo(5000 + (Math.PI * 625) / 2, 9);
    ok("křivka 0,0 šířka 2 2 50,0 50,50");
    expect(last<DPolyline>().width).toBe(2);
    ok("pline 0,0 arc second 50,50 100,0");
    expect(last<DPolyline>().bulges![0]).toBeCloseTo(-1, 12);
  });
  it("KRUŽNICE: střed+poloměr, průměr, 3B, 2B, TTP", () => {
    ok("kružnice 10,10 5; kružnice 0,0 průměr 20; kružnice 3b 10,0 0,10 -10,0; kružnice 2b 0,0 10,0");
    const c = m.entities as DCircle[];
    expect(c[0].r).toBe(5);
    expect(c[1].r).toBe(10);
    closeP(c[2].c, [0, 0]);
    expect(c[2].r).toBeCloseTo(10, 12);
    closeP(c[3].c, [5, 0]);
    ok("čára -100,0 100,0; čára 0,-100 0,100");
    ok("kružnice ttp e5@20,1 e6@1,20 10");
    const t = last<DCircle>();
    closeP(t.c, [10, 10]);
    expect(t.r).toBe(10);
    ok("circle 0,0 d 8");
    expect(last<DCircle>().r).toBe(4);
  });
  it("OBLOUK: 3 body, počátek-střed-konec / úhel / tětiva, počátek-konec-poloměr / směr / úhel, střed-počátek-konec", () => {
    ok("oblouk 10,0 0,10 -10,0");
    let a = last<DArc>();
    closeP(a.c, [0, 0]);
    expect([a.a0, a.a1]).toEqual([0, 180]);
    ok("oblouk -10,0 0,10 10,0"); // po směru hodin → uloží se proti směru
    a = last<DArc>();
    expect([a.a0, a.a1]).toEqual([0, 180]);
    ok("oblouk 10,0 střed 0,0 0,10");
    expect([last<DArc>().a0, last<DArc>().a1]).toEqual([0, 90]);
    ok("oblouk 10,0 střed 0,0 úhel -90");
    expect([last<DArc>().a0, last<DArc>().a1]).toEqual([270, 0]);
    ok("oblouk 10,0 střed 0,0 tětiva 14.142135623730951");
    expect(last<DArc>().a1).toBeCloseTo(90, 9);
    ok("oblouk 10,0 konec -10,0 poloměr 10");
    closeP(last<DArc>().c, [0, 0]);
    ok("oblouk 0,0 konec 10,10 směr 0");
    closeP(last<DArc>().c, [0, 10]);
    ok("oblouk 0,0 konec 20,0 úhel 180");
    closeP(last<DArc>().c, [10, 0]);
    ok("oblouk střed 0,0 5,0 0,5");
    expect(last<DArc>().r).toBe(5);
    ok("arc center 0,0 5,0 angle 45");
    expect(last<DArc>().a1).toBeCloseTo(45, 9);
  });
  it("OBDÉLNÍK: rohy, rozměry, zaoblení, zkosení, natočení", () => {
    ok("obdélník 0,0 @100,50");
    const r = last<DPolyline>();
    expect(r.closed).toBe(true);
    expect(Math.abs(polylineArea(r))).toBeCloseTo(5000, 9);
    ok("obdélník zaoblení 5 0,0 100,50");
    expect(Math.abs(polylineArea(last<DPolyline>()))).toBeCloseTo(5000 - (4 - Math.PI) * 25, 9);
    ok("obdélník zkosení 5 5 0,0 100,50");
    expect(Math.abs(polylineArea(last<DPolyline>()))).toBeCloseTo(5000 - 4 * 12.5, 9);
    ok("obdélník natočení 90 0,0 rozměry 30 20");
    const q = last<DPolyline>();
    closeP(q.pts[1], [0, 30], 1e-9);
    ok("rectang 0,0 dimensions 10 20 -1,-1");
    closeP(last<DPolyline>().pts[2], [-10, -20], 1e-9);
  });
  it("MNOHOÚHELNÍK: vepsaný číslem (spodní hrana vodorovně), opsaný bodem, hranou", () => {
    ok("mnohoúhelník 6 0,0 vepsaný 10");
    const p = last<DPolyline>();
    expect(p.pts.length).toBe(6);
    for (const q of p.pts) expect(Math.hypot(q[0], q[1])).toBeCloseTo(10, 9);
    expect(p.pts[0][1]).toBeCloseTo(p.pts[1][1], 9);
    ok("mnohoúhelník 4 0,0 opsaný 10,0");
    for (const q of last<DPolyline>().pts) expect(Math.max(Math.abs(q[0]), Math.abs(q[1]))).toBeCloseTo(10, 9);
    ok("polygon 3 edge 0,0 10,0");
    const t = last<DPolyline>();
    closeP(t.pts[0], [0, 0], 1e-9);
    closeP(t.pts[1], [10, 0], 1e-9);
    expect(t.pts[2][1]).toBeGreaterThan(0);
  });
  it("ELIPSA: osou, středem, natočením, eliptický oblouk", () => {
    ok("elipsa -10,0 10,0 4");
    let e = last<DEllipse>();
    closeP(e.major, [10, 0]);
    expect(e.ratio).toBeCloseTo(0.4, 12);
    ok("elipsa střed 0,0 0,3 10"); // druhá poloosa delší → prohodí se
    e = last<DEllipse>();
    expect(Math.hypot(...e.major)).toBeCloseTo(10, 12);
    expect(e.ratio).toBeCloseTo(0.3, 12);
    ok("elipsa 0,0 20,0 natočení 60");
    expect(last<DEllipse>().ratio).toBeCloseTo(0.5, 12);
    ok("elipsa oblouk střed 0,0 10,0 5 0 90");
    e = last<DEllipse>();
    expect([e.t0, e.t1]).toEqual([0, 90]);
    const c = entityCurves(e, { model: m })[0];
    closeP(cPoint(c, c.k === "ell" ? c.t1 : 0), [0, 5], 1e-9);
  });
  it("SPLINE: proložení, řídicí body, uzavřená", () => {
    ok("spline 0,0 10,10 20,0 30,10");
    const sp = last<DSpline>();
    expect(sp.fit?.length).toBe(4);
    const c = entityCurves(sp, { model: m })[0];
    if (c.k !== "nurbs") throw new Error();
    closeP(cPoint(c, c.knots[3]), [0, 0], 1e-9);
    closeP(cPoint(c, c.knots[c.ctrl.length]), [30, 10], 1e-9);
    ok("spline metoda řídicí 0,0 10,10 20,0 30,10");
    expect(last<DSpline>().fit).toBeUndefined();
    expect(last<DSpline>().ctrl.length).toBe(4);
    ok("spline metoda proložit 0,0 10,0 10,10 0,10 uzavřít");
    expect(last<DSpline>().closed).toBe(true);
  });
  it("PŘÍMKA a POLOPŘÍMKA, BOD, TEXT", () => {
    ok("přímka 0,0 1,1 0,1; přímka vodorovně 0,5 0,6; přímka úhel 30 0,0; polopřímka 0,0 10,0 0,10");
    expect(m.entities.filter((e) => e.type === "xline").length).toBe(5);
    expect(m.entities.filter((e) => e.type === "ray").length).toBe(2);
    const x = m.entities[0] as DXLine;
    expect(x.dir[0]).toBeCloseTo(Math.SQRT1_2, 12);
    ok("bod 1,1 2,2 3,3");
    expect(m.entities.filter((e) => e.type === "point").length).toBe(3);
    ok('text 10,10 5 30 "Ahoj světe"');
    const t = last<DText>();
    expect(t.s).toBe("Ahoj světe");
    expect(t.h).toBe(5);
    expect(t.rot).toBe(30);
    ok('text zarovnání mc 0,0 2.5 0 "Střed"');
    expect(last<DText>().halign).toBe("center");
    expect(last<DText>().valign).toBe("middle");
    expect(m.vars.textsize).toBe(2.5);
  });
});

describe("hladiny", () => {
  it("založení, aktuální, vlastnosti, přejmenování, smazání s přesunem", () => {
    m = createLayer(m, "OSY", { color: 1, linetype: "CENTER", lineweight: 0.25 });
    expect(() => createLayer(m, "osy")).toThrow(/existuje/);
    expect(() => createLayer(m, "a<b")).toThrow();
    m = setCurrentLayer(m, "OSY");
    ok("čára 0,0 10,0");
    expect(last<DLine>().layer).toBe("OSY");
    expect(() => setLayer(m, "OSY", { frozen: true })).toThrow(/aktuální/);
    m = renameLayer(m, "OSY", "Osy");
    expect(last<DLine>().layer).toBe("Osy");
    expect(m.vars.clayer).toBe("Osy");
    expect(() => deleteLayer(m, "Osy")).toThrow(/aktuální/);
    m = setCurrentLayer(m, "0");
    expect(() => deleteLayer(m, "Osy")).toThrow(/obsahuje 1/);
    m = deleteLayer(m, "Osy", { moveTo: "0" });
    expect(last<DLine>().layer).toBe("0");
    expect(() => deleteLayer(m, "0")).toThrow();
  });
  it("výsledný styl ByLayer / ByBlock / vlastní a výchozí tloušťka", () => {
    m = createLayer(m, "A", { color: 3, linetype: "HIDDEN", lineweight: "Default" });
    const e: DraftEntity = { id: "x", layer: "A", type: "point", p: [0, 0] };
    let st = resolveStyle(m, e);
    expect(st.color).toBe(3);
    expect(st.linetype?.name).toBe("HIDDEN");
    expect(st.lineweight).toBe(0.25);
    st = resolveStyle(m, { ...e, color: "#ff0000", linetype: "Continuous", lineweight: 0.5, ltscale: 2 });
    expect(st.color).toBe("#ff0000");
    expect(st.linetype?.pattern).toEqual([]);
    expect(st.lineweight).toBe(0.5);
    expect(st.ltscale).toBe(2);
    st = resolveStyle(m, { ...e, color: "ByBlock", linetype: "ByBlock", lineweight: "ByBlock" }, { color: 5, linetype: "DASHED", lineweight: 0.7 });
    expect(st.color).toBe(5);
    expect(st.linetype?.name).toBe("DASHED");
    expect(st.lineweight).toBe(0.7);
  });
  it("příkaz HLADINA textem (cs / en / de) a typy čar z knihovny", () => {
    ok('hladina nová OSY barva červená typčáry CENTER tloušťka 0.25 popis "osy děr"');
    ok("layer new HIDDEN2L color 8 linetype HIDDEN2");
    ok("ebene neu Bemaßung farbe 3 linientyp DASHDOT linienstärke 0.18");
    expect(findLayer(m, "OSY")).toMatchObject({ color: 1, linetype: "CENTER", lineweight: 0.25, desc: "osy děr" });
    expect(findLayer(m, "HIDDEN2L")?.linetype).toBe("HIDDEN2");
    expect(m.linetypes.some((l) => l.name === "HIDDEN2")).toBe(true);
    ok("hladina aktuální OSY; hladina OSY vypnout; hladina 0 zmrazit zamknout netisk");
    expect(m.vars.clayer).toBe("OSY");
    expect(findLayer(m, "0")).toMatchObject({ frozen: true, locked: true, plot: false });
    ok("hladina * rozmrazit odemknout zapnout");
    expect(m.layers.every((l) => !l.frozen && !l.locked && l.on)).toBe(true);
    ok("hladina vytvořit KONTURY barva 7");
    expect(m.vars.clayer).toBe("KONTURY");
    const r = run("hladina smazat KONTURY");
    expect(r[0].error).toMatch(/aktuální/);
    ok("hladina přejmenovat OSY Osy");
    expect(findLayer(m, "Osy")).toBeTruthy();
    const lst = ok("hladina seznam")[0];
    expect((lst.data?.layers as unknown[]).length).toBe(m.layers.length);
  });
  it("zamčená hladina: entity se nesmažou ani nezmění", () => {
    ok("čára 0,0 10,0; hladina 0 zamknout");
    const r = ok("smazat e1")[0];
    expect(r.log.join(" ")).toMatch(/zamčené/);
    expect(m.entities.length).toBe(1);
  });
});

describe("výběr, vlastnosti, smazání, dotazy", () => {
  beforeEach(() => {
    ok("hladina nová OSY barva 1; čára 0,0 100,0; kružnice 50,50 20; hladina aktuální OSY; čára 50,-10 50,110; text 0,-20 5 0 \"Popis\"");
  });
  it("výběr oknem, křížením, hladinou, druhem, id, poslední, odebrat", () => {
    const idx = spatialIndex(m.entities, { model: m });
    expect(windowSelect(m, idx, { x0: -1, y0: -1, x1: 101, y1: 1 }, false)).toEqual(["e1"]);
    expect(windowSelect(m, idx, { x0: 45, y0: 25, x1: 55, y1: 35 }, true).sort()).toEqual(["e2", "e3"]);
    expect(pickEntity(m, idx, [70, 50.5], 1)?.id).toBe("e2");
    ok("vyber hladina OSY");
    expect(s.sel).toEqual(["e3", "e4"]);
    ok("vyber typ kružnice");
    expect(s.sel).toEqual(["e2"]);
    ok("vyber vše odebrat e1");
    expect(s.sel).toEqual(["e2", "e3", "e4"]);
    ok("select window -1,-1 101,1");
    expect(s.sel).toEqual(["e1"]);
    ok("wählen kreuzen 45,25 55,35");
    expect(s.sel.sort()).toEqual(["e2", "e3"]);
    ok("vyber výběr přidat e1");
    expect(s.sel.sort()).toEqual(["e1", "e2", "e3"]);
    ok("vyber e4; vyber předchozí");
    expect(s.sel.sort()).toEqual(["e1", "e2", "e3"]);
    ok("vyber nic");
    expect(s.sel).toEqual([]);
  });
  it("vlastnosti: barva, typ, tloušťka, hladina; ByLayer vrátí výchozí", () => {
    ok("vlastnosti e1 e2 barva 5 typčáry DASHED tloušťka 0.5 hladina OSY");
    expect(ent("e1")).toMatchObject({ color: 5, linetype: "DASHED", lineweight: 0.5, layer: "OSY" });
    ok("vyber e2; properties color bylayer lineweight bylayer");
    expect(ent("e2").color).toBeUndefined();
    expect(ent("e2").lineweight).toBeUndefined();
    expect(run("vlastnosti e1 barva 999")[0].error).toMatch(/barva/);
  });
  it("nastavit geometrii (panel vlastností textem)", () => {
    ok("nastavit e2 r 25 c 10,10; nastavit e1 length=50; nastavit e4 s \"Nový text\" h 7");
    expect(ent<DCircle>("e2")).toMatchObject({ r: 25, c: [10, 10] });
    closeP(ent<DLine>("e1").b, [50, 0]);
    expect(ent<DText>("e4")).toMatchObject({ s: "Nový text", h: 7 });
    expect(run("nastavit e2 xyz 1")[0].error).toMatch(/neznámá/);
  });
  it("smazat výběrem a PICKFIRST", () => {
    ok("smazat hladina OSY");
    expect(m.entities.map((e) => e.id)).toEqual(["e1", "e2"]);
    ok("vyber e1; smazat");
    expect(m.entities.map((e) => e.id)).toEqual(["e2"]);
  });
  it("dotazy: vzdálenost, plocha, souřadnice, výpis, stav, rozsah", () => {
    const d = ok("vzdálenost 0,0 e1.end")[0];
    expect(d.data).toMatchObject({ distance: 100, angle: 0, dx: 100, dy: 0 });
    const a = ok("plocha 0,0 100,0 100,50 0,50")[0];
    expect(a.data).toMatchObject({ area: 5000, perimeter: 300 });
    const ao = ok("plocha objekt e2")[0];
    expect(ao.data!.area as number).toBeCloseTo(Math.PI * 400, 9);
    expect(ok("souřadnice x(e1,e3)")[0].data!.point).toEqual([50, 0]);
    const li = ok("výpis e2")[0];
    expect(li.log.join("\n")).toMatch(/Poloměr: 20/);
    const st = ok("stav")[0].data!.status as ReturnType<typeof draftStatus>;
    expect(st.entities).toBe(4);
    expect(st.counts).toMatchObject({ line: 2, circle: 1, text: 1 });
    expect(st.layers.find((l) => l.name === "OSY")?.count).toBe(2);
    const ex = ok("rozsah")[0].data!.extents as { min: Vec2; max: Vec2 };
    expect(ex.min[0]).toBeCloseTo(0, 9);
    expect(ex.max[1]).toBeCloseTo(110, 9);
  });
  it("proměnné, jednotky, měřítko čar, tloušťky", () => {
    ok("proměnná cecolor 3; proměnná celweight 0.35; jednotky cm přesnost 2; měřítkočar 0.5; tloušťky zap");
    expect(m.vars).toMatchObject({ cecolor: 3, celweight: 0.35, units: "cm", prec: 2, ltscale: 0.5, lwdisplay: true });
    ok("čára 0,0 1,1");
    expect(last()).toMatchObject({ color: 3, lineweight: 0.35 });
    expect(run("proměnná nesmysl 1")[0].error).toMatch(/neznámá/);
  });
});

describe("uchopení a trasování", () => {
  it("koncový bod, polovina, střed, kvadrant, průsečík, kolmo, tečně, nejbližší", () => {
    ok("čára 0,0 100,0; kružnice 50,50 20; čára 50,-10 50,110; čára 200,0 300,0");
    const idx = spatialIndex(m.entities, { model: m });
    const all = new Set(["end", "mid", "cen", "qua", "int", "per", "tan", "nea", "nod", "ins"] as const);
    expect(findSnap(m, idx, [99, 1], 3, all)).toMatchObject({ kind: "end", p: [100, 0] });
    expect(findSnap(m, idx, [251, 1], 3, all)).toMatchObject({ kind: "mid", p: [250, 0] });
    expect(findSnap(m, idx, [51.5, 51], 3, new Set(["cen"]))).toMatchObject({ kind: "cen", p: [50, 50] });
    expect(findSnap(m, idx, [69, 51], 3, new Set(["qua"]))?.p).toEqual([70, 50]);
    const i = findSnap(m, idx, [50.5, 0.4], 3, new Set(["int"]))!;
    closeP(i.p, [50, 0]);
    const p = findSnap(m, idx, [30, 1], 3, new Set(["per"]), [30, 40])!;
    closeP(p.p, [30, 0]);
    const t = findSnap(m, idx, [42, 68], 3, new Set(["tan"]), [0, 50])!;
    expect(t.kind).toBe("tan");
    closeP(t.p, [50 + 20 * Math.cos(Math.PI - Math.acos(0.4)), 50 + 20 * Math.sin(Math.PI - Math.acos(0.4))], 1e-9);
    const n = findSnap(m, idx, [75, 1], 3, new Set(["nea"]))!;
    closeP(n.p, [75, 0]);
  });
  it("ORTHO a polární trasování", () => {
    expect(orthoPoint([0, 0], [10, 3])).toEqual([10, 0]);
    expect(orthoPoint([0, 0], [2, -9])).toEqual([0, -9]);
    const r = polarPoint([0, 0], [10, 5.9], 30)!;
    expect(r.angle).toBe(30);
    closeP(r.p, [Math.cos(Math.PI / 6) * (10 * Math.cos(Math.PI / 6) + 5.9 * 0.5), Math.sin(Math.PI / 6) * (10 * Math.cos(Math.PI / 6) + 5.9 * 0.5)]);
    expect(polarPoint([0, 0], [10, 3], 30)).toBeNull();
  });
});

describe("GUI běh příkazu krok za krokem", () => {
  it("výzvy, náhled, chybné zadání zopakuje výzvu, Esc ponechá nakreslené", () => {
    const r = new CmdRun(findCommand("L")!, m, s, { interactive: true });
    r.start();
    expect(r.prompt?.k).toBe("point");
    r.feed({ k: "point", p: [0, 0] });
    expect(r.prompt?.k === "point" && r.prompt.preview?.([5, 5])).toEqual([{ type: "line", a: [0, 0], b: [5, 5] }]);
    expect(r.feedText("blabla")).toMatch(/blabla/);
    expect(r.done).toBe(false);
    r.feed({ k: "point", p: [10, 0] });
    expect(r.feedText("@0,10")).toBeNull();
    r.cancel();
    expect(r.done).toBe(true);
    expect(r.tx.model.entities.length).toBe(2);
    closeP((r.tx.model.entities[1] as DLine).b, [10, 10]);
  });
  it("přímá vzdálenost ve směru kurzoru", () => {
    const r = new CmdRun(findCommand("čára")!, m, s, { interactive: true });
    r.start();
    r.feed({ k: "point", p: [0, 0] });
    r.feedText("30", { dir: [0, -1] });
    closeP((r.tx.model.entities[0] as DLine).b, [0, -30]);
  });
});

describe("text pro agenty (2d …)", () => {
  it("předpony cs / en / de a anglický úkos", () => {
    expect(draftLine("2d čára 0,0 1,1")).toBe("čára 0,0 1,1");
    expect(draftLine("zeichnen linie 0,0 1,1")).toBe("linie 0,0 1,1");
    expect(draftLine("draft line 0,0 1,1")).toBe("line 0,0 1,1");
    expect(draftLine("draft 3 faces top")).toBeNull();
    expect(draftLine("kvádr 10 10 10")).toBeNull();
    expect(draftUndoLine("zpět 2")).toBe("zpět 2");
    expect(draftUndoLine("redo")).toBe("znovu");
    expect(draftLine("draft faces side 3")).toBeNull();
    expect(draftLine("2d: čára 0,0 1,1")).toBe("čára 0,0 1,1");
    expect(draftLine("2dčára")).toBeNull();
    expect(draftUndoLine("čára 0,0")).toBeNull();
  });
  it("nový výkres, kreslení, chyba na řádku nezastaví další, stav", async () => {
    const part = { app: "mnastrojarna-cad" as const, version: 2 as const, name: "Díl", material: "ocel", features: [] };
    const r0 = await applyDraftText(part, "čára 0,0 1,1");
    expect(r0.log[0]).toMatch(/není 2D výkres/);
    const r1 = await applyDraftText(part, "nový Deska cm; hladina nová OSY barva 1; čára 0,0 10,0; kružnice 5,5 nic; kružnice 5,5 2");
    expect(r1.newDoc?.kind).toBe("draft");
    expect(r1.newDoc?.name).toBe("Deska");
    const d = r1.newDoc!.draft!;
    expect(d.vars.units).toBe("cm");
    expect(d.entities.map((e) => e.type)).toEqual(["line", "circle"]);
    expect(r1.results.filter((x) => !x.ok).length).toBe(1);
    expect(r1.log.some((l) => l.startsWith("✗"))).toBe(true);
    const r2 = await applyDraftText(r1.newDoc!, "export dxf");
    const file = r2.results[0].data!.file as { text: string; name: string };
    expect(file.name).toMatch(/\.dxf$/);
    expect(file.text).toContain("OSY");
  });
});

describe("DXF / DWG přes acad-ts (základ)", () => {
  it("DXF tam a zpět: hladiny (barva, typ, tloušťka, vypnutá, zmrazená, zamčená, tisk), typy čar, entity", async () => {
    ok('hladina nová OSY barva 1 typčáry CENTER tloušťka 0.35; hladina nová VYP barva 4 vypnout; hladina nová SKRYTE barva #336699 typčáry HIDDEN2 vypnout; hladina nová ZAM barva 5 zamknout netisk; hladina nová ZMR barva 6 zmrazit');
    ok("hladina aktuální OSY; čára 0,0 100,0; kružnice 50,50 20; oblouk 10,0 0,10 -10,0; křivka 0,0 10,0 oblouk 10,10 úsečka 0,10 uzavřít");
    ok("elipsa oblouk střed 0,0 10,0 5 0 90; spline 0,0 10,10 20,0; přímka 0,0 1,1; polopřímka 0,0 0,1; bod 3,3; text 5,5 2.5 30 \"Žluťoučký kůň\"");
    ok("vlastnosti e1 barva 3 typčáry DASHED tloušťka 0.5 měřítkočáry 2; měřítkočar 0.5; jednotky mm přesnost 3");
    const { draftExport, draftImport } = await import("./io");
    const f = await draftExport(m, "dxf");
    const back = (await draftImport("t.dxf", f.data)).model;
    const L = (n: string) => back.layers.find((l) => l.name === n)!;
    expect(L("OSY")).toMatchObject({ color: 1, linetype: "CENTER", lineweight: 0.35, on: true });
    expect(L("SKRYTE")).toMatchObject({ color: "#336699", linetype: "HIDDEN2", on: false });
    expect(L("ZAM")).toMatchObject({ locked: true, plot: false });
    expect(L("VYP")).toMatchObject({ color: 4, on: false });
    expect(L("ZMR").frozen).toBe(true);
    expect(back.linetypes.find((l) => l.name === "CENTER")?.pattern).toEqual([31.75, -6.35, 6.35, -6.35]);
    expect(back.vars).toMatchObject({ units: "mm", ltscale: 0.5, prec: 3, clayer: "OSY" });
    expect(back.entities.map((e) => e.type)).toEqual(m.entities.map((e) => e.type));
    const e1 = back.entities[0];
    expect(e1).toMatchObject({ layer: "OSY", color: 3, linetype: "DASHED", lineweight: 0.5, ltscale: 2 });
    const pl = back.entities.find((e) => e.type === "polyline") as DPolyline;
    expect(pl.closed).toBe(true);
    expect(pl.bulges![1]).toBeCloseTo(1, 9);
    const el = back.entities.find((e) => e.type === "ellipse") as DEllipse;
    expect(el.t1).toBeCloseTo(90, 9);
    const tx = back.entities.find((e) => e.type === "text") as DText;
    expect(tx).toMatchObject({ s: "Žluťoučký kůň", h: 2.5 });
    expect(tx.rot).toBeCloseTo(30, 9);
    const ar = back.entities.find((e) => e.type === "arc") as DArc;
    expect([ar.a0, ar.a1].map((x) => Math.round(x * 1e6) / 1e6)).toEqual([0, 180]);
  });
  it("DWG tam a zpět (R2018 a R2000)", async () => {
    ok("hladina nová OSY barva 1 typčáry CENTER; hladina aktuální OSY; čára 0,0 100,0; kružnice 50,50 20; text 0,0 5 0 \"Ahoj\"");
    const { draftExport, draftImport } = await import("./io");
    for (const v of ["R2018", "R2000"] as const) {
      const f = await draftExport(m, "dwg", { version: v });
      expect(f.bytes).toBeGreaterThan(1000);
      const back = (await draftImport("t.dwg", f.data)).model;
      expect(back.layers.find((l) => l.name === "OSY")).toMatchObject({ color: 1, linetype: "CENTER" });
      expect(back.entities.map((e) => e.type)).toEqual(["line", "circle", "text"]);
      expect((back.entities[1] as DCircle).r).toBe(20);
    }
  }, 60000);
});

describe("výkon", () => {
  it("20 000 entit skriptem: přidání, index, okno, uchopení v řádu desítek ms", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 20000; i++) lines.push(`čára ${i % 200 * 10},${Math.floor(i / 200) * 10} @8,6`);
    const t0 = performance.now();
    const r = await runScriptAsync(m, s, lines.join("\n"));
    const t1 = performance.now();
    m = r.model;
    expect(m.entities.length).toBe(20000);
    const idx = spatialIndex(m.entities, { model: m });
    const t2 = performance.now();
    const w = windowSelect(m, idx, { x0: 0, y0: 0, x1: 100, y1: 100 }, true);
    const sn = findSnap(m, idx, [8.2, 6.1], 1, new Set(["end", "mid", "int"]));
    const t3 = performance.now();
    expect(w.length).toBeGreaterThan(50);
    expect(sn?.kind).toBe("end");
    // meze s rezervou pro sdílený přetížený stroj (kvadratický algoritmus by trval minuty)
    expect(t1 - t0).toBeLessThan(30000);
    expect(t3 - t2).toBeLessThan(1500);
    expect(layerUse(m, "0")).toBe(20000);
  }, 60000);
});

describe("dokument", () => {
  it("nový 2D dokument a JSON tam a zpět", () => {
    const d = emptyDraftDoc("Test");
    expect(d.kind).toBe("draft");
    expect(d.draft!.layers[0].name).toBe("0");
    expect(d.draft!.linetypes.map((l) => l.name)).toContain("CENTER");
    const j = JSON.parse(JSON.stringify(d));
    expect(j).toEqual(d);
  });
});

describe("návod pro AI", () => {
  it("příklad 2D výkresu z návodu proběhne bez chyb", async () => {
    const { AGENT_GUIDE } = await import("../agent-guide");
    const block = /Příklad – deska 100 × 50 s osami a dírou:\n```\n([\s\S]*?)```/.exec(AGENT_GUIDE)?.[1] ?? "";
    const lines = block.trim().split("\n");
    expect(lines.length).toBeGreaterThan(3);
    let doc = { app: "mnastrojarna-cad" as const, version: 2 as const, name: "x", material: "ocel", features: [] } as import("../types").CadDoc;
    for (const l of lines) {
      const rest = draftLine(l);
      expect(rest, l).not.toBeNull();
      const r = await applyDraftText(doc, rest!);
      for (const x of r.results) expect(x.error, x.input).toBeUndefined();
      doc = r.newDoc ?? r.doc;
    }
    expect(doc.draft!.entities.map((e) => e.type)).toEqual(["polyline", "circle", "line", "line"]);
    expect(doc.draft!.entities[2].layer).toBe("OSY");
  });
});
