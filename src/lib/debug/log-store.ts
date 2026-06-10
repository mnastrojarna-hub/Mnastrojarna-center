/**
 * Globální úložiště debug logu (singleton).
 *
 * Funguje i mimo React a je bezpečné na serveru (žádný přístup k `window`
 * při importu). Drží kruhový buffer záznamů, deduplikuje opakované zprávy
 * a notifikuje odběratele (React přes useSyncExternalStore).
 *
 * Cíl: zachytit „úplně všechny scénáře" a u každého uchovat extrémně
 * podrobný kontext, aby šel jedním klikem zkopírovat / nahlásit.
 */

export type LogLevel =
  | "debug"
  | "info"
  | "log"
  | "warn"
  | "error"
  | "network"
  | "event"
  | "nav"
  | "action";

export interface LogEntry {
  /** Pořadové unikátní id (monotónně roste). */
  id: number;
  /** Čas vzniku (epoch ms). */
  ts: number;
  level: LogLevel;
  /** Zdroj / kategorie, např. "console", "window.error", "fetch", "outlook-import". */
  source: string;
  /** Krátká, jednořádková zpráva do seznamu. */
  message: string;
  /** Extrémně podrobný kontext (serializované argumenty, hlavičky, payload…). */
  details?: string;
  /** Stack trace, pokud je k dispozici. */
  stack?: string;
  /** URL / route v okamžiku vzniku. */
  url?: string;
  /** Kolikrát po sobě se identický záznam zopakoval (deduplikace). */
  count: number;
}

const MAX_ENTRIES = 2000;

class DebugLogStore {
  private entries: LogEntry[] = [];
  private listeners = new Set<() => void>();
  private nextId = 1;
  private snapshot: readonly LogEntry[] = [];
  private paused = false;
  /** Sekundové „sezení" — kdy byl log naposledy vyčištěn / start aplikace. */
  readonly bootTs = Date.now();

  /** Pozastavit/obnovit záznam (UI tlačítko). Zachytávání stále běží, jen se nezapisuje. */
  setPaused(value: boolean) {
    this.paused = value;
  }
  isPaused() {
    return this.paused;
  }

  add(input: {
    level: LogLevel;
    source: string;
    message: string;
    details?: string;
    stack?: string;
    url?: string;
  }): void {
    if (this.paused) return;

    const url =
      input.url ??
      (typeof window !== "undefined" ? window.location.pathname + window.location.search : undefined);

    const last = this.entries[this.entries.length - 1];
    if (
      last &&
      last.level === input.level &&
      last.source === input.source &&
      last.message === input.message &&
      last.details === input.details
    ) {
      // Deduplikace: identický záznam → jen zvýšíme čítač a posuneme čas.
      last.count += 1;
      last.ts = Date.now();
      this.commit();
      return;
    }

    const entry: LogEntry = {
      id: this.nextId++,
      ts: Date.now(),
      level: input.level,
      source: input.source,
      message: input.message,
      details: input.details,
      stack: input.stack,
      url,
      count: 1,
    };

    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    this.commit();
  }

  clear(): void {
    this.entries = [];
    this.commit();
  }

  getSnapshot(): readonly LogEntry[] {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private commit() {
    this.snapshot = this.entries.slice();
    for (const l of this.listeners) l();
  }
}

/**
 * Jediná instance napříč HMR i moduly. Uchováváme na globalThis, aby se při
 * Fast Refresh nevytvořila nová a log nezmizel.
 */
const GLOBAL_KEY = "__cncDebugLogStore__";
type GlobalWithStore = typeof globalThis & { [GLOBAL_KEY]?: DebugLogStore };
const g = globalThis as GlobalWithStore;

export const debugStore: DebugLogStore = g[GLOBAL_KEY] ?? (g[GLOBAL_KEY] = new DebugLogStore());

/** Prázdný snapshot pro server-render (stabilní reference). */
export const EMPTY_SNAPSHOT: readonly LogEntry[] = Object.freeze([]);
