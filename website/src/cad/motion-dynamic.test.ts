/**
 * Dynamická pohybová studie (cad/motion-dynamic.ts) – bez jádra, syntetická geometrie ploch:
 * - analytický kmitavý systém hmota–pružiny: perioda T = 2π·√(m/k) do 1 %, energie bez tlumení stálá do 0,5 % přes 10 period,
 * - pád na doraz: čas a rychlost nárazu √(2·g·h), při odrazu 0 zůstane ležet, při odrazu 0,5 druhý náraz poloviční rychlostí,
 * - pérový kolík (zaskočí do díry): rychlost nárazu z energie pružiny ½·c·(Δ1² − Δ2²) = ½·m·v²,
 * - střižník: horní deska motorem dolů 30 mm a zpět (tam a zpět), stírací deska na 4 pružinách dosedne na matrici, pružiny se stlačí
 *   a deska se vrátí na svůj doraz – čas návratu z geometrie zdvihu, největší síla pružiny c·Δ,
 * - hmotnostní vlastnosti ze sítě (kvádr: objem, těžiště, tenzor m·(b² + c²)/12).
 */
import { describe, expect, it, vi } from "vitest";
import type { FaceGeo, GeoProvider } from "./mates";
import { meshMassProps, partMassProps, sumMass, transformMass, type CompInertia } from "./motion-mass";
import { motorAt, runDynamic, type DynResult } from "./motion-dynamic";
import { dynamicLines } from "./motion-dynamic-report";
import { motionClashLines } from "./asm-agent-kin";
import { motionCsv, motionSummary } from "./motion";
import { getLang, setLang } from "./i18n";
import { emptyDoc, uid, type AsmComponent, type CadDoc, type Mate, type MateRef, type MotionStudy, type Placement, type SpringDef, type Vec3 } from "./types";

// integrace tisíců kroků – na sdíleném stroji pod zátěží delší než výchozích 5 s
vi.setConfig({ testTimeout: 60000 });

type Geos = Record<string, Record<string, FaceGeo>>;
const provider = (G: Geos): GeoProvider => (r) => G[r.compId]?.[`f${r.face}`] ?? null;
const P = (position: Vec3 = [0, 0, 0], rotation: Vec3 = [0, 0, 0]): Placement => ({ position, rotation });
const comp = (id: string, placement: Placement, fixed = false): AsmComponent => ({ id, name: id, source: { kind: "part", doc: emptyDoc(id) }, placement, ...(fixed ? { fixed: true } : {}) });
const f = (compId: string, face: number): MateRef => ({ compId, face });
const plane = (origin: Vec3, normal: Vec3): FaceGeo => ({ kind: "plane", origin, normal });
const cyl = (origin: Vec3, normal: Vec3, radius: number): FaceGeo => ({ kind: "cylinder", origin, normal, radius });
const Z: Vec3 = [0, 0, 1];
const NZ: Vec3 = [0, 0, -1];

/** díl s prvkem Pružina (osa Z, začátek v počátku): délka modelu 42 mm, Ln z modelu 18 mm (jinak `solid`) – v sestavě délku určují dosedací plochy */
function springComp(id: string, at: Vec3, def: SpringDef): AsmComponent {
  const doc: CadDoc = { ...emptyDoc(id), features: [{ id: uid(), name: "Pružina", type: "spring", radius: 8, pitch: 5, turns: 8, wire: 2, position: [0, 0, 1], axis: "Z", mode: "new" }] };
  return { id, name: id, source: { kind: "part", doc }, placement: P(at), spring: def };
}
const box = (mass: number, a: number, b: number, c: number, com: Vec3 = [0, 0, 0]): CompInertia => ({ mass, com, I: [(mass * (b * b + c * c)) / 12, 0, 0, 0, (mass * (a * a + c * c)) / 12, 0, 0, 0, (mass * (a * a + b * b)) / 12], source: "manual" });
const zOf = (r: DynResult, id: string) => r.steps.map((s) => s.place[id].position[2]);

describe("hmotnostní vlastnosti ze sítě", () => {
  it("kvádr 10×20×30 mm: objem 6000 mm³, těžiště ve středu, tenzor m·(b² + c²)/12 (hustota 7,85 → 0,0471 kg)", () => {
    // kvádr ⟨0,10⟩×⟨0,20⟩×⟨0,30⟩ – 12 trojúhelníků s vnějšími normálami
    const v = [0, 0, 0, 10, 0, 0, 10, 20, 0, 0, 20, 0, 0, 0, 30, 10, 0, 30, 10, 20, 30, 0, 20, 30];
    const t = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
    const mp = meshMassProps(v, t)!;
    expect(mp.volume).toBeCloseTo(6000, 6);
    expect(mp.com).toEqual([5, 10, 15].map((x) => expect.closeTo(x, 9)));
    // na jednotkovou hustotu (hmotnost = objem): Ixx = V·(20² + 30²)/12
    expect(mp.I[0]).toBeCloseTo((6000 * (400 + 900)) / 12, 4);
    expect(mp.I[4]).toBeCloseTo((6000 * (100 + 900)) / 12, 4);
    expect(mp.I[8]).toBeCloseTo((6000 * (100 + 400)) / 12, 4);
    expect(Math.abs(mp.I[1]) + Math.abs(mp.I[2]) + Math.abs(mp.I[5])).toBeLessThan(1e-6);
    // obrácená síť dá totéž
    const flipped = t.map((_, i) => t[i - (i % 3) + (2 - (i % 3))]);
    expect(meshMassProps(v, flipped)!.volume).toBeCloseTo(6000, 6);
    const part = partMassProps({ volume: 6000, density: 7.85, vertices: v, triangles: t })!;
    expect(part.mass).toBeCloseTo(0.0471, 6);
    expect(part.I[8]).toBeCloseTo((0.0471 * 500) / 12, 6);
    // dva kvádry vedle sebe = kvádr 20×20×30 (Steinerova věta)
    const moved = transformMass(part, [1, 0, 0, 0, 1, 0, 0, 0, 1], [10, 0, 0]);
    const both = sumMass([part, moved])!;
    expect(both.com[0]).toBeCloseTo(10, 9);
    expect(both.I[8]).toBeCloseTo((0.0942 * (400 + 400)) / 12, 6);
  });
});

describe("motor tam a zpět", () => {
  it("od → do → od sinusově, rychlost na koncích nulová", () => {
    const mo = { id: "m", kind: "linear" as const, mate: "x", from: 60, to: 30, back: true };
    expect(motorAt(mo, 0, 0.5)).toBe(60);
    expect(motorAt(mo, 0.25, 0.5)).toBeCloseTo(30, 9);
    expect(motorAt(mo, 0.5, 0.5)).toBeCloseTo(60, 9);
    expect(motorAt(mo, 0.001, 0.5) - 60).toBeGreaterThan(-0.01);
    expect(motorAt({ ...mo, back: undefined }, 0.25, 0.5)).toBeCloseTo(45, 9);
  });
});

/**
 * Hmota S (1 kg) na sloupku (Souosost – posuv a natočení kolem osy Z volné) mezi dvěma předepjatými pružinami: spodní z rámu B
 * (rovina z = 0) na spodní plochu S, horní z horní plochy S na rám T (rovina z = 100). L0 = 50 mm, c = 10 N/mm, S je 10 mm vysoká.
 * Rovnováha: 50 − z = (z + 10 + 50) − 100 → z = 45 (obě pružiny stlačené o 5 mm); k = 2·c = 20 N/mm.
 */
function oscillator(z0: number, opts: { gravity?: boolean; c?: number } = {}) {
  const c = opts.c ?? 10;
  const G: Geos = {
    B: { f0: cyl([0, 0, 0], Z, 5), f1: plane([0, 0, 0], Z) },
    T: { f1: plane([0, 0, 100], NZ) },
    S: { f0: cyl([0, 0, 0], Z, 5), f1: plane([0, 0, 0], NZ), f2: plane([0, 0, 10], Z) },
  };
  const mates: Mate[] = [{ id: "c", type: "concentric", a: f("S", 0), b: f("B", 0) }];
  const doc: CadDoc = {
    ...emptyDoc("Kmitání"),
    kind: "assembly",
    components: [
      comp("B", P(), true),
      comp("T", P(), true),
      comp("S", P([0, 0, z0])),
      springComp("SP1", [30, 0, 0], { a: f("B", 1), b: f("S", 1), free: 50, rate: c }),
      springComp("SP2", [30, 0, 60], { a: f("S", 2), b: f("T", 1), free: 50, rate: c }),
    ],
    mates,
  };
  return { doc, geo: provider(G) };
}
const massS = (m = 1) => (id: string): CompInertia | null => (id === "S" ? box(m, 40, 40, 10, [0, 0, 5]) : null);

describe("dynamika: analytický kmitavý systém hmota–pružiny", () => {
  it("perioda 2π·√(m/k) do 1 % a energie bez tlumení stálá do 0,5 % přes 10 period", async () => {
    const { doc, geo } = oscillator(43);
    const T = 2 * Math.PI * Math.sqrt(1 / 20000); // m = 1 kg, k = 20 N/mm = 20 000 N/m → 44,43 ms
    const study: MotionStudy = { motors: [], duration: 10.25 * T, steps: 10, mode: "dynamic", dyn: { dt: T / 300, gravity: null } };
    const res = await runDynamic(doc, geo, study, { inertia: massS(), maxFrames: 100000 });
    const z = zOf(res, "S");
    const t = res.steps.map((s) => s.t);
    // průchody rovnovážnou polohou směrem nahoru (lineární interpolace)
    const up: number[] = [];
    for (let i = 1; i < z.length; i++) if (z[i - 1] < 45 && z[i] >= 45) up.push(t[i - 1] + ((45 - z[i - 1]) / (z[i] - z[i - 1])) * (t[i] - t[i - 1]));
    expect(up.length).toBeGreaterThanOrEqual(10);
    const period = (up[up.length - 1] - up[0]) / (up.length - 1);
    expect(Math.abs(period - T) / T).toBeLessThan(0.01);
    // amplituda 2 mm kolem 45 (bez driftu), sloupek drží osu (X, Y beze změny)
    expect(Math.max(...z)).toBeCloseTo(47, 2);
    expect(Math.min(...z)).toBeCloseTo(43, 2);
    expect(Math.max(...res.steps.map((s) => Math.abs(s.place.S.position[0]) + Math.abs(s.place.S.position[1])))).toBeLessThan(1e-6);
    // energie: ½·k·A² = ½·20 000·0,002² = 0,04 J; Verlet kolísá o (ω·dt)²/8 ≈ 3e-5, bez driftu
    expect(res.dynamic.energy.e0).toBeGreaterThan(0);
    expect(res.dynamic.energy.drift).not.toBeNull();
    expect(res.dynamic.energy.drift!).toBeLessThan(0.005);
    expect(res.dynamic.energy.kinMax).toBeCloseTo(0.04, 3);
    expect(res.dynamic.bodies.map((b) => [b.id, b.mass, b.source])).toEqual([["S", 1, "manual"]]);
  });

  it("s gravitací: rovnováha o m·g/k níž, perioda stejná", async () => {
    // rovnováha: 20·(45 − z) = 9,81 → z = 44,5095; start v rovnováze + 1 mm
    const zEq = 45 - 9.81 / 20;
    const { doc, geo } = oscillator(zEq + 1);
    const T = 2 * Math.PI * Math.sqrt(1 / 20000);
    const res = await runDynamic(doc, geo, { motors: [], duration: 3.1 * T, steps: 10, mode: "dynamic", dyn: { dt: T / 300 } }, { inertia: massS(), maxFrames: 100000 });
    const z = zOf(res, "S");
    expect(Math.max(...z)).toBeCloseTo(zEq + 1, 2);
    expect(Math.min(...z)).toBeCloseTo(zEq - 1, 2);
    expect(res.dynamic.energy.drift!).toBeLessThan(0.005);
  });
});

/** Těleso S (0,5 kg) na sloupku padá na doraz: Mez vzdálenosti spodní plochy S nad rovinou B (z = 0) min 20 mm. */
function dropOnStop(z0: number) {
  const G: Geos = {
    B: { f0: cyl([0, 0, 0], Z, 5), f1: plane([0, 0, 0], Z) },
    S: { f0: cyl([0, 0, 0], Z, 5), f1: plane([0, 0, 0], NZ) },
  };
  const mates: Mate[] = [
    { id: "c", type: "concentric", a: f("S", 0), b: f("B", 0) },
    { id: "lim", type: "limitDistance", a: f("S", 1), b: f("B", 1), min: 20, max: 200, name: "Doraz" },
  ];
  const doc: CadDoc = { ...emptyDoc("Pád"), kind: "assembly", components: [comp("B", P(), true), comp("S", P([0, 0, z0]))], mates };
  return { doc, geo: provider(G) };
}

describe("dynamika: doraz s odrazem", () => {
  it("pád 20 mm: náraz v t = √(2h/g) rychlostí √(2·g·h); odraz 0 = zůstane ležet na dorazu", async () => {
    const { doc, geo } = dropOnStop(40);
    const res = await runDynamic(doc, geo, { motors: [], duration: 0.2, steps: 10, mode: "dynamic", dyn: { dt: 0.0001, restitution: 0 } }, { inertia: (id) => (id === "S" ? box(0.5, 20, 20, 10, [0, 0, 5]) : null) });
    const c = res.dynamic.contacts.find((x) => x.id === "lim" && x.bound === "min")!;
    expect(c).toBeTruthy();
    const tHit = Math.sqrt((2 * 20) / 9810);
    const vHit = Math.sqrt(2 * 9810 * 20);
    expect(c.impacts.length).toBe(1);
    expect(Math.abs(c.impacts[0].t - tHit)).toBeLessThan(2e-4);
    expect(Math.abs(c.impacts[0].v - vHit) / vHit).toBeLessThan(0.01);
    // leží: poloha na dorazu, rychlost nulová až do konce
    const last = res.steps[res.steps.length - 1];
    expect(last.place.S.position[2]).toBeCloseTo(20, 5);
    expect(Math.hypot(...last.dyn!.S.v)).toBeLessThan(1e-3);
    expect(c.intervals.length).toBe(1);
    expect(c.intervals[0][1]).toBeCloseTo(0.2, 6);
    expect(res.dynamic.energy.contacts).toBeGreaterThan(0); // náraz bez odrazu pohltí ½·m·v² = 0,098 J
    expect(res.dynamic.energy.contacts).toBeCloseTo(0.5 * 0.5 * (vHit / 1000) ** 2, 2);
  });

  it("odraz 0,5: druhý náraz poloviční rychlostí", async () => {
    const { doc, geo } = dropOnStop(40);
    const res = await runDynamic(doc, geo, { motors: [], duration: 0.15, steps: 10, mode: "dynamic", dyn: { dt: 0.0001, restitution: 0.5 } }, { inertia: (id) => (id === "S" ? box(0.5, 20, 20, 10) : null) });
    const c = res.dynamic.contacts.find((x) => x.id === "lim")!;
    expect(c.impacts.length).toBeGreaterThanOrEqual(2);
    expect(c.impacts[1].v / c.impacts[0].v).toBeCloseTo(0.5, 1);
    expect(Math.abs(c.impacts[1].v / c.impacts[0].v - 0.5)).toBeLessThan(0.02);
  });
});

describe("dynamika: pérový kolík zaskočí do díry", () => {
  it("uvolněný kolík vyrazí na doraz rychlostí z energie pružiny", async () => {
    // pouzdro H (ukotvené), kolík K na Souososti, pružina z dna pouzdra (z = 0) na nákružek kolíku; zdvih 6 → 15 mm (doraz = díra)
    const G: Geos = {
      H: { f0: cyl([0, 0, 0], Z, 3), f1: plane([0, 0, 0], Z) },
      K: { f0: cyl([0, 0, 0], Z, 3), f1: plane([0, 0, 0], NZ) },
    };
    const mates: Mate[] = [
      { id: "c", type: "concentric", a: f("K", 0), b: f("H", 0) },
      { id: "lim", type: "limitDistance", a: f("K", 1), b: f("H", 1), min: 5, max: 15, name: "Zdvih kolíku" },
    ];
    const doc: CadDoc = {
      ...emptyDoc("Kolík"),
      kind: "assembly",
      components: [comp("H", P(), true), comp("K", P([0, 0, 6])), springComp("P", [0, 0, 0], { a: f("H", 1), b: f("K", 1), free: 30, solid: 3, rate: 2 })],
      mates,
    };
    const res = await runDynamic(doc, provider(G), { motors: [], duration: 0.02, steps: 10, mode: "dynamic", dyn: { dt: 0.00002, gravity: null } }, { inertia: (id) => (id === "K" ? box(0.05, 6, 6, 40, [0, 0, 20]) : null) });
    const c = res.dynamic.contacts.find((x) => x.id === "lim" && x.bound === "max")!;
    // ½·c·((30 − 6)² − (30 − 15)²) = 351 N·mm = 0,351 J = ½·0,05·v² → v = 3,747 m/s
    const v = Math.sqrt((2 * 0.351) / 0.05) * 1000;
    expect(Math.abs(c.impacts[0].v - v) / v).toBeLessThan(0.01);
    // čas zaskočení: kmit x(t) = A·cos(ω·t) kolem L0 (pružina jen tlačí): ω = √(c/m) = 200 rad/s, x0 = −24, x = −15 → t = acos(15/24)/ω
    const tSnap = Math.acos(15 / 24) / 200;
    expect(Math.abs(c.impacts[0].t - tSnap)).toBeLessThan(1e-4);
    // síla pružiny na začátku 48 N (c·Δ = 2·24)
    expect(res.dynamic.springMax!.force).toBeCloseTo(48, 1);
  });
});

/**
 * Střižník: matrice B (ukotvená, horní plocha z = 40) se dvěma sloupky, horní deska U vedená sloupky a poháněná Vzdáleností „LIS“ od B
 * (60 → 30 → 60 tam a zpět za 0,5 s), stírací deska S (2,4 kg) na sloupcích visí pod U na dorazu (Mez vzdálenosti 5…20 mm) a tlačí ji
 * 4 pružiny (L0 30, c 25 N/mm, předpětí 10 mm). S dosedne na matrici, když mezera U–B = 40 mm: cos(2πt/T) = −1/3 → t = 0,152 s;
 * vrátí se na doraz v 0,5 − 0,152 = 0,348 s. Největší stlačení pružin 20 mm (mezera 10) → 500 N na pružinu.
 */
function cuttingDie() {
  const G: Geos = {
    B: { f0: cyl([20, 20, 0], Z, 10), f1: cyl([180, 20, 0], Z, 10), f2: plane([100, 20, 40], Z) },
    U: { f0: cyl([20, 20, 0], Z, 10.05), f1: cyl([180, 20, 0], Z, 10.05), f2: plane([100, 20, 0], NZ) },
    S: { f0: cyl([20, 20, 0], Z, 10.1), f1: cyl([180, 20, 0], Z, 10.1), f2: plane([100, 20, 20], Z), f3: plane([100, 20, 0], NZ) },
  };
  const mates: Mate[] = [
    { id: "u0", type: "concentric", a: f("U", 0), b: f("B", 0) },
    { id: "u1", type: "concentric", a: f("U", 1), b: f("B", 1) },
    { id: "lis", type: "distance", a: f("U", 2), b: f("B", 2), value: 60, name: "LIS" },
    { id: "s0", type: "concentric", a: f("S", 0), b: f("B", 0) },
    { id: "s1", type: "concentric", a: f("S", 1), b: f("B", 1) },
    { id: "l1", type: "limitDistance", a: f("S", 2), b: f("U", 2), min: 5, max: 20, name: "Doraz stírače" },
    { id: "l2", type: "limitDistance", a: f("S", 3), b: f("B", 2), min: 0, name: "Matrice" },
  ];
  const sp = (k: number) => springComp(`SP${k}`, [40 + 40 * k, 20, 80], { a: f("S", 2), b: f("U", 2), free: 30, solid: 6, rate: 25 });
  const doc: CadDoc = { ...emptyDoc("Střižník"), kind: "assembly", components: [comp("B", P(), true), comp("U", P([0, 0, 100])), comp("S", P([0, 0, 60])), sp(0), sp(1), sp(2), sp(3)], mates };
  return { doc, geo: provider(G) };
}

describe("dynamika: střižník se stírací deskou na 4 pružinách", () => {
  it("motor dolů 30 mm a zpět: stírač dosedne na matrici, pružiny 500 N, návrat na doraz v 0,348 s", async () => {
    const { doc, geo } = cuttingDie();
    const study: MotionStudy = { motors: [{ id: "mo", kind: "linear", mate: "lis", from: 60, to: 30, back: true }], duration: 0.5, steps: 10, mode: "dynamic", dyn: { dt: 0.0005, restitution: 0.2 } };
    const t0 = Date.now();
    const res = await runDynamic(doc, geo, study, { inertia: (id) => (id === "S" ? box(2.4, 200, 40, 20, [100, 20, 10]) : id === "U" ? box(8, 200, 40, 30, [100, 20, 15]) : null) });
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(20000);
    const die = res.dynamic.contacts.find((x) => x.id === "l2" && x.bound === "min")!;
    expect(die).toBeTruthy();
    const tHit = (0.5 * Math.acos(-1 / 3)) / (2 * Math.PI);
    expect(Math.abs(die.intervals[0][0] - tHit)).toBeLessThan(0.004);
    expect(Math.abs(die.intervals[0][1] - (0.5 - tHit))).toBeLessThan(0.004);
    // náraz na matrici rychlostí horní desky: 15·ω·sin(ω·t), ω = 4π
    const vHit = 15 * 4 * Math.PI * Math.sin(4 * Math.PI * tHit);
    expect(Math.abs(die.impacts[0].v - vHit) / vHit).toBeLessThan(0.05);
    const stop = res.dynamic.contacts.find((x) => x.id === "l1" && x.bound === "max")!;
    expect(stop.intervals.length).toBeGreaterThanOrEqual(2);
    expect(stop.intervals[0][0]).toBe(0);
    const back = stop.intervals.find((iv) => iv[0] > 0.2)!;
    expect(Math.abs(back[0] - (0.5 - tHit))).toBeLessThan(0.004);
    expect(res.dynamic.springMax!.force).toBeGreaterThan(495);
    expect(res.dynamic.springMax!.force).toBeLessThan(510);
    // stírač nikdy pod matricí, vazby splněné, motor dosáhl 30 mm
    expect(Math.min(...zOf(res, "S"))).toBeGreaterThan(40 - 1e-3);
    expect(res.conflictSteps).toBe(0);
    expect(Math.min(...res.steps.map((s) => s.motors[0]))).toBeCloseTo(30, 1);
    expect(res.dynamic.energy.drift).toBeNull(); // motor koná práci – bilance se nekontroluje
    // pružiny v krocích: délka 20 → 10 → 20 mm
    const L = res.steps.map((s) => s.springs!.SP0.length);
    expect(Math.min(...L)).toBeCloseTo(10, 1);
    expect(L[0]).toBeCloseTo(20, 3);
  });
});

describe("dynamika: kontrola kolizí v `kroky` snímcích (jako kinematická studie)", () => {
  it("collide v každém k-tém snímku (kroky 10 z 20 snímků → každý 2.) s polohou kroku; první kolize = krok a čas; souhrn „z 11“", async () => {
    const { doc, geo } = dropOnStop(40);
    const seen: number[] = [];
    const res = await runDynamic(doc, geo, { motors: [], duration: 0.1, steps: 10, collisions: true, mode: "dynamic", dyn: { dt: 0.001, frames: 20 } }, {
      inertia: (id) => (id === "S" ? box(0.5, 20, 20, 10) : null),
      collide: async (d) => {
        const z = d.components!.find((c) => c.id === "S")!.placement.position[2];
        seen.push(z);
        return z < 30 ? [{ a: "S", b: "B", volume: 1 }] : [];
      },
    });
    expect(res.collisionsChecked).toBe(true);
    // 100 kroků po 1 ms, záznam každý 5. → 21 snímků; kolize v 11 (0, 2, … 20) = kroky studie + 1 (recenze integrace vlny 21:
    // 334 snímků × přesné průniky pružin trvalo 474 s místo 72 s kinematické studie a překročilo časový limit CLI 300 s)
    expect(res.steps.length).toBe(21);
    expect(res.dynamic.clashEvery).toBe(2);
    expect(seen.length).toBe(11);
    expect(res.steps.filter((s) => s.clashes !== undefined).map((s) => s.i)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    // pád z 40: z < 30 po √(2·10/9810) = 45 ms → první kontrolovaný snímek pod 30 mm v t = 0,05 s
    expect(res.collision).toBeTruthy();
    expect(res.collision!.t).toBeGreaterThan(0.044);
    expect(res.collision!.t).toBeLessThan(0.056);
    const cl = await motionClashLines(res, doc);
    expect(cl.stats.of).toBe(11);
    expect(cl.lines[0]).toMatch(/^Kolize v pohybu: kroků s kolizí \d+ z 11 /);
    expect(cl.lines[1]).toBe(" kolize kontrolovány v 11 snímcích z 21 (každý 2. a poslední) – hustotu určuje pohyb kroky N");
    // nekontrolovaný snímek v CSV: „nekontrolováno“, ne prázdná buňka (= bez kolize)
    const rows = motionCsv(res, doc).replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    const col = rows[0].split(";").indexOf("Kolize");
    expect(col).toBeGreaterThan(0);
    expect(rows[2].split(";")[col]).toBe("nekontrolováno");
    expect(rows[1].split(";")[col]).toBe("");
  });

  it("kroky ≥ snímků: kolize v každém snímku; bez kolize souhrn „žádné ve všech krocích“", async () => {
    const { doc, geo } = dropOnStop(40);
    let calls = 0;
    const res = await runDynamic(doc, geo, { motors: [], duration: 0.02, steps: 50, collisions: true, mode: "dynamic", dyn: { dt: 0.001, frames: 20 } }, {
      inertia: (id) => (id === "S" ? box(0.5, 20, 20, 10) : null),
      collide: async () => {
        calls++;
        return [];
      },
    });
    expect(res.steps.length).toBe(21);
    expect(res.dynamic.clashEvery).toBe(1);
    expect(calls).toBe(21);
    expect((await motionClashLines(res, doc)).lines).toEqual(["Kolize: žádné ve všech krocích"]);
  });
});

describe("dynamika: čísla protokolu podle jazyka (recenze integrace vlny 21) – EN tečka, CS / DE čárka, CSV vždy čárka", () => {
  it("souhrn dynamiky a kinematiky v EN bez desetinné čárky, v CS s čárkou", async () => {
    const { doc, geo } = dropOnStop(40);
    const res = await runDynamic(doc, geo, { motors: [], duration: 0.05, steps: 10, mode: "dynamic", dyn: { dt: 0.0005, damping: 0.05, restitution: 0.2 } }, { inertia: (id) => (id === "S" ? box(2.4, 20, 20, 10) : null) });
    const lang0 = getLang();
    try {
      setLang("en");
      const en = [...motionSummary(res, doc), ...dynamicLines(res, doc)].join("\n");
      expect(en).toMatch(/Dynamics: 0\.05 s · step 0\.5 ms · 100 steps · gravity −Z · damping 0\.05 N·s\/mm · restitution 0\.2 /);
      expect(en).toMatch(/2\.4 kg/);
      // žádné číslo s desetinnou čárkou (čárka jen jako oddělovač „, “)
      expect(en).not.toMatch(/\d,\d/);
      setLang("de");
      expect(dynamicLines(res, doc).join("\n")).toMatch(/0,05 s/);
      setLang("cs");
      const cs = dynamicLines(res, doc).join("\n");
      expect(cs).toMatch(/Dynamika: 0,05 s · krok 0,5 ms · 100 kroků · gravitace −Z · tlumení 0,05 N·s\/mm · odraz 0,2 /);
      expect(cs).toMatch(/2,4 kg/);
      // CSV pro Excel (středník) má čárku v každém jazyce
      setLang("en");
      expect(motionCsv(res, doc).split("\r\n")[2]).toMatch(/^1;0,0005;/);
    } finally {
      setLang(lang0);
    }
  });
});

describe("dynamika: rozpor motoru a dorazu (lis stlačí pružiny pod Ln) – bez rozjetí", () => {
  it("bez vodicích sloupků, plochy s počátkem v rohu: deska zůstane na matrici, žádný boční posuv ani natočení, pružiny pod dorazem nahlášené", async () => {
    // jako střižník, ale pružiny stojí (bez zámku), dosedají přímo na desky (L = mezera 25 → 10 mm < Ln 19) a vazby jen rovinné
    const G: Geos = { B: { f2: plane([0, 0, 30], Z) }, U: { f2: plane([0, 0, 0], NZ) }, S: { f2: plane([0, 0, 15], Z), f3: plane([0, 0, 0], NZ) } };
    const sp = (k: number, x: number, y: number): AsmComponent => ({ ...springComp(`SP${k}`, [x, y, 95], { a: f("U", 2), b: f("S", 2), free: 41, solid: 19, rate: 4.055 }), name: "SP", placement: P([x, y, 95], [-180, 0, -180]) });
    const doc: CadDoc = {
      ...emptyDoc("Rozpor"),
      kind: "assembly",
      components: [comp("B", P(), true), comp("S", P([0, 0, 45])), comp("U", P([0, 0, 85])), sp(0, 40, 30), sp(1, 160, 30), sp(2, 40, 90), sp(3, 160, 90)],
      mates: [
        { id: "lis", type: "distance", a: f("U", 2), b: f("B", 2), value: 55 },
        { id: "l1", type: "limitDistance", a: f("S", 2), b: f("U", 2), min: 5, max: 25 },
        { id: "l2", type: "limitDistance", a: f("S", 3), b: f("B", 2), min: 0, max: 500 },
      ],
    };
    const res = await runDynamic(doc, provider(G), { motors: [{ id: "mo", kind: "linear", mate: "lis", from: 55, to: 25, back: true }], duration: 0.5, steps: 10, mode: "dynamic", dyn: { dt: 0.0005, restitution: 0.2, damping: 0.05 } }, { inertia: (id) => (id === "S" ? box(2.4, 200, 120, 15, [100, 60, 7.5]) : id === "U" ? box(5.6, 200, 120, 30, [100, 60, 15]) : null) });
    const span = (id: string, k: number) => { const v = res.steps.map((s) => s.place[id].position[k]); return Math.max(...v) - Math.min(...v); };
    for (const id of ["S", "U"]) {
      expect(span(id, 0) + span(id, 1)).toBeLessThan(1e-6);
      expect(Math.max(...res.steps.map((s) => Math.max(...s.place[id].rotation.map(Math.abs))))).toBeLessThan(1e-6);
    }
    expect(span("S", 2)).toBeCloseTo(15, 6); // 45 → 30 (matrice), níž ne
    expect(span("U", 2)).toBeCloseTo(30, 2); // motor dosáhl zdvihu (snímek každý 3. krok)
    // pružiny pod Ln v kroku = ✗ v souhrnu pružin; meze vazeb (matrice) drží
    expect(res.steps.some((s) => Object.values(s.springs ?? {}).some((x) => x.level === "error"))).toBe(true);
    expect(res.dynamic.contacts.some((c) => c.id === "spring:SP0" && c.bound === "min")).toBe(true);
  });
});

describe("dynamika: dva nezávislé stupně volnosti", () => {
  it("dvě hmoty na vlastních sloupcích a pružinách kmitají každá svou periodou 2π·√(m/k)", async () => {
    // hmota S (1 kg, 2 × 10 N/mm) a hmota Q (4 kg, 2 × 10 N/mm) – každá mezi rámem B a T, jen posuv po svém sloupku
    const G: Geos = {
      B: { f0: cyl([0, 0, 0], Z, 5), f1: plane([0, 0, 0], Z), f5: cyl([200, 0, 0], Z, 5) },
      T: { f1: plane([0, 0, 100], NZ) },
      S: { f0: cyl([0, 0, 0], Z, 5), f1: plane([0, 0, 0], NZ), f2: plane([0, 0, 10], Z) },
      Q: { f0: cyl([200, 0, 0], Z, 5), f1: plane([200, 0, 0], NZ), f2: plane([200, 0, 10], Z) },
    };
    const doc: CadDoc = {
      ...emptyDoc("Dvě hmoty"),
      kind: "assembly",
      components: [
        comp("B", P(), true),
        comp("T", P(), true),
        comp("S", P([0, 0, 43])),
        comp("Q", P([0, 0, 46])),
        springComp("S1", [30, 0, 0], { a: f("B", 1), b: f("S", 1), free: 50, rate: 10 }),
        springComp("S2", [30, 0, 60], { a: f("S", 2), b: f("T", 1), free: 50, rate: 10 }),
        springComp("Q1", [230, 0, 0], { a: f("B", 1), b: f("Q", 1), free: 50, rate: 10 }),
        springComp("Q2", [230, 0, 60], { a: f("Q", 2), b: f("T", 1), free: 50, rate: 10 }),
      ],
      mates: [
        { id: "cs", type: "concentric", a: f("S", 0), b: f("B", 0) },
        { id: "cq", type: "concentric", a: f("Q", 0), b: f("B", 5) },
      ],
    };
    const Ts = 2 * Math.PI * Math.sqrt(1 / 20000);
    const Tq = 2 * Math.PI * Math.sqrt(4 / 20000);
    const res = await runDynamic(doc, provider(G), { motors: [], duration: 5.2 * Tq, steps: 10, mode: "dynamic", dyn: { dt: Ts / 200, gravity: null } }, { inertia: (id) => (id === "S" ? box(1, 40, 40, 10, [0, 0, 5]) : id === "Q" ? box(4, 40, 40, 10, [200, 0, 5]) : null), maxFrames: 100000 });
    const period = (id: string) => {
      const z = zOf(res, id);
      const t = res.steps.map((s) => s.t);
      const up: number[] = [];
      for (let i = 1; i < z.length; i++) if (z[i - 1] < 45 && z[i] >= 45) up.push(t[i - 1] + ((45 - z[i - 1]) / (z[i] - z[i - 1])) * (t[i] - t[i - 1]));
      return (up[up.length - 1] - up[0]) / (up.length - 1);
    };
    expect(res.dynamic.bodies.length).toBe(2);
    expect(Math.abs(period("S") - Ts) / Ts).toBeLessThan(0.01);
    expect(Math.abs(period("Q") - Tq) / Tq).toBeLessThan(0.01);
    expect(res.dynamic.energy.drift!).toBeLessThan(0.005);
  });
});
