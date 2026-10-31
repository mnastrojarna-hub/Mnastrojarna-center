import DxfParser from "dxf-parser";
import { ModelImportError } from "../types";
import { aciColor, insunitsToMm, plainText, trueColor, type DrawColor, type DrawEntity, type DrawLayer, type Drawing2D, type Pt } from "../drawing2d";

/**
 * DXF (ASCII) → 2D výkres: hladiny, čáry, polyčáry s oblouky, kružnice, oblouky, elipsy, spliny,
 * body, texty, MTEXT, bloky (INSERT, i vnořené a pole), kóty (anonymní bloky *D), SOLID.
 * Texty v kódové stránce výkresu ($DWGCODEPAGE, od R2007 UTF-8) — čeština bez rozsypaných znaků.
 */

type Any = any;

/** Afinní 2D transformace: x' = a·x + c·y + e, y' = b·x + d·y + f. */
type M2 = [number, number, number, number, number, number];
const I: M2 = [1, 0, 0, 1, 0, 0];

function mul(m: M2, n: M2): M2 {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
const tp = (m: M2, x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const det = (m: M2) => m[0] * m[3] - m[1] * m[2];
const sx = (m: M2) => Math.hypot(m[0], m[1]);
const sy = (m: M2) => Math.hypot(m[2], m[3]);
const rot = (m: M2) => Math.atan2(m[1], m[0]);

const CODEPAGES: Record<string, string> = {
  ANSI_1250: "windows-1250", ANSI_1251: "windows-1251", ANSI_1252: "windows-1252", ANSI_1253: "windows-1253",
  ANSI_1254: "windows-1254", ANSI_1255: "windows-1255", ANSI_1256: "windows-1256", ANSI_1257: "windows-1257",
  ANSI_874: "windows-874", ANSI_932: "shift_jis", ANSI_936: "gbk", ANSI_949: "euc-kr", ANSI_950: "big5",
  DOS850: "ibm866", DOS852: "ibm866", DOS866: "ibm866",
};

/** Bajty DXF → text ve správném kódování. */
export function decodeDxf(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 200_000)));
  const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d{4})/.exec(head)?.[1] ?? "";
  const cp = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/.exec(head)?.[1]?.toUpperCase() ?? "";
  // R2007+ (AC1021) je vždy UTF-8; starší podle kódové stránky (české výkresy ANSI_1250)
  let enc = ver >= "AC1021" ? "utf-8" : CODEPAGES[cp] ?? "windows-1252";
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) enc = "utf-8";
  try {
    return new TextDecoder(enc).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

const P = (p: Any): Pt => [Number(p?.x ?? 0), Number(p?.y ?? 0)];

interface Ctx {
  out: DrawEntity[];
  blocks: Record<string, Any>;
  layers: Map<string, DrawLayer>;
  skipped: Map<string, number>;
  depth: number;
}

function layerColor(ctx: Ctx, name: string): DrawColor {
  return ctx.layers.get(name)?.color ?? "fg";
}

/** Barva entity: true color (420) / ACI (62) / BYLAYER (256) / BYBLOCK (0). */
function entityColor(ctx: Ctx, e: Any, layer: string, blockColor: DrawColor | null): DrawColor {
  const ci = e.colorIndex as number | undefined;
  const rgb = typeof e.color === "number" ? (e.color as number) : undefined;
  if (ci === 0) return blockColor ?? layerColor(ctx, layer);
  if (ci === undefined) return rgb !== undefined ? trueColor(rgb) : layerColor(ctx, layer);
  if (ci === 256) return layerColor(ctx, layer);
  if (ci === 7) return "fg";
  return rgb !== undefined ? trueColor(rgb) : aciColor(ci);
}

function arcPoints(c: Pt, r: number, a0: number, a1: number): Pt[] {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += Math.PI * 2;
  const n = Math.max(2, Math.ceil(sweep / (Math.PI / 48)));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return pts;
}

/** B-spline (de Boor), volitelně racionální. */
export function evalSpline(ctrl: Pt[], knots: number[], degree: number, weights?: number[], samplesPerSpan = 16): Pt[] {
  const n = ctrl.length;
  if (n < 2) return ctrl;
  const p = Math.max(1, Math.min(degree || 3, n - 1));
  const k = knots.length === n + p + 1 ? knots : uniformKnots(n, p);
  const w = weights && weights.length === n ? weights : null;
  const t0 = k[p];
  const t1 = k[n];
  const out: Pt[] = [];
  const spans = Math.max(1, n - p);
  const total = spans * samplesPerSpan;
  for (let s = 0; s <= total; s++) {
    const t = Math.min(t1, t0 + ((t1 - t0) * s) / total);
    let span = p;
    while (span < n - 1 && t >= k[span + 1]) span++;
    const dx: number[] = [];
    const dy: number[] = [];
    const dw: number[] = [];
    for (let j = 0; j <= p; j++) {
      const i = span - p + j;
      const wi = w ? w[i] : 1;
      dx.push(ctrl[i][0] * wi);
      dy.push(ctrl[i][1] * wi);
      dw.push(wi);
    }
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = span - p + j;
        const den = k[i + p - r + 1] - k[i];
        const a = den === 0 ? 0 : (t - k[i]) / den;
        dx[j] = (1 - a) * dx[j - 1] + a * dx[j];
        dy[j] = (1 - a) * dy[j - 1] + a * dy[j];
        dw[j] = (1 - a) * dw[j - 1] + a * dw[j];
      }
    }
    out.push([dx[p] / dw[p], dy[p] / dw[p]]);
  }
  return out;
}

function uniformKnots(n: number, p: number): number[] {
  const k: number[] = [];
  for (let i = 0; i < n + p + 1; i++) k.push(i <= p ? 0 : i >= n ? n - p : i - p);
  return k;
}

const H_ALIGN: Record<number, "left" | "center" | "right"> = { 0: "left", 1: "center", 2: "right", 3: "left", 4: "center", 5: "left" };
const V_ALIGN: Record<number, "baseline" | "bottom" | "middle" | "top"> = { 0: "baseline", 1: "bottom", 2: "middle", 3: "top" };

function emit(ctx: Ctx, e: Any, m: M2, inheritLayer: string | null, blockColor: DrawColor | null) {
  const rawLayer = String(e.layer ?? "0");
  // entity v bloku na hladině 0 přebírá hladinu vložení
  const layer = rawLayer === "0" && inheritLayer ? inheritLayer : rawLayer;
  if (!ctx.layers.has(layer)) ctx.layers.set(layer, { name: layer, color: "fg" });
  const color = entityColor(ctx, e, layer, blockColor);
  if (e.visible === false) return;
  const push = (x: DrawEntity) => ctx.out.push(x);
  switch (e.type) {
    case "LINE": {
      const v = e.vertices ?? [];
      if (v.length >= 2) push({ kind: "line", layer, color, a: tp(m, ...P(v[0])), b: tp(m, ...P(v[1])) });
      return;
    }
    case "LWPOLYLINE":
    case "POLYLINE": {
      const v = (e.vertices ?? []) as Any[];
      if (v.length < 2) return;
      const flip = det(m) < 0 ? -1 : 1;
      push({
        kind: "polyline", layer, color, points: v.map((p) => tp(m, ...P(p))),
        bulges: v.map((p) => Number(p.bulge ?? 0) * flip), closed: !!e.shape,
      });
      return;
    }
    case "CIRCLE":
    case "ARC": {
      const c = tp(m, ...P(e.center));
      const r = Number(e.radius ?? 0);
      const full = e.type === "CIRCLE";
      if (Math.abs(sx(m) - sy(m)) < 1e-9 * Math.max(1, sx(m))) {
        const R = r * sx(m);
        if (full) push({ kind: "circle", layer, color, c, r: R });
        else {
          const ro = rot(m);
          let a0 = Number(e.startAngle ?? 0);
          let a1 = Number(e.endAngle ?? 0);
          if (det(m) < 0) [a0, a1] = [Math.PI - a1, Math.PI - a0];
          push({ kind: "arc", layer, color, c, r: R, start: a0 + ro, end: a1 + ro });
        }
      } else {
        // nestejnoměrné měřítko bloku → elipsa jako křivka
        const a0 = full ? 0 : Number(e.startAngle ?? 0);
        const a1 = full ? Math.PI * 2 : Number(e.endAngle ?? 0);
        const pts = arcPoints(P(e.center), r, a0, a1).map((p) => tp(m, ...p));
        push({ kind: "curve", layer, color, points: pts, closed: full });
      }
      return;
    }
    case "ELLIPSE": {
      const c = P(e.center);
      const maj = P(e.majorAxisEndPoint);
      const ratio = Number(e.axisRatio ?? 1);
      const a0 = Number(e.startAngle ?? 0);
      let a1 = Number(e.endAngle ?? Math.PI * 2);
      if (a1 <= a0) a1 += Math.PI * 2;
      const n = Math.max(16, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 128));
      const pts: Pt[] = [];
      for (let i = 0; i <= n; i++) {
        const t = a0 + ((a1 - a0) * i) / n;
        pts.push(tp(m, c[0] + maj[0] * Math.cos(t) - maj[1] * ratio * Math.sin(t), c[1] + maj[1] * Math.cos(t) + maj[0] * ratio * Math.sin(t)));
      }
      push({ kind: "curve", layer, color, points: pts, closed: Math.abs(a1 - a0 - Math.PI * 2) < 1e-6 });
      return;
    }
    case "SPLINE": {
      const ctrl = ((e.controlPoints ?? []) as Any[]).map(P);
      const fit = ((e.fitPoints ?? []) as Any[]).map(P);
      const pts = ctrl.length >= 2 ? evalSpline(ctrl, (e.knotValues ?? []) as number[], Number(e.degreeOfSplineCurve ?? 3), e.weights) : fit;
      if (pts.length >= 2) push({ kind: "curve", layer, color, points: pts.map((p) => tp(m, ...p)), closed: !!e.closed });
      return;
    }
    case "POINT":
      push({ kind: "point", layer, color, p: tp(m, ...P(e.position)) });
      return;
    case "SOLID":
    case "TRACE":
    case "3DFACE": {
      const v = ((e.points ?? e.vertices ?? []) as Any[]).map(P);
      if (v.length >= 3) {
        // SOLID má pořadí rohů 1-2-4-3
        const ordered = e.type === "3DFACE" || v.length < 4 ? v : [v[0], v[1], v[3], v[2]];
        push({ kind: "polyline", layer, color, points: ordered.map((p) => tp(m, ...p)), closed: true });
      }
      return;
    }
    case "TEXT":
    case "ATTRIB": {
      const text = plainText(String(e.text ?? ""));
      if (!text.trim()) return;
      const h = Number(e.halign ?? 0);
      const v = Number(e.valign ?? 0);
      const useEnd = (h !== 0 || v !== 0) && e.endPoint && h !== 3 && h !== 5;
      const base = P(useEnd ? e.endPoint : e.startPoint);
      push({
        kind: "text", layer, color, p: tp(m, ...base), text, height: Number(e.textHeight ?? 2.5) * sy(m),
        rotation: (Number(e.rotation ?? 0) * Math.PI) / 180 + rot(m), hAlign: H_ALIGN[h] ?? "left",
        vAlign: h === 4 ? "middle" : V_ALIGN[v] ?? "baseline",
      });
      return;
    }
    case "MTEXT": {
      const text = plainText(String(e.text ?? ""));
      if (!text.trim()) return;
      const ap = Number(e.attachmentPoint ?? 1);
      const hA = (["left", "center", "right"] as const)[(ap - 1) % 3] ?? "left";
      const vA = (["top", "middle", "bottom"] as const)[Math.floor((ap - 1) / 3)] ?? "top";
      const dir = e.directionVector ? Math.atan2(Number(e.directionVector.y ?? 0), Number(e.directionVector.x ?? 1)) : (Number(e.rotation ?? 0) * Math.PI) / 180;
      push({
        kind: "text", layer, color, p: tp(m, ...P(e.position)), text, height: Number(e.height ?? 2.5) * sy(m),
        rotation: dir + rot(m), hAlign: hA, vAlign: vA, width: e.width ? Number(e.width) * sx(m) : undefined,
      });
      return;
    }
    case "INSERT":
    case "DIMENSION": {
      const name = String(e.type === "DIMENSION" ? e.block ?? "" : e.name ?? "");
      const block = ctx.blocks[name];
      if (!block || ctx.depth > 16) return;
      const bp = P(block.position);
      const insColor = color;
      const ents = (block.entities ?? []) as Any[];
      if (e.type === "DIMENSION") {
        ctx.depth++;
        for (const be of ents) emit(ctx, be, m, layer, insColor);
        ctx.depth--;
        return;
      }
      const ip = P(e.position);
      const xs = Number(e.xScale ?? 1) || 1;
      const ys = Number(e.yScale ?? 1) || 1;
      const r = (Number(e.rotation ?? 0) * Math.PI) / 180;
      const cols = Math.max(1, Number(e.columnCount ?? 1));
      const rows = Math.max(1, Number(e.rowCount ?? 1));
      const cs = Number(e.columnSpacing ?? 0);
      const rs = Number(e.rowSpacing ?? 0);
      ctx.depth++;
      for (let ri = 0; ri < rows; ri++) {
        for (let ci = 0; ci < cols; ci++) {
          const cos = Math.cos(r);
          const sin = Math.sin(r);
          const ox = ci * cs;
          const oy = ri * rs;
          // T(ip) · R(r) · T(ox, oy) · S(xs, ys) · T(−bp)
          const local: M2 = [xs * cos, xs * sin, -ys * sin, ys * cos, 0, 0];
          const off = tp([cos, sin, -sin, cos, 0, 0], ox, oy);
          const t: M2 = [local[0], local[1], local[2], local[3], ip[0] + off[0] - (local[0] * bp[0] + local[2] * bp[1]), ip[1] + off[1] - (local[1] * bp[0] + local[3] * bp[1])];
          const mm = mul(m, t);
          for (const be of ents) emit(ctx, be, mm, layer, insColor);
        }
      }
      ctx.depth--;
      return;
    }
    default:
      ctx.skipped.set(e.type, (ctx.skipped.get(e.type) ?? 0) + 1);
  }
}

/** DXF bajty → 2D výkres. */
export function parseDxf(bytes: Uint8Array): Drawing2D {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 22));
  if (head.startsWith("AutoCAD Binary DXF")) {
    throw new ModelImportError("Binární DXF zatím neumím zobrazit — ulož výkres jako DXF (ASCII) nebo DWG.");
  }
  let dxf: Any;
  try {
    dxf = new DxfParser().parseSync(decodeDxf(bytes));
  } catch (e) {
    throw new ModelImportError(`DXF se nepodařilo přečíst (${e instanceof Error ? e.message : "poškozený soubor"}).`);
  }
  if (!dxf) throw new ModelImportError("DXF se nepodařilo přečíst.");
  const layers = new Map<string, DrawLayer>();
  const tl = (dxf.tables?.layer?.layers ?? {}) as Record<string, Any>;
  for (const [name, l] of Object.entries(tl)) {
    const ci = Number(l.colorIndex ?? 7);
    const color: DrawColor = typeof l.color === "number" && ci !== 7 ? trueColor(l.color) : aciColor(ci);
    layers.set(name, { name, color, off: l.visible === false || l.frozen === true || ci < 0 });
  }
  const ctx: Ctx = { out: [], blocks: dxf.blocks ?? {}, layers, skipped: new Map(), depth: 0 };
  const scale = insunitsToMm(Number(dxf.header?.$INSUNITS ?? 0));
  const m: M2 = scale === 1 ? I : [scale, 0, 0, scale, 0, 0];
  for (const e of (dxf.entities ?? []) as Any[]) {
    if (e.inPaperSpace) continue;
    try {
      emit(ctx, e, m, null, null);
    } catch {
      ctx.skipped.set(String(e.type), (ctx.skipped.get(String(e.type)) ?? 0) + 1);
    }
  }
  const warnings: string[] = [];
  const skippedTotal = [...ctx.skipped.values()].reduce((a, b) => a + b, 0);
  if (skippedTotal) warnings.push(`Některé prvky výkresu se nezobrazí (${[...ctx.skipped.keys()].slice(0, 5).join(", ")}).`);
  const ver = String(dxf.header?.$ACADVER ?? "");
  // jen hladiny, na kterých něco je (a v pořadí výkresu)
  const used = new Set(ctx.out.map((x) => x.layer));
  return {
    layers: [...layers.values()].filter((l) => used.has(l.name)),
    entities: ctx.out,
    format: ver ? `DXF (${ver})` : "DXF",
    warnings,
  };
}
