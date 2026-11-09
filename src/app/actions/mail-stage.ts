"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkFeature, getAccess } from "@/lib/auth/session";
import { userActor } from "@/lib/supabase/actor-headers";
import { logAudit } from "@/lib/audit";
import { visibleThreadEmails } from "@/lib/data/mail-threads";
import { isUuidLike } from "@/lib/email/visibility";
import { recordCorrection } from "@/app/actions/corrections";
import { isMailStageKind, type MailStageKind } from "@/lib/email/mail-stage-signal";
import {
  MAIL_STAGE_AGENT, applyStageCore, changeStageCore, correctionContext, loadStageRow, rejectStageCore, signalText, stageRowForApproval,
  stageRowsForThread, stageViews, undoStageCore, type MailStageRow, type MailStageView, type StageActor, type StageTarget,
} from "@/lib/email/mail-stage-store";
import { isLostReason } from "@/lib/jobs/flow-status";
import { isClaimReason } from "@/lib/jobs/flow-exceptions";
import { maySeeQueue } from "@/lib/auth/approval-queue-access";
import type { JobStage } from "@/lib/supabase/database.types";

/**
 * Pošta → speciální stav zakázky (majitel 9. 11., „samozřejmě s korekcí"): potvrdit návrh (i s jiným stavem /
 * důvodem), „Žádná změna", Vrátit a Změnit po přepnutí. Smí každý se zakázkou (Kniha zakázek) — stejně jako
 * speciální stavy ručně. Každá korekce (zamítnutí, vrácení, jiný stav / důvod) se uloží jako učení AI
 * (recordCorrection, agent „mail_stage") a vlákno + druh se už znovu nenavrhne.
 */

type Result = { ok: boolean; error?: string; stage?: JobStage };

/** Vstup korekce z UI: druh nebo „none" (žádná změna), důvod, důvod prohry / druh reklamace. */
export interface StageChoice {
  kind: MailStageKind | "none";
  reason?: string | null;
  lostReason?: string | null;
  claimReason?: string | null;
}

const PATHS = ["/inbox", "/orders", "/dashboard", "/inquiries", "/quotes", "/confirmations", "/"];

async function begin(): Promise<{ a: StageActor; userId: string } | { error: string }> {
  if (!isSupabaseConfigured()) return { error: "Supabase není nakonfigurováno." };
  const access = await checkFeature("orders");
  if ("error" in access) return { error: access.error };
  const db = (await createOperatorClient({ actor: userActor(access.user) })) as unknown as SupabaseClient;
  return { a: { db, id: access.user.id, kind: "user" }, userId: access.user.id };
}

function revalidate(jobId: string) {
  for (const p of PATHS) revalidatePath(p);
  revalidatePath(`/orders/${jobId}`);
}

function target(c: StageChoice): StageTarget {
  return {
    kind: isMailStageKind(c.kind) ? c.kind : undefined,
    reason: typeof c.reason === "string" ? c.reason : undefined,
    lostReason: isLostReason(c.lostReason) ? c.lostReason : null,
    claimReason: isClaimReason(c.claimReason) ? c.claimReason : null,
  };
}

async function row(c: { a: StageActor }, signalId: string): Promise<MailStageRow | null> {
  return isUuidLike(signalId) ? loadStageRow(c.a.db, signalId) : null;
}

/** Učení z korekce: co AI navrhla / přepnula → co je správně (best-effort, akci neshodí). */
async function learn(c: { a: StageActor }, r: MailStageRow, corrected: { kind: MailStageKind | null; reason: string | null }, note: string) {
  try {
    const ai = signalText(r.final_kind ?? r.kind, r.reason);
    const fixed = signalText(corrected.kind, corrected.reason);
    if (ai === fixed) return;
    await recordCorrection({
      agentKey: MAIL_STAGE_AGENT, field: "job_stage", context: await correctionContext(c.a.db, r), aiValue: ai, correctedValue: fixed, note,
    });
  } catch (err) {
    console.error(`[mail-stage] Učení z korekce selhalo: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Signály vlákna k zakázce (lišta zakázky ve vlákně) — jen vlákno, které vidím. */
export async function getThreadStageSignalsAction(threadId: string, jobId?: string | null): Promise<MailStageView[]> {
  const c = await begin();
  if ("error" in c) return [];
  if (jobId && !isUuidLike(jobId)) return [];
  const v = await visibleThreadEmails(threadId);
  if (!v || !v.rows.length) return [];
  const rows = await stageRowsForThread(c.a.db, threadId, jobId ?? null);
  return stageViews(c.a.db, rows, { quote: true });
}

/** Signál položky fronty ke schválení (řádek „Stav zakázky z pošty"). */
export async function getApprovalStageSignalAction(approvalId: string): Promise<MailStageView | null> {
  const c = await begin();
  if ("error" in c || !isUuidLike(approvalId)) return null;
  const { can } = await getAccess();
  // fronta ke schválení: super admin, 9. 11. i „Smí řešit frontu ke schválení"
  if (!maySeeQueue(can)) return null;
  const r = await stageRowForApproval(c.a.db, approvalId);
  return r ? (await stageViews(c.a.db, [r], { quote: true }))[0] ?? null : null;
}

/** Jeden signál (Změnit… v historii zakázky). */
export async function getStageSignalAction(signalId: string): Promise<MailStageView | null> {
  const c = await begin();
  if ("error" in c) return null;
  const r = await row(c, signalId);
  return r ? (await stageViews(c.a.db, [r]))[0] ?? null : null;
}

/**
 * Potvrdit návrh (fronta / tlačítko ve vlákně) — případně s jiným stavem či důvodem; „none" = žádná změna.
 */
export async function confirmStageSignalAction(signalId: string, choice: StageChoice): Promise<Result> {
  const c = await begin();
  if ("error" in c) return { ok: false, error: c.error };
  const r = await row(c, signalId);
  if (!r) return { ok: false, error: "Návrh nenalezen." };
  if (r.status !== "pending") return { ok: false, error: "Návrh už je vyřízený — obnov stránku." };
  if (!choice || choice.kind === "none") {
    const res = await rejectStageCore(c.a, r, typeof choice?.reason === "string" ? choice.reason : null);
    if (!res.ok) return { ok: false, error: res.error };
    await learn(c, r, { kind: null, reason: null }, "Návrh stavu zakázky z e-mailu zamítnut — e-mail tento stav nenaznačuje.");
    await logAudit({ action: "mail_stage_rejected", entity: "orders", entityId: r.job_id, diff: { signalId, kind: r.kind } });
    revalidate(r.job_id);
    return { ok: true };
  }
  const t = target(choice);
  const res = await applyStageCore(c.a, r, t);
  if (!res.ok) return { ok: false, error: res.error };
  const fresh = await loadStageRow(c.a.db, r.id);
  if (fresh && ((fresh.final_kind ?? fresh.kind) !== r.kind || (fresh.reason ?? "") !== (r.reason ?? ""))) {
    await learn(c, r, { kind: fresh.final_kind ?? fresh.kind, reason: fresh.reason }, "Člověk návrh stavu z e-mailu před potvrzením upravil.");
  }
  await logAudit({ action: "mail_stage_applied", entity: "orders", entityId: r.job_id, diff: { signalId, kind: fresh?.final_kind ?? r.kind, stage: res.stage } });
  revalidate(r.job_id);
  return { ok: true, stage: res.stage };
}

/** Vrátit přepnutí z pošty (AI chybně) — zpět na stav před ním; jen když se od té doby nic nezměnilo. */
export async function undoStageSignalAction(signalId: string, note?: string | null): Promise<Result> {
  const c = await begin();
  if ("error" in c) return { ok: false, error: c.error };
  const r = await row(c, signalId);
  if (!r) return { ok: false, error: "Záznam nenalezen." };
  const res = await undoStageCore(c.a, r, { note });
  if (!res.ok) return { ok: false, error: res.error };
  await learn(c, r, { kind: null, reason: null }, "Přepnutí stavu zakázky z e-mailu bylo chybné — vráceno.");
  await logAudit({ action: "mail_stage_undone", entity: "orders", entityId: r.job_id, diff: { signalId, kind: r.final_kind ?? r.kind, back: res.stage } });
  revalidate(r.job_id);
  return { ok: true, stage: res.stage };
}

/** Změnit přepnutí z pošty: jiný speciální stav nebo jiný důvod; „none" = Vrátit. */
export async function changeStageSignalAction(signalId: string, choice: StageChoice): Promise<Result> {
  if (!choice || choice.kind === "none") return undoStageSignalAction(signalId, typeof choice?.reason === "string" ? choice.reason : null);
  const c = await begin();
  if ("error" in c) return { ok: false, error: c.error };
  const r = await row(c, signalId);
  if (!r) return { ok: false, error: "Záznam nenalezen." };
  const res = await changeStageCore(c.a, r, target(choice));
  if (!res.ok) return { ok: false, error: res.error };
  const fresh = await loadStageRow(c.a.db, r.id);
  await learn(c, r, { kind: fresh?.final_kind ?? (isMailStageKind(choice.kind) ? choice.kind : null), reason: fresh?.reason ?? null },
    "Člověk přepnutí stavu zakázky z e-mailu opravil.");
  await logAudit({ action: "mail_stage_changed", entity: "orders", entityId: r.job_id, diff: { signalId, from: r.final_kind ?? r.kind, to: fresh?.final_kind, stage: res.stage } });
  revalidate(r.job_id);
  return { ok: true, stage: res.stage };
}
