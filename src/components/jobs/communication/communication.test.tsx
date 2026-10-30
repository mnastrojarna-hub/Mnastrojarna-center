import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders/j1",
}));
vi.mock("@/app/actions/jobs", () => ({ updateJob: vi.fn(), addJobComment: vi.fn(), saveJobItems: vi.fn() }));
vi.mock("@/app/actions/mail", () => ({ createJobFromEmail: vi.fn(), setEmailCategory: vi.fn() }));
vi.mock("@/app/actions/mail-inbox", () => ({
  openThreadAction: vi.fn(() => new Promise(() => {})), markThreadReadAction: vi.fn(), setThreadFlagAction: vi.fn(), setThreadPriorityAction: vi.fn(),
  shareCandidatesAction: vi.fn(() => new Promise(() => {})), shareThreadAction: vi.fn(), runAiOnThreadAction: vi.fn(),
}));
vi.mock("@/app/actions/mail-compose", () => ({
  composeContextAction: vi.fn(() => new Promise(() => {})), prepareMailUploadAction: vi.fn(), sendComposedAction: vi.fn(), searchRecipientsAction: vi.fn(), saveSignatureAction: vi.fn(),
}));
vi.mock("@/app/actions/mail-jobs", () => ({
  getJobCommunicationAction: vi.fn(), confirmJobSuggestionAction: vi.fn(), rejectJobSuggestionAction: vi.fn(), setThreadJobAction: vi.fn(),
  searchJobsForMailAction: vi.fn(() => Promise.resolve([])), undoMailChangeAction: vi.fn(), applyMailChangeAction: vi.fn(), dismissMailChangeAction: vi.fn(),
  copyThreadAttachmentsAction: vi.fn(), backfillMailJobsAction: vi.fn(),
}));
vi.mock("@/lib/jobs/upload-client", () => ({ uploadJobFiles: vi.fn(), uploadJobFile: vi.fn() }));

import { JobDetailProvider } from "@/components/jobs/detail/detail-context";
import { HistoryTab } from "@/components/jobs/detail/history-tab";
import { ThreadRow } from "@/components/mail/thread-row";
import { JobLinkBar } from "@/components/mail/job-link-bar";
import { JobMailProvider } from "./job-mail-context";
import { CommunicationTab } from "./communication-tab";
import { MailChangeCard } from "./mail-change-card";
import { MailOverridesPanel } from "./mail-overrides-panel";
import type { JobCommunication, JobMailChangeView } from "@/lib/data/job-mail";
import type { ThreadSummary } from "@/lib/email/mail-types";
import type { JobEvent } from "@/lib/jobs/types";

const html = (n: React.ReactNode) => renderToString(n).replace(/<!-- -->/g, "");
const flat = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const change = (over: Partial<JobMailChangeView> = {}): JobMailChangeView => ({
  id: "c1", kind: "change", field: "heat", label: "Tepelné zpracování", summary: "Tepelné zpracování: kalení", valueNew: "kalení", valuePrev: "bez TZ",
  drawingValue: "bez TZ", quote: "prosím kalit, a 30 ks místo 20.", status: "applied", party: "customer", fromName: "Jan Dvořák",
  mailAt: "2026-10-29T10:00:00Z", badge: "Pokyn zákazníka z e-mailu 29. 10. 2026 — nadřazeno výkresu", itemId: "i1", itemLabel: "H-200 · Hřídel",
  emailId: "e1", threadId: "t1", appliedKind: "ai", createdAt: "2026-10-29T10:01:00Z", hold: null, holdJobNumber: null, mailOld: null, ...over,
});

const thread: ThreadSummary = {
  threadId: "t1", emailId: "e1", mailboxId: "m1", direction: "in", from: "Jan Dvořák", fromEmail: "jan@firma.cz", subject: "Re: Nabídka H-200",
  preview: "prosím kalit", category: "K zakázce", aiConfidence: 0, lastAt: "2026-10-29T10:00:00Z", hasDraft: false, messageCount: 2, unreadCount: 1,
  flagged: false, priority: 2, priorityManual: false, hasAttachments: true, aiPending: false, jobId: "j1", jobNumber: "Z-2026-013",
  jobTitle: "Hřídel H-200", jobLinkSource: "reply", jobLinkActor: "ai",
};

const comm = (over: Partial<JobCommunication> = {}): JobCommunication => ({
  jobId: "j1", jobNumber: "Z-2026-013", canMail: true, threads: [thread],
  suggestions: [{ id: "s1", threadId: "t2", subject: "Dotaz k termínu", from: "Jan Dvořák", at: "2026-10-29T09:00:00Z", score: 0.6, reasons: ["jediná otevřená zakázka firmy"] }],
  changes: [change(), change({ id: "c2", field: "quantity", label: "Počet kusů", summary: "Počet kusů: 30 ks (místo 20 ks)", valueNew: "30 ks", valuePrev: "20 ks", drawingValue: "20 ks", status: "suggested", appliedKind: null }),
    change({ id: "c3", kind: "tag", field: "heat", summary: "Štítek „kalení“", valueNew: "kalení", status: "suggested", badge: null, itemId: null, itemLabel: null })],
  contact: { email: "nakup@firma.cz", name: "Jan Dvořák" }, pendingFiles: 1, ...over,
});

const PERMS = { canDelete: false, margins: true, aiCapture: false };
const OPTIONS = { users: [], customers: [], suppliers: [] };
const wrap = (node: React.ReactNode, data: JobCommunication | null = comm()) => (
  <JobDetailProvider jobId="j1" perms={PERMS} options={OPTIONS}>
    <JobMailProvider jobId="j1" initial={data}>{node}</JobMailProvider>
  </JobDetailProvider>
);

describe("změna z e-mailu", () => {
  it("propsaná: odznak „nadřazeno výkresu“, výkres přeškrtnutý, Vrátit", () => {
    const h = html(<MailChangeCard c={change()} onUndo={() => {}} />);
    expect(h).toContain('data-testid="override-badge"');
    expect(flat(h)).toContain("Pokyn zákazníka z e-mailu 29. 10. 2026 — nadřazeno výkresu");
    expect(h).toMatch(/line-through[^"]*" data-testid="override-drawing">bez TZ</);
    expect(h).toContain('data-testid="override-undo"');
    expect(flat(h)).toContain("„prosím kalit, a 30 ks místo 20.“");
  });
  it("návrh: Propsat do položky / Zahodit; štítek: Přidat štítek; vrácená: Znovu propsat", () => {
    expect(flat(html(<MailChangeCard c={change({ status: "suggested" })} onApply={() => {}} onDismiss={() => {}} />))).toMatch(/Propsat do položky.*Zahodit/);
    expect(flat(html(<MailChangeCard c={change({ kind: "tag", valueNew: "kalení", status: "suggested" })} onApply={() => {}} />))).toContain("Přidat štítek");
    const undone = html(<MailChangeCard c={change({ status: "undone" })} onApply={() => {}} onUndo={() => {}} />);
    expect(flat(undone)).toContain("Znovu propsat");
    expect(undone).not.toContain('data-testid="override-undo"');
    // dodavatel: bez odznaku (položku nemění)
    expect(html(<MailChangeCard c={change({ kind: "info", party: "supplier", badge: null, status: "info" })} />)).not.toContain("override-badge");
  });
  it("jen návrh: „X místo Y“ nesedí / e-mail jmenuje jinou zakázku — bez odznaku, s důvodem", () => {
    const mis = html(<MailChangeCard c={change({
      field: "material", summary: "Materiál: 1.4301 (místo 1.4305)", valueNew: "1.4301", valuePrev: "11 523", status: "suggested", hold: "mismatch", mailOld: "1.4305",
    })} onApply={() => {}} onDismiss={() => {}} />);
    expect(mis).toContain('data-testid="change-hold"');
    expect(flat(mis)).toContain("e-mail: 1.4301 místo 1.4305, na položce je 11 523");
    expect(mis).not.toContain('data-testid="override-badge"');
    expect(flat(mis)).toContain("Propsat do položky");
    const other = html(<MailChangeCard c={change({ status: "suggested", hold: "other_job", holdJobNumber: "Z-2026-010" })} onApply={() => {}} />);
    expect(flat(other)).toContain("E-mail jmenuje i zakázku Z-2026-010");
    // propsané změny důvod nemají
    expect(html(<MailChangeCard c={change({ hold: "mismatch", mailOld: "x" })} onUndo={() => {}} />)).not.toContain("change-hold");
  });
  it("nahrazeno ruční úpravou: bez odznaku, bez Vrátit, jde Znovu propsat; v Položkách není", () => {
    const h = html(<MailChangeCard c={change({ status: "replaced" })} onUndo={() => {}} onApply={() => {}} />);
    expect(flat(h)).toContain("Nahrazeno ruční úpravou");
    expect(h).not.toContain('data-testid="override-undo"');
    expect(h).not.toContain('data-testid="override-badge"');
    expect(flat(h)).toContain("Znovu propsat");
    const panel = html(wrap(<MailOverridesPanel />, comm({ changes: [change({ status: "replaced" })] })));
    expect(panel).not.toContain("mail-overrides");
  });
  it("Položky: panel pokynů z e-mailu jen se změnami položek", () => {
    const h = html(wrap(<MailOverridesPanel />));
    expect(h).toContain('data-testid="mail-overrides"');
    expect((h.match(/data-testid="mail-override"/g) ?? []).length).toBe(2); // propsaná + návrh, štítek ne
    expect(html(wrap(<MailOverridesPanel />, comm({ changes: [] })))).not.toContain("mail-overrides");
  });
});

describe("záložka Komunikace", () => {
  it("vlákna, návrhy „Patří sem“, změny, nová zpráva na kontakt, přílohy do dokumentů", () => {
    const h = html(wrap(<CommunicationTab job={{ id: "j1", number: "Z-2026-013", title: "Hřídel" }} />));
    expect(h).toContain('data-testid="job-communication"');
    expect(h).toContain('data-testid="job-mail-suggestions"');
    expect(flat(h)).toContain("Dotaz k termínu");
    expect(h).toContain('data-testid="suggestion-yes"');
    expect(h).toContain('data-testid="job-mail-changes"');
    expect(flat(h)).toContain("2 čeká"); // návrh počtu + návrh štítku
    expect(h).toContain('data-testid="job-threads"');
    expect(flat(h)).toContain("Re: Nabídka H-200");
    expect(h).not.toContain('data-testid="row-job-chip"'); // v zakázce chip zakázky nepotřebuje
    expect(flat(h)).toContain("Nová zpráva — Jan Dvořák");
    expect(flat(h)).toContain("Uložit přílohy do dokumentů (1)");
    expect(flat(h)).toContain("pokyn zákazníka z e-mailu je nadřazený výkresu");
  });
  it("bez pošty (cizí schránka): vlákna ne, změny ano; prázdná komunikace s odkazem do pošty", () => {
    const h = html(wrap(<CommunicationTab job={{ id: "j1", number: "Z-2026-013", title: "Hřídel" }} />, comm({ canMail: false, threads: [], suggestions: [] })));
    expect(h).not.toContain('data-testid="job-threads"');
    expect(h).not.toContain('data-testid="job-compose"');
    expect(flat(h)).toContain("Poštu vidí jen ten, komu patří schránka");
    expect(h).toContain('data-testid="job-mail-changes"');
    const empty = html(wrap(<CommunicationTab job={{ id: "j1", number: "Z-2026-013", title: "Hřídel" }} />, comm({ threads: [], suggestions: [], changes: [] })));
    expect(empty).toContain('data-testid="job-mail-empty"');
    expect(empty).toContain('href="/inbox?slozka=jobs"');
  });
});

describe("pošta: zakázka vlákna a návrh", () => {
  it("řádek: chip zakázky s AI, návrh „Patří k …?“ s Ano / Ne", () => {
    const linked = html(<ThreadRow t={thread} active={false} canAi={false} showMailbox={false} onOpen={() => {}} onFlag={() => {}} onPriority={() => {}} />);
    expect(linked).toContain('data-testid="row-job-chip"');
    expect(linked).toContain("Přiřazeno: odpověď (automaticky)");
    const sugg = { ...thread, jobId: undefined, jobNumber: undefined, suggestion: { id: "s1", jobId: "j2", jobNumber: "Z-2026-014", jobTitle: "Příruba", score: 0.6 } };
    const h = html(<ThreadRow t={sugg} active={false} canAi={false} showMailbox={false} onOpen={() => {}} onFlag={() => {}} onPriority={() => {}} onSuggestion={() => {}} />);
    expect(flat(h)).toContain("Patří k Z-2026-014? Příruba");
    expect(h).toContain('data-testid="row-suggestion-yes"');
    expect(h).toContain('data-testid="row-suggestion-no"');
  });
  it("fix 3: odpověď čekající na otázku neukazuje kategorii z pravidel „Nabídka dodavatele“, ale „K zakázce?“", () => {
    const asking = { ...thread, category: "Nabídka dodavatele" as const, suggestion: { id: "s1", jobId: "j2", jobNumber: "Z-2026-014", score: 0.9, forMessage: true, emailId: "e1" } };
    const h = flat(html(<ThreadRow t={asking} active={false} canAi={false} showMailbox={false} onOpen={() => {}} onFlag={() => {}} onPriority={() => {}} onSuggestion={() => {}} />));
    expect(h).toContain("K zakázce?");
    expect(h).not.toContain("Nabídka dodavatele");
    // otázka k jiné (starší) zprávě vlákna: řádek ukazuje poslední zprávu → její kategorie platí
    const other = { ...asking, suggestion: { ...asking.suggestion, emailId: "e0" } };
    expect(flat(html(<ThreadRow t={other} active={false} canAi={false} showMailbox={false} onOpen={() => {}} onFlag={() => {}} onPriority={() => {}} />))).toContain("Nabídka dodavatele");
    // po rozhodnutí (bez otázky) zase skutečná kategorie
    expect(flat(html(<ThreadRow t={{ ...asking, suggestion: undefined }} active={false} canAi={false} showMailbox={false} onOpen={() => {}} onFlag={() => {}} onPriority={() => {}} />))).toContain("Nabídka dodavatele");
  });
  it("detail vlákna: zakázka (Změnit / Odpojit), návrh (Ano / Ne / Jiná), bez zakázky (Založit / Přiřadit)", () => {
    const base = { threadId: "t1", canCreate: true, creating: false, onCreate: () => {}, onChanged: () => {}, onError: () => {} };
    const linked = html(<JobLinkBar {...base} jobId="j1" jobNumber="Z-2026-013" jobTitle="Hřídel" linkSource="thread" linkActor="ai" />);
    expect(linked).toContain('href="/orders/j1?tab=komunikace"');
    expect(flat(linked)).toContain("přiřazeno automaticky · vlákno");
    expect(linked).toContain('data-testid="thread-job-change"');
    expect(linked).toContain('data-testid="thread-job-unlink"');
    const sugg = html(<JobLinkBar {...base} suggestion={{ id: "s1", jobId: "j2", jobNumber: "Z-2026-014", score: 0.6 }} />);
    expect(flat(sugg)).toMatch(/Patří k Z-2026-014 ?\?/);
    expect(sugg).toContain('data-testid="thread-suggestion-yes"');
    const none = html(<JobLinkBar {...base} />);
    expect(flat(none)).toMatch(/Založit zakázku.*Přiřadit k zakázce/);
  });
});

describe("historie: e-maily a poznámky", () => {
  const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  it("„Z e-mailu od …“ s odznakem a výkresem přeškrtnutým; poznámka celým textem a filtr Poznámky", () => {
    const events: JobEvent[] = [
      { id: "1", type: "email", message: "Z e-mailu od Jan Dvořák: Tepelné zpracování: kalení — pokyn zákazníka, nadřazeno výkresu", actor: null, actorKind: "ai", agent: "mail-job", createdAt: ago(5),
        data: { action: "mail_change", applied: true, drawingValue: "bez TZ", valuePrev: "bez TZ", field: "heat" } },
      { id: "2", type: "field", message: "Interní poznámka: — → Pozor: kalit vakuově", actor: { id: "u1", name: "Adam" }, actorKind: "user", createdAt: ago(3),
        data: { changes: [{ field: "note", label: "Interní poznámka", from: null, to: "Pozor: kalit vakuově", fromText: "—", toText: "Pozor: kalit vakuově" }] } },
      { id: "3", type: "field", message: "Termín: x → y", actor: null, createdAt: ago(1), data: { changes: [{ field: "due_date", label: "Termín", fromText: "1. 11.", toText: "5. 11." }] } },
    ];
    const h = html(<JobDetailProvider jobId="j1" perms={PERMS} options={OPTIONS}><HistoryTab events={events} /></JobDetailProvider>);
    expect(h).toContain('data-testid="history-mail-event"');
    expect(flat(h)).toContain("nadřazeno výkresu");
    expect(h).toMatch(/výkres: <span class="line-through">bez TZ<\/span>/);
    expect(h).toContain('data-testid="history-note"');
    expect(flat(h)).toContain("Pozor: kalit vakuově");
    expect(flat(h)).toContain("Poznámky &amp; štítky");
  });
});
