import { cleanMailText, itemHintsFromMail, type MailItemHint } from "@/lib/email/job-instructions";
import { normToken } from "@/lib/email/job-match";
import { CAPTURE_BATCH_MAX_FILES } from "@/lib/jobs/capture-review";
import { JOB_FILE_MAX_BYTES } from "@/lib/jobs/file-kinds";
import { makeWarning } from "@/lib/jobs/capture-batch";
import type { BatchReviewModel, BatchWarning } from "@/lib/jobs/capture-batch-types";

/**
 * Pošta → „Přidat doklad (foto)" (čistá logika, testy v mail-capture-input.test.ts).
 * Majitel 3. 11.: z e-mailu s víc výkresy / objednávkou / poptávkou se při „Založit zakázku" nebo
 * „Přidat k zakázce" přílohy roztřídí STEJNOU dávkou jako focení (stejné roztřídění AI, pravidla
 * dávky, kontrola) — pošta jen dodá vstup:
 *  1. selectMailAttachments — které přílohy jdou do dávky (loga z podpisu, vizitky, S/MIME podpisy
 *     a pozvánky ne; max. 50 MB a 40 souborů),
 *  2. MailCaptureContext — odesílatel, předmět a text e-mailu jako kontext (zákazník podle odesílatele,
 *     počty kusů z textu, kontaktní osoba),
 *  3. applyMailContextToReview — do kontroly dávky doplní, co doklady neříkají: zákazníka podle
 *     odesílatele, kontaktní osobu, název zakázky z předmětu a počty kusů výkresů z textu e-mailu.
 */

/** Řádek email_attachments (bez obsahu). */
export interface MailAttachmentRow {
  id: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
}

export interface MailAttachmentSkip {
  id: string;
  filename: string;
  reason: string;
  /** Příloha už je u cílové zakázky uložená (stejný obsah) — dokument, který ji drží. */
  jobFileId?: string;
}

/** Menší obrázek je skoro jistě logo / ikona z podpisu (stejný práh jako kopie příloh k zakázce). */
export const MAIL_MIN_IMAGE_BYTES = 15 * 1024;
/** Obrázek s kratší delší stranou je logo / banner podpisu, ne fotka dokladu ani výkresu. */
export const MAIL_MIN_IMAGE_SIDE = 500;
/** Obrázky pojmenované jako vložené obrázky podpisu do této velikosti se přeskočí. */
const SIGNATURE_IMAGE_MAX_BYTES = 300 * 1024;
const SIGNATURE_NAME_RE = /^(image\d{3}|outlook-[a-z0-9]+|logo|signature|podpis|banner|facebook|linkedin|instagram|twitter|youtube|xing|icon|ikona)/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|bmp|webp|heic|heif|tiff?)$/i;
/** S/MIME podpis, vizitka, pozvánka do kalendáře, obálka Outlooku — žádný obsah k roztřídění. */
const NOISE_RE = /(\.(p7s|p7m|p7c|vcf|ics|asc|sig)$)|(^winmail\.dat$)|(^smime\.p7)/i;

function nameOf(r: MailAttachmentRow): string {
  return (r.filename ?? "").trim() || "priloha";
}

export function isImageAttachment(filename: string, mime: string | null | undefined): boolean {
  return (mime ?? "").toLowerCase().startsWith("image/") || IMAGE_EXT_RE.test(filename);
}

/** Obrázek z podpisu podle názvu a velikosti (před stažením). */
export function isSignatureImage(filename: string, mime: string | null | undefined, size: number | null | undefined): boolean {
  if (!isImageAttachment(filename, mime)) return false;
  const bytes = size ?? 0;
  if (bytes > 0 && bytes < MAIL_MIN_IMAGE_BYTES) return true;
  return SIGNATURE_NAME_RE.test(filename) && bytes < SIGNATURE_IMAGE_MAX_BYTES;
}

/** Obrázek z podpisu podle rozměrů (po stažení): delší strana pod 500 px. */
export function isSignatureImageSize(dims: { width: number; height: number } | null): boolean {
  return Boolean(dims && Math.max(dims.width, dims.height) < MAIL_MIN_IMAGE_SIDE);
}

/**
 * Přílohy e-mailu do dávky. Pořadí zůstává (pořadí příloh = pořadí stránek), loga a šum se přeskočí
 * s důvodem (do upozornění roztřídění).
 */
export function selectMailAttachments(rows: readonly MailAttachmentRow[], max: number = CAPTURE_BATCH_MAX_FILES): { take: MailAttachmentRow[]; skipped: MailAttachmentSkip[] } {
  const take: MailAttachmentRow[] = [];
  const skipped: MailAttachmentSkip[] = [];
  for (const r of rows) {
    const filename = nameOf(r);
    const skip = (reason: string) => skipped.push({ id: r.id, filename, reason });
    if (NOISE_RE.test(filename) || /^application\/(pkcs7-signature|x-pkcs7-signature|ms-tnef)$/i.test(r.mime_type ?? "")) skip("podpis / vizitka / pozvánka");
    else if ((r.size_bytes ?? 0) > JOB_FILE_MAX_BYTES) skip("větší než 50 MB");
    else if (isSignatureImage(filename, r.mime_type, r.size_bytes)) skip("logo / obrázek z podpisu");
    else if (take.length >= max) skip(`najednou jde roztřídit nejvýš ${max} souborů`);
    else take.push(r);
  }
  return { take, skipped };
}

// ── Kontext e-mailu ─────────────────────────────────────────
export interface MailCaptureContext {
  emailId: string;
  threadId: string | null;
  subject: string;
  fromName: string;
  fromEmail: string;
  /** Kategorie e-mailu (DB slug, např. „poptavka"). */
  category: string | null;
  /** Zákazník podle e-mailu / adresy odesílatele (CRM). */
  customerId: string | null;
  customerName: string | null;
  /** Text e-mailu bez citací a podpisu (max. 4000 znaků). */
  body: string;
  /** Telefon z podpisu odesílatele ("" = není). */
  phone: string;
  /** Přílohy zkopírované do dávky (cesta v capture → příloha e-mailu, obsah) — propojení po uložení. */
  files: { attachmentId: string; path: string; sha256: string }[];
  /** Přeskočené přílohy (logo z podpisu …). */
  skipped: MailAttachmentSkip[];
}

const PHONE_RE = /(?:\+|00)?\d[\d\s/().-]{7,18}\d/g;
const PHONE_LINE_RE = /\b(tel|telefon|phone|mobil|mobile|mob|gsm|fon|handy|t|m)\b\.?\s*[:.]?\s*/i;

/** Telefon z podpisu e-mailu (posledních ~20 řádků před citací): řádek s „tel / mobil" má přednost. */
export function phoneFromSignature(body: string | null | undefined): string {
  const lines = (body ?? "").replace(/\r\n?/g, "\n").split("\n");
  const cut = lines.findIndex((l) => /^\s*>/.test(l) || /^-{2,}\s*(original|původní|ursprüngliche)/i.test(l) || /^\s*(od|from|von)\s*:/i.test(l));
  const own = (cut >= 0 ? lines.slice(0, cut) : lines).slice(-20);
  const pick = (onlyLabelled: boolean): string => {
    for (const l of own) {
      if (onlyLabelled && !PHONE_LINE_RE.test(l)) continue;
      if (/\b(fax|i[čc]o?|di[čc]|ust|vat|iban|účet|ucet|account|konto|psč|zip)\b/i.test(l)) continue;
      for (const m of l.matchAll(PHONE_RE)) {
        const digits = m[0].replace(/\D/g, "");
        if (digits.length >= 9 && digits.length <= 15) return m[0].replace(/\s+/g, " ").trim().slice(0, 60);
      }
    }
    return "";
  };
  return pick(true) || pick(false);
}

/** Kontext e-mailu pro roztřídění AI (jen data, krátce — šetří tokeny). */
export function mailClassifyContext(ctx: Pick<MailCaptureContext, "subject" | "fromName" | "fromEmail" | "body">): string {
  const clip = (s: string, n: number) => s.replace(/[<>]+/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
  const parts = [
    `Od: ${clip([ctx.fromName, ctx.fromEmail ? `<${ctx.fromEmail}>` : ""].filter(Boolean).join(" "), 160)}`,
    `Předmět: ${clip(ctx.subject, 200)}`,
    ctx.body ? `Text:\n${clip(ctx.body, 1200)}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

/** Čistý text e-mailu do kontextu (bez citací a podpisu, max. 4000 znaků). */
export function mailBodyForContext(body: string | null | undefined): string {
  return cleanMailText(body).slice(0, 4000);
}

// ── Kontrola dávky ──────────────────────────────────────────
function sameNumber(a: string, b: string): boolean {
  const x = normToken(a);
  const y = normToken(b);
  return Boolean(x && y && (x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x)))));
}

/** Počty kusů z textu e-mailu (podle čísel výkresů v textu i v názvech příloh). */
export function mailItemHints(ctx: Pick<MailCaptureContext, "body">, filenames: readonly string[]): MailItemHint[] {
  return itemHintsFromMail(ctx.body, filenames).filter((h) => h.quantity !== null && h.quantity > 0);
}

/**
 * Doplní do kontroly dávky údaje z e-mailu — jen prázdná místa (doklady mají přednost):
 *  - zákazník nové zakázky bez zákazníka z dokladu = zákazník odesílatele (CRM),
 *  - kontaktní osoba nové zakázky = odesílatel (jméno, e-mail, telefon z podpisu),
 *  - název zakázky bez obchodního dokladu = předmět e-mailu,
 *  - počet kusů výkresu bez počtu = počet z textu e-mailu („4711-02 … 10 ks").
 * Mění review na místě a vrací ho.
 */
export function applyMailContextToReview(review: BatchReviewModel, ctx: MailCaptureContext, filenames: readonly string[] = []): BatchReviewModel {
  // čísla výkresů z vytěžení (AI) i z názvů příloh — počet kusů u nich v textu e-mailu
  const drawingNames = review.docs.flatMap((d) => (d.kind === "drawing" ? [d.drawing.drawingNumber, ...(d.drawing.drawingNumbers ?? [])] : d.kind === "model" ? [d.meta.drawingNumber] : []))
    .filter((n): n is string => Boolean(n && n.trim())).map((n) => `${n.trim()}.pdf`);
  const hints = mailItemHints(ctx, [...drawingNames, ...filenames]);
  const filled = new Set<string>();
  for (const g of review.initial.groups) {
    const isNew = g.job.targetKey === "new";
    const groupModel = review.groups.find((x) => x.key === g.key)?.model;
    if (isNew && g.job.customer.mode === "none" && ctx.customerId) {
      g.job.customer = { mode: "existing", id: ctx.customerId, name: ctx.customerName ?? "", reason: "odesílatel e-mailu" };
      if (groupModel) groupModel.initial = { ...groupModel.initial, customer: g.job.customer };
    }
    if (isNew) {
      const f = g.job.fields;
      const contactEmpty = !(f.customerContact ?? "").trim() && !(f.customerContactEmail ?? "").trim();
      if (contactEmpty && (ctx.fromName || ctx.fromEmail)) {
        if (ctx.fromName) f.customerContact = ctx.fromName.slice(0, 200);
        if (ctx.fromEmail) f.customerContactEmail = ctx.fromEmail.slice(0, 200);
        if (ctx.phone && !(f.customerContactPhone ?? "").trim()) f.customerContactPhone = ctx.phone.slice(0, 60);
      }
      if (!g.jobDraftTitle.trim() && !(f.title ?? "").trim() && ctx.subject.trim()) g.jobDraftTitle = mailSubjectTitle(ctx.subject);
    }
  }
  const linked = new Set<string>();
  if (hints.length) {
    for (const d of review.docs) {
      if (d.kind !== "drawing") continue;
      const st = review.initial.docs[d.docId];
      if (!st || st.kind !== "drawing") continue;
      const numbers = [st.state.drawingNumber, d.drawing.drawingNumber, ...(d.drawing.drawingNumbers ?? [])].filter(Boolean);
      const exact = hints.find((h) => numbers.some((n) => sameNumber(n, h.drawingNumber))) ?? null;
      const hit = exact ?? (hints.length === 1 && review.docs.filter((x) => x.kind === "drawing").length === 1 ? hints[0] : null);
      if (!hit?.quantity) continue;
      let next = st.state;
      if (!next.quantity.trim()) {
        next = { ...next, quantity: String(hit.quantity) };
        d.sources = { ...(d.sources ?? {}), quantity: "z textu e-mailu" };
        filled.add(d.docId);
      }
      // e-mail výslovně jmenuje výkres s počtem kusů → nová položka (jinak by výkres zůstal bez položky)
      if (exact && next.link.mode === "none") {
        next = { ...next, link: { mode: "add" } };
        linked.add(d.docId);
      }
      if (next !== st.state) {
        st.state = next;
        d.initial = next;
      }
    }
  }
  if (filled.size || linked.size) {
    review.warnings = review.warnings.filter((w: BatchWarning) => !(
      (w.code === "drawing_quantity_missing" && w.docIds.every((id) => filled.has(id)))
      || (w.code === "unlinked_drawing" && w.docIds.every((id) => linked.has(id)))
    ));
  }
  if (ctx.skipped.length) {
    const list = ctx.skipped.slice(0, 6).map((s) => s.filename).join(", ");
    const id = `sort_uncertain:mail-skipped`;
    if (!review.warnings.some((w) => w.id === id)) {
      review.warnings.push({ ...makeWarning("sort_uncertain", "info", [], `Z e-mailu vynecháno (logo z podpisu, vizitka…): ${list}${ctx.skipped.length > 6 ? "…" : ""}`), id });
    }
  }
  return review;
}

/** Předmět e-mailu jako název zakázky (bez „RE: / FW: / Poptávka:"). */
export function mailSubjectTitle(subject: string): string {
  let s = subject.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 4; i++) s = s.replace(/^(re|fw|fwd|aw|wg|odp|vs|tr)\s*:\s*/i, "");
  return s.slice(0, 300);
}

// ── Kontakt odesílatele ─────────────────────────────────────
export interface SenderContactPlan {
  /** existing = odesílatel je kontakt zákazníka, new = nový kontakt (nabídnout přidání), none = bez zákazníka / adresy. */
  status: "existing" | "new" | "none";
  name: string;
  email: string;
  phone: string;
  contactId: string | null;
}

/** Odesílatel vůči kontaktům zákazníka (Karta zákazníka). */
export function senderContactPlan(
  sender: { name: string; email: string; phone?: string },
  customerId: string | null,
  contacts: readonly { id: string; name: string | null; email: string | null }[],
): SenderContactPlan {
  const email = sender.email.trim().toLowerCase();
  const base = { name: sender.name.trim(), email, phone: (sender.phone ?? "").trim(), contactId: null };
  if (!customerId || !email) return { ...base, status: "none" };
  const hit = contacts.find((k) => (k.email ?? "").trim().toLowerCase() === email);
  return hit ? { ...base, status: "existing", contactId: hit.id, name: hit.name || base.name } : { ...base, status: "new" };
}
