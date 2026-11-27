/**
 * Pravidla textu výkresu pro agenty (vlna 23 – požadavek majitele „strojařsky, ne slohové cvičení“, R1–R7).
 *
 * Čistý modul bez jádra a bez Reactu (testovatelný v Node). Kdo pravidla vynucuje: textová cesta = agent (engine – jazyk
 * mncad v konzoli, CLI, HTTP, `window.mncad.run`, JSON dokument v běhu, `setDocument`, `otevřít` / `--open`; cad/drawing-agent.ts
 * `applyDrawingCmd`, model engine/ops/functional.ts, 2D cad/draft/agent.ts). GUI výkresu (cad/components/cad/drawing-workspace.tsx
 * – nástroje Text / Poznámka / Kóta, panel Razítko, tabulka revizí) jde mimo engine – člověk omezen není, dostane nanejvýš
 * nenápadnou radu. **Rozlišení = cesta, ne prohlášení:** co zapíše engine, dostane razítko původu `by: "agent"`
 * (`stampOrigin` na jediném místě zápisu příkazu výkresu), co zapíše GUI, `by: "user"`; dokument, který přijde textovou
 * cestou (JSON, setDocument, otevřít, --open), se celý přerazítkuje na agenta (`stampAgentNotes`) – `"by":"user"` v JSON
 * se nebere. Starší dokument bez razítka otevřený člověkem v GUI = ruční.
 *
 * Kanály textu, které hlídá `auditDoc` (jedno místo pro příkaz, vyhodnocení listu, export i načtený dokument):
 * - volný text nad razítkem (poznámka u razítka, texty, poznámky bez cíle, vysvětlivky oblastních úprav, poznámka k plechu)
 *   – R4: celý dokument (všechny výkresy a listy) nejvýš NOTE_MAX_LINES řádků, řádek heslovitě; R5: jen na hlavním listu;
 * - místní popisy (odkazy se šipkou z modelu i z výkresu) – R2: nejvýš NOTE_MAX_LEADERS, krátce, popis má být v modelu;
 * - kóty (text, předpona, přípona), popisy děr, značky drsnosti, geometrické tolerance, základny – jen krátký technický údaj;
 * - buňky razítka – hodnota heslovitě (technické buňky nejvýš TITLE_VALUE_MAX znaků), název / zákazník bez údajů razítka;
 * - tabulka revizí – krátký popis změny; údaj razítka jen, je-li i v razítku;
 * - popisy a předpisy úprav v modelu (i vložené JSON);
 * - R1 `classifyNote`: údaj razítka (materiál, tepelné zpracování, tvrdost, povrchová úprava, hrany ISO 13715, nepředepsané
 *   tolerance, obecná drsnost) mimo razítko.
 */
import { tr } from "./i18n";
import type { CadDoc, DrawingAnnotation, DrawingDoc, FunctionalMark } from "./types";

/** nejvýš řádků volného textu nad razítkem (celý dokument – všechny výkresy a listy) */
export const NOTE_MAX_LINES = 5;
/** nejvýš znaků jednoho řádku volného textu */
export const NOTE_MAX_CHARS = 60;
/** nejvýš znaků popisu u odkazové čáry (místní popis plochy / hrany) */
export const LEADER_MAX_CHARS = 40;
/** nejvýš místních popisů (odkazů se šipkou / tečkou) v celém dokumentu – „ne 1000 poznámek“ */
export const NOTE_MAX_LEADERS = 8;
/** R1: hodnota buňky razítka je údaj, ne věta („kalit a popustit“, „ISO 13715 -0,3“) – delší text se do razítka nepřesune */
export const TITLE_VALUE_MAX = 32;
/** nejvýš znaků ostatních buněk razítka (název, zákazník, projekt …) */
export const TITLE_FREE_MAX = 48;
/** nejvýš slov heslovitého řádku */
export const NOTE_MAX_WORDS = 8;
/** nejvýš znaků textu kóty (náhrada hodnoty, předpona, přípona) a hodnoty značky drsnosti */
export const DIM_TEXT_MAX = 24;
/** nejvýš znaků řádku popisu díry (popis s odkazovou čarou) */
export const CALLOUT_MAX = 40;
/** nejvýš znaků popisu změny v tabulce revizí */
export const REV_MAX = 48;
/** nejvýš výška písma volného textu agenta [mm] – vyšší písmo by limit řádků obešlo */
export const TEXT_MAX_H = 5;

/** údaje, které patří do razítka (R1) – klíče polí razítka (cad/title-block.ts) */
export type TitleDataKey = "material" | "heatTreatment" | "hardness" | "surfaceTreatment" | "edges" | "tolerance" | "roughness";
export const TITLE_DATA_KEYS: TitleDataKey[] = ["material", "heatTreatment", "hardness", "surfaceTreatment", "edges", "tolerance", "roughness"];

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

/** začátky slov (bez diakritiky) – tepelné zpracování (cs / en / de); nitridace je tepelně-chemické zpracování */
const HEAT = ["kalit", "kalen", "zakal", "prokal", "popoust", "popust", "zihan", "zihat", "normaliz", "cementov", "cementac", "nitrid", "nitrocement", "karbonitrid", "zuslecht", "harden", "quench", "temper", "anneal", "carburi", "nitrocarbur", "hart", "gehart", "gehaert", "haert", "vergut", "verguet", "anlass", "angelass", "gluh", "glueh", "gegluh", "einsatzh", "aufkohl", "nitrier", "induktiv"];
const SURFACE = ["cernit", "cernen", "zinkov", "pozink", "galvan", "chromov", "pochrom", "niklov", "poniklov", "elox", "anodiz", "anodis", "lakov", "nalakov", "praskov", "fosfat", "pasivov", "trysk", "povlak", "pisk", "otryskat", "kulickov", "blacken", "zincplat", "galvaniz", "plated", "plating", "chrome", "nickel", "paint", "powder", "coating", "coated", "phosphat", "passivat", "sandblast", "shotblast", "beadblast", "blast", "brunier", "verzink", "verchrom", "vernickel", "eloxier", "lackier", "beschicht", "phosphatier", "sandstrahl", "kugelstrahl", "strahl", "pulverbe", "povrch", "surface", "oberflach"];
const SURFACE_EXACT = new Set(["tin", "tialn", "ticn", "crn", "dlc", "pvd", "cvd", "eloxal", "zn", "znni", "fezn", "ral", "zink", "zinc", "zinek", "nikl", "chrom"]);
const EDGES = ["sraz", "otrep", "odjehl", "odhrot", "omil", "deburr", "burr", "chamfer", "edge", "corner", "kante", "ecke", "entgrat", "gratfrei", "fase", "gebrochen", "brechen"];
/** hrana jako celé slovo („Hranol“ hranou není) */
const EDGE_WORDS = new Set(["hrana", "hrany", "hran", "hranu", "hrane", "hranach", "hranami", "hranam"]);
const TOL = ["nepredepsan", "volnerozmer", "obecnetoler", "allgemeintoler", "freimass", "toleranc", "toleranz", "unspecified", "unbemass", "untoleriert", "untolerated"];
const ROUGH = ["drsnost", "roughness", "rauheit", "rauigkeit", "oberflachenrauh"];
const HARDW = ["tvrdost", "hardness", "harte", "haerte"];
const MATERIAL = ["material", "werkstoff", "materiau", "polotovar"];
/** druh materiálu („Ocel C45“, „Ocel 19 436“) – údaj razítka jen v krátkém zápisu, ve větě („předpis výrobce oceli“) ne */
const MATERIAL_FAMILY = ["ocel", "steel", "stahl", "hlinik", "aluminium", "aluminum", "mosaz", "brass", "messing", "bronz", "litina", "nerez"];
/** slova bez významu pro rozhodnutí (čísla, jednotky, předložky, „díl“, „plochy“, popisky polí …) */
const FILLER = new Set([
  "a", "i", "na", "dle", "podle", "normy", "norma", "normou", "vse", "vsech", "vsechny", "celem", "cele", "cely", "celou", "dil", "dilu", "plochy", "plocha", "plochach", "ploch", "mm", "x", "stupnu", "stupne", "st", "s", "se", "v", "ve", "z", "ze", "do", "o",
  "and", "to", "per", "according", "all", "the", "of", "on", "with", "deg", "degree", "degrees", "break", "sharp",
  "und", "auf", "nach", "gemass", "gemaess", "alle", "mit", "der", "die", "das", "von",
  "uprava", "upravy", "zpracovani", "zpracovat", "zpracovano", "tepelne", "tepelna", "povrchova", "povrchove", "treatment", "finish", "heat", "behandlung", "warmebehandlung", "waermebehandlung",
  "obecna", "obecne", "general", "allgemein", "allgemeine", "iso", "csn", "en", "din", "rozmery", "rozmer", "rozmeru", "dimensions", "masse", "mase",
  "w", "nr", "wnr", "stav", "stavu", "ostre", "ostrych", "ostra", "scharfe", "vrstva", "tl", "um", "µm", "aw", "jr", "j0", "j2",
]);

/** tvrdost: číslo před jednotkou („58-60 HRC“) i jednotka před číslem („HRC 58-62“, „HV10 600“) */
const HARD_RE = /(\d+(?:[.,]\d+)?(?:\s*(?:[-–…]|\+\s*\/?\s*-?|±|až|to|bis)\s*\d+(?:[.,]\d+)?)?\s*(?:HRC|HRB|HRA|HV\s?\d{0,2}|HBW|HB)\b|\b(?:HRC|HRB|HRA|HV\s?\d{0,2}|HBW|HB)\s*\d+(?:[.,]\d+)?(?:\s*(?:[-–…]|\+\s*\/?\s*-?|±|až|to|bis)\s*\d+(?:[.,]\d+)?)?)/i;
const TOL_RE = /((?:(?:ČSN|CSN|DIN)\s+)?(?:EN\s+)?ISO\s*)?(?:2768\s*[-–]?\s*(?:[12]\s*[-–]?\s*)?([fmcv])\s*[-/]?\s*([HKL])?\b|22081)/i;
/** obecná tolerance zapsaná hodnotou („±0,1“) – s nekótovanými rozměry / slovem tolerance */
const PM_RE = /±\s*\d+(?:[.,]\d+)?/;
const RA_RE = /\b(R[az]|Rmax)\s*(\d+(?:[.,]\d+)?)/;
/** třída drsnosti N1–N12 (ISO 1302) */
const NCLASS_RE = /\bN(?:1[0-2]|[1-9])\b/;
const WNR_RE = /\b1\.\d{4}\b/;
/** materiál: ČSN (19 436, 11 523.1), EN (C45, S235JR, 42CrMo4, X153CrMoV12, EN AW-6082, AlMgSi1, CuZn39Pb3) */
const CSN_RE = /\b1[0-9]\s?\d{3}(?:\.\d{1,2})?\b/;
const EN_STEEL_RE = /\b(?:C\d{2,3}E?|S\d{3}(?:JR|J0|J2|MC)?|\d{2,3}(?:Cr|Mn|Ni|Mo|Si|V|W){1,4}\d{1,2}(?:-\d{1,2})*|X\d{2,3}(?:Cr|Mo|Ni|V|W|Mn|Co|Si|Ti|N){1,5}\d{0,2}(?:-\d{1,2})*|EN\s?AW-?\d{4}|Al(?:Mg|Si|Cu|Zn)\w*|CuZn\d\w*|CuSn\d\w*|100Cr6)\b/;
const EDGE_ISO_RE = /ISO\s*13715\b/i;
/** sražení hrany bez slova („0,5x45°“, „1×45“) */
const CHAMFER_RE = /\b\d+(?:[.,]\d+)?\s*[x×]\s*45\s*°?/i;
/** povlak kódem: RAL 9005, Fe/Zn 8, Zn 8 µm, ZnNi, A3K (ISO 4042) */
const COAT_RE = /\bRAL\s*\d{4}\b|\bFe\s*\/+\s*Zn\w*|\bZn(?:Ni|Fe)?\s*\d+(?:[.,]\d+)?\s*(?:µm|um)?\b|\bA[1-5][A-Z]\b|\b\d+(?:[.,]\d+)?\s*(?:µm|um)\b/i;

const startsAny = (w: string, list: readonly string[]) => list.some((p) => w.startsWith(p));
const isNum = (w: string) => /^\d/.test(w);

/** jedna část poznámky (oddělovače „;“, „·“, „, “ před slovem – desetinná čárka „0,5“ zůstane) */
const segmentsOf = (t: string) => t.split(/\s*[;·]\s*|,\s+(?=\D)/).map((s) => s.trim()).filter(Boolean);
/** pořadové číslo / odrážka na začátku řádku („1.“, „2)“, „–“, „•“) */
export const stripEnum = (t: string) => t.replace(/^\s*(?:\d{1,2}\s*[.)]|[-–•*])\s+/, "").trim();
const clean = (s: string) => s.replace(/^[\s:–-]+|[\s.,;:–-]+$/g, "").replace(/\s{2,}/g, " ");

export type NoteClass = {
  /** údaje razítka v textu (klíč pole a hodnota) */
  parts: { key: TitleDataKey; value: string }[];
  /** části textu, které údajem razítka nejsou (obyčejná poznámka) */
  rest: string[];
  /** text míchá údaj razítka s dalším obsahem (věta kolem údaje) – nejde čistě přesunout, agent ho musí rozdělit */
  mixed: boolean;
};

type SegKinds = { kinds: Set<TitleDataKey>; extra: string[]; hard?: string; tol?: string; ra?: string; mat?: string };

/** druhy údajů razítka v části textu (slova, tvrdost, ISO 2768, Ra, materiál, povlak …) a slova, která žádnému druhu nepatří */
function segKinds(seg: string): SegKinds {
  const kinds = new Set<TitleDataKey>();
  let rest = seg;
  const take = (re: RegExp): string | undefined => {
    const m = re.exec(rest);
    if (!m) return undefined;
    rest = rest.replace(m[0], " ");
    return m[0];
  };
  const hard = HARD_RE.exec(rest)?.[1];
  if (hard) {
    kinds.add("hardness");
    rest = rest.replace(hard, " ");
  }
  const tm = TOL_RE.exec(rest);
  let tol: string | undefined;
  if (tm) {
    kinds.add("tolerance");
    tol = tm[2] ? `ISO 2768-${tm[2].toLowerCase()}${(tm[3] ?? "").toUpperCase()}` : "ISO 22081";
    rest = rest.replace(tm[0], " ");
  }
  let ra: string | undefined;
  const rm = RA_RE.exec(rest);
  if (rm) {
    kinds.add("roughness");
    ra = `${rm[1]} ${rm[2]}`;
    rest = rest.replace(rm[0], " ");
  } else {
    const n = take(NCLASS_RE);
    if (n) {
      kinds.add("roughness");
      ra = n;
    }
  }
  let mat = take(WNR_RE) ?? take(EN_STEEL_RE);
  if (mat) kinds.add("material");
  if (EDGE_ISO_RE.test(rest)) {
    kinds.add("edges");
    rest = rest.replace(EDGE_ISO_RE, " ");
  }
  if (take(CHAMFER_RE)) kinds.add("edges");
  if (take(COAT_RE)) kinds.add("surfaceTreatment");
  const ws = words(rest);
  // ČSN ocel jen se slovem materiálu („Ocel 19 436“) – samotné „10 000“ je počet, ne materiál
  if (!mat && ws.some((w) => startsAny(w, MATERIAL) || startsAny(w, MATERIAL_FAMILY))) {
    const c = CSN_RE.exec(rest)?.[0];
    if (c) {
      mat = c;
      kinds.add("material");
      rest = rest.replace(c, " ");
    }
  }
  if (PM_RE.test(rest) && ws.some((w) => startsAny(w, TOL) || /^rozmer|^dimension|^mass?e$|^nekotovan/.test(w))) {
    kinds.add("tolerance");
    rest = rest.replace(PM_RE, " ");
  }
  const extra: string[] = [];
  const ws2 = words(rest);
  for (let i = 0; i < ws2.length; i++) {
    const w = ws2[i];
    // „tepelné zpracování“, „povrchová úprava“, „obecná drsnost“, „volné rozměry“ jako dvojice slov
    const pair = w + (ws2[i + 1] ?? "");
    if (pair.startsWith("tepelnezprac") || pair.startsWith("heattreat") || pair.startsWith("warmebehand") || pair.startsWith("waermebehand")) kinds.add("heatTreatment");
    if (pair.startsWith("povrchovauprav") || pair.startsWith("surfacetreat") || pair.startsWith("surfacefinish") || pair.startsWith("oberflachenbeh") || pair.startsWith("oberflaechenbeh")) kinds.add("surfaceTreatment");
    // „nekótované rozměry / tolerance“ = nepředepsané tolerance; „nekótované hrany“ jsou hrany (ISO 13715), ne tolerance
    if (startsAny(pair, TOL) || pair.startsWith("generaltoler") || pair.startsWith("obecnetoler") || pair.startsWith("volnerozm") || pair.startsWith("nekotovanerozm") || pair.startsWith("nekotovanetoler") || pair.startsWith("nekotovanychrozm")) kinds.add("tolerance");
    if (startsAny(w, HARDW)) kinds.add("hardness");
    else if (startsAny(w, HEAT)) kinds.add("heatTreatment");
    else if (startsAny(w, ROUGH)) kinds.add("roughness");
    else if (startsAny(w, TOL)) kinds.add("tolerance");
    else if (startsAny(w, SURFACE) || SURFACE_EXACT.has(w)) kinds.add("surfaceTreatment");
    else if (startsAny(w, EDGES) || EDGE_WORDS.has(w)) kinds.add("edges");
    else if (startsAny(w, MATERIAL)) kinds.add("material");
    else if (startsAny(w, MATERIAL_FAMILY)) {
      if (ws2.length <= 3 || mat) kinds.add("material");
    }
    else if (!FILLER.has(w) && !isNum(w) && !/^\d*x\d*$/.test(w)) extra.push(w);
  }
  return { kinds, extra, ...(hard ? { hard } : {}), ...(tol ? { tol } : {}), ...(ra ? { ra } : {}), ...(mat ? { mat } : {}) };
}

/** popisek pole na začátku části („Hrany:“, „Povrchová úprava –“, „Materiál“) se do hodnoty nepíše */
const LABEL_RE = /^\s*(?:nek[óo]tovan[éeá]\s+(?:rozměry|tolerance)|nepředepsan[éeá]\s+tolerance|obecn[éeá]\s+tolerance|tolerance|toleranz|tepeln[éeá]\s+zpracování|povrchov[áaé]\s+úprava|povrch|hrany|materi[áa]l|werkstoff|material|edges|kanten|heat\s+treatment|surface(?:\s+treatment)?|oberfl[äa]che|wärmebehandlung|drsnost|roughness|rauheit|tvrdost|hardness|härte)\s*[:–-]?\s*/i;

/**
 * R1: je text údajem razítka? `null` = není (obyčejná poznámka). Jinak části s polem razítka a hodnotou, zbytek textu
 * a příznak `mixed` (údaj razítka uprostřed věty – „Díl po kalení brousit na rovinnost 0,01“: nejde přesunout, agent text
 * rozdělí). Hodnoty: tvrdost s jednotkou („58-60 HRC“, „HRC 58-62“), ISO 2768 třída („ISO 2768-mK“), Ra / N7, W.Nr. / EN /
 * ČSN materiál („1.2379“, „C45“, „19 436“), ostatní = text části bez popisku pole.
 */
export function classifyNote(text: string): NoteClass | null {
  const t = stripEnum(text.replace(/\s+/g, " "));
  const segs = segmentsOf(t);
  const parts: NoteClass["parts"] = [];
  const rest: string[] = [];
  let mixed = false;
  let any = false;
  for (const seg of segs) {
    const k = segKinds(seg);
    if (!k.kinds.size) {
      rest.push(seg);
      continue;
    }
    any = true;
    // víc než 2 slova navíc = věta kolem údaje → nejde čistě přesunout
    if (k.extra.length > 2) mixed = true;
    // hodnota pole = text části bez popisku pole a bez hodnot, které patří jiným polím (tvrdost, ISO 2768, Ra, materiál)
    let body = clean(seg.replace(LABEL_RE, ""));
    for (const x of [k.mat, k.ra && (RA_RE.exec(seg)?.[0] ?? k.ra), k.tol && TOL_RE.exec(seg)?.[0]]) if (x && body !== x) body = clean(body.replace(x, " "));
    const push = (key: TitleDataKey, value: string) => {
      const v = clean(value);
      if (!v) return;
      const had = parts.find((p) => p.key === key);
      if (had) had.value = `${had.value}, ${v}`;
      else parts.push({ key, value: v });
    };
    if (k.hard) push("hardness", k.hard.replace(/\s+/g, " "));
    else if (k.kinds.has("hardness")) push("hardness", body);
    if (k.kinds.has("heatTreatment")) {
      // hodnota tepelného zpracování = text bez tvrdosti a výplně na konci („na“, „to“, „auf“)
      push("heatTreatment", body.replace(k.hard ?? "\u0000", " ").replace(/\s+(?:na|to|auf|tvrdost|hardness|härte)\s*$/i, "").replace(/\s+(?:na|to|auf)\s+(?:tvrdost|hardness|härte)\s*$/i, ""));
    }
    if (k.kinds.has("tolerance")) push("tolerance", k.tol ?? body);
    if (k.kinds.has("roughness")) push("roughness", k.ra ?? body);
    if (k.kinds.has("material")) push("material", k.mat ? (k.kinds.size === 1 && body && !/^\d/.test(body) ? `${body} ${k.mat}` : k.mat) : body);
    if (k.kinds.has("surfaceTreatment")) push("surfaceTreatment", body);
    if (k.kinds.has("edges")) push("edges", body);
  }
  if (!any) return null;
  if (rest.length) mixed = true;
  // věta jako hodnota buňky („Nekótované hrany sražení 0,5x45 stupňů, ostré hrany zbavit otřepů“) = do razítka se nepřesune
  if (parts.some((p) => p.value.length > TITLE_VALUE_MAX)) mixed = true;
  return { parts, rest, mixed };
}

/** název pole razítka do protokolu (malými písmeny) */
export function titleDataLabel(k: TitleDataKey): string {
  switch (k) {
    case "material": return tr("materiál");
    case "heatTreatment": return tr("tepelné zpracování");
    case "hardness": return tr("tvrdost");
    case "surfaceTreatment": return tr("povrchová úprava");
    case "edges": return tr("hrany");
    case "tolerance": return tr("nepředepsané");
    case "roughness": return tr("drsnost");
  }
}
/** klíč pole v příkazu `výkres razítko …=` (nápověda) */
export const TITLE_DATA_CMD: Record<TitleDataKey, string> = { material: "materiál", heatTreatment: "tepelné", hardness: "tvrdost", surfaceTreatment: "povrch", edges: "hrany", tolerance: "nepředepsané", roughness: "drsnost" };

/** rada „výkres razítko tepelné="…" tvrdost="…"“ pro údaje razítka z poznámky */
export function titleHint(parts: NoteClass["parts"]): string {
  const p = parts.length ? parts : [{ key: "heatTreatment" as const, value: "…" }];
  return `výkres razítko ${p.map((x) => `${TITLE_DATA_CMD[x.key]}="${x.value.length > TITLE_VALUE_MAX ? "…" : x.value.replace(/"/g, "'")}"`).join(" ")}`;
}

// ---------------------------------------------------------------- R4 styl řádku

const SENTENCE_W = new Set([
  "pokud", "ktere", "ktery", "ktera", "kterych", "kterou", "aby", "prosim", "kontaktujte", "kontaktovat", "musi", "musite", "mel", "mela", "melo", "meli", "doporucujeme", "doporucuje", "nejasnost", "nejasnosti", "nasledujici", "jakekoli", "jakekoliv", "pripade", "nutne", "treba", "jinak", "uvedeno",
  "please", "must", "should", "which", "contact", "following", "whenever", "unless", "recommended", "otherwise",
  "bitte", "muss", "mussen", "muessen", "sollte", "sollten", "welche", "welcher", "falls", "kontaktieren", "folgende", "empfohlen", "sofern",
]);

/** zkratky s tečkou, které větu nekončí (tituly, „max.“, „cca.“, „pozn.“ …) */
const ABBR = new Set(["ing", "mgr", "bca", "doc", "prof", "phd", "tel", "apod", "atd", "tzv", "max", "min", "cca", "resp", "napr", "pozn", "obr", "str", "viz", "dipl", "nr", "art", "ref", "inc", "ltd", "gmbh", "dir", "rev", "pos", "poz"]);

/**
 * R4: důvod, proč řádek není heslovitý (null = v pořádku). Hlídá délku (`max` znaků), počet slov (`maxWords`), více vět,
 * tečku na konci, víc než dvě čárky a slova vět / souvětí („pokud“, „které“, „aby“, „musí“, „please“, „bitte“ …).
 */
export function noteStyle(text: string, max = NOTE_MAX_CHARS, maxWords = NOTE_MAX_WORDS): string | null {
  const t = stripEnum(text.trim());
  if (!t) return null;
  if (t.length > max) return tr("řádek má {0} znaků (nejvýš {1})", t.length, max);
  const ws = t.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (ws.length > maxWords) return tr("{0} slov – heslovitě nejvýš {1}", ws.length, maxWords);
  // víc vět = konec věty (slovo aspoň 3 písmen, ne zkratka „Ing.“, „s.r.o.“, „max.“) a za ním další slovo
  if ([...t.matchAll(/(\p{L}+)[.!?]\s+\p{L}/gu)].some((m) => m[1].length >= 3 && !ABBR.has(fold(m[1])))) return tr("víc vět na řádku");
  // tečka za zkratkou („pozn.“, „max.“, „W.Nr.“) není věta – věta = aspoň tři slova a tečka / ! / ? na konci
  if (ws.length >= 3 && (/[!?]$/.test(t) || (/\.$/.test(t) && !/\b(?:ap|atd|tzv|max|min|cca|resp|tj|tl|č|st|ks|pozn|W\.Nr)\.$/i.test(t)))) return tr("věta s tečkou na konci");
  if ((t.match(/,\s+(?=\D)/g) ?? []).length > 2) return tr("víc než dvě čárky (souvětí)");
  const sw = words(t).find((w) => SENTENCE_W.has(w));
  if (sw) return tr("slovo věty „{0}“", sw);
  return null;
}

// ---------------------------------------------------------------- původ textu (R6: rozhoduje cesta)

export type By = "agent" | "user";
/** auto = generátor (poznámka k plechu) */
export type Origin = By | "auto";

/** technické buňky razítka (hodnota heslovitě, nejvýš TITLE_VALUE_MAX znaků) */
export const TITLE_TECH_FIELDS = ["heatTreatment", "hardness", "surfaceTreatment", "edges", "roughness", "tolerance", "angleTol", "chamferTol", "stock"] as const;
/** ostatní textové buňky razítka */
export const TITLE_FREE_FIELDS = ["name", "number", "author", "date", "revision", "company", "customer", "project", "checkedBy", "approvedBy", "quantity"] as const;
/** buňky, kde údaj razítka (tvrdost, tepelné zpracování …) nemá co dělat – patří do svého pole */
const TITLE_NO_DATA = new Set<string>(["name", "company", "customer", "project", "number", "author", "checkedBy", "approvedBy", "quantity", "date", "revision"]);
const TEXT_FIELDS: string[] = [...TITLE_TECH_FIELDS, ...TITLE_FREE_FIELDS, "note"];

type MetaBy = { by?: Record<string, By>; noteBy?: By };
const str = (v: unknown) => (typeof v === "string" ? v : "");
/** původ buňky razítka / poznámky u razítka (chybí = ruční – starší dokument nebo GUI) */
export const metaBy = (m: Record<string, unknown>, k: string): By => (k === "note" ? (m as MetaBy).noteBy : undefined) ?? (m as MetaBy).by?.[k] ?? "user";

/** textová podstata značky – změna = nový zápis (poloha, odsazení ani přepočet geometrie původ nemění) */
const annSig = (a: DrawingAnnotation): string => {
  const x = a as Record<string, unknown>;
  return JSON.stringify([a.type, x.text, x.prefix, x.suffix, x.lines, x.tol, x.ra, x.value, x.datum, x.label, x.size, x.leader ? 1 : 0, x.free ?? null]);
};
type Rev = { rev: string; note: string; by?: By };

/**
 * Razítko původu na jediném místě zápisu (engine po příkazu výkresu = "agent", GUI při uložení listu = "user"): nová
 * nebo textově změněná značka, změněná buňka razítka / poznámka u razítka a změněný řádek revize dostanou `by`.
 * Nezměněné položky si původ nechají (agent nepřepíše razítko člověka tím, že list jen přepočítá, a obráceně).
 */
export function stampOrigin(prev: DrawingDoc | undefined, next: DrawingDoc, by: By): DrawingDoc {
  let changed = false;
  const pAnn = new Map((prev?.annotations ?? []).map((a) => [a.id, a]));
  const annotations = next.annotations.map((a) => {
    const p = pAnn.get(a.id);
    if ((!p || annSig(p) !== annSig(a)) && a.by !== by) {
      changed = true;
      return { ...a, by } as DrawingAnnotation;
    }
    return a;
  });
  const pm = (prev?.meta ?? {}) as Record<string, unknown>;
  const nm = next.meta as Record<string, unknown>;
  const meta: Record<string, unknown> = { ...nm };
  let mChanged = false;
  const map: Record<string, By> = { ...((nm as MetaBy).by ?? {}) };
  for (const k of TEXT_FIELDS) {
    const v = str(nm[k]).trim();
    if (!v || v === str(pm[k]).trim() || metaBy(nm, k) === by) continue;
    if (k === "note") meta.noteBy = by;
    else map[k] = by;
    mChanged = true;
  }
  // název listu a výkresu se tiskne v razítku / záložce – původ jako u buňky razítka
  for (const [k, v, pv] of [["sheetName", next.name, prev?.name], ["drawingName", next.drawing, prev?.drawing]] as const) {
    if ((v ?? "").trim() && (v ?? "").trim() !== (pv ?? "").trim() && map[k] !== by && !(k === "sheetName" && !prev && by === "agent" && /^(?:List|Sheet|Blatt) \d+$/.test(v ?? ""))) {
      map[k] = by;
      mChanged = true;
    }
  }
  const revs = nm.revisions as Rev[] | undefined;
  if (Array.isArray(revs)) {
    const prevRevs = (pm.revisions as Rev[] | undefined) ?? [];
    const nr = revs.map((r) => {
      const p = prevRevs.find((x) => x.rev === r.rev);
      if ((!p || p.note !== r.note) && r.note?.trim() && r.by !== by) {
        mChanged = true;
        return { ...r, by };
      }
      return r;
    });
    if (mChanged) meta.revisions = nr;
  }
  if (mChanged) {
    if (Object.keys(map).length) meta.by = map;
    changed = true;
  }
  return changed ? { ...next, annotations, meta } : next;
}

/**
 * Dokument, který přišel textovou cestou agenta (JSON řádek skriptu, `window.mncad.setDocument`, `otevřít`, CLI `--open`):
 * všechny texty listů, buňky razítka, revize, popisy a úpravy v modelu dostanou `by: "agent"` – **i když JSON tvrdí
 * `"by":"user"`** (R6: rozhoduje cesta, ne prohlášení; pravidla nejdou obejít vloženým dokumentem).
 */
export function stampAgentNotes<T extends Pick<CadDoc, "drawings"> & Partial<Pick<CadDoc, "functional" | "materialName">>>(doc: T): T {
  const out: T = { ...doc };
  if (doc.drawings?.length) {
    out.drawings = doc.drawings.map((s) => {
      const m = { ...(s.meta ?? {}) } as Record<string, unknown>;
      const map: Record<string, By> = {};
      for (const k of TEXT_FIELDS) if (str(m[k]).trim()) k === "note" ? (m.noteBy = "agent") : (map[k] = "agent");
      if (s.name?.trim()) map.sheetName = "agent";
      if (s.drawing?.trim()) map.drawingName = "agent";
      if (Object.keys(map).length) m.by = map;
      else delete m.by;
      if (!str(m.note).trim()) delete m.noteBy;
      if (Array.isArray(m.revisions)) m.revisions = (m.revisions as Rev[]).map((r) => ({ ...r, by: "agent" as const }));
      return { ...s, meta: m, annotations: (s.annotations ?? []).map((a) => ({ ...a, by: "agent" as const })) };
    });
  }
  if (doc.functional?.length) out.functional = doc.functional.map((f) => (f.kind === "note" || f.kind === "treatment" ? { ...f, by: "agent" as const } : f));
  if (doc.materialName?.trim()) (out as { materialBy?: By }).materialBy = "agent";
  return out;
}

// ---------------------------------------------------------------- volný text nad razítkem (R4, R5)

/** řádky textu (zalomení „\n“ i délka nad NOTE_MAX_CHARS – dlouhý řádek se vykreslí jako víc řádků) */
export const lineCount = (text: string): number =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .reduce((n, l) => n + Math.max(1, Math.ceil(l.length / NOTE_MAX_CHARS)), 0);

export type FreeText = {
  /** index listu v dokumentu a jeho pořadí ve výkresu (0 = list 1) */
  sheet: number;
  pos: number;
  /** id poznámky (a1 … podle `výkres stav`) nebo „poznámka“ (pole poznámky u razítka) / „legenda“ / „plech“ */
  ref: string;
  /** klíč položky (ann:<id>, meta:note, legend:<n>, form) – shoda mezi stavem před a po příkazu */
  key: string;
  kind: "meta" | "text" | "note" | "legend" | "form";
  text: string;
  lines: number;
  /** agent = textová cesta (engine), user = GUI / starší dokument, auto = generátor (poznámka k plechu) */
  by: Origin;
};

/** řádek generátoru nad razítkem: vysvětlivka oblastní úpravy (původ = původ úpravy v modelu) nebo poznámka k plechu */
export type GenLine = { text: string; by: Origin };
export type GenText = { legend?: (string | GenLine)[]; form?: string[] };
const genLine = (l: string | GenLine, by: Origin): GenLine => (typeof l === "string" ? { text: l, by } : l);

/** poznámka listu je volný text nad razítkem: text na listu a poznámka bez cíle v geometrii */
export const isFreeAnn = (a: DrawingAnnotation): boolean => a.type === "text" || (a.type === "note" && (a.free === true || !a.leader));

/** zapnuté pravoúhlé pohledy listu (bez voleb = výchozí přední, horní, levý) */
const orthoViews = (s: DrawingDoc): string[] => {
  const v = { front: true, top: true, left: true, ...(((s.options ?? {}) as { views?: Record<string, boolean> }).views ?? {}) } as Record<string, boolean>;
  const on = Object.entries(v).filter(([k, x]) => x && k !== "iso").map(([k]) => k);
  const o = s.options as { section?: unknown; details?: unknown[]; aux?: unknown[]; cuts?: unknown[] };
  return [...on, ...(o?.section ? ["section"] : []), ...(o?.details?.length ? ["detail"] : []), ...(o?.aux?.length ? ["aux"] : []), ...(o?.cuts?.length ? ["cut"] : [])];
};
const hasDims = (s: DrawingDoc) => s.annotations.some((a) => a.type === "dim" || a.type === "callout");

/** listy dokumentu v pořadí výkresů (výkres 1: list 1, 2 …; výkres 2 …) – jako cad/drawing-sets.ts */
export function orderedSheets(doc: Pick<CadDoc, "drawings">): number[] {
  const keys: string[] = [];
  const by = new Map<string, number[]>();
  (doc.drawings ?? []).forEach((s, i) => {
    const k = s.drawing?.trim() ?? "";
    if (!by.has(k)) {
      by.set(k, []);
      keys.push(k);
    }
    by.get(k)!.push(i);
  });
  return keys.flatMap((k) => by.get(k)!);
}

/**
 * R5: hlavní list dokumentu – jediný, kde smí být volný text nad razítkem: první list (v pořadí výkresů), který nese
 * pravoúhlý pohled s kótami; jinak první list s pravoúhlým pohledem; jinak první list. List jen s izometrií a poznámkami
 * („Technické požadavky“) hlavní list nikdy není.
 */
export function mainSheet(doc: Pick<CadDoc, "drawings">): number {
  const order = orderedSheets(doc);
  const ds = doc.drawings ?? [];
  return order.find((i) => orthoViews(ds[i]).length && hasDims(ds[i])) ?? order.find((i) => orthoViews(ds[i]).length) ?? order[0] ?? 0;
}

/**
 * Volný text dokumentu (listy `sheets`, výchozí všechny listy všech výkresů): pole poznámky u razítka, texty na listu,
 * poznámky bez cíle, legenda oblastních úprav (R3) a poznámka k plechu (`legend` / `form` = řádky generátoru – na hlavním
 * listu). Nepočítá se: „Rozměry v mm“, číslo listu, revize modelu, údaje razítka v buňkách, odkazy na geometrii, kóty.
 */
export function freeTextLines(doc: Pick<CadDoc, "drawings">, sheets?: number[], extra: GenText = {}): FreeText[] {
  const out: FreeText[] = [];
  const list = sheets ?? orderedSheets(doc);
  const main = sheets ? list[0] : mainSheet(doc);
  list.forEach((si, pos) => {
    const s: DrawingDoc | undefined = doc.drawings?.[si];
    if (!s) return;
    const m = s.meta as Record<string, unknown>;
    const note = str(m.note).trim();
    if (note) out.push({ sheet: si, pos, ref: tr("poznámka"), key: "meta:note", kind: "meta", text: note, lines: lineCount(note), by: metaBy(m, "note") });
    s.annotations.forEach((a, i) => {
      if (!isFreeAnn(a)) return;
      const text = (a as { text: string }).text ?? "";
      if (!text.trim()) return;
      // vysoké písmo zabere víc řádků (výška 3,5 mm = 1 řádek)
      const tall = a.type === "text" && a.size > TEXT_MAX_H ? Math.ceil(a.size / 3.5) : 1;
      out.push({ sheet: si, pos, ref: `a${i + 1}`, key: `ann:${a.id}`, kind: a.type === "text" ? "text" : "note", text, lines: lineCount(text) * tall, by: a.by ?? "user" });
    });
    if (si === main) {
      (extra.legend ?? []).forEach((l0, n) => {
        const l = genLine(l0, "user");
        out.push({ sheet: si, pos, ref: tr("legenda"), key: `legend:${n}`, kind: "legend", text: l.text, lines: lineCount(l.text), by: l.by });
      });
      for (const l of extra.form ?? []) out.push({ sheet: si, pos, ref: tr("plech"), key: "form", kind: "form", text: l, lines: lineCount(l), by: "auto" });
    }
  });
  return out;
}

/** součet řádků */
export const linesOf = (items: readonly FreeText[]): number => items.reduce((n, x) => n + x.lines, 0);

const who = (b: Origin) => (b === "agent" ? tr("agent") : b === "user" ? tr("ručně") : tr("generátor"));
/** výpis řádků pro hlášku („a3 „Brousit“ (agent) · poznámka „…“ (ručně)“) */
export function freeTextList(items: readonly FreeText[], max = 8, names?: (sheet: number) => string): string {
  const cut = (s: string) => (s.length > 32 ? `${s.slice(0, 31)}…` : s);
  return items.slice(0, max).map((x) => `${x.pos > 0 || names ? (names ? `${names(x.sheet)} ` : tr("list {0} ", x.pos + 1)) : ""}${x.ref} „${cut(x.text.replace(/\s+/g, " "))}“ (${who(x.by)}${x.lines > 1 ? tr(", {0} ř.", x.lines) : ""})`).join(" · ") + (items.length > max ? " …" : "");
}

/** rada k hlášce o limitu (zkrátit / do razítka / odkaz se šipkou / smazat) */
export const limitHint = (): string =>
  tr("zkraťte a slučte řádky; údaje razítka zapište do razítka (výkres razítko tepelné=… tvrdost=… povrch=… hrany=… drsnost=…, výkres nepředepsané ISO 2768-mK); popis plochy jako odkaz se šipkou v modelu (poznámka F7 \"…\"); oblastní úpravu jako čerchovanou čáru (úprava F7 tepelná \"58+2 HRC\"); nadbytečné smažte (výkres smazat a3)");

// ---------------------------------------------------------------- kontrola všech kanálů textu (R1, R2, R4, R5, R7)

export type AuditCode = "drawing.notes-limit" | "drawing.note-style" | "drawing.note-title-data" | "drawing.notes-sheet" | "drawing.leaders-limit" | "drawing.note-not-model";
export type AuditFinding = {
  code: AuditCode;
  by: Origin;
  /** index listu v dokumentu; -1 = model (popis / úprava plochy) nebo celý dokument (limit) */
  sheet: number;
  /** položka (ann:<id>, meta:<pole>, rev:<A>, pmi:<id>, legend:<n>, doc) – porovnání stavu před a po příkazu */
  key: string;
  /** text položky (kvůli porovnání před / po) */
  item: string;
  text: string;
  data?: Record<string, unknown>;
};
export type AuditInput = Pick<CadDoc, "drawings"> & Partial<Pick<CadDoc, "functional" | "materialName" | "kind">> & { materialBy?: By };

/** úroveň nálezu: agent = ✗ (pravidla jsou pro agenta závazná), člověk / generátor = ℹ nenápadná rada; popis jen na výkrese ⚠ */
export const findingLevel = (f: Pick<AuditFinding, "by" | "code">): "error" | "warn" | "note" => (f.by !== "agent" ? "note" : f.code === "drawing.note-not-model" ? "warn" : "error");

const cut = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** údaj razítka doložený hodnotou (tvrdost s HRC, ISO 2768, Ra / N7, sražení 0,5×45°, povlak RAL / Zn, označení materiálu) */
const STRONG: Partial<Record<TitleDataKey, RegExp[]>> = { hardness: [HARD_RE], tolerance: [TOL_RE], roughness: [RA_RE, NCLASS_RE], edges: [CHAMFER_RE, EDGE_ISO_RE], surfaceTreatment: [COAT_RE], material: [WNR_RE, EN_STEEL_RE] };

/**
 * R1 v textu, který poznámkou není (kóta, značka, název, revize): údaj razítka doložený hodnotou (`allow` = pole, která
 * v tomto kanálu smí být – drsnost u značky drsnosti). Jen slovo („Hranol“, „Kalicí přípravek“, „doplněna hrana“) nestačí.
 */
function titleDataIn(text: string, allow: TitleDataKey[] = []): NoteClass["parts"] {
  const c = classifyNote(text);
  return c ? c.parts.filter((p) => !allow.includes(p.key) && (STRONG[p.key] ?? []).some((re) => re.test(text))) : [];
}

/** popisy a úpravy plochy v modelu (doc.functional) */
const pmiMarks = (doc: AuditInput): FunctionalMark[] => (doc.kind === "assembly" || doc.kind === "draft" ? [] : (doc.functional ?? []).filter((m) => (m.kind === "note" || m.kind === "treatment") && !!m.text));

/**
 * Všechny kanály textu dokumentu → nálezy pravidel s původem. Volný text (R4) a místní popisy (R2) se počítají přes celý
 * dokument; každá položka se hodnotí podle svého kanálu. `gen` = řádky generátoru (legenda úprav s původem, plech).
 */
export function auditDoc(doc: AuditInput, gen: GenText = {}, names: (sheet: number) => string = (i) => doc.drawings?.[i]?.name ?? tr("list {0}", i + 1)): AuditFinding[] {
  const out: AuditFinding[] = [];
  const ds = doc.drawings ?? [];
  const push = (f: AuditFinding) => out.push(f);
  // -- R4 volný text celého dokumentu + R5 hlavní list
  const items = ds.length ? freeTextLines(doc, undefined, gen) : [];
  const total = linesOf(items);
  if (total > NOTE_MAX_LINES) {
    const agent = items.filter((x) => x.by === "agent");
    push({ code: "drawing.notes-limit", by: agent.length ? "agent" : items.some((x) => x.by === "user") ? "user" : "auto", sheet: -1, key: "doc", item: String(total), text: tr("{0} řádků volného textu nad razítkem (nejvýš {1} v celém dokumentu – všechny výkresy a listy): {2} – {3}", total, NOTE_MAX_LINES, freeTextList(items, 8, ds.length > 1 ? names : undefined), limitHint()), data: { count: total, max: NOTE_MAX_LINES, agent: linesOf(agent) } });
  }
  const main = mainSheet(doc);
  for (const x of items) {
    if (x.by === "auto") continue;
    if (x.kind !== "legend") {
      const cls = classifyNote(x.text);
      if (cls?.parts.length) {
        push({ code: "drawing.note-title-data", by: x.by, sheet: x.sheet, key: x.key, item: x.text, text: tr("{0} „{1}“ obsahuje údaj razítka ({2}) – patří do razítka: {3}", x.ref, cut(x.text, 60), cls.parts.map((p) => titleDataLabel(p.key)).join(", "), titleHint(cls.parts)), data: { ref: x.ref, fields: cls.parts.map((p) => p.key) } });
        continue;
      }
    }
    for (const l of x.text.split(/\r?\n/)) {
      const why = noteStyle(l);
      if (why) {
        push({ code: "drawing.note-style", by: x.by, sheet: x.sheet, key: x.key, item: x.text, text: tr("{0} „{1}“ není heslovitý: {2} – zkraťte (strojařsky, bez vět)", x.ref, cut(l.trim(), 60), why), data: { ref: x.ref } });
        break;
      }
    }
    if (x.kind === "text") {
      const a = ds[x.sheet]?.annotations.find((q) => `ann:${q.id}` === x.key);
      if (a?.type === "text" && a.size > TEXT_MAX_H) push({ code: "drawing.note-style", by: x.by, sheet: x.sheet, key: x.key, item: x.text, text: tr("{0} „{1}“: výška písma {2} mm – nejvýš {3} mm (vysoké písmo limit řádků neobejde)", x.ref, cut(x.text), a.size, TEXT_MAX_H), data: { ref: x.ref, size: a.size } });
    }
    if (x.kind !== "legend" && x.sheet !== main) {
      push({ code: "drawing.notes-sheet", by: x.by, sheet: x.sheet, key: x.key, item: x.text, text: tr("{0} „{1}“ je na listu „{2}“ – volný text patří jen na hlavní list „{3}“ (pohledy s kótami) nad razítko; žádný list ani výkres jen s poznámkami", x.ref, cut(x.text), names(x.sheet), names(main)), data: { ref: x.ref, main } });
    }
  }
  // -- R2 místní popisy: odkazy z modelu + odkazy na výkrese; popis jen na výkrese = ne jeden zdroj
  const marks = pmiMarks(doc);
  const leaders: { by: Origin; text: string; where: string }[] = marks.filter((m) => m.kind === "note").map((m) => ({ by: m.by ?? "user", text: m.text!, where: tr("model F{0}", (m.face?.index ?? 0) + 1) }));
  ds.forEach((s, si) =>
    s.annotations.forEach((a, i) => {
      if (a.type !== "note" || isFreeAnn(a)) return;
      leaders.push({ by: a.by ?? "user", text: a.text, where: `${names(si)} a${i + 1}` });
      const by = a.by ?? "user";
      const why = noteStyle(a.text, LEADER_MAX_CHARS, 5);
      if (why) push({ code: "drawing.note-style", by, sheet: si, key: `ann:${a.id}`, item: a.text, text: tr("a{0} „{1}“ u odkazu není heslovitý: {2} – popis u plochy krátce (např. „Brousit“)", i + 1, cut(a.text), why) });
      const bad = titleDataIn(a.text, ["edges"]);
      if (bad.length) push({ code: "drawing.note-title-data", by, sheet: si, key: `ann:${a.id}`, item: a.text, text: tr("a{0} „{1}“: {2} u odkazu – údaje celého dílu do razítka ({3}), úprava jen plochy do modelu (úprava F7 tepelná \"58+2 HRC\")", i + 1, cut(a.text), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint(bad)) });
      if (by === "agent") push({ code: "drawing.note-not-model", by, sheet: si, key: `ann:${a.id}`, item: a.text, text: tr("a{0} „{1}“ je popis jen na výkrese – místní popis patří k ploše do modelu (poznámka F7 \"{1}\"), výkres ho převezme se šipkou (jeden zdroj); tento odkaz pak smažte (výkres smazat a{0})", i + 1, cut(a.text)) });
    }),
  );
  if (leaders.length > NOTE_MAX_LEADERS) {
    const agent = leaders.some((l) => l.by === "agent");
    push({ code: "drawing.leaders-limit", by: agent ? "agent" : "user", sheet: -1, key: "doc:leaders", item: String(leaders.length), text: tr("{0} místních popisů (odkazů se šipkou) – nejvýš {1} v celém dokumentu: {2} – sluč popisy stejné úpravy, údaje celého dílu dejte do razítka", leaders.length, NOTE_MAX_LEADERS, leaders.slice(0, 6).map((l) => `${l.where} „${cut(l.text, 20)}“`).join(" · ") + (leaders.length > 6 ? " …" : "")), data: { count: leaders.length, max: NOTE_MAX_LEADERS } });
  }
  // -- popisy a předpisy úprav v modelu (i z JSON): krátce, heslovitě; popis bez údaje razítka
  for (const m of marks) {
    const by = m.by ?? "user";
    const f = `F${(m.face?.index ?? 0) + 1}`;
    const why = noteStyle(m.text!, LEADER_MAX_CHARS, 5);
    if (why) push({ code: "drawing.note-style", by, sheet: -1, key: `pmi:${m.id}`, item: m.text!, text: tr("model {0} „{1}“: {2} – popis / předpis u plochy krátce a heslovitě (nejvýš {3} znaků)", f, cut(m.text!), why, LEADER_MAX_CHARS) });
    else if (m.kind === "note") {
      const bad = titleDataIn(m.text!, ["edges", "roughness"]);
      if (bad.length) push({ code: "drawing.note-title-data", by, sheet: -1, key: `pmi:${m.id}`, item: m.text!, text: tr("model {0} „{1}“ obsahuje {2} – úprava jen této plochy = úprava {0} tepelná|povrchová \"…\", úprava celého dílu do razítka ({3})", f, cut(m.text!), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint(bad)) });
    }
  }
  // -- značky s textem: kóty, popisy děr, drsnost, geometrické tolerance, základny
  ds.forEach((s, si) =>
    s.annotations.forEach((a, i) => {
      const by = a.by ?? "user";
      const ref = `a${i + 1}`;
      const chk = (what: string, v: string | undefined, max: number, maxWords: number, allow: TitleDataKey[] = []) => {
        const t = (v ?? "").trim();
        if (!t) return;
        const why = noteStyle(t, max, maxWords);
        const bad = titleDataIn(t, allow);
        if (why) push({ code: "drawing.note-style", by, sheet: si, key: `ann:${a.id}`, item: t, text: tr("{0} {1} „{2}“: {3} – u značky jen krátký technický údaj, ne poznámka", ref, what, cut(t), why) });
        else if (bad.length) push({ code: "drawing.note-title-data", by, sheet: si, key: `ann:${a.id}`, item: t, text: tr("{0} {1} „{2}“ obsahuje údaj razítka ({3}) – patří do razítka: {4}", ref, what, cut(t), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint(bad)) });
      };
      switch (a.type) {
        case "dim":
          chk(tr("text kóty"), a.text, DIM_TEXT_MAX, 4, ["tolerance"]);
          chk(tr("předpona kóty"), a.prefix, 12, 2);
          chk(tr("přípona kóty"), a.suffix, DIM_TEXT_MAX, 4, ["tolerance"]);
          break;
        case "callout":
          for (const l of a.lines) chk(tr("popis"), l, CALLOUT_MAX, 6, ["tolerance", "edges"]);
          chk(tr("tolerance popisu"), a.tol, 16, 2, ["tolerance"]);
          break;
        case "roughness":
          chk(tr("drsnost"), a.ra, DIM_TEXT_MAX, 3, ["roughness"]);
          break;
        case "gdt":
          chk(tr("geometrická tolerance"), a.value, 16, 2, ["tolerance"]);
          chk(tr("základna tolerance"), a.datum, 8, 1);
          break;
        case "datum":
          chk(tr("základna"), a.label, 3, 1);
          break;
      }
    }),
  );
  // -- buňky razítka a tabulka revizí
  ds.forEach((s, si) => {
    const m = s.meta as Record<string, unknown>;
    for (const k of [...TITLE_TECH_FIELDS, ...TITLE_FREE_FIELDS]) {
      const v = str(m[k]).trim();
      if (!v) continue;
      const by = metaBy(m, k);
      // nepředepsané tolerance zapisuje příkaz `výkres nepředepsané` i jako tabulku („X. ±0,1 / X.X ±0,1 / …“) – delší buňka
      const tech = (TITLE_TECH_FIELDS as readonly string[]).includes(k) && k !== "tolerance";
      const why = noteStyle(v, tech ? TITLE_VALUE_MAX : k === "tolerance" ? NOTE_MAX_CHARS : TITLE_FREE_MAX, tech ? 5 : NOTE_MAX_WORDS);
      if (why) {
        push({ code: "drawing.note-style", by, sheet: si, key: `meta:${k}`, item: v, text: tr("buňka razítka {0} „{1}“: {2} – hodnota buňky heslovitě (např. tepelné=\"kalit a popustit\", tvrdost=\"58-60 HRC\")", k, cut(v), why) });
        continue;
      }
      if (TITLE_NO_DATA.has(k)) {
        const bad = titleDataIn(v);
        if (bad.length) push({ code: "drawing.note-title-data", by, sheet: si, key: `meta:${k}`, item: v, text: tr("buňka razítka {0} „{1}“ obsahuje údaj jiného pole ({2}) – zapište ho do jeho buňky: {3}", k, cut(v), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint(bad)) });
      }
    }
    // název listu a výkresu (razítko „List …“, záložka) – krátce, bez vět a bez údajů razítka
    for (const [k, v] of [["sheetName", s.name], ["drawingName", s.drawing ?? ""]] as const) {
      const t = (v ?? "").trim();
      if (!t) continue;
      const by = metaBy(m, k);
      const why = noteStyle(t, TITLE_FREE_MAX, 6);
      const bad = why ? [] : titleDataIn(t);
      if (why || bad.length) push({ code: why ? "drawing.note-style" : "drawing.note-title-data", by, sheet: si, key: `meta:${k}`, item: t, text: why ? tr("název {0} „{1}“: {2} – název listu / výkresu krátce (např. „Detail“, „Řezy“)", k === "sheetName" ? tr("listu") : tr("výkresu"), cut(t), why) : tr("název {0} „{1}“ obsahuje údaj razítka ({2}) – patří do razítka: {3}", k === "sheetName" ? tr("listu") : tr("výkresu"), cut(t), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint(bad)) });
    }
    for (const r of (m.revisions as Rev[] | undefined) ?? []) {
      const v = (r.note ?? "").trim();
      // popis revize, který napsal CAD sám při vydání listu (cad/doc-outputs.ts `issueSheet`), je údaj generátoru
      if (!v || isGeneratedRevision(v)) continue;
      const by = r.by ?? "user";
      const why = noteStyle(v, REV_MAX);
      if (why) {
        push({ code: "drawing.note-style", by, sheet: si, key: `rev:${r.rev}`, item: v, text: tr("revize {0} „{1}“: {2} – popis změny krátce (např. „Ø20 → Ø22“, „doplněna díra Ø9“)", r.rev, cut(v), why) });
        continue;
      }
      // údaj razítka v revizi jen jako popis změny buňky, která ho v razítku nese
      const bad = titleDataIn(v).filter((p) => !(p.key === "material" ? !!doc.materialName?.trim() : str(m[p.key]).trim()));
      if (bad.length) push({ code: "drawing.note-title-data", by, sheet: si, key: `rev:${r.rev}`, item: v, text: tr("revize {0} „{1}“ nese údaj razítka ({2}), který v razítku není – zapište ho do razítka: {3}", r.rev, cut(v), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint(bad)) });
    }
  });
  if (ds.length && doc.materialName?.trim()) {
    const v = doc.materialName.trim();
    const why = noteStyle(v, TITLE_VALUE_MAX, 4);
    const bad = titleDataIn(v, ["material"]);
    if (why || bad.length) push({ code: why ? "drawing.note-style" : "drawing.note-title-data", by: doc.materialBy ?? "user", sheet: -1, key: "doc:material", item: v, text: why ? tr("materiál „{0}“: {1} – označení materiálu heslovitě (např. „1.2379“, „C45“)", cut(v), why) : tr("materiál „{0}“ obsahuje údaj jiného pole ({1}) – zapište ho do jeho buňky: {2}", cut(v), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint(bad)) });
  }
  return out;
}

/** popis revize, který vytvořil CAD při vydání listu (`výkres vydat` – cad/doc-outputs.ts) */
const isGeneratedRevision = (v: string): boolean => v === tr("první vydání") || v === tr("změna údajů dílu (název, číslo, materiál, druh položky)") || new RegExp(`^${tr("změna modelu {0} → {1}", "\u0001", "\u0002").replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\u0001", "\\S+").replace("\u0002", "\\S+")}$`).test(v);

/** textová podoba každé položky dokumentu (list|klíč → text) – co příkaz změnil, se pozná porovnáním před / po */
export function auditItems(doc: AuditInput, gen: GenText = {}): Map<string, string> {
  const out = new Map<string, string>();
  const ds = doc.drawings ?? [];
  ds.forEach((s, si) => {
    for (const a of s.annotations) out.set(`${si}|ann:${a.id}`, annSig(a));
    const m = s.meta as Record<string, unknown>;
    for (const k of TEXT_FIELDS) if (str(m[k]).trim()) out.set(`${si}|meta:${k}`, str(m[k]).trim());
    out.set(`${si}|meta:sheetName`, s.name ?? "");
    out.set(`${si}|meta:drawingName`, s.drawing ?? "");
    for (const r of (m.revisions as Rev[] | undefined) ?? []) out.set(`${si}|rev:${r.rev}`, r.note ?? "");
  });
  for (const m of pmiMarks(doc)) out.set(`-1|pmi:${m.id}`, m.text ?? "");
  if (doc.materialName?.trim()) out.set("-1|doc:material", doc.materialName.trim());
  void gen;
  return out;
}

/**
 * Nálezy agenta, které příkaz způsobil: u položky, kterou příkaz zapsal nebo změnil (`auditItems` před / po se liší), a limit,
 * který příkaz zvýšil. Nález u položky, kterou příkaz neměnil (hlavní list se posunul, starší položka), příkaz nezastaví –
 * ohlásí ho vyhodnocení listu ✗.
 */
export function newAgentFindings(before: readonly AuditFinding[], after: readonly AuditFinding[], itemsBefore: Map<string, string>, itemsAfter: Map<string, string>): AuditFinding[] {
  return after.filter((f) => {
    if (f.by !== "agent" || findingLevel(f) !== "error") return false;
    if (f.code === "drawing.notes-limit" || f.code === "drawing.leaders-limit") {
      const p = before.find((b) => b.code === f.code);
      return !p || Number(f.item) > Number(p.item);
    }
    // legenda úprav: zapsala ji úprava v modelu (engine/ops/functional.ts kontroluje sama)
    if (f.key.startsWith("legend:")) return false;
    const id = `${f.sheet}|${f.key}`;
    return itemsAfter.get(id) !== itemsBefore.get(id);
  });
}

export type NotesFinding = { code: AuditCode | "drawing.notes-limit"; level: "error" | "warn" | "note"; text: string; data?: Record<string, unknown> };

/**
 * R7 (starší rozhraní testů a nápovědy): nálezy pravidel pro listy `sheets` (bez listů = celý dokument) s úrovní podle původu.
 */
export function notesRuleIssues(doc: AuditInput, sheets?: number[], extra: GenText = {}): NotesFinding[] {
  const all = auditDoc(doc, extra);
  return all.filter((f) => !sheets || f.sheet < 0 || sheets.includes(f.sheet)).map((f) => ({ code: f.code, level: findingLevel(f), text: f.text, ...(f.data ? { data: f.data } : {}) }));
}

/** text měřítka pro stav: „Poznámky nad razítkem: 3/5 řádků (agent 2, ručně 1) · místní popisy 2/8“ */
export function notesBudgetLine(doc: AuditInput, _sheets?: number[], extra: GenText = {}): string {
  const items = freeTextLines(doc, undefined, extra);
  const by = (b: Origin) => linesOf(items.filter((x) => x.by === b));
  const parts = [by("agent") ? tr("agent {0}", by("agent")) : "", by("user") ? tr("ručně {0}", by("user")) : "", by("auto") ? tr("generátor {0}", by("auto")) : ""].filter(Boolean);
  const leaders = pmiMarks(doc).filter((m) => m.kind === "note").length + (doc.drawings ?? []).reduce((n, s) => n + s.annotations.filter((a) => a.type === "note" && !isFreeAnn(a)).length, 0);
  return tr("Poznámky nad razítkem: {0}/{1} řádků{2} · místní popisy {3}/{4}", linesOf(items), NOTE_MAX_LINES, parts.length ? ` (${parts.join(", ")})` : "", leaders, NOTE_MAX_LEADERS);
}
