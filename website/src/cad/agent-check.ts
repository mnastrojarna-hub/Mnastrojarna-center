/**
 * Kontrola a porovnání textem (CAD-HEADLESS-NAVRH.md kap. 6.1, 6.2; balík B5) – rozbor řádku, bez jádra:
 *
 *   kontrola [díl "A" | sestava | vše] [díry] [polohy] [přesně]                EN check … exact  DE prüfen … genau
 *     `přesně` = platnost tělesa přesnou metodou BRepCheck (vlna 22, bod 22a) – výpis říká, která kontrola proběhla
 *     přesný objem / hmotnost / obálka / tělesa / platnost + hustota (a zda je předpokládaná) a tabulka děr
 *     (souosé úseky sloučené, zahloubení, závit, dno díry); sestava = Σ objem (V.sum i V.union), obálka, vazby, kolize
 *     po třídách a řádek na každý různý díl
 *   porovnat "ref.step" [tolerance 0.05] [zarovnat auto|střed|ne] [díl "A" | sestava] [mapa ne] [přísně]
 *                                                                              EN compare …   DE vergleichen …
 *     porovnání s referenčním modelem ze vstupních souborů hostitele (CLI --files, HTTP files, prohlížeč přiložené soubory)
 *
 * Provedení: engine/check.ts a engine/compare-text.ts. Řádky „kontrola kót …“ a „porovnat předloha …“ patří předloze
 * (balík C1) – tento rozbor je nechá být (null).
 */
import { tr } from "./i18n";
import { isReferenceLine } from "./reference/parse";

export type CheckTarget = "active" | "assembly" | "all" | { part: string };
/** `exact` = přesná kontrola platnosti tělesa (BRepCheck přesnou metodou – vlna 22, bod 22a; validity.ts) */
export type CheckCmd = { target: CheckTarget; holes: boolean; positions: boolean; exact?: boolean };
export type CompareAlignMode = "auto" | "center" | "none";
export type CompareCmd = { file: string; tolerance: number; align: CompareAlignMode; target: Exclude<CheckTarget, "all">; map: boolean; strict: boolean };
export type CheckOp = { k: "check"; cmd: CheckCmd; line: number } | { k: "compare"; cmd: CompareCmd; line: number };

/** výchozí tolerance porovnání (mm) – stejně jako okno Porovnat s referencí a `window.mncad.compare` */
export const COMPARE_TOLERANCE = 0.1;

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const W = (...w: string[]) => new Set(w.map(fold));
const CHECK = W("kontrola", "zkontrolovat", "zkontroluj", "check", "prüfen", "pruefen", "prüfe");
const COMPARE = W("porovnat", "porovnej", "compare", "vergleichen", "vergleiche");
/** druhé slovo, které patří jiným příkazům: kontrola kót (předloha C1), porovnat předloha (C1) */
const FOREIGN = W("kót", "kóty", "koty", "kot", "dims", "dimensions", "dimension", "maße", "masse", "předloha", "předlohu", "predloha", "reference", "vorlage");
const PART = W("díl", "dílu", "part", "teil", "komponenta", "component", "komponente");
const ASM = W("sestava", "sestavu", "assembly", "baugruppe");
const ALL = W("vše", "všechno", "všechny", "all", "alle");
const HOLES = W("díry", "děr", "otvory", "holes", "bohrungen", "löcher", "loecher");
const POSITIONS = W("polohy", "poloh", "pozice", "positions", "positionen", "lage", "lagen");
const TOL = W("tolerance", "tol", "toleranz");
const ALIGN = W("zarovnat", "zarovnání", "align", "alignment", "ausrichten", "ausrichtung");
const MAP = W("mapa", "mapu", "map", "karte");
const STRICT = W("přísně", "strict", "streng");
const EXACT = W("přesně", "přesná", "přesný", "exact", "exactly", "genau", "exakt");
const YES = W("ano", "yes", "ja", "zap", "on");
const NO = W("ne", "no", "nein", "vyp", "off");
const ALIGN_MODE: Record<string, CompareAlignMode> = Object.fromEntries(
  (
    [
      ["auto", "auto", "automaticky"],
      ["center", "střed", "středy", "center", "centre", "mitte", "zentrum"],
      ["none", "ne", "jak je", "none", "no", "keine", "nein"],
    ] as const
  ).flatMap(([m, ...w]) => w.map((x) => [fold(x), m as CompareAlignMode])),
);

/** slova řádku; text v uvozovkách („…“, "…") je jedno slovo (název souboru / dílu s mezerami) */
function words(line: string): { w: string; quoted: boolean }[] {
  const out: { w: string; quoted: boolean }[] = [];
  const re = /"([^"]*)"|„([^“”"]*)[“”"]|“([^”]*)”|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push({ w: m[1] ?? m[2] ?? m[3] ?? m[4], quoted: m[4] === undefined });
  return out;
}
const num = (s: string | undefined) => {
  const v = parseFloat(String(s ?? "").replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
};

export const checkUsage = () => tr('kontrola [díl "A" | sestava | vše] [díry] [polohy] [přesně]');
export const compareUsage = () => tr('porovnat "ref.step" [tolerance 0,05] [zarovnat auto|střed|ne] [díl "A" | sestava] [mapa ne] [přísně]');

/** Řádek `kontrola …` / `porovnat …` → operace bez čísla řádku; null = jiný příkaz. Chyba zápisu = výjimka (✗ parse.error). */
export function parseCheckLine(line: string): Omit<CheckOp, "line"> | null {
  const w = words(line.trim());
  if (!w.length || w[0].quoted) return null;
  const h = fold(w[0].w);
  const isCheck = CHECK.has(h);
  if (!isCheck && !COMPARE.has(h)) return null;
  if (w[1] && !w[1].quoted && FOREIGN.has(fold(w[1].w))) return null;
  if (isReferenceLine(line)) return null; // kontrola kót / porovnat s předlohou … (cad/reference/parse.ts)
  return isCheck ? { k: "check", cmd: parseCheck(w.slice(1)) } : { k: "compare", cmd: parseCompare(w.slice(1)) };
}

function partName(w: { w: string }[], i: number, usage: () => string): string {
  const n = w[i]?.w?.trim();
  if (!n) throw new Error(tr("chybí název dílu – {0}", usage()));
  return n;
}

function parseCheck(w: { w: string; quoted: boolean }[]): CheckCmd {
  const c: CheckCmd = { target: "active", holes: false, positions: false };
  const setTarget = (t: CheckTarget) => {
    if (c.target !== "active") throw new Error(tr("kontrola: zadejte jen jeden cíl (díl, sestava nebo vše) – {0}", checkUsage()));
    c.target = t;
  };
  for (let i = 0; i < w.length; i++) {
    const x = w[i].quoted ? "" : fold(w[i].w);
    if (PART.has(x)) setTarget({ part: partName(w, ++i, checkUsage) });
    else if (ASM.has(x)) setTarget("assembly");
    else if (ALL.has(x)) setTarget("all");
    else if (HOLES.has(x)) c.holes = true;
    else if (POSITIONS.has(x)) c.positions = c.holes = true;
    else if (EXACT.has(x)) c.exact = true;
    else throw new Error(tr("kontrola: neznámá volba „{0}“ – {1}", w[i].w, checkUsage()));
  }
  return c;
}

function parseCompare(w: { w: string; quoted: boolean }[]): CompareCmd {
  const file = w[0]?.w?.trim();
  if (!file) throw new Error(tr("porovnat: chybí soubor reference – {0}", compareUsage()));
  // výchozí zarovnání „ne“ (reference jak je) jako okno Porovnat a window.mncad.compare: „auto“ hodnotí polohu vrcholy sítě
  // reference a u souměrného dílu s posunutou dírou umí vybrat otočení o 180° (vrcholy okraje díry leží na rovině)
  const c: CompareCmd = { file, tolerance: COMPARE_TOLERANCE, align: "none", target: "active", map: true, strict: false };
  let target = false;
  for (let i = 1; i < w.length; i++) {
    const x = w[i].quoted ? "" : fold(w[i].w);
    if (TOL.has(x)) {
      const v = num(w[++i]?.w);
      if (!(v > 0)) throw new Error(tr("porovnat: tolerance musí být kladné číslo v mm (ne „{0}“)", w[i]?.w ?? ""));
      c.tolerance = v;
    } else if (ALIGN.has(x)) {
      const parts = [w[i + 1]?.w, `${w[i + 1]?.w ?? ""} ${w[i + 2]?.w ?? ""}`];
      const two = ALIGN_MODE[fold(parts[1])];
      const one = ALIGN_MODE[fold(parts[0] ?? "")];
      if (two) {
        c.align = two;
        i += 2;
      } else if (one) {
        c.align = one;
        i += 1;
      } else throw new Error(tr("porovnat: zarovnat auto, střed nebo ne (ne „{0}“)", w[i + 1]?.w ?? ""));
    } else if (PART.has(x) || ASM.has(x)) {
      if (target) throw new Error(tr("porovnat: zadejte jen jeden cíl (díl nebo sestava) – {0}", compareUsage()));
      target = true;
      c.target = PART.has(x) ? { part: partName(w, ++i, compareUsage) } : "assembly";
    } else if (MAP.has(x)) {
      const v = fold(w[i + 1]?.w ?? "");
      if (NO.has(v)) c.map = false;
      else if (YES.has(v)) c.map = true;
      else throw new Error(tr("porovnat: mapa ano nebo ne (ne „{0}“)", w[i + 1]?.w ?? ""));
      i++;
    } else if (STRICT.has(x)) c.strict = true;
    else throw new Error(tr("porovnat: neznámá volba „{0}“ – {1}", w[i].w, compareUsage()));
  }
  return c;
}

/** řádky seznamu textových příkazů (AGENT_COMMANDS) */
export const CHECK_COMMANDS: { cmd: string; en: string; de: string; desc: string }[] = [
  {
    cmd: 'kontrola [díl "A" | sestava | vše] [díry] [polohy]',
    en: "check [part \"A\" | assembly | all] [holes] [positions]",
    de: "prüfen [teil \"A\" | baugruppe | alle] [bohrungen] [positionen]",
    desc: tr(
      "kontrola modelu jako tabulka: přesný objem, hmotnost, hustota (rho.assumed = materiál jen označením), obálka, počet těles, platnost; díry (souosé úseky sloučené, zahloubení, závit a hloubka závitu, ploché dno / kužel hrotu) spojené s prvky díry – prvek bez díry v geometrii = ⚠ check.hole-missing; sestava: V.sum i V.union, hmotnost, přesná obálka, vazby, kolize po třídách a řádek na každý různý díl; polohy = i středy děr",
    ),
  },
  {
    cmd: "kontrola přesně · kontrola sestava přesně",
    en: "check exact",
    de: "prüfen genau",
    desc: tr(
      "platnost tělesa přesnou metodou BRepCheck (odchylka křivek hran od ploch počítaná přesně, ne v několika bodech) – výpis „platné (přesná kontrola)“ nebo „NEPLATNÉ (přesná kontrola: N z M ploch s vadou)“, strojově valid=1|0 vcheck=exact bad=N; výsledek platí pro tuto geometrii: řádek Geometrie ve stav končí „· přesná kontrola“, řádek D nese vcheck=exact, JSON docs[].validCheck = exact (jinak „· rychlá kontrola“ a fast); nad 5000 ploch se přesná kontrola neprovede (ℹ s důvodem). Před exportem STEP / BREP proběhne sama do 400 ploch",
    ),
  },
  {
    cmd: 'porovnat "ref.step" [tolerance 0,05] [zarovnat auto|střed|ne] [díl "A" | sestava] [mapa ne] [přísně]',
    en: "compare \"ref.step\" [tolerance 0.05] [align auto|center|none] [part \"A\" | assembly] [map no] [strict]",
    de: "vergleichen \"ref.step\" [toleranz 0,05] [ausrichten auto|mitte|nein] [teil \"A\" | baugruppe] [karte nein] [streng]",
    desc: tr(
      "porovnání modelu se souborem reference (STEP, BREP, STL) ze vstupních souborů: CLI --files / složka skriptu, HTTP files, v prohlížeči přiložený soubor (tlačítko Připojit soubor… v konzoli nebo window.mncad.attach); sestava = složené těleso; výsledek jeden řádek (ok, rozdíl objemu, navíc / chybí, odchylky, podíl v toleranci), mimo toleranci ⚠ compare.mismatch se 3 největšími oblastmi, s „přísně“ ✗",
    ),
  },
];
