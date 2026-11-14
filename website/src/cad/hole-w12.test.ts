/**
 * 12. vlna – díra: průměr vrtáku závitové díry (tabulkový / zadaný / jádro D1 podle ISO 965-1) a ploché dno / hrot.
 * Nálezy z pole: `díra 6,647 závit M8` přepsala průměr na 6,8; slepá díra měla vždy kužel vrtáku (ploché dno jen skicou).
 * Objemy z jádra proti analytickým vzorcům, text CS / EN / DE, stav, popisy výkresu, kontrola kót, měření.
 */
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { docStatusText, featureSummary, parseAgentText } from "./agent";
import { buildDoc } from "./build";
import { threadByName } from "./defaults";
import { dimCheck, expectedDims } from "./dim-check";
import { holeCallout } from "./drawing-dims";
import { runText, smartDrawing } from "./drawing-dims-harness";
import { annLabel } from "./drawing-agent";
import { AGENT_GUIDE } from "./agent-guide";
import { withAnnotations } from "./drawing";
import { threadsOfDoc } from "./drawing-doc";
import { holeDrillD, threadChangePatch, threadMinorD } from "./hole-spec";
import { setLang } from "./i18n";
import { applyEdit } from "./agent-edit";
import { holeBottom, measureCylinders } from "./measure";
import { measureLines } from "./agent-measure";
import { emptyDoc, type CadDoc, type Feature, type Vec3 } from "./types";
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
afterEach(() => setLang("cs"));

type HoleF = Extract<Feature, { type: "hole" }>;
/** jediný prvek díry z textu (+ poznámka do protokolu) */
const holeOf = (text: string): { f: HoleF; note?: string } => {
  const p = parseAgentText(text);
  expect(p.errors, text).toEqual([]);
  const op = p.ops.find((o) => o.k === "feature" && o.feature.type === "hole") as { feature: HoleF; note?: string };
  return { f: op.feature, note: op.note };
};
const errOf = (text: string) => parseAgentText(text).errors[0]?.message ?? "";

/** kvádr 40×40×30 a slepá díra z textu uprostřed horní plochy → odebraný objem */
const BOX = "kvádr 40 40 30 v -20 -20 0";
const BOXV = 40 * 40 * 30;
async function removed(holeLine: string): Promise<{ v: number; doc: CadDoc; res: Awaited<ReturnType<typeof buildDoc>> }> {
  const p = parseAgentText(`${BOX}\n${holeLine} v 0 0 30`);
  expect(p.errors, holeLine).toEqual([]);
  const features = p.ops.map((o) => (o.k === "feature" ? o.feature : null)).filter((f): f is Feature => !!f);
  const doc: CadDoc = { ...emptyDoc("Díra"), features };
  const res = await buildDoc(doc);
  expect(res.status.every((s) => s.ok), JSON.stringify(res.status)).toBe(true);
  return { v: BOXV - res.metrics!.volume, doc, res };
}
/** analytický objem slepé díry Ø d hloubky h s kuželem hrotu `tip` (null = ploché dno) */
const blind = (d: number, h: number, tip: number | null) => {
  const rr = d / 2;
  return Math.PI * rr * rr * h + (tip === null ? 0 : (Math.PI * rr * rr * (rr / Math.tan((tip * Math.PI) / 360))) / 3);
};

describe("jádro závitu D1 podle ISO 965-1", () => {
  it("D1 = D − 1,082532·P: M8 6,647 · M12 10,106 · M6 4,917 · M18×1,5 16,376 · M10×1,25 8,647", () => {
    const D1 = (n: string) => threadMinorD(threadByName(n)!);
    expect(D1("M8")).toBe(6.647);
    expect(D1("M12")).toBe(10.106);
    expect(D1("M6")).toBe(4.917);
    expect(D1("M18×1,5")).toBe(16.376);
    expect(D1("M10x1.25")).toBe(8.647);
  });
});

describe("text: průměr vrtáku závitové díry (CS / EN / DE)", () => {
  it("bez průměru → tabulkový vrták (M8 → 6,8; jemný M18×1,5 → 16,5), bez poznámky", () => {
    const a = holeOf("díra závit M8 hloubka 20 v 0 0 30");
    expect(a.f).toMatchObject({ kind: "tapped", thread: "M8", diameter: 6.8, depth: 20 });
    expect(a.f.tapDrill).toBeUndefined();
    expect(a.note).toBeUndefined();
    expect(holeOf("díra závit M18×1,5 hloubka 20").f.diameter).toBe(16.5);
    // samotné označení bez slova „závit“
    expect(holeOf("díra M8 hloubka 20").f).toMatchObject({ kind: "tapped", thread: "M8", diameter: 6.8 });
    // 6,8 napsané ručně = tabulkový
    const b = holeOf("díra 6,8 závit M8 hloubka 20");
    expect(b.f.tapDrill).toBeUndefined();
    expect(b.note).toBeUndefined();
  });
  it("zadaný průměr má přednost: díra 6,647 závit M8 → Ø6,647 + protokol „vrták Ø6,647 zadán ručně (tabulkový 6,8)“", () => {
    const a = holeOf("díra 6,647 závit M8 hloubka 20 v 0 0 30");
    expect(a.f).toMatchObject({ kind: "tapped", thread: "M8", diameter: 6.647, tapDrill: "custom" });
    expect(a.note).toBe("vrták Ø6,647 zadán ručně (tabulkový 6,8)");
    expect(holeOf("díra závit M8 hloubka 20 vrták 6,7").f).toMatchObject({ diameter: 6.7, tapDrill: "custom" });
    expect(holeOf("díra průměr 6,9 závit M8 hloubka 20").f).toMatchObject({ diameter: 6.9, tapDrill: "custom" });
  });
  it("jmenovitý průměr jako průměr díry (díra 8 závit M8) → tabulkový vrták s poznámkou", () => {
    const a = holeOf("díra 8 závit M8 hloubka 20");
    expect(a.f.diameter).toBe(6.8);
    expect(a.f.tapDrill).toBeUndefined();
    expect(a.note).toMatch(/Ø8 je jmenovitý průměr závitu M8 – vrtá se tabulkový vrták Ø6,8/);
    // jmenovitý + jádro = jádro
    expect(holeOf("díra 8 závit M8 hloubka 20 jádro").f).toMatchObject({ diameter: 6.647, tapDrill: "minor" });
  });
  it("jádro / vrták: CS, EN, DE; jemné stoupání", () => {
    for (const t of ["díra závit M8 hloubka 20 jádro", "hole thread M8 depth 20 core", "hole thread M8 depth 20 minor", "bohrung gewinde M8 tiefe 20 kern"]) expect(holeOf(t).f, t).toMatchObject({ diameter: 6.647, tapDrill: "minor" });
    for (const t of ["díra závit M8 hloubka 20 vrták", "hole thread M8 depth 20 drill", "bohrung gewinde M8 tiefe 20 bohrer"]) {
      expect(holeOf(t).f.diameter, t).toBe(6.8);
      expect(holeOf(t).f.tapDrill, t).toBeUndefined();
    }
    expect(holeOf("hole 6.647 thread M8 depth 20").f).toMatchObject({ diameter: 6.647, tapDrill: "custom" });
    expect(holeOf("bohrung gewinde M8 tiefe 20 bohrer 6,7").f).toMatchObject({ diameter: 6.7, tapDrill: "custom" });
    expect(holeOf("díra závit M18×1,5 hloubka 20 jádro").f).toMatchObject({ thread: "M18×1,5", diameter: 16.376, tapDrill: "minor" });
    expect(holeOf("díra 16,4 závit M18x1.5 hloubka 20").f).toMatchObject({ thread: "M18×1,5", diameter: 16.4, tapDrill: "custom" });
    expect(holeOf("díra 18 závit M18×1,5 hloubka 20").f).toMatchObject({ diameter: 16.5 });
  });
  it("starší zápis se zástupným průměrem (díra 5 závit M18×1,5) → tabulkový vrták s poznámkou; „vrták 5“ = výslovně", () => {
    const a = holeOf("díra 5 závit M18×1,5 hloubka 20");
    expect(a.f.diameter).toBe(16.5);
    expect(a.f.tapDrill).toBeUndefined();
    expect(a.note).toMatch(/Ø5 je pro závit M18×1,5 příliš malý .* tabulkový vrták Ø16,5/);
    // hranice: D1 − P (M8: 6,647 − 1,25 = 5,397) – 5,5 je ještě zadaný vrták
    expect(holeOf("díra 5,5 závit M8 hloubka 20").f).toMatchObject({ diameter: 5.5, tapDrill: "custom" });
    expect(holeOf("díra závit M18×1,5 hloubka 20 vrták 5").f).toMatchObject({ diameter: 5, tapDrill: "custom" });
  });
  it("chyby: vrták větší než závit, rozpor průměru a volby, jádro bez závitu", () => {
    expect(errOf("díra 10 závit M8 hloubka 20")).toMatch(/vrták Ø10 musí být menší než závit M8/);
    expect(errOf("díra 6,5 závit M8 hloubka 20 jádro")).toMatch(/si odporují/);
    expect(errOf("díra 6,5 závit M8 hloubka 20 vrták")).toMatch(/si odporují/);
    expect(errOf("díra 6,5 závit M8 hloubka 20 vrták 6,7")).toMatch(/si odporují/);
    expect(errOf("díra závit M8 hloubka 20 jádro vrták")).toMatch(/si odporují/);
    expect(errOf("díra 10 hloubka 20 jádro")).toMatch(/jen pro závitovou díru/);
    expect(errOf("díra hloubka 20")).toMatch(/díra potřebuje průměr/);
    expect(errOf("díra 0 závit M8 hloubka 20")).toMatch(/díra potřebuje průměr/);
  });
  it("protokol v angličtině", () => {
    setLang("en");
    expect(holeOf("hole 6.647 thread M8 depth 20").note).toBe("drill Ø6.647 entered manually (table 6.8)");
  });
});

describe("text: dno slepé díry (CS / EN / DE)", () => {
  it("dno ploché / ploché dno / flat bottom / flacher Grund / hrot 180 → tipAngle 180", () => {
    for (const t of ["díra 10 hloubka 12 dno ploché", "díra 10 hloubka 12 ploché dno", "díra 10 hloubka 12 hrot 180", "hole 10 depth 12 flat bottom", "hole 10 depth 12 bottom flat", "bohrung 10 tiefe 12 flacher grund", "bohrung 10 tiefe 12 grund flach"]) expect(holeOf(t).f.tipAngle, t).toBe(180);
  });
  it("hrot N (EN tip, DE Spitze); číslo za hrotem není průměr díry", () => {
    expect(holeOf("díra 10 hloubka 12 hrot 120").f).toMatchObject({ diameter: 10, tipAngle: 120 });
    expect(holeOf("hole 10 depth 12 tip 90").f.tipAngle).toBe(90);
    expect(holeOf("bohrung 10 tiefe 12 spitze 140").f.tipAngle).toBe(140);
    expect(holeOf("díra závit M8 hrot 120 hloubka 20").f).toMatchObject({ diameter: 6.8, tipAngle: 120 });
    expect(holeOf("díra 10 hloubka 12 dno kužel").f.tipAngle).toBe(118);
  });
  it("platí i pro závitovou, zahloubenou a kuželově zahloubenou díru", () => {
    expect(holeOf("díra závit M8 hloubka 20 jádro dno ploché").f).toMatchObject({ tapDrill: "minor", tipAngle: 180 });
    expect(holeOf("díra 9 hloubka 20 zahloubení 15 9 dno ploché").f).toMatchObject({ kind: "counterbore", tipAngle: 180 });
    expect(holeOf("díra 6,6 hloubka 20 kuželové 12,4 hrot 120").f).toMatchObject({ kind: "countersink", tipAngle: 120 });
  });
  it("chyby: dno u díry skrz / k tělesu, úhel mimo rozsah, „dno“ bez druhu, dvě různá dna", () => {
    expect(errOf("díra 10 skrz dno ploché")).toMatch(/jen pro slepou díru/);
    expect(errOf("díra 10 dno ploché")).toMatch(/jen pro slepou díru/);
    expect(errOf("díra 10 k tělesu hrot 120")).toMatch(/jen pro slepou díru/);
    expect(errOf("díra 10 hloubka 12 hrot 200")).toMatch(/60 až 170/);
    expect(errOf("díra 10 hloubka 12 hrot 30")).toMatch(/60 až 170/);
    expect(errOf("díra 10 hloubka 12 dno")).toMatch(/ploché/);
    expect(errOf("díra 10 hloubka 12 dno ploché hrot 120")).toMatch(/dvakrát/);
  });
});

describe("stav a popisy výkresu", () => {
  it("stav: vrták a dno", () => {
    expect(featureSummary(holeOf("díra 6,647 závit M8 hloubka 20 v 0 0 30").f)).toBe("M8 hl. 20 (vrták Ø6,647 zadán ručně) v [0; 0; 30], osa Z");
    expect(featureSummary(holeOf("díra závit M8 hloubka 20 jádro v 0 0 30").f)).toBe("M8 hl. 20 (vrták = jádro D1 Ø6,647) v [0; 0; 30], osa Z");
    expect(featureSummary(holeOf("díra závit M8 hloubka 20 v 0 0 30").f)).toBe("M8 hl. 20 (vrták Ø6,8) v [0; 0; 30], osa Z");
    expect(featureSummary(holeOf("díra 10 hloubka 12 dno ploché v 0 0 30").f)).toBe("Ø10 hloubka 12 · dno ploché v [0; 0; 30], osa Z");
    expect(featureSummary(holeOf("díra 10 hloubka 12 hrot 120 v 0 0 30").f)).toBe("Ø10 hloubka 12 · hrot 120° v [0; 0; 30], osa Z");
    expect(featureSummary(holeOf("díra 10 hloubka 12 v 0 0 30").f)).toBe("Ø10 hloubka 12 v [0; 0; 30], osa Z");
  });
  it("popis díry: vrták jiný než tabulkový má vlastní řádek, ploché dno poznámku, hrot úhel", () => {
    const t = { kind: "tapped" as const, thread: "M8", diameter: 6.647, depth: 20, cbDiameter: 0, cbDepth: 0, tapDrill: "custom" as const };
    expect(holeCallout(t, 1)).toEqual(["M8 ↧20", "Ø6,647 ↧20"]);
    expect(holeCallout({ ...t, threadDepth: 16 }, 4)).toEqual(["4× M8 ↧16", "Ø6,647 ↧20"]);
    expect(holeCallout({ ...t, depth: 0 }, 1)).toEqual(["M8 skrz", "Ø6,647 skrz"]);
    expect(holeCallout({ ...t, tapDrill: "minor", diameter: 6.8 }, 1)).toEqual(["M8 ↧20", "Ø6,647 ↧20"]);
    expect(holeCallout({ ...t, tapDrill: undefined, diameter: 6.8 }, 1)).toEqual(["M8 ↧20"]); // tabulkový – jako dřív
    expect(holeCallout({ ...t, tipAngle: 180 }, 1)).toEqual(["M8 ↧20", "Ø6,647 ↧20 (ploché dno)"]);
    expect(holeCallout({ ...t, tapDrill: undefined, tipAngle: 180 }, 1)).toEqual(["M8 ↧20 (ploché dno)"]);
    const s = { kind: "simple" as const, diameter: 10, depth: 20, cbDiameter: 0, cbDepth: 0 };
    expect(holeCallout({ ...s, tipAngle: 180 }, 2)).toEqual(["2× Ø10 ↧20 (ploché dno)"]);
    expect(holeCallout({ ...s, tipAngle: 120 }, 1)).toEqual(["Ø10 ↧20 (120°)"]);
    expect(holeCallout({ ...s, tipAngle: 180, kind: "counterbore", cbDiameter: 15, cbDepth: 9 }, 1)).toEqual(["Ø10 ↧20 (ploché dno)", "⌴ Ø15 ↧9"]);
    // ukončení k ploše má dno ploché vždy – úhel hrotu se nepíše
    expect(holeCallout({ ...s, tipAngle: 120, end: { kind: "toVertex", ref: { kind: "point", p: [0, 0, 0] } } as never }, 1, 12)).toEqual(["Ø10 ↧12"]);
    setLang("en");
    expect(holeCallout({ ...s, tipAngle: 180 }, 1)).toEqual(["Ø10 ↧20 (flat bottom)"]);
  });
  it("kontrola kót a označení závitu kružnice: skutečný vrták", () => {
    const doc: CadDoc = { ...emptyDoc("K"), features: [{ id: "b", name: "Kvádr", type: "box", size: [40, 40, 30], position: [-20, -20, 0], centered: false, mode: "new" }, { ...holeOf("díra 6,647 závit M8 hloubka 20 v 0 0 30").f, id: "h" }] };
    const exp = expectedDims(doc, null);
    expect(exp.find((e) => e.kind === "dia")).toMatchObject({ value: 6.647, label: "Ø6,647 (vrták závitu M8)" });
    expect(threadsOfDoc(doc)).toEqual([{ r: 3.3235, label: "M8 hl. 20" }]);
    const present = dimCheck(doc, null, [{ s: "M8 ↧20", layer: "dim" }, { s: "Ø6,647 ↧20", layer: "dim" }]);
    expect(present.filter((x) => !x.present && x.source !== "Kvádr")).toEqual([]);
    // starý dokument (bez tapDrill): žádná nová očekávaná kóta, vrták z tabulky i při jiném uloženém průměru
    const old: CadDoc = { ...doc, features: [doc.features[0], { ...(doc.features[1] as HoleF), tapDrill: undefined, diameter: 6 }] };
    expect(expectedDims(old, null).some((e) => e.kind === "dia")).toBe(false);
    expect(holeDrillD(old.features[1] as HoleF)).toBe(6.8);
  });
});

describe("jádro: objemy proti analytickým vzorcům", () => {
  it("Ø10 hl. 20: hrot 118° / ploché dno / hrot 90°; průchozí díra se dnem nemění", { timeout: 120_000 }, async () => {
    expect((await removed("díra 10 hloubka 20")).v).toBeCloseTo(blind(10, 20, 118), 3);
    expect((await removed("díra 10 hloubka 20 dno ploché")).v).toBeCloseTo(blind(10, 20, null), 3);
    expect((await removed("díra 10 hloubka 20 hrot 90")).v).toBeCloseTo(blind(10, 20, 90), 3);
    // rozdíl hrot − ploché = objem kužele π r³ / (3 tan 59°)
    const cone = blind(10, 20, 118) - blind(10, 20, null);
    expect(cone).toBeCloseTo((Math.PI * 125) / (3 * Math.tan((59 * Math.PI) / 180)), 6);
  });
  it("závit M8: tabulkový 6,8 / zadaný 6,647 / jádro D1; jemné M18×1,5 tabulkový i jádro; ploché dno u závitové díry", { timeout: 120_000 }, async () => {
    expect((await removed("díra závit M8 hloubka 20")).v).toBeCloseTo(blind(6.8, 20, 118), 3);
    expect((await removed("díra 6,647 závit M8 hloubka 20")).v).toBeCloseTo(blind(6.647, 20, 118), 3);
    expect((await removed("díra závit M8 hloubka 20 jádro")).v).toBeCloseTo(blind(6.647, 20, 118), 3);
    expect((await removed("díra 8 závit M8 hloubka 20")).v).toBeCloseTo(blind(6.8, 20, 118), 3);
    expect((await removed("díra závit M18×1,5 hloubka 20")).v).toBeCloseTo(blind(16.5, 20, 118), 3);
    expect((await removed("díra závit M18×1,5 hloubka 20 jádro")).v).toBeCloseTo(blind(16.376, 20, 118), 3);
    expect((await removed("díra závit M8 hloubka 20 jádro dno ploché")).v).toBeCloseTo(blind(6.647, 20, null), 3);
  });
  it("zahloubená slepá díra s plochým dnem; starý dokument (bez tapDrill) staví jako dřív", { timeout: 120_000 }, async () => {
    expect((await removed("díra 9 hloubka 20 zahloubení 15 9 dno ploché")).v).toBeCloseTo(Math.PI * 7.5 * 7.5 * 9 + Math.PI * 4.5 * 4.5 * 11, 3);
    expect((await removed("díra 9 hloubka 20 zahloubení 15 9")).v).toBeCloseTo(Math.PI * 7.5 * 7.5 * 9 + blind(9, 11, 118), 3);
    // průchozí díra: tipAngle se neuplatní
    const thr: Feature = { id: "h", name: "Díra", type: "hole", position: [0, 0, 30], axis: "Z", flip: false, diameter: 10, depth: 0, cbDiameter: 0, cbDepth: 0, tipAngle: 180 };
    const box: Feature = { id: "b", name: "Kvádr", type: "box", size: [40, 40, 30], position: [-20, -20, 0], centered: false, mode: "new" };
    const r1 = await buildDoc({ ...emptyDoc("T"), features: [box, thr] });
    expect(BOXV - r1.metrics!.volume).toBeCloseTo(Math.PI * 25 * 30, 3);
    // uložený dokument starší verze: závitová díra s jiným uloženým průměrem vrtá tabulkový vrták
    const old: Feature = { id: "o", name: "Díra M6", type: "hole", kind: "tapped", thread: "M6", position: [0, 0, 30], axis: "Z", flip: false, diameter: 6, depth: 14, cbDiameter: 0, cbDepth: 0 };
    const r2 = await buildDoc({ ...emptyDoc("T"), features: [box, old] });
    expect(BOXV - r2.metrics!.volume).toBeCloseTo(blind(5, 14, 118), 3);
    // vrták větší než závit (ruční JSON) = chyba prvku
    const bad = await buildDoc({ ...emptyDoc("T"), features: [box, { ...old, tapDrill: "custom", diameter: 6.5 } as Feature] });
    expect(bad.status.find((s) => s.id === "o")?.error).toMatch(/musí být menší než závit M6/);
  });
});

describe("měřit díry: tvar dna a hloubka", () => {
  it("ploché dno vs. hrot 118° (úhel a hloubka ke špičce)", { timeout: 120_000 }, async () => {
    const p = parseAgentText(`${BOX}\ndíra 10 hloubka 15 dno ploché v -10 0 30\ndíra 6,647 závit M8 hloubka 20 v 10 0 30`);
    expect(p.errors).toEqual([]);
    const features = p.ops.map((o) => (o.k === "feature" ? o.feature : null)).filter((f): f is Feature => !!f);
    const res = await buildDoc({ ...emptyDoc("M"), features });
    const holes = measureCylinders(res.body!, true);
    const flat = holes.find((h) => Math.abs(h.diameter - 10) < 1e-6)!;
    const tap = holes.find((h) => Math.abs(h.diameter - 6.647) < 1e-6)!;
    expect(flat).toMatchObject({ through: false, bottom: "flat" });
    expect(flat.depth).toBeCloseTo(15, 6);
    expect(tap).toMatchObject({ through: false, bottom: "cone" });
    expect(tap.depth).toBeCloseTo(20, 6);
    expect(tap.tipAngle).toBeCloseTo(118, 3);
    expect(tap.tipDepth).toBeCloseTo(20 + 3.3235 / Math.tan((59 * Math.PI) / 180), 3);
    // příklad z návodu: sedlo pružiny s průchozí dírou Ø6,6 uprostřed dna je pořád ploché dno; zahloubení má dno ploché
    const g = parseAgentText(`${BOX}\ndíra 12,5 hloubka 15 dno ploché v -10 0 30\ndíra 6,6 skrz v -10 0 15\ndíra 9 skrz v 10 0 30 zahloubení 15 9`);
    expect(g.errors).toEqual([]);
    const g2 = await buildDoc({ ...emptyDoc("M2"), features: g.ops.map((o) => (o.k === "feature" ? o.feature : null)).filter((f): f is Feature => !!f) });
    const h2 = measureCylinders(g2.body!, true);
    expect(h2.find((h) => Math.abs(h.diameter - 12.5) < 1e-6)).toMatchObject({ through: false, bottom: "flat", depth: 15 });
    expect(h2.find((h) => Math.abs(h.diameter - 15) < 1e-6)).toMatchObject({ through: false, bottom: "flat", depth: 9 });
    expect(h2.find((h) => Math.abs(h.diameter - 6.6) < 1e-6)?.bottom).toBeUndefined();
    const lines = measureLines({ kind: "holes", label: "díl", holes }).join("\n");
    expect(lines).toMatch(/Ø 10 mm: .*slepá, hloubka 15 mm · směr vrtání −Z · dno ploché/);
    expect(lines).toMatch(/Ø 6,647 mm: .*slepá, hloubka 20 mm · směr vrtání −Z · hrot 118° \(ke špičce 21,997 mm\)/);
  });
});

describe("výkres: Chytré kóty najdou díru s vrtákem z výkresu", () => {
  it("M8 s vrtákem 6,647 a sedlo s plochým dnem – popisy, kontrola kót bez chybějících", { timeout: 180_000 }, async () => {
    const { doc } = await runText("kvádr 80 50 30\ndíra 12,5 hloubka 15 dno ploché v 20 25\ndíra 6,647 závit M8 hloubka 20 hloubka-závitu 16 v 60 25");
    const d = await smartDrawing(doc, { sheet: "A3", views: { front: true, top: true, left: false, right: false, back: false, bottom: false, iso: false } });
    const L = d.smart.annotations.map((a) => annLabel(d.drawing.views, a));
    expect(L).toContain("Ø12,5 ↧15 (ploché dno)");
    expect(L).toContain("M8 ↧16 / Ø6,647 ↧20");
    expect(d.smart.report.skipped.filter((s) => /nenalezena/.test(s))).toEqual([]);
    const out = withAnnotations(d.drawing, d.smart.annotations);
    expect(dimCheck(d.doc, d.bbox, out.texts).filter((x) => !x.present && /vrták|Ø12,5|M8/.test(x.label))).toEqual([]);
    expect(docStatusText(doc, await buildDoc(doc))).toMatch(/M8 hl\. 20 \(vrták Ø6,647 zadán ručně\)/);
  });
});

describe("návod pro AI: příklad sedla pružiny platí", () => {
  it("model z návodu: objem, měřit díry, stav a popisy výkresu jako v textu návodu", { timeout: 180_000 }, async () => {
    const i = AGENT_GUIDE.indexOf("### Příklad – sedlo pružiny");
    expect(i).toBeGreaterThan(0);
    const a = AGENT_GUIDE.indexOf("```", i) + 3;
    const block = AGENT_GUIDE.slice(a, AGENT_GUIDE.indexOf("```", a)).trim();
    const model = block.split("\n").filter((l) => !/^(měřit|stav)/.test(l.trim())).join("\n");
    const { doc } = await runText(model);
    const res = await buildDoc(doc);
    expect(res.status.every((x) => x.ok)).toBe(true);
    // kostka 80×50×30 − sedlo Ø12,5×15 ploché − Ø6,6 od dna sedla skrz (15) − závit: vrták 6,647 hl. 20 s hrotem 118°
    const want = 80 * 50 * 30 - blind(12.5, 15, null) - Math.PI * 3.3 * 3.3 * 15 - blind(6.647, 20, 118);
    expect(res.metrics!.volume).toBeCloseTo(want, 2);
    const lines = measureLines({ kind: "holes", label: "díl", holes: measureCylinders(res.body!, true) }).join("\n");
    expect(lines).toMatch(/Ø 12,5 mm: .*slepá, hloubka 15 mm · směr vrtání −Z · dno ploché/);
    expect(lines).toMatch(/Ø 6,647 mm: .*hrot 118° \(ke špičce 21,997 mm\)/);
    expect(docStatusText(doc, res)).toMatch(/M8 hl\. 20 \(vrták Ø6,647 zadán ručně\)/);
    const d = await smartDrawing(doc, { sheet: "A3", views: { front: true, top: true, left: false, right: false, back: false, bottom: false, iso: false } });
    const L = d.smart.annotations.map((x) => annLabel(d.drawing.views, x));
    expect(L).toContain("Ø12,5 ↧15 (ploché dno)");
    expect(L).toContain("M8 ↧16 / Ø6,647 ↧20");
  });
});

describe("upravit: vrták a dno existující díry", () => {
  it("upravit \"Díra 1\" tapDrill=minor / tipAngle=180 – klíč, který díra zatím nemá", async () => {
    const doc: CadDoc = { ...emptyDoc("E"), features: [{ ...holeOf("díra závit M8 hloubka 20 v 0 0 30").f, id: "h1", name: "Díra 1" }] };
    const p = parseAgentText('upravit "Díra 1" tapDrill=minor tipAngle=180');
    expect(p.errors).toEqual([]);
    const op = p.ops[0];
    if (op.k !== "edit") throw new Error(op.k);
    const r = await applyEdit(doc, op.cmd, {});
    const h = r.doc.features[0] as HoleF;
    expect(h.tapDrill).toBe("minor");
    expect(h.tipAngle).toBe(180);
    expect(holeDrillD(h)).toBe(6.647);
    expect(featureSummary(h)).toBe("M8 hl. 20 (vrták = jádro D1 Ø6,647) · dno ploché v [0; 0; 30], osa Z");
  });
});

/* ───────────── 2. kolo: nálezy kontroly (každý nález = regresní test) ───────────── */

/** dokument z textu (prvky s id f0, f1 …) */
const docOf = (text: string): CadDoc => {
  const p = parseAgentText(text);
  expect(p.errors, text).toEqual([]);
  return { ...emptyDoc("R"), features: p.ops.flatMap((o) => (o.k === "feature" ? [{ ...o.feature }] : [])) };
};
/** upravit nad dokumentem z textu → nový dokument a protokol (chyba = výjimka) */
async function editText(base: string, cmd: string) {
  const doc = docOf(base);
  const e = parseAgentText(cmd);
  expect(e.errors, cmd).toEqual([]);
  const op = e.ops[0];
  if (op.k !== "edit") throw new Error(op.k);
  const r = await applyEdit(doc, op.cmd, {});
  return { doc: r.doc, log: r.log.join("\n"), hole: r.doc.features.find((f) => f.type === "hole") as HoleF };
}
const editErr = (base: string, cmd: string) => editText(base, cmd).then(() => "", (e: Error) => e.message);
/** díry tělesa z textu (měřit díry) */
async function holesOf(text: string) {
  const res = await buildDoc(docOf(text));
  expect(res.status.every((s) => s.ok), JSON.stringify(res.status)).toBe(true);
  return measureCylinders(res.body!, true);
}

describe("2. kolo: název díry se nečte jako volba", () => {
  it("název M8 / \"M8\" / Vrták / Jádro / \"Dno\" zůstanou názvem (jako kvádr … název M8)", () => {
    const pick = (f: HoleF) => ({ name: f.name, diameter: f.diameter, kind: f.kind, thread: f.thread, tapDrill: f.tapDrill, tipAngle: f.tipAngle });
    const plain = { kind: undefined, thread: undefined, tapDrill: undefined, tipAngle: undefined };
    expect(pick(holeOf("díra 6,8 hloubka 20 v 20 20 30 název M8").f)).toEqual({ ...plain, name: "M8", diameter: 6.8 });
    expect(pick(holeOf('díra 9 skrz v 20 20 30 název "M8"').f)).toEqual({ ...plain, name: "M8", diameter: 9 });
    expect(pick(holeOf("díra 10 hloubka 12 v 20 20 30 název Vrták").f)).toEqual({ ...plain, name: "Vrták", diameter: 10 });
    expect(pick(holeOf("díra 10 hloubka 12 v 20 20 30 název Jádro").f)).toEqual({ ...plain, name: "Jádro", diameter: 10 });
    expect(pick(holeOf('díra 10 hloubka 12 v 20 20 30 název "Dno"').f)).toEqual({ ...plain, name: "Dno", diameter: 10 });
    expect(pick(holeOf("díra 10 hloubka 12 v 20 20 30 název Dno ploché").f)).toEqual({ ...plain, name: "Dno ploché", diameter: 10 });
    // volby před názvem platí dál; název končí u další volby jako u ostatních příkazů
    expect(holeOf("díra závit M8 hloubka 20 jádro dno ploché název Sedlo v 20 20 30").f).toMatchObject({ name: "Sedlo", tapDrill: "minor", tipAngle: 180 });
  });
});

describe("2. kolo: měřit díry – dno i s tenkým materiálem pod dnem a strmý hrot", () => {
  it("hrot u díry, pod kterou zbývá méně než průměr díry (závitová díra v desce)", { timeout: 180_000 }, async () => {
    const a = (await holesOf("kvádr 60 40 25\ndíra závit M8 hloubka 20 v 30 20 25"))[0];
    expect(a).toMatchObject({ through: false, bottom: "cone" });
    expect(a.tipAngle).toBeCloseTo(118, 3);
    expect(a.tipDepth).toBeCloseTo(20 + 3.4 / Math.tan((59 * Math.PI) / 180), 3);
    for (const [line, tip] of [["díra 10 hloubka 21", 118], ["díra 10 hloubka 24", 118], ["díra 10 hloubka 21 hrot 90", 90], ["díra 10 hloubka 20 hrot 120", 120], ["díra závit M12 hloubka 20 jádro", 118], ["díra závit M18×1,5 hloubka 25", 118]] as const) {
      const h = (await holesOf(`kvádr 60 40 30\n${line} v 30 20 30`))[0];
      expect(h, line).toMatchObject({ through: false, bottom: "cone" });
      expect(h.tipAngle, line).toBeCloseTo(tip, 2);
    }
    // střižná deska: 4 závitové díry polem – u všech hrot
    const { doc: plateDoc } = await runText("kvádr 120 80 20\ndíra závit M8 hloubka 16 hloubka-závitu 12 jádro v 15 15\npole 2 rozteč 90 směr X 2 rozteč 50 směr Y");
    const plateRes = await buildDoc(plateDoc);
    expect(plateRes.status.every((x) => x.ok && !x.warning), JSON.stringify(plateRes.status)).toBe(true);
    const plate = measureCylinders(plateRes.body!, true);
    expect(plate.length).toBe(4);
    for (const h of plate) {
      expect(h).toMatchObject({ through: false, bottom: "cone" });
      expect(h.tipAngle).toBeCloseTo(118, 2);
    }
    const lines = measureLines({ kind: "holes", label: "díl", holes: plate }).join("\n");
    expect(lines.match(/hrot 118° \(ke špičce/g)?.length).toBe(4);
  });
  it("strmý hrot 60–67° je slepá díra s hrotem (ne skrz); sedlo se souosou dírou Ø10 v Ø12,5 má dno ploché", { timeout: 180_000 }, async () => {
    for (const tip of [60, 65, 70]) {
      const h = (await holesOf(`kvádr 60 40 30\ndíra 10 hloubka 12 hrot ${tip} v 30 20 30`))[0];
      expect(h, `hrot ${tip}`).toMatchObject({ through: false, depth: 12, bottom: "cone" });
      expect(h.tipAngle).toBeCloseTo(tip, 2);
    }
    const seat = await holesOf("kvádr 60 40 30\ndíra 12,5 hloubka 15 dno ploché v 20 20 30\ndíra 10 skrz v 20 20 15");
    expect(seat.find((h) => Math.abs(h.diameter - 12.5) < 1e-6)).toMatchObject({ through: false, depth: 15, bottom: "flat" });
    expect(seat.find((h) => Math.abs(h.diameter - 10) < 1e-6)).toMatchObject({ through: true });
    // kužel propíchnutý souosou dírou: úhel bez hloubky ke špičce
    const pierced = await holesOf("kvádr 60 40 30\ndíra 12 hloubka 15 v 20 20 30\ndíra 6 skrz v 20 20 15");
    const big = pierced.find((h) => Math.abs(h.diameter - 12) < 1e-6)!;
    expect(big).toMatchObject({ through: false, bottom: "cone" });
    expect(big.tipDepth).toBeUndefined();
    expect(big.tipAngle).toBeCloseTo(118, 1);
    expect(measureLines({ kind: "holes", label: "díl", holes: [big] }).join("\n")).toMatch(/hrot 118°(?! \()/);
  });
});

describe("2. kolo: upravit a prvek hole – stejná pravidla vrtáku a dna jako text", () => {
  const M8 = "kvádr 60 40 30\ndíra závit M8 hloubka 20 v 30 20 30";
  it("upravit diameter=6,647 u závitové díry = zadaný vrták (geometrie i protokol); jmenovitý / velký průměr", { timeout: 120_000 }, async () => {
    const e = await editText(M8, 'upravit "Díra 1" diameter=6,647');
    expect(e.hole).toMatchObject({ diameter: 6.647, tapDrill: "custom" });
    expect(e.log).toMatch(/vrták Ø6,647 zadán ručně \(tabulkový 6,8\)/);
    const v = await buildDoc(e.doc);
    expect(60 * 40 * 30 - v.metrics!.volume).toBeCloseTo(blind(6.647, 20, 118), 3);
    const nom = await editText(M8, 'upravit "Díra 1" diameter=8');
    expect([nom.hole.diameter, nom.hole.tapDrill]).toEqual([6.8, undefined]);
    expect(nom.log).toMatch(/Ø8 je jmenovitý průměr závitu M8 – vrtá se tabulkový vrták Ø6,8/);
    expect(await editErr(M8, 'upravit "Díra 1" diameter=9')).toMatch(/vrták Ø9 musí být menší než závit M8/);
    // průměr s volbou najednou: jako text „… vrták 6,647“ / rozpor „… vrták“ + jiný průměr
    expect((await editText(M8, 'upravit "Díra 1" tapDrill=custom diameter=6,647')).hole).toMatchObject({ diameter: 6.647, tapDrill: "custom" });
    expect(await editErr(M8, 'upravit "Díra 1" tapDrill=table diameter=7')).toMatch(/si odporují/);
    // díra bez závitu: průměr se mění jako dřív
    const simple = (await editText("kvádr 60 40 30\ndíra 10 hloubka 12 v 30 20 30", 'upravit "Díra 1" diameter=12')).hole;
    expect([simple.diameter, simple.tapDrill, simple.kind]).toEqual([12, undefined, undefined]);
  });
  it("prvek hole … kind=tapped thread=M8 diameter=6,647 = zadaný vrták; bez diameter tabulkový", () => {
    const p = parseAgentText("kvádr 60 40 30\nprvek hole position=30;20;30 axis=Z diameter=6,647 depth=20 kind=tapped thread=M8 cbDiameter=0 cbDepth=0");
    expect(p.errors).toEqual([]);
    const op = p.ops[1] as { feature: HoleF; note?: string };
    expect(op.feature).toMatchObject({ diameter: 6.647, tapDrill: "custom" });
    expect(op.note).toBe("vrták Ø6,647 zadán ručně (tabulkový 6,8)");
    const q = parseAgentText("prvek hole position=30;20;30 depth=20 kind=tapped thread=M8");
    expect((q.ops[0] as { feature: HoleF }).feature).toMatchObject({ diameter: 6.8 });
    expect(parseAgentText("prvek hole position=0;0;30 depth=20 kind=tapped thread=M8 tapDrill=jádro").ops[0]).toMatchObject({ feature: { tapDrill: "minor", diameter: 6.647 } });
    expect(parseAgentText("prvek hole position=0;0;30 diameter=10 depth=12 tipAngle=175").errors[0]?.message).toMatch(/60 až 170/);
  });
  it("upravit tapDrill: jádro / tabulkový / vlastní; neplatná hodnota = chyba", async () => {
    const a = await editText(M8, 'upravit "Díra 1" tapDrill=jádro');
    expect(a.hole).toMatchObject({ tapDrill: "minor", diameter: 6.647 });
    expect(holeDrillD(a.hole)).toBe(6.647);
    const tab = (await editText("kvádr 60 40 30\ndíra závit M8 hloubka 20 jádro v 30 20 30", 'upravit "Díra 1" tapDrill=tabulkový')).hole;
    expect([tab.tapDrill, tab.diameter]).toEqual([undefined, 6.8]);
    expect(await editErr(M8, 'upravit "Díra 1" tapDrill=foo')).toMatch(/tapDrill „foo“ – zadejte table/);
  });
  it("upravit tipAngle mimo 60–170 = chyba; uložený (JSON) úhel ukáže stav i výkres jako jádro a stavba ohlásí ⚠", { timeout: 120_000 }, async () => {
    const base = "kvádr 60 40 30\ndíra 10 hloubka 12 v 45 20 30";
    expect(await editErr(base, 'upravit "Díra 1" tipAngle=175')).toMatch(/úhel hrotu 175° – zadejte 60 až 170°/);
    expect(await editErr(base, 'upravit "Díra 1" tipAngle=10')).toMatch(/60 až 170/);
    expect((await editText(base, 'upravit "Díra 1" tipAngle=ploché')).hole.tipAngle).toBe(180);
    const doc = docOf(base);
    const h = doc.features[1] as HoleF;
    h.tipAngle = 175;
    expect(featureSummary(h)).toBe("Ø10 hloubka 12 · hrot 170° v [45; 20; 30], osa Z");
    expect(holeCallout(h, 1)).toEqual(["Ø10 ↧12 (170°)"]);
    const res = await buildDoc(doc);
    expect(60 * 40 * 30 - res.metrics!.volume).toBeCloseTo(blind(10, 12, 170), 3);
    expect(res.status[1].warning).toMatch(/Úhel hrotu 175° je mimo 60–170° – použito 170°/);
    h.tipAngle = 10;
    expect(featureSummary(h)).toMatch(/hrot 60°/);
  });
  it("změna závitu u vlastního vrtáku: hodí-li se, zůstane; jinak tabulkový s poznámkou (upravit i formulář)", async () => {
    const C = "kvádr 60 40 30\ndíra 6,647 závit M8 hloubka 20 v 15 20 30";
    const a = await editText(C, 'upravit "Díra 1" thread=M5');
    expect([a.hole.thread, a.hole.diameter, a.hole.tapDrill]).toEqual(["M5", 4.2, undefined]);
    expect(a.log).toMatch(/vlastní vrták Ø6,647 se k závitu M5 nehodí .* tabulkový vrták Ø4,2/);
    const m10 = (await editText(C, 'upravit "Díra 1" thread=M10')).hole;
    expect([m10.diameter, m10.tapDrill]).toEqual([8.5, undefined]);
    expect((await editText(C, 'upravit "Díra 1" thread=M8x1')).hole).toMatchObject({ diameter: 6.647, tapDrill: "custom" });
    // formulář (threadPatch = threadChangePatch) – stejně jako text „díra 6,647 závit M10“
    const f = holeOf("díra 6,647 závit M8 hloubka 20 v 30 20 30").f;
    expect(threadChangePatch(f, "M10")).toEqual({ thread: "M10", tapDrill: undefined, diameter: 8.5 });
    expect(threadChangePatch(f, "M8x1")).toEqual({ thread: "M8x1" });
    const t10 = holeOf("díra 6,647 závit M10 hloubka 20").f;
    expect([t10.diameter, t10.tapDrill]).toEqual([8.5, undefined]);
    expect(threadChangePatch(holeOf("díra závit M8 hloubka 20 jádro").f, "M12")).toEqual({ thread: "M12", diameter: 10.106 });
  });
  it("chyba stavby píše průměr s desetinnou čárkou; vrták = jmenovitý průměr je chyba řádku", async () => {
    const box: Feature = { id: "b", name: "Kvádr", type: "box", size: [60, 40, 30], position: [0, 0, 0], centered: false, mode: "new" };
    const bad: Feature = { id: "h", name: "Díra 1", type: "hole", kind: "tapped", thread: "M5", tapDrill: "custom", position: [15, 20, 30], axis: "Z", flip: false, diameter: 6.647, depth: 20, cbDiameter: 0, cbDepth: 0 };
    const res = await buildDoc({ ...emptyDoc("E"), features: [box, bad] });
    expect(res.status[1].error).toBe("Vrták závitové díry Ø6,647 musí být menší než závit M5 (Ø5).");
    expect(errOf("kvádr 60 40 30\ndíra závit M8 hloubka 20 vrták 8 v 15 20")).toMatch(/vrták Ø8 musí být menší než závit M8 \(Ø8\)/);
    expect(errOf("díra 8,2 závit M8 hloubka 20")).toMatch(/musí být menší než závit M8/);
  });
  it("JSON: závitová díra s průměrem vrtáku bez tapDrill custom – vrtá tabulkový, ale stavba to ohlásí", async () => {
    const box: Feature = { id: "b", name: "Kvádr", type: "box", size: [60, 40, 30], position: [0, 0, 0], centered: false, mode: "new" };
    const j: Feature = { id: "h", name: "Díra 1", type: "hole", kind: "tapped", thread: "M8", position: [15, 20, 30], axis: "Z", flip: false, diameter: 6.647, depth: 20, cbDiameter: 0, cbDepth: 0 };
    const res = await buildDoc({ ...emptyDoc("J"), features: [box, j] });
    expect(60 * 40 * 30 - res.metrics!.volume).toBeCloseTo(blind(6.8, 20, 118), 3);
    expect(res.status[1]).toMatchObject({ ok: true });
    expect(res.status[1].warning).toMatch(/Průměr Ø6,647 se u závitové díry M8 nepoužije – vrtá se tabulkový vrták Ø6,8/);
    // tabulkový / jmenovitý uložený průměr (text, formulář, staré dokumenty) – bez hlášky
    for (const d of [6.8, 8, 12]) expect((await buildDoc({ ...emptyDoc("J"), features: [box, { ...j, diameter: d } as Feature] })).status[1].warning, String(d)).toBeUndefined();
  });
  it("prvek hole bez polohy = chyba řádku (ne výjimka)", () => {
    expect(parseAgentText("prvek hole diameter=8").errors[0]?.message).toMatch(/chybí poloha – position=x;y;z/);
    expect(parseAgentText("prvek hole diameter=8 depth=10 position=10;10;30").errors).toEqual([]);
  });
});

describe("2. kolo: blízké zápisy dna a vrtáku nejsou tiše přehlédnuté", () => {
  it("ploché / s plochým dnem / dno=ploché / flat / bez hrotu / ohne Spitze → ploché dno", () => {
    for (const t of ["díra 10 hloubka 12 ploché", "díra 10 hloubka 12 s plochým dnem", "díra 10 hloubka 12 dno=ploché", "hole 10 depth 12 flat", "díra 10 hloubka 12 bez hrotu", "hole 10 depth 12 without tip", "bohrung 10 tiefe 12 ohne Spitze", "bohrung 10 tiefe 12 flach"]) expect(holeOf(`${t} v 15 20 30`).f.tipAngle, t).toBe(180);
  });
  it("dno kužel N; dno kužel + hrot N v libovolném pořadí; vrták=6,7 / hrot=120", () => {
    expect(holeOf("díra 10 hloubka 12 dno kužel 120 v 15 20 30").f.tipAngle).toBe(120);
    expect(holeOf("díra 10 hloubka 12 dno kužel hrot 120 v 15 20 30").f.tipAngle).toBe(120);
    expect(holeOf("díra 10 hloubka 12 hrot 120 dno kužel v 15 20 30").f.tipAngle).toBe(120);
    expect(holeOf("díra 10 hloubka 12 hrot=90 v 15 20 30").f.tipAngle).toBe(90);
    expect(holeOf("díra závit M8 hloubka 20 vrták=6,7 v 15 20 30").f).toMatchObject({ diameter: 6.7, tapDrill: "custom" });
    expect(errOf("díra 10 hloubka 12 dno ploché dno kužel")).toMatch(/dvakrát/);
    expect(errOf("díra 10 hloubka 12 dno kužel 200")).toMatch(/60 až 170/);
  });
  it("slovo podobné volbě, kterému CAD nerozumí = chyba řádku", () => {
    for (const t of ["díra 10 hloubka 12 kužel", "díra 10 hloubka 12 špičkou 120", "díra závit M8 hloubka 20 jádrem", "díra závit M8 hloubka 20 vrtákem 6,7", "bohrung 10 tiefe 12 kegel"]) expect(errOf(`${t} v 15 20 30`), t).toMatch(/nerozumím slovu/);
    // kuželové zahloubení (kuželové D2) zůstává volbou díry
    expect(holeOf("díra 6,6 hloubka 20 kuželové 12,4 v 15 20 30").f.kind).toBe("countersink");
  });
});

describe("2. kolo: návod pro AI popisuje report.holes[] s dnem", () => {
  it("bottom, tipAngle, tipDepth v odstavci JS API", () => {
    expect(/report\.holes\[\][^\n]*bottom/.test(AGENT_GUIDE)).toBe(true);
    expect(AGENT_GUIDE).toMatch(/tipAngle[^\n]*tipDepth/);
  });
});

describe("2. kolo: tvar dna z bodů uvnitř / vně (holeBottom, analytické tvary)", () => {
  // díra Ø10 (r 5) končí v z = 0, vrtá se ve směru −Z; materiál = tvar pod koncem díry, deska do z = −T
  const r = 5;
  const solid = (T: number, voidAt: (rho: number, s: number) => boolean) => (p: Vec3) => {
    const s = -p[2];
    if (s < 0 || s > T) return false;
    return !voidAt(Math.hypot(p[0], p[1]), s);
  };
  const run = (t: (p: Vec3) => boolean) => holeBottom(t, [0, 0, 0], [0, 0, -1], [1, 0, 0], r);
  const cone = (tip: number) => (rho: number, s: number) => rho < r - s * Math.tan((tip * Math.PI) / 360);
  it("kužel 60–170° i s tenkým materiálem pod špičkou; propíchnutý kužel jen úhel", () => {
    for (const tip of [60, 90, 118, 140, 170]) {
      const h = r / Math.tan((tip * Math.PI) / 360);
      for (const floor of [0.05, 2, 20]) {
        const b = run(solid(h + floor, cone(tip)));
        expect(b.bottom, `${tip}/${floor}`).toBe("cone");
        expect(b.tipAngle!, `${tip}/${floor}`).toBeCloseTo(tip, 2);
        expect(b.tipDepth!, `${tip}/${floor}`).toBeCloseTo(h, 4);
      }
      const p = run(solid(30, (rho, s) => cone(tip)(rho, s) || rho < 1.5));
      expect(p.bottom, `propíchnutý ${tip}`).toBe("cone");
      expect(p.tipAngle!).toBeCloseTo(tip, 1);
      expect(p.tipDepth).toBeUndefined();
    }
  });
  it("ploché dno, i se souosou dírou do 0,96 r; kulové dno není ploché ani kužel", () => {
    expect(run(solid(10, () => false))).toEqual({ bottom: "flat" });
    for (const ri of [1, 3, 4, 4.5, 4.8]) expect(run(solid(10, (rho) => rho < ri)), `ri ${ri}`).toEqual({ bottom: "flat" });
    expect(run(solid(10, (rho, s) => rho * rho + s * s < r * r))).toEqual({});
  });
});
