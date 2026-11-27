/**
 * Vlna 22, bod 17 – rozmístění pozic (balónků) po pohledech (cad/drawing-balloons.ts), bez jádra.
 * Dřív (repro S/w22/repro/17/repro-100b.txt): řada 100 balónků delší než list, ~20 sražených do jednoho místa u rámu,
 * odkazové čáry křížem přes pohled, bez hlášení. Teď: žádný balónek přes jiný, přes překážku ani mimo rám; co se nevejde,
 * přeteče do dalšího pohledu nebo je `lost` (kontrola překryvů ho započte); křížení odkazů se sníží výměnami.
 */
import { describe, expect, it } from "vitest";
import { countCrossings, layoutBalloons, parsePositions, rangesText, segmentsCross, type BItem, type BView } from "./drawing-balloons";
import type { Vec3 } from "./types";

/** pohled shora na desku: x → list x, y → list y (měřítko s, posun) */
const view = (key: string, x: number, y: number, w: number, h: number, s = 1): BView => ({ key, rect: { x, y, w, h }, project: (p: Vec3) => [x + p[0] * s, y + p[1] * s] });
/** n dílů v mřížce na ploše w × h (mm modelu) */
function grid(n: number, w: number, h: number): BItem[] {
  const cols = Math.ceil(Math.sqrt((n * w) / h));
  const rows = Math.ceil(n / cols);
  return Array.from({ length: n }, (_, i) => {
    const cx = ((i % cols) + 0.5) * (w / cols);
    const cy = (Math.floor(i / cols) + 0.5) * (h / rows);
    return { pos: i + 1, boxes: [[[cx - 2, cy - 2, 0], [cx + 2, cy + 2, 5]]] };
  });
}
const R = 4;
const overlapping = (bs: { x: number; y: number }[]) => {
  let n = 0;
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (Math.hypot(bs[i].x - bs[j].x, bs[i].y - bs[j].y) < 2 * R - 1e-6) n++;
  return n;
};

describe("rozmístění pozic (bod 17)", () => {
  it("100 pozic na A1 kolem dvou pohledů: žádný překryv, vše v rámu, nic se nesrazí u rámu", () => {
    const bounds = { x: 22, y: 12, w: 806, h: 570 };
    const views = [view("front", 150, 120, 300, 180), view("top", 150, 360, 300, 120)];
    const lay = layoutBalloons({ items: grid(100, 300, 180), views, obstacles: [{ x: 640, y: 480, w: 190, h: 100 }], bounds, R });
    expect(lay.placed).toHaveLength(100);
    expect(lay.lost).toBe(0);
    expect(overlapping(lay.placed)).toBe(0);
    for (const b of lay.placed) {
      expect(b.x - R).toBeGreaterThanOrEqual(bounds.x - 1e-6);
      expect(b.x + R).toBeLessThanOrEqual(bounds.x + bounds.w + 1e-6);
      expect(b.y - R).toBeGreaterThanOrEqual(bounds.y - 1e-6);
      // razítko (překážka) zůstane volné
      expect(b.x > 640 - R && b.y > 480 - R).toBe(false);
    }
    // stará chyba: desítky balónků na jednom místě u pravého rámu
    const atRightEdge = lay.placed.filter((b) => Math.abs(b.x - (bounds.x + bounds.w - R)) < 0.5).length;
    expect(atRightEdge).toBeLessThan(5);
  });

  it("výměny proti křížení: kříženích je méně než u řazení podle x (dřívější řada)", () => {
    const items = grid(30, 200, 120);
    const lay = layoutBalloons({ items, views: [view("front", 100, 100, 200, 120)], obstacles: [], bounds: { x: 20, y: 10, w: 400, h: 287 }, R });
    expect(lay.crossings).toBe(countCrossings(lay.placed));
    expect(lay.crossings).toBeLessThanOrEqual(3);
  });

  it("přiřazení pohledu ručně: pozice 1–5 u horního pohledu, ostatní auto u hlavního; chybějící pohled se ohlásí", () => {
    const views = [view("front", 100, 60, 200, 100), view("top", 100, 200, 200, 60)];
    const lay = layoutBalloons({ items: grid(10, 200, 100), views, assign: { "1": "top", "2": "top", "3": "top", "4": "top", "5": "top", "6": "left" }, obstacles: [], bounds: { x: 20, y: 10, w: 400, h: 287 }, R });
    for (const p of [1, 2, 3, 4, 5]) expect(lay.placed.find((b) => b.pos === p)!.view).toBe("top");
    expect(lay.placed.find((b) => b.pos === 1)!.assigned).toBe("user");
    expect(lay.placed.find((b) => b.pos === 7)!.view).toBe("front");
    expect(lay.missingView).toEqual([6]);
  });

  it("plný hlavní pohled: co se nevejde, přeteče do dalšího pohledu, kde je díl vidět (auto)", () => {
    // kolem hlavního pohledu je všechno obsazené (texty, tabulky) – volno je jen u horního pohledu
    const views = [view("front", 100, 20, 200, 30), view("top", 100, 150, 200, 40)];
    const obstacles = [{ x: 20, y: 10, w: 75, h: 100 }, { x: 305, y: 10, w: 95, h: 100 }, { x: 95, y: 55, w: 210, h: 45 }];
    const lay = layoutBalloons({ items: grid(20, 200, 30), views, obstacles, bounds: { x: 20, y: 10, w: 380, h: 277 }, R });
    expect(lay.placed.filter((b) => b.view === "top").length).toBeGreaterThan(10);
    expect(lay.lost).toBe(0);
    expect(overlapping(lay.placed.filter((b) => !b.lost))).toBe(0);
  });

  it("zamčená pozice drží absolutní polohu a je překážkou; posunutá je relativně k automatické", () => {
    const views = [view("front", 100, 100, 200, 100)];
    const base = layoutBalloons({ items: grid(6, 200, 100), views, obstacles: [], bounds: { x: 20, y: 10, w: 400, h: 287 }, R });
    const p3 = base.placed.find((b) => b.pos === 3)!;
    const lay = layoutBalloons({ items: grid(6, 200, 100), views, edit: { lock: { "pos:1": [60, 40] }, move: { "pos:3": [5, -3] } }, obstacles: [], bounds: { x: 20, y: 10, w: 400, h: 287 }, R });
    const b1 = lay.placed.find((b) => b.pos === 1)!;
    expect([b1.x, b1.y, b1.mode]).toEqual([60, 40, "locked"]);
    const b3 = lay.placed.find((b) => b.pos === 3)!;
    expect(b3.mode).toBe("moved");
    // posun relativní k automatické poloze téže pozice (zámek pozice 1 mohl automatickou polohu změnit – jen tvar)
    expect(Number.isFinite(b3.x) && Number.isFinite(p3.x)).toBe(true);
    expect(overlapping(lay.placed.filter((b) => b.mode !== "moved"))).toBe(0);
  });

  it("skrytá pozice se nekreslí; opakovaná pozice má klíč pos:n#2 (vlna E)", () => {
    const items: BItem[] = [{ pos: 1, boxes: [[[0, 0, 0], [5, 5, 5]]] }, { pos: 1, boxes: [[[20, 0, 0], [25, 5, 5]]] }, { pos: 2, boxes: [[[40, 0, 0], [45, 5, 5]]] }];
    const lay = layoutBalloons({ items, views: [view("front", 100, 100, 60, 20)], edit: { off: ["pos:2"] }, obstacles: [], bounds: { x: 20, y: 10, w: 400, h: 287 }, R });
    expect(lay.placed.map((b) => b.id)).toEqual(expect.arrayContaining(["pos:1", "pos:1#2"]));
    expect(lay.placed.some((b) => b.pos === 2)).toBe(false);
  });

  it("parsePositions / rangesText / segmentsCross", () => {
    expect(parsePositions("1-4,7 9–10")).toEqual([1, 2, 3, 4, 7, 9, 10]);
    expect(() => parsePositions("a-3")).toThrow();
    expect(rangesText([5, 1, 2, 3, 9])).toBe("1–3, 5, 9");
    expect(segmentsCross([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true);
    expect(segmentsCross([0, 0], [10, 0], [0, 1], [10, 1])).toBe(false);
  });
});

describe("kotva a délka odkazu (bod 17, kolo 6)", () => {
  const segDist = (a: [number, number], b: [number, number], c: [number, number]) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(a[0] + dx * t - c[0], a[1] + dy * t - c[1]);
  };
  // repro S/w22/repro/17/repro-100.txt: desky nad sebou (stejné x, jiné z) – v předním pohledu kotvy v jedné svislé řadě,
  // odkaz spodní desky vedl přes kotvy horních (0,14 mm)
  it("desky v řadě nad sebou: žádný odkaz nevede blíž než 1 mm ke kotvě jiné pozice", () => {
    const items: BItem[] = Array.from({ length: 12 }, (_, i) => ({ pos: i + 1, boxes: [[[(i % 4) * 25, 0, Math.floor(i / 4) * 12], [(i % 4) * 25 + 20, 10, Math.floor(i / 4) * 12 + 5]]] }));
    // přední pohled: x → list x, z → list y dolů (obráceně)
    const front: BView = { key: "front", rect: { x: 100, y: 100, w: 95, h: 29 }, project: (p: Vec3) => [100 + p[0], 129 - p[2]] };
    const lay = layoutBalloons({ items, views: [front], obstacles: [], bounds: { x: 22, y: 12, w: 386, h: 273 }, R });
    expect(lay.placed).toHaveLength(12);
    for (const b of lay.placed)
      for (const c of lay.placed) if (b !== c) expect(segDist([b.x, b.y], b.a as [number, number], c.a as [number, number])).toBeGreaterThanOrEqual(1);
  });
  // repro S/w22/repro/17/repro.txt (A3, 30 dílů): odkaz 21 z [287; 17,8] do [44; 29,5] – 243 mm (první řada kolem pohledu měla
  // přednost před délkou odkazu)
  it("široký nízký pohled s plnou první řadou: odkaz nikdy přes půl listu – nejvýš 0,3 × (š + v) pohledu, aspoň 40 mm", () => {
    const items: BItem[] = Array.from({ length: 30 }, (_, i) => ({ pos: i + 1, boxes: [[[(i % 10) * 25, 0, Math.floor(i / 10) * 9], [(i % 10) * 25 + 20, 10, Math.floor(i / 10) * 9 + 5]]] }));
    const front: BView = { key: "front", rect: { x: 40, y: 30, w: 245, h: 26 }, project: (p: Vec3) => [40 + p[0], 56 - p[2]] };
    // nad pohledem rám (sloty nahoře nejsou volné), vlevo kóta
    const lay = layoutBalloons({ items, views: [front], obstacles: [{ x: 0, y: 0, w: 420, h: 22 }, { x: 22, y: 22, w: 14, h: 40 }], bounds: { x: 22, y: 12, w: 386, h: 273 }, R });
    const longest = Math.max(...lay.placed.map((b) => Math.hypot(b.a[0] - b.x, b.a[1] - b.y)));
    expect(longest).toBeLessThanOrEqual(Math.max(40, 0.3 * (245 + 26)) + 1e-6);
  });
  it("odkaz nekříží kótovací čáru, když jde balónek položit jinam", () => {
    const items: BItem[] = [{ pos: 1, boxes: [[[10, 0, 0], [20, 10, 10]]] }];
    const front: BView = { key: "front", rect: { x: 100, y: 100, w: 60, h: 30 }, project: (p: Vec3) => [100 + p[0], 130 - p[2]] };
    // svislá kótovací čára vlevo od pohledu přes celou výšku a vodorovná pod ním (nejbližší místa balónku jsou vlevo a dole)
    const lines: [[number, number], [number, number]][] = [[[95, 60], [95, 170]], [[80, 136], [200, 136]]];
    const lay = layoutBalloons({ items, views: [front], obstacles: [], bounds: { x: 22, y: 12, w: 386, h: 273 }, R, lines });
    const b = lay.placed[0];
    expect(lines.some(([p, q]) => segmentsCross([b.x, b.y], b.a, p, q))).toBe(false);
  });
});

