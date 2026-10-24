import "server-only";
import { createHash } from "node:crypto";
import { after } from "next/server";
import { headers } from "next/headers";
import type { CurrentUser } from "@/lib/data/current-user";
import { getJob } from "@/lib/data/jobs";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import {
  FLOW_QUOTE_COLUMNS, QUOTE_ADMIN_ONLY, canApproveQuote, quoteFactsFromRow, quoteUnpriced,
} from "@/lib/jobs/flow-status";
import { translateDbError } from "@/lib/jobs/mapping";
import type { ActionResult, JobDetail, JobQuote } from "@/lib/jobs/types";
import { buildQuoteDoc } from "@/lib/pdf/job-docs";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { originFrom } from "@/lib/auth/reset-code";
import { logAudit } from "@/lib/audit";
import { sendMail } from "@/lib/email/send";
import { czk } from "@/lib/pdf/types";

/**
 * Schvalování nabídek super adminem (#25) — sdílené jádro serveru:
 *  - otisk obsahu nabídky při schválení (co zákazník dostane = co bylo schváleno),
 *  - jediné místo, kde se nabídka schvaluje (approveJobQuote, setQuoteState → schvalena,
 *    approveAndSendQuote, fronta ke schválení),
 *  - upozornění super adminům na nové neschválené nabídky (best-effort, po odpovědi).
 * DB pravidla (R0–R7 v quotes_flow_before) jsou druhá pojistka — tady jsou srozumitelné chyby.
 */

type Row = Record<string, unknown>;

export const QUOTE_EMPTY_APPROVE = "Nabídka nemá žádné položky — nejde ji schválit.";
export const QUOTE_UNPRICED_APPROVE = "Nabídku s položkou bez ceny nejde schválit — autor musí doplnit ceny.";
export const QUOTE_STALE_APPROVE = "Nabídku mezitím někdo upravil — zkontroluj ji a schval znovu.";
export const QUOTE_NOT_PENDING = "Schválit jde jen neschválenou nabídku — odeslanou, archivovanou nebo uzavřenou už ne.";

/** Pole dokladu, která se mění sama od sebe nebo nepatří k obsahu nabídky (lidé, data vystavení, firma). */
const VOLATILE_KEYS = new Set([
  "issueDate", "validUntil", "preparedBy", "approvedBy", "approvedAt", "watermark", "intro", "supplier",
  "contactPerson", "contactEmail", "contactPhone",
]);

/** Stabilní JSON (klíče seřazené) — otisk nezávisí na pořadí vlastností. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Otisk obsahu nabídky, jak ho uvidí zákazník (položky, odběratel, předmět, termín, podmínky, poznámka, měna, číslo). */
export async function quoteSnapshotSha(job: JobDetail, quote: JobQuote): Promise<string> {
  const doc = await buildQuoteDoc(job, quote) as unknown as Record<string, unknown>;
  const content = Object.fromEntries(Object.entries(doc).filter(([k]) => !VOLATILE_KEYS.has(k)));
  return createHash("sha256").update(stableJson(content)).digest("hex");
}

/** Otisk pro nabídku podle id (načte zakázku); null = nabídka bez zakázky / nenalezena. */
export async function quoteSnapshotShaById(jobId: string | null, quoteId: string): Promise<string | null> {
  if (!jobId) return null;
  const job = await getJob(jobId);
  const quote = job?.quotes.find((q) => q.id === quoteId);
  return job && quote ? quoteSnapshotSha(job, quote) : null;
}

async function personName(db: JobsDb, id: unknown): Promise<string | null> {
  if (typeof id !== "string" || !id) return null;
  const { data } = await db.from("profiles").select("full_name, email").eq("id", id).maybeSingle();
  const p = data as { full_name: string | null; email: string | null } | null;
  return (p?.full_name ?? "").trim() || (p?.email ?? "").trim() || null;
}

/**
 * Schválení nabídky — jen super admin, jen neschválená nabídka s položkami a cenami. Zapíše
 * approved_by + otisk (čas schválení doplní DB), u AI návrhu i status. S expectedUpdatedAt (seznam
 * ke schválení) projde jen nezměněná nabídka (položky i hlavička vždy posunou updated_at).
 */
export async function approveQuoteCore(
  db: JobsDb, user: CurrentUser, quoteId: string, opts: { expectedUpdatedAt?: string | null; note?: string | null } = {},
): Promise<ActionResult<{ jobId: string | null; number: string | null }>> {
  if (user.role !== "super_admin" || !user.active) return { ok: false, error: QUOTE_ADMIN_ONLY };
  const { data, error } = await db.from("quotes").select(FLOW_QUOTE_COLUMNS).eq("id", quoteId).maybeSingle();
  if (error) return { ok: false, error: translateDbError(error.message) };
  const row = data as Row | null;
  if (!row) return { ok: false, error: "Nabídka nenalezena." };
  const facts = quoteFactsFromRow(row);
  const jobId = typeof row.job_id === "string" ? row.job_id : null;
  if (facts.state === "schvalena") return { ok: false, error: "Nabídka už je schválená." };
  if (quoteUnpriced(facts)) return { ok: false, error: QUOTE_UNPRICED_APPROVE };
  if (!canApproveQuote(facts, { can: () => true })) return { ok: false, error: QUOTE_NOT_PENDING };
  if (opts.expectedUpdatedAt && facts.updatedAt && Date.parse(opts.expectedUpdatedAt) !== Date.parse(facts.updatedAt)) {
    return { ok: false, error: QUOTE_STALE_APPROVE };
  }

  const { data: items, error: itemsErr } = await db.from("quote_items").select("unit_price").eq("quote_id", quoteId);
  if (itemsErr) return { ok: false, error: translateDbError(itemsErr.message) };
  const list = (items ?? []) as { unit_price: number | string | null }[];
  if (!list.length) return { ok: false, error: QUOTE_EMPTY_APPROVE };
  if (list.some((i) => i.unit_price === null || i.unit_price === undefined || i.unit_price === "")) {
    return { ok: false, error: QUOTE_UNPRICED_APPROVE };
  }

  const sha = await quoteSnapshotShaById(jobId, quoteId);
  const patch: Row = { approved_by: user.id, approved_snapshot_sha: sha };
  if (facts.status === "navrh_ai") patch.status = "ke_schvaleni";
  let upd = db.from("quotes").update(patch as never).eq("id", quoteId).eq("state", "ke_schvaleni");
  if (facts.updatedAt) upd = upd.eq("updated_at", facts.updatedAt);
  const { data: done, error: updErr } = await upd.select("id, approved_at");
  if (updErr) return { ok: false, error: translateDbError(updErr.message) };
  if (!done?.length) return { ok: false, error: QUOTE_STALE_APPROVE };
  const approvedAt = (done[0] as { approved_at: string | null }).approved_at ?? new Date().toISOString();

  const number = facts.number?.trim() || null;
  if (jobId) {
    await db.from("orders").update({ approved_by: user.id, approved_at: approvedAt } as never).eq("id", jobId);
    const author = facts.createdBy && facts.createdBy !== user.id ? await personName(db, facts.createdBy) : null;
    const label = number ? `Nabídka ${number}` : "Nabídka";
    const note = opts.note?.trim();
    await logJobEvent(db, {
      jobId, type: "quote", entity: "quote", entityId: quoteId, actorId: user.id,
      message: `${label} schválena${author ? ` — připravil(a) ${author}` : ""}${note ? ` — ${note}` : ""}`,
      data: { quoteId, number, action: "approved", ...(author ? { author } : {}) },
    });
  }
  return { ok: true, jobId, number };
}

// ── Upozornění super adminům ────────────────────────────────
const NOTICE_ACTION = "quote_approval_notice";
const NOTICE_THROTTLE_MS = 30 * 60 * 1000;

/** Adresa aplikace pro odkazy v e-mailu (z požadavku; mimo požadavek z NEXT_PUBLIC_APP_URL). */
export async function approvalNoticeOrigin(): Promise<string> {
  try {
    const h = await headers();
    return originFrom({
      proto: h.get("x-forwarded-proto"),
      host: h.get("x-forwarded-host") ?? h.get("host"),
      fallback: process.env.NEXT_PUBLIC_APP_URL,
    });
  } catch {
    return originFrom({ fallback: process.env.NEXT_PUBLIC_APP_URL });
  }
}

/**
 * Best-effort: systémový e-mail aktivním super adminům „Ke schválení: nabídka …" se seznamem čekajících
 * nabídek. Každému nejvýš jednou za 30 minut (audit_log quote_approval_notice). Chyba nikdy neshodí akci.
 */
export async function notifyQuoteApprovers(input: { quoteId: string; jobId: string | null; authorId: string; origin?: string }): Promise<void> {
  if (!isSupabaseConfigured() || !hasServiceKey()) return;
  try {
    const db = createAdminClient({ actor: null });
    const { data: author } = await db.from("profiles").select("role, full_name, email").eq("id", input.authorId).maybeSingle();
    const a = author as { role: string; full_name: string | null; email: string | null } | null;
    if (!a || a.role === "super_admin") return;
    const authorName = (a.full_name ?? "").trim() || (a.email ?? "").trim() || "kolega";

    const { data: admins } = await db.from("profiles").select("id, email").eq("role", "super_admin").eq("active", true);
    const targets = ((admins ?? []) as { id: string; email: string | null }[]).filter((x) => x.email?.trim());
    if (!targets.length) return;

    const { data: pendingRows } = await db.from("quotes")
      .select("id, number, total, currency, job_id, created_at, customer:customers!customer_id(name), creator:profiles!created_by(full_name, email)")
      .eq("state", "ke_schvaleni").eq("archived", false).is("approval_returned_at", null)
      .order("created_at", { ascending: false }).limit(10);
    type P = {
      id: string; number: string | null; total: number | string | null; currency: string | null; job_id: string | null;
      customer: { name: string } | { name: string }[] | null; creator: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null;
    };
    const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
    const pending = (pendingRows ?? []) as P[];
    const current = pending.find((p) => p.id === input.quoteId);
    if (!current) return;   // mezitím schválená / vrácená — není o čem psát

    const origin = (input.origin ?? (await approvalNoticeOrigin())).replace(/\/+$/, "");
    const customerOf = (p: P) => one(p.customer)?.name ?? "bez zákazníka";
    const authorOf = (p: P) => { const c = one(p.creator); return (c?.full_name ?? "").trim() || (c?.email ?? "").trim() || "—"; };
    const amount = (p: P) => (p.total === null || p.total === undefined || p.total === "" ? "bez ceny"
      : czk(Number(p.total), p.currency || "CZK"));
    const link = (p: P) => (p.job_id ? `${origin}/orders/${p.job_id}?tab=nabidky` : `${origin}/quotes`);
    const subject = `Ke schválení: nabídka ${current.number ?? ""} – ${customerOf(current)} (${authorName})`.replace(/\s+/g, " ").trim();
    const lines = pending.map((p) => `${p.number ?? "—"} · ${customerOf(p)} · ${authorOf(p)} · ${amount(p)}\n${link(p)}`);
    // 1 „čeká … nabídka“, 2–4 „čekají … nabídky“, 5+ „čeká … nabídek“
    const n = pending.length;
    const count = `${n >= 2 && n <= 4 ? "čekají" : "čeká"} ${n} ${n === 1 ? "nabídka" : n >= 2 && n <= 4 ? "nabídky" : "nabídek"}`;
    const text = [`Na tvé schválení ${count}:`, "", ...lines, "",
      "Odeslat zákazníkovi je půjde až po schválení."].join("\n");
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const html = `<p>Na tvé schválení ${count}:</p><ul>${
      pending.map((p) => `<li>${esc(`${p.number ?? "—"} · ${customerOf(p)} · ${authorOf(p)} · ${amount(p)}`)} — <a href="${esc(link(p))}">Otevřít nabídku</a></li>`).join("")
    }</ul><p>Odeslat zákazníkovi je půjde až po schválení.</p>`;

    const since = new Date(Date.now() - NOTICE_THROTTLE_MS).toISOString();
    for (const t of targets) {
      const { data: recent } = await db.from("audit_log").select("id").eq("action", NOTICE_ACTION).eq("entity_id", t.id)
        .gte("created_at", since).limit(1);
      if ((recent ?? []).length) continue;
      const res = await sendMail({ to: t.email!.trim(), subject, text, html, from: { system: true }, log: false });
      if (!res.sent) {
        console.error(`[quote-approval] Upozornění super adminovi neodešlo: ${res.reason ?? "neznámý důvod"}`);
        continue;
      }
      await logAudit({
        action: NOTICE_ACTION, entity: "profiles", entityId: t.id, actor: null,
        diff: { quoteId: input.quoteId, number: current.number, pending: pending.length, author: authorName },
      });
    }
  } catch (err) {
    console.error(`[quote-approval] Upozornění selhalo: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Naplánuje upozornění po odeslání odpovědi (after); mimo požadavek (testy, skripty) ho rovnou provede. */
export async function scheduleQuoteApprovalNotice(input: { quoteId: string; jobId: string | null; authorId: string }): Promise<void> {
  const origin = await approvalNoticeOrigin();
  try {
    after(() => notifyQuoteApprovers({ ...input, origin }));
  } catch {
    await notifyQuoteApprovers({ ...input, origin });
  }
}
