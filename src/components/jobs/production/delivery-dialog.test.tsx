import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

// Dialog „Zapsat dodání a dodací list" a jeho výsledek (SSR bez portálu, akce mockované).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders/j1",
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) => (open ? <div data-dialog>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));
vi.mock("@/app/actions/flow-status", () => ({
  moveJobStage: vi.fn(), setDeliveredQuantities: vi.fn(), closeItemDelivery: vi.fn(), recordPartialDelivery: vi.fn(),
}));
vi.mock("@/app/actions/delivery-notes", () => ({ recordDelivery: vi.fn(), listDeliveryNotes: vi.fn() }));
vi.mock("@/app/actions/job-documents", () => ({ generateJobDocument: vi.fn(), sendJobDocument: vi.fn(), draftJobDocumentEmail: vi.fn() }));

import { DeliveryDialog, rowsFromNow } from "./delivery-dialog";
import { DeliveryNoteResult, noteDownloadHref } from "./delivery-note-result";

const render = (node: React.ReactNode) => renderToString(node).replace(/<!-- -->/g, "");
const flat = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const items = [
  { id: "a", drawingNumber: "VK-100-A", name: "Příruba", description: null, quantity: 10, unit: "ks", deliveredQuantity: 6, deliveryClosed: false },
  { id: "b", drawingNumber: "VK-200-B", name: "Hřídel", description: null, quantity: 4, unit: "ks", deliveredQuantity: 4, deliveryClosed: false },
];

describe("Zapsat dodání a dodací list — dialog", () => {
  it("„Vystavit dodací list“ je zaškrtnuté, tlačítko říká co udělá, množství „Dodávám teď“ se zbytkem", () => {
    const html = render(<DeliveryDialog open onOpenChange={() => {}} jobId="j1" items={items} />);
    const text = flat(html);
    expect(html).toMatch(/type="checkbox"[^>]*checked/);
    expect(text).toContain("Vystavit dodací list");
    expect(text).toContain("Zapsat dodání a dodací list");
    expect(html).toContain('aria-label="Dodávám teď — Příruba"');
    expect(text).toContain("zbývá 4");
    // dodaná položka nemá pole, jen „dodáno"
    expect(html).not.toContain('aria-label="Dodávám teď — Hřídel"');
    expect(text).toContain("Opravit zapsané");
    expect(text).toContain("bude na dodacím listu");
    // bez cen
    expect(text).not.toMatch(/Kč|cena/i);
  });

  it("výchozí: „Dodávám teď“ je předvyplněné celým zbytkem — dodání = otevřít a potvrdit (i „DL na zbývající“)", () => {
    for (const prefill of [undefined, "remaining" as const]) {
      const html = render(<DeliveryDialog open onOpenChange={() => {}} jobId="j1" items={items} prefill={prefill} />);
      expect(html).toMatch(/aria-label="Dodávám teď — Příruba"[^>]*value="4"|value="4"[^>]*aria-label="Dodávám teď — Příruba"/);
      expect(flat(html)).toContain("u dílčí dodávky jen sniž");
    }
    const empty = render(<DeliveryDialog open onOpenChange={() => {}} jobId="j1" items={items} prefill="empty" />);
    expect(empty).toMatch(/aria-label="Dodávám teď — Příruba"[^>]*value=""|value=""[^>]*aria-label="Dodávám teď — Příruba"/);
  });

  it("desetinné množství se předvyplní s čárkou (12,5), jako zbytek českého UI", () => {
    const tube = [{ id: "t", drawingNumber: null, name: "Trubka", description: null, quantity: 20, unit: "m", deliveredQuantity: 7.5, deliveryClosed: false }];
    const html = render(<DeliveryDialog open onOpenChange={() => {}} jobId="j1" items={tube} />);
    expect(html).toMatch(/value="12,5"/);
    expect(html).not.toMatch(/value="12\.5"/);
    expect(rowsFromNow(tube, { t: "12,5" })).toEqual([{ itemId: "t", from: 7.5, to: 20 }]);
  });

  it("řádky dodávky z formuláře: from = dodáno dosud, to = + teď; prázdné a 0 se vynechá", () => {
    expect(rowsFromNow(items, { a: "3", b: "" })).toEqual([{ itemId: "a", from: 6, to: 9 }]);
    expect(rowsFromNow(items, { a: "0" })).toEqual([]);
    expect(rowsFromNow(items, { a: "2,5" })).toEqual([{ itemId: "a", from: 6, to: 8.5 }]);
    expect(rowsFromNow(items, { a: "x" })).toBe("Příruba: zadej množství číslem.");
  });
});

describe("výsledek: dodací list vystaven", () => {
  it("číslo DL a tři kroky — Stáhnout PDF, Vytisknout, Poslat zákazníkovi", () => {
    const html = render(
      <DeliveryNoteResult
        jobId="j1"
        note={{ number: "DL-2026-070", fileId: "f1", filename: "Dodaci_list_DL-2026-070.pdf", label: "1. dílčí dodávka", final: false }}
        onClose={() => {}}
      />,
    );
    const text = flat(html);
    expect(text).toContain("Dodací list DL-2026-070 je vystavený");
    expect(text).toContain("1. dílčí dodávka");
    expect(text).toContain("zbytek dodáš dalším dodacím listem");
    expect(text).toContain("Stáhnout PDF");
    expect(text).toContain("Vytisknout");
    expect(text).toContain("Poslat zákazníkovi");
    expect(html).toContain(`href="${noteDownloadHref("f1")}"`);
    expect(noteDownloadHref("f1")).toBe("/api/jobs/files/f1?download=1");
    expect(html).toContain('role="status"');
  });
});
