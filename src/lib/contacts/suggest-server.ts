import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeSuggestions, type RecipientSuggestion } from "@/lib/contacts/suggest";
import { loadAddressBook, type PartyRef } from "@/lib/contacts/server";
import { ROLE_TEXT, isContactRole, normEmail, type PartyKind } from "@/lib/contacts/roles";

/**
 * Našeptávač adres na serveru: zákazníci, jejich kontaktní osoby a e-maily podle účelu, dodavatelé a jejich
 * kontakty, kolegové a adresy z konverzací (mail_address_suggest — jen pošta, kterou uživatel smí vidět).
 * Obchodník bez práva na celou poštu dostane z adresáře jen své zákazníky a zákazníky bez obchodníka;
 * adresy zákazníka / dodavatele otevřené zakázky (kontext) vždy — tu zakázku vidí.
 */

export interface SuggestViewer {
  userId: string;
  /** Super admin — všechna pošta i všichni zákazníci. */
  all: boolean;
  /** Smí poštu (adresy z konverzací). */
  mail: boolean;
}

export interface SuggestContext extends PartyRef {
  jobId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
type Embed<T> = T | T[] | null | undefined;
const one = <T,>(v: Embed<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** Dotaz do filtru PostgREST bez znaků, které by filtr rozbily. */
export function cleanQuery(q: string | null | undefined): string {
  return String(q ?? "").replace(/[%_,()\\*:"'<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

function roleLabels(kind: PartyKind, roles: string[]): string[] {
  return [...new Set(roles.filter(isContactRole).map((r) => ROLE_TEXT[kind][r].label))];
}

/** Kontext zakázky → zákazník a kontakt zakázky. */
async function jobContext(db: SupabaseClient, jobId: string): Promise<{ customerId: string | null; contactEmail: string | null; contactName: string | null } | null> {
  const { data } = await db.from("orders").select("customer_id, customer_contact_email, customer_contact").eq("id", jobId).maybeSingle();
  if (!data) return null;
  const r = data as { customer_id: string | null; customer_contact_email: string | null; customer_contact: string | null };
  return { customerId: r.customer_id, contactEmail: normEmail(r.customer_contact_email), contactName: r.customer_contact };
}

/** Adresy firmy z kontextu (kontakty, role, e-mail firmy) — nahoře i bez psaní. */
async function relatedSuggestions(db: SupabaseClient, ctx: SuggestContext): Promise<RecipientSuggestion[]> {
  const out: RecipientSuggestion[] = [];
  let party: PartyRef = { customerId: ctx.customerId ?? null, supplierId: ctx.supplierId ?? null };
  if (isUuid(ctx.jobId) && !isUuid(party.customerId) && !isUuid(party.supplierId)) {
    const job = await jobContext(db, ctx.jobId);
    if (job?.customerId) party = { customerId: job.customerId };
    if (job?.contactEmail) out.push({ email: job.contactEmail, name: job.contactName?.trim() || job.contactEmail, kind: "kontakt", related: true, roles: ["Kontakt zakázky"] });
  }
  const book = await loadAddressBook(db, party).catch(() => null);
  if (!book) return out;
  const { data: nameRow } = await db.from(book.kind === "customer" ? "customers" : "suppliers").select("name")
    .eq("id", (book.kind === "customer" ? party.customerId : party.supplierId) as string).maybeSingle();
  const company = (nameRow as { name: string } | null)?.name ?? null;
  const kind = book.kind === "customer" ? "kontakt" as const : "dodavatel" as const;
  for (const c of book.contacts) {
    if (!c.email) continue;
    out.push({
      email: c.email, name: c.name, kind, company, position: c.position, phone: c.phone, related: true,
      roles: roleLabels(book.kind, book.roles.filter((r) => r.contactId === c.id).map((r) => r.role)),
    });
  }
  for (const r of book.roles) {
    if (!r.email || r.contactId) continue;
    out.push({ email: r.email, name: company ?? r.email, kind: book.kind === "customer" ? "zákazník" : "dodavatel", company, related: true, roles: roleLabels(book.kind, [r.role]) });
  }
  if (book.partyEmail) out.push({ email: book.partyEmail, name: company ?? book.partyEmail, kind: book.kind === "customer" ? "zákazník" : "dodavatel", company, related: true });
  return out;
}

/** Našeptání adres pro dotaz (prázdný dotaz = související + nejčastější z pošty). */
export async function searchRecipients(
  dbIn: unknown, viewer: SuggestViewer, query: string, ctx: SuggestContext = {}, opts: { exclude?: string[]; limit?: number } = {},
): Promise<RecipientSuggestion[]> {
  const db = dbIn as SupabaseClient;
  const q = cleanQuery(query);
  const lists: RecipientSuggestion[][] = [];
  const hasCtx = isUuid(ctx.customerId) || isUuid(ctx.supplierId) || isUuid(ctx.jobId);
  const related = hasCtx ? relatedSuggestions(db, ctx).catch(() => []) : Promise.resolve([]);
  const conv = viewer.mail
    ? Promise.resolve(db.rpc("mail_address_suggest", { p_q: q, p_user: viewer.userId, p_all: viewer.all, p_limit: q ? 15 : 8 }))
      .then(({ data, error }) => (error ? [] : ((data ?? []) as { email: string; name: string | null; hits: number; last_at: string | null }[])))
      .catch(() => [])
    : Promise.resolve([]);

  if (q.length < 2) {
    const [rel, mail] = await Promise.all([related, conv]);
    lists.push(rel, mail.map((m) => ({ email: m.email, name: m.name ?? m.email, kind: "konverzace" as const, hits: m.hits, lastAt: m.last_at })));
    return mergeSuggestions(lists, "", { exclude: opts.exclude, limit: opts.limit ?? 8 });
  }

  const like = `%${q}%`;
  const own = viewer.all ? null : viewer.userId;
  let customers = db.from("customers").select("id, name, email, owner_id").or(`name.ilike.${like},email.ilike.${like}`).not("email", "is", null).limit(8);
  if (own) customers = customers.or(`owner_id.eq.${own},owner_id.is.null`);
  const [cu, cc, sc, su, us, re, rel, mail] = await Promise.all([
    customers,
    db.from("customer_contacts").select("id, name, email, position, phone, customer:customers!customer_id(name, owner_id)")
      .or(`name.ilike.${like},email.ilike.${like},position.ilike.${like}`).not("email", "is", null).limit(15),
    db.from("supplier_contacts").select("id, name, email, position, phone, supplier:suppliers!supplier_id(name)")
      .or(`name.ilike.${like},email.ilike.${like},position.ilike.${like}`).not("email", "is", null).limit(10),
    db.from("suppliers").select("name, email, contact_person").or(`name.ilike.${like},email.ilike.${like},contact_person.ilike.${like}`).not("email", "is", null).limit(8),
    db.from("profiles").select("full_name, email, active").or(`full_name.ilike.${like},email.ilike.${like}`).limit(8),
    db.from("party_role_emails").select("role, email, customer:customers!customer_id(name, owner_id), supplier:suppliers!supplier_id(name)")
      .ilike("email", like).limit(10),
    related,
    conv,
  ]);

  const visibleCustomer = (c: { owner_id: string | null } | null) => !own || !c || !c.owner_id || c.owner_id === own;
  lists.push(rel);
  lists.push(((us.data ?? []) as { full_name: string | null; email: string | null; active: boolean | null }[])
    .filter((r) => r.active !== false && normEmail(r.email))
    .map((r) => ({ email: normEmail(r.email)!, name: r.full_name?.trim() || r.email!, kind: "kolega" as const })));
  lists.push(((cu.data ?? []) as { name: string; email: string | null }[])
    .filter((r) => normEmail(r.email))
    .map((r) => ({ email: normEmail(r.email)!, name: r.name, kind: "zákazník" as const, company: r.name })));

  // role kontaktních osob (Fakturace, Nabídky…) pro nalezené kontakty
  type CRow = { id: string; name: string; email: string | null; position: string | null; phone: string | null; customer: Embed<{ name: string | null; owner_id: string | null }> };
  type SRow = { id: string; name: string; email: string | null; position: string | null; phone: string | null; supplier: Embed<{ name: string | null }> };
  const cRows = ((cc.data ?? []) as CRow[]).filter((r) => visibleCustomer(one(r.customer)) && normEmail(r.email));
  const sRows = ((sc.error ? [] : sc.data ?? []) as SRow[]).filter((r) => normEmail(r.email));
  const roleBy = new Map<string, string[]>();
  if (cRows.length || sRows.length) {
    const [cr, sr] = await Promise.all([
      cRows.length ? db.from("party_role_emails").select("role, contact_id").in("contact_id", cRows.map((r) => r.id)) : Promise.resolve({ data: [] }),
      sRows.length ? db.from("party_role_emails").select("role, supplier_contact_id").in("supplier_contact_id", sRows.map((r) => r.id)) : Promise.resolve({ data: [] }),
    ]);
    for (const r of (cr.data ?? []) as { role: string; contact_id: string }[]) roleBy.set(r.contact_id, [...(roleBy.get(r.contact_id) ?? []), ...roleLabels("customer", [r.role])]);
    for (const r of (sr.data ?? []) as { role: string; supplier_contact_id: string }[]) roleBy.set(r.supplier_contact_id, [...(roleBy.get(r.supplier_contact_id) ?? []), ...roleLabels("supplier", [r.role])]);
  }
  lists.push(cRows.map((r) => ({
    email: normEmail(r.email)!, name: r.name, kind: "kontakt" as const, company: one(r.customer)?.name ?? null, position: r.position, phone: r.phone, roles: roleBy.get(r.id),
  })));
  lists.push(sRows.map((r) => ({
    email: normEmail(r.email)!, name: r.name, kind: "dodavatel" as const, company: one(r.supplier)?.name ?? null, position: r.position, phone: r.phone, roles: roleBy.get(r.id),
  })));
  lists.push(((su.data ?? []) as { name: string; email: string | null; contact_person: string | null }[])
    .filter((r) => normEmail(r.email))
    .map((r) => ({ email: normEmail(r.email)!, name: r.contact_person?.trim() || r.name, kind: "dodavatel" as const, company: r.name })));
  type RRow = { role: string; email: string | null; customer: Embed<{ name: string | null; owner_id: string | null }>; supplier: Embed<{ name: string | null }> };
  lists.push(((re.error ? [] : re.data ?? []) as RRow[])
    .filter((r) => normEmail(r.email) && (one(r.supplier) || visibleCustomer(one(r.customer))))
    .map((r) => {
      const sup = one(r.supplier);
      const company = sup?.name ?? one(r.customer)?.name ?? null;
      return {
        email: normEmail(r.email)!, name: company ?? normEmail(r.email)!, kind: sup ? "dodavatel" as const : "zákazník" as const, company,
        roles: roleLabels(sup ? "supplier" : "customer", [r.role]),
      };
    }));
  lists.push(mail.map((m) => ({ email: m.email, name: m.name ?? m.email, kind: "konverzace" as const, hits: m.hits, lastAt: m.last_at })));
  return mergeSuggestions(lists, q, { exclude: opts.exclude, limit: opts.limit ?? 10 });
}
