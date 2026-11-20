/**
 * Vlna 22, bod 22j – logo SVG v razítku bez prohlížeče (cad/title-logo-svg.ts, title-logo.ts prepareLogo).
 * Dřív: v CLI ✗ „logo SVG jde převést jen v prohlížeči“ (repro S/w22/repro/22j/out-svg.txt), v prohlížeči se vektor ztratil (PNG).
 * Teď: očištěné SVG zůstane v logu (`svg`), PNG náhled a obrys pro DXF / DWG se spočítají z tvarů i v Node, PDF kreslí vektor.
 */
import { describe, expect, it } from "vitest";
import { parseDataUrl, prepareLogo, toDataUrl } from "./title-logo";
import { parseColor, pathPolys, rasterShapes, sanitizeSvg, svgPdfPaths, svgShapes } from "./title-logo-svg";

const LOGO = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 240 80" onload="alert(1)">
  <script>alert(1)</script>
  <rect x="0" y="0" width="80" height="80" fill="#e03930"/>
  <g transform="translate(100 10)" fill="#272425"><circle cx="20" cy="30" r="20"/><path d="M50 0 h40 v60 h-40 z M60 10 v40 h20 v-40 z" fill-rule="evenodd"/></g>
  <image href="https://example.invalid/x.png" width="10" height="10"/>
  <text x="0" y="0">Firma</text>
</svg>`;

describe("logo SVG (bod 22j)", () => {
  it("očištění: bez skriptu, obsluh událostí a vnějších odkazů", () => {
    const s = sanitizeSvg(LOGO);
    expect(s.startsWith("<svg")).toBe(true);
    expect(s).not.toMatch(/<script/i);
    expect(s).not.toMatch(/onload/i);
    expect(s).not.toMatch(/example\.invalid/);
    expect(() => sanitizeSvg("<html></html>")).toThrow();
  });

  it("tvary: obdélník, kruh ve skupině s posunem, cesta s dírou (evenodd); text a obrázek se ohlásí", () => {
    const d = svgShapes(LOGO);
    expect([d.w, d.h]).toEqual([240, 80]);
    expect(d.shapes).toHaveLength(3);
    expect(d.shapes[0].fill).toBe("#e03930");
    const circle = d.shapes[1].polys[0];
    const cx = circle.reduce((a, p) => a + p[0], 0) / circle.length;
    expect(cx).toBeCloseTo(120, 0); // 100 + 20
    expect(d.shapes[2].rule).toBe("evenodd");
    expect(d.shapes[2].polys).toHaveLength(2);
    expect(d.skipped).toEqual(expect.arrayContaining(["text"]));
  });

  it("cesta s obloukem a křivkou se rozdělí na úsečky; barvy", () => {
    const p = pathPolys("M0 0 A10 10 0 0 1 20 0 C20 10 0 10 0 0 Z");
    expect(p[0].length).toBeGreaterThan(10);
    expect(parseColor("#abc")).toBe("#aabbcc");
    expect(parseColor("rgb(255, 0, 0)")).toBe("#ff0000");
    expect(parseColor("none")).toBeNull();
  });

  it("rastr bez prohlížeče: červený čtverec vlevo, bílé pozadí, díra v obdélníku zůstane bílá", () => {
    const d = svgShapes(LOGO);
    const r = rasterShapes(d, 240, 80);
    const px = (x: number, y: number) => Array.from(r.rgba.slice((y * 240 + x) * 4, (y * 240 + x) * 4 + 3));
    expect(px(40, 40)).toEqual([224, 57, 48]);
    expect(px(230, 5)).toEqual([255, 255, 255]);
    expect(px(170, 40)).toEqual([255, 255, 255]); // díra (100+60…100+80, 10+10…10+50)
    expect(px(155, 40)).toEqual([39, 36, 37]);
  });

  it("prepareLogo v Node: SVG zůstane vektorem, PNG náhled a obrys pro DXF/DWG; upozornění na text", async () => {
    const url = toDataUrl("image/svg+xml", new TextEncoder().encode(LOGO));
    const { logo, warnings } = await prepareLogo(url, "logo.svg");
    expect(logo.svg).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(new TextDecoder().decode(parseDataUrl(logo.svg!)!.bytes)).not.toMatch(/script/);
    expect(logo.src).toMatch(/^data:image\/png;base64,/);
    expect(logo.trace?.rects.length).toBeGreaterThan(0);
    expect(logo.name).toBe("logo.svg");
    expect(warnings.join(" ")).toMatch(/text/);
  });

  it("PDF: tvary v mm listu uvnitř obdélníku loga (poměr stran zachován)", () => {
    const paths = svgPdfPaths(LOGO, 10, 20, 60, 20);
    const xs = paths.flatMap((p) => p.polys.flat().map((q) => q[0]));
    const ys = paths.flatMap((p) => p.polys.flat().map((q) => q[1]));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10 - 1e-6);
    expect(Math.max(...xs)).toBeLessThanOrEqual(70 + 1e-6);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(20 - 1e-6);
    expect(Math.max(...ys)).toBeLessThanOrEqual(40 + 1e-6);
  });
});
