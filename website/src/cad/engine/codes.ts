/**
 * Registr kódů hlášek protokolu (CAD-HEADLESS-NAVRH.md kap. 4.3 a 5.2).
 *
 * Kód je stabilní ASCII identifikátor `[a-z0-9]+([.-][a-z0-9]+)*`, stejný v cs/en/de – agent podle něj třídí, přísný
 * režim podle něj vynechává (`přísně kromě kód,…`). `level` je výchozí úroveň (✗ error, ⚠ warn, ℹ note); `key` je český
 * zdroj volného textu pro `tr()` (překlady v `scripts/i18n/{en,de}/21-protocol-ports.tsv` za řádkem `#!dynamic`, protože
 * se překládají přes `tr(def.key)`, ne literálem).
 *
 * Nový kód = nový řádek zde + řádky EN/DE v TSV; test `codes.test.ts` hlídá tvar, jedinečnost a překlady.
 */
import { tr } from "../i18n";
import type { Entry } from "./protocol-types";

export type CodeLevel = "error" | "warn" | "note";
export type CodeDef = { code: string; level: CodeLevel; key: string };

/** tvar kódu – shodně s gramatikou protokolu (kap. 4.2) */
export const CODE_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

export const CODES = [
  // ── běh a hostitel (kap. 3.1, 2.1) ──
  { code: "run.timeout", level: "error", key: "časový limit {0} s vypršel" },
  { code: "run.memory", level: "error", key: "překročen limit paměti {0} MB" },
  { code: "run.crash", level: "error", key: "výpočet spadl: {0}" },
  { code: "run.interrupted", level: "error", key: "běh přerušen" },
  { code: "run.cancelled", level: "error", key: "výpočet zrušen – dokument zůstal beze změny" },
  { code: "host.app-only", level: "error", key: "příkaz funguje jen v aplikaci v prohlížeči: {0}" },
  { code: "host.fonts", level: "error", key: "písma pro PDF a text modelu nejsou k dispozici" },
  { code: "ui.no-view", level: "note", key: "bez 3D okna nemá příkaz účinek: {0}" },
  { code: "session.history", level: "note", key: "historie zpět/znovu se v relaci neukládá" },
  { code: "file.missing", level: "error", key: "soubor „{0}“ není k dispozici – dostupné: {1}" },
  { code: "out.path", level: "error", key: "název souboru „{0}“ míří mimo výstupní složku" },
  { code: "out.renamed", level: "note", key: "soubor „{0}“ už existuje – uloženo jako „{1}“" },
  { code: "out.empty", level: "warn", key: "prázdný dokument – nezapsáno: {0}" },
  { code: "share.rejected", level: "error", key: "úložiště odkazů odmítlo zápis: {0}" },
  { code: "share.fallback-link", level: "warn", key: "krátký odkaz se nepodařil – použit dlouhý odkaz" },
  { code: "share.uncompressed", level: "note", key: "odkaz není komprimovaný (prostředí neumí deflate-raw)" },
  // ── rozbor (5.2 č. 1–4, 6, 9, 10) ──
  { code: "parse.error", level: "error", key: "chyba zápisu: {0}" },
  { code: "parse.unknown", level: "error", key: "neznámý příkaz „{0}“" },
  { code: "parse.unused", level: "warn", key: "nevyužitá slova: {0}" },
  { code: "parse.coord-missing", level: "warn", key: "chybějící souřadnice doplněna nulou: {0}" },
  { code: "parse.axis", level: "error", key: "neznámá osa „{0}“" },
  { code: "parse.conflict", level: "warn", key: "odporující si volby – použito „{0}“, zahozeno „{1}“" },
  // ── provedení a stavba (5.2 č. 15–17, 21, 22, 24–28) ──
  { code: "op.failed", level: "error", key: "příkaz selhal: {0}" },
  { code: "build.failed", level: "error", key: "stavba selhala: {0}" },
  { code: "feature.failed", level: "error", key: "prvek „{0}“ se nepostavil: {1}" },
  { code: "feature.warning", level: "warn", key: "prvek „{0}“: {1}" },
  { code: "geom.approx", level: "note", key: "objem a hmotnost jsou přibližné (ze sítě)" },
  { code: "geom.volume-failed", level: "warn", key: "objem se nepodařilo změřit – uvedena 0" },
  { code: "param.clamped", level: "warn", key: "hodnota {0} upravena na {1} ({2})" },
  { code: "mode.new-body", level: "note", key: "přidání bez tělesa – vytvořeno nové těleso" },
  { code: "json.id-renewed", level: "note", key: "duplicitní id prvku „{0}“ nahrazeno novým" },
  { code: "name.renamed", level: "warn", key: "název „{0}“ je obsazený – použit „{1}“" },
  { code: "name.renamed-auto", level: "note", key: "výchozí název očíslován: „{0}“" },
  { code: "tab.empty-replaced", level: "warn", key: "prázdná záložka „{0}“ nahrazena dokumentem „{1}“" },
  { code: "tab.settle-timeout", level: "error", key: "přepnutí záložky nedoběhlo do {0} s" },
  // ── díry a výběr (5.2 č. 5, 7, 8, 12, 13, 18, 38) ──
  { code: "hole.depth-default", level: "warn", key: "díra bez hloubky – vrtá se skrz" },
  { code: "hole.conflict", level: "warn", key: "zahloubení a kuželové zahloubení zároveň – použito {0}" },
  { code: "hole.cbore-dropped", level: "warn", key: "zahloubení Ø{0} je menší než závit {1}" },
  { code: "hole.no-surface", level: "warn", key: "díra neleží na povrchu – umístěna na obálku tělesa" },
  { code: "hole.tap-diameter", level: "warn", key: "zadaný průměr {0} nahrazen průměrem vrtáku {1} pro závit {2}" },
  { code: "select.fallback", level: "warn", key: "plocha podle pravidla nenalezena – použita nejkrajnější" },
  { code: "select.ambiguous", level: "warn", key: "více vyhovujících ploch – použita první" },
  { code: "insert.name-ignored", level: "warn", key: "název instance „{0}“ se zatím neukládá" },
  // ── sestava, kolize, pohyb (5.2 č. 11, 19, 20, 29, 30, 40; kap. 6.3, 7, 9.2) ──
  { code: "asm.stale-copy", level: "warn", key: "komponenta je kopie dílu – pozdější změny dílu se nepromítnou" },
  { code: "asm.depth", level: "warn", key: "podsestavy hlubší než {0} úrovní se vynechají" },
  { code: "asm.faces-truncated", level: "warn", key: "díl „{0}“ má víc než {1} ploch – načteno jen prvních {1}" },
  { code: "asm.kernel-restarted", level: "note", key: "jádro se restartovalo – mezipaměti sestavy vyprázdněny" },
  { code: "asm.face-missing", level: "error", key: "plocha F{0} dílu „{1}“ není k dispozici" },
  { code: "asm.instance-duplicate", level: "warn", key: "instance „{0}“ už v sestavě je" },
  { code: "clash.real", level: "warn", key: "kolize „{0}“ × „{1}“ ({2} mm³)" },
  { code: "clash.thread", level: "note", key: "šroub v závitu „{0}“ × „{1}“" },
  { code: "clash.underhead", level: "note", key: "prstenec pod hlavou šroubu „{0}“ × „{1}“" },
  { code: "clash.undetermined", level: "warn", key: "kolizi „{0}“ × „{1}“ nelze vyhodnotit" },
  { code: "clash.hidden", level: "note", key: "skryté komponenty se nekontrolují ({0})" },
  { code: "motion.conflict", level: "warn", key: "pohyb porušuje vazbu „{0}“ v kroku {1}" },
  // ── měření, kontrola, porovnání, materiál (5.2 č. 31, 37; kap. 6) ──
  { code: "measure.truncated", level: "note", key: "vypsáno {0} z {1}" },
  { code: "check.hole-missing", level: "warn", key: "prvek díry „{0}“ nemá v geometrii díru" },
  { code: "compare.mismatch", level: "warn", key: "model se od reference liší: {0}" },
  { code: "material.density-assumed", level: "warn", key: "materiál „{0}“ zadán jen označením – hustota {1} g/cm³ ({2})" },
  { code: "material.class", level: "note", key: "materiál „{0}“ zařazen jako {1}" },
  // ── výkresy a předloha (5.2 č. 32, 33; kap. 8) ──
  { code: "drawing.warning", level: "warn", key: "list {0}: {1}" },
  { code: "drawing.section-miss", level: "warn", key: "rovina řezu neprotíná těleso: {0}" },
  { code: "drawing.overlap", level: "warn", key: "překryv na listu {0}: {1}" },
  { code: "drawing.tolerance-missing", level: "warn", key: "kóta {0} nemá toleranci" },
  { code: "reference.mismatch", level: "warn", key: "předloha se liší: {0}" },
  // ── náhradní kódy pro hlášky bez vlastního kódu (do přiřazení v balíku B4) ──
  { code: "msg.error", level: "error", key: "chyba: {0}" },
  { code: "msg.warn", level: "warn", key: "varování: {0}" },
  { code: "msg.note", level: "note", key: "poznámka: {0}" },
] as const satisfies readonly CodeDef[];

export type Code = (typeof CODES)[number]["code"];

const BY_CODE = new Map<string, CodeDef>(CODES.map((c) => [c.code, c]));

/** definice kódu (undefined = kód není v registru) */
export const codeDef = (code: string): CodeDef | undefined => BY_CODE.get(code);
export const isCode = (code: string): code is Code => BY_CODE.has(code);

/** náhradní kód pro záznam úrovně bez vlastního kódu (protokol vyžaduje kód u každého ✗/⚠/ℹ) */
export const fallbackCode = (level: CodeLevel): Code => (level === "error" ? "msg.error" : level === "warn" ? "msg.warn" : "msg.note");

/** lokalizovaný text kódu v aktuálním jazyce (`setLang`) */
export function codeText(code: Code, ...args: unknown[]): string {
  return tr(BY_CODE.get(code)!.key, ...args);
}

export type CodeEntryInit = {
  line?: number | null;
  doc?: string;
  /** argumenty `{0}`, `{1}`… textu kódu */
  args?: unknown[];
  /** vlastní volný text místo textu kódu (už lokalizovaný) */
  text?: string;
  /** jiná úroveň než výchozí (např. `porovnat … přísně` → ✗) */
  level?: CodeLevel;
  data?: unknown;
};

/** Záznam protokolu s kódem z registru: úroveň z registru (nebo `level`), text `tr(key, …args)` v aktuálním jazyce. */
export function codeEntry(code: Code, o: CodeEntryInit = {}): Entry {
  const def = BY_CODE.get(code)!;
  const e: Entry = { line: o.line ?? null, level: o.level ?? def.level, code, text: o.text ?? tr(def.key, ...(o.args ?? [])) };
  if (o.doc !== undefined) e.doc = o.doc;
  if (o.data !== undefined) e.data = o.data;
  return e;
}
