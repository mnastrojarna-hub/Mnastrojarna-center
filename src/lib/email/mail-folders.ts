/**
 * Složky na IMAP serveru — čistá logika (testy v mail-folders.test.ts).
 *
 * Odeslaná pošta: přednostně složka se SPECIAL-USE \Sent (RFC 6154 — Dovecot u hosting90, Gmail,
 * Exchange), jinak podle jména v tomto pořadí: Sent, INBOX.Sent, Odeslaná pošta, Sent Items (a jejich
 * obdoby pod INBOX. / INBOX/). Nenalezeno → kopie se neuloží (odeslání tím neselže, jen se to hlásí).
 */

export interface FolderInfo {
  path: string;
  /** imapflow: „\\Sent" apod. */
  specialUse?: string | null;
  /** Příznaky z LIST (\\Sent, \\Noselect, …). */
  flags?: Iterable<string> | null;
  /** Oddělovač úrovní („." nebo „/"). */
  delimiter?: string | null;
}

export const SENT_FOLDER_FALLBACKS = ["Sent", "INBOX.Sent", "Odeslaná pošta", "Sent Items"] as const;

/** Další běžná jména (cs/en/de) — porovnává se poslední úroveň cesty bez diakritiky. */
const SENT_NAMES = ["sent", "sent items", "sent messages", "sent mail", "odeslana posta", "odeslane", "odeslane polozky", "gesendet", "gesendete objekte"];

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function lastSegment(f: FolderInfo): string {
  const d = f.delimiter || (f.path.includes("/") && !f.path.includes(".") ? "/" : ".");
  const parts = f.path.split(d);
  return parts[parts.length - 1] ?? f.path;
}

function flagSet(f: FolderInfo): Set<string> {
  const out = new Set<string>();
  for (const x of f.flags ?? []) out.add(String(x).toLowerCase());
  if (f.specialUse) out.add(String(f.specialUse).toLowerCase());
  return out;
}

/** Najde složku odeslané pošty, nebo null. */
export function findSentFolder(list: readonly FolderInfo[]): FolderInfo | null {
  const selectable = list.filter((f) => !flagSet(f).has("\\noselect") && !flagSet(f).has("\\nonexistent"));
  const special = selectable.find((f) => flagSet(f).has("\\sent"));
  if (special) return special;
  for (const name of SENT_FOLDER_FALLBACKS) {
    const hit = selectable.find((f) => f.path === name) ?? selectable.find((f) => fold(f.path) === fold(name));
    if (hit) return hit;
  }
  return selectable.find((f) => SENT_NAMES.includes(fold(lastSegment(f)))) ?? null;
}

/** Popis výsledku uložení kopie do Odeslaných (pro UI). */
export function sentCopyLabel(state: "ok" | "failed" | "skipped" | null | undefined, error?: string | null): string {
  if (state === "ok") return "Kopie uložena do Odeslaných na serveru.";
  if (state === "failed") return `Kopii do Odeslaných na serveru se nepodařilo uložit${error ? ` (${error})` : ""} — e-mail ale odešel.`;
  if (state === "skipped") return error ? `Kopie do Odeslaných na serveru se neukládá: ${error}` : "Kopie do Odeslaných na serveru se neukládá (schránka bez IMAP).";
  return "";
}
