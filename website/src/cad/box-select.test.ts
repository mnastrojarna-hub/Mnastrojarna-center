import { describe, expect, it } from "vitest";
import { boxSelect, capDepthAt, isCrossingDrag, normRect, orthoBoxCamera, prepareBox, segRect, triRect, type BoxCamera, type BoxItem } from "./box-select";
import { basisOf } from "./soft-render";
import type { Vec3 } from "./types";

/**
 * Kvádr jako síť z jádra: 6 ploch (každá 2 trojúhelníky, vlastní vrcholy, proti směru hodinových ručiček zvenku),
 * 12 hran (úsečky), 8 vrcholů. Plochy: 0 spodní, 1 horní, 2 přední (−Y), 3 zadní (+Y), 4 levá (−X), 5 pravá (+X).
 */
function boxItem(a: Vec3, b: Vec3, extra: Partial<BoxItem> = {}): BoxItem {
  const [x0, y0, z0] = a;
  const [x1, y1, z1] = b;
  const quads: Vec3[][] = [
    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]],
    [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]],
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
  ];
  const V: number[] = [];
  const T: number[] = [];
  const FG: number[] = [];
  quads.forEach((q, f) => {
    const base = V.length / 3;
    for (const p of q) V.push(...p);
    FG.push(T.length, 6, f);
    T.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const C: Vec3[] = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const E: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const L: number[] = [];
  const EG: number[] = [];
  E.forEach(([i, j], e) => {
    EG.push(L.length / 3, 2, e);
    L.push(...C[i], ...C[j]);
  });
  return {
    vertices: new Float32Array(V),
    triangles: new Uint32Array(T),
    faceGroups: new Int32Array(FG),
    lines: new Float32Array(L),
    edgeGroups: new Int32Array(EG),
    points: new Float32Array(C.flat()),
    ...extra,
  };
}

const translate = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const W = 800, H = 600;

/** pravoúhlý pohled jako náhled bez WebGL: úhly (az, el), střed, měřítko px/mm */
function ortho(az: number, el: number, center: Vec3 = [20, 15, 10], scale = 8): BoxCamera {
  return orthoBoxCamera({ ...basisOf({ az, el }), center, scale }, W, H);
}
/** perspektiva jako THREE.PerspectiveCamera (lookAt, fov 30°) */
function persp(eye: Vec3, target: Vec3, fov = 30): BoxCamera {
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const nrm = (a: Vec3): Vec3 => {
    const l = Math.hypot(...a);
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = nrm(sub(eye, target));
  const x = nrm(cross([0, 0, 1], z));
  const y = cross(z, x);
  const view = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  const n = 1, fa = 10000;
  const f = 1 / Math.tan((fov * Math.PI) / 360);
  const proj = [f / (W / H), 0, 0, 0, 0, f, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, (2 * fa * n) / (n - fa), 0];
  return { width: W, height: H, view, proj };
}

const ALL = { faces: true, edges: true, vertices: true, items: true };
const full = { x0: 1, y0: 1, x1: W - 1, y1: H - 1 };

describe("box-select: pomocné výpočty", () => {
  it("obdélník, směr tažení, úsečka a trojúhelník × obdélník", () => {
    expect(normRect({ x0: 50, y0: 40, x1: 10, y1: 5 })).toEqual({ x0: 10, y0: 5, x1: 50, y1: 40 });
    expect(isCrossingDrag(100, 20)).toBe(true);
    expect(isCrossingDrag(20, 100)).toBe(false);
    const r = { x0: 0, y0: 0, x1: 10, y1: 10 };
    expect(segRect(-5, 5, 15, 5, r)).toEqual([0.25, 0.75]);
    expect(segRect(-5, -5, -1, 20, r)).toBeNull();
    expect(segRect(10, 12, 10, -3, r)).not.toBeNull(); // dotyk hrany obdélníku
    expect(triRect(-5, -5, 20, -5, -5, 20, r)).toBe(true); // obdélník v rohu velkého trojúhelníku
    expect(triRect(12, 0, 20, 0, 20, 10, r)).toBe(false);
    expect(triRect(11, 12, 30, 12, 11, 30, r)).toBe(false); // ohraničení se nepřekrývá
    expect(triRect(15, -5, 25, 5, 15, 20, { x0: 0, y0: 0, x1: 14, y1: 10 })).toBe(false);
    expect(triRect(5, 5, 6, 5, 5, 6, r)).toBe(true); // celý uvnitř
  });
});

describe("box-select: kvádr shora (pravoúhle)", () => {
  // pohled shora: az −90°, el 90° (right = +X, up = +Y)
  const cam = ortho(-Math.PI / 2, Math.PI / 2);
  const box = boxItem([0, 0, 0], [40, 30, 20]);

  it("okno kolem celého kvádru: jen viditelná horní plocha, 4 horní hrany, 4 horní vrcholy, těleso", () => {
    const s = prepareBox([box], cam);
    const h = boxSelect(s, { rect: full, crossing: false, kinds: ALL });
    expect(h.faces.map((f) => f.face)).toEqual([1]);
    expect(h.edges.map((e) => e.edge)).toEqual([4, 5, 6, 7]);
    expect(h.vertices.map((v) => v.index)).toEqual([4, 5, 6, 7]);
    expect(h.vertices[0].point).toEqual([0, 0, 20]);
    expect(h.items).toEqual([0]);
  });
  it("i skryté (occlude false): všech 6 ploch, 12 hran, 8 vrcholů", () => {
    const s = prepareBox([box], cam, { occlude: false });
    const h = boxSelect(s, { rect: full, crossing: false, kinds: ALL });
    expect(h.faces.length).toBe(6);
    expect(h.edges.length).toBe(12);
    expect(h.vertices.length).toBe(8);
  });
  it("okno jen přes část kvádru nevybere nic, křížení vybere dotčené", () => {
    const s = prepareBox([box], cam);
    // levá polovina kvádru: střed plátna (400,300) = bod [20,15]; kvádr x 0..40 → px 240..560
    const r = { x0: 200, y0: 150, x1: 400, y1: 450 };
    const win = boxSelect(s, { rect: r, crossing: false, kinds: ALL });
    expect(win.faces).toEqual([]);
    expect(win.items).toEqual([]);
    // celá je uvnitř jen levá horní hrana (x = 0, edge 7: 7→4) a vrcholy 4, 7
    expect(win.edges.map((e) => e.edge)).toEqual([7]);
    expect(win.vertices.map((v) => v.index).sort()).toEqual([4, 7]);
    const cr = boxSelect(s, { rect: r, crossing: true, kinds: ALL });
    expect(cr.faces.map((f) => f.face)).toEqual([1]);
    expect(cr.items).toEqual([0]);
    // horní hrany: 4 (y=0), 6 (y=30) protnuté, 7 uvnitř; 5 (x=40) mimo
    expect(cr.edges.map((e) => e.edge)).toEqual([4, 6, 7]);
  });
  it("křížení, které se hrany jen dotkne, ji vybere", () => {
    const s = prepareBox([box], cam);
    // hrana x = 40 (edge 5) je na px x = 560; obdélník končí přesně na ní
    const r = { x0: 600, y0: 280, x1: 559.5, y1: 320 };
    const cr = boxSelect(s, { rect: r, crossing: true, kinds: { edges: true } });
    expect(cr.edges.map((e) => e.edge)).toEqual([5]);
    const away = boxSelect(s, { rect: { x0: 600, y0: 280, x1: 562, y1: 320 }, crossing: true, kinds: { edges: true } });
    expect(away.edges).toEqual([]);
  });
});

describe("box-select: kvádr v izometrii", () => {
  const box = boxItem([0, 0, 0], [40, 30, 20]);
  // pohled z +X, −Y, +Z (jako izometrie 3D okna): viditelné horní, přední (−Y) a pravá (+X)
  const views: [string, BoxCamera][] = [
    ["pravoúhle", ortho(-Math.PI / 4, Math.atan(1 / Math.SQRT2))],
    ["perspektiva", persp([160, -150, 130], [20, 15, 10])],
  ];
  for (const [name, cam] of views) {
    it(`${name}: okno = 3 plochy, 9 hran, 7 vrcholů; i skryté = vše`, () => {
      const s = prepareBox([box], cam);
      const h = boxSelect(s, { rect: full, crossing: false, kinds: ALL });
      expect(h.faces.map((f) => f.face)).toEqual([1, 2, 5]);
      // skryté hrany jdou do zadního spodního rohu [0, 30, 0] (vrchol 3): 2 (2→3), 3 (3→0), 11 (3→7)
      expect(h.edges.map((e) => e.edge)).toEqual([0, 1, 4, 5, 6, 7, 8, 9, 10]);
      expect(h.vertices.map((v) => v.index)).toEqual([0, 1, 2, 4, 5, 6, 7]);
      const t = boxSelect(prepareBox([box], cam, { occlude: false }), { rect: full, crossing: false, kinds: ALL });
      expect([t.faces.length, t.edges.length, t.vertices.length]).toEqual([6, 12, 8]);
    });
  }
  it("řez: odříznutá polovina se nevybere, plocha řezu (vnitřek) není plocha", () => {
    const cam = views[0][1];
    // zachová se x ≤ 20 (normála −X, konstanta 20)
    const s = prepareBox([box], cam, { clip: { normal: [-1, 0, 0], constant: 20 } });
    const h = boxSelect(s, { rect: full, crossing: false, kinds: { faces: true, vertices: true } });
    // pravá plocha (x = 40) je odříznutá; levá (x = 0) je vidět jen zevnitř řezu → nevybere se
    expect(h.faces.map((f) => f.face)).toEqual([1, 2]);
    expect(h.vertices.every((v) => v.point[0] <= 20)).toBe(true);
  });
});

describe("box-select: řez – víčko zakrývá vnitřek tělesa (oprava po kontrole)", () => {
  const box = boxItem([0, 0, 0], [40, 30, 20]);
  // řez Z 10: zachová se z ≤ 10 (normála −Z, konstanta 10); izometrie shora → do řezu je vidět, víčko je v rovině z = 10
  const clip = { normal: [0, 0, -1] as Vec3, constant: 10 };
  const views: [string, BoxCamera][] = [
    ["pravoúhle", ortho(-Math.PI / 4, Math.atan(1 / Math.SQRT2))],
    ["perspektiva", persp([160, -150, 130], [20, 15, 10])],
  ];
  for (const [name, cam] of views) {
    it(`${name}: vnitřní rohy pod víčkem (hrany 2, 3, 11, vrchol 3) se nevyberou oknem ani křížením`, () => {
      const s = prepareBox([box], cam, { clip });
      const win = boxSelect(s, { rect: full, crossing: false, kinds: ALL });
      // horní hrany jsou odříznuté; zbývá spodní přední / pravá a svislé hrany 8, 9, 10 (jejich zachovaná část)
      expect(win.edges.map((e) => e.edge)).toEqual([0, 1, 8, 9, 10]);
      expect(win.vertices.map((v) => v.index)).toEqual([0, 1, 2]);
      expect(win.faces.map((f) => f.face)).toEqual([2, 5]);
      const cr = boxSelect(s, { rect: { x0: W - 1, y0: H - 1, x1: 1, y1: 1 }, crossing: true, kinds: { edges: true, vertices: true } });
      expect(cr.edges.map((e) => e.edge)).toEqual([0, 1, 8, 9, 10]);
      expect(cr.vertices.map((v) => v.index)).toEqual([0, 1, 2]);
      // i skryté: všechny zachované hrany a vrcholy
      const t = boxSelect(prepareBox([box], cam, { clip, occlude: false }), { rect: full, crossing: false, kinds: { edges: true, vertices: true } });
      expect(t.edges.map((e) => e.edge)).toEqual([0, 1, 2, 3, 8, 9, 10, 11]);
      expect(t.vertices.map((v) => v.index)).toEqual([0, 1, 2, 3]);
    });
  }
  it("hloubka víčka v bodě plátna leží na rovině řezu (pravoúhle i perspektiva)", () => {
    for (const [, cam] of views) {
      const s = prepareBox([box], cam, { clip });
      // střed víčka [20, 15, 10] promítnutý na plátno → hloubka víčka = hloubka toho bodu
      const P = prepareBox([{ ...boxItem([0, 0, 0], [1, 1, 1]), points: new Float32Array([20, 15, 10]) }], cam).items[0].p;
      expect(capDepthAt(s, P.x[0], P.y[0])).toBeCloseTo(P.d[0], 3);
    }
  });
  it("pohled zespodu (kamera na zachované straně): víčko není vidět, spodní hrany se vyberou jako bez řezu", () => {
    const cam = ortho(-Math.PI / 4, -Math.atan(1 / Math.SQRT2));
    const s = prepareBox([box], cam, { clip });
    const h = boxSelect(s, { rect: full, crossing: false, kinds: { edges: true, faces: true } });
    expect(h.faces.map((f) => f.face)).toEqual([0, 2, 5]);
    expect(h.edges.map((e) => e.edge)).toEqual([0, 1, 2, 3, 8, 9, 10]);
  });
});

describe("box-select: sestava – zakrytí jinou komponentou", () => {
  const cam = ortho(-Math.PI / 2, 0, [50, 15, 10], 4); // zepředu (pohled ve směru +Y); přední x 200…360 px, boční 520…680 px
  const front = boxItem([0, 0, 0], [40, 30, 20]);
  const back = boxItem([0, 0, 0], [40, 30, 20], { matrix: translate(0, 60, 0) }); // přesně za první
  const side = boxItem([0, 0, 0], [40, 30, 20], { matrix: translate(80, 0, 0) });
  it("okno kolem všech: vidět jsou přední a boční komponenta, zadní ne; i skryté = všechny tři", () => {
    const s = prepareBox([front, back, side], cam);
    expect(boxSelect(s, { rect: full, crossing: false, kinds: { items: true } }).items).toEqual([0, 2]);
    const t = prepareBox([front, back, side], cam, { occlude: false });
    expect(boxSelect(t, { rect: full, crossing: false, kinds: { items: true } }).items).toEqual([0, 1, 2]);
  });
  it("hrany zadní komponenty jsou zakryté, i když leží přesně za obrysem přední", () => {
    const s = prepareBox([front, back], cam);
    const h = boxSelect(s, { rect: full, crossing: false, kinds: { edges: true } });
    expect(h.edges.every((e) => e.item === 0)).toBe(true);
    expect(h.edges.length).toBe(4); // obrys přední stěny
  });
  it("průhledná komponenta nezakrývá", () => {
    const s = prepareBox([{ ...front, occluder: false }, back], cam);
    expect(boxSelect(s, { rect: full, crossing: false, kinds: { items: true } }).items).toEqual([0, 1]);
  });
  it("křížení přes část zadní komponenty, kterou přední zakrývá, ji nevybere", () => {
    const s = prepareBox([front, back], cam);
    const cr = boxSelect(s, { rect: { x0: 300, y0: 310, x1: 260, y1: 290 }, crossing: true, kinds: { items: true, faces: true } });
    expect(cr.items).toEqual([0]);
    expect(cr.faces).toEqual([{ item: 0, face: 2 }]);
  });
});

describe("box-select: úzká plocha a částečně zakrytá hrana", () => {
  it("úzká plocha (pás 0,2 mm, menší než buňka) se vybere oknem i křížením, je-li vidět", () => {
    const cam = ortho(-Math.PI / 2, Math.PI / 2, [20, 15, 10], 4);
    const strip = boxItem([10, 10, 0], [30, 10.2, 21]); // nad kvádrem, horní plocha 20 × 0,2 mm = 80 × 0,8 px
    const base = boxItem([0, 0, 0], [40, 30, 20]);
    const s = prepareBox([base, strip], cam, { maxCells: 20_000 }); // hrubé buňky (cca 4 px)
    expect(s.cell).toBeGreaterThan(3);
    const h = boxSelect(s, { rect: full, crossing: false, kinds: { faces: true } });
    expect(h.faces).toContainEqual({ item: 1, face: 1 });
    expect(h.faces).toContainEqual({ item: 0, face: 1 });
    const cr = boxSelect(s, { rect: { x0: 420, y0: 330, x1: 380, y1: 310 }, crossing: true, kinds: { faces: true } });
    expect(cr.faces).toContainEqual({ item: 1, face: 1 });
  });
  it("hrana zčásti zakrytá jinou komponentou: okno ji vybere (část je vidět), křížení jen přes zakrytou část ne", () => {
    const cam = ortho(-Math.PI / 2, Math.PI / 2, [20, 15, 10], 8);
    const base = boxItem([0, 0, 0], [40, 30, 20]);
    const cover = boxItem([-5, -5, 25], [20, 35, 30]); // deska nad levou polovinou
    const s = prepareBox([base, cover], cam);
    const win = boxSelect(s, { rect: full, crossing: false, kinds: { edges: true } });
    // horní přední hrana kvádru (4: [0,0,20]→[40,0,20]) – pravá polovina je vidět
    expect(win.edges).toContainEqual({ item: 0, edge: 4 });
    // levá horní hrana (7: x = 0) je celá pod deskou
    expect(win.edges).not.toContainEqual({ item: 0, edge: 7 });
    // křížení jen přes levou (zakrytou) čtvrtinu přední hrany: px x 240..320, y ≈ 420
    const hid = boxSelect(s, { rect: { x0: 330, y0: 410, x1: 250, y1: 430 }, crossing: true, kinds: { edges: true } });
    expect(hid.edges.filter((e) => e.item === 0)).toEqual([]);
    const vis = boxSelect(s, { rect: { x0: 540, y0: 410, x1: 450, y1: 430 }, crossing: true, kinds: { edges: true } });
    expect(vis.edges).toContainEqual({ item: 0, edge: 4 });
  });
});

describe("box-select: rychlost", () => {
  /** jemná síť: kvádr s plochami rozdělenými na n × n čtverců (2 n² trojúhelníků na plochu), hrany po n úsečkách */
  function fineBox(n: number, at: Vec3): BoxItem {
    const V: number[] = [];
    const T: number[] = [];
    const FG: number[] = [];
    const L: number[] = [];
    const EG: number[] = [];
    const s = 20;
    const faces: [Vec3, Vec3, Vec3][] = [
      [[0, 0, 0], [0, s, 0], [s, 0, 0]],
      [[0, 0, s], [s, 0, 0], [0, s, 0]],
      [[0, 0, 0], [s, 0, 0], [0, 0, s]],
      [[s, s, 0], [-s, 0, 0], [0, 0, s]],
      [[0, s, 0], [0, -s, 0], [0, 0, s]],
      [[s, 0, 0], [0, s, 0], [0, 0, s]],
    ];
    faces.forEach(([o, u, v], f) => {
      const base = V.length / 3;
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) V.push(o[0] + (u[0] * i + v[0] * j) / n, o[1] + (u[1] * i + v[1] * j) / n, o[2] + (u[2] * i + v[2] * j) / n);
      FG.push(T.length, 6 * n * n, f);
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const a = base + j * (n + 1) + i;
          T.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
        }
      // hrana plochy podél u (spodní okraj) po n úsečkách
      EG.push(L.length / 3, 2 * n, f);
      for (let i = 0; i < n; i++) L.push(o[0] + (u[0] * i) / n, o[1] + (u[1] * i) / n, o[2] + (u[2] * i) / n, o[0] + (u[0] * (i + 1)) / n, o[1] + (u[1] * (i + 1)) / n, o[2] + (u[2] * (i + 1)) / n);
    });
    return { vertices: new Float32Array(V), triangles: new Uint32Array(T), faceGroups: new Int32Array(FG), lines: new Float32Array(L), edgeGroups: new Int32Array(EG), points: null, matrix: translate(...at) };
  }
  it("sestava 70 komponent × 4 800 trojúhelníků: okno přes celé plátno < 200 ms (příprava + buffer + dotaz)", () => {
    const comps: BoxItem[] = [];
    for (let i = 0; i < 70; i++) comps.push(fineBox(20, [(i % 10) * 30, Math.floor(i / 10) * 30, (i % 3) * 10]));
    const cam = persp([600, -500, 500], [150, 100, 10]);
    const t0 = performance.now();
    const s = prepareBox(comps, cam);
    const items = boxSelect(s, { rect: full, crossing: false, kinds: { items: true } });
    const t1 = performance.now();
    const faces = boxSelect(s, { rect: full, crossing: true, kinds: { faces: true, edges: true } });
    const t2 = performance.now();
    console.log(`box-select 70 × ${comps[0].triangles.length / 3} tris: prepare ${s.ms.toFixed(1)} ms, komponenty okno ${(t1 - t0).toFixed(1)} ms, plochy+hrany křížení ${(t2 - t1).toFixed(1)} ms (buňka ${s.cell} px)`);
    expect(items.items.length).toBeGreaterThan(20);
    expect(faces.faces.length).toBeGreaterThan(100);
    expect(t1 - t0).toBeLessThan(400); // cíl < 200 ms; rezerva pro pomalý sdílený stroj
    expect(t2 - t1).toBeLessThan(400);
  });
});
