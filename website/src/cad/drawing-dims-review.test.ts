/**
 * Chytré kóty – regresní testy nálezů nezávislé kontroly (beta): kóty hlavního dílu nepatří na pohled jiného modelu,
 * úpravy kót (tolerance) se po změně modelu drží významu kóty, poloha příčné díry rotačního dílu od čela, tolerance pomocné
 * kóty, průměr přetékající na druhou stranu, rada „zapněte pohled …“ při otočeném hlavním pohledu, vrtání v polovičním řezu,
 * celkový rozměr v dalším pohledu, křížení odkazů popisů.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "./build";
import { annToSheet, type DrawingOptions, type ModelView, type PlacedView } from "./drawing";
import { drawingDoc } from "./drawing-doc";
import { makeSmartDrawing } from "./drawing-dims";
import { computeDrawing, runText, smartDrawing } from "./drawing-dims-harness";
import { DimLayout, segsCross } from "./drawing-dims-layout";
import { annLabel, drawingStatus, mergeSmart, splitSuffix, type DrawingCompute } from "./drawing-agent";
import { drawingModelShapes } from "./drawing-models";
import { AGENT_GUIDE } from "./agent-guide";
import type { CadDoc, DrawingAnnotation, Vec2 } from "./types";
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

function guideExample(title: string): string {
  const i = AGENT_GUIDE.indexOf(title);
  expect(i, title).toBeGreaterThan(0);
  const a = AGENT_GUIDE.indexOf("```", i) + 3;
  return AGENT_GUIDE.slice(a, AGENT_GUIDE.indexOf("```", a)).trim();
}
const modelOnly = (text: string) => text.split("\n").filter((l) => !/^(výkres|kótovat)/.test(l)).join("\n");
const VIEWS = (k: string[]) => ({ front: k.includes("front"), top: k.includes("top"), left: k.includes("left"), right: k.includes("right"), back: false, bottom: k.includes("bottom"), iso: true });
type Dim = Extract<DrawingAnnotation, { type: "dim" }>;
const labelsOf = (views: PlacedView[], anns: DrawingAnnotation[]) => anns.filter((a) => a.type === "dim" || a.type === "callout").map((a) => annLabel(views, a));
/** řádek stavu výkresu s kótami jednoho pohledu */
const statusLine = (st: string, view: string) => st.split("\n").find((l) => l.startsWith(`  ${view}: `)) ?? "";

describe("další model na listu: Chytré kóty jen na pohledech hlavního dílu", () => {
  it("kóty hřídele zůstanou v předním pohledu, pohled kostky je bez kót; stav vypíše název modelu", async () => {
    const shaft = (await runText(modelOnly(guideExample("### Příklad A")))).doc;
    const box = (await runText("nový díl Kostka\nkvádr 50 30 10")).doc;
    const models: ModelView[] = [{ id: "mb", name: "Kostka", source: { kind: "doc", doc: box }, view: "front", scale: "auto" }];
    const extra = await drawingModelShapes(shaft, models);
    expect(Object.keys(extra)).toEqual(["mb"]);
    const body = (await buildDoc(drawingDoc(shaft))).body!;
    const opts: Partial<DrawingOptions> = { sheet: "A3", views: VIEWS(["front", "left"]), models, dimensions: "smart" };
    const d = makeSmartDrawing(body, shaft, { name: "Hřídel", material: "" }, opts, extra);
    expect(d.smart.annotations.filter((a) => a.view.startsWith("m:"))).toEqual([]);
    expect(d.smart.report.perView.front).toBe(14);
    const L = labelsOf(d.views, d.smart.annotations);
    for (const s of ["M20×1,5", "Ø30", "(50)", "140", "2× R1"]) expect(L, s).toContain(s);
    // stav výkresu: pohled modelu názvem, ne klíčem „m:mb“
    const compute: DrawingCompute = async (doc, meta, o) => makeSmartDrawing((await buildDoc(drawingDoc(doc))).body!, doc, meta, o, await drawingModelShapes(doc, o.models));
    const doc: CadDoc = { ...shaft, drawings: [{ id: "s1", name: "List 1", options: opts as unknown as Record<string, unknown>, meta: {}, annotations: [] }] };
    const st = (await drawingStatus(doc, compute)).text;
    expect(st).not.toContain("m:mb");
    expect(st).toMatch(/pohledy: přední, levý, Kostka/);
  }, 180_000);
});

describe("sloučení po změně modelu: úpravy kót se drží významu, ne pořadí", () => {
  const SHAFT = (profile: string) => `nový díl Hřídel\nskica XZ: čára ${profile} uzavřít\nrotovat osa X\nvýkres A3 na šířku pohledy přední,levý,iso\nkótovat`;
  const P1 = "0 0 0 10 30 10 30 15 80 15 80 12,5 120 12,5 120 0";
  it("přidané osazení: h6 zůstane u Ø30 a ±0,05 u délky 40", async () => {
    const a = await runText(`${SHAFT(P1)}\nvýkres tolerance Ø30 h6\nvýkres tolerance 40 ±0,05`);
    const st0 = (await drawingStatus(a.doc, computeDrawing)).text;
    expect(statusLine(st0, "přední")).toContain("Ø30h6");
    expect(statusLine(st0, "přední")).toContain("40±0,05");
    // osazení Ø16 na levém konci (první článek 30 se rozdělí na 10 + 20)
    const m2 = (await runText(SHAFT("0 0 0 8 10 8 10 10 30 10 30 15 80 15 80 12,5 120 12,5 120 0").split("\nvýkres")[0])).doc;
    const st = (await drawingStatus({ ...m2, drawings: a.doc.drawings }, computeDrawing)).text;
    const line = statusLine(st, "přední");
    expect(line).toContain("Ø30h6");
    expect(line).toContain("40±0,05");
    expect(line).not.toMatch(/Ø(16|20|25)h6/);
    expect(line).not.toMatch(/(^|· )(10|20)±0,05/);
  }, 180_000);
  it("pomocná kóta se přesune na jiný článek: „)“ nezůstane u kóty, která už pomocná není", async () => {
    const a = await runText(SHAFT(P1));
    expect(statusLine((await drawingStatus(a.doc, computeDrawing)).text, "přední")).toContain("(50)");
    // delší konec Ø25: nejdelší článek je teď 60
    const m2 = (await runText(SHAFT("0 0 0 10 30 10 30 15 80 15 80 12,5 140 12,5 140 0").split("\nvýkres")[0])).doc;
    const line = statusLine((await drawingStatus({ ...m2, drawings: a.doc.drawings }, computeDrawing)).text, "přední");
    expect(line).toContain("(60)");
    expect(line).not.toMatch(/(^|[ ·])\d+\)/); // žádné „50)“ bez závorky na začátku
    expect(line.split(" · ")).toContain("50");
  }, 180_000);
  it("smazaný závit: stoupání „×1,5“ nezůstane u prostého průměru, tolerance h6 zůstane u Ø30", async () => {
    const a = await runText(guideExample("### Příklad A"));
    const noThread: CadDoc = { ...a.doc, features: a.doc.features.filter((f) => f.type !== "thread") };
    const line = statusLine((await drawingStatus(noThread, computeDrawing)).text, "přední");
    expect(line).not.toContain("×1,5");
    expect(line).toContain("Ø20");
    expect(line).toContain("Ø30h6");
  }, 180_000);
});

describe("sloučení: vygenerovaná část přípony se nepřenáší, úprava uživatele ano", () => {
  it("rozdělení přípony: stoupání závitu, závorka pomocné kóty, „ (=celkem)“ roztečí", () => {
    expect(splitSuffix({ prefix: "M", suffix: "×1,5-6g" })).toEqual({ head: "×1,5", user: "-6g", tail: "" });
    expect(splitSuffix({ prefix: "(", suffix: ")" })).toEqual({ head: "", user: "", tail: ")" });
    expect(splitSuffix({ prefix: "(", suffix: "±0,05" })).toEqual({ head: "", user: "±0,05", tail: "" }); // dřívější „(50±0,05“
    expect(splitSuffix({ prefix: "3× ", suffix: "±0,1 (=60)" })).toEqual({ head: "", user: "±0,1", tail: " (=60)" });
    expect(splitSuffix({ prefix: "Ø", suffix: "h6" })).toEqual({ head: "", user: "h6", tail: "" });
  });
  it("tolerance se přenese do nové vygenerované přípony; pomocná kóta, která přestala být pomocnou, závorku ztratí", () => {
    const dim = (key: string, id: string, extra = {}): DrawingAnnotation => ({ id, view: "front", auto: key, type: "dim", kind: "horizontal", a: [0, 0], b: [10, 0], offset: 8, ...extra }) as DrawingAnnotation;
    const old = [dim("dia:M20×1,5", "o1", { prefix: "M", suffix: "×1,5-6g" }), dim("len:c:30.000:80.000", "o2", { prefix: "(", suffix: ")" }), dim("pos:top:0:p10.000", "o3", { prefix: "3× ", suffix: "±0,1 (=60)" })];
    const smart = { gen: "G2", annotations: [dim("dia:M20×1,5", "n1", { prefix: "M", suffix: "×1,5" }), dim("len:c:30.000:80.000", "n2"), dim("pos:top:0:p10.000", "n3", { prefix: "4× ", suffix: " (=90)" })], report: { kind: "turned" as const, perView: {}, skipped: [], expected: 3, noRoom: 0 } };
    const m = mergeSmart(old, { smartGen: "G1" }, smart)!.annotations as Dim[];
    expect(m.map((a) => [a.prefix, a.suffix])).toEqual([["M", "×1,5-6g"], [undefined, undefined], ["4× ", "±0,1 (=90)"]]);
  });
});

describe("tolerance pomocné kóty (ISO 129-1: pomocná kóta se netoleruje)", () => {
  it("„výkres tolerance 50 ±0,05“ na pomocnou kótu (50) skončí chybou s kandidáty", async () => {
    await expect(runText(`${guideExample("### Příklad A")}\nvýkres tolerance 50 ±0,05`)).rejects.toThrow(/pomocná kóta.*netoleruje.*42/);
  }, 120_000);
  it("tolerance na článek řetězu ponechá závorky pomocné kóty a návod ukazuje jen proveditelné tolerance", async () => {
    const { doc } = await runText(`${guideExample("### Příklad A")}\nvýkres tolerance 42 ±0,05`);
    const st = (await drawingStatus(doc, computeDrawing)).text;
    expect(statusLine(st, "přední")).toContain("42±0,05");
    expect(statusLine(st, "přední")).toContain("(50)");
    expect(st).toMatch(/Kontrola kót: všech \d+ očekávaných rozměrů je na listu/);
    expect(AGENT_GUIDE).not.toContain("výkres tolerance 50 ±0,05");
  }, 120_000);
});

describe("příčná díra rotačního dílu: poloha podél osy od čela, ne od počátku modelu", () => {
  const VW = { sheet: "A3" as const, views: VIEWS(["front", "top"]) };
  it("hřídel x = 10…110, díra v x = 40 → poloha 30 od levého čela", async () => {
    const doc = (await runText("nový díl Hřídel\nskica XZ: čára 10 0 10 15 110 15 110 0 uzavřít\nrotovat osa X\ndíra 6 skrz v 40 0 15 obousměrně")).doc;
    const d = await smartDrawing(doc, VW);
    expect(d.smart.report.kind).toBe("turned");
    const top = labelsOf(d.drawing.views, d.smart.annotations.filter((a) => a.view === "top"));
    expect(top).toContain("Ø6 skrz");
    expect(top).toContain("30");
    expect(top).not.toContain("40");
  }, 120_000);
  it("hřídel x = −50…50, díra v počátku → poloha 50 od čela (dřív bez polohy)", async () => {
    const doc = (await runText("nový díl Hřídel\nskica XZ: čára -50 0 -50 15 50 15 50 0 uzavřít\nrotovat osa X\ndíra 6 skrz v 0 0 15 obousměrně")).doc;
    const d = await smartDrawing(doc, VW);
    const top = labelsOf(d.drawing.views, d.smart.annotations.filter((a) => a.view === "top"));
    expect(top).toContain("Ø6 skrz");
    expect(top).toContain("50");
  }, 120_000);
});

describe("vrtání v polovičním řezu: vynášecí čáry od bližšího čela", () => {
  it("pouzdro Ø40/Ø20 × 60, řez XZ poloviční, bez čelního pohledu", async () => {
    const doc = (await runText("nový díl Pouzdro\nskica XZ: čára 0 10 0 20 60 20 60 10 uzavřít\nrotovat osa X")).doc;
    for (const rotation of [0, 90] as const) {
      const d = await smartDrawing(doc, { sheet: "A3", views: VIEWS(["front"]), section: { plane: "XZ", offset: 0, kind: "half" }, rotation });
      const bore = d.smart.annotations.find((a): a is Dim => a.type === "dim" && !!a.auto?.startsWith("bore:"));
      expect(bore, `rotace ${rotation}`).toBeTruthy();
      const v = d.drawing.views.find((x) => x.key === "section")!;
      // vynášecí čára vede od obrysu ke kótovací čáře na bližší straně – nikdy přes celou délku pohledu
      const span = bore!.kind === "vertical" ? v.w * v.s : v.h * v.s;
      expect(Math.abs(bore!.offset), `rotace ${rotation}`).toBeLessThan(span / 2);
    }
  }, 180_000);
});

describe("slepé vrtání v řezu: hloubka jen od hran, které jsou v řezu vidět", () => {
  it("celý řez: hloubka 40 okótovaná; poloviční řez přes osu (dno díry v nevyříznuté polovině): hloubka se nahlásí", async () => {
    const doc = (await runText("nový díl B\nskica XZ: čára 0 0 0 20 60 20 60 10 20 10 20 0 uzavřít\nrotovat osa X")).doc;
    const full = await smartDrawing(doc, { sheet: "A3", views: VIEWS(["front"]), section: { plane: "XZ", offset: 0 } });
    expect(labelsOf(full.drawing.views, full.smart.annotations.filter((a) => a.view === "section"))).toEqual(["Ø20", "40"]);
    const half = await smartDrawing(doc, { sheet: "A3", views: VIEWS(["front"]), section: { plane: "XZ", offset: 0, kind: "half" } });
    // řez se dělí napříč osou (díl má jen dva průměry): dno díry je v nevyříznuté polovině → bez fantomové vynášecí čáry
    expect(half.smart.annotations.some((a) => a.auto === "bore:10:d")).toBe(false);
    expect(half.smart.report.skipped).toContain("Ø20 ↧40: hloubka vrtání není v řezu vidět – kótujte ji ručně");
  }, 180_000);
});

describe("polohy děr před popisy: řetěz zůstane na jedné čáře, odkazy se nekříží", () => {
  it("deska se slepou, zahloubenou a dvěma průchozími dírami", async () => {
    const doc = (await runText("nový díl D\nkvádr 100 60 15\ndíra 10 hloubka 8 v 25 30\ndíra 6,6 skrz v 40 38 kuželové 12,4\ndíra 8 skrz v 8 12\npole 2 rozteč 35 směr Y")).doc;
    const d = await smartDrawing(doc, { sheet: "A3", views: VIEWS(["front", "top"]) });
    const top = d.smart.annotations.filter((a) => a.view === "top");
    const lineX = (lab: string) => {
      const a = top.find((x): x is Dim => x.type === "dim" && x.kind === "vertical" && annLabel(d.drawing.views, x) === lab)!;
      return annToSheet(d.drawing.views, "top", (a as { a: Vec2 }).a)[0] + a.offset;
    };
    // řetěz poloh děr Ø8: 12 od hrany a rozteč 35 na jedné čáře (dřív 12 vpravo s vynášecí čarou přes celou desku, 35 vlevo)
    expect(Math.abs(lineX("12") - lineX("35"))).toBeLessThan(0.01);
    const legs = top.filter((a) => a.type === "callout").map((a) => [annToSheet(d.drawing.views, "top", (a as { tip: Vec2 }).tip), annToSheet(d.drawing.views, "top", (a as { at: Vec2 }).at)] as [Vec2, Vec2]);
    expect(legs.length).toBe(3);
    for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) expect(segsCross(legs[i][0], legs[i][1], legs[j][0], legs[j][1])).toBe(false);
  }, 120_000);
});

describe("otočený hlavní pohled: rada „zapněte pohled …“ podle otočených kamer", () => {
  const C = () => modelOnly(guideExample("### Příklad C"));
  it("rotace 90°, pohledy přední / horní / spodní → rada nabídne levý / pravý, ne spodní ani „—“", async () => {
    const doc = (await runText(C())).doc;
    const d = await smartDrawing(doc, { sheet: "A3", views: VIEWS(["front", "top", "bottom"]), rotation: 90 });
    const hint = d.smart.report.skipped.find((s) => s.includes("4× M8"));
    expect(hint).toBeTruthy();
    expect(hint).toMatch(/zapněte pohled .*pravý/);
    expect(hint).not.toContain("spodní");
    expect(hint).not.toContain("—");
  }, 120_000);
  it("rotace 90°, pohledy přední / horní / pravý → díry okótované; celkový rozměr v dalším pohledu se nehlásí jako nevešlý", async () => {
    const doc = (await runText(C())).doc;
    const d = await smartDrawing(doc, { sheet: "A3", views: VIEWS(["front", "top", "right"]), rotation: 90 });
    const L = labelsOf(d.drawing.views, d.smart.annotations);
    expect(L).toContain("4× M8 ↧10 / Ø6,8 ↧14");
    expect(L).toContain("120");
    expect(d.smart.report.skipped.filter((s) => /^120: /.test(s))).toEqual([]);
  }, 120_000);
});

describe("popisy s odkazem: odkazové čáry se nekříží", () => {
  it("dva popisy s hroty blízko sebe, preferované směry proti sobě → druhý odkaz zvolí jiný směr", () => {
    const view: PlacedView = { key: "front", px: 100, py: 100, s: 1, x0: 0, y0: 0, w: 100, h: 60 };
    const lay = new DimLayout({ views: [view], sheet: { name: "A3", w: 420, h: 297 }, texts: [], polys: [] });
    expect(lay.placeCall({ key: "a", view: "front", tip: [40, 10], lines: ["Ø10 ↧8"], prefer: [1, -1] })).toBe(true);
    expect(lay.placeCall({ key: "b", view: "front", tip: [60, 10], lines: ["Ø6,6 skrz"], prefer: [-1, -1] })).toBe(true);
    const legs = lay.placed.map((p) => {
      const c = p.ann as { tip: Vec2; at: Vec2 };
      return [annToSheet([view], "front", c.tip), annToSheet([view], "front", c.at)] as [Vec2, Vec2];
    });
    const cross = (p: Vec2, q: Vec2, a: Vec2, b: Vec2) => {
      const o = (u: Vec2, v: Vec2, w: Vec2) => Math.sign((v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]));
      return o(p, q, a) * o(p, q, b) < 0 && o(a, b, p) * o(a, b, q) < 0;
    };
    expect(cross(legs[0][0], legs[0][1], legs[1][0], legs[1][1])).toBe(false);
  });
});

