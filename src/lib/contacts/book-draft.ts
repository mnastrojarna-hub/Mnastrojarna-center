import {
  ROLES_FOR, ROLE_TEXT, normEmail,
  type BookContact, type ContactRole, type PartyKind, type RoleEntry,
} from "@/lib/contacts/roles";
import { validateContactForm } from "@/components/customers/model";

/**
 * Rozpracovaný adresář firmy v dialogu „Upravit zákazníka / dodavatele" — kontaktní osoby a „Kam posílat"
 * (e-maily podle účelu) se upravují na místě a uloží se až tlačítkem dialogu, najednou (save_party_book).
 * Čistá logika (testy v book-draft.test.ts): operace nad konceptem, kontrola a převod na vstup akce.
 *
 * Klíče: uložená osoba / položka má key = id z DB, nová dostane dočasný klíč „n…". Položka účelu ukazuje
 * na osobu klíčem (contactKey) — i na osobu, která se teprve uloží.
 */

export interface DraftContact {
  key: string;
  id: string | null;
  name: string;
  position: string;
  email: string;
  phone: string;
  isPrimary: boolean;
}

export interface DraftRole {
  key: string;
  id: string | null;
  role: ContactRole;
  /** Kontaktní osoba (klíč DraftContact) — nebo samotná adresa `email`. */
  contactKey: string | null;
  email: string | null;
  isDefault: boolean;
  source: RoleEntry["source"];
}

export interface BookDraft {
  contacts: DraftContact[];
  roles: DraftRole[];
  /** Id uložených osob / položek při načtení — smaže se jen to, co uživatel odebral (ne co mezitím přidala AI). */
  knownContactIds: string[];
  knownRoleIds: string[];
}

/** Vstup akce (createCustomer / updateCustomer / … s adresářem) → DB funkce save_party_book. */
export interface PartyBookInput {
  contacts: { key: string; id: string | null; name: string; position: string | null; email: string | null; phone: string | null; isPrimary: boolean }[];
  roles: { id: string | null; role: ContactRole; contactKey: string | null; email: string | null; isDefault: boolean }[];
  knownContactIds: string[];
  knownRoleIds: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const KEY_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_ROWS = 200;

let seq = 0;
/** Dočasný klíč nové osoby / položky. */
export function newDraftKey(): string {
  seq += 1;
  return `n${Date.now().toString(36)}${seq}`;
}

export function emptyDraftContact(isPrimary = false): DraftContact {
  return { key: newDraftKey(), id: null, name: "", position: "", email: "", phone: "", isPrimary };
}

export function emptyBookDraft(blankRow = true): BookDraft {
  return { contacts: blankRow ? [emptyDraftContact(true)] : [], roles: [], knownContactIds: [], knownRoleIds: [] };
}

/** Uložený adresář → koncept (hlavní kontakt první). Bez kontaktů s `blankRow` jeden prázdný řádek. */
export function draftFromBook(book: { contacts: BookContact[]; roles: RoleEntry[] } | null, blankRow = true): BookDraft {
  if (!book) return emptyBookDraft(blankRow);
  const contacts = [...book.contacts]
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
    .map<DraftContact>((c) => ({
      key: c.id, id: c.id, name: c.name ?? "", position: c.position ?? "", email: c.email ?? "", phone: c.phone ?? "", isPrimary: c.isPrimary,
    }));
  const roles = book.roles.map<DraftRole>((r) => ({
    key: r.id, id: r.id, role: r.role, contactKey: r.contactId, email: r.contactId ? null : r.email, isDefault: r.isDefault, source: r.source,
  }));
  return {
    contacts: contacts.length || !blankRow ? contacts : [emptyDraftContact(true)],
    roles,
    knownContactIds: book.contacts.map((c) => c.id),
    knownRoleIds: book.roles.map((r) => r.id),
  };
}

const isBlank = (c: DraftContact) => !c.name.trim() && !c.position.trim() && !c.email.trim() && !c.phone.trim();

/** Osoby k výběru do účelu (jen s platným e-mailem; id = klíč konceptu). */
export function draftPickableContacts(d: BookDraft): BookContact[] {
  const out: BookContact[] = [];
  for (const c of d.contacts) {
    const email = normEmail(c.email);
    if (!email) continue;
    out.push({ id: c.key, name: c.name.trim() || email, email, position: c.position.trim() || null, phone: c.phone.trim() || null, isPrimary: c.isPrimary });
  }
  return out;
}

/** Položky účelů pro zobrazení (stejný tvar jako uložené — RoleEmailsView), jméno a adresa živě z konceptu osoby. */
export function draftRoleEntries(d: BookDraft): RoleEntry[] {
  return d.roles.map((r) => {
    const c = r.contactKey ? d.contacts.find((x) => x.key === r.contactKey) : undefined;
    return {
      id: r.key,
      role: r.role,
      email: r.contactKey ? normEmail(c?.email) : normEmail(r.email),
      contactId: r.contactKey,
      contactName: r.contactKey ? (c?.name.trim() || null) : null,
      contactPosition: r.contactKey ? (c?.position.trim() || null) : null,
      isDefault: r.isDefault,
      source: r.source,
    };
  });
}

/** Po odebrání / změně: v každém účelu, kde něco je, právě jedna výchozí (první). */
function fixDefaults(roles: DraftRole[]): DraftRole[] {
  const seen = new Set<ContactRole>();
  const hasDefault = new Set(roles.filter((r) => r.isDefault).map((r) => r.role));
  return roles.map((r) => {
    if (r.isDefault) {
      if (seen.has(r.role)) return { ...r, isDefault: false };
      seen.add(r.role);
      return r;
    }
    if (!hasDefault.has(r.role) && !seen.has(r.role)) {
      seen.add(r.role);
      return { ...r, isDefault: true };
    }
    return r;
  });
}

// ── Operace nad konceptem ───────────────────────────────────
export function draftAddContact(d: BookDraft): { draft: BookDraft; key: string } {
  const c = emptyDraftContact(!d.contacts.some((x) => x.isPrimary));
  return { draft: { ...d, contacts: [...d.contacts, c] }, key: c.key };
}

export function draftUpdateContact(d: BookDraft, key: string, patch: Partial<Omit<DraftContact, "key" | "id">>): BookDraft {
  return { ...d, contacts: d.contacts.map((c) => (c.key === key ? { ...c, ...patch } : c)) };
}

/** Hlavní kontakt je jen jeden; druhé klepnutí na hlavního ho zruší. */
export function draftTogglePrimary(d: BookDraft, key: string): BookDraft {
  const wasPrimary = d.contacts.find((c) => c.key === key)?.isPrimary ?? false;
  return { ...d, contacts: d.contacts.map((c) => ({ ...c, isPrimary: c.key === key ? !wasPrimary : false })) };
}

/** Odebere osobu i její položky v účelech; hlavním se stane další osoba. */
export function draftRemoveContact(d: BookDraft, key: string): BookDraft {
  const removed = d.contacts.find((c) => c.key === key);
  let contacts = d.contacts.filter((c) => c.key !== key);
  if (removed?.isPrimary && contacts.length && !contacts.some((c) => c.isPrimary)) {
    contacts = contacts.map((c, i) => (i === 0 ? { ...c, isPrimary: true } : c));
  }
  return { ...d, contacts, roles: fixDefaults(d.roles.filter((r) => r.contactKey !== key)) };
}

export function draftAddRole(
  d: BookDraft, role: ContactRole, input: { contactId?: string | null; email?: string | null; isDefault?: boolean },
): { draft: BookDraft } | { error: string } {
  const contactKey = input.contactId ?? null;
  let email: string | null = null;
  if (contactKey) {
    if (!d.contacts.some((c) => c.key === contactKey)) return { error: "Kontaktní osoba nenalezena." };
  } else {
    email = normEmail(input.email);
    if (!email) return { error: "Vyber kontaktní osobu nebo zadej platný e-mail." };
  }
  const entries = draftRoleEntries(d).filter((r) => r.role === role);
  const resolved = contactKey ? normEmail(d.contacts.find((c) => c.key === contactKey)?.email) : email;
  if (entries.some((r) => (contactKey && r.contactId === contactKey) || (resolved && r.email === resolved))) {
    return { error: "Tahle adresa už v tomto účelu je." };
  }
  const makeDefault = Boolean(input.isDefault) || !entries.some((r) => r.isDefault);
  const roles = d.roles.map((r) => (makeDefault && r.role === role && r.isDefault ? { ...r, isDefault: false } : r));
  roles.push({ key: newDraftKey(), id: null, role, contactKey, email, isDefault: makeDefault, source: "manual" });
  return { draft: { ...d, roles } };
}

export function draftRemoveRole(d: BookDraft, key: string): BookDraft {
  return { ...d, roles: fixDefaults(d.roles.filter((r) => r.key !== key)) };
}

export function draftSetRoleDefault(d: BookDraft, key: string): BookDraft {
  const target = d.roles.find((r) => r.key === key);
  if (!target) return d;
  return {
    ...d,
    roles: d.roles.map((r) => (r.role !== target.role ? r : r.key === key ? { ...r, isDefault: true, source: "manual" } : { ...r, isDefault: false })),
  };
}

/** Porovnatelný tvar (neuložené změny). */
export function draftSignature(d: BookDraft): string {
  return JSON.stringify({
    c: d.contacts.filter((c) => !isBlank(c) || c.id).map((c) => [c.id ?? c.key, c.name.trim(), c.position.trim(), c.email.trim().toLowerCase(), c.phone.trim(), c.isPrimary]),
    r: d.roles.map((r) => [r.id ?? r.key, r.role, r.contactKey, r.email, r.isDefault]),
  });
}

// ── Kontrola a převod na vstup akce ─────────────────────────
function contactLabel(c: { name: string; email: string | null }, i: number): string {
  const n = c.name.trim();
  if (n) return `Kontakt „${n}“`;
  if (c.email?.trim()) return `Kontakt ${c.email.trim()}`;
  return `Kontakt č. ${i + 1}`;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Kontrola vstupu (klient před odesláním i server). Normalizuje: prázdné → null, e-mail malými písmeny,
 * jeden hlavní kontakt, v účelu bez duplicit a s právě jednou výchozí. Chyba = srozumitelná věta.
 */
export function validatePartyBookInput(kind: PartyKind, raw: unknown): { input: PartyBookInput } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Neplatné kontakty." };
  const r = raw as Record<string, unknown>;
  const rc = Array.isArray(r.contacts) ? r.contacts : [];
  const rr = Array.isArray(r.roles) ? r.roles : [];
  if (rc.length > MAX_ROWS || rr.length > MAX_ROWS) return { error: "Příliš mnoho kontaktů." };

  const contacts: PartyBookInput["contacts"] = [];
  const keys = new Set<string>();
  const ids = new Set<string>();
  let primarySeen = false;
  for (const [i, x] of rc.entries()) {
    const o = (x ?? {}) as Record<string, unknown>;
    const key = typeof o.key === "string" && KEY_RE.test(o.key) ? o.key : null;
    if (!key || keys.has(key)) return { error: "Neplatný kontakt." };
    const id = o.id == null ? null : isUuid(o.id) ? o.id : undefined;
    if (id === undefined || (id && ids.has(id))) return { error: "Neplatný kontakt." };
    const values = { name: str(o.name, 300), position: str(o.position, 300), email: str(o.email, 300), phone: str(o.phone, 300), isPrimary: Boolean(o.isPrimary) };
    const err = validateContactForm(values);
    if (err) return { error: `${contactLabel(values, i)}: ${err}` };
    if (values.position.length > 120) return { error: `${contactLabel(values, i)}: pozice je moc dlouhá.` };
    if (values.phone.length > 60) return { error: `${contactLabel(values, i)}: telefon je moc dlouhý.` };
    if (values.email && !normEmail(values.email)) return { error: `${contactLabel(values, i)}: Tohle nevypadá jako e-mail.` };
    keys.add(key);
    if (id) ids.add(id);
    const isPrimary = values.isPrimary && !primarySeen;
    if (isPrimary) primarySeen = true;
    contacts.push({
      key, id, name: values.name.slice(0, 200), position: values.position || null,
      email: normEmail(values.email), phone: values.phone || null, isPrimary,
    });
  }

  const allowed = ROLES_FOR[kind];
  const text = ROLE_TEXT[kind];
  const roles: PartyBookInput["roles"] = [];
  const seen = new Set<string>();
  const roleIds = new Set<string>();
  for (const x of rr) {
    const o = (x ?? {}) as Record<string, unknown>;
    const role = o.role as ContactRole;
    if (!(allowed as string[]).includes(String(o.role))) return { error: "Neplatný účel e-mailu." };
    const id = o.id == null ? null : isUuid(o.id) ? o.id : undefined;
    if (id === undefined || (id && roleIds.has(id))) return { error: "Neplatný účel e-mailu." };
    const contactKey = o.contactKey == null ? null : String(o.contactKey);
    let email: string | null = null;
    if (contactKey) {
      const c = contacts.find((k) => k.key === contactKey);
      if (!c) return { error: `„${text[role].label}“: kontaktní osoba v adresáři chybí — vyber ji znovu.` };
      if (!c.email) return { error: `„${text[role].label}“: ${c.name} nemá e-mail — doplň ho, nebo osobu z účelu odeber.` };
    } else {
      email = normEmail(typeof o.email === "string" ? o.email : null);
      if (!email) return { error: `„${text[role].label}“: neplatná e-mailová adresa.` };
    }
    const dedupe = `${role}|${contactKey ?? email}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    if (id) roleIds.add(id);
    roles.push({ id, role, contactKey, email, isDefault: Boolean(o.isDefault) });
  }
  // právě jedna výchozí v každém použitém účelu
  const defaulted = new Set<ContactRole>();
  for (const x of roles) {
    if (x.isDefault && defaulted.has(x.role)) x.isDefault = false;
    else if (x.isDefault) defaulted.add(x.role);
  }
  for (const x of roles) {
    if (!defaulted.has(x.role)) {
      x.isDefault = true;
      defaulted.add(x.role);
    }
  }

  const uuids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter(isUuid))].slice(0, 1000) : []);
  return { input: { contacts, roles, knownContactIds: uuids(r.knownContactIds), knownRoleIds: uuids(r.knownRoleIds) } };
}

/** Koncept z dialogu → vstup akce (prázdné řádky bez účelu se zahodí). */
export function bookInputFromDraft(kind: PartyKind, d: BookDraft): { input: PartyBookInput } | { error: string } {
  const referenced = new Set(d.roles.map((r) => r.contactKey).filter(Boolean));
  const contacts = d.contacts.filter((c) => !isBlank(c) || referenced.has(c.key));
  return validatePartyBookInput(kind, {
    contacts: contacts.map((c) => ({ key: c.key, id: c.id, name: c.name, position: c.position, email: c.email, phone: c.phone, isPrimary: c.isPrimary })),
    roles: d.roles.filter((r) => (ROLES_FOR[kind] as string[]).includes(r.role)).map((r) => ({ id: r.id, role: r.role, contactKey: r.contactKey, email: r.email, isDefault: r.isDefault })),
    knownContactIds: d.knownContactIds,
    knownRoleIds: d.knownRoleIds,
  });
}

/** Jméno pro starý údaj „Kontaktní osoba" firmy (customers.contact_person): hlavní, jinak první osoba. */
export function bookContactPerson(input: PartyBookInput): string | null {
  return (input.contacts.find((c) => c.isPrimary) ?? input.contacts[0])?.name ?? null;
}
