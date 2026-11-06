import { describe, expect, it } from "vitest";
import {
  applyMailContextToReview, companyFromDomain, deadlineFromMailText, isSignatureImage, isSignatureImageSize, looksLikePerson, mailClassifyContext,
  mailDocKindOf, mailDocTypeOf, mailSubjectTitle, mailTextExtractRules, mergeMailExtract, nameFromLocalPart, phoneFromSignature,
  selectMailAttachments, senderContactPlan, senderNameOf, signatureInfo, type MailCaptureContext,
} from "@/lib/email/mail-capture-input";
import { emptyExtracted, emptyParty } from "@/lib/jobs/extracted-normalize";
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

// ── Podpis e-mailu a text jako doklad (majitel 6. 11.) ─────
const CEJKA = [
  "Dobrý den,",
  "prosím o cenovou nabídku na výrobu dle přiloženého výkresu SDF000637.4, 20 ks, termín dodání do 15. 12. 2026.",
  "Materiál dle výkresu, dodat s atestem 3.1.",
  "",
  "S pozdravem",
  "Jan Čejka",
  "Nákup",
  "STEELING, s.r.o.",
  "Tovární 1402/12, 796 01 Prostějov",
  "IČO: 08542311, DIČ: CZ08542311",
  "Tel.: +420 777 248 197",
  "jan.cejka@steeling.cz | www.steeling.cz",
  "",
  "Dne 5. 11. 2026 napsal Mnástrojárna <obchod@mnastrojarna.cz>:",
  "> Dobrý den, posíláme ceník.",
].join("\n");

describe("podpis e-mailu → kontaktní osoba, firma, hlavička", () => {
  it("jméno, pozice, firma, IČO / DIČ, adresa, telefon, e-mail z podpisu (citace se ignoruje)", () => {
    const sig = signatureInfo(CEJKA, "jan.cejka@steeling.cz");
    expect(sig).toMatchObject({
      name: "Jan Čejka", position: "Nákup", company: "STEELING, s.r.o.", ico: "08542311", dic: "CZ08542311",
      street: "Tovární 1402/12", city: "Prostějov", zip: "796 01", phone: "+420 777 248 197", email: "jan.cejka@steeling.cz",
    });
  });

  it("jméno odesílatele nikdy surová adresa: podpis > zobrazované jméno osoby > místní část adresy", () => {
    expect(senderNameOf({ fromName: "jan.cejka@steeling.cz", fromEmail: "jan.cejka@steeling.cz", body: CEJKA })).toBe("Jan Čejka");
    expect(senderNameOf({ fromName: "jan.cejka@steeling.cz", fromEmail: "jan.cejka@steeling.cz", body: "Díky, pošlu zítra." })).toBe("Jan Cejka");
    expect(senderNameOf({ fromName: "Ing. Petra Nová", fromEmail: "petra@firma.cz", body: "Díky" })).toBe("Ing. Petra Nová");
    expect(senderNameOf({ fromName: "Nákup STEELING", fromEmail: "nakup@steeling.cz", body: "Díky" })).toBe("");
    expect(senderNameOf({ fromName: "Novák Jan (Strojmetal)", fromEmail: "x@strojmetal.cz", body: "" })).toBe("Novák Jan");
    expect(nameFromLocalPart("info@firma.cz")).toBe("");
    expect(looksLikePerson("STEELING, s.r.o.")).toBe(false);
    expect(looksLikePerson("Ing. Jan Novák, Ph.D.")).toBe(true);
    expect(companyFromDomain("jan@steeling.cz")).toBe("Steeling");
    expect(companyFromDomain("jan@gmail.com")).toBe("");
    expect(companyFromDomain("jan@firma.co.uk")).toBe("Firma");
  });

  it("podpis „Jan Novák | vedoucí nákupu“ a firma bez přípony velkými písmeny", () => {
    const sig = signatureInfo("Prosím nabídku.\n\nS pozdravem\nJan Novák | vedoucí nákupu\nKOVO PLUS\nmobil 603 222 333", "jan@kovoplus.cz");
    expect(sig).toMatchObject({ name: "Jan Novák", position: "vedoucí nákupu", company: "KOVO PLUS", phone: "603 222 333" });
  });

  it("bez značky podpisu: poslední odstavec s telefonem je podpis, běžný text ne", () => {
    expect(signatureInfo("Objednáváme 10 ks.\n\nPetr Malý\nTel: 777 111 222", "petr@firma.cz")).toMatchObject({ name: "Petr Malý", phone: "777 111 222" });
    expect(signatureInfo("Objednáváme 10 ks dle výkresu.\nDodat do 20. 12.", "petr@firma.cz").name).toBe("");
  });

  it("termín a druh z textu", () => {
    const now = new Date("2026-11-06T10:00:00Z");
    expect(deadlineFromMailText("termín dodání do 15. 12. 2026", now)).toBe("2026-12-15");
    expect(deadlineFromMailText("Dodat do 20.1.", now)).toBe("2027-01-20");
    expect(deadlineFromMailText("delivery by 2026-12-01", now)).toBe("2026-12-01");
    expect(deadlineFromMailText("materiál 1.4301, 10 ks", now)).toBe("");
    expect(mailDocKindOf({ category: "objednavka", subject: "x", body: "" })).toBe("objednavka");
    expect(mailDocKindOf({ category: "ostatni", subject: "Poptávka šroubů", body: "" })).toBe("poptavka");
    expect(mailDocKindOf({ category: null, subject: "Objednávka č. 4471", body: "" })).toBe("objednavka");
    expect(mailDocKindOf({ category: null, subject: "Výkresy", body: "Objednáváme 10 ks." })).toBe("objednavka");
    expect(mailDocKindOf({ category: null, subject: "RE: výkresy", body: "v příloze" })).toBe("poptavka");
    expect(mailDocTypeOf({ docKind: "potvrzeni", issuer: "zakaznik" })).toBe("objednavka_zakaznik");
    expect(mailDocTypeOf({ docKind: "nabidka", issuer: "dodavatel" })).toBeNull();
    // e-mail dodavatelské kategorie (potvrzení naší objednávky, nabídka dodavatele) není doklad zákazníka
    const sup = mailTextExtractRules({ subject: "Potvrzení objednávky OV-1", fromName: "", fromEmail: "objednavky@hruby-cnc.cz", category: "potvrzeni_objednavky", body: "", rawBody: "Potvrzujeme.\nPavel Hrubý\ntel 315 700 120" });
    expect(sup.doc.issuer).toBe("dodavatel");
    expect(mailDocTypeOf(sup.doc)).toBeNull();
    expect(sup.person.name).toBe("Pavel Hrubý");
  });

  it("pravidla: text e-mailu jako poptávka — zákazník z podpisu, kontakt, položka s počtem z textu, termín", () => {
    const ex = mailTextExtractRules({
      subject: "RE: Poptávka – stud bolt M42", fromName: "jan.cejka@steeling.cz", fromEmail: "jan.cejka@steeling.cz", category: "poptavka", body: "", rawBody: CEJKA,
    }, ["SDF000637.4.pdf"], new Date("2026-11-06T10:00:00Z"));
    expect(ex.aiUsed).toBe(false);
    expect(ex.doc).toMatchObject({ docKind: "poptavka", issuer: "zakaznik", requiredDeliveryDate: "2026-12-15", summary: "Poptávka – stud bolt M42" });
    expect(ex.doc.customer).toMatchObject({ name: "STEELING, s.r.o.", ico: "08542311", dic: "CZ08542311", city: "Prostějov", zip: "796 01", email: "jan.cejka@steeling.cz", phone: "+420 777 248 197", contactPerson: "Jan Čejka" });
    expect(ex.doc.items).toEqual([expect.objectContaining({ drawingNumber: "SDF000637.4", quantity: 20, unit: "ks" })]);
    expect(ex.person).toEqual({ name: "Jan Čejka", position: "Nákup", email: "jan.cejka@steeling.cz", phone: "+420 777 248 197" });
  });

  it("pravidla: neznámý odesílatel bez podpisu → firma podle domény, jméno z adresy, objednávka s číslem", () => {
    const ex = mailTextExtractRules({
      subject: "Objednávka PO-4471", fromName: "", fromEmail: "petr.hora@kovoplus.cz", category: null, body: "", rawBody: "Objednáváme dle nabídky NAB-2026-031:\n4711-02 – 10 ks\n4711-03 – 4 ks\nDíky",
    }, ["4711-02.pdf", "4711-03.pdf"]);
    expect(ex.doc).toMatchObject({ docKind: "objednavka", documentNumber: "PO-4471", customerOrderNumber: "PO-4471", ourQuoteNumber: "NAB-2026-031" });
    expect(ex.doc.customer).toMatchObject({ name: "Kovoplus", contactPerson: "Petr Hora", email: "petr.hora@kovoplus.cz" });
    expect(ex.doc.items.map((i) => [i.drawingNumber, i.quantity])).toEqual([["4711-02", 10], ["4711-03", 4]]);
  });

  it("sloučení AI + pravidla: AI má přednost, mezery doplní podpis; adresa jako jméno se nahradí", () => {
    const rules = mailTextExtractRules({ subject: "Poptávka", fromName: "jan.cejka@steeling.cz", fromEmail: "jan.cejka@steeling.cz", category: "poptavka", body: "", rawBody: CEJKA }, ["SDF000637.4.pdf"]);
    const ai = { ...emptyExtracted(), docKind: "ostatni" as const, issuer: "neznamy" as const, customer: { ...emptyParty(), name: "Steeling s. r. o.", contactPerson: "jan.cejka@steeling.cz" },
      items: [{ drawingNumber: "SDF000637.4", revision: "A", name: "Stud bolt M42", description: "", material: "", quantity: 0, unit: "ks", unitPrice: 0, deliveryDate: "" }], confidence: 0.9 };
    const m = mergeMailExtract({ doc: ai, position: "" }, rules);
    expect(m.aiUsed).toBe(true);
    expect(m.doc.docKind).toBe("poptavka");
    expect(m.doc.issuer).toBe("zakaznik");
    expect(m.doc.customer).toMatchObject({ name: "Steeling s. r. o.", ico: "08542311", contactPerson: "Jan Čejka", phone: "+420 777 248 197" });
    expect(m.doc.items[0]).toMatchObject({ name: "Stud bolt M42", quantity: 20 });
    expect(m.doc.requiredDeliveryDate).toBe("2026-12-15");
    expect(m.person).toMatchObject({ name: "Jan Čejka", position: "Nákup" });
  });
});
