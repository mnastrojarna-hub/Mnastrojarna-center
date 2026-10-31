import "server-only";
import type { JobsDb } from "@/lib/jobs/events";
import { isUuid, translateDbError } from "@/lib/jobs/mapping";
import {
  addDays, cleanPlanInput, UPCOMING_INVOICE_DAYS,
  type PaymentPlanData, type PaymentPlanEntry, type PaymentPlanInput, type PaymentPlanInvoiceRef, type PlanInvoiceOption, type UpcomingInvoice,
} from "@/lib/supplier-invoices/payment-plan";

export type { PlanInvoiceOption };

/**
 * Platební plán — server (servisní klient s autorem; OPRÁVNĚNÍ = super admin HLÍDÁ VOLAJÍCÍ i trigger v DB).
 * Řádky jsou poznámky: komu, kolik, kdy (+ volitelně faktura, poznámka). Zaplaceno = datum + kdo.
 */

type Row = Record<string, unknown>;
type Fail = { ok: false; error: string };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const nameOf = (p: Row | null): string | null => String(p?.full_name ?? p?.email ?? "").trim() || null;

const ENTRY_SELECT = [
  "id, payee, amount, currency, due_on, note, paid_at, created_at, invoice_id",
  "invoice:supplier_invoices!invoice_id(id, number, supplier_name, payment_status, supplier:suppliers!supplier_id(name))",
  "payer:profiles!paid_by(full_name, email)",
  "author:profiles!created_by(full_name, email)",
].join(", ");

function err(e: unknown): Fail {
  const m = (e as { message?: unknown } | null)?.message;
  return { ok: false, error: typeof m === "string" ? translateDbError(m) : "Neočekávaná chyba." };
}

function invoiceRef(v: unknown): PaymentPlanInvoiceRef | null {
  const r = one(v as Row | Row[] | null);
  if (!r) return null;
  const sup = one(r.supplier as Row | Row[] | null);
  const ps = String(r.payment_status ?? "");
  return {
    id: String(r.id),
    number: (r.number as string | null) || null,
    supplierName: String(sup?.name ?? r.supplier_name ?? "").trim() || null,
    paymentStatus: ps === "nezaplaceno" || ps === "castecne" || ps === "zaplaceno" ? ps : null,
  };
}

export function toEntry(r: Row): PaymentPlanEntry {
  return {
    id: String(r.id),
    payee: String(r.payee ?? ""),
    amount: num(r.amount) ?? 0,
    currency: String(r.currency ?? "CZK"),
    dueOn: String(r.due_on ?? "").slice(0, 10),
    note: (r.note as string | null) || null,
    invoice: invoiceRef(r.invoice),
    paidAt: r.paid_at ? String(r.paid_at).slice(0, 10) : null,
    paidByName: nameOf(one(r.payer as Row | Row[] | null)),
    createdByName: nameOf(one(r.author as Row | Row[] | null)),
    createdAt: String(r.created_at ?? ""),
  };
}

export async function loadPaymentPlan(db: JobsDb, today: string): Promise<PaymentPlanData | Fail> {
  const since = addDays(today, -30);
  const until = addDays(today, UPCOMING_INVOICE_DAYS);
  const [plan, invoices, suppliers] = await Promise.all([
    db.from("supplier_payment_plan").select(ENTRY_SELECT).or(`paid_at.is.null,paid_at.gte.${since}`).order("due_on").order("created_at").limit(500),
    db.from("supplier_invoices")
      .select("id, number, supplier_name, due_date, currency, total_gross, total_net, paid_amount, payment_status, supplier:suppliers!supplier_id(name)")
      .neq("payment_status", "zaplaceno").is("duplicate_of_id", null).neq("status", "zamitnuto").eq("is_credit_note", false)
      .not("due_date", "is", null).lte("due_date", until).order("due_date").limit(50),
    db.from("suppliers").select("name").order("name").limit(500),
  ]);
  if (plan.error) return err(plan.error);
  const entries = ((plan.data ?? []) as Row[]).map(toEntry);
  const inPlan = new Set(entries.filter((e) => !e.paidAt && e.invoice).map((e) => e.invoice!.id));
  const upcomingInvoices: UpcomingInvoice[] = ((invoices.data ?? []) as Row[]).map((r) => {
    const sup = one(r.supplier as Row | Row[] | null);
    const gross = num(r.total_gross) ?? num(r.total_net);
    const paid = r.payment_status === "castecne" ? num(r.paid_amount) ?? 0 : 0;
    const due = String(r.due_date).slice(0, 10);
    return {
      id: String(r.id), number: (r.number as string | null) || null,
      supplierName: String(sup?.name ?? r.supplier_name ?? "").trim() || null,
      dueDate: due, amount: gross === null ? null : Math.round((gross - paid) * 100) / 100,
      currency: String(r.currency ?? "CZK"), overdue: due < today, inPlan: inPlan.has(String(r.id)),
    };
  });
  const names = new Set<string>();
  for (const s of (suppliers.data ?? []) as Row[]) { const n = String(s.name ?? "").trim(); if (n) names.add(n); }
  for (const e of entries) names.add(e.payee);
  return { today, entries, upcomingInvoices, payees: [...names].sort((a, b) => a.localeCompare(b, "cs")).slice(0, 600) };
}

async function getEntry(db: JobsDb, id: string): Promise<PaymentPlanEntry | null> {
  const { data } = await db.from("supplier_payment_plan").select(ENTRY_SELECT).eq("id", id).maybeSingle();
  return data ? toEntry(data as Row) : null;
}

async function invoiceExists(db: JobsDb, id: string | null): Promise<boolean> {
  if (!id) return true;
  const { data } = await db.from("supplier_invoices").select("id").eq("id", id).maybeSingle();
  return Boolean(data);
}

export async function createPlanEntry(db: JobsDb, input: Partial<PaymentPlanInput>): Promise<{ ok: true; entry: PaymentPlanEntry } | Fail> {
  const c = cleanPlanInput(input);
  if (typeof c === "string") return { ok: false, error: c };
  if (!(await invoiceExists(db, c.invoiceId))) return { ok: false, error: "Faktura nenalezena." };
  const { data, error } = await db.from("supplier_payment_plan").insert({
    payee: c.payee, amount: c.amount, currency: c.currency, due_on: c.dueOn, invoice_id: c.invoiceId, note: c.note,
  } as never).select("id").single();
  if (error || !data) return err(error);
  const entry = await getEntry(db, (data as { id: string }).id);
  return entry ? { ok: true, entry } : { ok: false, error: "Řádek se nepodařilo načíst." };
}

export async function updatePlanEntry(db: JobsDb, id: string, input: Partial<PaymentPlanInput>): Promise<{ ok: true; entry: PaymentPlanEntry; before: PaymentPlanEntry } | Fail> {
  if (!isUuid(id)) return { ok: false, error: "Řádek plánu nenalezen." };
  const before = await getEntry(db, id);
  if (!before) return { ok: false, error: "Řádek plánu nenalezen." };
  const c = cleanPlanInput(input);
  if (typeof c === "string") return { ok: false, error: c };
  if (!(await invoiceExists(db, c.invoiceId))) return { ok: false, error: "Faktura nenalezena." };
  const { error } = await db.from("supplier_payment_plan").update({
    payee: c.payee, amount: c.amount, currency: c.currency, due_on: c.dueOn, invoice_id: c.invoiceId, note: c.note,
  } as never).eq("id", id);
  if (error) return err(error);
  const entry = await getEntry(db, id);
  return entry ? { ok: true, entry, before } : { ok: false, error: "Řádek plánu nenalezen." };
}

/** Zaplaceno (datum, kdo) / vrátit na nezaplaceno. */
export async function setPlanEntryPaid(db: JobsDb, id: string, paidAt: string | null): Promise<{ ok: true; entry: PaymentPlanEntry } | Fail> {
  if (!isUuid(id)) return { ok: false, error: "Řádek plánu nenalezen." };
  if (paidAt !== null && !/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) return { ok: false, error: "Neplatné datum." };
  const { data, error } = await db.from("supplier_payment_plan").update({ paid_at: paidAt } as never).eq("id", id).select("id");
  if (error) return err(error);
  if (!(data ?? []).length) return { ok: false, error: "Řádek plánu nenalezen." };
  const entry = await getEntry(db, id);
  return entry ? { ok: true, entry } : { ok: false, error: "Řádek plánu nenalezen." };
}

export async function deletePlanEntry(db: JobsDb, id: string): Promise<{ ok: true; entry: PaymentPlanEntry } | Fail> {
  if (!isUuid(id)) return { ok: false, error: "Řádek plánu nenalezen." };
  const entry = await getEntry(db, id);
  if (!entry) return { ok: false, error: "Řádek plánu nenalezen." };
  const { error } = await db.from("supplier_payment_plan").delete().eq("id", id);
  if (error) return err(error);
  return { ok: true, entry };
}

/** Faktury pro odkaz z plánu: podle čísla / dodavatele (prázdné = nezaplacené podle splatnosti). */
export async function searchPlanInvoices(db: JobsDb, q: string): Promise<PlanInvoiceOption[]> {
  const term = String(q ?? "").replace(/[%,()*\\]/g, " ").trim().slice(0, 60);
  let query = db.from("supplier_invoices")
    .select("id, number, supplier_name, due_date, currency, total_gross, total_net, paid_amount, payment_status, supplier:suppliers!supplier_id(name)")
    .is("duplicate_of_id", null).neq("status", "zamitnuto");
  if (term) query = query.or(`number.ilike.%${term}%,supplier_name.ilike.%${term}%,variable_symbol.ilike.%${term}%`).order("due_date", { ascending: false, nullsFirst: false });
  else query = query.neq("payment_status", "zaplaceno").order("due_date", { ascending: true, nullsFirst: false });
  const { data } = await query.limit(8);
  return ((data ?? []) as Row[]).map((r) => {
    const sup = one(r.supplier as Row | Row[] | null);
    const gross = num(r.total_gross) ?? num(r.total_net);
    const paid = r.payment_status === "castecne" ? num(r.paid_amount) ?? 0 : 0;
    return {
      id: String(r.id), number: (r.number as string | null) || null,
      supplierName: String(sup?.name ?? r.supplier_name ?? "").trim() || null,
      dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null,
      amount: gross === null ? null : Math.round((gross - paid) * 100) / 100,
      currency: String(r.currency ?? "CZK"), paymentStatus: String(r.payment_status ?? ""),
    };
  });
}
