/**
 * Textový příkaz `měřit` (EN measure, DE messen) a `window.mncad.measure` – čtení zápisu a text výsledku do protokolu.
 *
 *   měřit F3 · měřit E5 · měřit V2                     údaje o ploše / hraně / vrcholu (čísla jako popisky pro výběr)
 *   měřit F3 F7 · měřit E2 E9 · měřit F3 E5 · měřit V1 x y z   vzdálenost, úhel, rovnoběžnost, rozteč os
 *   měřit těleso · měřit díry · měřit válce             obálka / objem / hmotnost; seznam děr; vnější válce
 *   měřit plocha horní · měřit hrany kruhové            entity vybrané pravidlem jako u skořepiny / zaoblení
 *   měřit Hřídel:F3 Deska:F1                            v sestavě: komponenta podle názvu
 *
 * Čisté funkce bez jádra (testovatelné v Node); měření samo je v measure.ts (worker), provedení v components/cad/agent-measure-run.ts.
 */
import { getLang, tr } from "./i18n";
import type { EntRef } from "./inspect";
import type { MeasureCyl, MeasureEnt, MeasureReport } from "./measure";
import type { Vec3 } from "./types";

export type MeasureTarget = { comp?: string; ref: EntRef; label: string };
export type MeasureCmd =
  | { kind: "entities"; items: MeasureTarget[] }
  | { kind: "body" | "holes" | "cylinders"; comp?: string }
  | { kind: "rule"; what: "faces" | "edges"; rule: string[]; comp?: string };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const isNum = (t: string) => /^[+-]?(\d+[.,]?\d*|[.,]\d+)(mm)?$/i.test(t);
const num = (t: string) => parseFloat(t.replace(",", "."));

const BODY = new Set(["teleso", "body", "korper", "koerper", "solid"]);
const HOLES = new Set(["diry", "dira", "otvory", "otvor", "holes", "hole", "bohrungen", "bohrung", "locher", "loecher"]);
const CYLS = new Set(["valce", "valec", "cylinders", "cylinder", "zylinder", "prumery", "durchmesser", "diameters"]);
const FACES = new Set(["plocha", "plochy", "face", "faces", "flache", "flaeche", "flachen", "flaechen"]);
const EDGES = new Set(["hrana", "hrany", "edge", "edges", "kante", "kanten"]);
const POINT = new Set(["bod", "point", "punkt"]);
const RADIUS = new Set(["polomer", "radius", "r", "halbmesser"]);
const LONGER = new Set(["delsi", "longer", "langer", "laenger"]);
const SHORTER = new Set(["kratsi", "shorter", "kurzer", "kuerzer"]);

const usage = () => tr("měřit F3 | E5 | V2 · měřit F3 F7 (dvě entity) · měřit V1 x y z · měřit těleso · měřit díry · měřit válce · měřit plocha <pravidlo> · měřit hrany <pravidlo> · v sestavě Komponenta:F3");

/** rozdělí text na slova (uvozovky drží názvy s mezerou pohromadě) – pro window.mncad.measure */
export function measureTokens(text: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|„([^“]*)“|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return out;
}

/** Přečte slova za příkazem `měřit`; chyba = srozumitelná hláška se zápisem. */
export function parseMeasure(tokens0: string[]): MeasureCmd {
  // komponenta sestavy: `Hřídel:F3`, `"Hřídel 1":F3` (uvozovky → slovo + „:F3“), `Hřídel:díry`
  type Tok = { t: string; comp?: string };
  const toks: Tok[] = [];
  for (const raw of tokens0) {
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith(":") && t.length > 1 && toks.length) {
      const prev = toks.pop()!;
      toks.push({ t: t.slice(1), comp: prev.t });
      continue;
    }
    const c = t.lastIndexOf(":");
    if (c > 0 && c < t.length - 1) toks.push({ t: t.slice(c + 1), comp: t.slice(0, c) });
    else toks.push({ t: c === t.length - 1 ? t.slice(0, -1) : t });
  }
  if (!toks.length) throw new Error(tr("měřit potřebuje, co měřit: {0}", usage()));
  const head = fold(toks[0].t);
  const comp = toks[0].comp;
  if (toks.length === 1 && BODY.has(head)) return { kind: "body", comp };
  if (HOLES.has(head)) {
    if (toks.length > 1) throw new Error(tr("měřit díry nemá další volby – vypíše všechny díry tělesa: {0}", usage()));
    return { kind: "holes", comp };
  }
  if (CYLS.has(head)) {
    if (toks.length > 1) throw new Error(tr("měřit válce nemá další volby – vypíše všechny vnější válce tělesa: {0}", usage()));
    return { kind: "cylinders", comp };
  }
  const entRe = /^([fev])(\d+)$/i;
  if ((FACES.has(head) || EDGES.has(head)) && !(toks.length === 2 && entRe.test(toks[1].t))) {
    // pravidlo jako u skořepiny (plochy) / zaoblení (hrany); u hran i poloměr N, delší N, kratší N
    const what = FACES.has(head) ? "faces" : "edges";
    const rule: string[] = [];
    for (let i = 1; i < toks.length; i++) {
      const w = fold(toks[i].t);
      const next = toks[i + 1]?.t;
      if (what === "edges" && next !== undefined && isNum(next) && (RADIUS.has(w) || LONGER.has(w) || SHORTER.has(w))) {
        rule.push(`${RADIUS.has(w) ? "r=" : LONGER.has(w) ? "len>" : "len<"}${num(next)}`);
        i++;
      } else rule.push(toks[i].t.toLowerCase()); // pravidla si slova sama zjednoduší (bez diakritiky); v protokolu zůstane zápis
    }
    if (!rule.length) throw new Error(what === "faces" ? tr("měřit plocha potřebuje číslo nebo pravidlo: měřit plocha F3 | horní | +X | válcové | největší") : tr("měřit hrany potřebuje pravidlo: měřit hrany kruhové | svislé | horní | poloměr 4 | delší 20"));
    return { kind: "rule", what, rule, comp };
  }
  // entity: F3 / E5 / V2, bod x y z (nebo jen tři čísla), těleso
  const items: MeasureTarget[] = [];
  for (let i = 0; i < toks.length; i++) {
    const { t, comp: c } = toks[i];
    const w = fold(t);
    if (FACES.has(w) || EDGES.has(w)) continue; // „plocha F3“
    const m = entRe.exec(t);
    if (m) {
      const n = Number(m[2]);
      const letter = m[1].toUpperCase();
      if (n < 1) throw new Error(tr("čísla ploch, hran a vrcholů začínají 1 (F1, E1, V1) – „{0}“", t));
      items.push({ ref: { kind: letter === "F" ? "face" : letter === "E" ? "edge" : "vertex", index: n - 1 }, label: `${c ? c + ":" : ""}${letter}${n}`, ...(c ? { comp: c } : {}) });
      continue;
    }
    if (BODY.has(w)) {
      items.push({ ref: { kind: "body" }, label: `${c ? c + ":" : ""}${tr("těleso")}`, ...(c ? { comp: c } : {}) });
      continue;
    }
    const j = POINT.has(w) ? i + 1 : i;
    if (j + 2 < toks.length && [toks[j], toks[j + 1], toks[j + 2]].every((x) => isNum(x.t))) {
      const p: Vec3 = [num(toks[j].t), num(toks[j + 1].t), num(toks[j + 2].t)];
      items.push({ ref: { kind: "point", point: p }, label: tr("bod {0}", vec(p)) });
      i = j + 2;
      continue;
    }
    if (POINT.has(w) || isNum(t)) throw new Error(tr("bod potřebuje tři souřadnice: měřit V1 10 20 5 (nebo měřit V1 bod 10 20 5)"));
    throw new Error(tr("měřit: neznámá entita „{0}“ – {1}", t, usage()));
  }
  if (!items.length) throw new Error(tr("měřit potřebuje, co měřit: {0}", usage()));
  if (items.length > 2) throw new Error(tr("měřit porovná nejvýš dvě entity (zadáno {0}) – např. měřit F3 F7", items.length));
  if (items.every((x) => x.ref.kind === "point")) throw new Error(tr("měřit potřebuje aspoň jednu entitu modelu (F3, E5, V2, těleso) – vzdálenost dvou bodů spočítejte přímo"));
  return { kind: "entities", items };
}

/* ───────────── text výsledku ───────────── */
/** číslo jako ve `stav`: nejvýš `d` desetinných míst bez koncových nul, desetinná čárka (kromě angličtiny), bez oddělovače tisíců */
export function mfmt(n: number | undefined, d = 3): string {
  if (n === undefined || !Number.isFinite(n)) return "–";
  let s = n.toFixed(d);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  if (s === "-0") s = "0";
  return getLang() === "en" ? s : s.replace(".", ",");
}
const vec = (v: Vec3, d = 3) => `[${v.map((x) => mfmt(x, d)).join("; ")}]`;
const mm = (v: number | undefined) => `${mfmt(v)} mm`;
/** směr: +X / −Z u hlavních os, jinak vektor */
export function dirText(v: Vec3 | undefined): string {
  if (!v) return "–";
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  const k = [0, 1, 2].reduce((a, b) => (Math.abs(v[b]) > Math.abs(v[a]) ? b : a), 0);
  return Math.abs(v[k] / l) > 0.999999 ? `${v[k] > 0 ? "+" : "−"}${"XYZ"[k]}` : vec(v.map((x) => x / l) as Vec3, 4);
}

const SURF: Record<string, () => string> = {
  PLANE: () => tr("rovinná plocha"),
  CYLINDRE: () => tr("válcová plocha"),
  CONE: () => tr("kuželová plocha"),
  SPHERE: () => tr("kulová plocha"),
  TORUS: () => tr("toroidní plocha"),
  BSPLINE_SURFACE: () => tr("B-spline plocha"),
  BEZIER_SURFACE: () => tr("Bézierova plocha"),
  REVOLUTION_SURFACE: () => tr("rotační plocha"),
  EXTRUSION_SURFACE: () => tr("vysunutá plocha"),
  OFFSET_SURFACE: () => tr("odsazená plocha"),
};
const CURV: Record<string, () => string> = {
  LINE: () => tr("úsečka"),
  CIRCLE: () => tr("kružnice"),
  ELLIPSE: () => tr("elipsa"),
  HYPERBOLA: () => tr("hyperbola"),
  PARABOLA: () => tr("parabola"),
  BSPLINE_CURVE: () => tr("B-spline křivka"),
  BEZIER_CURVE: () => tr("Bézierova křivka"),
  OFFSET_CURVE: () => tr("odsazená křivka"),
};
const surfName = (t?: string) => (t && SURF[t] ? SURF[t]() : tr("obecná plocha"));
const curvName = (t?: string) => (t && CURV[t] ? CURV[t]() : tr("obecná křivka"));
const dia = (e: { diameter?: number; radius?: number }) => tr("Ø {0} mm (R {1})", mfmt(e.diameter), mfmt(e.radius));

/** krátký popis entity do řádku dvojice: „rovina“, „díra Ø8“, „kružnice Ø8“… */
function shortName(e: MeasureEnt): string {
  if (e.kind === "point") return e.label;
  if (e.kind === "vertex") return `${e.label} (${tr("vrchol")})`;
  if (e.kind === "body") return e.label;
  if (e.kind === "face") {
    const what = e.type === "PLANE" ? tr("rovina") : e.type === "CYLINDRE" ? (e.hole ? tr("díra Ø{0}", mfmt(e.diameter)) : tr("válec Ø{0}", mfmt(e.diameter))) : surfName(e.type);
    return `${e.label} (${what})`;
  }
  const what = e.type === "CIRCLE" ? (e.arc != null ? tr("oblouk R{0}", mfmt(e.radius)) : tr("kružnice Ø{0}", mfmt(e.diameter))) : curvName(e.type);
  return `${e.label} (${what})`;
}

/** jeden řádek s údaji o entitě */
export function entityLine(e: MeasureEnt): string {
  const parts: string[] = [];
  if (e.kind === "point") return `${e.label}`;
  if (e.kind === "vertex") return tr("{0}: vrchol {1}", e.label, e.point ? vec(e.point) : "–");
  if (e.kind === "body") return tr("{0}: povrch {1} mm²", e.label, mfmt(e.area));
  if (e.kind === "face") {
    let head = surfName(e.type);
    if (e.type === "CYLINDRE") head += e.hole ? tr(" – díra") : tr(" – vnější válec");
    parts.push(head);
    if (e.diameter != null) parts.push(dia(e));
    if (e.type === "CONE" && e.coneAngle != null) parts.push(tr("vrcholový úhel {0}°", mfmt(e.coneAngle, 2)));
    if (e.normal) parts.push(tr("normála {0}", dirText(e.normal)));
    if (e.axis) parts.push(tr("osa {0}", dirText(e.axis.dir)));
    if (e.extent) parts.push(tr("úsek osy {0} → {1} (délka {2})", vec(e.extent.from), vec(e.extent.to), mm(e.extent.length)));
    else if (e.axis) parts.push(tr("bod osy {0}", vec(e.axis.origin)));
    if (e.span != null && e.span < 359.9) parts.push(tr("obvod {0}°", mfmt(e.span, 1)));
    parts.push(tr("plocha {0} mm²", mfmt(e.area)));
    if (e.center) parts.push(e.type === "SPHERE" ? tr("střed koule {0}", vec(e.center)) : tr("těžiště plochy {0}", vec(e.center)));
    return `${e.label}: ${parts.join(" · ")}`;
  }
  if (e.type === "CIRCLE") {
    parts.push(e.arc != null ? tr("oblouk {0}°", mfmt(e.arc, 2)) : tr("kružnice"));
    parts.push(dia(e));
    if (e.center) parts.push(tr("střed {0}", vec(e.center)));
    if (e.axis) parts.push(tr("osa {0}", dirText(e.axis.dir)));
    parts.push(tr("délka {0}", mm(e.length)));
    if (e.arc != null && e.start && e.end) parts.push(tr("z {0} do {1}", vec(e.start), vec(e.end)));
  } else {
    parts.push(curvName(e.type));
    parts.push(tr("délka {0}", mm(e.length)));
    if (e.start && e.end) parts.push(tr("z {0} do {1}", vec(e.start), vec(e.end)));
    if (e.dir) parts.push(tr("směr {0}", dirText(e.dir)));
  }
  return `${e.label}: ${parts.join(" · ")}`;
}

function cylLine(c: MeasureCyl, id: string, hole: boolean): string {
  const parts: string[] = [];
  if (hole) {
    parts.push(tr("vstup {0}", vec(c.entry ?? c.to)));
    parts.push(c.through ? tr("skrz, délka {0}", mm(c.length)) : tr("slepá, hloubka {0}", mm(c.depth ?? c.length)));
    parts.push(c.through ? tr("osa {0}", dirText(c.axis)) : tr("směr vrtání {0}", dirText(c.drill)));
  } else {
    parts.push(tr("délka {0}", mm(c.length)));
    parts.push(tr("osa {0}", dirText(c.axis)));
    parts.push(tr("od {0} do {1}", vec(c.from), vec(c.to)));
  }
  if (c.span < 359.9) parts.push(tr("obvod {0}°", mfmt(c.span, 1)));
  parts.push(`${c.faces.length > 1 ? tr("plochy") : tr("plocha")} ${c.faces.map((f) => `F${f}`).join(", ")}`);
  return `${id} Ø ${mm(c.diameter)}: ${parts.join(" · ")}`;
}

/** skupiny podle průměru (zaokrouhleno na tisíciny) v pořadí výpisu */
function byDiameter(list: MeasureCyl[]): [number, MeasureCyl[]][] {
  const m = new Map<string, [number, MeasureCyl[]]>();
  for (const c of list) {
    const k = c.diameter.toFixed(3);
    if (!m.has(k)) m.set(k, [c.diameter, []]);
    m.get(k)![1].push(c);
  }
  return [...m.values()];
}

/** Řádky protokolu pro výsledek měření (jeden řádek na měření; seznamy děr / válců po skupinách průměrů). */
export function measureLines(rep: MeasureReport): string[] {
  switch (rep.kind) {
    case "entity":
      return [entityLine(rep.entity)];
    case "list":
      return [rep.what === "faces" ? tr("Plochy podle pravidla „{0}“: {1}", rep.rule, rep.entities.length) : tr("Hrany podle pravidla „{0}“: {1}", rep.rule, rep.entities.length), ...rep.entities.map(entityLine)];
    case "pair": {
      const p = rep.pair;
      const parts: string[] = [];
      parts.push(p.distance != null ? tr("vzdálenost {0}", mm(p.distance)) : tr("vzdálenost –"));
      if (p.delta) parts.push(`ΔX ${mfmt(p.delta[0])} · ΔY ${mfmt(p.delta[1])} · ΔZ ${mfmt(p.delta[2])}`);
      if (p.p1 && p.p2 && (p.distance ?? 0) > 1e-9) parts.push(tr("nejbližší body {0} a {1}", vec(p.p1), vec(p.p2)));
      if (p.angle != null) {
        const rel = p.parallel ? tr("rovnoběžné") : p.perpendicular ? tr("kolmé") : "";
        if (p.angleKind === "planes") parts.push(tr("úhel normál {0}°", mfmt(p.angle, 3)) + (rel ? ` (${rel})` : ""));
        else if (p.angleKind === "linePlane") parts.push(tr("úhel k rovině {0}°", mfmt(p.angle, 3)) + (rel ? ` (${rel})` : ""));
        else parts.push(tr("úhel {0}°", mfmt(p.angle, 3)) + (rel ? ` (${rel})` : ""));
      }
      if (p.planeDistance != null) parts.push(p.angleKind === "planes" ? tr("vzdálenost rovin {0}", mm(p.planeDistance)) : tr("vzdálenost od roviny {0}", mm(p.planeDistance)));
      if (p.axisDistance != null) parts.push(tr("vzdálenost os {0}", mm(p.axisDistance)));
      if (p.centerDistance != null) parts.push(tr("vzdálenost středů {0}", mm(p.centerDistance)));
      return [`${shortName(p.a)} ↔ ${shortName(p.b)}: ${parts.join(" · ")}`];
    }
    case "body": {
      const b = rep.body;
      const [a, z] = b.bbox;
      return [
        tr("{0}: obálka {1} × {2} × {3} mm (X {4}…{5}, Y {6}…{7}, Z {8}…{9}) · objem {10} mm³ ({11} cm³) · povrch {12} mm² · hmotnost {13} kg ({14} g/cm³) · těžiště {15} · ploch {16} · hran {17} · vrcholů {18}{19}", b.label, mfmt(b.size[0]), mfmt(b.size[1]), mfmt(b.size[2]), mfmt(a[0]), mfmt(z[0]), mfmt(a[1]), mfmt(z[1]), mfmt(a[2]), mfmt(z[2]), mfmt(b.volume), mfmt(b.volume / 1000), mfmt(b.area), mfmt(b.mass, 4), mfmt(b.density, 2), b.com ? vec(b.com) : "–", b.faces, b.edges, b.vertices, b.solids > 1 ? tr(" · těles {0}", b.solids) : ""),
      ];
    }
    case "holes":
    case "cylinders": {
      const hole = rep.kind === "holes";
      const list = hole ? rep.holes : rep.cylinders;
      const groups = byDiameter(list);
      const prefix = rep.label ? `${rep.label}: ` : "";
      if (!list.length) return [prefix + (hole ? tr("Díry: žádné válcové díry") : tr("Válce: žádné vnější válcové plochy"))];
      const sum = groups.map(([d, l]) => `Ø ${mm(d)} × ${l.length}`).join(", ");
      const out = [prefix + (hole ? tr("Díry: {0} – {1}", list.length, sum) : tr("Válce: {0} – {1}", list.length, sum))];
      let n = 0;
      for (const [d, l] of groups) {
        out.push(`Ø ${mm(d)} × ${l.length}:`);
        for (const c of l) out.push("  " + cylLine(c, `${hole ? "D" : "C"}${++n}`, hole));
      }
      return out;
    }
  }
}

/** Výsledek `window.mncad.measure`: řádky protokolu + hlavní čísla + celý výsledek z jádra. */
export type MeasureApiResult = {
  ok: boolean;
  error?: string;
  kind?: MeasureReport["kind"];
  /** řádky jako v protokolu příkazu měřit */
  lines: string[];
  distance?: number;
  angle?: number;
  radius?: number;
  diameter?: number;
  area?: number;
  length?: number;
  volume?: number;
  /** body: dvojice = nejbližší body; entita = střed / bod / začátek a konec hrany */
  points?: Vec3[];
  report?: MeasureReport;
};

export function measureApiResult(rep: MeasureReport): MeasureApiResult {
  const out: MeasureApiResult = { ok: true, kind: rep.kind, lines: measureLines(rep), report: rep };
  if (rep.kind === "entity") {
    const e = rep.entity;
    Object.assign(out, { radius: e.radius, diameter: e.diameter, area: e.area, length: e.length ?? e.extent?.length });
    out.points = [e.point, e.center, e.start, e.end].filter((x): x is Vec3 => !!x);
  } else if (rep.kind === "pair") {
    Object.assign(out, { distance: rep.pair.distance, angle: rep.pair.angle });
    if (rep.pair.p1 && rep.pair.p2) out.points = [rep.pair.p1, rep.pair.p2];
  } else if (rep.kind === "body") Object.assign(out, { volume: rep.body.volume, area: rep.body.area });
  for (const k of Object.keys(out) as (keyof MeasureApiResult)[]) if (out[k] === undefined) delete out[k];
  return out;
}
