import type { EmailItem } from "@/lib/data/types";
import type { JobDetail, JobFile, JobListItem, JobQuote } from "@/lib/jobs/types";
import type { JobStage } from "@/lib/supabase/database.types";
import { canIssueInvoice, quoteDisplayState, type QuoteFacts } from "@/lib/jobs/flow-status";
import { quoteStateFromStatus } from "@/lib/data/labels";
import type { FileFlowInfo, FlowJobState, FlowQuoteInfo } from "./flow-state";
import type { FlowEmail } from "./flow-mail-list";
import type { FlowQuote } from "./quotes-board";
import type { FlowFile } from "./documents-browser";
import type { PricingJob } from "./pricing-board";
import type { ConfirmJob } from "./confirm-order-dialog";
import type { IssueJob } from "./issue-document-panel";

/**
 * Převody view-modelů datové vrstvy na čistá (serializovatelná) data pro klientské
 * komponenty obchodního toku — jen to, co obrazovka opravdu potřebuje.
 */

/** E-maily vybraných kategorií: nepropojené se zakázkou nahoře, pak nejnovější. */
export function toFlowEmails(emails: EmailItem[], categories: string[], max = 40): FlowEmail[] {
  return emails
    .filter((e) => categories.includes(e.category))
    .sort((a, b) => Number(Boolean(a.jobId)) - Number(Boolean(b.jobId)) || b.receivedAt.localeCompare(a.receivedAt))
    .slice(0, max)
    .map((e) => ({
      id: e.id,
      from: e.from,
      fromEmail: e.fromEmail,
      subject: e.subject,
      preview: e.preview,
      category: e.category,
      customer: e.customer ?? null,
      receivedAt: e.receivedAt,
      aiConfidence: e.aiConfidence,
      unread: e.unread,
      jobId: e.jobId ?? null,
      jobNumber: e.jobNumber ?? null,
    }));
}

function normRef(v: string): string {
  return v.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/**
 * E-mail bez zakázky, jehož předmět / úvod nese číslo objednávky zákazníka existující zakázky
 * (PO-4500021877 ↔ Z-2026-104) → nabídnout „Přiřadit", ne druhou zakázku. Čísla kratší než 4 znaky ne.
 */
export function withJobMatches(
  emails: FlowEmail[],
  jobs: Pick<JobListItem, "id" | "number" | "customerOrderNumber">[],
): FlowEmail[] {
  const refs = jobs
    .map((j) => ({ id: j.id, number: j.number, ref: normRef(j.customerOrderNumber ?? "") }))
    .filter((j) => j.ref.length >= 4);
  if (!refs.length) return emails;
  return emails.map((e) => {
    if (e.jobId) return e;
    const hay = normRef(`${e.subject} ${e.preview}`);
    const hit = refs.find((j) => hay.includes(j.ref));
    return hit ? { ...e, matchJob: { id: hit.id, number: hit.number } } : e;
  });
}

/** Nabídka do přehledu: podrobný stav a autoři z DB (info), bez nich odvození ze staršího status. */
export function toFlowQuote(
  q: JobQuote & {
    job: { id: string; number: string; title: string; stage: JobStage } | null;
    customer: { id: string; name: string } | null;
  },
  info: FlowQuoteInfo | null | undefined,
  opts: { today: string; onlyOpen: boolean },
): FlowQuote {
  const base = {
    id: q.id,
    number: q.number,
    revision: q.revision,
    title: q.title,
    total: q.total,
    currency: q.currency,
    validUntil: q.validUntil,
    leadTimeDays: q.leadTimeDays,
    createdAt: q.createdAt,
    archived: q.archived,
    aiGenerated: q.aiGenerated,
    itemCount: q.items.length,
    createdBy: q.createdBy,
    job: q.job,
    customer: q.customer,
    onlyOpen: opts.onlyOpen,
  };
  if (info) return { ...info, ...base };
  // záloha bez podrobných stavů (DB je zatím nemá): stav ze status, autoři ze starších sloupců
  const state = quoteStateFromStatus(q.status, { archived: q.archived }) ?? "rozpracovana";
  const facts: QuoteFacts = {
    id: q.id, number: q.number, revision: q.revision, status: q.status, state, approvedBy: q.approvedBy?.id ?? null,
    approvalRequired: false, createdBy: q.createdBy?.id ?? null, archived: q.archived, sentAt: q.sentAt,
    validUntil: q.validUntil, aiGenerated: q.aiGenerated, supersededBy: null, createdAt: q.createdAt, total: q.total,
  };
  const stamp = (by: { id: string; name: string } | null, at: string | null) =>
    by ? { by, byName: by.name, at, via: null, kind: "user" as const } : null;
  return {
    ...base,
    facts,
    display: quoteDisplayState({ state, validUntil: q.validUntil }, opts.today),
    stateChangedAt: q.createdAt,
    lostReason: null,
    rejectedReason: null,
    feedback: null,
    competitorPrice: null,
    stamps: {
      created: stamp(q.createdBy, q.createdAt),
      approvalRequested: null,
      approved: stamp(q.approvedBy, q.approvedAt),
      sent: null,
      accepted: null,
      rejected: null,
    },
    next: null,
    menu: [],
    proposal: null,
  };
}

export function toFlowFile(
  f: JobFile & { job: { id: string; number: string; title: string; customerName: string | null } },
  flow: FileFlowInfo | null = null,
): FlowFile {
  return {
    id: f.id,
    kind: f.kind,
    title: f.title,
    filename: f.filename,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    version: f.version,
    archived: f.archived,
    note: f.note,
    createdAt: f.createdAt,
    uploadedBy: f.uploadedBy?.name ?? null,
    hasAiData: f.hasAiData,
    job: f.job,
    flow,
    locked: f.locked ?? null,
  };
}

export function toPricingJob(j: JobDetail, flow: FlowJobState | null = null): PricingJob {
  return {
    id: j.id,
    number: j.number,
    title: j.title,
    stage: j.stage,
    priority: j.priority,
    customerName: j.customer?.name ?? null,
    customerNumber: j.customer?.customerNumber ?? null,
    customerInquiryNumber: j.customerInquiryNumber,
    customerRequiredDate: j.customerRequiredDate,
    dueDate: j.dueDate,
    maxToleratedDate: j.maxToleratedDate,
    supplierPromisedDate: j.supplierPromisedDate,
    owner: j.owner,
    pricedBy: j.pricedBy,
    currency: j.currency || "CZK",
    value: j.value,
    aiFilled: j.aiFilled,
    items: [...j.items]
      .sort((a, b) => a.position - b.position)
      .map((it) => ({
        id: it.id,
        drawingNumber: it.drawingNumber,
        revision: it.revision,
        name: it.name,
        description: it.description,
        material: it.material,
        quantity: it.quantity,
        unit: it.unit,
        unitPrice: it.unitPrice,
        purchaseUnitPrice: it.purchaseUnitPrice,
        note: it.note,
      })),
    quotes: j.quotes.map((q) => ({
      id: q.id, number: q.number, status: q.status, revision: q.revision, archived: q.archived, total: q.total, validUntil: q.validUntil,
    })),
    flow,
  };
}

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]{2,}$/;

export function toConfirmJob(j: JobDetail): ConfirmJob {
  const email = [j.customerContactEmail, j.customerDetail?.email].map((e) => (e ?? "").trim()).find((e) => EMAIL_RE.test(e)) ?? null;
  return {
    id: j.id,
    number: j.number,
    title: j.title,
    customerName: j.customer?.name ?? null,
    customerOrderNumber: j.customerOrderNumber,
    customerRequiredDate: j.customerRequiredDate,
    dueDate: j.dueDate,
    email,
  };
}

export function toIssueJob(j: JobListItem, invoicePdfJobs?: ReadonlySet<string>): IssueJob {
  return {
    // vystavená faktura bez PDF (zapsaná mimo systém) → panel neslibuje „otevřeš nebo pošleš znovu"
    ...(invoicePdfJobs ? { invoiceHasPdf: invoicePdfJobs.has(j.id) } : {}),
    id: j.id,
    number: j.number,
    title: j.title,
    customerName: j.customer?.name ?? null,
    stage: j.stage,
    hasQuote: j.quoteCount > 0,
    // faktura: vystavená (poslat znovu v kartě) / jde vystavit (dodáno vše) — stejné pravidlo jako karta
    invoiceNumber: (j.invoiceNumber ?? "").trim() || null,
    invoiceable: j.flow ? canIssueInvoice({ ...j.flow, stage: j.stage }) : false,
  };
}
