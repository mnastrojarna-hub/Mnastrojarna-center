import { beforeEach, describe, expect, it } from "vitest";
import { setLang } from "../../i18n";
import "../index";
import { CmdRun, findCommand, runScript, runScriptAsync } from "../commands";
import { cClosest, cPoint, cDeriv } from "../curves";
import { newDraftModel } from "../doc";
import { angleOf, bulgeArc, cross, dist, dot, len, sub, unit } from "../geom";
import { entityCurves } from "../kinds";
import { polylineArea } from "../kinds-core";
import { setLayer, createLayer } from "../layers";
import type { DArc, DCircle, DLine, DPolyline, DSpline, DraftEntity, DraftModel, Vec2 } from "../model";
import { sessionFor, setSelection, type DraftSession } from "../session";
import { applyDraftText, draftLine } from "../agent";
import { EDIT_STATE, MOD } from "./shared";
import { joinNurbs, nurbsAt, reverseNurbs, splitNurbs, subNurbs, toBeziers, elevateBezier, chainBeziers } from "./nurbs";
import { editCurve } from "./param";

const closeP = (p: Vec2, q: Vec2, eps = 1e-9) => expect(dist(p, q), `${p} vs ${q}`).toBeLessThan(eps);
const near = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThan(eps);
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
const ids = () => m.entities.map((e) => e.id);
/** nový prázdný výkres (id entit znovu od e1) */
const reset = () => {
  m = newDraftModel();
  s = sessionFor(m);
};
const resetState = () => {
  Object.assign(EDIT_STATE, { filletRad: 0, trimMode: true, chamA: 0, chamB: 0, chamLen: 0, chamAng: 0, chamByAngle: false, offsetDist: 1, offsetThrough: false, offsetErase: false, offsetLayerCurrent: false, edgeExtend: false, quick: true });
  MOD.shift = false;
  for (const k of Object.keys(EDIT_STATE.match)) EDIT_STATE.match[k] = true;
};

beforeEach(() => {
  setLang("cs");
  m = newDraftModel();
  s = sessionFor(m);
  resetState();
});

describe("registr: názvy CS / EN / DE a zkratky ze smlouvy", () => {
  it("všechny příkazy balíku jsou dostupné ve třech jazycích + zkratky", () => {
    const table: [string, string[]][] = [
      ["MOVE", ["posun", "move", "schieben", "M"]],
      ["COPY", ["kopie", "copy", "kopieren", "CO", "CP"]],
      ["ROTATE", ["otočit", "rotate", "drehen", "RO"]],
      ["SCALE", ["změnit-měřítko", "scale", "varia", "SC"]],
      ["MIRROR", ["zrcadlit", "mirror", "spiegeln", "MI"]],
      ["OFFSET", ["ekvidistanta", "offset", "versetz", "O"]],
      ["TRIM", ["oříznout", "trim", "stutzen", "TR"]],
      ["EXTEND", ["prodloužit", "extend", "dehnen", "EX"]],
      ["FILLET", ["zaoblit", "fillet", "abrunden", "F"]],
      ["CHAMFER", ["zkosit", "chamfer", "fase", "CHA"]],
      ["BREAK", ["přerušit", "break", "bruch", "BR"]],
      ["BREAKATPOINT", ["přerušit-v-bodě", "breakatpoint", "bruchpunkt"]],
      ["JOIN", ["spojit", "join", "verbinden", "J"]],
      ["EXPLODE", ["rozložit", "explode", "ursprung", "X"]],
      ["STRETCH", ["protáhnout", "stretch", "strecken", "S"]],
      ["ARRAY", ["pole", "array", "reihe", "AR"]],
      ["ARRAYRECT", ["arrayrect"]],
      ["ARRAYPOLAR", ["arraypolar"]],
      ["ARRAYPATH", ["arraypath"]],
      ["LENGTHEN", ["prodloužení", "lengthen", "länge", "LEN"]],
      ["ALIGN", ["zarovnat-objekty", "align", "ausrichten", "AL"]],
      ["PEDIT", ["upravit-křivku", "pedit", "PE"]],
      ["SPLINEDIT", ["upravit-spline", "splinedit", "splineedit", "SPE"]],
      ["MATCHPROP", ["přenést-vlastnosti", "matchprop", "eigübertrag", "MA"]],
      ["DRAWORDER", ["pořadí", "draworder", "zeichreihenf", "DR"]],
      ["OVERKILL", ["odstranit-duplicity", "overkill"]],
      ["DIVIDE", ["rozdělit", "divide", "teilen", "DIV"]],
      ["MEASURE", ["rozměřit", "measure", "messen", "ME"]],
      ["REVERSE", ["obrátit", "reverse", "umkehren"]],
      ["GRIPEDIT", ["úchop", "gripedit", "griff"]],
    ];
    for (const [id, names] of table) for (const n of names) expect(findCommand(n)?.id, n).toBe(id);
  });
});

describe("transformace", () => {
  it("POSUN, KOPIE (vícenásobná, pole), OTOČIT (reference), MĚŘÍTKO (reference), ZRCADLIT – přesně", () => {
    ok("čára 0,0 100,0");
    ok("posun e1 0,0 10,5");
    closeP(ent<DLine>("e1").a, [10, 5]);
    closeP(ent<DLine>("e1").b, [110, 5]);
    ok("kopie e1 0,0 0,10 0,20");
    expect(m.entities.length).toBe(3);
    closeP(ent<DLine>("e3").a, [10, 25]);
    ok("kopie e1 0,0 pole 4 0,-10");
    expect(m.entities.length).toBe(6);
    closeP((m.entities[5] as DLine).a, [10, -25]);
    reset();
    ok("čára 0,0 100,0");
    const id = m.entities[0].id;
    ok(`otočit ${id} 0,0 90`);
    closeP(ent<DLine>(id).b, [0, 100], 1e-12);
    ok(`otočit ${id} 0,0 reference 90 45`);
    closeP(ent<DLine>(id).b, [100 * Math.SQRT1_2, 100 * Math.SQRT1_2], 1e-12);
    ok(`změnit-měřítko ${id} 0,0 2`);
    near(dist(ent<DLine>(id).a, ent<DLine>(id).b), 200, 1e-12);
    ok(`změnit-měřítko ${id} 0,0 reference 200 50`);
    near(dist(ent<DLine>(id).a, ent<DLine>(id).b), 50, 1e-12);
    ok(`otočit ${id} 0,0 kopie 45`);
    expect(m.entities.length).toBe(2);
    reset();
    ok("kružnice 30,10 5; text 30,10 2.5 0 \"AB\"");
    const [ci, ti] = ids();
    ok(`zrcadlit ${ci} ${ti} 0,0 0,1 ne`);
    expect(m.entities.length).toBe(4);
    closeP((m.entities[2] as DCircle).c, [-30, 10]);
    // text zůstane čitelný (MIRRTEXT 0): směr textu kladný v X
    const t = m.entities[3] as { rot?: number };
    expect(Math.cos(((t.rot ?? 0) * Math.PI) / 180)).toBeGreaterThan(0);
    ok(`zrcadlit ${ci} 0,0 1,0 ano`);
    closeP(ent<DCircle>(ci).c, [30, -10]);
  });
  it("ZAROVNAT-OBJEKTY dvěma páry (otočení a měřítko)", () => {
    ok("čára 0,0 10,0");
    ok("zarovnat-objekty e1 0,0 5,5 10,0 5,25 ano");
    closeP(ent<DLine>("e1").a, [5, 5], 1e-12);
    closeP(ent<DLine>("e1").b, [5, 25], 1e-12);
  });
  it("PROTÁHNOUT křížícím oknem: konce uvnitř se posunou, celé uvnitř se přesune, oblouk drží vzepětí", () => {
    ok("obdélník 0,0 100,50; čára 0,60 100,60; kružnice 95,25 2; oblouk 100,70 120,80 140,70");
    const [pl, ln, ci, ar] = ids();
    const arcBefore = ent<DArc>(ar);
    const h0 = arcBefore.r - Math.sqrt(arcBefore.r ** 2 - (dist([100, 70], [140, 70]) / 2) ** 2);
    ok("protáhnout 90,-10 145,75 0,0 20,0");
    const p = ent<DPolyline>(pl);
    closeP(p.pts[1], [120, 0]);
    closeP(p.pts[2], [120, 50]);
    closeP(p.pts[0], [0, 0]);
    closeP(ent<DLine>(ln).b, [120, 60]);
    closeP(ent<DLine>(ln).a, [0, 60]);
    closeP(ent<DCircle>(ci).c, [115, 25]);
    // oblouk: oba konce venku? (100,70) uvnitř okna (x ≥ 90), (140,70) uvnitř → celý posun
    closeP(ent<DArc>(ar).c, [arcBefore.c[0] + 20, arcBefore.c[1]]);
    void h0;
    reset();
    ok("oblouk 0,0 20,10 40,0");
    const a2 = ids()[0];
    const A = ent<DArc>(a2);
    const sag = A.r - Math.sqrt(A.r * A.r - 400);
    ok("protáhnout 35,-5 45,5 0,0 10,0");
    const B = ent<DArc>(a2);
    const ends = editCurve(B, { model: m })!;
    const se = [ends.at(ends.lo), ends.at(ends.hi)].sort((a, b) => a[0] - b[0]);
    closeP(se[0], [0, 0], 1e-9);
    closeP(se[1], [50, 0], 1e-9);
    const sag2 = B.r - Math.sqrt(B.r * B.r - 625);
    near(sag2, sag, 1e-9);
  });
  it("ÚCHOP: protáhnout koncový bod, posun, otočit, Enter = další režim, kopie", () => {
    ok("čára 0,0 100,0");
    ok("úchop e1 100,0 150,20");
    closeP(ent<DLine>("e1").b, [150, 20]);
    ok('úchop e1 0,0 "" 10,10');
    closeP(ent<DLine>("e1").a, [10, 10]);
    closeP(ent<DLine>("e1").b, [160, 30]);
    ok("úchop e1 10,10 otočit 90");
    closeP(ent<DLine>("e1").b, [-10, 160], 1e-9);
    ok("úchop e1 10,10 posun kopie 20,10 30,10");
    expect(m.entities.length).toBe(3);
    // kružnice: úchop kvadrantu mění poloměr
    ok("kružnice 0,0 10");
    const c = ids()[3];
    ok(`úchop ${c} 10,0 25,0`);
    near(ent<DCircle>(c).r, 25);
  });
  it("PŘENÉST-VLASTNOSTI a POŘADÍ", () => {
    m = createLayer(m, "OSY", { color: 1 });
    ok("čára 0,0 1,0; čára 0,1 1,1; vlastnosti e1 hladina OSY barva 3 typčáry DASHED tloušťka 0.5");
    ok("přenést-vlastnosti e1 e2");
    const e2 = ent<DLine>("e2");
    expect([e2.layer, e2.color, e2.linetype, e2.lineweight]).toEqual(["OSY", 3, "DASHED", 0.5]);
    ok("přenést-vlastnosti nastavení nic hladina \"\" e2 e1");
    ok("pořadí e2 dozadu");
    expect(ids()).toEqual(["e2", "e1"]);
    ok("pořadí e2 dopředu");
    expect(ids()).toEqual(["e1", "e2"]);
  });
});

describe("ořez a prodloužení – přesnost", () => {
  it("OŘÍZNOUT úsečku kružnicí: konec přesně na kružnici", () => {
    ok("čára -100,0 100,0; kružnice 0,0 30");
    ok("oříznout e1@0,0");
    // střední díl odebrán → dvě úsečky končí přesně na ±30
    const ls = m.entities.filter((e) => e.type === "line") as DLine[];
    expect(ls.length).toBe(2);
    closeP(ls[0].b, [-30, 0], 1e-12);
    closeP(ls[1].a, [30, 0], 1e-12);
    // šikmá úsečka a kružnice: bod průniku na kružnici do 1e-12
    reset();
    ok("čára 0,0 100,37; kružnice 40,10 25");
    const [l] = ids();
    ok(`oříznout ${l}@95,35`);
    const L = ent<DLine>(l);
    near(dist(L.b, [40, 10]), 25, 1e-12);
  });
  it("OŘÍZNOUT kružnici dvěma úsečkami → oblouk; standardní hrany; plot; zpět", () => {
    ok("kružnice 0,0 10; čára -20,5 20,5; čára -20,-5 20,-5");
    ok("oříznout e1@0,10");
    const a = ent<DArc>("e1");
    expect(a.type).toBe("arc");
    near(a.r, 10);
    // oblouk vynechává horní část nad y = 5
    const ec = editCurve(a, { model: m })!;
    near(ec.at(ec.lo)[1], 5, 1e-12);
    reset();
    ok("čára 0,0 100,0; čára 50,-10 50,10; čára 70,-10 70,10");
    ok("oříznout řezné-hrany e2 e1@80,0");
    closeP(ent<DLine>("e1").b, [50, 0]);
    reset();
    ok("čára 0,0 100,0; čára 50,-10 50,10; čára 70,-10 70,10");
    ok("oříznout řezné-hrany e2 \"\" e1@80,0");
    closeP(ent<DLine>("e1").b, [50, 0]);
    reset();
    ok("čára 0,0 100,0; čára 0,10 100,10; čára 50,-20 50,20");
    ok("oříznout plot 60,-5 60,15 hotovo");
    expect(ent<DLine>("e1").b[0]).toBe(50);
    expect(ent<DLine>("e2").b[0]).toBe(50);
    const before = m;
    const r = new CmdRun(findCommand("TR")!, m, s, { interactive: true });
    r.start();
    r.feed({ k: "ent", id: "e1", p: [20, 0] });
    r.feedText("_undo");
    r.feed({ k: "none" });
    expect(r.done).toBe(true);
    expect(JSON.stringify(r.tx.model.entities)).toBe(JSON.stringify(before.entities));
  });
  it("PRODLOUŽIT úsečku k oblouku: koncový bod přesně na oblouku; Shift = ořez", () => {
    ok("čára 0,0 50,0; oblouk 100,-50 130,0 100,50");
    ok("prodloužit e1@45,0");
    const L = ent<DLine>("e1");
    const A = ent<DArc>("e2");
    near(dist(L.b, A.c), A.r, 1e-12);
    near(L.b[1], 0, 1e-12);
    // prodloužené hrany (EDGEMODE): úsečka k prodloužení jiné úsečky
    reset();
    ok("čára 0,0 10,0; čára 50,5 50,30");
    ok("prodloužit hrana prodloužit e1@9,0");
    closeP(ent<DLine>("e1").b, [50, 0], 1e-12);
    // oblouk prodloužen k úsečce
    EDIT_STATE.edgeExtend = false;
    reset();
    ok("oblouk 10,0 0,10 -10,0; čára -20,-5 20,-5");
    const arc = ids()[0];
    ok(`prodloužit ${arc}@-9,1`);
    const ar = ent<DArc>(arc);
    const ec = editCurve(ar, { model: m })!;
    near(ec.at(ec.hi)[1], -5, 1e-12);
    near(dist(ec.at(ec.hi), ar.c), 10, 1e-12);
    // Shift v GUI = opačná operace
    reset();
    ok("čára 0,0 100,0; čára 50,-10 50,10");
    const r = new CmdRun(findCommand("EX")!, m, s, { interactive: true });
    r.start();
    MOD.shift = true;
    r.feed({ k: "ent", id: ids()[0], p: [80, 0] });
    MOD.shift = false;
    r.feed({ k: "none" });
    closeP((r.tx.model.entities[0] as DLine).b, [50, 0]);
  });
});

describe("ekvidistanta", () => {
  it("úsečka, kružnice, oblouk přesně; Bodem", () => {
    ok("čára 0,0 100,0; kružnice 0,0 10; oblouk 20,0 0,20 -20,0");
    ok("ekvidistanta 5 e1 50,10");
    const l = m.entities[3] as DLine;
    closeP(l.a, [0, 5]);
    closeP(l.b, [100, 5]);
    ok("ekvidistanta 3 e2 0,0");
    near((m.entities[4] as DCircle).r, 7);
    ok("ekvidistanta 3 e3 0,50");
    near((m.entities[5] as DArc).r, 23);
    ok("ekvidistanta bodem e1 0,-7");
    closeP((m.entities[6] as DLine).a, [0, -7]);
  });
  it("křivka s oblouky (zaoblený obdélník): ven i dovnitř přesně – délka a plocha", () => {
    ok("obdélník zaoblení 5 0,0 100,50");
    const pl = ent<DPolyline>("e1");
    const L0 = entityCurves(pl, { model: m }).reduce((a, c) => a + (c.k === "line" ? dist(c.a, c.b) : c.k === "arc" ? c.r * c.sweep : 0), 0);
    ok("ekvidistanta 2 e1 200,200");
    const out = m.entities[1] as DPolyline;
    const L1 = entityCurves(out, { model: m }).reduce((a, c) => a + (c.k === "line" ? dist(c.a, c.b) : c.k === "arc" ? c.r * c.sweep : 0), 0);
    near(L1, L0 + 2 * Math.PI * 2, 1e-9);
    near(Math.abs(polylineArea(out)), Math.abs(polylineArea(pl)) + L0 * 2 + Math.PI * 4, 1e-9);
    ok("ekvidistanta 3 e1 50,25");
    const inn = m.entities[2] as DPolyline;
    // oblouky r 5 → 2, rovné úseky zkrácené o 2×3
    const arcs = entityCurves(inn, { model: m }).filter((c) => c.k === "arc");
    expect(arcs.length).toBe(4);
    for (const a of arcs) if (a.k === "arc") near(a.r, 2, 1e-12);
    // dovnitř o víc než poloměr: oblouky zaniknou, rohy ostré
    ok("ekvidistanta 8 e1 50,25");
    const sharp = m.entities[3] as DPolyline;
    expect(sharp.bulges?.some((b) => Math.abs(b) > 1e-12) ?? false).toBe(false);
    near(Math.abs(polylineArea(sharp)), 84 * 34, 1e-9);
  });
  it("otevřená lomená křivka: ostré rohy v průsečíku rovnoběžek", () => {
    ok("křivka 0,0 100,0 100,100");
    ok("ekvidistanta 10 e1 50,50");
    const p = m.entities[1] as DPolyline;
    closeP(p.pts[0], [0, 10]);
    closeP(p.pts[1], [90, 10]);
    closeP(p.pts[2], [90, 100]);
  });
  it("elipsa a spline → spline ve správné vzdálenosti", () => {
    ok("elipsa střed 0,0 50,0 25");
    ok("ekvidistanta 5 e1 0,0");
    const sp = m.entities[1] as DSpline;
    expect(sp.type).toBe("spline");
    // vzorky ekvidistanty: vzdálenost od elipsy ≈ 5
    const ell = entityCurves(m.entities[0], { model: m })[0];
    const sc = { k: "nurbs" as const, deg: sp.degree, ctrl: sp.ctrl, knots: sp.knots };
    for (let i = 0; i < 20; i++) {
      const p = cPoint(sc, sp.knots[3] + ((sp.knots[sp.ctrl.length] - sp.knots[3]) * i) / 20);
      near(cClosest(ell, p).d, 5, 1e-4);
    }
  });
});

describe("zaoblení a zkosení", () => {
  it("dvě úsečky: přesný poloměr, tečnost, oříznutí", () => {
    ok("čára 0,0 100,0; čára 0,0 0,100");
    ok("zaoblit poloměr 10 e1@50,0 e2@0,50");
    const a = m.entities[2] as DArc;
    expect(a.type).toBe("arc");
    near(a.r, 10, 1e-12);
    closeP(a.c, [10, 10], 1e-12);
    closeP(ent<DLine>("e1").a, [10, 0], 1e-12);
    closeP(ent<DLine>("e2").a, [0, 10], 1e-12);
    // tečnost: poloměr ve dotykovém bodě kolmý na úsečku
    const ec = editCurve(a, { model: m })!;
    const ts = [ec.at(ec.lo), ec.at(ec.hi)].sort((p, q) => p[1] - q[1]);
    closeP(ts[0], [10, 0], 1e-12);
    closeP(ts[1], [0, 10], 1e-12);
    // tečnost: poloměr v bodě dotyku kolmý na úsečku
    near(dot(sub(ts[0], a.c), [1, 0]), 0, 1e-12);
    near(dot(sub(ts[1], a.c), [0, 1]), 0, 1e-12);
    // oblouk je kratší (90°)
    near(ec.hi - ec.lo, Math.PI / 2, 1e-12);
  });
  it("šikmé úsečky (60°): střed na ose úhlu, vzdálenost středu od obou = r", () => {
    ok("čára 0,0 100,0; čára 0,0 50,86.60254037844386");
    ok("zaoblit poloměr 7 e1@60,0 e2@30,50");
    const a = m.entities[2] as DArc;
    const l1 = ent<DLine>("e1");
    const l2 = ent<DLine>("e2");
    const distTo = (p: Vec2, l: DLine) => Math.abs(cross(unit(sub(l.b, l.a)), sub(p, l.a)));
    near(distTo(a.c, l1), 7, 1e-12);
    near(distTo(a.c, l2), 7, 1e-12);
    near(angleOf(a.c), Math.PI / 6, 1e-12);
  });
  it("poloměr 0 = roh, rovnoběžky = půlkružnice, úsečka a oblouk, křivka všechny vrcholy, Neoříznout", () => {
    ok("čára 0,0 90,0; čára 100,10 100,90");
    ok("zaoblit poloměr 0 e1 e2");
    closeP(ent<DLine>("e1").b, [100, 0], 1e-12);
    closeP(ent<DLine>("e2").a, [100, 0], 1e-12);
    reset();
    ok("čára 0,0 100,0; čára 0,20 80,20");
    const [p1, p2] = ids();
    ok(`zaoblit ${p1}@95,0 ${p2}@75,20`);
    const semi = m.entities[2] as DArc;
    near(semi.r, 10);
    closeP(semi.c, [100, 10]);
    closeP(ent<DLine>(p2).b, [100, 20]);
    reset();
    ok("čára -50,20 50,20; kružnice 0,0 10");
    const [ln, cr] = ids();
    ok(`zaoblit poloměr 5 ${ln}@-30,20 ${cr}@-7,7`);
    const fa = m.entities[2] as DArc;
    near(dist(fa.c, [0, 0]), 15, 1e-9);
    near(Math.abs(fa.c[1] - 20), 5, 1e-9);
    reset();
    ok("obdélník 0,0 100,50");
    const pl = ids()[0];
    ok(`zaoblit poloměr 5 křivka ${pl}`);
    const P = ent<DPolyline>(pl);
    expect(P.pts.length).toBe(8);
    near(Math.abs(polylineArea(P)), 100 * 50 - (4 - Math.PI) * 25, 1e-9);
    reset();
    ok("čára 0,0 100,0; čára 0,0 0,100");
    ok("zaoblit oříznout neoříznout poloměr 10 e1@50,0 e2@0,50");
    closeP(m.entities[0] && (m.entities[0] as DLine).a, [0, 0]);
    expect(m.entities.length).toBe(3);
  });
  it("ZKOSIT: vzdálenosti, úhel, dva úseky křivky", () => {
    ok("čára 0,0 100,0; čára 0,0 0,100");
    ok("zkosit vzdálenost 10 20 e1@50,0 e2@0,50");
    closeP(ent<DLine>("e1").a, [10, 0]);
    closeP(ent<DLine>("e2").a, [0, 20]);
    const ch = m.entities[2] as DLine;
    closeP(ch.a, [10, 0]);
    closeP(ch.b, [0, 20]);
    reset();
    ok("čára 0,0 100,0; čára 0,0 0,100");
    const [a, b] = ids();
    ok(`zkosit úhel 10 30 ${a}@50,0 ${b}@0,50`);
    closeP(ent<DLine>(b).a, [0, 10 * Math.tan(Math.PI / 6)], 1e-12);
    reset();
    ok("křivka 0,0 100,0 100,100");
    const pl = ids()[0];
    ok(`zkosit vzdálenost 5 5 ${pl}@50,0 ${pl}@100,50`);
    const P = ent<DPolyline>(pl);
    expect(P.pts.length).toBe(4);
    closeP(P.pts[1], [95, 0]);
    closeP(P.pts[2], [100, 5]);
  });
});

describe("pole", () => {
  it("polární 6× = úhly po 60° přesně", () => {
    ok("čára 10,0 20,0");
    ok("pole-polární e1 0,0 6 360 ano");
    const ls = m.entities as DLine[];
    expect(ls.length).toBe(6);
    ls.forEach((l, k) => {
      const a = (angleOf(l.a) * 180) / Math.PI;
      near(((a % 360) + 360) % 360, k * 60, 1e-9);
      near(len(l.a), 10, 1e-12);
    });
    ok("pole e1 polární 0,0 4 90 ne");
    expect(m.entities.length).toBe(9);
  });
  it("obdélníkové 4 × 3, po dráze (rozdělit, zarovnat), ROZDĚLIT a ROZMĚŘIT body", () => {
    ok("kružnice 0,0 1");
    ok("pole-obdélníkové e1 4 3 10 20");
    expect(m.entities.length).toBe(12);
    closeP((m.entities[11] as DCircle).c, [30, 40]);
    reset();
    ok("čára 0,0 100,0; čára 0,0 0,5");
    ok("pole-po-dráze e2 \"\" e1 rozdělit 5 ano");
    const items = m.entities.slice(2) as DLine[];
    expect(items.length).toBe(4);
    closeP(items[3].a, [100, 0]);
    reset();
    ok("oblouk 10,0 0,10 -10,0");
    ok("rozdělit e1 4");
    const pts = m.entities.filter((e) => e.type === "point") as { p: Vec2 }[];
    expect(pts.length).toBe(3);
    closeP(pts[1].p, [0, 10], 1e-9);
    reset();
    ok("čára 0,0 100,0");
    ok("rozměřit e1@0,0 30");
    const mp = m.entities.filter((e) => e.type === "point") as { p: Vec2 }[];
    expect(mp.map((p) => p.p[0])).toEqual([30, 60, 90]);
    reset();
    ok("čára 0,0 100,0");
    ok("rozměřit e1@100,0 30");
    expect((m.entities.filter((e) => e.type === "point") as { p: Vec2 }[]).map((p) => Math.round(p.p[0] * 1e9) / 1e9)).toEqual([70, 40, 10]);
  });
});

describe("přerušit, spojit, rozložit, prodloužení, obrátit, duplicity", () => {
  it("PŘERUŠIT úsečku a kružnici, PŘERUŠIT-V-BODĚ", () => {
    ok("čára 0,0 100,0");
    ok("přerušit e1@20,0 60,0");
    const ls = m.entities as DLine[];
    expect(ls.length).toBe(2);
    closeP(ls[0].b, [20, 0]);
    closeP(ls[1].a, [60, 0]);
    reset();
    ok("kružnice 0,0 10");
    const c = ids()[0];
    ok(`přerušit ${c} první 10,0 0,10`);
    const a = ent<DArc>(c);
    expect(a.type).toBe("arc");
    near(a.a0, 90);
    near(a.a1, 0);
    reset();
    ok("čára 0,0 100,0");
    ok("přerušit-v-bodě e1 40,0");
    expect(m.entities.length).toBe(2);
    closeP((m.entities[0] as DLine).b, [40, 0]);
    closeP((m.entities[1] as DLine).a, [40, 0]);
    expect(run(`přerušit-v-bodě ${ids()[0]} 0,0`)[0].ok).toBe(false);
  });
  it("SPOJIT: kolineární úsečky, oblouky → kružnice, řetěz → křivka, spline + úsečka", () => {
    ok("čára 0,0 10,0; čára 15,0 30,0");
    ok("spojit e1 e2");
    expect(m.entities.length).toBe(1);
    closeP(ent<DLine>("e1").b, [30, 0]);
    reset();
    ok("oblouk 10,0 0,10 -10,0; oblouk -10,0 0,-10 10,0");
    const [a1, a2] = ids();
    ok(`spojit ${a1} ${a2}`);
    expect(m.entities.length).toBe(1);
    expect(m.entities[0].type).toBe("circle");
    reset();
    ok("čára 0,0 100,0; oblouk 100,0 125,25 100,50; čára 100,50 0,50; čára 0,50 0,0");
    const ch = ids();
    ok(`spojit ${ch.join(" ")}`);
    expect(m.entities.length).toBe(1);
    const P = m.entities[0] as DPolyline;
    expect(P.type).toBe("polyline");
    expect(P.closed).toBe(true);
    near(Math.abs(polylineArea(P)), 5000 + (Math.PI * 625) / 2, 1e-9);
    reset();
    ok("spline 0,0 10,10 20,0; čára 20,0 40,0");
    const [sp, ln] = ids();
    ok(`spojit ${sp} ${ln}`);
    const J = m.entities[0] as DSpline;
    expect(J.type).toBe("spline");
    const N = { deg: J.degree, ctrl: J.ctrl, knots: J.knots };
    closeP(nurbsAt(N, J.knots[J.knots.length - 1]), [40, 0], 1e-9);
    closeP(nurbsAt(N, J.knots[0]), [0, 0], 1e-9);
  });
  it("ROZLOŽIT křivku na úsečky a oblouky; PEDIT převod, uzavřít, šířka, proložit, vyrovnat, spline, vrcholy", () => {
    ok("křivka 0,0 100,0 oblouk 100,50 úsečka 0,50 uzavřít");
    ok("rozložit e1");
    expect(m.entities.map((e) => e.type).sort()).toEqual(["arc", "line", "line", "line"]);
    reset();
    ok("čára 0,0 10,0");
    const l = ids()[0];
    ok(`upravit-křivku ${l} ano šířka 0.5`);
    expect(ent<DPolyline>(l).type).toBe("polyline");
    expect(ent<DPolyline>(l).width).toBe(0.5);
    reset();
    ok("křivka 0,0 10,10 20,0 30,10");
    const p = ids()[0];
    ok(`upravit-křivku ${p} uzavřít`);
    expect(ent<DPolyline>(p).closed).toBe(true);
    ok(`upravit-křivku ${p} otevřít proložit`);
    const F = ent<DPolyline>(p);
    // proložená křivka prochází původními vrcholy
    for (const v of [[0, 0], [10, 10], [20, 0], [30, 10]] as Vec2[]) expect(F.pts.some((q) => dist(q, v) < 1e-12)).toBe(true);
    // spojitost tečen v napojení oblouků
    const cs = entityCurves(F, { model: m });
    for (let i = 1; i < cs.length; i++) {
      const t0 = unit(cDeriv(cs[i - 1], cs[i - 1].k === "arc" ? (cs[i - 1] as { sweep: number }).sweep : 1));
      const t1 = unit(cDeriv(cs[i], 0));
      const rev0 = (cs[i - 1] as { rev?: boolean }).rev ? -1 : 1;
      const rev1 = (cs[i] as { rev?: boolean }).rev ? -1 : 1;
      if (rev0 === 1 && rev1 === 1) near(Math.abs(cross(t0, t1)), 0, 1e-9);
    }
    ok(`upravit-křivku ${p} vyrovnat`);
    // Vyrovnat po Proložit vrátí původní vrcholy (jako AutoCAD), ne jen narovná úseky přes body proložení
    expect(ent<DPolyline>(p).bulges).toBeUndefined();
    expect(ent<DPolyline>(p).pts).toEqual([[0, 0], [10, 10], [20, 0], [30, 10]]);
    expect(ent<DPolyline>(p).ext?.pedit).toBeUndefined();
    ok(`upravit-křivku ${p} vložit-vrchol 2,2`);
    expect(ent<DPolyline>(p).pts.length).toBe(5);
    ok(`upravit-křivku ${p} odebrat-vrchol 2,2`);
    expect(ent<DPolyline>(p).pts.length).toBe(4);
    ok(`upravit-křivku ${p} spline`);
    expect(ent<DSpline>(p).type).toBe("spline");
  });
  it("PRODLOUŽENÍ: delta, celkem, procenta, úhel oblouku; výpis délky", () => {
    ok("čára 0,0 100,0");
    const r = ok("prodloužení e1");
    expect(r[0].data?.length).toBe(100);
    ok("prodloužení delta 10 e1@95,0");
    closeP(ent<DLine>("e1").b, [110, 0]);
    ok("prodloužení celkem 50 e1@100,0");
    closeP(ent<DLine>("e1").b, [50, 0]);
    ok("prodloužení procenta 200 e1@1,0");
    closeP(ent<DLine>("e1").a, [-50, 0]);
    reset();
    ok("oblouk střed 0,0 10,0 0,10");
    const a = ids()[0];
    ok(`prodloužení delta úhel 30 ${a}@0,10`);
    near(ent<DArc>(a).a1, 120, 1e-9);
    ok(`prodloužení celkem úhel 45 ${a}@0,10`);
    near(ent<DArc>(a).a1, 45, 1e-9);
  });
  it("OBRÁTIT a ODSTRANIT-DUPLICITY", () => {
    ok("křivka 0,0 10,0 oblouk 10,10");
    const p = ids()[0];
    const before = ent<DPolyline>(p);
    ok(`obrátit ${p}`);
    const after = ent<DPolyline>(p);
    closeP(after.pts[0], before.pts[before.pts.length - 1]);
    near(after.bulges![0], -before.bulges![1]);
    reset();
    ok("čára 0,0 10,0; čára 10,0 0,0; čára 5,0 20,0; kružnice 0,0 5; kružnice 0,0 5; čára 0,0 0,0");
    ok("odstranit-duplicity vše");
    const ls = m.entities.filter((e) => e.type === "line") as DLine[];
    expect(ls.length).toBe(1);
    closeP(ls[0].a, [0, 0]);
    closeP(ls[0].b, [20, 0]);
    expect(m.entities.filter((e) => e.type === "circle").length).toBe(1);
  });
});

describe("zamčená hladina, PICKFIRST, jeden krok, text CZ / EN / DE", () => {
  it("zamčená hladina se nemění, ostatní ano", () => {
    m = createLayer(m, "Z");
    ok("čára 0,0 10,0; čára 0,5 10,5; vlastnosti e2 hladina Z");
    m = setLayer(m, "Z", { locked: true });
    const r = ok("posun e1 e2 0,0 0,100");
    expect(r[0].log.join("\n")).toMatch(/zamčené/);
    closeP(ent<DLine>("e1").a, [0, 100]);
    closeP(ent<DLine>("e2").a, [0, 5]);
    expect(run("oříznout e2@1,5")[0].log.join(" ")).toMatch(/zamčené/);
    expect(run("zaoblit e1 e2")[0].ok).toBe(false);
  });
  it("PICKFIRST: v GUI použije výběr, v textu prázdný výběr = aktuální výběr", () => {
    ok("čára 0,0 10,0; čára 0,5 10,5");
    setSelection(s, ["e2"]);
    const r = new CmdRun(findCommand("posun")!, m, s, { interactive: true });
    r.start();
    expect(r.prompt?.k).toBe("point");
    r.feed({ k: "point", p: [0, 0] });
    r.feed({ k: "point", p: [5, 5] });
    expect(r.done).toBe(true);
    closeP((r.tx.model.entities[1] as DLine).a, [5, 10]);
    closeP((r.tx.model.entities[0] as DLine).a, [0, 0]);
    expect(s.sel).toEqual([]);
    setSelection(s, ["e1"]);
    ok("posun 0,0 1,0");
    closeP(ent<DLine>("e1").a, [1, 0]);
    // explicitní výběr v textu má přednost před výběrem relace
    ok("posun e2 0,0 0,1");
    closeP(ent<DLine>("e2").a, [0, 6]);
    setSelection(s, []);
    expect(run("posun 0,0 1,0")[0].ok).toBe(false);
  });
  it("chyba = atomicky nic, jeden příkaz = jeden krok", () => {
    ok("čára 0,0 10,0");
    const m0 = m;
    expect(run("oříznout e9@1,1")[0].ok).toBe(false);
    expect(m).toBe(m0);
  });
  it("anglicky a německy (názvy příkazů i volby)", () => {
    setLang("en");
    ok("line 0,0 100,0; line 0,0 0,100");
    ok("fillet radius 10 e1@50,0 e2@0,50");
    near((m.entities[2] as DArc).r, 10);
    ok("move e1 e2 e3 0,0 10,10; rotate e1 10,10 copy 90; offset 5 e1 50,50");
    setLang("de");
    ok("schieben e1 0,0 5,0; kopieren e1 0,0 0,10; spiegeln e1 0,0 1,0 nein; abrunden radius 0 e1 e2; stutzen e1@99,10");
    ok("reihepolar e1 0,0 3 360 ja");
    setLang("cs");
  });
  it("2d text pro agenty a window API (applyDraftText)", async () => {
    let doc = { app: "mnastrojarna-cad" as const, version: 2 as const, name: "x", material: "ocel", features: [] } as import("../../types").CadDoc;
    for (const l of ["2d nový Test", "2d čára 0,0 100,0; čára 0,0 0,100", "2d zaoblit poloměr 10 e1@50,0 e2@0,50"]) {
      const r = await applyDraftText(doc, draftLine(l)!);
      for (const x of r.results) expect(x.error, x.input).toBeUndefined();
      doc = r.newDoc ?? r.doc;
    }
    expect(doc.draft!.entities.map((e) => e.type)).toEqual(["line", "line", "arc"]);
    const rr = await runScriptAsync(doc.draft!, sessionFor(doc.draft!), "oříznout e1@99,0");
    expect(rr.results[0].ok).toBe(true);
  });
});

describe("NURBS: dělení, spojení, obrácení, Bézier, zvýšení stupně – tvar beze změny", () => {
  it("split / sub / join / reverse / toBeziers / elevate", () => {
    ok("spline 0,0 10,10 20,0 30,10 40,0");
    const sp = m.entities[0] as DSpline;
    const N = { deg: sp.degree, ctrl: sp.ctrl, knots: sp.knots };
    const lo = N.knots[3];
    const hi = N.knots[N.ctrl.length];
    const um = (lo + hi) * 0.37;
    const [L, R] = splitNurbs(N, um);
    closeP(nurbsAt(L!, L!.knots[L!.knots.length - 1]), nurbsAt(N, um), 1e-12);
    closeP(nurbsAt(R!, R!.knots[0]), nurbsAt(N, um), 1e-12);
    const J = joinNurbs(L!, R!);
    for (let i = 0; i <= 10; i++) {
      const u = lo + ((hi - lo) * i) / 10;
      closeP(nurbsAt(J, u), nurbsAt(N, u), 1e-9);
    }
    const S = subNurbs(N, lo + 1, hi - 1)!;
    closeP(nurbsAt(S, S.knots[0]), nurbsAt(N, lo + 1), 1e-12);
    const Rv = reverseNurbs(N);
    closeP(nurbsAt(Rv, Rv.knots[3]), nurbsAt(N, hi), 1e-12);
    const B = toBeziers(N);
    const E = chainBeziers(B.map(elevateBezier));
    expect(E.deg).toBe(4);
    const eLo = E.knots[4];
    const eHi = E.knots[E.ctrl.length];
    closeP(nurbsAt(E, eLo), nurbsAt(N, lo), 1e-12);
    closeP(nurbsAt(E, eHi), nurbsAt(N, hi), 1e-12);
  });
  it("OŘÍZNOUT spline úsečkou (Newton) a obloukem křivky (bulge)", () => {
    ok("spline 0,0 25,20 50,0 75,20 100,0; čára 50,-10 50,30");
    ok("oříznout e1@80,10");
    const sp = ent<DSpline>("e1");
    const N = { deg: sp.degree, ctrl: sp.ctrl, knots: sp.knots, ...(sp.weights ? { w: sp.weights } : {}) };
    near(nurbsAt(N, N.knots[N.knots.length - 1])[0], 50, 1e-9);
    reset();
    ok("křivka 0,0 100,0 oblouk 100,50; čára 110,-10 110,60");
    const [pl] = ids();
    ok(`oříznout ${pl}@125,25`);
    const P = ent<DPolyline>(pl);
    const last = P.pts[P.pts.length - 1];
    const arc = bulgeArc([100, 0], [100, 50], 1);
    near(dist(last, arc.c), arc.r, 1e-12);
    near(last[0], 110, 1e-12);
    const second = m.entities.find((e) => e.type === "polyline" && e.id !== pl) as DPolyline;
    near(second.pts[0][0], 110, 1e-12);
    closeP(second.pts[second.pts.length - 1], [100, 50], 1e-12);
  });
});

describe("návod pro AI – příklad úprav 2D", () => {
  it("příklad z agent-guide proběhne bez chyb a dá očekávaný výsledek", async () => {
    const { AGENT_GUIDE } = await import("../../agent-guide");
    const block = /Příklad – úpravy \(deska se zaoblenými rohy, otvory polárním polem, ekvidistanta\):\n```\n([\s\S]*?)```/.exec(AGENT_GUIDE)?.[1] ?? "";
    const lines = block.trim().split("\n");
    expect(lines.length).toBeGreaterThan(3);
    let doc = { app: "mnastrojarna-cad" as const, version: 2 as const, name: "x", material: "ocel", features: [] } as import("../../types").CadDoc;
    for (const l of lines) {
      const rest = draftLine(l);
      expect(rest, l).not.toBeNull();
      const r = await applyDraftText(doc, rest!);
      for (const x of r.results) expect(x.error, x.input).toBeUndefined();
      doc = r.newDoc ?? r.doc;
    }
    const ents = doc.draft!.entities;
    expect(ents.filter((e) => e.type === "circle").length).toBe(6);
    const outline = ents.find((e) => e.type === "polyline" && (e as DPolyline).closed) as DPolyline;
    expect(outline.bulges?.filter((b) => Math.abs(b) > 1e-12).length).toBe(4);
    expect(ents.filter((e) => e.type === "polyline").length).toBe(2);
  });
});

describe("mikronávody pásu karet (draft-edit.cs / en / de)", () => {
  it("každé tlačítko a položka nabídky karty Úpravy má návod ve třech jazycích a cmd je platný příkaz 2d", async () => {
    const { editUi } = await import("../../../components/cad/draft/ui-edit");
    const fakeApi = { command: () => undefined, session: { sel: [] } } as unknown as Parameters<NonNullable<typeof editUi.ribbon>>[0];
    const groups = editUi.ribbon!(fakeApi).modify ?? [];
    const ids = groups.flatMap((g) => g.items.flatMap((i) => [i.id, ...(i.menu ?? []).flatMap((x) => ("id" in x ? [x.id] : []))]));
    expect(ids.length).toBeGreaterThan(30);
    for (const lang of ["cs", "en", "de"]) {
      const tips = (await import(`../../help/tips/draft-edit.${lang}.ts`)).default as Record<string, { what: string; when: string; steps: string[]; cmd?: string }>;
      for (const id of ids) {
        const t = tips[`draft/${id}`];
        expect(t, `${lang} draft/${id}`).toBeTruthy();
        expect(t.steps.length).toBeGreaterThan(0);
        const rest = draftLine(t.cmd ?? "");
        expect(rest, `${lang} ${t.cmd}`).not.toBeNull();
        expect(findCommand(rest!.split(/\s+/)[0]), `${lang} ${t.cmd}`).toBeTruthy();
      }
    }
  });
});

describe("další případy", () => {
  it("OŘÍZNOUT přímku → dvě polopřímky / úsečka; prodloužení dynamicky; PŘERUŠIT uzavřenou křivku", () => {
    ok("přímka 0,0 1,0; čára 10,-5 10,5; čára 20,-5 20,5");
    ok("oříznout e1@15,0");
    const rays = m.entities.filter((e) => e.type === "ray") as { p: Vec2; dir: Vec2 }[];
    expect(rays.length).toBe(2);
    closeP(rays[0].p, [10, 0]);
    closeP(rays[1].p, [20, 0]);
    reset();
    ok("čára 0,0 100,0");
    ok("prodloužení dynamicky e1@95,0 130,7");
    closeP(ent<DLine>("e1").b, [130, 0]);
    reset();
    ok("obdélník 0,0 100,50");
    ok("přerušit e1@50,0 100,25");
    const P = ent<DPolyline>("e1");
    expect(P.closed ?? false).toBe(false);
    closeP(P.pts[0], [100, 25]);
    closeP(P.pts[P.pts.length - 1], [50, 0]);
  });
  it("UPRAVIT-SPLINE: zjemnit a zvýšit stupeň nemění tvar, uzavřít, posunout bod, na křivku", () => {
    ok("spline 0,0 10,10 20,0 30,10");
    const N0 = { ...((): { deg: number; ctrl: Vec2[]; knots: number[] } => { const s0 = ent<DSpline>("e1"); return { deg: s0.degree, ctrl: s0.ctrl, knots: s0.knots }; })() };
    const at = (sp: DSpline, f: number) => nurbsAt({ deg: sp.degree, ctrl: sp.ctrl, knots: sp.knots, ...(sp.weights ? { w: sp.weights } : {}) }, sp.knots[sp.degree] + (sp.knots[sp.ctrl.length] - sp.knots[sp.degree]) * f);
    const ref = [0.1, 0.33, 0.5, 0.77].map((f) => nurbsAt(N0, N0.knots[3] + (N0.knots[N0.ctrl.length] - N0.knots[3]) * f));
    ok("upravit-spline e1 zjemnit 15,5");
    expect(ent<DSpline>("e1").ctrl.length).toBe(N0.ctrl.length + 1);
    ok("upravit-spline e1 zvýšit-stupeň 4");
    const E = ent<DSpline>("e1");
    expect(E.degree).toBe(4);
    [0.1, 0.33, 0.5, 0.77].forEach((f, i) => {
      // parametr se změnil (délky tětiv), porovnat vzdáleností od původní křivky
      void ref[i];
      const p = at(E, f);
      const d = Math.min(...Array.from({ length: 401 }, (_, k) => dist(p, nurbsAt(N0, N0.knots[3] + ((N0.knots[N0.ctrl.length] - N0.knots[3]) * k) / 400))));
      expect(d).toBeLessThan(0.05);
    });
    reset();
    ok("spline 0,0 10,10 20,0 30,10");
    ok("upravit-spline e1 posunout-bod 2 10,20");
    expect(ent<DSpline>("e1").fit?.[1]).toEqual([10, 20]);
    ok("upravit-spline e1 uzavřít");
    expect(ent<DSpline>("e1").closed).toBe(true);
    ok("upravit-spline e1 křivka 0.01");
    expect(ent<DPolyline>("e1").type).toBe("polyline");
  });
  it("KOPIE se Zpět, PŘENÉST-VLASTNOSTI textu, POŘADÍ nad objekty, DUPLICITY s ignorováním barvy", () => {
    const r = new CmdRun(findCommand("CO")!, m, s, { interactive: true });
    ok("čára 0,0 10,0");
    const r2 = new CmdRun(findCommand("CO")!, m, s, { interactive: true });
    setSelection(s, ["e1"]);
    r2.start();
    r2.feed({ k: "point", p: [0, 0] });
    r2.feed({ k: "point", p: [0, 5] });
    r2.feed({ k: "point", p: [0, 10] });
    r2.feedText("_undo");
    r2.feed({ k: "none" });
    expect(r2.tx.model.entities.length).toBe(2);
    void r;
    reset();
    ok('text 0,0 5 0 "A"; text 0,10 2.5 0 "B"; proměnná textsize 2.5');
    ok("přenést-vlastnosti e1 e2");
    expect((ent("e2") as unknown as { h: number }).h).toBe(5);
    ok("čára 0,0 1,0; čára 0,1 1,1; čára 0,2 1,2");
    ok("pořadí e3 nad-objekty e5");
    expect(ids().slice(-3)).toEqual(["e4", "e5", "e3"]);
    reset();
    ok("čára 0,0 10,0; čára 0,0 10,0; vlastnosti e2 barva 1");
    ok("odstranit-duplicity vše");
    expect(m.entities.length).toBe(2);
    ok('odstranit-duplicity vše ignorovat barva ""');
    expect(m.entities.length).toBe(1);
  });
  it("POLE PO DRÁZE po oblouku se zarovnáním, ROZMĚŘIT křivku s oblouky, SPOJIT křivku a úsečku", () => {
    ok("oblouk střed 0,0 50,0 0,50; čára 50,-2 50,2");
    ok('pole-po-dráze e2 "" e1 rozdělit 3 ano');
    const ls = m.entities.slice(2) as DLine[];
    expect(ls.length).toBe(2);
    // prostřední položka na 45°, otočená o 45° (tečna)
    closeP(ls[0].a, [50 * Math.SQRT1_2 + 2 * Math.SQRT1_2, 50 * Math.SQRT1_2 - 2 * Math.SQRT1_2], 1e-9);
    reset();
    ok("křivka 0,0 100,0 oblouk 100,50");
    ok("rozměřit e1@0,0 50");
    const pts = m.entities.filter((e) => e.type === "point") as { p: Vec2 }[];
    expect(pts.length).toBe(3);
    closeP(pts[1].p, [100, 0], 1e-9);
    const arcLen = Math.PI * 25;
    const third = 150 - 100;
    const ang = -Math.PI / 2 + third / 25;
    closeP(pts[2].p, [100 + 25 * Math.cos(ang), 25 + 25 * Math.sin(ang)], 1e-9);
    void arcLen;
    reset();
    ok("křivka 0,0 10,0 10,10; čára 10,10 0,10");
    ok("spojit e1 e2");
    const J = ent<DPolyline>("e1");
    expect(J.pts.length).toBe(4);
    expect(m.entities.length).toBe(1);
  });
});

describe("opravy: zaoblení v bodě dotyku, příliš velký poloměr, ekvidistanta se smyčkami, výkon", () => {
  it("ZAOBLIT: výběr přímo v bodě dotyku zachová díl odvrácený od rohu; příliš velký poloměr / zkosení = chyba beze změny", () => {
    ok("čára 0,0 10,0; čára 0,0 0,10");
    ok("zaoblit poloměr 5 e1@5,0 e2@0,5");
    closeP(ent<DLine>("e1").a, [5, 0], 1e-12);
    closeP(ent<DLine>("e1").b, [10, 0]);
    closeP(ent<DLine>("e2").a, [0, 5], 1e-12);
    const arc = ent<DArc>("e3");
    closeP(arc.c, [5, 5], 1e-12);
    near(arc.r, 5);
    reset();
    ok("čára 0,0 10,0; čára 0,0 0,10");
    const before = JSON.stringify(m.entities);
    const r = run("zaoblit poloměr 100 e1@5,0 e2@0,5");
    expect(r[0].error).toMatch(/příliš velká/);
    expect(JSON.stringify(m.entities)).toBe(before);
    const r2 = run("zkosit vzdálenost 20 20 e1@5,0 e2@0,5");
    expect(r2[0].error).toMatch(/příliš velká/);
    expect(JSON.stringify(m.entities)).toBe(before);
  });
  it("ZAOBLIT vícekrát v GUI: chybný pár jen ohlásí a pokračuje (dosavadní zaoblení zůstanou)", () => {
    ok("čára 0,0 10,0; čára 0,0 0,10; čára 20,0 30,0; čára 20,0 20,10");
    const run2 = new CmdRun(findCommand("FILLET")!, m, s, { interactive: true });
    run2.start();
    run2.feedText("_radius");
    run2.feedText("2");
    run2.feedText("_multiple");
    run2.feed({ k: "ent", id: "e1", p: [5, 0] });
    run2.feed({ k: "ent", id: "e2", p: [0, 5] });
    run2.feed({ k: "ent", id: "e3", p: [25, 0] });
    run2.feed({ k: "ent", id: "e4", p: [20, 5] });
    // příliš velký poloměr pro další pár: zpráva, výzva znovu
    run2.feedText("_radius");
    run2.feedText("500");
    run2.feed({ k: "ent", id: "e1", p: [8, 0] });
    run2.feed({ k: "ent", id: "e3", p: [28, 0] });
    expect(run2.error).toBeFalsy();
    run2.feed({ k: "none" });
    expect(run2.tx.model.entities.filter((e) => e.type === "arc").length).toBe(2);
    expect(run2.logLines.join(" ")).toMatch(/⚠/);
  });
  it("EKVIDISTANTA křivky: vnitřní zánik, zaniklá krátká hrana, úzká drážka zmizí, zúžení rozdělí na dvě uzavřené", () => {
    ok("obdélník 0,0 100,50");
    const r = ok("ekvidistanta 30 e1 50,25");
    expect(r[0].created).toEqual([]);
    expect(r[0].log.join(" ")).toMatch(/zanikla/);
    reset();
    // zkosený roh 2 × 2 zanikne při vnitřní ekvidistantě 10 → čtverec 10…90
    ok("křivka 0,0 100,0 100,98 98,100 0,100 uzavřít");
    ok("ekvidistanta 10 e1 50,50");
    const sq = ent<DPolyline>("e2");
    expect(sq.pts.length).toBe(4);
    [[10, 10], [90, 10], [90, 90], [10, 90]].forEach((q, i) => closeP(sq.pts[i], q as Vec2, 1e-9));
    reset();
    // drážka šířky 2 v horní hraně, vnější ekvidistanta 3 → obdélník bez smyčky
    ok("křivka 0,0 100,0 100,50 52,50 52,40 50,40 50,50 0,50 uzavřít");
    ok("ekvidistanta 3 e1 50,-10");
    const o = ent<DPolyline>("e2");
    expect(o.closed).toBe(true);
    expect(o.pts.length).toBe(4);
    near(Math.abs(polylineArea(o)), 106 * 56, 1e-6);
    reset();
    // otevřená křivka s výstupkem: ekvidistanta na straně drážky = rovná úsečka
    ok("křivka 0,0 50,0 50,1 52,1 52,0 100,0");
    ok("ekvidistanta 3 e1 50,-10");
    const st = ent<DPolyline>("e2");
    expect(st.pts.length).toBe(2);
    closeP(st.pts[0], [0, -3]);
    closeP(st.pts[1], [100, -3]);
    reset();
    // zúžení výšky 10 a vnitřní ekvidistanta 6 → dvě uzavřené křivky 28 × 38
    ok("křivka 0,0 40,0 40,20 60,20 60,0 100,0 100,50 60,50 60,30 40,30 40,50 0,50 uzavřít");
    const r5 = ok("ekvidistanta 6 e1 20,25");
    expect(r5[0].created.length).toBe(2);
    for (const id of r5[0].created) {
      const p = ent<DPolyline>(id);
      expect(p.closed).toBe(true);
      near(polylineArea(p), 28 * 38, 1e-6);
      for (const q of p.pts) expect(Math.min(...[6, 34, 66, 94].map((x) => Math.abs(q[0] - x)))).toBeLessThan(1e-9);
    }
  });
  it("EKVIDISTANTA: bod strany na prodloužení úseku ve vrcholu rozhodne správnou stranu", () => {
    ok("křivka 0,0 50,0 50,10 100,10");
    ok("ekvidistanta 2 e1 50,-20");
    const p = ent<DPolyline>("e2");
    closeP(p.pts[0], [0, -2]);
    closeP(p.pts[p.pts.length - 1], [100, 8]);
  });
  it("výkon: 10 001 úseček – posun všeho, pole 100 × 100 a odstranění duplicit rychle (dříve O(n²))", { timeout: 120000 }, () => {
    const lines: string[] = [];
    for (let i = 0; i < 5000; i++) lines.push(`čára ${i},0 ${i},100`);
    for (let i = 0; i < 5000; i++) lines.push(`čára ${i},0 ${i},100`);
    lines.push("čára -1,50 6000,50");
    ok(lines.join("; "));
    let t = performance.now();
    const r1 = ok("odstranit-duplicity vše");
    expect(performance.now() - t).toBeLessThan(5000);
    expect(r1[0].deleted.length).toBe(5000);
    t = performance.now();
    const r2 = ok("posun vše 0,0 10,10");
    expect(performance.now() - t).toBeLessThan(3000);
    expect(r2[0].changed.length).toBe(5001);
    closeP(ent<DLine>("e1").a, [10, 10]);
    reset();
    ok("kružnice 0,0 1");
    t = performance.now();
    const r3 = ok("pole e1 obdélníkové 100 100 3 3");
    expect(performance.now() - t).toBeLessThan(3000);
    expect(r3[0].created.length).toBe(9999);
    closeP((m.entities[m.entities.length - 1] as DCircle).c, [297, 297]);
  });
});
