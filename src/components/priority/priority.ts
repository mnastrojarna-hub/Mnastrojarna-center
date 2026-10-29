/**
 * Priorita 1–5 (1 = nejvyšší) — sdílené pro poštu i Knihu zakázek. Barvy jako celé třídy Tailwindu (JIT).
 */

export type PriorityValue = 1 | 2 | 3 | 4 | 5;
export const PRIORITY_VALUES: PriorityValue[] = [1, 2, 3, 4, 5];

export interface PriorityStyle {
  value: PriorityValue;
  label: string;
  short: string;
  /** Plný štítek (vybraná hodnota). */
  solid: string;
  /** Jemný štítek (seznam). */
  soft: string;
  /** Tečka / pruh. */
  dot: string;
}

export const PRIORITY_STYLE: Record<PriorityValue, PriorityStyle> = {
  1: { value: 1, label: "Nejvyšší", short: "P1", solid: "bg-red-600 text-white border-red-600", soft: "border-red-300 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300", dot: "bg-red-600" },
  2: { value: 2, label: "Vysoká", short: "P2", solid: "bg-orange-500 text-white border-orange-500", soft: "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-500/40 dark:bg-orange-500/15 dark:text-orange-300", dot: "bg-orange-500" },
  3: { value: 3, label: "Normální", short: "P3", solid: "bg-sky-600 text-white border-sky-600", soft: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300", dot: "bg-sky-500" },
  4: { value: 4, label: "Nízká", short: "P4", solid: "bg-slate-500 text-white border-slate-500", soft: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-300", dot: "bg-slate-400" },
  5: { value: 5, label: "Nejnižší", short: "P5", solid: "bg-zinc-400 text-white border-zinc-400", soft: "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-600/40 dark:bg-zinc-500/10 dark:text-zinc-400", dot: "bg-zinc-300 dark:bg-zinc-600" },
};

export function isPriorityValue(v: unknown): v is PriorityValue {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;
}

/** Hodnota v rozsahu 1–5 (neplatná → 3). */
export function clampPriority(v: unknown): PriorityValue {
  const n = Math.round(Number(v));
  return (Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3) as PriorityValue;
}

export function priorityStyle(v: unknown): PriorityStyle {
  return PRIORITY_STYLE[clampPriority(v)];
}

/** Priorita z AI (vysoká / střední / nízká) → 1–5. */
export function priorityFromLevel(level: string | null | undefined): PriorityValue {
  return level === "vysoka" ? 2 : level === "nizka" ? 4 : 3;
}

/** Popis pro čtečky a tooltip („Priorita 1 – Nejvyšší (ručně, Jan)"). */
export function priorityTitle(v: unknown, opts: { manual?: boolean; by?: string | null } = {}): string {
  const s = priorityStyle(v);
  const src = opts.manual ? `ručně${opts.by ? `, ${opts.by}` : ""}` : "AI / pravidla";
  return `Priorita ${s.value} – ${s.label} (${src})`;
}
