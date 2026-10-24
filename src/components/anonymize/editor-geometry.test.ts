import { describe, it, expect } from "vitest";
import {
  addRect, anchorScroll, clampZoom, diffCounts, fromServer, lineAt, lineState, needsKeepConfirm, pinchZoom, rectFromDrag, regionsBox, stampZoom,
  titleBlockBox, toggleLine, toggleRegion, toManualSet, touchesKeep, uniqueText, zoomToBox, type EdLine, type ServerRegion,
} from "./editor-geometry";

const server: ServerRegion[] = [
  { id: "r1", page: 1, x: 0.6, y: 0.8, w: 0.1, h: 0.02, category: "company", source: "rule", zone: "title_block" },
  { id: "r2", page: 1, x: 0.6, y: 0.85, w: 0.05, h: 0.02, category: "person", source: "ai", manual: "removed" },
  { id: "m1", page: 1, x: 0.1, y: 0.1, w: 0.1, h: 0.1, category: "other", source: "manual", manual: "added" },
];
const line = (id: string, x: number, y: number, w = 0.1, h = 0.02, text = "STROJMETAL a.s."): EdLine => ({ id, x, y, w, h, text, zone: "title_block" });

describe("editor anonymizace — geometrie", () => {
  it("server → stav → ruční sada (removed / added) beze ztráty", () => {
    const ed = fromServer(server);
    expect(ed.map((r) => [r.id, r.state, Boolean(r.added)])).toEqual([["r1", "on", false], ["r2", "off", false], ["m1", "on", true]]);
    const m = toManualSet(ed);
    expect(m.map((r) => [r.id, r.manual])).toEqual([["r2", "removed"], ["m1", "added"]]);
    expect(diffCounts(ed, ed)).toEqual({ added: 0, removed: 0 });
  });

  it("ťuknutí na řádek: smazaný → nechat, nechaný → zase smazat, prázdný → přidat ruční oblast", () => {
    let ed = fromServer(server);
    const l1 = line("L1", 0.6, 0.8);
    expect(lineState(l1, ed, 1)).toBe("on");
    ed = toggleLine(ed, l1, 1);
    expect(lineState(l1, ed, 1)).toBe("off");
    expect(toManualSet(ed).some((r) => r.id === "r1" && r.manual === "removed")).toBe(true);
    ed = toggleLine(ed, l1, 1);
    expect(lineState(l1, ed, 1)).toBe("on");
    const l2 = line("L2", 0.3, 0.5, 0.2, 0.02, "Kreslil: Novák");
    ed = toggleLine(ed, l2, 1);
    expect(lineState(l2, ed, 1)).toBe("on");
    const added = ed.find((r) => r.added && r.id !== "m1")!;
    expect(added.x).toBeLessThan(0.3);
    expect(added.w).toBeGreaterThan(0.2);
    // zrušit ručně přidanou → zmizí úplně
    ed = toggleLine(ed, l2, 1);
    expect(ed.some((r) => r.id === added.id)).toBe(false);
    expect(diffCounts(ed, fromServer(server))).toEqual({ added: 0, removed: 0 });
  });

  it("přepínač oblasti, obdélník z tažení, rozdíl +n/−m", () => {
    const init = fromServer(server);
    let ed = toggleRegion(init, "r1");
    ed = toggleRegion(ed, "r2");
    ed = toggleRegion(ed, "m1");
    expect(ed.some((r) => r.id === "m1")).toBe(false);
    const box = rectFromDrag({ x: 0.5, y: 0.5 }, { x: 0.4, y: 0.45 })!;
    expect(box).toEqual({ x: 0.4, y: 0.45, w: expect.closeTo(0.1, 6), h: expect.closeTo(0.05, 6) });
    expect(rectFromDrag({ x: 0.5, y: 0.5 }, { x: 0.501, y: 0.6 })).toBeNull();
    ed = addRect(ed, box, 1);
    expect(diffCounts(ed, init)).toEqual({ added: 2, removed: 2 });
    expect(rectFromDrag({ x: 0.95, y: 0.95 }, { x: 1.3, y: 1.2 })).toEqual({ x: 0.95, y: 0.95, w: expect.closeTo(0.05, 6), h: expect.closeTo(0.05, 6) });
  });

  it("řádek pod prstem, potvrzení u technického údaje", () => {
    const ls = [line("a", 0.1, 0.1, 0.5, 0.05), line("b", 0.2, 0.11, 0.1, 0.02)];
    expect(lineAt(ls, { x: 0.25, y: 0.12 })!.id).toBe("b");
    expect(lineAt(ls, { x: 0.9, y: 0.9 })).toBeNull();
    expect(needsKeepConfirm({ text: "Materiál: 1.4301", zone: "title_block" })).toBe(true);
    expect(needsKeepConfirm({ text: "Ø25 h7", zone: "body" })).toBe(true);
    expect(needsKeepConfirm({ text: "Kreslil: J. Novák", zone: "title_block" })).toBe(false);
  });

  it("ťuknutí „nechat“ na řádku pod sloučenou oblastí neodkryje sousední řádky", () => {
    // jedna oblast (sloučená mergeRegions) přes adresu i telefon
    const merged: ServerRegion[] = [{ id: "rm", page: 1, x: 0.6, y: 0.80, w: 0.3, h: 0.05, category: "contact", source: "rule", zone: "title_block" }];
    const addr = line("A", 0.6, 0.80, 0.3, 0.02, "Prumyslova 1234/5, Kladno");
    const tel = line("T", 0.6, 0.825, 0.3, 0.02, "Tel.: +420 312 456 789");
    let ed = fromServer(merged);
    expect(lineState(addr, ed, 1)).toBe("on");
    expect(lineState(tel, ed, 1)).toBe("on");
    ed = toggleLine(ed, addr, 1, [addr, tel]);
    expect(lineState(addr, ed, 1)).not.toBe("on");
    expect(lineState(tel, ed, 1)).toBe("on");
    // a zpět: smazat adresu znovu
    ed = toggleLine(ed, addr, 1, [addr, tel]);
    expect(lineState(addr, ed, 1)).toBe("on");
    expect(lineState(tel, ed, 1)).toBe("on");
  });

  it("chráněné pole: řádek s keep ze serveru a obdélník přes keep box chtějí potvrzení", () => {
    expect(needsKeepConfirm({ text: "Hridel vstupni", zone: "title_block", keep: true })).toBe(true);
    expect(needsKeepConfirm({ text: "Hridel vstupni", zone: "title_block" })).toBe(false);
    const keep = [{ x: 0.7, y: 0.9, w: 0.1, h: 0.02, field: "drawingNumber" }];
    expect(touchesKeep({ x: 0.72, y: 0.89, w: 0.05, h: 0.05 }, keep, [])).toBe(true);
    expect(touchesKeep({ x: 0.1, y: 0.1, w: 0.05, h: 0.05 }, keep, [])).toBe(false);
    expect(touchesKeep({ x: 0.1, y: 0.1, w: 0.05, h: 0.05 }, [], [{ ...line("k", 0.1, 0.1), keep: true }])).toBe(true);
  });

  it("výřez náhledu kolem smazaných oblastí (obal + rezerva, jen daná strana)", () => {
    const b = regionsBox([{ page: 1, x: 0.6, y: 0.8, w: 0.1, h: 0.02 }, { page: 1, x: 0.75, y: 0.9, w: 0.1, h: 0.03 }, { page: 2, x: 0, y: 0, w: 0.1, h: 0.1 }], 1, 0.03)!;
    expect(b.x).toBeCloseTo(0.57);
    expect(b.y).toBeCloseTo(0.77);
    expect(b.x + b.w).toBeCloseTo(0.88);
    expect(b.y + b.h).toBeCloseTo(0.96);
    expect(regionsBox([], 1)).toBeNull();
  });

  it("dva prsty: bod pod prsty zůstane na místě, razítko podle skutečné velikosti okna", () => {
    // střed prstů v polovině obsahu, 100 px od levého horního rohu okna; obsah po přiblížení 2000×1400
    expect(anchorScroll({ x: 0.5, y: 0.5 }, { w: 2000, h: 1400 }, { x: 100, y: 80 })).toEqual({ left: 900, top: 620 });
    // razítko 0,4 × 0,2 stránky v okně 360 × 260 při šířce stránky 360 (aspect 1,414)
    const z = stampZoom({ x: 0.6, y: 0.8, w: 0.4, h: 0.2 }, 360, 1.414, 360, 260);
    expect(z).toBeCloseTo(Math.min(360 / (360 * 0.4), 260 / ((360 / 1.414) * 0.2)) * 0.95, 5);
  });

  it("texty oblastí bez opakování", () => {
    expect(uniqueText(["J. Novák", "J. Novák", " Tel.: +420 1 ", "Tel.: +420 1"])).toBe("J. Novák · Tel.: +420 1");
  });

  it("přiblížení: meze, dva prsty, razítko", () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(99)).toBe(6);
    expect(pinchZoom(2, 100, 150)).toBe(3);
    expect(pinchZoom(2, 0, 150)).toBe(2);
    const tb = titleBlockBox([{ x: 0.6, y: 0.8, w: 0.3, h: 0.1, zone: "title_block" }]);
    expect(tb.x).toBeCloseTo(0.58);
    expect(titleBlockBox([])).toEqual({ x: 0.5, y: 0.65, w: 0.5, h: 0.35 });
    const z = zoomToBox({ x: 0.5, y: 0.5, w: 0.25, h: 0.25 });
    expect(z.zoom).toBe(4);
    expect(z.cx).toBeCloseTo(0.625);
  });
});
