/**
 * Vlna 22 – zpráva majitele 20. 11.: „v sestavě, když dám řez ručně, nevidím čela samotných těles, jen povrchy“.
 * Repro (před opravou): softwarový náhled kreslil čela všech komponent jednou barvou řezu (232, 112, 106) – sousední tělesa
 * splynula – a 3D okno (WebGL) u sestavy čelo vůbec nekreslilo. Tento test drží rozhodnutí o čele (viditelnost, barva, šrafy,
 * průhlednost) a obraz softwarového náhledu dvou kvádrů v řezu.
 */
import { describe, expect, it } from "vitest";
import { assignCapPatterns, bodyOpacity, CAP_PATTERNS, capStyle, capStyles, capSummary, CLASH_HEX, onHatch, parseHex, softCapStyles, type CapInput } from "./section-cap";
import { basisOf, fitCamera, softRender, VIEW_ANGLES, type RGB, type SoftCamera, type SoftItem } from "./soft-render";
import type { Vec3 } from "./types";

const lum = (c: RGB) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const near = (a: ArrayLike<number>, b: ArrayLike<number>, tol = 2) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
const DEFAULT_CAP: RGB = [232, 112, 106];

describe("čelo řezu komponenty – rozhodnutí (section-cap)", () => {
  const A: CapInput = { id: "a", color: "#b9c2cc" };

  it("drátový model a skořepina bez objemu čelo nemají, ostatní styly ano", () => {
    expect(capStyle(A, "wireframe")).toBeNull();
    expect(capStyle({ ...A, solid: false }, "shadedEdges")).toBeNull();
    for (const d of ["shadedEdges", "shaded", "hiddenLine", "xray", undefined] as const) expect(capStyle(A, d)).not.toBeNull();
    expect(capStyle({ ...A, solid: true }, "shaded")).not.toBeNull();
  });

  it("barva z barvy komponenty: tmavší výplň, ještě tmavší šrafy; jiná barva = jiné čelo", () => {
    const s = capStyle(A, "shadedEdges", 0)!;
    expect(lum(s.fill)).toBeLessThan(lum(parseHex(A.color)));
    expect(lum(s.hatch.color)).toBeLessThan(lum(s.fill));
    expect(s.hex).toMatch(/^#[0-9a-f]{6}$/);
    const b = capStyle({ id: "b", color: "#4678c8" }, "shadedEdges", 0)!;
    expect(b.hex).not.toBe(s.hex);
    // modrá komponenta má modré čelo (modrá složka převládá)
    expect(b.fill[2]).toBeGreaterThan(b.fill[0]);
    expect(s.hex).not.toBe("#e8706a");
  });

  it("kolize: čelo z červené barvy kolize bez ohledu na barvu komponenty", () => {
    const c1 = capStyle({ id: "x", color: "#00ff00", clash: true }, "shaded", 1)!;
    const c2 = capStyle({ id: "x", color: "#0000ff", clash: true }, "shaded", 1)!;
    expect(c1.hex).toBe(c2.hex);
    expect(c1.fill[0]).toBeGreaterThan(c1.fill[1]);
    expect(c1.hex).toBe(capStyle({ id: "x", color: CLASH_HEX }, "shaded", 1)!.hex);
  });

  it("průhlednost čela = průhlednost těla (tlumená 0,18, Průhledný 0,3, vlastní)", () => {
    expect(capStyle(A, "shadedEdges")!.opacity).toBe(1);
    expect(capStyle({ ...A, dim: true }, "shadedEdges")!.opacity).toBe(0.18);
    expect(capStyle(A, "xray")!.opacity).toBe(0.3);
    expect(capStyle({ ...A, opacity: 0.5 }, "shaded")!.opacity).toBe(0.5);
    expect(bodyOpacity({ dim: true }, "xray")).toBe(0.18);
    expect(bodyOpacity({}, "shaded")).toBe(1);
  });

  it("zobrazení „skryté hrany“: bílá výplň a antracitové šrafy jako na výkrese", () => {
    const s = capStyle({ id: "a", color: "#4678c8" }, "hiddenLine")!;
    expect(lum(s.fill)).toBeGreaterThan(240);
    expect(s.hatch.hex).toBe("#272425");
  });

  it("vybraná komponenta: čelo s nádechem červené", () => {
    const s = capStyle(A, "shaded", 2)!;
    const sel = capStyle({ ...A, selected: true }, "shaded", 2)!;
    expect(sel.fill[0] - sel.fill[2]).toBeGreaterThan(s.fill[0] - s.fill[2]);
  });

  it("sousední komponenty dostanou různý vzor šraf (do osmi komponent každá jiný), vzor je stabilní podle id", () => {
    const ids = ["k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8"];
    const m = assignCapPatterns(ids);
    expect(new Set(m.values()).size).toBe(8);
    // úhly čar se liší u každé dvojice
    expect(new Set([...m.values()].map((k) => CAP_PATTERNS[k].angle)).size).toBe(8);
    // první komponenta má vždy svůj vzor nezávisle na ostatních
    expect(assignCapPatterns(["k1"]).get("k1")).toBe(m.get("k1"));
    const st = capStyles(ids.map((id) => ({ id, color: "#b9c2cc" })), "shaded");
    expect(new Set(st.map((s) => `${s!.hatch.angle}/${s!.hex}`)).size).toBe(8);
    // devátá komponenta – vzor se smí opakovat, ale čelo existuje
    expect(capStyles([...ids, "k9"].map((id) => ({ id, color: "#b9c2cc" })), "shaded")[8]).not.toBeNull();
  });

  it("softwarový náhled: tlumená komponenta (jen hrany) bez čela, ostatní neprůhledná", () => {
    const st = softCapStyles([A, { id: "b", color: "#4678c8", dim: true }], "xray");
    expect(st[0]!.opacity).toBe(1);
    expect(st[1]).toBeNull();
  });

  it("šrafy: čára, když (x·nx + y·ny) mod rozteč < tloušťka; měřítko pixelů", () => {
    const h = capStyle(A, "shaded", 0)!.hatch; // 45°, rozteč 8
    expect(h.angle).toBe(45);
    let on = 0;
    for (let x = 0; x < 80; x++) if (onHatch(h, x + 0.5, 0.5)) on++;
    expect(on).toBeGreaterThan(4);
    expect(on).toBeLessThan(40);
    let on2 = 0;
    for (let x = 0; x < 80; x++) if (onHatch(h, x + 0.5, 0.5, 2)) on2++;
    expect(Math.abs(on2 - on)).toBeLessThanOrEqual(3); // dvojnásobná rozteč i tloušťka → podobný podíl
  });

  it("věta pro text `řez`: v drátovém zobrazení čela nejsou, bez komponent nic", () => {
    expect(capSummary(2, "shadedEdges")).toMatch(/čela řezu/);
    expect(capSummary(2, "wireframe")).toMatch(/nekreslí/);
    expect(capSummary(0, "shadedEdges")).toBe("");
  });
});

/* ───────────── softwarový náhled: dvě komponenty v řezu ───────────── */
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
  const c: Vec3[] = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const l: number[] = [];
  for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) l.push(...c[a], ...c[b]);
  return { vertices: new Float32Array(v), triangles: new Uint32Array(t), lines: new Float32Array(l), color };
}
const W = 400;
const H = 300;
const toScreen = (c: SoftCamera, p: Vec3): [number, number] => {
  const d = [p[0] - c.center[0], p[1] - c.center[1], p[2] - c.center[2]];
  return [Math.floor(W / 2 + c.scale * (c.right[0] * d[0] + c.right[1] * d[1] + c.right[2] * d[2])), Math.floor(H / 2 - c.scale * (c.up[0] * d[0] + c.up[1] * d[1] + c.up[2] * d[2]))];
};
/** položky sestavy se styly čel tak, jak je staví viewport-soft.tsx (sceneItems) */
function asmItems(comps: (CapInput & { min: Vec3; max: Vec3 })[], display: "shadedEdges" | "hiddenLine" = "shadedEdges"): SoftItem[] {
  const st = softCapStyles(comps, display);
  return comps.map((c, i) => {
    const it = box(c.min, c.max, parseHex(c.color));
    const s = st[i];
    return { ...it, wire: !!c.dim, capColor: s ? s.fill : null, capHatch: s ? { nx: s.hatch.nx, ny: s.hatch.ny, step: s.hatch.step, width: s.hatch.width, color: s.hatch.color } : null };
  });
}

describe("softwarový náhled – čela řezu komponent sestavy", () => {
  const comps = [
    { id: "deska-a", color: "#b9c2cc", min: [0, 0, 0] as Vec3, max: [40, 30, 20] as Vec3 },
    { id: "deska-b", color: "#4678c8", min: [40, 0, 0] as Vec3, max: [80, 30, 20] as Vec3 },
  ];
  const clip = { normal: [0, 1, 0] as Vec3, constant: -15 }; // zůstává y ≥ 15, kamera zepředu (−Y) se dívá do řezu
  const items = asmItems(comps);
  const camera = fitCamera(items, basisOf(VIEW_ANGLES.front), W, H);
  const styles = softCapStyles(comps, "shadedEdges");

  it("každá komponenta má v rovině řezu své čelo (barva komponenty nebo šrafa), ne výchozí lososové ani pozadí", () => {
    const r = softRender({ width: W, height: H, items, camera, clip });
    for (const [k, c] of comps.entries()) {
      const s = styles[k]!;
      const [cx, cy] = toScreen(camera, [(c.min[0] + c.max[0]) / 2, 15, 10]);
      let fill = 0, hatch = 0, other = 0;
      for (let y = cy - 12; y <= cy + 12; y++)
        for (let x = cx - 12; x <= cx + 12; x++) {
          const o = (y * W + x) * 4;
          const px = [r.data[o], r.data[o + 1], r.data[o + 2]];
          expect(r.data[o + 3]).toBe(255); // ne pozadí
          expect(near(px, DEFAULT_CAP)).toBe(false);
          if (near(px, s.fill)) fill++;
          else if (near(px, s.hatch.color)) hatch++;
          else other++;
        }
      expect(other).toBe(0);
      expect(fill).toBeGreaterThan(300);
      expect(hatch).toBeGreaterThan(20);
    }
    expect(styles[0]!.hex).not.toBe(styles[1]!.hex);
  });

  it("šrafy v obraze přesně podle onHatch (stejný vzorec jako shader 3D okna, y nahoru), i s měřítkem pixelů", () => {
    for (const scale of [1, 2]) {
      const r = softRender({ width: W, height: H, items, camera, clip, edges: false, capScale: scale });
      const s = styles[0]!;
      const [cx, cy] = toScreen(camera, [20, 15, 10]);
      for (let y = cy - 10; y <= cy + 10; y++)
        for (let x = cx - 10; x <= cx + 10; x++) {
          const o = (y * W + x) * 4;
          const want = onHatch(s.hatch, x + 0.5, H - y - 0.5, scale) ? s.hatch.color : s.fill;
          expect([r.data[o], r.data[o + 1], r.data[o + 2]]).toEqual(want);
        }
    }
  });

  it("hloubka čela = rovina řezu (hrany zadní stěny za čelem zůstanou skryté)", () => {
    const r = softRender({ width: W, height: H, items, camera, clip });
    const [cx, cy] = toScreen(camera, [20, 15, 10]);
    // hloubka pixelu = D·(p − C), D míří ke kameře (−Y)
    const want = camera.dir[0] * (20 - camera.center[0]) + camera.dir[1] * (15 - camera.center[1]) + camera.dir[2] * (10 - camera.center[2]);
    expect(r.depth[cy * W + cx]).toBeCloseTo(want, 3);
    // izometrie: zadní hrany kvádru by bez čela prosvítaly – v ploše čela žádný pixel barvy hran
    const iso = fitCamera(items, basisOf(VIEW_ANGLES.iso), W, H);
    const ri = softRender({ width: W, height: H, items, camera: iso, clip });
    const [ix, iy] = (() => {
      const d = [20 - iso.center[0], 15 - iso.center[1], 10 - iso.center[2]];
      return [Math.floor(W / 2 + iso.scale * (iso.right[0] * d[0] + iso.right[1] * d[1] + iso.right[2] * d[2])), Math.floor(H / 2 - iso.scale * (iso.up[0] * d[0] + iso.up[1] * d[1] + iso.up[2] * d[2]))];
    })();
    let edgePx = 0;
    for (let y = iy - 6; y <= iy + 6; y++)
      for (let x = ix - 6; x <= ix + 6; x++) {
        const o = (y * W + x) * 4;
        if (near([ri.data[o], ri.data[o + 1], ri.data[o + 2]], [27, 36, 48], 6)) edgePx++;
      }
    expect(edgePx).toBe(0);
  });

  it("tlumená komponenta (jen hrany) čelo nemá; díl bez barvy čela kreslí výchozí barvu řezu jako dřív", () => {
    const dimItems = asmItems([comps[0], { ...comps[1], dim: true }]);
    const r = softRender({ width: W, height: H, items: dimItems, camera, clip, edges: false });
    const [bx, by] = toScreen(camera, [60, 15, 10]);
    expect(r.data[(by * W + bx) * 4 + 3]).toBe(0);
    const part = box([0, 0, 0], [40, 30, 20], [185, 194, 204]);
    const pc = fitCamera([part], basisOf(VIEW_ANGLES.front), W, H);
    const rp = softRender({ width: W, height: H, items: [part], camera: pc, clip, edges: false });
    const o = (Math.floor(H / 2) * W + Math.floor(W / 2)) * 4;
    expect([rp.data[o], rp.data[o + 1], rp.data[o + 2]]).toEqual(DEFAULT_CAP);
  });

  it("díl s více tělesy jako jedna komponenta (i list podsestavy): čelo dostane každé těleso", () => {
    // dvě tělesa jedné komponenty v jedné síti (jak je posílá jádro), vedle druhé komponenty
    const b1 = box([0, 0, 0], [15, 30, 20], [185, 194, 204]);
    const b2 = box([25, 0, 0], [40, 30, 20], [185, 194, 204]);
    const nv = b1.vertices.length / 3;
    const multi: SoftItem = {
      vertices: new Float32Array([...b1.vertices, ...b2.vertices]),
      triangles: new Uint32Array([...b1.triangles, ...[...b2.triangles].map((i) => i + nv)]),
      color: [185, 194, 204],
    };
    const st = softCapStyles([{ id: "podsestava/deska-a", color: "#b9c2cc" }, comps[1]], "shadedEdges");
    const its: SoftItem[] = [
      { ...multi, capColor: st[0]!.fill, capHatch: null },
      { ...items[1], capColor: st[1]!.fill, capHatch: null },
    ];
    const r = softRender({ width: W, height: H, items: its, camera, clip, edges: false });
    for (const x of [7, 32]) {
      const [px, py] = toScreen(camera, [x, 15, 10]);
      const o = (py * W + px) * 4;
      expect([r.data[o], r.data[o + 1], r.data[o + 2]]).toEqual(st[0]!.fill);
    }
    // mezera mezi tělesy (x 15…25) čelo nemá – je za ní vidět jen pozadí
    const [gx, gy] = toScreen(camera, [20, 15, 10]);
    expect(r.data[(gy * W + gx) * 4 + 3]).toBe(0);
  });

  it("zobrazení „skryté hrany“: čela bílá s antracitovými šrafami (ne bílá jako povrch bez šraf)", () => {
    const hl = asmItems(comps, "hiddenLine");
    const r = softRender({ width: W, height: H, items: hl, camera, clip, flatColor: [255, 255, 255] });
    const [cx, cy] = toScreen(camera, [20, 15, 10]);
    let dark = 0;
    for (let y = cy - 10; y <= cy + 10; y++)
      for (let x = cx - 10; x <= cx + 10; x++) if (near([r.data[(y * W + x) * 4], r.data[(y * W + x) * 4 + 1], r.data[(y * W + x) * 4 + 2]], [39, 36, 37])) dark++;
    expect(dark).toBeGreaterThan(10);
  });
});
