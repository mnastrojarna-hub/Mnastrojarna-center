/**
 * Rovina a bod prvku rozšíření zadané odkazem na geometrii (plocha modelu, tři body, pomocná rovina, vrchol, střed hrany…).
 * Prvky rozšíření dřív uměly jen základní roviny XY / XZ / YZ s odsazením a bod třemi souřadnicemi. Parametr druhu
 * „plane“ ukládá do dat `PlaneDef`, druh „point“ ukládá `Ref`; nejsou-li vyplněné, platí původní zadání prvku.
 */
import * as r from "replicad";
import type { PlaneDef, Ref } from "../refs";
import type { PlaneName, Vec3 } from "../types";
import type { ExtBuildCtx } from "./registry";

type Data = Record<string, unknown>;

/** je rovina prvku zadaná odkazem? */
export const hasPlaneDef = (data: Data, key = "planeDef"): boolean => !!data[key] && typeof data[key] === "object";

/**
 * Rovina prvku: `data[key]` (PlaneDef vyřešený nad aktuálním tělesem), jinak základní rovina `data.plane` s odsazením
 * `data.offset`. `flip` obrátí normálu (strana „−“).
 */
export function extPlane(data: Data, ctx: ExtBuildCtx, o: { key?: string; fallback?: PlaneName; flip?: boolean } = {}): r.Plane {
  const def = data[o.key ?? "planeDef"] as PlaneDef | undefined | null;
  const s = o.flip ? -1 : 1;
  if (def && typeof def === "object" && ctx.resolvePlane) {
    const p = ctx.resolvePlane(def);
    return new r.Plane(p.origin, p.xDir, [p.normal[0] * s, p.normal[1] * s, p.normal[2] * s]);
  }
  const name = (["XY", "XZ", "YZ"].includes(String(data.plane)) ? data.plane : (o.fallback ?? "XY")) as PlaneName;
  const off = Number(data.offset) || 0;
  if (name === "XY") return new r.Plane([0, 0, off], [1, 0, 0], [0, 0, s]);
  if (name === "XZ") return new r.Plane([0, off, 0], [1, 0, 0], [0, s, 0]);
  return new r.Plane([off, 0, 0], [0, 1, 0], [s, 0, 0]);
}

/** Bod prvku: `data[key + "Ref"]` (odkaz vyřešený nad aktuálním tělesem), jinak souřadnice `data[key]`. */
export function extPoint(data: Data, ctx: ExtBuildCtx, key: string): Vec3 {
  const ref = data[`${key}Ref`] as Ref | undefined | null;
  if (ref && typeof ref === "object" && ctx.resolvePoint) return ctx.resolvePoint(ref);
  const v = data[key];
  return Array.isArray(v) && v.length >= 3 ? [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0] : [0, 0, 0];
}
