/**
 * Stabilní identifikátory záznamů protokolu (vlna 22, bod 15 „stabilní identifikátory výsledků“).
 *
 * `id` záznamu = `L<první řádek>|L-` + `.` + kód (u ✓ bez kódu `ok`, u výpisu `=` jeho druh) a pořadí stejného klíče
 * v běhu od druhého výskytu (`#2`, `#3`): `L36.motion`, `L12.ok`, `L12.ok#2`, `L-.share.rejected`. Nezávisí na čase,
 * čísle běhu ani jazyce – opakovaný běh téhož skriptu dá tatáž id, takže agent může výsledek porovnat mezi běhy. Úplná
 * reference v rámci stránky / relace je `<run.id>:<id>` (`r3:L36.motion`) – `entryRef`.
 *
 * Přiřazuje se po sloučení stejných záznamů (`mergeEntries`) v `ReportBuilder.finish` a `finalizeReport`; záznam, který
 * id už má, ho nemění (idempotentní).
 */
import type { Entry } from "./protocol-types";

const loc = (e: Pick<Entry, "line" | "lines">): string => {
  const ls = (e.lines?.length ? e.lines : [e.line]).filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0);
  return ls.length ? `L${Math.trunc(Math.min(...ls))}` : "L-";
};
const kindOf = (e: Entry): string => (e.code && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(e.code) ? e.code : e.level === "ok" ? "ok" : e.level === "measure" ? "value" : e.level);

/** klíč id bez pořadí (`L36.motion`) */
export const entryKey = (e: Entry): string => `${loc(e)}.${kindOf(e)}`;

/** Doplní `id` všem záznamům bez id (nové pole, záznamy beze změny). */
export function withEntryIds(entries: readonly Entry[]): Entry[] {
  const seen = new Map<string, number>();
  for (const e of entries) if (e.id) seen.set(e.id.replace(/#\d+$/, ""), Math.max(seen.get(e.id.replace(/#\d+$/, "")) ?? 0, Number(/#(\d+)$/.exec(e.id)?.[1] ?? 1)));
  return entries.map((e) => {
    if (e.id) return e;
    const k = entryKey(e);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return { ...e, id: n === 1 ? k : `${k}#${n}` };
  });
}

/** úplná reference záznamu v běhu: `r3:L36.motion` (bez id běhu jen id záznamu) */
export const entryRef = (runId: string | undefined, id: string | undefined): string => (runId ? `${runId}:${id ?? "?"}` : (id ?? "?"));
