/**
 * E-maily zákazníka / dodavatele podle účelu („kam co posílat") a výběr adresátů pro odeslání —
 * čistá logika (testy v roles.test.ts). Data: tabulka party_role_emails + kontaktní osoby.
 *
 * Pravidla výběru (rozhodnutí 30. 10.):
 *  - faktura → VŽDY fakturační e-mail (výchozí v Komu, další fakturační v Kopii) + kontakt zakázky v Kopii;
 *  - ostatní doklady → kontaktní osoba zakázky; když zakázka kontakt nemá → e-mail role
 *    (nabídka → Nabídky, potvrzení / dodací list → Nákup, objednávka dodavateli → Objednávky …);
 *  - bez role → běžná komunikace → e-mail firmy → hlavní kontakt → první kontakt s e-mailem.
 */

export type ContactRole = "nabidky" | "nakup" | "fakturace" | "komunikace";
export type PartyKind = "customer" | "supplier";

export const CONTACT_ROLES: ContactRole[] = ["nabidky", "nakup", "fakturace", "komunikace"];

export function isContactRole(v: unknown): v is ContactRole {
  return typeof v === "string" && (CONTACT_ROLES as string[]).includes(v);
}

export const ROLE_TEXT: Record<PartyKind, Record<ContactRole, { label: string; hint: string; reason: string }>> = {
  customer: {
    nabidky: { label: "Nabídky", hint: "poptávky a naše nabídky", reason: "E-mail zákazníka pro nabídky" },
    nakup: { label: "Nákup / objednávky", hint: "potvrzení objednávky, dodací listy", reason: "Nákupní e-mail zákazníka (objednávky)" },
    fakturace: { label: "Fakturace", hint: "faktury a platby", reason: "Fakturační e-mail zákazníka" },
    komunikace: { label: "Běžná komunikace", hint: "ostatní pošta", reason: "Běžný e-mail zákazníka" },
  },
  supplier: {
    nabidky: { label: "Poptávky (RFQ)", hint: "naše poptávky a jejich nabídky", reason: "E-mail dodavatele pro poptávky" },
    nakup: { label: "Objednávky", hint: "naše objednávky, změny a storna", reason: "E-mail dodavatele pro objednávky" },
    fakturace: { label: "Fakturace", hint: "jejich faktury, upomínky", reason: "Fakturační e-mail dodavatele" },
    komunikace: { label: "Běžná komunikace", hint: "ostatní pošta", reason: "Běžný e-mail dodavatele" },
  },
};

/** Účel odesílané pošty. */
export type SendPurpose =
  | "nabidka" | "potvrzeni" | "dodaci_list" | "faktura" | "ostatni" | "komunikace"
  | "objednavka_dodavateli" | "poptavka_dodavateli";

export const PURPOSE_ROLE: Record<SendPurpose, ContactRole> = {
  nabidka: "nabidky",
  potvrzeni: "nakup",
  dodaci_list: "nakup",
  faktura: "fakturace",
  ostatni: "komunikace",
  komunikace: "komunikace",
  objednavka_dodavateli: "nakup",
  poptavka_dodavateli: "nabidky",
};

export interface RoleEntry {
  id: string;
  role: ContactRole;
  /** Výsledná adresa (z kontaktní osoby, nebo samotná adresa). */
  email: string | null;
  contactId: string | null;
  contactName: string | null;
  contactPosition: string | null;
  isDefault: boolean;
  source: "manual" | "ai" | "migrace";
}

export interface BookContact {
  id: string;
  name: string;
  email: string | null;
  position: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface PartyAddressBook {
  kind: PartyKind;
  roles: RoleEntry[];
  contacts: BookContact[];
  /** E-mail firmy (customers.email / suppliers.email). */
  partyEmail: string | null;
}

export interface RecipientPick {
  to: string[];
  cc: string[];
  /** Proč zrovna tahle adresa („Fakturační e-mail zákazníka") — ukáže se v dialogu odeslání. */
  reason: string;
  source: "job_contact" | "role" | "fallback_role" | "primary_contact" | "contact" | "party_email" | "none";
  role: ContactRole;
}

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]{2,}$/;

export function normEmail(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  const m = /<([^<>]+)>\s*$/.exec(s);
  const a = (m ? m[1] : s).trim();
  return EMAIL_RE.test(a) ? a : null;
}

/** Adresy role: výchozí první, pak ostatní (bez duplicit, jen platné). */
export function roleAddresses(book: PartyAddressBook, role: ContactRole): { email: string; entry: RoleEntry }[] {
  const out: { email: string; entry: RoleEntry }[] = [];
  const list = book.roles.filter((r) => r.role === role).sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  for (const r of list) {
    const e = normEmail(r.email);
    if (e && !out.some((o) => o.email === e)) out.push({ email: e, entry: r });
  }
  return out;
}

function uniq(list: (string | null | undefined)[], exclude: string[] = []): string[] {
  const out: string[] = [];
  for (const v of list) {
    const e = normEmail(v);
    if (e && !out.includes(e) && !exclude.includes(e)) out.push(e);
  }
  return out;
}

function personLabel(entry: RoleEntry): string {
  return entry.contactName ? ` (${entry.contactName})` : "";
}

/** Výběr Komu / Kopie a důvodu pro odeslání dokladu nebo zprávy. */
export function pickRecipients(
  purpose: SendPurpose,
  book: PartyAddressBook | null,
  jobContact?: { email?: string | null; name?: string | null } | null,
): RecipientPick {
  const role = PURPOSE_ROLE[purpose];
  const kind = book?.kind ?? "customer";
  const text = ROLE_TEXT[kind];
  const jc = normEmail(jobContact?.email);
  const jcName = (jobContact?.name ?? "").trim();
  const roleList = book ? roleAddresses(book, role) : [];

  if (purpose === "faktura" && roleList.length) {
    const to = [roleList[0].email];
    const cc = uniq([...roleList.slice(1).map((r) => r.email), jc], to);
    const ccNote = jc && cc.includes(jc) ? " · v kopii kontakt zakázky" : cc.length ? " · další fakturační v kopii" : "";
    return { to, cc, reason: `${text.fakturace.reason}${personLabel(roleList[0].entry)}${ccNote}`, source: "role", role };
  }
  if (jc) {
    return { to: [jc], cc: [], reason: `Kontaktní osoba zakázky${jcName ? ` (${jcName})` : ""}`, source: "job_contact", role };
  }
  if (roleList.length) {
    const to = [roleList[0].email];
    const cc = uniq(roleList.slice(1).map((r) => r.email), to);
    return { to, cc, reason: `${text[role].reason}${personLabel(roleList[0].entry)}${cc.length ? " · další v kopii" : ""}`, source: "role", role };
  }
  if (!book) return { to: [], cc: [], reason: "", source: "none", role };
  if (role !== "komunikace") {
    const general = roleAddresses(book, "komunikace");
    if (general.length) {
      return { to: [general[0].email], cc: [], reason: `${text.komunikace.reason}${personLabel(general[0].entry)} — ${text[role].label.toLowerCase()} nemá vlastní e-mail`, source: "fallback_role", role };
    }
  }
  const party = normEmail(book.partyEmail);
  if (party) return { to: [party], cc: [], reason: kind === "supplier" ? "E-mail dodavatele" : "E-mail zákazníka", source: "party_email", role };
  const primary = book.contacts.find((c) => c.isPrimary && normEmail(c.email));
  if (primary) return { to: [normEmail(primary.email)!], cc: [], reason: `Hlavní kontakt (${primary.name})`, source: "primary_contact", role };
  const any = book.contacts.find((c) => normEmail(c.email));
  if (any) return { to: [normEmail(any.email)!], cc: [], reason: `Kontaktní osoba (${any.name})`, source: "contact", role };
  return { to: [], cc: [], reason: "", source: "none", role };
}

/** Řádek DB (s embedem kontaktu) → RoleEntry. */
export function roleEntryFromRow(row: {
  id: string; role: string; email?: string | null; is_default?: boolean | null; source?: string | null;
  contact_id?: string | null; supplier_contact_id?: string | null;
  contact?: { name?: string | null; email?: string | null; position?: string | null } | { name?: string | null; email?: string | null; position?: string | null }[] | null;
}): RoleEntry | null {
  if (!isContactRole(row.role)) return null;
  const c = Array.isArray(row.contact) ? row.contact[0] ?? null : row.contact ?? null;
  const contactId = row.contact_id ?? row.supplier_contact_id ?? null;
  return {
    id: row.id,
    role: row.role,
    email: contactId ? normEmail(c?.email) : normEmail(row.email),
    contactId,
    contactName: contactId ? (c?.name ?? "").trim() || null : null,
    contactPosition: contactId ? (c?.position ?? "").trim() || null : null,
    isDefault: Boolean(row.is_default),
    source: row.source === "ai" ? "ai" : row.source === "migrace" ? "migrace" : "manual",
  };
}
