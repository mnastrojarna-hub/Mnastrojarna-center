/**
 * Rovina, bod, směr a osa prvku rozšíření zadané odkazem na geometrii (plocha modelu, tři body, pomocná rovina, vrchol,
 * střed hrany, hrana, normála plochy…). Prvky rozšíření dřív uměly jen základní roviny XY / XZ / YZ s odsazením, bod třemi
 * souřadnicemi a osu X / Y / Z. Parametr druhu „plane“ ukládá do dat `PlaneDef`, druh „point“ ukládá `Ref`; nejsou-li
 * vyplněné, platí původní zadání prvku. Druhy „direction“ a „axis“ ukládají `Direction` / `AxisDef` na původní klíč –
 * starší hodnoty („X“, „y“, [x, y, z]) se při stavbě i ve formuláři převedou (`toDirection`, `toAxisDef`).
 */
import * as r from "replicad";
import { tr } from "../i18n";
import { AXIS_KINDS, DIRECTION_KINDS, type AxisDef, type Direction, type PlaneDef, type Ref } from "../refs";
import type { Axis, PlaneName, Vec3 } from "../types";
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

// ---------------- směr a osa ----------------

const axisV = (a: Axis): Vec3 => (a === "X" ? [1, 0, 0] : a === "Y" ? [0, 1, 0] : [0, 0, 1]);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
function unit(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 1e-12)) throw new Error(tr("Nulový směr – zadejte nenulový vektor."));
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Hodnota parametru druhu „direction“ → `Direction`. Přijímá nový tvar (`{ kind: … }`) i starší zápisy: „X“ / „Y“ / „Z“
 * (i „-Z“, „+x“), vektor `[x, y, z]`, „normal“ / „normála“. Prázdná nebo neplatná hodnota → null (platí výchozí směr prvku).
 */
export function toDirection(v: unknown): Direction | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    const t = v.trim();
    if (/^(normal|normála|normala|kolmo)$/i.test(t)) return { kind: "normal" };
    const m = /^([+\-−]?)\s*([XYZ])$/i.exec(t);
    if (!m) return null;
    const axis = m[2].toUpperCase() as Axis;
    if (m[1] === "-" || m[1] === "−") return { kind: "vector", v: axisV(axis).map((c) => -c || 0) as Vec3 };
    return { kind: "axis", axis };
  }
  if (Array.isArray(v)) return v.length >= 3 && v.slice(0, 3).every(isNum) ? { kind: "vector", v: [v[0], v[1], v[2]] as Vec3 } : null;
  if (typeof v === "object" && DIRECTION_KINDS.some((k) => k.v === (v as { kind?: unknown }).kind)) {
    const d = v as Direction;
    if (d.kind === "axis" && !["X", "Y", "Z"].includes(d.axis)) return null;
    if (d.kind === "vector" && !(Array.isArray(d.v) && d.v.length >= 3 && d.v.slice(0, 3).every(isNum))) return null;
    return d;
  }
  return null;
}

/**
 * Hodnota parametru druhu „axis“ → `AxisDef`. Přijímá nový tvar i starší zápisy: „x“ / „y“ (osa skici – Plošná rotace),
 * „X“ / „Y“ / „Z“ (globální osa). Prázdná nebo neplatná hodnota → null.
 */
export function toAxisDef(v: unknown): AxisDef | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "x") return { kind: "sketchX" };
    if (t === "y") return { kind: "sketchY" };
    if (/^[XYZ]$/.test(t)) return { kind: "global", axis: t as Axis };
    return null;
  }
  if (typeof v === "object" && !Array.isArray(v) && AXIS_KINDS.some((k) => k.v === (v as { kind?: unknown }).kind)) {
    const a = v as AxisDef;
    if (a.kind === "global" && !["X", "Y", "Z"].includes(a.axis)) return null;
    return a;
  }
  return null;
}

/**
 * Jednotkový směr prvku z parametru `key`: osa a vektor se spočítají přímo (bez jádra), odkaz (hrana, normála plochy,
 * dva body…) přes `ctx.resolveDirection` nad tělesem před prvkem. Prázdné / „normal“ → `base.normal`, jinak `fallback`.
 */
export function extDirection(data: Data, ctx: ExtBuildCtx, key: string, o: { fallback?: Vec3; base?: { normal: Vec3; xDir?: Vec3 } } = {}): Vec3 {
  const d = toDirection(data[key]);
  const def = o.base?.normal ?? o.fallback ?? [0, 0, 1];
  if (!d || d.kind === "normal") return unit(def);
  if (d.kind === "axis") return axisV(d.axis);
  if (d.kind === "vector") return unit(d.v);
  if (!ctx.resolveDirection) throw new Error(tr("Směr odkazem nelze vyřešit – jádro neposkytlo odkazy."));
  return ctx.resolveDirection(d, o.base ?? { normal: def });
}

/**
 * Osa prvku z parametru `key` (počátek + jednotkový směr): globální osa přímo, ostatní (hrana, válcová plocha, dva body,
 * osy skici `sketchKey`, pomocná osa…) přes `ctx.resolveAxis`. Prázdné → `fallback` (výchozí osa Y skici).
 */
export function extAxis(data: Data, ctx: ExtBuildCtx, key: string, o: { sketchKey?: string; fallback?: AxisDef } = {}): { origin: Vec3; dir: Vec3 } {
  const def = toAxisDef(data[key]) ?? o.fallback ?? { kind: "sketchY" };
  if (def.kind === "global") return { origin: [0, 0, 0], dir: axisV(def.axis) };
  if (!ctx.resolveAxis) throw new Error(tr("Osu odkazem nelze vyřešit – jádro neposkytlo odkazy."));
  const sid = o.sketchKey ? data[o.sketchKey] : undefined;
  const a = ctx.resolveAxis(def, typeof sid === "string" && sid ? sid : undefined);
  return { origin: a.origin, dir: unit(a.dir) };
}
