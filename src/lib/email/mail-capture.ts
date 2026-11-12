import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createOperatorClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { checkFeature } from "@/lib/auth/session";
import { getVisibleEmailRow } from "@/lib/data/mail";
import { logAudit } from "@/lib/audit";
import { loadEmailAttachment } from "@/lib/email/attachments";
import { extractAndApply, linkThread, type MailJobActor } from "@/lib/email/job-link-store";
import { cleanMailText, mailOwnText } from "@/lib/email/job-instructions";
import { matchPartyByEmail, type PartyRef } from "@/lib/email/match";
import { isUuidLike, jobPeopleFromEmail } from "@/lib/email/visibility";
import { customerOwnerOf, mailboxOwnerOf } from "@/lib/email/mail-job-people";
import {
  isImageAttachment, isSignatureImageSize, mailBodyForContext, mailTextExtractRules, phoneFromSignature, selectMailAttachments, senderContactPlan,
  senderNameOf, signatureInfo,
  type MailAttachmentRow, type MailAttachmentSkip, type MailCaptureContext, type SenderContactPlan,
} from "@/lib/email/mail-capture-input";
import { imageDimensions } from "@/lib/jobs/capture-files";
import { CAPTURE_BUCKET, capturePagePath, type CaptureFileRef } from "@/lib/jobs/capture-review";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { updateJob } from "@/app/actions/jobs";
import { setThreadJobAction } from "@/app/actions/mail-jobs";

/**
 * Pošta → dávka „Přidat doklad (foto)" (serverová část). Přílohy e-mailu se zkopírují do capture/<uživatel>/…
 * a projdou STEJNOU dávkou jako focení (capture-batch-service: roztřídění AI, vytěžení, pravidla dávky,
 * kontrola, uložení se správnými druhy). Po uložení finishMailCapture propojí vlákno se zakázkou, přílohy
 * e-mailu s uloženými dokumenty, propíše pokyny z textu e-mailu (Pošta B, pravidla bez AI) a kontaktní osobu.
 * Žádné AI při stažení pošty — čte se až po „Založit zakázku" / „Přidat k zakázce"; rozpracovaná dávka
 * e-mailu se při dalším otevření převezme (findMailCaptureSession), AI se neplatí dvakrát.
 */

const NOT_FOUND = "E-mail nenalezen (nebo k němu nemáš přístup).";

type EmailRow = {
  id: string; thread_id: string | null; subject: string | null; from_name: string | null; from_email: string | null;
  customer_id: string | null; supplier_id: string | null; category: string | null; body_text: string | null;
  order_id: string | null; direction: "in" | "out"; owner_id: string | null; mailbox_id: string | null; received_at: string | null;
};
const EMAIL_COLS = "id, thread_id, subject, from_name, from_email, customer_id, supplier_id, category, body_text, order_id, direction, received_at";

/** E-mail, který uživatel smí vidět (jinak null). */
export async function visibleMailForCapture(emailId: string): Promise<EmailRow | null> {
  if (!isUuidLike(emailId)) return null;
  const found = await getVisibleEmailRow<EmailRow>(emailId, EMAIL_COLS);
  return found?.row ?? null;
}

async function customerOf(db: JobsDb, email: Pick<EmailRow, "customer_id" | "from_email">): Promise<{ id: string; name: string } | null> {
  let id = email.customer_id;
  if (!id && email.from_email) {
    const { data } = await db.from("customers").select("id, email");
    id = matchPartyByEmail(email.from_email, (data ?? []) as PartyRef[]) ?? null;
  }
  if (!id) return null;
  const { data } = await db.from("customers").select("id, name").eq("id", id).maybeSingle();
  const row = data as { id: string; name: string } | null;
  return row ? { id: row.id, name: row.name } : null;
}

type AttachmentRowWithFile = MailAttachmentRow & { job_file_id?: string | null };

async function attachmentRows(db: JobsDb, emailId: string): Promise<AttachmentRowWithFile[]> {
  const { data } = await db.from("email_attachments").select("id, filename, mime_type, size_bytes, job_file_id").eq("email_id", emailId).order("filename", { ascending: true });
  return (data ?? []) as AttachmentRowWithFile[];
}

export const ALREADY_IN_JOB = "už je u zakázky";

/** Dokumenty zakázky podle obsahu (sha256 → id) — přílohy se stejným obsahem se znovu neukládají. */
async function jobFilesBySha(db: JobsDb, jobId: string): Promise<Map<string, string>> {
  const { data } = await db.from("job_files").select("id, content_sha256").eq("job_id", jobId).not("content_sha256", "is", null).limit(2000);
  return new Map(((data ?? []) as { id: string; content_sha256: string | null }[]).filter((f) => f.content_sha256).map((f) => [f.content_sha256 as string, f.id]));
}

/**
 * Přílohy, které už u cílové zakázky jsou („Přidat k zakázce" / „Změnit" u vlákna s přílohami, které tam
 * dřív uložila automatika nebo dřívější dávka): podle vazby přílohy na dokument (email_attachments.job_file_id)
 * a podle obsahu (sha256 — stejný soubor nahraný ručně). Vrací, co zbývá roztřídit, a vynechané s dokumentem.
 */
export async function splitAlreadyStored(
  db: JobsDb, rows: readonly AttachmentRowWithFile[], jobId: string, opts: { hash?: boolean; bySha?: Map<string, string> } = {},
): Promise<{ take: AttachmentRowWithFile[]; skipped: MailAttachmentSkip[] }> {
  const bySha = opts.bySha ?? await jobFilesBySha(db, jobId);
  const ids = new Set(bySha.values());
  const take: AttachmentRowWithFile[] = [];
  const skipped: MailAttachmentSkip[] = [];
  for (const r of rows) {
    const filename = (r.filename ?? "").trim() || "priloha";
    if (r.job_file_id && ids.has(r.job_file_id)) {
      skipped.push({ id: r.id, filename, reason: ALREADY_IN_JOB, jobFileId: r.job_file_id });
      continue;
    }
    if (opts.hash !== false && bySha.size) {
      const loaded = await loadEmailAttachment(r.id);
      if (loaded.ok) {
        const sha = createHash("sha256").update(new Uint8Array(loaded.file.content)).digest("hex");
        const fileId = bySha.get(sha);
        if (fileId) {
          skipped.push({ id: r.id, filename, reason: ALREADY_IN_JOB, jobFileId: fileId });
          continue;
        }
      }
    }
    take.push(r);
  }
  return { take, skipped };
}

/**
 * Kontext e-mailu bez souborů: odesílatel (jméno z podpisu / hlavičky — nikdy surová adresa), zákazník,
 * text, telefon z podpisu a text e-mailu vytěžený pravidly jako doklad (AI ho doplní při roztřídění).
 */
export async function mailContextOf(db: JobsDb, email: EmailRow, filenames: readonly string[] = []): Promise<MailCaptureContext> {
  const customer = await customerOf(db, email);
  const fromEmail = (email.from_email ?? "").trim().toLowerCase();
  const sig = signatureInfo(email.body_text, fromEmail);
  const fromName = senderNameOf({ fromName: email.from_name, fromEmail, body: email.body_text }, sig);
  const ctx: MailCaptureContext = {
    emailId: email.id,
    threadId: email.thread_id,
    subject: (email.subject ?? "").trim(),
    fromName,
    fromEmail,
    category: email.category,
    customerId: customer?.id ?? null,
    customerName: customer?.name ?? null,
    supplierId: customer ? null : email.supplier_id ?? null,
    body: mailBodyForContext(email.body_text),
    ownText: mailOwnText(email.body_text).slice(0, 8000),
    phone: sig.phone || phoneFromSignature(email.body_text),
    receivedAt: email.received_at ?? null,
    files: [],
    skipped: [],
  };
  ctx.extract = mailTextExtractRules({ ...ctx, rawBody: email.body_text }, filenames);
  return ctx;
}

/**
 * Přílohy e-mailu → stránky dávky v capture/<uživatel>/… (loga z podpisu, vizitky a duplicity se
 * přeskočí). Vrací odkazy pro analyzeBatch a kontext e-mailu se seznamem zkopírovaných příloh.
 */
export async function copyMailAttachmentsToCapture(
  db: JobsDb, userId: string, email: EmailRow, opts: { jobId?: string | null } = {},
): Promise<{ refs: CaptureFileRef[]; ctx: MailCaptureContext } | { error: string }> {
  const ctx = await mailContextOf(db, email);
  const selected = selectMailAttachments(await attachmentRows(db, email.id));
  const skip: MailAttachmentSkip[] = [...selected.skipped];
  let take: AttachmentRowWithFile[] = selected.take;
  // pevný cíl (Přidat k zakázce / Změnit): co už u zakázky je, se znovu neukládá (podle vazby i obsahu)
  const bySha = opts.jobId ? await jobFilesBySha(db, opts.jobId) : new Map<string, string>();
  if (opts.jobId) {
    // podle vazby hned; podle obsahu níže při kopírování (bajty se stejně načítají)
    const split = await splitAlreadyStored(db, take, opts.jobId, { hash: false, bySha });
    take = split.take;
    skip.push(...split.skipped);
  }
  const refs: CaptureFileRef[] = [];
  const seen = new Set<string>();
  for (const att of take) {
    const loaded = await loadEmailAttachment(att.id);
    const filename = (att.filename ?? "").trim() || "priloha";
    if (!loaded.ok) {
      skip.push({ id: att.id, filename, reason: loaded.error });
      continue;
    }
    const bytes = new Uint8Array(loaded.file.content);
    const mime = (att.mime_type || loaded.file.contentType || "application/octet-stream").toLowerCase();
    if (isImageAttachment(filename, mime) && isSignatureImageSize(imageDimensions(bytes))) {
      skip.push({ id: att.id, filename, reason: "logo / obrázek z podpisu" });
      continue;
    }
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (seen.has(sha)) {
      skip.push({ id: att.id, filename, reason: "stejná příloha dvakrát" });
      continue;
    }
    const stored = bySha.get(sha);
    if (stored) {
      skip.push({ id: att.id, filename, reason: ALREADY_IN_JOB, jobFileId: stored });
      continue;
    }
    seen.add(sha);
    const path = capturePagePath(userId, randomUUID(), filename);
    const { error } = await db.storage.from(CAPTURE_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
    if (error) {
      if (refs.length) await db.storage.from(CAPTURE_BUCKET).remove(refs.map((r) => r.path));
      return { error: `Přílohu ${filename} se nepodařilo připravit: ${error.message}` };
    }
    refs.push({ path, filename, mimeType: mime, size: bytes.length });
    ctx.files.push({ attachmentId: att.id, path, sha256: sha });
  }
  ctx.skipped = skip;
  // položky z textu podle čísel výkresů v názvech příloh
  ctx.extract = mailTextExtractRules({ ...ctx, rawBody: email.body_text }, refs.map((r) => r.filename));
  return { refs, ctx };
}

/** Rozpracovaná dávka příloh tohoto e-mailu (stejný uživatel a cíl) — převezme se, AI se neplatí znovu. */
export async function findMailCaptureSession(db: JobsDb, userId: string, emailId: string, fixedJobId: string | null): Promise<string | null> {
  const { data } = await db.from("capture_sessions").select("id, data, expires_at, status")
    .eq("user_id", userId.toLowerCase()).in("status", ["open", "partial"]).eq("data->mail->>emailId", emailId)
    .gt("expires_at", new Date().toISOString()).order("expires_at", { ascending: false }).limit(5);
  const rows = (data ?? []) as { id: string; data: { fixedJobId?: string | null } | null }[];
  const hit = rows.find((r) => (r.data?.fixedJobId ?? null) === (fixedJobId ?? null));
  return hit?.id ?? null;
}

// ── Plán pro dialog (bez AI, bez kopírování) ────────────────
export interface MailCapturePlan {
  ok: true;
  /** Přílohy, které půjdou do dávky (0 = bez příloh → dnešní tok z textu e-mailu). */
  files: number;
  skipped: MailAttachmentSkip[];
  subject: string;
  customer: { id: string; name: string } | null;
  sender: SenderContactPlan;
  /** E-mail už patří k zakázce. */
  jobId: string | null;
  /** Dávka se dá převzít (už roztříděno). */
  resumable: boolean;
}

export async function mailCapturePlan(emailId: string, fixedJobId: string | null): Promise<MailCapturePlan | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  const access = await checkFeature("orders");
  if ("error" in access) return { ok: false, error: access.error };
  const email = await visibleMailForCapture(emailId);
  if (!email) return { ok: false, error: NOT_FOUND };
  const db = (await createOperatorClient()) as unknown as JobsDb;
  const [rows, ctx] = await Promise.all([attachmentRows(db, email.id), mailContextOf(db, email)]);
  const selected = selectMailAttachments(rows);
  let take = selected.take;
  const skipped = [...selected.skipped];
  if (fixedJobId && take.length) {
    // Přidat k zakázce / Změnit: přílohy, které u zakázky už jsou, do dávky nejdou (bez nich = jen přiřazení vlákna)
    const split = await splitAlreadyStored(db, take, fixedJobId);
    take = split.take;
    skipped.push(...split.skipped);
  }
  let contacts: { id: string; name: string | null; email: string | null }[] = [];
  if (ctx.customerId) {
    const { data } = await db.from("customer_contacts").select("id, name, email").eq("customer_id", ctx.customerId).limit(300);
    contacts = (data ?? []) as typeof contacts;
  }
  const resumable = hasServiceKey() && take.length > 0
    ? Boolean(await findMailCaptureSession(db, access.user.id, email.id, fixedJobId).catch(() => null))
    : false;
  return {
    ok: true,
    // dávka potřebuje servisní klíč (relace v DB) — bez něj dnešní tok
    files: hasServiceKey() ? take.length : 0,
    skipped,
    subject: ctx.subject,
    customer: ctx.customerId ? { id: ctx.customerId, name: ctx.customerName ?? "" } : null,
    sender: senderContactPlan({
      name: ctx.fromName, email: ctx.fromEmail, phone: ctx.phone,
      position: ctx.extract?.person.position, company: ctx.customerId ? undefined : ctx.extract?.doc.customer.name,
    }, ctx.customerId, contacts),
    jobId: email.order_id,
    resumable,
  };
}

// ── Po uložení dávky ────────────────────────────────────────
export interface FinishMailCaptureInput {
  emailId: string;
  captureId: string;
  jobId: string;
  /** Zakázka v dávce nově založená. */
  created: boolean;
  /** Přidat odesílatele do Karty zákazníka a nastavit ho jako kontaktní osobu zakázky. */
  addContact: boolean;
  /** „Změnit" u vlákna, které už patří k jiné zakázce: po uložení dávky vlákno přesunout k této zakázce. */
  relink?: boolean;
}

export interface FinishMailCaptureResult {
  ok: boolean;
  error?: string;
  jobNumber?: string;
  /** Přílohy e-mailu propojené s uloženými dokumenty. */
  linkedFiles?: number;
  /** Pokyny z textu e-mailu zapsané k zakázce. */
  changes?: number;
  contact?: "added" | "linked" | null;
}

/**
 * Po uložení dávky příloh: vlákno → zakázka (zdroj „založeno z e-mailu" / „ručně"), přílohy e-mailu ↔
 * uložené dokumenty (podle obsahu — pozdější automatika je neuloží znovu), zakázka založená z e-mailu
 * patří vlastníkovi schránky (#25), pokyny z textu e-mailu (pravidla, bez AI) a kontaktní osoba.
 */
export async function finishMailCapture(input: FinishMailCaptureInput): Promise<FinishMailCaptureResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  const access = await checkFeature("orders");
  if ("error" in access) return { ok: false, error: access.error };
  if (!isUuidLike(input.jobId) || !isUuidLike(input.captureId)) return { ok: false, error: "Zakázka nenalezena." };
  const { user } = access;
  const email = await visibleMailForCapture(input.emailId);
  if (!email) return { ok: false, error: NOT_FOUND };
  const actorCtx = userActor(user);
  const a: MailJobActor = { db: (await createOperatorClient({ actor: actorCtx })) as unknown as SupabaseClient, actorId: user.id, kind: "user", ctx: actorCtx };
  const db = a.db as unknown as JobsDb;
  const { data: jobRow } = await db.from("orders").select("id, number, customer_id, owner_id, assignee_id, customer_contact_id, merged_into_id").eq("id", input.jobId).maybeSingle();
  const job = jobRow as { id: string; number: string; customer_id: string | null; owner_id: string | null; assignee_id: string | null; customer_contact_id: string | null; merged_into_id: string | null } | null;
  if (!job) return { ok: false, error: "Zakázka nenalezena." };
  const jobId = job.merged_into_id ?? job.id;
  const out: FinishMailCaptureResult = { ok: true, jobNumber: job.number, linkedFiles: 0, changes: 0, contact: null };

  // 1) vlákno → zakázka (e-mail už u jiné zakázky se nepřepisuje — jen při výslovném „Změnit" se vlákno přesune)
  if (email.order_id && email.order_id !== jobId) {
    if (!input.relink) return { ok: false, jobNumber: job.number, error: "E-mail už patří k jiné zakázce — přílohy jsou uložené, vlákno zůstalo u původní zakázky." };
    if (email.thread_id) {
      const r = await setThreadJobAction(email.thread_id, jobId);
      if (!r.ok) return { ok: false, jobNumber: job.number, error: r.error ?? "Vlákno se nepodařilo přesunout k zakázce." };
      out.changes = r.changes ?? 0;
    } else {
      await a.db.from("emails").update({
        order_id: jobId, job_link_source: "manual", job_link_actor: "user", job_linked_at: new Date().toISOString(), job_linked_by: user.id, job_match_at: new Date().toISOString(),
      }).eq("id", email.id);
    }
  }
  if (!email.order_id) {
    const { data: em } = await a.db.from("emails").select("id, thread_id, subject, direction, category, supplier_id, customer_id, from_name, from_email").eq("id", email.id).maybeSingle();
    if (em) {
      const r = await linkThread(a, { email: em as never, jobId, source: input.created ? "created" : "manual", confidence: null, strong: true });
      if (!r.ok) return { ok: false, jobNumber: job.number, error: r.error ?? "E-mail se nepodařilo přiřadit k zakázce." };
    }
    await a.db.from("emails").update({
      job_link_source: input.created ? "created" : "manual", job_link_actor: "user", job_linked_at: new Date().toISOString(), job_linked_by: user.id, job_match_at: new Date().toISOString(),
    }).eq("id", email.id);
  }

  // 2) přílohy e-mailu ↔ uložené dokumenty (stejný obsah)
  const { data: sess } = await db.from("capture_sessions").select("data").eq("id", input.captureId).eq("user_id", user.id.toLowerCase()).maybeSingle();
  const mail = ((sess as { data?: { mail?: MailCaptureContext | null } } | null)?.data?.mail ?? null);
  if (mail && mail.emailId === email.id && mail.files.length) {
    const { data: files } = await db.from("job_files").select("id, content_sha256").eq("job_id", jobId).in("content_sha256", mail.files.map((f) => f.sha256));
    const bySha = new Map(((files ?? []) as { id: string; content_sha256: string }[]).map((f) => [f.content_sha256, f.id]));
    for (const f of mail.files) {
      const fileId = bySha.get(f.sha256);
      if (!fileId) continue;
      const { error } = await db.from("email_attachments").update({ job_file_id: fileId }).eq("id", f.attachmentId).eq("email_id", email.id);
      if (!error) out.linkedFiles = (out.linkedFiles ?? 0) + 1;
    }
  }
  // přílohy, které u zakázky už byly (vynechané z dávky) → vazba na jejich dokument (příště bez čtení obsahu)
  for (const sk of mail?.emailId === email.id ? mail.skipped : []) {
    if (!sk.jobFileId) continue;
    await db.from("email_attachments").update({ job_file_id: sk.jobFileId }).eq("id", sk.id).eq("email_id", email.id).is("job_file_id", null);
  }

  // 3) zakázka založená z e-mailu: obchodník podle schránky (#25), zdroj e-mail
  if (input.created) {
    const people = jobPeopleFromEmail({
      mailboxOwner: await mailboxOwnerOf(db, email.owner_id, email.mailbox_id),
      customerOwnerId: await customerOwnerOf(db, job.customer_id),
      actor: { id: user.id, role: user.role },
    });
    const patch: Record<string, unknown> = { email_id: email.id };
    if (people.ownerId && people.ownerId !== job.owner_id) patch.owner_id = people.ownerId;
    if (people.assigneeId && !job.assignee_id) patch.assignee_id = people.assigneeId;
    const { error } = await db.from("orders").update(patch as never).eq("id", jobId);
    if (error) console.error(`[mail-capture] Lidé zakázky z e-mailu: ${error.message}`);
  }

  // 4) Pošta B: pokyn zákazníka v textu e-mailu je nadřazený výkresu (pravidla, bez AI — jako dřív)
  if (cleanMailText(email.body_text)) {
    const r = await extractAndApply(a, email.id, jobId, { mode: input.created ? "full" : undefined, party: "customer", allowOld: true, force: true });
    out.changes = r.changes;
  }

  // 5) kontaktní osoba = odesílatel (Karta zákazníka): jméno z podpisu / hlavičky (nikdy surová adresa),
  //    telefon a pozice z podpisu; existující kontakt se propojí, nový jen se souhlasem
  const { data: fresh } = await db.from("orders").select("customer_id, customer_contact_id").eq("id", jobId).maybeSingle();
  const now = fresh as { customer_id: string | null; customer_contact_id: string | null } | null;
  const fromEmail = (email.from_email ?? "").trim().toLowerCase();
  if (now?.customer_id && fromEmail) {
    const person = mail?.emailId === email.id ? mail.extract?.person ?? null : null;
    const sig = signatureInfo(email.body_text, fromEmail);
    const name = person?.name || senderNameOf({ fromName: email.from_name, fromEmail, body: email.body_text }, sig);
    const phone = person?.phone || sig.phone;
    const position = person?.position || sig.position;
    const { data: contacts } = await db.from("customer_contacts").select("id, name, email, phone").eq("customer_id", now.customer_id).limit(300);
    const list = (contacts ?? []) as { id: string; name: string; email: string | null; phone: string | null }[];
    const existing = list.find((k) => (k.email ?? "").trim().toLowerCase() === fromEmail) ?? null;
    if ((existing && now.customer_contact_id !== existing.id && (input.created || !now.customer_contact_id)) || (!existing && input.addContact)) {
      const r = await updateJob(jobId, { newCustomerContact: { name: name || undefined, email: fromEmail } });
      if (r.ok) out.contact = existing ? "linked" : "added";
      else console.error(`[mail-capture] Kontakt odesílatele: ${r.error}`);
    }
    // telefon a pozice z podpisu do Karty zákazníka (jen prázdné)
    if (phone || position) {
      const { data: k } = await db.from("customer_contacts").select("id, phone, position").eq("customer_id", now.customer_id).eq("email", fromEmail).maybeSingle();
      const row = k as { id: string; phone: string | null; position: string | null } | null;
      const patch: Record<string, string> = {};
      if (row && !row.phone && phone) patch.phone = phone;
      if (row && !row.position && position) patch.position = position.slice(0, 120);
      if (row && Object.keys(patch).length) await db.from("customer_contacts").update(patch as never).eq("id", row.id);
    }
  }

  await logJobEvent(db, {
    jobId, type: "email",
    message: `Přílohy e-mailu „${(email.subject ?? "").trim().slice(0, 160) || "(bez předmětu)"}“ roztříděny a uloženy${out.linkedFiles ? ` (${out.linkedFiles})` : ""}`,
    data: { emailId: email.id, captureId: input.captureId, created: input.created, contact: out.contact },
    actorId: user.id,
  });
  await logAudit({ action: input.created ? "job_created_from_email" : "email_linked_to_job", entity: "orders", entityId: jobId, diff: { emailId: email.id, captureId: input.captureId, via: "capture" } });
  for (const p of ["/orders", "/inbox", "/inquiries", "/confirmations", "/"]) revalidatePath(p);
  revalidatePath(`/orders/${jobId}`);
  return out;
}
