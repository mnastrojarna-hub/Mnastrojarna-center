/**
 * `kontrola [díl "A" | sestava | vše] [díry] [polohy]` (EN check, DE prüfen) – CAD-HEADLESS-NAVRH.md kap. 6.1, balík B5.
 *
 * Díl: přesný objem, hmotnost, obálka a počet těles z B-rep (`measureBody` v jádře – nikdy ze sítě), platnost (BRepCheck),
 * hustota a příznak `rho.assumed` (materiál zadaný jen označením – 5.2 č. 37) a tabulka děr: díry z jádra (`measureCylinders`
 * s tvarem dna z w12-hole), souosé úseky sloučené (zahloubení + průchod = jedna díra) a spojené s prvky `hole` / `thread`
 * podle osy a polohy (závit, hloubka závitu, zahloubení). Prvek díry bez díry v geometrii → ⚠ `check.hole-missing`,
 * neplatné těleso → ⚠ `check.invalid`.
 *
 * Sestava: Σ objem komponent (V.sum) i objem sjednocení (V.union = V.sum − průniky dvojic z kontroly kolizí; rozhodnutí 15.1),
 * hmotnost, přesná obálka, vazby ok / celkem, kolize po třídách (šroub × závit geometricky, clash-class.ts) a výpis na každý
 * různý díl – výpis má v rozpočtu stručného protokolu nejnižší prioritu (souhrn je zvláštní jednořádkový záznam `=`).
 * `vše` = sestava s tabulkou děr každého dílu (v dílu totéž co `kontrola`).
 */
import type { CheckCmd } from "../agent-check";
import { flattenLeaves, type Leaf } from "../asm-flatten";
import { axisAngle, lineDist, nominalDiameter, type ClashCounts } from "../clash-class";
import { holeDrillD, holeTip } from "../hole-spec";
import { cadLocale, tr } from "../i18n";
import { leafByRef } from "../leaf-ref";
import type { MeasureBody, MeasureCyl } from "../measure";
import type { ComponentSource, CadDoc, Feature, Vec3 } from "../types";
import { MATERIALS } from "@/lib/mesh-metrics";
import { asmStatus } from "./asm-status";
import { IDENT } from "./asm-box";
import { kv, matesCount, num, vec } from "./kv";
import { quote } from "./protocol";
import { docKeyOf, runOf } from "./run-doc";
import { asmHooks, coded, sayKv, sayKvAs, type OpCtx, type OpHandler } from "./ops/util";
import { checkClashes, clashFindings, ctxOut } from "./ops/clash";

type HoleF = Extract<Feature, { type: "hole" }>;
type ThreadF = Extract<Feature, { type: "thread" }>;

/* ───────────────────────── tabulka děr (čisté funkce) ───────────────────────── */

/** jedna díra po sloučení souosých úseků a spojení s prvkem */
export type CheckHole = {
  /** průměr vrtání (nejmenší úsek) */
  d: number;
  through: boolean;
  /** slepá díra: hloubka od vstupu (všechny úseky) */
  depth?: number;
  bottom?: "flat" | "cone";
  tipAngle?: number;
  tipDepth?: number;
  thread?: string;
  threadDepth?: number;
  /** zahloubení: průměr × hloubka */
  cbore?: [number, number];
  /** kuželové zahloubení: průměr × úhel (z prvku) */
  csink?: [number, number];
  /** vstup a směr vrtání (průchozí díra: vstup na straně prvku díry, jinak na straně zahloubení) */
  entry: Vec3;
  drill: Vec3;
  /** druhý konec díry (u průchozí díry výstup) */
  exit?: Vec3;
  /** prvek díry / závitu, se kterým se díra spojila */
  feature?: string;
};
/**
 * Řádek tabulky děr (JSON `data.holes[]`, kap. 6.1): `axis` = jednotkový směr vrtání (od vstupu do materiálu), `positions` =
 * středy vstupů, `n` = počet stejných děr, `features` = prvky díry / závitu, se kterými se díry spojily.
 */
export type CheckHoleRow = Omit<CheckHole, "entry" | "feature" | "drill" | "exit"> & { axis: Vec3; n: number; positions: Vec3[]; features: string[] };

const r3 = (v: number) => Math.round(v * 1000) / 1000 + 0;
const AXV: Record<string, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** body polohy prvku díry (null = odkazem / opakované polem nebo zrcadlením – určí jen geometrie) */
function featurePoints(doc: CadDoc, f: HoleF | ThreadF): Vec3[] | null {
  const feats = doc.features;
  const repeated = feats.some((g) => !g.suppressed && ((g.type === "pattern" && (g.featureIds?.length ? g.featureIds : [g.featureId]).includes(f.id)) || (g.type === "mirror" && feats.indexOf(g) > feats.indexOf(f))));
  if (repeated) return null;
  if (f.type === "thread") return [f.position];
  if (!f.points?.length) return [f.position];
  return f.points.every((p) => p.kind === "xyz") ? f.points.map((p) => (p as { p: Vec3 }).p) : null;
}
const featureDir = (f: HoleF | ThreadF): Vec3 | null => (f.dirDef ? (f.dirDef.kind === "vector" ? unit(f.dirDef.v) : f.dirDef.kind === "axis" ? AXV[f.dirDef.axis] : null) : AXV[f.axis] ?? AXV.Z);

/** obrátí díru: vstup ↔ výstup, opačný smysl vrtání */
function flipHole(h: CheckHole): void {
  if (!h.exit) return;
  [h.entry, h.exit] = [h.exit, h.entry];
  h.drill = h.drill.map((v) => r3(-v)) as Vec3;
}

/**
 * Průchozí díra spojená s prvkem: vstup na straně polohy prvku (`díra … v x y z směr …` vrtá od zadaného bodu), bez
 * souřadnic polohy podle zadaného směru vrtání (vektor). Jádro u průchozí díry smysl vrtání nezná (měří jen válec).
 */
function orientThrough(h: CheckHole, f: HoleF | ThreadF, pts: Vec3[] | null): void {
  if (!h.exit) return;
  const q = pts?.find((p) => lineDist(p, h.entry, h.drill) < 0.05);
  if (q) {
    if (Math.abs(dot(sub(q, h.entry), h.drill)) > Math.abs(dot(sub(q, h.exit), h.drill)) + 1e-6) flipHole(h);
    return;
  }
  if (f.dirDef?.kind === "vector" && dot(unit(f.dirDef.v), h.drill) < 0) flipHole(h);
}

/**
 * Sloučí souosé navazující úseky děr z jádra (zahloubení + vrtání = jedna díra; P4) a spojí je s prvky díry a vnitřního
 * závitu podle osy a polohy (polohy odkazem / polem: podle průměru vrtáku). Vrací díry a prvky děr bez díry v geometrii.
 */
export function holeTable(doc: CadDoc, cyls: readonly MeasureCyl[]): { holes: CheckHole[]; missing: { feature: string; missing: number; expected: number | null }[] } {
  // sjednocení souosých úseků (rovnoběžná osa, tatáž přímka, navazující nebo překrývající se rozsah)
  const parent = cyls.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const tRange = (c: MeasureCyl, o: Vec3, d: Vec3) => {
    const a = dot(sub(c.from, o), d);
    const b = dot(sub(c.to, o), d);
    return [Math.min(a, b), Math.max(a, b)];
  };
  for (let i = 0; i < cyls.length; i++)
    for (let j = i + 1; j < cyls.length; j++) {
      const a = cyls[i];
      const b = cyls[j];
      if (axisAngle(a.axis, b.axis) > 0.01 || lineDist(b.from, a.from, a.axis) > 1e-3) continue;
      const [a0, a1] = tRange(a, a.from, a.axis);
      const [b0, b1] = tRange(b, a.from, a.axis);
      if (b0 <= a1 + 1e-3 && b1 >= a0 - 1e-3) parent[find(j)] = find(i);
    }
  const groups = new Map<number, MeasureCyl[]>();
  cyls.forEach((c, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), c]));
  const merged: CheckHole[] = [];
  for (const segs of groups.values()) {
    const drillSeg = segs.reduce((x, y) => (y.diameter < x.diameter ? y : x));
    const big = segs.filter((s) => s !== drillSeg).sort((x, y) => y.diameter - x.diameter);
    const drill = (drillSeg.drill ?? [0, 0, -1]) as Vec3;
    // vstup: otevřený konec celé díry – u zahloubení začátek zahloubení (nejmenší souřadnice podél smyslu vrtání)
    const all = segs.flatMap((s) => [s.from, s.to]) as Vec3[];
    const ref = (drillSeg.entry ?? drillSeg.to) as Vec3;
    const ts = all.map((p) => dot(sub(p, ref), drill));
    const tMin = Math.min(...ts);
    const tMax = Math.max(...ts);
    const at = (t: number): Vec3 => [ref[0] + drill[0] * t, ref[1] + drill[1] * t, ref[2] + drill[2] * t].map(r3) as Vec3;
    const h: CheckHole = { d: r3(drillSeg.diameter), through: !!drillSeg.through, entry: at(tMin), exit: at(tMax), drill: drill.map(r3) as Vec3 };
    // průchozí díra se zahloubením: vstup je na straně zahloubení (jádro u průchozí díry smysl vrtání nezná)
    if (h.through && big.length) {
      const cb = big[0];
      const mid = (dot(sub(cb.from as Vec3, ref), drill) + dot(sub(cb.to as Vec3, ref), drill)) / 2;
      if (mid - tMin > tMax - mid) flipHole(h);
    }
    if (!h.through) {
      h.depth = r3(tMax - tMin);
      if (drillSeg.bottom) h.bottom = drillSeg.bottom;
      if (drillSeg.tipAngle !== undefined) h.tipAngle = r3(drillSeg.tipAngle);
      if (drillSeg.tipDepth !== undefined) h.tipDepth = r3(drillSeg.tipDepth);
    }
    if (big.length) {
      const cb = big[0];
      h.cbore = [r3(cb.diameter), r3(cb.length)];
    }
    merged.push(h);
  }
  // spojení s prvky: osa rovnoběžná, bod polohy na ose (polohy souřadnicemi), jinak průměr vrtáku
  const feats = doc.features.filter((f): f is HoleF | ThreadF => !f.suppressed && (f.type === "hole" || (f.type === "thread" && !!(f as ThreadF).internal)));
  const used = new Map<string, number>();
  const pts = new Map(feats.map((f) => [f.id, featurePoints(doc, f)]));
  const onAxis = (p: Vec3, h: CheckHole) => lineDist(p, h.entry, h.drill) < 0.05;
  for (const h of merged) {
    const f = feats.find((g) => {
      const dir = featureDir(g);
      if (dir && axisAngle(dir, h.drill) > 0.5) return false;
      const p = pts.get(g.id);
      if (p) return p.some((q) => onAxis(q, h));
      if (g.type === "hole") return Math.abs(holeDrillD(g) - h.d) < 0.01;
      return false;
    });
    if (!f) continue;
    h.feature = f.name;
    used.set(f.id, (used.get(f.id) ?? 0) + 1);
    if (h.through && !h.cbore) orientThrough(h, f, pts.get(f.id) ?? null);
    if (f.type === "thread") {
      h.thread = f.designation;
      h.threadDepth = r3(f.length);
      continue;
    }
    if (f.kind === "tapped" && f.thread) {
      h.thread = f.thread;
      if (f.threadDepth && f.threadDepth > 0) h.threadDepth = r3(f.threadDepth);
    }
    if (f.kind === "countersink" && (f.csDiameter ?? 0) > 0) h.csink = [r3(f.csDiameter!), r3(f.csAngle ?? 90)];
    // úhel hrotu z prvku, když ho geometrie nezměřila (propíchnutý kužel)
    if (!h.through && h.bottom === undefined && holeTip(f) === null) h.bottom = "flat";
  }
  // vnitřní závit přidaný na už spojenou díru (díra + prvek závit)
  for (const t of feats.filter((f): f is ThreadF => f.type === "thread"))
    for (const h of merged) if (!h.thread && (pts.get(t.id) ?? []).some((q) => onAxis(q, h))) {
      h.thread = t.designation;
      h.threadDepth = r3(t.length);
      used.set(t.id, (used.get(t.id) ?? 0) + 1);
    }
  const missing: { feature: string; missing: number; expected: number | null }[] = [];
  for (const f of feats) {
    const p = pts.get(f.id);
    const got = used.get(f.id) ?? 0;
    if (p) {
      const miss = p.filter((q) => !merged.some((h) => onAxis(q, h))).length;
      if (miss > 0) missing.push({ feature: f.name, missing: miss, expected: p.length });
    } else if (!got) missing.push({ feature: f.name, missing: 1, expected: null });
  }
  return { holes: merged, missing };
}

/** řádky tabulky děr: stejné díry (průměr, hloubka, dno, závit, zahloubení, směr) jako jeden řádek s počtem */
export function holeRows(holes: readonly CheckHole[]): CheckHoleRow[] {
  const rows = new Map<string, CheckHoleRow>();
  for (const h of holes) {
    const { entry, feature, exit: _exit, drill, ...rest } = h;
    const base = { ...rest, axis: drill };
    const key = JSON.stringify(base);
    const row = rows.get(key) ?? { ...base, n: 0, positions: [], features: [] };
    row.n++;
    row.positions.push(entry);
    if (feature && !row.features.includes(feature)) row.features.push(feature);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.d - b.d || (a.thread ?? "").localeCompare(b.thread ?? "") || b.n - a.n);
}

/** směr vrtání: osa se znaménkem (`-Z`), jinak vektor */
export function dirText(d: Vec3): string {
  const k = [0, 1, 2].find((i) => Math.abs(Math.abs(d[i]) - 1) < 1e-6);
  if (k !== undefined && [0, 1, 2].every((i) => i === k || Math.abs(d[i]) < 1e-6)) return `${d[k] < 0 ? "-" : "+"}${"XYZ"[k]}`;
  return vec(d) ?? "-";
}

/** strojová část řádku díry: `hole d=8.5 depth=25 bottom=cone tip=118 thread=M10 tdepth=20 n=4 dir=-Z [at=…]` */
export function holeRowKv(r: CheckHoleRow, positions: boolean): string {
  return `hole ${kv([
    ["d", num(r.d, 3)],
    ["through", r.through ? true : undefined],
    ["depth", r.through ? undefined : num(r.depth, 3)],
    ["bottom", r.bottom],
    ["tip", r.bottom === "cone" ? num(r.tipAngle, 3) : undefined],
    ["thread", r.thread ? (nominalDiameter(r.thread) !== null ? r.thread.replace(/\s+/g, "").replace("×", "x").replace(",", ".") : r.thread) : undefined],
    ["tdepth", num(r.threadDepth, 3)],
    ["cbore", r.cbore ? `${num(r.cbore[0], 3)}x${num(r.cbore[1], 3)}` : undefined],
    ["csink", r.csink ? `${num(r.csink[0], 3)}x${num(r.csink[1], 3)}` : undefined],
    ["n", r.n],
  ])}${positions ? ` at=${r.positions.map((p) => vec(p)).join(";")}` : ""} dir=${dirText(r.axis)}`;
}

/* ───────────────────────── text konzole (jazyk rozhraní) ───────────────────────── */

const loc = (v: number, d = 3) => (Number.isFinite(v) ? (Math.round(v * 10 ** d) / 10 ** d + 0).toLocaleString(cadLocale(), { maximumFractionDigits: d }) : "–");
const locVec = (p: Vec3) => `[${p.map((x) => loc(x, 2)).join("; ")}]`;

function holeRowText(r: CheckHoleRow, positions: boolean): string {
  const parts: string[] = [];
  const n = r.n > 1 ? `${r.n}× ` : "";
  const deep = (v?: number) => (v !== undefined ? ` ↧${loc(v)}` : "");
  if (r.thread) parts.push(`${n}${r.thread}${r.threadDepth !== undefined ? deep(r.threadDepth) : r.through ? ` ${tr("skrz")}` : ""}`, `Ø${loc(r.d)}${r.through ? ` ${tr("skrz")}` : deep(r.depth)}`);
  else parts.push(`${n}Ø${loc(r.d)}${r.through ? ` ${tr("skrz")}` : deep(r.depth)}`);
  if (r.cbore) parts.push(tr("zahloubení Ø{0} ↧{1}", loc(r.cbore[0]), loc(r.cbore[1])));
  if (r.csink) parts.push(tr("kuželové zahloubení Ø{0} × {1}°", loc(r.csink[0]), loc(r.csink[1])));
  if (r.bottom === "flat") parts.push(tr("ploché dno"));
  else if (r.bottom === "cone") parts.push(tr("dno kužel {0}°", loc(r.tipAngle ?? 118, 1)));
  parts.push(tr("směr {0}", dirText(r.axis)));
  if (!r.features.length) parts.push(tr("bez prvku díry"));
  if (positions) parts.push(tr("polohy {0}", r.positions.map(locVec).join(" ")));
  return `  ${parts.join(" · ")}`;
}

/* ───────────────────────── provedení ───────────────────────── */

const densityOf = (mat?: string) => MATERIALS.find((x) => x.id === mat)?.density ?? 7.85;
/** hustota je jen předpokládaná: materiál zadaný označením (razítko), třída zůstala výchozí ocel (5.2 č. 37) */
const assumedDensity = (d: CadDoc | null) => !!d?.materialName?.trim() && (d.material ?? "ocel") === "ocel";
const bboxKv = (b: [Vec3, Vec3]) => `${vec(b[0])}..${vec(b[1])}`;
const bboxText = (b: [Vec3, Vec3]) => {
  const s = [0, 1, 2].map((i) => loc(b[1][i] - b[0][i], 3));
  return tr("{0} × {1} × {2} mm (X {3}…{4}, Y {5}…{6}, Z {7}…{8})", s[0], s[1], s[2], loc(b[0][0], 3), loc(b[1][0], 3), loc(b[0][1], 3), loc(b[1][1], 3), loc(b[0][2], 3), loc(b[1][2], 3));
};

/** výsledek kontroly jednoho dílu (JSON `data`) */
export type PartCheck = {
  part: string;
  volume_mm3: number;
  mass_kg: number;
  density: number;
  densityAssumed: boolean;
  bbox: [Vec3, Vec3];
  solids: number;
  valid: boolean | null;
  holes: CheckHoleRow[];
};

/** záznam `=` výpisu s daty pro JSON (konzole: řádky `texts`); `doc` = kontrolovaný díl / sestava (ne aktivní záložka) */
function sayData(ctx: OpCtx, doc: string, payload: string, data: unknown, texts: string[]): void {
  const before = ctx.report.entries.length;
  sayKvAs(ctx, doc, payload, ...texts);
  const e = ctx.report.entries.slice(before).find((x) => x.level === "measure");
  if (e) e.data = data;
}

/** změří díl (přesně) a jeho díry */
async function measurePart(ctx: OpCtx, o: { label: string; doc: CadDoc | null; src: { key: string; source: ComponentSource } | null; holes: boolean; valid: boolean | null }): Promise<{ body: MeasureBody; holes: CheckHole[]; missing: ReturnType<typeof holeTable>["missing"]; check: PartCheck }> {
  const k = ctx.host.kernel;
  const density = densityOf(o.doc?.material ?? (o.src?.source.kind !== "part" ? "ocel" : undefined));
  const src = o.src ? ({ kind: "comp", key: o.src.key, matrix: IDENT } as const) : ({ kind: "part" } as const);
  const extra = o.src ? { sources: [o.src] } : { doc: o.doc! };
  const rb = await k.measure({ kind: "body", src, label: o.label }, { ...extra, density });
  if (rb.kind !== "body") throw new Error("check: body");
  let holes: CheckHole[] = [];
  let missing: ReturnType<typeof holeTable>["missing"] = [];
  if (o.holes) {
    const rh = await k.measure({ kind: "holes", src, label: o.label }, extra);
    if (rh.kind === "holes") ({ holes, missing } = holeTable(o.doc ?? { features: [] } as unknown as CadDoc, rh.holes));
  }
  const b = rb.body;
  return { body: b, holes, missing, check: { part: o.label, volume_mm3: b.volume, mass_kg: b.mass, density, densityAssumed: assumedDensity(o.doc), bbox: b.bbox, solids: b.solids, valid: o.valid, holes: holeRows(holes) } };
}

/**
 * Varování kontroly dílu: neplatné těleso, prvek díry bez díry. Záznam patří kontrolovanému dílu (`doc` = díl – v sestavě
 * název komponenty, ne sestava), `data` nese díl a prvek: stejné názvy prvků („Díra 2“) v různých dílech jsou rozlišené.
 */
function partWarnings(ctx: OpCtx, part: string, valid: boolean | null, missing: ReturnType<typeof holeTable>["missing"]) {
  if (valid === false) coded(ctx, "check.invalid", { doc: part, args: [part], data: { part } });
  for (const m of missing)
    coded(ctx, "check.hole-missing", {
      doc: part,
      args: [m.feature],
      data: { part, feature: m.feature, missing: m.missing, expected: m.expected },
      ...(m.expected !== null && m.expected > 1 ? { text: tr("prvek díry „{0}“: {1} z {2} poloh nemá v geometrii díru", m.feature, m.missing, m.expected) } : {}),
    });
}

async function checkPart(ctx: OpCtx, d: CadDoc, cmd: CheckCmd, label = d.name): Promise<void> {
  const res = await ctx.host.kernel.build(d);
  if (!res.metrics) throw new Error(tr("kontrola: díl „{0}“ nemá těleso", label));
  const valid = res.metrics.valid ?? null;
  const { check, missing } = await measurePart(ctx, { label, doc: d, src: null, holes: true, valid });
  const c = check;
  const assumed = c.densityAssumed;
  const head = `part ${kv([
    ["V", num(c.volume_mm3 / 1000, 3, "cm3")],
    ["m", num(c.mass_kg, 3, "kg")],
    ["rho", num(c.density, 3)],
    ["rho.assumed", assumed ? true : undefined],
    ["bbox", bboxKv(c.bbox)],
    ["solids", c.solids],
    ["valid", valid ?? undefined],
    ["holes", c.holes.reduce((a, r) => a + r.n, 0)],
  ])}`;
  const text = tr("Kontrola „{0}“: objem {1} cm³ · hmotnost {2} kg (hustota {3} g/cm³{4}) · obálka {5} · těles {6} · {7}", label, loc(c.volume_mm3 / 1000), loc(c.mass_kg), loc(c.density, 3), assumed ? tr(", předpokládaná – materiál zadán jen označením") : "", bboxText(c.bbox), c.solids, valid === false ? tr("NEPLATNÉ (BRepCheck)") : tr("platné"));
  sayData(ctx, label, head, c, [text]);
  if (c.holes.length) sayKvAs(ctx, label, [`holes=${c.holes.reduce((a, r) => a + r.n, 0)} rows=${c.holes.length}`, ...c.holes.map((r) => holeRowKv(r, cmd.positions))].join("\n"), tr("Díry ({0}):", c.holes.reduce((a, r) => a + r.n, 0)), ...c.holes.map((r) => holeRowText(r, cmd.positions)));
  partWarnings(ctx, label, valid, missing);
}

// dotyk a pracovní kontakt (vlna 22, bod 5 – pravidla dokumentu) jen nenulové na konci
const clashKvShort = (c: ClashCounts) => `${c.total}(thread=${c.thread},underhead=${c.underhead},real=${c.real},undetermined=${c.undetermined}${c.touch ? `,touch=${c.touch}` : ""}${c.work ? `,work=${c.work}` : ""})`;

async function checkAssembly(ctx: OpCtx, d: CadDoc, cmd: CheckCmd): Promise<void> {
  const k = ctx.host.kernel;
  const key = docKeyOf(ctx);
  // díly postavené (ensureLeaves), stav vazeb přepočítaný, je-li třeba
  const st = await asmStatus(ctx.ws, k, d, { ...asmHooks(ctx), key });
  const leaves = flattenLeaves(d);
  const vis = leaves.filter((l) => !l.hidden);
  if (!vis.length) throw new Error(tr("kontrola: sestava nemá viditelné komponenty"));
  // různé díly: jednou změřit přesně (lokálně), díry jen s „díry“ / „vše“
  const withHoles = cmd.holes || cmd.target === "all";
  const parts = new Map<string, { leaf: Leaf; n: number; m: Awaited<ReturnType<typeof measurePart>> }>();
  for (const l of vis) {
    const hit = parts.get(l.key);
    if (hit) {
      hit.n++;
      continue;
    }
    const pdoc = l.comp.source.kind === "part" ? l.comp.source.doc : null;
    const valid = ctx.ws.asm.cache.get(l.key)?.metrics?.valid ?? null;
    const m = await measurePart(ctx, { label: l.comp.name, doc: pdoc, src: { key: l.key, source: l.comp.source }, holes: withHoles, valid });
    if (!pdoc) m.check.density = densityOf(l.comp.material ?? "ocel");
    parts.set(l.key, { leaf: l, n: 1, m });
  }
  // Σ objem a hmotnost přes listy (přesné objemy dílů); obálka přesně z jádra (stav sestavy výše – engine/asm-box.ts)
  let vSum = 0;
  let mSum = 0;
  for (const l of vis) {
    const p = parts.get(l.key)!.m;
    vSum += p.body.volume;
    mSum += (p.body.volume / 1e6) * (p.check.density ?? 7.85);
  }
  const box = st?.bbox ?? null;
  // kolize po třídách (šroub × závit geometricky); objem sjednocení = Σ − průniky dvojic
  const { res, list, counts } = await checkClashes(ctx.ws, k, d, key, ctx.line);
  const cls = { list, counts };
  clashFindings(ctxOut(ctx), d, list, res);
  const vUnion = vSum - res.reduce((a, x) => a + x.volume, 0);
  const mates = matesCount(d, st?.mates);
  const validN = [...parts.values()].filter((p) => p.m.check.valid !== false).length;
  const head = `asm ${kv([
    ["comp", (d.components ?? []).length],
    ["parts", parts.size],
    ["V.sum", num(vSum / 1000, 3, "cm3")],
    ["V.union", num(vUnion / 1000, 3, "cm3")],
    ["m", num(mSum, 3, "kg")],
    ["bbox", box ? bboxKv(box) : undefined],
    ["mates", mates ? `${mates.ok}/${mates.total}` : undefined],
  ])} clash=${clashKvShort(cls.counts)} valid=${validN}/${parts.size}`;
  const c = cls.counts;
  const text = tr(
    "Kontrola sestavy „{0}“: {1} komponent ({2} různých dílů) · objem Σ {3} cm³, sjednocení {4} cm³ · hmotnost Σ {5} kg · obálka {6}{7} · kolize {8} (šroub v závitu {9}, pod hlavou {10}, skutečné {11}, nevyhodnotitelné {12}) · platných dílů {13} z {14}",
    d.name,
    (d.components ?? []).length,
    parts.size,
    loc(vSum / 1000),
    loc(vUnion / 1000),
    loc(mSum),
    box ? bboxText(box) : "–",
    mates ? tr(" · vazby {0} z {1} ok", mates.ok, mates.total) : "",
    c.total,
    c.thread,
    c.underhead,
    c.real,
    c.undetermined,
    validN,
    parts.size,
  );
  const data = { assembly: d.name, components: (d.components ?? []).length, parts: parts.size, volume_mm3: vSum, volume_union_mm3: vUnion, mass_kg: mSum, bbox: box, mates, clashes: c, partChecks: [...parts.values()].map((p) => ({ ...p.m.check, n: p.n })) };
  sayData(ctx, d.name, head, data, [text]);
  // výpis po dílech (nejnižší priorita rozpočtu stručného protokolu)
  const rows: string[] = [];
  const texts: string[] = [tr("Díly ({0}):", parts.size)];
  for (const p of parts.values()) {
    const ch = p.m.check;
    rows.push(
      `part ${quote(ch.part)} ${kv([
        ["n", p.n],
        ["V", num(ch.volume_mm3 / 1000, 3, "cm3")],
        ["m", num(ch.mass_kg, 3, "kg")],
        ["rho", num(ch.density, 3)],
        ["rho.assumed", ch.densityAssumed ? true : undefined],
        ["bbox", bboxKv(ch.bbox)],
        ["solids", ch.solids],
        ["valid", ch.valid ?? undefined],
        ["holes", withHoles ? ch.holes.reduce((a, r) => a + r.n, 0) : undefined],
      ])}`,
    );
    texts.push(`  ${tr("{0}× „{1}“ – objem {2} cm³ · hmotnost {3} kg · obálka {4} · těles {5}{6}", p.n, ch.part, loc(ch.volume_mm3 / 1000), loc(ch.mass_kg), bboxText(ch.bbox), ch.solids, ch.valid === false ? ` · ${tr("NEPLATNÉ (BRepCheck)")}` : "")}`);
    if (withHoles)
      for (const r of ch.holes) {
        rows.push(holeRowKv(r, cmd.positions));
        texts.push(`  ${holeRowText(r, cmd.positions).trimStart()}`);
      }
  }
  sayKv(ctx, [`parts=${parts.size}`, ...rows].join("\n"), ...texts);
  for (const p of parts.values()) partWarnings(ctx, p.m.check.part, p.m.check.valid, p.m.missing);
}

export const checkOp: OpHandler<"check"> = async (op, ctx) => {
  const d = runOf(ctx).doc;
  const t = op.cmd.target;
  if (d.kind === "draft") throw new Error(tr("kontrola: otevřený dokument je 2D výkres"));
  if (t === "assembly" && d.kind !== "assembly") throw new Error(tr("kontrola sestava: otevřený dokument není sestava"));
  if (typeof t === "object") {
    // díl podle názvu: komponenta sestavy (název, cesta, #2), jinak díl záložky / běhu
    if (d.kind === "assembly") {
      const leaf = leafByRef(d, flattenLeaves(d), t.part);
      await asmStatus(ctx.ws, ctx.host.kernel, d, { ...asmHooks(ctx), key: docKeyOf(ctx) });
      if (leaf.comp.source.kind === "part") return checkPart(ctx, leaf.comp.source.doc, op.cmd, leaf.comp.name);
      throw new Error(tr("kontrola díl: komponenta „{0}“ není díl s historií (importovaný soubor) – kontrola sestava", leaf.comp.name));
    }
    const p = ctx.ws.findPart(t.part);
    if (!p) throw new Error(tr("díl „{0}“ není mezi otevřenými záložkami – dostupné: {1}", t.part, ctx.ws.partNames().join(", ") || "—"));
    return checkPart(ctx, p, op.cmd);
  }
  if (d.kind === "assembly") return checkAssembly(ctx, d, op.cmd);
  return checkPart(ctx, d, op.cmd);
};
