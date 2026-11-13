import { describe, expect, it } from "vitest";
import { cClosest, cDeriv, cIntersect, cLength, cPerpFrom, cPoint, cTangentFrom, cTransform, ellipseAxes, interpolateFit, type Curve } from "./curves";
import { arc3, bulgeArc, bulgeOf, dist, polar, tangentBulge, xfMirror, xfMul, xfPt, xfRotate, xfScale, xfInv, type Affine } from "./geom";
import { aciHex, aciRgb, nearestAci, parseColor } from "./colors";
import { dashPolyline, linetypeLibrary, parseLin, patternLength } from "./linetypes";
import { evalNumber, fmtLen } from "./units";
import "./kinds-core";
import { entityBox, entityCurves, kindOf } from "./kinds";
import { polylineArea, splineFromFit, textFrame } from "./kinds-core";
import { newDraftModel } from "./doc";
import type { DArc, DCircle, DEllipse, DPolyline, DraftEntity, DSpline, DText, Vec2 } from "./model";
import { SpatialIndex } from "./spatial";

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const closeP = (p: Vec2, q: Vec2, eps = 1e-9) => expect(dist(p, q)).toBeLessThan(eps);
const ctx = { model: newDraftModel() };

describe("2D geometrie – vydutí a oblouky", () => {
  it("vydutí 1 = půlkruh, střed uprostřed tětivy; kladné = proti směru hodin", () => {
    const a = bulgeArc([0, 0], [2, 0], 1);
    closeP(a.c, [1, 0]);
    close(a.r, 1);
    close(a.sweep, Math.PI);
    // bod uprostřed oblouku leží pod tětivou (oblouk jde proti směru hodin zleva doprava)
    closeP(polar(a.c, a.a0 + a.sweep / 2, a.r), [1, -1]);
  });
  it("čtvrtkruh tan(π/8) a zpětný převod úhlu", () => {
    const b = Math.tan(Math.PI / 8);
    const a = bulgeArc([0, 0], [2, 0], b);
    closeP(a.c, [1, 1]);
    close(a.r, Math.SQRT2);
    close(bulgeOf(a.sweep), b);
    const n = bulgeArc([0, 0], [2, 0], -b);
    closeP(n.c, [1, -1]);
    close(n.sweep, -Math.PI / 2);
  });
  it("tečný oblouk: navazuje na směr +X a končí v bodě", () => {
    const bu = tangentBulge([0, 0], [1, 0], [10, 10]);
    const a = bulgeArc([0, 0], [10, 10], bu);
    closeP(a.c, [0, 10]);
    close(a.r, 10);
  });
  it("oblouk třemi body", () => {
    const r = arc3([10, 0], [0, 10], [-10, 0])!;
    closeP(r.c, [0, 0]);
    close(r.r, 10);
    close(r.sweep, Math.PI);
    const cw = arc3([-10, 0], [0, 10], [10, 0])!;
    close(cw.sweep, Math.PI);
    closeP(polar(cw.c, cw.a0 + cw.sweep / 2, cw.r), [0, 10]);
  });
  it("plocha křivky s oblouky (čtverec + půlkruh)", () => {
    const pl: DPolyline = { id: "e1", layer: "0", type: "polyline", pts: [[0, 0], [10, 0], [10, 10], [0, 10]], bulges: [0, 1, 0, 0], closed: true };
    close(polylineArea(pl), 100 + (Math.PI * 25) / 2, 1e-9);
  });
});

describe("2D geometrie – průsečíky (přesné)", () => {
  const L = (a: Vec2, b: Vec2): Curve => ({ k: "line", a, b });
  it("úsečka × úsečka, mimo rozsah, prodloužení", () => {
    closeP(cIntersect(L([0, 0], [10, 10]), L([0, 10], [10, 0]))[0], [5, 5]);
    expect(cIntersect(L([0, 0], [1, 1]), L([0, 10], [10, 0]))).toEqual([]);
    closeP(cIntersect(L([0, 0], [1, 1]), L([0, 10], [10, 0]), true)[0], [5, 5]);
  });
  it("úsečka × kružnice a × oblouk", () => {
    const circ: Curve = { k: "arc", c: [0, 0], r: 5, a0: 0, sweep: 2 * Math.PI };
    const hits = cIntersect(L([-10, 3], [10, 3]), circ).sort((a, b) => a[0] - b[0]);
    closeP(hits[0], [-4, 3]);
    closeP(hits[1], [4, 3]);
    const upper: Curve = { k: "arc", c: [0, 0], r: 5, a0: 0, sweep: Math.PI / 2 };
    expect(cIntersect(L([-10, 3], [10, 3]), upper).length).toBe(1);
  });
  it("kružnice × kružnice", () => {
    const a: Curve = { k: "arc", c: [0, 0], r: 5, a0: 0, sweep: 2 * Math.PI };
    const b: Curve = { k: "arc", c: [8, 0], r: 5, a0: 0, sweep: 2 * Math.PI };
    const h = cIntersect(a, b).sort((p, q) => p[1] - q[1]);
    closeP(h[0], [4, -3]);
    closeP(h[1], [4, 3]);
  });
  it("úsečka × elipsa a elipsa × spline zpřesněné na strojovou přesnost", () => {
    const ell: Curve = { k: "ell", c: [0, 0], u: [10, 0], v: [0, 5], t0: 0, t1: 2 * Math.PI };
    const h = cIntersect(L([-20, 3], [20, 3]), ell).sort((a, b) => a[0] - b[0]);
    expect(h.length).toBe(2);
    const x = 10 * Math.sqrt(1 - 9 / 25);
    closeP(h[0], [-x, 3], 1e-9);
    closeP(h[1], [x, 3], 1e-9);
    const sp = splineFromFit([[-12, -8], [0, 0], [12, 8]]);
    const nurbs: Curve = { k: "nurbs", deg: sp.degree, ctrl: sp.ctrl, knots: sp.knots };
    const h2 = cIntersect(nurbs, ell);
    expect(h2.length).toBe(2);
    for (const p of h2) close((p[0] / 10) ** 2 + (p[1] / 5) ** 2, 1, 1e-9);
  });
  it("přímka (nekonečná) × kružnice", () => {
    const x: Curve = { k: "line", a: [100, 0], b: [101, 0], inf: 2 };
    const c: Curve = { k: "arc", c: [0, 0], r: 5, a0: 0, sweep: 2 * Math.PI };
    expect(cIntersect(x, c).length).toBe(2);
    const ray: Curve = { k: "line", a: [100, 0], b: [101, 0], inf: 1 };
    expect(cIntersect(ray, c).length).toBe(0);
  });
});

describe("2D geometrie – kolmice, tečny, nejbližší bod", () => {
  it("kolmice na úsečku (i na prodloužení) a na kružnici", () => {
    closeP(cPerpFrom({ k: "line", a: [0, 0], b: [10, 0] }, [15, 5])[0], [15, 0]);
    const p = cPerpFrom({ k: "arc", c: [0, 0], r: 5, a0: 0, sweep: 2 * Math.PI }, [10, 0]);
    expect(p.length).toBe(2);
  });
  it("tečny z bodu ke kružnici: dotykové body leží na kružnici a jsou kolmé k poloměru", () => {
    const c: Curve = { k: "arc", c: [0, 0], r: 5, a0: 0, sweep: 2 * Math.PI };
    const t = cTangentFrom(c, [10, 0]);
    expect(t.length).toBe(2);
    for (const q of t) {
      close(Math.hypot(q[0], q[1]), 5);
      close((q[0] - 10) * q[0] + q[1] * q[1], 0, 1e-9);
    }
  });
  it("tečny z bodu k elipse (numericky)", () => {
    const e: Curve = { k: "ell", c: [0, 0], u: [10, 0], v: [0, 5], t0: 0, t1: 2 * Math.PI };
    const t = cTangentFrom(e, [0, 20]);
    expect(t.length).toBe(2);
    for (const q of t) close((q[0] / 10) ** 2 + (q[1] / 5) ** 2, 1, 1e-9);
  });
  it("nejbližší bod oblouku mimo jeho rozsah je jeho konec", () => {
    const a: Curve = { k: "arc", c: [0, 0], r: 5, a0: 0, sweep: Math.PI / 2 };
    closeP(cClosest(a, [0, -10]).p, [5, 0]);
    closeP(cClosest(a, [10, 10]).p, [5 / Math.SQRT2, 5 / Math.SQRT2]);
  });
});

describe("2D geometrie – elipsa a spline", () => {
  it("délka kružnice jako elipsy s poměrem 1", () => {
    close(cLength({ k: "ell", c: [0, 0], u: [5, 0], v: [0, 5], t0: 0, t1: 2 * Math.PI }), 10 * Math.PI, 1e-9);
  });
  it("osy ze sdružených poloos (zkosená elipsa po transformaci)", () => {
    const ax = ellipseAxes([10, 0], [3, 4]);
    // hlavní a vedlejší poloosa kolmé, poměr ≤ 1
    expect(ax.ratio).toBeLessThanOrEqual(1);
    const ell: Curve = { k: "ell", c: [0, 0], u: [10, 0], v: [3, 4], t0: 0, t1: 2 * Math.PI };
    const fromAx: Curve = { k: "ell", c: [0, 0], u: ax.major, v: [-ax.major[1] * ax.ratio * (ax.flip ? -1 : 1), ax.major[0] * ax.ratio * (ax.flip ? -1 : 1)], t0: 0, t1: 2 * Math.PI };
    // stejná množina bodů: bod původní elipsy leží na nové
    for (const t of [0.3, 1.7, 4]) close(cClosest(fromAx, cPoint(ell, t)).d, 0, 1e-7);
  });
  it("spline proložením prochází všemi body a má přirozené konce", () => {
    const fit: Vec2[] = [[0, 0], [10, 5], [20, -3], [35, 8], [50, 0]];
    const r = interpolateFit(fit);
    expect(r.knots.length).toBe(r.ctrl.length + 4);
    const c: Curve = { k: "nurbs", deg: 3, ctrl: r.ctrl, knots: r.knots };
    let u = 0;
    for (let i = 0; i < fit.length; i++) {
      if (i) u += dist(fit[i], fit[i - 1]);
      closeP(cPoint(c, u), fit[i], 1e-9);
    }
  });
  it("spline se zadanými tečnami a uzavřená", () => {
    const r = interpolateFit([[0, 0], [10, 10], [20, 0]], { tan0: [0, 1], tan1: [0, -1] });
    const c: Curve = { k: "nurbs", deg: 3, ctrl: r.ctrl, knots: r.knots };
    const d0 = cDeriv(c, r.knots[3]);
    close(d0[0], 0, 1e-9);
    expect(d0[1]).toBeGreaterThan(0);
    const cl = splineFromFit([[0, 0], [10, 0], [10, 10], [0, 10]], true);
    const cc: Curve = { k: "nurbs", deg: 3, ctrl: cl.ctrl, knots: cl.knots };
    closeP(cPoint(cc, cl.knots[3]), cPoint(cc, cl.knots[cl.ctrl.length]), 1e-9);
  });
});

describe("2D entity – transformace", () => {
  const xfs: [string, Affine][] = [
    ["otočení", xfRotate(0.7, [3, 4])],
    ["měřítko", xfScale(2.5, [1, 1])],
    ["zrcadlení", xfMirror([0, 0], [1, 2])],
    ["složená", xfMul(xfMirror([0, 5], [10, 5]), xfRotate(1.1))],
  ];
  const ents: DraftEntity[] = [
    { id: "a", layer: "0", type: "arc", c: [5, 5], r: 3, a0: 20, a1: 140 } as DArc,
    { id: "b", layer: "0", type: "circle", c: [1, 2], r: 4 } as DCircle,
    { id: "c", layer: "0", type: "ellipse", c: [0, 0], major: [8, 2], ratio: 0.4, t0: 30, t1: 250 } as DEllipse,
    { id: "d", layer: "0", type: "polyline", pts: [[0, 0], [10, 0], [10, 5]], bulges: [0.4, -0.3, 0] } as DPolyline,
    { id: "s", layer: "0", type: "spline", ...splineFromFit([[0, 0], [5, 5], [10, 0]]) } as DSpline,
  ];
  for (const [nm, m] of xfs) {
    it(`${nm}: body transformované entity = transformované body původní`, () => {
      for (const e of ents) {
        const t = kindOf(e)!.transform(e, m, ctx)!;
        expect(t, e.type).toBeTruthy();
        const src = entityCurves(e, ctx);
        const dst = entityCurves(t, ctx);
        for (const c of src) {
          for (const tt of [0.1, 0.5, 0.9]) {
            const [a, b] = c.k === "nurbs" ? [c.knots[3], c.knots[c.ctrl.length]] : c.k === "arc" ? [0, c.sweep] : c.k === "ell" ? [c.t0, c.t1] : [0, 1];
            const p = xfPt(m, cPoint(c, a + (b - a) * tt));
            const dmin = Math.min(...dst.map((d) => cClosest(d, p).d));
            expect(dmin, `${e.type} ${nm}`).toBeLessThan(1e-7);
          }
        }
        // koncové body se zachovají (oblouk a eliptický oblouk po zrcadlení prohodí začátek a konec)
        expect(entityBox(t, ctx)).toBeTruthy();
      }
    });
  }
  it("kružnice v nestejném měřítku → elipsa", () => {
    const c: DCircle = { id: "c", layer: "0", type: "circle", c: [0, 0], r: 5 };
    const t = kindOf(c)!.transform(c, xfScale(2, [0, 0], 1), ctx) as DEllipse;
    expect(t.type).toBe("ellipse");
    close(Math.hypot(t.major[0], t.major[1]), 10);
    close(t.ratio, 0.5);
  });
  it("zrcadlený text zůstane čitelný (MIRRTEXT 0) a pokryje zrcadlený rám", () => {
    const tx: DText = { id: "t", layer: "0", type: "text", p: [0, 0], h: 5, s: "ABC" };
    const fr = textFrame(tx, ctx);
    const m = xfMirror([20, 0], [20, 1]); // svislá osa x = 20
    const t = kindOf(tx)!.transform(tx, m, ctx) as DText;
    close(t.rot ?? 0, 0, 1e-9);
    const f2 = textFrame(t, ctx);
    close(f2.s[0], 40 - fr.w, 1e-9);
    const m2 = xfMirror([0, 10], [1, 10]); // vodorovná osa y = 10
    const t2 = kindOf(tx)!.transform(tx, m2, ctx) as DText;
    close(t2.rot ?? 0, 0, 1e-9);
    close(textFrame(t2, ctx).s[1], 20 - 5, 1e-9);
    // inverze transformace vrátí původní polohu
    const back = kindOf(tx)!.transform(kindOf(tx)!.transform(tx, xfRotate(0.5), ctx)!, xfInv(xfRotate(0.5)), ctx) as DText;
    closeP(back.p, [0, 0]);
  });
});

describe("barvy, typy čar, jednotky", () => {
  it("ACI paleta: pevné barvy, odstíny, šedé, nejbližší index", () => {
    expect(aciRgb(1)).toEqual([255, 0, 0]);
    expect(aciHex(5)).toBe("#0000ff");
    expect(aciRgb(10)).toEqual([255, 0, 0]);
    expect(aciRgb(11)).toEqual([255, 170, 170]);
    expect(aciRgb(250)).toEqual([51, 51, 51]);
    expect(nearestAci([250, 2, 3])).toBe(1);
    expect(parseColor("červená")).toBe(1);
    expect(parseColor("ByLayer")).toBe("ByLayer");
    expect(parseColor("dlebloku")).toBe("ByBlock");
    expect(parseColor("#FF8800")).toBe("#ff8800");
    expect(parseColor("10,20,30")).toBe("#0a141e");
    expect(parseColor("256")).toBeNull();
  });
  it("knihovna typů čar acadiso a čtení .lin", () => {
    const lib = linetypeLibrary(true);
    expect(lib.find((l) => l.name === "CENTER")!.pattern).toEqual([31.75, -6.35, 6.35, -6.35]);
    expect(lib.find((l) => l.name === "HIDDEN2")!.pattern).toEqual([3.175, -1.5875]);
    expect(lib.length).toBe(1 + 8 * 3);
    const lin = parseLin("*MOJE,Moje __ .\nA,10,-5,0,-5\n*GAS,Gas line ---GAS---\nA,12.7,-5.08,[\"GAS\",STANDARD,S=2.54,R=0.0,X=-2.54,Y=-1.27],-6.35");
    expect(lin[0]).toEqual({ name: "MOJE", desc: "Moje __ .", pattern: [10, -5, 0, -5] });
    expect(lin[1].pattern).toEqual([12.7, -5.08, -6.35]);
  });
  it("přesný rozklad čáry na čárky a tečky (DASHDOT, měřítko 0,5)", () => {
    const pat = [12.7, -6.35, 0, -6.35];
    expect(patternLength(pat)).toBeCloseTo(25.4, 9);
    const r = dashPolyline([[0, 0], [50.8, 0]], pat, 0.5);
    // perioda 12,7: čárka 6,35, mezera 3,175, tečka, mezera 3,175 → 4 čárky, 4 tečky
    expect(r.dashes.length).toBe(4);
    expect(r.dots.length).toBe(4);
    close(r.dashes[1][0][0], 12.7, 1e-9);
    close(r.dashes[1][1][0], 19.05, 1e-9);
    close(r.dots[0][0], 9.525, 1e-9);
  });
  it("čárka pokračuje přes vrchol lomené čáry", () => {
    const r = dashPolyline([[0, 0], [5, 0], [5, 5]], [8, -2], 1);
    // první čárka 8 = 5 vodorovně + 3 svisle
    expect(r.dashes[0]).toEqual([[0, 0], [5, 0]]);
    closeP(r.dashes[1][1], [5, 3], 1e-12);
  });
  it("čísla a výrazy, formát délek", () => {
    expect(evalNumber("100/3")).toBeCloseTo(33.3333333, 6);
    expect(evalNumber("2*(10+5)")).toBe(30);
    expect(evalNumber("-3.5")).toBe(-3.5);
    expect(evalNumber("12,5")).toBeNaN();
    expect(evalNumber("12,5", true)).toBe(12.5);
    expect(evalNumber("2^3")).toBe(8);
    expect(evalNumber("abc")).toBeNaN();
    expect(fmtLen(1 / 3, { prec: 4 })).toBe("0.3333");
    expect(fmtLen(-0.00001, { prec: 2 })).toBe("0.00");
  });
});

describe("prostorový index", () => {
  it("dotaz oknem najde stejné entity jako hrubá síla (5 000 náhodných úseček)", () => {
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 1000;
    const ents: DraftEntity[] = [];
    for (let i = 0; i < 5000; i++) ents.push({ id: `e${i}`, layer: "0", type: "line", a: [rnd(), rnd()], b: [rnd() / 10, rnd() / 10] });
    ents.push({ id: "x", layer: "0", type: "xline", p: [0, 0], dir: [1, 0] });
    const idx = new SpatialIndex(ents, ctx);
    const box = { x0: 100, y0: 200, x1: 300, y1: 260 };
    const got = new Set(idx.query(box).map((e) => e.id));
    const want = new Set(ents.filter((e) => e.type === "xline" || (() => { const b = entityBox(e, ctx)!; return b.x0 <= box.x1 && b.x1 >= box.x0 && b.y0 <= box.y1 && b.y1 >= box.y0; })()).map((e) => e.id));
    expect(got).toEqual(want);
    expect(got.has("x")).toBe(true);
  });
});

describe("transformace kružnice a křivky", () => {
  it("oblouk po zrcadlení: začátek a konec se prohodí, geometrie sedí", () => {
    const a: DArc = { id: "a", layer: "0", type: "arc", c: [0, 0], r: 10, a0: 0, a1: 90 };
    const t = kindOf(a)!.transform(a, xfMirror([0, 0], [0, 1]), ctx) as DArc;
    close(t.a0, 90);
    close(t.a1, 180);
  });
  it("křivka: zrcadlení otočí znaménko vydutí", () => {
    const p: DPolyline = { id: "p", layer: "0", type: "polyline", pts: [[0, 0], [10, 0]], bulges: [0.5, 0] };
    const t = kindOf(p)!.transform(p, xfMirror([0, 0], [1, 0]), ctx) as DPolyline;
    expect(t.bulges![0]).toBe(-0.5);
    const c = cTransform({ k: "arc", c: [0, 0], r: 1, a0: 0, sweep: 1 }, xfScale(2, [0, 0], 1));
    expect(c.k).toBe("ell");
  });
});
