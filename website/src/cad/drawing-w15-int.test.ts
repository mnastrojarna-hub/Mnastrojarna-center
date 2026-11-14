/**
 * Integrace vlny 15 (balíky díra + výkres): tabulka děr na listu.
 * - balík díra: jen konkávní válce, souosé průměry (zahloubení) a závit jedním řádkem, pohled s dírami (pickHoleView), řádek
 *   „Tabulka děr (pohled …)“ ve stavu výkresu;
 * - balík výkres: tabulka v pohledu zvoleném Chytrými kótami (`kótovat díry tabulka`, B12), polohy od levého dolního rohu obrysu,
 *   popisy „Ø8 ⌴Ø14“ / „M8“, Chytré kóty polohy děr v pohledu tabulky neopakují.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { drawingStatus, type SmartResult } from "./drawing-agent";
import { computeDrawing, runText } from "./drawing-dims-harness";
import { threadsOfDoc } from "./drawing-doc";
import type { CadDoc } from "./types";
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

const statusOf = async (doc: CadDoc) => (await drawingStatus(doc, computeDrawing)).text;
const sheetRes = async (doc: CadDoc) => (await computeDrawing(doc, { name: doc.name, material: "", threads: threadsOfDoc(doc) }, { ...(doc.drawings![0].options as object), dimensions: "smart" })) as SmartResult;
const holeLine = (st: string) => st.split("\n").find((l) => l.startsWith("Tabulka děr")) ?? "";

// díry vrtané ve směru X – vidí je jen levý pohled
const SIDE = (() => {
  const pos = [[8, 6], [15, 30], [22, 12], [29, 34], [36, 8], [43, 26], [50, 14], [57, 32], [64, 10], [71, 28], [78, 18], [85, 6], [92, 24], [99, 33]];
  return `nový díl BokDiry\nkvádr 40 110 40\n${pos.map(([y, z]) => `díra 5 hloubka 12 v 0 ${y} ${z} směr 1 0 0`).join("\n")}\n`;
})();
const SIDE4 = `nový díl BokDiry4\nkvádr 40 110 40\n${[[15, 10], [40, 30], [70, 12], [95, 28]].map(([y, z]) => `díra 5 hloubka 12 v 0 ${y} ${z} směr 1 0 0`).join("\n")}\n`;
const CB = "nový díl CB\nkvádr 120 80 20\ndíra 8 skrz v 20 20 20 v 100 20 20 v 20 60 20 v 100 60 20 zahloubení 14 8\ndíra 9 skrz v 40 20 20 v 80 20 20 v 40 60 20 v 80 60 20\ndíra 6,8 skrz v 60 40 20 v 60 70 20 závit M8\nvýkres A3 na šířku pohledy přední,horní\n";

describe("w15 integrace – tabulka děr (díra + výkres)", () => {
  it("kótovat díry tabulka v levém pohledu: list i stav mají tutéž tabulku levého pohledu (14 řádků)", async () => {
    const { doc } = await runText(`${SIDE}výkres A3 na šířku pohledy přední,horní,levý\nkótovat díry tabulka`);
    const res = await sheetRes(doc);
    expect(res.holes?.length).toBe(14);
    expect(new Set(res.holes!.map((h) => h.view))).toEqual(new Set(["left"]));
    const st = await statusOf(doc);
    expect(holeLine(st)).toMatch(/^Tabulka děr \(pohled levý, 14\): A1 Ø5 \[/);
    expect(st).toContain("Polohy děr: tabulka děr (levý)");
  }, 240_000);

  it("tabulka děr ano bez volby pohledu: tabulka v pohledu, který díry vidí, a Chytré kóty jejich polohy neopakují", async () => {
    // 4 díry: bez tabulky by je Chytré kóty kótovaly od hran – s tabulkou v levém pohledu jsou polohy jen v ní
    const { doc } = await runText(`${SIDE4}výkres A3 na šířku pohledy přední,horní,levý tabulka děr ano\nkótovat chytře`);
    const res = await sheetRes(doc);
    expect(new Set(res.holes!.map((h) => h.view))).toEqual(new Set(["left"]));
    expect(res.smart!.report.holeMode?.left).toBe("table");
    expect(holeLine(await statusOf(doc))).toMatch(/^Tabulka děr \(pohled levý, 4\)/);
  }, 240_000);

  it("zahloubení a závit jedním řádkem: popisy listu („Ø8 ⌴Ø14“, „M8“) i stavu („Ø8 ⌴Ø14“, „M8 Ø6,8“), polohy od rohu obrysu", async () => {
    const { doc } = await runText(`${CB}kótovat díry tabulka`);
    const res = await sheetRes(doc);
    expect(res.holes!.length).toBe(10);
    const at = (x: number, y: number) => res.holes!.find((h) => Math.abs(h.x - x) < 1e-6 && Math.abs(h.y - y) < 1e-6);
    expect(at(20, 20)?.label).toBe("Ø8 ⌴Ø14");
    expect(at(20, 20)?.steps).toEqual([14]);
    expect(at(60, 70)?.label).toBe("M8");
    expect(at(60, 70)?.thread).toBe("M8");
    const line = holeLine(await statusOf(doc));
    expect(line).toMatch(/^Tabulka děr \(pohled horní, 10\): /);
    expect(line).toMatch(/B\d Ø8 ⌴Ø14 \[20; 20\]/);
    expect(line).toMatch(/M8 Ø6,8 \[60; 70\]/);
    expect(line).not.toMatch(/[A-Z]\d+ Ø14 \[/); // zahloubení není samostatná díra
  }, 240_000);
});
