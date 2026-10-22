import { describe, it, expect } from "vitest";
import {
  generateResetCode, hashResetCode, verifyResetCode, normalizeResetCode, isResetCodeFormat,
  normalizeEmail, isPlausibleEmail, resetCodeExpiry, resetWindowStart, remainingAttempts,
  attemptsLabel, safeNextPath, originFrom, dailyWindowStart, dailyAttemptsExceeded,
  RESET_CODE_TTL_MIN, RESET_MAX_ATTEMPTS, RESET_MAX_REQUESTS, RESET_MAX_DAILY_ATTEMPTS,
} from "./reset-code";

const SECRET = "sb_secret_test";
const USER = "8f0c3c1e-1111-4222-8333-944455556666";

describe("generateResetCode", () => {
  it("vrací vždy 6 číslic", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateResetCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });
  it("kódy se liší (náhoda)", () => {
    const set = new Set(Array.from({ length: 200 }, () => generateResetCode()));
    expect(set.size).toBeGreaterThan(190);
  });
});

describe("hashResetCode / verifyResetCode", () => {
  it("hash je sha256 hex a neobsahuje kód", () => {
    const h = hashResetCode(USER, "012345", SECRET);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("012345");
  });
  it("správný kód projde", () => {
    const h = hashResetCode(USER, "012345", SECRET);
    expect(verifyResetCode(h, USER, "012345", SECRET)).toBe(true);
  });
  it("špatný kód, jiný uživatel nebo jiný secret neprojde", () => {
    const h = hashResetCode(USER, "012345", SECRET);
    expect(verifyResetCode(h, USER, "012346", SECRET)).toBe(false);
    expect(verifyResetCode(h, "jiny-uzivatel", "012345", SECRET)).toBe(false);
    expect(verifyResetCode(h, USER, "012345", "jiny-secret")).toBe(false);
  });
  it("nesmyslný hash neshodí porovnání", () => {
    expect(verifyResetCode("", USER, "012345", SECRET)).toBe(false);
    expect(verifyResetCode("zz", USER, "012345", SECRET)).toBe(false);
    expect(verifyResetCode("abcd", USER, "012345", SECRET)).toBe(false);
  });
});

describe("formát kódu a e-mailu", () => {
  it("normalizace kódu nechá jen číslice", () => {
    expect(normalizeResetCode(" 123 456 ")).toBe("123456");
    expect(normalizeResetCode("12-34-56")).toBe("123456");
    expect(normalizeResetCode(null)).toBe("");
  });
  it("vlastní kód = 6 číslic, OTP 6–10", () => {
    expect(isResetCodeFormat("123456")).toBe(true);
    expect(isResetCodeFormat("12345")).toBe(false);
    expect(isResetCodeFormat("1234567")).toBe(false);
    expect(isResetCodeFormat("12345678", "otp")).toBe(true);
    expect(isResetCodeFormat("12345", "otp")).toBe(false);
  });
  it("e-mail se normalizuje a validuje", () => {
    expect(normalizeEmail("  Jan.Novak@Firma.CZ ")).toBe("jan.novak@firma.cz");
    expect(isPlausibleEmail("jan@firma.cz")).toBe(true);
    expect(isPlausibleEmail("jan@firma")).toBe(false);
    expect(isPlausibleEmail("jan firma@x.cz")).toBe(false);
  });
});

describe("časová okna a pokusy", () => {
  it("expirace a okno limitu odpovídají TTL", () => {
    const now = new Date("2026-10-22T10:00:00Z");
    expect(resetCodeExpiry(now).getTime() - now.getTime()).toBe(RESET_CODE_TTL_MIN * 60_000);
    expect(now.getTime() - resetWindowStart(now).getTime()).toBe(RESET_CODE_TTL_MIN * 60_000);
  });
  it("konstanty dle zadání", () => {
    expect(RESET_CODE_TTL_MIN).toBe(15);
    expect(RESET_MAX_ATTEMPTS).toBe(5);
    expect(RESET_MAX_REQUESTS).toBe(3);
  });
  it("denní strop pokusů přes všechny kódy", () => {
    const now = new Date("2026-10-22T10:00:00Z");
    expect(now.getTime() - dailyWindowStart(now).getTime()).toBe(86_400_000);
    expect(dailyAttemptsExceeded([])).toBe(false);
    expect(dailyAttemptsExceeded([{ attempts: 5 }, { attempts: 5 }, { attempts: 5 }])).toBe(false);
    expect(dailyAttemptsExceeded(Array.from({ length: 4 }, () => ({ attempts: 5 })))).toBe(true);
    expect(RESET_MAX_DAILY_ATTEMPTS).toBe(20);
  });
  it("zbývající pokusy a skloňování", () => {
    expect(remainingAttempts(0)).toBe(5);
    expect(remainingAttempts(4)).toBe(1);
    expect(remainingAttempts(9)).toBe(0);
    expect(attemptsLabel(1)).toBe("Zbývá 1 pokus");
    expect(attemptsLabel(3)).toBe("Zbývají 3 pokusy");
    expect(attemptsLabel(0)).toBe("Zbývá 0 pokusů");
  });
});

describe("safeNextPath", () => {
  it("povolí relativní cesty", () => {
    expect(safeNextPath("/reset-password")).toBe("/reset-password");
    expect(safeNextPath("/orders?stav=poptavka#x")).toBe("/orders?stav=poptavka#x");
  });
  it("zablokuje open redirect", () => {
    expect(safeNextPath("//evil.cz")).toBe("/orders");
    expect(safeNextPath("/\\evil.cz")).toBe("/orders");
    expect(safeNextPath("https://evil.cz")).toBe("/orders");
    expect(safeNextPath("evil.cz")).toBe("/orders");
    expect(safeNextPath("/ok\nLocation: x")).toBe("/orders");
    expect(safeNextPath("/%2F%2Fevil.cz")).toBe("/%2F%2Fevil.cz");
  });
  it("prázdná hodnota → fallback", () => {
    expect(safeNextPath(null, "/reset-password")).toBe("/reset-password");
    expect(safeNextPath("", "/x")).toBe("/x");
  });
});

describe("originFrom", () => {
  it("z hlaviček proxy", () => {
    expect(originFrom({ proto: "https", host: "app.mnastrojarna.cz" })).toBe("https://app.mnastrojarna.cz");
    expect(originFrom({ proto: "https,http", host: "a.vercel.app, b" })).toBe("https://a.vercel.app");
  });
  it("localhost bez proto → http", () => {
    expect(originFrom({ host: "localhost:3000" })).toBe("http://localhost:3000");
  });
  it("podezřelý host → fallback", () => {
    expect(originFrom({ host: "evil.cz/path", fallback: "https://app.cz/" })).toBe("https://app.cz");
    expect(originFrom({})).toBe("http://localhost:3000");
  });
});
