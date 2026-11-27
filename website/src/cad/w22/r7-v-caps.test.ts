/**
 * Vlna 22, kolo 7 – stopa V, čela řezu v sestavě (CAD-M1-OPRAVY.md, „Co zbývá“): „Softwarový náhled nemá průhlednost.
 * Obrys čela se nekreslí. Šrafy jsou v pixelech obrazovky.“
 *
 * Repro (před opravou, 260ff8b): softwarový náhled kreslil tlumenou komponentu jen v hranách (alfa 0 v ploše tělesa i čela),
 * styl Průhledný neprůhledně (komponenta za jinou nebyla vidět), čelo nemělo obrys a šrafy byly dané pixely obrazovky – posun
 * pohledu, přiblížení ani pohyb komponenty šrafy neposunuly („plavaly“ vůči modelu). Tyto testy na starém kódu padají.
 */
import { describe, expect, it } from "vitest";
import { capHatchModule, capModule, capStyles, hatchWorld, softCapStyles, type CapInput } from "../section-cap";
import { cachedContour, contourLength, localPlane, sectionContour } from "../section-contour";
import { basisOf, fitCamera, softRender, VIEW_ANGLES, type RGB, type SoftCamera, type SoftItem } from "../soft-render";
import { SOFT_LIMITS } from "../soft-view";
import type { Vec3 } from "../types";

function box(min: Vec3, max: Vec3, color: RGB): SoftItem {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const faces: [Vec3, Vec3, Vec3, Vec3][] = [
    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]],
    [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]],
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
  ];
  const v: number[] = [];
  const t: number[] = [];
  faces.forEach((f, i) => {
    for (const p of f) v.push(...p);
    t.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  return { vertices: new Float32Array(v), triangles: new Uint32Array(t), color };
}
const W = 400;
const H = 300;
const hexRgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const px = (d: Uint8ClampedArray, x: number, y: number): RGB => [d[(y * W + x) * 4], d[(y * W + x) * 4 + 1], d[(y * W + x) * 4 + 2]];
const same = (a: RGB, b: RGB, tol = 2) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
const translate = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

/** komponenty jako je staví viewport-soft.tsx (sceneItems): šrafy v mm, obrys, průhlednost těla i čela */
function items(comps: (CapInput & { min: Vec3; max: Vec3; matrix?: number[] })[], display: "shadedEdges" | "xray" = "shadedEdges", module = 0.25): SoftItem[] {
  const st = softCapStyles(comps, display, module);
  return comps.map((c, i) => {
    const s = st[i];
    const op = c.dim ? 0.18 : display === "xray" ? 0.3 : 1;
    return {
      ...box(c.min, c.max, hexRgb(c.color)),
      matrix: c.matrix ?? null,
      opacity: op < 1 ? op : null,
      capColor: s ? s.fill : null,
      capHatch: s ? { angle: s.hatch.angle, stepMm: s.hatch.stepMm, width: s.hatch.width, color: s.hatch.color } : null,
      capOutline: s ? s.outline : null,
    };
  });
}
const A = { id: "deska-a", color: "#b9c2cc", min: [0, 0, 0] as Vec3, max: [40, 30, 20] as Vec3 };
const B = { id: "deska-b", color: "#4678c8", min: [40, 0, 0] as Vec3, max: [80, 30, 20] as Vec3 };
const clip = { normal: [0, 1, 0] as Vec3, constant: -15 };
const styleA = softCapStyles([A, B], "shadedEdges", 0.25)[0]!;
/** pixely čela A v okně (výplň / šrafa) – mapa „je šrafa“ v obdélníku */
function hatchMap(d: Uint8ClampedArray, x0: number, y0: number, w: number, h: number): boolean[] {
  const out: boolean[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push(same(px(d, x, y), styleA.hatch.color));
  return out;
}
const toScreen = (c: SoftCamera, p: Vec3): [number, number] => {
  const d = [p[0] - c.center[0], p[1] - c.center[1], p[2] - c.center[2]];
  return [Math.floor(W / 2 + c.scale * (c.right[0] * d[0] + c.right[1] * d[1] + c.right[2] * d[2])), Math.floor(H / 2 - c.scale * (c.up[0] * d[0] + c.up[1] * d[1] + c.up[2] * d[2]))];
};

describe("kolo 7 – šrafy čela vázané na model (softwarový náhled)", () => {
  const its = items([A, B]);
  const cam = fitCamera(its, basisOf(VIEW_ANGLES.front), W, H);

  it("posun pohledu o 7 px posune šrafy o 7 px (dřív stály v pixelech obrazovky)", () => {
    const r0 = softRender({ width: W, height: H, items: its, camera: cam, clip, edges: false });
    const m0 = hatchMap(r0.data, 150, 120, 30, 30);
    expect(m0.filter(Boolean).length).toBeGreaterThan(20); // šrafy na čele vůbec jsou
    // kamera o 7 px doleva = model o 7 px doprava
    const shifted: SoftCamera = { ...cam, center: [cam.center[0] - 7 / cam.scale, cam.center[1], cam.center[2]] };
    const r1 = softRender({ width: W, height: H, items: its, camera: shifted, clip, edges: false });
    const m1 = hatchMap(r1.data, 157, 120, 30, 30);
    let diff = 0;
    for (let i = 0; i < m0.length; i++) if (m0[i] !== m1[i]) diff++;
    expect(diff).toBeLessThanOrEqual(6); // jen zaokrouhlení na hranách čar
  });

  it("přiblížení 2× = dvojnásobná rozteč šraf v pixelech (rozteč je v mm, ne v pixelech)", () => {
    const count = (c: SoftCamera) => {
      const r = softRender({ width: W, height: H, items: its, camera: c, clip, edges: false });
      const [cx, cy] = toScreen(c, [20, 15, 10]);
      let runs = 0;
      let prev = false;
      for (let x = cx - 60; x < cx + 60; x++) {
        const on = same(px(r.data, x, cy), styleA.hatch.color);
        if (on && !prev) runs++;
        prev = on;
      }
      return runs;
    };
    const n1 = count(cam);
    const n2 = count({ ...cam, scale: cam.scale * 2, center: [20, cam.center[1], 10] });
    expect(n1).toBeGreaterThanOrEqual(4);
    expect(Math.abs(n2 * 2 - n1)).toBeLessThanOrEqual(2);
  });

  it("šrafy se hýbou s komponentou (přehrávání studie, gizmo): posun komponenty o 5 mm = posun šraf o 5 mm", () => {
    const base = items([A]);
    const c = fitCamera(base, basisOf(VIEW_ANGLES.front), W, H);
    const moved = items([{ ...A, matrix: translate(5, 0, 0) }]);
    const r0 = softRender({ width: W, height: H, items: base, camera: c, clip, edges: false });
    const r1 = softRender({ width: W, height: H, items: moved, camera: c, clip, edges: false });
    const dx = Math.round(5 * c.scale);
    const [cx, cy] = toScreen(c, [15, 15, 10]);
    const m0 = hatchMap(r0.data, cx, cy - 10, 20, 20);
    const m1 = hatchMap(r1.data, cx + dx, cy - 10, 20, 20);
    expect(m0.filter(Boolean).length).toBeGreaterThan(10);
    let diff = 0;
    for (let i = 0; i < m0.length; i++) if (m0[i] !== m1[i]) diff++;
    expect(diff).toBeLessThanOrEqual(8);
  });

  it("tloušťka čáry zůstává v pixelech při každém přiblížení (čára je vidět i při oddálení)", () => {
    const far: SoftCamera = { ...cam, scale: cam.scale / 3 };
    const r = softRender({ width: W, height: H, items: its, camera: far, clip, edges: false });
    const [cx, cy] = toScreen(far, [20, 15, 10]);
    let hatch = 0;
    for (let y = cy - 8; y <= cy + 8; y++) for (let x = cx - 8; x <= cx + 8; x++) if (same(px(r.data, x, y), styleA.hatch.color)) hatch++;
    expect(hatch).toBeGreaterThan(5);
  });
});

describe("kolo 7 – obrys čela (průsečnice roviny řezu se sítí)", () => {
  it("kvádr 40 × 30 × 20 řezaný rovinou y = 15: uzavřený obrys délky 2 × (40 + 20) v rovině řezu", () => {
    const b = box([0, 0, 0], [40, 30, 20], [0, 0, 0]);
    const seg = sectionContour(b.vertices, b.triangles, { normal: [0, 1, 0], constant: -15 });
    expect(contourLength(seg)).toBeCloseTo(120, 6);
    for (let j = 1; j < seg.length; j += 3) expect(seg[j]).toBeCloseTo(15, 6);
    // posun do odebrané strany (záporný = proti normále)
    const off = sectionContour(b.vertices, b.triangles, { normal: [0, 1, 0], constant: -15 }, -0.01);
    for (let j = 1; j < off.length; j += 3) expect(off[j]).toBeCloseTo(14.99, 5);
    // rovina mimo těleso: žádný obrys
    expect(sectionContour(b.vertices, b.triangles, { normal: [0, 1, 0], constant: -50 }).length).toBe(0);
  });

  it("rovina ve světě → místní souřadnice komponenty s maticí (komponenta posunutá o 10 v Y)", () => {
    const pl = localPlane(translate(0, 10, 0), [0, 1, 0], -15);
    expect(pl.normal).toEqual([0, 1, 0]);
    expect(pl.constant).toBe(-5); // svět y = 15 ↔ místní y = 5
    const b = box([0, 0, 0], [40, 30, 20], [0, 0, 0]);
    const seg = cachedContour(b.vertices, b.triangles, pl);
    for (let j = 1; j < seg.length; j += 3) expect(seg[j]).toBeCloseTo(5, 6);
    // mezipaměť: táž rovina = tentýž výsledek, jiná rovina = nový výpočet
    expect(cachedContour(b.vertices, b.triangles, pl)).toBe(seg);
    expect(cachedContour(b.vertices, b.triangles, { ...pl, constant: -6 })).not.toBe(seg);
  });

  it("softwarový náhled kreslí obrys čela barvou obrysu na hranici čela, uvnitř čela ne (i bez hran)", () => {
    const its = items([A]);
    const cam = fitCamera(its, basisOf(VIEW_ANGLES.front), W, H);
    const r = softRender({ width: W, height: H, items: its, camera: cam, clip, edges: false });
    const [lx, cy] = toScreen(cam, [0, 15, 10]);
    const [, ty] = toScreen(cam, [20, 15, 20]);
    const near = (x0: number, y0: number) => {
      for (let y = y0 - 1; y <= y0 + 1; y++) for (let x = x0 - 1; x <= x0 + 1; x++) if (same(px(r.data, x, y), styleA.outline, 3)) return true;
      return false;
    };
    expect(near(lx, cy)).toBe(true); // levá hrana čela
    expect(near(toScreen(cam, [20, 15, 10])[0], ty)).toBe(true); // horní hrana čela
    // uvnitř čela obrys není
    const [cx, cy2] = toScreen(cam, [20, 15, 10]);
    let inner = 0;
    for (let y = cy2 - 10; y <= cy2 + 10; y++) for (let x = cx - 10; x <= cx + 10; x++) if (same(px(r.data, x, y), styleA.outline, 3)) inner++;
    expect(inner).toBe(0);
    // bez řezu žádný obrys
    const r0 = softRender({ width: W, height: H, items: its, camera: cam, edges: false });
    let any = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (same(px(r0.data, x, y), styleA.outline, 3)) any++;
    expect(any).toBe(0);
  });
});

describe("kolo 7 – průhlednost v softwarovém náhledu (tlumená komponenta, styl Průhledný)", () => {
  it("tlumená komponenta: průhledné těleso i čelo nad pozadím (dřív alfa 0 – jen hrany)", () => {
    const its = items([A, { ...B, dim: true }]);
    const cam = fitCamera(its, basisOf(VIEW_ANGLES.front), W, H);
    const r = softRender({ width: W, height: H, items: its, camera: cam, clip, edges: false });
    const [bx, by] = toScreen(cam, [60, 15, 10]);
    const a = r.data[(by * W + bx) * 4 + 3];
    expect(a).toBeGreaterThan(30); // čelo B (průhledné)
    expect(a).toBeLessThan(120);
    // bez řezu: průhledné těleso B
    const r0 = softRender({ width: W, height: H, items: its, camera: cam, edges: false });
    expect(r0.data[(by * W + bx) * 4 + 3]).toBeGreaterThan(30);
    expect(r0.data[(by * W + bx) * 4 + 3]).toBeLessThan(120);
  });

  it("styl Průhledný: komponenta za jinou prosvítá (barva je směs obou, dřív jen přední)", () => {
    // A za B při pohledu zepředu (B blíž ke kameře, −Y)
    const front = { ...B, id: "front", min: [0, -40, 0] as Vec3, max: [40, -10, 20] as Vec3 };
    const opaque = items([A, front]);
    const cam = fitCamera(opaque, basisOf(VIEW_ANGLES.front), W, H);
    const [x, y] = toScreen(cam, [20, 0, 10]);
    const ro = softRender({ width: W, height: H, items: opaque, camera: cam, edges: false, background: [255, 255, 255] });
    const rx = softRender({ width: W, height: H, items: items([A, front], "xray"), camera: cam, edges: false, background: [255, 255, 255] });
    const rAlone = softRender({ width: W, height: H, items: items([{ ...front }], "xray"), camera: cam, edges: false, background: [255, 255, 255] });
    // neprůhledně: jen přední (modrá) komponenta; průhledně: jiný odstín než samotná přední komponenta (A za ní prosvítá)
    expect(same(px(rx.data, x, y), px(ro.data, x, y), 4)).toBe(false);
    expect(same(px(rx.data, x, y), px(rAlone.data, x, y), 4)).toBe(false);
    expect(rx.data[(y * W + x) * 4 + 3]).toBe(255);
  });

  it("průhledná plocha nezapisuje hloubku – hloubka pod ní je hloubka neprůhledné komponenty za ní", () => {
    const front = { ...B, id: "front", min: [0, -40, 0] as Vec3, max: [40, -10, 20] as Vec3, dim: true };
    const its = items([A, front]);
    const cam = fitCamera(its, basisOf(VIEW_ANGLES.front), W, H);
    const [x, y] = toScreen(cam, [20, 0, 10]);
    const r = softRender({ width: W, height: H, items: its, camera: cam, edges: false });
    const want = cam.dir[0] * (20 - cam.center[0]) + cam.dir[1] * (0 - cam.center[1]) + cam.dir[2] * (10 - cam.center[2]);
    expect(r.depth[y * W + x]).toBeCloseTo(want, 3); // přední stěna A (y = 0), ne tlumená komponenta před ní
  });

  /**
   * Oprava po oponentovi kola 7: průhledná komponenta barvila čelem a šrafami celou siluetu v šikmém pohledu (každá
   * odvrácená stěna dostala hloubku roviny řezu, kde rovina ležela před ní – i mimo plochu řezu). Kvádr řezaný y = 15,
   * izometrie, dvě barvy čela: pixely závislé na barvě čela musí být jen plocha řezu – stejně jako u neprůhledné komponenty.
   */
  it("průhledná komponenta v izometrii: čelo jen na ploše řezu, ne přes celou siluetu (nález oponenta)", () => {
    const mk = (cap: RGB, op: number | null): SoftItem[] => [{ ...box([0, 0, 0], [40, 30, 20], [120, 120, 120]), capColor: cap, capHatch: null, opacity: op }];
    const cam = fitCamera(mk([255, 0, 0], null), basisOf(VIEW_ANGLES.iso), W, H);
    const capPixels = (op: number | null) => {
      const a = softRender({ width: W, height: H, items: mk([255, 0, 0], op), camera: cam, clip, edges: false, background: [255, 255, 255] });
      const b = softRender({ width: W, height: H, items: mk([0, 0, 255], op), camera: cam, clip, edges: false, background: [255, 255, 255] });
      let diff = 0;
      for (let i = 0; i < W * H; i++) if (Math.abs(a.data[i * 4] - b.data[i * 4]) > 3 || Math.abs(a.data[i * 4 + 2] - b.data[i * 4 + 2]) > 3) diff++;
      return { diff, a, b };
    };
    const opaque = capPixels(null);
    const trans = capPixels(0.3);
    expect(opaque.diff).toBeGreaterThan(5000); // plocha řezu je v obraze
    // průhledné čelo zabírá tutéž plochu (±2 % na hranách), dřív skoro dvojnásobek (celá silueta)
    expect(Math.abs(trans.diff - opaque.diff)).toBeLessThan(opaque.diff * 0.02);
    // bod horní stěny zachované části (z = 20, y = 25): paprsek protne rovinu y = 15 mimo těleso → žádná barva čela
    const [tx, ty] = toScreen(cam, [20, 25, 20]);
    expect(same(px(trans.a.data, tx, ty), px(trans.b.data, tx, ty), 1)).toBe(true);
    // bod plochy řezu: barva čela se prolne (červená × modrá se liší)
    const [cx, cy] = toScreen(cam, [20, 15, 10]);
    expect(same(px(trans.a.data, cx, cy), px(trans.b.data, cx, cy), 20)).toBe(false);
  });

  it("dvě průhledné komponenty v izometrii: čela obou jen na jejich plochách řezu (žádné čelo přes cizí siluetu)", () => {
    const mk = (cap: RGB): SoftItem[] => [
      { ...box([0, 0, 0], [40, 30, 20], [120, 120, 120]), capColor: cap, capHatch: null, opacity: 0.3 },
      { ...box([50, 0, 0], [90, 30, 20], [120, 120, 120]), capColor: cap, capHatch: null, opacity: 0.18 },
    ];
    const opq = (cap: RGB): SoftItem[] => mk(cap).map((i) => ({ ...i, opacity: null }));
    const cam = fitCamera(mk([255, 0, 0]), basisOf(VIEW_ANGLES.iso), W, H);
    const diff = (f: (c: RGB) => SoftItem[]) => {
      const a = softRender({ width: W, height: H, items: f([255, 0, 0]), camera: cam, clip, edges: false, background: [255, 255, 255] });
      const b = softRender({ width: W, height: H, items: f([0, 0, 255]), camera: cam, clip, edges: false, background: [255, 255, 255] });
      const m = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) if (Math.abs(a.data[i * 4] - b.data[i * 4]) > 3 || Math.abs(a.data[i * 4 + 2] - b.data[i * 4 + 2]) > 3) m[i] = 1;
      return m;
    };
    const mt = diff(mk);
    const mo = diff(opq);
    let extra = 0, total = 0;
    for (let i = 0; i < W * H; i++) {
      total += mo[i];
      if (mt[i] && !mo[i]) extra++;
    }
    expect(total).toBeGreaterThan(5000);
    // průhledná čela leží uvnitř ploch řezu neprůhledných (rozdíl jen na hraně čela)
    expect(extra).toBeLessThan(total * 0.02);
  });

  it("seznam omezení softwarového náhledu už neuvádí průhlednost tělesa", () => {
    expect(SOFT_LIMITS.map((l) => l.key)).not.toContain("bodyOpacity");
  });
});

describe("kolo 7 – modul šraf a shoda 3D okna se softwarovým náhledem", () => {
  it("modul z rozměru scény po řadě 1–2–5; tatáž sestava si modul pamatuje (přehrávání nemění rozteč skokem)", () => {
    expect(capHatchModule(70)).toBe(0.1);
    expect(capHatchModule(700)).toBe(1);
    expect(capHatchModule(1200)).toBe(2);
    expect(capHatchModule(0)).toBe(0.5);
    const mk = (z: number) => [
      { id: "a", key: "ka", mesh: { vertices: box([0, 0, 0], [40, 30, 20], [0, 0, 0]).vertices }, matrix: translate(0, 0, 0) },
      { id: "b", key: "kb", mesh: { vertices: box([0, 0, 0], [40, 30, 20], [0, 0, 0]).vertices }, matrix: translate(0, 0, z) },
    ];
    const m0 = capModule(mk(30));
    expect(m0).toBe(capHatchModule(50));
    // táž sestava (komponenty, sítě) v jiné poloze studie: modul se nezmění
    expect(capModule(mk(300))).toBe(m0);
  });

  it("3D okno i softwarový náhled berou styl čela z capStyles se stejným modulem (rozteč v mm)", () => {
    const list = [{ id: "a", color: "#b9c2cc" }, { id: "b", color: "#4678c8" }];
    const gl = capStyles(list, "shadedEdges", 0.5);
    const soft = softCapStyles(list, "shadedEdges", 0.5);
    expect(gl.map((s) => s!.hatch.stepMm)).toEqual(soft.map((s) => s!.hatch.stepMm));
    expect(gl[0]!.hatch.stepMm).toBe(gl[0]!.hatch.step * 0.5);
    expect(gl[0]!.outlineHex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("šrafy komponenty v místních souřadnicích nezávisí na poloze komponenty (hatchWorld)", () => {
    const p: Vec3 = [3, 15, 7]; // bod čela v místních souřadnicích
    const h0 = hatchWorld(null, [0, 1, 0], 45, 2);
    const h1 = hatchWorld(translate(12, 0, -4), [0, 1, 0], 45, 2);
    const v0 = h0.g[0] * p[0] + h0.g[1] * p[1] + h0.g[2] * p[2] + h0.g0;
    const v1 = h1.g[0] * (p[0] + 12) + h1.g[1] * p[1] + h1.g[2] * (p[2] - 4) + h1.g0;
    expect(v1).toBeCloseTo(v0, 9);
    // otočená komponenta (90° kolem Z): rovina řezu je vůči ní jinak – směr šraf se přepočítá přes místní normálu
    const rot = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const hr = hatchWorld(rot, [0, 1, 0], 45, 2);
    expect(Math.hypot(...hr.g)).toBeCloseTo(0.5, 9);
    expect(hr.g[1]).toBeCloseTo(0, 9);
  });
});
