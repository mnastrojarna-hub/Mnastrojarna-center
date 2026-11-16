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
  /** Chytré kóty: co se nepodařilo umístit nebo okótovat */
  | "dims-skipped"
  /** kontrola tolerancí: funkční / předlohou tolerovaný rozměr bez tolerance */
  | "tolerance-missing"
  /** nová / upravená poznámka listu se překrývá s jiným textem (`ann`) – engine ji ověří znovu na konci bloku */
  | "overlap"
  /** nová / upravená poznámka listu přesahuje rámeček listu (`ann`) – engine ji ověří znovu na konci bloku */
  | "frame"
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
  return isTextOfKey(text, SECTION_MISS_BADGE) ? { level: "error", code: "drawing.section-miss", kind: "section-miss", text } : { level: "warn", code: "drawing.warning", kind: "other", text };
}

/** hlášení, o kterém rozhodne až konec bloku příkazů výkresu (mezistav: další `výkres upravit …` ho může opravit) */
export const deferredIssue = (i: Pick<DrawingIssue, "kind">): boolean => i.kind === "overlap" || i.kind === "frame" || i.kind === "dims-skipped";

/** Řádek protokolu příkazu výkresu: „✗ …“ (chyba) / „⚠ …“ (varování). */
export const issueLine = (i: DrawingIssue) => `${i.level === "error" ? "✗" : "⚠"} ${i.text}`;
