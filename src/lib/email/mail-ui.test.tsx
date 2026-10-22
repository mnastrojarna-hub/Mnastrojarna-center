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

import { AutomationProvider } from "@/components/automation-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { InboxView } from "@/app/(app)/inbox/inbox-view";
import { SentList } from "@/components/sent-list";
import { MailboxManager } from "@/components/mailbox-manager";
import type { EmailItem, SentItem } from "@/lib/data/types";
import type { Mailbox } from "@/lib/supabase/database.types";
import type { MailboxOption } from "./visibility";

function render(node: React.ReactNode): string {
  return renderToString(
    <AutomationProvider>
      <TooltipProvider>{node}</TooltipProvider>
    </AutomationProvider>,
  ).replace(/<!-- -->/g, "");
}

const emails: EmailItem[] = [
  {
    id: "e1", from: "Jan Dvořák", fromEmail: "dvorak@strojmetal.cz", subject: "Poptávka hřídele", preview: "Dobrý den, 50 ks",
    category: "Poptávka", priority: "Vysoká", customer: "StrojMetal", receivedAt: "2026-10-22T08:00:00Z",
    aiConfidence: 0.93, aiSummary: "Zákazník poptává 50 ks hřídelí", unread: true, hasDraft: true,
    mailboxId: "m1", mailboxEmail: "obchod@mnastrojarna.cz", direction: "in",
  },
  {
    id: "e2", from: "Eva Nová", fromEmail: "eva@firma.cz", subject: "Objednávka 4500123", preview: "Objednáváme",
    category: "Objednávka", priority: "Střední", receivedAt: "2026-10-21T08:00:00Z", aiConfidence: 0, unread: false,
    hasDraft: false, jobId: "j1", jobNumber: "Z-2026-001",
  },
  {
    id: "e3", from: "Spammer", fromEmail: "x@spam.biz", subject: "Výhra", preview: "", category: "Spam", priority: "Nízká",
    receivedAt: "2026-10-20T08:00:00Z", aiConfidence: 0, unread: true, hasDraft: false,
  },
];

const mailboxes: MailboxOption[] = [
  { id: "m1", email: "obchod@mnastrojarna.cz", displayName: "Obchod", ownerId: "u1", ownerName: "Petra Obchodní" },
  { id: "m2", email: "info@mnastrojarna.cz", displayName: null, ownerId: null, ownerName: null },
];

describe("Přijatá pošta — render", () => {
  beforeEach(() => {
    accessState.features = [];
  });

  it("běžný uživatel: jeho schránka, barevné kategorie, bez AI prvků", () => {
    const html = render(<InboxView emails={emails} mailboxes={[mailboxes[0]]} scope="own" mailboxId={null} />);
    expect(html).toContain("Tvoje schránka:");
    expect(html).toContain("obchod@mnastrojarna.cz");
    expect(html).toContain("Poptávka hřídele");
    expect(html).toContain("bg-sky-500"); // barva poptávky (tečka nepřečteného / pruh)
    expect(html).toContain("Z-2026-001");
    expect(html).toContain("Založit zakázku");
    expect(html).not.toContain("Výhra"); // spam není ve „Vše"
    expect(html).not.toContain("Co AI zjistila");
    expect(html).not.toContain("Návrh připraven");
    expect(html).not.toContain("% AI");
    expect(html).not.toContain("Všechny schránky");
  });

  it("bez přiřazené schránky: vysvětlení, co dělat", () => {
    const html = render(<InboxView emails={[]} mailboxes={[]} scope="own" mailboxId={null} />);
    expect(html).toContain("Zatím nemáš přiřazenou e-mailovou schránku.");
    expect(html).toContain("Super admin ti ji přiřadí v sekci Uživatelé.");
  });

  it("super admin: přepínač schránek a AI shrnutí", () => {
    accessState.features = ["mail", "mail_all", "dashboard"];
    const html = render(<InboxView emails={emails} mailboxes={mailboxes} scope="all" mailboxId={null} />);
    expect(html).toContain("Všechny schránky");
    expect(html).toContain("Petra Obchodní");
    expect(html).toContain("bez vlastníka");
    expect(html).toContain("Co AI zjistila");
    expect(html).toContain("Zákazník poptává 50 ks hřídelí");
    expect(html).toContain("93% AI");
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
