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
import type { CadDoc } from "../../types";
import type { EngineHost } from "../host";
import type { ReportBuilder } from "../protocol";
import type { RunOptions } from "../protocol-types";
import type { Workspace } from "../workspace";

export type OpKind = AgentOp["k"];
export type OpOf<K extends OpKind> = Extract<AgentOp, { k: K }>;

/** stav jednoho běhu skriptu (pracovní dokument a příznaky smyčky); smyčka B2 ho vyplní a podle potřeby rozšíří */
export interface RunState {
  /** pracovní kopie dokumentu, na kterou se operace aplikují */
  doc: CadDoc;
  /** dokument se během změnil – na konci / při přechodu na jiný dokument se zapíše (`ws.commit` / `ws.openInTab`) */
  changed: boolean;
  /** dokument je nový – zapíše se do nové záložky */
  openNew: boolean;
}

/** kontext operace: porty, volby běhu, report a stav běhu */
export interface OpCtx {
  ws: Workspace;
  host: EngineHost;
  opts: RunOptions;
  report: ReportBuilder;
  run: RunState;
  /** řádek skriptu právě prováděné operace (nastaví `runEngineOp`) */
  line: number;
}

export type OpHandler<K extends OpKind> = (op: OpOf<K>, ctx: OpCtx) => Promise<void>;

const handlers = new Map<OpKind, OpHandler<OpKind>>();

/** Zaregistruje obsluhu druhu operace. Druhá registrace téhož druhu vyhodí chybu (jeden vlastník na druh operace). */
export function registerOp<K extends OpKind>(k: K, h: OpHandler<K>): void {
  if (handlers.has(k)) throw new Error(tr("operace „{0}“ už má obsluhu – každý druh operace má jednoho vlastníka", k));
  handlers.set(k, h as unknown as OpHandler<OpKind>);
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
export const unregisterOp = (k: OpKind): boolean => handlers.delete(k);
