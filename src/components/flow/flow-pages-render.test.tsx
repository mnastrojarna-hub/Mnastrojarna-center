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
    const st = state(facts(), SALES);
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
    expect(text(html)).toContain("Čeká na schválení");
    expect(text(html)).toContain("Zadáno · P. Obchodník");
  });
});
