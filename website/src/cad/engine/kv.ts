/**
 * Strojová část výpisů `=` stručného protokolu (CAD-HEADLESS-NAVRH.md kap. 4.2: `= <loc> <druh> <klíč=hodnota …>`):
 * klíče ASCII a stejné v cs/en/de, čísla s tečkou bez seskupení a s přilepenou jednotkou (`cm3`, `kg`, `mm`, `mm2`, `deg`),
 * vektory `x,y,z`, rozměry `AxBxC`, názvy v uvozovkách. Lokalizovaný text výpisu (to, co ukazuje konzole prohlížeče) nese
 * záznam zvlášť (`Entry.detail`) – je v plném protokolu a v JSON, do stručného protokolu se nepíše.
 *
 * Výpisy bez strojových údajů (nápověda, seznam záložek, kusovník…) mají v prvním řádku jen `lines=<n>` a jejich řádky
 * jsou pokračovací řádky výpisu (volný text v jazyce běhu, jako text za kódem u ✗/⚠).
 */
import type { AsmStatus, StaleNote } from "../agent";
import { outputsKv } from "../doc-outputs";
import { clashCountsKv } from "../clash-report";
import { sourceKey } from "../assembly";
import { mateLost } from "../mates";
import type { MeasureCyl, MeasureEnt, MeasureReport } from "../measure";
import { featureCounts } from "../feature-levels";
import type { BuildResult, CadDoc, Vec3 } from "../types";
import { MATERIALS } from "@/lib/mesh-metrics";
import { docKv, fmtNum, quote } from "./protocol";
import type { DocSummary } from "./protocol-types";

type Val = string | number | boolean | null | undefined;
/** dvojice klíč = hodnota; `null` / `undefined` hodnota nebo položka se vynechá */
export type KvPairs = (readonly [string, Val] | null | undefined | false)[];

/** hodnota bez mezer a uvozovek zůstane, jinak se dá do uvozovek (názvy, pravidla výběru) */
const TOKEN = /^[A-Za-z0-9._:/+,-]+$/;
const val = (v: Exclude<Val, null | undefined>): string => (typeof v === "boolean" ? (v ? "1" : "0") : typeof v === "number" ? fmtNum(v, 3) : TOKEN.test(v) ? v : quote(v));

/** `k=v k=v …` (bez vynechaných položek) */
export function kv(pairs: KvPairs): string {
  const out: string[] = [];
  for (const p of pairs) if (p && p[1] !== null && p[1] !== undefined && p[1] !== "") out.push(`${p[0]}=${val(p[1])}`);
  return out.join(" ");
}

/** číslo s jednotkou (`2.356cm3`); chybějící / nekonečné → undefined (položka se vynechá) */
export const num = (v: number | null | undefined, d = 3, unit = ""): string | undefined => (v === null || v === undefined || !Number.isFinite(v) ? undefined : `${fmtNum(v, d)}${unit}`);
/** vektor `x,y,z` */
export const vec = (v: Vec3 | null | undefined, d = 3): string | undefined => (v && v.every((x) => Number.isFinite(x)) ? v.map((x) => fmtNum(x, d)).join(",") : undefined);
/** rozměry obálky `AxBxC` */
export const size = (b: [Vec3, Vec3] | null | undefined, d = 3): string | undefined => (b ? [0, 1, 2].map((i) => fmtNum(b[1][i] - b[0][i], d)).join("x") : undefined);

/* ───────────────────────── měření ───────────────────────── */

const entPairs = (e: MeasureEnt): KvPairs => [
  ["kind", e.kind],
  ["type", e.type?.toLowerCase()],
  ["area", num(e.area, 3, "mm2")],
  ["len", num(e.length ?? e.extent?.length, 3, "mm")],
  ["d", num(e.diameter, 3, "mm")],
  ["r", e.diameter === undefined ? num(e.radius, 3, "mm") : undefined],
  ["center", vec(e.center)],
  ["point", vec(e.point)],
  ["normal", vec(e.normal)],
  ["axis", vec(e.axis?.dir)],
  ["dir", vec(e.dir)],
  ["arc", num(e.arc, 3, "deg")],
  ["span", e.span !== undefined && e.span < 360 ? num(e.span, 3, "deg") : undefined],
  ["hole", e.hole],
  ["cone", num(e.coneAngle, 3, "deg")],
];
const label = (l: string) => (TOKEN.test(l) ? l : quote(l));
const cylRow = (c: MeasureCyl, id: string, hole: boolean) =>
  `${id} ${kv([
    ["d", num(c.diameter, 3, "mm")],
    ["axis", vec(c.axis)],
    ["from", vec(c.from)],
    ["to", vec(c.to)],
    ["len", num(c.length, 3, "mm")],
    ["span", c.span < 360 ? num(c.span, 3, "deg") : undefined],
    ["faces", c.faces.map((f) => `F${f}`).join(",")],
    hole && ["entry", vec(c.entry)],
    hole && ["drill", vec(c.drill)],
    hole && ["through", c.through],
    hole && ["depth", num(c.depth, 3, "mm")],
    hole && ["bottom", c.bottom],
    hole && ["tip", num(c.tipAngle, 3, "deg")],
  ])}`;

/**
 * Strojová část výsledku `měřit` (první řádek; seznamy entit / děr / válců mají další řádky s jednou položkou na řádek).
 * Těleso: `V=2.356cm3 m=0.0185kg area=… bbox=10x10x30 com=… rho=7.85 faces= edges= vertices= solids=`.
 */
export function measureKv(rep: MeasureReport, comp?: string): string {
  switch (rep.kind) {
    case "entity":
      return kv([["ent", rep.entity.label], ...entPairs(rep.entity)]);
    case "list":
      return [kv([["what", rep.what], ["rule", rep.rule], ["n", rep.entities.length]]), ...rep.entities.map((e) => `${label(e.label)} ${kv(entPairs(e))}`)].join("\n");
    case "pair": {
      const p = rep.pair;
      return kv([
        ["a", p.a.label],
        ["b", p.b.label],
        ["dist", num(p.distance, 3, "mm")],
        ["delta", vec(p.delta)],
        ["p1", vec(p.p1)],
        ["p2", vec(p.p2)],
        ["angle", num(p.angle, 3, "deg")],
        ["angle.kind", p.angleKind],
        ["parallel", p.parallel],
        ["perpendicular", p.perpendicular],
        ["dist.plane", num(p.planeDistance, 3, "mm")],
        ["dist.axis", num(p.axisDistance, 3, "mm")],
        ["dist.center", num(p.centerDistance, 3, "mm")],
      ]);
    }
    case "body": {
      const b = rep.body;
      return kv([
        ["comp", comp],
        ["V", num(b.volume / 1000, 3, "cm3")],
        ["m", num(b.mass, 4, "kg")],
        ["area", num(b.area, 3, "mm2")],
        ["bbox", size(b.bbox)],
        ["min", vec(b.bbox[0])],
        ["max", vec(b.bbox[1])],
        ["com", vec(b.com)],
        ["rho", num(b.density, 3)],
        ["faces", b.faces],
        ["edges", b.edges],
        ["vertices", b.vertices],
        ["solids", b.solids],
      ]);
    }
    case "holes":
    case "cylinders": {
      const hole = rep.kind === "holes";
      const list = hole ? rep.holes : rep.cylinders;
      const groups = new Map<string, number>();
      for (const c of list) groups.set(fmtNum(c.diameter, 3), (groups.get(fmtNum(c.diameter, 3)) ?? 0) + 1);
      const head = kv([["comp", comp], [rep.kind, list.length], ["d", [...groups].map(([d, n]) => `${d}x${n}`).join(",")]]);
      return [head, ...list.map((c, i) => cylRow(c, `${hole ? "D" : "C"}${i + 1}`, hole))].join("\n");
    }
  }
}

/* ───────────────────────── stav dokumentu ───────────────────────── */

/** počty stavu vazeb sestavy (pro D a `= status`) */
export function matesCount(doc: CadDoc, st: AsmStatus["mates"]): DocSummary["mates"] {
  const mates = doc.mates ?? [];
  if (!mates.length || !st) return undefined;
  // ztracená reference (vlna 22, bod 20) je vlastnost dokumentu – počítá se i bez stavu řešiče a nikdy jako „ok“
  const n = (k: string) => mates.filter((m) => (m.suppressed ? "suppressed" : mateLost(m) ? "lost" : st[m.id]) === k).length;
  const lost = n("lost");
  return { total: mates.length, ok: n("ok"), conflict: n("conflict"), missing: n("missing"), suppressed: n("suppressed"), ...(lost ? { lost } : {}) };
}

/**
 * Souhrn dokumentu (`DocSummary`, řádek D) z výsledku stavby a stavu sestavy – společné pro `= status` a řádky D v CLI.
 * Díl: prvky ✓/⚠/✗, objem, obálka, hmotnost podle hustoty třídy materiálu. Sestava: komponenty, různé díly, vazby,
 * objem Σ, hmotnost Σ, obálka.
 */
export function docSummaryOf(doc: CadDoc, res: BuildResult | null, asm?: AsmStatus): DocSummary {
  const s: DocSummary = { ref: doc.name, name: doc.name, kind: doc.kind === "assembly" ? "assembly" : doc.kind === "draft" ? "draft" : "part" };
  if (doc.drawings?.length) s.sheets = doc.drawings.length;
  if (s.kind === "assembly") {
    s.components = doc.components?.length ?? 0;
    s.parts = new Set((doc.components ?? []).map((c) => sourceKey(c.source))).size;
    if (asm?.volume != null) s.volume_mm3 = asm.volume;
    if (asm?.massKg != null) s.mass_kg = asm.massKg;
    if (asm?.bbox) s.bbox = asm.bbox;
    const m = matesCount(doc, asm?.mates);
    if (m) s.mates = m;
    return s;
  }
  if (s.kind === "draft") return s;
  const st = res?.status ?? [];
  if (res) s.features = featureCounts(st);
  if (res?.metrics) {
    s.volume_mm3 = res.metrics.volume;
    s.bbox = res.metrics.bbox;
    if (res.metrics.solids !== undefined) s.solids = res.metrics.solids;
    if (res.metrics.free) s.free = res.metrics.free;
    s.valid = res.metrics.valid ?? null;
    if (typeof s.valid === "boolean") s.validCheck = res.metrics.validCheck ?? "fast";
    const mt = MATERIALS.find((m) => m.id === doc.material);
    if (mt) {
      s.density = mt.density;
      s.mass_kg = (res.metrics.volume / 1e6) * mt.density;
    }
  }
  return s;
}

/**
 * Strojová část `stav` (`= Ln status "dokument" …`): tytéž klíče jako řádek D (`docKv`), u dílu navíc `solids` / `valid`,
 * u sestavy obálka a výsledek poslední kontroly kolizí (`clash=<počet>`, nezkontrolováno `clash=-`, sestava se od kontroly
 * změnila `clash.stale=1`); sestava s pohybovou studií navíc `motion=ok|mates-ok|warn|conflict|clash|stale|-` (`ok` jen po kontrole
 * kolizí bez průniku a bez upozornění k motorům; `mates-ok` = vazby splněny, kolize nekontrolovány; `warn` = ⚠ k motorům;
 * cad/motion-cache.ts `motionVerdict`) a u výsledku, který pro nynější stav sestavy neplatí, `motion.stale=1`.
 *
 * Pořadí polí řádku (jednou pro všechny balíky): `docKv` … `bbox=` `clash=` `clash.stale=1` `motion=` `motion.stale=1`, pak
 * příznaky uložených výsledků z jiné revize `mates.stale=1` `measure.stale=1` `compare.stale=1` (vždy na konci – `tail`).
 * Nová pole se přidávají na konec své skupiny; zkouška pořadí: w22/w22-motion-fix.test.ts.
 */
export function statusKv(doc: CadDoc, res: BuildResult | null, asm?: AsmStatus, stale: readonly StaleNote[] = []): string {
  const base = docKv(docSummaryOf(doc, res, asm));
  // uložené výsledky z jiné revize dokumentu (engine/result-key.ts): `mates.stale=1`, `measure.stale=1`, `compare.stale=1`
  const old = kv([["mates.stale", asm?.matesStale ? true : undefined], ...[...new Set(stale.map((n) => n.kind))].map((k): [string, true] => [`${k}.stale`, true])]);
  // vydané listy a záznamy exportů ze starší revize modelu: `drawing.stale=N export.stale=N` (vlna 22, bod 20)
  const tail = [old, outputsKv(doc)].filter(Boolean).map((x) => ` ${x}`).join("");
  // obálku sestavy má už řádek D (`docKv`); bez obálky `bbox=-`
  // třídy kolizí jako v řádku D (`clash=5(thread=3,real=2)`, vlna 22 bod 5) – bez uvozovek, stejný tvar pro parser
  const clashTok = asm?.clash?.classes?.total ? `clash=${clashCountsKv(asm.clash.classes)}` : kv([["clash", asm?.clash ? asm.clash.count : "-"]]);
  if (doc.kind === "assembly") return `${base} ${[kv([["bbox", asm?.bbox ? undefined : "-"]]), clashTok, kv([["clash.stale", asm?.clash?.stale ? true : undefined], ["motion", asm?.motion ? (asm.motion.state === "unchecked" ? "-" : asm.motion.state) : undefined], ["motion.stale", asm?.motion?.state === "stale" ? true : undefined]])].filter(Boolean).join(" ")}${tail}`;
  if (doc.kind === "draft" || !res?.metrics) return `${base}${tail}`;
  // `solids=` a `valid=` (i `valid=unchecked`) nese už strojová část souhrnu dokumentu (`docKv`)
  return `${`${base} ${kv([["bodies", res.bodies && res.bodies.length > 1 ? res.bodies.length : undefined]])}`.trimEnd()}${tail}`;
}

/** Strojová část výpisů výkresu (`= Ln drawing …`): aktivní list / počet listů, formát, orientace, měřítko. */
export function drawingKv(doc: CadDoc, activeSheet: number): string {
  const sheets = doc.drawings ?? [];
  const s = sheets[activeSheet];
  const o = (s?.options ?? {}) as { sheet?: string; orientation?: string; scale?: unknown };
  return kv([
    ["sheet", sheets.length ? `${activeSheet + 1}/${sheets.length}` : "-"],
    ["format", o.sheet],
    ["orient", o.orientation],
    ["scale", typeof o.scale === "number" && o.scale > 0 ? (o.scale >= 1 ? `${fmtNum(o.scale, 3)}:1` : `1:${fmtNum(1 / o.scale, 3)}`) : typeof o.scale === "string" ? o.scale : undefined],
  ]);
}
