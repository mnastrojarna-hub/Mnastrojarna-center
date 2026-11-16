import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { jobStampText, stampJobNumber, stampPlacement } from "./job-stamp";

describe("číslo zakázky nad razítko výkresu (16. 11.)", () => {
  it("text: Z-2026-026 → 2026/026, s pozicí", () => {
    expect(jobStampText("Z-2026-026", 2)).toBe("Zakázka 2026/026 · pol. 2");
    expect(jobStampText("2026/115")).toBe("Zakázka 2026/115");
  });
  it("umístění: vpravo dole nad razítkem, i u otočené stránky", () => {
    const a4 = { width: 595, height: 842, rotation: 0 };
    const p = stampPlacement(a4, { w: 120, h: 14 });
    expect(p.rotate).toBe(0);
    expect(p.x + 120).toBeLessThan(595);
    expect(p.y).toBeGreaterThan(150);
    expect(p.y).toBeLessThan(260);
    const r = stampPlacement({ width: 842, height: 1191, rotation: 90 }, { w: 120, h: 14 });
    expect(r.rotate).toBe(90);
    expect(r.x).toBeGreaterThan(0);
    expect(r.y).toBeGreaterThan(0);
  });
  it("vloží text do PDF; poškozené PDF vrátí beze změny", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([842, 595]);
    const src = await doc.save();
    const out = await stampJobNumber(src, "Zakázka 2026/026 · pol. 1");
    expect(out.length).toBeGreaterThan(src.length);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
    const bad = new Uint8Array([1, 2, 3]);
    expect(await stampJobNumber(bad, "x")).toBe(bad);
  });
});
