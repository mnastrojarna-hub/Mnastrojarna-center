import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { findLoops } from "../sketch";
import { parseDXF } from "./dxf";
import { EXPORT_FORMATS, exportShape } from "./export";
import { prepareImport, IMPORT_ACCEPT } from "./import";
import { importBody } from "./kernel-import";
import { bytesToB64, parse3MF, parseGLTF, parseOBJ, parseOFF, parsePLY, parseSTL, weld, writeBinarySTL, type TriMesh } from "./mesh-io";
import { igesToMesh, OCCT_VERSION, occtToMesh } from "./occt";
import { readZip, writeZip } from "./zip";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

const box = () => r.makeBox([0, 0, 0], [40, 20, 10]) as r.Shape3D;
const u8 = (b: ArrayBuffer) => new Uint8Array(b);
function bbox(m: TriMesh) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], m.positions[i + k]);
      hi[k] = Math.max(hi[k], m.positions[i + k]);
    }
  return [lo, hi].map((v) => v.map((x) => Math.round(x * 1000) / 1000 + 0));
}
const BOX_BB = [[0, 0, 0], [40, 20, 10]];

describe("export 3D", () => {
  it("má všechny formáty", () => {
    expect(EXPORT_FORMATS.map((f) => f.id).sort()).toEqual(["3mf", "brep", "glb", "obj", "step", "stl", "wrl"]);
  });

  it("STEP → zpět jako těleso", async () => {
    const buf = await exportShape(box(), "step", "Kvádr");
    expect(new TextDecoder().decode(u8(buf).subarray(0, 20))).toContain("ISO-10303-21");
    const back = await importBody({ id: "i", name: "i", type: "import", fileName: "a.step", format: "step", data: bytesToB64(u8(buf)) });
    expect(r.measureVolume(back)).toBeCloseTo(8000, 0);
  });

  it("BREP → zpět jako těleso (přesná geometrie)", async () => {
    const buf = await exportShape(box(), "brep", "Kvádr");
    const text = new TextDecoder().decode(buf);
    expect(text).toMatch(/CASCADE Topology/);
    const back = await importBody({ id: "i", name: "i", type: "import", fileName: "a.brep", format: "brep", data: bytesToB64(u8(buf)) });
    expect(r.measureVolume(back)).toBeCloseTo(8000, 3);
    const prep = await prepareImport(new File([buf], "a.brep"));
    expect(prep.kind).toBe("body");
  });

  it("STL binární → síť → těleso", async () => {
    const buf = await exportShape(box(), "stl", "Kvádr");
    const m = parseSTL(buf);
    expect(m.indices.length / 3).toBe(12);
    expect(bbox(m)).toEqual(BOX_BB);
    const back = await importBody({ id: "i", name: "i", type: "import", fileName: "a.stl", format: "stl", data: bytesToB64(u8(buf)) });
    expect(r.measureVolume(back)).toBeCloseTo(8000, 1);
    expect(back.faces.length).toBe(6); // koplanární trojúhelníky sloučené
    // navazující booleovská operace funguje
    expect(r.measureVolume(back.cut(r.makeCylinder(2, 50, [20, 10, -5])))).toBeLessThan(8000);
  });

  it("OBJ s normálami", async () => {
    const text = new TextDecoder().decode(await exportShape(box(), "obj", "Kvádr"));
    expect(text).toMatch(/^vn /m);
    const m = parseOBJ(text);
    expect(m.indices.length / 3).toBe(12);
    expect(bbox(m)).toEqual(BOX_BB);
  });

  it("GLB – platná hlavička, metry a Y nahoru; zpětné načtení vrátí mm a Z", async () => {
    const buf = u8(await exportShape(box(), "glb", "Kvádr"));
    const dv = new DataView(buf.buffer);
    expect(dv.getUint32(0, true)).toBe(0x46546c67);
    expect(dv.getUint32(8, true)).toBe(buf.length);
    expect(buf.length % 4).toBe(0);
    const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + dv.getUint32(12, true))));
    expect(json.asset.version).toBe("2.0");
    expect(json.accessors[0].max.map((x: number) => Math.round(x * 1000) / 1000)).toEqual([0.04, 0.01, 0]);
    const m = parseGLTF(buf);
    expect(bbox(m)).toEqual(BOX_BB);
  });

  it("3MF – zip s modelem, sloučené vrcholy, zpětné načtení", async () => {
    const buf = u8(await exportShape(box(), "3mf", "Kvádr"));
    expect(readZip(buf).map((e) => e.name)).toEqual(["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"]);
    const model = new TextDecoder().decode(await readZip(buf)[2].read());
    expect(model).toContain('unit="millimeter"');
    expect((model.match(/<vertex /g) ?? []).length).toBe(8);
    const m = await parse3MF(buf);
    expect(m.indices.length / 3).toBe(12);
    expect(bbox(m)).toEqual(BOX_BB);
  });

  it("VRML 2.0", async () => {
    const text = new TextDecoder().decode(await exportShape(box(), "wrl", "Kvádr"));
    expect(text.startsWith("#VRML V2.0 utf8")).toBe(true);
    expect(text).toContain("IndexedFaceSet");
  });
});

describe("import sítí", () => {
  const cube: TriMesh = (() => {
    const p = [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10];
    const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
    return { positions: new Float32Array(p), indices: new Uint32Array(f) };
  })();

  it("STL ASCII", () => {
    const tri = "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n";
    expect(parseSTL(new TextEncoder().encode(tri)).indices.length).toBe(3);
  });

  it("PLY ASCII i binární", () => {
    const ascii = `ply\nformat ascii 1.0\nelement vertex 8\nproperty float x\nproperty float y\nproperty float z\nelement face 6\nproperty list uchar int vertex_indices\nend_header\n${[...Array(8)].map((_, i) => `${cube.positions[i * 3]} ${cube.positions[i * 3 + 1]} ${cube.positions[i * 3 + 2]}`).join("\n")}\n4 0 3 2 1\n4 4 5 6 7\n4 0 1 5 4\n4 1 2 6 5\n4 2 3 7 6\n4 3 0 4 7\n`;
    expect(parsePLY(new TextEncoder().encode(ascii)).indices.length / 3).toBe(12);
    const head = new TextEncoder().encode("ply\nformat binary_little_endian 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n");
    const body = new DataView(new ArrayBuffer(36 + 1 + 12));
    [0, 0, 0, 5, 0, 0, 0, 5, 0].forEach((v, i) => body.setFloat32(i * 4, v, true));
    body.setUint8(36, 3);
    [0, 1, 2].forEach((v, i) => body.setInt32(37 + i * 4, v, true));
    const all = new Uint8Array(head.length + body.byteLength);
    all.set(head);
    all.set(new Uint8Array(body.buffer), head.length);
    const m = parsePLY(all);
    expect(Array.from(m.positions)).toEqual([0, 0, 0, 5, 0, 0, 0, 5, 0]);
  });

  it("OFF", () => {
    const off = "OFF\n# krychle\n4 1 0\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3\n";
    expect(parseOFF(off).indices.length / 3).toBe(2);
  });

  it("weld sloučí vrcholy", () => {
    const stl = parseSTL(writeBinarySTL(cube));
    expect(stl.positions.length / 3).toBe(36);
    expect(weld(stl.positions, stl.indices).positions.length / 3).toBe(8);
  });

  it("ZIP zápis/čtení vč. deflate", async () => {
    const z = writeZip([{ name: "a.txt", data: "ahoj" }]);
    expect(new TextDecoder().decode(await readZip(z)[0].read())).toBe("ahoj");
  });

  it("IGES přes occt-import-js", async () => {
    const require = createRequire(import.meta.url);
    const factory = require("occt-import-js");
    const pkg = require("occt-import-js/package.json");
    expect(pkg.version).toBe(OCCT_VERSION);
    const buf = new Uint8Array(fs.readFileSync(path.join(__dirname, "__fixtures__/cube-10mm.igs")));
    const m = await igesToMesh(buf, factory);
    expect(bbox(m)[1][0] - bbox(m)[0][0]).toBeCloseTo(10, 3);
    expect(() => occtToMesh({ success: false, meshes: [] })).toThrow();
  }, 60_000);
});

describe("DXF → skica", () => {
  const dxf = (entities: string, units = 4) =>
    ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", String(units), "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES", entities, "0", "ENDSEC", "0", "EOF"].join("\n");

  it("úsečky, kružnice, oblouk a polyline s bulge", () => {
    const ents = [
      "0\nLINE\n8\n0\n10\n0\n20\n0\n11\n10\n21\n0",
      "0\nCIRCLE\n8\n0\n10\n5\n20\n5\n40\n2",
      "0\nARC\n8\n0\n10\n0\n20\n0\n40\n10\n50\n0\n51\n90",
      // obdélník 20×10 se zaoblenou pravou stranou (bulge 1 = půlkruh)
      "0\nLWPOLYLINE\n8\n0\n90\n4\n70\n1\n10\n0\n20\n0\n10\n20\n20\n0\n42\n1\n10\n20\n20\n10\n10\n0\n20\n10",
    ].join("\n");
    const res = parseDXF(dxf(ents));
    const types = res.entities.map((e) => e.type);
    expect(types.filter((t) => t === "line").length).toBe(1 + 3);
    expect(types).toContain("circle");
    const arcs = res.entities.filter((e) => e.type === "arc") as Extract<(typeof res.entities)[number], { type: "arc" }>[];
    expect(arcs.length).toBe(2);
    // ARC 0→90°: střed oblouku na 45°
    expect(arcs[0].b[0]).toBeCloseTo(10 * Math.SQRT1_2, 6);
    // bulge 1 doprava: (20,0)→(20,10) přes (25,5)
    expect(arcs[1].b).toEqual([25, 5]);
    // polyline s obloukem tvoří uzavřenou smyčku
    const { loops } = findLoops(res.entities.slice(3));
    expect(loops.length).toBe(1);
  });

  it("jednotky v palcích a SPLINE", () => {
    const spline = "0\nSPLINE\n8\n0\n70\n8\n71\n1\n72\n4\n73\n2\n40\n0\n40\n0\n40\n1\n40\n1\n10\n0\n20\n0\n10\n1\n20\n1";
    const res = parseDXF(dxf("0\nLINE\n8\n0\n10\n0\n20\n0\n11\n1\n21\n0\n" + spline, 1));
    const line = res.entities[0] as Extract<(typeof res.entities)[number], { type: "line" }>;
    expect(line.b[0]).toBeCloseTo(25.4, 6);
    const pl = res.entities[1] as Extract<(typeof res.entities)[number], { type: "polyline" }>;
    expect(pl.points[pl.points.length - 1][0]).toBeCloseTo(25.4, 6);
  });
});

describe("prepareImport", () => {
  it("nativní formáty vysvětlí export STEP", async () => {
    for (const [name, needle] of [["dil.sldprt", "SolidWorks"], ["dil.ipt", "Inventor"], ["dil.Z3", "ZW3D"], ["v.dwg", "DXF"]]) {
      const res = await prepareImport(new File([new Uint8Array(10)], name));
      expect(res.kind).toBe("unsupported");
      expect(res.kind === "unsupported" && res.message).toContain(needle);
    }
  });
  it("STEP, STL, DXF, neznámý", async () => {
    const step = fs.readFileSync(path.join(__dirname, "../../lib/__fixtures__/cube.stp"));
    expect((await prepareImport(new File([step], "a.STP"))).kind).toBe("body");
    const stl = await exportShape(box(), "stl", "x");
    const res = await prepareImport(new File([stl], "a.stl"));
    expect(res.kind === "body" && res.format).toBe("stl");
    const d = await prepareImport(new File(["0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n10\n0\n20\n0\n40\n5\n0\nENDSEC\n0\nEOF\n"], "k.dxf"));
    expect(d.kind).toBe("sketch");
    expect((await prepareImport(new File(["x"], "a.xyz"))).kind).toBe("unsupported");
    expect((await prepareImport(new File(["nic"], "a.step"))).kind).toBe("unsupported");
    expect(IMPORT_ACCEPT).toContain(".3mf");
  });
});
