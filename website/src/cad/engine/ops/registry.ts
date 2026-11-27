/**
 * Registr operací enginu (CAD-HEADLESS-NAVRH.md kap. 2.3, 2.4): každý druh operace textového skriptu (`AgentOp["k"]`) má
 * jeden soubor v `engine/ops/` a jednu řádku registrace `registerOp("…", handler)`. Smyčka běhu (`runScript`, B2) volá
 * `runEngineOp` – obsluha se nekopíruje mezi aplikací a CLI, obě volají tutéž.
 *
 * Od balíku B2 platí pro všechny týmy: nový textový příkaz = soubor v `engine/ops/` + řádka registrace, ne větev
 * v `cad-app.tsx`. Jeden druh operace = jeden vlastník: druhá registrace téhož druhu je chyba.
 */
import type { AgentOp } from "../../agent";
import { tr } from "../../i18n";
import type { CadDoc, Feature } from "../../types";
import type { ConsoleLog } from "../console";
import type { EngineHost } from "../host";
import type { ReportBuilder } from "../protocol";
import type { RunOptions } from "../protocol-types";
import type { StrictState } from "../strict";
import type { Workspace } from "../workspace";

export type OpKind = AgentOp["k"];
export type OpOf<K extends OpKind> = Extract<AgentOp, { k: K }>;

/** stav jednoho běhu skriptu (pracovní dokument a příznaky smyčky, engine/run.ts) */
export interface RunState {
  /** pracovní kopie dokumentu, na kterou se operace aplikují */
  doc: CadDoc;
  /** dokument se během změnil – na konci / při přechodu na jiný dokument se zapíše (`ws.commit` / `ws.openInTab`) */
  changed: boolean;
  /** dokument je nový – zapíše se do nové záložky (stav na konci pak sestavu nepočítá z mezipaměti – jako dřív) */
  openNew: boolean;
  /** nový dokument už v tomto běhu záložku dostal (`flush`) – další změny jdou do ní, nevzniká druhá záložka */
  tabbed?: boolean;
  /**
   * klíč nového dokumentu (`Workspace.docKey`) ještě před jeho záložkou – `flush` ho předá `openInTab` jako `docId`, takže
   * stav vazeb a kolizí zapsaný před zápisem do záložky k dokumentu patří i potom (`docKeyOf` v run-doc.ts)
   */
  docId?: string;
  /** původ nového dokumentu běhu (`startDoc`) – `flush` ho předá `openInTab`; opakovaný běh pak záložku převezme (engine/runs.ts) */
  origin?: import("../workspace").RunOrigin;
  /**
   * co běh zapsal do záložek PŘED koncem (`flush` při přechodu na jiný dokument – vlna 22, bod 12): nově založené záložky
   * (zrušený běh je zavře) a názvy dokumentů zapsaných krokem historie (zrušený běh je vyjmenuje – nikdy „beze změny“)
   */
  wrote?: {
    opened: { id: string; name: string; /** záložka byla prázdná úvodní – zrušení vrátí tento dokument */ prev?: CadDoc }[];
    committed: string[];
    /**
     * dřívější záložky, do kterých běh zapsal (kolo 7, bod 12): stav před prvním zápisem běhu (`prev`) a revize modelu po
     * posledním zápisu (`lastRev`) – zrušení stav vrátí, nezměnil-li záložku mezitím nikdo jiný
     */
    restore?: { id: string; name: string; prev: CadDoc; lastRev: string }[];
  };
  /** záložka aktivní na začátku běhu (zrušený běh se do ní vrátí) */
  startTab?: string;
  /** prvky přidané během – jejich výsledek (✓ / ⚠ / ✗) se vypíše až po stavbě */
  added?: Feature[];
  /** id prvků, které právě provedená operace přímo upravila (upravit, potlačit, přesunout …) – ověří se a ohlásí na jejím řádku */
  touched?: string[];
  /** těleso zvolené příkazem „těleso N“ – další prvky pracují s ním */
  currentBody?: string | null;
  /** po běhu otevřít výkres (aplikace) */
  openDrawingAfter?: boolean;
  /** poslední operace skriptu („stav“ na konci vypíše jen závěrečný stav) */
  lastOp?: AgentOp;
  /** díly vložené během do sestavy (název malými písmeny → řádek vložení) – pozdější změna dílu = ⚠ asm.stale-copy */
  inserted?: Map<string, number>;
  /** řádky skriptu (kontrola výslovných slov u tichých normalizací – run-doc.ts `prepare`) */
  srcLines?: string[];
  /**
   * nálezy příkazu výkresu, které rozhodne až konec bloku příkazů `výkres …` (překryv / přesah rámečku poznámky, vynechané
   * Chytré kóty – kap. 5.3); smyčka běhu je po operaci převezme (engine/drawing-track.ts)
   */
  drawIssues?: { line: number; issue: import("../../drawing-issues").DrawingIssue }[];
  /** prvky dílu upraveného v kontextu sestavy, které při `sestava hotovo` selhaly (ohlásí je ověření, jinak řádek operace) */
  partFailures?: { doc: string; name: string; error: string }[];
}

/** kontext operace: porty, volby běhu, report, protokol konzole a stav běhu */
export interface OpCtx {
  ws: Workspace;
  host: EngineHost;
  opts: RunOptions;
  report: ReportBuilder;
  run: RunState;
  /** řádek skriptu právě prováděné operace (nastaví `runEngineOp`) */
  line: number;
  /** protokol konzole (dnešní text) souběžně se záznamy s kódem – engine/console.ts; bez něj jen report */
  log?: ConsoleLog;
  /** druh právě prováděné operace (nastaví `runEngineOp`) – druh výpisu `=` */
  kind?: OpKind;
  /** přísný režim běhu (volba běhu + řádky `přísně`, engine/strict.ts) */
  strict?: StrictState;
  /**
   * bloky příkazů výkresu běhu (engine/drawing-track.ts): export listu, který běh měnil, ohlásí jeho nálezy (řez mimo těleso)
   * na řádky příkazů výkresu, ne podruhé na řádku exportu (22i kolo 6)
   */
  draw?: { reportNow(sheetId: string, codes: readonly string[]): Promise<boolean> };
}

export type OpHandler<K extends OpKind> = (op: OpOf<K>, ctx: OpCtx) => Promise<void>;

const handlers = new Map<OpKind, OpHandler<OpKind>>();
const owners = new Map<OpKind, string>();

/**
 * Zaregistruje obsluhu druhu operace. Druhá registrace téhož druhu jiným vlastníkem vyhodí chybu (jeden vlastník na druh
 * operace); tentýž `owner` smí obsluhu nahradit (nové vyhodnocení modulu – Fast Refresh ve vývojovém serveru).
 */
export function registerOp<K extends OpKind>(k: K, h: OpHandler<K>, owner?: string): void {
  if (handlers.has(k) && (owner === undefined || owners.get(k) !== owner)) throw new Error(tr("operace „{0}“ už má obsluhu – každý druh operace má jednoho vlastníka", k));
  handlers.set(k, h as unknown as OpHandler<OpKind>);
  if (owner !== undefined) owners.set(k, owner);
  else owners.delete(k);
}

/**
 * Provede operaci registrovanou obsluhou: nastaví `ctx.line`, změří čas a zapíše ho do reportu (`report.op`, 5 nejpomalejších
 * jde do JSON `timing` a `slow=` v Σ). Vrací false, když druh operace v registru není (smyčka pak hlásí chybu sama).
 * Chyby obsluhy se nepolykají – smyčka je převede na ✗ s kódem.
 */
export async function runEngineOp(op: AgentOp, ctx: OpCtx): Promise<boolean> {
  const h = handlers.get(op.k);
  if (!h) return false;
  const now = ctx.host.now ?? (() => Date.now());
  ctx.line = op.line;
  ctx.kind = op.k;
  const t0 = now();
  try {
    await h(op as OpOf<OpKind>, ctx);
  } finally {
    ctx.report.op(op.line, op.k, Math.max(0, now() - t0));
  }
  return true;
}

/** je druh operace v registru? */
export const hasOp = (k: OpKind): boolean => handlers.has(k);
/** zaregistrované druhy operací (seřazené) – pro kontrolu pokrytí v testech a `mncad selftest` */
export const registeredOps = (): OpKind[] => [...handlers.keys()].sort();
/** odebere obsluhu (jen testy) */
export const unregisterOp = (k: OpKind): boolean => (owners.delete(k), handlers.delete(k));
