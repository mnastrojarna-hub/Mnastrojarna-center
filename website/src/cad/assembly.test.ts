import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { assemblyShape, interference, partEntry } from "./asm-kernel";
import { alignFaces, apply3, bomCsv, computeBom, eulerXYZ, moldBase, partComponent, rotMatrix, screwISO4762, sourceKey, transformPoint } from "./assembly";
import { emptyDoc, type CadDoc } from "./types";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

const cube = (name = "Kostka", s = 10): CadDoc => ({ ...emptyDoc(name), features: [{ id: "b", name: "Kvádr", type: "box", size: [s, s, s], position: [0, 0, 0], centered: true, mode: "new" }] });

describe("matice a vazby", () => {
  it("Euler XYZ ↔ matice", () => {
    const e: [number, number, number] = [30, -20, 75];
    const back = eulerXYZ(rotMatrix(e));
    back.forEach((v, i) => expect(v).toBeCloseTo(e[i], 6));
  });
  it("Kontakt: horní plocha kostky A na spodní plochu kostky B", () => {
    // kostka 10 mm: lokální horní plocha z=+5, normála +Z; cíl: plocha z=100 s normálou −Z
    const p = alignFaces({ position: [3, 4, 0], rotation: [0, 0, 0] }, { origin: [0, 0, 5], normal: [0, 0, 1] }, { origin: [0, 0, 100], normal: [0, 0, -1] }, "mate");
    expect(transformPoint(p, [0, 0, 5])[2]).toBeCloseTo(100, 6);
    expect(p.position[0]).toBeCloseTo(3, 6); // v rovině se nehýbe
    const n = apply3(rotMatrix(p.rotation), [0, 0, 1]);
    expect(n[2]).toBeCloseTo(1, 6);
  });
  it("Kontakt s otočením a vystředění", () => {
    const p = alignFaces({ position: [0, 0, 0], rotation: [0, 0, 0] }, { origin: [0, 0, 5], normal: [0, 0, 1] }, { origin: [50, 0, 20], normal: [1, 0, 0] }, "center");
    const n = apply3(rotMatrix(p.rotation), [0, 0, 1]);
    expect(n[0]).toBeCloseTo(-1, 6);
    const o = transformPoint(p, [0, 0, 5]);
    expect(o[0]).toBeCloseTo(50, 6);
    expect(o[2]).toBeCloseTo(20, 6);
  });
});

describe("sestava", () => {
  it("stejné díly sdílí klíč a sčítají se v kusovníku", () => {
    const s = screwISO4762("M8", 30);
    const a = { ...emptyDoc("S"), kind: "assembly" as const, components: [partComponent(s), partComponent(s), partComponent(cube())] };
    expect(sourceKey(a.components[0].source)).toBe(sourceKey(a.components[1].source));
    const bom = computeBom(a, () => ({ material: "Ocel", massKg: 0.1 }));
    expect(bom.find((b) => b.name.startsWith("Šroub"))?.qty).toBe(2);
    expect(bomCsv(bom)).toContain("Pozice;Název");
  });
  it("kolize dvou překrývajících se kostek", async () => {
    const a: CadDoc = {
      ...emptyDoc("K"),
      kind: "assembly",
      components: [partComponent(cube("A"), { position: [0, 0, 0] }), partComponent(cube("B"), { position: [5, 0, 0] }), partComponent(cube("C"), { position: [100, 0, 0] })],
    };
    const res = await interference(a);
    expect(res).toHaveLength(1);
    expect(res[0].volume).toBeCloseTo(500, 0);
    const shape = await assemblyShape(a);
    expect(shape).not.toBeNull();
  }, 60_000);
  it("rám formy – všechny díly se postaví bez chyb", async () => {
    const mb = moldBase();
    expect(mb.components!.length).toBeGreaterThan(20);
    const seen = new Set<string>();
    for (const c of mb.components!) {
      const k = sourceKey(c.source);
      if (seen.has(k)) continue;
      seen.add(k);
      const e = await partEntry(k, c.source);
      const bad = e.result.status.filter((s) => !s.ok);
      expect(bad, `${c.name}: ${bad.map((b) => (c.source.kind === "part" ? c.source.doc.features.find((f) => f.id === b.id)?.name : "") + " – " + b.error).join(", ")}`).toEqual([]);
      expect(e.result.metrics?.volume ?? 0).toBeGreaterThan(0);
    }
    const bom = computeBom(mb, () => ({}));
    expect(bom.some((b) => b.name === "Rozpěrka" && b.qty === 2)).toBe(true);
    expect(bom.some((b) => b.name.startsWith("Vodicí sloupek") && b.qty === 4)).toBe(true);
  }, 180_000);
});
