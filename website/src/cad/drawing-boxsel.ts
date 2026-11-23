/**
 * Výkres dílu / sestavy: výběr poznámek a kót kliknutím a oknem, posun a smazání více najednou (čistá logika, bez UI).
 * Tvary poznámek jsou v mm listu (y dolů – jako SVG listu); okno / křížení řeší `box-select-2d.ts`.
 */
import { annotationGeometry, annToSheet, isRadialDim, sheetToAnn, textBox, type DrawingResult, type GenEdit, type PlacedView } from "./drawing";
import { selectShapes, pickShape, type BoxShape, type Rect2 } from "./box-select-2d";
import type { DrawingAnnotation, Vec2 } from "./types";

type Geo = Pick<DrawingResult, "views" | "scaleValue"> & Partial<Pick<DrawingResult, "fitShow" | "revHide">>;

/** tvar každé poznámky (čáry + obdélníky textů na listu); poznámka, která se nekreslí (pohled není na listu), tvar nemá */
export function annotationShapes(res: Geo, anns: readonly DrawingAnnotation[]): BoxShape[] {
  const out: BoxShape[] = [];
  for (const a of anns) {
    const g = annotationGeometry(res, [a]);
    const polys = g.polys.filter((p) => p.pts.length).map((p) => p.pts as readonly Vec2[]);
    const rects: Rect2[] = g.texts.filter((t) => t.s.trim()).map((t) => {
      const b = textBox(t);
      return { x0: b[0], y0: b[1], x1: b[2], y1: b[3] };
    });
    if (!polys.length && !rects.length) continue;
    out.push({ id: a.id, polys, rects });
  }
  return out;
}

// ---------------------------------------------------------------- vygenerované objekty listu (kóty celkových rozměrů, pozice)

/** id vygenerovaného objektu ve výběru (`gen:` + klíč jádra `dim:<pohled>:<t|l>` / `pos:<číslo>`) – poznámky mají jiná id */
export const GEN_PREFIX = "gen:";
export const isGenId = (id: string) => id.startsWith(GEN_PREFIX);
const genKey = (id: string) => id.slice(GEN_PREFIX.length);

/** tvary vygenerovaných objektů listu (DrawingResult.generated) pro výběr klikem a oknem */
export function generatedShapes(res: Pick<DrawingResult, "generated">): BoxShape[] {
  return (res.generated ?? []).map((g) => ({ id: GEN_PREFIX + g.id, polys: g.polys, rects: g.rects.map(([x0, y0, x1, y1]) => ({ x0, y0, x1, y1 })) }));
}

/** posun vygenerovaného objektu: kóta celkového rozměru jen kolmo k sobě (nahoře ↕, vlevo ↔), balónek volně */
export function genDelta(id: string, d: Vec2): Vec2 {
  const k = isGenId(id) ? genKey(id) : "";
  if (k.startsWith("dim:")) return k.endsWith(":t") ? [0, d[1]] : [d[0], 0];
  return d;
}

/** vybrané vygenerované objekty posunuté o `d` mm listu (posuny se sčítají) */
export function moveGenerated(edit: GenEdit | undefined, ids: readonly string[], d: Vec2): GenEdit | undefined {
  const g = ids.filter(isGenId);
  if (!g.length || (!d[0] && !d[1])) return edit;
  const move: Record<string, Vec2> = { ...(edit?.move ?? {}) };
  const lock: Record<string, Vec2> = { ...(edit?.lock ?? {}) };
  for (const id of g) {
    const k = genKey(id);
    const dd = genDelta(id, d);
    // zamčená pozice se táhne i s zámkem (absolutní poloha na listu – vlna 22, bod 17)
    if (lock[k]) {
      lock[k] = [r2(lock[k][0] + dd[0]), r2(lock[k][1] + dd[1])];
      continue;
    }
    const m = move[k] ?? [0, 0];
    move[k] = [r2(m[0] + dd[0]), r2(m[1] + dd[1])];
  }
  return { ...edit, move, ...(Object.keys(lock).length ? { lock } : {}) };
}

/**
 * Zamčení pozic (vlna 22, bod 17): střed balónku na listu (`at` z výsledku výkresu) se uloží absolutně – po přepočtu modelu
 * i novém rozmístění ostatních pozic zůstane na místě; relativní posun se tím nahradí. `at` = null → odemknout.
 */
export function lockGenerated(edit: GenEdit | undefined, keys: readonly string[], at: (k: string) => Vec2 | null): GenEdit | undefined {
  const lock: Record<string, Vec2> = { ...(edit?.lock ?? {}) };
  const move: Record<string, Vec2> = { ...(edit?.move ?? {}) };
  for (const k0 of keys) {
    const k = isGenId(k0) ? genKey(k0) : k0;
    const p = at(k);
    if (p) {
      lock[k] = [r2(p[0]), r2(p[1])];
      delete move[k];
    } else delete lock[k];
  }
  const out: GenEdit = { ...(edit?.off?.length ? { off: edit.off } : {}), ...(Object.keys(move).length ? { move } : {}), ...(Object.keys(lock).length ? { lock } : {}) };
  return genEditCount(out) ? out : undefined;
}

/** vybrané vygenerované objekty skryté (Delete); obnoví je „Obnovit vygenerované“ v panelu výkresu */
export function hideGenerated(edit: GenEdit | undefined, ids: readonly string[]): GenEdit | undefined {
  const g = ids.filter(isGenId).map(genKey);
  if (!g.length) return edit;
  return { ...edit, off: [...new Set([...(edit?.off ?? []), ...g])] };
}

/** počet upravených vygenerovaných objektů (skryté + posunuté) – tlačítko Obnovit */
export const genEditCount = (edit: GenEdit | undefined): number => new Set([...(edit?.off ?? []), ...Object.keys(edit?.move ?? {}), ...Object.keys(edit?.lock ?? {})]).size;

/** poznámky ve výběrovém okně listu (mm listu) */
export const annotationsInBox = (shapes: readonly BoxShape[], r: Rect2, crossing: boolean): string[] => selectShapes(shapes, r, crossing);
/** poznámka pod bodem listu (do `tol` mm listu) */
export const annotationAt = (shapes: readonly BoxShape[], q: Vec2, tol: number): string | null => pickShape(shapes, q, tol);

/** bod poznámky (souřadnice pohledu nebo listu) posunutý o `d` mm listu */
function shiftPt(views: PlacedView[], view: string, q: Vec2, d: Vec2): Vec2 {
  if (view === "sheet") return [q[0] + d[0], q[1] + d[1]];
  const v = views.find((x) => x.key === view);
  if (!v) return q;
  const s = annToSheet(views, view, q);
  return sheetToAnn(v, [s[0] + d[0], s[1] + d[1]]);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Poznámka posunutá o `d` (mm listu). Značky, texty a popisy se posunou celé (odkazová čára zůstává u prvku),
 * u kóty se posune kótovací čára / popisek (odsazení, u průměru a úhlu i směr) – měřené body zůstávají na geometrii.
 */
export function moveAnnotation(views: PlacedView[], a: DrawingAnnotation, d: Vec2): DrawingAnnotation {
  if (!d[0] && !d[1]) return a;
  const m = moveAnnotation0(views, a, d);
  // vygenerovaná kóta / popis posunutý ručně: poloha přežije přegenerování po změně modelu (vlna 22, bod 17)
  return m !== a && a.auto ? ({ ...m, placed: "user" } as DrawingAnnotation) : m;
}
function moveAnnotation0(views: PlacedView[], a: DrawingAnnotation, d: Vec2): DrawingAnnotation {
  switch (a.type) {
    case "note":
    case "roughness":
    case "gdt":
    case "datum":
    case "text":
    case "callout":
      return { ...a, at: shiftPt(views, a.view, a.at, d) };
    case "centerline":
      return { ...a, a: shiftPt(views, a.view, a.a, d), b: shiftPt(views, a.view, a.b, d) };
    case "dim": {
      if (isRadialDim(a)) {
        const v = views.find((x) => x.key === a.view);
        if (!v) return a;
        const C = annToSheet(views, a.view, a.c);
        const R = a.r * v.s;
        const rad = (a.ang * Math.PI) / 180;
        const K: Vec2 = [C[0] + Math.cos(rad) * (R + a.offset) + d[0], C[1] + Math.sin(rad) * (R + a.offset) + d[1]];
        const L = Math.hypot(K[0] - C[0], K[1] - C[1]);
        if (L < 1e-9) return a;
        return { ...a, ang: r2((Math.atan2(K[1] - C[1], K[0] - C[0]) * 180) / Math.PI), offset: r2(L - R) };
      }
      if (a.kind === "angle") {
        // vrchol úhlu = průsečík ramen; popisek leží na oblouku poloměru `offset` ve směru `ang`
        const S = (q: Vec2) => annToSheet(views, a.view, q);
        const [A, B, A2, B2] = [S(a.a), S(a.b), S(a.a2), S(a.b2)];
        const d1: Vec2 = [B[0] - A[0], B[1] - A[1]];
        const d2: Vec2 = [B2[0] - A2[0], B2[1] - A2[1]];
        const cr = d1[0] * d2[1] - d1[1] * d2[0];
        if (Math.abs(cr) < 1e-12) return a;
        const t = ((A2[0] - A[0]) * d2[1] - (A2[1] - A[1]) * d2[0]) / cr;
        const X: Vec2 = [A[0] + d1[0] * t, A[1] + d1[1] * t];
        const rad = (a.ang * Math.PI) / 180;
        const R = Math.max(1, a.offset);
        const K: Vec2 = [X[0] + Math.cos(rad) * R + d[0], X[1] + Math.sin(rad) * R + d[1]];
        const L = Math.hypot(K[0] - X[0], K[1] - X[1]);
        if (L < 1e-9) return a;
        return { ...a, ang: r2((Math.atan2(K[1] - X[1], K[0] - X[0]) * 180) / Math.PI), offset: r2(Math.max(1, L)) };
      }
      // délková kóta: kótovací čára se posune kolmo k měřenému směru (vodorovná ↕, svislá ↔, šikmá podle normály)
      if (a.kind === "horizontal") return { ...a, offset: r2(a.offset + d[1]) };
      if (a.kind === "vertical") return { ...a, offset: r2(a.offset + d[0]) };
      const A = annToSheet(views, a.view, a.a);
      const B = annToSheet(views, a.view, a.b);
      const l = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (l < 1e-12) return a;
      const n: Vec2 = [-(B[1] - A[1]) / l, (B[0] - A[0]) / l];
      return { ...a, offset: r2(a.offset + d[0] * n[0] + d[1] * n[1]) };
    }
  }
}

/** vybrané poznámky posunuté o `d` mm listu (ostatní beze změny) */
export function moveAnnotations(views: PlacedView[], anns: readonly DrawingAnnotation[], ids: readonly string[], d: Vec2): DrawingAnnotation[] {
  const set = new Set(ids);
  return anns.map((a) => (set.has(a.id) ? moveAnnotation(views, a, d) : a));
}

/**
 * Smazání vybraných poznámek. `smartOff` = klíče smazaných vygenerovaných kót (Chytré kóty je při přegenerování
 * nevrátí – stejně jako smazání jedné kóty křížkem v seznamu).
 */
export function deleteAnnotations(anns: readonly DrawingAnnotation[], ids: readonly string[]): { anns: DrawingAnnotation[]; smartOff: string[]; removed: number } {
  const set = new Set(ids);
  const keep = anns.filter((a) => !set.has(a.id));
  const smartOff = anns.filter((a) => set.has(a.id) && a.auto).map((a) => a.auto!);
  return { anns: keep, smartOff, removed: anns.length - keep.length };
}
