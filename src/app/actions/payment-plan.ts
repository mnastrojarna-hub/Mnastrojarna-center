"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess, getSessionUser } from "@/lib/auth/session";
import { userActor } from "@/lib/supabase/actor-headers";
import type { JobsDb } from "@/lib/jobs/events";
import { logAudit } from "@/lib/audit";
import { todayIso } from "@/lib/jobs/mapping";
import { supplierInvoicePerms } from "@/lib/supplier-invoices/access";
import {
  createPlanEntry, deletePlanEntry, loadPaymentPlan, searchPlanInvoices, setPlanEntryPaid, updatePlanEntry, type PlanInvoiceOption,
} from "@/lib/supplier-invoices/payment-plan-store";
import type { PaymentPlanData, PaymentPlanEntry, PaymentPlanInput } from "@/lib/supplier-invoices/payment-plan";

/**
 * Platební plán (Faktury dodavatelů → záložka Platební plán) — JEN super admin (stejné právo jako
 * zaplaceno / nezaplaceno faktur). Zápis servisním klientem s autorem; DB trigger hlídá totéž.
 */

type Fail = { ok: false; error: string };
const NO_RIGHT = "K této akci nemáš oprávnění.";

async function begin(): Promise<{ db: JobsDb; userId: string } | Fail> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  const user = await getSessionUser();
  if (!user || !user.active) return { ok: false, error: "Nejsi přihlášen — přihlas se znovu." };
  const perms = supplierInvoicePerms((await getAccess()).can);
  if (!perms.paid) return { ok: false, error: NO_RIGHT };
  return { db: (await createOperatorClient({ actor: userActor(user) })) as unknown as JobsDb, userId: user.id };
}

function revalidate() {
  try {
    revalidatePath("/supplier-invoices/plan");
  } catch {
    // mimo požadavek Next.js
  }
}

const snap = (e: PaymentPlanEntry) => ({ payee: e.payee, amount: e.amount, currency: e.currency, dueOn: e.dueOn, invoiceId: e.invoice?.id ?? null, note: e.note });

export async function getPaymentPlan(): Promise<{ ok: true; data: PaymentPlanData } | Fail> {
  const c = await begin();
  if ("error" in c) return c;
  const res = await loadPaymentPlan(c.db, todayIso());
  return "error" in res ? res : { ok: true, data: res };
}

export async function addPaymentPlanEntry(input: Partial<PaymentPlanInput>): Promise<{ ok: true; entry: PaymentPlanEntry } | Fail> {
  const c = await begin();
  if ("error" in c) return c;
  const res = await createPlanEntry(c.db, input);
  if (!res.ok) return res;
  await logAudit({ action: "payment_plan_created", entity: "supplier_payment_plan", entityId: res.entry.id, diff: snap(res.entry) });
  revalidate();
  return res;
}

export async function updatePaymentPlanEntry(id: string, input: Partial<PaymentPlanInput>): Promise<{ ok: true; entry: PaymentPlanEntry } | Fail> {
  const c = await begin();
  if ("error" in c) return c;
  const res = await updatePlanEntry(c.db, id, input);
  if (!res.ok) return res;
  await logAudit({ action: "payment_plan_updated", entity: "supplier_payment_plan", entityId: id, diff: { before: snap(res.before), after: snap(res.entry) } });
  revalidate();
  return { ok: true, entry: res.entry };
}

/** Zaplaceno (dnes) / Vrátit. U řádku s fakturou, která ještě není zaplacená, nabídne i její zaplacení (nevnucuje). */
export async function setPaymentPlanPaid(id: string, paid: boolean): Promise<{ ok: true; entry: PaymentPlanEntry; offerInvoice: { id: string; number: string | null } | null } | Fail> {
  const c = await begin();
  if ("error" in c) return c;
  const res = await setPlanEntryPaid(c.db, id, paid ? todayIso() : null);
  if (!res.ok) return res;
  await logAudit({ action: paid ? "payment_plan_paid" : "payment_plan_unpaid", entity: "supplier_payment_plan", entityId: id, diff: { paidAt: res.entry.paidAt, invoiceId: res.entry.invoice?.id ?? null } });
  revalidate();
  const inv = res.entry.invoice;
  return { ok: true, entry: res.entry, offerInvoice: paid && inv && inv.paymentStatus !== "zaplaceno" ? { id: inv.id, number: inv.number } : null };
}

export async function deletePaymentPlanEntry(id: string): Promise<{ ok: true } | Fail> {
  const c = await begin();
  if ("error" in c) return c;
  const res = await deletePlanEntry(c.db, id);
  if (!res.ok) return res;
  revalidate();
  return { ok: true };
}

export async function searchInvoicesForPaymentPlan(q: string): Promise<{ ok: true; invoices: PlanInvoiceOption[] } | Fail> {
  const c = await begin();
  if ("error" in c) return c;
  return { ok: true, invoices: await searchPlanInvoices(c.db, q) };
}
