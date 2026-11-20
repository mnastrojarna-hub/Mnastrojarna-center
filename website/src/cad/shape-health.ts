/**
 * Zdraví tělesa po operaci: příznaky vadného výsledku booleovské operace, její oprava operací s tolerancí a kontrola
 * platnosti u prvku, který vadu způsobil.
 *
 * Proč (17. vlna, střižnice se zadním odlehčením břitu): klín odlehčení na natočené rovině skici se dotýká sousedního
 * kužele odlehčení rohu tečně a jeho horní hrana leží přesně na stěně otvoru. Souřadnice a vektory roviny zadané na
 * 5–6 desetinných míst dávají mezi těmi plochami mezeru / přesah kolem 0,00001 mm. Průnik roviny s téměř tečným kuželem je
 * špatně podmíněný (příčná nejistota √(2·R·δ) ≈ 0,0035 mm), jádro ji pokryje zvětšením tolerance vrcholu na 0,0035 mm a
 * u břitu zůstane hrana dlouhá 0,0015 mm, která leží celá uvnitř tolerance svého vrcholu („mikrohrana“). Výsledek:
 *  - úběr je o 0,42 mm³ menší, než má být (zbytek materiálu u tečny), jindy se řez neprovede vůbec nebo zmizí kus tělesa,
 *  - kontrola jádra (BRepCheck) těleso bez sítě projde, ale jakmile hrana dostane síť, hlásí neplatný polygon hrany
 *    (uzel sítě = bod vrcholu je 0,0015 mm od křivky hrany) – proto se dřív ⚠ objevilo až o prvek později: těleso se
 *    síťuje před další booleovskou operací (fastbool.ts, `premesh`), kontrola prvku probíhala před tím.
 *
 * Co s tím:
 *  1. každá operace běží nejdřív PŘESNĚ, jako dřív (tolerance u každé operace kazí díly, které přesně vycházejí – viz
 *     `baseFuzzy` ve fastbool.ts). Výsledek se pak prohlédne na příznaky vady, které přesné jádro u těchto dílů zanechává:
 *       a) operace zvětšila toleranci některého vrcholu nad 5e-4 mm (jádro muselo spojit body, které k sobě nepatří),
 *       b) těleso je po zasíťování neplatné nebo některá plocha síť nedostala,
 *       c) odebrání / přidání objem (téměř) nezměnilo, i když nástroj do tělesa zasahuje (ověří se průnikem),
 *       d) objem se změnil o víc, než má nástroj, nebo opačným směrem;
 *       (stejně se bere operace, která přesně skončila chybou jádra nebo nevrátila objemové těleso);
 *  2. jen u výsledku s příznakem se operace zopakuje s tolerancí modelu, s desetinásobnou a stonásobnou (`repair`). Náhradní
 *     výsledek se přijme, jen když je sám zdravý (každá hrana patří dvěma stranám ploch – těleso se samo sebe nedotýká,
 *     platná geometrie po zasíťování, síť pokrývá plochy, objem v mezích nástroje), něco udělal, shodne se s výsledkem
 *     sousední tolerance A něco ho potvrdí: shoda s přesným výsledkem do 2 % účinku operace, shoda s objemem přesného
 *     průniku tělesa s nástroji, nebo to, že přesná operace zjevně selhala (neudělala nic, vyšla mimo meze nástroje,
 *     skončila chybou). Jinak zůstává přesný výsledek; když mu shoda dvou tolerancí nebo průnik odporují, prvek dostane
 *     varování s oběma čísly;
 *  3. kontrola prvku (`verifyResult`) těleso zasíťuje stejně jako zobrazení – včetně druhého průchodu, kterým zobrazení
 *     doplní plochy bez sítě – takže vidí totéž co kontrola na konci stavby. Varování řekne, u kterého prvku vada vznikla,
 *     kde je a co změnit; další prvky na vadném tělese už jen odkážou na původce (`invalidSince`);
 *  4. když je těleso na konci neplatné a žádný prvek to nehlásí (velká tělesa se po prvcích nekontrolují), `flagInvalidBody`
 *     najde první prvek, po kterém je těleso neplatné, a varování zapíše i do uložených stavů stavby.
 */
import * as r from "replicad";
import { checkShape, isValidShape, tryFixShape, type ShapeCheck } from "./check";
import { MESH_ANGULAR, baseFuzzy, booleanOnce, meshComplete, meshShape, meshTolerance, remeshShape, setBooleanGuard, type BoolKind } from "./fastbool";
import { sizeOf, subShapes } from "./fastbox";
import { getLang, tr } from "./i18n";
import type { Feature, FeatureStatus, Vec3 } from "./types";

type Shape = r.Shape3D;
/** rozhraní jádra (embind) nemá úplné typy */
type OC = any;
type Deletable = { delete(): void };

/**
 * Od jaké tolerance vrcholu je výsledek operace podezřelý a těleso se před kontrolou síťuje. Přesné jádro dává 1e-7 mm,
 * zaoblení / sražení kolem 1e-4 mm; nad 5e-4 mm se tolerance dostane jen tam, kde jádro muselo spojit body, které k sobě
 * nepatří (vadná střižnice: 0,0035–0,015 mm).
 */
const FAT_VERTEX = 5e-4;

const vertexTol = new WeakMap<object, number>();
/** největší tolerance vrcholu tělesa (mm); tvary se po vzniku nemění, hodnota se pamatuje */
export function maxVertexTolerance(shape: r.AnyShape): number {
  const known = vertexTol.get(shape);
  if (known !== undefined) return known;
  const oc: OC = r.getOC();
  let t = 0;
  try {
    t = oc.BRep_Tool.MaxTolerance(shape.wrapped, oc.TopAbs_ShapeEnum.TopAbs_VERTEX) as number;
  } catch {
    t = 0;
  }
  vertexTol.set(shape, t);
  return t;
}

type FatVertex = { at: Vec3; tolerance: number };
const fatCache = new WeakMap<object, FatVertex[]>();
/** vrcholy tělesa s tolerancí nad `FAT_VERTEX` (běžné těleso nemá žádný – jedno volání jádra) */
function fatVertices(shape: r.AnyShape): FatVertex[] {
  const known = fatCache.get(shape);
  if (known) return known;
  const out: FatVertex[] = [];
  if (maxVertexTolerance(shape) > FAT_VERTEX) {
    const oc: OC = r.getOC();
    const vs = subShapes(shape, "VERTEX") as Deletable[];
    try {
      for (const v of vs) {
        const tolerance = oc.BRep_Tool.Tolerance(v) as number;
        if (!(tolerance > FAT_VERTEX)) continue;
        const p = oc.BRep_Tool.Pnt(v);
        out.push({ at: [p.X(), p.Y(), p.Z()], tolerance });
        p.delete();
      }
    } catch {
      /* bez vrcholů */
    } finally {
      for (const v of vs) v.delete();
    }
  }
  fatCache.set(shape, out);
  return out;
}
/**
 * Příznak a): má výsledek operace vrchol se zvětšenou tolerancí, který na tom místě neměl žádný ze vstupů? (Vstup s takovými
 * vrcholy – import, dřívější přijatý výsledek – tedy další operace nezdržuje, dokud nevznikne nový.)
 */
function newFatVertex(out: Shape, inputs: Shape[]): boolean {
  const fat = fatVertices(out);
  if (!fat.length) return false;
  const old = inputs.flatMap((x) => fatVertices(x));
  return fat.some((v) => !old.some((o) => Math.hypot(v.at[0] - o.at[0], v.at[1] - o.at[1], v.at[2] - o.at[2]) <= v.tolerance + o.tolerance));
}

export type MicroEdge = {
  /** pořadí hrany v tělese (E1 = 0) */
  index: number;
  /** délka hrany (mm) */
  length: number;
  /** součet tolerancí vrcholů hrany (mm) */
  tolerance: number;
  /** střed hrany */
  at: Vec3;
};

/** délka hrany a bod uprostřed */
function edgeGeometry(oc: OC, edge: unknown): { length: number; at: Vec3 } {
  const ad = new oc.BRepAdaptor_Curve(edge);
  try {
    const a = ad.FirstParameter();
    const b = ad.LastParameter();
    const pts: Vec3[] = [];
    const N = 8;
    for (let i = 0; i <= N; i++) {
      const p = ad.Value(a + ((b - a) * i) / N);
      pts.push([p.X(), p.Y(), p.Z()]);
      p.delete();
    }
    let length = 0;
    for (let i = 1; i <= N; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    return { length, at: pts[N / 2] };
  } finally {
    ad.delete();
  }
}

/** součet tolerancí vrcholů hrany (uzavřená hrana má jeden vrchol na obou koncích) */
function vertexTolerances(oc: OC, edge: unknown): number {
  const vs = subShapes({ wrapped: edge }, "VERTEX") as Deletable[];
  try {
    const t = vs.map((v) => oc.BRep_Tool.Tolerance(v) as number);
    return t.length === 1 ? 2 * t[0] : t.reduce((a, b) => a + b, 0);
  } finally {
    for (const v of vs) v.delete();
  }
}

/**
 * Mikrohrany tělesa: hrany, které celé leží uvnitř tolerancí svých vrcholů (délka ≤ součet tolerancí) – stejné pravidlo,
 * jakým jádro pozná hranu nepoužitelnou pro další booleovskou operaci. Prohlížejí se jen hrany, jejichž vrchol má toleranci
 * nad `minTol`; u tělesa bez takového vrcholu (běžný případ) stojí kontrola jedno volání jádra. `max` omezí počet vrácených
 * hran (1 = jen „jsou / nejsou“).
 */
export function microEdges(shape: r.AnyShape, max = 8, minTol = FAT_VERTEX): MicroEdge[] {
  const oc: OC = r.getOC();
  const en = oc.TopAbs_ShapeEnum;
  try {
    if (!(oc.BRep_Tool.MaxTolerance(shape.wrapped, en.TopAbs_VERTEX) > minTol)) return [];
  } catch {
    return [];
  }
  // 1. průchod: jen hrany s vrcholem nad `minTol` (každá hrana tělesa se navštíví za každou svou plochu)
  const found: { edge: { IsSame(o: unknown): boolean } & Deletable; length: number; tolerance: number; at: Vec3 }[] = [];
  const ex = new oc.TopExp_Explorer(shape.wrapped, en.TopAbs_EDGE, en.TopAbs_SHAPE);
  try {
    for (; ex.More(); ex.Next()) {
      const cur = ex.Current();
      let keep = false;
      try {
        if (!(oc.BRep_Tool.MaxTolerance(cur, en.TopAbs_VERTEX) > minTol)) continue;
        if (found.some((f) => f.edge.IsSame(cur))) continue;
        const edge = oc.TopoDS.Edge(cur);
        try {
          if (oc.BRep_Tool.Degenerated(edge)) continue;
          const tolerance = vertexTolerances(oc, edge);
          const g = edgeGeometry(oc, edge);
          if (g.length <= tolerance) {
            found.push({ edge: cur, tolerance, ...g });
            keep = true;
            if (found.length >= max) break;
          }
        } finally {
          edge.delete();
        }
      } catch {
        /* hrana bez křivky – nehodnotí se */
      } finally {
        if (!keep) cur.delete();
      }
    }
  } finally {
    ex.delete();
  }
  if (!found.length) return [];
  // 2. pořadí hran jako ve výběru (E1…) – jen když je co hlásit
  let all: ({ IsSame(o: unknown): boolean } & Deletable)[] = [];
  try {
    if (max > 1) all = subShapes(shape, "EDGE") as typeof all;
    return found.map((f) => ({ index: all.findIndex((e) => e.IsSame(f.edge)), length: f.length, tolerance: f.tolerance, at: f.at }));
  } finally {
    for (const e of all) e.delete();
    for (const f of found) f.edge.delete();
  }
}

/** Tolerance opakované booleovské operace: tolerance modelu, její desetinásobek a stonásobek. */
export function fuzzyLadder(size: number): number[] {
  const f0 = baseFuzzy(size);
  return [f0, f0 * 10, f0 * 100];
}

const volumeOf = (s: Shape): number => {
  try {
    return r.measureVolume(s);
  } catch {
    return NaN;
  }
};

/** počty od spuštění jádra (měření a testy): operace s příznakem vady, opakování s tolerancí a přijaté náhradní výsledky */
export const boolStats = { suspect: 0, retries: 0, repaired: 0 };

type Checked = { shape: Shape; check: ShapeCheck };
/** pochybnost o přesném výsledku: jeho účinek a účinek, který vyšel jinak – operací s tolerancí, nebo z průniku tělesa s nástroji */
type Doubt = { exact: number; other: number; by: "tolerance" | "overlap" };
/**
 * Booleovská operace, kterou lze zopakovat: druh, původní těleso, nástroje a opakování s tolerancí (mm). Pamatuje si, co
 * už se o ní zjistilo – objem průniku tělesa s nástroji a výsledek hledání náhrady – aby se nic nepočítalo dvakrát.
 */
export type BoolOp = { kind: BoolKind; a: Shape; tools: Shape[]; redo: (fuzzy: number) => Shape; overlap?: number; fix?: Checked | Doubt | null; /** objem nástrojů (měří se nejvýš jednou) */ vt?: number };

const toolsVolume = (op: BoolOp) => (op.vt ??= op.tools.reduce((sum, t) => sum + Math.abs(volumeOf(t)), 0));

/**
 * Patří každá hrana tělesa právě dvěma stranám ploch? Operace s tolerancí umí z téměř tečných ploch udělat těleso, které se
 * samo sebe dotýká v hraně: dvě díry s přesahem pod tolerancí se spojí v jedné dotykové přímce, kanál, který prorazí plochu
 * o méně než toleranci, se stáhne do jedné tečné hrany. Taková hrana má čtyři strany ploch místo dvou; kontrola jádra to
 * nepozná vždy, ale těleso je k ničemu (síť vynechá plochy, export STEP dá jiné těleso, další prvky selžou).
 */
export function manifoldEdges(shape: r.AnyShape): boolean {
  const oc: OC = r.getOC();
  const en = oc.TopAbs_ShapeEnum;
  type E = { IsSame(o: unknown): boolean } & Deletable;
  const seen = new Map<number, { edge: E; uses: number }[]>();
  const ex = new oc.TopExp_Explorer(shape.wrapped, en.TopAbs_EDGE, en.TopAbs_SHAPE);
  try {
    // průchod navštíví hranu za každou stranu plochy, ke které patří (šev válce dvakrát v téže ploše)
    for (; ex.More(); ex.Next()) {
      const cur = ex.Current() as E;
      const h = oc.ReplicadShapeHasher.HashCode(cur, 2147483647) as number;
      const list = seen.get(h) ?? [];
      const known = list.find((x) => x.edge.IsSame(cur));
      if (known) {
        known.uses++;
        cur.delete();
      } else {
        list.push({ edge: cur, uses: 1 });
        seen.set(h, list);
      }
    }
    for (const list of seen.values())
      for (const x of list) {
        if (x.uses === 2) continue;
        const edge = oc.TopoDS.Edge(x.edge);
        try {
          if (!oc.BRep_Tool.Degenerated(edge)) return false;
        } finally {
          edge.delete();
        }
      }
    return true;
  } catch {
    return true; // bez průchodu se neposuzuje
  } finally {
    ex.delete();
    for (const list of seen.values()) for (const x of list) x.edge.delete();
  }
}

/**
 * Chybí v síti tělesa část některé plochy (víc než 5 %; plochy užší než přesnost sítě se nepočítají)? U výsledku, kde jádro
 * s tolerancí uzavřelo otvor do jedné hrany, síť část plochy vynechá, i když kontrola jádra těleso projde. Volá se po
 * průchodu sítě (tento výpočet by ji jinak počítal sám).
 */
function meshCovers(shape: Shape): boolean {
  const oc: OC = r.getOC();
  let raw: (Record<string, () => number> & Deletable) | null = null;
  try {
    raw = oc.ReplicadMeshExtractor.extract(shape.wrapped, meshTolerance(sizeOf(shape)), MESH_ANGULAR, true) as Record<string, () => number> & Deletable;
    const buf = oc.wasmMemory.buffer as ArrayBuffer; // až po výpočtu – paměť jádra se při něm mohla zvětšit
    const v = new Float32Array(buf, raw.getVerticesPtr() >>> 0, raw.getVerticesSize());
    const t = new Uint32Array(buf, raw.getTrianglesPtr() >>> 0, raw.getTrianglesSize());
    const g = new Int32Array(buf, raw.getFaceGroupsPtr() >>> 0, raw.getFaceGroupsSize());
    const meshed = new Map<number, number>();
    for (let k = 0; k + 2 < g.length; k += 3) {
      let area = 0;
      for (let i = g[k]; i + 2 < g[k] + g[k + 1]; i += 3) {
        const a = t[i] * 3;
        const b = t[i + 1] * 3;
        const c = t[i + 2] * 3;
        const ux = v[b] - v[a];
        const uy = v[b + 1] - v[a + 1];
        const uz = v[b + 2] - v[a + 2];
        const wx = v[c] - v[a];
        const wy = v[c + 1] - v[a + 1];
        const wz = v[c + 2] - v[a + 2];
        area += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
      }
      meshed.set(g[k + 2], (meshed.get(g[k + 2]) ?? 0) + area);
    }
    const deflection = meshTolerance(sizeOf(shape));
    for (const f of shape.faces) {
      const exact = r.measureArea(f);
      if ((meshed.get(f.hashCode) ?? 0) >= 0.95 * exact) continue;
      // plocha užší než přesnost sítě (zbytek u tečny široký tisíciny mm) síť mít nemusí – v zobrazení není vidět
      const perimeter = f.edges.reduce((sum, e) => sum + r.measureLength(e), 0);
      if (!(perimeter > 0) || (2 * exact) / perimeter > deflection) return false;
    }
    return true;
  } catch {
    return true; // bez sítě se neposuzuje
  } finally {
    raw?.delete();
  }
}

/**
 * Zdravý výsledek opakované operace: každá hrana patří dvěma stranám ploch, geometrie je po zasíťování jako pro zobrazení
 * platná, těleso je objemové a síť pokrývá plochy. Síť a její porovnání se dělá jen u tělesa se ztloustlým vrcholem (jinde
 * síť výsledek kontroly nezmění). Hrany se kontrolují první: síť tělesa, které se samo sebe dotýká, umí trvat minuty.
 */
function healthy(s: Shape): ShapeCheck | null {
  if (!manifoldEdges(s)) return null;
  const c = displayCheck(s);
  if (!c.valid || !c.solids) return null;
  return maxVertexTolerance(s) > FAT_VERTEX && !meshCovers(s) ? null : c;
}

/**
 * O kolik smí změna objemu přesáhnout meze nástroje (odebrání neubere víc, než mají nástroje, a nepřidá; přidání obráceně):
 * tisícina většího z objemů tělesa a nástrojů. Objem těles se šroubovými a volnými plochami je změřený s chybou až 1e-5
 * (šnek z knihovny: přidaný hřídel 4523,893 mm³ „přidal“ 4524,224 mm³) – hlídají se jen hrubé chyby jádra.
 */
const boundsSlack = (va: number, vt: number) => 1e-3 * Math.max(1, Math.abs(va), vt);
/** Pod jakým zlomkem objemu nástrojů se účinek operace bere jako „neudělala nic“ (a ověří se průnikem tělesa s nástroji). */
const NO_EFFECT = 1e-3;
/** Do jakého zlomku účinku operace se musí shodnout výsledky dvou sousedních tolerancí. */
const AGREE = 5e-3;

/** Objem průniku tělesa s nástroji operace (přesně) – kolik má odebrání ubrat a o kolik méně než objem nástrojů má přidání přidat. */
function overlapVolume(op: BoolOp): number {
  if (op.overlap === undefined) {
    try {
      op.overlap = Math.abs(volumeOf(booleanOnce("Common", op.a, op.tools)));
    } catch {
      op.overlap = NaN;
    }
  }
  return op.overlap;
}

/**
 * Náhrada za přesný výsledek `exact` s příznakem vady. Operace se zopakuje s rostoucí tolerancí (tolerance modelu, 10×, 100×)
 * a hledá se výsledek, který
 *  - je zdravý (`healthy`) a objemem v mezích nástroje (odebrání neubere víc, než mají nástroje, a nepřidá; přidání obráceně),
 *  - něco udělal (operace, která objem nezmění, není oprava),
 *  - shodne se s dalším zdravým výsledkem s větší tolerancí do 0,5 % účinku operace (na toleranci tedy nezávisí)
 *  - a potvrdí ho nezávislé měřítko do 2 %: přesný výsledek, nebo účinek operace určený přesným průnikem tělesa s nástroji.
 *    Bez potvrzení se přijme jen tehdy, když přesná operace zjevně selhala (neudělala nic, nebo vyšla mimo meze nástroje).
 * Hledá se pro každou operaci nejvýš jednou (výsledek si operace pamatuje).
 * Vrací náhradní těleso; pochybnost (`Doubt`), když náhrada není a přesnému výsledku odporuje shoda dvou tolerancí nebo
 * průnik tělesa s nástroji (zůstává přesný výsledek a prvek dostane varování); jinak `null` – platí přesný výsledek.
 */
function repair(op: BoolOp, exact: Shape | null): Checked | Doubt | null {
  if (detectOnly) return op.fix ?? null;
  if (op.fix === undefined) op.fix = findRepair(op, exact);
  return op.fix;
}
/** jen zjistit vadu účinku, náhradu operací s tolerancí nehledat (velká tělesa – `verifyEffectOnly`) */
let detectOnly = false;
/** `exact` = `null`: přesná operace skončila chybou jádra (zjevné selhání – náhradu stačí potvrdit shodou dvou tolerancí) */
function findRepair(op: BoolOp, exact: Shape | null): Checked | Doubt | null {
  const va = volumeOf(op.a);
  const v0 = exact ? volumeOf(exact) : NaN;
  if (!Number.isFinite(va) || (exact && !Number.isFinite(v0))) return null;
  const common = op.kind === "Common";
  const sign = op.kind === "Cut" ? -1 : 1;
  const vt = common ? 0 : toolsVolume(op);
  const eps = 1e-9 * Math.max(1, Math.abs(va));
  const slack = boundsSlack(va, vt);
  const fits = (d: number) => common || (d >= -slack && d <= vt + slack);
  const least = Math.max(1e-4 * vt, eps);
  const d0 = common ? v0 : (v0 - va) * sign;
  const near = (d: number, ref: number) => Number.isFinite(ref) && Math.abs(d - ref) <= 0.02 * Math.abs(ref) + eps;
  /** účinek operace podle přesného průniku tělesa s nástroji (NaN, když průnik nejde spočítat) */
  const byOverlap = () => (op.kind === "Cut" ? overlapVolume(op) : vt - overlapVolume(op));
  let prev: (Checked & { d: number }) | null = null;
  const ladder = fuzzyLadder(sizeOf(op.a));
  for (const fuzzy of ladder) {
    // poslední tolerance bez zdravého předchůdce už nemá s čím souhlasit
    if (!prev && fuzzy === ladder[ladder.length - 1]) break;
    boolStats.retries++;
    let s: Shape;
    try {
      s = op.redo(fuzzy);
    } catch {
      prev = null;
      continue;
    }
    const v = volumeOf(s);
    const d = common ? v : (v - va) * sign;
    const check = Number.isFinite(v) && fits(d) && d > least ? healthy(s) : null;
    if (!check) {
      prev = null;
      continue;
    }
    if (prev && Math.abs(d - prev.d) <= AGREE * Math.abs(d) + eps) {
      const found = { shape: prev.shape, check: prev.check };
      if (near(prev.d, d0) || !exact) return found;
      if (common) return { exact: d0, other: prev.d, by: "tolerance" };
      const expected = byOverlap();
      // z dvojice shodných výsledků platí ten bližší průniku (souřadnice na 5 míst: výsledek s tolerancí modelu bývá o desetiny % vedle)
      if (expected > least && near(prev.d, expected)) return Math.abs(d - expected) < Math.abs(prev.d - expected) ? { shape: s, check } : found;
      // nic nepotvrzuje: přesná operace, která neudělala nic nebo vyšla mimo meze nástroje, zjevně selhala
      if (!fits(d0) || Math.abs(d0) <= NO_EFFECT * vt) return found;
      // přesný výsledek potvrzuje průnik → platí; jinak nelze rozhodnout
      return near(d0, expected) ? null : { exact: d0, other: prev.d, by: "tolerance" };
    }
    prev = { shape: s, check, d };
  }
  // žádná náhrada: odporuje přesnému výsledku aspoň průnik tělesa s nástroji?
  if (common || !exact) return null;
  const expected = byOverlap();
  return expected > least && !near(d0, expected) ? { exact: d0, other: expected, by: "overlap" } : null;
}

// ── od kterého prvku je těleso neplatné ──────────────────────────────────────────────────────────────────────────────
const origin = new WeakMap<object, string>();
/** Název prvku, po kterém je těleso neplatné (zjistila to kontrola některého dřívějšího prvku); jinak `undefined`. */
export function invalidSince(shape: Shape | null | undefined): string | undefined {
  return shape ? origin.get(shape) : undefined;
}
/** Kopie / nástupce tělesa nese stejnou informaci o původci neplatné geometrie (uložené stavy stavby, prvky bez kontroly). */
export function carryHealth<T extends Shape | null>(from: Shape | null | undefined, to: T): T {
  const o = from ? origin.get(from) : undefined;
  if (o !== undefined && to && to !== from) origin.set(to, o);
  return to;
}

/** poslední booleovská operace – `verifyResult` ji umí zopakovat, když je její výsledek výsledkem prvku */
let last: (BoolOp & { out: Shape }) | null = null;

setBooleanGuard((out, given) => {
  const op: BoolOp = { ...given };
  let res = out;
  try {
    // přesná operace skončila chybou jádra, nebo příznak a): zvětšila toleranci některého vrcholu
    // (na vadném vstupu se neopravuje – operace stavěla na vadné geometrii)
    if ((!out || newFatVertex(out, [op.a, ...op.tools])) && !origin.has(op.a)) {
      boolStats.suspect++;
      const better = repair(op, out);
      if (better && "shape" in better) {
        res = better.shape;
        boolStats.repaired++;
      }
    }
  } catch {
    /* kontrola je navíc – platí přesný výsledek */
  }
  last = res ? Object.assign(op, { out: res }) : null;
  if (last) journal.push(last);
  return res;
});

// ── booleovské operace jednoho prvku (úroveň „účinek“ – feature-levels.ts) ────────────────────────────────────────────
/** operace od posledního `beginFeatureOps()` */
let journal: (BoolOp & { out: Shape })[] = [];
/** začátek stavby prvku: zapomenout operace předchozího prvku */
export function beginFeatureOps(): void {
  journal = [];
}
/**
 * Řetěz booleovských operací prvku, jehož výsledkem je `result` (poslední operace vrátila `result`, předchozí vrátila její
 * těleso …; zkušební operace mimo řetěz se nepočítají): druh operace (`null` = řetěz míchá druhy) a součet objemů nástrojů.
 * `null` = výsledek prvku není výsledkem booleovské operace (zaoblení, složené těleso s volnými plochami, první těleso).
 */
export function opChainOf(result: Shape): { kind: BoolKind | null; tool: number } | null {
  const chain: BoolOp[] = [];
  let cur: Shape = result;
  for (let i = journal.length - 1; i >= 0; i--)
    if (journal[i].out === cur) {
      chain.push(journal[i]);
      cur = journal[i].a;
    }
  if (!chain.length) return null;
  const kind = chain.every((o) => o.kind === chain[0].kind) ? chain[0].kind : null;
  return { kind, tool: chain.reduce((sum, o) => sum + toolsVolume(o), 0) };
}

/**
 * Zasíťuje těleso stejně jako zobrazení – kontrola platnosti pak vidí totéž co kontrola na konci stavby. Síť může výsledek
 * kontroly změnit jen u hran, jejichž vrchol leží mimo křivku hrany dál, než je přesnost sítě hrany, a to dovolí jen výrazně
 * zvětšená tolerance vrcholu; těleso bez takového vrcholu se proto nesíťuje (jedno volání jádra). Když první průchod nechá
 * některou plochu bez sítě (vadný obrys), zobrazení ji při svém průchodu zkusí zasíťovat znovu a stav tělesa se tím ještě
 * změní – proto se tu druhý průchod udělá rovnou. Síť se nepočítá zbytečně: využije ji další operace i zobrazení.
 */
export function meshForCheck(shape: Shape) {
  try {
    if (!(maxVertexTolerance(shape) > FAT_VERTEX)) return;
    meshShape(shape);
    if (!meshComplete(shape)) remeshShape(shape);
  } catch {
    /* bez sítě se zkontroluje jen přesná geometrie */
  }
}

const num = (v: number, digits: number) => {
  const s = String(Math.round(v * 10 ** digits) / 10 ** digits || 0);
  return getLang() === "en" ? s : s.replace(".", ",");
};
const point = (p: Vec3) => `[${p.map((v) => num(v, 3)).join("; ")}]`;

/** začátek varování o neplatné geometrii – podle něj se pozná, že prvek už vadu hlásí */
const invalidLead = () => tr("Výsledek má neplatnou geometrii");
/** začátek varování „neplatná geometrie“ (podle něj se pozná prvek, od kterého je těleso neplatné) */
export const invalidLeadText = invalidLead;

/** Které plochy a hrany kontrola jádra označila (nejvýš `max` od každého druhu, číslované jako ve výběru F1 / E1). */
function badParts(shape: Shape, max = 4): string[] {
  const oc: OC = r.getOC();
  const out: string[] = [];
  let an: ({ IsValid(s?: unknown): boolean } & Deletable) | null = null;
  try {
    an = new oc.BRepCheck_Analyzer(shape.wrapped, true) as { IsValid(s?: unknown): boolean } & Deletable;
    for (const [kind, label] of [["FACE", "F"], ["EDGE", "E"]] as const) {
      const subs = subShapes(shape, kind) as Deletable[];
      const bad: number[] = [];
      subs.forEach((s, i) => {
        try {
          if (bad.length <= max && !an!.IsValid(s)) bad.push(i + 1);
        } catch {
          /* podtvar bez výsledku kontroly */
        }
        s.delete();
      });
      if (bad.length) out.push(`${kind === "FACE" ? tr("plochy") : tr("hrany")} ${bad.slice(0, max).map((i) => `${label}${i}`).join(", ")}${bad.length > max ? "…" : ""}`);
    }
  } catch {
    /* bez podrobností */
  } finally {
    an?.delete();
  }
  return out;
}

/** Varování k prvku, po kterém je těleso neplatné: který prvek, co a kde je vadné a co změnit. */
export function invalidMessage(f: Pick<Feature, "name" | "type">, shape: Shape): string {
  const parts = [tr("{0} – vznikla u prvku „{1}“; export STEP může selhat a další prvky na vadné místo navazují.", invalidLead(), f.name)];
  let micro: MicroEdge[] = [];
  try {
    micro = microEdges(shape, 3);
  } catch {
    /* bez podrobností */
  }
  if (micro.length) {
    const m = micro[0];
    parts.push(
      tr("Hrana{0} dlouhá {1} mm u bodu {2} leží celá v toleranci svého vrcholu ({3} mm): nástroj je tam téměř tečný k ploše tělesa nebo končí přesně na jeho hraně či ploše (odchylka pod 0,01 mm, typicky zaokrouhlené souřadnice nebo natočení roviny skici).", m.index >= 0 ? ` E${m.index + 1}` : "", num(m.length, 5), point(m.at), num(m.tolerance, 5)),
      tr("Co změnit: nechte profil plochu jasně protnout (přesah aspoň 0,01 mm místo dotyku) nebo ho ukončete mimo těleso; rovinu skici zadejte úhlem nebo odkazem na plochu místo zaokrouhlených vektorů."),
    );
  } else {
    const bad = badParts(shape);
    if (bad.length) parts.push(tr("Vadné: {0}.", bad.join("; ")));
    parts.push(tr("Změňte parametry: profil nesmí být tečný k povrchu tělesa, dráha se nesmí protínat."));
  }
  return parts.join(" ");
}

/** Varování k prvku postavenému na tělese, které je neplatné už od dřívějšího prvku `since` (původce se hlásí jen jednou). */
export const sinceMessage = (since: string) => tr("Těleso je neplatné už od prvku „{0}“ – tento prvek na vadnou geometrii jen navazuje. Opravte nejdřív prvek „{0}“.", since);

/** síť jako pro zobrazení + kontrola jádra */
function displayCheck(s: Shape): ShapeCheck {
  meshForCheck(s);
  return checkShape(s);
}

export type Verified = Checked & {
  warning?: string;
  /** změna objemu podle přesného průniku tělesa s nástroji (mm³, se znaménkem) – jen když se průnik počítal */
  expected?: number;
  /** varování „objem se nezměnil“ (ne neplatná geometrie) */
  noEffect?: boolean;
  /** těleso je po prvku neplatné */
  invalid?: boolean;
};

const NEAR_TANGENT = () => tr("Plochy nástroje jsou téměř tečné k plochám tělesa nebo s nimi téměř splývají – posuňte nástroj tak, aby plochy tělesa jasně protínal (aspoň o 0,01 mm), nebo aby s nimi splýval přesně.");
/** Varování: přesnému výsledku (který zůstal) odporuje shoda dvou tolerancí, nebo průnik tělesa s nástroji. */
const doubtMessage = (d: Doubt) =>
  [
    d.by === "tolerance"
      ? tr("Výsledek operace závisí na toleranci výpočtu: přesně se objem tělesa změnil o {0} mm³, s tolerancí o {1} mm³ (stejně pro dvě různé tolerance); ponechán je přesný výsledek.", num(d.exact, 3), num(d.other, 3))
      : tr("Výsledek operace neodpovídá průniku tělesa s nástrojem: objem tělesa se změnil o {0} mm³, podle průniku to má být {1} mm³.", num(d.exact, 3), num(d.other, 3)),
    NEAR_TANGENT(),
  ].join(" ");

/** Překrývají se obalové kvádry tělesa a nástrojů nejvýš dotykem (žádný společný objem)? */
function apart(op: BoolOp): boolean {
  try {
    const [a0, a1] = op.a.boundingBox.bounds;
    return op.tools.every((t) => {
      const [b0, b1] = t.boundingBox.bounds;
      return [0, 1, 2].some((i) => Math.min(a1[i], b1[i]) - Math.max(a0[i], b0[i]) <= 1e-6);
    });
  } catch {
    return false;
  }
}

/**
 * Objem po operaci proti tomu, co operace udělat mohla (příznaky c a d v záhlaví). `d` = změna objemu poslední operace ve
 * směru operace (kladná = odebrání ubralo, přidání přidalo), `vt` = objem nástrojů, `va` = objem tělesa před operací. Vrací
 * náhradní těleso, varování, nebo `null`, když je výsledek v pořádku.
 */
function checkEffect(op: BoolOp, shape: Shape, d: number, vt: number, va: number): Checked | { warning: string; noEffect?: boolean } | null {
  const slack = boundsSlack(va, vt);
  if (d < -slack || d > vt + slack) {
    // d) víc, než má nástroj, nebo opačným směrem. Objem neplatného vstupu není spolehlivý – takový prvek se neposuzuje.
    if (!isValidShape(op.a) || op.tools.some((t) => !isValidShape(t))) return null;
    const better = repair(op, shape);
    if (better && "shape" in better) return better;
    return { warning: [tr("Výsledek operace neodpovídá nástroji: objem tělesa se změnil o {0} mm³, nástroj má jen {1} mm³ – jádro operaci spočítalo chybně.", num(op.kind === "Cut" ? -d : d, 3), num(vt, 3)), NEAR_TANGENT()].join(" ") };
  }
  if (Math.abs(d) > NO_EFFECT * vt) return null;
  // c) operace neudělala (téměř) nic proti velikosti nástroje: zasahuje nástroj do tělesa?
  const unchanged = { noEffect: true, warning: tr("Prvek objem tělesa nezměnil (jen rozdělil plochy) – nástroj se tělesa pouze dotýká nebo leží mimo něj, nebo jádro operaci u téměř tečných ploch neprovedlo. Zkontrolujte polohu a rozměry; profil musí do tělesa jasně zasahovat (aspoň o 0,01 mm).") };
  const none = 1e-12 * Math.max(1, Math.abs(va), vt);
  // nástroj, jehož obalový kvádr se s kvádrem tělesa nepřekrývá, do tělesa zasahovat nemůže – nic dalšího se nepočítá
  if (op.kind === "Cut" && Math.abs(d) <= none && apart(op)) return unchanged;
  const overlap = overlapVolume(op);
  const expected = op.kind === "Cut" ? overlap : vt - overlap;
  const real = Number.isFinite(expected) && expected > none;
  if (real && d >= 0.5 * expected) return null; // malý, ale skutečný úběr / přídavek
  // nástroj do tělesa zasahuje, ale objemem pod rozlišením měření objemu (koule zanořená 1e-5 mm) – není co posuzovat
  if (op.kind === "Cut" && overlap > 0 && !real) return null;
  const better = repair(op, shape);
  if (better && "shape" in better) return better;
  if (real) return { noEffect: true, warning: doubtMessage({ exact: d, other: expected, by: "overlap" }) };
  // průnik se nepodařilo spočítat a objem se přece jen změnil → neposuzuje se
  if (!Number.isFinite(expected) && Math.abs(d) > none) return null;
  return unchanged;
}

/**
 * Kontrola výsledku prvku. Těleso se zasíťuje jako pro zobrazení a zkontroluje; výsledek booleovské operace s příznakem vady
 * (záhlaví souboru) se zkusí nahradit operací s tolerancí, neplatné těleso pak ještě opravou (ShapeFix). `volumes` = objem
 * před prvkem a po něm. `since` = název prvku, od kterého je těleso neplatné už před tímto prvkem: operace se pak neopravuje
 * a varování jen odkáže na původce. Vrací těleso (případně náhradní), výsledek kontroly a varování.
 */
export function verifyResult(input: Shape, f: Pick<Feature, "name" | "type">, volumes?: [before: number, after: number], since?: string): Verified {
  const op = last && last.out === input && !since ? last : null;
  last = null;
  let shape = input;
  /** náhrada operací s tolerancí – ne u výsledku, který už náhradou je */
  const replace = (): Checked | null => {
    if (!op || (op.fix && "shape" in op.fix)) return null;
    const found = repair(op, shape);
    return found && "shape" in found ? found : null;
  };
  let check: ShapeCheck | null = null;
  if (maxVertexTolerance(shape) > FAT_VERTEX) {
    let complete = true;
    try {
      meshShape(shape);
      complete = meshComplete(shape);
    } catch {
      /* bez sítě se zkontroluje jen přesná geometrie */
    }
    if (!complete) {
      // b) některá plocha síť nedostala: náhradní výsledek se zkusí dřív, než se vadné těleso síťuje podruhé (umí trvat dlouho)
      const better = replace();
      if (better) {
        shape = better.shape;
        check = better.check;
      } else {
        try {
          remeshShape(shape);
        } catch {
          /* druhý průchod selhal – platí stav po prvním */
        }
      }
    }
  }
  check ??= checkShape(shape);
  if (!check.solids) {
    // operace nevrátila objemové těleso – zjevné selhání jádra; zkusí se náhrada
    const better = replace();
    if (!better) return { shape, check };
    shape = better.shape;
    check = better.check;
  }
  if (!check.valid) {
    const better = replace();
    if (better) {
      shape = better.shape;
      check = better.check;
    } else {
      const fixed = tryFixShape(shape);
      const c = fixed ? displayCheck(fixed) : null;
      if (fixed && c && c.valid && c.solids) {
        shape = fixed;
        check = c;
      } else {
        // oprava umí těleso spravit i na místě (zvětší tolerance hran a vrcholů) – varování by pak neplatilo
        check = displayCheck(shape);
        if (!check.valid || !check.solids) {
          origin.set(shape, since ?? f.name);
          return { shape, check, invalid: true, warning: since ? sinceMessage(since) : invalidMessage(f, shape) };
        }
      }
    }
  }
  if (shape !== input) {
    boolStats.repaired++;
    return { shape, check }; // náhradní výsledek už prošel i kontrolou objemu
  }
  return verifyEffect(op, shape, check, volumes);
}

/** změna objemu podle průniku tělesa s nástroji, pokud se u operace počítal (se znaménkem: odebrání záporně) */
function expectedOf(op: BoolOp | null): number | undefined {
  if (!op || op.kind === "Common" || op.overlap === undefined || !Number.isFinite(op.overlap)) return undefined;
  return op.kind === "Cut" ? -op.overlap : toolsVolume(op) - op.overlap;
}

/**
 * Účinek poslední booleovské operace prvku proti nástroji (příznaky c a d v záhlaví): běžná změna objemu projde bez dalšího
 * počítání; žádná / podezřele malá (pod tisícinu nástroje) / větší než nástroj se ověří přesným průnikem tělesa s nástroji.
 */
function verifyEffect(op: BoolOp | null, shape: Shape, check: ShapeCheck, volumes?: [before: number, after: number]): Verified {
  const doubt = op?.fix && !("shape" in op.fix) ? op.fix : null;
  const kept: Verified = doubt ? { shape, check, warning: doubtMessage(doubt) } : { shape, check };
  if (!op || op.kind === "Common" || !volumes || !Number.isFinite(volumes[0]) || !Number.isFinite(volumes[1])) return kept;
  const sign = op.kind === "Cut" ? -1 : 1;
  const d0 = (volumes[1] - volumes[0]) * sign;
  // běžný prvek (operace bez příznaku vady, změna objemu zřetelná a nejvýš polovina tělesa): je-li objem nástrojů už změřený
  // (úroveň „účinek“), stačí porovnat – jinak se objem nástrojů, u šroubových ploch drahý, nepočítá
  const size = Math.max(1, Math.abs(volumes[0]));
  if (doubt) return kept;
  if (op.fix === undefined && d0 > 1e-6 * size && d0 <= 0.5 * size && (op.vt === undefined || (d0 > NO_EFFECT * op.vt && d0 <= op.vt + boundsSlack(volumes[0], op.vt)))) return kept;
  const vt = toolsVolume(op);
  if (!(vt > 0) || (d0 >= 0 && d0 <= vt && d0 > NO_EFFECT * vt)) return kept;
  // podezřelá změna objemu za celý prvek; prvek z více operací se posoudí podle tělesa, do kterého šla poslední z nich
  const va = volumeOf(op.a);
  if (!Number.isFinite(va)) return kept;
  const found = checkEffect(op, shape, (volumes[1] - va) * sign, vt, va);
  const expected = expectedOf(op);
  if (!found) return expected === undefined ? kept : { ...kept, expected };
  if ("shape" in found) {
    boolStats.repaired++;
    return found;
  }
  return { shape, check, ...found, ...(expected === undefined ? {} : { expected }) };
}

/**
 * Kontrola účinku booleovské operace BEZ kontroly platnosti – tělesa nad limit ploch kontroly po prvku (platnost se ověří až
 * na konci stavby). Stejná pravidla jako u menších těles; náhrada operací s tolerancí se u velkých těles nehledá (jen ⚠).
 */
export function verifyEffectOnly(input: Shape, volumes?: [before: number, after: number], since?: string): Pick<Verified, "warning" | "noEffect" | "expected"> {
  const op = last && last.out === input && !since ? last : null;
  last = null;
  if (!op) return {};
  detectOnly = true;
  try {
    const v = verifyEffect(op, input, { valid: true, solids: 1, shells: 1, faces: 0 }, volumes);
    return { ...(v.warning ? { warning: v.warning } : {}), ...(v.noEffect ? { noEffect: true } : {}), ...(v.expected !== undefined ? { expected: v.expected } : {}) };
  } catch {
    return {}; // kontrola je navíc – platí výsledek operace
  } finally {
    detectOnly = false;
  }
}

/** platnost tělesa tak, jak ji vidí kontrola na konci stavby (se sítí) */
const validMeshed = (s: Shape) => {
  meshForCheck(s);
  return isValidShape(s);
};

/**
 * Těleso je na konci stavby neplatné a žádný prvek to nehlásí (tělesa nad 400 ploch se po prvcích nekontrolují, prvek bez
 * změny tělesa se nekontroluje vůbec): mezi uloženými stavy stavby najde první, po kterém je těleso neplatné, a varování
 * doplní jeho prvku; bez uložených stavů poslednímu prvku. Prvky za ním dostanou odkaz na původce. `steps` = tělesa a stav
 * prvků po `n` prvcích (cachedSteps v build.ts): varování se zapíše i do nich a tělesa se označí, aby stavba, která na
 * uložený stav naváže (přidaný prvek), varování neztratila a nepřipsala vadu novému prvku.
 */
export function flagInvalidBody(features: Pick<Feature, "id" | "name" | "type" | "suppressed">[], status: FeatureStatus[], steps: { n: number; shapes: Shape[]; status?: FeatureStatus[] }[], isValid: (s: Shape) => boolean = validMeshed): FeatureStatus | null {
  const lead = invalidLead();
  if (status.some((s) => s.warning?.includes(lead))) return null;
  const sorted = steps.filter((s) => s.n >= 1 && s.n <= features.length && s.shapes.length).sort((a, b) => a.n - b.n);
  const bad = (i: number) => sorted[i].shapes.some((s) => !isValid(s));
  // půlení: po prvku, který těleso pokazil, zůstává neplatné
  let lo = 0;
  let hi = sorted.length - 1;
  let first = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bad(mid)) {
      first = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  const byId = (list: FeatureStatus[], id: string) => list.find((s) => s.id === id && s.ok);
  let target: FeatureStatus | undefined;
  let shape: Shape | undefined;
  if (first >= 0) {
    // stavy se ukládají po každém prvku; když některý chybí, vada vznikla mezi předchozím uloženým stavem a tímto
    target = byId(status, features[sorted[first].n - 1].id);
    shape = sorted[first].shapes.find((s) => !isValid(s));
  }
  if (!target) for (let i = features.length - 1; i >= 0 && !target; i--) if (features[i].type !== "sketch" && features[i].type !== "datum") target = byId(status, features[i].id);
  if (!target) return null;
  const at = features.findIndex((x) => x.id === target!.id);
  const f = features[at];
  const text = shape ? invalidMessage(f, shape) : [tr("{0} – vznikla u prvku „{1}“; export STEP může selhat a další prvky na vadné místo navazují.", lead, f.name), tr("Změňte parametry: profil nesmí být tečný k povrchu tělesa, dráha se nesmí protínat.")].join(" ");
  const later = sinceMessage(f.name);
  /** varování původci a odkaz na něj prvkům za ním (skici, pomocné roviny a potlačené prvky těleso nemění) */
  const stamp = (list: FeatureStatus[]) => {
    for (let i = at; i < features.length; i++) {
      const x = features[i];
      if (i > at && (x.type === "sketch" || x.type === "datum" || x.suppressed)) continue;
      const st = byId(list, x.id);
      const t = i === at ? text : later;
      if (st && !st.warning?.includes(t)) st.warning = st.warning ? `${st.warning} ${t}` : t;
    }
  };
  stamp(status);
  for (const s of sorted) {
    if (s.n < at + 1) continue;
    if (s.status && s.status !== status) stamp(s.status);
    for (const b of s.shapes) if (!origin.has(b)) origin.set(b, f.name);
  }
  return target;
}
