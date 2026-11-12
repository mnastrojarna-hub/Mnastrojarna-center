import { describe, expect, it, vi, beforeEach } from "vitest";

const calls = vi.hoisted(() => ({ n: 0, images: [] as { index: number; label: string; outW: number; outH: number }[][], answers: [] as unknown[] }));
vi.mock("./detect-ai", async (orig) => {
  const real = await orig<typeof import("./detect-ai")>();
  return {
    ...real,
    checkCompanies: vi.fn(async (_cfg: unknown, input: { images: { index: number; label: string; outW: number; outH: number }[] }) => {
      calls.images.push(input.images.map((i) => ({ index: i.index, label: i.label, outW: i.outW, outH: i.outH })));
      const a = calls.answers[calls.n++] as ((imgs: typeof input.images) => unknown) | undefined;
      return { data: { items: a ? a(input.images) : [] }, meta: { usage: null, fallback: false } };
    }),
  };
});

import { checkAndHealCompanies, quadrantFocus, usableSentBox } from "./company-check";

const raster = () => ({ width: 800, height: 600, channels: 3 as const, data: new Uint8Array(800 * 600 * 3).fill(255) });
const base = (r: ReturnType<typeof raster>) => ({
  raster: r, page: 1, ai: { apiKey: "x", model: "m", deadline: Date.now() + 10 * 60_000, sha: "s" },
  focus: [{ box: { x: 400, y: 400, w: 400, h: 200 }, label: "razítko" }],
  keepTerms: ["Mnástrojárna"], keepBoxes: [], fill: [255, 255, 255], logo: true,
});
const del = (img: number, x: number, y: number, w: number, h: number) => ({ img, x, y, w, h, text: "DEL", role: "owner", form: "text" });

beforeEach(() => { calls.n = 0; calls.images = []; calls.answers = []; });

describe("12. 11. „DEL — AI neurčila, kde přesně je“", () => {
  it("usableSentBox: kousek přes okraj se ořízne, úplně mimo / nulový = nic", () => {
    expect(usableSentBox({ outW: 100, outH: 100 }, 90, 10, 20, 10)).toEqual({ x: 90, y: 10, w: 10, h: 10 });
    expect(usableSentBox({ outW: 100, outH: 100 }, 95, 10, 40, 10)).toBeNull();
    expect(usableSentBox({ outW: 100, outH: 100 }, 300, 300, 10, 10)).toBeNull();
    expect(usableSentBox({ outW: 100, outH: 100 }, 10, 10, 0, 10)).toBeNull();
  });

  it("quadrantFocus: 4 čtvrtiny s přesahem pokryjí celou stranu", () => {
    const q = quadrantFocus(800, 600);
    expect(q).toHaveLength(4);
    expect(q[3].box.x + q[3].box.w).toBeGreaterThanOrEqual(800);
    expect(q[3].box.y + q[3].box.h).toBeGreaterThanOrEqual(600);
  });

  it("bez polohy → další kolo na ostřejších čtvrtinách, tam se najde, vypálí a ověří → čisté", async () => {
    calls.answers = [
      () => [del(0, -500, -500, 10, 10)],
      (imgs: { index: number; label: string }[]) => [del(imgs.find((i) => i.label.includes("levá horní"))!.index, 20, 20, 60, 20)],
      () => [],
    ];
    const out = await checkAndHealCompanies({ ...base(raster()), rounds: 3 });
    expect(out.clean).toBe(true);
    expect(out.healed.length).toBe(1);
    expect(calls.images[1].some((i) => i.label.includes("čtvrtina"))).toBe(true);
    expect(calls.images[1].length).toBeLessThanOrEqual(6);
    expect(out.names).toContain("DEL");
  });

  it("ani na čtvrtinách poloha → neprošlo s důvodem „AI neurčila, kde přesně je“", async () => {
    calls.answers = [() => [del(0, -500, -500, 10, 10)], () => [del(0, -500, -500, 10, 10)], () => [del(0, -500, -500, 10, 10)], () => [del(0, -500, -500, 10, 10)]];
    const out = await checkAndHealCompanies({ ...base(raster()), rounds: 2 });
    expect(out.clean).toBe(false);
    expect(out.why).toBe("AI neurčila, kde přesně je");
  });

  it("přes chráněné pole (≥ 80 %) → neprošlo s důvodem chráněného pole", async () => {
    calls.answers = [() => [del(0, 100, 100, 50, 20)]];
    const r = raster();
    const out = await checkAndHealCompanies({ ...base(r), keepBoxes: [{ x: 0, y: 0, w: 800, h: 600 }], rounds: 3 });
    expect(out.clean).toBe(false);
    expect(out.why).toMatch(/chráněné pole/);
  });
});
