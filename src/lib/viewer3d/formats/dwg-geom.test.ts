/**
 * Testy geometrie převodu DWG: afinní transformace / OCS, eliptické oblouky pod obecnou
 * transformací, oblouky polyčar (bulge), NURBS (de Boor s váhami) a interpolace fit bodů.
 */
import { describe, expect, it } from "vitest";
import type { Pt } from "../drawing2d";
import {
  apply,
  applyVec,
  bulgePoints,
  ellipseFromAxes,
  evalNurbs,
  interpolateFitPoints,
  isSimilarity,
  mul,
  normalizeSweep,
  ocsMatrix,
  trs,
  type M2,
} from "./dwg-geom";

const TAU = Math.PI * 2;

/** Bod elipsy ve formátu entity „ellipse" (stejný vzorec jako vykreslovač). */
function ellipsePoint(el: { c: Pt; major: Pt; ratio: number }, t: number): Pt {
  return [
    el.c[0] + el.major[0] * Math.cos(t) - el.major[1] * el.ratio * Math.sin(t),
    el.c[1] + el.major[1] * Math.cos(t) + el.major[0] * el.ratio * Math.sin(t),
  ];
}

const close = (a: Pt, b: Pt, eps = 1e-9) => {
  expect(a[0]).toBeCloseTo(b[0], -Math.log10(eps));
  expect(a[1]).toBeCloseTo(b[1], -Math.log10(eps));
};

describe("afinní transformace a OCS", () => {
  it("skládá posun · rotaci · měřítko", () => {
    const m = mul(trs(10, 20, Math.PI / 2, 2, 2), trs(1, 0, 0, 1, 1));
    close(apply(m, 0, 0), [10, 22]);
    close(apply(m, 1, 0), [10, 24]);
    expect(isSimilarity(m)).toBe(true);
    expect(isSimilarity(trs(0, 0, 0.3, 2, 3))).toBe(false);
    expect(isSimilarity(trs(0, 0, 0.3, -2, 2))).toBe(true); // zrcadlení je pořád podobnost
  });

  it("normála (0,0,−1) zrcadlí X (Arbitrary Axis Algorithm), (0,0,1) i nulová = identita", () => {
    expect(ocsMatrix({ x: 0, y: 0, z: 1 })).toBeNull();
    expect(ocsMatrix({ x: 0, y: 0, z: 0 })).toBeNull();
    expect(ocsMatrix(undefined)).toBeNull();
    const m = ocsMatrix({ x: 0, y: 0, z: -1 }) as M2;
    close(apply(m, 3, 4), [-3, 4]);
  });

  it("obecná normála: průmět os OCS do XY", () => {
    // normála podél +X: Ax = Wz × N = (0,1,0), Ay = N × Ax = (0,0,1) → x_OCS → +Y světa, y_OCS → Z (zmizí)
    const m = ocsMatrix({ x: 1, y: 0, z: 0 }, 5) as M2;
    close(apply(m, 2, 7), [5, 2]);
  });

  it("normalizace rozsahu oblouku", () => {
    expect(normalizeSweep(0, TAU)).toEqual([0, TAU]);
    const [s, e] = normalizeSweep(-Math.PI / 2, Math.PI / 2);
    expect(s).toBeCloseTo(1.5 * Math.PI);
    expect(e - s).toBeCloseTo(Math.PI);
    const [s2, e2] = normalizeSweep(5, 1);
    expect(e2 - s2).toBeCloseTo(TAU - 4);
  });
});

describe("ellipseFromAxes — obraz kružnice / elipsy pod afinní transformací", () => {
  const check = (m: M2, r: number, t0: number, t1: number) => {
    const el = ellipseFromAxes(apply(m, 0, 0), applyVec(m, r, 0), applyVec(m, 0, r), t0, t1);
    expect(el).not.toBeNull();
    const e = el!;
    expect(e.ratio).toBeGreaterThan(0);
    expect(e.ratio).toBeLessThanOrEqual(1);
    let end = e.end;
    if (end <= e.start) end += TAU;
    // počáteční / koncový bod a střed oblouku musí odpovídat transformovanému oblouku
    // (zrcadlení obrátí směr: výsledný oblouk proti směru hodin vede z obrazu t1 do obrazu t0)
    const mirrored = m[0] * m[3] - m[1] * m[2] < 0;
    const [a, b] = mirrored ? [t1, t0] : [t0, t1];
    close(ellipsePoint(e, e.start), apply(m, r * Math.cos(a), r * Math.sin(a)), 1e-7);
    close(ellipsePoint(e, end), apply(m, r * Math.cos(b), r * Math.sin(b)), 1e-7);
    const tm = (t0 + t1) / 2;
    close(ellipsePoint(e, (e.start + end) / 2), apply(m, r * Math.cos(tm), r * Math.sin(tm)), 1e-7);
  };

  it("nerovnoměrné měřítko + rotace", () => check(trs(5, -3, 0.7, 3, 1.5), 2, 0.3, 2.1));
  it("zrcadlení (záporné měřítko X)", () => check(trs(1, 1, 0.2, -2, 1), 1, 0.5, 4));
  it("zkosení (obecná matice)", () => check([2, 0.5, 0.3, 1, 0, 0], 1, 1, 5.5));
  it("plná elipsa", () => {
    const el = ellipseFromAxes([0, 0], [3, 0], [0, 1], 0, TAU)!;
    expect(el.start).toBe(0);
    expect(el.end).toBe(TAU);
    expect(el.ratio).toBeCloseTo(1 / 3);
    expect(Math.hypot(...el.major)).toBeCloseTo(3);
  });
  it("degenerovaná (úsečka) → null", () => {
    expect(ellipseFromAxes([0, 0], [1, 0], [2, 0], 0, 1)).toBeNull();
  });
});

describe("bulge", () => {
  it("půlkruh (bulge 1) leží na kružnici a jde proti směru hodin", () => {
    const out: Pt[] = [];
    bulgePoints(0, 0, 2, 0, 1, out);
    close(out[out.length - 1], [2, 0]);
    for (const p of out) expect(Math.hypot(p[0] - 1, p[1])).toBeCloseTo(1, 9);
    // CCW z (0,0) do (2,0) kolem (1,0) vede spodem
    expect(out[Math.floor(out.length / 2)][1]).toBeLessThan(-0.9);
  });
  it("záporný bulge vede druhou stranou", () => {
    const out: Pt[] = [];
    bulgePoints(0, 0, 2, 0, -0.5, out);
    const r = 2 / (2 * Math.sin(Math.abs(4 * Math.atan(-0.5)) / 2));
    const mid = out[Math.floor(out.length / 2)];
    expect(mid[1]).toBeGreaterThan(0);
    expect(mid[1]).toBeCloseTo(0.5, 1); // šipka = bulge · tětiva / 2
    expect(r).toBeCloseTo(1.25);
  });
});

describe("spliny", () => {
  it("racionální NURBS (čtvrtkružnice s váhami) leží přesně na kružnici", () => {
    const w = Math.SQRT1_2;
    const pts = evalNurbs([[1, 0], [1, 1], [0, 1]], [0, 0, 0, 1, 1, 1], 2, [1, w, 1]);
    expect(pts.length).toBeGreaterThan(10);
    for (const p of pts) expect(Math.hypot(p[0], p[1])).toBeCloseTo(1, 12);
    close(pts[0], [1, 0]);
    close(pts[pts.length - 1], [0, 1]);
  });

  it("sevřený kubický B-spline začíná a končí v krajních řídicích bodech", () => {
    const ctrl: Pt[] = [[0, 0], [1, 2], [3, 2], [4, 0], [6, 1]];
    const pts = evalNurbs(ctrl, [0, 0, 0, 0, 0.5, 1, 1, 1, 1], 3);
    close(pts[0], [0, 0]);
    close(pts[pts.length - 1], [6, 1]);
  });

  it("chybný uzlový vektor → dopočítá se rovnoměrný", () => {
    const pts = evalNurbs([[0, 0], [1, 1], [2, 0], [3, 1]], [1, 2], 3);
    close(pts[0], [0, 0]);
    close(pts[pts.length - 1], [3, 1]);
  });

  it("periodický (uzavřený) spline z AutoCADu — vyhodnocení na <u_p, u_n> dá uzavřenou křivku", () => {
    // kubický uzavřený: řídicí body se na konci opakují (p = 3), rovnoměrné uzly
    const base: Pt[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const ctrl = [...base, base[0], base[1], base[2]];
    const knots = Array.from({ length: ctrl.length + 4 }, (_, i) => i);
    const pts = evalNurbs(ctrl, knots, 3);
    close(pts[0], pts[pts.length - 1], 1e-9);
  });

  it("fit body: křivka jimi prochází, respektuje tečny", () => {
    const fit: Pt[] = [[0, 0], [10, 5], [20, 0], [30, 5]];
    const pts = interpolateFitPoints(fit, [1, 0], [1, 0]);
    for (const f of fit) expect(Math.min(...pts.map((p) => Math.hypot(p[0] - f[0], p[1] - f[1])))).toBeLessThan(1e-9);
    // tečna na začátku vodorovně
    expect(Math.abs(pts[1][1] - pts[0][1])).toBeLessThan(Math.abs(pts[1][0] - pts[0][0]));
    // přirozený spline (bez tečen) taky prochází body
    const nat = interpolateFitPoints(fit);
    for (const f of fit) expect(Math.min(...nat.map((p) => Math.hypot(p[0] - f[0], p[1] - f[1])))).toBeLessThan(1e-9);
    // dva body → úsečka
    expect(interpolateFitPoints([[0, 0], [1, 1]])).toEqual([[0, 0], [1, 1]]);
  });
});
