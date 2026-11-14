/**
 * Doplněné textové zápisy podle auditu mezer (12. vlna) – odkazy, které dřív šly jen přes `prvek` / formulář (CS / EN / DE):
 *
 *   rotovat [úhel] osa hrana E3 | osa E3 | osa plocha F7 (osa válce) | osa "Osa 1" | osa body V1 V5 [symetricky] [odebrat…]
 *   pole N rozteč P směr hrana E3 | směr E3 | směr body V1 V5 | směr osa "Osa 1" [N2 rozteč P2 směr …]
 *   pole kruhové N [úhel A] osa hrana E3 | osa plocha F7 | osa "Osa 1" | osa body V1 V5
 *   zrcadlit plocha F3 [odsazení N] · zrcadlit rovina "Rovina 1" [odsazení N]
 *   srazit D úhel A plocha F3 [hrany …] · srazit D1 D2 plocha F3 [hrany …]   (plocha = referenční, na ní se měří D / D1)
 *   hrany E3 E7 · otevřít F3 F5 – plochy a hrany čísly (jako popisky pro výběr) místo pravidla (`ruleNumbers`)
 *
 * Vrací `null`, když řádek nové zápisy nepoužívá – pak ho zpracuje agent.ts jako dřív. Čisté funkce bez jádra.
 */
import { tr } from "./i18n";
import { bodyOfOpts, opOfOpts, readAxis, type OptsLike } from "./agent-prim";
import type { AxisDef, Direction, PlaneDef, Ref } from "./refs";
import { uid, type Feature, type Vec3 } from "./types";

type GapOp = { k: "feature"; feature: Feature; line: number } | { k: "select"; feature: Feature; rule: string[]; line: number };
export type GapParse = { parse: (t: string[]) => OptsLike; canon: (t: string) => string; isKey: (t: string) => boolean };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const set = (...w: string[]) => new Set(w.map(fold));
const ENT = /^([efv])(\d+)$/i;
const AXISW = set("osa", "osou", "kolem", "axis", "achse", "um");
const DIRW = set("směr", "smer", "podél", "podel", "direction", "dir", "along", "richtung", "entlang");
const FACE = set("plocha", "plochy", "plochu", "ploše", "plose", "face", "fläche", "flaeche");
const PLANE = set("rovina", "rovinu", "rovině", "rovine", "plane", "ebene", "datum");
const EDGES = set("hrany", "hrana", "edges", "edge", "kanten", "kante");
const BASE_PLANES = set("xy", "xz", "yz", "pudorys", "narys", "bokorys", "top", "front", "right", "oben", "draufsicht", "vorne", "vorderansicht", "seite", "seitenansicht");
const XYZ = /^[xyz]$/i;

/** Plochy / hrany čísly v pravidle („F3 F5“, „E3 E7“) → indexy od 0; null = pravidlo slovy. Míchání čísel a slov = chyba. */
export function ruleNumbers(rule: string[], letter: "f" | "e"): number[] | null {
  const m = rule.map((w) => new RegExp(`^${letter}(\\d+)$`, "i").exec(w.trim()));
  if (!rule.length || m.every((x) => !x)) return null;
  if (m.some((x) => !x)) throw new Error(letter === "f" ? tr("čísla ploch (F3 F5) nelze míchat s pravidlem – zadejte jen čísla, nebo jen pravidlo") : tr("čísla hran (E3 E7) nelze míchat s pravidlem – zadejte jen čísla, nebo jen pravidlo"));
  return m.map((x) => {
    const n = Number(x![1]);
    if (n < 1) throw new Error(tr("čísla ploch, hran a vrcholů začínají 1 (F1, E1, V1) – „{0}“", x![0]));
    return n - 1;
  });
}

/** osa / směr s odkazem (ne prosté X / Y / Z / vektor) – jen takový řádek se zpracuje tady */
const refAxisAt = (tk: string[], i: number): boolean => {
  const n = tk[i + 1];
  if (n === undefined) return false;
  if (XYZ.test(n.replace(/^[+-]/, "")) && !/^-/.test(n)) return false;
  if (/^[+-]?(\d|[.,]\d)/.test(n)) return false;
  return true;
};

/** Směr (Direction) → osa rotace / kruhového pole (AxisDef). */
function toAxisDef(d: Direction): AxisDef {
  if (d.kind === "axis") return { kind: "global", axis: d.axis };
  if (d.kind === "edge" && d.ref.kind === "datumAxis") return { kind: "datumAxis", featureId: d.ref.featureId };
  if (d.kind === "edge") return { kind: "edge", ref: d.ref };
  if (d.kind === "faceNormal") return { kind: "cylFace", ref: d.ref };
  if (d.kind === "twoPoints") return { kind: "twoPoints", a: d.a, b: d.b };
  throw new Error(tr("osa rotace potřebuje polohu – zadejte ji hranou (osa hrana E3), válcovou plochou (osa plocha F7), dvěma body (osa body V1 V5), pomocnou osou (osa \"Osa 1\") nebo globální osou X|Y|Z"));
}

/** Vybere z tokenů osy / směry s odkazem (v pořadí) a vrátí zbytek pro `parseOpts`. */
function takeAxes(tk: string[], words: Set<string>, isKey: (t: string) => boolean): { rest: string[]; dirs: Direction[] } {
  const rest: string[] = [];
  const dirs: Direction[] = [];
  for (let i = 0; i < tk.length; i++) {
    if (words.has(fold(tk[i])) && tk[i + 1] !== undefined) {
      const d = readAxis(tk, i + 1, isKey);
      dirs.push(d.dir);
      rest.push(tk[i], "_"); // slovo zůstane jako oddělovač (čísla před a za ním se nesmí spojit: „rozteč 10 směr … 2 rozteč 20“)
      i += d.used;
      continue;
    }
    rest.push(tk[i]);
  }
  return { rest, dirs };
}

/** Řádek s novým zápisem odkazem; `null` = běžný zápis. `named` = název prvku podle typu. Cílové těleso („těleso 2“, „nové“)
 * čte z vlastního rozboru (agent.ts by z „osa body V1 V5“ přečetl anglické „body“ = těleso). */
export function parseGapLine(cmd: string, tk: string[], opts: GapParse, named: (type: Feature["type"]) => string, line: number): GapOp | null {
  const seen: { o: OptsLike | null } = { o: null };
  const parse = (rest: string[]) => (seen.o = opts.parse(rest));
  const op = parseGap(cmd, tk, { ...opts, parse }, named, line);
  const body = op && seen.o ? bodyOfOpts(seen.o) : "";
  if (op && body && !op.feature.body) op.feature.body = body;
  return op;
}

function parseGap(cmd: string, tk: string[], opts: GapParse, named: (type: Feature["type"]) => string, line: number): GapOp | null {
  const w = tk.map(fold);
  const modeOf = (o: OptsLike) => opOfOpts(o, (c) => tk.find((t) => opts.canon(t) === c) ?? c, tr("rotovat"));
  switch (cmd) {
    case "revolve": {
      const ai = w.findIndex((x) => AXISW.has(x));
      const sym = tk.some((t) => opts.canon(t) === "symmetric");
      if (!(ai >= 0 && refAxisAt(tk, ai)) && !sym) return null;
      const { rest, dirs } = takeAxes(tk, AXISW, opts.isKey);
      const o = opts.parse(rest);
      const angle = o.free[0] ?? o.nums.angle?.[0] ?? 360;
      if (!(angle > 0 && angle <= 360)) throw new Error(tr("úhel rotace musí být 0–360°: rotovat 180 osa hrana E3"));
      const f: Feature = { id: uid(), name: named("revolve"), type: "revolve", sketchId: "$last", angle, axis: "y", mode: (modeOf(o) ?? "$auto") as "add" };
      if (dirs[0]) f.axisDef = toAxisDef(dirs[0]);
      if (sym) f.symmetric = true;
      return { k: "feature", feature: f, line };
    }
    case "pattern": {
      const circular = tk.some((t) => opts.canon(t) === "circular");
      const words = circular ? AXISW : DIRW;
      const hits = w.map((x, i) => (words.has(x) && refAxisAt(tk, i) ? i : -1)).filter((i) => i >= 0);
      if (!hits.length) return null;
      const { rest, dirs } = takeAxes(tk, words, opts.isKey);
      const o = opts.parse(rest);
      if (circular) {
        const count = o.free[0] ?? o.nums.count?.[0];
        if (!(count >= 2)) throw new Error(tr("pole kruhové potřebuje počet: pole kruhové 6 [úhel 360] [osa Z] [v cx cy cz]"));
        const c = o.nums.at ?? [0, 0, 0];
        const f: Feature = { id: uid(), name: named("pattern"), type: "pattern", featureId: "$last", kind: "circular", count, angle: o.nums.angle?.[0] ?? 360, axis: "Z", center: [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0], axisDef: toAxisDef(dirs[0]) };
        return { k: "feature", feature: f, line };
      }
      const counts = o.nums.count ?? [];
      const count = o.free[0] ?? counts[0];
      const sp = o.nums.spacing ?? [];
      if (!(count >= 2) || !(sp[0] > 0)) throw new Error(tr("pole potřebuje počet a rozteč: pole 4 rozteč 25 [směr X] [počet 3 rozteč 20 směr Y]"));
      const vec = (d: Direction | undefined, dflt: Vec3): { v: Vec3; def?: Direction } => (!d ? { v: dflt } : d.kind === "axis" ? { v: d.axis === "X" ? [1, 0, 0] : d.axis === "Y" ? [0, 1, 0] : [0, 0, 1] } : d.kind === "vector" ? { v: d.v } : { v: dflt, def: d });
      const d1 = vec(dirs[0], [1, 0, 0]);
      const f: Feature = { id: uid(), name: named("pattern"), type: "pattern", featureId: "$last", kind: "linear", count, spacing: sp[0], direction: d1.v, ...(d1.def ? { dirDef: d1.def } : {}) };
      const count2 = o.free[1] ?? counts[1];
      if (count2 >= 2 && sp[1] > 0) {
        const d2 = vec(dirs[1], [0, 1, 0]);
        Object.assign(f, { count2, spacing2: sp[1], direction2: d2.v, ...(d2.def ? { dirDef2: d2.def } : {}) });
      }
      return { k: "feature", feature: f, line };
    }
    case "mirror": {
      const fi = w.findIndex((x, i) => (FACE.has(x) && ENT.test(tk[i + 1] ?? "")) || /^f\d+$/i.test(tk[i]));
      const pi = w.findIndex((x, i) => PLANE.has(x) && tk[i + 1] !== undefined && !BASE_PLANES.has(fold(tk[i + 1])) && !opts.isKey(tk[i + 1]));
      if (fi < 0 && pi < 0) return null;
      const rest = tk.filter((_, i) => !(fi >= 0 && (i === fi || (FACE.has(w[fi]) && i === fi + 1))) && !(pi >= 0 && (i === pi || i === pi + 1)));
      const o = opts.parse(rest);
      const off = o.nums.offset?.[0] ?? 0;
      let planeDef: PlaneDef;
      if (fi >= 0) {
        const t = FACE.has(w[fi]) ? tk[fi + 1] : tk[fi];
        const m = /^f(\d+)$/i.exec(t);
        if (!m || Number(m[1]) < 1) throw new Error(tr("zrcadlit plocha potřebuje číslo rovinné plochy: zrcadlit plocha F3 [odsazení N]"));
        planeDef = { kind: "face", ref: { kind: "face", index: Number(m[1]) - 1 } as Ref, ...(off ? { offset: off } : {}) };
      } else planeDef = { kind: "datum", featureId: tk[pi + 1], ...(off ? { offset: off } : {}) };
      return { k: "feature", feature: { id: uid(), name: named("mirror"), type: "mirror", plane: "YZ", offset: 0, keepOriginal: true, planeDef }, line };
    }
    case "chamfer": {
      const fi = w.findIndex((x, i) => FACE.has(x) && /^f\d+$/i.test(tk[i + 1] ?? ""));
      const hasAngle = tk.some((t) => opts.canon(t) === "angle");
      if (fi < 0) {
        if (hasAngle) throw new Error(tr("sražení s úhlem potřebuje referenční plochu (na ní se měří vzdálenost): srazit 2 úhel 30 plocha F3 [hrany …]"));
        return null;
      }
      const m = /^f(\d+)$/i.exec(tk[fi + 1])!;
      if (Number(m[1]) < 1) throw new Error(tr("čísla ploch, hran a vrcholů začínají 1 (F1, E1, V1) – „{0}“", tk[fi + 1]));
      const rest = tk.filter((_, i) => i !== fi && i !== fi + 1);
      const ei = rest.findIndex((t) => EDGES.has(fold(t)));
      const rule = ei >= 0 ? rest.slice(ei + 1).filter((t) => !opts.isKey(t) || EDGES.has(fold(t))).map(fold) : [];
      const o = opts.parse(ei >= 0 ? rest.slice(0, ei) : rest);
      const [d1, d2] = o.free;
      if (!(d1 > 0)) throw new Error(tr("srazit potřebuje velikost: srazit 1 [hrany horní]"));
      const faceRef: Ref = { kind: "face", index: Number(m[1]) - 1 };
      const f: Feature = hasAngle
        ? { id: uid(), name: named("chamfer"), type: "chamfer", distance: d1, edges: "all", kind: "distanceAngle", angle: o.nums.angle?.[0] ?? 45, faceRef }
        : { id: uid(), name: named("chamfer"), type: "chamfer", distance: d1, edges: "all", kind: "twoDistances", d2: d2 ?? d1, faceRef };
      const all = !rule.length || rule.some((x) => ["vse", "all", "vsechny", "alle", "alles"].includes(x));
      return all ? { k: "feature", feature: f, line } : { k: "select", feature: f, rule, line };
    }
  }
  return null;
}

/* ───────────── stav: odkazy u rotace, pole, zrcadlení a sražení ───────────── */
type Fmt = (n: number, d?: number) => string;
const refText = (r: Ref, name: (id: string) => string): string =>
  r.kind === "edge" ? tr("hrana E{0}", r.index + 1) : r.kind === "face" ? tr("plocha F{0}", r.index + 1) : r.kind === "vertex" ? `V${r.index + 1}` : r.kind === "datumAxis" ? tr("pomocná osa „{0}“", name(r.featureId)) : r.kind === "datumPoint" ? tr("bod „{0}“", name(r.featureId)) : r.kind;
function axisDefText(a: AxisDef, name: (id: string) => string): string {
  switch (a.kind) {
    case "global":
      return a.axis;
    case "edge":
      return refText(a.ref, name);
    case "cylFace":
      return a.ref.kind === "face" ? tr("osa plochy F{0}", a.ref.index + 1) : refText(a.ref, name);
    case "twoPoints":
      return `${refText(a.a, name)} → ${refText(a.b, name)}`;
    case "datumAxis":
      return tr("pomocná osa „{0}“", name(a.featureId));
    case "sketchX":
      return tr("osa x skici");
    case "sketchY":
      return tr("osa y skici");
    default:
      return a.kind;
  }
}
function dirText(d: Direction, fmt: Fmt, name: (id: string) => string): string {
  if (d.kind === "axis") return d.axis;
  if (d.kind === "vector") return `[${d.v.map((x) => fmt(x, 3)).join("; ")}]`;
  if (d.kind === "twoPoints") return `${refText(d.a, name)} → ${refText(d.b, name)}`;
  if (d.kind === "edge" || d.kind === "faceNormal" || d.kind === "tangent") return refText(d.ref, name);
  return d.kind;
}

/** Souhrn pro stav u prvků s odkazem (osa rotace / pole, směr pole, rovina zrcadlení, sražení od plochy); `null` = běžný souhrn. */
export function gapSummary(f: Feature, fmt: Fmt, name: (id: string) => string = (x) => x): string | null {
  switch (f.type) {
    case "revolve":
      if (!f.axisDef && !f.symmetric) return null;
      return tr("{0}°{1}, {2}, osa {3}", fmt(f.angle), f.symmetric ? tr(" symetricky") : "", f.mode, f.axisDef ? axisDefText(f.axisDef, name) : tr("osa {0} skici", f.axis));
    case "pattern":
      if (f.kind === "linear" && (f.dirDef || f.dirDef2))
        return tr("lineární {0}× po {1}, směr {2}{3}", f.count, fmt(f.spacing), f.dirDef ? dirText(f.dirDef, fmt, name) : `[${f.direction.map((x) => fmt(x, 3)).join("; ")}]`, f.count2 ? tr(" × {0}× po {1}, směr {2}", f.count2, fmt(f.spacing2 ?? 0), f.dirDef2 ? dirText(f.dirDef2, fmt, name) : `[${(f.direction2 ?? [0, 1, 0]).map((x) => fmt(x, 3)).join("; ")}]`) : "");
      if (f.kind === "circular" && f.axisDef) return tr("kruhové {0}× / {1}°, osa {2}", f.count, fmt(f.angle), axisDefText(f.axisDef, name));
      return null;
    case "mirror": {
      const p = f.planeDef;
      if (!p) return null;
      const off = "offset" in p && p.offset ? ` ${p.offset > 0 ? "+" : ""}${fmt(p.offset)}` : "";
      const only = f.featureIds?.length ? tr(", jen {0} prvků", f.featureIds.length) : "";
      if (p.kind === "face" && p.ref.kind === "face") return tr("rovina plochy F{0}{1}{2}", p.ref.index + 1, off, only);
      if (p.kind === "datum") return tr("pomocná rovina „{0}“{1}{2}", name(p.featureId), off, only);
      return null;
    }
    case "chamfer": {
      if (f.kind !== "distanceAngle" && f.kind !== "twoDistances") return null;
      const face = f.faceRef?.kind === "face" ? `F${f.faceRef.index + 1}` : "—";
      const edges = f.edges === "all" ? tr("vše") : String(f.edges.length);
      return f.kind === "distanceAngle" ? tr("{0} mm × {1}° od plochy {2}, hrany {3}", fmt(f.distance, 2), fmt(f.angle ?? 45), face, edges) : tr("{0} × {1} mm od plochy {2}, hrany {3}", fmt(f.distance, 2), fmt(f.d2 ?? f.distance, 2), face, edges);
    }
  }
  return null;
}
