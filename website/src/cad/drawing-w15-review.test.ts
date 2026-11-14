/**
 * Vlna 15, balík výkresu – regresní testy nálezů 2. kontroly:
 * - B8: přeurčený řetěz (všechny články funkční) – tolerance celkové délky neudělá z tolerovaného článku pomocnou kótu
 *   „(50-0,1)“, pomocnou bude funkční rozměr bez tolerance; vše tolerované = ✗; `kótovat funkční …` totéž; ruční náhradní
 *   kóta starších dokumentů se při převodu odstraní; „50; 30“ jako v poli formuláře;
 * - B12: tabulka děr v levém / pravém / zadním pohledu (dřív jen horní / přední / spodní – polohy beze stopy chyběly), jedna
 *   tabulka na list, zahloubení ve stejném řádku a závit označením, průměr na tisíciny, dlouhá tabulka ve dvou sloupcích
 *   a varování, když překryje pohledy; `kótovat díry souřadnicově` tabulku vypne; značky skupin děr u souřadnicových kót;
 * - Kontrola kót na deskách (bez dat zákazníka – syntetické díly): díra zespodu bez spodního pohledu se okótuje na skrytých kružnicích („ze spodní strany“), šikmá
 *   díra a šikmá skica radí pomocný pohled se směrem, kvádry (osazení, okna) se kótují, průchozí / vyčnívající odebrání
 *   nečeká délku nástroje;
 * - B5: stav označí starší řez a ukáže odsazení v dnešní konvenci; rozsah odsazení je otevřený (s příkladem);
 * - tolerance s desetinnou tečkou na českém listu → čárka; kontrola tolerancí bez předlohy to řekne; názvy pohledů EN/DE.
 * OpenCascade v Node (jako drawing-w15.test.ts).
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { parseAgentText } from "./agent";
import { parseDimension } from "./agent-drawing";
import type { HoleRow } from "./drawing";
import { applyDrawingCmd, drawingStatus, localDecimals, type DrawingCmdResult, type SmartResult } from "./drawing-agent";
import { annLabel } from "./drawing-marks";
import { computeDrawing, runText } from "./drawing-dims-harness";
import { threadsOfDoc } from "./drawing-doc";
import { withAnnotations } from "./drawing";
import { sectionMiss, sectionStatusText } from "./drawing-section";
import { overdeterminedChain } from "./drawing-functional";
import { HOLE_SPLIT, holeTableColumns, holeTableRows } from "./drawing-holetable";
import { expectedDims } from "./dim-check";
import { setLang, tr } from "./i18n";
import type { CadDoc, DrawingAnnotation, Vec3 } from "./types";
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
const apply = (doc: CadDoc, line: string): Promise<DrawingCmdResult> => applyDrawingCmd(doc, cmdOf(line), computeDrawing);
const statusOf = async (doc: CadDoc) => (await drawingStatus(doc, computeDrawing)).text;
const viewLine = (st: string, v: string) => st.split("\n").find((l) => l.startsWith(`  ${v}: `)) ?? "";
const sheetRes = async (doc: CadDoc) => (await computeDrawing(doc, { name: doc.name, material: "", threads: threadsOfDoc(doc) }, { ...(doc.drawings![0].options as object), dimensions: "smart" })) as SmartResult;
const labels = (res: SmartResult, anns: DrawingAnnotation[]) => anns.filter((a) => a.type === "dim" || a.type === "callout").map((a) => annLabel(res.views, a));

const SHAFT = "nový díl Hřídel\nskica XZ: čára 0 0 0 10 30 10 30 8,5 33 8,5 33 15 83 15 83 20 98 20 98 12,5 140 12,5 140 0 uzavřít\nrotovat osa X\nvýkres A3 na šířku pohledy přední,levý,iso\n";

// ------------------------------------------------------------------ B8: přeurčený řetěz

describe("B8 – přeurčený řetěz, ruční náhradní kóta, seznam se středníky", () => {
  it("overdeterminedChain: pomocným bude nejdelší funkční rozměr bez tolerance; vše tolerované = stuck; jinak null", () => {
    const m = [
      { value: 30, tol: false },
      { value: 3, tol: false },
      { value: 50, tol: true },
      { value: 15, tol: false },
      { value: 42, tol: false },
      { value: 140, tol: false },
    ];
    expect(overdeterminedChain(m, 140, [30, 3, 50, 15, 42])).toEqual({ drop: 42 });
    expect(overdeterminedChain(m, 50, [30, 3, 50, 15, 42, 140])).toEqual({ drop: 140 });
    expect(overdeterminedChain(m, 140, [50])).toBeNull();
    expect(overdeterminedChain(m.map((x) => ({ ...x, tol: x.value !== 140 })), 140, [30, 3, 50, 15, 42])).toEqual({ stuck: true });
  });
  it("hřídel, funkční všechny články: tolerance 50 a 140 → pomocná (42), žádná „(50-0,1)“; tolerance 50 znovu ✓", async () => {
    const { doc, log } = await runText(`${SHAFT}kótovat funkční 30 3 50 15 42\nvýkres tolerance 50 -0,1\nvýkres tolerance 140 ±0,2`);
    expect(log.at(-1)).toBe("✓ tolerance ±0,2 → 140±0,2 (přední) – rozměr 140 je nyní funkční; řetěz by byl přeurčený, pomocnou kótou je proto funkční rozměr bez tolerance (42)");
    const st = await statusOf(doc);
    const front = viewLine(st, "přední");
    expect(front).toContain(" 50-0,1 ");
    expect(front).toContain("(42)");
    expect(front).toContain("140±0,2");
    expect(front).not.toMatch(/\(50/);
    expect(st).toContain("Funkční rozměry: 30, 3, 50, 15, 140");
    expect(st).not.toContain("uzavřený řetěz");
    // kontrola tolerancí: 50 i 140 tolerované, žádná rada „… ji převede“ na tolerovaný článek
    const tc = await apply(doc, "výkres kontrola tolerancí");
    expect(tc.log.some((l) => l.includes("ji převede"))).toBe(false);
    expect(tc.log).toContain("  ✓ 50 funkční: a8 50-0,1 (přední)");
    const again = await apply(doc, "výkres tolerance 50 -0,1");
    expect(again.log.at(-1)).toBe("✓ tolerance -0,1 → 50-0,1 (přední)");
  }, 240_000);
  it("vše funkční a tolerované → tolerance celkové délky = ✗ s radou (list se nezmění)", async () => {
    const { doc } = await runText(`${SHAFT}kótovat funkční 30 3 50 15 42\nvýkres tolerance 30 ±0,1\nvýkres tolerance 3 ±0,1\nvýkres tolerance 50 -0,1\nvýkres tolerance 15 ±0,1\nvýkres tolerance 42 ±0,1`);
    const before = JSON.stringify(doc.drawings);
    await expect(apply(doc, "výkres tolerance 140 ±0,2")).rejects.toThrow(/^rozměr 140 nelze tolerovat: řetěz 30 · 3 · 50 · 15 · 42 · 140 by byl přeurčený – všechny jeho rozměry jsou funkční a ostatní mají toleranci/);
    expect(JSON.stringify(doc.drawings)).toBe(before);
  }, 240_000);
  it("kótovat funkční … i celková délka, článek s tolerancí by byl pomocný → pomocnou je rozměr bez tolerance (140)", async () => {
    const { doc, log } = await runText(`${SHAFT}kótovat funkční 50\nvýkres tolerance 50 -0,1\nkótovat funkční 30 3 50 15 42 140`);
    expect(log).toContain("! řetěz byl přeurčený (funkční byly všechny jeho rozměry) – pomocnou kótou je funkční rozměr bez tolerance 140, tolerovaný 50 zůstává funkční");
    const front = viewLine(await statusOf(doc), "přední");
    expect(front).toContain(" 50-0,1 ");
    expect(front).toContain("(140)");
  }, 240_000);
  it("starší dokument s ruční náhradní kótou „50“ u pomocné „(50)“: tolerance převede vygenerovanou a ruční odstraní", async () => {
    const { doc } = await runText(`${SHAFT}kótovat\nvýkres kóta vodorovně pohled přední 33 -15 83 -15`);
    const st0 = await statusOf(doc);
    expect(viewLine(st0, "přední")).toContain("(50)");
    expect(st0).toMatch(/Duplicity \(1\)/);
    const r1 = await apply(doc, "výkres tolerance 50 -0,1");
    expect(r1.log.at(-1)).toMatch(/^✓ tolerance -0,1 → 50-0,1 \(přední\) – rozměr 50 je nyní funkční \(pomocnou kótou řetězu je \(42\)\) · odstraněna ruční náhradní kóta 50$/);
    const st = await statusOf(r1.doc);
    expect(st).toContain("Duplicity: žádné");
    expect(viewLine(st, "přední").match(/50/g)?.length).toBe(1);
  }, 240_000);
  it("funkční rozměry se středníkem jako v poli formuláře: „50; 30“, „50;30“", () => {
    expect(parseDimension(["funkční", "50;", "30"])).toEqual({ k: "dim", mode: "smart", functional: [50, 30] });
    expect(parseDimension(["funkční", "50;30"])).toEqual({ k: "dim", mode: "smart", functional: [50, 30] });
    expect(parseDimension(["funkční", "26,5;74,175", "díry", "tabulka"])).toEqual({ k: "dim", mode: "smart", functional: [26.5, 74.175], holes: "table" });
    expect(cmdOf("kótovat funkční 50; 30")).toEqual({ k: "dim", mode: "smart", functional: [50, 30] });
  });
});

// ------------------------------------------------------------------ B12: tabulka děr

const SIDE14 = (() => {
  const pos = [[8, 6], [15, 30], [22, 12], [29, 34], [36, 8], [43, 26], [50, 14], [57, 32], [64, 10], [71, 28], [78, 18], [85, 6], [92, 24], [99, 33]];
  return `nový díl BokDiry\nkvádr 40 110 40\n${pos.map(([y, z]) => `díra 5 hloubka 12 v 0 ${y} ${z} směr 1 0 0`).join("\n")}\nvýkres A3 na šířku pohledy přední,horní,levý\n`;
})();
const CB = "nový díl CB\nkvádr 120 80 20\ndíra 8 skrz v 20 20 20 v 100 20 20 v 20 60 20 v 100 60 20 zahloubení 14 8\ndíra 9 skrz v 40 20 20 v 80 20 20 v 40 60 20 v 80 60 20\ndíra 6,8 skrz v 60 40 20 v 60 70 20 závit M8\nvýkres A3 na šířku pohledy přední,horní\n";

describe("B12 – tabulka děr v kterémkoli pohledu, jeden řádek na polohu, souřadnicové kóty se značkami", () => {
  it("díry viditelné jen v levém pohledu: kótovat díry tabulka nakreslí tabulku levého pohledu (14 poloh), nic nechybí", async () => {
    const { doc, log } = await runText(`${SIDE14}kótovat díry tabulka`);
    expect(log.at(-1)).toMatch(/· polohy děr tabulkou děr \(levý\)$/);
    expect(doc.drawings![0].options.holeTable).toBe(true);
    const res = await sheetRes(doc);
    expect(res.holes?.length).toBe(14);
    expect(new Set(res.holes!.map((h) => h.view))).toEqual(new Set(["left"]));
    expect(res.svg).toContain("Tabulka děr");
    expect(res.smart!.report.skipped).toEqual([]);
    expect(await statusOf(doc)).toContain("Polohy děr: tabulka děr (levý)");
  }, 240_000);
  it("dvě tabulky by byly třeba (horní i levý): tabulka pro pohled s víc dírami, druhý souřadnicově", async () => {
    const holesTop = Array.from({ length: 13 }, (_, i) => `díra 4 hloubka 6 v ${5 + ((i * 7) % 30)} ${8 + i * 7} 40`).join("\n");
    const { doc } = await runText(`${SIDE14.replace("výkres A3", `${holesTop}\nvýkres A3`)}kótovat díry tabulka`);
    const res = await sheetRes(doc);
    const mode = res.smart!.report.holeMode!;
    expect(Object.values(mode).filter((m) => m === "table").length).toBe(1);
    const tv = Object.keys(mode).find((k) => mode[k] === "table")!;
    expect(new Set(res.holes!.map((h) => h.view))).toEqual(new Set([tv]));
    expect(Object.values(mode)).toContain("ordinate");
  }, 240_000);
  it("zahloubení ve stejném řádku, závit označením (tabulka = popisy děr): 10 řádků, ne 14", async () => {
    const { doc } = await runText(`${CB}kótovat díry tabulka`);
    const res = await sheetRes(doc);
    const rows = res.holes!;
    expect(rows.length).toBe(10);
    const at = (x: number, y: number) => rows.filter((h) => Math.abs(h.x - x) < 1e-6 && Math.abs(h.y - y) < 1e-6).map((h) => h.label);
    expect(at(20, 20)).toEqual(["Ø8 ⌴Ø14"]);
    expect(at(40, 60)).toEqual(["Ø9"]);
    expect(at(60, 70)).toEqual(["M8"]);
    expect(rows.filter((h) => h.label === "Ø8 ⌴Ø14").map((h) => h.tag[0])).toEqual(["B", "B", "B", "B"]);
    expect(res.svg).toContain("M8");
    expect(res.svg).toContain("Ø8 ⌴Ø14");
  }, 240_000);
  it("čisté funkce: holeTableRows slučuje souosé válce, závit podle vrtáku, Ks podle popisu; dva sloupce nad HOLE_SPLIT", () => {
    const row = (x: number, y: number, d: number): HoleRow => ({ tag: "", x, y, d, c: [x, -y], view: "top" });
    const rows = holeTableRows([row(10, 10, 14), row(10, 10, 8), row(30, 10, 6.8), row(50, 10, 6.647), row(70, 10, 6.647)], [{ r: 3.4, label: "M8 hl. 12" }]);
    expect(rows.map((h) => [h.tag, h.label])).toEqual([["A1", "Ø6,647"], ["A2", "Ø6,647"], ["B1", "M8"], ["C1", "Ø8 ⌴Ø14"]]);
    expect(holeTableColumns(Array.from({ length: HOLE_SPLIT }, (_, i) => i)).length).toBe(1);
    expect(holeTableColumns(Array.from({ length: 40 }, (_, i) => i)).map((c) => c.length)).toEqual([20, 20]);
  });
  it("souřadnicové kóty s více druhy děr: značka skupiny u každé díry i v popisu; „díry souřadnicově“ vypne tabulku listu", async () => {
    const pts = [[57.4, 15.1], [64.7, 64.2], [90.3, 67.9], [107.3, 51.3], [9.4, 42.2], [9.6, 19.9], [26.9, 46.4], [55.9, 51.6], [101.6, 19.8], [67.4, 48.5], [80.2, 34.3], [17, 11.6], [30.4, 25.2], [42, 61.6], [48.3, 32.6], [85.7, 13.7], [34.6, 70.9], [19, 33.9], [91.9, 45.4], [44.4, 21.7], [68.9, 19.9], [31.7, 35.5]];
    const plate = `nový díl Deska22\nkvádr 120 80 15\n${pts.map(([x, y], i) => `díra ${i % 2 ? "6.647" : 8} skrz v ${x} ${y}`).join("\n")}\nvýkres A3 na šířku pohledy přední,horní,iso\n`;
    const { doc, log } = await runText(`${plate}výkres tabulka děr ano\nkótovat díry souřadnicově`);
    expect(log.at(-1)).toMatch(/· tabulka děr vypnuta – polohy děr jsou kótami \(zpět: kótovat díry tabulka\)$/);
    expect(doc.drawings![0].options.holeTable).toBe(false);
    const calls = doc.drawings![0].annotations.filter((a): a is Extract<DrawingAnnotation, { type: "callout" }> => a.type === "callout" && !!a.auto?.startsWith("hole:"));
    expect(calls.map((a) => a.lines[0]).sort()).toEqual(["11× Ø6,647 skrz (B)", "11× Ø8 skrz (A)"].sort());
    expect(calls.map((a) => a.tags?.length)).toEqual([11, 11]);
    const res = await sheetRes(doc);
    expect(res.holes).toBeUndefined();
    const svgTexts = [...withAnnotations(res, doc.drawings![0].annotations).svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(svgTexts.filter((t) => t === "A").length).toBeGreaterThanOrEqual(11);
    expect(svgTexts.filter((t) => t === "B").length).toBeGreaterThanOrEqual(11);
    // tabulkou zpět: list tabulku zase má
    const back = await apply(doc, "kótovat díry tabulka");
    expect(back.doc.drawings![0].options.holeTable).toBe(true);
    expect((await sheetRes(back.doc)).holes?.length).toBe(22);
  }, 300_000);
  it("dlouhá tabulka (40 děr) ve dvou sloupcích; překryje-li na plném listu pohled, protokol to řekne", async () => {
    // 8 × 5 poloh v nepravidelné mřížce (různé průměry), díry se nepřekrývají
    const holes = Array.from({ length: 40 }, (_, i) => `díra ${[6.6, 8.5, 11, 5.5][i % 4]} skrz v ${15 + (i % 8) * 24 + (Math.floor(i / 8) % 2) * 5} ${15 + Math.floor(i / 8) * 28 + (i % 3) * 3}`).join("\n");
    const { doc, log } = await runText(`nový díl Deska40\nkvádr 200 150 20\n${holes}\nvýkres A3 na šířku měřítko 1:1 pohledy přední,horní,pravý\nkótovat díry tabulka`);
    const res = await sheetRes(doc);
    expect(res.holes?.length).toBe(40);
    const overlap = (res.issues ?? []).filter((i) => i.kind === "hole-table-overlap");
    // tabulka ve dvou sloupcích (21 řádků výšky místo 41) – a pokud i tak leží přes pohled, je to ve výsledku příkazu
    if (overlap.length) expect(log.some((l) => /^⚠ Tabulka děr \(40 řádků\) překrývá pohled/.test(l))).toBe(true);
    expect(res.svg.match(/>Zn\.</g)?.length).toBe(2);
  }, 300_000);
});

// ------------------------------------------------------------------ Kontrola kót na deskách (syntetické díly)

describe("Kontrola kót desek: díra zespodu, šikmá díra / skica, kvádry, průchozí odebrání", () => {
  it("závit zespodu bez spodního pohledu: popis na skrytých kružnicích „ze spodní strany“, nic se nevynechá", async () => {
    const { doc, log } = await runText("nový díl Zespodu\nkvádr 160 120 30 v 0 -120 0\ndíra 9 skrz v 30 -10 30 v 130 -10 30\ndíra 5 hloubka 18 v 12 -100 0 v 50 -110 0 v 110 -110 0 v 148 -100 0 směr 0 0 1 závit M6 hloubka-závitu 12\nvýkres A3 na šířku pohledy přední,horní,pravý,iso skryté ano\nkótovat");
    expect(log.filter((l) => l.includes("vynech"))).toEqual([]);
    const st = await statusOf(doc);
    expect(viewLine(st, "horní")).toMatch(/4× M6 ↧12( \([A-Z]\))? \/ Ø5 ↧18 \/ ze spodní strany/);
    expect(st).toMatch(/Kontrola kót: všech \d+ očekávaných rozměrů je na listu/);
  }, 240_000);
  it("šikmá díra: rada pomocného pohledu se směrem (ne „zapněte pohled —“)", async () => {
    const { log } = await runText("nový díl Sikma\nkvádr 100 80 40\ndíra 12 skrz v 30 40 40 směr 0,5 0 -0,866025\nvýkres A3 na šířku pohledy přední,horní,pravý\nkótovat");
    const line = log.find((l) => l.includes("Ø12"))!;
    expect(line).toMatch(/^! vynecháno: Ø12 skrz: šikmá díra – osa není ve směru žádného pohledu; kótujte ji v pomocném pohledu kolmém na osu \(výkres pohled pomocný směr -0,5 0 0,866\) ručně$/);
    expect(log.some((l) => l.includes("zapněte pohled —"))).toBe(false);
  }, 240_000);
  it("osazená deska ze dvou kvádrů + průchozí okno kvádrem: rozměry kvádrů na listu, Kontrola kót úplná", async () => {
    const { doc, log } = await runText("nový díl Osazena\nkvádr 150 120 15 v 0 -120 20\nkvádr 130 120 20 v 10 -120 0\nkvádr 24 12 40 v 60 -50 -2 odebrat\nvýkres A3 na šířku pohledy přední,horní,pravý\nkótovat");
    expect(log.filter((l) => l.includes("vynech"))).toEqual([]);
    const st = await statusOf(doc);
    expect(st).toContain("Kontrola kót: všech");
    const all = `${viewLine(st, "přední")} ${viewLine(st, "horní")} ${viewLine(st, "pravý")}`;
    for (const v of ["130", "20", "(15)", "24", "12"]) expect(all).toContain(v);
    expect(all).not.toContain("40");
  }, 240_000);
  it("expectedDims: odebrání skrz šikmou rovinou ani kvádr skrz nečekají délku nástroje; vyčnívající = délka v tělese", () => {
    const bbox: [Vec3, Vec3] = [[0, -120, 0], [150, 0, 35]];
    const doc = {
      name: "X",
      features: [
        { id: "b", name: "Kvádr 1", type: "box", size: [150, 120, 35], position: [0, -120, 0], centered: false, mode: "new" },
        { id: "k", name: "Kvádr 3", type: "box", size: [24, 12, 40], position: [60, -50, -2], centered: false, mode: "cut" },
        { id: "s", name: "Skica", type: "sketch", plane: { kind: "base", name: "YZ", offset: 10 }, entities: [{ id: "e1", type: "polyline", points: [[-8, 35], [1, 32], [1, 36]], closed: true }] },
        { id: "e", name: "Vysunutí 2", type: "extrude", sketchId: "s", distance: 14, symmetric: false, reverse: true, mode: "cut" },
        { id: "s2", name: "Skica 5", type: "sketch", plane: { kind: "custom", origin: [40, -60, 50], normal: [0.5, 0, -0.866025], xDir: [0.866025, 0, 0.5] }, entities: [{ id: "e1", type: "rect", cx: 0, cy: 0, w: 30, h: 60, r: 0, angle: 0 }] },
        { id: "e5", name: "Vysunutí 5", type: "extrude", sketchId: "s2", distance: 200, symmetric: false, reverse: false, mode: "cut" },
      ],
    } as unknown as CadDoc;
    const labelsX = expectedDims(doc, bbox).map((x) => `${x.label} (${x.source})`);
    expect(labelsX).toContain("24 (Kvádr 3)");
    expect(labelsX).toContain("12 (Kvádr 3)");
    expect(labelsX.some((l) => l.startsWith("40"))).toBe(false);
    expect(labelsX).toContain("10 (hloubka odebrání v tělese) (Vysunutí 2)");
    expect(labelsX.some((l) => l.startsWith("200"))).toBe(false);
  });
});

// ------------------------------------------------------------------ B5, tolerance, i18n

describe("B5 stav starého řezu, desetinná čárka tolerance, kontrola bez předlohy, názvy pohledů EN/DE", () => {
  it("stav: starší řez s odsazením v dnešní konvenci (zkopírovaný do příkazu dá stejnou rovinu); otevřený rozsah s příkladem", async () => {
    expect(sectionStatusText({ plane: "XZ", offset: -40 }, "celý")).toBe("řez XZ odsazení 40 (rovina Y = -40) celý – starší řez uložený souřadnicí Y = -40; týž řez příkazem: výkres řez XZ odsazení 40");
    expect(sectionStatusText({ plane: "XZ", offset: 40, normal: true }, "celý")).toBe("řez XZ odsazení 40 (rovina Y = -40) celý");
    const bbox: [Vec3, Vec3] = [[0, -300, 0], [200, 0, 20]];
    expect(sectionMiss({ plane: "XZ", offset: 0, normal: true }, bbox)).toMatch(/odsazení větší než 0 a menší než 300 \(krajní hodnoty leží na ploše tělesa\), např\. 150$/);
    const { doc } = await runText("nový díl Deska300\nkvádr 200 300 20 v 0 -300 0\nvýkres A2 na šířku pohledy přední,horní,iso");
    doc.drawings![0].options.section = { plane: "XZ", offset: -40 };
    expect(await statusOf(doc)).toContain("Volby: řez XZ odsazení 40 (rovina Y = -40) celý – starší řez uložený souřadnicí Y = -40; týž řez příkazem: výkres řez XZ odsazení 40");
    const r1 = await apply(doc, "výkres řez XZ odsazení 40");
    expect(r1.log.some((l) => l.startsWith("✗"))).toBe(false);
    expect(r1.doc.drawings![0].options.section).toEqual({ plane: "XZ", offset: 40, normal: true });
  }, 240_000);
  it("tolerance s tečkou na českém listu → čárka (EN tečka); lícování beze změny", async () => {
    expect(localDecimals("-0.005")).toBe("-0,005");
    expect(localDecimals("+0.02/-0.01")).toBe("+0,02/-0,01");
    expect(localDecimals("H7/g6")).toBe("H7/g6");
    const { log } = await runText("nový díl S\nkvádr 74,175 82,1825 20\nvýkres A3 pohledy přední,horní,iso\nkótovat\nvýkres tolerance 74.175 -0.005");
    expect(log.at(-1)).toBe("✓ tolerance -0,005 → 74,175-0,005 (přední)");
    setLang("en");
    try {
      expect(localDecimals("-0,005")).toBe("-0.005");
    } finally {
      setLang("cs");
    }
  }, 240_000);
  it("kontrola tolerancí bez připojené předlohy to řekne; s předlohou počítá kóty předlohy", async () => {
    const { doc } = await runText(`${SHAFT}kótovat funkční 30 42\nvýkres tolerance 42 ±0,05`);
    const r1 = await apply(doc, "výkres kontrola tolerancí");
    expect(r1.log[0]).toBe("⚠ kontrola tolerancí: bez tolerance 1 z 2 funkčních rozměrů (předloha není připojena – kóty předlohy se nekontrolují)");
    const r2 = await applyDrawingCmd(doc, cmdOf("výkres kontrola tolerancí"), computeDrawing, { referenceDims: () => [] });
    expect(r2.log[0]).toBe("⚠ kontrola tolerancí: bez tolerance 1 z 2 rozměrů (funkčních 2, z předlohy 0)");
  }, 240_000);
  it("názvy pohledů v protokolu EN/DE (dřív česky „přední“)", async () => {
    setLang("en");
    try {
      expect(tr("přední")).toBe("front");
      expect(tr("levý")).toBe("left");
      const { log } = await runText(`${SHAFT}dimension functional 30 42\ndrawing check tolerances`);
      expect(log.join("\n")).toMatch(/dimension without tolerance a\d+ 30 \(front\)/);
    } finally {
      setLang("cs");
    }
    setLang("de");
    try {
      expect(tr("horní")).toBe("oben");
    } finally {
      setLang("cs");
    }
  }, 240_000);
});
