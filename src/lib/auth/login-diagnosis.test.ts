import { describe, expect, it } from "vitest";
import {
  INACTIVE,
  describeInvalidCredentials,
  isInvalidCredentials,
  loginError,
  loginRedirectUrl,
  prefillEmail,
  safeNextPath,
} from "@/lib/auth/login-diagnosis";

const VIT = "vit.volny@mnastrojarna.cz";

describe("přihlášení — srozumitelný důvod chyby", () => {
  it("bez možnosti dohledat účet zůstane obecná hláška", () => {
    expect(describeInvalidCredentials(VIT, null)).toBe("Nesprávný e-mail nebo heslo.");
  });

  it("neexistující účet: řekne to i s e-mailem, který se zkoušel", () => {
    const msg = describeInvalidCredentials(VIT, { exists: false, active: false, initialPassword: false });
    expect(msg).toContain(VIT);
    expect(msg).toMatch(/v systému není/);
  });

  it("neaktivní účet", () => {
    expect(describeInvalidCredentials(VIT, { exists: true, active: false, initialPassword: true })).toBe(INACTIVE);
  });

  it("počáteční heslo: poradí super adminovi Nastavit heslo", () => {
    const msg = describeInvalidCredentials(VIT, { exists: true, active: true, initialPassword: true });
    expect(msg).toContain(`Nesprávné heslo k účtu ${VIT}`);
    expect(msg).toMatch(/Nastavit heslo/);
  });

  it("vlastní heslo: odkáže na Zapomenuté heslo", () => {
    const msg = describeInvalidCredentials(VIT, { exists: true, active: true, initialPassword: false });
    expect(msg).toMatch(/Zapomenuté heslo/);
  });

  it("chyby Supabase Auth česky, včetně rozbitého účtu v databázi", () => {
    expect(isInvalidCredentials("Invalid login credentials")).toBe(true);
    expect(isInvalidCredentials("Email not confirmed")).toBe(false);
    expect(loginError("Database error querying schema")).toMatch(/databázi účtů/);
    expect(loginError("Request rate limit reached")).toMatch(/Příliš mnoho pokusů/);
  });
});

describe("přihlašovací formulář si drží odeslaný e-mail", () => {
  it("redirect nese chybu i e-mail", () => {
    const url = new URL(loginRedirectUrl("Nesprávné heslo.", VIT), "http://x");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("error")).toBe("Nesprávné heslo.");
    expect(url.searchParams.get("email")).toBe(VIT);
  });

  it("bez e-mailu jen chyba", () => {
    expect(loginRedirectUrl("Vyplň e-mail a heslo.", "")).toBe(`/login?error=${encodeURIComponent("Vyplň e-mail a heslo.").replace(/%20/g, "+")}`);
  });

  it("předvyplní jen rozumnou adresu", () => {
    expect(prefillEmail(VIT)).toBe(VIT);
    expect(prefillEmail([VIT, "x@y.cz"])).toBe(VIT);
    expect(prefillEmail("  a@b.cz ")).toBe("a@b.cz");
    expect(prefillEmail("<script>@x")).toBe("");
    expect(prefillEmail("bez-zavinace")).toBe("");
    expect(prefillEmail(undefined)).toBe("");
    expect(prefillEmail(`${"a".repeat(250)}@b.cz`)).toBe("");
  });
});

describe("#25 návrat po přihlášení (?next=)", () => {
  it("pustí jen cestu v aplikaci, i s parametry", () => {
    expect(safeNextPath("/orders/abc?tab=nabidky")).toBe("/orders/abc?tab=nabidky");
    expect(safeNextPath(["/quotes#ke-schvaleni"])).toBe("/quotes#ke-schvaleni");
    expect(safeNextPath("/orders/x/../y")).toBe("/orders/y");
  });
  it("odmítne cizí host, schéma, zpětné lomítko, řídicí znaky a přihlašovací stránky", () => {
    for (const bad of [
      "", null, undefined, "https://evil.example/x", "//evil.example", "/\\evil.example", "/x\\y", "javascript:alert(1)",
      "/orders\n", "/login", "/login?next=/x", "/auth/callback", "/api/pdf/job/1", "/reset-password", "a/b", "/" + "x".repeat(2100),
    ]) expect(safeNextPath(bad as string)).toBeNull();
  });
  it("odmítne cestu, ze které se normalizací stane protokolově relativní adresa („//host“)", () => {
    for (const bad of ["/.//evil.example", "/..//evil.example", "/%2e//evil.example", "/.//evil.example/a?x=1", "/./..//evil.example"]) {
      expect(safeNextPath(bad), bad).toBeNull();
    }
    expect(safeNextPath("/./orders/1")).toBe("/orders/1");
  });
  it("chybová adresa /login nese next dál", () => {
    const url = new URL(loginRedirectUrl("Nesprávné heslo.", VIT, "/orders/1?tab=nabidky"), "http://x");
    expect(url.searchParams.get("next")).toBe("/orders/1?tab=nabidky");
    expect(new URL(loginRedirectUrl("x", VIT, "//evil"), "http://x").searchParams.has("next")).toBe(false);
  });
});
