/**
 * Sestava textem – čistý parser a čisté pomocné funkce (bez jádra, testovatelné v Node):
 * - `sestava` (výpis komponent), `sestava plochy "<X>" [rovinné|válcové]`,
 *   `sestava vazba <druh> "<A>" <plocha> "<B>" <plocha> [hodnota N] [obráceně] [střed] [název "…"]`, `sestava vazba ukotvit "<A>"`,
 *   `sestava vazby`, `sestava vazba <č.|"název"> hodnota=N|obráceně|potlačit|zapnout|smazat`,
 *   `sestava komponenta "<X>" [v x y z] [otočení …] [posun …] [pootočit X 90] [ukotvit|uvolnit] [skrýt|zobrazit] [barva …] [název …] [číslo …] [skupina …] [materiál …]`,
 *   `sestava odebrat|duplikovat|izolovat|skrýt|zobrazit|ukotvit|uvolnit "<X>"`, `sestava zobrazit vše`,
 *   `sestava pole …`, `sestava zrcadlit …`, `sestava šroub …`, `sestava podsestava …`, `sestava rozpustit …`,
 *   `sestava upravit "<X>"` … `sestava hotovo`, `sestava otevřít "<X>"`;
 * - `kusovník [strukturovaně] [csv]`, `rám formy <šířka> <délka> …`, `záložky`, `záložka "<název>"|N`, `zavřít záložku ["<název>"]`.
 * Česky, anglicky (assembly, bom, moldbase, tabs) i německy (baugruppe, stückliste, formaufbau, registerkarten).
 * Plocha komponenty = `F12` (číslo z `sestava plochy`, u podsestavy `F3@Díl`) nebo pravidlo `+Z|-X|horní|spodní|největší|nejmenší|válcová|rovinná|Ø8|R4`.
 * Provedení (jádro, řešič vazeb, záložky): cad/asm-agent.ts.
 */
import { getLang, tr } from "./i18n";
import { MATERIALS, massKg } from "@/lib/mesh-metrics";
import { defaultMoldBase, type BomRow, type CompPattern, type MoldBaseParams } from "./assembly";
import { MATE_LABEL, axisLabel, dirLabel, sortFaceRows, type FaceRow, type MateStatus } from "./mates";
import type { AsmComponent, BuildResult, CadDoc, Mate, Vec3 } from "./types";

/* ───────────────────────── typy ───────────────────────── */

/** Plocha komponenty: číslo (`F12` → index 11, u podsestavy `F3@Díl`) nebo pravidlo (slova a průměr). */
export type FaceSpec = { index?: number; leaf?: string; rule: string[]; diameter?: number; radius?: number; raw: string };
/** Druh vazby v textu (`center` = Kontakt se ztotožněním středů, jako tlačítko Vystředit). */
export type MateKind = "mate" | "flush" | "center" | "concentric" | "distance" | "angle" | "parallel" | "fixed";
export type CompPatch = {
  at?: Vec3;
  move?: Vec3;
  rotation?: Vec3;
  turn?: { axis: 0 | 1 | 2; deg: number };
  fixed?: boolean;
  hidden?: boolean;
  color?: string;
  name?: string;
  number?: string;
  group?: string;
  material?: string;
};
export type AsmCmd =
  | { k: "list" }
  | { k: "faces"; comp: string; kind?: "plane" | "cylinder" }
  | { k: "mate"; kind: MateKind; a: string; faceA?: FaceSpec; b?: string; faceB?: FaceSpec; value?: number; flip: boolean; center: boolean; name?: string }
  | { k: "mates" }
  | { k: "mateEdit"; ref: string; value?: number; flip?: boolean; suppress?: boolean; del?: boolean; name?: string }
  | { k: "comp"; comp: string; patch: CompPatch }
  | { k: "remove"; comps: string[] }
  | { k: "duplicate"; comp: string; offset: Vec3 }
  | { k: "isolate"; comp: string }
  | { k: "showAll" }
  | { k: "pattern"; comp: string; pattern: CompPattern }
  | { k: "mirror"; comp: string; plane: "XY" | "XZ" | "YZ"; offset: number }
  | { k: "bolt"; comp: string; face?: FaceSpec; washer: boolean; nut: boolean; flip: boolean }
  | { k: "sub"; comps: string[]; name?: string }
  | { k: "dissolve"; comp: string }
  | { k: "edit"; comp: string }
  | { k: "done" }
  | { k: "open"; comp: string }
  | { k: "bom"; structured: boolean; csv: boolean }
  | { k: "moldbase"; params: MoldBaseParams; name?: string }
  | { k: "tabs" }
  | { k: "tab"; target: string | number }
  | { k: "closeTab"; target?: string | number };

/* ───────────────────────── tokeny a slova ───────────────────────── */

/** malá písmena bez diakritiky; „−“ (minus z výpisu ploch, −Z) = „-“ */
export const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/−/g, "-");
type Tok = { t: string; q: boolean };
/** tokeny řádku; text v uvozovkách = jeden token (`q`); `klíč=hodnota` se rozdělí na dva tokeny */
export function asmTokens(s: string): Tok[] {
  const out: Tok[] = [];
  const re = /([^\s="„']+)=(?:"([^"]*)"|„([^“]*)“|(\S*))|"([^"]*)"|„([^“]*)“|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1] !== undefined) {
      out.push({ t: m[1], q: false });
      const v = m[2] ?? m[3];
      if (v !== undefined) out.push({ t: v, q: true });
      else if (m[4]) out.push({ t: m[4], q: false });
    } else if (m[5] !== undefined || m[6] !== undefined || m[7] !== undefined) out.push({ t: m[5] ?? m[6] ?? m[7], q: true });
    else out.push({ t: m[8], q: false });
  }
  return out;
}
const W = (...a: string[]) => new Set(a.map(fold));
const isNum = (t: string) => /^[+-]?[øØ⌀]?(\d+[.,]?\d*|[.,]\d+)(mm|°)?$/i.test(t);
const num = (t: string): number => {
  const m = /^([+-]?)[øØ⌀]?(\d+[.,]?\d*|[.,]\d+)/.exec(t);
  return m ? (m[1] === "-" ? -1 : 1) * parseFloat(m[2].replace(",", ".")) : NaN;
};

/** podpříkazy `sestava …` (pořadí = pořadí v hlášce o neznámém podpříkazu) */
const SUB: [AsmSub, Set<string>][] = [
  ["faces", W("plochy", "plocha", "faces", "face", "flächen", "fläche", "flaechen", "flaeche")],
  ["mate", W("vazba", "mate", "constraint", "verknüpfung", "verknuepfung", "bedingung")],
  ["mates", W("vazby", "mates", "constraints", "verknüpfungen", "verknuepfungen", "bedingungen")],
  ["comp", W("komponenta", "component", "komponente", "comp")],
  ["list", W("komponenty", "components", "komponenten", "seznam", "list", "liste")],
  ["remove", W("odebrat", "odstranit", "smazat", "remove", "delete", "entfernen", "löschen", "loeschen")],
  ["duplicate", W("duplikovat", "zdvojit", "duplicate", "duplizieren")],
  ["isolate", W("izolovat", "isolate", "isolieren")],
  ["hide", W("skrýt", "hide", "ausblenden", "verbergen")],
  ["show", W("zobrazit", "ukázat", "show", "einblenden", "anzeigen")],
  ["fix", W("ukotvit", "fix", "anchor", "fixieren")],
  ["release", W("uvolnit", "release", "unfix", "lösen", "loesen", "freigeben")],
  ["pattern", W("pole", "pattern", "array", "muster")],
  ["mirror", W("zrcadlit", "zrcadlení", "mirror", "spiegeln")],
  ["bolt", W("šroub", "šroubový", "bolt", "screw", "schraube")],
  ["sub", W("podsestava", "subassembly", "unterbaugruppe")],
  ["dissolve", W("rozpustit", "dissolve", "auflösen", "aufloesen")],
  ["edit", W("upravit", "edit", "bearbeiten")],
  ["done", W("hotovo", "zpět", "done", "finish", "back", "fertig", "zurück")],
  ["open", W("otevřít", "open", "öffnen", "oeffnen")],
];
type AsmSub = "faces" | "mate" | "mates" | "comp" | "list" | "remove" | "duplicate" | "isolate" | "hide" | "show" | "fix" | "release" | "pattern" | "mirror" | "bolt" | "sub" | "dissolve" | "edit" | "done" | "open";
const ALL = W("vše", "všechny", "všechno", "all", "everything", "alle", "alles");

const MATE_KIND: Record<string, MateKind> = Object.fromEntries(
  (
    [
      ["mate", "kontakt", "contact", "mate", "beruhrung", "beruehrung"],
      ["flush", "zarovnat", "zarovnání", "flush", "align", "bündig", "buendig", "fluchtend"],
      ["center", "vystředit", "vystředění", "center", "centre", "zentrieren", "zentriert"],
      ["concentric", "souosost", "souose", "concentric", "coaxial", "konzentrisch", "koaxial"],
      ["distance", "vzdálenost", "distance", "abstand"],
      ["angle", "úhel", "angle", "winkel"],
      ["parallel", "rovnoběžně", "rovnoběžnost", "parallel"],
      ["fixed", "ukotvit", "ukotvení", "fixed", "fix", "anchor", "fixiert", "fixieren", "fest"],
    ] as const
  ).flatMap(([k, ...w]) => w.map((x) => [fold(x), k as MateKind])),
);

const O = {
  value: W("hodnota", "value", "wert", "val"),
  flip: W("obráceně", "obrátit", "otočit", "flip", "reverse", "reversed", "umkehren", "umgekehrt"),
  center: W("střed", "center", "centre", "mitte"),
  name: W("název", "jméno", "name", "bezeichnung", "benennung"),
  as: W("jako", "as", "als"),
  at: W("v", "na", "poloha", "at", "position", "pos", "bei"),
  move: W("posun", "posunout", "move", "offset", "versatz", "verschieben", "verschiebung"),
  rotation: W("otočení", "natočení", "rotation", "rot", "drehung"),
  turn: W("pootočit", "turn", "rotate", "verdrehen", "drehen"),
  color: W("barva", "color", "colour", "farbe"),
  number: W("číslo", "norma", "number", "nr", "nummer", "norm"),
  group: W("skupina", "group", "gruppe"),
  material: W("materiál", "material", "werkstoff"),
  spacing: W("rozteč", "krok", "spacing", "pitch", "step", "abstand", "teilung"),
  count: W("počet", "ks", "count", "anzahl"),
  direction: W("směr", "direction", "dir", "richtung"),
  circular: W("kruhové", "kruhový", "kruhově", "circular", "polar", "kreisförmig", "kreisfoermig", "kreis"),
  linear: W("lineární", "linear"),
  angle: W("úhel", "angle", "winkel"),
  axis: W("osa", "axis", "achse"),
  offset: W("odsazení", "offset", "versatz", "abstand"),
  washer: W("podložka", "podložkou", "podložky", "washer", "scheibe", "unterlegscheibe"),
  nut: W("matice", "maticí", "matka", "nut", "mutter"),
  without: W("bez", "no", "without", "ohne"),
  suppress: W("potlačit", "vypnout", "suppress", "disable", "unterdrücken", "unterdruecken", "deaktivieren"),
  unsuppress: W("zapnout", "aktivovat", "unsuppress", "enable", "aktivieren", "einschalten"),
  del: W("smazat", "odstranit", "odebrat", "delete", "remove", "löschen", "loeschen", "entfernen"),
  structured: W("strukturovaně", "strukturovaný", "strukturovane", "stromově", "structured", "tree", "strukturiert"),
  flat: W("plochý", "plochy", "flat", "flach"),
  csv: W("csv"),
  tabWord: W("záložka", "záložku", "záložky", "tab", "tabs", "registerkarte", "registerkarten"),
  close: W("zavřít", "uzavřít", "close", "closed", "schließen", "schliessen"),
};

/** pravidlo plochy: slova (bez diakritiky) a jejich význam */
const SIDE: Record<string, Vec3> = { "+x": [1, 0, 0], "-x": [-1, 0, 0], "+y": [0, 1, 0], "-y": [0, -1, 0], "+z": [0, 0, 1], "-z": [0, 0, -1], horni: [0, 0, 1], nahore: [0, 0, 1], top: [0, 0, 1], upper: [0, 0, 1], oben: [0, 0, 1], spodni: [0, 0, -1], dole: [0, 0, -1], bottom: [0, 0, -1], lower: [0, 0, -1], unten: [0, 0, -1] };
const F_PLANE = W("rovinná", "rovinné", "rovinnou", "planar", "plane", "plan", "eben", "ebene", "flach");
const F_CYL = W("válcová", "válcové", "válcovou", "kuželová", "kuželové", "cylindrical", "cylinder", "cyl", "cone", "conical", "zylindrisch", "zylinder", "kegel", "konisch");
const F_LARGEST = W("největší", "largest", "biggest", "max", "größte", "grösste", "groesste", "grosste");
const F_SMALLEST = W("nejmenší", "smallest", "min", "kleinste");
const F_DIAM = W("ø", "⌀", "průměr", "prumer", "diameter", "durchmesser", "dm");
const isFaceWord = (tk: Tok | undefined): boolean => {
  if (!tk || tk.q) return false;
  const w = fold(tk.t);
  return /^f\d+(@.+)?$/.test(w) || w in SIDE || F_PLANE.has(w) || F_CYL.has(w) || F_LARGEST.has(w) || F_SMALLEST.has(w) || F_DIAM.has(w) || /^[øØ⌀]\d/.test(tk.t) || /^r\d+([.,]\d+)?$/.test(w);
};

/* ───────────────────────── čtení ───────────────────────── */

class Cur {
  i = 0;
  constructor(readonly tk: Tok[]) {}
  get done() {
    return this.i >= this.tk.length;
  }
  peek(k = 0): Tok | undefined {
    return this.tk[this.i + k];
  }
  next(): Tok | undefined {
    return this.tk[this.i++];
  }
  /** slovo (bez diakritiky) aktuálního tokenu; text v uvozovkách není slovo volby */
  word(k = 0): string {
    const t = this.peek(k);
    return t && !t.q ? fold(t.t) : "";
  }
  is(set: Set<string>, k = 0) {
    return set.has(this.word(k));
  }
  num(what: string): number {
    const t = this.next();
    if (!t || !isNum(t.t)) throw new Error(tr("{0}: čekám číslo{1}", what, t ? tr(", ne „{0}“", t.t) : ""));
    return num(t.t);
  }
  vec(what: string): Vec3 {
    return [this.num(what), this.num(what), this.num(what)];
  }
  str(what: string): string {
    const t = this.next();
    if (!t || !t.t.trim()) throw new Error(tr("{0}: chybí hodnota", what));
    return t.t.trim();
  }
}

/** název komponenty (v uvozovkách nebo jedno slovo) nebo pořadí `#3` */
function compArg(c: Cur, usage: string): string {
  const t = c.next();
  if (!t || !t.t.trim()) throw new Error(usage);
  return t.t.trim();
}

/** plocha za názvem komponenty: `F12`, `F3@Díl`, pravidlo (`+Z`, `horní`, `největší`, `válcová Ø8`, `Ø10`, `R4`) */
function faceArg(c: Cur): FaceSpec | undefined {
  const raw: string[] = [];
  const spec: FaceSpec = { rule: [], raw: "" };
  while (isFaceWord(c.peek()) || (raw.length && isNum(c.peek()?.t ?? "") && !c.peek()!.q && (F_CYL.has(fold(raw[raw.length - 1])) || F_DIAM.has(fold(raw[raw.length - 1]))))) {
    const t = c.next()!.t;
    raw.push(t);
    const w = fold(t);
    const f = /^f(\d+)(?:@(.+))?$/.exec(w);
    if (f) {
      if (Number(f[1]) < 1) throw new Error(tr("číslo plochy začíná F1"));
      spec.index = Number(f[1]) - 1;
      if (f[2]) spec.leaf = t.slice(t.indexOf("@") + 1);
    } else if (/^[øØ⌀]\d/.test(t) || (isNum(t) && raw.length > 1)) spec.diameter = num(t);
    else if (/^r\d/.test(w)) spec.radius = num(t.slice(1));
    else if (!F_DIAM.has(w)) spec.rule.push(w);
  }
  if (!raw.length) return undefined;
  spec.raw = raw.join(" ");
  return spec;
}

/** číslo nebo název (záložka, vazba) */
const target = (t: Tok): string | number => (!t.q && /^#?\d+$/.test(t.t) ? Number(t.t.replace("#", "")) : t.t.trim());

const SUB_HELP = () => tr("plochy, vazba, vazby, komponenta, odebrat, duplikovat, izolovat, skrýt, zobrazit, ukotvit, uvolnit, pole, zrcadlit, šroub, podsestava, rozpustit, upravit, hotovo, otevřít");

/**
 * Rozbor příkazu sestavy. `cmd` = kanonický název příkazu z agent.ts (assembly, bom, moldbase, tabs, tab, closetab, closed),
 * `line` = celý řádek včetně prvního slova (uvozovky se tu teprve rozliší od slov voleb).
 */
export function parseAsmText(cmd: string, line: string): AsmCmd {
  const all = asmTokens(line);
  const c = new Cur(all.slice(1));
  switch (cmd) {
    case "bom":
      return parseBom(c);
    case "moldbase":
      return parseMoldBase(c);
    case "tabs":
      if (c.is(O.close)) return closeTab(c, 1);
      return { k: "tabs" };
    case "tab": {
      if (c.done) return { k: "tabs" };
      if (c.is(O.close)) return closeTab(c, 1);
      return { k: "tab", target: target(c.next()!) };
    }
    case "closetab":
    case "closed":
      if (!c.is(O.tabWord)) throw new Error(tr("zavřít: zavřít záložku [\"název\"|N] – bez názvu zavře aktivní záložku"));
      return closeTab(c, 1);
    default:
      return parseAssembly(c);
  }
}

function closeTab(c: Cur, skip: number): AsmCmd {
  c.i += skip;
  const t = c.next();
  return t ? { k: "closeTab", target: target(t) } : { k: "closeTab" };
}

function parseBom(c: Cur): AsmCmd {
  const out = { k: "bom" as const, structured: false, csv: false };
  while (!c.done) {
    if (c.is(O.structured)) out.structured = true;
    else if (c.is(O.flat)) out.structured = false;
    else if (c.is(O.csv)) out.csv = true;
    else throw new Error(tr("kusovník: neznámá volba „{0}“ – kusovník [strukturovaně] [csv]", c.peek()!.t));
    c.i++;
  }
  return out;
}

/* ───────────────────────── rám formy ───────────────────────── */

type MoldKey = "aPlate" | "bPlate" | "clamp" | "support" | "spacer" | "spacerWidth" | "ejector" | "retainer" | "pillar";
const MOLD_KEYS: [MoldKey, Set<string>, number][] = [
  ["aPlate", W("deska-a", "deska_a", "a", "aplate", "a-plate", "a-platte", "aplatte"), 10],
  ["bPlate", W("deska-b", "deska_b", "b", "bplate", "b-plate", "b-platte", "bplatte"), 10],
  ["clamp", W("upínací", "upínací-desky", "clamp", "clamping", "aufspann", "aufspannplatte"), 10],
  ["support", W("opěrná", "opěrná-deska", "support", "stütz", "stuetz", "stützplatte"), 10],
  ["spacer", W("rozpěrky", "rozpěrka", "spacer", "spacers", "leiste", "leisten"), 40],
  ["spacerWidth", W("šířka-rozpěrek", "šířka-rozpěrky", "spacerwidth", "spacer-width", "leistenbreite"), 20],
  ["ejector", W("vyhazovací", "vyhazovací-deska", "ejector", "auswerfer", "auswerferplatte"), 8],
  ["retainer", W("kotevní", "kotevní-deska", "retainer", "halte", "halteplatte"), 8],
  ["pillar", W("sloupky", "sloupek", "pillar", "pillars", "säule", "säulen", "saule", "saeule"), 10],
];
const CAVITY = W("dutina", "dutinu", "dutiny", "kapsa", "kapsy", "cavity", "pocket", "nest", "tasche");
const FORMY = W("formy", "forma", "formu", "mold", "mould");
const MAT_ALIAS: Record<string, string> = { steel: "ocel", stahl: "ocel", stainless: "nerez", edelstahl: "nerez", inox: "nerez", aluminium: "hlinik", aluminum: "hlinik", alu: "hlinik", brass: "mosaz", messing: "mosaz", copper: "med", kupfer: "med", titanium: "titan", plast: "pom", plastic: "pom", kunststoff: "pom" };
/** materiál podle id, popisku nebo anglického / německého názvu třídy (null = neznámý) */
export function materialId(q: string): string | null {
  const f = fold(q.trim());
  if (!f) return null;
  const hit = MATERIALS.find((m) => fold(m.id) === f || fold(m.label) === f || fold(m.label).split(" ")[0] === f || MAT_ALIAS[f] === m.id);
  return hit?.id ?? null;
}
const materialList = () => MATERIALS.map((m) => m.id).join(", ");

function parseMoldBase(c: Cur): AsmCmd {
  if (c.is(FORMY)) c.i++;
  const p: MoldBaseParams = { ...defaultMoldBase, cavity: defaultMoldBase.cavity ? { ...defaultMoldBase.cavity } : null };
  const free: number[] = [];
  let name: string | undefined;
  while (!c.done) {
    const w = c.word();
    const key = MOLD_KEYS.find(([, s]) => s.has(w));
    if (key) {
      c.i++;
      p[key[0]] = c.num(c.tk[c.i - 1].t);
    } else if (CAVITY.has(w)) {
      c.i++;
      p.cavity = { w: c.num(tr("dutina")), l: c.num(tr("dutina")), depth: c.num(tr("dutina")) };
    } else if (O.without.has(w) && CAVITY.has(c.word(1))) {
      c.i += 2;
      p.cavity = null;
    } else if (O.material.has(w)) {
      c.i++;
      const q = c.str(tr("materiál"));
      const id = materialId(q);
      if (!id) throw new Error(tr("rám formy: neznámý materiál „{0}“ – materiály: {1}", q, materialList()));
      p.material = id;
    } else if (O.name.has(w)) {
      c.i++;
      name = c.str(tr("název"));
    } else if (isNum(c.peek()!.t) && !c.peek()!.q) free.push(num(c.next()!.t));
    else throw new Error(tr("rám formy: neznámá volba „{0}“ – rám formy <šířka> <délka> [deska-a N] [deska-b N] [upínací N] [opěrná N] [rozpěrky N] [šířka-rozpěrek N] [vyhazovací N] [kotevní N] [sloupky Ø] [dutina X Y H | bez dutiny] [materiál …]", c.peek()!.t));
  }
  if (free.length === 1 || free.length > 2) throw new Error(tr("rám formy: zadejte šířku i délku (dvě čísla), např. rám formy 296 346"));
  if (free.length === 2) [p.width, p.length] = free;
  if (!(p.width >= 100) || !(p.length >= 100)) throw new Error(tr("rám formy: šířka a délka musí být alespoň 100 mm"));
  for (const [k, , min] of MOLD_KEYS) if (!(p[k] >= min)) throw new Error(tr("rám formy: {0} musí být alespoň {1} mm", MOLD_LABEL()[k], min));
  if (2 * p.spacerWidth + 20 >= p.width) throw new Error(tr("rám formy: rozpěrky ({0} mm) jsou na šířku {1} mm příliš široké – vyhazovací paket se mezi ně nevejde", p.spacerWidth, p.width));
  if (p.cavity) {
    const cv = p.cavity;
    if (!(cv.w > 0 && cv.l > 0 && cv.depth > 0)) throw new Error(tr("rám formy: dutina potřebuje tři kladné rozměry X Y H"));
    if (cv.w >= p.width || cv.l >= p.length || cv.depth >= p.aPlate) throw new Error(tr("rám formy: dutina {0}×{1}×{2} se nevejde do desky A {3}×{4}×{5}", cv.w, cv.l, cv.depth, p.width, p.length, p.aPlate));
  }
  return { k: "moldbase", params: p, ...(name ? { name } : {}) };
}
const MOLD_LABEL = (): Record<MoldKey, string> => ({ aPlate: tr("Deska A (pevná)"), bPlate: tr("Deska B (pohyblivá)"), clamp: tr("Upínací desky"), support: tr("Opěrná deska"), spacer: tr("Výška rozpěrek"), spacerWidth: tr("Šířka rozpěrek"), ejector: tr("Vyhazovací deska"), retainer: tr("Kotevní deska"), pillar: tr("Ø vodicích sloupků") });

/* ───────────────────────── sestava … ───────────────────────── */

const COMP_HELP = () => tr("v x y z, otočení rx ry rz, posun dx dy dz, pootočit X 90, ukotvit, uvolnit, skrýt, zobrazit, barva #hex, název \"…\", číslo \"…\", skupina \"…\", materiál …");

function parseAssembly(c: Cur): AsmCmd {
  if (c.done) return { k: "list" };
  const first = c.peek()!;
  const w = c.word();
  // „sestava zobrazit vše“ / „alle einblenden“
  if ((ALL.has(w) && SUB.find(([k]) => k === "show")![1].has(c.word(1))) || (SUB.find(([k]) => k === "show")![1].has(w) && ALL.has(c.word(1)))) {
    c.i += 2;
    return { k: "showAll" };
  }
  const sub = first.q ? undefined : SUB.find(([, s]) => s.has(w))?.[0];
  if (!sub) throw new Error(tr("neznámý podpříkaz sestavy „{0}“ – podpříkazy: {1} (bez podpříkazu vypíše komponenty)", first.t, SUB_HELP()));
  c.i++;
  switch (sub) {
    case "list":
      return { k: "list" };
    case "faces": {
      const comp = compArg(c, tr("chybí název komponenty: sestava plochy \"Čep\" [rovinné|válcové]"));
      let kind: "plane" | "cylinder" | undefined;
      while (!c.done) {
        if (c.is(F_PLANE)) kind = "plane";
        else if (c.is(F_CYL)) kind = "cylinder";
        else throw new Error(tr("sestava plochy: neznámá volba „{0}“ – rovinné | válcové", c.peek()!.t));
        c.i++;
      }
      return { k: "faces", comp, ...(kind ? { kind } : {}) };
    }
    case "mates":
      return { k: "mates" };
    case "mate":
      return parseMate(c);
    case "comp":
      return parseComp(c);
    case "remove": {
      const comps: string[] = [];
      while (!c.done) comps.push(compArg(c, ""));
      if (!comps.length) throw new Error(tr("chybí název komponenty: sestava odebrat \"Čep\" [\"Čep (2)\" …]"));
      return { k: "remove", comps };
    }
    case "duplicate": {
      const comp = compArg(c, tr("chybí název komponenty: sestava duplikovat \"Čep\" [posun 50 0 0]"));
      let offset: Vec3 = [50, 0, 0];
      while (!c.done) {
        if (c.is(O.move) || c.is(O.offset) || c.is(O.at)) {
          c.i++;
          offset = c.vec(tr("posun"));
        } else throw new Error(tr("sestava duplikovat: neznámá volba „{0}“ – posun dx dy dz", c.peek()!.t));
      }
      return { k: "duplicate", comp, offset };
    }
    case "isolate":
      return { k: "isolate", comp: compArg(c, tr("chybí název komponenty: sestava izolovat \"Čep\"")) };
    case "hide":
    case "show":
    case "fix":
    case "release": {
      const comp = compArg(c, tr("chybí název komponenty: sestava skrýt|zobrazit|ukotvit|uvolnit \"Čep\""));
      if (!c.done) throw new Error(tr("nečekané „{0}“ za názvem komponenty – další volby zadejte příkazem sestava komponenta", c.peek()!.t));
      return { k: "comp", comp, patch: sub === "hide" ? { hidden: true } : sub === "show" ? { hidden: false } : { fixed: sub === "fix" } };
    }
    case "pattern":
      return parsePattern(c);
    case "mirror": {
      const comp = compArg(c, tr("chybí název komponenty: sestava zrcadlit \"Čep\" XY|XZ|YZ [odsazení N]"));
      let plane: "XY" | "XZ" | "YZ" = "YZ";
      let offset = 0;
      while (!c.done) {
        const u = c.peek()!.t.toUpperCase();
        if (u === "XY" || u === "XZ" || u === "YZ") {
          plane = u;
          c.i++;
        } else if (c.is(O.offset)) {
          c.i++;
          offset = c.num(tr("odsazení"));
        } else throw new Error(tr("sestava zrcadlit: neznámá volba „{0}“ – XY | XZ | YZ, odsazení N", c.peek()!.t));
      }
      return { k: "mirror", comp, plane, offset };
    }
    case "bolt": {
      const comp = compArg(c, tr("chybí název komponenty: sestava šroub \"Deska\" F12|Ø9 [matice] [bez podložky] [obráceně]"));
      const face = faceArg(c);
      const out = { k: "bolt" as const, comp, ...(face ? { face } : {}), washer: true, nut: false, flip: false };
      while (!c.done) {
        if (c.is(O.without) && c.is(O.washer, 1)) {
          out.washer = false;
          c.i += 2;
          continue;
        }
        if (c.is(O.washer)) out.washer = true;
        else if (c.is(O.nut)) out.nut = true;
        else if (c.is(O.flip)) out.flip = true;
        else throw new Error(tr("sestava šroub: neznámá volba „{0}“ – plocha díry (F12 | Ø9), matice, bez podložky, obráceně", c.peek()!.t));
        c.i++;
      }
      return out;
    }
    case "sub": {
      const comps: string[] = [];
      let name: string | undefined;
      while (!c.done) {
        if (c.is(O.as) || c.is(O.name)) {
          c.i++;
          name = c.str(tr("název podsestavy"));
        } else comps.push(compArg(c, ""));
      }
      if (!comps.length) throw new Error(tr("chybí název komponenty: sestava podsestava \"A\" \"B\" [jako \"Podsestava 1\"]"));
      return { k: "sub", comps, ...(name ? { name } : {}) };
    }
    case "dissolve":
      return { k: "dissolve", comp: compArg(c, tr("chybí název komponenty: sestava rozpustit \"Podsestava 1\"")) };
    case "edit":
      return { k: "edit", comp: compArg(c, tr("chybí název komponenty: sestava upravit \"Čep\" … sestava hotovo")) };
    case "done":
      return { k: "done" };
    case "open":
      return { k: "open", comp: compArg(c, tr("chybí název komponenty: sestava otevřít \"Čep\"")) };
  }
}

function parseComp(c: Cur): AsmCmd {
  const comp = compArg(c, tr("chybí název komponenty: sestava komponenta \"Čep\" [v x y z] [otočení rx ry rz] [ukotvit|uvolnit] …"));
  const p: CompPatch = {};
  while (!c.done) {
    if (c.is(O.at)) {
      c.i++;
      p.at = c.vec(tr("poloha"));
    } else if (c.is(O.move)) {
      c.i++;
      p.move = c.vec(tr("posun"));
    } else if (c.is(O.rotation)) {
      c.i++;
      p.rotation = c.vec(tr("otočení"));
    } else if (c.is(O.turn)) {
      c.i++;
      // pootočit X 90 / pootočit 90 X
      let axis = "XYZ".indexOf((c.peek()?.t ?? "").toUpperCase());
      let deg: number;
      if (axis >= 0) {
        c.i++;
        deg = c.num(tr("pootočit"));
      } else {
        deg = c.num(tr("pootočit"));
        axis = "XYZ".indexOf((c.next()?.t ?? "").toUpperCase());
      }
      if (axis < 0) throw new Error(tr("pootočit: osa X | Y | Z a úhel, např. pootočit X 90"));
      p.turn = { axis: axis as 0 | 1 | 2, deg };
    } else if (c.is(SUB.find(([k]) => k === "fix")![1]) || c.word() === "fixed" || c.word() === "fest") {
      c.i++;
      p.fixed = true;
    } else if (c.is(SUB.find(([k]) => k === "release")![1])) {
      c.i++;
      p.fixed = false;
    } else if (c.is(SUB.find(([k]) => k === "hide")![1])) {
      c.i++;
      p.hidden = true;
    } else if (c.is(SUB.find(([k]) => k === "show")![1])) {
      c.i++;
      p.hidden = false;
    } else if (c.is(O.color)) {
      c.i++;
      const v = c.str(tr("barva"));
      if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) throw new Error(tr("barva: čekám #rrggbb (např. #e03930), ne „{0}“", v));
      p.color = v.toLowerCase();
    } else if (c.is(O.name)) {
      c.i++;
      p.name = c.str(tr("název"));
    } else if (c.is(O.number)) {
      c.i++;
      p.number = c.str(tr("číslo"));
    } else if (c.is(O.group)) {
      c.i++;
      p.group = c.str(tr("skupina"));
    } else if (c.is(O.material)) {
      c.i++;
      p.material = c.str(tr("materiál"));
    } else throw new Error(tr("sestava komponenta: neznámá volba „{0}“ – volby: {1}", c.peek()!.t, COMP_HELP()));
  }
  return { k: "comp", comp, patch: p };
}

function parsePattern(c: Cur): AsmCmd {
  const comp = compArg(c, tr("chybí název komponenty: sestava pole \"Čep\" 4 rozteč 25 [směr X] · sestava pole \"Čep\" kruhové 6 [úhel 360] [osa Z] [v cx cy cz]"));
  let circular = false;
  let count: number | undefined;
  let spacing: number | undefined;
  let dir: Vec3 | undefined;
  let angle = 360;
  let axis: "X" | "Y" | "Z" | Vec3 = "Z";
  let center: Vec3 = [0, 0, 0];
  const readDir = (what: string): Vec3 | "X" | "Y" | "Z" => {
    const t = c.peek();
    if (t && isNum(t.t)) return c.vec(what);
    const m = /^([+-]?)([xyz])$/i.exec(t?.t ?? "");
    if (!m) throw new Error(tr("{0}: X | Y | Z | -X … nebo vektor dx dy dz", what));
    c.i++;
    const k = "xyz".indexOf(m[2].toLowerCase());
    const v: Vec3 = [0, 0, 0];
    v[k] = m[1] === "-" ? -1 : 1;
    return m[1] === "-" ? v : (m[2].toUpperCase() as "X" | "Y" | "Z");
  };
  const vecOf = (d: Vec3 | "X" | "Y" | "Z"): Vec3 => (Array.isArray(d) ? d : d === "X" ? [1, 0, 0] : d === "Y" ? [0, 1, 0] : [0, 0, 1]);
  while (!c.done) {
    if (c.is(O.circular)) {
      c.i++;
      circular = true;
    } else if (c.is(O.linear)) c.i++;
    else if (c.is(O.count)) {
      c.i++;
      count = c.num(tr("počet"));
    } else if (c.is(O.spacing)) {
      c.i++;
      spacing = c.num(tr("rozteč"));
    } else if (c.is(O.direction)) {
      c.i++;
      dir = vecOf(readDir(tr("směr")));
    } else if (c.is(O.angle)) {
      c.i++;
      angle = c.num(tr("úhel"));
    } else if (c.is(O.axis)) {
      c.i++;
      axis = readDir(tr("osa"));
    } else if (c.is(O.at)) {
      c.i++;
      center = c.vec(tr("střed osy"));
    } else if (isNum(c.peek()!.t) && count === undefined) count = c.num(tr("počet"));
    else throw new Error(tr("sestava pole: neznámá volba „{0}“ – pole \"X\" N rozteč P [směr X|dx dy dz] · pole \"X\" kruhové N [úhel 360] [osa Z|dx dy dz] [v cx cy cz]", c.peek()!.t));
  }
  if (!(count !== undefined && count >= 2 && Number.isInteger(count))) throw new Error(tr("sestava pole: počet kusů musí být celé číslo alespoň 2 (včetně originálu)"));
  if (circular) {
    if (Array.isArray(axis) && !(Math.hypot(...axis) > 1e-9)) throw new Error(tr("Osa kruhového pole je nulový vektor – zadejte směr osy."));
    return { k: "pattern", comp, pattern: { kind: "circular", count, angle, axis, center } };
  }
  if (!(spacing !== undefined && spacing !== 0)) throw new Error(tr("sestava pole: lineární pole potřebuje rozteč: sestava pole \"X\" {0} rozteč 25 [směr X]", count));
  const d = dir ?? [1, 0, 0];
  if (!(Math.hypot(...d) > 1e-9)) throw new Error(tr("směr nesmí být nulový vektor"));
  return { k: "pattern", comp, pattern: { kind: "linear", count, spacing, direction: d } };
}

const MATE_ACTION = (c: Cur, k = 0) => c.is(O.value, k) || c.is(O.flip, k) || c.is(O.suppress, k) || c.is(O.unsuppress, k) || c.is(O.del, k) || c.is(O.name, k);

function parseMate(c: Cur): AsmCmd {
  const MATE_USE = tr("sestava vazba kontakt|zarovnat|vystředit|souosost|vzdálenost|úhel|rovnoběžně \"A\" <plocha A> \"B\" <plocha B> [hodnota N] [obráceně] [název \"…\"] · sestava vazba ukotvit \"A\" · sestava vazba <č.|\"název\"> hodnota=N|obráceně|potlačit|zapnout|smazat");
  if (c.done) throw new Error(tr("vazba: {0}", MATE_USE));
  const kind = c.peek()!.q ? undefined : MATE_KIND[c.word()];
  if (kind && !(c.peek(1) && MATE_ACTION(c, 1))) {
    c.i++;
    const a = compArg(c, tr("vazba {0}: chybí komponenta A – {1}", tr(kindLabel(kind)), MATE_USE));
    if (kind === "fixed") {
      if (!c.done) throw new Error(tr("vazba Ukotvit má jen jednu komponentu: sestava vazba ukotvit \"A\""));
      return { k: "mate", kind, a, flip: false, center: false };
    }
    const faceA = faceArg(c);
    const b = compArg(c, tr("vazba {0}: chybí cílová komponenta B – {1}", tr(kindLabel(kind)), MATE_USE));
    const faceB = faceArg(c);
    const out: Extract<AsmCmd, { k: "mate" }> = { k: "mate", kind, a, b, flip: false, center: kind === "center", ...(faceA ? { faceA } : {}), ...(faceB ? { faceB } : {}) };
    while (!c.done) {
      if (c.is(O.value)) {
        c.i++;
        out.value = c.num(tr("hodnota"));
      } else if (c.is(O.flip)) {
        c.i++;
        out.flip = true;
      } else if (c.is(O.center)) {
        c.i++;
        out.center = true;
      } else if (c.is(O.name)) {
        c.i++;
        out.name = c.str(tr("název"));
      } else if (isNum(c.peek()!.t) && out.value === undefined && (kind === "distance" || kind === "angle")) out.value = c.num(tr("hodnota"));
      else throw new Error(tr("vazba: neznámá volba „{0}“ (plochu zadejte hned za názvem komponenty: F12, +Z, horní, největší, válcová Ø8) – {1}", c.peek()!.t, MATE_USE));
    }
    if (out.value !== undefined && kind !== "distance" && kind !== "angle") throw new Error(tr("hodnotu má jen vazba Vzdálenost a Úhel"));
    if (out.center && kind !== "mate" && kind !== "center") throw new Error(tr("„střed“ (ztotožnit středy ploch) jde jen u vazby Kontakt"));
    if (out.center) out.kind = "center";
    return out;
  }
  // úprava existující vazby: číslo (pořadí ve výpisu „sestava vazby“) nebo název
  const ref = c.next()!;
  const out: Extract<AsmCmd, { k: "mateEdit" }> = { k: "mateEdit", ref: String(target(ref)) };
  while (!c.done) {
    if (c.is(O.value)) {
      c.i++;
      out.value = c.num(tr("hodnota"));
    } else if (c.is(O.flip)) {
      c.i++;
      out.flip = true;
    } else if (c.is(O.suppress)) {
      c.i++;
      out.suppress = true;
    } else if (c.is(O.unsuppress)) {
      c.i++;
      out.suppress = false;
    } else if (c.is(O.del)) {
      c.i++;
      out.del = true;
    } else if (c.is(O.name)) {
      c.i++;
      out.name = c.str(tr("název"));
    } else throw new Error(tr("vazba „{0}“: neznámá úprava „{1}“ – hodnota=N | obráceně | potlačit | zapnout | smazat | název \"…\" (novou vazbu začněte druhem: kontakt, zarovnat, vystředit, souosost, vzdálenost, úhel, rovnoběžně, ukotvit)", ref.t, c.peek()!.t));
  }
  if (out.value === undefined && out.flip === undefined && out.suppress === undefined && !out.del && out.name === undefined) throw new Error(tr("vazba „{0}“: co s ní? hodnota=N | obráceně | potlačit | zapnout | smazat | název \"…\"", ref.t));
  return out;
}

/* ───────────────────────── čisté pomocné funkce ───────────────────────── */

export const kindLabel = (k: MateKind): string => (k === "center" ? "Vystředit" : MATE_LABEL[k]);

export const fmt = (n: number, d = 2): string => {
  if (!Number.isFinite(n)) return "–";
  const s = String(Math.round(n * 10 ** d) / 10 ** d || 0);
  return getLang() === "en" ? s : s.replace(".", ",");
};
export const pt = (v: Vec3, d = 2) => `[${v.map((x) => fmt(x, d)).join("; ")}]`;

/** Komponenta nejvyšší úrovně podle názvu (bez ohledu na velikost písmen a diakritiku) nebo pořadí `#3`; chyba vyjmenuje komponenty. */
export function findComp(doc: CadDoc, ref: string): AsmComponent {
  const comps = doc.components ?? [];
  const list = () => comps.map((c, i) => `#${i + 1} ${c.name}`).join(", ") || tr("žádné");
  const n = /^#(\d+)$/.exec(ref.trim());
  if (n) {
    const c = comps[Number(n[1]) - 1];
    if (!c) throw new Error(tr("komponenta {0} v sestavě není – komponenty: {1}", ref, list()));
    return c;
  }
  const exact = comps.filter((c) => c.name === ref);
  const hits = exact.length ? exact : comps.filter((c) => fold(c.name) === fold(ref));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error(tr("„{0}“ je v sestavě {1}× – zadejte pořadí: {2}", ref, hits.length, hits.map((c) => `#${comps.indexOf(c) + 1}`).join(", ")));
  throw new Error(tr("komponenta „{0}“ v sestavě není – komponenty: {1}", ref, list()));
}

/** Řádek seznamu ploch komponenty ve světových souřadnicích sestavy (`leafId` = list – díl; `part` = cesta dílu uvnitř podsestavy). */
export type CompFaceRow = FaceRow & { leafId: string; part?: string };

/** Odkaz na plochu ve výpisu i ve vazbě: `F12`, u dílu v podsestavě `F3@Díl`. */
export const faceRefText = (r: CompFaceRow) => `F${r.face + 1}${r.part ? `@${r.part.split(" › ").pop()}` : ""}`;
const kindText = (r: FaceRow) => (r.kind === "plane" ? tr("rovinná") : r.cone ? tr("kuželová") : `${tr("válcová")} Ø${fmt((r.radius ?? 0) * 2)}`);
/** Krátký popis plochy (do hlášek): „F3 válcová Ø10“, „F1 rovinná +Z“. */
export const faceShort = (r: CompFaceRow) => `${faceRefText(r)} ${kindText(r)}${r.kind === "plane" ? ` ${dirLabel(r.normal)}` : ""}`;

/** Řádek výpisu `sestava plochy`: číslo, druh, normála / osa, střed, plocha / délka. */
export function faceLine(r: CompFaceRow): string {
  const head = `${r.part ? `${r.part} › ` : ""}${faceRefText(r)}`;
  if (r.kind === "plane") return `${head} · ${tr("rovinná")} · ${tr("normála {0}", dirLabel(r.normal))} · ${tr("střed {0}", pt(r.origin))}${r.area != null ? ` · ${fmt(r.area, 1)} mm²` : ""}`;
  return `${head} · ${kindText(r)} · ${tr("osa {0}", axisLabel(r.normal))} · ${tr("střed osy {0}", pt(r.origin))} · ${tr("délka {0} mm", fmt(r.length ?? 0))}`;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unitOf = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Výběr plochy podle čísla nebo pravidla. `need` = druh, který vazba potřebuje (Souosost / šroub válcovou, ostatní rovinnou).
 * Pravidlo: `+Z|-X…|horní|spodní` = rovinná plocha s touto normálou (válcová s osou v tomto směru), `válcová|rovinná` = druh,
 * `Ø8` / `R4` = průměr / poloměr válce, `největší|nejmenší` = podle velikosti. Zbude-li víc ploch, vezme se krajní ve směru
 * pravidla (u `horní` nejvyšší), jinak největší. Chyba vyjmenuje plochy, které by šly použít.
 */
export function pickFace(spec: FaceSpec | undefined, rows: CompFaceRow[], need: "plane" | "cylinder" | null, compName: string, what = ""): { row: CompFaceRow; note?: string } {
  /** nabídka ploch do chybové hlášky: „válcové plochy: F4 válcová Ø16, F2 válcová Ø10“ */
  const offer = (list: CompFaceRow[]) => {
    const l = sortFaceRows(list.filter((r) => !need || r.kind === need));
    const text = l.length ? l.slice(0, 12).map(faceShort).join(", ") + (l.length > 12 ? tr(" … (celkem {0})", l.length) : "") : tr("žádné");
    return need === "cylinder" ? tr("válcové plochy: {0}", text) : need === "plane" ? tr("rovinné plochy: {0}", text) : tr("plochy: {0}", text);
  };
  if (!spec) {
    const cands = rows.filter((r) => !need || r.kind === need);
    if (need === "cylinder" && cands.length === 1) return { row: cands[0] };
    throw new Error(tr("{0}chybí plocha komponenty „{1}“ – zadejte F-číslo (sestava plochy \"{1}\") nebo pravidlo (+Z, horní, největší, válcová Ø8); {2}", what, compName, offer(rows)));
  }
  if (spec.index !== undefined) {
    const hit = rows.filter((r) => r.face === spec.index && (!spec.leaf || fold(r.part?.split(" › ").pop() ?? "") === fold(spec.leaf) || fold(r.part ?? "") === fold(spec.leaf)));
    if (!hit.length) throw new Error(tr("{0}komponenta „{1}“ nemá plochu {2}, kterou by vazba uměla použít – {3}", what, compName, spec.raw, offer(rows)));
    if (hit.length > 1) throw new Error(tr("{0}plocha {1} je ve více dílech podsestavy „{2}“ – upřesněte díl: {3}", what, spec.raw, compName, hit.map(faceRefText).join(", ")));
    if (need && hit[0].kind !== need) throw new Error(tr("{0}plocha {1} komponenty „{2}“ je {3} – vazba potřebuje {4} plochu; {5}", what, spec.raw, compName, kindText(hit[0]), need === "cylinder" ? tr("válcovou") : tr("rovinnou"), offer(rows)));
    return { row: hit[0] };
  }
  let list = rows;
  let order: "largest" | "smallest" | null = null;
  let side: Vec3 | null = null;
  for (const w of spec.rule) {
    if (F_PLANE.has(w)) {
      if (need === "cylinder") throw new Error(tr("{0}„{1}“: vazba potřebuje válcovou plochu, ne rovinnou", what, spec.raw));
      list = list.filter((r) => r.kind === "plane");
    } else if (F_CYL.has(w)) {
      if (need === "plane") throw new Error(tr("{0}„{1}“: vazba potřebuje rovinnou plochu, ne válcovou", what, spec.raw));
      list = list.filter((r) => r.kind === "cylinder" && (!/^ku|^cone|^conical|^kegel|^konisch/.test(w) || r.cone));
    } else if (SIDE[w]) {
      side = SIDE[w];
      const s = side;
      list = list.filter((r) => (r.kind === "plane" ? dot(unitOf(r.normal), s) > 0.999 : Math.abs(dot(unitOf(r.normal), s)) > 0.999));
    } else if (F_LARGEST.has(w)) order = "largest";
    else if (F_SMALLEST.has(w)) order = "smallest";
  }
  if (spec.diameter !== undefined || spec.radius !== undefined) {
    const d = spec.diameter ?? 2 * spec.radius!;
    list = list.filter((r) => r.kind === "cylinder" && Math.abs(2 * (r.radius ?? 0) - d) <= Math.max(0.05, d * 0.005));
  }
  if (need) list = list.filter((r) => r.kind === need);
  if (!list.length) throw new Error(tr("{0}komponenta „{1}“: žádná {2} plocha neodpovídá „{3}“ – {4}", what, compName, need === "cylinder" ? tr("válcová") : need === "plane" ? tr("rovinná") : tr("použitelná"), spec.raw, offer(rows)));
  let row: CompFaceRow;
  if (order) {
    const s = sortFaceRows(list);
    row = order === "largest" ? s[0] : s[s.length - 1];
  } else if (side) {
    const s = side;
    row = [...list].sort((a, b) => dot(b.origin, s) - dot(a.origin, s) || a.face - b.face)[0];
  } else row = sortFaceRows(list)[0];
  return { row, ...(list.length > 1 ? { note: tr("{0} z {1} vyhovujících", faceRefText(row), list.length) } : {}) };
}

const STATUS_TEXT = (s: MateStatus | undefined): string => (s === "ok" ? "ok" : s === "conflict" ? tr("konflikt") : s === "missing" ? tr("chybí plocha") : s === "suppressed" ? tr("potlačeno") : tr("nepřepočteno"));

/** Souhrn vazeb: „3 (2 ok, 1 konflikt)“. */
export function matesSummary(doc: CadDoc, status?: Record<string, MateStatus>): string {
  const mates = doc.mates ?? [];
  if (!mates.length) return "0";
  if (!status) return tr("{0} (stav se přepočítá)", mates.length);
  const c: Record<string, number> = {};
  for (const m of mates) {
    const s = status[m.id] ?? (m.suppressed ? "suppressed" : undefined);
    const k = STATUS_TEXT(s);
    c[k] = (c[k] ?? 0) + 1;
  }
  return `${mates.length} (${Object.entries(c).map(([k, n]) => `${n} ${k}`).join(", ")})`;
}

/** Text vazby: „Souosost „Čep“ F3 → „Deska“ F7 · 5 mm · obráceně“. */
export function mateText(doc: CadDoc, m: Mate): string {
  const name = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? "?";
  const face = (r: Mate["a"]) => (r.face >= 0 ? ` F${r.face + 1}` : r.radius ? ` R${fmt(r.radius)}` : "");
  const label = m.name ?? (m.type === "mate" && m.center ? tr("Vystředit") : tr(MATE_LABEL[m.type]));
  const parts = [m.type === "fixed" ? `${label} „${name(m.a.compId)}“` : `${label} „${name(m.a.compId)}“${face(m.a)} → „${name(m.b.compId)}“${face(m.b)}`];
  if (m.type === "distance") parts.push(`${fmt(m.value ?? 0)} mm`);
  if (m.type === "angle") parts.push(`${fmt(m.value ?? 0)}°`);
  if (m.flip) parts.push(tr("obráceně"));
  if (m.suppressed) parts.push(tr("potlačeno"));
  return parts.join(" · ");
}

/** Výpis vazeb (`sestava vazby`): číslo, druh, komponenty a plochy, hodnota, stav. */
export function mateLines(doc: CadDoc, status?: Record<string, MateStatus>): string[] {
  const mates = doc.mates ?? [];
  const out = [tr("Vazby sestavy „{0}“: {1}", doc.name, matesSummary(doc, status))];
  mates.forEach((m, i) => out.push(` ${i + 1}. ${mateText(doc, m)} – ${STATUS_TEXT(status?.[m.id] ?? (m.suppressed ? "suppressed" : undefined))}`));
  if (!mates.length) out.push(tr(" (žádné – sestava vazba kontakt|souosost … \"A\" <plocha> \"B\" <plocha>)"));
  return out;
}

/** Vazba podle čísla (pořadí ve výpisu) nebo názvu / druhu; chyba vyjmenuje vazby. */
export function findMate(doc: CadDoc, ref: string): Mate {
  const mates = doc.mates ?? [];
  const list = () => mates.map((m, i) => `${i + 1}. ${m.name ?? tr(MATE_LABEL[m.type])}`).join(", ") || tr("žádné");
  if (/^#?\d+$/.test(ref)) {
    const m = mates[Number(ref.replace("#", "")) - 1];
    if (!m) throw new Error(tr("vazba {0} v sestavě není – vazby: {1}", ref, list()));
    return m;
  }
  const f = fold(ref);
  const named = mates.filter((m) => m.name && fold(m.name) === f);
  const hits = named.length ? named : mates.filter((m) => !m.name && (fold(tr(MATE_LABEL[m.type])) === f || fold(MATE_LABEL[m.type]) === f));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error(tr("vazba „{0}“ je v sestavě {1}× – zadejte číslo: {2}", ref, hits.length, hits.map((m) => mates.indexOf(m) + 1).join(", ")));
  throw new Error(tr("vazba „{0}“ v sestavě není – vazby: {1}", ref, list()));
}

const srcText = (c: AsmComponent) => (c.source.kind === "asm" ? tr("podsestava ({0} ks)", c.source.doc.components?.length ?? 0) : c.source.kind === "file" ? tr("soubor {0}", c.source.format.toUpperCase()) : tr("díl"));
const rotText = (r: Vec3) => (r.some((x) => Math.abs(x) > 1e-9) ? ` ∠${pt(r)}` : "");
const isFixed = (doc: CadDoc, c: AsmComponent) => !!c.fixed || (doc.mates ?? []).some((m) => m.type === "fixed" && m.a.compId === c.id && !m.suppressed);

/** Výpis komponent (`sestava`): pořadí, název, druh, poloha, natočení, ukotvení, viditelnost. */
export function componentLines(doc: CadDoc, status?: Record<string, MateStatus>): string[] {
  const comps = doc.components ?? [];
  const out = [tr("Sestava „{0}“: komponent {1} · vazby {2}", doc.name, comps.length, matesSummary(doc, status))];
  comps.forEach((c, i) => {
    const flags = [isFixed(doc, c) ? tr("ukotvená ⚓") : "", c.hidden ? tr("skrytá") : "", c.number ? tr("č. {0}", c.number) : "", c.group ? tr("skupina {0}", c.group) : ""].filter(Boolean);
    out.push(` #${i + 1} ${c.name} · ${srcText(c)} · ${tr("poloha {0}", pt(c.placement.position))}${rotText(c.placement.rotation) ? ` · ${tr("natočení {0}", pt(c.placement.rotation))}` : ""}${flags.length ? ` · ${flags.join(" · ")}` : ""}`);
  });
  if (!comps.length) out.push(tr(" (prázdná – vložit \"díl\" · normálie M8x30 · rám formy)"));
  return out;
}

/** Řádky stavu sestavy pro `docStatusText`: komponenty s polohou (⚓ = ukotvená) a souhrn vazeb. */
export function asmStatusLines(doc: CadDoc, status?: Record<string, MateStatus>): string[] {
  const comps = doc.components ?? [];
  const MAX = 60;
  const items = comps.slice(0, MAX).map((c) => `${c.name} ${pt(c.placement.position)}${rotText(c.placement.rotation)}${isFixed(doc, c) ? " ⚓" : ""}${c.hidden ? tr(" (skrytá)") : ""}${c.source.kind === "asm" ? tr(" (podsestava)") : ""}`);
  const out = [tr("Komponenty: {0}", items.join(" · ") || tr("žádné")) + (comps.length > MAX ? tr(" … a dalších {0} (sestava)", comps.length - MAX) : "")];
  if (doc.mates?.length) out.push(tr("Vazby: {0}", matesSummary(doc, status)));
  return out;
}

/** Materiál a hmotnost dílu do kusovníku – stejně jako kusovník v aplikaci (označení materiálu dílu, jinak třída). */
export function bomPartInfo(c: AsmComponent, r: BuildResult | null | undefined): { material?: string; massKg?: number } {
  const matId = c.source.kind === "part" ? c.source.doc.material : (c.material ?? "ocel");
  const mt = MATERIALS.find((x) => x.id === matId);
  const label = c.source.kind === "part" && c.source.doc.materialName?.trim() ? c.source.doc.materialName.trim() : (mt?.label ?? matId).split(" – ")[0];
  return { material: label, massKg: r?.metrics ? massKg(r.metrics.volume, mt?.density ?? 7.85) : undefined };
}

/** Kusovník jako textová tabulka (do protokolu). */
export function bomText(rows: BomRow[], docName: string, structured: boolean): string {
  const qty = rows.filter((r) => !structured || (r.level ?? 0) === 0).reduce((s, r) => s + r.qty, 0);
  const leafRows = structured ? rows.filter((r) => !r.assembly) : rows;
  const total = structured ? rows.filter((r) => (r.level ?? 0) === 0).reduce((s, r) => s + (r.massKg ?? 0) * r.qty, 0) : leafRows.reduce((s, r) => s + (r.massKg ?? 0) * r.qty, 0);
  const unknown = rows.some((r) => r.massKg == null);
  const head = tr("Kusovník „{0}“ ({1}): položek {2}, kusů {3}, hmotnost Σ {4} kg{5}", docName, structured ? tr("strukturovaný") : tr("plochý"), rows.length, qty, fmt(total, 3), unknown ? tr(" (bez dílů, které se nepostavily)") : "");
  const lines = [head, tr("Poz. | Název | Číslo / norma | Ks | Materiál | kg/ks")];
  for (const r of rows) lines.push(`${"  ".repeat(r.level ?? 0)}${r.pos} | ${r.name} | ${r.number ?? ""} | ${r.qty} | ${r.material ?? ""} | ${r.massKg != null ? fmt(r.massKg, 3) : "–"}`);
  return lines.join("\n");
}

/** Otevřená záložka dokumentu (výpis `záložky`, `window.mncad.tabs()`). */
export type TabInfo = { id: string; title: string; kind: "part" | "assembly" | "drawing"; active: boolean };

/** Záložka podle pořadí (1 = první), id nebo názvu (bez ohledu na velikost písmen a diakritiku); chyba vyjmenuje záložky. */
export function resolveTab(list: TabInfo[], target: string | number): TabInfo {
  const names = () => list.map((t, i) => `${i + 1}. ${t.title}`).join(", ") || tr("žádné");
  if (typeof target === "number" || /^#?\d+$/.test(String(target))) {
    const n = typeof target === "number" ? target : Number(String(target).replace("#", ""));
    const t = list[n - 1];
    if (!t) throw new Error(tr("záložka {0} není – záložky: {1}", n, names()));
    return t;
  }
  const byId = list.find((t) => t.id === target);
  if (byId) return byId;
  const exact = list.filter((t) => t.title === target);
  const hits = exact.length ? exact : list.filter((t) => fold(t.title) === fold(target));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    // díl a jeho výkres mají podobný název – přednost má dokument (ne výkres)
    const docs = hits.filter((t) => t.kind !== "drawing");
    if (docs.length === 1) return docs[0];
    throw new Error(tr("záložka „{0}“ je otevřená {1}× – zadejte číslo: {2}", target, hits.length, hits.map((t) => list.indexOf(t) + 1).join(", ")));
  }
  throw new Error(tr("záložka „{0}“ není otevřená – záložky: {1}", target, names()));
}
