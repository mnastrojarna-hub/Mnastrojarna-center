import { shortPersonName } from "@/lib/jobs/flow-status";

/** Texty schvalování nabídek (#25, §13) — sdílí detail zakázky, AI přehled i /quotes. */

function quoteName(number: string | null | undefined): string {
  return number?.trim() ? `Nabídka ${number.trim()}` : "Nabídka";
}

/** „Nabídka {č.} schválena — {autor} ji teď může odeslat.“ (autor = schvalující → „můžeš ji odeslat“). */
export function approvedToast(
  number: string | null | undefined,
  author: string | null | undefined,
  self?: { authorId?: string | null; userId?: string | null },
): string {
  if (self?.authorId && self.authorId === self.userId) return `${quoteName(number)} schválena — můžeš ji odeslat.`;
  return `${quoteName(number)} schválena — ${author?.trim() || "autor"} ji teď může odeslat.`;
}

/** „Nabídka {č.} vrácena — {autor} ji uvidí v Nabídkách.“ */
export function returnedToast(number: string | null | undefined, author: string | null | undefined): string {
  return `${quoteName(number)} vrácena — ${author?.trim() || "autor"} ji uvidí v Nabídkách.`;
}

/** Shoda slovesa s počtem: 1 „čeká“, 2–4 „čekají“, 0 a 5+ „čeká“. */
export function czWaits(n: number): "čeká" | "čekají" {
  return n >= 2 && n <= 4 ? "čekají" : "čeká";
}

const CZ_DAY = new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric", year: "numeric" });

/** „— J. Semorád · 23. 10. 2026“ za štítkem vrácené nabídky. */
export function returnedSuffix(by: string | null | undefined, at: string | null | undefined): string | null {
  const parts: string[] = [];
  if (by?.trim()) parts.push(shortPersonName(by));
  const d = at ? new Date(at) : null;
  if (d && !isNaN(d.getTime())) parts.push(CZ_DAY.format(d).replace(/\s+/g, " "));
  return parts.length ? `— ${parts.join(" · ")}` : null;
}
