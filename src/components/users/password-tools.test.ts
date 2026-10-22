import { describe, it, expect } from "vitest";
import { passwordProblem, generatePassword, passwordStrength, MIN_PASSWORD_LENGTH } from "./password-tools";
import { avatarColor, initialsFor, ROLE_STYLES } from "./user-style";

describe("passwordProblem", () => {
  it("krátké heslo", () => {
    expect(passwordProblem("abc")).toContain(String(MIN_PASSWORD_LENGTH));
  });
  it("neshoda potvrzení", () => {
    expect(passwordProblem("Silne-Heslo-1", "Silne-Heslo-2")).toBe("Hesla se neshodují.");
  });
  it("jen mezery", () => {
    expect(passwordProblem("          ")).toBe("Heslo nesmí být jen z mezer.");
  });
  it("příliš dlouhé (bajty, ne znaky)", () => {
    expect(passwordProblem("ž".repeat(40))).toContain("dlouhé");
  });
  it("v pořádku", () => {
    expect(passwordProblem("Silne-Heslo-1")).toBeNull();
    expect(passwordProblem("Silne-Heslo-1", "Silne-Heslo-1")).toBeNull();
  });
});

describe("generatePassword", () => {
  it("12 znaků, všechny třídy, bez zaměnitelných znaků", () => {
    for (let i = 0; i < 300; i++) {
      const pw = generatePassword();
      expect(pw).toHaveLength(12);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/\d/);
      expect(pw).not.toMatch(/[0O1lI]/);
      expect(pw[0]).toMatch(/[A-Za-z0-9]/);
      expect(pw[pw.length - 1]).toMatch(/[A-Za-z0-9]/);
      expect(passwordProblem(pw)).toBeNull();
    }
  });
  it("respektuje minimum délky", () => {
    expect(generatePassword(3)).toHaveLength(MIN_PASSWORD_LENGTH);
    expect(generatePassword(20)).toHaveLength(20);
  });
});

describe("passwordStrength", () => {
  it("prázdné = 0", () => {
    expect(passwordStrength("").score).toBe(0);
  });
  it("krátké je slabé", () => {
    expect(passwordStrength("Ab1!").score).toBe(1);
  });
  it("triviální je slabé", () => {
    expect(passwordStrength("aaaaaaaaaaaa").score).toBe(1);
    expect(passwordStrength("12345678").score).toBe(1);
  });
  it("silné je výborné", () => {
    expect(passwordStrength("Kafe-Lipa-4271").score).toBe(4);
  });
});

describe("user-style", () => {
  it("barva avatara je stálá", () => {
    expect(avatarColor("abc")).toBe(avatarColor("abc"));
    expect(avatarColor("abc")).toMatch(/^bg-/);
  });
  it("iniciály", () => {
    expect(initialsFor("Jan Novák", "jan@x.cz")).toBe("JN");
    expect(initialsFor("", "petr.svoboda@x.cz")).toBe("PS");
    expect(initialsFor(null, null)).toBe("?");
  });
  it("každá role má styl", () => {
    expect(Object.keys(ROLE_STYLES).sort()).toEqual(["obchodnik", "super_admin", "zamestnanec"]);
  });
});
