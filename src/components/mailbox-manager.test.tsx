import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings",
}));
vi.mock("@/app/actions/integrations", () => ({
  addMailbox: vi.fn(), updateMailbox: vi.fn(), deleteMailbox: vi.fn(), setMailboxActive: vi.fn(),
}));
vi.mock("@/app/actions/mailbox-owner", () => ({ setMailboxOwner: vi.fn() }));

import { MailboxManager, applyFieldChange, EMPTY_FORM } from "./mailbox-manager";
import type { Mailbox } from "@/lib/supabase/database.types";

const render = (node: React.ReactNode) => renderToString(node).replace(/<!-- -->/g, "");

const status = (p: Partial<NonNullable<Mailbox["status"]>>): NonNullable<Mailbox["status"]> => ({
  mailbox_id: "x", last_sync_attempt_at: null, last_sync_ok_at: null, last_sync_error: null, last_sync_fetched: null,
  last_sync_new: null, last_sync_remaining: null, last_test_at: null, last_test_ok: null, last_test_error: null,
  last_test: null, last_test_by: null, sync_state: {}, sync_lock_until: null, updated_at: "2026-10-23T00:00:00Z", ...p,
});

const boxes: Mailbox[] = [
  {
    id: "m1", provider: "imap", email: "jmeno@nastrojarstvi.com", display_name: null, active: true, last_sync_at: null,
    created_at: "2026-01-01T00:00:00Z", owner_id: null,
    config: { preset: "hosting90", imap_host: "mail.hosting90.cz", imap_port: 993, imap_tls: "tls", smtp_host: "smtp.hosting90.cz", smtp_port: 465 },
    secrets_set: { imap_password: true, smtp_password: true, ms_graph_client_secret: false },
    status: status({ last_sync_attempt_at: new Date().toISOString(), last_sync_error: "jmeno@nastrojarstvi.com: Přihlášení odmítnuto — server mail.hosting90.cz nepřijal uživatele nebo heslo." }),
  },
  {
    id: "m2", provider: "imap", email: "kolega@mnastrojarna.cz", display_name: null, active: false, last_sync_at: null,
    created_at: "2026-01-01T00:00:00Z", owner_id: null, config: {},
    secrets_set: { imap_password: false, smtp_password: false, ms_graph_client_secret: false },
  },
];

describe("Správa schránek — stav a nový formulář", () => {
  it("seznam: předvolba, heslo uloženo, chyba stažení, neúplná, vypnutá", () => {
    const html = render(<MailboxManager mailboxes={boxes} users={[]} />);
    expect(html).toContain("hosting90 (vlastní doména)");
    expect(html).toContain("heslo uloženo");
    expect(html).toContain("Stažení selhalo");
    expect(html).toContain("Přihlášení odmítnuto");
    expect(html).toContain("Neúplná — chybí: příchozí server, heslo");
    expect(html).toContain("vypnutá");
    expect(html).toContain("IMAP: mail.hosting90.cz:993 SSL/TLS");
    expect(html).not.toMatch(/imap_password|Spravne/);
  });

  it("nový formulář: výchozí hosting90, heslo, Najít nastavení automaticky, Otestovat", () => {
    const html = render(<MailboxManager mailboxes={[]} users={[{ id: "u1", full_name: "Petr", email: "p@x.cz" }]} />);
    expect(html).toContain("Najít nastavení automaticky");
    expect(html).toContain("Otestovat připojení");
    expect(html).toContain('aria-label="Heslo ke schránce"');
    expect(html).toContain("Microsoft 365 (Exchange Online) — ne Outlook v počítači");
    expect(html).toContain("Ponechat kopii zpráv na serveru");
    expect(html).toContain("Čí je schránka?");
  });
});

describe("Formulář schránky — port, šifrování, protokol", () => {
  it("výchozí šifrování „podle portu“ (prázdné), ne natvrdo SSL/TLS", () => {
    expect(EMPTY_FORM.imap_tls).toBe("");
    expect(EMPTY_FORM.smtp_tls).toBe("");
    const html = render(<MailboxManager mailboxes={[]} users={[]} />);
    expect(html).not.toMatch(/<option value="tls" selected/);
  });

  it("změna portu přepne šifrování na „podle portu“ (dřív zůstalo SSL/TLS u portu 143 / 587)", () => {
    const f = { ...EMPTY_FORM, imap_tls: "tls" as const, smtp_tls: "tls" as const };
    const a = applyFieldChange(f, "imap_port", "143");
    expect(a.imap_tls).toBe("");
    expect(a.incoming_protocol).toBe("imap");
    const b = applyFieldChange(f, "smtp_port", "587");
    expect(b.smtp_tls).toBe("");
    // port 995 napoví POP3
    expect(applyFieldChange(f, "imap_port", "995").incoming_protocol).toBe("pop3");
  });

  it("změna protokolu → výchozí port protokolu (zachová druh šifrování)", () => {
    expect(applyFieldChange({ ...EMPTY_FORM, imap_port: "993" }, "incoming_protocol", "pop3")).toMatchObject({ incoming_protocol: "pop3", imap_port: "995", imap_tls: "" });
    expect(applyFieldChange({ ...EMPTY_FORM, imap_port: "143", imap_tls: "starttls" }, "incoming_protocol", "pop3")).toMatchObject({ imap_port: "110", imap_tls: "" });
    expect(applyFieldChange({ ...EMPTY_FORM, incoming_protocol: "pop3", imap_port: "995" }, "incoming_protocol", "imap")).toMatchObject({ imap_port: "993" });
    // výběr stejného protokolu port nemění
    expect(applyFieldChange({ ...EMPTY_FORM, imap_port: "10993" }, "incoming_protocol", "imap").imap_port).toBe("10993");
  });

  it("odmítnuté heslo: řádek schránky jasně řekne „Heslo odmítnuto — oprav ho“", () => {
    const html = render(
      <MailboxManager
        mailboxes={[{ ...boxes[0], status: status({ last_sync_attempt_at: new Date().toISOString(), last_sync_error: "x: Přihlášení odmítnuto", last_sync_error_kind: "auth" }) }]}
        users={[]}
      />,
    );
    expect(html).toContain("Heslo odmítnuto");
    expect(html).toContain("Změnit heslo");
    expect(html).toContain("Automatické stahování je do opravy pozastavené");
  });
});
