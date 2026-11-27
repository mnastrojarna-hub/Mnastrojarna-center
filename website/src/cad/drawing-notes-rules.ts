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
import type { CadDoc, DrawingAnnotation, DrawingDoc, Feature, FunctionalMark } from "./types";

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

/** neviditelné znaky (měkké dělení, nulová mezera, spojovače, BOM) – klasifikaci neobejdou (vlna 23, kolo 4, F9) */
export const INVISIBLE_RE = /[\u00AD\u034F\u180E\u200B-\u200F\u2060-\u2064\uFEFF]/g;
/** text bez neviditelných znaků, typografické pomlčky (nedělitelná, minus) jako „-“ */
export const vis = (s: string): string => s.replace(INVISIBLE_RE, "").replace(/[\u2010\u2011\u2012\u2212]/g, "-");
const fold = (s: string) => vis(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

/** začátky slov (bez diakritiky) – tepelné zpracování (cs / en / de); nitridace je tepelně-chemické zpracování */
const HEAT = ["kalit", "kalen", "zakal", "prokal", "popoust", "popust", "zihan", "zihat", "zihn", "vyzih", "normaliz", "cementov", "cementac", "nitrid", "nitrocement", "karbonitrid", "vytvrd", "vytvrz", "tvrdit", "tvrzen", "zatvrd", "indukc", "zuslecht", "harden", "quench", "temper", "anneal", "carburi", "nitrocarbur", "induction", "case-hard", "hart", "gehart", "gehaert", "haert", "vergut", "verguet", "anlass", "angelass", "gluh", "glueh", "gegluh", "einsatzh", "aufkohl", "nitrier", "induktiv", "flammh", "stabiliz", "kryogen", "cryogen", "tiefkuhl", "tenifer", "tufftrid", "qpq", "nitrocarb", "spannungsarm", "entspann", "tvrzen"];
/** zkratky tepelného zpracování jako celé slovo (CHT = hloubka cementace / kalené vrstvy, EHT, NHT) */
const HEAT_EXACT = new Set(["cht", "eht", "nht", "sht"]);
const SURFACE = ["cernit", "cernen", "brunyr", "brunir", "chromat", "cinov", "pocin", "kataforez", "katafor", "nater", "natrit", "nastrik", "metaliz", "kathod", "tauchlack", "verzinn", "blackox", "e-coat", "ecoat", "zinkov", "pozink", "galvan", "chromov", "pochrom", "niklov", "poniklov", "elox", "anodiz", "anodis", "lakov", "nalakov", "praskov", "fosfat", "pasivov", "trysk", "povlak", "pisk", "otryskat", "kulickov", "blacken", "zincplat", "galvaniz", "plated", "plating", "chrome", "nickel", "paint", "powder", "coating", "coated", "phosphat", "passivat", "sandblast", "shotblast", "beadblast", "blast", "brunier", "verzink", "verchrom", "vernickel", "eloxier", "lackier", "beschicht", "phosphatier", "sandstrahl", "kugelstrahl", "strahl", "pulverbe", "povrch", "surface", "oberflach", "pasiv", "passiv", "geomet", "dacromet", "deltatone", "smalt", "emailier", "fosf", "phosph"];
const SURFACE_EXACT = new Set(["tin", "tialn", "ticn", "crn", "dlc", "pvd", "cvd", "eloxal", "zn", "znni", "fezn", "ral", "zink", "zinc", "zinek", "nikl", "ni", "chemni", "chrom", "ktl", "kts"]);
const EDGES = ["sraz", "otrep", "odjehl", "odhrot", "omil", "otup", "fazet", "deburr", "burr", "chamfer", "edge", "corner", "kant", "ecke", "entgrat", "grat", "fase", "gebrochen", "brechen"];
/** kolo 5 (correct-F5): slova, která začínají jako tepelné zpracování, ale jsou povlakem („Hartcoat“, „Hartverchromt“) nebo
 *  materiálem („Hartmetall“, „Tvrdokov“) – rozhodují dřív než seznam HEAT */
const SURFACE_FIRST = ["hartcoat", "hartanod", "hartverchrom", "hartchrom", "hardcoat", "hardanod", "hardchrom", "harteloxal"];
/** hrana / roh jako celé slovo („Hranol“ hranou není) */
const EDGE_WORDS = new Set(["hrana", "hrany", "hran", "hranu", "hrane", "hranach", "hranami", "hranam", "roh", "rohy", "rohu", "rohach", "rohum"]);
const TOL = ["nepredepsan", "volnerozmer", "volnemir", "obecnetoler", "allgemeintoler", "freimass", "toleranc", "toleranz", "unspecified", "unbemass", "untoleriert", "untolerated"];
/** zkratky jako celé slovo: „Tol. ±0,1“, „Mat. 11 523“ */
const TOL_EXACT = new Set(["tol"]);
const MAT_EXACT = new Set(["mat", "werkst", "wst"]);
const ROUGH = ["drsnost", "roughness", "rauheit", "rauigkeit", "oberflachenrauh"];
const HARDW = ["tvrdost", "hardness", "harte", "haerte", "rockwell", "vickers", "brinell"];
const MATERIAL = ["material", "werkstoff", "materiau", "polotovar"];
/** druh materiálu („Ocel C45“, „Ocel 19 436“) – údaj razítka jen v krátkém zápisu, ve větě („předpis výrobce oceli“) ne */
const MATERIAL_FAMILY = ["ocel", "steel", "stahl", "hlinik", "aluminium", "aluminum", "mosaz", "brass", "messing", "bronz", "litina", "nerez", "dural", "silumin", "tvrdokov", "hartmetall", "hardmetal", "karbid", "carbide", "hss"];
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
// jednotka vpředu: zatížení HV jen připojené bez mezery („HV10 600“) – „HV 650“ je 650 HV, ne „0 HV65“ (kolo 4, F4)
// kolo 5 (correct-F4): rozsah i „÷“ a „/“ („58÷62 HRC“, „58/60 HRC“ – jen celá čísla, ne „1.2379 / 58 HRC“), mez „≥ 58 HRC“,
// „HRC ≥ 58“, „min. 58 HRC“ a tolerance za jednotkou („58 HRC ±2“ = 56–60 HRC, nikdy obecná tolerance ±2)
const HARD_UNIT = String.raw`(?:HRC|HRB|HRA|HV\s?(?:0[.,]\d{1,2}|\d{1,2})?|HBW|HB)`;
const HARD_UNIT_FRONT = String.raw`(?:HRC|HRB|HRA|HV(?:0[.,]\d{1,2}|\d{1,2})?|HBW|HB)`;
const HARD_NUM = String.raw`(?:\d{2,4}\s*[÷\/]\s*\d{2,4}|\d+(?:[.,]\d+)?(?:\s*(?:[-–…÷]|\+\s*\/?\s*-?|±|až|to|bis)\s*\d+(?:[.,]\d+)?)?)`;
const HARD_PRE = String.raw`(?:(?:min\.?|max\.?|[≥≤]|[<>]=?)\s*)?`;
const HARD_TAIL = String.raw`(?:\s*(?:±\s*\d+(?:[.,]\d+)?|\+\s*\d+(?:[.,]\d+)?(?:\s*\/\s*-\s*\d+(?:[.,]\d+)?)?|(?:min|max)\b\.?))?`;
const HARD_RE = new RegExp(String.raw`((?<![\d.,])${HARD_PRE}${HARD_NUM}\s*${HARD_UNIT}\b${HARD_TAIL}|\b${HARD_UNIT_FRONT}\s*${HARD_PRE}${HARD_NUM}${HARD_TAIL})`, "i");
const TOL_RE = /((?:(?:ČSN|CSN|DIN)\s+)?(?:EN\s+)?ISO\s*)?(?:2768\s*[-–]?\s*(?:[12]\s*[-–]?\s*)?([fmcv])\s*[-/]?\s*([HKL])?\b|22081)/i;
/** starší obecné tolerance DIN 7168 (f, m, g, sg) */
const DIN7168_RE = /\bDIN\s*7168\s*[-–]?\s*(sg|f|m|g)\b/i;
/** ISO 2768 s třídou slovem („DIN ISO 2768 mittel“, „ISO 2768 medium“) nebo bez třídy („ISO 2768“ – neúplné) */
const TOL_WORD_RE = /(?:(?:ČSN|CSN|DIN)\s+)?(?:EN\s+)?ISO\s*2768(?:\s*[-–]?\s*(mittel|fein|grob|sehr\s*grob|medium|fine|coarse|very\s*coarse|st[řr]edn\w*|jemn\w*|hrub\w*|velmi\s*hrub\w*))?/i;
const TOL_CLASS: Record<string, string> = { mittel: "m", medium: "m", fein: "f", fine: "f", grob: "c", coarse: "c" };
/** stupeň přesnosti IT (ISO 286) jako obecná tolerance („IT12“) */
const IT_RE = /\bIT\s?(?:0[01]|1[0-8]|[1-9])\b/;
/** obecná tolerance zapsaná hodnotou („±0,1“) – s nekótovanými rozměry / slovem tolerance */
const PM_RE = /±\s*\d+(?:[.,]\d+)?|(?:^|\s)\+\s*\d+(?:[.,]\d+)?\s*\/\s*-\s*\d+(?:[.,]\d+)?/;
const RA_RE = /\b(R[az]|Rmax)\s*[=:]?\s*(\d+(?:[.,]\d+)?)/;
/** všechny hodnoty drsnosti v textu i s mezí („Rz 6,3 / Ra 0,8“, „Ra 0,8 max“) – kolo 5: přesun nesmí žádnou ztratit */
const RA_ALL_RE = /\b(R[az]|Rmax)\s*[=:]?\s*(\d+(?:[.,]\d+)?)(\s*(?:max|min)\b\.?)?/g;
/** zásada nezávislosti ISO 8015 – patří k nepředepsaným tolerancím (kolo 5: „ISO 2768-mK / ISO 8015“ zůstane celé) */
const ISO8015_RE = /\b(?:(?:ČSN|CSN|DIN)\s+)?(?:EN\s+)?ISO\s*8015\b/i;
/** třída drsnosti N1–N12 (ISO 1302) */
const NCLASS_RE = /\bN(?:1[0-2]|[1-9])\b/;
const WNR_RE = /\b1\.\d{4}\b/;
/** materiál: ČSN (19 436, 11 523.1), EN (C45, S235JR, 42CrMo4, X153CrMoV12, EN AW-6082, AlMgSi1, CuZn39Pb3) */
const CSN_RE = /\b1[0-9]\s?\d{3}(?:\.\d{1,2})?\b/;
/** ČSN ocel bez slova materiálu: třída 11–19 a mezera („11 523“, „19 436.4“) – ne počet kusů („15 000 ks“) */
const CSN_BARE_RE = /\b1[1-9]\s\d{3}(?:\.\d{1,2})?\b(?!\s*(?:ks|kus|pcs|stk|stück|x|×|mm|m\b|kg|nm|h\b|min|%|,-|kč|eur))/i;
const EN_STEEL_RE = /\b(?:C\d{2,3}E?|DC0[1-7]|DD1[1-4]|DX5[1-7]D?|Ms\s?\d{2}|CW\d{3}[A-Z]|Ck\d{2,3}|AISI\s?\d{3}[A-Z]?|EN[-\s]?GJ[LSM][A-Z]?-?\d{2,4}(?:-\d{1,2})?|GGG?-?\d{2,3}|Hardox\s?\d{0,3}|Toolox\s?\d{0,2}|Weldox\s?\d{0,4}|Strenx\s?\d{0,4}|Domex\s?\d{0,4}|PA\s?\d{1,2}(?:\.\d)?|POM(?:-[CH])?|PEEK|PTFE|PE-?(?:HD|LD|UHMW|\d{3,4})|PVC|PMMA|ABS|S\d{3}(?:JR|J0|J2|MC)?|\d{2,3}(?:Cr|Mn|Ni|Mo|Si|V|W){1,4}\d{1,2}(?:-\d{1,2})*|X\d{1,3}(?:Cr|Mo|Ni|V|W|Mn|Co|Si|Ti|N){1,5}\d{0,2}(?:-\d{1,2})*|EN\s?AW-?\d{4}|Al(?:Mg|Si|Cu|Zn)\w*|CuZn\d\w*|CuSn\d\w*|100Cr6|S[tT]\s?\d{2}(?:-\d)?|Al\s?[2-7]\d{3}(?:\s?-?\s?T\d{1,4})?|[2-7]\d{3}\s?-?\s?T\d{1,4}|HSS(?:-?E)?(?:-?PM)?|(?:K(?:100|105|107|110|190|294|305|340|353|360|390|460|490|600|720|890)|M(?:200|201|238|261|268|300|303|310|314|333|340|368|390|398)|S(?:290|390|393|500|600|690|700|705)|W(?:300|302|303|320|360|400|500))(?:\s?(?:ISOPLAST|ISODISC|MICROCLEAN|AMPO))?|(?:Tvrdokov|Hartmetall|Carbide|Karbid)\s?[KPMN]\d{2})\b/;
/** nástrojové oceli obchodním názvem (Uddeholm, Böhler, PM oceli, JIS) – v nástrojárně běžné označení materiálu (kolo 4, bod 9) */
const TOOL_STEEL_RE = /\b(?:(?:Vanadis|Sverker|Elmax|Calmax|Caldie|Vancron|Vanax|Uddeholm|Orvar|Stavax|Rigor|Impax|Nimax|Dievar|Unimax|Mirrax|Corrax|Ramax|Sleipner|Formvar|Holdax|Polmax|Thyrodur|Thyroplast|Thyrotherm|Cryodur|Toolox|Hardox)(?:\s?(?:ESR|SuperClean|Supreme|HH|Extra))?(?:\s?\d{1,4})?|(?:Böhler|Bohler|Boehler)(?:\s?[A-Z]\d{3})?|CPM\s?\d{1,2}V|CPM\s?[A-Z]\d{1,2}V?|ASP\s?\d{2}|SKD\s?\d{1,2}|SKH\s?\d{1,2}|(?:AISI|tool\s+steel|ocel)\s+(?:D2|D3|O1|A2|M2|H13|S7|P20))\b/i;
const EDGE_ISO_RE = /ISO\s*13715\b/i;
/** sražení hrany bez slova („0,5x45°“, „1×45“) */
const CHAMFER_RE = /\b\d+(?:[.,]\d+)?\s*[x×]\s*45\s*°?|\bC\s?(?:\d[.,]\d+|[1-9])\b(?![.,]?\d)/i;
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
  /** kolo 5 (correct-F4): části textu, které by přesun ztratil nebo rozdělil do jiné buňky („58÷“, „ISO 8015“) – nepřesouvá se */
  lost?: string[];
};

type SegKinds = { kinds: Set<TitleDataKey>; extra: string[]; hard?: string; tol?: string; ra?: string; mat?: string; /** údaj neúplný („ISO 2768“ bez třídy) – do razítka se nepřesune, agent ho doplní */ incomplete?: boolean; /** rozměr v textu (Ø20, R5, M8) – „Ø20 ±0,1“ není obecná tolerance */ dimRef?: boolean };

/** tvrdost s jednotkou vpředu („HRC 58-62“, „HRC58“) → zápis razítka „58-62 HRC“ (stejný tvar, jaký přijme `výkres razítko tvrdost=`) */
export function normHardness(v: string): string {
  const t = v.replace(/\s+/g, " ").trim();
  const m = /^(HRC|HRB|HRA|HV(?:0[.,]\d{1,2}|\d{1,2})?|HBW|HB)\s*((?:(?:min\.?|max\.?|[≥≤]|[<>]=?)\s*)?\d.*)$/i.exec(t);
  return m ? `${m[2].trim()} ${m[1].replace(/\s+/g, "").toUpperCase()}` : t;
}

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
  const dimRef = /[Ø⌀]\s*\d|\bR\s?\d|\bM\d/.test(seg);
  const hard0 = HARD_RE.exec(rest)?.[1];
  const hard = hard0 ? normHardness(hard0) : undefined;
  if (hard0) {
    kinds.add("hardness");
    rest = rest.replace(hard0, " ");
  }
  const tm = TOL_RE.exec(rest);
  let tol: string | undefined;
  let incomplete = false;
  if (tm) {
    kinds.add("tolerance");
    tol = tm[2] ? `ISO 2768-${tm[2].toLowerCase()}${(tm[3] ?? "").toUpperCase()}` : "ISO 22081";
    rest = rest.replace(tm[0], " ");
  } else {
    const tw = TOL_WORD_RE.exec(rest);
    if (tw) {
      kinds.add("tolerance");
      const c = tw[1] ? (TOL_CLASS[fold(tw[1]).replace(/\s+/g, "")] ?? (/^st/.test(fold(tw[1])) ? "m" : /^jem/.test(fold(tw[1])) ? "f" : /^velmi|^very|^sehr/.test(fold(tw[1])) ? "v" : "c")) : "";
      tol = c ? `ISO 2768-${c}` : "ISO 2768-…";
      if (!c) incomplete = true;
      rest = rest.replace(tw[0], " ");
    } else if (DIN7168_RE.test(rest)) {
      const d = DIN7168_RE.exec(rest)!;
      kinds.add("tolerance");
      tol = `DIN 7168-${d[1].toLowerCase()}`;
      rest = rest.replace(d[0], " ");
    } else {
      const it = IT_RE.exec(rest);
      if (it) {
        kinds.add("tolerance");
        tol = it[0].replace(/\s+/g, "");
        rest = rest.replace(it[0], " ");
      }
    }
  }
  // kolo 5: ISO 8015 k nepředepsaným tolerancím (s ISO 2768 v jedné buňce „ISO 2768-mK / ISO 8015“)
  const i8015 = ISO8015_RE.exec(rest);
  if (i8015) {
    kinds.add("tolerance");
    tol = tol ? `${tol} / ISO 8015` : "ISO 8015";
    rest = rest.replace(i8015[0], " ");
  }
  let ra: string | undefined;
  const ras = [...rest.matchAll(RA_ALL_RE)];
  if (ras.length) {
    kinds.add("roughness");
    ra = ras.map((m) => `${m[1]} ${m[2]}${m[3] ? ` ${m[3].trim()}` : ""}`).join(" / ");
    for (const m of ras) rest = rest.replace(m[0], " ");
  } else {
    const n = take(NCLASS_RE);
    if (n) {
      kinds.add("roughness");
      ra = n;
    }
  }
  let mat = take(WNR_RE) ?? take(TOOL_STEEL_RE) ?? take(EN_STEEL_RE) ?? take(CSN_BARE_RE);
  if (mat) kinds.add("material");
  if (EDGE_ISO_RE.test(rest)) {
    kinds.add("edges");
    rest = rest.replace(EDGE_ISO_RE, " ");
  }
  if (take(CHAMFER_RE)) kinds.add("edges");
  if (take(COAT_RE)) kinds.add("surfaceTreatment");
  const ws = words(rest);
  // ČSN ocel jen se slovem materiálu („Ocel 19 436“) – samotné „10 000“ je počet, ne materiál
  if (!mat && ws.some((w) => startsAny(w, MATERIAL) || startsAny(w, MATERIAL_FAMILY) || MAT_EXACT.has(w))) {
    const c = CSN_RE.exec(rest)?.[0];
    if (c) {
      mat = c;
      kinds.add("material");
      rest = rest.replace(c, " ");
    }
  }
  // obecná tolerance hodnotou („Tol. ±0,1“, „Obecně ±0,2“, „±0,1“) – ± kdekoli v poznámce je tolerance (D3)
  if (PM_RE.test(rest)) {
    // kolo 5 (correct-F4): „±“ u jiného údaje (tvrdost, povlak, drsnost) není obecná tolerance – takový text se nepřesune
    if ([...kinds].some((k) => k !== "tolerance")) incomplete = true;
    kinds.add("tolerance");
    tol = tol ?? PM_RE.exec(rest)![0].trim();
    rest = rest.replace(PM_RE, " ");
  }
  const extra: string[] = [];
  const ws2 = words(rest);
  for (let i = 0; i < ws2.length; i++) {
    const w = ws2[i];
    // „tepelné zpracování“, „povrchová úprava“, „obecná drsnost“, „volné rozměry“ jako dvojice slov
    const pair = w + (ws2[i + 1] ?? "");
    if (pair.startsWith("tepelnezprac") || pair.startsWith("heattreat") || pair.startsWith("warmebehand") || pair.startsWith("waermebehand")) kinds.add("heatTreatment");
    if (pair.startsWith("blackox") || pair.startsWith("cernyoxid") || pair.startsWith("schwarzox")) kinds.add("surfaceTreatment");
    if (pair.startsWith("povrchovauprav") || pair.startsWith("surfacetreat") || pair.startsWith("surfacefinish") || pair.startsWith("oberflachenbeh") || pair.startsWith("oberflaechenbeh")) kinds.add("surfaceTreatment");
    // „nekótované rozměry / tolerance“ = nepředepsané tolerance; „nekótované hrany“ jsou hrany (ISO 13715), ne tolerance
    if (startsAny(pair, TOL) || pair.startsWith("generaltoler") || pair.startsWith("obecnetoler") || pair.startsWith("volnerozm") || pair.startsWith("nekotovanerozm") || pair.startsWith("nekotovanetoler") || pair.startsWith("nekotovanychrozm")) kinds.add("tolerance");
    // kolo 5 (correct-F5): slovo i jako složenina („Plazmanitridace“, „Vakuumgehärtet“, „Gasnitrieren“, „Manganfosfát“,
    // „Scharfkantig“) – kmen se hledá i za předponou složeniny (`stripCompound`), ne jen na začátku slova
    const hit = (list: readonly string[]) => startsAny(w, list) || startsAny(stripCompound(w), list);
    if (startsAny(w, HARDW)) kinds.add("hardness");
    else if (startsAny(w, SURFACE_FIRST)) kinds.add("surfaceTreatment");
    else if (startsAny(w, MAT_FIRST)) kinds.add("material");
    else if (hit(HEAT) || HEAT_EXACT.has(w)) kinds.add("heatTreatment");
    else if (startsAny(w, ROUGH)) kinds.add("roughness");
    else if (startsAny(w, TOL) || TOL_EXACT.has(w)) kinds.add("tolerance");
    else if (hit(SURFACE) || SURFACE_EXACT.has(w)) kinds.add("surfaceTreatment");
    else if (hit(EDGES) || EDGE_WORDS.has(w)) kinds.add("edges");
    // „zaoblit“ jen u rohů / hran („Rohy zaoblit R0,5“) – „zaoblení R5“ u kóty je rozměr
    // „Zaoblit R0,5“ (pokyn s poloměrem) je stav hran celého dílu
    else if (w.startsWith("zaobl") && (ws2.some((x) => EDGE_WORDS.has(x)) || (/^zaoblit/.test(w) && /\bR\s?\d/.test(seg)))) kinds.add("edges");
    else if (startsAny(w, MATERIAL) || MAT_EXACT.has(w)) kinds.add("material");
    else if (startsAny(w, MATERIAL_FAMILY)) {
      if (ws2.length <= 3 || mat) kinds.add("material");
    }
    else if (!FILLER.has(w) && !isNum(w) && !/^\d*x\d*$/.test(w)) extra.push(w);
  }
  // údaj bez hodnoty, kterou razítko potřebuje (D3): tvrdost bez jednotky („Tvrdit 58-60“, „Tvrdost 58“), obecná tolerance
  // jen slovem („Allgemeintoleranz“, „Tolerance volných rozměrů m“, „Nepředepsané tolerance střední“) – do razítka se
  // nepřesune, agent dostane ✗ s radou, jak ho zapsat
  if (!hard && (kinds.has("hardness") || kinds.has("heatTreatment")) && /(?:^|[^\d.,])(?:[2-6]\d|[7-9]\d{2}|[1-9]\d{3})(?:\s*[-–…]\s*\d{2,4})?(?![\d.,]|\s*(?:mm|µm|um|°|%|h\b|min|mpa|n\/mm))/i.test(seg.replace(/\b(?:CHT|EHT|NHT|SHT)\s*\d+(?:[.,]\d+)?/gi, " "))) incomplete = true;
  if (kinds.has("tolerance") && !tol) incomplete = true;
  return { kinds, extra, ...(hard ? { hard } : {}), ...(tol ? { tol } : {}), ...(ra ? { ra } : {}), ...(mat ? { mat } : {}), ...(incomplete ? { incomplete } : {}), ...(dimRef ? { dimRef } : {}) };
}

/** popisek pole na začátku části („Hrany:“, „Povrchová úprava –“, „Materiál“) se do hodnoty nepíše */
const LABEL_RE = /^\s*(?:tol\.|mat\.|voln[éeá]\s+(?:míry|rozměry)|obecně|obecne|nek[óo]tovan[éeá]\s+(?:rozměry|tolerance)|nepředepsan[éeá]\s+tolerance|obecn[éeá]\s+tolerance|tolerance|toleranz|tepeln[éeá]\s+zpracování|povrchov[áaé]\s+úprava|povrch|hrany|materi[áa]l|werkstoff|material|edges|kanten|heat\s+treatment|surface(?:\s+treatment)?|oberfl[äa]che|wärmebehandlung|drsnost|roughness|rauheit|tvrdost|hardness|härte)\s*[:–-]?\s*/i;

/**
 * R1: je text údajem razítka? `null` = není (obyčejná poznámka). Jinak části s polem razítka a hodnotou, zbytek textu
 * a příznak `mixed` (údaj razítka uprostřed věty – „Díl po kalení brousit na rovinnost 0,01“: nejde přesunout, agent text
 * rozdělí). Hodnoty: tvrdost s jednotkou („58-60 HRC“, „HRC 58-62“), ISO 2768 třída („ISO 2768-mK“), Ra / N7, W.Nr. / EN /
 * ČSN materiál („1.2379“, „C45“, „19 436“), ostatní = text části bez popisku pole.
 */
export function classifyNote(text: string): NoteClass | null {
  const t = stripEnum(vis(text).replace(/\s+/g, " "));
  const segs = segmentsOf(t);
  const parts: NoteClass["parts"] = [];
  const rest: string[] = [];
  let mixed = false;
  let any = false;
  const lost: string[] = [];
  for (const seg of segs) {
    const k = segKinds(seg);
    if (!k.kinds.size) {
      rest.push(seg);
      continue;
    }
    any = true;
    // víc než 2 slova navíc = věta kolem údaje → nejde čistě přesunout; neúplný údaj / rozměr v textu taky ne
    if (k.extra.length > 2 || k.incomplete || (k.dimRef && k.kinds.has("tolerance"))) mixed = true;
    // hodnota pole = text části bez popisku pole a bez hodnot, které patří jiným polím (tvrdost, ISO 2768, Ra, materiál)
    let body = clean(seg.replace(LABEL_RE, ""));
    for (const x of [k.mat, ...(k.ra ? [...seg.matchAll(RA_ALL_RE)].map((m) => m[0]) : []), k.tol && TOL_RE.exec(seg)?.[0], k.tol && ISO8015_RE.exec(seg)?.[0]]) if (x && body !== x) body = clean(body.replace(x, " "));
    const segVals: string[] = [];
    const push = (key: TitleDataKey, value: string) => {
      const v = clean(value);
      if (!v) return;
      segVals.push(v);
      const had = parts.find((p) => p.key === key);
      if (had) had.value = `${had.value}, ${v}`;
      else parts.push({ key, value: v });
    };
    if (k.hard) push("hardness", k.hard);
    else if (k.kinds.has("hardness")) push("hardness", body);
    if (k.kinds.has("heatTreatment")) {
      // hodnota tepelného zpracování = text bez tvrdosti a výplně na konci („na“, „to“, „auf“)
      push("heatTreatment", body.replace(HARD_RE, " ").replace(/\s+(?:na|to|auf|tvrdost|hardness|härte)\s*$/i, "").replace(/\s+(?:na|to|auf)\s+(?:tvrdost|hardness|härte)\s*$/i, ""));
    }
    if (k.kinds.has("tolerance")) push("tolerance", k.tol ?? body);
    if (k.kinds.has("roughness")) push("roughness", k.ra ?? body);
    // materiál: samotný údaj části v původním pořadí („Ocel C45“, „PA6 natur“), ve směsi s jinými poli jen označení
    if (k.kinds.has("material")) push("material", k.mat ? (k.kinds.size === 1 ? clean(seg.replace(LABEL_RE, "")) : k.mat) : body);
    if (k.kinds.has("surfaceTreatment")) push("surfaceTreatment", body);
    if (k.kinds.has("edges")) push("edges", body);
    // kolo 5 (correct-F4): přesun jen beze ztráty – každý číselný údaj celý v jedné buňce, každé slovo v některé buňce
    const l = lostTokens(seg, segVals);
    if (l.length) {
      mixed = true;
      lost.push(...l);
    }
  }
  if (!any) return null;
  if (rest.length) mixed = true;
  // věta jako hodnota buňky („Nekótované hrany sražení 0,5x45 stupňů, ostré hrany zbavit otřepů“) = do razítka se nepřesune
  if (parts.some((p) => p.value.length > TITLE_VALUE_MAX)) mixed = true;
  return { parts, rest, mixed, ...(lost.length ? { lost: [...new Set(lost)] } : {}) };
}

/** text poznámky bez pořadového čísla a popisku pole („Tvrdost: 58 HRC“ → „58 HRC“) – hodnota celé buňky v radě */
export const noteBody = (text: string): string => clean(stripEnum(vis(text).replace(/\s+/g, " ")).replace(LABEL_RE, ""));

/** slova, která přesun smí vynechat: popisky polí („Tvrdost:“, „Hrany:“, „Nepředepsané tolerance“), třída ISO 2768 slovem, druh materiálu */
const LOSS_OK = [...TOL, ...HARDW, ...ROUGH, ...MATERIAL, ...MATERIAL_FAMILY, "voln", "nekot", "obecn", "allgem", "general", "unspec", "mittel", "fein", "grob", "medium", "fine", "coarse", "stredn", "jemn", "hrub", "velmi", "very", "sehr", "trida", "class", "klasse", "povrch", "surface", "oberfl", "edges", "kanten", "tepeln", "heat", "warmebeh", "waermebeh", "mezn", "uchylk", "abmass", "grenzabm", "deviation", "bez", "ohne", "without", "vsude", "overall", "uberall", "ueberall", "rundum"];
const lossFold = (s: string) => fold(stripEnum(s)).replace(/[÷–—…]/g, "-").replace(/×/g, "x").replace(/\b2768\s*-\s*[12]\b/g, "2768");
/** číselný údaj i s rozsahem / tolerancí („58-62“, „58/60“, „±2“, „0,5x45“, „1.2379/1.2842“) – musí zůstat celý v jedné buňce */
const NUM_GROUP_RE = /[±+]?\s*\d+(?:[.,]\d+)?(?:\s*(?:[-x/]|\+\s*\/?\s*-?|±|az|to|bis)\s*\d+(?:[.,]\d+)?)*/g;
/**
 * Kolo 5 (correct-F4) – kontrola tam a zpět: co by se z textu `text` přesunem do buněk s hodnotami `values` ztratilo nebo
 * rozdělilo. Číselný údaj (i rozsah „58÷62“, tolerance „±2“, dvě hodnoty „Rz 6,3 / Ra 0,8“) musí být celý v jedné buňce,
 * každé slovo mimo popisky polí a výplň v některé buňce. Prázdné pole = přesun je bezeztrátový.
 */
export function lostTokens(text: string, values: readonly string[]): string[] {
  // popisek pole na začátku části („Volné míry“, „Tvrdost:“, „Mat.“) se do hodnoty nepíše – neztrácí se
  const src = lossFold(segmentsOf(stripEnum(vis(text).replace(/\s+/g, " "))).map((x) => x.replace(LABEL_RE, "")).join(" ; "));
  const vals = values.map((v) => lossFold(v).replace(/\s+/g, ""));
  const vw = new Set(values.flatMap((v) => fold(v).match(/[a-z]{2,}/g) ?? []));
  const out: string[] = [];
  for (const m of src.matchAll(NUM_GROUP_RE)) {
    const g = m[0].replace(/\s+/g, "");
    if (!vals.some((v) => v.includes(g))) out.push(m[0].trim());
  }
  for (const w of src.match(/[a-z]{2,}/g) ?? []) if (!vw.has(w) && !FILLER.has(w) && !EDGE_WORDS.has(w) && !MAT_EXACT.has(w) && !TOL_EXACT.has(w) && !startsAny(w, LOSS_OK)) out.push(w);
  return [...new Set(out)];
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
const ABBR = new Set(["chem", "galv", "techn", "mech", "elektr", "tepl", "pov", "mat", "tol", "ing", "mgr", "bca", "doc", "prof", "phd", "tel", "apod", "atd", "tzv", "max", "min", "cca", "resp", "napr", "pozn", "obr", "str", "viz", "dipl", "nr", "art", "ref", "inc", "ltd", "gmbh", "dir", "rev", "pos", "poz"]);

/**
 * R4: důvod, proč řádek není heslovitý (null = v pořádku). Hlídá délku (`max` znaků), počet slov (`maxWords`), více vět,
 * tečku na konci, víc než dvě čárky a slova vět / souvětí („pokud“, „které“, „aby“, „musí“, „please“, „bitte“ …).
 */
export function noteStyle(text: string, max = NOTE_MAX_CHARS, maxWords = NOTE_MAX_WORDS): string | null {
  if (INVISIBLE_RE.test(text)) {
    INVISIBLE_RE.lastIndex = 0;
    return tr("neviditelné znaky v textu (měkké dělení, nulová mezera) – pište text bez nich");
  }
  const t = stripEnum(vis(text).trim());
  if (!t) return null;
  if (t.length > max) return tr("řádek má {0} znaků (nejvýš {1})", t.length, max);
  const ws = t.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (ws.length > maxWords) return tr("{0} slov – heslovitě nejvýš {1}", ws.length, maxWords);
  // víc vět = konec věty (slovo aspoň 3 písmen, ne zkratka „Ing.“, „s.r.o.“, „max.“) a za ním další slovo
  if ([...t.matchAll(/(\p{L}+)[.!?]\s+\p{L}/gu)].some((m) => m[1].length >= 3 && !ABBR.has(fold(m[1])))) return tr("víc vět na řádku");
  // tečka za zkratkou („pozn.“, „max.“, „W.Nr.“) není věta – věta = aspoň tři slova a tečka / ! / ? na konci
  if (ws.length >= 3 && (/[!?]$/.test(t) || (/\.$/.test(t) && !/\b(?:ap|atd|tzv|max|min|cca|resp|tj|tl|č|st|ks|pozn|W\.Nr|s\.r\.o|spol|a\.s|k\.s|v\.o\.s|inc|ltd|co|corp|gmbh|ag|kg|ing|bc|mgr|dr)\.$/i.test(t)))) return tr("věta s tečkou na konci");
  if ((t.match(/,\s+(?=\D)/g) ?? []).length > 2) return tr("víc než dvě čárky (souvětí)");
  // věta rozdělená na řádky („Po obrobení díl očistit,“ / „a odeslat zákazníkovi“) – řádek končí čárkou nebo začíná spojkou
  if (ws.length >= 2 && /[,;]$/.test(t)) return tr("řádek pokračuje na dalším (věta rozdělená na řádky)");
  if (ws.length >= 2 && /^(?:a|i|ale|nebo|pak|potom|poté|načež|and|or|then|und|oder|dann|sowie)\s/u.test(t)) return tr("řádek začíná spojkou (věta rozdělená na řádky)");
  const sw = words(t).find((w) => SENTENCE_W.has(w));
  if (sw) return tr("slovo věty „{0}“", sw);
  return null;
}

// ---------------------------------------------------------------- původ textu (R6: rozhoduje cesta)

export type By = "agent" | "user";
/**
 * Původ textu (vlna 23, D1): agent = vytvořil / změnil ho agent v TOMTO běhu (příkaz textového jazyka, JSON dokument na řádku
 * skriptu, setDocument, mncad.run s dokumentem) → porušení ✗ a export listu se odmítne; loaded = byl v souboru otevřeném
 * z disku (CLI --open, `otevřít` uloženého .mncad / .json, HTTP open) a tento běh ho nezměnil → nikdy ✗, export neblokuje
 * (výkres člověka z archivu musí jít agentem exportovat), ale list dostane ⚠ drawing.notes-loaded místo ✓; user = GUI (ℹ rada).
 */
export type Src = By | "loaded";
/** auto = generátor (poznámka k plechu) */
export type Origin = Src | "auto";

/** technické buňky razítka (hodnota heslovitě, nejvýš TITLE_VALUE_MAX znaků) */
export const TITLE_TECH_FIELDS = ["heatTreatment", "hardness", "surfaceTreatment", "edges", "roughness", "tolerance", "angleTol", "chamferTol", "stock"] as const;
/** ostatní textové buňky razítka */
export const TITLE_FREE_FIELDS = ["name", "number", "author", "date", "revision", "company", "customer", "project", "checkedBy", "approvedBy", "quantity"] as const;
/** buňky, kde údaj razítka (tvrdost, tepelné zpracování …) nemá co dělat – patří do svého pole */
const TITLE_NO_DATA = new Set<string>(["name", "company", "customer", "project", "number", "author", "checkedBy", "approvedBy", "quantity", "date", "revision"]);
const TEXT_FIELDS: string[] = [...TITLE_TECH_FIELDS, ...TITLE_FREE_FIELDS, "note"];

type MetaBy = { by?: Record<string, Src>; noteBy?: Src };
const str = (v: unknown) => (typeof v === "string" ? v : "");
/** původ buňky razítka / poznámky u razítka (chybí = ruční – starší dokument nebo GUI) */
export const metaBy = (m: Record<string, unknown>, k: string): Src => (k === "note" ? (m as MetaBy).noteBy : undefined) ?? (m as MetaBy).by?.[k] ?? "user";

/** textová podstata značky – změna = nový zápis (poloha, odsazení ani přepočet geometrie původ nemění) */
const annSig = (a: DrawingAnnotation): string => {
  const x = a as Record<string, unknown>;
  return JSON.stringify([a.type, x.text, x.prefix, x.suffix, x.lines, x.tol, x.ra, x.value, x.datum, x.label, x.size, x.leader ? 1 : 0, x.free ?? null]);
};
type Rev = { rev: string; note: string; by?: Src };

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
  const map: Record<string, Src> = { ...((nm as MetaBy).by ?? {}) };
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
  // kolo 5 (bypass-F4): popisky pohledů a názvy pohledů modelů se tisknou u pohledu – původ jako u buňky razítka
  const vl = viewLabelSig(next);
  if (vl && vl !== (prev ? viewLabelSig(prev) : "") && map.viewLabels !== by) {
    map.viewLabels = by;
    mChanged = true;
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
 * Dokument, který přišel textovou cestou (D1): `by = "agent"` – JSON řádek skriptu, `window.mncad.setDocument`, mncad.run
 * s dokumentem (obsah vytváří agent v tomto běhu); `by = "loaded"` – soubor otevřený z disku (`otevřít`, CLI `--open`, HTTP
 * open). Všechny texty listů, buňky razítka, revize, název listu / výkresu / dokumentu, popisy a úpravy v modelu a materiál
 * dostanou tento původ – **ať JSON tvrdí cokoli** (`"by":"user"` v souboru nekoupí víc než ⚠ drawing.notes-loaded). Texty
 * 2D výkresu (TEXT / MTEXT / LEADER / kóty / atributy / definice atributů) dostanou týž původ (cad/draft/agent-notes.ts).
 * Výjimka (kolo 4, bod 10 / F1): text, který soubor sám nese jako agentův (`"by":"agent"` – soubor uložil agent, v tomto
 * nebo dřívějším běhu, i běh, který skončil ✗), zůstane agentův – `uložit` + `otevřít` ho na „loaded“ nevypere.
 */
/**
 * Údaje listu, které tvoří generátor (jádro / `sheetMeta`), ne autor – v uloženém / vloženém dokumentu se neberou (kolo 5,
 * bypass-F2): poznámky k plechu, popisy ploch z modelu, kusovník, pozice, svary, tabulky pružin a kol, závity, hmotnost,
 * legenda úprav, revize modelu, číslo listu. Jinak by JSON řádek / `--open` nesl volný text mimo všechny kontroly.
 */
export const GENERATED_META = ["formNotes", "pmi", "bom", "components", "welds", "springData", "gears", "springs", "massKg", "threads", "zoneLegend", "modelRev", "sheetIndex", "sheetCount", "material"] as const;
/** meta listu bez údajů generátoru (vrací kopii; nic ke smazání = tentýž objekt) */
export function withoutGenerated<M extends Record<string, unknown>>(m: M): M {
  if (!GENERATED_META.some((k) => k in m)) return m;
  const out = { ...m } as Record<string, unknown>;
  for (const k of GENERATED_META) delete out[k];
  return out as M;
}

export function stampAgentNotes<T extends Pick<CadDoc, "drawings"> & Partial<Pick<CadDoc, "functional" | "materialName" | "name" | "kind" | "draft">>>(doc: T, by: "agent" | "loaded" = "agent"): T {
  const out: T = { ...doc };
  /** původ položky: agent, nebo „loaded“ – kromě položky, kterou soubor nese jako agentovu */
  const keep = (old: unknown): Src => (by === "loaded" && old === "agent" ? "agent" : by);
  if (doc.drawings?.length) {
    out.drawings = doc.drawings.map((s) => {
      // kolo 5 (bypass-F2): údaje generátoru z JSON / souboru se zahodí – list je spočítá znovu z modelu
      const m = { ...withoutGenerated((s.meta ?? {}) as Record<string, unknown>) };
      const old = ((m as MetaBy).by ?? {}) as Record<string, unknown>;
      const map: Record<string, Src> = {};
      for (const k of TEXT_FIELDS) if (str(m[k]).trim()) k === "note" ? (m.noteBy = keep(m.noteBy)) : (map[k] = keep(old[k]));
      if (s.name?.trim()) map.sheetName = keep(old.sheetName);
      if (s.drawing?.trim()) map.drawingName = keep(old.drawingName);
      if (viewLabels(s).length) map.viewLabels = keep(old.viewLabels);
      if (Object.keys(map).length) m.by = map;
      else delete m.by;
      if (!str(m.note).trim()) delete m.noteBy;
      if (Array.isArray(m.revisions)) m.revisions = (m.revisions as Rev[]).map((r) => ({ ...r, by: keep(r.by) }));
      return { ...s, meta: m, annotations: (s.annotations ?? []).map((a) => ({ ...a, by: keep(a.by) })) };
    });
  }
  if (doc.functional?.length) out.functional = doc.functional.map((f) => (f.kind === "note" || f.kind === "treatment" ? { ...f, by: keep(f.by) } : f));
  // kolo 5 (bypass-F6): texty kusovníku komponent sestavy z JSON / souboru – původ jako ostatní texty
  const comps = (doc as { components?: (Parameters<typeof bomCells>[0] & { textBy?: unknown })[] }).components;
  if (doc.kind === "assembly" && comps?.length) (out as { components?: unknown[] }).components = comps.map((c) => (bomCells(c).length ? { ...c, textBy: keep(c.textBy) } : c));
  if (doc.materialName?.trim()) (out as { materialBy?: Src }).materialBy = keep((doc as { materialBy?: unknown }).materialBy);
  if (doc.name?.trim()) (out as { nameBy?: Src }).nameBy = keep((doc as { nameBy?: unknown }).nameBy);
  if (doc.kind === "draft" && doc.draft) (out as { draft?: unknown }).draft = stampDraftText(doc.draft, by);
  return out;
}

/** typy entit 2D výkresu, které nesou text (cad/draft/agent-notes.ts) */
export const DRAFT_TEXT_TYPES = new Set(["text", "mtext", "leader", "insert", "dimension", "attdef", "tolerance", "surfsym"]);
/** původ textových entit 2D výkresu (model, rozvržení i definice bloků); `loaded` nechá agentovi, co soubor nese jako jeho */
export function stampDraftText<D>(draft: D, by: Src): D {
  const m = draft as unknown as { entities?: { type: string; by?: unknown }[]; layouts?: { entities?: { type: string; by?: unknown }[] }[]; blocks?: { entities?: { type: string; by?: unknown }[] }[] | Record<string, { entities?: { type: string; by?: unknown }[] }> };
  const st = (list?: { type: string; by?: unknown }[]) => list?.map((e) => (DRAFT_TEXT_TYPES.has(e.type) ? { ...e, by: by === "loaded" && e.by === "agent" ? "agent" : by } : e));
  const blocks = Array.isArray(m.blocks) ? m.blocks.map((b) => ({ ...b, entities: st(b.entities) })) : m.blocks ? Object.fromEntries(Object.entries(m.blocks).map(([k, b]) => [k, { ...b, entities: st(b.entities) }])) : undefined;
  return { ...m, ...(m.entities ? { entities: st(m.entities) } : {}), ...(m.layouts ? { layouts: m.layouts.map((l) => ({ ...l, entities: st(l.entities) })) } : {}), ...(blocks ? { blocks } : {}) } as unknown as D;
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
  kind: "meta" | "text" | "note" | "legend" | "form" | "callout" | "dim";
  text: string;
  lines: number;
  /** agent = textová cesta (engine), user = GUI / starší dokument, auto = generátor (poznámka k plechu) */
  by: Origin;
};

/** řádek generátoru nad razítkem: vysvětlivka oblastní úpravy (původ = původ úpravy v modelu) nebo poznámka k plechu */
export type GenLine = { text: string; by: Origin };
export type GenText = { legend?: (string | GenLine)[]; form?: string[] };
const genLine = (l: string | GenLine, by: Origin): GenLine => (typeof l === "string" ? { text: l, by } : l);

/** slova popisu díry / závitu / sražení, která technickým údajem jsou (vše ostatní mimo tokeny s číslicí je volný text) */
const CALLOUT_WORDS = new Set([
  "skrz", "thru", "through", "durch", "pruchozi", "zavit", "zavitu", "thread", "gewinde", "zahloubeni", "kuzelove", "licovana", "licovany", "ploche", "dno", "flat", "bottom", "flacher", "ebener", "boden", "grund",
  "hl", "hloubka", "depth", "tief", "tiefe", "dira", "diry", "der", "otvor", "otvory", "hole", "holes", "bohrung", "bohrungen", "ks", "pcs", "stk", "typ", "max", "min", "ref", "lh", "rh", "unc", "unf", "npt", "bsp", "bspp", "bspt", "tr", "rd",
  "srazeni", "sraz", "chamfer", "fase", "counterbore", "countersink", "senkung", "zylindersenkung", "kegelsenkung", "spotface", "vrtat", "vystruzit", "drill", "ream", "bohren", "reiben", "pres", "via", "oba", "both", "beidseitig", "oboustranne",
]);
/**
 * Řádek popisu s odkazem je technický údaj (vlna 23, kolo 4 – bod 3): po odebrání tokenů s číslicí („Ø9“, „M8×1,25“, „↧16“,
 * „2×“, „H7“) a značek zbudou jen slova označení díry / závitu / sražení („skrz“, „hl.“, „zahloubení“). Číslo v řádku ho
 * technickým nedělá: „1) Brousit jemně“ i „Rovinnost hlídat 2x“ jsou volný text.
 */
export function calloutLineTech(line: string): boolean {
  const t = stripEnum(vis(line).trim());
  if (!t) return true;
  // úseky písmen každého tokenu („Ø9honovat“ → „honovat“): krátké značky (M, Tr, H7, js, x, UNC) a slova označení díry projdou
  // – samostatné slovo (bez číslice) jen ze seznamu nebo jedno písmeno
  return fold(t)
    .split(/[\s,;:()\/]+/)
    .filter(Boolean)
    .every((tok) => {
      const runs = [...tok.matchAll(/[a-z]+/g)].map((m) => m[0]);
      return /\d/.test(tok) ? runs.every((w) => w.length <= 3 || CALLOUT_WORDS.has(w)) : runs.every((w) => w.length <= 1 || CALLOUT_WORDS.has(w));
    });
}
/** slova textu kóty, která hodnotu jen upřesňují (tolerance / lícování / „skrz“ / „max“ / „typ“) – ostatní slova jsou volný text */
const DIM_WORDS = new Set([...CALLOUT_WORDS, "uhl", "roztec", "pitch", "teilung", "cca", "ca", "approx", "ref", "reference", "referenz", "kulova", "kul", "sph", "kugel", "obvod", "kontrolni", "pruvodni"]);
/**
 * D2 (kolo 4, bod 7): slova v textu / předponě / příponě kóty mimo upřesnění hodnoty („100 lapovat“, „60 leštit“,
 * „Ø9honovat skrz“) – taková kóta je kanál volného textu a počítá se do limitu řádků nad razítkem (1 řádek na kótu).
 */
export function dimFreeWords(a: DrawingAnnotation): string[] {
  if (a.type !== "dim") return [];
  const x = a as { prefix?: string; suffix?: string; text?: string };
  const out: string[] = [];
  for (const v of [x.prefix, x.text, x.suffix]) {
    for (const tok of fold(v ?? "").replace(/<>/g, " ").split(/[\s,;:()\/]+/).filter(Boolean)) {
      const runs = [...tok.matchAll(/[a-z]+/g)].map((m) => m[0]);
      for (const w of runs) if ((/\d/.test(tok) ? w.length > 3 : w.length > 1) && !DIM_WORDS.has(w)) out.push(w);
    }
  }
  return out;
}
export const calloutFreeLines = (lines: readonly string[]): string[] => lines.map((l) => l.trim()).filter((l) => l && !calloutLineTech(l));

/** poznámka listu je volný text nad razítkem: text na listu a poznámka bez cíle v geometrii */
export const isFreeAnn = (a: DrawingAnnotation): boolean => a.type === "text" || (a.type === "note" && (a.free === true || !a.leader));

/** zapnuté pravoúhlé pohledy listu (bez voleb = výchozí přední, horní, levý) */
const orthoViews = (s: DrawingDoc): string[] => {
  const v = { front: true, top: true, left: true, ...(((s.options ?? {}) as { views?: Record<string, boolean> }).views ?? {}) } as Record<string, boolean>;
  const on = Object.entries(v).filter(([k, x]) => x && k !== "iso").map(([k]) => k);
  const o = s.options as { section?: unknown; details?: unknown[]; aux?: unknown[]; cuts?: unknown[] };
  return [...on, ...(o?.section ? ["section"] : []), ...(o?.details?.length ? ["detail"] : []), ...(o?.aux?.length ? ["aux"] : []), ...(o?.cuts?.length ? ["cut"] : [])];
};
const dimCount = (s: DrawingDoc) => s.annotations.filter((a) => a.type === "dim" || a.type === "callout").length;
const hasDims = (s: DrawingDoc) => dimCount(s) > 0;

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

/** měřítko listu jako číslo (1:5 = 0,2; „auto“ = rozumné měřítko 1) */
const sheetScale = (s: DrawingDoc): number => {
  const v = (s.options as { scale?: unknown } | undefined)?.scale;
  if (typeof v === "number" && v > 0) return v;
  const m = typeof v === "string" ? /^\s*(\d+(?:[.,]\d+)?)\s*:\s*(\d+(?:[.,]\d+)?)\s*$/.exec(v) : null;
  return m ? parseFloat(m[1].replace(",", ".")) / parseFloat(m[2].replace(",", ".")) : 1;
};
/**
 * plocha pohledů dílu na listu (D4): počet pravoúhlých pohledů × měřítko (nejvýš 1 – zvětšený detail z listu hlavní list
 * nedělá); list jen s kusovníkem nebo jen s izometrií = 0
 */
export const viewScore = (s: DrawingDoc): number => ((s.options as { bomOnly?: boolean } | undefined)?.bomOnly ? 0 : orthoViews(s).length * Math.min(1, sheetScale(s)));

/**
 * R5 / D4: hlavní list dokumentu – jediný, kde smí být volný text nad razítkem: list s největší plochou pohledů dílu
 * v rozumném měřítku (`viewScore` – „Technické požadavky“ s jedním pohledem 1:10 hlavním listem nejsou, ani když nesou
 * kótu), vážená počtem kót (kolo 4: kopie pohledů bez kót s poznámkami hlavním listem není); při shodě první v pořadí
 * výkresů (s kótami přednost). List jen s izometrií a poznámkami hlavní list nikdy není.
 */
export function mainSheet(doc: Pick<CadDoc, "drawings">): number {
  const order = orderedSheets(doc);
  const ds = doc.drawings ?? [];
  // kolo 4 (bod 11, F2): plocha pohledů × (1 + počet kót) – list s pohledy a kótami je výkres, list se stejnými pohledy
  // bez kót (nebo s jednou kótou na oko) a s poznámkami hlavním listem není
  const score = (i: number) => viewScore(ds[i]) * (1 + Math.min(30, dimCount(ds[i])));
  const best = Math.max(0, ...order.map(score));
  if (best <= 0) return order[0] ?? 0;
  // první list v pořadí, který je plnohodnotným výkresem (aspoň 60 % nejlepšího skóre) – nový list s výchozími pohledy
  // hlavní list nepřebere jen tím, že má o pohled víc
  return order.find((i) => score(i) >= 0.6 * best - 1e-9) ?? order[0] ?? 0;
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
    // popis s odkazem (callout), jehož řádky nejsou technický údaj díry / závitu / sražení (D2: „Brousit jemně“ = volný text)
    // kolo 5 (bypass-F3): i popis s příznakem „auto“ – příznak z JSON dokladem generátoru není; generátor píše jen technické
    // řádky (Ø9 skrz, M8 ↧12), takže skutečný vygenerovaný popis se nepočítá a podvržený ano
    s.annotations.forEach((a, i) => {
      if (a.type !== "callout") return;
      const free = calloutFreeLines(a.lines);
      if (free.length) out.push({ sheet: si, pos, ref: `a${i + 1}`, key: `ann:${a.id}`, kind: "callout", text: free.join("\n"), lines: free.reduce((n, l) => n + lineCount(l), 0), by: a.by ?? "user" });
    });
    // kóta, jejíž text / předpona / přípona nese slova (D2): jeden řádek volného textu
    s.annotations.forEach((a, i) => {
      if (a.type !== "dim") return;
      const ws = dimFreeWords(a);
      if (ws.length) out.push({ sheet: si, pos, ref: `a${i + 1}`, key: `ann:${a.id}`, kind: "dim", text: [a.prefix, a.text, a.suffix].map((v) => (v ?? "").trim()).filter(Boolean).join(" "), lines: 1, by: a.by ?? "user" });
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

const who = (b: Origin) => (b === "agent" ? tr("agent") : b === "user" ? tr("ručně") : b === "loaded" ? tr("ze souboru") : tr("generátor"));
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
export type AuditInput = Pick<CadDoc, "drawings"> & Partial<Pick<CadDoc, "functional" | "materialName" | "kind" | "name" | "features">> & { materialBy?: Src; nameBy?: Src };

/**
 * úroveň nálezu (D1): agent = ✗ (pravidla jsou pro agenta závazná; popis jen na výkrese ⚠); text ze souboru otevřeného
 * z disku (loaded) a člověk / generátor = ℹ rada – u načteného textu dá list navíc ⚠ drawing.notes-loaded (žádná zelená)
 */
export const findingLevel = (f: Pick<AuditFinding, "by" | "code">): "error" | "warn" | "note" => (f.by !== "agent" ? "note" : f.code === "drawing.note-not-model" ? "warn" : "error");

const cut = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** údaj razítka doložený hodnotou (tvrdost s HRC, ISO 2768, Ra / N7, sražení 0,5×45°, povlak RAL / Zn, označení materiálu) */
const STRONG: Partial<Record<TitleDataKey, RegExp[]>> = { hardness: [HARD_RE], tolerance: [TOL_RE, TOL_WORD_RE, IT_RE], roughness: [RA_RE, NCLASS_RE], edges: [CHAMFER_RE, EDGE_ISO_RE], surfaceTreatment: [COAT_RE], material: [WNR_RE, EN_STEEL_RE, CSN_BARE_RE] };
/** pole, která se poznají slovem i bez hodnoty (D3: „Kalit a popustit“, „černit“, „Hrany otupit“ – slovo stačí) */
const WORD_KEYS = new Set<TitleDataKey>(["heatTreatment", "surfaceTreatment", "edges"]);

/**
 * R1 v textu, který poznámkou není (kóta, značka, název, buňka razítka, revize): tepelné zpracování, povrchová úprava
 * a hrany se poznají slovem (D3); tvrdost, tolerance, drsnost a materiál hodnotou (jen slovo „materiál“ v názvu ne).
 * `allow` = pole, která v tomto kanálu smí být; `words: false` = i tepelné / povrch / hrany jen hodnotou (popis změny v revizi).
 */
export function titleDataIn(text: string, allow: TitleDataKey[] = [], words = true): NoteClass["parts"] {
  const c = classifyNote(text);
  return c ? c.parts.filter((p) => !allow.includes(p.key) && ((words && WORD_KEYS.has(p.key)) || (STRONG[p.key] ?? []).some((re) => re.test(text)))) : [];
}

/** slova pokynu pro výrobu / expedici (odmastit, konzervovat, zabalit, označit, měrný protokol …) – v buňkách razítka, názvech, revizích a značkách nemají co dělat */
const PROCESS = ["odmast", "konzerv", "zabal", "balit", "oznacit", "oznacte", "vyrazit", "expedov", "expedic", "paletiz", "skladovat", "uskladn", "chranit", "zkontrol", "kontrolovat", "kontrola", "protokol", "merit", "promer", "ocistit", "vycistit", "mazat", "namazat", "naolejov", "ulozit", "odeslat", "zaslat", "degrease", "preserve", "pack", "inspect", "measure", "clean", "ship", "deliver", "store", "protect", "entfett", "konservier", "verpack", "kennzeichn", "beschrift", "prufen", "pruefen", "messprot", "reinig", "lagern", "versand", "versend"];
export const processWords = (t: string): string[] => words(t).filter((w) => w.length >= 3 && startsAny(w, PROCESS));

/** prázdná hodnota buňky („—“, „bez úpravy“, „none“) */
const CELL_NONE_RE = /^(?:—|–|-|bez(?:\s+(?:úpravy|upravy|tz|zpracování|zpracovani|povrchové úpravy))?|žádn[éáý]|zadn[eay]|none|n\/a|ohne(?:\s+\p{L}+)?|keine?)$/iu;
/** polotovar: rozměr, druh polotovaru nebo označení materiálu (ne pokyn, ne tvrdost / úprava) */
const STOCK_RE = /\d|\b(?:ty[čc]|plech|p[řr]í[řr]ez|prirez|kulatina|kul|profil|trubk|blok|desk|výkov|vykov|odlit|výpal|vypal|bar|sheet|plate|block|tube|forging|casting|blank|flat|round|rund|flach|blech|stange|rohr|schmied|guss|zuschnitt)/i;
/**
 * D3 / kolo 4 (bod 8): hodnota buňky razítka musí být údajem SVÉHO druhu – tepelné zpracování v buňce tepelného zpracování,
 * povrchová úprava v buňce povrchu, tolerance úhlů hodnotou ± / ° … Pokyn („Konzervovat olejem“, „Zabalit do VCI“,
 * „Měrný protokol 3.1“) do žádné buňky nepatří. Stejná kontrola platí pro `výkres razítko …=` i pro hodnotu přesunutou
 * z poznámky. `null` = v pořádku.
 */
export function cellValueProblem(key: string, value: string): string | null {
  const v = vis(value).replace(/\s+/g, " ").trim();
  if (!v || CELL_NONE_RE.test(v)) return null;
  const pw = processWords(v);
  if (pw.length) return tr("„{0}“ je pokyn („{1}“), ne hodnota buňky – pokyny pro výrobu a expedici na výkres nepatří", v, pw[0]);
  const c = classifyNote(v);
  const has = (k: TitleDataKey) => !!c?.parts.some((p) => p.key === k);
  switch (key) {
    case "heatTreatment":
      return has("heatTreatment") || has("hardness") ? null : tr("„{0}“ není tepelné zpracování (např. „kalit a popustit“, „cementovat CHT 0,8“, „nitridovat“, „zušlechtit“)", v);
    case "surfaceTreatment":
      return has("surfaceTreatment") ? null : tr("„{0}“ není povrchová úprava (např. „černit“, „Zn 8 µm“, „RAL 9005“, „eloxovat“, „bez úpravy“)", v);
    case "edges":
      return has("edges") ? null : tr("„{0}“ není stav hran (např. „ISO 13715 -0,3“, „srazit 0,5×45°“, „otupit“)", v);
    case "tolerance":
      return TOL_RE.test(v) || DIN7168_RE.test(v) || PM_RE.test(v) || IT_RE.test(v) || /ISO\s*2768\s*[-–]?\s*(?:mittel|fein|grob|medium|fine|coarse|st[řr]edn|jemn|hrub)/i.test(v) ? null : tr("„{0}“ není obecná tolerance (např. „ISO 2768-mK“, „ISO 22081“, tabulka „X. ±0,1 / X.X ±0,1“)", v);
    case "angleTol":
      return /\d/.test(v) && /±|°|′|'|ISO\s*2768|DIN\s*7168/.test(v) ? null : tr("„{0}“ není tolerance úhlů (např. „±0°30′“, „±0,5°“)", v);
    case "chamferTol":
      return /±\s*\d|ISO\s*2768|ISO\s*13715|DIN\s*7168|\d+(?:[.,]\d+)?\s*[x×]\s*45/.test(v) ? null : tr("„{0}“ není tolerance sražení (např. „±0,2“)", v);
    case "hardness":
      return /^(?:min\.?\s*|max\.?\s*|≥\s*|≤\s*)?\d/.test(v) && HARD_RE.test(v) ? null : tr("tvrdost „{0}“ nemá tvar hodnoty s jednotkou (např. „58–60 HRC“, „650 HV10“)", v);
    case "roughness":
      return /^(?:R[az]|Rmax)\s*\d|^\d|^N\d/.test(v) ? null : tr("drsnost „{0}“ nemá hodnotu (např. „Ra 3,2“)", v);
    case "stock": {
      const bad = titleDataIn(v, ["material"]);
      if (bad.length) return tr("polotovar „{0}“ nese údaj jiného pole ({1}) – do polotovaru jen rozměr a druh (např. „tyč Ø40×120“, „plech 40×160×185“), tvrdost a úpravy do jejich buněk", v, bad.map((p) => titleDataLabel(p.key)).join(", "));
      return STOCK_RE.test(v) || has("material") ? null : tr("„{0}“ není polotovar (např. „tyč Ø40×120“, „plech 40×160×185“)", v);
    }
  }
  return null;
}

/** popis změny v revizi (D2): obsahuje „změna“ / „→“ / slovo změny, nebo odkaz na rozměr / prvek („Ø20“, „R5“, „a4“, „díra“) */
const CHANGE_RE = /→|->|=>|\bzm[eě]n|\bchange|\bänder|\baender|doplněn|doplnen|přidán|pridan|odebrán|odebran|zrušen|zrusen|upraven|posunut|posun\b|opraven|nahrazen|zvětšen|zvetsen|zmenšen|zmensen|prodloužen|zkrácen|vydání|vydani|\bissue|ausgabe|\badded|\bremoved|\bmoved|\breplaced|\bcorrected|\bnew\b|\bneu\b|entfernt|ergänzt|erganzt|geändert|[Ø⌀]\s*\d|\bR\s?\d|\bM\d|\d+(?:[.,]\d+)?\s*(?:mm|°)|\b[aF]\d{1,3}\b|\bdír|\bdir[ay]\b|\bkót|\bkot[ay]\b|toleranc|rozměr|rozmer|pohled|řez\b|\brez\b|detail|materi|\bhole|dimension|\bview|section|bohrung|\bmaß|ansicht|schnitt/i;
export const isChangeDescription = (t: string): boolean => CHANGE_RE.test(t);
/** nejvýš řádků revize zapsaných agentem v jednom běhu (D2) */
export const REV_MAX_AGENT = 5;

/** hodnota drsnosti ve značce (Ra / Rz / N7 / samotné číslo = Ra) */
const roughValue = (t: string): boolean => RA_RE.test(t) || NCLASS_RE.test(t) || /^\s*\d/.test(t);
/** slova ve značce drsnosti mimo hodnotu (způsob výroby – pole ISO 1302 „c“) */
const roughWords = (t: string): string[] => t.replace(RA_RE, " ").replace(NCLASS_RE, " ").split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w));

/** délka, kterou kóta měří (mm modelu) – pro kontrolu, že text kóty hodnotu nezakryl (D2); null = druh kóty se nepočítá */
function dimValue(a: DrawingAnnotation): number | null {
  const x = a as { kind?: string; a?: [number, number]; b?: [number, number]; r?: number };
  if (a.type !== "dim") return null;
  if (x.kind === "horizontal" && x.a && x.b) return Math.abs(x.b[0] - x.a[0]);
  if (x.kind === "vertical" && x.a && x.b) return Math.abs(x.b[1] - x.a[1]);
  if (x.kind === "aligned" && x.a && x.b) return Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]);
  if (x.kind === "diameter" && x.r) return 2 * x.r;
  if (x.kind === "radius" && x.r) return x.r;
  return null;
}
/**
 * D2: text kóty nahradil hodnotu slovy – nemá „<>“ ani číslo, nebo nese čísla, z nichž žádné není měřená délka. Taková kóta
 * rozměr na listu neukazuje (kontrola kót ji za kótu velikosti nepočítá – cad/dim-complete.ts).
 */
export function dimTextHidesValue(a: DrawingAnnotation): boolean {
  if (a.type !== "dim") return false;
  const t = ((a as { text?: string }).text ?? "").trim();
  if (!t || t.includes("<>")) return false;
  const nums = [...t.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => parseFloat(m[0].replace(",", ".")));
  if (!nums.length) return true;
  const v = dimValue(a);
  if (v === null) return false;
  return !nums.some((n) => Math.abs(n - v) <= Math.max(0.051, v * 1e-3));
}

/** název / číslo výkresu, který odkazuje na jiný díl nebo na poznámky (D4: „…/2“, „Technické požadavky“, „Poznámky“, „notes“) */
const NOTES_TITLE_RE = /\/\s*\d{1,3}\s*$|požadav|pozadav|poznámk|poznamk|pokyny|\bnotes?\b|requirement|hinweis|anforderung|anmerkung|bemerkung|technische\s+angaben/i;
/**
 * dokument je jen „nosič textu“ (D4, kolo 4 – bod 6, kolo 5 – bypass-F5 / correct-F1): výkres dílu nese volný text a buď
 * nemá jedinou kótu, nebo má kót mnohem méně než řádků textu (3 × méně), nebo je těleso drobné (do 10 mm) a řádků je víc
 * než kót nebo aspoň 3 – **bez ohledu na prvky** (jedna díra v kostičce 6 mm nosič nezruší). Holé primitivum do 5 mm s textem a holé
 * primitivum s víc řádky než kót nosičem zůstává jako dřív.
 */
const PRIMITIVES = new Set(["box", "cylinder", "sphere", "cone", "torus", "wedge", "tube"]);
/** prvky, které těleso nezvětší (díra, zaoblení, sražení, závit, pomocné prvky) – rozměr tělesa dají primitiva */
const NOT_ADDING = new Set(["hole", "fillet", "chamfer", "thread", "draft", "datum", "datumAxis", "datumPoint", "csys", "deleteFace"]);
/** největší rozměr tělesa z primitiv (mm); null = těleso má prvek, jehož rozměr z údajů nepoznám (vysunutí skici …) */
function bodyExtent(fs: readonly Feature[]): number | null {
  if (!fs.every((f) => PRIMITIVES.has(f.type) || NOT_ADDING.has(f.type))) return null;
  const dims = fs.filter((f) => PRIMITIVES.has(f.type)).flatMap((f) => {
    const x = f as unknown as Record<string, unknown>;
    return ["size", "radius", "height", "r", "r1", "r2", "radius1", "radius2", "outer", "diameter", "length", "width"].flatMap((k) => (Array.isArray(x[k]) ? (x[k] as unknown[]) : [x[k]])).filter((v): v is number => typeof v === "number");
  });
  return dims.length ? Math.max(...dims.map(Math.abs)) : null;
}
function placeholderPart(doc: AuditInput): boolean {
  const fs = doc.features ?? [];
  if (doc.kind === "assembly" || doc.kind === "draft" || !fs.length) return false;
  const ds = doc.drawings ?? [];
  const kot = ds.reduce((n, s) => n + dimCount(s), 0);
  const txt = ds.length ? linesOf(freeTextLines(doc).filter((x) => x.by !== "auto")) : 0;
  const ext = bodyExtent(fs);
  if (fs.every((f) => PRIMITIVES.has(f.type)) && ext !== null) {
    if (ext <= 5) return true;
    if (kot === 0 || txt > kot) return true;
  }
  if (!txt) return false;
  // drobné těleso (do 10 mm): víc řádků než kót, nebo 3 a víc řádků – drobný díl (kolík, vložka) nese údaje v razítku, ne v poznámkách
  return kot === 0 || kot * 3 < txt || (ext !== null && ext <= 10 && (txt > kot || txt >= 3));
}

/**
 * Kolo 5 (bypass-F5): dokumenty běhu (pracovní prostor) pro kontrolu „druhý výkres téhož dílu“ – nastaví smyčka běhu
 * (engine/run.ts); bez ní (GUI, čistý test) se vazba mezi dokumenty nekontroluje.
 */
let siblingDocs: (() => readonly Pick<CadDoc, "name" | "drawings" | "features">[]) | null = null;
export function setNotesSiblings(fn: (() => readonly Pick<CadDoc, "name" | "drawings" | "features">[]) | null): void {
  siblingDocs = fn;
}
/** geometrie dílu bez identit prvků (dva dokumenty se stejným tělesem) */
const geomSig = (fs: readonly unknown[] | undefined): string => JSON.stringify((fs ?? []).map((f) => ({ ...(f as Record<string, unknown>), id: undefined, name: undefined })));
/**
 * číslo výkresu dokumentu, které je číslem jiného dokumentu běhu s příponou („MN-1-B“, „MN-1/2“, „MN-1 B“) – a ten druhý dokument
 * má totéž těleso: výkres téhož dílu podruhé, jen kvůli dalším poznámkám (D4: výkres se nedělí)
 */
function siblingOf(doc: AuditInput): { number: string; other: string } | null {
  const list = siblingDocs?.() ?? [];
  if (!list.length || doc.kind === "assembly" || doc.kind === "draft") return null;
  const nums = (d: Pick<CadDoc, "drawings">) => [...new Set((d.drawings ?? []).map((s) => str((s.meta as Record<string, unknown>).number).trim()).filter(Boolean))];
  const mine = nums(doc);
  if (!mine.length) return null;
  const sig = geomSig(doc.features);
  for (const o of list) {
    if (o.name === doc.name || !o.drawings?.length) continue;
    for (const on of nums(o)) {
      const n = mine.find((x) => x !== on && x.startsWith(on) && /^\s*[-_/.\s]\s*[A-Za-z0-9]{1,3}$/.test(x.slice(on.length)));
      if (n && (geomSig(o.features) === sig || placeholderPart(doc))) return { number: n, other: o.name };
    }
  }
  return null;
}

/** popisek pohledu (detail, pomocný pohled, řez lomenou čarou, řez) – jen písmeno / dvojice písmen („B“, „A-A“, „Detail C“) */
const VIEW_LABEL_RE = /^(?:(?:detail|pohled|řez|rez|view|section|schnitt|ansicht|einzelheit)\s+)?[A-Z]{1,2}\d{0,2}(?:\s*[-–]\s*[A-Z]{1,2}\d{0,2})?$/i;
/** popisky pohledů listu a názvy pohledů dalších modelů (kanál textu u pohledu – kolo 5, bypass-F4) */
export function viewLabels(s: Pick<DrawingDoc, "options">): { what: "label" | "model"; text: string }[] {
  const o = (s.options ?? {}) as { details?: { label?: string }[]; aux?: { label?: string }[]; cuts?: { label?: string }[]; section?: { label?: string } | null; models?: { name?: string }[] };
  const lab = [...(o.details ?? []), ...(o.aux ?? []), ...(o.cuts ?? []), ...(o.section && typeof o.section === "object" ? [o.section] : [])].map((x) => str(x?.label).trim()).filter(Boolean);
  return [...lab.map((text) => ({ what: "label" as const, text })), ...(o.models ?? []).map((m) => ({ what: "model" as const, text: str(m?.name).trim() })).filter((x) => x.text)];
}
const viewLabelSig = (s: Pick<DrawingDoc, "options">): string => viewLabels(s).map((x) => `${x.what}:${x.text}`).join("\u0001");

/** popisy a úpravy plochy v modelu (doc.functional) */
const pmiMarks = (doc: AuditInput): FunctionalMark[] => (doc.kind === "assembly" || doc.kind === "draft" ? [] : (doc.functional ?? []).filter((m) => (m.kind === "note" || m.kind === "treatment") && !!m.text));

/** původ podle podílu: agent, pokud se na položkách podílel; jinak načtený soubor, jinak člověk */
const mixBy = (bs: readonly Origin[]): Origin => (bs.includes("agent") ? "agent" : bs.includes("loaded") ? "loaded" : bs.includes("user") ? "user" : "auto");

// ---------------------------------------------------------------- název = jmenná fráze (D5, kolo 5 – correct-F6)

/** kmeny slov obrábění – „Brousit“, „Lapovat F3“, „Leštit čela“ jsou pokyny, ne název ani jméno */
const MACHINING = ["brous", "zabrous", "lest", "lapov", "honov", "frez", "soustruz", "vrtat", "vystruz", "rezat", "obrob", "superfinis", "polir", "grind", "hone", "schleif", "polier", "honen", "lappen", "frasen", "drehen", "bohren", "reiben"];
/** slovesný tvar (infinitiv / rozkaz) – cs „kalit, nitridovat, srazte“, de „härten, nitrieren, entgraten“ */
const VERB_CS = /(?:[iy]t|at|ovat|nout|out|ujte)$/;
const VERB_DE = /(?:en|ern|eln)$/;
/** anglický rozkaz na začátku názvu („Harden all over“, „Deburr edges“) – jen jednoznačná slovesa (ne „Drill bushing“, „Round bar“) */
const EN_VERBS = new Set(["harden", "temper", "quench", "anneal", "normalize", "normalise", "carburize", "carburise", "nitride", "blacken", "anodize", "anodise", "galvanize", "galvanise", "passivate", "deburr", "chamfer", "paint", "sandblast", "shotblast", "degrease", "preserve", "pack", "inspect", "clean", "ship", "deliver", "protect", "grind", "hone", "engrave"]);
/** podstatné jméno děje – „kalení, nitridace, Härtung, hardening“ */
const PROCESS_NOUN = /(?:eni|ani|ace|ovani|ung|ing|tion|ation)$/;
/** předpony složenin, za kterými následuje slovo úpravy („Plazmanitridace“, „Vakuumgehärtet“, „Induktionsgehärtet“, „Manganfosfát“) */
const COMPOUND = ["plazma", "plasma", "vakuum", "vakuov", "vacuum", "salzbad", "durch", "induktions", "induktiv", "indukcni", "indukcne", "flamm", "laser", "einsatz", "kryogen", "kryogenne", "cryo", "tief", "mangan", "zink", "zinek", "eisen", "scharf", "gas", "ge"];
/** slovo bez předpon složeniny (nejdřív delší předpony, opakovaně; zbytek aspoň 4 písmena) */
export function stripCompound(w: string): string {
  let x = w;
  for (let k = 0; k < 3; k++) {
    const p = COMPOUND.find((c) => x.length - c.length >= 4 && x.startsWith(c));
    if (!p) break;
    x = x.slice(p.length);
  }
  return x;
}
/**
 * slovo je slovem úpravy / obrábění / pokynu – kmen + krátká koncovka (nejvýš 6 písmen): „kalit, kalená, nitridovat,
 * gehärtet“ ano; „Temperierplatte“, „Kantenschutz“, „Hartmetall“ (kmen + další podstatné jméno) ne
 */
const treatWord = (w: string): boolean =>
  [w, stripCompound(w)].some((x) => [HEAT, SURFACE, EDGES, MACHINING, PROCESS].some((list) => list.some((p) => x.startsWith(p) && x.length - p.length <= 6)) || HEAT_EXACT.has(x) || SURFACE_EXACT.has(x)) && !MAT_FIRST.some((m) => w.startsWith(m));
/** materiálová slova, která začínají jako slovo úpravy („Hartmetall“ ≠ „hart“ = kalit) */
const MAT_FIRST = ["hartmetall", "hardmetal", "tvrdokov", "karbid", "carbide"];

/** německá podstatná jména v množném čísle, která končí jako sloveso („Kanten“, „Ecken“, „Fasen“) */
const DE_NOUN_EN = new Set(["kanten", "ecken", "fasen", "platten", "flachen", "schneiden"]);
/** předměty anglického rozkazu („Deburr all edges“, „Harden all over“) – s jiným podstatným jménem je to název („Chamfer tool“) */
const EN_OBJ = new Set(["all", "edges", "edge", "corners", "corner", "surfaces", "surface", "part", "parts", "over", "sharp", "holes", "faces", "both", "sides", "and", "to", "the", "of"]);

/**
 * Pokyn v názvu / jménu / buňce razítka (D5): slovo úpravy, obrábění nebo expedice ve slovesném tvaru („Kalit“, „Srazit hrany“,
 * „Leštit čela“, „Härten“), anglický rozkaz bez dalšího podstatného jména („Harden all over“, „Deburr edges“), podstatné jméno
 * děje s hodnotou („Kalení 58“, „Nitridace 0,3“) nebo text jen z podstatných jmen děje („Kalení a popouštění“, „Härtung“).
 * Jmenná fráze projde („Kalená vložka“, „Temperierplatte“, „Corner bracket“, „Chamfer tool“, „Povrchová deska“, „Tryska“).
 * Vrací slovo, které pokyn dělá, nebo null.
 */
export function instructionWord(text: string): string | null {
  const ws = words(text).filter((w) => w.length >= 2 && !isNum(w));
  const content = ws.filter((w) => !FILLER.has(w));
  for (const w of ws) {
    if (!treatWord(w)) continue;
    if (VERB_CS.test(w) || (VERB_DE.test(w) && !DE_NOUN_EN.has(w))) return w;
    if (PROCESS_NOUN.test(w) && /\d/.test(text)) return w;
  }
  if (content.length && EN_VERBS.has(content[0]) && content.slice(1).every((w) => EN_OBJ.has(w) || treatWord(w))) return content[0];
  if (content.length && content.every((w) => (treatWord(w) && PROCESS_NOUN.test(w)) || FILLER.has(w))) return content[0];
  return null;
}

/**
 * Název (dílu, listu, výkresu, buňky razítka „název“) je jmenná fráze (D5, kolo 5 – correct-F6): ✗ jen věta / souvětí,
 * údaj razítka doložený hodnotou (tvrdost s HRC, ISO 2768, Ra, sražení 0,5×45°, označení materiálu) nebo pokyn
 * (`instructionWord`). Samotné slovo „Kalená“, „Povrchová“, „Corner“, „Edge“ v názvu údajem razítka není.
 */
export function nameIssue(t: string, max = TITLE_FREE_MAX): { code: "drawing.note-style" | "drawing.note-title-data"; why?: string; data?: NoteClass["parts"]; word?: string } | null {
  const why = noteStyle(t, max, 6);
  if (why) return { code: "drawing.note-style", why };
  const bad = titleDataIn(t, [], false);
  if (bad.length) return { code: "drawing.note-title-data", data: bad };
  const w = instructionWord(t);
  if (w) return { code: "drawing.note-style", word: w };
  return null;
}

/** název dílu (D5): krátce, bez vět, bez údajů razítka a pokynů – kontrola i pro příkaz `nový díl` / `název` */
export function docNameIssue(name: string): { code: "drawing.note-style" | "drawing.note-title-data" | "drawing.notes-sheet"; text: string } | null {
  const t = name.trim();
  if (!t) return null;
  // D4: díl „MN-1 poznámky“ / „Technické požadavky“ = nosič poznámek k jinému dílu
  if (NOTES_TITLE_RE.test(t)) return { code: "drawing.notes-sheet", text: tr("název dílu „{0}“ – díl / výkres poznámek nebo požadavků k jinému dílu nevzniká: požadavky patří do razítka a k ploše na výkres dílu", cut(t)) };
  const ni = nameIssue(t);
  if (!ni) return null;
  if (ni.why) return { code: "drawing.note-style", text: tr("název dílu „{0}“: {1} – název krátce (např. „Deska“, „Razník 12“), údaje razítka do razítka, pokyny nikam", cut(t), ni.why) };
  if (ni.data) return { code: "drawing.note-title-data", text: tr("název dílu „{0}“ obsahuje údaj razítka ({1}) – patří do razítka: {2}", cut(t), ni.data.map((p) => titleDataLabel(p.key)).join(", "), titleHint(ni.data)) };
  return { code: "drawing.note-style", text: tr("název dílu „{0}“ je pokyn („{1}“) – název krátce, pokyny na výkres nepatří", cut(t), ni.word ?? "") };
}

/** označení podle normy (ISO / DIN / EN / ČSN / ANSI / JIS + číslo normy) */
const STANDARD_PART_RE = /(?:^|[\s(])(?:ISO|DIN|EN|ČSN|CSN|ANSI|ASME|JIS|UNI|NF|BS)\s?(?:EN\s?|ISO\s?)?\d{2,5}\b/i;
/** buňky kusovníku sestavy, které agent zapisuje příkazem `sestava komponenta …` (kolo 5, bypass-F6 / correct-F2) */
export type BomField = "name" | "number" | "group" | "material" | "alias" | "catalog" | "vendor" | "size" | "grade";
/**
 * Hodnota buňky kusovníku od agenta (název, číslo, skupina, materiál, přezdívka, katalog, výrobce, rozměr, třída): ne věta,
 * ne pokyn („Odmastit“, „Konzervovat olejem“, „Zabalit do VCI“, „Měrný protokol“), v materiálu / třídě jen označení materiálu
 * (tepelné zpracování, tvrdost, povrch patří do razítka výkresu dílu). `null` = v pořádku.
 */
export function bomCellIssue(field: BomField, value: string): { code: "drawing.note-style" | "drawing.note-title-data"; text: string } | null {
  const v = vis(value).replace(/\s+/g, " ").trim();
  if (!v || CELL_NONE_RE.test(v)) return null;
  const why = noteStyle(v, TITLE_FREE_MAX, 6);
  if (why) return { code: "drawing.note-style", text: tr("„{0}“: {1} – buňka kusovníku nese krátký údaj (název, číslo, označení)", cut(v), why) };
  const pw = processWords(v);
  const iw = instructionWord(v);
  if (pw.length || iw) return { code: "drawing.note-style", text: tr("„{0}“ je pokyn („{1}“) – kusovník nese název, číslo a označení, pokyny pro výrobu a expedici na výkres nepatří", cut(v), pw[0] ?? iw ?? "") };
  // normalizované označení nakupovaného dílu („ISO 7089 – 8 – 200HV“, „DIN 912 M8×30 – 12.9“, „ISO 4762 A2-70“) nese třídu
  // pevnosti / tvrdosti jako součást označení podle normy – to není údaj razítka
  const std = STANDARD_PART_RE.test(v);
  const bad = (field === "material" || field === "grade" ? titleDataIn(v, ["material"], true) : titleDataIn(v, [], false))
    .filter((p) => !(std && (p.key === "hardness" || p.key === "material")));
  if (bad.length) return { code: "drawing.note-title-data", text: tr("„{0}“ obsahuje údaj razítka ({1}) – v kusovníku jen označení materiálu (např. „1.2379“); tepelné zpracování, tvrdost a povrch patří do razítka výkresu dílu: {2}", cut(v), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint(bad)) };
  return null;
}
/** texty kusovníku komponent sestavy (pole → hodnota) */
export function bomCells(c: { name?: string; number?: string; group?: string; material?: string; alias?: string; supply?: { catalog?: string; vendor?: string; size?: string; grade?: string }; source?: { kind?: string; doc?: { materialName?: string } } }): [BomField, string][] {
  const out: [BomField, string][] = [];
  const add = (f: BomField, v: unknown) => typeof v === "string" && v.trim() && out.push([f, v.trim()]);
  add("name", c.name);
  add("number", c.number);
  add("group", c.group);
  add("alias", c.alias);
  add("material", c.source?.kind === "part" ? c.source.doc?.materialName : c.material);
  add("catalog", c.supply?.catalog);
  add("vendor", c.supply?.vendor);
  add("size", c.supply?.size);
  add("grade", c.supply?.grade);
  return out;
}

/**
 * Kolo 5 (correct-F3): hodnota volné buňky razítka svého druhu – počet kusů je číslo („4 ks“, „2 + 1“), datum číslicemi,
 * revize krátký znak („A“, „B1“, „02“). Jména, zákazník, projekt a číslo výkresu hlídá `instructionWord` (pokyn ✗).
 */
export function cellKindIssue(key: string, value: string): string | null {
  const v = vis(value).replace(/\s+/g, " ").trim();
  if (!v || CELL_NONE_RE.test(v)) return null;
  switch (key) {
    case "quantity":
      return /^\d+(?:\s*[+×x]\s*\d+)?\s*(?:ks|kus[ůy]?|pcs|pc|stk|stück|stueck|st)?\.?$/i.test(v) ? null : tr("počet kusů je číslo (např. „4 ks“, „2 + 1“), ne „{0}“", v);
    case "date":
      return /\d/.test(v) || v.length <= 3 ? null : tr("datum je zápis data (např. „27. 11. 2026“), ne „{0}“", v);
    case "revision":
      return v.length <= 8 && !/\s\S+\s/.test(v) ? null : tr("revize je krátké označení (např. „A“, „B1“), ne „{0}“", v);
  }
  return null;
}

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
    push({ code: "drawing.notes-limit", by: mixBy(items.map((x) => x.by)), sheet: -1, key: "doc", item: String(total), text: tr("{0} řádků volného textu nad razítkem (nejvýš {1} v celém dokumentu – všechny výkresy a listy): {2} – {3}", total, NOTE_MAX_LINES, freeTextList(items, 8, ds.length > 1 ? names : undefined), limitHint()), data: { count: total, max: NOTE_MAX_LINES, agent: linesOf(agent) } });
  }
  const main = mainSheet(doc);
  for (const x of items) {
    if (x.by === "auto") continue;
    // kóta se slovy: obsah hodnotí kontrola kót níže (styl, údaj razítka, pokyn) – tady jen limit a hlavní list
    if (x.kind === "dim") {
      if (x.sheet !== main) push({ code: "drawing.notes-sheet", by: x.by, sheet: x.sheet, key: x.key, item: x.text, text: tr("{0} „{1}“ je na listu „{2}“ – volný text patří jen na hlavní list „{3}“ (pohledy s kótami) nad razítko; žádný list ani výkres jen s poznámkami", x.ref, cut(x.text), names(x.sheet), names(main)), data: { ref: x.ref, main } });
      continue;
    }
    if (x.kind !== "legend") {
      const cls = classifyNote(x.text.replace(/\n/g, "; "));
      if (cls?.parts.length) {
        push({ code: "drawing.note-title-data", by: x.by, sheet: x.sheet, key: x.key, item: x.text, text: tr("{0} „{1}“ obsahuje údaj razítka ({2}) – patří do razítka: {3}", x.ref, cut(x.text, 60), cls.parts.map((p) => titleDataLabel(p.key)).join(", "), titleHint(cls.parts)), data: { ref: x.ref, fields: cls.parts.map((p) => p.key) } });
        continue;
      }
    }
    for (const l of x.text.split(/\r?\n/)) {
      const why = noteStyle(l, x.kind === "callout" ? CALLOUT_MAX : NOTE_MAX_CHARS);
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
  // -- R5 / D4: výkres, jehož název / číslo odkazuje na poznámky nebo na jiný díl („Technické požadavky“, „MN-1/2“), a dokument,
  //    který je jen nosičem textu (zástupné těleso do 5 mm + volný text)
  ds.forEach((s, si) => {
    const m = s.meta as Record<string, unknown>;
    for (const [k, v] of [["name", str(m.name)], ["number", str(m.number)], ["sheetName", s.name ?? ""], ["drawingName", s.drawing ?? ""]] as const) {
      const t = v.trim();
      if (!t || !NOTES_TITLE_RE.test(t)) continue;
      push({ code: "drawing.notes-sheet", by: metaBy(m, k), sheet: si, key: `meta:${k}`, item: t, text: tr("{0} „{1}“ – výkres poznámek / požadavků k jinému dílu (číslo „…/2“) nevzniká: požadavky patří do razítka a k ploše na výkres dílu", k === "number" ? tr("číslo výkresu") : k === "name" ? tr("název v razítku") : k === "sheetName" ? tr("název listu") : tr("název výkresu"), cut(t)), data: { field: k } });
    }
  });
  if (ds.length && placeholderPart(doc) && items.some((x) => x.by !== "auto")) {
    push({ code: "drawing.notes-sheet", by: mixBy(items.map((x) => x.by)), sheet: main, key: "doc:placeholder", item: String(total), text: tr("dokument „{0}“ je jen nosič textu ({1} řádků poznámek, kót {2}{3}) – výkres jen s poznámkami nevzniká; díl okótujte (kótovat chytře), údaje dejte do razítka výkresu dílu", doc.name ?? "", total, ds.reduce((n, s) => n + dimCount(s), 0), bodyExtent(doc.features ?? []) !== null && bodyExtent(doc.features ?? [])! <= 10 ? tr(", těleso do 10 mm") : ""), data: { placeholder: true } });
  }
  // kolo 5 (bypass-F5): druhý výkres téhož dílu (číslo jiného dokumentu s příponou, totéž těleso) s poznámkami agenta
  const sib = ds.length && items.some((x) => x.by !== "auto") ? siblingOf(doc) : null;
  if (sib) push({ code: "drawing.notes-sheet", by: mixBy(items.map((x) => x.by)), sheet: main, key: "doc:sibling", item: sib.number, text: tr("výkres „{0}“ je druhý výkres dílu „{1}“ (číslo s příponou, totéž těleso) s dalšími poznámkami – výkres se nedělí; poznámky patří na výkres dílu „{1}“ (nejvýš 5 řádků), údaje do jeho razítka", sib.number, sib.other), data: { sibling: sib.other } });
  // kolo 5 (bypass-F4): popisky pohledů (detail, pomocný pohled, řez) jen písmenem, název pohledu modelu jmennou frází
  ds.forEach((s, si) => {
    const m = s.meta as Record<string, unknown>;
    for (const l of viewLabels(s)) {
      const by = metaBy(m, "viewLabels");
      if (l.what === "label" && !VIEW_LABEL_RE.test(l.text)) push({ code: "drawing.note-style", by, sheet: si, key: "meta:viewLabels", item: l.text, text: tr("popisek pohledu „{0}“ – detail / pomocný pohled / řez se označí jen písmenem (např. „B“, „A-A“, „Detail C“); text u pohledu není kanál poznámek", cut(l.text)) });
      else if (l.what === "model") {
        const ni = nameIssue(l.text);
        if (ni) push({ code: ni.code, by, sheet: si, key: "meta:viewLabels", item: l.text, text: tr("název pohledu modelu „{0}“ – {1}; pohled jiného modelu nese jeho název (jmenná fráze, např. „Čep“, „Deska A“)", cut(l.text), ni.why ?? (ni.data ? ni.data.map((p) => titleDataLabel(p.key)).join(", ") : tr("pokyn („{0}“)", ni.word ?? ""))) });
      }
    }
  });
  // -- R2 místní popisy: odkazy z modelu + odkazy na výkrese + popisy s odkazem s volným textem + značky drsnosti se slovy
  const marks = pmiMarks(doc);
  const leaders: { by: Origin; text: string; where: string }[] = marks.filter((m) => m.kind === "note").map((m) => ({ by: m.by ?? "user", text: m.text!, where: tr("model {0}", m.face?.index !== undefined ? `F${m.face.index + 1}` : "F?") }));
  ds.forEach((s, si) =>
    s.annotations.forEach((a, i) => {
      if (a.type === "callout" && calloutFreeLines(a.lines).length) leaders.push({ by: a.by ?? "user", text: calloutFreeLines(a.lines).join(" "), where: `${names(si)} a${i + 1}` });
      if (a.type === "roughness" && roughWords(a.ra ?? "").length) leaders.push({ by: a.by ?? "user", text: a.ra, where: `${names(si)} a${i + 1}` });
      if (a.type !== "note" || isFreeAnn(a)) return;
      leaders.push({ by: a.by ?? "user", text: a.text, where: `${names(si)} a${i + 1}` });
      const by = a.by ?? "user";
      const why = noteStyle(a.text, LEADER_MAX_CHARS, 5);
      if (why) push({ code: "drawing.note-style", by, sheet: si, key: `ann:${a.id}`, item: a.text, text: tr("a{0} „{1}“ u odkazu není heslovitý: {2} – popis u plochy krátce (např. „Brousit“)", i + 1, cut(a.text), why) });
      const bad = titleDataIn(a.text, ["edges"]);
      if (bad.length) push({ code: "drawing.note-title-data", by, sheet: si, key: `ann:${a.id}`, item: a.text, text: tr("a{0} „{1}“: {2} u odkazu – údaje celého dílu do razítka ({3}), úprava jen plochy do modelu (úprava F7 tepelná \"58+2 HRC\")", i + 1, cut(a.text), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint(bad)) });
      else if (processWords(a.text).length && by !== "user") push({ code: "drawing.note-style", by, sheet: si, key: `ann:${a.id}`, item: a.text, text: tr("a{0} „{1}“ je pokyn pro výrobu / expedici – u plochy jen technický údaj (např. „Brousit“), pokyny na výkres nepatří", i + 1, cut(a.text)) });
      if (by === "agent") push({ code: "drawing.note-not-model", by, sheet: si, key: `ann:${a.id}`, item: a.text, text: tr("a{0} „{1}“ je popis jen na výkrese – místní popis patří k ploše do modelu (poznámka F7 \"{1}\"), výkres ho převezme se šipkou (jeden zdroj); tento odkaz pak smažte (výkres smazat a{0})", i + 1, cut(a.text)) });
    }),
  );
  if (leaders.length > NOTE_MAX_LEADERS) {
    push({ code: "drawing.leaders-limit", by: mixBy(leaders.map((l) => l.by)), sheet: -1, key: "doc:leaders", item: String(leaders.length), text: tr("{0} místních popisů (odkazů se šipkou, popisů s textem, značek drsnosti se slovy) – nejvýš {1} v celém dokumentu: {2} – sluč popisy stejné úpravy, údaje celého dílu dejte do razítka", leaders.length, NOTE_MAX_LEADERS, leaders.slice(0, 6).map((l) => `${l.where} „${cut(l.text, 20)}“`).join(" · ") + (leaders.length > 6 ? " …" : "")), data: { count: leaders.length, max: NOTE_MAX_LEADERS } });
  }
  // -- popisy a předpisy úprav v modelu (i z JSON): krátce, heslovitě; popis bez údaje razítka
  for (const m of marks) {
    const by = m.by ?? "user";
    const f = m.face?.index !== undefined ? `F${m.face.index + 1}` : "F?";
    const why = noteStyle(m.text!, LEADER_MAX_CHARS, 5);
    if (why) push({ code: "drawing.note-style", by, sheet: -1, key: `pmi:${m.id}`, item: m.text!, text: tr("model {0} „{1}“: {2} – popis / předpis u plochy krátce a heslovitě (nejvýš {3} znaků)", f, cut(m.text!), why, LEADER_MAX_CHARS) });
    else if (m.kind === "note") {
      const bad = titleDataIn(m.text!, ["edges", "roughness"]);
      if (bad.length) push({ code: "drawing.note-title-data", by, sheet: -1, key: `pmi:${m.id}`, item: m.text!, text: tr("model {0} „{1}“ obsahuje {2} – úprava jen této plochy = úprava {0} tepelná|povrchová \"…\", úprava celého dílu do razítka ({3})", f, cut(m.text!), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint(bad)) });
      else if (processWords(m.text!).length && by !== "user") push({ code: "drawing.note-style", by, sheet: -1, key: `pmi:${m.id}`, item: m.text!, text: tr("model {0} „{1}“ je pokyn pro výrobu / expedici – u plochy jen technický údaj (např. „Brousit“)", f, cut(m.text!)) });
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
        const pw = processWords(t);
        if (why) push({ code: "drawing.note-style", by, sheet: si, key: `ann:${a.id}`, item: t, text: tr("{0} {1} „{2}“: {3} – u značky jen krátký technický údaj, ne poznámka", ref, what, cut(t), why) });
        else if (bad.length) push({ code: "drawing.note-title-data", by, sheet: si, key: `ann:${a.id}`, item: t, text: tr("{0} {1} „{2}“ obsahuje údaj razítka ({3}) – patří do razítka: {4}", ref, what, cut(t), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint(bad)) });
        else if (pw.length) push({ code: "drawing.note-style", by, sheet: si, key: `ann:${a.id}`, item: t, text: tr("{0} {1} „{2}“ je pokyn („{3}“) – u značky jen technický údaj, pokyny na výkres nepatří", ref, what, cut(t), pw[0]) });
      };
      switch (a.type) {
        case "dim":
          chk(tr("text kóty"), a.text, DIM_TEXT_MAX, 4, ["tolerance"]);
          chk(tr("předpona kóty"), a.prefix, 12, 2);
          chk(tr("přípona kóty"), a.suffix, DIM_TEXT_MAX, 4, ["tolerance"]);
          if (dimTextHidesValue(a)) push({ code: "drawing.note-style", by, sheet: si, key: `ann:${a.id}`, item: `${a.text}|hide`, text: tr("{0} text kóty „{1}“ nahrazuje měřenou hodnotu {2} – kóta pak rozměr neukazuje (kontrola kót ji nepočítá); hodnotu nechte (text s „<>“ nebo číslem), slova nepište", ref, cut(a.text ?? ""), String(Math.round((dimValue(a) ?? 0) * 100) / 100).replace(".", ",")) });
          break;
        case "callout":
          for (const l of a.lines) if (calloutLineTech(l)) chk(tr("popis"), l, CALLOUT_MAX, 6, ["tolerance", "edges"]);
          chk(tr("tolerance popisu"), a.tol, 16, 2, ["tolerance"]);
          break;
        case "roughness": {
          const t = (a.ra ?? "").trim();
          const ws = roughWords(t);
          // D2: značka drsnosti = hodnota Ra / Rz (+ nejvýš jedno slovo způsobu výroby ISO 1302); slova bez hodnoty = poznámka
          if (t && (!roughValue(t) && ws.length)) push({ code: "drawing.note-style", by, sheet: si, key: `ann:${a.id}`, item: t, text: tr("{0} značka drsnosti „{1}“ nemá hodnotu Ra / Rz – značka nese hodnotu (např. „Ra 0,8“), nanejvýš s jedním slovem způsobu výroby („Ra 0,4 lapovat“); slova bez hodnoty jsou poznámka", ref, cut(t)) });
          else if (ws.length > 1) push({ code: "drawing.note-style", by, sheet: si, key: `ann:${a.id}`, item: t, text: tr("{0} značka drsnosti „{1}“: {2} slova – způsob výroby nejvýš jedním slovem (pole ISO 1302)", ref, cut(t), ws.length) });
          else chk(tr("drsnost"), t, DIM_TEXT_MAX, 3, ["roughness"]);
          break;
        }
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
  const agentRevs: string[] = [];
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
      // kolo 4, bod 8: technická buňka nese hodnotu svého druhu (tepelné = tepelné zpracování, úhly = tolerance úhlů …)
      if (tech || k === "tolerance") {
        const cp = cellValueProblem(k, v);
        if (cp) {
          push({ code: "drawing.note-title-data", by, sheet: si, key: `meta:${k}`, item: v, text: tr("buňka razítka {0} „{1}“: {2}", k, cut(v), cp) });
          continue;
        }
      }
      // kolo 5 (correct-F6): buňka „název“ se stejným textem jako název dílu se hlásí jednou – u názvu dílu (doc:name), ne u každého
      // listu a příkazu znovu; vlastní název v razítku = jmenná fráze (nameIssue)
      if (k === "name") {
        if (v === doc.name?.trim()) continue;
        const ni = nameIssue(v);
        if (ni) push({ code: ni.code, by, sheet: si, key: `meta:${k}`, item: v, text: ni.why ? tr("buňka razítka {0} „{1}“: {2} – hodnota buňky heslovitě (např. tepelné=\"kalit a popustit\", tvrdost=\"58-60 HRC\")", k, cut(v), ni.why) : ni.data ? tr("buňka razítka {0} „{1}“ obsahuje údaj jiného pole ({2}) – zapište ho do jeho buňky: {3}", k, cut(v), ni.data.map((p) => titleDataLabel(p.key)).join(", "), titleHint(ni.data)) : tr("buňka razítka {0} „{1}“ je pokyn („{2}“), ne jméno / číslo – pokyny na výkres nepatří, údaje razítka do jejich buněk", k, cut(v), ni.word ?? "") });
        continue;
      }
      if (TITLE_NO_DATA.has(k)) {
        // kolo 5 (correct-F3): údaj razítka v buňce jména / zákazníka / projektu jen doloženou hodnotou (slovo „Galvanovna“ v názvu
        // zákazníka údajem není); pokyn = sloveso úpravy / obrábění / expedice („Leštit čela“, „Lapovat F3“, „Brousit na čisto“)
        const bad = titleDataIn(v, [], false);
        const pw = processWords(v);
        const iw = instructionWord(v);
        const kind = cellKindIssue(k, v);
        if (bad.length) push({ code: "drawing.note-title-data", by, sheet: si, key: `meta:${k}`, item: v, text: tr("buňka razítka {0} „{1}“ obsahuje údaj jiného pole ({2}) – zapište ho do jeho buňky: {3}", k, cut(v), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint(bad)) });
        // D2: volná buňka (zákazník, projekt, kontroloval …) nese jméno / číslo, ne pokyn pro výrobu
        else if (pw.length || iw) push({ code: "drawing.note-style", by, sheet: si, key: `meta:${k}`, item: v, text: tr("buňka razítka {0} „{1}“ je pokyn („{2}“), ne jméno / číslo – pokyny na výkres nepatří, údaje razítka do jejich buněk", k, cut(v), pw[0] ?? iw ?? "") });
        else if (kind) push({ code: "drawing.note-style", by, sheet: si, key: `meta:${k}`, item: v, text: tr("buňka razítka {0} „{1}“: {2}", k, cut(v), kind) });
      }
    }
    // název listu a výkresu (razítko „List …“, záložka) – krátce, bez vět, bez údajů razítka a pokynů
    for (const [k, v] of [["sheetName", s.name], ["drawingName", s.drawing ?? ""]] as const) {
      const t = (v ?? "").trim();
      if (!t) continue;
      const by = metaBy(m, k);
      // kolo 5 (correct-F6): název listu / výkresu je jmenná fráze – jen věta, údaj s hodnotou nebo pokyn ✗ („Povrchová deska“ projde)
      const ni = nameIssue(t);
      const why = ni?.why;
      const bad = ni?.data ?? [];
      const pw = ni?.word ? [ni.word] : [];
      const lbl = k === "sheetName" ? tr("listu") : tr("výkresu");
      if (why || bad.length || pw.length) push({ code: bad.length ? "drawing.note-title-data" : "drawing.note-style", by, sheet: si, key: `meta:${k}`, item: t, text: why ? tr("název {0} „{1}“: {2} – název listu / výkresu krátce (např. „Detail“, „Řezy“)", lbl, cut(t), why) : bad.length ? tr("název {0} „{1}“ obsahuje údaj razítka ({2}) – patří do razítka: {3}", lbl, cut(t), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint(bad)) : tr("název {0} „{1}“ je pokyn („{2}“) – název listu / výkresu krátce (např. „Detail“, „Řezy“)", lbl, cut(t), pw[0]) });
    }
    for (const r of (m.revisions as Rev[] | undefined) ?? []) {
      const v = (r.note ?? "").trim();
      // popis revize, který napsal CAD sám při vydání listu (cad/doc-outputs.ts `issueSheet`), je údaj generátoru
      if (!v || isGeneratedRevision(v)) continue;
      const by = r.by ?? "user";
      if (by === "agent") agentRevs.push(`${r.rev} „${cut(v, 20)}“`);
      const why = noteStyle(v, REV_MAX);
      if (why) {
        push({ code: "drawing.note-style", by, sheet: si, key: `rev:${r.rev}`, item: v, text: tr("revize {0} „{1}“: {2} – popis změny krátce (např. „Ø20 → Ø22“, „doplněna díra Ø9“)", r.rev, cut(v), why) });
        continue;
      }
      // údaj razítka v revizi jen jako popis změny buňky, která ho v razítku nese – kolo 5 (bypass-F1): tepelné zpracování,
      // povrch a hrany se poznají i slovem („doplněno kalit a popustit“, „změna: cementovat“), ne jen hodnotou
      const bad = titleDataIn(v, [], true).filter((p) => !(p.key === "material" ? !!doc.materialName?.trim() : str(m[p.key]).trim()));
      if (bad.length) {
        push({ code: "drawing.note-title-data", by, sheet: si, key: `rev:${r.rev}`, item: v, text: tr("revize {0} „{1}“ nese údaj razítka ({2}), který v razítku není – zapište ho do razítka: {3}", r.rev, cut(v), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint(bad)) });
        continue;
      }
      // kolo 4 (F5): pokyn pro výrobu / expedici v revizi nic nemění ani s „změna:“ / „→“ – tabulka revizí není kanál pokynů
      const rpw = processWords(v);
      if (rpw.length) {
        push({ code: "drawing.note-style", by, sheet: si, key: `rev:${r.rev}`, item: v, text: tr("revize {0} „{1}“ je pokyn („{2}“), ne popis změny výkresu – pokyny do tabulky revizí nepatří ani s „změna:“ / „→“ (popis změny např. „Ø20 → Ø22“, „doplněna díra Ø9“)", r.rev, cut(v), rpw[0]) });
        continue;
      }
      // D2: řádek revize je popis změny („Ø20 → Ø22“, „změna materiálu“, „doplněna díra Ø9“) – pokyn / poznámka v tabulce revizí = poznámka nad razítkem
      if (!isChangeDescription(v)) push({ code: "drawing.note-style", by, sheet: si, key: `rev:${r.rev}`, item: v, text: tr("revize {0} „{1}“ není popis změny – řádek revize říká, co se změnilo („Ø20 → Ø22“, „změna: doplněna díra Ø9“); pokyny a poznámky do tabulky revizí nepatří", r.rev, cut(v)) });
    }
  });
  if (agentRevs.length > REV_MAX_AGENT) push({ code: "drawing.notes-limit", by: "agent", sheet: -1, key: "doc:revs", item: String(agentRevs.length), text: tr("{0} řádků revize zapsal agent – nejvýš {1} (tabulka revizí není seznam poznámek): {2}", agentRevs.length, REV_MAX_AGENT, agentRevs.slice(0, 6).join(" · ") + (agentRevs.length > 6 ? " …" : "")), data: { count: agentRevs.length, max: REV_MAX_AGENT } });
  if (doc.materialName?.trim() && doc.kind !== "draft") {
    const v = doc.materialName.trim();
    const why = noteStyle(v, TITLE_VALUE_MAX, 4);
    const bad = titleDataIn(v, ["material"]);
    const pw = processWords(v);
    if (why || bad.length) push({ code: why ? "drawing.note-style" : "drawing.note-title-data", by: doc.materialBy ?? "user", sheet: -1, key: "doc:material", item: v, text: why ? tr("materiál „{0}“: {1} – označení materiálu heslovitě (např. „1.2379“, „C45“)", cut(v), why) : tr("materiál „{0}“ obsahuje údaj jiného pole ({1}) – zapište ho do jeho buňky: {2}", cut(v), bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint(bad)) });
    else if (pw.length) push({ code: "drawing.note-style", by: doc.materialBy ?? "user", sheet: -1, key: "doc:material", item: v, text: tr("materiál „{0}“ je pokyn („{1}“) – materiál je označení (např. „1.2379“, „C45“)", cut(v), pw[0]) });
  }
  // kolo 5 (bypass-F6): buňky kusovníku sestavy, které zapsal agent (příkaz `sestava komponenta …`, JSON dokument)
  if (doc.kind === "assembly") {
    for (const c of (doc as { components?: (Parameters<typeof bomCells>[0] & { id: string; textBy?: Src })[] }).components ?? []) {
      if (!c.textBy) continue;
      for (const [f, v] of bomCells(c)) {
        // název komponenty z vloženého dílu (ten hlídá díl sám) – jen přejmenování / přezdívka od agenta
        if (f === "material" && c.source?.kind === "part") continue;
        const bi = bomCellIssue(f, v);
        if (bi) push({ code: bi.code, by: c.textBy, sheet: -1, key: `comp:${c.id}:${f}`, item: v, text: tr("kusovník – komponenta „{0}“ ({1}): {2}", c.name ?? "", f, bi.text) });
      }
    }
  }
  // D5: název dílu se tiskne v razítku výchozího listu i listu bez vlastního názvu
  if (doc.name?.trim() && doc.kind !== "draft" && (!ds.length || ds.some((s) => !str((s.meta as Record<string, unknown>).name).trim() || str((s.meta as Record<string, unknown>).name).trim() === doc.name!.trim()))) {
    const ni = docNameIssue(doc.name);
    if (ni) push({ code: ni.code, by: doc.nameBy ?? "user", sheet: -1, key: "doc:name", item: doc.name.trim(), text: ni.text });
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
    out.set(`${si}|meta:viewLabels`, viewLabelSig(s));
    for (const r of (m.revisions as Rev[] | undefined) ?? []) out.set(`${si}|rev:${r.rev}`, r.note ?? "");
  });
  for (const m of pmiMarks(doc)) out.set(`-1|pmi:${m.id}`, m.text ?? "");
  if (doc.materialName?.trim()) out.set("-1|doc:material", doc.materialName.trim());
  if (doc.kind === "assembly") for (const c of (doc as { components?: (Parameters<typeof bomCells>[0] & { id: string })[] }).components ?? []) for (const [f, v] of bomCells(c)) out.set(`-1|comp:${c.id}:${f}`, v);
  if (doc.name?.trim()) out.set("-1|doc:name", doc.name.trim());
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
    if (f.key.startsWith("doc") && (f.code === "drawing.notes-limit" || f.code === "drawing.leaders-limit" || f.key === "doc:placeholder" || f.key === "doc:sibling")) {
      const p = before.find((b) => b.code === f.code && b.key === f.key);
      // limit, který příkaz zvýšil, nebo limit načteného souboru, kterého se agent příkazem nově účastní (D1)
      return !p || Number(f.item) > Number(p.item) || p.by !== "agent";
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

/** místní popisy dokumentu (R2 / D2): odkazy z modelu a z výkresu, popisy s odkazem s volným textem, značky drsnosti se slovy */
export const leaderCount = (doc: AuditInput): number =>
  pmiMarks(doc).filter((m) => m.kind === "note").length +
  (doc.drawings ?? []).reduce((n, s) => n + s.annotations.filter((a) => (a.type === "note" && !isFreeAnn(a)) || (a.type === "callout" && calloutFreeLines(a.lines).length > 0) || (a.type === "roughness" && roughWords(a.ra ?? "").length > 0)).length, 0);

/** text měřítka pro stav: „Poznámky nad razítkem: 3/5 řádků (agent 2, ručně 1) · místní popisy 2/8“ */
export function notesBudgetLine(doc: AuditInput, _sheets?: number[], extra: GenText = {}): string {
  const items = freeTextLines(doc, undefined, extra);
  const by = (b: Origin) => linesOf(items.filter((x) => x.by === b));
  const parts = [by("agent") ? tr("agent {0}", by("agent")) : "", by("loaded") ? tr("ze souboru {0}", by("loaded")) : "", by("user") ? tr("ručně {0}", by("user")) : "", by("auto") ? tr("generátor {0}", by("auto")) : ""].filter(Boolean);
  const leaders = leaderCount(doc);
  return tr("Poznámky nad razítkem: {0}/{1} řádků{2} · místní popisy {3}/{4}", linesOf(items), NOTE_MAX_LINES, parts.length ? ` (${parts.join(", ")})` : "", leaders, NOTE_MAX_LEADERS);
}
