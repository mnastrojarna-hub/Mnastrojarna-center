/**
 * Textové příkazy pružin z tabulky (CS / EN / DE) – čte je agent.ts před primitivy; výsledek je běžný prvek historie
 * (op „feature“ s prvkem `spring.<druh>`), text nápovědy (op „info“) nebo akce `spring.table` (op „api“) – žádný nový případ
 * ve smyčce příkazů.
 *
 *   pružina tlačná d 2 De 20 L0 50 n 8 [konce broušené|přiložené|otevřené] [materiál SH|DH|VDSiCr|1.4310] [L1 40] [L2 30]
 *                  [F1 …] [F2 …] [uložení 0,5] [levé] [v x y z] [osa X|-Z|x y z] [tvar 35] [přidat|odebrat|nové] [název "…"]
 *   pružina tažná d 1,6 De 12 n 12 F0 5 [očka německé|poloviční|boční] [očko2 …] [natočení 90] [L1 …] [L2 …]
 *   pružina zkrutná d 2 De 20 n 6,25 [ramena tečná|radiální|osová] [ramena 25] [rameno1 … l1 …] [a2 60 | M2 450]
 *   pružina talířová řada A De 40 [sloupec 4 2 | ns 4 np 2] [L2 19,2]
 *   pružina tabulka ["Název"|vše]    spočtené údaje poslední pružiny dílu / pojmenované / všech
 *   pružina nápověda [druh]          řádky tabulky se slovy a normou
 *   EN: spring compression|extension|torsion|disc … · DE: feder druck|zug|dreh|teller … (i druckfeder, zugfeder…)
 * Starý zápis `pružina D stoupání P závity N drát d` (prvek Pružina se stálým stoupáním) zůstává – čte ho agent-prim.ts
 * (druhé slovo není druh pružiny ani tabulka / nápověda → tento modul vrátí null).
 */
import { tr } from "./i18n";
import { KINDS, springCalc, springTableText, springTablesOf, type Lang, type SpringData, type SpringKind, type SpringRow } from "./springs";
import { uid, type CadDoc, type Feature, type Vec3 } from "./types";

export type SpringOp =
  | { k: "feature"; feature: Feature; line: number; note?: string }
  | { k: "info"; lines: string[]; line: number }
  /** `arg` = název pružiny z textu (prázdný = poslední pružina, ALL_SPRINGS = všechny) – nese ho operace, ne stav modulu */
  | { k: "api"; cmd: { kind: "action"; id: string; arg: string }; line: number };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const set = (...w: string[]) => new Set(w.map(fold));
const HEAD = set("pružina", "pruzina", "pružinu", "pružiny", "spring", "springs", "feder", "federn");
/** jednoslovné německé druhy: druckfeder d 2 … */
const ONE_WORD: Record<string, SpringKind> = { druckfeder: "compression", zugfeder: "extension", drehfeder: "torsion", schenkelfeder: "torsion", tellerfeder: "disc" };
const TABLE = set("tabulka", "tabulku", "table", "tabelle", "data", "údaje", "udaje");
const ALL = set("vše", "vse", "všechny", "vsechny", "all", "alle");
/** `pružina tabulka vše` – údaje všech pružin dílu */
export const ALL_SPRINGS = "*";
const HELP = set("nápověda", "napoveda", "help", "hilfe", "?");
const AT = set("v", "na", "at", "bei", "poloha", "position");
const AXIS = set("osa", "axis", "achse", "směr", "smer", "direction", "richtung");
const NAME = set("název", "nazev", "name", "jmeno", "jméno");
const SHAPE = set("tvar", "shape", "form", "stlačená", "stlacena", "compressed", "gestaucht");
const STACK = set("sloupec", "stack", "säule", "saeule", "saule");
const LEGS = set("ramena", "legs", "schenkel");
const MODE: Record<string, string> = { přidat: "add", pridat: "add", add: "add", hinzufugen: "add", odebrat: "cut", cut: "cut", subtract: "cut", abziehen: "cut", průnik: "intersect", prunik: "intersect", intersect: "intersect", schnitt: "intersect", nové: "new", nove: "new", new: "new", neu: "new" };
const NUM = /^[+-]?(\d+[.,]?\d*|[.,]\d+)(mm|°|n)?$/i;
const num = (t: string) => parseFloat(t.replace(",", ".").replace(/(mm|°|n)$/i, ""));
const isNum = (t: string | undefined) => t !== undefined && NUM.test(t);

function tokens(line: string): { t: string; q: boolean }[] {
  const out: { t: string; q: boolean }[] = [];
  const re = /"([^"]*)"|„([^“]*)“|([^\s"„]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] != null || m[2] != null ? { t: m[1] ?? m[2], q: true } : { t: m[3], q: false });
  return out;
}

const kindOfWord = (w: string): SpringKind | null => {
  const f = fold(w);
  for (const k of Object.values(KINDS)) for (const l of ["cs", "en", "de"] as Lang[]) if (k.words[l].some((x) => fold(x) === f)) return k.kind;
  return null;
};

/** slovo → řádek tabulky druhu: nejdřív přesně (d ≠ D), pak bez diakritiky a velikosti písmen (jen jednoznačně) */
function rowOf(rows: SpringRow[], w: string): SpringRow | null {
  const exact = rows.filter((r) => (["cs", "en", "de"] as Lang[]).some((l) => r.words[l].includes(w)));
  if (exact.length) return exact[0];
  const f = fold(w);
  const loose = rows.filter((r) => (["cs", "en", "de"] as Lang[]).some((l) => r.words[l].some((x) => fold(x) === f && !(x.length === 1 && x !== w))));
  return loose.length === 1 ? loose[0] : null;
}
/** slovo hodnoty výčtu (broušené, SH, levé…) → [řádek, hodnota] */
function enumOf(rows: SpringRow[], w: string, only?: SpringRow): [SpringRow, string] | null {
  const f = fold(w);
  const hits: [SpringRow, string][] = [];
  for (const r of only ? [only] : rows) {
    if (r.kind !== "enum") continue;
    for (const o of r.options ?? []) if (fold(o.v) === f || fold(o.v.replace(".", ",")) === f) hits.push([r, o.v]);
    for (const [v, ws] of Object.entries(r.enumWords ?? {})) if ((["cs", "en", "de"] as Lang[]).some((l) => ws[l].some((x) => fold(x) === f))) hits.push([r, v]);
  }
  const uniq = hits.filter((h, i) => hits.findIndex((x) => x[0].key === h[0].key && x[1] === h[1]) === i);
  return uniq.length === 1 || (only && uniq.length) ? uniq[0] : null;
}

/**
 * Řádky akce spring.table pro dokument: `name` = pojmenovaná pružina, "" = poslední pružina v historii,
 * ALL_SPRINGS = všechny pružiny dílu. Název nese operace z rozboru (`arg` akce), ne stav modulu – paleta Ctrl+K rozebírá
 * text při každém stisku klávesy a nesmí nic ovlivnit.
 */
export function springTableLines(doc: CadDoc, name = ""): string[] {
  const all = springTablesOf(doc);
  if (!all.length) return [tr("V dílu není žádná pružina z tabulky (pružina tlačná | tažná | zkrutná | talířová …).")];
  const pick = name === ALL_SPRINGS ? all : name ? all.filter((t) => fold(t.name) === fold(name)) : all.slice(-1);
  if (!pick.length) throw new Error(tr("pružina „{0}“ v dílu není – pružiny: {1}", name, all.map((t) => t.name).join(", ")));
  const f = (id: string) => doc.features.find((x) => x.id === id) as Extract<Feature, { type: "ext" }>;
  return pick.flatMap((t) => springTableText(t.name, t.ext, f(t.featureId).data ?? {}));
}

/** text nápovědy `pružina nápověda [druh]` */
export function springHelpLines(kind?: SpringKind): string[] {
  const out: string[] = [];
  const kinds = kind ? [KINDS[kind]] : Object.values(KINDS);
  for (const k of kinds) {
    out.push(`${k.label()} (${k.standard}) – ${tr("pružina")} ${k.words.cs[0]} | spring ${k.words.en[0]} | feder ${k.words.de[0].replace(/feder$/, "")}`);
    for (const r of k.rows()) {
      const words = [...new Set([...r.words.cs, ...r.words.en, ...r.words.de])].slice(0, 5).join("|");
      const opts = r.kind === "enum" ? ` ∈ ${(r.options ?? []).map((o) => (r.enumWords?.[o.v]?.cs[0] ?? o.v)).join(" | ")}` : r.unit ? ` [${r.unit}]` : "";
      out.push(`  ${words}${opts}${r.required ? ` *` : ""} – ${r.label}: ${r.hint}`);
    }
  }
  out.push(tr("  * povinné (z alternativ D | De | Di a n | nt stačí jedna); dále: v x y z · osa X|Y|Z|-Z · tvar L · přidat|odebrat|nové · název \"…\""));
  out.push(tr("  pružina tabulka [\"Název\"|vše] – spočtené údaje poslední / pojmenované / všech pružin dílu"));
  return out;
}

/** Přečte řádek pružiny; null = jiný příkaz (i starý zápis pružina D stoupání …). Chyba = hláška k řádku. */
export function parseSpringLine(line: string, no: number, named: (label: string) => string): SpringOp | null {
  const tk = tokens(line.trim());
  if (!tk.length || tk[0].q) return null;
  const h = fold(tk[0].t);
  let kind: SpringKind | null = null;
  let i = 1;
  if (ONE_WORD[h]) {
    // druckfeder 20 steigung … = starý zápis; druckfeder d 2 … = tabulka
    if (isNum(tk[1]?.t)) return null;
    kind = ONE_WORD[h];
  } else {
    if (!HEAD.has(h)) return null;
    const w1 = tk[1]?.t ?? "";
    if (TABLE.has(fold(w1))) {
      const rest = tk.slice(2);
      const nm = rest.length === 1 && !rest[0].q && ALL.has(fold(rest[0].t)) ? ALL_SPRINGS : rest.map((x) => x.t).join(" ").trim();
      return { k: "api", cmd: { kind: "action", id: "spring.table", arg: nm }, line: no };
    }
    if (HELP.has(fold(w1))) return { k: "info", lines: springHelpLines(kindOfWord(tk[2]?.t ?? "") ?? undefined), line: no };
    kind = kindOfWord(w1);
    // německy „feder druck …“
    if (!kind && fold(w1) in { druck: 1, zug: 1, dreh: 1, teller: 1 }) kind = ({ druck: "compression", zug: "extension", dreh: "torsion", teller: "disc" } as const)[fold(w1) as "druck"];
    if (!kind) return null; // starý zápis (agent-prim.ts)
    i = 2;
  }
  const k = KINDS[kind];
  const rows = k.rows();
  // výchozí hodnoty jen u výčtů a řádků s výchozí hodnotou – povinná čísla musí zaznít (chybějící = hláška u řádku)
  const data: SpringData = {};
  for (const r of rows) if (r.def !== undefined) data[r.key] = r.def;
  data.at = [0, 0, 0];
  data.axis = "Z";
  data.mode = "new";
  let name: string | undefined;
  const given = new Set<string>();
  const usage = tr("zápis: pružina nápověda {0}", k.words.cs[0]);
  const nextNum = (label: string): number => {
    const t = tk[i]?.t;
    if (!isNum(t)) throw new Error(tr("pružina: za „{0}“ chybí číslo – {1}", label, usage));
    i++;
    return num(t!);
  };
  while (i < tk.length) {
    const { t, q } = tk[i];
    const f = fold(t);
    if (q) throw new Error(tr("pružina: text „{0}“ bez klíčového slova – název \"…\"", t));
    if (NAME.has(f)) {
      if (!tk[i + 1]) throw new Error(tr("pružina: za „název“ chybí text"));
      name = tk[i + 1].t;
      i += 2;
      continue;
    }
    if (MODE[f]) {
      data.mode = MODE[f];
      i++;
      continue;
    }
    if (AT.has(f) && isNum(tk[i + 1]?.t)) {
      i++;
      const v: number[] = [];
      while (v.length < 3 && isNum(tk[i]?.t)) v.push(nextNum(t));
      if (v.length < 3) throw new Error(tr("pružina: poloha potřebuje tři čísla – v x y z"));
      data.at = v as Vec3;
      continue;
    }
    if (AXIS.has(f)) {
      i++;
      const a = tk[i]?.t ?? "";
      if (/^[+-−]?[xyz]$/i.test(a)) {
        data.axis = a.replace("+", "").replace("−", "-").toUpperCase();
        i++;
      } else if (isNum(a)) {
        const v = [nextNum(t), nextNum(t), nextNum(t)] as Vec3;
        data.axis = { kind: "vector", v };
      } else throw new Error(tr("pružina: osa X | Y | Z | -Z nebo vektor x y z"));
      continue;
    }
    if (SHAPE.has(f)) {
      i++;
      data.len = nextNum(t);
      continue;
    }
    if (kind === "disc" && STACK.has(f)) {
      i++;
      data.ns = nextNum(t);
      if (isNum(tk[i]?.t)) data.np = nextNum(t);
      given.add("ns");
      continue;
    }
    if (kind === "torsion" && LEGS.has(f)) {
      i++;
      if (isNum(tk[i]?.t)) {
        const l = nextNum(t);
        data.l1 = l;
        data.l2 = l;
      } else {
        const e = enumOf(rows, tk[i]?.t ?? "", rows.find((r) => r.key === "leg1"));
        if (!e) throw new Error(tr("pružina: ramena tečná | radiální | osová nebo délka ramen"));
        data.leg1 = e[1];
        data.leg2 = e[1];
        i++;
      }
      continue;
    }
    const r = rowOf(rows, t);
    if (r) {
      i++;
      if (r.kind === "number") {
        data[r.key] = nextNum(t);
        // alternativy: poslední zadaná platí (D | De | Di, n | nt, L1 | F1 …)
        if (r.alt) for (const o of rows) if (o.alt === r.alt && o.key !== r.key) delete data[o.key];
      } else if (r.kind === "enum") {
        const e = enumOf(rows, tk[i]?.t ?? "", r);
        if (!e) throw new Error(tr("pružina: „{0}“ – hodnota {1}", t, (r.options ?? []).map((o) => r.enumWords?.[o.v]?.cs[0] ?? o.v).join(" | ")));
        data[r.key] = e[1];
        i++;
      }
      given.add(r.key);
      continue;
    }
    const e = enumOf(rows, t);
    if (e) {
      data[e[0].key] = e[1];
      given.add(e[0].key);
      i++;
      continue;
    }
    throw new Error(tr("pružina {0}: neznámé slovo „{1}“ – {2}", k.words.cs[0], t, usage));
  }
  // tažná: jen první očko → stejné i druhé
  if (kind === "extension" && given.has("loop") && !given.has("loop2")) data.loop2 = data.loop;
  const c = springCalc(kind, data);
  const err = c.issues.find((x) => x.level === "error");
  if (err) throw new Error(`${k.label()}: ${err.text}`);
  const warn = c.issues.filter((x) => x.level === "warn").map((x) => `⚠ ${x.text}`);
  const feature = { id: uid(), name: name ?? named(k.label()), type: "ext", ext: k.ext, data } as unknown as Feature;
  return { k: "feature", feature, line: no, note: [c.summary, ...warn].join(" · ") };
}

const nfmt = (v: number) => String(Math.round(v * 1e6) / 1e6);
/**
 * Řádek skriptu pro prvek pružiny (převodník dokument → skript): kanonická slova jazyka `lang`, všechna čísla tabulky,
 * výčty jen odlišné od výchozích, umístění. null = prvek není pružina z tabulky nebo má pole, které text neumí (odkaz).
 */
export function springScriptLine(f: Feature, lang: Lang): string | null {
  if (f.type !== "ext") return null;
  const k = Object.values(KINDS).find((x) => x.ext === f.ext);
  if (!k) return null;
  const d = (f.data ?? {}) as SpringData;
  const rows = k.rows();
  const known = new Set([...rows.map((r) => r.key), "at", "axis", "mode", "len"]);
  for (const key of Object.keys(d)) if (!known.has(key) && d[key] !== undefined) return null;
  // výčty a výchozí umístění musí být v datech (rozbor je doplní) – jinak by řádek dal jiná data
  for (const r of rows) if (r.def !== undefined && d[r.key] === undefined) return null;
  if (d.at === undefined || d.axis === undefined || d.mode === undefined) return null;
  const head = lang === "en" ? `spring ${k.words.en[0]}` : lang === "de" ? `feder ${({ compression: "druck", extension: "zug", torsion: "dreh", disc: "teller" } as const)[k.kind]}` : `pružina ${k.words.cs[0]}`;
  const parts: string[] = [head];
  for (const r of rows) {
    const v = d[r.key];
    if (v === undefined) continue;
    const w = r.words[lang][0];
    if (r.kind === "number") {
      if (typeof v !== "number") return null;
      parts.push(`${w} ${nfmt(v)}`);
    } else if (r.kind === "enum") {
      // druhé očko: rozbor ho bez zadání nastaví stejné jako první
      if (r.key === "loop2" ? v === d.loop : r.def !== undefined && v === r.def) continue;
      const ew = r.enumWords?.[String(v)]?.[lang][0] ?? String(v);
      parts.push(`${w} ${ew}`);
    }
  }
  const at = d.at as number[];
  if (!Array.isArray(at) || at.length !== 3 || !at.every((x) => typeof x === "number")) return null;
  if (at.some((x) => x !== 0)) parts.push(`${lang === "en" ? "at" : lang === "de" ? "bei" : "v"} ${at.map(nfmt).join(" ")}`);
  const ax = d.axis;
  const axw = lang === "en" ? "axis" : lang === "de" ? "achse" : "osa";
  if (typeof ax === "string") {
    if (!/^-?[XYZ]$/.test(ax)) return null;
    if (ax !== "Z") parts.push(`${axw} ${ax}`);
  } else if (ax && typeof ax === "object" && (ax as { kind?: string }).kind === "vector" && Array.isArray((ax as { v?: number[] }).v)) parts.push(`${axw} ${(ax as { v: number[] }).v.map(nfmt).join(" ")}`);
  else return null;
  if (d.len !== undefined) {
    if (typeof d.len !== "number") return null;
    parts.push(`${lang === "en" ? "shape" : lang === "de" ? "form" : "tvar"} ${nfmt(d.len)}`);
  }
  const mode = String(d.mode);
  if (mode !== "new") parts.push(lang === "en" ? mode : lang === "de" ? ({ add: "hinzufügen", cut: "abziehen", intersect: "schnitt" } as Record<string, string>)[mode] : ({ add: "přidat", cut: "odebrat", intersect: "průnik" } as Record<string, string>)[mode]);
  return parts.join(" ");
}

/** řádky AGENT_COMMANDS (nápověda příkazů, `window.mncad.commands()`) */
export const SPRING_COMMANDS: { cmd: string; en: string; de: string; desc: string }[] = [
  {
    cmd: "pružina tlačná d 2 De 20 L0 50 n 8 [konce broušené|přiložené|otevřené] [materiál SH|DH|VDSiCr|1.4310] [L1 40] [L2 30] [uložení 0,5] [v x y z] [osa X|-Z] [tvar 35]",
    en: "spring compression d 2 De 20 L0 50 n 8 [ends ground|closed|open] [material SH] [L1 40] [L2 30] [at x y z] [axis X]",
    de: "feder druck d 2 De 20 L0 50 n 8 [enden geschliffen|angelegt|offen] [werkstoff SH] [L1 40] [L2 30] [bei x y z] [achse X]",
    desc: tr("tlačná pružina podle EN 13906-1 z tabulky: tuhost, Ln, Sa, síly a napětí při L1 / L2, vzpěr, frekvence, hmotnost; tvar s přiloženými a broušenými konci (rovné dosedací plochy v 0 a L0), Ø = De; varování česky ve stavu prvku"),
  },
  {
    cmd: "pružina tažná d 1,6 De 12 n 12 F0 5 [očka německé|poloviční|boční] [natočení 90] [L2 50]",
    en: "spring extension d 1.6 De 12 n 12 F0 5 [loop german|half|side] [angle 90] [L2 50]",
    de: "feder zug d 1,6 De 12 n 12 F0 5 [öse deutsche|halbe|seitlich] [versatz 90] [L2 50]",
    desc: tr("tažná pružina podle EN 13906-2: tělo s předpětím F0, očka (vnitřní okraje oček v 0 a L0), tuhost, síly, největší délka Ln"),
  },
  {
    cmd: "pružina zkrutná d 2 De 20 n 6,25 [ramena tečná|radiální|osová] [ramena 25] [a2 60 | M2 450]",
    en: "spring torsion d 2 De 20 n 6.25 [legs tangential|radial|axial] [legs 25] [a2 60]",
    de: "feder dreh d 2 De 20 n 6,25 [schenkel tangential|radial|axial] [schenkel 25] [a2 60]",
    desc: tr("zkrutná pružina podle EN 13906-3: ramena tečná / radiální / osová, úhlová tuhost, moment a napětí při natočení, vnitřní průměr pro trn"),
  },
  {
    cmd: "pružina talířová řada A|B|C De 40 [sloupec 4 2] [L2 19,2]",
    en: "spring disc series A De 40 [stack 4 2] [L2 19.2]",
    de: "feder teller reihe A De 40 [säule 4 2] [L2 19,2]",
    desc: tr("talířová pružina DIN 2093 (řady A, B, C nebo vlastní De Di t h0), sloupec talířů za sebou × v sobě, síla podle Almena–László"),
  },
  { cmd: "pružina tabulka [\"Název\"|vše]", en: "spring table [\"Name\"|all]", de: "feder tabelle [\"Name\"|alle]", desc: tr("spočtené údaje pružiny z tabulky do protokolu: poslední v historii, pojmenovaná nebo všechny pružiny dílu") },
  { cmd: "pružina nápověda [tlačná|tažná|zkrutná|talířová]", en: "spring help [compression]", de: "feder hilfe [druck]", desc: tr("řádky tabulky pružiny se slovy CS / EN / DE, jednotkami a normou") },
];
