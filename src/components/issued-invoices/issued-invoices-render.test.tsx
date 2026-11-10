import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/issued-invoices",
}));
vi.mock("@/app/actions/issued-invoices", () => ({ deleteIssuedInvoice: vi.fn() }));

import { IssuedInvoicesView } from "./issued-invoices-view";
import { paymentOf, type IssuedInvoice, type IssuedPeriod } from "@/lib/issued-invoices/model";

const TODAY = "2026-11-10";
const html = (n: React.ReactElement) => renderToString(n).replace(/<!-- -->/g, "").replace(/[\u00a0\u202f]/g, " ");
const count = (s: string, needle: string) => s.split(needle).length - 1;

function inv(p: Partial<IssuedInvoice> & { number: string }): IssuedInvoice {
  const net = p.net ?? 10_000;
  const gross = p.gross ?? Math.round(net * 121) / 100;
  return {
    id: p.number, issueDate: "2026-11-05", taxableDate: "2026-11-05", dueDate: "2026-11-19", variableSymbol: null, currency: "CZK",
    vat: Math.round((gross - net) * 100) / 100, vatRate: 21,
    customer: { id: "c1", name: "Strojmetal a.s.", ico: "12345678", dic: null },
    job: { id: "j1", number: "Z-2026-001", title: "Hřídel" },
    file: { id: "f1", filename: `Faktura_${p.number}.pdf`, mimeType: "application/pdf", generated: true },
    payment: paymentOf({ net, gross, dueDate: p.dueDate ?? "2026-11-19" }, [], TODAY),
    sentAt: null, estimated: false, external: false,
    ...p, net, gross,
  };
}

const NOV: IssuedPeriod = { kind: "month", year: 2026, month: 11 };
const items = [
  inv({ number: "FV-2026-001", net: 12_500, gross: 15_125 }),
  inv({ number: "FV-2026-002", net: 5_000, gross: 6_050, dueDate: "2026-11-01", payment: paymentOf({ net: 5_000, gross: 6_050, dueDate: "2026-11-01" }, [], TODAY), customer: { id: "c2", name: "Škoda Auto a.s.", ico: null, dic: null } }),
  inv({ number: "FV-2026-003", net: 1_000, gross: 1_210, file: null, external: true, payment: paymentOf({ net: 1_000, gross: 1_210, dueDate: null }, [{ paid_on: "2026-11-06", amount: 1_000 }], TODAY) }),
];

describe("Faktury vydané — stránka", () => {
  it("měsíc: součty, hromadné akce, řádky, stavy, PDF a mazání", () => {
    const out = html(<IssuedInvoicesView period={NOV} items={items} rates={{}} today={TODAY} canDelete />);
    expect(out).toContain("Faktury vydané");
    expect(out).toContain("z listopadu 2026");
    // součty měsíce
    expect(out).toContain("18 500 Kč"); // bez DPH
    expect(out).toContain("22 385 Kč"); // s DPH
    expect(out).toContain("21 175 Kč"); // nezaplaceno
    expect(out).toContain("zaplaceno 1 z 3");
    expect(out).toContain("po splatnosti 1");
    expect(out).toContain("1 bez PDF");
    // hromadné akce za celé období
    expect(out).toContain('href="/api/issued-invoices/zip?obdobi=2026-11"');
    expect(out).toContain('href="/api/pdf/issued-invoices?obdobi=2026-11"');
    expect(out).toContain('data-filename="Faktury_vydane_2026-11.pdf"');
    expect(out).toContain('href="/api/pdf/issued-invoices?obdobi=2026-11&amp;download=1"');
    expect(out).toContain('href="/api/issued-invoices/csv?obdobi=2026-11"');
    expect(out).toContain("Stáhnout všechny PDF (ZIP)");
    expect(out).toContain("Export pro účetní (CSV)");
    // přepínání období
    expect(out).toContain('href="/issued-invoices?obdobi=2026-10"');
    expect(out).toContain('href="/issued-invoices?obdobi=2026"');
    expect(out).toContain("Další období ještě nezačalo");
    // tabulka (desktop) i karty (mobil)
    expect(count(out, 'data-testid="issued-row"')).toBe(3);
    expect(count(out, 'data-testid="issued-card"')).toBe(3);
    expect(out).toContain('href="/api/jobs/files/f1"');
    expect(out).toContain('href="/customers/c2"');
    expect(out).toContain('href="/orders/j1"');
    expect(out).toContain("Po splatnosti");
    expect(out).toContain("Nezaplaceno");
    expect(out).toContain("Zaplaceno");
    expect(out).toContain("mimo systém");
    expect(out).toContain("Bez PDF");
    expect(out).toContain("Smazat fakturu FV-2026-001");
    // nejnovější nahoře, stejné datum → vyšší číslo dřív
    expect(out.indexOf("FV-2026-003")).toBeLessThan(out.indexOf("FV-2026-001"));
  });

  it("bez práva mazat: žádné tlačítko Smazat", () => {
    const out = html(<IssuedInvoicesView period={NOV} items={items} rates={{}} today={TODAY} canDelete={false} />);
    expect(out).not.toContain("Smazat fakturu");
  });

  it("prázdný měsíc: vysvětlení, bez hromadných akcí", () => {
    const out = html(<IssuedInvoicesView period={{ kind: "month", year: 2026, month: 9 }} items={[]} rates={{}} today={TODAY} canDelete />);
    expect(out).toContain("Září 2026: žádná vystavená faktura.");
    expect(out).not.toContain("/api/issued-invoices/zip");
    expect(out).toContain("Tento měsíc");
  });

  it("rok: dlaždice měsíců s odkazy; cizí měna s kurzem v součtu Kč", () => {
    const eur = inv({ number: "FV-2026-010", currency: "EUR", net: 1_000, gross: 1_210, issueDate: "2026-03-02" });
    const out = html(<IssuedInvoicesView period={{ kind: "year", year: 2026 }} items={[...items, eur]} rates={{ "FV-2026-010": 25 }} today={TODAY} canDelete />);
    expect(out).toContain('data-testid="issued-year"');
    expect(out).toContain('href="/issued-invoices?obdobi=2026-03"');
    expect(out).toContain("30 250 Kč"); // březen: 1 210 EUR × 25
    expect(out).toContain("43 500 Kč"); // celkem bez DPH vč. EUR
    expect(out).toContain("kurz ČNB k DUZP");
    expect(out).toContain("Po měnách:");
    expect(out).toContain('href="/api/issued-invoices/zip?obdobi=2026"');
  });
});
