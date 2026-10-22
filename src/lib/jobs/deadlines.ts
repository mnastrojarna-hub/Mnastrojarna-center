import type { JobStage } from "@/lib/supabase/database.types";
import { CLOSED_STAGES, DELIVERED_STAGES } from "@/lib/jobs/stages";

/**
 * Hlídání termínů zakázky. Rozhodující termín = potvrzený zákazníkovi (due_date),
 * jinak požadovaný zákazníkem. Maximální tolerovaný termín = poslední záchrana.
 */

export type DeadlineState =
  | "none"      // bez termínu
  | "done"      // dodáno / uzavřeno — termín už se nehlídá
  | "ok"        // v pohodě (víc než 7 dní)
  | "soon"      // do 7 dní
  | "today"     // dnes
  | "overdue"   // po termínu, ale do max. tolerovaného
  | "critical"; // po maximálním tolerovaném termínu (nebo po termínu bez tolerance > 7 dní)

export interface DeadlineInput {
  stage: JobStage;
  dueDate: string | null;
  customerRequiredDate: string | null;
  maxToleratedDate: string | null;
  supplierPromisedDate?: string | null;
}

export interface DeadlineInfo {
  state: DeadlineState;
  /** Rozhodující termín (RRRR-MM-DD) nebo null. */
  date: string | null;
  /** Dní do termínu (záporné = po termínu). */
  daysLeft: number | null;
  /** Dodavatel slíbil později, než jsme slíbili zákazníkovi. */
  supplierRisk: boolean;
  label: string;
}

const DAY = 86_400_000;

/** Den jako číslo (UTC půlnoc) — porovnání bez vlivu časových pásem. */
export function dayNumber(value: string | Date): number {
  if (typeof value === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY);
  }
  const d = new Date(value);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

export function effectiveDeadline(j: DeadlineInput): string | null {
  return j.dueDate || j.customerRequiredDate || null;
}

export function deadlineInfo(j: DeadlineInput, today: Date = new Date()): DeadlineInfo {
  const date = effectiveDeadline(j);
  const supplierRisk = Boolean(
    date && j.supplierPromisedDate && dayNumber(j.supplierPromisedDate) > dayNumber(date) &&
    !DELIVERED_STAGES.includes(j.stage) && !CLOSED_STAGES.includes(j.stage),
  );

  if (DELIVERED_STAGES.includes(j.stage) || CLOSED_STAGES.includes(j.stage)) {
    return { state: date ? "done" : "none", date, daysLeft: null, supplierRisk: false, label: date ? "splněno" : "—" };
  }
  if (!date) return { state: "none", date: null, daysLeft: null, supplierRisk, label: "bez termínu" };

  const now = dayNumber(today);
  const daysLeft = dayNumber(date) - now;
  let state: DeadlineState;
  if (daysLeft > 7) state = "ok";
  else if (daysLeft > 0) state = "soon";
  else if (daysLeft === 0) state = "today";
  else {
    const maxDate = j.maxToleratedDate ? dayNumber(j.maxToleratedDate) : null;
    if (maxDate !== null) state = now > maxDate ? "critical" : "overdue";
    else state = daysLeft < -7 ? "critical" : "overdue";
  }

  const label =
    state === "today" ? "dnes" :
    daysLeft > 0 ? `za ${daysLeft} ${plural(daysLeft, "den", "dny", "dní")}` :
    `${-daysLeft} ${plural(-daysLeft, "den", "dny", "dní")} po termínu`;

  return { state, date, daysLeft, supplierRisk, label };
}

export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}

/** Barvy stavu termínu (odznak). */
export const DEADLINE_STYLE: Record<DeadlineState, string> = {
  none: "text-muted-foreground",
  done: "text-muted-foreground",
  ok: "text-foreground",
  soon: "text-amber-700 dark:text-amber-400 font-medium",
  today: "text-orange-600 dark:text-orange-400 font-semibold",
  overdue: "text-red-600 dark:text-red-400 font-semibold",
  critical: "text-red-700 dark:text-red-300 font-bold",
};

export const DEADLINE_BADGE: Record<DeadlineState, string> = {
  none: "bg-muted text-muted-foreground",
  done: "bg-muted text-muted-foreground",
  ok: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  soon: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  today: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  overdue: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  critical: "bg-red-600 text-white",
};
