/**
 * Testovací 2D model se VŠEMI druhy entit jádra a smluvních druhů balíků 2 (annot) a 3 (layout), tabulkami,
 * blokem s atributy, rozvržením s výřezem a XDATA – pro testy tam a zpět DXF / DWG (io.test.ts).
 */
import { newDraftModel } from "../../doc";
import type { DraftEntity, DraftModel } from "../../model";
import "../../annot/types";
import "../../layout/types";

export function fullModel(): DraftModel {
  const base = newDraftModel({ units: "mm" });
  let n = 0;
  const id = () => `e${++n}`;
  const E = (o: Record<string, unknown>) => ({ id: id(), layer: "0", ...o }) as unknown as DraftEntity;
  const model: DraftModel = {
    ...base,
    vars: { ...base.vars, clayer: "OBRYS", ltscale: 0.5, prec: 3, dimstyle: "ISO-25", textstyle: "Popis" },
    layers: [
      ...base.layers,
      { name: "OBRYS", color: 7, linetype: "Continuous", lineweight: 0.5, on: true, frozen: false, locked: false, plot: true, desc: "Viditelné hrany" },
      { name: "OSY", color: 1, linetype: "CENTER", lineweight: 0.25, on: true, frozen: false, locked: false, plot: true },
      { name: "KÓTY", color: "#336699", linetype: "Continuous", lineweight: 0.18, on: true, frozen: false, locked: false, plot: true, transparency: 40 },
      { name: "SKRYTÉ", color: 4, linetype: "HIDDEN", lineweight: "Default", on: false, frozen: false, locked: true, plot: false },
      { name: "Šrafy", color: 8, linetype: "Continuous", lineweight: 0.13, on: true, frozen: true, locked: false, plot: true },
    ],
    textStyles: [...base.textStyles, { name: "Popis", font: "isocpeur.ttf", height: 0, wf: 0.8, oblique: 15 }],
    dimStyles: [{ name: "ISO-25", dimscale: 1, dimtxt: 2.5, dimasz: 2.5, dimexe: 1.25, dimexo: 0.625, dimgap: 0.625, dimdec: 2, dimtad: 1, dimzin: 8, dimdsep: ",", dimlfac: 1 }],
    entities: [],
  };
  const ents: DraftEntity[] = [
    E({ type: "point", p: [1.5, 2.25] }),
    E({ type: "line", layer: "OBRYS", a: [0, 0], b: [100.125, 0], color: 3, linetype: "DASHED", lineweight: 0.35, ltscale: 2 }),
    E({ type: "xline", layer: "OSY", p: [50, 25], dir: [0, 1] }),
    E({ type: "ray", layer: "OSY", p: [0, 25], dir: [Math.SQRT1_2, Math.SQRT1_2] }),
    E({ type: "polyline", layer: "OBRYS", pts: [[0, 0], [100, 0], [100, 50], [0, 50]], bulges: [0, 0.4142135623730951, 0, 0], widths: [[0, 0], [1, 2], [0, 0], [0, 0]], closed: true }),
    E({ type: "polyline", pts: [[200, 0], [210, 5], [220, 0]], width: 0.7 }),
    E({ type: "circle", layer: "OBRYS", c: [50, 25], r: 10 }),
    E({ type: "arc", layer: "OBRYS", c: [10, 10], r: 5, a0: 30, a1: 300 }),
    E({ type: "ellipse", c: [150, 50], major: [30, 10], ratio: 0.4 }),
    E({ type: "ellipse", c: [150, 100], major: [0, 20], ratio: 0.5, t0: 10, t1: 200 }),
    E({ type: "spline", degree: 3, ctrl: [[0, 100], [10, 120], [30, 90], [50, 110]], knots: [0, 0, 0, 0, 1, 1, 1, 1], fit: [[0, 100], [50, 110]] }),
    E({ type: "spline", degree: 2, ctrl: [[0, 150], [20, 170], [40, 150]], knots: [0, 0, 0, 1, 1, 1], weights: [1, 0.7071067811865476, 1] }),
    E({ type: "text", p: [5, 60], h: 3.5, s: "Žluťoučký kůň Ø20 ±0,1 °", rot: 15, style: "Popis" }),
    E({ type: "text", p: [50, 70], h: 2.5, s: "Střed", halign: "center", valign: "middle" }),
    E({ type: "text", p: [0, 80], h: 2.5, s: "Zarovnat", halign: "aligned", p2: [40, 80] }),
    E({ type: "mtext", p: [120, 60], h: 2.5, w: 60, s: "{\\fArial|b1;Tučně}\\PDruhý řádek – Ž", rot: 10, attach: 4, lineSpacing: 1.5, style: "Popis" }),
    E({ type: "dimension", layer: "KÓTY", kind: "linear", p1: [0, 0], p2: [100, 0], line: [50, -15], rot: 0, style: "ISO-25" }),
    E({ type: "dimension", layer: "KÓTY", kind: "aligned", p1: [0, 0], p2: [30, 40], line: [10, 50], style: "ISO-25", text: "<> mm" }),
    E({ type: "dimension", layer: "KÓTY", kind: "radius", center: [10, 10], chord: [15, 10], style: "ISO-25" }),
    E({ type: "dimension", layer: "KÓTY", kind: "diameter", chord: [60, 25], far: [40, 25], style: "ISO-25", textPos: [70, 30] }),
    E({ type: "dimension", layer: "KÓTY", kind: "angular", l1: [[0, 0], [100, 0]], l2: [[0, 0], [70.71067811865476, 70.71067811865476]], arc: [40, 15], style: "ISO-25" }),
    E({ type: "dimension", layer: "KÓTY", kind: "angular3", vertex: [200, 200], p1: [250, 200], p2: [200, 250], arc: [230, 230], style: "ISO-25" }),
    E({ type: "dimension", layer: "KÓTY", kind: "ordinate", origin: [0, 0], p1: [100, 50], p2: [120, 60], xAxis: true, style: "ISO-25" }),
    E({ type: "dimension", layer: "KÓTY", kind: "arc", center: [10, 10], p1: [14.330127018922195, 12.5], p2: [12.5, 5.669872981077806], arc: [20, 10], style: "ISO-25", overrides: { dimtxt: 3.5, dimdec: 1 } }),
    E({ type: "leader", layer: "KÓTY", pts: [[100, 50], [120, 70], [130, 70]], text: "Sražení 1×45°", textPos: [131, 70], textH: 2.5, arrowSize: 3 }),
    E({ type: "leader", layer: "KÓTY", pts: [[0, 50], [-10, 60]] }),
    E({ type: "hatch", layer: "Šrafy", pattern: "ANSI31", scale: 1, angle: 0, loops: [{ pts: [[0, 0], [100, 0], [100, 50], [0, 50]], outer: true }, { pts: [[40, 15], [60, 15], [60, 35], [40, 35]] }] }),
    E({ type: "hatch", layer: "Šrafy", pattern: "SOLID", solid: true, scale: 1, angle: 0, loops: [{ pts: [[200, 50], [220, 50], [220, 70]], bulges: [0, 0.5, 0], outer: true }], color: 5 }),
    E({ type: "hatch", layer: "Šrafy", pattern: "ANSI37", scale: 2, angle: 30, islandStyle: 1, loops: [{ pts: [[300, 0], [350, 0], [350, 40], [300, 40]], outer: true }] }),
    E({ type: "tolerance", layer: "KÓTY", p: [150, 150], s: "{\\Fgdt;j}%%v{\\Fgdt;n}0.05%%vA", h: 3.5, rot: 0 }),
    E({ type: "insert", block: "RAZITKO", p: [300, 100], sx: 2, sy: 2, rot: 30, attribs: [{ tag: "NAZEV", value: "Deska Č.1", p: [305, 105], h: 5, rot: 30 }, { tag: "SKRYTY", value: "x", p: [300, 100], h: 2.5, invisible: true }] }),
    E({ type: "insert", block: "SROUB", p: [0, 200], sx: 1, sy: 1, rot: 0, cols: 3, rows: 2, colSpacing: 20, rowSpacing: 15 }),
    E({ type: "insert", block: "SROUB", p: [400, 200], sx: -1, sy: 1, rot: 0 }),
  ];
  // XDATA cizí aplikace na úsečce
  (ents[1] as DraftEntity).ext = { xdata: { MOJEAPP: [[1000, "hodnota"], [1040, 3.25], [1070, 7], [1010, [1, 2, 0]]] } };
  model.entities = ents;
  model.blocks = [
    {
      name: "SROUB",
      base: [0, 0],
      desc: "Šroub M8",
      entities: [E({ type: "circle", c: [0, 0], r: 4 }), E({ type: "line", a: [-5, 0], b: [5, 0], color: "ByBlock" })],
    },
    {
      name: "RAZITKO",
      base: [0, 0],
      entities: [
        E({ type: "polyline", pts: [[0, 0], [180, 0], [180, 40], [0, 40]], closed: true }),
        E({ type: "attdef", tag: "NAZEV", prompt: "Název výkresu", def: "?", p: [5, 5], h: 5 }),
        E({ type: "attdef", tag: "SKRYTY", prompt: "Skrytý", def: "", p: [0, 0], h: 2.5, invisible: true }),
      ],
    },
  ] as DraftModel["blocks"];
  model.layouts = [
    {
      id: "L1",
      name: "List A3",
      order: 1,
      paper: { size: "ISO_A3_(420.00_x_297.00_MM)", w: 420, h: 297, units: "mm", landscape: true, margins: [10, 10, 10, 10] },
      entities: [
        E({ type: "viewport", c: [200, 150], w: 300, h: 200, viewCenter: [50, 25], scale: 0.5, frozenLayers: ["OSY"], locked: true }),
        E({ type: "text", p: [20, 20], h: 5, s: "Papírový prostor" }),
      ],
    },
    { id: "L2", name: "List 2", order: 2, paper: { size: "A4", w: 210, h: 297, units: "mm", landscape: false, margins: [5, 5, 5, 5] }, entities: [E({ type: "viewport", c: [105, 150], w: 150, h: 100, viewCenter: [0, 0], scale: 2 })] },
  ] as DraftModel["layouts"];
  model.seq = n;
  return model;
}
