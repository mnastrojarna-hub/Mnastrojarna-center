/** Výběr entit ve 3D (jako filtr výběru v ZW3D). */
import type { Vec3 } from "@/cad/types";

export type SelFilter = "all" | "feature" | "face" | "edge" | "vertex" | "body" | "component" | "subasm";

export const FILTER_LABEL: Record<SelFilter, string> = {
  all: "Vše",
  feature: "Prvek",
  face: "Plocha",
  edge: "Hrana",
  vertex: "Bod",
  body: "Těleso / tvar",
  component: "Komponenta",
  subasm: "Podsestava",
};

/**
 * Vybraná entita. `compId` = id listové komponenty v sestavě (u podsestav cesta „a/b/c“), `topId` = komponenta nejvyšší úrovně.
 * `index` = index plochy/hrany/vrcholu v tělese dílu, `point` = bod kliknutí ve světových souřadnicích.
 */
export type SelItem =
  | { kind: "face"; index: number; compId?: string; topId?: string; point?: Vec3 }
  | { kind: "edge"; index: number; compId?: string; topId?: string; point?: Vec3 }
  | { kind: "vertex"; index: number; compId?: string; topId?: string; point: Vec3 }
  | { kind: "body"; compId?: string; topId?: string; point?: Vec3 }
  | { kind: "component"; compId: string; topId?: string; point?: Vec3 }
  | { kind: "feature"; featureId: string };

export const selKey = (s: SelItem) =>
  s.kind === "feature" ? `f:${s.featureId}` : s.kind === "body" || s.kind === "component" ? `${s.kind}:${s.compId ?? ""}` : `${s.kind}:${s.compId ?? ""}:${s.index}`;

export const sameSel = (a: SelItem, b: SelItem) => selKey(a) === selKey(b);

export const KIND_LABEL: Record<SelItem["kind"], string> = {
  face: "Plocha",
  edge: "Hrana",
  vertex: "Bod",
  body: "Těleso",
  component: "Komponenta",
  feature: "Prvek",
};

/** Popisek měření v prostoru (kóta). */
export type MeasureGfx = { lines: [Vec3, Vec3][]; points: Vec3[]; labels: { pos: Vec3; text: string }[] };
