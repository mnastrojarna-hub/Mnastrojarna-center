import { describe, it, expect } from "vitest";
import {
  DEFAULT_TIERS, addTierDraft, bandBar, cleanTiers, compactCzk, currentRule, formatRate, formatStamp, lastMonths, monthBars,
  monthLabel, ownerTotals, parsePeriodParam, percentToRate, periodSlash, removeTierDraft, ruleLines, ruleSummary, statementDue,
  tierDraftsFromTiers, tierDraftsToInput, tierRangeLabel, tieredExample, simpleExample, validateCommissionRuleInput,
  validateTierDrafts, entriesOfStatement, pendingEntries,
} from "./model";

/** Nezlomitelné mezery z Intl → obyčejné (čitelné porovnání). */
const sp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

const OWNER = "4b27a72c-e981-4023-bab7-1e40adf303bd";
const PCT_TIERS = [
  { from: 0, to: 500_000, rate: 0 },
  { from: 500_000, to: 1_000_000, rate: 10 },
  { from: 1_000_000, to: 2_000_000, rate: 15 },
  { from: 2_000_000, to: null, rate: 20 },
];

describe("procenta a částky", () => {
  it("procenta ↔ zlomek", () => {
    expect(percentToRate("10")).toBe(0.1);
    expect(percentToRate("12,5 %")).toBe(0.125);
    expect(percentToRate(0)).toBe(0);
    expect(percentToRate(100)).toBe(1);
    expect(percentToRate(101)).toBeNull();
    expect(percentToRate(-1)).toBeNull();
    expect(percentToRate("abc")).toBeNull();
    expect(percentToRate("")).toBeNull();
    expect(formatRate(0.15)).toBe("15 %");
    expect(formatRate(0.125)).toBe("12,5 %");
  });
  it("zkrácené částky na lištu", () => {
    expect(sp(compactCzk(500_000))).toBe("500 tis.");
    expect(sp(compactCzk(1_200_000))).toBe("1,2 mil.");
    expect(compactCzk(800)).toBe("800");
  });
});

describe("pásma smlouvy", () => {
  it("platná pásma (procenta) → zlomky, seřazená", () => {
    const r = cleanTiers([...PCT_TIERS].reverse());
    expect("tiers" in r && r.tiers).toEqual(DEFAULT_TIERS);
  });
  it("pásma ze zlomků (DB)", () => {
    const r = cleanTiers(DEFAULT_TIERS, "fraction");
    expect("tiers" in r && r.tiers).toEqual(DEFAULT_TIERS);
  });
  it("chyby: od nuly, navazování, poslední otevřené, sazby", () => {
    expect(cleanTiers([])).toEqual({ error: "Zadej alespoň jedno pásmo." });
    expect(cleanTiers([{ from: 100, to: null, rate: 5 }])).toEqual({ error: "První pásmo musí začínat od 0 Kč." });
    const gap = cleanTiers([{ from: 0, to: 500_000, rate: 0 }, { from: 600_000, to: null, rate: 10 }]);
    expect("error" in gap && gap.error).toMatch(/navazovat/);
    expect(cleanTiers([{ from: 0, to: 500_000, rate: 0 }, { from: 500_000, to: 900_000, rate: 10 }])).toEqual({
      error: "Poslední pásmo musí být bez horní hranice („a více“).",
    });
    expect(cleanTiers([{ from: 0, to: null, rate: 0 }, { from: 0, to: null, rate: 10 }])).toMatchObject({ error: expect.stringMatching(/jen poslední/) });
    expect(cleanTiers([{ from: 0, to: 0, rate: 0 }, { from: 0, to: null, rate: 10 }])).toMatchObject({ error: expect.stringMatching(/vyšší než dolní/) });
    expect(cleanTiers([{ from: 0, to: null, rate: 120 }])).toEqual({ error: "Pásmo 1: sazba musí být 0–100 %." });
    expect(cleanTiers([{ from: 0, to: "abc", rate: 1 }, { from: 0, to: null, rate: 1 }])).toEqual({ error: "Pásmo 1: neplatná horní hranice." });
  });
  it("koncepty editoru: dolní hranice se dopočítá, nejde udělat mezeru", () => {
    const drafts = tierDraftsFromTiers(DEFAULT_TIERS);
    expect(drafts.map((d) => [d.to, d.rate])).toEqual([["500000", "0"], ["1000000", "10"], ["2000000", "15"], ["", "20"]]);
    expect(tierDraftsToInput(drafts)).toEqual([
      { from: 0, to: "500000", rate: "0" },
      { from: 500000, to: "1000000", rate: "10" },
      { from: 1000000, to: "2000000", rate: "15" },
      { from: 2000000, to: null, rate: "20" },
    ]);
    expect(validateTierDrafts(drafts)).toEqual({ tiers: DEFAULT_TIERS });
    const more = addTierDraft(drafts);
    expect(more).toHaveLength(5);
    expect(more[3].to).toBe("4000000");
    expect(more[4].to).toBe("");
    expect(removeTierDraft(more, 3)).toHaveLength(4);
    expect(removeTierDraft([drafts[0]], 0)).toHaveLength(1);
    const broken = drafts.map((d, i) => (i === 1 ? { ...d, to: "400000" } : d));
    expect(validateTierDrafts(broken)).toMatchObject({ error: expect.stringMatching(/navazovat|vyšší než dolní/) });
  });
});

describe("validace smlouvy", () => {
  const today = "2026-10-22";
  it("pásmová smlouva — vždy z inkasa, výchozí název a splatnost", () => {
    const r = validateCommissionRuleInput({ ownerId: OWNER, base: "margin_tiered", basis: "ordered", tiers: PCT_TIERS }, today);
    expect(r).toEqual({
      value: {
        id: null, ownerId: OWNER, name: "Dodatek — pásmová měsíční provize ze zisku", base: "margin_tiered", basis: "collected",
        rate: 0, tiers: DEFAULT_TIERS, validFrom: today, payoutDays: 20, note: null,
      },
    });
  });
  it("procento ze zisku / z obratu", () => {
    expect(validateCommissionRuleInput({ ownerId: OWNER, base: "margin", rate: "12,5", validFrom: "2026-01-01", payoutDays: "15", name: " Smlouva " }, today))
      .toMatchObject({ value: { base: "margin", basis: "ordered", rate: 0.125, tiers: null, validFrom: "2026-01-01", payoutDays: 15, name: "Smlouva" } });
    expect(validateCommissionRuleInput({ ownerId: OWNER, base: "revenue", rate: 5 }, today)).toMatchObject({ value: { base: "revenue", rate: 0.05, name: "Provize z obratu" } });
  });
  it("chyby", () => {
    expect(validateCommissionRuleInput({ ownerId: "x", base: "margin", rate: 10 }, today)).toEqual({ error: "Vyber obchodníka." });
    expect(validateCommissionRuleInput({ ownerId: OWNER, base: "nic" as never, rate: 10 }, today)).toEqual({ error: "Vyber druh provize." });
    expect(validateCommissionRuleInput({ ownerId: OWNER, base: "margin", rate: "" }, today)).toEqual({ error: "Sazba provize musí být číslo 0–100 %." });
    expect(validateCommissionRuleInput({ ownerId: OWNER, base: "margin", rate: 10, validFrom: "2026-13-01" }, today)).toEqual({ error: "Neplatné datum platnosti." });
    expect(validateCommissionRuleInput({ ownerId: OWNER, base: "margin", rate: 10, payoutDays: "1,5" }, today)).toEqual({ error: "Splatnost musí být celý počet dní 0–365." });
    expect(validateCommissionRuleInput({ id: "abc", ownerId: OWNER, base: "margin", rate: 10 }, today)).toEqual({ error: "Smlouva nenalezena." });
    expect(validateCommissionRuleInput({ ownerId: OWNER, base: "margin_tiered", tiers: [] }, today)).toEqual({ error: "Zadej alespoň jedno pásmo." });
  });
  it("platná smlouva k datu", () => {
    const rules = [
      { id: "a", validFrom: "2026-01-01", createdAt: "2026-01-01T00:00:00Z" },
      { id: "b", validFrom: "2026-06-01", createdAt: "2026-05-01T00:00:00Z" },
      { id: "c", validFrom: "2026-06-01", createdAt: "2026-05-20T00:00:00Z" },
      { id: "d", validFrom: "2027-01-01", createdAt: "2026-10-01T00:00:00Z" },
    ];
    expect(currentRule(rules, "2026-10-22")?.id).toBe("c");
    expect(currentRule(rules, "2026-03-01")?.id).toBe("a");
    expect(currentRule(rules, "2025-01-01")).toBeNull();
  });
  it("popisy smlouvy", () => {
    const tiered = { base: "margin_tiered" as const, rate: 0, tiers: DEFAULT_TIERS, basis: "collected" as const, payoutDays: 20 };
    expect(ruleSummary(tiered)).toBe("Pásmová provize · 0/10/15/20 %");
    expect(ruleSummary({ base: "margin", rate: 0.1, tiers: null })).toBe("10 % ze zisku");
    expect(ruleSummary({ base: "revenue", rate: 0.05, tiers: null })).toBe("5 % z obratu");
    expect(ruleSummary(null, 0.1)).toBe("10 % ze zisku");
    expect(ruleSummary(null)).toBe("Bez provize");
    const lines = ruleLines(tiered).map(sp);
    expect(lines[0]).toBe("do 500 000 Kč měsíčního inkasa → 0 % ze zisku");
    expect(lines[1]).toBe("500 000 – 1 000 000 Kč měsíčního inkasa → 10 % ze zisku");
    expect(lines[3]).toBe("nad 2 000 000 Kč měsíčního inkasa → 20 % ze zisku");
    expect(lines.at(-1)).toBe("Splatnost do 20 dnů po skončení měsíce.");
    expect(sp(tierRangeLabel({ from: 1_000_000, to: 2_000_000 }, true))).toBe("1 mil. – 2 mil.");
  });
});

describe("modelový příklad (stejně jako DB)", () => {
  it("1 200 000 Kč inkasa, zisk 600 000 → 0 + 25 000 + 15 000 = 40 000 Kč", () => {
    const r = tieredExample(1_200_000, 600_000, DEFAULT_TIERS);
    expect(r.commission).toBe(40_000);
    expect(r.bands.map((b) => [b.revenue, b.profit, b.commission])).toEqual([
      [500_000, 250_000, 0], [500_000, 250_000, 25_000], [200_000, 100_000, 15_000], [0, 0, 0],
    ]);
  });
  it("nad 2 mil. a záporný zisk", () => {
    expect(tieredExample(3_000_000, 1_500_000, DEFAULT_TIERS).commission).toBe(0 + 25_000 + 75_000 + 100_000);
    expect(tieredExample(1_000_000, -50_000, DEFAULT_TIERS).commission).toBe(0);
    expect(tieredExample(0, 0, DEFAULT_TIERS).commission).toBe(0);
  });
  it("jednoduchá smlouva", () => {
    expect(simpleExample("margin", 0.1, 100_000, 30_000)).toBe(3_000);
    expect(simpleExample("revenue", 0.05, 100_000, 30_000)).toBe(5_000);
    expect(simpleExample("margin", 0.1, 100_000, -5_000)).toBe(0);
  });
});

describe("lišta pásem", () => {
  it("šířky dle rozsahu, naplnění dle inkasa, značka a další pásmo", () => {
    const bands = tieredExample(1_200_000, 600_000, DEFAULT_TIERS).bands;
    const m = bandBar(bands, 1_200_000);
    // 500k / 500k / 1M / otevřené (¼ z 2M = 500k) → škála 2,5M
    expect(m.segments.map((s) => s.width)).toEqual([20, 20, 40, 20]);
    expect(m.segments.map((s) => s.fill)).toEqual([1, 1, 0.2, 0]);
    expect(m.segments.map((s) => s.reached)).toEqual([true, true, true, false]);
    expect(m.currentIndex).toBe(2);
    expect(m.markerPct).toBe(48);
    expect(m.next).toEqual({ rate: 0.2, from: 2_000_000, missing: 800_000 });
    expect(m.commission).toBe(40_000);
  });
  it("bez inkasa — první pásmo, chybí 500 000 do 10 %", () => {
    const m = bandBar(DEFAULT_TIERS, 0);
    expect(m.currentIndex).toBe(0);
    expect(m.markerPct).toBe(0);
    expect(m.next).toEqual({ rate: 0.1, from: 500_000, missing: 500_000 });
    expect(m.segments.every((s) => s.fill === 0)).toBe(true);
  });
  it("inkaso nad poslední hranicí roztáhne otevřené pásmo", () => {
    const m = bandBar(DEFAULT_TIERS, 4_000_000);
    expect(m.currentIndex).toBe(3);
    expect(m.next).toBeNull();
    expect(m.markerPct).toBeLessThan(100);
    expect(m.segments[3].fill).toBeGreaterThan(0.8);
    expect(m.segments[3].fill).toBeLessThan(1);
  });
  it("prázdná pásma", () => {
    expect(bandBar([], 1000)).toEqual({ segments: [], markerPct: 0, currentIndex: -1, next: null, commission: 0 });
  });
});

describe("měsíce a vyúčtování", () => {
  it("posledních 12 měsíců přes přelom roku", () => {
    const m = lastMonths("2026-02-15", 4);
    expect(m).toEqual(["2026-02-01", "2026-01-01", "2025-12-01", "2025-11-01"]);
    expect(lastMonths("2026-10-22", 12)).toHaveLength(12);
    expect(monthLabel("2026-10-01")).toBe("říjen 2026");
    expect(periodSlash("2026-10-01")).toBe("10/2026");
    expect(parsePeriodParam("2026-10")).toBe("2026-10-01");
    expect(parsePeriodParam("2026-13")).toBeNull();
    expect(parsePeriodParam(undefined)).toBeNull();
  });
  it("splatnost", () => {
    expect(statementDue({ status: "otevrena", dueDate: "2026-11-20", paidAt: null }, "2026-10-22")).toEqual({ label: "splatná do 20. 11. 2026", overdue: false });
    expect(statementDue({ status: "k_vyplate", dueDate: "2026-10-20", paidAt: null }, "2026-10-22")).toEqual({ label: "po splatnosti od 20. 10. 2026", overdue: true });
    expect(statementDue({ status: "vyplaceno", dueDate: "2026-10-20", paidAt: "2026-10-18" }, "2026-10-22")).toEqual({ label: "vyplaceno 18. 10. 2026", overdue: false });
  });
  it("zakázky vyúčtování a předběžné", () => {
    const e = (id: string, period: string, collected: boolean, base: "margin" | "margin_tiered" = "margin_tiered") =>
      ({ id, ownerId: OWNER, period, collected, base, estimatedCommission: 100 });
    const list = [e("a", "2026-10-01", true), e("b", "2026-10-01", false), e("c", "2026-09-01", true), e("d", "2026-10-01", false, "margin")];
    expect(entriesOfStatement(list, { ownerId: OWNER, period: "2026-10-01", basis: "collected" }).map((x) => x.id)).toEqual(["a"]);
    expect(entriesOfStatement(list, { ownerId: OWNER, period: "2026-10-01", basis: "ordered" }).map((x) => x.id)).toEqual(["a", "b", "d"]);
    expect(pendingEntries(list).map((x) => x.id)).toEqual(["b"]);
  });
  it("součty po obchodnících a sloupečky měsíců", () => {
    const st = [
      { ownerId: "o1", period: "2026-10-01", status: "otevrena" as const, commission: 1000 },
      { ownerId: "o1", period: "2026-09-01", status: "k_vyplate" as const, commission: 500 },
      { ownerId: "o1", period: "2026-08-01", status: "vyplaceno" as const, commission: 250.5 },
      { ownerId: "o2", period: "2026-10-01", status: "otevrena" as const, commission: 3000 },
    ];
    const en = [{ ownerId: "o1", base: "margin_tiered" as const, collected: false, estimatedCommission: 120 }];
    expect(ownerTotals(["o1", "o2"], st, en, "2026-10-01")).toEqual([
      { ownerId: "o1", month: 1000, toPay: 500, paid: 250.5, running: 1000, estimate: 120 },
      { ownerId: "o2", month: 3000, toPay: 0, paid: 0, running: 3000, estimate: 0 },
    ]);
    const bars = monthBars(["2026-10-01", "2026-09-01", "2026-07-01"], st);
    expect(bars).toEqual([
      { period: "2026-10-01", commission: 4000, height: 100 },
      { period: "2026-09-01", commission: 500, height: 13 },
      { period: "2026-07-01", commission: 0, height: 0 },
    ]);
  });
  it("časové razítko v pražském čase", () => {
    const now = new Date("2026-10-22T12:00:00Z");
    expect(formatStamp("2026-10-22T12:05:00Z", now)).toBe("22. 10. 14:05");
    expect(formatStamp("2025-12-31T23:30:00Z", now)).toBe("1. 1. 00:30");
    expect(formatStamp("2025-06-01T10:00:00Z", now)).toBe("1. 6. 2025 12:00");
    expect(formatStamp(null)).toBe("");
  });
});
