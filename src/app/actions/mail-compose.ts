"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkFeature, getAccess } from "@/lib/auth/session";
import type { CurrentUser as SessionUser } from "@/lib/data/current-user";
import { userActor } from "@/lib/supabase/actor-headers";
import { logAudit } from "@/lib/audit";
import { getVisibleEmailRow } from "@/lib/data/mail";
import { describeSender, sendMail, type OutgoingAttachment } from "@/lib/email/send";
import { outgoingSignature } from "@/lib/email/signature-server";
import { loadEmailAttachment, MAX_ATTACHMENT_BYTES } from "@/lib/email/attachments";
import { replyHeaders, splitAddresses } from "@/lib/email/threading";
import { sentCopyLabel } from "@/lib/email/mail-folders";
import { attachmentIssuer, isDbEmailCategory, isUuidLike } from "@/lib/email/visibility";
import { assertJobFileAccess, fileLocks } from "@/lib/jobs/job-file-access";
import { guessFileKind } from "@/lib/jobs/file-kinds";
import { SHARE_FILE_SELECT, pickShareFile, sharePriceDocIds, verifyShareBytes, type FileRowWithAnon } from "@/lib/anonymize/share";
import { isAnonCandidate, isUnsupportedExt, unsupportedHowTo } from "@/lib/anonymize/candidate";
import { enqueue as enqueueAnon, kickInBackground } from "@/lib/anonymize/queue";
import {
  ADHOC_ANON_EXT_RE, adhocAnonPrefix, blockedAttachmentMessage, isInlineImage, recipientsAllowOriginals, type BlockReason,
} from "@/lib/email/attachment-anon";
import type { JobsDb } from "@/lib/jobs/events";
import { searchRecipients } from "@/lib/contacts/suggest-server";
import { aiToneOf, toneFor } from "@/lib/contacts/server";
import { draftReply } from "@/lib/ai/claude";
import { getAgentInstructions } from "@/lib/ai/corrections";
import type { RecipientSuggestion } from "@/lib/contacts/suggest";
import type { EmailCategory as DbEmailCategory } from "@/lib/supabase/database.types";

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
  /** Dokument zakázky / příloha přeposílaného e-mailu: výslovně „Poslat originál" (výkres zákazníka bez anonymizace — jen super admin, audit). */
  original?: boolean;
}

/** Příloha zablokovaná ochranou výkresů zákazníka (komu nepatří, jde jen anonymizovaná kopie). */
export interface BlockedAttachment {
  /** Druh odkazu v okně psaní (dokument zakázky / příloha přeposílaného e-mailu). */
  kind: "job" | "original";
  ref: string;
  filename: string;
  reason: string;
  message: string;
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
  /** Zpráva z fronty K odeslání (opakované odeslání ze stejného okna — bez dvojí položky ve frontě). */
  outboxId?: string | null;
}

export interface SendComposedResult {
  ok: boolean;
  error?: string;
  emailId?: string;
  fromAddress?: string;
  sentCopy?: "ok" | "failed" | "skipped";
  sentCopyText?: string;
  /** Odeslání selhalo, zpráva čeká ve frontě K odeslání (odejde tlačítkem Přijmout a odeslat). */
  queued?: boolean;
  outboxId?: string;
  /** Chyba nastavení schránky (heslo / SMTP) — uživatel ji opraví v Pošta → Nastavení pošty. */
  needsSettings?: boolean;
  /** Výkresy zákazníka, které adresát (není zákazník zakázky) nesmí dostat bez anonymizace. */
  blocked?: BlockedAttachment[];
  /** Smí volající výslovně poslat originál (super admin). */
  canSendOriginal?: boolean;
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

export type { RecipientSuggestion } from "@/lib/contacts/suggest";

/**
 * Našeptávač adres (všude, kde se píše e-mail): kontaktní osoby zákazníků a dodavatelů (jméno, firma,
 * pozice, účel adresy), firmy, kolegové a adresy z mé pošty (četnost, čerstvost). Kontext (zákazník,
 * dodavatel, zakázka) dá jejich adresy nahoru — i bez psaní. Viditelnost: src/lib/contacts/suggest-server.ts.
 */
export async function searchRecipientsAction(
  query: string,
  ctx?: { customerId?: string | null; supplierId?: string | null; jobId?: string | null; exclude?: string[] } | null,
): Promise<RecipientSuggestion[]> {
  const { user, can } = await getAccess();
  if (!user || !user.active || !(can("mail") || can("customers") || can("suppliers") || can("orders"))) return [];
  if (!isSupabaseConfigured()) return [];
  const safe = {
    customerId: isUuidLike(ctx?.customerId) ? ctx!.customerId : null,
    supplierId: isUuidLike(ctx?.supplierId) ? ctx!.supplierId : null,
    jobId: isUuidLike(ctx?.jobId) ? ctx!.jobId : null,
  };
  const exclude = Array.isArray(ctx?.exclude) ? ctx!.exclude.filter((e) => typeof e === "string").slice(0, 50) : [];
  try {
    return await searchRecipients(await db(), { userId: user.id, all: can("mail_all"), mail: can("mail") }, String(query ?? ""), safe, { exclude });
  } catch {
    return [];
  }
}

/**
 * „AI návrh odpovědi" v okně psaní: AI (bez klíče šablona) napíše odpověď na zprávu s MÝM tykáním /
 * vykáním s hlavním adresátem (Komu); bez podpisu a závěrečného pozdravu — podpis schránky je pod textem.
 */
export async function draftComposeAction(input: { sourceEmailId: string; to?: string[] }): Promise<{ ok: boolean; error?: string; body?: string; salutation?: string }> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, error: access.error };
  if (!input || !isUuidLike(input.sourceEmailId)) return { ok: false, error: "Zpráva nenalezena." };
  const found = await getVisibleEmailRow<{ from_email: string | null; from_name: string | null; subject: string | null; body_text: string | null; category: string | null }>(
    input.sourceEmailId, "from_email, from_name, subject, body_text, category",
  );
  if (!found) return { ok: false, error: "Zpráva nenalezena." };
  const r = found.row;
  const to = (Array.isArray(input.to) ? input.to : []).filter((e) => typeof e === "string").slice(0, 20);
  const main = splitAddresses(to.join(","))[0] ?? splitAddresses(r.from_email)[0] ?? null;
  const c = await db();
  const tone = await toneFor(c, access.user.id, main ? [main] : [], main && main === splitAddresses(r.from_email)[0] ? r.from_name : null).catch(() => null);
  try {
    const rules = await getAgentInstructions("email").catch(() => undefined);
    const body = await draftReply({
      from: r.from_email ?? "", subject: r.subject ?? "", body: r.body_text ?? "", category: r.category ?? undefined, rules,
      tone: tone ? aiToneOf(tone) : null, signal: AbortSignal.timeout(60_000),
    });
    return { ok: true, body: body.trim(), salutation: tone?.salutation };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `AI návrh selhal: ${e.message}` : "AI návrh selhal." };
  }
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

/**
 * Odeslání napsané zprávy (nová / odpověď / odpovědět všem / přeposlání). Selže-li samotné odeslání
 * (heslo, SMTP server, spojení), zpráva se uloží do fronty K odeslání (mail_outbox) — odejde tlačítkem
 * „Přijmout a odeslat", až uživatel opraví nastavení schránky. Kontroly obsahu (adresy, předmět,
 * přílohy) do fronty nevedou — ty opraví hned v okně psaní.
 */
export async function sendComposedAction(input: SendComposedInput): Promise<SendComposedResult> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, error: access.error };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  if (!input || typeof input !== "object") return { ok: false, error: "Chybí obsah zprávy." };
  const outboxId = isUuidLike(input.outboxId) ? input.outboxId : null;
  const res = await composeAndSend(access.user, input);
  const c = await db();
  if (res.ok) {
    if (outboxId) await finishOutbox(c, access.user.id, outboxId, { ok: true, emailId: res.emailId });
    return res;
  }
  if (res.stage !== "send") {
    return { ok: false, error: res.error, ...(res.blocked ? { blocked: res.blocked, canSendOriginal: res.canSendOriginal } : {}) };
  }
  const queuedId = await queueOutbox(c, access.user.id, input, res.error ?? "Odeslání selhalo.", outboxId);
  return { ok: false, error: res.error, needsSettings: needsMailSettings(res.error), ...(queuedId ? { queued: true, outboxId: queuedId } : {}) };
}

// ── Výkresy zákazníka v příloze (ochrana anonymizace, audit 30. 10.) ──

type Guarded =
  | { kind: "plain"; original?: boolean }
  | { kind: "file"; file: OutgoingAttachment; original: boolean }
  | { kind: "blocked"; blocked: BlockedAttachment };

/** Komu výkres zákazníka patří: zákazník zakázky / e-mailu (adresy, kontakty, doména) a odesílatel přeposílané zprávy. */
interface OriginalScope {
  jobId?: string | null;
  customerId?: string | null;
  customerEmails?: string[];
}

/** Jsou všichni adresáti zákazník (jeho adresy / doména) nebo my? Pak smí jít originál. */
async function originalsAllowed(c: Db, scope: OriginalScope, recipients: string[]): Promise<boolean> {
  if (!recipients.length) return false;
  const ids = new Set<string>();
  if (scope.customerId) ids.add(scope.customerId);
  if (scope.jobId) {
    const { data: job } = await c.from("orders").select("customer_id").eq("id", scope.jobId).maybeSingle();
    const cid = (job as { customer_id: string | null } | null)?.customer_id ?? null;
    if (cid) ids.add(cid);
  }
  if (!ids.size && !scope.customerEmails?.length) return false;
  const cids = [...ids];
  const [cust, contacts, profs, boxes] = await Promise.all([
    cids.length ? c.from("customers").select("email").in("id", cids) : Promise.resolve({ data: [] }),
    cids.length ? c.from("customer_contacts").select("email").in("customer_id", cids) : Promise.resolve({ data: [] }),
    c.from("profiles").select("email").not("email", "is", null),
    c.from("mailboxes").select("email"),
  ]);
  const emails = (rows: unknown) => ((rows ?? []) as { email: string | null }[]).flatMap((r) => splitAddresses(r.email));
  const internalEmails = emails(profs.data);
  const internalDomains = emails(boxes.data).map((e) => e.split("@")[1] ?? "");
  // odesílatel přeposílané zprávy se za zákazníka počítá, jen když to není kolega (náš odeslaný e-mail)
  const internal = new Set([...internalEmails, ...emails(boxes.data)].map((e) => e.toLowerCase()));
  const extra = (scope.customerEmails ?? []).flatMap((e) => splitAddresses(e)).filter((e) => !internal.has(e.toLowerCase()));
  return recipientsAllowOriginals(recipients, {
    customerEmails: [...emails(cust.data), ...emails(contacts.data), ...extra],
    internalEmails,
    internalDomains,
  });
}

/**
 * Dokument zakázky v příloze: náš doklad nebo soubor, který se neanonymizuje → beze změny; výkres zákazníka
 * pro zákazníka zakázky / kolegu → originál; komukoli jinému → ověřená anonymizovaná kopie (pickShareFile +
 * verifyShareBytes), jinak zablokovat s hláškou. Originál výslovně jen super admin (audit).
 */
async function guardJobFile(c: Db, a: ComposeAttachmentRef, recipients: string[], user: SessionUser): Promise<Guarded> {
  const { data } = await c.from("job_files").select(SHARE_FILE_SELECT).eq("id", a.ref).maybeSingle();
  const row = data as FileRowWithAnon | null;
  if (!row) return { kind: "plain" };
  return guardShareRow(c, row, { kind: "job", ref: a.ref, filename: row.filename, original: a.original === true }, { jobId: row.job_id }, recipients, user);
}

/** Společné jádro: řádek job_files (dokument zakázky nebo příloha e-mailu uložená do zakázky). */
async function guardShareRow(
  c: Db, row: FileRowWithAnon, at: { kind: BlockedAttachment["kind"]; ref: string; filename: string; original: boolean },
  scope: OriginalScope, recipients: string[], user: SessionUser,
): Promise<Guarded> {
  if ((row.origin ?? "upload") === "generated" || row.issuer === "my") return { kind: "plain" };
  const candidate = isAnonCandidate(row.kind, row.filename, row.mime_type, row.origin, row.issuer);
  // poptávka / objednávka zákazníka se neanonymizuje (není výkres), ale komukoli mimo zákazníka a kolegy
  // ji nepustíme (dodavatel ji nikdy nedostane — jen výslovný originál od super admina)
  const customerDoc = !candidate && (row.kind === "poptavka" || row.kind === "objednavka");
  if (!candidate && !customerDoc && (row.anon_status === null || row.anon_status === "skipped")) return { kind: "plain" };
  if (await originalsAllowed(c, { ...scope, jobId: scope.jobId ?? row.job_id }, recipients)) return { kind: "plain" };
  const price = await sharePriceDocIds(c as never, [row.id]);
  const d = pickShareFile(row, { original: at.original, isSuperAdmin: user.role === "super_admin", priceDocument: price.has(row.id.toLowerCase()) });
  const block = (reason: BlockReason, detail?: string): Guarded => ({
    kind: "blocked", blocked: { kind: at.kind, ref: at.ref, filename: at.filename, reason, message: blockedAttachmentMessage(at.filename, reason, detail) },
  });
  if (!d.ok) {
    // výkres, který ještě nikdo nezařadil (starý soubor bez stavu) → anonymizovat teď, odeslat po dokončení
    if (d.reason === "pending" && row.anon_status === null && candidate) {
      const q = await enqueueAnon(c as never, { table: "job_files", fileIds: [row.id], via: "email" }).catch(() => null);
      if (q?.queued) kickInBackground({ table: "job_files", ids: [row.id], manualBy: user.id });
      if (q?.statuses[row.id] === "unsupported") return block("unsupported", unsupportedHowTo(row.filename));
    }
    return block(d.reason, d.message);
  }
  try {
    const bytes = await verifyShareBytes(c as never, d, row);
    return { kind: "file", file: { filename: d.filename, content: Buffer.from(bytes), contentType: d.mime }, original: d.source === "original" };
  } catch (err) {
    return block("failed", err instanceof Error ? err.message : undefined);
  }
}

// ── Přeposlání e-mailu s původními přílohami (stejná ochrana jako dokumenty zakázky) ──

type MailSource = {
  id: string; direction: string | null; category: DbEmailCategory | null; customer_id: string | null; supplier_id: string | null;
  order_id: string | null; from_email: string | null;
};
type AdhocRow = {
  id: string; user_id: string; storage_path: string; filename: string; anon_status: string; anon_path: string | null; anon_filename: string | null;
  anon_mime: string | null; anon_sha256: string | null; anon_reason: string | null; anon_lock_until: string | null;
};

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Původní příloha přeposílaného / přikládaného e-mailu: komu nepatří (není zákazník e-mailu / zakázky ani
 * kolega), dostane jen ověřenou anonymizovanou kopii — uloženou v zakázce (email_attachments.job_file_id),
 * jinak z anonymizace na požádání (samostatný nástroj drawing_anon_adhoc, fronta + šťouchnutí); do dokončení
 * zablokovat. Originál výslovně jen super admin (audit).
 */
async function guardMailAttachment(
  c: Db, a: ComposeAttachmentRef, att: { id: string; filename: string | null; mime_type: string | null; size_bytes: number | null; job_file_id: string | null },
  mail: MailSource, recipients: string[], user: SessionUser,
): Promise<Guarded> {
  const name = (att.filename ?? "").trim() || "priloha";
  if (isInlineImage(att.mime_type, att.size_bytes)) return { kind: "plain" }; // logo / podpis v těle zprávy
  const outbound = mail.direction === "outbound";
  const issuer = outbound ? null : attachmentIssuer({ category: mail.category, supplierId: mail.supplier_id, customerId: mail.customer_id });
  const guessedKind = guessFileKind(name, att.mime_type ?? undefined);
  const candidate = isAnonCandidate(guessedKind, name, att.mime_type, "email", issuer);
  const scope: OriginalScope = { jobId: mail.order_id, customerId: mail.customer_id, customerEmails: !outbound && mail.from_email ? [mail.from_email] : [] };

  // uložená v dokumentech zakázky → stav anonymizace toho souboru (stejně jako dokument zakázky)
  if (att.job_file_id) {
    const { data } = await c.from("job_files").select(SHARE_FILE_SELECT).eq("id", att.job_file_id).maybeSingle();
    const row = data as FileRowWithAnon | null;
    if (row) return guardShareRow(c, row, { kind: "original", ref: a.ref, filename: name, original: a.original === true }, scope, recipients, user);
  }
  // poptávka / objednávka zákazníka (podle názvu) — ne výkres, ale dodavateli ani nikomu cizímu ne
  const customerDoc = !candidate && !outbound && issuer !== "dodavatel" && (guessedKind === "poptavka" || guessedKind === "objednavka");
  if (!candidate && !customerDoc) return { kind: "plain" };
  if (await originalsAllowed(c, scope, recipients)) return { kind: "plain" };
  const block = (reason: BlockReason, detail?: string): Guarded => ({
    kind: "blocked", blocked: { kind: "original", ref: a.ref, filename: name, reason, message: blockedAttachmentMessage(name, reason, detail, "mail") },
  });
  if (customerDoc) {
    if (a.original === true && user.role === "super_admin") return { kind: "plain", original: true };
    return block(a.original === true ? "forbidden" : "excluded", "Poptávku / objednávku zákazníka dodavateli neposíláme — přilož výkresy (anonymizují se samy).");
  }
  if (a.original === true) {
    if (user.role !== "super_admin") return block("forbidden");
    return { kind: "plain", original: true }; // originál výslovně (super admin) — audit u odeslání
  }
  if (isUnsupportedExt(name) || !ADHOC_ANON_EXT_RE.test(name)) return block("unsupported", unsupportedHowTo(name));

  const loaded = await loadEmailAttachment(att.id);
  if (!loaded.ok) return block("failed", loaded.error);
  const bytes = new Uint8Array(loaded.file.content);
  const sha = await sha256Hex(bytes);
  const prefix = adhocAnonPrefix(user.id);
  const { data: found } = await c.from("drawing_anon_adhoc")
    .select("id, user_id, storage_path, filename, anon_status, anon_path, anon_filename, anon_mime, anon_sha256, anon_reason, anon_lock_until")
    .eq("user_id", user.id).eq("content_sha256", sha).neq("anon_status", "uploading").gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false }).limit(1);
  const row = ((found ?? []) as AdhocRow[])[0] ?? null;

  if (!row) {
    // anonymizace na požádání (stejná cesta jako Poptávky → „Anonymizovat výkres"): zdroj do capture/<uid>/anon/
    const safe = name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-100) || "vykres";
    const path = `capture/${user.id}/anon/${crypto.randomUUID()}-${safe}`;
    const { error: upErr } = await c.storage.from("job-files").upload(path, bytes, { contentType: loaded.file.contentType || "application/octet-stream", upsert: false });
    if (upErr) return block("failed", `Výkres se nepodařilo připravit k anonymizaci: ${upErr.message}`);
    const { data: ins, error } = await c.from("drawing_anon_adhoc").insert({
      user_id: user.id, storage_path: path, filename: name.slice(0, 200), mime_type: loaded.file.contentType || att.mime_type, size_bytes: bytes.length,
      content_sha256: sha, anon_status: "pending", anon_via: "email",
    }).select("id").single();
    if (error || !ins) {
      await c.storage.from("job-files").remove([path]).catch(() => undefined);
      return block("failed", error?.message);
    }
    const id = (ins as { id: string }).id;
    kickInBackground({ table: "drawing_anon_adhoc", ids: [id], manualBy: user.id });
    await logAudit({
      action: "drawing_anon_adhoc", entity: "drawing_anon_adhoc", entityId: id,
      diff: { sha256: sha, size: bytes.length, source: "email_forward", emailId: mail.id, attachmentId: att.id }, actor: userActor(user),
    });
    return block("pending");
  }
  switch (row.anon_status) {
    // „Ke kontrole" už nevzniká (plná automatika) — starší řádek s kopií platí jako hotový
    case "review":
    case "done": {
      try {
        const path = row.anon_path ?? "";
        if (!path.startsWith(prefix) || path.includes("..") || path === row.storage_path || !row.anon_sha256) throw new Error("Anonymizovaná kopie je na nečekaném místě — anonymizuj znovu.");
        const { data: blob, error } = await c.storage.from("job-files").download(path);
        if (error || !blob) throw new Error(`Anonymizovanou kopii se nepodařilo načíst: ${error?.message ?? "prázdný soubor"}`);
        const out = new Uint8Array(await blob.arrayBuffer());
        if ((await sha256Hex(out)) !== row.anon_sha256) throw new Error("Anonymizovaná kopie byla změněna — anonymizuj znovu.");
        return { kind: "file", file: { filename: row.anon_filename || "vykres.pdf", content: Buffer.from(out), contentType: row.anon_mime || "application/pdf" }, original: false };
      } catch (err) {
        return block("failed", err instanceof Error ? err.message : undefined);
      }
    }
    case "pending":
    case "processing":
      if (row.anon_status === "pending" || (row.anon_lock_until && Date.parse(row.anon_lock_until) < Date.now())) {
        kickInBackground({ table: "drawing_anon_adhoc", ids: [row.id], manualBy: user.id });
      }
      return block("pending");
    case "unsupported":
      return block("unsupported", row.anon_reason ?? undefined);
    default:
      return block("failed", row.anon_reason ?? undefined);
  }
}

// ── Fronta K odeslání (Přijmout a odeslat) ──────────────────

/** Chyba, kterou opraví nastavení schránky (heslo, SMTP), ne obsah zprávy. */
function needsMailSettings(error: string | undefined): boolean {
  return /přihlášení odmítnuto|heslo|smtp|odchozí server|schránk|nakonfigurováno/i.test(error ?? "");
}

const OUTBOX_MAX = 50;

/** Obsah okna psaní k uložení (bez cizích klíčů, ořezané délky). */
function outboxPayload(input: SendComposedInput): SendComposedInput {
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
  return {
    mode: input.mode === "reply" || input.mode === "replyAll" || input.mode === "forward" ? input.mode : "new",
    sourceEmailId: isUuidLike(input.sourceEmailId) ? input.sourceEmailId : null,
    to: s(input.to, 5000),
    cc: s(input.cc, 5000),
    bcc: s(input.bcc, 5000),
    subject: s(input.subject, 300),
    body: s(input.body, 100_000),
    attachments: (Array.isArray(input.attachments) ? input.attachments : []).slice(0, 30)
      .filter((a) => a && (a.kind === "upload" || a.kind === "job" || a.kind === "original") && typeof a.ref === "string")
      .map((a) => ({ kind: a.kind, ref: a.ref.slice(0, 500), filename: a.filename?.slice(0, 200), contentType: a.contentType?.slice(0, 100), ...(a.original === true ? { original: true } : {}) })),
    jobId: isUuidLike(input.jobId) ? input.jobId : null,
  };
}

/** Uložit / aktualizovat neodeslanou zprávu ve frontě. Bez tabulky (migrace neproběhla) → null. */
async function queueOutbox(c: Db, userId: string, input: SendComposedInput, error: string, outboxId: string | null): Promise<string | null> {
  const now = new Date().toISOString();
  const payload = outboxPayload(input);
  if (outboxId) {
    const { data: cur } = await c.from("mail_outbox").select("id, attempts").eq("id", outboxId).eq("created_by", userId).in("status", ["failed", "waiting", "sending"]).maybeSingle();
    const row = cur as { id: string; attempts: number } | null;
    if (row) {
      await c.from("mail_outbox").update({ payload, status: "failed", last_error: error.slice(0, 1000), attempts: row.attempts + 1, updated_at: now }).eq("id", row.id);
      return row.id;
    }
  }
  const { count } = await c.from("mail_outbox").select("id", { count: "exact", head: true }).eq("created_by", userId).in("status", ["failed", "waiting", "sending"]);
  if ((count ?? 0) >= OUTBOX_MAX) return null;
  const { data, error: insErr } = await c.from("mail_outbox")
    .insert({ created_by: userId, payload, status: "failed", last_error: error.slice(0, 1000), attempts: 1 })
    .select("id").maybeSingle();
  if (insErr) {
    console.error(`[mail:outbox] Zprávu se nepodařilo uložit do K odeslání: ${insErr.message}`);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

async function finishOutbox(c: Db, userId: string, id: string, r: { ok: boolean; emailId?: string; error?: string }): Promise<void> {
  const now = new Date().toISOString();
  await c.from("mail_outbox")
    .update(r.ok
      ? { status: "sent", sent_at: now, email_id: r.emailId ?? null, last_error: null, updated_at: now }
      : { status: "failed", last_error: (r.error ?? "Odeslání selhalo.").slice(0, 1000), updated_at: now })
    .eq("id", id).eq("created_by", userId);
}

export interface OutboxItem {
  id: string;
  to: string;
  subject: string;
  error: string | null;
  attempts: number;
  createdAt: string;
}

/** Moje zprávy čekající na odeslání (fronta K odeslání). */
export async function listOutboxAction(): Promise<{ ok: boolean; items: OutboxItem[]; error?: string }> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, items: [], error: access.error };
  if (!isSupabaseConfigured()) return { ok: true, items: [] };
  const c = await db();
  const { data, error } = await c.from("mail_outbox").select("id, payload, last_error, attempts, created_at")
    .eq("created_by", access.user.id).in("status", ["failed", "waiting", "sending"]).order("created_at", { ascending: true }).limit(OUTBOX_MAX);
  if (error) return { ok: true, items: [] }; // tabulka ještě není (migrace) = prázdná fronta
  type Row = { id: string; payload: SendComposedInput | null; last_error: string | null; attempts: number; created_at: string };
  return {
    ok: true,
    items: ((data ?? []) as Row[]).map((r) => ({
      id: r.id, to: r.payload?.to ?? "", subject: r.payload?.subject ?? "", error: r.last_error, attempts: r.attempts, createdAt: r.created_at,
    })),
  };
}

/** Zahodit zprávu z fronty K odeslání (neodešle se). */
export async function discardOutboxAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, error: access.error };
  if (!isUuidLike(id)) return { ok: false, error: "Zpráva nenalezena." };
  const c = await db();
  const { data, error } = await c.from("mail_outbox").update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id).eq("created_by", access.user.id).in("status", ["failed", "waiting"]).select("id, payload");
  if (error) return { ok: false, error: error.message };
  const row = ((data ?? []) as { id: string; payload: SendComposedInput | null }[])[0];
  if (!row) return { ok: false, error: "Zpráva nenalezena (nebo se právě odesílá)." };
  // nahrané přílohy zahozené zprávy z úložiště pryč (jen moje koncepty)
  const prefix = `mail/drafts/${access.user.id}/`;
  const uploads = (row.payload?.attachments ?? []).filter((a) => a.kind === "upload" && a.ref.startsWith(prefix) && !a.ref.includes("..")).map((a) => a.ref);
  if (uploads.length) await c.storage.from(UPLOAD_BUCKET).remove(uploads).catch(() => undefined);
  await logAudit({ action: "email_outbox_discarded", entity: "mail_outbox", entityId: id, diff: {}, actor: userActor(access.user) });
  return { ok: true };
}

export interface FlushOutboxResult {
  ok: boolean;
  error?: string;
  /** Odesláno z fronty K odeslání + z fronty anonymizace výkresů. */
  sent: number;
  /** Stále neodesláno (důvod v errors). */
  failed: number;
  errors: { subject: string; error: string }[];
  /** Některá chyba je v nastavení schránky (heslo / SMTP). */
  needsSettings: boolean;
  /** Odeslání s výkresy, které čekají na anonymizaci / kontrolu (odejdou samy po dokončení). */
  waitingDrawings: number;
  blockedDrawings: number;
}

/**
 * „Přijmout a odeslat" — odesílací část: odešle všechny MOJE čekající zprávy (fronta K odeslání,
 * nejvýš 20 najednou) a šťouchne do mé fronty odeslání čekajících na anonymizaci výkresů (pošle ty,
 * jejichž výkresy jsou už hotové). Cizí položky nikdy.
 */
export async function flushOutboxAction(): Promise<FlushOutboxResult> {
  const out: FlushOutboxResult = { ok: true, sent: 0, failed: 0, errors: [], needsSettings: false, waitingDrawings: 0, blockedDrawings: 0 };
  const access = await checkFeature("mail");
  if ("error" in access) return { ...out, ok: false, error: access.error };
  if (!isSupabaseConfigured()) return out;
  const c = await db();
  const me = access.user.id;
  // „sending" déle než 10 min = přerušený pokus (pád funkce) → zkusit znovu
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data, error } = await c.from("mail_outbox").select("id, payload, attempts, status")
    .eq("created_by", me).or(`status.in.(failed,waiting),and(status.eq.sending,updated_at.lt.${stale})`)
    .order("created_at", { ascending: true }).limit(20);
  if (!error) {
    type Row = { id: string; payload: SendComposedInput; attempts: number; status: string };
    for (const row of (data ?? []) as Row[]) {
      // claim: jen jeden běh tuto zprávu pošle
      const { data: claimed } = await c.from("mail_outbox")
        .update({ status: "sending", attempts: row.attempts + 1, updated_at: new Date().toISOString() })
        .eq("id", row.id).eq("created_by", me).eq("status", row.status).select("id");
      if (!(claimed ?? []).length) continue;
      let res: SendComposedResult & { stage?: string };
      try {
        res = await composeAndSend(access.user, row.payload ?? ({} as SendComposedInput));
      } catch (err) {
        res = { ok: false, error: err instanceof Error ? err.message : "Odeslání selhalo." };
      }
      await finishOutbox(c, me, row.id, res.ok ? { ok: true, emailId: res.emailId } : { ok: false, error: res.error });
      if (res.ok) out.sent++;
      else {
        out.failed++;
        out.errors.push({ subject: row.payload?.subject ?? "", error: res.error ?? "Odeslání selhalo." });
        if (needsMailSettings(res.error)) out.needsSettings = true;
      }
    }
    if ((data ?? []).length) {
      await logAudit({ action: "email_outbox_flush", entity: "mail_outbox", diff: { sent: out.sent, failed: out.failed }, actor: userActor(access.user) });
    }
  }
  // fronta anonymizace výkresů: moje čekající odeslání (výkresy hotové → odejdou teď, jinak počkají)
  try {
    const { data: anon, error: anonErr } = await c.from("anon_send_queue").select("id").eq("created_by", me).in("status", ["waiting", "blocked"]).limit(20);
    const ids = ((anon ?? []) as { id: string }[]).map((r) => r.id);
    if (!anonErr && ids.length) {
      const { flushSendQueue } = await import("@/lib/anonymize/send-queue");
      const r = await flushSendQueue(c, { ids });
      out.sent += r.sent;
      out.waitingDrawings = r.waiting;
      out.blockedDrawings = r.blocked;
    }
  } catch (err) {
    console.error(`[mail:outbox] Fronta odeslání s výkresy: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (out.sent) {
    revalidatePath("/inbox");
    revalidatePath("/sent");
  }
  return out;
}

/** Vlastní sestavení a odeslání (okno psaní i fronta K odeslání); `stage: "send"` = selhalo až odeslání. */
async function composeAndSend(user: SessionUser, input: SendComposedInput): Promise<SendComposedResult & { stage?: "check" | "send" }> {
  const access = { user };
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
  const blocked: BlockedAttachment[] = [];
  /** Výkresy zákazníka poslané výslovně v originále (super admin) — audit. */
  const originals: string[] = [];
  /** Totéž u příloh přeposílaného e-mailu (id email_attachments). */
  const originalAttachments: string[] = [];
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
      // výkres zákazníka komukoli mimo zákazníka zakázky (dodavatel …) → jen anonymizovaná kopie (anonymize/share.ts)
      const guarded = await guardJobFile(c, a, [...to.valid, ...cc.valid, ...bcc.valid], user);
      if (guarded.kind === "blocked") {
        blocked.push(guarded.blocked);
        continue;
      }
      if (guarded.kind === "file") {
        file = guarded.file;
        if (guarded.original) originals.push(a.ref);
      } else {
        const { data: blob, error } = await c.storage.from("job-files").download(f.storage_path);
        if (error || !blob) return { ok: false, error: `Dokument „${f.filename ?? "soubor"}" se nepodařilo načíst.` };
        file = { filename: f.filename || "soubor", content: Buffer.from(await blob.arrayBuffer()), contentType: f.mime_type || undefined };
      }
    } else if (a.kind === "original") {
      if (!isUuidLike(a.ref)) continue;
      const { data: attRow } = await c.from("email_attachments").select("id, email_id, filename, mime_type, size_bytes, job_file_id").eq("id", a.ref).maybeSingle();
      const att = attRow as { id: string; email_id: string; filename: string | null; mime_type: string | null; size_bytes: number | null; job_file_id: string | null } | null;
      const visible = att?.email_id
        ? await getVisibleEmailRow<MailSource>(att.email_id, "id, direction, category, customer_id, supplier_id, order_id, from_email")
        : null;
      if (!att || !visible) return { ok: false, error: "Původní příloha nenalezena." };
      // výkres zákazníka komukoli mimo zákazníka (dodavatel …) → jen anonymizovaná kopie, jinak zablokovat
      const guarded = await guardMailAttachment(c, a, att, visible.row, [...to.valid, ...cc.valid, ...bcc.valid], user);
      if (guarded.kind === "blocked") {
        blocked.push(guarded.blocked);
        continue;
      }
      if (guarded.kind === "file") {
        file = guarded.file;
        if (guarded.original) originalAttachments.push(a.ref);
      } else {
        const loaded = await loadEmailAttachment(a.ref);
        if (!loaded.ok) return { ok: false, error: loaded.error };
        file = loaded.file;
        if (guarded.original) originalAttachments.push(a.ref);
      }
    }
    if (!file) continue;
    total += file.content.length;
    if (total > MAX_TOTAL) return { ok: false, error: "Přílohy jsou dohromady příliš velké (max. 25 MB)." };
    attachments.push(file);
  }
  if (blocked.length) {
    // nic neodeslat: v okně psaní se ukáže proč a nabídne „Odeslat bez nich" (super admin i „Poslat originál")
    return {
      ok: false, stage: "check", blocked, canSendOriginal: user.role === "super_admin",
      error: `${blocked.length === 1 ? "Výkres zákazníka nejde" : "Výkresy zákazníka nejdou"} adresátovi mimo zákazníka${blocked.every((b) => b.kind === "job") ? " zakázky" : ""} poslat bez anonymizace. ${blocked.map((b) => b.message).join(" ")}`,
    };
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
  if (!res.sent) return { ok: false, stage: "send", error: res.reason ?? "Odeslání selhalo." };

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
  if (originals.length || originalAttachments.length) {
    await logAudit({
      action: "email_attachment_original_sent", entity: "emails", entityId: res.emailId,
      diff: {
        fileIds: originals, ...(originalAttachments.length ? { attachmentIds: originalAttachments, sourceEmailId: source?.id ?? null } : {}),
        to: to.valid, cc: cc.valid, bcc: bcc.valid.length, subject,
      },
      actor: userActor(access.user),
    });
  }
  revalidatePath("/inbox");
  revalidatePath("/sent");
  if (jobId) revalidatePath(`/orders/${jobId}`);
  return { ok: true, emailId: res.emailId, fromAddress: res.fromAddress, sentCopy: res.sentCopy, sentCopyText: sentCopyLabel(res.sentCopy, res.sentCopyError) };
}
