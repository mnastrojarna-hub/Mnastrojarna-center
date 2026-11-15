/**
 * Regrese z recenze vlny 21 (dynamická pohybová studie, cad/motion-dynamic.ts) – analytické případy bez jádra:
 * 1) natočení na čepu se zatížením mimo těžiště: moment 1 N·m na tělese 1 kg s těžištěm 100 mm od osy (I_O = I_c + m·l² =
 *    16,67 + 10 000 = 10 016,7 kg·mm²): θ(t) = τ·t² / (2·I_O) = 1e6·0,05² / (2·10 016,7) = 0,12479 rad, ω = τ·t / I_O = 4,9917 rad/s
 *    (dřív θ 0,498 rad při dt 0,5 ms – poloha neodpovídala rychlosti);
 *    fyzické kyvadlo 1 kg, l = 100 mm, 5°: T0 = 2π·√(I_O / (m·g·l)) = 2π·√(10 016,7 / 981 000) = 0,63491 s, s amplitudou
 *    T ≈ T0·(1 + θ0²/16) = 0,63521 s; amplituda (energie) stálá přes 10 kmitů (dřív −22 % energie při T/400);
 *    páka na dvou pružinách 1 N/mm ve 100 mm, těžiště v 50 mm: I_O = m·(100² + 10²)/12 + m·50² = 3 341,7 kg·mm²,
 *    k_θ = 2·c·r² = 2·1000·0,1² = 20 N·m/rad → T = 2π·√(I_O·1e-6 / 20) = 0,081217 s; amplituda stálá (dřív −16 % za 4 kmity);
 * 2) kontrola energie nezávisí na umístění modelu (polohová energie tíže od výchozí polohy, vztažení k největší kinetické energii);
 * 5) pružina bez zadané tuhosti: tuhost z geometrie dílu R = G·d⁴ / (8·D³·n) = 81 500·2⁴ / (8·16³·8) = 4,9744 N/mm (prvek Pružina
 *    r 8, drát 2, 8 závitů) → kmit 2π·√(m / (2·R)) = 2π·√(1 / 9 948,8) = 0,062993 s; díl bez drátu (trubka) bez tuhosti = ⚠;
 * 6) „a max“ ze všech kroků a bez rázu na dorazu: pád 0,5 kg na doraz → a max = g = 9,81 m/s² při každém dt (dřív 6 258 m/s²
 *    nebo 9,81 podle toho, zda krok nárazu padl na zaznamenaný snímek).
 */
import { describe, expect, it, vi } from "vitest";
import type { FaceGeo, GeoProvider } from "./mates";
import { runDynamic, type DynMotionStep, type DynResult } from "./motion-dynamic";
import { dynamicLines } from "./motion-dynamic-report";
import type { CompInertia } from "./motion-mass";
import { emptyDoc, uid, type AsmComponent, type CadDoc, type MateRef, type Placement, type SpringDef, type Vec3 } from "./types";

vi.setConfig({ testTimeout: 120000 });
type Geos = Record<string, Record<string, FaceGeo>>;
const provider = (G: Geos): GeoProvider => (r) => G[r.compId]?.[`f${r.face}`] ?? null;
const P = (position: Vec3 = [0, 0, 0], rotation: Vec3 = [0, 0, 0]): Placement => ({ position, rotation });
const comp = (id: string, placement: Placement, fixed = false): AsmComponent => ({ id, name: id, source: { kind: "part", doc: emptyDoc(id) }, placement, ...(fixed ? { fixed: true } : {}) });
const f = (compId: string, face: number): MateRef => ({ compId, face });
const plane = (origin: Vec3, normal: Vec3): FaceGeo => ({ kind: "plane", origin, normal });
const cyl = (origin: Vec3, normal: Vec3, radius: number): FaceGeo => ({ kind: "cylinder", origin, normal, radius });
const Z: Vec3 = [0, 0, 1];
const NZ: Vec3 = [0, 0, -1];
const Y: Vec3 = [0, 1, 0];
function springComp(id: string, at: Vec3, def: SpringDef, tube = false): AsmComponent {
  const feat = tube
    ? { id: uid(), name: "Trubka", type: "tube" as const, outer: 20, inner: 10, height: 42, position: [0, 0, 0] as Vec3, axis: "Z" as const, mode: "new" as const }
    : { id: uid(), name: "Pružina", type: "spring" as const, radius: 8, pitch: 5, turns: 8, wire: 2, position: [0, 0, 1] as Vec3, axis: "Z" as const, mode: "new" as const };
  const doc = { ...emptyDoc(id), features: [feat] } as CadDoc;
  return { id, name: id, source: { kind: "part", doc }, placement: P(at), spring: def };
}
const box = (mass: number, a: number, b: number, c: number, com: Vec3 = [0, 0, 0]): CompInertia => ({ mass, com, I: [(mass * (b * b + c * c)) / 12, 0, 0, 0, (mass * (a * a + c * c)) / 12, 0, 0, 0, (mass * (a * a + b * b)) / 12], source: "manual" });
const stepsOf = (r: DynResult) => r.steps as DynMotionStep[];
const upCross = (t: number[], x: number[], lvl: number) => {
  const up: number[] = [];
  for (let i = 1; i < x.length; i++) if (x[i - 1] < lvl && x[i] >= lvl) up.push(t[i - 1] + ((lvl - x[i - 1]) / (x[i] - x[i - 1])) * (t[i] - t[i - 1]));
  return up;
};
/** těleso K na čepu (Souosost s osou Y v počátku) */
const hinge = (rotY = 0): CadDoc => ({ ...emptyDoc("Čep"), kind: "assembly", components: [comp("B", P(), true), comp("K", P([0, 0, 0], [0, rotY, 0]))], mates: [{ id: "c", type: "concentric", a: f("K", 0), b: f("B", 0) }] });
const hingeGeo = provider({ B: { f0: cyl([0, 0, 0], Y, 5) }, K: { f0: cyl([0, 0, 0], Y, 5) } });
const IO = (1 * 200) / 12 + 1 * 100 * 100;

describe("recenze 1: natočení na čepu se zatížením mimo těžiště", () => {
  it("moment 1 N·m: θ = τ·t²/(2·I_O) a ω = τ·t/I_O při výchozím kroku 0,5 ms", async () => {
    const res = await runDynamic(hinge(), hingeGeo, { motors: [], duration: 0.05, steps: 10, mode: "dynamic", dyn: { dt: 0.0005, gravity: null, loads: [{ mate: "c", kind: "torque", value: 1 }] } }, { inertia: (id) => (id === "K" ? box(1, 10, 10, 10, [0, 0, -100]) : null), maxFrames: 100000 });
    const last = res.steps[res.steps.length - 1];
    const th = Math.abs(Math.atan2(last.dyn!.K.p[0], -last.dyn!.K.p[2]));
    const w = Math.hypot(...last.dyn!.K.v) / 100;
    expect(Math.abs(th - (1e6 * 0.05 ** 2) / (2 * IO)) / ((1e6 * 0.05 ** 2) / (2 * IO))).toBeLessThan(0.001);
    expect(Math.abs(w - (1e6 * 0.05) / IO) / ((1e6 * 0.05) / IO)).toBeLessThan(0.001);
    // natočení dílu (Eulerův úhel Y) = θ: poloha je integrál rychlosti
    expect(Math.abs(Math.abs(last.place.K.rotation[1]) * (Math.PI / 180) - th)).toBeLessThan(1e-4);
    // práce momentu = kinetická energie ½·I_O·ω²
    expect(res.dynamic.energy.applied).toBeCloseTo((0.5 * IO * ((1e6 * 0.05) / IO) ** 2) * 1e-6, 3);
  });

  it("fyzické kyvadlo 5°: perioda T0·(1 + θ0²/16), amplituda a energie stálé přes 10 kmitů (dt = T/400)", async () => {
    const T0 = 2 * Math.PI * Math.sqrt(IO / (1 * 9810 * 100));
    const th0 = (5 * Math.PI) / 180;
    const T = T0 * (1 + th0 ** 2 / 16);
    const res = await runDynamic(hinge(5), hingeGeo, { motors: [], duration: 10.2 * T, steps: 10, mode: "dynamic", dyn: { dt: T / 400 } }, { inertia: (id) => (id === "K" ? box(1, 10, 10, 10, [0, 0, -100]) : null), maxFrames: 100000 });
    const t = res.steps.map((s) => s.t);
    const x = stepsOf(res).map((s) => s.dyn!.K.p[0]);
    const up = upCross(t, x, 0);
    expect(up.length).toBeGreaterThanOrEqual(10);
    const per = (up[up.length - 1] - up[0]) / (up.length - 1);
    expect(Math.abs(per - T) / T).toBeLessThan(0.002);
    // amplituda v posledním kmitu = v prvním (dřív 8,716 → 7,695 mm)
    const amp = (k: number) => Math.max(...stepsOf(res).filter((s) => s.t >= k * T && s.t < (k + 1) * T).map((s) => Math.abs(s.dyn!.K.p[0])));
    expect(Math.abs(amp(9) - amp(0)) / amp(0)).toBeLessThan(0.001);
    // energie celá: ½·m·v² + ½·I_c·ω² + m·g·z (ω = |v| / l) – kolísání pod 0,5 %
    const Ic = 200 / 12;
    const E = stepsOf(res).map((s) => {
      const v2 = s.dyn!.K.v.reduce((a, b) => a + b * b, 0);
      return 0.5 * v2 * 1e-6 + 0.5 * Ic * (v2 / 1e4) * 1e-6 + 9.81 * (s.dyn!.K.p[2] + 100) * 1e-3;
    });
    expect((Math.max(...E) - Math.min(...E)) / E[0]).toBeLessThan(0.005);
    // a protokol to říká stejně (odchylka vůči největší kinetické energii)
    expect(res.dynamic.energy.drift!).toBeLessThan(0.005);
    expect(res.dynamic.energy.ref).toBeCloseTo(res.dynamic.energy.kinMax, 12);
  });

  it("páka na dvou pružinách (těžiště 50 mm, pružiny 100 mm): perioda 2π·√(I_O/k_θ), amplituda stálá při kroku 0,5 ms", async () => {
    const G: Geos = {
      B: { f0: cyl([0, 0, 0], Y, 5), f1: plane([0, 0, -50], Z), f2: plane([0, 0, 50], NZ) },
      K: { f0: cyl([0, 0, 0], Y, 5), f1: plane([100, 0, 0], NZ), f2: plane([100, 0, 0], Z) },
    };
    const doc: CadDoc = {
      ...emptyDoc("Páka"),
      kind: "assembly",
      components: [comp("B", P(), true), comp("K", P([0, 0, 0], [0, 2, 0])), springComp("S1", [100, 0, -50], { a: f("B", 1), b: f("K", 1), free: 60, rate: 1 }), springComp("S2", [100, 0, 0], { a: f("K", 2), b: f("B", 2), free: 60, rate: 1 })],
      mates: [{ id: "c", type: "concentric", a: f("K", 0), b: f("B", 0) }],
    };
    const Il = (1 * (100 * 100 + 10 * 10)) / 12 + 1 * 50 * 50;
    const T = 2 * Math.PI * Math.sqrt((Il * 1e-6) / (2 * 1000 * 0.1 * 0.1));
    const res = await runDynamic(doc, provider(G), { motors: [], duration: 5.2 * T, steps: 10, mode: "dynamic", dyn: { dt: 0.0005, gravity: null } }, { inertia: (id) => (id === "K" ? box(1, 100, 10, 10, [50, 0, 0]) : null), maxFrames: 100000 });
    const t = res.steps.map((s) => s.t);
    const z = stepsOf(res).map((s) => s.dyn!.K.p[2]);
    const up = upCross(t, z, 0);
    expect(Math.abs((up[up.length - 1] - up[0]) / (up.length - 1) - T) / T).toBeLessThan(0.01);
    const amp = (k: number) => Math.max(...stepsOf(res).filter((s) => s.t >= k * T && s.t < (k + 1) * T).map((s) => Math.abs(s.dyn!.K.p[2])));
    expect(Math.abs(amp(4) - amp(0)) / amp(0)).toBeLessThan(0.005); // dřív 1,745 → 1,463 mm
    expect(res.dynamic.energy.drift!).toBeLessThan(0.005);
    expect(Math.abs(res.dynamic.energy.end - res.dynamic.energy.e0) / res.dynamic.energy.kinMax).toBeLessThan(0.005);
  });
});

/** hmota S na sloupku mezi dvěma pružinami (jako motion-dynamic.test.ts), celé posunuté o `dz` */
function oscillator(dz: number, def: Partial<SpringDef> = { rate: 10 }, tube = false) {
  const G: Geos = {
    B: { f0: cyl([0, 0, dz], Z, 5), f1: plane([0, 0, dz], Z) },
    T: { f1: plane([0, 0, 100 + dz], NZ) },
    S: { f0: cyl([0, 0, 0], Z, 5), f1: plane([0, 0, 0], NZ), f2: plane([0, 0, 10], Z) },
  };
  const doc: CadDoc = {
    ...emptyDoc("Kmitání"),
    kind: "assembly",
    components: [
      comp("B", P(), true),
      comp("T", P(), true),
      comp("S", P([0, 0, 43 + dz])),
      springComp("SP1", [30, 0, dz], { a: f("B", 1), b: f("S", 1), free: 50, ...def }, tube),
      springComp("SP2", [30, 0, 60 + dz], { a: f("S", 2), b: f("T", 1), free: 50, ...def }, tube),
    ],
    mates: [{ id: "c", type: "concentric", a: f("S", 0), b: f("B", 0) }],
  };
  return { doc, geo: provider(G) };
}
const massS = (id: string): CompInertia | null => (id === "S" ? box(1, 40, 40, 10, [0, 0, 5]) : null);

describe("recenze 2: kontrola energie nezávisí na umístění modelu", () => {
  it("stejný kmit posunutý o 1 000 mm v Z s gravitací: stejná odchylka, stejná výchozí energie, vztaženo k ½·k·A²", async () => {
    const T = 2 * Math.PI * Math.sqrt(1 / 20000);
    const run = (dz: number) => {
      const { doc, geo } = oscillator(dz);
      return runDynamic(doc, geo, { motors: [], duration: 3.1 * T, steps: 10, mode: "dynamic", dyn: { dt: T / 300 } }, { inertia: massS, maxFrames: 100000 });
    };
    const a = await run(0);
    const b = await run(1000);
    expect(b.dynamic.energy.drift!).toBeCloseTo(a.dynamic.energy.drift!, 6);
    expect(b.dynamic.energy.e0).toBeCloseTo(a.dynamic.energy.e0, 9);
    // e0 bez polohové energie tíže vůči počátku: jen pružiny (½·c·(7² + 3²) ·2 … ) – kladná a malá
    expect(a.dynamic.energy.e0).toBeGreaterThan(0);
    expect(a.dynamic.energy.e0).toBeLessThan(1);
    // vztažná energie = největší kinetická (kmit kolem rovnováhy posunuté o m·g/k)
    expect(a.dynamic.energy.ref).toBeCloseTo(a.dynamic.energy.kinMax, 12);
    const line = dynamicLines(a, oscillator(0).doc).find((l) => /Kontrola energie/.test(l))!;
    expect(line).toMatch(/odchylka [\d,]+ % z [\d,]+ J \(největší pohybová energie/);
  });
});

describe("recenze 5: pružina bez zadané tuhosti", () => {
  it("tuhost z geometrie dílu R = G·d⁴/(8·D³·n): kmit 2π·√(m/(2R)) a řádek protokolu", async () => {
    const R = (81500 * 2 ** 4) / (8 * 16 ** 3 * 8);
    const T = 2 * Math.PI * Math.sqrt(1 / (2 * R * 1000));
    const { doc, geo } = oscillator(0, {});
    const res = await runDynamic(doc, geo, { motors: [], duration: 5.2 * T, steps: 10, mode: "dynamic", dyn: { dt: T / 400, gravity: null } }, { inertia: massS, maxFrames: 100000 });
    expect(res.dynamic.springRates).toEqual([
      { id: "SP1", rate: expect.closeTo(R, 9), source: "geometry" },
      { id: "SP2", rate: expect.closeTo(R, 9), source: "geometry" },
    ]);
    const z = res.steps.map((s) => s.place.S.position[2]);
    const up = upCross(res.steps.map((s) => s.t), z, 45);
    expect(Math.abs((up[up.length - 1] - up[0]) / (up.length - 1) - T) / T).toBeLessThan(0.01);
    // síly pružin v krocích (z geometrické tuhosti) a protokol
    expect(Math.max(...res.steps.map((s) => s.springs!.SP1.force ?? 0))).toBeCloseTo(R * 7, 1);
    const lines = dynamicLines(res, doc);
    expect(lines.some((l) => /pružina „SP1“: tuhost 4,974 N\/mm z geometrie dílu/.test(l))).toBe(true);
  });

  it("díl bez drátu (trubka) a bez tuhosti: ⚠ nepůsobí silou – těleso padá volně", async () => {
    const { doc, geo } = oscillator(0, {}, true);
    const res = await runDynamic(doc, geo, { motors: [], duration: 0.05, steps: 10, mode: "dynamic", dyn: { dt: 0.0005 } }, { inertia: massS });
    expect(res.dynamic.springRates.map((r) => r.source)).toEqual(["none", "none"]);
    expect(dynamicLines(res, doc).filter((l) => /⚠ pružina „SP\d“ nemá tuhost a díl není drátová pružina – v dynamice nepůsobí silou/.test(l)).length).toBe(2);
    // volný pád ½·g·t² = 12,26 mm
    expect(43 - res.steps[res.steps.length - 1].place.S.position[2]).toBeCloseTo(0.5 * 9810 * 0.05 ** 2, 1);
  });
});

describe("recenze 6: a max bez rázu na dorazu a ze všech kroků", () => {
  it("pád 0,5 kg na doraz (odraz 0): a max = g při dt 1e-4 / 5e-5 / 2,5e-5, v max = rychlost nárazu", async () => {
    const G: Geos = { B: { f0: cyl([0, 0, 0], Z, 5), f1: plane([0, 0, 0], Z) }, S: { f0: cyl([0, 0, 0], Z, 5), f1: plane([0, 0, 0], NZ) } };
    const doc: CadDoc = { ...emptyDoc("Pád"), kind: "assembly", components: [comp("B", P(), true), comp("S", P([0, 0, 40]))], mates: [{ id: "c", type: "concentric", a: f("S", 0), b: f("B", 0) }, { id: "lim", type: "limitDistance", a: f("S", 1), b: f("B", 1), min: 20, max: 200, name: "Doraz" }] };
    const vHit = Math.sqrt(2 * 9810 * 20);
    for (const dt of [0.0001, 0.00005, 0.000025]) {
      const res = await runDynamic(doc, provider(G), { motors: [], duration: 0.1, steps: 10, mode: "dynamic", dyn: { dt, restitution: 0 } }, { inertia: (id) => (id === "S" ? box(0.5, 20, 20, 10) : null) });
      const pk = res.dynamic.peaks.S;
      expect(pk.a / 9810).toBeCloseTo(1, 2);
      expect(Math.abs(pk.v - vHit) / vHit).toBeLessThan(0.01);
      const line = dynamicLines(res, doc).find((l) => /„S“/.test(l))!;
      expect(line).toMatch(/a max 9,81 m\/s² \(bez rázů na dorazech\)/);
      // zaznamenané snímky: zrychlení v kroku nárazu bez rázu (nikde ≫ g)
      expect(Math.max(...stepsOf(res).map((s) => Math.hypot(...s.dyn!.S.a)))).toBeLessThan(9810 * 1.01);
    }
  });
});
