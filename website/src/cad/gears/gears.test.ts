/**
 * Kola a ozubení – matematika (bez jádra). Referenční hodnoty jsou spočítané ručně ze vzorců ISO 21771 / DIN 3960
 * (u každé skupiny je vzorec v komentáři); ostatní testy ověřují, že body křivek splňují své rovnice.
 */
import { describe, expect, it } from "vitest";
import { parseAgentText } from "../agent";
import { docToScript } from "../doc-script";
import { emptyDoc, type Feature } from "../types";
import "../ext/index";
import { allExt, getExt } from "../ext/registry";
import { coneGroups, sphericalInvolute, type ConeMember } from "./conic";
import { discPoint } from "./cyclodisc";
import { HELICAL, SPUR, type CylIn } from "./cylindrical";
import { hypoidSolve } from "./hypoid";
import { cylGeom, cylProfile, flankAngle } from "./involute";
import { ballAuto, overBalls, spanTeeth, spanW } from "./measure";
import { DEG, inv, invInverse, segGreen } from "./num";
import { RACKS } from "./rack";
import { curveEval, GEAR_KINDS, gearCompute, gearDataRows, gearProfile, gearSummary, gearTablesOf, gearTableText, gearValidate, KINDS, pairDefaults, pairScript, polygonArea, profilePolyline, rowsToParams, solvePair, PAIR_ROWS, type GearData, type PairKind, type Seg2, type Vec2 } from "./index";

const spur = (d: GearData = {}): CylIn => SPUR.read({ ...SPUR.defaults(), ...d });
const cyl = (m: number, z: number, x = 0, beta = 0, extra: Partial<Parameters<typeof cylGeom>[0]> = {}) => ({ m, z, alpha: 20, x, beta, rack: RACKS.A, k: 0, jn: 0, internal: false, ...extra });
const rr = (p: Vec2) => Math.hypot(p[0], p[1]);

describe("evolventní funkce", () => {
  it("inv 20° = 0,0149044 a inverze", () => {
    expect(inv(20 * DEG)).toBeCloseTo(0.0149044, 7);
    for (const a of [0.01, 5, 14.5, 20, 25, 40, 60]) expect(invInverse(inv(a * DEG)) / DEG).toBeCloseTo(a, 9);
  });
});

describe("A. čelní kolo m 2, z 24, x 0, α 20°, ISO 53-A (ruční výpočet)", () => {
  const i = cyl(2, 24);
  const g = cylGeom(i);
  it("průměry: d = m·z, d_a = d + 2m, d_f = d − 2,5m, d_b = d·cos α", () => {
    expect(g.d).toBeCloseTo(48, 12);
    expect(g.da).toBeCloseTo(52, 12);
    expect(g.df).toBeCloseTo(43, 12);
    expect(g.db).toBeCloseTo(45.105246, 6);
    expect(g.pbt).toBeCloseTo(5.904263, 6);
    expect(g.sn).toBeCloseTo(3.141593, 6);
  });
  it("tloušťka zubu na hlavě s_a = d_a·(s/d + inv α − inv α_a) = 1,4311; α_a = 29,84112°", () => {
    expect(Math.acos(g.db / g.da) / DEG).toBeCloseTo(29.84112, 5);
    expect(g.san).toBeCloseTo(1.4311, 4);
  });
  it("začátek evolventy d_Ff = 45,3518, polovina patního oblouku E/r = 0,005363 rad, mez podřezání x_min = −0,4038", () => {
    expect(g.dFf).toBeCloseTo(45.3518, 4);
    expect(g.rootHalf).toBeCloseTo(0.005363, 6);
    expect(g.xMin).toBeCloseTo(-0.4038, 4);
    expect(g.undercut).toBe(false);
  });
  it("rozměr přes zuby (DIN 3960): k = 3 (3,167), W₃ = m·cos α·[(k − 0,5)·π + z·inv α] = 15,4329", () => {
    const { k, raw } = spanTeeth(i, g);
    expect(raw).toBeCloseTo(3.167, 3);
    expect(k).toBe(3);
    expect(spanW(i, g, k)).toBeCloseTo(15.4329, 4);
  });
  it("rozměr přes kuličky (DIN 3960): D_M = 3,5 → α_M = 24,20076°, d_K = 49,45129, M_dK = d_K + D_M = 52,9513", () => {
    expect(ballAuto(2)).toBe(3.5);
    const o = overBalls(i, g, 3.5);
    expect(o.alphaM / DEG).toBeCloseTo(24.20076, 5);
    expect(o.dK).toBeCloseTo(49.45129, 5);
    expect(o.M).toBeCloseTo(52.9513, 4);
    expect(overBalls(i, g, 3).M).toBeCloseTo(51.1385, 4);
    expect(overBalls(i, g, 4).M).toBeCloseTo(54.6078, 4);
  });
});

describe("B. liché z: m 3, z 17, x 0,3", () => {
  const i = cyl(3, 17, 0.3);
  const g = cylGeom(i);
  it("d 51, d_a 58,8, d_f 45,3, d_b 47,92432; k = 3 (2,852), W₃ = 23,4709; M_dK = d_K·cos(90°/z) + D_M = 59,4861", () => {
    expect(g.d).toBeCloseTo(51, 12);
    expect(g.da).toBeCloseTo(58.8, 12);
    expect(g.df).toBeCloseTo(45.3, 12);
    expect(g.db).toBeCloseTo(47.92432, 5);
    const { k, raw } = spanTeeth(i, g);
    expect(raw).toBeCloseTo(2.852, 3);
    expect(k).toBe(3);
    expect(spanW(i, g, 3)).toBeCloseTo(23.4709, 4);
    expect(ballAuto(3)).toBe(5.25);
    const o = overBalls(i, g, 5.25);
    expect(o.dK).toBeCloseTo(54.4685, 4);
    expect(o.M).toBeCloseTo(59.4861, 4);
  });
});

describe("C. šikmé kolo mₙ 2, z 20, β 15°", () => {
  const i = cyl(2, 20, 0, 15);
  const g = cylGeom(i);
  it("m_t, d, α_t, d_b, β_b, p_z, W₃", () => {
    expect(g.mt).toBeCloseTo(2.070552, 6);
    expect(g.d).toBeCloseTo(41.411047, 6);
    expect(g.at / DEG).toBeCloseTo(20.6469, 4);
    expect(g.db).toBeCloseTo(38.751267, 5);
    expect(g.da).toBeCloseTo(45.411047, 6);
    expect(g.df).toBeCloseTo(36.411047, 6);
    expect(g.bb / DEG).toBeCloseTo(14.0761, 4);
    expect(g.pz).toBeCloseTo(485.527, 3);
    expect(spanTeeth(i, g).k).toBe(3);
    expect(spanW(i, g, 3)).toBeCloseTo(15.3791, 4);
  });
  it("zkroucení přes b = 20 je 14,8292° a ε_β = 0,8238", () => {
    const c = HELICAL.compute(HELICAL.read({ ...HELICAL.defaults(), m: 2, z: 20, beta: 15, b: 20 }));
    expect(c.twist).toBeCloseTo(14.8292, 4);
    expect((20 * Math.sin(15 * DEG)) / (Math.PI * 2)).toBeCloseTo(0.8238, 4);
  });
});

describe("D. soukolí s posunutím: m 2, z 20/60, a_w = 81 (a = 80)", () => {
  const res = solvePair({ kind: "spur", values: { ...pairDefaults("spur"), m: 2, z1: 20, z2: 60, a: 81, b: 20 } });
  const row = (k: string) => res.rows.find((r) => r.key === k)!.value.replace(",", ".");
  it("α_w = 21,86076°, Σx = 0,52262, rozdělení DIN 3992 x₁ 0,3668, x₂ 0,1558, k 0,02262", () => {
    expect(res.ok).toBe(true);
    expect(Number(row("alphaW"))).toBeCloseTo(21.8608, 4);
    expect(Number(row("sumX"))).toBeCloseTo(0.5226, 4);
    expect(Number(row("x1"))).toBeCloseTo(0.3668, 4);
    expect(Number(row("x2"))).toBeCloseTo(0.1558, 4);
    expect(Number(row("k"))).toBeCloseTo(0.0226, 4);
    expect(Number(row("dw1"))).toBeCloseTo(40.5, 3);
    expect(Number(row("dw2"))).toBeCloseTo(121.5, 3);
  });
  it("průměry kol, hlavová vůle 0,25·m a ε_α = 1,5199 (bez posunutí při a = 80: 1,6708)", () => {
    const [w1, w2] = res.wheels;
    const c1 = gearCompute(w1.ext, w1.data);
    const c2 = gearCompute(w2.ext, w2.data);
    expect(c1.da).toBeCloseTo(45.3769, 3);
    expect(c2.da).toBeCloseTo(124.5326, 3);
    expect(c1.df).toBeCloseTo(36.4674, 3);
    expect(c2.df).toBeCloseTo(115.6231, 3);
    expect(Number(row("c"))).toBeCloseTo(0.5, 3);
    expect(Number(row("epsA"))).toBeCloseTo(1.5199, 3);
    const plain = solvePair({ kind: "spur", values: { ...pairDefaults("spur"), m: 2, z1: 20, z2: 60, xAuto: false } });
    expect(Number(plain.rows.find((r) => r.key === "epsA")!.value.replace(",", "."))).toBeCloseTo(1.6708, 3);
    expect(Number(plain.rows.find((r) => r.key === "aw")!.value.replace(",", "."))).toBeCloseTo(80, 6);
  });
  it("inverze: Σx 0,52262 → a_w 81,0000", () => {
    const back = solvePair({ kind: "spur", values: { ...pairDefaults("spur"), m: 2, z1: 20, z2: 60, x1: 0.36684, x2: 0.15578, xAuto: false } });
    expect(Number(back.rows.find((r) => r.key === "aw")!.value.replace(",", "."))).toBeCloseTo(81, 3);
  });
  it("poloha: kolo 2 v (a_w, 0, 0) otočené o 180° − 180°/z₂; vazba zuby 20 60 mezi dírami", () => {
    expect(res.placement[1].at).toEqual([81, 0, 0]);
    expect(res.placement[1].rot[2]).toBeCloseTo(177, 6);
    expect(res.mate).toMatchObject({ kind: "gear", teeth: [20, 60], flip: false, faceA: "Ø10", faceB: "Ø30" });
    expect(res.wheels[0].data).toMatchObject({ z: 20, mateZ: 60, aw: 81, jn: 0.04, bore: 10, b: 21 });
    expect(res.wheels[0].name).toBe("Pastorek m2 z20");
    expect(res.asmName).toBe("Soukolí m2 z20/z60");
  });
});

describe("E. řetězové kolo 08B (p 12,7, d1 8,51), z 19", () => {
  const c = gearCompute("gear.sprocket", { chain: "08B", z: 19 });
  it("d = p / sin(180°/z) = 77,1593, d_f = d − d1, d_a mezi min a max, r_i, r_e, úhel lůžka, M_R", () => {
    expect(c.d).toBeCloseTo(77.1593, 4);
    expect(c.df).toBeCloseTo(68.6493, 4);
    expect(c.daMax).toBeCloseTo(84.5243, 4);
    expect(c.daMin).toBeCloseTo(80.2798, 4);
    expect(c.da).toBeCloseTo(82.402, 3);
    expect(c.MR).toBeCloseTo(85.4057, 4);
    const lo = gearCompute("gear.sprocket", { chain: "08B", z: 19, form: "min" });
    const hi = gearCompute("gear.sprocket", { chain: "08B", z: 19, form: "max" });
    expect(lo.ri).toBeCloseTo(4.2976, 4);
    expect(hi.ri).toBeCloseTo(4.4384, 4);
    expect(lo.alpha / DEG).toBeCloseTo(135.263, 3);
    expect(hi.alpha / DEG).toBeCloseTo(115.263, 3);
    expect(lo.re).toBeCloseTo(21.445, 3);
    expect(hi.re).toBeCloseTo(36.831, 3);
    const even = gearCompute("gear.sprocket", { chain: "08B", z: 20 });
    expect(even.d).toBeCloseTo(81.1842, 4);
    expect(even.MR).toBeCloseTo(89.6942, 4);
  });
  it("profil je uzavřený, z přesných oblouků, s patou na d_f a hlavou na d_a", () => {
    const p = gearProfile("gear.sprocket", { chain: "08B", z: 19 });
    expect(p.tooth.every((s) => s.t === "arc")).toBe(true);
    const pts = profilePolyline(p, 0.001);
    expect(Math.min(...pts.map(rr))).toBeCloseTo(c.df / 2, 3);
    expect(Math.max(...pts.map(rr))).toBeCloseTo(c.da / 2, 3);
    expect(polygonArea(pts) / p.area).toBeCloseTo(1, 4);
  });
});

describe("F. kotouč cykloidního reduktoru N 10, D_p 60, d_p 6, e 1,5", () => {
  const d = { N: 10, pinCircle: 60, pinD: 6, e: 1.5 };
  it("laloky 9, převod 9, P(0) = (25,5; 0), P(π/9) = (26,7812; −9,7476), plocha profilu 2324,97 mm²", () => {
    const c = gearCompute("gear.cyclodisc", d);
    expect(c.n).toBe(9);
    expect(c.ratio).toBe(9);
    expect(c.df).toBeCloseTo(51, 9);
    expect(c.da).toBeCloseTo(57, 9);
    expect(discPoint(d, 0)[0]).toBeCloseTo(25.5, 9);
    const p = discPoint(d, Math.PI / 9);
    expect(p[0]).toBeCloseTo(26.7812, 4);
    expect(p[1]).toBeCloseTo(-9.7476, 4);
    expect(rr(p)).toBeCloseTo(28.5, 6);
    expect(c.rhoMin).toBeCloseTo(11.1, 1);
    expect(gearProfile("gear.cyclodisc", d).area).toBeCloseTo(2324.97, 1);
  });
  it("výstřednost ≥ D_p/(2N) = 3 je chyba u řádku e; čep větší než křivost je chyba", () => {
    const v = gearValidate("gear.cyclodisc", { ...d, e: 3 });
    expect(v.ok).toBe(false);
    expect(v.issues[0]).toMatchObject({ key: "e", level: "error" });
    expect(v.issues[0].text).toMatch(/smyčky/);
    // čepy se překrývají, když d_p ≥ π·D_p/N = 18,85; podřezání profilu, když r_p ≥ ρ_min (e 2,9 → ρ_min 3,28 < r_p 4)
    expect(gearValidate("gear.cyclodisc", { ...d, pinD: 19 }).issues[0]).toMatchObject({ key: "pinD", code: "pins-overlap" });
    expect(gearValidate("gear.cyclodisc", { ...d, e: 2.9, pinD: 8 }).issues[0]).toMatchObject({ key: "pinD", code: "pin-curv" });
    expect(gearValidate("gear.cyclodisc", { ...d, pinD: 18 }).ok).toBe(true);
    expect(gearValidate("gear.cyclodisc", d).ok).toBe(true);
  });
  it("kotouč posunutý o e se právě dotýká čepů věnce (žádný průnik)", () => {
    const pts = Array.from({ length: 3600 }, (_, k) => discPoint(d, (2 * Math.PI * k) / 3600));
    let minGap = Infinity;
    for (let k = 0; k < 10; k++) {
      const pin: Vec2 = [30 * Math.cos((2 * Math.PI * k) / 10), 30 * Math.sin((2 * Math.PI * k) / 10)];
      for (const q of pts) minGap = Math.min(minGap, Math.hypot(q[0] + 1.5 - pin[0], q[1] - pin[1]) - 3);
    }
    expect(minGap).toBeGreaterThan(-1e-4);
    expect(minGap).toBeLessThan(1e-3);
  });
});

describe("G. hypoidní soukolí – střední bod (z 11/43, d_e2 210, b 30, E 30, β_m1 45°)", () => {
  const h = hypoidSolve({ z1: 11, z2: 43, de2: 210, b: 30, E: 30, betaM1: 45 * DEG, hand: 1, delta2: Math.atan(43 / 11 / 1.2) })!;
  it("řešení existuje; δ₁ 16,25°, δ₂ 72,93°, β_m2 26,72°, r_m1 29,30", () => {
    expect(h).toBeTruthy();
    expect(h.delta1 / DEG).toBeCloseTo(16.25, 1);
    expect(h.delta2 / DEG).toBeCloseTo(72.93, 1);
    expect(h.beta2 / DEG).toBeCloseTo(26.72, 1);
    expect(h.rm1).toBeCloseTo(29.3, 1);
    expect(Math.abs(h.P[0])).toBeCloseTo(86.45, 1);
    expect(Math.abs(h.P[2])).toBeCloseTo(29.17, 1);
  });
  it("stejná normálná rozteč: u·r_m1·cos β_m1 = r_m2·cos β_m2 (= 80,98)", () => {
    const lhs = (43 / 11) * h.rm1 * Math.cos(h.beta1);
    const rhs = h.rm2 * Math.cos(h.beta2);
    expect(lhs).toBeCloseTo(rhs, 8);
    expect(rhs).toBeCloseTo(80.98, 1);
  });
  it("oba členy se dají spočítat a příliš malé přesazení dá srozumitelnou chybu", () => {
    for (const member of ["pinion", "wheel"]) expect(gearValidate("gear.hypoid", { member }).issues.filter((x) => x.level === "error")).toEqual([]);
    const v = gearValidate("gear.hypoid", { E: 1 });
    expect(v.ok).toBe(false);
    expect(v.issues[0].text).toMatch(/kuželové kolo/);
  });
});

describe("křivky profilu splňují své rovnice", () => {
  const onInvolute = (g: ReturnType<typeof cylGeom>, p: Vec2) => Math.abs(Math.abs(Math.atan2(p[1], p[0])) - flankAngle(g, rr(p))) * rr(p);
  it("evolventa: body i mezilehlé body proloženého splinu leží na evolventě (m ≤ 10: odchylka < 0,0001 mm)", () => {
    for (const [m, z, x] of [[2, 24, 0], [10, 12, 0.4], [10, 200, 0], [1, 17, 0], [5, 40, -0.3]] as const) {
      const i = cyl(m, z, x);
      const g = cylGeom(i);
      const p = cylProfile(i, g);
      const flanks = p.tooth.filter((s): s is Extract<Seg2, { t: "curve" }> => s.t === "curve" && s.kind === "involute");
      expect(flanks).toHaveLength(2);
      for (const s of flanks) {
        for (const q of s.pts) expect(onInvolute(g, q)).toBeLessThan(1e-9);
        const f = curveEval(s);
        let worst = 0;
        for (let k = 0; k <= 200; k++) worst = Math.max(worst, onInvolute(g, f(s.params[0] + ((s.params[s.params.length - 1] - s.params[0]) * k) / 200)));
        expect(worst).toBeLessThan(1e-4);
      }
    }
  });
  it("derivace na koncích odpovídají konečným diferencím splinu a navazují (tečně) na sousední úseky", () => {
    const i = cyl(2, 24);
    const p = cylProfile(i, cylGeom(i));
    for (const s of p.tooth) {
      if (s.t !== "curve") continue;
      const f = curveEval(s);
      const h = 1e-6 * (s.params[s.params.length - 1] - s.params[0]);
      const a = f(s.params[0]);
      const b = f(s.params[0] + h);
      expect((b[0] - a[0]) / h).toBeCloseTo(s.d0[0], 3);
      expect((b[1] - a[1]) / h).toBeCloseTo(s.d0[1], 3);
    }
    // přechodová křivka začíná na patní kružnici (tečně) a končí na evolventě (tečně)
    const g = cylGeom(i);
    const fil = p.tooth.find((s) => s.t === "curve" && s.kind === "trochoid") as Extract<Seg2, { t: "curve" }>;
    const flank = p.tooth.find((s) => s.t === "curve" && s.kind === "involute") as Extract<Seg2, { t: "curve" }>;
    expect(rr(fil.pts[0])).toBeCloseTo(g.rf, 9);
    const radial = (fil.d0[0] * fil.pts[0][0] + fil.d0[1] * fil.pts[0][1]) / (rr(fil.pts[0]) * Math.hypot(...fil.d0));
    expect(Math.abs(radial)).toBeLessThan(1e-6);
    const e = fil.pts[fil.pts.length - 1];
    expect(Math.hypot(e[0] - flank.pts[0][0], e[1] - flank.pts[0][1])).toBeLessThan(1e-12);
    const cr = (fil.d1[0] * flank.d0[1] - fil.d1[1] * flank.d0[0]) / (Math.hypot(...fil.d1) * Math.hypot(...flank.d0));
    expect(Math.abs(cr)).toBeLessThan(1e-6);
  });
  // z = 17 bez posunutí je podle vzorce x_min = h_fP* − ρ_fP*·(1 − sin α) − z·sin²α/2 = +0,0057 už nepatrně podřezané (z_min = 17,1)
  it("přechodová křivka končí na evolventě pro z 18, 24, 100; u z 8, 10, 12 ji protne (podřezání; z 10: r = 9,4512, r_b = 9,3969)", () => {
    for (const z of [18, 24, 100]) {
      const g = cylGeom(cyl(2, z));
      expect(g.undercut).toBe(false);
      const p = cylProfile(cyl(2, z), g);
      const fil = p.tooth.find((s) => s.t === "curve" && s.kind === "trochoid") as Extract<Seg2, { t: "curve" }>;
      expect(onInvolute(g, fil.pts[fil.pts.length - 1])).toBeLessThan(1e-9);
    }
    for (const z of [8, 10, 12]) {
      const g = cylGeom(cyl(2, z));
      expect(g.undercut).toBe(true);
      expect(g.rFf).toBeGreaterThan(g.rb);
      const p = cylProfile(cyl(2, z), g);
      const fil = p.tooth.find((s) => s.t === "curve" && s.kind === "trochoid") as Extract<Seg2, { t: "curve" }>;
      expect(onInvolute(g, fil.pts[fil.pts.length - 1])).toBeLessThan(1e-9);
    }
    const g10 = cylGeom(cyl(2, 10));
    expect(g10.rb).toBeCloseTo(9.3969, 4);
    expect(g10.rFf).toBeCloseTo(9.4512, 3);
    // klasická mez: bez posunutí je podřezání pod z = 17,1
    expect(cylGeom(cyl(1, 17)).undercut).toBe(true);
    expect(cylGeom(cyl(1, 18)).undercut).toBe(false);
  });
  it("plocha profilu = plocha husté lomené čáry (1e-6) pro všechny druhy s uzavřeným obrysem", () => {
    for (const k of ["spur", "helical", "herringbone", "internal", "sprocket", "pulley", "ratchet", "cycloid", "cyclodisc"] as const) {
      const p = gearProfile(`gear.${k}`, {});
      const poly = Math.abs(polygonArea(profilePolyline(p, 1e-5)));
      const exact = k === "internal" ? Math.abs(p.tooth.reduce((s, x) => s + segGreen(x), 0) * p.count) : k === "cyclodisc" ? p.area : p.area;
      expect(Math.abs(poly - exact) / exact, k).toBeLessThan(k === "cyclodisc" || k === "cycloid" ? 2e-5 : 2e-6);
    }
  });
  it("sférická evolventa: jednotková délka, na roztečném kuželi úhel δ a úhel záběru α (δ 45°, α 20°: základní kužel 41,6411°)", () => {
    const delta = 45 * DEG;
    const db = Math.asin(Math.sin(delta) * Math.cos(20 * DEG));
    expect(db / DEG).toBeCloseTo(41.6411, 4);
    for (const phi of [0, 0.1, 0.3, 0.6]) expect(Math.hypot(...sphericalInvolute(db, phi))).toBeCloseTo(1, 12);
    const phiP = Math.acos(Math.cos(delta) / Math.cos(db)) / Math.sin(db);
    const u = sphericalInvolute(db, phiP);
    expect(Math.acos(u[2]) / DEG).toBeCloseTo(45, 9);
    // úhel záběru = úhel mezi tečnou evolventy a poledníkem (rovinou procházející osou a bodem)
    const h = 1e-6;
    const a = sphericalInvolute(db, phiP + h);
    const b = sphericalInvolute(db, phiP - h);
    const t = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const tl = Math.hypot(...t);
    const er = [u[0] / Math.hypot(u[0], u[1]), u[1] / Math.hypot(u[0], u[1])];
    const meridian = [Math.cos(delta) * er[0], Math.cos(delta) * er[1], -Math.sin(delta)];
    const cosA = Math.abs(t[0] * meridian[0] + t[1] * meridian[1] + t[2] * meridian[2]) / tl;
    expect(Math.acos(cosA) / DEG).toBeCloseTo(20, 4);
  });
  it("mřížky kuželového kola: řady leží na kuželech řezů, první a poslední řada v rovinách čel, sousední záplaty sdílejí body", () => {
    const c = KINDS.bevel.compute(KINDS.bevel.read({ ...KINDS.bevel.defaults(), betaM: 30 })) as { member: ConeMember; geom: { zBack: number; zFront: number; rBack: number } };
    const groups = coneGroups(c.member);
    expect(groups).toHaveLength(3);
    for (const g of groups) {
      for (let k = 0; k + 1 < g.grids.length; k++) {
        const a = g.grids[k];
        const b = g.grids[k + 1];
        a.rows.forEach((row, j) => expect(Math.hypot(...row[row.length - 1].map((v, n) => v - b.rows[j][0][n]))).toBeLessThan(1e-9));
      }
    }
    for (const gr of groups[0].grids) for (const p of gr.rows[0]) {
      expect(p[2]).toBeCloseTo(c.geom.zBack, 9);
      expect(Math.hypot(p[0], p[1])).toBeCloseTo(c.geom.rBack, 9);
    }
    for (const gr of groups[2].grids) for (const p of gr.rows[1]) expect(p[2]).toBeCloseTo(c.geom.zFront, 9);
    // pás na velkém konci navazuje na boky a boky na pás malého konce
    groups[0].grids.forEach((gr, k) => gr.rows[1].forEach((p, n) => expect(Math.hypot(...p.map((v, q) => v - groups[1].grids[k].rows[0][n][q]))).toBeLessThan(1e-9)));
  });
});

describe("kontrola zadání – hlášky lidsky u správného řádku", () => {
  it("špičatý zub (z 10, x 0,9), podřezání (z 12), díra přes patu, špatné číslo", () => {
    const pointed = gearValidate("gear.spur", { z: 10, x: 0.9 });
    expect(pointed.ok).toBe(false);
    expect(pointed.issues.find((x) => x.code === "pointed")).toMatchObject({ key: "x", level: "error" });
    const under = gearValidate("gear.spur", { z: 12 });
    expect(under.ok).toBe(true);
    expect(under.issues.find((x) => x.code === "undercut")).toMatchObject({ key: "z", level: "warn" });
    expect(under.issues.find((x) => x.code === "undercut")!.text).toMatch(/x ≥ 0,3|x ≥ 0\.3/);
    const bore = gearValidate("gear.spur", { bore: 44 });
    expect(bore.issues.find((x) => x.code === "bore-root")).toMatchObject({ key: "bore", level: "error" });
    expect(gearValidate("gear.spur", { z: 3 }).issues[0]).toMatchObject({ key: "z", code: "min" });
    expect(gearValidate("gear.spur", { hubD: 30 }).issues.find((x) => x.code === "hub-half")).toMatchObject({ key: "hubL" });
    expect(gearValidate("gear.spur", { setScrew: "M5" }).ok).toBe(false);
    expect(gearValidate("gear.spur", { z: 40, bore: 12, keyway: true, hubD: 26, hubL: 12, setScrew: "M5", holesN: 6, holesD: 5, chamfer: 0.5 }).issues.filter((x) => x.level === "error")).toEqual([]);
    // m 2 z 24 s nábojem Ø26: volný pás pro díry je jen r 14 … 17,5 – díry Ø5 se nevejdou (hláška u řádku)
    expect(gearValidate("gear.spur", { hubD: 26, hubL: 12, holesN: 6, holesD: 5 }).issues.find((x) => x.code === "holes-fit")).toMatchObject({ key: "holesD", level: "error" });
  });
  it("výchozí hodnoty každého druhu projdou bez chyby", () => {
    for (const k of GEAR_KINDS) {
      const v = gearValidate(`gear.${k}`, {});
      expect(v.issues.filter((x) => x.level === "error"), k).toEqual([]);
    }
  });
});

describe("popisy druhů (tabulka = formulář = text)", () => {
  it("14 druhů; rowsToParams pokrývá každý klíč výchozích dat; každý prvek je zaregistrovaný a skrytý", () => {
    expect(GEAR_KINDS).toHaveLength(14);
    for (const k of GEAR_KINDS) {
      const def = KINDS[k];
      const keys = new Set(rowsToParams(def.rows).map((p) => p.key));
      for (const key of Object.keys(def.defaults())) expect(keys.has(key), `${k}.${key}`).toBe(true);
      expect(new Set(def.rows.map((r) => r.key)).size, k).toBe(def.rows.length);
      const ext = getExt(def.ext)!;
      expect(ext, def.ext).toBeDefined();
      expect(ext.hidden).toBe(true);
      expect(ext.make({} as never)).toEqual(def.defaults());
    }
    // + vstupní body balíku ui (ext/gears-entry.ts): viditelné akce průvodce a soukolí
    expect(allExt().filter((d) => d.ext.startsWith("gear.")).map((d) => d.ext).sort()).toEqual([...GEAR_KINDS.map((k) => `gear.${k}`), "gear.table", "gear.wizard", "gear.pair"].sort());
    for (const id of ["gear.wizard", "gear.pair"]) expect(getExt(id)?.action && !getExt(id)?.hidden, id).toBe(true);
  });
  it("slova textové gramatiky jsou v rámci druhu a jazyka jednoznačná (řádky, příznaky, složené zápisy)", () => {
    for (const k of GEAR_KINDS) {
      const def = KINDS[k];
      for (const lang of ["cs", "en", "de"] as const) {
        const seen = new Map<string, string>();
        const add = (w: string, owner: string, allow?: string) => {
          const key = w.toLowerCase();
          const prev = seen.get(key);
          if (prev && prev !== owner && prev !== allow) throw new Error(`${k}/${lang}: slovo „${w}“ má ${prev} i ${owner}`);
          seen.set(key, owner);
        };
        for (const r of def.rows) {
          for (const w of r.words[lang]) add(w, `row:${r.key}`);
          for (const [v, ws] of Object.entries(r.enumWords ?? {})) for (const w of ws[lang]) add(w, `enum:${r.key}=${v}`);
        }
        for (const p of def.phrases) {
          for (const w of p.words[lang]) add(w, `phrase:${p.keys[0]}`, `row:${p.keys[0]}`);
          // příznaky složeného zápisu platí jen uvnitř zápisu – smí se shodovat s příznakem řádku se stejným významem
        }
        expect(def.words[lang].length, `${k}/${lang}`).toBeGreaterThan(0);
      }
    }
    // slova druhů jsou napříč druhy jednoznačná
    for (const lang of ["cs", "en", "de"] as const) {
      const all = GEAR_KINDS.flatMap((k) => KINDS[k].words[lang].map((w) => w.toLowerCase()));
      expect(new Set(all).size, lang).toBe(all.length);
    }
  });
  it("obecný příkaz `prvek gear.*` postaví data z výchozích hodnot a klíčů", () => {
    const p = parseAgentText("prvek gear.spur m=2 z=24 b=20 bore=20 keyway=true\nprvek gear.sprocket chain=08B z=19 rows=2\nprvek gear.helical beta=15 hand=left");
    expect(p.errors).toEqual([]);
    const f = p.ops.map((o) => (o as unknown as { feature: { ext: string; data: GearData; name: string } }).feature);
    expect(f[0]).toMatchObject({ ext: "gear.spur", data: { m: 2, z: 24, b: 20, bore: 20, keyway: true, alpha: 20, out: "wheel", mode: "new" } });
    expect(f[1].data).toMatchObject({ chain: "08B", z: 19, rows: 2 });
    expect(f[2].data).toMatchObject({ beta: 15, hand: "left" });
    expect(parseAgentText("prvek gear.spur zuby=3").errors[0].message).toMatch(/neznámý parametr/);
  });
});

describe("tabulka ozubení, souhrn, seznam kol dílu", () => {
  it("řádky tabulky čelního kola obsahují W₃ 15,433 a M_dK 52,951", () => {
    const rows = gearDataRows("gear.spur", { m: 2, z: 24 });
    expect(rows.find((r) => r.key === "Wk")).toMatchObject({ symbol: "W3", value: "15,433", unit: "mm", group: "check" });
    expect(rows.find((r) => r.key === "MdK")!.value).toBe("52,951");
    expect(rows.find((r) => r.key === "d")!.value).toBe("48,000");
    const text = gearTableText("Ozubené kolo m2 z24", "gear.spur", { m: 2, z: 24 });
    expect(text[0]).toMatch(/Tabulka ozubení – Ozubené kolo m2 z24/);
    expect(text.join("\n")).toMatch(/15,433/);
    expect(text.join("\n")).toMatch(/52,951/);
  });
  it("souhrn pro `stav` a tabulky dílu", () => {
    const f = { id: "g1", name: "Ozubené kolo m2 z24", type: "ext", ext: "gear.spur", data: { ...SPUR.defaults(), bore: 20, keyway: true } } as never;
    expect(gearSummary(f)).toBe("čelní m2 z24 x0 b20 · d 48 · dₐ 52 · W3 15,433 · díra 20 pero · kolo");
    expect(gearSummary({ id: "b", name: "Kvádr", type: "box" } as never)).toBe("");
    const tables = gearTablesOf({ features: [f, { id: "x", name: "s", type: "ext", ext: "gear.rack", data: {}, suppressed: true } as never] });
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({ featureId: "g1", ext: "gear.spur" });
    for (const k of GEAR_KINDS) {
      expect(gearDataRows(`gear.${k}`, {}).length, k).toBeGreaterThan(3);
      expect(KINDS[k].summary(KINDS[k].read(KINDS[k].defaults()), KINDS[k].compute(KINDS[k].read(KINDS[k].defaults()))).length, k).toBeGreaterThan(8);
      expect(spur().kind).toBe("spur");
    }
  });
});

describe("dokument → textový skript (obecný prvek gear.*)", () => {
  it("kola s volbami se přepíšou na `prvek gear.*` a rozbor skriptu dá stejná data (zbytek zápisu `kolo …` doplní balík text)", () => {
    const feats: [string, GearData][] = [
      ["gear.spur", { m: 2.5, z: 31, b: 18, x: 0.25, bore: 20, keyway: true, hubD: 40, hubL: 12, hubSide: "both", setScrew: "M6", out: "wheel" }],
      ["gear.helical", { z: 41, beta: 12.5, hand: "left", position: [10, 0, 5], axis: { kind: "axis", axis: "X" }, turn: 4 }],
      ["gear.sprocket", { chain: "10B", z: 23, rows: 3, form: "max", bore: 25 }],
      ["gear.hypoid", { member: "wheel", z1: 9, z2: 37, E: 30 }],
      ["gear.cyclodisc", { N: 12, pinCircle: 80, pinD: 8, e: 2, part: "ring", pins: "holes" }],
    ];
    const doc = { ...emptyDoc("Kola"), features: feats.map(([ext, d], k) => ({ id: `f${k}`, name: `Kolo ${k}`, type: "ext", ext, data: { ...KINDS[ext.slice(5) as keyof typeof KINDS].defaults(), ...d } }) as unknown as Feature) };
    const sc = docToScript(doc);
    expect(sc.stats.generic, sc.text).toBe(feats.length);
    const p = parseAgentText(sc.text);
    expect(p.errors).toEqual([]);
    const got = p.ops.filter((o) => o.k === "feature").map((o) => (o as unknown as { feature: { ext: string; data: GearData } }).feature);
    expect(got.map((f) => f.ext)).toEqual(feats.map((f) => f[0]));
    got.forEach((f, k) => expect(f.data, f.ext).toMatchObject(doc.features[k].type === "ext" ? (doc.features[k] as unknown as { data: GearData }).data : {}));
  });
});

describe("soukolí všech druhů → existující příkazy", () => {
  it("každý druh soukolí se vyřeší a jeho skript projde rozborem textu bez chyb", () => {
    for (const kind of Object.keys(PAIR_ROWS) as PairKind[]) {
      const res = solvePair({ kind, values: pairDefaults(kind) });
      expect(res.issues.filter((x) => x.level === "error"), kind).toEqual([]);
      const script = pairScript(res);
      expect(script.length, kind).toBeGreaterThanOrEqual(7);
      const p = parseAgentText(script.join("\n"));
      expect(p.errors, `${kind}: ${script.join(" | ")}`).toEqual([]);
      expect(p.ops.filter((o) => o.k === "feature")).toHaveLength(2);
      expect(p.ops.filter((o) => o.k === "new")).toHaveLength(3);
      expect(p.ops.filter((o) => o.k === "insert")).toHaveLength(2);
      for (const w of res.wheels) expect(gearValidate(w.ext, w.data).ok, `${kind} ${w.name}`).toBe(true);
    }
  });
  it("příklad z návrhu: soukolí čelní m 2 z1 20 z2 60 a 81", () => {
    const s = pairScript(solvePair({ kind: "spur", values: { ...pairDefaults("spur"), m: 2, z1: 20, z2: 60, a: 81 } }));
    expect(s[0]).toBe('nový díl "Pastorek m2 z20"');
    expect(s[1]).toBe('prvek gear.spur z=20 b=21 x=0.3668 k=0.0226 bore=10 mateZ=60 aw=81 jn=0.04 name="Ozubené kolo m2 z20"');
    expect(s[4]).toBe('nová sestava "Soukolí m2 z20/z60"');
    expect(s[6]).toBe('vložit "Kolo m2 z60" v 81 0 0 otočení 0 0 177');
    expect(s[7]).toBe('sestava vazba ozubení "Pastorek m2 z20" Ø10 "Kolo m2 z60" Ø30 zuby 20 60');
  });
  it("vnitřní soukolí a hřeben mají správnou vazbu; převod i má přednost před z₂", () => {
    const int = solvePair({ kind: "internal", values: { ...pairDefaults("internal"), z1: 20, z2: 60 } });
    expect(int.mate.flip).toBe(true);
    expect(pairScript(int).at(-1)).toMatch(/vnitřní$/);
    const rack = solvePair({ kind: "rack", values: pairDefaults("rack") });
    expect(pairScript(rack).at(-1)).toMatch(/^sestava vazba hřeben "Pastorek m2 z20" Ø10 "Hřeben m2 z40" spodní modul 2 zuby 20$/);
    const byRatio = solvePair({ kind: "spur", values: { ...pairDefaults("spur"), z1: 18, i: 2.5 } });
    expect(byRatio.wheels[1].data.z).toBe(45);
    const bad = solvePair({ kind: "spur", values: { ...pairDefaults("spur"), a: 95 } });
    expect(bad.ok).toBe(false);
    expect(bad.issues[0]).toMatchObject({ key: "a" });
    expect(pairScript(bad)).toEqual([]);
  });
});

describe("nálezy revize – soukolí, kontrola zadání a formát výpisů", () => {
  const issueCodes = (r: { issues: { code: string }[] }) => r.issues.map((x) => x.code);
  it("výchozí cykloidní soukolí (m 1, z 8/60) i m 2 z 10/40: díra pastorku podle skutečné paty, vazba bez „Ø0“", () => {
    for (const values of [{}, { m: 2, z1: 10, z2: 40 }]) {
      const r = solvePair({ kind: "cycloid", values });
      expect(r.ok).toBe(true);
      expect(issueCodes(r)).not.toContain("no-bore");
      const bore1 = Number(r.wheels[0].data.bore);
      expect(bore1).toBeGreaterThan(0);
      // díra projde kontrolou těla pastorku bez chyby i varování (pod patou zůstane ≥ 1,5·m)
      expect(gearValidate(r.wheels[0].ext, r.wheels[0].data).issues.filter((x) => x.level !== "info")).toEqual([]);
      const mate = pairScript(r).find((l) => l.startsWith("sestava vazba"));
      expect(mate).toBeDefined();
      expect(mate).not.toMatch(/Ø0(?![,.\d])/);
    }
    // kolo, do kterého se díra nevejde vůbec: sestava bez vazby (žádný příkaz, který by skončil chybou) a srozumitelné varování
    const tiny = solvePair({ kind: "cycloid", values: { m: 0.3, z1: 6, z2: 40 } });
    expect(Number(tiny.wheels[0].data.bore)).toBe(0);
    expect(tiny.issues.find((x) => x.code === "no-bore")).toMatchObject({ level: "warn", key: "bore1" });
    expect(pairScript(tiny).some((l) => l.startsWith("sestava vazba"))).toBe(false);
    expect(pairScript(tiny).some((l) => l.startsWith("nová sestava"))).toBe(true);
  });
  it("šípové soukolí: pastorek stejně široký jako kolo (vrcholy šípů v jedné rovině), čelní a šikmé o 0,5·m širší", () => {
    const h = solvePair({ kind: "herringbone", values: { b: 8 } });
    expect(h.wheels[0].data.b).toBe(8);
    expect(h.wheels[1].data.b).toBe(8);
    expect(h.placement[0].at[2]).toBe(h.placement[1].at[2]);
    for (const kind of ["spur", "helical"] as const) expect(solvePair({ kind, values: { b: 8 } }).wheels[0].data.b).toBe(9);
  });
  it("vnitřní soukolí: hlavová vůle c = min(r_f2 − a_w − r_a1, r_a2 − a_w − r_f1) z kol, jak se postaví (výchozí +0,5; a 41: +0,587; m 3: +0,75)", () => {
    for (const [values, c] of [[{}, 0.5], [{ z1: 20, z2: 60, m: 2, a: 41 }, 0.587], [{ z1: 18, z2: 54, m: 3 }, 0.75]] as const) {
      const r = solvePair({ kind: "internal", values });
      const g1 = gearCompute(r.wheels[0].ext, r.wheels[0].data);
      const g2 = gearCompute(r.wheels[1].ext, r.wheels[1].data);
      const aw = r.placement[0].at[0];
      const real = Math.min(g2.rf - aw - g1.ra, g2.ra - aw - g1.rf);
      expect(real).toBeCloseTo(c, 3);
      expect(Number(r.rows.find((x) => x.key === "c")!.value.replace(",", "."))).toBeCloseTo(real, 3);
      expect(issueCodes(r)).not.toContain("clearance");
    }
  });
  it("vnitřní soukolí: 2D kontrola záběru ve 24 polohách – automatika zkrátí hlavu věnce, ruční zadání s kolizí dostane varování", async () => {
    const { meshScan, meshWheel } = await import("./mesh2d");
    for (const values of [{}, { z1: 30, z2: 50 }, { z1: 25, z2: 40 }, { z1: 18, z2: 30 }, { beta: 15, b: 6 }]) {
      const r = solvePair({ kind: "internal", values });
      expect(r.ok, JSON.stringify(values)).toBe(true);
      expect(issueCodes(r).filter((c) => c === "interference" || c === "tip-gap"), JSON.stringify(values)).toEqual([]);
      // nezávislé ověření: nejmenší vzdálenost obrysů ≥ 0,9·jₙ/(2·cos β_b), žádný průnik
      const m = Number(r.wheels[0].data.m);
      const [z1, z2] = r.mate.teeth!;
      const jn = Number(r.rows.find((x) => x.key === "jn")!.value.replace(",", "."));
      const beta = Number(r.wheels[1].data.beta ?? 0) * DEG;
      const gap0 = jn / 2 / Math.cos(Math.atan(Math.tan(beta) * Math.cos(Math.atan(Math.tan(20 * DEG) / Math.cos(beta)))));
      const A = meshWheel(gearProfile(r.wheels[0].ext, r.wheels[0].data), 0.0005 * m);
      const B = meshWheel(gearProfile(r.wheels[1].ext, r.wheels[1].data), 0.0005 * m);
      const s = meshScan(A, B, { center: [r.placement[0].at[0], 0], rot: 0 }, { center: [0, 0], rot: 0 }, { ratio: z1 / z2, steps: 36, margin: 0.3 * m });
      expect(s.cross, JSON.stringify(values)).toBe(false);
      expect(s.minGap, JSON.stringify(values)).toBeGreaterThan(0.88 * gap0);
    }
    // ruční zadání bez automatiky: 25/40 se protíná, 20/60 má u paty pastorku méně než boční vůli
    const bad = solvePair({ kind: "internal", values: { z1: 25, z2: 40, xAuto: false } });
    expect(bad.issues.find((x) => x.code === "interference")).toMatchObject({ level: "warn", key: "x2" });
    expect(issueCodes(solvePair({ kind: "internal", values: { xAuto: false } }))).toContain("tip-gap");
    // a 41 (x₂ = 0,54) je čisté i bez zkrácení hlavy
    expect(solvePair({ kind: "internal", values: { a: 41 } }).rows.find((x) => x.key === "k")!.value).toBe("0,0000");
  });
  it("2D kontrola záběru najde průnik i vzdálenost u vnějšího soukolí (kontrola modulu mesh2d)", async () => {
    const { meshScan, meshWheel } = await import("./mesh2d");
    const r = solvePair({ kind: "spur", values: { z1: 17, z2: 25, jn: 0.08 } });
    const A = meshWheel(gearProfile(r.wheels[0].ext, r.wheels[0].data), 0.001);
    const B = meshWheel(gearProfile(r.wheels[1].ext, r.wheels[1].data), 0.001);
    const pose = (aw: number) => meshScan(A, B, { center: [0, 0], rot: 0 }, { center: [aw, 0], rot: Math.PI - Math.PI / 25 }, { ratio: -17 / 25, steps: 12, margin: 0.6 });
    const ok = pose(r.placement[1].at[0]);
    expect(ok.cross).toBe(false);
    expect(ok.minGap).toBeGreaterThan(0.036);
    expect(ok.minGap).toBeLessThan(0.0405);
    expect(pose(r.placement[1].at[0] - 0.2).cross).toBe(true);
  });
  it("náboj blízko paty: chyba jen když zasahuje do zubů, jinak nejvýš varování (příklad z brífu: m 2 z 24 x 0,2 díra 20 pero náboj 40 15)", () => {
    const brief = { m: 2, z: 24, b: 20, x: 0.2, alpha: 20, bore: 20, keyway: true, hubD: 40, hubL: 15 };
    for (const out of ["wheel", "blank"]) expect(gearValidate("gear.spur", { ...brief, out }).issues).toEqual([]);
    expect(gearValidate("gear.spur", { ...brief, hubD: 43 }).issues.map((x) => [x.code, x.level])).toEqual([["hub-runout", "warn"]]);
    expect(gearValidate("gear.spur", { ...brief, hubD: 44 }).issues.map((x) => [x.code, x.level])).toEqual([["hub-root", "error"]]);
  });
  it("automatická šířka kuželového kola nepřesáhne R_e/3 (žádné varování na vlastní výchozí hodnotu)", () => {
    for (const v of [{ m: 2, z: 20, zMate: 30, sigma: 120 }, { m: 2, z: 20, zMate: 30, sigma: 60, betaM: 35 }, { m: 2, z: 10, zMate: 50 }]) {
      expect(gearValidate("gear.bevel", v).issues.map((x) => x.code)).not.toContain("b-third");
      const c = gearCompute("gear.bevel", v);
      expect(c.b).toBeLessThanOrEqual(c.Re / 3 + 1e-9);
    }
  });
  it("formát: smysl stoupání vlastním řádkem, desetinná čárka v souhrnu i v hláškách podle jazyka, díra bez pera bez „s drážkou“", () => {
    const helRows = gearDataRows("gear.helical", { beta: 15, hand: "left" });
    expect(helRows.find((x) => x.key === "beta")).toMatchObject({ value: "15,000", unit: "°" });
    expect(helRows.find((x) => x.key === "hand")!.value).toBe("levý");
    expect(gearDataRows("gear.worm", {}).find((x) => x.key === "gamma")!.value).toBe("5,7106");
    expect(gearTableText("Kolo", "gear.helical", { beta: 15, hand: "left" }).join("\n")).not.toMatch(/(levý|pravý) °/);
    const sum = gearSummary({ id: "x", name: "K", type: "ext", ext: "gear.helical", data: { z: 30, beta: 20 } } as unknown as Feature);
    expect(sum).toContain("d 63,851 · dₐ 67,851 · W4 21,668");
    expect(gearValidate("gear.spur", { z: 12 }).issues.find((x) => x.code === "undercut")!.text).toContain("x ≥ 0,3");
    const noKey = gearValidate("gear.spur", { m: 2, z: 24, bore: 45 }).issues.find((x) => x.code === "bore-root")!.text;
    expect(noKey).not.toMatch(/drážk/);
    expect(gearValidate("gear.spur", { m: 2, z: 24, bore: 40, keyway: true }).issues.find((x) => x.code === "bore-root")!.text).toMatch(/s drážkou/);
    expect(gearValidate("gear.worm", { bore: 30 }).issues.find((x) => x.code === "bore-root")!.text).not.toMatch(/drážk/);
  });
});
