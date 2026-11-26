/**
 * Výpočty uvnitř aplikace s identitou běhu (vlna 22, bod 12 – „každý výpočet musí mít ID běhu a revizi vstupu, stavy
 * čeká / počítá / dokončeno / zrušeno / chyba“): stavba modelu, přepočet vazeb, kontrola kolizí, měření.
 *
 * Dřív měly jen vnitřní stráž pořadí (`SeqGuard`), která pozdní odpověď tiše zahodila – uživatel ani agent neviděl, který
 * výpočet běží a pro jakou revizi. Teď každý start dostane záznam v `computeRuns` (týž model `RunTracker` jako textové běhy
 * a exporty – engine/run-queue.ts, jen bez fronty: pořadí řídí aplikace): id `v12`, revize vstupu `<klíč>@r·a1b2c3`, stav
 * `queued | running | done | superseded | cancelled | error`. Pozdní odpověď staršího výpočtu = „nahrazeno“ (superseded),
 * nikdy „dokončeno“. Stavový řádek ukazuje poslední výpočet (`data-compute-*`), `window.mncad.computes()` je vypíše.
 */
import { tr } from "@/cad/i18n";
import { inputRevOf, isFinal, RunTracker, type RunEntry, type RunSnapshot } from "@/cad/engine/run-queue";
import type { CadDoc } from "@/cad/types";

export type ComputeKind = "build" | "mates" | "clash" | "measure";

/** výpočty aplikace (id `v1`, `v2`… – odlišná řada od běhů `r…`) */
export const computeRuns = new RunTracker({ prefix: "v", keep: 40 });

/** název druhu výpočtu pro člověka */
export const computeLabel = (k: ComputeKind | string): string =>
  k === "build" ? tr("stavba modelu") : k === "mates" ? tr("přepočet vazeb") : k === "clash" ? tr("kontrola kolizí") : k === "measure" ? tr("měření") : String(k);

export type ComputeEnd = "done" | "superseded" | "cancelled" | "error";

/** jeden výpočet: `start()` (z „čeká“ na „počítá“), `end(stav)` – jen první konec platí */
export type ComputeRun = { readonly id: string; start(): void; end(state: ComputeEnd, error?: string): void; readonly ended: boolean };

/** nový výpočet druhu `kind` nad dokumentem `doc` záložky `docKey`; `queued` = čeká (stavba čeká na doběhnutí předchozí) */
export function computeBegin(kind: ComputeKind, docKey: string, doc: CadDoc, o: { queued?: boolean } = {}): ComputeRun {
  const e = computeRuns.begin({ kind: "compute", source: "app", label: computeLabel(kind), what: kind, doc: doc.name, docKey, inputRev: inputRevOf(docKey, doc) });
  if (!o.queued) computeRuns.start(e.id);
  return {
    id: e.id,
    start: () => computeRuns.start(e.id),
    end: (state, error) => {
      const cur = computeRuns.get(e.id);
      if (!cur || isFinal(cur.state)) return;
      if (cur.state === "queued") computeRuns.start(e.id); // konec čekajícího (nahrazen novějším) – čas 0
      computeRuns.end(e.id, state, error);
    },
    get ended() {
      const cur = computeRuns.get(e.id);
      return !cur || isFinal(cur.state);
    },
  };
}

/**
 * Výpočet `fn` se záznamem: konec „dokončeno“, pokud ho `fn` neukončila jinak (`run.end("superseded")` po pozdní odpovědi);
 * výjimka = „chyba“ (zrušení výpočtu v jádře = „zrušeno“) a projde dál.
 */
export async function tracked<T>(kind: ComputeKind, docKey: string, doc: CadDoc, fn: (run: ComputeRun) => Promise<T>, isCancel: (e: unknown) => boolean = () => false): Promise<T> {
  const run = computeBegin(kind, docKey, doc);
  try {
    const r = await fn(run);
    run.end("done");
    return r;
  } catch (e) {
    run.end(isCancel(e) ? "cancelled" : "error", e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** výpočty pro automatizaci (`window.mncad.computes()`; `kind` = jen jeden druh) */
export const computesSnapshot = (kind?: ComputeKind): RunSnapshot[] =>
  computeRuns
    .list("compute")
    .filter((e) => !kind || e.what === kind)
    .map((e) => computeRuns.snapshot(e));

/** poslední výpočet (stavový řádek) */
export const lastCompute = (): RunEntry | undefined => computeRuns.list("compute").at(-1);
