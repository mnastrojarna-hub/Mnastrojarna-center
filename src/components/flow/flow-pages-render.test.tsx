import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { deriveFlow, menuActions, nextAction, type ActionCtx, type ChangeStamp, type FlowFacts } from "@/lib/jobs/flow-status";
import type { Feature } from "@/lib/auth/permissions";
import type { FlowJobState } from "./flow-state";

// Render řádků stránek toku bez Next.js: dílčí stavy, autor (text na všech šířkách), primární sloveso, mobilní třídy.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/inquiries",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/actions/flow-status", () => ({
  takeInquiry: vi.fn(), setInquiryStatus: vi.fn(), proposeFlowChange: vi.fn(), decideFlowProposal: vi.fn(), setQuoteState: vi.fn(),
  setOrderStatus: vi.fn(), requestOrderFix: vi.fn(), registerOrderChange: vi.fn(), decideOrderChange: vi.fn(),
}));
vi.mock("@/app/actions/flow-pages", () => ({ extendQuoteValidity: vi.fn() }));
vi.mock("@/app/actions/jobs", () => ({ newJobQuoteRevision: vi.fn(), updateJob: vi.fn(), setJobQuoteArchived: vi.fn() }));
vi.mock("@/app/actions/job-documents", () => ({ generateJobDocument: vi.fn(), sendJobDocument: vi.fn(), draftJobDocumentEmail: vi.fn() }));

const { FlowRowState } = await import("./flow-row-state");
const { FlowActionBar } = await import("./flow-actions");
const { QuotesBoard } = await import("./quotes-board");
const { toFlowQuote } = await import("./flow-data");

const TODAY = "2026-10-23";
const NOW = new Date("2026-10-23T10:00:00Z");
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

function facts(over: Partial<FlowFacts> = {}): FlowFacts {
  return {
    stage: "poptavka", inquiryStatus: "v_reseni", orderStatus: null, orderRevision: 0, orderConfirmedRevision: null,
    confirmationIssuedRevision: null, confirmationSentRevision: null, itemsCount: 1, itemsPriced: 0, itemsDelivered: 0, itemsPartial: 0,
    lastDeliveryAt: null, partialDeliveryAt: null, productionDone: 0, productionTotal: 0, deliveryNoteConfirmedAt: null,
    invoiceNumber: null, invoiceDueDate: null, paidAt: null, paidSoFar: 0, waitingSince: null, orderStatusChangedAt: null,
    pendingSupplierQuotes: 0, lostReason: null, proposal: null, hasOperations: false, hasPurchaseOrders: false, ...over,
  };
}
const stamp = (name: string | null, over: Partial<ChangeStamp> = {}): ChangeStamp => ({
  by: name ? { id: "u1", name } : null, byName: null, at: "2026-10-23T09:55:00Z", via: "rucne", kind: name ? "user" : "system", ...over,
});
function state(f: FlowFacts, features: Feature[], stamps: Partial<FlowJobState["stamps"]> = {}): FlowJobState {
  const s = deriveFlow(f, [], TODAY);
  const ctx: ActionCtx = { can: (x) => features.includes(x), userId: "u1", isSuperAdmin: false, assigneeId: f.assigneeId ?? null, assigneeName: f.assigneeName };
  return {
    jobId: "j1", facts: f, snapshot: s, quotes: [],
    stamps: { stage: null, inquiry: null, order: null, orderChange: null, confirmed: null, confirmationSent: null, lost: null, proposal: null, ...stamps },
    next: nextAction(f, s, ctx), menu: menuActions(f, s, ctx), canDecideProposal: features.includes("margins"),
  };
}
const SALES: Feature[] = ["workflow", "orders", "documents", "margins"];
const STAFF: Feature[] = ["workflow", "orders"];

describe("řádek stránky toku — dílčí stav a autor", () => {
  it("poptávka v řešení: chip + „V řešení · Petr Obchodník · před 5 min“ jako text (bez skrytí na mobilu)", () => {
    const html = renderToString(<FlowRowState state={state(facts({ assigneeName: "Petr Obchodník" }), SALES, { inquiry: stamp("Petr Obchodník") })} tab="inquiries" now={NOW} />);
    expect(html).toContain('data-flow-state="inquiry.v_reseni"');
    expect(text(html)).toContain("V řešení · Petr Obchodník · před 5 min");
    expect(html).toContain("text-[11px]");
    expect(html).not.toMatch(/hidden[^"]*sm:(inline|block|flex)/);
  });

  it("odmítnutá poptávka: důvod v chipu, autor z lost_*, AI za účet; smazaný účet nikdy prázdný", () => {
    const f = facts({ stage: "nerealizovano", inquiryStatus: "odmitnuta", lostReason: "kapacita" });
    let html = renderToString(<FlowRowState state={state(f, SALES, { lost: stamp("Jan Novák") })} tab="inquiries" now={NOW} />);
    expect(text(html)).toContain("Odmítnutá — Nestíháme (kapacita / termín)");
    expect(text(html)).toContain("Odmítnutá · Jan Novák");
    html = renderToString(<FlowRowState state={state(f, SALES, { lost: stamp(null, { byName: "Eva Stará", kind: "user" }) })} tab="inquiries" now={NOW} />);
    expect(text(html)).toContain("Eva Stará (účet zrušen)");
    html = renderToString(<FlowRowState state={state(f, SALES, { lost: stamp("Petr Obchodník", { kind: "ai", via: "ai" }) })} tab="inquiries" now={NOW} />);
    expect(text(html)).toContain("✨ AI za účet Petr Obchodník");
  });

  it("objednávka aktualizovaná rev 2: kdo změnu zapsal (foto); potvrzená: ✉ odesláno + kdo potvrdil", () => {
    const upd = facts({ stage: "ve_vyrobe", inquiryStatus: "zpracovana", orderStatus: "aktualizovana", orderRevision: 2, orderConfirmedRevision: 1, confirmationSentRevision: 1 });
    let html = renderToString(<FlowRowState state={state(upd, SALES, { orderChange: stamp("Petr Obchodník", { via: "foto" }) })} tab="confirmations" now={NOW} />);
    expect(text(html)).toContain("Aktualizovaná (rev 2)");
    expect(text(html)).toContain("Aktualizovaná rev 2 · Petr Obchodník");
    const ok = facts({ stage: "potvrzeno", inquiryStatus: "zpracovana", orderStatus: "potvrzena", orderRevision: 1, orderConfirmedRevision: 1, confirmationSentRevision: 1, hasOperations: true });
    html = renderToString(<FlowRowState state={state(ok, SALES, { confirmed: stamp("Jan Novák"), confirmationSent: stamp("Jan Novák", { via: "email" }) })} tab="confirmations" now={NOW} />);
    expect(html).toContain('data-flow-state="confirmation.odeslano"');
    expect(text(html)).toContain("Potvrzená · Jan Novák");
    expect(text(html)).toContain("Potvrzení odesláno · Jan Novák");
  });

  it("částečně dodaná: pilulka průběhu po položkách, nikdy součet kusů", () => {
    const f = facts({ stage: "ve_vyrobe", inquiryStatus: "zpracovana", orderStatus: "potvrzena", orderRevision: 1, orderConfirmedRevision: 1, confirmationSentRevision: 1, itemsCount: 3, itemsDelivered: 2 });
    const html = renderToString(<FlowRowState state={state(f, SALES)} tab="confirmations" now={NOW} />);
    expect(html).toContain('role="progressbar"');
    expect(text(html)).toContain("2/3 položek");
    expect(text(html)).not.toMatch(/\d+ ks/);
  });

  it("čekající návrh: duch s ✓ / ✕ jen pro toho, kdo smí rozhodnout", () => {
    const proposal = { phase: "inquiry" as const, to: "odmitnuta", reason: "kapacita" as const, kind: "user" as const, label: "Odmítnout poptávku — Nestíháme (kapacita / termín)" };
    const f = facts({ proposal });
    let html = renderToString(<FlowRowState state={state(f, SALES, { proposal: stamp("Pavel Dílna") })} tab="inquiries" now={NOW} />);
    expect(text(html)).toContain("Návrh: Odmítnout poptávku");
    expect(text(html)).toContain("Pavel Dílna");
    expect(html).toContain('aria-label="Přijmout návrh: Odmítnout poptávku');
    html = renderToString(<FlowRowState state={state(f, STAFF, { proposal: stamp("Pavel Dílna") })} tab="inquiries" now={NOW} />);
    expect(html).not.toContain("Přijmout návrh");
  });
});

describe("akce řádku", () => {
  it("primární tlačítko = sloveso (Převzít), menu se jménem zakázky, mobil min. 44 px", () => {
    const st = state(facts({ inquiryStatus: "prijata" }), SALES);
    const html = renderToString(<FlowActionBar target={{ jobId: "j1", jobNumber: "Z-2026-101", facts: st.facts, today: TODAY }} next={st.next} menu={st.menu} palette="sky.action" />);
    expect(text(html)).toContain("Převzít");
    expect(html).toContain("bg-sky-700 text-white hover:bg-sky-800");
    expect(html).not.toContain("hover:bg-foreground/90"); // barevné tlačítko při najetí nezmizí
    expect(html).toContain("min-h-11");
    expect(html).toContain('aria-label="Další akce Z-2026-101"');
    expect(html).not.toContain("Posunout");
  });

  it("Nacenit vede na /pricing?job=, ne do neexistující záložky", () => {
    // #25: Nacenění (pricing) má jen super admin
    const st = state(facts(), [...SALES, "pricing"]);
    expect(st.next?.key).toBe("pricing.open");
    const html = renderToString(<FlowActionBar target={{ jobId: "j1", jobNumber: "Z-2026-101", facts: st.facts, today: TODAY }} next={st.next} menu={st.menu} />);
    expect(html).toContain('href="/pricing?job=j1"');
  });

  it("doručená objednávka: Potvrdit objednávku; bez akce nic", () => {
    const st = state(facts({ stage: "objednavka", inquiryStatus: "zpracovana", orderStatus: "dorucena", orderRevision: 1 }), SALES);
    let html = renderToString(<FlowActionBar target={{ jobId: "j1", jobNumber: "Z-2026-104", facts: st.facts, today: TODAY }} next={st.next} menu={st.menu} />);
    expect(text(html)).toContain("Potvrdit objednávku");
    html = renderToString(<FlowActionBar target={{ jobId: "j1", jobNumber: "Z-1", today: TODAY }} next={null} menu={[]} />);
    expect(text(html).trim()).toBe("");
  });
});

describe("přehled nabídek", () => {
  const base = {
    id: "q1", number: "NAB-2026-031", revision: 2, title: "Hřídel", status: "odeslano" as const, total: 186000, currency: "CZK",
    validUntil: "2026-11-30", leadTimeDays: 21, deliveryTerms: null, paymentTerms: null, note: null,
    createdBy: { id: "u1", name: "Petr Obchodník" }, approvedBy: null, approvedAt: null, sentAt: "2026-10-20T08:00:00Z",
    createdAt: "2026-10-19T08:00:00Z", archived: false, aiGenerated: true, accepted: false, items: [],
    job: { id: "j3", number: "Z-2026-103", title: "Hřídel", stage: "nabidka" as const }, customer: null,
  };

  it("odeslaná AI nabídka: ✨, „Připravila AI“, „Odesláno e-mailem“, Zákazník objednal", () => {
    const facts = { id: "q1", number: "NAB-2026-031", revision: 2, status: "odeslano" as const, state: "odeslana" as const, approvedBy: "u9", approvalRequired: true, createdBy: "u1", archived: false, sentAt: base.sentAt, validUntil: base.validUntil, aiGenerated: true, supersededBy: null };
    const q = toFlowQuote(base, {
      id: "q1", facts, display: "odeslana", stateChangedAt: base.sentAt, lostReason: null, rejectedReason: null, feedback: null, competitorPrice: null,
      stamps: {
        created: stamp("Petr Obchodník", { kind: "ai", via: "ai" }), approvalRequested: null, approved: stamp("Super Admin"),
        sent: stamp("Super Admin", { via: "email" }), accepted: null, rejected: null,
      },
      next: { key: "quote.accept", label: "Zákazník objednal" }, menu: ["quote.feedback", "quote.reject"], proposal: null,
    }, { today: TODAY, onlyOpen: true });
    const html = renderToString(<QuotesBoard quotes={[q]} today={TODAY} counts={{ "quote.odeslana": 1 }} />);
    expect(text(html)).toContain("✨");
    expect(text(html)).toContain("Připravila AI · ✨ AI za účet Petr Obchodník");
    expect(text(html)).toContain("Schváleno · S. Admin");
    expect(text(html)).toContain("Odesláno e-mailem · S. Admin");
    expect(text(html)).toContain("Zákazník objednal");
    expect(html).toContain('aria-label="Další akce nabídky NAB-2026-031"');
    expect(html).toContain("bg-violet-700"); // primární tlačítko v odstínu nabídky (kontrast AA)
  });

  it("bez podrobných stavů z DB: stav ze staršího status, nic se nerozbije", () => {
    const q = toFlowQuote({ ...base, status: "ke_schvaleni", sentAt: null, aiGenerated: false }, null, { today: TODAY, onlyOpen: false });
    expect(q.display).toBe("ke_schvaleni");
    const html = renderToString(<QuotesBoard quotes={[q]} today={TODAY} counts={null} />);
    expect(text(html)).toContain("Neschválená"); // #25: štítek stavu ke_schvaleni
    expect(text(html)).toContain("Zadáno · P. Obchodník");
  });

  it("#25 neschválená nabídka kolegy: „Neschválená · připravil(a) Petr Obchodník“, vrácená „vráceno autorovi“ + důvod", () => {
    const facts = {
      id: "q1", number: "NAB-2026-031", revision: 1, status: "ke_schvaleni" as const, state: "ke_schvaleni" as const, approvedBy: null,
      approvalRequired: true, adminApprovalRequired: true, createdBy: "u1", archived: false, sentAt: null, validUntil: base.validUntil,
      aiGenerated: false, supersededBy: null, total: 186000,
    };
    const info = {
      id: "q1", facts, display: "ke_schvaleni" as const, stateChangedAt: null, lostReason: null, rejectedReason: null, feedback: null,
      competitorPrice: null, stamps: { created: stamp("Petr Obchodník"), approvalRequested: null, approved: null, sent: null, accepted: null, rejected: null },
      next: null, menu: [], proposal: null,
    };
    const pending = toFlowQuote({ ...base, status: "ke_schvaleni", sentAt: null, aiGenerated: false }, info, { today: TODAY, onlyOpen: true });
    let html = renderToString(<QuotesBoard quotes={[pending]} today={TODAY} counts={null} />);
    expect(text(html)).toContain("Neschválená · připravil(a) Petr Obchodník");
    expect(text(html)).toContain("čeká na schválení super admina — odeslat ji zatím nejde");
    const returned = toFlowQuote({ ...base, status: "ke_schvaleni", sentAt: null, aiGenerated: false }, {
      ...info, facts: { ...facts, returnedAt: "2026-10-23T09:00:00Z", returnNote: "Doplň cenu dopravy" },
    }, { today: TODAY, onlyOpen: true });
    html = renderToString(<QuotesBoard quotes={[returned]} today={TODAY} counts={null} />);
    expect(text(html)).toContain("Neschválená · vráceno autorovi");
    expect(text(html)).toContain("Vráceno k přepracování: Doplň cenu dopravy");
  });

  it("#25 prázdné Nabídky: ne-admin bez odkazu do Nacenění", () => {
    let html = renderToString(<QuotesBoard quotes={[]} today={TODAY} counts={null} />);
    expect(html).not.toContain('href="/pricing"');
    expect(text(html)).toContain("Nabídka vznikne v kartě zakázky v záložce Nabídky (tlačítko „Vytvořit nabídku“ u poptávky).");
    html = renderToString(<QuotesBoard quotes={[]} today={TODAY} counts={null} canPrice />);
    expect(html).toContain('href="/pricing"');
  });

  it("#25 „Vytvořit nabídku“ bez práva na Nacenění vede rovnou do editoru nabídky", () => {
    const st = state(facts({ itemsPriced: 1 }), SALES);
    const html = renderToString(<FlowActionBar target={{ jobId: "j1", jobNumber: "Z-2026-101", facts: st.facts, today: TODAY }} next={{ key: "quote.create", label: "Vytvořit nabídku" }} menu={[]} />);
    expect(html).toContain('href="/orders/j1?tab=nabidky&amp;nova=1"');
    const admin = renderToString(<FlowActionBar target={{ jobId: "j1", jobNumber: "Z-2026-101", facts: st.facts, today: TODAY }} next={{ key: "quote.create", label: "Vytvořit nabídku" }} menu={[]} canPrice />);
    expect(admin).toContain('href="/pricing?job=j1"');
  });
});

describe("#25 zamčené dokumenty", async () => {
  const { DocumentsBrowser } = await import("./documents-browser");
  const f = (over: Record<string, unknown>) => ({
    id: "f1", kind: "naceneni" as const, title: "Nabídka Kalírna", filename: "kalirna.pdf", mimeType: "application/pdf", sizeBytes: 1000,
    version: 1, archived: false, note: null, createdAt: "2026-10-22T10:00:00Z", uploadedBy: "Pavel Dílna", hasAiData: false,
    job: { id: "j1", number: "Z-2026-101", title: "Hřídel", customerName: "Strojmetal" }, flow: null, ...over,
  });

  it("nákupní doklad bez práva: řádek s textem, bez náhledu, otevření a stažení; neschválená / zastaralá nabídka", () => {
    const html = renderToString(<DocumentsBrowser today={TODAY} files={[
      f({ locked: "price" }),
      f({ id: "f2", kind: "nabidka", title: "NAB-1", locked: "unapproved" }),
      f({ id: "f3", kind: "nabidka", title: "NAB-2", locked: "stale" }),
      f({ id: "f4", kind: "vykres", title: "Výkres", locked: null }),
    ]} />);
    expect(text(html)).toContain("Nákupní doklad — obsah vidí obchodník a super admin.");
    expect(text(html)).toContain("Neplatné — čeká na schválení");
    expect(text(html)).toContain("Neplatné — vzniklo před schválením");
    expect(html).toContain('data-locked="price"');
    for (const id of ["f1", "f2", "f3"]) expect(html).not.toContain(`/api/jobs/files/${id}`);
    expect(html).toContain('href="/api/jobs/files/f4?download=1"');
    expect(text(html)).toContain("Nabídka Kalírna");
    expect(text(html)).toContain("Z-2026-101");
  });
});

describe("#25 lišta rozsahu a proužek toku", async () => {
  const { FlowScopeBar } = await import("./flow-scope-bar");
  const { FlowStrip } = await import("./flow-header");

  it("ne-admin bez schránky: poznámka + odkaz Kniha zakázek; chyba = vlastní text", () => {
    let html = renderToString(<FlowScopeBar scope={{ canToggle: false, who: "moje", error: false, mailboxEmails: [] }} />);
    expect(text(html)).toContain("Vidíš jen svoje: zakázky, kde jsi obchodník nebo je zpracováváš, a ty, které jsi založil(a). Nemáš přiřazenou e-mailovou schránku — požádej super admina.");
    expect(html).toContain('href="/orders"');
    html = renderToString(<FlowScopeBar scope={{ canToggle: false, who: "moje", error: true, mailboxEmails: [] }} />);
    expect(text(html)).toContain("Tvoje zakázky se nepodařilo načíst — obnov stránku.");
    expect(html).toContain('role="alert"');
  });

  it("super admin: „Všichni“ / „Jen moje“ (aria Koho zobrazit), v „Jen moje“ návrat na Všichni", () => {
    let html = renderToString(<FlowScopeBar scope={{ canToggle: true, who: "vsichni", error: false, mailboxEmails: [] }} />);
    expect(html).toContain('aria-label="Koho zobrazit"');
    expect(text(html)).toContain("Všichni");
    expect(text(html)).toContain("Jen moje");
    expect(text(html)).not.toContain("Zobrazuješ jen svoje");
    html = renderToString(<FlowScopeBar scope={{ canToggle: true, who: "moje", error: false, mailboxEmails: [] }} />);
    expect(text(html)).toContain("Zobrazuješ jen svoje — přepnout na Všichni");
    expect(html).toMatch(/aria-checked="true"[^>]*>.*?Jen moje/);
  });

  it("proužek toku: krok Nacenění jen s právem", () => {
    expect(renderToString(<FlowStrip current="poptavka" />)).not.toContain('href="/pricing"');
    expect(renderToString(<FlowStrip current="poptavka" canPrice />)).toContain('href="/pricing"');
  });
});
