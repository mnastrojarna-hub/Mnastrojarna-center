/**
 * BALÍK 2 (annot) – drobné pomůcky: čtení čísel a bodů z polí, pole panelu vlastností, čitelný směr textu,
 * barvy pro přechody šraf, uvozovky pro textové zadání.
 */
import { tr } from "../../i18n";
import { aciRgb, hexRgb } from "../colors";
import { add, mul, rot90, TAU, type Affine, xfPt, xfVec } from "../geom";
import type { DraftField, Prim, Seg } from "../kinds";
import type { DraftColor, DraftEntity, NewEntity, Vec2 } from "../model";
import { evalNumber } from "../units";

export const num = (raw: string, what: string): number => {
  const v = evalNumber(String(raw).replace("°", ""), true);
  if (!Number.isFinite(v)) throw new Error(tr("{0}: očekávám číslo, ne „{1}“", what, raw));
  return v;
};
export const posNum = (raw: string, what: string): number => {
  const v = num(raw, what);
  if (!(v > 0)) throw new Error(tr("{0} musí být kladné", what));
  return v;
};
export const nonNeg = (raw: string, what: string): number => {
  const v = num(raw, what);
  if (v < 0) throw new Error(tr("{0} nesmí být záporné", what));
  return v;
};
export const parsePt2 = (raw: string, what = tr("bod")): Vec2 => {
  const m = String(raw).split(/[,;]/);
  if (m.length !== 2) throw new Error(tr("{0}: očekávám souřadnice x,y, ne „{1}“", what, raw));
  return [num(m[0], what), num(m[1], what)];
};
export const boolOf = (raw: string) => /^(1|true|ano|yes|ja|on|zap|ein)$/i.test(String(raw).trim());
export const fld = (key: string, label: string, value: string | number, kind: DraftField["kind"], readonly?: boolean): DraftField => ({ key, label, value, kind, ...(readonly ? { readonly } : {}) });
export const ptStr = (p: Vec2) => `${p[0]},${p[1]}`;
export const unknownKey = (key: string, keys: string[]) => new Error(tr("neznámá vlastnost „{0}“ – možné: {1}", key, keys.join(", ")));

/** úhel [rad] převedený na čitelný směr textu (−90°, 90°] – text se čte zleva nebo zdola */
export function readableAngle(a: number): number {
  let r = ((a % TAU) + TAU) % TAU;
  if (r > Math.PI / 2 + 1e-9 && r <= (3 * Math.PI) / 2 + 1e-9) r -= Math.PI;
  if (r > Math.PI) r -= TAU;
  return r;
}

/** RGB barvy výkresu (ACI / #rrggbb); ByLayer / ByBlock → null */
export function colorRgb(c: DraftColor | undefined): [number, number, number] | null {
  if (typeof c === "number") return aciRgb(c);
  if (typeof c === "string" && c.startsWith("#")) return hexRgb(c);
  return null;
}
const h2 = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
export const rgbToHex = (c: [number, number, number]) => `#${h2(c[0])}${h2(c[1])}${h2(c[2])}`;

/** text v uvozovkách pro textový příkaz (vybere uvozovky, které v textu nejsou) */
export function quoteArg(s: string): string | null {
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("„") && !s.includes("“") && !s.includes("”")) return `„${s}“`;
  if (!s.includes("'")) return `'${s}'`;
  return null;
}

/** obraz bodu / směru v transformaci (zkratky) */
export const X = (m: Affine, p: Vec2) => xfPt(m, p);
export const XV = (m: Affine, v: Vec2) => xfVec(m, v);
export const XO = (m: Affine, p: Vec2 | undefined) => (p ? xfPt(m, p) : undefined);

/** bod v rámu (počátek, směr osy x): p + dir·u + kolmice·v */
export const frame = (o: Vec2, dir: Vec2, u: number, v: number): Vec2 => add(o, add(mul(dir, u), mul(rot90(dir), v)));

/** dočasná entita pro výpočet primitiv / křivek dílčích prvků (kóta → úsečky, šipky, text) */
export const temp = (ne: NewEntity, i: number, layer = "0"): DraftEntity => ({ ...ne, id: `~a${i}`, layer: ne.layer ?? layer }) as DraftEntity;

/** společné vlastnosti zdrojové entity pro rozložené části (EXPLODE) – barva ByBlock → barva zdroje */
export function inheritStyle(src: DraftEntity, part: NewEntity): NewEntity {
  const out = { ...part, layer: src.layer } as NewEntity & Record<string, unknown>;
  const by = (v: unknown) => v === undefined || v === "ByBlock";
  if (by(out.color)) {
    if (src.color !== undefined && src.color !== "ByLayer") out.color = src.color;
    else delete out.color;
  }
  if (by(out.lineweight)) {
    if (src.lineweight !== undefined && src.lineweight !== "ByLayer") out.lineweight = src.lineweight;
    else delete out.lineweight;
  }
  if (by(out.linetype)) {
    if (src.linetype && !/^bylayer$/i.test(src.linetype)) out.linetype = src.linetype;
    else delete out.linetype;
  }
  delete out.id;
  return out as NewEntity;
}

/** začátek / konec úseku dráhy */
function segEnds(g: Seg): [Vec2, Vec2] {
  if (g.k === "L") return [g.a, g.b];
  if (g.k === "P") return [g.pts[0], g.pts[g.pts.length - 1]];
  if (g.k === "A") return [[g.c[0] + g.r * Math.cos(g.a0), g.c[1] + g.r * Math.sin(g.a0)], [g.c[0] + g.r * Math.cos(g.a1), g.c[1] + g.r * Math.sin(g.a1)]];
  const pt = (t: number): Vec2 => {
    const cr = Math.cos(g.rot);
    const sr = Math.sin(g.rot);
    const x = g.rx * Math.cos(t);
    const y = g.ry * Math.sin(t);
    return [g.c[0] + x * cr - y * sr, g.c[1] + x * sr + y * cr];
  };
  return [pt(g.t0), pt(g.t1)];
}
/**
 * Uzavřená dráha → otevřená se spojovacím úsekem (vzhled stejný). Chromium počítá `closePath()` úměrně velikosti
 * rozpracované dráhy plátna (renderer kreslí všechny dráhy jedné barvy / tloušťky jednou cestou) – 5000 rámečků
 * tolerancí s kroužky trvalo 2,8 s na snímek. Poznámky proto uzavřené dráhy plátnu nepředávají.
 */
export function openPath(pr: Prim): Prim {
  if (pr.k !== "path" || !pr.closed || !pr.segs.length) return pr;
  const s0 = segEnds(pr.segs[0])[0];
  const e1 = segEnds(pr.segs[pr.segs.length - 1])[1];
  const segs = Math.hypot(s0[0] - e1[0], s0[1] - e1[1]) > 1e-12 ? [...pr.segs, { k: "L" as const, a: e1, b: s0 }] : pr.segs;
  const { closed: _c, ...rest } = pr;
  void _c;
  return { ...rest, segs };
}
/** primitiva poznámky pro plátno: bez uzavřených drah, výplně sloučené do jedné (sudo-liché pravidlo, díly se nepřekrývají) */
export function compactPrims(list: Prim[]): Prim[] {
  const out: Prim[] = [];
  let fill: Extract<Prim, { k: "fill" }> | null = null;
  for (const pr of list) {
    if (pr.k === "fill") {
      if (fill) fill.rings.push(...pr.rings);
      else out.push((fill = { k: "fill", rings: [...pr.rings] }));
    } else out.push(openPath(pr));
  }
  return out;
}

