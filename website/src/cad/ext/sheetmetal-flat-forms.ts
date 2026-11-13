/**
 * Rozvin plechu – tvářecí nástroje a křížový zlom (čistá 2D část bez OCCT). Tvářené prvky se do rozvinu nerozvíjejí
 * (jako SolidWorks): ve vrstvě FORM se kreslí jejich stopa (obrys tvarované oblasti), štěrbiny prostřihu, středová značka
 * a popis; křížový zlom jako tenké úhlopříčky panelu s poznámkou „KŘÍŽOVÝ ZLOM“. Tabulka ohybů je vypíše pod ohyby.
 *
 * Poloha nástroje: body umístění ([x, y] v rovině plochy nebo [x, y, z]) na rovině plochy – uložené (`faceGeom` z formuláře),
 * dodané resolverem (jádro, UI přes jádro), nebo výchozí horní plocha základního plechu. Panel rozvinu se najde podle bodu.
 */
import { tr } from "../i18n";
import type { Seg } from "../sketch";
import type { CadDoc, Feature, Vec2, Vec3 } from "../types";
import { CROSS_BREAK_EXT, circleSegs, formFootprint, formPoints, formSection, formSummary, formToolLabel, formToolOf, pointOnPlane, sketchChains, tangentAt, toolAxes, type FormTool } from "./sheetmetal-form-geom";

export type FlatForm = {
  /** pořadové číslo (T1, T2 … / Z1 …) */
  n: number;
  feature: string;
  name: string;
  tool: FormTool | "crossbreak";
  label: string;
  summary: string;
  dir: "up" | "down";
  /** středy (body umístění) v rozvinu */
  centers: Vec2[];
  /** obrys, štěrbiny a pomocné kružnice v rozvinu */
  segs: Seg[];
  /** úhlopříčky křížového zlomu */
  lines: [Vec2, Vec2][];
  /** velikost středové značky / písma */
  size: number;
  note?: string;
};

type PanelHit = { id: string; N: Vec3; flip: boolean; outline?: Vec2[]; toFlat: (p: Vec3) => Vec2 };
export type FormCtx = {
  t: number;
  doc: CadDoc;
  findPanel: (pts: Vec3[], within: boolean) => PanelHit | null;
  basePlane: { origin: Vec3; normal: Vec3 };
  resolveFace: (featureIndex: number, faceIndex: number) => Promise<{ origin: Vec3; normal: Vec3 } | null> | { origin: Vec3; normal: Vec3 } | null;
  warn: (w: string) => void;
  push: (f: FlatForm) => void;
};

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const isV3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));
const mapSeg = (s: Seg, f: (p: Vec2) => Vec2): Seg => (s.kind === "line" ? { kind: "line", a: f(s.a), b: f(s.b) } : { kind: "arc", a: f(s.a), m: f(s.m), b: f(s.b) });
const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

/** Rovina plochy prvku: uložená geometrie (formulář), resolver (jádro), jinak horní plocha základního plechu. */
async function planeOf(c: FormCtx, f: Extract<Feature, { type: "ext" }>, index: number): Promise<{ origin: Vec3; normal: Vec3 } | null> {
  const d = f.data ?? {};
  const fg = d.faceGeom as { origin?: unknown; normal?: unknown } | undefined;
  const faces = (Array.isArray(d.face) ? d.face : []).filter((x): x is number => typeof x === "number");
  if (!faces.length) return c.basePlane;
  if (fg && isV3(fg.origin) && isV3(fg.normal)) return { origin: fg.origin, normal: fg.normal };
  return (await c.resolveFace(index, faces[0])) ?? null;
}

/** Přidá do rozvinu stopu tvářecího nástroje / křížového zlomu prvku `f` (index v historii `index`). */
export async function flatForms(c: FormCtx, f: Extract<Feature, { type: "ext" }>, index: number, sp: { t: number; r: number }): Promise<void> {
  const d = f.data ?? {};
  const pl = await planeOf(c, f, index);
  if (!pl) {
    c.warn(tr("{0}: polohu plochy se nepodařilo určit – v rozvinu vynechán (otevřete prvek ve formuláři, uloží polohu plochy).", f.name));
    return;
  }
  const n = pl.normal;
  const up = d.direction !== "down";
  if (f.ext === CROSS_BREAK_EXT) {
    const hit = c.findPanel([pl.origin], true);
    if (!hit?.outline || hit.outline.length < 3) {
      c.warn(tr("{0}: panel křížového zlomu se v rozvinu nenašel – vynechán.", f.name));
      return;
    }
    const o = hit.outline;
    let cx = 0;
    let cy = 0;
    let A = 0;
    for (let i = 0; i < o.length; i++) {
      const [x1, y1] = o[i];
      const [x2, y2] = o[(i + 1) % o.length];
      const k = x1 * y2 - x2 * y1;
      A += k;
      cx += (x1 + x2) * k;
      cy += (y1 + y2) * k;
    }
    const ctr: Vec2 = [cx / (3 * A), cy / (3 * A)];
    const lines: [Vec2, Vec2][] = o.length === 4 ? [[o[0], o[2]], [o[1], o[3]]] : o.map((p) => [p, ctr] as [Vec2, Vec2]);
    const sgn = (dot(n, hit.N) >= 0 ? 1 : -1) * (up ? 1 : -1) * (hit.flip ? -1 : 1);
    const angle = num(d.angle, 1.5);
    const span = Math.min(...lines.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1])));
    c.push({ n: c.doc.features.slice(0, index + 1).filter((x) => x.type === "ext" && x.ext === CROSS_BREAK_EXT && !x.suppressed).length, feature: f.id, name: f.name, tool: "crossbreak", label: tr("Křížový zlom"), summary: tr("{0}°", fmt(angle)), dir: sgn > 0 ? "up" : "down", centers: [ctr], segs: [], lines, size: Math.max(2, Math.min(6, span / 25)) });
    return;
  }
  const tool = formToolOf(f.ext);
  if (!tool) return;
  const nTool = c.doc.features.slice(0, index + 1).filter((x) => x.type === "ext" && formToolOf(x.ext) && !x.suppressed).length;
  const base: Omit<FlatForm, "dir" | "centers" | "segs" | "lines" | "size"> = { n: nTool, feature: f.id, name: f.name, tool, label: formToolLabel(tool), summary: formSummary(tool, d, c.t) };
  let sec;
  try {
    sec = formSection(tool, d, c.t, sp.r);
  } catch (e) {
    c.warn(`${f.name}: ${(e as Error).message}`);
    return;
  }
  const segs: Seg[] = [];
  const centers: Vec2[] = [];
  let dirSign = 0;
  if (tool === "bead") {
    const sk = c.doc.features.find((x) => x.id === d.sketchId && x.type === "sketch") as Extract<Feature, { type: "sketch" }> | undefined;
    if (!sk) {
      c.warn(tr("{0}: bez skici dráhy – v rozvinu vynechán.", f.name));
      return;
    }
    const chains = sketchChains(sk, (q) => pointOnPlane(q, pl.origin, n), n);
    const w = sec.s1;
    const first = chains[0]?.segs[0]?.a;
    const hit = first ? c.findPanel([first], true) : null;
    if (!hit) {
      c.warn(tr("{0}: dráha žebra neleží na rovné ploše plechu – v rozvinu vynechána.", f.name));
      return;
    }
    dirSign = (dot(n, hit.N) >= 0 ? 1 : -1) * (up ? 1 : -1) * (hit.flip ? -1 : 1);
    const F = hit.toFlat;
    for (const ch of chains) {
      const k = ch.segs.length;
      // posun konců bočních čar v rozích (pokos): vnitřní strana se zkrátí, vnější prodlouží
      const turnAt = (i: number) => {
        const d1 = tangentAt(ch.segs[i], true, n);
        const d2 = tangentAt(ch.segs[(i + 1) % k], false, n);
        const cr = dot(cross(d1, d2), n);
        const cos = Math.max(-1, Math.min(1, dot(d1, d2)));
        return { e: w * Math.tan(Math.acos(cos) / 2), left: cr > 0 };
      };
      for (let i = 0; i < k; i++) {
        const s = ch.segs[i];
        segs.push(s.kind === "line" ? { kind: "line", a: F(s.a), b: F(s.b) } : { kind: "arc", a: F(s.a), m: F(s.m), b: F(s.b) });
        if (s.kind === "line") {
          const dl = tangentAt(s, false, n);
          const sl = cross(n, dl);
          const jin = i > 0 || ch.closed ? turnAt((i - 1 + k) % k) : null;
          const jout = i < k - 1 || ch.closed ? turnAt(i) : null;
          for (const side of [1, -1]) {
            // levá strana (side 1) je v levotočivém rohu vnitřní
            const startShift = jin ? (jin.left === (side === 1) ? jin.e : -jin.e) : 0;
            const endShift = jout ? (jout.left === (side === 1) ? -jout.e : jout.e) : 0;
            const a = add(add(s.a, mul(sl, side * w)), mul(dl, startShift));
            const b = add(add(s.b, mul(sl, side * w)), mul(dl, endShift));
            segs.push({ kind: "line", a: F(a), b: F(b) });
          }
        } else {
          for (const side of [1, -1]) {
            const off = (p: Vec3) => {
              const rad = sub(p, s.c);
              const l = Math.hypot(...rad) || 1;
              return add(s.c, mul(rad, (l + side * w) / l));
            };
            segs.push({ kind: "arc", a: F(off(s.a)), m: F(off(s.m)), b: F(off(s.b)) });
          }
        }
      }
      if (!ch.closed) {
        // zaoblené konce
        const cap = (p: Vec3, dOut: Vec3) => {
          const sl = cross(n, dOut);
          segs.push({ kind: "arc", a: F(add(p, mul(sl, w))), m: F(add(p, mul(dOut, w))), b: F(add(p, mul(sl, -w))) });
        };
        cap(ch.segs[0].a, mul(tangentAt(ch.segs[0], false, n), -1));
        cap(ch.segs[k - 1].b, tangentAt(ch.segs[k - 1], true, n));
      }
      centers.push(F(ch.segs[0].a));
    }
  } else {
    let pts: number[][];
    try {
      pts = formPoints(d.points);
    } catch (e) {
      c.warn(`${f.name}: ${(e as Error).message}`);
      return;
    }
    const { u, v } = toolAxes(n, num(d.rotation, 0));
    const fp = formFootprint(tool, d, c.t, sp.r);
    for (const q of pts) {
      const P = pointOnPlane(q, pl.origin, n);
      const hit = c.findPanel([P], true);
      if (!hit) {
        c.warn(tr("{0}: bod [{1}] neleží na rovné ploše plechu – v rozvinu vynechán.", f.name, q.map(fmt).join("; ")));
        continue;
      }
      dirSign = (dot(n, hit.N) >= 0 ? 1 : -1) * (up ? 1 : -1) * (hit.flip ? -1 : 1);
      const F = (p: Vec2): Vec2 => hit.toFlat(add(P, add(mul(u, p[0]), mul(v, p[1]))));
      segs.push(...fp.outline.map((s) => mapSeg(s, F)), ...fp.slits.map((s) => mapSeg(s, F)));
      for (const cc of fp.circles) segs.push(...circleSegs([0, 0], cc.r).map((s) => mapSeg(s, F)));
      centers.push(F([0, 0]));
    }
    if (fp.preHole != null) {
      const dm = num(d.diameter, 10) + c.t;
      base.note = fp.preHole / dm < 0.45 ? tr("předděr ≈ Ø{0} mm (orientačně) – vysoký límec, hrozí trhliny (d0/d < 0,45)", fmt(fp.preHole)) : tr("předděr ≈ Ø{0} mm (orientačně)", fmt(fp.preHole));
    }
  }
  if (!centers.length) return;
  const size = Math.max(1, Math.min(4, (sec.s1 - sec.s0) / 4 || 2));
  c.push({ ...base, dir: dirSign >= 0 ? "up" : "down", centers, segs, lines: [], size });
}
const tag = (f: FlatForm) => (f.tool === "crossbreak" ? `Z${f.n}` : `T${f.n}`);
const upDown = (f: FlatForm) => (f.dir === "up" ? tr("nahoru") : tr("dolů"));

/** Řádky tabulky tvarování (pod tabulkou ohybů). */
export function formTableLines(forms: FlatForm[]): string[] {
  if (!forms.length) return [];
  const out = [tr("Tvarování (nerozvinuto, vrstva FORM):")];
  for (const f of forms) {
    if (f.tool === "crossbreak") out.push(tr("{0}: KŘÍŽOVÝ ZLOM {1}, {2} ({3})", tag(f), f.summary, upDown(f), f.name));
    else out.push(tr("{0}: {1} – {2}, {3}, {4} ks ({5}){6}", tag(f), f.label, f.summary, upDown(f), f.centers.length, f.name, f.note ? `, ${f.note}` : ""));
  }
  return out;
}

/** DXF: obrys, značky a popisy ve vrstvě FORM. */
export function formsDxf(forms: FlatForm[], seg: (s: Seg, layer: string) => void, text: (x: number, y: number, h: number, s: string) => void, line: (a: Vec2, b: Vec2) => void, t: number): void {
  const uni = (s: string) => s.replace(/[^\x20-\x7e]/g, (ch) => `\\U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
  for (const f of forms) {
    for (const s of f.segs) seg(s, "FORM");
    for (const [a, b] of f.lines) line(a, b);
    const h = Math.max(1.5, Math.min(3.5, t * 1.2));
    for (const c of f.centers) {
      const m = f.size;
      if (f.tool !== "crossbreak") {
        line([c[0] - m, c[1]], [c[0] + m, c[1]]);
        line([c[0], c[1] - m], [c[0], c[1] + m]);
      }
      text(c[0] + m * 0.6, c[1] + m * 0.6, h, uni(f.tool === "crossbreak" ? tr("KŘÍŽOVÝ ZLOM {0} {1}", f.summary, f.dir === "up" ? tr("NAHORU") : tr("DOLŮ")) : `${tag(f)} ${f.label.toUpperCase()}`));
    }
  }
}

/** SVG: zelené tenké čáry a popisy. */
export function formsSvg(forms: FlatForm[], X: (x: number) => number, Y: (y: number) => number, esc: (s: string) => string): string[] {
  const out: string[] = [];
  const col = "#15803d";
  const r3 = (v: number) => v.toFixed(3);
  for (const f of forms) {
    let d = "";
    for (const s of f.segs) {
      d += ` M${r3(X(s.a[0]))} ${r3(Y(s.a[1]))}`;
      if (s.kind === "line") d += ` L${r3(X(s.b[0]))} ${r3(Y(s.b[1]))}`;
      else {
        // oblouk třemi body → kruhový oblouk SVG
        const [a, m, b] = [s.a, s.m, s.b];
        const den = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
        if (Math.abs(den) < 1e-12) {
          d += ` L${r3(X(b[0]))} ${r3(Y(b[1]))}`;
          continue;
        }
        const a2 = a[0] ** 2 + a[1] ** 2;
        const m2 = m[0] ** 2 + m[1] ** 2;
        const b2 = b[0] ** 2 + b[1] ** 2;
        const cx = (a2 * (m[1] - b[1]) + m2 * (b[1] - a[1]) + b2 * (a[1] - m[1])) / den;
        const cy = (a2 * (b[0] - m[0]) + m2 * (a[0] - b[0]) + b2 * (m[0] - a[0])) / den;
        const rr = Math.hypot(a[0] - cx, a[1] - cy);
        const ccw = (m[0] - a[0]) * (b[1] - a[1]) - (m[1] - a[1]) * (b[0] - a[0]) > 0;
        const ang = (p: Vec2) => Math.atan2(p[1] - cy, p[0] - cx);
        let sweepAng = ccw ? ang(b) - ang(a) : ang(a) - ang(b);
        while (sweepAng < 0) sweepAng += 2 * Math.PI;
        // osa y v SVG je obrácená → směr oblouku se otočí
        d += ` A${r3(rr)} ${r3(rr)} 0 ${sweepAng > Math.PI ? 1 : 0} ${ccw ? 0 : 1} ${r3(X(b[0]))} ${r3(Y(b[1]))}`;
      }
    }
    for (const [a, b] of f.lines) d += ` M${r3(X(a[0]))} ${r3(Y(a[1]))} L${r3(X(b[0]))} ${r3(Y(b[1]))}`;
    for (const c of f.centers) {
      const m = f.size;
      if (f.tool !== "crossbreak") d += ` M${r3(X(c[0] - m))} ${r3(Y(c[1]))} L${r3(X(c[0] + m))} ${r3(Y(c[1]))} M${r3(X(c[0]))} ${r3(Y(c[1] - m))} L${r3(X(c[0]))} ${r3(Y(c[1] + m))}`;
    }
    out.push(`<path data-form="${f.tool}" d="${d.trim()}" fill="none" stroke="${col}" stroke-width="0.25"/>`);
    for (const c of f.centers) {
      const label = f.tool === "crossbreak" ? tr("KŘÍŽOVÝ ZLOM {0} {1}", f.summary, f.dir === "up" ? tr("NAHORU") : tr("DOLŮ")) : `${tag(f)} ${f.label}`;
      out.push(`<text x="${r3(X(c[0] + f.size * 0.6))}" y="${r3(Y(c[1] + f.size * 0.6))}" font-size="2.5" fill="${col}">${esc(label)}</text>`);
    }
  }
  return out;
}
