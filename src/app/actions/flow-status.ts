"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor, withChangeNote } from "@/lib/supabase/actor-headers";
import { checkFeature, getAccess } from "@/lib/auth/session";
import type { Feature } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/data/current-user";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { isJobStage } from "@/lib/jobs/stages";
import { cleanDate, cleanText, isUuid, todayIso, translateDbError } from "@/lib/jobs/mapping";
import type { ActionResult } from "@/lib/jobs/types";
import type {
  FlowProposal, InquiryStatus, JobStage, LostReason, OrderDocStatus, OrderMismatch, OrderMismatchKind, QuoteState,
} from "@/lib/supabase/database.types";
import {
  FLOW_ORDER_COLUMNS, FLOW_QUOTE_COLUMNS, INQUIRY_STATES, ORDER_STATES, QUOTE_ADMIN_ONLY, QUOTE_STATES, actorName,
  canTransition, flowFactsFromRow, isInquiryStatus, isLostReason, isOrderDocStatus,
  isQuoteState, lostReasonLabel, lostReasonsFor, paymentKey, quoteFactsFromRow, quoteLabel, quoteSendBlock, reasonRequired,
  relativeStampTime, stageEffect, transitionFeature, type ActionCtx, type PaymentState, type StageEffect,
} from "@/lib/jobs/flow-status";
import { approveQuoteCore } from "@/lib/jobs/quote-approval-store";

/**
 * Akce podrobných stavů obchodního toku. Každý zápis je JEDEN update nebo RPC s optimistickým
 * zámkem (.eq(<stav>, from)); autor jde v hlavičkách klienta (DB doplní *_by/at/via i stavové
 * události), poznámka v hlavičce x-change-note. Popisné události (dodání, platba) zapisuje akce.
 */

type Row = Record<string, unknown>;
type FlowResult = ActionResult<{
  stage: JobStage; inquiryStatus: InquiryStatus | null; orderStatus: OrderDocStatus | null; quoteState: QuoteState;
}>;

interface Ctx {
  db: JobsDb;
  user: CurrentUser;
  can: (f: Feature) => boolean;
}

const NOT_FOUND = "Zakázka nenalezena.";
const QUOTE_NOT_FOUND = "Nabídka nenalezena.";
const NOTE_MAX = 500;
const FLOW_PATHS = ["/orders", "/inquiries", "/pricing", "/quotes", "/confirmations", "/documents", "/purchasing", "/dashboard", "/"];

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

function deny(): { ok: false; error: string } {
  return { ok: false, error: "K této akci nemáš oprávnění." };
}

function revalidateFlow(jobId?: string | null) {
  for (const p of FLOW_PATHS) revalidatePath(p);
  if (jobId) revalidatePath(`/orders/${jobId}`);
}

function note(v: unknown): string | null {
  return cleanText(v, NOTE_MAX);
}

function actionCtx(c: Ctx): ActionCtx {
  return { can: c.can, userId: c.user.id, isSuperAdmin: c.user.role === "super_admin", assigneeId: null };
}

async function loadJob(db: JobsDb, id: string, columns: string): Promise<Row | null> {
  const { data, error } = await db.from("orders").select(columns).eq("id", id).maybeSingle();
  if (error) console.error(`[flow] Načtení zakázky selhalo: ${error.message}`);
  return (data as Row | null) ?? null;
}

async function personName(db: JobsDb, id: unknown): Promise<string | null> {
  if (typeof id !== "string" || !isUuid(id)) return null;
  const { data } = await db.from("profiles").select("full_name, email").eq("id", id).maybeSingle();
  const p = data as { full_name: string | null; email: string | null } | null;
  return (p?.full_name ?? "").trim() || (p?.email ?? "").trim() || null;
}

/** „Stav mezitím změnil Jan Novák (před 1 min) — obnov stránku.“ */
async function conflict(db: JobsDb, table: "orders" | "quotes", id: string, prefix: string): Promise<{ ok: false; error: string }> {
  const { data } = await db.from(table).select(`${prefix}_at, ${prefix}_by`).eq("id", id).maybeSingle();
  const r = (data as Row | null) ?? {};
  const who = (await personName(db, r[`${prefix}_by`])) ?? actorName({ by: null, byName: null, kind: "system", via: null });
  const when = relativeStampTime(typeof r[`${prefix}_at`] === "string" ? (r[`${prefix}_at`] as string) : null);
  return { ok: false, error: `Stav mezitím změnil ${who}${when ? ` (${when})` : ""} — obnov stránku.` };
}

async function readBack(db: JobsDb, jobId: string): Promise<{ stage: JobStage; inquiryStatus: InquiryStatus | null; orderStatus: OrderDocStatus | null } | null> {
  const r = await loadJob(db, jobId, "status, inquiry_status, order_status");
  if (!r || !isJobStage(r.status)) return null;
  return {
    stage: r.status,
    inquiryStatus: isInquiryStatus(r.inquiry_status) ? r.inquiry_status : null,
    orderStatus: isOrderDocStatus(r.order_status) ? r.order_status : null,
  };
}

function validReason(phase: "inquiry" | "quote" | "order" | "job", to: string, reason: unknown, text: string | null): LostReason | string {
  if (!isLostReason(reason) || reason === "neuvedeno" || !lostReasonsFor(phase, to).includes(reason)) return "Vyber důvod.";
  if (reason === "jine" && !text) return "U důvodu „Jiný“ doplň poznámku.";
  return reason;
}

// ── Poptávka ────────────────────────────────────────────────
/** Převzít poptávku: řešitel = já, stav V řešení. Je-li řešitelem jiný, nejdřív vrátí needsConfirm. */
export async function takeInquiry(jobId: string, opts: { force?: boolean } = {}): Promise<FlowResult & { needsConfirm?: string }> {
  const c = await begin("workflow");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  try {
    const job = await loadJob(c.db, jobId, "id, status, inquiry_status, assignee_id");
    if (!job) return fail(NOT_FOUND);
    const from = job.inquiry_status;
    if (from !== "prijata" && from !== "v_reseni" && from !== "ceka_na_podklady") return fail("Tuto poptávku teď převzít nejde.");
    const prev = typeof job.assignee_id === "string" ? job.assignee_id : null;
    const prevName = prev && prev !== c.user.id ? await personName(c.db, prev) : null;
    if (prev && prev !== c.user.id && !opts.force) {
      return { ok: false, needsConfirm: `Převzít od ${prevName ?? "jiného řešitele"}?` };
    }
    const patch: Row = { assignee_id: c.user.id };
    if (from === "prijata") patch.inquiry_status = "v_reseni";
    if (prev === c.user.id && !patch.inquiry_status) return { ok: true, ...(await readBack(c.db, jobId)) };
    const q = c.db.from("orders").update(patch as never).eq("id", jobId).eq("inquiry_status", from as string);
    const { data, error } = await withChangeNote(q, prevName ? `převzato od ${prevName}` : null).select("id");
    if (error) return fail(error);
    if (!data?.length) return conflict(c.db, "orders", jobId, "inquiry_status_changed");
    if (prev !== c.user.id) {
      await logJobEvent(c.db, {
        jobId, type: "field", entity: "inquiry", actorId: c.user.id,
        message: prevName ? `Řešitel: ${prevName} → ${c.user.fullName} (převzato)` : `Řešitel: ${c.user.fullName} (převzato)`,
        data: { changes: [{ field: "assignee_id", label: "Řeší", from: prev, to: c.user.id }] },
      });
    }
    revalidateFlow(jobId);
    return { ok: true, ...(await readBack(c.db, jobId)) };
  } catch (err) {
    return fail(err);
  }
}

/** Ruční změna stavu poptávky (Čeká na podklady, Podklady máme, Odmítnout, Stáhnout, Obnovit). */
export async function setInquiryStatus(
  jobId: string, to: InquiryStatus, opts: { reason?: LostReason | null; note?: string | null } = {},
): Promise<FlowResult> {
  if (!isInquiryStatus(to)) return fail("Neznámý stav poptávky.");
  if (to === "zpracovana") return fail("Stav Zpracovaná se nastaví sám (nabídka odešla nebo přišla objednávka).");
  const c = await begin("workflow");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  try {
    return await applyInquiry(c, jobId, to, opts, null);
  } catch (err) {
    return fail(err);
  }
}

async function applyInquiry(
  c: Ctx, jobId: string, to: InquiryStatus, opts: { reason?: LostReason | null; note?: string | null }, proposedBy: string | null,
): Promise<FlowResult> {
  const job = await loadJob(c.db, jobId, "id, status, inquiry_status");
  if (!job) return fail(NOT_FOUND);
  const from = isInquiryStatus(job.inquiry_status) ? job.inquiry_status : null;
  if (!canTransition("inquiry", from, to)) {
    return fail(from ? `Z „${INQUIRY_STATES[from].label}“ nejde přejít na „${INQUIRY_STATES[to].label}“.` : "Zakázka nemá poptávku.");
  }
  if (!c.can(transitionFeature("inquiry", to, from))) return deny();
  const text = note(opts.note);
  const patch: Row = { inquiry_status: to };
  if (reasonRequired("inquiry", to)) {
    const r = validReason("inquiry", to, opts.reason, text);
    if (!isLostReason(r)) return fail(r);
    patch.lost_reason = r;
    patch.lost_note = text;
  }
  if (to === "ceka_na_podklady") {
    if (!text) return fail("Napiš, co chybí (výkres, model, množství, materiál…).");
    patch.waiting_note = text;
  }
  const headerNote = [proposedBy ? `na návrh: ${proposedBy}` : null, to === "ceka_na_podklady" || reasonRequired("inquiry", to) ? null : text]
    .filter(Boolean).join(" — ") || null;
  const q = c.db.from("orders").update(patch as never).eq("id", jobId).eq("inquiry_status", from as string);
  const { data, error } = await withChangeNote(q, headerNote).select("id");
  if (error) return fail(error);
  if (!data?.length) return conflict(c.db, "orders", jobId, "inquiry_status_changed");
  revalidateFlow(jobId);
  return { ok: true, ...(await readBack(c.db, jobId)) };
}

// ── Návrhy změn (zaměstnanec / AI navrhne, rozhodne člověk s právem) ──
export async function proposeFlowChange(
  jobId: string,
  proposal: { phase: FlowProposal["phase"]; to: string; quoteId?: string | null; reason?: LostReason | null; note?: string | null },
): Promise<ActionResult> {
  const c = await begin("workflow");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const phase = proposal?.phase;
  if (phase !== "inquiry" && phase !== "order" && phase !== "quote") return fail("Neznámý typ návrhu.");
  const to = String(proposal.to ?? "");
  const valid = phase === "inquiry" ? isInquiryStatus(to) && to !== "zpracovana"
    : phase === "order" ? isOrderDocStatus(to) : isQuoteState(to);
  if (!valid) return fail("Neznámý cílový stav návrhu.");
  if (phase === "quote" && !(proposal.quoteId && isUuid(proposal.quoteId))) return fail(QUOTE_NOT_FOUND);
  const text = note(proposal.note);
  let reason: LostReason | undefined;
  if (reasonRequired(phase, to)) {
    const r = validReason(phase, to, proposal.reason, text);
    if (!isLostReason(r)) return fail(r);
    reason = r;
  }
  try {
    const job = await loadJob(c.db, jobId, "id, flow_proposal, flow_proposal_by");
    if (!job) return fail(NOT_FOUND);
    if (phase === "quote" && !(await quoteOfJob(c.db, proposal.quoteId as string, jobId))) return fail(QUOTE_NOT_FOUND);
    const existing = job.flow_proposal as FlowProposal | null;
    if (existing && job.flow_proposal_by !== c.user.id) {
      const who = (await personName(c.db, job.flow_proposal_by)) ?? (existing.kind === "ai" ? "AI" : "jiný uživatel");
      return fail(`Na zakázce už čeká návrh (${who}: ${existing.label}) — nejdřív ho rozhodněte.`);
    }
    const target = phase === "inquiry" ? INQUIRY_STATES[to as InquiryStatus].label
      : phase === "order" ? ORDER_STATES[to as OrderDocStatus].label : QUOTE_STATES[to as QuoteState].label;
    const verb = to === "odmitnuta" ? "Odmítnout poptávku" : to === "stazena" ? "Poptávka stažena zákazníkem"
      : to === "zamitnuta" ? "Zamítnout nabídku" : to === "stornovana" ? "Stornovat objednávku" : `Změnit na ${target}`;
    const value: FlowProposal = {
      phase, to, kind: "user", by: c.user.id,
      label: reason ? `${verb} — ${lostReasonLabel(reason)}` : verb,
      ...(proposal.quoteId ? { quoteId: proposal.quoteId } : {}),
      ...(reason ? { reason } : {}),
      ...(text ? { note: text } : {}),
    };
    let q = c.db.from("orders").update({ flow_proposal: value } as never).eq("id", jobId);
    q = existing ? q.eq("flow_proposal_by", c.user.id) : q.is("flow_proposal", null);
    const { data, error } = await q.select("id");
    if (error) return fail(error);
    if (!data?.length) return fail("Návrh mezitím změnil někdo jiný — obnov stránku.");
    revalidateFlow(jobId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Přijmout (provede akci s poznámkou „na návrh: X“) nebo zamítnout návrh. */
export async function decideFlowProposal(jobId: string, accept: boolean): Promise<FlowResult> {
  const c = await begin("workflow");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  try {
    const job = await loadJob(c.db, jobId, "id, flow_proposal, flow_proposal_by, flow_proposal_at");
    if (!job) return fail(NOT_FOUND);
    const p = job.flow_proposal as FlowProposal | null;
    if (!p) return fail("Na zakázce žádný návrh nečeká.");
    if (!c.can(transitionFeature(p.phase, p.to))) return deny();
    if (accept) {
      const by = (await personName(c.db, job.flow_proposal_by)) ?? (p.kind === "ai" ? "✨ AI" : "neznámý účet");
      const opts = { reason: p.reason ?? null, note: p.note ?? null };
      let res: FlowResult;
      if (p.phase === "inquiry" && isInquiryStatus(p.to)) res = await applyInquiry(c, jobId, p.to, opts, by);
      else if (p.phase === "order" && isOrderDocStatus(p.to)) res = await applyOrder(c, jobId, p.to, opts, by);
      else if (p.phase === "quote" && isQuoteState(p.to) && p.quoteId && isUuid(p.quoteId) && (await quoteOfJob(c.db, p.quoteId, jobId))) {
        res = await applyQuote(c, p.quoteId, p.to, opts, by);
      }
      else return fail("Návrh nejde provést.");
      if (!res.ok) return res;
    }
    const { error } = await c.db.from("orders").update({ flow_proposal: null } as never).eq("id", jobId)
      .eq("flow_proposal_at", job.flow_proposal_at as string);
    if (error) return fail(error);
    revalidateFlow(jobId);
    return { ok: true, ...(await readBack(c.db, jobId)) };
  } catch (err) {
    return fail(err);
  }
}

// ── Nabídka ─────────────────────────────────────────────────
/** Nabídka patří k zakázce? (návrh nesmí ukazovat na nabídku cizí zakázky) */
async function quoteOfJob(db: JobsDb, quoteId: string, jobId: string): Promise<boolean> {
  const { data } = await db.from("quotes").select("id").eq("id", quoteId).eq("job_id", jobId).maybeSingle();
  return Boolean(data);
}

async function loadQuote(db: JobsDb, quoteId: string): Promise<Row | null> {
  const { data, error } = await db.from("quotes").select(`${FLOW_QUOTE_COLUMNS}, feedback`).eq("id", quoteId).maybeSingle();
  if (error) console.error(`[flow] Načtení nabídky selhalo: ${error.message}`);
  return (data as Row | null) ?? null;
}

async function quoteResult(db: JobsDb, quoteId: string, jobId: string | null): Promise<FlowResult> {
  const q = await loadQuote(db, quoteId);
  const job = jobId ? await readBack(db, jobId) : null;
  return { ok: true, ...(job ?? {}), ...(q && isQuoteState(q.state) ? { quoteState: q.state } : {}) };
}

type QuoteStateOpts = {
  reason?: LostReason | null; note?: string | null; competitorPrice?: number | null; feedback?: string | null; closeJob?: boolean;
  /** Schválení ze seznamu: projde jen nezměněná nabídka (quotes.updated_at). */
  expectedUpdatedAt?: string | null;
};

const QUOTE_REQUEST_RETIRED = "Nabídky ostatních schvaluje super admin automaticky — předávat je není potřeba.";
const QUOTE_UNAPPROVE_PENDING = "Neschválenou nabídku nejde vrátit mezi rozpracované — zůstává neschválená, dokud ji super admin neschválí.";

/** Ruční změna stavu nabídky (tabulka 5.8; #25 schvaluje jen super admin, odeslání hlídá quoteSendBlock). */
export async function setQuoteState(quoteId: string, to: QuoteState, opts: QuoteStateOpts = {}): Promise<FlowResult> {
  if (!isQuoteState(to)) return fail("Neznámý stav nabídky.");
  const c = await begin("workflow");
  if ("error" in c) return fail(c.error);
  if (!isUuid(quoteId)) return fail(QUOTE_NOT_FOUND);
  try {
    return await applyQuote(c, quoteId, to, opts, null);
  } catch (err) {
    return fail(err);
  }
}

async function applyQuote(
  c: Ctx, quoteId: string, to: QuoteState, opts: QuoteStateOpts, proposedBy: string | null,
): Promise<FlowResult> {
  const row = await loadQuote(c.db, quoteId);
  if (!row) return fail(QUOTE_NOT_FOUND);
  const quote = quoteFactsFromRow(row);
  const jobId = typeof row.job_id === "string" ? row.job_id : null;
  const from = quote.state;
  // #25: „Předat ke schválení“ zaniklo; neschválenou nabídku nejde „odschválit“
  if (to === "ke_schvaleni") return fail(QUOTE_REQUEST_RETIRED);
  if (to === "rozpracovana" && from === "ke_schvaleni") return fail(QUOTE_UNAPPROVE_PENDING);
  if (to === "schvalena" && !c.can("quote_approval")) return fail(QUOTE_ADMIN_ONLY);
  if (!canTransition("quote", from, to)) {
    if (to === "prijata" && from === "prijata") return quoteResult(c.db, quoteId, jobId);
    return fail(`Z „${QUOTE_STATES[from].label}“ nejde přejít na „${QUOTE_STATES[to].label}“.`);
  }
  if (!c.can(transitionFeature("quote", to, from))) return deny();
  if (to === "odeslana" && (from === "rozpracovana" || from === "schvalena")) {
    // #25: neschválenou nikdo; schválenou nabídku ne-admina i její autor, obchodník nebo řešitel zakázky
    const job = jobId ? await loadJob(c.db, jobId, "owner_id, assignee_id") : null;
    const block = quoteSendBlock(quote, {
      can: c.can, userId: c.user.id, isSuperAdmin: c.user.role === "super_admin",
      jobOwnerId: typeof job?.owner_id === "string" ? job.owner_id : null,
      jobAssigneeId: typeof job?.assignee_id === "string" ? job.assignee_id : null,
    });
    if (block) return fail(block);
  }
  const text = note(opts.note);
  const label = quoteLabel(quote);
  // v historii stejně jako ostatní události nabídek („Nabídka NAB-… schválena")
  const evLabel = quote.number?.trim() ? `Nabídka ${label}` : "Nabídka";
  const headerNote = [proposedBy ? `na návrh: ${proposedBy}` : null, text].filter(Boolean).join(" — ") || null;
  const now = new Date().toISOString();
  // poznámka se do zprávy připojí jen jednou (u zamítnutí ji zpráva už nese za důvodem)
  const withNote = (message: string) => {
    const extra = [proposedBy ? `na návrh: ${proposedBy}` : null, text && !message.includes(text) ? text : null].filter(Boolean).join(" — ");
    return extra ? `${message} — ${extra}` : message;
  };
  const log = (message: string, action: string, extra: Row = {}) => jobId
    ? logJobEvent(c.db, {
      jobId, type: "quote", entity: "quote", entityId: quoteId, actorId: c.user.id,
      message: withNote(message),
      data: { quoteId, number: quote.number, action, ...extra },
    })
    : Promise.resolve();

  const update = async (patch: Row) => {
    const q = c.db.from("quotes").update(patch as never).eq("id", quoteId).eq("state", from);
    const { data, error } = await withChangeNote(q, headerNote).select("id");
    if (error) return fail(error);
    if (!data?.length) return conflict(c.db, "quotes", quoteId, "state_changed");
    return null;
  };

  if (to === "schvalena") {
    // jediné jádro schválení (super admin, položky s cenou, otisk; čas schválení doplní DB)
    const res = await approveQuoteCore(c.db, c.user, quoteId, {
      expectedUpdatedAt: opts.expectedUpdatedAt ?? null, note: [proposedBy ? `na návrh: ${proposedBy}` : null, text].filter(Boolean).join(" — ") || null,
    });
    if (!res.ok) return fail(res.error ?? "Nabídku se nepodařilo schválit.");
  } else if (to === "rozpracovana") {
    const err = await update({ approved_by: null, approval_requested_at: null });
    if (err) return err;
    await log(`${evLabel}: vrácena k úpravě`, "unapproved");
  } else if (to === "pripominky") {
    const fb = cleanText(opts.feedback ?? opts.note, 2000);
    if (!fb) return fail("Napiš, co zákazník připomínkuje.");
    const err = await update({ feedback: fb });
    if (err) return err;
    await log(`${evLabel}: připomínky zákazníka — ${fb}`, "feedback");
  } else if (to === "odeslana") {
    if (from === "pripominky") {
      const err = await update({ feedback: null });
      if (err) return err;
      await log(`${evLabel}: odpověď bez změny nabídky`, "answered");
    } else if (from === "zamitnuta") {
      const err = await update({ status: "odeslano" });
      if (err) return err;
      if (jobId) {
        await withChangeNote(c.db.from("orders").update({ status: "nabidka" } as never).eq("id", jobId).eq("status", "nerealizovano"),
          `zákazník se vrátil k nabídce ${label}`);
      }
      await log(`${evLabel}: zákazník se vrátil`, "reopened");
    } else {
      const err = await update({ status: "odeslano", sent_at: now, sent_via: "rucne" });
      if (err) return err;
      await log(`${evLabel} odeslána zákazníkovi (jinak než e-mailem)`, "sent", { via: "rucne" });
    }
  } else if (to === "prijata") {
    const err = await update({ status: "prijato" });
    if (err) return err;
    if (jobId) {
      const jobPatch: Row = { quote_id: quoteId };
      if (quote.total !== null && quote.total !== undefined) jobPatch.value = quote.total;
      await c.db.from("orders").update(jobPatch as never).eq("id", jobId);
    }
    await log(`${evLabel} přijata zákazníkem`, "accepted");
  } else if (to === "zamitnuta") {
    const r = validReason("quote", to, opts.reason, text);
    if (!isLostReason(r)) return fail(r);
    let closeJob = opts.closeJob;
    if (closeJob === undefined && jobId) {
      const { data: others } = await c.db.from("quotes").select("id").eq("job_id", jobId).neq("id", quoteId)
        .eq("archived", false).in("status", ["navrh_ai", "ke_schvaleni", "odeslano"]);
      closeJob = !(others ?? []).length;
    }
    const competitor = c.can("margins") && typeof opts.competitorPrice === "number" && Number.isFinite(opts.competitorPrice)
      && opts.competitorPrice >= 0 ? Math.round(opts.competitorPrice * 100) / 100 : null;
    const rpc = c.db.rpc("flow_reject_quote", {
      p_quote: quoteId, p_reason: r, p_note: text, p_competitor_price: competitor, p_close_job: Boolean(closeJob),
    });
    const { error } = await withChangeNote(rpc, headerNote);
    if (error) return fail(error);
    await log(`${evLabel} zamítnuta — ${lostReasonLabel(r)}${text ? `: ${text}` : ""}`, "rejected", { reason: r });
  } else {
    return fail("Tento stav se nastaví sám.");
  }
  revalidateFlow(jobId);
  return quoteResult(c.db, quoteId, jobId);
}

/**
 * „Schválit a odeslat“ jedním klikem (jen super admin): schválí a buď PDF nabídky vystaví NA SERVERU
 * (nikdy soubor od klienta) a odešle e-mailem, nebo zapíše „odesláno jinak“.
 */
export async function approveAndSendQuote(
  quoteId: string,
  email?: { to: string; cc?: string; subject: string; body: string } | null,
  /** Ze seznamu / karty: schválí jen nezměněnou nabídku (quotes.updated_at, §15.11). */
  opts: { expectedUpdatedAt?: string | null } = {},
): Promise<FlowResult> {
  const c = await begin("quote_approval");
  if ("error" in c) return fail(c.error);
  if (!isUuid(quoteId)) return fail(QUOTE_NOT_FOUND);
  try {
    const row = await loadQuote(c.db, quoteId);
    if (!row) return fail(QUOTE_NOT_FOUND);
    const quote = quoteFactsFromRow(row);
    const jobId = typeof row.job_id === "string" ? row.job_id : null;
    if (quote.state !== "schvalena" && quote.state !== "rozpracovana") {
      const approved = await applyQuote(c, quoteId, "schvalena", { expectedUpdatedAt: opts.expectedUpdatedAt ?? null }, null);
      if (!approved.ok) return approved;
    }
    if (email && jobId) {
      const { generateJobDocument, sendJobDocument } = await import("@/app/actions/job-documents");
      const doc = await generateJobDocument(jobId, "nabidka", { quoteId, reuse: true });
      if (!doc.ok || !doc.fileId) return fail(doc.error ?? "PDF nabídky se nepodařilo vystavit.");
      const sent = await sendJobDocument(jobId, doc.fileId, { to: email.to, cc: email.cc, subject: email.subject, body: email.body });
      if (!sent.ok) return fail(sent.error ?? "Odeslání e-mailem selhalo.");
      return quoteResult(c.db, quoteId, jobId);
    }
    return await applyQuote(c, quoteId, "odeslana", {}, null);
  } catch (err) {
    return fail(err);
  }
}

/** Super admin vrátí neschválenou nabídku autorovi k přepracování (důvod povinný; nabídka zůstává neschválená). */
export async function returnQuoteToAuthor(quoteId: string, reason: string): Promise<FlowResult> {
  const c = await begin("quote_approval");
  if ("error" in c) return fail(c.error);
  if (!isUuid(quoteId)) return fail(QUOTE_NOT_FOUND);
  const text = cleanText(reason, 1000);
  if (!text || text.length < 3) return fail("Napiš, co má autor upravit.");
  try {
    const row = await loadQuote(c.db, quoteId);
    if (!row) return fail(QUOTE_NOT_FOUND);
    const quote = quoteFactsFromRow(row);
    const jobId = typeof row.job_id === "string" ? row.job_id : null;
    if (quote.state !== "ke_schvaleni" || quote.archived) return fail("Vrátit k přepracování jde jen neschválenou nabídku.");
    if (quote.returnedAt) return fail("Nabídka už je vrácená autorovi — čeká na jeho úpravu.");
    const q = c.db.from("quotes").update({ approval_returned_at: new Date().toISOString(), approval_return_note: text } as never)
      .eq("id", quoteId).eq("state", "ke_schvaleni").is("approval_returned_at", null);
    const { data, error } = await withChangeNote(q, `vráceno k přepracování: ${text}`).select("id");
    if (error) return fail(error);
    if (!data?.length) return conflict(c.db, "quotes", quoteId, "state_changed");
    if (jobId) {
      const label = quote.number?.trim() ? `Nabídka ${quoteLabel(quote)}` : "Nabídka";
      await logJobEvent(c.db, {
        jobId, type: "quote", entity: "quote", entityId: quoteId, actorId: c.user.id,
        message: `${label} vrácena autorovi k přepracování — ${text}`,
        data: { quoteId, number: quote.number, action: "returned", note: text },
      });
    }
    revalidateFlow(jobId);
    return quoteResult(c.db, quoteId, jobId);
  } catch (err) {
    return fail(err);
  }
}

// ── Objednávka zákazníka ────────────────────────────────────
const MISMATCH_KINDS: OrderMismatchKind[] = ["cena", "mnozstvi", "revize_vykresu", "termin", "chybi_polozka", "polozka_navic", "platebni_podminky", "jine"];

function cleanMismatch(m: unknown): OrderMismatch["items"] | null {
  const items = (m && typeof m === "object" && Array.isArray((m as { items?: unknown }).items) ? (m as { items: unknown[] }).items : []) as Row[];
  const out = items.slice(0, 50).map((i) => ({
    kind: (MISMATCH_KINDS as string[]).includes(String(i.kind)) ? (i.kind as OrderMismatchKind) : "jine",
    label: cleanText(i.label, 200) ?? "Rozdíl",
    quote: cleanText(i.quote, 200),
    order: cleanText(i.order, 200),
  }));
  return out.length ? out : null;
}

/**
 * Ruční stav objednávky: rozpor, Potvrzeno jinak / Přijmout, jak je, storno, obnovení.
 * confirmationSent: false = potvrzeno, ale potvrzení zákazníkovi zatím neodešlo (jinak „předáno jinak").
 */
export async function setOrderStatus(
  jobId: string, to: OrderDocStatus,
  opts: { reason?: LostReason | null; note?: string | null; mismatch?: Pick<OrderMismatch, "items"> | null; confirmationSent?: boolean } = {},
): Promise<FlowResult> {
  if (!isOrderDocStatus(to)) return fail("Neznámý stav objednávky.");
  const c = await begin("workflow");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  try {
    return await applyOrder(c, jobId, to, opts, null);
  } catch (err) {
    return fail(err);
  }
}

async function applyOrder(
  c: Ctx, jobId: string, to: OrderDocStatus,
  opts: { reason?: LostReason | null; note?: string | null; mismatch?: Pick<OrderMismatch, "items"> | null; confirmationSent?: boolean },
  proposedBy: string | null,
): Promise<FlowResult> {
  const job = await loadJob(c.db, jobId, "id, status, order_status, order_revision, order_mismatch");
  if (!job) return fail(NOT_FOUND);
  const from = isOrderDocStatus(job.order_status) ? job.order_status : null;
  if (!canTransition("order", from, to)) {
    return fail(from ? `Z „${ORDER_STATES[from].label}“ nejde přejít na „${ORDER_STATES[to].label}“.` : "Zakázka zatím nemá objednávku.");
  }
  if (to === "aktualizovana") return fail("Změnu objednávky zapiš akcí „Zákazník změnil objednávku“.");
  if (from === "aktualizovana" && to === "potvrzena") return fail("Rozhodni o změně: „Potvrdit změnu“ nebo „Změnu nepřijímáme“.");
  if (!c.can(transitionFeature("order", to, from))) return deny();
  const text = note(opts.note);
  const now = new Date().toISOString();
  const patch: Row = { order_status: to };
  const prevMismatch = (job.order_mismatch as OrderMismatch | null) ?? null;
  if (to === "stornovana") {
    const r = validReason("order", to, opts.reason, text);
    if (!isLostReason(r)) return fail(r);
    patch.lost_reason = r;
    patch.lost_note = text;
  } else if (to === "rozpor") {
    const items = cleanMismatch(opts.mismatch);
    if (!items) return fail("Vyjmenuj, v čem se objednávka liší od nabídky.");
    patch.order_mismatch = { items, source: "rucne", detected_at: now, fix_requested_at: null, resolved: null } satisfies OrderMismatch;
  } else if (to === "potvrzena" && (from === "dorucena" || from === "rozpor")) {
    if (opts.confirmationSent !== false) {
      patch.confirmation_sent_at = now;
      patch.confirmation_sent_via = "rucne";
      patch.confirmation_sent_revision = Number(job.order_revision) || 1;
    }
    if (prevMismatch) patch.order_mismatch = { ...prevMismatch, resolved: { decision: "prijato_jak_je", at: now, by: c.user.id } };
  } else if (to === "dorucena" && from === "rozpor" && prevMismatch) {
    patch.order_mismatch = { ...prevMismatch, resolved: { decision: "opraveno", at: now, by: c.user.id } };
  }
  const headerNote = [proposedBy ? `na návrh: ${proposedBy}` : null, to === "stornovana" ? null : text].filter(Boolean).join(" — ") || null;
  const q = c.db.from("orders").update(patch as never).eq("id", jobId).eq("order_status", from as string);
  const { data, error } = await withChangeNote(q, headerNote).select("id");
  if (error) return fail(error);
  if (!data?.length) return conflict(c.db, "orders", jobId, "order_status_changed");
  revalidateFlow(jobId);
  return { ok: true, ...(await readBack(c.db, jobId)) };
}

/** Požádat zákazníka o opravu objednávky v rozporu (chip pak čeká „N dní“). */
export async function requestOrderFix(jobId: string, opts: { note?: string | null } = {}): Promise<FlowResult> {
  const c = await begin("workflow");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  try {
    const job = await loadJob(c.db, jobId, "id, order_status, order_mismatch");
    if (!job) return fail(NOT_FOUND);
    if (job.order_status !== "rozpor") return fail("Objednávka není v rozporu s nabídkou.");
    const prev = (job.order_mismatch as OrderMismatch | null) ?? { items: [], source: "rucne", detected_at: new Date().toISOString() };
    const q = c.db.from("orders").update({ order_mismatch: { ...prev, fix_requested_at: new Date().toISOString() } } as never)
      .eq("id", jobId).eq("order_status", "rozpor");
    const { data, error } = await withChangeNote(q, note(opts.note)).select("id");
    if (error) return fail(error);
    if (!data?.length) return conflict(c.db, "orders", jobId, "order_status_changed");
    revalidateFlow(jobId);
    return { ok: true, ...(await readBack(c.db, jobId)) };
  } catch (err) {
    return fail(err);
  }
}

/** „Zákazník změnil objednávku“ — nová revize (atomicky RPC); potvrzená → Aktualizovaná. */
export async function registerOrderChange(
  jobId: string,
  input: { note?: string | null; fileId?: string | null; changes?: { field: string; label: string; from: unknown; to: unknown }[] | null; customerOrderNumber?: string | null },
): Promise<FlowResult & { revision?: number }> {
  const c = await begin("workflow");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const text = cleanText(input?.note, 2000);
  const changes = Array.isArray(input?.changes)
    ? input.changes.slice(0, 100).map((ch) => ({ field: cleanText(ch.field, 80) ?? "jine", label: cleanText(ch.label, 200) ?? "Změna", from: ch.from ?? null, to: ch.to ?? null }))
    : null;
  if (!text && !changes?.length) return fail("Popiš, co zákazník změnil.");
  if (input?.fileId && !isUuid(input.fileId)) return fail("Dokument nenalezen.");
  try {
    const rpc = c.db.rpc("flow_register_order_change", {
      p_job: jobId, p_note: text, p_file: input?.fileId ?? null, p_changes: changes?.length ? changes : null,
      p_customer_order_number: cleanText(input?.customerOrderNumber, 120),
    });
    const { data, error } = await withChangeNote(rpc, text);
    if (error) return fail(error);
    revalidateFlow(jobId);
    return { ok: true, revision: Number(data) || undefined, ...(await readBack(c.db, jobId)) };
  } catch (err) {
    return fail(err);
  }
}

/** Potvrdit změnu (accept) / Změnu nepřijímáme — RPC flow_decide_order_change. */
export async function decideOrderChange(jobId: string, accept: boolean, opts: { note?: string | null } = {}): Promise<FlowResult> {
  const c = await begin("workflow");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const text = note(opts.note);
  if (!accept && !text) return fail("Napiš, proč změnu nepřijímáme (zákazník to uvidí v potvrzení).");
  try {
    const rpc = c.db.rpc("flow_decide_order_change", { p_job: jobId, p_accept: Boolean(accept), p_note: text });
    const { error } = await withChangeNote(rpc, text);
    if (error) return fail(error);
    revalidateFlow(jobId);
    return { ok: true, ...(await readBack(c.db, jobId)) };
  } catch (err) {
    return fail(err);
  }
}

// ── Korekce hlavního stavu (s náhledem dopadu) ──────────────
export async function moveJobStage(
  jobId: string, stage: JobStage, opts: { reason?: LostReason | null; note?: string | null } = {},
): Promise<FlowResult & { effect?: StageEffect }> {
  if (!isJobStage(stage)) return fail("Neznámý stav zakázky.");
  const c = await begin("orders");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (!c.can(transitionFeature("job", stage))) return deny();
  const text = note(opts.note);
  try {
    const [job, quotes] = await Promise.all([
      loadJob(c.db, jobId, FLOW_ORDER_COLUMNS),
      c.db.from("quotes").select(FLOW_QUOTE_COLUMNS).eq("job_id", jobId),
    ]);
    if (!job || !isJobStage(job.status)) return fail(NOT_FOUND);
    const from = job.status;
    if (from === stage) return { ok: true, ...(await readBack(c.db, jobId)) };
    const facts = flowFactsFromRow(job);
    const effect = stageEffect(facts, ((quotes.data ?? []) as Row[]).map(quoteFactsFromRow), { kind: "stage", to: stage });
    const patch: Row = { status: stage };
    if (reasonRequired("job", stage)) {
      const r = validReason("job", stage, opts.reason, text);
      if (!isLostReason(r)) return fail(r);
      patch.lost_reason = r;
      patch.lost_note = text;
    }
    const q = c.db.from("orders").update(patch as never).eq("id", jobId).eq("status", from);
    const { data, error } = await withChangeNote(q, reasonRequired("job", stage) ? null : text).select("id");
    if (error) return fail(error);
    if (!data?.length) return conflict(c.db, "orders", jobId, "stage_changed");
    revalidateFlow(jobId);
    return { ok: true, effect, ...(await readBack(c.db, jobId)) };
  } catch (err) {
    return fail(err);
  }
}

// ── Dodání zákazníkovi po položkách ─────────────────────────
interface ItemRow { id: string; name: string | null; drawing_number: string | null; description: string | null; quantity: number; unit: string | null; delivered_quantity: number; delivery_closed: boolean }

function itemName(i: ItemRow): string {
  return (i.name ?? "").trim() || (i.drawing_number ?? "").trim() || (i.description ?? "").trim() || "Položka";
}

function qty(n: number): string {
  return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 3 }).format(n);
}

async function deliverySummary(db: JobsDb, jobId: string): Promise<string> {
  const j = await loadJob(db, jobId, "items_count, items_delivered");
  const total = Number(j?.items_count) || 0;
  return total ? `${Number(j?.items_delivered) || 0} z ${total} položek` : "";
}

/** Zapsat dodané množství po položkách (0 ≤ dodáno ≤ 1,5 × objednáno). Při 100 % posune DB stav sama. */
export async function setDeliveredQuantities(
  jobId: string, rows: { itemId: string; delivered: number }[], opts: { note?: string | null; fileId?: string | null } = {},
): Promise<FlowResult> {
  const c = await begin("workflow");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (!Array.isArray(rows) || !rows.length) return fail("Vyber aspoň jednu položku.");
  if (opts.fileId && !isUuid(opts.fileId)) return fail("Dokument nenalezen.");
  try {
    const { data, error } = await c.db.from("order_items")
      .select("id, name, drawing_number, description, quantity, unit, delivered_quantity, delivery_closed").eq("order_id", jobId);
    if (error) return fail(error);
    const items = new Map(((data ?? []) as ItemRow[]).map((i) => [i.id, i]));
    const changes: { item: ItemRow; to: number }[] = [];
    for (const r of rows) {
      const item = r && isUuid(r.itemId) ? items.get(r.itemId) : undefined;
      if (!item) return fail("Položka nepatří k této zakázce.");
      const to = Number(r.delivered);
      if (!Number.isFinite(to) || to < 0) return fail(`${itemName(item)}: neplatné množství.`);
      const max = Number(item.quantity) * 1.5;
      if (Number(item.quantity) > 0 && to > max) return fail(`${itemName(item)}: ${qty(to)} je víc než 1,5× objednaného množství — nadodání?`);
      if (to !== Number(item.delivered_quantity)) changes.push({ item, to: Math.round(to * 1000) / 1000 });
    }
    if (!changes.length) return { ok: true, ...(await readBack(c.db, jobId)) };
    for (const ch of changes) {
      const { error: upErr } = await c.db.from("order_items").update({ delivered_quantity: ch.to } as never)
        .eq("id", ch.item.id).eq("order_id", jobId);
      if (upErr) return fail(upErr);
    }
    const summary = await deliverySummary(c.db, jobId);
    const text = note(opts.note);
    await logJobEvent(c.db, {
      jobId, type: "field", entity: "delivery", actorId: c.user.id,
      message: `Dodáno: ${changes.map((ch) => `${itemName(ch.item)} ${qty(ch.to)}/${qty(Number(ch.item.quantity))} ${ch.item.unit ?? "ks"}`).join(", ")}`
        + (summary ? ` · ${summary}` : "") + (text ? ` — ${text}` : ""),
      data: {
        production: "delivery", ...(opts.fileId ? { fileId: opts.fileId } : {}),
        items: changes.map((ch) => ({ itemId: ch.item.id, from: Number(ch.item.delivered_quantity), to: ch.to })),
      },
    });
    revalidateFlow(jobId);
    return { ok: true, ...(await readBack(c.db, jobId)) };
  } catch (err) {
    return fail(err);
  }
}

/** Uzavřít položku s menším množstvím (zmetky, zákazník přijal méně) — důvod povinný. */
export async function closeItemDelivery(jobId: string, itemId: string, opts: { reason: string }): Promise<FlowResult> {
  const c = await begin("workflow");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  if (!isUuid(itemId)) return fail("Položka nenalezena.");
  const reason = note(opts?.reason);
  if (!reason) return fail("Napiš, proč se položka uzavírá s menším množstvím.");
  try {
    const { data, error } = await c.db.from("order_items")
      .update({ delivery_closed: true, delivery_closed_reason: reason } as never)
      .eq("id", itemId).eq("order_id", jobId).eq("delivery_closed", false)
      .select("id, name, drawing_number, description, quantity, unit, delivered_quantity, delivery_closed");
    if (error) return fail(error);
    const item = ((data ?? []) as ItemRow[])[0];
    if (!item) return fail("Položka je už uzavřená nebo nepatří k zakázce.");
    const summary = await deliverySummary(c.db, jobId);
    await logJobEvent(c.db, {
      jobId, type: "field", entity: "delivery", actorId: c.user.id,
      message: `Uzavřeno s menším množstvím: ${itemName(item)} ${qty(Number(item.delivered_quantity))}/${qty(Number(item.quantity))} ${item.unit ?? "ks"} — ${reason}`
        + (summary ? ` · ${summary}` : ""),
      data: { production: "delivery_closed", itemId },
    });
    revalidateFlow(jobId);
    return { ok: true, ...(await readBack(c.db, jobId)) };
  } catch (err) {
    return fail(err);
  }
}

/** Částečná dodávka zakázky bez položek (poznámka co odešlo). */
export async function recordPartialDelivery(jobId: string, opts: { note: string }): Promise<FlowResult> {
  const c = await begin("workflow");
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const text = note(opts?.note);
  if (!text) return fail("Napiš, co se dodalo.");
  try {
    const job = await loadJob(c.db, jobId, "id, items_count");
    if (!job) return fail(NOT_FOUND);
    if (Number(job.items_count) > 0) return fail("Zakázka má položky — zapiš dodané množství u položek.");
    const { error } = await c.db.from("orders")
      .update({ partial_delivery_note: text, partial_delivery_at: new Date().toISOString() } as never).eq("id", jobId);
    if (error) return fail(error);
    await logJobEvent(c.db, {
      jobId, type: "field", entity: "delivery", actorId: c.user.id,
      message: `Částečná dodávka: ${text}`, data: { production: "partial_delivery" },
    });
    revalidateFlow(jobId);
    return { ok: true, ...(await readBack(c.db, jobId)) };
  } catch (err) {
    return fail(err);
  }
}

// ── Úhrady ──────────────────────────────────────────────────
function czDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}. ${m}.${y !== Number(todayIso().slice(0, 4)) ? ` ${y}` : ""}`;
}

/**
 * Zadat úhradu (bez DPH). Částku smí jen role s právem na marže — bez ní jde o „celou / zbývající
 * částku" a úhrada zakázku vyrovná. Historie částky nikdy neobsahuje.
 */
export async function recordJobPayment(
  jobId: string, opts: { date?: string | null; amount?: number | null; settles?: boolean; note?: string | null } = {},
): Promise<FlowResult & { paymentState?: PaymentState | null }> {
  const c = await begin("margins"); // úhrady = finance (obchodník, admin; RLS job_payments stejně)
  if ("error" in c) return fail(c.error);
  if (!isUuid(jobId)) return fail(NOT_FOUND);
  const date = opts.date ? cleanDate(opts.date) : todayIso();
  if (!date) return fail("Neplatné datum úhrady (čekám RRRR-MM-DD).");
  let amount: number | null = null;
  if (c.can("margins") && opts.amount !== undefined && opts.amount !== null) {
    const n = Number(opts.amount);
    if (!Number.isFinite(n) || n < 0) return fail("Neplatná částka úhrady.");
    amount = Math.round(n * 100) / 100;
  }
  const settles = amount === null ? true : Boolean(opts.settles);
  try {
    const job = await loadJob(c.db, jobId, "id, status");
    if (!job) return fail(NOT_FOUND);
    if (job.status === "nerealizovano" || job.status === "zruseno") return fail("Zakázka je uzavřená — úhradu nejde zadat.");
    const { error } = await c.db.from("job_payments").insert({
      job_id: jobId, paid_on: date, amount, settles, note: note(opts.note),
    } as never);
    if (error) return fail(error);
    await logJobEvent(c.db, {
      jobId, type: "field", entity: "payment", actorId: c.user.id,
      message: `Zadána úhrada (${settles ? "vyrovnání" : "částečná"}) ${czDate(date)}`,
      data: { production: "payment", paidOn: date, settles },
    });
    revalidateFlow(jobId);
    const after = await loadJob(c.db, jobId, FLOW_ORDER_COLUMNS);
    const back = await readBack(c.db, jobId);
    return { ok: true, ...(back ?? {}), paymentState: after ? paymentKey(flowFactsFromRow(after)) : null };
  } catch (err) {
    return fail(err);
  }
}

/** Odebrat úhradu (jen s právem na marže); smazání audituje DB. */
export async function deleteJobPayment(paymentId: string): Promise<FlowResult & { paymentState?: PaymentState | null }> {
  const c = await begin("margins");
  if ("error" in c) return fail(c.error);
  if (!isUuid(paymentId)) return fail("Úhrada nenalezena.");
  try {
    const { data, error } = await c.db.from("job_payments").delete().eq("id", paymentId).select("job_id, paid_on, settles");
    if (error) return fail(error);
    const row = ((data ?? []) as { job_id: string; paid_on: string; settles: boolean }[])[0];
    if (!row) return fail("Úhrada nenalezena.");
    await logJobEvent(c.db, {
      jobId: row.job_id, type: "field", entity: "payment", actorId: c.user.id,
      message: `Úhrada odebrána (${row.settles ? "vyrovnání" : "částečná"}) ${czDate(row.paid_on)}`,
      data: { production: "payment_deleted", paidOn: row.paid_on },
    });
    revalidateFlow(row.job_id);
    const after = await loadJob(c.db, row.job_id, FLOW_ORDER_COLUMNS);
    return { ok: true, ...((await readBack(c.db, row.job_id)) ?? {}), paymentState: after ? paymentKey(flowFactsFromRow(after)) : null };
  } catch (err) {
    return fail(err);
  }
}
