import { describe, expect, it } from "vitest";
import { VIEW_ANGLES, basisOf, fitCamera, type SoftCamera, type SoftViewName } from "./soft-render";
import { buildPickIndex, circleOf, edgeNear, edgeSnaps, pickAt, projectPoint, snapNear, softHintSteps, softHints, surfaceAt, vertexNear, type PickItem, type SoftPickIndex } from "./soft-pick";
import type { Vec3 } from "./types";

/**
 * Kvádr jako síť z jádra: 6 ploch (F1 spodní, F2 horní, F3 přední −Y, F4 zadní +Y, F5 levá −X, F6 pravá +X),
 * 12 hran (E1–E4 spodní obvod, E5–E8 horní obvod, E9–E12 svislé), 8 vrcholů (V1–V4 dole, V5–V8 nahoře).
 */
function box(min: Vec3, max: Vec3, extra: Partial<PickItem> = {}): PickItem {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const faces: [Vec3, Vec3, Vec3, Vec3, Vec3][] = [
    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1]],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]],
    [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [0, 1, 0]],
    [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [-1, 0, 0]],
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]],
  ];
  const v: number[] = [];
  const n: number[] = [];
  const t: number[] = [];
  const fg: number[] = [];
  faces.forEach((f, i) => {
    for (let k = 0; k < 4; k++) {
      v.push(...f[k]);
      n.push(...f[4]);
    }
    t.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    fg.push(i * 6, 6, i);
  });
  const c: Vec3[] = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const l: number[] = [];
  const eg: number[] = [];
  e.forEach(([a, b], i) => {
    l.push(...c[a], ...c[b]);
    eg.push(i * 2, 2, i);
  });
  return {
    vertices: new Float32Array(v),
    normals: new Float32Array(n),
    triangles: new Uint32Array(t),
    lines: new Float32Array(l),
    faceGroups: new Int32Array(fg),
    edgeGroups: new Int32Array(eg),
    points: new Float32Array(c.flat()),
    color: [185, 194, 204],
    ...extra,
  };
}

const W = 800;
const H = 600;
const cam = (items: PickItem[], v: SoftViewName = "iso"): SoftCamera => fitCamera(items, basisOf(VIEW_ANGLES[v]), W, H, 0.8);
const B = box([0, 0, 0], [40, 30, 20]);
const ixIso = () => buildPickIndex([B], { width: W, height: H, camera: cam([B]) });
const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

describe("soft-pick – plochy", () => {
  it("klik na promítnutý střed plochy vrátí tuto plochu a bod na ní", () => {
    const ix = ixIso();
    // izometrie (pohled od +X, −Y, +Z): vidět jsou horní F2, přední F3 a pravá F6
    const cases: [Vec3, number][] = [
      [[20, 15, 20], 1],
      [[20, 0, 10], 2],
      [[40, 15, 10], 5],
    ];
    for (const [p, face] of cases) {
      const [x, y] = projectPoint(ix, p);
      const r = pickAt(ix, x, y, "face");
      expect(r?.kind).toBe("face");
      expect((r as { index: number }).index).toBe(face);
      r!.point.forEach((v, i) => expect(v).toBeCloseTo(p[i], 3));
      // filtr „vše“ ve středu plochy (daleko od hran a vrcholů) dá také plochu
      expect(pickAt(ix, x, y, "all")).toMatchObject({ kind: "face", index: face });
    }
  });

  it("zakryté plochy se nevyberou (spodní, zadní, levá)", () => {
    const ix = ixIso();
    for (const [p, hidden] of [
      [[20, 15, 0], 0],
      [[20, 30, 10], 3],
      [[0, 15, 10], 4],
    ] as [Vec3, number][]) {
      const [x, y] = projectPoint(ix, p);
      const r = pickAt(ix, x, y, "face");
      expect(r).not.toBeNull();
      expect((r as { index: number }).index).not.toBe(hidden);
      // vybraný bod leží na viditelné ploše – blíž ke kameře než zakrytý bod
      expect(projectPoint(ix, r!.point)[2]).toBeGreaterThan(projectPoint(ix, p)[2]);
    }
  });

  it("mimo model nic, těleso a komponenta podle filtru", () => {
    const ix = ixIso();
    expect(pickAt(ix, 3, 3, "all")).toBeNull();
    const [x, y] = projectPoint(ix, [20, 15, 20]);
    expect(pickAt(ix, x, y, "body")).toMatchObject({ kind: "body" });
    expect(pickAt(ix, x, y, "feature")).toMatchObject({ kind: "body" });
    // díl: filtr komponenta vybere těleso (jako 3D okno)
    expect(pickAt(ix, x, y, "component")).toMatchObject({ kind: "body" });
  });

  it("každý pohled: střed plochy přivrácené ke kameře se vybere", () => {
    const want: Record<Exclude<SoftViewName, "iso">, [Vec3, number]> = {
      top: [[20, 15, 20], 1],
      bottom: [[20, 15, 0], 0],
      front: [[20, 0, 10], 2],
      back: [[20, 30, 10], 3],
      left: [[0, 15, 10], 4],
      right: [[40, 15, 10], 5],
    };
    for (const [v, [p, face]] of Object.entries(want)) {
      const ix = buildPickIndex([B], { width: W, height: H, camera: cam([B], v as SoftViewName) });
      const [x, y] = projectPoint(ix, p);
      expect(pickAt(ix, x, y, "face"), v).toMatchObject({ kind: "face", index: face });
    }
  });
});

describe("soft-pick – hrany a vrcholy", () => {
  it("u hrany vrátí hranu (do ~6 px), dál už plochu", () => {
    const ix = ixIso();
    // horní přední hrana E5: (0,0,20)–(40,0,20); posun 3 px „dovnitř“ horní plochy
    const [mx, my] = projectPoint(ix, [20, 0, 20]);
    const [ax, ay] = projectPoint(ix, [0, 0, 20]);
    const [cx, cy] = projectPoint(ix, [20, 15, 20]);
    // kolmice k promítnuté hraně, natočená k horní ploše
    let nx = -(my - ay), ny = mx - ax;
    const nl = Math.hypot(nx, ny);
    nx /= nl;
    ny /= nl;
    if (nx * (cx - mx) + ny * (cy - my) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const at = (px: number) => [mx + nx * px, my + ny * px] as const;
    expect(pickAt(ix, ...at(3), "all")).toMatchObject({ kind: "edge", index: 4 });
    expect(pickAt(ix, ...at(3), "edge")).toMatchObject({ kind: "edge", index: 4 });
    expect(pickAt(ix, ...at(5.5), "edge")).toMatchObject({ kind: "edge", index: 4 });
    expect(pickAt(ix, ...at(9), "edge")).toBeNull();
    expect(pickAt(ix, ...at(9), "all")).toMatchObject({ kind: "face", index: 1 });
    // filtr plocha u hrany vybere plochu pod kurzorem
    expect(pickAt(ix, ...at(3), "face")).toMatchObject({ kind: "face", index: 1 });
    const h = edgeNear(ix, ...at(3));
    expect(h!.dist).toBeCloseTo(3, 1);
    expect(h!.point[1]).toBeCloseTo(0, 3);
    expect(h!.point[2]).toBeCloseTo(20, 3);
  });

  it("zakryté hrany se nevyberou, obrysová hrana ano", () => {
    const ix = ixIso();
    // spodní zadní hrana E3 (40,30,0)–(0,30,0) a zadní svislá E12 (0,30,0)–(0,30,20) jsou za tělesem
    for (const [a, b, e] of [
      [[40, 30, 0], [0, 30, 0], 2],
      [[0, 30, 0], [0, 30, 20], 11],
    ] as [Vec3, Vec3, number][]) {
      const [x, y] = projectPoint(ix, mid(a, b));
      const r = pickAt(ix, x, y, "edge");
      expect(r === null || (r as { index: number }).index !== e).toBe(true);
    }
    // obrysová hrana E6 (40,0,20)–(40,30,20) – horní pravá, vidět
    const [x, y] = projectPoint(ix, [40, 15, 20]);
    expect(pickAt(ix, x + 2, y - 2, "edge")).toMatchObject({ kind: "edge", index: 5 });
    // vně obrysu, ale do 6 px od hrany – vybere se také
    const [ox, oy] = projectPoint(ix, [40, 30, 10]);
    expect(pickAt(ix, ox + 4, oy, "edge")).toMatchObject({ kind: "edge", index: 10 });
  });

  it("vrchol do ~7 px; zakrytý vrchol se nevybere", () => {
    const ix = ixIso();
    const [x, y] = projectPoint(ix, [40, 0, 20]); // V6 – roh nahoře vpravo vpředu
    expect(pickAt(ix, x + 3, y + 3, "all")).toMatchObject({ kind: "vertex", index: 5 });
    expect(pickAt(ix, x + 4, y - 4, "vertex")).toMatchObject({ kind: "vertex", index: 5 });
    expect(pickAt(ix, x + 9, y + 9, "vertex")).toBeNull();
    const [hx, hy] = projectPoint(ix, [0, 30, 0]); // V4 – za tělesem
    const r = vertexNear(ix, hx, hy);
    expect(r === null || r.index !== 3).toBe(true);
  });
});

describe("soft-pick – řez, sestava, uchopení", () => {
  it("řez: odříznutá část se nevybere, plocha řezu také ne", () => {
    // zachová se x ≤ 20 (normála −X, konstanta 20)
    const clip = { normal: [-1, 0, 0] as Vec3, constant: 20 };
    const ix = buildPickIndex([B], { width: W, height: H, camera: cam([B]), clip });
    // horní plocha za řezem (x = 30) – odříznutá; pod ní je vidět vnitřek (plocha řezu) nebo nic
    const [x, y] = projectPoint(ix, [30, 15, 20]);
    const r = pickAt(ix, x, y, "face");
    expect(r === null || r.point[0] <= 20 + 1e-6).toBe(true);
    expect(r === null || (r as { index: number }).index !== 1).toBe(true);
    // horní plocha před řezem (x = 10) zůstává
    const [x2, y2] = projectPoint(ix, [10, 15, 20]);
    expect(pickAt(ix, x2, y2, "face")).toMatchObject({ kind: "face", index: 1 });
    // pohled zprava (od +X) na plochu řezu: vnitřek tělesa = plocha řezu → nic k výběru
    const ixR = buildPickIndex([B], { width: W, height: H, camera: cam([B], "right"), clip });
    const [rx, ry] = projectPoint(ixR, [20, 15, 10]);
    const s = surfaceAt(ixR, rx, ry);
    expect(s?.cap).toBe(true);
    expect(s!.z).toBeCloseTo(projectPoint(ixR, [20, 15, 10])[2], 3);
    expect(pickAt(ixR, rx, ry, "face")).toBeNull();
  });

  it("sestava: komponenta s maticí – id komponenty a bod ve světě", () => {
    const a = box([0, 0, 0], [40, 30, 20], { compId: "a", topId: "a" });
    // druhý kus posunutý o 80 mm v X a otočený o 90° kolem Z (matice po sloupcích)
    const m = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 80, 0, 0, 1];
    const b = box([0, 0, 0], [40, 30, 20], { compId: "s/b", topId: "s", matrix: m });
    const items = [a, b];
    const ix = buildPickIndex(items, { width: W, height: H, camera: cam(items, "top") });
    // horní plocha druhého kusu: lokální střed (20,15,20) → svět (80 − 15, 20, 20)
    const [x, y] = projectPoint(ix, [65, 20, 20]);
    const r = pickAt(ix, x, y, "face");
    expect(r).toMatchObject({ kind: "face", index: 1, compId: "s/b", topId: "s" });
    r!.point.forEach((v, i) => expect(v).toBeCloseTo([65, 20, 20][i], 3));
    expect(pickAt(ix, x, y, "component")).toMatchObject({ kind: "component", compId: "s/b", topId: "s" });
    expect(pickAt(ix, x, y, "subasm")).toMatchObject({ kind: "component", compId: "s", topId: "s" });
    const [ax, ay] = projectPoint(ix, [20, 15, 20]);
    expect(pickAt(ix, ax, ay, "face")).toMatchObject({ kind: "face", index: 1, compId: "a" });
    // hrana druhého kusu: lokální E6 (40,0,20)–(40,30,20) → svět x = 80 − y, y = 40
    const [ex, ey] = projectPoint(ix, [65, 40, 20]);
    expect(pickAt(ix, ex, ey + 2, "edge")).toMatchObject({ kind: "edge", index: 5, compId: "s/b" });
  });

  it("uchopení bodů na hraně: začátek, konec, střed; střed kružnice", () => {
    const ix = ixIso();
    const s = edgeSnaps(ix, 4);
    expect(s.map((x) => x.at)).toEqual(["start", "end", "mid"]);
    expect(s[2].point).toEqual([20, 0, 20]);
    const [x, y] = projectPoint(ix, [20, 0, 20]);
    expect(snapNear(ix, s, x + 5, y)?.at).toBe("mid");
    expect(snapNear(ix, s, x + 40, y)).toBeNull();
    const ring: Vec3[] = [];
    for (let i = 0; i <= 24; i++) ring.push([10 + 5 * Math.cos((i / 24) * 2 * Math.PI), 7 + 5 * Math.sin((i / 24) * 2 * Math.PI), 3]);
    const c = circleOf(ring)!;
    expect(c.r).toBeCloseTo(5, 4);
    c.c.forEach((v, i) => expect(v).toBeCloseTo([10, 7, 3][i], 4));
    expect(circleOf([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]])).toBeNull();
  });
});

describe("soft-pick – popisky a rychlost", () => {
  it("popisky: každý leží v místě, kde klik vybere právě svou entitu", () => {
    const ix = ixIso();
    const hints = softHints(ix);
    const faces = hints.filter((h) => h.kind === "face").map((h) => h.id).sort();
    expect(faces).toEqual(["F2", "F3", "F6"]);
    const edges = hints.filter((h) => h.kind === "edge").map((h) => h.id);
    expect(edges.length).toBe(9); // 12 hran bez tří zakrytých (E3, E4, E12)
    expect(edges).not.toContain("E3");
    expect(edges).not.toContain("E12");
    expect(hints.filter((h) => h.kind === "vertex").length).toBe(7); // 8 rohů bez zakrytého V4
    for (const h of hints) {
      const r = pickAt(ix, h.x, h.y, "all");
      expect(r?.kind, h.id).toBe(h.kind);
      expect((r as { index: number }).index, h.id).toBe(h.index);
    }
    expect(hints.find((h) => h.id === "F2")!.title).toMatch(/Plocha 2 · rovinná · normála \+Z/);
  });

  it("velká síť: index jednou na snímek, dotazy pod kurzorem rychle a správně", () => {
    // koule r = 50 z 2·400·399 ≈ 320 tisíc trojúhelníků
    const rings = 400, seg = 400, r0 = 50;
    const v = new Float32Array((rings + 1) * (seg + 1) * 3);
    let k = 0;
    for (let i = 0; i <= rings; i++) {
      const th = (i / rings) * Math.PI;
      for (let j = 0; j <= seg; j++) {
        const ph = (j / seg) * 2 * Math.PI;
        v[k++] = r0 * Math.sin(th) * Math.cos(ph);
        v[k++] = r0 * Math.sin(th) * Math.sin(ph);
        v[k++] = r0 * Math.cos(th);
      }
    }
    const t: number[] = [];
    for (let i = 0; i < rings; i++)
      for (let j = 0; j < seg; j++) {
        const a = i * (seg + 1) + j, b = a + seg + 1;
        if (i > 0) t.push(a, b, a + 1);
        if (i < rings - 1) t.push(a + 1, b, b + 1);
      }
    const ball: PickItem = { vertices: v, triangles: new Uint32Array(t), faceGroups: new Int32Array([0, t.length, 0]), color: [200, 200, 200] };
    const ix = buildPickIndex([ball], { width: 1200, height: 900, camera: fitCamera([ball], basisOf(VIEW_ANGLES.iso), 1200, 900, 0.8) });
    expect(ix.ms).toBeLessThan(3000);
    const t0 = performance.now();
    let hitsOk = 0;
    for (let q = 0; q < 2000; q++) {
      const x = 600 + 300 * Math.cos(q), y = 450 + 300 * Math.sin(q * 1.3);
      const r = pickAt(ix, x, y, "face");
      if (r && Math.abs(Math.hypot(...r.point) - r0) < 0.05) hitsOk++;
    }
    const per = (performance.now() - t0) / 2000;
    expect(hitsOk).toBeGreaterThan(1500);
    // dotaz prochází jen svou buňku mřížky, ne všech 320 tisíc trojúhelníků
    expect(per).toBeLessThan(2);
  });
});

/** klik v okolí popisku: celé pixely po zaokrouhlení s neceločíselnou polohou plátna a posun o 1 px */
function clickAround(ix: SoftPickIndex, h: { x: number; y: number }): { dx: number; dy: number; r: ReturnType<typeof pickAt> }[] {
  const out: { dx: number; dy: number; r: ReturnType<typeof pickAt> }[] = [];
  for (const off of [-0.49, -0.3, 0, 0.3, 0.49]) {
    // poloha plátna na stránce s neceločíselným posunem; klient klikne na celý pixel stránky
    const page = (v: number) => Math.round(v + 270 + off) - 270 - off;
    out.push({ dx: off, dy: off, r: pickAt(ix, page(h.x), page(h.y), "all") });
  }
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]]) out.push({ dx, dy, r: pickAt(ix, h.x + dx, h.y + dy, "all") });
  return out;
}
const sameEntity = (r: ReturnType<typeof pickAt>, h: { kind: string; index: number }) => !!r && r.kind === h.kind && (r as { index: number }).index === h.index;

describe("soft-pick – popisky pro skutečný klik (oprava po kontrole)", () => {
  it("popisky mají celočíselné souřadnice a klik zaokrouhlený na pixel i o 1 px vedle (osy) vybere tutéž entitu (všechny pohledy)", () => {
    for (const v of ["iso", "front", "top", "right", "back", "left", "bottom"] as SoftViewName[]) {
      const ix = buildPickIndex([B], { width: W, height: H, camera: cam([B], v) });
      const hints = softHints(ix);
      expect(hints.length, v).toBeGreaterThan(4);
      for (const h of hints) {
        expect(Number.isInteger(h.x) && Number.isInteger(h.y), `${v} ${h.id}`).toBe(true);
        for (const c of clickAround(ix, h)) expect(sameEntity(c.r, h), `${v} ${h.id} posun ${c.dx},${c.dy} → ${JSON.stringify(c.r && { kind: c.r.kind, index: (c.r as { index?: number }).index })}`).toBe(true);
      }
    }
  });

  it("řez: popisky hran rozříznutých rovinou neleží na hranici řezu – klik celým pixelem je vybere", () => {
    // řez Z 10 (zachová se z ≤ 10): svislé hrany E9–E12 končí v rovině řezu, jejich střed leží přesně na ní
    const clip = { normal: [0, 0, -1] as Vec3, constant: 10 };
    for (const v of ["iso", "front", "right"] as SoftViewName[]) {
      const ix = buildPickIndex([B], { width: W, height: H, camera: cam([B], v), clip });
      const hints = softHints(ix);
      const vert = hints.filter((h) => h.kind === "edge" && h.index >= 8);
      expect(vert.length, v).toBeGreaterThan(0);
      for (const h of hints) {
        // popisek leží na zachované straně řezu (ne přesně v rovině)
        if (h.kind !== "face") expect(h.p[2], `${v} ${h.id}`).toBeLessThan(10 - 1e-3);
        for (const c of clickAround(ix, h)) expect(sameEntity(c.r, h), `${v} ${h.id} posun ${c.dx},${c.dy}`).toBe(true);
      }
    }
  });

  it("řez: obrysové hrany na hranici přivrácené a odvrácené stěny (spodní hrany) nejsou „zakryté“ plochou řezu", () => {
    // s řezem se odvrácené stěny nevynechávají (pohled do řezu); spodní stěna sdílí spodní hrany s přední / pravou
    // stěnou ve stejné hloubce – nesmí vyhrát jako „plocha řezu“ (hrana by vypadala zakrytá a neměla popisek)
    const clip = { normal: [0, 0, -1] as Vec3, constant: 10 };
    const ix = buildPickIndex([B], { width: W, height: H, camera: cam([B]), clip });
    const ids = softHints(ix).map((h) => h.id);
    for (const id of ["E1", "E2", "E9", "E10", "E11", "F3", "F6"]) expect(ids, id).toContain(id);
    // klik 1 px vedle spodní přední hrany (vně i uvnitř obrysu) vybere hranu
    const [mx, my] = projectPoint(ix, [20, 0, 0]);
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) expect(pickAt(ix, mx + dx, my + dy, "all"), `${dx},${dy}`).toMatchObject({ kind: "edge", index: 0 });
    // plocha těsně nad spodní hranou je přední plocha, ne plocha řezu
    const s = surfaceAt(ix, mx, my - 3);
    expect(s).toMatchObject({ face: 2, cap: false });
  });

  it("zakryté místo plátna (upozornění, panel): popisek se položí jinam nebo vynechá, nikdy pod zakrytí", () => {
    const ix = ixIso();
    const free = softHints(ix);
    const f3 = free.find((h) => h.id === "F3")!;
    // obdélník kolem popisku F3 a jeho okolí (jako upozornění náhledu dole vlevo)
    const rect = { x0: f3.x - 30, y0: f3.y - 12, x1: f3.x + 30, y1: f3.y + 12 };
    const under = (x: number, y: number) => x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
    const calls: [number, number][] = [];
    const hints = softHints(ix, { blocked: (x, y) => (calls.push([x, y]), under(x, y)) });
    expect(calls.length).toBeGreaterThan(0);
    for (const h of hints) {
      expect(under(h.x, h.y), h.id).toBe(false);
      for (const c of clickAround(ix, h)) expect(sameEntity(c.r, h), `${h.id} posun ${c.dx},${c.dy}`).toBe(true);
    }
    // F3 dostal jiné místo (jiný kandidátní trojúhelník plochy) mimo zakrytí
    const moved = hints.find((h) => h.id === "F3");
    expect(moved).toBeDefined();
    expect(moved!.x !== f3.x || moved!.y !== f3.y).toBe(true);
    // celé plátno zakryté → žádný popisek
    expect(softHints(ix, { blocked: () => true })).toEqual([]);
  });

  it("popisky po dávkách (generátor) dají totéž jako najednou", () => {
    const ix = ixIso();
    const g = softHintSteps(ix);
    let steps = 0;
    let r = g.next();
    while (!r.done) {
      steps++;
      r = g.next();
    }
    expect(steps).toBeGreaterThan(5);
    expect(r.value.map((h) => [h.id, h.x, h.y])).toEqual(softHints(ix).map((h) => [h.id, h.x, h.y]));
  });
});

describe("soft-pick – velké sítě s dlouhými úzkými trojúhelníky (oprava po kontrole)", () => {
  /** rovinná plocha z dlouhých šikmých úzkých trojúhelníků (jako triangulace desky s mnoha dírami) + body */
  function slivers(n: number): PickItem {
    const v: number[] = [];
    const t: number[] = [];
    for (let i = 0; i < n; i++) {
      const y = (i / n) * 100;
      v.push(0, y, 0, 200, y + 60, 0, 200, y + 60.4, 0);
      t.push(3 * i, 3 * i + 1, 3 * i + 2);
    }
    const pts: number[] = [];
    for (let i = 0; i < 4000; i++) pts.push((i % 80) * 2.5, Math.floor(i / 80) * 3.2, 0);
    return { vertices: new Float32Array(v), triangles: new Uint32Array(t), faceGroups: new Int32Array([0, t.length, 0]), points: new Float32Array(pts), color: [200, 200, 200] };
  }
  const brute = (ix: SoftPickIndex, it: PickItem, x: number, y: number) => {
    // nejbližší trojúhelník pod bodem hrubou silou (pohled shora: všechny v z = 0 → první zasažený)
    const p = ix.items[0];
    let hit = -1;
    for (let k = 0; k * 3 + 2 < it.triangles.length; k++) {
      const a = it.triangles[3 * k], b = it.triangles[3 * k + 1], c = it.triangles[3 * k + 2];
      const x0 = p.sx[a], y0 = p.sy[a], x1 = p.sx[b], y1 = p.sy[b], x2 = p.sx[c], y2 = p.sy[c];
      const A = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      const sg = A > 0 ? 1 : -1;
      const e0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) * sg, e1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) * sg, e2 = ((x0 - x) * (y1 - y) - (x1 - x) * (y0 - y)) * sg;
      if (e0 >= 0 && e1 >= 0 && e2 >= 0) {
        hit = k;
        break;
      }
    }
    return hit;
  };

  it("trojúhelník patří jen do buněk, které protíná – ne do celého ohraničení; dotazy zůstanou správné", () => {
    const it0 = slivers(3000);
    const ix = buildPickIndex([it0], { width: 1400, height: 850, camera: fitCamera([it0], basisOf(VIEW_ANGLES.top), 1400, 850, 0.8) });
    // šikmý úzký trojúhelník protne nejvýš ~ (gw + gh) buněk; ohraničení by jich mělo stovky
    expect(ix.triIds.length).toBeLessThan(3000 * (ix.gw + ix.gh) * 1.2);
    let bboxCells = 0;
    const p = ix.items[0];
    for (let k = 0; k < 3000; k++) {
      const xs = [p.sx[3 * k], p.sx[3 * k + 1], p.sx[3 * k + 2]], ys = [p.sy[3 * k], p.sy[3 * k + 1], p.sy[3 * k + 2]];
      bboxCells += (Math.floor(Math.max(...xs) / ix.cell) - Math.floor(Math.min(...xs) / ix.cell) + 1) * (Math.floor(Math.max(...ys) / ix.cell) - Math.floor(Math.min(...ys) / ix.cell) + 1);
    }
    expect(ix.triIds.length).toBeLessThan(bboxCells / 4);
    // žádný trojúhelník se neztratí: totéž co hrubá síla na 1500 bodech
    let agree = 0, hits = 0;
    for (let q = 0; q < 1500; q++) {
      const x = 100 + ((q * 7919) % 1200) + 0.37, y = 60 + ((q * 104729) % 730) + 0.61;
      const b = brute(ix, it0, x, y);
      const s = surfaceAt(ix, x, y);
      if (b >= 0) hits++;
      if ((b < 0 && !s) || (b >= 0 && !!s)) agree++;
    }
    expect(hits).toBeGreaterThan(200);
    expect(agree).toBe(1500);
  });

  it("vrcholy v mřížce: nejbližší vrchol stejně jako hrubou silou, dotaz neprochází všechny vrcholy", () => {
    const it0 = slivers(200);
    const ix = buildPickIndex([it0], { width: 1400, height: 850, camera: fitCamera([it0], basisOf(VIEW_ANGLES.top), 1400, 850, 0.8) });
    const p = ix.items[0];
    for (let q = 0; q < 400; q++) {
      const x = 200 + ((q * 7919) % 1000) + 0.3, y = 100 + ((q * 104729) % 600) + 0.7;
      let best = -1, bd = Infinity;
      for (let i = 0; i < p.px.length; i++) {
        const d = Math.hypot(p.px[i] - x, p.py[i] - y);
        if (d <= 7 && d < bd) {
          bd = d;
          best = i;
        }
      }
      const r = vertexNear(ix, x, y);
      expect(r ? r.index : -1, `${x},${y}`).toBe(best);
    }
    // body jsou v buňkách mřížky (každý v jedné)
    expect(ix.ptIds.length).toBe(p.px.length);
  });
});
