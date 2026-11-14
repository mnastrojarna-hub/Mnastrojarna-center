/**
 * BALÍK 1 (edit) – tolerance délek. Tolerance je ABSOLUTNÍ (ve výkresových jednotkách, jako u OVERKILL / JOIN
 * v AutoCADu); k ní se přičte jen spodní mez pro zaokrouhlení double na velkých souřadnicích (2,2e-16 × |x|
 * s rezervou ~500× → 1e-13 × |x|: na souřadnicích S-JTSK ~1e6 je to 1e-7). Relativní tolerance „tol × max(1, |x|)“
 * by na 1e6 narostla milionkrát (1e-7 → 0,1 jednotky) a řezy, spoje a duplicity by se slévaly.
 */
import type { Vec2 } from "../model";

/** relativní mez zaokrouhlení double (souřadnice → délka) */
export const FLOAT_REL = 1e-13;
/** výchozí tolerance shody bodů (průsečíky, konce) */
export const PT_TOL = 1e-7;

/** tolerance délky v bodě p: absolutní `tol` + zaokrouhlení podle velikosti souřadnic */
export const tolAt = (p: Vec2, tol: number = PT_TOL): number => tol + FLOAT_REL * Math.max(Math.abs(p[0]), Math.abs(p[1]));
/** tolerance pro porovnání dvou čísel (poloměry, délky): absolutní `tol` + zaokrouhlení podle velikosti */
export const tolNum = (x: number, tol: number = PT_TOL): number => tol + FLOAT_REL * Math.abs(x);
