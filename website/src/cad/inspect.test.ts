import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { flattenLeaves, dissolveSubassembly, makeSubassembly, matrixToPlacement, mul4, invPlacementMatrix } from "../components/cad/asm-flatten";
import { partComponent, placementMatrix } from "./assembly";
import { entityInfo, matrixPlacement, measureEntities, vertexPositions } from "./inspect";
import { emptyDoc, type CadDoc } from "./types";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

describe("inspektor entit", () => {
  it("plocha, hrana, bod, těleso kvádru", () => {
    const box = r.makeBox([0, 0, 0], [20, 10, 5]) as r.Shape3D;
    const v = vertexPositions(box);
    expect(v.length / 3).toBe(8);
    const fi = box.faces.findIndex((f) => Math.abs(f.center.z - 5) < 1e-6);
    const face = entityInfo(box, { kind: "face", index: fi });
    expect(face.surface).toBe("PLANE");
    expect(face.area).toBeCloseTo(200, 6);
    expect(face.normal![2]).toBeCloseTo(1, 6);
    const edge = entityInfo(box, { kind: "edge", index: 0 });
    expect(edge.curve).toBe("LINE");
    expect([5, 10, 20]).toContain(Math.round(edge.length!));
    const body = entityInfo(box, { kind: "body" }, 7.85);
    expect(body.rows[0][1]).toContain("1");
  });
  it("válec: poloměr a osa, hrana kružnice", () => {
    const cyl = r.makeCylinder(12.5, 30) as r.Shape3D;
    const fi = cyl.faces.findIndex((f) => f.geomType === "CYLINDRE");
    const info = entityInfo(cyl, { kind: "face", index: fi });
    expect(info.radius).toBeCloseTo(12.5, 6);
    expect(Math.abs(info.axis!.dir[2])).toBeCloseTo(1, 6);
    const ei = cyl.edges.findIndex((e) => e.geomType === "CIRCLE");
    expect(entityInfo(cyl, { kind: "edge", index: ei }).radius).toBeCloseTo(12.5, 6);
  });
  it("měření: vzdálenost rovnoběžných ploch, úhel kolmých ploch", () => {
    const box = r.makeBox([0, 0, 0], [20, 10, 5]) as r.Shape3D;
    const top = box.faces.findIndex((f) => Math.abs(f.center.z - 5) < 1e-6);
    const bot = box.faces.findIndex((f) => Math.abs(f.center.z) < 1e-6);
    const side = box.faces.findIndex((f) => Math.abs(f.center.x) < 1e-6);
    const m = measureEntities(box, { kind: "face", index: top }, box, { kind: "face", index: bot });
    expect(m.distance).toBeCloseTo(5, 6);
    expect(m.angle).toBeCloseTo(180, 4);
    const m2 = measureEntities(box, { kind: "face", index: top }, box, { kind: "face", index: side });
    expect(m2.angle).toBeCloseTo(90, 4);
    const m3 = measureEntities(box, { kind: "point", point: [0, 0, 20] }, box, { kind: "body" });
    expect(m3.distance).toBeCloseTo(15, 6);
  });
});

describe("podsestavy", () => {
  const cube = (n: string): CadDoc => ({ ...emptyDoc(n), features: [{ id: "b", name: "K", type: "box", size: [10, 10, 10], position: [0, 0, 0], centered: true, mode: "new" }] });
  it("matice ↔ umístění, inverze", () => {
    const p = { position: [10, -5, 3] as [number, number, number], rotation: [30, 45, -60] as [number, number, number] };
    const back = matrixPlacement(placementMatrix(p));
    back.position.forEach((v, i) => expect(v).toBeCloseTo(p.position[i], 6));
    back.rotation.forEach((v, i) => expect(v).toBeCloseTo(p.rotation[i], 6));
    const id = mul4(invPlacementMatrix(p), placementMatrix(p));
    [0, 5, 10, 15].forEach((i) => expect(id[i]).toBeCloseTo(1, 9));
    expect(id[12]).toBeCloseTo(0, 9);
  });
  it("vytvořit a rozpustit podsestavu zachová světové polohy", () => {
    const a = partComponent(cube("A"), { position: [10, 0, 0], rotation: [0, 0, 90] });
    const b = partComponent(cube("B"), { position: [0, 20, 0] });
    const c = partComponent(cube("C"), { position: [0, 0, 30] });
    let asm: CadDoc = { ...emptyDoc("S"), kind: "assembly", components: [a, b, c] };
    const before = flattenLeaves(asm).map((l) => l.matrix);
    asm = makeSubassembly(asm, [a.id, b.id], "Pod");
    expect(asm.components).toHaveLength(2);
    // posun podsestavy
    asm = { ...asm, components: asm.components!.map((x) => (x.source.kind === "asm" ? { ...x, placement: { position: [5, 5, 5], rotation: [0, 0, 0] } } : x)) };
    const leaves = flattenLeaves(asm);
    expect(leaves).toHaveLength(3);
    expect(leaves.find((l) => l.comp.id === a.id)!.matrix[12]).toBeCloseTo(15, 9);
    asm = dissolveSubassembly(asm, asm.components!.find((x) => x.source.kind === "asm")!.id);
    expect(asm.components).toHaveLength(3);
    const pa = matrixToPlacement(flattenLeaves(asm).find((l) => l.comp.id === a.id)!.matrix);
    expect(pa.position[0]).toBeCloseTo(15, 6);
    expect(pa.rotation[2]).toBeCloseTo(90, 6);
    expect(before).toHaveLength(3);
  });
});
