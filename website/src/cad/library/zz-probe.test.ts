import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "../build";
import { LIBRARY, defaults, familyById, withDefaults } from "./index";
const OUT = "/tmp/claude-0/-home-user-Mnastrojarna-center/44f60c59-94c0-5e2a-b8ba-b2db005ec964/scratchpad/build-probe.txt";
const ROWS: [string, Record<string, string | number | boolean>][] = [
["gearHelical", { mn: "3", z: 16, beta: 20, hand: "L", b: 25, bore: 15 }],
["gearBevel", { m: "2.5", z: 24, b: 15, bore: 12 }],
["worm", { m: "3", starts: 2, l: 50, shaft: 12, shaftL: 40 }],
["wormWheel", { m: "3", z: 24, bore: 12 }],
["bearingTapered", { code: "32208" }],
["bearingTapered", { code: "30203", rollers: false }],
["bearingThrust", { code: "51208" }],
["bearingNeedle", { code: "HK0608" }],
["ucp", { code: "UCP210" }],
["bushing", { d: "40", l: 50, collar: true }],
["iso7045", { size: "M2.5", l: 6 }],
["iso7046", { size: "M8", l: 40 }],
["din985", { size: "M3" }],
["din985", { size: "M24" }],
["din6923", { size: "M12", serr: true }],
["din315", { size: "M12" }],
["din127", { size: "M20" }],
["din6798", { size: "M3" }],
["din7349", { size: "M16" }],
["din938", { size: "M20", l: 80 }],
["din939", { size: "M6", l: 30 }],
["din580", { size: "M30" }],
["din660", { d: "8", l: 30 }],
["din7981", { size: "ST2.9", l: 9.5 }],
["iso2339", { d: "10", l: 80 }],
["din1473", { d: "3", l: 16 }],
["din1474", { d: "12", l: 60 }],
["din6888", { size: "6x19" }],
["din1444", { d: "25", l: 100 }],
["din1443", { d: "6", l: 30, groove: false }],
["iso1234", { d: "8", l: 63 }],
["springExt", { d: 3, D: 25, L: 80, n: 15 }],
["springTorsion", { d: 1, D: 10, n: 8, leg: 20, angle: 180 }],
["din2093", { size: "B-40x20.4x1.5", count: 4, stack: "series" }],
["din2093", { size: "A-50x25.4x3", count: 2, stack: "parallel" }],
["gasstrut", { size: "14/28", stroke: 250, extended: false }],
["tslot", { size: "20x20", l: 200 }],
["tslot", { size: "40x80", l: 300 }],
["tslot", { size: "45x45", l: 100, core: false }],
["tnut", { slot: "10", thread: "M10", l: 25 }],
["alubracket", { size: "20" }],
["hgr", { size: "35", l: 1000 }],
["hgh", { size: "15" }],
["hgw", { size: "35" }],
["sfu", { size: "3210", l: 1200, nutPos: 400 }],
["sfu", { size: "1204", l: 200, ends: false }],
["shaftW", { size: "40", l: 1500 }],
["shf", { size: "8" }],
["lm", { size: "40" }],
["scuu", { size: "8" }],
["cyl15552", { bore: "125", stroke: 500, extended: true }],
["cyl15552", { bore: "32", stroke: 25 }],
["cyl6432", { bore: "8", stroke: 10, extended: true }],
["pushfit", { tube: "4", thread: "M5" }],
["pipeR", { size: "4", l: 300 }],
["pipeR", { size: "1 1/4", l: 500 }],
["flangePN16", { dn: "DN200", type: "01" }],
["flangePN16", { dn: "DN15", type: "05" }],
["flangePN16", { dn: "DN100", type: "11" }],
["hosebarb", { thread: "G1", hose: 25 }],
["mPillarZ01", { d: "60", l: 400 }],
["mBushZ11", { d: "12", l: 25 }],
["mEjectorSleeve", { d: "20", di: 12, l: 400 }],
["mFlatEjector", { size: "5x16", d: "20", l: 300, lf: 100 }],
["mAngledPin", { d: "30", l: 250, angle: "25" }],
["mCoolingPlug", { thread: "G3/8", hose: "13" }],
["mDateStamp", { d: "20", l: 40 }],
];
beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"), print: () => undefined, printErr: () => undefined });
  r.setOC(oc as never);
}, 60000);
it("probe", async () => {
  writeFileSync(OUT, "");
  const from = LIBRARY.findIndex((f) => f.id === "iso7045");
  const jobs: [string, ReturnType<typeof defaults>][] = [...LIBRARY.slice(from).map((f) => [f.id, defaults(f)] as [string, ReturnType<typeof defaults>]), ...ROWS.map(([id, v]) => [id, withDefaults(familyById(id)!, v)] as [string, ReturnType<typeof defaults>])];
  for (const [id, v] of jobs) {
    const doc = familyById(id)!.make(v);
    const t0 = Date.now();
    const res = await buildDoc(doc);
    const bad = res.status.filter((s) => !s.ok).map((s) => doc.features.find((x) => x.id === s.id)?.name + ": " + s.error?.slice(0, 40));
    appendFileSync(OUT, [bad.length ? "FAIL" : "ok  ", String(Date.now() - t0).padStart(5), id, doc.name, "vol", res.metrics?.volume?.toFixed(0), bad.join(" | ")].join("  ") + "\n");
  }
}, 600000);
