// Testovací data dávkového focení (jen pro unit / render testy — aplikace je nepoužívá).
import { docFieldValues, planJobUpdate, planNewJob } from "@/lib/jobs/apply-extraction";
import { normalizeExtracted, emptyParty } from "@/lib/jobs/extracted-normalize";
import { buildExistingTarget, buildNewTarget, initialReviewState, type TargetJob } from "@/lib/jobs/capture-review";
import type {
  BatchApplyState, BatchDocDraft, BatchDocType, BatchFile, BatchGroupReview, BatchPage, BatchPreview, BatchResult,
  BatchReviewModel, BatchSortModel, BusinessDocState, DrawingExtract,
} from "@/lib/jobs/capture-batch-types";
import objednavkaFixture from "@/lib/jobs/__fixtures__/capture/objednavka-strojmetal.json";

export const PO = normalizeExtracted(objednavkaFixture);
export const JOB_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
export const CAPTURE_ID = "11111111-2222-4333-8444-555555555555";

export function targetJob(over: Partial<TargetJob> = {}): TargetJob {
  return {
    id: JOB_ID, number: "Z-2026-031", stage: "nabidka", title: "Upínky VK-2291",
    customer: { id: "c1", name: "Strojmetal a.s.", customerNumber: "ZAK-0001", ico: "45274649" },
    customerOrderNumber: null, customerInquiryNumber: "RFQ-77",
    customerContact: null, customerContactEmail: null, customerContactPhone: null,
    inquiryDate: "2026-09-01", orderDate: null, customerRequiredDate: "2026-12-15", dueDate: null,
    expectedDeliveryDate: null, supplierPromisedDate: null, value: null,
    items: [], supplier: null, supplierOrderNumber: null, invoiceNumber: null, deliveryNoteNumber: null, currency: "CZK",
    ...over,
  };
}

export function bFile(id: string, filename: string, over: Partial<BatchFile> = {}): BatchFile {
  return {
    id, path: `capture/u/0000000${id.slice(1)}-${filename}`, filename, mimeType: "image/png", size: 2048, pageCount: 1,
    sniffedMime: "image/png", format: null, fromZip: null, splittable: true, aiReadable: true, aiSkipReason: null, sha256: id,
    ...over,
  };
}

export function bPage(id: string, fileId: string, label: string, source: BatchPage["source"] = "image", n = 1): BatchPage {
  return { id, fileId, page: n, source, label, aiLabel: "", duplicateOf: null };
}

export function bDoc(id: string, type: BatchDocType, pageIds: string[], over: Partial<BatchDocDraft> = {}): BatchDocDraft {
  return {
    id, type, pageIds, aiType: type, confidence: 0.93, reason: "hlavička zákazníka", title: "", documentNumber: "",
    partyName: "", drawingNumbers: [], format: null, flags: [], issuerCheck: "ok", excluded: false, ...over,
  };
}

export const FILES: BatchFile[] = [
  bFile("f1", "objednavka-1.png"),
  bFile("f2", "objednavka-2.png"),
  bFile("f3", "vykres.png"),
  bFile("f4", "4711-02_rev_B.step", { mimeType: "application/octet-stream", sniffedMime: null, format: "STEP" }),
  bFile("f5", "nabidka-hruby.png"),
  bFile("f6", "sada.pdf", { mimeType: "application/pdf", sniffedMime: "application/pdf", pageCount: 2 }),
];

export const PAGES: BatchPage[] = [
  bPage("p1", "f1", "objednavka-1.png"),
  bPage("p2", "f2", "objednavka-2.png"),
  bPage("p3", "f3", "vykres.png"),
  bPage("p4", "f4", "4711-02_rev_B.step", "file"),
  bPage("p5", "f5", "nabidka-hruby.png"),
  bPage("p6", "f6", "sada.pdf · str. 1/2", "pdf_page", 1),
  bPage("p7", "f6", "sada.pdf · str. 2/2", "pdf_page", 2),
];

export const SORT_DOCS: BatchDocDraft[] = [
  bDoc("d1", "objednavka_zakaznik", ["p1", "p2"], { title: "Objednávka Strojmetal PO-4471", documentNumber: "PO-4471", partyName: "Strojmetal a.s." }),
  bDoc("d2", "vykres", ["p3"], { title: "Výkres 4711-02", drawingNumbers: ["4711-02"], confidence: 0.74, reason: "hlavička nečitelná" }),
  bDoc("d3", "model_3d", ["p4"], { title: "3D model 4711-02", format: "STEP", aiType: null, confidence: null }),
  bDoc("d4", "nabidka_dodavatel", ["p5"], { title: "Nabídka dodavatele NAB-552 · Kovoobrábění Hrubý", documentNumber: "NAB-552", partyName: "Kovoobrábění Hrubý" }),
  bDoc("d5", "dodaci_list_my", ["p6"], { title: "Dodací list DL-0877", documentNumber: "DL-0877", flags: ["signed"] }),
  bDoc("d6", "faktura_my", ["p7"], { title: "Faktura FV-2026-118", documentNumber: "FV-2026-118" }),
];

export const PREVIEWS: BatchPreview[] = FILES.map((f) => ({
  fileId: f.id, path: f.path, filename: f.filename, mimeType: f.mimeType, size: f.size,
  url: f.format ? null : `https://x/${f.filename}`, sortUrl: f.mimeType.startsWith("image/") ? `https://x/${f.filename}.sort.jpg` : null,
  pageCount: f.pageCount, format: f.format,
}));

export function sortModel(over: Partial<BatchSortModel> = {}): BatchSortModel {
  return {
    captureId: CAPTURE_ID, aiUsed: true, reason: null, aiFailure: null, mode: "approval", margins: true, drawingsAccess: true,
    fixedJobId: null, fixedJobNumber: null, files: FILES, pages: PAGES, previews: PREVIEWS,
    sort: { docs: SORT_DOCS, excludedPageIds: [] },
    warnings: [{
      id: "duplicate_doc:d5,d6", code: "duplicate_doc", severity: "warn", docIds: ["d5"], groupKey: null,
      message: "Dodací list DL-0877 je v dávce dvakrát", actions: [{ kind: "exclude_doc", label: "Vyřadit duplicitu", docId: "d5" }],
    }],
    extracts: [], skipSort: false,
    ...over,
  };
}

export const DRAWING: DrawingExtract = {
  drawingNumber: "4711-02", revision: "B", title: "Upínka", material: "1.2379", dimensions: "120 × 80 × 25 mm",
  weightKg: 0, generalTolerance: "ISO 2768-mK", tightestTolerance: "±0,01", surface: "Ra 0,8", heatTreatment: "",
  surfaceTreatment: "", quantity: 0, customerName: "Strojmetal a.s.", drawingDate: "", sheet: "List 1/1", scale: "1:1",
  notes: "", summary: "Výkres upínky", confidence: 0.92, needsClarification: [],
};

function businessState(type: BatchDocType, over: Partial<BusinessDocState> = {}): BusinessDocState {
  return {
    type, documentNumber: "", documentDate: "", docNote: "", fileOnly: false, supplier: { mode: "none" },
    confirmDelivered: false, invoiceDueDate: "", paidComplete: false, quoteLines: [], selectWinner: false,
    advancePurchaseOrder: false, onDuplicate: null, ...over,
  };
}

/** Kontrola: skupina g1 (Strojmetal, 5 dokladů) + skupina g2 (jen nabídka dodavatele bez cíle). */
export function batchReview(over: Partial<BatchReviewModel> = {}): BatchReviewModel {
  const j = targetJob();
  const ex = buildExistingTarget({ job: j, plan: planJobUpdate(j, PO), docValues: docFieldValues(PO), reason: "podle čísla objednávky PO-4471", score: 95, margins: true });
  const nw = buildNewTarget({ plan: planNewJob(PO), margins: true, docKind: PO.docKind, issuer: PO.issuer });
  const customerMatch = { id: "c1", name: "Strojmetal a.s.", reason: "podle IČO 45274649", score: 100 };
  const g1Initial = initialReviewState({
    docKind: PO.docKind, issuer: PO.issuer, target: ex, customerMatch, supplierMatch: null,
    docCustomer: PO.customer, docSupplier: PO.supplier,
  });
  const g1: BatchGroupReview = {
    key: "g1", docIds: ["d1", "d2", "d3", "d5", "d6"], primaryDocId: "d1", label: "Strojmetal · PO-4471", autoReason: null,
    model: {
      captureId: CAPTURE_ID, aiUsed: true, reason: null, docKind: PO.docKind, issuer: PO.issuer, chipExact: true,
      documentNumber: PO.documentNumber, confidence: 0.93, summary: PO.summary, needsClarification: [],
      docCustomer: PO.customer, docSupplier: PO.supplier, customerMatch, supplierMatch: null, fixedJobId: null,
      targets: [ex, nw], margins: true, mode: "approval", initial: { ...g1Initial, stage: "fakturovano" },
    },
    visibleFields: ["title", "customerOrderNumber", "customerRequiredDate", "value"],
    fieldSources: { customerRequiredDate: { docId: "d6", label: "z faktury FV-2026-118" } },
    itemSources: {},
    itemOptions: { [JOB_ID]: [{ link: { mode: "add" }, label: "Založit novou položku", drawingNumber: "4711-02", revision: "B" }] },
  };
  const nwSupplier = buildNewTarget({ plan: null, margins: true, docKind: "nabidka", issuer: "dodavatel" });
  const g2Initial = initialReviewState({
    docKind: "nabidka", issuer: "dodavatel", target: nwSupplier, customerMatch: null, supplierMatch: null,
    docCustomer: emptyParty(), docSupplier: emptyParty(),
  });
  const g2: BatchGroupReview = {
    key: "g2", docIds: ["d4"], primaryDocId: null, label: "Kovoobrábění Hrubý · NAB-552", autoReason: "jen doklad dodavatele bez shody",
    model: {
      captureId: CAPTURE_ID, aiUsed: true, reason: null, docKind: "nabidka", issuer: "dodavatel", chipExact: true,
      documentNumber: "NAB-552", confidence: 0.9, summary: "", needsClarification: [],
      docCustomer: emptyParty(), docSupplier: emptyParty(), customerMatch: null, supplierMatch: null, fixedJobId: null,
      targets: [nwSupplier], margins: true, mode: "approval", initial: { ...g2Initial, targetKey: "" },
    },
    visibleFields: ["title"], fieldSources: {}, itemSources: {}, itemOptions: {},
  };
  const sort = { docs: SORT_DOCS, excludedPageIds: [] };
  const initial: BatchApplyState = {
    sort,
    groups: [
      { key: "g1", docIds: g1.docIds, job: g1.model.initial, customerConfirmed: false, jobDraftTitle: "" },
      { key: "g2", docIds: g2.docIds, job: g2.model.initial, customerConfirmed: false, jobDraftTitle: "Nabídka Hrubý" },
    ],
    docs: {
      d1: { kind: "business", state: businessState("objednavka_zakaznik", { documentNumber: "PO-4471", documentDate: "2026-10-20" }) },
      d2: {
        kind: "drawing",
        state: {
          drawingNumber: "4711-02", revision: "B", title: "Upínka", material: "1.2379", dimensions: "120 × 80 × 25 mm",
          generalTolerance: "ISO 2768-mK", tightestTolerance: "±0,01", quantity: "", link: { mode: "add" }, archive: true, note: "", onDuplicate: null,
        },
      },
      d3: { kind: "model", state: { format: "STEP", drawingNumber: "4711-02", revision: "B", title: "Upínka", link: { mode: "add" }, note: "", onDuplicate: null } },
      d4: {
        kind: "business",
        state: businessState("nabidka_dodavatel", {
          documentNumber: "NAB-552", supplier: { mode: "new", party: { ...emptyParty(), name: "Kovoobrábění Hrubý s.r.o." } }, selectWinner: true,
          quoteLines: [{ key: "q1", drawingNumber: "4711-02", name: "Upínka", material: "1.2379", quantity: "50", unit: "ks", unitPrice: "412" }],
        }),
      },
      d5: { kind: "business", state: businessState("dodaci_list_my", { documentNumber: "DL-0877", confirmDelivered: true }) },
      d6: { kind: "business", state: businessState("faktura_my", { documentNumber: "FV-2026-118", invoiceDueDate: "2026-11-05" }) },
    },
  };
  const docs: BatchReviewModel["docs"] = [
    {
      kind: "business", docId: "d1", groupKey: "g1", type: "objednavka_zakaznik", primary: true, aiUsed: true, reason: null,
      confidence: 0.93, summary: "Objednávka 3 položek", needsClarification: [], flags: [], docCustomer: PO.customer,
      docSupplier: emptyParty(), supplierMatch: null, unmatchedRows: [], duplicateOf: null, initial: (initial.docs.d1 as { state: BusinessDocState }).state,
    },
    { kind: "drawing", docId: "d2", groupKey: "g1", aiUsed: true, reason: null, drawing: DRAWING, duplicateOf: null, archiveConflict: null, initial: (initial.docs.d2 as Extract<BatchApplyState["docs"][string], { kind: "drawing" }>).state },
    { kind: "model", docId: "d3", groupKey: "g1", meta: { format: "STEP", drawingNumber: "4711-02", revision: "B", title: "Upínka" }, duplicateOf: null, initial: (initial.docs.d3 as Extract<BatchApplyState["docs"][string], { kind: "model" }>).state },
    {
      kind: "business", docId: "d4", groupKey: "g2", type: "nabidka_dodavatel", primary: false, aiUsed: true, reason: null,
      confidence: 0.9, summary: "", needsClarification: [], flags: [], docCustomer: emptyParty(),
      docSupplier: { ...emptyParty(), name: "Kovoobrábění Hrubý s.r.o." }, supplierMatch: null, unmatchedRows: [], duplicateOf: null,
      initial: (initial.docs.d4 as { state: BusinessDocState }).state,
    },
    {
      kind: "business", docId: "d5", groupKey: "g1", type: "dodaci_list_my", primary: false, aiUsed: true, reason: null,
      confidence: 0.91, summary: "", needsClarification: [], flags: ["signed"], docCustomer: PO.customer, docSupplier: emptyParty(),
      supplierMatch: null, unmatchedRows: [], duplicateOf: null, initial: (initial.docs.d5 as { state: BusinessDocState }).state,
    },
    {
      kind: "business", docId: "d6", groupKey: "g1", type: "faktura_my", primary: false, aiUsed: true, reason: null,
      confidence: 0.95, summary: "", needsClarification: [], flags: [], docCustomer: PO.customer, docSupplier: emptyParty(),
      supplierMatch: null, unmatchedRows: [], duplicateOf: null, initial: (initial.docs.d6 as { state: BusinessDocState }).state,
    },
  ];
  return {
    captureId: CAPTURE_ID, aiUsed: true, mode: "approval", margins: true, drawingsAccess: true, fixedJobId: null,
    options: {
      customers: [{ id: "c1", name: "Strojmetal a.s.", customerNumber: "ZAK-0001", ico: "45274649" }],
      suppliers: [{ id: "s1", name: "Kovoobrábění Hrubý s.r.o." }],
      jobs: [{ id: JOB_ID, number: "Z-2026-031", title: "Upínky", customerName: "Strojmetal a.s.", stage: "nabidka" }],
    },
    groups: [g1, g2],
    docs,
    warnings: [
      {
        id: "target_required:d4", code: "target_required", severity: "block", docIds: ["d4"], groupKey: "g2",
        message: "Vyber zakázku pro NAB-552", actions: [],
      },
      {
        id: "revision_conflict:d1,d2", code: "revision_conflict", severity: "warn", docIds: ["d1", "d2"], groupKey: "g1",
        message: "Položka má rev. C, výkres rev. B", actions: [],
      },
    ],
    initial,
    ...over,
  };
}

export function batchResult(over: Partial<BatchResult> = {}): BatchResult {
  return {
    ok: true, status: "done", aiUsed: true,
    groups: [{ key: "g1", ok: true, jobId: JOB_ID, jobNumber: "Z-2026-031", created: false, stageFrom: "nabidka", stageTo: "fakturovano" }],
    docs: [
      {
        docId: "d1", groupKey: "g1", type: "objednavka_zakaznik", label: "Objednávka zákazníka", ok: true, jobId: JOB_ID, jobNumber: "Z-2026-031",
        fileIds: ["x1"], fileKind: "objednavka", title: "Objednávka zákazníka PO-4471", summary: "", links: [{ label: "Zakázka Z-2026-031", href: `/orders/${JOB_ID}` }],
      },
      {
        docId: "d4", groupKey: "g1", type: "nabidka_dodavatel", label: "Nabídka dodavatele", ok: false, error: "Dodavatele se nepodařilo založit.",
        jobId: JOB_ID, jobNumber: "Z-2026-031", fileIds: [], fileKind: "naceneni", title: "Nabídka dodavatele NAB-552", summary: "", links: [],
      },
    ],
    pending: ["d4"], warnings: [],
    ...over,
  };
}
