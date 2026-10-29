"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess, getSessionUser } from "@/lib/auth/session";
import { userActor } from "@/lib/supabase/actor-headers";
import type { JobsDb } from "@/lib/jobs/events";
import type { CurrentUser } from "@/lib/data/current-user";
import { logAudit } from "@/lib/audit";
import { getSetting, invalidateSettingsCache } from "@/lib/settings";
import { cleanDate, cleanText, isUuid, translateDbError } from "@/lib/jobs/mapping";
import { parseVisibility, supplierInvoicePerms, VISIBILITY_SETTING_KEY, type SupplierInvoiceVisibility } from "@/lib/supplier-invoices/access";
import { parseAmount, round2 } from "@/lib/supplier-invoices/money";
import { normalizeCurrency } from "@/lib/supplier-invoices/extract";
import {
  confirmAiAllocations, deleteSupplierInvoice as deleteInvoiceCore, fillExchangeRate, numberNorm, partyOfInvoice, saveAllocations, saveItems,
  setFinalPurchaseOrder, setPayment, supplierKeyOf, upsertSupplierFromParty,
} from "@/lib/supplier-invoices/service";
import { cnbRate } from "@/lib/supplier-invoices/cnb-rate";
import { fetchSupplierInvoiceDetail, getJobInvoiceCosts, jobItemsForInvoice, searchJobsForInvoice } from "@/lib/data/supplier-invoices";
import type {
  AllocationInput, JobInvoiceCosts, JobRefView, SupplierInvoiceDetail, SupplierInvoicePaymentStatus, SupplierInvoicePerms,
} from "@/lib/supplier-invoices/types";
import type { SupplierInvoiceRow } from "@/lib/supplier-invoices/db-types";

/**
 * Akce Faktur dodavatelů. Každá ověří práva (vidět / upravovat / zaplaceno) — zápis servisním klientem
 * s autorem (x-actor), DB hlídá totéž (zaplaceno jen super admin, kapacita rozdělení).
 */

type Ok<T = object> = { ok: true } & T;
type Fail = { ok: false; error: string };

interface Ctx { db: JobsDb; user: CurrentUser; perms: SupplierInvoicePerms }

const NO_RIGHT = "K této akci nemáš oprávnění.";
const NOT_FOUND = "Faktura nenalezena.";

async function begin(need: "view" | "edit" | "paid"): Promise<Ctx | Fail> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  const user = await getSessionUser();
  if (!user || !user.active) return { ok: false, error: "Nejsi přihlášen — přihlas se znovu." };
  const access = await getAccess();
  const perms = supplierInvoicePerms(access.can);
  if (!perms[need]) return { ok: false, error: NO_RIGHT };
  const db = await createOperatorClient({ actor: userActor(user) });
  return { db, user, perms };
}

function fail(err: unknown): Fail {
  if (typeof err === "string") return { ok: false, error: translateDbError(err) };
  const m = (err as { message?: unknown } | null)?.message;
  return { ok: false, error: typeof m === "string" ? translateDbError(m) : "Neočekávaná chyba." };
}

function revalidate(id?: string, jobIds: (string | null | undefined)[] = []) {
  try {
    revalidatePath("/supplier-invoices");
    if (id) revalidatePath(`/supplier-invoices/${id}`);
    for (const j of jobIds) if (j) revalidatePath(`/orders/${j}`);
    revalidatePath("/commissions");
  } catch {
    // mimo požadavek Next.js
  }
}

async function jobIdsOf(db: JobsDb, id: string): Promise<string[]> {
  const { data } = await db.from("supplier_invoice_allocations").select("job_id").eq("invoice_id", id).not("job_id", "is", null);
  return [...new Set(((data ?? []) as { job_id: string }[]).map((r) => r.job_id))];
}

/** Čerstvý detail po změně (s redakcí podle práv). */
async function detail(c: Ctx, id: string): Promise<SupplierInvoiceDetail | null> {
  return fetchSupplierInvoiceDetail(c.db, id, c.perms);
}

// ── Rozdělení ───────────────────────────────────────────────
export async function saveSupplierInvoiceAllocations(id: string, rows: AllocationInput[]): Promise<Ok<{ invoice: SupplierInvoiceDetail | null }> | Fail> {
  const c = await begin("edit");
  if ("error" in c) return c;
  if (!isUuid(id)) return { ok: false, error: NOT_FOUND };
  try {
    const before = await jobIdsOf(c.db, id);
    const res = await saveAllocations(c.db, id, Array.isArray(rows) ? rows : []);
    if (!res.ok) return res;
    const after = await jobIdsOf(c.db, id);
    await logAudit({ action: "supplier_invoice_allocated", entity: "supplier_invoices", entityId: id, diff: { rows: rows.length, status: res.status }, actor: userActor(c.user) });
    revalidate(id, [...before, ...after]);
    return { ok: true, invoice: await detail(c, id) };
  } catch (err) {
    return fail(err);
  }
}

export async function confirmSupplierInvoiceAi(id: string): Promise<Ok<{ confirmed: number; invoice: SupplierInvoiceDetail | null }> | Fail> {
  const c = await begin("edit");
  if ("error" in c) return c;
  try {
    const res = await confirmAiAllocations(c.db, id);
    if (!res.ok) return res;
    await logAudit({ action: "supplier_invoice_confirmed", entity: "supplier_invoices", entityId: id, diff: { confirmed: res.confirmed }, actor: userActor(c.user) });
    revalidate(id, await jobIdsOf(c.db, id));
    return { ok: true, confirmed: res.confirmed, invoice: await detail(c, id) };
  } catch (err) {
    return fail(err);
  }
}

// ── Zaplaceno (jen super admin) ─────────────────────────────
export async function setSupplierInvoicePayment(
  id: string,
  input: { status: SupplierInvoicePaymentStatus; paidAt?: string | null; paidAmount?: number | null },
): Promise<Ok<{ invoice: SupplierInvoiceDetail | null }> | Fail> {
  const c = await begin("paid");
  if ("error" in c) return c;
  try {
    const res = await setPayment(c.db, id, input);
    if (!res.ok) return res;
    await logAudit({ action: "supplier_invoice_payment", entity: "supplier_invoices", entityId: id, diff: { status: input.status, paidAt: input.paidAt ?? null }, actor: userActor(c.user) });
    revalidate(id);
    return { ok: true, invoice: await detail(c, id) };
  } catch (err) {
    return fail(err);
  }
}

// ── Hlavička, položky, dodavatel ────────────────────────────
export interface InvoiceHeaderPatch {
  number?: string | null;
  variableSymbol?: string | null;
  issueDate?: string | null;
  taxableDate?: string | null;
  dueDate?: string | null;
  currency?: string | null;
  exchangeRate?: number | string | null;
  totalNet?: number | string | null;
  totalVat?: number | string | null;
  totalGross?: number | string | null;
  note?: string | null;
  supplierId?: string | null;
  /** Zálohová (proforma) faktura — do nákladů se nepočítá. */
  isProforma?: boolean;
}

function money(v: unknown): number | null | "bad" {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? round2(v) : "bad";
  const p = parseAmount(String(v));
  return p === null ? "bad" : p;
}

export async function updateSupplierInvoiceHeader(id: string, patch: InvoiceHeaderPatch): Promise<Ok<{ invoice: SupplierInvoiceDetail | null }> | Fail> {
  const c = await begin("edit");
  if ("error" in c) return c;
  if (!isUuid(id) || !patch || typeof patch !== "object") return { ok: false, error: NOT_FOUND };
  const row: Record<string, unknown> = {};
  if ("number" in patch) row.number = cleanText(patch.number, 60);
  if ("variableSymbol" in patch) row.variable_symbol = cleanText(patch.variableSymbol, 20)?.replace(/\D+/g, "") || null;
  for (const [k, col] of [["issueDate", "issue_date"], ["taxableDate", "taxable_date"], ["dueDate", "due_date"]] as const) {
    if (k in patch) {
      const v = patch[k];
      const d = v ? cleanDate(v) : null;
      if (v && !d) return { ok: false, error: "Neplatné datum (RRRR-MM-DD)." };
      row[col] = d;
    }
  }
  if ("currency" in patch) row.currency = normalizeCurrency(patch.currency ?? "CZK");
  for (const [k, col] of [["totalNet", "total_net"], ["totalVat", "total_vat"], ["totalGross", "total_gross"], ["exchangeRate", "exchange_rate"]] as const) {
    if (k in patch) {
      const v = money(patch[k]);
      if (v === "bad") return { ok: false, error: "Neplatná částka." };
      if (col === "exchange_rate" && v !== null && v <= 0) return { ok: false, error: "Kurz musí být kladný." };
      row[col] = v;
    }
  }
  if ("note" in patch) row.note = cleanText(patch.note, 2000);
  if ("isProforma" in patch) row.is_proforma = patch.isProforma === true;
  if ("supplierId" in patch) {
    if (patch.supplierId && !isUuid(patch.supplierId)) return { ok: false, error: "Dodavatel nenalezen." };
    row.supplier_id = patch.supplierId || null;
    if (patch.supplierId) {
      const { data: s } = await c.db.from("suppliers").select("ico").eq("id", patch.supplierId).maybeSingle();
      const ico = (s as { ico: string | null } | null)?.ico;
      if (ico) row.supplier_ico = ico.replace(/\D+/g, "");
    }
  }
  if (!Object.keys(row).length) return { ok: true, invoice: await detail(c, id) };
  try {
    // duplicita podle dodavatele + čísla → hláška místo chyby indexu
    const { data: cur } = await c.db.from("supplier_invoices")
      .select("number, supplier_id, supplier_ico, supplier_name, duplicate_of_id, currency, exchange_rate, taxable_date, issue_date").eq("id", id).maybeSingle();
    const h = cur as Pick<SupplierInvoiceRow, "number" | "supplier_id" | "supplier_ico" | "supplier_name" | "duplicate_of_id" | "currency" | "exchange_rate" | "taxable_date" | "issue_date"> | null;
    if (!h) return { ok: false, error: NOT_FOUND };
    // cizí měna bez kurzu → kurz ČNB ke dni DUZP (vystavení); když se nenačte, detail ukáže „Chybí kurz — doplň"
    const currency = (row.currency as string | undefined) ?? h.currency;
    const rateGiven = "exchange_rate" in row && row.exchange_rate !== null;
    if (currency !== "CZK" && !rateGiven && (("currency" in row && row.currency !== h.currency) || h.exchange_rate === null || ("exchange_rate" in row))) {
      const day = (row.taxable_date as string | null | undefined) ?? h.taxable_date ?? (row.issue_date as string | null | undefined) ?? h.issue_date;
      const rate = await cnbRate(currency, day);
      if (rate) row.exchange_rate = rate;
      else if ("currency" in row && row.currency !== h.currency) row.exchange_rate = null;
    }
    if (!h.duplicate_of_id && ("number" in row || "supplier_id" in row)) {
      const key = supplierKeyOf({ ico: (row.supplier_ico as string | undefined) ?? h.supplier_ico, supplierId: (row.supplier_id as string | null | undefined) ?? h.supplier_id, name: h.supplier_name });
      const nn = numberNorm((row.number as string | null | undefined) ?? h.number);
      if (key && nn) {
        const { data: d } = await c.db.from("supplier_invoices").select("id").eq("supplier_key", key).eq("number_norm", nn).is("duplicate_of_id", null).neq("status", "zamitnuto").neq("id", id).limit(1);
        const other = ((d ?? []) as { id: string }[])[0];
        if (other) row.duplicate_of_id = other.id;
      }
    }
    const { error } = await c.db.from("supplier_invoices").update(row as never).eq("id", id);
    if (error) return fail(error);
    await logAudit({ action: "supplier_invoice_updated", entity: "supplier_invoices", entityId: id, diff: { fields: Object.keys(row) }, actor: userActor(c.user) });
    revalidate(id, await jobIdsOf(c.db, id));
    return { ok: true, invoice: await detail(c, id) };
  } catch (err) {
    return fail(err);
  }
}

export interface InvoiceItemInput {
  id?: string | null;
  text: string;
  code?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  unitPrice?: number | string | null;
  amount: number | string;
  vatRate?: number | string | null;
}

/** Nahradí položky faktury (existující id zůstanou i s rozdělením; smazané položky ztratí i rozdělení). */
export async function saveSupplierInvoiceItems(id: string, items: InvoiceItemInput[]): Promise<Ok<{ invoice: SupplierInvoiceDetail | null }> | Fail> {
  const c = await begin("edit");
  if ("error" in c) return c;
  if (!isUuid(id) || !Array.isArray(items)) return { ok: false, error: NOT_FOUND };
  const rows: Record<string, unknown>[] = [];
  for (const [i, it] of items.slice(0, 300).entries()) {
    const amount = money(it?.amount);
    if (amount === "bad" || amount === null) return { ok: false, error: `Položka ${i + 1}: neplatná částka.` };
    const unitPrice = money(it.unitPrice);
    const qty = money(it.quantity);
    const vat = money(it.vatRate);
    if (unitPrice === "bad" || qty === "bad" || vat === "bad") return { ok: false, error: `Položka ${i + 1}: neplatné číslo.` };
    rows.push({
      id: it.id && isUuid(it.id) ? it.id : null, invoice_id: id, position: i, text: cleanText(it.text, 1000) ?? "", code: cleanText(it.code, 80),
      quantity: qty, unit: cleanText(it.unit, 20), unit_price: unitPrice, amount, vat_rate: vat,
    });
  }
  try {
    // jedna transakce pod zámkem faktury (souběžné uložení rozdělení počká; přetečení rozdělení = chyba, nic se nezmění)
    const jobsBefore = await jobIdsOf(c.db, id);
    const res = await saveItems(c.db, id, rows.map((r) => ({
      id: (r.id as string | null) ?? null, text: String(r.text ?? ""), code: (r.code as string | null) ?? null,
      quantity: (r.quantity as number | null) ?? null, unit: (r.unit as string | null) ?? null, unitPrice: (r.unit_price as number | null) ?? null,
      amount: Number(r.amount), vatRate: (r.vat_rate as number | null) ?? null,
    })));
    if (!res.ok) return res;
    revalidate(id, jobsBefore);
    await logAudit({ action: "supplier_invoice_items", entity: "supplier_invoices", entityId: id, diff: { items: rows.length }, actor: userActor(c.user) });
    revalidate(id, await jobIdsOf(c.db, id));
    return { ok: true, invoice: await detail(c, id) };
  } catch (err) {
    return fail(err);
  }
}

/** Založí / doplní dodavatele z hlavičky faktury (dedupe podle IČO) a přiřadí ho. */
export async function supplierFromInvoiceHeader(id: string): Promise<Ok<{ supplierId: string; created: boolean; filled: string[]; invoice: SupplierInvoiceDetail | null }> | Fail> {
  const c = await begin("edit");
  if ("error" in c) return c;
  if (!isUuid(id)) return { ok: false, error: NOT_FOUND };
  try {
    const { data } = await c.db.from("supplier_invoices").select("*").eq("id", id).maybeSingle();
    if (!data) return { ok: false, error: NOT_FOUND };
    const res = await upsertSupplierFromParty(c.db, partyOfInvoice(data as SupplierInvoiceRow));
    if (!res.ok) return res;
    const up = await updateSupplierInvoiceHeader(id, { supplierId: res.id });
    if (!up.ok) return up;
    await logAudit({ action: res.created ? "supplier_created_from_invoice" : "supplier_filled_from_invoice", entity: "suppliers", entityId: res.id, diff: { invoiceId: id, filled: res.filled }, actor: userActor(c.user) });
    try { revalidatePath("/suppliers"); } catch { /* mimo požadavek */ }
    return { ok: true, supplierId: res.id, created: res.created, filled: res.filled, invoice: up.invoice };
  } catch (err) {
    return fail(err);
  }
}

// ── Objednávka vyfakturovaná celá, kurz ─────────────────────
/** „Faktura konečná" u objednávky dodavateli (dílčí faktura jinak částku objednávky jen navyšuje). */
export async function setSupplierInvoiceFinalPo(id: string, poId: string, final: boolean): Promise<Ok<{ invoice: SupplierInvoiceDetail | null }> | Fail> {
  const c = await begin("edit");
  if ("error" in c) return c;
  try {
    const res = await setFinalPurchaseOrder(c.db, id, poId, final === true);
    if (!res.ok) return res;
    await logAudit({ action: "supplier_invoice_final_po", entity: "supplier_invoices", entityId: id, diff: { purchaseOrderId: poId, final }, actor: userActor(c.user) });
    revalidate(id, await jobIdsOf(c.db, id));
    return { ok: true, invoice: await detail(c, id) };
  } catch (err) {
    return fail(err);
  }
}

/** „Načíst kurz ČNB" (ke dni DUZP, jinak vystavení). */
export async function fillSupplierInvoiceRate(id: string): Promise<Ok<{ invoice: SupplierInvoiceDetail | null }> | Fail> {
  const c = await begin("edit");
  if ("error" in c) return c;
  try {
    const res = await fillExchangeRate(c.db, id);
    if (!res.ok) return res;
    await logAudit({ action: "supplier_invoice_rate", entity: "supplier_invoices", entityId: id, diff: { rate: res.rate, source: "cnb" }, actor: userActor(c.user) });
    revalidate(id, await jobIdsOf(c.db, id));
    return { ok: true, invoice: await detail(c, id) };
  } catch (err) {
    return fail(err);
  }
}

// ── Duplicita, zamítnutí, smazání ───────────────────────────
export async function markSupplierInvoiceNotDuplicate(id: string): Promise<Ok<{ invoice: SupplierInvoiceDetail | null }> | Fail> {
  const c = await begin("edit");
  if ("error" in c) return c;
  try {
    const { error } = await c.db.from("supplier_invoices").update({ duplicate_of_id: null } as never).eq("id", id);
    if (error) {
      if (/uq_supplier_invoices_number|duplicate key/i.test(error.message)) {
        return { ok: false, error: "Faktura se stejným dodavatelem a číslem už je v evidenci — oprav číslo, nebo duplicitu smaž." };
      }
      return fail(error);
    }
    revalidate(id);
    return { ok: true, invoice: await detail(c, id) };
  } catch (err) {
    return fail(err);
  }
}

export async function setSupplierInvoiceRejected(id: string, rejected: boolean): Promise<Ok<{ invoice: SupplierInvoiceDetail | null }> | Fail> {
  const c = await begin("edit");
  if ("error" in c) return c;
  try {
    const { error } = await c.db.from("supplier_invoices").update({ status: rejected ? "zamitnuto" : "ke_kontrole" } as never).eq("id", id);
    if (error) return fail(error);
    // (obnovení: stav podle rozdělení dopočítá trigger supplier_invoices_after)
    revalidate(id, await jobIdsOf(c.db, id));
    return { ok: true, invoice: await detail(c, id) };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteSupplierInvoice(id: string): Promise<Ok | Fail> {
  const c = await begin("paid");
  if ("error" in c) return c;
  try {
    const jobs = await jobIdsOf(c.db, id);
    const res = await deleteInvoiceCore(c.db, id);
    if (!res.ok) return res;
    await logAudit({ action: "supplier_invoice_deleted", entity: "supplier_invoices", entityId: id, actor: userActor(c.user) });
    revalidate(undefined, jobs);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ── Výběr zakázky, položky, blok zakázky ────────────────────
export async function searchJobsForSupplierInvoice(q: string): Promise<Ok<{ jobs: (JobRefView & { hint: string | null })[] }> | Fail> {
  const c = await begin("edit");
  if ("error" in c) return c;
  try {
    return { ok: true, jobs: await searchJobsForInvoice(c.db, q) };
  } catch (err) {
    return fail(err);
  }
}

export async function orderItemsForSupplierInvoice(jobId: string): Promise<Ok<{ items: { id: string; label: string }[] }> | Fail> {
  const c = await begin("edit");
  if ("error" in c) return c;
  return { ok: true, items: await jobItemsForInvoice(c.db, jobId) };
}

/** Blok „Faktury dodavatelů" v Nákupu zakázky — null (bez chyby), když uživatel faktury nevidí. */
export async function jobSupplierInvoices(jobId: string): Promise<Ok<{ data: JobInvoiceCosts | null; visibility: SupplierInvoiceVisibility }> | Fail> {
  if (!isUuid(jobId)) return { ok: false, error: "Zakázka nenalezena." };
  try {
    const [data, vis] = await Promise.all([getJobInvoiceCosts(jobId), getSetting(VISIBILITY_SETTING_KEY).catch(() => null)]);
    return { ok: true, data, visibility: parseVisibility(vis) };
  } catch (err) {
    return fail(err);
  }
}

// ── Přepínač viditelnosti (super admin) ─────────────────────
export async function setSupplierInvoiceVisibility(mode: SupplierInvoiceVisibility): Promise<Ok | Fail> {
  const c = await begin("paid");
  if ("error" in c) return c;
  if (mode !== "super_admin" && mode !== "all") return { ok: false, error: "Neplatné nastavení." };
  try {
    const { error } = await c.db.from("integration_settings").upsert({
      key: VISIBILITY_SETTING_KEY, category: "supplier_invoices", label: "Kdo vidí faktury dodavatelů (super_admin | all)",
      is_secret: false, value: mode, updated_by: c.user.id, updated_at: new Date().toISOString(),
    } as never, { onConflict: "key" });
    if (error) return fail(error);
    invalidateSettingsCache();
    await logAudit({ action: "supplier_invoices_visibility", entity: "integration_settings", entityId: VISIBILITY_SETTING_KEY, diff: { to: mode }, actor: userActor(c.user) });
    try { revalidatePath("/", "layout"); } catch { /* mimo požadavek */ }
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
