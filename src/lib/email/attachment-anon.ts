/**
 * Pošta → přílohy z dokumentů zakázky i původní přílohy přeposílaného e-mailu (čistá logika, testy
 * v attachment-anon.test.ts; přeposlání → anonymizace na požádání přes drawing_anon_adhoc): výkres zákazníka
 * smí ven v originále jen zákazníkovi té zakázky (jeho adresy / doména) nebo kolegům. Komukoli jinému
 * (dodavatel, kooperace) jde anonymizovaná kopie (src/lib/anonymize/share.ts); bez ní se příloha
 * zablokuje s českou hláškou — originál smí výslovně poslat jen super admin (audit).
 */

/** Veřejné poštovní domény — shoda domény nestačí, musí sedět celá adresa. */
export const FREEMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "seznam.cz", "email.cz", "post.cz", "centrum.cz", "atlas.cz", "volny.cz", "tiscali.cz", "quick.cz",
  "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "icloud.com", "me.com", "gmx.com", "gmx.net", "proton.me", "protonmail.com",
]);

function domainOf(address: string): string {
  return address.split("@")[1]?.trim().toLowerCase() ?? "";
}

export interface OriginalAudience {
  /** E-maily zákazníka zakázky (firma + kontakty). */
  customerEmails: readonly string[];
  /** Naše adresy (kolegové) a domény našich schránek. */
  internalEmails: readonly string[];
  internalDomains: readonly string[];
}

/** Smí výkres zákazníka jít všem adresátům v originále? (každý adresát = zákazník zakázky, nebo my) */
export function recipientsAllowOriginals(recipients: readonly string[], aud: OriginalAudience): boolean {
  const cust = new Set(aud.customerEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const custDomains = new Set([...cust].map(domainOf).filter((d) => d && !FREEMAIL_DOMAINS.has(d)));
  const internal = new Set(aud.internalEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const internalDomains = new Set(aud.internalDomains.map((d) => d.trim().toLowerCase()).filter((d) => d && !FREEMAIL_DOMAINS.has(d)));
  const list = recipients.map((r) => r.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return false;
  return list.every((r) => cust.has(r) || internal.has(r) || custDomains.has(domainOf(r)) || internalDomains.has(domainOf(r)));
}

/** Přípony, které anonymizuje samostatný nástroj (shodně s /api/drawings/anonymize/adhoc). */
export const ADHOC_ANON_EXT_RE = /\.(pdf|jpe?g|png|webp|gif|tiff?|heic|heif|dxf|stp|step|stl|igs|iges)$/i;

/** Kam smí samostatný nástroj uložit anonymizovanou kopii uživatele (anonymize/queue.ts subjectOf → outPrefix). */
export function adhocAnonPrefix(userId: string): string {
  return `capture/${userId}/anon/out/`;
}

/** Drobný vložený obrázek (logo, podpis) — stejná hranice jako kopírování příloh do zakázky. */
export const MIN_INLINE_IMAGE_BYTES = 15 * 1024;
export function isInlineImage(mime: string | null | undefined, size: number | null | undefined): boolean {
  return String(mime ?? "").toLowerCase().startsWith("image/") && (size ?? 0) > 0 && (size ?? 0) < MIN_INLINE_IMAGE_BYTES;
}

export type BlockReason ="pending" | "review" | "failed" | "unsupported" | "needs_confirm" | "excluded" | "forbidden";

/** Hláška do okna psaní pro zablokovaný výkres (co udělat). */
export function blockedAttachmentMessage(filename: string, reason: BlockReason, detail?: string, where: "job" | "mail" = "job"): string {
  switch (reason) {
    case "pending":
      return `„${filename}": Výkres ještě není anonymizovaný — počkej, až se dokončí (pár minut), nebo ho pošli bez něj.`;
    case "review":
      return where === "mail"
        ? `„${filename}": Anonymizace čeká na schválení — zkontroluj náhled v Poptávky → Anonymizovat výkres (Moje anonymizace) a anonymizovaný výkres přilož z počítače, nebo e-mail přiřaď k zakázce a schval ho v Dokumentech.`
        : `„${filename}": Anonymizace čeká na schválení — zkontroluj a schval ji v zakázce (Dokumenty → náhled), pak odešli.`;
    case "failed":
    case "unsupported":
      return `„${filename}": Nelze anonymizovat automaticky — ulož výkres jako PDF a ${where === "mail" ? "přilož ho z počítače" : "nahraj ho do zakázky znovu"}.${detail ? ` (${detail})` : ""}`;
    case "forbidden":
      return `„${filename}": Originál výkresu zákazníka smí poslat ven jen super admin.`;
    default:
      return `„${filename}": ${detail ?? "Soubor nejde poslat bez anonymizace."}`;
  }
}
