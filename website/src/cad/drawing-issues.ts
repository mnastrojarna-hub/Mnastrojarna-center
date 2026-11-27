/**
 * Strukturovaná hlášení výkresu (vlna 15, B5/B6): co výkresové prostředí ukazuje jako odznak („Rovina řezu neprotíná
 * těleso“, „Pohledy se v měřítku 1:2 nevejdou na list A2“), vrací jádro výkresu i jako záznam s kódem, úrovní a daty –
 * výsledek příkazů výkresu (`applyDrawingCmd(...).issues`) a stav výkresu (`drawingStatus(...).issues`) je předají dál
 * (protokol: ✗ / ⚠ s kódem z registru cad/engine/codes.ts).
 *
 * Kódy jsou z registru protokolu: `drawing.section-miss`, `drawing.warning`, `drawing.overlap`, `drawing.tolerance-missing`;
 * jemnější druh nese `kind`. Úroveň řezu mimo těleso je ✗ (error) – řez na listu chybí.
 *
 * Engine (cad/engine/ops/drawing-cmd.ts, drawing-track.ts) podle druhu rozhodne, kdy hlášení zapíše do protokolu: hlášení
 * z výpočtu listu po příkazu (`computed`) a mezistavy bloku příkazů výkresu (překryv / přesah rámečku poznámky, vynechané
 * Chytré kóty) až na konci bloku / běhu (kap. 5.3 – pozdější `výkres …` je může opravit); `výkres stav`, export, starší zápis
 * řezu a kontrola tolerancí hned na řádku příkazu.
 */
import type { DrawingResult } from "./drawing";
import { tr } from "./i18n";
import type { DrawingAnnotation } from "./types";

export type DrawingIssueKind =
  /** rovina řezu A–A neprotíná těleso (řez na listu chybí) */
  | "section-miss"
  /** odsazení řezu ve starším zápisu (souřadnice na ose) – vyloženo postaru a uloženo v dnešní konvenci (`data`: typed, offset, coord) */
  | "section-legacy"
  /** pohledy se v zadaném měřítku nevejdou na zadaný list (`data`: scale, sheet) */
  | "sheet-fit"
  /** pohled / řez / model se na list nevešel (`data`: view) */
  | "view-lost"
  /** tabulka děr (dlouhá, na plném listu) překrývá pohledy (`data`: rows, views) */
  | "hole-table-overlap"
  /** tabulka ozubení překrývá pohledy (`data`: tables, views) – drawing-geartable.ts */
  | "gear-table-overlap"
  /** Chytré kóty: co se nepodařilo umístit nebo okótovat */
  | "dims-skipped"
  /** kontrola tolerancí: funkční / předlohou tolerovaný rozměr bez tolerance */
  | "tolerance-missing"
  /** nová / upravená poznámka listu se překrývá s jiným textem (`ann`) – engine ji ověří znovu na konci bloku */
  | "overlap"
  /** nová / upravená poznámka listu přesahuje rámeček listu (`ann`) – engine ji ověří znovu na konci bloku */
  | "frame"
  /**
   * kontrola překryvů celého listu (vlna 22, bod 17 – cad/drawing-overlaps.ts): balónky, odkazové čáry, texty, kóty, geometrie
   * pohledů, tabulky a rám; `data` = počty po druzích a křížení odkazových čar
   */
  | "sheet-overlap"
  /** kusovník se na list nevejde ani ve sloupcích (`data`: rows, hidden, sheet) – vlna 22, bod 17 */
  | "bom-overflow"
  /** vydaný list ze starší revize modelu / vydání se stejným písmenem po změně modelu (vlna 22, bod 20 – cad/doc-outputs.ts) */
  | "stale"
  /** kontrola kót: na listu chybí velikost / poloha prvku výsledného dílu (vlna 22, bod 18 – cad/dim-complete.ts) */
  | "dims-incomplete"
  /** přesná tolerance na rozměru, který není funkční (přetolerování; ℹ – vlna 22, bod 18) */
  | "tol-nonfunctional"
  /** ruční kóta po změně modelu neodpovídá geometrii pohledu (`data.dims`: id, stav lost/moved/noView, hodnoty – vlna 22, bod 20) */
  | "dim-detached"
  /** ostatní varování jádra výkresu (text jako odznak) */
  | "other";

export type DrawingIssue = {
  level: "error" | "warn" | "note";
  /** kód z registru protokolu (cad/engine/codes.ts) */
  code: "drawing.section-miss" | "drawing.warning" | "drawing.overlap" | "drawing.bom-overflow" | "drawing.tolerance-missing" | "drawing.stale" | "drawing.dims-incomplete" | "drawing.tol-nonfunctional" | "drawing.dim-detached" | "drawing.pmi-lost" | "drawing.pmi-unplaced" | "drawing.notes-limit" | "drawing.note-style" | "drawing.note-title-data" | "drawing.notes-sheet" | "drawing.leaders-limit" | "drawing.note-not-model" | "drawing.pmi-range" | "drawing.sheet-empty" | "drawing.sheet-duplicate" | "drawing.note-to-title" | "drawing.title-conflict" | "drawing.notes-loaded";
  kind: DrawingIssueKind;
  /** text hlášky (přeložený) */
  text: string;
  /** strojově čitelné údaje (rovina a odsazení řezu, měřítko a list, kóta …) */
  data?: Record<string, unknown>;
  /** id listu, ke kterému hlášení patří (název listu do protokolu, ověření poznámky na konci bloku) */
  sheetId?: string;
  /** poznámka listu u překryvu / přesahu rámečku (`overlap` / `frame`) */
  ann?: DrawingAnnotation;
  /** hlášení výpočtu listu po příkazu (ne vlastní nález příkazu) – engine ho zapíše při vyhodnocení listu na konci bloku */
  computed?: boolean;
};

/** Všechna hlášení výsledku výkresu: strukturovaná z jádra + zbylá textová varování jako `drawing.warning` / `other`. */
export function issuesOf(res: Pick<DrawingResult, "warnings"> & { issues?: DrawingIssue[] }): DrawingIssue[] {
  const out: DrawingIssue[] = [...(res.issues ?? [])];
  // varování, ke kterému jádro dalo strukturované hlášení, se neopakuje (text odznaku bývá kratší než text hlášení)
  const covered = new Set(out.map((i) => (i.data?.badge as string | undefined) ?? i.text));
  for (const w of res.warnings ?? []) if (!covered.has(w)) out.push({ level: "warn", code: "drawing.warning", kind: "other", text: w });
  return out;
}

/** varování neúplných kót listu (kontrola kót, bod 18 – cad/drawing-dimcheck.ts) – klíč překladu; export i stav ho poznají podle klíče */
export const DIMS_INCOMPLETE_KEY = "kóty neúplné – {0}";
/** klíč hlášení ruční kóty bez geometrie po změně modelu (cad/drawing-dim-attach.ts, vlna 22 bod 20) */
export const DIM_DETACHED_KEY = "ruční kóty po změně modelu neodpovídají geometrii ({0}): {1} – {2}";

/** odznak řezu mimo těleso (drawing.ts) – klíč překladu */
export const SECTION_MISS_BADGE = "Rovina řezu neprotíná těleso – upravte odsazení.";

/** text jádra odpovídá přeloženému klíči (zástupné {n} = cokoli) – v jazyce běhu, ne podle českého textu */
export function isTextOfKey(text: string, key: string): boolean {
  const t = tr(key);
  if (text === t || text === key) return true;
  const re = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{\d+\\\}/g, ".*?")}$`, "s");
  return re(t).test(text) || re(key).test(text);
}

/** Hlášení z textu varování jádra bez strukturovaného hlášení (export listů): odznak řezu mimo těleso = ✗ drawing.section-miss. */
export function warningIssue(text: string): DrawingIssue {
  if (isTextOfKey(text, DIMS_INCOMPLETE_KEY)) return { level: "warn", code: "drawing.dims-incomplete", kind: "dims-incomplete", text };
  if (isTextOfKey(text, DIM_DETACHED_KEY)) return { level: "warn", code: "drawing.dim-detached", kind: "dim-detached", text };
  return isTextOfKey(text, SECTION_MISS_BADGE) ? { level: "error", code: "drawing.section-miss", kind: "section-miss", text } : { level: "warn", code: "drawing.warning", kind: "other", text };
}

/** hlášení, o kterém rozhodne až konec bloku příkazů výkresu (mezistav: další `výkres upravit …` ho může opravit) */
export const deferredIssue = (i: Pick<DrawingIssue, "kind">): boolean => i.kind === "overlap" || i.kind === "frame" || i.kind === "dims-skipped";

/** Řádek protokolu příkazu výkresu: „✗ …“ (chyba) / „⚠ …“ (varování). */
export const issueLine = (i: DrawingIssue) => `${i.level === "error" ? "✗" : i.level === "note" ? "ℹ" : "⚠"} ${i.text}`;
