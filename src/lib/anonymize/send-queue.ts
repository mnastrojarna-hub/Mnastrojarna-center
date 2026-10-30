import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { logAudit } from "@/lib/audit";
import { userActor } from "@/lib/supabase/actor-headers";
import { pickShareFile, SHARE_FILE_SELECT, sharePriceDocIds, verifyShareBytes, type FileRowWithAnon } from "./share";

/**
 * Fronta odeslání čekajících na anonymizaci (spec §5.5, M15). Server action NIKDY nevykresluje:
 * když některý výkres ještě čeká (pending), vznikne řádek anon_send_queue (waiting) a „šťouchne" se
 * do fronty anonymizace. Po dokončení (onAnonSettled → flushSendQueue) se e-mail odešle stejnou
 * cestou s autorem = tvůrce řádku. review / failed / unsupported → blocked (+ událost v historii).
 * Idempotence: claim řádku podmíněným UPDATE (status waiting|blocked → sending), attempts ≤ 3.
 */

export type AnonDb = SupabaseClient;
export type SendKind = "purchase_order" | "job_document" | "supplier_inquiry";

export interface SendPayload {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  html?: string;
  /** Naše doklady (PDF objednávky…) — posílají se jako originál. */
  extraFileIds?: string[];
  /** Výkresy, u kterých odesílatel potvrdil „zkontroloval jsem náhled" (review). */
  reviewedFileIds?: string[];
  /** Objednávka dodavateli (stav po odeslání). */
  purchaseOrderId?: string;
  /** Text do historie („dodavateli XY"). */
  recipientLabel?: string;
  /**
   * Soubory, které anonymizovat nejde (DWG, Word…) a super admin výslovně potvrdil „Poslat originál"
   * (allowQueuedOriginals — nikdy z požadavku klienta: cleanPayload je zahodí). Platí jen, dokud je
   * originalConfirmedBy aktivní super admin a soubor je stále „Nelze anonymizovat".
   */
  originalFileIds?: string[];
  originalConfirmedBy?: string;
}

export interface SendQueueRow {
  id: string;
  kind: SendKind;
  job_id: string | null;
  ref_id: string | null;
  payload: SendPayload;
  file_ids: string[];
  status: "waiting" | "sending" | "sent" | "blocked" | "cancelled" | "failed";
  reason: string | null;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
  attempts: number;
}

const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024;
const MAX_ATTEMPTS = 3;

function cleanPayload(p: SendPayload): SendPayload {
  const emails = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)).slice(0, 20);
  const ids = (v: unknown) => (Array.isArray(v) ? v : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 80);
  return {
    to: emails(p.to),
    cc: emails(p.cc),
    subject: String(p.subject ?? "").slice(0, 300),
    body: String(p.body ?? "").slice(0, 20_000),
    ...(p.html ? { html: String(p.html).slice(0, 200_000) } : {}),
    extraFileIds: ids(p.extraFileIds),
    reviewedFileIds: ids(p.reviewedFileIds),
    ...(p.purchaseOrderId && /^[0-9a-f-]{36}$/i.test(p.purchaseOrderId) ? { purchaseOrderId: p.purchaseOrderId } : {}),
    ...(p.recipientLabel ? { recipientLabel: String(p.recipientLabel).slice(0, 200) } : {}),
  };
}

export interface SendRequestAccess {
  /** Smí uživatel soubor poslat ven? (assertJobFileAccess(…, "send")) — null = ano, jinak chyba. */
  canSendFile(fileId: string): Promise<string | null>;
  /** Smí posílat objednávky dodavatelům (funkce „margins" jako sendPurchaseOrder)? */
  canSendPurchaseOrder: boolean;
}

export type SendRequestCheck =
  | { ok: true; payload: SendPayload; fileIds: string[]; refId: string | null }
  | { ok: false; error: string };

/**
 * Kontrola požadavku na odeslání z klienta (server action): KAŽDÝ přiložený soubor (výkresy, naše doklady,
 * potvrzené náhledy) musí patřit k zakázce a uživatel ho musí smět poslat; objednávka dodavateli musí
 * patřit k zakázce a uživatel musí mít právo objednávky posílat. Nic z payloadu se nepřebírá bez kontroly.
 */
export async function validateSendRequest(db: AnonDb, input: { kind: SendKind; jobId: string | null; refId?: string | null; payload: SendPayload; fileIds: string[] }, access: SendRequestAccess): Promise<SendRequestCheck> {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!(["purchase_order", "job_document", "supplier_inquiry"] as const).includes(input.kind)) return { ok: false, error: "Neznámý druh odeslání." };
  const raw = input.payload && typeof input.payload === "object" ? input.payload : ({} as SendPayload);
  const fileIds = [...new Set((Array.isArray(input.fileIds) ? input.fileIds : []).map(String))];
  if (fileIds.some((x) => !UUID.test(x))) return { ok: false, error: "Soubor nenalezen." };
  const extra = Array.isArray(raw.extraFileIds) ? raw.extraFileIds.map(String) : [];
  const reviewed = Array.isArray(raw.reviewedFileIds) ? raw.reviewedFileIds.map(String) : [];
  if ([...extra, ...reviewed].some((x) => !UUID.test(x))) return { ok: false, error: "Soubor nenalezen." };
  const jobId = input.jobId ?? null;
  if (jobId !== null && !UUID.test(jobId)) return { ok: false, error: "Zakázka nenalezena." };
  const all = [...new Set([...fileIds, ...extra, ...reviewed])];
  if (all.length > 80) return { ok: false, error: "Příliš mnoho příloh." };
  if (all.length) {
    if (!jobId) return { ok: false, error: "Přílohy jdou poslat jen z zakázky." };
    const { data, error } = await db.from("job_files").select("id, job_id").in("id", all);
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as { id: string; job_id: string | null }[];
    for (const id of all) {
      const r = rows.find((x) => x.id.toLowerCase() === id.toLowerCase());
      if (!r || String(r.job_id ?? "").toLowerCase() !== jobId.toLowerCase()) return { ok: false, error: "Příloha nepatří k zakázce." };
      const err = await access.canSendFile(id);
      if (err) return { ok: false, error: err };
    }
  }
  const payload = cleanPayload({ ...raw, extraFileIds: extra, reviewedFileIds: reviewed.filter((x) => fileIds.includes(x)) });
  let refId = input.refId && UUID.test(input.refId) ? input.refId : null;
  if (input.kind === "purchase_order") {
    if (!access.canSendPurchaseOrder) return { ok: false, error: "Objednávky dodavatelům posílá jen obchodník nebo super admin." };
    if (!payload.purchaseOrderId || !jobId) return { ok: false, error: "Objednávka nenalezena." };
    const { data: po } = await db.from("purchase_orders").select("id, job_id").eq("id", payload.purchaseOrderId).maybeSingle();
    const p = po as { id: string; job_id: string | null } | null;
    if (!p || String(p.job_id ?? "").toLowerCase() !== jobId.toLowerCase()) return { ok: false, error: "Objednávka nepatří k zakázce." };
    refId = p.id;
  } else {
    // objednávku smí označit odeslanou jen druh purchase_order
    delete payload.purchaseOrderId;
  }
  return { ok: true, payload, fileIds, refId };
}

export async function enqueueSend(db: AnonDb, input:{ kind: SendKind; jobId: string | null; refId?: string | null; payload: SendPayload; fileIds: string[]; createdBy: string | null }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const payload = cleanPayload(input.payload);
  if (!payload.to.length) return { ok: false, error: "Chybí platný adresát." };
  if (!payload.subject) return { ok: false, error: "Chybí předmět e-mailu." };
  const fileIds = [...new Set(input.fileIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 80);
  const { data, error } = await db.from("anon_send_queue").insert({
    kind: input.kind, job_id: input.jobId, ref_id: input.refId ?? null, payload, file_ids: fileIds, status: "waiting", created_by: input.createdBy,
  }).select("id").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Zařazení do fronty selhalo." };
  return { ok: true, id: (data as { id: string }).id };
}

export async function cancelSend(db: AnonDb, id: string, userId: string, isAdmin: boolean): Promise<{ ok: boolean; error?: string }> {
  const q = db.from("anon_send_queue").update({ status: "cancelled", updated_at: new Date().toISOString(), reason: "Zrušeno uživatelem" }).eq("id", id).in("status", ["waiting", "blocked"]);
  const { data, error } = await (isAdmin ? q : q.eq("created_by", userId)).select("id");
  if (error) return { ok: false, error: error.message };
  return (data ?? []).length ? { ok: true } : { ok: false, error: "Odeslání už nejde zrušit." };
}

/** Stav příloh řádku fronty. */
export async function queueReadiness(db: AnonDb, row: Pick<SendQueueRow, "file_ids" | "payload">): Promise<{ pending: string[]; blocked: { id: string; message: string }[]; ready: string[] }> {
  const out = { pending: [] as string[], blocked: [] as { id: string; message: string }[], ready: [] as string[] };
  if (!row.file_ids.length) return out;
  const { data } = await db.from("job_files").select(SHARE_FILE_SELECT).in("id", row.file_ids);
  const rows = (data ?? []) as FileRowWithAnon[];
  const reviewed = new Set(row.payload.reviewedFileIds ?? []);
  const price = await sharePriceDocIds(db as never, row.file_ids);
  const originals = await confirmedOriginals(db, row.payload);
  for (const id of row.file_ids) {
    const f = rows.find((r) => r.id === id);
    if (!f) { out.blocked.push({ id, message: "Výkres byl smazán." }); continue; }
    const d = pickShareFile(f, { reviewedByCaller: reviewed.has(id), priceDocument: price.has(id.toLowerCase()), ...originalOpts(originals, f) });
    if (d.ok) out.ready.push(id);
    else if (d.reason === "pending") out.pending.push(id);
    else out.blocked.push({ id, message: d.message });
  }
  return out;
}

export type Sender = (args: {
  to: string; cc?: string; subject: string; text: string; html?: string;
  attachments: { filename: string; content: Buffer; contentType?: string }[];
  ownerId: string | null; jobId: string | null;
}) => Promise<{ sent: boolean; reason?: string; emailId?: string }>;

async function defaultSender(): Promise<Sender> {
  const { sendMail } = await import("@/lib/email/send");
  return async (a) => sendMail({
    to: a.to, cc: a.cc, subject: a.subject, text: a.text, html: a.html, attachments: a.attachments,
    from: a.ownerId ? { ownerId: a.ownerId } : { system: true }, jobId: a.jobId ?? undefined, senderId: a.ownerId ?? undefined,
    // text z dialogu (objednávka / výkresy) nese podpis autora → grafický s logem
    signature: a.ownerId ? { userId: a.ownerId, mode: "inline" } : null,
  });
}

/** Odešle jeden řádek fronty (už claimnutý → status sending). */
async function sendRow(db: AnonDb, row: SendQueueRow, sender: Sender): Promise<{ status: SendQueueRow["status"]; reason: string | null }> {
  const p = row.payload;
  const ids = [...row.file_ids, ...(p.extraFileIds ?? [])];
  const { data } = await db.from("job_files").select(SHARE_FILE_SELECT).in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const rows = (data ?? []) as FileRowWithAnon[];
  const reviewed = new Set(p.reviewedFileIds ?? []);
  const price = await sharePriceDocIds(db as never, ids);
  const confirmed = await confirmedOriginals(db, p);
  const attachments: { filename: string; content: Buffer; contentType?: string }[] = [];
  const names = new Set<string>();
  /** Externí originály, které odešly (audit). */
  const originals: string[] = [];
  let total = 0;
  for (const id of ids) {
    const f = rows.find((r) => r.id === id);
    if (!f) return { status: "blocked", reason: "Příloha byla smazána." };
    // pojistka: příloha musí patřit k zakázce řádku fronty (kontrola i při zařazení — validateSendRequest)
    if (!row.job_id || String(f.job_id ?? "").toLowerCase() !== row.job_id.toLowerCase()) return { status: "blocked", reason: "Příloha nepatří k zakázce." };
    const asOriginal = row.file_ids.includes(id) ? originalOpts(confirmed, f) : {};
    const d = pickShareFile(f, { reviewedByCaller: reviewed.has(id), priceDocument: price.has(id.toLowerCase()), ...asOriginal });
    if (!d.ok) return { status: d.reason === "pending" ? "waiting" : "blocked", reason: d.message };
    const bytes = await verifyShareBytes(db as never, d, f);
    if (d.audit) originals.push(id);
    total += bytes.length;
    // originál bez anonymizace (super admin) bez původního názvu — ten často nese jméno zákazníka
    const ext = /\.[A-Za-z0-9]{1,8}$/.exec(d.filename)?.[0]?.toLowerCase() ?? "";
    const base = asOriginal.original && d.source === "original" ? `original${ext}` : d.filename;
    let name = base;
    for (let i = 2; names.has(name.toLowerCase()); i++) name = base.replace(/(\.[^.]+)?$/, `-${i}$1`);
    names.add(name.toLowerCase());
    attachments.push({ filename: name, content: Buffer.from(bytes), contentType: d.mime });
  }
  if (total > MAX_ATTACHMENTS_BYTES) return { status: "failed", reason: "Přílohy se nevejdou do e-mailu (> 20 MB) — pošli odkaz nebo ZIP." };
  const res = await sender({
    to: p.to.join(", "), cc: p.cc?.length ? p.cc.join(", ") : undefined, subject: p.subject, text: p.body, html: p.html,
    attachments, ownerId: row.created_by, jobId: row.job_id,
  });
  if (!res.sent) return { status: row.attempts >= MAX_ATTEMPTS ? "failed" : "waiting", reason: res.reason ?? "E-mail se nepodařilo odeslat." };

  const actor = userActor(row.created_by ? { id: row.created_by } : null, "rucne");
  if (row.kind === "purchase_order" && p.purchaseOrderId) {
    const { data: po } = await db.from("purchase_orders").select("status, job_id").eq("id", p.purchaseOrderId).maybeSingle();
    const pr = po as { status: string; job_id: string | null } | null;
    if (pr && row.job_id && String(pr.job_id ?? "").toLowerCase() === row.job_id.toLowerCase()) {
      const upd: Record<string, unknown> = { sent_at: new Date().toISOString() };
      if (pr.status === "navrh" || pr.status === "vystavena") upd.status = "odeslana";
      await db.from("purchase_orders").update(upd).eq("id", p.purchaseOrderId);
    }
  }
  if (row.job_id) {
    const n = row.file_ids.length;
    await logJobEvent(db as unknown as JobsDb, {
      jobId: row.job_id, type: "email",
      message: `Odesláno${p.recipientLabel ? ` ${p.recipientLabel}` : ""} po anonymizaci: ${n} ${n === 1 ? "výkres" : n >= 2 && n <= 4 ? "výkresy" : "výkresů"} (${p.to.join(", ")})`,
      data: { sendQueueId: row.id, kind: row.kind, fileIds: row.file_ids, emailId: res.emailId ?? null },
      actorId: row.created_by, actorKind: "user", via: "rucne", agent: "fronta",
      entity: row.kind === "purchase_order" ? "purchase_order" : "file", entityId: row.ref_id ?? undefined,
    });
  }
  await logAudit({ action: "anon_send_queue_sent", entity: "anon_send_queue", entityId: row.id, diff: { kind: row.kind, to: p.to, files: row.file_ids.length, originals, ...(originals.length && p.originalConfirmedBy ? { originalConfirmedBy: p.originalConfirmedBy } : {}) }, actor });
  return { status: "sent", reason: null };
}

/**
 * Projde čekající odeslání (s daným souborem nebo všechna): všechny přílohy done → odeslat;
 * některá review/failed/unsupported → blocked (+ událost); jinak čekat.
 */
export async function flushSendQueue(db: AnonDb, opts: { fileId?: string; ids?: string[]; sender?: Sender; limit?: number } = {}): Promise<{ sent: number; blocked: number; waiting: number }> {
  const out = { sent: 0, blocked: 0, waiting: 0 };
  let q = db.from("anon_send_queue").select("*").in("status", ["waiting", "blocked"]).order("created_at", { ascending: true }).limit(opts.limit ?? 20);
  if (opts.fileId) q = q.contains("file_ids", [opts.fileId]);
  if (opts.ids?.length) q = q.in("id", opts.ids);
  const { data } = await q;
  const rows = (data ?? []) as SendQueueRow[];
  const sender = opts.sender ?? (await defaultSender());
  for (const row of rows) {
    const r = await queueReadiness(db, row);
    if (r.pending.length) { out.waiting++; continue; }
    if (r.blocked.length) {
      const reason = r.blocked[0].message;
      if (row.status !== "blocked" || row.reason !== reason) {
        await db.from("anon_send_queue").update({ status: "blocked", reason, updated_at: new Date().toISOString() }).eq("id", row.id).in("status", ["waiting", "blocked"]);
        if (row.job_id) {
          await logJobEvent(db as unknown as JobsDb, {
            jobId: row.job_id, type: "email", message: `Odeslání pozastaveno — ${reason}`,
            data: { sendQueueId: row.id, blocked: r.blocked.map((b) => b.id) }, actorId: null, actorKind: "system", via: "automaticky", agent: "fronta", entity: "file",
          });
        }
      }
      out.blocked++;
      continue;
    }
    // claim (idempotence): jen jeden běh pošle
    const { data: claimed } = await db.from("anon_send_queue")
      .update({ status: "sending", attempts: row.attempts + 1, updated_at: new Date().toISOString() })
      .eq("id", row.id).in("status", ["waiting", "blocked"]).lt("attempts", MAX_ATTEMPTS + 1).select("*");
    const c = ((claimed ?? []) as SendQueueRow[])[0];
    if (!c) continue;
    let result: { status: SendQueueRow["status"]; reason: string | null };
    try {
      result = await sendRow(db, c, sender);
    } catch (err) {
      result = { status: c.attempts >= MAX_ATTEMPTS ? "failed" : "waiting", reason: err instanceof Error ? err.message : "Odeslání selhalo." };
    }
    await db.from("anon_send_queue").update({
      status: result.status, reason: result.reason, updated_at: new Date().toISOString(), ...(result.status === "sent" ? { sent_at: new Date().toISOString() } : {}),
    }).eq("id", c.id);
    if (result.status === "sent") out.sent++;
    else if (result.status === "blocked") out.blocked++;
    else out.waiting++;
  }
  return out;
}

/** „Odeslat hned bez těchto výkresů": vyřadí čekající / blokované výkresy a odešle zbytek. */
export async function sendWithoutPending(db: AnonDb, id: string, userId: string, isAdmin: boolean, sender?: Sender): Promise<{ ok: boolean; error?: string }> {
  const { data } = await db.from("anon_send_queue").select("*").eq("id", id).maybeSingle();
  const row = data as SendQueueRow | null;
  if (!row || (!isAdmin && row.created_by !== userId)) return { ok: false, error: "Odeslání nenalezeno." };
  if (row.status !== "waiting" && row.status !== "blocked") return { ok: false, error: "Odeslání už neběží." };
  const r = await queueReadiness(db, row);
  await db.from("anon_send_queue").update({ file_ids: r.ready, updated_at: new Date().toISOString() }).eq("id", id).in("status", ["waiting", "blocked"]);
  const res = await flushSendQueue(db, { ids: [id], sender });
  return res.sent ? { ok: true } : { ok: false, error: "Odeslání se nepodařilo — zkontroluj frontu." };
}

// ── „Poslat originál" ve frontě (jen super admin) ─────────────

/** Potvrzené originály řádku — jen dokud je potvrzující aktivní super admin (role se ověřuje při každém odeslání). */
async function confirmedOriginals(db: AnonDb, p: SendPayload): Promise<Set<string>> {
  const ids = (p.originalFileIds ?? []).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length || !p.originalConfirmedBy || !/^[0-9a-f-]{36}$/i.test(p.originalConfirmedBy)) return new Set();
  const { data } = await db.from("profiles").select("role, active").eq("id", p.originalConfirmedBy).maybeSingle();
  const pr = data as { role: string; active: boolean | null } | null;
  return pr && pr.role === "super_admin" && pr.active !== false ? new Set(ids.map((x) => x.toLowerCase())) : new Set();
}

/** Originál jen u souboru, který anonymizovat nejde (hotovou kopii nikdy neobchází) — stejné pravidlo jako ZIP. */
function originalOpts(confirmed: Set<string>, f: FileRowWithAnon): { original?: true; isSuperAdmin?: true } {
  return confirmed.has(f.id.toLowerCase()) && f.anon_status === "unsupported" ? { original: true, isSuperAdmin: true } : {};
}

/** Soubory řádku fronty, které anonymizovat nejde (kandidáti na „Poslat originál"). */
export async function unsupportedQueueFiles(db: AnonDb, fileIds: string[]): Promise<string[]> {
  if (!fileIds.length) return [];
  const { data } = await db.from("job_files").select("id, anon_status").in("id", fileIds.slice(0, 80));
  return ((data ?? []) as { id: string; anon_status: string | null }[]).filter((r) => r.anon_status === "unsupported").map((r) => r.id);
}

/**
 * „Poslat originál…" u odeslání zablokovaného souborem, který anonymizovat nejde: super admin výslovně
 * potvrdí, potvrzení se zapíše do auditu a řádek se hned zkusí odeslat (ostatní výkresy dál jen anonymizované).
 */
export async function allowQueuedOriginals(db: AnonDb, id: string, user: { id: string; role: string }, actor: Parameters<typeof logAudit>[0]["actor"], sender?: Sender): Promise<{ ok: boolean; error?: string; sent?: boolean }> {
  if (user.role !== "super_admin") return { ok: false, error: "Originál bez anonymizace smí dodavateli poslat jen super admin." };
  const { data } = await db.from("anon_send_queue").select("*").eq("id", id).maybeSingle();
  const row = data as SendQueueRow | null;
  if (!row) return { ok: false, error: "Odeslání nenalezeno." };
  if (row.status !== "waiting" && row.status !== "blocked") return { ok: false, error: "Odeslání už neběží." };
  const ids = await unsupportedQueueFiles(db, row.file_ids);
  if (!ids.length) return { ok: false, error: "Ve frontě není soubor, který by šlo poslat jen jako originál." };
  const payload: SendPayload = { ...row.payload, originalFileIds: ids, originalConfirmedBy: user.id };
  const { data: upd, error } = await db.from("anon_send_queue").update({ payload, updated_at: new Date().toISOString() }).eq("id", id).in("status", ["waiting", "blocked"]).select("id");
  if (error) return { ok: false, error: error.message };
  if (!(upd ?? []).length) return { ok: false, error: "Odeslání už neběží." };
  await logAudit({ action: "anon_send_queue_original", entity: "anon_send_queue", entityId: id, diff: { jobId: row.job_id, fileIds: ids }, actor });
  const res = await flushSendQueue(db, { ids: [id], sender });
  if (res.sent) return { ok: true, sent: true };
  const { data: after } = await db.from("anon_send_queue").select("status, reason").eq("id", id).maybeSingle();
  const a = after as { status: string; reason: string | null } | null;
  return a?.status === "waiting" ? { ok: true, sent: false } : { ok: false, error: a?.reason ?? "Odeslání se nepodařilo — zkontroluj frontu." };
}
