/**
 * Měření otevření velké sestavy STEP v Node (diagnostika chyby „sestava 46 MB se otevře, ale nic není vidět“).
 * Běží jen se souborem v proměnné BIG (běžná sada testů ho přeskočí):
 *   node scripts/gen-big-step.mjs --mb 46 --out /tmp/mn-big-46.step
 *   BIG=/tmp/mn-big-46.step npx vitest run src/cad/formats/step-big.measure.test.ts           (nová cesta: rozdělení na díly)
 *   BIG=/tmp/mn-big-46.step OLD=1 npx vitest run src/cad/formats/step-big.measure.test.ts     (+ původní cesta: celý soubor jako jedno těleso)
 *   MEASURE_OUT=/tmp/measure.log … = výsledky i do souboru (vitest výpis konzole u úspěšných testů nemusí ukázat)
 */
import path from "node:path";
import fs from "node:fs";
import { it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { closure, extractProduct, hasGeometry, indexStep, stepTree } from "./step-tree";
import { putBlob } from "../blobs";
import { partEntry } from "../asm-kernel";
import { MESH_ANGULAR, meshTolerance } from "../fastbool";

const BIG = process.env.BIG;
type OcAny = { wasmMemory?: { buffer: ArrayBuffer } };
let oc: OcAny | null = null;
async function kernel() {
  if (oc) return oc;
  oc = (await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  })) as OcAny;
  r.setOC(oc as never);
  return oc;
}
const heap = () => Math.round((oc?.wasmMemory?.buffer.byteLength ?? 0) / 1048576);
const lapper = () => {
  let t = Date.now();
  return (s: string) => {
    const line = `${s}: ${Date.now() - t} ms, WASM ${heap()} MB`;
    console.log(line);
    if (process.env.MEASURE_OUT) fs.appendFileSync(process.env.MEASURE_OUT, line + "\n");
    t = Date.now();
  };
};

it.skipIf(!BIG || !process.env.OLD)("původní cesta: celý soubor jako jedno těleso (importSTEP, přesný kvádr, síť, objem, plocha)", async () => {
  await kernel();
  const buf = new Uint8Array(fs.readFileSync(BIG!));
  const lap = lapper();
  const b64 = Buffer.from(buf).toString("base64");
  lap(`base64 ${(b64.length / 1048576).toFixed(1)} MB`);
  JSON.stringify({ features: [{ type: "import", data: b64 }] });
  lap("JSON.stringify prvku (klíč mezipaměti, historie)");
  const s = (await r.importSTEP(new Blob([buf as BlobPart]))) as r.Shape3D;
  lap(`importSTEP (čtení + přenos), ploch ${s.faces.length}`);
  r.measureVolume(s);
  lap("podpis (objem)");
  const bb = s.boundingBox.bounds;
  const diag = Math.hypot(bb[1][0] - bb[0][0], bb[1][1] - bb[0][1], bb[1][2] - bb[0][2]);
  lap(`přesný obalový kvádr (úhlopříčka ${diag.toFixed(0)} mm)`);
  const m = s.mesh({ tolerance: meshTolerance(diag), angularTolerance: MESH_ANGULAR });
  lap(`síť ${m.triangles.length / 3} trojúhelníků (tolerance ${meshTolerance(diag).toFixed(2)})`);
  r.measureVolume(s);
  r.measureArea(s);
  lap("objem + plocha");
}, 3_600_000);

it.skipIf(!BIG)("nová cesta: strom výrobku, díly jako samostatné STEP, lehká síť dílů", async () => {
  await kernel();
  const buf = new Uint8Array(fs.readFileSync(BIG!));
  const lap = lapper();
  const ix = indexStep(buf);
  lap(`index ${ix.count} entit (úplný ${ix.complete}, schéma ${ix.schema})`);
  const tree = stepTree(ix)!;
  lap(`strom: ${tree.products.size} výrobků, ${tree.leafInstances} výskytů dílů`);
  const parts: { name: string; bytes: Uint8Array }[] = [];
  for (const p of tree.products.values()) {
    if (p.children.length) continue;
    const ids = closure(ix, p.geomRoots);
    if (hasGeometry(ix, ids)) parts.push({ name: p.name, bytes: extractProduct(ix, p, ids) });
  }
  lap(`vyříznuto ${parts.length} dílů, ${(parts.reduce((s, p) => s + p.bytes.length, 0) / 1048576).toFixed(1)} MB`);
  let tris = 0;
  let worst = { ms: 0, name: "" };
  let failed = 0;
  for (const [i, p] of parts.entries()) {
    const t1 = Date.now();
    const e = await partEntry(`k${i}`, { kind: "file", fileName: `${p.name}.step`, format: "step", data: putBlob(p.bytes) });
    const ms = Date.now() - t1;
    if (ms > worst.ms) worst = { ms, name: `${p.name} ${(p.bytes.length / 1024).toFixed(0)} kB` };
    tris += (e.result.mesh?.triangles.length ?? 0) / 3;
    if (!e.result.mesh || e.result.status.some((s) => !s.ok)) failed++;
  }
  lap(`všechny díly v jádře: ${tris} trojúhelníků, nejdelší ${worst.ms} ms (${worst.name}), selhalo ${failed}`);
}, 3_600_000);
