"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkFeature, getAccess } from "@/lib/auth/session";
import { userActor } from "@/lib/supabase/actor-headers";
import { logAudit } from "@/lib/audit";
import { getVisibleEmailRow } from "@/lib/data/mail";
import { describeSender, sendMail, type OutgoingAttachment } from "@/lib/email/send";
import { outgoingSignature } from "@/lib/email/signature-server";
import { loadEmailAttachment, MAX_ATTACHMENT_BYTES } from "@/lib/email/attachments";
import { replyHeaders, splitAddresses } from "@/lib/email/threading";
import { sentCopyLabel } from "@/lib/email/mail-folders";
import { isDbEmailCategory, isUuidLike } from "@/lib/email/visibility";
import { assertJobFileAccess, fileLocks } from "@/lib/jobs/job-file-access";
import type { JobsDb } from "@/lib/jobs/events";

/**
 * Psaní e-mailů z aplikace: nová zpráva, odpověď, odpovědět všem, přeposlání (s původními
 * přílohami), přílohy z počítače (podepsané nahrání do úložiště) i z dokumentů zakázky, podpis.
 * Odesílá se přes sendMail({ ownerId, replyMailboxId }) — vlastní schránka, u odpovědi schránka,
 * kam e-mail přišel (je-li moje nebo firemní), jinak firemní / globální SMTP; nikdy cizí osobní.
 */

type Db = SupabaseClient;
async function db(): Promise<Db> {
  return (await createOperatorClient()) as unknown as Db;
}

const UPLOAD_BUCKET = "documents";
const MAX_TOTAL = 25 * 1024 * 1024;
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export interface ComposeAttachmentRef {
  kind: "upload" | "job" | "original";
  /** upload: cesta v úložišti (z prepareMailUploadAction); job: id souboru zakázky; original: id přílohy e-mailu. */
  ref: string;
  filename?: string;
  contentType?: string;
}

export interface SendComposedInput {
  mode: "new" | "reply" | "replyAll" | "forward";
  /** Zpráva, na kterou se odpovídá / která se přeposílá. */
  sourceEmailId?: string | null;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  attachments?: ComposeAttachmentRef[];
  /** Zakázka (u nové zprávy z detailu zakázky). */
  jobId?: string | null;
}

export interface SendComposedResult {
  ok: boolean;
  error?: string;
  emailId?: string;
  fromAddress?: string;
  sentCopy?: "ok" | "failed" | "skipped";
  sentCopyText?: string;
}

function cleanList(v: string | undefined): { valid: string[]; invalid: string[] } {
  const parts = (v ?? "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    const a = splitAddresses(p)[0];
    if (a && EMAIL_RE.test(a)) { if (!valid.includes(a)) valid.push(a); } else invalid.push(p);
  }
  return { valid, invalid };
}

/** Odkud by se odeslalo, podpis a dokumenty zakázky (pro okno psaní). */
export async function composeContextAction(input: { sourceEmailId?: string | null; jobId?: string | null }): Promise<{
  ok: boolean; error?: string; from?: string; fromError?: string; signature?: string;
  jobId?: string | null; jobFiles?: { id: string; filename: string; sizeBytes: number | null }[];
}> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, error: access.error };
  const c = await db();
  let replyMailboxId: string | null = null;
  let jobId: string | null = input.jobId && isUuidLike(input.jobId) ? input.jobId : null;
  if (input.sourceEmailId) {
    const found = await getVisibleEmailRow<{ mailbox_id: string | null; order_id: string | null }>(input.sourceEmailId, "order_id");
    if (found) {
      replyMailboxId = found.row.mailbox_id;
      jobId = jobId ?? found.row.order_id;
    }
  }
  const sender = await describeSender({ ownerId: access.user.id, replyMailboxId });
  // podpis schránky, ze které zpráva odejde (Pošta → Nastavení pošty); při odeslání se z textu
  // stane grafický podpis s logem (sendMail signature inline) — v okně psaní jde upravit i smazat
  const signature = await outgoingSignature({ userId: access.user.id, mailboxEmail: sender.ok ? sender.from : null })
    .then((s) => s.text.trim())
    .catch(() => "");
  const jobFiles = jobId ? await jobFilesFor(c, jobId) : [];
  return {
    ok: true,
    from: sender.ok ? sender.from : undefined,
    fromError: sender.ok ? undefined : sender.reason,
    signature,
    jobId,
    jobFiles,
  };
}

/**
 * Dokumenty zakázky, které smím přiložit: jen ty bez zámku obsahu (#25 — nákupní doklad bez práva na
 * ceny, PDF nabídky čekající na schválení / starší než poslední schválení). Kanonická pravidla
 * fileLocks; chyba ověření = zamčeno (fail closed).
 */
async function jobFilesFor(c: Db, jobId: string): Promise<{ id: string; filename: string; sizeBytes: number | null }[]> {
  const access = await getAccess();
  if (!access.can("orders")) return [];
  const { data, error } = await c.from("job_files")
    .select("id, filename, size_bytes, storage_path, archived, kind, issuer, origin, quote_id, created_at")
    .eq("job_id", jobId).order("created_at", { ascending: false }).limit(100);
  if (error) return [];
  type Row = { id: string; filename: string | null; size_bytes: number | null; storage_path: string | null; archived: boolean | null; kind: string; issuer: string | null; origin: string | null; quote_id: string | null; created_at: string };
  const rows = ((data ?? []) as Row[]).filter((f) => f.storage_path && !f.archived);
  if (!rows.length) return [];
  const locks = await fileLocks(c as unknown as JobsDb, rows.map((f) => ({ id: f.id, kind: f.kind, issuer: f.issuer, origin: f.origin, quoteId: f.quote_id, createdAt: f.created_at })), access);
  return rows.filter((r) => !locks.get(r.id)).map((r) => ({ id: r.id, filename: r.filename ?? "soubor", sizeBytes: r.size_bytes }));
}

/** Podepsané nahrání přílohy z počítače (soubor jde přímo do úložiště, ne přes server). */
export async function prepareMailUploadAction(input: { filename: string; size: number; contentType?: string }): Promise<{ ok: boolean; error?: string; path?: string; token?: string }> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, error: access.error };
  const name = (input?.filename ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 150) || "priloha";
  const size = Number(input?.size);
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "Soubor je prázdný." };
  if (size > MAX_ATTACHMENT_BYTES) return { ok: false, error: "Příloha je příliš velká (max. 20 MB)." };
  const path = `mail/drafts/${access.user.id}/${crypto.randomUUID()}/${name}`;
  const { data, error } = await (await db()).storage.from(UPLOAD_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) return { ok: false, error: error?.message ?? "Nahrání přílohy se nepodařilo připravit." };
  return { ok: true, path: data.path ?? path, token: data.token };
}

export interface RecipientSuggestion {
  email: string;
  name: string;
  kind: "zákazník" | "dodavatel" | "kolega" | "kontakt";
}

/** Našeptávač adres: kontakty zákazníků a dodavatelů, kolegové. */
export async function searchRecipientsAction(query: string): Promise<RecipientSuggestion[]> {
  const access = await checkFeature("mail");
  if ("error" in access) return [];
  const q = (query ?? "").trim().replace(/[%_,()\\]/g, " ").trim().slice(0, 60);
  if (q.length < 2) return [];
  const { can } = await getAccess();
  const c = await db();
  const like = `%${q}%`;
  const own = can("mail_all") ? null : access.user.id;
  let customers = c.from("customers").select("name, email, owner_id").or(`name.ilike.${like},email.ilike.${like}`).not("email", "is", null).limit(8);
  if (own) customers = customers.or(`owner_id.eq.${own},owner_id.is.null`);
  const [cu, cc, su, us] = await Promise.all([
    customers,
    c.from("customer_contacts").select("name, email, customer:customers!customer_id(name, owner_id)").or(`name.ilike.${like},email.ilike.${like}`).not("email", "is", null).limit(12),
    c.from("suppliers").select("name, email, contact_person").or(`name.ilike.${like},email.ilike.${like},contact_person.ilike.${like}`).not("email", "is", null).limit(8),
    c.from("profiles").select("full_name, email, active").or(`full_name.ilike.${like},email.ilike.${like}`).limit(8),
  ]);
  const out: RecipientSuggestion[] = [];
  const add = (email: string | null | undefined, name: string, kind: RecipientSuggestion["kind"]) => {
    const e = splitAddresses(email)[0];
    if (e && !out.some((o) => o.email === e)) out.push({ email: e, name: name.trim() || e, kind });
  };
  for (const r of (us.data ?? []) as { full_name: string | null; email: string | null; active: boolean | null }[]) if (r.active !== false) add(r.email, r.full_name ?? "", "kolega");
  for (const r of (cu.data ?? []) as { name: string; email: string | null }[]) add(r.email, r.name, "zákazník");
  for (const r of (cc.data ?? []) as { name: string; email: string | null; customer: { name: string | null; owner_id: string | null } | { name: string | null; owner_id: string | null }[] | null }[]) {
    const cust = Array.isArray(r.customer) ? r.customer[0] : r.customer;
    if (own && cust?.owner_id && cust.owner_id !== own) continue;
    add(r.email, `${r.name}${cust?.name ? ` (${cust.name})` : ""}`, "kontakt");
  }
  for (const r of (su.data ?? []) as { name: string; email: string | null; contact_person: string | null }[]) add(r.email, r.contact_person ? `${r.contact_person} (${r.name})` : r.name, "dodavatel");
  return out.slice(0, 12);
}

export async function saveSignatureAction(signature: string): Promise<{ ok: boolean; error?: string }> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, error: access.error };
  const text = typeof signature === "string" ? signature.replace(/\r\n/g, "\n").trim().slice(0, 2000) : "";
  const { error } = await (await db()).from("profiles").update({ mail_signature: text || null }).eq("id", access.user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/account");
  return { ok: true };
}

/** Odeslání napsané zprávy (nová / odpověď / odpovědět všem / přeposlání). */
export async function sendComposedAction(input: SendComposedInput): Promise<SendComposedResult> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, error: access.error };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  if (!input || typeof input !== "object") return { ok: false, error: "Chybí obsah zprávy." };
  const to = cleanList(input.to);
  const cc = cleanList(input.cc);
  const bcc = cleanList(input.bcc);
  const bad = [...to.invalid, ...cc.invalid, ...bcc.invalid];
  if (bad.length) return { ok: false, error: `Neplatná adresa: ${bad.slice(0, 3).join(", ")}.` };
  if (!to.valid.length) return { ok: false, error: "Doplň adresáta (Komu)." };
  if (to.valid.length + cc.valid.length + bcc.valid.length > 50) return { ok: false, error: "Najednou max. 50 adresátů." };
  const subject = (input.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 300);
  if (!subject) return { ok: false, error: "Doplň předmět." };
  const body = typeof input.body === "string" ? input.body.slice(0, 100_000) : "";
  const c = await db();

  // původní zpráva (odpověď / přeposlání) — jen viditelná
  type Source = {
    id: string; mailbox_id: string | null; message_id: string | null; message_refs: string[] | null; subject: string | null;
    order_id: string | null; customer_id: string | null; supplier_id: string | null; thread_id: string | null; category: string | null;
  };
  let source: Source | null = null;
  if (input.mode !== "new" && input.sourceEmailId) {
    const found = await getVisibleEmailRow<Source>(input.sourceEmailId, "id, message_id, message_refs, subject, order_id, customer_id, supplier_id, thread_id, category");
    if (!found) return { ok: false, error: "Původní e-mail nenalezen (nebo k němu nemáš přístup)." };
    source = found.row;
  }

  // přílohy
  const attachments: OutgoingAttachment[] = [];
  let total = 0;
  const uploads: string[] = [];
  for (const a of (input.attachments ?? []).slice(0, 30)) {
    if (!a || typeof a.ref !== "string") continue;
    let file: OutgoingAttachment | null = null;
    if (a.kind === "upload") {
      const prefix = `mail/drafts/${access.user.id}/`;
      if (!a.ref.startsWith(prefix) || a.ref.includes("..")) return { ok: false, error: "Neplatná příloha." };
      const { data: blob, error } = await c.storage.from(UPLOAD_BUCKET).download(a.ref);
      if (error || !blob) return { ok: false, error: `Přílohu „${a.filename ?? "soubor"}" se nepodařilo načíst — nahraj ji znovu.` };
      file = { filename: a.filename?.trim() || a.ref.split("/").pop() || "priloha", content: Buffer.from(await blob.arrayBuffer()), contentType: a.contentType || blob.type || undefined };
      uploads.push(a.ref);
    } else if (a.kind === "job") {
      if (!isUuidLike(a.ref)) continue;
      const access = await getAccess();
      if (!access.can("orders")) return { ok: false, error: "K dokumentům zakázky nemáš přístup." };
      // stejná kontrola jako odeslání dokumentu ze zakázky (nákupní doklad, nabídka čekající na schválení …)
      const chk = await assertJobFileAccess(c as unknown as JobsDb, a.ref, access, "send");
      if (!chk.ok) return { ok: false, error: chk.error };
      const f = chk.file;
      if (!f.storage_path) return { ok: false, error: "Dokument zakázky nenalezen." };
      const { data: blob, error } = await c.storage.from("job-files").download(f.storage_path);
      if (error || !blob) return { ok: false, error: `Dokument „${f.filename ?? "soubor"}" se nepodařilo načíst.` };
      file = { filename: f.filename || "soubor", content: Buffer.from(await blob.arrayBuffer()), contentType: f.mime_type || undefined };
    } else if (a.kind === "original") {
      if (!isUuidLike(a.ref)) continue;
      const { data: att } = await c.from("email_attachments").select("email_id").eq("id", a.ref).maybeSingle();
      const emailId = (att as { email_id: string } | null)?.email_id;
      if (!emailId || !(await getVisibleEmailRow(emailId, "id"))) return { ok: false, error: "Původní příloha nenalezena." };
      const loaded = await loadEmailAttachment(a.ref);
      if (!loaded.ok) return { ok: false, error: loaded.error };
      file = loaded.file;
    }
    if (!file) continue;
    total += file.content.length;
    if (total > MAX_TOTAL) return { ok: false, error: "Přílohy jsou dohromady příliš velké (max. 25 MB)." };
    attachments.push(file);
  }

  const headers = source && (input.mode === "reply" || input.mode === "replyAll")
    ? replyHeaders({ messageId: source.message_id, references: source.message_refs, subject: source.subject })
    : null;
  const jobId = (input.jobId && isUuidLike(input.jobId) ? input.jobId : null) ?? source?.order_id ?? null;
  const res = await sendMail({
    to: to.valid.join(", "),
    cc: cc.valid.length ? cc.valid.join(", ") : undefined,
    bcc: bcc.valid.length ? bcc.valid.join(", ") : undefined,
    subject,
    text: body,
    attachments: attachments.length ? attachments : undefined,
    from: { ownerId: access.user.id, replyMailboxId: source?.mailbox_id ?? null },
    senderId: access.user.id,
    inReplyTo: headers?.inReplyTo ?? null,
    references: headers?.references ?? null,
    jobId: jobId ?? undefined,
    customerId: source?.customer_id ?? null,
    supplierId: source?.supplier_id ?? null,
    // podpis vložilo okno psaní (uživatel ho mohl upravit / smazat) → jen převést na grafický, nepřidávat
    signature: { userId: access.user.id, mode: "inline" },
    // odpověď / přeposlání: kategorie zprávy, na kterou odpovídám (jinak podle předmětu)
    category: source && input.mode !== "forward" && isDbEmailCategory(source.category) && source.category !== "spam" && source.category !== "ostatni"
      ? source.category : undefined,
  });
  if (!res.sent) return { ok: false, error: res.reason ?? "Odeslání selhalo." };

  // vlákno: odpověď i přeposlání patří do vlákna původní zprávy (DB ho z In-Reply-To odvodí jen ve
  // stejné schránce — odpověď z jiné schránky / globálního SMTP by jinak založila nové vlákno)
  if (res.emailId && source?.thread_id && input.mode !== "new") {
    await c.from("emails").update({ thread_id: source.thread_id }).eq("id", res.emailId);
  }
  if (uploads.length) await c.storage.from(UPLOAD_BUCKET).remove(uploads).catch(() => undefined);
  await logAudit({
    action: "email_sent", entity: "emails", entityId: res.emailId,
    diff: { mode: input.mode, to: to.valid, cc: cc.valid, bcc: bcc.valid.length, subject, attachments: attachments.length, from: res.fromAddress, sentCopy: res.sentCopy },
    actor: userActor(access.user),
  });
  revalidatePath("/inbox");
  revalidatePath("/sent");
  if (jobId) revalidatePath(`/orders/${jobId}`);
  return { ok: true, emailId: res.emailId, fromAddress: res.fromAddress, sentCopy: res.sentCopy, sentCopyText: sentCopyLabel(res.sentCopy, res.sentCopyError) };
}
