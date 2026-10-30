import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

vi.mock("@/app/actions/mail-signature", () => ({
  signatureEditorAction: vi.fn(() => new Promise(() => {})),
  saveSignatureSettingsAction: vi.fn(),
}));

import { MailboxSettingsContent, MailSettingsContent, MailSettingsPanel } from "./mail-settings-panel";
import type { MyMailbox } from "@/lib/email/my-mailbox";
import { defaultSignatureFor, signatureCompanyFrom } from "@/lib/email/signature";
import type { SignatureEditorState } from "@/app/actions/mail-signature";

const company = signatureCompanyFrom({ name: "Mnástrojárna s.r.o.", address: { street: "Varšavská 715/36", zip: "120 00", city: "Praha 2" }, ico: "04304080", dic: "CZ04304080", web: "www.mnastrojarna.cz" });
const defaults = defaultSignatureFor({ fullName: "Vít Volný", phone: "734846246" }, "vit.volny@mnastrojarna.cz", company);
const state = (p: Partial<SignatureEditorState> = {}): SignatureEditorState => ({
  ok: true,
  mailboxes: [{ key: "vit.volny@mnastrojarna.cz", label: "vit.volny@mnastrojarna.cz" }, { key: "obchod@mnastrojarna.cz", label: "obchod@mnastrojarna.cz · firemní" }],
  mailbox: "vit.volny@mnastrojarna.cz",
  value: defaults,
  defaults,
  saved: null,
  source: "auto",
  legacyText: "",
  company,
  ...p,
});
const html = (n: React.ReactNode) => renderToString(n).replace(/<!-- -->/g, "");

describe("Nastavení pošty — podpis", () => {
  it("bez předaného stavu: načítání", () => {
    expect(html(<MailSettingsContent />)).toContain("Načítám podpis…");
  });

  it("editor se schránkami a uložením", () => {
    const h = html(<MailSettingsContent initial={state()} />);
    expect(h).toContain('data-testid="signature-editor"');
    expect(h).toContain('data-testid="signature-mailboxes"');
    expect(h).toContain('data-testid="signature-save"');
    expect(h).toContain("Zatím výchozí podpis");
    expect(h).not.toContain('data-testid="mail-settings-legacy"');
  });

  it("starý textový podpis: vysvětlí, že ho grafický nahradí", () => {
    const h = html(<MailSettingsContent initial={state({ source: "legacy", legacyText: "Vít" })} />);
    expect(h).toContain('data-testid="mail-settings-legacy"');
    expect(h).toContain("nahradí ho");
  });

  it("zavřený panel nic nevykreslí", () => {
    expect(html(<MailSettingsPanel open={false} onOpenChange={() => {}} />)).toBe("");
  });

  it("podpis: místo odkazu pryč z Pošty tlačítko na záložku Schránka", () => {
    const h = html(<MailSettingsContent initial={state()} onOpenMailbox={() => {}} />);
    expect(h).toContain("heslo a servery v záložce Schránka");
    expect(h).not.toContain('href="/account');
  });
});

describe("Nastavení pošty — Schránka (každý uživatel, i obchodník)", () => {
  const box: MyMailbox = {
    id: "b1", email: "vit.volny@mnastrojarna.cz", displayName: null, active: true, provider: "imap",
    incoming: "IMAP mail.hosting90.cz:993 SSL/TLS", smtp: null, canSend: false, passwordStored: true, incomplete: false,
    lastSyncAt: null, lastSyncError: null, authBlocked: false, createdByOther: true, remaining: null, total: null,
    settings: {
      preset: "hosting90", incomingProtocol: "imap", imapHost: "mail.hosting90.cz", imapPort: 993, imapTls: "tls", imapUser: "",
      smtpHost: "", smtpPort: null, smtpTls: "", smtpUser: "", imapSkipNameCheck: false, smtpSkipNameCheck: false,
    },
    editable: true,
    lockedReason: null,
  };
  it("bez předaného stavu: načítání", () => {
    expect(html(<MailboxSettingsContent isAdmin={false} />)).toContain("Načítám schránku…");
  });
  it("bez schránky: rovnou formulář e-mail + heslo, servery ručně v Upřesnit", () => {
    const h = html(<MailboxSettingsContent isAdmin={false} initial={[]} />);
    for (const s of ['data-testid="my-mailbox-form"', "Najít nastavení a připojit", "Otestovat připojení", "Upřesnit — servery IMAP / SMTP ručně"]) expect(h).toContain(s);
    expect(h).not.toContain("Otevřít poštu");
  });
  it("schránka přiřazená adminem (bez SMTP): Upravit, Otestovat připojení, odesílání nenastaveno", () => {
    const h = html(<MailboxSettingsContent isAdmin={false} initial={[box]} />);
    for (const s of ['data-testid="my-box-edit"', "Otestovat připojení", "Odesílání: nenastaveno — doplň v Upravit"]) expect(h).toContain(s);
  });
  it("z Pošty „Opravit nastavení“: úprava rovnou otevřená s předvyplněnými servery", () => {
    const h = html(<MailboxSettingsContent isAdmin={false} initial={[box]} editMailboxId="b1" />);
    expect(h).toContain("Upravit vit.volny@mnastrojarna.cz");
    expect(h).toContain('value="mail.hosting90.cz"');
    expect(h).toContain('aria-label="Odchozí server"');
  });
});
