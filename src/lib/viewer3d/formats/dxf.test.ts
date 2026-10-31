import { describe, expect, it } from "vitest";
import { evalSpline, parseDxf } from "./dxf";
import { bulgeArc, drawingToModel } from "../drawing-model";
import { sniffFile } from "../sniff";
import { readFileSync } from "node:fs";

/** Text → bajty Windows-1250 (české znaky jako ve starších výkresech z AutoCADu). */
const CP1250: Record<string, number> = { "á": 0xe1, "č": 0xe8, "ď": 0xef, "é": 0xe9, "ě": 0xec, "í": 0xed, "ň": 0xf2, "ó": 0xf3, "ř": 0xf8, "š": 0x9a, "ť": 0x9d, "ú": 0xfa, "ů": 0xf9, "ý": 0xfd, "ž": 0x9e, "Ř": 0xd8, "Č": 0xc8, "Ž": 0x8e, "Š": 0x8a, "—": 0x97 };
function cp1250(s: string): Uint8Array {
  return Uint8Array.from([...s].map((ch) => CP1250[ch] ?? ch.charCodeAt(0)));
}

function dxf(opts: { units?: number; codepage?: string; ver?: string } = {}): string {
  const g = (pairs: (string | number)[]) => {
    const out: string[] = [];
    for (let i = 0; i < pairs.length; i += 2) out.push(String(pairs[i]), String(pairs[i + 1]));
    return out.join("\n");
  };
  return [
    g([0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, opts.ver ?? "AC1015", 9, "$DWGCODEPAGE", 3, opts.codepage ?? "ANSI_1250", 9, "$INSUNITS", 70, opts.units ?? 4, 0, "ENDSEC"]),
    g([0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LAYER", 70, 3,
      0, "LAYER", 2, "KONTURA", 70, 0, 62, 1, 6, "CONTINUOUS",
      0, "LAYER", 2, "KOTY", 70, 0, 62, 3, 6, "CONTINUOUS",
      0, "LAYER", 2, "SKRYTA", 70, 0, 62, -5, 6, "CONTINUOUS",
      0, "ENDTAB", 0, "ENDSEC"]),
    g([0, "SECTION", 2, "BLOCKS",
      0, "BLOCK", 8, "0", 2, "SROUB", 70, 0, 10, 0, 20, 0, 30, 0, 3, "SROUB",
      0, "CIRCLE", 8, "0", 10, 0, 20, 0, 30, 0, 40, 4,
      0, "LINE", 8, "0", 10, 0, 20, 0, 30, 0, 11, 10, 21, 0, 31, 0,
      0, "ENDBLK", 8, "0",
      0, "ENDSEC"]),
    g([0, "SECTION", 2, "ENTITIES",
      0, "LINE", 8, "KONTURA", 10, 0, 20, 0, 30, 0, 11, 120, 21, 0, 31, 0,
      // polyčára: úsečka + půlkruh (bulge 1) zpět
      0, "LWPOLYLINE", 8, "KONTURA", 90, 2, 70, 1, 10, 0, 20, 10, 42, 0, 10, 40, 20, 10, 42, 1,
      0, "CIRCLE", 8, "KONTURA", 62, 5, 10, 60, 20, 30, 30, 0, 40, 6,
      0, "ARC", 8, "KONTURA", 10, 0, 20, 0, 30, 0, 40, 10, 50, 0, 51, 90,
      0, "TEXT", 8, "KOTY", 10, 5, 20, 70, 30, 0, 40, 3.5, 1, "Výkres č. 1 — ŘEZ A-A %%c20", 50, 0,
      0, "MTEXT", 8, "KOTY", 10, 5, 20, 90, 30, 0, 40, 2.5, 41, 50, 71, 1, 1, "{\\fArial|b0;Pozn.:}\\PMateriál 1.4301",
      0, "INSERT", 8, "KOTY", 2, "SROUB", 10, 100, 20, 50, 30, 0, 41, 2, 42, 2, 50, 90,
      0, "LINE", 8, "SKRYTA", 10, 0, 20, -10, 30, 0, 11, 10, 21, -10, 31, 0,
      0, "ENDSEC", 0, "EOF"]),
  ].join("\n");
}

describe("DXF → 2D výkres", () => {
  it("rozpozná DXF podle obsahu i bez přípony", () => {
    expect(sniffFile(cp1250(dxf()), "výkres")).toMatchObject({ kind: "model", format: "dxf" });
    expect(sniffFile(new TextEncoder().encode("AC1032\0\0\0\0\0"), "x")).toMatchObject({ kind: "model", format: "dwg" });
  });

  it("hladiny, barvy, vypnutá hladina, entity", () => {
    const d = parseDxf(cp1250(dxf()));
    expect(d.format).toBe("DXF (AC1015)");
    expect(d.layers.map((l) => l.name).sort()).toEqual(["KONTURA", "KOTY", "SKRYTA"]);
    expect(d.layers.find((l) => l.name === "KONTURA")!.color).toEqual([1, 0, 0]);
    expect(d.layers.find((l) => l.name === "SKRYTA")!.off).toBe(true);
    const kinds = d.entities.map((e) => e.kind);
    expect(kinds.filter((k) => k === "line")).toHaveLength(3); // čára + čára z bloku + skrytá
    expect(kinds).toContain("polyline");
    expect(kinds).toContain("arc");
    // kružnice: vlastní (ACI 5 = modrá) + z bloku
    const circles = d.entities.filter((e) => e.kind === "circle");
    expect(circles).toHaveLength(2);
    expect(circles.find((c) => c.kind === "circle" && c.r === 6)!.color).toEqual([0, 0, 1]);
  });

  it("český text z kódové stránky 1250, %%c = ⌀, MTEXT bez formátování", () => {
    const d = parseDxf(cp1250(dxf()));
    const texts = d.entities.filter((e) => e.kind === "text").map((e) => (e.kind === "text" ? e.text : ""));
    expect(texts).toContain("Výkres č. 1 — ŘEZ A-A ⌀20");
    expect(texts).toContain("Pozn.:\nMateriál 1.4301");
  });

  it("blok: vložení s měřítkem 2 a otočením 90°, hladina 0 → hladina vložení", () => {
    const d = parseDxf(cp1250(dxf()));
    const c = d.entities.find((e) => e.kind === "circle" && e.r !== 6);
    expect(c).toMatchObject({ kind: "circle", layer: "KOTY" });
    if (c?.kind !== "circle") throw new Error();
    expect(c.r).toBeCloseTo(8);
    expect(c.c[0]).toBeCloseTo(100);
    expect(c.c[1]).toBeCloseTo(50);
    // čára (0,0)→(10,0) otočená o 90° a ×2 → (100,50)→(100,70)
    const l = d.entities.find((e) => e.kind === "line" && e.layer === "KOTY");
    if (l?.kind !== "line") throw new Error();
    expect(l.b[0]).toBeCloseTo(100);
    expect(l.b[1]).toBeCloseTo(70);
  });

  it("jednotky: palce → mm", () => {
    const d = parseDxf(cp1250(dxf({ units: 1 })));
    const l = d.entities.find((e) => e.kind === "line" && e.layer === "KONTURA");
    if (l?.kind !== "line") throw new Error();
    expect(l.b[0]).toBeCloseTo(120 * 25.4);
  });

  it("model pro prohlížeč: hladiny = díly, kružnice/oblouky se středem, rohy, texty, skrytá hladina", () => {
    const m = drawingToModel(parseDxf(cp1250(dxf())));
    expect(m.model.parts.map((p) => p.name).sort()).toEqual(["KONTURA", "KOTY", "SKRYTA"]);
    const kontura = m.model.parts.findIndex((p) => p.name === "KONTURA");
    const curves = m.topology[kontura].curves;
    const circle = curves.find((c) => c.kind === "circle")!;
    expect(circle.radius).toBeCloseTo(6);
    expect(circle.center).toEqual([60, 30, 0]);
    // půlkruh z bulge: střed (20,10), poloměr 20
    const semi = curves.find((c) => c.kind === "arc" && Math.abs((c.radius ?? 0) - 20) < 1e-6)!;
    expect(semi.center![0]).toBeCloseTo(20);
    expect(semi.center![1]).toBeCloseTo(10);
    expect(m.topology[kontura].corners.length).toBeGreaterThan(0);
    expect(m.model.drawing!.texts).toHaveLength(2);
    expect(m.model.drawing!.hidden).toEqual([m.model.parts.findIndex((p) => p.name === "SKRYTA")]);
    // barvy čar: světlé i tmavé pozadí
    expect(m.model.parts[kontura].lineColors!.length).toBe(m.model.parts[kontura].lines!.length);
    expect(m.model.drawing!.darkColors[kontura].length).toBe(m.model.parts[kontura].lines!.length);
  });

  it("oblouk z bulge (CCW / CW) a spline", () => {
    const a = bulgeArc([0, 0], [10, 0], 1)!;
    expect(a.r).toBeCloseTo(5);
    expect(a.c[0]).toBeCloseTo(5);
    expect(a.c[1]).toBeCloseTo(0);
    const b = bulgeArc([0, 0], [10, 0], Math.tan(Math.PI / 8))!; // čtvrtkruh 90°
    expect(b.r).toBeCloseTo(10 / Math.SQRT2);
    expect(b.c[1]).toBeCloseTo(5);
    const cw = bulgeArc([0, 0], [10, 0], -Math.tan(Math.PI / 8))!;
    expect(cw.c[1]).toBeCloseTo(-5);
    // spline 2. stupně přes 3 body: začátek a konec v krajních bodech
    const pts = evalSpline([[0, 0], [5, 10], [10, 0]], [0, 0, 0, 1, 1, 1], 2);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1][0]).toBeCloseTo(10);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(5, 1);
  });

  it("testovací výkres příruby (fixture): rozměry, 5 kružnic, R10 rohy, texty", () => {
    const bytes = new Uint8Array(readFileSync(new URL("../__fixtures__/priruba-cp1250.dxf", import.meta.url)));
    const m = drawingToModel(parseDxf(bytes));
    expect(m.model.parts.map((p) => p.name)).toEqual(["KONTURA", "OSY", "KOTY", "POPIS"]);
    const k = m.topology[0];
    const circles = k.curves.filter((c) => c.kind === "circle");
    expect(circles.map((c) => c.radius!).sort((a, b) => a - b)).toEqual([6, 6, 6, 6, 25]);
    expect(k.curves.filter((c) => c.kind === "arc" && Math.abs(c.radius! - 10) < 1e-9)).toHaveLength(4);
    // obrys 200 × 120
    const xs: number[] = [];
    const ys: number[] = [];
    const seg = m.model.parts[0].lines!;
    for (let i = 0; i < seg.length; i += 3) {
      xs.push(seg[i]);
      ys.push(seg[i + 1]);
    }
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(200);
    expect(Math.max(...ys)).toBeCloseTo(120);
    const texts = m.model.drawing!.texts.map((t) => t.text);
    expect(texts).toContain("PŘÍRUBA — materiál 1.4301, tloušťka 10 mm");
    expect(texts).toContain("⌀50 H7");
    expect(texts).toContain("Nekótované rozměry ISO 2768-mK\nSrazit hrany 0,5×45°");
    // „200" zarovnané na střed
    expect(m.model.drawing!.texts.find((t) => t.text === "200")).toMatchObject({ hAlign: "center", x: 100 });
  });

  it("binární DXF a nesmysl → srozumitelná chyba", () => {
    expect(() => parseDxf(new TextEncoder().encode("AutoCAD Binary DXF\r\n\x1a\0"))).toThrow(/Binární DXF/);
  });
});
