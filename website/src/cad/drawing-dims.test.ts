/**
 * Chytré kóty (ISO 129-1): plánovač a rozmístění na skutečných modelech (OpenCascade) – tři příklady z návodu pro AI
 * (hřídel, příruba, deska) a oběžné kolo 604200.001 B (rotační díl, 16 děr). Pravidla: každý rozměr jednou, žádné
 * duplicity, žádný uzavřený řetězec, průměry naskládané (nejmenší nejblíž), řetěz na jedné čáře, popisy děr se značkami,
 * žádné překryvy textů, počet kót úměrný počtu očekávaných rozměrů. Plus značky ↧ ⌴ ⌵ jako geometrie (SVG, DXF, PDF).
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { AGENT_GUIDE } from "./agent-guide";
import { annToSheet, makeDrawing, withAnnotations, type DrawingResult } from "./drawing";
import { buildDoc } from "./build";
import { drawingDoc } from "./drawing-doc";
import { holeCallout, linMeaning } from "./drawing-dims";
import { annotationBoxes } from "./drawing-dims-layout";
import { annLabel, dimDuplicates, drawingStatus, mergeSmart } from "./drawing-agent";
import { computeDrawing, runText, smartDrawing } from "./drawing-dims-harness";
import { boxesOverlap, calloutLines, splitSymbols, textBox, type Box } from "./drawing-symbols";
import { dimCheck } from "./dim-check";
import { drawingToPdf } from "./pdf";
import { drawingToDwg } from "./formats/dwg";
import { DwgReader } from "@node-projects/acad-ts";
import type { CadDoc, DrawingAnnotation } from "./types";
import "./ext/index";
import "./feat/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

/** příklady z návodu pro AI (bloky ``` v kapitole „Výkres a kóty“) */
function guideExample(title: string): string {
  const i = AGENT_GUIDE.indexOf(title);
  expect(i, title).toBeGreaterThan(0);
  const a = AGENT_GUIDE.indexOf("```", i) + 3;
  return AGENT_GUIDE.slice(a, AGENT_GUIDE.indexOf("```", a)).trim();
}
const VIEWS3 = (k: string[]) => ({ front: k.includes("front"), top: k.includes("top"), left: k.includes("left"), right: false, back: false, bottom: k.includes("bottom"), iso: true });

type Sheet = Pick<DrawingResult, "views" | "scaleValue">;
/** kóty a popisy (bez os souměrnosti) */
const dimsOf = (anns: DrawingAnnotation[]) => anns.filter((a) => a.type === "dim" || a.type === "callout");
const labels = (d: Sheet, anns: DrawingAnnotation[]) => anns.map((a) => annLabel(d.views as DrawingResult["views"], a));

/** žádný text se nepřekrývá s jiným textem ani s obrysem pohledu */
function overlaps(d: DrawingResult, anns: DrawingAnnotation[]): string[] {
  const out: string[] = [];
  const items = annotationBoxes(d, anns).flatMap((x) => x.boxes.map((b) => ({ id: x.id, b })));
  const rects: Box[] = d.views.map((v) => ({ x0: v.px, y0: v.py, x1: v.px + v.w * v.s, y1: v.py + v.h * v.s }));
  const name = (id: string) => annLabel(d.views, anns.find((a) => a.id === id)!);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) if (boxesOverlap(items[i].b, items[j].b)) out.push(`${name(items[i].id)} × ${name(items[j].id)}`);
    rects.forEach((rc, k) => {
      if (boxesOverlap(items[i].b, rc)) out.push(`${name(items[i].id)} × pohled ${d.views[k].key}`);
    });
  }
  return out;
}

describe("popisy děr z parametrů prvku Díra (ISO 129-1, ISO 15786)", () => {
  const base = { kind: "simple" as const, diameter: 8.5, depth: 0, cbDiameter: 0, cbDepth: 0 };
  it("jednoduchá průchozí / slepá, s počtem", () => {
    expect(holeCallout(base, 4)).toEqual(["4× Ø8,5 skrz"]);
    expect(holeCallout({ ...base, depth: 12 }, 4)).toEqual(["4× Ø8,5 ↧12"]);
    expect(holeCallout({ ...base, depth: 12 }, 1)).toEqual(["Ø8,5 ↧12"]);
  });
  it("závitová: hloubka závitu / hloubka vrtání; bez hloubky závitu jen jeden řádek; průchozí", () => {
    const t = { ...base, kind: "tapped" as const, thread: "M8", diameter: 6.8, depth: 20, threadDepth: 16 };
    expect(holeCallout(t, 4)).toEqual(["4× M8 ↧16", "Ø6,8 ↧20"]);
    expect(holeCallout({ ...t, threadDepth: 0 }, 2)).toEqual(["2× M8 ↧20"]);
    expect(holeCallout({ ...t, depth: 0 }, 1)).toEqual(["M8 skrz"]);
    expect(holeCallout({ ...t, thread: "M18x1.5", diameter: 16.5, depth: 20, threadDepth: 15 }, 1)).toEqual(["M18×1,5 ↧15", "Ø16,5 ↧20"]);
  });
  it("válcové a kuželové zahloubení", () => {
    expect(holeCallout({ ...base, diameter: 9, kind: "counterbore", cbDiameter: 15, cbDepth: 9 }, 4)).toEqual(["4× Ø9 skrz", "⌴ Ø15 ↧9"]);
    expect(holeCallout({ ...base, diameter: 6.6, kind: "countersink", csDiameter: 12.4, csAngle: 90 }, 4)).toEqual(["4× Ø6,6 skrz", "⌵ Ø12,4 × 90°"]);
  });
});

describe("značky ↧ ⌴ ⌵ jako geometrie (písmo PDF / DXF / DWG je nemá)", () => {
  it("text se značkou → úseky textu bez značky + čáry; mezery u značky zůstanou posunem", () => {
    const r = splitSymbols({ x: 10, y: 20, s: "4× M8 ↧16", size: 3.5, layer: "dim" });
    expect(r.texts.map((t) => t.s)).toEqual(["4× M8", "16"]);
    expect(r.texts[0].anchor).toBe("end");
    expect(r.polys.length).toBe(3);
    const glyphX = r.polys.flatMap((p) => p.pts.map((q) => q[0]));
    expect(Math.min(...glyphX)).toBeGreaterThan(r.texts[0].x); // mezera před značkou
    expect(Math.max(...glyphX)).toBeLessThanOrEqual(r.texts[1].x);
    const cb = splitSymbols({ x: 0, y: 0, s: "⌴ Ø15 ↧9", size: 3.5, layer: "dim" });
    expect(cb.texts.map((t) => t.s)).toEqual(["Ø15", "9"]);
    expect(cb.polys.length).toBe(4);
  });
  it("tolerance v popisu za prvním označením", () => {
    expect(calloutLines({ lines: ["4× M8 ↧16", "Ø6,8 ↧20"], tol: "6H" })).toEqual(["4× M8-6H ↧16", "Ø6,8 ↧20"]);
    expect(calloutLines({ lines: ["Ø50 skrz"], tol: "H7" })).toEqual(["Ø50H7 skrz"]);
  });
  it("obdélník textu: šířka podle znaků, otočený text zdola nahoru", () => {
    const b = textBox({ x: 0, y: 0, s: "120", size: 3.5, anchor: "middle" });
    expect(b.x1 - b.x0).toBeCloseTo(3 * 0.562 * 3.5, 3);
    const v = textBox({ x: 0, y: 0, s: "120", size: 3.5, anchor: "middle", rotate: -90 });
    expect(v.y1 - v.y0).toBeCloseTo(b.x1 - b.x0, 3);
  });
});

describe("příklad A z návodu – hřídel (rotační díl)", async () => {
  let doc: CadDoc;
  let d: Awaited<ReturnType<typeof smartDrawing>>;
  beforeAll(async () => {
    const text = guideExample("### Příklad A");
    const model = text.split("\n").filter((l) => !/^(výkres|kótovat)/.test(l)).join("\n");
    doc = (await runText(model)).doc;
    d = await smartDrawing(doc, { sheet: "A3", views: VIEWS3(["front", "left"]) });
  }, 120_000);

  it("rozpozná rotační díl; každý rozměr jednou, žádné duplicity ani překryvy textů", () => {
    expect(d.smart.report.kind).toBe("turned");
    const L = labels(d.drawing, d.smart.annotations);
    for (const s of ["M20×1,5", "Ø30", "Ø40", "Ø25", "Ø17", "30", "3", "(50)", "15", "42", "140", "25", "1,5×45°", "2× R1"]) expect(L, s).toContain(s);
    expect(new Set(L).size).toBe(L.length);
    expect(dimDuplicates(d.drawing.views, d.smart.annotations)).toEqual([]);
    expect(overlaps(d.drawing, d.smart.annotations)).toEqual([]);
    expect(d.smart.report.skipped).toEqual([]);
  });
  it("Kontrola kót bez chybějících; počet kót odpovídá počtu rozměrů", () => {
    const out = withAnnotations(d.drawing, d.smart.annotations);
    expect(dimCheck(doc, d.bbox, out.texts).filter((x) => !x.present).map((x) => x.label)).toEqual([]);
    expect(dimsOf(d.smart.annotations).length).toBeLessThanOrEqual(Math.ceil(d.smart.report.expected * 1.3) + 2);
    expect(dimsOf(d.smart.annotations).length).toBeGreaterThanOrEqual(Math.floor(d.smart.report.expected * 0.7));
  });
  it("řetěz délek na jedné čáře, celková délka vně; uzavřený řetěz rozbitý pomocnou kótou v závorce", () => {
    const S = (a: Extract<DrawingAnnotation, { type: "dim" }>) => annToSheet(d.drawing.views, a.view, (a as { a: [number, number] }).a)[1] + a.offset;
    const chain = d.smart.annotations.filter((a): a is Extract<DrawingAnnotation, { type: "dim" }> => a.type === "dim" && !!a.auto?.startsWith("len:c"));
    expect(chain.length).toBe(5);
    const ys = chain.map(S);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.01);
    const all = d.smart.annotations.find((a) => a.auto === "len:all") as Extract<DrawingAnnotation, { type: "dim" }>;
    expect(S(all)).toBeGreaterThan(ys[0] + 6);
    expect(chain.filter((a) => a.prefix === "(" && a.suffix === ")").length).toBe(1);
  });
  it("průměry naskládané na straně: nejmenší nejblíž dílu, rozestup 7 mm, text zdola nahoru", () => {
    const dias = d.smart.annotations.filter((a): a is Extract<DrawingAnnotation, { type: "dim" }> => a.type === "dim" && !!a.auto?.startsWith("dia:"));
    const xOf = (a: Extract<DrawingAnnotation, { type: "dim" }>) => annToSheet(d.drawing.views, a.view, (a as { a: [number, number] }).a)[0] + a.offset;
    const v = d.drawing.views.find((x) => x.key === "front")!;
    const left = dias.filter((a) => xOf(a) < v.px).sort((a, b) => xOf(b) - xOf(a));
    const right = dias.filter((a) => xOf(a) > v.px + v.w * v.s).sort((a, b) => xOf(a) - xOf(b));
    expect(left.length + right.length).toBe(4);
    for (const side of [left, right]) {
      const val = (a: Extract<DrawingAnnotation, { type: "dim" }>) => Math.abs((a as { b: number[] }).b[1] - (a as { a: number[] }).a[1]);
      for (let i = 1; i < side.length; i++) {
        expect(val(side[i])).toBeGreaterThan(val(side[i - 1]));
        expect(Math.abs(xOf(side[i]) - xOf(side[i - 1]))).toBeCloseTo(7, 1);
      }
    }
    const t = withAnnotations(d.drawing, dias).texts.filter((x) => x.layer === "dim" && (x.s.startsWith("Ø") || x.s.startsWith("M")));
    expect(t.length).toBe(4);
    expect(t.every((x) => x.rotate === -90)).toBe(true);
  });
  it("od základny: všechny délky od jednoho čela, bez pomocné kóty", async () => {
    const b = await smartDrawing(doc, { sheet: "A3", views: VIEWS3(["front", "left"]), dimStyle: "baseline" });
    const lens = b.smart.annotations.filter((a): a is Extract<DrawingAnnotation, { type: "dim" }> => a.type === "dim" && !!a.auto?.startsWith("len:"));
    expect(lens.length).toBe(5);
    const x0 = lens.map((a) => Math.min((a as { a: number[] }).a[0], (a as { b: number[] }).b[0]));
    expect(Math.max(...x0) - Math.min(...x0)).toBeLessThan(1e-6);
    expect(lens.some((a) => a.prefix === "(")).toBe(false);
    expect(labels(b.drawing, lens).sort((p, q) => parseFloat(p) - parseFloat(q))).toEqual(["30", "33", "83", "98", "140"]);
    expect(overlaps(b.drawing, b.smart.annotations)).toEqual([]);
  });
});

describe("příklad B z návodu – příruba (roztečná kružnice, zahloubené díry)", async () => {
  let d: Awaited<ReturnType<typeof smartDrawing>>;
  beforeAll(async () => {
    const model = guideExample("### Příklad B").split("\n").filter((l) => !/^(výkres|kótovat)/.test(l)).join("\n");
    d = await smartDrawing((await runText(model)).doc, { sheet: "A3", views: VIEWS3(["front", "top"]) });
  }, 120_000);
  it("roztečná kružnice Ø120 s osovou kružnicí, jeden popis 6 děr se zahloubením, středový otvor", () => {
    const L = labels(d.drawing, d.smart.annotations);
    for (const s of ["Ø160", "20", "2× 1×45°", "Ø50 skrz", "Ø120", "6× Ø11 skrz rovnoměrně / ⌴ Ø18 ↧11"]) expect(L, s).toContain(s);
    const pcd = d.smart.annotations.find((a) => a.type === "callout" && a.lines[0] === "Ø120");
    expect(pcd?.type === "callout" && pcd.circle?.r).toBeCloseTo(60, 3);
    expect(d.smart.annotations.filter((a) => a.type === "callout" && a.lines[0].includes("Ø11")).length).toBe(1);
    expect(dimDuplicates(d.drawing.views, d.smart.annotations)).toEqual([]);
    expect(overlaps(d.drawing, d.smart.annotations)).toEqual([]);
    const out = withAnnotations(d.drawing, d.smart.annotations);
    expect(dimCheck(d.doc, d.bbox, out.texts).filter((x) => !x.present)).toEqual([]);
  });
});

describe("příklad C z návodu – deska (slepé závitové díry, průchozí díry, kapsa)", async () => {
  let d: Awaited<ReturnType<typeof smartDrawing>>;
  beforeAll(async () => {
    const model = guideExample("### Příklad C").split("\n").filter((l) => !/^(výkres|kótovat)/.test(l)).join("\n");
    d = await smartDrawing((await runText(model)).doc, { sheet: "A3", views: VIEWS3(["front", "top"]) });
  }, 120_000);
  it("hranolový díl: popisy děr, rozteče od os souměrnosti, kapsa bez polohových kót, celkové rozměry jednou", () => {
    expect(d.smart.report.kind).toBe("prismatic");
    const L = labels(d.drawing, d.smart.annotations);
    for (const s of ["4× M8 ↧10 / Ø6,8 ↧14", "2× Ø8,5 skrz", "90", "50", "60", "30", "↧8", "4× R5", "120", "80", "20"]) expect(L, s).toContain(s);
    expect(L.filter((x) => x === "50").length).toBe(2); // rozteč děr (Y) a šířka kapsy (X) – jiný význam
    expect(L).not.toContain("35"); // kapsa uprostřed: poloha od hrany by byla zbytečná
    expect(L.some((x) => x.startsWith("Ø102"))).toBe(false); // obdélníkové rozmístění není roztečná kružnice
    expect(dimDuplicates(d.drawing.views, d.smart.annotations)).toEqual([]);
    expect(overlaps(d.drawing, d.smart.annotations)).toEqual([]);
    const out = withAnnotations(d.drawing, d.smart.annotations);
    expect(dimCheck(d.doc, d.bbox, out.texts).filter((x) => !x.present)).toEqual([]);
    expect(dimsOf(d.smart.annotations).length).toBeLessThanOrEqual(d.smart.report.expected + 2);
    // souměrné rozmístění se opírá o nakreslené osy souměrnosti
    expect(d.smart.annotations.filter((a) => a.type === "centerline").length).toBe(2);
  });
  it("kratší kóty blíž obrysu: rozteč 90 vně šířky kapsy 50", () => {
    const off = (lab: string, dir: "horizontal" | "vertical") => {
      const a = d.smart.annotations.find((x) => x.type === "dim" && x.kind === dir && annLabel(d.drawing.views, x) === lab) as Extract<DrawingAnnotation, { type: "dim" }>;
      return annToSheet(d.drawing.views, a.view, (a as { a: [number, number] }).a)[1] + a.offset;
    };
    expect(off("90", "horizontal")).toBeGreaterThan(off("50", "horizontal"));
    expect(off("120", "horizontal")).toBeGreaterThan(off("90", "horizontal"));
  });
  it("SVG, DXF, PDF a DWG: popisy děr se značkami jako čáry, text bez značek", async () => {
    const out = withAnnotations(d.drawing, d.smart.annotations);
    expect(out.texts.some((t) => /[↧⌴⌵]/.test(t.s))).toBe(false);
    expect(out.texts.map((t) => t.s)).toEqual(expect.arrayContaining(["4× M8", "10", "Ø6,8", "14"]));
    expect(out.svg).toContain(">4× M8<");
    expect(out.dxf).toContain("4\\U+00D7 M8");
    const fonts = { regular: fs.readFileSync(path.resolve(__dirname, "../../public/fonts/Roboto-Regular.ttf")).buffer as ArrayBuffer };
    const pdf = await drawingToPdf({ ...out, title: "Deska" }, fonts);
    expect(pdf.size).toBeGreaterThan(10_000);
    // DWG (R2018): texty popisu bez značek, značky jako čáry ve vrstvě KOTY
    const dwg = await drawingToDwg(out, { version: "R2018" });
    const ents = [...DwgReader.readFromStream(dwg).entities!] as unknown as { objectName: string; value?: string; layer: { name: string } }[];
    const tx = ents.filter((e) => e.objectName === "TEXT").map((e) => e.value ?? "");
    expect(tx).toEqual(expect.arrayContaining(["4× M8", "10", "Ø6,8", "14"]));
    expect(tx.some((x) => /[↧⌴⌵]/.test(x))).toBe(false);
    expect(ents.filter((e) => e.layer?.name === "KOTY" && e.objectName !== "TEXT").length).toBeGreaterThan(20);
  }, 60_000);
});

describe("oběžné kolo 604200.001 B (rotační díl se 16 dírami)", async () => {
  let d: Awaited<ReturnType<typeof smartDrawing>>;
  let doc: CadDoc;
  beforeAll(async () => {
    doc = JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures", "impeller-B.mncad.json"), "utf8")) as CadDoc;
    d = await smartDrawing(doc, { views: VIEWS3(["front", "top", "bottom"]) });
  }, 300_000);
  it("16 děr jedním popisem na roztečné kružnici ve spodním pohledu, 2 díry Ø2,5 roztečí", () => {
    const L = labels(d.drawing, d.smart.annotations);
    expect(L).toContain("16× Ø13 skrz rovnoměrně");
    expect(L).toContain("Ø125,2");
    expect(L).toContain("2× Ø2,5 ↧6");
    expect(L).toContain("110");
    expect(d.smart.annotations.find((a) => a.type === "callout" && a.lines[0].startsWith("16×"))?.view).toBe("bottom");
  });
  it("výchozí pohledy: místo pro kóty nezvětší formát (A2 1:2 jako bez kót); pevný A2 1:2 bez falešného varování; Ø416 na listu", async () => {
    const body = (await buildDoc(drawingDoc(doc))).body!;
    const meta = { name: "Kolo", material: "" };
    // dřív jednotné místo kolem všech pohledů posunulo list na A1, i když se pohledy s kótami na A2 vejdou
    for (const dimRoom of [10, 24]) {
      const plain = makeDrawing(body, meta, { dimensions: "none", dimRoom, dimRoomMin: 0 });
      expect(`${plain.sheet.name} ${plain.scale}`).toBe("A2 1:2");
      expect(plain.warnings).toEqual([]);
    }
    const a2 = await smartDrawing(doc, { sheet: "A2", scale: 0.5 });
    expect(a2.drawing.warnings).toEqual([]); // dřív „Pohledy se v měřítku 1:2 nevejdou na list A2“
    expect(labels(a2.drawing, a2.smart.annotations)).toContain("Ø416");
    const auto = await smartDrawing(doc, {});
    expect(`${auto.drawing.sheet.name} ${auto.drawing.scale}`).toBe("A2 1:2");
    expect(auto.drawing.warnings).toEqual([]);
    expect(labels(auto.drawing, auto.smart.annotations)).toContain("Ø416");
    expect(labels(auto.drawing, auto.smart.annotations)).toContain("Ø338,4");
    // kóty a popisy uvnitř rámu a mimo razítko
    const { w: W, h: H } = auto.drawing.sheet;
    const tb: Box = { x0: W - 10 - 180, y0: H - 10 - 38, x1: W - 10, y1: H - 10 };
    for (const b of annotationBoxes(auto.drawing, auto.smart.annotations).flatMap((x) => x.boxes)) {
      expect(b.x0 >= 20 && b.y0 >= 10 && b.x1 <= W - 10 && b.y1 <= H - 10, JSON.stringify(b)).toBe(true);
      expect(boxesOverlap(b, tb), JSON.stringify(b)).toBe(false);
    }
    expect(auto.smart.report.skipped.filter((s) => s.startsWith("Ø416"))).toEqual([]);
    expect(dimDuplicates(auto.drawing.views, auto.smart.annotations)).toEqual([]);
    expect(overlaps(auto.drawing, auto.smart.annotations)).toEqual([]);
  }, 300_000);
  it("bez duplicit a překryvů; počet kót nepřesáhne počet očekávaných rozměrů", () => {
    expect(d.smart.report.kind).toBe("turned");
    expect(dimDuplicates(d.drawing.views, d.smart.annotations)).toEqual([]);
    expect(overlaps(d.drawing, d.smart.annotations)).toEqual([]);
    expect(dimsOf(d.smart.annotations).length).toBeLessThanOrEqual(d.smart.report.expected);
    expect(dimsOf(d.smart.annotations).length).toBeGreaterThan(15);
    // kuželové plochy profilu se nekótují jako sražení – jsou nahlášené
    expect(labels(d.drawing, d.smart.annotations).some((x) => /×\d+(,\d+)?°$/.test(x) && !/×(15|20|30|45|60)°$/.test(x))).toBe(false);
    expect(d.smart.report.skipped.some((s) => s.startsWith("kuželové plochy"))).toBe(true);
  });
});

describe("textové příkazy výkresu nad modelem: kótovat, tolerance, výkres stav", async () => {
  it("příklad A celý (model + výkres + kótovat + tolerance + stav)", async () => {
    const { doc, log } = await runText(guideExample("### Příklad A"));
    const s = doc.drawings![0];
    expect((s.options as { sheet: string }).sheet).toBe("A3");
    expect((s.options as { views: Record<string, boolean> }).views).toMatchObject({ front: true, left: true, top: false, iso: true });
    expect((s.meta as { tolerance: string }).tolerance).toBe("ISO 2768-mK");
    expect(log.some((l) => /^✓ Chytré kóty \(řetězově\): 14 kót a popisů – přední 14/.test(l))).toBe(true);
    const tol = s.annotations.find((a) => a.type === "dim" && a.suffix === "h6");
    expect(tol && annLabel([], tol)).toBe("Ø30h6");
    const st = log.find((l) => l.startsWith("Výkres „List 1“"))!;
    expect(st).toContain("list A3 na šířku");
    expect(st).toContain("Duplicity: žádné");
    expect(st).toMatch(/Kontrola kót: všech \d+ očekávaných rozměrů je na listu/);
    expect(st).toContain("přední: ");
    expect(st).toContain("Ø30h6");
    expect(st).toContain("nepředepsané tolerance ISO 2768-mK");
  }, 120_000);
  it("tolerance: závit (M20 6g) a nejednoznačná kóta se seznamem kandidátů", async () => {
    const { doc } = await runText(guideExample("### Příklad C").replace("výkres tolerance 90 ±0,05", "výkres tolerance M8 6H"));
    const c = doc.drawings![0].annotations.find((a) => a.type === "callout" && a.lines[0].includes("M8"));
    expect(c?.type === "callout" && calloutLines(c)[0]).toBe("4× M8-6H ↧10");
    await expect(runText(`${guideExample("### Příklad C")}\nvýkres tolerance 50 ±0,1`).then((r) => r.log.join("\n"))).rejects.toThrow(/není jednoznačná \(2×/);
  }, 120_000);
  it("výkres stav: duplicitní uživatelská kóta se nahlásí; chybějící rozměr v Kontrole kót", async () => {
    const { doc } = await runText(guideExample("### Příklad C").split("\n").filter((l) => !/^výkres (tolerance|stav)/.test(l)).join("\n"));
    const sheet = doc.drawings![0];
    const res = await computeDrawing(doc, { name: "Deska", material: "" }, { ...(sheet.options as object), dimensions: "smart" });
    const ov = sheet.annotations.find((a) => a.auto === "ov:x") as Extract<DrawingAnnotation, { type: "dim" }>;
    // stejný rozměr 120 znovu (uživatel) a smazaná rozteč 60
    const dupl: DrawingAnnotation = { ...ov, id: "u1", auto: undefined, offset: ov.offset + 7 };
    const anns = [...sheet.annotations.filter((a) => a.auto !== "pos:top:1:s-10.000"), dupl];
    const d2: CadDoc = { ...doc, drawings: [{ ...sheet, annotations: anns, options: { ...sheet.options, smartOff: ["pos:top:1:s-10.000"] } }] };
    const st = (await drawingStatus(d2, computeDrawing)).text;
    expect(st).toMatch(/Duplicity \(1\): 120 \(horní\) = 120 \(horní\)/);
    expect(st).toMatch(/Kontrola kót: chybí 1 z \d+: 60 \(rozteč\)/);
    expect(st).toContain("120 *");
    void res;
    void linMeaning;
  }, 120_000);
  it("sloučení: vlastní kóty zůstanou, tolerance vygenerované kóty se přenese, smazané se nevrátí", () => {
    const gen = (key: string, id: string, extra = {}): DrawingAnnotation => ({ id, view: "front", auto: key, type: "dim", kind: "horizontal", a: [0, 0], b: [10, 0], offset: 8, ...extra }) as DrawingAnnotation;
    const user: DrawingAnnotation = { id: "u", view: "front", type: "note", at: [0, 0], text: "pozn." };
    const old = [user, gen("a", "o1", { suffix: "h6" }), gen("b", "o2")];
    const smart = { gen: "G2", annotations: [gen("a", "n1"), gen("b", "n2"), gen("c", "n3")], report: { kind: "prismatic" as const, perView: {}, skipped: [], expected: 3, noRoom: 0 } };
    const m = mergeSmart(old, { smartGen: "G1", smartOff: ["c"] }, smart)!;
    expect(m.annotations.map((a) => a.id)).toEqual(["u", "o1", "o2"]);
    expect((m.annotations[1] as { suffix?: string }).suffix).toBe("h6");
    expect(mergeSmart(m.annotations, { smartGen: "G2" }, smart)).toBeNull();
    expect(mergeSmart(m.annotations, { smartGen: "G2", smartOff: ["c"] }, smart, true)!.annotations.map((a) => a.auto ?? a.id)).toEqual(["u", "a", "b", "c"]);
  });
});
