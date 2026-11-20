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
import type { ClashCounts } from "../clash-class";
import type { MateStatus, PartFace } from "../mates";
import type { BuildResult, CadDoc } from "../types";

export type DocKey = string;
export type { TabInfo };
/**
 * Původ záložky, kterou založil běh skriptu (opakovaný běh – engine/runs.ts): `new` = dokument vytvořený příkazem běhu
 * (`nový díl`, `nová sestava`, normálie, rám formy, `2d nový`, sestava z vyhazovačů…), `open` = dokument načtený zvenku
 * (`otevřít "soubor"`, JSON / `window.mncad.setDocument`, `předloha otevřít`). Opakovaný běh převezme jen záložku téhož
 * původu – `nový díl "A"` nikdy nepřepíše otevřený soubor „A“.
 */
export type RunOrigin = "new" | "open";
/** druh záložky dokumentu pro opakovaný běh (záložky výkresu sdílí dokument zdrojové záložky) */
export type RunDocKind = "part" | "assembly" | "draft";

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
  /** stav vazeb podle klíče dokumentu (`Workspace.docKey` – nemění se přejmenováním) */
  mateStatus: Map<DocKey, Record<string, MateStatus>>;
  /**
   * poslední výsledek kontroly kolizí podle klíče dokumentu (`at` = čas kontroly pro textový stav, `comps` = počet komponent);
   * stav jedné sestavy se nikdy nepřenese na jinou (ani na sestavu téhož názvu)
   */
  clash: Map<
    DocKey,
    {
      res: Interference[];
      at: string;
      comps?: number;
      /** třídy kolizí (šroub × závit geometricky, clash-class.ts) */
      classes?: ClashCounts;
      /** otisk sestavy v době kontroly (`clashSig`) – jiný otisk = výsledek neplatí (sestava se mezitím změnila) */
      sig?: string;
      /** řádek skriptu kontroly (CLI: ℹ `clash.rechecked` na konci běhu) */
      line?: number | null;
    }
  >;
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
  openInTab(d: CadDoc, o?: { docId?: string; reuseEmpty?: boolean; /** dokument běhu skriptu (`flush`) a jeho původ – opakovaný běh záložku téhož původu použije znovu */ origin?: RunOrigin }): Promise<{ id: DocKey; reused: boolean }>;
  tabs(): TabInfo[];
  activate(id: DocKey): Promise<CadDoc>;
  close(id: DocKey): Promise<CadDoc>;
  undo(n: number): { moved: number };
  redo(n: number): { moved: number };
  /** počet kroků zpět / znovu aktivní záložky (protokol `zpět` / `znovu`) */
  history(): { undo: number; redo: number };
  /** díl podle názvu (bez ohledu na velikost písmen): nejdřív dokumenty vzniklé v tomto běhu (nejnovější), pak záložky */
  findPart(name: string): CadDoc | null;
  /** názvy dílů pro hlášku „díl … není mezi otevřenými záložkami“: dokumenty běhu, pak díly záložek (bez opakování) */
  partNames(): string[];
  /** dokumenty pro odkazy výkresu (`výkres model "záložka"`): dokumenty běhu, pak záložky (bez záložek výkresu) */
  listDocs(): { title: string; doc: CadDoc }[];
  /** výchozí název, který ještě žádná záložka nemá: „Nový díl“, „Nový díl 2“… */
  freshName(base: string): string;
  /**
   * Stálý klíč dokumentu v záložce `id` (výchozí aktivní záložka): id dokumentu (`docId` z `openInTab`). Nemění se
   * přejmenováním, krokem historie ani přepnutím záložky; dokument otevřený do znovu použité záložky dostane nový klíč.
   * Klíč stavu vazeb a kolizí (`asm.mateStatus`, `asm.clash`). Neznámá záložka → "".
   */
  docKey(id?: DocKey): string;
  asm: AsmCaches;
  /** relace `{ v: 1, tabs, active }` s daty importů (`embedBlobs`), bez historie zpět/znovu */
  save(): Uint8Array;
  /** začátek běhu skriptu – od teď vzniklé dokumenty jsou „dokumenty běhu“ (`findPart`) */
  beginRun?(): void;
  /**
   * Konec běhu po zápisu (`commit` / `openInTab`): počká, až hostitel zápis promítne – v aplikaci do stavu Reactu, aby další
   * volání API hned za sebou (`window.mncad.run`, `reference`) vidělo tento dokument (vlna 15); paměťový prostor nic nečeká.
   * Nepromítne-li se, vyhodí CodedError `tab.settle-timeout`.
   */
  settle?(): Promise<void>;
  /* ── opakovaný běh (balík runs – engine/runs.ts): záložky běhů, dokumenty běhu bez přepnutí záložky ── */
  /** dokument záložky `id` bez přepnutí záložky (souhrny dokumentů – řádky D); neznámá záložka → null */
  docOf?(id: DocKey): CadDoc | null;
  /**
   * záložky dílu / sestavy / 2D výkresu s názvem `name` (bez ohledu na velikost písmen) v pořadí záložek: `origin` = původ,
   * pokud ji založil běh skriptu (`openInTab({ origin })`, i v dřívější relaci), `claimed` = patří už tomuto běhu (založil
   * ji nebo převzal `claimTab`)
   */
  namedTabs?(name: string, kind: RunDocKind): { id: DocKey; origin?: RunOrigin; claimed: boolean }[];
  /**
   * záložku `id` převezme tento běh (opakovaný běh `nový díl "A"`, `normálie …`, `otevřít …`): aktivuje ji a zapamatuje
   * si nový původ; `findPart` ji pak bere jako dokument běhu
   */
  claimTab?(id: DocKey, origin: RunOrigin): Promise<CadDoc>;
  /** klíče dokumentů (`docKey`), které tento běh založil nebo změnil (`openInTab` / `commit` od `beginRun`) */
  runDocKeys?(): DocKey[];
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
