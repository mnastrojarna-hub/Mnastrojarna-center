import { describe, it, expect } from "vitest";
import { decideSender, senderOptions } from "./sender-rules";
import { pickSmtpMailbox, type SendBoxRow } from "./send";
import type { MailboxConfig } from "@/lib/supabase/database.types";

/**
 * Pravidlo majitele 9. 11.: „Když cokoliv odesílá ze systému Šponer, jde to ze Šponerova mailu. Když cokoliv
 * posílá Volný, jde to z Volného mailu. Jediný já si to můžu vybrat jakožto super admin."
 */
describe("odkud odchází e-mail uživatele (sender-rules)", () => {
  const smtp: MailboxConfig = { imap_host: "mail.hosting90.cz", imap_password: "x", smtp_host: "smtp.hosting90.cz", smtp_port: 465 };
  const rows: SendBoxRow[] = [
    { id: "box-volny", email: "volny@firma.cz", owner_id: "u-volny", active: true, config: smtp },
    { id: "box-sponer", email: "sponer@firma.cz", owner_id: "u-sponer", active: true, config: smtp },
    { id: "box-admin", email: "majitel@firma.cz", owner_id: "u-admin", active: true, config: smtp },
    { id: "box-firma", email: "info@firma.cz", owner_id: null, active: true, config: smtp },
    { id: "box-bez-smtp", email: "eva@firma.cz", owner_id: "u-eva", active: true, config: { imap_host: "mail.hosting90.cz", imap_password: "x" } },
    { id: "box-vypnuta", email: "petr@firma.cz", owner_id: "u-petr", active: false, config: smtp },
  ];
  const sponer = { id: "u-sponer", superAdmin: false };
  const admin = { id: "u-admin", superAdmin: true };

  it("Šponer posílá → vždy ze Šponerovy schránky, i když klient požádá o Volného (nejde obejít)", () => {
    const d = decideSender(sponer, rows, { mailboxId: "box-volny" });
    expect(d).toEqual({ from: { ownerId: "u-sponer" }, signerId: "u-sponer", chosenMailboxId: null });
    expect(pickSmtpMailbox(rows, d.from)).toEqual({ ok: true, box: rows[1] });
  });

  it("plný přístup (Volný, Šponer) NENÍ super admin — vybírat schránku nesmí", () => {
    // resolveSender čte skutečnou roli z DB (profiles.role) → plný přístup = superAdmin false
    const d = decideSender({ id: "u-volny", superAdmin: false }, rows, { mailboxId: "box-firma" });
    expect(pickSmtpMailbox(rows, d.from)).toEqual({ ok: true, box: rows[0] });
  });

  it("odpověď: zůstává pravidlo send.ts — moje schránka, firemní, kam e-mail přišel; cizí osobní nikdy", () => {
    const d = decideSender(sponer, rows, { replyMailboxId: "box-volny" });
    expect(d.from).toEqual({ ownerId: "u-sponer", replyMailboxId: "box-volny" });
    // pickSmtpMailbox schránku kolegy u odpovědi ignoruje → Šponerova
    expect(pickSmtpMailbox(rows, d.from)).toEqual({ ok: true, box: rows[1] });
  });

  it("super admin bez volby → jeho vlastní schránka", () => {
    const d = decideSender(admin, rows, {});
    expect(d).toEqual({ from: { ownerId: "u-admin" }, signerId: "u-admin", chosenMailboxId: null });
    expect(pickSmtpMailbox(rows, d.from)).toEqual({ ok: true, box: rows[2] });
  });

  it("super admin vybere schránku kolegy → odejde z ní, podpis kolegy", () => {
    const d = decideSender(admin, rows, { mailboxId: "box-sponer" });
    expect(d).toEqual({ from: { mailboxId: "box-sponer" }, signerId: "u-sponer", chosenMailboxId: "box-sponer" });
    expect(pickSmtpMailbox(rows, d.from)).toEqual({ ok: true, box: rows[1] });
  });

  it("super admin vybere firemní schránku → odejde z ní s jeho podpisem", () => {
    const d = decideSender(admin, rows, { mailboxId: "BOX-FIRMA" });
    expect(d).toEqual({ from: { mailboxId: "box-firma" }, signerId: "u-admin", chosenMailboxId: "box-firma" });
  });

  it("super admin vybere neodesílající / vypnutou / smazanou schránku → NEodeslat potichu z jiné, říct proč", () => {
    for (const id of ["box-bez-smtp", "box-vypnuta", "box-smazana"]) {
      const d = decideSender(admin, rows, { mailboxId: id });
      expect(d.from).toEqual({ mailboxId: id });
      const pick = pickSmtpMailbox(rows, d.from);
      expect(pick.ok, id).toBe(false);
      if (!pick.ok) expect(pick.reason).toMatch(/neexistuje|vypnutá|nemá nastavené odesílání/);
    }
  });

  it("výběr pro super admina: jen schránky, které umí odesílat — moje, firemní, kolegů se jménem", () => {
    const opts = senderOptions("u-admin", rows, { "u-volny": "Václav Volný", "u-sponer": "Jan Šponer" });
    expect(opts.map((o) => [o.id, o.kind, o.label])).toEqual([
      ["box-admin", "own", "majitel@firma.cz · moje"],
      ["box-firma", "company", "info@firma.cz · firemní"],
      ["box-sponer", "user", "sponer@firma.cz · Jan Šponer"],
      ["box-volny", "user", "volny@firma.cz · Václav Volný"],
    ]);
  });
});
