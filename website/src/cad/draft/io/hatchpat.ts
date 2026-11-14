/**
 * Definice standardních vzorů šraf (acad.pat / acadiso.pat) pro zápis HATCH do DWG / DXF: šrafa v souboru musí nést
 * řádky vzoru už natočené a v měřítku (DXF 53, 43/44, 45/46, 49), jinak ji AutoCAD zobrazí prázdnou.
 * Hodnoty v palcích (acad.pat); metrické výkresy (MEASUREMENT = 1) používají acadiso.pat = palce × 25,4.
 * Vzory, které tu nejsou, se zapíší z řádků uložených při importu (ext.pat), jinak jako ANSI31 (s varováním).
 */
import type { PatLine } from "./types";
import type { Vec2 } from "../model";

/** [úhel°, x, y, dx, dy, ...čárky] */
type Row = number[];

const PAT: Record<string, Row[]> = {
  ANSI31: [[45, 0, 0, 0, 0.125]],
  ANSI32: [[45, 0, 0, 0, 0.375], [45, 0.176776695, 0, 0, 0.375]],
  ANSI33: [[45, 0, 0, 0, 0.25], [45, 0.176776695, 0, 0, 0.25, 0.125, -0.0625]],
  ANSI34: [[45, 0, 0, 0, 0.75], [45, 0.176776695, 0, 0, 0.75], [45, 0.353553391, 0, 0, 0.75], [45, 0.530330086, 0, 0, 0.75]],
  ANSI35: [[45, 0, 0, 0, 0.25], [45, 0.176776695, 0, 0, 0.25, 0.3125, -0.0625, 0, -0.0625]],
  ANSI36: [[45, 0, 0, 0.21875, 0.125, 0.3125, -0.0625, 0, -0.0625]],
  ANSI37: [[45, 0, 0, 0, 0.125], [135, 0, 0, 0, 0.125]],
  ANSI38: [[45, 0, 0, 0, 0.125], [135, 0, 0, 0.25, 0.125, 0.3125, -0.1875]],
  LINE: [[0, 0, 0, 0, 0.125]],
  NET: [[0, 0, 0, 0, 0.125], [90, 0, 0, 0, 0.125]],
  NET3: [[0, 0, 0, 0, 0.125], [60, 0, 0, 0, 0.125], [120, 0, 0, 0, 0.125]],
  DOTS: [[0, 0, 0, 0.03125, 0.0625, 0, -0.0625]],
  SQUARE: [[0, 0, 0, 0, 0.125, 0.125, -0.125], [90, 0, 0, 0, 0.125, 0.125, -0.125]],
  STEEL: [[45, 0, 0, 0, 0.125], [45, 0, 0.0625, 0, 0.125]],
  CROSS: [[0, 0, 0, 0.25, 0.25, 0.125, -0.375], [90, 0.0625, -0.0625, 0.25, 0.25, 0.125, -0.375]],
  BRICK: [[0, 0, 0, 0, 0.25], [90, 0, 0, 0, 0.5, 0.25, -0.25], [90, 0.25, 0, 0, 0.5, -0.25, 0.25]],
  DASH: [[0, 0, 0, 0.125, 0.125, 0.125, -0.125]],
  ZIGZAG: [[0, 0, 0, 0.125, 0.125, 0.125, -0.125], [90, 0.125, 0, 0.125, 0.125, 0.125, -0.125]],
  GRATE: [[0, 0, 0, 0, 0.03125], [90, 0, 0, 0, 0.125]],
  ANGLE: [[0, 0, 0, 0, 0.275, 0.2, -0.075], [90, 0, 0, 0, 0.275, 0.2, -0.075]],
};
/** vzory jen v acadiso.pat (mm) */
const ISO: Record<string, Row[]> = {
  ISO02W100: [[0, 0, 0, 0, 5, 12, -3]],
  ISO03W100: [[0, 0, 0, 0, 5, 12, -18]],
  ISO04W100: [[0, 0, 0, 0, 5, 24, -3, 0.5, -3]],
  ISO07W100: [[0, 0, 0, 0, 5, 0.5, -3]],
  ISO10W100: [[0, 0, 0, 0, 5, 12, -3, 0.5, -3]],
};

export const knownPatterns = () => [...Object.keys(PAT), ...Object.keys(ISO)];

const rot = (v: Vec2, a: number): Vec2 => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];

/**
 * Řádky vzoru pro HATCH: natočené o `angle` [°] a v měřítku `scale` (jak je zapisuje AutoCAD).
 * null = vzor není v knihovně.
 */
export function patternLines(name: string, scale: number, angle: number, metric: boolean): PatLine[] | null {
  const key = name.toUpperCase();
  const iso = ISO[key];
  const rows = iso ?? PAT[key];
  if (!rows) return null;
  const k = (iso ? 1 : metric ? 25.4 : 1) * (scale || 1);
  const a = (angle * Math.PI) / 180;
  return rows.map(([ang, x, y, dx, dy, ...dash]) => {
    const la = ((ang + angle) * Math.PI) / 180;
    return { angle: ang + angle, base: rot([x * k, y * k], a), offset: rot([dx * k, dy * k], la), dashes: dash.map((d) => d * k) };
  });
}
