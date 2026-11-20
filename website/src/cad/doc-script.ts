/**
 * Dokument → čitelný textový skript (opačný směr k `parseAgentText`): model vzniklý klikáním nebo z JSON se vypíše jako
 * TENTÝŽ model v textových příkazech – k učení jazyka, úpravě a novému spuštění, zkoušení textové cesty skutečnými modely
 * a porovnání verzí.
 *
 *   docToScript(doc, { lang: "cs" | "en" | "de", names: "auto" | "all", sigs: "keep" | "drop" }) → { text, notes, stats }
 *
 * Díly jako bloky `nový díl …` (stejný díl použitý víckrát jen jednou), pak `nová sestava …`, `vložit …` s polohou,
 * vazby `sestava vazba … #k …`, pohybová studie, výkresy (`výkres …`, listy, razítko, `kótovat`), 2D výkres.
 *
 * KAŽDÝ řádek prvku se před zápisem ověří: text se přečte `parseAgentText` (stejný rozbor jako v konzoli), doplní se jako
 * v aplikaci (`$last`, názvy → id, operace, těleso; skici skutečným `applySketchOp`) a výsledek se porovná s původním
 * prvkem. Doplňuje se nad prvky tak, jak budou v dokumentu PO PŘEČTENÍ skriptu (`replay`: prvky z textu mají nová id,
 * jen prvky z JSON si id nechají) – odkaz, který by v novém dokumentu neexistoval (původní id pomocné roviny uvnitř
 * `planeDef`), ověřením neprojde. Nesedí-li vlastní příkaz (pole, které neumí zapsat), zkusí se obecný
 * `prvek <typ> klíč=hodnota` a nakonec jednořádkový JSON – skript je tak přesný i u prvků bez vlastního příkazu a `stats`
 * říká, kolik prvků šlo kterou cestou.
 *
 * Odkazy na dřívější prvky: `$last`, jinak název (prvek, na který se odkazuje názvem, má název ve skriptu vždy výslovně –
 * automatický název závisí na jazyce rozhraní, ve kterém se skript čte); odkaz, který názvem zapsat nejde (bod skici,
 * nejednoznačný název), drží id – odkazovaný prvek se pak zapíše jako JSON. Potlačení, vazby parametrů a přejmenování
 * míří na `poslední` prvek (nezávisle na jazyce a na stejných názvech), konfigurace na název nebo `@pořadí`.
 *
 * Otisky výběru (edgeSigs, sig): uložená čísla hran a ploch mohou být po úpravě historie zastaralá (aplikace entity
 * hledá podle otisku) a bez jádra to nejde poznat – prvek s otisky se proto zapíše i s nimi (obecný `prvek` / JSON).
 * Aplikace před exportem čísla ověří jádrem (`freshScriptDoc`, doc-script-fresh.ts) a ověřené otisky odstraní – pak jdou
 * prvky vlastními příkazy s platnými čísly. Co ověřit bez jádra nejde (plocha skici, vazby sestavy), ověřuje kontrola
 * tam a zpět (doc-script.roundtrip.test.ts, e2e/cad-doc2text.e2e.cjs).
 *
 * Čistý modul bez prohlížeče a bez jádra; stejný dokument a volby dají vždy stejný text.
 */
import { FEATURE_LABEL, parseAgentText, type AgentOp } from "./agent";
import { stripLineComment } from "./agent-comment";
import { aliasScript, emitAsmSprings, emitDynamics, emitStudyExtras, motorLimitWords } from "./doc-script-asm";
import { dimTail, dimTailOk, emitDocProps, emitGenEdit, emitSheetViews, emitTitle, sheetLineExtra, sheetUnwritable, SHEET_JSON_ONLY, titleState, type SheetOut } from "./doc-script-sheet";
import { springScriptLine } from "./agent-springs";
import { freeName, parseValue } from "./agent-edit";
import { resolveDatumNames } from "./agent-prim";
import { applySketchOp, type SketchOp } from "./agent-sketch";
import { bodiesAt, nextBodyName } from "./bodies";
import { getExt } from "./ext/registry";
import type { SectionOpt } from "./drawing";
import { sectionToSketchConvention } from "./drawing-section";
import { dictOf, getLang, setLang, tr } from "./i18n";
import { KIN_SPEC } from "./mate-spec";
import { mateLost } from "./mates";
import { unusedEnd } from "./motor-model";
import { exprRefs, resolveVariables, VAR_NAME } from "./params";
import { pickFieldsOf } from "./pick-fields";
import type { Direction, Ref } from "./refs";
import type { CadDoc, DrawingDoc, Feature, Mate, MateRef, SketchConstraint, SketchDim, SketchEntity, SketchRef, Vec3 } from "./types";

export type ScriptLang = "cs" | "en" | "de";
export type DocScriptOptions = {
  /**
   * jazyk klíčových slov (výchozí čeština); parser čte všechny tři bez ohledu na jazyk rozhraní. Je to i jazyk rozhraní,
   * pro které je skript určen: automatické názvy prvků („Kvádr 1“ / „Box 1“ / „Quader 1“) se vynechávají jen tehdy, když
   * by je rozhraní v tomto jazyce přidělilo samo – český dokument zapsaný `lang: "en"` má názvy výslovně.
   */
  lang?: ScriptLang;
  /** "auto" = název prvku jen tam, kde se liší od názvu, který by textová cesta přidělila sama (a kde se na něj nic neodkazuje názvem); "all" = vždy */
  names?: "auto" | "all";
  /**
   * otisky výběru (edgeSigs, sig…): "keep" (výchozí) = prvek s otisky se zapíše i s nimi (obecný prvek / JSON) – uložená čísla hran
   * a ploch mohou být zastaralá a bez jádra je nejde ověřit; "drop" = jen čísla tak, jak jsou uložená (volající je ověřil jádrem –
   * `freshScriptDoc` – nebo ví, že historie dílu se po výběru neměnila)
   */
  sigs?: "keep" | "drop";
  /** komentáře s hlavičkami dílů (výchozí ano) */
  comments?: boolean;
  /**
   * smazané vygenerované kóty listů (options.smartOff) jako id po „kótovat chytře“: id listu → ["a3", "a8"]. Spočítá je jádro
   * (`freshScriptDoc`); bez nich skript jen upozorní, že se smazané kóty po přečtení vrátí.
   */
  deletedDims?: Record<string, string[]>;
  /**
   * klíče vygenerovaných kót celkových rozměrů a pozic, které na listu jsou (id listu → ["dim:front:t", "pos:1"]) – spočítá je
   * jádro (`freshScriptDoc`) pro listy s upravenými vygenerovanými objekty; úprava objektu, který na listu není, se nezapíše.
   * Bez nich převodník vynechá jen klíče, které na listu podle voleb být nemohou, a ohlásí, že zbytek jádrem ověřený není.
   */
  genKeys?: Record<string, string[]>;
  /** poznámky volajícího (co ověřilo jádro) – přidají se k poznámkám převodníku i do komentáře skriptu */
  notes?: string[];
};
export type ScriptHow = "dedicated" | "generic" | "json";
export type ScriptStats = {
  /** prvky dílů celkem a podle způsobu zápisu */
  features: number;
  dedicated: number;
  generic: number;
  json: number;
  byType: Record<string, Record<ScriptHow, number>>;
  parts: number;
  components: number;
  /** vazby sestavy: celkem / zapsané textem */
  mates: number;
  matesText: number;
  sheets: number;
  lines: number;
  bytes: number;
};
export type DocScript = { text: string; notes: string[]; stats: ScriptStats };

type SketchF = Extract<Feature, { type: "sketch" }>;
type Rec = Record<string, unknown>;

/* ───────────────────────── slova (cs / en / de) ───────────────────────── */
const WORDS = {
  newPart: ["nový díl", "new part", "neu teil"],
  newAsm: ["nová sestava", "new assembly", "neu baugruppe"],
  material: ["materiál", "material", "werkstoff"],
  color: ["barva", "color", "farbe"],
  name: ["název", "name", "name"],
  sketch: ["skica", "sketch", "skizze"],
  offset: ["odsazení", "offset", "versatz"],
  origin: ["počátek", "origin", "ursprung"],
  normal: ["normála", "normal", "normale"],
  xdir: ["osax", "xdir", "xrichtung"],
  face: ["plocha", "face", "fläche"],
  plane: ["rovina", "plane", "ebene"],
  reverse: ["obráceně", "reverse", "umkehren"],
  construction: ["pomocná", "construction", "hilfs"],
  rect: ["obdélník", "rect", "rechteck"],
  circle: ["kružnice", "circle", "kreis"],
  polygon: ["mnohoúhelník", "polygon", "vieleck"],
  slot: ["drážka", "slot", "langloch"],
  line: ["úsečka", "line", "linie"],
  polyline: ["čára", "polyline", "polylinie"],
  arc: ["oblouk", "arc", "bogen"],
  spline: ["spline", "spline", "spline"],
  point: ["bod", "point", "punkt"],
  ellipse: ["elipsa", "ellipse", "ellipse"],
  at: ["v", "at", "bei"],
  angle: ["úhel", "angle", "winkel"],
  rectR: ["zaoblení-rohů", "rr", "eckenradius"],
  close: ["uzavřít", "close", "schließen"],
  open: ["otevřená", "open", "offen"],
  constraint: ["vazba", "constraint", "bedingung"],
  dim: ["kóta", "dim", "maß"],
  reference: ["referenční", "reference", "referenz"],
  box: ["kvádr", "box", "quader"],
  center: ["střed", "center", "mitte"],
  cylinder: ["válec", "cylinder", "zylinder"],
  sphere: ["koule", "sphere", "kugel"],
  cone: ["kužel", "cone", "kegel"],
  tube: ["trubka", "tube", "rohr"],
  spring: ["pružina", "spring", "feder"],
  pitch: ["stoupání", "pitch", "steigung"],
  turns: ["závity", "turns", "windungen"],
  wire: ["drát", "wire", "draht"],
  thread: ["závit", "thread", "gewinde"],
  length: ["délka", "length", "länge"],
  internal: ["vnitřní", "internal", "innen"],
  modeled: ["modelovat", "modeled", "modelliert"],
  axis: ["osa", "axis", "achse"],
  add: ["přidat", "add", "hinzufügen"],
  cut: ["odebrat", "cut", "abziehen"],
  intersect: ["průnik", "intersect", "schnittmenge"],
  newbody: ["nové", "newbody", "neukörper"],
  body: ["těleso", "body", "körper"],
  extrude: ["vysunout", "extrude", "extrudieren"],
  symmetric: ["symetricky", "symmetric", "symmetrisch"],
  through: ["skrz", "through", "durch"],
  draft: ["úkos", "draft", "schräge"],
  land: ["břit", "land", "steg"],
  sharp: ["ostré rohy", "sharp corners", "scharfe ecken"],
  round: ["zaoblené rohy", "round corners", "runde ecken"],
  direction: ["směr", "direction", "richtung"],
  height: ["výška", "height", "höhe"],
  toNext: ["k dalšímu", "to next", "bis nächste"],
  toBody: ["k tělesu", "to body", "bis körper"],
  revolve: ["rotovat", "revolve", "rotieren"],
  hole: ["díra", "hole", "bohrung"],
  depth: ["hloubka", "depth", "tiefe"],
  bothways: ["obousměrně", "bothways", "beidseits"],
  counterbore: ["zahloubení", "counterbore", "senkung"],
  countersink: ["kuželové", "countersink", "kegelsenkung"],
  threadDepth: ["hloubka-závitu", "thread-depth", "gewindetiefe"],
  fillet: ["zaoblit", "fillet", "verrunden"],
  chamfer: ["srazit", "chamfer", "fase"],
  edges: ["hrany", "edges", "kanten"],
  shell: ["skořepina", "shell", "schale"],
  openFaces: ["otevřít", "open", "öffnen"],
  pattern: ["pole", "pattern", "muster"],
  spacing: ["rozteč", "spacing", "teilung"],
  circular: ["kruhové", "circular", "kreisförmig"],
  mirror: ["zrcadlit", "mirror", "spiegeln"],
  text: ["text", "text", "schrift"],
  engrave: ["gravírovat", "engrave", "gravieren"],
  splitBodies: ["rozdělit", "splitbodies", "teilen"],
  as: ["jako", "as", "als"],
  copyBody: ["kopie", "copybody", "kopieren"],
  shift: ["posun", "offset", "versatz"],
  combine: ["sloučit", "combine", "kombinieren"],
  keep: ["ponechat", "keep", "behalten"],
  feature: ["prvek", "feature", "element"],
  yes: ["ano", "yes", "ja"],
  no: ["ne", "no", "nein"],
  suppress: ["potlačit", "suppress", "unterdrücken"],
  variable: ["proměnná", "variable", "variable"],
  note: ["poznámka", "note", "notiz"],
  edit: ["upravit", "edit", "bearbeiten"],
  config: ["konfigurace", "config", "konfiguration"],
  active: ["aktivní", "active", "aktiv"],
  insert: ["vložit", "insert", "einfügen"],
  rotation: ["otočení", "rotation", "drehung"],
  fixed: ["ukotvit", "fixed", "fixieren"],
  asm: ["sestava", "assembly", "baugruppe"],
  comp: ["komponenta", "component", "komponente"],
  number: ["číslo", "number", "nummer"],
  group: ["skupina", "group", "gruppe"],
  hide: ["skrýt", "hide", "ausblenden"],
  mate: ["vazba", "mate", "verknüpfung"],
  value: ["hodnota", "value", "wert"],
  flip: ["obráceně", "flip", "umkehren"],
  motion: ["pohyb", "motion", "bewegung"],
  motor: ["motor", "motor", "antrieb"],
  rotary: ["rotační", "rotary", "dreh"],
  linear: ["lineární", "linear", "linear"],
  steps: ["kroky", "steps", "schritte"],
  time: ["čas", "time", "zeit"],
  clash: ["kolize", "collisions", "kollisionen"],
  trace: ["stopa", "trace", "spur"],
  rpm: ["ot/min", "rpm", "u/min"],
  speed: ["rychlost", "speed", "geschwindigkeit"],
  motorFrom: ["od", "from", "von"],
  // dynamika pohybové studie (vlna 21, cad/agent-motion-dyn.ts)
  back: ["tam a zpět", "there and back", "hin und zurück"],
  dynamics: ["dynamika", "dynamics", "dynamik"],
  dtStep: ["krok", "step", "schritt"],
  gravity: ["gravitace", "gravity", "schwerkraft"],
  gOff: ["vyp", "off", "aus"],
  damping: ["tlumení", "damping", "dämpfung"],
  restitution: ["odraz", "restitution", "stoßzahl"],
  frames: ["snímky", "frames", "bilder"],
  mass: ["hmotnost", "mass", "masse"],
  force: ["síla", "force", "kraft"],
  torque: ["moment", "torque", "moment"],
  drawing: ["výkres", "drawing", "zeichnung"],
  format: ["formát", "format", "format"],
  portrait: ["na výšku", "portrait", "hoch"],
  scale: ["měřítko", "scale", "maßstab"],
  views: ["pohledy", "views", "ansichten"],
  section: ["řez", "section", "schnitt"],
  half: ["poloviční", "half", "halb"],
  full: ["celý", "full", "voll"],
  hidden: ["skryté", "hidden", "verdeckt"],
  axes: ["osy", "axes", "achsen"],
  holeTable: ["tabulka děr", "holetable", "bohrungstabelle"],
  springTable: ["tabulka pružiny", "springtable", "federtabelle"],
  bom: ["kusovník", "bom", "stückliste"],
  balloons: ["balónky", "balloons", "positionsnummern"],
  projection: ["promítání", "projection", "projektion"],
  dimension: ["kótovat", "dimension", "bemaßen"],
  smart: ["chytře", "smart", "intelligent"],
  overall: ["celkově", "overall", "gesamt"],
  none: ["nic", "none", "keine"],
  basic: ["základní", "basic", "einfach"],
  chain: ["řetězově", "chain", "kette"],
  baseline: ["od základny", "baseline", "basis"],
  sheetNew: ["list nový", "sheet new", "blatt neu"],
  sheetRename: ["list přejmenovat", "sheet rename", "blatt umbenennen"],
  drawingNew: ["nový", "new", "neu"],
  title: ["razítko", "titleblock", "schriftfeld"],
  tName: ["název", "name", "benennung"],
  tNumber: ["číslo", "number", "nummer"],
  tAuthor: ["kreslil", "author", "ersteller"],
  tRevision: ["revize", "revision", "revision"],
  tDate: ["datum", "date", "datum"],
  tTol: ["nepředepsané", "general", "allgemeintoleranz"],
  tEdges: ["hrany", "edges", "kanten"],
  tNote: ["poznámka", "note", "hinweis"],
  zones: ["zóny", "zones", "zonen"],
  // odkazy: poslední prvek, poloha / osa odkazem, ukončení a směr vysunutí, úkos, přejmenování, smazání kót
  last: ["poslední", "last", "letzte"],
  on: ["na", "at", "bei"],
  mid: ["střed", "mid", "mitte"],
  ofEdge: ["hrany", "edge", "kante"],
  ofCircle: ["kružnice", "circle", "kreis"],
  ofFace: ["plochy", "face", "fläche"],
  start: ["začátek", "start", "anfang"],
  end: ["konec", "end", "ende"],
  between: ["mezi", "between", "zwischen"],
  edge: ["hrana", "edge", "kante"],
  points: ["body", "points", "punkte"],
  toFace: ["k ploše", "to face", "bis fläche"],
  toPlane: ["k rovině", "to plane", "bis ebene"],
  toVertex: ["k vrcholu", "to vertex", "bis punkt"],
  tilt: ["sklon", "tilt", "neigung"],
  toward: ["k", "toward", "nach"],
  faces: ["plochy", "faces", "flächen"],
  parting: ["dělicí", "parting", "trennlinie"],
  stepped: ["stupňovitý", "stepped", "gestuft"],
  tangent: ["tečně", "tangent", "tangential"],
  rename: ["přejmenovat", "rename", "umbenennen"],
  renameTo: ["na", "to", "zu"],
  docName: ["název", "name", "name"],
  del: ["smazat", "delete", "löschen"],
  about: ["rovina", "about", "spiegelebene"],
  // komentáře skriptu
  cPart: ["díl", "part", "Teil"],
  cAsm: ["sestava", "assembly", "Baugruppe"],
  cFeatures: ["prvků", "features", "Elemente"],
  cComponents: ["komponent", "components", "Komponenten"],
  cMates: ["vazeb", "mates", "Verknüpfungen"],
  cUsed: ["použit", "used", "verwendet"],
  cScript: ["textový skript dokumentu", "text script of document", "Textskript des Dokuments"],
  cRun: ["spuštění: vložte do konzole Textové příkazy nebo window.mncad.run(text) – vznikne nový dokument", "run: paste into the Text commands console or window.mncad.run(text) – a new document is created", "Ausführen: in die Konsole Textbefehle einfügen oder window.mncad.run(text) – ein neues Dokument entsteht"],
  cDrawing: ["výkres", "drawing", "Zeichnung"],
  cMotion: ["pohybová studie", "motion study", "Bewegungsstudie"],
  cPlacement: ["komponenty a polohy", "components and placement", "Komponenten und Lage"],
} as const;
type WordKey = keyof typeof WORDS;

const VIEW_WORDS: Record<string, [string, string, string]> = {
  front: ["přední", "front", "vorne"],
  back: ["zadní", "back", "hinten"],
  top: ["horní", "top", "oben"],
  bottom: ["spodní", "bottom", "unten"],
  left: ["levý", "left", "links"],
  right: ["pravý", "right", "rechts"],
  iso: ["iso", "iso", "iso"],
};
const CON_WORDS: Record<SketchConstraint["type"], [string, string, string]> = {
  horizontal: ["vodorovně", "horizontal", "waagerecht"],
  vertical: ["svisle", "vertical", "vertikal"],
  coincident: ["shodně", "coincident", "deckungsgleich"],
  parallel: ["rovnoběžně", "parallel", "parallel"],
  perpendicular: ["kolmo", "perpendicular", "rechtwinklig"],
  tangent: ["tečně", "tangent", "tangential"],
  equal: ["stejně", "equal", "gleich"],
  fixed: ["pevně", "fixed", "fest"],
  concentric: ["soustředně", "concentric", "konzentrisch"],
  midpoint: ["středem", "midpoint", "mittelpunkt"],
  pointOnCurve: ["na křivce", "on curve", "auf kurve"],
  symmetric: ["symetricky", "symmetric", "symmetrisch"],
  collinear: ["kolineárně", "collinear", "kollinear"],
};
const DIM_WORDS: Record<SketchDim["type"], [string, string, string]> = {
  length: ["délka", "length", "länge"],
  distance: ["vzdálenost", "distance", "abstand"],
  horizontal: ["vodorovně", "horizontal", "waagerecht"],
  vertical: ["svisle", "vertical", "vertikal"],
  radius: ["poloměr", "radius", "halbmesser"],
  diameter: ["průměr", "diameter", "durchmesser"],
  angle: ["úhel", "angle", "winkel"],
  arcLength: ["délka oblouku", "arc length", "bogenlänge"],
};
const MATE_WORDS: Record<string, [string, string, string]> = {
  mate: ["kontakt", "contact", "berührung"],
  center: ["vystředit", "center", "zentrieren"],
  flush: ["zarovnat", "flush", "bündig"],
  concentric: ["souosost", "concentric", "konzentrisch"],
  distance: ["vzdálenost", "distance", "abstand"],
  angle: ["úhel", "angle", "winkel"],
  parallel: ["rovnoběžně", "parallel", "parallel"],
  fixed: ["ukotvit", "fixed", "fixieren"],
  perpendicular: ["kolmo", "perpendicular", "senkrecht"],
  tangent: ["tečně", "tangent", "tangential"],
  coincident: ["shodně", "coincident", "koinzident"],
  symmetric: ["symetricky", "symmetric", "symmetrisch"],
  width: ["šířka", "width", "breite"],
  path: ["dráha", "path", "pfad"],
  slot: ["drážka", "slot", "langloch"],
  hinge: ["závěs", "hinge", "scharnier"],
  lock: ["zámek", "lock", "sperren"],
  limitDistance: ["mez vzdálenosti", "limit distance", "abstandsgrenze"],
  limitAngle: ["mez úhlu", "limit angle", "winkelgrenze"],
  gear: ["ozubení", "gear", "zahnrad"],
  rack: ["hřeben", "rack", "zahnstange"],
  screw: ["šroub", "screw", "schraube"],
  cam: ["vačka", "cam", "nocken"],
  universal: ["kardan", "universal", "kardangelenk"],
};

/* ───────────────────────── čísla, uvozovky ───────────────────────── */
/** Nejkratší přesný desetinný zápis (bez exponentu – ten parser nečte); −0 → 0. */
export function scriptNum(v: number): string {
  if (!Number.isFinite(v)) return "0";
  if (Object.is(v, -0) || v === 0) return "0";
  const s = String(v);
  // exponent rozepsat číslicemi (String dává nejkratší zápis, který se přečte zpět na totéž číslo)
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/i.exec(s);
  if (!m) return s;
  const digits = m[2] + (m[3] ?? "");
  const exp = Number(m[4]);
  if (exp < 0) return `${m[1]}0.${"0".repeat(-exp - 1)}${digits}`;
  const int = digits.slice(0, exp + 1).padEnd(exp + 1, "0");
  const frac = digits.slice(exp + 1);
  return `${m[1]}${int}${frac ? `.${frac}` : ""}`;
}
const n = scriptNum;
const vec = (v: readonly number[]) => v.map(n).join(" ");

/** řádek, který parser nezkrátí jako komentář (stejné pravidlo jako `parseAgentText` – agent-comment.ts) */
const lineSafe = (s: string) => !/[\r\n]/.test(s) && stripLineComment(s) === s;
/**
 * Text jako jeden token: bez uvozovek jen jednoduché slovo; null = text nejde zapsat na řádek skriptu (konec řádku v textu,
 * nebo „ #“ / „ //“ v textu, který nejde dát do uvozovek "…" / „…“ – tam parser komentář nehledá; „#2“ a „#e03930“ komentář nejsou).
 */
export function scriptQuote(s: string, always = false): string | null {
  if (/[\r\n]/.test(s)) return null;
  if (!always && /^[A-Za-zÀ-ž_][A-Za-zÀ-ž0-9_.-]*$/.test(s)) return s;
  const ok = (q: string) => (lineSafe(`x ${q} y`) ? q : null);
  if (!s.includes('"')) return ok(`"${s}"`);
  if (!s.includes("“") && !s.includes("„")) return ok(`„${s}“`);
  if (!s.includes("'")) return ok(`'${s}'`);
  return null;
}
/**
 * JSON na jeden řádek skriptu. „ #“ a „ //“ uvnitř textů se zapíší jako \u0023 / \u002f (JSON je přečte stejně) – řádek se tak
 * nezkrátí ani v parseru, který komentář hledal i uvnitř uvozovek.
 */
export const scriptJson = (v: unknown): string => JSON.stringify(v).replace(/(\s)#/g, "$1\\u0023").replace(/(\s)\/\//g, "$1\\u002f/");
/** překlad českého klíče do jazyka skriptu (ne do jazyka rozhraní jako `tr`) */
const trIn = (lang: ScriptLang, key: string): string => (lang === "cs" ? key : (dictOf(lang)[key] ?? key));
/** výchozí názvy dokumentů: `nový díl "Nový díl"` aplikace bere jako „bez názvu“ a přidělí číslovaný („Nový díl 2“) */
const isDefaultDocName = (name: string, key: "Nový díl" | "Nová sestava") => (["cs", "en", "de"] as ScriptLang[]).some((l) => trIn(l, key) === name);

/* ───────────────────────── porovnání ───────────────────────── */
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as Rec)
      .filter((k) => (v as Rec)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Rec)[k])}`)
      .join(",")}}`;
  return typeof v === "number" ? (Object.is(v, -0) ? "0" : String(v)) : (JSON.stringify(v) ?? "null");
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** odstraní otisky výběru (`sig` v odkazech, mapy `…Sigs`) */
function stripSigs(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripSigs);
  if (v && typeof v === "object") {
    const o: Rec = {};
    for (const [k, x] of Object.entries(v as Rec)) {
      if (/Sigs\d?$/.test(k)) continue;
      if (k === "sig" && x && typeof x === "object" && "t" in (x as Rec) && "c" in (x as Rec)) continue;
      o[k] = stripSigs(x);
    }
    return o;
  }
  return v;
}
const hasSigs = (v: unknown): boolean => stable(stripSigs(v)) !== stable(v);
/** volné porovnání entit skici: chybějící číslo = 0, chybějící příznak = false, čísla s tolerancí */
function loose(a: unknown, b: unknown, tol = 1e-9): boolean {
  if (typeof a === "number" || typeof b === "number") {
    const x = typeof a === "number" ? a : a === undefined || a === null ? 0 : NaN;
    const y = typeof b === "number" ? b : b === undefined || b === null ? 0 : NaN;
    return Math.abs(x - y) <= tol * Math.max(1, Math.abs(x), Math.abs(y));
  }
  if (typeof a === "boolean" || typeof b === "boolean") return !!a === !!b;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => loose(x, b[i], tol));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a as Rec), ...Object.keys(b as Rec)]);
    for (const k of keys) if (!loose((a as Rec)[k], (b as Rec)[k], tol)) return false;
    return true;
  }
  return a === b || (a == null && b == null);
}

/* ───────────────────────── stav zápisu ───────────────────────── */
const SOLID = new Set(["extrude", "revolve", "box", "cylinder", "sphere", "cone", "tube", "import", "sweep", "loft", "spring", "thicken", "text", "ext"]);
const SKETCH_KEYS = ["sketchId", "profileId", "pathId", "guideId"];
const SKETCH_LISTS = ["sketchIds", "profileIds", "guideIds"];

class Ctx {
  li: 0 | 1 | 2;
  /** jazyk skriptu = jazyk rozhraní, pro které se předpovídají automatické názvy prvků */
  lang: ScriptLang;
  names: "auto" | "all";
  sigs: "drop" | "keep";
  comments: boolean;
  deletedDims: Record<string, string[]>;
  genKeys: Record<string, string[]>;
  out: string[] = [];
  notes: string[] = [];
  noteSet = new Set<string>();
  /** čítače automatických názvů – stejné jako v `parseAgentText` (na celý skript) */
  counts: Record<string, number> = {};
  /** očekávané názvy prvků v pořadí zápisu (závěrečná kontrola celého skriptu) */
  expect: { type: string; name: string }[] = [];
  stats: ScriptStats = { features: 0, dedicated: 0, generic: 0, json: 0, byType: {}, parts: 0, components: 0, mates: 0, matesText: 0, sheets: 0, lines: 0, bytes: 0 };
  constructor(o: DocScriptOptions) {
    this.lang = o.lang === "en" || o.lang === "de" ? o.lang : "cs";
    this.li = this.lang === "en" ? 1 : this.lang === "de" ? 2 : 0;
    this.names = o.names ?? "auto";
    this.sigs = o.sigs === "drop" ? "drop" : "keep";
    this.comments = o.comments !== false;
    this.deletedDims = o.deletedDims ?? {};
    this.genKeys = o.genKeys ?? {};
  }
  /** výstup pro část výkresu (doc-script-sheet.ts) */
  get sheetOut(): SheetOut {
    return { li: this.li, line: (s) => this.line(s), note: (s) => this.note(s), n: scriptNum, q: scriptQuote };
  }
  w(k: WordKey): string {
    return WORDS[k][this.li];
  }
  yn(v: boolean): string {
    return this.w(v ? "yes" : "no");
  }
  line(s: string) {
    this.out.push(s);
  }
  comment(s: string) {
    if (this.comments) this.out.push(`# ${s.replace(/[\r\n]+/g, " ")}`);
  }
  blank() {
    if (this.out.length && this.out[this.out.length - 1] !== "") this.out.push("");
  }
  /** součty pro souhrnné poznámky (místo jedné poznámky na list / díl) */
  sums: Record<string, number> = {};
  sum(key: string, k = 1) {
    this.sums[key] = (this.sums[key] ?? 0) + k;
  }
  note(s: string) {
    if (this.noteSet.has(s)) return;
    this.noteSet.add(s);
    this.notes.push(s);
  }
  count(type: string, how: ScriptHow) {
    this.stats.features++;
    this.stats[how]++;
    (this.stats.byType[type] ??= { dedicated: 0, generic: 0, json: 0 })[how]++;
  }
}

/* ───────────────────────── odkazy na dřívější prvky ───────────────────────── */
const hasSolid = (feats: Feature[]) => feats.some((f) => SOLID.has(f.type) && !f.suppressed);
const lastSketch = (feats: Feature[]) => [...feats].reverse().find((f) => f.type === "sketch");
const fold2 = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/−/g, "-").trim();
/** pomocná geometrie odkazem `{ kind, featureId }` – stejné typy prvků jako `resolveDatumNames` (agent-prim.ts) */
const DATUM_KINDS: Record<string, string[]> = { datum: ["datum"], datumAxis: ["datumAxis", "csys"], datumPoint: ["datumPoint", "csys"] };

/**
 * Místo v prvku, které drží id dřívějšího prvku:
 *  - `top` = odkaz nejvyšší úrovně, který aplikace čte i jako `$last` nebo název (sketchId, profileId, featureId, seznamy, parametry rozšíření),
 *  - `name` = odkaz nejvyšší úrovně jen názvem (pathId, guideId – `$last` u nich aplikace nedoplní),
 *  - `datum` = pomocná rovina / osa / bod uvnitř prvku (`{ kind: "datum", featureId }`) – aplikace čte i název,
 *  - `id` = cokoli dalšího (bod skici `sketchPt.sketchId`, `centerlineId`) – jen id.
 */
type RefSite = { id: string; site: "top" | "name" | "datum" | "id"; what: "sketch" | "feature"; kind?: string; set: (v: string) => void };
const ID_KEY = /^(?!entity)[A-Za-z]*Ids?$/;
function refSites(f: Feature): RefSite[] {
  const out: RefSite[] = [];
  const rec = f as unknown as Rec;
  const str = (o: Rec, k: string | number, site: RefSite["site"], what: RefSite["what"], kind?: string) => {
    const v = (o as Record<string | number, unknown>)[k];
    if (typeof v === "string" && v) out.push({ id: v, site, what, kind, set: (x) => void ((o as Record<string | number, unknown>)[k] = x) });
  };
  const list = (o: Rec, k: string, site: RefSite["site"], what: RefSite["what"]) => {
    const v = o[k];
    if (Array.isArray(v)) v.forEach((_, i) => str(v as unknown as Rec, i, site, what));
  };
  const top = new Set<string>();
  const mark = (k: string) => (top.add(k), k);
  for (const k of ["sketchId", "profileId"]) str(rec, mark(k), "top", "sketch");
  for (const k of ["pathId", "guideId"]) str(rec, mark(k), "name", "sketch");
  for (const k of SKETCH_LISTS) list(rec, mark(k), "top", "sketch");
  str(rec, mark("featureId"), "top", "feature");
  str(rec, mark("partingSketchId"), "top", "sketch");
  list(rec, mark("featureIds"), "top", "feature");
  if (f.type === "ext" && f.data && typeof f.data === "object") {
    const data = f.data as Rec;
    for (const prm of getExt(f.ext)?.params ?? []) {
      if (prm.kind === "sketch") str(data, prm.key, "top", "sketch");
      else if (prm.kind === "feature") str(data, prm.key, "top", "feature");
      else if (prm.kind === "sketches") list(data, prm.key, "top", "sketch");
      else if (prm.kind === "features") list(data, prm.key, "top", "feature");
    }
  }
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    const o = v as Rec;
    for (const [k, x] of Object.entries(o)) {
      if (depth === 0 && (k === "id" || k === "name" || k === "type" || k === "entities" || k === "constraints" || k === "dims" || top.has(k))) continue;
      if (depth === 0 && f.type === "ext" && k === "data") {
        // parametry rozšíření podle registru jsou výše; zbytek dat (odkazy uvnitř směru / roviny) se projde do hloubky
        const keys = new Set((getExt(f.ext)?.params ?? []).filter((p) => ["sketch", "feature", "sketches", "features"].includes(p.kind)).map((p) => p.key));
        for (const [dk, dx] of Object.entries((x ?? {}) as Rec)) if (!keys.has(dk)) walk(dx, depth + 2);
        continue;
      }
      if (typeof x === "string" && ID_KEY.test(k)) {
        const kind = typeof o.kind === "string" ? o.kind : undefined;
        if (k === "featureId" && kind && DATUM_KINDS[kind]) str(o, k, "datum", "feature", kind);
        else str(o, k, "id", /sketch|profile|path|guide|centerline/i.test(k) ? "sketch" : "feature");
      } else if (Array.isArray(x) && ID_KEY.test(k) && x.every((y) => typeof y === "string")) list(o, k, "id", /sketch|profile|guide/i.test(k) ? "sketch" : "feature");
      else walk(x, depth + 1);
    }
  };
  walk(rec, 0);
  return out;
}
/** název, kterým aplikace najde právě tento prvek (odkaz nejvyšší úrovně – `refId` v cad-app.tsx: poslední shoda bez ohledu na velikost písmen) */
function topNameOk(target: Feature, what: "sketch" | "feature", feats: Feature[]): boolean {
  if (!target.name || target.name === "$last" || feats.some((x) => x.id === target.name)) return false;
  const hit = [...feats].reverse().find((x) => (what === "feature" || x.type === "sketch") && x.name.toLowerCase() === target.name.toLowerCase());
  return hit === target;
}
/** název pomocné roviny / osy / bodu, kterým aplikace najde právě tento prvek (`resolveDatumNames`) */
function datumNameOk(target: Feature, kind: string, feats: Feature[]): boolean {
  const types = DATUM_KINDS[kind] ?? [];
  if (!target.name || !types.includes(target.type) || feats.some((x) => x.id === target.name)) return false;
  const hit = [...feats].reverse().find((x) => types.includes(x.type) && fold2(x.name) === fold2(target.name));
  return hit === target;
}
/** název, kterým příkazy úprav (`konfigurace … potlačit`) najdou právě tento prvek (`findFeature` v agent-edit.ts) */
function editNameOk(target: Feature, feats: Feature[]): boolean {
  const q = target.name;
  if (!q.trim() || /^@\d+$/.test(q.trim()) || ["posledni", "last", "letzte", "letzter", "letztes", "$last"].includes(fold2(q)) || feats.some((x) => x.id === q.trim())) return false;
  const rev = [...feats].reverse();
  const hit = rev.find((f) => f.name.toLowerCase() === q.trim().toLowerCase()) ?? rev.find((f) => fold2(f.name) === fold2(q));
  return hit === target && !q.includes(";") && q === q.trim();
}

/** Plán odkazů dílu: které prvky si musí nechat id (→ JSON) a na které se skript odkazuje názvem (→ název výslovně). */
function planRefs(doc: CadDoc): { keepId: Set<string>; byName: Set<string> } {
  const keepId = new Set<string>();
  const byName = new Set<string>();
  doc.features.forEach((f, i) => {
    const before = doc.features.slice(0, i);
    for (const r of refSites(f)) {
      const target = before.find((x) => x.id === r.id);
      if (!target) continue;
      if (r.site === "top" || r.site === "name") {
        const lastOne = r.what === "sketch" ? lastSketch(before) : before[before.length - 1];
        if (r.site === "top" && lastOne === target) continue; // `$last`
        if (topNameOk(target, r.what, before)) byName.add(target.id);
        else keepId.add(target.id);
      } else if (r.site === "datum" && datumNameOk(target, r.kind!, before)) byName.add(target.id);
      else keepId.add(target.id);
    }
  });
  for (const cf of doc.configs ?? []) for (const id of cf.suppressed) {
    const t = doc.features.find((x) => x.id === id);
    if (t && editNameOk(t, doc.features)) byName.add(t.id);
  }
  return { keepId, byName };
}

/* ───────────────────────── zrcadlo doplnění prvku v aplikaci (prepare) ───────────────────────── */
/** odkaz na skicu / prvek tak, jak ho čte aplikace (`refId` v cad-app.tsx): id, `$last`, název (poslední shoda bez ohledu na velikost písmen) */
function resolveRef(v: unknown, what: "sketch" | "feature", feats: Feature[]): unknown {
  if (typeof v !== "string" || feats.some((x) => x.id === v)) return v;
  if (v === "$last") {
    const hit = what === "sketch" ? lastSketch(feats) : feats[feats.length - 1];
    if (!hit) throw new Error("no $last");
    return hit.id;
  }
  const hit = [...feats].reverse().find((x) => (what === "feature" || x.type === "sketch") && x.name.toLowerCase() === v.toLowerCase());
  if (!hit) throw new Error("no ref");
  return hit.id;
}
/**
 * Doplní přečtený prvek jako `prepare` v aplikaci (odkazy, pomocná geometrie názvem, těleso, operace); název a id nechá.
 * `feats` = prvky dokumentu po přečtení skriptu. Odkaz, který aplikace nedoplní (`$last` u pathId / guideId, neznámé id),
 * je chyba – řádek by v aplikaci dal prvek s neplatným odkazem.
 */
function mirrorPrepare(g0: Feature, feats: Feature[]): Feature {
  const f = clone(g0);
  const rec = f as unknown as Rec;
  for (const k of SKETCH_KEYS) if (k in rec && rec[k] !== "$last") rec[k] = resolveRef(rec[k], "sketch", feats);
  for (const k of SKETCH_LISTS) if (Array.isArray(rec[k])) rec[k] = (rec[k] as unknown[]).map((v) => resolveRef(v, "sketch", feats));
  if ("featureId" in rec && rec.featureId !== "$last") rec.featureId = resolveRef(rec.featureId, "feature", feats);
  if (typeof rec.partingSketchId === "string" && rec.partingSketchId) rec.partingSketchId = resolveRef(rec.partingSketchId, "sketch", feats);
  if (Array.isArray(rec.featureIds)) rec.featureIds = (rec.featureIds as unknown[]).map((v) => resolveRef(v, "feature", feats));
  if (f.type === "ext") {
    const data = { ...(f.data ?? {}) } as Rec;
    for (const prm of getExt(f.ext)?.params ?? []) {
      if (prm.kind === "sketch" && data[prm.key]) data[prm.key] = resolveRef(data[prm.key], "sketch", feats);
      else if (prm.kind === "feature" && data[prm.key]) data[prm.key] = resolveRef(data[prm.key], "feature", feats);
      else if (prm.kind === "sketches" && Array.isArray(data[prm.key])) data[prm.key] = (data[prm.key] as unknown[]).map((v) => resolveRef(v, "sketch", feats));
      else if (prm.kind === "features" && Array.isArray(data[prm.key])) data[prm.key] = (data[prm.key] as unknown[]).map((v) => resolveRef(v, "feature", feats));
    }
    (f as { data: Rec }).data = data;
  }
  resolveDatumNames(f, feats, true);
  if (f.body === "$new") f.body = hasSolid(feats) ? nextBodyName(bodiesAt({ features: feats }).names) : undefined;
  // `$last` doplní aplikace jen u sketchId / profileId (poslední skica) a featureId (poslední prvek)
  for (const k of ["sketchId", "profileId"]) if (rec[k] === "$last") rec[k] = resolveRef("$last", "sketch", feats);
  if (rec.featureId === "$last") rec.featureId = resolveRef("$last", "feature", feats);
  const m = f as Feature & { mode?: string };
  if (m.mode === "$auto" || (m.mode === "add" && !hasSolid(feats))) m.mode = hasSolid(feats) ? "add" : "new";
  // každý odkaz musí mířit na prvek, který v dokumentu po přečtení existuje
  for (const r of refSites(f)) if (!feats.some((x) => x.id === r.id)) throw new Error("dangling ref");
  return f;
}
/** tvar prvku pro porovnání: bez id, názvu a potlačení (to zapisuje zvláštní řádek), indexy výběru seřazené, `add` bez tělesa = `new` */
function canonFeature(f0: Feature, feats: Feature[], dropSigs: boolean): string {
  let f = clone(f0) as unknown as Rec;
  if (dropSigs) f = stripSigs(f) as Rec;
  delete f.id;
  delete f.name;
  delete f.suppressed;
  if (f.mode === "add" && !hasSolid(feats)) f.mode = "new";
  for (const pf of pickFieldsOf(f0)) {
    let o: unknown = f;
    for (const k of pf.path.slice(0, -1)) o = o && typeof o === "object" ? (o as Rec)[k] : undefined;
    const key = pf.path[pf.path.length - 1];
    const arr = o && typeof o === "object" ? (o as Rec)[key] : undefined;
    if (Array.isArray(arr) && arr.every((x) => typeof x === "number")) (o as Rec)[key] = [...(arr as number[])].sort((a, b) => a - b);
  }
  return stable(f);
}
/** prvek s odkazy přepsanými z původních id na id po přečtení skriptu (`ids`) */
function toReplayIds<T extends Feature>(f0: T, ids: Map<string, string>): T {
  const f = clone(f0);
  for (const r of refSites(f)) {
    const to = ids.get(r.id);
    if (to !== undefined) r.set(to);
  }
  return f;
}

/** Přečte jeden řádek stejným rozborem jako konzole; vrátí prvek (čísla hran / ploch z pravidla E2 E5 doplní), jinak null. */
function parseFeatureLine(line: string): Feature | null {
  let prog;
  try {
    prog = parseAgentText(line);
  } catch {
    return null;
  }
  if (prog.errors.length || prog.ops.length !== 1) return null;
  const op = prog.ops[0] as AgentOp;
  if (op.k === "feature") return op.fillTop ? null : op.feature;
  if (op.k === "features") return op.features.length === 1 ? op.features[0] : null;
  if (op.k === "select") {
    // jen čísla (E2 E5 / F3 F5): indexy jsou dané zápisem, jádro je netřeba
    const idx: number[] = [];
    for (const w of op.rule) {
      for (const part of w.split(/[;,]/)) {
        const m = /^[ef](\d+)$/i.exec(part.trim());
        if (!m) return null;
        idx.push(Number(m[1]) - 1);
      }
    }
    const f = clone(op.feature) as unknown as Rec;
    if (op.into) {
      const keys = op.into.path.split(".");
      let o = f;
      for (const k of keys.slice(0, -1)) o = (o[k] ??= {}) as Rec;
      o[keys[keys.length - 1]] = idx;
    } else if (f.type === "shell") f.faces = idx;
    else if (f.type === "fillet" || f.type === "chamfer") f.edges = idx;
    else return null;
    return f as unknown as Feature;
  }
  return null;
}

/* ───────────────────────── zápis prvků ───────────────────────── */
type PartCtx = {
  c: Ctx;
  doc: CadDoc;
  /** původní prvky zapsané dosud (stav PŘED aktuálním prvkem) */
  feats: Feature[];
  /** tytéž prvky tak, jak budou v dokumentu po přečtení skriptu: prvky z textu mají nová id, prvky z JSON si id nechají */
  replay: Feature[];
  /** původní id → id po přečtení skriptu */
  ids: Map<string, string>;
  /** prvky, na které míří odkaz, který nejde zapsat názvem – musí si nechat id (zápis JSON) */
  keepId: Set<string>;
  /** prvky, na které se skript odkazuje názvem – název se píše výslovně (automatický závisí na jazyce rozhraní) */
  byName: Set<string>;
};
/** prvek je zapsán: do stavu dílu přibude původní prvek i jeho podoba po přečtení skriptu (`keptId` = řádek JSON s původním id) */
function pushFeature(p: PartCtx, f: Feature, keptId: boolean) {
  const id = keptId && !p.replay.some((x) => x.id === f.id) ? f.id : `\u0003${p.replay.length + 1}`;
  p.ids.set(f.id, id);
  p.replay.push({ ...toReplayIds(f, p.ids), id } as Feature);
  p.feats.push(f);
}

const modeWord = (c: Ctx, mode: string): string => (mode === "cut" ? c.w("cut") : mode === "intersect" ? c.w("intersect") : mode === "new" ? c.w("newbody") : c.w("add"));
/** příznak operace: bez příznaku aplikace přidá k tělesu, a když žádné není, založí nové (primitiva, vysunutí, rotace) */
function primMode(p: PartCtx, f: { mode: string }): string {
  const solid = hasSolid(p.feats);
  if (f.mode === "cut" || f.mode === "intersect") return ` ${modeWord(p.c, f.mode)}`;
  if (f.mode === "new") return solid ? ` ${p.c.w("newbody")}` : "";
  return "";
}
const bodyPart = (p: PartCtx, f: Feature): string => {
  if (!f.body) return "";
  const q = scriptQuote(f.body, true);
  // „nové“ dostane v aplikaci další volný název tělesa – shoduje-li se s uloženým, netřeba ho psát
  if ("mode" in f && f.mode === "new" && hasSolid(p.feats) && f.body === nextBodyName(bodiesAt({ features: p.feats }).names)) return "";
  return q ? ` ${p.c.w("body")} ${q}` : "";
};
const atPart = (c: Ctx, pos: readonly number[] | undefined, always = false): string => (pos && (always || pos.some((v) => v !== 0)) ? ` ${c.w("at")} ${vec(pos)}` : "");
const dirWord = (v: readonly number[]): string => {
  const nz = v.map((x, i) => [x, i] as const).filter(([x]) => x !== 0);
  if (nz.length === 1 && Math.abs(nz[0][0]) === 1) return `${nz[0][0] < 0 ? "-" : ""}${"XYZ"[nz[0][1]]}`;
  return vec(v);
};
const eList = (idx: number[], letter: "E" | "F") => idx.map((i) => `${letter}${i + 1}`).join(" ");
/** vektor směru odkazem: záporná jednotková osa jako -X / -Y / -Z (parser ji čte jako vektor), jinak tři čísla (X by přečetl jako osu) */
const vecText = (v: readonly number[]): string => {
  const w = dirWord(v);
  return /^-[XYZ]$/.test(w) ? w : vec(v);
};
/** název pomocné roviny / osy / bodu pro vlastní příkaz (`osa "Osa 1"`); null = prvek není nebo název nejde zapsat */
function datumName(p: PartCtx, id: string): string | null {
  const t = p.feats.find((x) => x.id === id);
  return t ? scriptQuote(t.name, true) : null;
}
/** bod odkazem tak, jak se píše za `na` (V3 · střed hrany E2 · střed kružnice E5 · střed plochy F3 · bod "Bod 1" · mezi V1 V5 · počátek) */
function pointText(p: PartCtx, r: Ref): string | null {
  const c = p.c;
  switch (r.kind) {
    case "vertex":
      return `V${r.index + 1}`;
    case "face":
      return `${c.w("mid")} ${c.w("ofFace")} F${r.index + 1}`;
    case "edge": {
      const e = `E${r.index + 1}`;
      if (r.at === undefined || r.at === "mid") return `${c.w("mid")} ${c.w("ofEdge")} ${e}`;
      if (r.at === "center") return `${c.w("mid")} ${c.w("ofCircle")} ${e}`;
      if (r.at === "start" || r.at === "end") return `${c.w(r.at)} ${c.w("ofEdge")} ${e}`;
      return null;
    }
    case "datumPoint": {
      const q = datumName(p, r.featureId);
      return q ? `${c.w("point")} ${q}` : null;
    }
    case "csys":
      return r.axis ? null : c.w("origin");
    case "xyz":
      return `${c.w("point")} ${vec(r.p)}`;
    case "derived": {
      if (r.op !== "mid" || r.args.length !== 2 || r.v !== undefined) return null;
      const a = pointText(p, r.args[0]);
      const b = pointText(p, r.args[1]);
      return a && b ? `${c.w("between")} ${a} ${b}` : null;
    }
    default:
      return null;
  }
}
/** poloha primitiva: čísly `v x y z`, nebo odkazem `na …` */
function placePart(p: PartCtx, f: { position: Vec3; positionRef?: Ref }): string | null {
  if (!f.positionRef) return atPart(p.c, f.position);
  const t = pointText(p, f.positionRef);
  return t ? ` ${p.c.w("on")} ${t}` : null;
}
/** směr / osa odkazem tak, jak se píše za `osa` / `směr` (X · 1 0 1 · hrana E3 · plocha F2 · "Osa 1" · body V1 V5) */
function dirText(p: PartCtx, d: Direction, axisWord: boolean): string | null {
  const c = p.c;
  switch (d.kind) {
    case "axis":
      return d.axis;
    case "vector":
      return vecText(d.v);
    case "edge": {
      if (d.ref.kind === "edge") return `${c.w("edge")} E${d.ref.index + 1}`;
      if (d.ref.kind === "datumAxis") {
        const q = datumName(p, d.ref.featureId);
        // za `směr` se pomocná osa píše `osa "Osa 1"`, za `osa` jen názvem
        return q ? (axisWord ? q : `${c.w("axis")} ${q}`) : null;
      }
      return null;
    }
    case "faceNormal":
      return d.ref.kind === "face" ? `${c.w("face")} F${d.ref.index + 1}` : null;
    case "twoPoints":
      return d.a.kind === "vertex" && d.b.kind === "vertex" ? `${c.w("points")} V${d.a.index + 1} V${d.b.index + 1}` : null;
    default:
      return null;
  }
}
function axisPart(p: PartCtx, f: { axis?: string; dirDef?: unknown }): string | null {
  const d = f.dirDef as Direction | undefined;
  if (d) {
    const t = dirText(p, d, true);
    return t ? ` ${p.c.w("axis")} ${t}` : null;
  }
  return f.axis && f.axis !== "Z" ? ` ${p.c.w("axis")} ${f.axis}` : "";
}
/** osa rotace / kruhového pole odkazem (za slovem `osa`) */
function axisDefText(p: PartCtx, a: { kind: string; axis?: string; featureId?: string; ref?: Ref; a?: Ref; b?: Ref }): string | null {
  const c = p.c;
  if (a.kind === "global" && a.axis) return a.axis;
  if (a.kind === "datumAxis" && a.featureId) return datumName(p, a.featureId);
  if (a.kind === "edge" && a.ref?.kind === "edge") return `${c.w("edge")} E${a.ref.index + 1}`;
  if (a.kind === "edge" && a.ref?.kind === "datumAxis") return datumName(p, a.ref.featureId);
  if (a.kind === "cylFace" && a.ref?.kind === "face") return `${c.w("face")} F${a.ref.index + 1}`;
  if (a.kind === "twoPoints" && a.a?.kind === "vertex" && a.b?.kind === "vertex") return `${c.w("points")} V${a.a.index + 1} V${a.b.index + 1}`;
  return null;
}

/** Vlastní textové příkazy prvku (bez názvu) v pořadí od nejčtenějšího; prázdné = prvek vlastní příkaz nemá nebo ho tento zápis nepokrývá. */
function dedicated(p: PartCtx, f: Feature): string[] {
  const c = p.c;
  const last = lastSketch(p.feats);
  const one = (s: string | null): string[] => (s === null ? [] : [s]);
  switch (f.type) {
    case "box": {
      const at = placePart(p, f);
      return one(at === null ? null : `${c.w("box")} ${vec(f.size)}${f.centered ? ` ${c.w("center")}` : ""}${at}${primMode(p, f)}${bodyPart(p, f)}`);
    }
    case "cylinder": {
      const ax = axisPart(p, f);
      const at = placePart(p, f);
      return one(ax === null || at === null ? null : `${c.w("cylinder")} ${n(2 * f.radius)} ${n(f.height)}${at}${ax}${primMode(p, f)}${bodyPart(p, f)}`);
    }
    case "sphere": {
      const at = placePart(p, f);
      return one(at === null ? null : `${c.w("sphere")} ${n(2 * f.radius)}${at}${primMode(p, f)}${bodyPart(p, f)}`);
    }
    case "cone": {
      const ax = axisPart(p, f);
      const at = placePart(p, f);
      return one(ax === null || at === null ? null : `${c.w("cone")} ${n(2 * f.radius1)} ${n(2 * f.radius2)} ${n(f.height)}${at}${ax}${primMode(p, f)}${bodyPart(p, f)}`);
    }
    case "tube": {
      const ax = axisPart(p, f);
      const at = placePart(p, f);
      return one(ax === null || at === null ? null : `${c.w("tube")} ${n(f.outer)} ${n(f.inner)} ${n(f.height)}${at}${ax}${primMode(p, f)}${bodyPart(p, f)}`);
    }
    case "spring": {
      const ax = axisPart(p, f);
      const at = placePart(p, f);
      return one(ax === null || at === null ? null : `${c.w("spring")} ${n(2 * f.radius)} ${c.w("pitch")} ${n(f.pitch)} ${c.w("turns")} ${n(f.turns)} ${c.w("wire")} ${n(f.wire)}${at}${ax}${primMode(p, f)}${bodyPart(p, f)}`);
    }
    case "ext":
      // pružiny z tabulky: `pružina tlačná d 2 De 20 L0 50 n 8 …` (agent-springs.ts); ostatní rozšíření obecným `prvek`
      return one(springScriptLine(f, c.lang));
    case "thread": {
      const ax = axisPart(p, f);
      const at = placePart(p, f);
      return one(ax === null || at === null ? null : `${c.w("thread")} ${f.designation.replace(/\s+/g, "")} ${c.w("length")} ${n(f.length)}${at}${ax}${f.internal ? ` ${c.w("internal")}` : ""}${f.modeled ? ` ${c.w("modeled")}` : ""}`);
    }
    case "extrude": {
      if (!last || f.sketchId !== last.id) return [];
      const e = f.extent;
      // ukončení odkazem: vzdálenost se píše jen tehdy, když ji parser sám nedoplní stejnou (ověří se obě podoby)
      const heads: string[] = [];
      const dist = f.normalHeight ? `${c.w("height")} ${n(f.distance)}` : n(f.distance);
      if (!e) heads.push(dist);
      else {
        let end: string | null = null;
        if (e.kind === "throughAll") end = c.w("through");
        else if (e.kind === "toNext") end = c.w("toNext");
        else if (e.kind === "toBody") end = c.w("toBody");
        else if (e.kind === "toVertex" && e.ref.kind === "vertex") end = `${c.w("toVertex")} V${e.ref.index + 1}`;
        else if (e.kind === "toFace") {
          const off = e.offset ? ` ${c.w("offset")} ${n(e.offset)}` : "";
          if (e.ref.kind === "face") end = `${c.w("toFace")} F${e.ref.index + 1}${off}`;
          else if (e.ref.kind === "datum") {
            const q = datumName(p, e.ref.featureId);
            if (q) end = `${c.w("toPlane")} ${q}${off}`;
          }
        }
        if (end === null) return [];
        heads.push(end, `${dist} ${end}`);
      }
      let tail = "";
      if (f.dir) {
        if (f.dir.kind === "angle") tail += ` ${c.w("tilt")} ${n(f.dir.deg)}${f.dir.toward ? ` ${c.w("toward")} ${dirWord(f.dir.toward)}` : ""}`;
        else if (f.dir.kind === "axis") tail += ` ${c.w("direction")} +${f.dir.axis}`;
        else {
          const t = dirText(p, f.dir, false);
          if (!t) return [];
          tail += ` ${c.w("direction")} ${t}`;
        }
      }
      if (f.symmetric) tail += ` ${c.w("symmetric")}`;
      if (f.reverse) tail += ` ${c.w("reverse")}`;
      tail += primMode(p, f);
      if (f.draftAngle) {
        tail += ` ${c.w("draft")} ${n(f.draftAngle)}`;
        if (f.draftLand) tail += ` ${c.w("land")} ${n(f.draftLand)}`;
        if (f.draftCorners === "round") tail += ` ${c.w("round")}`;
      }
      return heads.map((h) => `${c.w("extrude")} ${h}${tail}${bodyPart(p, f)}`);
    }
    case "revolve": {
      if (!last || f.sketchId !== last.id) return [];
      let s = c.w("revolve");
      if (f.angle !== 360) s += ` ${n(f.angle)}`;
      const a = f.axisDef;
      if (a) {
        const t = axisDefText(p, a);
        if (!t) return [];
        s += ` ${c.w("axis")} ${t}`;
      } else if (f.axis === "x") s += ` ${c.w("axis")} sketchx`;
      if (f.symmetric) s += ` ${c.w("symmetric")}`;
      return [s + primMode(p, f) + bodyPart(p, f)];
    }
    case "hole": {
      let s = `${c.w("hole")} ${n(f.diameter)}`;
      if (f.end) {
        if (f.end.kind !== "toBody") return [];
        s += ` ${c.w("toBody")}`;
      } else s += f.depth > 0 ? ` ${c.w("depth")} ${n(f.depth)}` : ` ${c.w("through")}`;
      if (f.bothWays) s += ` ${c.w("bothways")}`;
      if (f.points) {
        for (const pt of f.points) {
          if (pt.kind !== "xyz") return [];
          s += ` ${c.w("at")} ${vec(pt.p)}`;
        }
      } else s += ` ${c.w("at")} ${vec(f.position)}`;
      if (f.axis !== "Z") s += ` ${c.w("axis")} ${f.axis}`;
      const d = f.dirDef;
      if (d) {
        if (d.kind !== "vector") return [];
        s += ` ${c.w("direction")} ${vec(d.v)}`;
        if (!f.flip) s += ` ${c.w("reverse")}`;
      } else if (f.flip) s += ` ${c.w("reverse")}`;
      if (f.cbDiameter > 0 || f.kind === "counterbore") s += ` ${c.w("counterbore")} ${n(f.cbDiameter)} ${n(f.cbDepth)}`;
      if (f.csDiameter !== undefined) s += ` ${c.w("countersink")} ${n(f.csDiameter)}${f.csAngle !== undefined && f.csAngle !== 90 ? ` ${n(f.csAngle)}` : ""}`;
      if (f.thread) {
        s += ` ${c.w("thread")} ${f.thread.replace(/\s+/g, "")}`;
        if (f.threadDepth) s += ` ${c.w("threadDepth")} ${n(f.threadDepth)}`;
      }
      return [s + bodyPart(p, f)];
    }
    case "fillet": {
      if (f.kind && f.kind !== "constant") return [];
      return [`${c.w("fillet")} ${n(f.radius)}${f.edges === "all" ? "" : ` ${c.w("edges")} ${eList(f.edges, "E")}`}${bodyPart(p, f)}`];
    }
    case "chamfer": {
      const edges = f.edges === "all" ? "" : ` ${c.w("edges")} ${eList(f.edges, "E")}`;
      const face = f.faceRef?.kind === "face" ? ` ${c.w("face")} F${f.faceRef.index + 1}` : null;
      if (f.kind === "distanceAngle") return one(face ? `${c.w("chamfer")} ${n(f.distance)} ${c.w("angle")} ${n(f.angle ?? 45)}${face}${edges}${bodyPart(p, f)}` : null);
      if (f.kind === "twoDistances") return one(face ? `${c.w("chamfer")} ${n(f.distance)} ${n(f.d2 ?? f.distance)}${face}${edges}${bodyPart(p, f)}` : null);
      if (f.kind && f.kind !== "equal") return [];
      return [`${c.w("chamfer")} ${n(f.distance)}${edges}${bodyPart(p, f)}`];
    }
    case "shell":
      return [`${c.w("shell")} ${n(f.thickness)}${f.faces.length ? ` ${c.w("openFaces")} ${eList(f.faces, "F")}` : ""}${bodyPart(p, f)}`];
    case "draft": {
      // úkos kolem neutrální roviny / s dělicí křivkou (agent-shapes.ts): plochy čísly, rovina, odsazení, směr tahu
      if (!f.faces.length || f.planeDef) return [];
      let s = `${c.w("draft")} ${n(f.angle)} ${c.w("faces")} ${eList(f.faces, "F")}`;
      if (f.plane !== "XY") s += ` ${c.w("plane")} ${f.plane}`;
      if (f.offset) s += ` ${c.w("offset")} ${n(f.offset)}`;
      const parting = f.partingSketchId !== undefined;
      const dflt = f.plane === "XY" ? "Z" : f.plane === "XZ" ? "Y" : "X";
      if (f.pull && !(parting && f.pull.kind === "axis" && f.pull.axis === dflt)) {
        if (f.pull.kind === "axis") s += ` ${c.w("direction")} +${f.pull.axis}`;
        else if (f.pull.kind === "vector") s += ` ${c.w("direction")} ${vecText(f.pull.v)}`;
        else return [];
      }
      if (parting) {
        const sk = p.feats.find((x) => x.id === f.partingSketchId && x.type === "sketch");
        if (!sk) return [];
        if (sk === last) s += ` ${c.w("parting")}`;
        else {
          const q = scriptQuote(sk.name, true);
          if (!q) return [];
          s += ` ${c.w("parting")} ${q}`;
        }
      }
      if (f.step) s += ` ${c.w("stepped")}`;
      if (f.tangentChain) s += ` ${c.w("tangent")}`;
      return [s + bodyPart(p, f)];
    }
    case "pattern": {
      const prev = p.feats[p.feats.length - 1];
      if (!prev || f.featureId !== prev.id) return [];
      if (f.kind === "linear") {
        const dir = (def: Direction | undefined, v: readonly number[]) => (def ? dirText(p, def, false) : dirWord(v));
        const d1 = dir(f.dirDef, f.direction);
        if (!d1) return [];
        let s = `${c.w("pattern")} ${n(f.count)} ${c.w("spacing")} ${n(f.spacing)} ${c.w("direction")} ${d1}`;
        if (f.count2 !== undefined && f.spacing2 !== undefined) {
          const d2 = dir(f.dirDef2, f.direction2 ?? [0, 1, 0]);
          if (!d2) return [];
          s += ` ${n(f.count2)} ${c.w("spacing")} ${n(f.spacing2)} ${c.w("direction")} ${d2}`;
        }
        return [s + bodyPart(p, f)];
      }
      if (f.kind === "circular") {
        let ax = f.axis !== "Z" ? ` ${c.w("axis")} ${f.axis}` : "";
        if (f.axisDef) {
          const t = axisDefText(p, f.axisDef);
          if (!t) return [];
          ax = ` ${c.w("axis")} ${t}`;
        }
        return [`${c.w("pattern")} ${c.w("circular")} ${n(f.count)}${f.angle !== 360 ? ` ${c.w("angle")} ${n(f.angle)}` : ""}${ax}${atPart(c, f.center)}${bodyPart(p, f)}`];
      }
      return [];
    }
    case "mirror": {
      const off = (v: number | undefined) => (v ? ` ${c.w("offset")} ${n(v)}` : "");
      const d = f.planeDef;
      if (d) {
        if (d.kind === "face" && d.ref.kind === "face") return [`${c.w("mirror")} ${c.w("face")} F${d.ref.index + 1}${off(d.offset)}${bodyPart(p, f)}`];
        if (d.kind === "datum") {
          const q = datumName(p, d.featureId);
          return one(q ? `${c.w("mirror")} ${c.w("plane")} ${q}${off(d.offset)}${bodyPart(p, f)}` : null);
        }
        return [];
      }
      return [`${c.w("mirror")} ${f.plane}${off(f.offset)}${bodyPart(p, f)}`];
    }
    case "text": {
      if (f.plane.kind !== "base") return [];
      const q = scriptQuote(f.text, true);
      if (!q) return [];
      return [`${c.w("text")} ${q}${f.plane.name !== "XY" ? ` ${f.plane.name}` : ""} ${c.w("height")} ${n(f.height)} ${c.w("depth")} ${n(f.depth)} ${c.w("at")} ${n(f.position[0])} ${n(f.position[1])} ${n(f.plane.offset)}${f.angle ? ` ${c.w("angle")} ${n(f.angle)}` : ""}${f.mode === "cut" ? ` ${c.w("engrave")}` : ""}${bodyPart(p, f)}`];
    }
    case "splitBodies": {
      const q = f.nameB ? scriptQuote(f.nameB, true) : "";
      return one(q === null ? null : `${c.w("splitBodies")} ${f.plane}${f.offset ? ` ${c.w("offset")} ${n(f.offset)}` : ""}${q ? ` ${c.w("as")} ${q}` : ""}${bodyPart(p, f)}`);
    }
    case "copyBody": {
      const src = f.source ? scriptQuote(f.source, true) : "";
      const q = f.newName ? scriptQuote(f.newName, true) : "";
      return one(src === null || q === null ? null : `${c.w("copyBody")}${src ? ` ${c.w("body")} ${src}` : ""}${f.translate.some((v) => v !== 0) ? ` ${c.w("shift")} ${vec(f.translate)}` : ""}${q ? ` ${c.w("as")} ${q}` : ""}`);
    }
    case "combine": {
      const a = scriptQuote(f.target, true);
      const b = scriptQuote(f.tool, true);
      return one(!a || !b || !f.target || !f.tool ? null : `${c.w("combine")} ${a} ${b}${f.op === "cut" ? ` ${c.w("cut")}` : f.op === "intersect" ? ` ${c.w("intersect")}` : ""}${f.keepTool ? ` ${c.w("keep")}` : ""}`);
    }
    default:
      return [];
  }
}

/** hodnota za `klíč=` obecného příkazu `prvek`; null = hodnotu nejde zapsat */
function genericValue(c: Ctx, v: unknown): string | null {
  if (typeof v === "number") return n(v);
  if (typeof v === "boolean") return c.yn(v);
  if (typeof v === "string") {
    if (/^[A-Za-zÀ-ž_$][A-Za-zÀ-ž0-9_.$×-]*$/.test(v)) return v;
    if (v.includes('"') || !lineSafe(`x k="${v}" y`)) return null;
    return `"${v}"`;
  }
  if (Array.isArray(v) && v.length >= 2 && v.every((x) => typeof x === "number")) return (v as number[]).map(n).join(";");
  if (v && typeof v === "object") return scriptJson(v);
  return null;
}
/**
 * Prvek s odkazy přepsanými pro obecný příkaz a JSON: `$last` (kde ho aplikace doplní) nebo název; odkaz, který názvem zapsat
 * nejde, zůstane původním id – platí, když si odkazovaný prvek id nechal (zápis JSON, viz `planRefs`), jinak řádek neprojde ověřením.
 */
function withNameRefs(f0: Feature, p: PartCtx): Feature {
  const f = clone(f0);
  for (const r of refSites(f)) {
    const target = p.feats.find((x) => x.id === r.id);
    if (!target) continue;
    if (r.site === "top" || r.site === "name") {
      const lastOne = r.what === "sketch" ? lastSketch(p.feats) : p.feats[p.feats.length - 1];
      if (r.site === "top" && lastOne === target) r.set("$last");
      else if (topNameOk(target, r.what, p.feats)) r.set(target.name);
    } else if (r.site === "datum" && datumNameOk(target, r.kind!, p.feats)) r.set(target.name);
  }
  return f;
}
/** Obecný příkaz `prvek <typ> klíč=hodnota …` (bez názvu); null = některé pole nejde zapsat. */
function generic(p: PartCtx, f0: Feature): string | null {
  const c = p.c;
  const f = withNameRefs(c.sigs === "drop" ? (stripSigs(f0) as Feature) : f0, p) as unknown as Rec;
  const parts: string[] = [];
  const add = (key: string, v: unknown): boolean => {
    if (v === undefined) return true;
    const s = key === "mode" && typeof v === "string" ? modeWord(c, v) : genericValue(c, v);
    if (s === null) return false;
    parts.push(`${key}=${s}`);
    return true;
  };
  if (f.type === "ext") {
    if (!getExt(String(f.ext))) return null;
    for (const [k, v] of Object.entries((f.data ?? {}) as Rec)) if (!add(k, v)) return null;
    for (const [k, v] of Object.entries(f)) if (!["id", "name", "type", "ext", "data", "suppressed"].includes(k) && v !== undefined) return null;
    return `${c.w("feature")} ${f.ext} ${parts.join(" ")}`.trim();
  }
  for (const [k, v] of Object.entries(f)) {
    if (k === "id" || k === "name" || k === "type" || k === "suppressed") continue;
    if (!add(k, v)) return null;
  }
  return `${c.w("feature")} ${f.type} ${parts.join(" ")}`.trim();
}

/** automatický název, který by prvku přidělila textová cesta v rozhraní jazyka skriptu (čítač rozboru + volný název v dílu) */
function autoName(p: PartCtx, f: Feature): string {
  const label = trIn(p.c.lang, FEATURE_LABEL[f.type] ?? f.type);
  return freeName(p.replay, { ...f, id: "\u0001", name: `${label} ${(p.c.counts[f.type] ?? 0) + 1}` } as Feature);
}
/** ověří řádek proti původnímu prvku nad dokumentem po přečtení skriptu; `explicitName` = řádek nese název prvku */
function verify(p: PartCtx, f: Feature, line: string, explicitName: boolean, dropSigs: boolean): boolean {
  const g = parseFeatureLine(line);
  if (!g || g.type !== f.type) return false;
  let m: Feature;
  try {
    m = mirrorPrepare(g, p.replay);
  } catch {
    return false;
  }
  if (canonFeature(m, p.feats, dropSigs) !== canonFeature(toReplayIds(f, p.ids), p.feats, dropSigs)) return false;
  if (explicitName) return freeName(p.replay, { ...g, id: "\u0001" } as Feature) === f.name;
  return true;
}
/** řádek příkazu úprav (`přejmenovat poslední na …`, `potlačit poslední`, `upravit poslední klíč=…`) přečtený rozborem konzole */
function editCmd(line: string): Rec | null {
  try {
    const pr = parseAgentText(line);
    const op = pr.ops[0] as { k: string; cmd?: Rec } | undefined;
    return !pr.errors.length && pr.ops.length === 1 && op?.k === "edit" && op.cmd ? op.cmd : null;
  } catch {
    return null;
  }
}
const isLast = (t: unknown) => typeof t === "string" && ["posledni", "last", "letzte", "$last"].includes(fold2(t));
/**
 * Řádky za prvkem, které míří na `poslední` prvek (nezávisle na jazyce rozhraní i na stejných názvech): přejmenování (název, který
 * při vzniku prvku nejde dát – stejný název už v dílu je), popis roviny skici, vazby parametrů na výrazy a potlačení.
 */
function emitAfter(p: PartCtx, f: Feature, o: { rename?: boolean; label?: string } = {}) {
  const c = p.c;
  const last = c.w("last");
  if (o.rename) {
    const q = scriptQuote(f.name, true);
    const l = `${c.w("rename")} ${last} ${c.w("renameTo")} ${q ?? ""}`;
    const cmd = q ? editCmd(l) : null;
    if (cmd?.kind === "rename" && isLast(cmd.target) && cmd.name === f.name) c.line(l);
    else c.note(tr("název prvku „{0}“ nejde zapsat na řádek skriptu – prvek dostane automatický název", f.name));
  }
  if (o.label !== undefined) c.line(`${c.w("edit")} ${last} plane.label=${scriptQuote(o.label, true)}`);
  // vazby parametrů prvku na výrazy: klíč==výraz; výraz s mezerami v uvozovkách (klíč="=b + 25")
  for (const [key, expr] of Object.entries(p.doc.bindings ?? {})) {
    const at = key.indexOf(":");
    if (key.slice(0, at) !== f.id) continue;
    const path = key.slice(at + 1);
    const plain = /^[^\s"„“]+$/.test(expr);
    // výraz bez proměnné aplikace jako vazbu nepřijme (číslo se zadává bez „=“)
    const val = !exprRefs(expr).length ? null : plain ? `=${expr}` : !expr.includes('"') ? `"=${expr}"` : !/[„“]/.test(expr) ? `„=${expr}“` : null;
    const l = val === null ? null : `${c.w("edit")} ${last} ${path}=${val}`;
    const cmd = l && lineSafe(l) ? editCmd(l) : null;
    const pairs = cmd?.kind === "edit" && isLast(cmd.target) ? (cmd.pairs as [string, string][]) : null;
    if (l && pairs?.length === 1 && pairs[0][0] === path && pairs[0][1].replace(/^=\s*/, "") === expr && pairs[0][1].startsWith("=")) c.line(l);
    else c.note(tr("vazbu parametru „{0}“ prvku „{1}“ na výraz „{2}“ nejde zapsat na řádek skriptu", path, f.name, expr));
  }
  if (f.suppressed) c.line(`${c.w("suppress")} ${last}`);
}

/** zapíše jeden prvek (ne skicu) nejlepším zápisem, který ověření projde */
function emitFeature(p: PartCtx, f: Feature) {
  const c = p.c;
  const drop = c.sigs === "drop";
  const keepSigs = !drop && hasSigs(f);
  const nameQ = scriptQuote(f.name, true);
  let rename = false;
  /**
   * zkusí řádek: bez názvu (automatický sedí), s názvem; `renaming` = bez názvu + přejmenování (název při vzniku dát nejde –
   * stejný název už v dílu je, nebo ho parser čte jako slovo volby)
   */
  const tryLine = (base: string | null, how: ScriptHow, nameKey: string, renaming: boolean): boolean => {
    if (base === null || !lineSafe(base)) return false;
    if (!renaming) {
      const auto = c.names === "auto" && !p.byName.has(f.id) && autoName(p, f) === f.name;
      if (auto && verify(p, f, base, false, drop)) {
        c.line(base);
        c.counts[f.type] = (c.counts[f.type] ?? 0) + 1;
        c.count(f.type, how);
        c.expect.push({ type: f.type, name: f.name });
        return true;
      }
      if (nameQ && verify(p, f, `${base} ${nameKey}${nameQ}`, true, drop)) {
        c.line(`${base} ${nameKey}${nameQ}`);
        c.count(f.type, how);
        c.expect.push({ type: f.type, name: f.name });
        return true;
      }
      return false;
    }
    if (!verify(p, f, base, false, drop)) return false;
    // název při vzniku nejde dát (stejný název už v dílu je, nebo ho nejde zapsat) → automatický název a přejmenování
    c.expect.push({ type: f.type, name: autoName(p, f) });
    c.line(base);
    c.counts[f.type] = (c.counts[f.type] ?? 0) + 1;
    c.count(f.type, how);
    rename = true;
    return true;
  };
  const done = ((): boolean => {
    // prvek, na který míří odkaz jen přes id, musí id zachovat → JSON; prvek s otisky výběru vlastní příkaz zapsat neumí
    if (p.keepId.has(f.id)) return false;
    // vlastní příkaz (i s přejmenováním na dalším řádku) má přednost před obecným `prvek`
    if (!keepSigs) for (const renaming of [false, true]) for (const base of dedicated(p, f)) if (tryLine(base, "dedicated", `${c.w("name")} `, renaming)) return true;
    const g = generic(p, f);
    return tryLine(g, "generic", "name=", false) || tryLine(g, "generic", "name=", true);
  })();
  let keptId = false;
  if (!done) {
    // poslední možnost: jednořádkový JSON (id se zachová, odkazy názvem)
    const j = withNameRefs(drop ? (stripSigs(f) as Feature) : f, p) as unknown as Rec;
    delete j.suppressed;
    const s = scriptJson(j);
    c.line(s);
    c.count(f.type, "json");
    keptId = !p.replay.some((x) => x.id === f.id);
    const created = freeName(p.replay, { ...f, id: "\u0001" } as Feature);
    c.expect.push({ type: f.type, name: created });
    rename = created !== f.name;
    if (!verify(p, f, s, false, drop)) c.note(tr("prvek „{0}“ ({1}) se ani jako JSON nepodařilo ověřit proti původnímu prvku – zkontrolujte ho po přečtení", f.name, f.type));
    if (p.keepId.has(f.id) && !keptId) c.note(tr("prvek „{0}“ má stejné id jako dřívější prvek – odkazy na něj se po přečtení skriptu nenajdou", f.name));
  }
  if (keepSigs) c.sum("sigsKept");
  else if (drop && hasSigs(f)) c.sum("sigsDropped");
  pushFeature(p, f, keptId);
  emitAfter(p, f, { rename });
}

/* ───────────────────────── skica ───────────────────────── */
function entityLine(c: Ctx, e: SketchEntity): string | null {
  const pre = e.construction ? `${c.w("construction")} ` : "";
  const at = (x: number, y: number) => (x !== 0 || y !== 0 ? ` ${c.w("at")} ${n(x)} ${n(y)}` : "");
  const ang = (a: number | undefined) => (a ? ` ${c.w("angle")} ${n(a)}` : "");
  switch (e.type) {
    case "rect":
      return `${pre}${c.w("rect")} ${n(e.w)} ${n(e.h)}${at(e.cx, e.cy)}${e.r ? ` ${c.w("rectR")} ${n(e.r)}` : ""}${ang(e.angle)}`;
    case "circle":
      return `${pre}${c.w("circle")} ${n(2 * e.r)}${at(e.cx, e.cy)}`;
    case "polygon":
      return `${pre}${c.w("polygon")} ${n(e.sides)} ${n(2 * e.r)}${at(e.cx, e.cy)}${ang(e.angle)}`;
    case "slot":
      return `${pre}${c.w("slot")} ${n(e.length)} ${n(e.width)}${at(e.cx, e.cy)}${ang(e.angle)}`;
    case "line":
      return e.autoClose ? null : `${pre}${c.w("line")} ${vec(e.a)} ${vec(e.b)}`;
    case "polyline":
      return `${pre}${c.w("polyline")} ${e.points.map((q) => vec(q)).join(" ")}${e.autoClose ? "" : ` ${c.w(e.closed ? "close" : "open")}`}`;
    case "arc":
      return `${pre}${c.w("arc")} ${vec(e.a)} ${vec(e.b)} ${vec(e.c)}`;
    case "point":
      return `${pre}${c.w("point")} ${vec(e.p)}`;
    case "ellipse":
      return `${pre}${c.w("ellipse")} ${n(e.rx)} ${n(e.ry)}${at(e.cx, e.cy)}${ang(e.angle)}`;
    case "spline":
      return e.tangents || e.weights ? null : `${pre}${c.w("spline")} ${e.points.map((q) => vec(q)).join(" ")}${e.closed ? ` ${c.w("close")}` : ""}`;
  }
}
const refTok = (r: SketchRef, ids: Map<string, string>, ents: Map<string, SketchEntity>): string | null => {
  const id = ids.get(r.e);
  const e = ents.get(r.e);
  if (!id || !e) return null;
  if (r.k === "self" || (e.type === "point" && r.k === "p")) return id;
  return `${id}.${r.k}`;
};
/** řádky bloku skici (hlavička, entity, vazby, kóty) vlastními příkazy; null = skicu takto zapsat nejde */
function sketchLines(p: PartCtx, f: SketchF, name: string): string[] | null {
  const c = p.c;
  let head: string;
  const d = f.planeDef;
  if (d) {
    if (d.kind === "face" && d.ref.kind === "face") head = `${c.w("sketch")} ${c.w("face")} F${d.ref.index + 1}${d.offset ? ` ${c.w("offset")} ${n(d.offset)}` : ""}${d.flip ? ` ${c.w("reverse")}` : ""}`;
    else if (d.kind === "datum") {
      const q = datumName(p, d.featureId);
      if (!q) return null;
      head = `${c.w("sketch")} ${c.w("plane")} ${q}${d.offset ? ` ${c.w("offset")} ${n(d.offset)}` : ""}`;
    } else return null;
  } else if (f.plane.kind === "base") head = `${c.w("sketch")} ${f.plane.name}${f.plane.offset ? ` ${c.w("offset")} ${n(f.plane.offset)}` : ""}`;
  else head = `${c.w("sketch")} ${c.w("origin")} ${vec(f.plane.origin)} ${c.w("normal")} ${vec(f.plane.normal)} ${c.w("xdir")} ${vec(f.plane.xDir)}`;
  const lines = [head + name];
  const ids = new Map<string, string>();
  const ents = new Map<string, SketchEntity>();
  f.entities.forEach((e, i) => {
    ids.set(e.id, `e${i + 1}`);
    ents.set(e.id, e);
  });
  for (const e of f.entities) {
    const l = entityLine(c, e);
    if (l === null) return null;
    lines.push(`  ${l}`);
  }
  for (const k of f.constraints ?? []) {
    const refs = k.refs.map((r) => refTok(r, ids, ents));
    if (refs.some((r) => r === null)) return null;
    lines.push(`  ${c.w("constraint")} ${CON_WORDS[k.type][c.li]} ${refs.join(" ")}${k.type === "fixed" && k.value?.length === 2 ? ` ${vec(k.value)}` : ""}`);
  }
  for (const k of f.dims ?? []) {
    const refs = k.refs.map((r) => refTok(r, ids, ents));
    if (refs.some((r) => r === null)) return null;
    lines.push(`  ${c.w("dim")} ${DIM_WORDS[k.type][c.li]} ${refs.join(" ")} ${n(k.value)}${k.driving ? "" : ` ${c.w("reference")}`}`);
  }
  return lines.every(lineSafe) ? lines : null;
}
/** popis obecné roviny skici („Plocha 6“ – skica založená klikem na plochu): zapisuje ho zvláštní řádek `upravit poslední plane.label=…` */
const planeLabel = (f: SketchF): string | undefined => (f.plane.kind === "custom" && !f.planeDef && typeof f.plane.label === "string" && f.plane.label ? f.plane.label : undefined);
/** blok skici přečte a provede stejným kódem jako konzole a porovná výsledek s původní skicou; `explicitName` = hlavička nese název */
function verifySketch(p: PartCtx, f: SketchF, lines: string[], explicitName: boolean): boolean {
  let prog;
  try {
    prog = parseAgentText(lines.join("\n"));
  } catch {
    return false;
  }
  if (prog.errors.length || !prog.ops.length) return false;
  const first = prog.ops[0] as AgentOp;
  let sk: SketchF;
  if (first.k === "feature" && first.feature.type === "sketch") {
    sk = first.feature;
    const plane = f.plane.kind === "custom" ? { ...f.plane, label: undefined } : f.plane;
    if (stable(sk.plane) !== stable(plane) || f.planeDef) return false;
  } else if (first.k === "sketchOn" && first.feature.type === "sketch" && f.planeDef) {
    // rovinu z plochy / pomocné roviny dopočítá jádro – ověří se jen zadání
    const d = f.planeDef;
    const on = first.on as { face?: number; datum?: string };
    if (d.kind === "face") {
      if (d.ref.kind !== "face" || on.face !== d.ref.index + 1 || first.offset !== (d.offset ?? 0) || first.flip !== !!d.flip) return false;
    } else if (d.kind === "datum") {
      // název musí v dokumentu po přečtení najít právě tuto pomocnou rovinu
      const dn = p.feats.find((x) => x.id === d.featureId);
      if (!dn || on.datum !== dn.name || first.offset !== (d.offset ?? 0) || !datumNameOk(dn, "datum", p.feats)) return false;
    } else return false;
    sk = { ...first.feature, plane: f.plane, planeDef: f.planeDef };
  } else return false;
  if (explicitName && freeName(p.replay, { ...sk, id: "\u0001" } as Feature) !== f.name) return false;
  const scratch: Feature[] = [sk];
  for (const op of prog.ops.slice(1)) {
    if (op.k !== "entities" && op.k !== "constraints" && op.k !== "dims") return false;
    let log: string[];
    try {
      log = applySketchOp(scratch, op as SketchOp, null);
    } catch {
      return false;
    }
    if (log.some((l) => l.startsWith("✗"))) return false;
  }
  const r = scratch[0] as SketchF;
  if (r.entities.length !== f.entities.length) return false;
  const map = new Map(f.entities.map((e, i) => [e.id, r.entities[i].id]));
  const noId = (e: SketchEntity) => ({ ...e, id: "" });
  for (let i = 0; i < f.entities.length; i++) if (!loose(noId(f.entities[i]), noId(r.entities[i]))) return false;
  const mapRefs = (refs: SketchRef[]) => refs.map((x) => ({ e: map.get(x.e) ?? x.e, k: x.k }));
  const ca = f.constraints ?? [];
  const cb = r.constraints ?? [];
  if (ca.length !== cb.length) return false;
  for (let i = 0; i < ca.length; i++) if (ca[i].type !== cb[i].type || !loose(mapRefs(ca[i].refs), cb[i].refs) || !loose(ca[i].value ?? [], cb[i].value ?? [])) return false;
  const da = f.dims ?? [];
  const db = r.dims ?? [];
  if (da.length !== db.length) return false;
  for (let i = 0; i < da.length; i++) if (da[i].type !== db[i].type || da[i].driving !== db[i].driving || !loose(da[i].value, db[i].value) || !loose(mapRefs(da[i].refs), db[i].refs)) return false;
  return true;
}
function emitSketch(p: PartCtx, f: SketchF, laterText: string) {
  const c = p.c;
  const drop = c.sigs === "drop";
  // id entit se textem přečíslují na e1, e2…; odkazuje-li na ně pozdější prvek původním id, musí skica zůstat v JSON
  const idsKept = f.entities.every((e, i) => e.id === `e${i + 1}`);
  const referenced = !idsKept && f.entities.some((e) => laterText.includes(`"entityId":${JSON.stringify(e.id)}`));
  // otisk plochy skici (planeDef.ref.sig) vlastní příkaz `skica plocha F6` nenese → se zachováním otisků jen JSON
  const keepSigs = !drop && hasSigs(f);
  const nameQ = scriptQuote(f.name, true);
  const label = planeLabel(f);
  const labelOk = label === undefined || (!!scriptQuote(label, true) && parseValue(label) === label && editCmd(`${c.w("edit")} ${c.w("last")} plane.label=${scriptQuote(label, true)}`)?.kind === "edit");
  let rename = false;
  const tryBlock = (named: boolean): boolean => {
    const lines = sketchLines(p, f, named ? ` ${c.w("name")} ${nameQ}` : "");
    if (!lines || !verifySketch(p, f, lines, named)) return false;
    for (const l of lines) c.line(l);
    return true;
  };
  let ok = false;
  if (!referenced && !keepSigs && labelOk && !p.keepId.has(f.id)) {
    const auto = autoName(p, f);
    if (c.names === "auto" && !p.byName.has(f.id) && auto === f.name && tryBlock(false)) {
      c.counts.sketch = (c.counts.sketch ?? 0) + 1;
      c.expect.push({ type: "sketch", name: f.name });
      ok = true;
    } else if (nameQ && tryBlock(true)) {
      c.expect.push({ type: "sketch", name: f.name });
      ok = true;
    } else if (tryBlock(false)) {
      // název při vzniku nejde dát (stejný název už v dílu je) → automatický název a přejmenování
      c.counts.sketch = (c.counts.sketch ?? 0) + 1;
      c.expect.push({ type: "sketch", name: auto });
      rename = true;
      ok = true;
    }
  }
  let keptId = false;
  if (ok) {
    c.count("sketch", "dedicated");
    if (f.planeDef) c.note(tr("skica na ploše / pomocné rovině: rovinu při přečtení znovu spočítá jádro z plochy F (číslo plochy tělesa před skicou)"));
    if ((f.dims ?? []).some((d) => d.offset)) c.note(tr("poloha popisků kót ve skice se nepřenáší (jen hodnoty a odkazy)"));
  } else {
    const j = withNameRefs(drop ? (stripSigs(f) as Feature) : f, p) as unknown as Rec;
    delete j.suppressed;
    c.line(scriptJson(j));
    c.count("sketch", "json");
    keptId = !p.replay.some((x) => x.id === f.id);
    const created = freeName(p.replay, { ...f, id: "\u0001" } as Feature);
    c.expect.push({ type: "sketch", name: created });
    rename = created !== f.name;
    if (p.keepId.has(f.id) && !keptId) c.note(tr("prvek „{0}“ má stejné id jako dřívější prvek – odkazy na něj se po přečtení skriptu nenajdou", f.name));
  }
  if (keepSigs) c.sum("sigsKept");
  else if (drop && hasSigs(f)) c.sum("sigsDropped");
  pushFeature(p, f, keptId);
  emitAfter(p, f, { rename, ...(ok && label !== undefined ? { label } : {}) });
}

/* ───────────────────────── výkresy ───────────────────────── */
/** volby nového listu (drawing-agent.ts NEW_DRAWING_OPTIONS) – co se od nich neliší, se nepíše; hlídá test */
export const SCRIPT_SHEET_DEFAULTS = {
  sheet: "auto",
  orientation: "landscape",
  scale: "auto",
  projection: "E",
  views: { front: true, top: true, left: true, right: false, back: false, bottom: false, iso: true },
  hidden: false,
  section: null,
  centerLines: true,
  dimensions: "smart",
  balloons: true,
  holeTable: false,
  details: [],
  rotation: 0,
  models: [],
} as const;
const VIEW_ORDER = ["front", "top", "left", "right", "back", "bottom", "iso"];
function scaleText(s: number): string {
  if (Number.isInteger(s)) return `${s}:1`;
  const inv = 1 / s;
  if (Number.isInteger(inv) && 1 / inv === s) return `1:${inv}`;
  return n(s);
}
/** `výkres …` s volbami listu, které se liší od výchozích; `keys` = které volby řádek nastavuje (kontrola rozborem) */
function sheetLine(c: Ctx, o: Rec): { line: string; keys: string[] } {
  const D = SCRIPT_SHEET_DEFAULTS as unknown as Rec;
  const parts: string[] = [];
  const keys: string[] = [];
  const diff = (k: string) => o[k] !== undefined && stable(o[k]) !== stable(D[k]);
  const sheet = typeof o.sheet === "string" ? o.sheet : "auto";
  parts.push(sheet === "auto" ? `${c.w("format")} auto` : sheet);
  keys.push("sheet");
  if (diff("orientation")) {
    parts.push(c.w("portrait"));
    keys.push("orientation");
  }
  if (diff("scale") && typeof o.scale === "number") {
    parts.push(`${c.w("scale")} ${scaleText(o.scale)}`);
    keys.push("scale");
  }
  if (diff("views") && o.views && typeof o.views === "object") {
    const on = VIEW_ORDER.filter((k) => (o.views as Rec)[k]);
    if (on.length) {
      parts.push(`${c.w("views")} ${on.map((k) => VIEW_WORDS[k][c.li]).join(",")}`);
      keys.push("views");
    }
  }
  if (diff("section") && o.section && typeof o.section === "object") {
    // text píše odsazení jako u skici (podél normály roviny, vlna 15); starší uložený řez má v `offset` souřadnici na ose
    const s = sectionToSketchConvention(o.section as SectionOpt) as { plane: string; offset: number; kind?: string };
    parts.push(`${c.w("section")} ${s.plane} ${c.w("offset")} ${n(s.offset ?? 0)}${s.kind === "half" ? ` ${c.w("half")}` : s.kind === "full" ? ` ${c.w("full")}` : ""}`);
    keys.push("section");
  }
  const flag = (k: string, word: WordKey) => {
    if (!diff(k) || typeof o[k] !== "boolean") return;
    parts.push(`${c.w(word)} ${c.yn(o[k] as boolean)}`);
    keys.push(k);
  };
  flag("hidden", "hidden");
  flag("centerLines", "axes");
  flag("holeTable", "holeTable");
  if (o.springTable === true) {
    parts.push(`${c.w("springTable")} ${c.yn(true)}`);
    keys.push("springTable");
  }
  if (diff("rotation") && typeof o.rotation === "number") {
    parts.push(`${c.w("rotation")} ${n(o.rotation)}`);
    keys.push("rotation");
  }
  if (typeof o.bomTable === "boolean") {
    parts.push(`${c.w("bom")} ${c.yn(o.bomTable)}`);
    keys.push("bomTable");
  }
  flag("balloons", "balloons");
  if (diff("projection") && (o.projection === "A" || o.projection === "E")) {
    parts.push(`${c.w("projection")} ${o.projection}`);
    keys.push("projection");
  }
  // pružiny plně / zjednodušeně (doc-script-sheet.ts)
  const extra = sheetLineExtra(c.sheetOut, o);
  parts.push(...extra.parts);
  keys.push(...extra.keys);
  return { line: `${c.w("drawing")} ${parts.join(" ")}`, keys };
}
/** řez v konvenci skici (starší uložený řez má v `offset` souřadnici na ose) – k porovnání uloženého řezu s přečteným řádkem */
const secNorm = (v: unknown): unknown => (v && typeof v === "object" ? sectionToSketchConvention(v as SectionOpt) : v);
/** volby listu bez textového příkazu (jen JSON dokumentu) – ostatní zapisuje doc-script-sheet.ts */
export const SHEET_UNSUPPORTED = SHEET_JSON_ONLY;
/** nastavené volby listu, které skript nepřenese (jen JSON, neznámé) – list pak po přečtení vypadá jinak */
export const sheetUnsupported = (o: Record<string, unknown>): string[] => sheetUnwritable(o);
/** `name` = název dokumentu ve skriptu (záložka – díl sestavy se může jmenovat jinak než v dokumentu) */
function emitDrawings(c: Ctx, doc: CadDoc, name = doc.name) {
  const list = doc.drawings ?? [];
  if (!list.length) {
    const pr = doc.props;
    if (pr && (pr.number || pr.author || pr.revision || pr.note)) c.sum("propsLost");
    return;
  }
  let setName: string | undefined;
  // stav razítek při čtení skriptu (nový list převezme údaje aktivního, popisové údaje dokumentu) – doc-script-sheet.ts
  const title = titleState(name);
  list.forEach((s: DrawingDoc, i: number) => {
    const o = (s.options ?? {}) as Rec;
    c.stats.sheets++;
    c.comment(`${c.w("cDrawing")}: ${s.name}`);
    const check = (line: string, ok: (cmd: Rec) => boolean): boolean => {
      try {
        const pr = parseAgentText(line);
        const op = pr.ops[0] as { k: string; cmd?: Rec } | undefined;
        return !pr.errors.length && pr.ops.length === 1 && op?.k === "drawingCmd" && !!op.cmd && ok(op.cmd);
      } catch {
        return false;
      }
    };
    // jak list při čtení vznikne: první list výkresu (údaje razítka z dokumentu), další list (převezme údaje aktivního listu)
    let how: "new" | "sheet" | "same" = "new";
    if (i > 0) {
      const q = scriptQuote(s.name, true);
      if (s.drawing && s.drawing !== setName) {
        const dq = scriptQuote(s.drawing, true);
        const l = `${c.w("drawing")} ${c.w("drawingNew")} ${dq ?? ""}`.trim();
        if (dq && check(l, (cmd) => cmd.k === "drawings" && cmd.op === "new")) c.line(l);
        else {
          how = "same";
          c.note(tr("další výkres „{0}“ se nepodařilo zapsat – list přibude k prvnímu výkresu", String(s.drawing)));
        }
      } else {
        how = "sheet";
        const l = `${c.w("drawing")} ${c.w("sheetNew")} ${q ?? ""}`.trim();
        if (check(l, (cmd) => cmd.k === "sheet" && cmd.op === "new")) c.line(l);
        else {
          how = "same";
          c.note(tr("list „{0}“ se nepodařilo zapsat jako nový list", s.name));
        }
      }
    }
    setName = s.drawing;
    const { line, keys } = sheetLine(c, o);
    if (check(line, (cmd) => cmd.k === "set" && keys.every((k) => (k === "section" ? stable(secNorm((cmd.opts as Rec)[k])) === stable(secNorm(o[k])) : stable((cmd.opts as Rec)[k]) === stable(k === "sheet" ? (o.sheet ?? "auto") : o[k]))))) c.line(line);
    else {
      c.line(`${c.w("drawing")} ${c.w("format")} auto`);
      c.note(tr("volby listu „{0}“ se nepodařilo zapsat příkazem výkres – list vznikne s výchozími volbami", s.name));
    }
    // první list výkresu se jmenuje „List 1“; jiný název = přejmenovat (další listy dostanou název rovnou)
    const firstOfSet = i === 0 || (!!s.drawing && s.drawing !== list[i - 1]?.drawing);
    if (firstOfSet && s.name !== trIn(c.lang, "List {0}").replace("{0}", "1")) {
      const q = scriptQuote(s.name, true);
      const l = `${c.w("drawing")} ${c.w("sheetRename")} ${q ?? ""}`;
      if (q && check(l, (cmd) => cmd.k === "sheet" && cmd.op === "rename" && cmd.name === s.name)) c.line(l);
      else c.note(tr("název listu „{0}“ se nepodařilo zapsat", s.name));
    }
    // tabulka revizí a razítko se všemi poli, šablonou a logem – rozdíl proti stavu listu při čtení (doc-script-sheet.ts)
    emitTitle(c.sheetOut, doc, s, title, how);
    if (typeof o.zones === "boolean") c.line(`${c.w("drawing")} ${c.w("zones")} ${c.yn(o.zones)}`);
    // pohledy navíc (modely, pomocné pohledy, řezy, detaily, částečné řezy, přerušení, uložení) – před kótami, aby je
    // Chytré kóty při přečtení vygenerovaly nad stejným listem jako jádro při exportu (id smazaných kót)
    emitSheetViews(c.sheetOut, doc, s);
    // kóty (funkční rozměry a polohy děr Chytrých kót – doc-script-sheet.ts)
    const ann = Array.isArray(s.annotations) ? s.annotations : [];
    const auto = ann.filter((a) => a.auto).length;
    const mode = o.dimensions;
    const style = o.dimStyle === "baseline" ? ` ${c.w("baseline")}` : "";
    const tail = dimTail(c.sheetOut, o);
    const dimLine = (l: string) => {
      if (!tail || dimTailOk(l, o)) c.line(l);
      else c.note(tr("funkční rozměry / polohy děr Chytrých kót listu „{0}“ nejde zapsat příkazem kótovat", s.name));
    };
    if (mode === "smart") {
      if ((auto || tail) && doc.kind !== "assembly") dimLine(`${c.w("dimension")} ${c.w("smart")}${style}${tail}`);
    } else if (mode === "overall") dimLine(`${c.w("dimension")} ${c.w("overall")}${tail}`);
    else if (mode === "none") dimLine(`${c.w("dimension")} ${c.w("none")}${tail}`);
    else if (mode === "auto") dimLine(`${c.w("dimension")} ${c.w("basic")}${tail}`);
    if (auto) c.sum("autoDims", auto);
    // vygenerované kóty, které uživatel smazal (smartOff): po „kótovat chytře“ by se vrátily → smazat je znovu podle id (spočítá jádro)
    const off = Array.isArray(o.smartOff) ? (o.smartOff as unknown[]).length : 0;
    if (off && mode === "smart" && doc.kind !== "assembly") {
      const ids = c.deletedDims[s.id];
      const l = ids?.length ? `${c.w("drawing")} ${c.w("del")} ${ids.join(" ")}` : "";
      if (l && check(l, (cmd) => cmd.k === "del" && stable(cmd.targets) === stable(ids))) c.line(l);
      else {
        c.sum("smartOff", off);
        c.sum("smartOffSheets");
      }
    }
    // skryté / posunuté vygenerované kóty celkových rozměrů a pozice (na listu jsou až po kótách) – jen ty, které na listu jsou
    emitGenEdit(c.sheetOut, doc, s, c.genKeys[s.id]);
    const edited = ann.filter((a) => a.auto && ((a.type === "dim" && (a.text !== undefined || /[±+\-]\d|[A-Za-z]\d/.test(a.suffix ?? ""))) || (a.type === "callout" && a.tol) || a.rev || a.tolShow)).length;
    if (edited) {
      c.sum("editedDims", edited);
      c.sum("editedSheets");
    }
    if (ann.length - auto) {
      c.sum("manualAnn", ann.length - auto);
      c.sum("manualSheets");
    }
    const extra = sheetUnwritable(o);
    if (extra.length) c.note(tr("volby listu bez textového příkazu ({0}) – nastavují se jen v JSON dokumentu, skript je nepřenese – list „{1}“ dokumentu „{2}“", extra.join(", "), s.name, doc.name));
  });
  // popisové údaje dokumentu (číslo, kreslil, revize), které řádky razítek nenastavily stejně jako v dokumentu
  emitDocProps(c.sheetOut, doc, title);
}

/* ───────────────────────── díl ───────────────────────── */
function emitDocMeta(c: Ctx, doc: CadDoc) {
  if (doc.material && doc.material !== "ocel") c.line(`${c.w("material")} ${doc.material}`);
  if (doc.materialName?.trim()) {
    const l = `${c.w("material")} ${doc.materialName.trim()}`;
    let ok = false;
    try {
      const pr = parseAgentText(l);
      const op = pr.ops[0] as { k: string; patch?: Rec } | undefined;
      ok = !pr.errors.length && op?.k === "meta" && op.patch?.materialName === doc.materialName.trim();
    } catch {
      ok = false;
    }
    if (ok) c.line(l);
    else c.note(tr("označení materiálu „{0}“ nejde zapsat příkazem materiál (čte se jako třída materiálu)", doc.materialName));
  }
  if (doc.color && /^#[0-9a-f]{6}$/i.test(doc.color)) c.line(`${c.w("color")} ${doc.color}`);
}
/**
 * Proměnné dílu v uloženém pořadí. Proměnná, jejíž výraz odkazuje na proměnnou definovanou až za ní, dostane nejdřív svou
 * hodnotu číslem (aby pořadí zůstalo) a výraz až poté, co existují všechny – jinak by řádek skončil „Neznámá proměnná“.
 */
function emitVariables(c: Ctx, doc: CadDoc) {
  const vars = doc.variables ?? [];
  if (!vars.length) return;
  const { values, errors } = resolveVariables(vars, {});
  const names = new Set(vars.map((v) => v.name));
  const defined = new Set<string>();
  const later: string[] = [];
  const full = (v: (typeof vars)[number]): string | null => {
    const base = `${c.w("variable")} ${v.name} = ${v.expr}`;
    const ok = (l: string) => {
      const cmd = lineSafe(l) ? editCmd(l) : null;
      return cmd?.kind === "var" && cmd.name === v.name && cmd.expr === v.expr.trim() && (cmd.note ?? "") === (v.note ?? "");
    };
    if (!v.note) return ok(base) ? base : null;
    for (const q of [`"${v.note}"`, `„${v.note}“`]) if (ok(`${base} ${c.w("note")} ${q}`)) return `${base} ${c.w("note")} ${q}`;
    // výraz jde zapsat, poznámka ne (konec řádku nebo oba druhy uvozovek v poznámce)
    const cmd = lineSafe(base) ? editCmd(base) : null;
    if (cmd?.kind !== "var" || cmd.name !== v.name || cmd.expr !== v.expr.trim()) return null;
    c.note(tr("poznámku proměnné „{0}“ nejde zapsat na řádek skriptu", v.name));
    return base;
  };
  for (const v of vars) {
    const l = errors[v.name] || !VAR_NAME.test(v.name) ? null : full(v);
    if (l === null) {
      c.note(tr("proměnnou „{0}“ = {1} nejde zapsat ({2}) – ve skriptu chybí i vazby, které ji používají", v.name, v.expr, errors[v.name] ?? tr("výraz nejde zapsat na řádek")));
      continue;
    }
    const forward = exprRefs(v.expr).some((r) => names.has(r) && !defined.has(r));
    if (forward) {
      c.line(`${c.w("variable")} ${v.name} = ${n(values[v.name])}`);
      later.push(l);
    } else c.line(l);
    defined.add(v.name);
  }
  for (const l of later) c.line(l);
}
/** Blok dílu: `nový díl …`, materiál, proměnné, prvky, vazby parametrů, konfigurace, výkresy. `name` = název záložky ve skriptu. */
function emitPart(c: Ctx, doc: CadDoc, name: string) {
  const q = scriptQuote(name, true);
  if (!q) {
    c.note(tr("název dokumentu „{0}“ nejde zapsat na řádek skriptu – dokument je zapsán jako JSON", name));
    c.line(scriptJson({ ...doc, name }));
    return;
  }
  c.line(`${c.w("newPart")} ${q}`);
  // výchozí název („Nový díl“) aplikace čísluje jako dokument bez názvu → název ještě jednou výslovně
  if (isDefaultDocName(name, "Nový díl")) c.line(`${c.w("docName")} ${q}`);
  emitDocMeta(c, doc);
  emitVariables(c, doc);
  const p: PartCtx = { c, feats: [], replay: [], ids: new Map(), doc, ...planRefs(doc) };
  const texts = doc.features.map((f) => JSON.stringify(f));
  doc.features.forEach((f, i) => {
    if (f.type === "sketch") emitSketch(p, f, texts.slice(i + 1).join("\n"));
    else emitFeature(p, f);
  });
  for (const cf of doc.configs ?? []) {
    const cq = scriptQuote(cf.name, true);
    // potlačené prvky: název, kterým je aplikace najde (je ve skriptu výslovně), jinak pořadí v historii @N
    const sup = cf.suppressed
      .map((id) => doc.features.findIndex((x) => x.id === id))
      .filter((i) => i >= 0)
      .map((i) => (p.byName.has(doc.features[i].id) && editNameOk(doc.features[i], doc.features) ? (scriptQuote(doc.features[i].name, true) ?? `@${i + 1}`) : `@${i + 1}`));
    const l = `${c.w("config")} ${cq ?? ""}${Object.entries(cf.values).map(([k, v]) => ` ${k}=${n(v)}`).join("")}${sup.length ? ` ${c.w("suppress")} ${sup.join(";")}` : ""}`;
    const cmd = cq && lineSafe(l) ? editCmd(l) : null;
    if (cmd?.kind === "config" && cmd.name === cf.name && (cmd.values as unknown[]).length === Object.keys(cf.values).length && ((cmd.suppress as unknown[] | undefined)?.length ?? 0) === sup.length) c.line(l);
    else c.note(tr("konfiguraci „{0}“ nejde zapsat na řádek skriptu", cf.name));
  }
  if (doc.activeConfig) {
    const cf = doc.configs?.find((x) => x.id === doc.activeConfig);
    const cq = cf ? scriptQuote(cf.name, true) : null;
    if (cq) c.line(`${c.w("config")} ${c.w("active")} ${cq}`);
  }
  if (doc.bodies?.some((b) => b.color || b.hidden)) c.note(tr("barvy a skrytí těles dílu „{0}“ se do skriptu nepřenášejí", doc.name));
  if (doc.faceColors && Object.keys(doc.faceColors).length) c.note(tr("barvy ploch dílu „{0}“ se do skriptu nepřenášejí", doc.name));
  if (doc.underlays && Object.keys(doc.underlays).length) c.note(tr("podklady skic (obrázky / PDF) dílu „{0}“ se do skriptu nepřenášejí", doc.name));
  emitDrawings(c, doc, name);
}

/* ───────────────────────── sestava ───────────────────────── */
const partKey = (d: CadDoc) => stable({ ...d, kind: "part" });
/** co má rozbor řádku vazby vrátit (druh, komponenty #k, plochy, hodnoty) – porovnává se s `sestava vazba …` přečteným konzolí */
type MateExpect = { kind: string; a: string; b?: string; faces: Record<string, MateRef | undefined>; c?: string; value?: number; min?: number; max?: number; flip: boolean; center: boolean; name?: string };
function mateLine(c: Ctx, m: Mate, idx: Map<string, number>): { line: string; expect: MateExpect } | null {
  const comp = (r: MateRef | undefined): string | null => {
    if (!r || r.leaf) return null;
    const k = idx.get(r.compId);
    return k === undefined ? null : `#${k}`;
  };
  const face = (r: MateRef) => (r.face < 0 ? (r.radius ? ` Ø${n(2 * r.radius)}` : "") : ` ${r.ent === "edge" ? "E" : r.ent === "vertex" ? "V" : "F"}${r.face + 1}`);
  const head = `${c.w("asm")} ${c.w("mate")}`;
  const a = comp(m.a);
  const nameQ = m.name ? scriptQuote(m.name, true) : "";
  if (!a || nameQ === null) return null;
  const tail = nameQ ? ` ${c.w("name")} ${nameQ}` : "";
  const word = (k: string) => MATE_WORDS[k][c.li];
  // „vystředit“ = Kontakt se ztotožněním středů: parser ho čte jako druh center s příznakem center
  const centered = m.type === "mate" && !!m.center;
  const ex: MateExpect = { kind: centered ? "center" : m.type, a, faces: {}, flip: !!m.flip, center: centered, ...(m.name ? { name: m.name } : {}) };
  if (m.type === "fixed") return m.c || m.d ? null : { line: `${head} ${word("fixed")} ${a}`, expect: { ...ex, flip: false, name: undefined } };
  const b = comp(m.b);
  if (!b) return null;
  ex.b = b;
  // další odkazy vazby (mate-spec.ts): Šířka / Závěs – druhá plocha A (c) a druhá plocha B (d), Drážka – druhý konec B (c),
  // Symetricky – rovina souměrnosti libovolné komponenty (c)
  const spec = m.type in KIN_SPEC ? KIN_SPEC[m.type as keyof typeof KIN_SPEC].slots : [];
  let a2 = "";
  let b2 = "";
  let about = "";
  for (const key of ["c", "d"] as const) {
    const r = m[key];
    if (!r) continue;
    const slot = spec.find((x) => x.key === key);
    if (!slot || r.leaf || r.face < 0) return null;
    if (slot.side === "any") {
      const k = comp(r);
      if (!k) return null;
      about = ` ${c.w("about")} ${k}${face(r)}`;
      ex.c = k;
      ex.faces.c = r;
    } else if (slot.side === "self") {
      if (r.compId !== m.a.compId || m.a.face < 0) return null;
      a2 = face(r);
      ex.faces.a2 = r;
    } else {
      if (r.compId !== m.b.compId || m.b.face < 0) return null;
      b2 = face(r);
      ex.faces.b2 = r;
    }
  }
  const ab = `${a}${face(m.a)}${a2} ${b}${face(m.b)}${b2}${about}`;
  ex.faces.a = m.a;
  ex.faces.b = m.b;
  const flip = m.flip ? ` ${c.w("flip")}` : "";
  const out = (line: string, more: Partial<MateExpect> = {}) => ({ line, expect: { ...ex, ...more } });
  if (a2 || b2 || about) {
    // jen vazby, které další odkazy mají (parseKinMate); hodnota Drážky = poloha
    if (m.type !== "symmetric" && m.type !== "width" && m.type !== "slot" && m.type !== "hinge") return null;
    return out(`${head} ${word(m.type)} ${ab}${m.value !== undefined ? ` ${c.w("value")} ${n(m.value)}` : ""}${m.min !== undefined ? ` min ${n(m.min)}` : ""}${m.max !== undefined ? ` max ${n(m.max)}` : ""}${flip}${tail}`, { value: m.value, min: m.min, max: m.max });
  }
  switch (m.type) {
    case "mate":
      return out(`${head} ${word(m.center ? "center" : "mate")} ${ab}${flip}${tail}`);
    case "flush":
    case "concentric":
    case "parallel":
      return m.center ? null : out(`${head} ${word(m.type)} ${ab}${flip}${tail}`);
    case "distance":
    case "angle":
      // orientaci (obráceně) určí aplikace měřením při vložení vazby – komponenty už stojí ve splněné poloze
      return out(`${head} ${word(m.type)} ${ab} ${c.w("value")} ${n(m.value ?? 0)}${tail}`, { value: m.value ?? 0, flip: false });
    case "lock":
      return out(`${head} ${word("lock")} ${a} ${b}${tail}`, { faces: {}, flip: false });
    case "limitDistance":
    case "limitAngle":
      return out(`${head} ${word(m.type)} ${ab}${m.min !== undefined ? ` min ${n(m.min)}` : ""}${m.max !== undefined ? ` max ${n(m.max)}` : ""}${flip}${tail}`, { min: m.min, max: m.max });
    case "gear":
    case "rack":
    case "screw":
    case "slot":
      return out(`${head} ${word(m.type)} ${ab}${m.value !== undefined ? ` ${c.w("value")} ${n(m.value)}` : ""}${flip}${tail}`, { value: m.value });
    case "perpendicular":
    case "tangent":
    case "coincident":
    case "path":
    case "cam":
    case "universal":
    case "symmetric":
    case "width":
    case "hinge":
      return out(`${head} ${word(m.type)} ${ab}${flip}${tail}`);
    default:
      return null;
  }
}
/** řádek vazby přečtený konzolí dává právě tuto vazbu (druh, komponenty, čísla ploch, hodnoty, název) */
function mateLineOk(line: string, ex: MateExpect): boolean {
  let cmd: Rec | undefined;
  try {
    const pr = parseAgentText(line);
    const op = pr.ops[0] as { k: string; cmd?: Rec } | undefined;
    if (pr.errors.length || pr.ops.length !== 1 || op?.k !== "asm" || op.cmd?.k !== "mate") return false;
    cmd = op.cmd;
  } catch {
    return false;
  }
  const same = (spec: unknown, r: MateRef | undefined): boolean => {
    const s = spec as { index?: number; ent?: string; diameter?: number; rule?: string[]; leaf?: string } | undefined;
    if (!r || (r.face < 0 && !r.radius)) return s === undefined;
    if (!s || s.leaf || s.rule?.length) return false;
    if (r.face < 0) return s.index === undefined && (r.radius ? Math.abs((s.diameter ?? NaN) - 2 * r.radius) < 1e-9 : s.diameter === undefined);
    return s.index === r.face && (s.ent ?? "") === (r.ent ?? "") && s.diameter === undefined;
  };
  const num = (x: unknown, y: number | undefined) => (y === undefined ? x === undefined : typeof x === "number" && Math.abs(x - y) <= 1e-12 * Math.max(1, Math.abs(y)));
  return (
    cmd.kind === ex.kind &&
    cmd.a === ex.a &&
    (cmd.b ?? undefined) === ex.b &&
    (cmd.c ?? undefined) === ex.c &&
    same(cmd.faceA, ex.faces.a) &&
    same(cmd.faceB, ex.faces.b) &&
    same(cmd.faceA2, ex.faces.a2) &&
    same(cmd.faceB2, ex.faces.b2) &&
    same(cmd.faceC, ex.faces.c) &&
    num(cmd.value, ex.value) &&
    num(cmd.min, ex.min) &&
    num(cmd.max, ex.max) &&
    !!cmd.flip === ex.flip &&
    !!cmd.center === ex.center &&
    (cmd.name ?? undefined) === ex.name
  );
}
function emitAssembly(c: Ctx, doc: CadDoc) {
  const comps = doc.components ?? [];
  // jedinečné díly (stejný díl ve více komponentách jen jednou), název záložky jednoznačný bez ohledu na velikost písmen
  const parts: { doc: CadDoc; tab: string; uses: number }[] = [];
  const byKey = new Map<string, number>();
  const tabOf = new Map<string, number>();
  const used = new Set<string>([doc.name.toLowerCase()]);
  let skipped = 0;
  for (const cp of comps) {
    if (cp.source.kind !== "part") {
      skipped++;
      continue;
    }
    const key = partKey(cp.source.doc);
    let k = byKey.get(key);
    if (k === undefined) {
      // název záložky musí jít zapsat do uvozovek (vložit "…") – jinak se z něj vynechá, co zapsat nejde
      const orig = cp.source.doc.name;
      let base = orig;
      if (!scriptQuote(base, true)) base = base.replace(/[\r\n]+/g, " ").trim();
      if (!scriptQuote(base, true)) base = base.replace(/\s+(#|\/\/)/g, " ").replace(/["„“]/g, "'").trim() || trIn(c.lang, "Díl");
      if (!scriptQuote(base, true)) base = `${c.w("cPart")} ${parts.length + 1}`;
      let tab = base;
      for (let i = 2; used.has(tab.toLowerCase()); i++) tab = `${base} (${i})`;
      used.add(tab.toLowerCase());
      if (base !== orig) c.note(tr("název dílu „{0}“ nejde zapsat na řádek skriptu – ve skriptu se jmenuje „{1}“ (název dílu uvnitř komponenty se tím změní)", orig, tab));
      else if (tab !== orig) c.note(tr("díl „{0}“ má stejný název jako jiný díl nebo sestava – ve skriptu se jmenuje „{1}“ (název dílu uvnitř komponenty se tím změní)", orig, tab));
      k = parts.push({ doc: cp.source.doc, tab, uses: 0 }) - 1;
      byKey.set(key, k);
    }
    parts[k].uses++;
    tabOf.set(cp.id, k);
  }
  if (skipped) c.note(tr("komponenty z importovaného souboru a podsestavy se do skriptu nepřenášejí: {0} z {1} – vložte je ručně (Import do sestavy, sestava podsestava)", skipped, comps.length));
  parts.forEach((pt, i) => {
    c.blank();
    c.comment(`── ${c.w("cPart")} ${i + 1}/${parts.length}: ${pt.tab} – ${pt.doc.features.length} ${c.w("cFeatures")}${pt.uses > 1 ? `, ${c.w("cUsed")} ${pt.uses}×` : ""} ──`);
    emitPart(c, pt.doc, pt.tab);
    c.stats.parts++;
  });
  c.blank();
  c.comment(`── ${c.w("cAsm")}: ${doc.name} – ${comps.length} ${c.w("cComponents")}, ${doc.mates?.length ?? 0} ${c.w("cMates")} ──`);
  const q = scriptQuote(doc.name, true);
  if (!q) c.note(tr("název sestavy „{0}“ nejde zapsat na řádek skriptu – sestava dostane výchozí název", doc.name));
  c.line(`${c.w("newAsm")} ${q ?? ""}`.trim());
  // výchozí název („Nová sestava“) aplikace čísluje jako dokument bez názvu → název ještě jednou výslovně
  if (q && isDefaultDocName(doc.name, "Nová sestava")) c.line(`${c.w("docName")} ${q}`);
  emitDocMeta(c, doc);
  if (doc.features.length) c.note(tr("prvky v dokumentu sestavy ({0}) se do skriptu nepřenášejí", doc.features.length));
  c.comment(c.w("cPlacement"));
  const idx = new Map<string, number>();
  let k = 0;
  for (const cp of comps) {
    const t = tabOf.get(cp.id);
    if (t === undefined) continue;
    const pt = parts[t];
    k++;
    idx.set(cp.id, k);
    c.stats.components++;
    const rot = cp.placement.rotation.some((v) => v !== 0) ? ` ${c.w("rotation")} ${vec(cp.placement.rotation)}` : "";
    const ins = `${c.w("insert")} ${scriptQuote(pt.tab, true) ?? `"${pt.tab}"`}${atPart(c, cp.placement.position)}${rot}${cp.fixed ? ` ${c.w("fixed")}` : ""}`;
    // přezdívka instance (vložit … jako "K48", jinak sestava komponenta #k přezdívka "…") – doc-script-asm.ts
    const al = aliasScript(c.sheetOut, cp, ins, k);
    c.line(`${ins}${al.tail}`);
    const patch: string[] = [];
    const qv = (word: WordKey, v: string | undefined) => {
      if (!v) return;
      const s = scriptQuote(v, true);
      if (s) patch.push(`${c.w(word)} ${s}`);
      else c.note(tr("údaj komponenty „{0}“ nejde zapsat na řádek skriptu", cp.name));
    };
    if (cp.name !== pt.tab) qv("name", cp.name);
    // číslo dílu z popisových údajů (props.number) dílu bez výkresu: razítko ho nepřenese → jako číslo komponenty (kusovník stejný)
    qv("number", cp.number ?? (pt.doc.drawings?.length ? undefined : pt.doc.props?.number?.trim() || undefined));
    qv("group", cp.group);
    if (cp.color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(cp.color)) patch.push(`${c.w("color")} ${cp.color.toLowerCase()}`);
    if (cp.hidden) patch.push(c.w("hide"));
    if (al.patch) patch.push(al.patch);
    if (patch.length) c.line(`${c.w("asm")} ${c.w("comp")} #${k} ${patch.join(" ")}`);
  }
  const mates = doc.mates ?? [];
  c.stats.mates += mates.length;
  const mateNo = new Map<string, number>();
  let mk = 0;
  const suppressed: number[] = [];
  for (const m of mates) {
    // ztracená reference (vlna 22, bod 20): F-číslo už patří jiné ploše – do skriptu by se tiše přichytila jinam
    if (mateLost(m)) {
      c.note(tr("vazba sestavy č. {0} má ztracenou referenci plochy (po úpravě dílu) – do skriptu se nezapisuje; vyberte plochu znovu (sestava vazba {0} plocha …) a export zopakujte", mates.indexOf(m) + 1));
      continue;
    }
    const ml = mateLine(c, m, idx);
    if (!ml || !lineSafe(ml.line) || !mateLineOk(ml.line, ml.expect)) {
      c.note(tr("vazbu sestavy č. {0} ({1}) nejde zapsat textem (plocha v podsestavě, odkaz na komponentu mimo skript nebo název) – doplňte ji ručně", mates.indexOf(m) + 1, m.type));
      continue;
    }
    c.line(ml.line);
    mk++;
    mateNo.set(m.id, mk);
    c.stats.matesText++;
    if (m.suppressed) suppressed.push(mk);
    if ((m.type === "distance" || m.type === "angle") && m.flip) c.note(tr("orientaci vazeb Vzdálenost / Úhel („obráceně“) určuje aplikace měřením při vložení vazby – skript ji nezapisuje (komponenty stojí ve splněné poloze)"));
  }
  for (const s of suppressed) c.line(`${c.w("asm")} ${c.w("mate")} ${s} ${c.w("suppress")}`);
  // pružiny mezi díly (dosedací plochy, L0, Ln, tuhost, vedení) – po vazbách, komponenty už stojí (doc-script-asm.ts)
  emitAsmSprings(c.sheetOut, comps, idx);
  const mo = doc.motion;
  if (mo?.motors.length) {
    c.comment(c.w("cMotion"));
    const ranged = mo.motors.some((m) => m.ranged && m.speed !== undefined);
    mo.motors.forEach((m, i) => {
      const no = mateNo.get(m.mate);
      if (no === undefined) {
        c.note(tr("motor pohybové studie č. {0} odkazuje na vazbu, která ve skriptu není", i + 1));
        return;
      }
      // rychlost bez `ranged` = od začátku bez konce (`od A rychlost V`); `A..B rychlost V` je rozsah × rychlost (cad/motor-model.ts)
      const open = m.speed !== undefined && !m.ranged;
      // uložený konec staršího dokumentu, který motor nikdy nepoužil: do skriptu nejde (význam by se změnil) – ale ne potichu
      const end = open ? unusedEnd(m) : null;
      if (end !== null)
        c.note(tr("motor pohybové studie č. {0}: uložený konec {1} se nepoužíval (motor jede od začátku rychlostí bez konce) – skript ho nezapisuje; dojet na konec a stát = {2}..{1} s rychlostí (rozsah × rychlost)", i + 1, n(end), n(m.from)));
      let l = `${c.w("motion")} ${c.w("motor")} ${c.w(m.kind === "linear" ? "linear" : "rotary")} ${c.w("mate")} ${no} ${open ? `${c.w("motorFrom")} ${n(m.from)}` : `${n(m.from)}..${n(m.to)}`}`;
      if (m.speed !== undefined) l += ` ${c.w(m.kind === "linear" ? "speed" : "rpm")} ${n(m.speed)}`;
      else if (m.back) l += ` ${c.w("back")}`;
      l += motorLimitWords(c.sheetOut, m); // vlna 22, bod 8: na mezi chyba
      if (i === 0) {
        // délku studie u rozsahu × rychlost určuje motor (|do − od| / rychlost) – uložená délka jde zvlášť řádkem „pohyb čas“ níže
        l += ` ${c.w("steps")} ${n(mo.steps)}${ranged ? "" : ` ${c.w("time")} ${n(mo.duration)}`}`;
        if (mo.collisions) l += ` ${c.w("clash")}`;
        if (mo.trace) {
          const tk = idx.get(mo.trace.compId);
          if (tk !== undefined) l += ` ${c.w("trace")} #${tk} ${c.w("point")} ${vec(mo.trace.point)}`;
        }
      }
      c.line(l);
    });
    if (ranged) c.line(`${c.w("motion")} ${c.w("time")} ${n(mo.duration)}`);
    if (mo.loop) c.note(tr("přehrávání pohybové studie ve smyčce se do skriptu nepřenáší"));
  }
  // vlna 22, bod 2: preferované strany mezí a režim studie (kinematika / kvazistatika) bez nastavení dynamiky
  emitStudyExtras(c.sheetOut, mo?.motors.length ? mo : undefined, mates, mateNo);
  // dynamika: ruční hmotnosti, síly na vazbách, zapnutí s nastavením (cad/motion-dynamic.ts)
  if (mo?.dyn) {
    if (!mo.motors.length) c.comment(c.w("cMotion"));
    for (const [id, kg] of Object.entries(mo.dyn.masses ?? {})) {
      const k = idx.get(id);
      if (k !== undefined) c.line(`${c.w("motion")} ${c.w("mass")} #${k} ${n(kg)}`);
      else c.note(tr("ruční hmotnost komponenty mimo skript (podsestava / import) se do skriptu nepřenáší"));
    }
    for (const ld of mo.dyn.loads ?? []) {
      const no = mateNo.get(ld.mate);
      if (no !== undefined) c.line(`${c.w("motion")} ${c.w(ld.kind === "force" ? "force" : "torque")} ${c.w("mate")} ${no} ${n(ld.value)}`);
      else c.note(tr("síla / moment na vazbě, která ve skriptu není, se do skriptu nepřenáší"));
    }
    // čas, krok, gravitace, tlumení, odraz, snímky (i nastavení uložené u kinematické studie) – doc-script-asm.ts
    emitDynamics(c.sheetOut, mo);
  }
  emitDrawings(c, doc);
}

/* ───────────────────────── vstup ───────────────────────── */
function emit(doc: CadDoc, o: DocScriptOptions): { c: Ctx } {
  const c = new Ctx(o);
  const kind = doc.kind ?? "part";
  c.comment(`Mnástrojárna CAD – ${c.w("cScript")} „${doc.name}“`);
  c.comment(c.w("cRun"));
  if (kind === "draft") {
    c.note(tr("2D výkres se do skriptu zapisuje jako jeden řádek JSON (celý dokument) – příkazy „2d …“ zatím jeho hladiny, styly, bloky a rozvržení nepokrývají"));
    c.line(scriptJson(doc));
  } else if (kind === "assembly") emitAssembly(c, doc);
  else {
    c.blank();
    c.comment(`── ${c.w("cPart")}: ${doc.name} – ${doc.features.length} ${c.w("cFeatures")} ──`);
    emitPart(c, doc, doc.name);
    c.stats.parts++;
  }
  return { c };
}

/**
 * Závěrečná kontrola celého skriptu: přečte se bez chyb a názvy prvků odpovídají (čítače automatických názvů). Čte se
 * v jazyce skriptu – automatické názvy přiděluje parser podle jazyka rozhraní.
 */
function finalCheck(text: string, c: Ctx): { errors: string[]; namesOk: boolean } {
  const errors: string[] = [];
  let namesOk = true;
  const ui = getLang();
  try {
    setLang(c.lang);
    const prog = parseAgentText(text);
    for (const e of prog.errors) errors.push(`${e.line}: ${e.message}`);
    // názvy: prvky v pořadí; nový díl nuluje seznam prvků (volný název se hledá v rámci dílu)
    let feats: Feature[] = [];
    let i = 0;
    const take = (f: Feature) => {
      const exp = c.expect[i++];
      if (!exp) return;
      const name = freeName(feats, { ...f, id: `\u0002${i}` } as Feature);
      if (exp.type !== f.type || exp.name !== name) namesOk = false;
      feats.push({ ...f, id: `\u0002${i}`, name } as Feature);
    };
    for (const op of prog.ops as AgentOp[]) {
      if (op.k === "new" || op.k === "doc") feats = [];
      else if (op.k === "feature" || op.k === "select" || op.k === "sketchOn") take(op.feature);
      else if (op.k === "features") op.features.forEach(take);
      else if (op.k === "edit" && op.cmd.kind === "rename" && isLast(op.cmd.target) && feats.length) feats[feats.length - 1] = { ...feats[feats.length - 1], name: op.cmd.name } as Feature;
    }
    if (i !== c.expect.length) namesOk = false;
  } catch (e) {
    errors.push((e as Error).message);
  } finally {
    setLang(ui);
  }
  return { errors, namesOk };
}

/**
 * Dokument (díl, sestava, 2D výkres) jako textový skript. `notes` = co se do skriptu nepřeneslo nebo co se po přečtení
 * může lišit; `stats` = pokrytí (vlastní příkaz / obecný `prvek` / JSON podle typu prvku).
 */
export function docToScript(doc: CadDoc, opts: DocScriptOptions = {}): DocScript {
  let { c } = emit(doc, opts);
  let text = c.out.join("\n").replace(/\n+$/, "") + "\n";
  let fin = finalCheck(text, c);
  if (!fin.namesOk && (opts.names ?? "auto") === "auto") {
    // automatické názvy nevyšly stejně (neobvyklé pořadí čítačů) → názvy výslovně u všech prvků
    ({ c } = emit(doc, { ...opts, names: "all" }));
    text = c.out.join("\n").replace(/\n+$/, "") + "\n";
    fin = finalCheck(text, c);
  }
  const S = c.sums;
  if (S.sigsKept) c.note(tr("prvky s otisky výběru hran / ploch ({0}) jsou zapsané obecným příkazem i s otisky – uložená čísla mohou být po úpravě historie zastaralá a bez jádra je nejde ověřit (v aplikaci je ověřuje export skript a window.mncad.script())", S.sigsKept));
  if (S.sigsDropped) c.note(tr("otisky výběru hran / ploch ({0} prvků) jsou vynechané (sigs: \"drop\") – skript nese čísla hran a ploch tak, jak jsou uložená; po úpravě historie dílu mohou být zastaralá", S.sigsDropped));
  if (S.autoDims) c.note(tr("vygenerované kóty výkresů (Chytré kóty, {0}) se nezapisují jednotlivě – „kótovat chytře“ je při přečtení vygeneruje znovu (nová id, poloha podle generátoru)", S.autoDims));
  if (S.smartOff) c.note(tr("smazané vygenerované kóty výkresů ({0} na {1} listech) se po „kótovat chytře“ vrátí – jejich id umí určit jen jádro (export v aplikaci je smaže příkazem výkres smazat a…)", S.smartOff, S.smartOffSheets));
  if (S.editedDims) c.note(tr("úpravy vygenerovaných kót (tolerance, vlastní text, revize) se do skriptu nepřenášejí: {0} na {1} listech – doplňte je příkazem výkres tolerance <kóta> <tolerance>", S.editedDims, S.editedSheets));
  if (S.manualAnn) c.note(tr("ruční kóty a značky výkresu se do skriptu nepřenášejí: {0} na {1} listech", S.manualAnn, S.manualSheets));
  if (S.propsLost) c.note(tr("popisové údaje (číslo, autor, revize) se nastavují razítkem výkresu – {0} dokumentů bez výkresu je do skriptu nepřenese (číslo dílu se v sestavě zapíše jako číslo komponenty)", S.propsLost));
  if (fin.errors.length) c.note(tr("skript se nepřečetl bez chyb ({0}): {1}", fin.errors.length, fin.errors.slice(0, 3).join(" · ")));
  if (!fin.namesOk) c.note(tr("názvy některých prvků se po přečtení skriptu mohou lišit (stejné názvy v jednom dílu)"));
  for (const x of opts.notes ?? []) c.note(x);
  // co skript nepřenese, říká i komentář ve skriptu (za hlavičkou) – nejen protokol převodu
  if (c.comments && c.notes.length) {
    const lines = text.split("\n");
    const at = lines.findIndex((l) => !l.startsWith("#"));
    const block = [`# ℹ ${tr("co skript nepřenese ({0}):", c.notes.length)}`, ...c.notes.map((x) => `# ℹ ${x.replace(/[\r\n]+/g, " ")}`)];
    lines.splice(at < 0 ? lines.length : at, 0, ...block);
    text = lines.join("\n");
  }
  c.stats.lines = text.split("\n").length - 1;
  c.stats.bytes = new TextEncoder().encode(text).length;
  return { text, notes: c.notes, stats: c.stats };
}

/** Jednořádkové shrnutí pokrytí pro protokol: „183 prvků: 181 vlastním příkazem, 2 obecným příkazem prvek, 0 jako JSON“. */
export function scriptCoverageText(s: ScriptStats): string {
  return tr("{0} prvků: {1} vlastním příkazem, {2} obecným příkazem „prvek“, {3} jako JSON", s.features, s.dedicated, s.generic, s.json);
}

