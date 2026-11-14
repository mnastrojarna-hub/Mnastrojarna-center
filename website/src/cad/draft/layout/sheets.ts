/**
 * BALÍK 3 (layout) – rozvržení (papírový prostor): formáty listů A4–A0 (ISO 216), rámeček ISO 5457, rohové razítko
 * ČSN EN ISO 7200 (stejné jako u výkresu 3D dílu) jako blok s atributy, výřez s měřítkem ISO 5455, změna formátu.
 * Papír: souřadnice v mm; počátek = levý dolní roh tisknutelné plochy (jako AutoCAD; u nových rozvržení = roh listu,
 * okraje 0). Změna okrajů (vzhled stránky) posune entity listu tak, aby zůstaly na stejném místě papíru.
 */
import { tr } from "../../i18n";
import { xfMove, type Box } from "../geom";
import { kindOf } from "../kinds";
import { findLayer } from "../layers";
import { extents } from "../status";
import type { DraftBlock, DraftEntity, DraftLayout, DraftModel, NewEntity, Vec2 } from "../model";
import { attribsFor, findBlock, refreshInserts } from "./blocks";
import type { DAttDef, DInsert, DViewport } from "./types";
import { fitIsoRatio, fold, ratioLabel, ratioToScale, scaleToRatio, unitMm } from "./util";

/** formáty ISO 216 na výšku [šířka, výška] mm */
export const SHEET_SIZES: Record<string, [number, number]> = {
  A0: [841, 1189],
  A1: [594, 841],
  A2: [420, 594],
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
};
export const SHEET_NAMES = ["A4", "A3", "A2", "A1", "A0"];

/** formát ze zápisu: „A3“, „a4“, „420x297“ → rozměry na výšku a název; null = neznámý */
export function parseSheet(t: string | undefined): { size: string; w: number; h: number } | null {
  if (!t) return null;
  const s = t.trim().toUpperCase();
  const iso = /^(A[0-5])$/.exec(s.replace(/^ISO[_-]?/, "").replace(/[_-]?\(.*$/, ""));
  if (iso) {
    const [w, h] = SHEET_SIZES[iso[1]];
    return { size: iso[1], w, h };
  }
  const m = /^(\d+(?:[.,]\d+)?)\s*[X×*]\s*(\d+(?:[.,]\d+)?)$/.exec(s);
  if (m) {
    const a = Number(m[1].replace(",", "."));
    const b = Number(m[2].replace(",", "."));
    if (a > 0 && b > 0) return { size: `${a}x${b}`, w: Math.min(a, b), h: Math.max(a, b) };
  }
  return null;
}

/** list v papírových souřadnicích (počátek v rohu tisknutelné plochy) */
export function sheetRect(l: DraftLayout): Box {
  const [ml, mb] = l.paper?.margins ?? [0, 0, 0, 0];
  const w = l.paper?.w ?? 420;
  const h = l.paper?.h ?? 297;
  return { x0: -ml, y0: -mb, x1: w - ml, y1: h - mb };
}
/** tisknutelná plocha */
export function printableRect(l: DraftLayout): Box {
  const s = sheetRect(l);
  const [ml, mb, mr, mt] = l.paper?.margins ?? [0, 0, 0, 0];
  return { x0: s.x0 + ml, y0: s.y0 + mb, x1: s.x1 - mr, y1: s.y1 - mt };
}

export const layoutsOf = (m: DraftModel): DraftLayout[] => [...(m.layouts ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
/** rozvržení podle id nebo názvu (bez ohledu na velikost písmen a diakritiku) */
export function findLayout(m: DraftModel, key: string): DraftLayout | undefined {
  const ls = m.layouts ?? [];
  return ls.find((l) => l.id === key) ?? ls.find((l) => l.name === key) ?? ls.find((l) => fold(l.name) === fold(key));
}
export function newLayoutId(m: DraftModel): string {
  let n = 1;
  const ids = new Set((m.layouts ?? []).map((l) => l.id));
  while (ids.has(`L${n}`)) n++;
  return `L${n}`;
}
export function uniqueLayoutName(m: DraftModel, base?: string): string {
  const names = new Set((m.layouts ?? []).map((l) => l.name.toLowerCase()));
  if (base && !names.has(base.toLowerCase())) return base;
  for (let n = (m.layouts?.length ?? 0) + 1; ; n++) {
    const c = base ? `${base} (${n})` : tr("Rozvržení{0}", n);
    if (!names.has(c.toLowerCase())) return c;
  }
}

// ---------------------------------------------------------------- rámeček ISO 5457 a razítko ISO 7200

export const TITLE_BLOCK = "ISO7200_TITLE";
export const frameBlockName = (size: string, landscape: boolean) => `ISO5457_${size}${landscape ? "L" : "P"}`;
export const isFrameBlock = (n: string) => /^ISO5457_/i.test(n);
/** okraje rámečku ISO 5457: vlevo 20 (vazba), jinde 10 mm */
export const FRAME = { left: 20, other: 10 };
/** rozměr razítka ISO 7200 */
export const TB = { w: 180, h: 38 };

type NE = NewEntity & { id: string; layer: string };
let localSeq = 0;
const lid = () => `b${++localSeq}`;
const pl = (pts: Vec2[], lw: number, closed = false, extra: Partial<NE> = {}): DraftEntity => ({ type: "polyline", id: lid(), layer: "0", pts, ...(closed ? { closed: true } : {}), lineweight: lw, color: "ByBlock", ...extra }) as DraftEntity;
const ln = (a: Vec2, b: Vec2, lw: number): DraftEntity => ({ type: "line", id: lid(), layer: "0", a, b, lineweight: lw, color: "ByBlock" }) as DraftEntity;
const tx = (p: Vec2, h: number, s: string, extra: Partial<NE> = {}): DraftEntity => ({ type: "text", id: lid(), layer: "0", p, h, s, color: "ByBlock", ...extra }) as DraftEntity;
const ad = (tag: string, prompt: string, def: string, p: Vec2, h: number, extra: Partial<DAttDef> = {}): DraftEntity => ({ type: "attdef", id: lid(), layer: "0", tag, prompt, def, p, h, color: "ByBlock", ...extra }) as DraftEntity;
/** výška verzálek z velikosti písma razítka 3D výkresu */
const H = (size: number) => Math.round(size * 0.711 * 100) / 100;

/** blok rámečku ISO 5457 pro list W × H (čára 0,7 mm, centrovací značky) */
export function frameBlock(size: string, landscape: boolean, W: number, Hh: number): DraftBlock {
  const L = FRAME.left;
  const M = FRAME.other;
  const cx = (L + W - M) / 2;
  const cy = Hh / 2;
  return {
    name: frameBlockName(size, landscape),
    base: [0, 0],
    desc: tr("Rámeček ISO 5457 – {0} {1}", size, landscape ? tr("na šířku") : tr("na výšku")),
    entities: [
      pl([[L, M], [W - M, M], [W - M, Hh - M], [L, Hh - M]], 0.7, true),
      ln([cx, 0], [cx, M + 5], 0.7),
      ln([cx, Hh], [cx, Hh - M - 5], 0.7),
      ln([0, cy], [L + 5, cy], 0.7),
      ln([W, cy], [W - M - 5, cy], 0.7),
      pl([[0, 0], [W, 0], [W, Hh], [0, Hh]], 0.13, true),
    ],
  };
}

/**
 * Blok rohového razítka ČSN EN ISO 7200 (180 × 38 mm, stejné rozvržení jako razítko výkresu 3D dílu): firma,
 * promítání ISO E, atributy NAZEV, CISLO_VYKRESU, MATERIAL, MERITKO, FORMAT, HMOTNOST, KRESLIL, DATUM, REVIZE, nad
 * razítkem POZNAMKA a LIST. Bod vložení = pravý dolní roh.
 */
export function titleBlock(): DraftBlock {
  const W = TB.w;
  const Hh = TB.h;
  const y = (yDown: number) => Hh - yDown;
  const L = 55;
  const r1 = 13;
  const r2 = 25.5;
  const ents: DraftEntity[] = [
    pl([[0, 0], [W, 0], [W, Hh], [0, Hh]], 0.7, true),
    ln([L, 0], [L, Hh], 0.35),
    ln([L, y(r1)], [W, y(r1)], 0.35),
    ln([L, y(r2)], [W, y(r2)], 0.35),
    ln([115, y(r1)], [115, y(r2)], 0.35),
    ...[75, 92, 117, 145, 166].map((vx) => ln([vx, y(r2)], [vx, 0], 0.35)),
    ln([0, y(21)], [L, y(21)], 0.35),
    tx([3, y(8.5)], H(4.6), "Mnástrojárna s.r.o.", { color: "#e03930" }),
    tx([3, y(13.5)], H(2.6), tr("Váš partner ve strojírenství")),
    tx([3, y(18)], H(2.4), "www.mnastrojarna.cz"),
    tx([3, y(25)], H(2), tr("Promítání")),
    tx([30, y(33)], H(3), "ISO E"),
  ];
  // značka promítání ISO 5456-2 (metoda E): komolý kužel – lichoběžník a dvě soustředné kružnice
  const sy = 27.5;
  const sh = 7;
  const tx0 = 4;
  ents.push(pl([[tx0, y(sy)], [tx0 + 9, y(sy + 1.75)], [tx0 + 9, y(sy + 5.25)], [tx0, y(sy + 7)]], 0.35, true));
  ents.push(ln([tx0 - 1.5, y(sy + sh / 2)], [tx0 + 10.5, y(sy + sh / 2)], 0.18));
  const ccx = tx0 + 9 + 4 + sh / 2;
  for (const r of [sh / 2, sh / 4]) ents.push({ type: "circle", id: lid(), layer: "0", c: [ccx, y(sy + sh / 2)], r, lineweight: 0.35, color: "ByBlock" } as DraftEntity);
  ents.push(ln([ccx - sh / 2 - 1.5, y(sy + sh / 2)], [ccx + sh / 2 + 1.5, y(sy + sh / 2)], 0.18), ln([ccx, y(sy - 1.5)], [ccx, y(sy + sh + 1.5)], 0.18));
  // popisky a atributy buněk
  const cell = (cx: number, cy: number, label: string, tag: string, prompt: string, def: string, size = 3.2) => {
    ents.push(tx([cx + 1.5, y(cy + 3.2)], H(2), label));
    ents.push(ad(tag, prompt, def, [cx + 1.5, y(cy + 3.2 + size + 2.6)], H(size)));
  };
  cell(L, 0, tr("Název"), "NAZEV", tr("Název výkresu"), tr("Bez názvu"), 4.2);
  cell(L, r1, tr("Číslo výkresu"), "CISLO_VYKRESU", tr("Číslo výkresu"), "", 3.4);
  cell(115, r1, tr("Materiál"), "MATERIAL", tr("Materiál"), "");
  cell(L, r2, tr("Měřítko"), "MERITKO", tr("Měřítko"), "1:1");
  cell(75, r2, tr("Formát"), "FORMAT", tr("Formát"), "A3");
  cell(92, r2, tr("Hmotnost"), "HMOTNOST", tr("Hmotnost"), "—");
  cell(117, r2, tr("Kreslil"), "KRESLIL", tr("Kreslil"), "");
  cell(145, r2, tr("Datum"), "DATUM", tr("Datum"), "", 2.8);
  cell(166, r2, "Rev.", "REVIZE", tr("Revize"), "–");
  ents.push(ad("POZNAMKA", tr("Poznámka nad razítkem"), tr("Rozměry v mm"), [0, Hh + 5.5], H(2.5)));
  ents.push(ad("LIST", tr("List"), tr("List {0}/{1}", 1, 1), [0, Hh + 1.8], H(2.5)));
  return { name: TITLE_BLOCK, base: [W, 0], desc: tr("Rohové razítko ČSN EN ISO 7200"), entities: ents };
}

/** zajistí definici bloku v modelu (existující se nemění); `nid` = id entit bloku ve tvaru e<n> (adresovatelné textem) */
export function ensureBlock(m: DraftModel, b: DraftBlock, nid?: () => string): DraftModel {
  if (findBlock(m, b.name)) return m;
  const blk = nid ? { ...b, entities: b.entities.map((e) => ({ ...e, id: nid() })) } : b;
  return { ...m, blocks: [...(m.blocks ?? []), blk] };
}

// ---------------------------------------------------------------- nové rozvržení

export type NewLayoutOpts = {
  name?: string;
  /** formát (A4–A0 nebo „ŠxV“) */
  size?: string;
  landscape?: boolean;
  /** rámeček ISO 5457 (výchozí ano) */
  frame?: boolean;
  /** razítko ISO 7200 (výchozí ano) */
  titleBlock?: boolean;
  /** výřez přes kreslicí plochu (výchozí ano) */
  viewport?: boolean;
  /** měřítko výřezu (papír : skutečnost), „fit“ = největší ISO, při kterém se model vejde (výchozí) */
  ratio?: number | "fit";
  /** hodnoty atributů razítka (NAZEV, CISLO_VYKRESU, MATERIAL…) */
  values?: Record<string, string>;
  /** hladina výřezu (výchozí aktuální) */
  vpLayer?: string;
};

/** kreslicí plocha listu pro výřez: uvnitř rámečku 5 mm od něj, nad razítkem */
export function drawingArea(W: number, Hh: number, frame: boolean, title: boolean): Box {
  const g = 5;
  const x0 = (frame ? FRAME.left : 10) + g;
  const x1 = W - (frame ? FRAME.other : 10) - g;
  const y0 = (frame ? FRAME.other : 10) + (title ? TB.h + 8 : 0) + g;
  const y1 = Hh - (frame ? FRAME.other : 10) - g;
  return { x0, y0, x1, y1 };
}

/** výřez vyplňující obdélník na papíře: měřítko podle zadání nebo největší ISO, při kterém se model vejde */
export function viewportFor(m: DraftModel, area: Box, ratio: number | "fit" = "fit", layer?: string): Omit<DViewport, "id"> {
  const w = area.x1 - area.x0;
  const h = area.y1 - area.y0;
  const ex = extents(m, m.entities);
  const um = unitMm(m);
  let r: number;
  let vc: Vec2;
  if (ex) {
    vc = [(ex.x0 + ex.x1) / 2, (ex.y0 + ex.y1) / 2];
    r = ratio === "fit" ? fitIsoRatio(Math.max(1e-9, (ex.x1 - ex.x0) * um), Math.max(1e-9, (ex.y1 - ex.y0) * um), w, h) : ratio;
  } else {
    r = ratio === "fit" ? 1 : ratio;
    const sc = ratioToScale(m, r);
    vc = [w / 2 / sc, h / 2 / sc];
  }
  return { type: "viewport", layer: layer ?? m.vars.clayer, c: [(area.x0 + area.x1) / 2, (area.y0 + area.y1) / 2], w, h, viewCenter: vc, scale: ratioToScale(m, r) };
}

/**
 * Přidá rozvržení (list papíru) s rámečkem, razítkem a výřezem. `nid` přiděluje id entit (DraftTx.newId).
 * Vrací nový model a id rozvržení.
 */
export function addLayout(m0: DraftModel, opts: NewLayoutOpts, nid: () => string): { model: DraftModel; id: string } {
  const sh = parseSheet(opts.size ?? "A3");
  if (!sh) throw new Error(tr("neznámý formát „{0}“ – A4, A3, A2, A1, A0 nebo šířka×výška v mm", opts.size ?? ""));
  const landscape = opts.landscape ?? true;
  const W = landscape ? sh.h : sh.w;
  const Hh = landscape ? sh.w : sh.h;
  let m = m0;
  const id = newLayoutId(m);
  const frame = opts.frame ?? true;
  const title = opts.titleBlock ?? true;
  const ents: DraftEntity[] = [];
  if (frame) {
    m = ensureBlock(m, frameBlock(sh.size, landscape, W, Hh), nid);
    ents.push({ type: "insert", id: nid(), layer: "0", block: frameBlockName(sh.size, landscape), p: [0, 0], sx: 1, sy: 1, rot: 0 } as DInsert);
  }
  let vp: DViewport | null = null;
  if (opts.viewport ?? true) {
    const lay = opts.vpLayer && findLayer(m, opts.vpLayer) ? findLayer(m, opts.vpLayer)!.name : undefined;
    vp = { ...viewportFor(m, drawingArea(W, Hh, frame, title), opts.ratio ?? "fit", lay), id: nid() } as DViewport;
    ents.push(vp);
  }
  if (title) {
    m = ensureBlock(m, titleBlock(), nid);
    const blk = findBlock(m, TITLE_BLOCK)!;
    const ins: Omit<DInsert, "id" | "layer" | "attribs"> = { type: "insert", block: TITLE_BLOCK, p: [W - (frame ? FRAME.other : 10), frame ? FRAME.other : 10], sx: 1, sy: 1, rot: 0 };
    const values: Record<string, string> = { FORMAT: sh.size, MERITKO: vp ? ratioLabel(scaleToRatio(m, vp.scale)) : "1:1", DATUM: new Date().toISOString().slice(0, 10), ...(opts.values ?? {}) };
    ents.push({ ...ins, id: nid(), layer: "0", attribs: attribsFor(m, blk, ins, values) } as DInsert);
  }
  const order = Math.max(0, ...(m.layouts ?? []).map((l) => (l.order ?? 0) + 1));
  const layout: DraftLayout = {
    id,
    name: uniqueLayoutName(m, opts.name),
    entities: ents,
    order,
    paper: { size: sh.size, w: W, h: Hh, units: "mm", landscape, margins: [0, 0, 0, 0] },
  };
  return { model: { ...m, layouts: [...(m.layouts ?? []), layout] }, id };
}

/** posun entity papíru (vložení i s atributy, výřez s ořezem) */
function shiftEntity(m: DraftModel, e: DraftEntity, d: Vec2): DraftEntity {
  if (!d[0] && !d[1]) return e;
  return (kindOf(e)?.transform(e, xfMove(d[0], d[1]), { model: m }) as DraftEntity | null) ?? e;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Změní formát / orientaci listu: rámeček ISO 5457 se vymění, razítko se přesune do pravého dolního rohu a výchozí
 * výřez (ten, který vyplňoval kreslicí plochu starého listu) se přizpůsobí kreslicí ploše nového listu – s měřítkem
 * „vejít“ znovu spočítaným, pokud bylo původní měřítko to, které „vejít“ zvolilo. Ostatní výřezy zůstanou.
 */
export function setLayoutPaper(m0: DraftModel, layoutId: string, size: string, landscape: boolean, nid?: () => string): DraftModel {
  const sh = parseSheet(size);
  if (!sh) throw new Error(tr("neznámý formát „{0}“ – A4, A3, A2, A1, A0 nebo šířka×výška v mm", size));
  const W = landscape ? sh.h : sh.w;
  const Hh = landscape ? sh.w : sh.h;
  let m = m0;
  const l = (m.layouts ?? []).find((x) => x.id === layoutId);
  if (!l) throw new Error(tr("rozvržení {0} neexistuje", layoutId));
  const hasFrame = l.entities.some((e) => e.type === "insert" && isFrameBlock((e as DInsert).block));
  const hasTitle = l.entities.some((e) => e.type === "insert" && (e as DInsert).block === TITLE_BLOCK);
  if (hasFrame) m = ensureBlock(m, frameBlock(sh.size, landscape, W, Hh), nid);
  // počátek papíru = roh tisknutelné plochy → roh listu je v (−vlevo, −dole)
  const sr0 = sheetRect(l);
  const o: Vec2 = [sr0.x0, sr0.y0];
  const a0 = drawingArea(sr0.x1 - sr0.x0, sr0.y1 - sr0.y0, hasFrame, hasTitle);
  const a1 = drawingArea(W, Hh, hasFrame, hasTitle);
  const ex = extents(m, m.entities);
  const um = unitMm(m);
  const entities = l.entities.map((e) => {
    if (e.type === "viewport") {
      const v = e as DViewport;
      const c0: Vec2 = [(a0.x0 + a0.x1) / 2 + o[0], (a0.y0 + a0.y1) / 2 + o[1]];
      const isDefault = !v.clip && !v.twist && near(v.c[0], c0[0]) && near(v.c[1], c0[1]) && near(v.w, a0.x1 - a0.x0) && near(v.h, a0.y1 - a0.y0);
      if (!isDefault) return e;
      const area: Box = { x0: a1.x0 + o[0], y0: a1.y0 + o[1], x1: a1.x1 + o[0], y1: a1.y1 + o[1] };
      const out: DViewport = { ...v, c: [(area.x0 + area.x1) / 2, (area.y0 + area.y1) / 2], w: area.x1 - area.x0, h: area.y1 - area.y0 };
      if (!v.locked && ex) {
        const fitOld = fitIsoRatio(Math.max(1e-9, (ex.x1 - ex.x0) * um), Math.max(1e-9, (ex.y1 - ex.y0) * um), a0.x1 - a0.x0, a0.y1 - a0.y0);
        if (near(scaleToRatio(m, v.scale), fitOld)) {
          const nv = viewportFor(m, area, "fit", v.layer);
          out.scale = nv.scale;
          out.viewCenter = nv.viewCenter;
        }
      }
      return out;
    }
    if (e.type !== "insert") return e;
    const i = e as DInsert;
    if (isFrameBlock(i.block)) return { ...i, block: frameBlockName(sh.size, landscape), p: o };
    if (i.block === TITLE_BLOCK) {
      const p: Vec2 = [W - (hasFrame ? FRAME.other : 10) + o[0], (hasFrame ? FRAME.other : 10) + o[1]];
      const d: Vec2 = [p[0] - i.p[0], p[1] - i.p[1]];
      return { ...i, p, attribs: (i.attribs ?? []).map((a) => ({ ...a, p: [a.p[0] + d[0], a.p[1] + d[1]] as Vec2, ...(a.p2 ? { p2: [a.p2[0] + d[0], a.p2[1] + d[1]] as Vec2 } : {}), ...(a.tag === "FORMAT" ? { value: sh.size } : {}) })) };
    }
    return e;
  });
  const margins = l.paper?.margins ?? [0, 0, 0, 0];
  const out = {
    ...m,
    layouts: (m.layouts ?? []).map((x) => (x.id === layoutId ? { ...x, entities, paper: { ...(x.paper ?? { units: "mm" as const, margins }), size: sh.size, w: W, h: Hh, landscape, units: x.paper?.units ?? "mm", margins } } : x)),
  };
  const prevLabel = (() => {
    const v = l.entities.find((e) => e.type === "viewport") as DViewport | undefined;
    return v ? ratioLabel(scaleToRatio(m, v.scale)) : undefined;
  })();
  return syncTitleScale(out, layoutId, prevLabel);
}

/**
 * Okraje tisku [vlevo, dole, vpravo, nahoře] mm. Počátek papíru je roh tisknutelné plochy, proto se entity listu posunou
 * o rozdíl okrajů – rámeček, razítko i výřezy zůstanou na stejném místě papíru (tisk je jen ořízne na tisknutelnou plochu).
 */
export function setLayoutMargins(m: DraftModel, layoutId: string, margins: [number, number, number, number]): DraftModel {
  const l = (m.layouts ?? []).find((x) => x.id === layoutId);
  if (!l) throw new Error(tr("rozvržení {0} neexistuje", layoutId));
  const w = l.paper?.w ?? 420;
  const h = l.paper?.h ?? 297;
  if (margins[0] + margins[2] >= w || margins[1] + margins[3] >= h) throw new Error(tr("okraje jsou větší než list ({0}×{1} mm)", w, h));
  const [ml0, mb0] = l.paper?.margins ?? [0, 0, 0, 0];
  const d: Vec2 = [ml0 - margins[0], mb0 - margins[1]];
  const entities = d[0] || d[1] ? l.entities.map((e) => shiftEntity(m, e, d)) : l.entities;
  return { ...m, layouts: (m.layouts ?? []).map((x) => (x.id === layoutId ? { ...x, entities, paper: { ...(x.paper ?? { size: "A3", w, h, units: "mm" as const, landscape: true }), margins } } : x)) };
}

/** výřezy rozvržení, které nejsou celé na listu (po změně formátu) */
export function viewportsOffSheet(l: DraftLayout): string[] {
  const s = sheetRect(l);
  const tol = 1e-6;
  return l.entities
    .filter((e) => e.type === "viewport")
    .filter((e) => {
      const v = e as DViewport;
      const pts = v.clip && v.clip.length >= 3 ? v.clip : [[v.c[0] - v.w / 2, v.c[1] - v.h / 2], [v.c[0] + v.w / 2, v.c[1] + v.h / 2]];
      return pts.some((p) => p[0] < s.x0 - tol || p[1] < s.y0 - tol || p[0] > s.x1 + tol || p[1] > s.y1 + tol);
    })
    .map((e) => e.id);
}

/** razítko rozvržení: atribut MERITKO = měřítko prvního výřezu (jen když razítko měřítko ukazuje) */
export function syncTitleScale(m: DraftModel, layoutId: string, prevLabel?: string): DraftModel {
  const l = (m.layouts ?? []).find((x) => x.id === layoutId);
  if (!l) return m;
  const vp = l.entities.find((e) => e.type === "viewport") as DViewport | undefined;
  if (!vp) return m;
  const label = ratioLabel(scaleToRatio(m, vp.scale));
  let changed = false;
  const entities = l.entities.map((e) => {
    if (e.type !== "insert" || (e as DInsert).block !== TITLE_BLOCK) return e;
    const i = e as DInsert;
    const at = (i.attribs ?? []).map((a) => {
      if (a.tag !== "MERITKO" || a.value === label || (prevLabel !== undefined && a.value !== prevLabel)) return a;
      changed = true;
      return { ...a, value: label };
    });
    return changed ? { ...i, attribs: at } : i;
  });
  return changed ? { ...m, layouts: (m.layouts ?? []).map((x) => (x.id === layoutId ? { ...x, entities } : x)) } : m;
}

/** kopie rozvržení (nová id entit) */
export function copyLayout(m: DraftModel, layoutId: string, name: string | undefined, nid: () => string): { model: DraftModel; id: string } {
  const l = (m.layouts ?? []).find((x) => x.id === layoutId);
  if (!l) throw new Error(tr("rozvržení {0} neexistuje", layoutId));
  const id = newLayoutId(m);
  const order = Math.max(0, ...(m.layouts ?? []).map((x) => (x.order ?? 0) + 1));
  const copy: DraftLayout = { ...l, id, name: uniqueLayoutName(m, name ?? l.name), order, entities: l.entities.map((e) => ({ ...e, id: nid() })) };
  return { model: { ...m, layouts: [...(m.layouts ?? []), copy] }, id };
}

/** po změně definice bloku obnoví vložení (re-export pro příkazy) */
export { refreshInserts };
