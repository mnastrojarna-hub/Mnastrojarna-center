/**
 * Vlna 22, body 22a a 22d – geometrie závitu ve skutečném jádře (OCCT):
 *  – objem drážky šroubovice z označení proti ručnímu výpočtu (Pappus pro šroubové tažení: V = A · 2π·r_c · otáčky, A = část
 *    profilu v materiálu, r_c = poloměr jejího těžiště) – vnější i vnitřní závit;
 *  – přesná BRepCheck (SetExactMethod) výsledku vnějšího i vnitřního závitu;
 *  – prvek Závit „šroubovice“ a Tažení po šroubovici s thread= dají totéž (jedno jádro, jeden katalog);
 *  – drážka, která povrch neřeže: tečná špička (případ C z 3. 11.), skrytý kanál (22b-H), obrácená strana (22b-E) → ⚠ s kódem;
 *    správný vnější (A) a vnitřní (D) závit bez ⚠.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "../build";
import { isValidShape } from "../check";
import { newExtFeature, threadByName } from "../defaults";
import { setLang } from "../i18n";
import { helixThreadDims } from "../thread-spec";
import { emptyDoc, type CadDoc, type Feature } from "../types";
import "../ext/index";
import "../feat/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
  setLang("cs");
}, 60_000);

let n = 0;
const id = () => `g2${++n}`;
const doc = (features: Feature[]): CadDoc => ({ ...emptyDoc("Test"), features });
const sweep = (d: CadDoc, data: Record<string, unknown>): Feature => {
  const f = newExtFeature(d, "surf.helixSweep");
  if (f.type === "ext") f.data = { ...f.data, ...data };
  return { ...f, id: id() } as Feature;
};
const cyl = (dia: number, h: number, z = 0): Feature => ({ id: id(), name: "Válec", type: "cylinder", radius: dia / 2, height: h, position: [0, 0, z], axis: "Z", mode: "new" });
const tube = (D: number, d: number, h: number, z = 0): Feature => ({ id: id(), name: "Trubka", type: "tube", outer: D, inner: d, height: h, position: [0, 0, z], axis: "Z", mode: "new" });
const statusOf = (res: Awaited<ReturnType<typeof buildDoc>>, f: Feature) => res.status.find((s) => s.id === f.id)!;
const vol = (res: Awaited<ReturnType<typeof buildDoc>>) => res.metrics!.volume;
const TAN30 = Math.tan(Math.PI / 6);
/** polovina šířky základny profilu Závit 60° (feat/thread-helix.ts threadProfileWire) */
const halfOf = (h: number, p: number) => Math.min(p * 0.45, h * TAN30 + 0.05 * p);

describe("objem drážky šroubovice z označení = ruční výpočet (Pappus)", () => {
  it("vnější M18×1,5 na válci Ø18: A = ½·w(R)·h, r_c = R − h/3, V = A·2π·r_c·n (±0,5 %); přesná BRepCheck platná", { timeout: 180_000 }, async () => {
    const t = threadByName("M18×1,5")!;
    const { radius: R, depth: h, pitch: p } = helixThreadDims(t, false);
    const turns = 10;
    const base = cyl(18, 30, -5); // šroubovice z = 5…20 ± půl profilu leží celá v délce válce (−5…25) – bez vlivu čel
    const d0 = doc([base]);
    const thr = sweep(d0, { profile: "thread60", thread: "M18×1,5", side: "external", turns, position: [0, 0, 5], axis: { kind: "axis", axis: "Z" }, mode: "cut" });
    const r0 = await buildDoc(d0);
    const r1 = await buildDoc(doc([base, thr]));
    expect(statusOf(r1, thr).ok).toBe(true);
    expect(statusOf(r1, thr).warning).toBeUndefined();
    const half = halfOf(h, p);
    const wR = (2 * half * h) / (h + 0.15); // šířka profilu na povrchu R (základna 0,15 mm nad povrchem)
    const A = 0.5 * wR * h;
    const expected = A * 2 * Math.PI * (R - h / 3) * turns;
    const removed = vol(r0) - vol(r1);
    expect(Math.abs(removed - expected) / expected).toBeLessThan(0.005);
    expect(isValidShape(r1.body!)).toBe(true);
    expect(isValidShape(r1.body!, true)).toBe(true); // přesná metoda BRepCheck (22a)
  });
  it("vnitřní M18×1,5 v díře Ø16,5 (vrták závitu): část profilu ve stěně r = 8,25…9 → A = ½·0,75·w(8,25), r_c = 8,5 (±0,5 %); přesná BRepCheck platná", { timeout: 180_000 }, async () => {
    const t = threadByName("M18×1,5")!;
    const { radius: R, depth: h, pitch: p } = helixThreadDims(t, true);
    const turns = 10;
    const base = tube(40, 16.5, 30, -5);
    const d0 = doc([base]);
    const thr = sweep(d0, { profile: "thread60", thread: "M18×1,5", side: "internal", turns, position: [0, 0, 5], axis: { kind: "axis", axis: "Z" }, mode: "cut" });
    const r0 = await buildDoc(d0);
    const r1 = await buildDoc(doc([base, thr]));
    expect(statusOf(r1, thr).ok).toBe(true);
    expect(statusOf(r1, thr).warning).toBeUndefined();
    const half = halfOf(h, p);
    const tip = R + h; // 9,0 = d/2
    const wall = 16.5 / 2;
    const width = (rr: number) => (2 * half * (tip - rr)) / (tip - (R - 0.15)); // šířka trojúhelníku na poloměru rr
    const A = 0.5 * (tip - wall) * width(wall);
    const expected = A * 2 * Math.PI * (wall + (tip - wall) / 3) * turns;
    const removed = vol(r0) - vol(r1);
    expect(tip).toBeCloseTo(9, 6);
    expect(Math.abs(removed - expected) / expected).toBeLessThan(0.005);
    expect(isValidShape(r1.body!)).toBe(true);
    expect(isValidShape(r1.body!, true)).toBe(true);
  });
  it("prvek Závit „šroubovice“ = Tažení po šroubovici s thread= se stejnými otáčkami (jedno jádro, ±0,5 %)", { timeout: 180_000 }, async () => {
    const t = threadByName("M18×1,5")!;
    const { depth: h, pitch: p } = helixThreadDims(t, false);
    const half = halfOf(h, p);
    const L = 15;
    const base = cyl(18, 30, -5);
    const viaThread: Feature = { id: id(), name: "Závit", type: "thread", designation: "M18×1,5", position: [0, 0, 5], axis: "Z", length: L, modeled: true, helix: true };
    const d0 = doc([base]);
    // prvek Závit: profil celý v délce L → šroubovice od 5 + half, otáčky (L − 2·half)/P
    const viaSweep = sweep(d0, { profile: "thread60", thread: "M18×1,5", side: "external", turns: (L - 2 * half) / p, position: [0, 0, 5 + half], axis: { kind: "axis", axis: "Z" }, mode: "cut" });
    const a = await buildDoc(doc([base, viaThread]));
    const b = await buildDoc(doc([base, viaSweep]));
    expect(statusOf(a, viaThread).ok).toBe(true);
    expect(statusOf(a, viaThread).warning).toBeUndefined();
    expect(Math.abs(vol(a) - vol(b)) / vol(b)).toBeLessThan(0.005);
    // drážky (prstence) téhož označení – jiný tvar, ale řádově stejný úběr (kontrola, že šroubovice nevznikla „naprázdno“)
    const rings = await buildDoc(doc([base, { ...viaThread, id: id(), helix: undefined }]));
    const r0 = await buildDoc(d0);
    const removedHelix = vol(r0) - vol(a);
    const removedRings = vol(r0) - vol(rings);
    expect(removedHelix).toBeGreaterThan(0.4 * removedRings);
    expect(removedHelix).toBeLessThan(1.6 * removedRings);
    expect(isValidShape(a.body!, true)).toBe(true);
  });
});

describe("drážka, která povrch neřeže → ⚠ s kódem (22a, 22b-H, 22b-E); správný závit bez ⚠", () => {
  const T = (D: number, d: number) => tube(D, d, 20);
  const run = async (body: Feature, data: Record<string, unknown>) => {
    const d0 = doc([body]);
    const f = sweep(d0, { profile: "thread60", pitch: 1.5, turns: 12, position: [0, 0, 0], axis: { kind: "axis", axis: "Z" }, mode: "cut", ...data });
    const res = await buildDoc(doc([body, f]));
    return statusOf(res, f);
  };
  it("C: trubka Ø16,4, radius 9, hloubka 0,8, vnější strana – špička tečná ke stěně díry → ⚠ thread.tip-tangent s radou side=internal radius=8,2", { timeout: 180_000 }, async () => {
    const st = await run(T(30, 16.4), { radius: 9, depth: 0.8 });
    expect(st.ok).toBe(true);
    expect(st.warnCode).toBe("thread.tip-tangent");
    expect(st.warning).toMatch(/špička profilu závitu je tečná k povrchu Ø16,4/);
    expect(st.warning).toMatch(/side=internal a radius=8,2\b/);
  });
  it("C′ (kolo 6): hloubka 0,81 – špička 0,01 mm od stěny díry Ø16,4 → rada podle SKUTEČNÉHO povrchu (Ø16,4, radius 8,2), ne podle poloměru špičky (Ø16,38 / 8,19)", { timeout: 180_000 }, async () => {
    const st = await run(T(30, 16.4), { radius: 9, depth: 0.81 });
    expect(st.warnCode).toBe("thread.tip-tangent");
    expect(st.warning).toMatch(/tečná k povrchu Ø16,4 /);
    expect(st.warning).toMatch(/Závit v díře Ø16,4: zadejte side=internal a radius=8,2 /);
    expect(st.warning).not.toMatch(/16,38|8,19/);
  });
  it("H: vnitřní strana, radius 9 v díře Ø16,4 – drážka celá ve stěně → ⚠ thread.no-reach („nezasahuje do válcové plochy díry“)", { timeout: 180_000 }, async () => {
    const st = await run(T(30, 16.4), { radius: 9, depth: 0.8, side: "internal" });
    expect(st.warnCode).toBe("thread.no-reach");
    expect(st.warning).toMatch(/nezasahuje do válcové plochy díry/);
    expect(st.warning).toMatch(/side=internal a radius=8,2\b/);
    // celá šroubovice uvnitř délky trubky: drážka odebrala celý nástroj (model úrovní G1 – správná drážka odebere jen část)
    const inner = await run(tube(30, 16.4, 30, -5), { radius: 9, depth: 0.8, side: "internal" });
    expect(inner.warnCode).toBe("thread.no-reach");
    expect(inner.effect?.level).toBe("full");
  });
  it("E: radius 9, hloubka 0,82 v díře Ø16,4 – drážka ústí do díry jen špičkou (0,02 mm) → ⚠ thread.wrong-side", { timeout: 180_000 }, async () => {
    const st = await run(T(30, 16.4), { radius: 9, depth: 0.82 });
    expect(st.warnCode).toBe("thread.wrong-side");
    expect(st.warning).toMatch(/jen špičkou \(0,02\d? mm z hloubky 0,82 mm\)/);
  });
  it("A (vnější na válci Ø18) a D (vnitřní radius 8,2 v díře Ø16,4): bez ⚠, přesná BRepCheck platná", { timeout: 180_000 }, async () => {
    for (const [body, data] of [
      [cyl(18, 20), { radius: 9, depth: 0.8 }],
      [T(30, 16.4), { radius: 8.2, depth: 0.8, side: "internal" }],
    ] as const) {
      const d0 = doc([body]);
      const f = sweep(d0, { profile: "thread60", pitch: 1.5, turns: 12, position: [0, 0, 0], axis: { kind: "axis", axis: "Z" }, mode: "cut", ...data });
      const res = await buildDoc(doc([body, f]));
      const st = statusOf(res, f);
      expect(st.warning, JSON.stringify(data)).toBeUndefined();
      expect(st.warnCode).toBeUndefined();
      expect(st.effect?.level).toBe("partial");
      expect(isValidShape(res.body!, true)).toBe(true);
    }
  });
  it("prvek Závit se šroubovicí na příliš velkém válci (Ø20 pro M18) → ⚠ thread.no-reach s radou o průměru válce", { timeout: 180_000 }, async () => {
    const body = cyl(20, 30);
    const f: Feature = { id: id(), name: "Závit", type: "thread", designation: "M18×1,5", position: [0, 0, 10], axis: "Z", length: 20, modeled: true, helix: true };
    const st = statusOf(await buildDoc(doc([body, f])), f);
    expect(st.warnCode).toBe("thread.no-reach");
    expect(st.warning).toMatch(/Vnější závit M18×1,5 patří na válec Ø18/);
  });
  it("stoupání mimo ISO 261: ⚠ thread.pitch-nonstandard i u kosmetického závitu a závitové díry", { timeout: 120_000 }, async () => {
    const body = cyl(18, 30);
    const cos: Feature = { id: id(), name: "Závit", type: "thread", designation: "M18×3", position: [0, 0, 0], axis: "Z", length: 10, modeled: false };
    const r1 = await buildDoc(doc([body, cos]));
    expect(statusOf(r1, cos).warnCode).toBe("thread.pitch-nonstandard");
    expect(r1.metrics!.volume).toBeCloseTo(Math.PI * 81 * 30, 0); // kosmetický – geometrie beze změny
    const ok: Feature = { ...cos, id: id(), designation: "M18×1,5" };
    expect(statusOf(await buildDoc(doc([body, ok])), ok).warning).toBeUndefined();
    const box: Feature = { id: id(), name: "Kvádr", type: "box", size: [40, 40, 20], position: [0, 0, 0], centered: false, mode: "new" };
    const hole: Feature = { id: id(), name: "Díra", type: "hole", position: [20, 20, 20], axis: "Z", flip: false, diameter: 15, depth: 15, cbDiameter: 0, cbDepth: 0, kind: "tapped", thread: "M18×3" };
    expect(statusOf(await buildDoc(doc([box, hole])), hole).warnCode).toBe("thread.pitch-nonstandard");
  });
});
