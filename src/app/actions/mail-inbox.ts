"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkFeature } from "@/lib/auth/session";
import { userActor } from "@/lib/supabase/actor-headers";
import { logAudit } from "@/lib/audit";
import { getFolderCounts, getThread, listThreads, visibleThreadEmails } from "@/lib/data/mail-threads";
import { aiCategorizeStored } from "@/lib/email/ingest";
import { canSeeEmail, categoryCodeFromLabel, isUuidLike } from "@/lib/email/visibility";
import { getMailScope } from "@/lib/data/mail";
import { isMailFolder, isMailSort, type FolderCounts, type ThreadDetail, type ThreadPage, type ThreadQuery } from "@/lib/email/mail-types";

/**
 * Akce Přijaté pošty nad VLÁKNEM: seznam, detail, přečteno, vlaječka, priorita 1–5, předání
 * kolegovi, AI na požádání. Data jdou servisním klíčem → každá akce ověří, že uživatel vlákno smí
 * vidět (visibleThreadEmails). Kdo co změnil: emails.flagged_by / priority_set_by + audit.
 */

type Result = { ok: boolean; error?: string };
const NOT_FOUND = "Vlákno nenalezeno (nebo k němu nemáš přístup).";

async function db(): Promise<SupabaseClient> {
  return (await createOperatorClient()) as unknown as SupabaseClient;
}

export async function listThreadsAction(q: ThreadQuery): Promise<ThreadPage & { counts?: FolderCounts; error?: string }> {
  const access = await checkFeature("mail");
  if ("error" in access) return { items: [], total: 0, offset: 0, hasMore: false, error: access.error };
  const query: ThreadQuery = {
    folder: isMailFolder(q?.folder) ? q.folder : "inbox",
    mailboxId: typeof q?.mailboxId === "string" ? q.mailboxId : null,
    query: typeof q?.query === "string" ? q.query.slice(0, 200) : undefined,
    priorityMax: typeof q?.priorityMax === "number" ? q.priorityMax : null,
    unreadOnly: q?.unreadOnly === true,
    category: typeof q?.category === "string" && categoryCodeFromLabel(q.category) ? q.category : null,
    sort: isMailSort(q?.sort) ? q.sort : "date",
    offset: Number(q?.offset) || 0,
    limit: Number(q?.limit) || 50,
  };
  const [page, counts] = await Promise.all([listThreads(query), query.offset ? Promise.resolve(undefined) : getFolderCounts(query.mailboxId)]);
  return { ...page, ...(counts ? { counts } : {}) };
}

/** Detail vlákna; otevřením se příchozí zprávy označí jako přečtené a předání jako přečtené. */
export async function openThreadAction(threadId: string, opts: { markRead?: boolean } = {}): Promise<ThreadDetail> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, error: access.error };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  const detail = await getThread(threadId);
  if (!detail.ok || opts.markRead === false) return detail;
  try {
    const c = await db();
    // přečteno jen u zpráv, které jsou moje vlastním právem — kolega, kterému bylo vlákno předáno,
    // majiteli schránky nepřečtenou poštu „nepřečte" (jeho stav je email_shares.read_at)
    const scope = await getMailScope();
    const candidates = (detail.messages ?? []).filter((m) => m.direction === "in" && !m.isRead).map((m) => m.id);
    let unread: string[] = [];
    if (scope && candidates.length) {
      const { data: own } = await c.from("emails").select("id, owner_id, mailbox_id").in("id", candidates);
      unread = ((own ?? []) as { id: string; owner_id: string | null; mailbox_id: string | null }[])
        .filter((r) => canSeeEmail(scope, r, scope.ownedMailboxIds)).map((r) => r.id);
    }
    if (unread.length) await c.from("emails").update({ is_read: true }).in("id", unread);
    await c.from("email_shares").update({ read_at: new Date().toISOString() }).eq("thread_id", threadId).eq("shared_with", access.user.id).is("read_at", null);
    if (unread.length) detail.messages = detail.messages!.map((m) => (unread.includes(m.id) ? { ...m, isRead: true } : m));
  } catch {
    // přečtení je kosmetika
  }
  return detail;
}

export async function markThreadReadAction(threadId: string, read: boolean): Promise<Result> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, error: access.error };
  const v = await visibleThreadEmails(threadId);
  if (!v) return { ok: false, error: NOT_FOUND };
  const c = await db();
  // předané vlákno: přečteno / nepřečteno = moje předání (pošta majitele schránky se nemění)
  if (v.sharedToMe) {
    await c.from("email_shares").update({ read_at: read ? new Date().toISOString() : null }).eq("thread_id", threadId).eq("shared_with", access.user.id);
  }
  const ids = v.rows.filter((r) => r.direction === "in" && canSeeEmail(v.scope, r, v.scope.ownedMailboxIds)).map((r) => r.id);
  if (!ids.length) return { ok: true };
  const target = read ? ids : ids.slice(-1); // nepřečtené = poslední příchozí
  const { error } = await c.from("emails").update({ is_read: Boolean(read) }).in("id", target);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/inbox");
  return { ok: true };
}

/** Vlaječka na celé vlákno (všechny zprávy, které vidím). */
export async function setThreadFlagAction(threadId: string, flagged: boolean): Promise<Result & { flaggedBy?: string }> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, error: access.error };
  const v = await visibleThreadEmails(threadId);
  if (!v) return { ok: false, error: NOT_FOUND };
  const on = flagged === true;
  const { error } = await (await db())
    .from("emails")
    .update({ flagged: on, flagged_by: on ? access.user.id : null, flagged_at: on ? new Date().toISOString() : null })
    .in("id", v.rows.map((r) => r.id));
  if (error) return { ok: false, error: error.message };
  await logAudit({ action: on ? "email_flagged" : "email_unflagged", entity: "emails", entityId: v.rows[0].id, diff: { threadId, flagged: on, count: v.rows.length }, actor: userActor(access.user) });
  revalidatePath("/inbox");
  return { ok: true, flaggedBy: on ? access.user.fullName : undefined };
}

/** Ruční priorita vlákna 1 (nejvyšší) – 5; null = zpět na prioritu z AI / pravidel. */
export async function setThreadPriorityAction(threadId: string, priority: number | null): Promise<Result> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, error: access.error };
  const p = priority === null ? null : Math.trunc(Number(priority));
  if (p !== null && !(p >= 1 && p <= 5)) return { ok: false, error: "Priorita musí být 1 (nejvyšší) až 5." };
  const v = await visibleThreadEmails(threadId);
  if (!v) return { ok: false, error: NOT_FOUND };
  const { error } = await (await db())
    .from("emails")
    .update({ manual_priority: p, priority_set_by: p === null ? null : access.user.id, priority_set_at: p === null ? null : new Date().toISOString() })
    .in("id", v.rows.map((r) => r.id));
  if (error) return { ok: false, error: error.message };
  await logAudit({ action: "email_priority_set", entity: "emails", entityId: v.rows[0].id, diff: { threadId, priority: p }, actor: userActor(access.user) });
  revalidatePath("/inbox");
  return { ok: true };
}

export interface ShareCandidate {
  id: string;
  name: string;
  email: string;
  role: string;
}

/** Kolegové, kterým jde vlákno předat (aktivní účty s poštou, bez mě). */
export async function shareCandidatesAction(): Promise<{ ok: boolean; error?: string; users?: ShareCandidate[] }> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, error: access.error };
  const { data, error } = await (await db()).from("profiles").select("id, full_name, email, role, active").neq("id", access.user.id).order("full_name");
  if (error) return { ok: false, error: error.message };
  const users = ((data ?? []) as { id: string; full_name: string | null; email: string | null; role: string; active: boolean | null }[])
    .filter((u) => u.active !== false)
    .map((u) => ({ id: u.id, name: (u.full_name ?? "").trim() || u.email || "?", email: u.email ?? "", role: u.role }));
  return { ok: true, users };
}

/**
 * „Předat kolegovi": vlákno + krátká poznámka jednomu či více kolegům. Uvidí celé vlákno ve své
 * Přijaté poště („Od <kdo>: poznámka") s odznakem nepřečtených.
 */
export async function shareThreadAction(threadId: string, userIds: string[], note: string): Promise<Result & { shared?: number }> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, error: access.error };
  const ids = [...new Set((Array.isArray(userIds) ? userIds : []).filter(isUuidLike))].filter((id) => id !== access.user.id).slice(0, 20);
  if (!ids.length) return { ok: false, error: "Vyber aspoň jednoho kolegu." };
  const text = typeof note === "string" ? note.trim().slice(0, 1000) : "";
  const v = await visibleThreadEmails(threadId);
  if (!v) return { ok: false, error: NOT_FOUND };
  const c = await db();
  const { data: people } = await c.from("profiles").select("id, active").in("id", ids);
  const ok = ((people ?? []) as { id: string; active: boolean | null }[]).filter((p) => p.active !== false).map((p) => p.id);
  if (!ok.length) return { ok: false, error: "Kolega nenalezen (nebo nemá aktivní účet)." };
  // kotva = poslední příchozí zpráva (jinak poslední); příjemce uvidí zprávy vlákna z JEJÍ schránky
  const anchorRow = [...v.rows].reverse().find((r) => r.direction === "in") ?? v.rows[v.rows.length - 1];
  const anchor = anchorRow.id;
  const { error } = await c.from("email_shares").insert(
    ok.map((to) => ({ email_id: anchor, thread_id: threadId, mailbox_id: anchorRow.mailbox_id, shared_by: access.user.id, shared_with: to, note: text || null })),
  );
  if (error) return { ok: false, error: error.message };
  await logAudit({ action: "email_shared", entity: "emails", entityId: anchor, diff: { threadId, to: ok, note: text || null }, actor: userActor(access.user) });
  revalidatePath("/inbox");
  return { ok: true, shared: ok.length };
}

/** AI roztřídí vlákno na požádání (starší pošta stažená s pravidly). */
export async function runAiOnThreadAction(threadId: string): Promise<Result & { done?: number }> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, error: access.error };
  const v = await visibleThreadEmails(threadId);
  if (!v) return { ok: false, error: NOT_FOUND };
  const ids = v.rows.filter((r) => r.direction === "in").map((r) => r.id).slice(-10);
  if (!ids.length) return { ok: false, error: "Ve vlákně není příchozí e-mail." };
  const r = await aiCategorizeStored(ids, { ownerId: v.rows[0].owner_id ?? access.user.id });
  if (r.error) return { ok: false, error: r.error };
  await logAudit({ action: "email_ai_on_demand", entity: "emails", entityId: ids[0], diff: { threadId, done: r.done }, actor: userActor(access.user) });
  revalidatePath("/inbox");
  return { ok: true, done: r.done };
}
