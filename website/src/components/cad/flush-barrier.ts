/**
 * Jedna bariéra rozepsaných změn (vlna 22, body 22e a 22f; nahrazuje pět dřívějších „flushů“ na stejných místech).
 *
 * Rozepsaná změna = hodnota pole napsaná před méně než 450 ms bez opuštění pole (`Num`, props.tsx), nebo změna listu
 * výkresu, která čeká na odložené uložení (formát A2 → A3, zaškrtnutí pohledu, razítko – drawing-workspace.tsx). Každé
 * takové místo se tu zaregistruje (`registerFlush`) s klíčem dokumentu, do kterého změna patří (`owner`), a odregistruje
 * se, jakmile nic nečeká.
 *
 * `flushPending()` zapíše všechno rozepsané SYNCHRONNĚ (`flushSync` – stav aplikace i `histRef` jsou hned aktuální) – volá
 * se PŘED: přepnutím záložky, otevřením jiného dokumentu nebo výkresu, zavřením panelu / záložky / karty prohlížeče,
 * uložením, exportem, sdílením, zpět / znovu a před každým voláním `window.mncad` (cad-app.tsx). Zápis jde vždy do
 * dokumentu, ke kterému změna patří: když se aktuální dokument mezitím změnil (`owner` ≠ `currentDocKey()`), změna se do
 * jiného dokumentu NEZAPÍŠE – zapisovač dostane `wrongDoc = true` a rozhodne sám (výkres zapíše do záložky svého
 * dokumentu, pole hodnotu zahodí a ohlásí).
 *
 * Jedno pravidlo slučování kroků historie (`historyRule`): opuštění pole bez změny nepřidá krok Zpět; souvislé psaní do
 * téhož textového pole (název prvku) je jeden krok; zápis výkresu je krok Zpět; Esc v poli vrátí původní hodnotu a nic
 * nezapíše (ani pozdějším časovačem).
 */
import { flushSync } from "react-dom";

/**
 * zapisovač rozepsané změny; `wrongDoc` = aktuální dokument není ten, do kterého změna patří; `discard` = změnu zahodit
 * (Storno formuláře prvku – dokument se vrací do stavu před úpravou, rozepsaná hodnota se do něj nesmí zapsat)
 */
export type FlushFn = (o: { wrongDoc: boolean; reason: string; discard?: boolean }) => void;
/** druh rozepsané změny: pole formuláře / list výkresu */
export type FlushKind = "field" | "drawing";
type Flusher = { owner: string | null; flush: FlushFn; kind: FlushKind };

const flushers = new Map<number, Flusher>();
let seq = 0;
let docKeyNow: () => string = () => "";
/** poslední provedená bariéra (diagnostika, e2e: `window.mncad.pending()`) */
let last: { reason: string; flushed: number; at: number } | null = null;
let sync: (fn: () => void) => void = (fn) => flushSync(fn);

/** aplikace: odkud bariéra zná klíč zobrazeného dokumentu (id dokumentu záložky) */
export function setDocKeyGetter(f: () => string): void {
  docKeyNow = f;
}
/** klíč zobrazeného dokumentu (prázdný = aplikace ho nedodala) */
export const currentDocKey = (): string => docKeyNow();
/** testy / prostředí bez Reactu: náhrada `flushSync` */
export function setFlushSync(f: (fn: () => void) => void): void {
  sync = f;
}

/**
 * Zaregistruje rozepsanou změnu dokumentu `owner` (null = patří tomu, co je právě zobrazené). Vrací odregistrování –
 * volat, jakmile nic nečeká (potvrzení, Esc, odmontování).
 */
export function registerFlush(flush: FlushFn, owner: string | null = currentDocKey() || null, kind: FlushKind = "field"): () => void {
  const id = ++seq;
  flushers.set(id, { owner, flush, kind });
  return () => void flushers.delete(id);
}

/** zahodí rozepsané změny druhu `kind` (Storno formuláře prvku) – zapisovač dostane `discard: true` a nic nezapíše */
export function discardPending(kind: FlushKind = "field", reason = "discard"): number {
  let n = 0;
  for (const [id, f] of [...flushers.entries()]) {
    if (f.kind !== kind) continue;
    flushers.delete(id);
    try {
      f.flush({ wrongDoc: false, reason, discard: true });
      n++;
    } catch {
      /* zapisovač nesmí zastavit ostatní */
    }
  }
  return n;
}

/** počet rozepsaných změn (žádná = bariéra nic nedělá) */
export const pendingCount = (): number => flushers.size;

/**
 * Zapíše všechny rozepsané změny synchronně (viz hlavička). Vrací počet zapsaných změn. Bezpečné volat kdykoli – bez
 * rozepsaných změn nedělá nic.
 */
export function flushPending(reason = ""): number {
  if (!flushers.size) return 0;
  const list = [...flushers.entries()];
  const key = currentDocKey();
  let n = 0;
  const run = () => {
    for (const [id, f] of list) {
      if (!flushers.has(id)) continue; // mezitím odregistrovaný (zápis jiného pole ho potvrdil)
      flushers.delete(id);
      try {
        f.flush({ wrongDoc: !!(f.owner && key && f.owner !== key), reason });
        n++;
      } catch {
        /* jeden zapisovač nesmí zastavit ostatní */
      }
    }
  };
  try {
    sync(run);
  } catch {
    run(); // uvnitř vykreslování Reactu flushSync nejde – zápis proběhne s dalším vykreslením
  }
  last = { reason, flushed: n, at: Date.now() };
  return n;
}

/** poslední bariéra (diagnostika) */
export const lastFlush = () => last;

/* ───────────────────────── pravidlo slučování kroků historie ───────────────────────── */

/** okno, ve kterém se souvislé psaní do téhož pole slučuje do jednoho kroku Zpět */
export const MERGE_WINDOW_MS = 1500;

/**
 * Jedno pravidlo pro kroky historie (22e + 22f):
 *  * `unchanged` – hodnota se nezměnila (opuštění pole, Enter na stejné hodnotě) → žádný krok;
 *  * `merge` – změna se stejným klíčem jako předchozí krok do `MERGE_WINDOW_MS` (psaní názvu po znacích) → nahradí poslední krok;
 *  * `step` – jinak nový krok (i každý zápis listu výkresu).
 */
export function historyRule(o: { changed: boolean; key?: string | null; lastKey?: string | null; lastAt?: number; now?: number }): "unchanged" | "merge" | "step" {
  if (!o.changed) return "unchanged";
  const now = o.now ?? Date.now();
  if (o.key && o.lastKey === o.key && o.lastAt !== undefined && now - o.lastAt <= MERGE_WINDOW_MS) return "merge";
  return "step";
}

/** čísla se považují za stejná (blur bez změny nezapisuje krok) */
export const sameNumber = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
