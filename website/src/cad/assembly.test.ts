import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { assemblyShape, interference, partEntry } from "./asm-kernel";
import { alignFaces, apply3, asmComponent, bomCsv, composePlacement, compressionSpring, computeBom, dissolveSubassembly, dowelISO8734, emptyAssembly, eulerXYZ, flattenAssembly, makeSubassembly, moldBase, nutISO4032, partComponent, rotMatrix, screwDIN912, screwISO4762, sourceKey, transformPoint, washerISO7089 } from "./assembly";
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

describe("podsestavy", () => {
  const sub = (): CadDoc => ({ ...emptyAssembly("Pod"), components: [partComponent(cube("A"), { position: [10, 0, 0] }), partComponent(cube("A"), { position: [20, 0, 0] })] });
  it("zploštění skládá umístění přes úrovně", () => {
    const top: CadDoc = { ...emptyAssembly("Top"), components: [asmComponent(sub(), { position: [0, 0, 100], rotation: [0, 0, 90] }), partComponent(cube("B"))] };
    const flat = flattenAssembly(top);
    expect(flat).toHaveLength(3);
    const p = transformPoint(flat[0].placement, [0, 0, 0]);
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(10, 6);
    expect(p[2]).toBeCloseTo(100, 6);
    expect(flat[0].path).toHaveLength(2);
    expect(flat[0].path[0]).toBe(top.components![0].id);
    const c = composePlacement({ position: [1, 2, 3], rotation: [0, 0, 0] }, { position: [1, 1, 1], rotation: [0, 0, 0] });
    expect(c.position).toEqual([2, 3, 4]);
  });
  it("kusovník plochý (násobí počty) i strukturovaný (podsestava + díly)", () => {
    const s1 = sub();
    const top: CadDoc = { ...emptyAssembly("Top"), components: [asmComponent(s1), asmComponent(s1, { position: [0, 50, 0] }), partComponent(cube("B"))] };
    const info = () => ({ material: "Ocel", massKg: 1 });
    const flat = computeBom(top, info);
    expect(flat.find((r) => r.name === "A")?.qty).toBe(4);
    expect(flat.find((r) => r.name === "B")?.qty).toBe(1);
    const st = computeBom(top, info, { structured: true });
    const subRow = st.find((r) => r.assembly);
    expect(subRow?.qty).toBe(2);
    expect(subRow?.massKg).toBe(2);
    expect(st.find((r) => r.name === "A")?.level).toBe(1);
    expect(st.find((r) => r.name === "A")?.qty).toBe(2);
  });
  it("vytvořit a rozpustit podsestavu se zachováním světové polohy", () => {
    const top: CadDoc = { ...emptyAssembly("Top"), components: [partComponent(cube("A"), { position: [5, 0, 0], rotation: [0, 0, 30] }), partComponent(cube("B"), { position: [0, 7, 0] }), partComponent(cube("C"))] };
    const before = flattenAssembly(top).map((f) => transformPoint(f.placement, [1, 2, 3]));
    const { doc: made, id } = makeSubassembly(top, [top.components![0].id, top.components![1].id], "Sub");
    expect(made.components).toHaveLength(2);
    expect(made.components!.find((c) => c.id === id)?.source.kind).toBe("asm");
    const moved = { ...made, components: made.components!.map((c) => (c.id === id ? { ...c, placement: { position: [0, 0, 40] as [number, number, number], rotation: [90, 0, 0] as [number, number, number] } } : c)) };
    const worldMoved = flattenAssembly(moved).map((f) => transformPoint(f.placement, [1, 2, 3]));
    const back = dissolveSubassembly(moved, id);
    expect(back.components).toHaveLength(3);
    flattenAssembly(back).forEach((f, i) => {
      const w = transformPoint(f.placement, [1, 2, 3]);
      const exp = worldMoved.find((x) => Math.hypot(x[0] - w[0], x[1] - w[1], x[2] - w[2]) < 1e-6);
      expect(exp, `bod ${i}`).toBeDefined();
    });
    // před přesunem se světové polohy nezmění
    const same = flattenAssembly(made).map((f) => transformPoint(f.placement, [1, 2, 3]));
    for (const b of before) expect(same.some((x) => Math.hypot(x[0] - b[0], x[1] - b[1], x[2] - b[2]) < 1e-6)).toBe(true);
  });
  it("vnořená sestava: těleso a kolize uvnitř podsestavy", async () => {
    const s1: CadDoc = { ...emptyAssembly("Pod"), components: [partComponent(cube("A")), partComponent(cube("B"), { position: [5, 0, 0] })] };
    const top: CadDoc = { ...emptyAssembly("Top"), components: [asmComponent(s1, { position: [0, 0, 50] }), partComponent(cube("C"), { position: [0, 0, 300] })] };
    const shape = await assemblyShape(top);
    expect(r.measureVolume(shape!)).toBeCloseTo(3000, 0);
    const res = await interference(top);
    expect(res).toHaveLength(1);
    expect(res[0].aPath).toHaveLength(2);
    expect(res[0].a).toBe(top.components![0].id);
  }, 60_000);
  it("cyklus/hloubka – klíč zdroje se neuvaří", () => {
    const a: CadDoc = { ...emptyAssembly("A"), components: [] };
    let d = a;
    for (let i = 0; i < 20; i++) d = { ...emptyAssembly(`L${i}`), components: [asmComponent(d)] };
    expect(typeof sourceKey({ kind: "asm", doc: d })).toBe("string");
  });
});

describe("normálie", () => {
  it("podložka, matice, kolík, DIN 912, pružina se postaví", async () => {
    for (const d of [washerISO7089("M8"), nutISO4032("M10"), dowelISO8734(6, 30), screwDIN912("M8", 30), compressionSpring(20, 2, 40, 8)]) {
      const e = await partEntry(sourceKey({ kind: "part", doc: d }), { kind: "part", doc: d });
      const bad = e.result.status.filter((s) => !s.ok);
      expect(bad, `${d.name}: ${bad.map((b) => b.error).join(",")}`).toEqual([]);
      expect(e.result.metrics?.volume ?? 0).toBeGreaterThan(0);
    }
    const w = await partEntry("w", { kind: "part", doc: washerISO7089("M8") });
    expect(w.result.metrics!.volume).toBeCloseTo((Math.PI / 4) * (16 * 16 - 8.4 * 8.4) * 1.6, 1);
  }, 120_000);
});
