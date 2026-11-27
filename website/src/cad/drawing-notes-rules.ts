/**
 * Pravidla poznámek výkresu pro agenty (vlna 23 – požadavek majitele „strojařsky, ne slohové cvičení“, R1–R7).
 *
 * Čistý modul bez jádra a bez Reactu (testovatelný v Node). Kdo pravidla vynucuje: jen textová cesta (engine – jazyk mncad,
 * konzole, CLI, HTTP, `window.mncad.run`, přehrání skriptu; cad/drawing-agent.ts `applyDrawingCmd` a model
 * engine/ops/functional.ts). GUI výkresu (cad/components/cad/drawing-workspace.tsx `addAnn`, panel razítka) jde mimo engine
 * – člověk omezen není, dostane nanejvýš nenápadnou radu (`notesHint`). Rozlišení = cesta, ne prohlášení: poznámky, které
 * zapíše engine, nesou `by: "agent"`, GUI `by: "user"`; starší poznámky bez razítka se počítají jako ruční.
 *
 * - R1 `classifyNote`: volný text, který je ve skutečnosti údajem razítka (materiál, tepelné zpracování, tvrdost, povrchová
 *   úprava, hrany ISO 13715, nepředepsané tolerance, obecná drsnost) – engine ho přesune do razítka, smíšený text odmítne;
 * - R4 `noteStyle` + `freeTextLines`: nad razítkem nejvýš 5 řádků volného textu v celém výkresu (všechny listy sady),
 *   řádek ≤ 60 znaků, heslovitě (žádné věty, souvětí, vatová slova); dlouhý řádek se počítá jako více řádků (zalomení
 *   limit neobejde);
 * - R5 `notesOnLaterSheet`: volný text agenta jen na listu 1 výkresu (list „jen s poznámkami“ ani rozdělení výkres +
 *   poznámky nevznikne);
 * - R7 `notesRuleIssues`: tatáž pravidla jako nálezy listu (⚠ za text agenta, ℹ rada za ruční text) – žádné „✓ bez nálezů“
 *   nad výkresem, který pravidla porušuje.
 */
import { tr } from "./i18n";
import type { CadDoc, DrawingAnnotation, DrawingDoc } from "./types";

/** nejvýš řádků volného textu nad razítkem (celý výkres) */
export const NOTE_MAX_LINES = 5;
/** nejvýš znaků jednoho řádku volného textu */
export const NOTE_MAX_CHARS = 60;
/** nejvýš znaků popisu u odkazové čáry (místní popis plochy / hrany) */
export const LEADER_MAX_CHARS = 40;
/** nejvýš slov heslovitého řádku */
export const NOTE_MAX_WORDS = 8;

/** údaje, které patří do razítka (R1) – klíče polí razítka (cad/title-block.ts) */
export type TitleDataKey = "material" | "heatTreatment" | "hardness" | "surfaceTreatment" | "edges" | "tolerance" | "roughness";
export const TITLE_DATA_KEYS: TitleDataKey[] = ["material", "heatTreatment", "hardness", "surfaceTreatment", "edges", "tolerance", "roughness"];

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

/** začátky slov (bez diakritiky) – tepelné zpracování (cs / en / de); nitridace je tepelně-chemické zpracování */
const HEAT = ["kalit", "kalen", "zakal", "prokal", "popoust", "popust", "zihan", "zihat", "normaliz", "cementov", "cementac", "nitrid", "nitrocement", "karbonitrid", "zuslecht", "harden", "quench", "temper", "anneal", "carburi", "nitrocarbur", "hart", "gehart", "gehaert", "haert", "vergut", "verguet", "anlass", "angelass", "gluh", "glueh", "gegluh", "einsatzh", "aufkohl", "nitrier", "induktiv"];
const SURFACE = ["cernit", "cernen", "zinkov", "pozink", "galvan", "chromov", "pochrom", "niklov", "poniklov", "elox", "anodiz", "anodis", "lakov", "nalakov", "praskov", "fosfat", "pasivov", "trysk", "povlak", "blacken", "zincplat", "plated", "plating", "chrome", "nickel", "paint", "powder", "coating", "coated", "phosphat", "passivat", "sandblast", "brunier", "verzink", "verchrom", "vernickel", "eloxier", "lackier", "beschicht", "phosphatier", "sandstrahl", "kugelstrahl", "pulverbe"];
const SURFACE_EXACT = new Set(["tin", "tialn", "ticn", "crn", "dlc", "pvd", "cvd", "eloxal"]);
const EDGES = ["hrany", "hrana", "hran", "sraz", "otrep", "odjehl", "odhrot", "deburr", "burr", "chamfer", "edge", "kante", "entgrat", "gratfrei", "fase", "gebrochen", "brechen"];
const TOL = ["nepredepsan", "volnerozmer", "obecnetoler", "allgemeintoler", "freimass"];
const ROUGH = ["drsnost", "roughness", "rauheit", "rauigkeit", "oberflachenrauh"];
const MATERIAL = ["material", "werkstoff", "materiau"];
/** slova bez významu pro rozhodnutí (čísla, jednotky, předložky, „díl“, „plochy“, popisky polí …) */
const FILLER = new Set([
  "a", "i", "na", "dle", "podle", "normy", "norma", "normou", "vse", "vsech", "vsechny", "celem", "cele", "cely", "celou", "dil", "dilu", "plochy", "plocha", "plochach", "ploch", "mm", "x", "stupnu", "stupne", "st", "s", "se", "v", "ve", "z", "ze", "do", "o", "tvrdost", "tvrdosti",
  "and", "to", "per", "according", "all", "the", "of", "on", "with", "hardness", "deg", "degree", "degrees",
  "und", "auf", "nach", "gemass", "gemaess", "alle", "mit", "der", "die", "das", "von", "harte", "haerte",
  "uprava", "upravy", "zpracovani", "zpracovat", "zpracovano", "tepelne", "tepelna", "povrchova", "povrchove", "povrch", "surface", "treatment", "finish", "heat", "oberflache", "oberflaeche", "behandlung", "warmebehandlung", "waermebehandlung",
  "obecna", "obecne", "general", "allgemein", "allgemeine", "tolerance", "tolerances", "toleranz", "toleranzen", "iso", "csn", "en", "din", "nekotovane", "nekotovana", "nekotovanych", "unspecified", "unbemasste",
  "w", "nr", "wnr", "stav", "stavu", "ostre", "ostrych", "sharp", "scharfe", "vrstva", "tl", "um", "µm",
]);

const HARD_RE = /(\d+(?:[.,]\d+)?(?:\s*(?:[-–…]|\+\s*\/?\s*-?|±|až|to|bis)\s*\d+(?:[.,]\d+)?)?\s*(?:HRC|HRB|HRA|HV\s?\d{0,2}|HBW|HB)\b)/i;
const TOL_RE = /((?:(?:ČSN|CSN|DIN)\s+)?(?:EN\s+)?ISO\s*)?(?:2768\s*[-–]?\s*(?:[12]\s*[-–]?\s*)?([fmcv])\s*[-/]?\s*([HKL])?\b|22081)/i;
const RA_RE = /\b(R[az]|Rmax)\s*(\d+(?:[.,]\d+)?)/;
const WNR_RE = /\b1\.\d{4}\b/;
const EDGE_ISO_RE = /ISO\s*13715\b/i;

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

/** druhy údajů razítka v části textu (slova, tvrdost, ISO 2768, Ra …) a slova, která žádnému druhu nepatří */
function segKinds(seg: string): { kinds: Set<TitleDataKey>; extra: string[]; hard?: string; tol?: string; ra?: string; wnr?: string } {
  const kinds = new Set<TitleDataKey>();
  let rest = seg;
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
  const rm = RA_RE.exec(rest);
  let ra: string | undefined;
  if (rm) {
    kinds.add("roughness");
    ra = `${rm[1]} ${rm[2]}`;
    rest = rest.replace(rm[0], " ");
  }
  const wm = WNR_RE.exec(rest);
  let wnr: string | undefined;
  if (wm) {
    kinds.add("material");
    wnr = wm[0];
    rest = rest.replace(wm[0], " ");
  }
  if (EDGE_ISO_RE.test(rest)) {
    kinds.add("edges");
    rest = rest.replace(EDGE_ISO_RE, " ");
  }
  const extra: string[] = [];
  const ws = words(rest);
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    // „tepelné zpracování“, „povrchová úprava“, „obecná drsnost“, „volné rozměry“ jako dvojice slov
    const pair = w + (ws[i + 1] ?? "");
    if (pair.startsWith("tepelnezprac") || pair.startsWith("heattreat") || pair.startsWith("warmebehand") || pair.startsWith("waermebehand")) kinds.add("heatTreatment");
    if (pair.startsWith("povrchovauprav") || pair.startsWith("surfacetreat") || pair.startsWith("surfacefinish") || pair.startsWith("oberflachenbeh") || pair.startsWith("oberflaechenbeh")) kinds.add("surfaceTreatment");
    if (startsAny(pair, TOL) || pair.startsWith("generaltoler") || pair.startsWith("obecnetoler")) kinds.add("tolerance");
    if (startsAny(w, HEAT)) kinds.add("heatTreatment");
    else if (startsAny(w, SURFACE) || SURFACE_EXACT.has(w)) kinds.add("surfaceTreatment");
    else if (startsAny(w, EDGES)) kinds.add("edges");
    else if (startsAny(w, TOL)) kinds.add("tolerance");
    else if (startsAny(w, ROUGH)) kinds.add("roughness");
    else if (startsAny(w, MATERIAL)) kinds.add("material");
    else if (!FILLER.has(w) && !isNum(w) && !/^\d*x\d*$/.test(w)) extra.push(w);
  }
  return { kinds, extra, ...(hard ? { hard } : {}), ...(tol ? { tol } : {}), ...(ra ? { ra } : {}), ...(wnr ? { wnr } : {}) };
}

/** popisek pole na začátku části („Hrany:“, „Povrchová úprava –“, „Materiál“) se do hodnoty nepíše */
const LABEL_RE = /^\s*(?:tepeln[éeá]\s+zpracování|povrchov[áaé]\s+úprava|povrch|hrany|materi[áa]l|werkstoff|material|edges|kanten|heat\s+treatment|surface(?:\s+treatment)?|oberfl[äa]che|wärmebehandlung|drsnost|roughness|rauheit|tvrdost|hardness|härte)\s*[:–-]?\s*/i;

/**
 * R1: je text údajem razítka? `null` = není (obyčejná poznámka). Jinak části s polem razítka a hodnotou, zbytek textu
 * a příznak `mixed` (údaj razítka uprostřed věty – „Díl po kalení brousit na rovinnost 0,01“: nejde přesunout, agent text
 * rozdělí). Hodnoty: tvrdost s jednotkou („58-60 HRC“), ISO 2768 třída („ISO 2768-mK“), Ra („Ra 3,2“), W.Nr. („1.2379“),
 * ostatní = text části bez popisku pole.
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
    // hodnota pole = text části bez popisku pole a bez hodnot, které patří jiným polím (tvrdost, ISO 2768, Ra, W.Nr.)
    let body = clean(seg.replace(LABEL_RE, ""));
    for (const x of [k.wnr, k.ra && RA_RE.exec(seg)?.[0], k.tol && TOL_RE.exec(seg)?.[0]]) if (x && body !== x) body = clean(body.replace(x, " "));
    const push = (key: TitleDataKey, value: string) => {
      const v = clean(value);
      if (!v) return;
      const had = parts.find((p) => p.key === key);
      if (had) had.value = `${had.value}, ${v}`;
      else parts.push({ key, value: v });
    };
    if (k.hard) push("hardness", k.hard.replace(/\s+/g, " "));
    if (k.kinds.has("heatTreatment")) {
      // hodnota tepelného zpracování = text bez tvrdosti a výplně na konci („na“, „to“, „auf“)
      push("heatTreatment", body.replace(k.hard ?? "\u0000", " ").replace(/\s+(?:na|to|auf|tvrdost|hardness|härte)\s*$/i, "").replace(/\s+(?:na|to|auf)\s+(?:tvrdost|hardness|härte)\s*$/i, ""));
    }
    if (k.kinds.has("tolerance")) push("tolerance", k.tol ?? body);
    if (k.kinds.has("roughness")) push("roughness", k.ra ?? body);
    if (k.kinds.has("material")) push("material", k.wnr ?? body);
    if (k.kinds.has("surfaceTreatment")) push("surfaceTreatment", body);
    if (k.kinds.has("edges")) push("edges", body);
    // text s jediným údajem tvrdosti bez slova tepelného zpracování („58 HRC“) = tvrdost
  }
  if (!any) return null;
  if (rest.length) mixed = true;
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
  return `výkres razítko ${p.map((x) => `${TITLE_DATA_CMD[x.key]}="${x.value.replace(/"/g, "'")}"`).join(" ")}`;
}

// ---------------------------------------------------------------- R4 styl řádku

const SENTENCE_W = new Set([
  "pokud", "ktere", "ktery", "ktera", "kterych", "kterou", "aby", "prosim", "kontaktujte", "kontaktovat", "musi", "musite", "mel", "mela", "melo", "meli", "doporucujeme", "doporucuje", "nejasnost", "nejasnosti", "nasledujici", "jakekoli", "jakekoliv", "pripade", "nutne", "treba",
  "please", "must", "should", "which", "contact", "following", "whenever", "unless", "recommended",
  "bitte", "muss", "mussen", "muessen", "sollte", "sollten", "welche", "welcher", "falls", "kontaktieren", "folgende", "empfohlen",
]);

/**
 * R4: důvod, proč řádek není heslovitý (null = v pořádku). Hlídá délku (`max` znaků), počet slov, více vět, tečku na konci,
 * víc než dvě čárky a slova vět / souvětí („pokud“, „které“, „aby“, „musí“, „please“, „bitte“ …).
 */
export function noteStyle(text: string, max = NOTE_MAX_CHARS): string | null {
  const t = stripEnum(text.trim());
  if (!t) return null;
  if (t.length > max) return tr("řádek má {0} znaků (nejvýš {1})", t.length, max);
  const ws = t.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (ws.length > NOTE_MAX_WORDS) return tr("{0} slov – heslovitě nejvýš {1}", ws.length, NOTE_MAX_WORDS);
  if (/[.!?]\s+\p{L}/u.test(t)) return tr("víc vět na řádku");
  if (/[!?]$/.test(t) || (/\.$/.test(t) && !/\b(?:ap|atd|tzv|max|min|cca|resp|tj|tl|č|st|ks|č\.\s*v|W\.Nr)\.$/i.test(t))) return tr("věta s tečkou na konci");
  if ((t.match(/,\s+(?=\D)/g) ?? []).length > 2) return tr("víc než dvě čárky (souvětí)");
  const sw = words(t).find((w) => SENTENCE_W.has(w));
  if (sw) return tr("slovo věty „{0}“", sw);
  return null;
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
  kind: "meta" | "text" | "note" | "legend" | "form";
  text: string;
  lines: number;
  /** agent = textová cesta (engine), user = GUI / starší dokument, auto = generátor (legenda oblastí, plech) */
  by: "agent" | "user" | "auto";
};

/** poznámka listu je volný text nad razítkem: text na listu a poznámka bez cíle v geometrii */
export const isFreeAnn = (a: DrawingAnnotation): boolean => a.type === "text" || (a.type === "note" && (a.free === true || !a.leader));

/**
 * Volný text celé sady listů `sheets` (indexy listů jednoho výkresu v pořadí): pole poznámky u razítka, texty na listu,
 * poznámky bez cíle, legenda oblastních úprav (R3) a poznámky k plechu (`legend` / `form` = řádky generátoru).
 * Nepočítá se: „Rozměry v mm“, číslo listu, revize modelu, údaje razítka v buňkách, odkazy na geometrii, kóty.
 */
export function freeTextLines(doc: Pick<CadDoc, "drawings">, sheets: number[], extra: { legend?: string[]; form?: string[] } = {}): FreeText[] {
  const out: FreeText[] = [];
  sheets.forEach((si, pos) => {
    const s: DrawingDoc | undefined = doc.drawings?.[si];
    if (!s) return;
    const m = s.meta as { note?: string; noteBy?: "agent" | "user" };
    const note = typeof m.note === "string" ? m.note.trim() : "";
    if (note) out.push({ sheet: si, pos, ref: tr("poznámka"), kind: "meta", text: note, lines: lineCount(note), by: m.noteBy ?? "user" });
    s.annotations.forEach((a, i) => {
      if (!isFreeAnn(a)) return;
      const text = (a as { text: string }).text ?? "";
      if (!text.trim()) return;
      out.push({ sheet: si, pos, ref: `a${i + 1}`, kind: a.type === "text" ? "text" : "note", text, lines: lineCount(text), by: a.by ?? "user" });
    });
    if (pos === 0) {
      for (const l of extra.legend ?? []) out.push({ sheet: si, pos, ref: tr("legenda"), kind: "legend", text: l, lines: lineCount(l), by: "auto" });
      for (const l of extra.form ?? []) out.push({ sheet: si, pos, ref: tr("plech"), kind: "form", text: l, lines: lineCount(l), by: "auto" });
    }
  });
  return out;
}

/** součet řádků */
export const linesOf = (items: readonly FreeText[]): number => items.reduce((n, x) => n + x.lines, 0);

/** výpis řádků pro hlášku („a3 „Brousit“ (agent) · poznámka „…“ (ručně)“) */
export function freeTextList(items: readonly FreeText[], max = 8): string {
  const who = (b: FreeText["by"]) => (b === "agent" ? tr("agent") : b === "user" ? tr("ručně") : tr("generátor"));
  const cut = (s: string) => (s.length > 32 ? `${s.slice(0, 31)}…` : s);
  return items.slice(0, max).map((x) => `${x.pos > 0 ? tr("list {0} ", x.pos + 1) : ""}${x.ref} „${cut(x.text.replace(/\s+/g, " "))}“ (${who(x.by)}${x.lines > 1 ? tr(", {0} ř.", x.lines) : ""})`).join(" · ") + (items.length > max ? " …" : "");
}

/** rada k hlášce o limitu (zkrátit / do razítka / odkaz se šipkou / smazat) */
export const limitHint = (): string =>
  tr("zkraťte a slučte řádky; údaje razítka zapište do razítka (výkres razítko tepelné=… tvrdost=… povrch=… hrany=… drsnost=…, výkres nepředepsané ISO 2768-mK); popis plochy jako odkaz se šipkou v modelu (poznámka F7 \"…\"); oblastní úpravu jako čerchovanou čáru (úprava F7 tepelná \"58+2 HRC\"); nadbytečné smažte (výkres smazat a3)");

export type NotesFinding = { code: "drawing.notes-limit" | "drawing.note-style" | "drawing.note-title-data" | "drawing.notes-sheet"; level: "warn" | "note"; text: string; data?: Record<string, unknown> };

/**
 * R7: nálezy pravidel poznámek pro výkres (sada listů `sheets`, list 1 první). Text agenta = ⚠ (přísný režim zastaví běh),
 * ruční text (GUI, starší dokument) = ℹ nenápadná rada – člověka pravidla neomezují (R6).
 */
export function notesRuleIssues(doc: Pick<CadDoc, "drawings">, sheets: number[], extra: { legend?: string[]; form?: string[] } = {}): NotesFinding[] {
  const items = freeTextLines(doc, sheets, extra);
  const out: NotesFinding[] = [];
  const agent = items.filter((x) => x.by === "agent");
  const total = linesOf(items);
  if (total > NOTE_MAX_LINES) {
    const lvl = agent.length ? "warn" : "note";
    out.push({ code: "drawing.notes-limit", level: lvl, text: tr("{0} řádků volného textu nad razítkem (nejvýš {1}): {2} – {3}", total, NOTE_MAX_LINES, freeTextList(items), limitHint()), data: { lines: total, max: NOTE_MAX_LINES, agent: linesOf(agent), user: total - linesOf(agent) } });
  }
  for (const x of items) {
    if (x.by === "auto") continue;
    const lvl = x.by === "agent" ? "warn" : "note";
    const cls = x.kind === "legend" || x.kind === "form" ? null : classifyNote(x.text);
    if (cls?.parts.length) {
      out.push({ code: "drawing.note-title-data", level: lvl, text: tr("{0} „{1}“ obsahuje údaj razítka ({2}) – patří do razítka: {3}", x.ref, x.text, cls.parts.map((p) => titleDataLabel(p.key)).join(", "), titleHint(cls.parts)), data: { ref: x.ref, fields: cls.parts.map((p) => p.key) } });
      continue;
    }
    for (const l of x.text.split(/\r?\n/)) {
      const why = noteStyle(l);
      if (why) {
        out.push({ code: "drawing.note-style", level: lvl, text: tr("{0} „{1}“ není heslovitý: {2} – zkraťte (strojařsky, bez vět)", x.ref, l.trim(), why), data: { ref: x.ref } });
        break;
      }
    }
    if (x.pos > 0 && x.by === "agent") out.push({ code: "drawing.notes-sheet", level: "warn", text: tr("{0} „{1}“ je na listu {2} – poznámky patří na list 1 nad razítko (nejvýš {3} řádků)", x.ref, x.text, x.pos + 1, NOTE_MAX_LINES), data: { ref: x.ref, sheetPos: x.pos + 1 } });
  }
  return out;
}

/** text měřítka pro stav: „Poznámky nad razítkem: 3/5 řádků (agent 2, ručně 1)“ */
export function notesBudgetLine(doc: Pick<CadDoc, "drawings">, sheets: number[], extra: { legend?: string[]; form?: string[] } = {}): string {
  const items = freeTextLines(doc, sheets, extra);
  const by = (b: FreeText["by"]) => linesOf(items.filter((x) => x.by === b));
  const parts = [by("agent") ? tr("agent {0}", by("agent")) : "", by("user") ? tr("ručně {0}", by("user")) : "", by("auto") ? tr("generátor {0}", by("auto")) : ""].filter(Boolean);
  return tr("Poznámky nad razítkem: {0}/{1} řádků{2}", linesOf(items), NOTE_MAX_LINES, parts.length ? ` (${parts.join(", ")})` : "");
}

/**
 * Dokument, který přišel textovou cestou agenta (JSON řádek skriptu, `window.mncad.setDocument`): poznámky a texty listů bez
 * razítka původu dostanou `by: "agent"` – pravidla nejdou obejít vložením hotového JSON s deseti poznámkami (R6).
 */
export function stampAgentNotes<T extends Pick<CadDoc, "drawings">>(doc: T): T {
  if (!doc.drawings?.length) return doc;
  return {
    ...doc,
    drawings: doc.drawings.map((s) => {
      const m = s.meta as { note?: unknown; noteBy?: string };
      return {
        ...s,
        meta: typeof m.note === "string" && m.note.trim() && !m.noteBy ? { ...s.meta, noteBy: "agent" } : s.meta,
        annotations: (s.annotations ?? []).map((a) => ((a.type === "text" || a.type === "note") && !a.by ? { ...a, by: "agent" as const } : a)),
      };
    }),
  };
}
