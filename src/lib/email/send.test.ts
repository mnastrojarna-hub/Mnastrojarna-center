import { describe, it, expect } from "vitest";
import { pickFromAddress } from "./send";

describe("adresa odesílatele", () => {
  it("vezme první platný e-mail (schránka → SMTP login → firma)", () => {
    expect(pickFromAddress(["obchod@firma.cz", "user", "info@firma.cz"])).toBe("obchod@firma.cz");
    expect(pickFromAddress([undefined, "smtp-login", "info@firma.cz"])).toBe("info@firma.cz");
    expect(pickFromAddress([null, " jan@firma.cz ", "x@y.cz"])).toBe("jan@firma.cz");
  });
  it("bez platného e-mailu nic", () => {
    expect(pickFromAddress(["test", "", undefined])).toBeUndefined();
  });
});
