import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

// 3D prohlížeč (three.js / OpenCascade) se v testu hlavičky nenačítá
vi.mock("@/components/viewer3d/model-viewer", () => ({ ModelViewer: () => null }));

import { FileViewer } from "./file-viewer";
import { rasterPreviewHref, isServerRasterBytes } from "./raster-view";

const html = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, "");
const nav = { index: 2, count: 7, prev: () => {}, next: () => {} };

describe("prohlížeč — výkres zakázky", () => {
  it("hlavička: počítadlo 3 / 7, číslo výkresu s revizí, název, počet kusů a materiál; ‹ › tlačítka", () => {
    const out = html(
      <FileViewer
        request={{ href: "/api/jobs/files/abc", filename: "H-20.pdf", info: { drawingNumber: "H-20", revision: "B", name: "Hřídel", quantity: 25, unit: "ks", material: "1.4301" } }}
        onBack={() => {}}
        nav={nav}
      />,
    );
    expect(out).toContain('data-testid="viewer-counter"');
    expect(out).toMatch(/viewer-counter"[^>]*>3 \/ 7</);
    expect(out).toContain("H-20 rev. B");
    expect(out).toContain("Hřídel");
    expect(out).toMatch(/data-field="quantity"[^>]*>25 ks</);
    expect(out).toMatch(/data-field="material"[^>]*>.*Materiál.*1\.4301/);
    expect(out).toContain('aria-label="Předchozí výkres"');
    expect(out).toContain('aria-label="Další výkres"');
    expect(out).not.toMatch(/Kč|cena/i);
  });

  it("bez navázané položky ani sady: žádný pruh údajů, žádné listování", () => {
    const out = html(<FileViewer request={{ href: "/api/jobs/files/abc", filename: "V.pdf" }} onBack={() => {}} />);
    expect(out).not.toContain("viewer-drawing-info");
    expect(out).not.toContain("viewer-counter");
    expect(out).not.toContain("Další výkres");
    // jen materiál bez množství → pruh s materiálem, bez kusů
    const mat = html(<FileViewer request={{ href: "/api/jobs/files/abc", filename: "V.pdf", info: { drawingNumber: null, revision: null, name: null, quantity: null, unit: "ks", material: "S235" } }} onBack={() => {}} />);
    expect(mat).toContain("S235");
    expect(mat).not.toContain('data-field="quantity"');
  });

  it("TIFF dokumentu zakázky: náhled přes server, hlavička se Zpět a Stáhnout originál", () => {
    const out = html(<FileViewer request={{ href: "/api/jobs/files/abc", filename: "SKEN.tif" }} onBack={() => {}} />);
    expect(out).toContain('data-testid="viewer-back"');
    expect(out).toContain('data-testid="raster-view"');
    expect(out).toContain('href="/api/jobs/files/abc?download=1"');
    expect(out).toContain("TIFF");
    expect(rasterPreviewHref("/api/jobs/files/abc", 2)).toBe("/api/jobs/files/abc?view=image&page=2");
    expect(rasterPreviewHref("/api/jobs/files/abc?download=1", 0)).toBe("/api/jobs/files/abc?view=image&page=1");
    expect(rasterPreviewHref("/api/emails/attachment/x", 1)).toBeNull();
    expect(isServerRasterBytes(new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 0, 0, 0, 0]))).toBe(true);
    expect(isServerRasterBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });
});
