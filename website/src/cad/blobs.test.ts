import { describe, expect, it } from "vitest";
import { b64ToBytes, blobId, blobOf, blobRefsIn, bytesToB64, dataBytes, docDataBytes, embedBlobs, internBlobs, isBlobRef, MissingBlob, missingBlobs, putBlob, type SavedDoc } from "./blobs";
import { fatalKernelText, isFatalKernelError, isOutOfMemory } from "./kernel-errors";
import type { CadDoc } from "./types";

const bytes = (n: number, seed = 1) => {
  const u = new Uint8Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) u[i] = (s = (s * 1103515245 + 12345) >>> 0) >>> 24;
  return u;
};
const part = (data: string): CadDoc => ({ app: "mnastrojarna-cad", version: 2, name: "P", material: "ocel", features: [{ id: "i", name: "Import", type: "import", fileName: "a.step", format: "step", data }] });

describe("úložiště dat importů podle otisku", () => {
  it("otisk: stejný obsah = stejný odkaz, jiný obsah / délka = jiný", () => {
    const a = bytes(100_003);
    expect(blobId(a)).toBe(blobId(a.slice()));
    const b = a.slice();
    b[50_000] ^= 1;
    expect(blobId(b)).not.toBe(blobId(a));
    expect(blobId(a.subarray(0, 100_002))).not.toBe(blobId(a));
    const ref = putBlob(a);
    expect(isBlobRef(ref)).toBe(true);
    expect(putBlob(a.slice())).toBe(ref);
    expect(blobOf(ref)).toBe(a);
    expect(dataBytes(ref)).toBe(a);
  });

  it("odkazy ve zprávě pro jádro (i ve vnořených sestavách), bez procházení typovaných polí", () => {
    const r1 = putBlob(bytes(10, 2));
    const r2 = putBlob(bytes(11, 3));
    const msg = { op: "asmParts", parts: [{ key: "k", source: { kind: "file", data: r1 } }, { key: "k2", source: { kind: "asm", doc: { components: [{ source: { kind: "file", data: r2 } }] } } }], buf: new Float32Array(10) };
    expect([...blobRefsIn(msg)].sort()).toEqual([r1, r2].sort());
  });

  it("otevření starého .mncad (base64 v prvku) → odkaz; uložení → mapa blobs (každá data jednou) → zpět shodně", () => {
    const raw = bytes(200_000, 7);
    const b64 = bytesToB64(raw);
    const doc = part(b64);
    const asm: CadDoc = { ...doc, name: "S", kind: "assembly", features: [], components: [1, 2, 3].map((i) => ({ id: `c${i}`, name: "Díl", source: { kind: "file" as const, fileName: "a.step", format: "step" as const, data: b64 }, placement: { position: [i * 10, 0, 0], rotation: [0, 0, 0] } })) };
    const inner = internBlobs(asm);
    const refs = new Set(inner.components!.map((c) => (c.source as { data: string }).data));
    expect(refs.size).toBe(1);
    const ref = [...refs][0];
    expect(isBlobRef(ref)).toBe(true);
    expect(blobOf(ref)).toEqual(raw);
    expect(JSON.stringify(inner).length).toBeLessThan(2000);
    expect(docDataBytes(inner)).toBe(raw.length);
    // uložení: data jen jednou v mapě blobs, komponenty drží odkazy
    const saved = embedBlobs(inner) as SavedDoc;
    expect(Object.keys(saved.blobs!)).toHaveLength(1);
    expect(JSON.stringify(saved).length).toBeLessThan(b64.length + 3000);
    const reopened = internBlobs(JSON.parse(JSON.stringify(saved)));
    expect((reopened as SavedDoc).blobs).toBeUndefined();
    expect(blobOf((reopened.components![0].source as { data: string }).data)).toEqual(raw);
    // starší formát (inline) zůstává k dispozici
    const inline = embedBlobs(inner, { inline: true });
    expect((inline.components![2].source as { data: string }).data).toBe(b64);
    expect(b64ToBytes((inline.components![0].source as { data: string }).data)).toEqual(raw);
    // malá data (< 4 kB base64) zůstávají v dokumentu, bez změny objektu
    const small = part(bytesToB64(bytes(100)));
    expect(internBlobs(small)).toBe(small);
  });

  it("uložení / sdílení: podklad skici, která v dokumentu už není, se nezapíše", () => {
    const u = { id: "u", src: "data:image/png;base64,AAAA", w: 4, h: 2, x: 0, y: 0, mmPerPx: 1, angle: 0, opacity: 0.5 };
    const d: CadDoc = { ...part("x"), features: [{ id: "s1", name: "Skica 1", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [] }], underlays: { s1: u, smazana: { ...u, id: "u2" } } };
    expect(Object.keys(embedBlobs(d).underlays ?? {})).toEqual(["s1"]);
    expect(Object.keys(embedBlobs(d, { inline: true }).underlays ?? {})).toEqual(["s1"]);
    expect(embedBlobs({ ...d, features: [] }).underlays).toBeUndefined();
  });
  it("chybějící data: seznam a srozumitelná chyba", () => {
    const d = part("mnblob:00000000deadbeefzz");
    expect(missingBlobs(d)).toEqual(["mnblob:00000000deadbeefzz"]);
    expect(() => dataBytes("mnblob:00000000deadbeefzz", "x.step")).toThrow(MissingBlob);
  });
});

describe("pád jádra (WASM)", () => {
  it("rozpozná abort, nedostatek paměti a přístup mimo paměť – běžná chyba operace není pád", () => {
    expect(isFatalKernelError(new Error("Aborted(OOM). Build with -sASSERTIONS for more info."))).toBe(true);
    expect(isFatalKernelError(new Error("memory access out of bounds"))).toBe(true);
    expect(isFatalKernelError(new WebAssembly.RuntimeError("unreachable"))).toBe(true);
    expect(isFatalKernelError(new Error("Could not fuse as a 3d shape"))).toBe(false);
    expect(isFatalKernelError(new Error("Soubor STEP je neúplný"))).toBe(false);
    expect(isOutOfMemory("Aborted(OOM)")).toBe(true);
    expect(fatalKernelText("Aborted(OOM)")).toMatch(/došla paměť/);
    expect(fatalKernelText("memory access out of bounds")).toMatch(/spadlo .*spuštěno znovu/);
  });
});
