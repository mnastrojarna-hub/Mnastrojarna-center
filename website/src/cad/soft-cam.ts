/**
 * Kamera softwarového náhledu (bez WebGL): kdy a jak se model vejde do plátna. Čistá logika bez prohlížeče,
 * aby šla otestovat; plátno a ovládání jsou v `components/cad/viewport-soft.tsx`.
 *
 * Pravidla odpovídají 3D oknu (WebGL): model se vejde do plátna při prvním zobrazení, po výrazné změně velikosti
 * a po přesunu mimo dosavadní místo; jinak se pohled (směr i přiblížení) drží.
 */
import { VIEW_ANGLES, basisOf, fitCamera, type SoftAngles, type SoftItem, type SoftViewName } from "./soft-render";
import type { Vec3 } from "./types";

export type SoftCam = {
  angles: SoftAngles;
  center: Vec3;
  /** CSS pixelů na milimetr */
  scale: number;
  view: SoftViewName | "free";
  /** kamera už byla přizpůsobena skutečnému modelu */
  fitted: boolean;
  /** rozměr (poloměr) a střed modelu při posledním vykreslení – podle nich se pozná výrazná změna modelu */
  radius: number;
  boundsCenter: Vec3 | null;
};

export const newSoftCam = (): SoftCam => ({ angles: VIEW_ANGLES.iso, center: [0, 0, 0], scale: 1, view: "iso", fitted: false, radius: 1, boundsCenter: null });

/**
 * Vejde model do plátna `width × height` (CSS px); s `view` zároveň nastaví pojmenovaný pohled.
 * Prázdná scéna (nový díl, model se ještě počítá) kameru nemění – jen si poznamená, že se má přizpůsobit,
 * jakmile se model objeví (jinak by zůstalo měřítko 1 px/mm a další model by byl drobný).
 */
export function fitSoftCam(c: SoftCam, items: SoftItem[], width: number, height: number, fill: number, view?: SoftViewName): void {
  if (view) {
    c.angles = VIEW_ANGLES[view];
    c.view = view;
  }
  if (!items.length) {
    c.fitted = false;
    return;
  }
  if (!(width > 0 && height > 0)) return;
  const f = fitCamera(items, basisOf(c.angles), width, height, fill);
  c.center = f.center;
  c.scale = f.scale;
}

/**
 * Nový stav modelu (ohraničení `bounds`, null = prázdná scéna): vrátí pohled, do kterého se má kamera znovu
 * přizpůsobit, nebo null, když se pohled drží. Zároveň si zapamatuje rozměr a střed modelu.
 * – první zobrazení (i po přizpůsobení prázdné scény): naposledy zvolený pojmenovaný pohled (výchozí izometrie),
 * – velikost se změnila o víc než 60 % nebo se model posunul o víc než polovinu svého rozměru: izometrie.
 */
export function softCamOnModel(c: SoftCam, bounds: { center: Vec3; radius: number } | null): SoftViewName | null {
  if (!bounds) return null;
  const first = !c.fitted;
  const resized = Math.abs(bounds.radius - c.radius) / c.radius > 0.6;
  const prev = c.boundsCenter;
  const moved = !!prev && Math.hypot(bounds.center[0] - prev[0], bounds.center[1] - prev[1], bounds.center[2] - prev[2]) > Math.max(bounds.radius, c.radius) * 0.5;
  c.radius = bounds.radius;
  c.boundsCenter = bounds.center;
  if (!first && !resized && !moved) return null;
  c.fitted = true;
  return first && c.view !== "free" ? c.view : "iso";
}
