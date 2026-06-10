import { describe, it, expect } from "vitest";
import { formatCZK, relativeTime, formatDate } from "./utils";

describe("formatCZK", () => {
  it("formátuje koruny bez desetinných míst", () => {
    //   = nezlomitelná mezera v cs-CZ formátu
    expect(formatCZK(184000).replace(/[\s ]/g, " ")).toBe("184 000 Kč");
  });
  it("zvládne nulu", () => {
    expect(formatCZK(0)).toContain("0");
    expect(formatCZK(0)).toContain("Kč");
  });
});

describe("relativeTime", () => {
  it("vrací „teď' pro čerstvý čas", () => {
    expect(relativeTime(new Date())).toBe("teď");
  });
  it("minuty", () => {
    expect(relativeTime(new Date(Date.now() - 5 * 60000))).toBe("před 5 min");
  });
  it("hodiny", () => {
    expect(relativeTime(new Date(Date.now() - 3 * 3600000))).toBe("před 3 h");
  });
  it("dny", () => {
    expect(relativeTime(new Date(Date.now() - 2 * 86400000))).toBe("před 2 d");
  });
  it("starší než měsíc → datum", () => {
    const old = new Date(Date.now() - 60 * 86400000);
    expect(relativeTime(old)).toBe(formatDate(old));
  });
});
