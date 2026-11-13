/**
 * Rozdělení velké STEP sestavy na samostatné díly.
 *
 * OpenCascade (occt-import-js) čte celý soubor najednou: u sestav o desítkách MB to trvá
 * desítky minut (hledání barev a názvů ploch roste s kvadrátem velikosti) a paměť WebAssembly
 * přeroste 2 GB → prohlížeč „čte geometrii" donekonečna. Tady sestavu rozebereme sami:
 * strom produktů (PRODUCT_DEFINITION → NEXT_ASSEMBLY_USAGE_OCCURRENCE s transformacemi,
 * MAPPED_ITEM), z každé reprezentace s tělesy vyrobíme malý samostatný STEP (jen entity, na
 * které odkazuje, + barvy) a ten pošleme do OpenCascade. Díl použitý vícekrát se čte jednou.
 */
import {
  argNum, argRef, argRefs, argStr, idxOf, parseEntity, readPoint, refsOf, typeCode, typeName,
  type StepArg, type StepIndex, type StepRecord,
} from "./step-index";

/** Matice 3 × 4 po řádcích: [r00 r01 r02 tx  r10 r11 r12 ty  r20 r21 r22 tz]. */
export type Mat = Float64Array;

export const IDENTITY: Mat = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);

export function mul(a: Mat, b: Mat): Mat {
  const o = new Float64Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let v = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
      if (c === 3) v += a[r * 4 + 3];
      o[r * 4 + c] = v;
    }
  }
  return o;
}

/** Inverze afinní matice (obecná 3 × 3 část). */
export function invert(m: Mat): Mat {
  const [a, b, c, , d, e, f, , g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det) return IDENTITY;
  const r = new Float64Array(12);
  r[0] = A / det;
  r[1] = -(b * i - c * h) / det;
  r[2] = (b * f - c * e) / det;
  r[4] = B / det;
  r[5] = (a * i - c * g) / det;
  r[6] = -(a * f - c * d) / det;
  r[8] = C / det;
  r[9] = -(a * h - b * g) / det;
  r[10] = (a * e - b * d) / det;
  const tx = m[3], ty = m[7], tz = m[11];
  r[3] = -(r[0] * tx + r[1] * ty + r[2] * tz);
  r[7] = -(r[4] * tx + r[5] * ty + r[6] * tz);
  r[11] = -(r[8] * tx + r[9] * ty + r[10] * tz);
  return r;
}

export const isIdentity = (m: Mat) => m.every((v, k) => Math.abs(v - IDENTITY[k]) < 1e-12);

/** Matice je otočení + posun (bez měřítka / zrcadlení) → topologie se dá jen přepočítat. */
export function isRigid(m: Mat): boolean {
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
  if (Math.abs(det - 1) > 1e-6) return false;
  for (let r = 0; r < 3; r++) {
    const l = Math.hypot(m[r * 4], m[r * 4 + 1], m[r * 4 + 2]);
    if (Math.abs(l - 1) > 1e-6) return false;
  }
  return true;
}

/** Jedna jednotka práce: tělesa jedné reprezentace (díl) → samostatný malý STEP. */
export interface SplitUnit {
  /** Reprezentace (idx), ze které tělesa pochází. */
  rep: number;
  /** Položky (tělesa) k načtení. */
  items: number[];
  /** Kontext (jednotky) reprezentace. */
  ctx: number;
  name: string;
  /** Počet ploch B-repu (odhad pracnosti). */
  faces: number;
  /** Velikost souboru dílu v bajtech (odhad). */
  bytes: number;
  /** Bez ploch i těles (drátová geometrie, body) — OpenCascade z ní síť neudělá, nečte se. */
  empty: boolean;
  /** Obálka bodů dílu v mm [minX,minY,minZ,maxX,maxY,maxZ] (odhad z CARTESIAN_POINT). */
  box: [number, number, number, number, number, number] | null;
}

/** Uzel stromu sestavy (výskyt). */
export interface SplitNode {
  name: string;
  /** Jednotky (index do units) s maticí výskytu ve světových mm. */
  units: { unit: number; matrix: Mat }[];
  children: SplitNode[];
}

export interface SplitPlan {
  units: SplitUnit[];
  root: SplitNode;
  /** Celkový počet výskytů jednotek (dílů ve scéně). */
  occurrences: number;
  /** Součet ploch přes všechny výskyty (odhad počtu trojúhelníků). */
  totalFaces: number;
  /** Průměrný rozměr celé sestavy v mm ((dx + dy + dz) / 3) — pro průhyb sítě. */
  avgSize: number;
  warnings: string[];
  /** Tělesa v souboru, která žádný díl nepokrývá (neznámá vazba ve stromu) — 0 = vše rozpoznáno. */
  uncoveredSolids: number;
}

const SOLID_HINT = new Set([
  "MANIFOLD_SOLID_BREP", "BREP_WITH_VOIDS", "FACETED_BREP", "SHELL_BASED_SURFACE_MODEL", "FACE_BASED_SURFACE_MODEL",
  "CLOSED_SHELL", "OPEN_SHELL", "ADVANCED_FACE", "TESSELLATED_SOLID", "TESSELLATED_SHELL", "TRIANGULATED_FACE",
  "COMPLEX_TRIANGULATED_SURFACE_SET", "TRIANGULATED_SURFACE_SET",
]);
const NOT_GEOMETRY = new Set(["AXIS2_PLACEMENT_3D", "AXIS2_PLACEMENT_2D", "MAPPED_ITEM", "CARTESIAN_POINT", "DIRECTION", "AXIS1_PLACEMENT"]);
const FACE_TYPES = [
  "ADVANCED_FACE", "FACE_SURFACE", "FACE", "TRIANGULATED_FACE", "COMPLEX_TRIANGULATED_FACE", "TRIANGULATED_SURFACE_SET",
  "COMPLEX_TRIANGULATED_SURFACE_SET",
];

/** Délková jednotka kontextu → mm. */
function lengthScale(ix: StepIndex, ctx: number, cache: Map<number, number>): number {
  const hit = cache.get(ctx);
  if (hit !== undefined) return hit;
  let scale = 1;
  try {
    for (const rec of parseEntity(ix, ctx)) {
      if (rec.name !== "GLOBAL_UNIT_ASSIGNED_CONTEXT") continue;
      for (const uid of argRefs(rec.args[0])) {
        const s = unitToMm(ix, idxOf(ix, uid), 0);
        if (s) {
          scale = s;
          break;
        }
      }
    }
  } catch {
    scale = 1;
  }
  cache.set(ctx, scale);
  return scale;
}

const PREFIX: Record<string, number> = { EXA: 1e21, PETA: 1e18, TERA: 1e15, GIGA: 1e12, MEGA: 1e9, KILO: 1e6, HECTO: 1e5, DECA: 1e4, DECI: 100, CENTI: 10, MILLI: 1, MICRO: 1e-3, NANO: 1e-6, PICO: 1e-9 };

/** Jednotka délky → mm (0 = není délková). */
function unitToMm(ix: StepIndex, idx: number, depth: number): number {
  if (idx < 0 || depth > 4) return 0;
  const recs = parseEntity(ix, idx);
  if (!recs.some((r) => r.name === "LENGTH_UNIT")) return 0;
  const si = recs.find((r) => r.name === "SI_UNIT");
  if (si) {
    const p = si.args[0];
    return (p?.k === "enum" ? PREFIX[p.v] ?? 1000 : 1000);
  }
  const conv = recs.find((r) => r.name === "CONVERSION_BASED_UNIT");
  if (conv) {
    const m = idxOf(ix, argRef(conv.args[1]));
    if (m < 0) return 0;
    const mr = parseEntity(ix, m);
    const meas = mr.find((r) => r.args.length >= 2) as StepRecord | undefined;
    if (!meas) return 0;
    const value = argNum(meas.args[0]);
    const base = unitToMm(ix, idxOf(ix, argRef(meas.args[1])), depth + 1);
    if (Number.isFinite(value) && base) return value * base;
  }
  return 0;
}

function vec(ix: StepIndex, id: number): [number, number, number] | null {
  const idx = idxOf(ix, id);
  if (idx < 0) return null;
  const out = [0, 0, 0];
  if (typeName(ix, idx) === "DIRECTION" || typeName(ix, idx) === "CARTESIAN_POINT") {
    const k = readPoint(ix, idx, out);
    if (k >= 2) return [out[0], out[1], k === 3 ? out[2] : 0];
  }
  return null;
}

function norm(v: [number, number, number]): [number, number, number] | null {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : null;
}

const cross = (a: number[], b: number[]): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Matice umístění (AXIS2_PLACEMENT_3D / CARTESIAN_TRANSFORMATION_OPERATOR_3D) v mm. */
function placement(ix: StepIndex, id: number, scale: number): Mat | null {
  const idx = idxOf(ix, id);
  if (idx < 0) return null;
  const recs = parseEntity(ix, idx);
  const ax = recs.find((r) => r.name === "AXIS2_PLACEMENT_3D");
  if (ax) {
    const loc = vec(ix, argRef(ax.args[1])) ?? [0, 0, 0];
    const z = norm(vec(ix, argRef(ax.args[2])) ?? [0, 0, 1]) ?? [0, 0, 1];
    let x = norm(vec(ix, argRef(ax.args[3])) ?? [1, 0, 0]) ?? [1, 0, 0];
    // x kolmo na z (Gram–Schmidt); rovnoběžné → jiná osa
    const d = x[0] * z[0] + x[1] * z[1] + x[2] * z[2];
    x = norm([x[0] - d * z[0], x[1] - d * z[1], x[2] - d * z[2]]) ?? norm(cross(Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], z).map((v) => -v) as [number, number, number]) ?? [1, 0, 0];
    const y = cross(z, x);
    return new Float64Array([x[0], y[0], z[0], loc[0] * scale, x[1], y[1], z[1], loc[1] * scale, x[2], y[2], z[2], loc[2] * scale]);
  }
  const op = recs.find((r) => r.name === "CARTESIAN_TRANSFORMATION_OPERATOR_3D" || r.name === "CARTESIAN_TRANSFORMATION_OPERATOR");
  if (op) {
    // (name, description, axis1, axis2, local_origin, scale, axis3) — u komplexní entity bez name/description
    const a = op.args.length >= 7 ? op.args.slice(2) : op.args.length === 5 ? op.args : op.args.slice(op.args.length - 5);
    const recFor = (k: number) => (a[k] ? vec(ix, argRef(a[k])) : null);
    const loc = recFor(2) ?? [0, 0, 0];
    const sc = Number.isFinite(argNum(a[3])) ? argNum(a[3]) : 1;
    const x = norm(recFor(0) ?? [1, 0, 0]) ?? [1, 0, 0];
    let z = norm(recFor(4) ?? cross(x, norm(recFor(1) ?? [0, 1, 0]) ?? [0, 1, 0])) ?? [0, 0, 1];
    const y = norm(cross(z, x)) ?? [0, 1, 0];
    z = cross(x, y);
    return new Float64Array([x[0] * sc, y[0] * sc, z[0] * sc, loc[0] * scale, x[1] * sc, y[1] * sc, z[1] * sc, loc[1] * scale, x[2] * sc, y[2] * sc, z[2] * sc, loc[2] * scale]);
  }
  return null;
}

class UnionFind {
  parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n).map((_, i) => i);
  }
  find(a: number): number {
    let r = a;
    while (this.parent[r] !== r) r = this.parent[r];
    while (this.parent[a] !== r) {
      const n = this.parent[a];
      this.parent[a] = r;
      a = n;
    }
    return r;
  }
  union(a: number, b: number) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

function recArgs(recs: StepRecord[], name: string): StepArg[] | null {
  return recs.find((r) => r.name === name)?.args ?? null;
}

/** Entity daného typu (idx). */
function ofType(ix: StepIndex, name: string): number[] {
  const code = typeCode(ix, name);
  if (code < 0) return [];
  const out: number[] = [];
  for (let k = 0; k < ix.count; k++) if (ix.type[k] === code) out.push(k);
  return out;
}

/** Komplexní entity, které obsahují část `name`. */
function complexWith(ix: StepIndex, name: string): number[] {
  const out: number[] = [];
  const pat = new TextEncoder().encode(name);
  const b = ix.bytes;
  for (let k = 0; k < ix.count; k++) {
    if (ix.type[k] !== 0) continue;
    const s = ix.start[k], e = ix.end[k];
    // rychlé hledání podřetězce
    outer: for (let i = s; i <= e - pat.length; i++) {
      for (let j = 0; j < pat.length; j++) if (b[i + j] !== pat[j]) continue outer;
      out.push(k);
      break;
    }
  }
  return out;
}

/** Reprezentace (idx) → [položky, kontext]; null = není reprezentace. */
function repParts(ix: StepIndex, idx: number): { items: number[]; ctx: number; name: string } | null {
  const recs = parseEntity(ix, idx);
  const r = recs.length === 1 ? recs[0] : recs.find((x) => x.name === "REPRESENTATION" || x.name.endsWith("REPRESENTATION"));
  if (!r || r.args.length < 3) return null;
  const items = argRefs(r.args[1]).map((id) => idxOf(ix, id)).filter((x) => x >= 0);
  const ctx = idxOf(ix, argRef(r.args[2]));
  return { items, ctx, name: argStr(r.args[0]) };
}

function productName(ix: StepIndex, pd: number): string {
  try {
    const pdArgs = parseEntity(ix, pd)[0]?.args;
    const pdf = idxOf(ix, argRef(pdArgs?.[2]));
    if (pdf < 0) return "";
    const prod = idxOf(ix, argRef(parseEntity(ix, pdf)[0]?.args[2]));
    if (prod < 0) return "";
    const pa = parseEntity(ix, prod)[0]?.args ?? [];
    return (argStr(pa[1]) || argStr(pa[0])).trim();
  } catch {
    return "";
  }
}

/**
 * Plán rozdělení: díly (jednotky) a strom výskytů s maticemi. null = soubor nemá rozpoznatelnou
 * sestavu (načte se celý najednou).
 */
export function planStepSplit(ix: StepIndex): SplitPlan | null {
  const warnings: string[] = [];
  const scaleCache = new Map<number, number>();
  const uf = new UnionFind(ix.count);
  const isRep = new Uint8Array(ix.count);

  // PRODUCT_DEFINITION_SHAPE → definice (PD nebo NAUO)
  const pdsDef = new Map<number, number>();
  for (const k of ofType(ix, "PRODUCT_DEFINITION_SHAPE")) {
    const r = refsOf(ix, k);
    if (r.length) pdsDef.set(k, r[r.length - 1]);
  }
  // PD → reprezentace (SHAPE_DEFINITION_REPRESENTATION)
  const pdRep = new Map<number, number>();
  for (const k of ofType(ix, "SHAPE_DEFINITION_REPRESENTATION")) {
    const r = refsOf(ix, k);
    if (r.length < 2) continue;
    const def = pdsDef.get(r[0]);
    if (def === undefined) continue;
    const rep = r[1];
    isRep[rep] = 1;
    const t = typeName(ix, def);
    if (t !== "PRODUCT_DEFINITION" && t !== "PRODUCT_DEFINITION_WITH_ASSOCIATED_DOCUMENTS" && t !== "") continue;
    const prev = pdRep.get(def);
    if (prev === undefined) pdRep.set(def, rep);
    else uf.union(prev, rep);
  }
  if (!pdRep.size) return null;

  // stejné souřadnice: SHAPE_REPRESENTATION_RELATIONSHIP bez transformace
  for (const name of ["SHAPE_REPRESENTATION_RELATIONSHIP", "REPRESENTATION_RELATIONSHIP"]) {
    for (const k of ofType(ix, name)) {
      const r = refsOf(ix, k);
      if (r.length >= 2) {
        isRep[r[0]] = 1;
        isRep[r[1]] = 1;
        uf.union(r[0], r[1]);
      }
    }
  }

  // výskyty: CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(vazba s transformací, PDS(NAUO))
  type Edge = { child: number; matrix: Mat; name: string };
  const childEdges = new Map<number, Edge[]>(); // třída rodiče → potomci
  const isChildPd = new Set<number>();
  const pdClass = (pd: number) => {
    const rep = pdRep.get(pd);
    return rep === undefined ? -1 : uf.find(rep);
  };
  const repScale = (rep: number) => {
    const p = repParts(ix, rep);
    return p && p.ctx >= 0 ? lengthScale(ix, p.ctx, scaleCache) : 1;
  };
  const handledNauo = new Set<number>();
  for (const k of ofType(ix, "CONTEXT_DEPENDENT_SHAPE_REPRESENTATION")) {
    const r = refsOf(ix, k);
    if (r.length < 2) continue;
    const nauo = pdsDef.get(r[1]);
    if (nauo === undefined) continue;
    const na = parseEntity(ix, nauo)[0]?.args ?? [];
    const parentPd = idxOf(ix, argRef(na[3]));
    const childPd = idxOf(ix, argRef(na[4]));
    if (parentPd < 0 || childPd < 0) continue;
    const recs = parseEntity(ix, r[0]);
    const rr = recArgs(recs, "REPRESENTATION_RELATIONSHIP");
    const rrwt = recArgs(recs, "REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION");
    if (!rr || !rrwt) continue;
    const rep1 = idxOf(ix, argRef(rr[2])), rep2 = idxOf(ix, argRef(rr[3]));
    const tr = idxOf(ix, argRef(rrwt[0]));
    if (rep1 < 0 || rep2 < 0 || tr < 0) continue;
    isRep[rep1] = 1;
    isRep[rep2] = 1;
    const childCls = pdClass(childPd);
    const childFirst = childCls >= 0 ? uf.find(rep1) === childCls || uf.find(rep2) !== childCls : true;
    const [cRep, pRep] = childFirst ? [rep1, rep2] : [rep2, rep1];
    let m: Mat | null = null;
    const trRecs = parseEntity(ix, tr);
    const idt = recArgs(trRecs, "ITEM_DEFINED_TRANSFORMATION");
    if (idt) {
      const a1 = placement(ix, argRef(idt[2]), repScale(rep1));
      const a2 = placement(ix, argRef(idt[3]), repScale(rep2));
      if (a1 && a2) m = childFirst ? mul(a2, invert(a1)) : mul(a1, invert(a2));
    } else {
      const op = placement(ix, ix.ids[tr], repScale(rep2));
      if (op) m = childFirst ? op : invert(op);
    }
    if (!m) {
      warnings.push("Některé díly sestavy mají nečitelné umístění — zobrazí se v počátku.");
      m = IDENTITY;
    }
    const pc = uf.find(pRep);
    const list = childEdges.get(pc) ?? [];
    list.push({ child: uf.find(cRep), matrix: m, name: productName(ix, childPd) || argStr(na[1]) || argStr(na[0]) });
    childEdges.set(pc, list);
    isChildPd.add(childPd);
    handledNauo.add(nauo);
  }
  // NAUO bez CDSR (nemá umístění) → potomek v počátku
  for (const nauo of ofType(ix, "NEXT_ASSEMBLY_USAGE_OCCURRENCE")) {
    if (handledNauo.has(nauo)) continue;
    const na = parseEntity(ix, nauo)[0]?.args ?? [];
    const parentPd = idxOf(ix, argRef(na[3]));
    const childPd = idxOf(ix, argRef(na[4]));
    const pc = pdClass(parentPd), cc = pdClass(childPd);
    if (pc < 0 || cc < 0) continue;
    const list = childEdges.get(pc) ?? [];
    list.push({ child: cc, matrix: IDENTITY, name: productName(ix, childPd) });
    childEdges.set(pc, list);
    isChildPd.add(childPd);
  }

  // názvy tříd (podle produktu)
  const className = new Map<number, string>();
  for (const [pd, rep] of pdRep) {
    const c = uf.find(rep);
    if (!className.has(c)) className.set(c, productName(ix, pd));
  }

  // položky tříd: tělesa → jednotky, MAPPED_ITEM → potomci
  const classReps = new Map<number, number[]>();
  for (let k = 0; k < ix.count; k++) {
    if (!isRep[k]) continue;
    const c = uf.find(k);
    const l = classReps.get(c) ?? [];
    l.push(k);
    classReps.set(c, l);
  }
  const units: SplitUnit[] = [];
  const classUnits = new Map<number, number[]>();
  const repMapCache = new Map<number, { child: number; origin: number; scale: number }>();
  const unitOfClass = (cls: number): number[] => {
    const hit = classUnits.get(cls);
    if (hit) return hit;
    const list: number[] = [];
    classUnits.set(cls, list);
    for (const rep of classReps.get(cls) ?? []) {
      const p = repParts(ix, rep);
      if (!p || p.ctx < 0) continue;
      const geom = p.items.filter((it) => !NOT_GEOMETRY.has(typeName(ix, it)));
      if (!geom.length) continue;
      // více těles v jedné reprezentaci → každé zvlášť (menší soubory, průběh po tělesech)
      const solids = geom.filter((it) => SOLID_HINT.has(typeName(ix, it)));
      const groups = solids.length > 1 && solids.length === geom.length ? solids.map((s) => [s]) : [geom];
      for (const items of groups) {
        list.push(units.length);
        units.push({ rep, items, ctx: p.ctx, name: className.get(cls) || p.name || "", faces: 0, bytes: 0, box: null, empty: false });
      }
    }
    return list;
  };
  // MAPPED_ITEM v reprezentaci třídy → potomek
  const mappedChildren = (cls: number): Edge[] => {
    const out: Edge[] = [];
    for (const rep of classReps.get(cls) ?? []) {
      const p = repParts(ix, rep);
      if (!p) continue;
      for (const it of p.items) {
        if (typeName(ix, it) !== "MAPPED_ITEM") continue;
        const ma = parseEntity(ix, it)[0]?.args ?? [];
        const rm = idxOf(ix, argRef(ma[1]));
        if (rm < 0) continue;
        let info = repMapCache.get(rm);
        if (!info) {
          const ra = parseEntity(ix, rm)[0]?.args ?? [];
          const mapped = idxOf(ix, argRef(ra[1]));
          if (mapped < 0) continue;
          isRep[mapped] = 1;
          info = { child: mapped, origin: argRef(ra[0]), scale: repScale(mapped) };
          repMapCache.set(rm, info);
        }
        const o = placement(ix, info.origin, info.scale) ?? IDENTITY;
        const t = placement(ix, argRef(ma[2]), p.ctx >= 0 ? lengthScale(ix, p.ctx, scaleCache) : 1) ?? IDENTITY;
        const childCls = uf.find(info.child);
        if (!classReps.has(childCls)) classReps.set(childCls, [info.child]);
        out.push({ child: childCls, matrix: mul(t, invert(o)), name: argStr(ma[0]) || className.get(childCls) || "" });
      }
    }
    return out;
  };

  // kořeny: PD, které nejsou potomkem
  const roots: number[] = [];
  const seenRoot = new Set<number>();
  for (const pd of pdRep.keys()) {
    if (isChildPd.has(pd)) continue;
    const c = pdClass(pd);
    if (c >= 0 && !seenRoot.has(c)) {
      seenRoot.add(c);
      roots.push(c);
    }
  }
  if (!roots.length) return null;

  let occurrences = 0;
  let tooDeep = false;
  const build = (cls: number, name: string, matrix: Mat, depth: number, path: Set<number>): SplitNode => {
    const node: SplitNode = { name, units: [], children: [] };
    if (depth > 64 || path.has(cls)) {
      tooDeep = true;
      return node;
    }
    path.add(cls);
    for (const u of unitOfClass(cls)) {
      node.units.push({ unit: u, matrix });
      occurrences++;
    }
    for (const e of [...(childEdges.get(cls) ?? []), ...mappedChildren(cls)]) {
      node.children.push(build(e.child, e.name || className.get(e.child) || "Díl", mul(matrix, e.matrix), depth + 1, path));
    }
    path.delete(cls);
    return node;
  };
  const rootNodes = roots.map((c) => build(c, className.get(c) || "Model", IDENTITY, 0, new Set()));
  if (tooDeep) warnings.push("Sestava obsahuje cyklické odkazy — část se nezobrazí.");
  if (!units.length || !occurrences) return null;
  const root: SplitNode = rootNodes.length === 1 ? rootNodes[0] : { name: "Model", units: [], children: rootNodes };

  measureUnits(ix, units, scaleCache);

  // kontrola: všechna tělesa souboru patří nějakému dílu (jinak strom obsahuje vazbu, kterou neznáme)
  const covered = new Uint8Array(ix.count);
  for (const u of units) for (const it of u.items) covered[it] = 1;
  let uncoveredSolids = 0;
  for (const t of ["MANIFOLD_SOLID_BREP", "BREP_WITH_VOIDS", "FACETED_BREP", "SHELL_BASED_SURFACE_MODEL"]) {
    for (const k of ofType(ix, t)) if (!covered[k]) uncoveredSolids++;
  }

  // obálka celé sestavy a součet ploch přes výskyty
  let totalFaces = 0;
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const walk = (n: SplitNode) => {
    for (const { unit, matrix: m } of n.units) {
      const u = units[unit];
      totalFaces += u.faces;
      if (!u.box) continue;
      for (let c = 0; c < 8; c++) {
        const x = u.box[c & 1 ? 3 : 0], y = u.box[c & 2 ? 4 : 1], z = u.box[c & 4 ? 5 : 2];
        const wx = m[0] * x + m[1] * y + m[2] * z + m[3];
        const wy = m[4] * x + m[5] * y + m[6] * z + m[7];
        const wz = m[8] * x + m[9] * y + m[10] * z + m[11];
        if (wx < box[0]) box[0] = wx;
        if (wy < box[1]) box[1] = wy;
        if (wz < box[2]) box[2] = wz;
        if (wx > box[3]) box[3] = wx;
        if (wy > box[4]) box[4] = wy;
        if (wz > box[5]) box[5] = wz;
      }
    }
    n.children.forEach(walk);
  };
  walk(root);
  const avgSize = Number.isFinite(box[0]) ? (box[3] - box[0] + box[4] - box[1] + box[5] - box[2]) / 3 : 0;
  return { units, root, occurrences, totalFaces, avgSize, warnings: [...new Set(warnings)], uncoveredSolids };
}

/* ───────── uzávěr entit dílu ───────── */

/** Mapa cíl → stylované položky (barvy), aby se barvy dostaly i do souboru dílu. */
interface StyleMap {
  start: Uint32Array;
  list: Int32Array;
}

const styleMaps = new WeakMap<StepIndex, StyleMap>();

function styleMap(ix: StepIndex): StyleMap {
  const hit = styleMaps.get(ix);
  if (hit) return hit;
  const styled = typeCode(ix, "STYLED_ITEM"), over = typeCode(ix, "OVER_RIDING_STYLED_ITEM");
  const pairs: number[] = [];
  for (let k = 0; k < ix.count; k++) {
    const t = ix.type[k];
    if (t !== styled && t !== over) continue;
    const rs = ix.refStart[k], re = ix.refStart[k + 1];
    const targetPos = t === over ? re - 2 : re - 1;
    if (targetPos < rs) continue;
    const target = idxOf(ix, ix.refs[targetPos]);
    if (target >= 0) pairs.push(target, k);
  }
  const start = new Uint32Array(ix.count + 1);
  for (let p = 0; p < pairs.length; p += 2) start[pairs[p] + 1]++;
  for (let k = 0; k < ix.count; k++) start[k + 1] += start[k];
  const fill = start.slice(0, ix.count);
  const list = new Int32Array(pairs.length / 2);
  for (let p = 0; p < pairs.length; p += 2) list[fill[pairs[p]]++] = pairs[p + 1];
  const m = { start, list };
  styleMaps.set(ix, m);
  return m;
}

let stamp: Int32Array | null = null;
let stampIx: StepIndex | null = null;
let stampGen = 0;

/** Entity potřebné pro položky + kontext (+ barvy) — idx v pořadí souboru. */
export function closure(ix: StepIndex, roots: number[], withStyles = true): number[] {
  if (stampIx !== ix || !stamp) {
    stamp = new Int32Array(ix.count);
    stampIx = ix;
    stampGen = 0;
  }
  const st = stamp;
  const gen = ++stampGen;
  const out: number[] = [];
  const stack = roots.filter((r) => r >= 0);
  const visit = () => {
    while (stack.length) {
      const k = stack.pop()!;
      if (st[k] === gen) continue;
      st[k] = gen;
      out.push(k);
      for (let p = ix.refStart[k]; p < ix.refStart[k + 1]; p++) {
        const id = ix.refs[p];
        const j = id <= ix.maxId ? ix.idToIdx[id] : -1;
        if (j >= 0 && st[j] !== gen) stack.push(j);
      }
    }
  };
  visit();
  if (withStyles) {
    const sm = styleMap(ix);
    if (sm.list.length) {
      const extra: number[] = [];
      for (const k of out) for (let p = sm.start[k]; p < sm.start[k + 1]; p++) if (st[sm.list[p]] !== gen) extra.push(sm.list[p]);
      // barva cizí položky (OVER_RIDING → jiný styl) může přitáhnout další části — jen styly
      stack.push(...extra);
      visit();
    }
  }
  return out;
}

/** Počet ploch, obálka a velikost každé jednotky. */
function measureUnits(ix: StepIndex, units: SplitUnit[], scaleCache: Map<number, number>) {
  const faceCodes = new Set(FACE_TYPES.map((t) => typeCode(ix, t)).filter((c) => c > 0));
  const pointCode = typeCode(ix, "CARTESIAN_POINT");
  const pt = [0, 0, 0];
  for (const u of units) {
    const cl = closure(ix, [...u.items, u.ctx], false);
    let faces = 0, bytes = 0;
    const box: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const k of cl) {
      const t = ix.type[k];
      bytes += ix.end[k] - ix.start[k] + 12;
      if (faceCodes.has(t)) faces++;
      else if (t === pointCode && readPoint(ix, k, pt) === 3) {
        if (pt[0] < box[0]) box[0] = pt[0];
        if (pt[1] < box[1]) box[1] = pt[1];
        if (pt[2] < box[2]) box[2] = pt[2];
        if (pt[0] > box[3]) box[3] = pt[0];
        if (pt[1] > box[4]) box[4] = pt[1];
        if (pt[2] > box[5]) box[5] = pt[2];
      }
    }
    const s = lengthScale(ix, u.ctx, scaleCache);
    u.faces = faces;
    u.bytes = bytes;
    u.empty = faces === 0 && !u.items.some((it) => SOLID_HINT.has(typeName(ix, it)));
    u.box = Number.isFinite(box[0]) ? (box.map((v) => v * s) as SplitUnit["box"]) : null;
  }
}

const enc = new TextEncoder();
const esc = (s: string) => s.replace(/[^\x20-\x7e]/g, (ch) => `\\X2\\${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}\\X0\\`).replace(/'/g, "''");

/** Samostatný STEP jednoho dílu (hlavička originálu + uzávěr entit + minimální produkt). */
export function buildUnitStep(ix: StepIndex, unit: SplitUnit): Uint8Array {
  const cl = closure(ix, [...unit.items, unit.ctx], true);
  cl.sort((a, b) => a - b);
  let size = ix.headerEnd + 64;
  for (const k of cl) size += ix.end[k] - ix.start[k] + 16;
  let id = ix.maxId;
  const extra: string[] = [];
  const e = (body: string) => {
    id++;
    extra.push(`#${id}=${body};\n`);
    return `#${id}`;
  };
  const ctx = `#${ix.ids[unit.ctx]}`;
  const app = e("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  e(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${app})`);
  const name = esc(unit.name || "Part");
  const prod = e(`PRODUCT('${name}','${name}','',(${e(`PRODUCT_CONTEXT('',${app},'mechanical')`)}))`);
  const pdf = e(`PRODUCT_DEFINITION_FORMATION('','',${prod})`);
  const pd = e(`PRODUCT_DEFINITION('design','',${pdf},${e(`PRODUCT_DEFINITION_CONTEXT('part definition',${app},'design')`)})`);
  const pds = e(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
  const repType = ix.type[unit.rep] ? typeName(ix, unit.rep) : "SHAPE_REPRESENTATION";
  const rep = e(`${repType}('',(${unit.items.map((k) => `#${ix.ids[k]}`).join(",")}),${ctx})`);
  e(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);
  const styled = typeCode(ix, "STYLED_ITEM"), over = typeCode(ix, "OVER_RIDING_STYLED_ITEM");
  const styledIds = cl.filter((k) => ix.type[k] === styled || ix.type[k] === over).map((k) => `#${ix.ids[k]}`);
  if (styledIds.length) e(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(${styledIds.join(",")}),${ctx})`);
  const tail = enc.encode(`${extra.join("")}ENDSEC;\nEND-ISO-10303-21;\n`);
  const out = new Uint8Array(size + tail.length);
  const b = ix.bytes;
  out.set(b.subarray(0, ix.headerEnd), 0);
  let o = ix.headerEnd;
  const data = enc.encode("DATA;\n");
  out.set(data, o);
  o += data.length;
  for (const k of cl) {
    const head = enc.encode(`#${ix.ids[k]}=`);
    out.set(head, o);
    o += head.length;
    out.set(b.subarray(ix.start[k], ix.end[k]), o);
    o += ix.end[k] - ix.start[k];
    out[o++] = 59;
    out[o++] = 10;
  }
  out.set(tail, o);
  o += tail.length;
  // přesná délka (pole se předává do workeru celé)
  return o === out.length ? out : out.slice(0, o);
}
