/**
 * Vazby, kóty a roviny skici z textových příkazů (konzole „Textové příkazy“, `window.mncad.run`).
 *
 * - `vazba <druh> <odkaz> [<odkaz> …]` (EN `constraint`, DE `bedingung`) a `kóta <druh> <odkaz> [<odkaz>] <hodnota> [referenční]`
 *   (EN `dim`, DE `bemaßung`) – rozbor řádku, ověření odkazů, uložení do skice, vyřešení řešičem skici a stav určenosti
 *   stejnými slovy jako skicář („Plně určeno“, „Nedourčeno (N st. volnosti)“, „Přeurčeno – …“).
 * - Krátká id entit zadaných textem (`e1`, `e2`… v pořadí vzniku), aby na ně další řádky mohly odkazovat.
 * - `skica plocha F3 …` / `skica rovina <název> …` – asociativní rovina skici; řeší ji jádro (rozhraní `SketchKernel`).
 *
 * Čisté funkce bez prohlížeče (testovatelné v Node); `cad-app.tsx` volá jen `applySketchOp` a `sketchOnPlane`.
 */
import { tangentSummary } from "./spline-tangent";
import type { FaceLite } from "./agent";
import { getLang, tr } from "./i18n";
import type { Ref, Sig } from "./refs";
import { keyPoints } from "./sketch";
import { addWithAutoClose } from "./poly-close";
import { profileStatusLines } from "./profile-check";
import { analyzeSketch, measureDim, paramsOf, refCircle, refLine, refPoint, solveSketch, type SketchAnalysis } from "./sketch-solver";
import { uid, type BuildResult, type CadDoc, type Feature, type SketchConstraint, type SketchDim, type SketchEntity, type SketchPlane, type SketchRef, type Vec2, type Vec3 } from "./types";

type SketchF = Extract<Feature, { type: "sketch" }>;
type ConType = SketchConstraint["type"];
type DimType = SketchDim["type"];

/* ───────────────────────── operace pro aplikaci ───────────────────────── */
/** skica, do které řádky bloku patří: založená tímto vstupem (`line` = řádek příkazu skica); bez ní poslední skica dokumentu */
export type SketchTarget = { id: string; line: number };
/** odkaz z textu: entita (celá) nebo její bod/strana, případně počátek skici */
export type TextRef = { origin: true } | { e: string; k?: string };
export type ConstraintSpec = { type: ConType; refs: TextRef[]; at?: Vec2 };
export type DimSpec = { type: DimType; refs: TextRef[]; value?: number; driving: boolean };
export type SketchOp =
  /** `end` = poslední řádek bloku skici – má-li skica vazby nebo kóty, vyřeší se a ohlásí určenost */
  | { k: "entities"; entities: SketchEntity[]; line: number; sketch?: SketchTarget; end?: boolean }
  | { k: "constraints"; items: ConstraintSpec[]; line: number; sketch?: SketchTarget }
  | { k: "dims"; items: DimSpec[]; line: number; sketch?: SketchTarget };
/**
 * skica na rovinné ploše modelu – číslem F jako popisky pro výběr (F1 = první plocha) nebo pravidlem jako u skořepiny
 * (`horní`, `+Z`, `boční -X`…) – nebo na pomocné rovině podle názvu
 */
export type SketchOnOp = { k: "sketchOn"; feature: Feature; on: { face: number } | { faceRule: string[] } | { datum: string }; offset: number; flip: boolean; line: number };

/* ───────────────────────── pomocné ───────────────────────── */
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const NUM_RE = /^([øØ⌀]|[rR](?=[\d.,]))?([+-]?(?:\d+[.,]?\d*|[.,]\d+))(mm|°)?$/;
const isNumTok = (t: string) => NUM_RE.test(t);
const numOf = (t: string) => parseFloat(NUM_RE.exec(t)![2].replace(",", "."));
const fmt = (v: number) => {
  const s = String(Math.round(v * 1000) / 1000).replace(/^-0$/, "0");
  return getLang() === "en" ? s : s.replace(".", ",");
};
const pt = (p: Vec2) => `[${fmt(p[0])}; ${fmt(p[1])}]`;
/** id bodu počátku skici (pomocný bod vazbený v [0; 0]) – vznikne, když vazba nebo kóta odkazuje na počátek */
export const ORIGIN_ID = "O";

const CON_CMD = ["vazba", "vazby", "constraint", "constraints", "bedingung", "bedingungen"];
const DIM_CMD = ["kota", "koty", "dim", "dims", "bemaßung", "bemassung", "maß", "mass"]; // „dimension“ = kótování výkresu (kótovat)
const ORIGIN_WORDS = ["pocatek", "origin", "ursprung", "o"];
const REF_WORDS = ["referencni", "referencne", "reference", "ref", "referenz", "driven"];
const DRIVE_WORDS = ["ridici", "driving", "steuernd"];
const AT_WORDS = ["v", "na", "at", "bei", "an"];

const CON_WORDS: Record<ConType, string[]> = {
  horizontal: ["vodorovne", "vodorovna", "vodorovny", "horizontalne", "horizontal", "waagerecht", "waagrecht"],
  // DE: „senkrecht“ je v CADu kolmost (tlačítko „Senkrecht“ = Kolmo) – svisle je „vertikal“ / „lotrecht“
  vertical: ["svisle", "svisla", "svisly", "vertikalne", "vertical", "vertikal", "lotrecht"],
  coincident: ["shodne", "shoda", "totozne", "totoznost", "coincident", "deckungsgleich", "koinzident"],
  parallel: ["rovnobezne", "rovnobezna", "rovnobezny", "parallel", "parallele"],
  perpendicular: ["kolmo", "kolma", "kolmy", "perpendicular", "senkrecht", "rechtwinklig"],
  tangent: ["tecne", "tecna", "tecny", "tangent", "tangential", "tangentially"],
  equal: ["stejne", "stejna", "stejny", "stejna velikost", "equal", "gleich", "gleiche"],
  fixed: ["pevne", "pevna", "pevny", "fixed", "fix", "fest", "fixiert"],
  concentric: ["soustredne", "soustredna", "soustredny", "concentric", "konzentrisch"],
  midpoint: ["stredem", "ve stredu", "uprostred", "midpoint", "mittelpunkt"],
  pointOnCurve: ["na krivce", "bod na krivce", "nakrivce", "oncurve", "on curve", "pointoncurve", "point on curve", "aufkurve", "auf kurve", "punkt auf kurve"],
  symmetric: ["symetricky", "symetricke", "symetrie", "symmetric", "symmetrisch", "symmetrie"],
  collinear: ["kolinearne", "kolinearni", "collinear", "kollinear"],
};
const DIM_WORDS: Record<DimType, string[]> = {
  length: ["delka", "length", "lange", "laenge", "len"],
  distance: ["vzdalenost", "distance", "abstand", "dist"],
  horizontal: ["vodorovne", "vodorovna", "horizontal", "waagerecht", "waagrecht", "dx"],
  vertical: ["svisle", "svisla", "vertical", "vertikal", "senkrecht", "lotrecht", "dy"], // u kót „senkrecht“ dál = svislá kóta (kolmá kóta neexistuje)
  radius: ["polomer", "radius", "halbmesser"],
  diameter: ["prumer", "diameter", "durchmesser"],
  angle: ["uhel", "angle", "winkel"],
  arcLength: ["delka oblouku", "arclength", "arc length", "bogenlange", "bogenlaenge", "bogen lange"],
};
/** slovo druhu vazby v jazyce rozhraní – překlad je zároveň platné vstupní slovo (popis z protokolu lze napsat zpět) */
const conWord = (t: ConType): string =>
  ({ horizontal: tr("vodorovně"), vertical: tr("svisle"), coincident: tr("shodně"), parallel: tr("rovnoběžně"), perpendicular: tr("kolmo"), tangent: tr("tečně"), equal: tr("stejně"), fixed: tr("pevně"), concentric: tr("soustředně"), midpoint: tr("středem"), pointOnCurve: tr("na křivce"), symmetric: tr("symetricky"), collinear: tr("kolineárně") })[t];
const dimWord = (t: DimType): string =>
  ({ length: tr("délka"), distance: tr("vzdálenost"), horizontal: tr("vodorovně"), vertical: tr("svisle"), radius: tr("poloměr"), diameter: tr("průměr"), angle: tr("úhel"), arcLength: tr("délka oblouku") })[t];
const conUsage = (t: ConType): string =>
  ({
    horizontal: tr("vazba vodorovně e1 (úsečka) · vazba vodorovně e1.a e2.b (dva body)"),
    vertical: tr("vazba svisle e1 (úsečka) · vazba svisle e1.a e2.b (dva body)"),
    coincident: tr("vazba shodně e1.b e2.a (dva body; počátek = počátek skici)"),
    parallel: tr("vazba rovnoběžně e1 e3 (dvě úsečky)"),
    perpendicular: tr("vazba kolmo e1 e2 (dvě úsečky)"),
    tangent: tr("vazba tečně e1 e5 (úsečka a kružnice / oblouk, nebo dvě kružnice / oblouky)"),
    equal: tr("vazba stejně e1 e3 (dvě úsečky, nebo dvě kružnice / oblouky)"),
    fixed: tr("vazba pevně e1.a [x y] (bod, volitelně na souřadnice) · vazba pevně e1 (celá entita)"),
    concentric: tr("vazba soustředně e5 e6 (dvě kružnice / oblouky, nebo kružnice a bod)"),
    midpoint: tr("vazba středem e5.střed e1 (bod a úsečka)"),
    pointOnCurve: tr("vazba na křivce e1.b e5 (bod a úsečka / kružnice / oblouk)"),
    symmetric: tr("vazba symetricky e1.a e2.b e3 (dva body a osa = úsečka)"),
    collinear: tr("vazba kolineárně e1 e4 (dvě úsečky)"),
  })[t];
const dimUsage = (t: DimType): string =>
  ({
    length: tr("kóta délka e1 50 (úsečka nebo strana: e2.s0 obdélníku, e3.g1 lomené čáry)"),
    distance: tr("kóta vzdálenost e1.a e3.b 40 (dva body, bod a úsečka, nebo dvě rovnoběžné úsečky)"),
    horizontal: tr("kóta vodorovně e1.a e2.b 30 (dva body; úsečka = její konce; počátek = počátek skici)"),
    vertical: tr("kóta svisle počátek e1.a 20 (dva body; úsečka = její konce)"),
    radius: tr("kóta poloměr e5 R10 (kružnice nebo oblouk)"),
    diameter: tr("kóta průměr e5 Ø20 (kružnice nebo oblouk)"),
    angle: tr("kóta úhel e1 e2 45 (dvě úsečky, 0–180°)"),
    arcLength: tr("kóta délka oblouku e5 30 (oblouk)"),
  })[t];
const CON_ARITY: Record<ConType, number[]> = { horizontal: [1, 2], vertical: [1, 2], coincident: [2], parallel: [2], perpendicular: [2], tangent: [2], equal: [2], fixed: [1], concentric: [2], midpoint: [2], pointOnCurve: [2], symmetric: [3], collinear: [2] };
const DIM_ARITY: Record<DimType, number[]> = { length: [1], distance: [1, 2], horizontal: [1, 2], vertical: [1, 2], radius: [1], diameter: [1], angle: [2], arcLength: [1] };
const conKinds = () => (Object.keys(CON_WORDS) as ConType[]).map(conWord).join(", ");
const dimKinds = () => (Object.keys(DIM_WORDS) as DimType[]).map(dimWord).join(", ");

/** druh z prvních 1–3 slov (víceslovné druhy „na křivce“, „délka oblouku“ mají přednost) */
function matchKind<T extends string>(tokens: string[], words: Record<T, string[]>): { kind: T; used: number } | null {
  for (const n of [3, 2, 1]) {
    if (tokens.length < n) continue;
    const w = fold(tokens.slice(0, n).join(" "));
    for (const [k, list] of Object.entries(words) as [T, string[]][]) if (list.includes(w)) return { kind: k, used: n };
  }
  return null;
}
/** odkaz z textu: `e3` (celá entita), `e3.a` / `e3.b` / `e3.c` / `e3.střed` / `e3.p0` / `e3.s1` (bod, strana) nebo `počátek` */
export function parseRef(t: string): TextRef {
  if (ORIGIN_WORDS.includes(fold(t))) return { origin: true };
  const m = /^([A-Za-z0-9_-]+)(?:\.([^\s.]+))?$/.exec(t);
  if (!m) throw new Error(tr("„{0}“ není odkaz na entitu skici – e3 (celá entita), e3.a / e3.b / e3.c / e3.střed / e3.p0 (bod) nebo počátek", t));
  return m[2] ? { e: m[1], k: m[2] } : { e: m[1] };
}
const refText = (r: TextRef) => ("origin" in r ? tr("počátek") : r.k ? `${r.e}.${r.k}` : r.e);
const parts = (text: string) =>
  text
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(/\s+/));

/* ───────────────────────── rozbor řádků ───────────────────────── */
/** `vazba kolmo e1 e2; vodorovně e1` → vazby (bez slova „vazba“ na začátku nebo s ním, oddělené středníkem) */
export function parseConstraints(text: string): ConstraintSpec[] {
  const out: ConstraintSpec[] = [];
  for (let tk of parts(text)) {
    if (CON_CMD.includes(fold(tk[0] ?? ""))) tk = tk.slice(1);
    if (!tk.length) throw new Error(tr("vazba potřebuje druh a odkazy: vazba kolmo e1 e2 – druhy: {0}", conKinds()));
    const m = matchKind(tk, CON_WORDS);
    if (!m) throw new Error(tr("neznámý druh vazby „{0}“ – druhy: {1}", tk[0], conKinds()));
    const rest = tk.slice(m.used).filter((t) => !AT_WORDS.includes(fold(t)));
    const nums = rest.filter(isNumTok).map(numOf);
    const refs = rest.filter((t) => !isNumTok(t)).map(parseRef);
    // „senkrecht“ znamenalo do 13. vlny svisle: jedna úsečka nebo dva body (e1.a e2.b) svědčí o starém skriptu → jasná rada
    if (m.kind === "perpendicular" && fold(tk[0]) === "senkrecht" && (refs.length === 1 || (refs.length === 2 && refs.every((x) => "origin" in x || (!!x.k && !/^[sg]\d+$/i.test(x.k))))))
      throw new Error(tr("vazba „senkrecht“ = kolmo (dvě úsečky: senkrecht e1 e2); pro svislou úsečku nebo dva body nad sebou napište „vertikal“ ({0})", tk.slice(m.used).join(" ")));
    if (!CON_ARITY[m.kind].includes(refs.length)) throw new Error(tr("vazba {0}: špatný počet odkazů ({1}) – zápis: {2}", conWord(m.kind), refs.length, conUsage(m.kind)));
    const spec: ConstraintSpec = { type: m.kind, refs };
    if (nums.length) {
      if (m.kind !== "fixed" || nums.length !== 2) throw new Error(tr("vazba {0}: čísla „{1}“ navíc – zápis: {2}", conWord(m.kind), nums.map(fmt).join(" "), conUsage(m.kind)));
      spec.at = [nums[0], nums[1]];
    }
    out.push(spec);
  }
  if (!out.length) throw new Error(tr("vazba potřebuje druh a odkazy: vazba kolmo e1 e2 – druhy: {0}", conKinds()));
  return out;
}

/** `kóta délka e1 50; průměr e5 Ø20 referenční` → kóty */
export function parseDims(text: string): DimSpec[] {
  const out: DimSpec[] = [];
  for (let tk of parts(text)) {
    if (DIM_CMD.includes(fold(tk[0] ?? ""))) tk = tk.slice(1);
    if (!tk.length) throw new Error(tr("kóta potřebuje druh, odkaz a hodnotu: kóta délka e1 50 – druhy: {0}", dimKinds()));
    const m = matchKind(tk, DIM_WORDS);
    if (!m) throw new Error(tr("neznámý druh kóty „{0}“ – druhy: {1}", tk[0], dimKinds()));
    let type = m.kind;
    let driving = true;
    const refs: TextRef[] = [];
    const vals: string[] = [];
    for (const t of tk.slice(m.used)) {
      const f = fold(t);
      if (REF_WORDS.includes(f)) driving = false;
      else if (DRIVE_WORDS.includes(f)) driving = true;
      else if (isNumTok(t)) vals.push(t);
      else refs.push(parseRef(t));
    }
    if (vals.length > 1) throw new Error(tr("kóta {0}: jen jedna hodnota (zadáno {1}) – zápis: {2}", dimWord(type), vals.join(" "), dimUsage(type)));
    // „Ø20“ u poloměru = průměr 20, „R10“ u průměru = poloměr 10 – předpona hodnoty říká, co číslo znamená
    const pre = vals[0] ? NUM_RE.exec(vals[0])![1] : undefined;
    if (pre && /[øØ⌀]/.test(pre) && type === "radius") type = "diameter";
    if (pre && /r/i.test(pre) && type === "diameter") type = "radius";
    if (!DIM_ARITY[type].includes(refs.length)) throw new Error(tr("kóta {0}: špatný počet odkazů ({1}) – zápis: {2}", dimWord(type), refs.length, dimUsage(type)));
    const value = vals[0] !== undefined ? numOf(vals[0]) : undefined;
    if (value === undefined && driving) throw new Error(tr("kóta {0} potřebuje hodnotu (nebo „referenční“) – zápis: {1}", dimWord(type), dimUsage(type)));
    if (value !== undefined) {
      if (type === "angle" && !(value > 0 && value < 180)) throw new Error(tr("kóta úhel: hodnota musí být mezi 0° a 180° (zadáno {0})", fmt(value)));
      if ((type === "horizontal" || type === "vertical") && !(value >= 0)) throw new Error(tr("kóta {0}: hodnota nesmí být záporná (zadáno {1}) – stranu určuje pořadí bodů", dimWord(type), fmt(value)));
      if (type !== "angle" && type !== "horizontal" && type !== "vertical" && !(value > 0)) throw new Error(tr("kóta {0}: hodnota musí být kladná (zadáno {1})", dimWord(type), fmt(value)));
    }
    out.push({ type, refs, driving, ...(value !== undefined ? { value } : {}) });
  }
  if (!out.length) throw new Error(tr("kóta potřebuje druh, odkaz a hodnotu: kóta délka e1 50 – druhy: {0}", dimKinds()));
  return out;
}

/* ───────────────────────── id entit ───────────────────────── */
/** Krátká id (`e1`, `e2`…) pro entity zadané textem: v pořadí vzniku, za nejvyšším `eN` ve skice, bez kolize s jinými id. */
export function withTextIds(existing: SketchEntity[], added: SketchEntity[]): SketchEntity[] {
  const used = new Set(existing.map((e) => e.id));
  let n = existing.reduce((m, e) => Math.max(m, Number(/^e(\d+)$/.exec(e.id)?.[1] ?? 0)), 0);
  return added.map((e) => {
    do n++;
    while (used.has(`e${n}`));
    used.add(`e${n}`);
    return { ...e, id: `e${n}` };
  });
}
/** „e1–e4“ pro souvislou řadu, jinak výčet */
const idList = (ids: string[]) => {
  const nums = ids.map((x) => Number(/^e(\d+)$/.exec(x)?.[1] ?? NaN));
  const run = ids.length > 2 && nums.every((v, i) => Number.isFinite(v) && (i === 0 || v === nums[i - 1] + 1));
  return run ? `${ids[0]}–${ids[ids.length - 1]}` : ids.join(", ");
};

/* ───────────────────────── odkazy → SketchRef ───────────────────────── */
type Kind = "point" | "line" | "circle" | "entity";
/** `round` = entita má poloměr pro řešič (kružnice, oblouk, drážka = půl šířky, mnohoúhelník = opsaná kružnice) */
type Res = { ref: SketchRef; kind: Kind; origin?: boolean; round?: boolean; text: string };
const entLabel = (t: SketchEntity["type"]): string =>
  ({ line: tr("úsečka"), arc: tr("oblouk"), circle: tr("kružnice"), rect: tr("obdélník"), polygon: tr("mnohoúhelník"), slot: tr("drážka"), polyline: tr("lomená čára"), spline: tr("spline"), point: tr("bod"), ellipse: tr("elipsa") })[t];
const kindLabel = (k: Kind): string => ({ point: tr("bod"), line: tr("úsečka"), circle: tr("kružnice / oblouk"), entity: tr("entita") })[k];

/** platné klíče bodů a stran entity (pro chybovou hlášku) */
function validKeys(e: SketchEntity): string[] {
  const keys = Object.keys(keyPoints(e)).filter((k) => !(e.type === "point" && k === "p"));
  if (e.type === "arc") keys.splice(1, 0, "b");
  if (e.type === "rect" || e.type === "polygon") for (let i = 0; i < (e.type === "rect" ? 4 : Math.max(3, Math.round(e.sides))); i++) keys.push(`s${i}`);
  if (e.type === "polyline" || e.type === "spline") for (let i = 0; i < e.points.length - (e.closed ? 0 : 1); i++) keys.push(`g${i}`);
  return keys;
}
/** český / anglický / německý název bodu → klíč entity (střed úsečky = „mid“, střed kružnice = „center“) */
function normKey(e: SketchEntity, k: string): string {
  const f = fold(k);
  const last = e.type === "polyline" || e.type === "spline" ? `p${e.points.length - 1}` : e.type === "arc" ? "c" : "b";
  if (["stred", "center", "centre", "mitte", "mittelpunkt"].includes(f)) return e.type === "line" ? "mid" : e.type === "point" ? "p" : "center";
  if (["pulka", "polovina", "mid", "middle"].includes(f)) return e.type === "line" || e.type === "arc" ? "mid" : "center";
  if (["zacatek", "start", "anfang", "begin"].includes(f)) return e.type === "polyline" || e.type === "spline" ? "p0" : "a";
  if (["konec", "end", "ende"].includes(f)) return last;
  return f;
}

/** Stav jednoho řádku: skica, mapa entit, přidané vazby (pomocný bod počátku vznikne jen při potřebě). */
class Work {
  map: Map<string, SketchEntity>;
  extraEntities: SketchEntity[] = [];
  extraCons: SketchConstraint[] = [];
  constructor(public sk: SketchF) {
    this.map = new Map(sk.entities.map((e) => [e.id, e]));
  }
  /** pomocný bod v počátku (id „O“), vazbený pevně v [0; 0] – pro vazby a kóty, které potřebují počátek jako bod */
  origin(): SketchRef {
    const have = this.map.get(ORIGIN_ID);
    if (have && have.type === "point") return { e: ORIGIN_ID, k: "p" };
    let id = ORIGIN_ID;
    for (let i = 1; this.map.has(id); i++) id = `${ORIGIN_ID}${i}`;
    const p: SketchEntity = { id, type: "point", p: [0, 0], construction: true };
    this.map.set(id, p);
    this.extraEntities.push(p);
    this.extraCons.push({ id: uid(), type: "fixed", refs: [{ e: id, k: "p" }], value: [0, 0] });
    return { e: id, k: "p" };
  }
  resolve(r: TextRef): Res {
    if ("origin" in r) return { ref: { e: ORIGIN_ID, k: "p" }, kind: "point", origin: true, text: tr("počátek") };
    const e = this.map.get(r.e);
    if (!e) throw new Error(tr("entita „{0}“ ve skice „{1}“ není – entity: {2}", r.e, this.sk.name, [...this.map.keys()].join(", ") || "—"));
    const text = refText(r);
    if (!r.k) {
      if (e.type === "point") return { ref: { e: e.id, k: "p" }, kind: "point", text };
      if (e.type === "line") return { ref: { e: e.id, k: "self" }, kind: "line", text };
      // jako skicář: vazby ke kružnici jen u kružnice a oblouku; poloměr / průměr i u drážky a mnohoúhelníku
      const round = !!refCircle(this.map, { e: e.id, k: "self" });
      return { ref: { e: e.id, k: "self" }, kind: e.type === "circle" || e.type === "arc" ? "circle" : "entity", round, text };
    }
    const k = normKey(e, r.k);
    if (/^[gs]\d+$/.test(k) && refLine(this.map, { e: e.id, k })) return { ref: { e: e.id, k }, kind: "line", text };
    if (k !== "self" && refPoint(this.map, { e: e.id, k })) return { ref: { e: e.id, k }, kind: "point", text };
    throw new Error(tr("entita {0} ({1}) nemá bod ani stranu „{2}“ – lze: {3}", e.id, entLabel(e.type), r.k, validKeys(e).join(", ") || "—"));
  }
  /** výsledný odkaz pro uložení (počátek → pomocný bod) */
  out(x: Res): SketchRef {
    return x.origin ? this.origin() : x.ref;
  }
}
/** bod: kružnice / oblouk bez klíče se bere jako její střed */
const asPoint = (x: Res): Res => (x.kind === "circle" && x.ref.k === "self" ? { ...x, ref: { e: x.ref.e, k: "center" }, kind: "point" } : x);
function want(what: string, x: Res, kinds: Kind[], usage: string) {
  if (!kinds.includes(x.kind)) throw new Error(tr("{0}: „{1}“ je {2}, čeká se {3} – zápis: {4}", what, x.text, kindLabel(x.kind), kinds.map(kindLabel).join(tr(" nebo ")), usage));
}

/** Vazba z textu → vazby skice (počátek u „shodně“ / „soustředně“ = pevný bod v [0; 0], jinak pomocný bod počátku). */
function buildConstraint(w: Work, s: ConstraintSpec): SketchConstraint[] {
  const what = tr("vazba {0}", conWord(s.type));
  const use = conUsage(s.type);
  const rs = s.refs.map((r) => w.resolve(r));
  const C = (refs: SketchRef[], value?: number[]): SketchConstraint => ({ id: uid(), type: s.type, refs, ...(value ? { value } : {}) });
  const P = (x: Res) => {
    const p = asPoint(x);
    want(what, p, ["point"], use);
    return p;
  };
  const L = (x: Res) => (want(what, x, ["line"], use), x);
  switch (s.type) {
    case "horizontal":
    case "vertical": {
      if (rs.length === 1) return [C([w.out(L(rs[0]))])];
      const [a, b] = rs.map(P);
      if (a.origin && b.origin) throw new Error(tr("{0}: oba odkazy jsou počátek – zápis: {1}", what, use));
      return [C([w.out(a), w.out(b)])];
    }
    case "coincident":
    case "concentric": {
      const [a, b] = s.type === "coincident" ? rs.map(P) : rs.map((x) => (x.kind === "point" ? x : (want(what, x, ["point", "circle"], use), x)));
      if (a.origin && b.origin) throw new Error(tr("{0}: oba odkazy jsou počátek – zápis: {1}", what, use));
      if (s.type === "concentric" && a.kind !== "circle" && b.kind !== "circle") throw new Error(tr("{0}: aspoň jeden odkaz musí být kružnice nebo oblouk – zápis: {1}", what, use));
      // shodně s počátkem / soustředně s počátkem = bod (střed) pevně v [0; 0] – bez pomocné entity, jako „pevně“ ve skicáři
      const o = a.origin ? b : b.origin ? a : null;
      if (o) return [{ id: uid(), type: "fixed", refs: [asPoint(o).ref], value: [0, 0] }];
      // soustředně kružnice + bod jiné kružnice / oblouku (ne střed): řešič bere u kružnicových entit vždy střed → shodně střed–bod
      const pt = s.type === "concentric" ? [a, b].find((x) => x.kind === "point" && !x.origin && x.ref.k !== "center" && refCircle(w.map, x.ref)) : undefined;
      if (pt) return [{ id: uid(), type: "coincident", refs: [asPoint(pt === a ? b : a).ref, pt.ref] }];
      return [C([w.out(a), w.out(b)])];
    }
    case "parallel":
    case "perpendicular":
    case "collinear":
      return [C(rs.map((x) => L(x).ref))];
    case "tangent": {
      rs.forEach((x) => want(what, x, ["line", "circle"], use));
      if (!rs.some((x) => x.kind === "circle")) throw new Error(tr("{0}: aspoň jeden odkaz musí být kružnice nebo oblouk – zápis: {1}", what, use));
      return [C(rs.map((x) => x.ref))];
    }
    case "equal": {
      rs.forEach((x) => want(what, x, ["line", "circle"], use));
      if (rs[0].kind !== rs[1].kind) throw new Error(tr("{0}: obě entity musí být stejného druhu (dvě úsečky, nebo dvě kružnice / oblouky) – zápis: {1}", what, use));
      return [C(rs.map((x) => x.ref))];
    }
    case "fixed": {
      const x = rs[0];
      if (x.origin) throw new Error(tr("{0}: počátek je pevný sám o sobě – zápis: {1}", what, use));
      if (x.kind === "point") return [C([x.ref], s.at ? [...s.at] : [...refPoint(w.map, x.ref)!])];
      if (s.at) throw new Error(tr("{0}: souřadnice lze zadat jen u bodu (e1.a 10 20) – zápis: {1}", what, use));
      return [C([x.ref], paramsOf(w.map.get(x.ref.e)!))];
    }
    case "midpoint":
    case "pointOnCurve": {
      // pořadí odkazů nerozhoduje: bod + úsečka (středem), bod + křivka (na křivce)
      const curveKinds: Kind[] = s.type === "midpoint" ? ["line"] : ["line", "circle"];
      const ci = curveKinds.includes(rs[1].kind) ? 1 : curveKinds.includes(rs[0].kind) ? 0 : -1;
      if (ci < 0) throw new Error(tr("{0}: chybí {1} – zápis: {2}", what, curveKinds.map(kindLabel).join(tr(" nebo ")), use));
      const p = P(rs[1 - ci]);
      return [C([w.out(p), rs[ci].ref])];
    }
    case "symmetric": {
      const li = rs.findIndex((x) => x.kind === "line");
      if (li < 0) throw new Error(tr("{0}: chybí osa (úsečka) – zápis: {1}", what, use));
      const pts = rs.filter((_, i) => i !== li).map(P);
      return [C([w.out(pts[0]), w.out(pts[1]), rs[li].ref])];
    }
  }
}

/** Kóta z textu → kóta skice (hodnota referenční kóty = naměřená). */
function buildDim(w: Work, s: DimSpec): SketchDim {
  const what = tr("kóta {0}", dimWord(s.type));
  const use = dimUsage(s.type);
  const rs = s.refs.map((r) => w.resolve(r));
  let type = s.type;
  let refs: SketchRef[];
  const L = (x: Res) => (want(what, x, ["line"], use), x);
  const PL = (x: Res) => {
    const p = asPoint(x);
    want(what, p, ["point", "line"], use);
    return p;
  };
  /** konce úsečky / strany */
  const ends = (x: Res): SketchRef[] => {
    const e = w.map.get(x.ref.e)!;
    if (x.ref.k === "self") return [{ e: e.id, k: "a" }, { e: e.id, k: "b" }];
    const i = Number(x.ref.k.slice(1));
    if (e.type === "rect" || e.type === "polygon") {
      const n = e.type === "rect" ? 4 : Math.max(3, Math.round(e.sides));
      return [{ e: e.id, k: `c${i % n}` }, { e: e.id, k: `c${(i + 1) % n}` }];
    }
    const n = e.type === "polyline" || e.type === "spline" ? e.points.length : 1;
    return [{ e: e.id, k: `p${i}` }, { e: e.id, k: `p${(i + 1) % n}` }];
  };
  switch (s.type) {
    case "length":
      refs = [L(rs[0]).ref];
      break;
    case "distance": {
      if (rs.length === 1) {
        type = "length";
        refs = [L(rs[0]).ref];
        break;
      }
      const [a, b] = rs.map(PL);
      if (a.origin && b.origin) throw new Error(tr("{0}: oba odkazy jsou počátek – zápis: {1}", what, use));
      if (a.kind === "line" && b.kind === "line") {
        const la = refLine(w.map, a.ref)!;
        const lb = refLine(w.map, b.ref)!;
        const u = [la[1][0] - la[0][0], la[1][1] - la[0][1]];
        const v = [lb[1][0] - lb[0][0], lb[1][1] - lb[0][1]];
        if (Math.abs(u[0] * v[1] - u[1] * v[0]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]) || 1) > 1e-3) throw new Error(tr("{0}: vzdálenost dvou úseček jen u rovnoběžných – jinak kóta úhel nebo vzdálenost bodů", what));
      }
      refs = [w.out(a), w.out(b)];
      break;
    }
    case "horizontal":
    case "vertical": {
      if (rs.length === 1) {
        refs = ends(L(rs[0]));
        break;
      }
      const [a, b] = rs.map(asPoint);
      want(what, a, ["point"], use);
      want(what, b, ["point"], use);
      if (a.origin && b.origin) throw new Error(tr("{0}: oba odkazy jsou počátek – zápis: {1}", what, use));
      refs = [w.out(a), w.out(b)];
      break;
    }
    case "radius":
    case "diameter":
      if (!rs[0].round) want(what, rs[0], ["circle"], use);
      refs = [rs[0].ref];
      break;
    case "angle":
      refs = rs.map((x) => L(x).ref);
      break;
    case "arcLength": {
      const e = w.map.get(rs[0].ref.e);
      if (rs[0].origin || e?.type !== "arc" || rs[0].ref.k !== "self") throw new Error(tr("{0}: „{1}“ není oblouk – zápis: {2}", what, rs[0].text, use));
      refs = [rs[0].ref];
      break;
    }
  }
  const d: SketchDim = { id: uid(), type, refs, value: 0, driving: s.driving };
  const m = new Map(w.map);
  const measured = measureDim(m, d);
  if (measured == null) throw new Error(tr("{0}: tuto kombinaci nelze okótovat – zápis: {1}", what, use));
  d.value = s.driving && s.value !== undefined ? s.value : Math.round(measured * 1e6) / 1e6;
  return d;
}

/* ───────────────────────── řešení a stav určenosti ───────────────────────── */
/** Stav určenosti stejnými slovy jako skicář (spodní lišta skicáře). */
export function dofText(a: SketchAnalysis): string {
  if (a.status === "over") return a.conflicts.length ? tr("Přeurčeno – konflikt ({0})", a.conflicts.length) : tr("Přeurčeno – nadbytečné vazby ({0})", a.redundant.length);
  return a.dof === 0 ? tr("Plně určeno") : tr("Nedourčeno ({0} st. volnosti)", a.dof);
}
const crefText = (r: SketchRef, ents: Map<string, SketchEntity>) => {
  const e = ents.get(r.e);
  if (e?.type === "point" && e.construction && r.e.startsWith(ORIGIN_ID)) return tr("počátek");
  return r.k === "self" || (e?.type === "point" && r.k === "p") ? r.e : `${r.e}.${r.k}`;
};
/** popis vazby / kóty v zápisu příkazu (lze napsat zpět do konzole) */
export function describeConstraint(c: SketchConstraint, ents: Map<string, SketchEntity>): string {
  const refs = c.refs.map((r) => crefText(r, ents)).join(" ");
  const val = c.type === "fixed" && c.value?.length === 2 && c.refs[0]?.k !== "self" ? ` ${fmt(c.value[0])} ${fmt(c.value[1])}` : "";
  return `${conWord(c.type)} ${refs}${val}`;
}
export function describeDim(d: SketchDim, ents: Map<string, SketchEntity>): string {
  return `${dimWord(d.type)} ${d.refs.map((r) => crefText(r, ents)).join(" ")} ${fmt(d.value)}${d.driving ? "" : " " + tr("referenční")}`;
}

/** Vyřeší skicu (vazby + řídicí kóty) a vrátí novou skicu, stav určenosti a text výsledku. Nekonverguje-li řešič, geometrie zůstane. */
export function solveSketchFeature(sk: SketchF): { feature: SketchF; ok: boolean; analysis: SketchAnalysis; text: string } {
  const cons = sk.constraints ?? [];
  const dims = sk.dims ?? [];
  const res = solveSketch(sk.entities, cons, dims);
  const entities = res.ok ? res.entities : sk.entities;
  const analysis = analyzeSketch(entities, cons, dims);
  const ents = new Map(entities.map((e) => [e.id, e]));
  const bad = [...new Set([...analysis.conflicts, ...analysis.redundant])];
  const detail = bad.length
    ? ": " +
      bad
        .map((id) => {
          const c = cons.find((x) => x.id === id);
          if (c) return describeConstraint(c, ents);
          const d = dims.find((x) => x.id === id);
          return d ? tr("kóta {0}", describeDim(d, ents)) : id;
        })
        .join(", ")
    : "";
  const fail = res.ok ? "" : tr(" · řešič nenašel řešení (odchylka {0}), geometrie zůstala beze změny; vazby a kóty zůstaly uložené – opravte nebo smažte tu, která je v rozporu", res.residual >= 0.001 ? fmt(res.residual) : res.residual.toExponential(1));
  return { feature: { ...sk, entities }, ok: res.ok && analysis.status !== "over", analysis, text: dofText(analysis) + detail + fail };
}

/** skica bloku (založená tímto vstupem), jinak skica otevřená ve skicáři (`openId`), jinak poslední skica dokumentu */
export function targetSketch(features: Feature[], target?: SketchTarget, openId?: string | null): number {
  if (target) {
    const i = features.findIndex((f) => f.id === target.id && f.type === "sketch");
    if (i < 0) throw new Error(tr("skica z řádku {0} nevznikla – entity, vazby a kóty nemají kam (opravte řádek {0})", target.line));
    return i;
  }
  const open = openId ? features.findIndex((f) => f.id === openId && f.type === "sketch") : -1;
  if (open >= 0) return open;
  for (let i = features.length - 1; i >= 0; i--) if (features[i].type === "sketch") return i;
  throw new Error(tr("není žádná skica – nejdřív „skica XY: …“"));
}

/**
 * Provede operaci skici nad historií prvků (pole se upraví na místě) a vrátí řádky protokolu.
 * Entity dostanou id e1, e2…; po vazbách a kótách (a na konci bloku skici s vazbami) se skica vyřeší.
 * Cíl: skica bloku, jinak skica otevřená ve skicáři (`openSketchId`), jinak poslední skica. Vazba nebo kóta, která by
 * skicu přeurčila (v rozporu, nebo nadbytečná), se nepřidá – protokol ji ohlásí ✗ (skica nezůstane tiše přeurčená
 * a textem by nešla opravit).
 */
export function applySketchOp(features: Feature[], op: SketchOp, openSketchId?: string | null): string[] {
  const i = targetSketch(features, op.sketch, openSketchId);
  const sk = features[i] as SketchF;
  if (op.k === "entities") {
    const m = addWithAutoClose(sk, withTextIds(sk.entities, op.entities)); // uzavření lomených čar podle celé skici (poly-close.ts)
    const ents = m.added;
    let next: SketchF = { ...sk, ...m.patch };
    const n = ents.length;
    const out = [`${tr("✓ {0} {1} do skici „{2}“", n, n === 1 ? tr("entita") : n < 5 ? tr("entity") : tr("entit"), sk.name)}${n ? ` (${idList(ents.map((e) => e.id))})` : ""}`, ...m.notes];
    if (op.end && (next.constraints?.length || next.dims?.length)) {
      const r = solveSketchFeature(next);
      next = r.feature;
      out.push(`${r.ok ? "✓" : "⚠"} ${tr("skica „{0}“: {1}", sk.name, r.text)}`);
    }
    features[i] = next;
    return out;
  }
  const w = new Work(sk);
  // celý řádek se nejdřív přečte (chybný odkaz = chyba řádku, nic se nepřidá); položky se pak přidávají po jedné
  type Item = { cons: SketchConstraint[]; dim?: SketchDim; text: string };
  const items: Item[] =
    op.k === "constraints"
      ? op.items.map((s) => {
          const cons = buildConstraint(w, s);
          return { cons, text: cons.map((c) => describeConstraint(c, w.map)).join(", ") };
        })
      : op.items.map((s) => {
          const dim = buildDim(w, s);
          return { cons: [], dim, text: describeDim(dim, w.map) };
        });
  const refsOf = (x: Item) => [...x.cons, ...(x.dim ? [x.dim] : [])].flatMap((c) => c.refs.map((r) => r.e));
  const bad = (a: SketchAnalysis) => new Set([...a.conflicts, ...a.redundant]);
  let cur: SketchF = { ...sk, entities: [...sk.entities, ...w.extraEntities], constraints: [...(sk.constraints ?? []), ...w.extraCons] };
  let last = solveSketchFeature(cur);
  const before = bad(last.analysis); // přeurčení, které ve skice bylo už předtím, se novým položkám nepřičítá
  const kept: Item[] = [];
  const refused: string[] = [];
  for (const x of items) {
    const trial: SketchF = { ...cur, constraints: [...(cur.constraints ?? []), ...x.cons], ...(x.dim ? { dims: [...(cur.dims ?? []), x.dim] } : {}) };
    const r = solveSketchFeature(trial);
    const fresh = [...bad(r.analysis)].filter((id) => !before.has(id));
    if (fresh.length || (last.ok && !r.ok)) {
      const own = new Set([...x.cons.map((c) => c.id), ...(x.dim ? [x.dim.id] : [])]);
      const conflict = r.analysis.conflicts.some((id) => !before.has(id)) || (!r.ok && r.analysis.status !== "over");
      const ents = new Map(trial.entities.map((e) => [e.id, e]));
      const others = fresh
        .filter((id) => !own.has(id))
        .map((id) => {
          const c = trial.constraints?.find((q) => q.id === id);
          if (c) return describeConstraint(c, ents);
          const d = trial.dims?.find((q) => q.id === id);
          return d ? tr("kóta {0}", describeDim(d, ents)) : id;
        });
      const what = op.k === "constraints" ? tr("vazba {0}", x.text) : tr("kóta {0}", x.text);
      const why = conflict ? tr("v rozporu s dosavadními vazbami a kótami") : tr("nadbytečná: tutéž geometrii už určují dosavadní vazby a kóty");
      refused.push(`✗ ${tr("{0} ve skice „{1}“ nepřidána – {2}", what, sk.name, why)}${others.length ? ` (${others.join(", ")})` : ""}`);
      continue;
    }
    cur = r.feature;
    last = r;
    kept.push(x);
  }
  if (!kept.length) return refused;
  // pomocný bod počátku jen pro přidané položky
  const used = new Set(kept.flatMap(refsOf));
  const extra = new Set(w.extraEntities.filter((e) => !used.has(e.id)).map((e) => e.id));
  if (extra.size) {
    last = solveSketchFeature({ ...cur, entities: cur.entities.filter((e) => !extra.has(e.id)), constraints: (cur.constraints ?? []).filter((c) => !c.refs.some((r) => extra.has(r.e))) });
    cur = last.feature;
  }
  features[i] = cur;
  const text = kept.map((x) => x.text).join(", ");
  const head = op.k === "constraints" ? tr("vazby ve skice „{0}“: {1}", sk.name, text) : tr("kóty ve skice „{0}“: {1}", sk.name, text);
  return [`${last.ok ? "✓" : "⚠"} ${head} → ${last.text}`, ...refused];
}

/* ───────────────────────── stav skici pro textový stav ───────────────────────── */
/** Entita s id v textovém stavu: „e1 úsečka [0; 0]→[60; 0]“. */
export function entityText(e: SketchEntity): string {
  const c: Vec2 = "cx" in e ? [e.cx, e.cy] : [0, 0];
  const body = ((): string => {
    switch (e.type) {
      case "line":
        return `${tr("úsečka")} ${pt(e.a)}→${pt(e.b)}`;
      case "arc":
        return `${tr("oblouk")} ${pt(e.a)}→${pt(e.c)} ${tr("přes")} ${pt(e.b)}`;
      case "circle":
        return `${tr("kružnice Ø{0}", fmt(2 * e.r))} ${pt(c)}`;
      case "rect":
        return `${tr("obdélník {0}×{1}", fmt(e.w), fmt(e.h))} ${pt(c)}${e.angle ? ` ∠${fmt(e.angle)}°` : ""}`;
      case "polygon":
        return `${tr("{0}-úhelník", e.sides)} Ø${fmt(2 * e.r)} ${pt(c)}`;
      case "slot":
        return `${tr("drážka {0}×{1}", fmt(e.length), fmt(e.width))} ${pt(c)}${e.angle ? ` ∠${fmt(e.angle)}°` : ""}`;
      case "polyline":
        return `${tr("čára {0} b.", e.points.length)} ${e.points.map(pt).join("→")} ${e.closed ? `↺ ${e.autoClose ? tr("uzavřená automaticky") : tr("uzavřená")}` : tr("otevřená")}`;
      case "spline":
        return `${tr("spline {0} b.", e.points.length)} ${e.points.map(pt).join("→")}${e.closed ? "↺" : ""}${tangentSummary(e) ? ` ${tr("tečny")} ${tangentSummary(e, fmt)}` : ""}`;
      case "point":
        return `${tr("bod")} ${pt(e.p)}`;
      case "ellipse":
        return `${tr("elipsa")} ${fmt(e.rx)}×${fmt(e.ry)} ${pt(c)}`;
    }
  })();
  return `${e.id} ${body}${e.construction ? tr(" (pomocná)") : ""}${e.type === "line" && e.autoClose ? tr(" (uzavírá čáru se zaoblenými rohy – automaticky)") : ""}`;
}
/** nejvíc entit, které textový stav vypíše jednotlivě (s id) – u větších skic jen počet */
export const STATUS_MAX_ENTITIES = 40;
/** Doplňkové řádky textového stavu u skici: entity s id (do 40 entit), počet vazeb a kót a stav určenosti. */
export function sketchStatusLines(f: SketchF, indent = "    "): string[] {
  const out: string[] = [];
  const n = f.entities.length;
  if (n && n <= STATUS_MAX_ENTITIES) out.push(indent + tr("entity: {0}", f.entities.map(entityText).join(" · ")));
  else if (n) out.push(indent + tr("entit {0} – jednotlivě s id se vypisují jen skici do {1} entit", n, STATUS_MAX_ENTITIES));
  const nc = f.constraints?.length ?? 0;
  const nd = f.dims?.length ?? 0;
  if (nc || nd) out.push(indent + tr("vazby {0}, kóty {1}{2}", nc, nd, n <= STATUS_MAX_ENTITIES ? ` · ${dofText(analyzeSketch(f.entities, f.constraints ?? [], f.dims ?? []))}` : ""));
  // vazby a kóty s čísly v1, k1 (pořadí ve skice) – pro „smazat v1“, „kóta k1 65“, „kóta k1 referenční“ (agent-edit.ts)
  if (n <= STATUS_MAX_ENTITIES) {
    const ents = new Map(f.entities.map((e) => [e.id, e]));
    if (nc && nc <= STATUS_MAX_ENTITIES) out.push(indent + tr("vazby: {0}", (f.constraints ?? []).map((c, i) => `v${i + 1} ${describeConstraint(c, ents)}`).join(" · ")));
    if (nd && nd <= STATUS_MAX_ENTITIES) out.push(indent + tr("kóty: {0}", (f.dims ?? []).map((d, i) => `k${i + 1} ${describeDim({ ...d, driving: true }, ents).replace(/ (\S+)$/, " = $1")}${d.driving ? "" : " " + tr("referenční")}`).join(" · ")));
  }
  out.push(...profileStatusLines(f.entities, indent)); // obrysy a proč profil není platný (profile-check.ts)
  return out;
}

/* ───────────────────────── skica na ploše / pomocné rovině ───────────────────────── */
/** Co z jádra potřebuje založení skici na ploše (rozhraní `cad` z client.ts; v testech náhrada). */
export type SketchKernel = {
  build: (doc: CadDoc) => Promise<Pick<BuildResult, "metrics" | "status" | "resolved">>;
  face: (index: number) => Promise<{ planar: boolean } | null>;
  refInfo: (doc: CadDoc, ref: Ref) => Promise<{ sig: Sig | null; error?: string }>;
  topology?: (doc: CadDoc) => Promise<{ faces: FaceLite[]; bbox: [Vec3, Vec3] } | null>;
  /** výběr ploch pravidlem (`selectFaces` z agent.ts) – pro `skica plocha horní` */
  selectFaces?: (rule: string[], faces: FaceLite[], bbox: [Vec3, Vec3]) => number[];
};
const vecText = (v: number[]) => `[${v.map(fmt).join("; ")}]`;
const axisName = (n?: number[]) => {
  if (!n) return "";
  const k = [0, 1, 2].reduce((a, b) => (Math.abs(n[b]) > Math.abs(n[a]) ? b : a), 0);
  return Math.abs(n[k]) > 0.999 ? `${n[k] > 0 ? "+" : "−"}${"XYZ"[k]}` : vecText(n);
};
/** rovinné plochy tělesa jako nápověda do chybové hlášky (F číslo, normála, střed) */
async function planarFaces(k: SketchKernel, doc: CadDoc): Promise<string> {
  const t = await k.topology?.(doc).catch(() => null);
  if (!t) return "";
  const list = t.faces.filter((f) => f.planar).slice(0, 16).map((f) => `F${f.index + 1} (${tr("normála {0}", axisName(f.normal))}${f.center ? `, ${tr("střed {0}", vecText(f.center))}` : ""})`);
  return list.length ? " " + tr("– rovinné plochy: {0}", list.join(", ")) : "";
}

/**
 * Založí skicu na rovinné ploše (F číslo jako popisky pro výběr / `window.mncad.hints()`, F1 = plocha s indexem 0) nebo na pomocné
 * rovině podle názvu. Plocha dostane otisk (`sig`) stejně jako při výběru myší (`cad.refInfo`), takže odkaz přežije změnu
 * historie; rovinu (`plane`) vyřeší stavba stejně jako u skici s asociativní rovinou v GUI (`result.resolved.planes`).
 */
export async function sketchOnPlane(f0: Feature, op: Pick<SketchOnOp, "on" | "offset" | "flip">, doc: CadDoc, k: SketchKernel): Promise<{ feature: SketchF; log: string }> {
  if (f0.type !== "sketch") throw new Error("sketchOnPlane: není skica");
  let f: SketchF = { ...f0 };
  let where: string;
  if ("face" in op.on || "faceRule" in op.on) {
    const r = await k.build(doc);
    if (!r.metrics) throw new Error(tr("skica na ploše: dokument nemá těleso – nejdřív vytvořte tvar (kvádr, vysunutí…)"));
    let n: number;
    let rule = "";
    if ("faceRule" in op.on) {
      // plocha pravidlem jako u skořepiny: rovinné plochy tělesa, pravidlo musí vybrat právě jednu
      rule = op.on.faceRule.join(" ");
      const t = k.topology && k.selectFaces ? await k.topology(doc) : null;
      if (!t || !k.selectFaces) throw new Error(tr("skica na ploše: dokument nemá těleso – nejdřív vytvořte tvar (kvádr, vysunutí…)"));
      const idx = k.selectFaces(op.on.faceRule, t.faces.filter((x) => x.planar), t.bbox);
      if (idx.length !== 1) throw new Error(tr("pravidlu „{0}“ odpovídá {1} rovinných ploch – zadejte ho jednoznačně (horní, spodní, +X, -Y…) nebo plochu číslem (F3){2}", rule, idx.length, await planarFaces(k, doc)));
      n = idx[0] + 1;
    } else n = op.on.face;
    if (!(n >= 1 && n <= r.metrics.faces)) throw new Error(tr("plocha F{0} v tělese není – těleso má {1} ploch (F1 až F{1}){2}", n, r.metrics.faces, await planarFaces(k, doc)));
    const index = n - 1;
    const info = await k.face(index);
    if (!info?.planar) throw new Error(tr("plocha F{0} není rovinná – skicu lze založit jen na rovinné ploše{1}", n, await planarFaces(k, doc)));
    const ri = await k.refInfo(doc, { kind: "face", index });
    if (ri.error) throw new Error(tr("plochu F{0} nelze použít: {1}", n, ri.error));
    const ref: Ref = ri.sig ? { kind: "face", index, sig: ri.sig } : { kind: "face", index };
    f.planeDef = { kind: "face", ref, ...(op.offset ? { offset: op.offset } : {}), ...(op.flip ? { flip: true } : {}) };
    where = tr("na ploše F{0}", n) + (rule ? ` (${rule})` : "");
  } else {
    const q = fold(op.on.datum.trim());
    const datums = doc.features.filter((x) => x.type === "datum");
    const hit = ["$last", "posledni", "last", "letzte"].includes(q) ? datums[datums.length - 1] : [...datums].reverse().find((x) => fold(x.name) === q);
    if (!hit) throw new Error(tr("pomocná rovina „{0}“ v dílu není – pomocné roviny: {1}", op.on.datum, datums.map((x) => x.name).join(", ") || tr("žádné (vytvoří ji např. prvek datum)")));
    f.planeDef = { kind: "datum", featureId: hit.id, ...(op.offset ? { offset: op.offset } : {}) };
    where = tr("na pomocné rovině „{0}“", hit.name);
  }
  if (op.offset) where += ` ${op.offset > 0 ? "+" : ""}${fmt(op.offset)} mm`;
  if (op.flip && !("datum" in op.on)) where += tr(" (obráceně)");
  // rovinu vyřeší stavba (stejně jako GUI: výsledek stavby promítne vyřešenou rovinu do dokumentu)
  const r2 = await k.build({ ...doc, features: [...doc.features, f] });
  const plane: SketchPlane | undefined = r2.resolved?.planes?.[f.id];
  if (!plane) throw new Error(tr("rovinu skice {0} se nepodařilo určit: {1}", where, r2.status.find((s) => s.id === f.id)?.error ?? tr("neznámá chyba")));
  f = { ...f, plane };
  const desc = plane.kind === "custom" ? tr("počátek {0}, normála {1}, osa X skici {2}", vecText(plane.origin), axisName(plane.normal), axisName(plane.xDir)) : `${plane.name} ${fmt(plane.offset)}`;
  return { feature: f, log: tr("✓ {0} {1} – rovina: {2}", f.name, where, desc) };
}
