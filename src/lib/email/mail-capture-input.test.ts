import { describe, expect, it } from "vitest";
import {
  applyMailContextToReview, isSignatureImage, isSignatureImageSize, mailClassifyContext, mailSubjectTitle, phoneFromSignature,
  selectMailAttachments, senderContactPlan, type MailCaptureContext,
} from "@/lib/email/mail-capture-input";
import type { BatchReviewModel, DrawingReviewState } from "@/lib/jobs/capture-batch-types";
import type { ReviewState } from "@/lib/jobs/capture-review";

const row = (id: string, filename: string, mime: string, size: number) => ({ id, filename, mime_type: mime, size_bytes: size });

describe("selectMailAttachments — přílohy e-mailu do dávky focení", () => {
  it("výkresy, STEP a objednávka ano; logo z podpisu, vizitka a S/MIME podpis ne", () => {
    const { take, skipped } = selectMailAttachments([
      row("a1", "4711-02.pdf", "application/pdf", 220_000),
      row("a2", "4711-03_scan.pdf", "application/pdf", 1_800_000),
      row("a3", "4711-02.step", "application/octet-stream", 900_000),
      row("a4", "Objednavka_PO-4471.pdf", "application/pdf", 80_000),
      row("a5", "image001.png", "image/png", 42_000),
      row("a6", "logo.gif", "image/gif", 6_000),
      row("a7", "jan.novak.vcf", "text/vcard", 900),
      row("a8", "smime.p7s", "application/pkcs7-signature", 4_000),
      row("a9", "foto_dilu.jpg", "image/jpeg", 2_400_000),
    ]);
    expect(take.map((t) => t.id)).toEqual(["a1", "a2", "a3", "a4", "a9"]);
    expect(skipped.map((s) => s.id).sort()).toEqual(["a5", "a6", "a7", "a8"]);
    expect(skipped.find((s) => s.id === "a5")!.reason).toMatch(/podpis/);
  });

  it("nad 50 MB a nad limit dávky se vynechá s důvodem", () => {
    const rows = Array.from({ length: 4 }, (_, i) => row(`b${i}`, `D-${100 + i}.pdf`, "application/pdf", 10_000));
    const { take, skipped } = selectMailAttachments([...rows, row("big", "velky.pdf", "application/pdf", 60 * 1024 * 1024)], 3);
    expect(take).toHaveLength(3);
    expect(skipped.map((s) => s.reason)).toEqual(["najednou jde roztřídit nejvýš 3 souborů", "větší než 50 MB"]);
  });

  it("logo podle názvu jen do 300 kB, malé obrázky vždy; rozměry pod 500 px = logo", () => {
    expect(isSignatureImage("Outlook-abc123.png", "image/png", 120_000)).toBe(true);
    expect(isSignatureImage("image003.jpg", "image/jpeg", 900_000)).toBe(false);
    expect(isSignatureImage("vykres.png", "image/png", 9_000)).toBe(true);
    expect(isSignatureImage("4711.pdf", "application/pdf", 9_000)).toBe(false);
    expect(isSignatureImageSize({ width: 420, height: 120 })).toBe(true);
    expect(isSignatureImageSize({ width: 2400, height: 1800 })).toBe(false);
    expect(isSignatureImageSize(null)).toBe(false);
  });
});

describe("kontext e-mailu", () => {
  it("telefon z podpisu (řádek tel / mobil má přednost, IČO a účet ne)", () => {
    const body = "Dobrý den,\nposílám poptávku na 10 ks.\n\nS pozdravem\nJan Novák\nIČO: 12345678\nMobil: +420 603 123 456\nwww.firma.cz\n\n> Dne 1. 11. napsal:\n> tel 777 000 111";
    expect(phoneFromSignature(body)).toBe("+420 603 123 456");
    expect(phoneFromSignature("Díky\nPetr")).toBe("");
  });

  it("kontext pro roztřídění je krátký a bez < >", () => {
    const t = mailClassifyContext({ subject: "Poptávka <urgent>", fromName: "Jan", fromEmail: "jan@firma.cz", body: "x".repeat(5000) });
    expect(t).toContain("Předmět: Poptávka urgent");
    expect(t).toContain("Od: Jan jan@firma.cz");
    expect(t.length).toBeLessThan(1500);
  });

  it("předmět bez RE/FW jako název zakázky", () => {
    expect(mailSubjectTitle("RE: FW: Poptávka – hřídele 4711")).toBe("Poptávka – hřídele 4711");
  });

  it("odesílatel vůči kontaktům zákazníka", () => {
    const contacts = [{ id: "k1", name: "Jana Malá", email: "jana@firma.cz" }];
    expect(senderContactPlan({ name: "Jana", email: "JANA@firma.cz" }, "c1", contacts)).toMatchObject({ status: "existing", contactId: "k1", name: "Jana Malá" });
    expect(senderContactPlan({ name: "Petr Nový", email: "petr@firma.cz", phone: "603" }, "c1", contacts)).toMatchObject({ status: "new", contactId: null, phone: "603" });
    expect(senderContactPlan({ name: "Petr", email: "petr@firma.cz" }, null, contacts).status).toBe("none");
  });
});

function ctx(over: Partial<MailCaptureContext> = {}): MailCaptureContext {
  return {
    emailId: "e1", threadId: "t1", subject: "RE: Poptávka hřídele", fromName: "Petr Nový", fromEmail: "petr@firma.cz", category: "poptavka",
    customerId: "c1", customerName: "Strojmetal", body: "Prosíme o nabídku:\n4711-02 – 10 ks\n4711-03 – 4 ks", phone: "+420 603 123 456",
    files: [], skipped: [], ...over,
  };
}

function drawingState(drawingNumber: string, quantity = ""): DrawingReviewState {
  return {
    drawingNumber, revision: "", title: "", material: "", dimensions: "", generalTolerance: "", tightestTolerance: "", quantity,
    link: { mode: "add" }, archive: true, note: "", onDuplicate: null,
  };
}

function review(): BatchReviewModel {
  const job = { targetKey: "new", customer: { mode: "none" }, fields: {}, items: [], merges: [], stage: "poptavka" } as unknown as ReviewState;
  const drawing = (docId: string, n: string, q = "") => ({
    kind: "drawing" as const, docId, groupKey: "g1", aiUsed: true, reason: null,
    drawing: { drawingNumber: n } as never, duplicateOf: null, archiveConflict: null, initial: drawingState(n, q),
  });
  return {
    captureId: "cap", aiUsed: true, mode: "approval", margins: true, drawingsAccess: true, fixedJobId: null,
    options: { customers: [], suppliers: [], jobs: [] },
    groups: [{ key: "g1", docIds: ["d1", "d2", "d3"], primaryDocId: null, label: "", autoReason: null, model: { initial: job } as never, visibleFields: [], fieldSources: {}, itemSources: {}, itemOptions: {} }],
    docs: [drawing("d1", "4711-02"), drawing("d2", "4711-03"), drawing("d3", "9999-1", "7")],
    warnings: [
      { id: "drawing_quantity_missing:d1", code: "drawing_quantity_missing", severity: "warn", docIds: ["d1"], groupKey: "g1", message: "", actions: [] },
      { id: "drawing_quantity_missing:d2", code: "drawing_quantity_missing", severity: "warn", docIds: ["d2"], groupKey: "g1", message: "", actions: [] },
    ],
    initial: {
      sort: { docs: [], excludedPageIds: [] },
      groups: [{ key: "g1", docIds: ["d1", "d2", "d3"], job, customerConfirmed: false, jobDraftTitle: "" }],
      docs: {
        d1: { kind: "drawing", state: drawingState("4711-02") },
        d2: { kind: "drawing", state: drawingState("4711-03") },
        d3: { kind: "drawing", state: drawingState("9999-1", "7") },
      },
    },
  };
}

describe("applyMailContextToReview — co doklady neříkají, doplní e-mail", () => {
  it("zákazník odesílatele, kontakt, název z předmětu a počty kusů z textu (jen prázdná místa)", () => {
    const r = applyMailContextToReview(review(), ctx(), ["4711-02.pdf", "4711-03.pdf"]);
    const g = r.initial.groups[0];
    expect(g.job.customer).toEqual({ mode: "existing", id: "c1", name: "Strojmetal", reason: "odesílatel e-mailu" });
    expect(g.job.fields).toMatchObject({ customerContact: "Petr Nový", customerContactEmail: "petr@firma.cz", customerContactPhone: "+420 603 123 456" });
    expect(g.jobDraftTitle).toBe("Poptávka hřídele");
    const q = (id: string) => { const d = r.initial.docs[id]; return d.kind === "drawing" ? d.state.quantity : null; };
    expect(q("d1")).toBe("10");
    expect(q("d2")).toBe("4");
    expect(q("d3")).toBe("7"); // výkres s počtem se nepřepisuje
    expect(r.docs.find((d) => d.docId === "d1")).toMatchObject({ sources: { quantity: "z textu e-mailu" } });
    expect(r.warnings.filter((w) => w.code === "drawing_quantity_missing")).toHaveLength(0);
  });

  it("zákazník z dokladu a existující zakázka mají přednost", () => {
    const base = review();
    base.initial.groups[0].job.customer = { mode: "existing", id: "c9", name: "Jiný", reason: "IČO" };
    const r = applyMailContextToReview(base, ctx());
    expect(r.initial.groups[0].job.customer).toMatchObject({ id: "c9" });
    const fixed = review();
    fixed.initial.groups[0].job.targetKey = "job-1";
    const r2 = applyMailContextToReview(fixed, ctx());
    expect(r2.initial.groups[0].job.customer).toEqual({ mode: "none" });
    expect(r2.initial.groups[0].job.fields).toEqual({});
  });

  it("vynechané přílohy jako upozornění", () => {
    const r = applyMailContextToReview(review(), ctx({ skipped: [{ id: "a5", filename: "image001.png", reason: "logo / obrázek z podpisu" }] }));
    expect(r.warnings.some((w) => /image001\.png/.test(w.message))).toBe(true);
  });
});
