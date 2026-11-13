import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LONG_PRESS_MS, LongPress, SCALE_MAX, SCALE_MIN, TOUCH_SLOP_PX, TouchTracker, canvasToMm, clickSlop, mmToCanvas, movedBeyond, pinchView, type SketchView } from "./sketch-touch";

const size = { w: 800, h: 600 };
const view: SketchView = { cx: 10, cy: -5, scale: 4 };
const close = (a: [number, number], b: [number, number]) => {
  expect(a[0]).toBeCloseTo(b[0], 9);
  expect(a[1]).toBeCloseTo(b[1], 9);
};

describe("skica – převod plátno ↔ mm", () => {
  it("střed plátna je bod pohledu, osa Y je obrácená", () => {
    close(canvasToMm(view, size, [400, 300]), [10, -5]);
    close(canvasToMm(view, size, [440, 300]), [20, -5]);
    close(canvasToMm(view, size, [400, 260]), [10, 5]);
  });
  it("mmToCanvas je inverze canvasToMm", () => {
    for (const p of [[0, 0], [123, 456], [799, 1]] as [number, number][]) close(mmToCanvas(view, size, canvasToMm(view, size, p)), p);
  });
});

describe("skica – gesto dvěma prsty (pinchView)", () => {
  it("beze změny prstů vrací původní pohled", () => {
    const v = pinchView(view, size, [100, 100], [300, 200], [100, 100], [300, 200]);
    expect(v.scale).toBeCloseTo(view.scale, 12);
    expect(v.cx).toBeCloseTo(view.cx, 12);
    expect(v.cy).toBeCloseTo(view.cy, 12);
  });
  it("roztažení prstů přiblíží kolem středu sevření – bod pod středem zůstává na místě", () => {
    const a0: [number, number] = [200, 300];
    const b0: [number, number] = [300, 300];
    const a1: [number, number] = [150, 300];
    const b1: [number, number] = [350, 300]; // dvojnásobná rozteč, stejný střed [250, 300]
    const v = pinchView(view, size, a0, b0, a1, b1);
    expect(v.scale).toBeCloseTo(8, 12);
    close(canvasToMm(v, size, [250, 300]), canvasToMm(view, size, [250, 300]));
    // bod mimo střed se od středu vzdálí dvakrát
    const off = mmToCanvas(v, size, canvasToMm(view, size, [350, 300]));
    close(off, [450, 300]);
  });
  it("sevření prstů oddálí", () => {
    const v = pinchView(view, size, [100, 100], [300, 100], [150, 100], [250, 100]);
    expect(v.scale).toBeCloseTo(2, 12);
    close(canvasToMm(v, size, [200, 100]), canvasToMm(view, size, [200, 100]));
  });
  it("společný pohyb obou prstů skicu posune (bez změny měřítka)", () => {
    const v = pinchView(view, size, [100, 100], [200, 100], [160, 70], [260, 70]);
    expect(v.scale).toBeCloseTo(view.scale, 12);
    // bod, který byl pod středem prstů [150, 100], je teď pod novým středem [210, 70]
    close(canvasToMm(v, size, [210, 70]), canvasToMm(view, size, [150, 100]));
    // posun o 60 px vpravo a 30 px nahoru = pohled o 15 mm vlevo a 7,5 mm dolů
    expect(v.cx).toBeCloseTo(view.cx - 15, 9);
    expect(v.cy).toBeCloseTo(view.cy - 7.5, 9);
  });
  it("posun a zoom zároveň: bod pod původním středem prstů je pod novým středem", () => {
    const a0: [number, number] = [300, 200];
    const b0: [number, number] = [340, 260];
    const a1: [number, number] = [100, 420];
    const b1: [number, number] = [220, 500];
    const v = pinchView(view, size, a0, b0, a1, b1);
    expect(v.scale).toBeCloseTo(view.scale * 2, 9);
    close(canvasToMm(v, size, [160, 460]), canvasToMm(view, size, [320, 230]));
  });
  it("měřítko je omezené stejně jako u kolečka", () => {
    expect(pinchView({ cx: 0, cy: 0, scale: 500 }, size, [100, 100], [110, 100], [0, 100], [700, 100]).scale).toBe(SCALE_MAX);
    expect(pinchView({ cx: 0, cy: 0, scale: 0.02 }, size, [0, 100], [700, 100], [100, 100], [102, 100]).scale).toBe(SCALE_MIN);
  });
  it("prsty na sobě (nulová rozteč) měřítko nemění a nevrací NaN", () => {
    const v = pinchView(view, size, [100, 100], [100, 100], [130, 100], [200, 100]);
    expect(v.scale).toBe(view.scale);
    expect(Number.isFinite(v.cx) && Number.isFinite(v.cy)).toBe(true);
  });
});

describe("skica – tolerance pohybu", () => {
  it("movedBeyond porovnává vzdálenost s tolerancí", () => {
    expect(movedBeyond([0, 0], [5, 5], TOUCH_SLOP_PX)).toBe(false); // 7,07 px
    expect(movedBeyond([0, 0], [6, 6], TOUCH_SLOP_PX)).toBe(true); // 8,49 px
    expect(movedBeyond([10, 10], [10, 10], 1)).toBe(false);
  });
  it("prst a pero mají větší toleranci klepnutí než myš", () => {
    expect(clickSlop("mouse")).toBe(4);
    expect(clickSlop("touch")).toBe(TOUCH_SLOP_PX);
    expect(clickSlop("pen")).toBe(TOUCH_SLOP_PX);
    expect(clickSlop("")).toBe(4); // neznámý ukazatel (syntetická událost) = myš
  });
});

describe("skica – dlouhý stisk (LongPress)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("po 500 ms bez pohybu zavolá fire jednou s místem stisku", () => {
    const lp = new LongPress();
    const fire = vi.fn();
    lp.start(7, [120, 80], fire);
    expect(lp.pending).toBe(true);
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith([120, 80]);
    expect(lp.pending).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(fire).toHaveBeenCalledTimes(1);
  });
  it("drobný pohyb (pod 8 px) stisk neruší, větší ano", () => {
    const lp = new LongPress();
    const fire = vi.fn();
    lp.start(1, [100, 100], fire);
    lp.move(1, [104, 103]); // 5 px
    expect(lp.pending).toBe(true);
    lp.move(1, [108, 100]); // 8 px
    expect(lp.pending).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(fire).not.toHaveBeenCalled();
  });
  it("pohyb jiného ukazatele se nepočítá; cancel (zvednutí prstu) stisk zruší", () => {
    const lp = new LongPress();
    const fire = vi.fn();
    lp.start(1, [100, 100], fire);
    lp.move(2, [400, 400]);
    expect(lp.pending).toBe(true);
    lp.cancel();
    vi.advanceTimersByTime(1000);
    expect(fire).not.toHaveBeenCalled();
  });
  it("nový stisk nahradí předchozí časovač", () => {
    const lp = new LongPress(200, 8);
    const first = vi.fn();
    const second = vi.fn();
    lp.start(1, [0, 0], first);
    vi.advanceTimersByTime(150);
    lp.start(2, [50, 50], second);
    vi.advanceTimersByTime(199);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(second).toHaveBeenCalledWith([50, 50]);
    expect(first).not.toHaveBeenCalled();
  });
});

describe("skica – sledování prstů (TouchTracker)", () => {
  it("první prst = levé tlačítko, druhý zahájí gesto, třetí se ignoruje", () => {
    const t = new TouchTracker();
    expect(t.down(1, [100, 100])).toBe("first");
    expect(t.swallowed).toBe(false);
    expect(t.pinching).toBe(false);
    expect(t.down(2, [200, 100])).toBe("second");
    expect(t.pinching).toBe(true);
    expect(t.swallowed).toBe(true);
    expect(t.down(3, [300, 300])).toBe("ignore");
    expect(t.count).toBe(3);
  });
  it("pohyb jednoho prstu bez gesta nic nevrací; při gestu vrací výchozí a aktuální polohy obou prstů", () => {
    const t = new TouchTracker();
    t.down(1, [100, 100]);
    expect(t.move(1, [120, 100])).toBeNull();
    t.down(2, [200, 100]);
    // výchozí poloha prvního prstu je ta v okamžiku dosednutí druhého
    expect(t.move(2, [260, 100])).toEqual({ a0: [120, 100], b0: [200, 100], a1: [120, 100], b1: [260, 100] });
    expect(t.move(1, [90, 100])).toEqual({ a0: [120, 100], b0: [200, 100], a1: [90, 100], b1: [260, 100] });
    expect(t.move(9, [0, 0])).toBeNull(); // neznámý ukazatel
  });
  it("třetí prst gesto prvních dvou neovlivní", () => {
    const t = new TouchTracker();
    t.down(1, [100, 100]);
    t.down(2, [200, 100]);
    t.down(3, [300, 300]);
    expect(t.move(3, [350, 350])).toEqual({ a0: [100, 100], b0: [200, 100], a1: [100, 100], b1: [200, 100] });
  });
  it("po gestu se zbylý prst ignoruje až do zvednutí všech; další dotyk začíná načisto", () => {
    const t = new TouchTracker();
    t.down(1, [100, 100]);
    t.down(2, [200, 100]);
    expect(t.up(2)).toBe(false);
    expect(t.pinching).toBe(false);
    expect(t.swallowed).toBe(true); // zbylý prst nesmí začít kreslit / táhnout
    expect(t.move(1, [150, 150])).toBeNull();
    expect(t.up(1)).toBe(true);
    expect(t.down(5, [10, 10])).toBe("first");
    expect(t.swallowed).toBe(false);
  });
  it("prst vrácený po přerušeném gestu zahájí nové gesto od aktuálních poloh", () => {
    const t = new TouchTracker();
    t.down(1, [100, 100]);
    t.down(2, [200, 100]);
    t.move(1, [80, 100]);
    t.up(2);
    expect(t.down(3, [300, 100])).toBe("second");
    expect(t.move(3, [320, 100])).toEqual({ a0: [80, 100], b0: [300, 100], a1: [80, 100], b1: [320, 100] });
  });
  it("swallow po dlouhém stisku: zbytek doteku se ignoruje, bez prstů nic nedělá", () => {
    const t = new TouchTracker();
    t.swallow();
    expect(t.swallowed).toBe(false);
    t.down(1, [10, 10]);
    t.swallow();
    expect(t.swallowed).toBe(true);
    expect(t.up(1)).toBe(true);
    expect(t.down(1, [10, 10])).toBe("first");
    expect(t.swallowed).toBe(false);
  });
  it("reset zapomene prsty i gesto", () => {
    const t = new TouchTracker();
    t.down(1, [0, 0]);
    t.down(2, [10, 0]);
    t.reset();
    expect(t.count).toBe(0);
    expect(t.pinching).toBe(false);
    expect(t.swallowed).toBe(false);
  });
});
