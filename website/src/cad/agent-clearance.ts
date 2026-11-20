/**
 * Vůle a spojitost kontroly kolizí pohybové studie textem (vlna 22, bod 6 – čistý parser, úprava studie a zápis do skriptu;
 * výpočet cad/motion-clearance.ts, výstupy cad/clearance-report.ts):
 *
 * - `pohyb vůle "A" "B" [min 0,05] [zjemnit | bez zjemnění]` – sledovat nejmenší vzdálenost dvojice komponent během pohybu, limit
 *   nedostatečné vůle (pod ním ⚠ clash.clearance s místem a krokem); další dvojice dalším příkazem; `pohyb vůle "A" "B" smazat`;
 * - `pohyb vůle pohyblivé [min 0,1]` – všechny pohyblivé komponenty vůči ostatním (dvojice blíž než limit + rezerva);
 * - `pohyb vůle min 0,05` – jen limit; `pohyb vůle` – nastavení a výsledek; `pohyb vůle seznam` – všechny dvojice výsledku;
 *   `pohyb vůle smazat` – vůli nesledovat;
 * - `pohyb kolize spojitě | diskrétně` – kolize i mezi polohami (zjemnění úseků, dráha posuvu – výchozí) nebo jen v polohách kroků
 *   (výsledek pak výslovně „mezi polohami nekontrolováno“).
 *
 * EN `motion clearance "A" "B" [min 0.05] [refine | no-refine]`, `motion clearance moving`, `motion collisions continuous|discrete`;
 * DE `bewegung spiel "A" "B" [min 0,05] [verfeinern | ohne verfeinerung]`, `bewegung spiel bewegliche`, `bewegung kollision stetig|diskret`.
 */
import { AsmCursor, asmIsNum, asmNum, asmWords as W, findComp } from "./agent-asm";
import { clearanceStepLines, clearanceSummaryLines } from "./clearance-report";
import { leafLabel } from "./clash-report";
import { tr } from "./i18n";
import type { MotionResult } from "./motion";
import type { CadDoc, MotionClearance, MotionStudy } from "./types";

export type ClearanceCmd =
  | { k: "status" }
  | { k: "list" }
  | { k: "set"; a?: string; b?: string; moving?: boolean; limit?: number; refine?: boolean }
  | { k: "remove"; a: string; b: string }
  | { k: "clear" }
  | { k: "mode"; continuous: boolean };

const CLR = W("vůle", "vule", "vůli", "clearance", "gap", "spiel", "abstand");
const CLASH = W("kolize", "kolizí", "collisions", "collision", "interference", "kollision", "kollisionen");
const CONT = W("spojitě", "spojite", "spojitá", "spojita", "spojitý", "continuous", "continuously", "stetig", "kontinuierlich");
const DISC = W("diskrétně", "diskretne", "diskrétní", "diskretni", "discrete", "discretely", "diskret");
const MOVING = W("pohyblivé", "pohyblive", "pohyblivých", "moving", "movable", "bewegliche", "beweglich", "bewegte");
const MIN = W("min", "minimum", "limit", "nejméně", "nejmene", "mindestens", "grenze");
const REFINE = W("zjemnit", "zjemnění", "zjemneni", "refine", "verfeinern", "verfeinerung");
const NOREF = W("bez", "without", "no", "ohne");
const NOREF1 = W("no-refine", "nezjemňovat", "nezjemnovat");
const DEL = W("smazat", "zrušit", "zrusit", "odstranit", "odebrat", "delete", "remove", "clear", "off", "vyp", "löschen", "loeschen", "entfernen", "aus");
const STATUS = W("stav", "status", "info", "zustand");
const LIST = W("seznam", "výpis", "vypis", "list", "liste");

export const CLEARANCE_USAGE = (): string =>
  tr("pohyb vůle \"A\" \"B\" [min 0,05] [zjemnit | bez zjemnění] · pohyb vůle pohyblivé [min 0,1] · pohyb vůle [seznam | smazat] · pohyb vůle \"A\" \"B\" smazat · pohyb kolize spojitě | diskrétně");

/** `pohyb kolize spojitě|diskrétně` nebo `pohyb vůle …` (kurzor za slovem „pohyb“); jiný podpříkaz → null */
export function parseClearanceText(c: AsmCursor): ClearanceCmd | null {
  if (c.is(CLASH) && (c.is(CONT, 1) || c.is(DISC, 1))) {
    const continuous = c.is(CONT, 1);
    c.i += 2;
    if (!c.done) throw new Error(tr("pohyb kolize spojitě|diskrétně: neznámá volba „{0}“", c.peek()!.t));
    return { k: "mode", continuous };
  }
  if (!c.is(CLR)) return null;
  c.i++;
  if (c.done || c.is(STATUS)) return { k: "status" };
  if (c.is(LIST) && c.peek(1) === undefined) return { k: "list" };
  if (c.is(DEL) && c.peek(1) === undefined) return { k: "clear" };
  const out: Extract<ClearanceCmd, { k: "set" }> = { k: "set" };
  const names: string[] = [];
  let del = false;
  while (!c.done) {
    if (c.is(MOVING)) {
      c.i++;
      out.moving = true;
    } else if (c.is(MIN)) {
      c.i++;
      out.limit = c.num(tr("limit vůle [mm]"));
      if (!(out.limit >= 0 && out.limit <= 1000)) throw new Error(tr("limit vůle: 0 až 1000 mm (např. min 0,05)"));
    } else if (c.is(REFINE)) {
      c.i++;
      out.refine = true;
    } else if (c.is(NOREF1)) {
      c.i++;
      out.refine = false;
    } else if (c.is(NOREF) && c.is(REFINE, 1)) {
      c.i += 2;
      out.refine = false;
    } else if (c.is(DEL)) {
      c.i++;
      del = true;
    } else if (!c.peek()!.q && asmIsNum(c.peek()!.t) && names.length === 2 && out.limit === undefined) {
      out.limit = asmNum(c.next()!.t); // „pohyb vůle "A" "B" 0,05“
    } else {
      const t = c.next()!;
      if (!t.q && /^[a-z]/i.test(t.t) && !/^#/.test(t.t) && names.length >= 2) throw new Error(tr("pohyb vůle: neznámá volba „{0}“ – {1}", t.t, CLEARANCE_USAGE()));
      names.push(t.t.trim());
    }
  }
  if (names.length !== 0 && names.length !== 2) throw new Error(tr("pohyb vůle: zadejte dvojici komponent – {0}", CLEARANCE_USAGE()));
  if (out.moving && names.length) throw new Error(tr("pohyb vůle: buď dvojice komponent, nebo „pohyblivé“ – ne obojí"));
  if (del) {
    if (names.length !== 2) throw new Error(tr("pohyb vůle … smazat: zadejte dvojici – pohyb vůle \"A\" \"B\" smazat (nebo pohyb vůle smazat)"));
    return { k: "remove", a: names[0], b: names[1] };
  }
  if (names.length === 2) [out.a, out.b] = names;
  if (!names.length && !out.moving && out.limit === undefined && out.refine === undefined) throw new Error(tr("pohyb vůle: nic k nastavení – {0}", CLEARANCE_USAGE()));
  return out;
}

/* ───────────────────────── úprava studie ───────────────────────── */

const compName = (doc: CadDoc, id: string) => leafLabel(doc, [id]);
const mmText = (v: number) => String(Math.round(v * 1e6) / 1e6);

/** popis nastavení vůle: „sledováno „A“ × „B“; limit 0,05 mm; zjemnění u kontaktu“ */
export function clearanceSettingsText(doc: CadDoc, c: MotionClearance | undefined, collisions?: boolean): string {
  const pairs = !c?.pairs ? tr("nesleduje se") : c.pairs === "moving" ? tr("pohyblivé díly vůči ostatním") : c.pairs.map((p) => `„${compName(doc, p.a)}“ × „${compName(doc, p.b)}“`).join(", ") || tr("nesleduje se");
  const lim = c?.limit !== undefined ? tr("limit {0} mm", mmText(c.limit).replace(".", tr(","))) : tr("bez limitu");
  const mode = c?.refine === false ? tr("jen v polohách kroků (diskrétně)") : tr("spojitě – zjemnění u kontaktu a kontrola mezi polohami");
  return tr("Vůle: {0} · {1} · kontrola {2}{3}", pairs, lim, mode, collisions ? "" : tr(" (kolize v pohybu vypnuté – pohyb kolize)"));
}

/** nová definice vůle ve studii (bez prázdných polí; nic nesledováno + výchozí zjemnění = bez `clearance`) */
function normalized(c: MotionClearance): MotionClearance | undefined {
  const out: MotionClearance = {};
  if (c.pairs === "moving" || (Array.isArray(c.pairs) && c.pairs.length)) out.pairs = c.pairs;
  if (c.limit !== undefined) out.limit = c.limit;
  if (c.refine === false) out.refine = false;
  return Object.keys(out).length ? out : undefined;
}

export type ClearanceHost = {
  /** spočítá studii dokumentu a zapíše souhrn do protokolu (asm-agent-kin.ts `runLog`) */
  runLog: (doc: CadDoc) => Promise<MotionResult>;
  /** řádky definice studie */
  lines: (doc: CadDoc) => string[];
  /** platný uložený výsledek pro dokument (bez výpočtu) */
  cached: (doc: CadDoc) => MotionResult | null;
  log: string[];
};

/** Provede `pohyb vůle …` / `pohyb kolize spojitě|diskrétně`: upraví studii a (je-li motor nebo dynamika) ji spočítá. */
export async function applyClearanceCmd(d: CadDoc, cmd: ClearanceCmd, study: MotionStudy, h: ClearanceHost): Promise<{ doc: CadDoc; log: string[]; changed: boolean; open?: boolean }> {
  const log = h.log;
  const canRun = (s: MotionStudy) => s.motors.length > 0 || s.mode === "dynamic";
  if (cmd.k === "status" || cmd.k === "list") {
    log.push(clearanceSettingsText(d, d.motion?.clearance, d.motion?.collisions));
    const res = h.cached(d);
    if (res) {
      const lines = clearanceSummaryLines(res, d);
      if (cmd.k === "list") {
        const c = (res as { clearance?: { pairs: { a: string; b: string; min: { d: number } | null }[] } }).clearance;
        for (const p of c?.pairs ?? []) if (p.min) log.push(tr(" „{0}“ × „{1}“: nejmenší {2} mm", compName(d, p.a), compName(d, p.b), mmText(p.min.d)));
      } else log.push(...lines);
    } else if (d.motion && canRun(d.motion)) log.push(tr(" výsledek pro nynější stav sestavy není spočítán – pohyb spustit"));
    return { doc: d, log, changed: false };
  }
  const cur: MotionClearance = { ...(study.clearance ?? {}) };
  if (cmd.k === "mode") {
    if (cmd.continuous) delete cur.refine;
    else cur.refine = false;
    study.collisions = true;
  } else if (cmd.k === "clear") {
    delete cur.pairs;
    delete cur.limit;
  } else if (cmd.k === "remove") {
    const a = findComp(d, cmd.a).id;
    const b = findComp(d, cmd.b).id;
    const list = Array.isArray(cur.pairs) ? cur.pairs : [];
    const next = list.filter((p) => !((p.a === a && p.b === b) || (p.a === b && p.b === a)));
    if (next.length === list.length) throw new Error(tr("pohyb vůle: dvojice „{0}“ × „{1}“ se nesleduje", cmd.a, cmd.b));
    cur.pairs = next;
  } else {
    if (cmd.moving) cur.pairs = "moving";
    if (cmd.a && cmd.b) {
      const A = findComp(d, cmd.a);
      const B = findComp(d, cmd.b);
      if (A.id === B.id) throw new Error(tr("pohyb vůle: dvojice potřebuje dvě různé komponenty – „{0}“ je A i B", A.name));
      const list = Array.isArray(cur.pairs) ? cur.pairs : [];
      if (!list.some((p) => (p.a === A.id && p.b === B.id) || (p.a === B.id && p.b === A.id))) cur.pairs = [...list, { a: A.id, b: B.id }];
      else cur.pairs = list;
    }
    if (cmd.limit !== undefined) cur.limit = cmd.limit;
    if (cmd.refine !== undefined) {
      if (cmd.refine) delete cur.refine;
      else cur.refine = false;
    }
  }
  const nc = normalized(cur);
  if (nc) study.clearance = nc;
  else delete study.clearance;
  const doc = { ...d, motion: study };
  log.push(clearanceSettingsText(doc, study.clearance, study.collisions));
  if (canRun(study)) await h.runLog(doc);
  else log.push(tr(" studie zatím nemá motor – vůle se spočítá s pohybem (pohyb motor …)"));
  return { doc, log, changed: true, open: true };
}

/* ───────────────────────── skript dokumentu ───────────────────────── */

const SCRIPT_WORDS = {
  motion: ["pohyb", "motion", "bewegung"],
  clr: ["vůle", "clearance", "spiel"],
  min: ["min", "min", "min"],
  moving: ["pohyblivé", "moving", "bewegliche"],
  noref: ["bez zjemnění", "no-refine", "ohne verfeinerung"],
} as const;

/**
 * Řádky skriptu dokumentu pro vůli studie (doc-script.ts): `pohyb vůle #1 #2 min 0.05`, `pohyb vůle pohyblivé`, `pohyb vůle bez
 * zjemnění`. Komponenty pořadím (`ref`); dvojice s komponentou mimo skript se vynechá (`skipped`).
 */
export function clearanceScript(doc: CadDoc, li: 0 | 1 | 2, ref: (id: string) => string | null): { lines: string[]; skipped: number } {
  const c = doc.motion?.clearance;
  if (!c) return { lines: [], skipped: 0 };
  const w = (k: keyof typeof SCRIPT_WORDS) => SCRIPT_WORDS[k][li];
  const head = `${w("motion")} ${w("clr")}`;
  const lim = c.limit !== undefined ? ` ${w("min")} ${mmText(c.limit)}` : "";
  const lines: string[] = [];
  let skipped = 0;
  let limDone = false;
  if (c.pairs === "moving") {
    lines.push(`${head} ${w("moving")}${lim}`);
    limDone = true;
  } else
    for (const p of c.pairs ?? []) {
      const a = ref(p.a);
      const b = ref(p.b);
      if (!a || !b) {
        skipped++;
        continue;
      }
      lines.push(`${head} ${a} ${b}${limDone ? "" : lim}`);
      limDone = true;
    }
  if (!limDone && lim) lines.push(`${head}${lim}`);
  if (c.refine === false) lines.push(`${head} ${w("noref")}`);
  return { lines, skipped };
}

/** řádky `pohyb krok N` o vůli (re-export pro asm-agent-kin.ts) */
export { clearanceStepLines };
