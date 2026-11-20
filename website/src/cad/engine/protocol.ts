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
 * Priorita zařazení do rozpočtu: hlavička + Σ + řádek O (odkaz; delší než 200 znaků zkrácený na začátek adresy a délku)
 * vždy > ✗ > ⚠ > F a celý dlouhý řádek O > jednořádkové `=` > D (hlavní dokument a dokumenty s ✗/⚠) > víceřádkové
 * výpisy > ℹ převzetí záložky (`doc.reused`, `doc.name-taken` – i bez `notes`, víc dokumentů jedním řádkem `×N` –
 * `mergeTakeovers`) > ostatní ℹ (jen `notes`). Pořadí tisku:
 * hlavička, ✗, ⚠, ℹ, =, D, F, O, značka přebytku,
 * Σ. Nevejdou-li se všechny řádky F (mnoho souborů), nahradí je jeden souhrnný `F <formát|mixed> "*" <bajty>B files=<n> …`
 * (jednotlivé soubory jsou v `protocol-full.txt` a v JSON `files`).
 * Zařazuje se hladově v pořadí priority (v rámci priority v pořadí tisku): záznam se vypíše, když se vejde i se značkou
 * přebytku za všechno, co zatím vypsané není; jinak se přeskočí a zkouší se další. Proto (a) se nikdy nevypíše záznam
 * nižší priority místo záznamu vyšší priority, který by se po jeho vynechání vešel, a (b) žádný vynechaný záznam by se do
 * zbylého místa nevešel. Vynechané záznamy jsou v `protocol-full.txt`.
 *
 * Slučují se jen opravdu stejné hlášky (úroveň, kód, dokument, text a data; s řádkem / bez řádku zvlášť), takže se nic
 * neztratí: dvě různé kolize, dva různé neznámé příkazy nebo `L-` a `L5` zůstanou samostatnými řádky.
 */
import type { StrictState } from "./strict";
import type { CadLang } from "../i18n";
import { CODE_RE, codeArgs, codeDef, codeEntry, fallbackCode, type Code, type CodeEntryInit } from "./codes";
import { tr } from "../i18n";
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

/**
 * Kódy hlášek o jedné položce dokumentu (prvek dílu `prvek „{0}“: {1}`, list výkresu `list {0}: {1}`): ve stručném protokolu
 * se sloučí hlášky téhož dokumentu, které se liší jen položkou (`mergeSimilar`). `numbers`: hlášky se liší i čísly (počet
 * kót na listu) – slučují se podle hlášky s čísly nahrazenými „N“, čísla každé položky jsou v seznamu položek.
 */
const SIMILAR: Readonly<Record<string, { label: string; numbers: boolean }>> = {
  "feature.warning": { label: "{0} prvků: {1} – „{2}“", numbers: false },
  "feature.failed": { label: "{0} prvků: {1} – „{2}“", numbers: false },
  "drawing.warning": { label: "{0} listů: {1} – „{2}“", numbers: true },
};
const NUM_RE = /\d+(?:[.,]\d+)*/g;

/**
 * Jen pro stručný protokol (zkouška 959, B6): ⚠/✗ téhož kódu o položkách jednoho dokumentu se stejnou hláškou a jinou
 * položkou (osm stejných „Výsledek má neplatnou geometrii…“ jednoho dílu zaplnilo 2 kB a vytlačilo skutečné kolize pohybu; 14 listů
 * s „N ručních úprav kót se nepodařilo přiřadit“) → jeden řádek `⚠ L76-L90 ×8 feature.warning "<díl>": 8 prvků: <hláška> –
 * „<prvky>“`. Plný protokol a JSON mají dál každou položku zvlášť. Slučuje se jen při aspoň dvou různých položkách; záznamy
 * s řádkem a bez řádku (`L-`) zvlášť; text mimo šablonu kódu a záznamy s daty se neslučují. Pořadí podle prvního výskytu.
 */
export function mergeSimilar(entries: readonly Entry[]): Entry[] {
  type Group = { members: Entry[]; items: Map<string, string[]>; msgs: Set<string>; msg: string; label: string };
  const groupOf = new Map<Entry, Group>();
  const at = new Map<string, Group>();
  for (const e of entries) {
    const cfg = e.code ? SIMILAR[e.code] : undefined;
    const args = cfg && (e.level === "warn" || e.level === "error") && e.data === undefined ? codeArgs(e.code!, e.text) : null;
    if (!cfg || !args || args.length !== 2) continue;
    const msg = cfg.numbers ? args[1].replace(NUM_RE, "N") : args[1];
    const key = [e.level, e.code, e.doc ?? "", entryLines(e).length ? "L" : "-", msg].join("\u0000");
    let g = at.get(key);
    if (!g) at.set(key, (g = { members: [], items: new Map(), msgs: new Set(), msg, label: cfg.label }));
    g.members.push(e);
    g.msgs.add(args[1]);
    // položka (prvek, list) → čísla jejích hlášek (`list 07: 2`, víc hlášek téhož listu `List 1: 3; 4`)
    const nums = cfg.numbers ? (args[1].match(NUM_RE) ?? []).join("/") : "";
    const item = g.items.get(args[0]) ?? [];
    if (nums && !item.includes(nums)) item.push(nums);
    g.items.set(args[0], item);
    groupOf.set(e, g);
  }
  const out: Entry[] = [];
  const done = new Set<Group>();
  for (const e of entries) {
    const g = groupOf.get(e);
    if (!g || g.items.size < 2) {
      out.push(e);
      continue;
    }
    if (done.has(g)) continue;
    done.add(g);
    const lines = [...new Set(g.members.flatMap((m) => entryLines(m)))].sort((a, b) => a - b);
    const count = g.members.reduce((a, m) => a + (m.count ?? 1), 0);
    const { lines: _old, ...first } = g.members[0];
    void _old;
    // jedna podoba hlášky = celá hláška; víc podob (jiná čísla) = hláška s „N“ a čísla u položek
    const msg = g.msgs.size === 1 ? [...g.msgs][0] : g.msg;
    const names = [...g.items].map(([name, nums]) => (g.msgs.size > 1 && nums.length ? `${name}: ${nums.join("; ")}` : name));
    out.push({ ...first, line: lines[0] ?? null, ...(lines.length ? { lines } : {}), count, text: tr(g.label, g.items.size, msg, names.join(", ")) });
  }
  return out;
}

/**
 * Souhrnná hláška ℹ převzetí záložek ve stručném protokolu (`mergeTakeovers`) – klíče slovníku; `{0}` = názvy dokumentů.
 * Počet je ve značce `×N` řádku; nápověda k volbě je před názvy, aby ji zkrácení dlouhého výčtu (`TEXT_MAX`) neodřízlo.
 */
const TAKEOVER: Readonly<Record<string, string>> = {
  "doc.reused": "záložky z dřívějšího běhu použité znovu – obsah nahrazen (volba „nový“ = nová záložka): {0}",
  "doc.name-taken": "dokumenty v nové záložce vedle otevřené záložky téhož názvu, kterou nezaložil stejný druh příkazu běhu (volba „znovu“ ji převezme): {0}",
};

/**
 * Jen pro stručný protokol bez `notes`: ℹ převzetí záložek (`doc.reused`, `doc.name-taken`) z více dokumentů → jeden řádek
 * `ℹ L1,L3,L5 ×3 doc.reused záložky z dřívějšího běhu použité znovu – …: „Deska“, „Čep“, „S“`. Opakovaný běh nástroje
 * se 70 díly má 20 takových hlášek po ~200 B – jednotlivě by se do 2 kB vešla jedna a zbytek by skončil v přebytku;
 * takhle je převzetí vidět vždy jedním řádkem (počet `×N`, názvy od začátku, Σ `reused=<n>`). Plný protokol, JSON
 * a stručný s `notes` mají dál každou hlášku zvlášť. Pořadí podle prvního výskytu.
 */
export function mergeTakeovers(entries: readonly Entry[]): Entry[] {
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.level !== "note" || !e.code || !TAKEOVER[e.code]) continue;
    const g = groups.get(e.code);
    if (g) g.push(e);
    else groups.set(e.code, [e]);
  }
  const out: Entry[] = [];
  const done = new Set<string>();
  for (const e of entries) {
    const g = e.level === "note" && e.code ? groups.get(e.code) : undefined;
    if (!g || g.length < 2) {
      out.push(e);
      continue;
    }
    if (done.has(e.code!)) continue;
    done.add(e.code!);
    const lines = [...new Set(g.flatMap((m) => entryLines(m)))].sort((a, b) => a - b);
    const count = g.reduce((a, m) => a + (m.count ?? 1), 0);
    const names = g.map((m) => `„${m.doc ?? ""}“`).join(", ");
    out.push({ level: "note", code: e.code, line: lines[0] ?? null, ...(lines.length ? { lines } : {}), count, text: tr(TAKEOVER[e.code!], names) });
  }
  return out;
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

/**
 * Řádek(y) vyžádané hodnoty `=`: druh = kód záznamu (`measureKind`), strojová část = první řádek textu, další řádky textu =
 * výpis (odsazené 2 mezerami). V plném protokolu (`full`) za nimi lokalizovaný text výpisu (`detail`), také odsazený.
 */
function measureText(e: Entry, full = false): string {
  const lines = entryLines(e);
  const loc = lines.length ? `L${lines[0]}` : "L-";
  const rows = String(e.text ?? "").split(/\r\n|[\n\r\u2028\u2029]/);
  const first = oneLine(rows[0] ?? "");
  const hasDoc = e.doc !== undefined && e.doc !== "";
  const payload = (hasDoc ? [quote(e.doc!), first].filter(Boolean).join(" ") : unquoted(first)) || "-";
  const more = full && e.detail ? String(e.detail).split(/\r\n|[\n\r\u2028\u2029]/) : [];
  const cont = [...rows.slice(1), ...more]
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
const clashD = (c: NonNullable<DocSummary["clashes"]>) => `${c.total}(thread=${c.thread}${c.underhead ? `,underhead=${c.underhead}` : ""},real=${c.real}${c.undetermined ? `,undetermined=${c.undetermined}` : ""})`;
const clashSigma = (c: NonNullable<DocSummary["clashes"]>) => `thread:${c.thread}${c.underhead ? `,underhead:${c.underhead}` : ""},real:${c.real}${c.undetermined ? `,undetermined:${c.undetermined}` : ""}`;

/** strojová část souhrnu dokumentu: `<part|asm|draft> <klíč=hodnota …>` (řádek D, výpis `= … status`) */
export function docKv(d: DocSummary): string {
  const kind = d.kind === "assembly" ? "asm" : d.kind === "draft" ? "draft" : "part";
  const kv: string[] = [];
  if (d.kind === "assembly") {
    if (d.components !== undefined) kv.push(`comp=${d.components}`);
    if (d.parts !== undefined) kv.push(`parts=${d.parts}`);
    if (d.mates) kv.push(`mates=${matesStr(d.mates)}`);
    kv.push(`V.sum=${volCm3(d.volume_mm3)}`);
    if (d.volume_union_mm3 !== undefined) kv.push(`V.union=${volCm3(d.volume_union_mm3)}`);
    if (d.mass_kg !== undefined) kv.push(`m=${fmtNum(d.mass_kg, 2)}kg`);
    if (d.bbox) kv.push(`bbox=${bboxSize(d.bbox)}`);
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
  if (d.rev) kv.push(`rev=${d.rev}`); // revize modelu dokumentu s výkresy / exporty (vlna 22, bod 20 – před `stale=`)
  if (d.stale?.length) kv.push(`stale=${d.stale.join(",")}`); // uložené výsledky, které konečnému stavu neodpovídají (vlna 22 – vždy na konci)
  return `${kind} ${kv.join(" ") || "-"}`;
}

/** řádek `D` souhrnu dokumentu */
export const docLine = (d: DocSummary): string => `D ${quote(d.name)} ${docKv(d)}`;

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

const linkUrl = (s: ShareInfo) => String(s.url ?? "").replace(/[\s\u0000-\u001f\u007f-\u009f]/g, (c) => encodeURIComponent(c)) || "-";

/** řádek `O` sdíleného odkazu */
export function linkLine(s: ShareInfo): string {
  return `O ${linkUrl(s)} exp=${isoDate(s.exp) ?? "none"} mode=${shareMode(s)}`;
}

/** odkaz do této délky (znaků) je ve stručném protokolu vždy celý – krátké odkazy úložiště mají ~40–80 znaků */
export const LINK_SHORT_MAX = 200;
/**
 * Zkrácený řádek `O` pro stručný protokol, když se dlouhý odkaz (`#s=`, celý dokument v adrese) nevejde do rozpočtu vedle
 * ✗ a ⚠: začátek adresy, „…“ a délka – `O https://…#s=1d.VVld…(4156chars) exp=… mode=link`. Celý odkaz je v plném
 * protokolu (`protocol-full.txt`, počítá se do značky přebytku) a v JSON `share.url`. Odkaz do `LINK_SHORT_MAX` znaků
 * vrací beze změny (`linkLine`).
 */
export function linkLineShort(s: ShareInfo): string {
  const url = linkUrl(s);
  if (url.length <= LINK_SHORT_MAX) return linkLine(s);
  return `O ${url.slice(0, 64)}…(${url.length}chars) exp=${isoDate(s.exp) ?? "none"} mode=${shareMode(s)}`;
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
const countCode = (entries: readonly Entry[], code: Code) => entries.reduce((s, e) => s + (e.code === code ? (e.count ?? 1) : 0), 0);

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
  // opakovaný běh (engine/runs.ts): převzaté záložky a nové záložky vedle záložky téhož názvu – vždy vidět, i když se
  // jejich řádky ℹ do rozpočtu nevejdou
  const reused = countCode(r.entries, "doc.reused");
  const taken = countCode(r.entries, "doc.name-taken");
  if (reused) kv.push(`reused=${reused}`);
  if (taken) kv.push(`name-taken=${taken}`);
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

/** priorita zařazení (menší = dřív); `shownNote` = ℹ s `short` v registru kódů (převzetí záložky) – i bez volby `notes` */
const PRIO = { error: 0, warn: 1, out: 2, req: 3, doc: 4, listing: 5, shownNote: 6, note: 7 } as const;
/** skupina tisku (pořadí řádků) */
const GROUP = { error: 0, warn: 1, note: 2, measure: 3, doc: 4, file: 5, link: 6 } as const;
/**
 * `over` = bajty v přebytku, když se záznam nevypíše (jinak `bytes`) – celý řádek O místo zkráceného; `after` = pokračovací
 * řádky výpisu, které se smějí vypsat jen se svým řádkem `=`
 */
type Item = { prio: number; group: number; order: number; text: string; bytes: number; over?: number; after?: Item };
type Extra = { n: number; b: number };

/**
 * Data souborů `… base64` (záznam `= … file` s `data.base64`): ve stručném protokolu je jen řádek `=` s délkou, data jsou
 * v plném protokolu – počítají se do přebytku vždy, takže stručný protokol má značku `… in protocol-full.txt` a CLI soubor
 * zapíše (bez přebytku by data v CLI bez `--json` / `--full` nebyla nikde).
 */
function payloadOverflow(entries: readonly Entry[]): Extra {
  let n = 0;
  let b = 0;
  for (const e of entries) {
    const b64 = e.level === "measure" && e.code === "file" ? (e.data as { base64?: unknown } | undefined)?.base64 : undefined;
    if (typeof b64 !== "string" || !b64) continue;
    n++;
    b += b64.length + 3; // odsazení 2 mezerami + konec řádku v plném protokolu
  }
  return { n, b };
}

/** pořadí v rámci skupiny: záznamy bez řádku (běh, hostitel) první, pak podle řádku a vzniku */
const lineKey = (e: Entry) => {
  const l = entryLines(e);
  return l.length ? l[0] : -1;
};

/** kandidáti stručného protokolu (bez hlavičky a Σ) */
function candidates(r: RunReport, notes: boolean): Item[] {
  const items: Item[] = [];
  const add = (prio: number, group: number, order: number, text: string): Item => {
    const it: Item = { prio, group, order, text, bytes: utf8Bytes(text) + 1 };
    items.push(it);
    return it;
  };
  const merged = mergeSimilar(mergeEntries(r.entries));
  const entries = notes ? merged : mergeTakeovers(merged); // převzetí záložek jedním řádkem (s `notes` každá hláška zvlášť)
  const seq = new Map(entries.map((e, i) => [e, i]));
  const sorted = [...entries].sort((a, b) => lineKey(a) - lineKey(b) || seq.get(a)! - seq.get(b)!);
  sorted.forEach((e, i) => {
    if (e.level === "error") add(PRIO.error, GROUP.error, i, msgLine(e, false));
    else if (e.level === "warn") add(PRIO.warn, GROUP.warn, i, msgLine(e, false));
    else if (e.level === "note" && notes) add(PRIO.note, GROUP.note, i, msgLine(e, false));
    else if (e.level === "note" && e.code && codeDef(e.code)?.short) add(PRIO.shownNote, GROUP.note, i, msgLine(e, false));
    else if (e.level === "measure") {
      const t = measureText(e);
      const nl = t.indexOf("\n");
      // nápověda: strojový řádek `= L<n> help hits=… q="…"` vždy, řádky výsledků jen když se vejdou (víc hledání v běhu)
      if (nl > 0 && e.code === "help") add(PRIO.listing, GROUP.measure, i + 0.5, t.slice(nl + 1)).after = add(PRIO.req, GROUP.measure, i, t.slice(0, nl));
      else add(nl > 0 ? PRIO.listing : PRIO.req, GROUP.measure, i, t);
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
  return items; // řádek O (odkaz) je pevný jako hlavička a Σ (shortProtocol)
}

/** souhrnný řádek F místo jednotlivých souborů: `F <formát|mixed> "*" <bajty>B files=<n> formats=… [check=…] [run=fail]` */
export function filesSummaryLine(files: readonly OutFile[]): string {
  const fmts = [...new Set(files.map((f) => token(f.format, "bin")))];
  const bytes = files.reduce((s, f) => s + (Number.isFinite(f.bytes) ? Math.max(0, Math.round(f.bytes)) : 0), 0);
  const kv = [`files=${files.length}`, `formats=${fmts.join(",")}`];
  const checked = files.filter((f) => f.check);
  if (checked.length) kv.push(`check=${checked.every((f) => f.check!.ok) ? "ok" : "fail"}`);
  if (files.some((f) => f.run === "fail")) kv.push("run=fail");
  return `F ${fmts.length === 1 ? fmts[0] : "mixed"} "*" ${bytes}B ${kv.join(" ")}`;
}

/** požadovaný rozpočet: chybějící, NaN nebo ne-číslo → výchozí; `Infinity` → bez omezení; jinak celé číslo */
function askedBudget(b: unknown): number {
  if (typeof b !== "number" || Number.isNaN(b)) return DEFAULT_BUDGET;
  if (b === Infinity) return Number.MAX_SAFE_INTEGER;
  return Math.trunc(b);
}

/**
 * Stručný protokol s tvrdým rozpočtem `budget` bajtů UTF-8 (každý řádek včetně `\n`; výchozí 2048). Hlavička, Σ a řádek O
 * (dlouhý odkaz zkrácený – `linkLineShort`) jsou vždy; ostatní řádky hladově podle priority (viz záhlaví modulu); co se
 * nevejde, je jen v plném protokolu a stručný protokol končí řádkem `… <n> entries <bajty>B in protocol-full.txt` před Σ
 * (také vždy, když běh vrátil data `… base64` – ta jsou jen v plném protokolu). Když se všechno nevejde a rozpočet je
 * menší než hlavička + Σ + zkrácený O + značka, zvýší se na toto minimum (vrací se jako `budget`).
 */
export function shortProtocol(r: RunReport, o: ShortOptions = {}): ShortProtocol {
  const head = headerLine(r);
  const sigma = sigmaLine(r);
  /*
   * Odkaz se vypíše vždy (jako hlavička a Σ) – bez něj by agent výsledek sdílení neměl (zpráva 959, bod 5). Dlouhý odkaz
   * (celý dokument v adrese, 3–15 kB) ale nesmí vytlačit ✗ a ⚠ (priorita ✗ > ⚠ > F/O): pevná je jen zkrácená podoba
   * (`linkLineShort`), celý řádek O je kandidát s prioritou F/O, který ji nahradí, když se vejde.
   */
  const link = r.share ? linkLineShort(r.share) : null;
  const fullLink = r.share ? linkLine(r.share) : null;
  const items = candidates(r, !!o.notes);
  let linkUp: Item | null = null;
  if (link && fullLink && link !== fullLink) {
    linkUp = { prio: PRIO.out, group: GROUP.link, order: 0, text: fullLink, bytes: utf8Bytes(fullLink) - utf8Bytes(link), over: utf8Bytes(fullLink) + 1 };
    items.push(linkUp);
  }
  const payload = payloadOverflow(r.entries);
  const fixed = utf8Bytes(head) + 1 + utf8Bytes(sigma) + 1 + (link ? utf8Bytes(link) + 1 : 0);
  const total = items.reduce((s, x) => s + x.bytes, 0);
  const marker = (n: number, bytes: number) => (n > 0 ? utf8Bytes(overflowLine(n, bytes)) + 1 : 0);
  const overOf = (x: Item) => x.over ?? x.bytes;
  let budget = askedBudget(o.budget);
  /**
   * hladově v pořadí priority: záznam se vejde i se značkou za všechno, co by po něm zůstalo nevypsané (invariant
   * used + značka ≤ budget platí po každém kroku, takže na konci se značka vejde vždy); `extra` = záznamy, které jsou
   * v přebytku vždy (data `… base64`, jednotlivé řádky F zastoupené souhrnným řádkem)
   */
  const select = (list: Item[], extra: Extra) => {
    const kept = new Set<Item>();
    let used = fixed;
    let restN = list.length + extra.n;
    let restB = list.reduce((s, x) => s + overOf(x), 0) + extra.b;
    for (const it of [...list].sort((a, b) => a.prio - b.prio || a.group - b.group || a.order - b.order)) {
      if (it.after && !kept.has(it.after)) continue;
      if (used + it.bytes + marker(restN - 1, restB - overOf(it)) > budget) continue;
      kept.add(it);
      used += it.bytes;
      restN--;
      restB -= overOf(it);
    }
    return kept;
  };
  let kept = new Set<Item>();
  if (fixed + total + marker(payload.n, payload.b) <= budget) for (const it of items) kept.add(it);
  else {
    budget = Math.max(budget, fixed + marker(items.length + payload.n, items.reduce((s, x) => s + overOf(x), 0) + payload.b));
    kept = select(items, payload);
    // nevešly se všechny soubory: jeden souhrnný řádek F místo nich (jednotlivé soubory jsou v plném protokolu a v JSON)
    const fileItems = items.filter((x) => x.group === GROUP.file);
    if (fileItems.length > 1 && fileItems.some((x) => !kept.has(x))) {
      const text = filesSummaryLine(r.files);
      const sum: Item = { prio: PRIO.out, group: GROUP.file, order: -1, text, bytes: utf8Bytes(text) + 1 };
      const alt = select([...items.filter((x) => x.group !== GROUP.file), sum], { n: fileItems.length + payload.n, b: fileItems.reduce((s, x) => s + x.bytes, 0) + payload.b });
      if (alt.has(sum)) kept = alt;
    }
  }
  const over = items.filter((x) => !kept.has(x));
  const body = [...kept].filter((x) => x !== linkUp).sort((a, b) => a.group - b.group || a.order - b.order).map((x) => x.text);
  const overN = over.length + payload.n;
  const overflow: Overflow | undefined = overN ? { entries: overN, bytes: over.reduce((s, x) => s + overOf(x), 0) + payload.b, file: OVERFLOW_FILE } : undefined;
  const linkText = linkUp && kept.has(linkUp) ? fullLink : link;
  const lines = [head, ...body, ...(linkText ? [linkText] : []), ...(overflow ? [overflowLine(overflow.entries, overflow.bytes)] : []), sigma];
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
  for (const e of sorted) out.push(e.level === "measure" ? measureText(e, true) : msgLine(e, true));
  for (const d of r.docs) out.push(docLine(d));
  for (const f of r.files) out.push(fileLine(f));
  if (r.share) out.push(linkLine(r.share));
  out.push(sigmaLine(r));
  return out.join("\n");
}

/**
 * Protokol konzole prohlížeče (kap. 4.1 „v konzoli prohlížeče plný – dnešní text“): text, který vrací `runAgentText` /
 * `window.mncad.run` – řádky operací podle řádků skriptu, výsledky prvků po stavbě a stav dokumentu (`report.console`
 * z `runScript`). Report bez textu konzole (CLI, HTTP) → plný protokol `formatFull`.
 */
export const formatConsole = (r: RunReport): string => r.console ?? formatFull(r);

export type FinalizeOptions = ShortOptions & { full?: boolean };

/** Report s vyplněným stručným protokolem (`protocol`, `overflow`), sloučenými záznamy a na vyžádání plným protokolem. */
export function finalizeReport(r: RunReport, o: FinalizeOptions = {}): RunReport {
  const { console: _console, ...rest } = r; // text konzole prohlížeče se do JSON / HTTP nepřenáší
  void _console;
  const merged: RunReport = { ...rest, entries: mergeEntries(r.entries) };
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
  /** odkaz vytvořený během běhu (text `sdílet` / `odkaz`) – řádek O, pokud ho `finish` nepřepíše (`--share`) */
  private sharedLink?: ShareInfo;
  /** přísný režim běhu (volba + řádky `přísně`) – CLI podle něj zastaví i závěrečnou stavbu a výstupy (engine/strict.ts) */
  strictMode?: StrictState;
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
  measure(line: number | null, kind: string, payload: string, o: { doc?: string; data?: unknown; detail?: string } = {}): Entry {
    return this.add({ line, level: "measure", code: kind, text: payload, ...(o.doc !== undefined ? { doc: o.doc } : {}), ...(o.data !== undefined ? { data: o.data } : {}), ...(o.detail ? { detail: o.detail } : {}) });
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
  /** sdílený odkaz z běhu (poslední vyhrává; `finish({ share })` má přednost) */
  setShare(s: ShareInfo): void {
    this.sharedLink = s;
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
      strict: this.strictMode ? this.strictMode.used : !!this.o.strict,
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
    const share = o.share ?? this.sharedLink;
    if (share) r.share = share;
    return r;
  }
}
