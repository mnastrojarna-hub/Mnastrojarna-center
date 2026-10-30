import { describe, it, expect } from "vitest";
import { MAIL_ACTION_LABEL, mailActionHref, mailActionPlan } from "./mail-actions";

describe("Pošta E — hlavní akce zprávy podle kategorie", () => {
  const plan = (category: string, opts: { direction?: "in" | "out"; jobId?: string | null } = {}) =>
    mailActionPlan({ category, direction: opts.direction ?? "in", jobId: opts.jobId ?? null });

  it("poptávka → Vytvořit nabídku; u zakázky Pokračovat v nabídce", () => {
    expect(plan("Poptávka")).toEqual({ main: "quote.create", more: ["job.assign", "job.create"] });
    expect(plan("Poptávka", { jobId: "j" })).toEqual({ main: "quote.continue", more: ["job.open"] });
    expect(MAIL_ACTION_LABEL["quote.create"]).toBe("Vytvořit nabídku");
  });
  it("objednávka / potvrzení → Zpracovat objednávku; u zakázky Otevřít zakázku", () => {
    expect(plan("Objednávka").main).toBe("order.process");
    expect(plan("Potvrzení objednávky").main).toBe("order.process");
    expect(plan("Objednávka", { jobId: "j" }).main).toBe("job.open");
  });
  it("faktura → Zapsat fakturu dodavatele, nikdy Založit zakázku", () => {
    for (const jobId of [null, "j"]) {
      const p = plan("Faktura", { jobId });
      expect(p.main).toBe("invoice.record");
      expect([p.main, ...p.more]).not.toContain("job.create");
    }
  });
  it("nabídka dodavatele: bez zakázky Přiřadit, u zakázky Zapsat nabídku dodavatele (Nákup)", () => {
    expect(plan("Nabídka dodavatele")).toEqual({ main: "job.assign", more: [] });
    expect(plan("Nabídka dodavatele", { jobId: "j" }).main).toBe("supplierQuote.record");
    expect(mailActionHref("supplierQuote.record", "j")).toBe("/orders/j?tab=nakup");
  });
  it("K zakázce / upomínka / reklamace / ostatní: Otevřít zakázku nebo Přiřadit; Založit zakázku jen v ⋯", () => {
    for (const c of ["K zakázce", "Reklamace", "Technická dokumentace", "Ostatní"]) {
      expect(plan(c)).toEqual({ main: "job.assign", more: ["job.create"] });
      expect(plan(c, { jobId: "j" }).main).toBe("job.open");
    }
    expect(plan("Upomínka")).toEqual({ main: "job.assign", more: [] });
  });
  it("spam nic; odeslaná jen Otevřít zakázku (nic nezakládat)", () => {
    expect(plan("Spam")).toEqual({ main: null, more: [] });
    expect(plan("Poptávka", { direction: "out" })).toEqual({ main: null, more: [] });
    expect(plan("Poptávka", { direction: "out", jobId: "j" })).toEqual({ main: "job.open", more: [] });
  });
  it("změna kategorie = jiná akce hned (čistá funkce bez stavu)", () => {
    expect(plan("Poptávka").main).toBe("quote.create");
    expect(plan("Faktura").main).toBe("invoice.record");
  });
  it("odkazy bez serveru jen se zakázkou", () => {
    expect(mailActionHref("quote.continue", "j")).toBe("/orders/j?tab=nabidky");
    expect(mailActionHref("job.open", "j")).toBe("/orders/j?tab=komunikace");
    expect(mailActionHref("quote.continue", null)).toBeNull();
    expect(mailActionHref("quote.create", "j")).toBeNull();
  });
});
