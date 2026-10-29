import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

// Smoke test UI pošty bez Next.js: router, oprávnění a serverové akce jsou nahrazené
const accessState: { features: string[] } = { features: [] };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/inbox",
}));
vi.mock("@/components/access-provider", () => ({
  useAccess: () => ({
    features: accessState.features,
    role: null,
    userId: "u1",
    can: (f: string) => accessState.features.includes(f),
  }),
}));
vi.mock("@/app/actions/mail", () => ({
  createJobFromEmail: vi.fn(), getEmailBody: vi.fn(() => new Promise(() => {})), markEmailRead: vi.fn(), setEmailCategory: vi.fn(),
}));
vi.mock("@/app/actions/corrections", () => ({ recordCorrection: vi.fn() }));
vi.mock("@/app/actions/email-import", () => ({ importOutlookFiles: vi.fn() }));
vi.mock("@/app/actions/integrations", () => ({
  addMailbox: vi.fn(), updateMailbox: vi.fn(), deleteMailbox: vi.fn(), testMailboxConnection: vi.fn(),
}));
vi.mock("@/app/actions/mailbox-owner", () => ({ setMailboxOwner: vi.fn() }));
vi.mock("@/app/actions/mail-inbox", () => ({
  listThreadsAction: vi.fn(), openThreadAction: vi.fn(() => new Promise(() => {})), markThreadReadAction: vi.fn(), setThreadFlagAction: vi.fn(),
  setThreadPriorityAction: vi.fn(), shareCandidatesAction: vi.fn(), shareThreadAction: vi.fn(), runAiOnThreadAction: vi.fn(),
}));
vi.mock("@/app/actions/mail-compose", () => ({
  composeContextAction: vi.fn(), prepareMailUploadAction: vi.fn(), sendComposedAction: vi.fn(), searchRecipientsAction: vi.fn(), saveSignatureAction: vi.fn(),
}));

import { AutomationProvider } from "@/components/automation-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { InboxView } from "@/app/(app)/inbox/inbox-view";
import { SentList } from "@/components/sent-list";
import { MailboxManager } from "@/components/mailbox-manager";
import type { SentItem } from "@/lib/data/types";
import type { ThreadSummary } from "./mail-types";
import type { Mailbox } from "@/lib/supabase/database.types";
import type { MailboxOption } from "./visibility";

function render(node: React.ReactNode): string {
  return renderToString(
    <AutomationProvider>
      <TooltipProvider>{node}</TooltipProvider>
    </AutomationProvider>,
  ).replace(/<!-- -->/g, "");
}

const thread = (p: Partial<ThreadSummary> & { threadId: string; subject: string }): ThreadSummary => ({
  emailId: `e-${p.threadId}`, mailboxId: "m1", direction: "in", from: "—", fromEmail: "", preview: "", category: "Ostatní",
  aiConfidence: 0, lastAt: "2026-10-22T08:00:00Z", hasDraft: false, messageCount: 1, unreadCount: 0, flagged: false,
  priority: 3, priorityManual: false, hasAttachments: false, aiPending: false, ...p,
});
const threads: ThreadSummary[] = [
  thread({
    threadId: "t1", from: "Jan Dvořák", fromEmail: "dvorak@strojmetal.cz", subject: "Poptávka hřídele", preview: "Dobrý den, 50 ks",
    category: "Poptávka", customer: "StrojMetal", aiConfidence: 0.93, aiSummary: "Zákazník poptává 50 ks hřídelí", unreadCount: 1,
    hasDraft: true, mailboxEmail: "obchod@mnastrojarna.cz", priority: 2, messageCount: 3, flagged: true, hasAttachments: true,
  }),
  thread({
    threadId: "t2", from: "Eva Nová", fromEmail: "eva@firma.cz", subject: "Objednávka 4500123", preview: "Objednáváme",
    category: "Objednávka", jobId: "j1", jobNumber: "Z-2026-001", priority: 1, priorityManual: true,
    share: { note: "Prosím nacenit do pátku", by: "Petr Obchodník", unread: true },
  }),
];
const page = (items: ThreadSummary[]) => ({ items, total: items.length, offset: 0, hasMore: false });
const counts = { inboxUnread: 2, flagged: 1, spam: 4, shared: 1, sharedUnread: 1, aiPending: 0 };

const mailboxes: MailboxOption[] = [
  { id: "m1", email: "obchod@mnastrojarna.cz", displayName: "Obchod", ownerId: "u1", ownerName: "Petra Obchodní" },
  { id: "m2", email: "info@mnastrojarna.cz", displayName: null, ownerId: null, ownerName: null },
];

describe("Přijatá pošta — render", () => {
  beforeEach(() => {
    accessState.features = [];
  });

  it("běžný uživatel: složky s počty, vlákna s vlaječkou a prioritou, poznámka kolegy, bez AI prvků", () => {
    const html = render(<InboxView initial={page(threads)} counts={counts} mailboxes={[mailboxes[0]]} scope="own" mailboxId={null} folder="inbox" />);
    expect(html).toContain("Tvoje schránka:");
    expect(html).toContain("obchod@mnastrojarna.cz");
    for (const f of ["Přijaté", "Odeslané", "Označené", "Předané mně", "Vše", "Spam"]) expect(html).toContain(f);
    expect(html).toContain("Poptávka hřídele");
    expect(html).toContain("bg-sky-500"); // barva poptávky (tečka nepřečteného)
    expect(html).toContain("Z-2026-001");
    expect(html).toContain("Od Petr Obchodník");
    expect(html).toContain("Prosím nacenit do pátku");
    expect(html).toContain('data-flagged="1"');
    expect(html).toContain("P1");
    expect(html).toContain("P2");
    expect(html).toContain("Nová zpráva");
    expect(html).toContain("Stáhnout poštu");
    // review #2: žádné vlákno se neotevře samo (otevření = přečteno) — až po kliknutí
    expect(html).toContain("Vyber e-mail vlevo.");
    expect(html).not.toContain('data-testid="thread-view"');
    expect(html).toContain("2 vlákna");
    expect(html).not.toContain("Co AI zjistila");
    expect(html).not.toContain("Návrh připraven");
    expect(html).not.toContain("% AI");
    expect(html).not.toContain("Všechny schránky");
  });

  it("bez schránky: připoj si ji sám v Můj účet", () => {
    const html = render(<InboxView initial={page([])} counts={counts} mailboxes={[]} scope="own" mailboxId={null} folder="inbox" />);
    expect(html).toContain("Zatím nemáš připojenou e-mailovou schránku.");
    expect(html).toContain("Připojit schránku");
    expect(html).toContain('href="/account#schranka"');
  });

  it("super admin: přepínač schránek a AI shrnutí", () => {
    accessState.features = ["mail", "mail_all", "dashboard"];
    const html = render(<InboxView initial={page(threads)} counts={counts} mailboxes={mailboxes} scope="all" mailboxId={null} folder="inbox" />);
    expect(html).toContain("Všechny schránky");
    expect(html).toContain("Petra Obchodní");
    expect(html).toContain("firemní (bez vlastníka)");
    expect(html).toContain("93% AI");
    expect(html).not.toContain('data-testid="thread-view"');
    // review #10: mobil = kompaktní výběr schránky
    expect(html).toContain('data-testid="mailbox-select"');
  });
});

describe("Odeslaná pošta — render", () => {
  const items: SentItem[] = [
    {
      id: "s1", type: "Nabídka", rawType: "quote", title: "Cenová nabídka NAB-2026-004", target: "jan@firma.cz",
      body: "Text", sentAt: "2026-10-22T09:00:00Z", auto: false, kind: "quote", source: "mail",
      jobId: "j1", jobNumber: "Z-2026-001", mailboxEmail: "obchod@mnastrojarna.cz",
    },
    {
      id: "s2", type: "E-mail", rawType: "email_reply", title: "Odpověď: dotaz", target: "eva@firma.cz",
      body: "Dobrý den", sentAt: "2026-10-21T09:00:00Z", auto: true, source: "approval",
    },
  ];

  it("barevné druhy, automatika a odkaz na zakázku", () => {
    const html = render(<SentList items={items} />);
    expect(html).toContain("Cenová nabídka NAB-2026-004");
    expect(html).toContain("Nabídka");
    expect(html).toContain("Automaticky");
    expect(html).toContain('href="/orders/j1"');
    expect(html).toContain("Zakázka Z-2026-001");
    expect(html).not.toContain("Nemělo to tak odejít");
  });

  it("prázdný stav", () => {
    const html = render(<SentList items={[]} />);
    expect(html).toContain("Zatím nic neodešlo.");
  });

  it("super admin: přepínač schránek", () => {
    accessState.features = ["mail", "mail_all", "dashboard"];
    const html = render(<SentList items={items} mailboxes={mailboxes} mailboxId="m1" scope="all" />);
    expect(html).toContain("Všechny schránky");
    expect(html).toContain("info@mnastrojarna.cz");
  });
});

describe("Správa schránek — render", () => {
  const boxes: Mailbox[] = [
    {
      id: "m1", provider: "imap", email: "obchod@mnastrojarna.cz", display_name: "Obchod",
      config: { imap_host: "mail.hosting90.cz", imap_port: 993 }, active: true, last_sync_at: null,
      created_at: "2026-01-01T00:00:00Z", owner_id: "u1",
    },
    {
      id: "m2", provider: "imap", email: "info@mnastrojarna.cz", display_name: null, config: {}, active: true,
      last_sync_at: null, created_at: "2026-01-01T00:00:00Z", owner_id: null,
    },
  ];
  const users = [{ id: "u1", full_name: "Petra Obchodní", email: "petra@mnastrojarna.cz" }];

  it("vlastník u schránky, výběr vlastníka i ve formuláři", () => {
    const html = render(<MailboxManager mailboxes={boxes} users={users} />);
    expect(html).toContain("Petra Obchodní");
    expect(html).toContain("bez vlastníka — vidí jen super admin");
    expect(html).toContain("Čí je schránka?");
    expect(html).toContain("— bez vlastníka (jen super admin) —");
  });
});
