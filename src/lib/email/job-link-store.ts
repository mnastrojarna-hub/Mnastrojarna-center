import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { aiActor, userActor, type ActorContext } from "@/lib/supabase/actor-headers";
import { getModuleMode } from "@/lib/automation";
import { getSetting } from "@/lib/settings";
import { loadEmailAttachment } from "@/lib/email/attachments";
import { attachmentIssuer } from "@/lib/email/visibility";
import {
  categoryAfterLink, decideMatch, extractOurNumbers, extractWordNumbers, hasStrongSignal, isSupplierInvoiceMail, matchTokens, normToken,
  ownTextOf, pickLatestCommunication, threadConflict, weakenNumberSignals, CLOSED_JOB_STAGES, FALLBACK_SUGGEST_SCORE, LINK_SOURCE_LABEL, SIGNAL_LABEL,
  type CandidateRow, type MatchSignal, type OwnText, type ScoredCandidate,
} from "@/lib/email/job-match";
import {
  FIELD_LABEL, ITEM_FIELDS, NOTE_LINE_FIELDS, SPEC_GROUP_OF_FIELD, changeHolds, cleanMailText, drawingFileKey, drawingNumberFromFilename,
  extractInstructions, insteadText, isNoiseOnly, isMailChangeField, itemPatchFor, mailDateLabel, mailNoteLine, noteWithoutLine, oldValueMatches,
  sourcesObject, targetItems, type DrawingValues, type ItemState, type MailInstruction,
} from "@/lib/email/job-instructions";
import { createSupplierInvoiceFromFile } from "@/lib/supplier-invoices/service";
import { extractMailChanges, pickJobForEmail } from "@/lib/ai/mail-job";
import { registerJobFileCore } from "@/lib/jobs/job-files-store";
import { kickInBackground } from "@/lib/anonymize/queue";
import { guessFileKind, JOB_FILE_MAX_BYTES } from "@/lib/jobs/file-kinds";
import { jobFilePath } from "@/lib/jobs/mapping";
import type { JobsDb } from "@/lib/jobs/events";
import type { EmailCategory } from "@/lib/supabase/database.types";

/**
 * Pošta B — serverová vrstva přiřazení e-mailu k zakázce (vše servisním klíčem; oprávnění hlídá
 * volající akce, automatika běží při stahování pošty):
 *  - processEmailForJobs: signály → přiřadit celé vlákno (✨ AI) / návrh „Patří k Z-…?" / AI pro zbytek,
 *  - linkThread / unlinkThread: přiřazení platí pro celé vlákno, s autorem a zdrojem,
 *  - extractAndApply: technické a obchodní změny z e-mailu → historie zakázky „Z e-mailu od …: …",
 *    pokyn zákazníka do položky (nadřazeno výkresu, vrátit jedním ťuknutím), návrh štítku / poznámky,
 *  - copyEmailAttachmentsToJob: přílohy do dokumentů zakázky jednou (duplicita podle obsahu, nová
 *    revize výkresu = nová verze dokumentu); faktura dodavatele → Faktury dodavatelů (nikdy job_files),
 *  - undo / apply / dismiss změny z e-mailu (vrátit jde jen nejnovější změna pole položky).
 * Režimy automatiky: mail_job_link (jisté přiřazení hned / vše jen jako návrh) a mail_job_changes (pokyn
 * zákazníka hned do položky / jen návrh). Položky mění automaticky jen ZÁKAZNÍK té zakázky, u otevřené
 * zakázky a u čerstvé pošty; dodavatel nikdy, neznámý odesílatel jen návrhem.
 */

type Db = SupabaseClient;

export interface MailJobActor {
  /** Klient s hlavičkami autora (AI za vlastníka schránky / přihlášený uživatel). */
  db: Db;
  actorId: string | null;
  kind: "ai" | "user" | "system";
  /** Autor pro jiné moduly (Faktury dodavatelů). */
  ctx?: ActorContext;
}

export function aiMailActor(ownerId: string | null): MailJobActor {
  const ctx: ActorContext = aiActor(ownerId, "mail-job", "email");
  return { db: createAdminClient({ actor: ctx }) as unknown as Db, actorId: ownerId, kind: "ai", ctx };
}

function actorCtx(a: MailJobActor): ActorContext {
  return a.ctx ?? (a.kind === "user" ? userActor(a.actorId ? { id: a.actorId } : null) : aiActor(a.actorId, "mail-job", "email"));
}

export interface ProcessOptions {
  /** AI smí rozhodnout nejasné případy / číst text (hlavní vypínač + klíč). */
  useAi?: boolean;
  /** Sdílený limit AI volání pro jedno stažení. */
  aiBudget?: { left: number };
  /** Epoch ms: po tomto okamžiku už žádné AI ani stahování příloh (zbytek příště / ručně). */
  stopAt?: number;
  /** AI jen nad poštou mladší než (dní). */
  recentDays?: number;
  /** Dopočet staré pošty: jen přiřazení, bez vytěžení a bez změn položek. */
  backfill?: boolean;
}

/** Stáří pošty (dní), do kterého se z ní vytěžují změny zakázky (starší jen přiřadit). */
export const MAIL_JOB_CHANGES_MAX_AGE_DAYS = 30;

export interface ProcessResult {
  linked?: { jobId: string; number: string; source: string };
  suggested?: { jobId: string; number: string };
  /** Přiřazeno vláknem, ale e-mail jmenuje i jinou zakázku → změny jen jako návrhy. */
  held?: { reason: string; jobNumber: string };
  changes: number;
  files: number;
}

interface EmailRow {
  id: string;
  thread_id: string | null;
  mailbox_id: string | null;
  owner_id: string | null;
  direction: "in" | "out";
  message_id: string | null;
  in_reply_to: string | null;
  message_refs: string[] | null;
  subject: string | null;
  body_text: string | null;
  from_name: string | null;
  from_email: string | null;
  customer_id: string | null;
  supplier_id: string | null;
  category: EmailCategory | null;
  order_id: string | null;
  received_at: string;
  job_match_at: string | null;
  job_info_at: string | null;
  job_link_source: string | null;
  has_attachments?: boolean | null;
}

const EMAIL_COLS = "id, thread_id, mailbox_id, owner_id, direction, message_id, in_reply_to, message_refs, subject, body_text, from_name, from_email, customer_id, supplier_id, category, order_id, received_at, job_match_at, job_info_at, job_link_source, has_attachments";

export const MAIL_JOB_AI_SETTING = "mail_job_ai_max_per_run";
export const DEFAULT_MAIL_JOB_AI_MAX = 15;

/** Limit AI pro jedno stažení (integration_settings mail_job_ai_max_per_run, výchozí 15). */
export async function loadMailJobAiBudget(): Promise<{ left: number }> {
  const v = await getSetting(MAIL_JOB_AI_SETTING).catch(() => undefined);
  const n = Number(v);
  return { left: v !== undefined && v !== "" && Number.isFinite(n) ? Math.min(500, Math.max(0, Math.round(n))) : DEFAULT_MAIL_JOB_AI_MAX };
}

function timeLeft(stopAt?: number): number {
  return stopAt === undefined ? Infinity : stopAt - Date.now();
}

export function isRecent(iso: string, days: number): boolean {
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t <= days * 86_400_000;
}

function who(e: Pick<EmailRow, "from_name" | "from_email">): string {
  return (e.from_name ?? "").trim() || (e.from_email ?? "").trim() || "odesílatele";
}

export type MailParty = "customer" | "supplier" | "other";

/**
 * Kdo píše vzhledem k zakázce: zákazník TÉ zakázky (jen ten mění položky), dodavatel (známý dodavatel
 * nebo přiřazeno přes naši objednávku / dodavatele), jinak neznámý (jen návrhy).
 */
export function partyOf(
  e: Pick<EmailRow, "customer_id" | "supplier_id"> & { job_link_source?: string | null },
  job: { customer_id: string | null } | null,
): MailParty {
  if (e.customer_id && job?.customer_id && e.customer_id === job.customer_id) return "customer";
  if (e.supplier_id || e.job_link_source === "po_number" || e.job_link_source === "supplier") return "supplier";
  return "other";
}

async function jobEvent(a: MailJobActor, row: { jobId: string; type: string; message: string; data: Record<string, unknown> }): Promise<string | null> {
  const { data, error } = await a.db.from("job_events").insert({
    job_id: row.jobId, type: row.type, message: row.message.slice(0, 2000), data: row.data,
    actor_id: a.actorId, actor_kind: a.kind, via: a.kind === "user" ? "rucne" : "email", agent: a.kind === "ai" ? "mail-job" : null,
  }).select("id").maybeSingle();
  if (error) console.error(`[mail-job] Zápis historie selhal: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}

async function loadEmail(db: Db, emailId: string): Promise<EmailRow | null> {
  const { data } = await db.from("emails").select(EMAIL_COLS).eq("id", emailId).maybeSingle();
  return (data as EmailRow | null) ?? null;
}

type JobBrief = { id: string; number: string; title: string | null; customer_id: string | null; merged_into_id: string | null; status: string | null };

async function jobBrief(db: Db, jobId: string): Promise<JobBrief | null> {
  const { data } = await db.from("orders").select("id, number, title, customer_id, merged_into_id, status").eq("id", jobId).maybeSingle();
  return (data as JobBrief | null) ?? null;
}

/** Uzavřená / sloučená zakázka: pošta se nepřiřazuje automaticky a nemění položky. */
export function isClosedJob(j: Pick<JobBrief, "status" | "merged_into_id"> | null): boolean {
  return Boolean(j && (j.merged_into_id || (j.status && CLOSED_JOB_STAGES.includes(j.status))));
}

// ── Přiřazení vlákna ────────────────────────────────────────

export interface LinkInput {
  email: Pick<EmailRow, "id" | "thread_id" | "subject" | "direction" | "category" | "supplier_id" | "customer_id" | "from_name" | "from_email">;
  jobId: string;
  source: string;
  confidence: number | null;
  /** Silný signál (vlákno, odpověď, naše číslo) — kategorie poptávka / nabídka → K zakázce. */
  strong: boolean;
  reasons?: string[];
}

/**
 * Přiřadí vlákno k zakázce: e-maily vlákna bez zakázky dostanou zakázku (s autorem a zdrojem), e-mail
 * kategorii „K zakázce" (je-li to komunikace), čekající návrhy vlákna skončí, do historie jedna událost.
 */
export async function linkThread(a: MailJobActor, input: LinkInput): Promise<{ ok: boolean; linked: number; error?: string }> {
  const { db } = a;
  const job = await jobBrief(db, input.jobId);
  if (!job) return { ok: false, linked: 0, error: "Zakázka nenalezena." };
  const now = new Date().toISOString();
  // už přiřazená pošta vlákna stejného směru (další odpověď ve vlákně = žádná nová událost v historii;
  // první odpověď zákazníka na naši odeslanou zprávu ano)
  let already = 0;
  if (input.email.thread_id) {
    const { count } = await db.from("emails").select("id", { count: "exact", head: true })
      .eq("thread_id", input.email.thread_id).eq("order_id", job.id).eq("direction", input.email.direction);
    already = count ?? 0;
  }
  const patch = {
    order_id: job.id, job_link_source: input.source, job_link_confidence: input.confidence, job_link_actor: a.kind,
    job_linked_at: now, job_linked_by: a.actorId,
  };
  // zprávy vlákna s otevřenou otázkou „Patří k jiné zakázce?" (odpověď jmenuje jinou zakázku) automatika
  // nepřiřadí ani jejich otázku nezavře — rozhodne člověk (Ano / Ne / Změnit)
  let held: string[] = [];
  if (a.kind !== "user" && input.email.thread_id) {
    const { data: pend } = await db.from("email_job_suggestions").select("email_id")
      .eq("thread_id", input.email.thread_id).eq("status", "pending").neq("job_id", job.id).not("thread_job_id", "is", null).not("email_id", "is", null);
    held = ((pend ?? []) as { email_id: string }[]).map((r) => r.email_id).filter((id) => id !== input.email.id);
  }
  let q = db.from("emails").update(patch).is("order_id", null);
  q = input.email.thread_id ? q.eq("thread_id", input.email.thread_id) : q.eq("id", input.email.id);
  if (held.length) q = q.not("id", "in", `(${held.join(",")})`);
  const { data: rows, error } = await q.select("id, direction, category, supplier_id, customer_id");
  if (error) return { ok: false, linked: 0, error: error.message };
  const linked = (rows ?? []) as { id: string; direction: "in" | "out"; category: EmailCategory | null; supplier_id: string | null; customer_id: string | null }[];
  // kategorie: komunikace k zakázce (u každé nově přiřazené příchozí zprávy vlákna)
  for (const r of linked) {
    const next = categoryAfterLink(r.category, { direction: r.direction, strong: input.strong || r.id !== input.email.id, fromSupplier: Boolean(r.supplier_id && !r.customer_id) });
    if (next && next !== r.category) await db.from("emails").update({ category: next }).eq("id", r.id);
  }
  if (input.email.thread_id) {
    let sq = db.from("email_job_suggestions").update({ status: "superseded", resolved_at: now, resolved_by: a.kind === "user" ? a.actorId : null })
      .eq("thread_id", input.email.thread_id).eq("status", "pending").neq("job_id", job.id);
    if (held.length) sq = sq.or(`email_id.is.null,email_id.not.in.(${held.join(",")})`);
    await sq;
    await db.from("email_job_suggestions").update({ status: "accepted", resolved_at: now, resolved_by: a.kind === "user" ? a.actorId : null })
      .eq("thread_id", input.email.thread_id).eq("status", "pending").eq("job_id", job.id);
  }
  if (linked.length && (already === 0 || a.kind === "user")) {
    const subject = (input.email.subject ?? "").trim() || "(bez předmětu)";
    const how = a.kind === "user" ? "" : ` automaticky (${LINK_SOURCE_LABEL[input.source] ?? input.source})`;
    await jobEvent(a, {
      jobId: job.id, type: "email",
      message: `${input.email.direction === "out" ? "Odeslaný e-mail" : `E-mail od ${who(input.email)}`} „${subject.slice(0, 200)}“ přiřazen k zakázce${how}`,
      data: {
        emailId: input.email.id, threadId: input.email.thread_id, action: "linked", source: input.source,
        confidence: input.confidence, messages: linked.length, ...(input.reasons?.length ? { reasons: input.reasons.slice(0, 4) } : {}),
      },
    });
  }
  return { ok: true, linked: linked.length };
}

/** Odpojí vlákno od zakázky (zprávy vlákna přiřazené k ní); návrh na tutéž zakázku už nevznikne. */
export async function unlinkThread(a: MailJobActor, threadId: string, jobId: string, subject: string): Promise<{ ok: boolean; unlinked: number; error?: string }> {
  const { db } = a;
  const { data, error } = await db.from("emails").update({
    order_id: null, job_link_source: null, job_link_confidence: null, job_link_actor: null, job_linked_at: null, job_linked_by: null,
  }).eq("thread_id", threadId).eq("order_id", jobId).select("id, category");
  if (error) return { ok: false, unlinked: 0, error: error.message };
  const rows = (data ?? []) as { id: string; category: string | null }[];
  // „K zakázce" bez zakázky → Ostatní (kategorii lze opravit ručně)
  const kz = rows.filter((r) => r.category === "k_zakazce").map((r) => r.id);
  if (kz.length) await db.from("emails").update({ category: "ostatni" }).in("id", kz);
  // následky špatného přiřazení: propsané změny vrátit (nejnovější první), návrhy a záznamy zahodit
  let undone = 0;
  let kept = 0;
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    const { data: ch } = await db.from("job_mail_changes").select("id, status, kind").eq("job_id", jobId).in("email_id", ids).order("created_at", { ascending: false });
    for (const c of (ch ?? []) as { id: string; status: string; kind: string }[]) {
      if (c.kind === "change" && c.status === "applied") {
        const r = await undoMailChange(a, c.id, { reason: "wrong_job" });
        if (r.ok) undone++;
        else kept++;
      }
    }
    await db.from("job_mail_changes").update({ status: "dismissed", undone_at: new Date().toISOString(), undone_by: a.actorId })
      .eq("job_id", jobId).in("email_id", ids).in("status", ["suggested", "info", "superseded"]);
  }
  const { data: box } = await db.from("emails").select("mailbox_id").eq("thread_id", threadId).limit(1).maybeSingle();
  await db.from("email_job_suggestions").upsert({
    thread_id: threadId, mailbox_id: (box as { mailbox_id: string | null } | null)?.mailbox_id ?? null, job_id: jobId,
    status: "rejected", resolved_at: new Date().toISOString(), resolved_by: a.actorId, score: 0,
  }, { onConflict: "thread_id,job_id" });
  if (rows.length) {
    await jobEvent(a, {
      jobId, type: "email",
      message: `E-mail „${(subject || "(bez předmětu)").slice(0, 200)}“ odpojen od zakázky${undone ? ` — vráceno ${undone} změn(a) z e-mailu` : ""}${kept ? `, ${kept} se mezitím změnila (zkontroluj položky)` : ""}`,
      data: { threadId, action: "unlinked", messages: rows.length, undone, kept },
    });
  }
  return { ok: true, unlinked: rows.length };
}

/** threadJobId = zakázka vlákna, když odpověď ve vlákně jmenuje jinou zakázku (otázka k jedné zprávě). */
async function suggest(db: Db, e: EmailRow, c: ScoredCandidate, source: "rules" | "ai", threadJobId: string | null = null): Promise<boolean> {
  if (!e.thread_id) return false;
  const { data: existing } = await db.from("email_job_suggestions").select("id, status").eq("thread_id", e.thread_id).eq("job_id", c.jobId).maybeSingle();
  const ex = existing as { id: string; status: string } | null;
  // nová otázka k jedné zprávě vlákna: dřívější vyřízený návrh téže zakázky se znovu otevře — i dřívější
  // „Ne" (platilo pro starší zprávy; tahle zakázku jmenuje výslovně naším číslem)
  if (ex && threadJobId && ex.status !== "pending") {
    const { error } = await db.from("email_job_suggestions").update({
      status: "pending", email_id: e.id, thread_job_id: threadJobId, score: c.score, reasons: c.reasons.slice(0, 5), source, resolved_at: null, resolved_by: null,
    }).eq("id", ex.id);
    return !error;
  }
  if (ex) return ex.status === "pending";
  const { error } = await db.from("email_job_suggestions").insert({
    thread_id: e.thread_id, mailbox_id: e.mailbox_id, email_id: e.id, job_id: c.jobId, score: c.score, reasons: c.reasons.slice(0, 5), source,
    ...(threadJobId ? { thread_job_id: threadJobId } : {}),
  });
  if (error && !/duplicate key/i.test(error.message)) console.error(`[mail-job] Návrh přiřazení selhal: ${error.message}`);
  return !error;
}

async function attachmentNames(db: Db, emailId: string): Promise<string[]> {
  const { data } = await db.from("email_attachments").select("filename").eq("email_id", emailId);
  return ((data ?? []) as { filename: string | null }[]).map((r) => r.filename ?? "").filter(Boolean);
}

function msgIds(e: Pick<EmailRow, "in_reply_to" | "message_refs">): string[] {
  const out = new Set<string>();
  for (const v of [e.in_reply_to, ...(e.message_refs ?? [])]) {
    const s = (v ?? "").trim();
    if (!s) continue;
    out.add(s);
    out.add(s.replace(/^<|>$/g, ""));
    out.add(s.startsWith("<") ? s : `<${s}>`);
  }
  return [...out].slice(0, 60);
}

/**
 * Kandidáti zakázky pro e-mail (RPC mail_job_candidates). Čísla a tokeny z předmětu, VYČIŠTĚNÉHO textu
 * (bez citované historie a podpisu) a názvů příloh; čísla jen ze slovního tvaru nebo jen z citace jsou slabá.
 */
export async function candidatesFor(db: Db, e: EmailRow): Promise<CandidateRow[]> {
  return (await candidatesWithOwnText(db, e)).rows.filter((r) => !r.rejected);
}

/**
 * „Zpracovat objednávku" (Pošta E): ke které zakázce e-mail patří — stejná pravidla jako automatické
 * párování (decideMatch: naše čísla, objednávka zákazníka, vlákno; nikdy jen podle předmětu).
 */
export async function matchDecisionForEmail(db: Db, emailId: string): Promise<{ email: EmailRow; decision: ReturnType<typeof decideMatch> } | null> {
  const e = await loadEmail(db, emailId);
  if (!e) return null;
  const rows = await candidatesFor(db, e);
  return { email: e, decision: decideMatch(rows, { category: e.category, direction: e.direction, customerId: e.customer_id, supplierId: e.supplier_id }) };
}

/**
 * Kandidáti + vlastní text e-mailu (vyčištěné tělo a přílohy; naše čísla z předmětu zvlášť — pro konflikt
 * s vláknem). Vrací i zakázky, které u vlákna někdo zamítl (rejected) — k rozhodnutí se nepoužijí, jen ke konfliktu.
 */
async function candidatesWithOwnText(db: Db, e: EmailRow): Promise<{ rows: CandidateRow[]; own: OwnText }> {
  const files = await attachmentNames(db, e.id);
  const clean = cleanMailText(e.body_text);
  const own = ownTextOf(clean, files, e.subject);
  const strong = extractOurNumbers(e.subject, clean, ...files);
  const weak = [...extractWordNumbers(e.subject, clean, ...files), ...extractOurNumbers(e.body_text)];
  const numbers = [...new Set([...strong, ...weak])].slice(0, 40);
  const tokens = matchTokens([e.subject, clean], files);
  const { data, error } = await db.rpc("mail_job_candidates", {
    p_email: e.id, p_thread: e.thread_id, p_msg_ids: msgIds(e), p_numbers: numbers, p_norms: tokens,
    p_customer: e.direction === "in" ? e.customer_id : null, p_supplier: e.direction === "in" ? e.supplier_id : null,
  });
  if (error) {
    console.error(`[mail-job] Kandidáti zakázky selhali: ${error.message}`);
    return { rows: [], own };
  }
  return { rows: weakenNumberSignals((data ?? []) as CandidateRow[], strong), own };
}

/** Poslední přiřazená pošta zakázek (nejasný návrh = zakázka s nejčerstvější komunikací). */
async function lastMailAt(db: Db, jobIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const rows = await Promise.all([...jobIds].slice(0, 8).map(async (id) => {
    const { data } = await db.from("emails").select("received_at").eq("order_id", id).order("received_at", { ascending: false }).limit(1).maybeSingle();
    return [id, (data as { received_at: string } | null)?.received_at ?? null] as const;
  }));
  for (const [id, at] of rows) if (at) out.set(id, at);
  return out;
}

async function aiDecide(db: Db, e: EmailRow, cands: ScoredCandidate[], opts: ProcessOptions): Promise<{ candidate: ScoredCandidate; confidence: number; reason: string } | null> {
  if (!opts.useAi || !opts.aiBudget || opts.aiBudget.left <= 0 || timeLeft(opts.stopAt) < 25_000) return null;
  if (!isRecent(e.received_at, opts.recentDays ?? 30)) return null;
  const list = cands.slice(0, 6);
  if (!list.length) return null;
  opts.aiBudget.left--;
  try {
    const ids = list.map((c) => c.jobId);
    const [{ data: jobs }, { data: items }] = await Promise.all([
      db.from("orders").select("id, status, customer:customers!customer_id(name)").in("id", ids),
      db.from("order_items").select("order_id, drawing_number, name").in("order_id", ids).limit(60),
    ]);
    const jobMap = new Map(((jobs ?? []) as { id: string; status: string; customer: { name: string } | { name: string }[] | null }[]).map((j) => [j.id, j]));
    const r = await pickJobForEmail({
      from: `${e.from_name ?? ""} <${e.from_email ?? ""}>`, subject: e.subject ?? "", body: cleanMailText(e.body_text).slice(0, 5000),
      candidates: list.map((c) => {
        const j = jobMap.get(c.jobId);
        const cust = Array.isArray(j?.customer) ? j?.customer[0] : j?.customer;
        return {
          number: c.number, title: c.title, customer: cust?.name ?? null, stage: j?.status ?? null,
          items: ((items ?? []) as { order_id: string; drawing_number: string | null; name: string | null }[])
            .filter((i) => i.order_id === c.jobId).map((i) => [i.drawing_number, i.name].filter(Boolean).join(" ")).filter(Boolean),
        };
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r?.number) return null;
    const hit = list.find((c) => c.number === r.number);
    return hit ? { candidate: hit, confidence: r.confidence, reason: r.reason } : null;
  } catch (err) {
    console.error(`[mail-job] AI výběr zakázky selhal: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Hlavní krok pro jeden e-mail (po uložení při stahování, dopočet, ručně): přiřadit / navrhnout,
 * u příchozí pošty přiřazené k zakázce vytěžit změny a uložit přílohy. Idempotentní (job_match_at,
 * job_info_at, jedinečné záznamy změn a návrhů).
 */
export async function processEmailForJobs(a: MailJobActor, emailId: string, opts: ProcessOptions = {}): Promise<ProcessResult> {
  const out: ProcessResult = { changes: 0, files: 0 };
  const { db } = a;
  const e = await loadEmail(db, emailId);
  if (!e) return out;
  const now = new Date().toISOString();

  // B5: faktura dodavatele z e-mailu → Faktury dodavatelů (i bez zakázky; rozdělí je ten modul)
  if (e.direction === "in" && !opts.backfill && isSupplierInvoiceMail(e) && e.has_attachments !== false && timeLeft(opts.stopAt) > 20_000) {
    out.files += (await supplierInvoicesFromMail(a, e)).created;
  }

  if (e.order_id) {
    // už přiřazený (odesláno ze zakázky, založeno z e-mailu, ručně): vlákno + kategorie + vytěžení
    if (e.thread_id && !e.job_match_at) {
      await linkThread(a, { email: e, jobId: e.order_id, source: e.job_link_source ?? (e.direction === "out" ? "sent" : "manual"), confidence: null, strong: true });
    }
    if (!e.job_match_at) await db.from("emails").update({ job_match_at: now }).eq("id", e.id);
    if (e.direction === "in" && !opts.backfill) {
      const r = await extractAndApply(a, e.id, e.order_id, opts);
      out.changes += r.changes;
      if (timeLeft(opts.stopAt) > 20_000) out.files += (await copyEmailAttachmentsToJob(a, e.id, e.order_id)).copied;
    } else if (opts.backfill && !e.job_info_at) {
      await db.from("emails").update({ job_info_at: now }).eq("id", e.id);
    }
    return out;
  }
  if (e.category === "spam") {
    await db.from("emails").update({ job_match_at: now }).eq("id", e.id);
    return out;
  }

  const found = await candidatesWithOwnText(db, e);
  let rows = found.rows.filter((r) => !r.rejected);
  // nová poptávka / objednávka bez hlaviček odpovědi, kterou vlákna Pošty A spojila se starou poštou jen
  // podle předmětu („Poptávka" ↔ „Re: Poptávka" k jiné zakázce) a je novější než celé vlákno → vlastní
  // vlákno (jinak by se v poště ukazovala pod starou zakázkou)
  if (await splitSubjectThread(db, e, rows)) rows = rows.filter((r) => r.signal !== "thread_subject");
  const ctx = { category: e.category, direction: e.direction, customerId: e.customer_id, supplierId: e.supplier_id };
  let decision = decideMatch(rows, ctx);
  let source: string = decision.kind === "link" || decision.kind === "suggest" ? decision.source : "";
  let confidence = decision.kind === "link" || decision.kind === "suggest" ? decision.candidate.score : 0;
  let viaAi = false;
  /** Proč změny z e-mailu jen jako návrh, i když zakázka je jistá (vlákno), a zakázka, kterou e-mail jmenuje. */
  let hold: { reason: string; jobNumber: string } | null = null;
  let threadJobId: string | null = null;

  // odpověď ve vlákně zakázky, jejíž VLASTNÍ text (nebo předmět změněný na naše číslo jiné zakázky) jmenuje
  // jinou otevřenou zakázku (Z-…, NAB-…, OV-…, objednávka zákazníka, výkres): silné jméno jiné zakázky → nepřiřazovat vláknem, jen „Patří k …?";
  // jinak vlákno platí, ale pokyny z e-mailu jen jako návrhy (špatná změna na špatné zakázce = špatné díly)
  if (decision.kind === "link" && e.direction === "in") {
    const cf = threadConflict(decision.candidate, [...rows, ...found.rows.filter((r) => r.rejected)], found.own, ctx);
    if (cf?.strong) {
      const thread = decision.candidate;
      const cand = { ...cf.other, reasons: [`zpráva ve vlákně ${thread.number} jmenuje ${cf.other.number}`, ...cf.other.reasons].slice(0, 5) };
      decision = { kind: "suggest", candidate: cand, source: cf.signals[0] ?? "job_number", candidates: decision.candidates };
      source = decision.source;
      confidence = cand.score;
      threadJobId = thread.jobId;
    } else if (cf) {
      hold = { reason: "other_job", jobNumber: cf.other.number };
    }
  }

  // AI jen pro nejasný zbytek (víc kandidátů / jen slabý signál) — u nové poptávky nikdy
  const newBusiness = e.direction === "in" && (e.category === "poptavka" || e.category === "objednavka");
  if (e.direction === "in" && !opts.backfill && (decision.kind === "ambiguous" || (decision.kind === "suggest" && !hasStrongSignal(decision.candidate) && !newBusiness))) {
    const ai = await aiDecide(db, e, decision.candidates, opts);
    if (ai) {
      viaAi = true;
      source = "ai";
      confidence = Math.round(ai.confidence * 1000) / 1000;
      const cand = { ...ai.candidate, reasons: [...ai.candidate.reasons, ai.reason ? `AI: ${ai.reason}` : "AI"].filter(Boolean) };
      decision = ai.confidence >= 0.8
        ? { kind: "link", candidate: cand, source: ai.candidate.signals[0] ?? "company", candidates: decision.candidates }
        : ai.confidence >= 0.5 ? { kind: "suggest", candidate: cand, source: ai.candidate.signals[0] ?? "company", candidates: decision.candidates } : decision;
    }
  }

  // nejasné a AI nerozhodla (vypnutá / limit / nejistá): návrh nejpravděpodobnější zakázky — jedno ťuknutí
  if (decision.kind === "ambiguous" && e.direction === "in" && !newBusiness && decision.candidates[0]?.score >= FALLBACK_SUGGEST_SCORE) {
    // stejně jisté zakázky → ta s nejčerstvější komunikací (ne nejvyšší číslo)
    const tied = decision.candidates.filter((c) => Math.abs(c.score - decision.candidates[0].score) < 0.001).map((c) => c.jobId);
    const top = tied.length > 1 ? pickLatestCommunication(decision.candidates, await lastMailAt(db, tied)) : decision.candidates[0];
    decision = { kind: "suggest", candidate: top, source: top.signals[0] ?? "company", candidates: decision.candidates };
  }

  // uzavřená / sloučená zakázka (i když ji vybrala AI): nikdy automaticky, jen návrh
  if (decision.kind === "link" && !decision.candidate.open) {
    decision = e.direction === "in"
      ? { kind: "suggest", candidate: decision.candidate, source: decision.source, candidates: decision.candidates }
      : { kind: "none", candidates: decision.candidates };
  }
  // režim automatiky: „se schválením" = i jisté přiřazení jen jako návrh
  if (decision.kind === "link" && (await getModuleMode("mail_job_link")) !== "full") {
    decision = { kind: "suggest", candidate: decision.candidate, source: decision.source, candidates: decision.candidates };
  }

  if (decision.kind === "link") {
    const strong = hasStrongSignal(decision.candidate);
    const r = await linkThread(a, { email: e, jobId: decision.candidate.jobId, source: viaAi ? "ai" : source, confidence, strong, reasons: decision.candidate.reasons });
    if (r.ok) {
      out.linked = { jobId: decision.candidate.jobId, number: decision.candidate.number, source: viaAi ? "ai" : source };
      if (hold) out.held = hold;
      if (e.direction === "in" && !opts.backfill) {
        const x = await extractAndApply(a, e.id, decision.candidate.jobId, { ...opts, ...(hold ? { hold } : {}) });
        out.changes += x.changes;
        if (timeLeft(opts.stopAt) > 20_000) out.files += (await copyEmailAttachmentsToJob(a, e.id, decision.candidate.jobId)).copied;
      }
    }
  } else if (decision.kind === "suggest" && e.direction === "in") {
    if (await suggest(db, e, decision.candidate, viaAi ? "ai" : "rules", threadJobId)) out.suggested = { jobId: decision.candidate.jobId, number: decision.candidate.number };
  }
  await db.from("emails").update({ job_match_at: now, ...(opts.backfill && !e.job_info_at ? { job_info_at: now } : {}) }).eq("id", e.id);
  return out;
}

const REPLY_SUBJECT_RE = /^\s*(re|odp|aw|fw|fwd|wg|tr|sv|vs)\s*(\[\d+\])?\s*:/i;

async function splitSubjectThread(db: Db, e: EmailRow, rows: readonly CandidateRow[]): Promise<boolean> {
  const newBusiness = e.direction === "in" && (e.category === "poptavka" || e.category === "objednavka");
  if (!newBusiness || !e.thread_id || msgIds(e).length || REPLY_SUBJECT_RE.test(e.subject ?? "")) return false;
  if (!rows.some((r) => r.signal === "thread_subject")) return false;
  // původní zpráva stažená až po odpovědi (Stáhnout vše od nejnovější) do vlákna patří
  const { count } = await db.from("emails").select("id", { count: "exact", head: true }).eq("thread_id", e.thread_id).neq("id", e.id).gt("received_at", e.received_at);
  if ((count ?? 0) > 0) return false;
  const tid = `m:${e.mailbox_id ?? "-"}:${(e.message_id ?? "").trim() || e.id}`;
  if (tid === e.thread_id) return false;
  const { error } = await db.from("emails").update({ thread_id: tid }).eq("id", e.id);
  if (error) {
    console.error(`[mail-job] Oddělení vlákna selhalo: ${error.message}`);
    return false;
  }
  e.thread_id = tid;
  return true;
}

/** Signál → popisek (pro chip návrhu). */
export function signalLabel(s: string): string {
  return SIGNAL_LABEL[s as MatchSignal] ?? LINK_SOURCE_LABEL[s] ?? s;
}

// ── Technické informace z e-mailu → historie, položky, štítky ──

const ITEM_COLS = "id, drawing_number, name, quantity, unit_price, material, material_designation, revision, note, heat_status, heat_treatment, heat_steps, hardness, surface_status, surface_treatment, surface_steps, spec_sources, drawing_id, position";

type ItemRow = ItemState & { drawing_id: string | null; position: number | null; unit_price: number | null };

async function loadItems(db: Db, jobId: string): Promise<{ items: ItemRow[]; drawings: Map<string, DrawingValues> }> {
  const { data } = await db.from("order_items").select(ITEM_COLS).eq("order_id", jobId).order("position", { ascending: true });
  const items = (data ?? []) as ItemRow[];
  const ids = [...new Set(items.map((i) => i.drawing_id).filter((x): x is string => Boolean(x)))];
  const drawings = new Map<string, DrawingValues>();
  if (ids.length) {
    const { data: dr } = await db.from("drawings").select("id, quantity, material, revision, heat_status, heat_treatment, hardness, surface_status, surface_treatment").in("id", ids);
    for (const d of (dr ?? []) as (DrawingValues & { id: string })[]) drawings.set(d.id, d);
  }
  return { items, drawings };
}

/** Štítek z pokynu (kalení, zinkování, bez PÚ…) — návrh do štítků zakázky. */
function tagFor(i: MailInstruction): string | null {
  if (i.field === "heat" && i.heat) return i.heat.status === "bez" ? "bez TZ" : i.heat.label;
  if (i.field === "surface" && i.surface) return i.surface.status === "bez" ? "bez PÚ" : i.surface.label;
  if (i.field === "cancel") return "storno";
  return null;
}

const NOTE_FIELDS = new Set(["address", "packaging", "deadline", "terms"]);

async function recomputeValue(db: Db, jobId: string): Promise<void> {
  const { data } = await db.from("order_items").select("quantity, unit_price").eq("order_id", jobId);
  const rows = (data ?? []) as { quantity: number | string | null; unit_price: number | string | null }[];
  if (!rows.some((r) => r.unit_price !== null)) return;
  const value = Math.round(rows.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unit_price) || 0), 0) * 100) / 100;
  await db.from("orders").update({ value }).eq("id", jobId);
}

export interface ApplyResult { changes: number; applied: number; suggested: number }

export interface ExtractOptions extends ProcessOptions {
  /** Znovu vytěžit i už vytěžený e-mail (ruční přiřazení k jiné zakázce) — jedinečný index nic nezdvojí. */
  force?: boolean;
  /** I starší pošta (zakázka založená z toho e-mailu — jeho text je zadání). */
  allowOld?: boolean;
  /** Odesílatel je zákazník zakázky (zakázka založená z jeho e-mailu). */
  party?: MailParty;
  mode?: "full" | "approval";
  /** Změny jen jako návrhy (e-mail ve vlákně jmenuje i jinou zakázku). */
  hold?: { reason: string; jobNumber: string };
}

/** spec_sources po změně: aktuální zdroje + jen skupina pole změny (ostatní skupiny nepřepisovat). */
function sourcesWith(current: unknown, field: string, from: unknown): Record<string, string> | null {
  const group = isMailChangeField(field) ? SPEC_GROUP_OF_FIELD[field] : undefined;
  if (!group) return null;
  const out = sourcesObject(current);
  const v = sourcesObject(from)[group];
  if (v) out[group] = v;
  else delete out[group];
  return out;
}

function withoutSources(o: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const { spec_sources: _drop, ...rest } = o ?? {};
  void _drop;
  return rest;
}

/** Starší propsané změny téhož pole položky přebila novější → superseded (vrátit jde jen nejnovější). */
async function supersedeOlder(db: Db, c: { id: string; job_id: string; order_item_id: string | null; field: string }): Promise<void> {
  if (!c.order_item_id) return;
  await db.from("job_mail_changes").update({ status: "superseded" })
    .eq("job_id", c.job_id).eq("order_item_id", c.order_item_id).eq("field", c.field).eq("kind", "change").eq("status", "applied").neq("id", c.id);
}

/**
 * Vytěží z e-mailu technické / obchodní změny a zapíše je k zakázce. Pokyn ZÁKAZNÍKA TÉ ZAKÁZKY k položce
 * je nadřazený výkresu: v režimu plné automatiky (výchozí) se hned propíše do položky (s předchozí a
 * výkresovou hodnotou pro zobrazení a vrácení), v režimu se schválením jen jako návrh. Jen návrh i u
 * neznámého odesílatele, uzavřené zakázky a víc položek bez upřesnění; dodavatel položky nemění (jen
 * historie). Nákupní ceny / podmínky dodavatele i neznámého odesílatele jsou citlivé (jen s maržemi).
 * Pošta starší než 30 dní (stažená dodatečně) zakázku nemění.
 */
export async function extractAndApply(a: MailJobActor, emailId: string, jobId: string, opts: ExtractOptions = {}): Promise<ApplyResult> {
  const res: ApplyResult = { changes: 0, applied: 0, suggested: 0 };
  const { db } = a;
  const e = await loadEmail(db, emailId);
  if (!e || e.direction !== "in" || (e.job_info_at && !opts.force)) return res;
  const markDone = () => db.from("emails").update({ job_info_at: new Date().toISOString() }).eq("id", e.id);
  // stará pošta (stáhnout vše, první stažení) nesmí přepsat běžící zakázku
  if (!opts.allowOld && !isRecent(e.received_at, MAIL_JOB_CHANGES_MAX_AGE_DAYS)) {
    await markDone();
    return res;
  }
  const text = cleanMailText(e.body_text);
  if (!text || isNoiseOnly(text)) {
    await markDone();
    return res;
  }
  const job = await jobBrief(db, jobId);
  if (!job) return res;
  const closed = isClosedJob(job);
  const { items, drawings } = await loadItems(db, jobId);
  const drawingNumbers = items.map((i) => i.drawing_number).filter((x): x is string => Boolean(x));
  const party: MailParty = opts.party ?? partyOf(e, job);
  let list: MailInstruction[] | null = null;
  let aiUsed = false;
  if (opts.useAi && opts.aiBudget && opts.aiBudget.left > 0 && timeLeft(opts.stopAt) > 25_000 && isRecent(e.received_at, opts.recentDays ?? 30)) {
    opts.aiBudget.left--;
    try {
      list = await extractMailChanges({
        from: who(e), party: party === "other" ? "customer" : party, subject: e.subject ?? "", body: text,
        items: items.map((i) => ({ drawingNumber: i.drawing_number ?? null, name: i.name ?? null, quantity: Number(i.quantity) || null, material: i.material ?? null })),
        signal: AbortSignal.timeout(20_000),
      });
      aiUsed = list !== null;
    } catch (err) {
      console.error(`[mail-job] AI vytěžení selhalo: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!list) list = extractInstructions(text, { drawingNumbers, cleaned: true, now: new Date(e.received_at) });
  if (!list.length) {
    await markDone();
    return res;
  }
  const mode = opts.mode ?? ((await getModuleMode("mail_job_changes")) === "full" ? "full" : "approval");
  const dateLabel = mailDateLabel(e.received_at);
  const whoText = who(e);
  const fromText = party === "supplier" ? `dodavatele ${whoText}` : whoText;
  let quantityChanged = false;

  const insertChange = async (row: Record<string, unknown>): Promise<string | null> => {
    const { data, error } = await db.from("job_mail_changes").insert({
      job_id: jobId, email_id: e.id, party, from_name: whoText, mail_at: e.received_at, source: aiUsed ? "ai" : "rules", ...row,
    }).select("id").maybeSingle();
    if (error) {
      if (!/duplicate key/i.test(error.message)) console.error(`[mail-job] Zápis změny z e-mailu selhal: ${error.message}`);
      return null;
    }
    return (data as { id: string } | null)?.id ?? null;
  };

  for (const i of list) {
    // ceny / podmínky od dodavatele i neznámého odesílatele = nákupní / neověřené → jen s právem na marže
    const sensitive = party !== "customer" && (i.field === "price" || i.field === "terms");
    const targets = party !== "supplier" ? targetItems(i, items) : { items: [] as ItemRow[], ambiguous: false };
    const itemTargets = ITEM_FIELDS.includes(i.field) ? targets.items : [];
    let made = false;
    for (const item of itemTargets) {
      const dv = item.drawing_id ? drawings.get(item.drawing_id) ?? null : null;
      const p = itemPatchFor(i, item, dv, dateLabel);
      if (!p) continue;
      // „X místo Y": automaticky jen když Y je opravdu na položce (jinak e-mail mohl myslet jinou položku / zakázku)
      const mismatch = oldValueMatches(i, item, dv) === false;
      const holdReason = opts.hold ? opts.hold.reason : mismatch ? "mismatch" : null;
      const apply = mode === "full" && !targets.ambiguous && party === "customer" && !closed && !holdReason;
      const dn = item.drawing_number ? ` (${item.drawing_number})` : "";
      const id = await insertChange({
        order_item_id: item.id, kind: "change", field: i.field, summary: i.summary, value_new: p.valueNew, value_prev: p.valuePrev,
        drawing_value: p.drawingValue, patch: p.patch, prev: p.prev, quote: i.quote, status: apply ? "applied" : "suggested",
        value_mail_old: i.field === "quantity" && i.quantityFrom ? `${i.quantityFrom} ks` : i.oldValue ?? null,
        hold_reason: holdReason, hold_job_number: opts.hold?.jobNumber ?? null,
        ...(apply ? { applied_at: new Date().toISOString(), applied_by: a.actorId, applied_kind: a.kind } : {}),
      });
      if (!id) continue;
      made = true;
      res.changes++;
      let applied = false;
      if (apply) {
        const { error } = await db.from("order_items").update(p.patch).eq("id", item.id).eq("order_id", jobId);
        if (error) {
          await db.from("job_mail_changes").update({ status: "suggested", applied_at: null, applied_by: null, applied_kind: null }).eq("id", id);
          console.error(`[mail-job] Změna položky selhala: ${error.message}`);
        } else {
          applied = true;
          res.applied++;
          Object.assign(item, p.patch);
          if (i.field === "quantity") quantityChanged = true;
          await supersedeOlder(db, { id, job_id: jobId, order_item_id: item.id, field: i.field });
        }
      }
      if (!applied) res.suggested++;
      const why = applied ? " — pokyn zákazníka, nadřazeno výkresu"
        : opts.hold ? ` — návrh (e-mail jmenuje i zakázku ${opts.hold.jobNumber}), potvrď v záložce Komunikace`
          : mismatch && party === "customer" && !closed ? ` — návrh (${insteadText(i, p.valuePrev)}), potvrď v záložce Komunikace`
        : party === "other" ? " — návrh (odesílatel není zákazník zakázky), potvrď v záložce Komunikace"
          : closed ? " — návrh (zakázka je uzavřená), potvrď v záložce Komunikace"
            : " — návrh, potvrď v záložce Komunikace";
      const evId = await jobEvent(a, {
        jobId, type: "email",
        message: `Z e-mailu od ${fromText}: ${i.summary}${dn}${why}`,
        data: {
          emailId: e.id, threadId: e.thread_id, action: "mail_change", changeId: id, field: i.field, itemId: item.id,
          applied, valuePrev: p.valuePrev, valueNew: p.valueNew, drawingValue: p.drawingValue, party,
          ...(holdReason ? { hold: holdReason } : {}),
        },
      });
      if (evId) await db.from("job_mail_changes").update({ event_id: evId }).eq("id", id);
    }
    if (!made && !(itemTargets.length && ITEM_FIELDS.includes(i.field) && party !== "supplier")) {
      // informace k zakázce (bez změny položky): jen historie (+ návrh poznámky)
      const id = await insertChange({ kind: "info", field: i.field, summary: i.summary, value_new: i.value, quote: i.quote, status: "info", sensitive });
      if (id) {
        res.changes++;
        const evId = await jobEvent(a, {
          jobId, type: "email",
          message: (sensitive ? `Z e-mailu od ${fromText}: ${FIELD_LABEL[i.field]} (podrobnosti vidí obchodník a admin)` : `Z e-mailu od ${fromText}: ${i.summary}`)
            + (opts.hold ? ` (e-mail jmenuje i zakázku ${opts.hold.jobNumber})` : ""),
          data: { emailId: e.id, threadId: e.thread_id, action: "mail_info", changeId: id, field: i.field, sensitive },
        });
        if (evId) await db.from("job_mail_changes").update({ event_id: evId }).eq("id", id);
        if (!sensitive && NOTE_FIELDS.has(i.field)) {
          await insertChange({ kind: "note", field: i.field, summary: `${i.summary} (z e-mailu ${dateLabel})`, value_new: `${i.summary} (z e-mailu od ${whoText}, ${dateLabel})`, quote: i.quote, status: "suggested" });
        }
      }
    }
    const tag = party !== "supplier" ? tagFor(i) : null;
    if (tag) await insertChange({ kind: "tag", field: i.field, summary: `Štítek „${tag}“`, value_new: tag, quote: i.quote, status: "suggested" });
  }
  if (quantityChanged) await recomputeValue(db, jobId);
  await markDone();
  return res;
}

type ChangeRow = {
  id: string; job_id: string; order_item_id: string | null; status: string; patch: Record<string, unknown> | null; prev: Record<string, unknown> | null;
  summary: string; value_prev: string | null; value_new: string | null; from_name: string | null; kind: string; field: string;
};
const CHANGE_COLS = "id, job_id, order_item_id, status, patch, prev, summary, value_prev, value_new, from_name, kind, field";

/**
 * Vrátí změnu položky z e-mailu (předchozí hodnoty) — jedním ťuknutím, s historií. Jen když položka
 * pořád nese hodnotu té změny (jinak by vrácení přepsalo novější změnu); pak se znovu uplatní starší
 * přebitá změna téhož pole, pokud její hodnota právě platí.
 */
export async function undoMailChange(a: MailJobActor, changeId: string, opts: { reason?: "wrong_job" } = {}): Promise<{ ok: boolean; error?: string; jobId?: string }> {
  const { db } = a;
  const { data } = await db.from("job_mail_changes").select(CHANGE_COLS).eq("id", changeId).maybeSingle();
  const c = data as ChangeRow | null;
  if (!c) return { ok: false, error: "Změna nenalezena." };
  if (c.status !== "applied" || c.kind !== "change") return { ok: false, error: "Tuto změnu nejde vrátit." };
  if (c.order_item_id && c.prev && Object.keys(c.prev).length) {
    const keys = Object.keys(withoutSources(c.patch));
    const { data: cur } = await db.from("order_items").select([...keys, "spec_sources"].join(", ")).eq("id", c.order_item_id).maybeSingle();
    const row = cur as Record<string, unknown> | null;
    if (row && !changeHolds(c.field, c.patch, c.prev, row)) {
      return { ok: false, error: "Položka se mezitím změnila — vrať nejdřív novější změnu (nebo uprav položku ručně)." };
    }
    const update: Record<string, unknown> = withoutSources(c.prev);
    // pokyn zapsaný řádkem do poznámky: pryč jen ten řádek (ruční řádky přidané mezitím zůstanou)
    const line = (NOTE_LINE_FIELDS as readonly string[]).includes(c.field) ? mailNoteLine(c.patch, c.prev) : null;
    if (line && row) update.note = noteWithoutLine(typeof row.note === "string" ? row.note : null, line);
    const src = sourcesWith(row?.spec_sources, c.field, c.prev.spec_sources);
    if (src) update.spec_sources = src;
    const { error } = await db.from("order_items").update(update).eq("id", c.order_item_id).eq("order_id", c.job_id);
    if (error) return { ok: false, error: error.message };
  }
  const { error } = await db.from("job_mail_changes").update({ status: "undone", undone_at: new Date().toISOString(), undone_by: a.actorId }).eq("id", c.id).eq("status", "applied");
  if (error) return { ok: false, error: error.message };
  // starší přebitá změna téhož pole platí znovu (její hodnota je teď v položce)
  if (c.order_item_id) {
    const { data: older } = await db.from("job_mail_changes").select("id, patch, prev").eq("job_id", c.job_id).eq("order_item_id", c.order_item_id)
      .eq("field", c.field).eq("kind", "change").eq("status", "superseded").order("created_at", { ascending: false }).limit(1);
    const o = ((older ?? []) as { id: string; patch: Record<string, unknown> | null; prev: Record<string, unknown> | null }[])[0];
    if (o) {
      const keys = Object.keys(withoutSources(o.patch));
      const { data: cur } = await db.from("order_items").select(keys.join(", ") || "id").eq("id", c.order_item_id).maybeSingle();
      const row = cur as Record<string, unknown> | null;
      if (row && changeHolds(c.field, o.patch, o.prev, row)) await db.from("job_mail_changes").update({ status: "applied" }).eq("id", o.id);
    }
  }
  if ("quantity" in (c.prev ?? {})) await recomputeValue(db, c.job_id);
  await jobEvent(a, {
    jobId: c.job_id, type: "email",
    message: opts.reason === "wrong_job"
      ? `Vráceno — e-mail patřil k jiné zakázce: ${c.summary} (z e-mailu od ${c.from_name ?? "odesílatele"}) — zpět ${c.value_prev ?? "—"}`
      : `Vráceno: ${c.summary} (z e-mailu od ${c.from_name ?? "odesílatele"}) — zpět ${c.value_prev ?? "—"}`,
    data: { action: "mail_change_undone", changeId: c.id, itemId: c.order_item_id, ...(opts.reason ? { reason: opts.reason } : {}) },
  });
  return { ok: true, jobId: c.job_id };
}

/** Potvrdí návrh z e-mailu: změnu položky propíše, štítek / poznámku přidá k zakázce. */
export async function applyMailChange(a: MailJobActor, changeId: string): Promise<{ ok: boolean; error?: string; jobId?: string }> {
  const { db } = a;
  const { data } = await db.from("job_mail_changes").select(CHANGE_COLS).eq("id", changeId).maybeSingle();
  const c = data as ChangeRow | null;
  if (!c) return { ok: false, error: "Návrh nenalezen." };
  // znovu propsat jde i vrácenou změnu a změnu nahrazenou ruční úpravou položky
  if (c.status !== "suggested" && !((c.status === "undone" || c.status === "replaced") && c.kind === "change")) return { ok: false, error: "Návrh už je vyřízený." };
  const now = new Date().toISOString();
  if (c.kind === "change") {
    if (!c.order_item_id || !c.patch) return { ok: false, error: "Položka už neexistuje." };
    const keys = Object.keys(withoutSources(c.patch));
    const { data: cur } = await db.from("order_items").select([...keys, "spec_sources"].join(", ")).eq("id", c.order_item_id).maybeSingle();
    if (!cur) return { ok: false, error: "Položka už neexistuje." };
    const row = cur as unknown as Record<string, unknown>;
    const update: Record<string, unknown> = withoutSources(c.patch);
    // pokyn do poznámky: řádek se připíše k AKTUÁLNÍ poznámce (ne přepsat poznámku stavem z doby e-mailu)
    const line = (NOTE_LINE_FIELDS as readonly string[]).includes(c.field) ? mailNoteLine(c.patch, c.prev) : null;
    if (line) {
      const curNote = typeof row.note === "string" ? row.note.trim() : "";
      update.note = curNote.split("\n").includes(line) ? curNote : curNote ? `${curNote}\n${line}` : line;
    }
    const src = sourcesWith(row.spec_sources, c.field, c.patch.spec_sources);
    if (src) update.spec_sources = src;
    const prev: Record<string, unknown> = Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));
    if (src) prev.spec_sources = sourcesObject(row.spec_sources);
    const { error } = await db.from("order_items").update(update).eq("id", c.order_item_id).eq("order_id", c.job_id);
    if (error) return { ok: false, error: error.message };
    await db.from("job_mail_changes").update({
      status: "applied", prev, applied_at: now, applied_by: a.actorId, applied_kind: a.kind, undone_at: null, undone_by: null,
      ...(line ? { patch: { ...c.patch, note: update.note } } : {}),
    }).eq("id", c.id);
    await supersedeOlder(db, c);
    if ("quantity" in c.patch) await recomputeValue(db, c.job_id);
    await jobEvent(a, {
      jobId: c.job_id, type: "email", message: `Potvrzeno z e-mailu od ${c.from_name ?? "odesílatele"}: ${c.summary} — pokyn zákazníka, nadřazeno výkresu`,
      data: { action: "mail_change_applied", changeId: c.id, itemId: c.order_item_id, field: c.field },
    });
  } else if (c.kind === "tag" || c.kind === "note") {
    const { data: job } = await db.from("orders").select("tags, note").eq("id", c.job_id).maybeSingle();
    const j = (job ?? {}) as { tags: string[] | null; note: string | null };
    const value = (c.value_new ?? "").trim();
    if (!value) return { ok: false, error: "Prázdný návrh." };
    const patch = c.kind === "tag"
      ? { tags: [...new Set([...(j.tags ?? []), value.slice(0, 40)])].slice(0, 30) }
      : { note: [j.note?.trim(), value].filter(Boolean).join("\n").slice(0, 10000) };
    const { error } = await db.from("orders").update(patch).eq("id", c.job_id);
    if (error) return { ok: false, error: error.message };
    await db.from("job_mail_changes").update({ status: "applied", applied_at: now, applied_by: a.actorId, applied_kind: a.kind }).eq("id", c.id);
    await jobEvent(a, {
      jobId: c.job_id, type: "field",
      message: c.kind === "tag" ? `Štítky: přidán „${value}“ (z e-mailu)` : `Interní poznámka: doplněno z e-mailu — ${value}`,
      data: {
        changes: [{
          field: c.kind === "tag" ? "tags" : "note", label: c.kind === "tag" ? "Štítky" : "Interní poznámka",
          from: c.kind === "tag" ? (j.tags ?? []) : j.note ?? null, to: c.kind === "tag" ? (patch as { tags: string[] }).tags : (patch as { note: string }).note,
          fromText: c.kind === "tag" ? (j.tags ?? []).join(", ") || "—" : j.note || "—",
          toText: c.kind === "tag" ? (patch as { tags: string[] }).tags.join(", ") : (patch as { note: string }).note,
        }],
        mailChangeId: c.id,
      },
    });
  } else return { ok: false, error: "Tento záznam nejde potvrdit." };
  return { ok: true, jobId: c.job_id };
}

export async function dismissMailChange(a: MailJobActor, changeId: string): Promise<{ ok: boolean; error?: string; jobId?: string }> {
  const { data, error } = await a.db.from("job_mail_changes").update({ status: "dismissed", undone_at: new Date().toISOString(), undone_by: a.actorId })
    .eq("id", changeId).eq("status", "suggested").select("job_id").maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Návrh už je vyřízený." };
  return { ok: true, jobId: (data as { job_id: string }).job_id };
}

const ITEM_VALUE_COLS = "id, quantity, material, material_designation, revision, note, heat_status, heat_treatment, heat_steps, hardness, surface_status, surface_treatment, surface_steps";

/**
 * Po ruční úpravě položek (Položky → Uložit, jiná úprava položky): propsané změny z e-mailu, jejichž
 * hodnota už na položce není (nebo položka zmizela), = „nahrazeno ruční úpravou" — bez odznaku a bez
 * „Vrátit", které by jen selhalo. Vrací počet takto označených změn.
 */
export async function supersedeEditedMailChanges(db: Db, jobId: string, actorId: string | null): Promise<number> {
  try {
    const { data } = await db.from("job_mail_changes").select("id, field, order_item_id, patch, prev")
      .eq("job_id", jobId).eq("kind", "change").eq("status", "applied").limit(500);
    const list = (data ?? []) as { id: string; field: string; order_item_id: string | null; patch: Record<string, unknown> | null; prev: Record<string, unknown> | null }[];
    if (!list.length) return 0;
    const ids = [...new Set(list.map((c) => c.order_item_id).filter((x): x is string => Boolean(x)))];
    const { data: items } = ids.length ? await db.from("order_items").select(ITEM_VALUE_COLS).in("id", ids) : { data: [] };
    const byId = new Map(((items ?? []) as Record<string, unknown>[]).map((r) => [String(r.id), r]));
    const gone = list.filter((c) => c.patch && !changeHolds(c.field, c.patch, c.prev, c.order_item_id ? byId.get(c.order_item_id) : null)).map((c) => c.id);
    if (!gone.length) return 0;
    const { data: upd } = await db.from("job_mail_changes").update({ status: "replaced", undone_at: new Date().toISOString(), undone_by: actorId })
      .in("id", gone).eq("status", "applied").select("id");
    return (upd ?? []).length;
  } catch (err) {
    console.error(`[mail-job] Označení nahrazených změn selhalo: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

// ── Faktura dodavatele z e-mailu → Faktury dodavatelů (B5) ──

const INVOICE_FILE_RE = /\.(pdf|png|jpe?g|webp|gif|tiff?)$/i;

function isInvoiceFile(att: { filename: string | null; mime_type: string | null; size_bytes: number | null }): boolean {
  const mime = (att.mime_type ?? "").toLowerCase();
  if (mime.startsWith("image/") && (att.size_bytes ?? 0) > 0 && (att.size_bytes ?? 0) < MIN_INLINE_IMAGE) return false; // logo / podpis
  return mime === "application/pdf" || mime.startsWith("image/") || INVOICE_FILE_RE.test(att.filename ?? "");
}

/**
 * Přílohy faktury dodavatele (PDF / obrázek) → createSupplierInvoiceFromFile (bucket supplier-invoices,
 * vidí zatím jen super admin; AI čtení a rozdělení na zakázky podle režimu modulu supplier_invoice).
 * Idempotentní (captureKey „email:<příloha>"). Do historie zakázky jen „faktura předána" — bez částky a čísla.
 */
export async function supplierInvoicesFromMail(
  a: MailJobActor,
  e: Pick<EmailRow, "id" | "supplier_id" | "order_id" | "from_name" | "from_email" | "thread_id">,
  onlyIds?: readonly string[],
): Promise<{ created: number; existing: number }> {
  const out = { created: 0, existing: 0 };
  try {
    const { data } = await a.db.from("email_attachments").select("id, filename, mime_type, size_bytes").eq("email_id", e.id);
    const atts = ((data ?? []) as { id: string; filename: string | null; mime_type: string | null; size_bytes: number | null }[])
      .filter((x) => (!onlyIds || onlyIds.includes(x.id)) && isInvoiceFile(x)).slice(0, 10);
    for (const att of atts) {
      if (att.size_bytes && att.size_bytes > 50 * 1024 * 1024) continue;
      const loaded = await loadEmailAttachment(att.id);
      if (!loaded.ok) continue;
      const r = await createSupplierInvoiceFromFile(
        { bytes: new Uint8Array(loaded.file.content), filename: (att.filename ?? "").trim() || "faktura.pdf", mimeType: att.mime_type ?? loaded.file.contentType },
        "email", actorCtx(a),
        { captureKey: `email:${att.id}`, emailId: e.id, supplierId: e.supplier_id, process: "background", note: "Z e-mailu (Pošta)" },
      );
      if (!r.ok) {
        console.error(`[mail-job] Faktura dodavatele z e-mailu se neuložila: ${r.error}`);
        continue;
      }
      if (r.created) out.created++;
      else out.existing++;
    }
    // do historie zakázky jednou (i když se faktura uložila dřív, než se e-mail přiřadil)
    const logged = e.order_id && (out.created || out.existing)
      ? ((await a.db.from("job_events").select("id", { count: "exact", head: true }).eq("job_id", e.order_id)
        .eq("data->>action", "supplier_invoice").eq("data->>emailId", e.id)).count ?? 0) > 0
      : true;
    if (!logged && e.order_id) {
      await jobEvent(a, {
        jobId: e.order_id, type: "email",
        message: `Z e-mailu od dodavatele ${who(e)}: faktura dodavatele předána do Faktur dodavatelů (zpracuje super admin)`,
        data: { emailId: e.id, threadId: e.thread_id, action: "supplier_invoice", count: out.created + out.existing },
      });
    }
  } catch (err) {
    console.error(`[mail-job] Faktura dodavatele z e-mailu selhala: ${err instanceof Error ? err.message : String(err)}`);
  }
  return out;
}

// ── Přílohy → dokumenty zakázky (jednou) ────────────────────

const MIN_INLINE_IMAGE = 15 * 1024;

/**
 * Přílohy e-mailu do dokumentů zakázky: každá jen jednou (email_attachments.job_file_id), stejný obsah
 * jako už uložený dokument = žádná kopie, výkres se stejným číslem a jiným obsahem = nová verze
 * (revize) původního dokumentu. Drobné vložené obrázky (podpisy, loga) se neukládají.
 */
export async function copyEmailAttachmentsToJob(a: MailJobActor, emailId: string, jobId: string): Promise<{ copied: number; revisions: number; duplicates: number }> {
  const out = { copied: 0, revisions: 0, duplicates: 0 };
  const { db } = a;
  try {
    const [{ data: atts }, { data: em }, { data: files }, { data: items }] = await Promise.all([
      db.from("email_attachments").select("id, filename, mime_type, size_bytes, job_file_id").eq("email_id", emailId),
      db.from("emails").select("id, category, supplier_id, customer_id, subject, job_link_source, order_id, from_name, from_email, thread_id").eq("id", emailId).maybeSingle(),
      db.from("job_files").select("id, filename, kind, content_sha256, archived, version").eq("job_id", jobId),
      db.from("order_items").select("drawing_number").eq("order_id", jobId),
    ]);
    const list = (atts ?? []) as { id: string; filename: string | null; mime_type: string | null; size_bytes: number | null; job_file_id: string | null }[];
    if (!list.length) return out;
    const jobFiles = (files ?? []) as { id: string; filename: string | null; kind: string; content_sha256: string | null; archived: boolean; version: number | null }[];
    const fileIds = new Set(jobFiles.map((f) => f.id));
    const itemDrawings = new Set(((items ?? []) as { drawing_number: string | null }[]).map((i) => normToken(i.drawing_number)).filter(Boolean) as string[]);
    const mail = em as {
      id: string; category: EmailCategory | null; supplier_id: string | null; customer_id: string | null; subject: string | null;
      job_link_source: string | null; order_id: string | null; from_name: string | null; from_email: string | null; thread_id: string | null;
    } | null;
    // B5: faktura dodavatele nikdy do dokumentů zakázky (vidí ji zatím jen super admin) → Faktury dodavatelů
    if (mail && isSupplierInvoiceMail(mail)) {
      await supplierInvoicesFromMail(a, { ...mail, order_id: mail.order_id ?? jobId });
      return out;
    }
    // přiřazeno přes naši objednávku / dodavatele = doklad dodavatele (cenový → zaměstnanec ho uvidí zamčený)
    const viaSupplier = mail?.job_link_source === "po_number" || mail?.job_link_source === "supplier";
    const issuer = mail ? (attachmentIssuer({ category: mail.category, supplierId: mail.supplier_id, customerId: mail.customer_id }) ?? (viaSupplier ? "dodavatel" : null)) : null;
    const notes: string[] = [];
    const invoiceIds: string[] = [];
    const anonIds: string[] = [];
    for (const att of list.slice(0, 20)) {
      if (att.job_file_id && fileIds.has(att.job_file_id)) continue; // už uloženo
      const name = (att.filename ?? "").trim() || "priloha";
      // faktura od dodavatele (podle názvu) i v jiném e-mailu → Faktury dodavatelů, ne dokumenty
      if (issuer === "dodavatel" && guessFileKind(name, att.mime_type ?? "") === "faktura") {
        invoiceIds.push(att.id);
        continue;
      }
      if ((att.mime_type ?? "").startsWith("image/") && (att.size_bytes ?? 0) > 0 && (att.size_bytes ?? 0) < MIN_INLINE_IMAGE) continue;
      if (att.size_bytes && att.size_bytes > JOB_FILE_MAX_BYTES) continue;
      const loaded = await loadEmailAttachment(att.id);
      if (!loaded.ok) continue;
      const content = loaded.file.content;
      if (content.length > JOB_FILE_MAX_BYTES) continue;
      if ((att.mime_type ?? loaded.file.contentType).startsWith("image/") && content.length < MIN_INLINE_IMAGE) continue;
      const sha = createHash("sha256").update(content).digest("hex");
      const dup = jobFiles.find((f) => f.content_sha256 === sha);
      if (dup) {
        await db.from("email_attachments").update({ job_file_id: dup.id }).eq("id", att.id);
        out.duplicates++;
        continue;
      }
      const key = drawingFileKey(name);
      const drawingNo = drawingNumberFromFilename(name);
      const isDrawing = Boolean(key && (itemDrawings.has(key) || /\.(dxf|dwg|step|stp)$/i.test(name) || jobFiles.some((f) => f.kind === "vykres" && drawingFileKey(f.filename) === key)));
      const prevRev = key ? jobFiles.filter((f) => !f.archived && drawingFileKey(f.filename) === key).sort((x, y) => (y.version ?? 1) - (x.version ?? 1))[0] ?? null : null;
      const kind = isDrawing ? (guessFileKind(name, loaded.file.contentType) === "model_3d" ? "model_3d" : "vykres") : guessFileKind(name, loaded.file.contentType);
      const path = jobFilePath(jobId, randomUUID(), name);
      const { error: upErr } = await db.storage.from("job-files").upload(path, content, { contentType: loaded.file.contentType || "application/octet-stream", upsert: false });
      if (upErr) continue;
      const reg = await registerJobFileCore(db as unknown as JobsDb, a.actorId as string, {
        jobId, path, filename: name, mimeType: loaded.file.contentType, size: content.length, kind,
        contentSha256: sha, origin: "email", ...(issuer ? { issuer } : {}), note: `Příloha e-mailu${mail?.subject ? ` „${mail.subject.slice(0, 120)}“` : ""}`,
        ...(prevRev ? { replaceFileId: prevRev.id } : {}), silent: true,
      });
      if (!reg.ok || !reg.file) {
        await db.storage.from("job-files").remove([path]);
        continue;
      }
      await db.from("email_attachments").update({ job_file_id: reg.file.id }).eq("id", att.id);
      if (reg.file.anon?.status === "pending") anonIds.push(reg.file.id);
      jobFiles.push({ id: reg.file.id, filename: name, kind, content_sha256: sha, archived: false, version: reg.file.version ?? 1 });
      fileIds.add(reg.file.id);
      out.copied++;
      if (prevRev) {
        out.revisions++;
        notes.push(`${drawingNo ?? name} jako nová revize (v${reg.file.version ?? (prevRev.version ?? 1) + 1})`);
      } else notes.push(name);
    }
    // výkresy z přílohy → anonymizace hned: šťouchnutí po odpovědi (stahování pošty v routě je navíc zpracuje
    // přímo — /api/emails/sync, plánovač; jinak je dokončí otevření zakázky / Poptávek)
    if (anonIds.length) kickInBackground({ table: "job_files", ids: anonIds });
    if (invoiceIds.length && mail) await supplierInvoicesFromMail(a, { ...mail, order_id: mail.order_id ?? jobId }, invoiceIds);
    if (out.copied) {
      await jobEvent(a, {
        jobId, type: "file",
        message: `Z e-mailu uloženo do dokumentů: ${notes.slice(0, 4).join(", ")}${notes.length > 4 ? "…" : ""}`,
        data: { emailId, count: out.copied, revisions: out.revisions, duplicates: out.duplicates },
      });
    }
  } catch (err) {
    console.error(`[mail-job] Uložení příloh selhalo: ${err instanceof Error ? err.message : String(err)}`);
  }
  return out;
}

// ── Dopočet staré pošty (jednorázově, idempotentní) ─────────

/**
 * Přiřadí už staženou poštu (job_match_at null) — jen pravidla, bez AI, bez vytěžení a bez změn
 * položek (stará pošta nesmí přepsat zakázky). Opakované spuštění nic nezdvojí.
 */
export async function backfillMailJobs(opts: { mailboxIds?: string[] | null; limit?: number; stopAt?: number } = {}): Promise<{ processed: number; linked: number; suggested: number; remaining: number }> {
  const out = { processed: 0, linked: 0, suggested: 0, remaining: 0 };
  if (!isSupabaseConfigured() || !hasServiceKey()) return out;
  const base = createAdminClient() as unknown as Db;
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  let q = base.from("emails").select("id, owner_id, mailbox_id").is("job_match_at", null).order("received_at", { ascending: true }).limit(limit);
  if (opts.mailboxIds) q = opts.mailboxIds.length ? q.in("mailbox_id", opts.mailboxIds) : q.eq("id", "00000000-0000-0000-0000-000000000000");
  const { data } = await q;
  const actors = new Map<string, MailJobActor>();
  for (const r of (data ?? []) as { id: string; owner_id: string | null; mailbox_id: string | null }[]) {
    if (opts.stopAt !== undefined && Date.now() > opts.stopAt) break;
    const k = r.owner_id ?? "-";
    const a = actors.get(k) ?? aiMailActor(r.owner_id);
    actors.set(k, a);
    try {
      const res = await processEmailForJobs(a, r.id, { backfill: true });
      out.processed++;
      if (res.linked) out.linked++;
      if (res.suggested) out.suggested++;
    } catch (err) {
      console.error(`[mail-job] Dopočet selhal: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  let cq = base.from("emails").select("id", { count: "exact", head: true }).is("job_match_at", null);
  if (opts.mailboxIds) cq = opts.mailboxIds.length ? cq.in("mailbox_id", opts.mailboxIds) : cq.eq("id", "00000000-0000-0000-0000-000000000000");
  const { count } = await cq;
  out.remaining = count ?? 0;
  return out;
}
