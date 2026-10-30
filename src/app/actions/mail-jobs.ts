"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkFeature, getAccess } from "@/lib/auth/session";
import { userActor } from "@/lib/supabase/actor-headers";
import { logAudit } from "@/lib/audit";
import { getMailScope } from "@/lib/data/mail";
import { visibleThreadEmails } from "@/lib/data/mail-threads";
import { getJobCommunication, type JobCommunication } from "@/lib/data/job-mail";
import { isUuidLike } from "@/lib/email/visibility";
import {
  applyMailChange, backfillMailJobs, copyEmailAttachmentsToJob, dismissMailChange, extractAndApply, linkThread, unlinkThread, undoMailChange,
  type MailJobActor,
} from "@/lib/email/job-link-store";
import { isMailAiEnabled } from "@/lib/email/ingest";
import { loadMailJobAiBudget } from "@/lib/email/job-link-store";

/**
 * Pošta B — akce: potvrdit / zamítnout návrh „Patří k Z-…?", změnit nebo odpojit zakázku vlákna,
 * vrátit / potvrdit změnu z e-mailu, štítek a poznámku z e-mailu, dopočet staré pošty, Komunikace
 * zakázky. Data jdou servisním klíčem s hlavičkami autora — každá akce ověří, že uživatel vlákno
 * (poštu) smí vidět a že má Knihu zakázek; citlivé změny (ceny dodavatele) jen s právem na marže.
 */

type Result = { ok: boolean; error?: string };
const THREAD_NOT_FOUND = "Vlákno nenalezeno (nebo k němu nemáš přístup).";
const JOB_NOT_FOUND = "Zakázka nenalezena.";

async function begin(feature: "mail" | "orders" = "orders"): Promise<{ a: MailJobActor; userId: string; margins: boolean } | { error: string }> {
  if (!isSupabaseConfigured()) return { error: "Supabase není nakonfigurováno." };
  const access = await checkFeature(feature);
  if ("error" in access) return { error: access.error };
  const { can } = await getAccess();
  if (feature === "mail" && !can("orders")) return { error: "K zakázkám nemáš přístup." };
  if (feature === "orders" && !can("orders")) return { error: "K zakázkám nemáš přístup." };
  const ctx = userActor(access.user);
  const db = (await createOperatorClient({ actor: ctx })) as unknown as SupabaseClient;
  return { a: { db, actorId: access.user.id, kind: "user", ctx }, userId: access.user.id, margins: can("margins") };
}

function revalidate(jobIds: (string | null | undefined)[]) {
  revalidatePath("/inbox");
  for (const id of jobIds) if (id) revalidatePath(`/orders/${id}`);
}

/** Zprávy vlákna, které vidím — a první příchozí / poslední zpráva (pro text historie). */
async function threadFor(threadId: string) {
  const v = await visibleThreadEmails(threadId);
  if (!v) return null;
  return v;
}

/**
 * Příchozí zprávy vlákna přiřazené k zakázce: vytěžit změny a uložit přílohy (po ručním přiřazení).
 * force = i pošta už vytěžená k jiné (špatné) zakázce — u té se změny při odpojení vrátily.
 */
async function afterLink(a: MailJobActor, threadId: string, jobId: string): Promise<{ changes: number; files: number }> {
  const out = { changes: 0, files: 0 };
  const { data } = await a.db.from("emails").select("id, direction, received_at").eq("thread_id", threadId).eq("order_id", jobId).order("received_at", { ascending: true }).limit(50);
  const useAi = await isMailAiEnabled();
  const aiBudget = useAi ? await loadMailJobAiBudget() : undefined;
  const stopAt = Date.now() + 45_000;
  for (const r of (data ?? []) as { id: string; direction: string }[]) {
    if (r.direction !== "in" || Date.now() > stopAt) continue;
    out.changes += (await extractAndApply(a, r.id, jobId, { useAi, aiBudget, stopAt, force: true })).changes;
    out.files += (await copyEmailAttachmentsToJob(a, r.id, jobId)).copied;
  }
  return out;
}

/**
 * „Ano" u otázky k jedné zprávě vlákna jiné zakázky (odpověď jmenuje tuto zakázku): k zakázce JEN ta
 * zpráva (jako „Ne") — ostatní zprávy vlákna a jejich otevřené otázky zůstávají (další odpověď může
 * jmenovat jinou zakázku); vytěžení a přílohy jen z té zprávy.
 */
async function confirmMessageSuggestion(
  c: { a: MailJobActor; userId: string },
  s: { id: string; thread_id: string; job_id: string; email_id: string; thread_job_id: string },
  visibleIds: ReadonlySet<string>,
): Promise<Result & { jobId?: string; jobNumber?: string; changes?: number }> {
  if (!visibleIds.has(s.email_id)) return { ok: false, error: THREAD_NOT_FOUND };
  const { data: em } = await c.a.db.from("emails").select("id, thread_id, subject, direction, category, supplier_id, customer_id, from_name, from_email, order_id")
    .eq("id", s.email_id).maybeSingle();
  const e = em as { id: string; direction: string; order_id: string | null } | null;
  if (!e) return { ok: false, error: THREAD_NOT_FOUND };
  if (e.order_id && e.order_id !== s.job_id) return { ok: false, error: "Zpráva je mezitím přiřazená k jiné zakázce — obnov stránku." };
  // vyřídit otázku hned (dvojí ťuknutí nepropíše dvakrát)
  const now = new Date().toISOString();
  const { data: claimed } = await c.a.db.from("email_job_suggestions").update({ status: "accepted", resolved_at: now, resolved_by: c.userId })
    .eq("id", s.id).eq("status", "pending").select("id");
  if (!(claimed ?? []).length) return { ok: false, error: "Návrh už je vyřízený — obnov stránku." };
  if (!e.order_id) {
    // thread_id: null → linkThread přiřadí jen tuhle zprávu a otázek vlákna se nedotkne
    const r = await linkThread(c.a, { email: { ...(em as Record<string, unknown>), thread_id: null } as never, jobId: s.job_id, source: "manual", confidence: null, strong: true });
    if (!r.ok) {
      await c.a.db.from("email_job_suggestions").update({ status: "pending", resolved_at: null, resolved_by: null }).eq("id", s.id);
      return { ok: false, error: r.error };
    }
  }
  let changes = 0;
  if (e.direction === "in") {
    // cíl potvrdil člověk → pokyny z té zprávy se propíší (force: i dřív vytěžená k jiné zakázce)
    const useAi = await isMailAiEnabled();
    const aiBudget = useAi ? await loadMailJobAiBudget() : undefined;
    changes = (await extractAndApply(c.a, e.id, s.job_id, { useAi, aiBudget, stopAt: Date.now() + 45_000, force: true })).changes;
    await copyEmailAttachmentsToJob(c.a, e.id, s.job_id);
  }
  const { data: job } = await c.a.db.from("orders").select("number").eq("id", s.job_id).maybeSingle();
  await logAudit({ action: "email_job_suggestion_accepted", entity: "emails", entityId: s.email_id, diff: { threadId: s.thread_id, jobId: s.job_id, threadJobId: s.thread_job_id, message: true } });
  revalidate([s.job_id, s.thread_job_id]);
  return { ok: true, jobId: s.job_id, jobNumber: (job as { number: string } | null)?.number, changes };
}

/** „Ano" u návrhu „Patří k Z-…?" — přiřadí celé vlákno (otázka k jedné zprávě: jen tu zprávu). */
export async function confirmJobSuggestionAction(suggestionId: string): Promise<Result & { jobId?: string; jobNumber?: string; changes?: number }> {
  const c = await begin("mail");
  if ("error" in c) return { ok: false, error: c.error };
  if (!isUuidLike(suggestionId)) return { ok: false, error: "Návrh nenalezen." };
  const { data } = await c.a.db.from("email_job_suggestions").select("id, thread_id, job_id, status, email_id, thread_job_id").eq("id", suggestionId).maybeSingle();
  const s = data as { id: string; thread_id: string; job_id: string; status: string; email_id: string | null; thread_job_id: string | null } | null;
  if (!s) return { ok: false, error: "Návrh nenalezen." };
  const v = await threadFor(s.thread_id);
  if (!v) return { ok: false, error: THREAD_NOT_FOUND };
  if (s.status !== "pending") return { ok: false, error: "Návrh už je vyřízený — obnov stránku." };
  if (s.email_id && s.thread_job_id) {
    return confirmMessageSuggestion(c, { ...s, email_id: s.email_id, thread_job_id: s.thread_job_id }, new Set(v.rows.map((r) => r.id)));
  }
  const { data: em } = await c.a.db.from("emails").select("id, thread_id, subject, direction, category, supplier_id, customer_id, from_name, from_email")
    .eq("id", s.email_id ?? v.rows[v.rows.length - 1].id).maybeSingle();
  if (!em) return { ok: false, error: THREAD_NOT_FOUND };
  const r = await linkThread(c.a, { email: em as never, jobId: s.job_id, source: "manual", confidence: null, strong: true });
  if (!r.ok) return { ok: false, error: r.error };
  await c.a.db.from("email_job_suggestions").update({ status: "accepted", resolved_at: new Date().toISOString(), resolved_by: c.userId }).eq("id", s.id);
  const x = await afterLink(c.a, s.thread_id, s.job_id);
  const { data: job } = await c.a.db.from("orders").select("number").eq("id", s.job_id).maybeSingle();
  await logAudit({ action: "email_job_suggestion_accepted", entity: "emails", entityId: s.email_id ?? undefined, diff: { threadId: s.thread_id, jobId: s.job_id } });
  revalidate([s.job_id]);
  return { ok: true, jobId: s.job_id, jobNumber: (job as { number: string } | null)?.number, changes: x.changes };
}

/** „Ne" u návrhu — vlákno se k té zakázce už nenavrhne. */
export async function rejectJobSuggestionAction(suggestionId: string): Promise<Result> {
  const c = await begin("mail");
  if ("error" in c) return { ok: false, error: c.error };
  if (!isUuidLike(suggestionId)) return { ok: false, error: "Návrh nenalezen." };
  const { data } = await c.a.db.from("email_job_suggestions").select("id, thread_id, email_id, thread_job_id, job:orders!job_id(number)").eq("id", suggestionId).maybeSingle();
  const s = data as { id: string; thread_id: string; email_id: string | null; thread_job_id: string | null; job: { number: string } | { number: string }[] | null } | null;
  if (!s || !(await threadFor(s.thread_id))) return { ok: false, error: "Návrh nenalezen." };
  const { data: upd, error } = await c.a.db.from("email_job_suggestions").update({ status: "rejected", resolved_at: new Date().toISOString(), resolved_by: c.userId })
    .eq("id", s.id).eq("status", "pending").select("id");
  if (error) return { ok: false, error: error.message };
  // „Ne" u otázky k jedné zprávě vlákna jiné zakázky: zpráva patří k zakázce vlákna — přiřadit, ale její
  // pokyny jen jako návrhy (jmenovala jinou zakázku; propsat potvrdí člověk v Komunikaci)
  let jobId: string | null = null;
  if ((upd ?? []).length && s.email_id && s.thread_job_id) {
    const { data: em } = await c.a.db.from("emails").select("id, thread_id, subject, direction, category, supplier_id, customer_id, from_name, from_email, order_id")
      .eq("id", s.email_id).maybeSingle();
    // „Ne" = zpráva patří k zakázce vlákna z doby otázky (s.thread_job_id), dokud je ve vlákně; ne k zakázce
    // naposledy přiřazené zprávy (to může být jiná zakázka po „Ano" u jiné otázky téhož vlákna)
    const { data: still } = await c.a.db.from("emails").select("order_id").eq("thread_id", s.thread_id).eq("order_id", s.thread_job_id)
      .limit(1).maybeSingle();
    if (still) jobId = s.thread_job_id;
    else {
      const { data: tj } = await c.a.db.from("emails").select("order_id").eq("thread_id", s.thread_id).not("order_id", "is", null)
        .order("received_at", { ascending: false }).limit(1).maybeSingle();
      jobId = (tj as { order_id: string } | null)?.order_id ?? null;
    }
    const e = em as { id: string; order_id: string | null; direction: string } | null;
    if (e && !e.order_id && jobId) {
      // jen tahle zpráva (thread_id: null → linkThread přiřadí podle id e-mailu)
      const r = await linkThread(c.a, { email: { ...(em as Record<string, unknown>), thread_id: null } as never, jobId, source: "manual", confidence: null, strong: true });
      if (r.ok && e.direction === "in") {
        const otherNumber = (Array.isArray(s.job) ? s.job[0]?.number : s.job?.number) ?? "jiná";
        await extractAndApply(c.a, e.id, jobId, { force: true, hold: { reason: "other_job", jobNumber: otherNumber } });
        await copyEmailAttachmentsToJob(c.a, e.id, jobId);
      }
    }
  }
  revalidate([jobId]);
  return { ok: true };
}

/** Změnit / odpojit zakázku vlákna jedním ťuknutím (jobId = null → odpojit). Platí pro celé vlákno. */
export async function setThreadJobAction(threadId: string, jobId: string | null): Promise<Result & { jobId?: string | null; jobNumber?: string; changes?: number }> {
  const c = await begin("mail");
  if ("error" in c) return { ok: false, error: c.error };
  if (jobId !== null && !isUuidLike(jobId)) return { ok: false, error: JOB_NOT_FOUND };
  const v = await threadFor(threadId);
  if (!v) return { ok: false, error: THREAD_NOT_FOUND };
  const { data: rows } = await c.a.db.from("emails").select("id, thread_id, subject, direction, category, supplier_id, customer_id, from_name, from_email, order_id, received_at")
    .eq("thread_id", threadId).order("received_at", { ascending: true }).limit(300);
  const visible = new Set(v.rows.map((r) => r.id));
  const list = ((rows ?? []) as { id: string; order_id: string | null; subject: string | null; direction: "in" | "out" }[]).filter((r) => visible.has(r.id));
  if (!list.length) return { ok: false, error: THREAD_NOT_FOUND };
  const current = [...new Set(list.map((r) => r.order_id).filter((x): x is string => Boolean(x)))];
  if (jobId && current.length === 1 && current[0] === jobId) return { ok: true, jobId };
  const subject = list.find((r) => r.subject)?.subject ?? "";
  for (const old of current) {
    if (old === jobId) continue;
    const r = await unlinkThread(c.a, threadId, old, subject);
    if (!r.ok) return { ok: false, error: r.error };
  }
  let changes = 0;
  let number: string | undefined;
  if (jobId) {
    const { data: job } = await c.a.db.from("orders").select("id, number, merged_into_id").eq("id", jobId).maybeSingle();
    const j = job as { id: string; number: string; merged_into_id: string | null } | null;
    if (!j) return { ok: false, error: JOB_NOT_FOUND };
    const target = j.merged_into_id ?? j.id;
    const lastIn = [...list].reverse().find((r) => r.direction === "in") ?? list[list.length - 1];
    // ruční přiřazení přebíjí dřívější „Ne" u téže zakázky
    await c.a.db.from("email_job_suggestions").delete().eq("thread_id", threadId).eq("job_id", target).eq("status", "rejected");
    const r = await linkThread(c.a, { email: lastIn as never, jobId: target, source: "manual", confidence: null, strong: true });
    if (!r.ok) return { ok: false, error: r.error };
    changes = (await afterLink(c.a, threadId, target)).changes;
    number = j.number;
    jobId = target;
  }
  await logAudit({ action: jobId ? "email_thread_job_set" : "email_thread_job_unlinked", entity: "emails", entityId: list[0].id, diff: { threadId, from: current, to: jobId } });
  revalidate([...current, jobId]);
  return { ok: true, jobId, jobNumber: number, changes };
}

export interface JobPick { id: string; number: string; title: string; customer: string | null; stage: string }

type PickRow = { id: string; number: string; title: string | null; status: string; customer_id: string | null; customer: { name: string } | { name: string }[] | null };
const PICK_COLS = "id, number, title, status, customer_id, updated_at, customer:customers!customer_id(name)";

/**
 * Hledání zakázky pro přiřazení e-mailu (číslo, název, objednávka zákazníka). S vláknem: bez dotazu
 * nahoře otevřené zakázky firmy odesílatele (a navržené), pak ostatní; uzavřené vždy dole.
 */
export async function searchJobsForMailAction(query: string, threadId?: string | null): Promise<JobPick[]> {
  const c = await begin("mail");
  if ("error" in c) return [];
  const q = (query ?? "").trim().replace(/[%_,()\\]/g, " ").trim().slice(0, 60);
  // firma odesílatele vlákna (jen vlákno, které smím vidět)
  let customers: string[] = [];
  let suggested: string[] = [];
  if (threadId) {
    const v = await threadFor(threadId);
    if (v) {
      const { data: em } = await c.a.db.from("emails").select("customer_id").in("id", v.rows.map((r) => r.id).slice(0, 200)).not("customer_id", "is", null);
      customers = [...new Set(((em ?? []) as { customer_id: string }[]).map((r) => r.customer_id))].slice(0, 5);
      const { data: sg } = await c.a.db.from("email_job_suggestions").select("job_id").eq("thread_id", threadId).eq("status", "pending").limit(5);
      suggested = ((sg ?? []) as { job_id: string }[]).map((r) => r.job_id);
    }
  }
  const closed = new Set(["dokonceno", "zruseno", "nerealizovano", "fakturovano"]);
  const rows: PickRow[] = [];
  if (customers.length || suggested.length) {
    let first = c.a.db.from("orders").select(PICK_COLS).is("merged_into_id", null).not("status", "in", "(dokonceno,zruseno,nerealizovano,fakturovano)")
      .order("updated_at", { ascending: false }).limit(12);
    const ors = [
      ...(customers.length ? [`customer_id.in.(${customers.join(",")})`] : []),
      ...(suggested.length ? [`id.in.(${suggested.join(",")})`] : []),
    ].join(",");
    first = first.or(ors);
    if (q) first = first.or(`number.ilike.%${q}%,title.ilike.%${q}%,customer_order_number.ilike.%${q}%`);
    rows.push(...(((await first).data ?? []) as PickRow[]));
  }
  let req = c.a.db.from("orders").select(PICK_COLS).is("merged_into_id", null).order("updated_at", { ascending: false }).limit(12);
  if (q) req = req.or(`number.ilike.%${q}%,title.ilike.%${q}%,customer_order_number.ilike.%${q}%`);
  for (const r of ((await req).data ?? []) as PickRow[]) if (!rows.some((x) => x.id === r.id)) rows.push(r);
  const rank = (r: PickRow) => (suggested.includes(r.id) ? 0 : r.customer_id && customers.includes(r.customer_id) ? 1 : 2) + (closed.has(r.status) ? 10 : 0);
  return rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => rank(x.r) - rank(y.r) || x.i - y.i)
    .slice(0, 15)
    .map(({ r }) => ({ id: r.id, number: r.number, title: r.title ?? "", customer: (Array.isArray(r.customer) ? r.customer[0]?.name : r.customer?.name) ?? null, stage: r.status }));
}

async function changeGuard(c: { a: MailJobActor; margins: boolean }, changeId: string): Promise<{ jobId: string } | { error: string }> {
  if (!isUuidLike(changeId)) return { error: "Změna nenalezena." };
  const { data } = await c.a.db.from("job_mail_changes").select("job_id, sensitive").eq("id", changeId).maybeSingle();
  const r = data as { job_id: string; sensitive: boolean } | null;
  if (!r || (r.sensitive && !c.margins)) return { error: "Změna nenalezena." };
  return { jobId: r.job_id };
}

/** Vrátit změnu položky z e-mailu (jedním ťuknutím). */
export async function undoMailChangeAction(changeId: string): Promise<Result> {
  const c = await begin("orders");
  if ("error" in c) return { ok: false, error: c.error };
  const g = await changeGuard(c, changeId);
  if ("error" in g) return { ok: false, error: g.error };
  const r = await undoMailChange(c.a, changeId);
  if (r.ok) {
    await logAudit({ action: "job_mail_change_undone", entity: "orders", entityId: g.jobId, diff: { changeId } });
    revalidate([g.jobId]);
  }
  return { ok: r.ok, error: r.error };
}

/** Potvrdit návrh z e-mailu (změna položky / štítek / poznámka). */
export async function applyMailChangeAction(changeId: string): Promise<Result> {
  const c = await begin("orders");
  if ("error" in c) return { ok: false, error: c.error };
  const g = await changeGuard(c, changeId);
  if ("error" in g) return { ok: false, error: g.error };
  const r = await applyMailChange(c.a, changeId);
  if (r.ok) {
    await logAudit({ action: "job_mail_change_applied", entity: "orders", entityId: g.jobId, diff: { changeId } });
    revalidate([g.jobId]);
  }
  return { ok: r.ok, error: r.error };
}

export async function dismissMailChangeAction(changeId: string): Promise<Result> {
  const c = await begin("orders");
  if ("error" in c) return { ok: false, error: c.error };
  const g = await changeGuard(c, changeId);
  if ("error" in g) return { ok: false, error: g.error };
  const r = await dismissMailChange(c.a, changeId);
  if (r.ok) revalidate([g.jobId]);
  return { ok: r.ok, error: r.error };
}

/** Uložit přílohy vlákna do dokumentů zakázky (když se při stahování nestihly). */
export async function copyThreadAttachmentsAction(threadId: string): Promise<Result & { copied?: number }> {
  const c = await begin("mail");
  if ("error" in c) return { ok: false, error: c.error };
  const v = await threadFor(threadId);
  if (!v) return { ok: false, error: THREAD_NOT_FOUND };
  const { data } = await c.a.db.from("emails").select("id, order_id, has_attachments").in("id", v.rows.map((r) => r.id));
  let copied = 0;
  const jobs = new Set<string>();
  for (const r of (data ?? []) as { id: string; order_id: string | null; has_attachments: boolean }[]) {
    if (!r.order_id || !r.has_attachments) continue;
    jobs.add(r.order_id);
    copied += (await copyEmailAttachmentsToJob(c.a, r.id, r.order_id)).copied;
  }
  revalidate([...jobs]);
  return { ok: true, copied };
}

/**
 * Dopočet už stažené pošty (jednorázově, opakovatelně bez duplicit): super admin všechny schránky,
 * ostatní své. Jen pravidla — bez AI, bez vytěžení a bez změn položek.
 */
export async function backfillMailJobsAction(): Promise<Result & { processed?: number; linked?: number; suggested?: number; remaining?: number }> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, error: access.error };
  const scope = await getMailScope();
  if (!scope) return { ok: false, error: "Nemáš přístup k poště." };
  const r = await backfillMailJobs({ mailboxIds: scope.all ? null : scope.ownedMailboxIds, limit: 400, stopAt: Date.now() + 50_000 });
  await logAudit({ action: "email_job_backfill", entity: "emails", diff: r });
  revalidatePath("/inbox");
  return { ok: true, ...r };
}

/** Komunikace zakázky (obnovení záložky). */
export async function getJobCommunicationAction(jobId: string): Promise<JobCommunication | null> {
  const access = await checkFeature("orders");
  if ("error" in access) return null;
  if (!isUuidLike(jobId)) return null;
  return getJobCommunication(jobId);
}
