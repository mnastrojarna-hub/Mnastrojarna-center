/**
 * Výpočty pružin proti ručně spočteným příkladům (vzorce EN 13906-1/-2/-3 a DIN 2092 jsou v hlavičkách modulů; zde čísla
 * dosazená krok za krokem, zaokrouhleno na 4–6 platných číslic).
 */
import { describe, expect, it } from "vitest";
import {
  almen,
  bucklingDeflection,
  calcCompression,
  calcDisc,
  calcExtension,
  calcTorsion,
  coilDeriv,
  coilPoint,
  compressionPath,
  compressionSpec,
  KINDS,
  MIN_COIL_GAP,
  pathLength,
  pitchAt,
  rmOf,
  springCalc,
  springDataAt,
  springMaterial,
  springPartGeom,
  springPathOf,
  springSummary,
  springTableText,
} from "./index";
import { emptyDoc, type Feature } from "../types";

describe("materiály EN 10270", () => {
  it("G, E, ρ a Rm(d) – tabulkové body přesně, mezi nimi log-log", () => {
    const sh = springMaterial("SH");
    expect([sh.G, sh.E, sh.rho]).toEqual([81500, 206000, 7.85]);
    expect(rmOf(sh, 2)).toBeCloseTo(1980, 6);
    expect(rmOf(sh, 1)).toBeCloseTo(2230, 6);
    // d = 1,6: mezi (1,5; 2080) a (2; 1980): k = ln(1980/2080)/ln(2/1,5) = −0,171269 → 2080 · (1,6/1,5)^k = 2057,14
    expect(rmOf(sh, 1.6)).toBeCloseTo(2057.14, 1);
    expect(springMaterial("nerez").id).toBe("1.4310");
    expect(springMaterial("1.4310").G).toBe(70000);
    expect(springMaterial("vdsicr").G).toBe(79500);
  });
});

describe("tlačná pružina EN 13906-1", () => {
  // Příklad A: d = 2, De = 20 → D = 18, n = 8, L0 = 50, broušené konce, SH, L1 = 40, L2 = 30
  const A = { d: 2, De: 20, n: 8, L0: 50, ends: "ground", material: "SH", L1: 40, L2: 30 };
  it("příklad A – tuhost, Ln, Sa, síly, napětí, frekvence, hmotnost", () => {
    const c = calcCompression(A);
    expect(c.ok).toBe(true);
    // R = G·d⁴/(8·D³·n) = 81500 · 16 / (8 · 5832 · 8) = 1 304 000 / 373 248 = 3,49365 N/mm
    expect(c.v.R).toBeCloseTo(3.49365, 4);
    // nt = n + 2 = 10, Ln = nt · d = 20 (broušené)
    expect(c.v.nt).toBe(10);
    expect(c.v.Ln).toBe(20);
    // Sa = (0,0015 · D²/d + 0,1 · d) · n = (0,0015 · 324 / 2 + 0,2) · 8 = 3,544
    expect(c.v.Sa).toBeCloseTo(3.544, 6);
    expect(c.v.Lmin).toBeCloseTo(23.544, 6);
    // F1 = R · 10 = 34,94 N, F2 = R · 20 = 69,87 N, Fn = R · 30 = 104,81 N
    expect(c.v.F1).toBeCloseTo(34.9365, 3);
    expect(c.v.F2).toBeCloseTo(69.873, 2);
    expect(c.v.Fn).toBeCloseTo(104.81, 1);
    // w = 9, k = (9 + 0,5)/(9 − 0,75) = 1,151515; τ2 = 8 · 18 · 69,873 / (π · 8) = 400,34 MPa; τk2 = 460,99 MPa
    expect(c.v.k).toBeCloseTo(1.151515, 5);
    expect(c.v.tau2).toBeCloseTo(400.34, 1);
    expect(c.v.tauk2).toBeCloseTo(460.99, 1);
    // τzul = 0,5 · Rm(2) = 0,5 · 1980 = 990
    expect(c.v.tauzul).toBeCloseTo(990, 6);
    // vzpěr ν = 0,5: 1 − (1 − G/E)/(0,5 + G/E) · (π·D/(ν·L0))² = 1 − 0,674797 · 5,11641 < 0 → nevybočí
    expect(c.v.sK).toBe(Infinity);
    // fe = d/(2π·n·D²) · √(G/(2ρ)) = 2/(2π · 8 · 324) · √(81,5e9 / 15 700) · 1000 = 1,22805e-4 · 2278,395 · 1000 = 279,8 Hz
    expect(c.v.fe).toBeCloseTo(279.8, 0);
    // l = π · D · nt = 565,487 mm, m = 7,85e-6 · π · 4/4 · 565,487 = 0,013946 kg
    expect(c.v.lw).toBeCloseTo(565.487, 2);
    expect(c.v.mass).toBeCloseTo(0.013946, 5);
    // stoupání činných závitů tvaru: (L0 − 2·zs − 2·pe)/n = (50 + 2 · 0,5 − 2 · 2,06)/8 = 5,86
    expect(c.v.p).toBeCloseTo(5.86, 6);
    expect(c.issues.filter((i) => i.level !== "info")).toEqual([]);
    // model pro sestavu
    expect(c.model!.free).toBe(50);
    expect(c.model!.solid).toBe(20);
    expect(c.model!.forceAt(30)).toBeCloseTo(69.873, 2);
  });
  it("vzpěr: ν = 2 → sK = 4,734 mm < zdvih 20 mm → varování „vybočí“", () => {
    // π·D/(ν·L0) = 56,5487/100 = 0,565487; 1 − 0,674797 · 0,319776 = 0,784214; √ = 0,885559;
    // sK = 50 · 0,5 / 0,604369 · (1 − 0,885559) = 41,3654 · 0,114441 = 4,7339
    expect(bucklingDeflection({ L0: 50, D: 18, G: 81500, E: 206000, nu: 2 })).toBeCloseTo(4.7339, 3);
    const c = calcCompression({ ...A, nu: "2" });
    expect(c.issues.some((i) => i.level === "warn" && /vybočí/.test(i.text) && i.key === "nu")).toBe(true);
  });
  it("příklad B: statická kontrola napětím bez korekce (EN 13906-1), τk2 jen jako přísnější ⚠ pro opakované zatížení (nález 5)", () => {
    // d = 1, De = 12 → D = 11, n = 6, L0 = 40, L2 = 12: R = 81500/(8 · 1331 · 6) = 1,275670; F2 = 28 · R = 35,7188 N;
    // τ2 = 8 · 11 · 35,7188/π = 1000,53 (90 % τzul) – staticky vyhoví; k = 11,5/10,25 = 1,121951; τk2 = 1122,55; τzul = 0,5 · 2230 = 1115 → 101 %
    const c = calcCompression({ d: 1, De: 12, n: 6, L0: 40, L2: 12, material: "SH" });
    expect(c.v.R).toBeCloseTo(1.27567, 5);
    expect(c.v.tau2).toBeCloseTo(1000.53, 1);
    expect(c.v.tauk2).toBeCloseTo(1122.55, 1);
    const w = c.issues.filter((i) => i.key === "L2");
    expect(w.map((i) => i.text)).toEqual([expect.stringMatching(/^při stlačení na L2 je napětí s korekcí k 101 % dovoleného \(τk2 = 1123 MPa\) – staticky vyhoví \(τ2 90 %\)/)]);
    // na dorazu: Fn = R · 32 = 40,8214 N, τn = 8 · 11 · 40,8214/π = 1143,5 MPa = 103 % → ⚠ sedne (bez korekce; τkn 115 % by hlásil i menší)
    expect(c.v.taun).toBeCloseTo(1143.47, 1);
    expect(c.issues.find((i) => i.key === "Ln")?.text).toMatch(/na doraz Ln je napětí 103 % dovoleného – pružina by sedla/);
    // spočtené řádky: τ2 (statická kontrola) i τk2 (opakované zatížení)
    expect(c.rows.find((r) => r.key === "tau2")?.text).toBe("1001 MPa (90 %)");
    expect(c.rows.find((r) => r.key === "tauk2")?.level).toBe("warn");
    // staticky nevyhoví: L2 8,5 → F2 = 31,5 · R = 40,1836 N, τ2 = 1125,6 MPa = 101 % τzul
    const hot = calcCompression({ d: 1, De: 12, n: 6, L0: 40, L2: 8.5, material: "SH" });
    expect(hot.v.tau2).toBeCloseTo(1125.6, 0);
    expect(hot.issues.some((i) => i.key === "L2" && /^při stlačení na L2 je napětí 101 % dovoleného \(τ2 = 1126 MPa, τzul = 1115 MPa, statická kontrola EN 13906-1\)/.test(i.text))).toBe(true);
    // pod oběma mezemi žádné varování napětí (příklad A: τ2 40 %, τk2 47 %)
    expect(calcCompression(A).issues.filter((i) => i.key === "L2" || i.key === "Ln")).toEqual([]);
  });
  it("síla nad silou na doraz: ✗ u řádku síly, ne záporná délka u nevyplněné L2 (nález 6)", () => {
    // d 2 De 20 n 8 L0 60: R = 3,49365, Ln = 20, Fn = R · 40 = 139,75 N < F2 500 N
    for (const L0 of [60, 50]) {
      const c = calcCompression({ d: 2, De: 20, n: 8, L0, F2: 500 });
      expect(c.ok).toBe(false);
      const e = c.issues.filter((i) => i.level === "error");
      expect(e.map((i) => i.key)).toEqual(["F2"]);
      expect(e[0].text).toMatch(new RegExp(`^síla F2 500 N je větší než síla na doraz Fn ${L0 === 60 ? "139,7" : "104,8"} N – pružina ji nepřenese \\(stlačí se nejvýš na Ln 20 mm\\)`));
      expect(c.issues.some((i) => /-\d/.test(i.text))).toBe(false);
      expect(c.v.L2).toBeUndefined();
    }
    // síla do Fn dál dá délku
    expect(calcCompression({ d: 2, De: 20, n: 8, L0: 50, F2: 69.873 }).v.L2).toBeCloseTo(30, 3);
  });
  it("volná délka pod Ln + Sa bez pracovního bodu: ⚠ u L0 – nemá přípustný zdvih (nález 7)", () => {
    // Ln = 20, Sa = 3,544 → Ln + Sa = 23,544 > L0 20,5
    const c = calcCompression({ d: 2, De: 20, n: 8, L0: 20.5 });
    expect(c.ok).toBe(true);
    const w = c.issues.find((i) => i.key === "L0");
    expect(w?.level).toBe("warn");
    expect(w?.text).toMatch(/volná délka L0 20,5 mm je kratší než nejmenší pracovní délka Ln \+ Sa = 23,54 mm – pružina nemá přípustný pracovní zdvih/);
    expect(calcCompression({ d: 2, De: 20, n: 8, L0: 24 }).issues.find((i) => i.key === "L0")).toBeUndefined();
  });
  it("zadání průměrem D / Di, závity nt, sílou místo délky; neobroušené a otevřené konce", () => {
    const viaD = calcCompression({ d: 2, D: 18, nt: 10, L0: 50, F2: 69.873 });
    expect(viaD.v.n).toBe(8);
    expect(viaD.v.L2).toBeCloseTo(30, 3);
    expect(calcCompression({ d: 2, Di: 16, n: 8, L0: 50 }).v.De).toBe(20);
    // neobroušené: Ln = (nt + 1,5) · d = 23; otevřené: nt = n, Ln = (n + 1) · d = 18
    expect(calcCompression({ ...A, ends: "closed" }).v.Ln).toBe(23);
    const open = calcCompression({ ...A, ends: "open" });
    expect(open.v.nt).toBe(8);
    expect(open.v.Ln).toBe(18);
  });
  it("chyby u řádků: chybějící údaje, L0 pod Ln, L2 pod dorazem / pod Ln + Sa", () => {
    const empty = calcCompression({});
    expect(empty.ok).toBe(false);
    expect(empty.issues.map((i) => i.key)).toEqual(["d", "De", "L0", "n"]);
    expect(calcCompression({ ...A, L0: 19 }).issues.some((i) => i.level === "error" && i.key === "L0")).toBe(true);
    expect(calcCompression({ ...A, L2: 18 }).issues.find((i) => i.key === "L2")?.level).toBe("error");
    expect(calcCompression({ ...A, L2: 22 }).issues.find((i) => i.key === "L2")?.text).toMatch(/Ln \+ Sa/);
    expect(calcCompression({ ...A, De: 6 }).issues.find((i) => i.key === "De")?.level).toBe("error"); // D = 4, w = 2 → nelze navinout
    expect(calcCompression({ ...A, De: 9 }).issues.find((i) => i.key === "De")?.level).toBe("warn"); // D = 7, w = 3,5 < 4
  });
});

describe("tažná pružina EN 13906-2", () => {
  it("d 1,6 · De 12 · n 12 · F0 5 N · německá očka", () => {
    const c = calcExtension({ d: 1.6, De: 12, n: 12, F0: 5, loop: "german", material: "SH", L2: 50 });
    // R = 81500 · 1,6⁴ / (8 · 10,4³ · 12) = 534 118,4 / 107 986,9 = 4,94614 N/mm
    expect(c.v.R).toBeCloseTo(4.94614, 4);
    // Lk = (n + 1) · d = 20,8; LH = Di = 8,8; L0 = 38,4
    expect(c.v.Lk).toBeCloseTo(20.8, 9);
    expect(c.v.LH1).toBeCloseTo(8.8, 9);
    expect(c.v.L0).toBeCloseTo(38.4, 9);
    // τ0 = 8 · 10,4 · 5 / (π · 4,096) = 32,33 MPa; F2 = 5 + R · 11,6 = 62,375 N; τzul = 0,45 · 2057,14 = 925,71
    expect(c.v.tau0).toBeCloseTo(32.33, 1);
    expect(c.v.F2).toBeCloseTo(62.375, 2);
    expect(c.v.tauzul).toBeCloseTo(925.71, 0);
    expect(c.model!.forceAt(38.4)).toBeCloseTo(5, 6);
    // natočení oček 90° → n = 12,25
    expect(calcExtension({ d: 1.6, De: 12, n: 12, angle: 90 }).v.n).toBe(12.25);
    expect(calcExtension({ d: 1.6, De: 12, n: 12, L1: 30 }).issues.find((i) => i.key === "L1")?.level).toBe("error");
    // největší síla staticky bez korekce (EN 13906-2): Fn = τzul · π · d³ / (8 · D) = 925,71 · 12,868 / 83,2 = 143,17 N,
    // Ln = L0 + (Fn − F0) / R = 38,4 + 138,17 / 4,94614 = 66,33 mm (dřív s k = 1,1037: 129,7 N)
    expect(c.v.Fn).toBeCloseTo(143.17, 1);
    expect(c.v.Ln).toBeCloseTo(66.33, 1);
    expect(c.v.tau2).toBeCloseTo((8 * 10.4 * c.v.F2) / (Math.PI * 4.096), 6);
  });
});

describe("zkrutná pružina EN 13906-3", () => {
  it("d 2 · De 20 · n 6,25 · tečná ramena 25 mm · α2 60°", () => {
    const c = calcTorsion({ d: 2, De: 20, n: 6.25, l1: 25, l2: 25, a2: 60, material: "SH" });
    // nef = 6,25 + 50/(3π · 18) = 6,544731; RM = 206000 · 16 / (3667 · 18 · 6,544731) = 7,62977 N·mm/°
    expect(c.v.nef).toBeCloseTo(6.544731, 5);
    expect(c.v.RM).toBeCloseTo(7.62977, 4);
    // M2 = 457,79 N·mm; σ = 32 · M / (π · 8) = 582,88; q = 9,07/8,25 = 1,099394; σq = 640,81 MPa
    expect(c.v.M2).toBeCloseTo(457.79, 1);
    expect(c.v.sq2).toBeCloseTo(640.81, 1);
    expect(c.v.Lk0).toBeCloseTo(15.5, 9);
    expect(c.v.legAngle).toBeCloseTo(90, 9);
    expect(c.model!.torqueAt!(60)).toBeCloseTo(457.79, 1);
  });
});

describe("talířová pružina DIN 2093 / DIN 2092", () => {
  it("A 40 × 20,4 × 2,25: K1, síla při 0,75 h0 ≈ 6,5 kN (tabulka DIN 2093), sloupec 4 × 2", () => {
    // δ = 1,96078; K1 = (1/π)·(0,49)² / (3,08164 − 2,97026) = 0,68617
    const a = almen({ De: 40, Di: 20.4, t: 2.25, h0: 0.9, E: 206000 });
    expect(a.K1).toBeCloseTo(0.6862, 3);
    // F(0,675) = 905 494,5 · 2,25⁴ / (0,68617 · 1600) · 0,3 · [(0,4 − 0,3)(0,4 − 0,15) + 1] ≈ 6500 N
    expect(a.F(0.675)).toBeGreaterThan(6400);
    expect(a.F(0.675)).toBeLessThan(6600);
    // σOM naplocho = −905 494,5 · 5,0625 / (0,68617 · 1600) · 0,4 · 3/π ≈ −1595 MPa
    expect(a.sOM(0.9)).toBeCloseTo(-1595, -1);
    const c = calcDisc({ series: "A", De: 40, ns: 4, np: 2, L2: 19.2 });
    // L0 = ns · (h0 + np · t) = 4 · 5,4 = 21,6; Lc = 18; s2 = (21,6 − 19,2)/4 = 0,6 ≤ 0,75 · h0
    expect(c.v.L0).toBeCloseTo(21.6, 9);
    expect(c.v.Lc).toBeCloseTo(18, 9);
    expect(c.v.F2).toBeCloseTo(2 * a.F(0.6), 6);
    expect(calcDisc({ series: "A", De: 41 }).ok).toBe(false);
    expect(calcDisc({ series: "A", De: 40, L2: 18.5 }).issues.some((i) => i.level === "warn")).toBe(false);
  });
});

describe("střednice tlačné pružiny", () => {
  const s = compressionSpec({ d: 2, D: 18, n: 8, L0: 50, ends: "ground" });
  it("začátek −d/4, konec L0 + d/4, stoupání závěrných závitů ≈ d, činných pa, plynulý přechod", () => {
    expect(coilPoint(s, 0)[2]).toBeCloseTo(-0.5, 9);
    expect(coilPoint(s, 2 * Math.PI * 10)[2]).toBeCloseTo(50.5, 9);
    expect(pitchAt(s, 0.2)).toBeCloseTo(2.06, 9);
    expect(pitchAt(s, 5)).toBeCloseTo(5.86, 9);
    // spojitost výšky a derivace (numericky) po celé délce
    for (let u = 0.01; u < 10; u += 0.0731) {
      const t = 2 * Math.PI * u;
      const e = 1e-6;
      const num = (coilPoint(s, t + e)[2] - coilPoint(s, t - e)[2]) / (2 * e);
      expect(num).toBeCloseTo(coilDeriv(s, t)[2], 5);
    }
  });
  it("tvar v kratší délce: stejné závity, menší stoupání; pod geometrickým dorazem se nezkracuje", () => {
    const short = compressionSpec({ d: 2, D: 18, n: 8, L0: 50, ends: "ground", L: 30 });
    expect(coilPoint(short, 2 * Math.PI * 10)[2]).toBeCloseTo(30.5, 9);
    expect(short.pa).toBeCloseTo((31 - 4.12) / 8, 9);
    const solid = compressionSpec({ d: 2, D: 18, n: 8, L0: 50, ends: "ground", L: 5 });
    expect(solid.pa).toBeCloseTo(solid.pe, 9);
    expect(solid.pe).toBeCloseTo(2 * (1 + MIN_COIL_GAP), 9);
  });
  it("tvar dosáhne délky na doraz Ln i u mnoha závitů (nález 8): broušené / neobroušené přesně, otevřené o ≤ 0,2 % · n · d", () => {
    for (const n of [8, 12, 17, 20, 30, 60, 90])
      for (const ends of ["ground", "closed", "open"] as const) {
        const nt = n + (ends === "open" ? 0 : 2);
        const Ln = ends === "ground" ? nt * 2 : ends === "closed" ? (nt + 1.5) * 2 : (nt + 1) * 2;
        const sp = compressionSpec({ d: 2, D: 18, n, L0: Ln * 2, ends, L: Ln });
        if (ends === "open") expect(sp.L - Ln, `n ${n} ${ends}`).toBeLessThanOrEqual(MIN_COIL_GAP * n * 2 + 1e-9);
        else expect(sp.L, `n ${n} ${ends}`).toBeCloseTo(Ln, 9);
        // závity se neprotnou: stoupání všude aspoň d · (1 + MIN_COIL_GAP)
        expect(Math.min(sp.pe, sp.pa), `n ${n} ${ends}`).toBeGreaterThanOrEqual(2 * (1 + MIN_COIL_GAP) - 1e-12);
        // konec střednice = L − zs (souměrně)
        expect(coilPoint(sp, 2 * Math.PI * (n + 2 * sp.ne))[2]).toBeCloseTo(sp.L - sp.zs, 9);
      }
    // příklad recenze: d 2 De 20 broušené n 20 → tvar 44 (dřív 44,32), n 30 → 64 (64,92), neobroušené n 30 → 67 (67,92)
    const at = (n: number, ends: "ground" | "closed", L: number) => springPathOf("spring.compression", { d: 2, De: 20, n, L0: 2 * L, ends }, L)!;
    expect(at(20, "ground", 44).clip).toEqual([0, 44]);
    expect(at(30, "ground", 64).clip).toEqual([0, 64]);
    const closed = at(30, "closed", 67);
    expect(Math.max(...closed.pts.map((p) => p[2])) + 1).toBeCloseTo(67, 6); // vrchol střednice + d/2
  });
  it("délka drátu ≈ π·D na závit (± stoupání)", () => {
    const p = compressionPath(s, 96);
    const L = pathLength(p);
    expect(L).toBeGreaterThan(Math.PI * 18 * 10);
    expect(L).toBeLessThan(Math.PI * 18 * 10 * 1.01);
    expect(p.clip).toEqual([0, 50]);
  });
});

describe("registr, souhrn a data pro sestavu", () => {
  it("KINDS, springCalc podle id, springPathOf, springDataAt, springPartGeom, souhrn a tabulka", () => {
    expect(Object.keys(KINDS)).toEqual(["compression", "extension", "torsion", "disc"]);
    expect(springCalc("spring.compression", KINDS.compression.defaults()).ok).toBe(true);
    for (const k of Object.values(KINDS)) expect(k.calc(k.defaults()).ok, k.kind).toBe(true);
    const data = { ...KINDS.compression.defaults(), at: [1, 2, 3], axis: "X" };
    expect(springPathOf("spring.compression", springDataAt(data, 40))!.clip).toEqual([0, 40]);
    expect(springPathOf("spring.extension", KINDS.extension.defaults())!.pts.length).toBeGreaterThan(100);
    const f: Feature = { id: "s", name: "Pružina 1", type: "ext", ext: "spring.compression", data } as Feature;
    const doc = { ...emptyDoc("P"), features: [f] };
    const g = springPartGeom(doc)!;
    expect(g.axis).toEqual([1, 0, 0]);
    expect(g.base).toEqual([1, 2, 3]);
    expect(g.free).toBe(50);
    expect(g.solid).toBe(20);
    expect(springSummary(f)).toMatch(/tlačná d 2 · De 20 · L0 50 · n 8/);
    const lines = springTableText("Pružina 1", "spring.compression", data);
    expect(lines[0]).toMatch(/Pružina „Pružina 1“ – Tlačná pružina \(EN 13906-1\)/);
    expect(lines.some((l) => /tuhost R: 3,494 N\/mm/.test(l))).toBe(true);
  });
});
