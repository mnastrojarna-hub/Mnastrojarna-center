import { describe, it, expect } from "vitest";
import { pickFromAddress, pickSmtpMailbox } from "./send";

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

describe("ze které schránky odeslat", () => {
  const smtp = { imap_host: "mail.hosting90.cz", imap_password: "x", smtp_host: "smtp.hosting90.cz", smtp_port: 465 };
  const rows = [
    // nejstarší: cizí schránka s SMTP (dřív ji vzal rows[0])
    { id: "jana", email: "jana@firma.cz", owner_id: "u-jana", active: true, config: smtp },
    { id: "petr", email: "petr@firma.cz", owner_id: "u-petr", active: true, config: { imap_host: "mail.hosting90.cz", imap_password: "x" } },
    { id: "vypnuta", email: "eva@firma.cz", owner_id: "u-eva", active: false, config: smtp },
    { id: "firma", email: "info@firma.cz", owner_id: null, active: true, config: smtp },
  ];

  it("schránka uživatele bez SMTP → neodeslat (ne pod adresou kolegy ani firmy)", () => {
    const r = pickSmtpMailbox(rows, { ownerId: "u-petr" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^Tvoje schránka nemá nastavené odesílání — doplň odchozí server \(SMTP\) v Nastavení/);
  });

  it("vypnutá schránka uživatele → neodeslat", () => {
    const r = pickSmtpMailbox(rows, { ownerId: "u-eva" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/vypnutá/);
  });

  it("uživatel bez schránky → neodeslat, požádat admina", () => {
    const r = pickSmtpMailbox(rows, { ownerId: "u-nikdo" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Nemáš přiřazenou e-mailovou schránku/);
  });

  it("zadaná schránka bez SMTP / vypnutá / neexistující → neodeslat", () => {
    for (const id of ["petr", "vypnuta", "smazana"]) {
      const r = pickSmtpMailbox(rows, { mailboxId: id });
      expect(r.ok, id).toBe(false);
    }
  });

  it("vlastní schránka s SMTP → ta", () => {
    expect(pickSmtpMailbox(rows, { ownerId: "u-jana" })).toEqual({ ok: true, box: rows[0] });
    expect(pickSmtpMailbox(rows, { mailboxId: "firma" })).toEqual({ ok: true, box: rows[3] });
  });

  it("systémový e-mail → firemní schránka (bez vlastníka), nikdy cizí; bez ní globální SMTP", () => {
    expect(pickSmtpMailbox(rows, { system: true })).toEqual({ ok: true, box: rows[3] });
    expect(pickSmtpMailbox(rows.slice(0, 3), { system: true })).toEqual({ ok: true, box: null });
  });
});
