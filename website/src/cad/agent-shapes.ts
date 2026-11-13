/**
 * Textové příkazy tvarů 7. vlny (CS / EN / DE) – zaoblení se setbackem, eliptické / kuželosečkové zaoblení, úkos s dělicí
 * křivkou a stupňovitý úkos. Čisté funkce bez jádra (testovatelné v Node); agent.ts je volá před běžnými příkazy.
 *
 *   zaoblit 3 hrany <pravidlo> setback 5 [vrchol V3 8 | vrchol x y z 8]
 *                                                    · fillet 3 edges … setback 5 [vertex V3 8] · verrunden 3 kanten … rückversatz 5 [ecke V3 8]
 *   zaoblit eliptické 4 2 hrany <pravidlo> [rho 0,5] · fillet elliptical 4 2 edges …        · verrunden elliptisch 4 2 kanten …
 *   úkos 3 plochy <pravidlo> dělicí "Skica 2" [stupňovitý] [směr +Z]
 *                                                    · draft 3 faces … parting "Sketch 2" [stepped] [direction +Z]
 *                                                    · schräge 3 flächen … trennlinie "Skizze 2" [gestuft] [richtung +Z]
 *   úkos 3 plochy boční [rovina XY] [odsazení 10] [směr +Z]   (bez dělicí křivky = úkos kolem neutrální roviny)
 *
 * Pravidla hran a ploch jsou stejná jako u `zaoblit` / `skořepina` (horní, svislé, boční, +X, poloměr N…), plochy i čísly F1 F2….
 */
import { tr } from "./i18n";
import type { Axis, Direction, Feature, PlaneName, Ref, Vec3 } from "./types";

type FilletF = Extract<Feature, { type: "fillet" }>;
type DraftF = Extract<Feature, { type: "draft" }>;
/** Operace kompatibilní s `AgentOp` (agent.ts): prvek přímo, nebo prvek s výběrem hran / ploch pravidlem. */
export type ShapesOp =
  | { k: "feature"; feature: Feature; line: number }
  | { k: "select"; feature: Feature; rule: string[]; line: number; into?: { path: string; kind: "faces" | "edges" } };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const isNum = (t: string) => /^[+-]?(\d+[.,]?\d*|[.,]\d+)(mm|°)?$/i.test(t);
const num = (t: string) => parseFloat(t.replace(",", "."));
const set = (...w: string[]) => new Set(w.map(fold));

const SETBACK = set("setback", "odstup", "rückversatz", "rueckversatz", "versatz");
const CONIC = set("eliptické", "elipticke", "eliptický", "elipticky", "elipsa", "kuželosečkové", "kuzelosecka", "kuželosečka", "elliptical", "elliptic", "ellipse", "conic", "elliptisch", "kegelschnitt");
const RHO = set("rho", "ρ");
const EDGES = set("hrany", "hrana", "edges", "edge", "kanten", "kante");
const FACES = set("plochy", "plocha", "faces", "face", "flächen", "fläche", "flaechen", "flaeche");
const PARTING = set("dělicí", "delici", "dělící", "delici-krivka", "parting", "partingline", "trennlinie", "trennung", "teilungslinie");
const STEP = set("stupňovitý", "stupnovity", "stupňovitě", "stupne", "stupně", "step", "stepped", "gestuft", "stufen", "stufenformig");
const DIRECTION = set("směr", "smer", "tah", "direction", "dir", "pull", "richtung", "zug", "entformung");
const PLANE = set("rovina", "plane", "ebene");
const OFFSET = set("odsazení", "odsazeni", "offset", "versatz", "abstand");
const TANGENT = set("tečně", "tecne", "tangent", "tangential", "tangentially");
const NAME = set("název", "nazev", "name", "pojmenovat");
const VERTEX = set("vrchol", "vertex", "ecke", "eckpunkt");
const BODY = set("těleso", "teleso", "body", "körper", "korper", "koerper");
const RADIUS = set("poloměr", "polomer", "radius", "r", "halbmesser");
const LONGER = set("delší", "delsi", "longer", "länger", "laenger");
const SHORTER = set("kratší", "kratsi", "shorter", "kürzer", "kuerzer");
const PLANES: Record<string, PlaneName> = { xy: "XY", xz: "XZ", yz: "YZ", pudorys: "XY", narys: "XZ", bokorys: "YZ", top: "XY", front: "XZ", right: "YZ" };
const DIRS: Record<string, Vec3> = { "+x": [1, 0, 0], "-x": [-1, 0, 0], "+y": [0, 1, 0], "-y": [0, -1, 0], "+z": [0, 0, 1], "-z": [0, 0, -1], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** klíčová slova, která ukončí pravidlo hran / ploch */
const KEYS = [SETBACK, CONIC, RHO, EDGES, FACES, PARTING, STEP, DIRECTION, PLANE, OFFSET, TANGENT, NAME, BODY, VERTEX];
const isKey = (t: string) => KEYS.some((k) => k.has(fold(t)));

/** Směr tahu: +Z / -X / z / x y z → Direction. */
function direction(tokens: string[], i: number): { dir: Direction; used: number } {
  const w = fold(tokens[i] ?? "");
  if (DIRS[w]) {
    const v = DIRS[w];
    const neg = v.some((x) => x < 0);
    const axis = (["X", "Y", "Z"] as Axis[])[v.findIndex((x) => x !== 0)];
    return { dir: neg ? { kind: "vector", v } : { kind: "axis", axis }, used: 1 };
  }
  if ([0, 1, 2].every((k) => isNum(tokens[i + k] ?? ""))) return { dir: { kind: "vector", v: [num(tokens[i]), num(tokens[i + 1]), num(tokens[i + 2])] }, used: 3 };
  throw new Error(tr("směr tahu: +Z | -Z | +X … nebo tři čísla (směr 0 0 1)"));
}

/** Pravidlo za slovem hrany / plochy: slova až po další klíčové slovo; „poloměr 5“ → r=5, „delší 20“ → len>20. */
function ruleAt(tokens: string[], i: number): { rule: string[]; end: number } {
  const rule: string[] = [];
  let j = i;
  while (j < tokens.length && !isKey(tokens[j])) {
    const w = fold(tokens[j]);
    const next = tokens[j + 1];
    if ((RADIUS.has(w) || LONGER.has(w) || SHORTER.has(w)) && next !== undefined && isNum(next)) {
      rule.push(RADIUS.has(w) ? `r=${num(next)}` : LONGER.has(w) ? `len>${num(next)}` : `len<${num(next)}`);
      j += 2;
      continue;
    }
    rule.push(w);
    j++;
  }
  return { rule, end: j };
}

type Parsed = { free: number[]; rule: string[] | null; ruleKind: "edges" | "faces" | null; values: Map<Set<string>, string[]>; flags: Set<Set<string>>; vertices: { at: Ref; d: number }[] };

/** Rozloží slova příkazu: volná čísla, pravidlo hran / ploch, hodnoty za klíčovými slovy, příznaky. */
function scan(tokens: string[]): Parsed {
  const out: Parsed = { free: [], rule: null, ruleKind: null, values: new Map(), flags: new Set(), vertices: [] };
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const w = fold(t);
    if (EDGES.has(w) || FACES.has(w)) {
      const r = ruleAt(tokens, i + 1);
      out.rule = [...(out.rule ?? []), ...r.rule];
      out.ruleKind = EDGES.has(w) ? "edges" : "faces";
      i = r.end;
      continue;
    }
    if (VERTEX.has(w)) {
      // setback pro vrchol: `vrchol V3 8` (číslo vrcholu jako popisek pro výběr) nebo `vrchol x y z 8`
      const v = /^v?(\d+)$/i.exec(tokens[i + 1] ?? "");
      if (v && isNum(tokens[i + 2] ?? "") && !isNum(tokens[i + 3] ?? "")) {
        out.vertices.push({ at: { kind: "vertex", index: Number(v[1]) - 1 }, d: num(tokens[i + 2]) });
        i += 3;
      } else if ([1, 2, 3, 4].every((k) => isNum(tokens[i + k] ?? ""))) {
        out.vertices.push({ at: { kind: "xyz", p: [num(tokens[i + 1]), num(tokens[i + 2]), num(tokens[i + 3])] }, d: num(tokens[i + 4]) });
        i += 5;
      } else throw new Error(tr("setback pro vrchol: vrchol V3 8 (číslo vrcholu a setback) nebo vrchol x y z 8"));
      continue;
    }
    if (SETBACK.has(w) || RHO.has(w) || OFFSET.has(w)) {
      const key = SETBACK.has(w) ? SETBACK : RHO.has(w) ? RHO : OFFSET;
      if (tokens[i + 1] !== undefined && isNum(tokens[i + 1])) {
        out.values.set(key, [tokens[i + 1]]);
        i += 2;
      } else {
        out.flags.add(key);
        i++;
      }
      continue;
    }
    if (PARTING.has(w) || PLANE.has(w) || NAME.has(w) || BODY.has(w)) {
      const key = PARTING.has(w) ? PARTING : PLANE.has(w) ? PLANE : NAME.has(w) ? NAME : BODY;
      const v = tokens[i + 1];
      if (v !== undefined && !isKey(v)) {
        out.values.set(key, [v]);
        i += 2;
      } else {
        out.flags.add(key);
        i++;
      }
      continue;
    }
    if (DIRECTION.has(w)) {
      const used = tokens.slice(i + 1, i + 4);
      out.values.set(DIRECTION, used);
      i += 1 + (DIRS[fold(tokens[i + 1] ?? "")] ? 1 : [0, 1, 2].every((k) => isNum(tokens[i + 1 + k] ?? "")) ? 3 : 1);
      continue;
    }
    if (CONIC.has(w) || STEP.has(w) || TANGENT.has(w)) {
      out.flags.add(CONIC.has(w) ? CONIC : STEP.has(w) ? STEP : TANGENT);
      i++;
      continue;
    }
    if (isNum(t)) out.free.push(num(t));
    else if (PLANES[w] && !out.values.has(PLANE)) out.values.set(PLANE, [t]);
    i++;
  }
  return out;
}

const allRule = (rule: string[] | null) => !rule || !rule.length || rule.some((w) => ["vse", "all", "vsechny", "alle", "alles"].includes(w));

/** Plochy čísly (F1 = první plocha) – jinak null (pravidlo). */
function faceNumbers(rule: string[]): number[] | null {
  const m = rule.map((w) => /^f?(\d+)$/i.exec(w));
  if (!rule.length || m.some((x) => !x)) return null;
  return m.map((x) => Number(x![1]) - 1).filter((n) => n >= 0);
}

/**
 * Zaoblení se setbackem / eliptické a úkos (s dělicí křivkou). `null` = jiný zápis (běžné „zaoblit R hrany …“ zpracuje agent.ts).
 * `named` vrací název prvku (číslování podle typu, případně zadaný název).
 */
export function parseShapesLine(cmd: string, tokens: string[], named: (type: "fillet" | "draft", given?: string) => string, line: number): ShapesOp | null {
  if (cmd !== "fillet" && cmd !== "draft") return null;
  const words = tokens.map(fold);
  if (cmd === "fillet" && !words.some((w) => SETBACK.has(w) || CONIC.has(w))) return null;
  const p = scan(tokens);
  const given = p.values.get(NAME)?.[0];
  if (cmd === "fillet") {
    const conic = p.flags.has(CONIC);
    const [a, b] = p.free;
    if (!(a > 0)) throw new Error(conic ? tr("eliptické zaoblení potřebuje vzdálenosti: zaoblit eliptické D1 D2 hrany <pravidlo> [rho 0,5]") : tr("zaoblení se setbackem potřebuje poloměr: zaoblit R hrany <pravidlo> setback S"));
    const f: FilletF = { id: uid(), name: named("fillet", given), type: "fillet", radius: a, edges: "all" };
    if (conic) {
      f.kind = "conic";
      f.r2 = b > 0 ? b : a;
      const rho = p.values.get(RHO)?.[0];
      if (rho !== undefined) {
        const v = num(rho);
        if (!(v > 0 && v < 1)) throw new Error(tr("rho kuželosečky musí být mezi 0 a 1 (0,5 = parabola)"));
        f.rho = v;
      }
    } else {
      f.kind = "setback";
      const s = p.values.get(SETBACK)?.[0];
      if (s !== undefined) {
        const v = num(s);
        if (!(v > 0)) throw new Error(tr("setback musí být kladný: zaoblit 3 hrany <pravidlo> setback 5"));
        f.setback = v;
      }
      for (const x of p.vertices) if (!(x.d > 0)) throw new Error(tr("setback pro vrchol musí být kladný"));
      if (p.vertices.length) f.setbacks = p.vertices;
    }
    if (p.flags.has(TANGENT)) f.tangentChain = true;
    if (allRule(p.rule)) return { k: "feature", feature: f, line };
    return { k: "select", feature: f, rule: p.rule!, line };
  }
  // úkos
  const angle = p.free[0];
  if (!(angle > 0 || angle < 0)) throw new Error(tr("úkos potřebuje úhel a plochy: úkos 3 plochy boční [dělicí \"Skica 2\"] [stupňovitý] [směr +Z]"));
  if (!p.rule || !p.rule.length || p.ruleKind !== "faces") throw new Error(tr("úkos potřebuje plochy: úkos 3 plochy boční | +X -X | F3 F5 … [dělicí \"Skica 2\"]"));
  const planeWord = p.values.get(PLANE)?.[0];
  const plane: PlaneName = planeWord ? (PLANES[fold(planeWord)] ?? "XY") : "XY";
  if (planeWord && !PLANES[fold(planeWord)]) throw new Error(tr("úkos: rovina XY | XZ | YZ (neutrální rovina), „{0}“ není základní rovina", planeWord));
  const f: DraftF = { id: uid(), name: named("draft", given), type: "draft", angle, faces: [], plane, offset: num(p.values.get(OFFSET)?.[0] ?? "0") || 0 };
  const dirTok = p.values.get(DIRECTION);
  if (dirTok) f.pull = direction(dirTok, 0).dir;
  if (p.values.has(PARTING) || p.flags.has(PARTING)) {
    f.partingSketchId = p.values.get(PARTING)?.[0] ?? "$last";
    if (!f.pull) f.pull = { kind: "axis", axis: plane === "XY" ? "Z" : plane === "XZ" ? "Y" : "X" };
  }
  if (p.flags.has(STEP)) {
    if (f.partingSketchId === undefined) throw new Error(tr("stupňovitý úkos potřebuje dělicí křivku: úkos 3 plochy boční dělicí \"Skica 2\" stupňovitý"));
    f.step = true;
  }
  if (p.flags.has(TANGENT)) f.tangentChain = true;
  const nums = faceNumbers(p.rule);
  if (nums) {
    f.faces = nums;
    return { k: "feature", feature: f, line };
  }
  if (allRule(p.rule)) throw new Error(tr("úkos všech ploch nedává smysl – vyberte boční plochy: úkos 3 plochy boční"));
  return { k: "select", feature: f, rule: p.rule, line, into: { path: "faces", kind: "faces" } };
}

const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

/** Souhrn prvku pro `stav` (null = běžné zaoblení – souhrn z agent.ts). */
export function shapesSummary(f: Feature, sketchName: (id: string) => string): string | null {
  if (f.type === "fillet") {
    const n = f.edges === "all" ? tr("vše") : String(f.edges.length);
    if (f.kind === "setback") return tr("R{0}, setback {1}{2}, hrany {3}", fmt(f.radius), fmt(f.setback ?? f.radius), f.setbacks?.length ? tr(" (+{0} vrcholů vlastní)", f.setbacks.length) : "", n);
    if (f.kind === "conic") return tr("eliptické D1 {0} × D2 {1}{2}, hrany {3}", fmt(f.radius), fmt(f.r2 ?? f.radius), f.rho !== undefined ? tr(", kuželosečka rho {0}", fmt(f.rho)) : "", n);
    return null;
  }
  if (f.type === "draft") {
    const base = tr("{0}°, ploch {1}", fmt(f.angle), f.faces.length);
    if (f.partingSketchId !== undefined) return base + tr(", dělicí křivka „{0}“{1}", sketchName(f.partingSketchId) || "—", f.step ? tr(", stupňovitý") : "");
    return base + tr(", neutrální rovina {0}", f.planeDef ? tr("odkazem") : `${f.plane}${f.offset ? ` +${fmt(f.offset)}` : ""}`);
  }
  return null;
}
