/**
 * Vlna 22, bod 17 (+ kritik M7) – kontrola překryvů celého listu (cad/drawing-overlaps.ts), bez jádra: balónky, odkazové
 * čáry, texty, kóty, geometrie pohledů, tabulky a rám. Čistý list = 0; každý druh překryvu se pozná a spočítá.
 */
import { describe, expect, it } from "vitest";
import type { DrawingResult, DText, Poly } from "./drawing";
import { overlapIssueText, overlapSummary, sheetOverlaps, withoutKnownTexts } from "./drawing-overlaps";

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

describe("hlášení listu neopakuje překryv poznámky, který už ohlásil příkaz výkresu (fáze 2, duplicitní ⚠)", () => {
  it("text přes rám ohlášený u poznámky se z hlášení listu vynechá, jiný zůstane; počet listu je úplný", () => {
    const s = base();
    s.texts.push({ x: 405, y: 150, s: "KALIT 58 HRC", size: 5, anchor: "start", layer: "text" }); // přes pravý rám
    s.texts.push({ x: 15, y: 150, s: "JINÝ", size: 5, anchor: "start", layer: "text" }); // přes levý rám
    const all = sheetOverlaps(s);
    expect(all.byKind["text-frame"]).toBe(2);
    const rest = withoutKnownTexts(all, ["KALIT 58 HRC"]);
    expect(rest.byKind["text-frame"]).toBe(1);
    expect(rest.hits.map((h) => h.what)).toEqual(["„JINÝ“"]);
    expect(overlapIssueText(rest)).toMatch(/^1 překryvů – text × rám 1; např\. „JINÝ“/);
    expect(overlapIssueText(withoutKnownTexts(all, ["KALIT 58 HRC", "JINÝ"]))).toBeNull();
    expect(withoutKnownTexts(all, [])).toBe(all);
  });
});

describe("značky skupin děr nevedou přes hrany pohledu (fáze 2 – akceptační nástroj: „A“ přes sousední díru)", () => {
  it("značka u díry se přesune do volného rohu, když první roh křižuje hrana pohledu; bez hrany zůstane vpravo nahoře", async () => {
    const { annotationGeometry, textBox, boxHitsSegs } = await import("./drawing");
    // pohled 1:1 na listu od [100, 100]; díra r 4 ve [20, 20]; svislá hrana x = 24 vpravo od díry (přes první roh značky)
    const view = { key: "top", px: 100, py: 100, s: 1, x0: 0, y0: 0, w: 60, h: 60, ents: [{ t: "line" as const, a: [24, 0] as [number, number], b: [24, 60] as [number, number] }] };
    const ann = { id: "c1", view: "top", type: "callout" as const, tip: [20, 20] as [number, number], at: [40, 40] as [number, number], lines: ["2× Ø8 (A)"], tag: "A", tags: [{ c: [20, 20] as [number, number], r: 4 }] };
    const g = annotationGeometry({ views: [view], scaleValue: 1 }, [ann as never]);
    const tag = g.texts.find((t) => t.s === "A")!;
    const segs: [[number, number], [number, number]][] = [[[124, 100], [124, 160]]];
    expect(boxHitsSegs(textBox(tag), segs)).toBe(false);
    expect(tag.anchor).toBe("end"); // vlevo od díry
    const free = annotationGeometry({ views: [{ ...view, ents: [] }], scaleValue: 1 }, [ann as never]).texts.find((t) => t.s === "A")!;
    expect(free.anchor).toBeUndefined();
    expect(free.x).toBeGreaterThan(120);
  });

  it("kolo 3: centrovací značka rámu přes záhlaví kusovníku / text / balónek se počítá (dřív „Překryvy na listu: 0“)", () => {
    const s = base();
    // A3: značka uprostřed spodního rámu (x = 215) od okraje papíru 5 mm dovnitř rámu; druhý sloupec kusovníku x 50…230 u spodního rámu
    s.polys.push({ layer: "frame", width: 0.7, pts: [[20, 10], [410, 10], [410, 287], [20, 287], [20, 10]] }, { layer: "frame", width: 0.7, pts: [[215, 297], [215, 282]] });
    s.tables!.push({ kind: "bom", x: 50, y: 266, w: 180, h: 21 });
    const o = sheetOverlaps(s);
    expect(o.byKind["table-frame"]).toBe(1);
    expect(o.total).toBe(1);
    expect(overlapIssueText(o)).toMatch(/tabulka × rám 1/);
    expect(overlapSummary(o)).toBe("1 (tabulka × rám 1)");
    // značka levého rámu přes text a balónek
    s.polys.push({ layer: "frame", width: 0.7, pts: [[0, 148.5], [25, 148.5]] });
    s.texts.push({ x: 23, y: 149.5, s: "Poznámka", size: 3.5, anchor: "start", layer: "text" });
    withNum(s, balloon(9, 22, 160, [60, 160]));
    s.polys.push({ layer: "frame", width: 0.7, pts: [[0, 160], [25, 160]] });
    const o2 = sheetOverlaps(s);
    expect(o2.byKind["text-frame"]).toBe(1);
    expect(o2.byKind["balloon-frame"]).toBeGreaterThanOrEqual(1);
  });

  it("kolo 3: čáry rámu jen v okraji listu (rám, zóny, zkrácená značka) se nepočítají", () => {
    const s = base();
    s.polys.push({ layer: "frame", width: 0.7, pts: [[20, 10], [410, 10], [410, 287], [20, 287], [20, 10]] });
    s.polys.push({ layer: "frame", width: 0.7, pts: [[215, 297], [215, 287]] }); // zkrácená značka (končí na čáře rámu)
    s.polys.push({ layer: "frame", pts: [[100, 10], [100, 5]] }, { layer: "frame", pts: [[20, 100], [15, 100]] }); // zóny
    s.tables!.push({ kind: "bom", x: 50, y: 266, w: 180, h: 21 });
    expect(sheetOverlaps(s).total).toBe(0);
  });
});

describe("odkazové čáry × kotvy jiných pozic a × kóty (bod 17, kolo 6)", () => {
  // repro S/w22/repro/17/repro-100.txt: odkaz 72 vedl 0,14 mm od kotvy 82 a 0,28 mm od kotvy 92, odkaz přes kótovací čáru –
  // „Překryvy na listu: 0 (zkontrolováno: balónky, odkazové čáry …)“
  it("odkaz blíž než 1 mm od kotvy jiné pozice = leader-anchor; dál ne", () => {
    const s = base();
    withNum(s, balloon(1, 60, 60, [110, 120]));
    withNum(s, balloon(2, 40, 110, [85.1, 90])); // kotva 0,08 mm od odkazu 1 (střed odkazu)
    const o = sheetOverlaps(s);
    expect(o.byKind["leader-anchor"]).toBe(1);
    expect(o.hits.find((h) => h.kind === "leader-anchor")!.what).toBe("1 → 2");
    expect(overlapSummary(o)).toMatch(/odkazová čára × kotva jiné pozice 1/);
    const far = base();
    withNum(far, balloon(1, 60, 60, [110, 120]));
    withNum(far, balloon(2, 40, 110, [88, 88])); // ~1,6 mm od odkazu
    expect(sheetOverlaps(far).byKind["leader-anchor"]).toBeUndefined();
  });
  it("odkaz přes kótovací / pomocnou čáru nebo text kóty = leader-dim; čáry balónků se nepočítají", () => {
    const s = base();
    s.polys.push({ layer: "dim", pts: [[230, 40], [230, 140]] }); // pomocná čára kóty
    withNum(s, balloon(3, 260, 70, [205, 110])); // odkaz přes x = 230
    withNum(s, balloon(4, 150, 60, [150, 110])); // odkaz svisle přes text „100“ (150; 90)
    // kroužek, odkaz a tečka balónku 4 jako v listu – vlastní čáry se nepočítají
    s.polys.push({ layer: "dim", pts: Array.from({ length: 33 }, (_, i) => [150 + 4 * Math.cos((i * Math.PI) / 16), 60 + 4 * Math.sin((i * Math.PI) / 16)] as [number, number]) });
    s.polys.push({ layer: "dim", pts: [[150, 64], [150, 110]] });
    const o = sheetOverlaps(s);
    expect(o.byKind["leader-dim"]).toBe(2);
    expect(o.hits.filter((h) => h.kind === "leader-dim").map((h) => h.what).sort()).toEqual(["3 × kóta", "4 × „100“"]);
    expect(overlapIssueText(o)).toMatch(/odkazová čára × kóta 2/);
  });
});

