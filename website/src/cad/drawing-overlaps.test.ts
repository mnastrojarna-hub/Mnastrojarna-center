/**
 * Vlna 22, bod 17 (+ kritik M7) – kontrola překryvů celého listu (cad/drawing-overlaps.ts), bez jádra: balónky, odkazové
 * čáry, texty, kóty, geometrie pohledů, tabulky a rám. Čistý list = 0; každý druh překryvu se pozná a spočítá.
 */
import { describe, expect, it } from "vitest";
import type { DrawingResult, DText, Poly } from "./drawing";
import { overlapIssueText, overlapSummary, sheetOverlaps } from "./drawing-overlaps";

type Sheet = Pick<DrawingResult, "polys" | "texts" | "balloons" | "tables" | "frameRect" | "zones">;
/** list 420 × 297 s rámem, razítkem, obdélníkem pohledu (viditelné hrany) a kótou nad ním */
function base(): Sheet {
  const box = (x: number, y: number, w: number, h: number): Poly => ({ layer: "visible", pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]] });
  const polys: Poly[] = [box(100, 100, 100, 60)];
  const texts: DText[] = [{ x: 150, y: 90, s: "100", size: 3.5, anchor: "middle", layer: "dim" }];
  return { polys, texts, balloons: [], tables: [{ kind: "title", x: 230, y: 249, w: 180, h: 38 }], frameRect: { x: 20, y: 10, w: 390, h: 277 } };
}
const balloon = (pos: number, x: number, y: number, a: [number, number]) => ({ pos, x, y, a, r: 4, id: `pos:${pos}` });
const withNum = (s: Sheet, b: ReturnType<typeof balloon>) => {
  s.balloons!.push(b);
  s.texts.push({ x: b.x, y: b.y + 1.3, s: String(b.pos), size: 3.5, anchor: "middle", bold: true, layer: "dim" });
};

describe("kontrola překryvů listu (bod 17)", () => {
  it("čistý list: 0 překryvů, žádné hlášení", () => {
    const s = base();
    withNum(s, balloon(1, 80, 80, [110, 110]));
    withNum(s, balloon(2, 220, 80, [190, 110]));
    const o = sheetOverlaps(s);
    expect(o.total).toBe(0);
    expect(o.balloons).toBe(2);
    expect(overlapIssueText(o)).toBeNull();
    expect(overlapSummary(o)).toBe("0");
  });

  it("balónek × balónek, balónek × text, balónek × razítko, balónek × rám, balónek × geometrie", () => {
    const s = base();
    withNum(s, balloon(1, 60, 60, [110, 110]));
    withNum(s, balloon(2, 64, 62, [120, 110])); // přes balónek 1
    withNum(s, balloon(3, 150, 90, [150, 110])); // přes text kóty „100“
    withNum(s, balloon(4, 300, 260, [190, 150])); // v razítku
    withNum(s, balloon(5, 21, 150, [110, 150])); // přes rám
    withNum(s, balloon(6, 100, 130, [105, 130])); // na hraně pohledu
    const o = sheetOverlaps(s);
    expect(o.byKind["balloon-balloon"]).toBe(1);
    expect(o.byKind["balloon-text"]).toBeGreaterThanOrEqual(1);
    expect(o.byKind["balloon-table"]).toBe(1);
    expect(o.byKind["balloon-frame"]).toBe(1);
    expect(o.byKind["balloon-geometry"]).toBe(1);
    expect(o.total).toBe(o.hits.length);
    expect(overlapIssueText(o)).toMatch(/překryvů/);
  });

  it("odkazová čára přes cizí balónek a křížení odkazů", () => {
    const s = base();
    withNum(s, balloon(1, 60, 60, [190, 150]));
    withNum(s, balloon(2, 125, 105.5, [104, 104])); // leží na čáře 1 (60,60) → (190,150)? ne – vlastní test níže
    withNum(s, balloon(3, 60, 160, [190, 110]));
    withNum(s, balloon(4, 230, 60, [104, 150]));
    const o = sheetOverlaps(s);
    expect(o.crossings).toBeGreaterThanOrEqual(1);
    const s2 = base();
    withNum(s2, balloon(1, 40, 40, [140, 140]));
    withNum(s2, balloon(2, 90, 90, [95, 140])); // střed přesně na odkazu balónku 1
    expect(sheetOverlaps(s2).byKind["leader-balloon"]).toBeGreaterThanOrEqual(1);
  });

  it("kóty × kóty, text × geometrie, tabulka × pohled, text přes rám (kritik M7)", () => {
    const s = base();
    s.texts.push({ x: 151, y: 90.5, s: "60", size: 3.5, anchor: "middle", layer: "dim" }); // přes „100“
    s.texts.push({ x: 95, y: 130, s: "POZNÁMKA", size: 3.5, layer: "text" }); // přes hranu pohledu x=100
    s.polys.push({ layer: "visible", pts: [[300, 240], [320, 260]] }); // geometrie do razítka
    s.texts.push({ x: 18, y: 50, s: "přes rám", size: 3.5, layer: "text" });
    const o = sheetOverlaps(s);
    expect(o.byKind["text-text"]).toBe(1);
    expect(o.byKind["text-geometry"]).toBeGreaterThanOrEqual(1);
    expect(o.byKind["table-geometry"]).toBe(1);
    expect(o.byKind["text-frame"]).toBe(1);
  });

  it("texty uvnitř tabulek (razítko, kusovník) se mezi sebou nekontrolují; zóny v okraji listu ano jen přes rám", () => {
    const s = base();
    s.texts.push({ x: 240, y: 260, s: "Název", size: 3.5, layer: "text" }, { x: 241, y: 260, s: "Název2", size: 3.5, layer: "text" });
    s.zones = { cols: 8, rows: 6, x: 20, y: 10, w: 390, h: 277 };
    s.texts.push({ x: 60, y: 6, s: "1", size: 3, anchor: "middle", layer: "text" }); // zóna celá v okraji
    const o = sheetOverlaps(s);
    expect(o.total).toBe(0);
  });
});
