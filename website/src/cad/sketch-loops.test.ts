/**
 * findLoops (sketch.ts) – řetězení otevřených úseků přes mřížku konců: stejný výsledek jako dřívější průchod všemi úseky
 * (náhodné skici s mnoha shodnými konci a konci těsně u tolerance) a velké skice bez kvadratického času.
 */
import { describe, expect, it } from "vitest";
import { findLoops, type Loop, type Seg } from "./sketch";
import { checkProfile, profileStatusLines } from "./profile-check";
import { clusterPoints } from "./point-cluster";
import type { SketchEntity, Vec2 } from "./types";

/** dřívější řetězení (průchod všemi úseky pro každý krok) – referenční výsledek */
function referenceChains(open: { seg: Seg; id: string }[]): { segs: Seg[]; ids: string[] }[] {
  const near = (p: Vec2, q: Vec2, eps: number) => Math.abs(p[0] - q[0]) < eps && Math.abs(p[1] - q[1]) < eps;
  const out: { segs: Seg[]; ids: string[] }[] = [];
  const used = new Array(open.length).fill(false);
  const tol = 1e-3;
  const reverse = (s: Seg): Seg => (s.kind === "line" ? { kind: "line", a: s.b, b: s.a } : { kind: "arc", a: s.b, m: s.m, b: s.a });
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    const chain: Seg[] = [open[i].seg];
    const ids = [open[i].id];
    used[i] = true;
    let progressed = true;
    while (progressed && !near(chain[0].a, chain[chain.length - 1].b, tol)) {
      progressed = false;
      const end = chain[chain.length - 1].b;
      for (let j = 0; j < open.length; j++) {
        if (used[j]) continue;
        const s = open[j].seg;
        if (near(s.a, end, tol)) chain.push(s);
        else if (near(s.b, end, tol)) chain.push(reverse(s));
        else continue;
        used[j] = true;
        ids.push(open[j].id);
        progressed = true;
        break;
      }
    }
    if (chain.length >= 2 && near(chain[0].a, chain[chain.length - 1].b, tol)) {
      const last = chain[chain.length - 1];
      chain[chain.length - 1] = { ...last, b: chain[0].a };
      out.push({ segs: chain, ids: [...new Set(ids)] });
    }
  }
  return out;
}

/** deterministický generátor (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("findLoops – mřížka konců dává týž výsledek jako průchod všemi úseky", () => {
  it("200 náhodných skic (úsečky a oblouky na hrubé mřížce bodů, konce 0,0009 / 0,0011 mm od uzlu, obrácené úseky)", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = rng(seed);
      const node = (): Vec2 => {
        const p: Vec2 = [Math.floor(rnd() * 5) * 10, Math.floor(rnd() * 5) * 10];
        const jit = rnd();
        // část konců těsně u tolerance (1e-3) a přes hranu buňky mřížky
        if (jit < 0.15) return [p[0] + 0.0009, p[1] - 0.0009];
        if (jit < 0.25) return [p[0] - 0.0011, p[1]];
        return p;
      };
      const ents: SketchEntity[] = [];
      const n = 3 + Math.floor(rnd() * 40);
      for (let k = 0; k < n; k++) {
        const a = node();
        const b = node();
        if (rnd() < 0.8) ents.push({ id: `e${k + 1}`, type: "line", a, b });
        else ents.push({ id: `e${k + 1}`, type: "arc", a, b: [(a[0] + b[0]) / 2 + 3, (a[1] + b[1]) / 2 - 2], c: b });
      }
      const open = ents.map((e) => ({ seg: (e.type === "line" ? { kind: "line", a: e.a, b: e.b } : e.type === "arc" ? { kind: "arc", a: e.a, m: e.b, b: e.c } : null) as Seg, id: e.id }));
      const ref = referenceChains(open);
      const got = findLoops(ents).loops.filter((l): l is Extract<Loop, { kind: "segs" }> => l.kind === "segs");
      expect(got.map((l) => ({ segs: l.segs, ids: l.sourceIds })), `seed ${seed}`).toEqual(ref.map((l) => ({ segs: l.segs, ids: l.ids })));
    }
  });
  it("40 000 samostatných úseček (DXF) – findLoops i kontrola profilu bez kvadratického času (dřív ~15 s; 20 000 úseček ~4 s)", () => {
    // meze s velkou rezervou pro vytížený stroj (teď ~0,2 s a ~1 s); kvadratické řetězení by je překročilo několikanásobně
    const ents: SketchEntity[] = [];
    for (let i = 0; i < 40000; i++) ents.push({ id: `e${i + 1}`, type: "line", a: [i * 2, 0], b: [i * 2 + 1, (i % 7) + 1] });
    let t0 = performance.now();
    expect(findLoops(ents).loops).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(5000);
    t0 = performance.now();
    const r = checkProfile(ents);
    expect(r.loops).toEqual([]);
    expect(r.truncated).toBe(true);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
  it("mřížka 100 × 100 čtverců z úseček (40 000 entit) se zřetězí do 10 000 obrysů", () => {
    const ents: SketchEntity[] = [];
    let id = 1;
    for (let i = 0; i < 100; i++)
      for (let j = 0; j < 100; j++) {
        const p: Vec2[] = [[i * 10, j * 10], [i * 10 + 5, j * 10], [i * 10 + 5, j * 10 + 5], [i * 10, j * 10 + 5]];
        for (let k = 0; k < 4; k++) ents.push({ id: `e${id++}`, type: "line", a: p[k], b: p[(k + 1) % 4] });
      }
    const t0 = performance.now();
    const { loops, openCount } = findLoops(ents);
    expect(loops).toHaveLength(10000);
    expect(openCount).toBe(0);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
  it("tisíce konců v jednom bodě (paprsky do jednoho středu) – findLoops i kontrola profilu rychle a bez přetečení zásobníku", () => {
    // úsečky ze špičky do středu: každý řetěz končí ve středu a hledá navazující úsek mezi 30 000 konci v jedné buňce
    const ents: SketchEntity[] = Array.from({ length: 30000 }, (_, i) => ({ id: `e${i + 1}`, type: "line", a: [Math.cos(i) * 50, Math.sin(i) * 50], b: [0, 0] }) as SketchEntity);
    const t0 = performance.now();
    const ref = findLoops(ents.slice(0, 300));
    expect(ref.loops).toHaveLength(0); // dvojice paprsků „V“ – otevřené, žádný obrys
    expect(findLoops(ents).loops).toHaveLength(0);
    const r = checkProfile(ents);
    expect(r.issues.find((i) => i.kind === "branch")).toMatchObject({ kind: "branch", at: [0, 0] });
    expect(profileStatusLines(ents)[0]).toMatch(/⚠ problémů/);
    expect(performance.now() - t0).toBeLessThan(6000); // dřív shlukování konců seřazených podle x: 30 000 konců na x = 0 → ~10 s
  });
});

describe("clusterPoints – shluky bodů mřížkou", () => {
  /** referenční sjednocení všech dvojic (kvadratické) */
  const naive = (pts: Vec2[], tol: number) => {
    const parent = pts.map((_, i) => i);
    const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) <= tol) parent[root(i)] = root(j);
    const ids = new Map<number, number>();
    return pts.map((_, i) => {
      const r = root(i);
      if (!ids.has(r)) ids.set(r, ids.size);
      return ids.get(r)!;
    });
  };
  it("stejné shluky jako sjednocení všech dvojic (náhodné body, řetězy blízkých bodů, shodné body, NaN)", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rnd = rng(seed);
      const tol = seed % 2 ? 0.05 : 1e-3;
      const pts: Vec2[] = [];
      for (let k = 0; k < 120; k++) {
        const base: Vec2 = [Math.floor(rnd() * 6) * tol * 3, Math.floor(rnd() * 6) * tol * 3];
        pts.push([base[0] + (rnd() - 0.5) * tol * 1.6, base[1] + (rnd() - 0.5) * tol * 1.6]);
        if (rnd() < 0.2) pts.push([...pts[pts.length - 1]] as Vec2);
      }
      pts.push([NaN, 0], [NaN, 0]);
      expect(clusterPoints(pts, tol), `seed ${seed}`).toEqual(naive(pts, tol));
    }
  });
  it("100 000 bodů na jedné svislici a 50 000 v jednom bodě – lineárně", () => {
    const line: Vec2[] = Array.from({ length: 100000 }, (_, i) => [0, i * 0.01]);
    const t0 = performance.now();
    expect(new Set(clusterPoints(line, 1e-3)).size).toBe(100000);
    expect(new Set(clusterPoints(line, 0.05)).size).toBe(1); // řetěz blízkých bodů = jeden shluk
    const hub: Vec2[] = Array.from({ length: 50000 }, () => [3, 4]);
    expect(new Set(clusterPoints(hub, 1e-3)).size).toBe(1);
    expect(performance.now() - t0).toBeLessThan(6000); // teď ~0,6 s; řazení podle x by na jedné svislici bylo kvadratické
  });
});
