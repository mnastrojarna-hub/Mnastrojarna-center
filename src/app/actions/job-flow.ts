"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor, withChangeNote } from "@/lib/supabase/actor-headers";
import { checkFeature, getAccess } from "@/lib/auth/session";
import { getJobFlow } from "@/lib/data/flow-status";
import { logJobEvent } from "@/lib/jobs/events";
import { isJobStage } from "@/lib/jobs/stages";
import { cleanDate, isUuid, todayIso, translateDbError } from "@/lib/jobs/mapping";
import { quoteFactsFromRow, quoteLabel, reasonRequired, stageEffect, stageEffectText, transitionFeature } from "@/lib/jobs/flow-status";
import type { ActionResult } from "@/lib/jobs/types";
import type { JobStage } from "@/lib/supabase/database.types";

/**
 * Doplňky Knihy a karty zakázky k akcím toku (Balík 1): náhled dopadu ruční korekce stavu
 * pro místa, která nemají fakta toku po ruce (StageSelect ve sdílených seznamech), a prodloužení
 * platnosti odeslané nabídky. Stavové události zapisuje DB, popisné akce s autorem.
 */

function fail(err: unknown): { ok: false; error: string } {
  if (typeof err === "string") return { ok: false, error: translateDbError(err) };
  if (err && typeof err === "object" && "message" in err) return { ok: false, error: translateDbError(String((err as { message: unknown }).message)) };
  return { ok: false, error: "Neočekávaná chyba." };
}

const czDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}. ${m}. ${y}`;
};

/** Náhled „Korekce stavu…": co se stane s nabídkami a dílčími stavy, zda je nutný důvod a zda to smím. */
export async function previewJobStage(
  jobId: string, to: JobStage,
): Promise<ActionResult<{ from: JobStage; lines: string[]; reasonRequired: boolean; allowed: boolean }>> {
  if (!isSupabaseConfigured()) return fail("Supabase není nakonfigurováno.");
  if (!isUuid(jobId)) return fail("Zakázka nenalezena.");
  if (!isJobStage(to)) return fail("Neznámý stav zakázky.");
  const access = await checkFeature("orders");
  if ("error" in access) return fail(access.error);
  try {
    const flow = await getJobFlow(jobId);
    if (!flow) return fail("Zakázka nenalezena.");
    const { can } = await getAccess();
    const effect = stageEffect(flow.facts, flow.quotes, { kind: "stage", to });
    return {
      ok: true,
      from: flow.facts.stage,
      lines: stageEffectText(effect),
      reasonRequired: reasonRequired("job", to),
      allowed: can(transitionFeature("job", to)),
    };
  } catch (err) {
    return fail(err);
  }
}

/** „Prodloužit platnost" odeslané nabídky (stav „Vypršela" zmizí, nabídka zůstává odeslaná). */
export async function extendQuoteValidity(quoteId: string, validUntil: string): Promise<ActionResult<{ validUntil: string }>> {
  if (!isSupabaseConfigured()) return fail("Supabase není nakonfigurováno.");
  if (!isUuid(quoteId)) return fail("Nabídka nenalezena.");
  const date = cleanDate(validUntil);
  if (!date) return fail("Neplatné datum (čekám RRRR-MM-DD).");
  if (date < todayIso()) return fail("Nová platnost musí být dnes nebo později.");
  const access = await checkFeature("workflow");
  if ("error" in access) return fail(access.error);
  try {
    const db = await createOperatorClient({ actor: userActor(access.user) });
    const { data: row, error: loadErr } = await db.from("quotes")
      .select("id, job_id, number, revision, status, state, valid_until, approved_by, approval_required, archived, sent_at, ai_generated, superseded_by, created_by, created_at, total")
      .eq("id", quoteId).maybeSingle();
    if (loadErr) return fail(loadErr);
    if (!row) return fail("Nabídka nenalezena.");
    const q = quoteFactsFromRow(row as Record<string, unknown>);
    if (q.state !== "odeslana" && q.state !== "pripominky") return fail("Prodloužit jde jen odeslanou nabídku.");
    const prev = (row as { valid_until: string | null }).valid_until;
    const update = db.from("quotes").update({ valid_until: date } as never).eq("id", quoteId).eq("state", q.state);
    const { data, error } = await withChangeNote(update, `platnost prodloužena do ${czDay(date)}`).select("id");
    if (error) return fail(error);
    if (!data?.length) return fail("Nabídku mezitím někdo změnil — obnov stránku.");
    const jobId = (row as { job_id: string | null }).job_id;
    if (jobId) {
      await logJobEvent(db, {
        jobId, type: "quote", entity: "quote", entityId: quoteId, actorId: access.user.id,
        message: `${quoteLabel(q)}: platnost prodloužena${prev ? ` z ${czDay(prev)}` : ""} do ${czDay(date)}`,
        data: { quoteId, number: q.number, action: "extended", from: prev, to: date },
      });
      revalidatePath(`/orders/${jobId}`);
    }
    revalidatePath("/orders");
    revalidatePath("/quotes");
    return { ok: true, validUntil: date };
  } catch (err) {
    return fail(err);
  }
}
