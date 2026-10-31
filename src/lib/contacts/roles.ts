/**
 * E-maily zákazníka / dodavatele podle účelu („kam co posílat") a výběr adresátů pro odeslání —
 * čistá logika (testy v roles.test.ts). Data: tabulka party_role_emails + kontaktní osoby.
 *
 * Pravidla výběru (rozhodnutí 30. 10., dodací listy 31. 10.):
 *  - faktura → VŽDY fakturační e-mail (výchozí v Komu, další fakturační v Kopii) + kontakt zakázky v Kopii;
 *  - dodací list → e-mail pro dodací listy → Objednávky / potvrzení (nákup) → kontakt zakázky → běžná komunikace…;
 *  - ostatní doklady → kontaktní osoba zakázky; když zakázka kontakt nemá → e-mail role
 *    (nabídka → Nabídky, potvrzení → Objednávky / potvrzení, objednávka dodavateli → Objednávky …);
 *  - bez role → běžná komunikace → e-mail firmy → hlavní kontakt → první kontakt s e-mailem.
 */

export type ContactRole = "nabidky" | "nakup" | "dodaci_listy" | "fakturace" | "komunikace";
export type PartyKind = "customer" | "supplier";

export const CONTACT_ROLES: ContactRole[] = ["fakturace", "dodaci_listy", "nabidky", "nakup", "komunikace"];

/** Účely, které se u daného druhu firmy nastavují (a v tomto pořadí ukazují). Dodavatelům DL neposíláme. */
export const ROLES_FOR: Record<PartyKind, ContactRole[]> = {
  customer: ["fakturace", "dodaci_listy", "nabidky", "nakup", "komunikace"],
  supplier: ["nabidky", "nakup", "fakturace", "komunikace"],
};

export function isContactRole(v: unknown): v is ContactRole {
  return typeof v === "string" && (CONTACT_ROLES as string[]).includes(v);
}

export const ROLE_TEXT: Record<PartyKind, Record<ContactRole, { label: string; hint: string; reason: string }>> = {
  customer: {
    fakturace: { label: "Faktury", hint: "faktury, platby, upomínky", reason: "Fakturační e-mail zákazníka" },
    dodaci_listy: { label: "Dodací listy", hint: "dodací listy při expedici", reason: "E-mail pro dodací listy" },
    nabidky: { label: "Nabídky", hint: "poptávky a naše nabídky", reason: "E-mail zákazníka pro nabídky" },
    nakup: { label: "Objednávky / potvrzení", hint: "potvrzení objednávek, změny termínů", reason: "Nákupní e-mail zákazníka (objednávky)" },
    komunikace: { label: "Běžná komunikace", hint: "ostatní pošta", reason: "Běžný e-mail zákazníka" },
  },
  supplier: {
    nabidky: { label: "Poptávky (RFQ)", hint: "naše poptávky a jejich nabídky", reason: "E-mail dodavatele pro poptávky" },
    nakup: { label: "Objednávky", hint: "naše objednávky, změny a storna", reason: "E-mail dodavatele pro objednávky" },
    dodaci_listy: { label: "Dodací listy", hint: "dodací listy k materiálu do kooperace", reason: "E-mail dodavatele pro dodací listy" },
    fakturace: { label: "Faktury", hint: "jejich faktury, upomínky", reason: "Fakturační e-mail dodavatele" },
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
  dodaci_list: "dodaci_listy",
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
  /** V DB chybí tabulky kontaktů / účelů (migrace 20261030170000 neproběhla) — UI ukáže srozumitelnou zprávu. */
  schemaMissing?: boolean;
}

/** Hláška pro chybějící tabulky kontaktů / účelů (DB bez migrace 20261030170000_kontakty_role_tykani). */
export const CONTACTS_SCHEMA_MISSING =
  "E-maily podle účelu a kontakty dodavatelů zatím nejdou uložit — v databázi chybí aktualizace " +
  "(migrace 20261030170000_kontakty_role_tykani). Odesílání funguje dál podle kontaktu zakázky a e-mailu firmy.";

/** Chyba Supabase = chybějící tabulka / vazba / funkce (neaplikovaná migrace). */
export function isMissingSchemaError(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  if (err.code && ["42P01", "42883", "PGRST200", "PGRST202", "PGRST205"].includes(err.code)) return true;
  return /does not exist|could not find the (table|function|relationship)|schema cache/i.test(err.message ?? "");
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
  // dodací list: e-mail pro dodací listy → Objednávky / potvrzení → (dál jako ostatní) kontakt zakázky → běžná komunikace…
  if (purpose === "dodaci_list" && book) {
    if (roleList.length) {
      const to = [roleList[0].email];
      const cc = uniq(roleList.slice(1).map((r) => r.email), to);
      return { to, cc, reason: `${text.dodaci_listy.reason}${personLabel(roleList[0].entry)}${cc.length ? " · další v kopii" : ""}`, source: "role", role };
    }
    const buy = roleAddresses(book, "nakup");
    if (buy.length) {
      const to = [buy[0].email];
      const cc = uniq(buy.slice(1).map((r) => r.email), to);
      return { to, cc, reason: `${text.nakup.reason}${personLabel(buy[0].entry)} — dodací listy nemají vlastní e-mail`, source: "fallback_role", role };
    }
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
      return { to: [general[0].email], cc: [], reason: `${text.komunikace.reason}${personLabel(general[0].entry)} — pro „${text[role].label}“ není nastavený vlastní e-mail`, source: "fallback_role", role };
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
