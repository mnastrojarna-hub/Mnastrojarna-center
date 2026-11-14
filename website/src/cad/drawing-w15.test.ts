/**
 * Vlna 15 (test 959 – překreslení střihadla), balík výkresu – regresní testy chyb z polního hlášení:
 * - B5: `výkres … řez XZ|YZ|XY odsazení N` = stejná konvence jako `skica XZ odsazení N` (podél normály roviny skici),
 *   starší uložené řezy (bez příznaku `normal`) se staví beze změny, řez mimo těleso = ✗ ve výsledku příkazu + `issues`;
 * - B6: „pohledy se v měřítku 1:2 nevejdou na list A2“ = strukturované hlášení výsledku příkazu i stavu výkresu (+ ⚠);
 * - B7: Chytré kóty drží desetinná místa modelu (74,175, ne 74,18), `výkres tolerance` hledá kótu ČÍSELNOU hodnotou a id;
 * - B8: funkční rozměry (`kótovat … funkční 26,5 74,175`) nikdy nejsou pomocné „(…)“, tolerance na pomocné kótě ji převede;
 * - B12: deska s mnoha dírami → souřadnicové kóty (nebo tabulka děr) místo „! vynecháno“;
 * - 5.3: `výkres kontrola tolerancí`.
 * OpenCascade v Node (jako drawing-dims.test.ts).
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { parseAgentText } from "./agent";
import { parseDimension, parseDrawing } from "./agent-drawing";
import { annotationGeometry, dimLabel, fmtVal, makeDrawing, withAnnotations, type DrawingResult, type SectionOpt } from "./drawing";
import { applyDrawingCmd, drawingStatus, findDims, tolCheckLines, type DrawingCmdResult, type SmartResult } from "./drawing-agent";
import { annLabel } from "./drawing-marks";
import { buildDoc } from "./build";
import { drawingDoc } from "./drawing-doc";
import { computeDrawing, runText, smartDrawing } from "./drawing-dims-harness";
import { annotationBoxes } from "./drawing-dims-layout";
import { boxesOverlap } from "./drawing-symbols";
import { absoluteSection, sectionAt, sectionCoord, sectionMiss, sectionOffsetRange, sectionText, SKETCH_NORMAL_SIGN } from "./drawing-section";
import { chooseReference, sameSize, toleranceCheck } from "./drawing-functional";
import { issuesOf } from "./drawing-issues";
import { ordinateGeom, spreadOrdinates } from "./drawing-ordinate";
import { setLang } from "./i18n";
import { emptyDoc, type CadDoc, type DrawingAnnotation, type Vec3 } from "./types";
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

const cmdOf = (text: string) => {
  const p = parseAgentText(text);
  expect(p.errors, JSON.stringify(p.errors)).toEqual([]);
  const op = p.ops[0];
  if (op.k !== "drawingCmd") throw new Error(`není příkaz výkresu: ${op.k}`);
  return op.cmd;
};
/** dokument z textu + jeden příkaz výkresu přímo (výsledek i s `issues`) */
async function apply(doc: CadDoc, line: string): Promise<DrawingCmdResult> {
  return applyDrawingCmd(doc, cmdOf(line), computeDrawing);
}
const labelsOf = (d: Pick<DrawingResult, "views">, anns: DrawingAnnotation[]) => anns.filter((a) => a.type === "dim" || a.type === "callout").map((a) => annLabel(d.views as DrawingResult["views"], a));

// ------------------------------------------------------------------ B5

describe("B5 – řez výkresu ve stejné konvenci jako skica", () => {
  it("čisté funkce: odsazení podél normály roviny skici (XY +Z, XZ −Y, YZ +X), rozsah a hláška", () => {
    // replicad: normála roviny skici XZ míří do −Y → skica XZ odsazení 57 leží v y = −57
    for (const pl of ["XY", "XZ", "YZ"] as const) {
      const o = r.makePlane(pl, 57).origin;
      const k = pl === "YZ" ? 0 : pl === "XZ" ? 1 : 2;
      expect([o.x, o.y, o.z][k]).toBeCloseTo(sectionCoord({ plane: pl, offset: 57, normal: true }), 9);
      expect(SKETCH_NORMAL_SIGN[pl] * 57).toBeCloseTo([o.x, o.y, o.z][k], 9);
    }
    expect(sectionCoord({ plane: "XZ", offset: 57 })).toBe(57); // starší řez: souřadnice
    expect(sectionAt("XZ", -57)).toEqual({ plane: "XZ", offset: 57, normal: true });
    expect(absoluteSection({ plane: "XZ", offset: 57, normal: true, kind: "half" })).toEqual({ plane: "XZ", offset: -57, kind: "half" });
    expect(sectionText({ plane: "XZ", offset: 57, normal: true })).toBe("XZ odsazení 57 (rovina Y = -57)");
    const bbox: [Vec3, Vec3] = [[-90, -308, 0], [90, 0, 250]];
    expect(sectionOffsetRange("XZ", bbox)).toEqual([0, 308]);
    expect(sectionMiss({ plane: "XZ", offset: 57, normal: true }, bbox)).toBeNull();
    expect(sectionMiss({ plane: "XZ", offset: -57, normal: true }, bbox)).toBe("rovina řezu Y = 57 leží mimo těleso (Y -308…0) – odsazení -57 se měří podél normály roviny XZ jako u skici; řez protne těleso pro odsazení větší než 0 a menší než 308 (krajní hodnoty leží na ploše tělesa), např. 154");
    expect(sectionMiss({ plane: "XZ", offset: -57 }, bbox)).toBeNull(); // dokument 959: starší řez XZ −57 = y −57 (uvnitř)
    expect(sectionMiss({ plane: "XY", offset: 300, normal: true }, bbox)).toMatch(/^rovina řezu Z = 300 leží mimo těleso \(Z 0…250\)/);
  });
  it("parser: `řez XZ odsazení 57` nese příznak konvence skici (CS/EN/DE), souhrn ukazuje rovinu", () => {
    for (const t of ["výkres řez XZ odsazení 57", "drawing section XZ offset 57", "zeichnung schnitt XZ versatz 57"]) {
      const c = cmdOf(t);
      expect(c).toMatchObject({ k: "set", opts: { section: { plane: "XZ", offset: 57, normal: true } } });
    }
    const c = cmdOf("výkres řez XZ odsazení 57 poloviční");
    expect(c.k === "set" && c.summary.join()).toContain("řez XZ odsazení 57 (rovina Y = -57) (poloviční)");
  });
  it("jádro: řez XZ odsazení 20 = rovina y = −20 jako skica; starší uložený řez (y = −20) dá stejný obraz", async () => {
    const doc = (await runText("nový díl P\nskica XZ: obdélník 40 30 v 0 15\nvysunout 60\ndíra 10 skrz v 0 -20 15 osa Y obousměrně")).doc;
    const body = (await buildDoc(drawingDoc(doc))).body!;
    expect((body.boundingBox.bounds as [Vec3, Vec3])[0][1]).toBeCloseTo(-60, 6); // těleso y −60…0
    const meta = { name: "P", material: "" };
    const views = { front: true, top: true, left: false, right: false, back: false, bottom: false, iso: false };
    const now = makeDrawing(body, meta, { sheet: "A3", views, section: { plane: "XZ", offset: 20, normal: true } as SectionOpt });
    const old = makeDrawing(body, meta, { sheet: "A3", views, section: { plane: "XZ", offset: -20 } });
    expect(now.warnings).toEqual([]);
    expect(now.issues).toBeUndefined();
    const sv = (d: DrawingResult) => d.views.find((v) => v.key === "section")!;
    expect(sv(now)).toBeDefined();
    expect([sv(now).x0, sv(now).y0, sv(now).w, sv(now).h]).toEqual([sv(old).x0, sv(old).y0, sv(old).w, sv(old).h]);
    expect(now.svg).toBe(old.svg);
  }, 120_000);
  it("rovina mimo těleso: ✗ ve výsledku příkazu s rozsahem odsazení a `issues` drawing.section-miss (✓ jen pro uložení voleb)", async () => {
    const doc = (await runText("nový díl P\nskica XZ: obdélník 40 30 v 0 15\nvysunout 60")).doc;
    const ok = await apply(doc, "výkres A3 pohledy přední,horní řez XZ odsazení 20");
    expect(ok.log.some((l) => l.startsWith("✗"))).toBe(false);
    expect(ok.issues ?? []).toEqual([]);
    const bad = await apply(doc, "výkres A3 pohledy přední,horní řez XZ odsazení -80");
    expect(bad.log).toContain("✗ rovina řezu Y = 80 leží mimo těleso (Y -60…0) – odsazení -80 se měří podél normály roviny XZ jako u skici; řez protne těleso pro odsazení větší než 0 a menší než 60 (krajní hodnoty leží na ploše tělesa), např. 30");
    expect(bad.issues).toEqual([expect.objectContaining({ level: "error", code: "drawing.section-miss", kind: "section-miss", data: expect.objectContaining({ plane: "XZ", offset: -80, coord: 80, offsetRange: [0, 60], convention: "sketch" }) })]);
    // stav výkresu: řádek ✗ s důvodem + strukturované hlášení se jménem listu
    const st = await drawingStatus(bad.doc, computeDrawing);
    expect(st.text).toContain("Volby: řez XZ odsazení -80 (rovina Y = 80) celý");
    expect(st.text).toContain("✗ rovina řezu Y = 80 leží mimo těleso");
    expect(st.issues?.[0]).toMatchObject({ code: "drawing.section-miss", data: { sheetName: "List 1" } });
  }, 120_000);
  it("starší zápis (číslo jako souřadnice na ose): mine-li dnešní výklad těleso a starý ho protne, vyloží se postaru s ⚠ a uloží v dnešní konvenci", async () => {
    const doc = (await runText("nový díl P2\nskica XZ: obdélník 40 30 v 0 15\nvysunout 60")).doc; // těleso Y −60…0
    const r = await apply(doc, "výkres A3 pohledy přední,horní řez XZ odsazení -20");
    expect(r.log.some((l) => l.startsWith("✗"))).toBe(false);
    expect(r.log).toContain("✓ výkres: A3, pohledy přední, horní, řez XZ odsazení 20 (rovina Y = -20)");
    expect(r.log).toContain("⚠ řez XZ odsazení -20: rovina Y = 20 těleso míjí – číslo vyloženo postaru jako souřadnice Y = -20 (zápis před sjednocením znaménka se skicou); dnes pište: výkres řez XZ odsazení 20");
    expect(r.issues).toEqual([expect.objectContaining({ level: "warn", code: "drawing.warning", kind: "section-legacy", data: { plane: "XZ", typed: -20, offset: 20, coord: -20 } })]);
    expect((r.doc.drawings![0].options as { section?: unknown }).section).toEqual({ plane: "XZ", offset: 20, normal: true });
    // číslo platné v dnešním výkladu se nikdy nepřekládá (i když by platilo i postaru) – těleso přes Y = 0
    const sym = (await runText("nový díl S\nkvádr 40 60 20 střed")).doc; // Y −30…30
    const s = await apply(sym, "výkres A3 pohledy přední,horní řez XZ odsazení -10");
    expect(s.log.some((l) => l.startsWith("⚠ řez"))).toBe(false);
    expect((s.doc.drawings![0].options as { section?: unknown }).section).toEqual({ plane: "XZ", offset: -10, normal: true });
  }, 120_000);
});

// ------------------------------------------------------------------ B6

describe("B6 – „nevejde se na list“ jako strukturované hlášení", () => {
  it("výkres A2 měřítko 1:2 u velkého dílu: ⚠ v protokolu příkazu, `issues` sheet-fit, stav výkresu", async () => {
    const doc = (await runText("nový díl Q\nkvádr 800 600 300")).doc;
    const r1 = await apply(doc, "výkres A2 měřítko 1:2 pohledy přední,horní,levý,iso");
    expect(r1.log).toContain("⚠ Pohledy se v měřítku 1:2 nevejdou na list A2.");
    expect(r1.issues).toContainEqual(expect.objectContaining({ level: "warn", code: "drawing.warning", kind: "sheet-fit", data: { scale: "1:2", sheet: "A2" } }));
    const st = await drawingStatus(r1.doc, computeDrawing);
    expect(st.text).toContain("Varování výkresu: Pohledy se v měřítku 1:2 nevejdou na list A2.");
    expect(st.issues).toContainEqual(expect.objectContaining({ kind: "sheet-fit", data: { scale: "1:2", sheet: "A2", sheetName: "List 1" } }));
    // výkres stav jako příkaz vrací totéž v `issues`
    const r2 = await apply(r1.doc, "výkres stav");
    expect(r2.issues?.some((i) => i.kind === "sheet-fit")).toBe(true);
    // vejde-li se, žádné hlášení
    const r3 = await apply(doc, "výkres A0 měřítko 1:5 pohledy přední,horní,levý,iso");
    expect((r3.issues ?? []).filter((i) => i.kind === "sheet-fit")).toEqual([]);
  }, 180_000);
  it("issuesOf: varování bez strukturovaného hlášení = drawing.warning / other; odznak se neopakuje", () => {
    const list = issuesOf({ warnings: ["A", "B"], issues: [{ level: "error", code: "drawing.section-miss", kind: "section-miss", text: "dlouhý text", data: { badge: "A" } }] });
    expect(list.map((i) => [i.code, i.kind, i.text])).toEqual([["drawing.section-miss", "section-miss", "dlouhý text"], ["drawing.warning", "other", "B"]]);
  });
});

// ------------------------------------------------------------------ B7

describe("B7 – desetinná místa modelu a hledání kóty hodnotou", () => {
  it("formát: tisíciny bez koncových nul, úhel na setiny", () => {
    expect(fmtVal(74.175)).toBe("74,175");
    expect(fmtVal(74.1)).toBe("74,1");
    expect(fmtVal(19.9999999)).toBe("20");
    expect(fmtVal(6.6472)).toBe("6,647");
    expect(dimLabel({ kind: "horizontal" }, 74.175)).toBe("74,175");
    expect(dimLabel({ kind: "angle" }, 26.56505)).toBe("26,57°");
    expect(sameSize(74.175, 74.175000001)).toBe(true);
    expect(sameSize(74.18, 74.175)).toBe(false);
    expect(sameSize(6.647, 6.6472)).toBe(true);
  });
  it("kvádr 74,175: kóta „74,175“, tolerance hodnotou i id; zaokrouhlená hodnota 74,18 kótu nenajde", async () => {
    const { doc, log } = await runText("nový díl R\nkvádr 74,175 40 20\nvýkres A3 pohledy přední,horní,iso\nkótovat\nvýkres tolerance 74,175 -0,005");
    expect(log.at(-1)).toBe("✓ tolerance -0,005 → 74,175-0,005 (přední)");
    await expect(apply(doc, "výkres tolerance 74,18 ±0,1")).rejects.toThrow(/^kóta „74,18“ na výkrese není – kóty: a1 74,175-0,005 \(přední\)/);
    const byId = await apply(doc, "výkres tolerance a1 h7");
    expect(byId.log.at(-1)).toMatch(/^✓ tolerance h7 → 74,175h7/);
  }, 120_000);
  it("nejednoznačná hodnota: seznam s id; `pohled …` ji zúží (CS/EN)", async () => {
    const { doc } = await runText("nový díl K\nkvádr 40 40 20\nvýkres A3 pohledy přední,horní,iso\nkótovat");
    const err = await apply(doc, "výkres tolerance 40 ±0,1").then(() => "", (e: Error) => e.message);
    expect(err).toMatch(/^kóta „40“ není jednoznačná \(2×: a\d+ 40 \((přední|horní)\), a\d+ 40 \((přední|horní)\)\) – upřesněte ji id/);
    const view = /a\d+ 40 \(horní\)/.test(err) ? "horní" : "přední";
    const one = await apply(doc, `výkres tolerance 40 ±0,1 pohled ${view}`);
    expect(one.log.at(-1)).toBe(`✓ tolerance ±0,1 → 40±0,1 (${view})`);
    expect(cmdOf("drawing tolerance 40 ±0.1 view top")).toEqual({ k: "tol", target: "40", tol: "±0.1", view: "top" });
    expect(cmdOf("zeichnung toleranz 40 ±0,1 ansicht vorne")).toEqual({ k: "tol", target: "40", tol: "±0,1", view: "front" });
  }, 120_000);
});

// ------------------------------------------------------------------ B8

const SHAFT = "nový díl Hřídel\nskica XZ: čára 0 0 0 10 30 10 30 8,5 33 8,5 33 15 83 15 83 20 98 20 98 12,5 140 12,5 140 0 uzavřít\nrotovat osa X\nvýkres A3 na šířku pohledy přední,levý,iso\n";

describe("B8 – funkční rozměry", () => {
  it("parser CS/EN/DE: funkční čísla, zrušení, díry", () => {
    expect(parseDimension(["chytře", "funkční", "26,5", "74,175"])).toEqual({ k: "dim", mode: "smart", functional: [26.5, 74.175] });
    expect(parseDimension(["smart", "functional", "26.5"])).toEqual({ k: "dim", mode: "smart", functional: [26.5] });
    expect(parseDimension(["funktional", "26,5", "od", "základny"])).toEqual({ k: "dim", mode: "smart", functional: [26.5], style: "baseline" });
    expect(parseDimension(["funkční", "ne"])).toEqual({ k: "dim", mode: "smart", functional: [] });
    expect(() => parseDimension(["funkční"])).toThrow(/kótovat funkční <rozměr>/);
    expect(cmdOf("bemaßen funktional 50")).toEqual({ k: "dim", mode: "smart", functional: [50] });
  });
  it("chooseReference: nejdelší nefunkční článek; všechny funkční → celková délka; i ta → poznámka", () => {
    expect(chooseReference([30, 3, 50, 15, 42], 140, [])).toEqual({ ref: 2 });
    expect(chooseReference([30, 3, 50, 15, 42], 140, [50])).toEqual({ ref: 4 });
    expect(chooseReference([30, 3, 50, 15, 42], 140, [30, 3, 50, 15, 42])).toEqual({ ref: "overall" });
    expect(chooseReference([30, 3, 50], 83, [30, 3, 50, 83]).note).toMatch(/uzavřený řetěz/);
  });
  it("hřídel: funkční 50 → pomocnou kótou je (42); funkční všechny články → (140); protokol hlásí neznámý rozměr", async () => {
    const a = await runText(`${SHAFT}kótovat funkční 50`);
    expect(a.log.at(-1)).toMatch(/· funkční 50$/);
    const sa = (await drawingStatus(a.doc, computeDrawing)).text;
    const front = sa.split("\n").find((l) => l.startsWith("  přední: "))!;
    expect(front).toContain(" 50 ");
    expect(front).toContain("(42)");
    expect(front).not.toContain("(50)");
    const b = await runText(`${SHAFT}kótovat funkční 30 3 50 15 42 99`);
    expect(b.log).toContain("! funkční rozměr 99: na listu není délková kóta s touto hodnotou (hodnoty kót: výkres stav)");
    const fb = (await drawingStatus(b.doc, computeDrawing)).text.split("\n").find((l) => l.startsWith("  přední: "))!;
    expect(fb).toContain("(140)");
    expect(fb).not.toMatch(/\((30|3|50|15|42)\)/);
  }, 180_000);
});

// ------------------------------------------------------------------ B12

/** deska 120 × 80 s 22 dírami v nepravidelných polohách (jako desky 959) */
const PLATE22 = (() => {
  const pts = [[57.4, 15.1], [64.7, 64.2], [90.3, 67.9], [107.3, 51.3], [9.4, 42.2], [9.6, 19.9], [26.9, 46.4], [55.9, 51.6], [101.6, 19.8], [67.4, 48.5], [80.2, 34.3], [17, 11.6], [30.4, 25.2], [42, 61.6], [48.3, 32.6], [85.7, 13.7], [34.6, 70.9], [19, 33.9], [91.9, 45.4], [44.4, 21.7], [68.9, 19.9], [31.7, 35.5]];
  return `nový díl Deska22\nkvádr 120 80 15\n${pts.map(([x, y], i) => `díra ${i % 2 ? 6 : 8} skrz v ${String(x).replace(".", ",")} ${String(y).replace(".", ",")}`).join("\n")}\nvýkres A3 na šířku pohledy přední,horní,iso\n`;
})();
/** texty kót se nepřekrývají */
function overlaps(d: DrawingResult, anns: DrawingAnnotation[]): number {
  const items = annotationBoxes(d, anns).flatMap((x) => x.boxes);
  let n = 0;
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (boxesOverlap(items[i], items[j])) n++;
  return n;
}

describe("B12 – deska s mnoha dírami: souřadnicové kóty / tabulka děr místo „vynecháno“", () => {
  it("rozestup textů: shluky se rozloží rovnoměrně kolem středu, vzdálené body bez posunu", () => {
    const xs = [10, 11, 12, 40];
    const j = spreadOrdinates(xs, 4);
    const t = xs.map((x, i) => x + j[i]);
    expect(t[1] - t[0]).toBeCloseTo(4, 9);
    expect(t[2] - t[1]).toBeCloseTo(4, 9);
    expect((t[0] + t[1] + t[2]) / 3).toBeCloseTo(11, 9);
    expect(j[3]).toBe(0);
    // geometrie: vynášecí čára z bodu k řadě se zalomením, text na konci (svisle pod řadou)
    const g = ordinateGeom([50, 100], "h", 120, 2, "57,4");
    expect(g.segs).toEqual([[[50, 101], [50, 117]], [[50, 117], [52, 120]]]);
    expect(g.text).toMatchObject({ s: "57,4", rotate: -90, anchor: "end", y: 121 });
  });
  it("22 děr: automaticky souřadnicově, žádné „vynecháno“, počátek 0 a celkové rozměry jako poslední souřadnice, bez překryvů", async () => {
    const { doc, log } = await runText(`${PLATE22}kótovat`);
    expect(log.filter((l) => l.includes("vynech"))).toEqual([]);
    expect(log.at(-1)).toMatch(/· polohy děr souřadnicově \(horní\)$/);
    const s = doc.drawings![0];
    const res = (await computeDrawing(doc, { name: "D", material: "" }, s.options as never)) as SmartResult;
    expect(res.smart!.report.skipped).toEqual([]);
    expect(res.smart!.report.holeMode).toEqual({ top: "ordinate" });
    const ord = s.annotations.filter((a) => a.type === "dim" && "ord" in a && a.ord);
    const labels = labelsOf(res, ord);
    expect(labels).toContain("0");
    expect(labels).toContain("120");
    expect(labels).toContain("80");
    expect(labels).toContain("57,4");
    expect(labels).toContain("15,1");
    // 22 x + 22 y (některé shodné) + počátek a vzdálené hrany
    expect(ord.length).toBeGreaterThanOrEqual(40);
    // celková délka 120 / šířka 80 se nekreslí podruhé jako délková kóta
    const plain = labelsOf(res, s.annotations.filter((a) => a.type === "dim" && !("ord" in a && a.ord)));
    expect(plain.filter((l) => l === "120" || l === "80")).toEqual([]);
    expect(overlaps(withAnnotations(res, s.annotations), s.annotations)).toBe(0);
    // tolerance na souřadnicovou kótu hodnotou
    const t = await apply(doc, "výkres tolerance 57,4 ±0,02");
    expect(t.log.at(-1)).toBe("✓ tolerance ±0,02 → 57,4±0,02 (horní)");
    // stav: polohy děr
    expect((await drawingStatus(doc, computeDrawing)).text).toContain("Polohy děr: souřadnicové kóty od levého dolního rohu (horní)");
  }, 240_000);
  it("kótovat díry tabulka: polohy v tabulce děr (X, Y od rohu obrysu), žádné kóty poloh; řetězově = od hran", async () => {
    const { doc, log } = await runText(`${PLATE22}kótovat díry tabulka`);
    expect(log.at(-1)).toMatch(/· polohy děr tabulkou děr \(horní\)$/);
    const s = doc.drawings![0];
    const res = await computeDrawing(doc, { name: "D", material: "" }, s.options as never);
    expect(res.holes?.length).toBe(22);
    expect(res.holes!.find((h) => Math.abs(h.x - 57.4) < 1e-6 && Math.abs(h.y - 15.1) < 1e-6)).toBeDefined();
    expect(res.svg).toContain("Tabulka děr");
    expect(s.annotations.filter((a) => a.auto?.startsWith("pos:") || a.auto?.startsWith("ord:"))).toEqual([]);
    expect(labelsOf(res, s.annotations)).toContain("11× Ø8 skrz");
    const ch = await runText(`${PLATE22}kótovat díry řetězově`);
    expect(ch.log.at(-1)).not.toMatch(/polohy děr/);
    expect(cmdOf("dimension holes ordinate")).toEqual({ k: "dim", mode: "smart", holes: "ordinate" });
    expect(cmdOf("bemaßen bohrungen tabelle")).toEqual({ k: "dim", mode: "smart", holes: "table" });
  }, 300_000);
  it("pravidelná mřížka 5 × 4 (9 poloh) zůstane u roztečí „4× 40“", async () => {
    const d = await smartDrawing((await runText("nový díl M\nkvádr 200 120 20\ndíra 8,5 skrz v 20 15\npole 5 rozteč 40 směr X 4 rozteč 30 směr Y")).doc, { sheet: "A3", views: { front: true, top: true, left: false, right: false, back: false, bottom: false, iso: true } });
    expect(d.smart.report.holeMode).toEqual({ top: "edges" });
    const top = labelsOf(d.drawing, d.smart.annotations.filter((a) => a.view === "top"));
    expect(top).toContain("4× 40 (=160)");
    expect(top).toContain("3× 30 (=90)");
  }, 120_000);
});

// ------------------------------------------------------------------ 5.3

describe("5.3 – výkres kontrola tolerancí", () => {
  it("čistá funkce: ok / bez tolerance / chybí / jen pomocná; předloha", () => {
    const dims = [
      { id: "a1", label: "30", value: 30, view: "front", tolerance: "", reference: false },
      { id: "a2", label: "42±0,05", value: 42, view: "front", tolerance: "±0,05", reference: false },
      { id: "a3", label: "(50)", value: 50, view: "front", tolerance: "", reference: true },
    ];
    const rows = toleranceCheck(dims, [30, 42, 50, 7], [{ value: 19.9, tolerance: "±0,1" }, { value: 42, tolerance: "±0,05" }]);
    expect(rows.map((r) => [r.value, r.kind, r.status])).toEqual([[30, "functional", "missing-tol"], [42, "functional", "ok"], [50, "functional", "reference"], [7, "functional", "missing-dim"], [19.9, "reference", "missing-dim"]]);
  });
  it("hřídel: funkční 30 a 42, tolerance jen na 42 → ⚠ s 30, `issues` drawing.tolerance-missing; parser CS/EN/DE", async () => {
    const { doc } = await runText(`${SHAFT}kótovat funkční 30 42\nvýkres tolerance 42 ±0,05`);
    const r1 = await apply(doc, "výkres kontrola tolerancí");
    expect(r1.log[0]).toBe("⚠ kontrola tolerancí: bez tolerance 1 z 2 funkčních rozměrů (předloha není připojena – kóty předlohy se nekontrolují)");
    expect(r1.log[1]).toMatch(/^ {2}⚠ 30 \(funkční\): kóta bez tolerance a\d+ 30 \(přední\) – výkres tolerance a\d+ …$/);
    expect(r1.log[2]).toMatch(/^ {2}✓ 42 funkční: a\d+ 42±0,05 \(přední\)$/);
    expect(r1.issues).toEqual([expect.objectContaining({ code: "drawing.tolerance-missing", kind: "tolerance-missing", data: expect.objectContaining({ value: 30, source: "functional", status: "missing-tol" }) })]);
    // předloha (balík předlohy): tolerované kóty výtahu přes prostředí
    const r2 = await applyDrawingCmd(doc, cmdOf("drawing check tolerances"), computeDrawing, { referenceDims: () => [{ value: 140, tolerance: "±0,2" }, { value: 77, tolerance: "h9" }] });
    expect(r2.log[0]).toBe("⚠ kontrola tolerancí: bez tolerance 3 z 4 rozměrů (funkčních 2, z předlohy 2)");
    expect(r2.log.some((l) => /77 \(předloha h9\): na listu není kóta s touto hodnotou/.test(l))).toBe(true);
    expect(cmdOf("zeichnung prüfen toleranzen")).toEqual({ k: "tolcheck" });
    expect(cmdOf("výkres tolerance kontrola")).toEqual({ k: "tolcheck" });
    // bez funkčních rozměrů: není co kontrolovat
    expect(tolCheckLines([], [], {}).lines).toEqual(["✓ kontrola tolerancí: list nemá funkční rozměry (kótovat … funkční …) ani tolerované kóty předlohy – není co kontrolovat"]);
  }, 180_000);
  it("EN popisky protokolu", () => {
    setLang("en");
    try {
      expect(parseDrawing(["check", "tolerances"])).toEqual({ k: "tolcheck" });
    } finally {
      setLang("cs");
    }
  });
});

// ------------------------------------------------------------------ ostatní

describe("souřadnicová kóta: kreslení a hodnota", () => {
  it("annotationGeometry: vynášecí čára z bodu do řady, hodnota od počátku; findDims ji najde hodnotou", () => {
    const views = [{ key: "top", px: 50, py: 50, s: 1, x0: 0, y0: 0, w: 120, h: 80 }];
    const a: DrawingAnnotation = { id: "o1", view: "top", type: "dim", kind: "horizontal", a: [0, 80], b: [57.4, 64.9], offset: 8, ord: true };
    const g = annotationGeometry({ views, scaleValue: 1 }, [a]);
    expect(g.texts.map((t) => t.s)).toEqual(["57,4"]);
    expect(g.polys[0].pts).toEqual([[107.4, 115.9], [107.4, 138]]);
    expect(findDims(views, [a], "57,4")).toHaveLength(1);
  });
  it("emptyDoc bez výkresu: stav výkresu bez hlášení", async () => {
    const st = await drawingStatus(emptyDoc("x"), computeDrawing);
    expect(st.issues).toBeUndefined();
  });
});

describe("návod pro AI – příklad D", () => {
  it("funkční rozměry, tolerance na funkční kótu a kontrola tolerancí jako v návodu", async () => {
    const { AGENT_GUIDE } = await import("./agent-guide");
    const i = AGENT_GUIDE.indexOf("### Příklad D");
    expect(i).toBeGreaterThan(0);
    const a = AGENT_GUIDE.indexOf("```", i) + 3;
    const text = AGENT_GUIDE.slice(a, AGENT_GUIDE.indexOf("```", a)).trim();
    const { doc, log } = await runText(text);
    expect(log).toContain("⚠ kontrola tolerancí: bez tolerance 1 z 2 funkčních rozměrů (předloha není připojena – kóty předlohy se nekontrolují)");
    const line = log.find((l) => l.startsWith("  ⚠ 30 (funkční)"))!;
    expect(AGENT_GUIDE).toContain(line.trim());
    const front = (await drawingStatus(doc, computeDrawing)).text.split("\n").find((l) => l.startsWith("  přední: "))!;
    for (const t of ["30 ", " 3 ", "50-0,1", "15", "(42)"]) expect(front).toContain(t);
  }, 120_000);
});

describe("B8 – posloupnost jako v konzoli (e2e)", () => {
  it("funkční 50 30 → tolerance na (42) ji převede, pomocná (15); stav ukáže kontrolu tolerancí", async () => {
    const a = await runText(`${SHAFT}kótovat funkční 50 30\nvýkres stav`);
    expect(a.log.join("\n")).toContain("Funkční rozměry: 50, 30 · kontrola tolerancí: bez tolerance 2 z 2 funkčních rozměrů (předloha není připojena – kóty předlohy se nekontrolují)");
    const b = await apply(a.doc, "výkres tolerance 42 ±0,05");
    expect(b.log.at(-1)).toBe("✓ tolerance ±0,05 → 42±0,05 (přední) – rozměr 42 je nyní funkční (pomocnou kótou řetězu je (15))");
    expect((b.doc.drawings![0].options as { dimFunctional?: number[] }).dimFunctional).toEqual([50, 30, 42]);
    const c = await apply(b.doc, "výkres tolerance 50 -0,1");
    const d = await apply(c.doc, "výkres kontrola tolerancí");
    expect(d.log[0]).toBe("⚠ kontrola tolerancí: bez tolerance 1 z 3 funkčních rozměrů (předloha není připojena – kóty předlohy se nekontrolují)");
  }, 180_000);
});
