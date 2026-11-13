/**
 * Skica zadaná z klávesnice – čistá logika (bez DOM a Reactu, testováno ve sketch-kbd.test.ts):
 *  – seznam souřadnic ze schránky (Ctrl+V) → body,
 *  – ukotvení bodů zadaných souřadnicemi vazbou „Pevně“ (bez nadbytečných vazeb a kót),
 *  – entity z řady bodů (lomená čára, spline, řetěz úseček),
 *  – pohled „zobrazit vše“, když zadaný bod leží mimo plátno.
 */
import { analyzeSketch, paramsOf, refPoint } from "./sketch-solver";
import type { CoordInput } from "./sketch-tools";
import type { CanvasSize, SketchView } from "./sketch-touch";
import { clampScale, mmToCanvas } from "./sketch-touch";
import { uid, type SketchConstraint, type SketchDim, type SketchEntity, type SketchRef, type Vec2 } from "./types";

// ======================= seznam souřadnic ze schránky =======================

/** nejvíc bodů z jednoho vložení (delší seznam se odmítne – skicář by s ním byl nepoužitelně pomalý) */
export const PASTE_MAX_POINTS = 5000;
/**
 * Ukotvení bodů křivky (lomená čára / spline). Řešič vazeb počítá Jakobián numericky a určenost roste s třetí
 * mocninou počtu vázaných parametrů (změřeno: spline o 200 bodech s vazbou „Pevně“ na každém bodě = 2,8 s na jedno
 * řešení, s jednou vazbou na celou entitu 65 ms), proto:
 *  – do POINT_FIX_MAX bodů dostane každý bod vlastní vazbu „Pevně“ (jednotlivé body lze později uvolnit),
 *  – do PASTE_FIX_LIMIT bodů se křivka ukotví jednou vazbou „Pevně“ na celou entitu,
 *  – delší křivka se vloží bez ukotvení (uživatel dostane hlášení).
 */
export const POINT_FIX_MAX = 40;
export const PASTE_FIX_LIMIT = 250;
/** nejvíc bodů řetězu úseček z jednoho vložení (každá úsečka je samostatná entita s vazbami) – delší seznam se vloží jako lomená čára */
export const LINE_CHAIN_MAX = 100;

export type CoordList =
  | { ok: true; points: Vec2[]; /** počet přečtených čísel */ numbers: number; /** vypuštěné body shodné s předchozím */ merged: number }
  | { ok: false; reason: "empty" | "text" | "odd" | "many"; /** počet čísel přečtených do chyby */ numbers: number; /** údaj, který není číslo */ token?: string };

const NUM = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/;
const NUM_DOT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Přečte seznam souřadnic: čísla po dvojicích X Y, desetinná čárka i tečka, oddělovače mezera, tabulátor, středník
 * a nový řádek – např. `0 0\n10 5\n20;0\n30,5 8` nebo jedním řádkem `0 0 10 5 20 0`.
 *
 * Čárka je desetinná (`30,5` = 30,5). Jako oddělovač dvou čísel se bere jen tam, kde desetinná být nemůže:
 * za číslem s tečkou nebo mezi více čísly (`10.5,20.3`, `1,2,3,4`), na konci údaje (`10, 5`) a v tabulce CSV, kde
 * každý řádek tvoří jediný údaj `x,y` (aspoň dva řádky). Závorky a popisky os (`X10 Y5`, `x=10; y=5`) se ignorují.
 * Po sobě jdoucí shodné body se sloučí; hodnoty se zaokrouhlí na 0,0001 mm jako při kreslení.
 */
export function parseCoordList(text: string): CoordList {
  const clean = text
    .replace(/[−–]/g, "-")
    // oddělovač tisíců z Excelu / českého formátu („1 234,5“ s pevnou mezerou) – mezera mezi číslicí a trojicí číslic
    // se vypustí; obyčejná mezera a tabulátor dál oddělují čísla
    .replace(/(\d)[\u00a0\u2007\u202f](?=\d{3}(?!\d))/g, "$1")
    .replace(/[   ]/g, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/(^|[\s;,])[xy]\s*[=:]?\s*(?=[+-]?[\d.,])/gim, "$1");
  if (!clean.trim()) return { ok: false, reason: "empty", numbers: 0 };
  const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // tabulka CSV: každý řádek je jediný údaj „x,y“ → čárka odděluje (jinak je desetinná)
  const csv = lines.length >= 2 && lines.every((l) => /^[+-]?\d+(?:\.\d+)?,[+-]?\d+(?:\.\d+)?$/.test(l));
  const nums: number[] = [];
  for (const raw of clean.split(/[\s;]+/)) {
    const tok = raw.replace(/^,+|,+$/g, "");
    if (!tok) continue;
    if (!csv && NUM.test(tok)) {
      nums.push(Number(tok.replace(",", ".")));
      continue;
    }
    const parts = tok.split(",");
    if (parts.length > 1 && parts.every((s) => NUM_DOT.test(s))) {
      for (const s of parts) nums.push(Number(s));
      continue;
    }
    return { ok: false, reason: "text", numbers: nums.length, token: raw.slice(0, 24) };
  }
  if (!nums.length) return { ok: false, reason: "empty", numbers: 0 };
  if (nums.some((n) => !Number.isFinite(n))) return { ok: false, reason: "text", numbers: nums.length };
  if (nums.length % 2) return { ok: false, reason: "odd", numbers: nums.length };
  const points: Vec2[] = [];
  let merged = 0;
  for (let i = 0; i < nums.length; i += 2) {
    const p: Vec2 = [r4(nums[i]), r4(nums[i + 1])];
    const q = points[points.length - 1];
    if (q && q[0] === p[0] && q[1] === p[1]) merged++;
    else points.push(p);
  }
  if (points.length > PASTE_MAX_POINTS) return { ok: false, reason: "many", numbers: nums.length };
  return { ok: true, points, numbers: nums.length, merged };
}

// ======================= ukotvení zadaných bodů =======================

/** Vazba „Pevně“ pro bod entity (klíč `a`, `b`, `p3`, `center`…) v místě `p`. */
export const fixedPoint = (entityId: string, key: string, p: Vec2): SketchConstraint => ({ id: uid(), type: "fixed", refs: [{ e: entityId, k: key }], value: [p[0], p[1]] });

/** Směrové vazby – při ukotvení obou konců jsou nadbytečné, proto se řadí za ukotvení a vypouštějí první. */
const DIRECTIONAL = new Set<SketchConstraint["type"]>(["horizontal", "vertical", "parallel", "perpendicular", "tangent"]);

/**
 * Z nově přidávaných vazeb a řídicích kót vypustí ty, které by skicu přeurčily (jsou závislé na ostatních): bod
 * ukotvený přes totožnost s už pevným bodem druhé ukotvení nedostane, úsečka s oběma pevnými konci nedostane
 * „vodorovně“ ani kótu délky. Pořadí: napojení (totožnost, bod na křivce…) → ukotvení → směrové vazby → kóty;
 * vypouští se vždy po jedné (vypuštění jedné může jinou udělat znovu potřebnou). Dosavadní vazby a kóty skici se
 * nemění.
 */
export function pruneRedundant(entities: SketchEntity[], base: SketchConstraint[], dims: SketchDim[], added: SketchConstraint[], addedDims: SketchDim[] = []): { constraints: SketchConstraint[]; dims: SketchDim[] } {
  const rank = (c: SketchConstraint) => (DIRECTIONAL.has(c.type) ? 2 : c.type === "fixed" ? 1 : 0);
  let keep = added.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c);
  let keepDims = addedDims;
  for (let guard = 0; guard <= added.length + addedDims.length; guard++) {
    const red = new Set(analyzeSketch(entities, [...base, ...keep], [...dims, ...keepDims]).redundant);
    const bad = keep.find((c) => red.has(c.id));
    if (bad) {
      keep = keep.filter((c) => c !== bad);
      continue;
    }
    const badDim = keepDims.find((d) => red.has(d.id));
    if (!badDim) break;
    keepDims = keepDims.filter((d) => d !== badDim);
  }
  return { constraints: keep, dims: keepDims };
}

/**
 * Je bod úplně určen zadanými souřadnicemi (a má se tedy ukotvit vazbou „Pevně“)?
 *  – `x;y` v prvním poli, nebo vyplněná obě pole X a Y → ano,
 *  – `@dx;dy` / `délka<úhel` (relativně k předchozímu bodu) → jen když je ukotvený i předchozí bod (`prevFixed`),
 *    jinak je známý jen posun, ne poloha,
 *  – délka a úhel v samostatných polích, jediné z polí X / Y nebo bod z myši → ne (rozměr hlídá kóta, ne poloha).
 */
export function typedAnchor(o: { input: CoordInput | null; xTyped?: boolean; yTyped?: boolean; prevFixed?: boolean }): boolean {
  const i = o.input;
  if (i && i.kind === "abs") return true;
  if (i && (i.kind === "rel" || i.kind === "polar")) return !!o.prevFixed;
  return !!o.xTyped && !!o.yTyped;
}

/** Způsob ukotvení křivky: každý bod zvlášť / celá entita jednou vazbou / bez ukotvení. */
export type AnchorMode = "points" | "entity" | "none";

/**
 * Vazby „Pevně“ pro lomenou čáru / spline: `flags[i]` = bod i byl zadán souřadnicemi. Jsou-li ukotvené všechny
 * body a je jich víc než POINT_FIX_MAX, použije se jedna vazba na celou entitu (viz POINT_FIX_MAX), nad
 * PASTE_FIX_LIMIT žádná.
 */
export function anchorPoints(e: Extract<SketchEntity, { type: "polyline" | "spline" }>, flags: boolean | boolean[]): { constraints: SketchConstraint[]; mode: AnchorMode } {
  const n = e.points.length;
  const on = (i: number) => (Array.isArray(flags) ? !!flags[i] : !!flags);
  const count = e.points.reduce((s, _, i) => s + (on(i) ? 1 : 0), 0);
  if (!count) return { constraints: [], mode: "none" };
  if (count <= POINT_FIX_MAX) return { constraints: e.points.flatMap((p, i) => (on(i) ? [fixedPoint(e.id, `p${i}`, p)] : [])), mode: "points" };
  if (count === n && n <= PASTE_FIX_LIMIT) return { constraints: [{ id: uid(), type: "fixed", refs: [{ e: e.id, k: "self" }], value: paramsOf(e) }], mode: "entity" };
  return { constraints: [], mode: "none" };
}

// ======================= entity z řady bodů =======================

export type ChainKind = "polyline" | "spline" | "line";

/**
 * Entity z řady bodů: lomená čára / spline (jedna entita; první bod zopakovaný na konci = uzavřená křivka), nebo
 * řetěz úseček spojených totožností. `fixed` = které body ukotvit vazbou „Pevně“ (true = všechny; u křivek viz
 * `anchorPoints`). `coincident: false` = úsečky bez totožností (vypnuté automatické vazby) – ukotví se pak oba
 * konce každé úsečky. `startRef` = bod existující entity, na který řetěz úseček navazuje (totožnost s jeho
 * začátkem). Vrací i způsob ukotvení (`anchor`) pro hlášení uživateli.
 */
export function entitiesFromPoints(kind: ChainKind, pts: Vec2[], o: { fixed?: boolean | boolean[]; coincident?: boolean; startRef?: SketchRef } = {}): { entities: SketchEntity[]; constraints: SketchConstraint[]; anchor: AnchorMode } {
  const isFixed = (i: number) => (Array.isArray(o.fixed) ? !!o.fixed[i] : !!o.fixed);
  const same = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  const n = pts.length;
  if (n < 2) return { entities: [], constraints: [], anchor: "none" };
  const closed = n >= 4 && same(pts[0], pts[n - 1]);
  if (kind !== "line") {
    const points = closed ? pts.slice(0, -1) : pts;
    const e: Extract<SketchEntity, { type: "polyline" | "spline" }> = { id: uid(), type: kind, points, closed };
    const a = anchorPoints(e, Array.isArray(o.fixed) ? o.fixed.slice(0, points.length) : !!o.fixed);
    return { entities: [e], constraints: a.constraints, anchor: a.mode };
  }
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  const link = o.coincident !== false;
  const ids: string[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const id = uid();
    ids.push(id);
    entities.push({ id, type: "line", a: pts[i], b: pts[i + 1] });
    if (i === 0) {
      if (link && o.startRef) constraints.push({ id: uid(), type: "coincident", refs: [o.startRef, { e: id, k: "a" }] });
      if (isFixed(0)) constraints.push(fixedPoint(id, "a", pts[0]));
    } else if (link) constraints.push({ id: uid(), type: "coincident", refs: [{ e: ids[i - 1], k: "b" }, { e: id, k: "a" }] });
    else if (isFixed(i)) constraints.push(fixedPoint(id, "a", pts[i]));
    const last = i + 2 === n;
    if (last && closed && link) constraints.push({ id: uid(), type: "coincident", refs: [{ e: id, k: "b" }, { e: ids[0], k: "a" }] });
    else if (isFixed(i + 1)) constraints.push(fixedPoint(id, "b", pts[i + 1]));
  }
  return { entities, constraints, anchor: constraints.some((c) => c.type === "fixed") ? "points" : "none" };
}

// ======================= číselné zadání u kurzoru =======================

/** Znaky číselného zadání u kurzoru: číslice, desetinná čárka / tečka, oddělovač `;`, relativně `@`, polárně `<`, výrazy. */
export const DYN_CHAR = /^[0-9.,;@<+*/()\-]$/;

/**
 * Patří stisk klávesy do číselného zadání u kurzoru? Bez modifikátorů ano. Znaky psané přes AltGr (Windows hlásí
 * Ctrl+Alt, např. `@` a `<` na české a německé klávesnici) nebo Option na Macu také – jinak by se `@10;5` tiše
 * změnilo na absolutní `10;5`. Číslice s Alt / Ctrl+Alt bez AltGr a cokoli s Cmd zůstávají zkratkami.
 */
export function isDynKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; getModifierState?: (k: string) => boolean }): boolean {
  if (!DYN_CHAR.test(e.key)) return false;
  if (!e.ctrlKey && !e.metaKey && !e.altKey) return true;
  if (e.getModifierState?.("AltGraph")) return true;
  if (e.metaKey || /^[0-9]$/.test(e.key)) return false;
  return e.altKey;
}

// ======================= přesun, otočení a změna měřítka ukotvených entit =======================

/**
 * Vazby „Pevně“ vybraných entit po přesunu / otočení / změně měřítka: pevná poloha jde s entitou (`moved` = entity
 * po transformaci, `ids` = vybrané entity). Bez toho by řešič vrátil entity zadané souřadnicemi zpět na místo a příkaz
 * by tiše nic neudělal. Vazby ostatních entit se nemění.
 */
export function moveAnchors(constraints: SketchConstraint[], moved: SketchEntity[], ids: ReadonlySet<string>): SketchConstraint[] {
  const m = new Map(moved.map((e) => [e.id, e]));
  return constraints.map((c) => {
    const r = c.refs[0];
    if (c.type !== "fixed" || !r || !ids.has(r.e)) return c;
    const e = m.get(r.e);
    if (!e) return c;
    if (r.k === "self") return { ...c, value: paramsOf(e) };
    const p = refPoint(m, r);
    return p ? { ...c, value: [p[0], p[1]] } : c;
  });
}

/** Největší odchylka parametrů entit `ids` mezi dvěma stavy skici (mm) – zda řešič entity po přesunu vrátil. */
export function maxShift(a: SketchEntity[], b: SketchEntity[], ids: ReadonlySet<string>): number {
  const mb = new Map(b.map((e) => [e.id, e]));
  let worst = 0;
  for (const e of a) {
    if (!ids.has(e.id)) continue;
    const f = mb.get(e.id);
    if (!f) continue;
    const pa = paramsOf(e);
    const pb = paramsOf(f);
    for (let i = 0; i < pa.length; i++) worst = Math.max(worst, Math.abs(pa[i] - (pb[i] ?? pa[i])));
  }
  return worst;
}

// ======================= pohled =======================

/** Je bod vidět na plátně (aspoň `margin` px od okraje)? */
export function pointVisible(view: SketchView, size: CanvasSize, p: Vec2, margin = 24): boolean {
  const [x, y] = mmToCanvas(view, size, p);
  return x >= margin && y >= margin && x <= size.w - margin && y <= size.h - margin;
}

/** Pohled, ve kterém jsou vidět všechny body (s okrajem; stejné měřítko jako „Zobrazit vše“ skicáře). Bez bodů null. */
export function fitView(points: Vec2[], size: CanvasSize, pad = 1.5): SketchView | null {
  if (!points.length) return null;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  const w = x1 - x0 || 50;
  const h = y1 - y0 || 50;
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale: clampScale(Math.min(size.w / (w * pad), size.h / (h * pad))) };
}
