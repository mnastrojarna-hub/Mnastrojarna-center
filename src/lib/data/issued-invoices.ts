import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess, type Access } from "@/lib/auth/session";
import type { JobsDb } from "@/lib/jobs/events";
import { todayIso } from "@/lib/jobs/mapping";
import { pdfFileName } from "@/lib/pdf/job-docs";
import { COMPANY, DEFAULT_VAT_RATE } from "@/lib/company";
import { cnbRate } from "@/lib/supplier-invoices/cnb-rate";
import {
  paymentOf, periodRange, type IssuedInvoice, type IssuedPeriod, type PaymentRowInput,
} from "@/lib/issued-invoices/model";

/**
 * Datová vrstva Faktur vydaných. Čte servisním klíčem → veřejné funkce ověří právo `issued_invoices`
 * (super admin / plný přístup). Zdroj = evidence faktur (invoices: faktury z aplikace i vystavené mimo systém);
 * faktura zapsaná jen na zakázce (orders.invoice_number bez řádku v evidenci — starší data) se přidá s částkou
 * odhadnutou z hodnoty zakázky. PDF = dokument zakázky (job_files, druh faktura, ne doklad dodavatele).
 */

type Row = Record<string, unknown>;

const MAX_ROWS = 2000;
const BUCKET = "job-files";

function warn(scope: string, error: { message: string } | null | undefined) {
  if (error) console.error(`[data:issued-invoices:${scope}] Supabase chyba: ${error.message}`);
}

const num = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export interface IssuedSession {
  db: JobsDb;
  access: Access;
}

/** Přístup k Fakturám vydaným (null = nesmí). */
export async function issuedInvoicesSession(): Promise<IssuedSession | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const access = await getAccess();
    if (!access.user || !access.user.active || !access.can("issued_invoices")) return null;
    const db = await createOperatorClient();
    return { db, access };
  } catch (err) {
    console.error(`[data:issued-invoices] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Soubor faktury v úložišti (jen server — do klienta nejde). */
export interface IssuedFileRef {
  storagePath: string;
  filename: string;
  mimeType: string | null;
}

export interface IssuedLoad {
  items: IssuedInvoice[];
  files: Map<string, IssuedFileRef>;
}

interface FileRow {
  id: string;
  job_id: string;
  filename: string;
  mime_type: string | null;
  storage_path: string | null;
  origin: string | null;
  issuer: string | null;
  created_at: string;
  version: number | null;
}

/** PDF faktury: soubor z invoices.storage_path → PDF z aplikace s názvem čísla → jiný náš doklad „faktura" zakázky. */
function pickFile(files: readonly FileRow[], number: string, storagePath: string | null): FileRow | null {
  if (storagePath) {
    const hit = files.find((f) => f.storage_path === storagePath);
    if (hit) return hit;
  }
  const name = pdfFileName("faktura", number);
  const newest = (list: FileRow[]) => [...list].sort((a, b) => (b.version ?? 1) - (a.version ?? 1) || b.created_at.localeCompare(a.created_at))[0] ?? null;
  const generated = newest(files.filter((f) => f.origin === "generated" && f.filename === name));
  if (generated) return generated;
  // naše faktura nahraná / vyfocená (mimo systém) — jen když u zakázky není jiná naše faktura s cizím číslem
  const own = files.filter((f) => f.origin !== "generated" && f.issuer === "my");
  return newest(own);
}

/** Faktury vystavené v období (bez kontroly práv — volající ji už udělal). */
export async function loadIssuedInvoices(db: JobsDb, period: IssuedPeriod, today = todayIso()): Promise<IssuedLoad> {
  const { from, to } = periodRange(period);
  const { data, error } = await db.from("invoices")
    .select(
      "id, number, order_id, customer_id, variable_symbol, issue_date, taxable_date, due_date, currency, subtotal, vat_rate, vat_amount, total, status, storage_path, sent_at, " +
      "customer:customers!customer_id(id, name, ico, dic), job:orders!order_id(id, number, title, paid_at, invoice_number, invoice_sent_at)",
    )
    .gte("issue_date", from).lte("issue_date", to)
    .order("issue_date", { ascending: false })
    .limit(MAX_ROWS);
  warn("invoices", error);
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => str(r.number));

  // faktura zapsaná jen na zakázce (bez evidence) — starší data / zápis evidence selhal
  const { data: orphanData, error: oErr } = await db.from("orders")
    .select("id, number, title, value, currency, paid_at, invoice_number, invoice_date, invoice_due_date, invoice_sent_at, customer:customers!customer_id(id, name, ico, dic)")
    .not("invoice_number", "is", null)
    .gte("invoice_date", from).lte("invoice_date", to)
    .is("merged_into_id", null)
    .limit(MAX_ROWS);
  warn("orders", oErr);
  const known = new Set(rows.map((r) => String(r.number).trim()));
  const orphans = ((orphanData ?? []) as Row[]).filter((o) => str(o.invoice_number) && !known.has(String(o.invoice_number).trim()));
  if (orphans.length) {
    // číslo může být v evidenci s jiným datem vystavení (mimo období) — taková faktura sem nepatří
    const { data: elsewhere } = await db.from("invoices").select("number").in("number", orphans.map((o) => String(o.invoice_number).trim()));
    for (const r of (elsewhere ?? []) as { number: string }[]) known.add(r.number);
  }

  const jobIds = [...new Set([
    ...rows.map((r) => str(r.order_id)).filter((x): x is string => Boolean(x)),
    ...orphans.filter((o) => !known.has(String(o.invoice_number).trim())).map((o) => String(o.id)),
  ])];
  const payments = new Map<string, PaymentRowInput[]>();
  const filesByJob = new Map<string, FileRow[]>();
  for (let i = 0; i < jobIds.length; i += 200) {
    const chunk = jobIds.slice(i, i + 200);
    const [pay, files] = await Promise.all([
      db.from("job_payments").select("job_id, paid_on, amount, settles").in("job_id", chunk),
      db.from("job_files").select("id, job_id, filename, mime_type, storage_path, origin, issuer, created_at, version")
        .in("job_id", chunk).eq("kind", "faktura").eq("archived", false),
    ]);
    warn("payments", pay.error);
    warn("files", files.error);
    for (const p of (pay.data ?? []) as (PaymentRowInput & { job_id: string })[]) {
      payments.set(p.job_id, [...(payments.get(p.job_id) ?? []), p]);
    }
    for (const f of (files.data ?? []) as FileRow[]) {
      if (f.issuer === "dodavatel") continue;
      filesByJob.set(f.job_id, [...(filesByJob.get(f.job_id) ?? []), f]);
    }
  }

  const items: IssuedInvoice[] = [];
  const fileRefs = new Map<string, IssuedFileRef>();
  const addFile = (id: string, f: FileRow | null) => {
    if (f?.storage_path) fileRefs.set(id, { storagePath: f.storage_path, filename: f.filename, mimeType: f.mime_type });
  };

  for (const r of rows) {
    const number = String(r.number).trim();
    const jobRaw = one(r.job as Row | Row[] | null);
    // evidence ukazuje na zakázku, která má už jiné číslo faktury → PDF zakázky k této faktuře nepatří
    const jobId = jobRaw ? String(jobRaw.id) : null;
    const jobMatches = jobRaw ? (str(jobRaw.invoice_number) ?? "") === number : false;
    const cust = one(r.customer as Row | Row[] | null);
    const net = num(r.subtotal);
    const gross = num(r.total);
    const file = jobId ? pickFile(jobMatches ? filesByJob.get(jobId) ?? [] : (filesByJob.get(jobId) ?? []).filter((f) => f.storage_path === r.storage_path), number, str(r.storage_path)) : null;
    const id = String(r.id);
    addFile(id, file);
    items.push({
      id,
      number,
      issueDate: String(r.issue_date ?? "").slice(0, 10),
      taxableDate: str(r.taxable_date),
      dueDate: str(r.due_date),
      variableSymbol: str(r.variable_symbol),
      currency: (str(r.currency) ?? "CZK").toUpperCase(),
      net,
      vat: num(r.vat_amount),
      gross,
      vatRate: r.vat_rate === null || r.vat_rate === undefined ? null : num(r.vat_rate),
      customer: cust ? { id: String(cust.id), name: String(cust.name ?? ""), ico: str(cust.ico), dic: str(cust.dic) } : null,
      job: jobRaw ? { id: String(jobRaw.id), number: str(jobRaw.number), title: str(jobRaw.title) } : null,
      file: file ? { id: file.id, filename: file.filename, mimeType: file.mime_type, generated: file.origin === "generated" } : null,
      payment: paymentOf(
        { net, gross, dueDate: str(r.due_date), status: str(r.status), jobPaidAt: jobMatches && jobRaw ? str(jobRaw.paid_at) : null },
        jobMatches && jobId ? payments.get(jobId) : [],
        today,
      ),
      sentAt: str(r.sent_at) ?? (jobMatches && jobRaw ? str(jobRaw.invoice_sent_at) : null),
      estimated: false,
      external: !str(r.storage_path),
    });
  }

  for (const o of orphans) {
    const number = String(o.invoice_number).trim();
    if (known.has(number)) continue;
    const jobId = String(o.id);
    const cust = one(o.customer as Row | Row[] | null);
    const net = Math.round(num(o.value) * 100) / 100;
    const rate = COMPANY.vatPayer ? DEFAULT_VAT_RATE : 0;
    const vat = Math.round(net * rate) / 100;
    const gross = Math.round((net + vat) * 100) / 100;
    const file = pickFile(filesByJob.get(jobId) ?? [], number, null);
    const id = `job:${jobId}`;
    addFile(id, file);
    items.push({
      id,
      number,
      issueDate: String(o.invoice_date ?? "").slice(0, 10),
      taxableDate: str(o.invoice_date),
      dueDate: str(o.invoice_due_date),
      variableSymbol: null,
      currency: (str(o.currency) ?? "CZK").toUpperCase(),
      net, vat, gross, vatRate: rate,
      customer: cust ? { id: String(cust.id), name: String(cust.name ?? ""), ico: str(cust.ico), dic: str(cust.dic) } : null,
      job: { id: jobId, number: str(o.number), title: str(o.title) },
      file: file ? { id: file.id, filename: file.filename, mimeType: file.mime_type, generated: file.origin === "generated" } : null,
      payment: paymentOf({ net, gross, dueDate: str(o.invoice_due_date), jobPaidAt: str(o.paid_at) }, payments.get(jobId), today),
      sentAt: str(o.invoice_sent_at),
      estimated: true,
      external: true,
    });
  }

  items.sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number, "cs", { numeric: true }));
  return { items, files: fileRefs };
}

/** Kurzy ČNB k DUZP faktur v cizí měně (id faktury → Kč za 1 jednotku). Bez sítě / neznámá měna → chybí. */
export async function invoiceRates(items: readonly IssuedInvoice[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const foreign = items.filter((it) => it.currency !== "CZK" && it.payment.state !== "storno");
  if (!foreign.length) return out;
  const memo = new Map<string, Promise<number | null>>();
  await Promise.all(foreign.map(async (it) => {
    const day = it.taxableDate ?? it.issueDate;
    const key = `${it.currency}|${day}`;
    if (!memo.has(key)) memo.set(key, cnbRate(it.currency, day).catch(() => null));
    const rate = await memo.get(key)!;
    if (rate && rate > 0) out[it.id] = rate;
  }));
  return out;
}

/** Seznam pro stránku (s kontrolou práv); null = bez přístupu / chyba. */
export async function listIssuedInvoices(period: IssuedPeriod): Promise<{ items: IssuedInvoice[]; rates: Record<string, number> } | null> {
  const s = await issuedInvoicesSession();
  if (!s) return null;
  try {
    const { items } = await loadIssuedInvoices(s.db, period);
    const rates = await invoiceRates(items);
    return { items, rates };
  } catch (err) {
    console.error(`[data:issued-invoices] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Obsah souboru faktury z úložiště (null = chybí). */
export async function invoiceFileBytes(db: JobsDb, ref: IssuedFileRef): Promise<Uint8Array | null> {
  try {
    const { data, error } = await db.storage.from(BUCKET).download(ref.storagePath);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  } catch {
    return null;
  }
}
