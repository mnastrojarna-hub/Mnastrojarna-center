/**
 * Výkresová dokumentace z 3D modelu: pravoúhlé promítání ISO E (evropské), celkové kóty,
 * izometrický náhled a rohové razítko Mnástrojárny. Výstup SVG (tisk/PDF) a DXF.
 */
import * as r from "replicad";
import type { Vec2 } from "./types";

type Poly = { pts: Vec2[]; layer: "visible" | "hidden" | "dim" | "frame" | "thin" };
type Text = { x: number; y: number; s: string; size: number; anchor?: "start" | "middle" | "end"; rotate?: number; bold?: boolean };

export type DrawingMeta = { name: string; material: string; massKg?: number; author?: string; date?: string; number?: string };

/** Rozloží SVG path (absolutní příkazy M L H V A C Q Z) na polyline v souřadnicích SVG. */
export function pathToPolylines(d: string): Vec2[][] {
  const tokens = d.match(/[MLHVACQZmlhvacqz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const out: Vec2[][] = [];
  let cur: Vec2[] = [];
  let p: Vec2 = [0, 0];
  let start: Vec2 = [0, 0];
  let i = 0;
  let cmd = "";
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++].toUpperCase();
    switch (cmd) {
      case "M":
        if (cur.length > 1) out.push(cur);
        p = [num(), num()];
        start = p;
        cur = [p];
        cmd = "L";
        break;
      case "L":
        p = [num(), num()];
        cur.push(p);
        break;
      case "H":
        p = [num(), p[1]];
        cur.push(p);
        break;
      case "V":
        p = [p[0], num()];
        cur.push(p);
        break;
      case "C": {
        const c1: Vec2 = [num(), num()];
        const c2: Vec2 = [num(), num()];
        const e: Vec2 = [num(), num()];
        for (let k = 1; k <= 12; k++) {
          const t = k / 12;
          const u = 1 - t;
          cur.push([
            u * u * u * p[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * e[0],
            u * u * u * p[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * e[1],
          ]);
        }
        p = e;
        break;
      }
      case "Q": {
        const c: Vec2 = [num(), num()];
        const e: Vec2 = [num(), num()];
        for (let k = 1; k <= 10; k++) {
          const t = k / 10;
          const u = 1 - t;
          cur.push([u * u * p[0] + 2 * u * t * c[0] + t * t * e[0], u * u * p[1] + 2 * u * t * c[1] + t * t * e[1]]);
        }
        p = e;
        break;
      }
      case "A": {
        const rx = num();
        const ry = num();
        const rotDeg = num();
        const large = num();
        const sweep = num();
        const e: Vec2 = [num(), num()];
        cur.push(...arcToPoints(p, e, rx, ry, rotDeg, !!large, !!sweep));
        p = e;
        break;
      }
      case "Z":
        cur.push(start);
        p = start;
        break;
      default:
        i++;
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

function arcToPoints(p0: Vec2, p1: Vec2, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean): Vec2[] {
  if (rx === 0 || ry === 0) return [p1];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const co = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = (co * rx * y1) / ry;
  const cy1 = (-co * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 24)));
  const pts: Vec2[] = [];
  for (let k = 1; k <= n; k++) {
    const t = t1 + (dt * k) / n;
    pts.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
  }
  return pts;
}

const SCALES = [10, 5, 2, 1, 1 / 2, 1 / 5, 1 / 10, 1 / 20, 1 / 50, 1 / 100];
const scaleLabel = (s: number) => (s >= 1 ? `${s}:1` : `1:${Math.round(1 / s)}`);

type View = { polys: Poly[]; w: number; h: number; x0: number; y0: number };

function projectView(shape: r.Shape3D, cam: r.ProjectionPlane | r.ProjectionCamera, withHidden = true): View {
  const p = r.drawProjection(shape, cam as never);
  const polys: Poly[] = [];
  for (const d of p.visible.toSVGPaths().flat()) for (const pts of pathToPolylines(d)) polys.push({ pts, layer: "visible" });
  if (withHidden) for (const d of p.hidden.toSVGPaths().flat()) for (const pts of pathToPolylines(d)) polys.push({ pts, layer: "hidden" });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pl of polys) for (const [x, y] of pl.pts) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (!Number.isFinite(x0)) return { polys, w: 0, h: 0, x0: 0, y0: 0 };
  return { polys, w: x1 - x0, h: y1 - y0, x0, y0 };
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("cs-CZ");

export function makeDrawing(shape: r.Shape3D, meta: DrawingMeta) {
  const front = projectView(shape, "front");
  const top = projectView(shape, "top");
  const left = projectView(shape, "left");
  let iso: View | null = null;
  try {
    iso = projectView(shape, new r.ProjectionCamera([1, -1, 1] as never, [-1, 1, -1] as never) as never, false);
    if (!iso.w) iso = null;
  } catch {
    iso = null;
  }

  // List: A4 nebo A3 na šířku
  const big = Math.max(front.w + left.w, front.h + top.h) > 220;
  const [SW, SH] = big ? [420, 297] : [297, 210];
  const M = 10;
  const TB = { w: 180, h: 36 };
  const GAP = 28;
  const availW = SW - 2 * M - 30;
  const availH = SH - 2 * M - TB.h - 24;
  const scale = SCALES.find((s) => (front.w + left.w) * s + GAP <= availW && (front.h + top.h) * s + GAP <= availH) ?? SCALES[SCALES.length - 1];

  const polys: Poly[] = [];
  const texts: Text[] = [];
  const ox = M + 30;
  const oy = M + 22;
  // pozice pohledů (levý horní roh) v mm listu
  const place = (v: View, px: number, py: number) => {
    for (const pl of v.polys) polys.push({ layer: pl.layer, pts: pl.pts.map(([x, y]) => [px + (x - v.x0) * scale, py + (y - v.y0) * scale]) });
    return { x: px, y: py, w: v.w * scale, h: v.h * scale };
  };
  const F = place(front, ox, oy);
  const L = place(left, ox + F.w + GAP, oy);
  const T = place(top, ox, oy + F.h + GAP);
  if (iso) {
    const room = { x: L.x, y: T.y, w: SW - M - L.x - 4, h: SH - M - TB.h - T.y - 6 };
    const s2 = Math.min(scale, room.w / iso.w, room.h / iso.h) * 0.9;
    if (s2 > 0 && room.w > 30 && room.h > 30) {
      const px = room.x + (room.w - iso.w * s2) / 2;
      const py = room.y + (room.h - iso.h * s2) / 2;
      for (const pl of iso.polys) polys.push({ layer: "thin", pts: pl.pts.map(([x, y]) => [px + (x - iso!.x0) * s2, py + (y - iso!.y0) * s2]) });
    }
  }

  // Kóty
  const dimH = (x1: number, x2: number, y: number, ref: number, value: number) => {
    polys.push({ layer: "dim", pts: [[x1, ref], [x1, y - 2]] }, { layer: "dim", pts: [[x2, ref], [x2, y - 2]] }, { layer: "dim", pts: [[x1, y], [x2, y]] });
    arrow(x1, y, 1, 0);
    arrow(x2, y, -1, 0);
    texts.push({ x: (x1 + x2) / 2, y: y - 1.5, s: fmt(value), size: 3.5, anchor: "middle" });
  };
  const dimV = (y1: number, y2: number, x: number, ref: number, value: number) => {
    polys.push({ layer: "dim", pts: [[ref, y1], [x - 2, y1]] }, { layer: "dim", pts: [[ref, y2], [x - 2, y2]] }, { layer: "dim", pts: [[x, y1], [x, y2]] });
    arrow(x, y1, 0, 1);
    arrow(x, y2, 0, -1);
    texts.push({ x: x - 1.5, y: (y1 + y2) / 2, s: fmt(value), size: 3.5, anchor: "middle", rotate: -90 });
  };
  const arrow = (x: number, y: number, dx: number, dy: number) => {
    const l = 3;
    const w = 0.9;
    polys.push({ layer: "dim", pts: [[x + dx * l - dy * w, y + dy * l + dx * w], [x, y], [x + dx * l + dy * w, y + dy * l - dx * w]] });
  };
  if (front.w) dimH(F.x, F.x + F.w, F.y - 8, F.y, front.w);
  if (front.h) dimV(F.y, F.y + F.h, F.x - 8, F.x, front.h);
  if (left.w) dimH(L.x, L.x + L.w, L.y - 8, L.y, left.w);
  if (top.h) dimV(T.y, T.y + T.h, T.x - 8, T.x, top.h);

  // Rám a razítko
  polys.push({ layer: "frame", pts: [[M, M], [SW - M, M], [SW - M, SH - M], [M, SH - M], [M, M]] });
  const tx = SW - M - TB.w;
  const ty = SH - M - TB.h;
  const rect = (x: number, y: number, w: number, h: number) => polys.push({ layer: "frame", pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]] });
  rect(tx, ty, TB.w, TB.h);
  rect(tx, ty, 60, TB.h);
  rect(tx + 60, ty, 120, 12);
  rect(tx + 60, ty + 12, 60, 12);
  rect(tx + 120, ty + 12, 60, 12);
  rect(tx + 60, ty + 24, 60, 12);
  rect(tx + 120, ty + 24, 60, 12);
  const cell = (x: number, y: number, label: string, value: string, bold = false) => {
    texts.push({ x: x + 2, y: y + 3.6, s: label, size: 2.2 });
    texts.push({ x: x + 2, y: y + 9.6, s: value, size: bold ? 4.2 : 3.4, bold });
  };
  texts.push({ x: tx + 4, y: ty + 13, s: "Mnástrojárna s.r.o.", size: 4.6, bold: true });
  texts.push({ x: tx + 4, y: ty + 19, s: "Váš partner ve strojírenství", size: 2.6 });
  texts.push({ x: tx + 4, y: ty + 25, s: "www.mnastrojarna.cz", size: 2.6 });
  texts.push({ x: tx + 4, y: ty + 31, s: "Promítání: ISO E (evropské)", size: 2.6 });
  cell(tx + 60, ty, "Název", meta.name.slice(0, 48), true);
  cell(tx + 60, ty + 12, "Materiál", meta.material);
  cell(tx + 120, ty + 12, "Hmotnost", meta.massKg != null ? `${fmt(meta.massKg)} kg` : "—");
  cell(tx + 60, ty + 24, "Měřítko / Formát", `${scaleLabel(scale)}  ·  ${big ? "A3" : "A4"}`);
  cell(tx + 120, ty + 24, "Datum / Číslo", `${meta.date ?? new Date().toLocaleDateString("cs-CZ")}${meta.number ? " · " + meta.number : ""}`);
  texts.push({ x: M + 4, y: SH - M - 4, s: "Nepředepsané tolerance ISO 2768-mK · Rozměry v mm · Nekótované rozměry dle 3D modelu (STEP)", size: 2.5 });

  return { svg: toSvg(SW, SH, polys, texts), dxf: toDxf(SH, polys, texts), scale: scaleLabel(scale), sheet: big ? "A3" : "A4" };
}

const STROKE: Record<Poly["layer"], string> = {
  visible: 'stroke="#111" stroke-width="0.5"',
  hidden: 'stroke="#555" stroke-width="0.25" stroke-dasharray="2 1.2"',
  dim: 'stroke="#E03930" stroke-width="0.18"',
  frame: 'stroke="#111" stroke-width="0.5"',
  thin: 'stroke="#333" stroke-width="0.25"',
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function toSvg(W: number, H: number, polys: Poly[], texts: Text[]) {
  const f = (n: number) => n.toFixed(3);
  const lines = polys
    .map((p) => `<polyline fill="none" ${STROKE[p.layer]} stroke-linecap="round" stroke-linejoin="round" points="${p.pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}"/>`)
    .join("");
  const t = texts
    .map(
      (x) =>
        `<text x="${f(x.x)}" y="${f(x.y)}" font-size="${x.size}" ${x.bold ? 'font-weight="700"' : ""} text-anchor="${x.anchor ?? "start"}" ${x.rotate ? `transform="rotate(${x.rotate} ${f(x.x)} ${f(x.y)})"` : ""} fill="${x.size === 3.5 ? "#E03930" : "#111"}">${esc(x.s)}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="Roboto, Arial, sans-serif"><rect width="${W}" height="${H}" fill="#fff"/>${lines}${t}</svg>`;
}

/** DXF R12 (mm). Osa Y se otáčí (DXF má počátek vlevo dole). */
function toDxf(H: number, polys: Poly[], texts: Text[]) {
  const o: string[] = [];
  const add = (...kv: (string | number)[]) => o.push(...kv.map(String));
  const f = (n: number) => (Math.round(n * 1e4) / 1e4).toString();
  const layer = { visible: "OBRYS", hidden: "SKRYTE", dim: "KOTY", frame: "RAM", thin: "IZO" } as const;
  add(0, "SECTION", 2, "HEADER", 9, "$INSUNITS", 70, 4, 0, "ENDSEC");
  add(0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LAYER", 70, 5);
  for (const [name, color] of [["OBRYS", 7], ["SKRYTE", 8], ["KOTY", 1], ["RAM", 7], ["IZO", 9]] as const) add(0, "LAYER", 2, name, 70, 0, 62, color, 6, "CONTINUOUS");
  add(0, "ENDTAB", 0, "ENDSEC", 0, "SECTION", 2, "ENTITIES");
  for (const p of polys)
    for (let i = 1; i < p.pts.length; i++) {
      const [x1, y1] = p.pts[i - 1];
      const [x2, y2] = p.pts[i];
      add(0, "LINE", 8, layer[p.layer], 10, f(x1), 20, f(H - y1), 30, 0, 11, f(x2), 21, f(H - y2), 31, 0);
    }
  for (const t of texts) {
    const al = t.anchor === "middle" ? 1 : t.anchor === "end" ? 2 : 0;
    add(0, "TEXT", 8, t.size === 3.5 ? "KOTY" : "RAM", 10, f(t.x), 20, f(H - t.y), 30, 0, 40, f(t.size), 1, t.s, 50, f(-(t.rotate ?? 0)));
    if (al) add(72, al, 11, f(t.x), 21, f(H - t.y), 31, 0);
  }
  add(0, "ENDSEC", 0, "EOF");
  return o.join("\n") + "\n";
}
