import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ROLES_FOR, isMissingSchemaError, normEmail, pickRecipients, roleEntryFromRow, ROLE_TEXT,
  type BookContact, type ContactRole, type PartyAddressBook, type PartyKind, type RecipientPick, type SendPurpose,
} from "@/lib/contacts/roles";
import {
  DEFAULT_TONE, combineTones, salutationFor, suggestToneFromTexts, toneFromRow, toneInstruction,
  type ToneSetting, type ToneSuggestion,
} from "@/lib/contacts/tone";
import type { DetectedRoleEmail } from "@/lib/contacts/role-detect";
import type { PartyBookInput } from "@/lib/contacts/book-draft";
import { COMPANY } from "@/lib/company";
import { logAudit } from "@/lib/audit";

/**
 * Kontakty na serveru: adresář zákazníka / dodavatele (kontaktní osoby + e-maily podle účelu), výběr
 * adresátů pro odeslání, tykání / vykání odesílatele s adresátem a zápis rolí, které našla AI.
 * Volá se servisním klientem (createOperatorClient) — viditelnost hlídá volající akce.
 */

type Db = SupabaseClient;
const asDb = (db: unknown) => db as Db;

export interface PartyRef {
  customerId?: string | null;
  supplierId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
/** Adresa jako doslovný vzor pro ilike (podtržítko v adrese není zástupný znak). */
export const likeLiteral = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

type ContactRow = { id: string; name: string; email: string | null; position: string | null; phone: string | null; is_primary: boolean | null };

function bookContact(r: ContactRow): BookContact {
  return { id: r.id, name: r.name, email: normEmail(r.email), position: r.position ?? null, phone: r.phone ?? null, isPrimary: Boolean(r.is_primary) };
}

/** Adresář jedné firmy (zákazník nebo dodavatel). Chyba / neexistuje → null. */
export async function loadAddressBook(dbIn: unknown, party: PartyRef): Promise<PartyAddressBook | null> {
  const db = asDb(dbIn);
  const kind: PartyKind | null = isUuid(party.customerId) ? "customer" : isUuid(party.supplierId) ? "supplier" : null;
  if (!kind) return null;
  const id = (kind === "customer" ? party.customerId : party.supplierId) as string;
  const [base, contacts, roles] = await Promise.all([
    db.from(kind === "customer" ? "customers" : "suppliers").select("email").eq("id", id).maybeSingle(),
    db.from(kind === "customer" ? "customer_contacts" : "supplier_contacts")
      .select("id, name, email, position, phone, is_primary").eq(kind === "customer" ? "customer_id" : "supplier_id", id).limit(200),
    kind === "customer"
      ? db.from("party_role_emails").select("id, role, email, is_default, source, contact_id, contact:customer_contacts!contact_id(name, email, position)").eq("customer_id", id).limit(200)
      : db.from("party_role_emails").select("id, role, email, is_default, source, supplier_contact_id, contact:supplier_contacts!supplier_contact_id(name, email, position)").eq("supplier_id", id).limit(200),
  ]);
  if (base.error || !base.data) return null;
  type RoleRow = Parameters<typeof roleEntryFromRow>[0];
  const schemaMissing = isMissingSchemaError(roles.error) || isMissingSchemaError(contacts.error);
  return {
    kind,
    partyEmail: normEmail((base.data as { email: string | null }).email),
    contacts: ((contacts.error ? [] : contacts.data ?? []) as ContactRow[]).map(bookContact),
    roles: ((roles.error ? [] : roles.data ?? []) as RoleRow[]).map(roleEntryFromRow).filter((r): r is NonNullable<typeof r> => r !== null),
    ...(schemaMissing ? { schemaMissing: true } : {}),
  };
}

/** Adresáti pro odeslání (Komu / Kopie / důvod) — zákazník zakázky, dodavatel objednávky… */
export async function recipientsFor(
  db: unknown, purpose: SendPurpose, party: PartyRef, jobContact?: { email?: string | null; name?: string | null } | null,
): Promise<RecipientPick> {
  const book = await loadAddressBook(db, party).catch(() => null);
  return pickRecipients(purpose, book, jobContact ?? null);
}

// ── Jméno adresáta (pro oslovení) ───────────────────────────
export interface RecipientIdentity {
  email: string;
  name: string | null;
  company: string | null;
  position: string | null;
  kind: "kontakt" | "dodavatel_kontakt" | "kolega" | "konverzace" | "nezname";
}

/** Kdo se skrývá za adresou: kontaktní osoba zákazníka / dodavatele, kolega, nebo jméno z pošty. */
export async function identifyRecipient(dbIn: unknown, emailIn: string): Promise<RecipientIdentity | null> {
  const email = normEmail(emailIn);
  if (!email) return null;
  const db = asDb(dbIn);
  const exact = likeLiteral(email);
  const [cc, sc, prof, mail] = await Promise.all([
    db.from("customer_contacts").select("name, position, customer:customers!customer_id(name)").ilike("email", exact).limit(1),
    db.from("supplier_contacts").select("name, position, supplier:suppliers!supplier_id(name)").ilike("email", exact).limit(1),
    db.from("profiles").select("full_name").ilike("email", exact).limit(1),
    db.from("emails").select("from_name").ilike("from_email", exact).not("from_name", "is", null).order("received_at", { ascending: false }).limit(1),
  ]);
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
  const c = (cc.data ?? [])[0] as { name: string; position: string | null; customer: { name: string } | { name: string }[] | null } | undefined;
  if (c) return { email, name: c.name, company: one(c.customer)?.name ?? null, position: c.position, kind: "kontakt" };
  const s = (sc.data ?? [])[0] as { name: string; position: string | null; supplier: { name: string } | { name: string }[] | null } | undefined;
  if (s) return { email, name: s.name, company: one(s.supplier)?.name ?? null, position: s.position, kind: "dodavatel_kontakt" };
  const p = (prof.data ?? [])[0] as { full_name: string | null } | undefined;
  if (p?.full_name) return { email, name: p.full_name, company: COMPANY.name, position: null, kind: "kolega" };
  const m = (mail.data ?? [])[0] as { from_name: string | null } | undefined;
  const fromName = (m?.from_name ?? "").replace(/\|.*$/, "").trim();
  if (fromName && !fromName.includes("@")) return { email, name: fromName, company: null, position: null, kind: "konverzace" };
  return { email, name: null, company: null, position: null, kind: "nezname" };
}

// ── Tykání / vykání ─────────────────────────────────────────
/** Moje nastavení pro adresy (chybí = výchozí vykání). */
export async function loadToneSettings(dbIn: unknown, userId: string, emails: string[]): Promise<Map<string, ToneSetting>> {
  const out = new Map<string, ToneSetting>();
  const list = [...new Set(emails.map((e) => normEmail(e)).filter((e): e is string => Boolean(e)))];
  if (!isUuid(userId) || !list.length) return out;
  const { data, error } = await asDb(dbIn).from("contact_tone").select("email, address, tone, salutation, source").eq("user_id", userId).in("email", list);
  if (error) return out;
  for (const r of (data ?? []) as { email: string; address: string; tone: string; salutation: string | null; source: string }[]) {
    out.set(r.email, toneFromRow(r));
  }
  return out;
}

export interface ToneContext {
  /** Hlavní adresát (první v Komu). */
  email: string | null;
  name: string | null;
  setting: ToneSetting;
  /** Hotový první řádek („Ahoj Pavle,"). */
  salutation: string;
  /** Pokyn do promptu AI. */
  instruction: string;
  /** Víc adresátů s různým nastavením → formálně bez jména. */
  mixed: boolean;
}

/**
 * Tón textu, který odejde pod jménem uživatele `userId` adresátům `to`: nastavení hlavního adresáta;
 * víc adresátů s různým nastavením → formální vykání („Dobrý den,"). `nameHint` = jméno z hlavičky.
 */
export async function toneFor(dbIn: unknown, userId: string | null | undefined, to: (string | null | undefined)[], nameHint?: string | null): Promise<ToneContext> {
  const list = [...new Set(to.map((e) => normEmail(e)).filter((e): e is string => Boolean(e)))];
  const main = list[0] ?? null;
  const settings = userId ? await loadToneSettings(dbIn, userId, list).catch(() => new Map<string, ToneSetting>()) : new Map<string, ToneSetting>();
  const { setting, mixed } = combineTones(list.length ? list.map((e) => settings.get(e) ?? { ...DEFAULT_TONE }) : [{ ...DEFAULT_TONE }]);
  let name: string | null = null;
  if (!mixed && main) {
    const who = await identifyRecipient(dbIn, main).catch(() => null);
    name = who?.kind === "konverzace" || who?.kind === "nezname" ? (nameHint?.trim() || who?.name || null) : who?.name ?? (nameHint?.trim() || null);
  }
  return {
    email: main,
    name,
    setting,
    salutation: salutationFor(setting, mixed ? null : name),
    instruction: toneInstruction(setting, mixed ? null : name),
    mixed,
  };
}

/** Tón pro AI prompty (src/lib/ai/claude.ts AiTone). */
export function aiToneOf(t: ToneContext): { instruction: string; salutation: string; address: ToneSetting["address"] } {
  return { instruction: t.instruction, salutation: t.salutation, address: t.setting.address };
}

/** Tón pro AI od uživatele `userId` k adresátovi — chyba / bez DB = null (AI pak píše zdvořile vykáním). */
export async function aiToneFor(db: unknown, userId: string | null | undefined, to: string | null | undefined, nameHint?: string | null) {
  if (!to) return null;
  const t = await toneFor(db, userId, [to], nameHint).catch(() => null);
  return t ? aiToneOf(t) : null;
}

/** Uloží moje tykání / vykání s adresou (prázdné oslovení = generovat ze jména). */
export async function saveToneSetting(
  dbIn: unknown, userId: string, emailIn: string, input: { address: ToneSetting["address"]; tone: ToneSetting["tone"]; salutation?: string | null; source?: "manual" | "navrh" },
): Promise<{ ok: boolean; error?: string }> {
  const email = normEmail(emailIn);
  if (!email) return { ok: false, error: "Neplatná e-mailová adresa." };
  if (!isUuid(userId)) return { ok: false, error: "Neplatný uživatel." };
  const { error } = await asDb(dbIn).from("contact_tone").upsert({
    user_id: userId, email, address: input.address, tone: input.tone,
    salutation: (input.salutation ?? "").trim().replace(/[,\s]+$/, "").slice(0, 120) || null,
    source: input.source ?? "manual",
  } as never, { onConflict: "user_id,email" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Návrh tykání z mých odeslaných zpráv adresátovi (null = nic jasného). */
export async function suggestToneFromSent(dbIn: unknown, userId: string, emailIn: string): Promise<ToneSuggestion | null> {
  const email = normEmail(emailIn);
  if (!email || !isUuid(userId)) return null;
  const db = asDb(dbIn);
  const { data: boxes } = await db.from("mailboxes").select("id").eq("owner_id", userId);
  const ids = ((boxes ?? []) as { id: string }[]).map((b) => b.id).filter(isUuid);
  let q = db.from("emails").select("body_text").eq("direction", "out").ilike("to_email", `%${likeLiteral(email)}%`)
    .order("received_at", { ascending: false }).limit(12);
  q = ids.length ? q.or(`owner_id.eq.${userId},mailbox_id.in.(${ids.join(",")})`) : q.eq("owner_id", userId);
  const { data, error } = await q;
  if (error) return null;
  return suggestToneFromTexts(((data ?? []) as { body_text: string | null }[]).map((r) => r.body_text ?? ""));
}

/** Při změně e-mailu kontaktní osoby se tykání všech uživatelů přenese na novou adresu. */
export async function moveToneEmail(dbIn: unknown, fromEmail: string | null | undefined, toEmail: string | null | undefined): Promise<void> {
  const a = normEmail(fromEmail);
  const b = normEmail(toEmail);
  if (!a || !b || a === b) return;
  const db = asDb(dbIn);
  const { data } = await db.from("contact_tone").select("id, user_id").eq("email", a);
  for (const r of (data ?? []) as { id: string; user_id: string }[]) {
    const { error } = await db.from("contact_tone").update({ email: b } as never).eq("id", r.id);
    // uživatel už má pro novou adresu vlastní nastavení → staré necháme být
    if (error) continue;
  }
}

// ── Kontaktní osoba z údaje „Kontaktní osoba" firmy ─────────
/**
 * Údaj „Kontaktní osoba" u zákazníka / dodavatele (formulář, AI z dokladu) → kontaktní osoba v seznamu
 * (jméno; e-mail a telefon firmy jen u první osoby — stejně jako převod v migraci). Už existující jméno
 * se nezdvojí. Vrací id nové osoby nebo null.
 */
export async function ensureContactPerson(
  dbIn: unknown, party: PartyRef, input: { name?: string | null; email?: string | null; phone?: string | null; position?: string | null },
): Promise<string | null> {
  const name = (input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const kind: PartyKind | null = isUuid(party.customerId) ? "customer" : isUuid(party.supplierId) ? "supplier" : null;
  if (!name || !kind) return null;
  const db = asDb(dbIn);
  const table = kind === "customer" ? "customer_contacts" : "supplier_contacts";
  const col = kind === "customer" ? "customer_id" : "supplier_id";
  const id = (kind === "customer" ? party.customerId : party.supplierId) as string;
  const { data, error } = await db.from(table).select("id, name, is_primary").eq(col, id).limit(200);
  if (error) return null;
  const rows = (data ?? []) as { id: string; name: string; is_primary: boolean }[];
  if (rows.some((r) => r.name.trim().toLowerCase() === name.toLowerCase())) return null;
  const first = rows.length === 0;
  const { data: ins, error: insErr } = await db.from(table).insert({
    [col]: id, name,
    position: (input.position ?? "").trim().slice(0, 120) || null,
    email: first ? normEmail(input.email) : null,
    phone: first ? (input.phone ?? "").trim().slice(0, 60) || null : null,
    is_primary: !rows.some((r) => r.is_primary),
  } as never).select("id").maybeSingle();
  return insErr || !ins ? null : (ins as { id: string }).id;
}

// ── Role, které našla AI ────────────────────────────────────
function companyDomains(): string[] {
  const out: string[] = [];
  const own = normEmail(COMPANY.email);
  if (own) out.push(own.split("@")[1]);
  const web = (COMPANY.web ?? "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
  if (web) out.push(web);
  return out;
}

/** Naše vlastní adresy (schránky, uživatelé, doména firmy) — nikdy se nepřiřazují zákazníkovi. */
export async function ownAddressFilter(dbIn: unknown): Promise<(email: string) => boolean> {
  const db = asDb(dbIn);
  const [boxes, users] = await Promise.all([
    db.from("mailboxes").select("email").limit(500),
    db.from("profiles").select("email").limit(1000),
  ]);
  const set = new Set<string>();
  for (const r of [...((boxes.data ?? []) as { email: string | null }[]), ...((users.data ?? []) as { email: string | null }[])]) {
    const e = normEmail(r.email);
    if (e) set.add(e);
  }
  const domains = companyDomains();
  return (email: string) => {
    const e = email.toLowerCase();
    return set.has(e) || domains.some((d) => d && e.endsWith(`@${d}`));
  };
}

/**
 * Zapíše role adres, které AI / rozpoznání našlo (pošta, doklad). Nepřepisuje ruční nastavení: existující
 * adresa v roli se přeskočí; výchozí se stane jen v roli, která výchozí ještě nemá. Vrací počet nových.
 */
export async function rememberRoleEmails(
  dbIn: unknown, party: PartyRef, found: Pick<DetectedRoleEmail, "role" | "email">[], opts: { exclude?: (email: string) => boolean } = {},
): Promise<number> {
  const db = asDb(dbIn);
  const kind: PartyKind | null = isUuid(party.customerId) ? "customer" : isUuid(party.supplierId) ? "supplier" : null;
  if (!kind || !found.length) return 0;
  const book = await loadAddressBook(db, party);
  if (!book) return 0;
  const exclude = opts.exclude ?? (await ownAddressFilter(db));
  let added = 0;
  for (const f of found) {
    const email = normEmail(f.email);
    if (!email || !(ROLES_FOR[kind] as string[]).includes(f.role) || exclude(email)) continue;
    const role = f.role as ContactRole;
    if (book.roles.some((r) => r.role === role && r.email === email)) continue;
    const contact = book.contacts.find((c) => c.email === email);
    const hasDefault = book.roles.some((r) => r.role === role && r.isDefault);
    const row: Record<string, unknown> = {
      role, is_default: !hasDefault, source: "ai",
      ...(kind === "customer" ? { customer_id: party.customerId } : { supplier_id: party.supplierId }),
      ...(contact ? (kind === "customer" ? { contact_id: contact.id } : { supplier_contact_id: contact.id }) : { email }),
    };
    const { data, error } = await db.from("party_role_emails").insert(row as never).select("id").maybeSingle();
    if (error || !data) continue;
    added++;
    book.roles.push({
      id: (data as { id: string }).id, role, email, contactId: contact?.id ?? null, contactName: contact?.name ?? null,
      contactPosition: contact?.position ?? null, isDefault: !hasDefault, source: "ai",
    });
  }
  return added;
}

/** Popis role pro UI / důvod („Fakturační e-mail zákazníka"). */
export function roleReason(kind: PartyKind, role: ContactRole): string {
  return ROLE_TEXT[kind][role].reason;
}

// ── Adresář z dialogu (kontaktní osoby + účely najednou) ────
export interface PartyBookSaveSummary {
  contacts: { added: number; updated: number; removed: number };
  roles: { added: number; updated: number; removed: number };
}

/**
 * Uloží kontaktní osoby a e-maily podle účelu z dialogu firmy v jedné transakci (DB save_party_book).
 * Vstup už prošel validatePartyBookInput. Tykání kolegů jde za změněnou adresou; zápis do auditu.
 */
export async function savePartyBook(
  dbIn: unknown, kind: PartyKind, partyId: string, input: PartyBookInput,
): Promise<{ ok: true; summary: PartyBookSaveSummary } | { ok: false; error: string }> {
  const db = asDb(dbIn);
  const { data, error } = await db.rpc("save_party_book", { p_kind: kind, p_party: partyId, p_book: input as never });
  if (error) {
    if (isMissingSchemaError(error)) {
      return { ok: false, error: "Kontakty a e-maily podle účelu nejdou uložit — v databázi chybí aktualizace (migrace 20261031100000_kontakty_dodaci_listy_adresar)." };
    }
    if (/kontaktní osoba nepatří/i.test(error.message)) return { ok: false, error: "Kontaktní osoba patří k jiné firmě — načti okno znovu." };
    if (/duplicate key|unique/i.test(error.message)) return { ok: false, error: "Některá adresa je v účelu dvakrát — načti okno znovu." };
    return { ok: false, error: /[ěščřžýáíéůú]/i.test(error.message) ? error.message : `Kontakty se nepodařilo uložit (${error.message}).` };
  }
  const res = (data ?? {}) as { contacts?: PartyBookSaveSummary["contacts"]; roles?: PartyBookSaveSummary["roles"]; moved?: { from: string; to: string }[] };
  for (const m of res.moved ?? []) await moveToneEmail(db, m.from, m.to).catch(() => null);
  const summary: PartyBookSaveSummary = {
    contacts: res.contacts ?? { added: 0, updated: 0, removed: 0 },
    roles: res.roles ?? { added: 0, updated: 0, removed: 0 },
  };
  const changed = Object.values(summary.contacts).some(Boolean) || Object.values(summary.roles).some(Boolean);
  if (changed) {
    await logAudit({
      action: "party_book_saved",
      entity: kind === "customer" ? "customers" : "suppliers",
      entityId: partyId,
      diff: {
        kind, ...summary,
        contacts_now: input.contacts.map((c) => `${c.isPrimary ? "★ " : ""}${c.name}${c.email ? ` <${c.email}>` : ""}`),
        roles_now: input.roles.map((r) => {
          const c = r.contactKey ? input.contacts.find((x) => x.key === r.contactKey) : null;
          return `${r.role}${r.isDefault ? "*" : ""}: ${c ? `${c.name} <${c.email}>` : r.email}`;
        }),
      },
    });
  }
  return { ok: true, summary };
}
