import { describe, expect, it } from "vitest";
import {
  applySelectOp, boxHit, countByKind, diameterCounts, dragBox, expandGroups, kindLabel, polylineRelation, projectedBoxRect,
  rectRelation, rectsOverlap, segmentTouchesRect, segmentsRelation, selectOp, triangleTouchesRect, type Rect,
} from "./box-select";

const R: Rect = { x0: 0, y0: 0, x1: 10, y1: 10 };

function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 32): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number];
  });
}

describe("dragBox / selectOp", () => {
  it("zleva doprava = okno, zprava doleva = křížení; obdélník vždy normalizovaný", () => {
    expect(dragBox(10, 20, 50, 5)).toEqual({ rect: { x0: 10, y0: 5, x1: 50, y1: 20 }, mode: "window" });
    expect(dragBox(50, 5, 10, 20)).toEqual({ rect: { x0: 10, y0: 5, x1: 50, y1: 20 }, mode: "crossing" });
  });
  it("Shift přidá, Ctrl odebere (Ctrl má přednost), jinak nahradí", () => {
    expect(selectOp({})).toBe("replace");
    expect(selectOp({ shift: true })).toBe("add");
    expect(selectOp({ ctrl: true })).toBe("remove");
    expect(selectOp({ shift: true, ctrl: true })).toBe("remove");
  });
  it("applySelectOp nahradí / přidá / odebere a nemění původní množinu", () => {
    const cur = new Set([1, 2, 3]);
    expect([...applySelectOp(cur, [3, 4], "replace")]).toEqual([3, 4]);
    expect([...applySelectOp(cur, [3, 4], "add")].sort()).toEqual([1, 2, 3, 4]);
    expect([...applySelectOp(cur, [2, 9], "remove")]).toEqual([1, 3]);
    expect([...cur]).toEqual([1, 2, 3]);
  });
});

describe("úsečky a obdélník", () => {
  it("dotyk: bod uvnitř, průchod napříč, mimo, dotyk rohem", () => {
    expect(segmentTouchesRect(5, 5, 20, 20, R)).toBe(true);
    expect(segmentTouchesRect(-5, 5, 15, 5, R)).toBe(true); // napříč, oba konce venku
    expect(segmentTouchesRect(-5, -1, 15, -1, R)).toBe(false);
    expect(segmentTouchesRect(-5, 15, 15, -5, R)).toBe(true); // úhlopříčka přes roh
    expect(segmentTouchesRect(11, -5, 25, 9, R)).toBe(false); // šikmo kolem rohu
    expect(segmentTouchesRect(-5, 0, 0, -5, R)).toBe(false); // jen se blíží k rohu
    expect(segmentTouchesRect(-5, 5, 0, 0, R)).toBe(true); // končí v rohu
  });
  it("okno = všechny úsečky celé uvnitř, křížení = kterákoli se dotýká", () => {
    // xyz po bodech: úsečka 1 uvnitř, úsečka 2 vyčnívá
    const seg = [1, 1, 0, 9, 1, 0, 9, 1, 0, 15, 5, 0];
    expect(segmentsRelation(seg, 0, 1, R)).toBe(2);
    expect(segmentsRelation(seg, 0, 2, R)).toBe(1);
    expect(segmentsRelation(seg, 1, 2, R)).toBe(1);
    expect(segmentsRelation([20, 20, 0, 30, 30, 0], 0, 1, R)).toBe(0);
    expect(boxHit(2, "window") && boxHit(1, "crossing") && !boxHit(1, "window") && !boxHit(0, "crossing")).toBe(true);
  });
  it("posun (rozebraná sestava) se přičte", () => {
    expect(segmentsRelation([1, 1, 2, 2], 0, 1, R, 2)).toBe(2);
    expect(segmentsRelation([1, 1, 2, 2], 0, 1, R, 2, 20, 0)).toBe(0);
  });
  it("lomená čára: uzavřený čtverec přesahující okraj obdélníku", () => {
    const sq: [number, number][] = [[2, 2], [8, 2], [8, 8], [2, 8]];
    expect(polylineRelation(sq, R, true)).toBe(2);
    expect(polylineRelation(sq.map(([x, y]) => [x + 5, y] as [number, number]), R, true)).toBe(1);
    // obdélník výběru uvnitř velkého čtverce: obrys se ho nedotkne
    expect(polylineRelation([[-5, -5], [15, -5], [15, 15], [-5, 15]], R, true)).toBe(0);
  });
});

describe("oblouky (rozložené na úsečky)", () => {
  it("půlkružnice nad obdélníkem: okno ne, křížení ano jen když ji obdélník protne", () => {
    const top = arc(5, 5, 4, 0, Math.PI);
    expect(polylineRelation(top, R)).toBe(2);
    const big = arc(5, 0, 8, 0, Math.PI); // vrchol y = 8, konce na x = −3 a 13
    expect(polylineRelation(big, R)).toBe(1);
    // oblouk kolem obdélníku (střed uvnitř, poloměr větší než úhlopříčka) se ho nedotkne
    expect(polylineRelation(arc(5, 5, 9, 0, Math.PI * 2, 64), R, true)).toBe(0);
    // malý výběr na oblouku
    const small: Rect = { x0: 8.5, y0: 4, x1: 9.5, y1: 6 };
    expect(polylineRelation(top, small)).toBe(1);
  });
});

describe("obdélníky a promítnuté kvádry", () => {
  it("vztah obdélníků", () => {
    expect(rectRelation({ x0: 1, y0: 1, x1: 2, y1: 2 }, R)).toBe(2);
    expect(rectRelation({ x0: 9, y0: 9, x1: 12, y1: 12 }, R)).toBe(1);
    expect(rectRelation({ x0: 11, y0: 1, x1: 12, y1: 2 }, R)).toBe(0);
    expect(rectsOverlap({ x0: 10, y0: 10, x1: 12, y1: 12 }, R)).toBe(true);
  });
  it("kvádr promítnutý pohledem shora / izometricky", () => {
    const top = projectedBoxRect([0, 0, 0], [10, 20, 5], (x, y) => [x * 2, 40 - y * 2]);
    expect(top).toEqual({ x0: 0, y0: 0, x1: 20, y1: 40 });
    const iso = projectedBoxRect([0, 0, 0], [1, 1, 1], (x, y, z) => [x - y, z]);
    expect(iso).toEqual({ x0: -1, y0: 0, x1: 1, y1: 1 });
  });
  it("trojúhelník: vrchol uvnitř, hrana napříč, obdélník uvnitř trojúhelníku, mimo", () => {
    expect(triangleTouchesRect(5, 5, 20, 5, 20, 20, R)).toBe(true);
    expect(triangleTouchesRect(-5, 5, 15, 5, 5, 30, R)).toBe(true);
    expect(triangleTouchesRect(-50, -50, 100, -50, 0, 100, R)).toBe(true);
    expect(triangleTouchesRect(20, 20, 30, 20, 25, 30, R)).toBe(false);
  });
});

describe("skupiny (díl / podsestava)", () => {
  const groups: Record<number, number[]> = { 0: [0, 1], 1: [0, 1], 2: [2], 3: [3, 4], 4: [3, 4] };
  const g = (i: number) => groups[i];
  it("okno: jen skupiny se všemi viditelnými tělesy uvnitř", () => {
    expect(expandGroups(new Set([0, 2, 3]), g, () => true, "window").sort()).toEqual([2]);
    // skryté těleso 4 se nepočítá
    expect(expandGroups(new Set([0, 2, 3]), g, (i) => i !== 4, "window").sort()).toEqual([2, 3]);
  });
  it("křížení: celé skupiny, kterých se výběr dotkl", () => {
    expect(expandGroups(new Set([0, 3]), g, () => true, "crossing").sort()).toEqual([0, 1, 3, 4]);
  });
});

describe("souhrn výběru výkresu", () => {
  it("počty po druzích v ustáleném pořadí a české tvary", () => {
    expect(countByKind(["text", "line", "circle", "line", "dimension"])).toEqual([["line", 2], ["circle", 1], ["dimension", 1], ["text", 1]]);
    expect(kindLabel("line", 1)).toBe("1 úsečka");
    expect(kindLabel("line", 3)).toBe("3 úsečky");
    expect(kindLabel("line", 12)).toBe("12 úseček");
    expect(kindLabel("dimension", 5)).toBe("5 kót");
  });
  it("průměry kružnic od nejčastějšího", () => {
    expect(diameterCounts([5, 5, 4, 5.0001, 12.5])).toEqual([[10, 3], [8, 1], [25, 1]]);
  });
});
