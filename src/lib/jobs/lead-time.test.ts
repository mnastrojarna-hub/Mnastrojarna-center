import { describe, it, expect } from "vitest";
import {
  addLeadTime, addWorkingDays, czDate, czechHolidays, easterSunday, isRealisticDueDate, isWorkingDay, leadText, parseLeadTime,
  pragueToday,
} from "./lead-time";

type Want = { days: number; unit?: "kalendarni" | "pracovni"; from?: "objednavka" | "potvrzeni" | "podklady" | null; range?: [number, number]; months?: number };

const CASES: [string, Want | null][] = [
  // česky
  ["4 týdny", { days: 28, unit: "kalendarni", from: null }],
  ["Dodací lhůta: 4 týdny", { days: 28 }],
  ["do 4 týdnů od objednání", { days: 28, from: "objednavka" }],
  ["dodání do 6 týdnů od obdržení objednávky", { days: 42, from: "objednavka" }],
  ["6–8 týdnů", { days: 56, range: [42, 56] }],
  ["6-8 týdnů od objednávky", { days: 56, range: [42, 56], from: "objednavka" }],
  ["6 až 8 týdnů", { days: 56, range: [42, 56] }],
  ["30 dnů", { days: 30, unit: "kalendarni" }],
  ["30 dní od objednávky", { days: 30, from: "objednavka" }],
  ["30 kalendářních dnů", { days: 30, unit: "kalendarni" }],
  ["30 pracovních dnů", { days: 30, unit: "pracovni" }],
  ["20 prac. dnů od potvrzení", { days: 20, unit: "pracovni", from: "potvrzeni" }],
  ["dodací lhůta 5 týdnů od potvrzení objednávky", { days: 35, from: "potvrzeni" }],
  ["Termín dodání: 3 měsíce", { days: 90, months: 3 }],
  ["2–3 měsíce od objednání", { days: 90, months: 3, range: [60, 90], from: "objednavka" }],
  ["čtyři týdny od objednání", { days: 28, from: "objednavka" }],
  ["cca 5 tydnu", { days: 35 }],
  ["8 týdnů od dodání výkresů a schválení", { days: 56, from: "podklady" }],
  ["Platnost nabídky 30 dní, dodací lhůta 4 týdny", { days: 28 }],
  ["Splatnost 14 dní. Dodání 10 pracovních dní od objednávky.", { days: 10, unit: "pracovni", from: "objednavka" }],
  ["ihned", { days: 3, unit: "pracovni", range: [0, 3] }],
  ["skladem", { days: 3, unit: "pracovni", range: [0, 3] }],
  ["dle dohody", null],
  ["Termín po dohodě", null],
  ["", null],
  ["Cena platí do 31. 12. 2026", null],
  // německy
  ["Lieferzeit 4 Wochen", { days: 28 }],
  ["Lieferzeit: 4-6 Wochen nach Auftragseingang", { days: 42, range: [28, 42], from: "objednavka" }],
  ["10 Arbeitstage nach Auftragsbestätigung", { days: 10, unit: "pracovni", from: "potvrzeni" }],
  ["Lieferung ab Lager", { days: 3, unit: "pracovni", range: [0, 3] }],
  ["Liefertermin nach Vereinbarung", null],
  ["3 Monate", { days: 90, months: 3 }],
  ["Zahlungsziel 30 Tage, Lieferzeit 3 Wochen", { days: 21 }],
  // anglicky
  ["4 weeks ARO", { days: 28, from: "objednavka" }],
  ["Delivery: 6-8 weeks after receipt of order", { days: 56, range: [42, 56], from: "objednavka" }],
  ["20 working days", { days: 20, unit: "pracovni" }],
  ["15 business days from order confirmation", { days: 15, unit: "pracovni", from: "potvrzeni" }],
  ["Payment 30 days net, lead time 2 weeks", { days: 14 }],
  ["2 months", { days: 60, months: 2 }],
  ["from stock", { days: 3, unit: "pracovni", range: [0, 3] }],
  ["to be agreed", null],
  ["30d", { days: 30 }],
  ["Platnost nabídky: 30 dní", null],
  ["Zahlungsziel: 30 Tage", null],
];

describe("parseLeadTime — reálné formulace", () => {
  it(`pokrývá ${CASES.length} formulací`, () => {
    expect(CASES.length).toBeGreaterThanOrEqual(30);
  });
  for (const [text, want] of CASES) {
    it(`„${text}"`, () => {
      const r = parseLeadTime(text);
      if (want === null) {
        expect(r).toBeNull();
        return;
      }
      expect(r).not.toBeNull();
      expect(r!.days).toBe(want.days);
      if (want.unit) expect(r!.unit).toBe(want.unit);
      if (want.from !== undefined) expect(r!.from).toBe(want.from);
      if (want.range) expect(r!.range).toEqual(want.range);
      if (want.months) expect(r!.months).toBe(want.months);
      expect(r!.text.length).toBeGreaterThan(0);
    });
  }
  it("text = nalezený úsek", () => {
    expect(parseLeadTime("Dodací lhůta: do 4 týdnů od objednání, platnost 30 dní")?.text).toBe("4 týdnů od objednání");
  });
});

describe("svátky a pracovní dny", () => {
  it("Velikonoce", () => {
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    expect(easterSunday(2038)).toBe("2038-04-25");
    const h = czechHolidays(2026);
    expect(h.has("2026-04-03")).toBe(true); // Velký pátek
    expect(h.has("2026-04-06")).toBe(true); // Velikonoční pondělí
    expect(h.has("2026-11-17")).toBe(true);
    expect(h.size).toBe(13);
  });
  it("víkend a svátek nejsou pracovní dny", () => {
    expect(isWorkingDay("2026-10-24")).toBe(false); // sobota
    expect(isWorkingDay("2026-10-28")).toBe(false); // středa, svátek
    expect(isWorkingDay("2026-10-27")).toBe(true);
  });
  it("pracovní dny přes víkend a 28. 10.", () => {
    // pá 23. 10. + 3 prac. dny: po 26, út 27, (st 28 svátek) čt 29
    expect(addWorkingDays("2026-10-23", 3)).toBe("2026-10-29");
  });
  it("pracovní dny přes Velikonoce", () => {
    // čt 2. 4. 2026 + 2: (pá 3. 4. Velký pátek, so, ne, po 6. 4. pondělí) út 7. 4., st 8. 4.
    expect(addWorkingDays("2026-04-02", 2)).toBe("2026-04-08");
  });
  it("pracovní dny přes Vánoce a přelom roku", () => {
    // st 23. 12. 2026 + 3: (24–26 svátky, 27 ne) po 28., út 29., st 30.
    expect(addWorkingDays("2026-12-23", 3)).toBe("2026-12-30");
    // st 30. 12. 2026 + 2: čt 31., (1. 1. svátek, so, ne) po 4. 1. 2027
    expect(addWorkingDays("2026-12-30", 2)).toBe("2027-01-04");
  });
  it("0 pracovních dnů = nejbližší pracovní den", () => {
    expect(addWorkingDays("2026-10-24", 0)).toBe("2026-10-26");
    expect(addWorkingDays("2026-10-23", 0)).toBe("2026-10-23");
  });
});

describe("addLeadTime", () => {
  it("kalendářní dny, týdny, měsíce", () => {
    expect(addLeadTime("2026-10-23", parseLeadTime("4 týdny od objednání")!)).toBe("2026-11-20");
    expect(addLeadTime("2026-12-20", { days: 30, unit: "kalendarni" })).toBe("2027-01-19");
    expect(addLeadTime("2026-11-30", parseLeadTime("3 měsíce")!)).toBe("2027-02-28");
    expect(addLeadTime("2028-01-31", { days: 30, unit: "kalendarni", months: 1 })).toBe("2028-02-29");
  });
  it("pracovní dny", () => {
    expect(addLeadTime("2026-10-23", parseLeadTime("10 pracovních dnů")!)).toBe("2026-11-09");
  });
  it("neplatné datum → prázdné", () => {
    expect(addLeadTime("", { days: 5, unit: "kalendarni" })).toBe("");
  });
  it("popisky", () => {
    expect(leadText(parseLeadTime("4 weeks ARO")!)).toBe("4 týdny od objednání");
    expect(leadText(parseLeadTime("6–8 týdnů")!)).toBe("6–8 týdnů od objednání");
    expect(leadText(parseLeadTime("30 pracovních dnů od potvrzení")!)).toBe("30 pracovních dnů od potvrzení objednávky");
    expect(leadText(parseLeadTime("1 měsíc")!)).toBe("1 měsíc od objednání");
    expect(czDate("2026-11-20")).toBe("20. 11. 2026");
  });
});

describe("isRealisticDueDate", () => {
  const TODAY = "2026-10-23";
  it("prázdné / neplatné → ne", () => {
    expect(isRealisticDueDate("", "2026-10-20", TODAY)).toBe(false);
    expect(isRealisticDueDate(null, null, TODAY)).toBe(false);
    expect(isRealisticDueDate("2026-02-30", null, TODAY)).toBe(false);
  });
  it("stejný den jako objednávka → ne; den po → ano", () => {
    expect(isRealisticDueDate("2026-10-23", "2026-10-23", TODAY)).toBe(false);
    expect(isRealisticDueDate("2026-10-24", "2026-10-23", TODAY)).toBe(true);
  });
  it("před datem objednávky → ne", () => {
    expect(isRealisticDueDate("2026-11-01", "2026-11-05", TODAY)).toBe(false);
  });
  it("v minulosti vůči dnešku → ne; dnes → ano (bez data objednávky)", () => {
    expect(isRealisticDueDate("2026-10-22", "2026-10-01", TODAY)).toBe(false);
    expect(isRealisticDueDate("2026-10-23", null, TODAY)).toBe(true);
  });
  it("3 roky a víc dopředu → ne", () => {
    expect(isRealisticDueDate("2029-10-22", null, TODAY)).toBe(true);
    expect(isRealisticDueDate("2029-10-23", null, TODAY)).toBe(false);
    expect(isRealisticDueDate("2099-01-01", "2026-10-20", TODAY)).toBe(false);
  });
  it("pragueToday je RRRR-MM-DD v Praze", () => {
    expect(pragueToday(new Date("2026-10-23T22:30:00Z"))).toBe("2026-10-24");
    expect(pragueToday(new Date("2026-10-23T21:30:00Z"))).toBe("2026-10-23");
  });
});
