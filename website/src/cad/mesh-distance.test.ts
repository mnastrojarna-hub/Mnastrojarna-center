/**
 * Vzdálenost bodů od trojúhelníkové sítě (mesh-distance.ts) – čisté funkce bez jádra:
 * nejbližší bod trojúhelníku, strom obalových kvádrů proti hrubé síle, znaménko (uvnitř / vně), zjemnění sítě,
 * barvy mapy odchylek a umístění reference (otočení po 90°, středy kvádrů, levné automatické hledání).
 */
import { describe, expect, it } from "vitest";
import {
  bestRightAngleFit,
  boundsOfPoints,
  boxCenter,
  boxSize,
  bruteDistance,
  buildTriIndex,
  distanceColor,
  distanceColors,
  distanceStats,
  distancesToMesh,
  fitScore,
  MAP_GREEN,
  MAP_RED,
  MAP_YELLOW,
  meshArea,
  nearestOnMesh,
  placementFor,
  refineMesh,
  rightAngleRotations,
  rotationMatrix,
  samplePoints,
  transformBox,
  transformPoints,
  type Box,
} from "./mesh-distance";

type Mesh = { positions: Float32Array; indices: Uint32Array };

/** kvádr ⟨lo; hi⟩ – 8 vrcholů, 12 trojúhelníků, normály ven */
function boxMesh(lo: number[], hi: number[]): Mesh {
  const [x0, y0, z0] = lo;
  const [x1, y1, z1] = hi;
  const positions = new Float32Array([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]);
  const indices = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
  return { positions, indices };
}

/** koule z rovnoběžek a poledníků, normály ven */
function sphereMesh(radius: number, nu: number, nv: number, center = [0, 0, 0]): Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nv; j++) {
    const th = (Math.PI * j) / nv;
    for (let i = 0; i < nu; i++) {
      const ph = (2 * Math.PI * i) / nu;
      pos.push(center[0] + radius * Math.sin(th) * Math.cos(ph), center[1] + radius * Math.sin(th) * Math.sin(ph), center[2] + radius * Math.cos(th));
    }
  }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * nu + i;
      const b = j * nu + ((i + 1) % nu);
      const c = (j + 1) * nu + i;
      const d = (j + 1) * nu + ((i + 1) % nu);
      if (j > 0) idx.push(a, c, b);
      if (j < nv - 1) idx.push(b, c, d);
    }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

function merge(...ms: Mesh[]): Mesh {
  const positions = new Float32Array(ms.reduce((n, m) => n + m.positions.length, 0));
  const indices = new Uint32Array(ms.reduce((n, m) => n + m.indices.length, 0));
  let po = 0;
  let io = 0;
  for (const m of ms) {
    positions.set(m.positions, po);
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + po / 3;
    po += m.positions.length;
    io += m.indices.length;
  }
  return { positions, indices };
}

/** opakovatelná „náhodná“ čísla 0–1 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("nejbližší bod sítě", () => {
  const tri: Mesh = { positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), indices: new Uint32Array([0, 1, 2]) };
  const ix = buildTriIndex(tri.positions, tri.indices);

  it("jeden trojúhelník: vnitřek, hrany, vrcholy", () => {
    const cases: [number[], number[], number][] = [
      [[2, 3, 5], [2, 3, 0], 5], // nad vnitřkem
      [[5, -4, 0], [5, 0, 0], 4], // hrana AB
      [[-3, 5, 0], [0, 5, 0], 3], // hrana AC
      [[8, 8, 0], [5, 5, 0], Math.hypot(3, 3)], // přepona
      [[-3, -4, 0], [0, 0, 0], 5], // vrchol A
      [[14, -3, 0], [10, 0, 0], 5], // vrchol B
      [[-3, 14, 0], [0, 10, 0], 5], // vrchol C
      [[1, 1, 0], [1, 1, 0], 0], // na trojúhelníku
    ];
    for (const [p, q, d] of cases) {
      const n = nearestOnMesh(ix, p)!;
      expect(n.distance).toBeCloseTo(d, 6);
      expect(n.point[0]).toBeCloseTo(q[0], 6);
      expect(n.point[1]).toBeCloseTo(q[1], 6);
      expect(n.point[2]).toBeCloseTo(q[2], 6);
      expect(n.triangle).toBe(0);
    }
  });

  it("prázdná síť a degenerované trojúhelníky", () => {
    const empty = buildTriIndex(new Float32Array(0), new Uint32Array(0));
    expect(nearestOnMesh(empty, [0, 0, 0])).toBeNull();
    expect(distancesToMesh(empty, [1, 2, 3])[0]).toBe(Infinity);
    // druhý trojúhelník má nulovou plochu → vynechá se
    const deg = buildTriIndex(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5]), [0, 1, 2, 3, 3, 3]);
    expect(deg.triangles).toBe(1);
    expect(nearestOnMesh(deg, [5, 5, 5])!.triangle).toBe(0);
  });

  it("krychle: vzdálenost se znaménkem (vně +, uvnitř −), i na hranách a v rozích", () => {
    const b = boxMesh([0, 0, 0], [10, 10, 10]);
    const bx = buildTriIndex(b.positions, b.indices);
    expect(bx.orient).toBe(1);
    expect(bx.volume).toBeCloseTo(1000, 6);
    const signed = (p: number[]) => nearestOnMesh(bx, p)!.signed;
    expect(signed([5, 5, 13])).toBeCloseTo(3, 6); // nad horní stěnou
    expect(signed([5, 5, 8])).toBeCloseTo(-2, 6); // uvnitř, 2 pod horní stěnou
    expect(signed([5, 5, 5])).toBeCloseTo(-5, 6); // střed
    expect(signed([13, 14, 5])).toBeCloseTo(5, 6); // vně u svislé hrany
    expect(signed([13, 14, 22])).toBeCloseTo(13, 6); // vně u rohu (3, 4, 12)
    expect(signed([9, 9.5, 9.8])).toBeCloseTo(-0.2, 6); // uvnitř u rohu
    expect(signed([-1, -1, 5])).toBeCloseTo(Math.SQRT2, 6);
    // síť s normálami dovnitř (obrácené pořadí vrcholů) dává stejné znaménko – orientace se bere z objemu sítě
    const flipped = new Uint32Array(b.indices.length);
    for (let i = 0; i < b.indices.length; i += 3) flipped.set([b.indices[i], b.indices[i + 2], b.indices[i + 1]], i);
    const fx = buildTriIndex(b.positions, flipped);
    expect(fx.orient).toBe(-1);
    expect(nearestOnMesh(fx, [5, 5, 13])!.signed).toBeCloseTo(3, 6);
    expect(nearestOnMesh(fx, [5, 5, 8])!.signed).toBeCloseTo(-2, 6);
  });

  it("strom obalových kvádrů dává totéž co hrubá síla (koule 20 tisíc trojúhelníků, 3 000 bodů)", () => {
    const s = sphereMesh(50, 100, 101, [10, -20, 30]);
    const sx = buildTriIndex(s.positions, s.indices);
    expect(sx.triangles).toBe(s.indices.length / 3);
    expect(sx.depth).toBeLessThan(40);
    const rnd = rng(7);
    const pts = new Float32Array(3000 * 3);
    for (let i = 0; i < pts.length; i += 3) {
      pts[i] = 10 + (rnd() - 0.5) * 240;
      pts[i + 1] = -20 + (rnd() - 0.5) * 240;
      pts[i + 2] = 30 + (rnd() - 0.5) * 240;
    }
    const d = distancesToMesh(sx, pts, { signed: true });
    let worst = 0;
    let wrongSign = 0;
    for (let i = 0; i < 3000; i++) {
      const p = [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]];
      worst = Math.max(worst, Math.abs(bruteDistance(s.positions, s.indices, p) - Math.abs(d[i])));
      const exact = Math.hypot(p[0] - 10, p[1] + 20, p[2] - 30) - 50;
      // síť je vepsaná (odchylka od koule do 0,05 mm) → vzdálenost od sítě se od přesné liší nejvýš o tolik
      expect(Math.abs(d[i] - exact)).toBeLessThan(0.06);
      if (Math.abs(exact) > 0.1 && Math.sign(exact) !== Math.sign(d[i])) wrongSign++;
    }
    expect(worst).toBeLessThan(1e-4);
    expect(wrongSign).toBe(0);
  }, 120_000); // hrubá síla = 60 milionů dvojic bod–trojúhelník

  it("rychlost: 200 tisíc bodů proti 80 tisícům trojúhelníků v řádu stovek milisekund", () => {
    const s = sphereMesh(100, 200, 201);
    const t0 = performance.now();
    const sx = buildTriIndex(s.positions, s.indices);
    const tBuild = performance.now() - t0;
    // body na soustředné kouli o 2 mm větší (jako vrcholy modelu blízko reference), v pořadí po sobě
    const q = sphereMesh(102, 447, 448);
    const t1 = performance.now();
    const d = distancesToMesh(sx, q.positions, { signed: true });
    const tQuery = performance.now() - t1;
    const n = q.positions.length / 3;
    const st = distanceStats(d, 0.5);
    console.log(`strom ${sx.triangles} trojúhelníků: ${tBuild.toFixed(0)} ms · ${n} bodů: ${tQuery.toFixed(0)} ms (${((tQuery * 1000) / n).toFixed(2)} µs/bod)`);
    expect(n).toBeGreaterThan(200_000);
    expect(st.maxOut).toBeLessThan(2.06);
    expect(st.maxOut).toBeGreaterThan(1.99);
    expect(st.maxIn).toBe(0);
    expect(tQuery).toBeLessThan(5000); // běžně ~300 ms; rezerva pro zatížený stroj
  }, 60_000);
});

describe("zjemnění sítě (refineMesh)", () => {
  const b = boxMesh([0, 0, 0], [40, 20, 10]);
  const mesh = { vertices: b.positions, normals: null, triangles: b.indices, faceGroups: Int32Array.from([0, 12, 7, 12, 24, 9]) };

  it("původní vrcholy zůstávají, plocha se nemění, hrany nejsou delší než krok, síť je bez T-spojů", () => {
    const r = refineMesh(mesh, 3);
    expect(r.capped).toBe(false);
    expect(Array.from(r.vertices.subarray(0, b.positions.length))).toEqual(Array.from(b.positions));
    expect(meshArea(r.vertices, r.triangles)).toBeCloseTo(meshArea(b.positions, b.indices), 3);
    let longest = 0;
    const edges = new Map<string, number>();
    for (let t = 0; t < r.triangles.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = r.triangles[t + k];
        const c = r.triangles[t + ((k + 1) % 3)];
        longest = Math.max(longest, Math.hypot(r.vertices[a * 3] - r.vertices[c * 3], r.vertices[a * 3 + 1] - r.vertices[c * 3 + 1], r.vertices[a * 3 + 2] - r.vertices[c * 3 + 2]));
        const key = a < c ? `${a}-${c}` : `${c}-${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    expect(longest).toBeLessThanOrEqual(3 + 1e-6);
    // uzavřená síť: každá hrana patří právě dvěma trojúhelníkům (žádné T-spoje ani díry)
    expect([...edges.values()].every((n) => n === 2)).toBe(true);
    expect(r.triangles.length / 3).toBeGreaterThan(1000);
  });

  it("skupiny ploch se zachovají (stejné plochy, nové rozsahy pokrývají celou síť)", () => {
    const r = refineMesh(mesh, 5);
    expect(Array.from(r.faceGroups).filter((_, i) => i % 3 === 2)).toEqual([7, 9]);
    expect(r.faceGroups[0]).toBe(0);
    expect(r.faceGroups[0] + r.faceGroups[1]).toBe(r.faceGroups[3]);
    expect(r.faceGroups[3] + r.faceGroups[4]).toBe(r.triangles.length);
    // první skupina = spodní a horní stěna (z = 0 nebo 10)
    for (let i = r.faceGroups[0]; i < r.faceGroups[1]; i++) expect([0, 10]).toContain(r.vertices[r.triangles[i] * 3 + 2]);
  });

  it("normály se dopočítají a zůstanou jednotkové; strop počtu trojúhelníků se hlásí", () => {
    const normals = new Float32Array(b.positions.length);
    for (let i = 0; i < normals.length; i += 3) normals[i + 2] = 1;
    const r = refineMesh({ ...mesh, normals }, 4);
    expect(r.normals!.length).toBe(r.vertices.length);
    for (let i = 0; i < r.normals!.length; i += 3) expect(Math.hypot(r.normals![i], r.normals![i + 1], r.normals![i + 2])).toBeCloseTo(1, 5);
    const capped = refineMesh(mesh, 0.5, 500);
    expect(capped.capped).toBe(true);
    expect(capped.triangles.length / 3).toBeLessThanOrEqual(500);
    expect(meshArea(capped.vertices, capped.triangles)).toBeCloseTo(meshArea(b.positions, b.indices), 3);
    // krok větší než všechny hrany → síť beze změny
    const same = refineMesh(mesh, 1000);
    expect(same.triangles.length).toBe(b.indices.length);
    expect(same.vertices.length).toBe(b.positions.length);
  });

  it("bez zjemnění by odchylka uprostřed rovinné stěny nebyla vidět – po zjemnění je", () => {
    // reference = kvádr, který má místo rovné horní stěny „stan“ s vrcholem 4 mm nad středem; model = kvádr s rovnou horní stěnou
    const pos = new Float32Array([...b.positions, 20, 10, 14]);
    const idx = new Uint32Array([...Array.from(b.indices).filter((_, i) => Math.floor(i / 3) !== 2 && Math.floor(i / 3) !== 3), 4, 5, 8, 5, 6, 8, 6, 7, 8, 7, 4, 8]);
    const ix = buildTriIndex(pos, idx);
    expect(ix.orient).toBe(1);
    const coarse = distanceStats(distancesToMesh(ix, b.positions), 0.1);
    expect(coarse.max).toBeLessThan(1e-6); // 8 rohů kvádru leží na referenci → bez zjemnění vše „zelené“
    const r = refineMesh(mesh, 1.5);
    const d = distancesToMesh(ix, r.vertices, { signed: true });
    const fine = distanceStats(d, 0.1);
    // střed horní stěny je 4 / √1,16 = 3,714 mm pod šikmou stěnou stanu (uvnitř reference → záporná vzdálenost)
    expect(fine.max).toBeGreaterThan(3.6);
    expect(fine.max).toBeLessThanOrEqual(3.7140);
    expect(fine.maxIn).toBeCloseTo(-fine.max, 6);
    expect(fine.maxOut).toBeLessThan(1e-6);
    const w = fine.worst;
    expect(Math.hypot(r.vertices[w * 3] - 20, r.vertices[w * 3 + 1] - 10)).toBeLessThan(1.6);
    expect(r.vertices[w * 3 + 2]).toBe(10);
    // boky a dno jsou beze změny
    for (let i = 0; i < d.length; i++) if (r.vertices[i * 3 + 2] < 10) expect(Math.abs(d[i])).toBeLessThan(1e-6);
  });
});

describe("statistika a barvy mapy", () => {
  it("distanceStats: největší odchylka, strany, podíl v toleranci", () => {
    const s = distanceStats([0, 0.05, -0.2, 0.4, -0.01, Infinity], 0.1);
    expect(s.count).toBe(5);
    expect(s.max).toBeCloseTo(0.4, 6);
    expect(s.maxOut).toBeCloseTo(0.4, 6);
    expect(s.maxIn).toBeCloseTo(-0.2, 6);
    expect(s.within).toBeCloseTo(3 / 5, 6);
    expect(s.worst).toBe(3);
    expect(s.mean).toBeCloseTo((0 + 0.05 + 0.2 + 0.4 + 0.01) / 5, 6);
    expect(distanceStats([], 0.1)).toMatchObject({ count: 0, max: 0, within: 1, worst: -1 });
    expect(s.withinArea).toBeUndefined();
  });

  it("distanceStats se sítí: podíl PLOCHY v toleranci (nezávisí na hustotě bodů)", () => {
    // čtverec 10 × 10 ze dvou trojúhelníků + hustě dělený proužek 10 × 1 (20 trojúhelníků) vedle
    const pos: number[] = [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0];
    const idx: number[] = [0, 1, 2, 0, 2, 3];
    for (let i = 0; i <= 10; i++) pos.push(i, 20, 0, i, 21, 0);
    for (let i = 0; i < 10; i++) {
      const a = 4 + i * 2;
      idx.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
    const dist = new Float32Array(pos.length / 3); // čtverec v toleranci, proužek mimo
    dist.fill(5, 4);
    const st = distanceStats(dist, 0.1, { vertices: new Float32Array(pos), triangles: idx });
    expect(st.area).toBeCloseTo(110, 6);
    expect(st.withinArea).toBeCloseTo(100 / 110, 6); // podle plochy 91 %
    expect(st.within).toBeCloseTo(4 / 26, 6); // podle bodů jen 15 % – proužek má 22 bodů
    // trojúhelník s jedním vrcholem mimo toleranci se počítá dvěma třetinami plochy
    const one = distanceStats(Float32Array.from([0, 0, 1]), 0.1, { vertices: new Float32Array([0, 0, 0, 3, 0, 0, 0, 4, 0]), triangles: [0, 1, 2] });
    expect(one.area).toBeCloseTo(6, 6);
    expect(one.withinArea).toBeCloseTo(2 / 3, 6);
  });

  it("distanceColor: zelená v toleranci, žlutá těsně nad ní, červená od plné odchylky; znaménko nerozhoduje", () => {
    expect(distanceColor(0, 0.1, 1)).toEqual(MAP_GREEN);
    expect(distanceColor(0.1, 0.1, 1)).toEqual(MAP_GREEN);
    expect(distanceColor(-0.1, 0.1, 1)).toEqual(MAP_GREEN);
    const justOver = distanceColor(0.1001, 0.1, 1);
    for (let k = 0; k < 3; k++) expect(justOver[k]).toBeCloseTo(MAP_YELLOW[k], 2);
    expect(distanceColor(1, 0.1, 1)).toEqual(MAP_RED);
    expect(distanceColor(-5, 0.1, 1)).toEqual(MAP_RED);
    expect(distanceColor(0.5, 0.1, 0.1)).toEqual(MAP_RED); // plná odchylka = tolerance → vše nad tolerancí červené
    const mid = distanceColor(0.55, 0.1, 1); // polovina stupnice = oranžová
    expect(mid[0]).toBeGreaterThan(0.9);
    expect(mid[1]).toBeGreaterThan(0.4);
    expect(mid[1]).toBeLessThan(0.6);
    const c = distanceColors(Float32Array.from([0, 2, NaN]), 0.1, 1);
    expect(Array.from(c.subarray(0, 3))).toEqual(Array.from(Float32Array.from(MAP_GREEN)));
    expect(Array.from(c.subarray(3, 6))).toEqual(Array.from(Float32Array.from(MAP_RED)));
    expect(Array.from(c.subarray(6, 9))).toEqual(Array.from(Float32Array.from(MAP_RED))); // neznámá vzdálenost = odchylka
  });
});

describe("umístění reference", () => {
  it("rotationMatrix: otočení kolem X, Y, Z po 90° – přesná celočíselná ortonormální matice", () => {
    const mul = (m: number[], p: number[]) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[3] * p[0] + m[4] * p[1] + m[5] * p[2], m[6] * p[0] + m[7] * p[1] + m[8] * p[2]];
    expect(rotationMatrix([0, 0, 0])).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(mul(rotationMatrix([90, 0, 0]), [0, 1, 0])).toEqual([0, 0, 1]); // kolem X: Y → Z
    expect(mul(rotationMatrix([0, 90, 0]), [0, 0, 1])).toEqual([1, 0, 0]); // kolem Y: Z → X
    expect(mul(rotationMatrix([0, 0, 90]), [1, 0, 0])).toEqual([0, 1, 0]); // kolem Z: X → Y
    expect(mul(rotationMatrix([90, 0, 90]), [0, 1, 0])).toEqual([0, 0, 1]); // nejdřív X (Y → Z), potom Z (Z zůstává)
    expect(mul(rotationMatrix([90, 0, 90]), [1, 0, 0])).toEqual([0, 1, 0]);
    expect(rotationMatrix([-90, 0, 0])).toEqual(rotationMatrix([270, 0, 0]));
    expect(rotationMatrix([360, 450, 0])).toEqual(rotationMatrix([0, 90, 0]));
    for (const { m } of rightAngleRotations()) {
      const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
      expect(det).toBe(1);
      expect(m.every((v) => v === 0 || v === 1 || v === -1)).toBe(true);
    }
  });

  it("rightAngleRotations: 24 různých otočení, první je žádné otočení", () => {
    const all = rightAngleRotations();
    expect(all.length).toBe(24);
    expect(new Set(all.map((c) => c.m.join(","))).size).toBe(24);
    expect(all[0].rot).toEqual([0, 0, 0]);
    expect(all.slice(1, 4).every((c) => c.rot.filter(Boolean).length === 1)).toBe(true);
  });

  it("placementFor: otočení kolem počátku, středy kvádrů na sebe, ruční posun", () => {
    const model: Box = [[0, 0, 0], [40, 20, 10]];
    const ref: Box = [[100, 100, 100], [110, 140, 120]]; // 10 × 40 × 20
    const none = placementFor(false, [0, 0, 0], [1, 2, 3], model, ref);
    expect(none.t).toEqual([1, 2, 3]);
    const p = placementFor(true, [0, 90, 90], [0, 0, 0], model, ref);
    const moved = transformBox(ref, p.m, p.t);
    expect(boxCenter(moved).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([20, 10, 5]);
    expect(boxSize(moved)).toEqual([40, 20, 10]);
    const withOffset = placementFor(true, [0, 90, 90], [0.5, 0, -2], model, ref);
    expect(boxCenter(transformBox(ref, withOffset.m, withOffset.t)).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([20.5, 10, 3]);
    expect(placementFor(false, [-90, 450, 0], [0, 0, 0], model, ref).rot).toEqual([270, 90, 0]);
  });

  it("transformPoints + boundsOfPoints + samplePoints", () => {
    const b = boxMesh([0, 0, 0], [4, 2, 1]);
    const moved = transformPoints(b.positions, rotationMatrix([0, 0, 90]), [10, 0, 0]);
    expect(boundsOfPoints(moved)).toEqual([[8, 0, 0], [10, 4, 1]]);
    expect(boundsOfPoints([])).toEqual([[0, 0, 0], [0, 0, 0]]);
    const pts = new Float32Array(3000).map((_, i) => i);
    const s = samplePoints(pts, 100);
    expect(s.length / 3).toBeLessThanOrEqual(100);
    expect(s.length / 3).toBeGreaterThan(80);
    expect(Array.from(s.subarray(0, 6))).toEqual([0, 1, 2, 30, 31, 32]);
    expect(samplePoints(pts, 5000)).toBe(pts);
  });

  // nesouměrný díl: kvádr 40 × 20 × 10 s malým výstupkem u jednoho rohu horní stěny (uvnitř obalového kvádru zářezu není – výstupek kvádr zvětšuje)
  const part = merge(boxMesh([0, 0, 0], [40, 20, 10]), boxMesh([2, 2, 10], [8, 6, 13]));
  const partIx = buildTriIndex(part.positions, part.indices);
  const partBox = boundsOfPoints(part.positions);
  /** hustší body na povrchu dílu (vrcholy zjemněné sítě) */
  const dense = refineMesh({ vertices: part.positions, triangles: part.indices }, 2).vertices;

  it("fitScore: nula ve správné poloze, omezení vzdálenosti stropem", () => {
    expect(fitScore(partIx, dense, [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0])).toBeLessThan(1e-6);
    expect(fitScore(partIx, dense, [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 500])).toBeGreaterThan(400);
    expect(fitScore(partIx, dense, [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 500], 2)).toBeCloseTo(2, 6);
    expect(fitScore(buildTriIndex(new Float32Array(0), []), dense, [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0])).toBe(Infinity);
  });

  it("bestRightAngleFit: reference ve stejné poloze → nic se nepřesouvá", () => {
    const f = bestRightAngleFit(partIx, partBox, dense, partBox);
    expect(f.asIs).toBe(true);
    expect(f.rot).toEqual([0, 0, 0]);
    expect(f.t).toEqual([0, 0, 0]);
    expect(f.score).toBeLessThan(1e-6);
  });

  it("bestRightAngleFit: reference otočená po 90° a posunutá → najde polohu, ve které sedí (všech 24 otočení)", () => {
    for (const c of rightAngleRotations()) {
      // reference = díl otočený a posunutý; hledá se cesta zpět
      const shift = [123, -45, 67];
      const refPts = transformPoints(dense, c.m, shift);
      const refBox = boundsOfPoints(refPts);
      const f = bestRightAngleFit(partIx, partBox, refPts, refBox);
      if (c.rot.some(Boolean)) expect(f.asIs).toBe(false);
      expect(f.score).toBeLessThan(1e-4);
      // po umístění leží body reference na dílu
      const back = transformPoints(refPts, f.m, f.t);
      expect(distanceStats(distancesToMesh(partIx, back), 0.01).max).toBeLessThan(1e-3);
    }
  });

  it("bestRightAngleFit: reference s prvkem navíc (jiný obalový kvádr) ve stejné poloze zůstane „jak je“", () => {
    // reference má navíc velký výstupek na boku → středy kvádrů nesedí, poloha „jak je“ je správně
    const ref = merge(part, boxMesh([40, 5, 0], [55, 15, 10]));
    const refDense = refineMesh({ vertices: ref.positions, triangles: ref.indices }, 2).vertices;
    const f = bestRightAngleFit(partIx, partBox, refDense, boundsOfPoints(ref.positions));
    expect(f.asIs).toBe(true);
    expect(f.asIsScore).toBeLessThan(1); // jen body výstupku jsou daleko (a jsou omezené stropem)
  });
});
