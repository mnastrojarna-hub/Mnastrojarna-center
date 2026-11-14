/**
 * BALÍK 3 (layout) – stav relace balíku (neukládá se do dokumentu, jádro ho nezná): aktivní výřez při práci
 * v modelovém prostoru z rozvržení (MSPACE) a rozpracovaná úprava bloku (BEDIT: návratový prostor a původní definice).
 */
import { touch, type DraftSession } from "../session";
import type { DraftBlock, DraftModel, DraftSpace } from "../model";
import { findLayout } from "./sheets";
import type { DViewport } from "./types";

export type LayoutState = {
  /** aktivní výřez (MSPACE): relace kreslí do modelu, GUI ukazuje list kolem výřezu */
  vp: { layout: string; id: string } | null;
  /** úprava bloku: blok, prostor před BEDIT, definice před úpravou (null = blok vznikl v BEDIT) */
  bedit: { block: string; prev: DraftSpace; snapshot: DraftBlock | null } | null;
  /** naposledy zobrazené rozvržení (přepínač Model / rozvržení) */
  lastLayout: string | null;
};

const states = new WeakMap<DraftSession, LayoutState>();
export function layoutState(s: DraftSession): LayoutState {
  let st = states.get(s);
  if (!st) states.set(s, (st = { vp: null, bedit: null, lastLayout: null }));
  return st;
}

/** aktivní výřez, pokud relace opravdu pracuje v modelu přes výřez existujícího rozvržení */
export function activeViewport(s: DraftSession, m: DraftModel): { layout: string; vp: DViewport } | null {
  const st = layoutState(s);
  if (!st.vp || s.space !== "model") return null;
  const l = findLayout(m, st.vp.layout);
  const vp = l?.entities.find((e) => e.id === st.vp!.id && e.type === "viewport") as DViewport | undefined;
  return l && vp ? { layout: l.id, vp } : null;
}

/** přepne prostor relace (rozvržení si zapamatuje; MSPACE stav zruší, není-li cílem model s výřezem) */
export function setSpace(s: DraftSession, space: DraftSpace, vp: { layout: string; id: string } | null = null) {
  const st = layoutState(s);
  st.vp = space === "model" ? vp : null;
  if (space.startsWith("layout:")) st.lastLayout = space.slice(7);
  if (s.space !== space) {
    s.space = space;
    s.sel = [];
    s.prevSel = [];
  }
  touch(s);
}

/**
 * Měřítko poznámek (papír : skutečnost) pro poznámkové objekty (balík 2): aktivní výřez (MSPACE), jinak CANNOSCALE,
 * jinak 1. Text výšky 2,5 mm na papíře má v modelu výšku 2,5 / annoScale (v mm; jednotky výkresu přepočte volající).
 */
export function annoScale(s: DraftSession, m: DraftModel): number {
  const av = activeViewport(s, m);
  if (av) return av.vp.scale / (unitMmOf(m) || 1);
  return m.vars.cannoscale && m.vars.cannoscale > 0 ? m.vars.cannoscale : 1;
}
const MM: Record<string, number> = { unitless: 1, in: 25.4, ft: 304.8, mi: 1609344, mm: 1, cm: 10, m: 1000, km: 1e6, yd: 914.4, um: 0.001 };
const unitMmOf = (m: DraftModel) => MM[m.vars.units] ?? 1;
