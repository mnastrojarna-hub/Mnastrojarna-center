/** Pružiny – drobné čisté pomocníky (čtení dat prvku, formát řádků). */
import type { CalcRow, Issue, SpringData } from "./types";
import { fmt } from "./types";

/** číslo z dat (číslo nebo text s desetinnou čárkou); nezadané / neplatné = undefined */
export function numOf(d: SpringData, key: string): number | undefined {
  const v = d[key];
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
/** kladné číslo z dat, jinak undefined (0 = nezadáno) */
export const posOf = (d: SpringData, key: string): number | undefined => {
  const n = numOf(d, key);
  return n !== undefined && n > 0 ? n : undefined;
};
export const strOf = (d: SpringData, key: string, def: string): string => (typeof d[key] === "string" && d[key] !== "" ? String(d[key]) : def);
export const boolOf = (d: SpringData, key: string, def = false): boolean => (typeof d[key] === "boolean" ? (d[key] as boolean) : def);

/** sběr hlášek */
export class Issues {
  list: Issue[] = [];
  err(text: string, key?: string) {
    this.list.push({ level: "error", text, ...(key ? { key } : {}) });
  }
  warn(text: string, key?: string) {
    this.list.push({ level: "warn", text, ...(key ? { key } : {}) });
  }
  info(text: string, key?: string) {
    this.list.push({ level: "info", text, ...(key ? { key } : {}) });
  }
  get ok() {
    return !this.list.some((i) => i.level === "error");
  }
}

/** spočtený řádek s číslem a jednotkou */
export function row(key: string, label: string, value: number | undefined, unit = "", o: { symbol?: string; dec?: number; level?: CalcRow["level"]; drawing?: boolean; text?: string } = {}): CalcRow {
  const text = o.text ?? (value === undefined ? "–" : `${fmt(value, o.dec ?? 2)}${unit ? ` ${unit}` : ""}`);
  return { key, label, text, ...(value !== undefined ? { value } : {}), ...(unit ? { unit } : {}), ...(o.symbol ? { symbol: o.symbol } : {}), ...(o.level ? { level: o.level } : {}), ...(o.drawing ? { drawing: true } : {}) };
}
/** procento z hodnoty (do textu hlášek) */
export const pct = (a: number, b: number) => Math.round((a / b) * 100);
