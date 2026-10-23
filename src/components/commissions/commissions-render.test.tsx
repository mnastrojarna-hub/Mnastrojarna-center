import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

// Smoke test stránky Provize bez Next.js: router a akce jsou nahrazené
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/app/actions/commission-rules", () => ({
  listCommissionRules: vi.fn(), saveCommissionRule: vi.fn(), deleteCommissionRule: vi.fn(), markStatementPaid: vi.fn(),
}));

import { StatementCard } from "./statement-card";
import { CommissionsView } from "./commissions-view";
import { BandBar } from "./band-bar";
import { DEFAULT_TIERS, tieredExample, type CommissionEntryView, type CommissionOverview, type CommissionStatementView } from "./model";

const VIT = "4b27a72c-e981-4023-bab7-1e40adf303bd";
const PETR = "156c7996-b488-4c53-a3f5-e51dd004f4ad";

const clean = (html: string) => html.replace(/<!-- -->/g, "").replace(/[  ]/g, " ");

function statement(over: Partial<CommissionStatementView> = {}): CommissionStatementView {
  return {
    id: "st1", ownerId: VIT, ownerName: "Vít Volný", period: "2026-09-01", ruleName: "Dodatek — pásmová měsíční provize ze zisku",
    basis: "collected", revenue: 1_200_000, cost: 600_000, profit: 600_000, commission: 40_000,
    bands: tieredExample(1_200_000, 600_000, DEFAULT_TIERS).bands, jobsCount: 2, unknownCostJobs: 0, dueDate: "2026-10-20",
    status: "k_vyplate", paidAt: null, updatedAt: null, ...over,
  };
}

function entry(over: Partial<CommissionEntryView> = {}): CommissionEntryView {
  return {
    id: "e1", ownerId: VIT,
    job: { id: "j1", number: "Z-2026-120", title: "Formy", stage: "dokonceno", customerName: "StrojMetal s.r.o.", paidAt: "2026-09-12" },
    period: "2026-09-01", revenue: 700_000, cost: 350_000, profit: 350_000, margin: 0.5, rate: 0.0667, base: "margin_tiered",
    commission: 23_333.33, estimatedCommission: null, status: "k_vyplate", costKnown: true, collected: true, ...over,
  };
}

describe("Provize — render", () => {
  it("vyúčtování pásmové provize: čísla, splatnost, pásma, zakázky, výplata", () => {
    const html = clean(renderToString(
      <StatementCard
        statement={statement()}
        entries={[entry(), entry({ id: "e2", job: { id: "j2", number: "Z-2026-121", title: "Lišty", stage: "dokonceno", customerName: "Kovo a.s.", paidAt: null }, revenue: 500_000, commission: 16_666.67 })]}
        today="2026-10-22"
        canPay
      />,
    ));
    expect(html).toContain("Září 2026");
    expect(html).toContain("K výplatě");
    expect(html).toContain("po splatnosti od 20. 10. 2026");
    expect(html).toContain("Inkaso");
    expect(html).toContain("1 200 000 Kč");
    expect(html).toContain("40 000 Kč");
    expect(html).toContain("marže 50 %");
    expect(html).toContain("25 000 Kč"); // pásmo 10 %
    expect(html).toContain("15 000 Kč"); // pásmo 15 %
    expect(html).toContain("inkaso 1,2 mil.");
    expect(html).toContain("/orders/j1?tab=nakup");
    expect(html).toContain("Z-2026-121");
    expect(html).toContain("Označit jako vyplacené");
  });

  it("zakázka bez nákupní ceny: „čeká na nákupní cenu (OV-…)“ místo 0 Kč, do výplaty se nepočítá", () => {
    const pending = entry({
      id: "p1", job: { id: "j3", number: "Z-2026-130", title: "Příruby", stage: "ve_vyrobe", customerName: "Kovo a.s.", paidAt: null },
      base: "margin_tiered", collected: true, status: "k_vyplate", costKnown: false, commission: 0, profit: 0, costPendingPo: ["OV-2026-012"],
    });
    const html = clean(renderToString(
      <StatementCard statement={statement({ status: "otevrena", unknownCostJobs: 1, commission: 23_333.33 })} entries={[entry(), pending]} today="2026-10-22" />,
    ));
    expect(html).toContain("čeká na nákupní cenu (OV-2026-012)");
    expect(html).toContain("1 zakázka čeká na nákupní cenu — provize se jí zatím nepočítá ani nevyplácí");
    // řádek zakázky s čekající provizí nemá „0 Kč" jako provizi ani štítek „K výplatě"
    const row = html.slice(html.indexOf("Z-2026-130"));
    expect(row.slice(0, row.indexOf("</li>"))).not.toContain(">0 Kč<");
    expect(row.slice(0, row.indexOf("</li>"))).not.toContain("K výplatě");
    // tři tvary: 5 zakázek čeká
    const five = Array.from({ length: 5 }, (_, k) => ({ ...pending, id: `p${k}`, job: { ...pending.job!, id: `j${k + 10}`, number: `Z-2026-14${k}` } }));
    expect(clean(renderToString(<StatementCard statement={statement({ unknownCostJobs: 5 })} entries={five} today="2026-10-22" />)))
      .toContain("5 zakázek čeká na nákupní cenu — provize se jim");
    // provize z obratu nezávisí na nákladu → ukazuje se normálně
    const rev = clean(renderToString(
      <StatementCard statement={statement()} entries={[entry({ ...pending, base: "revenue", commission: 1_500 })]} today="2026-10-22" />,
    ));
    expect(rev).not.toContain("čeká na nákupní cenu");
    expect(rev).toContain("1 500 Kč");
    // provize z obratu bez nákladu: banner jen o zisku, ne „nevyplácí"
    const revUnknown = clean(renderToString(
      <StatementCard statement={statement({ unknownCostJobs: 1 })} entries={[entry({ ...pending, base: "revenue", commission: 1_500 })]} today="2026-10-22" />,
    ));
    expect(revUnknown).toContain("1 zakázka nemá nákupní cenu — jejich zisk se zatím nepočítá");
    expect(revUnknown).not.toContain("nevyplácí");
  });

  it("smazaná zakázka s vyplacenou provizí = jeden souhrnný řádek historie", () => {
    const html = clean(renderToString(
      <StatementCard
        statement={statement({ status: "vyplaceno", paidAt: "2026-10-15" })}
        entries={[entry({ status: "vyplaceno" }), entry({ id: "o1", job: null, status: "vyplaceno", commission: 500 }), entry({ id: "o2", job: null, status: "vyplaceno", commission: 250 })]}
        today="2026-10-22"
      />,
    ));
    expect(html).toContain("Smazané zakázky (2)");
    expect(html).toContain("vyplacená provize zůstává v historii výplat");
    expect(html).toContain("750 Kč");
    expect(html).toContain("Z-2026-120");
  });

  it("vyplacené vyúčtování ukáže, kdo výplatu označil", () => {
    const html = clean(renderToString(
      <StatementCard statement={statement({ status: "vyplaceno", paidAt: "2026-10-15", paidBy: "Super Admin", paidMarkedAt: "2026-10-15T08:00:00Z" })} entries={[]} today="2026-10-22" canPay />,
    ));
    expect(html).toContain("vyplaceno 15. 10. 2026");
    expect(html).toContain("označil Super Admin");
    expect(html).toContain("Vrátit výplatu");
  });

  it("lišta bez inkasa: kolik chybí do pásma 10 %", () => {
    const html = clean(renderToString(<BandBar bands={DEFAULT_TIERS} revenue={0} showNext />));
    expect(html).toContain("Do pásma");
    expect(html).toContain("500 000 Kč");
  });

  const overview = (over: Partial<CommissionOverview> = {}): CommissionOverview => ({
    viewerId: VIT, canSeeAll: false, ownerId: VIT,
    owners: [{
      id: VIT, name: "Vít Volný", email: "vit.volny@mnastrojarna.cz", role: "obchodnik", profileRate: 0,
      rule: {
        id: "r1", ownerId: VIT, name: "Dodatek — pásmová měsíční provize ze zisku", base: "margin_tiered", basis: "collected", rate: 0,
        tiers: DEFAULT_TIERS, validFrom: "2000-01-01", payoutDays: 20, note: null, createdAt: "2026-10-22T08:00:00Z", changedBy: "Super Admin",
        changedAt: "2026-10-22T08:00:00Z",
      },
    }],
    months: ["2026-10-01", "2026-09-01", "2026-08-01"],
    statements: [statement()],
    entries: [entry(), entry({ id: "e3", period: "2026-10-01", collected: false, status: "predbezna", commission: 0, estimatedCommission: 12_000, job: { id: "j3", number: "Z-2026-130", title: "Upínky", stage: "ve_vyrobe", customerName: "Kovo a.s.", paidAt: null } })],
    rules: [],
    today: "2026-10-22",
    ...over,
  });

  it("obchodník: smlouva, výběr měsíce, prázdný běžící měsíc, předběžné odhady", () => {
    const html = clean(renderToString(<CommissionsView overview={overview()} />));
    expect(html).toContain("Provize");
    expect(html).toContain("Pásmová provize · 0/10/15/20 %");
    expect(html).toContain("upravil");
    expect(html).toContain("Super Admin");
    expect(html).toContain("Splatnost do 20 dnů po skončení měsíce.");
    expect(html).toContain("Říjen 2026 — zatím žádná provize");
    expect(html).toContain("Předběžné (neinkasované)");
    expect(html).toContain("Z-2026-130");
    expect(html).toContain("≈ 12 000 Kč");
    expect(html).not.toContain("Všichni"); // obchodník nemá přepínač
    expect(html).not.toContain("Označit jako vyplacené");
  });

  it("vybraný měsíc s vyúčtováním", () => {
    const html = clean(renderToString(<CommissionsView overview={overview()} initialMonth="2026-09-01" />));
    expect(html).toContain("Září 2026");
    expect(html).toContain("Z-2026-120");
  });

  it("super admin — všichni obchodníci, přepínač, součty", () => {
    const html = clean(renderToString(<CommissionsView
      overview={overview({
        viewerId: "admin", canSeeAll: true, ownerId: null,
        owners: [...overview().owners, { id: PETR, name: "Petr Obchodník", email: null, role: "obchodnik", profileRate: 0.1, rule: null }],
        statements: [statement({ period: "2026-10-01", status: "otevrena", dueDate: "2026-11-20" }), statement({ id: "st2", ownerId: PETR, ownerName: "Petr Obchodník", period: "2026-10-01", status: "otevrena", basis: "ordered", bands: [], commission: 3_300, revenue: 94_000, cost: 61_000, profit: 33_000 })],
      })}
    />));
    expect(html).toContain("Všichni");
    expect(html).toContain("/commissions?obchodnik=" + PETR);
    expect(html).toContain("10 % ze zisku");
    expect(html).toContain("Petr Obchodník");
    expect(html).toContain("splatná do 20. 11. 2026");
    expect(html).toContain("Běží");
  });

  it("prázdný přehled", () => {
    const html = clean(renderToString(<CommissionsView overview={overview({ statements: [], entries: [] })} />));
    expect(html).toContain("zatím žádná provize");
  });
});
