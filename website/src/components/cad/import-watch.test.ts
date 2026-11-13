import { describe, expect, it } from "vitest";
import { putBlob } from "@/cad/blobs";
import type { BuildResult, ComponentSource } from "@/cad/types";
import { asmImportOutcome, chunkParts, fileComponentAsPart, partImportOutcome, type PendingImport } from "./import-watch";

const mesh = (tris: number) => ({ vertices: new Float32Array(9), normals: new Float32Array(9), triangles: new Uint32Array(tris * 3), faceGroups: new Int32Array(0), lines: new Float32Array(0), edgeGroups: new Int32Array(0) });
const res = (o: Partial<BuildResult>): BuildResult => ({ status: [], mesh: null, metrics: null, ms: 1, ...o });
const P: PendingImport = { docId: "d", name: "stroj.step", t0: Date.now() - 2500, kind: "part", featureId: "imp", bytes: 1 };

describe("hlášení výsledku otevření souboru", () => {
  it("úspěch až s geometrií; chyba prvku Import a prázdný výsledek jsou chyby", () => {
    const ok = partImportOutcome(res({ status: [{ id: "imp", ok: true }], mesh: mesh(1200) }), P);
    expect(ok.ok && ok.text).toMatch(/Model stroj.step zobrazen za 2[,.]5 s \(1[\s ]?200 trojúhelníků\)/);
    const bad = partImportOutcome(res({ status: [{ id: "imp", ok: false, error: "Soubor a.step je neúplný" }] }), P);
    expect(!bad.ok && bad.body).toBe("Soubor a.step je neúplný");
    const empty = partImportOutcome(res({ status: [{ id: "imp", ok: true }], mesh: mesh(0) }), P);
    expect(!empty.ok && empty.title).toMatch(/neobsahuje nic k zobrazení/);
  });
  it("sestava: počet komponent a trojúhelníků, díly bez sítě se vypíšou, žádná síť = chyba", () => {
    const a = asmImportOutcome([res({ mesh: mesh(10) }), res({ mesh: mesh(5) })], { ...P, kind: "asm" });
    expect(a.ok && a.text).toMatch(/zobrazena za .* 2 komponent, 15 trojúhelníků\.$/);
    const b = asmImportOutcome([res({ mesh: mesh(10) }), res({ status: [{ id: "imp", ok: false, error: "X selhal" }] })], { ...P, kind: "asm" });
    expect(b.ok && b.text).toMatch(/1 dílů se nepodařilo načíst: X selhal/);
    const c = asmImportOutcome([res({ status: [{ id: "imp", ok: false, error: "STEP poškozený" }] })], { ...P, kind: "asm" });
    expect(!c.ok && c.body).toBe("STEP poškozený");
  });
  it("dávky dílů: první malá (rychlý první obraz), další do 3 MB / 16 dílů", () => {
    const src = (n: number): { source: ComponentSource } => ({ source: { kind: "file", fileName: "a.step", format: "step", data: putBlob(new Uint8Array(n).fill(n % 251)) } });
    const parts = [...Array(40)].map((_, i) => src(100_000 + i));
    const ch = chunkParts(parts);
    expect(ch[0]).toHaveLength(4);
    expect(ch.slice(1).every((c) => c.length <= 16)).toBe(true);
    expect(ch.flat()).toHaveLength(40);
    const big = chunkParts([src(4_000_000), src(4_000_001), src(10)], 4);
    expect(big.map((c) => c.length)).toEqual([1, 1, 1]); // každý velký díl ve vlastní dávce (nad 3 MB dat)
  });
  it("komponenta ze souboru → díl s prvkem Import se stejnými daty (přesné těleso)", () => {
    const d = fileComponentAsPart({ id: "c", name: "Hřídel", source: { kind: "file", fileName: "h.step", format: "step", data: "mnblob:x" }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } })!;
    expect(d.kind).toBe("part");
    expect(d.features[0]).toMatchObject({ type: "import", data: "mnblob:x", fileName: "h.step" });
  });
});
