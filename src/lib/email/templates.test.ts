import { describe, it, expect } from "vitest";
import { escapeHtml, passwordResetEmail, welcomeUserEmail } from "./templates";
import { COMPANY } from "@/lib/company";

describe("escapeHtml", () => {
  it("escapuje nebezpečné znaky", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;",
    );
  });
  it("zvládne null / číslo", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(15)).toBe("15");
  });
});

describe("passwordResetEmail", () => {
  const mail = passwordResetEmail({ code: "042917", name: "Jan Novák", minutes: 15 });

  it("kód je v předmětu, textu i HTML", () => {
    expect(mail.subject).toContain("042917");
    expect(mail.text).toContain("042917");
    expect(mail.html).toContain("042917");
  });
  it("oslovení křestním jménem a platnost", () => {
    expect(mail.text).toContain("Dobrý den, Jan,");
    expect(mail.text).toContain("15 minut");
    expect(mail.html).toContain("15 minut");
  });
  it("upozornění pro nevyžádaný e-mail", () => {
    expect(mail.text).toContain("ignorujte");
    expect(mail.html).toContain("ignorujte");
  });
  it("brand barvy, firma a tabulkové HTML", () => {
    expect(mail.html).toContain("#E03930");
    expect(mail.html).toContain("#272425");
    expect(mail.html).toContain("#6C6D6F");
    expect(mail.html).toContain('role="presentation"');
    expect(mail.html).toContain(escapeHtml(COMPANY.name));
    expect(mail.html).toContain("letter-spacing:12px");
  });
  it("jméno se escapuje", () => {
    const evil = passwordResetEmail({ code: "111111", name: "<img src=x onerror=alert(1)>", minutes: 15 });
    expect(evil.html).not.toContain("<img src=x");
    expect(evil.html).toContain("&lt;img");
  });
  it("bez jména obecné oslovení", () => {
    const m = passwordResetEmail({ code: "111111", minutes: 15 });
    expect(m.text.startsWith("Dobrý den,\n")).toBe(true);
  });
});

describe("welcomeUserEmail", () => {
  const mail = welcomeUserEmail({
    name: "Petra Svobodová",
    email: "petra@mnastrojarna.cz",
    loginUrl: "https://app.mnastrojarna.cz/login",
    password: "Kafe-Lipa-42",
    roleLabel: "Obchodník",
  });

  it("obsahuje přihlašovací údaje v textu i HTML", () => {
    for (const s of ["petra@mnastrojarna.cz", "Kafe-Lipa-42", "Obchodník", "https://app.mnastrojarna.cz/login"]) {
      expect(mail.text).toContain(s);
      expect(mail.html).toContain(s);
    }
  });
  it("odvodí odkaz na zapomenuté heslo", () => {
    expect(mail.text).toContain("https://app.mnastrojarna.cz/forgot-password");
    expect(mail.html).toContain("https://app.mnastrojarna.cz/forgot-password");
  });
  it("bez hesla nic nevyzradí", () => {
    const m = welcomeUserEmail({ name: "X", email: "x@y.cz", loginUrl: "https://a.cz/login" });
    expect(m.text).toContain("Heslo vám sdělí správce systému.");
    expect(m.html).toContain("sdělí vám správce systému");
    expect(m.text).not.toContain("Heslo: ");
  });
  it("escapuje heslo i odkaz, nebezpečný odkaz nahradí", () => {
    const m = welcomeUserEmail({
      name: "A",
      email: "a@b.cz",
      loginUrl: "javascript:alert(1)",
      password: `<b>"x"</b>`,
    });
    expect(m.html).not.toContain("<b>\"x\"</b>");
    expect(m.html).toContain("&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
    expect(m.html).not.toContain('href="javascript:');
  });
});
