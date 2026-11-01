/**
 * Trvalé vazby sestavy (Kontakt, Zarovnat, Souosost, Vzdálenost, Úhel, Rovnoběžnost) – sekvenční řešič.
 * Čisté funkce: geometrii ploch dodá volající (`FaceGeo` v souřadnicích komponenty nejvyšší úrovně).
 * Každá vazba posune/natočí pohyblivou komponentu (`a`, pokud není ukotvená; jinak `b`). Projde se dvakrát,
 * aby se dořešily řetězené vazby, a nakonec se zkontrolují zbytky (konflikt = vazbu nelze splnit s ostatními).
 */
import { apply3, eulerXYZ, mul3, rotMatrix, rotationBetween, transformPoint, type Mat3 } from "./assembly";
import type { AsmComponent, CadDoc, Mate, MateRef, MateType, Placement, Vec3 } from "./types";

/** Geometrie plochy v souřadnicích komponenty nejvyšší úrovně. U válce/kužele: `normal` = směr osy, `origin` = bod na ose. */
export type FaceGeo = { kind: "plane" | "cylinder" | "other"; origin: Vec3; normal: Vec3; radius?: number };
export type GeoProvider = (ref: MateRef) => FaceGeo | null;
export type MateStatus = "ok" | "conflict" | "missing" | "suppressed";

export const MATE_LABEL: Record<MateType, string> = {
  mate: "Kontakt",
  flush: "Zarovnat",
  concentric: "Souosost",
  distance: "Vzdálenost",
  angle: "Úhel",
  parallel: "Rovnoběžně",
  fixed: "Ukotvit",
};

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const rv = (v: Vec3): Vec3 => [r6(v[0]), r6(v[1]), r6(v[2])];

/** Plocha ve světových souřadnicích podle umístění komponenty. */
export function worldGeo(pl: Placement, g: FaceGeo): FaceGeo {
  return { ...g, origin: transformPoint(pl, g.origin), normal: norm(apply3(rotMatrix(pl.rotation), g.normal)) };
}

/** Natočení umístění tak, aby lokální směr `local` mířil na světový `target`; otáčí se nejmenší možnou rotací. */
function rotateTo(pl: Placement, local: Vec3, target: Vec3): Placement {
  const R = rotMatrix(pl.rotation);
  const cur = norm(apply3(R, local));
  const Q = rotationBetween(cur, norm(target));
  const R2: Mat3 = mul3(Q, R);
  return { position: pl.position, rotation: eulerXYZ(R2) };
}

/** Řešení jedné vazby: vrátí nové umístění pohyblivé komponenty. */
export function solveOne(mate: Mate, moving: Placement, gA: FaceGeo, worldB: FaceGeo): Placement {
  const nB = norm(worldB.normal);
  switch (mate.type) {
    case "mate":
    case "flush":
    case "distance": {
      const want = mate.type === "flush" ? nB : scale(nB, -1);
      let pl = rotateTo(moving, gA.normal, mate.flip ? scale(want, -1) : want);
      const wA = worldGeo(pl, gA);
      if (mate.center) {
        pl = { ...pl, position: rv(add(pl.position, sub(worldB.origin, wA.origin))) };
      } else {
        const d = dot(sub(worldB.origin, wA.origin), nB) + (mate.type === "distance" ? (mate.value ?? 0) : 0);
        pl = { ...pl, position: rv(add(pl.position, scale(nB, d))) };
      }
      return pl;
    }
    case "concentric": {
      // osa A rovnoběžně s osou B (menší otočení, nebo obráceně při flip), pak bod osy A na osu B
      const R = rotMatrix(moving.rotation);
      const curDir = norm(apply3(R, gA.normal));
      let want = dot(curDir, nB) >= 0 ? nB : scale(nB, -1);
      if (mate.flip) want = scale(want, -1);
      let pl = rotateTo(moving, gA.normal, want);
      const wA = worldGeo(pl, gA);
      const rel = sub(wA.origin, worldB.origin);
      const perp = sub(rel, scale(nB, dot(rel, nB)));
      pl = { ...pl, position: rv(sub(pl.position, perp)) };
      return pl;
    }
    case "parallel": {
      const want = mate.flip ? scale(nB, -1) : nB;
      return rotateTo(moving, gA.normal, want);
    }
    case "angle": {
      const R = rotMatrix(moving.rotation);
      const curDir = norm(apply3(R, gA.normal));
      let axis = cross(nB, curDir);
      if (Math.hypot(...axis) < 1e-9) axis = Math.abs(nB[0]) < 0.9 ? cross(nB, [1, 0, 0]) : cross(nB, [0, 1, 0]);
      axis = norm(axis);
      const ang = (((mate.value ?? 0) * (mate.flip ? -1 : 1)) * Math.PI) / 180;
      // Rodrigues: otočení nB kolem osy o úhel
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const target: Vec3 = add(add(scale(nB, c), scale(cross(axis, nB), s)), scale(axis, dot(axis, nB) * (1 - c)));
      return rotateTo(moving, gA.normal, target);
    }
    case "fixed":
      return moving;
  }
}

/** Zbytková chyba vazby (0 = splněno). */
export function residual(mate: Mate, wA: FaceGeo, wB: FaceGeo): number {
  const nA = norm(wA.normal);
  const nB = norm(wB.normal);
  const d = sub(wA.origin, wB.origin);
  switch (mate.type) {
    case "mate":
    case "flush":
    case "distance": {
      const sign = (mate.type === "flush" ? 1 : -1) * (mate.flip ? -1 : 1);
      const ang = Math.abs(dot(nA, nB) - sign);
      const gap = Math.abs(dot(d, nB) - (mate.type === "distance" ? (mate.value ?? 0) : 0));
      const ctr = mate.center ? Math.hypot(...d) : 0;
      return ang * 10 + gap + ctr;
    }
    case "concentric": {
      const ang = Math.hypot(...cross(nA, nB));
      const perp = sub(d, scale(nB, dot(d, nB)));
      return ang * 10 + Math.hypot(...perp);
    }
    case "parallel":
      return Math.abs(dot(nA, nB) - (mate.flip ? -1 : 1)) * 10;
    case "angle": {
      const a = (Math.acos(Math.max(-1, Math.min(1, dot(nA, nB)))) * 180) / Math.PI;
      return Math.abs(a - Math.abs(mate.value ?? 0)) / 10;
    }
    case "fixed":
      return 0;
  }
}

export type SolveResult = { components: AsmComponent[]; status: Record<string, MateStatus>; moved: string[] };

/**
 * Sekvenční řešení všech vazeb. `anchorId` = komponenta, kterou uživatel právě přesunul (bere se jako pevná).
 * Pohybuje se `a`; je-li ukotvená (fixed / anchor / první komponenta bez jiné ukotvené), pohybuje se `b`.
 */
export function solveMates(doc: CadDoc, geo: GeoProvider, anchorId?: string | null, passes = 2): SolveResult {
  const comps = (doc.components ?? []).map((c) => ({ ...c }));
  const byId = new Map(comps.map((c) => [c.id, c]));
  const mates = doc.mates ?? [];
  const status: Record<string, MateStatus> = {};
  const moved = new Set<string>();
  const anyFixed = comps.some((c) => c.fixed);
  const isFixed = (id: string) => {
    const c = byId.get(id);
    if (!c) return true;
    if (id === anchorId) return true;
    if (c.fixed) return true;
    if (!anyFixed && comps[0]?.id === id && anchorId == null) return true;
    return false;
  };
  for (const m of mates) {
    if (m.suppressed) status[m.id] = "suppressed";
    else if (m.type === "fixed") {
      const c = byId.get(m.a.compId);
      if (c) c.fixed = true;
      status[m.id] = c ? "ok" : "missing";
    }
  }
  for (let pass = 0; pass < passes; pass++) {
    for (const m of mates) {
      if (m.suppressed || m.type === "fixed") continue;
      const gA = geo(m.a);
      const gB = geo(m.b);
      const cA = byId.get(m.a.compId);
      const cB = byId.get(m.b.compId);
      if (!gA || !gB || !cA || !cB) {
        status[m.id] = "missing";
        continue;
      }
      let movingRef = m.a;
      let targetRef = m.b;
      let gMov = gA;
      let gTar = gB;
      let swap = false;
      if (isFixed(m.a.compId) && !isFixed(m.b.compId)) {
        movingRef = m.b;
        targetRef = m.a;
        gMov = gB;
        gTar = gA;
        swap = true;
      }
      const mov = byId.get(movingRef.compId)!;
      const tar = byId.get(targetRef.compId)!;
      if (isFixed(mov.id)) {
        // obě ukotvené – jen kontrola
        status[m.id] = residual(m, worldGeo(cA.placement, gA), worldGeo(cB.placement, gB)) < 1e-3 ? "ok" : "conflict";
        continue;
      }
      const wTar = worldGeo(tar.placement, gTar);
      // při prohození rolí: vzdálenost/úhel se měří od A k B – znaménko zachováme otočením
      const mm: Mate = swap && m.type === "distance" ? { ...m, value: m.value } : m;
      const next = solveOne(mm, mov.placement, gMov, wTar);
      if (JSON.stringify(next) !== JSON.stringify(mov.placement)) {
        mov.placement = next;
        moved.add(mov.id);
      }
      status[m.id] = "ok";
    }
  }
  // kontrola zbytků po všech průchodech (konflikty)
  for (const m of mates) {
    if (m.suppressed || m.type === "fixed" || status[m.id] === "missing") continue;
    const gA = geo(m.a);
    const gB = geo(m.b);
    const cA = byId.get(m.a.compId);
    const cB = byId.get(m.b.compId);
    if (!gA || !gB || !cA || !cB) continue;
    if (residual(m, worldGeo(cA.placement, gA), worldGeo(cB.placement, gB)) > 1e-3) status[m.id] = "conflict";
  }
  return { components: comps, status, moved: [...moved] };
}

/** Klíč pro mezipaměť geometrie plochy. */
export const mateRefKey = (ref: MateRef) => `${ref.leaf ?? ref.compId}:${ref.face}`;

/** Vazby, které se týkají dané komponenty. */
export const matesOf = (doc: CadDoc, compId: string) => (doc.mates ?? []).filter((m) => m.a.compId === compId || m.b.compId === compId);
