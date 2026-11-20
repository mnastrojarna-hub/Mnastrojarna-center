/**
 * Varování z hloubi stavby prvku (7. vlna): stavitel prvku (např. hladké uzavřené šablonování, výplň plochy) může během
 * výpočtu ohlásit, že výsledek je jen přiblížením (odchylka od profilů, nedosažená návaznost). `build.ts` hlášky na začátku
 * prvku zahodí a po úspěšné stavbě je připojí k varování prvku (⚠ ve stromu, v protokolu i ve `stav`).
 */
let notes: string[] = [];
/** kód první hlášky s kódem (vlna 22, bod 22a: `thread.tip-tangent` … – protokol ho použije místo `feature.warning`) */
let noteCode: string | undefined;

/** ohlásit varování k právě stavěnému prvku; `code` = kód protokolu (engine/codes.ts) místo obecného `feature.warning` */
export function noteFeatureWarning(text: string, code?: string) {
  if (text && !notes.includes(text)) notes.push(text);
  if (text && code && !noteCode) noteCode = code;
}
/** vybrat (a vyprázdnit) hlášky právě stavěného prvku */
export function takeFeatureNotes(): string[] {
  const out = notes;
  notes = [];
  return out;
}
/** vybrat (a vyprázdnit) kód hlášek právě stavěného prvku – volat spolu s `takeFeatureNotes` */
export function takeFeatureNoteCode(): string | undefined {
  const out = noteCode;
  noteCode = undefined;
  return out;
}

/** Výsledek právě stavěného prvku (8. vlna, svary): text do stavu (✓ … ve stromu, `stav`) a strojově čitelná data (`status.data`). */
let info: { text: string; data?: Record<string, unknown> } | null = null;
export function noteFeatureInfo(text: string, data?: Record<string, unknown>) {
  info = { text, ...(data ? { data } : {}) };
}
/** vybrat (a vyprázdnit) výsledek právě stavěného prvku */
export function takeFeatureInfo(): { text: string; data?: Record<string, unknown> } | null {
  const out = info;
  info = null;
  return out;
}
