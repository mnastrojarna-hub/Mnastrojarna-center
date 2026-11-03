import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";
import type { PricingJob } from "./pricing-board";

// Výkres u položky na Nacenění: miniatura / „Výkres chybí", panel vedle (bez Next.js a bez DB)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/pricing",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/actions/jobs", () => ({ saveJobItems: vi.fn(), updateJob: vi.fn(), createJobQuote: vi.fn() }));

const { PricingBoard } = await import("./pricing-board");
const { DrawingDock } = await import("./pricing-drawing");

const job: PricingJob = {
  id: "j1", number: "Z-2026-101", title: "Příruby", stage: "poptavka", priority: "stredni",
  customerName: "Strojmetal a.s.", customerNumber: null, customerInquiryNumber: null, customerRequiredDate: null,
  dueDate: null, maxToleratedDate: null, supplierPromisedDate: null, owner: null, pricedBy: null,
  currency: "CZK", value: null, aiFilled: false,
  items: [
    {
      id: "i1", drawingNumber: "H-200", revision: "B", name: "Příruba", description: null, material: "S235", quantity: 10, unit: "ks",
      unitPrice: null, purchaseUnitPrice: null, note: null,
      drawings: [
        { id: "11111111-1111-4111-8111-111111111111", filename: "H-200_revB.pdf", view: "pdf" },
        { id: "22222222-2222-4222-8222-222222222222", filename: "H-200.step", view: "model" },
      ],
    },
    {
      id: "i2", drawingNumber: "H-201", revision: null, name: "Víko", description: null, material: null, quantity: 5, unit: "ks",
      unitPrice: 120, purchaseUnitPrice: null, note: null, drawings: [],
    },
  ],
  quotes: [],
};

const html = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, "");

describe("Nacenění — výkres u položky", () => {
  it("položka s výkresem má miniaturu (tlačítko, ne odkaz → žádná navigace), bez výkresu „Výkres chybí“", () => {
    const out = html(<PricingBoard jobs={[job]} me={{ id: "u1", name: "Admin" }} margins today="2026-11-03" initialOpenId="j1" />);
    expect(out).toContain('data-testid="pricing-drawing-thumb"');
    expect(out).toContain('aria-label="Položka 1: zobrazit výkres H-200_revB.pdf"');
    // +1 = další soubor položky (3D model)
    expect(out).toMatch(/\+1<\/span>/);
    expect(out).toContain('aria-label="Položka 2: výkres chybí"');
    expect(out).toContain('title="Výkres chybí"');
    // miniatura je <button type="button"> — nikdy <a href> (klik nesmí odejít ze stránky)
    expect(out).not.toMatch(/<a[^>]+href="\/api\/jobs\/files\//);
    // přepínač „Mít výkres vedle" (jen počítač, lg)
    expect(out).toContain('data-testid="pricing-dock-toggle"');
    expect(out).toContain("Mít výkres vedle");
    // rozepsané ceny jsou v řádcích (cena položky 2 předvyplněná)
    expect(out).toContain('aria-label="Položka 2: prodejní cena za kus"');
  });

  it("zakázka bez výkresů: žádný přepínač panelu", () => {
    const bare = { ...job, items: job.items.map((it) => ({ ...it, drawings: [] })) };
    const out = html(<PricingBoard jobs={[bare]} me={{ id: "u1", name: "Admin" }} margins={false} today="2026-11-03" initialOpenId="j1" />);
    expect(out).not.toContain('data-testid="pricing-dock-toggle"');
    expect(out).not.toContain('data-testid="pricing-drawing-thumb"');
  });

  it("panel vedle: popisek položky, přepínač souborů (PDF / 3D), Zavřít a celá obrazovka", () => {
    const out = html(
      <DrawingDock
        target={{ jobId: "j1", rowKey: "i1", label: "Položka 1 · H-200 · Příruba", drawings: job.items[0].drawings!, index: 0 }}
        onClose={() => {}}
        onSelect={() => {}}
        onFullscreen={() => {}}
      />,
    );
    expect(out).toContain('data-testid="pricing-drawing-dock"');
    expect(out).toContain("Položka 1 · H-200 · Příruba");
    expect(out).toMatch(/role="tab" aria-selected="true"[^>]*>.*PDF/);
    expect(out).toContain(">3D<");
    expect(out).toContain("Zavřít");
    expect(out).toContain('aria-label="Celá obrazovka"');
    expect(out).toContain("H-200_revB.pdf");
  });
});
