import "server-only";
import type { AiUsage } from "@/lib/jobs/capture-batch-types";
import { usageUsd } from "./detect-ai";

/**
 * Denní limit AI anonymizace (drawing_anon_settings.daily_usd) — platí JEN pro automatiku;
 * ruční běhy limit neblokují (MINOR 21). Čerpání = součet záznamů drawing_anon_usage_log za dnešek
 * (Praha) bez ručních běhů. Záznam vzniká po KAŽDÉM běhu s voláním AI — i u navazujících dávek
 * stránek, opakování po chybě a přepočtu (útrata se nepřepisuje).
 */

interface Db {
  from(t: string): {
    select(c: string): {
      gte(col: string, v: string): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
    };
    insert(row: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
  };
}

/** Začátek dnešního dne v Praze (ISO, UTC). */
export function pragueDayStart(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const y = get("year"), m = get("month"), d = get("day");
  // posun Prahy vůči UTC (1 nebo 2 h) podle aktuálního času
  const pragueHour = get("hour") % 24;
  const offset = ((pragueHour - now.getUTCHours()) + 24) % 24;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offset * 3_600_000).toISOString();
}

export async function spentToday(db: unknown): Promise<number> {
  const d = db as Db;
  const since = pragueDayStart();
  let total = 0;
  try {
    const { data } = await d.from("drawing_anon_usage_log").select("usd, manual").gte("created_at", since);
    for (const r of (data ?? []) as { usd: number | string | null; manual: boolean | null }[]) {
      if (r.manual) continue;
      total += Number(r.usd ?? 0) || 0;
    }
  } catch {
    // tabulka nedostupná → nepočítat
  }
  return Math.round(total * 10000) / 10000;
}

/** Zapíše útratu jednoho běhu (i neúspěšného). Chyba zápisu běh neshodí. */
export async function logUsage(db: unknown, row: { table: string; id: string; via: string | null; manual: boolean; usage: AiUsage | null; calls: number }): Promise<void> {
  if (!row.calls && !row.usage) return;
  const u = row.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  try {
    await (db as Db).from("drawing_anon_usage_log").insert({
      subject_table: row.table, subject_id: row.id, via: row.via, manual: row.manual,
      usd: Math.round(usageUsd(u) * 10000) / 10000, input_tokens: u.input, output_tokens: u.output,
      cache_read_tokens: u.cacheRead, cache_write_tokens: u.cacheWrite, calls: row.calls,
    });
  } catch {
    // útrata je jen pro limit — nesmí shodit anonymizaci
  }
}
