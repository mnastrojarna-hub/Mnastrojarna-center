/**
 * Testovací předloha (vlastní, vygenerovaná – žádná data zákazníka): výkres desky 120 × 80 × 20 mm se 4 dírami Ø8
 * a středovou dírou Ø20 H7 na listu A3 (blok rámečku + razítko s atributy), půdorys a nárys (skryté hrany, osy),
 * kóty (rozměry, tolerance ±0,1, uložení H7, počet 4×, jedna kóta s textem 19,8 u geometrie 20), kusovník (čáry
 * a texty s hlavičkou Poz / Ks / Název / Materiál / Rozměr), pozice (balónek) a poznámky. Zapisuje se zapisovačem
 * 2D výkresu do DXF / DWG (reference.test.ts, e2e cad-w15-reference).
 *
 * Model desky v souřadnicích modelu: kvádr (−60, −40, 0)–(60, 40, 20), díry Ø8 v (±45, ±25), díra Ø20 ve středu.
 */
import { newDraftModel } from "../../draft/doc";
import type { DraftBlock, DraftEntity, DraftModel, Vec2 } from "../../draft/model";
import "../../draft/annot/types";
import "../../draft/layout/types";

/** střed půdorysu na listu a levý dolní roh nárysu */
export const PLAN_C: Vec2 = [140, 200];
export const FRONT_Y0 = 120;

export function plateReference(): DraftModel {
  const base = newDraftModel({ units: "mm" });
  let n = 0;
  const id = () => `e${++n}`;
  const E = (o: Record<string, unknown>) => ({ id: id(), layer: "OBRYS", ...o }) as unknown as DraftEntity;
  const L = (a: Vec2, b: Vec2, layer = "OBRYS") => E({ type: "line", a, b, layer });
  const rect = (x0: number, y0: number, x1: number, y1: number, layer = "OBRYS") => [L([x0, y0], [x1, y0], layer), L([x1, y0], [x1, y1], layer), L([x1, y1], [x0, y1], layer), L([x0, y1], [x0, y0], layer)];
  const [cx, cy] = PLAN_C;
  const holes: Vec2[] = [[-45, -25], [45, -25], [-45, 25], [45, 25]];
  // rámeček A3 a razítko jako bloky
  const border: DraftBlock = { name: "A3", base: [0, 0], entities: [...rect(0, 0, 420, 297, "RAM"), ...rect(20, 10, 410, 287, "RAM")] } as DraftBlock;
  const title: DraftBlock = {
    name: "RAZITKO",
    base: [0, 0],
    entities: [
      ...rect(0, 0, 180, 40, "RAM"),
      L([0, 20], [180, 20], "RAM"),
      L([90, 0], [90, 40], "RAM"),
      E({ type: "text", layer: "RAM", p: [2, 35], h: 2.5, s: "Název" }),
      E({ type: "text", layer: "RAM", p: [92, 35], h: 2.5, s: "Číslo výkresu" }),
      E({ type: "attdef", layer: "RAM", p: [5, 25], h: 3.5, tag: "NAZEV", prompt: "Název", def: "" }),
      E({ type: "attdef", layer: "RAM", p: [95, 25], h: 3.5, tag: "CISLO", prompt: "Číslo", def: "" }),
      E({ type: "attdef", layer: "RAM", p: [5, 5], h: 3.5, tag: "MATERIAL", prompt: "Materiál", def: "" }),
      E({ type: "attdef", layer: "RAM", p: [95, 5], h: 3.5, tag: "MERITKO", prompt: "Měřítko", def: "" }),
      E({ type: "attdef", layer: "RAM", p: [140, 5], h: 3.5, tag: "POS", prompt: "Pozice", def: "" }),
      E({ type: "attdef", layer: "RAM", p: [140, 25], h: 3.5, tag: "ROZMER", prompt: "Rozměr", def: "" }),
    ],
  } as DraftBlock;
  const att = (tag: string, value: string, p: Vec2) => ({ tag, value, p, h: 3.5 });
  const T = [230, 10] as Vec2;
  const ents: DraftEntity[] = [
    E({ type: "insert", layer: "RAM", block: "A3", p: [0, 0], sx: 1, sy: 1, rot: 0 }),
    E({ type: "insert", layer: "RAM", block: "RAZITKO", p: T, sx: 1, sy: 1, rot: 0, attribs: [att("NAZEV", "DESKA 120x80", [T[0] + 5, T[1] + 25]), att("CISLO", "RD-001", [T[0] + 95, T[1] + 25]), att("MATERIAL", "S235JR", [T[0] + 5, T[1] + 5]), att("MERITKO", "1:1", [T[0] + 95, T[1] + 5]), att("POS", "1", [T[0] + 140, T[1] + 5]), att("ROZMER", "20*80*120", [T[0] + 140, T[1] + 25])] }),
    // půdorys
    ...rect(cx - 60, cy - 40, cx + 60, cy + 40),
    ...holes.map((h) => E({ type: "circle", c: [cx + h[0], cy + h[1]], r: 4 })),
    E({ type: "circle", c: [cx, cy], r: 10 }),
    L([cx - 66, cy], [cx + 66, cy], "OSY"),
    L([cx, cy - 46], [cx, cy + 46], "OSY"),
    // nárys (pod půdorysem): obrys a skryté hrany děr
    ...rect(cx - 60, FRONT_Y0, cx + 60, FRONT_Y0 + 20),
    ...[-45, 45].flatMap((x) => [L([cx + x - 4, FRONT_Y0], [cx + x - 4, FRONT_Y0 + 20], "SKRYTE"), L([cx + x + 4, FRONT_Y0], [cx + x + 4, FRONT_Y0 + 20], "SKRYTE")]),
    L([cx - 10, FRONT_Y0], [cx - 10, FRONT_Y0 + 20], "SKRYTE"),
    L([cx + 10, FRONT_Y0], [cx + 10, FRONT_Y0 + 20], "SKRYTE"),
    // kóty
    E({ type: "dimension", layer: "KOTY", kind: "linear", p1: [cx - 60, cy + 40], p2: [cx + 60, cy + 40], line: [cx, cy + 55], rot: 0 }),
    E({ type: "dimension", layer: "KOTY", kind: "linear", p1: [cx + 60, cy - 40], p2: [cx + 60, cy + 40], line: [cx + 75, cy], rot: 90, overrides: { dimtol: true, dimtp: 0.1, dimtm: 0.1 } }),
    E({ type: "dimension", layer: "KOTY", kind: "linear", p1: [cx - 45, cy - 25], p2: [cx + 45, cy - 25], line: [cx, cy - 50], rot: 0 }),
    E({ type: "dimension", layer: "KOTY", kind: "linear", p1: [cx - 45, cy - 25], p2: [cx - 45, cy + 25], line: [cx - 75, cy], rot: 90 }),
    E({ type: "dimension", layer: "KOTY", kind: "diameter", chord: [cx + 7.0710678, cy + 7.0710678], far: [cx - 7.0710678, cy - 7.0710678], text: "<> H7", textPos: [cx + 25, cy + 20] }),
    E({ type: "dimension", layer: "KOTY", kind: "diameter", chord: [cx + 45 + 2.8284271, cy + 25 + 2.8284271], far: [cx + 45 - 2.8284271, cy + 25 - 2.8284271], text: "4x <>", textPos: [cx + 70, cy + 45] }),
    // tloušťka v nárysu: text 19.8 u geometrie 20 (rozpor předlohy)
    E({ type: "dimension", layer: "KOTY", kind: "linear", p1: [cx - 60, FRONT_Y0], p2: [cx - 60, FRONT_Y0 + 20], line: [cx - 72, FRONT_Y0 + 10], rot: 90, text: "19.8" }),
    // kusovník (čáry a texty), pozice a poznámky
    ...rect(250, 60, 400, 84, "TAB"),
    L([250, 72], [400, 72], "TAB"),
    ...[265, 280, 330, 360].map((x) => L([x, 60], [x, 84], "TAB")),
    ...(
      [
        [[252, 75], "Poz"], [[267, 75], "Ks"], [[282, 75], "Název"], [[332, 75], "Materiál"], [[362, 75], "Rozměr"],
        [[252, 63], "1"], [[267, 63], "1"], [[282, 63], "DESKA"], [[332, 63], "S235JR"], [[362, 63], "20*80*125"],
      ] as [Vec2, string][]
    ).map(([p, s]) => E({ type: "text", layer: "TAB", p, h: 2.5, s })),
    E({ type: "circle", layer: "POZ", c: [cx + 90, cy + 60], r: 5 }),
    E({ type: "text", layer: "POZ", p: [cx + 88.2, cy + 58.2], h: 3.5, s: "1" }),
    L([cx + 86.4645, cy + 56.4645], [cx + 50, cy + 30], "POZ"),
    E({ type: "text", layer: "POZN", p: [30, 60], h: 3.5, s: "Nekótované hrany sražení 0,5x45°" }),
    E({ type: "text", layer: "POZN", p: [30, 50], h: 3.5, s: "Ra 3,2" }),
  ];
  return {
    ...base,
    layers: [
      ...base.layers,
      { name: "OBRYS", color: 7, linetype: "Continuous", lineweight: 0.5, on: true, frozen: false, locked: false, plot: true },
      { name: "SKRYTE", color: 4, linetype: "HIDDEN", lineweight: 0.25, on: true, frozen: false, locked: false, plot: true },
      { name: "OSY", color: 1, linetype: "CENTER", lineweight: 0.25, on: true, frozen: false, locked: false, plot: true },
      { name: "KOTY", color: 3, linetype: "Continuous", lineweight: 0.18, on: true, frozen: false, locked: false, plot: true },
      { name: "RAM", color: 7, linetype: "Continuous", lineweight: 0.5, on: true, frozen: false, locked: false, plot: true },
      { name: "TAB", color: 7, linetype: "Continuous", lineweight: 0.25, on: true, frozen: false, locked: false, plot: true },
      { name: "POZ", color: 7, linetype: "Continuous", lineweight: 0.25, on: true, frozen: false, locked: false, plot: true },
      { name: "POZN", color: 7, linetype: "Continuous", lineweight: 0.25, on: true, frozen: false, locked: false, plot: true },
    ],
    blocks: [border, title],
    entities: ents,
    seq: n,
  };
}
