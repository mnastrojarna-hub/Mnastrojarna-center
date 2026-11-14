/**
 * BALÍK 2 (annot) – geometrie kót: z definičních bodů a kótovacího stylu sestaví dílčí entity (kótovací a vynášecí
 * čáry, oblouky, šipky, text MTEXT, rámeček, značka středu). Stejné díly kreslí obrazovka (prims), vrací rozložení
 * (EXPLODE) a zapíše balík 4 do anonymního bloku kóty (*D) – výkres v DWG vypadá stejně jako v aplikaci.
 *
 * Kóta je asociativní na definiční body: hodnota se počítá vždy znovu (posun bodu = nová hodnota).
 */
import { add, angleOf, cross, deg, dist, dot, len, mul, normA, polar, rad, rot90, sub, TAU, unit } from "../geom";
import type { KindCtx } from "../kinds";
import type { DraftColor, DraftLw, NewEntity, Vec2 } from "../model";
import { annoScaleOf, isAnnotative } from "./anno";
import { dimValueText, resolveDimStyle, type DimStyleVars } from "./dimstyle";
import { layoutMText, mtextBase, parseMText } from "./mtext";
import type { DDimension } from "./types";
import { readableAngle } from "./util";

// ---------------------------------------------------------------- šipky

export const ARROWS = ["", "_CLOSEDBLANK", "_CLOSED", "_OPEN", "_OPEN30", "_OPEN90", "_OBLIQUE", "_ARCHTICK", "_DOT", "_DOTSMALL", "_DOTBLANK", "_SMALL", "_ORIGIN", "_NONE"] as const;
type Style = { color?: DraftColor; lineweight?: DraftLw };
const sty = (color?: DraftColor, lw?: number | "ByLayer" | "ByBlock"): Style => ({ ...(color !== undefined && color !== "ByBlock" ? { color } : {}), ...(lw !== undefined && lw !== "ByBlock" ? { lineweight: lw } : {}) });

/** šipka s hrotem `tip`; tělo šipky leží ve směru `dir` od hrotu (podél čáry) */
export function arrowParts(out: NewEntity[], tip: Vec2, dir: Vec2, size: number, blk: string | undefined, s: Style = {}) {
  if (!(size > 0)) return;
  const b = (blk ?? "").toUpperCase().replace(/^_?CLOSEDFILLED$/, "");
  const d = unit(dir);
  const n = rot90(d);
  const back = add(tip, mul(d, size));
  const P = (u: number, v: number): Vec2 => add(tip, add(mul(d, u), mul(n, v)));
  const w = size / 6;
  const circle = (r: number, filled: boolean) => {
    if (filled) out.push({ type: "hatch", pattern: "SOLID", solid: true, scale: 1, angle: 0, loops: [{ pts: [add(tip, [r, 0]), add(tip, [-r, 0])], bulges: [1, 1], outer: true }], ...s } as NewEntity);
    else out.push({ type: "circle", c: tip, r, ...s } as NewEntity);
  };
  switch (b) {
    case "_NONE":
      return;
    case "_CLOSEDBLANK":
    case "_CLOSED":
      out.push({ type: "polyline", pts: [tip, add(back, mul(n, w)), add(back, mul(n, -w))], closed: true, ...s } as NewEntity);
      return;
    case "_OPEN":
    case "_OPEN30":
    case "_OPEN90": {
      const hw = b === "_OPEN30" ? size * Math.tan(rad(15)) : b === "_OPEN90" ? size : w;
      out.push({ type: "line", a: tip, b: add(back, mul(n, hw)), ...s } as NewEntity, { type: "line", a: tip, b: add(back, mul(n, -hw)), ...s } as NewEntity);
      return;
    }
    case "_OBLIQUE":
    case "_ARCHTICK": {
      const h = size / 2;
      out.push({ type: "polyline", pts: [P(h, -h), P(-h, h)], ...(b === "_ARCHTICK" ? { width: size / 10 } : {}), ...s } as NewEntity);
      return;
    }
    case "_DOT":
      return circle(size / 4, true);
    case "_DOTSMALL":
      return circle(size / 16, true);
    case "_DOTBLANK":
    case "_ORIGIN":
      return circle(size / 4, false);
    case "_SMALL":
      return circle(size / 8, false);
    default:
      out.push({ type: "hatch", pattern: "SOLID", solid: true, scale: 1, angle: 0, loops: [{ pts: [tip, add(back, mul(n, w)), add(back, mul(n, -w))], outer: true }], ...s, ext: { dxf: "SOLID" } } as unknown as NewEntity);
  }
}

// ---------------------------------------------------------------- kóta

export type DimGeom = {
  parts: NewEntity[];
  /** naměřená hodnota (mm / °) */
  measured: number;
  /** text a jeho střed */
  text: string;
  textMid: Vec2 | null;
  /** body pro uchopení (definiční body) */
  defs: Vec2[];
};

const ccw = (from: number, to: number) => normA(to - from);
const lineX = (a: Vec2, da: Vec2, b: Vec2, db: Vec2): Vec2 | null => {
  const den = cross(da, db);
  if (Math.abs(den) < 1e-14) return null;
  return add(a, mul(da, cross(sub(b, a), db) / den));
};

/** velikost textu kóty (šířka, výška od nejnižšího účaří po nejvyšší horní okraj) */
export function dimTextSize(s: string, h: number, style: string | undefined, ctx: KindCtx): { w: number; h: number } {
  if (!s) return { w: 0, h: 0 };
  const base = mtextBase({ h, style }, ctx);
  const lay = layoutMText(parseMText(s, base), { width: 0, attach: 5, baseH: h, lineSpacing: 1 });
  if (!lay.glyphs.length) return { w: lay.w, h };
  const top = Math.max(...lay.glyphs.map((g) => g.y + g.st.h));
  const bot = Math.min(...lay.glyphs.map((g) => g.y));
  return { w: lay.w, h: Math.max(h, top - bot) };
}

/** Geometrie kóty ve světových souřadnicích (díly s barvami / tloušťkami stylu, ByBlock = barva kóty). */
/** styl a velikosti kóty po měřítku (DIMSCALE / měřítko poznámek, pevná výška textového stylu) */
export function dimSizes(e: Pick<DDimension, "style" | "overrides" | "annotative">, ctx: KindCtx) {
  const st = resolveDimStyle(ctx.model, e.style, e.overrides);
  const anno = isAnnotative(e) || st.dimanno;
  const k = anno ? annoScaleOf(e, ctx.model) : st.dimscale > 0 ? st.dimscale : annoScaleOf(e, ctx.model);
  const tstyle = st.dimtxsty ? ctx.model.textStyles.find((x) => x.name.toLowerCase() === st.dimtxsty!.toLowerCase()) : undefined;
  const txt = tstyle && tstyle.height > 0 ? tstyle.height : st.dimtxt * k;
  return { st, k, txt, tstyle, gap: Math.abs(st.dimgap) * k, asz: st.dimasz * k };
}

/**
 * Výchozí velikosti nové poznámky (odkaz, tolerance, značka) podle aktuálního kótovacího stylu: u anotativního stylu
 * (DIMANNO) velikosti na papíře (`anno`, při kreslení × měřítko poznámek `kDraw`), jinak ve výkrese (× DIMSCALE).
 */
export function noteSizes(ctx: KindCtx) {
  const s = dimSizes({}, ctx);
  const anno = !!s.st.dimanno;
  const f = anno ? 1 / s.k : 1;
  const fixed = s.tstyle && s.tstyle.height > 0;
  return { st: s.st, anno, kDraw: anno ? s.k : 1, txt: fixed ? s.txt : s.txt * f, asz: s.asz * f, gap: s.gap * f };
}

/** střed textu kóty položeného na čáru směru `lineAng` [rad] v bodě `at` (nad / pod podle DIMTAD); `outward` = text začíná v bodě */
export function dimTextAt(e: DDimension, measured: number, at: Vec2, lineAng: number, ctx: KindCtx, outward = 0): Vec2 {
  const { st, txt, gap } = dimSizes(e, ctx);
  const text = dimValueText(e, measured, st);
  const size = dimTextSize(text, txt, st.dimtxsty, ctx);
  const ang = e.textRot !== undefined ? rad(e.textRot) : readableAngle(lineAng);
  const ld: Vec2 = [Math.cos(lineAng), Math.sin(lineAng)];
  const up = rot90([Math.cos(ang), Math.sin(ang)]);
  const base = add(at, mul(ld, (outward * size.w) / 2));
  if (st.dimtad === 0) return base;
  return add(base, mul(up, (st.dimtad === 4 ? -1 : 1) * (gap + size.h / 2)));
}

export function dimensionGeometry(e: DDimension, ctx: KindCtx): DimGeom {
  const { st, k, txt, tstyle } = dimSizes(e, ctx);
  const asz = st.dimasz * k;
  const exe = st.dimexe * k;
  const exo = st.dimexo * k;
  const gap = Math.abs(st.dimgap) * k;
  const D = sty(st.dimclrd, st.dimlwd);
  const E = sty(st.dimclre, st.dimlwe);
  const T = sty(st.dimclrt);
  const parts: NewEntity[] = [];
  const z: Vec2 = [0, 0];
  const L = (a: Vec2, b: Vec2, s: Style) => {
    if (dist(a, b) > 1e-12) parts.push({ type: "line", a, b, ...s } as NewEntity);
  };
  const blk1 = st.dimblk1 ?? st.dimblk;
  const blk2 = st.dimblk2 ?? st.dimblk;
  const A1 = (tip: Vec2, dir: Vec2) => arrowParts(parts, tip, dir, asz, blk1, D);
  const A2 = (tip: Vec2, dir: Vec2) => arrowParts(parts, tip, dir, asz, blk2, D);
  let measured = 0;
  let text = "";
  let textMid: Vec2 | null = null;
  const defs: Vec2[] = [];

  /** text kóty: střed, natočení [rad]; záporná mezera = rámeček (základní rozměr) */
  const putText = (s: string, mid: Vec2, ang: number, size: { w: number; h: number }) => {
    if (!s) return;
    textMid = mid;
    parts.push({ type: "mtext", p: mid, h: txt, w: 0, s, rot: ((deg(ang) % 360) + 360) % 360, attach: 5, ...(st.dimtxsty ? { style: tstyle?.name ?? st.dimtxsty } : {}), ...T } as NewEntity);
    if (st.dimgap < 0) {
      const d: Vec2 = [Math.cos(ang), Math.sin(ang)];
      const n = rot90(d);
      const hw = size.w / 2 + gap;
      const hh = size.h / 2 + gap;
      const P = (u: number, v: number) => add(mid, add(mul(d, u), mul(n, v)));
      parts.push({ type: "polyline", pts: [P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh)], closed: true, ...D } as NewEntity);
    }
  };
  /** střed textu nad / pod / na kótovací čáře (DIMTAD) v rámu textu */
  const offsetText = (along: Vec2, ang: number, size: { h: number }, centered = false) => {
    const up = rot90([Math.cos(ang), Math.sin(ang)]);
    if (centered || st.dimtad === 0) return along;
    const off = gap + size.h / 2;
    return add(along, mul(up, st.dimtad === 4 ? -off : off));
  };
  const textAngle = (lineAng: number) => (e.textRot !== undefined ? rad(e.textRot) : readableAngle(lineAng));

  switch (e.kind) {
    case "linear":
    case "aligned": {
      const p1 = e.p1 ?? z;
      const p2 = e.p2 ?? z;
      const lp = e.line ?? p2;
      defs.push(p1, p2, lp);
      const dir: Vec2 = e.kind === "aligned" ? (dist(p1, p2) > 1e-12 ? unit(sub(p2, p1)) : [1, 0]) : [Math.cos(rad(e.rot ?? 0)), Math.sin(rad(e.rot ?? 0))];
      const q1 = add(lp, mul(dir, dot(sub(p1, lp), dir)));
      const q2 = add(lp, mul(dir, dot(sub(p2, lp), dir)));
      measured = Math.abs(dot(sub(p2, p1), dir));
      // vynášecí čáry
      [[p1, q1, st.dimse1], [p2, q2, st.dimse2]].forEach(([p, q, sup]) => {
        if (sup) return;
        const v = sub(q as Vec2, p as Vec2);
        const Lv = len(v);
        if (Lv < 1e-12) return;
        const u = mul(v, 1 / Lv);
        const a = st.dimfxlon ? sub(q as Vec2, mul(u, Math.min(Lv, st.dimfxl * k))) : add(p as Vec2, mul(u, Math.min(exo, Lv)));
        L(a, add(q as Vec2, mul(u, exe)), E);
      });
      const dd = dist(q1, q2) > 1e-12 ? unit(sub(q2, q1)) : dir;
      const Lq = dist(q1, q2);
      text = dimValueText(e, measured, st);
      const ang = st.dimtih && Math.abs(dd[1]) > 1e-9 ? 0 : textAngle(angleOf(dd));
      const size = dimTextSize(text, txt, st.dimtxsty, ctx);
      const td: Vec2 = [Math.cos(ang), Math.sin(ang)];
      const along = text ? Math.abs(dot(td, dd)) * size.w + Math.abs(dot(rot90(td), dd)) * size.h : 0;
      const centered = Math.abs(cross(td, dd)) > 0.3;
      // nejlepší umístění (DIMATFIT 3): šipky i text uvnitř, jinak šipky ven, jinak text ven
      const arrowsFit = Lq >= 2 * asz - 1e-9;
      const textFits = Lq >= along + 2 * gap + (st.dimtad === 0 || centered ? 2 * asz : 0) - 1e-9;
      let flip = false;
      let textOut = false;
      if (!(textFits && arrowsFit)) {
        if (textFits) flip = true;
        else if (arrowsFit) textOut = !!text;
        else {
          flip = true;
          textOut = !!text;
        }
      }
      if (e.textPos) textOut = false;
      let mid = add(q1, mul(dd, Lq / 2));
      if (st.dimjust === 1) mid = add(q1, mul(dd, asz * 2 + gap + along / 2));
      else if (st.dimjust === 2) mid = add(q2, mul(dd, -(asz * 2 + gap + along / 2)));
      if (textOut) mid = add(q2, mul(dd, asz * (flip ? 2.5 : 1) + gap + along / 2));
      const tp = e.textPos ?? offsetText(mid, ang, size, centered);
      // kótovací čára (prodloužená k textu mimo vynášecí čáry)
      const tAlong = dot(sub(tp, q1), dd);
      let s0 = 0;
      let s1 = Lq;
      if (text && (e.textPos || textOut)) {
        if (tAlong - along / 2 < 0) s0 = Math.min(0, tAlong - along / 2);
        if (tAlong + along / 2 > Lq) s1 = Math.max(Lq, tAlong + along / 2);
      }
      const at = (t: number) => add(q1, mul(dd, t));
      const breakLine = text && (st.dimtad === 0 || centered) && Math.abs(dot(sub(tp, q1), rot90(dd))) < size.h / 2 + gap;
      const segs: [number, number][] = [];
      const half = Lq / 2;
      const pushSeg = (a: number, b: number) => {
        if (!breakLine) return segs.push([a, b]);
        const g0 = tAlong - along / 2 - gap;
        const g1 = tAlong + along / 2 + gap;
        if (a < g0) segs.push([a, Math.min(b, g0)]);
        if (b > g1) segs.push([Math.max(a, g1), b]);
      };
      if (flip && !st.dimtofl) {
        pushSeg(-2 * asz, 0);
        pushSeg(Lq, Lq + 2 * asz);
      } else {
        if (!st.dimsd1) pushSeg(Math.min(s0, flip ? -2 * asz : 0), half);
        if (!st.dimsd2) pushSeg(half, Math.max(s1, flip ? Lq + 2 * asz : Lq));
      }
      // navazující úseky (obě poloviny kótovací čáry) jako jedna úsečka – méně dílů v DWG i na plátně
      const merged: [number, number][] = [];
      for (const sg of segs) {
        const lastSeg = merged[merged.length - 1];
        if (lastSeg && Math.abs(lastSeg[1] - sg[0]) < 1e-12) lastSeg[1] = sg[1];
        else merged.push([sg[0], sg[1]]);
      }
      for (const [a, b] of merged) L(at(a), at(b), D);
      if (Lq > 1e-12) {
        if (!st.dimsd1) A1(q1, flip ? mul(dd, -1) : dd);
        if (!st.dimsd2) A2(q2, flip ? dd : mul(dd, -1));
      }
      putText(text, tp, ang, size);
      break;
    }
    case "radius":
    case "diameter": {
      const isR = e.kind === "radius";
      const ch = e.chord ?? z;
      const far = e.far ?? ch;
      const c = isR ? (e.center ?? z) : mul(add(ch, far), 0.5);
      const r = dist(ch, c);
      defs.push(isR ? c : far, ch);
      measured = isR ? r : 2 * r;
      const u: Vec2 = r > 1e-12 ? unit(sub(ch, c)) : [1, 0];
      text = dimValueText(e, measured, st);
      const size = dimTextSize(text, txt, st.dimtxsty, ctx);
      if (isR && e.jog) {
        // zalomená kóta poloměru: hrot na oblouku, zalomení, náhradní střed
        const oc = e.jog.center;
        const jp = e.jog.jog;
        defs.push(oc, jp);
        const j1 = add(c, mul(u, dot(sub(jp, c), u)));
        const j2 = add(oc, mul(u, dot(sub(jp, oc), u)));
        // zalomení „blesk“: radiála od hrotu k bodu A (o půl délky zalomení před bodem zalomení), šikmá příčka pod úhlem
        // DIMJOGANG k bodu B na rovnoběžce náhradního středu (o půl délky za bodem zalomení), dál k náhradnímu středu
        const ja = rad(st.dimjogang || 45);
        const off = sub(j2, j1);
        const jl = len(off) / Math.max(1e-6, Math.tan(ja));
        const ja1 = add(j1, mul(u, jl / 2));
        const jb2 = add(j2, mul(u, -jl / 2));
        L(ch, ja1, D);
        L(ja1, jb2, D);
        L(jb2, oc, D);
        A2(ch, mul(u, -1));
        const ang = textAngle(angleOf(u));
        const mid = add(ch, mul(u, -dist(ch, ja1) / 2));
        putText(text, e.textPos ?? offsetText(mid, ang, size), ang, size);
        break;
      }
      const ang = textAngle(angleOf(u));
      const tp0 = e.textPos;
      const proj = tp0 ? dot(sub(tp0, c), u) : isR ? r / 2 : 0;
      const along = size.w;
      const outside = isR ? proj > r : Math.abs(proj) > r;
      const tp = tp0 ?? offsetText(add(c, mul(u, proj)), ang, size);
      if (isR) {
        if (outside) {
          const end = add(c, mul(u, proj + along / 2));
          L(st.dimtofl ? c : ch, end, D);
          if (st.dimtofl) A2(ch, mul(u, -1));
          else A2(ch, u);
          if (!st.dimtofl && st.dimcen) centerMark(parts, c, r, st.dimcen * k, E);
        } else {
          L(c, ch, D);
          A2(ch, mul(u, -1));
        }
      } else {
        if (outside) {
          const sgn = proj >= 0 ? 1 : -1;
          const end = add(c, mul(u, proj + sgn * (along / 2)));
          L(sgn > 0 ? far : ch, end, D);
        } else L(far, ch, D);
        A2(ch, mul(u, -1));
        A1(far, u);
      }
      putText(text, tp, ang, size);
      break;
    }
    case "angular":
    case "angular3": {
      let v: Vec2;
      let sDir: Vec2;
      let eDir: Vec2;
      let span: number;
      let lens: [number, number];
      const arcP = e.arc ?? z;
      if (e.kind === "angular3") {
        v = e.vertex ?? z;
        const p1 = e.p1 ?? z;
        const p2 = e.p2 ?? z;
        defs.push(v, p1, p2, arcP);
        sDir = unit(sub(p1, v));
        eDir = unit(sub(p2, v));
        lens = [dist(p1, v), dist(p2, v)];
        span = ccw(angleOf(sDir), angleOf(eDir));
        const ta = angleOf(sub(arcP, v));
        if (ccw(angleOf(sDir), ta) > span + 1e-12) {
          [sDir, eDir] = [eDir, sDir];
          lens = [lens[1], lens[0]];
          span = TAU - span;
        }
      } else {
        const [a1, b1] = e.l1 ?? [z, z];
        const [a2, b2] = e.l2 ?? [z, z];
        defs.push(a1, b1, a2, b2, arcP);
        const d1 = unit(sub(b1, a1));
        const d2 = unit(sub(b2, a2));
        const X = lineX(a1, d1, a2, d2);
        if (!X) {
          measured = 0;
          break;
        }
        v = X;
        const ta = angleOf(sub(arcP, v));
        let best: [Vec2, Vec2, number] | null = null;
        for (const r1 of [d1, mul(d1, -1)])
          for (const r2 of [d2, mul(d2, -1)])
            for (const [s0, e0] of [[r1, r2], [r2, r1]] as [Vec2, Vec2][]) {
              const sp = ccw(angleOf(s0), angleOf(e0));
              if (sp < Math.PI + 1e-9 && ccw(angleOf(s0), ta) <= sp + 1e-12 && (!best || sp < best[2])) best = [s0, e0, sp];
            }
        if (!best) best = [d1, d2, ccw(angleOf(d1), angleOf(d2))];
        [sDir, eDir, span] = best;
        const ext = (dd: Vec2, a: Vec2, b: Vec2) => Math.max(0, dot(sub(a, v), dd), dot(sub(b, v), dd));
        const isL1 = (dd: Vec2) => Math.abs(cross(dd, d1)) < 1e-9;
        lens = [isL1(sDir) ? ext(sDir, a1, b1) : ext(sDir, a2, b2), isL1(eDir) && !isL1(sDir) ? ext(eDir, a1, b1) : ext(eDir, a2, b2)];
      }
      measured = deg(span);
      const R = dist(arcP, v);
      const a0 = angleOf(sDir);
      parts.push({ type: "arc", c: v, r: R, a0: ((deg(a0) % 360) + 360) % 360, a1: ((deg(a0 + span) % 360) + 360) % 360, ...D } as NewEntity);
      [[sDir, lens[0], st.dimse1], [eDir, lens[1], st.dimse2]].forEach(([dd, l, sup]) => {
        if (sup) return;
        const d = dd as Vec2;
        const ln = l as number;
        if (Math.abs(R - ln) < 1e-9) return;
        if (R > ln) L(add(v, mul(d, ln + (ln > 0 ? exo : 0))), add(v, mul(d, R + exe)), E);
        else L(add(v, mul(d, ln - exo)), add(v, mul(d, R - exe)), E);
      });
      const arcLen = R * span;
      const flip = arcLen < 2 * asz;
      const t0 = rot90(sDir);
      const t1 = mul(rot90(eDir), -1);
      A1(add(v, mul(sDir, R)), flip ? mul(t0, -1) : t0);
      A2(add(v, mul(eDir, R)), flip ? mul(t1, -1) : t1);
      text = dimValueText(e, measured, st);
      const size = dimTextSize(text, txt, st.dimtxsty, ctx);
      const tm = a0 + span / 2;
      const ang = st.dimtih ? 0 : textAngle(tm + Math.PI / 2);
      const onArc = polar(v, tm, R);
      putText(text, e.textPos ?? offsetText(onArc, ang, size, st.dimtih), ang, size);
      break;
    }
    case "ordinate": {
      const o = e.origin ?? z;
      const f = e.p1 ?? z;
      const l = e.p2 ?? f;
      defs.push(o, f, l);
      // soustava kóty: osa X natočená o `hdir` (51); X-báze měří podél ux, odkaz vede podél uy (a naopak)
      const { ux, uy } = ordinateAxes(e);
      const mDir = e.xAxis ? ux : uy;
      const lDir = e.xAxis ? uy : ux;
      measured = Math.abs(dot(sub(f, o), mDir));
      const along = dot(sub(l, f), lDir);
      const sg = along >= 0 ? 1 : -1;
      const d: Vec2 = mul(lDir, sg);
      const lat = dot(sub(l, f), mDir);
      const total = Math.abs(along);
      const start = add(f, mul(d, Math.min(exo, total)));
      if (Math.abs(lat) > 1e-9 && total > 1e-9) {
        const jl = Math.min(2 * asz, total / 3);
        const a = add(f, mul(d, total / 2 - jl / 2));
        const b = add(a, add(mul(d, jl), mul(mDir, lat)));
        L(start, a, E);
        L(a, b, E);
        L(b, l, E);
      } else L(start, l, E);
      text = dimValueText(e, measured, st);
      const size = dimTextSize(text, txt, st.dimtxsty, ctx);
      const ang = textAngle(angleOf(d));
      putText(text, e.textPos ?? add(l, mul(d, gap + size.w / 2)), ang, size);
      break;
    }
    case "arc": {
      const c = e.center ?? z;
      const p1 = e.p1 ?? z;
      const p2 = e.p2 ?? z;
      const arcP = e.arc ?? p1;
      defs.push(c, p1, p2, arcP);
      const R0 = dist(p1, c);
      const R = dist(arcP, c);
      let s = angleOf(sub(p1, c));
      let en = angleOf(sub(p2, c));
      let span = ccw(s, en);
      if (ccw(s, angleOf(sub(arcP, c))) > span + 1e-12) {
        [s, en] = [en, s];
        span = TAU - span;
      }
      measured = R0 * span;
      parts.push({ type: "arc", c, r: R, a0: ((deg(s) % 360) + 360) % 360, a1: ((deg(s + span) % 360) + 360) % 360, ...D } as NewEntity);
      if (Math.abs(R - R0) > 1e-9) {
        const sgn = R > R0 ? 1 : -1;
        for (const a of [s, s + span]) {
          if ((a === s && st.dimse1) || (a !== s && st.dimse2)) continue;
          L(polar(c, a, R0 + sgn * exo), polar(c, a, R + sgn * exe), E);
        }
      }
      const flip = R * span < 2 * asz;
      const t0: Vec2 = [-Math.sin(s), Math.cos(s)];
      const t1: Vec2 = [Math.sin(s + span), -Math.cos(s + span)];
      A1(polar(c, s, R), flip ? mul(t0, -1) : t0);
      A2(polar(c, s + span, R), flip ? mul(t1, -1) : t1);
      text = dimValueText(e, measured, st);
      const size = dimTextSize(text, txt, st.dimtxsty, ctx);
      const tm = s + span / 2;
      const ang = textAngle(tm + Math.PI / 2);
      const tp = e.textPos ?? offsetText(polar(c, tm, R), ang, size);
      putText(text, tp, ang, size);
      // symbol délky oblouku (DIMARCSYM 0 před textem, 1 nad textem)
      if (text && st.dimarcsym !== 2) {
        const td: Vec2 = [Math.cos(ang), Math.sin(ang)];
        const up = rot90(td);
        const rs = txt * 0.55;
        const cen = st.dimarcsym === 1 ? add(tp, mul(up, size.h / 2 + gap * 0.5)) : add(add(tp, mul(td, -(size.w / 2 + gap + rs))), mul(up, -txt * 0.25));
        const a = angleOf(up);
        parts.push({ type: "arc", c: cen, r: rs, a0: ((deg(a) - 60 + 360) % 360), a1: ((deg(a) + 60 + 360) % 360), ...T } as NewEntity);
      }
      break;
    }
  }
  return { parts, measured, text, textMid, defs };
}

/** osy soustavy souřadnicové kóty (natočené o `hdir` [°]) */
export function ordinateAxes(e: Pick<DDimension, "hdir">): { ux: Vec2; uy: Vec2 } {
  const a = rad(e.hdir ?? 0);
  const ux: Vec2 = e.hdir ? [Math.cos(a), Math.sin(a)] : [1, 0];
  return { ux, uy: rot90(ux) };
}

/** značka středu (kříž) a při záporné velikosti i osy přes kružnici (DIMCEN) */
export function centerMark(out: NewEntity[], c: Vec2, r: number, size: number, s: Style = {}, lines?: { ext: number; linetype?: string }) {
  const m = Math.abs(size);
  if (!(m > 0)) return;
  const L = (a: Vec2, b: Vec2, extra: object = {}) => out.push({ type: "line", a, b, ...s, ...extra } as NewEntity);
  L([c[0] - m, c[1]], [c[0] + m, c[1]]);
  L([c[0], c[1] - m], [c[0], c[1] + m]);
  if (size < 0 || lines) {
    const ext = lines?.ext ?? m;
    const lt = lines?.linetype ? { linetype: lines.linetype } : {};
    const g = m;
    L([c[0] + m + g, c[1]], [c[0] + r + ext, c[1]], lt);
    L([c[0] - m - g, c[1]], [c[0] - r - ext, c[1]], lt);
    L([c[0], c[1] + m + g], [c[0], c[1] + r + ext], lt);
    L([c[0], c[1] - m - g], [c[0], c[1] - r - ext], lt);
  }
}
