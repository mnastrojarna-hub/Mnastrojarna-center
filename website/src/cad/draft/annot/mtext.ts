/**
 * BALÍK 2 (annot) – víceřádkový text MTEXT: čtení formátovacích kódů AutoCADu (import i export beze ztráty – obsah
 * se ukládá v kódech), sazba (zalomení do šířky rámečku, řádkování, připojení 1–9, stohy \S zlomků a tolerancí,
 * podtržení / nadtržení / přeškrtnutí, barvy, výška, šířka, sklon, písmo) a převod na kreslicí primitiva a texty.
 *
 * Kódy: \P nový odstavec, \~ pevná mezera, \\ \{ \} znaky, {…} skupina, \fArial|b1|i0; \F…; písmo, \H2.5; / \H0.7x;
 * výška, \W0.8; šířka, \Q15; sklon, \T1.2; prostrkání, \C1; barva ACI, \c255; pravá barva (0xBBGGRR), \L…\l
 * podtržení, \O…\o nadtržení, \K…\k přeškrtnutí, \S1/2; \S+0,1^-0,2; \S1#2; stoh, \A1; \p…; (ignorují se),
 * %%c Ø, %%d °, %%p ±, %%% %, \U+00D8 znak Unicode.
 */
import "./parts";
import { add, angleOf, dot, len, mul, rad, rot90, sub, type Box } from "../geom";
import { textWidth1, type KindCtx, type Prim } from "../kinds";
import { textFont } from "../kinds-core";
import type { DraftColor, DraftEntity, NewEntity, Vec2 } from "../model";
import type { DMText } from "./types";

export type MStyle = {
  h: number;
  /** název písma ze zdroje (SHX / TTF) */
  fontName: string;
  wf: number;
  /** sklon [°] */
  oblique: number;
  color?: DraftColor;
  under?: boolean;
  over?: boolean;
  strike?: boolean;
  bold?: boolean;
  italic?: boolean;
  track?: number;
};
export type MItem = { k: "t"; s: string; st: MStyle } | { k: "stack"; a: string; b: string; t: "^" | "/" | "#"; st: MStyle };

const SPECIAL: Record<string, string> = { c: "Ø", d: "°", p: "±", "%": "%" };

/** převod %%c / %%d / %%p / %%nnn a \U+XXXX (i mimo MTEXT – text kót) */
export function decodeSpecial(s: string): string {
  return s
    .replace(/\\U\+([0-9a-f]{4})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%(\d{3})/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/%%([cdp%])/gi, (_, c: string) => SPECIAL[c.toLowerCase()]);
}

const readArg = (s: string, i: number): [string, number] => {
  const j = s.indexOf(";", i);
  return j < 0 ? [s.slice(i), s.length] : [s.slice(i, j), j + 1];
};
const relNum = (arg: string, cur: number): number => {
  const m = /^\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(x?)\s*$/i.exec(arg);
  if (!m) return cur;
  const v = Number(m[1]);
  return m[2] ? cur * v : v;
};

/** Rozloží obsah MTEXT na odstavce s úseky textu a stohy (styl úseku = stav formátování). */
export function parseMText(src: string, base: MStyle): MItem[][] {
  const out: MItem[][] = [[]];
  let st: MStyle = { ...base };
  const stack: MStyle[] = [];
  let buf = "";
  const para = () => out[out.length - 1];
  const flush = () => {
    if (buf) para().push({ k: "t", s: buf, st });
    buf = "";
  };
  const set = (p: Partial<MStyle>) => {
    flush();
    st = { ...st, ...p };
  };
  const s = src ?? "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      const n = s[i + 1];
      if (n === undefined) {
        buf += c;
        continue;
      }
      i++;
      switch (n) {
        case "P":
        case "X":
        case "N":
          flush();
          out.push([]);
          break;
        case "~":
          buf += " ";
          break;
        case "\\":
        case "{":
        case "}":
          buf += n;
          break;
        case "U":
          if (s[i + 1] === "+" && /^[0-9a-f]{4}$/i.test(s.slice(i + 2, i + 6))) {
            buf += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16));
            i += 5;
          } else buf += n;
          break;
        case "M":
          // \M+nXXXX – vícebajtový znak (kódová stránka): přeskočit
          if (s[i + 1] === "+") i += 6;
          break;
        case "L":
          set({ under: true });
          break;
        case "l":
          set({ under: false });
          break;
        case "O":
          set({ over: true });
          break;
        case "o":
          set({ over: false });
          break;
        case "K":
          set({ strike: true });
          break;
        case "k":
          set({ strike: false });
          break;
        case "f":
        case "F": {
          const [arg, j] = readArg(s, i + 1);
          i = j - 1;
          const parts = arg.split("|");
          const p: Partial<MStyle> = { fontName: parts[0] || base.fontName };
          for (const q of parts.slice(1)) {
            if (/^b\d/i.test(q)) p.bold = q[1] === "1";
            if (/^i\d/i.test(q)) p.italic = q[1] === "1";
          }
          set(p);
          break;
        }
        case "H": {
          const [arg, j] = readArg(s, i + 1);
          i = j - 1;
          set({ h: Math.max(1e-9, relNum(arg, st.h)) });
          break;
        }
        case "W": {
          const [arg, j] = readArg(s, i + 1);
          i = j - 1;
          set({ wf: Math.max(1e-6, relNum(arg, st.wf)) });
          break;
        }
        case "Q": {
          const [arg, j] = readArg(s, i + 1);
          i = j - 1;
          set({ oblique: relNum(arg, st.oblique) });
          break;
        }
        case "T": {
          const [arg, j] = readArg(s, i + 1);
          i = j - 1;
          set({ track: Math.max(0.1, relNum(arg, st.track ?? 1)) });
          break;
        }
        case "C": {
          const [arg, j] = readArg(s, i + 1);
          i = j - 1;
          const v = Math.round(Number(arg));
          set({ color: v === 0 ? "ByBlock" : v === 256 ? "ByLayer" : v >= 1 && v <= 255 ? v : st.color });
          break;
        }
        case "c": {
          const [arg, j] = readArg(s, i + 1);
          i = j - 1;
          const v = Math.round(Number(arg));
          if (Number.isFinite(v) && v >= 0) {
            const hx = (x: number) => x.toString(16).padStart(2, "0");
            set({ color: `#${hx(v & 255)}${hx((v >> 8) & 255)}${hx((v >> 16) & 255)}` });
          }
          break;
        }
        case "A":
        case "p":
        case "a": {
          const [, j] = readArg(s, i + 1);
          i = j - 1;
          break;
        }
        case "S": {
          // stoh až do „;“ (oddělovač ^ / # neuvozený „\“)
          let j = i + 1;
          let raw = "";
          while (j < s.length && s[j] !== ";") {
            if (s[j] === "\\" && j + 1 < s.length) {
              raw += s[j] + s[j + 1];
              j += 2;
              continue;
            }
            raw += s[j++];
          }
          i = j;
          let k = -1;
          for (let q = 0; q < raw.length; q++) {
            if (raw[q] === "\\") {
              q++;
              continue;
            }
            if (raw[q] === "^" || raw[q] === "/" || raw[q] === "#") {
              k = q;
              break;
            }
          }
          const un = (x: string) => decodeSpecial(x.replace(/\\(.)/g, "$1"));
          flush();
          if (k < 0) buf += un(raw);
          else para().push({ k: "stack", a: un(raw.slice(0, k)), b: un(raw.slice(k + 1)), t: raw[k] as "^" | "/" | "#", st });
          break;
        }
        default:
          buf += n;
      }
      continue;
    }
    if (c === "{") {
      flush();
      stack.push(st);
      continue;
    }
    if (c === "}") {
      flush();
      st = stack.pop() ?? st;
      continue;
    }
    if (c === "%" && s[i + 1] === "%") {
      const n = s[i + 2];
      if (n && /[cdp%]/i.test(n)) {
        buf += SPECIAL[n.toLowerCase()];
        i += 2;
        continue;
      }
      if (n && /[uo]/i.test(n)) {
        if (n.toLowerCase() === "u") set({ under: !st.under });
        else set({ over: !st.over });
        i += 2;
        continue;
      }
      if (/^\d{3}$/.test(s.slice(i + 2, i + 5))) {
        buf += String.fromCharCode(Number(s.slice(i + 2, i + 5)));
        i += 4;
        continue;
      }
    }
    if (c === "\n") {
      flush();
      out.push([]);
      continue;
    }
    if (c === "\r") continue;
    buf += c === "\t" ? "    " : c;
  }
  flush();
  return out;
}

/** obsah MTEXT bez kódů (řádky odstavců) – výpis, vyhledávání, stav */
export function mtextPlain(src: string): string[] {
  const base: MStyle = { h: 1, fontName: "", wf: 1, oblique: 0 };
  return parseMText(src, base).map((p) => p.map((it) => (it.k === "t" ? it.s : it.t === "/" ? `${it.a}/${it.b}` : `${it.a} ${it.b}`)).join(""));
}
/** prostý text → obsah MTEXT (uvození \ { }, nové řádky = \P) */
export const escapeMText = (plain: string) => plain.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\P");
/** obsah MTEXT pro editor (\P → nový řádek; uvozené \\P zůstane) */
export function codesToEditor(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      if (s[i + 1] === "P") {
        out += "\n";
        i++;
        continue;
      }
      out += s[i] + s[i + 1];
      i++;
      continue;
    }
    out += s[i];
  }
  return out;
}
/** text z editoru → obsah MTEXT (nový řádek = \P) */
export const editorToCodes = (t: string) => t.replace(/\r?\n/g, "\\P");

// ---------------------------------------------------------------- sazba

export type MGlyph = { s: string; x: number; y: number; w: number; st: MStyle };
export type MDeco = { a: Vec2; b: Vec2; color?: DraftColor };
export type MLayout = {
  glyphs: MGlyph[];
  /** úsečky: podtržení, nadtržení, přeškrtnutí, zlomkové čáry (místní souřadnice) */
  decos: MDeco[];
  /** šířka a výška rámečku (výška = od horního okraje 1. řádku po účaří posledního) */
  w: number;
  h: number;
  /** levý horní roh rámečku v místních souřadnicích (podle připojení) */
  left: number;
  top: number;
  /** výška prvního řádku (výška verzálek) */
  h0: number;
};

const STACK = 0.7;
const fontOf = (st: MStyle) => textFont(st.fontName);
export const runWidth = (s: string, st: MStyle) => textWidth1(s, fontOf(st)) * st.h * st.wf * (st.track ?? 1);
const stackW = (it: Extract<MItem, { k: "stack" }>) => {
  const hs = { ...it.st, h: it.st.h * STACK };
  if (it.t === "#") return runWidth(it.a, hs) + runWidth(it.b, hs) + it.st.h * 0.3;
  return Math.max(runWidth(it.a, hs), runWidth(it.b, hs)) + it.st.h * 0.1;
};

type Tok = { it: MItem; w: number; space: boolean; s?: string };

/**
 * Sazba odstavců: `width` > 0 = zalomení slov do šířky, řádkování = `lineSpacing` × 5/3 × výška řádku, připojení 1–9
 * (1 vlevo nahoře … 9 vpravo dole). Místní souřadnice: x doprava po směru textu, y nahoru, počátek = bod vložení.
 */
export function layoutMText(paras: MItem[][], opts: { width: number; lineSpacing?: number; attach?: number; baseH: number }): MLayout {
  type Line = { toks: Tok[]; w: number; h: number };
  const lines: Line[] = [];
  for (const p of paras) {
    const toks: Tok[] = [];
    for (const it of p) {
      if (it.k === "stack") toks.push({ it, w: stackW(it), space: false });
      else for (const part of it.s.match(/\s+|[^\s]+/g) ?? []) toks.push({ it, s: part, w: runWidth(part, it.st), space: /^\s+$/.test(part) });
    }
    let cur: Line = { toks: [], w: 0, h: 0 };
    const hOf = (t: Tok) => t.it.st.h;
    for (const t of toks) {
      if (opts.width > 0 && cur.toks.length && !t.space && cur.w + t.w > opts.width + 1e-9) {
        while (cur.toks.length && cur.toks[cur.toks.length - 1].space) cur.w -= cur.toks.pop()!.w;
        lines.push(cur);
        cur = { toks: [], w: 0, h: 0 };
      }
      if (!cur.toks.length && t.space && lines.length && opts.width > 0) continue;
      cur.toks.push(t);
      cur.w += t.w;
      cur.h = Math.max(cur.h, hOf(t));
    }
    if (!cur.h) cur.h = p.length ? p[0].st.h : opts.baseH;
    lines.push(cur);
  }
  const ls = opts.lineSpacing && opts.lineSpacing > 0 ? opts.lineSpacing : 1;
  const W = opts.width > 0 ? opts.width : Math.max(0, ...lines.map((l) => l.w));
  const att = opts.attach && opts.attach >= 1 && opts.attach <= 9 ? opts.attach : 1;
  const col = (att - 1) % 3;
  const row = Math.floor((att - 1) / 3);
  const glyphs: MGlyph[] = [];
  const decos: MDeco[] = [];
  let y = 0;
  lines.forEach((l, i) => {
    y = i === 0 ? -l.h : y - ls * (5 / 3) * l.h;
    let x = col === 0 ? 0 : col === 1 ? (W - l.w) / 2 : W - l.w;
    // slova téhož stylu na řádku se spojí do jednoho úseku i s mezerami (méně volání fillText, EXPLODE = text na úsek)
    let run: MGlyph | null = null;
    let pend = "";
    let pendW = 0;
    for (const t of l.toks) {
      const st = t.it.st;
      if (t.it.k === "t") {
        if (t.space) {
          if (run && run.st === st) {
            pend += t.s!;
            pendW += t.w;
          } else run = null;
        } else if (run && run.st === st) {
          run.s += pend + t.s!;
          run.w += pendW + t.w;
          pend = "";
          pendW = 0;
        } else {
          run = { s: t.s!, x, y, w: t.w, st };
          pend = "";
          pendW = 0;
          glyphs.push(run);
        }
        const dl = (yy: number) => decos.push({ a: [x, y + yy], b: [x + t.w, y + yy], color: st.color });
        if (st.under) dl(-0.2 * st.h);
        if (st.over) dl(1.2 * st.h);
        if (st.strike) dl(0.5 * st.h);
      } else {
        run = null;
        const it = t.it;
        const hs: MStyle = { ...st, h: st.h * STACK };
        const wa = runWidth(it.a, hs);
        const wb = runWidth(it.b, hs);
        if (it.t === "/") {
          const ww = Math.max(wa, wb);
          const bar = y + st.h * 0.5;
          glyphs.push({ s: it.a, x: x + (ww - wa) / 2 + st.h * 0.05, y: bar + st.h * 0.12, w: wa, st: hs });
          glyphs.push({ s: it.b, x: x + (ww - wb) / 2 + st.h * 0.05, y: bar - st.h * 0.12 - hs.h, w: wb, st: hs });
          decos.push({ a: [x, bar], b: [x + ww + st.h * 0.1, bar], color: st.color });
        } else if (it.t === "#") {
          glyphs.push({ s: it.a, x, y: y + st.h * 0.45, w: wa, st: hs });
          decos.push({ a: [x + wa + st.h * 0.05, y - st.h * 0.1], b: [x + wa + st.h * 0.25, y + st.h * 1.05], color: st.color });
          glyphs.push({ s: it.b, x: x + wa + st.h * 0.3, y: y - st.h * 0.1, w: wb, st: hs });
        } else {
          // tolerance: horní nad dolní, zarovnané vlevo
          glyphs.push({ s: it.a, x, y: y + st.h - hs.h + st.h * 0.15, w: wa, st: hs });
          glyphs.push({ s: it.b, x, y: y - st.h * 0.15, w: wb, st: hs });
        }
      }
      x += t.w;
    }
  });
  const H = -y;
  return { glyphs, decos, w: W, h: H, left: col === 0 ? 0 : col === 1 ? -W / 2 : -W, top: row === 0 ? 0 : row === 1 ? H / 2 : H, h0: lines[0]?.h ?? opts.baseH };
}

/** styl výchozí pro MTEXT entity (textový styl → písmo, šířka, sklon) */
export function mtextBase(e: Pick<DMText, "h" | "style">, ctx: KindCtx): MStyle {
  const st = ctx.model.textStyles.find((x) => x.name.toLowerCase() === (e.style ?? ctx.model.vars.textstyle).toLowerCase());
  return { h: e.h, fontName: st?.font ?? "Arial", wf: st?.wf || 1, oblique: st?.oblique ?? 0 };
}

export type MPlaced = { lay: MLayout; dir: Vec2; up: Vec2; origin: Vec2; base: MStyle };
const mtCache = new WeakMap<object, MPlaced>();
/** sazba entity MTEXT ve světových souřadnicích (směr, kolmice, počátek = bod vložení) */
export function placeMText(e: DMText, ctx: KindCtx, scale = 1): MPlaced {
  const hit = scale === 1 ? mtCache.get(e) : undefined;
  if (hit && (hit as MPlaced & { m?: unknown }).m === ctx.model.textStyles) return hit;
  const base = mtextBase({ ...e, h: e.h * scale }, ctx);
  const lay = layoutMText(parseMText(e.s, base), { width: (e.w || 0) * scale, lineSpacing: e.lineSpacing, attach: e.attach, baseH: base.h });
  const r = rad(e.rot ?? 0);
  const dir: Vec2 = [Math.cos(r), Math.sin(r)];
  const out = { lay, dir, up: rot90(dir), origin: e.p, base };
  if (scale === 1) mtCache.set(e, Object.assign(out, { m: ctx.model.textStyles }));
  return out;
}
const W = (pl: MPlaced, x: number, y: number): Vec2 => add(pl.origin, add(mul(pl.dir, pl.lay.left + x), mul(pl.up, pl.lay.top + y)));

/** rohy rámečku textu (s rezervou pro dotahy pod účařím) */
export function mtextCorners(pl: MPlaced): Vec2[] {
  const { lay } = pl;
  const bot = -lay.h - lay.h0 * 0.3;
  const top = Math.max(0, ...lay.glyphs.map((g) => g.y + g.st.h));
  return [W(pl, 0, bot), W(pl, lay.w, bot), W(pl, lay.w, Math.max(0, top)), W(pl, 0, Math.max(0, top))];
}
export const cornersBox = (c: Vec2[]): Box => ({ x0: Math.min(...c.map((p) => p[0])), y0: Math.min(...c.map((p) => p[1])), x1: Math.max(...c.map((p) => p[0])), y1: Math.max(...c.map((p) => p[1])) });
/** vzdálenost bodu od rámečku textu (uvnitř = 0) */
export function boxDist(c: Vec2[], p: Vec2): number {
  const o = c[0];
  const ux = sub(c[1], o);
  const uy = sub(c[3], o);
  const lx = len(ux) || 1e-12;
  const ly = len(uy) || 1e-12;
  const q = sub(p, o);
  const x = dot(q, ux) / lx;
  const y = dot(q, uy) / ly;
  const dx = x < 0 ? -x : x > lx ? x - lx : 0;
  const dy = y < 0 ? -y : y > ly ? y - ly : 0;
  return Math.hypot(dx, dy);
}

const isOwnColor = (c: DraftColor | undefined) => c !== undefined && c !== "ByBlock";

/** kreslicí primitiva MTEXT: texty (barevné úseky jako vnořené texty s vlastní barvou), čáry podtržení a zlomků */
export function mtextPrims(pl: MPlaced, style?: string): Prim[] {
  const out: Prim[] = [];
  const colored: DraftEntity[] = [];
  const ang = angleOf(pl.dir);
  pl.lay.glyphs.forEach((g, i) => {
    const p = W(pl, g.x, g.y);
    const obl = g.st.oblique + (g.st.italic && !g.st.oblique ? 15 : 0);
    const prim: Prim = { k: "text", p, h: g.st.h, rot: ang, s: g.s, font: fontOf(g.st), wf: g.st.wf * (g.st.track ?? 1), oblique: rad(obl) };
    // barevný úsek: interní díl s hotovým primitivem (zachová písmo / tučné / kurzívu a nepočítá se při každém snímku)
    if (isOwnColor(g.st.color)) colored.push({ id: `~m${i}`, layer: "0", type: "annotpart", prims: [prim], color: g.st.color } as unknown as DraftEntity);
    else out.push(prim);
  });
  pl.lay.decos.forEach((d, i) => {
    const a = W(pl, d.a[0], d.a[1]);
    const b = W(pl, d.b[0], d.b[1]);
    if (isOwnColor(d.color)) colored.push({ id: `~d${i}`, layer: "0", type: "annotpart", prims: [{ k: "path", segs: [{ k: "L", a, b }] }], color: d.color } as unknown as DraftEntity);
    else out.push({ k: "path", segs: [{ k: "L", a, b }] });
  });
  if (colored.length) out.push({ k: "sub", entities: colored, xf: [1, 0, 0, 1, 0, 0] });
  return out;
}

/** rozložení MTEXT na jednořádkové texty (TEXT) a úsečky podtržení */
export function mtextExplode(pl: MPlaced, style?: string): NewEntity[] {
  const out: NewEntity[] = [];
  const rot = (angleOf(pl.dir) * 180) / Math.PI;
  for (const g of pl.lay.glyphs) {
    const obl = g.st.oblique + (g.st.italic && !g.st.oblique ? 15 : 0);
    out.push({ type: "text", p: W(pl, g.x, g.y), h: g.st.h, s: g.s, ...(Math.abs(rot) > 1e-12 ? { rot: ((rot % 360) + 360) % 360 } : {}), ...(style ? { style } : {}), ...(Math.abs(g.st.wf - 1) > 1e-9 ? { wf: g.st.wf } : {}), ...(obl ? { oblique: obl } : {}), ...(isOwnColor(g.st.color) ? { color: g.st.color } : {}) } as NewEntity);
  }
  for (const d of pl.lay.decos) out.push({ type: "line", a: W(pl, d.a[0], d.a[1]), b: W(pl, d.b[0], d.b[1]), ...(isOwnColor(d.color) ? { color: d.color } : {}) } as NewEntity);
  return out;
}
