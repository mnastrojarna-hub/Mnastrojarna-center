/**
 * Procesní vrstva pohybové studie textem (vlna 22, bod 4 – čistý parser, úprava studie, zápis do skriptu; výpočet
 * cad/motion-process.ts + jádro cad/process-kernel.ts):
 *
 * - `pohyb proces střih "Razník" "Plech" [hloubka 0,5] [při vazba "ZDVIH" <= 1 | při motor 1 <= 1 | od 0,5 s | fáze "Střih"]
 *   [odpad padá | s nástrojem | zůstane] [název "Děrování"]` – střih / děrování (bez hloubky do prostřižení; po prostřižení odpad);
 * - `pohyb proces ražení|otisk|značení "Razník" "Plech" hloubka 0,3 […]` – otisk s řízenou hloubkou;
 * - `pohyb proces` / `pohyb proces seznam` – operace a výsledek; `pohyb proces smazat` – všechny; `pohyb proces 2 smazat` / `pohyb proces smazat 2`.
 *
 * EN `motion process cut|punch|pierce "Punch" "Sheet" [depth 0.5] [when mate "STROKE" <= 1 | when motor 1 <= 1 | from 0.5 s | phase "Cut"]
 * [scrap fall|tool|stay] [name "…"]`, `motion process imprint|stamp|emboss … depth 0.3`, `motion process list|delete`;
 * DE `bewegung prozess schnitt|stanzen|lochen "Stempel" "Blech" [tiefe 0,5] [wenn verknüpfung … <= 1 | ab 0,5 s | phase "…"]
 * [abfall fällt|werkzeug|bleibt]`, `bewegung prozess prägen|prägung|markieren … tiefe 0,3`, `bewegung prozess liste|löschen`.
 */
import { AsmCursor, asmIsNum, asmWords as W, findComp, findMate, fold } from "./agent-asm";
import { tr } from "./i18n";
import type { MotionResult } from "./motion";
import { condProblem, opText, processLevelSentence, processLines, productLines } from "./motion-process";
import { findPhase } from "./motion-phases";
import { levelLine, levelOf, studyMode } from "./motion-mode";
import { uid, type CadDoc, type MotionStudy, type ProcessOp } from "./types";

type CondSpec = { t: number } | { mate: string; op: "<=" | ">="; value: number } | { motor: string; op: "<=" | ">="; value: number } | { phase: string };
export type ProcessCmd =
  | { k: "list" }
  | { k: "add"; kind: ProcessOp["kind"]; tool: string; target: string; depth?: number; at?: CondSpec; scrap?: ProcessOp["scrap"]; name?: string }
  /** bez `ref` = všechny operace */
  | { k: "remove"; ref?: string }
  /** `pohyb úroveň` – vypíše úroveň simulace (úroveň se nevolí příkazem: „+ geometrická aproximace“ = procesní operace) */
  | { k: "level"; arg?: string };

const PROC = W("proces", "procesní", "procesni", "process", "prozess");
const CUT = W("střih", "strih", "stříhání", "strihani", "děrování", "derovani", "prostřih", "prostrih", "vystřižení", "cut", "punch", "punching", "pierce", "piercing", "shear", "blank", "schnitt", "stanzen", "lochen", "schneiden");
const IMP = W("ražení", "razeni", "otisk", "značení", "znaceni", "ražba", "razba", "imprint", "stamp", "stamping", "emboss", "coin", "coining", "marking", "mark", "prägen", "praegen", "prägung", "praegung", "markieren", "markierung");
const DEPTH = W("hloubka", "hloubku", "hloubkou", "depth", "tiefe");
const WHEN = W("při", "pri", "když", "kdyz", "jakmile", "when", "once", "if", "wenn", "sobald", "bei");
const FROM = W("od", "from", "after", "ab", "von", "nach");
const TIME = W("čase", "case", "čas", "cas", "time", "zeit");
const MATE = W("vazba", "vazbě", "vazbu", "mate", "constraint", "verknüpfung", "verknuepfung", "bedingung");
const MOTOR = W("motor", "pohon", "drive", "antrieb");
const PHASE = W("fáze", "faze", "fázi", "fazi", "fází", "fazi", "phase");
const WITH = W("s", "se", "with", "mit");
const SEC = W("s", "sec", "sek", "sekund", "seconds");
const SCRAP = W("odpad", "výstřižek", "vystrizek", "scrap", "slug", "abfall", "butzen");
const FALL = W("padá", "pada", "spadne", "fall", "falls", "drop", "fällt", "faellt", "fallen");
const TOOL = W("nástrojem", "nastrojem", "nástroj", "nastroj", "tool", "with-tool", "werkzeug", "mit-werkzeug");
const STAY = W("zůstane", "zustane", "zůstává", "zustava", "stay", "stays", "remain", "bleibt", "bleiben");
const NAME = W("název", "nazev", "jméno", "jmeno", "name", "bezeichnung");
const LIST = W("seznam", "výpis", "vypis", "stav", "list", "status", "liste");
const LEVEL = W("úroveň", "uroven", "úroveň simulace", "level", "stufe", "simulationsstufe");
const EVENT = W("událost", "udalost", "event", "ereignis");
const REMOVE = W("odeber", "odebrat", "odebere", "vystřihni", "vystrihni", "prostřihni", "prostrihni", "remove", "subtract", "cut", "entferne", "entfernen", "schneide");
const OUTOF = W("z", "ze", "from", "of", "aus", "von");
const DEL = W("smazat", "zrušit", "zrusit", "odstranit", "odebrat", "delete", "remove", "clear", "löschen", "loeschen", "entfernen");

export const PROCESS_USE = (): string =>
  tr("pohyb proces střih|ražení \"<nástroj>\" \"<obrobek>\" [hloubka H] [při vazba \"X\" <= v | při motor N <= v | od T s | fáze \"F\"] [odpad padá|s nástrojem|zůstane] [název \"…\"] · pohyb proces [seznam] · pohyb proces [N] smazat");

const OPS: Record<string, "<=" | ">="> = { "<=": "<=", "≤": "<=", "<": "<=", "=<": "<=", ">=": ">=", "≥": ">=", ">": ">=", "=>": ">=" };
function opValue(c: AsmCursor): { op: "<=" | ">="; value: number } {
  const t = c.next();
  const m = t ? /^(<=|>=|≤|≥|=<|=>|<|>)(.*)$/.exec(t.t.trim()) : null;
  if (!m) throw new Error(tr("proces: podmínka potřebuje operátor <= nebo >= a hodnotu – při vazba \"ZDVIH\" <= 1"));
  if (m[2]) {
    if (!asmIsNum(m[2])) throw new Error(tr("proces: hodnota podmínky „{0}“ není číslo", m[2]));
    c.tk.splice(c.i, 0, { t: m[2], q: false });
  }
  return { op: OPS[m[1]], value: c.num(tr("hodnota podmínky")) };
}

/**
 * `pohyb úroveň [x]` a `pohyb událost při … odeber "Nástroj" z "Obrobek"` (zápis ze zprávy majitele) – událost s odebráním
 * = procesní operace střih se začátkem podmínkou; jiná událost (fáze) → null (cad/agent-motion-phases.ts).
 */
export function parseProcessAlias(c: AsmCursor): ProcessCmd | null {
  if (c.is(LEVEL)) {
    c.i++;
    const arg = c.done ? undefined : c.tk.slice(c.i).map((t) => t.t).join(" ");
    c.i = c.tk.length;
    return { k: "level", ...(arg ? { arg } : {}) };
  }
  if (!c.is(EVENT)) return null;
  const rest = c.tk.slice(c.i + 1);
  const r = rest.findIndex((t) => !t.q && REMOVE.has(fold(t.t)));
  if (r < 0) return null;
  // „odeber A z B“ → „proces střih A B“ + podmínka události
  const tool = rest[r + 1];
  const hasFrom = rest[r + 2] && !rest[r + 2].q && OUTOF.has(fold(rest[r + 2].t));
  const target = hasFrom ? rest[r + 3] : rest[r + 2];
  if (!tool || !target) throw new Error(tr("pohyb událost … odeber \"<nástroj>\" z \"<obrobek>\" – {0}", PROCESS_USE()));
  const tail = [...rest.slice(0, r), ...rest.slice(r + (hasFrom ? 4 : 3))];
  const cc = new AsmCursor([{ t: "proces", q: false }, { t: "střih", q: false }, tool, target, ...tail]);
  c.i = c.tk.length;
  return parseProcessText(cc);
}

/** `pohyb proces …` (kurzor za slovem „pohyb“); jiný podpříkaz → null */
export function parseProcessText(c: AsmCursor): ProcessCmd | null {
  if (!c.is(PROC)) return null;
  c.i++;
  if (c.done || (c.is(LIST) && c.peek(1) === undefined)) return { k: "list" };
  if (c.is(DEL)) {
    c.i++;
    const ref = c.next()?.t.replace(/^#/, "");
    if (!c.done) throw new Error(tr("proces smazat: nečekané „{0}“ – {1}", c.peek()!.t, PROCESS_USE()));
    return { k: "remove", ...(ref ? { ref } : {}) };
  }
  if (!c.peek()!.q && /^#?\d+$/.test(c.peek()!.t) && c.is(DEL, 1)) {
    const ref = c.next()!.t.replace(/^#/, "");
    c.i++;
    return { k: "remove", ref };
  }
  const kind: ProcessOp["kind"] | null = c.is(CUT) ? "cut" : c.is(IMP) ? "imprint" : null;
  if (!kind) throw new Error(tr("proces: zadejte střih nebo ražení – {0}", PROCESS_USE()));
  c.i++;
  const names: string[] = [];
  const out: Extract<ProcessCmd, { k: "add" }> = { k: "add", kind, tool: "", target: "" };
  while (!c.done) {
    if (c.is(DEPTH)) {
      c.i++;
      out.depth = c.num(tr("hloubka [mm]"));
      if (!(out.depth > 0 && out.depth < 1e4)) throw new Error(tr("proces: hloubka musí být kladná (mm), např. hloubka 0,3"));
    } else if (c.is(WHEN)) {
      c.i++;
      if (c.is(MATE)) {
        c.i++;
        const t = c.next();
        if (!t) throw new Error(tr("proces: při vazba <N|\"název\"> <= hodnota"));
        out.at = { mate: t.t.replace(/^#/, "").trim(), ...opValue(c) };
      } else if (c.is(MOTOR)) {
        c.i++;
        const t = c.next();
        if (!t) throw new Error(tr("proces: při motor <N> <= hodnota"));
        out.at = { motor: t.t.replace(/^#/, "").trim(), ...opValue(c) };
      } else if (c.is(TIME)) {
        c.i++;
        out.at = { t: c.num(tr("čas [s]")) };
        if (c.is(SEC)) c.i++;
      } else if (c.is(PHASE)) {
        c.i++;
        out.at = { phase: c.str(tr("fáze")) };
      } else throw new Error(tr("proces: podmínka – při vazba \"X\" <= v | při motor N <= v | od T s | fáze \"F\""));
    } else if (c.is(FROM) && asmIsNum(c.peek(1)?.t ?? "")) {
      c.i++;
      out.at = { t: c.num(tr("čas [s]")) };
      if (c.is(SEC)) c.i++;
    } else if (c.is(PHASE) || (c.is(WITH) && c.is(PHASE, 1))) {
      c.i += c.is(WITH) ? 2 : 1;
      out.at = { phase: c.str(tr("fáze")) };
    } else if (c.is(SCRAP)) {
      c.i++;
      if (c.is(FALL)) out.scrap = "fall";
      else if (c.is(STAY)) out.scrap = "stay";
      else if (c.is(TOOL) || (c.is(WITH) && c.is(TOOL, 1))) {
        if (c.is(WITH)) c.i++;
        out.scrap = "tool";
      } else throw new Error(tr("proces: odpad padá | s nástrojem | zůstane"));
      c.i++;
    } else if (c.is(NAME)) {
      c.i++;
      out.name = c.str(tr("název"));
    } else {
      const t = c.next()!;
      if (!t.q && names.length >= 2) throw new Error(tr("proces: neznámá volba „{0}“ – {1}", t.t, PROCESS_USE()));
      names.push(t.t.trim());
    }
  }
  if (names.length !== 2) throw new Error(tr("proces: zadejte nástroj a obrobek – {0}", PROCESS_USE()));
  [out.tool, out.target] = names;
  if (kind === "imprint" && out.depth === undefined) throw new Error(tr("proces ražení: zadejte hloubku otisku – hloubka 0,3"));
  return out;
}

/* ───────────────────────── provedení ───────────────────────── */

export type ProcessHost = {
  /** spočítá studii dokumentu a zapíše souhrn (asm-agent-kin.ts `runLog`) */
  runLog: (doc: CadDoc) => Promise<MotionResult>;
  /** platný uložený výsledek pro dokument (bez výpočtu) */
  cached: (doc: CadDoc) => MotionResult | null;
  log: string[];
};

/** seznam operací studie */
export function processListLines(doc: CadDoc): string[] {
  const ops = doc.motion?.process ?? [];
  if (!ops.length) return [tr("Procesní vrstva: žádné operace – pohyb proces střih \"Razník\" \"Plech\"")];
  return [tr("Procesní operace: {0}", ops.length), ...ops.map((op, i) => `  ${opText(op, i, doc)}`)];
}

/** Provede `pohyb proces …`: upraví studii (a je-li motor, spočítá ji); výpis z uloženého výsledku. */
export async function applyProcessCmd(d: CadDoc, cmd: ProcessCmd, study: MotionStudy, h: ProcessHost): Promise<{ doc: CadDoc; changed: boolean; open?: boolean }> {
  const log = h.log;
  const canRun = (s: MotionStudy) => s.motors.length > 0 || s.mode === "dynamic";
  if (cmd.k === "level") {
    // úroveň plyne z režimu studie a z procesní vrstvy – nevolí se příkazem (žádné tiché „ok“ k neexistující volbě)
    if (cmd.arg) throw new Error(tr("pohyb úroveň: úroveň se nevolí – kinematika / kvazistatika / dynamika = pohyb kinematika | kvazistatika | dynamika; „+ geometrická aproximace“ = procesní operace (pohyb proces střih …); „{0}“ není volba", cmd.arg));
    const res = h.cached(d);
    log.push(levelLine(res?.level ?? levelOf(studyMode(d, d.motion))) + (d.motion?.process?.length && !res ? tr(" + geometrická aproximace (procesní operace – spočítá se s pohybem)") : ""));
    if (d.motion?.process?.length) log.push(processLevelSentence());
    return { doc: d, changed: false };
  }
  if (cmd.k === "list") {
    log.push(...processListLines(d));
    if (d.motion?.process?.length) {
      const res = h.cached(d);
      if (res) log.push(...processLines(res, d));
      else if (canRun(d.motion)) log.push(tr(" výsledek pro nynější stav sestavy není spočítán – pohyb spustit"));
    }
    return { doc: d, changed: false };
  }
  const list = [...(study.process ?? [])];
  if (cmd.k === "remove") {
    if (!list.length) throw new Error(tr("proces: studie nemá procesní operace"));
    if (cmd.ref === undefined) {
      delete study.process;
      log.push(tr("✓ procesní operace smazány: {0}", list.length));
    } else {
      const i = /^\d+$/.test(cmd.ref) ? Number(cmd.ref) - 1 : list.findIndex((o) => o.name?.toLowerCase() === cmd.ref!.toLowerCase());
      if (!(i >= 0 && i < list.length)) throw new Error(tr("proces: operace „{0}“ ve studii není – operací: {1}", cmd.ref, list.length));
      const [gone] = list.splice(i, 1);
      if (list.length) study.process = list;
      else delete study.process;
      log.push(tr("✓ procesní operace smazána: {0}", opText(gone, i, d)));
    }
    const doc = { ...d, motion: study };
    if (canRun(study)) await h.runLog(doc);
    return { doc, changed: true, open: true };
  }
  const tool = findComp(d, cmd.tool);
  const target = findComp(d, cmd.target);
  if (tool.id === target.id) throw new Error(tr("proces: nástroj a obrobek musí být různé komponenty – „{0}“", tool.name));
  if (target.source.kind === "asm") throw new Error(tr("procesní operace: obrobek „{0}“ musí být díl, ne podsestava", target.name));
  if (tool.source.kind === "asm") throw new Error(tr("procesní operace: nástroj „{0}“ musí být díl, ne podsestava", tool.name));
  let at: ProcessOp["at"];
  const c = cmd.at;
  if (c) {
    if ("phase" in c) at = { phase: findPhase(study, c.phase).ph.id };
    else if ("t" in c) at = { t: c.t };
    else if ("mate" in c) at = { mate: findMate(d, c.mate).id, op: c.op, value: c.value };
    else {
      const mo = study.motors[Number(c.motor) - 1];
      if (!mo) throw new Error(tr("motor {0} ve studii není – motorů: {1}", c.motor, study.motors.length));
      at = { motor: mo.id, op: c.op, value: c.value };
    }
  }
  const op: ProcessOp = { id: uid(), kind: cmd.kind, tool: tool.id, target: target.id, ...(cmd.depth !== undefined ? { depth: cmd.depth } : {}), ...(at ? { at } : {}), ...(cmd.scrap ? { scrap: cmd.scrap } : {}), ...(cmd.name ? { name: cmd.name } : {}) };
  const p = condProblem(op, study);
  if (p) throw new Error(tr("proces: {0}", p));
  list.push(op);
  study.process = list;
  const doc = { ...d, motion: study };
  log.push(tr("ℹ procesní operace {0}", opText(op, list.length - 1, doc)));
  if (canRun(study)) await h.runLog(doc);
  else log.push(processLevelSentence(), tr(" studie zatím nemá motor – operace se spočítá s pohybem (pohyb motor …)"));
  return { doc, changed: true, open: true };
}

/** řádky stavu výrobku pro `pohyb krok N` (re-export) */
export { productLines };

/* ───────────────────────── skript dokumentu ───────────────────────── */

const SW = {
  motion: ["pohyb", "motion", "bewegung"],
  proc: ["proces", "process", "prozess"],
  cut: ["střih", "cut", "schnitt"],
  imp: ["ražení", "imprint", "prägen"],
  depth: ["hloubka", "depth", "tiefe"],
  when: ["při", "when", "wenn"],
  mate: ["vazba", "mate", "verknüpfung"],
  motor: ["motor", "motor", "antrieb"],
  from: ["od", "from", "ab"],
  phase: ["fáze", "phase", "phase"],
  scrap: ["odpad", "scrap", "abfall"],
  fall: ["padá", "fall", "fällt"],
  tool: ["s nástrojem", "tool", "werkzeug"],
  stay: ["zůstane", "stay", "bleibt"],
  name: ["název", "name", "name"],
} as const;
const num = (v: number) => String(Math.round(v * 1e6) / 1e6);
const q = (s: string) => `"${s.replace(/"/g, "'")}"`;

/**
 * Řádky skriptu dokumentu (doc-script.ts): `pohyb proces střih #3 #2 při vazba 2 <= 1 odpad padá`. Komponenty pořadím (`ref`),
 * vazby pořadím; operace s komponentou mimo skript se vynechá (`skipped`).
 */
export function processScript(doc: CadDoc, li: 0 | 1 | 2, ref: (id: string) => string | null, mateRef?: (id: string) => number | undefined): { lines: string[]; skipped: number } {
  const ops = doc.motion?.process ?? [];
  const w = (k: keyof typeof SW) => SW[k][li];
  const lines: string[] = [];
  let skipped = 0;
  for (const op of ops) {
    const a = ref(op.tool);
    const b = ref(op.target);
    if (!a || !b) {
      skipped++;
      continue;
    }
    const parts = [w("motion"), w("proc"), op.kind === "cut" ? w("cut") : w("imp"), a, b];
    if (op.depth !== undefined) parts.push(w("depth"), num(op.depth));
    const c = op.at;
    if (c) {
      if ("phase" in c) {
        const ph = doc.motion?.phases?.find((x) => x.id === c.phase);
        if (ph) parts.push(w("phase"), q(ph.name));
      } else if ("t" in c) parts.push(w("from"), num(c.t), "s");
      else if ("mate" in c) {
        const no = mateRef ? mateRef(c.mate) : (doc.mates ?? []).findIndex((m) => m.id === c.mate) + 1;
        if (no) parts.push(w("when"), w("mate"), String(no), c.op, num(c.value));
      } else {
        const i = (doc.motion?.motors ?? []).findIndex((m) => m.id === c.motor);
        if (i >= 0) parts.push(w("when"), w("motor"), String(i + 1), c.op, num(c.value));
      }
    }
    if (op.scrap) parts.push(w("scrap"), op.scrap === "fall" ? w("fall") : op.scrap === "tool" ? w("tool") : w("stay"));
    if (op.name) parts.push(w("name"), q(op.name));
    lines.push(parts.join(" "));
  }
  return { lines, skipped };
}
