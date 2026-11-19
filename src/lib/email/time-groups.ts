/**
 * Pošta jako Outlook (majitel 16. 11.): skupiny podle času a krátký datum / čas v řádku.
 * Dny podle pražského času; týden začíná pondělím.
 */
export type MailTimeGroup = "today" | "yesterday" | "thisWeek" | "lastWeek" | "older";

export const MAIL_TIME_GROUP_LABEL: Record<MailTimeGroup, string> = {
  today: "Dnes", yesterday: "Včera", thisWeek: "Tento týden", lastWeek: "Minulý týden", older: "Starší",
};

const TZ = "Europe/Prague";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** Den v Praze jako počet dní od epochy (porovnávání bez časových pásem). */
function pragueDayNo(d: Date): number {
  const [y, m, day] = dayFmt.format(d).split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, day) / 86_400_000);
}

export function mailTimeGroup(value: string | Date, now: Date = new Date()): MailTimeGroup {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "older";
  const a = pragueDayNo(d);
  const t = pragueDayNo(now);
  if (a >= t) return "today";
  if (a === t - 1) return "yesterday";
  // pondělí tohoto týdne (1970-01-01 byl čtvrtek → (t + 3) % 7 = dny od pondělí)
  const monday = t - ((t + 3) % 7);
  if (a >= monday) return "thisWeek";
  if (a >= monday - 7) return "lastWeek";
  return "older";
}

const timeFmt = new Intl.DateTimeFormat("cs-CZ", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const wdFmt = new Intl.DateTimeFormat("cs-CZ", { timeZone: TZ, weekday: "short" });
const dateFmt = new Intl.DateTimeFormat("cs-CZ", { timeZone: TZ, day: "numeric", month: "numeric" });
const fullFmt = new Intl.DateTimeFormat("cs-CZ", { timeZone: TZ, day: "numeric", month: "numeric", year: "numeric" });

/** Dnes „14:05", tento a minulý týden „po 14:05", letos „12. 11.", dřív „12. 11. 2025". */
export function mailRowTime(value: string | Date, now: Date = new Date()): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const g = mailTimeGroup(d, now);
  if (g === "today") return timeFmt.format(d);
  if (g === "yesterday") return `včera ${timeFmt.format(d)}`;
  if (g === "thisWeek" || g === "lastWeek") return `${wdFmt.format(d)} ${dateFmt.format(d)}`;
  const sameYear = new Intl.DateTimeFormat("en", { timeZone: TZ, year: "numeric" });
  return sameYear.format(d) === sameYear.format(now) ? dateFmt.format(d) : fullFmt.format(d);
}
