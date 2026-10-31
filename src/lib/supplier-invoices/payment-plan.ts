// Platební plán (31. 10.) — jednoduché poznámky „komu, kolik, kdy" (jen super admin).
// Čistá logika sdílená serverem i klientem: validace vstupu, seskupení po dnech, součty po měnách.
import { parseAmount, round2 } from "@/lib/supplier-invoices/money";

export interface PaymentPlanInvoiceRef {
  id: string;
  number: string | null;
  supplierName: string | null;
  /** Zaplaceno / nezaplaceno faktury (null = neznámé). */
  paymentStatus: "nezaplaceno" | "castecne" | "zaplaceno" | null;
}

export interface PaymentPlanEntry {
  id: string;
  payee: string;
  amount: number;
  currency: string;
  /** RRRR-MM-DD */
  dueOn: string;
  note: string | null;
  invoice: PaymentPlanInvoiceRef | null;
  paidAt: string | null;
  paidByName: string | null;
  createdByName: string | null;
  createdAt: string;
}

/** Nezaplacená faktura se splatností brzy (jen nápověda — do plánu ani součtů se nepočítá). */
export interface UpcomingInvoice {
  id: string;
  number: string | null;
  supplierName: string | null;
  dueDate: string;
  /** Zbývá zaplatit (s DPH). */
  amount: number | null;
  currency: string;
  overdue: boolean;
  /** Už je na ni řádek v plánu (nezaplacený). */
  inPlan: boolean;
}

/** Faktura pro odkaz z plánu (hledání podle čísla / dodavatele). */
export interface PlanInvoiceOption {
  id: string;
  number: string | null;
  supplierName: string | null;
  dueDate: string | null;
  /** Zbývá zaplatit (s DPH). */
  amount: number | null;
  currency: string;
  paymentStatus: string;
}

export interface PaymentPlanData {
  today: string;
  /** Nezaplacené řádky + zaplacené za posledních 30 dní. */
  entries: PaymentPlanEntry[];
  /** Nezaplacené faktury se splatností do 14 dní (i po splatnosti). */
  upcomingInvoices: UpcomingInvoice[];
  /** Návrhy pro „Komu" (dodavatelé). */
  payees: string[];
}

export interface PaymentPlanInput {
  payee: string;
  amount: string | number;
  currency?: string;
  dueOn: string;
  invoiceId?: string | null;
  note?: string | null;
}

export interface CleanPlanInput {
  payee: string;
  amount: number;
  currency: string;
  dueOn: string;
  invoiceId: string | null;
  note: string | null;
}

export const UPCOMING_INVOICE_DAYS = 14;
export const PLAN_CURRENCIES = ["CZK", "EUR", "USD"] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validIso(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Vstup formuláře → řádek, nebo česká chyba. */
export function cleanPlanInput(raw: Partial<PaymentPlanInput> | null | undefined): CleanPlanInput | string {
  const o = raw ?? {};
  const payee = String(o.payee ?? "").replace(/\s+/g, " ").trim();
  if (!payee) return "Napiš, komu se má platit.";
  if (payee.length > 200) return "Jméno je moc dlouhé (max. 200 znaků).";
  const amount = typeof o.amount === "number" ? (Number.isFinite(o.amount) ? round2(o.amount) : null) : parseAmount(String(o.amount ?? ""));
  if (amount === null) return "Částka není číslo — napiš třeba 12 500 nebo 12 500,50.";
  if (amount <= 0) return "Částka musí být větší než nula.";
  if (amount >= 1e10) return "Částka je moc velká.";
  const currency = String(o.currency ?? "CZK").trim().toUpperCase().replace("KČ", "CZK") || "CZK";
  if (!/^[A-Z]{3}$/.test(currency)) return "Neznámá měna.";
  const dueOn = String(o.dueOn ?? "").trim();
  if (!validIso(dueOn)) return "Vyber, kdy se má zaplatit.";
  const invoiceId = o.invoiceId ? String(o.invoiceId) : null;
  if (invoiceId && !UUID_RE.test(invoiceId)) return "Neplatná faktura.";
  const note = String(o.note ?? "").trim().slice(0, 1000) || null;
  return { payee, amount, currency, dueOn, invoiceId, note };
}

/** Den o n dní posunutý (RRRR-MM-DD). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];

/** „Dnes", „Zítra", jinak „pondělí 3. 11." (jiný rok s rokem). */
export function dayLabel(iso: string, today: string): string {
  if (iso === today) return "Dnes";
  if (iso === addDays(today, 1)) return "Zítra";
  if (iso === addDays(today, -1)) return "Včera";
  const d = new Date(`${iso}T00:00:00Z`);
  const base = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`;
  return iso.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${iso.slice(0, 4)}`;
}

export interface CurrencyTotal { currency: string; amount: number }

/** Součty po měnách (CZK první); nikdy se nesčítají různé měny. */
export function totalsByCurrency(rows: { amount: number; currency: string }[]): CurrencyTotal[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.currency, round2((m.get(r.currency) ?? 0) + r.amount));
  return [...m.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => (a.currency === "CZK" ? -1 : b.currency === "CZK" ? 1 : a.currency.localeCompare(b.currency)));
}

export interface PlanGroup {
  /** "overdue" | RRRR-MM-DD */
  key: string;
  label: string;
  overdue: boolean;
  today: boolean;
  entries: PaymentPlanEntry[];
  totals: CurrencyTotal[];
}

export interface PlanView {
  groups: PlanGroup[];
  /** Celkem k zaplacení (nezaplacené). */
  total: CurrencyTotal[];
  overdueCount: number;
  /** Zaplacené (nejnovější první). */
  paid: PaymentPlanEntry[];
}

/** Nezaplacené po dnech (po termínu nahoře jako jedna skupina), zaplacené zvlášť; součty bez zaplacených. */
export function buildPlanView(entries: PaymentPlanEntry[], today: string): PlanView {
  const open = entries.filter((e) => !e.paidAt).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.createdAt.localeCompare(b.createdAt));
  const paid = entries.filter((e) => e.paidAt).sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? "") || b.createdAt.localeCompare(a.createdAt));
  const groups: PlanGroup[] = [];
  const overdue = open.filter((e) => e.dueOn < today);
  if (overdue.length) {
    groups.push({ key: "overdue", label: "Po termínu", overdue: true, today: false, entries: overdue, totals: totalsByCurrency(overdue) });
  }
  for (const e of open.filter((x) => x.dueOn >= today)) {
    let g = groups[groups.length - 1];
    if (!g || g.key !== e.dueOn) {
      g = { key: e.dueOn, label: dayLabel(e.dueOn, today), overdue: false, today: e.dueOn === today, entries: [], totals: [] };
      groups.push(g);
    }
    g.entries.push(e);
  }
  for (const g of groups) if (!g.overdue) g.totals = totalsByCurrency(g.entries);
  return { groups, total: totalsByCurrency(open), overdueCount: overdue.length, paid };
}
