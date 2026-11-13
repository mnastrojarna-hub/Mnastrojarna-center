/**
 * Varování z hloubi stavby prvku (7. vlna): stavitel prvku (např. hladké uzavřené šablonování, výplň plochy) může během
 * výpočtu ohlásit, že výsledek je jen přiblížením (odchylka od profilů, nedosažená návaznost). `build.ts` hlášky na začátku
 * prvku zahodí a po úspěšné stavbě je připojí k varování prvku (⚠ ve stromu, v protokolu i ve `stav`).
 */
let notes: string[] = [];

/** ohlásit varování k právě stavěnému prvku */
export function noteFeatureWarning(text: string) {
  if (text && !notes.includes(text)) notes.push(text);
}
/** vybrat (a vyprázdnit) hlášky právě stavěného prvku */
export function takeFeatureNotes(): string[] {
  const out = notes;
  notes = [];
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
