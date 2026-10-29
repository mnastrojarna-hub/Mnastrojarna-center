import { describe, it, expect } from "vitest";
import { canSendFrom, formatFrom, pickFromAddress, pickSmtpMailbox } from "./send";
import type { MailboxConfig } from "@/lib/supabase/database.types";

describe("adresa odesílatele", () => {
  it("vezme první platný e-mail (schránka → SMTP login → firma)", () => {
    expect(pickFromAddress(["obchod@firma.cz", "user", "info@firma.cz"])).toBe("obchod@firma.cz");
    expect(pickFromAddress([undefined, "smtp-login", "info@firma.cz"])).toBe("info@firma.cz");
    expect(pickFromAddress([null, " jan@firma.cz ", "x@y.cz"])).toBe("jan@firma.cz");
  });
  it("bez platného e-mailu nic", () => {
    expect(pickFromAddress(["test", "", undefined])).toBeUndefined();
  });
  it("hlavička From: jméno v uvozovkách, bez konců řádků a uvozovek (žádné vkládání hlaviček)", () => {
    expect(formatFrom("Jan Novák | Mnástrojárna", "jan@firma.cz")).toBe('"Jan Novák | Mnástrojárna" <jan@firma.cz>');
    expect(formatFrom('Zlý"\r\nBcc: x@y.cz', "jan@firma.cz")).toBe('"Zlý Bcc: x@y.cz" <jan@firma.cz>');
    expect(formatFrom("", "jan@firma.cz")).toBe("jan@firma.cz");
  });
});

type Row = { id: string; email: string; owner_id: string | null; active: boolean; config: MailboxConfig; provider?: "imap" | "outlook" | "gmail" };

describe("ze které schránky odeslat", () => {
  const smtp: MailboxConfig = { imap_host: "mail.hosting90.cz", imap_password: "x", smtp_host: "smtp.hosting90.cz", smtp_port: 465 };
  const rows: Row[] = [
    // nejstarší: cizí osobní schránka s SMTP (dřív ji vzal rows[0])
    { id: "jana", email: "jana@firma.cz", owner_id: "u-jana", active: true, config: smtp },
    { id: "petr", email: "petr@firma.cz", owner_id: "u-petr", active: true, config: { imap_host: "mail.hosting90.cz", imap_password: "x" } },
    { id: "vypnuta", email: "eva@firma.cz", owner_id: "u-eva", active: false, config: smtp },
    { id: "firma", email: "info@firma.cz", owner_id: null, active: true, config: smtp },
  ];

  it("PŘÍČINA 1 (M1): admin spároval schránku bez vlastníka → jeho nabídky / doklady / odpovědi dřív padaly na „Nemáš přiřazenou schránku“; teď jdou z firemní schránky", () => {
    // stejná data jako v produkci: jediná schránka, owner_id = null (výchozí volba „bez vlastníka“ ve formuláři)
    const onlyCompany = [rows[3]];
    const r = pickSmtpMailbox(onlyCompany, { ownerId: "u-admin" });
    expect(r).toEqual({ ok: true, box: rows[3] });
  });

  it("vlastní schránka s SMTP → ta (ne firemní, ne cizí)", () => {
    expect(pickSmtpMailbox(rows, { ownerId: "u-jana" })).toEqual({ ok: true, box: rows[0] });
  });

  it("odpověď: přednostně moje schránka, kam e-mail přišel; firemní schránka, kam přišel; cizí osobní NIKDY", () => {
    const two: Row[] = [...rows, { id: "jana2", email: "jana.obchod@firma.cz", owner_id: "u-jana", active: true, config: smtp }];
    expect(pickSmtpMailbox(two, { ownerId: "u-jana", replyMailboxId: "jana2" })).toEqual({ ok: true, box: two[4] });
    // uživatel bez vlastní schránky odpovídá na poštu firemní schránky → z ní
    expect(pickSmtpMailbox(rows, { ownerId: "u-nikdo", replyMailboxId: "firma" })).toEqual({ ok: true, box: rows[3] });
    // odpověď na e-mail z osobní schránky kolegy (předaný) → ne z jeho schránky, ale firemní
    expect(pickSmtpMailbox(rows, { ownerId: "u-nikdo", replyMailboxId: "jana" })).toEqual({ ok: true, box: rows[3] });
  });

  it("uživatel bez schránky a bez firemní schránky s SMTP → globální SMTP (box: null)", () => {
    expect(pickSmtpMailbox(rows.slice(0, 3), { ownerId: "u-nikdo" })).toEqual({ ok: true, box: null });
  });

  it("vlastní schránka bez SMTP → NEodeslat potichu z firemní adresy, říct proč a kde to opravit", () => {
    const r = pickSmtpMailbox(rows, { ownerId: "u-petr" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^Tvoje schránka nemá nastavené odesílání \(SMTP\) — nastav ho v Můj účet → Moje e-mailová schránka/);
  });

  it("vypnutá vlastní schránka → neodeslat", () => {
    const r = pickSmtpMailbox(rows, { ownerId: "u-eva" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/vypnutá/);
  });

  it("výslovně zadaná schránka bez SMTP / vypnutá / neexistující → neodeslat; s SMTP → ta", () => {
    for (const id of ["petr", "vypnuta", "smazana"]) expect(pickSmtpMailbox(rows, { mailboxId: id }).ok, id).toBe(false);
    expect(pickSmtpMailbox(rows, { mailboxId: "firma" })).toEqual({ ok: true, box: rows[3] });
  });

  it("systémový e-mail → firemní schránka (bez vlastníka), nikdy cizí; bez ní globální SMTP", () => {
    expect(pickSmtpMailbox(rows, { system: true })).toEqual({ ok: true, box: rows[3] });
    expect(pickSmtpMailbox(rows.slice(0, 3), { system: true })).toEqual({ ok: true, box: null });
  });

  it("PŘÍČINA 4 (M1): schránka Microsoft 365 (Graph) dřív „nemá odesílání“ — teď odesílá přes Graph (Mail.Send)", () => {
    const m365: Row = { id: "m365", email: "obchod@firma.onmicrosoft.com", owner_id: "u-m", active: true, provider: "outlook", config: { ms_graph_client_id: "c", ms_graph_client_secret: "s", ms_graph_tenant_id: "t" } };
    expect(canSendFrom(m365)).toBe(true);
    expect(pickSmtpMailbox([m365], { ownerId: "u-m" })).toEqual({ ok: true, box: m365 });
    expect(canSendFrom({ ...m365, config: { ms_graph_client_id: "c" } })).toBe(false);
  });
});
