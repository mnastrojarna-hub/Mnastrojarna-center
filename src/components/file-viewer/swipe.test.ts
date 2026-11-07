import { describe, expect, it } from "vitest";
import { swipeAllowed, swipeDirection, SWIPE_MIN_PX } from "./swipe";

const p = (x: number, y: number, t = 0) => ({ x, y, t });

describe("swipe mezi výkresy", () => {
  it("vodorovný tah jedním prstem: doleva = další, doprava = předchozí", () => {
    expect(swipeDirection(p(300, 400), p(150, 410, 250))).toBe(1);
    expect(swipeDirection(p(100, 400), p(260, 380, 250))).toBe(-1);
  });

  it("krátký, svislý (posun stránek PDF) nebo pomalý tah nic nepřepne", () => {
    expect(swipeDirection(p(300, 400), p(300 - (SWIPE_MIN_PX - 1), 400, 100))).toBe(0);
    expect(swipeDirection(p(300, 400), p(220, 200, 200))).toBe(0);
    expect(swipeDirection(p(300, 400), p(100, 400, 2000))).toBe(0);
  });

  it("nebojuje s přiblížením: přiblížený obrázek ne, posuvné PDF jen od doposunutého okraje", () => {
    expect(swipeAllowed({ zoomed: false, scroll: null }, 1, null)).toBe(true);
    expect(swipeAllowed({ zoomed: true, scroll: null }, 1, null)).toBe(false);
    const atLeft = { zoomed: false, scroll: { atStart: true, atEnd: false, left: 0 } };
    expect(swipeAllowed(atLeft, -1, 0)).toBe(true);
    expect(swipeAllowed(atLeft, 1, 0)).toBe(false);
    const atRight = { zoomed: false, scroll: { atStart: false, atEnd: true, left: 500 } };
    expect(swipeAllowed(atRight, 1, 500)).toBe(true);
    // obsah se tahem posunul → posun, ne swipe
    expect(swipeAllowed(atRight, 1, 420)).toBe(false);
  });
});
