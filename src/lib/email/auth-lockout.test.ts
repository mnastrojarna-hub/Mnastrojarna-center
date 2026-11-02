import { describe, it, expect } from "vitest";
import {
  AUTH_LOCK_MS, LOCKOUT_TEXT, authLockOf, isLikelyHostLockout, isPresetHost, recordAuthFailure, recordHostLockout, retryClock,
} from "./auth-lockout";

const T0 = Date.parse("2026-11-02T10:00:00Z");

describe("blokace přihlášení po odmítnutém hesle", () => {
  it("odmítnuté heslo → 60 min blokováno se stejnými údaji, s důvodem a časem dalšího pokusu", () => {
    const st = recordAuthFailure(null, "fp1", "test", T0);
    expect(st.auth_fail_count).toBe(1);
    const lock = authLockOf(st, "fp1", T0 + 5 * 60_000);
    expect(lock.blocked).toBe(true);
    expect(lock.until).toBe(new Date(T0 + AUTH_LOCK_MS).toISOString());
    expect(lock.reason).toMatch(/Heslo bylo odmítnuto/);
    expect(lock.reason).toContain(retryClock(lock.until!));
    expect(lock.reason).toMatch(/Změň heslo/);
  });

  it("po 60 min nebo po změně hesla / uživatele (jiný otisk) zase smí", () => {
    const st = recordAuthFailure(null, "fp1", "sync", T0);
    expect(authLockOf(st, "fp1", T0 + AUTH_LOCK_MS).blocked).toBe(false);
    expect(authLockOf(st, "fp2", T0 + 60_000).blocked).toBe(false);
    expect(authLockOf(null, "fp1", T0).blocked).toBe(false);
    expect(authLockOf({ auth_fail_at: null, auth_fail_fp: "fp1" }, "fp1", T0).blocked).toBe(false);
  });

  it("počítá odmítnutí za poslední hodinu (starší se nepočítá)", () => {
    const a = recordAuthFailure(null, "fp", "test", T0);
    const b = recordAuthFailure(a, "fp", "smtp", T0 + 10 * 60_000);
    expect(b.auth_fail_count).toBe(2);
    const c = recordAuthFailure(b, "fp", "sync", T0 + 3 * 60 * 60_000);
    expect(c.auth_fail_count).toBe(1);
    expect(c.auth_fail_where).toBe("sync");
  });

  it("blokace po vysvětleném časovém limitu ukazuje text o blokaci hostingu", () => {
    const st = recordHostLockout(recordAuthFailure(null, "fp", "test", T0), "fp", T0 + 60_000);
    const lock = authLockOf(st, "fp", T0 + 2 * 60_000);
    expect(lock.blocked).toBe(true);
    expect(lock.reason).toContain(LOCKOUT_TEXT);
  });
});

describe("časový limit po odmítnutém hesle = dočasná blokace u hostingu", () => {
  const afterAuth = recordAuthFailure(null, "fp", "test", T0);

  it("hosting90 (předvolba) krátce po odmítnutí → ano; jiný druh chyby ne", () => {
    expect(isLikelyHostLockout("timeout", "mail.hosting90.cz", afterAuth, [], T0 + 70 * 60_000)).toBe(true);
    expect(isLikelyHostLockout("greeting", "smtp.hosting90.cz", afterAuth, [], T0 + 5 * 60_000)).toBe(true);
    expect(isLikelyHostLockout("dns", "mail.hosting90.cz", afterAuth, [], T0 + 60_000)).toBe(false);
    expect(isLikelyHostLockout("tls_hostname", "mail.hosting90.cz", afterAuth, [], T0 + 60_000)).toBe(false);
    expect(isLikelyHostLockout("refused", "mail.hosting90.cz", afterAuth, [], T0 + 60_000)).toBe(false);
  });

  it("neznámý server jen když na něm jiná schránka nedávno fungovala", () => {
    expect(isLikelyHostLockout("timeout", "mail.firma.test", afterAuth, [], T0 + 60_000)).toBe(false);
    expect(isLikelyHostLockout("timeout", "mail.firma.test", afterAuth, ["MAIL.firma.test"], T0 + 60_000)).toBe(true);
  });

  it("bez odmítnutí, nebo dávno po něm → obyčejná hláška o serveru / portu", () => {
    expect(isLikelyHostLockout("timeout", "mail.hosting90.cz", null, [], T0)).toBe(false);
    expect(isLikelyHostLockout("timeout", "mail.hosting90.cz", afterAuth, [], T0 + 4 * 60 * 60_000)).toBe(false);
  });

  it("dvě odmítnutí za hodinu stačí i bez „poslední chyba = heslo“", () => {
    const two = recordAuthFailure(afterAuth, "fp", "smtp", T0 + 10 * 60_000);
    expect(isLikelyHostLockout("timeout", "mail.hosting90.cz", two, [], T0 + 30 * 60_000)).toBe(true);
  });

  it("předvolby: hosting90, Gmail; vlastní doména ne", () => {
    expect(isPresetHost("mail.hosting90.cz")).toBe(true);
    expect(isPresetHost("SMTP.hosting90.cz.")).toBe(true);
    expect(isPresetHost("imap.gmail.com")).toBe(true);
    expect(isPresetHost("mail.nastrojarstvi.com")).toBe(false);
  });

  it("text hlášky je přesně podle zadání", () => {
    expect(LOCKOUT_TEXT).toBe("Hosting pravděpodobně dočasně zablokoval přihlášení po chybných heslech. Ověř heslo ve webmailu (u hosting90 webmail.hosting90.cz) a zkus to znovu asi za hodinu.");
  });
});
