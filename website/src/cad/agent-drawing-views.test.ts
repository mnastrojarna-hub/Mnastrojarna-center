/**
 * Textové příkazy výkresu vlny 7: rozbor (cs / en / de) a provedení s jádrem (OCCT) – pomocný pohled, zalomený řez,
 * částečný řez, přerušení, uložení ISO 286 s Tabulkou uložení, trojúhelník revize se zónou a stav výkresu.
 */
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { AGENT_COMMANDS, parseAgentText } from "./agent";
import { AGENT_GUIDE } from "./agent-guide";
import type { DrawingCmd } from "./agent-drawing";
import { activeSheet, drawingStatus, mergeSmart } from "./drawing-agent";
import type { DrawingAnnotation } from "./types";
import { computeDrawing, runText } from "./drawing-dims-harness";
import { exportDrawing } from "./drawing-export";
import type { DrawingOptions } from "./drawing";
import "./ext/index";
import "./feat/index";

const cmd = (line: string): DrawingCmd => {
  const p = parseAgentText(line);
  if (p.errors.length) throw new Error(p.errors[0].message);
  const op = p.ops[0];
  if (op.k !== "drawingCmd") throw new Error(`${line} → ${op.k}`);
  return op.cmd;
};
const views = (line: string) => {
  const c = cmd(line);
  if (c.k !== "views") throw new Error(`${line} → ${c.k}`);
  return c.cmd;
};

describe("rozbor příkazů (cs / en / de)", () => {
  it("pomocný pohled: hrana, plocha, směr, smazání", () => {
    expect(views("výkres pohled pomocný přední hrana 40 50 100 15,36 umístit 330 120")).toEqual({ op: "aux", parent: "front", edge: [[40, 50], [100, 15.36]], place: [330, 120] });
    expect(views("drawing view auxiliary front edge 40 50 100 15.36 along flip")).toEqual({ op: "aux", parent: "front", edge: [[40, 50], [100, 15.36]], mode: "along", flip: true });
    expect(views("zeichnung ansicht hilfsansicht fläche F7")).toEqual({ op: "aux", face: 7 });
    expect(views("výkres pohled pomocný horní směr 0,5 0 0,87")).toEqual({ op: "aux", parent: "top", dir: [0.5, 0, 0.87] });
    expect(views("výkres pohled pomocný smazat b")).toEqual({ op: "aux-del", label: "B" });
    expect(() => cmd("výkres pohled pomocný přední")).toThrow(/hranu, plochu nebo směr/);
    expect(() => cmd("výkres pohled pomocný hrana 0 0 10 0")).toThrow(/rodičovský pohled/);
    // volba pohledů listu zůstává
    expect(cmd("výkres pohled přední,horní")).toMatchObject({ k: "set", opts: { views: { front: true, top: true } } });
  });
  it("řezy: zalomený, natočený, částečný, smazání; řez rovinou zůstává", () => {
    expect(views("výkres řez zalomený horní body -70 -10 -20 -10 -20 10 70 10")).toEqual({ op: "cut", kind: "stepped", parent: "top", pts: [[-70, -10], [-20, -10], [-20, 10], [70, 10]] });
    expect(views("drawing section aligned top points 60 0 0 0 -30 52 flip")).toEqual({ op: "cut", kind: "aligned", parent: "top", pts: [[60, 0], [0, 0], [-30, 52]], flip: true });
    expect(views("zeichnung schnitt teilschnitt vorne punkte -25 5 25 5 25 45 tiefe 30 kurve")).toEqual({ op: "bo", view: "front", pts: [[-25, 5], [25, 5], [25, 45]], depth: 30, spline: true });
    expect(views("výkres řez smazat C")).toEqual({ op: "cut-del", label: "C" });
    expect(views("výkres řez částečný smazat vše")).toEqual({ op: "bo-del", which: "all" });
    expect(() => cmd("výkres řez natočený horní body 1 2 3 4")).toThrow(/3 body|konec hlavního ramena/);
    expect(() => cmd("výkres řez částečný přední body 0 0 1 1 2 0")).toThrow(/hloubku/);
    expect(cmd("výkres řez XZ odsazení 0 poloviční")).toMatchObject({ k: "set", opts: { section: { plane: "XZ", offset: 0, kind: "half" } } });
  });
  it("přerušení, uložení, revize, zóny", () => {
    expect(views("výkres přerušení přední x od 250 do 50 mezera 6 vlnovka")).toEqual({ op: "break", view: "front", axis: "x", from: 50, to: 250, gap: 6, style: "wave" });
    expect(views("drawing break front y 10 40")).toEqual({ op: "break", view: "front", axis: "y", from: 10, to: 40 });
    expect(views("zeichnung unterbrechung löschen 2")).toEqual({ op: "break-del", which: 2 });
    expect(() => cmd("výkres přerušení přední od 50 do 250")).toThrow(/osa pohledu/);
    expect(cmd("výkres uložení Ø40 H7")).toEqual({ k: "tol", target: "Ø40", tol: "H7", fit: true });
    expect(cmd("drawing fit Ø25 H7/k6 show limits")).toEqual({ k: "tol", target: "Ø25", tol: "H7/k6", fit: true, show: "limits" });
    expect(views("zeichnung passung tabelle ja")).toEqual({ op: "fit-table", on: true });
    expect(views("výkres uložení zobrazení značka")).toEqual({ op: "fit-show", show: "code" });
    expect(views("výkres uložení dotaz Ø40 H7/g6")).toEqual({ op: "fit-query", size: 40, code: "H7/g6" });
    expect(views("výkres revize značka B na Ø40, 25")).toEqual({ op: "rev-mark", rev: "B", targets: ["Ø40", "25"] });
    expect(views("drawing revision mark delete on a3")).toEqual({ op: "rev-unmark", targets: ["a3"] });
    expect(views("zeichnung änderung B dreiecke nein")).toEqual({ op: "rev-marks", rev: "B", on: false });
    expect(views("výkres zóny ano")).toEqual({ op: "zones", on: true });
    // revize s popisem zůstává
    expect(cmd('výkres revize B "značky na Ø40"')).toMatchObject({ k: "rev", op: "set", rev: "B", note: "značky na Ø40" });
    // značka na pomocný pohled / řez lomenou čarou
    expect(cmd("výkres značka drsnost Ra 1,6 pohled B v 10 5")).toMatchObject({ k: "mark", target: { view: "aux:B", at: [10, 5] } });
    expect(cmd("výkres kóta vodorovně pohled řez B -10 0 10 0")).toMatchObject({ k: "mdim", dim: { view: "cut:B" } });
    // „řez v x y“ a „řez x …“ zůstávají řezem A–A (v, x nejsou písmena řezu)
    expect(cmd("výkres značka drsnost Ra 3,2 pohled řez v 10 5")).toMatchObject({ target: { view: "section", at: [10, 5] } });
    expect(views("výkres přerušení řez x od 10 do 20")).toMatchObject({ view: "section", axis: "x" });
    expect(views("výkres přerušení řez C y 0 5")).toMatchObject({ view: "cut:C", axis: "y" });
  });
  it("tabulka příkazů a návod pro AI", () => {
    for (const w of ["výkres pohled pomocný", "výkres řez zalomený", "výkres přerušení", "výkres uložení", "výkres revize značka"]) expect(AGENT_COMMANDS.some((c) => c.cmd.includes(w)), w).toBe(true);
    expect(AGENT_GUIDE).toContain("### Příklad E – zalomený řez, uložení, revize se zónou");
  });
});

describe("sloučení Chytrých kót s úpravami vlny 7", () => {
  const call = (auto: string, extra: Partial<DrawingAnnotation> = {}): DrawingAnnotation => ({ id: auto, view: "top", type: "callout", auto, tip: [0, 0], at: [5, 5], lines: ["Ø12 skrz"], ...extra }) as DrawingAnnotation;
  const report = (dropped: string[]) => ({ kind: "prismatic" as const, perView: {}, skipped: [], expected: 0, noRoom: dropped.length, dropped });
  it("revize a zobrazení úchylek se přenesou; upravený popis, který se nevešel, zůstane", () => {
    const old = [call("hole:1", { tol: "H7", rev: "A", tolShow: "limits" }), call("hole:2"), call("hole:3", { rev: "B" })];
    const m = mergeSmart(old, { smartGen: "x" }, { gen: "y", annotations: [call("hole:1"), call("hole:4")], report: report(["hole:2", "hole:3"]) })!;
    expect(m.annotations.find((a) => a.auto === "hole:1")).toMatchObject({ tol: "H7", rev: "A", tolShow: "limits" });
    expect(m.annotations.map((a) => a.auto)).toEqual(["hole:1", "hole:4", "hole:3"]); // hole:2 bez úprav zmizí, hole:3 s revizí zůstane
  });
});

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);
beforeEach(() => activeSheet.set(null, false));

/** příklad z návodu pro AI (blok ``` za nadpisem) */
const example = (title: string) => {
  const i = AGENT_GUIDE.indexOf(title);
  const a = AGENT_GUIDE.indexOf("```", i) + 3;
  return AGENT_GUIDE.slice(a, AGENT_GUIDE.indexOf("```", a)).trim();
};

describe("provedení s jádrem", () => {
  it("příklad E z návodu: zalomený řez, uložení Ø12 H7 s tabulkou, revize se zónou, stav a export", async () => {
    const { doc, log } = await runText(example("### Příklad E"));
    const text = log.join("\n");
    expect(text).not.toMatch(/^✗|⚠/m);
    expect(text).toMatch(/✓ řez B–B zalomený \(pohled horní, 6 bodů\) – na listu x/);
    expect(text).toMatch(/✓ tolerance H7 → Ø12H7 skrz \(\+0,018\/0\) \(horní\)/);
    expect(text).toMatch(/✓ Tabulka uložení: 1 řádků – Ø12H7 skrz H7 \+0,018\/0/);
    expect(text).toMatch(/✓ trojúhelník revize B u: Ø12H7 skrz/);
    expect(text).toMatch(/Řezy lomenou čarou: B–B zalomený \(horní: \[−70; −10\] \[−20; −10\] \[−20; 10\] \[20; 10\] \[20; −10\] \[70; −10\]\) · na listu x/);
    expect(text).toMatch(/Uložení ISO 286 \(zobrazení úchylky, tabulka ano\): Ø12H7 skrz H7 \+0,018\/0 \(12,000…12,018\)/);
    expect(text).toMatch(/Zóny listu: 8 × 6 · trojúhelníky revizí: B: Ø12H7 skrz \([A-F][1-8]\)/);
    const o = doc.drawings![0].options as Partial<DrawingOptions>;
    expect(o.cuts?.[0]).toMatchObject({ label: "B", parent: "top", kind: "stepped" });
    // export SVG: řez, tabulka uložení, zóna v tabulce revizí
    const svg = Buffer.from((await exportDrawing(doc, "svg", {}, computeDrawing)).base64, "base64").toString("utf8");
    for (const s of ["ŘEZ B–B", "Tabulka uložení (ISO 286)", "(+0,018/0)", "Díra Ø12 H7", ">Zóna<"]) expect(svg, s).toContain(s);
  }, 240_000);

  it("pomocný pohled, částečný řez a přerušení textem; stav ukazuje skutečnou délku", async () => {
    const base = "nový díl Hřídel\nválec 20 300 osa X\nvýkres A3 na šířku pohledy přední,horní\n";
    const { doc, log } = await runText(
      base +
        "výkres přerušení přední x od 50 do 250 mezera 8\nvýkres uložení dotaz 40 H7/g6\nvýkres pohled pomocný přední směr 0,5 0 0,87\nvýkres řez částečný přední body 10 -5 40 -5 40 5 10 5 hloubka 5\nvýkres stav",
    );
    const text = log.join("\n");
    expect(text).not.toMatch(/^✗/m);
    expect(text).toMatch(/✓ přerušení 1 v pohledu přední \(x 50…250\): na listu [\d,]+ mm místo [\d,]+ mm/);
    expect(text).toMatch(/Ø40 H7\/g6: díra \+0,025\/0, hřídel −0,009\/−0,025, vůle 0,009…0,05 \(s vůlí\)/);
    expect(text).toMatch(/✓ pomocný pohled B \(z pohledu přední, kolmo, směr 0,5 0 0,87\)/);
    expect(text).toMatch(/✓ částečný řez 1 v pohledu přední: oblast 4 bodů, hloubka 5 mm/);
    const m = /Přerušení: 1 přední x 50…250 – na listu ([\d,]+) místo ([\d,]+) mm/.exec(text);
    expect(m).toBeTruthy();
    // zkrácený pohled = zbylých 100 mm v měřítku listu + mezera 8 mm na listu (měřítko z prvního průchodu)
    const [shown, full] = [m![1], m![2]].map((x) => Number(x.replace(",", ".")));
    expect(shown - full / 3).toBeCloseTo(8, 1);
    expect(text).toMatch(/Kontrola kót: všech \d+ očekávaných rozměrů je na listu/);
    // souřadnice přerušeného pohledu ve stavu: skutečný rozsah 0…300
    expect(text).toMatch(/přední \(x = X, y = Z\): x 0…300/);
    const st = await drawingStatus(doc, computeDrawing);
    expect(st.text).toMatch(/Pomocné pohledy: B \(směr 0,5 0 0,87\) · na listu x/);
  }, 240_000);
});
