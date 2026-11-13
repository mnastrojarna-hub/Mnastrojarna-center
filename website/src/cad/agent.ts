/**
 * Textové rozhraní CADu – pro AI agenty, automatizaci i lidi, kteří raději píší než klikají.
 *
 * Vstup je buď JSON (celý dokument `.mncad`, pole prvků nebo jeden prvek), nebo řádkové příkazy
 * (česky i anglicky, např. `kvádr 100 60 20`, `díra 8,5 skrz v 20 30`, `zaoblit 2 hrany svislé`).
 * Výstupem je program operací (`AgentOp`), který aplikace provede nad dokumentem a vrátí textový protokol
 * (co se podařilo, co ne a proč) + textový stav dokumentu, aby agent měl zpětnou vazbu bez obrázku.
 *
 * Čisté funkce bez prohlížeče (testovatelné v Node). Operace, které potřebují topologii tělesa
 * (výběr hran/ploch pravidlem, poloha díry „na horní ploše“), nechávají doplnění na aplikaci.
 */
import { getLang, tr } from "./i18n";
import { MATERIALS } from "@/lib/mesh-metrics";
import { threadByName, threadLabel } from "./defaults";
import { allExt } from "./ext/registry";
import { parseDimension, parseDrawing, type DrawingCmd } from "./agent-drawing";
import { parseConstraints, parseDims, sketchStatusLines, type SketchOnOp, type SketchOp, type SketchTarget } from "./agent-sketch";
import { toAxisDef, toDirection } from "./ext/place";
import { emptyDoc, uid, type Axis, type BuildResult, type CadDoc, type Feature, type PlaneName, type SketchEntity, type Vec2, type Vec3 } from "./types";

export const AGENT_API_VERSION = 1;

/** Všechny typy prvků dokumentu (hlídá test proti `types.ts`). */
export const FEATURE_TYPES = [
  "sketch", "extrude", "revolve", "box", "cylinder", "sphere", "cone", "tube", "hole", "fillet", "chamfer", "shell", "pattern", "mirror", "import", "sweep", "loft", "draft", "split", "transform", "datum", "text", "pushPull", "deleteFace", "offsetFace", "rib", "spring", "thicken", "thread", "ext", "combine", "splitBodies", "copyBody", "datumAxis", "datumPoint", "csys",
] as const;

export const FEATURE_LABEL: Record<string, string> = {
  sketch: "Skica", extrude: "Vysunutí", revolve: "Rotace", box: "Kvádr", cylinder: "Válec", sphere: "Koule", cone: "Kužel", tube: "Trubka", hole: "Díra", fillet: "Zaoblení", chamfer: "Sražení", shell: "Skořepina", pattern: "Pole", mirror: "Zrcadlení", import: "Import", sweep: "Tažení", loft: "Šablonování", draft: "Úkos", split: "Rozříznutí", transform: "Přesun", datum: "Rovina", text: tr("Text"), pushPull: "Vytáhnout", deleteFace: "Odstranit plochu", offsetFace: "Odsadit plochu", rib: "Žebro", spring: "Pružina", thicken: "Zesílení", thread: "Závit", ext: "Prvek", combine: "Sloučení", splitBodies: "Rozdělení", copyBody: "Kopie tělesa", datumAxis: "Osa", datumPoint: "Bod", csys: "Souřadný systém",
};

/* ───────────────────────── operace ───────────────────────── */
/** příkazy z tabulky příkazů v jazyce rozhraní – pro hlášku o neznámém příkazu (stejný seznam jako v nápovědě) */
function commandWords(): string[] {
  const lang = getLang();
  const out: string[] = [];
  const add = (w?: string) => {
    if (w && w !== "JSON" && !out.includes(w)) out.push(w);
  };
  for (const c of AGENT_COMMANDS) {
    if (lang !== "cs") {
      for (const w of (lang === "en" ? c.en : c.de).split(/, | \/ /)) add(w.trim());
      continue;
    }
    for (const part of c.cmd.split(/ · | \/ |, /)) add(part.trim().match(/^(nov[ýá] (díl|sestava)|smazat poslední|pole kruhové|[^\s[<|{(,]+)/)?.[0]);
  }
  return out;
}

export type Rule = string[];
export type AgentOp =
  | { k: "doc"; doc: CadDoc; line: number }
  | { k: "features"; features: Feature[]; line: number }
  | { k: "new"; name: string; assembly: boolean; line: number }
  | { k: "meta"; patch: { name?: string; material?: string; materialName?: string; color?: string }; line: number }
  /** prvek; `fillTop` = souřadnice v ose prvku doplnit na horní plochu tělesa (díra „v x y“ bez z, text) */
  | { k: "feature"; feature: Feature; line: number; fillTop?: boolean }
  /** entity, vazby a kóty do skici bloku (skica z tohoto vstupu, jinak poslední skica); skica na ploše / pomocné rovině – agent-sketch.ts */
  | SketchOp
  | SketchOnOp
  /**
   * prvek, jehož hrany/plochy vybere aplikace podle pravidla (zaoblení, sražení, skořepina); `into` = obecný prvek:
   * cesta v prvku, kam se indexy uloží (např. „data.faces“), a druh entit
   */
  | { k: "select"; feature: Feature; rule: Rule; line: number; into?: { path: string; kind: "faces" | "edges" } }
  /** další prvky pracují s tímto tělesem dílu (více těles) */
  | { k: "body"; name: string; line: number }
  /** normálie z knihovny podle textu („M8x30“, „ložisko 6204“): v dílu nová záložka, v sestavě komponenta */
  | { k: "library"; query: string; at?: Vec3; line: number }
  /** sestava: vloží komponentu z otevřené záložky (díl podle názvu) */
  | { k: "insert"; tab: string; at: Vec3; rotation: Vec3; fixed: boolean; line: number }
  /** otevře výkres otevřeného dokumentu */
  | { k: "drawing"; line: number }
  /** výkres: volby listu, Chytré kóty, tolerance, údaje u razítka, stav (cad/agent-drawing.ts, provedení cad/drawing-agent.ts) */
  | { k: "drawingCmd"; cmd: DrawingCmd; line: number }
  | { k: "pop"; line: number }
  | { k: "view"; view: string; line: number }
  | { k: "status"; line: number }
  /** sestava: kontrola kolizí komponent, výsledek do protokolu */
  | { k: "clash"; line: number };
export type AgentError = { line: number; text: string; message: string };
export type AgentProgram = { ops: AgentOp[]; errors: AgentError[] };

/* ───────────────────────── pomocné ───────────────────────── */
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const isNum = (t: string) => /^[+-]?ø?(\d+[.,]?\d*|[.,]\d+)(mm|°)?$/i.test(t.replace(/^[øØ]/, ""));
export const num = (t: string): number => {
  const m = /^[+-]?(\d+[.,]?\d*|[.,]\d+)/.exec(t.replace(/^[øØ]/, ""));
  if (!m) return NaN;
  const sign = t.startsWith("-") ? -1 : 1;
  return sign * parseFloat(m[1].replace(",", "."));
};
function tokenize(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|„([^“]*)“|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return out;
}
/** synonyma → kanonický název příkazu / volby */
const SYN: Record<string, string> = {};
const syn = (canon: string, ...alts: string[]) => {
  for (const a of [canon, ...alts]) SYN[fold(a)] = canon;
};
syn("new", "nový", "nova", "nová", "novy");
syn("part", "díl", "dil", "součást", "soucast");
syn("assembly", "sestava");
syn("name", "název", "nazev", "pojmenovat");
syn("material", "materiál", "material");
syn("color", "barva", "colour");
syn("box", "kvádr", "kvadr", "hranol", "deska");
syn("cylinder", "válec", "valec");
syn("sphere", "koule", "ball");
syn("cone", "kužel", "kuzel");
syn("tube", "trubka", "pipe");
syn("sketch", "skica", "náčrt", "nacrt");
syn("rect", "obdélník", "obdelnik", "rectangle", "čtverec", "ctverec", "square");
syn("circle", "kružnice", "kruznice", "kruh");
syn("polygon", "mnohoúhelník", "mnohouhelnik", "šestihran", "sestihran", "hex");
syn("slot", "drážka", "drazka");
syn("line", "úsečka", "usecka", "přímka", "primka");
syn("polyline", "čára", "cara", "lomená", "lomena", "obrys", "polyčára");
syn("point", "bod");
syn("ellipse", "elipsa");
syn("extrude", "vysunout", "vysunutí", "vysunuti", "vytáhnout", "vytahnout");
syn("revolve", "rotovat", "rotace", "orotovat");
syn("hole", "díra", "dira", "otvor", "vrtat");
syn("fillet", "zaoblit", "zaoblení", "zaobleni", "rádius", "radius", "round");
syn("chamfer", "srazit", "sražení", "srazeni", "zkosit", "zkosení");
syn("shell", "skořepina", "skorepina", "vydlabat");
syn("pattern", "pole", "opakovat", "array");
syn("mirror", "zrcadlit", "zrcadlení", "zrcadleni");
syn("text", "nápis", "napis");
syn("undo", "smazat", "zpět", "zpet", "odstranit");
syn("status", "stav", "info", "report");
syn("view", "zobraz", "pohled", "zobrazit");
// volby
syn("center", "střed", "stred", "centered", "vystředit");
syn("at", "v", "na", "poloha", "position", "pos");
syn("through", "skrz", "průchozí", "pruchozi", "throughall");
syn("bothways", "obousměrně", "obousmerne", "oboustranně", "oboustranne", "both", "bidirectional");
syn("depth", "hloubka", "hloubku", "deep");
syn("symmetric", "symetricky", "symetrický", "symetricke", "oboustranně", "midplane");
syn("reverse", "obráceně", "obracene", "opačně", "opacne", "flip", "otočit");
syn("cut", "odebrat", "odečíst", "odecist", "vyříznout", "subtract", "minus");
syn("add", "přidat", "pridat", "sloučit", "union", "plus");
syn("intersect", "průnik", "prunik");
syn("newbody", "nové", "nove", "samostatně", "newbody");
syn("axis", "osa", "kolem");
syn("angle", "úhel", "uhel", "deg");
syn("draft", "úkos", "ukos");
syn("offset", "odsazení", "odsazeni", "posun");
syn("spacing", "rozteč", "roztec", "krok", "step", "pitch");
syn("count", "počet", "pocet", "ks");
syn("direction", "směr", "smer", "podél", "podel");
syn("thread", "závit", "zavit");
syn("counterbore", "zahloubení", "zahloubeni", "cbore");
syn("countersink", "kuželové", "kuzelove", "csink", "zapuštění", "zapusteni");
syn("edges", "hrany", "hrana", "edge");
syn("open", "otevřít", "otevrit", "bez", "remove");
syn("height", "výška", "vyska", "h");
syn("engrave", "gravírovat", "gravirovat", "vyrýt", "vyryt");
syn("construction", "pomocná", "pomocna", "pomocný", "konstrukční");
syn("closed", "uzavřít", "uzavrit", "uzavřený", "uzavreny", "close");
syn("keep", "ponechat", "zachovat");
syn("radius", "poloměr", "polomer", "r");
syn("diameter", "průměr", "prumer", "d");
syn("sides", "stran", "strany", "n");
syn("corner", "roh", "rohy");
syn("rect-r", "zaoblení-rohů", "rr");
syn("length", "délka", "delka", "dlouhé", "l");
syn("width", "šířka", "sirka", "široké", "w");
syn("longer", "delší", "delsi");
syn("shorter", "kratší", "kratsi");
syn("linear", "lineární", "linearni", "řada", "rada", "mřížka", "mrizka");
syn("circular", "kruhové", "kruhove", "kruhový", "kruhovy", "dokola", "polar");
syn("internal", "vnitřní", "vnitrni", "inner");
syn("clash", "kolize", "kolizní", "kolizni", "collisions", "interference");
syn("modeled", "modelovat", "modelovaný", "modelovany", "modeled", "modelled");
// německá synonyma (rozhraní /de/cad) – kanonická jména jsou anglická, takže anglické příkazy fungují vždy
syn("new", "neu", "neues", "neuer", "neue");
syn("part", "teil", "bauteil");
syn("assembly", "baugruppe");
syn("name", "benennen", "bezeichnung");
syn("material", "werkstoff");
syn("color", "farbe");
syn("box", "quader", "block", "platte");
syn("cylinder", "zylinder");
syn("sphere", "kugel");
syn("cone", "kegel");
syn("tube", "rohr");
syn("sketch", "skizze");
syn("rect", "rechteck", "quadrat");
syn("circle", "kreis");
syn("polygon", "vieleck", "sechskant", "sechseck");
syn("slot", "langloch", "nut");
syn("line", "linie", "strecke");
syn("polyline", "polylinie", "linienzug", "kontur");
syn("point", "punkt");
syn("extrude", "extrudieren", "extrusion", "austragen", "ausziehen");
syn("revolve", "drehen", "rotieren", "rotation");
syn("hole", "bohrung", "bohren", "loch");
syn("fillet", "verrunden", "verrundung", "abrunden", "rundung");
syn("chamfer", "fase", "fasen", "anfasen");
syn("shell", "schale", "aushöhlen", "wandung");
syn("pattern", "muster", "wiederholen", "anordnung");
syn("mirror", "spiegeln", "spiegelung");
syn("text", "schrift", "beschriftung");
syn("undo", "rückgängig", "löschen", "entfernen", "zurück");
syn("status", "zustand", "bericht");
syn("view", "ansicht", "anzeigen", "zeige");
syn("clash", "kollision", "kollisionen", "durchdringung");
// německé volby
syn("center", "mitte", "zentriert", "zentrieren");
syn("at", "bei", "an");
syn("through", "durch", "durchgehend", "durchgangs");
syn("bothways", "beidseits", "beiderseits", "beidrichtung"); // „beidseitig“ = symmetric (u díry znamená totéž)
syn("depth", "tiefe", "tief");
syn("symmetric", "symmetrisch", "beidseitig", "mittig");
syn("reverse", "umkehren", "umgekehrt", "entgegen", "gegenrichtung");
syn("cut", "abziehen", "ausschneiden", "subtrahieren");
syn("add", "hinzufügen", "vereinigen", "vereinigung");
syn("intersect", "schnittmenge");
syn("newbody", "neukörper", "separat", "eigenständig");
syn("axis", "achse", "um");
syn("angle", "winkel", "grad");
syn("draft", "schräge", "formschräge", "entformungsschräge");
syn("offset", "versatz", "versetzt");
syn("spacing", "teilung", "abstand", "schritt");
syn("count", "anzahl", "stück", "stk");
syn("direction", "richtung", "entlang");
syn("thread", "gewinde");
syn("counterbore", "senkung", "zylindersenkung");
syn("countersink", "kegelsenkung", "versenkt");
syn("edges", "kanten", "kante");
syn("open", "öffnen", "offen", "ohne");
syn("height", "höhe", "hoch");
syn("engrave", "gravieren", "graviert");
syn("construction", "hilfs", "hilfslinie", "konstruktion", "konstruktions");
syn("closed", "schließen", "schliessen", "geschlossen");
syn("keep", "behalten", "beibehalten");
syn("radius", "halbmesser");
syn("diameter", "durchmesser", "dm");
syn("sides", "seiten", "ecken");
syn("corner", "ecke");
syn("rect-r", "eckenradius");
syn("length", "länge", "lang");
syn("width", "breite", "breit");
syn("longer", "länger");
syn("shorter", "kürzer");
syn("linear", "reihe", "raster", "gitter");
syn("circular", "kreisförmig", "kreismuster", "rundum");
syn("internal", "innen", "innengewinde");
syn("modeled", "modellieren", "modelliert");
// ── skica: oblouk, spline; díra: sklon; tělesa; obecný prvek; knihovna; sestava ──
syn("arc", "oblouk", "bogen", "kreisbogen");
syn("spline", "křivka", "krivka", "kurve");
syn("tilt", "sklon", "naklonit", "neigung", "geneigt");
syn("origin", "počátek", "pocatek", "ursprung");
syn("normal", "normála", "normala", "normale");
syn("xdir", "osax", "směrx", "smerx", "xrichtung");
syn("splitbodies", "rozdělit", "rozdelit", "teilen", "aufteilen");
syn("copybody", "kopie", "kopírovat", "kopirovat", "copy", "kopieren");
syn("combine", "spojit", "kombinovat", "kombinieren");
syn("body", "těleso", "teleso", "tělesa", "telesa", "bodies", "körper", "koerper");
syn("as", "jako", "als");
syn("feature", "prvek", "element");
syn("library", "normálie", "normalie", "knihovna", "normteil", "normteile", "bibliothek");
syn("insert", "vložit", "vlozit", "einfügen", "einfuegen");
syn("fixed", "ukotvit", "ukotvená", "ukotvena", "fixieren", "fest");
syn("rotation", "otočení", "otoceni", "natočení", "natoceni", "drehung");
syn("drawing", "výkres", "vykres", "zeichnung");
syn("dimension", "kótovat", "kotovat", "okótovat", "okotovat", "bemaßen", "bemassen", "dimensionieren");
syn("threaddepth", "hloubka-závitu", "hloubka-zavitu", "thread-depth", "gewindetiefe");
// ── skica: vazby, kóty, rovina na ploše / pomocné rovině (agent-sketch.ts) ──
syn("constraint", "vazba", "vazby", "constraints", "bedingung", "bedingungen");
syn("dim", "kóta", "kota", "kóty", "koty", "dims", "bemaßung", "bemassung", "maß", "mass");
syn("face", "plocha", "fläche", "flaeche");
syn("plane", "rovina", "ebene", "datum", "bezugsebene", "hilfsebene");
const canon = (t: string) => SYN[fold(t)] ?? fold(t);
/** anglické a německé názvy tříd materiálu → id (hustota); jiné texty jdou do razítka jako označení */
const MATERIAL_ALIASES: Record<string, string> = Object.fromEntries(
  (
    [
      ["ocel", "steel", "stahl", "mild steel", "baustahl"],
      ["nerez", "stainless", "stainless steel", "inox", "edelstahl", "rostfrei", "nirosta"],
      ["hlinik", "aluminium", "aluminum", "alu", "alloy"],
      ["mosaz", "brass", "messing"],
      ["med", "copper", "kupfer"],
      ["titan", "titanium"],
      ["pom", "plastic", "plast", "kunststoff", "delrin", "acetal"],
    ] as const
  ).flatMap(([id, ...names]) => names.map((n) => [fold(n), id] as const)),
);

const PLANES: Record<string, PlaneName> = { xy: "XY", xz: "XZ", yz: "YZ", "pudorys": "XY", "narys": "XZ", "bokorys": "YZ", top: "XY", front: "XZ", right: "YZ", oben: "XY", draufsicht: "XY", vorne: "XZ", vorderansicht: "XZ", seite: "YZ", seitenansicht: "YZ" };
const AXES: Record<string, Axis> = { x: "X", y: "Y", z: "Z" };
const DIRS: Record<string, Vec3> = { "+x": [1, 0, 0], "-x": [-1, 0, 0], "+y": [0, 1, 0], "-y": [0, -1, 0], "+z": [0, 0, 1], "-z": [0, 0, -1], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const VIEWS: Record<string, string> = { iso: "iso", izo: "iso", izometrie: "iso", front: "front", predni: "front", zadni: "back", back: "back", top: "top", horni: "top", shora: "top", bottom: "bottom", spodni: "bottom", left: "left", levy: "left", zleva: "left", right: "right", pravy: "right", zprava: "right", isometrisch: "iso", vorne: "front", vorder: "front", hinten: "back", oben: "top", unten: "bottom", links: "left", rechts: "right" };

/** volby za příkazem: `{klíč: čísla | slova}` + příznaky */
type Opts = { flags: Set<string>; nums: Record<string, number[]>; words: Record<string, string[]>; free: number[]; strings: string[] };
const FLAGS = new Set(["fixed", "center", "through", "bothways", "symmetric", "reverse", "cut", "add", "intersect", "newbody", "engrave", "construction", "closed", "keep", "linear", "circular", "internal", "modeled"]);
const NUM_OPTS = new Set(["threaddepth", "tilt", "origin", "normal", "xdir", "rotation", "at", "depth", "angle", "draft", "offset", "spacing", "count", "counterbore", "countersink", "height", "radius", "diameter", "sides", "rect-r", "length", "width", "longer", "shorter", "corner"]);
const WORD_OPTS = new Set(["axis", "direction", "thread", "edges", "open", "name", "material", "color", "body", "as"]);
function parseOpts(tokens: string[]): Opts {
  const o: Opts = { flags: new Set(), nums: {}, words: {}, free: [], strings: [] };
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const c = canon(t);
    if (FLAGS.has(c)) {
      o.flags.add(c);
      i++;
      continue;
    }
    if (NUM_OPTS.has(c)) {
      const vals: number[] = [];
      i++;
      while (i < tokens.length && isNum(tokens[i])) vals.push(num(tokens[i++]));
      o.nums[c] = [...(o.nums[c] ?? []), ...vals];
      continue;
    }
    if (WORD_OPTS.has(c)) {
      const vals: string[] = [];
      const ruleWords = c === "edges" || c === "open"; // pravidla smí obsahovat i slova, která jsou jinde příznaky (kruhové…)
      const single = c === "axis" || c === "direction" || c === "thread"; // jedno slovo (směr i jako 3 čísla)
      i++;
      if (single) {
        if (i < tokens.length && isNum(tokens[i])) while (i < tokens.length && isNum(tokens[i]) && vals.length < 3) vals.push(tokens[i++]);
        else if (i < tokens.length && !NUM_OPTS.has(canon(tokens[i])) && !WORD_OPTS.has(canon(tokens[i])) && !FLAGS.has(canon(tokens[i]))) vals.push(tokens[i++]);
      } else while (i < tokens.length && (ruleWords || !FLAGS.has(canon(tokens[i]))) && !NUM_OPTS.has(canon(tokens[i])) && !WORD_OPTS.has(canon(tokens[i]))) vals.push(tokens[i++]);
      o.words[c] = [...(o.words[c] ?? []), ...vals];
      continue;
    }
    if (isNum(t)) o.free.push(num(t));
    else o.strings.push(t);
    i++;
  }
  return o;
}
/** `skica plocha F3 [odsazení N] [obráceně]` · `skica rovina <název pomocné roviny> [odsazení N]` (null = jiná rovina) */
function sketchOnSpec(tk: string[], o: Opts): Pick<SketchOnOp, "on" | "offset" | "flip"> | null {
  // slova za volbou (název „Horní plocha“, materiál…) nejsou umístění skici – přeskočí se jako v parseOpts
  const isKey = (t: string) => NUM_OPTS.has(canon(t)) || WORD_OPTS.has(canon(t)) || FLAGS.has(canon(t));
  let i = -1;
  for (let j = 0; j < tk.length && i < 0; j++) {
    const c = canon(tk[j]);
    if (c === "face" || c === "plane") i = j;
    else if (c === "axis" || c === "direction" || c === "thread") {
      // jedno slovo, nebo směr třemi čísly
      if (j + 1 < tk.length && isNum(tk[j + 1])) for (let n = 0; n < 3 && j + 1 < tk.length && isNum(tk[j + 1]); n++) j++;
      else if (j + 1 < tk.length && !isKey(tk[j + 1])) j++;
    } else if (WORD_OPTS.has(c)) while (j + 1 < tk.length && !isKey(tk[j + 1])) j++;
  }
  if (i < 0) return null;
  const rest: string[] = [];
  for (const t of tk.slice(i + 1)) {
    const c = canon(t);
    if (NUM_OPTS.has(c) || FLAGS.has(c) || WORD_OPTS.has(c)) break;
    rest.push(t);
  }
  const placed = { offset: o.nums.offset?.[0] ?? 0, flip: o.flags.has("reverse") };
  if (canon(tk[i]) === "face") {
    // číslo F jako popisky pro výběr (F1 = první plocha), nebo pravidlo jako u skořepiny: horní, spodní, +X, boční -Y…
    const m = /^f?(\d+)$/i.exec(rest[0] ?? "");
    if (m && rest.length === 1 && Number(m[1]) >= 1) return { on: { face: Number(m[1]) }, ...placed };
    if (!rest.length || /^f?\d+$/i.test(rest[0])) throw new Error(tr("skica na ploše potřebuje číslo plochy nebo pravidlo: skica plocha F3 | horní | +X [odsazení 5] [obráceně] – čísla ploch F1, F2… ukazují popisky pro výběr (Ctrl+Shift+L, window.mncad.hints())"));
    return { on: { faceRule: rest.map(fold) }, ...placed };
  }
  const name = rest.join(" ").trim();
  if (!name) throw new Error(tr("skica na pomocné rovině potřebuje její název: skica rovina \"Rovina 1\" [odsazení 5]"));
  return PLANES[fold(name)] ? null : { on: { datum: name }, ...placed }; // „skica rovina XY“ = základní rovina
}
const axisOf = (o: Opts, dflt: Axis = "Z"): Axis => AXES[fold(o.words.axis?.[0] ?? "")] ?? dflt;
const modeOf = (o: Opts): "new" | "add" | "cut" | "intersect" => (o.flags.has("cut") ? "cut" : o.flags.has("intersect") ? "intersect" : o.flags.has("newbody") ? "new" : "add");
const posOf = (o: Opts): Vec3 | null => {
  const p = o.nums.at;
  if (!p?.length) return null;
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
};
const dirOf = (words: string[] | undefined, nums?: number[]): Vec3 | null => {
  const w = fold(words?.[0] ?? "");
  if (DIRS[w]) return DIRS[w];
  if (words && words.length >= 3 && words.slice(0, 3).every(isNum)) return [num(words[0]), num(words[1]), num(words[2])];
  if (nums && nums.length >= 3) return [nums[0], nums[1], nums[2]];
  return null;
};

/** název tělesa z tokenů: samotné číslo = „Těleso N“ (výchozí názvy), jinak text tak, jak je */
const bodyName = (tokens: string[] | undefined): string => {
  const t = (tokens ?? []).join(" ").trim();
  return /^\d+$/.test(t) ? `Těleso ${t}` : t;
};
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 1e-12)) throw new Error(tr("směr nesmí být nulový vektor"));
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** hodnota za `klíč=` v obecném příkazu „prvek“: číslo, ano/ne, seznam `a;b;c`, JSON `[…]` / `{…}`, jinak text */
function parseValue(raw: string): unknown {
  const t = raw.trim();
  if (/^[[{]/.test(t)) {
    try {
      return JSON.parse(t);
    } catch {
      throw new Error(tr("hodnotu „{0}“ nelze přečíst jako JSON", t));
    }
  }
  const f = fold(t);
  if (["ano", "true", "yes", "ja", "on"].includes(f)) return true;
  if (["ne", "false", "no", "nein", "off"].includes(f)) return false;
  if (t.includes(";")) return t.split(";").map((x) => parseValue(x));
  if (isNum(t)) return num(t);
  return t;
}
/** nastaví hodnotu na cestě `a.b.0` (vytvoří chybějící objekty) */
function setAt(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let o: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof o[keys[i]] !== "object" || o[keys[i]] === null) o[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[keys[i]] as Record<string, unknown>;
  }
  o[keys[keys.length - 1]] = value;
}
/** rozdělí `klíč=hodnota klíč="text s mezerami" klíč=[1, 2, 3]` na dvojice */
function keyValues(text: string): [string, string][] {
  const out: [string, string][] = [];
  // JSON hodnota smí mít vnořené objekty (směr / rovina odkazem: {"kind":"edge","ref":{"kind":"edge","index":3}}) – do 4 úrovní
  const re = /([^\s=]+)=("[^"]*"|„[^“]*“|\[[^\]]*\]|\{(?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*\}|\S*)/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(text))) {
    const gap = text.slice(last, m.index).trim();
    if (gap) throw new Error(tr("„{0}“ není ve tvaru klíč=hodnota", gap));
    out.push([m[1], m[2].replace(/^["„]|["“]$/g, "")]);
    last = re.lastIndex;
  }
  const rest = text.slice(last).trim();
  if (rest) throw new Error(tr("„{0}“ není ve tvaru klíč=hodnota", rest));
  return out;
}

/**
 * Obecný příkaz `prvek <typ> klíč=hodnota …` – přístup ke všem typům prvků i prvkům rozšíření bez JSON.
 * Typ = název typu (sweep, loft, draft…), id rozšíření (sheet.bend) nebo jeho popisek („Ohyb plechu“).
 * Klíče: názvy polí prvku (u rozšíření klíč nebo popisek parametru); skici a prvky lze zadat názvem nebo `$last`;
 * plochy / hrany čísly `1;2;5` nebo pravidlem (`plochy=horní`, `hrany=svislé;kruhové`).
 */
function parseGenericFeature(rest: string, named: (type: Feature["type"], name?: string) => string, no: number): AgentOp {
  const m = /^\s*("([^"]*)"|„([^“]*)“|(\S+))\s*(.*)$/.exec(rest);
  if (!m) throw new Error(tr("prvek potřebuje typ: prvek <typ> klíč=hodnota … (typy: {0})", FEATURE_TYPES.join(", ")));
  const word = m[2] ?? m[3] ?? m[4];
  const pairs = keyValues(m[5] ?? "");
  const fw = fold(word);
  const base = FEATURE_TYPES.find((t) => fold(t) === fw) ?? (Object.entries(FEATURE_LABEL).find(([, l]) => fold(l) === fw)?.[0] as (typeof FEATURE_TYPES)[number] | undefined);
  const ext = base ? undefined : allExt().find((d) => fold(d.ext) === fw || fold(d.label) === fw);
  if (!base && !ext) throw new Error(tr("neznámý typ prvku „{0}“ – typy: {1}; rozšíření: {2}", word, FEATURE_TYPES.join(", "), allExt().map((d) => d.ext).join(", ")));
  const nameAt = pairs.findIndex(([k]) => ["name", "nazev"].includes(fold(k)));
  const name = nameAt >= 0 ? pairs.splice(nameAt, 1)[0][1] : undefined;
  let into: { path: string; kind: "faces" | "edges" } | undefined;
  let rule: Rule = [];
  const pick = (path: string, kind: "faces" | "edges", v: unknown): unknown => {
    const list = Array.isArray(v) ? v : [v];
    if (list.every((x) => typeof x === "number")) return list;
    if (into) throw new Error(tr("pravidlem lze v jednom prvku vybrat jen jednu skupinu ploch nebo hran – ostatní zadejte čísly"));
    into = { path, kind };
    rule = list.map((x) => fold(String(x)));
    return [];
  };
  if (ext) {
    const data: Record<string, unknown> = { ...ext.make({ ...emptyDoc(""), features: [] }) };
    const params = ext.params ?? [];
    for (const [k, raw] of pairs) {
      const fk = fold(k);
      const prm = params.find((x) => fold(x.key) === fk || fold(x.label) === fk);
      const key = prm?.key ?? (k in data || k.includes(".") ? k : undefined);
      if (!key) throw new Error(tr("prvek {0}: neznámý parametr „{1}“ – parametry: {2}", ext.ext, k, [...new Set([...params.map((x) => x.key), ...Object.keys(data)])].join(", ")));
      let v = parseValue(raw);
      if (prm?.kind === "faces" || prm?.kind === "edges") v = pick(`data.${key}`, prm.kind, v);
      else if (prm?.kind === "enum" && typeof v === "string") {
        const opt = prm.options.find((x) => fold(x.v) === fold(v as string) || fold(x.l) === fold(v as string));
        if (!opt) throw new Error(tr("prvek {0}: parametr „{1}“ má hodnoty {2}", ext.ext, key, prm.options.map((x) => x.v).join(" | ")));
        v = opt.v;
      } else if (prm?.kind === "direction" || prm?.kind === "axis") {
        // směr / osa: X | Y | Z | -Z | vektor 1;0;1 | JSON (osa i x | y = osa skici); uloží se nový tvar
        const d = prm.kind === "direction" ? toDirection(v) : toAxisDef(v);
        if (!d) throw new Error(tr("prvek {0}: parametr „{1}“ je {2} – X | Y | Z | -Z | vektor 1;0;1 | JSON", ext.ext, key, prm.kind === "direction" ? tr("směr") : tr("osa")));
        v = d;
      } else if (prm?.kind === "sketches" && !Array.isArray(v)) v = [v];
      else if (prm?.kind === "mode" && typeof v === "string") v = canon(v) === "cut" ? "cut" : canon(v) === "intersect" ? "intersect" : canon(v) === "newbody" ? "new" : "add";
      setAt(data, key, v);
    }
    const n = name ?? `${ext.label}`;
    const feature = { id: uid(), name: n, type: "ext", ext: ext.ext, data } as unknown as Feature;
    return into ? { k: "select", feature, rule, line: no, into } : { k: "feature", feature, line: no };
  }
  const obj: Record<string, unknown> = { type: base, ...(name ? { name } : {}) };
  for (const [k, raw] of pairs) {
    let v = parseValue(raw);
    if ((k === "faces" || k === "edges") && v !== "all") v = pick(k, k, v);
    if (k === "mode" && typeof v === "string") v = canon(v) === "cut" ? "cut" : canon(v) === "intersect" ? "intersect" : canon(v) === "newbody" ? "new" : "add";
    setAt(obj, k, v);
  }
  const { features, errors } = normalizeFeatures([obj]);
  if (errors.length || !features.length) throw new Error(errors[0] ?? tr("prvek se nepodařilo vytvořit"));
  const feature = features[0];
  if (!name) feature.name = named(feature.type);
  return into ? { k: "select", feature, rule, line: no, into } : { k: "feature", feature, line: no };
}

/* ───────────────────────── parser ───────────────────────── */
export function parseAgentText(text: string): AgentProgram {
  const trimmed = text.trim();
  if (!trimmed) return { ops: [], errors: [{ line: 0, text: "", message: tr("Prázdný vstup.") }] };
  // Celý vstup je JSON jen tehdy, když jde jako celek přečíst (dokument, pole prvků, víceřádkový prvek). JSON na PRVNÍM řádku,
  // za kterým následují textové příkazy (`{"type":"sketch",…}` + `vysunout 5`), se zpracuje po řádcích jako každý jiný řádek.
  // Rozepsaný (víceřádkový) JSON s chybou se dál hlásí jako nečitelný JSON – první řádek pak nekončí závorkou.
  if (/^[[{]/.test(trimmed) && (isJson(trimmed) || !/[}\]]$/.test(trimmed.split(/\r?\n/)[0].trim()))) return parseJson(trimmed);
  const ops: AgentOp[] = [];
  const errors: AgentError[] = [];
  const counts: Record<string, number> = {}; // čítače názvů podle typu prvku
  const lines = trimmed.split(/\r?\n/);
  const named = (type: Feature["type"], name?: string) => name ?? `${tr(FEATURE_LABEL[type] ?? type)} ${(counts[type] = (counts[type] ?? 0) + 1)}`;
  /** blok skici (řádek skica + entity, vazby, kóty): jeho řádky patří ke skice bloku; skončí-li blok entitami, skica se pak vyřeší (`end`) */
  let block: { sketch?: SketchTarget; last?: Extract<AgentOp, { k: "entities" }> } | null = null;
  const endBlock = () => {
    if (block?.last) block.last.end = true;
    block = null;
  };
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\s+(#|\/\/).*$/, "").trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) return;
    const no = idx + 1;
    try {
      // JSON na jednom řádku (jeden prvek, pole prvků) lze míchat s textovými příkazy – např. prvek rozšíření bez textového příkazu
      if (/^[[{]/.test(line)) {
        endBlock();
        const sub = parseJson(line);
        for (const op of sub.ops) ops.push({ ...op, line: no });
        for (const e of sub.errors) errors.push({ line: no, text: line.slice(0, 80), message: e.message });
        return;
      }
      // skica: `skica XY [odsazení 5]: kružnice 165; obdélník 60 40`
      const colon = line.indexOf(":");
      const headTokens = tokenize(colon >= 0 ? line.slice(0, colon) : line);
      const cmd = canon(headTokens[0] ?? "");
      const isEntity = ENTITY.has(cmd) || (cmd === "construction" && ENTITY.has(canon(headTokens[1] ?? "")));
      if (cmd === "sketch" || (cmd !== "constraint" && cmd !== "dim" && !isEntity)) endBlock();
      if (cmd === "sketch") {
        // id doplní založená skica; nepovede-li se řádek přečíst, entity bloku ohlásí, že skica nevznikla (nepřidají se do jiné skici)
        const blk: NonNullable<typeof block> & { sketch: SketchTarget } = (block = { sketch: { id: "", line: no } });
        const o = parseOpts(headTokens.slice(1));
        const on = sketchOnSpec(headTokens.slice(1), o);
        const planeWord = o.strings.map(fold).find((w) => PLANES[w]);
        const plane: PlaneName = planeWord ? PLANES[planeWord] : "XY";
        const f: Feature = { id: uid(), name: named("sketch", o.words.name?.join(" ")), type: "sketch", plane: { kind: "base", name: plane, offset: o.nums.offset?.[0] ?? 0 }, entities: [] };
        // obecná rovina: `skica počátek x y z normála nx ny nz [osax ux uy uz]` – osa X skici se bez zadání zvolí kolmo na normálu
        if (o.nums.normal?.length) {
          if (o.nums.normal.length < 3) throw new Error(tr("skica v obecné rovině potřebuje normálu třemi čísly: skica počátek x y z normála nx ny nz [osax ux uy uz]"));
          const n = unit([o.nums.normal[0], o.nums.normal[1], o.nums.normal[2]]);
          const og = o.nums.origin ?? [];
          const xr = o.nums.xdir && o.nums.xdir.length >= 3 ? ([o.nums.xdir[0], o.nums.xdir[1], o.nums.xdir[2]] as Vec3) : Math.abs(n[0]) < 0.9 ? ([1, 0, 0] as Vec3) : ([0, 1, 0] as Vec3);
          const d = xr[0] * n[0] + xr[1] * n[1] + xr[2] * n[2];
          const x = unit([xr[0] - d * n[0], xr[1] - d * n[1], xr[2] - d * n[2]]);
          f.plane = { kind: "custom", origin: [og[0] ?? 0, og[1] ?? 0, og[2] ?? 0], normal: n.map(r6) as Vec3, xDir: x.map(r6) as Vec3 };
        }
        blk.sketch.id = f.id;
        ops.push(on ? { k: "sketchOn", feature: f, ...on, line: no } : { k: "feature", feature: f, line: no });
        if (colon >= 0) {
          const ents = line
            .slice(colon + 1)
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean)
            .flatMap((s) => parseEntities(tokenize(s)));
          const op: Extract<AgentOp, { k: "entities" }> = { k: "entities", entities: ents, line: no, sketch: blk.sketch };
          ops.push(op);
          blk.last = op;
        }
        return;
      }
      if (isEntity) {
        const blk = (block ??= {});
        const ents = line
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean)
          .flatMap((s) => parseEntities(tokenize(s)));
        const op: Extract<AgentOp, { k: "entities" }> = { k: "entities", entities: ents, line: no, ...(blk.sketch ? { sketch: blk.sketch } : {}) };
        ops.push(op);
        blk.last = op;
        return;
      }
      // vazby a kóty ve skice bloku (jinak v poslední skice): `vazba kolmo e1 e2; …`, `kóta délka e1 50; …` – po řádku se skica vyřeší
      if (cmd === "constraint" || cmd === "dim") {
        const blk = (block ??= {});
        const rest = line.replace(/^\s*\S+/, "");
        const target = blk.sketch ? { sketch: blk.sketch } : {};
        ops.push(cmd === "constraint" ? { k: "constraints", items: parseConstraints(rest), line: no, ...target } : { k: "dims", items: parseDims(rest), line: no, ...target });
        blk.last = undefined;
        return;
      }
      if (cmd === "feature") {
        ops.push(parseGenericFeature(line.replace(/^\s*\S+/, ""), named, no));
        return;
      }
      const tokens = tokenize(line).slice(1);
      const o = parseOpts(tokens);
      const nm = o.words.name?.join(" ");
      // `… těleso 2` za prvkem = cílové těleso prvku; s „nové“ je to název nově založeného tělesa
      const targetBody = cmd !== "body" && cmd !== "copybody" && cmd !== "combine" && cmd !== "add" && o.words.body?.length ? bodyName(o.words.body) : "";
      const before = ops.length;
      try {
      switch (cmd) {
        case "new": {
          const what = canon(tokens[0] ?? "part");
          const name = tokens.slice(1).join(" ").trim();
          ops.push({ k: "new", name: name || (what === "assembly" ? tr("Nová sestava") : tr("Nový díl")), assembly: what === "assembly", line: no });
          return;
        }
        case "name":
          ops.push({ k: "meta", patch: { name: tokens.join(" ") }, line: no });
          return;
        case "material": {
          // známá třída (hustota) → material; cokoli jiného (ČSN 11 423, 1.0503, EN AW-6082) = označení do razítka
          const q = tokens.join(" ").trim();
          const known = MATERIALS.find((x) => fold(x.id) === fold(q) || fold(x.label) === fold(q) || MATERIAL_ALIASES[fold(q)] === x.id);
          ops.push({ k: "meta", patch: known ? { material: known.id } : { materialName: q }, line: no });
          return;
        }
        case "color":
          ops.push({ k: "meta", patch: { color: tokens[0] }, line: no });
          return;
        case "box": {
          const [x, y, z] = o.free;
          if (!(x > 0 && y > 0 && z > 0)) throw new Error(tr("kvádr potřebuje tři kladné rozměry: kvádr X Y Z"));
          ops.push({ k: "feature", feature: { id: uid(), name: named("box", nm), type: "box", size: [x, y, z], position: posOf(o) ?? [0, 0, 0], centered: o.flags.has("center"), mode: modeOf(o) }, line: no });
          return;
        }
        case "cylinder": {
          const [d, h] = o.free;
          if (!(d > 0 && h > 0)) throw new Error(tr("válec potřebuje průměr a výšku: válec D H"));
          ops.push({ k: "feature", feature: { id: uid(), name: named("cylinder", nm), type: "cylinder", radius: d / 2, height: h, position: posOf(o) ?? [0, 0, 0], axis: axisOf(o), mode: modeOf(o) }, line: no });
          return;
        }
        case "sphere": {
          const [d] = o.free;
          if (!(d > 0)) throw new Error(tr("koule potřebuje průměr: koule D"));
          ops.push({ k: "feature", feature: { id: uid(), name: named("sphere", nm), type: "sphere", radius: d / 2, position: posOf(o) ?? [0, 0, 0], mode: modeOf(o) }, line: no });
          return;
        }
        case "cone": {
          const [d1, d2, h] = o.free;
          if (!(d1 > 0 && d2 >= 0 && h > 0)) throw new Error(tr("kužel potřebuje dolní průměr, horní průměr a výšku: kužel D1 D2 H"));
          ops.push({ k: "feature", feature: { id: uid(), name: named("cone", nm), type: "cone", radius1: d1 / 2, radius2: d2 / 2, height: h, position: posOf(o) ?? [0, 0, 0], axis: axisOf(o), mode: modeOf(o) }, line: no });
          return;
        }
        case "tube": {
          const [D, d, h] = o.free;
          if (!(D > 0 && d >= 0 && D > d && h > 0)) throw new Error(tr("trubka potřebuje vnější průměr, vnitřní průměr a výšku: trubka D d H"));
          ops.push({ k: "feature", feature: { id: uid(), name: named("tube", nm), type: "tube", outer: D, inner: d, height: h, position: posOf(o) ?? [0, 0, 0], axis: axisOf(o), mode: modeOf(o) }, line: no });
          return;
        }
        case "extrude": {
          const d = o.free[0] ?? o.nums.height?.[0] ?? o.nums.depth?.[0];
          const through = o.flags.has("through");
          if (!through && !(d > 0)) throw new Error(tr("vysunout potřebuje výšku: vysunout 20 [symetricky] [odebrat] [skrz]"));
          const f: Feature = { id: uid(), name: named("extrude", nm), type: "extrude", sketchId: "$last", distance: through ? 1 : d, symmetric: o.flags.has("symmetric"), reverse: o.flags.has("reverse"), mode: o.flags.has("cut") || o.flags.has("intersect") || o.flags.has("newbody") || o.flags.has("add") ? modeOf(o) : "$auto" as unknown as "add" };
          if (through) f.extent = { kind: "throughAll" };
          if (o.nums.draft?.[0]) f.draftAngle = o.nums.draft[0];
          ops.push({ k: "feature", feature: f, line: no });
          return;
        }
        case "revolve": {
          const ang = o.free[0] ?? o.nums.angle?.[0] ?? 360;
          const ax = fold(o.words.axis?.[0] ?? "");
          const f: Feature = { id: uid(), name: named("revolve", nm), type: "revolve", sketchId: "$last", angle: ang, axis: ax === "x" || ax === "sketchx" ? "x" : "y", mode: o.flags.has("cut") || o.flags.has("intersect") || o.flags.has("newbody") || o.flags.has("add") ? modeOf(o) : "$auto" as unknown as "add" };
          if (ax === "x" || ax === "y" || ax === "z") f.axisDef = { kind: "global", axis: AXES[ax] };
          ops.push({ k: "feature", feature: f, line: no });
          return;
        }
        case "hole": {
          const d = o.free[0] ?? o.nums.diameter?.[0];
          if (!(d > 0)) throw new Error(tr("díra potřebuje průměr: díra 8,5 [hloubka 20 | skrz] v X Y [Z]"));
          const at = o.nums.at ?? [];
          const axis = axisOf(o);
          // více děr jedním příkazem: `v x1 y1 z1 v x2 y2 z2 …` (trojice souřadnic)
          const many = at.length >= 6 && at.length % 3 === 0;
          if (at.length > 3 && !many) throw new Error(tr("více děr jedním příkazem potřebuje u každé polohy tři souřadnice: díra 8 skrz v x1 y1 z1 v x2 y2 z2"));
          const fillTop = at.length < 3;
          const position: Vec3 = [at[0] ?? 0, at[1] ?? 0, at[2] ?? 0];
          // „k tělesu“ (EN „to body“, DE „bis Körper“) = po první stěnu stávajícího tělesa ve směru vrtání (jako u vysunutí)
          const toBody = hasPhrase(tokens, TO_BODY);
          const f: Feature = { id: uid(), name: named("hole", nm), type: "hole", position, axis, flip: o.flags.has("reverse"), diameter: d, depth: o.flags.has("through") || toBody ? 0 : (o.nums.depth?.[0] ?? 0), cbDiameter: o.nums.counterbore?.[0] ?? 0, cbDepth: o.nums.counterbore?.[1] ?? 0 };
          if (toBody) f.end = { kind: "toBody" };
          // „skrz“ vrtá od zadaného bodu jen ve směru vrtání; „obousměrně“ = skrz celé těleso na obě strany od bodu
          else if (o.flags.has("bothways") || o.flags.has("symmetric")) f.bothWays = true;
          if (many) {
            f.points = [];
            for (let j = 0; j < at.length; j += 3) f.points.push({ kind: "xyz", p: [at[j], at[j + 1], at[j + 2]] });
          }
          // šikmá díra: `směr vx vy vz` = směr vrtání; `sklon úhel [směr +X]` = odklon od osy díry (výchozí k další ose: Z→X, X→Y, Y→Z)
          const dv = dirOf(o.words.direction);
          const tiltDeg = o.nums.tilt?.[0];
          if (tiltDeg !== undefined) {
            const ax: Vec3 = axis === "X" ? [1, 0, 0] : axis === "Y" ? [0, 1, 0] : [0, 0, 1];
            const toward = unit(dv ?? (axis === "X" ? [0, 1, 0] : axis === "Y" ? [0, 0, 1] : [1, 0, 0]));
            const a = (tiltDeg * Math.PI) / 180;
            const down = o.flags.has("reverse") ? 1 : -1; // výchozí vrtání proti ose (shora dolů)
            f.dirDef = { kind: "vector", v: [0, 1, 2].map((i) => r6(down * ax[i] * Math.cos(a) + toward[i] * Math.sin(a))) as Vec3 };
            f.flip = true;
          } else if (dv) {
            f.dirDef = { kind: "vector", v: unit(dv).map(r6) as Vec3 };
            f.flip = !o.flags.has("reverse");
          }
          if (o.nums.counterbore?.length) f.kind = "counterbore";
          if (o.nums.countersink?.length) {
            f.kind = "countersink";
            f.csDiameter = o.nums.countersink[0];
            f.csAngle = o.nums.countersink[1] ?? 90;
          }
          if (o.words.thread?.[0]) {
            const t = threadByName(o.words.thread[0]);
            if (!t) throw new Error(tr("neznámý závit „{0}“ – M2 až M48, hrubé nebo jemné stoupání (M18×1,5)", o.words.thread[0]));
            f.kind = "tapped";
            f.thread = t.name;
            f.diameter = t.tap;
            if (o.nums.threaddepth?.[0]) f.threadDepth = o.nums.threaddepth[0];
          }
          ops.push({ k: "feature", feature: f, line: no, fillTop });
          return;
        }
        case "fillet":
        case "chamfer": {
          const v = o.free[0] ?? o.nums.radius?.[0];
          if (!(v > 0)) throw new Error(cmd === "fillet" ? tr("zaoblit potřebuje poloměr: zaoblit 2 [hrany svislé]") : tr("srazit potřebuje velikost: srazit 1 [hrany horní]"));
          const rule = (o.words.edges ?? []).map(fold).concat(numRule(o));
          const feature: Feature = cmd === "fillet" ? { id: uid(), name: named("fillet", nm), type: "fillet", radius: v, edges: "all" } : { id: uid(), name: named("chamfer", nm), type: "chamfer", distance: v, edges: "all" };
          if (!rule.length || rule.includes("vse") || rule.includes("all")) ops.push({ k: "feature", feature, line: no });
          else ops.push({ k: "select", feature, rule, line: no });
          return;
        }
        case "thread": {
          // závit M18×1,5 délka 20 [v x y z] [osa Z] [vnitřní] [modelovat]
          const des = (o.strings.find((w) => /^m\d/i.test(w)) ?? o.words.thread?.[0] ?? "").replace(/,/g, ".");
          const t = threadByName(des);
          if (!t) throw new Error(tr("závit potřebuje označení M2 až M48 (hrubé nebo jemné stoupání, např. M18×1,5): závit M18×1,5 délka 20 v 0 0 10 [osa Z] [vnitřní] [modelovat]{0}", des ? ` – „${des}“ není metrický závit` : ""));
          const L = o.nums.length?.[0] ?? o.free[0];
          if (!(L > 0)) throw new Error(tr("závit potřebuje délku: závit M18×1,5 délka 20"));
          const f: Feature = { id: uid(), name: named("thread", nm), type: "thread", designation: t.name, position: posOf(o) ?? [0, 0, 0], axis: axisOf(o), length: L, modeled: o.flags.has("modeled") };
          if (o.flags.has("internal")) f.internal = true;
          ops.push({ k: "feature", feature: f, line: no });
          return;
        }
        case "shell": {
          const t = o.free[0];
          if (!(t > 0)) throw new Error(tr("skořepina potřebuje tloušťku: skořepina 2 [otevřít +Z]"));
          const rule = (o.words.open ?? []).map(fold);
          const feature: Feature = { id: uid(), name: named("shell", nm), type: "shell", thickness: t, faces: [] };
          if (rule.length) ops.push({ k: "select", feature, rule, line: no });
          else ops.push({ k: "feature", feature, line: no });
          return;
        }
        case "pattern": {
          const isCirc = o.flags.has("circular");
          if (isCirc) {
            const count = o.free[0] ?? o.nums.count?.[0];
            if (!(count >= 2)) throw new Error(tr("pole kruhové potřebuje počet: pole kruhové 6 [úhel 360] [osa Z]"));
            const c = o.nums.at ?? [0, 0, 0];
            ops.push({ k: "feature", feature: { id: uid(), name: named("pattern", nm), type: "pattern", featureId: "$last", kind: "circular", count, angle: o.nums.angle?.[0] ?? 360, axis: axisOf(o), center: [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0] }, line: no });
            return;
          }
          const counts = o.nums.count ?? [];
          const count = o.free[0] ?? counts[0];
          const sp = o.nums.spacing ?? [];
          if (!(count >= 2) || !(sp[0] > 0)) throw new Error(tr("pole potřebuje počet a rozteč: pole 4 rozteč 25 [směr X] [počet 3 rozteč 20 směr Y]"));
          const dirs = o.words.direction ?? [];
          const dirList: Vec3[] = [];
          for (let j = 0; j < dirs.length; ) {
            if (isNum(dirs[j]) && j + 2 < dirs.length) {
              dirList.push([num(dirs[j]), num(dirs[j + 1]), num(dirs[j + 2])]);
              j += 3;
            } else {
              const v = dirOf([dirs[j]]);
              if (v) dirList.push(v);
              j++;
            }
          }
          const f: Feature = { id: uid(), name: named("pattern", nm), type: "pattern", featureId: "$last", kind: "linear", count, spacing: sp[0], direction: dirList[0] ?? [1, 0, 0] };
          const count2 = o.free[1] ?? counts[1];
          if (count2 >= 2 && sp[1] > 0) {
            f.count2 = count2;
            f.spacing2 = sp[1];
            f.direction2 = dirList[1] ?? [0, 1, 0];
          }
          ops.push({ k: "feature", feature: f, line: no });
          return;
        }
        case "mirror": {
          const planeWord = o.strings.map(fold).find((w) => PLANES[w]);
          ops.push({ k: "feature", feature: { id: uid(), name: named("mirror", nm), type: "mirror", plane: planeWord ? PLANES[planeWord] : "YZ", offset: o.nums.offset?.[0] ?? 0, keepOriginal: true }, line: no });
          return;
        }
        case "text": {
          const str = o.strings[0];
          if (!str) throw new Error(tr("text potřebuje nápis v uvozovkách: text \"ABC\" výška 10 hloubka 1 v X Y [Z]"));
          const at = o.nums.at ?? [];
          const planeWord = o.strings.slice(1).map(fold).find((w) => PLANES[w]);
          ops.push({ k: "feature", feature: { id: uid(), name: named("text", nm), type: "text", text: str, height: o.nums.height?.[0] ?? o.free[0] ?? 10, depth: o.nums.depth?.[0] ?? o.free[1] ?? 1, plane: { kind: "base", name: planeWord ? PLANES[planeWord] : "XY", offset: at[2] ?? 0 }, position: [at[0] ?? 0, at[1] ?? 0], angle: o.nums.angle?.[0] ?? 0, mode: o.flags.has("engrave") || o.flags.has("cut") ? "cut" : "add" }, line: no, fillTop: at.length < 3 });
          return;
        }
        case "body": {
          const name = bodyName(tokens.filter((t) => canon(t) !== "body"));
          if (!name) throw new Error(tr("těleso potřebuje název nebo číslo: těleso 2 (= „Těleso 2“) – další prvky pak pracují s ním"));
          ops.push({ k: "body", name, line: no });
          return;
        }
        case "splitbodies": {
          // rozdělit [tělesa] XY|XZ|YZ [odsazení N] [těleso Zdroj] [jako Název]
          const planeWord = o.strings.map(fold).find((w) => PLANES[w]);
          const f: Feature = { id: uid(), name: named("splitBodies", nm), type: "splitBodies", plane: planeWord ? PLANES[planeWord] : "XY", offset: o.nums.offset?.[0] ?? o.free[0] ?? 0 };
          if (o.words.as?.length) f.nameB = bodyName(o.words.as);
          ops.push({ k: "feature", feature: f, line: no });
          return;
        }
        case "copybody": {
          // kopie [těleso Zdroj] [posun dx dy dz] [jako Název]
          const t = o.nums.offset ?? o.nums.at ?? [];
          const f: Feature = { id: uid(), name: named("copyBody", nm), type: "copyBody", source: o.words.body?.length ? bodyName(o.words.body) : "", translate: [t[0] ?? 0, t[1] ?? 0, t[2] ?? 0] };
          if (o.words.as?.length) f.newName = bodyName(o.words.as);
          ops.push({ k: "feature", feature: f, line: no });
          return;
        }
        case "add":
        case "combine": {
          // sloučit <cíl> <nástroj> [odebrat|průnik] [ponechat] – tělesa číslem (2 = „Těleso 2“) nebo názvem v uvozovkách
          const names: string[] = [];
          const flags = new Set<string>();
          for (const t of tokens) {
            const c = canon(t);
            if (c === "body") continue;
            if (c === "cut" || c === "intersect" || c === "add" || c === "keep") flags.add(c);
            else names.push(bodyName([t]));
          }
          if (names.length !== 2) throw new Error(tr("sloučit potřebuje dvě tělesa: sloučit <cíl> <nástroj> [odebrat|průnik] [ponechat] – např. sloučit 1 2 odebrat"));
          ops.push({ k: "feature", feature: { id: uid(), name: named("combine", nm), type: "combine", target: names[0], tool: names[1], op: flags.has("cut") ? "cut" : flags.has("intersect") ? "intersect" : "add", keepTool: flags.has("keep") }, line: no });
          return;
        }
        case "library": {
          // normálie M8x30 [v x y z] – text za příkazem jde do hledání knihovny
          const i = tokens.findIndex((t) => canon(t) === "at");
          const query = (i >= 0 ? tokens.slice(0, i) : tokens).join(" ").trim();
          if (!query) throw new Error(tr("normálie potřebuje označení: normálie M8x30 · normálie ložisko 6204 · normálie pero 8x7x40"));
          const p = posOf(o);
          ops.push({ k: "library", query, ...(p ? { at: p } : {}), line: no });
          return;
        }
        case "insert": {
          // sestava: vložit "Název záložky" [v x y z] [otočení rx ry rz] [ukotvit]
          const name = o.strings.join(" ").trim();
          if (!name) throw new Error(tr("vložit potřebuje název otevřené záložky s dílem: vložit \"Hřídel\" v 0 0 10 [otočení 0 90 0] [ukotvit]"));
          const rt = o.nums.rotation ?? [];
          ops.push({ k: "insert", tab: name, at: posOf(o) ?? [0, 0, 0], rotation: [rt[0] ?? 0, rt[1] ?? 0, rt[2] ?? 0], fixed: o.flags.has("fixed"), line: no });
          return;
        }
        case "drawing": {
          const cmd = parseDrawing(tokens);
          ops.push(cmd ? { k: "drawingCmd", cmd, line: no } : { k: "drawing", line: no });
          return;
        }
        case "dimension":
          ops.push({ k: "drawingCmd", cmd: parseDimension(tokens), line: no });
          return;
        case "undo":
          ops.push({ k: "pop", line: no });
          return;
        case "status":
          ops.push({ k: "status", line: no });
          return;
        case "clash":
          ops.push({ k: "clash", line: no });
          return;
        case "view": {
          const v = VIEWS[fold(tokens[0] ?? "iso")];
          if (!v) throw new Error(tr("pohled: iso, přední, zadní, horní, spodní, levý, pravý"));
          ops.push({ k: "view", view: v, line: no });
          return;
        }
        default:
          throw new Error(tr("neznámý příkaz „{0}“ – příkazy: {1}", headTokens[0], commandWords().join(", ")));
      }
      } finally {
        // „nové“ bez názvu = nové těleso s dalším volným názvem (doplní aplikace); u prvního tělesa dílu se nic nemění
        const body = targetBody || (o.flags.has("newbody") ? "$new" : "");
        if (body) for (const op of ops.slice(before)) if ((op.k === "feature" || op.k === "select") && !op.feature.body) op.feature.body = body;
      }
    } catch (e) {
      errors.push({ line: no, text: line, message: (e as Error).message });
    }
  });
  endBlock();
  return { ops, errors };
}

/** víceslovná volba ukončení díry „k tělesu“ (slova se jinak čtou jednotlivě – „body“ / „Körper“ je volba tělesa) */
const TO_BODY = [["k", "telesu"], ["ke", "telesu"], ["to", "body"], ["tobody"], ["bis", "korper"], ["bis", "koerper"], ["bis", "zum", "korper"], ["bis", "zum", "koerper"]];
const hasPhrase = (tokens: string[], phrases: string[][]) => {
  const w = tokens.map(fold);
  return phrases.some((p) => w.some((_, i) => p.every((x, k) => w[i + k] === x)));
};

const numRule = (o: Opts): string[] => {
  const r: string[] = [];
  if (o.nums.radius?.length) r.push(`r=${o.nums.radius[0]}`);
  if (o.nums.longer?.length) r.push(`len>${o.nums.longer[0]}`);
  if (o.nums.shorter?.length) r.push(`len<${o.nums.shorter[0]}`);
  return r;
};

const ENTITY = new Set(["rect", "circle", "polygon", "slot", "line", "polyline", "point", "ellipse", "arc", "spline"]);

/**
 * Entity skici z jednoho zápisu. Většinou jedna; lomená čára se zaoblenými rohy (`čára 0 0 50 0 r 5 50 30 0 30 uzavřít` –
 * „r N“ za bodem zaoblí tento roh) se rozloží na úsečky a oblouky.
 */
export function parseEntities(tokens: string[]): SketchEntity[] {
  let construction = false;
  let tk = tokens;
  if (canon(tk[0] ?? "") === "construction") {
    construction = true;
    tk = tk.slice(1);
  }
  if (canon(tk[0] ?? "") !== "polyline" || !tk.some((t) => canon(t) === "radius" || canon(t) === "fillet")) return [parseEntity(tokens)];
  const pts: Vec2[] = [];
  const radii: number[] = [];
  let closed = false;
  const nums: number[] = [];
  const flush = () => {
    if (nums.length % 2) throw new Error(tr("čára potřebuje body po dvojicích: čára x1 y1 x2 y2 x3 y3 … [uzavřít]"));
    for (let i = 0; i < nums.length; i += 2) {
      pts.push([nums[i], nums[i + 1]]);
      radii.push(0);
    }
    nums.length = 0;
  };
  for (let i = 1; i < tk.length; i++) {
    const c = canon(tk[i]);
    if (c === "radius" || c === "fillet") {
      flush();
      const v = tk[i + 1];
      if (!pts.length || v === undefined || !isNum(v) || !(num(v) > 0)) throw new Error(tr("zaoblení rohu se píše za bod: čára 0 0 50 0 r 5 50 30 … (r 5 zaoblí roh v bodě 50 0)"));
      radii[pts.length - 1] = num(v);
      i++;
    } else if (c === "closed") closed = true;
    else if (isNum(tk[i])) nums.push(num(tk[i]));
    else throw new Error(tr("čára: neznámé slovo „{0}“ – body po dvojicích, „r N“ za bodem zaoblí roh, „uzavřít“ spojí konec se začátkem", tk[i]));
  }
  flush();
  if (pts.length >= 3 && !closed && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-9) {
    pts.pop();
    radii.pop();
    closed = true;
  }
  if (pts.length < 3) throw new Error(tr("zaoblení rohu potřebuje aspoň tři body čáry"));
  const n = pts.length;
  const base = () => ({ id: uid(), ...(construction ? { construction: true } : {}) });
  // tečné body a střed oblouku pro každý zaoblený roh
  const cut: ({ a: Vec2; m: Vec2; b: Vec2; t: number } | null)[] = pts.map((p, i) => {
    const rad = radii[i];
    if (!rad) return null;
    if (!closed && (i === 0 || i === n - 1)) throw new Error(tr("krajní bod otevřené čáry zaoblit nelze (bod {0})", i + 1));
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const u1: Vec2 = [prev[0] - p[0], prev[1] - p[1]];
    const u2: Vec2 = [next[0] - p[0], next[1] - p[1]];
    const l1 = Math.hypot(u1[0], u1[1]);
    const l2 = Math.hypot(u2[0], u2[1]);
    const cos = (u1[0] * u2[0] + u1[1] * u2[1]) / (l1 * l2);
    const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (!(ang > 1e-6 && ang < Math.PI - 1e-6)) throw new Error(tr("roh v bodě {0} je přímý – není co zaoblit", i + 1));
    const t = rad / Math.tan(ang / 2);
    const a: Vec2 = [p[0] + (u1[0] / l1) * t, p[1] + (u1[1] / l1) * t];
    const b: Vec2 = [p[0] + (u2[0] / l2) * t, p[1] + (u2[1] / l2) * t];
    const bis: Vec2 = [u1[0] / l1 + u2[0] / l2, u1[1] / l1 + u2[1] / l2];
    const bl = Math.hypot(bis[0], bis[1]);
    const dist = rad / Math.sin(ang / 2) - rad; // vzdálenost vrcholu od středu oblouku na ose úhlu
    return { a, b, m: [p[0] + (bis[0] / bl) * dist, p[1] + (bis[1] / bl) * dist], t };
  });
  const out: SketchEntity[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    const len = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
    if ((cut[i]?.t ?? 0) + (cut[j]?.t ?? 0) > len + 1e-9) throw new Error(tr("zaoblení se nevejde na úsek mezi body {0} a {1} (délka {2}) – zmenšete poloměr", i + 1, j + 1, r6(len)));
    const from = cut[i]?.b ?? pts[i];
    const to = cut[j]?.a ?? pts[j];
    if (Math.hypot(to[0] - from[0], to[1] - from[1]) > 1e-9) out.push({ ...base(), type: "line", a: [r6(from[0]), r6(from[1])], b: [r6(to[0]), r6(to[1])] });
    const c = cut[j];
    if (c && (closed || j < n - 1)) out.push({ ...base(), type: "arc", a: [r6(c.a[0]), r6(c.a[1])], b: [r6(c.m[0]), r6(c.m[1])], c: [r6(c.b[0]), r6(c.b[1])] });
  }
  return out;
}
/** entita skici z tokenů: `kružnice 165 [v 10 20]`, `obdélník 60 40 [střed] [v x y] [r 3]`, `čára x1 y1 x2 y2 … [uzavřít]` */
export function parseEntity(tokens: string[]): SketchEntity {
  let construction = false;
  if (canon(tokens[0]) === "construction") {
    construction = true;
    tokens = tokens.slice(1);
  }
  const t = canon(tokens[0] ?? "");
  const o = parseOpts(tokens.slice(1));
  const at = o.nums.at ?? [];
  const cx = at[0] ?? 0;
  const cy = at[1] ?? 0;
  const base = { id: uid(), ...(construction ? { construction: true } : {}) };
  switch (t) {
    case "rect": {
      const [w, h = w] = o.free;
      if (!(w > 0 && h > 0)) throw new Error(tr("obdélník potřebuje šířku a výšku: obdélník 60 40 [v x y] (střed) nebo roh x y"));
      const corner = o.nums.corner;
      return { ...base, type: "rect", cx: corner ? corner[0] + w / 2 : cx, cy: corner ? corner[1] + h / 2 : cy, w, h, r: o.nums["rect-r"]?.[0] ?? 0, angle: o.nums.angle?.[0] ?? 0 };
    }
    case "circle": {
      const d = o.free[0] ?? o.nums.diameter?.[0];
      const r = o.nums.radius?.[0] ?? (d > 0 ? d / 2 : NaN);
      if (!(r > 0)) throw new Error(tr("kružnice potřebuje průměr: kružnice 165 [v x y] (nebo poloměr 82,5)"));
      return { ...base, type: "circle", cx, cy, r };
    }
    case "polygon": {
      const sides = o.nums.sides?.[0] ?? o.free[0];
      const d = o.free[1] ?? o.nums.diameter?.[0];
      const r = o.nums.radius?.[0] ?? (d > 0 ? d / 2 : NaN);
      if (!(sides >= 3 && r > 0)) throw new Error(tr("mnohoúhelník potřebuje počet stran a průměr opsané kružnice: mnohoúhelník 6 30 [v x y]"));
      return { ...base, type: "polygon", cx, cy, r, sides, angle: o.nums.angle?.[0] ?? 0 };
    }
    case "slot": {
      const [length, width] = o.free;
      if (!(length > 0 && width > 0)) throw new Error(tr("drážka potřebuje délku a šířku: drážka 40 10 [v x y] [úhel 0]"));
      return { ...base, type: "slot", cx, cy, length, width, angle: o.nums.angle?.[0] ?? 0 };
    }
    case "line": {
      const [x1, y1, x2, y2] = o.free;
      if (o.free.length < 4) throw new Error(tr("úsečka potřebuje dva body: úsečka x1 y1 x2 y2"));
      return { ...base, type: "line", a: [x1, y1], b: [x2, y2] };
    }
    case "polyline": {
      if (o.free.length < 4 || o.free.length % 2) throw new Error(tr("čára potřebuje body po dvojicích: čára x1 y1 x2 y2 x3 y3 … [uzavřít]"));
      const points: [number, number][] = [];
      for (let i = 0; i < o.free.length; i += 2) points.push([o.free[i], o.free[i + 1]]);
      return { ...base, type: "polyline", points, closed: o.flags.has("closed") || points.length >= 3 };
    }
    case "arc": {
      // oblouk třemi body: začátek, bod na oblouku, konec
      if (o.free.length !== 6) throw new Error(tr("oblouk potřebuje tři body (začátek, bod na oblouku, konec): oblouk x1 y1 xm ym x2 y2"));
      const [x1, y1, xm, ym, x2, y2] = o.free;
      if (Math.abs((xm - x1) * (y2 - y1) - (ym - y1) * (x2 - x1)) < 1e-9) throw new Error(tr("tři body oblouku leží v přímce – použijte úsečku"));
      return { ...base, type: "arc", a: [x1, y1], b: [xm, ym], c: [x2, y2] };
    }
    case "spline": {
      if (o.free.length < 4 || o.free.length % 2) throw new Error(tr("spline potřebuje aspoň dva body po dvojicích: spline x1 y1 x2 y2 x3 y3 … [uzavřít]"));
      const points: [number, number][] = [];
      for (let i = 0; i < o.free.length; i += 2) points.push([o.free[i], o.free[i + 1]]);
      return { ...base, type: "spline", points, closed: o.flags.has("closed") };
    }
    case "point":
      return { ...base, type: "point", p: [o.free[0] ?? cx, o.free[1] ?? cy] };
    case "ellipse": {
      const [rx, ry] = o.free;
      if (!(rx > 0 && ry > 0)) throw new Error(tr("elipsa potřebuje dvě poloosy: elipsa 30 20 [v x y]"));
      return { ...base, type: "ellipse", cx, cy, rx, ry, angle: o.nums.angle?.[0] ?? 0 };
    }
    default:
      throw new Error(tr("neznámá entita skici „{0}“ – obdélník, kružnice, mnohoúhelník, drážka, úsečka, čára, oblouk, spline, bod, elipsa", tokens[0]));
  }
}

/* ───────────────────────── JSON ───────────────────────── */
function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function parseJson(text: string): AgentProgram {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return { ops: [], errors: [{ line: 1, text: text.slice(0, 60), message: tr("JSON nelze přečíst: {0}", (e as Error).message) }] };
  }
  if (v && typeof v === "object" && !Array.isArray(v) && (v as { app?: string }).app === "mnastrojarna-cad") {
    const d = v as CadDoc;
    const { features, errors } = normalizeFeatures(Array.isArray(d.features) ? d.features : []);
    const doc: CadDoc = { ...emptyDoc(d.name || tr("Díl z JSON")), ...d, app: "mnastrojarna-cad", version: 2, features };
    return { ops: [{ k: "doc", doc, line: 1 }], errors: errors.map((m) => ({ line: 1, text: "", message: m })) };
  }
  const arr = Array.isArray(v) ? v : [v];
  const { features, errors } = normalizeFeatures(arr);
  return { ops: features.length ? [{ k: "features", features, line: 1 }] : [], errors: errors.map((m) => ({ line: 1, text: "", message: m })) };
}

/** Doplní id/název, ověří typ a základní povinná pole; vrací chyby pro neznámé/nevalidní prvky. */
export function normalizeFeatures(input: unknown[]): { features: Feature[]; errors: string[] } {
  const features: Feature[] = [];
  const errors: string[] = [];
  const ids = new Set<string>();
  const counts: Record<string, number> = {};
  input.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") return void errors.push(tr("Prvek {0}: není objekt.", i + 1));
    const f = { ...(raw as Record<string, unknown>) };
    const type = String(f.type ?? "");
    if (!(FEATURE_TYPES as readonly string[]).includes(type)) return void errors.push(tr("Prvek {0}: neznámý typ „{1}“. Povolené: {2}.", i + 1, type, FEATURE_TYPES.join(", ")));
    if (typeof f.id !== "string" || !f.id || ids.has(f.id)) f.id = uid();
    ids.add(f.id as string);
    counts[type] = (counts[type] ?? 0) + 1;
    if (typeof f.name !== "string" || !f.name) f.name = `${tr(FEATURE_LABEL[type])} ${counts[type]}`;
    const dflt: Record<string, Record<string, unknown>> = {
      box: { position: [0, 0, 0], centered: false, mode: "add" },
      cylinder: { position: [0, 0, 0], axis: "Z", mode: "add" },
      sphere: { position: [0, 0, 0], mode: "add" },
      cone: { position: [0, 0, 0], axis: "Z", mode: "add" },
      tube: { position: [0, 0, 0], axis: "Z", mode: "add" },
      hole: { axis: "Z", flip: false, depth: 0, cbDiameter: 0, cbDepth: 0 },
      extrude: { symmetric: false, reverse: false, mode: "add" },
      revolve: { angle: 360, axis: "y", mode: "add" },
      fillet: { edges: "all" },
      chamfer: { edges: "all" },
      shell: { faces: [] },
      mirror: { offset: 0, keepOriginal: true, plane: "YZ" },
      sketch: { plane: { kind: "base", name: "XY", offset: 0 }, entities: [] },
      text: { angle: 0, mode: "add", position: [0, 0], depth: 1, height: 10, plane: { kind: "base", name: "XY", offset: 0 } },
      pattern: { kind: "linear" },
    };
    for (const [k, v] of Object.entries(dflt[type] ?? {})) if (f[k] === undefined) f[k] = v;
    if (type === "sketch" && Array.isArray(f.entities)) f.entities = (f.entities as Record<string, unknown>[]).map((e, j) => ({ ...e, id: typeof e.id === "string" && e.id ? e.id : `e${i + 1}_${j + 1}` }));
    features.push(f as unknown as Feature);
  });
  return { features, errors };
}

/* ───────────────────────── výběr hran / ploch pravidlem ───────────────────────── */
export type EdgeLite = { index: number; curve?: string; dir?: Vec3; center?: Vec3; radius?: number; length?: number };
export type FaceLite = { index: number; planar: boolean; normal?: Vec3; center?: Vec3; area?: number; surface?: string };
export type Bbox = [Vec3, Vec3];
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const tolOf = (b: Bbox) => Math.max(0.01, 1e-3 * Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1], b[1][2] - b[0][2]));
const unitDot = (a: Vec3 | undefined, b: Vec3) => (a ? Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) || 1) : 0);
const sideWord = (w: string): { ax: 0 | 1 | 2; max: boolean } | null => {
  const m: Record<string, { ax: 0 | 1 | 2; max: boolean }> = { "+x": { ax: 0, max: true }, "-x": { ax: 0, max: false }, "+y": { ax: 1, max: true }, "-y": { ax: 1, max: false }, "+z": { ax: 2, max: true }, "-z": { ax: 2, max: false }, horni: { ax: 2, max: true }, top: { ax: 2, max: true }, spodni: { ax: 2, max: false }, bottom: { ax: 2, max: false }, dole: { ax: 2, max: false }, nahore: { ax: 2, max: true }, oben: { ax: 2, max: true }, unten: { ax: 2, max: false }, upper: { ax: 2, max: true }, lower: { ax: 2, max: false } };
  return m[w] ?? null;
};
export function selectEdges(rule: Rule, edges: EdgeLite[], bbox: Bbox): number[] {
  const tol = tolOf(bbox);
  let list = edges;
  for (const w0 of rule) {
    const w = fold(w0);
    const side = sideWord(w);
    if (side) list = list.filter((e) => e.center && near(e.center[side.ax], bbox[side.max ? 1 : 0][side.ax], tol));
    else if (["svisle", "vertical", "svisla", "senkrecht", "vertikal"].includes(w)) list = list.filter((e) => !!e.dir && unitDot(e.dir, [0, 0, 1]) > 0.999);
    else if (["vodorovne", "horizontal", "vodorovna", "waagerecht", "waagrecht"].includes(w)) list = list.filter((e) => e.dir && unitDot(e.dir, [0, 0, 1]) < 0.001);
    else if (["kruhove", "circular", "kruznice", "oblouky", "oble", "round", "rund", "kreisformig", "kreis", "bogen"].includes(w)) list = list.filter((e) => /circ|kru[zž]|arc|obl/i.test(e.curve ?? "") || (e.radius ?? 0) > 0);
    else if (["rovne", "straight", "prime", "linear", "gerade", "geradlinig"].includes(w)) list = list.filter((e) => /line|[uú]se[cč]|p[rř][ií]m/i.test(e.curve ?? "") || (!!e.dir && !e.radius));
    else if (w.startsWith("r=")) list = list.filter((e) => e.radius !== undefined && near(e.radius, num(w.slice(2)), Math.max(tol, 0.05)));
    else if (w.startsWith("len>")) list = list.filter((e) => (e.length ?? 0) > num(w.slice(4)));
    else if (w.startsWith("len<")) list = list.filter((e) => (e.length ?? Infinity) < num(w.slice(4)));
    else if (["vse", "all", "vsechny", "alle", "alles"].includes(w)) list = edges;
    else throw new Error(tr("neznámé pravidlo pro hrany „{0}“ – vše, horní, spodní, +Z/-Z/+X/-X/+Y/-Y, svislé, vodorovné, kruhové, rovné, poloměr N, delší N, kratší N", w0));
  }
  return list.map((e) => e.index);
}
export function selectFaces(rule: Rule, faces: FaceLite[], bbox: Bbox): number[] {
  const tol = tolOf(bbox);
  let list = faces;
  for (const w0 of rule) {
    const w = fold(w0);
    const side = sideWord(w);
    if (side) {
      const n: Vec3 = [0, 0, 0];
      n[side.ax] = side.max ? 1 : -1;
      const cands = list.filter((f) => f.planar && f.normal && unitDot(f.normal, n) > 0.999 && f.center && near(f.center[side.ax], bbox[side.max ? 1 : 0][side.ax], tol));
      list = cands.length ? cands : list.filter((f) => f.planar && f.normal && unitDot(f.normal, n) > 0.999 && f.center).sort((a, b) => (side.max ? b.center![side.ax] - a.center![side.ax] : a.center![side.ax] - b.center![side.ax])).slice(0, 1);
    } else if (["valcove", "cylindrical", "valec", "oble", "zylindrisch", "zylinder", "rund"].includes(w)) list = list.filter((f) => /cyl|v[aá]l/i.test(f.surface ?? "") || (!f.planar && !!f.surface));
    else if (["rovinne", "planar", "rovne", "ploche", "flat", "eben", "ebene", "flach", "plan"].includes(w)) list = list.filter((f) => f.planar);
    else if (["bocni", "side", "sides", "seitlich", "seite", "seiten"].includes(w)) list = list.filter((f) => f.planar && f.normal && unitDot(f.normal, [0, 0, 1]) < 0.001);
    else if (["nejvetsi", "largest", "max", "biggest", "grosste", "groesste", "maximal"].includes(w)) list = [...list].sort((a, b) => (b.area ?? 0) - (a.area ?? 0)).slice(0, 1);
    else if (["vse", "all", "vsechny", "alle", "alles"].includes(w)) list = faces;
    else throw new Error(tr("neznámé pravidlo pro plochy „{0}“ – +Z/-Z/+X/-X/+Y/-Y, horní, spodní, boční, válcové, rovinné, největší", w0));
  }
  return list.map((f) => f.index);
}

/* ───────────────────────── stav dokumentu jako text ───────────────────────── */
const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d).replace(/\.0+$/, "").replace(/^-0$/, "0").replace(".", getLang() === "en" ? "." : ",") : "–");
export function featureSummary(f: Feature): string {
  switch (f.type) {
    case "sketch":
      return tr("rovina {0}, {1} entit", f.plane.kind === "base" ? f.plane.name + (f.plane.offset ? ` +${fmt(f.plane.offset)}` : "") : f.plane.label ?? tr("vlastní"), f.entities.length) + (f.entities.length ? ": " + f.entities.map((e) => e.type === "circle" ? tr("kružnice Ø{0}", fmt(2 * e.r)) : e.type === "rect" ? tr("obdélník {0}×{1}", fmt(e.w), fmt(e.h)) : e.type === "polygon" ? tr("{0}-úhelník", e.sides) : e.type === "slot" ? tr("drážka {0}×{1}", fmt(e.length), fmt(e.width)) : e.type === "polyline" ? tr("čára {0} b.", e.points.length) : e.type).slice(0, 6).join(", ") : "");
    case "extrude":
      return `${f.extent?.kind === "throughAll" ? tr("skrz vše") : fmt(f.distance) + " mm"}${f.symmetric ? tr(", symetricky") : ""}, ${f.mode}`;
    case "revolve":
      return `${fmt(f.angle)}°, ${f.mode}`;
    case "box":
      return tr("{0} mm{1}, {2}", f.size.map((v) => fmt(v)).join(" × "), f.centered ? tr(" (střed)") : "", f.mode);
    case "cylinder":
      return tr("Ø{0} × {1} mm, osa {2}, {3}", fmt(2 * f.radius), fmt(f.height), f.axis, f.mode);
    case "sphere":
      return tr("Ø{0} mm, {1}", fmt(2 * f.radius), f.mode);
    case "thread":
      return tr("{0} délka {1} mm, {2}, {3}, začátek [{4}], osa {5}", threadLabel(f.designation), fmt(f.length), f.internal ? tr("vnitřní (v díře)") : tr("vnější (na válci)"), f.modeled ? tr("modelované drážky") : tr("kosmetický (jen výkres)"), f.position.map((v) => fmt(v)).join("; "), f.axis);
    case "cone":
      return tr("Ø{0}→Ø{1} × {2} mm, {3}", fmt(2 * f.radius1), fmt(2 * f.radius2), fmt(f.height), f.mode);
    case "tube":
      return tr("Ø{0}/Ø{1} × {2} mm, {3}", fmt(f.outer), fmt(f.inner), fmt(f.height), f.mode);
    case "hole":
      return tr("{0}{1}{2} v [{3}], osa {4}", f.kind === "tapped" && f.thread ? tr("{0}{1} (jádro Ø{2})", threadLabel(f.thread), f.end?.kind === "toBody" ? tr(" k tělesu") : f.depth > 0 ? tr(" hl. {0}", fmt(f.depth)) : tr(" skrz"), fmt(f.diameter, 2)) : `Ø${fmt(f.diameter, 2)}${f.end?.kind === "toBody" ? tr(" k tělesu") : f.depth > 0 ? tr(" hloubka {0}", fmt(f.depth)) : f.bothWays ? tr(" skrz oběma směry") : tr(" skrz")}`, f.cbDiameter > 0 ? tr(" zahl. Ø{0}×{1}", fmt(f.cbDiameter), fmt(f.cbDepth)) : "", f.csDiameter ? tr(" kuž. Ø{0}", fmt(f.csDiameter)) : "", f.position.map((v) => fmt(v)).join("; "), f.axis);
    case "fillet":
      return tr("R{0}, hrany {1}", fmt(f.radius, 2), f.edges === "all" ? tr("vše") : f.edges.length);
    case "chamfer":
      return tr("{0} mm, hrany {1}", fmt(f.distance, 2), f.edges === "all" ? tr("vše") : f.edges.length);
    case "shell":
      return tr("{0} mm, otevřených ploch {1}", fmt(f.thickness, 2), f.faces.length);
    case "pattern":
      return f.kind === "circular" ? tr("kruhové {0}× / {1}°", f.count, fmt(f.angle)) : f.kind === "linear" ? tr("lineární {0}× po {1}{2}", f.count, fmt(f.spacing), f.count2 ? tr(" × {0}× po {1}", f.count2, fmt(f.spacing2 ?? 0)) : "") : f.kind;
    case "mirror":
      return tr("rovina {0}{1}", f.plane, f.offset ? ` +${fmt(f.offset)}` : "");
    case "text":
      return tr("„{0}“ {1} mm, {2}", f.text, fmt(f.height), f.mode);
    case "import":
      return `${f.fileName} (${f.format})`;
    case "splitBodies":
      return tr("rovina {0}{1} → nové těleso {2}", f.plane, f.offset ? ` +${fmt(f.offset)}` : "", f.nameB ? `„${f.nameB}“` : tr("(další volný název)"));
    case "copyBody":
      return tr("kopie tělesa {0}, posun [{1}]", f.source ? `„${f.source}“` : tr("(aktivní)"), f.translate.map((v) => fmt(v)).join("; "));
    case "combine":
      return tr("{0} „{1}“ {2} „{3}“{4}", f.op === "cut" ? tr("odebrat od") : f.op === "intersect" ? tr("průnik") : tr("sjednotit"), f.target || tr("aktivní"), f.op === "cut" ? "−" : f.op === "intersect" ? "∩" : "+", f.tool, f.keepTool ? tr(", nástroj ponechán") : "");
    default:
      return "";
  }
}
/** Stav sestavy pro textový stav (počítá aplikace z načtených komponent). */
export type AsmStatus = {
  components: number;
  parts: number;
  bbox?: [Vec3, Vec3];
  volume?: number;
  massKg?: number;
  /** null = kolize zatím nekontrolovány */
  clash?: { count: number; pairs: string[]; at: string } | null;
};

/** Textový stav dokumentu – zpětná vazba pro agenta bez obrázku. */
export function docStatusText(doc: CadDoc, res: BuildResult | null, asm?: AsmStatus): string {
  const st = new Map((res?.status ?? []).map((s) => [s.id, s]));
  const okCount = doc.features.filter((f) => st.get(f.id)?.ok !== false).length;
  const warnCount = doc.features.filter((f) => st.get(f.id)?.ok !== false && st.get(f.id)?.warning).length;
  const lines: string[] = [];
  const matClass = MATERIALS.find((x) => x.id === doc.material);
  const matText = doc.materialName?.trim() ? tr("{0} (hustota podle: {1})", doc.materialName.trim(), matClass?.label ?? doc.material) : (matClass ? `${matClass.label} (${matClass.density} g/cm³)` : doc.material || "–");
  lines.push(tr("Dokument: „{0}“ · {1} · materiál {2} · prvků {3} ({4} ✓{5}, {6} ✗){7}", doc.name, doc.kind === "assembly" ? tr("sestava") : tr("díl"), matText, doc.features.length, okCount - warnCount, warnCount ? `, ${warnCount} ⚠` : "", doc.features.length - okCount, res?.bodies && res.bodies.length > 1 ? tr(" · těles {0}", res.bodies.length) : ""));
  if (res?.bodies && res.bodies.length > 1) lines.push(tr("Tělesa: {0}", res.bodies.map((b) => `${b.name}${b.active ? tr(" (aktivní)") : ""} ${fmt(b.volume / 1000, 2)} cm³`).join(" · ")));
  if (res?.metrics) {
    const [a, b] = res.metrics.bbox;
    lines.push(tr("Rozměry: {0} × {1} × {2} mm (X {3}…{4}, Y {5}…{6}, Z {7}…{8}) · objem {9} cm³ · ploch {10} · hran {11}", fmt(b[0] - a[0]), fmt(b[1] - a[1]), fmt(b[2] - a[2]), fmt(a[0]), fmt(b[0]), fmt(a[1]), fmt(b[1]), fmt(a[2]), fmt(b[2]), fmt(res.metrics.volume / 1000, 2), res.metrics.faces, res.metrics.edges));
    const m = res.metrics;
    if (m.valid !== undefined || m.solids !== undefined) lines.push(tr("Geometrie: {0}{1}", m.solids === 0 ? tr("ŽÁDNÉ objemové těleso (jen plochy) – export STEP nedá solid") : m.valid === false ? tr("NEPLATNÁ (sebeprotínající nebo neorientovatelné plochy) – export STEP může selhat; opravte prvek označený ⚠") : tr("platná"), m.solids ? ` · ${m.solids === 1 ? tr("1 těleso") : tr("{0} těles", m.solids)}` : ""));
  } else if (res && doc.kind !== "assembly") lines.push(tr("Rozměry: žádné těleso (jen skici / pomocná geometrie)"));
  if (doc.kind === "assembly") {
    lines.push(tr("Komponenty: {0}", (doc.components ?? []).map((c) => c.name).join(", ") || tr("žádné")));
    if (asm) {
      const [a, b] = asm.bbox ?? [null, null];
      lines.push(tr("Sestava: {0} komponent ({1} dílů po rozložení podsestav){2}{3}{4}", asm.components, asm.parts, a && b ? tr(" · obálka {0} × {1} × {2} mm", fmt(b[0] - a[0]), fmt(b[1] - a[1]), fmt(b[2] - a[2])) : "", asm.volume != null ? tr(" · objem Σ {0} cm³", fmt(asm.volume / 1000, 2)) : "", asm.massKg != null ? tr(" · hmotnost Σ {0} kg", fmt(asm.massKg, 3)) : ""));
      lines.push(asm.clash ? tr("Kolize: {0} (zkontrolováno {1})", asm.clash.count ? `${asm.clash.count} – ${asm.clash.pairs.join("; ")}` : tr("žádné"), asm.clash.at) : tr("Kolize: nezkontrolováno – příkaz „kolize“ nebo tlačítko Kolize na kartě Sestava"));
    } else lines.push(tr("Sestava: tělesa komponent se stavějí zvlášť (objem a hmotnost viz kusovník)"));
  }
  if (doc.features.length) {
    lines.push(tr("Prvky:"));
    doc.features.forEach((f, i) => {
      const s = st.get(f.id);
      lines.push(tr(" {0}. {1} [{2}, id {3}] {4}{5} – {6}", i + 1, f.name, f.type, f.id, s?.ok === false ? "✗ " + (s.error ?? tr("chyba")) : s?.warning ? "⚠ " + s.warning : "✓", f.suppressed ? " (potlačen)" : "", featureSummary(f)));
      if (f.type === "sketch") lines.push(...sketchStatusLines(f)); // entity s id (e1, e2…) pro vazby a kóty textem, stav určenosti
    });
  }
  if (res?.paramErrors?.length) lines.push(tr("Chyby proměnných: {0}", res.paramErrors.join("; ")));
  if (doc.variables?.length) lines.push(tr("Proměnné: {0}", doc.variables.map((v) => `${v.name} = ${v.expr}`).join("; ")));
  return lines.join("\n");
}

/** Seznam příkazů (pro nápovědu v konzoli a paletu). */
export const AGENT_COMMANDS: { cmd: string; en: string; de: string; desc: string }[] = [
  { cmd: "nový díl [název] / nová sestava [název]", en: "new part / new assembly", de: "neu teil / neu baugruppe", desc: tr("nový dokument v nové záložce") },
  { cmd: "název …, materiál …, barva #hex", en: "name, material, color", de: "name, werkstoff, farbe", desc: tr("materiál = třída hustoty (ocel, nerez, hliník, mosaz, měď, plast, titan, litina, bronz) nebo libovolné označení do razítka (ČSN 11 423, 1.0503)") },
  { cmd: "kvádr X Y Z [střed] [v x y z] [odebrat]", en: "box", de: "quader", desc: tr("kvádr; výchozí roh v počátku, „střed“ = vystředit") },
  { cmd: "válec D H [osa Z] [v x y z] [odebrat]", en: "cylinder", de: "zylinder", desc: tr("válec průměr × výška") },
  { cmd: "koule D [v x y z]", en: "sphere", de: "kugel", desc: tr("koule průměr") },
  { cmd: "kužel D1 D2 H [osa Z]", en: "cone", de: "kegel", desc: tr("kužel / komolý kužel") },
  { cmd: "trubka D d H [osa Z]", en: "tube", de: "rohr", desc: tr("trubka vnější / vnitřní průměr × výška") },
  { cmd: "skica XY|XZ|YZ [odsazení N]: entita; entita… · skica počátek x y z normála nx ny nz [osax ux uy uz]: …", en: "sketch", de: "skizze", desc: tr("nová skica na základní nebo obecné rovině (osa X skici se bez zadání zvolí kolmo na normálu); entity i na dalších řádcích") },
  { cmd: "obdélník W H [v x y] | roh x y [zaoblení-rohů r]", en: "rect", de: "rechteck", desc: tr("obdélník se středem (výchozí počátek) nebo rohem") },
  { cmd: "kružnice D [v x y]", en: "circle", de: "kreis", desc: tr("kružnice průměrem (poloměr r: „poloměr 10“)") },
  { cmd: "mnohoúhelník N D [v x y]", en: "polygon", de: "vieleck", desc: tr("pravidelný N-úhelník (D = opsaná kružnice)") },
  { cmd: "drážka L W [v x y] [úhel a]", en: "slot", de: "langloch", desc: tr("drážka") },
  { cmd: "úsečka x1 y1 x2 y2 · čára x1 y1 x2 y2 [r N] x3 y3 … [uzavřít] · oblouk x1 y1 xm ym x2 y2 · spline x1 y1 x2 y2 … [uzavřít] · bod x y · elipsa rx ry", en: "line, polyline, arc, spline, point, ellipse", de: "linie, polylinie, bogen, spline, punkt, ellipse", desc: tr("další entity; „r N“ za bodem čáry zaoblí tento roh; oblouk = začátek, bod na oblouku, konec; předpona „pomocná“ = konstrukční") },
  { cmd: "skica plocha F3|horní|+X [odsazení N] [obráceně]: … · skica rovina <název pomocné roviny> [odsazení N]: …", en: "sketch face, sketch plane", de: "skizze fläche, skizze ebene", desc: tr("skica na rovinné ploše modelu – číslem (F1, F2… jako popisky pro výběr / window.mncad.hints()) nebo pravidlem jako u skořepiny (horní, +X…) – nebo na pomocné rovině podle názvu; rovina je asociativní – přepočítá se se změnou modelu, protokol vypíše její počátek a osy") },
  { cmd: "vazba <druh> <odkaz> [<odkaz> …]; <druh> …", en: "constraint", de: "bedingung", desc: tr("vazba ve skice: vodorovně, svisle, shodně, rovnoběžně, kolmo, tečně, stejně, pevně, soustředně, středem, na křivce, symetricky, kolineárně; odkaz = e3 (celá entita; id entit ukazuje stav), e3.a / e3.b / e3.c / e3.střed / e3.p0 (bod), e3.s0 (strana obdélníku) nebo počátek; po řádku se skica vyřeší a protokol napíše Plně určeno / Nedourčeno (N st. volnosti) / Přeurčeno") },
  { cmd: "kóta <druh> <odkaz> [<odkaz>] <hodnota> [referenční]; <druh> …", en: "dim", de: "bemaßung, maß", desc: tr("kóta ve skice: délka, vzdálenost, vodorovně, svisle, poloměr, průměr, úhel, délka oblouku; hodnota i s desetinnou čárkou, Ø20 / R10; řídicí kóta změní geometrii, „referenční“ jen měří") },
  { cmd: "vysunout H [symetricky] [skrz] [odebrat|přidat|průnik|nové] [obráceně] [úkos a]", en: "extrude", de: "extrudieren", desc: tr("vysune poslední skicu") },
  { cmd: "rotovat [úhel] [osa X|Y|Z] [odebrat|přidat|průnik|nové]", en: "revolve", de: "rotieren", desc: tr("orotuje poslední skicu (výchozí osa Y skici, 360°); „odebrat“ = vysoustružit z tělesa") },
  { cmd: "díra D [hloubka H|skrz [obousměrně]|k tělesu] v x y [z] [v x2 y2 z2 …] [osa Z] [směr vx vy vz | sklon úhel] [zahloubení D2 H2] [kuželové D2] [závit M8]", en: "hole", de: "bohrung", desc: tr("bez z = začíná na povrchu tělesa v daném místě (podle sítě) a vrtá dolů; „skrz“ vrtá od bodu jen ve směru vrtání, „obousměrně“ na obě strany; šikmá díra: „směr“ = směr vrtání, „sklon“ = odklon od osy; více poloh = více děr; závit i s jemným stoupáním (M18×1,5) – jako u příkazu závit") },
  { cmd: "závit M18×1,5 délka L [v x y z] [osa Z] [vnitřní] [modelovat]", en: "thread", de: "gewinde", desc: tr("závit na válci (vnější) nebo v díře (vnitřní); kosmetický = jen ve výkrese, „modelovat“ = drážky v geometrii") },
  { cmd: "zaoblit R [hrany vše|horní|spodní|svislé|vodorovné|kruhové|rovné|+Z… ] [poloměr N] [delší N]", en: "fillet", de: "verrunden", desc: tr("pravidla lze kombinovat (horní kruhové)") },
  { cmd: "srazit C [hrany …]", en: "chamfer", de: "fase", desc: tr("sražení hran") },
  { cmd: "skořepina T [otevřít +Z|horní|boční…]", en: "shell", de: "schale", desc: tr("vydlabání, otevřené plochy pravidlem") },
  { cmd: "pole N rozteč P [směr X] [N2 rozteč P2 směr Y] · pole kruhové N [úhel 360] [osa Z] [v cx cy cz]", en: "pattern", de: "muster", desc: tr("pole posledního prvku") },
  { cmd: "zrcadlit XY|XZ|YZ [odsazení N]", en: "mirror", de: "spiegeln", desc: tr("zrcadlení tělesa") },
  { cmd: "text \"ABC\" výška H hloubka D v x y [z] [gravírovat]", en: "text", de: "text", desc: tr("nápis vystouplý / gravírovaný") },
  { cmd: "těleso N · rozdělit XY|XZ|YZ [odsazení N] [jako Název] · kopie [těleso N] [posun dx dy dz] [jako Název] · sloučit <cíl> <nástroj> [odebrat|průnik] [ponechat]", en: "body, splitbodies, copybody, combine", de: "körper, teilen, kopieren, kombinieren", desc: tr("více těles v dílu: „těleso 2“ přepne další prvky na Těleso 2; rozdělit = dvě tělesa rovinou; kopie = další těleso; sloučit = sjednotit / odebrat / průnik dvou těles. U prvků: „… nové [těleso Název]“ založí nové těleso, „… těleso 2“ pracuje se zvoleným") },
  { cmd: "prvek <typ|rozšíření> klíč=hodnota …", en: "feature", de: "element", desc: tr("kterýkoli typ prvku i prvek rozšíření bez JSON: prvek sweep profileId=\"Skica 1\" pathId=$last · prvek draft angle=3 faces=boční · prvek \"Ohyb plechu\" úhel=90; hodnoty: číslo, ano/ne, seznam a;b;c, text v uvozovkách; skici a prvky názvem nebo $last; plochy a hrany čísly nebo pravidlem") },
  { cmd: "normálie <označení> [v x y z]", en: "library", de: "normteil", desc: tr("díl z knihovny podle textu (M8x30, ložisko 6204, pero 8x7x40): v dílu nová záložka, v sestavě komponenta") },
  { cmd: "vložit \"název záložky\" [v x y z] [otočení rx ry rz] [ukotvit]", en: "insert", de: "einfügen", desc: tr("sestava: vloží díl z otevřené záložky jako komponentu (vazby se zadávají v panelu sestavy nebo v JSON dokumentu)") },
  { cmd: "výkres", en: "drawing", de: "zeichnung", desc: tr("otevře výkres otevřeného dokumentu v záložce") },
  { cmd: "výkres [A4|A3|A2|A1|A0] [na šířku|na výšku] [měřítko 1:2|auto] [pohledy přední,horní,levý,pravý,zadní,spodní,iso] [řez XZ|YZ|XY [odsazení N]|ne] [skryté ano|ne] [osy ano|ne] [tabulka děr ano|ne] [promítání E|A]", en: "drawing A3 landscape scale 1:2 views front,top,iso section XZ offset 0 hidden no axes yes holetable no projection E", de: "zeichnung A3 quer maßstab 1:2 ansichten vorne,oben,iso schnitt XZ versatz 0 verdeckt nein achsen ja bohrungstabelle nein projektion E", desc: tr("volby listu výkresu (první list v dokumentu) a otevření výkresu; nové výkresy mají Chytré kóty") },
  { cmd: "kótovat [chytře|celkově|nic] [řetězově|od základny]", en: "dimension smart chain / dimension smart baseline / dimension overall / dimension none", de: "bemaßen intelligent kette / bemaßen intelligent basis / bemaßen gesamt / bemaßen keine", desc: tr("(pře)generuje Chytré kóty podle prvků modelu – nahradí jen vygenerované, vlastní kóty zůstanou; vypíše počet kót podle pohledů a co se nevešlo") },
  { cmd: "výkres tolerance <kóta> <tolerance> · výkres poznámka \"…\" · výkres nepředepsané ISO 2768-mK · výkres hrany ISO 13715 … · výkres drsnost Ra 3,2", en: "drawing tolerance Ø40 h6, drawing note, drawing general ISO 2768-mK, drawing edges ISO 13715, drawing roughness Ra 3.2", de: "zeichnung toleranz Ø40 h6, zeichnung notiz, zeichnung allgemein ISO 2768-mK, zeichnung kanten ISO 13715, zeichnung rauheit Ra 3,2", desc: tr("tolerance ke kótě podle popisku (Ø40 h6, 25 ±0,1, M8 6H); poznámka, nepředepsané tolerance, hrany a obecná drsnost u razítka") },
  { cmd: "výkres stav", en: "drawing status", de: "zeichnung status", desc: tr("textový stav výkresu pro agenta: list, měřítko, pohledy, všechny kóty s pohledem, duplicity, chybějící rozměry (Kontrola kót), co se nevešlo; také window.mncad.drawingStatus()") },
  { cmd: "smazat poslední · stav · zobraz iso|přední|horní…", en: "undo, status, view", de: "rückgängig, status, ansicht", desc: tr("správa") },
  { cmd: "kolize", en: "clash", de: "kollision", desc: tr("sestava: kontrola průniků komponent; výsledek zůstane v protokolu i ve stavu (řádek „Kolize:“)") },
  { cmd: "{ … } nebo [ … ] (JSON)", en: "JSON", de: "JSON", desc: tr("celý dokument .mncad, pole prvků nebo jeden prvek – přístup ke všem 36 typům prvků; jeden prvek na jednom řádku lze míchat s textovými příkazy") },
];

/** JavaScript API v prohlížeči (`window.mncad`) – pro automatizaci a agenty, kteří umí spustit skript. */
export type MncadApi = {
  version: number;
  /** jazyk rozhraní (cs / en / de) – podle adresy /cad, /en/cad, /de/cad */
  lang: "cs" | "en" | "de";
  /** klíče rozhraní, pro které v aktuálním jazyce chyběl překlad (prázdné = vše přeloženo) */
  missing: () => string[];
  /** návod pro AI (Markdown) */
  guide: () => string;
  /** seznam textových příkazů */
  commands: () => string[];
  /** provede textové příkazy nebo JSON; vrátí protokol + stav dokumentu */
  run: (text: string) => Promise<string>;
  /** kopie otevřeného dokumentu (formát .mncad) */
  getDocument: () => CadDoc;
  /** nahradí / otevře dokument (objekt nebo JSON text); vrátí protokol */
  setDocument: (doc: CadDoc | string) => Promise<string>;
  /** textový stav dokumentu (rozměry, prvky, chyby) */
  status: () => Promise<string>;
  /** textový stav výkresu (list, měřítko, pohledy, kóty po pohledech, duplicity, chybějící rozměry, co se nevešlo) – jako „výkres stav“ */
  drawingStatus: () => Promise<string>;
  /** otevře konzoli Textové příkazy */
  openConsole: () => void;
  /** průběh běžícího výpočtu jádra (prvek index+1 z total, uplynulý čas) – null, když nic dlouhého neběží */
  progress: () => { label: string; op: string; phase: "feature" | "mesh" | "start"; index: number; total: number; name?: string; seconds: number } | null;
  /** zruší běžící výpočet (jako tlačítko Zrušit); vrací false, když nic neběželo */
  cancel: () => boolean;
  /**
   * popisky entit v 3D okně (F1 plocha, E2 hrana, V3 vrchol): zapne/vypne a vrátí seznam se souřadnicemi na obrazovce (vůči 3D oknu);
   * při otevřené skice vrací štítky bodů skici (O = počátek, P1… = body entit; kind "origin" / "point") se souřadnicemi vůči plátnu skici
   */
  hints: (on?: boolean) => { id: string; kind: "face" | "edge" | "vertex" | "origin" | "point"; index: number; x: number; y: number; title: string }[];
  /** klikne na entitu podle popisku stejnou cestou jako myš (additive = přidat k výběru) */
  clickHint: (id: string, additive?: boolean) => boolean;
  /** export bez dialogu: STEP, STL, BREP, OBJ, GLB, 3MF, WRL nebo projekt .mncad – vrátí název, MIME, velikost a base64 */
  exportFile: (format: "step" | "stl" | "brep" | "obj" | "glb" | "3mf" | "wrl" | "mncad") => Promise<{ name: string; mime: string; bytes: number; base64: string }>;
  /** změřené kroky otevření / výpočtu / zobrazení (čtení souboru, jádro, síť, WebGL…) s pamětí – diagnostika velkých souborů */
  perf?: () => { stage: string; ms: number; at: number; info?: Record<string, number | string> }[];
};
declare global {
  interface Window {
    mncad?: MncadApi;
  }
}

/**
 * Souřadnice povrchu tělesa v daném místě podle sítě modelu: nejvyšší bod sítě (podél osy) nad bodem (u, v)
 * v rovině kolmé na osu. Díra „v x y“ bez z tak začíná na skutečném povrchu (deska i vedle vyššího náboje),
 * ne na obálce celého tělesa. Vrací null, když nad bodem žádná plocha není.
 */
export function topAt(mesh: { vertices: Float32Array | number[]; triangles: Uint32Array | number[] } | null | undefined, axis: "X" | "Y" | "Z", u: number, v: number): number | null {
  if (!mesh) return null;
  const V = mesh.vertices;
  const T = mesh.triangles;
  const ai = axis === "X" ? 0 : axis === "Y" ? 1 : 2;
  const ui = axis === "X" ? 1 : 0;
  const vi = axis === "Z" ? 1 : 2;
  let best: number | null = null;
  for (let t = 0; t + 2 < T.length; t += 3) {
    const a = T[t] * 3;
    const b = T[t + 1] * 3;
    const c = T[t + 2] * 3;
    const ax = V[a + ui] - u;
    const ay = V[a + vi] - v;
    const bx = V[b + ui] - u;
    const by = V[b + vi] - v;
    const cx = V[c + ui] - u;
    const cy = V[c + vi] - v;
    // barycentrické souřadnice bodu (0,0) v promítnutém trojúhelníku
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) < 1e-12) continue;
    const l1 = ((bx - 0) * (cy - 0) - (cx - 0) * (by - 0)) / det;
    const l2 = ((cx - 0) * (ay - 0) - (ax - 0) * (cy - 0)) / det;
    const l3 = 1 - l1 - l2;
    const eps = -1e-6;
    if (l1 < eps || l2 < eps || l3 < eps) continue;
    const h = l1 * V[a + ai] + l2 * V[b + ai] + l3 * V[c + ai];
    if (best === null || h > best) best = h;
  }
  return best;
}
