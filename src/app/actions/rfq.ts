"use server";

import { revalidatePath } from "next/cache";
import { checkFeature } from "@/lib/auth/session";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { logAudit } from "@/lib/audit";
import { invalidateSettingsCache } from "@/lib/settings";
import type { JobsDb } from "@/lib/jobs/events";
import type { CurrentUser } from "@/lib/data/current-user";
import {
  createAndSendRound, declineRecipient, loadJobRfq, loadRfqSetup, previewRfq, remindRecipient, replyText, retryRecipient,
  saveRecipientOffer, selectWinner, sendRecipientWithoutPending, thankOthers,
  type JobRfqData, type RfqActor, type RfqInput, type RfqOfferInput, type RfqPreview, type RfqSendResult, type RfqSetup,
} from "@/lib/rfq/store";
import { RFQ_WEIGHTS_SETTING, normalizeWeights, parseSupplierReply, type ReplyPrefill, type RfqWeights } from "@/lib/rfq/model";

/**
 * Poptávky dodavatelům (poptávkové kolo) — akce. Právo „rfq": obchodník, super admin, zaměstnanec se „Smí poptávat
 * dodavatele" (Šponer). Čte a zapisuje servisní klient s autorem (app_actor) — práva hlídá checkFeature.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

interface Ctx { db: JobsDb; user: CurrentUser; actor: RfqActor }

async function begin(): Promise<Ctx | { error: string }> {
  if (!isSupabaseConfigured()) return { error: "Supabase není nakonfigurováno." };
  const access = await checkFeature("rfq");
  if ("error" in access) return { error: access.error };
  const db = await createOperatorClient({ actor: userActor(access.user) });
  return { db, user: access.user, actor: { id: access.user.id, fullName: access.user.fullName, role: access.user.role } };
}

function fail(err: unknown): { ok: false; error: string } {
  if (typeof err === "string") return { ok: false, error: err };
  return { ok: false, error: err instanceof Error ? err.message : "Neočekávaná chyba." };
}

function revalidateJob(jobId?: string | null) {
  try {
    if (jobId) revalidatePath(`/orders/${jobId}`);
    revalidatePath("/inquiries");
    revalidatePath("/pricing");
  } catch {
    // mimo požadavek (testy)
  }
}

async function jobOfRecipient(db: JobsDb, recipientId: string): Promise<string | null> {
  const { data } = await (db as unknown as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: unknown }> } } } })
    .from("rfq_recipients").select("round:rfq_rounds!round_id(job_id)").eq("id", recipientId).maybeSingle();
  const r = data as { round: { job_id: string } | { job_id: string }[] | null } | null;
  const round = Array.isArray(r?.round) ? r?.round[0] : r?.round;
  return round?.job_id ?? null;
}

/** Data dialogu „Poptat dodavatele" (položky, kroky technologie, výkresy, dodavatelé k seřazení, výchozí termíny). */
export async function rfqSetupAction(jobId: string): Promise<Result<{ setup: RfqSetup }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  try {
    const setup = await loadRfqSetup(c.db, jobId);
    if (!setup) return fail("Zakázka nenalezena.");
    return { ok: true, setup };
  } catch (err) {
    return fail(err);
  }
}

/** Náhled e-mailů (každý dodavatel zvlášť) a příloh před odesláním. */
export async function previewRfqAction(input: RfqInput): Promise<Result<{ preview: RfqPreview }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  try {
    const p = await previewRfq(c.db, c.actor, input);
    if ("error" in p) return fail(p.error);
    return { ok: true, preview: p };
  } catch (err) {
    return fail(err);
  }
}

/** Odeslat poptávkové kolo (samostatný e-mail každému dodavateli). */
export async function sendRfqAction(input: RfqInput): Promise<Result<{ result: RfqSendResult }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  try {
    const r = await createAndSendRound(c.db, c.actor, input);
    if ("error" in r) return fail(r.error);
    revalidateJob(input.jobId);
    return { ok: true, result: r };
  } catch (err) {
    return fail(err);
  }
}

/** Kola zakázky (pro obnovení panelu po akci). */
export async function jobRfqAction(jobId: string): Promise<Result<{ data: JobRfqData | null }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  try {
    return { ok: true, data: await loadJobRfq(c.db, jobId) };
  } catch (err) {
    return fail(err);
  }
}

async function onRecipient(recipientId: string, run: (c: Ctx) => Promise<{ ok: true } | { error: string } | { ok: true; [k: string]: unknown }>): Promise<Result> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  try {
    const r = await run(c);
    if ("error" in r) return fail(r.error as string);
    revalidateJob(await jobOfRecipient(c.db, recipientId));
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function remindRfqAction(recipientId: string): Promise<Result> {
  return onRecipient(recipientId, (c) => remindRecipient(c.db, c.actor, recipientId));
}

export async function declineRfqAction(recipientId: string, note?: string | null): Promise<Result> {
  return onRecipient(recipientId, (c) => declineRecipient(c.db, c.actor, recipientId, note ?? null));
}

export async function sendWithoutDrawingsRfqAction(recipientId: string): Promise<Result> {
  return onRecipient(recipientId, (c) => sendRecipientWithoutPending(c.db, c.actor, recipientId));
}

export async function retryRfqAction(recipientId: string): Promise<Result> {
  return onRecipient(recipientId, (c) => retryRecipient(c.db, c.actor, recipientId));
}

export async function saveRfqOfferAction(recipientId: string, input: RfqOfferInput): Promise<Result> {
  return onRecipient(recipientId, (c) => saveRecipientOffer(c.db, c.actor, recipientId, input));
}

/** Předvyplnění „Zapsat nabídku" z odpovědi dodavatele (ceny po položkách, lhůta, platnost, číslo). */
export async function rfqReplyPrefillAction(recipientId: string): Promise<Result<{ prefill: ReplyPrefill | null; subject: string | null }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  try {
    const r = await replyText(c.db, recipientId);
    if (!r) return { ok: true, prefill: null, subject: null };
    return { ok: true, prefill: parseSupplierReply(r.text, r.items, r.today), subject: r.subject };
  } catch (err) {
    return fail(err);
  }
}

export async function selectRfqAction(roundId: string, input: { orderItemId: string | null; recipientId: string; reason?: string | null }): Promise<Result<{ overridden: boolean }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  try {
    const r = await selectWinner(c.db, c.actor, roundId, input);
    if ("error" in r) return fail(r.error);
    const { data } = await (c.db as unknown as { from: (t: string) => { select: (s: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: unknown }> } } } })
      .from("rfq_rounds").select("job_id").eq("id", roundId).maybeSingle();
    revalidateJob((data as { job_id: string } | null)?.job_id ?? null);
    return { ok: true, overridden: r.overridden };
  } catch (err) {
    return fail(err);
  }
}

export async function thankRfqAction(roundId: string): Promise<Result<{ sent: number }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  try {
    const r = await thankOthers(c.db, c.actor, roundId);
    if ("error" in r) return fail(r.error);
    return { ok: true, sent: r.sent };
  } catch (err) {
    return fail(err);
  }
}

/** Nastavení → váhy doporučení dodavatele (cena / termín / kvalita) — jen super admin. */
export async function saveRfqWeightsAction(input: RfqWeights): Promise<Result<{ weights: RfqWeights }>> {
  if (!isSupabaseConfigured()) return fail("Supabase není nakonfigurováno.");
  const access = await checkFeature("settings");
  if ("error" in access) return fail(access.error);
  const weights = normalizeWeights(input);
  try {
    const db = await createOperatorClient({ actor: userActor(access.user) });
    const { error } = await (db as unknown as { from: (t: string) => { upsert: (v: unknown, o: unknown) => Promise<{ error: { message: string } | null }> } })
      .from("integration_settings").upsert({
        key: RFQ_WEIGHTS_SETTING, category: "ai_access", label: "Doporučení dodavatele — váhy cena / termín / kvalita (%)",
        is_secret: false, value: JSON.stringify(weights), updated_by: access.user.id, updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
    if (error) return fail(error.message);
    invalidateSettingsCache();
    await logAudit({ action: "rfq_weights", entity: "integration_settings", entityId: RFQ_WEIGHTS_SETTING, diff: { ...weights }, actor: userActor(access.user) });
    try { revalidatePath("/settings"); } catch { /* mimo požadavek */ }
    return { ok: true, weights };
  } catch (err) {
    return fail(err);
  }
}
