/**
 * JEDINÉ místo, kde se určuje rozměr obrázku posílaného Claude (anonymizace výkresů).
 * Opus 5.5 / 5 / 4.8: ≤ 2576 px delší strana A ZÁROVEŇ ≤ ~3,75 MPx. Větší obrázek by API samo
 * zmenšilo a vrácené souřadnice by neseděly — proto měřítko počítáme vždy sami.
 */

export const CLAUDE_MAX_SIDE = 2576;
export const CLAUDE_MAX_PIXELS = 3_750_000;

export interface FitResult {
  /** Měřítko zdroj → zaslaný obrázek (≤ maxUpscale). */
  s: number;
  w: number;
  h: number;
}

export function fitForClaude(w: number, h: number, maxUpscale = 1): FitResult {
  if (!(w > 0) || !(h > 0)) return { s: 0, w: 0, h: 0 };
  let s = Math.min(maxUpscale, CLAUDE_MAX_SIDE / Math.max(w, h), Math.sqrt(CLAUDE_MAX_PIXELS / (w * h)));
  let ow = Math.max(1, Math.floor(w * s));
  let oh = Math.max(1, Math.floor(h * s));
  // floor: nikdy nepřekročit mez zaokrouhlením (pojistka pro hraniční poměry)
  while ((ow > CLAUDE_MAX_SIDE || oh > CLAUDE_MAX_SIDE || ow * oh > CLAUDE_MAX_PIXELS) && s > 0) {
    s *= 0.999;
    ow = Math.max(1, Math.floor(w * s));
    oh = Math.max(1, Math.floor(h * s));
  }
  return { s, w: ow, h: oh };
}

/** Výřez zdroje (px zdroje), ze kterého vznikl zaslaný obrázek. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Měřítko výřez → zaslaný obrázek. */
  s: number;
  /** Rozměr zaslaného obrázku. */
  outW: number;
  outH: number;
}

export function cropFor(x: number, y: number, w: number, h: number, maxUpscale = 1): Crop {
  const f = fitForClaude(w, h, maxUpscale);
  return { x, y, w, h, s: f.s, outW: f.w, outH: f.h };
}

/** Bod v px zaslaného obrázku → px zdroje. */
export function toSource(crop: Crop, px: number, py: number): [number, number] {
  return [crop.x + px / crop.s, crop.y + py / crop.s];
}

/** Bod v px zdroje → px zaslaného obrázku (inverze toSource). */
export function toSent(crop: Crop, sx: number, sy: number): [number, number] {
  return [(sx - crop.x) * crop.s, (sy - crop.y) * crop.s];
}

/** Tolerance přesahu boxu za okraj zaslaného obrázku (1 %). */
export const OUT_OF_IMAGE_TOLERANCE = 0.01;

/** Leží box (px zaslaného obrázku) v obrázku s tolerancí 1 %? */
export function boxInsideSent(crop: Pick<Crop, "outW" | "outH">, x: number, y: number, w: number, h: number): boolean {
  if (![x, y, w, h].every((v) => Number.isFinite(v))) return false;
  if (w <= 0 || h <= 0) return false;
  const tx = crop.outW * OUT_OF_IMAGE_TOLERANCE;
  const ty = crop.outH * OUT_OF_IMAGE_TOLERANCE;
  return x >= -tx && y >= -ty && x + w <= crop.outW + tx && y + h <= crop.outH + ty;
}

/** Leží čtyřúhelník (px zaslaného obrázku) v obrázku s tolerancí 1 %? */
export function quadInsideSent(crop: Pick<Crop, "outW" | "outH">, q: readonly number[]): boolean {
  if (q.length !== 8 || !q.every((v) => Number.isFinite(v))) return false;
  const tx = crop.outW * OUT_OF_IMAGE_TOLERANCE;
  const ty = crop.outH * OUT_OF_IMAGE_TOLERANCE;
  for (let i = 0; i < 8; i += 2) {
    if (q[i] < -tx || q[i] > crop.outW + tx || q[i + 1] < -ty || q[i + 1] > crop.outH + ty) return false;
  }
  return true;
}
