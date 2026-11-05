import { describe, it, expect } from "vitest";
import {
  QUOTE_SENT_DELETE_BLOCK, fileDeletePlan, isOurQuotePdf, otherQuotePdfs, pdfVersionsText, quoteDeletePlan, quoteIsSent,
  quotePdfSentBlock, type QuoteFileRef, type QuoteRef,
} from "./quote-files";

/** Nabídka ↔ PDF v Dokumentech: jedna pravidla pro Dokumenty, Nabídky i server. */
const pdf = (id: string, quoteId: string | null, over: Partial<QuoteFileRef> = {}): QuoteFileRef => ({
  id, kind: "nabidka", origin: "generated", quoteId, ...over,
});
const quote = (id: string, over: Partial<QuoteRef> = {}): QuoteRef => ({
  id, number: `NAB-2026-00${id.slice(-1)}`, sentAt: null, status: "ke_schvaleni", ...over,
});

describe("isOurQuotePdf", () => {
  it("jen naše vystavené PDF s vazbou na nabídku", () => {
    expect(isOurQuotePdf(pdf("f1", "q1"))).toBe(true);
    // nahraný / vyfocený doklad s vazbou je příloha, ne nabídka
    expect(isOurQuotePdf(pdf("f1", "q1", { origin: "upload" }))).toBe(false);
    expect(isOurQuotePdf(pdf("f1", "q1", { origin: "capture" }))).toBe(false);
    expect(isOurQuotePdf(pdf("f1", "q1", { origin: null }))).toBe(false);
    // vystavený doklad jiného druhu (potvrzení) nabídku nemaže
    expect(isOurQuotePdf(pdf("f1", "q1", { kind: "potvrzeni" }))).toBe(false);
    // vazba na nabídku je nutná (sirotek po smazané nabídce = obyčejný soubor)
    expect(isOurQuotePdf(pdf("f1", null))).toBe(false);
  });
});

describe("quoteIsSent", () => {
  it("sent_at nebo stav odesláno / přijato", () => {
    expect(quoteIsSent(quote("q1"))).toBe(false);
    expect(quoteIsSent(quote("q1", { sentAt: "2026-11-01T08:00:00Z" }))).toBe(true);
    expect(quoteIsSent(quote("q1", { status: "odeslano" }))).toBe(true);
    expect(quoteIsSent(quote("q1", { status: "prijato" }))).toBe(true);
    // zamítnutá bez sent_at (stará data) — smazat lze jako dřív
    expect(quoteIsSent(quote("q1", { status: "zamitnuto" }))).toBe(false);
  });
});

describe("fileDeletePlan — smazání v Dokumentech", () => {
  const quotes = [quote("q1"), quote("q2", { sentAt: "2026-11-01T08:00:00Z", status: "odeslano" })];

  it("soubor bez vazby / příloha / sirotek: maže se jen soubor", () => {
    expect(fileDeletePlan(pdf("f1", null), [pdf("f1", null)], quotes)).toEqual({ kind: "file" });
    expect(fileDeletePlan(pdf("f1", "q1", { origin: "upload" }), [], quotes)).toEqual({ kind: "file" });
    // vazba na nabídku, která už v kartě není (smazaná) → jen soubor
    expect(fileDeletePlan(pdf("f1", "q9"), [pdf("f1", "q9")], quotes)).toEqual({ kind: "file" });
  });

  it("poslední PDF nabídky bere nabídku s sebou", () => {
    const plan = fileDeletePlan(pdf("f1", "q1"), [pdf("f1", "q1"), pdf("u1", "q1", { origin: "upload" })], quotes);
    expect(plan).toEqual({ kind: "quoteGoes", quote: quotes[0] });
  });

  it("jiná verze PDF téže nabídky (v1 vedle v2) nabídku nechá", () => {
    const all = [pdf("v1", "q1"), pdf("v2", "q1"), pdf("x", "q2")];
    expect(fileDeletePlan(pdf("v1", "q1"), all, quotes)).toEqual({ kind: "quoteStays", quote: quotes[0], others: 1 });
    expect(fileDeletePlan(pdf("v2", "q1"), all, quotes)).toEqual({ kind: "quoteStays", quote: quotes[0], others: 1 });
    expect(otherQuotePdfs(pdf("v1", "q1"), all).map((f) => f.id)).toEqual(["v2"]);
  });

  it("PDF odeslané nabídky smazat nejde — i když je to starší verze", () => {
    const all = [pdf("v1", "q2"), pdf("v2", "q2")];
    const plan = fileDeletePlan(pdf("v1", "q2"), all, quotes);
    expect(plan.kind).toBe("blocked");
    if (plan.kind === "blocked") {
      expect(plan.quote.id).toBe("q2");
      expect(plan.reason).toBe(quotePdfSentBlock("NAB-2026-002"));
      expect(plan.reason).toContain("už byla zákazníkovi odeslána");
    }
  });
});

describe("quoteDeletePlan — smazání v Nabídkách", () => {
  it("počítá vystavená PDF (všechny verze) a nahrané soubory s vazbou", () => {
    const files = [pdf("v1", "q1"), pdf("v2", "q1"), pdf("u1", "q1", { origin: "upload" }), pdf("z", "q2")];
    expect(quoteDeletePlan(quote("q1"), files)).toEqual({ blocked: null, pdfs: 2, linked: 1 });
    expect(quoteDeletePlan(quote("q3"), files)).toEqual({ blocked: null, pdfs: 0, linked: 0 });
  });
  it("odeslaná nabídka: zablokováno (stejné pravidlo jako menu Nabídky)", () => {
    expect(quoteDeletePlan(quote("q1", { sentAt: "2026-11-01T08:00:00Z" }), []).blocked).toBe(QUOTE_SENT_DELETE_BLOCK);
  });
});

describe("texty", () => {
  it("skloňování verzí", () => {
    expect(pdfVersionsText(1)).toBe("1 verze");
    expect(pdfVersionsText(2)).toBe("2 verze");
    expect(pdfVersionsText(5)).toBe("5 verzí");
  });
  it("zámek PDF bez čísla nabídky", () => {
    expect(quotePdfSentBlock(null)).toBe("PDF nabídky nejde smazat — nabídka už byla zákazníkovi odeslána. Archivuj ho, nebo vystav novou verzi.");
  });
});
