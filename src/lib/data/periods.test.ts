import { describe, it, expect } from "vitest";
import { periodStart } from "./periods";

describe("periodStart", () => {
  const now = new Date(2026, 5, 10); // 10. 6. 2026 (červen = Q2)

  it("měsíc → první den aktuálního měsíce", () => {
    expect(periodStart("month", now)).toBe("2026-06-01");
  });
  it("kvartál → první den kvartálu", () => {
    expect(periodStart("quarter", now)).toBe("2026-04-01");
    expect(periodStart("quarter", new Date(2026, 0, 15))).toBe("2026-01-01");
    expect(periodStart("quarter", new Date(2026, 11, 31))).toBe("2026-10-01");
  });
  it("rok → 1. leden", () => {
    expect(periodStart("year", now)).toBe("2026-01-01");
  });
  it("doplní nulu u jednociferných měsíců", () => {
    expect(periodStart("month", new Date(2026, 2, 5))).toBe("2026-03-01");
  });
});
