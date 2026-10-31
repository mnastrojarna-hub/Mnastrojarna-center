"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { checkFeature, getAccess } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit";
import { ensureContactPerson, moveToneEmail, savePartyBook } from "@/lib/contacts/server";
import { bookContactPerson, validatePartyBookInput, type PartyBookInput } from "@/lib/contacts/book-draft";
import type { PartyKind } from "@/lib/contacts/roles";
import { fetchPaged, isUuid, translateDbError } from "@/lib/jobs/mapping";
import {
  matchCustomer, normalizeCountry, normalizeDic, normalizeIco, composeAddress, type CustomerLookupRow,
} from "@/lib/jobs/customers";
import type { ActionResult } from "@/lib/jobs/types";
import {
  parsePaymentDays, validateContactForm, validateCustomerForm, websiteHref,
  type ContactFormValues, type CustomerFormValues,
} from "@/components/customers/model";
import {
  clampRating, normalizeTags, parseLeadDays, validateSupplierForm, type SupplierFormValues,
} from "@/components/suppliers/model";

/**
 * Adresář — zákazníci, kontaktní osoby a dodavatelé. Zakládat a upravovat smí
 * každý aktivní uživatel (oprávnění „customers" / „suppliers"); cenový profil
 * zákazníka jen role s AI naceněním nebo maržemi. Data jdou servisním klíčem,
 * proto každá akce kontroluje oprávnění sama.
 */

const NO_DB = "Supabase není nakonfigurováno.";
/** = text pojistky v DB (customers_owner_guard, migrace 20261023157000). */
const CUSTOMER_OWNER_ADMIN_ONLY = "Obchodníka zákazníka mění jen super admin.";

function clean(v: unknown, max = 300): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
}

function firstError(errors: Partial<Record<string, string>>): string | null {
  const msg = Object.values(errors).find(Boolean);
  return msg ?? null;
}

function dbError(message: string, customerNumber?: string | null): string {
  const m = message.toLowerCase();
  if ((m.includes("duplicate key") || m.includes("unique")) && m.includes("customer_number")) {
    return `Číslo zákazníka ${customerNumber ? `${customerNumber} ` : ""}už má jiný zákazník.`;
  }
  return translateDbError(message);
}

/**
 * Adresář z dialogu (kontaktní osoby + „Kam posílat") — kontrola PŘED zápisem firmy, ať chyba v kontaktech
 * nezpůsobí napůl uložený dialog. undefined = dialog adresář neposlal (starý klient / bez migrace).
 */
function checkBook(kind: PartyKind, book: unknown): { book: PartyBookInput | null } | { error: string } {
  if (book === undefined || book === null) return { book: null };
  const v = validatePartyBookInput(kind, book);
  return "error" in v ? { error: v.error } : { book: v.input };
}

/** Uloží adresář po zápisu firmy; chyba = firma uložená, kontakty ne (dialog zůstane otevřený). */
async function saveBookAfter(db: unknown, kind: PartyKind, partyId: string, book: PartyBookInput | null): Promise<string | null> {
  if (!book) return null;
  const res = await savePartyBook(db, kind, partyId, book).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : "Chyba ukládání" }));
  return res.ok ? null : `Údaje firmy jsou uložené, ale kontakty a e-maily ne: ${res.error}`;
}

function revalidateCustomer(id?: string) {
  revalidatePath("/customers");
  if (id) revalidatePath(`/customers/${id}`);
  revalidatePath("/orders");
}

// ── Zákazníci ───────────────────────────────────────────────
type CustomerColumns = Record<string, string | number | null>;

/** Formulář → sloupce customers (null = vymazat). Chyba = text. */
function customerColumns(input: CustomerFormValues): { cols: CustomerColumns } | { error: string } {
  const err = firstError(validateCustomerForm(input));
  if (err) return { error: err };
  const icoRaw = clean(input.ico, 40);
  const ico = normalizeIco(icoRaw);
  if (icoRaw && !ico) return { error: "IČO má jen číslice (obvykle 8)." };
  const dicRaw = clean(input.dic, 40);
  const dic = dicRaw ? normalizeDic(dicRaw) ?? dicRaw.toUpperCase().replace(/\s/g, "") : null;
  const street = clean(input.street);
  const city = clean(input.city, 120);
  const zip = clean(input.zip, 20);
  const days = parsePaymentDays(input.paymentTermsDays ?? "");
  const website = clean(input.website, 300);
  return {
    cols: {
      name: clean(input.name) ?? "",
      ico,
      dic,
      street,
      city,
      zip,
      address: composeAddress({ street: street ?? undefined, city: city ?? undefined, zip: zip ?? undefined }),
      country: normalizeCountry(input.country),
      email: clean(input.email, 200)?.toLowerCase() ?? null,
      phone: clean(input.phone, 60),
      contact_person: clean(input.contactPerson, 200),
      website: website ? websiteHref(website) ?? website : null,
      payment_terms_days: Number.isNaN(days) ? null : days,
      delivery_address: clean(input.deliveryAddress, 1000),
      supplier_number_at_customer: clean(input.supplierNumberAtCustomer, 120),
      note: clean(input.note, 5000),
      owner_id: isUuid(input.ownerId) ? input.ownerId : null,
    },
  };
}

/** Existující zákazník se stejným IČO / DIČ / názvem (kromě `exceptId`). */
async function findDuplicate(
  db: Awaited<ReturnType<typeof createOperatorClient>>,
  cols: CustomerColumns,
  exceptId?: string,
): Promise<{ id: string; label: string; by: "ico" | "dic" | "name" } | null> {
  const { data, error } = await fetchPaged<CustomerLookupRow & { customer_number: string | null }>(
    (from, to) => db.from("customers").select("id, name, ico, dic, customer_number").order("created_at").order("id").range(from, to),
    50_000,
  );
  if (error) return null;
  const rows = exceptId ? data.filter((r) => r.id !== exceptId) : data;
  const hit = matchCustomer(rows, {
    name: String(cols.name ?? ""),
    ico: (cols.ico as string | null) ?? undefined,
    dic: (cols.dic as string | null) ?? undefined,
  });
  if (!hit) return null;
  const row = rows.find((r) => r.id === hit.id);
  const why = hit.by === "ico" ? "stejné IČO" : hit.by === "dic" ? "stejné DIČ" : "stejný název";
  return { id: hit.id, by: hit.by, label: `${row?.customer_number ? `${row.customer_number} ` : ""}${row?.name ?? ""} (${why})` };
}

/**
 * `book` = kontaktní osoby a e-maily podle účelu z dialogu (uloží se hned po firmě, v jedné transakci);
 * bez něj starý údaj „Kontaktní osoba" založí první kontakt. `partySaved` = firma uložená, kontakty ne.
 */
export async function createCustomer(
  input: CustomerFormValues,
  book?: PartyBookInput | null,
): Promise<ActionResult<{ id: string; customerNumber: string | null; duplicateId: string; partySaved: boolean }>> {
  const auth = await checkFeature("customers");
  if ("error" in auth) return { ok: false, error: auth.error };
  if (!isSupabaseConfigured()) return { ok: false, error: NO_DB };
  const mapped = customerColumns(input);
  if ("error" in mapped) return { ok: false, error: mapped.error };
  const checked = checkBook("customer", book);
  if ("error" in checked) return { ok: false, error: checked.error };
  if (checked.book) mapped.cols.contact_person = bookContactPerson(checked.book);
  // #25: obchodník zákazníka určuje, komu připadnou jeho další zakázky (a provize) → cizího vybírá jen super admin
  if (auth.user.role !== "super_admin" && mapped.cols.owner_id && mapped.cols.owner_id !== auth.user.id) {
    return { ok: false, error: CUSTOMER_OWNER_ADMIN_ONLY };
  }
  // zaměstnanec obchodníkem zákazníka není — jím založený zákazník je bez obchodníka (přidělí super admin)
  if (auth.user.role === "zamestnanec") mapped.cols.owner_id = null;
  try {
    const db = await createOperatorClient({ actor: userActor(auth.user) });
    const dup = await findDuplicate(db, mapped.cols);
    if (dup) return { ok: false, error: `Tento zákazník už v adresáři je: ${dup.label}.`, duplicateId: dup.id };

    const row: CustomerColumns = { ...mapped.cols };
    const number = clean(input.customerNumber, 40);
    if (number) row.customer_number = number; // jinak přidělí DB (ZK0001…)
    const { data, error } = await db.from("customers").insert(row as never).select("id, customer_number").single();
    if (error || !data) return { ok: false, error: dbError(error?.message ?? "Zákazníka se nepodařilo uložit.", number) };
    const created = data as { id: string; customer_number: string | null };
    await logAudit({ action: "customer_created", entity: "customers", entityId: created.id, diff: { name: row.name } });
    let bookError: string | null = null;
    if (checked.book) bookError = await saveBookAfter(db, "customer", created.id, checked.book);
    // „Kontaktní osoba" z formuláře = první kontaktní osoba (jméno, e-mail, telefon) — maily se pak řídí jí
    else await ensureContactPerson(db, { customerId: created.id }, { name: row.contact_person as string | null, email: row.email as string | null, phone: row.phone as string | null }).catch(() => null);
    revalidateCustomer(created.id);
    if (bookError) return { ok: false, error: bookError, id: created.id, customerNumber: created.customer_number, partySaved: true };
    return { ok: true, id: created.id, customerNumber: created.customer_number };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba ukládání" };
  }
}

export async function updateCustomer(
  id: string,
  input: CustomerFormValues,
  book?: PartyBookInput | null,
): Promise<ActionResult<{ customerNumber: string | null; duplicateId: string; partySaved: boolean }>> {
  const auth = await checkFeature("customers");
  if ("error" in auth) return { ok: false, error: auth.error };
  if (!isUuid(id)) return { ok: false, error: "Neplatný zákazník." };
  if (!isSupabaseConfigured()) return { ok: false, error: NO_DB };
  const mapped = customerColumns(input);
  if ("error" in mapped) return { ok: false, error: mapped.error };
  const checked = checkBook("customer", book);
  if ("error" in checked) return { ok: false, error: checked.error };
  if (checked.book) mapped.cols.contact_person = bookContactPerson(checked.book);
  try {
    const db = await createOperatorClient({ actor: userActor(auth.user) });
    const { data: current } = await db.from("customers").select("id, customer_number, owner_id").eq("id", id).maybeSingle();
    if (!current) return { ok: false, error: "Zákazník neexistuje (možná ho někdo smazal)." };
    // #25: obchodníka zákazníka mění jen super admin (ostatní ho jen ponechají)
    if (auth.user.role !== "super_admin"
      && (mapped.cols.owner_id ?? null) !== ((current as { owner_id: string | null }).owner_id ?? null)) {
      return { ok: false, error: CUSTOMER_OWNER_ADMIN_ONLY };
    }

    const dup = await findDuplicate(db, mapped.cols, id);
    // stejný název u jiné firmy povolíme, IČO / DIČ ne
    if (dup && dup.by !== "name") {
      return { ok: false, error: `Stejné údaje už má jiný zákazník: ${dup.label}.`, duplicateId: dup.id };
    }

    const row: CustomerColumns = { ...mapped.cols };
    const number = clean(input.customerNumber, 40);
    if (number) row.customer_number = number; // prázdné = ponechat stávající číslo
    const { data, error } = await db.from("customers").update(row as never).eq("id", id).select("id, customer_number").maybeSingle();
    if (error || !data) return { ok: false, error: dbError(error?.message ?? "Zákazníka se nepodařilo uložit.", number) };
    await logAudit({ action: "customer_updated", entity: "customers", entityId: id, diff: { name: row.name } });
    let bookError: string | null = null;
    if (checked.book) bookError = await saveBookAfter(db, "customer", id, checked.book);
    else await ensureContactPerson(db, { customerId: id }, { name: row.contact_person as string | null, email: row.email as string | null, phone: row.phone as string | null }).catch(() => null);
    revalidateCustomer(id);
    const customerNumber = (data as { customer_number: string | null }).customer_number;
    if (bookError) return { ok: false, error: bookError, customerNumber, partySaved: true };
    return { ok: true, customerNumber };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba ukládání" };
  }
}

// ── Kontaktní osoby ─────────────────────────────────────────
export async function saveCustomerContact(
  customerId: string,
  input: ContactFormValues,
  contactId?: string,
): Promise<ActionResult<{ id: string }>> {
  const auth = await checkFeature("customers");
  if ("error" in auth) return { ok: false, error: auth.error };
  if (!isUuid(customerId)) return { ok: false, error: "Neplatný zákazník." };
  if (contactId !== undefined && !isUuid(contactId)) return { ok: false, error: "Neplatný kontakt." };
  if (!isSupabaseConfigured()) return { ok: false, error: NO_DB };
  const err = validateContactForm(input);
  if (err) return { ok: false, error: err };
  const row = {
    customer_id: customerId,
    name: clean(input.name, 200) ?? "",
    position: clean(input.position, 120),
    email: clean(input.email, 200)?.toLowerCase() ?? null,
    phone: clean(input.phone, 60),
    is_primary: Boolean(input.isPrimary),
  };
  try {
    const db = await createOperatorClient({ actor: userActor(auth.user) });
    let id = contactId;
    if (contactId) {
      const { data: before } = await db.from("customer_contacts").select("email").eq("id", contactId).eq("customer_id", customerId).maybeSingle();
      const { data, error } = await db.from("customer_contacts").update(row as never)
        .eq("id", contactId).eq("customer_id", customerId).select("id").maybeSingle();
      if (error) return { ok: false, error: translateDbError(error.message) };
      if (!data) return { ok: false, error: "Kontakt nenalezen." };
      // tykání všech kolegů s kontaktem jde za ním na novou adresu
      await moveToneEmail(db, (before as { email: string | null } | null)?.email, row.email);
    } else {
      const { data, error } = await db.from("customer_contacts").insert(row as never).select("id").single();
      if (error || !data) return { ok: false, error: translateDbError(error?.message ?? "Kontakt se nepodařilo uložit.") };
      id = (data as { id: string }).id;
    }
    // hlavní kontakt je jen jeden
    if (row.is_primary && id) {
      await db.from("customer_contacts").update({ is_primary: false } as never).eq("customer_id", customerId).neq("id", id);
    }
    revalidatePath(`/customers/${customerId}`);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Chyba ukládání" };
  }
}

export async function deleteCustomerContact(customerId: string, contactId: string): Promise<ActionResult> {
  const auth = await checkFeature("customers");
  if ("error" in auth) return { ok: false, error: auth.error };
  if (!isUuid(customerId) || !isUuid(contactId)) return { ok: false, error: "Neplatný kontakt." };
  if (!isSupabaseConfigured()) return { ok: false, error: NO_DB };
  try {
    const db = await createOperatorClient({ actor: userActor(auth.user) });
    const { error } = await db.from("customer_contacts").delete().eq("id", contactId).eq("customer_id", customerId);
    if (error) return { ok: false, error: translateDbError(error.message) };
    revalidatePath(`/customers/${customerId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Chyba mazání" };
  }
}

// ── Dodavatelé ──────────────────────────────────────────────
function supplierColumns(input: SupplierFormValues): { cols: Record<string, unknown> } | { error: string } {
  const err = firstError(validateSupplierForm(input));
  if (err) return { error: err };
  const icoRaw = clean(input.ico, 40);
  const ico = normalizeIco(icoRaw);
  if (icoRaw && !ico) return { error: "IČO má jen číslice (obvykle 8)." };
  const dicRaw = clean(input.dic, 40);
  const lead = parseLeadDays(input.leadDays ?? "");
  const website = clean(input.website, 300);
  return {
    cols: {
      name: clean(input.name) ?? "",
      ico,
      dic: dicRaw ? normalizeDic(dicRaw) ?? dicRaw.toUpperCase().replace(/\s/g, "") : null,
      address: clean(input.address, 500),
      country: normalizeCountry(input.country),
      email: clean(input.email, 200)?.toLowerCase() ?? null,
      phone: clean(input.phone, 60),
      contact_person: clean(input.contactPerson, 200),
      website: website ? websiteHref(website) ?? website : null,
      technologies: normalizeTags(Array.isArray(input.technologies) ? input.technologies : []),
      materials: normalizeTags(Array.isArray(input.materials) ? input.materials : []),
      certifications: normalizeTags(Array.isArray(input.certifications) ? input.certifications : []),
      lead_days: Number.isNaN(lead) ? null : lead,
      rating: clampRating(input.rating),
      note: clean(input.note, 5000),
    },
  };
}

function revalidateSuppliers() {
  revalidatePath("/suppliers");
  revalidatePath("/orders");
}

export async function createSupplier(
  input: SupplierFormValues,
  book?: PartyBookInput | null,
): Promise<ActionResult<{ id: string; duplicateId: string; partySaved: boolean }>> {
  const auth = await checkFeature("suppliers");
  if ("error" in auth) return { ok: false, error: auth.error };
  if (!isSupabaseConfigured()) return { ok: false, error: NO_DB };
  const mapped = supplierColumns(input);
  if ("error" in mapped) return { ok: false, error: mapped.error };
  const checked = checkBook("supplier", book);
  if ("error" in checked) return { ok: false, error: checked.error };
  if (checked.book) mapped.cols.contact_person = bookContactPerson(checked.book);
  try {
    const db = await createOperatorClient({ actor: userActor(auth.user) });
    const { data: existing } = await db.from("suppliers").select("id, name, ico, dic");
    const hit = matchCustomer((existing ?? []) as CustomerLookupRow[], {
      name: String(mapped.cols.name),
      ico: (mapped.cols.ico as string | null) ?? undefined,
      dic: (mapped.cols.dic as string | null) ?? undefined,
    });
    if (hit) {
      const name = ((existing ?? []) as CustomerLookupRow[]).find((r) => r.id === hit.id)?.name ?? "";
      return { ok: false, error: `Tento dodavatel už v adresáři je: ${name}.`, duplicateId: hit.id };
    }
    const { data, error } = await db.from("suppliers").insert(mapped.cols as never).select("id").single();
    if (error || !data) return { ok: false, error: translateDbError(error?.message ?? "Dodavatele se nepodařilo uložit.") };
    const id = (data as { id: string }).id;
    await logAudit({ action: "supplier_created", entity: "suppliers", entityId: id, diff: { name: mapped.cols.name } });
    let bookError: string | null = null;
    if (checked.book) bookError = await saveBookAfter(db, "supplier", id, checked.book);
    else {
      await ensureContactPerson(db, { supplierId: id }, {
        name: mapped.cols.contact_person as string | null, email: mapped.cols.email as string | null, phone: mapped.cols.phone as string | null,
      }).catch(() => null);
    }
    revalidateSuppliers();
    if (bookError) return { ok: false, error: bookError, id, partySaved: true };
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba ukládání" };
  }
}

export async function updateSupplier(id: string, input: SupplierFormValues, book?: PartyBookInput | null): Promise<ActionResult<{ partySaved: boolean }>> {
  const auth = await checkFeature("suppliers");
  if ("error" in auth) return { ok: false, error: auth.error };
  if (!isUuid(id)) return { ok: false, error: "Neplatný dodavatel." };
  if (!isSupabaseConfigured()) return { ok: false, error: NO_DB };
  const mapped = supplierColumns(input);
  if ("error" in mapped) return { ok: false, error: mapped.error };
  const checked = checkBook("supplier", book);
  if ("error" in checked) return { ok: false, error: checked.error };
  if (checked.book) mapped.cols.contact_person = bookContactPerson(checked.book);
  try {
    const db = await createOperatorClient({ actor: userActor(auth.user) });
    const { data, error } = await db.from("suppliers").update(mapped.cols as never).eq("id", id).select("id").maybeSingle();
    if (error) return { ok: false, error: translateDbError(error.message) };
    if (!data) return { ok: false, error: "Dodavatel neexistuje (možná ho někdo smazal)." };
    await logAudit({ action: "supplier_updated", entity: "suppliers", entityId: id, diff: { name: mapped.cols.name } });
    let bookError: string | null = null;
    if (checked.book) bookError = await saveBookAfter(db, "supplier", id, checked.book);
    else {
      await ensureContactPerson(db, { supplierId: id }, {
        name: mapped.cols.contact_person as string | null, email: mapped.cols.email as string | null, phone: mapped.cols.phone as string | null,
      }).catch(() => null);
    }
    revalidateSuppliers();
    if (bookError) return { ok: false, error: bookError, partySaved: true };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba ukládání" };
  }
}

// ── Cenový profil zákazníka (AI nacenění) ───────────────────
/** Zákaznický cenový profil (Nacenění v2) — marže, hladina, priorita, morálka, riziko. */
export async function updateCustomerPricingProfile(input: {
  id: string;
  marginPercent?: string;
  priceLevel?: string;
  businessPriority?: string;
  paymentMorale?: string;
  riskLevel?: string;
  annualRevenueCzk?: string;
  repeatCustomer?: boolean;
}): Promise<ActionResult> {
  const auth = await checkFeature("customers");
  if ("error" in auth) return { ok: false, error: auth.error };
  const { can } = await getAccess();
  if (!can("ai_pricing") && !can("margins")) return { ok: false, error: "K této akci nemáš oprávnění." };
  if (!isUuid(input.id)) return { ok: false, error: "Chybí zákazník." };
  if (!isSupabaseConfigured()) return { ok: false, error: NO_DB };
  const numOrNull = (v?: string) => {
    const n = Number(v);
    return v?.trim() && Number.isFinite(n) ? n : null;
  };
  const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[]): T | null =>
    v && (allowed as readonly string[]).includes(v) ? (v as T) : null;
  try {
    const db = await createOperatorClient({ actor: userActor(auth.user) });
    const { error } = await db
      .from("customers")
      .update({
        margin_percent: numOrNull(input.marginPercent),
        price_level: oneOf(input.priceLevel, ["nizka", "standard", "premium"] as const),
        business_priority: oneOf(input.businessPriority, ["nizka", "stredni", "vysoka", "strategicky"] as const),
        payment_morale: oneOf(input.paymentMorale, ["vyborna", "dobra", "prumerna", "spatna"] as const),
        risk_level: oneOf(input.riskLevel, ["nizke", "stredni", "vysoke"] as const),
        annual_revenue_czk: numOrNull(input.annualRevenueCzk),
        repeat_customer: Boolean(input.repeatCustomer),
      } as never)
      .eq("id", input.id);
    if (error) return { ok: false, error: translateDbError(error.message) };
    revalidatePath(`/customers/${input.id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}
