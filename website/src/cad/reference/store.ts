/**
 * Předlohy relace: načtená předloha (2D model, výtah, poznámka importu) podle otisku souboru. Dokument drží jen
 * `reference` (název, otisk, souhrn, výsledky kontrol – types.ts RefDocInfo); soubor sám zůstává v paměti karty.
 * Po obnovení stránky ho stačí připojit znovu (`předloha "soubor.dwg"`).
 */
import type { DraftModel } from "../draft/model";
import type { CadDoc } from "../types";
import type { RefCompare, RefDimCheck, RefDocInfo, RefExtract } from "./types";

export type RefState = {
  info: RefDocInfo;
  model: DraftModel;
  extract: RefExtract;
  /** poznámka importu DWG / DXF (co se převedlo, co ne) */
  note: string;
  version?: string;
  /** poslední výsledky (pro window.mncad.reference) */
  lastCompare?: RefCompare;
  lastDims?: RefDimCheck[];
};

const states = new Map<string, RefState>();
let lastData: unknown = null;

export const referenceStore = {
  put(st: RefState) {
    states.set(st.info.id, st);
    return st;
  },
  get(id: string | undefined): RefState | null {
    return id ? states.get(id) ?? null : null;
  },
  delete(id: string) {
    states.delete(id);
  },
  /** strukturovaný výsledek posledního příkazu předlohy (window.mncad.reference) */
  setLast(d: unknown) {
    lastData = d;
  },
  last: () => lastData,
};

/**
 * Předloha dokumentu, je-li v této relaci načtená (výtah s kótami, tolerancemi, dírami…) – pro ostatní moduly,
 * např. kontrolu tolerancí výkresu proti předloze. null = dokument předlohu nemá nebo soubor není načtený.
 */
export function referenceOf(doc: Pick<CadDoc, "reference"> | null | undefined): RefState | null {
  return referenceStore.get(doc?.reference?.id);
}
