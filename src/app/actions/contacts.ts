"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { checkFeature } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit";
import { isUuid, translateDbError } from "@/lib/jobs/mapping";
import type { ActionResult } from "@/lib/jobs/types";
import {
  CONTACTS_SCHEMA_MISSING, ROLES_FOR, isContactRole, isMissingSchemaError, normEmail,
  type BookContact, type ContactRole, type PartyKind, type RoleEntry,
} from "@/lib/contacts/roles";
import {
  isAddressForm, isToneStyle, salutationFor, toneSummary, type ToneSetting, type ToneSuggestion,
} from "@/lib/contacts/tone";
import {
  identifyRecipient, loadAddressBook, loadToneSettings, moveToneEmail, saveToneSetting, suggestToneFromSent,
} from "@/lib/contacts/server";
import { validateContactForm, type ContactFormValues } from "@/components/customers/model";

/**
 * Kontakty: e-maily podle účelu (fakturace / nákup / nabídky / běžná komunikace) u zákazníka
 * i dodavatele, kontaktní osoby dodavatele a tykání / vykání přihlášeného uživatele s adresátem.
 * Data jdou servisním klíčem — každá akce kontroluje oprávnění sama; tykání je vždy jen moje.
 */

const NO_DB = "Supabase není nakonfigurováno.";

function clean(v: unknown, max = 300): string | null {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s ? s : null;
}

async function party(kind: PartyKind) {
  const auth = await checkFeature(kind === "customer" ? "customers" : "suppliers");
  if ("error" in auth) return { error: auth.error } as const;
  if (!isSupabaseConfigured()) return { error: NO_DB } as const;
  return { user: auth.user, db: await createOperatorClient({ actor: userActor(auth.user) }) } as const;
}

function revalidateParty(kind: PartyKind, id: string) {
  if (kind === "customer") revalidatePath(`/customers/${id}`);
  else revalidatePath("/suppliers");
}

// ── E-maily podle účelu ─────────────────────────────────────
export interface SaveRoleEmailInput {
  kind: PartyKind;
  partyId: string;
  role: ContactRole;
  /** Kontaktní osoba (zákazníka / dodavatele) — nebo samotná adresa `email`. */
  contactId?: string | null;
  email?: string | null;
  isDefault?: boolean;
}

/** Přidá adresu / kontakt do role; první v roli (nebo „výchozí") se stane výchozí. */
export async function saveRoleEmailAction(input: SaveRoleEmailInput): Promise<ActionResult<{ id: string }>> {
  if (!input || (input.kind !== "customer" && input.kind !== "supplier")) return { ok: false, error: "Neplatný záznam." };
  if (!isUuid(input.partyId)) return { ok: false, error: "Neplatná firma." };
  if (!isContactRole(input.role) || !ROLES_FOR[input.kind].includes(input.role)) return { ok: false, error: "Neplatný účel e-mailu." };
  const contactId = input.contactId && isUuid(input.contactId) ? input.contactId : null;
  const email = contactId ? null : normEmail(input.email);
  if (!contactId && !email) return { ok: false, error: "Vyber kontaktní osobu nebo zadej platný e-mail." };
  const c = await party(input.kind);
  if ("error" in c) return { ok: false, error: c.error };
  try {
    const col = input.kind === "customer" ? "customer_id" : "supplier_id";
    const { data: existing } = await c.db.from("party_role_emails").select("id, is_default").eq(col, input.partyId).eq("role", input.role);
    const rows = (existing ?? []) as { id: string; is_default: boolean }[];
    const makeDefault = Boolean(input.isDefault) || !rows.some((r) => r.is_default);
    if (makeDefault && rows.some((r) => r.is_default)) {
      await c.db.from("party_role_emails").update({ is_default: false } as never).eq(col, input.partyId).eq("role", input.role).eq("is_default", true);
    }
    const row = {
      [col]: input.partyId, role: input.role, is_default: makeDefault, source: "manual",
      ...(contactId ? (input.kind === "customer" ? { contact_id: contactId } : { supplier_contact_id: contactId }) : { email }),
    };
    const { data, error } = await c.db.from("party_role_emails").insert(row as never).select("id").single();
    if (error || !data) {
      if (isMissingSchemaError(error)) return { ok: false, error: CONTACTS_SCHEMA_MISSING };
      if (error && /duplicate|unique/i.test(error.message)) return { ok: false, error: "Tahle adresa už v tomto účelu je." };
      return { ok: false, error: translateDbError(error?.message ?? "Uložení se nepovedlo.") };
    }
    const id = (data as { id: string }).id;
    await logAudit({ action: "party_role_email_added", entity: "party_role_emails", entityId: id, diff: { kind: input.kind, partyId: input.partyId, role: input.role, contactId, email } });
    revalidateParty(input.kind, input.partyId);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Chyba ukládání" };
  }
}

async function roleRow(db: Awaited<ReturnType<typeof createOperatorClient>>, id: string) {
  const { data } = await db.from("party_role_emails").select("id, customer_id, supplier_id, role, is_default").eq("id", id).maybeSingle();
  return data as { id: string; customer_id: string | null; supplier_id: string | null; role: ContactRole; is_default: boolean } | null;
}

export async function deleteRoleEmailAction(kind: PartyKind, id: string): Promise<ActionResult> {
  if (!isUuid(id)) return { ok: false, error: "Neplatný záznam." };
  const c = await party(kind);
  if ("error" in c) return { ok: false, error: c.error };
  const row = await roleRow(c.db, id);
  if (!row || (kind === "customer" ? !row.customer_id : !row.supplier_id)) return { ok: false, error: "Záznam nenalezen." };
  const { error } = await c.db.from("party_role_emails").delete().eq("id", id);
  if (error) return { ok: false, error: translateDbError(error.message) };
  const col = row.customer_id ? "customer_id" : "supplier_id";
  const partyId = (row.customer_id ?? row.supplier_id) as string;
  // smazaná výchozí → výchozí se stane další v roli
  if (row.is_default) {
    const { data: next } = await c.db.from("party_role_emails").select("id").eq(col, partyId).eq("role", row.role).order("created_at").limit(1);
    const n = ((next ?? []) as { id: string }[])[0];
    if (n) await c.db.from("party_role_emails").update({ is_default: true } as never).eq("id", n.id);
  }
  await logAudit({ action: "party_role_email_removed", entity: "party_role_emails", entityId: id, diff: { kind, partyId, role: row.role } });
  revalidateParty(kind, partyId);
  return { ok: true };
}

export async function setRoleDefaultAction(kind: PartyKind, id: string): Promise<ActionResult> {
  if (!isUuid(id)) return { ok: false, error: "Neplatný záznam." };
  const c = await party(kind);
  if ("error" in c) return { ok: false, error: c.error };
  const row = await roleRow(c.db, id);
  if (!row || (kind === "customer" ? !row.customer_id : !row.supplier_id)) return { ok: false, error: "Záznam nenalezen." };
  const col = row.customer_id ? "customer_id" : "supplier_id";
  const partyId = (row.customer_id ?? row.supplier_id) as string;
  await c.db.from("party_role_emails").update({ is_default: false } as never).eq(col, partyId).eq("role", row.role).neq("id", id);
  const { error } = await c.db.from("party_role_emails").update({ is_default: true, source: "manual" } as never).eq("id", id);
  if (error) return { ok: false, error: translateDbError(error.message) };
  revalidateParty(kind, partyId);
  return { ok: true };
}

// ── Adresář firmy pro dialog (kontaktní osoby + e-maily podle účelu) ──
export interface PartyBook {
  contacts: BookContact[];
  roles: RoleEntry[];
  partyEmail: string | null;
  tones: Record<string, { address: ToneSetting["address"]; summary: string }>;
  /** V DB chybí tabulky kontaktů / účelů (neaplikovaná migrace) → dialog ukáže zprávu místo editoru. */
  schemaMissing?: boolean;
}
/** @deprecated název z doby, kdy adresář načítal jen dialog dodavatele */
export type SupplierBook = PartyBook;

/** Adresář zákazníka / dodavatele pro dialog „Upravit…" (načte se při otevření). */
export async function getPartyBookAction(kind: PartyKind, partyId: string): Promise<ActionResult<{ book: PartyBook }>> {
  if (kind !== "customer" && kind !== "supplier") return { ok: false, error: "Neplatný záznam." };
  if (!isUuid(partyId)) return { ok: false, error: kind === "customer" ? "Neplatný zákazník." : "Neplatný dodavatel." };
  const c = await party(kind);
  if ("error" in c) return { ok: false, error: c.error };
  const book = await loadAddressBook(c.db, kind === "customer" ? { customerId: partyId } : { supplierId: partyId });
  if (!book) return { ok: false, error: kind === "customer" ? "Zákazník nenalezen." : "Dodavatel nenalezen." };
  const tones = await myTones(c.db, c.user.id, book.contacts);
  return {
    ok: true,
    book: { contacts: book.contacts, roles: book.roles, partyEmail: book.partyEmail, tones, ...(book.schemaMissing ? { schemaMissing: true } : {}) },
  };
}

export async function getSupplierBookAction(supplierId: string): Promise<ActionResult<{ book: PartyBook }>> {
  return getPartyBookAction("supplier", supplierId);
}

/** Moje tykání ke kontaktům (pro štítek u osoby). */
async function myTones(db: unknown, userId: string, contacts: { name: string; email: string | null }[]) {
  const map = await loadToneSettings(db, userId, contacts.map((c) => c.email ?? "")).catch(() => new Map<string, ToneSetting>());
  const out: Record<string, { address: ToneSetting["address"]; summary: string }> = {};
  for (const c of contacts) {
    const s = c.email ? map.get(c.email) : undefined;
    if (c.email && s) out[c.email] = { address: s.address, summary: toneSummary(s, c.name) };
  }
  return out;
}

export async function saveSupplierContactAction(supplierId: string, input: ContactFormValues, contactId?: string): Promise<ActionResult<{ id: string }>> {
  if (!isUuid(supplierId)) return { ok: false, error: "Neplatný dodavatel." };
  if (contactId !== undefined && !isUuid(contactId)) return { ok: false, error: "Neplatný kontakt." };
  const err = validateContactForm(input);
  if (err) return { ok: false, error: err };
  const c = await party("supplier");
  if ("error" in c) return { ok: false, error: c.error };
  const row = {
    supplier_id: supplierId,
    name: clean(input.name, 200) ?? "",
    position: clean(input.position, 120),
    email: clean(input.email, 200)?.toLowerCase() ?? null,
    phone: clean(input.phone, 60),
    is_primary: Boolean(input.isPrimary),
  };
  try {
    let id = contactId;
    if (contactId) {
      const { data: before } = await c.db.from("supplier_contacts").select("email").eq("id", contactId).eq("supplier_id", supplierId).maybeSingle();
      const { data, error } = await c.db.from("supplier_contacts").update(row as never).eq("id", contactId).eq("supplier_id", supplierId).select("id").maybeSingle();
      if (error) return { ok: false, error: translateDbError(error.message) };
      if (!data) return { ok: false, error: "Kontakt nenalezen." };
      await moveToneEmail(c.db, (before as { email: string | null } | null)?.email, row.email);
    } else {
      const { data, error } = await c.db.from("supplier_contacts").insert(row as never).select("id").single();
      if (error || !data) return { ok: false, error: translateDbError(error?.message ?? "Kontakt se nepodařilo uložit.") };
      id = (data as { id: string }).id;
    }
    if (row.is_primary && id) await c.db.from("supplier_contacts").update({ is_primary: false } as never).eq("supplier_id", supplierId).neq("id", id);
    revalidatePath("/suppliers");
    return { ok: true, id: id! };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Chyba ukládání" };
  }
}

export async function deleteSupplierContactAction(supplierId: string, contactId: string): Promise<ActionResult> {
  if (!isUuid(supplierId) || !isUuid(contactId)) return { ok: false, error: "Neplatný kontakt." };
  const c = await party("supplier");
  if ("error" in c) return { ok: false, error: c.error };
  const { error } = await c.db.from("supplier_contacts").delete().eq("id", contactId).eq("supplier_id", supplierId);
  if (error) return { ok: false, error: translateDbError(error.message) };
  await logAudit({ action: "supplier_contact_deleted", entity: "supplier_contacts", entityId: contactId, diff: { supplierId } });
  revalidatePath("/suppliers");
  return { ok: true };
}

// ── Tykání / vykání (vždy moje) ─────────────────────────────
export interface ToneView {
  email: string;
  /** Jméno adresáta (kontakt / kolega / z pošty). */
  name: string | null;
  company: string | null;
  setting: ToneSetting;
  /** Mám uložené vlastní nastavení (jinak výchozí vykání). */
  saved: boolean;
  salutation: string;
  /** Návrh z mé odeslané pošty („psal jsi Ahoj → tykáte?"), jen když ještě nic nemám uloženo. */
  suggestion: ToneSuggestion | null;
}

export async function getToneAction(emailIn: string, nameHint?: string | null): Promise<ActionResult<{ tone: ToneView }>> {
  const auth = await checkFeature("mail");
  if ("error" in auth) return { ok: false, error: auth.error };
  const email = normEmail(emailIn);
  if (!email) return { ok: false, error: "Neplatná e-mailová adresa." };
  if (!isSupabaseConfigured()) return { ok: false, error: NO_DB };
  const db = await createOperatorClient({ actor: userActor(auth.user) });
  const [map, who] = await Promise.all([loadToneSettings(db, auth.user.id, [email]), identifyRecipient(db, email)]);
  const saved = map.get(email);
  const setting = saved ?? { address: "vy" as const, tone: "formalni" as const, salutation: null, source: "default" as const };
  const name = who?.name ?? (nameHint?.trim() || null);
  const suggestion = saved ? null : await suggestToneFromSent(db, auth.user.id, email).catch(() => null);
  return {
    ok: true,
    tone: { email, name, company: who?.company ?? null, setting, saved: Boolean(saved), salutation: salutationFor(setting, name), suggestion },
  };
}

export async function saveToneAction(
  emailIn: string, input: { address: string; tone?: string; salutation?: string | null; fromSuggestion?: boolean }, nameHint?: string | null,
): Promise<ActionResult<{ salutation: string; setting: ToneSetting }>> {
  const auth = await checkFeature("mail");
  if ("error" in auth) return { ok: false, error: auth.error };
  if (!input || !isAddressForm(input.address)) return { ok: false, error: "Vyber tykání nebo vykání." };
  const tone = isToneStyle(input.tone) ? input.tone : input.address === "ty" ? "pratelsky" : "formalni";
  if (!isSupabaseConfigured()) return { ok: false, error: NO_DB };
  const db = await createOperatorClient({ actor: userActor(auth.user) });
  const res = await saveToneSetting(db, auth.user.id, emailIn, { address: input.address, tone, salutation: input.salutation ?? null, source: input.fromSuggestion ? "navrh" : "manual" });
  if (!res.ok) return { ok: false, error: res.error };
  const who = await identifyRecipient(db, emailIn).catch(() => null);
  const setting: ToneSetting = { address: input.address, tone, salutation: (input.salutation ?? "").trim().replace(/[,\s]+$/, "") || null, source: input.fromSuggestion ? "navrh" : "manual" };
  return { ok: true, setting, salutation: salutationFor(setting, who?.name ?? nameHint ?? null) };
}
