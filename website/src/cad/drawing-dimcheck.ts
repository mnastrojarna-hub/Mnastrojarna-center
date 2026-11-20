/**
 * Kontrola kót listu (vlna 22, bod 18) nad výsledkem výkresu: spojení čisté kontroly (cad/dim-complete.ts) s listem výkresu
 * (pohledy, poznámky listu, texty, tabulka děr, volby) a hlášení pro protokol:
 * ⚠ `drawing.dims-incomplete` (chybí velikost / poloha prvku), ⚠ `drawing.tolerance-missing` (funkční prvek bez tolerance),
 * ℹ `drawing.tol-nonfunctional` (přesná tolerance na rozměru, který není funkční). Stejné pro `výkres stav`, vyhodnocení
 * listu na konci bloku / běhu, export a okno výkresu.
 */
import type { DrawingOptions, DrawingResult } from "./drawing";
import { DIMS_INCOMPLETE_KEY, type DrawingIssue } from "./drawing-issues";
import { checkSheet, dimsIncomplete, missingItems, suggestDim, type DimCompleteResult, type DimReq, type DimSuggestion } from "./dim-complete";
import { tr } from "./i18n";
import type { CadDoc, DrawingAnnotation } from "./types";

/** kontrola listu; sestava, 2D výkres a prázdný díl → null (kontrola zná jen díly z historie prvků) */
export function sheetDimCheck(doc: CadDoc, res: Pick<DrawingResult, "views" | "texts" | "holes">, anns: readonly DrawingAnnotation[], o: Partial<DrawingOptions>): DimCompleteResult | null {
  if (doc.kind === "assembly" || doc.kind === "draft" || !doc.features.length) return null;
  return checkSheet({
    doc,
    views: res.views,
    annotations: anns,
    dimensions: o.dimensions,
    texts: res.texts,
    holeRows: res.holes ?? [],
    dimFunctional: o.dimFunctional ?? [],
  });
}

const itemShort = (q: DimReq) => `${q.kind === "size" ? `${q.label} (${q.source})` : q.label}${q.why ? ` – ${q.why}` : ""}`;

/** text hlášení neúplných kót: počet a seznam (nejvýš 6) */
export function incompleteText(r: DimCompleteResult): string {
  const miss = missingItems(r);
  const list = miss.slice(0, 6).map(itemShort).join("; ") + (miss.length > 6 ? tr("; a dalších {0}", miss.length - 6) : "");
  return tr("chybí {0} (velikosti {1}/{2}, polohy {3}/{4}): {5}", miss.length, r.size.ok, r.size.total, r.pos.ok, r.pos.total, list);
}

/** text varování neúplných kót (stav, vyhodnocení listu, export – stejný text = táž hláška se v protokolu neopakuje) */
export const incompleteWarning = (r: DimCompleteResult) => tr(DIMS_INCOMPLETE_KEY, incompleteText(r));

/** varování listu pro export (cad/drawing-export.ts `renderSheet`): neúplné kóty a funkční prvky bez tolerance */
export function dimExportWarnings(r: DimCompleteResult | null): string[] {
  if (!r) return [];
  return [...(dimsIncomplete(r) ? [incompleteWarning(r)] : []), ...dimCheckIssues(r, { withTol: true }).filter((i) => i.kind === "tolerance-missing").map((i) => i.text)];
}

/**
 * Hlášení kontroly kót listu: ⚠ neúplné kóty, ⚠ funkční prvek bez tolerance (jen `withTol` – `výkres stav` / export, kde text
 * hlášení nese přesný důvod), ℹ přetolerování. `sheetId` / `sheetName` pro protokol.
 */
export function dimCheckIssues(r: DimCompleteResult | null, o: { sheetId?: string; sheetName?: string; withTol?: boolean } = {}): DrawingIssue[] {
  if (!r) return [];
  const out: DrawingIssue[] = [];
  const base = { ...(o.sheetId ? { sheetId: o.sheetId } : {}) };
  const data = (x: Record<string, unknown>) => ({ ...x, ...(o.sheetName ? { sheetName: o.sheetName } : {}) });
  if (dimsIncomplete(r)) out.push({ level: "warn", code: "drawing.dims-incomplete", kind: "dims-incomplete", text: incompleteWarning(r), data: data({ size: r.size, pos: r.pos, missing: missingItems(r).map((q) => q.id) }), ...base });
  if (o.withTol)
    for (const q of r.tol.missing)
      out.push({
        level: "warn",
        code: "drawing.tolerance-missing",
        kind: "tolerance-missing",
        text: q.status === "missing" ? tr("funkční {0}: kóta na listu chybí – doplňte ji s tolerancí", itemShort(q)) : q.tolState === "differs" ? tr("funkční {0}: tolerance {1} se liší od předepsané {2}", itemShort(q), (q.tols ?? []).find((t) => t.trim()) ?? "", q.tol ?? "") : tr("funkční {0}: kóta bez tolerance – výkres tolerance <kóta> <tolerance>", itemShort(q)),
        data: data({ item: q.id, functional: true }),
        ...base,
      });
  if (r.tol.over.length) out.push({ level: "note", code: "drawing.tol-nonfunctional", kind: "tol-nonfunctional", text: r.tol.over.map((x) => `${x.label} ${x.tol}`).join(", "), data: data({ anns: r.tol.over.map((x) => x.ann) }), ...base });
  return out;
}

/** návrhy kót pro chybějící položky (GUI „Přidat kótu“, `výkres doplnit kóty`) */
export function suggestionsFor(r: DimCompleteResult, doc: CadDoc, views: DrawingResult["views"], which: "all" | "size" | "pos" = "all"): { item: DimReq; dim: DimSuggestion | null }[] {
  const bbox = r.items.find((q) => q.id === "overall:0")?.span && r.items.find((q) => q.id === "overall:1")?.span && r.items.find((q) => q.id === "overall:2")?.span
    ? ([[0, 1, 2].map((k) => r.items.find((q) => q.id === `overall:${k}`)!.span![0]), [0, 1, 2].map((k) => r.items.find((q) => q.id === `overall:${k}`)!.span![1])] as [[number, number, number], [number, number, number]])
    : null;
  return missingItems(r)
    .filter((q) => which === "all" || q.kind === which)
    .map((item) => ({ item, dim: suggestDim(item, views, bbox, doc) }));
}
