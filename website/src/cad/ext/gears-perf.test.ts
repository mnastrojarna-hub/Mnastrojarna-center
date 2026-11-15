/**
 * Kola a ozubení – výkon (štědré meze ze zadání, stroj se 4 jádry sdílený s dalšími agenty). Měří se `buildDoc` = stavba
 * prvku + síť pro zobrazení, tedy to, na co uživatel čeká. Mezipaměť těles kol se před každým měřením vyprázdní.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "../build";
import { gearProfile, gearValidate, type GearData } from "../gears";
import { emptyDoc, type CadDoc, type Feature } from "../types";
import { clearGearCache } from "./gears";
import "./index";
import "../feat/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"), print: () => undefined, printErr: () => undefined });
  r.setOC(oc as never);
}, 60_000);

let n = 0;
const doc = (ext: string, data: GearData): CadDoc => ({ ...emptyDoc(`Výkon ${++n}`), features: [{ id: `p${n}`, name: "Kolo", type: "ext", ext, data } as unknown as Feature] });
async function timed(ext: string, data: GearData) {
  clearGearCache();
  const t = Date.now();
  const res = await buildDoc(doc(ext, data));
  const ms = Date.now() - t;
  expect(res.status.every((s) => s.ok), JSON.stringify(res.status)).toBe(true);
  console.info(`výkon ${ext} ${JSON.stringify(data)}: ${ms} ms, ${res.metrics?.faces ?? "?"} ploch`);
  return ms;
}

describe("výkon stavby kol (stavba + síť)", () => {
  it("čelní m 2 z 200 b 20 < 5 s; z 24 < 1 s", async () => {
    expect(await timed("gear.spur", { z: 200 })).toBeLessThan(5000);
    expect(await timed("gear.spur", { z: 24 })).toBeLessThan(1000);
  }, 60_000);
  it("šikmé β 20°: z 60 < 10 s, z 200 < 10 s", async () => {
    expect(await timed("gear.helical", { z: 60, beta: 20 })).toBeLessThan(10_000);
    expect(await timed("gear.helical", { z: 200, beta: 20 })).toBeLessThan(10_000);
  }, 120_000);
  it("řetězové 08B z 60 triplex < 5 s, kotouč cykloreduktoru N 40 < 3 s, šnekové kolo z 30 < 10 s", async () => {
    expect(await timed("gear.sprocket", { chain: "08B", z: 60, rows: 3 })).toBeLessThan(5000);
    expect(await timed("gear.cyclodisc", { N: 40, pinCircle: 120, pinD: 6, e: 1 })).toBeLessThan(3000);
    expect(await timed("gear.wormwheel", {})).toBeLessThan(10_000);
  }, 120_000);
  it("matematika (kontrola + výpočet + profil) pro živý náhled < 5 ms", () => {
    for (const [ext, data] of [["gear.spur", { z: 24 }], ["gear.helical", { z: 60 }], ["gear.sprocket", { z: 19 }], ["gear.cycloid", {}], ["gear.hypoid", {}]] as const) {
      gearValidate(ext, data);
      gearProfile(ext, data);
      const t = performance.now();
      for (let k = 0; k < 20; k++) {
        gearValidate(ext, data);
        gearProfile(ext, data);
      }
      const ms = (performance.now() - t) / 20;
      console.info(`výkon matematiky ${ext}: ${ms.toFixed(2)} ms`);
      expect(ms, ext).toBeLessThan(5);
    }
  });
});
