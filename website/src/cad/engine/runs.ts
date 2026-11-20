/**
 * Opakovaný běh téhož skriptu (vlna E, balík runs) – pravidlo pro každý dokument, který běh založí (zápis agent-runs.ts).
 *
 * Druhé spuštění skriptu v prohlížeči (`window.mncad.run` dvakrát, konzole) i v CLI (`--resume relace`) nesmí založit druhou
 * sadu záložek („Deska“, „Deska“…) ani zdvojit prvky. Platí pro všechny dokumenty běhu, ne jen `nový díl`:
 * * každý nový dokument běhu má **původ** (`RunOrigin`, workspace.ts): `new` = vytvořený příkazem (`nový díl`, `nová sestava`,
 *   normálie, rám formy, `2d nový`, komponenta otevřená jako kopie, sestava z vyhazovačů / chlazení), `open` = načtený zvenku
 *   (`otevřít "soubor"`, JSON dokument / `window.mncad.setDocument`, `předloha otevřít`);
 * * záložka stejného názvu a druhu (díl / sestava / 2D výkres), kterou založil DŘÍVĚJŠÍ běh dokumentem téhož původu
 *   (`Workspace.namedTabs` → `origin`) a tento běh ji ještě nepoužil (`claimed`), se převezme: aktivuje se, její dokument
 *   se nahradí novým (jeden krok historie – zpět vrátí předchozí obsah), stav vazeb a kolizí pod jejím klíčem se zahodí;
 * * použití se vždy ohlásí: ✓ „… – znovu použitá záložka“ (u příkazů s vlastním textem) a ℹ `doc.reused`, ve stručném
 *   protokolu i bez `notes` (protocol.ts) a v Σ `reused=<n>`;
 * * záložka jiného původu se nepřepíše – `nový díl "A"` tak nikdy nenahradí otevřený soubor „A“ (jako CLI `--open`) ani ruční
 *   práci: dokument dostane novou záložku a ℹ `doc.name-taken` to řekne; `nový díl "A" znovu` ji výslovně převezme;
 * * `nový díl "A" nový` = vždy nová záložka; výchozí název (`nový díl` bez názvu, JSON bez názvu, „Nový díl 2“) se nikdy
 *   znovu nepoužije – dva různé nepojmenované dokumenty se nesmí přepsat.
 * Více záložek „A“ se přiřazuje v pořadí záložek (první nepoužitá) – skript se dvěma `nový díl "A"` zůstane u dvou záložek.
 * Hostitel bez `namedTabs` / `claimTab` (starší port) = vždy nová záložka (dřívější chování).
 */
import type { NewDocMode } from "../agent-runs";
import { docTabKind } from "../draft/doc";
import { tr } from "../i18n";
import type { CadDoc } from "../types";
import { coded, type OpCtx } from "./ops/util";
import { startDoc } from "./run-doc";
import type { DocKey, RunDocKind, RunOrigin, Workspace } from "./workspace";

export type { RunOrigin };

/** rozhodnutí pro nový dokument běhu: převzít záložku `reuse`, nebo nová záložka (`taken` = název má záložka jiného původu) */
export type NewDocPlan = { reuse: DocKey } | { reuse?: undefined; taken: boolean };

/** Záložka pro nový dokument běhu `name` podle pravidla výše (`mode` = volba `znovu` / `nový` u `nový díl`). */
export function planRunDoc(ws: Workspace, name: string, kind: RunDocKind, origin: RunOrigin, mode?: NewDocMode): NewDocPlan {
  if (mode === "new" || !ws.namedTabs || !ws.claimTab) return { taken: false };
  const free = ws.namedTabs(name, kind).filter((t) => !t.claimed);
  const hit = free.find((t) => t.origin === origin) ?? (mode === "reuse" ? free[0] : undefined);
  return hit ? { reuse: hit.id } : { taken: free.length > 0 };
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * Výchozí (i číslovaný) název dokumentu – „Nový díl“, „Nová sestava 3“, „Nový 2D výkres“ v jazyce běhu i česky. Takový
 * dokument se opakovaným během nikdy nepřevezme (dva nepojmenované dokumenty nejsou „tentýž“ dokument).
 */
export function isDefaultDocName(name: string): boolean {
  const n = (name ?? "").trim();
  if (!n) return true;
  const bases = new Set(["Nový díl", "Nová sestava", "Nový 2D výkres", tr("Nový díl"), tr("Nová sestava"), tr("Nový 2D výkres")]);
  return [...bases].some((b) => new RegExp(`^${escRe(b)}(?: \\d+)?$`, "i").test(n));
}

/** výsledek `startRunDoc`: `reused` = převzatá záložka; `report()` zapíše ℹ (po řádku ✓ operace, aby pořadí v konzoli sedělo) */
export type RunDocStart = { reused: boolean; report(): void };

/**
 * Nový dokument běhu s pravidlem opakovaného běhu (viz hlavička modulu) – místo `startDoc` ve všech operacích, které
 * zakládají dokument v nové záložce. `fresh` = vždy nová záložka (`nový díl` bez názvu).
 */
export async function startRunDoc(ctx: OpCtx, d: CadDoc, o: { origin: RunOrigin; mode?: NewDocMode; fresh?: boolean }): Promise<RunDocStart> {
  const plan: NewDocPlan = o.fresh || isDefaultDocName(d.name) ? { taken: false } : planRunDoc(ctx.ws, d.name, docTabKind(d), o.origin, o.mode);
  if (plan.reuse !== undefined) {
    await ctx.ws.claimTab!(plan.reuse, o.origin);
    startDoc(ctx, d, { openNew: false, origin: o.origin }); // jeden krok historie záložky; stav vazeb a kolizí původního dokumentu zahozen
    return { reused: true, report: () => coded(ctx, "doc.reused", { doc: d.name, args: [d.name] }) };
  }
  startDoc(ctx, d, { origin: o.origin });
  return { reused: false, report: () => void (plan.taken && coded(ctx, "doc.name-taken", { doc: d.name, args: [d.name] })) };
}

/** dokumenty běhu podle klíče (`Workspace.runDocKeys`) – hostitel bez evidence = žádné */
export const runDocKeySet = (ws: Workspace): Set<string> => new Set(ws.runDocKeys?.() ?? []);

/** dokument záložky bez přepnutí (`Workspace.docOf`), jinak přes přepnutí záložky (starší hostitel) */
export async function docOfTab(ws: Workspace, id: DocKey): Promise<{ doc: CadDoc; switched: boolean }> {
  const d = ws.docOf?.(id);
  if (d) return { doc: d, switched: false };
  return { doc: await ws.activate(id), switched: true };
}
