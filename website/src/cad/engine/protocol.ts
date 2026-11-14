/**
 * Protokol běhu (CAD-HEADLESS-NAVRH.md kap. 4): stručný protokol s jedním tvrdým rozpočtem v bajtech UTF-8, plný protokol
 * a JSON. Gramatika je strojově čitelná a stejná v cs/en/de – lokalizovaný je jen volný text za kódem (a za názvem
 * dokumentu). Čísla jsou s tečkou a bez seskupení (`toFixed`, nezávislé na `Intl` a jazyku), data ISO, názvy v uvozovkách.
 *
 * ```
 * MNCAD/1 <OK|FAIL|STOP> lines=<n> ops=<n> err=<n> warn=<n> note=<n> t=<s>
 * ✗ <loc>[ ×<k>] <kód>[ <text>]                         (bez dokumentu; ⚠, ℹ stejně; ℹ jen s volbou notes)
 * ✗ <loc>[ ×<k>] <kód> "<dokument>"[: <text>]           (s dokumentem – přesný název je i v JSON `doc`)
 * = <loc> <druh> ["<dokument>" ]<klíč=hodnota …>          (víceřádkový výpis: další řádky odsazené 2 mezerami)
 * D "<dokument>" <part|asm|draft> <klíč=hodnota …>
 * F <formát> "<soubor>" <bajty>B[ <klíč=hodnota …>]
 * O <url> exp=<YYYY-MM-DD|none> mode=<store|self|link>
 * … <n> entries <bajty>B in protocol-full.txt
 * Σ <klíč=hodnota …>
 * <loc> := L- | L<n> | L<n>,L<n>… | L<n>-L<n>
 * ```
 *
 * Uvozovky hned za kódem (druhem) jsou vždy název dokumentu: volný text bez dokumentu, který by uvozovkou začínal, dostane
 * na začátek `\`. Druh `=` má tvar kódu (`measure`, `clash`, `compare-2d`). Konce řádků všech druhů (i U+2028/U+2029/NEL)
 * a řídicí znaky jsou v textech a názvech nahrazené mezerou – každý řádek projde právě jedním regexem `GRAMMAR`.
 *
 * Priorita zařazení do rozpočtu: hlavička + Σ vždy > ✗ > ⚠ > F/O > jednořádkové `=` > D (hlavní dokument a dokumenty
 * s ✗/⚠) > víceřádkové výpisy > ℹ (jen `notes`). Pořadí tisku: hlavička, ✗, ⚠, ℹ, =, D, F, O, značka přebytku, Σ.
 * Zařazuje se hladově v pořadí priority (v rámci priority v pořadí tisku): záznam se vypíše, když se vejde i se značkou
 * přebytku za všechno, co zatím vypsané není; jinak se přeskočí a zkouší se další. Proto (a) se nikdy nevypíše záznam
 * nižší priority místo záznamu vyšší priority, který by se po jeho vynechání vešel, a (b) žádný vynechaný záznam by se do
 * zbylého místa nevešel. Vynechané záznamy jsou v `protocol-full.txt`.
 *
 * Slučují se jen opravdu stejné hlášky (úroveň, kód, dokument, text a data; s řádkem / bez řádku zvlášť), takže se nic
 * neztratí: dvě různé kolize, dva různé neznámé příkazy nebo `L-` a `L5` zůstanou samostatnými řádky.
 */
import type { CadLang } from "../i18n";
import { CODE_RE, codeEntry, fallbackCode, type Code, type CodeEntryInit } from "./codes";
import type { DocSummary, Entry, Level, OpTiming, OutFile, Overflow, RunReport, ShareInfo } from "./protocol-types";

export const PROTOCOL_HEAD = "MNCAD/1";
export const OVERFLOW_FILE = "protocol-full.txt";
/** výchozí tvrdý rozpočet stručného protokolu (bajty UTF-8 včetně konců řádků) */
export const DEFAULT_BUDGET = 2048;
/** nejdelší volný text ve stručném protokolu (znaky); celý je v JSON a v plném protokolu */
export const TEXT_MAX = 160;
/** nejvíc jednotlivých čísel řádků v `<loc>`; víc → rozsah `L<první>-L<poslední>` */
export const LOC_LIST_MAX = 6;

/** Regulární výrazy gramatiky (kap. 4.2) – každý řádek stručného protokolu projde právě jedním z nich. */
export const GRAMMAR = {
  header: /^MNCAD\/1 (OK|FAIL|STOP) lines=\d+ ops=\d+ err=\d+ warn=\d+ note=\d+ t=\d+(\.\d+)?$/,
  msg: /^(✗|⚠|ℹ) (L-|L\d+-L\d+|L\d+(?:,L\d+)*)(?: ×(\d+))? ([a-z0-9]+(?:[.-][a-z0-9]+)*)(?: (.*))?$/,
  measure: /^= (L-|L\d+) ([a-z0-9]+(?:[.-][a-z0-9]+)*) (.*)$/,
  cont: /^ {2}\S/,
  doc: /^D "((?:[^"\\]|\\.)*)" (part|asm|draft) (.*)$/,
  file: /^F ([a-z0-9]+) "((?:[^"\\]|\\.)*)" (\d+)B(?: (.*))?$/,
  link: /^O (\S+) exp=(\d{4}-\d{2}-\d{2}|none) mode=(store|self|link)$/,
  overflow: /^… \d+ entries \d+B in protocol-full\.txt$/,
  sum: /^Σ (.*)$/,
} as const;
export type GrammarKind = keyof typeof GRAMMAR;
/** druh řádku podle gramatiky (null = řádek gramatice neodpovídá) */
export function grammarKind(line: string): GrammarKind | null {
  for (const k of Object.keys(GRAMMAR) as GrammarKind[]) if (GRAMMAR[k].test(line)) return k;
  return null;
}

const SYM: Record<Level, string> = { ok: "✓", note: "ℹ", warn: "⚠", error: "✗", measure: "=" };

/* ───────────────────────── základní formáty ───────────────────────── */

/** délka řetězce v bajtech UTF-8 (bez TextEncoderu – stejně v prohlížeči i v Node) */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/**
 * Číslo pro protokol: tečka, bez seskupení, nejvýš `d` desetinných míst, bez koncových nul; nekonečno / NaN / chybějící → `-`.
 * `toFixed` nezávisí na jazyku ani na výchozím `Intl` (cs-CZ by dal „5 241,73“ s U+00A0).
 */
export function fmtNum(v: number | null | undefined, d = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  let s = v.toFixed(Math.max(0, Math.min(10, Math.trunc(d))));
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

/**
 * Znaky, které by rozdělily řádek nebo ovlivnily terminál: řídicí znaky C0 (i `\r`, `\n`, `\t`, `\v`, `\f`), DEL, C1
 * (i NEL U+0085) a oddělovače řádků/odstavců U+2028/U+2029 (JS `.` je nepokryje, Python `splitlines` na nich dělí).
 */
const BREAK_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;

/** název v uvozovkách: `\` → `\\`, `"` → `\"`, konce řádků a řídicí znaky → mezera */
export function quote(s: string): string {
  return `"${String(s ?? "").replace(BREAK_RE, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** volný text na jeden řádek (konce řádků a řídicí znaky → mezera, okraje oříznuté) */
function oneLine(s: unknown): string {
  return String(s ?? "")
    .replace(/\s*[\u0000-\u001f\u007f-\u009f\u2028\u2029]+\s*/g, " ")
    .trim();
}
/** zkrácení na `max` znaků (kódových bodů) se „…“ */
function clip(t: string, max: number): string {
  if (t.length <= max) return t;
  const cps = [...t];
  return cps.length > max ? cps.slice(0, max - 1).join("") + "…" : t;
}
/** text, který stojí hned za kódem (druhem) bez dokumentu, nesmí začínat uvozovkou – ta uvozuje vždy název dokumentu */
const unquoted = (t: string) => (t.startsWith('"') ? `\\${t}` : t);

/**
 * Druh výpisu `=` (tvar kódu `[a-z0-9]+([.-][a-z0-9]+)*`): platný se ponechá (`compare-2d`), jiný se převede bez ztráty
 * smyslu (malá písmena, bez diakritiky, ostatní znaky → `-`: `Bad.Kind` → `bad.kind`, `měření` → `mereni`); prázdný → `value`.
 */
export function measureKind(code: string | undefined): string {
  if (code && CODE_RE.test(code)) return code;
  const t = String(code ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/[.-]*([.-])[.-]*/g, "$1")
    .replace(/^[.-]+|[.-]+$/g, "");
  return t && CODE_RE.test(t) ? t : "value";
}

/** ASCII token (formát souboru, druh výpisu, název operace) – jen [a-z0-9] */
const token = (s: string | undefined, fallback: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "") || fallback;

/** ISO datum YYYY-MM-DD (z ISO řetězce, data nebo časového razítka); jinak null */
export function isoDate(v: string | number | Date | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const t = v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/** řádky záznamu (sloučené `lines`, jinak `line`) – jen čísla, seřazená a bez opakování */
export function entryLines(e: Pick<Entry, "line" | "lines">): number[] {
  const src = e.lines?.length ? e.lines : [e.line];
  return [...new Set(src.filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0).map((x) => Math.trunc(x)))].sort((a, b) => a - b);
}

/** `<loc>`: `L-`, `L12`, `L120,L131,L142` nebo (víc než 6 řádků) `L120-L612`; `full` = vždy úplný výčet (plný protokol) */
export function locOf(lines: readonly number[], full = false): string {
  if (!lines.length) return "L-";
  if (lines.length === 1) return `L${lines[0]}`;
  if (lines.length > LOC_LIST_MAX && !full) return `L${lines[0]}-L${lines[lines.length - 1]}`;
  return lines.map((x) => `L${x}`).join(",");
}

/* ───────────────────────── slučování záznamů ───────────────────────── */

/** klíč dat záznamu pro slučování: `""` bez dat, JSON s daty; `null` = data nejdou porovnat → záznam se neslučuje */
function dataKey(d: unknown): string | null {
  if (d === undefined) return "";
  try {
    const s = JSON.stringify(d);
    return s === undefined ? null : `j${s}`;
  } catch {
    return null;
  }
}

/** klíč slučování (null = neslučovat): ✗/⚠/ℹ s kódem, stejný dokument, text a data; záznamy bez řádku (`L-`) zvlášť */
function mergeKey(e: Entry): string | null {
  if ((e.level !== "error" && e.level !== "warn" && e.level !== "note") || !e.code) return null;
  const dk = dataKey(e.data);
  if (dk === null) return null;
  return [e.level, e.code, e.doc ?? "", entryLines(e).length ? "L" : "-", e.text ?? "", dk].join("\u0000");
}

/**
 * Stejné záznamy sloučí do jednoho: stejná úroveň, kód, dokument, text i data, a buď všechny s řádkem, nebo všechny bez
 * řádku (`L-`). `lines` = všechny řádky (seřazené, bez opakování), `line` = první z nich, `count` = počet výskytů. Hlášky,
 * které se liší textem nebo daty (dvě různé kolize, dva neznámé příkazy), zůstanou samostatné – nic se neztratí.
 * Pořadí podle prvního výskytu; lineární čas; idempotentní (sloučené záznamy se slučují dál).
 */
export function mergeEntries(entries: readonly Entry[]): Entry[] {
  type Group = { first: Entry; lines: number[]; count: number; merged: boolean };
  const out: (Entry | Group)[] = [];
  const groups = new Set<Group>();
  const at = new Map<string, Group>();
  for (const e of entries) {
    const key = mergeKey(e);
    if (key === null) {
      out.push(e);
      continue;
    }
    const g = at.get(key);
    if (!g) {
      const ng: Group = { first: e, lines: entryLines(e), count: e.count ?? 1, merged: false };
      at.set(key, ng);
      groups.add(ng);
      out.push(ng);
      continue;
    }
    for (const l of entryLines(e)) g.lines.push(l);
    g.count += e.count ?? 1;
    g.merged = true;
  }
  return out.map((x) => {
    if (!groups.has(x as Group)) return x as Entry;
    const g = x as Group;
    if (!g.merged) return g.first;
    const lines = [...new Set(g.lines)].sort((a, b) => a - b);
    const { lines: _old, ...first } = g.first;
    void _old;
    return { ...first, line: lines[0] ?? null, ...(lines.length ? { lines } : {}), count: g.count };
  });
}

/* ───────────────────────── řádky protokolu ───────────────────────── */

/** řádek hlášky ✗/⚠/ℹ (a ✓ v plném protokolu) */
function msgLine(e: Entry, full: boolean): string {
  const lines = entryLines(e);
  const k = e.count ?? 1;
  const head = `${SYM[e.level]} ${locOf(lines, full)}${k > 1 ? ` ×${k}` : ""}`;
  const flat = oneLine(e.text);
  if (e.level === "ok") return flat ? `${head} ${full ? flat : clip(flat, TEXT_MAX)}` : head;
  const code = e.code && CODE_RE.test(e.code) ? e.code : fallbackCode(e.level === "error" ? "error" : e.level === "warn" ? "warn" : "note");
  const doc = e.doc !== undefined && e.doc !== "" ? ` ${quote(e.doc)}` : "";
  const t = doc ? flat : unquoted(flat);
  const text = full ? t : clip(t, TEXT_MAX);
  if (!text) return `${head} ${code}${doc}`;
  return doc ? `${head} ${code}${doc}: ${text}` : `${head} ${code} ${text}`;
}

/** řádek(y) vyžádané hodnoty `=`: druh = kód záznamu (`measureKind`), strojová část = text; další řádky textu = výpis */
function measureText(e: Entry): string {
  const lines = entryLines(e);
  const loc = lines.length ? `L${lines[0]}` : "L-";
  const rows = String(e.text ?? "").split(/\r\n|[\n\r\u2028\u2029]/);
  const first = oneLine(rows[0] ?? "");
  const hasDoc = e.doc !== undefined && e.doc !== "";
  const payload = (hasDoc ? [quote(e.doc!), first].filter(Boolean).join(" ") : unquoted(first)) || "-";
  const cont = rows
    .slice(1)
    .map((r) => oneLine(r))
    .filter(Boolean)
    .map((r) => `  ${r}`);
  return [`= ${loc} ${measureKind(e.code)} ${payload}`, ...cont].join("\n");
}

const volCm3 = (mm3: number | undefined) => (mm3 === undefined || !Number.isFinite(mm3) ? "-" : `${fmtNum(mm3 / 1000, 2)}cm3`);
function bboxSize(b: DocSummary["bbox"]): string {
  if (!b || b.length !== 2) return "-";
  const s = [0, 1, 2].map((i) => b[1][i] - b[0][i]);
  return s.every((x) => Number.isFinite(x)) ? s.map((x) => fmtNum(x, 2)).join("x") : "-";
}
function matesStr(m: NonNullable<DocSummary["mates"]>): string {
  const extra = (["conflict", "missing", "suppressed"] as const).filter((k) => m[k] > 0).map((k) => `${k}=${m[k]}`);
  return `${m.ok}/${m.total}${extra.length ? `(${extra.join(",")})` : ""}`;
}
const clashD = (c: NonNullable<DocSummary["clashes"]>) => `${c.total}(thread=${c.thread},real=${c.real}${c.undetermined ? `,undetermined=${c.undetermined}` : ""})`;
const clashSigma = (c: NonNullable<DocSummary["clashes"]>) => `thread:${c.thread},real:${c.real}${c.undetermined ? `,undetermined:${c.undetermined}` : ""}`;

/** řádek `D` souhrnu dokumentu */
export function docLine(d: DocSummary): string {
  const kind = d.kind === "assembly" ? "asm" : d.kind === "draft" ? "draft" : "part";
  const kv: string[] = [];
  if (d.kind === "assembly") {
    if (d.components !== undefined) kv.push(`comp=${d.components}`);
    if (d.parts !== undefined) kv.push(`parts=${d.parts}`);
    if (d.mates) kv.push(`mates=${matesStr(d.mates)}`);
    kv.push(`V.sum=${volCm3(d.volume_mm3)}`);
    if (d.volume_union_mm3 !== undefined) kv.push(`V.union=${volCm3(d.volume_union_mm3)}`);
    if (d.mass_kg !== undefined) kv.push(`m=${fmtNum(d.mass_kg, 2)}kg`);
    if (d.clashes) kv.push(`clash=${clashD(d.clashes)}`);
  } else if (d.kind === "part") {
    if (d.features) kv.push(`feat=${d.features.ok}/${d.features.warn}/${d.features.error}`);
    kv.push(`V=${volCm3(d.volume_mm3)}`);
    if (d.mass_kg !== undefined) kv.push(`m=${fmtNum(d.mass_kg, 3)}kg`);
    kv.push(`bbox=${bboxSize(d.bbox)}`);
  } else if (d.features) kv.push(`feat=${d.features.ok}/${d.features.warn}/${d.features.error}`);
  if (d.densityAssumed) kv.push(`rho=${fmtNum(d.density, 3)}`, "rho.assumed=1");
  if (d.exact === false) kv.push("exact=0");
  if (d.sheets) kv.push(`sheets=${d.sheets}`);
  return `D ${quote(d.name)} ${kind} ${kv.join(" ") || "-"}`;
}

/** řádek `F` zapsaného souboru */
export function fileLine(f: OutFile): string {
  const kv: string[] = [];
  if (f.sheets) kv.push(`sheets=${f.sheets}`);
  if (f.check) kv.push(`check=${f.check.ok ? "ok" : "fail"}`);
  if (f.run === "fail") kv.push("run=fail");
  const bytes = Number.isFinite(f.bytes) ? Math.max(0, Math.round(f.bytes)) : 0;
  return `F ${token(f.format, "bin")} ${quote(f.name)} ${bytes}B${kv.length ? " " + kv.join(" ") : ""}`;
}

const shareMode = (s: ShareInfo) => (s.mode === "store" || s.mode === "self" || s.mode === "link" ? s.mode : "link");

/** řádek `O` sdíleného odkazu */
export function linkLine(s: ShareInfo): string {
  const url = String(s.url ?? "").replace(/[\s\u0000-\u001f\u007f-\u009f]/g, (c) => encodeURIComponent(c)) || "-";
  return `O ${url} exp=${isoDate(s.exp) ?? "none"} mode=${shareMode(s)}`;
}

/** hlavní dokument: označený `main`, jinak poslední sestava, jinak poslední dokument */
export function mainDoc(r: Pick<RunReport, "docs">): DocSummary | undefined {
  return r.docs.find((d) => d.main) ?? [...r.docs].reverse().find((d) => d.kind === "assembly") ?? r.docs[r.docs.length - 1];
}

/** stav běhu v hlavičce */
export const runStatus = (r: Pick<RunReport, "stopped" | "ok" | "counts">): "OK" | "FAIL" | "STOP" => (r.stopped ? "STOP" : r.ok && r.counts.errors === 0 ? "OK" : "FAIL");

const nat = (v: number) => (Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0);
/** sekundy pro `t=` (NaN / nekonečno / záporné → 0, aby hlavička vždy prošla gramatikou) */
const secs = (ms: number) => fmtNum(Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0, 1);

/** hlavička `MNCAD/1 …` */
export function headerLine(r: RunReport): string {
  const c = r.counts;
  return `${PROTOCOL_HEAD} ${runStatus(r)} lines=${nat(c.lines)} ops=${nat(c.ops)} err=${nat(c.errors)} warn=${nat(c.warnings)} note=${nat(c.notes)} t=${secs(r.ms)}`;
}

/** souhrnný řádek `Σ` (vždy v protokolu, omezená délka) */
export function sigmaLine(r: RunReport): string {
  const kv = [`docs=${r.docs.length}`];
  const m = mainDoc(r);
  if (m?.kind === "assembly") {
    if (m.components !== undefined) kv.push(`comp=${m.components}`);
    if (m.mates) kv.push(`mates=${m.mates.ok}/${m.mates.total}`);
    kv.push(`V.sum=${volCm3(m.volume_mm3)}`);
    if (m.volume_union_mm3 !== undefined) kv.push(`V.union=${volCm3(m.volume_union_mm3)}`);
    if (m.clashes) kv.push(`clash=${clashSigma(m.clashes)}`);
  } else if (m?.kind === "part") {
    kv.push(`V=${volCm3(m.volume_mm3)}`);
    if (m.mass_kg !== undefined) kv.push(`m=${fmtNum(m.mass_kg, 3)}kg`);
  }
  kv.push(`files=${r.files.length}`);
  if (r.share) kv.push(`share=${shareMode(r.share)}`);
  if (r.stopped) kv.push(`stop=${locOf(entryLines({ line: r.stopped.line }))}:${CODE_RE.test(r.stopped.code) ? r.stopped.code : "msg.error"}`);
  kv.push(`t=${secs(r.ms)}`);
  const slow = [...(r.timing ?? [])].sort((a, b) => b.ms - a.ms)[0];
  if (slow && slow.ms >= 100) kv.push(`slow=L${nat(slow.line)}:${token(slow.op, "op")}:${secs(slow.ms)}`);
  if (r.peakMB > 0) kv.push(`mem=${Math.round(r.peakMB)}MB`);
  return `Σ ${kv.join(" ")}`;
}

/** značka přebytku – soubor je vždy `protocol-full.txt` ve výstupní složce (gramatika 4.2) */
export const overflowLine = (n: number, bytes: number) => `… ${n} entries ${bytes}B in ${OVERFLOW_FILE}`;

/* ───────────────────────── stručný protokol s rozpočtem ───────────────────────── */

/** `budget`: tvrdý rozpočet v bajtech UTF-8 (výchozí 2048; NaN / ne-číslo → výchozí, `Infinity` → bez omezení) */
export type ShortOptions = { budget?: number; notes?: boolean };
export type ShortProtocol = { text: string; bytes: number; budget: number; overflow?: Overflow };

/** priorita zařazení (menší = dřív) */
const PRIO = { error: 0, warn: 1, out: 2, req: 3, doc: 4, listing: 5, note: 6 } as const;
/** skupina tisku (pořadí řádků) */
const GROUP = { error: 0, warn: 1, note: 2, measure: 3, doc: 4, file: 5, link: 6 } as const;
type Item = { prio: number; group: number; order: number; text: string; bytes: number };

/** pořadí v rámci skupiny: záznamy bez řádku (běh, hostitel) první, pak podle řádku a vzniku */
const lineKey = (e: Entry) => {
  const l = entryLines(e);
  return l.length ? l[0] : -1;
};

/** kandidáti stručného protokolu (bez hlavičky a Σ) */
function candidates(r: RunReport, notes: boolean): Item[] {
  const items: Item[] = [];
  const add = (prio: number, group: number, order: number, text: string) => items.push({ prio, group, order, text, bytes: utf8Bytes(text) + 1 });
  const entries = mergeEntries(r.entries);
  const seq = new Map(entries.map((e, i) => [e, i]));
  const sorted = [...entries].sort((a, b) => lineKey(a) - lineKey(b) || seq.get(a)! - seq.get(b)!);
  sorted.forEach((e, i) => {
    if (e.level === "error") add(PRIO.error, GROUP.error, i, msgLine(e, false));
    else if (e.level === "warn") add(PRIO.warn, GROUP.warn, i, msgLine(e, false));
    else if (e.level === "note" && notes) add(PRIO.note, GROUP.note, i, msgLine(e, false));
    else if (e.level === "measure") {
      const t = measureText(e);
      add(t.includes("\n") ? PRIO.listing : PRIO.req, GROUP.measure, i, t);
    }
  });
  // D: hlavní dokument vždy, ostatní jen s ✗/⚠ (z výsledků stavby nebo ze záznamů s tímto dokumentem)
  const main = mainDoc(r);
  const flagged = new Set(entries.filter((e) => (e.level === "error" || e.level === "warn") && e.doc).map((e) => e.doc as string));
  r.docs.forEach((d, i) => {
    const bad = (d.features?.error ?? 0) > 0 || (d.features?.warn ?? 0) > 0 || flagged.has(d.name) || flagged.has(d.ref);
    if (d === main || bad) add(PRIO.doc, GROUP.doc, d === main ? -1 : i, docLine(d));
  });
  r.files.forEach((f, i) => add(PRIO.out, GROUP.file, i, fileLine(f)));
  if (r.share) add(PRIO.out, GROUP.link, 0, linkLine(r.share));
  return items;
}

/** požadovaný rozpočet: chybějící, NaN nebo ne-číslo → výchozí; `Infinity` → bez omezení; jinak celé číslo */
function askedBudget(b: unknown): number {
  if (typeof b !== "number" || Number.isNaN(b)) return DEFAULT_BUDGET;
  if (b === Infinity) return Number.MAX_SAFE_INTEGER;
  return Math.trunc(b);
}

/**
 * Stručný protokol s tvrdým rozpočtem `budget` bajtů UTF-8 (každý řádek včetně `\n`; výchozí 2048). Hlavička a Σ jsou vždy;
 * ostatní řádky hladově podle priority (viz záhlaví modulu); co se nevejde, je jen v plném protokolu a stručný protokol
 * končí řádkem `… <n> entries <bajty>B in protocol-full.txt` před Σ. Když se všechno nevejde a rozpočet je menší než
 * hlavička + Σ + značka, zvýší se na toto minimum (vrací se jako `budget`).
 */
export function shortProtocol(r: RunReport, o: ShortOptions = {}): ShortProtocol {
  const head = headerLine(r);
  const sigma = sigmaLine(r);
  const items = candidates(r, !!o.notes);
  const fixed = utf8Bytes(head) + 1 + utf8Bytes(sigma) + 1;
  const total = items.reduce((s, x) => s + x.bytes, 0);
  const marker = (n: number, bytes: number) => (n > 0 ? utf8Bytes(overflowLine(n, bytes)) + 1 : 0);
  let budget = askedBudget(o.budget);
  const kept = new Set<Item>();
  if (fixed + total <= budget) for (const it of items) kept.add(it);
  else {
    budget = Math.max(budget, fixed + marker(items.length, total));
    // hladově v pořadí priority: záznam se vejde i se značkou za všechno, co by po něm zůstalo nevypsané (invariant
    // used + značka ≤ budget platí po každém kroku, takže na konci se značka vejde vždy)
    let used = fixed;
    let restN = items.length;
    let restB = total;
    for (const it of [...items].sort((a, b) => a.prio - b.prio || a.group - b.group || a.order - b.order)) {
      if (used + it.bytes + marker(restN - 1, restB - it.bytes) > budget) continue;
      kept.add(it);
      used += it.bytes;
      restN--;
      restB -= it.bytes;
    }
  }
  const over = items.filter((x) => !kept.has(x));
  const body = [...kept].sort((a, b) => a.group - b.group || a.order - b.order).map((x) => x.text);
  const overflow: Overflow | undefined = over.length ? { entries: over.length, bytes: over.reduce((s, x) => s + x.bytes, 0), file: OVERFLOW_FILE } : undefined;
  const lines = [head, ...body, ...(overflow ? [overflowLine(overflow.entries, overflow.bytes)] : []), sigma];
  const text = lines.join("\n");
  return { text, bytes: utf8Bytes(text) + 1, budget, ...(overflow ? { overflow } : {}) };
}

/** stručný protokol jako text (viz `shortProtocol`) */
export const formatShort = (r: RunReport, o: ShortOptions = {}): string => shortProtocol(r, o).text;

/* ───────────────────────── plný protokol a JSON ───────────────────────── */

/**
 * Plný protokol (obsah `protocol-full.txt`, konzole prohlížeče v režimu „podrobně“): hlavička, všechny záznamy včetně ✓ a ℹ
 * v pořadí řádků skriptu (texty nezkrácené, úplné výčty řádků), řádky D všech dokumentů, F, O a Σ. Bez rozpočtu.
 */
export function formatFull(r: RunReport): string {
  const entries = mergeEntries(r.entries);
  const seq = new Map(entries.map((e, i) => [e, i]));
  const sorted = [...entries].sort((a, b) => lineKey(a) - lineKey(b) || seq.get(a)! - seq.get(b)!);
  const out = [headerLine(r)];
  for (const e of sorted) out.push(e.level === "measure" ? measureText(e) : msgLine(e, true));
  for (const d of r.docs) out.push(docLine(d));
  for (const f of r.files) out.push(fileLine(f));
  if (r.share) out.push(linkLine(r.share));
  out.push(sigmaLine(r));
  return out.join("\n");
}

export type FinalizeOptions = ShortOptions & { full?: boolean };

/** Report s vyplněným stručným protokolem (`protocol`, `overflow`), sloučenými záznamy a na vyžádání plným protokolem. */
export function finalizeReport(r: RunReport, o: FinalizeOptions = {}): RunReport {
  const merged: RunReport = { ...r, entries: mergeEntries(r.entries) };
  const s = shortProtocol(merged, o);
  const out: RunReport = { ...merged, protocol: s.text };
  if (s.overflow) out.overflow = s.overflow;
  else delete out.overflow;
  if (o.full) out.full = formatFull(merged);
  else delete out.full;
  return out;
}

/** JSON `RunReport` (`--json`, HTTP) – jeden objekt na jeden řádek */
export const toJson = (r: RunReport, o: FinalizeOptions = {}): string => JSON.stringify(finalizeReport(r, o));

/* ───────────────────────── sestavení reportu během běhu ───────────────────────── */

/**
 * Sběr záznamů během běhu (engine, B2): hlášky s kódem, ✓, vyžádané hodnoty, časy operací a paměť; `finish` vrátí `RunReport`
 * se sloučenými záznamy a počty (počty počítají výskyty před sloučením).
 */
export class ReportBuilder {
  private readonly list: Entry[] = [];
  private readonly times: OpTiming[] = [];
  private ops = 0;
  private peak = 0;
  private stoppedAt?: { line: number | null; code: string };
  private readonly t0: number;
  private readonly now: () => number;

  constructor(private readonly o: { lang: CadLang; lines: number; strict?: boolean; now?: () => number }) {
    this.now = o.now ?? (() => Date.now());
    this.t0 = this.now();
  }
  /** přidá hotový záznam */
  add(e: Entry): Entry {
    this.list.push(e);
    return e;
  }
  /** hláška s kódem z registru (úroveň a text z `codes.ts`) */
  code(code: Code, o: CodeEntryInit = {}): Entry {
    return this.add(codeEntry(code, o));
  }
  /** ✓ řádku */
  ok(line: number | null, text: string, doc?: string): Entry {
    return this.add({ line, level: "ok", text, ...(doc !== undefined ? { doc } : {}) });
  }
  /** vyžádaná hodnota `=` (druh `[a-z]+`, strojová část `klíč=hodnota …`; víc řádků = výpis) */
  measure(line: number | null, kind: string, payload: string, o: { doc?: string; data?: unknown } = {}): Entry {
    return this.add({ line, level: "measure", code: kind, text: payload, ...(o.doc !== undefined ? { doc: o.doc } : {}), ...(o.data !== undefined ? { data: o.data } : {}) });
  }
  /** provedená operace a její čas */
  op(line: number, op: string, ms: number): void {
    this.ops++;
    this.times.push({ line, op, ms });
  }
  /** hlášená paměť (MB) – drží se maximum */
  memory(mb: number): void {
    if (Number.isFinite(mb) && mb > this.peak) this.peak = mb;
  }
  /** přísný režim zastavil běh */
  stop(line: number | null, code: string): void {
    this.stoppedAt ??= { line, code };
  }
  get stopped() {
    return this.stoppedAt;
  }
  /** čas běhu v ms: zadaný, jinak z hodin hostitele; NaN / nekonečno / záporné → 0 */
  private elapsed(ms?: number): number {
    const v = ms ?? this.now() - this.t0;
    return Number.isFinite(v) && v > 0 ? v : 0;
  }
  /** počty výskytů podle úrovně (před sloučením) */
  count(level: Level): number {
    return this.list.reduce((s, e) => s + (e.level === level ? (e.count ?? 1) : 0), 0);
  }
  /** záznamy dosud (bez sloučení) – pro průběžný stav hlídače */
  get entries(): readonly Entry[] {
    return this.list;
  }
  finish(o: { docs?: DocSummary[]; files?: OutFile[]; share?: ShareInfo; ms?: number } = {}): RunReport {
    const errors = this.count("error");
    const r: RunReport = {
      v: 1,
      ok: errors === 0 && !this.stoppedAt,
      strict: !!this.o.strict,
      ms: this.elapsed(o.ms),
      lang: this.o.lang,
      counts: { lines: this.o.lines, ops: this.ops, ok: this.count("ok"), notes: this.count("note"), warnings: this.count("warn"), errors },
      entries: mergeEntries(this.list),
      docs: o.docs ?? [],
      files: o.files ?? [],
      timing: [...this.times].sort((a, b) => b.ms - a.ms).slice(0, 5),
      peakMB: Math.round(this.peak),
      protocol: "",
    };
    if (this.stoppedAt) r.stopped = this.stoppedAt;
    if (o.share) r.share = o.share;
    return r;
  }
}
