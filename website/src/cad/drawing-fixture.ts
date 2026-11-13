/**
 * Výkres bez jádra pro testy příkazů výkresu a exportu (jen pro testy – aplikace ho nepoužívá): deska 100 × 60 × 20
 * s dírou Ø40, list A3, přední pohled (X, Z) a horní pohled (X, Y) se skutečnými hranami a kružnicí, Chytré kóty
 * (100, 20, 60, Ø40), detaily a další modely podle voleb listu – jako výsledek jádra (cad.drawing).
 */
import { parseAgentText } from "./agent";
import { modelViewKey, toDxf, toSvg, type DrawingMeta, type DrawingOptions, type PlacedView, type ViewEnt } from "./drawing";
import type { SmartResult } from "./drawing-agent";
import { emptyDoc, type CadDoc, type DrawingAnnotation, type Vec2 } from "./types";

const rect = (x0: number, y0: number, x1: number, y1: number): ViewEnt[] => [
  { t: "line", a: [x0, y0], b: [x1, y0] },
  { t: "line", a: [x1, y0], b: [x1, y1] },
  { t: "line", a: [x1, y1], b: [x0, y1] },
  { t: "line", a: [x0, y1], b: [x0, y0] },
];

/** deska 100 × 60 × 20 (střed v počátku, Z 0…20) s dírou Ø40 – dokument z textových příkazů */
export function plateDoc(name = "Deska"): CadDoc {
  const p = parseAgentText("kvádr 100 60 20 střed\ndíra 40 skrz v 0 0 20");
  const d = emptyDoc(name);
  for (const op of p.ops) if (op.k === "feature") d.features.push(op.feature);
  return d;
}

/** počet volání výpočtu (testy mezipaměti / ověření) */
export const fixtureCalls = { n: 0, last: null as null | { meta: DrawingMeta; opts: Partial<DrawingOptions> } };

/** Výpočet výkresu jako jádro – pevné rozvržení pohledů (A3, 1:1). */
export async function fixtureCompute(doc: CadDoc, meta: DrawingMeta, opts: Partial<DrawingOptions>): Promise<SmartResult> {
  fixtureCalls.n++;
  fixtureCalls.last = { meta, opts };
  const W = 420;
  const H = 297;
  const views: PlacedView[] = [
    { key: "front", px: 40, py: 40, s: 1, x0: -50, y0: -20, w: 100, h: 20, ents: [...rect(-50, -20, 50, 0), { t: "line", a: [-20, -20], b: [-20, 0], hidden: true }, { t: "line", a: [20, -20], b: [20, 0], hidden: true }], cam: { d: [0, -1, 0], x: [1, 0, 0] } },
    { key: "top", px: 40, py: 90, s: 1, x0: -50, y0: -30, w: 100, h: 60, ents: [...rect(-50, -30, 50, 30), { t: "arc", c: [0, 0], r: 20, a0: 0, da: 2 * Math.PI }], cam: { d: [0, 0, 1], x: [1, 0, 0] } },
  ];
  const models = (opts.models ?? []).map((m, i) => ({ id: m.id, key: modelViewKey(m.id), scale: m.scale === "auto" ? "1:1" : String(m.scale), scaleValue: 1, x: 200, y: 40 + i * 50, w: 40, h: 40 }));
  for (const m of models) views.push({ key: m.key, px: m.x, py: m.y, s: 1, x0: -20, y0: -20, w: 40, h: 40, ents: rect(-20, -20, 20, 20), cam: { d: [0, -1, 0], x: [1, 0, 0] } });
  const details = (opts.details ?? []).flatMap((d) => (views.some((v) => v.key === d.view) ? [{ id: d.id, label: d.label, x: d.at?.[0] ?? 300, y: d.at?.[1] ?? 40, w: 2 * d.r * d.scale, h: 2 * d.r * d.scale }] : []));
  const texts = [{ x: 300, y: 280, s: meta.name, size: 5 }, { x: 300, y: 288, s: meta.material, size: 3.5 }, ...(meta.bom ?? []).map((b, i) => ({ x: 300, y: 200 + i * 5, s: `${b.pos} ${b.name}`, size: 3 }))];
  const polys = [{ layer: "frame" as const, pts: [[10, 10], [410, 10], [410, 287], [10, 287], [10, 10]] as Vec2[] }];
  const smart = opts.dimensions === "smart" && doc.kind !== "assembly";
  const gen = (id: string, auto: string, a: Partial<DrawingAnnotation>) => ({ id, auto, ...a }) as DrawingAnnotation;
  const annotations: DrawingAnnotation[] = smart
    ? [
        gen("s1", "ov:x", { view: "front", type: "dim", kind: "horizontal", a: [-50, 0], b: [50, 0], offset: 12 }),
        gen("s2", "ov:z", { view: "front", type: "dim", kind: "vertical", a: [50, 0], b: [50, -20], offset: 12 }),
        gen("s3", "ov:y", { view: "top", type: "dim", kind: "vertical", a: [50, -30], b: [50, 30], offset: 12 }),
        gen("s4", "hole:0", { view: "top", type: "dim", kind: "diameter", c: [0, 0], r: 20, ang: -45, offset: 8 }),
      ]
    : [];
  return {
    sheet: { name: "A3", w: W, h: H },
    views,
    scale: "1:1",
    scaleValue: 1,
    polys,
    texts,
    svg: toSvg(W, H, polys, texts),
    dxf: toDxf(H, polys, texts),
    warnings: (opts.details ?? []).filter((d) => !views.some((v) => v.key === d.view)).map((d) => `Detail ${d.label}: pohled ${d.view} není na listu.`),
    ...(details.length ? { details } : {}),
    ...(models.length ? { models } : {}),
    ...(smart ? { smart: { gen: `G:${doc.features.length}`, annotations, report: { kind: "prismatic" as const, perView: { front: 2, top: 2 }, skipped: [], expected: 3, noRoom: 0 } } } : {}),
  };
}
