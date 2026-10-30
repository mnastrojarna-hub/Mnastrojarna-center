import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/inbox",
}));
vi.mock("@/app/actions/mail", () => ({ createJobFromEmail: vi.fn(), setEmailCategory: vi.fn() }));
vi.mock("@/app/actions/mail-actions", () => ({ processOrderFromEmailAction: vi.fn(), recordSupplierInvoiceFromEmailAction: vi.fn(), splitFromThreadAction: vi.fn() }));
vi.mock("@/app/actions/mail-inbox", () => ({
  openThreadAction: vi.fn(() => new Promise(() => {})), markThreadReadAction: vi.fn(), setThreadFlagAction: vi.fn(), setThreadPriorityAction: vi.fn(),
  shareCandidatesAction: vi.fn(() => new Promise(() => {})), shareThreadAction: vi.fn(), runAiOnThreadAction: vi.fn(),
}));
vi.mock("@/app/actions/mail-compose", () => ({
  composeContextAction: vi.fn(() => new Promise(() => {})), prepareMailUploadAction: vi.fn(), sendComposedAction: vi.fn(), searchRecipientsAction: vi.fn(), saveSignatureAction: vi.fn(),
}));

import { ThreadRow } from "./thread-row";
import { ThreadView } from "./thread-view";
import { initialBody } from "./compose-dialog";
import { MyMailboxCard } from "./my-mailbox-card";
import { RecipientField } from "./recipient-field";
import { shouldContinue } from "./use-mail-sync";
import type { ThreadMessage, ThreadSummary } from "@/lib/email/mail-types";
import type { MyMailbox } from "@/lib/email/my-mailbox";

const html = (n: React.ReactNode) => renderToString(n).replace(/<!-- -->/g, "");

const t: ThreadSummary = {
  threadId: "m:<a@x>", emailId: "e1", mailboxId: "m1", direction: "in", from: "Jan Dvořák", fromEmail: "jan@firma.cz",
  subject: "Poptávka hřídele", preview: "Dobrý den", category: "Poptávka", aiConfidence: 0, lastAt: "2026-10-22T08:00:00Z",
  hasDraft: false, messageCount: 3, unreadCount: 2, flagged: true, priority: 1, priorityManual: true, hasAttachments: true, aiPending: false,
  share: { note: "Prosím nacenit", by: "Petr", unread: true },
};

describe("řádek vlákna — hlavní akce podle kategorie (Pošta E)", () => {
  const row = (p: Partial<ThreadSummary>) => html(<ThreadRow t={{ ...t, ...p }} active={false} canAi={false} showMailbox={false} onOpen={() => {}} onFlag={() => {}} onPriority={() => {}} onAction={() => {}} />);
  it("poptávka → Vytvořit nabídku; u zakázky Pokračovat v nabídce (odkaz)", () => {
    expect(row({})).toMatch(/data-testid="row-action" data-action="quote.create"[^>]*>Vytvořit nabídku/);
    const linked = row({ jobId: "j1", jobNumber: "Z-1" });
    expect(linked).toContain('href="/orders/j1?tab=nabidky"');
    expect(linked).toContain('data-action="quote.continue"');
  });
  it("faktura → Zapsat fakturu dodavatele, objednávka → Zpracovat objednávku; ostatní / odeslaná / spam bez rychlé akce", () => {
    expect(row({ category: "Faktura" })).toContain("Zapsat fakturu dodavatele");
    expect(row({ category: "Objednávka" })).toContain("Zpracovat objednávku");
    expect(row({ category: "Ostatní" })).not.toContain('data-testid="row-action"');
    expect(row({ direction: "out" })).not.toContain('data-testid="row-action"');
    expect(row({ category: "Spam" })).not.toContain('data-testid="row-action"');
    // bez onAction (Komunikace zakázky) žádná akce
    expect(html(<ThreadRow t={t} active={false} canAi={false} showMailbox={false} onOpen={() => {}} onFlag={() => {}} onPriority={() => {}} />)).not.toContain("row-action");
  });
});

describe("řádek vlákna", () => {
  it("vlaječka, priorita, počet zpráv, příloha, poznámka kolegy, nepřečtené", () => {
    const h = html(<ThreadRow t={t} active={false} canAi={false} showMailbox={false} onOpen={() => {}} onFlag={() => {}} onPriority={() => {}} />);
    expect(h).toContain('data-flagged="1"');
    expect(h).toContain('data-unread="1"');
    expect(h).toContain('aria-label="Zrušit vlaječku"');
    expect(h).toContain("P1");
    expect(h).toContain('aria-label="3 zpráv"');
    expect(h).toContain('aria-label="Přílohy"');
    expect(h).toContain("Od Petr");
    expect(h).toContain("Prosím nacenit");
    expect(h).toContain("bg-red-600"); // P1 = červený pruh
  });
  it("odeslané vlákno: ikona odeslání", () => {
    const h = html(<ThreadRow t={{ ...t, direction: "out", from: "Komu: jan@firma.cz", flagged: false, share: undefined, unreadCount: 0 }} active canAi={false} showMailbox={false} onOpen={() => {}} onFlag={() => {}} onPriority={() => {}} />);
    expect(h).toContain('aria-label="Odeslané"');
    expect(h).toContain('aria-label="Označit vlaječkou"');
    expect(h).toContain('data-unread="0"');
  });
  it("kategorie: štítek u přijaté i odeslané; s onCategory jde opravit ťuknutím (tlačítko mimo tlačítko řádku)", () => {
    const plain = html(<ThreadRow t={t} active={false} canAi={false} showMailbox={false} onOpen={() => {}} onFlag={() => {}} onPriority={() => {}} />);
    expect(plain).toContain('data-testid="category-pill"');
    expect(plain).toContain("Poptávka");
    const out = html(<ThreadRow t={{ ...t, direction: "out", category: "Objednávka" }} active={false} canAi={false} showMailbox={false} onOpen={() => {}} onFlag={() => {}} onPriority={() => {}} onCategory={() => {}} />);
    expect(out).toContain('data-testid="category-picker"');
    expect(out).toContain('aria-label="Kategorie: Objednávka. Změnit"');
    // štítek není uvnitř tlačítka, které otevírá vlákno (vnořené tlačítko = neplatné HTML)
    const openButton = /<button[^>]*aria-current[^>]*>[\s\S]*?<\/button>|<button type="button" class="block w-full[\s\S]*?<\/button>/.exec(out)?.[0] ?? "";
    expect(openButton).not.toContain("category-picker");
  });
});

describe("detail vlákna", () => {
  it("akce: Odpovědět, Odpovědět všem, Přeposlat, Předat kolegovi, vlaječka a priorita 1–5", () => {
    const h = html(<ThreadView summary={t} canAi={false} onBack={() => {}} onPatch={() => {}} onCompose={() => {}} version={0} />);
    for (const s of ["Odpovědět", "Odpovědět všem", "Přeposlat", "Předat kolegovi", "Priorita"]) expect(h).toContain(s);
    // Pošta E: poptávka → hlavní akce „Vytvořit nabídku“, ne „Založit zakázku“ (ta jen v ⋯)
    expect(h).toContain("Vytvořit nabídku");
    expect(h).toMatch(/data-testid="mail-primary-action" data-action="quote.create"/);
    expect(h).not.toContain(">Založit zakázku<");
    const inv = html(<ThreadView summary={{ ...t, category: "Faktura" }} canAi={false} onBack={() => {}} onPatch={() => {}} onCompose={() => {}} version={0} />);
    expect(inv).toContain("Zapsat fakturu dodavatele");
    expect(inv).not.toContain("Vytvořit nabídku");
    // review #9: vedlejší akce (Nepřečtené, Roztřídit AI) v menu „Další akce" — tělo zprávy výš
    expect(h).toContain('data-testid="thread-more"');
    expect(h).toContain('aria-label="Odpovědět všem"');
    expect(h).toContain('data-testid="thread-flag"');
    expect(h.match(/role="radio"/g)).toHaveLength(5);
    expect(h).toContain("Načítám vlákno");
  });
});

describe("okno psaní — výchozí text", () => {
  const src: ThreadMessage = {
    id: "e1", direction: "in", mailboxId: "m1", fromName: "Jan", fromEmail: "jan@firma.cz", toEmail: "obchod@my.cz", ccEmail: "",
    subject: "Poptávka", body: "Dobrý den,\nposílám poptávku.", receivedAt: "2026-10-22T08:00:00Z", isRead: true, flagged: false,
    manualPriority: null, priority: 3, category: "Poptávka", aiConfidence: 0, aiPending: false, hasDraft: false, messageId: "<a@x>",
    references: [], attachments: [{ id: "a1", filename: "vykres.pdf", sizeBytes: 1000, mimeType: "application/pdf" }],
  };
  it("odpověď: podpis nahoře, pod ním citace", () => {
    const b = initialBody({ mode: "reply", source: src }, "Petr Obchodník\nMnástrojárna");
    expect(b.startsWith("\n\n-- \nPetr Obchodník\nMnástrojárna\n\n")).toBe(true);
    expect(b).toMatch(/Jan <jan@firma\.cz> napsal\(a\):\n> Dobrý den,\n> posílám poptávku\.\n$/);
  });
  it("přeposlání: hlavička původní zprávy; nová zpráva jen podpis", () => {
    expect(initialBody({ mode: "forward", source: src }, "")).toContain("---------- Přeposlaná zpráva ----------");
    expect(initialBody({ mode: "new" }, "Petr")).toBe("\n\n-- \nPetr\n");
    expect(initialBody({ mode: "new" }, "")).toBe("");
  });
});

describe("adresáti", () => {
  it("štítky adres a pole pro další", () => {
    const h = html(<RecipientField id="to" label="Komu" value={["jan@firma.cz", "eva@firma.cz"]} onChange={() => {}} />);
    expect(h.match(/data-testid="recipient-chip"/g)).toHaveLength(2);
    expect(h).toContain("Odebrat jan@firma.cz");
    expect(h).toContain('role="combobox"');
  });
});

describe("Moje e-mailová schránka", () => {
  const box: MyMailbox = {
    id: "b1", email: "jan@nastrojarstvi.com", displayName: null, active: true, provider: "imap",
    incoming: "IMAP mail.hosting90.cz:993 SSL/TLS", smtp: "SMTP smtp.hosting90.cz:465 SSL/TLS", canSend: true, passwordStored: true,
    incomplete: false, lastSyncAt: null, lastSyncError: null, authBlocked: false, createdByOther: false, remaining: 120, total: 2150,
    settings: {
      preset: "hosting90", incomingProtocol: "imap", imapHost: "mail.hosting90.cz", imapPort: 993, imapTls: "tls", imapUser: "",
      smtpHost: "smtp.nastrojarstvi.com", smtpPort: 366, smtpTls: "none", smtpUser: "", imapSkipNameCheck: false, smtpSkipNameCheck: false,
    },
    editable: true,
    lockedReason: null,
  };
  it("úprava (z Pošty rovnou otevřená): servery IMAP i SMTP předvyplněné, SMTP heslo zvlášť, test i uložení", () => {
    const h = html(<MyMailboxCard initial={[box]} isAdmin={false} inPanel initialEditId="b1" />);
    for (const s of [
      "Upravit jan@nastrojarstvi.com", 'value="mail.hosting90.cz"', 'value="993"', 'value="smtp.nastrojarstvi.com"', 'value="366"',
      'aria-label="Uživatelské jméno"', 'aria-label="Uživatelské jméno SMTP"', "SMTP má jiné heslo než schránka", "Otestovat připojení", "Ověřit a uložit",
    ]) expect(h).toContain(s);
    expect(h).toMatch(/<option value="none" selected="">Žádné/);
    expect(h).not.toContain("Otevřít poštu"); // v panelu Pošty bez odkazu na Poštu
  });
  it("Microsoft 365 (nastavuje admin): bez Upravit, vysvětlení a koho požádat — žádné mrtvé tlačítko", () => {
    const h = html(<MyMailboxCard initial={[{ ...box, provider: "outlook", editable: false, lockedReason: "Schránka Microsoft 365 … nastavuje super admina (Eva Admin) …" }]} isAdmin={false} />);
    expect(h).toContain('data-testid="my-box-locked"');
    expect(h).toContain("Eva Admin");
    expect(h).not.toContain('data-testid="my-box-edit"');
  });
  it("bez schránky: rovnou formulář e-mail + heslo → Najít nastavení a připojit", () => {
    const h = html(<MyMailboxCard initial={[]} isAdmin={false} />);
    expect(h).toContain("Připojit e-mailovou schránku");
    expect(h).toContain("Najít nastavení a připojit");
    expect(h).toContain('aria-label="Heslo ke schránce"');
  });
  it("připojená: příjem, odesílání, test, zkušební odeslání, upravit, odpojit — bez hesla", () => {
    const h = html(<MyMailboxCard initial={[box]} isAdmin={false} />);
    for (const s of ["jan@nastrojarstvi.com", "Příjem: IMAP mail.hosting90.cz:993", "Odesílání: SMTP smtp.hosting90.cz:465", "Otestovat", "Vyzkoušet odeslání", "Upravit", "Odpojit", "čeká 120"]) expect(h).toContain(s);
    expect(h).not.toMatch(/password|heslo:/i);
    const noSmtp = html(<MyMailboxCard initial={[{ ...box, smtp: null, canSend: false }]} isAdmin={false} />);
    expect(noSmtp).toContain("Odesílání: nenastaveno — doplň v Upravit");
  });
});

describe("stahování až do konce — kdy pokračovat", () => {
  const prev = { remaining: 10, round: 1, idle: 0 };
  it("pokračuje, dokud server nehlásí hotovo", () => {
    expect(shouldContinue({ configured: true, done: false, remaining: 100, boxes: [{ id: "a", email: "a", ok: true }] }, prev)).toBe(true);
    expect(shouldContinue({ configured: true, done: true, remaining: 0 }, prev)).toBe(false);
  });
  it("konec: chyba všech schránek, nic nenastaveno, bez posunu, strop kol", () => {
    expect(shouldContinue({ configured: true, done: false, boxes: [{ id: "a", email: "a", ok: false }] }, prev)).toBe(false);
    expect(shouldContinue({ configured: false }, prev)).toBe(false);
    expect(shouldContinue(null, prev)).toBe(false);
    expect(shouldContinue({ configured: true, done: false }, { ...prev, idle: 3 })).toBe(false);
    expect(shouldContinue({ configured: true, done: false }, { ...prev, idle: 2 })).toBe(true);
    expect(shouldContinue({ configured: true, done: false }, { ...prev, round: 60 })).toBe(false);
  });
});
