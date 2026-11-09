import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { aiActor, withChangeNote } from "@/lib/supabase/actor-headers";
import { getModuleMode } from "@/lib/automation";
import { getCorrections, buildCorrectionsPrompt } from "@/lib/ai/corrections";
import { isJobStage, stageMeta } from "@/lib/jobs/stages";
import { CLAIM_REASONS, isClaimReason } from "@/lib/jobs/flow-exceptions";
import { isLostReason, lostReasonLabel, lostReasonsFor } from "@/lib/jobs/flow-status";
import type { ClaimReason, JobStage, LostReason } from "@/lib/supabase/database.types";
import {
  MAIL_STAGE_META, combineSignals, correctableKinds, decideStageAction, detectStageSignalRules, isMailStageKind, parseAiJobSignal,
  proposalTitle, stageFit, type MailStageKind, type StageJobFacts,
} from "@/lib/email/mail-stage-signal";

/**
 * Pošta → speciální stav zakázky (majitel 9. 11.) — serverová vrstva (servisní klíč s hlavičkami autora;
 * oprávnění hlídá volající akce):
 *  - detectMailStageSignal: e-mail přiřazený k zakázce → AI (`emails.ai_job_signal`) + pravidla → signál,
 *    který sedí na stav zakázky; jednou na vlákno + zakázku + druh (job_mail_stage_signals). Režim
 *    `mail_job_stage`: plná automatika přepne sama (✨ AI (pošta)), jinak fronta ke schválení + tlačítko ve vlákně,
 *  - applyStageCore: přepnutí (reklamace, nerealizováno / zrušeno s důvodem, pozastaveno, pokračovat,
 *    reklamace vyřízena) s optimistickým zámkem, poznámkou do stavové události a událostí „Z e-mailu …",
 *  - korekce: potvrdit (s jiným druhem / důvodem), zamítnout, Vrátit (jen když se stav od té doby nezměnil),
 *    Změnit. Učení z korekcí zapisuje akce (recordCorrection, agent „mail_stage").
 */

type Db = SupabaseClient;

export const MAIL_STAGE_MODULE = "mail_job_stage";
export const MAIL_STAGE_AGENT = "mail_stage";
const NOTE_MAX = 500;

export type MailStageStatus = "pending" | "applied" | "rejected" | "undone" | "stale";

export interface MailStageRow {
  id: string;
  job_id: string;
  email_id: string | null;
  thread_key: string;
  kind: MailStageKind;
  final_kind: MailStageKind | null;
  party: string | null;
  source: string;
  confidence: number | null;
  reason: string | null;
  quote: string | null;
  lost_reason: LostReason | null;
  claim_reason: ClaimReason | null;
  from_name: string | null;
  status: MailStageStatus;
  mode: string | null;
  approval_id: string | null;
  from_stage: JobStage | null;
  to_stage: JobStage | null;
  prev: Record<string, unknown> | null;
  applied_at: string | null;
  applied_by: string | null;
  applied_kind: string | null;
  event_id: string | null;
  resolved_at: string | null;
  correction: string | null;
  created_at: string;
}

const ROW_COLS = "id, job_id, email_id, thread_key, kind, final_kind, party, source, confidence, reason, quote, lost_reason, claim_reason, from_name, status, mode, approval_id, from_stage, to_stage, prev, applied_at, applied_by, applied_kind, event_id, resolved_at, correction, created_at";

const JOB_COLS = "id, number, title, status, side_from_stage, items_count, items_delivered, claim_opened_at, claim_opened_by, claim_reason, claim_qty, claim_item_id, claim_note, claim_from_stage, claim_resolution, claim_resolution_note, claim_resolved_at, claim_resolved_by, hold_reason, merged_into_id, owner_id, customer_id, stage_changed_at, lost_reason, lost_note";
const CLAIM_FIELDS = [
  "claim_opened_at", "claim_opened_by", "claim_reason", "claim_qty", "claim_item_id", "claim_note", "claim_from_stage",
  "claim_resolution", "claim_resolution_note", "claim_resolved_at", "claim_resolved_by",
] as const;

type JobRow = Record<string, unknown> & { id: string; number: string; status: string };

/** Kdo přepíná: ✨ AI (pošta) bez účtu, nebo přihlášený uživatel (klient s jeho hlavičkami). */
export interface StageActor {
  db: Db;
  id: string | null;
  kind: "ai" | "user";
}

/** ✨ AI (pošta) — automatické přepnutí v režimu plné automatiky. */
export function aiStageActor(): StageActor {
  return { db: createAdminClient({ actor: aiActor(null, "mail-stage", "email") }) as unknown as Db, id: null, kind: "ai" };
}

export function jobFacts(j: Record<string, unknown>): StageJobFacts {
  const st = (v: unknown): JobStage | null => (isJobStage(v) ? v : null);
  return {
    stage: st(j.status) ?? "poptavka",
    sideFromStage: st(j.side_from_stage),
    itemsCount: Number(j.items_count) || 0,
    itemsDelivered: Number(j.items_delivered) || 0,
    claimOpenedAt: (j.claim_opened_at as string | null) ?? null,
    claimResolvedAt: (j.claim_resolved_at as string | null) ?? null,
    claimFromStage: st(j.claim_from_stage),
    mergedIntoId: (j.merged_into_id as string | null) ?? null,
  };
}

async function loadJob(db: Db, jobId: string): Promise<JobRow | null> {
  const { data } = await db.from("orders").select(JOB_COLS).eq("id", jobId).maybeSingle();
  return (data as JobRow | null) ?? null;
}

export async function loadStageRow(db: Db, id: string): Promise<MailStageRow | null> {
  const { data } = await db.from("job_mail_stage_signals").select(ROW_COLS).eq("id", id).maybeSingle();
  return (data as MailStageRow | null) ?? null;
}

export function threadKeyOf(e: { id: string; thread_id: string | null }): string {
  return e.thread_id || `e:${e.id}`;
}

function clean(s: unknown, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

/** Režim modulu (výchozí se schválením). */
export async function mailStageMode(): Promise<"full" | "approval"> {
  return (await getModuleMode(MAIL_STAGE_MODULE)) === "full" ? "full" : "approval";
}

/** Naučené korekce stavů z pošty → do promptu AI klasifikace pošty. */
export async function mailStageLearningPrompt(): Promise<string> {
  const rows = await getCorrections(MAIL_STAGE_AGENT, 15).catch(() => []);
  const p = buildCorrectionsPrompt(rows);
  return p ? `Signál stavu zakázky (job_signal) — ${p}` : "";
}

// ── Rozpoznání ──────────────────────────────────────────────

export interface StageEmail {
  id: string;
  thread_id: string | null;
  direction: "in" | "out";
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
  received_at?: string | null;
}

export interface DetectInput {
  email: StageEmail;
  jobId: string;
  party: "customer" | "supplier" | "other";
  /** Vyčištěný vlastní text e-mailu (bez citací a podpisu). */
  text: string;
  /** E-mail jmenuje i jinou zakázku → jen návrh. */
  hold?: boolean;
  mode?: "full" | "approval";
}

export interface DetectResult {
  signalId: string;
  kind: MailStageKind;
  status: MailStageStatus;
  applied?: boolean;
}

function who(e: Pick<StageEmail, "from_name" | "from_email">): string {
  return (e.from_name ?? "").trim() || (e.from_email ?? "").trim() || "odesílatele";
}

/**
 * Rozpozná v e-mailu přiřazeném k zakázce signál speciálního stavu a podle režimu ho použije (✨ AI (pošta))
 * nebo navrhne (fronta ke schválení + tlačítko ve vlákně). Dodavatel nic, nízká jistota nic, nesedí-li na
 * stav nic, stejné vlákno + zakázka + druh podruhé nic (ani po zamítnutí / vrácení — učení z korekce).
 */
export async function detectMailStageSignal(db: Db, input: DetectInput): Promise<DetectResult | null> {
  const e = input.email;
  if (e.direction !== "in" || input.party === "supplier") return null;
  const { data: em } = await db.from("emails").select("ai_job_signal").eq("id", e.id).maybeSingle();
  const ai = parseAiJobSignal((em as { ai_job_signal?: unknown } | null)?.ai_job_signal ?? null);
  const rules = detectStageSignalRules(input.text, e.subject);
  const sig = combineSignals(ai, rules);
  if (!sig) return null;
  const job = await loadJob(db, input.jobId);
  if (!job) return null;
  const fit = stageFit(sig.kind, jobFacts(job));
  if (!fit.ok) return null;
  const kind = fit.kind;
  const lostReason = kind === "nerealizovano" || kind === "zruseno"
    ? (sig.kind === kind && sig.lostReason && lostReasonsFor("job", kind).includes(sig.lostReason) ? sig.lostReason : fit.lostReason ?? sig.lostReason ?? "jine")
    : null;
  const mode = input.mode ?? (await mailStageMode());
  const decision = decideStageAction({ confidence: sig.confidence, party: input.party, mode, hold: input.hold, closed: fit.closed });
  if (decision === "ignore") return null;
  const threadKey = threadKeyOf(e);
  const from = who(e);
  const { data: ins, error } = await db.from("job_mail_stage_signals").insert({
    job_id: job.id, email_id: e.id, thread_key: threadKey, kind, party: input.party, source: sig.source,
    confidence: Math.round(sig.confidence * 1000) / 1000, reason: clean(sig.reason, NOTE_MAX), quote: clean(sig.quote, 400),
    lost_reason: lostReason && isLostReason(lostReason) ? lostReason : null,
    claim_reason: kind === "reklamace" ? (sig.claimReason && isClaimReason(sig.claimReason) ? sig.claimReason : "jine") : null,
    from_name: from, status: "pending", mode: decision === "auto" ? "full" : "approval",
  }).select(ROW_COLS).maybeSingle();
  if (error) {
    // stejné vlákno + zakázka + druh už rozpoznané (i zamítnuté / vrácené) → nic znovu
    if (!/duplicate key/i.test(error.message)) console.error(`[mail-stage] Zápis signálu selhal: ${error.message}`);
    return null;
  }
  const row = ins as MailStageRow;
  if (decision === "auto") {
    const r = await applyStageCore(aiStageActor(), row, {});
    if (r.ok) return { signalId: row.id, kind, status: "applied", applied: true };
    // nepovedlo se (souběh) → zůstane návrhem
    console.error(`[mail-stage] Automatické přepnutí selhalo: ${r.error}`);
  }
  // návrh: položka fronty ke schválení (vyřídí ji i tlačítko ve vlákně)
  const { data: appr, error: aErr } = await db.from("approval_queue").insert({
    type: "job_stage", title: proposalTitle(kind, from, job.number).slice(0, 300), summary: clean(sig.reason, NOTE_MAX),
    payload: { signalId: row.id, kind, reason: row.reason, jobNumber: job.number, from },
    target: job.number, ai_confidence: row.confidence, email_id: e.id, order_id: job.id, owner_id: (job.owner_id as string | null) ?? null,
  }).select("id").maybeSingle();
  if (aErr) console.error(`[mail-stage] Položka fronty selhala: ${aErr.message}`);
  if (appr) await db.from("job_mail_stage_signals").update({ approval_id: (appr as { id: string }).id }).eq("id", row.id);
  return { signalId: row.id, kind, status: "pending" };
}

// ── Přepnutí ────────────────────────────────────────────────

export interface StageTarget {
  kind?: MailStageKind;
  reason?: string | null;
  lostReason?: LostReason | null;
  claimReason?: ClaimReason | null;
}

export type StageResult = { ok: true; stage: JobStage } | { ok: false; error: string };

const CHANGED = "Stav zakázky se mezitím změnil — obnov stránku.";

function stageLabel(s: JobStage | null | undefined): string {
  return s ? stageMeta(s).label : "—";
}

async function jobEvent(a: StageActor, row: { jobId: string; message: string; data: Record<string, unknown>; type?: string }): Promise<string | null> {
  const { data, error } = await a.db.from("job_events").insert({
    job_id: row.jobId, type: row.type ?? "email", message: row.message.slice(0, 2000), data: row.data,
    actor_id: a.id, actor_kind: a.kind, via: a.kind === "ai" ? "email" : "rucne", agent: a.kind === "ai" ? "mail-stage" : null,
  }).select("id").maybeSingle();
  if (error) console.error(`[mail-stage] Zápis historie selhal: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}

/** Text důvodu (do zakázky): důvod z e-mailu / upravený člověkem, jinak popisek druhu. */
function reasonText(kind: MailStageKind, reason: string | null | undefined): string {
  return clean(reason, NOTE_MAX) ?? MAIL_STAGE_META[kind].label;
}

/**
 * Přepne zakázku podle signálu (auto i ručně). target = korekce člověka (jiný druh, důvod, důvod prohry /
 * druh reklamace). Druh musí sedět na AKTUÁLNÍ stav (jinak chyba); nerealizováno ↔ zrušeno se dorovná podle
 * toho, jestli zákazník už objednal. Před změnou se uloží, co bylo (pro Vrátit).
 */
export async function applyStageCore(a: StageActor, row: MailStageRow, target: StageTarget): Promise<StageResult> {
  if (row.status !== "pending") return { ok: false, error: "Návrh už je vyřízený — obnov stránku." };
  const job = await loadJob(a.db, row.job_id);
  if (!job || !isJobStage(job.status)) return { ok: false, error: "Zakázka nenalezena." };
  const wanted: MailStageKind = target.kind && isMailStageKind(target.kind) ? target.kind : row.kind;
  const fit = stageFit(wanted, jobFacts(job));
  if (!fit.ok) return { ok: false, error: fit.why };
  const kind = fit.kind;
  const from = job.status as JobStage;
  const reason = reasonText(kind, target.reason !== undefined ? target.reason : row.reason);
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};
  const prev: Record<string, unknown> = {};
  let note = "";
  let lost: LostReason | null = null;
  let claim: ClaimReason | null = null;

  if (kind === "reklamace") {
    claim = target.claimReason && isClaimReason(target.claimReason) ? target.claimReason : row.claim_reason && isClaimReason(row.claim_reason) ? row.claim_reason : "jine";
    for (const f of CLAIM_FIELDS) prev[f] = job[f] ?? null;
    Object.assign(patch, {
      status: "reklamace", claim_opened_at: now, claim_opened_by: a.id, claim_reason: claim, claim_qty: null, claim_item_id: null,
      claim_note: reason, claim_from_stage: from, claim_resolution: null, claim_resolution_note: null, claim_resolved_at: null, claim_resolved_by: null,
    });
    note = `reklamace — ${CLAIM_REASONS[claim]}: ${reason}`;
  } else if (kind === "nerealizovano" || kind === "zruseno") {
    const allowed = lostReasonsFor("job", kind);
    const pick = [target.lostReason, kind === row.kind ? row.lost_reason : null, fit.lostReason].find((r) => r && isLostReason(r) && allowed.includes(r));
    lost = (pick as LostReason | undefined) ?? "jine";
    patch.status = kind;
    patch.lost_reason = lost;
    patch.lost_note = reason;
    if (kind === "nerealizovano") {
      const { data: qs } = await a.db.from("quotes").select("id, status, archived").eq("job_id", job.id);
      prev.quotes = qs ?? [];
    }
    note = "";
  } else if (kind === "pozastaveno") {
    patch.status = "pozastaveno";
    patch.hold_reason = reason.slice(0, 300);
    note = `pozastaveno — ${reason}`;
  } else if (kind === "pokracovat") {
    patch.status = fit.to;
    prev.hold_reason = job.hold_reason ?? null;
    note = `pokračuje — ${reason}`;
  } else {
    // reklamace vyřízena (zákazník potvrdil)
    for (const f of CLAIM_FIELDS) prev[f] = job[f] ?? null;
    Object.assign(patch, {
      claim_resolved_at: now, claim_resolved_by: a.id, claim_resolution: (job.claim_resolution as string | null) ?? "oprava",
      claim_resolution_note: reason, claim_opened_at: job.claim_opened_at ?? now,
    });
    if (fit.to !== from) patch.status = fit.to;
    note = `reklamace vyřízena — ${reason}`;
  }

  const q = a.db.from("orders").update(patch).eq("id", job.id).eq("status", from);
  const { data: upd, error } = await withChangeNote(q, note.slice(0, NOTE_MAX) || null).select("id, status, stage_changed_at, claim_resolved_at");
  if (error) return { ok: false, error: error.message };
  const after = ((upd ?? []) as { status: JobStage; stage_changed_at: string | null; claim_resolved_at: string | null }[])[0];
  if (!after) return { ok: false, error: CHANGED };
  prev.stageChangedAt = after.stage_changed_at;
  prev.claimResolvedAt = after.claim_resolved_at;
  if (kind === "nerealizovano" && lost) {
    // zamítnuté nabídky nesou stejný důvod (jako „Zákazník neobjednal")
    await a.db.from("quotes").update({ lost_reason: lost }).eq("job_id", job.id).eq("status", "zamitnuto").is("lost_reason", null);
  }

  const label = MAIL_STAGE_META[kind].label;
  const detail = kind === "reklamace" && claim ? ` (${CLAIM_REASONS[claim]})` : lost ? ` (${lostReasonLabel(lost)})` : "";
  const how = a.kind === "ai" ? "přepnuto automaticky (AI z pošty)" : "přepnuto podle e-mailu";
  const evId = await jobEvent(a, {
    jobId: job.id,
    message: `Z e-mailu od ${row.from_name ?? "zákazníka"}: ${label}${detail} — ${reason} · ${how}: ${stageLabel(from)} → ${stageLabel(after.status)}`,
    data: {
      action: "mail_stage", signalId: row.id, emailId: row.email_id, threadId: row.thread_key.startsWith("e:") ? null : row.thread_key,
      signal: kind, fromStage: from, toStage: after.status, applied: true, auto: a.kind === "ai", reason,
      ...(lost ? { lostReason: lost } : {}), ...(claim ? { claimReason: claim } : {}),
    },
  });
  await a.db.from("job_mail_stage_signals").update({
    status: "applied", final_kind: kind, from_stage: from, to_stage: after.status, prev, reason, lost_reason: lost, claim_reason: claim,
    applied_at: now, applied_by: a.id, applied_kind: a.kind, event_id: evId, resolved_at: a.kind === "user" ? now : null, resolved_by: a.kind === "user" ? a.id : null,
  }).eq("id", row.id);
  if (row.approval_id) {
    await a.db.from("approval_queue").update({ status: a.kind === "ai" ? "auto_executed" : "approved", resolved_at: now })
      .eq("id", row.approval_id).eq("status", "pending");
  }
  return { ok: true, stage: after.status };
}

/** „Žádná změna" u návrhu — zamítnout (vlákno + druh se už znovu nenavrhne). */
export async function rejectStageCore(a: StageActor, row: MailStageRow, note?: string | null): Promise<{ ok: boolean; error?: string }> {
  if (row.status !== "pending") return { ok: false, error: "Návrh už je vyřízený — obnov stránku." };
  const now = new Date().toISOString();
  const { data, error } = await a.db.from("job_mail_stage_signals").update({
    status: "rejected", resolved_at: now, resolved_by: a.id, correction: clean(note, NOTE_MAX) ?? "žádná změna",
  }).eq("id", row.id).eq("status", "pending").select("id");
  if (error) return { ok: false, error: error.message };
  if (!(data ?? []).length) return { ok: false, error: "Návrh už je vyřízený — obnov stránku." };
  if (row.approval_id) {
    await a.db.from("approval_queue").update({ status: "rejected", resolved_at: now }).eq("id", row.approval_id).eq("status", "pending");
  }
  return { ok: true };
}

/**
 * Vrátit přepnutí z pošty: zpět na stav před ním (reklamace / důvod prohry / pozastavení vyčištěné, nabídky
 * jako dřív) — jen když se stav zakázky od té doby nezměnil. Jedna stavová událost „Korekce: …".
 */
export async function undoStageCore(a: StageActor, row: MailStageRow, opts: { note?: string | null; silent?: boolean } = {}): Promise<StageResult> {
  if (row.status !== "applied" || !row.from_stage || !row.to_stage) return { ok: false, error: "Tuto změnu nejde vrátit." };
  const job = await loadJob(a.db, row.job_id);
  if (!job || !isJobStage(job.status)) return { ok: false, error: "Zakázka nenalezena." };
  const prev = row.prev ?? {};
  const same = (x: unknown, y: unknown) => {
    if (!x && !y) return true;
    const a1 = Date.parse(String(x));
    const b1 = Date.parse(String(y));
    return Number.isFinite(a1) && Number.isFinite(b1) ? a1 === b1 : x === y;
  };
  const kind = row.final_kind ?? row.kind;
  if (job.status !== row.to_stage || !same(job.stage_changed_at, prev.stageChangedAt)
      || (kind === "reklamace_vyrizena" && !same(job.claim_resolved_at, prev.claimResolvedAt))) {
    return { ok: false, error: "Stav zakázky se od té doby změnil — vrať ho ručně v „Korekce stavu…“." };
  }
  const patch: Record<string, unknown> = {};
  if (row.from_stage !== row.to_stage) patch.status = row.from_stage;
  if (kind === "reklamace" || kind === "reklamace_vyrizena") for (const f of CLAIM_FIELDS) patch[f] = prev[f] ?? null;
  if (kind === "pokracovat") patch.hold_reason = prev.hold_reason ?? null;
  const back = stageLabel(row.from_stage);
  const text = clean(opts.note, 300);
  const note = `Korekce: ${row.applied_kind === "ai" ? "AI z pošty chybně" : "přepnutí z pošty chybně"} — vráceno na ${back}${text ? ` (${text})` : ""}`;
  const q = a.db.from("orders").update(patch).eq("id", row.job_id).eq("status", row.to_stage);
  const { data, error } = await withChangeNote(q, note).select("id, status");
  if (error) return { ok: false, error: error.message };
  if (!(data ?? []).length) return { ok: false, error: CHANGED };
  // nabídky zamítnuté / archivované přepnutím do Nerealizováno zase jako dřív (až po stavu — jako „Obnovit poptávku")
  if (kind === "nerealizovano" && Array.isArray(prev.quotes)) {
    const before = prev.quotes as { id: string; status: string; archived: boolean }[];
    // nabídky zamítla AI svým přepnutím → vrací je stejná automatika (za účet toho, kdo vrací); jinak autor sám
    const qdb = row.applied_kind === "ai" ? (createAdminClient({ actor: aiActor(a.id, "mail-stage", "email") }) as unknown as Db) : a.db;
    const { data: now } = await qdb.from("quotes").select("id, status, archived").in("id", before.map((x) => x.id));
    const cur = new Map(((now ?? []) as { id: string; status: string; archived: boolean }[]).map((x) => [x.id, x]));
    for (const qb of before) {
      const c = cur.get(qb.id);
      if (!c || (c.status === qb.status && c.archived === qb.archived)) continue;
      const { error: qErr } = await withChangeNote(qdb.from("quotes").update({ status: qb.status, archived: qb.archived, lost_reason: null })
        .eq("id", qb.id), "korekce stavu z pošty");
      if (qErr) console.error(`[mail-stage] Vrácení nabídky selhalo: ${qErr.message}`);
    }
  }
  if (row.from_stage === row.to_stage) {
    // reklamace vyřízená bez změny stavu: korekce jen jako událost
    await jobEvent(a, { jobId: row.job_id, type: "field", message: note, data: { action: "mail_stage_undo", signalId: row.id } });
  }
  const now = new Date().toISOString();
  await a.db.from("job_mail_stage_signals").update({
    status: opts.silent ? "applied" : "undone", resolved_at: now, resolved_by: a.id, correction: note,
  }).eq("id", row.id);
  // původní událost „Z e-mailu …" už nenabízí Vrátit / Změnit
  if (row.event_id) {
    const { data: ev } = await a.db.from("job_events").select("data").eq("id", row.event_id).maybeSingle();
    const d = ((ev as { data: Record<string, unknown> | null } | null)?.data ?? {}) as Record<string, unknown>;
    await a.db.from("job_events").update({ data: { ...d, undoneAt: now, undoneBy: a.id } }).eq("id", row.event_id);
  }
  return { ok: true, stage: row.from_stage };
}

/**
 * „Změnit" po přepnutí: jiný druh = vrátit a přepnout znovu (z původního stavu); stejný druh = jen jiný důvod
 * (poznámka reklamace / důvod prohry / proč stojí) bez změny stavu.
 */
export async function changeStageCore(a: StageActor, row: MailStageRow, target: StageTarget): Promise<StageResult> {
  if (row.status !== "applied") return { ok: false, error: "Tuto změnu nejde upravit." };
  const current = row.final_kind ?? row.kind;
  const kind = target.kind && isMailStageKind(target.kind) ? target.kind : current;
  if (kind === current) {
    const job = await loadJob(a.db, row.job_id);
    if (!job || job.status !== row.to_stage) return { ok: false, error: "Stav zakázky se od té doby změnil — uprav ho ručně." };
    const reason = reasonText(kind, target.reason ?? row.reason);
    const patch: Record<string, unknown> = {};
    let lost: LostReason | null = row.lost_reason;
    let claim: ClaimReason | null = row.claim_reason;
    if (kind === "reklamace") {
      claim = target.claimReason && isClaimReason(target.claimReason) ? target.claimReason : claim ?? "jine";
      Object.assign(patch, { claim_note: reason, claim_reason: claim });
    } else if (kind === "nerealizovano" || kind === "zruseno") {
      lost = target.lostReason && isLostReason(target.lostReason) && lostReasonsFor("job", kind).includes(target.lostReason) ? target.lostReason : lost ?? "jine";
      Object.assign(patch, { lost_reason: lost, lost_note: reason });
    } else if (kind === "pozastaveno") {
      patch.hold_reason = reason.slice(0, 300);
    }
    if (Object.keys(patch).length) {
      const { data, error } = await a.db.from("orders").update(patch).eq("id", row.job_id).eq("status", row.to_stage!).select("id");
      if (error) return { ok: false, error: error.message };
      if (!(data ?? []).length) return { ok: false, error: CHANGED };
    }
    const detail = kind === "reklamace" && claim ? ` (${CLAIM_REASONS[claim]})` : lost && (kind === "nerealizovano" || kind === "zruseno") ? ` (${lostReasonLabel(lost)})` : "";
    await jobEvent(a, {
      jobId: row.job_id, type: "field", message: `Korekce přepnutí z pošty: ${MAIL_STAGE_META[kind].label}${detail} — ${reason}`,
      data: { action: "mail_stage_change", signalId: row.id },
    });
    await a.db.from("job_mail_stage_signals").update({ reason, lost_reason: lost, claim_reason: claim, correction: `důvod: ${reason}`.slice(0, NOTE_MAX) }).eq("id", row.id);
    return { ok: true, stage: row.to_stage! };
  }
  // jiný druh: musí sedět na stav před přepnutím → vrátit, pak přepnout z původního stavu
  const [view] = await stageViews(a.db, [row]);
  if (!view?.options.includes(kind)) return { ok: false, error: `${MAIL_STAGE_META[kind].label} se na stav před přepnutím nehodí.` };
  const undo = await undoStageCore(a, row, { note: `správně: ${MAIL_STAGE_META[kind].label}`, silent: true });
  if (!undo.ok) return undo;
  const fresh = await loadStageRow(a.db, row.id);
  if (!fresh) return { ok: false, error: "Záznam nenalezen." };
  const r = await applyStageCore(a, { ...fresh, status: "pending", approval_id: null }, target);
  if (!r.ok) {
    await a.db.from("job_mail_stage_signals").update({ status: "undone" }).eq("id", row.id);
    return { ok: false, error: `Vráceno na ${stageLabel(row.from_stage)}, ale přepnout nešlo: ${r.error}` };
  }
  return r;
}

// ── Pro zobrazení ───────────────────────────────────────────

export interface MailStageView {
  id: string;
  jobId: string;
  jobNumber: string | null;
  emailId: string | null;
  threadId: string | null;
  kind: MailStageKind;
  finalKind: MailStageKind | null;
  status: MailStageStatus;
  reason: string;
  quote: string | null;
  lostReason: LostReason | null;
  claimReason: ClaimReason | null;
  confidence: number;
  source: string;
  from: string | null;
  auto: boolean;
  fromStage: JobStage | null;
  toStage: JobStage | null;
  /** Druhy, na které jde přepnout (podle aktuálního stavu; u použitého podle stavu před přepnutím). */
  options: MailStageKind[];
  /** Vrátit / Změnit jde (stav se od přepnutí nezměnil). */
  undoable: boolean;
  createdAt: string;
}

export async function stageViews(db: Db, rows: MailStageRow[], opts: { quote?: boolean } = {}): Promise<MailStageView[]> {
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.job_id))];
  const { data } = await db.from("orders").select(JOB_COLS).in("id", ids);
  const jobs = new Map(((data ?? []) as JobRow[]).map((j) => [j.id, j]));
  return rows.map((r) => {
    const j = jobs.get(r.job_id);
    const facts = j ? jobFacts(j) : null;
    const final = r.final_kind ?? null;
    const prev = r.prev ?? {};
    const undoable = r.status === "applied" && Boolean(j) && j!.status === r.to_stage
      && (!prev.stageChangedAt || Date.parse(String(j!.stage_changed_at)) === Date.parse(String(prev.stageChangedAt)));
    const optionsFacts: StageJobFacts | null = facts && r.status === "applied" && r.from_stage
      ? {
        ...facts, stage: r.from_stage,
        claimOpenedAt: "claim_opened_at" in prev ? (prev.claim_opened_at as string | null) : facts.claimOpenedAt,
        claimResolvedAt: "claim_resolved_at" in prev ? (prev.claim_resolved_at as string | null) : facts.claimResolvedAt,
      }
      : facts;
    return {
      id: r.id, jobId: r.job_id, jobNumber: j ? String(j.number) : null, emailId: r.email_id,
      threadId: r.thread_key.startsWith("e:") ? null : r.thread_key,
      kind: r.kind, finalKind: final, status: r.status, reason: r.reason ?? MAIL_STAGE_META[final ?? r.kind].label,
      quote: opts.quote ? r.quote : null, lostReason: r.lost_reason, claimReason: r.claim_reason,
      confidence: Number(r.confidence) || 0, source: r.source, from: r.from_name, auto: r.applied_kind === "ai",
      fromStage: r.from_stage, toStage: r.to_stage,
      options: optionsFacts ? correctableKinds(optionsFacts, final ?? r.kind) : [final ?? r.kind],
      undoable, createdAt: r.created_at,
    };
  });
}

export async function stageRowsForThread(db: Db, threadId: string, jobId: string | null): Promise<MailStageRow[]> {
  let q = db.from("job_mail_stage_signals").select(ROW_COLS).eq("thread_key", threadId).in("status", ["pending", "applied"]);
  if (jobId) q = q.eq("job_id", jobId);
  const { data } = await q.order("created_at", { ascending: false }).limit(10);
  return (data ?? []) as MailStageRow[];
}

export async function stageRowForApproval(db: Db, approvalId: string): Promise<MailStageRow | null> {
  const { data } = await db.from("job_mail_stage_signals").select(ROW_COLS).eq("approval_id", approvalId).maybeSingle();
  return (data as MailStageRow | null) ?? null;
}

/** Popis pro učení z korekce („E-mail od …, zakázka Z-… ve stavu …: „…“"). */
export async function correctionContext(db: Db, row: MailStageRow): Promise<string> {
  const [{ data: em }, job] = await Promise.all([
    row.email_id ? db.from("emails").select("subject").eq("id", row.email_id).maybeSingle() : Promise.resolve({ data: null }),
    loadJob(db, row.job_id),
  ]);
  const subject = ((em as { subject: string | null } | null)?.subject ?? "").trim();
  const stage = row.from_stage ?? (job && isJobStage(job.status) ? job.status : null);
  return [
    `E-mail od ${row.from_name ?? "zákazníka"}${subject ? ` „${subject.slice(0, 120)}“` : ""}`,
    `zakázka ${job?.number ?? "?"} ve stavu ${stageLabel(stage)}`,
    row.quote ? `text: „${row.quote.slice(0, 300)}“` : null,
  ].filter(Boolean).join(", ");
}

export function signalText(kind: MailStageKind | null, reason: string | null): string {
  return kind ? `${MAIL_STAGE_META[kind].label}: ${reason ?? ""}`.trim() : "Žádná změna stavu zakázky (e-mail speciální stav nenaznačuje)";
}
