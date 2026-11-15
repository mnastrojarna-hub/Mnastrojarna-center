/**
 * Třídy kolizí sestavy – šroub × závit geometricky, bez tabulek závitů (CAD-HEADLESS-NAVRH.md kap. 6.3, balík B5).
 *
 * Šroub zašroubovaný do závitové díry se s dílem v CADu vždy „protíná“ (dřík ve jmenovitém průměru × díra s průměrem
 * vrtáku). Taková dvojice není chyba konstrukce: `kolize` ji hlásí jako ℹ `clash.thread` (přísný režim nezastaví) a skutečné
 * kolize (⚠ `clash.real`) nezapadnou mezi desítkami šroubů. Pravidlo pro dvojici (A, B), díra v B (a stejně obráceně):
 *
 *  1. kandidát = prvek `hole` s `kind: "tapped"` nebo vnitřní `thread` v B; bez závitového prvku → `clash.real`
 *     (kolík s přesahem v hladké díře je skutečná kolize – rozhodnutí 15.8);
 *  2. poloměr díry z geometrie B (válcová plocha díry souosá s prvkem), jmenovitý průměr D z označení (`M10`, `M10x1` → 10;
 *     žádná tabulka malého průměru); neznámé označení → `clash.undetermined`;
 *  3. průnik A∩B: každá válcová plocha musí být souosá s dírou (úhel < 0,5°, vzdálenost os < 0,05 mm); kužele (sražení
 *     hrotu) a jiné rotační plochy rozhodne bod 4;
 *  4. pásmo závitu = mezikruží [r_díry − ε, D/2 + ε] × hloubka díry (ε = 0,02 mm): zbytek mimo pásmo smí být jen prstenec
 *     u vstupu do hloubky 0,1·D a ≤ max(1 mm³, 5 % objemu v pásmu) (přechod pod hlavou, sražení) → ℹ `clash.underhead`;
 *     jinak `clash.real`.
 *
 * Tento modul je čistý (bez jádra): pravidla, rozbor označení, závitové prvky dílu a souhrny. Geometrii (průnik, plochy,
 * pásmo) počítá jádro operací `clashDetail` (clash-detail.ts); `classifyClashes` je volání z enginu / aplikace.
 * Rozhraní (`ClashClass`, `ClashPair`, `ClassifiedClash`, `ClashCounts`, `clashKv`) je stejné jako u předběžného odhadu
 * z prvků v balíku B4 (clash-thread.ts) – při sloučení stačí změnit import.
 */
import { flattenLeaves } from "./asm-flatten";
import { holeDrillD } from "./hole-spec";
import type { CadDoc, Feature, Vec3 } from "./types";

export type ClashClass = "thread" | "underhead" | "real" | "undetermined";
/** dvojice kolize z `interference` (a, b = id komponent nejvyšší úrovně; cesty = celé cesty listů v podsestavách) */
export type ClashPair = { a: string; b: string; volume: number; aPath?: string[]; bPath?: string[] };
/** důvod zařazení (strojově, pro JSON / plný protokol) */
export type ClashWhy =
  | "no-thread"
  | "thread"
  | "underhead"
  | "off-axis"
  | "outside-band"
  | "rest-deep"
  | "rest-large"
  | "unknown-designation"
  | "no-geometry"
  | "missing-component"
  | "kernel-failed";
/** výsledek jedné dvojice (jádro `clashDetail`) */
export type ClashDetail = ClashPair & {
  cls: ClashClass;
  why: ClashWhy;
  /** komponenta se závitovou dírou ("a" | "b"), podle které se dvojice zařadila */
  holeIn?: "a" | "b";
  /** díra: označení závitu, jmenovitý průměr, poloměr díry z geometrie, hloubka (mm) */
  hole?: { designation: string; D: number | null; r: number; depth: number; through: boolean };
  /** objem průniku v pásmu závitu a mimo něj (mm³); `restDepth` = nejhlubší místo zbytku od vstupu díry (mm) */
  band?: number;
  rest?: number;
  restDepth?: number;
  /** podrobnost (úhel / vzdálenost os, označení) do plného protokolu */
  note?: string;
};
export type ClassifiedClash = ClashDetail;
export type ClashCounts = { total: number; thread: number; underhead: number; real: number; undetermined: number };

/** meze pravidla (kap. 6.3) */
export const CLASH_RULE = {
  /** přídavek pásma závitu (mm) */
  eps: 0.02,
  /** největší úhel válcové plochy průniku k ose díry (°) */
  maxAngle: 0.5,
  /** největší vzdálenost os (mm) */
  maxAxisDist: 0.05,
  /** zbytek mimo pásmo jen do hloubky k·D od vstupu */
  restDepthD: 0.1,
  /** zbytek mimo pásmo nejvýš max(restMin, restShare · V pásma) */
  restMin: 1,
  restShare: 0.05,
} as const;

/**
 * Jmenovitý průměr metrického závitu z označení – bez tabulky: `M10`, `M10x1`, `M10×1,25`, `M8-6H`, `MF10x1` → 10.
 * Jiné označení (G 1/4, UNC, Tr, NPT…) nebo nesmysl → null (dvojice se pak nedá vyhodnotit: `clash.undetermined`).
 */
export function nominalDiameter(designation: string | undefined | null): number | null {
  const m = /^\s*MF?\s*(\d+(?:[.,]\d+)?)(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?(?:\s*-?\s*\d[a-hA-H](?:\d[a-hA-H])?)?\s*$/i.exec(String(designation ?? ""));
  if (!m) return null;
  const d = Number(m[1].replace(",", "."));
  return Number.isFinite(d) && d > 0 ? d : null;
}

/** závitový prvek dílu (vnitřní závit) ve vlastních souřadnicích dílu */
export type TapFeature = {
  id: string;
  name: string;
  designation: string;
  /** jmenovitý průměr z označení (null = neznámé označení) */
  D: number | null;
  /** poloměr vrtáku podle prvku (null = neznámý – vnitřní závit na existující díře) */
  drillR: number | null;
  /** osa díry (jednotkový směr bez ohledu na smysl; null = osa odkazem, neznámá bez stavby) */
  dir: Vec3 | null;
  /** body na ose (polohy díry); null = polohy odkazem nebo opakované polem / zrcadlením (určí se jen z geometrie) */
  points: Vec3[] | null;
};

const AXV: Record<string, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
type HoleF = Extract<Feature, { type: "hole" }>;
type ThreadF = Extract<Feature, { type: "thread" }>;

/** Vnitřní závity dílu: závitové díry (`hole` s `kind: "tapped"`) a vnitřní kosmetické / modelované závity (`thread`). */
export function tappedFeatures(doc: CadDoc | null | undefined): TapFeature[] {
  if (!doc) return [];
  const feats = doc.features ?? [];
  const repeated = (f: Feature) =>
    feats.some((g) => !g.suppressed && ((g.type === "pattern" && (g.featureIds?.length ? g.featureIds : [g.featureId]).includes(f.id)) || (g.type === "mirror" && feats.indexOf(g) > feats.indexOf(f))));
  const out: TapFeature[] = [];
  for (const f of feats) {
    if (f.suppressed) continue;
    if (f.type === "hole" && f.kind === "tapped" && f.thread) {
      const h = f as HoleF;
      const dir = h.dirDef ? (h.dirDef.kind === "vector" ? unit(h.dirDef.v) : h.dirDef.kind === "axis" ? AXV[h.dirDef.axis] : null) : AXV[h.axis] ?? AXV.Z;
      const pts = h.points?.length ? (h.points.every((p) => p.kind === "xyz") ? h.points.map((p) => (p as { p: Vec3 }).p) : null) : [h.position];
      out.push({ id: f.id, name: f.name, designation: h.thread!, D: nominalDiameter(h.thread), drillR: holeDrillD(h) / 2, dir, points: pts && !repeated(f) ? pts : null });
    } else if (f.type === "thread" && (f as ThreadF).internal) {
      const t = f as ThreadF;
      out.push({ id: f.id, name: f.name, designation: t.designation, D: nominalDiameter(t.designation), drillR: null, dir: t.dirDef?.kind === "vector" ? unit(t.dirDef.v) : AXV[t.axis] ?? AXV.Z, points: repeated(f) ? null : [t.position] });
    }
  }
  return out;
}

/** Geometrická díra (válcová plocha díry z jádra) ve vlastních souřadnicích dílu. */
export type GeoHole = { r: number; axis: Vec3; entry: Vec3; drill: Vec3; length: number; through: boolean };
/** Díra se závitem: geometrie díry + označení závitového prvku. */
export type TapHole = GeoHole & { designation: string; D: number | null; feature: string };

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** kolmá vzdálenost bodu od přímky (bod o, jednotkový směr d) */
export function lineDist(p: Vec3, o: Vec3, d: Vec3): number {
  const w = sub(p, o);
  const t = dot(w, d);
  return Math.hypot(w[0] - d[0] * t, w[1] - d[1] * t, w[2] - d[2] * t);
}
/** úhel dvou os ve stupních (bez ohledu na smysl) */
export const axisAngle = (a: Vec3, b: Vec3): number => (Math.acos(Math.min(1, Math.abs(dot(unit(a), unit(b))))) * 180) / Math.PI;

/**
 * Přiřadí geometrickým dírám dílu závitové prvky: osa rovnoběžná se směrem prvku (je-li znám), a buď bod polohy prvku
 * leží na ose díry (polohy zadané souřadnicemi), nebo – polohy odkazem / polem – poloměr díry odpovídá vrtáku prvku.
 * Jmenovitý průměr musí být větší než díra (šroub M10 v díře Ø8,5). Jedna díra = nejvýš jeden prvek (první vyhovující).
 */
export function matchTapHoles(features: readonly TapFeature[], holes: readonly GeoHole[]): TapHole[] {
  const out: TapHole[] = [];
  for (const h of holes) {
    const f = tapFeatureOf(features, h.r, h.axis, h.entry);
    if (f) out.push({ ...h, designation: f.designation, D: f.D, feature: f.id });
  }
  return out;
}

/** závitový prvek díry o poloměru `r` s osou `axis` procházející bodem `at` (null = díra bez závitového prvku) */
export function tapFeatureOf(features: readonly TapFeature[], r: number, axis: Vec3, at: Vec3): TapFeature | null {
  return (
    features.find((t) => {
      if (t.dir && axisAngle(t.dir, axis) > CLASH_RULE.maxAngle) return false;
      if (t.D !== null && !(r < t.D / 2)) return false;
      if (t.points) return t.points.some((p) => lineDist(p, at, axis) < Math.max(CLASH_RULE.maxAxisDist, 1e-3));
      if (t.drillR !== null) return Math.abs(t.drillR - r) < 0.01;
      return false;
    }) ?? null
  );
}

/** Rozhodnutí podle objemů (kap. 6.3 bod 4): v pásmu, mimo pásmo, nejhlubší místo zbytku od vstupu (mm). */
export function decideBand(o: { volume: number; band: number; rest: number; restDepth: number; D: number }): { cls: Exclude<ClashClass, "undetermined">; why: ClashWhy } {
  const R = CLASH_RULE;
  if (!(o.band > 1e-3)) return { cls: "real", why: "outside-band" };
  // numerický šum booleovských operací (pásmo je o ε širší než díra i dřík)
  if (o.rest <= Math.max(1e-3, 1e-6 * o.volume)) return { cls: "thread", why: "thread" };
  if (o.rest > Math.max(R.restMin, R.restShare * o.band)) return { cls: "real", why: "rest-large" };
  if (o.restDepth > R.restDepthD * o.D + R.eps) return { cls: "real", why: "rest-deep" };
  return { cls: "underhead", why: "underhead" };
}

/** Výsledek několika samostatných kusů průniku (nebo obou stran dvojice): skutečná kolize přebije ostatní. */
export function worstClass(list: readonly ClashClass[]): ClashClass {
  if (list.includes("real")) return "real";
  if (list.includes("undetermined")) return "undetermined";
  if (list.includes("underhead")) return "underhead";
  return "thread";
}

/** počty tříd */
export function countClasses(list: readonly Pick<ClashDetail, "cls">[]): ClashCounts {
  const c: ClashCounts = { total: list.length, thread: 0, underhead: 0, real: 0, undetermined: 0 };
  for (const x of list) c[x.cls]++;
  return c;
}

/** strojová část výpisu kolizí (`= clash …`), stejná v cs/en/de */
export const clashKv = (c: ClashCounts) => `total=${c.total} thread=${c.thread} underhead=${c.underhead} real=${c.real} undetermined=${c.undetermined}`;

/**
 * Otisk sestavy, pro který platí výsledek kontroly kolizí: listy (cesta id, obsah dílu = `sourceKey`, skrytí) a jejich světové
 * matice (zaokrouhlené na 1e-6). Jiný otisk = sestava se od kontroly změnila (vložená / posunutá / skrytá komponenta, upravený
 * díl) a uložený výsledek už neplatí – CLI ho na konci běhu přepočítá, textový stav ho označí jako neplatný.
 */
export function clashSig(doc: CadDoc): string {
  const q = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
  return JSON.stringify(flattenLeaves(doc).map((l) => [l.id, l.key, l.hidden ? 1 : 0, l.matrix.map(q)]));
}

/** neplatí uložený výsledek kontroly kolizí pro sestavu v jejím nynějším stavu? (výsledek bez otisku = nelze poznat → platí) */
export function clashStale(entry: { sig?: string } | undefined | null, d: CadDoc): boolean {
  return !!entry?.sig && entry.sig !== clashSig(d);
}

/** jádro pro třídění (klient jádra v prohlížeči i v CLI) */
export type ClashKernel = { clashDetail(doc: CadDoc, pairs: ClashPair[]): Promise<ClashDetail[]> };

/** Zařadí dvojice kolizí sestavy geometricky v jádře (`clashDetail`) a spočte třídy. Bez dvojic jádro nevolá. */
export async function classifyClashes(kernel: ClashKernel, doc: CadDoc, pairs: readonly ClashPair[]): Promise<{ list: ClassifiedClash[]; counts: ClashCounts }> {
  if (!pairs.length) return { list: [], counts: countClasses([]) };
  const plain = pairs.map((p) => ({ a: p.a, b: p.b, volume: p.volume, ...(p.aPath ? { aPath: p.aPath } : {}), ...(p.bPath ? { bPath: p.bPath } : {}) }));
  let list: ClashDetail[];
  try {
    list = await kernel.clashDetail(doc, plain);
  } catch (e) {
    // zrušený výpočet se nepolyká; jiná chyba jádra = dvojice nevyhodnotitelné (⚠ clash.undetermined s důvodem), ne ztracená kolize
    if (e instanceof Error && e.name === "CadCancelled") throw e;
    const note = e instanceof Error ? e.message : String(e);
    list = plain.map((p) => ({ ...p, cls: "undetermined" as const, why: "kernel-failed" as const, note }));
  }
  return { list, counts: countClasses(list) };
}
