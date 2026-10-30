import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

vi.mock("@/app/actions/mail-signature", () => ({
  signatureEditorAction: vi.fn(() => new Promise(() => {})),
  saveSignatureSettingsAction: vi.fn(),
}));

import { MailSettingsContent, MailSettingsPanel } from "./mail-settings-panel";
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
});
