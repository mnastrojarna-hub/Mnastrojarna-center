/**
 * Strukturovaná hlášení výkresu (vlna 15, B5/B6): co výkresové prostředí ukazuje jako odznak („Rovina řezu neprotíná
 * těleso“, „Pohledy se v měřítku 1:2 nevejdou na list A2“), vrací jádro výkresu i jako záznam s kódem, úrovní a daty –
 * výsledek příkazů výkresu (`applyDrawingCmd(...).issues`) a stav výkresu (`drawingStatus(...).issues`) je předají dál
 * (protokol: ✗ / ⚠ s kódem z registru cad/engine/codes.ts).
 *
 * Kódy jsou z registru protokolu: `drawing.section-miss`, `drawing.warning`, `drawing.overlap`, `drawing.tolerance-missing`;
 * jemnější druh nese `kind`. Úroveň řezu mimo těleso je ✗ (error) – řez na listu chybí.
 */
import type { DrawingResult } from "./drawing";

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
  /** Chytré kóty: co se nepodařilo umístit nebo okótovat */
  | "dims-skipped"
  /** kontrola tolerancí: funkční / předlohou tolerovaný rozměr bez tolerance */
  | "tolerance-missing"
  /** ostatní varování jádra výkresu (text jako odznak) */
  | "other";

export type DrawingIssue = {
  level: "error" | "warn";
  /** kód z registru protokolu (cad/engine/codes.ts) */
  code: "drawing.section-miss" | "drawing.warning" | "drawing.overlap" | "drawing.tolerance-missing";
  kind: DrawingIssueKind;
  /** text hlášky (přeložený) */
  text: string;
  /** strojově čitelné údaje (rovina a odsazení řezu, měřítko a list, kóta …) */
  data?: Record<string, unknown>;
};

/** Všechna hlášení výsledku výkresu: strukturovaná z jádra + zbylá textová varování jako `drawing.warning` / `other`. */
export function issuesOf(res: Pick<DrawingResult, "warnings"> & { issues?: DrawingIssue[] }): DrawingIssue[] {
  const out: DrawingIssue[] = [...(res.issues ?? [])];
  // varování, ke kterému jádro dalo strukturované hlášení, se neopakuje (text odznaku bývá kratší než text hlášení)
  const covered = new Set(out.map((i) => (i.data?.badge as string | undefined) ?? i.text));
  for (const w of res.warnings ?? []) if (!covered.has(w)) out.push({ level: "warn", code: "drawing.warning", kind: "other", text: w });
  return out;
}

/** Řádek protokolu příkazu výkresu: „✗ …“ (chyba) / „⚠ …“ (varování). */
export const issueLine = (i: DrawingIssue) => `${i.level === "error" ? "✗" : "⚠"} ${i.text}`;
