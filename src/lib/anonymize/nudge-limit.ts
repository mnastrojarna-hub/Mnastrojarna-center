/**
 * Omezení „šťouchnutí" do fronty anonymizace (POST /api/drawings/anonymize/process) — čistý modul:
 *  - stejný uživatel + stejný klíč (zakázka / soubory) nejvýš jednou za `minMs`,
 *  - nejvýš `maxActive` běhů zahájených šťouchnutím současně v jedné instanci.
 * Paměť je jen v instanci (serverless) — skutečnou ochranu před dvojím zpracováním dává atomický claim v DB.
 */

export const NUDGE_MIN_MS = 8_000;
export const NUDGE_MAX_ACTIVE = 4;

export class NudgeLimiter {
  private last = new Map<string, number>();
  private active = 0;

  constructor(private readonly minMs = NUDGE_MIN_MS, private readonly maxActive = NUDGE_MAX_ACTIVE) {}

  /** „ok" = smí začít (a zabere slot — uvolnit přes release()), jinak důvod. */
  acquire(key: string, now = Date.now()): "ok" | "throttled" | "busy" {
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < this.minMs) return "throttled";
    if (this.active >= this.maxActive) return "busy";
    this.last.set(key, now);
    this.active++;
    if (this.last.size > 2000) {
      for (const [k, t] of this.last) if (now - t > this.minMs) this.last.delete(k);
    }
    return "ok";
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
  }

  get running(): number {
    return this.active;
  }
}

/** Klíč šťouchnutí: uživatel + tabulka + seřazená id (zakázky nebo soubory). */
export function nudgeKey(userId: string, table: string, ids: string[]): string {
  return `${userId}|${table}|${[...new Set(ids.map((x) => x.toLowerCase()))].sort().join(",")}`;
}
