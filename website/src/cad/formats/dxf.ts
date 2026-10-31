/**
 * Import DXF (ASCII, R12–2018) do entit skici: LINE, CIRCLE, ARC, LWPOLYLINE (vč. oblouků „bulge“),
 * POLYLINE/VERTEX, ELLIPSE a SPLINE (aproximace lomenou čarou). Jednotky dle $INSUNITS → mm.
 * Bloky (INSERT), texty a kóty se přeskakují.
 */
import { uid, type SketchEntity, type Vec2 } from "../types";

const UNITS: Record<number, number> = { 0: 1, 1: 25.4, 2: 304.8, 3: 1609344, 4: 1, 5: 10, 6: 1000, 7: 1e6, 8: 0.0000254, 9: 0.0254, 10: 914.4, 13: 0.001, 14: 100 };

type Pair = { code: number; value: string };

function pairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (!Number.isFinite(code)) {
      i--; // posun při prázdném řádku
      continue;
    }
    out.push({ code, value: lines[i + 1].trim() });
  }
  return out;
}

type Ent = { type: string; g: Pair[] };

function num(e: Ent, code: number, def = 0): number {
  const p = e.g.find((x) => x.code === code);
  return p ? Number(p.value) : def;
}
function all(e: Ent, code: number): number[] {
  return e.g.filter((x) => x.code === code).map((x) => Number(x.value));
}

export type DxfResult = { entities: SketchEntity[]; skipped: Record<string, number>; unitScale: number };

export function parseDXF(text: string): DxfResult {
  if (/^AC10\d\d/.test(text.slice(0, 6))) throw new Error("Soubor je binární DWG, ne DXF.");
  if (text.startsWith("AutoCAD Binary DXF")) throw new Error("Binární DXF není podporované – uložte DXF jako ASCII.");
  const P = pairs(text);
  let scale = 1;
  // hlavička
  for (let i = 0; i < P.length; i++) {
    if (P[i].code === 9 && P[i].value === "$INSUNITS") {
      const v = P[i + 1];
      if (v && v.code === 70) scale = UNITS[Number(v.value)] ?? 1;
    }
  }
  // sekce ENTITIES
  let start = -1;
  for (let i = 0; i + 1 < P.length; i++) if (P[i].code === 0 && P[i].value === "SECTION" && P[i + 1].code === 2 && P[i + 1].value === "ENTITIES") start = i + 2;
  if (start < 0) throw new Error("DXF neobsahuje sekci ENTITIES.");
  const ents: Ent[] = [];
  for (let i = start; i < P.length; i++) {
    const p = P[i];
    if (p.code === 0) {
      if (p.value === "ENDSEC") break;
      ents.push({ type: p.value, g: [] });
    } else ents[ents.length - 1]?.g.push(p);
  }

  const S = (v: number) => v * scale;
  const out: SketchEntity[] = [];
  const skipped: Record<string, number> = {};
  const ocsFlip = (e: Ent) => num(e, 230, 1) < 0; // extruze (0,0,-1) → zrcadlení X
  const pt = (x: number, y: number, flip = false): Vec2 => [S(flip ? -x : x), S(y)];

  const arcEntity = (c: Vec2, r: number, a0: number, a1: number): SketchEntity => {
    // úhly ve stupních, CCW
    let s = a0;
    let e = a1;
    while (e <= s) e += 360;
    const m = (s + e) / 2;
    const at = (deg: number): Vec2 => {
      const a = (deg * Math.PI) / 180;
      return [S(c[0] + r * Math.cos(a)), S(c[1] + r * Math.sin(a))] as Vec2;
    };
    return { id: uid(), type: "arc", a: at(s), b: at(m), c: at(e) };
  };

  /** Lomená čára s „bulge“ → entity (polyline bez oblouků, jinak úsečky + oblouky). */
  const polyWithBulges = (verts: Vec2[], bulges: number[], closed: boolean) => {
    if (verts.length < 2) return;
    if (!bulges.some((b) => Math.abs(b) > 1e-9)) {
      out.push({ id: uid(), type: "polyline", points: verts, closed });
      return;
    }
    const n = closed ? verts.length : verts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      const bulge = bulges[i] ?? 0;
      if (Math.abs(bulge) < 1e-9) out.push({ id: uid(), type: "line", a, b });
      else {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const mid: Vec2 = [(a[0] + b[0]) / 2 + (dy * bulge) / 2, (a[1] + b[1]) / 2 - (dx * bulge) / 2];
        out.push({ id: uid(), type: "arc", a, b: mid, c: b });
      }
    }
  };

  for (let k = 0; k < ents.length; k++) {
    const e = ents[k];
    const flip = ocsFlip(e);
    switch (e.type) {
      case "LINE":
        out.push({ id: uid(), type: "line", a: pt(num(e, 10), num(e, 20)), b: pt(num(e, 11), num(e, 21)) });
        break;
      case "CIRCLE": {
        const x = num(e, 10);
        out.push({ id: uid(), type: "circle", cx: S(flip ? -x : x), cy: S(num(e, 20)), r: S(num(e, 40)) });
        break;
      }
      case "ARC": {
        const a0 = num(e, 50);
        const a1 = num(e, 51);
        // zrcadlení X: úhel θ → 180−θ a prohodí se začátek/konec
        out.push(flip ? arcEntity([-num(e, 10), num(e, 20)], num(e, 40), 180 - a1, 180 - a0) : arcEntity([num(e, 10), num(e, 20)], num(e, 40), a0, a1));
        break;
      }
      case "LWPOLYLINE": {
        const verts: Vec2[] = [];
        const bulges: number[] = [];
        for (const p of e.g) {
          if (p.code === 10) {
            verts.push([Number(p.value), 0]);
            bulges.push(0);
          }
          if (p.code === 20 && verts.length) verts[verts.length - 1][1] = Number(p.value);
          if (p.code === 42 && bulges.length) bulges[bulges.length - 1] = Number(p.value);
        }
        polyWithBulges(verts.map(([x, y]) => pt(x, y, flip)), flip ? bulges.map((b) => -b) : bulges, (num(e, 70) & 1) === 1);
        break;
      }
      case "POLYLINE": {
        const flags = num(e, 70);
        if (flags & (16 | 64)) {
          skipped["POLYLINE (síť)"] = (skipped["POLYLINE (síť)"] ?? 0) + 1;
          break;
        }
        const verts: Vec2[] = [];
        const bulges: number[] = [];
        while (k + 1 < ents.length && ents[k + 1].type === "VERTEX") {
          const v = ents[++k];
          verts.push(pt(num(v, 10), num(v, 20), flip));
          bulges.push(flip ? -num(v, 42) : num(v, 42));
        }
        if (ents[k + 1]?.type === "SEQEND") k++;
        polyWithBulges(verts, bulges, (flags & 1) === 1);
        break;
      }
      case "ELLIPSE": {
        const c: Vec2 = [num(e, 10), num(e, 20)];
        const maj: Vec2 = [num(e, 11), num(e, 21)];
        const ratio = num(e, 40, 1);
        let t0 = num(e, 41, 0);
        let t1 = num(e, 42, Math.PI * 2);
        while (t1 <= t0) t1 += Math.PI * 2;
        const full = Math.abs(t1 - t0 - Math.PI * 2) < 1e-6;
        const minor: Vec2 = [-maj[1] * ratio, maj[0] * ratio];
        const n = Math.max(12, Math.ceil(((t1 - t0) / (Math.PI * 2)) * 72));
        const pts: Vec2[] = [];
        for (let i = 0; i <= (full ? n - 1 : n); i++) {
          const t = t0 + ((t1 - t0) * i) / n;
          pts.push(pt(c[0] + maj[0] * Math.cos(t) + minor[0] * Math.sin(t), c[1] + maj[1] * Math.cos(t) + minor[1] * Math.sin(t), flip));
        }
        out.push({ id: uid(), type: "polyline", points: pts, closed: full });
        break;
      }
      case "SPLINE": {
        const degree = num(e, 71, 3);
        const knots = all(e, 40);
        const weights = all(e, 41);
        const cx = all(e, 10);
        const cy = all(e, 20);
        const fx = all(e, 11);
        const fy = all(e, 21);
        const closed = (num(e, 70) & 1) === 1;
        let pts: Vec2[] = [];
        if (cx.length > degree && knots.length === cx.length + degree + 1) {
          const ctrl: Vec2[] = cx.map((x, i) => [x, cy[i]]);
          const w = weights.length === ctrl.length ? weights : ctrl.map(() => 1);
          const u0 = knots[degree];
          const u1 = knots[knots.length - degree - 1];
          const n = Math.max(24, ctrl.length * 8);
          for (let i = 0; i <= n; i++) pts.push(deBoor(degree, knots, ctrl, w, u0 + ((u1 - u0) * i) / n));
        } else if (fx.length >= 2) pts = fx.map((x, i) => [x, fy[i]]);
        else {
          skipped.SPLINE = (skipped.SPLINE ?? 0) + 1;
          break;
        }
        out.push({ id: uid(), type: "polyline", points: pts.map(([x, y]) => pt(x, y, flip)), closed });
        break;
      }
      case "SEQEND":
      case "VERTEX":
        break;
      default:
        skipped[e.type] = (skipped[e.type] ?? 0) + 1;
    }
  }
  return { entities: out, skipped, unitScale: scale };
}

/** Racionální B-spline (de Boor). */
function deBoor(p: number, U: number[], P: Vec2[], W: number[], u: number): Vec2 {
  const n = P.length - 1;
  let k = p;
  if (u >= U[n + 1]) k = n;
  else while (k < n && !(u >= U[k] && u < U[k + 1])) k++;
  const d = Array.from({ length: p + 1 }, (_, j) => {
    const i = j + k - p;
    return [P[i][0] * W[i], P[i][1] * W[i], W[i]];
  });
  for (let r = 1; r <= p; r++)
    for (let j = p; j >= r; j--) {
      const i = j + k - p;
      const den = U[i + p - r + 1] - U[i];
      const a = den ? (u - U[i]) / den : 0;
      for (let c = 0; c < 3; c++) d[j][c] = (1 - a) * d[j - 1][c] + a * d[j][c];
    }
  return [d[p][0] / d[p][2], d[p][1] / d[p][2]];
}
