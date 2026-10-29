import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/inbox",
}));
vi.mock("@/app/actions/mail", () => ({ createJobFromEmail: vi.fn(), setEmailCategory: vi.fn() }));
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
import { SignatureForm } from "./signature-form";
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
});

describe("detail vlákna", () => {
  it("akce: Odpovědět, Odpovědět všem, Přeposlat, Předat kolegovi, vlaječka a priorita 1–5", () => {
    const h = html(<ThreadView summary={t} canAi={false} onBack={() => {}} onPatch={() => {}} onCompose={() => {}} version={0} />);
    for (const s of ["Odpovědět", "Odpovědět všem", "Přeposlat", "Předat kolegovi", "Založit zakázku", "Priorita"]) expect(h).toContain(s);
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
  };
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
  it("podpis", () => {
    expect(html(<SignatureForm initial="Jan" />)).toContain("Uložit podpis");
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
