/**
 * Listy předlohy. AutoCAD Mechanical má všechny listy v MODELOVÉM prostoru jako vložení rámečku a razítka (XDATA
 * GENIUS_GENTITLE_13 na pomocném bodu: rámeček, razítko, měřítko) – rozvržení jsou prázdná. Jinak: vložení bloku nebo
 * obdélník velikosti formátu ISO (A0–A4, i zvětšený měřítkem), nakonec celý rozsah výkresu jako jeden list.
 */
import { entityBox, type KindCtx } from "../draft/kinds";
import type { DraftEntity, DraftModel, Vec2 } from "../draft/model";
import type { XRec } from "../draft/io/types";
import { extents } from "../draft/status";
import { xfPt } from "../draft/geom";
import { findBlock } from "../draft/layout/blocks";
import { flatten, insertXf } from "./geom";
import type { RefBox, RefSheet, RefTitle } from "./types";

export const ISO_SHEETS: [string, number, number][] = [
  ["A0", 1189, 841],
  ["A1", 841, 594],
  ["A2", 594, 420],
  ["A3", 420, 297],
  ["A4", 297, 210],
];
const STD_K = [1, 2, 2.5, 4, 5, 10, 20, 50, 100, 0.5, 0.4, 0.25, 0.2, 0.1, 0.05];

/** měřítko z textu: „1:2“ → 0,5, „5:1“ → 5, „M 1:1,2“ → 0,833 */
export function parseScale(s: string | undefined): number | undefined {
  const m = /(\d+(?:[.,]\d+)?)\s*:\s*(\d+(?:[.,]\d+)?)/.exec(s ?? "");
  if (!m) return undefined;
  const a = parseFloat(m[1].replace(",", "."));
  const b = parseFloat(m[2].replace(",", "."));
  return a > 0 && b > 0 ? a / b : undefined;
}
/** text měřítka z hodnoty (0,5 → „1:2“, 5 → „5:1“) */
export function scaleText(v: number): string {
  const r = (x: number) => +x.toFixed(3);
  return v >= 1 ? `${r(v)}:1` : `1:${r(1 / v)}`;
}

/** formát ISO podle rozměru (±1,5 %), i bez okrajů rámečku (20/10 mm, 10 mm dokola) */
export function isoSize(w: number, h: number): { size: string; w: number; h: number } | null {
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.015 * b;
  for (const [n, W, H] of ISO_SHEETS) {
    for (const [ww, hh] of [[W, H], [H, W]])
      for (const [mw, mh] of [[0, 0], [30, 20], [20, 20]]) if (near(w, ww - mw) && near(h, hh - mh)) return { size: n, w: ww, h: hh };
  }
  return null;
}

/** hodnoty skupiny XDATA „{ klíč hodnota… }“ */
export function xget(recs: XRec[] | undefined, key: string): unknown[] {
  if (!recs) return [];
  for (let i = 0; i + 1 < recs.length; i++) {
    if (recs[i][0] === 1002 && recs[i][1] === "{" && recs[i + 1][1] === key) {
      const out: unknown[] = [];
      for (let j = i + 2; j < recs.length && !(recs[j][0] === 1002 && recs[j][1] === "}"); j++) out.push(recs[j][1]);
      return out;
    }
  }
  return [];
}

/**
 * Pole razítka podle názvu atributu – vzory v pořadí přednosti (první nalezený vzor vyhrává, ne pořadí atributů).
 * AutoCAD Mechanical: GEN-TITLE-DES1 / DES2 = název výkresu (FAM-SEST ho má v DES2), GEN-TITLE-NAME = jméno
 * kreslícího (ne název!), 5GENST = název dílu v razítku výrobního výkresu.
 */
const TITLE_KEYS: [keyof RefTitle, RegExp[]][] = [
  ["name", [/^(nazev|název|title|benennung|bezeichnung|titel)$/i, /^5genst$/i, /^gen-title-des1$/i, /^gen-title-des2$/i, /^(name|popis|description)$/i]],
  ["number", [/^(cislo|číslo|cislo-vykresu|číslo-výkresu|dwg_?no|drawing_?no|number|zeichnungsnummer|č\.?v\.?)$/i, /^(gen-title-nr|gen-title-dwg)$/i]],
  ["material", [/^(material|materiál|werkstoff|mat)$/i, /^9genst$/i]],
  ["scale", [/^(meritko|měřítko|scale|massstab|maßstab)$/i, /^gen-title-sca$/i]],
  ["author", [/^(kreslil|drawn|author|autor|gezeichnet)$/i, /^(gen-title-dra|gen-title-author|gen-title-name)$/i]],
  ["date", [/^(datum|date)$/i, /^(gen-title-dat|gen-title-date)$/i]],
  ["pos", [/^(pos|poz|pozice|position|item)$/i]],
  ["qty", [/^(ks|qty|pocet|počet|menge)$/i, /^2genst$/i]],
  ["dim", [/^(rozmer|rozměr|dim|dimension|abmessung|polotovar|stock)$/i, /^14genst$/i]],
  ["treatment", [/^(treatment|tepelne|tepelné|zpracovani|zpracování|behandlung)$/i, /^17genst$/i]],
];

/** razítko z atributů vložení */
export function titleOf(ins: DraftEntity & { attribs?: { tag: string; value: string }[]; block?: string }, sheet: number): RefTitle {
  const fields: Record<string, string> = {};
  for (const a of ins.attribs ?? []) if (a.value?.trim()) fields[a.tag] = a.value.trim();
  const t: RefTitle = { sheet, block: ins.block, fields };
  const tags = Object.keys(fields);
  for (const [k, res] of TITLE_KEYS) {
    for (const re of res) {
      const tag = tags.find((x) => re.test(x));
      if (tag) {
        (t as Record<string, unknown>)[k] = fields[tag];
        break;
      }
    }
  }
  return t;
}

const boxC = (b: RefBox): Vec2 => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
const inside = (p: Vec2, b: RefBox, m = 0) => p[0] >= b.x0 - m && p[0] <= b.x1 + m && p[1] >= b.y0 - m && p[1] <= b.y1 + m;

/** obdélník rámečku: jen čáry a křivky bloku (texty a atributy rámečku mohou přesahovat) */
function frameBox(model: DraftModel, ins: DraftEntity): RefBox | null {
  const blk = findBlock(model, (ins as { block?: string }).block ?? "");
  if (!blk) return null;
  const xf = insertXf(ins as DraftEntity & { p: Vec2 }, blk.base);
  const { geom } = flatten(model, { list: blk.entities, texts: false });
  let b: RefBox | null = null;
  for (const g of geom) {
    if (g.curve.k !== "line") continue;
    for (const q of [g.curve.a, g.curve.b]) {
      const p = xfPt(xf, q);
      b = b ? { x0: Math.min(b.x0, p[0]), y0: Math.min(b.y0, p[1]), x1: Math.max(b.x1, p[0]), y1: Math.max(b.y1, p[1]) } : { x0: p[0], y0: p[1], x1: p[0], y1: p[1] };
    }
  }
  return b && b.x1 - b.x0 > 0 && b.y1 - b.y0 > 0 ? b : null;
}

/**
 * Osově rovnoběžné obdélníky z čar a úseků křivek modelového prostoru: dvě vodorovné úsečky (i složené z více čar)
 * se stejným rozsahem v X a svislé strany mezi nimi. Vrací obálku a id entit stran.
 */
export function rectangles(model: DraftModel, minSide = 10): { box: RefBox; ids: string[] }[] {
  type Run = { c: number; a: number; b: number; ids: Set<string> };
  const H = new Map<string, Run[]>();
  const V = new Map<string, Run[]>();
  const key = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
  const add = (m: Map<string, Run[]>, c: number, a: number, b: number, id: string) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (hi - lo < 1e-9) return;
    const k = key(c);
    (m.get(k) ?? m.set(k, []).get(k)!).push({ c, a: lo, b: hi, ids: new Set([id]) });
  };
  const seg = (p: Vec2, q: Vec2, id: string) => {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < minSide * 0.05) return;
    if (Math.abs(q[1] - p[1]) <= 1e-6 * Math.max(1, L)) add(H, (p[1] + q[1]) / 2, p[0], q[0], id);
    else if (Math.abs(q[0] - p[0]) <= 1e-6 * Math.max(1, L)) add(V, (p[0] + q[0]) / 2, p[1], q[1], id);
  };
  for (const e of model.entities) {
    if (e.ext?.invisible) continue;
    if (e.type === "line") seg((e as { a: Vec2 }).a, (e as { b: Vec2 }).b, e.id);
    else if (e.type === "polyline") {
      const pl = e as { pts: Vec2[]; closed?: boolean; bulges?: number[] };
      const n = pl.pts.length;
      for (let i = 0; i + 1 < n + (pl.closed ? 1 : 0); i++) if (!pl.bulges?.[i]) seg(pl.pts[i], pl.pts[(i + 1) % n], e.id);
    }
  }
  // souvislé úseky na téže přímce (rámeček z více čar) – tolerance na spáry
  const merge = (m: Map<string, Run[]>) => {
    const out = new Map<string, Run[]>();
    for (const [k, rs] of m) {
      rs.sort((x, y) => x.a - y.a);
      const mm: Run[] = [];
      for (const r of rs) {
        const last = mm[mm.length - 1];
        if (last && r.a <= last.b + 0.01) {
          last.b = Math.max(last.b, r.b);
          for (const id of r.ids) last.ids.add(id);
        } else mm.push({ ...r, ids: new Set(r.ids) });
      }
      out.set(k, mm.filter((r) => r.b - r.a >= minSide));
    }
    return out;
  };
  const HM = merge(H);
  const VM = merge(V);
  const covered = (m: Map<string, Run[]>, c: number, a: number, b: number) => {
    for (const k of [key(c), key(c - 0.01), key(c + 0.01)]) for (const r of m.get(k) ?? []) if (r.a <= a + 0.01 && r.b >= b - 0.01) return r;
    return null;
  };
  // vodorovné strany podle rozsahu v X
  const byX = new Map<string, Run[]>();
  for (const rs of HM.values()) for (const r of rs) {
    const k = `${key(r.a)}|${key(r.b)}`;
    (byX.get(k) ?? byX.set(k, []).get(k)!).push(r);
  }
  const res: { box: RefBox; ids: string[] }[] = [];
  const seen = new Set<string>();
  for (const rs of byX.values()) {
    if (rs.length < 2) continue;
    rs.sort((x, y) => x.c - y.c);
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++) {
        const lo = rs[i];
        const hi = rs[j];
        if (hi.c - lo.c < minSide) continue;
        const l = covered(VM, lo.a, lo.c, hi.c);
        const r = covered(VM, lo.b, lo.c, hi.c);
        if (!l || !r) continue;
        const box = { x0: lo.a, y0: lo.c, x1: lo.b, y1: hi.c };
        const k = `${key(box.x0)},${key(box.y0)},${key(box.x1)},${key(box.y1)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        res.push({ box, ids: [...new Set([...lo.ids, ...hi.ids, ...l.ids, ...r.ids])] });
      }
  }
  // největší napřed (vnější rámeček dřív než vnitřní a buňky razítka)
  return res.sort((a, b) => (b.box.x1 - b.box.x0) * (b.box.y1 - b.box.y0) - (a.box.x1 - a.box.x0) * (a.box.y1 - a.box.y0));
}

/** listy předlohy */
export function findSheets(model: DraftModel): RefSheet[] {
  const ctx: KindCtx = { model };
  const byHandle = new Map<string, DraftEntity>();
  for (const e of model.entities) if (e.ext?.handle) byHandle.set(e.ext.handle, e);
  const out: Omit<RefSheet, "n">[] = [];
  const used = new Set<string>();
  // 0. předloha z PDF: stránka = list; měřítko z textu „1:2“ / „M 1:2“ na stránce (nejblíž pravému dolnímu rohu)
  for (const f of model.ext?.pdfPages ?? []) {
    const w = f.x1 - f.x0;
    const h = f.y1 - f.y0;
    const iso = isoSize(w, h);
    let scale: string | undefined;
    let bd = Infinity;
    for (const e of model.entities) {
      if (e.type !== "text") continue;
      const t = e as DraftEntity & { p: Vec2; s: string };
      if (!inside(t.p, f) || !/^(?:M\s*|měřítko\s*|scale\s*|maßstab\s*)?\d+(?:[.,]\d+)?\s*:\s*\d+(?:[.,]\d+)?$/i.test(t.s.trim())) continue;
      const d = Math.hypot(f.x1 - t.p[0], t.p[1] - f.y0);
      if (d < bd) {
        bd = d;
        scale = t.s.trim().replace(/^[^\d]+/, "");
      }
    }
    out.push({ size: iso?.size ?? `${Math.round(w)}×${Math.round(h)}`, w, h, frame: f, ...(scale ? { scale, scaleValue: parseScale(scale) } : {}), unitPerMm: 1, source: "page", frameIds: [] });
  }
  // 1. AutoCAD Mechanical: XDATA GENIUS_GENTITLE_* na pomocném bodu
  if (!out.length) for (const e of model.entities) {
    const app = Object.keys(e.ext?.xdata ?? {}).find((k) => /^GENIUS_GENTITLE/i.test(k));
    if (!app) continue;
    const x = e.ext!.xdata![app] as XRec[];
    const border = byHandle.get(String(xget(x, "HRA")[0] ?? ""));
    if (!border || border.type !== "insert") continue;
    const title = byHandle.get(String(xget(x, "HTIT")[0] ?? ""));
    const fb = frameBox(model, border) ?? entityBox(border, ctx);
    if (!fb) continue;
    const sx = Math.abs((border as { sx?: number }).sx ?? 1) || 1;
    const named = ISO_SHEETS.find(([n]) => n === String(xget(x, "BORDER")[0] ?? "").toUpperCase());
    const iso = isoSize((fb.x1 - fb.x0) / sx, (fb.y1 - fb.y0) / sx) ?? (named ? ((fb.x1 - fb.x0) >= (fb.y1 - fb.y0) ? { size: named[0], w: named[1], h: named[2] } : { size: named[0], w: named[2], h: named[1] }) : null);
    const scale = String(xget(x, "SCALE")[0] ?? "") || undefined;
    used.add(border.id);
    if (title) used.add(title.id);
    out.push({
      size: String(xget(x, "BORDER")[0] ?? iso?.size ?? ""),
      w: iso?.w ?? (fb.x1 - fb.x0) / sx,
      h: iso?.h ?? (fb.y1 - fb.y0) / sx,
      frame: fb,
      ...(scale ? { scale, scaleValue: parseScale(scale) } : { scale: `1:${+sx.toFixed(3)}`, scaleValue: 1 / sx }),
      unitPerMm: sx,
      source: "mechanical",
      frameIds: [border.id, ...(title ? [title.id] : [])],
      ...(title ? { title: titleOf(title as DraftEntity & { attribs?: { tag: string; value: string }[] }, 0) } : {}),
    });
  }
  // 2. vložení bloku velikosti formátu ISO (× měřítko vložení)
  if (!out.length) {
    for (const e of model.entities) {
      if (e.type !== "insert" || e.ext?.acm || used.has(e.id)) continue;
      const b = entityBox(e, ctx);
      if (!b) continue;
      const sx = Math.abs((e as { sx?: number }).sx ?? 1) || 1;
      const iso = isoSize((b.x1 - b.x0) / sx, (b.y1 - b.y0) / sx);
      if (!iso) continue;
      used.add(e.id);
      // vložení 1:1 neříká měřítko výkresu (to dá razítko nebo odhad z kót); zvětšené vložení = měřítko 1:sx (geometrie 1:1)
      out.push({ size: iso.size, w: iso.w, h: iso.h, frame: b, ...(sx === 1 ? {} : { scale: `1:${+sx.toFixed(3)}`, scaleValue: 1 / sx }), unitPerMm: sx, source: "insert", frameIds: [e.id] });
    }
  }
  // 3. obdélník velikosti formátu × běžné měřítko – uzavřená křivka i čtyři čáry (DXF z jiných programů, náš export R12)
  if (!out.length) {
    for (const r of rectangles(model)) {
      const b = r.box;
      for (const k of STD_K) {
        const iso = isoSize((b.x1 - b.x0) / k, (b.y1 - b.y0) / k);
        if (!iso) continue;
        if (out.some((s) => Math.abs(s.frame.x0 - b.x0) < 1e-6 && Math.abs(s.frame.y0 - b.y0) < 1e-6 && Math.abs(s.frame.x1 - b.x1) < 1e-6)) break;
        // rámeček 1:1 neříká měřítko výkresu (geometrie může být v měřítku listu) – to dá razítko nebo odhad z kót
        out.push({ size: iso.size, w: iso.w, h: iso.h, frame: b, ...(k === 1 ? {} : { scale: k > 1 ? `1:${k}` : `${1 / k}:1`, scaleValue: 1 / k }), unitPerMm: k, source: "rect", frameIds: r.ids });
        break;
      }
    }
    // obdélník uvnitř většího (vnitřní rámeček, ořez) – ponechat jen vnější, čáry vnitřního patří k rámečku listu
    for (let i = out.length - 1; i >= 0; i--) {
      const f = out[i].frame;
      const outer = out.find((s, j) => j !== i && inside([f.x0, f.y0], s.frame, 1) && inside([f.x1, f.y1], s.frame, 1) && s.frame.x1 - s.frame.x0 > f.x1 - f.x0);
      if (!outer) continue;
      // vnitřní rámeček u okrajů listu (okraj do 30 mm papíru) patří k rámečku; jiný obdélník (obrys dílu) zůstane geometrií
      const m = 30 * outer.unitPerMm;
      const o = outer.frame;
      if (f.x0 - o.x0 <= m && o.x1 - f.x1 <= m && f.y0 - o.y0 <= m && o.y1 - f.y1 <= m) outer.frameIds.push(...out[i].frameIds);
      out.splice(i, 1);
    }
  }
  // 4. celý rozsah jako jeden list
  if (!out.length) {
    const ex = extents(model, model.entities);
    if (ex) out.push({ size: `${Math.round(ex.x1 - ex.x0)}×${Math.round(ex.y1 - ex.y0)}`, w: ex.x1 - ex.x0, h: ex.y1 - ex.y0, frame: ex, unitPerMm: 1, source: "extents", frameIds: [] });
  }
  // razítko: vložení s atributy uvnitř listu (nejblíž pravému dolnímu rohu)
  for (const s of out) {
    if (s.title) continue;
    let best: DraftEntity | null = null;
    let bd = Infinity;
    for (const e of model.entities) {
      const at = (e as { attribs?: unknown[] }).attribs;
      if (e.type !== "insert" || !Array.isArray(at) || at.length < 3 || used.has(e.id)) continue;
      const p = (e as { p: Vec2 }).p;
      if (!inside(p, s.frame, 1)) continue;
      const d = Math.hypot(s.frame.x1 - p[0], p[1] - s.frame.y0);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (best) {
      s.title = titleOf(best as DraftEntity & { attribs?: { tag: string; value: string }[] }, 0);
      s.frameIds.push(best.id);
      used.add(best.id);
    }
    // měřítko z razítka, pokud list sám neříká
    const ts = parseScale(s.title?.scale);
    if (ts && s.source !== "mechanical") {
      s.scale = s.title!.scale;
      s.scaleValue = ts;
    }
  }
  // pořadí: shora dolů, zleva doprava
  out.sort((a, b) => b.frame.y1 - a.frame.y1 || a.frame.x0 - b.frame.x0);
  return out.map((s, i) => ({ ...s, n: i + 1, ...(s.title ? { title: { ...s.title, sheet: i + 1 } } : {}) }));
}

/** list, do kterého bod patří (0 = žádný) */
export function sheetAt(sheets: readonly RefSheet[], p: Vec2): number {
  for (const s of sheets) if (inside(p, s.frame)) return s.n;
  // bod těsně mimo rámeček (kóty u okraje) – nejbližší list do 5 % jeho šířky
  let best = 0;
  let bd = Infinity;
  for (const s of sheets) {
    const c = boxC(s.frame);
    const d = Math.max(Math.abs(p[0] - c[0]) - (s.frame.x1 - s.frame.x0) / 2, Math.abs(p[1] - c[1]) - (s.frame.y1 - s.frame.y0) / 2);
    if (d < bd && d < 0.05 * (s.frame.x1 - s.frame.x0)) {
      bd = d;
      best = s.n;
    }
  }
  return best;
}
