"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor, withChangeNote } from "@/lib/supabase/actor-headers";
import { checkFeature, getAccess } from "@/lib/auth/session";
import type { Feature } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/data/current-user";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { isJobStage } from "@/lib/jobs/stages";
import { cleanDate, cleanNumber, cleanText, computeItemTotals, isUuid, translateDbError } from "@/lib/jobs/mapping";
import type { ActionResult } from "@/lib/jobs/types";
import type { JobStage, LostReason } from "@/lib/supabase/database.types";
import {
  DECLINE_REASONS, NOT_ORDERED_REASONS, flowRank, isLostReason, reopenLostTarget, resumeTarget,
} from "@/lib/jobs/flow-status";
import {
  CLAIM_REASONS, CLAIM_RESOLUTIONS, FAILURE_NEXT, correctionDiff, correctionSummary, isClaimReason, isClaimResolution,
  type CorrectionChange, type FailureNext,
} from "@/lib/jobs/flow-exceptions";

/**
 * Výjimky v toku zakázky (majitel 31. 10.): Zákazník neobjednal / Nebudeme nabízet, Obnovit poptávku,
 * Pozastavit / Pokračovat, Výroba se nepovedla, Reklamace (zapsat, vyřešit, vyřídit), Vyrábět bez
 * objednávky + Objednávka zákazníka dorazila, Oprava zakázky, Aktualizace výkresu + Beru na vědomí.
 * Hlavní stav mění vždy jeden update s optimistickým zámkem (.eq("status", from)); autor jde v hlavičkách
 * klienta (DB zapíše stavovou událost s autorem a poznámkou), popisné události zapisuje akce.
 */

type Row = Record<string, unknown>;
type Result = ActionResult<{ stage?: JobStage }>;

interface Ctx {
  db: JobsDb;
  user: CurrentUser;
  can: (f: Feature) => boolean;
}

const NOT_FOUND = "Zakázka nenalezena.";
const PATHS = ["/orders", "/inquiries", "/pricing", "/quotes", "/confirmations", "/documents", "/purchasing", "/dashboard", "/"];
const NOTE_MAX = 500;

async function begin(feature: Feature): Promise<Ctx | { error: string }> {
  if (!isSupabaseConfigured()) return { error: "Supabase není nakonfigurováno." };
  const access = await checkFeature(feature);
  if ("error" in access) return { error: access.error };
  const { can } = await getAccess();
  const db = await createOperatorClient({ actor: userActor(access.user) });
  return { db, user: access.user, can };
}

function fail(err: unknown): { ok: false; error: string } {
  if (typeof err === "string") return { ok: false, error: translateDbError(err) };
  if (err && typeof err === "object" && "message" in err) return { ok: false, error: translateDbError(String((err as { message: unknown }).message)) };
  return { ok: false, error: "Neočekávaná chyba." };
}

function revalidate(jobId: string) {
  for (const p of PATHS) revalidatePath(p);
  revalidatePath(`/orders/${jobId}`);
}

async function loadJob(db: JobsDb, id: string, columns: string): Promise<Row | null> {
  const { data, error } = await db.from("orders").select(columns).eq("id", id).maybeSingle();
  if (error) console.error(`[flow-exceptions] Načtení zakázky selhalo: ${error.message}`);
  return (data as Row | null) ?? null;
}

async function stageOf(db: JobsDb, jobId: string): Promise<JobStage | undefined> {
  const r = await loadJob(db, jobId, "status");
  return r && isJobStage(r.status) ? r.status : undefined;
}

const CHANGED = "Stav zakázky se mezitím změnil — obnov stránku.";

/** Přesun hlavního stavu s optimistickým zámkem + poznámkou do historie (autor z hlaviček). */
async function moveStage(c: Ctx, jobId: string, from: JobStage, patch: Row, note: string | null): Promise<string | null> {
  const q = c.db.from("orders").update(patch as never).eq("id", jobId).eq("status", from);
  const { data, error } = await withChangeNote(q, note).select("id");
  if (error) return translateDbError(error.message);
  if (!data?.length) return CHANGED;
  return null;
}

// ── Zákazník neobjednal / Nebudeme nabízet ──────────────────
/**
 * Uzavřít poptávku / nabídku jako nerealizovanou: notOrdered = zákazník neobjednal (cena, termín, jiný
 * dodavatel, projekt zrušen, bez odpovědi, jiné), decline = nebudeme nabízet (my). Odeslané nabídky se
 * zamítnou, rozpracované archivují (DB), důvod a poznámka zůstanou u zakázky (Nerealizované & zrušené).
 */
export async function closeJobAsLost(
  jobId: string, kind: "notOrdered" | "decline", input: { reason: LostReason; note?: string | null },
): Promise<Result> {
  const c = await begin("margins");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const allowed = kind === "decline" ? DECLINE_REASONS : NOT_ORDERED_REASONS;
  if (!isLostReason(input?.reason) || !allowed.includes(input.reason)) return fail("Vyber důvod.");
  const text = cleanText(input.note, NOTE_MAX);
  if (input.reason === "jine" && !text) return fail("U důvodu „Jiný“ doplň poznámku.");
  try {
    const job = await loadJob(c.db, jobId, "id, status, side_from_stage");
    if (!job || !isJobStage(job.status)) return fail(NOT_FOUND);
    const from = job.status;
    const rank = flowRank(from);
    const pausedPre = from === "pozastaveno" && isJobStage(job.side_from_stage) && flowRank(job.side_from_stage) >= 0 && flowRank(job.side_from_stage) <= 2;
    if (!(rank >= 0 && rank <= 2) && !pausedPre) return fail("Zákazník už objednal — zakázku zruš přes „Stornovat objednávku…“.");
    if (kind === "decline" && rank === 2) return fail("Nabídka už odešla — použij „Zákazník neobjednal…“.");
    // poptávka odmítnutá (my) / stažená (zákazník) — dorovná DB podle strany důvodu
    const err = await moveStage(c, jobId, from, { status: "nerealizovano", lost_reason: input.reason, lost_note: text }, null);
    if (err) return fail(err);
    // zamítnuté nabídky nesou stejný důvod (učí se z něj i AI)
    await c.db.from("quotes").update({ lost_reason: input.reason, lost_note: text } as never)
      .eq("job_id", jobId).eq("status", "zamitnuto").is("lost_reason", null);
    revalidate(jobId);
    return { ok: true, stage: await stageOf(c.db, jobId) };
  } catch (err) {
    return fail(err);
  }
}

/** „Obnovit poptávku": nerealizovaná zakázka zpět do stavu před prohrou (max. Nabídka); zamítnutá nabídka znovu odeslaná. */
export async function reopenLostJob(jobId: string, input: { note?: string | null } = {}): Promise<Result> {
  const c = await begin("margins");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  try {
    const job = await loadJob(c.db, jobId, "id, status, side_from_stage");
    if (!job || job.status !== "nerealizovano") return fail("Obnovit jde jen nerealizovanou zakázku.");
    const target = reopenLostTarget({ stage: "nerealizovano", sideFromStage: isJobStage(job.side_from_stage) ? job.side_from_stage : null });
    let to: JobStage = target;
    if (target === "nabidka") {
      // poslední zamítnutá (nearchivovaná) verze nabídky je zase odeslaná — zákazník se vrátil
      const { data: qs } = await c.db.from("quotes").select("id, revision").eq("job_id", jobId).eq("status", "zamitnuto")
        .eq("archived", false).order("revision", { ascending: false }).limit(1);
      const q = ((qs ?? []) as { id: string }[])[0];
      if (q) {
        const { error } = await withChangeNote(c.db.from("quotes").update({ status: "odeslano" } as never)
          .eq("id", q.id).eq("status", "zamitnuto"), "poptávka obnovena");
        if (error) return fail(error);
      } else {
        to = "poptavka";
      }
    }
    const text = cleanText(input.note, NOTE_MAX);
    const err = await moveStage(c, jobId, "nerealizovano", { status: to }, ["poptávka obnovena", text].filter(Boolean).join(" — "));
    if (err && err !== CHANGED) return fail(err);
    revalidate(jobId);
    return { ok: true, stage: await stageOf(c.db, jobId) };
  } catch (err) {
    return fail(err);
  }
}

// ── Pozastavit / Pokračovat ─────────────────────────────────
export async function pauseJob(jobId: string, input: { reason: string }): Promise<Result> {
  const c = await begin("orders");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const reason = cleanText(input?.reason, 300);
  if (!reason) return fail("Napiš, proč zakázka stojí.");
  try {
    const job = await loadJob(c.db, jobId, "id, status");
    if (!job || !isJobStage(job.status)) return fail(NOT_FOUND);
    const rank = flowRank(job.status);
    if (rank < 0 || rank > 10) return fail("Pozastavit jde jen rozpracovanou zakázku.");
    const err = await moveStage(c, jobId, job.status, { status: "pozastaveno", hold_reason: reason }, `pozastaveno — ${reason}`);
    if (err) return fail(err);
    revalidate(jobId);
    return { ok: true, stage: "pozastaveno" };
  } catch (err) {
    return fail(err);
  }
}

/** „Pokračovat": pozastavená zakázka zpět do stavu, ve kterém se zastavila. */
export async function resumeJob(jobId: string, input: { note?: string | null } = {}): Promise<Result> {
  const c = await begin("orders");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  try {
    const job = await loadJob(c.db, jobId, "id, status, side_from_stage");
    if (!job || job.status !== "pozastaveno") return fail("Zakázka není pozastavená.");
    const to = resumeTarget({ stage: "pozastaveno", sideFromStage: isJobStage(job.side_from_stage) ? job.side_from_stage : null });
    if (!to) return fail("Nevím, kde zakázka stála — vyber stav v „Korekce stavu…“.");
    const text = cleanText(input.note, NOTE_MAX);
    const err = await moveStage(c, jobId, "pozastaveno", { status: to }, ["pokračuje", text].filter(Boolean).join(" — "));
    if (err) return fail(err);
    revalidate(jobId);
    return { ok: true, stage: to };
  } catch (err) {
    return fail(err);
  }
}

// ── Výroba se nepovedla ─────────────────────────────────────
export async function recordProductionFailure(
  jobId: string,
  input: { itemId?: string | null; qty?: number | null; reason: string; note?: string | null; next: FailureNext },
): Promise<Result & { handoff?: "plan" | "predani" | null }> {
  const c = await begin("orders");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const reason = cleanText(input?.reason, 200);
  if (!reason) return fail("Vyber, co se stalo.");
  if (!input || !(input.next in FAILURE_NEXT)) return fail("Vyber, co dál.");
  if (input.next === "cancel" && !c.can("margins")) return fail("Zrušit zakázku smí obchodník nebo admin — navrhni to.");
  const qty = cleanNumber(input.qty);
  if (qty !== null && (qty <= 0 || qty > 1_000_000)) return fail("Neplatný počet kusů.");
  if (input.itemId && !isUuid(input.itemId)) return fail("Položka nenalezena.");
  const text = cleanText(input.note, NOTE_MAX);
  try {
    const job = await loadJob(c.db, jobId, "id, status");
    if (!job || !isJobStage(job.status)) return fail(NOT_FOUND);
    const rank = flowRank(job.status);
    if (rank < 5 || rank > 8) return fail("Zmetek jde zapsat jen ve výrobě nebo u hotových dílů před dodáním.");
    let itemLabel: string | null = null;
    let itemQty: number | null = null;
    if (input.itemId) {
      const { data } = await c.db.from("order_items").select("id, drawing_number, name, quantity, unit").eq("id", input.itemId).eq("order_id", jobId).maybeSingle();
      const it = data as { drawing_number: string | null; name: string | null; quantity: number; unit: string | null } | null;
      if (!it) return fail("Položka nepatří k této zakázce.");
      itemLabel = (it.drawing_number ?? "").trim() || (it.name ?? "").trim() || "položka";
      itemQty = Number(it.quantity) || null;
      if (qty !== null && itemQty !== null && qty > itemQty) return fail(`Zmetků je víc než objednaných kusů (${itemQty}).`);
    }
    const partial = qty !== null && itemQty !== null && qty < itemQty;
    const what = [itemLabel, qty !== null ? `${qty} ks${itemQty ? ` z ${itemQty}` : ""}` : null].filter(Boolean).join(" · ");
    const nextLabel = FAILURE_NEXT[input.next].label;
    await logJobEvent(c.db, {
      jobId, type: "field", entity: "operation", actorId: c.user.id,
      message: `Výroba se nepovedla${what ? ` (${what})` : ""} — ${reason}${text ? `: ${text}` : ""} · dál: ${nextLabel}`,
      data: { exception: "production_failed", itemId: input.itemId ?? null, qty, reason, note: text, next: input.next, partial },
    });
    if (input.next === "cancel") {
      const err = await moveStage(c, jobId, job.status, {
        status: "zruseno", lost_reason: "vyroba", lost_note: [reason, what, text].filter(Boolean).join(" — ").slice(0, NOTE_MAX),
      }, null);
      if (err) return fail(err);
      revalidate(jobId);
      return { ok: true, stage: await stageOf(c.db, jobId), handoff: null };
    }
    revalidate(jobId);
    // vyrobit znovu: ve výrobě nový krok (plán), u hotových dílů zpět do výroby (předání)
    return { ok: true, stage: job.status, handoff: input.next === "remake" ? (job.status === "ve_vyrobe" ? "plan" : "predani") : null };
  } catch (err) {
    return fail(err);
  }
}

// ── Reklamace ───────────────────────────────────────────────
export async function openClaim(
  jobId: string,
  input: { reason: string; qty?: number | null; itemId?: string | null; note?: string | null },
): Promise<Result> {
  const c = await begin("orders");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (!isClaimReason(input?.reason)) return fail("Vyber důvod reklamace.");
  const text = cleanText(input.note, 2000);
  if (!text) return fail("Popiš, co zákazník reklamuje.");
  const qty = cleanNumber(input.qty);
  if (qty !== null && (qty <= 0 || qty > 1_000_000)) return fail("Neplatný počet kusů.");
  if (input.itemId && !isUuid(input.itemId)) return fail("Položka nenalezena.");
  try {
    const job = await loadJob(c.db, jobId, "id, status, items_count, items_delivered, claim_opened_at, claim_resolved_at");
    if (!job || !isJobStage(job.status)) return fail(NOT_FOUND);
    const rank = flowRank(job.status);
    const delivered = (rank >= 9 && rank <= 11) || (rank >= 3 && rank <= 8 && Number(job.items_count) > 0 && Number(job.items_delivered) >= Number(job.items_count));
    if (!delivered) return fail("Reklamovat jde dodanou zakázku.");
    if (job.claim_opened_at && !job.claim_resolved_at) return fail("Reklamace už je otevřená.");
    if (input.itemId) {
      const { data } = await c.db.from("order_items").select("id").eq("id", input.itemId).eq("order_id", jobId).maybeSingle();
      if (!data) return fail("Položka nepatří k této zakázce.");
    }
    const patch: Row = {
      status: "reklamace", claim_opened_at: new Date().toISOString(), claim_opened_by: c.user.id, claim_reason: input.reason,
      claim_qty: qty, claim_item_id: input.itemId || null, claim_note: text, claim_from_stage: job.status,
      claim_resolution: null, claim_resolution_note: null, claim_resolved_at: null, claim_resolved_by: null,
    };
    const label = CLAIM_REASONS[input.reason];
    const err = await moveStage(c, jobId, job.status, patch, `reklamace — ${label}${qty ? ` (${qty} ks)` : ""}: ${text}`.slice(0, NOTE_MAX));
    if (err) return fail(err);
    revalidate(jobId);
    return { ok: true, stage: "reklamace" };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Vyřešit reklamaci: oprava = díly zpět (dodané množství reklamované položky se sníží), zakázka zůstává
 * v Reklamaci a další krok je předání do výroby; dobropis / zamítnuto = reklamace vyřízená, zakázka se vrátí
 * tam, kde byla (dodáno / vyfakturováno / dokončeno).
 */
export async function resolveClaim(jobId: string, input: { resolution: string; note?: string | null }): Promise<Result> {
  const c = await begin("orders");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (!isClaimResolution(input?.resolution)) return fail("Vyber, jak reklamaci řešíme.");
  const text = cleanText(input.note, NOTE_MAX);
  if (input.resolution !== "oprava" && !text) return fail("Doplň poznámku (číslo dobropisu, proč zamítáme…).");
  try {
    const job = await loadJob(c.db, jobId, "id, status, claim_from_stage, side_from_stage, claim_item_id, claim_qty, claim_opened_at");
    if (!job || job.status !== "reklamace") return fail("Zakázka není v reklamaci.");
    const now = new Date().toISOString();
    const label = CLAIM_RESOLUTIONS[input.resolution].label;
    if (input.resolution === "oprava") {
      const { data, error } = await withChangeNote(c.db.from("orders").update({
        claim_resolution: "oprava", claim_resolution_note: text, claim_opened_at: job.claim_opened_at ?? now,
      } as never).eq("id", jobId).eq("status", "reklamace"), null).select("id");
      if (error) return fail(error);
      if (!data?.length) return fail(CHANGED);
      // reklamované kusy se vrací k opravě / výrobě → u položky chybí do dodání (zakázka je zase v běhu)
      const itemId = typeof job.claim_item_id === "string" ? job.claim_item_id : null;
      const qty = cleanNumber(job.claim_qty);
      let back = "";
      if (itemId && qty) {
        const { data: it } = await c.db.from("order_items").select("delivered_quantity, unit").eq("id", itemId).eq("order_id", jobId).maybeSingle();
        const row = it as { delivered_quantity: number; unit: string | null } | null;
        if (row) {
          const to = Math.max(0, Math.round((Number(row.delivered_quantity) - qty) * 1000) / 1000);
          const { error: upErr } = await c.db.from("order_items").update({ delivered_quantity: to, delivery_closed: false } as never).eq("id", itemId);
          if (!upErr) back = ` · dodáno zpět na ${to} ${row.unit ?? "ks"}`;
        }
      }
      await logJobEvent(c.db, {
        jobId, type: "field", entity: "job", actorId: c.user.id,
        message: `Reklamace: ${label}${text ? ` — ${text}` : ""}${back}`, data: { exception: "claim_resolution", resolution: "oprava" },
      });
      revalidate(jobId);
      return { ok: true, stage: "reklamace" };
    }
    const back = isJobStage(job.claim_from_stage) && flowRank(job.claim_from_stage) >= 0 ? job.claim_from_stage
      : isJobStage(job.side_from_stage) && flowRank(job.side_from_stage) >= 0 ? job.side_from_stage : "dodano_zakaznikovi";
    const err = await moveStage(c, jobId, "reklamace", {
      status: back, claim_resolution: input.resolution, claim_resolution_note: text, claim_resolved_at: now, claim_resolved_by: c.user.id,
      claim_opened_at: job.claim_opened_at ?? now,
    }, `reklamace vyřízena: ${label}${text ? ` — ${text}` : ""}`.slice(0, NOTE_MAX));
    if (err) return fail(err);
    revalidate(jobId);
    return { ok: true, stage: back };
  } catch (err) {
    return fail(err);
  }
}

/** „Reklamace vyřízena" po opravě: reklamace uzavřená, zakázka zpět do stavu před reklamací (je-li dál). */
export async function closeClaim(jobId: string, input: { note?: string | null } = {}): Promise<Result> {
  const c = await begin("orders");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const text = cleanText(input.note, NOTE_MAX);
  try {
    const job = await loadJob(c.db, jobId, "id, status, claim_opened_at, claim_resolved_at, claim_from_stage, claim_resolution");
    if (!job || !isJobStage(job.status)) return fail(NOT_FOUND);
    if (!job.claim_opened_at || job.claim_resolved_at) return fail("Zakázka nemá otevřenou reklamaci.");
    const now = new Date().toISOString();
    const from = job.status;
    const prev = isJobStage(job.claim_from_stage) ? job.claim_from_stage : null;
    const to = prev && flowRank(prev) > flowRank(from) ? prev : from === "reklamace" ? prev ?? "dodano_zakaznikovi" : from;
    const patch: Row = { claim_resolved_at: now, claim_resolved_by: c.user.id, claim_resolution: job.claim_resolution ?? "oprava" };
    if (text) patch.claim_resolution_note = text;
    if (to !== from) patch.status = to;
    const err = await moveStage(c, jobId, from, patch, `reklamace vyřízena${text ? ` — ${text}` : ""}`);
    if (err) return fail(err);
    if (to === from) {
      await logJobEvent(c.db, {
        jobId, type: "field", entity: "job", actorId: c.user.id,
        message: `Reklamace vyřízena${text ? ` — ${text}` : ""}`, data: { exception: "claim_closed" },
      });
    }
    revalidate(jobId);
    return { ok: true, stage: to };
  } catch (err) {
    return fail(err);
  }
}

// ── Vyrábět bez objednávky ──────────────────────────────────
/**
 * Zákazník napsal „vyrábějte" (objednávka dorazí později): zakázka → Objednávka s příznakem „čeká na
 * objednávku zákazníka"; potvrzení se nevyžaduje (pošle se až s číslem objednávky). Další krok = předání do výroby.
 */
export async function startWithoutCustomerPo(jobId: string, input: { note?: string | null } = {}): Promise<Result> {
  const c = await begin("orders");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const text = cleanText(input.note, 300);
  try {
    const job = await loadJob(c.db, jobId, "id, status, customer_order_number, awaiting_customer_po");
    if (!job || !isJobStage(job.status)) return fail(NOT_FOUND);
    const rank = flowRank(job.status);
    if (rank < 0 || rank > 2) return fail("Zakázka už je objednaná — předej ji do výroby.");
    if ((typeof job.customer_order_number === "string" ? job.customer_order_number : "").trim()) {
      return fail("Zakázka už má číslo objednávky zákazníka — zapiš objednávku běžně.");
    }
    const err = await moveStage(c, jobId, job.status, {
      status: "objednavka", awaiting_customer_po: true, awaiting_po_note: text, awaiting_po_by: c.user.id,
      order_date: new Date().toISOString().slice(0, 10),
    }, `vyrábět bez objednávky zákazníka${text ? ` — ${text}` : ""}`);
    if (err) return fail(err);
    revalidate(jobId);
    return { ok: true, stage: "objednavka" };
  } catch (err) {
    return fail(err);
  }
}

/** Objednávka zákazníka dorazila (k zakázce vyráběné bez ní): číslo a datum → příznak zmizí (DB), další krok potvrzení. */
export async function registerCustomerPo(
  jobId: string, input: { number: string; date?: string | null; note?: string | null },
): Promise<Result> {
  const c = await begin("workflow");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const number = cleanText(input?.number, 120);
  if (!number) return fail("Zapiš číslo objednávky zákazníka.");
  const date = input.date ? cleanDate(input.date) : null;
  if (input.date && !date) return fail("Neplatné datum objednávky.");
  try {
    const job = await loadJob(c.db, jobId, "id, status, awaiting_customer_po");
    if (!job) return fail(NOT_FOUND);
    const patch: Row = { customer_order_number: number };
    if (date) patch.order_date = date;
    const q = c.db.from("orders").update(patch as never).eq("id", jobId);
    const { error } = await withChangeNote(q, cleanText(input.note, NOTE_MAX));
    if (error) return fail(error);
    if (!job.awaiting_customer_po) {
      await logJobEvent(c.db, {
        jobId, type: "field", entity: "order", actorId: c.user.id,
        message: `Objednávka zákazníka: ${number}`, data: { exception: "po_number", customerOrderNumber: number },
      });
    }
    revalidate(jobId);
    return { ok: true, stage: await stageOf(c.db, jobId) };
  } catch (err) {
    return fail(err);
  }
}

// ── Oprava zakázky ──────────────────────────────────────────
export interface CorrectionResult {
  changes: CorrectionChange[];
  /** Potvrzení už zákazníkovi odešlo → nabídnout „Poslat opravené potvrzení". */
  confirmationSent: boolean;
  /** Objednávky dodavatelům, kterých se změna týká (otevřené). */
  purchaseOrders: { id: string; number: string; supplier: string | null; status: string }[];
  /** Zakázka se už vyrábí. */
  inProduction: boolean;
}

/**
 * Oprava zakázky od zákazníka (množství, ceny, termín, dodací adresa) s povinným důvodem: zapíše změny,
 * přepočte hodnotu, rozdíl uloží jako revizi objednávky (potvrzená → změna rovnou přijatá) a do historie.
 */
export async function correctOrder(
  jobId: string,
  input: { reason: string; items: { id: string; quantity: number; unitPrice?: number | null }[]; dueDate?: string | null; deliveryNote?: string | null },
): Promise<ActionResult<CorrectionResult>> {
  const c = await begin("orders");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const reason = cleanText(input?.reason, NOTE_MAX);
  if (!reason || reason.length < 3) return fail("Napiš krátce, co se opravuje a proč.");
  const margins = c.can("margins");
  const due = input.dueDate ? cleanDate(input.dueDate) : null;
  if (input.dueDate && !due) return fail("Neplatný termín.");
  try {
    const job = await loadJob(c.db, jobId, "id, status, order_status, due_date, value, confirmation_sent_revision, customer_note, production_total, production_done");
    if (!job || !isJobStage(job.status)) return fail(NOT_FOUND);
    if (!job.order_status || job.order_status === "stornovana") return fail("Opravit jde objednanou zakázku.");
    const { data: itemData, error: itErr } = await c.db.from("order_items")
      .select("id, drawing_number, name, quantity, unit_price, purchase_unit_price, unit").eq("order_id", jobId).order("position");
    if (itErr) return fail(itErr);
    const items = (itemData ?? []) as { id: string; drawing_number: string | null; name: string | null; quantity: number; unit_price: number | null; purchase_unit_price: number | null; unit: string | null }[];
    const byId = new Map(items.map((i) => [i.id, i]));
    const nextItems: { id: string; quantity: number; unitPrice?: number | null }[] = [];
    for (const it of Array.isArray(input.items) ? input.items.slice(0, 500) : []) {
      if (!it || !isUuid(it.id) || !byId.has(it.id)) return fail("Položka nepatří k této zakázce.");
      const q = Number(it.quantity);
      if (!Number.isFinite(q) || q < 0 || q > 1_000_000) return fail("Neplatné množství.");
      const price = margins && it.unitPrice !== undefined ? cleanNumber(it.unitPrice) : undefined;
      if (price !== undefined && price !== null && (price < 0 || price > 1e9)) return fail("Neplatná cena.");
      nextItems.push({ id: it.id, quantity: Math.round(q * 1000) / 1000, ...(price !== undefined ? { unitPrice: price } : {}) });
    }
    const before = {
      items: items.map((i) => ({ id: i.id, label: (i.drawing_number ?? "").trim() || (i.name ?? "").trim() || "Položka", quantity: Number(i.quantity), unitPrice: i.unit_price === null ? null : Number(i.unit_price) })),
      dueDate: typeof job.due_date === "string" ? job.due_date : null,
      deliveryNote: null,
    };
    const changes = correctionDiff(before, { items: nextItems, dueDate: input.dueDate === undefined ? before.dueDate : due, deliveryNote: input.deliveryNote ?? null }, { prices: margins });
    if (!changes.length) return fail("Nic se nezměnilo — uprav množství, cenu, termín nebo dodací adresu.");

    for (const it of nextItems) {
      const prev = byId.get(it.id)!;
      const patch: Row = {};
      if (Math.abs(Number(prev.quantity) - it.quantity) > 1e-9) patch.quantity = it.quantity;
      if (it.unitPrice !== undefined && (it.unitPrice ?? null) !== (prev.unit_price === null ? null : Number(prev.unit_price))) patch.unit_price = it.unitPrice;
      if (!Object.keys(patch).length) continue;
      const { error } = await c.db.from("order_items").update(patch as never).eq("id", it.id).eq("order_id", jobId);
      if (error) return fail(error);
    }
    const jobPatch: Row = { corrected_at: new Date().toISOString(), corrected_by: c.user.id, corrected_note: reason };
    if (input.dueDate !== undefined && due !== (before.dueDate ?? null)) jobPatch.due_date = due;
    const addr = cleanText(input.deliveryNote, 1000);
    if (addr) jobPatch.customer_note = [typeof job.customer_note === "string" ? job.customer_note : null, `Dodací adresa / pokyny (oprava): ${addr}`].filter(Boolean).join("\n");
    // hodnota zakázky z položek (jako uložení položek)
    const after = items.map((i) => {
      const n = nextItems.find((x) => x.id === i.id);
      return { quantity: n ? n.quantity : Number(i.quantity), unitPrice: n?.unitPrice !== undefined ? n.unitPrice : i.unit_price, purchaseUnitPrice: i.purchase_unit_price };
    });
    if (after.some((i) => i.unitPrice !== null && i.unitPrice !== undefined)) jobPatch.value = computeItemTotals(after).value;
    const { error: jobErr } = await withChangeNote(c.db.from("orders").update(jobPatch as never).eq("id", jobId), reason);
    if (jobErr) return fail(jobErr);

    // revize objednávky s rozdílem (potvrzená objednávka → změna se rovnou přijme, další krok = opravené potvrzení)
    const summary = correctionSummary(changes);
    const ordStatus = String(job.order_status);
    const { error: revErr } = await withChangeNote(c.db.rpc("flow_register_order_change", {
      p_job: jobId, p_note: `Oprava zakázky: ${reason}`, p_file: null, p_changes: changes, p_customer_order_number: null,
    }), reason);
    if (revErr) return fail(revErr);
    if (ordStatus === "potvrzena") {
      const { error: decErr } = await withChangeNote(c.db.rpc("flow_decide_order_change", { p_job: jobId, p_accept: true, p_note: reason }), reason);
      if (decErr) return fail(decErr);
    }
    await logJobEvent(c.db, {
      jobId, type: "field", entity: "order", actorId: c.user.id,
      message: `Oprava zakázky — ${reason}: ${summary}`.slice(0, 2000),
      data: { exception: "correction", reason, changes },
    });

    const { data: pos } = await c.db.from("purchase_orders").select("id, number, status, supplier:suppliers!supplier_id(name)")
      .eq("job_id", jobId).in("status", ["vystavena", "odeslana", "potvrzena"]);
    const purchaseOrders = ((pos ?? []) as { id: string; number: string; status: string; supplier?: { name: string | null } | { name: string | null }[] | null }[])
      .map((p) => ({ id: p.id, number: p.number, status: p.status, supplier: (Array.isArray(p.supplier) ? p.supplier[0] : p.supplier)?.name ?? null }));
    revalidate(jobId);
    return {
      ok: true, changes,
      confirmationSent: Number(job.confirmation_sent_revision) > 0,
      purchaseOrders: c.can("margins") ? purchaseOrders : [],
      inProduction: job.status === "ve_vyrobe" && Number(job.production_total) > Number(job.production_done),
    };
  } catch (err) {
    return fail(err);
  }
}

// ── Aktualizace výkresu ─────────────────────────────────────
/**
 * Nová revize výkresu položky: revize položky (→ DB zapíše změnu a štítek „Nová revize"), nový soubor se
 * stane aktuálním výkresem položky (starý zůstane jako nahrazená verze). Anonymizace nového souboru běží
 * jako u každého nahraného výkresu.
 */
export async function recordDrawingRevision(
  jobId: string, input: { itemId: string; revision: string; fileId?: string | null; note?: string | null },
): Promise<ActionResult<{ changeId: string | null }>> {
  const c = await begin("workflow");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (!isUuid(input?.itemId)) return fail("Vyber položku.");
  const rev = cleanText(input.revision, 40);
  if (!rev) return fail("Zapiš novou revizi výkresu.");
  if (input.fileId && !isUuid(input.fileId)) return fail("Soubor nenalezen.");
  const text = cleanText(input.note, NOTE_MAX);
  try {
    const { data: itData } = await c.db.from("order_items").select("id, drawing_number, revision").eq("id", input.itemId).eq("order_id", jobId).maybeSingle();
    const item = itData as { id: string; drawing_number: string | null; revision: string | null } | null;
    if (!item) return fail("Položka nepatří k této zakázce.");
    const fromRev = (item.revision ?? "").trim() || null;
    if (fromRev && fromRev.toUpperCase() === rev.toUpperCase()) return fail(`Položka už má revizi ${rev}.`);

    // nový soubor = aktuální výkres položky; předchozí výkres položky → nahrazená verze
    let oldFileId: string | null = null;
    if (input.fileId) {
      const { data: f } = await c.db.from("job_files").select("id, job_id, version").eq("id", input.fileId).maybeSingle();
      const nf = f as { id: string; job_id: string; version: number } | null;
      if (!nf || nf.job_id !== jobId) return fail("Soubor nepatří k této zakázce.");
      const { data: olds } = await c.db.from("job_files").select("id, version, filename, order_item_id")
        .eq("job_id", jobId).eq("kind", "vykres").eq("archived", false).neq("id", nf.id).order("created_at", { ascending: false });
      const dn = (item.drawing_number ?? "").replace(/[\s.\-/]/g, "").toUpperCase();
      // stejný název souboru = nahrazený už při nahrání (automatická nová verze)
      const { data: replacedRows } = await c.db.from("job_files").select("id, version, filename, order_item_id").eq("replaced_by", nf.id).limit(1);
      const replaced = ((replacedRows ?? []) as { id: string; version: number; filename: string; order_item_id: string | null }[])[0] ?? null;
      const old = replaced ?? ((olds ?? []) as { id: string; version: number; filename: string; order_item_id: string | null }[])
        .find((o) => o.order_item_id === item.id || (dn && o.filename.replace(/[\s.\-/]/g, "").toUpperCase().includes(dn))) ?? null;
      oldFileId = old?.id ?? null;
      const newPatch: Row = { order_item_id: item.id, kind: "vykres", note: `Revize ${rev}${fromRev ? ` (nahrazuje ${fromRev})` : ""}` };
      if (old) newPatch.version = Math.max(Number(nf.version) || 1, (Number(old.version) || 1) + 1);
      await c.db.from("job_files").update(newPatch as never).eq("id", nf.id);
      if (old) {
        await c.db.from("job_files").update({ archived: true, replaced_by: nf.id, note: `nahrazeno rev. ${rev}` } as never).eq("id", old.id);
      }
    }

    // revize položky — DB (trigger) zapíše změnu revize (s autorem); položka bez revize → zápis ručně
    const { error: upErr } = await withChangeNote(c.db.from("order_items").update({ revision: rev } as never).eq("id", item.id), text);
    if (upErr) return fail(upErr);
    let changeId: string | null = null;
    if (fromRev) {
      const { data: ch } = await c.db.from("job_drawing_changes").select("id").eq("order_item_id", item.id)
        .is("acknowledged_at", null).order("created_at", { ascending: false }).limit(1);
      changeId = ((ch ?? []) as { id: string }[])[0]?.id ?? null;
      if (changeId && (input.fileId || oldFileId || text)) {
        await c.db.from("job_drawing_changes").update({ file_id: input.fileId ?? null, old_file_id: oldFileId, note: text } as never).eq("id", changeId);
      }
    } else {
      const { data: ins, error: insErr } = await c.db.from("job_drawing_changes").insert({
        job_id: jobId, order_item_id: item.id, drawing_number: item.drawing_number, rev_from: null, rev_to: rev,
        file_id: input.fileId ?? null, old_file_id: oldFileId, note: text,
      } as never).select("id").single();
      if (insErr) return fail(insErr);
      changeId = (ins as { id: string } | null)?.id ?? null;
    }
    revalidate(jobId);
    return { ok: true, changeId };
  } catch (err) {
    return fail(err);
  }
}

/** „Beru na vědomí" — změna revize výkresu (nebo všechny na zakázce) potvrzená s autorem; banner zmizí. */
export async function acknowledgeDrawingChanges(jobId: string, input: { changeId?: string | null; note?: string | null } = {}): Promise<ActionResult<{ count: number }>> {
  const c = await begin("workflow");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (input.changeId && !isUuid(input.changeId)) return fail("Změna nenalezena.");
  try {
    let q = c.db.from("job_drawing_changes").update({ acknowledged_at: new Date().toISOString(), acknowledged_by: c.user.id, ack_note: cleanText(input.note, NOTE_MAX) } as never)
      .eq("job_id", jobId).is("acknowledged_at", null);
    if (input.changeId) q = q.eq("id", input.changeId);
    const { data, error } = await q.select("id");
    if (error) return fail(error);
    revalidate(jobId);
    return { ok: true, count: (data ?? []).length };
  } catch (err) {
    return fail(err);
  }
}

/** Objednávky dodavatelům dostaly novou revizi výkresu (označit „změna výkresu" — e-mail jde přes okno pošty). */
export async function markPurchaseOrdersDrawingChanged(jobId: string, input: { purchaseOrderIds: string[]; note: string }): Promise<ActionResult<{ count: number }>> {
  const c = await begin("margins");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const ids = (Array.isArray(input?.purchaseOrderIds) ? input.purchaseOrderIds : []).filter((x) => isUuid(x));
  if (!ids.length) return fail("Vyber objednávky.");
  const note = cleanText(input.note, NOTE_MAX) ?? "Změna výkresu";
  try {
    const { data, error } = await c.db.from("purchase_orders").update({ drawing_changed_at: new Date().toISOString(), drawing_change_note: note } as never)
      .eq("job_id", jobId).in("id", ids).select("id, number");
    if (error) return fail(error);
    const rows = (data ?? []) as { id: string; number: string }[];
    for (const r of rows) {
      await logJobEvent(c.db, {
        jobId, type: "field", entity: "purchase_order", entityId: r.id, actorId: c.user.id,
        message: `Objednávka ${r.number}: změna výkresu — ${note}`, data: { exception: "po_drawing_changed", purchaseOrderId: r.id },
      });
    }
    revalidate(jobId);
    return { ok: true, count: rows.length };
  } catch (err) {
    return fail(err);
  }
}
