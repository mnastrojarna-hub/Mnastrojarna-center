/**
 * BALÍK 2 (annot) – geometrické tolerance (rámeček tolerance podle ČSN EN ISO 1101, entita TOLERANCE) a značka
 * struktury povrchu (ČSN EN ISO 1302 / 21920-1). Značky charakteristik se kreslí vektorově (nezávisle na písmu),
 * řetězec tolerance je ve formátu DXF: buňky oddělené %%v, řádky ^J, symboly {\Fgdt;j} (písmo GDT).
 */
import { tr } from "../../i18n";
import { add, mul, rad, rot90, type Box } from "../geom";
import { textWidth1, type KindCtx } from "../kinds";
import { textFont } from "../kinds-core";
import type { NewEntity, Vec2 } from "../model";
import { decodeSpecial } from "./mtext";
import type { DSurfSym, DTolerance } from "./types";
import { readableAngle } from "./util";

/** charakteristiky (písmeno písma GDT ↔ název cs / en / de) */
export const GDT_SYMBOLS: { ch: string; cs: string; en: string; de: string; label: () => string }[] = [
  { ch: "j", cs: "poloha", en: "position", de: "position", label: () => tr("Poloha") },
  { ch: "r", cs: "soustřednost", en: "concentricity", de: "konzentrizität", label: () => tr("Soustřednost / souosost") },
  { ch: "i", cs: "souměrnost", en: "symmetry", de: "symmetrie", label: () => tr("Souměrnost") },
  { ch: "f", cs: "rovnoběžnost", en: "parallelism", de: "parallelität", label: () => tr("Rovnoběžnost") },
  { ch: "b", cs: "kolmost", en: "perpendicularity", de: "rechtwinkligkeit", label: () => tr("Kolmost") },
  { ch: "a", cs: "sklon", en: "angularity", de: "neigung", label: () => tr("Sklon") },
  { ch: "g", cs: "válcovitost", en: "cylindricity", de: "zylinderform", label: () => tr("Válcovitost") },
  { ch: "c", cs: "rovinnost", en: "flatness", de: "ebenheit", label: () => tr("Rovinnost") },
  { ch: "e", cs: "kruhovitost", en: "circularity", de: "rundheit", label: () => tr("Kruhovitost") },
  { ch: "u", cs: "přímost", en: "straightness", de: "geradheit", label: () => tr("Přímost") },
  { ch: "d", cs: "tvar-plochy", en: "surfaceprofile", de: "flächenform", label: () => tr("Tvar plochy") },
  { ch: "k", cs: "tvar-čáry", en: "lineprofile", de: "linienform", label: () => tr("Tvar čáry") },
  { ch: "h", cs: "házení", en: "runout", de: "lauf", label: () => tr("Házení obvodové") },
  { ch: "t", cs: "celkové-házení", en: "totalrunout", de: "gesamtlauf", label: () => tr("Házení celkové") },
];
/** modifikátory: n Ø, m Ⓜ, l Ⓛ, s Ⓢ, p Ⓟ (promítnuté pole) */
export const GDT_MOD: Record<string, string> = { M: "m", L: "l", S: "s", P: "p", F: "f" };

type Seg = { k: "l"; a: Vec2; b: Vec2 } | { k: "c"; c: Vec2; r: number } | { k: "a"; c: Vec2; r: number; a0: number; a1: number } | { k: "f"; pts: Vec2[] };
/** vektorová značka charakteristiky (místní souřadnice, výška h, střed 0,0) */
export function gdtGlyph(ch: string, h: number): Seg[] | null {
  const s = h / 2;
  const l = (x0: number, y0: number, x1: number, y1: number): Seg => ({ k: "l", a: [x0 * s, y0 * s], b: [x1 * s, y1 * s] });
  switch (ch) {
    case "j":
      return [{ k: "c", c: [0, 0], r: 0.6 * s }, l(-1, 0, 1, 0), l(0, -1, 0, 1)];
    case "b":
      return [l(0, -0.9, 0, 0.9), l(-0.9, -0.9, 0.9, -0.9)];
    case "f":
      return [l(-0.8, -0.9, -0.2, 0.9), l(0.2, -0.9, 0.8, 0.9)];
    case "c":
      return [l(-1, -0.45, 0.45, -0.45), l(0.45, -0.45, 1, 0.45), l(1, 0.45, -0.45, 0.45), l(-0.45, 0.45, -1, -0.45)];
    case "e":
      return [{ k: "c", c: [0, 0], r: 0.75 * s }];
    case "g":
      return [{ k: "c", c: [0, 0], r: 0.6 * s }, l(-0.95, -0.85, 0.1, 0.95), l(-0.1, -0.95, 0.95, 0.85)];
    case "u":
      return [l(-1, 0, 1, 0)];
    case "a":
      return [l(-0.9, -0.8, 0.9, -0.8), l(-0.9, -0.8, 0.75, 0.75)];
    case "i":
      return [l(-1, 0, 1, 0), l(-0.6, 0.55, 0.6, 0.55), l(-0.6, -0.55, 0.6, -0.55)];
    case "r":
      return [{ k: "c", c: [0, 0], r: 0.4 * s }, { k: "c", c: [0, 0], r: 0.8 * s }];
    case "k":
      return [{ k: "a", c: [0, -0.5 * s], r: 0.9 * s, a0: 0, a1: 180 }];
    case "d":
      return [{ k: "a", c: [0, -0.5 * s], r: 0.9 * s, a0: 0, a1: 180 }, l(-0.9, -0.5, 0.9, -0.5)];
    case "h":
      return [l(-0.8, -0.8, 0.6, 0.6), { k: "f", pts: [[0.85 * s, 0.85 * s], [0.25 * s, 0.6 * s], [0.6 * s, 0.25 * s]] }];
    case "t":
      return [l(-0.9, -0.8, 0.1, 0.5), l(-0.2, -0.8, 0.8, 0.5), l(-0.9, -0.8, -0.2, -0.8), { k: "f", pts: [[0.3 * s, 0.85 * s], [-0.15 * s, 0.45 * s], [0.25 * s, 0.25 * s]] }, { k: "f", pts: [[1 * s, 0.85 * s], [0.55 * s, 0.45 * s], [0.95 * s, 0.25 * s]] }];
    default:
      return null;
  }
}
const MODCH: Record<string, string> = { m: "M", l: "L", s: "S", p: "P", f: "F" };

type Cell = { items: ({ k: "sym"; ch: string } | { k: "txt"; s: string } | { k: "mod"; s: string })[]; w: number };

/** rozklad řetězce tolerance na řádky a buňky */
export function parseTolerance(s: string): Cell[][] {
  return s.split(/\^J|\\P/).map((row) =>
    row.split(/%%v/i).map((cell) => {
      const items: Cell["items"] = [];
      const re = /\{\\F[^;]*gdt[^;]*;([a-z]+)\}|([^{]+|\{)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(cell))) {
        if (m[1]) for (const ch of m[1].toLowerCase()) items.push(gdtGlyph(ch, 1) ? { k: "sym", ch } : MODCH[ch] ? { k: "mod", s: MODCH[ch] } : ch === "n" ? { k: "txt", s: "Ø" } : { k: "txt", s: ch });
        else if (m[2] && m[2] !== "{") items.push({ k: "txt", s: decodeSpecial(m[2]).replace(/[{}]/g, "") });
      }
      // sousední texty (Ø z písma GDT + hodnota) jako jeden text – stejná sazba, méně textů na plátně i v DWG
      const merged: Cell["items"] = [];
      for (const it of items) {
        const prev = merged[merged.length - 1];
        if (it.k === "txt" && prev?.k === "txt") merged[merged.length - 1] = { k: "txt", s: prev.s + it.s };
        else merged.push(it);
      }
      return { items: merged, w: 0 };
    }),
  );
}

/** Rámeček tolerance → entity (úsečky rámečku, značky, texty). `p` = levý okraj, svislý střed 1. řádku. */
export function toleranceParts(e: DTolerance, ctx: KindCtx, k = 1): { parts: NewEntity[]; box: Box | null; corners: Vec2[] } {
  const h = e.h * k;
  const st = ctx.model.textStyles.find((x) => x.name.toLowerCase() === (e.style ?? ctx.model.vars.textstyle).toLowerCase());
  const font = textFont(st?.font);
  const tw = (s: string) => textWidth1(s, font) * h;
  const H = 2 * h;
  const pad = 0.5 * h;
  const a = rad(e.rot ?? 0);
  const dir: Vec2 = [Math.cos(a), Math.sin(a)];
  const up = rot90(dir);
  const P = (u: number, v: number): Vec2 => add(e.p, add(mul(dir, u), mul(up, v)));
  const parts: NewEntity[] = [];
  const rows = parseTolerance(e.s);
  const corners: Vec2[] = [];
  rows.forEach((row, ri) => {
    const yc = -ri * H;
    let x = 0;
    const cells = row.filter((c, i) => c.items.length || i < row.length - 1 || row.length === 1);
    if (!cells.length || (cells.length === 1 && !cells[0].items.length)) return;
    const xs: number[] = [0];
    for (const c of cells) {
      let w = 0;
      for (const it of c.items) w += it.k === "sym" ? h * 1.2 : it.k === "mod" ? h * 1.1 : tw(it.s);
      const cw = Math.max(H, w + 2 * pad);
      let cx = x + (cw - w) / 2;
      for (const it of c.items) {
        if (it.k === "sym") {
          const g = gdtGlyph(it.ch, h)!;
          const cc: Vec2 = [cx + h * 0.6, yc];
          glyphParts(parts, g, (q) => P(cc[0] + q[0], cc[1] + q[1]), dir);
          cx += h * 1.2;
        } else if (it.k === "mod") {
          const cc: Vec2 = [cx + h * 0.55, yc];
          parts.push({ type: "circle", c: P(cc[0], cc[1]), r: h * 0.5 } as NewEntity);
          parts.push({ type: "text", p: P(cc[0], cc[1]), h: h * 0.65, s: it.s, rot: (Math.atan2(dir[1], dir[0]) * 180) / Math.PI, halign: "middle", ...(e.style ? { style: e.style } : {}) } as NewEntity);
          cx += h * 1.1;
        } else {
          parts.push({ type: "text", p: P(cx, yc - h / 2), h, s: it.s, rot: (Math.atan2(dir[1], dir[0]) * 180) / Math.PI, ...(e.style ? { style: e.style } : {}) } as NewEntity);
          cx += tw(it.s);
        }
      }
      x += cw;
      xs.push(x);
    }
    const y0 = yc - H / 2;
    const y1 = yc + H / 2;
    parts.push({ type: "polyline", pts: [P(0, y0), P(x, y0), P(x, y1), P(0, y1)], closed: true } as NewEntity);
    for (const xx of xs.slice(1, -1)) parts.push({ type: "line", a: P(xx, y0), b: P(xx, y1) } as NewEntity);
    corners.push(P(0, y0), P(x, y0), P(x, y1), P(0, y1));
  });
  if (!corners.length) return { parts, box: null, corners };
  const xsAll = corners.map((c) => c[0]);
  const ysAll = corners.map((c) => c[1]);
  return { parts, box: { x0: Math.min(...xsAll), y0: Math.min(...ysAll), x1: Math.max(...xsAll), y1: Math.max(...ysAll) }, corners };
}

function glyphParts(out: NewEntity[], g: Seg[], W: (q: Vec2) => Vec2, dir: Vec2) {
  const rot = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
  for (const s of g) {
    if (s.k === "l") out.push({ type: "line", a: W(s.a), b: W(s.b) } as NewEntity);
    else if (s.k === "c") out.push({ type: "circle", c: W(s.c), r: s.r } as NewEntity);
    else if (s.k === "a") out.push({ type: "arc", c: W(s.c), r: s.r, a0: (((s.a0 + rot) % 360) + 360) % 360, a1: (((s.a1 + rot) % 360) + 360) % 360 } as NewEntity);
    else out.push({ type: "hatch", pattern: "SOLID", solid: true, scale: 1, angle: 0, loops: [{ pts: s.pts.map(W), outer: true }] } as NewEntity);
  }
}

/** Řetězec tolerance ze strukturovaného zadání: charakteristika, hodnota (Ø, modifikátor M/L/S/P), základny. */
export function buildTolerance(sym: string, value: string, datums: string[]): string {
  const g = (c: string) => `{\\Fgdt;${c}}`;
  const v = value.trim();
  const dia = /^(ø|Ø|%%c|d|dia|průměr|prumer|durchm)/i.exec(v);
  let rest = dia ? v.slice(dia[0].length) : v;
  let mod = "";
  const mm = /\(?([MLSP])\)?$/i.exec(rest);
  if (mm && /\d/.test(rest.slice(0, -mm[0].length))) {
    mod = g(GDT_MOD[mm[1].toUpperCase()]);
    rest = rest.slice(0, -mm[0].length);
  }
  const cells = [g(sym), `${dia ? g("n") : ""}${rest}${mod}`];
  for (const d of datums) {
    const dm = /^([A-Z]+)\(?([MLS])?\)?$/i.exec(d.trim());
    if (!dm) throw new Error(tr("základna „{0}“: písmeno A–Z, případně s modifikátorem (např. A, B(M))", d));
    cells.push(`${dm[1].toUpperCase()}${dm[2] ? g(GDT_MOD[dm[2].toUpperCase()]) : ""}`);
  }
  return cells.join("%%v");
}
/** čitelný popis řetězce tolerance (výpis, stav) */
export function tolerancePlain(s: string): string {
  return parseTolerance(s)
    .map((r) => r.map((c) => c.items.map((it) => (it.k === "sym" ? `[${GDT_SYMBOLS.find((x) => x.ch === it.ch)?.en ?? it.ch}]` : it.k === "mod" ? `(${it.s})` : it.s)).join("")).join(" | "))
    .join(" / ");
}

// ---------------------------------------------------------------- značka struktury povrchu

/** Značka drsnosti → entity (ramena, příčka / kroužek, rameno s požadavkem, texty). */
export function surfaceParts(e: DSurfSym, ctx: KindCtx, k = 1): { parts: NewEntity[]; corners: Vec2[] } {
  const h = e.h * k;
  const st = ctx.model.textStyles.find((x) => x.name.toLowerCase() === (e.style ?? ctx.model.vars.textstyle).toLowerCase());
  const font = textFont(st?.font);
  const tw = (s: string) => textWidth1(s, font) * h;
  const a = rad(e.rot ?? 0);
  const dir: Vec2 = [Math.cos(a), Math.sin(a)];
  const up = rot90(dir);
  const P = (u: number, v: number): Vec2 => add(e.p, add(mul(dir, u), mul(up, v)));
  const H1 = 1.4 * h;
  const H2 = 3 * h;
  const c60 = 1 / Math.tan(Math.PI / 3);
  const parts: NewEntity[] = [];
  const L = (a1: Vec2, b1: Vec2) => parts.push({ type: "line", a: a1, b: b1 } as NewEntity);
  L(P(0, 0), P(-H1 * c60, H1));
  const top = P(H2 * c60, H2);
  L(P(0, 0), top);
  if (e.kind === "removal") L(P(-H1 * c60, H1), P(H1 * c60, H1));
  if (e.kind === "noremoval") parts.push({ type: "circle", c: P(0, H1 / 3 + H1 * 0.02), r: H1 / 3 } as NewEntity);
  const req = (e.text ?? "").trim();
  const proc = (e.process ?? "").trim();
  const barW = Math.max(req ? tw(req) : 0, proc ? tw(proc) : 0) + h * 0.6;
  const textAng = readableAngle(a);
  const rotDeg = (textAng * 180) / Math.PI;
  const flipped = Math.abs(textAng - a) > 1e-9;
  const corners: Vec2[] = [P(-H1 * c60, 0), P(H2 * c60, 0), P(H2 * c60, H2), P(-H1 * c60, H2)];
  if (req || proc) {
    const x0 = H2 * c60;
    L(top, P(x0 + barW, H2));
    const tx = (s: string, v: number) => {
      const p0 = flipped ? P(x0 + h * 0.3 + tw(s), v + h) : P(x0 + h * 0.3, v);
      parts.push({ type: "text", p: p0, h, s, ...(rotDeg ? { rot: (rotDeg + 360) % 360 } : {}), ...(e.style ? { style: e.style } : {}) } as NewEntity);
    };
    if (req) tx(req, H2 - 1.4 * h);
    if (proc) tx(proc, H2 + 0.35 * h);
    corners.push(P(x0 + barW, H2 + (proc ? 1.5 * h : 0)), P(x0 + barW, H2 - 1.5 * h));
  }
  if (e.allAround) parts.push({ type: "circle", c: top, r: h * 0.35 } as NewEntity);
  if (e.lay) parts.push({ type: "text", p: P(H1 * c60 * 0.9, h * 0.1), h, s: e.lay, ...(rotDeg ? { rot: (rotDeg + 360) % 360 } : {}) } as NewEntity);
  return { parts, corners };
}
