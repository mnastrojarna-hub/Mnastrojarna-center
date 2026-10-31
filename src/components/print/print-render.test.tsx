import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

// „Tisknout" u dokumentů: tlačítko (ikona tiskárny), vypnuté s nápovědou u DXF / 3D; místa v aplikaci.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders/j1",
}));
vi.mock("@/app/actions/job-documents", () => ({ generateJobDocument: vi.fn(), sendJobDocument: vi.fn(), draftJobDocumentEmail: vi.fn() }));

const { PrintButton } = await import("./print-button");
const { InvoicePreview } = await import("@/components/supplier-invoices/invoice-preview");
const { AttachmentChip } = await import("@/components/flow/document-send-dialog");
const { PrintDocument } = await import("./print-document");

const render = (node: React.ReactNode) => renderToString(node).replace(/<!-- -->/g, "");

describe("PrintButton", () => {
  it("PDF: ikona tiskárny, popisek s názvem, zdroj pro tisk", () => {
    const html = render(<PrintButton href="/api/jobs/files/f1" filename="Nabidka_N-1.pdf" />);
    expect(html).toContain('data-testid="print-button"');
    expect(html).toContain('aria-label="Tisknout Nabidka_N-1.pdf"');
    expect(html).toContain('data-print-href="/api/jobs/files/f1"');
    expect(html).toContain("lucide-printer");
    expect(html).not.toContain("aria-disabled");
  });

  it("DXF a 3D model: vypnuté s krátkou nápovědou", () => {
    const dxf = render(<PrintButton href="/api/jobs/files/f2" filename="vykres.dxf" />);
    expect(dxf).toContain('aria-disabled="true"');
    expect(dxf).toContain("DXF vytiskneš po uložení jako PDF");
    const step = render(<PrintButton href="/api/jobs/files/f3" filename="dil.step" />);
    expect(step).toContain('aria-disabled="true"');
    expect(step).toContain("Tisknout pohled");
  });

  it("s popiskem (velká tlačítka dialogů)", () => {
    const html = render(<PrintButton href="/api/pdf/job/j1?type=faktura" label="Tisknout" showLabel variant="outline" />);
    expect(html).toContain(">Tisknout</span>");
  });
});

describe("místa s dokumenty", () => {
  it("faktura dodavatele: Stáhnout + Tisknout", () => {
    const html = render(<InvoicePreview files={[{ id: "f1", filename: "faktura.jpg", mimeType: "image/jpeg", size: 100, href: "/api/supplier-invoices/files/f1" }]} />);
    expect(html).toContain('href="/api/supplier-invoices/files/f1?download=1"');
    expect(html).toContain('data-print-href="/api/supplier-invoices/files/f1"');
  });

  it("příloha v dialogu odeslání dokladu: Náhled + Tisknout", () => {
    const html = render(<AttachmentChip fileId="f7" filename="Dodaci_list_DL-1.pdf" />);
    expect(html).toContain('href="/api/jobs/files/f7"');
    expect(html).toContain('data-print-href="/api/jobs/files/f7"');
    expect(html).toContain('aria-label="Tisknout Dodaci_list_DL-1.pdf"');
  });
});

describe("tisková stránka", () => {
  it("lišta: Zpět, stav přípravy, Tisknout (vypnuté do vykreslení)", () => {
    const html = render(<PrintDocument source={{ src: "/api/jobs/files/f1", name: "nabidka.pdf" }} mode="page" onBack={() => {}} />);
    expect(html).toContain('data-testid="print-back"');
    expect(html).toContain('data-testid="print-now"');
    expect(html).toMatch(/data-testid="print-now"[^>]*disabled|disabled=""[^>]*data-testid="print-now"/);
    expect(html).toContain("nabidka.pdf");
    expect(html).toContain("Stahuji dokument");
  });

  it("skrytý režim (tisk z aplikace) nic na obrazovce nevykreslí", () => {
    expect(render(<PrintDocument source={{ bytes: new Uint8Array([1]), name: "x.pdf" }} mode="hidden" />)).toBe("");
  });
});
