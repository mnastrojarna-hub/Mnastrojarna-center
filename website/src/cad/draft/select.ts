/**
 * Výběr entit 2D výkresu: kliknutím (nejbližší v okruhu), oknem (zleva doprava – celá entita uvnitř),
 * křížením (zprava doleva – entita okno protne nebo je uvnitř), podle hladiny / druhu / barvy, a zápis výběru textem
 * (`vše`, `e3 e5`, `okno x,y x,y`, `křížení x,y x,y`, `hladina OSY`, `typ line`, `poslední`, `předchozí`, `odebrat …`).
 */
import { tr } from "../i18n";
import { cIntersect, type Curve } from "./curves";
import { boxHits, boxInside, inBox, type Box } from "./geom";
import { entityBox, entityCurves, entityDist, kinds, type KindCtx } from "./kinds";
import { findLayer, layerVisible } from "./layers";
import { entityById, type DraftEntity, type DraftModel, type Vec2 } from "./model";
import type { DraftSession } from "./session";
import type { SpatialIndex } from "./spatial";
import { parseColor } from "./colors";

/** Nejbližší viditelná entita v okruhu `tol` od bodu (u stejné vzdálenosti později nakreslená – je nahoře). */
export function pickEntity(model: DraftModel, idx: SpatialIndex, p: Vec2, tol: number, filter?: (e: DraftEntity) => boolean): DraftEntity | null {
  const ctx: KindCtx = { model };
  const cands = idx.query({ x0: p[0] - tol, y0: p[1] - tol, x1: p[0] + tol, y1: p[1] + tol });
  let best: DraftEntity | null = null;
  let bd = Infinity;
  for (const e of cands) {
    if (!layerVisible(model, e.layer) || (filter && !filter(e))) continue;
    const d = entityDist(e, p, ctx);
    if (d <= tol && d <= bd) {
      best = e;
      bd = d;
    }
  }
  return best;
}

const boxEdges = (b: Box): Curve[] => [
  { k: "line", a: [b.x0, b.y0], b: [b.x1, b.y0] },
  { k: "line", a: [b.x1, b.y0], b: [b.x1, b.y1] },
  { k: "line", a: [b.x1, b.y1], b: [b.x0, b.y1] },
  { k: "line", a: [b.x0, b.y1], b: [b.x0, b.y0] },
];

/** Výběr oknem (`crossing` = křížením). Vrací id viditelných entit. */
export function windowSelect(model: DraftModel, idx: SpatialIndex, box: Box, crossing: boolean): string[] {
  const ctx: KindCtx = { model };
  const out: string[] = [];
  const edges = boxEdges(box);
  for (const e of idx.query(box)) {
    if (!layerVisible(model, e.layer)) continue;
    const eb = entityBox(e, ctx);
    if (eb && boxInside(eb, box)) {
      out.push(e.id);
      continue;
    }
    if (!crossing) continue;
    if (eb && !boxHits(eb, box)) continue;
    const cs = entityCurves(e, ctx);
    if (!cs.length) {
      if (eb && boxHits(eb, box)) out.push(e.id);
      continue;
    }
    let hit = false;
    for (const c of cs) {
      if ((c.k === "line" && !c.inf && (inBox(c.a, box) || inBox(c.b, box))) || edges.some((ed) => cIntersect(c, ed).length)) {
        hit = true;
        break;
      }
    }
    if (hit) out.push(e.id);
  }
  return out;
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
/** slova zápisu výběru (cs / en / de) */
const W = {
  all: ["vse", "all", "alles", "*"],
  last: ["posledni", "last", "letzte"],
  prev: ["predchozi", "previous", "vorher"],
  sel: ["vyber", "selection", "auswahl", "sel"],
  window: ["okno", "window", "fenster"],
  crossing: ["krizeni", "crossing", "kreuzen"],
  layer: ["hladina", "layer", "ebene", "la"],
  type: ["typ", "type", "art"],
  color: ["barva", "color", "colour", "farbe"],
  remove: ["odebrat", "remove", "entfernen", "-"],
  add: ["pridat", "add", "hinzu", "+"],
  none: ["nic", "none", "nichts"],
};
const is = (t: string, k: keyof typeof W) => W[k].includes(fold(t));

/** druh entity ze slova (line / úsečka / Linie…) */
export function typeFromWord(t: string): string | null {
  const f = fold(t);
  const syn: Record<string, string> = { usecka: "line", cara: "line", linie: "line", kruznice: "circle", kreis: "circle", oblouk: "arc", bogen: "arc", krivka: "polyline", polycara: "polyline", pline: "polyline", lwpolyline: "polyline", elipsa: "ellipse", ellipse: "ellipse", bod: "point", punkt: "point", primka: "xline", konstruktionslinie: "xline", poloprimka: "ray", strahl: "ray", text: "text", spline: "spline" };
  const t2 = syn[f] ?? f;
  return kinds().some((k) => k.type === t2) ? t2 : (kinds().find((k) => fold(k.label()) === f)?.type ?? null);
}

export type SelParseCtx = { model: DraftModel; list: readonly DraftEntity[]; idx: SpatialIndex; session: DraftSession; parsePoint: (t: string) => Vec2 | null };

/**
 * Přečte zápis výběru od tokenu `i` (dokud tokeny výběru pokračují). Vrací id (v pořadí) a index dalšího tokenu.
 * Neznámý token výběr ukončí (příkaz pokračuje jeho zpracováním); chybné zadání = výjimka s důvodem.
 */
export function parseSelection(tokens: string[], i: number, c: SelParseCtx, start: string[] = []): { ids: string[]; next: number } {
  const set = new Set(start);
  let removing = false;
  const vis = (e: DraftEntity) => layerVisible(c.model, e.layer);
  const apply = (ids: Iterable<string>) => {
    for (const id of ids) {
      if (removing) set.delete(id);
      else set.add(id);
    }
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (is(t, "remove")) {
      removing = true;
      i++;
    } else if (is(t, "add")) {
      removing = false;
      i++;
    } else if (is(t, "all")) {
      apply(c.list.filter((e) => vis(e) && !findLayer(c.model, e.layer)?.frozen).map((e) => e.id));
      i++;
    } else if (is(t, "none")) {
      set.clear();
      i++;
    } else if (is(t, "last")) {
      apply(c.session.lastCreated.filter((id) => entityById(c.list as DraftEntity[], id)));
      i++;
    } else if (is(t, "prev")) {
      apply(c.session.prevSel.filter((id) => entityById(c.list as DraftEntity[], id)));
      i++;
    } else if (is(t, "sel")) {
      apply(c.session.sel.filter((id) => entityById(c.list as DraftEntity[], id)));
      i++;
    } else if (is(t, "window") || is(t, "crossing")) {
      const a = c.parsePoint(tokens[i + 1] ?? "");
      const b = c.parsePoint(tokens[i + 2] ?? "");
      if (!a || !b) throw new Error(tr("výběr {0}: zadejte dva rohy x,y x,y", t));
      apply(windowSelect(c.model, c.idx, { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) }, is(t, "crossing")));
      i += 3;
    } else if (is(t, "layer")) {
      const name = tokens[i + 1];
      const l = name ? findLayer(c.model, name) : undefined;
      if (!l) throw new Error(tr("výběr podle hladiny: hladina „{0}“ neexistuje – hladiny: {1}", name ?? "", c.model.layers.map((x) => x.name).join(", ")));
      apply(c.list.filter((e) => e.layer === l.name && vis(e)).map((e) => e.id));
      i += 2;
    } else if (is(t, "type")) {
      const ty = typeFromWord(tokens[i + 1] ?? "");
      if (!ty) throw new Error(tr("výběr podle druhu: neznámý druh „{0}“ – druhy: {1}", tokens[i + 1] ?? "", kinds().map((k) => k.type).join(", ")));
      apply(c.list.filter((e) => e.type === ty && vis(e)).map((e) => e.id));
      i += 2;
    } else if (is(t, "color")) {
      const col = parseColor(tokens[i + 1] ?? "");
      if (col === null) throw new Error(tr("výběr podle barvy: neplatná barva „{0}“", tokens[i + 1] ?? ""));
      apply(c.list.filter((e) => (e.color ?? "ByLayer") === col && vis(e)).map((e) => e.id));
      i += 2;
    } else if (/^e\d+$/i.test(t)) {
      const e = entityById(c.list as DraftEntity[], t.toLowerCase());
      if (!e) throw new Error(tr("entita {0} neexistuje", t));
      apply([e.id]);
      i++;
    } else if (/^e\d+(,e\d+)+$/i.test(t)) {
      for (const id of t.toLowerCase().split(",")) {
        if (!entityById(c.list as DraftEntity[], id)) throw new Error(tr("entita {0} neexistuje", id));
        apply([id]);
      }
      i++;
    } else break;
  }
  return { ids: [...set], next: i };
}

/** slovo je začátkem zápisu výběru */
export const isSelectionWord = (t: string) => /^e\d+(,e\d+)*$/i.test(t) || (Object.keys(W) as (keyof typeof W)[]).some((k) => is(t, k));

