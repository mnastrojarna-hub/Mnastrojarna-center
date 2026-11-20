/**
 * Kola a ozubení textem (vlna 19, balík text) – CS / EN / DE. Čisté funkce bez jádra (testovatelné v Node); agent.ts je volá
 * hned za příkazem `svar`, null = jiný příkaz. Každý příkaz se přečte na EXISTUJÍCÍ operace (žádná nová operace enginu):
 *
 *   kolo <druh> [<slovo> <hodnota> | <příznak> | <složený zápis>]… [název "…"]   → prvek `gear.<druh>` (operace feature)
 *   kolo tabulka [vše | "název"]                                                → akce `gear.table` (výpis ze stavu dokumentu)
 *   kolo nápověda [druh] · soukolí nápověda [druh]                               → text do protokolu (operace info)
 *   soukolí <druh> m 2 z1 20 z2 60 [a 81] [x1 0,3] [x2 0,2] [vůle 0,05] [b 20] [díra1 12] [díra2 20] [název "…"]
 *                                → nový díl + prvek + nový díl + prvek + nová sestava + vložit ×2 + vazba (stejné příkazy
 *                                  jako režim Soukolí v průvodci – `pairScript`) + souhrn soukolí (operace info)
 *   EN: gear spur m 2 z 24 … · gear table · gear help · gear pair spur … (gearpair, gearset)
 *   DE: rad stirnrad m 2 z 24 … (zahnrad) · rad tabelle · rad hilfe · radpaar stirnrad … (zahnradpaar, getriebe)
 *
 * Gramatika je CELÁ z tabulky druhu (`@/cad/gears`: `KINDS[druh].rows[].words`, `enumWords`, `phrases`, `positional`;
 * soukolí `PAIR_ROWS[druh]`) – GUI, `prvek gear.*` a text tak nemůžou odbočit. Slova všech tří jazyků platí vždy, při shodě
 * má přednost jazyk rozhraní. Čísla s desetinnou čárkou i tečkou, přípony `°` a `mm` se ignorují, zkrácené `m2`, `z24`,
 * `b20` a `klíč=hodnota` (`m=2`) také. Data prvku začínají výchozími hodnotami druhu (`def.defaults()`), takže
 * `kolo …` ≡ `prvek gear.<druh> …` ≡ průvodce.
 *
 * Dokument → skript (`gearScriptLines`) zapisuje kolo zpět vlastním příkazem `kolo …` jen s hodnotami, které se liší
 * od výchozích, kanonickými slovy jazyka skriptu a se složenými zápisy (`díra 20 pero`, `náboj 40 15`).
 */
import type { AgentOp, AgentProgram } from "./agent";
import { toDirection } from "./ext/place";
import { getExt } from "./ext/registry";
import { GEAR_KINDS, KINDS, kindOfExt, PAIR_ROWS, pairScript, solvePair, type AnyKind } from "./gears";
import type { GearData, GearPhrase, GearRow, Lang, PairKind } from "./gears/types";
import { getLang, tr } from "./i18n";
import { uid, type Feature } from "./types";

/* ───────────────────────── slova ───────────────────────── */
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/\s+/g, " ").trim();
const set = (...w: string[]) => new Set(w.map(fold));
/** hlava příkazu kola: kolo / gear / wheel / rad / zahnrad */
const HEAD = set("kolo", "kola", "gear", "gears", "wheel", "rad", "zahnrad", "zahnräder");
/** hlava soukolí (jedno slovo) */
const PAIR_HEAD = set("soukolí", "gearpair", "gearset", "radpaar", "zahnradpaar", "getriebe");
/** „gear pair“, „rad paar“, „kolo pár“ – druhé slovo za hlavou kola */
const PAIR_WORD = set("pár", "pair", "set", "paar", "soukolí");
const TABLE = set("tabulka", "tabulky", "table", "tables", "tabelle", "tabellen", "data");
const HELP = set("nápověda", "help", "hilfe", "?", "pomoc");
const ALL = set("vše", "všechna", "všechny", "all", "alle");
const NAME = set("název", "name", "jméno");
const YES = set("ano", "yes", "ja", "true", "on", "1");
const NO = set("ne", "no", "nein", "false", "off", "0");
const LANGS: Lang[] = ["cs", "en", "de"];
const HEAD_WORD: Record<Lang, string> = { cs: "kolo", en: "gear", de: "rad" };
const PAIR_HEAD_WORD: Record<Lang, string> = { cs: "soukolí", en: "gearpair", de: "radpaar" };
const TABLE_WORD: Record<Lang, string> = { cs: "tabulka", en: "table", de: "tabelle" };
const HELP_WORD: Record<Lang, string> = { cs: "nápověda", en: "help", de: "hilfe" };
const NAME_WORD: Record<Lang, string> = { cs: "název", en: "name", de: "name" };
const NO_WORD: Record<Lang, string> = { cs: "ne", en: "no", de: "nein" };
const curLang = (): Lang => {
  const l = getLang();
  return l === "en" || l === "de" ? l : "cs";
};

type Tok = { t: string; q: boolean };
/** Rozdělí řádek na slova; text v uvozovkách je jedno slovo (název). */
function tokens(line: string): Tok[] {
  const out: Tok[] = [];
  const re = /"([^"]*)"|„([^“]*)“|'([^']*)'|([^\s"„]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] != null || m[2] != null || m[3] != null ? { t: m[1] ?? m[2] ?? m[3], q: true } : { t: m[4], q: false });
  // „m=2“ → „m“ „2“ (zápis klíč=hodnota z obecného příkazu)
  return out.flatMap((k) => {
    if (k.q) return [k];
    const eq = /^([^=]+)=(.*)$/.exec(k.t);
    return !eq ? [k] : eq[2] ? [{ t: eq[1], q: false }, { t: eq[2], q: false }] : [{ t: eq[1], q: false }];
  });
}
const NUM = /^[+-]?(\d+[.,]?\d*|[.,]\d+)(mm|°)?$/i;
const isNum = (t: string) => NUM.test(t);
const num = (t: string) => parseFloat(t.replace(/(mm|°)$/i, "").replace(",", "."));

/* ───────────────────────── tabulka slov druhu ───────────────────────── */
type Target = { t: "row"; row: GearRow } | { t: "enum"; row: GearRow; v: string } | { t: "phrase"; ph: GearPhrase };
export type Grammar = { rows: GearRow[]; phrases: GearPhrase[]; positional: string[]; index: Map<string, Target>; maxWords: number };

/** Slova → cíle. Pořadí: jazyk rozhraní, pak cs, en, de; v jazyce složené zápisy před řádky (zápis řádek zobecňuje), nakonec klíče dat. */
export function grammarOf(rows: GearRow[], phrases: GearPhrase[], positional: string[] = [], lang: Lang = curLang()): Grammar {
  const index = new Map<string, Target>();
  let maxWords = 1;
  const add = (w: string, t: Target) => {
    const k = fold(w);
    if (!k || index.has(k)) return;
    index.set(k, t);
    maxWords = Math.max(maxWords, k.split(" ").length);
  };
  for (const l of [lang, ...LANGS.filter((x) => x !== lang)]) {
    for (const ph of phrases) for (const w of ph.words[l]) add(w, { t: "phrase", ph });
    for (const row of rows) {
      for (const w of row.words[l]) add(w, { t: "row", row });
      for (const [v, ws] of Object.entries(row.enumWords ?? {})) for (const w of ws[l]) add(w, { t: "enum", row, v });
    }
  }
  for (const row of rows) add(row.key, { t: "row", row });
  return { rows, phrases, positional, index, maxWords };
}
const KIND_GRAMMAR = new Map<string, Grammar>();
const kindGrammar = (def: AnyKind): Grammar => {
  const key = `${def.kind}:${curLang()}`;
  let g = KIND_GRAMMAR.get(key);
  if (!g) KIND_GRAMMAR.set(key, (g = grammarOf(def.rows, def.phrases, def.positional ?? [])));
  return g;
};
const PAIR_POSITIONAL = ["chain", "profile"];
const pairGrammar = (kind: PairKind): Grammar => {
  const key = `pair:${kind}:${curLang()}`;
  let g = KIND_GRAMMAR.get(key);
  if (!g) {
    const rows = PAIR_ROWS[kind];
    KIND_GRAMMAR.set(key, (g = grammarOf(rows, [], PAIR_POSITIONAL.filter((k) => rows.some((r) => r.key === k)))));
  }
  return g;
};

/** druh kola podle slova (slovo druhu v libovolném jazyce, „spur“, „gear.spur“) */
export function kindByWord(w: string): AnyKind | undefined {
  const f = fold(w);
  const lang = curLang();
  for (const l of [lang, ...LANGS.filter((x) => x !== lang)]) for (const k of GEAR_KINDS) if (KINDS[k].words[l].some((x) => fold(x) === f)) return KINDS[k];
  return GEAR_KINDS.map((k) => KINDS[k]).find((d) => fold(d.kind) === f || fold(d.ext) === f);
}
const PAIR_KINDS = Object.keys(PAIR_ROWS) as PairKind[];
const pairKindByWord = (w: string): PairKind | undefined => {
  const d = kindByWord(w);
  if (d && (PAIR_KINDS as string[]).includes(d.kind)) return d.kind as PairKind;
  // šnekové kolo → šnekové soukolí
  return d?.kind === "wormwheel" ? "worm" : undefined;
};
const kindWord = (d: AnyKind, l: Lang = curLang()) => d.words[l][0];
const kindList = (l: Lang = curLang()) => GEAR_KINDS.map((k) => kindWord(KINDS[k], l)).join(", ");
const pairKindList = (l: Lang = curLang()) => PAIR_KINDS.map((k) => kindWord(KINDS[k], l)).join(", ");
/** slova řádků pro hlášku o neznámém slově */
const rowWords = (g: Grammar, l: Lang = curLang()) => [...new Set([...g.phrases.map((p) => p.words[l][0]), ...g.rows.filter((r) => r.kind !== "point").map((r) => r.words[l][0])])].join(", ");

/* ───────────────────────── čtení hodnot ───────────────────────── */
type Read = { data: GearData; name?: string; set: Set<string> };

/** hodnota výčtu podle slova: hodnota, popisek, slovo hodnoty (enumWords) v libovolném jazyce */
function enumValue(row: GearRow, raw: string): string | undefined {
  const f = fold(raw);
  const opt = row.options?.find((o) => fold(o.v) === f || fold(o.l) === f);
  if (opt) return opt.v;
  for (const [v, ws] of Object.entries(row.enumWords ?? {})) if (LANGS.some((l) => ws[l].some((w) => fold(w) === f))) return v;
  if (row.kind === "mode" && ["new", "add", "cut"].includes(f)) return f;
  return undefined;
}

/**
 * Přečte slova za druhem kola / soukolí podle tabulky. `label` = začátek hlášek („kolo čelní“), `helpCmd` = kde je popis.
 * Chyba = srozumitelná hláška (protokol ji ukáže u řádku).
 */
export function readWords(g: Grammar, toks: Tok[], label: string, helpCmd: string): Read {
  const data: GearData = {};
  const done = new Set<string>();
  let name: string | undefined;
  let i = 0;
  const lang = curLang();
  const fail = (text: string): never => {
    throw new Error(`${label}: ${text}`);
  };
  const unknown = (w: string): never => fail(tr("neznámé slovo „{0}“ – řádky: {1}; popis: {2}", w, rowWords(g, lang), helpCmd));
  const setv = (key: string, v: unknown) => {
    data[key] = v;
    done.add(key);
  };
  /** cíl slova od pozice `at` (nejdelší shoda víceslovného zápisu) → [cíl, počet slov] */
  const match = (at: number): [Target, number] | null => {
    for (let n = Math.min(g.maxWords, toks.length - at); n >= 1; n--) {
      const part = toks.slice(at, at + n);
      if (part.some((x) => x.q)) continue;
      const t = g.index.get(fold(part.map((x) => x.t).join(" ")));
      if (t) return [t, n];
    }
    return null;
  };
  const nextNum = (row: GearRow, word: string): number => {
    const t = toks[i];
    if (!t || t.q || !isNum(t.t)) fail(tr("za „{0}“ chybí číslo ({1})", word, row.label));
    i++;
    const v = num(t.t);
    if (row.kind === "int" && !Number.isInteger(v)) fail(tr("„{0}“ je celé číslo, ne {1}", word, t.t));
    return v;
  };
  /** hodnota řádku za jeho slovem */
  const rowValue = (row: GearRow, word: string) => {
    switch (row.kind) {
      case "number":
      case "int":
        return setv(row.key, nextNum(row, word));
      case "bool": {
        const t = toks[i];
        if (t && !t.q && YES.has(fold(t.t))) {
          i++;
          return setv(row.key, true);
        }
        if (t && !t.q && NO.has(fold(t.t))) {
          i++;
          return setv(row.key, false);
        }
        return setv(row.key, true);
      }
      case "enum":
      case "mode": {
        // víceslovná hodnota („obě strany“) – nejdelší shoda
        for (let n = Math.min(3, toks.length - i); n >= 1; n--) {
          const v = enumValue(row, toks.slice(i, i + n).map((x) => x.t).join(" "));
          if (v !== undefined) {
            i += n;
            return setv(row.key, v);
          }
        }
        const opts = (row.options ?? []).map((o) => o.v || "–").concat(row.kind === "mode" ? Object.values(row.enumWords ?? {}).map((w) => w[lang][0]) : []);
        return fail(tr("„{0}“ má hodnoty {1}", word, opts.join(" | ")));
      }
      case "vec3": {
        const v: number[] = [];
        while (v.length < 3 && toks[i] && !toks[i].q && isNum(toks[i].t)) v.push(num(toks[i++].t));
        if (v.length < 2) fail(tr("za „{0}“ chybí souřadnice: {0} x y [z]", word));
        return setv(row.key, [v[0], v[1], v[2] ?? 0]);
      }
      case "direction": {
        const t = toks[i];
        if (t && !t.q && !isNum(t.t)) {
          const d = toDirection(t.t);
          if (!d) fail(tr("„{0}“ je směr: X | Y | Z | -Z | tři čísla", word));
          i++;
          return setv(row.key, d);
        }
        const v: number[] = [];
        while (v.length < 3 && toks[i] && !toks[i].q && isNum(toks[i].t)) v.push(num(toks[i++].t));
        if (v.length < 3 || v.every((x) => x === 0)) fail(tr("„{0}“ je směr: X | Y | Z | -Z | tři čísla", word));
        return setv(row.key, { kind: "vector", v: [v[0], v[1], v[2]] });
      }
      case "text": {
        const t = toks[i];
        if (!t) fail(tr("za „{0}“ chybí hodnota", word));
        i++;
        return setv(row.key, t.t);
      }
      default:
        return fail(tr("„{0}“ (odkaz na bod) jde zadat jen obecným příkazem: prvek {1} {2}=…", word, "gear.*", row.key));
    }
  };
  let firstValue = true;
  while (i < toks.length) {
    const tk = toks[i];
    const first = firstValue;
    firstValue = false;
    // „ansi 40“ / „ANSI40“ = řetěz ANSI (slovo „ansi“ se přeskočí, číslo za ním platí jako volné slovo)
    if (!tk.q && fold(tk.t) === "ansi" && g.positional.length) {
      i++;
      firstValue = true;
      continue;
    }
    if (tk.q) {
      name = tk.t;
      i++;
      continue;
    }
    if (NAME.has(fold(tk.t)) && toks[i + 1]) {
      name = toks[i + 1].t;
      i += 2;
      continue;
    }
    const hit = match(i);
    if (hit) {
      const [t, n] = hit;
      const word = toks.slice(i, i + n).map((x) => x.t).join(" ");
      i += n;
      if (t.t === "enum") setv(t.row.key, t.v);
      else if (t.t === "row") rowValue(t.row, word);
      else {
        // složený zápis: čísla do klíčů v pořadí (aspoň jedno), pak příznaky zápisu
        let k = 0;
        while (k < t.ph.keys.length && toks[i] && !toks[i].q && isNum(toks[i].t)) setv(t.ph.keys[k++], num(toks[i++].t));
        if (!k) {
          // bez čísla: slovo zápisu, které je zároveň slovem řádku příznaku / výčtu, platí jako ten řádek
          const row = g.rows.find((r) => r.key === t.ph.keys[0]);
          if (row && row.kind !== "number" && row.kind !== "int") rowValue(row, word);
          else fail(tr("za „{0}“ chybí číslo ({1})", word, t.ph.keys.join(", ")));
        }
        for (let more = true; more && i < toks.length; ) {
          more = false;
          for (const fl of t.ph.flags ?? []) {
            for (let n2 = Math.min(3, toks.length - i); n2 >= 1 && !more; n2--) {
              const w = fold(toks.slice(i, i + n2).map((x) => x.t).join(" "));
              if (LANGS.some((l) => fl.words[l].some((x) => fold(x) === w))) {
                for (const [key, v] of Object.entries(fl.set)) setv(key, v);
                i += n2;
                more = true;
              }
            }
          }
        }
      }
      continue;
    }
    // poziční slovo (řetěz 08B, profil 5M; číslo jen hned za druhem – „kolo řetězové 40“)
    const pos = g.positional.find((key) => !done.has(key));
    if (pos) {
      const row = g.rows.find((r) => r.key === pos)!;
      const raw = tk.t.replace(/^ansi[-\s]?/i, "");
      const v = (!isNum(raw) || first || raw !== tk.t) && enumValue(row, raw);
      if (v) {
        setv(pos, v);
        i++;
        continue;
      }
    }
    // zkrácený zápis: písmena slova řádku + číslo („m2“, „z24“, „b20“, „x0,2“)
    const cm = /^(\p{L}+)([+-]?(?:\d+[.,]?\d*|[.,]\d+))(mm|°)?$/u.exec(tk.t);
    if (cm) {
      const t = g.index.get(fold(cm[1]));
      const row = t?.t === "row" ? t.row : t?.t === "phrase" ? g.rows.find((r) => r.key === t.ph.keys[0]) : undefined;
      if (row && (row.kind === "number" || row.kind === "int")) {
        const v = num(cm[2]);
        if (row.kind === "int" && !Number.isInteger(v)) fail(tr("„{0}“ je celé číslo, ne {1}", cm[1], cm[2]));
        setv(row.key, v);
        i++;
        continue;
      }
    }
    if (isNum(tk.t)) fail(tr("číslo {0} bez slova řádku – napište např. „m 2“, „z 24“ (řádky: {1})", tk.t, rowWords(g, lang)));
    unknown(tk.t);
  }
  return { data, name, set: done };
}

/* ───────────────────────── příkazy ───────────────────────── */
export type GearParseCtx = {
  /** rozbor vnořeného skriptu (soukolí → existující příkazy) – `parseAgentText` */
  sub: (text: string) => AgentProgram;
};

/** řádek nápovědy jednoho řádku tabulky */
function rowHelp(row: GearRow, lang: Lang): string {
  const w = row.words[lang];
  const dec = (v: number) => (lang === "en" ? String(v) : String(v).replace(".", ","));
  const unit = row.unit ? ` [${row.unit}]` : "";
  const def = typeof row.def === "object" ? (Array.isArray(row.def) ? row.def.join(" ") : String((row.def as { axis?: string }).axis ?? row.def.kind)) : row.def === "" ? "–" : typeof row.def === "number" ? dec(row.def) : String(row.def);
  const range = row.min !== undefined && row.max !== undefined ? tr(", rozsah {0} až {1}", dec(row.min), dec(row.max)) : row.min !== undefined && row.min > 0 ? tr(", nejméně {0}", dec(row.min)) : "";
  const opts = row.options?.length ? ` (${row.options.map((o) => o.v || "–").join(" | ")})` : row.kind === "mode" ? ` (${Object.values(row.enumWords ?? {}).map((x) => x[lang][0]).join(" | ")})` : "";
  const flags = row.enumWords && row.kind !== "mode" ? tr("; příznaky: {0}", Object.entries(row.enumWords).map(([v, x]) => `${x[lang][0]} = ${v}`).join(", ")) : "";
  const how = row.kind === "bool" ? tr("{0} [ano|ne]", w[0]) : row.kind === "vec3" ? `${w[0]} x y z` : row.kind === "direction" ? `${w[0]} X|Y|Z|x y z` : row.kind === "point" ? tr("jen prvek gear.* {0}=…", row.key) : `${w[0]} <${row.kind === "int" ? tr("celé číslo") : row.kind === "enum" || row.kind === "mode" ? tr("hodnota") : tr("číslo")}>`;
  const sym = row.symbol && !row.label.includes(row.symbol) ? ` ${row.symbol}` : "";
  return `  ${how}${w.length > 1 ? ` (${w.slice(1).join(", ")})` : ""} – ${row.label}${sym}${unit}${row.required ? tr(", povinné") : ""}, ${tr("výchozí")} ${def}${range}${opts}${flags}. ${row.hint}`;
}
/** ukázkový řádek druhu z výchozích hodnot povinných řádků */
function example(def: AnyKind, lang: Lang): string {
  const d = def.defaults();
  const parts = [HEAD_WORD[lang], kindWord(def, lang)];
  for (const key of def.positional ?? []) parts.push(String(d[key]));
  for (const r of def.rows) if (r.required && !(def.positional ?? []).includes(r.key) && (r.kind === "number" || r.kind === "int")) parts.push(r.words[lang][0], String(d[r.key]).replace(".", lang === "en" ? "." : ","));
  return parts.join(" ");
}
function pairExample(kind: PairKind, lang: Lang): string {
  const parts = [PAIR_HEAD_WORD[lang], kindWord(KINDS[kind], lang)];
  for (const r of PAIR_ROWS[kind]) if (r.required && (r.kind === "number" || r.kind === "int")) parts.push(r.words[lang][0], String(r.def).replace(".", lang === "en" ? "." : ","));
  return parts.join(" ");
}

/** `kolo nápověda [druh]` – přehled druhů, nebo tabulka jednoho druhu (slova, jednotky, výchozí hodnoty, rozsahy, nápověda) */
export function gearHelp(word?: string, pair = false): string[] {
  const lang = curLang();
  if (!word) {
    return [
      tr("Kola a ozubení – jedna tabulka na druh (stejná jako průvodce „Kola a ozubení“ a obecný příkaz prvek gear.*):"),
      ...GEAR_KINDS.map((k) => `  ${HEAD_WORD[lang]} ${kindWord(KINDS[k], lang)} – ${KINDS[k].label} (${KINDS[k].ext}; ${KINDS[k].standards.join(", ")})`),
      tr("Soukolí (dva díly + sestava s vazbou): {0} <druh> …; druhy: {1}", PAIR_HEAD_WORD[lang], pairKindList(lang)),
      tr("Tabulka ozubení: {0} {1} [vše | \"název\"] · popis druhu: {0} {2} <druh> · soukolí: {3} {2} <druh>", HEAD_WORD[lang], TABLE_WORD[lang], HELP_WORD[lang], PAIR_HEAD_WORD[lang]),
    ];
  }
  if (pair) {
    const kind = pairKindByWord(word);
    if (!kind) throw new Error(tr("soukolí: neznámý druh „{0}“ – druhy: {1}", word, pairKindList(lang)));
    return [tr("Soukolí – {0}: řádky tabulky (slovo, význam, výchozí hodnota):", KINDS[kind].label), ...PAIR_ROWS[kind].map((r) => rowHelp(r, lang)), tr("Příklad: {0}", pairExample(kind, lang))];
  }
  const def = kindByWord(word);
  if (!def) throw new Error(tr("kolo: neznámý druh „{0}“ – druhy: {1}", word, kindList(lang)));
  const phr = def.phrases.map((p) => `  ${p.words[lang][0]} ${p.keys.join(" ")}${p.flags?.length ? ` [${p.flags.map((f) => f.words[lang][0]).join(" | ")}]` : ""}`);
  return [
    `${def.label} – ${HEAD_WORD[lang]} ${def.words[lang].join(" | ")} (${def.ext}; ${def.standards.join(", ")})`,
    `  ${def.accuracy}`,
    tr("Řádky tabulky (slovo, význam, výchozí hodnota, rozsah):"),
    ...def.rows.map((r) => rowHelp(r, lang)),
    ...(phr.length ? [tr("Složené zápisy:"), ...phr] : []),
    ...(def.positional?.length ? [tr("Volné slovo za druhem: {0}", def.positional.join(", "))] : []),
    tr("Příklad: {0}", example(def, lang)),
  ];
}

/** prvek kola z přečtených slov (data = výchozí hodnoty druhu + zadané) */
export function gearFeature(def: AnyKind, r: Read): { feature: Feature; note?: string } {
  const data: GearData = { ...def.defaults(), ...r.data };
  // „zuby“ = zuby vyříznuté do aktivního tělesa – operace Odebrat (jádro ji vnutí; data ať odpovídají)
  if (r.data.out === "teeth" && !r.set.has("mode")) data.mode = "cut";
  const lang = curLang();
  const missing = def.rows.filter((row) => row.required && !r.set.has(row.key) && row.kind !== "point").map((row) => `${row.words[lang][0]} ${typeof data[row.key] === "number" ? String(data[row.key]).replace(".", lang === "en" ? "." : ",") : String(data[row.key])}`);
  let name = r.name;
  if (!name) {
    try {
      name = def.name(def.read(data));
    } catch {
      name = def.label;
    }
  }
  // operace „nové těleso“ (výchozí): v dílu, který už těleso má, vznikne další těleso „Těleso N“ (jako v průvodci);
  // `přidat` = sloučit s aktivním tělesem, `odebrat` / `zuby` = odebrat z něj
  const body = data.mode === "new" && data.out !== "teeth" ? { body: "$new" } : {};
  const feature = { id: uid(), name, type: "ext", ext: def.ext, data, ...body } as unknown as Feature;
  return { feature, ...(missing.length ? { note: tr("nezadáno, použita výchozí hodnota: {0}", missing.join(", ")) } : {}) };
}

/**
 * Přečte řádek `kolo …` / `soukolí …` (EN `gear …`, DE `rad …`); null = jiný příkaz. Operace jsou existující:
 * feature, info, api (akce gear.table), new / insert / asm (soukolí přes `pairScript`).
 */
export function parseGearLine(line: string, no: number, ctx: GearParseCtx): AgentOp[] | null {
  const tk = tokens(line);
  if (!tk.length || tk[0].q) return null;
  const h = fold(tk[0].t);
  let pair = PAIR_HEAD.has(h);
  let rest = tk.slice(1);
  if (!pair && !HEAD.has(h)) return null;
  if (!pair && rest[0] && !rest[0].q && PAIR_WORD.has(fold(rest[0].t))) {
    pair = true;
    rest = rest.slice(1);
  }
  const lang = curLang();
  const head = pair ? PAIR_HEAD_WORD[lang] : HEAD_WORD[lang];
  if (!rest.length)
    throw new Error(
      pair
        ? tr("{0} potřebuje druh: {0} <druh> m 2 z1 20 z2 60 [a 81] – druhy: {1}; popis: {0} {2} <druh>", head, pairKindList(lang), HELP_WORD[lang])
        : tr("{0} potřebuje druh: {0} <druh> … – druhy: {1}; také {0} {2}, {0} {3} [druh]", head, kindList(lang), TABLE_WORD[lang], HELP_WORD[lang]),
    );
  const w0 = fold(rest[0].t);
  if (HELP.has(w0)) {
    if (rest.length > 2) throw new Error(tr("{0} {1} [druh] – jen jeden druh", head, HELP_WORD[lang]));
    return [{ k: "info", lines: gearHelp(rest[1]?.t, pair), line: no }];
  }
  if (!pair && TABLE.has(w0)) {
    const a = rest[1];
    if (rest.length > 2) throw new Error(tr("{0} {1} [vše | \"název\"] – nic dalšího", head, TABLE_WORD[lang]));
    const arg = !a ? "" : !a.q && ALL.has(fold(a.t)) ? "*" : a.t;
    return [{ k: "api", cmd: { kind: "action", id: "gear.table", arg }, line: no }];
  }
  if (pair) return parsePair(rest, no, ctx, head);
  const def = kindByWord(rest[0].t);
  if (!def) throw new Error(tr("{0}: neznámý druh „{1}“ – druhy: {2} (popis: {0} {3})", head, rest[0].t, kindList(lang), HELP_WORD[lang]));
  const label = `${head} ${kindWord(def, lang)}`;
  const r = readWords(kindGrammar(def), rest.slice(1), label, `${head} ${HELP_WORD[lang]} ${kindWord(def, lang)}`);
  const { feature, note } = gearFeature(def, r);
  return [{ k: "feature", feature, line: no, ...(note ? { note } : {}) }];
}

/** `soukolí <druh> …` → existující příkazy (pairScript) + souhrn soukolí do protokolu */
function parsePair(rest: Tok[], no: number, ctx: GearParseCtx, head: string): AgentOp[] {
  const lang = curLang();
  const kind = pairKindByWord(rest[0].t);
  if (!kind) throw new Error(tr("{0}: neznámý druh „{1}“ – druhy: {2}", head, rest[0].t, pairKindList(lang)));
  const label = `${head} ${kindWord(KINDS[kind], lang)}`;
  const r = readWords(pairGrammar(kind), rest.slice(1), label, `${head} ${HELP_WORD[lang]} ${kindWord(KINDS[kind], lang)}`);
  const res = solvePair({ kind, values: r.data });
  const errs = res.issues.filter((x) => x.level === "error");
  if (!res.ok || errs.length) throw new Error(`${label}: ${errs.map((x) => x.text).join(" ") || tr("soukolí se nepodařilo vyřešit")}`);
  if (r.name) res.asmName = r.name;
  const script = pairScript(res, lang);
  const prog = ctx.sub(script.join("\n"));
  if (prog.errors.length) throw new Error(`${label}: ${prog.errors[0].message}`);
  const ops: AgentOp[] = prog.ops.map((op) => ({ ...op, line: no }) as AgentOp);
  const info = [
    tr("Soukolí „{0}“: {1}", res.asmName, res.rows.map((x) => `${x.symbol ?? x.label} ${x.value}${x.unit ? ` ${x.unit}` : ""}`).join(" · ")),
    ...res.wheels.map((w, k) => `  ${k + 1}: ${w.name} – ${gearLine(w.ext, w.data)}`),
    ...res.issues.filter((x) => x.level !== "error").map((x) => `  ${x.level === "warn" ? "⚠" : "ℹ"} ${x.text}`),
  ];
  if (!script.some((s) => /^sestava vazba/.test(s))) info.push(tr("  ⚠ sestava vznikla bez vazby ozubení – spojte kola vazbou ručně (sestava vazba ozubení …)"));
  ops.push({ k: "info", lines: info, line: no });
  return ops;
}
/** souhrn kola jedním řádkem (jako `stav`) */
function gearLine(ext: string, data: GearData): string {
  const def = kindOfExt(ext);
  if (!def) return ext;
  try {
    const i = def.read({ ...def.defaults(), ...data });
    return def.summary(i, def.compute(i));
  } catch {
    return def.short;
  }
}

export { gearTableReport } from "./agent-gears-table";

/* ───────────────────────── dokument → skript ───────────────────────── */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/**
 * Vlastní příkaz `kolo …` pro prvek kola (bez názvu – ten doplní volající), slova jazyka skriptu `lang`, čísla zápisem `n`.
 * Prázdné pole = kolo vlastním příkazem zapsat nejde (odkaz na bod, směr odkazem, klíč mimo tabulku) → volající použije
 * obecný `prvek gear.*`. Volající řádek ověří zpětným rozborem (doc-script `verify`).
 */
export function gearScriptLines(f: Feature, lang: Lang, n: (v: number) => string): string[] {
  if (f.type !== "ext") return [];
  const def = kindOfExt(f.ext);
  if (!def || !getExt(f.ext)) return [];
  const data = (f.data ?? {}) as GearData;
  const base = def.defaults();
  const rows = new Map(def.rows.map((r) => [r.key, r]));
  for (const k of Object.keys(data)) if (!rows.has(k) && data[k] !== undefined) return [];
  for (const k of Object.keys(base)) if (!(k in data)) return [];
  // povinné řádky (m, z, řetěz…) se píšou vždy – skript se čte jako tabulka; ostatní jen odlišné od výchozích
  const diff = (k: string) => data[k] !== undefined && (!same(data[k], base[k]) || !!rows.get(k)?.required);
  const doneKeys = new Set<string>();
  const parts: string[] = [HEAD_WORD[lang], kindWord(def, lang)];
  const word = (r: GearRow) => {
    const w = r.words[lang][0];
    return /\s/.test(w) ? null : w;
  };
  // volné slovo (řetěz, profil řemene) – číselné názvy (ANSI 40) se slovem řádku
  for (const key of def.positional ?? []) {
    if (!diff(key)) continue;
    const v = String(data[key]);
    const r = rows.get(key)!;
    if (/^\d+$/.test(v) || /\s/.test(v)) parts.push(r.words[lang][0], v);
    else parts.push(v);
    doneKeys.add(key);
  }
  // složené zápisy na místě prvního klíče: díra 20 · náboj 40 15 · díry 6 12 80 (čísla až po poslední odlišný klíč)
  const phraseAt = new Map<string, string[]>();
  for (const ph of def.phrases) {
    const last = ph.keys.reduce((acc, k, idx) => (diff(k) ? idx : acc), -1);
    if (last < 0 || ph.keys.slice(0, last + 1).some((k) => typeof data[k] !== "number")) continue;
    phraseAt.set(ph.keys[0], [ph.words[lang][0], ...ph.keys.slice(0, last + 1).map((k) => n(data[k] as number))]);
    for (const k of ph.keys.slice(1, last + 1)) doneKeys.add(k);
  }
  // výstup před operací: „zuby“ nastaví i operaci Odebrat
  const order = [...def.rows].sort((a, b) => (a.key === "mode" ? 1 : 0) - (b.key === "mode" ? 1 : 0));
  const teethForced = data.out === "teeth";
  for (const r of order) {
    if (doneKeys.has(r.key)) continue;
    const ph = phraseAt.get(r.key);
    if (ph) {
      parts.push(...ph);
      continue;
    }
    const v = data[r.key];
    if (r.key === "mode" && teethForced) {
      if (v === "cut") continue;
    } else if (!diff(r.key)) continue;
    const w = word(r);
    switch (r.kind) {
      case "number":
      case "int":
        if (typeof v !== "number" || !w) return [];
        parts.push(w, n(v));
        break;
      case "bool":
        if (typeof v !== "boolean" || !w) return [];
        parts.push(...(v ? [w] : [w, NO_WORD[lang]]));
        break;
      case "enum":
      case "mode": {
        if (typeof v !== "string") return [];
        const ew = r.enumWords?.[v]?.[lang]?.[0];
        if (ew) parts.push(ew);
        else if (w && /^[\p{L}\p{N}_.+-]+$/u.test(v)) parts.push(w, v);
        else return [];
        break;
      }
      case "vec3":
        if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === "number") || !w) return [];
        parts.push(w, ...(v as number[]).map(n));
        break;
      case "direction": {
        const d = v as { kind?: string; axis?: string; v?: number[] } | null;
        if (!w || !d) return [];
        if (d.kind === "axis" && d.axis) parts.push(w, d.axis);
        else if (d.kind === "vector" && Array.isArray(d.v) && d.v.length === 3) parts.push(w, ...d.v.map(n));
        else return [];
        break;
      }
      default:
        // odkaz na bod (positionRef) a text vlastním příkazem nezapíšeme
        return [];
    }
  }
  return [parts.join(" ")];
}
/** automatický název prvku z příkazu `kolo …` (dokument → skript: řádek bez `název`, když ho kolo má) */
export function gearAutoName(f: Feature): string | null {
  if (f.type !== "ext") return null;
  const def = kindOfExt(f.ext);
  if (!def) return null;
  try {
    return def.name(def.read({ ...def.defaults(), ...(f.data ?? {}) }));
  } catch {
    return null;
  }
}

/** Řádky nápovědy příkazů (AGENT_COMMANDS). */
export const GEAR_COMMANDS: { cmd: string; en: string; de: string; desc: string }[] = [
  {
    cmd: "kolo čelní m 2 z 24 b 20 [x 0,2] [úhel 20] [díra 20 pero] [náboj 40 15 [obě strany]] [díry 6 12] [polotovar | zuby] [v x y z] [osa X]",
    en: "gear spur m 2 z 24 b 20 [x 0.2] [angle 20] [bore 20 keyway] [hub 40 15 [both sides]] [blank | toothcut] [at x y z] [axis X]",
    de: "rad stirnrad m 2 z 24 b 20 [x 0,2] [winkel 20] [bohrung 20 nut] [nabe 40 15 [beide seiten]] [rohling] [bei x y z] [achse X]",
    desc: tr("ozubené kolo z tabulky (jeden prvek „Ozubené kolo …“, úprava = stejná tabulka): čelní, šikmé (beta 15 pravé|levé), šípové, vnitřní, hřeben, kuželové, hypoidní, šnek, šnekové, cykloidní, cyklodisk, řetězové, řemenice, rohatka; polotovar = jen soustružené tělo, zuby = zubové mezery do aktivního tělesa; slova řádků: kolo nápověda <druh>"),
  },
  {
    cmd: "kolo šikmé m 2 z 30 beta 15 pravé · kolo hřeben m 2 z 40 b 20 h 20 · kolo řetězové 08B z 19 [řady 2] · kolo cykloidní m 1 z 60 protikolo 8 · kolo hypoidní z1 11 z2 41 de2 200 e 25",
    en: "gear helical m 2 z 30 beta 15 right · gear rack m 2 z 40 b 20 h 20 · gear sprocket 08B z 19 [strands 2] · gear cycloidal … · gear hypoid …",
    de: "rad schräg m 2 z 30 beta 15 rechts · rad zahnstange m 2 z 40 b 20 h 20 · rad kettenrad 08B z 19 [reihen 2] · rad zykloid … · rad hypoid …",
    desc: tr("další druhy: šikmé kolo (β, smysl stoupání), hřeben (lineární ozubení, h = výška celkem), řetězové kolo ISO 606 (08B…24B, ANSI 35–80, 1–3 řady, náboj B/C), cykloidní (hodinové kolo / pastorek), hypoidní (člen pastorek | talířové, přesazení E; tvar zubů je přibližný)"),
  },
  {
    cmd: "soukolí čelní m 2 z1 20 z2 60 [a 81] [x1 0,3] [x2 0,2] [vůle 0,05] [b 20] [díra1 12] [díra2 20] [název \"…\"]",
    en: "gearpair spur m 2 z1 20 z2 60 [a 81] [x1 0.3] [x2 0.2] [backlash 0.05] [b 20] [bore1 12] [bore2 20]",
    de: "radpaar stirnrad m 2 z1 20 z2 60 [a 81] [x1 0,3] [x2 0,2] [spiel 0,05] [b 20] [bohrung1 12] [bohrung2 20]",
    desc: tr("soukolí: oba díly s koly, nová sestava, vložení ve správném záběru a vazba ozubení / hřeben; zadaná osová vzdálenost a → posunutí x1/x2 se dopočítá a rozdělí (DIN 3992); protokol vypíše převod, a_w, ε_α a varování (podřezání, špičatý zub, interference); druhy: čelní, šikmé, šípové, vnitřní, hřeben, kuželové, hypoidní, šnek, cykloidní, cyklodisk, řetězové, řemenice"),
  },
  {
    cmd: "kolo tabulka [vše | \"název\"] · kolo nápověda [druh] · soukolí nápověda <druh>",
    en: "gear table [all | \"name\"] · gear help [kind] · gearpair help <kind>",
    de: "rad tabelle [alle | \"name\"] · rad hilfe [art] · radpaar hilfe <art>",
    desc: tr("tabulka ozubení posledního (všech / pojmenovaného) kola aktivního dílu: modul, z, α, β, x, průměry d / dₐ / d_f / d_b, rozměr přes zuby W_k, přes kuličky M_dK, osová vzdálenost; nápověda = řádky tabulky druhu se slovy, jednotkami, výchozími hodnotami a příkladem; na výkres: výkres tabulka ozubení ano"),
  },
];
