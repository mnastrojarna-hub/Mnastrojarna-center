/**
 * Lehký režim sestav STEP (splitStepAssembly): tělesa, která nejsou listy stromu výrobku, se nesmí ztratit.
 *  – sestava s vlastním tělesem vedle výskytů dětí (kořenová komponenta Fusion 360 s tělesy),
 *  – samostatný výrobek mimo strom sestavy (není v žádném NEXT_ASSEMBLY_USAGE_OCCURRENCE).
 * Měřítkem je přečtení celého souboru jádrem (importSTEPBody): součet objemů komponent = objem celku.
 * Základ: skutečný soubor z NX (src/lib/__fixtures__/cube.stp, krychle 300 mm = 27e6 mm³) se dvěma výskyty v kořeni.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { BLOB_PREFIX, blobId, putBlob, putBlobAs } from "../blobs";
import { partEntry } from "../asm-kernel";
import { buildDoc } from "../build";
import type { CadDoc } from "../types";
import { importSTEPBody } from "./kernel-import";
import { assemblyDocFromSplit, leafCount, splitStepAssembly } from "./step-assembly";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 120_000);

const cube = fs.readFileSync(path.resolve(__dirname, "../../lib/__fixtures__/cube.stp"), "latin1");
const data = cube.slice(cube.indexOf("DATA;") + 5, cube.lastIndexOf("ENDSEC;"));
const head = cube.slice(0, cube.indexOf("DATA;") + 5);
const shift = (s: string, k: number) => s.replace(/#(\d+)/g, (_, n) => `#${Number(n) + k}`);
const file = (body: string) => new TextEncoder().encode(`${head}\n${body}\nENDSEC;\nEND-ISO-10303-21;\n`);

// kořen ROOT: dva výskyty krychle (PD #14, reprezentace #22, umístění #126), druhý posunutý o 100 mm v X
const ROOT = `
#1001=PRODUCT('ROOT','ROOT','',(#19));
#1002=PRODUCT_DEFINITION_FORMATION('','',#1001);
#1003=PRODUCT_DEFINITION('design','',#1002,#15);
#1004=PRODUCT_DEFINITION_SHAPE('','',#1003);
#1005=SHAPE_DEFINITION_REPRESENTATION(#1004,#1006);
#1007=AXIS2_PLACEMENT_3D('',#1008,$,$);
#1008=CARTESIAN_POINT('',(0.,0.,0.));
#1010=AXIS2_PLACEMENT_3D('',#1011,$,$);
#1011=CARTESIAN_POINT('',(100.,0.,0.));
#1020=NEXT_ASSEMBLY_USAGE_OCCURRENCE('1','a','',#1003,#14,$);
#1021=NEXT_ASSEMBLY_USAGE_OCCURRENCE('2','b','',#1003,#14,$);
#1022=PRODUCT_DEFINITION_SHAPE('','',#1020);
#1023=PRODUCT_DEFINITION_SHAPE('','',#1021);
#1006=SHAPE_REPRESENTATION('root',(#1007,#1010),#187);
#1024=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#1026,#1022);
#1025=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#1027,#1023);
#1026=( REPRESENTATION_RELATIONSHIP('','',#22,#1006) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#1028) SHAPE_REPRESENTATION_RELATIONSHIP() );
#1027=( REPRESENTATION_RELATIONSHIP('','',#22,#1006) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#1029) SHAPE_REPRESENTATION_RELATIONSHIP() );
#1028=ITEM_DEFINED_TRANSFORMATION('','',#126,#1007);
#1029=ITEM_DEFINED_TRANSFORMATION('','',#126,#1010);
`;
// vlastní těleso kořene: posunutá kopie geometrie krychle bez jejího výrobku, připojená k reprezentaci kořene (SRR)
const OWN =
  shift(data, 5000)
    .split(/;\s*\n/)
    .filter((st) => !/^\s*#50(10|12|13|14|16|17|18)\s*=/.test(st))
    .join(";\n") + ";\n#1040=SHAPE_REPRESENTATION_RELATIONSHIP('','',#1006,#5011);\n";
// samostatný výrobek „loose“ mimo strom sestavy
const LOOSE = shift(data, 5000).replace("PRODUCT('cube','cube'", "PRODUCT('loose','loose'");

const wholeVolume = (b: Uint8Array) => r.measureVolume(importSTEPBody(b, "x.step"));
async function splitVolume(b: Uint8Array) {
  const split = splitStepAssembly(b)!;
  expect(split).not.toBeNull();
  const refs = new Map(split.parts.map((p) => [p.pd, putBlob(p.bytes)]));
  const doc = assemblyDocFromSplit(split, "x.step", (pd) => refs.get(pd)!);
  let v = 0;
  const names: string[] = [];
  const walk = async (d: CadDoc) => {
    for (const c of d.components ?? []) {
      if (c.source.kind === "asm") await walk(c.source.doc);
      else if (c.source.kind === "file") {
        const e = await partEntry(`own-test:${c.source.data}`, c.source);
        expect(e.result.status.every((s) => s.ok)).toBe(true);
        v += r.measureVolume(e.body!);
        names.push(c.name);
      }
    }
  };
  await walk(doc);
  return { split, doc, v, names };
}

describe("lehký režim sestavy STEP: žádné ztracené těleso", () => {
  it("sestava s vlastním tělesem vedle výskytů dětí → komponenta „vlastní tělesa“ v počátku sestavy", async () => {
    const b = file(data + ROOT + OWN);
    const whole = wholeVolume(b);
    expect(whole).toBeCloseTo(81e6, -3); // 3 krychle
    const { split, doc, v, names } = await splitVolume(b);
    expect(leafCount(doc)).toBe(3);
    expect(v / whole).toBeCloseTo(1, 6);
    expect(split.parts.filter((p) => p.own).map((p) => p.name)).toEqual(["ROOT"]);
    expect(names.filter((n) => /vlastní tělesa/.test(n))).toHaveLength(1);
    const ownComp = doc.components!.find((c) => /vlastní tělesa/.test(c.name))!;
    expect(ownComp.placement).toEqual({ position: [0, 0, 0], rotation: [0, 0, 0] });
    expect(split.empty).toEqual([]);
  }, 120_000);

  it("samostatný výrobek mimo strom sestavy → další kořen v počátku", async () => {
    const b = file(data + ROOT + LOOSE);
    const whole = wholeVolume(b);
    expect(whole).toBeCloseTo(81e6, -3);
    const { split, doc, v, names } = await splitVolume(b);
    expect(leafCount(doc)).toBe(3);
    expect(v / whole).toBeCloseTo(1, 6);
    expect(names).toContain("loose");
    expect(split.empty).toEqual([]);
    expect(doc.components!.map((c) => c.source.kind).sort()).toEqual(["asm", "file"]);
  }, 120_000);

  it("bez vlastních těles a samostatných výrobků zůstává dokument jako dřív (kořen = sestava, 2 výskyty)", async () => {
    const b = file(data + ROOT);
    const { split, doc, v } = await splitVolume(b);
    expect(split.parts.map((p) => p.name)).toEqual(["cube"]);
    expect(doc.name).toBe("ROOT");
    expect(doc.components!.map((c) => c.placement.position[0]).sort((a, c) => a - c)).toEqual([0, 100]);
    expect(v).toBeCloseTo(54e6, -3);
  }, 120_000);
});

describe("jádro: import bez dat v paměti se nezapamatuje", () => {
  it("dokument / komponenta s odkazem, jehož data dorazí až s dalším požadavkem, se pak postaví (mezipaměť nedrží selhání)", async () => {
    const bytes = new TextEncoder().encode(cube.replace("ENDSEC;\nEND-ISO", "/* mezipamet */\nENDSEC;\nEND-ISO"));
    const id = blobId(bytes);
    const ref = BLOB_PREFIX + id;
    const doc: CadDoc = { app: "mnastrojarna-cad", version: 2, name: "D", material: "ocel", features: [{ id: "imp", name: "Import", type: "import", fileName: "c.step", format: "step", data: ref }] };
    const r1 = await buildDoc(doc);
    expect(r1.status[0].ok).toBe(false);
    expect(r1.status[0].error).toMatch(/nejsou v paměti/);
    const src = { kind: "file" as const, fileName: "c.step", format: "step" as const, data: ref };
    const e1 = await partEntry(`miss:${id}`, src);
    expect(e1.body).toBeNull();
    putBlobAs(id, bytes); // data dorazila (jako s další zprávou UI → jádro)
    const r2 = await buildDoc(doc);
    expect(r2.status[0].ok).toBe(true);
    expect(r2.metrics!.volume).toBeCloseTo(27e6, -3);
    const e2 = await partEntry(`miss:${id}`, src);
    expect(e2.body).not.toBeNull();
  }, 120_000);
});
