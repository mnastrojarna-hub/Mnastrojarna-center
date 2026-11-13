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
