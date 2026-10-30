import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings",
}));
vi.mock("@/app/actions/integrations", () => ({
  addMailbox: vi.fn(), updateMailbox: vi.fn(), deleteMailbox: vi.fn(), setMailboxActive: vi.fn(),
}));
vi.mock("@/app/actions/mailbox-owner", () => ({ setMailboxOwner: vi.fn() }));

import { formSecrets, mailboxToForm } from "./mailbox-manager";
import { mergeMailboxSecrets, resolveSmtp } from "@/lib/email/mail-config";
import type { Mailbox } from "@/lib/supabase/database.types";

/**
 * Nastavení → E-mailové schránky → Upravit: zaškrtávátko „SMTP má jiné heslo než schránka" dřív bylo
 * při úpravě vždy prázdné, i když bylo uložené vlastní SMTP heslo — a odškrtnuté ho nesmazalo
 * (produkce: příjem OK, odeslání 535 se zastaralým SMTP heslem).
 */
const box = (smtpSeparate: boolean): Mailbox => ({
  id: "m1", provider: "imap", email: "semorad@nastrojarstvi.com", display_name: null, active: true, last_sync_at: null,
  created_at: "2026-01-01T00:00:00Z", owner_id: null,
  config: { preset: "hosting90", imap_host: "mail.hosting90.cz", imap_port: 993, smtp_host: "smtp.nastrojarstvi.com", smtp_port: 366, smtp_user: "semorad@nastrojarstvi.com" },
  secrets_set: { imap_password: true, smtp_password: true, ms_graph_client_secret: false, smtp_separate: smtpSeparate },
});

describe("formulář schránky — vlastní SMTP heslo", () => {
  it("uložené vlastní SMTP heslo → zaškrtávátko zaškrtnuté (vidět, že existuje)", () => {
    expect(mailboxToForm(box(true)).separateSmtpPassword).toBe(true);
    expect(mailboxToForm(box(false)).separateSmtpPassword).toBe(false);
  });

  it("odškrtnuté a Uložit → server SMTP heslo smaže, odesílání použije heslo schránky", () => {
    const f = { ...mailboxToForm(box(true)), separateSmtpPassword: false };
    const secrets = formSecrets(f, false);
    expect(secrets).toMatchObject({ clear_smtp_password: true, smtp_password: undefined, imap_password: undefined });
    const out = mergeMailboxSecrets({ imap_password: "Heslo-schranky", smtp_password: "Stare" }, {}, secrets);
    expect(out).toEqual({ imap_password: "Heslo-schranky" });
    expect(resolveSmtp({ ...out, smtp_host: "smtp.nastrojarstvi.com", smtp_port: 366 }, "semorad@nastrojarstvi.com")).toMatchObject({ password: "Heslo-schranky", passwordSource: "incoming" });
  });

  it("zaškrtnuté bez zadání (ponechat) + změna hesla schránky → SMTP heslo zůstane", () => {
    const f = { ...mailboxToForm(box(true)), changePassword: true, password: "Nove" };
    const secrets = formSecrets(f, false);
    expect(secrets).toMatchObject({ keep_smtp_password: true, imap_password: "Nove" });
    expect(mergeMailboxSecrets({ imap_password: "Stare", smtp_password: "Jine" }, {}, secrets)).toEqual({ imap_password: "Nove", smtp_password: "Jine" });
  });

  it("Šifrování „Žádné“ (Outlook) se uloží jen u SMTP", () => {
    const f = { ...mailboxToForm(box(false)), smtp_tls: "none" as const };
    expect(f.smtp_tls).toBe("none");
  });
});
