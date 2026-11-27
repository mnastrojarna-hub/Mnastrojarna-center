import { beforeEach, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { boxMode, clickMode, holdPhase, isCrossing, isDoubleClick, isDrag, mergeSelection, pickShape, polyInside, polyTouches, rectFrom, segTouchesRect, selectShapes, shapeHit, sketchBoxIds, type BoxShape, type P2 } from "./box-select-2d";
import { annotationShapes, annotationsInBox, deleteAnnotations, moveAnnotation, moveAnnotations } from "./drawing-boxsel";
import { annotationGeometry, type PlacedView } from "./drawing";
import type { DrawingAnnotation } from "./types";
import "./draft/index";
import { newDraftModel } from "./draft/doc";
import { runScript } from "./draft/commands";
import { sessionFor } from "./draft/session";
import { spatialIndex } from "./draft/spatial";
import { windowSelect, windowWord } from "./draft/select";

const R = rectFrom([0, 0], [10, 10]);

describe("výběr oknem 2D – pravidla", () => {
  it("směr: zleva doprava okno, zprava doleva křížení; klik < 5 px", () => {
    expect(isCrossing([10, 0], [0, 5])).toBe(true);
    expect(isCrossing([0, 0], [10, 5])).toBe(false);
    expect(isDrag([0, 0], [3, 3])).toBe(false); // 4,2 px
    expect(isDrag([0, 0], [4, 3])).toBe(true); // 5 px
    expect(rectFrom([5, 9], [1, 2])).toEqual({ x0: 1, y0: 2, x1: 5, y1: 9 });
  });
  it("modifikátory okna: bez = nahradí, Ctrl/⌘/Shift = přidá, Ctrl+Shift/Alt = odebere; výzva výběru přidává", () => {
    expect(boxMode({})).toBe("replace");
    expect(boxMode({ ctrlKey: true })).toBe("add");
    expect(boxMode({ metaKey: true })).toBe("add");
    expect(boxMode({ shiftKey: true })).toBe("add");
    expect(boxMode({ ctrlKey: true, shiftKey: true })).toBe("remove");
    expect(boxMode({ altKey: true })).toBe("remove");
    expect(boxMode({}, true)).toBe("add");
    expect(boxMode({ altKey: true }, true)).toBe("remove");
    // modifikátory stisku a puštění se sčítají
    expect(boxMode([{ ctrlKey: true }, { shiftKey: true }])).toBe("remove");
  });
  it("klik: bez = nahradí, Ctrl/Shift = přepne, Ctrl+Shift = odebere", () => {
    expect(clickMode({})).toBe("replace");
    expect(clickMode({ shiftKey: true })).toBe("toggle");
    expect(clickMode({ ctrlKey: true, shiftKey: true })).toBe("remove");
    expect(clickMode({}, true)).toBe("add");
    expect(mergeSelection(["a", "b"], ["c"], "replace")).toEqual(["c"]);
    expect(mergeSelection(["a", "b"], ["c"], "add")).toEqual(["a", "b", "c"]);
    expect(mergeSelection(["a", "b"], ["b", "z"], "remove")).toEqual(["a"]);
    expect(mergeSelection(["a", "b"], ["b"], "toggle")).toEqual(["a"]);
    expect(mergeSelection(["a"], ["b"], "toggle")).toEqual(["a", "b"]);
  });
  it("dotyk: dlouhý stisk na místě = okno, posun dřív = posun pohledu", () => {
    expect(holdPhase([0, 0], 0, [2, 2], 200)).toBe("wait");
    expect(holdPhase([0, 0], 0, [3, 3], 600)).toBe("hold");
    expect(holdPhase([0, 0], 0, [20, 0], 100)).toBe("moved");
  });

  it("poklepání (vlna 22, oprava regrese W20): druhý stisk do 350 ms a 6 px není druhý roh okna", () => {
    // plátno 2D výkresu: klik do prázdna otevře okno dvěma kliky; druhý stisk na stejném místě hned potom je poklepání
    // (výřez rozvržení → modelový prostor), ne nulové okno, které by poklepání spolklo
    expect(isDoubleClick([100, 100], 1000, [101, 102], 1200)).toBe(true);
    expect(isDoubleClick([100, 100], 1000, [100, 100], 1349)).toBe(true);
    expect(isDoubleClick([100, 100], 1000, [100, 100], 1350)).toBe(false); // pomalé druhé kliknutí = druhý roh okna
    expect(isDoubleClick([100, 100], 1000, [106, 100], 1100)).toBe(false); // jiné místo = druhý roh okna
    expect(isDoubleClick([100, 100], 1000, [140, 160], 1100)).toBe(false);
  });
});

describe("výběr oknem 2D – geometrie", () => {
  it("úsečka protínající okno bez koncového bodu uvnitř: křížení ano, okno ne", () => {
    const line: P2[] = [[-5, 5], [15, 5]];
    expect(segTouchesRect(line[0], line[1], R)).toBe(true);
    expect(polyInside(line, R)).toBe(false);
    expect(polyTouches(line, R)).toBe(true);
    expect(segTouchesRect([-5, -5], [-1, 20], R)).toBe(false);
    // úhlopříčka těsně míjí roh
    expect(segTouchesRect([11, 0], [20, -9], R)).toBe(false);
    expect(segTouchesRect([10, 10], [20, 20], R)).toBe(true); // dotyk v rohu
  });
  it("křivka částečně uvnitř: okno ji nevybere, křížení ano; celá uvnitř vybere obojí", () => {
    const shapes: BoxShape[] = [
      { id: "in", polys: [[[1, 1], [9, 9]]] },
      { id: "half", polys: [[[5, 5], [15, 5], [15, 15]]] },
      { id: "out", polys: [[[20, 20], [30, 30]]] },
      { id: "pt", pts: [[2, 8]] },
      { id: "txt", rects: [{ x0: 8, y0: 8, x1: 12, y1: 9 }] },
    ];
    expect(selectShapes(shapes, R, false)).toEqual(["in", "pt"]);
    expect(selectShapes(shapes, R, true)).toEqual(["in", "half", "pt", "txt"]);
    // okno uvnitř velké kružnice (kružnice okno neprotne) – křížení ji nevybere
    const ring: P2[] = Array.from({ length: 65 }, (_, i) => [5 + 50 * Math.cos((i / 64) * 2 * Math.PI), 5 + 50 * Math.sin((i / 64) * 2 * Math.PI)]);
    expect(shapeHit({ id: "ring", polys: [ring] }, R, true)).toBe(false);
    expect(shapeHit({ id: "empty" }, R, true)).toBe(false);
  });
  it("klik: nejbližší tvar v toleranci, text uvnitř obdélníku", () => {
    const shapes: BoxShape[] = [
      { id: "a", polys: [[[0, 0], [10, 0]]] },
      { id: "t", rects: [{ x0: 0, y0: 5, x1: 10, y1: 8 }] },
    ];
    expect(pickShape(shapes, [5, 0.4], 1)).toBe("a");
    expect(pickShape(shapes, [5, 6], 1)).toBe("t");
    expect(pickShape(shapes, [5, 3], 1)).toBe(null);
  });
  it("skica: body podle polohy, křivky podle dráhy", () => {
    const ents = [
      { id: "p", type: "point", p: [2, 2] as const },
      { id: "l", type: "line" },
      { id: "c", type: "circle" },
    ];
    const paths = new Map<string, { pts: P2[] }>([
      ["l", { pts: [[-5, 5], [15, 5]] }],
      ["c", { pts: [[4, 5], [5, 6], [6, 5], [5, 4], [4, 5]] }],
    ]);
    expect(sketchBoxIds(ents, paths, [0, 0], [10, 10]).sort()).toEqual(["c", "p"]);
    expect(sketchBoxIds(ents, paths, [10, 10], [0, 0]).sort()).toEqual(["c", "l", "p"]);
  });
});

describe("2D výkres – okno, křížení, viditelnost, o / k, výkon", () => {
  beforeEach(() => setLang("cs"));
  it("okno / křížení textem (o / k / okno / křížení), vypnutá hladina se nevybere", () => {
    let m = newDraftModel();
    const s = sessionFor(m);
    const run = (t: string) => {
      const r = runScript(m, s, t);
      m = r.model;
      return r.results;
    };
    run("čára 0,0 100,0; kružnice 50,50 5; čára 40,60 60,40; hladina nová SKRYTA; hladina aktuální SKRYTA; kružnice 20,20 2; hladina aktuální 0; hladina SKRYTA vypnout");
    const idx = spatialIndex(m.entities, { model: m });
    expect(windowSelect(m, idx, { x0: 40, y0: 40, x1: 60, y1: 60 }, false).sort()).toEqual(["e2", "e3"]);
    expect(windowSelect(m, idx, { x0: 45, y0: -1, x1: 55, y1: 1 }, false)).toEqual([]);
    expect(windowSelect(m, idx, { x0: 45, y0: -1, x1: 55, y1: 1 }, true)).toEqual(["e1"]);
    // vypnutá hladina
    expect(windowSelect(m, idx, { x0: 0, y0: 0, x1: 100, y1: 100 }, true)).not.toContain("e4");
    let r = run("vyber o 40,40 60,60");
    expect(r[0].error).toBeUndefined();
    expect([...s.sel].sort()).toEqual(["e2", "e3"]);
    r = run("vyber nic; vyber k 45,-1 55,1");
    expect(s.sel).toEqual(["e1"]);
    r = run("vyber nic; vyber křížení 45,-1 55,1 přidat okno 40,40 60,60");
    expect([...s.sel].sort()).toEqual(["e1", "e2", "e3"]);
    // samotné písmeno bez rohů výběr nespotřebuje (patří další výzvě) – chyba „nadbytečné zadání“, ne „zadejte rohy“
    r = run("vyber o");
    expect(r[0].error).toMatch(/nadbytečné|zadejte/);
    expect(windowWord("o")).toBe("window");
    expect(windowWord("_crossing")).toBe("crossing");
    expect(windowWord("K")).toBe("crossing");
    expect(windowWord("okno")).toBe("window");
    expect(windowWord("e3")).toBe(null);
  });
  it("10 000 entit: okno přes všechno < 200 ms", () => {
    let m = newDraftModel();
    const s = sessionFor(m);
    const lines: string[] = [];
    for (let i = 0; i < 10000; i++) lines.push(`čára ${(i % 100) * 3},${Math.floor(i / 100) * 3} @2,2`);
    m = runScript(m, s, lines.join("\n")).model;
    const idx = spatialIndex(m.entities, { model: m });
    windowSelect(m, idx, { x0: 0, y0: 0, x1: 10, y1: 10 }, true); // zahřátí
    const t0 = performance.now();
    const w = windowSelect(m, idx, { x0: -10, y0: -10, x1: 310, y1: 310 }, false);
    const t1 = performance.now();
    const c = windowSelect(m, idx, { x0: 50, y0: 50, x1: 200, y1: 200 }, true);
    const t2 = performance.now();
    expect(w.length).toBe(10000);
    expect(c.length).toBeGreaterThan(2000);
    expect(t1 - t0).toBeLessThan(200);
    expect(t2 - t1).toBeLessThan(200);
  });
});

describe("výkres dílu – poznámky oknem, posun, smazání", () => {
  beforeEach(() => setLang("cs"));
  // pohled „front“: list = (px + (q − x0)·s, py + (q − y0)·s), měřítko 2
  const views: PlacedView[] = [{ key: "front", px: 50, py: 50, s: 2, x0: 0, y0: 0, w: 50, h: 30 }];
  const res = { views, scaleValue: 2 };
  const anns: DrawingAnnotation[] = [
    { id: "t1", view: "sheet", type: "text", at: [20, 20], text: "AAA", size: 3.5 },
    { id: "t2", view: "sheet", type: "text", at: [120, 20], text: "BBB", size: 3.5 },
    { id: "d1", view: "front", type: "dim", kind: "horizontal", a: [0, 0], b: [20, 0], offset: -8, auto: "len:x" },
    { id: "n1", view: "front", type: "note", at: [30, 10], leader: [25, 5], text: "SRAZIT" },
  ];
  it("tvary poznámek z geometrie výkresu; okno a křížení na listu", () => {
    const sh = annotationShapes(res, anns);
    expect(sh.map((x) => x.id)).toEqual(["t1", "t2", "d1", "n1"]);
    expect(annotationsInBox(sh, { x0: 0, y0: 0, x1: 60, y1: 40 }, false)).toEqual(["t1"]);
    // kóta: list x 50…90, kótovací čára y = 50 − 8 = 42
    expect(annotationsInBox(sh, { x0: 40, y0: 30, x1: 100, y1: 60 }, false)).toEqual(["d1"]);
    expect(annotationsInBox(sh, { x0: 85, y0: 30, x1: 99, y1: 55 }, false)).toEqual([]);
    expect(annotationsInBox(sh, { x0: 85, y0: 30, x1: 99, y1: 55 }, true)).toEqual(["d1"]);
  });
  it("posun: text celý, kóta jen kótovací čárou, poznámka bez odkazu; geometrie se posune o d", () => {
    const t = moveAnnotation(views, anns[0], [5, -3]);
    expect(t.type === "text" && t.at).toEqual([25, 17]);
    const d = moveAnnotation(views, anns[2], [7, 4]);
    expect(d.type === "dim" && d.kind === "horizontal" && [d.a, d.b, d.offset]).toEqual([[0, 0], [20, 0], -4]);
    const n = moveAnnotation(views, anns[3], [4, 2]);
    // pohled s měřítkem 2: 4 mm listu = 2 mm pohledu; odkaz (šipka u prvku) zůstává
    expect(n.type === "note" && [n.at, n.leader]).toEqual([[32, 11], [25, 5]]);
    const before = annotationGeometry(res, [anns[0]]).texts[0];
    const after = annotationGeometry(res, [t]).texts[0];
    expect([after.x - before.x, after.y - before.y]).toEqual([5, -3]);
    const moved = moveAnnotations(views, anns, ["t1", "t2"], [1, 1]);
    expect(moved.map((a) => (a.type === "text" ? a.at : null))).toEqual([[21, 21], [121, 21], null, null]);
  });
  it("posun průměru a úhlu mění směr a odsazení popisku", () => {
    const dia: DrawingAnnotation = { id: "r", view: "front", type: "dim", kind: "diameter", c: [10, 10], r: 5, ang: 0, offset: 6, };
    const m = moveAnnotation(views, dia, [0, 16]);
    // popisek na listu: C = (70, 70), R = 10, K = (86, 70) → (86, 86): úhel 45°, odsazení |K'−C| − R
    expect(m.type === "dim" && m.kind === "diameter" && [m.ang, m.offset]).toEqual([45, Math.round((Math.hypot(16, 16) - 10) * 100) / 100]);
  });
  it("smazání vybraných: vygenerované kóty se vrátí jako vypnuté (smartOff)", () => {
    const r = deleteAnnotations(anns, ["t2", "d1"]);
    expect(r.anns.map((a) => a.id)).toEqual(["t1", "n1"]);
    expect(r.smartOff).toEqual(["len:x"]);
    expect(r.removed).toBe(2);
  });
});
