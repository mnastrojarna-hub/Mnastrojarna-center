/**
 * Opakovaný běh téhož skriptu (vlna E, balík runs) – pravidlo pro `nový díl "A"` / `nová sestava "A"` (zápis agent-runs.ts).
 *
 * Druhé spuštění skriptu v prohlížeči (`window.mncad.run` dvakrát, konzole) i v CLI (`--resume relace`) nesmí založit druhou
 * sadu záložek („Deska“, „Deska“…) ani zdvojit prvky. Proto:
 * * záložka „A“ stejného druhu (díl / sestava), kterou založil DŘÍVĚJŠÍ běh (`Workspace.namedTabs` → `made`) a tento běh ji
 *   ještě nepoužil (`claimed`), se převezme: aktivuje se, její dokument se nahradí prázdným dílem / sestavou „A“ (jeden krok
 *   historie – zpět vrátí předchozí obsah), stav vazeb a kolizí pod jejím klíčem se zahodí (`startDoc` bez nové záložky);
 * * použití se vždy ohlásí: ✓ „… – znovu použitá záložka“ a ℹ `doc.reused` (protokol, JSON i konzole);
 * * záložka „A“, kterou běh nezaložil (otevřený soubor, ruční práce, CLI `--open`), se nepřepíše: dokument dostane novou
 *   záložku a ℹ `doc.name-taken` to řekne; volba `znovu` ji výslovně převezme;
 * * volba `nový` = vždy nová záložka; bez názvu (`nový díl`) vždy nový číslovaný dokument.
 * Více záložek „A“ se přiřazuje v pořadí záložek (první nepoužitá) – skript se dvěma `nový díl "A"` zůstane u dvou záložek.
 * Hostitel bez `namedTabs` / `claimTab` (starší port) = vždy nová záložka (dřívější chování).
 */
import type { NewDocMode } from "../agent-runs";
import type { CadDoc } from "../types";
import type { DocKey, Workspace } from "./workspace";

/** rozhodnutí pro nový dokument běhu: převzít záložku `reuse`, nebo nová záložka (`taken` = název má záložka mimo běh) */
export type NewDocPlan = { reuse: DocKey } | { reuse?: undefined; taken: boolean };

/** Záložka pro `nový díl "name"` podle pravidla výše (`mode` = volba `znovu` / `nový`). */
export function planNewDoc(ws: Workspace, name: string, assembly: boolean, mode?: NewDocMode): NewDocPlan {
  if (mode === "new" || !ws.namedTabs || !ws.claimTab) return { taken: false };
  const free = ws.namedTabs(name, assembly ? "assembly" : "part").filter((t) => !t.claimed);
  const hit = free.find((t) => t.made) ?? (mode === "reuse" ? free[0] : undefined);
  return hit ? { reuse: hit.id } : { taken: free.length > 0 };
}

/** dokumenty běhu podle klíče (`Workspace.runDocKeys`) – hostitel bez evidence = žádné */
export const runDocKeySet = (ws: Workspace): Set<string> => new Set(ws.runDocKeys?.() ?? []);

/** dokument záložky bez přepnutí (`Workspace.docOf`), jinak přes přepnutí záložky (starší hostitel) */
export async function docOfTab(ws: Workspace, id: DocKey): Promise<{ doc: CadDoc; switched: boolean }> {
  const d = ws.docOf?.(id);
  if (d) return { doc: d, switched: false };
  return { doc: await ws.activate(id), switched: true };
}
