import { describe, it, expect } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { nextChipSelection } from "@/components/flow-status/count-chips";
import { czWaits } from "@/components/flow/quote-approval-copy";
import {
  ActorStamp, CountChips, FlowStatusChip, NextActionButton, ProgressPill, ProposalChip, QuoteApprovalFlag, ReasonDialog, StateChip, StateMenu,
} from "@/components/flow-status";
import {
  DELIVERY_STATES, FLOW_PALETTE, INQUIRY_STATES, QUOTE_STATES, chipsForTab, deriveFlow, primaryChip, quoteApprovalFlag, type FlowFacts, type QuoteFacts,
} from "@/lib/jobs/flow-status";

// Smoke test sdílených komponent podrobných stavů (bez Next.js runtime): render na serveru, texty, role a třídy.
const html = (el: React.ReactElement) => renderToString(el);
const text = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, "\"");

const facts: FlowFacts = {
  stage: "ve_vyrobe", inquiryStatus: "zpracovana", orderStatus: "potvrzena", orderRevision: 1, orderConfirmedRevision: 1,
  confirmationIssuedRevision: 1, confirmationSentRevision: 1, itemsCount: 3, itemsPriced: 3, itemsDelivered: 2, itemsPartial: 0,
  lastDeliveryAt: "2026-10-22T08:00:00Z", partialDeliveryAt: null, productionDone: 2, productionTotal: 4,
  deliveryNoteConfirmedAt: null, invoiceNumber: null, invoiceDueDate: null, paidAt: null, paidSoFar: 0, waitingSince: null,
  orderStatusChangedAt: null, pendingSupplierQuotes: 0, lostReason: null, proposal: null, hasOperations: true, hasPurchaseOrders: false,
};

describe("komponenty podrobných stavů", () => {
  it("StateChip: ikona + text + doplněk, paleta; tlačítko jen s onClick", () => {
    const s = html(<StateChip meta={INQUIRY_STATES.ceka_na_podklady} hint="čeká 3 dny" />);
    expect(text(s)).toContain("Čeká na podklady");
    expect(text(s)).toContain("· čeká 3 dny");
    expect(s).toContain("<svg");
    expect(s).toContain("border-dashed");
    expect(s.startsWith("<span")).toBe(true);
    const b = html(<StateChip meta={INQUIRY_STATES.prijata} onClick={() => undefined} />);
    expect(b.startsWith("<button")).toBe(true);
    expect(b).toContain('type="button"');
    expect(html(<StateChip meta={INQUIRY_STATES.v_reseni} short />)).toContain("Řeší se");
    expect(html(<StateChip meta={INQUIRY_STATES.v_reseni} ai />)).toContain("✨");
  });

  it("FlowStatusChip z primaryChip s pilulkou průběhu (po položkách)", () => {
    const chip = primaryChip(facts, deriveFlow(facts, [], "2026-10-23"))!;
    expect(chip.meta).toBe(DELIVERY_STATES.castecne);
    const s = html(<FlowStatusChip chip={chip} />);
    expect(text(s)).toContain("Částečně dodáno");
    expect(s).toContain('role="progressbar"');
    expect(s).toContain('aria-valuenow="67"');
    expect(text(s)).toContain("2/3 položek");
    expect(s).toContain("bg-green-500");
  });

  it("ProgressPill bez textu", () => {
    const s = html(<ProgressPill progress={{ done: 1, total: 4, pct: 25, label: "1/4 operací" }} hue="yellow" showLabel={false} />);
    expect(s).toContain("width:25%");
    expect(s).toContain("bg-yellow-500");
    expect(text(s)).toBe("");
  });

  it("ActorStamp: viditelný text „jméno · kdy“ (i na mobilu), detail až po ťuknutí", () => {
    const now = new Date("2026-10-23T10:00:00Z");
    const s = html(<ActorStamp stamp={{ by: { id: "u1", name: "Petr Obchodník" }, byName: null, at: "2026-10-23T09:55:00Z", via: "rucne", kind: "user" }} verb="V řešení" now={now} />);
    expect(text(s)).toBe("V řešení · Petr Obchodník · před 5 min");
    expect(s).toContain("text-[11px]");
    expect(s).toContain('aria-haspopup="menu"');
    expect(html(<ActorStamp stamp={null} />)).toBe("");
    const ai = html(<ActorStamp stamp={{ by: null, byName: null, at: null, via: "ai", kind: "ai", agent: "email-ingest" }} />);
    expect(text(ai)).toBe("✨ AI (e-mail)");
  });

  it("StateMenu: tlačítko „⋯“ s popiskem; prázdné akce nic", () => {
    const s = html(<StateMenu actions={["inquiry.take", "inquiry.decline", "job.correct"]} onAction={() => undefined} />);
    expect(s).toContain('aria-label="Další akce"');
    expect(html(<StateMenu actions={[]} onAction={() => undefined} />)).toBe("");
  });

  it("CountChips: otevřené s počty, uzavřené ve „Více“", () => {
    const chips = chipsForTab("inquiries", { "inquiry.prijata": 3, "inquiry.v_reseni": 2, "inquiry.odmitnuta": 1 });
    const s = html(<CountChips chips={chips} selected={["prijata", "v_reseni", "ceka_na_podklady"]} onChange={() => undefined} />);
    const t = text(s);
    expect(t).toContain("Otevřené5");
    expect(t).toContain("Přijatá3");
    expect(t).toContain("Více");
    expect(t).not.toContain("Odmítnutá");
    expect(s).toContain('aria-pressed="true"');
    // ve výchozím „Otevřené" jsou členské chipy obrysové (aktivní jen předvolba), nulové ztlumené
    expect(s).not.toContain(FLOW_PALETTE["sky.action"].solid);
    expect(s).toMatch(/aria-pressed="false"[^>]*opacity-70[^>]*>.*Čeká na podklady/);
    expect(s).toContain("sticky top-0");
    // jeden vybraný stav = plný chip v barvě stavu
    const one = html(<CountChips chips={chips} selected={["prijata"]} onChange={() => undefined} />);
    expect(one).toContain(FLOW_PALETTE["sky.action"].solid);
  });

  it("CountChips: z „Otevřené“ jedno ťuknutí = jen ten stav, jinak přidat / odebrat", () => {
    const open = ["prijata", "v_reseni", "ceka_na_podklady"];
    expect(nextChipSelection(open, "v_reseni", open)).toEqual(["v_reseni"]);
    expect(nextChipSelection(["v_reseni"], "prijata", open)).toEqual(["v_reseni", "prijata"]);
    expect(nextChipSelection(["v_reseni", "prijata"], "v_reseni", open)).toEqual(["prijata"]);
    // uzavřený stav z „Více“ se k otevřeným přidá
    expect(nextChipSelection(open, "odmitnuta", open)).toEqual([...open, "odmitnuta"]);
    // jediný otevřený stav není „předvolba“ — chová se jako přepínač
    expect(nextChipSelection(["a"], "a", ["a"])).toEqual([]);
  });

  it("ProposalChip: duch + ✓/✕ jen pro rozhodujícího", () => {
    const p = { phase: "inquiry" as const, to: "odmitnuta", kind: "user" as const, label: "Odmítnout poptávku — Nestíháme (kapacita / termín)", reason: "kapacita" as const };
    const stamp = { by: { id: "u2", name: "Pavel Dílna" }, byName: null, at: null, via: "rucne" as const, kind: "user" as const };
    const s = html(<ProposalChip proposal={p} stamp={stamp} canDecide onDecide={() => undefined} />);
    expect(text(s)).toContain("Návrh: Odmítnout poptávku — Nestíháme (kapacita / termín)navrhuje: Pavel Dílna");
    expect(s).toContain("min-w-0 max-w-full"); // v úzkém sloupci se zkrátí, nepřeteče
    expect(s).toContain('aria-label="Přijmout návrh: Odmítnout poptávku — Nestíháme (kapacita / termín)"');
    expect(s).toContain('aria-label="Zamítnout návrh: Odmítnout poptávku — Nestíháme (kapacita / termín)"');
    expect(s).toContain("border-dashed");
    const ro = html(<ProposalChip proposal={p} stamp={stamp} canDecide={false} />);
    expect(ro).not.toContain("Přijmout návrh");
  });

  it("NextActionButton: odkaz / přímá akce / nic", () => {
    const link = html(<NextActionButton action={{ key: "pricing.open", label: "Nacenit" }} jobId="j1" />);
    expect(link).toContain('href="/orders/j1?tab=items"');
    expect(text(link)).toContain("Nacenit");
    const direct = html(<NextActionButton action={{ key: "inquiry.take", label: "Převzít od Jan Novák" }} jobId="j1" onRun={() => ({ ok: true })} palette="sky.action" />);
    expect(direct).toContain("<button");
    expect(text(direct)).toContain("Převzít od Jan Novák");
    // kontrast ≥ 4,5 : 1 a hover celým literálem (přebije hover:bg-foreground/90 výchozí varianty)
    expect(direct).toContain("bg-sky-700 text-white hover:bg-sky-800");
    expect(direct).not.toContain("hover:bg-foreground/90");
    expect(direct).toContain('role="status"');
    expect(html(<NextActionButton action={null} jobId="j1" />)).toBe("");
  });

  it("ReasonDialog zavřený nic nevykreslí", () => {
    expect(html(<ReasonDialog open={false} onOpenChange={() => undefined} title="Odmítnout" phase="inquiry" to="odmitnuta" onConfirm={() => undefined} />)).toBe("");
  });

  it("#25 QuoteApprovalFlag: čeká / vráceno / schváleno, krátký text pod sm, celý v title", () => {
    const q = (over: Partial<QuoteFacts>): QuoteFacts => ({
      id: "q1", number: "NAB-2026-040", revision: 1, status: "ke_schvaleni", state: "ke_schvaleni", approvedBy: null, approvalRequired: true,
      createdBy: "u2", archived: false, sentAt: null, validUntil: null, aiGenerated: false, supersededBy: null, adminApprovalRequired: true, ...over,
    });
    const pending = html(<QuoteApprovalFlag flag={quoteApprovalFlag([q({})])} />);
    expect(pending).toContain('data-approval="pending"');
    expect(pending).toContain("Neschválená — čeká na schválení super admina");
    expect(pending).toMatch(/class="[^"]*sm:hidden[^"]*">Neschválená</);
    expect(pending).toContain('title="Nabídka NAB-2026-040 čeká na schválení super admina — do té doby ji nejde odeslat zákazníkovi."');
    expect(pending).toContain("<svg");
    expect(pending).toContain("bg-amber-50");
    const short = html(<QuoteApprovalFlag flag={quoteApprovalFlag([q({})])} short />);
    expect(text(short)).toBe("Neschválená");
    // wrap = celý text i na mobilu (zalomí se); iconOnly = jen ikona, text pro čtečky a v title
    const wrapped = html(<QuoteApprovalFlag flag={quoteApprovalFlag([q({})])} wrap />);
    expect(text(wrapped)).toBe("Neschválená — čeká na schválení super admina");
    expect(wrapped).toContain("whitespace-normal");
    expect(wrapped).not.toContain("sm:hidden");
    const icon = html(<QuoteApprovalFlag flag={quoteApprovalFlag([q({})])} iconOnly />);
    expect(icon).toMatch(/<span class="sr-only">Nabídka NAB-2026-040 čeká na schválení super admina/);
    expect(icon).toContain("<svg");

    const returned = html(<QuoteApprovalFlag flag={quoteApprovalFlag([q({ returnedAt: "2026-10-23T09:00:00Z", returnNote: "Doplň výkres" })])} suffix="— S. Admin · 23. 10. 2026" />);
    expect(returned).toContain('data-approval="returned"');
    expect(text(returned)).toContain("Vráceno k přepracování: Doplň výkres — S. Admin · 23. 10. 2026");
    expect(returned).toMatch(/sm:hidden[^"]*">Vráceno</);

    const approved = html(<QuoteApprovalFlag flag={quoteApprovalFlag([q({ state: "schvalena", approvedBy: "u9" })], { author: "Petr Obchodník", approver: "Jan Semorád", at: "2026-10-23T10:00:00Z" })} />);
    expect(approved).toContain('data-approval="approved"');
    expect(text(approved)).toBe("Připravil(a) P. Obchodník · Schválil J. Semorád · 23. 10. 2026");
    expect(approved).toContain("bg-emerald-50");
    expect(html(<QuoteApprovalFlag flag={null} />)).toBe("");
    // withNumber: štítek místo chipu stavu nabídky nese i číslo
    expect(text(html(<QuoteApprovalFlag flag={quoteApprovalFlag([q({})])} short withNumber />))).toBe("Neschválená · NAB-2026-040");
  });

  it("#25 review: chip „Neschválená“ všude jantarový se štítem (ne fialový jako „Schválená“)", () => {
    const pending = html(<StateChip meta={QUOTE_STATES.ke_schvaleni} hint="NAB-2026-040" />);
    expect(pending).toContain("bg-amber-50");
    expect(pending).toContain("ring-amber-400");
    expect(pending).not.toContain("ring-violet-400");
    expect(pending).toContain("lucide-shield-alert");
    const approved = html(<StateChip meta={QUOTE_STATES.schvalena} />);
    expect(approved).not.toContain("bg-amber-50");
    expect(approved).not.toContain("lucide-shield-alert");
  });

  it("#25 review: shoda čeká / čekají", () => {
    expect([0, 1, 2, 3, 4, 5, 11].map(czWaits)).toEqual(["čeká", "čeká", "čekají", "čekají", "čekají", "čeká", "čeká"]);
  });
});
