import "server-only";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { isForward, isJobStage } from "@/lib/jobs/stages";
import { cleanDate, cleanText, isUuid, stageEventMessage, todayIso } from "@/lib/jobs/mapping";
import { czDay, dueDateFor } from "@/lib/jobs/production";
import { invoiceDeliveryOf } from "@/lib/jobs/flow-status";
import { INVOICE_NEEDS_DELIVERY } from "@/lib/jobs/invoice-file";
import { COMPANY, DEFAULT_VAT_RATE } from "@/lib/company";
import { refreshCompanyFromSettings } from "@/lib/company-server";
import type { JobStage } from "@/lib/supabase/database.types";

/**
 * Jádra konce toku zakázky (potvrzený dodací list, naše faktura) — sdílí server actions Výroby
 * (oprávnění hlídají ony) a dávkové focení. stage: false = stav zakázky se nemění (dávka posouvá
 * stav jednou za skupinu). Každá změna jde do historie bez částek.
 */

type Row = Record<string, unknown>;
const NOT_FOUND = "Zakázka nenalezena.";

async function loadJob(db: JobsDb, id: string, columns: string): Promise<Row | null> {
  const { data, error } = await db.from("orders").select(columns).eq("id", id).maybeSingle();
  if (error) console.error(`[production] Načtení zakázky selhalo: ${error.message}`);
  return (data as Row | null) ?? null;
}

function logStage(db: JobsDb, userId: string, jobId: string, from: JobStage | null, to: JobStage, note: string | null) {
  return logJobEvent(db, {
    jobId, type: "stage", message: stageEventMessage(from, to, note),
    data: { from, to, ...(note ? { note } : {}) }, actorId: userId,
  });
}

/** Potvrzený dodací list vrácen zákazníkem (+ volitelně soubor DL) → Dodáno zákazníkovi (jen dopředu). */
export async function confirmDeliveryNoteCore(
  db: JobsDb,
  userId: string,
  jobId: string,
  opts: { date?: string; fileId?: string; stage?: boolean; extra?: Row },
): Promise<{ ok: true; stage: JobStage; date: string } | { ok: false; error: string }> {
  if (!isUuid(jobId)) return { ok: false, error: NOT_FOUND };
  const rawDate = opts?.date;
  const date = rawDate === undefined || rawDate === null || rawDate === "" ? todayIso() : cleanDate(rawDate);
  if (!date) return { ok: false, error: "Neplatné datum (čekám RRRR-MM-DD)." };
  const fileId = opts?.fileId || null;
  if (fileId !== null && !isUuid(fileId)) return { ok: false, error: "Dokument nenalezen." };
  const job = await loadJob(db, jobId, "id, status, delivery_note_confirmed_at");
  if (!job) return { ok: false, error: NOT_FOUND };
  const from = isJobStage(job.status) ? job.status : null;

  if (fileId) {
    const { data: file } = await db.from("job_files").select("id, note").eq("id", fileId).eq("job_id", jobId).maybeSingle();
    if (!file) return { ok: false, error: "Dokument nepatří k této zakázce." };
    const line = `Potvrzeno zákazníkem ${czDay(date)}`;
    const prev = cleanText((file as { note: string | null }).note, 5000);
    const { error: fErr } = await db
      .from("job_files")
      .update({ title: "Potvrzený dodací list", kind: "dodaci_list", note: prev && !prev.includes(line) ? `${prev}\n${line}` : prev ?? line } as never)
      .eq("id", fileId);
    if (fErr) return { ok: false, error: fErr.message };
  }

  const toStage: JobStage | null = opts.stage !== false && from && isForward(from, "dodano_zakaznikovi") ? "dodano_zakaznikovi" : null;
  const update: Row = { delivery_note_confirmed_at: date };
  if (toStage) update.status = toStage;
  const { error } = await db.from("orders").update(update as never).eq("id", jobId);
  if (error) return { ok: false, error: error.message };

  await logJobEvent(db, {
    jobId, type: fileId ? "file" : "field", message: `Potvrzený dodací list vrácen (${czDay(date)})`,
    data: { production: "delivery_note", date, ...(fileId ? { fileId } : {}), ...(opts.extra ?? {}) }, actorId: userId,
  });
  if (toStage) await logStage(db, userId, jobId, from, toStage, "potvrzený dodací list");
  return { ok: true, stage: toStage ?? from ?? "poptavka", date };
}

/**
 * Evidence faktur (invoices) podle údajů faktury na zakázce: faktura vystavená mimo systém (ručně, jiný
 * účetní program, vyfocená naše faktura) dostane řádek bez PDF, aby ji viděly Faktury vydané a hlídání
 * splatnosti; existující řádek (i faktura z PDF) převezme datum a splatnost („Upravit splatnost").
 * Číslo cizí zakázky se nepřepisuje. Best-effort — chyba evidence nezastaví zápis na zakázce.
 */
export async function syncInvoiceRowCore(
  db: JobsDb,
  jobId: string,
  prevNumber: string | null,
  a: { invoice_number: string | null; invoice_date: string | null; invoice_due_date: string | null },
): Promise<void> {
  const number = cleanText(a.invoice_number, 120);
  if (!number) return;
  const issue = cleanDate(a.invoice_date) ?? todayIso();
  const due = cleanDate(a.invoice_due_date) ?? issue;
  try {
    const { data: cur } = await db.from("invoices").select("id, order_id").eq("number", number).maybeSingle();
    const row = cur as { id: string; order_id: string | null } | null;
    if (row) {
      if (row.order_id && row.order_id !== jobId) {
        console.error(`[production] Faktura ${number} patří jiné zakázce — evidence se nezměnila.`);
        return;
      }
      const { error } = await db.from("invoices").update({ issue_date: issue, due_date: due, order_id: jobId } as never).eq("id", row.id);
      if (error) console.error(`[production] Evidence faktury se nezměnila: ${error.message}`);
      return;
    }
    // přejmenovaná faktura mimo systém (bez PDF) → stejný řádek s novým číslem
    if (prevNumber && prevNumber !== number) {
      const { data: renamed } = await db.from("invoices").update({ number, issue_date: issue, due_date: due } as never)
        .eq("number", prevNumber).eq("order_id", jobId).is("storage_path", null).select("id");
      if ((renamed ?? []).length) return;
    }
    const job = await loadJob(db, jobId, "id, customer_id, currency, owner_id, value");
    if (!job) return;
    // částky faktury mimo systém neznáme → odhad z hodnoty zakázky (bez DPH) + výchozí sazba DPH firmy
    await refreshCompanyFromSettings().catch(() => undefined);
    const raw = job.value === null || job.value === undefined ? 0 : Number(job.value);
    const subtotal = Number.isFinite(raw) ? Math.round(raw * 100) / 100 : 0;
    const rate = COMPANY.vatPayer ? DEFAULT_VAT_RATE : 0;
    const vat = Math.round(subtotal * rate) / 100;
    const { error } = await db.from("invoices").insert({
      number, order_id: jobId, customer_id: job.customer_id ?? null, issue_date: issue, taxable_date: issue, due_date: due,
      currency: (job.currency as string | null) || "CZK", subtotal, vat_rate: rate, vat_amount: vat,
      total: Math.round((subtotal + vat) * 100) / 100, status: "vystavena", storage_path: null, owner_id: job.owner_id ?? null,
      note: "Faktura vystavená mimo systém (bez PDF) — částky odhadnuté z hodnoty zakázky a výchozí sazby DPH.",
    } as never);
    if (error) console.error(`[production] Zápis faktury do evidence selhal: ${error.message}`);
  } catch (err) {
    console.error(`[production] Evidence faktury selhala: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Naše faktura: číslo, datum, splatnost. Bez zadané splatnosti = datum faktury + splatnost
 * zákazníka (jinak 14 dní). S číslem / datem faktury → Vyfakturováno (už zaplacená zakázka rovnou
 * Dokončeno), jen dopředu a jen se stage ≠ false.
 */
export async function setInvoiceInfoCore(
  db: JobsDb,
  userId: string,
  jobId: string,
  input: { invoiceNumber?: string | null; invoiceDate?: string | null; invoiceDueDate?: string | null },
  opts: { stage?: boolean; extra?: Row } = {},
): Promise<{ ok: true; invoiceDate: string | null; invoiceDueDate: string | null; stage: JobStage; changed: boolean } | { ok: false; error: string }> {
  if (!isUuid(jobId)) return { ok: false, error: NOT_FOUND };
  if (!input || typeof input !== "object") return { ok: false, error: "Chybí údaje faktury." };
  for (const v of [input.invoiceDate, input.invoiceDueDate]) {
    if (v !== undefined && v !== null && v !== "" && cleanDate(v) === null) return { ok: false, error: "Neplatné datum faktury (čekám RRRR-MM-DD)." };
  }
  if (input.invoiceNumber !== undefined && input.invoiceNumber !== null && typeof input.invoiceNumber !== "string") return { ok: false, error: "Neplatné číslo faktury." };
  if (typeof input.invoiceNumber === "string" && input.invoiceNumber.trim().length > 120) return { ok: false, error: "Číslo faktury je příliš dlouhé." };
  const job = await loadJob(
    db, jobId,
    "id, status, invoice_number, invoice_date, invoice_due_date, paid_at, items_count, items_delivered, items_partial, partial_delivery_at, customer:customers!customer_id(payment_terms_days)",
  );
  if (!job) return { ok: false, error: NOT_FOUND };
  const from = isJobStage(job.status) ? job.status : null;
  const cust = Array.isArray(job.customer) ? job.customer[0] : job.customer;
  const terms = (cust as { payment_terms_days?: number | null } | null)?.payment_terms_days ?? null;

  const patch: Row = {};
  if (input.invoiceNumber !== undefined) patch.invoice_number = cleanText(input.invoiceNumber, 120);
  if (input.invoiceDate !== undefined) patch.invoice_date = cleanDate(input.invoiceDate);
  if (input.invoiceDueDate !== undefined) patch.invoice_due_date = cleanDate(input.invoiceDueDate);

  const invoiceDate = cleanDate("invoice_date" in patch ? patch.invoice_date : job.invoice_date);
  const dueGiven = cleanDate(input.invoiceDueDate);
  if (!dueGiven) {
    if (invoiceDate) {
      const dateChanged = "invoice_date" in patch && cleanDate(job.invoice_date) !== invoiceDate;
      const dueEmpty = !cleanDate("invoice_due_date" in patch ? patch.invoice_due_date : job.invoice_due_date);
      if (dateChanged || dueEmpty) patch.invoice_due_date = dueDateFor(invoiceDate, terms);
    } else if ("invoice_date" in patch && input.invoiceDueDate === undefined) {
      patch.invoice_due_date = null;
    }
  }
  const due = cleanDate("invoice_due_date" in patch ? patch.invoice_due_date : job.invoice_due_date);
  if (invoiceDate && due && due < invoiceDate) return { ok: false, error: "Splatnost je před datem faktury." };

  const number = cleanText("invoice_number" in patch ? patch.invoice_number : job.invoice_number, 120);
  // jedno číslo = jedna zakázka: číslo faktury jiné zakázky se nepřevezme (ani z evidence faktur)
  const prevNo = cleanText(job.invoice_number, 120);
  if (number && number !== prevNo) {
    const [{ data: inv }, { data: ord }] = await Promise.all([
      db.from("invoices").select("order_id").eq("number", number).not("order_id", "is", null).neq("order_id", jobId).limit(1),
      db.from("orders").select("number").eq("invoice_number", number).neq("id", jobId).limit(1),
    ]);
    const otherId = ((inv ?? []) as { order_id: string }[])[0]?.order_id ?? null;
    let other = ((ord ?? []) as { number: string | null }[])[0]?.number ?? null;
    if (!other && otherId) other = ((await loadJob(db, otherId, "id, number"))?.number as string | null) ?? null;
    if (other) return { ok: false, error: `Faktura ${number} už patří zakázce ${other}.` };
    if (otherId) return { ok: false, error: `Faktura ${number} už patří jiné zakázce.` };
  }
  // stav: Vyfakturováno jen po dodání všeho; nová faktura bez jakéhokoli dodání se nezapíše (ruční krok)
  const delivery = invoiceDeliveryOf({
    stage: from ?? "poptavka", itemsCount: Number(job.items_count) || 0, itemsDelivered: Number(job.items_delivered) || 0,
    itemsPartial: Number(job.items_partial) || 0, partialDeliveryAt: (job.partial_delivery_at as string | null) ?? null,
  });
  if (opts.stage !== false && number && !prevNo && delivery === "none") return { ok: false, error: INVOICE_NEEDS_DELIVERY };
  const target: JobStage = job.paid_at ? "dokonceno" : "fakturovano";
  const toStage = opts.stage !== false && delivery === "complete" && (number || invoiceDate) && from && isForward(from, target) ? target : null;
  if (toStage) patch.status = toStage;

  const changedCols = (["invoice_number", "invoice_date", "invoice_due_date"] as const).filter((k) =>
    k in patch && (k === "invoice_number" ? cleanText(job[k], 120) !== patch[k] : cleanDate(job[k]) !== patch[k]));
  if (!changedCols.length && !toStage) {
    return { ok: true, invoiceDate, invoiceDueDate: due, stage: from ?? "poptavka", changed: false };
  }

  const { data: after, error } = await db
    .from("orders")
    .update(patch as never)
    .eq("id", jobId)
    .select("status, invoice_number, invoice_date, invoice_due_date")
    .single();
  if (error || !after) return { ok: false, error: error?.message ?? "Fakturu se nepodařilo uložit." };
  const a = after as { status: JobStage; invoice_number: string | null; invoice_date: string | null; invoice_due_date: string | null };

  const LABELS = { invoice_number: "Číslo faktury", invoice_date: "Datum faktury", invoice_due_date: "Splatnost faktury" } as const;
  const views = (["invoice_number", "invoice_date", "invoice_due_date"] as const)
    .filter((k) => (k === "invoice_number" ? cleanText(job[k], 120) !== a[k] : cleanDate(job[k]) !== cleanDate(a[k])))
    .map((k) => {
      const f = k === "invoice_number" ? cleanText(job[k], 120) : cleanDate(job[k]);
      const t = k === "invoice_number" ? a[k] : cleanDate(a[k]);
      const txt = (v: string | null) => (v ? (k === "invoice_number" ? v : czDay(v)) : "—");
      return { field: k, label: LABELS[k], from: f, to: t, fromText: txt(f), toText: txt(t) };
    });
  if (views.length) {
    const head = `${a.invoice_number ? `Faktura ${a.invoice_number}` : "Faktura"}${a.invoice_date ? ` ze dne ${czDay(a.invoice_date)}` : ""}`;
    await logJobEvent(db, {
      jobId, type: "field", message: a.invoice_due_date ? `${head}, splatnost ${czDay(a.invoice_due_date)}` : head,
      data: { changes: views, production: "invoice", ...(opts.extra ?? {}) }, actorId: userId,
    });
  }
  if (a.status !== from && isJobStage(a.status)) await logStage(db, userId, jobId, from, a.status, "faktura vystavena");
  // jedna evidence faktur: i faktura mimo systém / z fotky má řádek (Faktury vydané, splatnost)
  await syncInvoiceRowCore(db, jobId, cleanText(job.invoice_number, 120), a);
  return { ok: true, invoiceDate: cleanDate(a.invoice_date), invoiceDueDate: cleanDate(a.invoice_due_date), stage: a.status, changed: true };
}

/**
 * Zákazník zaplatil (jen dosud nezaplacená zakázka) — událost s autorem; když DB trigger přepne
 * vyfakturovanou zakázku na Dokončeno, zapíše se i změna stavu.
 */
export async function markJobPaidCore(
  db: JobsDb,
  userId: string,
  jobId: string,
  opts: { date?: string; extra?: Row } = {},
): Promise<{ ok: true; changed: boolean; stage: JobStage | null } | { ok: false; error: string }> {
  if (!isUuid(jobId)) return { ok: false, error: NOT_FOUND };
  const date = opts.date ? cleanDate(opts.date) : todayIso();
  if (!date) return { ok: false, error: "Neplatné datum úhrady (čekám RRRR-MM-DD)." };
  const job = await loadJob(db, jobId, "id, status, paid_at");
  if (!job) return { ok: false, error: NOT_FOUND };
  const from = isJobStage(job.status) ? job.status : null;
  if (job.paid_at) return { ok: true, changed: false, stage: from };
  const { data: after, error } = await db.from("orders").update({ paid_at: date } as never).eq("id", jobId).is("paid_at", null).select("status");
  if (error) return { ok: false, error: error.message };
  const row = ((after ?? []) as { status: string }[])[0];
  if (!row) return { ok: true, changed: false, stage: from };
  await logJobEvent(db, {
    jobId, type: "field", message: `Zaplaceno ${czDay(date)}`,
    data: { production: "paid", paidAt: date, ...(opts.extra ?? {}) }, actorId: userId,
  });
  const to = isJobStage(row.status) ? row.status : from;
  if (to && to !== from) await logStage(db, userId, jobId, from, to, "zaplaceno");
  return { ok: true, changed: true, stage: to };
}
