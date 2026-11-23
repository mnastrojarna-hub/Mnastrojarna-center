/**
 * Logo SVG v razítku (vlna 22, bod 22j) – bez prohlížeče a bez závislostí.
 *
 * Dřív se SVG v prohlížeči převedlo přes canvas na PNG (vektor se do dokumentu neuložil) a v CLI skončilo ✗ „logo SVG jde
 * převést jen v prohlížeči“. Teď:
 * - `sanitizeSvg` – očištěné SVG (bez skriptů, `foreignObject`, obsluh `on…`, vnějších odkazů) se uloží do loga
 *   (`TitleLogo.svg`, data URL) – do dokumentu, sdílení i textového skriptu;
 * - `svgShapes` – vyplněné tvary (rect, circle, ellipse, polygon, polyline, line, path vč. oblouků a křivek, skupiny
 *   s transformací a výplní, styl `fill:`) jako mnohoúhelníky v px loga – PDF je kreslí jako vektor (`svgPdfPaths`),
 *   `rasterShapes` z nich bez prohlížeče udělá PNG náhled a obrys pro DXF / DWG (stejný `traceLogo` jako u PNG);
 * - co podmnožina neumí (gradienty, text, obrázky v SVG), vynechá a ohlásí – v prohlížeči se náhled dělá canvasem.
 */
import type { Vec2 } from "./types";

export type SvgShape = { polys: Vec2[][]; fill: string; rule: "nonzero" | "evenodd" };
export type SvgDoc = { w: number; h: number; shapes: SvgShape[]; skipped: string[] };

const DANGER_TAGS = /<(script|foreignObject|iframe|object|embed)\b[\s\S]*?(<\/\1\s*>|\/>)/gi;

/** Očištěné SVG: bez skriptů, vložených dokumentů, obsluh událostí a vnějších odkazů. Chyba = není SVG. */
export function sanitizeSvg(text: string): string {
  let s = text.replace(/^﻿/, "");
  const i = s.search(/<svg[\s>]/i);
  if (i < 0) throw new Error("svg");
  s = s.slice(i);
  const end = s.toLowerCase().lastIndexOf("</svg>");
  if (end >= 0) s = s.slice(0, end + 6);
  s = s.replace(DANGER_TAGS, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // vnější odkazy (http, file, javascript) pryč; vnitřní #id a data:image zůstávají
  s = s.replace(/\s(xlink:href|href)\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, _a, _b, d1, d2) => {
    const v = String(d1 ?? d2 ?? "").trim();
    return v.startsWith("#") || /^data:image\/(png|jpe?g|gif|webp);/i.test(v) ? m : "";
  });
  s = s.replace(/url\(\s*['"]?\s*(?!#)[^)]*\)/gi, "none");
  return s;
}

// ---------------------------------------------------------------- barvy

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00", gray: "#808080", grey: "#808080",
  silver: "#c0c0c0", maroon: "#800000", navy: "#000080", orange: "#ffa500", purple: "#800080", teal: "#008080", lime: "#00ff00", aqua: "#00ffff",
  fuchsia: "#ff00ff", olive: "#808000", darkred: "#8b0000", darkgray: "#a9a9a9", darkgrey: "#a9a9a9", lightgray: "#d3d3d3", lightgrey: "#d3d3d3",
};
/** barva SVG → #rrggbb; „none“ / neznámá → null */
export function parseColor(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (!s || s === "none" || s === "transparent") return null;
  if (NAMED[s]) return NAMED[s];
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return "#" + m[1].split("").map((c) => c + c).join("");
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return "#" + m[1];
  m = /^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)/.exec(s);
  if (m) {
    const c = (x: string) => Math.max(0, Math.min(255, Math.round(x.endsWith("%") ? (parseFloat(x) * 255) / 100 : parseFloat(x))));
    return "#" + [m[1], m[2], m[3]].map((x) => c(x).toString(16).padStart(2, "0")).join("");
  }
  return null;
}

// ---------------------------------------------------------------- transformace

type M = [number, number, number, number, number, number]; // a b c d e f
const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (p: M, q: M): M => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
const apply = (m: M, p: Vec2): Vec2 => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const nums = (s: string) => (s.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) ?? []).map(Number);
export function parseTransform(t: string | undefined): M {
  let m: M = ID;
  if (!t) return m;
  for (const [, fn, args] of t.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = nums(args);
    let q: M = ID;
    if (fn === "matrix" && a.length >= 6) q = [a[0], a[1], a[2], a[3], a[4], a[5]];
    else if (fn === "translate") q = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === "scale") q = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === "rotate") {
      const r = ((a[0] ?? 0) * Math.PI) / 180;
      const [c, s] = [Math.cos(r), Math.sin(r)];
      q = [c, s, -s, c, 0, 0];
      if (a.length >= 3) q = mul(mul([1, 0, 0, 1, a[1], a[2]], q), [1, 0, 0, 1, -a[1], -a[2]]);
    } else if (fn === "skewX") q = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (fn === "skewY") q = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, q);
  }
  return m;
}

// ---------------------------------------------------------------- cesty

/** `d` cesty SVG → uzavřené / otevřené podcesty jako lomené čáry (křivky a oblouky rozdělené na úsečky) */
export function pathPolys(d: string): Vec2[][] {
  const toks = d.match(/[a-df-z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) ?? [];
  const out: Vec2[][] = [];
  let cur: Vec2[] = [];
  let p: Vec2 = [0, 0];
  let start: Vec2 = [0, 0];
  let lastC: Vec2 | null = null;
  let lastQ: Vec2 | null = null;
  let i = 0;
  let cmd = "";
  const n = () => Number(toks[i++]);
  const isNum = () => i < toks.length && !/^[a-z]$/i.test(toks[i]);
  const flush = () => {
    if (cur.length > 1) out.push(cur);
    cur = [];
  };
  const cubic = (c1: Vec2, c2: Vec2, e: Vec2) => {
    const s = p;
    for (let k = 1; k <= 12; k++) {
      const t = k / 12;
      const u = 1 - t;
      cur.push([u * u * u * s[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * e[0], u * u * u * s[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * e[1]]);
    }
  };
  const quad = (c: Vec2, e: Vec2) => {
    const s = p;
    for (let k = 1; k <= 10; k++) {
      const t = k / 10;
      const u = 1 - t;
      cur.push([u * u * s[0] + 2 * u * t * c[0] + t * t * e[0], u * u * s[1] + 2 * u * t * c[1] + t * t * e[1]]);
    }
  };
  const arc = (rx: number, ry: number, phi: number, large: number, sweep: number, e: Vec2) => {
    const s = p;
    if (!rx || !ry) return void cur.push(e);
    const r = (phi * Math.PI) / 180;
    const [cs, sn] = [Math.cos(r), Math.sin(r)];
    const dx = (s[0] - e[0]) / 2;
    const dy = (s[1] - e[1]) / 2;
    const x1 = cs * dx + sn * dy;
    const y1 = -sn * dx + cs * dy;
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lam > 1) {
      rx *= Math.sqrt(lam);
      ry *= Math.sqrt(lam);
    }
    const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / (den || 1)));
    const cx1 = (co * rx * y1) / ry;
    const cy1 = (-co * ry * x1) / rx;
    const cx = cs * cx1 - sn * cy1 + (s[0] + e[0]) / 2;
    const cy = sn * cx1 + cs * cy1 + (s[1] + e[1]) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
    let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    const segs = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 12)));
    for (let k = 1; k <= segs; k++) {
      const t = t1 + (dt * k) / segs;
      cur.push([cx + rx * Math.cos(t) * cs - ry * Math.sin(t) * sn, cy + rx * Math.cos(t) * sn + ry * Math.sin(t) * cs]);
    }
  };
  while (i < toks.length) {
    if (/^[a-z]$/i.test(toks[i])) cmd = toks[i++];
    else if (!cmd) {
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const R = (x: number, y: number): Vec2 => (rel ? [p[0] + x, p[1] + y] : [x, y]);
    switch (cmd.toUpperCase()) {
      case "M": {
        flush();
        p = R(n(), n());
        start = p;
        cur.push(p);
        cmd = rel ? "l" : "L";
        break;
      }
      case "L":
        p = R(n(), n());
        cur.push(p);
        break;
      case "H":
        p = [rel ? p[0] + n() : n(), p[1]];
        cur.push(p);
        break;
      case "V":
        p = [p[0], rel ? p[1] + n() : n()];
        cur.push(p);
        break;
      case "C": {
        const c1 = R(n(), n());
        const c2 = R(n(), n());
        const e = R(n(), n());
        cubic(c1, c2, e);
        lastC = c2;
        p = e;
        break;
      }
      case "S": {
        const c1: Vec2 = lastC ? [2 * p[0] - lastC[0], 2 * p[1] - lastC[1]] : p;
        const c2 = R(n(), n());
        const e = R(n(), n());
        cubic(c1, c2, e);
        lastC = c2;
        p = e;
        break;
      }
      case "Q": {
        const c = R(n(), n());
        const e = R(n(), n());
        quad(c, e);
        lastQ = c;
        p = e;
        break;
      }
      case "T": {
        const c: Vec2 = lastQ ? [2 * p[0] - lastQ[0], 2 * p[1] - lastQ[1]] : p;
        const e = R(n(), n());
        quad(c, e);
        lastQ = c;
        p = e;
        break;
      }
      case "A": {
        const [rx, ry, phi, la, sw] = [n(), n(), n(), n(), n()];
        const e = R(n(), n());
        arc(rx, ry, phi, la, sw, e);
        p = e;
        break;
      }
      case "Z":
        if (cur.length) cur.push(start);
        p = start;
        flush();
        cur = [p];
        break;
      default:
        i++;
    }
    if (!/[CS]/i.test(cmd)) lastC = null;
    if (!/[QT]/i.test(cmd)) lastQ = null;
    // opakovaný příkaz bez písmene: pokračuje se stejným (po M jako L)
    if (cmd.toUpperCase() === "Z" && isNum()) cmd = rel ? "l" : "L";
  }
  flush();
  return out;
}

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[2] ?? m[3]) : undefined;
};
const styleProp = (tag: string, name: string): string | undefined => {
  const st = attr(tag, "style");
  const m = st ? new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i").exec(st) : null;
  return m ? m[1].trim() : undefined;
};
const prop = (tag: string, name: string) => styleProp(tag, name) ?? attr(tag, name);
const len = (v: string | undefined, ref = 0): number | undefined => {
  if (v === undefined) return undefined;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|pt|mm|cm|in|%)?\s*$/i.exec(v);
  if (!m) return undefined;
  const x = Number(m[1]);
  const u = (m[2] ?? "px").toLowerCase();
  return u === "%" ? (x * ref) / 100 : u === "pt" ? x * (4 / 3) : u === "mm" ? x * (96 / 25.4) : u === "cm" ? x * (96 / 2.54) : u === "in" ? x * 96 : x;
};
const ellipsePts = (cx: number, cy: number, rx: number, ry: number): Vec2[] => {
  const out: Vec2[] = [];
  for (let k = 0; k <= 48; k++) out.push([cx + rx * Math.cos((k / 48) * 2 * Math.PI), cy + ry * Math.sin((k / 48) * 2 * Math.PI)]);
  return out;
};

/** Rozměr loga v px (width / height, jinak viewBox; výchozí 300 × 150) a tvary s výplní v px loga. */
export function svgShapes(svgText: string): SvgDoc {
  const svg = sanitizeSvg(svgText);
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "<svg>";
  const vb = nums(attr(root, "viewBox") ?? "");
  const vbox = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb : null;
  let w = len(attr(root, "width"), vbox?.[2] ?? 300) ?? vbox?.[2] ?? 300;
  let h = len(attr(root, "height"), vbox?.[3] ?? 150) ?? vbox?.[3] ?? 150;
  if (!(w > 0)) w = 300;
  if (!(h > 0)) h = 150;
  // viewBox → px loga (preserveAspectRatio xMidYMid meet)
  let base: M = ID;
  if (vbox) {
    const k = Math.min(w / vbox[2], h / vbox[3]);
    base = [k, 0, 0, k, (w - vbox[2] * k) / 2 - vbox[0] * k, (h - vbox[3] * k) / 2 - vbox[1] * k];
  }
  const shapes: SvgShape[] = [];
  const skipped = new Set<string>();
  type Frame = { m: M; fill: string | null | undefined; rule?: "nonzero" | "evenodd"; hidden: boolean; defs: boolean };
  const stack: Frame[] = [{ m: base, fill: "#000000", hidden: false, defs: false }];
  const top = () => stack[stack.length - 1];
  for (const t of svg.matchAll(/<\/?([a-zA-Z][\w:-]*)\b[^>]*?\/?>/g)) {
    const tag = t[0];
    const name = t[1].toLowerCase();
    if (name === "svg" && tag.startsWith("<svg")) continue;
    if (tag.startsWith("</")) {
      if (["g", "defs", "a", "symbol", "clippath", "mask", "pattern", "lineargradient", "radialgradient"].includes(name) && stack.length > 1) stack.pop();
      continue;
    }
    const self = tag.endsWith("/>");
    const f = top();
    const fillV = prop(tag, "fill");
    const fill = fillV === undefined || fillV === "inherit" ? f.fill : fillV.startsWith("url(") ? (skipped.add("gradient"), "#808080") : parseColor(fillV);
    const ruleV = prop(tag, "fill-rule");
    const rule = ruleV === "evenodd" ? "evenodd" : ruleV === "nonzero" ? "nonzero" : f.rule;
    const hidden = f.hidden || prop(tag, "display") === "none" || prop(tag, "visibility") === "hidden";
    const m = mul(f.m, parseTransform(attr(tag, "transform")));
    if (["g", "a", "defs", "symbol", "clippath", "mask", "pattern", "lineargradient", "radialgradient"].includes(name)) {
      if (!self) stack.push({ m, fill, rule, hidden, defs: f.defs || (name !== "g" && name !== "a") });
      continue;
    }
    if (f.defs || hidden) continue;
    let polys: Vec2[][] = [];
    const A = (k: string) => Number(attr(tag, k) ?? 0) || 0;
    switch (name) {
      case "rect": {
        const [x, y, rw, rh] = [A("x"), A("y"), len(attr(tag, "width"), w) ?? 0, len(attr(tag, "height"), h) ?? 0];
        if (rw > 0 && rh > 0) polys = [[[x, y], [x + rw, y], [x + rw, y + rh], [x, y + rh], [x, y]]];
        break;
      }
      case "circle":
        if (A("r") > 0) polys = [ellipsePts(A("cx"), A("cy"), A("r"), A("r"))];
        break;
      case "ellipse":
        if (A("rx") > 0 && A("ry") > 0) polys = [ellipsePts(A("cx"), A("cy"), A("rx"), A("ry"))];
        break;
      case "polygon":
      case "polyline": {
        const v = nums(attr(tag, "points") ?? "");
        const pts: Vec2[] = [];
        for (let k = 0; k + 1 < v.length; k += 2) pts.push([v[k], v[k + 1]]);
        if (pts.length > 2) polys = [[...pts, pts[0]]];
        break;
      }
      case "path":
        polys = pathPolys(attr(tag, "d") ?? "");
        break;
      case "line":
      case "title":
      case "desc":
      case "metadata":
      case "style":
      case "stop":
        break;
      case "text":
      case "tspan":
      case "image":
      case "use":
        skipped.add(name);
        break;
      default:
        break;
    }
    if (!polys.length || !fill) continue;
    shapes.push({ polys: polys.map((pl) => pl.map((q) => apply(m, q))), fill, rule: rule ?? "nonzero" });
  }
  return { w, h, shapes, skipped: [...skipped] };
}

/**
 * Rastr RGBA (bílé pozadí) z tvarů – vyplnění řádků (scanline) s pravidlem nonzero / evenodd, 2× nadvzorkování svisle.
 * Bez prohlížeče: náhled PNG a podklad obrysu pro DXF / DWG.
 */
export function rasterShapes(doc: Pick<SvgDoc, "w" | "h" | "shapes">, W: number, H: number): { w: number; h: number; rgba: Uint8Array } {
  const rgba = new Uint8Array(W * H * 4).fill(255);
  const kx = W / doc.w;
  const ky = H / doc.h;
  for (const sh of doc.shapes) {
    const col = parseColor(sh.fill) ?? "#000000";
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(col.slice(i, i + 2), 16));
    const edges: [number, number, number, number, number][] = []; // x0 y0 x1 y1 dir
    for (const pl of sh.polys)
      for (let i = 0; i + 1 < pl.length; i++) {
        const [a, c] = [pl[i], pl[i + 1]];
        if (a[1] === c[1]) continue;
        edges.push(a[1] < c[1] ? [a[0] * kx, a[1] * ky, c[0] * kx, c[1] * ky, 1] : [c[0] * kx, c[1] * ky, a[0] * kx, a[1] * ky, -1]);
      }
    for (let y = 0; y < H; y++) {
      const cov = new Float32Array(W);
      for (const sy of [y + 0.25, y + 0.75]) {
        const xs: [number, number][] = [];
        for (const e of edges) if (sy >= e[1] && sy < e[3]) xs.push([e[0] + ((sy - e[1]) * (e[2] - e[0])) / (e[3] - e[1]), e[4]]);
        xs.sort((p, q) => p[0] - q[0]);
        let wind = 0;
        for (let k = 0; k + 1 < xs.length; k++) {
          wind += xs[k][1];
          const inside = sh.rule === "evenodd" ? (k + 1) % 2 === 1 : wind !== 0;
          if (!inside) continue;
          const x0 = Math.max(0, Math.round(xs[k][0]));
          const x1 = Math.min(W, Math.round(xs[k + 1][0]));
          for (let x = x0; x < x1; x++) cov[x] += 0.5;
        }
      }
      for (let x = 0; x < W; x++) {
        const a = Math.min(1, cov[x]);
        if (!a) continue;
        const o = (y * W + x) * 4;
        rgba[o] = Math.round(rgba[o] * (1 - a) + r * a);
        rgba[o + 1] = Math.round(rgba[o + 1] * (1 - a) + g * a);
        rgba[o + 2] = Math.round(rgba[o + 2] * (1 - a) + b * a);
      }
    }
  }
  return { w: W, h: H, rgba };
}

/** Tvary loga v mm listu pro vektorový PDF (obdélník obrázku x, y, w, h; zachová poměr stran jako `<image>` meet). */
export function svgPdfPaths(svgText: string, x: number, y: number, w: number, h: number): { polys: Vec2[][]; fill: string; rule: "nonzero" | "evenodd" }[] {
  const d = svgShapes(svgText);
  const k = Math.min(w / d.w, h / d.h);
  const ox = x + (w - d.w * k) / 2;
  const oy = y + (h - d.h * k) / 2;
  return d.shapes.map((s) => ({ ...s, polys: s.polys.map((pl) => pl.map((q) => [ox + q[0] * k, oy + q[1] * k] as Vec2)) }));
}
