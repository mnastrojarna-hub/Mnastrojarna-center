/**
 * Port pracovního prostoru (záložky dokumentů, historie, mezipaměti sestavy) – CAD-HEADLESS-NAVRH.md kap. 2.3 a 2.5.
 *
 * Engine (`runScript`, balík B2) pracuje jen přes toto rozhraní: v aplikaci ho implementuje React adaptér
 * (`components/cad/engine-port.ts`, B2) nad dnešními funkcemi `commit` / `openDocInTab` / `activateTab` / `closeTab`,
 * v Node a v `mncad serve` `MemoryWorkspace` (memory-workspace.ts).
 */
import type { TabInfo } from "../agent-asm";
import type { PartFaces } from "../asm-agent";
import type { Interference } from "../asm-kernel";
import type { MateStatus, PartFace } from "../mates";
import type { BuildResult, CadDoc } from "../types";

export type DocKey = string;
export type { TabInfo };

/** mezipaměti sestavy (klientská strana jádra) – platí pro jednu generaci jádra (`generation`) */
export type AsmCaches = {
  /** generace jádra, pro kterou platí `cache` / `geo` / `faceLists` (porovnává se s `kernel.generation()`) */
  generation: number;
  /** výsledky stavby dílů podle `sourceKey` */
  cache: Map<string, BuildResult>;
  /** geometrie ploch `klíč:index` */
  geo: Map<string, PartFace>;
  /** seznamy ploch dílů podle klíče */
  faceLists: Map<string, PartFaces>;
  /** zásobník úprav dílu v kontextu sestavy (`sestava upravit` / `sestava hotovo`) */
  stack: { asm: CadDoc; key: string }[];
  /** stav vazeb podle dokumentu */
  mateStatus: Map<DocKey, Record<string, MateStatus>>;
  /** poslední výsledek kontroly kolizí podle dokumentu */
  clash: Map<DocKey, { res: Interference[]; at: string }>;
};

export interface Workspace {
  /** dokument aktivní záložky */
  present(): CadDoc;
  /** jeden krok historie aktivní záložky (historie max. `HISTORY_MAX` kroků zpět) */
  commit(d: CadDoc): void;
  /**
   * Otevře dokument – vždy `normalizeDraftDoc(internBlobs(d))`. Prázdná záložka se znovu použije jen pro úvodní prázdný díl
   * relace (`reuseEmpty`, výchozí true), nikdy pro dokument vytvořený během (5.2 č. 14).
   */
  openInTab(d: CadDoc, o?: { docId?: string; reuseEmpty?: boolean }): Promise<{ id: DocKey; reused: boolean }>;
  tabs(): TabInfo[];
  activate(id: DocKey): Promise<CadDoc>;
  close(id: DocKey): Promise<CadDoc>;
  undo(n: number): { moved: number };
  redo(n: number): { moved: number };
  /** díl podle názvu (bez ohledu na velikost písmen): nejdřív dokumenty vzniklé v tomto běhu (nejnovější), pak záložky */
  findPart(name: string): CadDoc | null;
  /** výchozí název, který ještě žádná záložka nemá: „Nový díl“, „Nový díl 2“… */
  freshName(base: string): string;
  asm: AsmCaches;
  /** relace `{ v: 1, tabs, active }` s daty importů (`embedBlobs`), bez historie zpět/znovu */
  save(): Uint8Array;
  /** začátek běhu skriptu – od teď vzniklé dokumenty jsou „dokumenty běhu“ (`findPart`) */
  beginRun?(): void;
}

/** nejvíc kroků zpět na záložku (jako aplikace: cad-app.tsx `commit`) */
export const HISTORY_MAX = 80;

/** prázdné mezipaměti sestavy pro generaci jádra `generation` */
export const newAsmCaches = (generation = 0): AsmCaches => ({ generation, cache: new Map(), geo: new Map(), faceLists: new Map(), stack: [], mateStatus: new Map(), clash: new Map() });

/**
 * Kap. 2.5: před každou operací sestavy porovnat generaci mezipamětí s `kernel.generation()`. Jiná generace (jádro se
 * restartovalo, jeho LRU dílů je prázdné) → vyprázdnit výsledky stavby a geometrii ploch a vrátit true (engine zapíše
 * ℹ `asm.kernel-restarted`). Zásobník úprav, stav vazeb a kolize jsou data dokumentů, ty zůstávají.
 */
export function syncKernelGeneration(asm: AsmCaches, kernelGeneration: number): boolean {
  if (asm.generation === kernelGeneration) return false;
  asm.cache.clear();
  asm.geo.clear();
  asm.faceLists.clear();
  asm.generation = kernelGeneration;
  return true;
}
