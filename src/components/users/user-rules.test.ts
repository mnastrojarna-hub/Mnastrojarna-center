import { describe, it, expect } from "vitest";
import {
  userChangeProblem, deleteUserProblem, parseCommissionPercent, commissionToPercent,
  cleanText, cleanPhone, isUserRole,
} from "./user-rules";

const admin = { id: "a", role: "super_admin" as const, active: true };
const sales = { id: "s", role: "obchodnik" as const, active: true };

describe("userChangeProblem", () => {
  it("sám sobě nelze odebrat super admina", () => {
    expect(userChangeProblem({ actorId: "a", target: admin, change: { role: "obchodnik" }, activeSuperAdmins: 3 }))
      .toContain("Sám sobě");
  });
  it("sám sebe nelze deaktivovat", () => {
    expect(userChangeProblem({ actorId: "s", target: sales, change: { active: false }, activeSuperAdmins: 1 }))
      .toContain("deaktivovat");
  });
  it("poslední aktivní super admin", () => {
    expect(userChangeProblem({ actorId: "x", target: admin, change: { active: false }, activeSuperAdmins: 1 }))
      .toContain("poslední");
    expect(userChangeProblem({ actorId: "x", target: admin, change: { role: "zamestnanec" }, activeSuperAdmins: 1 }))
      .toContain("poslední");
  });
  it("povolené změny", () => {
    expect(userChangeProblem({ actorId: "x", target: admin, change: { active: false }, activeSuperAdmins: 2 })).toBeNull();
    expect(userChangeProblem({ actorId: "a", target: admin, change: { role: "super_admin" }, activeSuperAdmins: 1 })).toBeNull();
    expect(userChangeProblem({ actorId: "a", target: sales, change: { role: "super_admin" }, activeSuperAdmins: 1 })).toBeNull();
    expect(userChangeProblem({ actorId: "a", target: admin, change: { active: true }, activeSuperAdmins: 1 })).toBeNull();
    // neaktivní super admin není „poslední aktivní"
    expect(
      userChangeProblem({ actorId: "x", target: { ...admin, active: false }, change: { role: "obchodnik" }, activeSuperAdmins: 1 }),
    ).toBeNull();
  });
});

describe("deleteUserProblem", () => {
  it("nelze smazat sebe ani posledního super admina", () => {
    expect(deleteUserProblem({ actorId: "a", target: admin, activeSuperAdmins: 5 })).toContain("Sám sebe");
    expect(deleteUserProblem({ actorId: "x", target: admin, activeSuperAdmins: 1 })).toContain("poslední");
    expect(deleteUserProblem({ actorId: "x", target: sales, activeSuperAdmins: 1 })).toBeNull();
  });
});

describe("provize", () => {
  it("procenta → zlomek", () => {
    expect(parseCommissionPercent("8")).toEqual({ rate: 0.08 });
    expect(parseCommissionPercent("8,5")).toEqual({ rate: 0.085 });
    expect(parseCommissionPercent(12.25)).toEqual({ rate: 0.1225 });
    expect(parseCommissionPercent("")).toEqual({ rate: 0 });
    expect(parseCommissionPercent(undefined)).toEqual({ rate: 0 });
  });
  it("neplatné hodnoty", () => {
    expect(parseCommissionPercent("-1")).toHaveProperty("error");
    expect(parseCommissionPercent("101")).toHaveProperty("error");
    expect(parseCommissionPercent("abc")).toHaveProperty("error");
  });
  it("zlomek → procenta", () => {
    expect(commissionToPercent(0.085)).toBe(8.5);
    expect(commissionToPercent(null)).toBe(0);
  });
});

describe("texty", () => {
  it("cleanText", () => {
    expect(cleanText("  Jan   Novák ", "Jméno", 120)).toEqual({ value: "Jan Novák" });
    expect(cleanText("", "Jméno", 120)).toEqual({ value: null });
    expect(cleanText("x".repeat(5), "Funkce", 4).error).toContain("Funkce");
  });
  it("cleanPhone", () => {
    expect(cleanPhone("+420 777 123 456")).toEqual({ value: "+420 777 123 456" });
    expect(cleanPhone("777-abc").error).toBeTruthy();
  });
  it("isUserRole", () => {
    expect(isUserRole("obchodnik")).toBe(true);
    expect(isUserRole("admin")).toBe(false);
  });
});
