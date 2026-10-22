import type { EmailItem } from "@/lib/data/types";
import type { JobDetail, JobFile, JobListItem, JobQuote } from "@/lib/jobs/types";
import type { JobStage } from "@/lib/supabase/database.types";
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

export function toFlowQuote(
  q: JobQuote & {
    job: { id: string; number: string; title: string; stage: JobStage } | null;
    customer: { id: string; name: string } | null;
  },
): FlowQuote {
  return {
    id: q.id,
    number: q.number,
    revision: q.revision,
    title: q.title,
    status: q.status,
    total: q.total,
    currency: q.currency,
    validUntil: q.validUntil,
    leadTimeDays: q.leadTimeDays,
    createdBy: q.createdBy,
    approvedBy: q.approvedBy,
    approvedAt: q.approvedAt,
    sentAt: q.sentAt,
    createdAt: q.createdAt,
    archived: q.archived,
    accepted: q.accepted,
    aiGenerated: q.aiGenerated,
    itemCount: q.items.length,
    job: q.job,
    customer: q.customer,
  };
}

export function toFlowFile(f: JobFile & { job: { id: string; number: string; title: string; customerName: string | null } }): FlowFile {
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
  };
}

export function toPricingJob(j: JobDetail): PricingJob {
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
    quotes: j.quotes.map((q) => ({ id: q.id, number: q.number, status: q.status, revision: q.revision, archived: q.archived, total: q.total })),
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

export function toIssueJob(j: JobListItem): IssueJob {
  return {
    id: j.id,
    number: j.number,
    title: j.title,
    customerName: j.customer?.name ?? null,
    stage: j.stage,
    hasQuote: j.quoteCount > 0,
  };
}
