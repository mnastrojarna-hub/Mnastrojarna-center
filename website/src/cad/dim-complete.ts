/**
 * Kontrola kót pro výrobní úplnost (vlna 22, bod 18) – čisté funkce bez jádra, stejné v prohlížeči i v CLI.
 *
 * Dosavadní „Kontrola kót“ (dim-check.ts) porovnávala čísla: očekávané velikosti z parametrů prvků proti textům kót na listu.
 * Tím chtěla výšku pomocného řezného tělesa, nehlídala polohy prvků a jedna kóta „Ø8“ splnila dvě díry. Tady:
 *
 * - **co se očekává** – z VÝSLEDNÉHO dílu: celkové rozměry; velikost i POLOHA děr (po skupinách stejných děr s počtem „n×“),
 *   odebraných kvádrů / válců (kapsy, okna, drážky) a obrysů skic na základních rovinách; tělesa spotřebovaná
 *   `sloučit … odebrat | průnik` (pomocná, nástrojová) se nekótují – jejich odebrání se kontroluje jako tvar v dílu
 *   (`auxInfo`, dim-check.ts); ostatní velikosti jako dřív z parametrů prvků (`expectedDims`);
 * - **jak se páruje** – kóta → prvek PODLE GEOMETRIE: koncové body kóty v souřadnicích pohledu → osa modelu a souřadnice;
 *   poloha je okótovaná, když některá délková kóta téže osy končí na souřadnici prvku (a není to jen jeho velikost), když
 *   osa souměrnosti prochází středem prvku, nebo když je díra v tabulce děr; průměr / popis díry podle středu kružnice;
 *   hloubka díry jen z popisu díry („↧10“, „hl. 10“) nebo z kóty podél osy díry od vstupu; kóty zapečené v pohledu
 *   (volba Auto / jen celkové) jen hodnotou a polohy pak „nezkontrolováno“;
 * - **funkční prvky a základny** vyznačené v modelu (`CadDoc.functional`, příkazy `funkční` / `základna`): velikost, poloha
 *   (od základny na téže ose) a tolerance na kótě (shoda s předepsanou); přesná tolerance na nefunkčním rozměru = ℹ;
 * - **výsledek nikdy neříká „kompletní“ ani „všech N“** – říká, co se zkontrolovalo (velikosti a/b, polohy c/d), co chybí
 *   a co se nekontroluje.
 */
import { dimTextHidesValue } from "./drawing-notes-rules";
import { tr } from "./i18n";
import { auxInfo, countOf, expectedDims, presentDims, type DimKind } from "./dim-check";
import { placementOf } from "./placements";
import { threadByName, threadLabel } from "./defaults";
import { modelRev } from "./engine/result-key";
import type { CadDoc, DrawingAnnotation, Feature, FunctionalMark, Vec2, Vec3 } from "./types";

/* ───────────────────────── typy ───────────────────────── */

/** pohled výkresu, jak ho kontrola potřebuje (PlacedView z drawing.ts) */
export type CheckView = { key: string; x0: number; y0: number; w: number; h: number; cam?: { d: Vec3; x: Vec3 }; brk?: unknown; /** měřítko pohledu (mm listu / mm modelu) – poloha kótovací čáry z odsazení */ s?: number };
/** řádek tabulky děr (HoleRow z drawing.ts) – střed v souřadnicích pohledu */
export type CheckHoleRow = { c: Vec2; view: string; d: number };

export type ReqStatus = "ok" | "missing" | "partial" | "unchecked";
export type DimReq = {
  /** stálý klíč položky (pro GUI a „výkres doplnit kóty“) */
  id: string;
  kind: "size" | "pos";
  /** popisek pro člověka: „30 (Kvádr 2)“, „poloha Díra 1 – X 15“ */
  label: string;
  /** prvek / zdroj („celkové rozměry“) */
  source: string;
  featureId?: string;
  dim: DimKind;
  value: number;
  /** osa modelu (0 = X, 1 = Y, 2 = Z) velikosti / polohy */
  axis?: 0 | 1 | 2;
  /** velikost: interval na ose (souřadnice modelu) */
  span?: [number, number];
  /** poloha: souřadnice, na které může kóta končit (hrany / střed prvku) */
  at?: number[];
  /** bod prvku (pro návrh kóty „Přidat kótu“) */
  point?: Vec3;
  /** díry skupiny: středy (všechny výskyty), osa, poloměr, počet */
  holes?: { centers: Vec3[]; dir: Vec3; r: number; n: number; depth?: number; entry?: number[]; /** všechny polohy děr skupiny jsou známé (čísla, ne odkazy) */ exact: boolean };
  /**
   * poloha výchozí díry kruhového pole na ose `axis`, když díra leží na přímce středem pole rovnoběžné s touto osou:
   * souřadnici dává roztečná kružnice Ø `d` se středem `center` (osa pole ∥ `dir`) spolu s polohou středu na téže ose
   */
  pcd?: { center: Vec3; d: number; dir: Vec3 };
  /**
   * poloha díry: osa díry (osa modelu `ka`), poloměr a rozsah osy v dílu – kóta polohy platí jen, když její pomocná čára vede
   * na osu díry (bod kóty na kružnici / středu díry, nebo na čáře osy v pohledu z boku), ne libovolná kóta se shodnou
   * souřadnicí jinde na listu (vlna 22, bod 18, kolo 6)
   */
  hole?: { ka: 0 | 1 | 2; r: number; lo: number; hi: number; /** jiné díry (střed, poloměr) se stejnou souřadnicí na ose polohy – na téže osové čáře */ peers?: { c: Vec3; r: number }[] };
  /** jen hodnotou (bez geometrie) – dosavadní kontrola */
  byValue?: boolean;
  functional?: boolean;
  /** předepsaná tolerance funkčního prvku */
  tol?: string;
  /** základna na ose polohy funkčního prvku */
  datum?: { label: string; c: number };
  status: ReqStatus;
  /** kolik kusů je na listu (skupina děr) */
  have?: number;
  /** podrobnost: „na listu 1× z 2×“, „chybí poloha od základny A“ */
  why?: string;
  /** tolerance kót, které položku splňují ("" = bez tolerance) */
  tols?: string[];
  /** funkční položka: stav tolerance */
  tolState?: "ok" | "missing" | "differs";
};
export type DimCompleteResult = {
  items: DimReq[];
  size: { ok: number; total: number };
  pos: { ok: number; total: number };
  /** pomocná (nástrojová) tělesa – nekótují se */
  aux: { name: string; op: "cut" | "intersect"; features: string[] }[];
  /** co se nekontrolovalo (lidsky) */
  unchecked: string[];
  /** kóty zapečené v pohledu (Auto / jen celkové) – polohy nejdou ověřit */
  baked: boolean;
  tol: {
    /** vyznačené funkční prvky (+ funkční rozměry listu) */
    marked: number;
    ok: number;
    missing: DimReq[];
    /** přesná tolerance na rozměru, který není funkční (přetolerování – ℹ) */
    over: { ann: string; label: string; tol: string }[];
    /** označené plochy / základny ze starší revize modelu – nekontrolují se (nezkontrolováno, označit znovu) */
    stale?: number;
  };
};

/* ───────────────────────── vektory a čísla ───────────────────────── */

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: Vec3): Vec3 => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const AXV: Record<string, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const AXN = ["X", "Y", "Z"] as const;
const fmt = (n: number) => (Math.round(n * 100) / 100).toString().replace(".", ",");
const tolOf = (v: number) => Math.max(0.01, Math.abs(v) * 1e-4);
const eq = (a: number, b: number) => Math.abs(a - b) <= tolOf(Math.max(Math.abs(a), Math.abs(b)));
/** osa souřadnic, se kterou je vektor rovnoběžný (±), jinak null */
function axisOf(v: Vec3): { k: 0 | 1 | 2; s: 1 | -1 } | null {
  const k = [0, 1, 2].reduce((m, i) => (Math.abs(v[i]) > Math.abs(v[m]) ? i : m), 0) as 0 | 1 | 2;
  return Math.abs(v[k]) > 0.999 ? { k, s: v[k] > 0 ? 1 : -1 } : null;
}
const upOf = (c: { d: Vec3; x: Vec3 }) => cross(c.d, c.x);
/** bod modelu → souřadnice pohledu (SVG, y dolů – jako drawing.ts `proj`) */
const projQ = (c: { d: Vec3; x: Vec3 }, p: Vec3): Vec2 => [dot(p, c.x), -dot(p, upOf(c))];
const near2 = (a: Vec2, b: Vec2, t: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= t;

/* ───────────────────────── obálka z pohledů ───────────────────────── */

/** Skutečná obálka dílu (souřadnice modelu) z rozsahů pohledů (přerušené pohledy se přeskočí – jejich rozsah je zkrácený). */
export function viewsBbox(views: readonly CheckView[]): [Vec3, Vec3] | null {
  const lo: (number | null)[] = [null, null, null];
  const hi: (number | null)[] = [null, null, null];
  for (const v of views) {
    if (!v.cam || v.brk) continue;
    const ax = axisOf(v.cam.x);
    const up = axisOf(upOf(v.cam));
    if (ax && lo[ax.k] === null) {
      const r = ax.s > 0 ? [v.x0, v.x0 + v.w] : [-(v.x0 + v.w), -v.x0];
      lo[ax.k] = r[0];
      hi[ax.k] = r[1];
    }
    if (up && lo[up.k] === null) {
      const r = up.s > 0 ? [-(v.y0 + v.h), -v.y0] : [v.y0, v.y0 + v.h];
      lo[up.k] = r[0];
      hi[up.k] = r[1];
    }
  }
  if (lo.some((x) => x === null)) return null;
  // −0 z převrácené osy obrazu → 0
  return [lo.map((x) => (x as number) + 0) as Vec3, hi.map((x) => (x as number) + 0) as Vec3];
}

/* ───────────────────────── kóty na listu jako fakta ───────────────────────── */

/** délková kóta: osa modelu `k`, souřadnice konců `c1`, `c2`; `ko` = druhá osa v rovině pohledu a souřadnice konců na ní (`o1`, `o2`) – kde kóta leží */
type LinFact = { i: number; k: 0 | 1 | 2; c1: number; c2: number; ko: 0 | 1 | 2 | null; o1: number; o2: number; /** souřadnice kótovací čáry na ose `ko` (kam vedou pomocné čáry; NaN = neznámá) */ line: number; tol: string; label: string; value: number; dia: boolean; ord: boolean };
type CircFact = { i: number; view: string; cam: { d: Vec3; x: Vec3 }; c: Vec2; r?: number; tip?: Vec2; value: number; kind: DimKind; count: number; depth: number[]; tol: string; label: string; tags?: { c: Vec2; r: number }[] };
type CenterFact = { k: 0 | 1 | 2; c: number };
type Facts = { lin: LinFact[]; circ: CircFact[]; centers: CenterFact[]; table: { c: Vec2; view: string; d: number }[]; texts: { kind: DimKind; value: number; text: string; count: number }[] };

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const num = (s: string) => parseFloat(s.replace(",", "."));
/** tolerance zapsaná u kóty (přípona uživatele, nebo text kóty s ±/uložením) */
export function annTolerance(a: DrawingAnnotation): string {
  if (a.type === "callout") return a.tol?.trim() ?? "";
  if (a.type !== "dim") return "";
  // přípona: stoupání závitu „×1,5“ na začátku a „)“ / „ (=90)“ na konci tvoří Chytré kóty – tolerance je mezi nimi
  let s = a.suffix ?? "";
  if (a.prefix === "M") s = s.replace(/^×\d+(?:[.,]\d+)?/, "");
  s = s.replace(/\)$/, "").replace(/ \(=[^()]*\)$/, "").trim();
  if (s) return s;
  return a.text && /[±+\-−]\s*\d|\b[A-Za-z]{1,2}\d{1,2}\b/.test(a.text) ? a.text.trim() : "";
}
/** popisek kóty na listu (hodnota s předponou) – bez jádra */
function factLabel(a: DrawingAnnotation, value: number): string {
  if (a.type === "callout") return a.lines.join(" ");
  if (a.type !== "dim") return "";
  return a.text?.trim() || `${a.prefix && !/^\d+× $/.test(a.prefix) && a.prefix !== "(" ? a.prefix : ""}${fmt(value)}`;
}

/** Fakta kót listu: délkové kóty (osa modelu + souřadnice konců), kružnice a popisy (střed v pohledu), osy souměrnosti, tabulka děr. */
export function sheetFacts(views: readonly CheckView[], anns: readonly DrawingAnnotation[], holeRows: readonly CheckHoleRow[] = [], bakedTexts: readonly { s: string; layer?: string }[] = []): Facts {
  const f: Facts = { lin: [], circ: [], centers: [], table: holeRows.map((r) => ({ c: r.c, view: r.view, d: r.d })), texts: [] };
  anns.forEach((a, i) => {
    const v = views.find((x) => x.key === a.view);
    const cam = v?.cam;
    if (!cam) return;
    const ax = axisOf(cam.x);
    const up = axisOf(upOf(cam));
    // D2 (vlna 23): kóta, jejíž text nahradil hodnotu slovy („Odmastit“), rozměr na listu neukazuje – velikost nepokrývá
    if (dimTextHidesValue(a)) return;
    if (a.type === "dim" && (a.kind === "horizontal" || a.kind === "vertical" || a.kind === "aligned")) {
      let dir: "h" | "v" | null = a.kind === "horizontal" ? "h" : a.kind === "vertical" ? "v" : null;
      if (!dir && a.kind === "aligned") dir = Math.abs(a.b[1] - a.a[1]) < 1e-6 ? "h" : Math.abs(a.b[0] - a.a[0]) < 1e-6 ? "v" : null;
      const A = dir === "h" ? ax : up;
      if (!dir || !A) return;
      // souřadnice modelu: vodorovně a[0] = s·p[k]; svisle a[1] = −s·p[k]
      const w = (q: Vec2) => (dir === "h" ? q[0] * A.s : -q[1] * A.s);
      const O = dir === "h" ? up : ax;
      const wo = (q: Vec2) => (!O ? NaN : dir === "h" ? -q[1] * O.s : q[0] * O.s);
      const c1 = w(a.a);
      const c2 = w(a.b);
      const value = Math.abs(c2 - c1);
      // kótovací čára: odsazení [mm listu] od prvního bodu (jako drawing.ts – vodorovná y = a.y + odsazení, svislá x = a.x + …)
      const sc = v?.s;
      const line = sc && a.kind !== "aligned" ? wo(dir === "h" ? [a.a[0], a.a[1] + a.offset / sc] : [a.a[0] + a.offset / sc, a.a[1]]) : NaN;
      f.lin.push({ i, k: A.k, c1, c2, ko: O?.k ?? null, o1: wo(a.a), o2: wo(a.b), line, tol: annTolerance(a), label: factLabel(a, value), value, dia: /^[ØM⌀]/.test(a.prefix ?? "") || /^[ØM⌀]/.test(a.text ?? ""), ord: !!a.ord });
      return;
    }
    if (a.type === "dim" && (a.kind === "diameter" || a.kind === "radius")) {
      const value = a.kind === "diameter" ? 2 * a.r : a.r;
      const cnt = /^(\d+)\s*×/.exec(a.prefix ?? a.text ?? "");
      f.circ.push({ i, view: a.view, cam, c: a.c, r: a.r, value, kind: a.kind === "diameter" ? (/^M/.test(a.prefix ?? a.text ?? "") ? "thread" : "dia") : "rad", count: cnt ? Number(cnt[1]) : 1, depth: [], tol: annTolerance(a), label: factLabel(a, value) });
      return;
    }
    if (a.type === "callout") {
      const first = a.lines[0] ?? "";
      const cnt = /^\s*(\d+)\s*×\s/.exec(first);
      const body = first.replace(/^\s*\d+\s*×\s+/, "").replace(/^\s*[⌴⌵]\s*/, "");
      const m = new RegExp(`^([ØøM⌀R])\\s*${NUM}`).exec(body);
      if (!m) return;
      const kind: DimKind = m[1] === "M" ? "thread" : m[1] === "R" ? "rad" : "dia";
      const depth = a.lines.flatMap((l) => [...l.matchAll(new RegExp(`(?:hl\\.|↧)\\s*${NUM}`, "g"))].map((x) => num(x[1])));
      f.circ.push({ i, view: a.view, cam, c: a.circle?.c ?? a.tip, r: a.circle?.r, tip: a.tip, value: num(m[2]), kind, count: cnt ? Number(cnt[1]) : 1, depth, tol: annTolerance(a), label: a.lines.join(" "), ...(a.tags?.length ? { tags: a.tags } : {}) });
      return;
    }
    if (a.type === "centerline") {
      if (Math.abs(a.a[1] - a.b[1]) < 1e-6 && up) f.centers.push({ k: up.k, c: -a.a[1] * up.s });
      else if (Math.abs(a.a[0] - a.b[0]) < 1e-6 && ax) f.centers.push({ k: ax.k, c: a.a[0] * ax.s });
    }
  });
  // kóty zapečené v pohledu (Auto / jen celkové): jen texty, bez geometrie
  for (const t of presentDims([...bakedTexts])) {
    const cnt = /^\s*(\d+)\s*[×x]\s/.exec(t.text);
    f.texts.push({ ...t, count: cnt ? Number(cnt[1]) : 1 });
  }
  // texty listu obsahují i texty délkových kót z poznámek listu – ty mají geometrii (osu, směr), takže se hodnotou znovu
  // nepárují: vodorovná „60“ v horním pohledu (X) nesmí jako text splnit šířku Y 60 (vlna 22, bod 18, kolo 6). Odebere se
  // jeden text za každou takovou kótu (souřadnicové kóty a průměry ne – ty se hodnotou párují dál).
  for (const x of f.lin) {
    if (x.ord || x.dia) continue;
    const j = f.texts.findIndex((t) => t.kind === "lin" && Math.abs(t.value - x.value) <= Math.max(0.01, Math.abs(x.value) * 1e-4));
    if (j >= 0) f.texts.splice(j, 1);
  }
  return f;
}

/* ───────────────────────── očekávané rozměry ───────────────────────── */

type Ctx = { doc: CadDoc; bbox: [Vec3, Vec3] | null; reqs: DimReq[]; unchecked: string[]; seen: Set<string> };
const SRC_OVERALL = () => tr("celkové rozměry");

function addReq(c: Ctx, r: Omit<DimReq, "status">): DimReq | null {
  // stejný význam (osa + interval / souřadnice) stačí jednou – např. kvádr přes celý díl = celkový rozměr
  const key = r.kind === "size" && r.span && r.axis !== undefined ? `s:${r.axis}:${r.span.map((x) => x.toFixed(3)).join(":")}` : r.kind === "pos" && r.at && r.axis !== undefined ? `p:${r.featureId ?? ""}:${r.axis}:${r.at.map((x) => x.toFixed(3)).join(":")}` : `${r.kind}:${r.id}`;
  if (c.seen.has(key)) return null;
  c.seen.add(key);
  const x: DimReq = { ...r, status: "missing" };
  c.reqs.push(x);
  return x;
}

/** bod skici (u; v) ve 3D na základní rovině (jako replicad makePlane / drawing-dims `sketchPoint`); obecná rovina → null */
function sketchPt(pl: Extract<Feature, { type: "sketch" }>["plane"], u: number, v: number): Vec3 | null {
  if (pl.kind === "custom") return null;
  if (pl.name === "XY") return [u, v, pl.offset];
  if (pl.name === "XZ") return [u, -pl.offset, v];
  return [pl.offset, u, v];
}
const planeAxes = (pl: Extract<Feature, { type: "sketch" }>["plane"]): [0 | 1 | 2, 0 | 1 | 2] | null => (pl.kind === "custom" ? null : pl.name === "XY" ? [0, 1] : pl.name === "XZ" ? [0, 2] : [1, 2]);

/** interval [lo, hi] na ose k leží uvnitř obálky (neprochází, nedotýká se hrany) */
const interior = (bbox: [Vec3, Vec3] | null, k: number, lo: number, hi: number) => !!bbox && lo > bbox[0][k] + tolOf(lo) && hi < bbox[1][k] - tolOf(hi);
/** ořez intervalu obálkou; null = mimo díl */
function clip(bbox: [Vec3, Vec3] | null, k: number, lo: number, hi: number): { lo: number; hi: number; through: boolean } | null {
  if (!bbox) return { lo, hi, through: false };
  const a = Math.max(lo, bbox[0][k]);
  const b = Math.min(hi, bbox[1][k]);
  if (b - a <= 1e-6) return null;
  return { lo: a, hi: b, through: lo <= bbox[0][k] + 1e-6 && hi >= bbox[1][k] - 1e-6 };
}

/** výskyty prvku (vzory lineární / kruhové, zrcadlení) – středy děr pro párování popisu s dírou */
function instances(doc: CadDoc, f: Feature, seeds: Vec3[]): Vec3[] {
  let pts = seeds;
  const idx = doc.features.indexOf(f);
  for (const g of doc.features) {
    if (g.suppressed) continue;
    if (g.type === "pattern") {
      const ids = g.featureIds?.length ? g.featureIds : [g.featureId];
      if (!ids.includes(f.id)) continue;
      if (g.kind === "linear") {
        // směr zadaný vektorem má přednost (jako drawing-dims.ts `featureInstances`)
        const dd1 = (g as { dirDef?: { kind: string; v?: Vec3 } }).dirDef;
        const dd2 = (g as { dirDef2?: { kind: string; v?: Vec3 } }).dirDef2;
        const d1 = unit(dd1?.kind === "vector" && dd1.v ? dd1.v : (g.direction ?? [1, 0, 0]));
        const d2 = unit(dd2?.kind === "vector" && dd2.v ? dd2.v : (g.direction2 ?? [0, 1, 0]));
        const n1 = Math.max(1, Math.round(g.count));
        const n2 = Math.max(1, Math.round(g.count2 ?? 1));
        const s1 = (g as { spacingMode?: string }).spacingMode === "total" && n1 > 1 ? g.spacing / (n1 - 1) : g.spacing;
        const s2 = g.spacing2 ?? g.spacing;
        pts = pts.flatMap((p) => Array.from({ length: n1 * n2 }, (_, i) => add(p, add(mul(d1, s1 * Math.floor(i / n2)), mul(d2, s2 * (i % n2))))));
      } else if (g.kind === "circular") {
        const ax = AXV[g.axis] ?? [0, 0, 1];
        const n = Math.max(1, Math.round(g.count));
        pts = pts.flatMap((p) =>
          Array.from({ length: n }, (_, i) => {
            const t = (((g.angle >= 360 ? 360 / n : g.angle / Math.max(1, n - 1)) * i) * Math.PI) / 180;
            const w: Vec3 = [p[0] - g.center[0], p[1] - g.center[1], p[2] - g.center[2]];
            const r = add(add(mul(w, Math.cos(t)), mul(cross(ax, w), Math.sin(t))), mul(ax, dot(ax, w) * (1 - Math.cos(t))));
            return add(g.center, r);
          }),
        );
      }
    } else if (g.type === "mirror" && doc.features.indexOf(g) > idx && (!g.featureIds?.length || g.featureIds.includes(f.id))) {
      const k = g.plane === "YZ" ? 0 : g.plane === "XZ" ? 1 : 2;
      pts = pts.flatMap((p) => {
        const m = [...p] as Vec3;
        m[k] = 2 * g.offset - p[k];
        return g.keepOriginal ? [p, m] : [m];
      });
    }
  }
  return pts;
}

/** kruhové pole, které opakuje díru `f` kolem osy rovnoběžné s osou díry (osa modelu `k`), nebo null */
function circularOf(doc: CadDoc, f: Feature, k: 0 | 1 | 2): { center: Vec3; dir: Vec3 } | null {
  for (const g of doc.features) {
    if (g.suppressed || g.type !== "pattern" || g.kind !== "circular") continue;
    const ids = g.featureIds?.length ? g.featureIds : [g.featureId];
    if (!ids.includes(f.id)) continue;
    const dir = AXV[g.axis] ?? [0, 0, 1];
    if (Math.abs(dir[k]) < 0.999) return null;
    return { center: [...g.center] as Vec3, dir };
  }
  return null;
}
/**
 * Roztečná kružnice jako kóta polohy výchozí díry kruhového pole na ose `k` (`ka` = osa pole): jen když díra leží na
 * přímce středem pole rovnoběžné s osou `k` (druhá souřadnice v rovině = souřadnice středu) – pak je souřadnice díry
 * střed ± poloměr roztečné kružnice. Díra jinde na kružnici (natočená) potřebuje i úhel → roztečná kružnice nestačí.
 */
function pcdFor(ring: { center: Vec3; dir: Vec3 }, p: Vec3, k: 0 | 1 | 2, ka: 0 | 1 | 2): DimReq["pcd"] | null {
  const o = ([0, 1, 2] as const).find((j) => j !== k && j !== ka)!;
  const r = Math.abs(p[k] - ring.center[k]);
  if (r < 1e-6 || !eq(p[o], ring.center[o])) return null;
  return { center: ring.center, d: 2 * r, dir: ring.dir };
}

type HoleF = Extract<Feature, { type: "hole" }>;
const holeDir = (f: HoleF): Vec3 | null => (f.dirDef?.kind === "vector" ? unit(f.dirDef.v) : f.dirDef?.kind === "axis" ? AXV[f.dirDef.axis] : f.dirDef ? null : AXV[f.axis ?? "Z"]);
/** specifikace díry (stejné díry = jedna skupina s počtem „n×“) */
const holeSpec = (f: HoleF) => JSON.stringify([f.kind ?? "simple", f.thread ?? "", f.diameter, f.depth, f.cbDiameter, f.cbDepth, f.csDiameter ?? 0, f.head ?? "", f.tapDrill ?? ""]);

/** Očekávané rozměry výsledného dílu (velikosti i polohy). */
export function requirements(doc: CadDoc, bbox: [Vec3, Vec3] | null): { reqs: DimReq[]; aux: DimCompleteResult["aux"]; unchecked: string[] } {
  const aux = auxInfo(doc);
  const c: Ctx = { doc, bbox, reqs: [], unchecked: [], seen: new Set() };
  // celkové rozměry
  if (bbox) {
    for (const k of [0, 1, 2] as const) {
      const L = bbox[1][k] - bbox[0][k];
      const label = k === 0 ? tr("{0} (délka X)", fmt(L)) : k === 1 ? tr("{0} (šířka Y)", fmt(L)) : tr("{0} (výška Z)", fmt(L));
      if (L > 1e-6) addReq(c, { id: `overall:${k}`, kind: "size", label, source: SRC_OVERALL(), dim: "lin", value: L, axis: k, span: [bbox[0][k], bbox[1][k]], point: [...bbox[0]] as Vec3 });
    }
  }
  // ostatní velikosti z parametrů prvků (bez děr a kvádrů – ty níže geometricky; bez celkových – výše)
  const rest = expectedDims({ ...doc, features: doc.features.filter((f) => f.type !== "box") }, bbox, { aux, noHoles: true }).filter((e) => e.source !== SRC_OVERALL());
  rest.forEach((e, i) => addReq(c, { id: `v:${i}:${e.kind}:${e.value}`, kind: "size", label: e.label, source: e.source, featureId: doc.features.find((f) => f.name === e.source)?.id, dim: e.kind, value: e.value, byValue: true }));

  const groups = new Map<string, { feats: HoleF[]; centers: Vec3[]; n: number; dir: Vec3 | null; exact: boolean }>();
  for (const f0 of doc.features) {
    if (f0.suppressed || aux.skip.has(f0.id)) continue;
    const cutTool = aux.cut.has(f0.id);
    const f = f0;
    switch (f.type) {
      case "box": {
        const cut = f.mode === "cut" || cutTool;
        if (f.dirDef || f.positionRef) {
          // kvádr natočený / odkazem: jen hodnotou, poloha se nekontroluje
          f.size.forEach((v, k) => addReq(c, { id: `box:${f.id}:${k}`, kind: "size", label: `${fmt(v)}`, source: f.name, featureId: f.id, dim: "lin", value: v, byValue: true }));
          c.unchecked.push(tr("poloha {0} (kvádr natočený nebo zadaný odkazem)", f.name));
          break;
        }
        f.size.forEach((v, k) => {
          const lo0 = f.centered ? f.position[k] - v / 2 : f.position[k];
          const kk = k as 0 | 1 | 2;
          const cl = cut ? clip(bbox, k, lo0, lo0 + v) : { lo: lo0, hi: lo0 + v, through: false };
          if (!cl || (cut && cl.through)) return; // odebrání skrz celý díl: rozměr nástroje není rozměr dílu
          const len = cl.hi - cl.lo;
          const mid: Vec3 = f.size.map((s, j) => (f.centered ? f.position[j] : f.position[j] + s / 2)) as Vec3;
          addReq(c, { id: `box:${f.id}:${k}`, kind: "size", label: len < v - 1e-6 ? tr("{0} (v tělese)", fmt(len)) : fmt(len), source: f.name, featureId: f.id, dim: "lin", value: len, axis: kk, span: [cl.lo, cl.hi], point: mid });
          if (interior(bbox, k, cl.lo, cl.hi)) addReq(c, { id: `boxpos:${f.id}:${k}`, kind: "pos", label: tr("poloha {0} – {1} {2}", f.name, AXN[k], fmt(cl.lo)), source: f.name, featureId: f.id, dim: "lin", value: cl.lo, axis: kk, at: [cl.lo, cl.hi], span: [cl.lo, cl.hi], point: mid });
        });
        break;
      }
      case "cylinder":
      case "cone":
      case "tube": {
        if (!(f.mode === "cut" || cutTool)) break;
        const pl = placementOf(f);
        const ax = pl ? axisOf(pl.dir) : null;
        if (!pl || !ax) {
          c.unchecked.push(tr("poloha {0} (šikmá osa nebo odkaz)", f.name));
          break;
        }
        for (const k of [0, 1, 2] as const) if (k !== ax.k) addReq(c, { id: `cylpos:${f.id}:${k}`, kind: "pos", label: tr("poloha {0} – {1} {2}", f.name, AXN[k], fmt(pl.position[k])), source: f.name, featureId: f.id, dim: "lin", value: pl.position[k], axis: k, at: [pl.position[k]], point: pl.position });
        break;
      }
      case "hole": {
        const dir = holeDir(f);
        const refs = f.points?.length ? f.points : null;
        const seeds = refs ? refs.flatMap((p) => (p.kind === "xyz" ? [p.p as Vec3] : [])) : [f.position];
        if (refs && seeds.length < refs.length) c.unchecked.push(tr("poloha {0} (body zadané odkazem na geometrii)", f.name));
        const key = holeSpec(f);
        const g = groups.get(key) ?? { feats: [], centers: [], n: 0, dir, exact: true };
        if (refs && seeds.length < refs.length) g.exact = false;
        g.feats.push(f);
        g.centers.push(...instances(doc, f, seeds.length ? seeds : [f.position]));
        g.n += countOf(doc, f.id) * Math.max(1, refs ? refs.length : 1);
        if (g.dir && dir && Math.abs(dot(g.dir, dir)) < 0.999) g.dir = null;
        groups.set(key, g);
        const ax = dir ? axisOf(dir) : null;
        if (!ax) {
          c.unchecked.push(tr("poloha {0} (šikmá osa díry)", f.name));
          break;
        }
        const ring = circularOf(doc, f, ax.k);
        seeds.forEach((p, si) => {
          for (const k of [0, 1, 2] as const) {
            if (k === ax.k) continue;
            const pcd = ring ? pcdFor(ring, p, k, ax.k) : null;
            const r = (f.kind === "tapped" && f.thread ? (threadByName(f.thread)?.d ?? f.diameter) : f.diameter) / 2;
            const hole = { ka: ax.k, r, lo: bbox ? bbox[0][ax.k] : -Infinity, hi: bbox ? bbox[1][ax.k] : Infinity };
            addReq(c, { id: `holepos:${f.id}:${si}:${k}`, kind: "pos", label: tr("poloha {0} – {1} {2}", f.name, AXN[k], fmt(p[k])), source: f.name, featureId: f.id, dim: "lin", value: p[k], axis: k, at: [p[k]], point: p, hole, ...(pcd ? { pcd } : {}) });
          }
        });
        break;
      }
      case "extrude": {
        const sk = doc.features.find((x): x is Extract<Feature, { type: "sketch" }> => x.type === "sketch" && x.id === f.sketchId);
        if (!sk) break;
        const axes = planeAxes(sk.plane);
        if (!axes) {
          if (f.mode === "cut" || cutTool) c.unchecked.push(tr("poloha {0} (skica v obecné rovině)", f.name));
          break;
        }
        let general = false;
        for (const e of sk.entities) {
          if (e.construction) continue;
          if (e.type === "circle") {
            const p = sketchPt(sk.plane, e.cx, e.cy)!;
            for (const k of axes) if (interior(bbox, k, p[k] - e.r, p[k] + e.r)) addReq(c, { id: `skpos:${f.id}:${e.id}:${k}`, kind: "pos", label: tr("poloha {0} – {1} {2}", `${f.name} Ø${fmt(2 * e.r)}`, AXN[k], fmt(p[k])), source: f.name, featureId: f.id, dim: "lin", value: p[k], axis: k, at: [p[k]], point: p });
          } else if (e.type === "rect" || e.type === "slot") {
            const p = sketchPt(sk.plane, e.cx, e.cy)!;
            const ang = e.type === "slot" ? e.angle : (e as { angle?: number }).angle ?? 0;
            if (Math.abs(((ang % 90) + 90) % 90) > 1e-6) {
              general = true;
              continue;
            }
            const turned = Math.round(ang / 90) % 2 !== 0;
            const w0 = e.type === "rect" ? e.w : e.length + e.width;
            const h0 = e.type === "rect" ? e.h : e.width;
            const half = turned ? [h0 / 2, w0 / 2] : [w0 / 2, h0 / 2];
            axes.forEach((k, j) => {
              const lo = p[k] - half[j];
              const hi = p[k] + half[j];
              if (interior(bbox, k, lo, hi)) addReq(c, { id: `skpos:${f.id}:${e.id}:${k}`, kind: "pos", label: tr("poloha {0} – {1} {2}", f.name, AXN[k], fmt(lo)), source: f.name, featureId: f.id, dim: "lin", value: lo, axis: k, at: [lo, hi, p[k]], span: [lo, hi], point: p });
            });
          } else if (e.type !== "line" && e.type !== "point") general = true;
        }
        if (general && (f.mode === "cut" || cutTool)) c.unchecked.push(tr("poloha obecného obrysu {0} (lomená čára, oblouk, spline)", f.name));
        break;
      }
      default:
        break;
    }
  }
  // díry na téže osové čáře (stejná souřadnice na ose polohy, rovnoběžné osy): kóta s pomocnou čárou na ose kterékoli z nich
  // určuje polohu všech (Chytré kóty kótují řadu děr jednou) – jiný bod se shodnou souřadnicí ne
  const allHoles = [...groups.values()].flatMap((g) => {
    const f = g.feats[0];
    const r = (f.kind === "tapped" && f.thread ? (threadByName(f.thread)?.d ?? f.diameter) : f.diameter) / 2;
    const ax = g.dir ? axisOf(g.dir) : null;
    return ax ? g.centers.map((c) => ({ c, r, ka: ax.k })) : [];
  });
  for (const q of c.reqs) {
    const h = q.hole;
    if (!h || q.axis === undefined || !q.point) continue;
    const peers = allHoles.filter((x) => x.ka === h.ka && eq(x.c[q.axis!], q.point![q.axis!]) && Math.hypot(x.c[0] - q.point![0], x.c[1] - q.point![1], x.c[2] - q.point![2]) > 1e-6).map((x) => ({ c: x.c, r: x.r }));
    if (peers.length) h.peers = peers;
  }
  // díry po skupinách stejné specifikace: velikost s počtem (n×), hloubka; další rozměry díry (zahloubení, vrták závitu) hodnotou
  let gi = 0;
  for (const g of groups.values()) {
    const f = g.feats[0];
    const tapped = f.kind === "tapped" && !!f.thread;
    const t = tapped ? threadByName(f.thread!) : null;
    const value = tapped ? (t?.d ?? parseFloat(f.thread!.replace(/^m/i, ""))) : f.diameter;
    const r = (tapped ? value : f.diameter) / 2;
    const cnt = g.n > 1 ? `${g.n}× ` : "";
    const names = g.feats.map((x) => x.name).join(", ");
    const label = tapped ? `${cnt}${threadLabel(f.thread!)}${f.depth > 0 ? ` hl. ${fmt(f.depth)}` : ""}` : `${cnt}Ø${fmt(f.diameter)}${f.depth > 0 ? ` hl. ${fmt(f.depth)}` : tr(" skrz")}`;
    const dir = g.dir ?? [0, 0, 1];
    const ax = axisOf(dir);
    const entry = ax ? g.feats.map((x) => x.position[ax.k]) : undefined;
    const holes = { centers: g.centers, dir, r, n: g.n, exact: g.exact && !!g.dir, ...(f.depth > 0 ? { depth: f.depth } : {}), ...(entry ? { entry } : {}) };
    addReq(c, { id: `hole:${gi}`, kind: "size", label, source: names, featureId: f.id, dim: tapped ? "thread" : "dia", value, holes, point: g.centers[0] });
    if (f.depth > 0) addReq(c, { id: `holedepth:${gi}`, kind: "size", label: tr("{0} (hloubka díry)", fmt(f.depth)), source: names, featureId: f.id, dim: "lin", value: f.depth, holes, ...(ax ? { axis: ax.k } : {}), point: g.centers[0] });
    // zahloubení, vrták závitu…: dosavadní očekávání hodnotou (bez hlavního průměru a hloubky)
    const more = expectedDims({ ...doc, features: [f] }, null, { aux: { cut: new Set(), skip: new Set(), bodies: [] } }).slice(1).filter((e) => e.label !== tr("{0} (hloubka díry)", fmt(f.depth)));
    more.forEach((e, i) => addReq(c, { id: `holex:${gi}:${i}`, kind: "size", label: e.label, source: names, featureId: f.id, dim: e.kind, value: e.value, byValue: true }));
    gi++;
  }
  return { reqs: c.reqs, aux: aux.bodies, unchecked: c.unchecked };
}

/* ───────────────────────── párování ───────────────────────── */

/** kóta / popis leží na díře skupiny: střed kružnice (nebo značky skupiny) v pohledu, kde je díra kružnicí, nebo šipka na obvodu */
function onHole(x: CircFact, q: DimReq): boolean {
  const h = q.holes!;
  if (Math.abs(dot(x.cam.d, h.dir)) < 0.999) return false;
  const tol = Math.max(0.05, h.r * 0.05);
  return h.centers.some((p) => {
    const c = projQ(x.cam, p);
    if (near2(x.c, c, tol) || !!x.tags?.some((t) => near2(t.c, c, tol))) return true;
    if (!x.tip) return false;
    // odkaz popisu končí na kružnici díry; u závitu (r = jmenovitý průměr / 2) i na kružnici vrtáku (≈ 0,8 r) – „M8 ↧10“ (fáze 2)
    const dist = Math.hypot(x.tip[0] - c[0], x.tip[1] - c[1]);
    return Math.abs(dist - h.r) <= Math.max(tol, 0.5) || (dist >= 0.75 * h.r && dist <= h.r);
  });
}
/** … a má hodnotu skupiny (Ø, závit M, poloměr) */
const hitsHole = (x: CircFact, q: DimReq) => (x.kind === "rad" ? eq(x.value, q.holes!.r) : eq(x.value, q.value) || (q.dim === "thread" && x.kind === "dia" && eq(x.value, q.value))) && onHole(x, q);
/** řádek tabulky děr se středem v bodě `p` (pohled tabulky) */
const inTable = (f: Facts, views: readonly CheckView[], p: Vec3) =>
  f.table.filter((r) => {
    const v = views.find((x) => x.key === r.view);
    return !!v?.cam && near2(r.c, projQ(v.cam, p), 0.05);
  });

function matchReq(q: DimReq, f: Facts, views: readonly CheckView[], baked: boolean, used: Map<number, string[]>): void {
  const tols: string[] = [];
  const take = (i: number, tol: string) => {
    used.set(i, [...(used.get(i) ?? []), q.id]);
    tols.push(tol);
  };
  const done = (st: ReqStatus, why?: string) => {
    q.status = st;
    if (why) q.why = why;
    if (tols.length) q.tols = tols;
  };
  // skupina děr: počet kusů z popisů / kót průměru se středem v díře skupiny („2× Ø8“ = 2 kusy) a z tabulky děr
  if (q.holes && q.kind === "size" && q.dim !== "lin") {
    const h = q.holes;
    let have = 0;
    for (const x of f.circ) {
      if (!hitsHole(x, q)) continue;
      have += x.count;
      take(x.i, x.tol);
    }
    have += new Set(h.centers.flatMap((p) => inTable(f, views, p))).size;
    // žádná kóta / popis na díře skupiny (kóty zapečené v pohledu, díry zadané odkazem, popis mimo kružnici): počet z textů
    // kót „4× Ø10“ hodnotou – i tak se počet kusů hlídá, a výsledek to říká
    let byText = false;
    if (!have) {
      have = f.texts.filter((t) => (t.kind === q.dim || (q.dim === "dia" && t.kind === "thread")) && eq(t.value, q.value)).reduce((s, t) => s + t.count, 0);
      byText = have > 0 && !baked;
    }
    q.have = have;
    if (have >= h.n) return done("ok", byText ? tr("podle textu kóty – poloha popisu neověřena") : undefined);
    return done(have ? "partial" : "missing", have ? tr("na listu {0}× z {1}×", have, h.n) : undefined);
  }
  // hloubka díry: popis té díry s ↧ / hl. a touto hodnotou, nebo kóta podél osy díry od vstupu – ne libovolné číslo
  if (q.holes && q.kind === "size" && q.dim === "lin") {
    const hit = f.circ.find((x) => x.depth.some((d) => eq(d, q.value)) && onHole(x, q));
    if (hit) {
      take(hit.i, hit.tol);
      return done("ok");
    }
    // kóta podél osy díry od vstupu, která leží NA díře (konec v obrysu díry v pohledu) – ne libovolná „10“ jinde na listu
    const h = q.holes;
    const onIt = (x: LinFact) => x.ko !== null && h.centers.some((p) => [x.o1, x.o2].some((o) => Math.abs(o - p[x.ko!]) <= h.r + 0.05));
    const lf = q.axis !== undefined ? f.lin.find((x) => x.k === q.axis && eq(x.value, q.value) && (h.entry ?? []).some((e) => eq(x.c1, e) || eq(x.c2, e)) && onIt(x)) : undefined;
    if (lf) {
      take(lf.i, lf.tol);
      return done("ok");
    }
    if (baked && f.texts.some((t) => t.kind === "lin" && eq(t.value, q.value))) return done("ok");
    return done("missing");
  }
  if (q.kind === "size" && q.span && q.axis !== undefined) {
    // velikost s geometrií: kóta téže osy a délky s koncem na hraně prvku (celkový rozměr: kdekoli na ose)
    const overall = q.source === SRC_OVERALL();
    const lf = f.lin.find((x) => x.k === q.axis && !x.ord && eq(x.value, q.value) && (overall || [x.c1, x.c2].some((v) => eq(v, q.span![0]) || eq(v, q.span![1]))));
    if (lf) {
      take(lf.i, lf.tol);
      return done("ok");
    }
    // rotační díl: celkový rozměr = největší Ø (kóta průměru)
    const dia = overall ? (f.circ.find((x) => x.kind === "dia" && eq(x.value, q.value)) ?? f.lin.find((x) => x.dia && eq(x.value, q.value))) : undefined;
    if (dia) {
      take(dia.i, dia.tol);
      return done("ok");
    }
    // celkový rozměr kreslený mimo poznámky listu (vygenerované kóty celkových rozměrů, souřadnicové kóty) – hodnotou
    if ((baked || overall) && f.texts.some((t) => (t.kind === "lin" || (overall && t.kind === "dia")) && eq(t.value, q.value))) return done("ok");
    return done("missing");
  }
  if (q.kind === "size") {
    // dosavadní očekávání hodnotou (zaoblení, sražení, rozteč, skica, rotační díl…): druh a hodnota kóty
    const same = (k: DimKind) => k === q.dim || (q.dim === "dia" && k === "thread");
    const lf = q.dim === "lin" ? f.lin.find((x) => !x.dia && eq(x.value, q.value)) : q.dim === "dia" ? f.lin.find((x) => x.dia && eq(x.value, q.value)) : undefined;
    const cf = f.circ.find((x) => same(x.kind) && eq(x.value, q.value)) ?? (q.dim === "lin" ? f.circ.find((x) => x.depth.some((d) => eq(d, q.value))) : undefined);
    const hit = lf ?? cf;
    if (hit) {
      take(hit.i, hit.tol);
      return done("ok");
    }
    // dosavadní párování hodnotou (texty kót listu: popisy „⌴ Ø15“, „1×45°“, „M20×1,5“, zapečené kóty)
    if (f.texts.some((t) => same(t.kind) && eq(t.value, q.value))) return done("ok");
    return done("missing");
  }
  // poloha: délková kóta téže osy končící na souřadnici prvku (ne jen jeho vlastní velikost), osa souměrnosti, tabulka děr
  const ats = q.at ?? [];
  const own = q.span;
  const isOwn = (x: LinFact) => !!own && ((eq(x.c1, own[0]) && eq(x.c2, own[1])) || (eq(x.c1, own[1]) && eq(x.c2, own[0])));
  // konec kóty na souřadnici `a`, jehož pomocná čára vede na osu díry (u ostatních prvků každý konec se shodnou souřadnicí)
  const endAt = (x: LinFact, a: number) => (eq(x.c1, a) && onAxis(x, x.o1, q)) || (eq(x.c2, a) && onAxis(x, x.o2, q));
  const lf = f.lin.find((x) => x.k === q.axis && ats.some((a) => endAt(x, a)) && !isOwn(x));
  if (q.datum) {
    // funkční prvek se základnou na téže ose: kóta od základny (i souřadnicová kóta s počátkem v základně)
    const d = q.datum;
    const dl = f.lin.find((x) => x.k === q.axis && ats.some((a) => (eq(x.c1, a) && onAxis(x, x.o1, q) && eq(x.c2, d.c)) || (eq(x.c2, a) && onAxis(x, x.o2, q) && eq(x.c1, d.c))));
    if (dl) {
      take(dl.i, dl.tol);
      return done("ok");
    }
    if (lf) {
      take(lf.i, lf.tol);
      return done("partial", tr("kóta polohy není od základny {0}", d.label));
    }
  }
  if (lf) {
    take(lf.i, lf.tol);
    return done("ok");
  }
  const mid = own ? (own[0] + own[1]) / 2 : ats[0];
  if (f.centers.some((x) => x.k === q.axis && eq(x.c, mid))) return done("ok", tr("osa souměrnosti"));
  const pf = q.pcd ? pcdFact(q, f) : null;
  if (pf) {
    take(pf.i, pf.tol);
    return done("ok", tr("roztečná kružnice Ø{0}", fmt(q.pcd!.d)));
  }
  if (q.point && inTable(f, views, q.point).length) return done("ok", tr("tabulka děr"));
  if (baked) return done("unchecked", tr("kóty zapečené v pohledu – polohu nejde ověřit"));
  return done("missing");
}

/**
 * Pomocná čára kóty (od bodu kóty – souřadnice `o` na druhé ose pohledu `x.ko` – ke kótovací čáře) vede na osu díry
 * požadavku `q`: v pohledu podél osy díry prochází kružnicí / středem (r + 2 mm přesahu osové čáry), v pohledu z boku na čáře osy v rozsahu dílu. Požadavek bez díry → vždy (dosavadní párování
 * souřadnicí). Druhá osa kóty neznámá → ne (slabší tvrzení).
 */
function onAxis(x: LinFact, o: number, q: DimReq): boolean {
  const h = q.hole;
  if (!h) return true;
  if (x.ko === null || !Number.isFinite(o) || !q.point) return false;
  // pomocná čára vede od bodu kóty ke kótovací čáře (je-li poloha čáry známá); jinak jen bod kóty
  const lo = Number.isFinite(x.line) ? Math.min(o, x.line) : o;
  const hi = Number.isFinite(x.line) ? Math.max(o, x.line) : o;
  // pohled z boku: pomocná čára na čáře osy díry v rozsahu dílu
  if (x.ko === h.ka) return hi >= h.lo - 0.5 && lo <= h.hi + 0.5;
  // pohled podél osy: pomocná čára prochází kružnicí / středem díry nebo jiné díry na téže osové čáře (s krátkým přesahem
  // osové čáry, ISO 128: ~2 mm)
  const ko = x.ko;
  return [{ c: q.point, r: h.r }, ...(h.peers ?? [])].some((p) => p.c[ko] >= lo - (p.r + 2) && p.c[ko] <= hi + (p.r + 2));
}

/**
 * Poloha výchozí díry kruhového pole z roztečné kružnice: kóta / popis Ø d v pohledu podél osy pole se středem ve středu
 * pole, a poloha středu pole na téže ose je na listu (osa souměrnosti nebo délková kóta končící na středu) – jinak null.
 */
function pcdFact(q: DimReq, f: Facts): CircFact | null {
  const p = q.pcd!;
  const k = q.axis!;
  const located = f.centers.some((x) => x.k === k && eq(x.c, p.center[k])) || f.lin.some((x) => x.k === k && (eq(x.c1, p.center[k]) || eq(x.c2, p.center[k])));
  if (!located) return null;
  return f.circ.find((x) => x.kind === "dia" && eq(x.value, p.d) && Math.abs(dot(x.cam.d, p.dir)) >= 0.999 && near2(x.c, projQ(x.cam, p.center), 0.05)) ?? null;
}

/* ───────────────────────── tolerance ───────────────────────── */

/** Přesná tolerance: pásmo ≤ 0,05 mm (±0,02; +0,03/0) nebo stupeň IT 7 a jemnější (H7, h6, js5). */
export function tightTolerance(tol: string): boolean {
  const s = tol.replace(/−/g, "-").replace(/,/g, ".").trim();
  if (!s) return false;
  const fit = /(?:^|\s)[A-Za-z]{1,2}(\d{1,2})(?:\/[A-Za-z]{1,2}(\d{1,2}))?(?:\s|$)/.exec(` ${s} `);
  if (fit) return Number(fit[1]) <= 7 || (!!fit[2] && Number(fit[2]) <= 7);
  const pm = /±\s*(\d*\.?\d+)/.exec(s);
  if (pm) return 2 * Number(pm[1]) <= 0.05 + 1e-9;
  const devs = [...s.matchAll(/([+-]?\s*\d*\.?\d+)/g)].map((m) => Number(m[1].replace(/\s/g, "")));
  if (devs.length >= 2) return Math.abs(devs[0] - devs[1]) <= 0.05 + 1e-9;
  return false;
}
const normTol = (s: string) => s.replace(/\s+/g, "").replace(/,/g, ".").replace(/−/g, "-").toLowerCase();

/* ───────────────────────── funkční prvky a základny ───────────────────────── */

/** Základny vyznačené v modelu: písmeno, osa a souřadnice roviny (jen rovinné plochy kolmé na osu souřadnic). */
export function datumsOf(marks: readonly FunctionalMark[] | undefined, rev?: string): { label: string; k: 0 | 1 | 2; c: number }[] {
  return (marks ?? []).flatMap((m) => {
    if (m.kind !== "datum" || m.geom?.t !== "plane" || markStale(m, rev)) return [];
    const ax = axisOf(m.geom.n);
    return ax ? [{ label: m.label ?? "?", k: ax.k, c: m.geom.c[ax.k] }] : [];
  });
}

/** označená plocha (ne prvek historie) ze starší revize modelu – snímek geometrie pro nynější model neplatí */
const markStale = (m: FunctionalMark, rev: string | undefined): boolean => !m.feature && !!m.face && !!m.rev && !!rev && m.rev !== rev;
const staleMarkText = (what: string, m: FunctionalMark, rev: string): string =>
  tr("{0}: plocha F{1} označena na modelu {2}, model je teď {3} – označte ji znovu ({4})", what, (m.face?.index ?? 0) + 1, m.rev ?? "?", rev, m.kind === "datum" ? tr("základna {0} F{1}", m.label ?? "?", (m.face?.index ?? 0) + 1) : tr("funkční F{0}", (m.face?.index ?? 0) + 1) + (m.tol ? ` ${m.tol}` : ""));

/** Funkční prvky do požadavků: prvek historie (díra, kapsa…) → jeho položky; rovinná plocha → poloha; válcová plocha → díra / Ø. */
function applyMarks(doc: CadDoc, reqs: DimReq[], unchecked: string[]): { n: number; stale: number } {
  const marks = (doc.functional ?? []).filter((m) => m.kind === "functional");
  const rev = doc.functional?.some((m) => m.rev) ? modelRev(doc) : undefined;
  const datums = datumsOf(doc.functional, rev);
  let stale = 0;
  for (const m of doc.functional ?? [])
    if (m.kind === "datum" && markStale(m, rev)) {
      unchecked.push(staleMarkText(tr("základna {0}", m.label ?? "?"), m, rev!));
      stale++;
    }
  let n = 0;
  for (const m of marks) {
    const label = markLabel(doc, m);
    // plocha označená na jiné revizi modelu: snímek geometrie neplatí – nekontrolovat podle něj (nezkontrolováno, označit znovu)
    if (markStale(m, rev)) {
      unchecked.push(staleMarkText(tr("funkční {0}", label), m, rev!));
      stale++;
      continue;
    }
    let fid = m.feature;
    if (!fid && m.geom?.t === "cyl") {
      // válcová plocha = díra / odebraný válec se stejnou osou a poloměrem
      const g = m.geom;
      const hit = reqs.find((q) => q.holes && Math.abs(q.holes.r - g.r) < 0.01 && Math.abs(Math.abs(dot(q.holes.dir, unit(g.axis))) - 1) < 1e-3 && q.holes.centers.some((p) => Math.hypot(...(cross(unit(g.axis), [p[0] - g.c[0], p[1] - g.c[1], p[2] - g.c[2]]) as [number, number, number])) < 0.05));
      fid = hit?.featureId;
      if (!fid) {
        const q: DimReq = { id: `mark:${m.id}`, kind: "size", label: tr("Ø{0} ({1})", fmt(2 * g.r), label), source: label, dim: "dia", value: 2 * g.r, byValue: true, functional: true, ...(m.tol ? { tol: m.tol } : {}), status: "missing" };
        reqs.push(q);
        n++;
        continue;
      }
    }
    if (fid) {
      const own = reqs.filter((q) => q.featureId === fid || (q.holes && q.source.split(", ").includes(doc.features.find((f) => f.id === fid)?.name ?? "\u0000")));
      if (!own.length) {
        unchecked.push(tr("funkční {0}: prvek nemá rozměry, které kontrola zná", label));
        continue;
      }
      for (const q of own) {
        q.functional = true;
        if (m.tol && q.kind === "size") q.tol = m.tol;
        const d = q.kind === "pos" ? datums.find((x) => x.k === q.axis) : undefined;
        if (d && !(q.at ?? []).some((a) => eq(a, d.c))) q.datum = { label: d.label, c: d.c };
      }
      n++;
      continue;
    }
    if (m.geom?.t === "plane") {
      const ax = axisOf(m.geom.n);
      if (!ax) {
        unchecked.push(tr("funkční {0}: šikmá plocha", label));
        continue;
      }
      const cc = m.geom.c[ax.k];
      const d = datums.find((x) => x.k === ax.k && !eq(x.c, cc));
      reqs.push({ id: `mark:${m.id}`, kind: "pos", label: tr("poloha {0} – {1} {2}", label, AXN[ax.k], fmt(cc)), source: label, dim: "lin", value: cc, axis: ax.k, at: [cc], point: m.geom.c, functional: true, ...(m.tol ? { tol: m.tol } : {}), ...(d ? { datum: { label: d.label, c: d.c } } : {}), status: "missing" });
      n++;
      continue;
    }
    unchecked.push(tr("funkční {0}: plochu nejde zkontrolovat (tvar)", label));
  }
  return { n, stale };
}

/** popisek značky: „F7“, „Díra 1“, „základna A (F3)“ */
export function markLabel(doc: Pick<CadDoc, "features">, m: FunctionalMark): string {
  const what = m.feature ? (doc.features.find((f) => f.id === m.feature)?.name ?? m.feature) : m.face ? `F${m.face.index + 1}` : "?";
  return m.kind === "datum" ? tr("základna {0} ({1})", m.label ?? "?", what) : what;
}

/* ───────────────────────── kontrola listu ───────────────────────── */

export type SheetInput = {
  doc: CadDoc;
  views: readonly CheckView[];
  annotations: readonly DrawingAnnotation[];
  /** volba kót listu – Auto / jen celkové = zapečené v pohledu */
  dimensions?: string;
  /** texty listu (zapečené kóty) */
  texts?: readonly { s: string; layer?: string }[];
  holeRows?: readonly CheckHoleRow[];
  /** funkční rozměry listu (`kótovat … funkční 26,5`) */
  dimFunctional?: readonly number[];
  /** obálka (jinak z pohledů) */
  bbox?: [Vec3, Vec3] | null;
};

/** Kontrola kót listu – co je na listu, co chybí, co se nekontroluje. */
export function checkSheet(inp: SheetInput): DimCompleteResult {
  const { doc } = inp;
  const bbox = inp.bbox ?? viewsBbox(inp.views);
  const baked = inp.dimensions === "auto" || inp.dimensions === "overall";
  const { reqs, aux, unchecked } = requirements(doc, bbox);
  const am = applyMarks(doc, reqs, unchecked);
  const marked = am.n + (inp.dimFunctional?.length ?? 0);
  // texty kót listu (i vygenerované kóty mimo poznámky listu – celkové rozměry, popisy) pro položky párované hodnotou
  const facts = sheetFacts(inp.views, inp.annotations, inp.holeRows ?? [], inp.texts ?? []);
  const used = new Map<number, string[]>();
  for (const q of reqs) matchReq(q, facts, inp.views, baked, used);
  // tolerance funkčních položek
  const tolMissing: DimReq[] = [];
  let tolOk = 0;
  for (const q of reqs) {
    if (!q.functional || q.status === "unchecked") continue;
    const have = (q.tols ?? []).filter((t) => t.trim());
    if (q.status === "missing") {
      q.tolState = "missing";
      tolMissing.push(q);
      continue;
    }
    if (!have.length) q.tolState = "missing";
    else if (q.tol && !have.some((t) => normTol(t).includes(normTol(q.tol!)))) q.tolState = "differs";
    else q.tolState = "ok";
    if (q.tolState === "ok") tolOk++;
    else tolMissing.push(q);
  }
  // přetolerování: přesná tolerance na kótě, která nesplňuje žádnou funkční položku ani funkční rozměr listu
  const over: DimCompleteResult["tol"]["over"] = [];
  if (marked > 0) {
    const fun = new Set(reqs.filter((q) => q.functional).map((q) => q.id));
    inp.annotations.forEach((a, i) => {
      const t = annTolerance(a);
      if (!t || !tightTolerance(t)) return;
      if ((used.get(i) ?? []).some((id) => fun.has(id))) return;
      const lf = facts.lin.find((x) => x.i === i);
      const cf = facts.circ.find((x) => x.i === i);
      const value = lf?.value ?? cf?.value;
      if (value !== undefined && (inp.dimFunctional ?? []).some((v) => eq(v, value))) return;
      over.push({ ann: a.id, label: lf?.label ?? cf?.label ?? "?", tol: t });
    });
  }
  const sz = reqs.filter((q) => q.kind === "size" && q.status !== "unchecked");
  const ps = reqs.filter((q) => q.kind === "pos" && q.status !== "unchecked");
  if (baked && reqs.some((q) => q.kind === "pos")) unchecked.push(tr("polohy prvků (kóty zapečené v pohledu – přepněte na Chytré kóty nebo vlastní kóty)"));
  return {
    items: reqs,
    size: { ok: sz.filter((q) => q.status === "ok").length, total: sz.length },
    pos: { ok: ps.filter((q) => q.status === "ok").length, total: ps.length },
    aux,
    unchecked: [...new Set(unchecked)],
    baked,
    tol: { marked, ok: tolOk, missing: tolMissing, over, ...(am.stale ? { stale: am.stale } : {}) },
  };
}

/** položky, které na listu chybí (nebo jsou jen zčásti) */
export const missingItems = (r: DimCompleteResult) => {
  const m = r.items.filter((q) => q.status === "missing" || q.status === "partial");
  return [...m.filter((q) => q.kind === "size"), ...m.filter((q) => q.kind === "pos")];
};
/** list není okótovaný ani podle toho, co kontrola zná (⚠ drawing.dims-incomplete) */
export const dimsIncomplete = (r: DimCompleteResult) => missingItems(r).length > 0;

const itemText = (q: DimReq) => `${q.kind === "size" ? `${q.label} (${q.source})` : q.label}${q.why ? ` – ${q.why}` : ""}`;
const listText = (xs: string[], max = 8) => (xs.length > max ? `${xs.slice(0, max).join("; ")}; ${tr("a dalších {0}", xs.length - max)}` : xs.join("; "));

/**
 * Řádek „Kontrola kót“ pro `výkres stav`: co se zkontrolovalo a co chybí – nikdy „kompletní“ ani „všech N“.
 * „Kontrola kót: velikosti 6/6 · polohy 0/3 – chybí: poloha Díra 1 – X 15; … · pomocná tělesa (nekótují se): Nástroj · tolerance neověřeny (funkční prvky nevyznačeny)“
 */
export function dimCheckLine(r: DimCompleteResult): string {
  const miss = missingItems(r);
  const parts: string[] = [tr("velikosti {0}/{1}", r.size.ok, r.size.total), r.baked && !r.pos.total ? tr("polohy nezkontrolovány") : tr("polohy {0}/{1}", r.pos.ok, r.pos.total)];
  let s = tr("Kontrola kót: {0}", parts.join(" · "));
  if (miss.length) s += tr(" – chybí: {0}", listText(miss.map(itemText)));
  if (r.aux.length) s += tr(" · pomocná tělesa (nekótují se): {0}", r.aux.map((a) => `${a.name} (${a.op === "cut" ? tr("odebráno") : tr("průnik")})`).join(", "));
  if (r.tol.marked) {
    s += tr(" · funkční prvky: tolerance {0}/{1}", r.tol.ok, r.tol.ok + r.tol.missing.length);
    if (r.tol.over.length) s += tr(" · přesná tolerance na nefunkčním rozměru: {0}", r.tol.over.map((o) => `${o.label} ${o.tol}`).join(", "));
  } else if (r.tol.stale) s += tr(" · tolerance neověřeny (funkční prvky označené na starší revizi modelu – označte je znovu)");
  else s += tr(" · tolerance neověřeny (funkční prvky nevyznačeny)");
  if (r.unchecked.length) s += tr(" · nezkontrolováno: {0}", listText(r.unchecked, 4));
  return s;
}

/** Podrobný výpis (`výkres kontrola kót`): položky po řádcích se stavem. */
export function dimCheckDetail(r: DimCompleteResult): string[] {
  const mark = (q: DimReq) => (q.status === "ok" ? "✓" : q.status === "partial" ? "◐" : q.status === "unchecked" ? "–" : "✗");
  const tolNote = (q: DimReq) => (!q.functional ? "" : q.tolState === "ok" ? tr(" · funkční, tolerance {0}", (q.tols ?? []).find((t) => t.trim()) ?? "") : q.tolState === "differs" ? tr(" · funkční, tolerance {0} ≠ předepsaná {1}", (q.tols ?? []).find((t) => t.trim()) ?? "", q.tol ?? "") : tr(" · funkční, bez tolerance"));
  const L = [dimCheckLine(r)];
  const sec = (title: string, xs: DimReq[]) => {
    if (!xs.length) return;
    L.push(title);
    for (const q of xs) L.push(`  ${mark(q)} ${r.items.indexOf(q) + 1}. ${itemText(q)}${tolNote(q)}`);
  };
  sec(tr("Velikosti:"), r.items.filter((q) => q.kind === "size"));
  sec(tr("Polohy:"), r.items.filter((q) => q.kind === "pos"));
  for (const o of r.tol.over) L.push(tr("  ℹ přesná tolerance {0} u kóty {1}, která není funkční – je opravdu potřeba?", o.tol, o.label));
  L.push(tr("Kontrola zná jen rozměry odvozené z historie modelu a vyznačené funkční prvky – úplnost výrobního výkresu potvrzuje konstruktér."));
  return L;
}

/* ───────────────────────── návrh chybějící kóty („Přidat kótu“) ───────────────────────── */

/** Kóta v souřadnicích agenta (pohled, y nahoru) jako `výkres kóta …` – drawing-marks `makeManualDim` z ní udělá poznámku listu. */
export type DimSuggestion = { kind: "horizontal" | "vertical"; view: string; p1: Vec2; p2: Vec2 } | { kind: "diameter"; view: string; c: Vec2; r: number };

/** Návrh kóty pro chybějící položku: poloha od hrany dílu / základny, velikost mezi hranami prvku, průměr díry. null = nejde. */
export function suggestDim(q: DimReq, views: readonly CheckView[], bbox: [Vec3, Vec3] | null, doc?: Pick<CadDoc, "functional">): DimSuggestion | null {
  const agent = (cam: { d: Vec3; x: Vec3 }, p: Vec3): Vec2 => {
    const v = projQ(cam, p);
    return [v[0], -v[1]];
  };
  // pohled, kde je osa k vodorovně / svisle; přednost má pohled, kde je díra / prvek vidět shora (osa díry k pozorovateli)
  const pick = (k: number, prefer?: Vec3) => {
    const cands = views.filter((v) => v.cam && !v.brk).map((v) => ({ v, h: axisOf(v.cam!.x)?.k === k, vt: axisOf(upOf(v.cam!))?.k === k })).filter((x) => x.h || x.vt);
    const pref = prefer ? cands.find((x) => Math.abs(dot(x.v.cam!.d, prefer)) > 0.999) : undefined;
    return pref ?? cands.find((x) => x.v.key === "top") ?? cands.find((x) => x.v.key === "front") ?? cands[0];
  };
  if (q.holes && q.kind === "size" && q.dim !== "lin") {
    const v = views.find((x) => x.cam && !x.brk && Math.abs(dot(x.cam.d, q.holes!.dir)) > 0.999);
    if (!v?.cam) return null;
    return { kind: "diameter", view: v.key, c: agent(v.cam, q.holes.centers[0]), r: q.holes.r };
  }
  if (q.axis === undefined || !q.point) return null;
  const k = q.axis;
  const c = pick(k, q.holes?.dir ?? (q.featureId ? undefined : undefined));
  if (!c) return null;
  const cam = c.v.cam!;
  const kind = c.h ? "horizontal" : "vertical";
  let a: number;
  let b: number;
  if (q.kind === "size" && q.span) [a, b] = q.span;
  else if (q.kind === "size" && q.holes && q.holes.entry) {
    a = q.holes.entry[0];
    b = a - q.value * (q.holes.dir[k] >= 0 ? 1 : -1);
  } else {
    const d = datumsOf(doc?.functional).find((x) => x.k === k);
    a = q.datum?.c ?? d?.c ?? (bbox ? bbox[0][k] : 0);
    b = q.at?.[0] ?? q.value;
  }
  if (Math.abs(a - b) < 1e-6) return null;
  const P1 = [...q.point] as Vec3;
  const P2 = [...q.point] as Vec3;
  P1[k] = a;
  P2[k] = b;
  return { kind, view: c.v.key, p1: agent(cam, P1), p2: agent(cam, P2) };
}

/** jméno osy pro texty (X / Y / Z) */
export const axisName = (k: number) => AXN[k] ?? "?";
/** pomůcka pro GUI: položka chybí nebo je jen zčásti */
export const isMissing = (q: DimReq) => q.status === "missing" || q.status === "partial";
export type { DimKind };
export { AXN };
