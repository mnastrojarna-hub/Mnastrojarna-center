/**
 * Jednotky a přesnost 2D výkresu: INSUNITS, formát délek a úhlů pro protokol / panel vlastností, čtení čísel a jednoduchých výrazů.
 */
import { tr } from "../i18n";
import type { DraftUnits, DraftVars, Vec2 } from "./model";

/** jednotky: kód INSUNITS (DXF $INSUNITS) a velikost v mm */
export const UNITS: Record<DraftUnits, { code: number; mm: number; label: string }> = {
  unitless: { code: 0, mm: 1, label: "—" },
  in: { code: 1, mm: 25.4, label: "in" },
  ft: { code: 2, mm: 304.8, label: "ft" },
  mi: { code: 3, mm: 1609344, label: "mi" },
  mm: { code: 4, mm: 1, label: "mm" },
  cm: { code: 5, mm: 10, label: "cm" },
  m: { code: 6, mm: 1000, label: "m" },
  km: { code: 7, mm: 1e6, label: "km" },
  yd: { code: 10, mm: 914.4, label: "yd" },
  um: { code: 13, mm: 0.001, label: "µm" },
};
export const unitsFromCode = (code: number): DraftUnits => (Object.entries(UNITS).find(([, u]) => u.code === code)?.[0] as DraftUnits | undefined) ?? "unitless";
export function parseUnits(t: string): DraftUnits | null {
  const s = t.trim().toLowerCase().replace("µ", "u");
  const map: Record<string, DraftUnits> = { mm: "mm", cm: "cm", m: "m", km: "km", in: "in", inch: "in", palce: "in", palec: "in", zoll: "in", ft: "ft", feet: "ft", stopy: "ft", fuss: "ft", yd: "yd", mi: "mi", um: "um", unitless: "unitless", bez: "unitless", ohne: "unitless", none: "unitless" };
  return map[s] ?? null;
}

const clampPrec = (p: number) => Math.max(0, Math.min(8, Math.round(p)));

/** délka podle LUPREC (desetinná tečka – jako AutoCAD; bez zbytečných nul se nezkracuje) */
export const fmtLen = (v: number, vars: Pick<DraftVars, "prec">) => fixed(v, clampPrec(vars.prec));
/** úhel [°] podle AUPREC */
export const fmtAng = (deg: number, vars: Pick<DraftVars, "aprec">) => `${fixed(deg, clampPrec(vars.aprec))}°`;
export const fmtPt = (p: Vec2, vars: Pick<DraftVars, "prec">) => `${fmtLen(p[0], vars)},${fmtLen(p[1], vars)}`;
function fixed(v: number, p: number) {
  const s = (Math.abs(v) < 0.5 * 10 ** -p ? 0 : v).toFixed(p);
  return s === "-0" || /^-0\.0*$/.test(s) ? s.slice(1) : s;
}

/** úhel do rozsahu [0, 360) */
export const normDeg = (a: number) => ((a % 360) + 360) % 360;

/**
 * Číslo nebo jednoduchý výraz (+ − × / závorky, „^“ mocnina, pi): „25“, „-3.5“, „100/3“, „2*(10+5)“. Desetinná tečka;
 * desetinnou čárku přijímá jen `allowComma` (pole, kde se nezadává bod x,y). Neplatné → NaN.
 */
export function evalNumber(raw: string, allowComma = false): number {
  let s = raw.trim().toLowerCase().replace(/[×x]/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  if (allowComma && /^[+-]?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  if (!s || /[^0-9.+\-*/()^ pie]/.test(s)) return NaN;
  let i = 0;
  const peek = () => s[i];
  const skip = () => {
    while (s[i] === " ") i++;
  };
  const num = (): number => {
    skip();
    if (s.startsWith("pi", i)) {
      i += 2;
      return Math.PI;
    }
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(s.slice(i));
    if (!m) throw new Error("num");
    i += m[0].length;
    return Number(m[0]);
  };
  const factor = (): number => {
    skip();
    if (peek() === "-") {
      i++;
      return -factor();
    }
    if (peek() === "+") {
      i++;
      return factor();
    }
    let v: number;
    if (peek() === "(") {
      i++;
      v = expr();
      skip();
      if (peek() !== ")") throw new Error(")");
      i++;
    } else v = num();
    skip();
    if (peek() === "^") {
      i++;
      v = v ** factor();
    }
    return v;
  };
  const term = (): number => {
    let v = factor();
    for (;;) {
      skip();
      const c = peek();
      if (c !== "*" && c !== "/") return v;
      i++;
      const r = factor();
      v = c === "*" ? v * r : v / r;
    }
  };
  const expr = (): number => {
    let v = term();
    for (;;) {
      skip();
      const c = peek();
      if (c !== "+" && c !== "-") return v;
      i++;
      const r = term();
      v = c === "+" ? v + r : v - r;
    }
  };
  try {
    const v = expr();
    skip();
    return i === s.length && Number.isFinite(v) ? v : NaN;
  } catch {
    return NaN;
  }
}

export const unitsLabel = (u: DraftUnits) => (u === "unitless" ? tr("bez jednotek") : UNITS[u].label);
