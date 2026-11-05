"use client";

import * as React from "react";
import type { AnonDebugEntry } from "@/lib/anonymize/types";

/**
 * Technický detail pokusů anonymizace (sloupec anon_debug) — JEN super admin (server ho jinému uživateli
 * nepošle). Majitel 5. 11.: aby šlo říct, proč a ve které fázi se pokus v produkci nepovedl, bez hledání v logu.
 */

const STAGE: Record<string, string> = {
  start: "začátek", download: "stažení originálu", terms: "termíny", twin: "stejný soubor", budget: "denní limit", pipeline: "zpracování (detekce, vypálení, kontrola)",
  continue: "další dávka stran", decide: "rozhodnutí o výsledku", upload: "uložení kopie", finish: "dokončení",
};

const STATUS: Record<string, string> = { done: "hotovo", pending: "čeká / opakuje se", failed: "selhalo", skipped: "přeskočeno", unsupported: "nelze", review: "ke kontrole" };

function secs(ms: number): string {
  return ms >= 10_000 ? `${Math.round(ms / 1000)} s` : `${(ms / 1000).toFixed(1)} s`;
}

/** Jeden řádek pro člověka (čistá funkce — testy). */
export function describeDebugEntry(e: AnonDebugEntry): string {
  const parts = [`${e.attempt}. pokus`, STAGE[e.stage] ?? e.stage, secs(e.ms), STATUS[e.status] ?? e.status];
  if (e.retryNow) parts.push("hned znovu v témže běhu");
  else if (e.delayMs && e.delayMs > 0) parts.push(`další pokus za ${Math.round(e.delayMs / 60_000)} min`);
  if (typeof e.next === "number" && e.next > 0) parts.push(`pokračuje stranou ${e.next}`);
  if (e.calls) parts.push(`AI ${e.calls}× (${(e.usd ?? 0).toFixed(2)} USD)`);
  if (e.error) parts.push(`chyba: ${e.error}`);
  return parts.join(" · ");
}

export function AnonDebugDetails({ entries, className }: { entries: AnonDebugEntry[] | null | undefined; className?: string }) {
  const list = (entries ?? []).filter((e) => e && typeof e === "object").slice(-12).reverse();
  if (!list.length) return null;
  return (
    <details className={className ?? "text-[11px] text-muted-foreground"} data-testid="anon-debug">
      <summary className="cursor-pointer select-none">Technický detail pokusů (jen správce)</summary>
      <ul className="mt-1 space-y-0.5 font-mono">
        {list.map((e, i) => (
          <li key={`${e.at}-${i}`} className="break-words">
            <span className="text-foreground/70">{new Date(e.at).toLocaleString("cs-CZ")}</span>{e.run ? ` [${e.run}]` : ""} — {describeDebugEntry(e)}
          </li>
        ))}
      </ul>
    </details>
  );
}
