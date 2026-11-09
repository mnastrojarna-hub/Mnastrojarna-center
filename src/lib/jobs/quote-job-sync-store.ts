import "server-only";
import { createHash } from "node:crypto";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { cleanMoney, cleanNumber, cleanQuantity, cleanText } from "@/lib/jobs/mapping";
import { isInvoiced, sameMoney } from "@/lib/jobs/consistency";
import { syncJobMoneyFromItems } from "@/lib/jobs/consistency-store";
import { leadOfTerms, quoteTermsOfQuote } from "@/lib/jobs/order-deadline";
import { pragueToday } from "@/lib/jobs/lead-time";
import {
  OFFER_SYNC_FROZEN_STAGES, currentOffer, offerSyncMessage, parseOfferSyncState, planOfferDueDate, planOfferItems,
  type OfferItemsPlan, type OfferJobItem, type OfferQuoteItem, type OfferSyncReason, type OfferSyncState,
} from "@/lib/jobs/quote-job-sync";
import type { JobStage } from "@/lib/supabase/database.types";

/**
 * Propsání aktuální nabídky do zakázky (server, jediné místo — pravidla v src/lib/jobs/quote-job-sync.ts).
 * Volá se po založení, úpravě, nové verzi, schválení, odeslání a přijetí nabídky. Best-effort: selhání
 * propsání nikdy neshodí akci s nabídkou (jen se zaloguje).
 */

type Row = Record<string, unknown>;

export interface OfferSyncResult {
  ok: boolean;
  /** Proč se nic nepropsalo (vyfakturovaná, bez nabídky…). */
  skipped?: string;
  quoteId?: string | null;
  itemsCreated: number;
  pricesUpdated: number;
  purchaseFilled: number;
  dueDate: string | null;
  value: number | null;
}

const NONE: Omit<OfferSyncResult, "ok"> = { itemsCreated: 0, pricesUpdated: 0, purchaseFilled: 0, dueDate: null, value: null };

const QUOTE_COLUMNS =
  "id, number, revision, status, state, archived, created_at, sent_at, lead_time_days, delivery_terms, note, " +
  "items:quote_items!quote_id(id, position, drawing_id, drawing_number, name, description, material, quantity, unit, unit_price, purchase_unit_price)";

/** Otisk položek nabídky — úprava položek nabídky je vždy nahradí novými řádky (nová id). Stejně počítá migrace. */
export function offerItemsKey(ids: string[]): string {
  return createHash("md5").update([...ids].map((s) => s.toLowerCase()).sort().join(",")).digest("hex");
}

function missingColumn(err: { code?: string; message?: string } | null): boolean {
  return Boolean(err && (err.code === "42703" || err.code === "PGRST204" || /offer_sync/.test(err.message ?? "")));
}

function quoteItemOf(r: Row): OfferQuoteItem {
  return {
    position: Number(r.position ?? 0),
    drawingId: (r.drawing_id as string | null) ?? null,
    drawingNumber: cleanText(r.drawing_number, 200),
    name: cleanText(r.name, 500),
    description: cleanText(r.description, 5000),
    material: cleanText(r.material, 200),
    quantity: cleanQuantity(r.quantity),
    unit: cleanText(r.unit, 20) ?? "ks",
    unitPrice: cleanMoney(r.unit_price),
    purchaseUnitPrice: cleanMoney(r.purchase_unit_price),
  };
}

function quoteDay(q: Row): string | null {
  const at = (q.sent_at as string | null) ?? (q.created_at as string | null) ?? null;
  if (!at) return null;
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? pragueToday(d) : null;
}

/**
 * Zakázka podle své aktuální nabídky. `force` (přijetí zákazníkem) propíše ceny i tehdy, když se stejná
 * nabídka do zakázky už jednou propsala (jinak se ruční úprava cen v zakázce po nabídce nepřepisuje).
 */
export async function syncJobFromQuote(
  db: JobsDb, jobId: string, opts: { actorId: string | null; reason: OfferSyncReason; force?: boolean },
): Promise<OfferSyncResult> {
  try {
    return await run(db, jobId, opts);
  } catch (err) {
    console.error(`[offer-sync] Nabídku se nepodařilo propsat do zakázky: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, skipped: "error", ...NONE };
  }
}

async function run(
  db: JobsDb, jobId: string, opts: { actorId: string | null; reason: OfferSyncReason; force?: boolean },
): Promise<OfferSyncResult> {
  const [jobRes, quotesRes, stateRes] = await Promise.all([
    db.from("orders").select("id, status, currency, value, due_date, order_date, quote_id, invoice_number, invoiced_at, merged_into_id").eq("id", jobId).maybeSingle(),
    db.from("quotes").select(QUOTE_COLUMNS).eq("job_id", jobId),
    db.from("orders").select("offer_sync").eq("id", jobId).maybeSingle(),
  ]);
  const job = jobRes.data as Row | null;
  if (!job) return { ok: true, skipped: "no_job", ...NONE };
  // migrace se sloupcem ještě neproběhla → propsat bez paměti (nic nepřepisovat podruhé nejde hlídat)
  const stateSupported = !missingColumn(stateRes.error as { code?: string; message?: string } | null);
  if (stateRes.error && stateSupported) console.error(`[offer-sync] Stav propsání se nepodařilo načíst: ${stateRes.error.message}`);
  const previous = stateSupported ? parseOfferSyncState((stateRes.data as Row | null)?.offer_sync) : null;

  if (job.merged_into_id) return { ok: true, skipped: "merged", ...NONE };
  if (isInvoiced({ invoiceNumber: job.invoice_number as string | null, invoicedAt: job.invoiced_at as string | null })) {
    return { ok: true, skipped: "invoiced", ...NONE };
  }
  const stage = String(job.status ?? "") as JobStage;
  if (OFFER_SYNC_FROZEN_STAGES.includes(stage)) return { ok: true, skipped: "closed", ...NONE };
  if (quotesRes.error) throw new Error(quotesRes.error.message);

  const quotes = ((quotesRes.data ?? []) as unknown as Row[]).map((q) => ({
    row: q, id: String(q.id), status: (q.status as string | null) ?? null, state: (q.state as string | null) ?? null,
    archived: q.archived === true, revision: cleanNumber(q.revision), createdAt: (q.created_at as string | null) ?? null,
  }));
  const offer = currentOffer(quotes, (job.quote_id as string | null) ?? null);
  if (!offer) return { ok: true, skipped: "no_quote", ...NONE };
  const q = offer.row;
  const qItemsRaw = ((q.items ?? []) as Row[]);
  const itemsKey = offerItemsKey(qItemsRaw.map((r) => String(r.id)));
  const number = (q.number as string | null) ?? null;

  // ── položky ──
  const itemsDue = opts.force || !previous || previous.quoteId !== offer.id || previous.itemsKey !== itemsKey;
  let plan: OfferItemsPlan = { create: [], update: [], pricesUpdated: 0, purchaseFilled: 0, fromScratch: false };
  if (itemsDue && qItemsRaw.length) {
    const { data: ji, error: jiErr } = await db.from("order_items")
      .select("id, position, drawing_number, name, quantity, unit_price, purchase_unit_price").eq("order_id", jobId).order("position");
    if (jiErr) throw new Error(jiErr.message);
    const jobItems: OfferJobItem[] = ((ji ?? []) as Row[]).map((r) => ({
      id: String(r.id), position: Number(r.position ?? 0),
      drawingNumber: (r.drawing_number as string | null) ?? null, name: (r.name as string | null) ?? null,
      quantity: cleanNumber(r.quantity) ?? 0, unitPrice: cleanNumber(r.unit_price), purchaseUnitPrice: cleanNumber(r.purchase_unit_price),
    }));
    plan = planOfferItems(jobItems, qItemsRaw.map(quoteItemOf));
  }
  let created = 0;
  if (plan.create.length) {
    const rows = plan.create.map((it) => ({
      order_id: jobId, position: it.position, drawing_id: it.drawingId, drawing_number: it.drawingNumber, name: it.name,
      description: it.description, material: it.material, quantity: it.quantity, unit: it.unit,
      unit_price: it.unitPrice, purchase_unit_price: it.purchaseUnitPrice,
    }));
    const { data: ins, error } = await db.from("order_items").insert(rows as never).select("id");
    if (error) throw new Error(`položky: ${error.message}`);
    created = (ins ?? []).length;
  }
  let pricesUpdated = 0;
  let purchaseFilled = 0;
  for (const u of plan.update) {
    const patch: Row = {};
    if (u.unitPrice !== undefined) patch.unit_price = u.unitPrice;
    if (u.purchaseUnitPrice !== undefined) patch.purchase_unit_price = u.purchaseUnitPrice;
    let upd = db.from("order_items").update(patch as never).eq("id", u.id).eq("order_id", jobId);
    // nákupní cenu jen doplnit (mezitím ji mohl někdo zadat)
    if (u.purchaseUnitPrice !== undefined) upd = upd.is("purchase_unit_price", null);
    const { data, error } = await upd.select("id");
    if (error) {
      console.error(`[offer-sync] Cenu položky se nepodařilo zapsat: ${error.message}`);
      continue;
    }
    if (!(data ?? []).length) continue;
    if (u.unitPrice !== undefined) pricesUpdated += 1;
    if (u.purchaseUnitPrice !== undefined) purchaseFilled += 1;
  }

  // ── termín dodání ──
  const lead = leadOfTerms(quoteTermsOfQuote({
    number: number ?? "", leadTimeDays: cleanNumber(q.lead_time_days), deliveryTerms: (q.delivery_terms as string | null) ?? null, note: (q.note as string | null) ?? null,
  }));
  // jen spolehlivá lhůta (dny z nabídky v systému) — lhůta z textu chce kontrolu člověkem, termín se nedoplní sám
  const leadDays = lead && !lead.review && lead.unit === "kalendarni" && !lead.months ? lead.days : null;
  const jobDue = (job.due_date as string | null) ?? null;
  const due = planOfferDueDate({
    stage, jobDueDate: jobDue, previous, leadDays,
    orderDate: (job.order_date as string | null) ?? null, quoteDate: quoteDay(q),
  });

  const nextState: OfferSyncState = {
    quoteId: offer.id, number, itemsKey,
    // termín „z nabídky" = ten, který jsme teď zapsali, nebo dřív odvozený a v zakázce pořád beze změny
    dueDate: due.set ?? (previous?.dueDate && previous.dueDate === jobDue ? jobDue : null),
    leadDays, at: new Date().toISOString(),
  };
  const stateChanged = !previous || previous.quoteId !== nextState.quoteId || previous.itemsKey !== nextState.itemsKey
    || previous.dueDate !== nextState.dueDate || previous.leadDays !== nextState.leadDays;
  const orderPatch: Row = {};
  if (due.set) orderPatch.due_date = due.set;
  if (stateSupported && (stateChanged || due.set)) orderPatch.offer_sync = nextState;
  if (Object.keys(orderPatch).length) {
    const { error } = await db.from("orders").update(orderPatch as never).eq("id", jobId);
    if (error) throw new Error(`zakázka: ${error.message}`);
  }

  // ── hodnota / nákup z položek (DB trigger hodnotu přepočte sám; nákup podle položek jen bez objednávek) ──
  const before = cleanNumber(job.value);
  let value = before;
  if (created || pricesUpdated || purchaseFilled) {
    const money = await syncJobMoneyFromItems(db, jobId, { margins: true });
    value = money.value;
  }
  const valueChanged = !sameMoney(before, value);

  const changed = created > 0 || pricesUpdated > 0 || purchaseFilled > 0 || Boolean(due.set);
  if (changed) {
    await logJobEvent(db, {
      jobId, type: "quote", entity: "quote", entityId: offer.id, actorId: opts.actorId,
      message: offerSyncMessage({
        number, fromScratch: plan.fromScratch, created, pricesUpdated, purchaseFilled,
        value, valueChanged, currency: String(job.currency || "CZK"), dueDate: due.set, dueBase: due.base,
      }),
      data: {
        action: "offer_sync", reason: opts.reason, quoteId: offer.id, number,
        itemsCreated: created, pricesUpdated, purchaseFilled, value, previousValue: before,
        ...(due.set ? { dueDate: due.set, previousDueDate: jobDue, dueBase: due.base, leadDays } : {}),
      },
    });
  }
  return { ok: true, quoteId: offer.id, itemsCreated: created, pricesUpdated, purchaseFilled, dueDate: due.set, value };
}
