import { describe, expect, it } from "vitest";
import {
  addDaysIso, amountInput, bookHref, czDay, fileKindCounts, filterFiles, filterQuotes, FLOW_STEPS, formatBytes,
  formatPercent, isImageFile, marginPercent, marginTone, matchesQuery, parseAmount, pricingSummary, visibleFlowSteps,
  type FileLike, type QuoteLike,
} from "./flow-utils";

describe("kroky toku a odkazy", () => {
  it("bookHref skládá záložku a stavy", () => {
    expect(bookHref("poptavky", ["poptavka"])).toBe("/orders?segment=poptavky&stages=poptavka");
    expect(bookHref("poptavky", ["poptavka", "naceneni"])).toBe("/orders?segment=poptavky&stages=poptavka,naceneni");
    expect(bookHref("objednavky")).toBe("/orders?segment=objednavky");
  });

  it("tok má 5 kroků v pořadí poptávka → potvrzení", () => {
    expect(FLOW_STEPS.map((s) => s.key)).toEqual(["poptavka", "naceneni", "nabidka", "objednavka", "potvrzeni"]);
    expect(FLOW_STEPS.find((s) => s.key === "objednavka")?.href).toBe("/orders?segment=objednavky&stages=objednavka");
  });

  it("#25 krok Nacenění jen s právem pricing", () => {
    expect(visibleFlowSteps(false).map((s) => s.key)).toEqual(["poptavka", "nabidka", "objednavka", "potvrzeni"]);
    expect(visibleFlowSteps(true).map((s) => s.key)).toEqual(FLOW_STEPS.map((s) => s.key));
  });
});

describe("čísla a data", () => {
  it("parseAmount přijme českou i tečkovou notaci", () => {
    expect(parseAmount("1 250,50")).toEqual({ ok: true, value: 1250.5 });
    expect(parseAmount("1250.5")).toEqual({ ok: true, value: 1250.5 });
    expect(parseAmount("2500 Kč")).toEqual({ ok: true, value: 2500 });
    expect(parseAmount("  ")).toEqual({ ok: true, value: null });
    expect(parseAmount("12a")).toEqual({ ok: false });
    expect(parseAmount("1,2,3")).toEqual({ ok: false });
  });

  it("amountInput", () => {
    expect(amountInput(1250.5)).toBe("1250,5");
    expect(amountInput(null)).toBe("");
    expect(amountInput(10)).toBe("10");
  });

  it("addDaysIso a czDay", () => {
    expect(addDaysIso("2026-10-22", 30)).toBe("2026-11-21");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(czDay("2026-11-05")).toBe("5. 11. 2026");
    expect(czDay("2026-11-05", { short: true, today: "2026-10-22" })).toBe("5. 11.");
    expect(czDay("2027-01-05", { short: true, today: "2026-10-22" })).toBe("5. 1. 2027");
    expect(czDay(null)).toBe("—");
  });
});

describe("marže", () => {
  it("marginPercent a barva", () => {
    expect(marginPercent(100, 75)).toBe(25);
    expect(marginPercent(100, null)).toBeNull();
    expect(marginPercent(0, 10)).toBeNull();
    expect(marginTone(-5)).toContain("red");
    expect(marginTone(10)).toContain("amber");
    expect(marginTone(30)).toContain("green");
    expect(formatPercent(24.56)).toMatch(/^24,6\s%$/);
    expect(formatPercent(null)).toBe("—");
  });

  it("pricingSummary sčítá prodej, nákup a marži jen z úplných položek", () => {
    const s = pricingSummary([
      { quantity: 10, unitPrice: 100, purchaseUnitPrice: 60 },
      { quantity: 2, unitPrice: 500, purchaseUnitPrice: null },
      { quantity: 5, unitPrice: null, purchaseUnitPrice: 20 },
    ]);
    expect(s.sale).toBe(2000);
    expect(s.purchase).toBe(700);
    expect(s.unpriced).toBe(1);
    expect(s.complete).toBe(false);
    expect(s.marginPct).toBeCloseTo(40, 5); // (1000 - 600) / 1000
    expect(pricingSummary([])).toMatchObject({ sale: 0, purchase: null, marginPct: null, complete: false });
    expect(pricingSummary([{ quantity: 1, unitPrice: 10, purchaseUnitPrice: null }]).complete).toBe(true);
  });
});

describe("nabídky", () => {
  const now = Date.parse("2026-10-22T10:00:00Z");
  const q = (over: Partial<QuoteLike>): QuoteLike => ({
    number: "NAB-1", title: null, display: "odeslana", stateChangedAt: "2026-10-20T10:00:00Z",
    job: { number: "Z-2026-101", title: "Hřídel" }, customer: { name: "Škoda Auto" }, ...over,
  });

  it("filterQuotes: vybrané stavy, hledání bez diakritiky, uzavřené jen 30 dní", () => {
    const list = [
      q({ number: "NAB-1", display: "vyprsela" }),
      q({ number: "NAB-2", display: "prijata", customer: { name: "Bosch" } }),
      q({ number: "NAB-3", display: "archivovana", stateChangedAt: "2026-08-01T10:00:00Z" }),
      q({ number: "NAB-4", display: "ke_schvaleni" }),
    ];
    const all = ["rozpracovana", "ke_schvaleni", "schvalena", "odeslana", "pripominky", "vyprsela", "prijata", "zamitnuta", "archivovana"];
    expect(filterQuotes(list, { states: all, q: "" }, now).map((x) => x.number)).toEqual(["NAB-1", "NAB-2", "NAB-4"]);
    expect(filterQuotes(list, { states: ["vyprsela"], q: "" }, now).map((x) => x.number)).toEqual(["NAB-1"]);
    expect(filterQuotes(list, { states: ["archivovana"], q: "" }, now)).toHaveLength(0);
    expect(filterQuotes(list, { states: ["archivovana"], q: "" }, now, 120)).toHaveLength(1);
    expect(filterQuotes(list, { states: all, q: "bosch" }, now).map((x) => x.number)).toEqual(["NAB-2"]);
    expect(filterQuotes(list, { states: all, q: "hridel z-2026" }, now)).toHaveLength(3);
    expect(filterQuotes([q({ display: "prijata", stateChangedAt: null })], { states: all, q: "" }, now)).toHaveLength(0);
  });
});

describe("dokumenty", () => {
  const f = (over: Partial<FileLike>): FileLike => ({
    kind: "faktura", filename: "Faktura_FV-2026-001.pdf", title: null, note: null, archived: false,
    job: { number: "Z-2026-111", title: "Příruba", customerName: "Benteler" }, ...over,
  });

  it("filterFiles a počty druhů", () => {
    const list = [f({}), f({ kind: "vykres", filename: "VK-1.pdf" }), f({ kind: "vykres", filename: "VK-0.pdf", archived: true })];
    expect(filterFiles(list, { kind: "vse", archived: false, q: "" })).toHaveLength(2);
    expect(filterFiles(list, { kind: "vykres", archived: true, q: "" })).toHaveLength(2);
    expect(filterFiles(list, { kind: "vse", archived: false, q: "benteler fv-2026" })).toHaveLength(1);
    expect(fileKindCounts(list, false)).toEqual({ vse: 2, faktura: 1, vykres: 1 });
  });

  it("isImageFile, formatBytes, matchesQuery", () => {
    expect(isImageFile("image/jpeg", "x.jpg")).toBe(true);
    expect(isImageFile("image/heic", "x.heic")).toBe(false);
    expect(isImageFile(null, "foto.PNG")).toBe(true);
    expect(isImageFile("application/pdf", "a.pdf")).toBe(false);
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 kB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(null)).toBe("");
    expect(matchesQuery(["Škoda Auto"], "skoda")).toBe(true);
    expect(matchesQuery(["Škoda Auto"], "bosch")).toBe(false);
  });
});
