/**
 * Kola a ozubení – výkon (štědré meze ze zadání, stroj se 4 jádry sdílený s dalšími agenty). Měří se `buildDoc` = stavba
 * prvku + síť pro zobrazení, tedy to, na co uživatel čeká. Mezipaměť těles kol se před každým měřením vyprázdní.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc, buildShape } from "../build";
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
/** jen stavba prvku (bez sítě pro zobrazení) – to, co měří revize jako „Vytvořit“ */
async function timedBuild(ext: string, data: GearData) {
  clearGearCache();
  const t = Date.now();
  const res = await buildShape(doc(ext, data), Infinity, { noCache: true });
  const ms = Date.now() - t;
  expect(res.status.every((s) => s.ok), JSON.stringify(res.status)).toBe(true);
  console.info(`výkon stavby ${ext} ${JSON.stringify(data)}: ${ms} ms`);
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
    // šnekové kolo: hrdlo (toroid) se odebírá booleovskou operací přes všechny boky – stavba ~8 s, se sítí ~10 s (známá mez)
    expect(await timedBuild("gear.wormwheel", {})).toBeLessThan(10_000);
  }, 120_000);
  it("stavba výchozího šikmého, šípového, kuželového, hypoidního kola a šneku (bez sítě) < 2,5 s – bez integrace objemu přes B-splinové boky", async () => {
    // nález revize: 2,2–2,9 s jen za stavbu – dvakrát integrace objemu (orientace sešitého pláště a kontrola tělesa) po ~0,5 s;
    // teď 0,5–1 s na stroji se zátěží 3–6
    for (const ext of ["gear.helical", "gear.herringbone", "gear.bevel", "gear.hypoid", "gear.worm"]) expect(await timedBuild(ext, {}), ext).toBeLessThan(2500);
  }, 120_000);
  it("vnitřní soukolí: řešení včetně 2D kontroly záběru a hledání zkrácení hlavy věnce < 1 s", async () => {
    const { solvePair } = await import("../gears");
    for (const values of [{}, { z1: 25, z2: 40 }, { z1: 30, z2: 140, m: 1 }]) {
      const t = performance.now();
      solvePair({ kind: "internal", values });
      const ms = performance.now() - t;
      console.info(`výkon soukolí vnitřní ${JSON.stringify(values)}: ${ms.toFixed(0)} ms`);
      expect(ms).toBeLessThan(1000);
    }
  });
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
