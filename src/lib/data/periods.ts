// Čistá logika období (testovatelná bez serveru).

export type CommissionPeriod = "month" | "quarter" | "year";

/** První den období (měsíc / kvartál / rok) — pro filtraci provizí. */
export function periodStart(period: CommissionPeriod, now = new Date()): string {
  const y = now.getFullYear();
  const month =
    period === "year" ? 0 : period === "quarter" ? Math.floor(now.getMonth() / 3) * 3 : now.getMonth();
  return `${y}-${String(month + 1).padStart(2, "0")}-01`;
}
