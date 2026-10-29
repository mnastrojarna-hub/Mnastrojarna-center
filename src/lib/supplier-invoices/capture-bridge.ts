import "server-only";
import type { ActorContext } from "@/lib/supabase/actor-headers";
import type { JobsDb } from "@/lib/jobs/events";
import type { BatchFile, BatchPage, BatchDocType } from "@/lib/jobs/capture-batch-types";
import { downloadFull, extractPdfPages, imagesToPdf } from "@/lib/jobs/capture-files";
import { sniffDocumentMime } from "@/lib/jobs/capture-review";
import { fakeGroupFor } from "@/lib/ai/fake-capture";
import { normalizeSupplierInvoice, invoiceFromBusinessDoc } from "@/lib/supplier-invoices/extract";
import {
  createSupplierInvoiceFromFile, type CreateInvoiceResult, type InvoiceFileInput,
} from "@/lib/supplier-invoices/service";
import type { SupplierInvoiceExtract, SupplierInvoiceSource } from "@/lib/supplier-invoices/types";
import type { StoredExtract } from "@/lib/jobs/capture-store";

/**
 * Most focení → Faktury dodavatelů: doklad dávky druhu „faktura_dodavatel" se neuloží k zakázce (ani jako
 * dokument), ale jako faktura dodavatele (soubor do bucketu faktur). Vytěžení z dávky (čtečka faktur)
 * se použije, AI se znovu nevolá.
 */

/** Druh dokladu, který jde mimo skupiny zakázek do Faktur dodavatelů. */
export const SUPPLIER_INVOICE_DOC_TYPE: BatchDocType = "faktura_dodavatel";

export function isSupplierInvoiceDoc(type: BatchDocType | string | null | undefined): boolean {
  return type === SUPPLIER_INVOICE_DOC_TYPE;
}

/** Soubory jednoho dokladu dávky: celé soubory, výřez PDF, víc fotek → jedno PDF. */
export async function batchDocInvoiceFiles(
  db: JobsDb,
  session: { files: BatchFile[]; pages: BatchPage[] },
  pageIds: string[],
  title: string,
): Promise<{ files: InvoiceFileInput[]; source: SupplierInvoiceSource }> {
  const pages = pageIds.map((id) => session.pages.find((p) => p.id === id)).filter((p): p is BatchPage => Boolean(p));
  const byFile: { file: BatchFile; pages: BatchPage[] }[] = [];
  for (const p of pages) {
    const f = session.files.find((x) => x.id === p.fileId);
    if (!f) continue;
    const last = byFile[byFile.length - 1];
    if (last && last.file.id === f.id) last.pages.push(p);
    else byFile.push({ file: f, pages: [p] });
  }
  const out: InvoiceFileInput[] = [];
  let anyPdf = false;
  // víc fotek (každá 1 strana) → jedno PDF
  if (byFile.length > 1 && byFile.every((b) => b.pages.length === 1 && b.pages[0].source === "image")) {
    const imgs: { bytes: Uint8Array; mime: string }[] = [];
    for (const b of byFile) {
      const bytes = await downloadFull(db, b.file.path);
      const mime = bytes ? sniffDocumentMime(bytes) : null;
      if (!bytes || !mime) break;
      imgs.push({ bytes, mime });
    }
    const pdf = imgs.length === byFile.length ? await imagesToPdf(imgs).catch(() => null) : null;
    if (pdf) {
      const name = `${title.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) || "faktura"}.pdf`;
      return { files: [{ bytes: pdf, filename: name, mimeType: "application/pdf" }], source: "photo" };
    }
  }
  for (const b of byFile) {
    const bytes = await downloadFull(db, b.file.path);
    if (!bytes) continue;
    const mime = sniffDocumentMime(bytes) ?? b.file.mimeType;
    if (mime === "application/pdf") {
      anyPdf = true;
      const nums = b.pages.map((p) => p.page);
      const whole = b.file.pageCount <= 1 || nums.length === b.file.pageCount;
      if (whole) {
        out.push({ bytes, filename: b.file.filename, mimeType: mime });
      } else {
        const cut = await extractPdfPages(bytes, nums).catch(() => null);
        const label = nums.length > 1 ? `${nums[0]}-${nums[nums.length - 1]}` : `${nums[0]}`;
        out.push(cut
          ? { bytes: cut, filename: `${b.file.filename.replace(/\.pdf$/i, "")}-str${label}.pdf`, mimeType: mime }
          : { bytes, filename: b.file.filename, mimeType: mime });
      }
    } else {
      out.push({ bytes, filename: b.file.filename, mimeType: mime });
    }
  }
  return { files: out, source: anyPdf ? "upload" : "photo" };
}

/** Vytěžení faktury z uloženého vytěžení dávky (čtečka faktur; jinak převod obchodního dokladu AI). */
export function invoiceExtractOf(stored: StoredExtract | null | undefined): { extract: SupplierInvoiceExtract; aiUsed: boolean } | null {
  if (!stored) return null;
  if (stored.supplierInvoice) return { extract: normalizeSupplierInvoice(stored.supplierInvoice), aiUsed: stored.aiUsed };
  if (stored.aiUsed && stored.extract.kind === "business") return { extract: invoiceFromBusinessDoc(stored.extract.doc), aiUsed: true };
  return null;
}

/** Založí fakturu dodavatele z dokladu dávky (idempotentně podle klíče „<captureId>:<docId>"). */
export async function createInvoiceFromBatchDoc(input: {
  db: JobsDb;
  actor: ActorContext;
  session: { captureId: string; files: BatchFile[]; pages: BatchPage[] };
  docId: string;
  pageIds: string[];
  title: string;
  stored: StoredExtract | null;
  /** Focení spuštěné u zakázky (fixedJobId) — záložní návrh rozdělení. */
  contextJobId?: string | null;
}): Promise<CreateInvoiceResult> {
  const { files, source } = await batchDocInvoiceFiles(input.db, input.session, input.pageIds, input.title);
  if (!files.length) return { ok: false, error: "Soubory faktury se nepodařilo načíst — nahraj ji prosím znovu." };
  const ready = invoiceExtractOf(input.stored);
  const names = input.pageIds.map((id) => input.session.pages.find((p) => p.id === id)?.fileId)
    .map((fid) => input.session.files.find((f) => f.id === fid)?.filename ?? "").filter(Boolean);
  return createSupplierInvoiceFromFile(files, source, input.actor, {
    db: input.db,
    captureKey: `${input.session.captureId}:${input.docId}`,
    extract: ready?.extract ?? null,
    aiUsed: ready?.aiUsed ?? false,
    process: "background",
    fakeGroup: fakeGroupFor(SUPPLIER_INVOICE_DOC_TYPE, names),
    contextJobId: input.contextJobId ?? null,
  });
}
