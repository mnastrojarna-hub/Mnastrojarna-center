/**
 * Párování e-mailové adresy na zákazníka / dodavatele (čistá logika, testovatelná).
 * 1) přesná shoda adresy, 2) shoda firemní domény (freemaily se na doménu nepárují).
 */

export interface PartyRef {
  id: string;
  email: string | null;
}

/** Veřejné (freemail) domény — shoda domény u nich nic neznamená. */
export const FREEMAIL_DOMAINS = new Set([
  "gmail.com", "seznam.cz", "email.cz", "centrum.cz", "atlas.cz", "post.cz",
  "outlook.com", "hotmail.com", "live.com", "icloud.com", "yahoo.com", "proton.me",
]);

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

/** Najde stranu (zákazník/dodavatel) podle adresy odesílatele. */
export function matchPartyByEmail(fromEmail: string, parties: PartyRef[]): string | undefined {
  const from = fromEmail.trim().toLowerCase();
  if (!from) return undefined;

  // 1) přesná shoda
  for (const p of parties) {
    if (p.email && p.email.trim().toLowerCase() === from) return p.id;
  }

  // 2) shoda firemní domény
  const domain = emailDomain(from);
  if (!domain || FREEMAIL_DOMAINS.has(domain)) return undefined;
  for (const p of parties) {
    if (!p.email) continue;
    const pd = emailDomain(p.email.trim().toLowerCase());
    if (pd && pd === domain) return p.id;
  }
  return undefined;
}
