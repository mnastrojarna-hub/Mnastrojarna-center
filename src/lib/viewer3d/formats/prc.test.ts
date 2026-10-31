import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ModelImportError, type MeshPart, type ModelNode, type ParsedModel } from "../types";
import { parsePRC } from "./prc";
import { BitReader } from "./prc-bits";
import { PrcBitWriter, writePrc, type TestPrc, type Vec3 } from "./prc-test-writer";

const FIXTURES = join(__dirname, "__fixtures__");
const ERR = /^3D obsah \(PRC\) se nepodařilo přečíst: /;

// ---------------------------------------------------------------------------
// Pomocné funkce
// ---------------------------------------------------------------------------

function findNode(n: ModelNode, name: string): ModelNode | null {
  if (n.name === name) return n;
  for (const c of n.children) {
    const f = findNode(c, name);
    if (f) return f;
  }
  return null;
}

function allParts(n: ModelNode): number[] {
  return [...n.parts, ...n.children.flatMap(allParts)];
}

/** Polohy vrcholů trojúhelníku t (v pořadí indexů). */
function triangle(p: MeshPart, t: number): Vec3[] {
  const idx = p.indices!;
  return [0, 1, 2].map((k) => {
    const v = idx[t * 3 + k] * 3;
    return [p.positions[v], p.positions[v + 1], p.positions[v + 2]] as Vec3;
  });
}

function expectClose(a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-5): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(eps);
}

function bbox(p: MeshPart): [Vec3, Vec3] {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p.positions[i + k]);
      hi[k] = Math.max(hi[k], p.positions[i + k]);
    }
  }
  return [lo, hi];
}

/** Deterministický generátor pseudonáhodných čísel (pro „fuzz" test). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// ---------------------------------------------------------------------------
// Testovací modely
// ---------------------------------------------------------------------------

const SQUARE: number[] = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];

/** Dvoudílná sestava: čtverec (červený, posunutý) + díl B (otočený, materiál) s drátem. */
function assembly(): TestPrc {
  // body dílu B: 0–3 trojúhelníky, 4–8 vějíř, 9–14 pás
  const bPoints: number[] = [];
  const add = (x: number, y: number, z: number) => bPoints.push(x, y, z) / 3 - 1;
  for (const [x, y] of [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
  ])
    add(x, y, 0);
  for (const [x, y] of [
    [5, 0],
    [7, 0],
    [8, 1],
    [7, 2],
    [5, 2],
  ])
    add(x, y, 1);
  for (let k = 0; k < 6; k++) add(10 + Math.floor(k / 2), k % 2, 2);
  return {
    unit: 1,
    structures: [
      {
        colors: [
          [1, 0, 0],
          [0, 0, 1],
          [0, 1, 0],
          [1, 1, 0],
        ],
        materials: [{ diffuse: 2, alpha: 0.5 }],
        styles: [{ color: 0 }, { color: 1 }, { material: 0 }, { color: 3, transparency: 128 }],
        tess: [
          {
            kind: "mesh",
            points: SQUARE,
            normals: [0, 0, 1],
            faces: [
              {
                triangles: [
                  { p: [0, 1, 2], n: [0, 0, 0] },
                  { p: [0, 2, 3], n: [0, 0, 0] },
                ],
              },
            ],
          },
          {
            kind: "mesh",
            points: bPoints,
            faces: [
              {
                style: 0,
                triangles: [{ p: [0, 1, 2] }, { p: [0, 2, 3] }],
              },
              { style: 1, fans: [{ p: [4, 5, 6, 7, 8] }] },
              { strips: [{ p: [9, 10, 11, 12, 13, 14] }] },
            ],
          },
          {
            kind: "wire",
            points: [0, 0, 0, 3, 0, 0, 3, 3, 0, 10, 0, 0, 11, 0, 0, 10, 1, 0],
            wires: [{ idx: [0, 1, 2] }, { idx: [3, 4, 5], closed: true }],
          },
        ],
        parts: [
          { name: "Čtverec", items: [{ type: "polyBrep", name: "Čtverec", tess: 0 }] },
          {
            name: "Díl B",
            items: [
              {
                type: "set",
                name: "Sada",
                children: [
                  { type: "polyBrep", name: "Těleso B", tess: 1, style: 2 },
                  { type: "polyWire", name: "Drát", tess: 2 },
                ],
              },
            ],
          },
        ],
        occurrences: [
          { name: "Sestava", sons: [1, 2] },
          { name: "A.1", part: 0, style: 0, location: { translate: [10, 0, 0] } },
          { name: "B.1", part: 1, style: 1, location: { translate: [0, 20, 0], x: [0, 1, 0], y: [-1, 0, 0] } },
        ],
        root: 0,
      },
    ],
  };
}

function parse(m: TestPrc): ParsedModel {
  return parsePRC(writePrc(m));
}

// ---------------------------------------------------------------------------
// Bitový proud
// ---------------------------------------------------------------------------

describe("PRC bitový proud", () => {
  it("double: zápis a čtení dávají přesně stejné hodnoty", () => {
    const values = [0, 1, -1, 0.5, 2, 10, 0.1, -0.25, Math.PI, 1 / 3, 1e-9, -2.5e10, 123456.789, 25.4, 1e300, -4.9e-320, 0.001];
    const w = new PrcBitWriter();
    for (const v of values) w.double(v);
    const r = new BitReader(w.finish());
    for (const v of values) expect(r.readDouble()).toBe(v);
  });

  it("UnsignedInteger, Integer, String a znaky", () => {
    const w = new PrcBitWriter();
    const uints = [0, 1, 127, 128, 255, 256, 65535, 1_000_000, 0xffffffff];
    const ints = [0, 1, -1, 127, -128, 128, -129, 40000, -40000, 2 ** 31 - 1, -(2 ** 31)];
    for (const u of uints) w.uint(u);
    for (const i of ints) w.int(i);
    w.string("Nástrojárna – žluťoučký kůň").string("").char(0xa5).bit(1);
    const r = new BitReader(w.finish());
    for (const u of uints) expect(r.readUInt()).toBe(u);
    for (const i of ints) expect(r.readInt()).toBe(i);
    expect(r.readString()).toBe("Nástrojárna – žluťoučký kůň");
    expect(r.readString()).toBe("");
    expect(r.readChar()).toBe(0xa5);
    expect(r.readBool()).toBe(true);
  });

  it("CompressedIndiceArray (bez komprese i s Huffmanovým kódováním šířek)", () => {
    const values = [5, 6, 7, 3, 100, 101, 102, 40, 40, 41, -3, 0];
    const w = new PrcBitWriter();
    w.compressedIndiceArray(values);
    w.huffmanCharArray([3, 3, 1, 0, 3, 7, 7, 3, 1], 6);
    const r = new BitReader(w.finish());
    expect(Array.from(r.readCompressedIndiceArray())).toEqual(values);
    expect(Array.from(r.readCharacterArray(6))).toEqual([3, 3, 1, 0, 3, 7, 7, 3, 1]);
  });
});

// ---------------------------------------------------------------------------
// Sestava, transformace, barvy
// ---------------------------------------------------------------------------

describe("parsePRC — sestava", () => {
  const model = parse(assembly());

  it("vrací formát, strom a díly", () => {
    expect(model.format).toBe("PRC (3D PDF)");
    expect(model.warnings).toBeUndefined();
    expect(model.root.name).toBe("Sestava");
    expect(model.parts).toHaveLength(3);
    const a = findNode(model.root, "A.1")!;
    const b = findNode(model.root, "B.1")!;
    expect(a.parts.map((i) => model.parts[i].name)).toEqual(["Čtverec"]);
    expect(b.parts.map((i) => model.parts[i].name)).toEqual(["Těleso B", "Drát"]);
    expect(allParts(model.root).sort()).toEqual([0, 1, 2]);
  });

  it("peče transformace výskytů do světových souřadnic", () => {
    const sq = model.parts.find((p) => p.name === "Čtverec")!;
    expect(bbox(sq)).toEqual([
      [10, 0, 0],
      [11, 1, 0],
    ]);
    // díl B je otočený o 90° kolem Z (x → y) a posunutý o +20 v Y: (x, y, z) → (−y, x + 20, z)
    const b = model.parts.find((p) => p.name === "Těleso B")!;
    const [lo, hi] = bbox(b);
    expectClose(lo, [-2, 20, 0]);
    expectClose(hi, [0, 32, 2]);
  });

  it("barvy ze stylů: výskyt, materiál s průhledností, plochy", () => {
    const sq = model.parts.find((p) => p.name === "Čtverec")!;
    expect(sq.color).toEqual([1, 0, 0]);
    const b = model.parts.find((p) => p.name === "Těleso B")!;
    expect(b.color).toEqual([0, 1, 0]);
    expect(b.opacity).toBeCloseTo(0.5);
    expect(b.faces).toHaveLength(3);
    expect(b.faces!.map((f) => [f.first, f.last])).toEqual([
      [0, 1],
      [2, 4],
      [5, 8],
    ]);
    expect(b.faces![0].color).toEqual([1, 0, 0]);
    expect(b.faces![1].color).toEqual([0, 0, 1]);
    expect(b.faces![2].color ?? null).toBeNull();
    const wire = model.parts.find((p) => p.name === "Drát")!;
    expect(wire.color).toEqual([0, 0, 1]);
  });

  it("rozbalí trojúhelníky, vějíře i pásy se správným pořadím vrcholů", () => {
    const b = model.parts.find((p) => p.name === "Těleso B")!;
    expect(b.indices!.length / 3).toBe(9);
    const w = (x: number, y: number, z: number): Vec3 => [-y, x + 20, z];
    // vějíř (5,0)(7,0)(8,1)(7,2)(5,2) → (0,1,2) (0,2,3) (0,3,4)
    const fan = [w(5, 0, 1), w(7, 0, 1), w(8, 1, 1), w(7, 2, 1), w(5, 2, 1)];
    expectClose(triangle(b, 2).flat(), [fan[0], fan[1], fan[2]].flat());
    expectClose(triangle(b, 3).flat(), [fan[0], fan[2], fan[3]].flat());
    expectClose(triangle(b, 4).flat(), [fan[0], fan[3], fan[4]].flat());
    // pás s0..s5: (0,1,2) (2,1,3) (2,3,4) (4,3,5)
    const s = [0, 1, 2, 3, 4, 5].map((k) => w(10 + Math.floor(k / 2), k % 2, 2));
    expectClose(triangle(b, 5).flat(), [s[0], s[1], s[2]].flat());
    expectClose(triangle(b, 6).flat(), [s[2], s[1], s[3]].flat());
    expectClose(triangle(b, 7).flat(), [s[2], s[3], s[4]].flat());
    expectClose(triangle(b, 8).flat(), [s[4], s[3], s[5]].flat());
  });

  it("normály: ze souboru, jinak dopočítané (jednotkové, otočené s dílem)", () => {
    const sq = model.parts.find((p) => p.name === "Čtverec")!;
    expect(sq.normals).toBeDefined();
    for (let i = 0; i < sq.normals!.length; i += 3) expectClose(sq.normals!.subarray(i, i + 3), [0, 0, 1]);
    const b = model.parts.find((p) => p.name === "Těleso B")!;
    expect(b.normals!.length).toBe(b.positions.length);
    for (let i = 0; i < b.normals!.length; i += 3) {
      const n = b.normals!.subarray(i, i + 3);
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 5);
      expect(Math.abs(n[2])).toBeCloseTo(1, 5); // všechny plochy leží v rovinách z = konst.
    }
  });

  it("dráty (TESS_3D_Wire) → úsečky v `lines`", () => {
    const wire = model.parts.find((p) => p.name === "Drát")!;
    expect(wire.positions.length).toBe(0);
    const L = wire.lines!;
    expect(L.length).toBe(5 * 6); // 2 úsečky otevřené čáry + 3 uzavřeného trojúhelníku
    const w = (x: number, y: number, z: number) => [-y, x + 20, z];
    expectClose(L.subarray(0, 12), [...w(0, 0, 0), ...w(3, 0, 0), ...w(3, 0, 0), ...w(3, 3, 0)]);
    expectClose(L.subarray(24, 30), [...w(10, 1, 0), ...w(10, 0, 0)]); // uzavírací úsečka
  });

  it("generovaný soubor v __fixtures__ odpovídá zapisovači (deterministický)", () => {
    const file = new Uint8Array(readFileSync(join(FIXTURES, "prc-assembly.prc")));
    expect(Array.from(file)).toEqual(Array.from(writePrc(assembly())));
    const fromFile = parsePRC(file);
    expect(fromFile.parts.map((p) => p.name)).toEqual(model.parts.map((p) => p.name));
  });
});

describe("parsePRC — jednotky, souřadné systémy, viditelnost", () => {
  it("jednotka modelu (palce) se převede na mm", () => {
    const m = parse({
      unit: 25.4,
      unitFromCad: true,
      structures: [
        {
          tess: [{ kind: "mesh", points: SQUARE, faces: [{ triangles: [{ p: [0, 1, 2] }, { p: [0, 2, 3] }] }] }],
          parts: [{ name: "P", items: [{ type: "polyBrep", tess: 0 }] }],
          occurrences: [{ name: "Kořen", part: 0, location: { translate: [1, 0, 0] } }],
        },
      ],
    });
    expectClose(bbox(m.parts[0]).flat(), [25.4, 0, 0, 50.8, 25.4, 0]);
  });

  it("jednotka výskytu (cm) se použije, když model žádnou nedeklaruje", () => {
    const m = parse({
      structures: [
        {
          tess: [{ kind: "mesh", points: SQUARE, faces: [{ triangles: [{ p: [0, 1, 2] }] }] }],
          parts: [{ name: "P", items: [{ type: "polyBrep", tess: 0 }] }],
          occurrences: [{ name: "Kořen", part: 0, unit: 10, unitFromCad: true }],
        },
      ],
    });
    expectClose(bbox(m.parts[0]).flat(), [0, 0, 0, 10, 10, 0]);
  });

  it("lokální souřadný systém položky a měřítko transformace", () => {
    const m = parse({
      structures: [
        {
          coordSystems: [{ translate: [0, 0, 5] }],
          tess: [{ kind: "mesh", points: SQUARE, faces: [{ trianglesOneNormal: [{ p: [0, 1, 2], n: 0 }] }], normals: [0, 0, 1] }],
          parts: [{ name: "P", items: [{ type: "polyBrep", tess: 0, localCs: 0 }] }],
          occurrences: [{ name: "Kořen", part: 0, location: { scale: 2 } }],
        },
      ],
    });
    expectClose(bbox(m.parts[0]).flat(), [0, 0, 10, 2, 2, 10]);
    expectClose(m.parts[0].normals!.subarray(0, 3), [0, 0, 1]);
  });

  it("vějíř s jednou normálou (NORMAL_Single)", () => {
    const m = parse({
      structures: [
        {
          tess: [{ kind: "mesh", points: SQUARE, normals: [0, 0, -1], faces: [{ fansOneNormal: [{ p: [0, 1, 2, 3], n: 0 }] }] }],
          parts: [{ name: "P", items: [{ type: "polyBrep", tess: 0 }] }],
          occurrences: [{ name: "Kořen", part: 0 }],
        },
      ],
    });
    expect(m.parts[0].indices!.length).toBe(6);
    expectClose(m.parts[0].normals!.subarray(0, 3), [0, 0, -1]);
  });

  it("skrytý výskyt se vynechá (pokud není skryté všechno)", () => {
    const m = parse({
      structures: [
        {
          tess: [{ kind: "mesh", points: SQUARE, faces: [{ triangles: [{ p: [0, 1, 2] }] }] }],
          parts: [{ name: "P", items: [{ type: "polyBrep", tess: 0 }] }],
          occurrences: [
            { name: "Kořen", sons: [1, 2] },
            { name: "Vidět", part: 0 },
            { name: "Skryto", part: 0, behaviour: 0, location: { translate: [100, 0, 0] } },
          ],
        },
      ],
    });
    expect(m.parts).toHaveLength(1);
    expect(findNode(m.root, "Skryto")).toBeNull();
    expect(bbox(m.parts[0])[1][0]).toBe(1);
  });

  it("více souborových struktur: kořen v druhé, díl v první", () => {
    const m = parse({
      structures: [
        {
          tess: [{ kind: "mesh", points: SQUARE, faces: [{ triangles: [{ p: [0, 1, 2] }] }] }],
          parts: [{ name: "Spodní díl", items: [{ type: "polyBrep", tess: 0 }] }],
          occurrences: [{ name: "Díl", part: 0, location: { translate: [0, 0, 3] } }],
        },
        {
          tess: [{ kind: "mesh", points: SQUARE, faces: [{ triangles: [{ p: [0, 2, 3] }] }] }],
          parts: [{ name: "Horní díl", items: [{ type: "polyBrep", tess: 0 }] }],
          occurrences: [{ name: "Horní", part: 0, location: { translate: [0, 0, 7] } }],
        },
      ],
    });
    expect(m.parts.map((p) => p.name).sort()).toEqual(["Horní díl", "Spodní díl"]);
    expect(bbox(m.parts.find((p) => p.name === "Horní díl")!)[0][2]).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Komprimovaná tessellace
// ---------------------------------------------------------------------------

describe("parsePRC — TESS_3D_Compressed", () => {
  it("rozbalí čtyřúhelník ze dvou trojúhelníků (první uložený, druhý přirostlý přes hranu)", () => {
    const pts: [Vec3, Vec3, Vec3, Vec3] = [
      [0, 0, 0],
      [4, 0, 0],
      [0, 3, 0],
      [4.2, 3.1, 0.5],
    ];
    const m = parse({
      structures: [
        {
          tess: [{ kind: "compressedQuad", points: pts, tolerance: 0.001 }],
          parts: [{ name: "Q", items: [{ type: "polyBrep", tess: 0 }] }],
          occurrences: [{ name: "Kořen", part: 0 }],
        },
      ],
    });
    expect(m.warnings).toBeUndefined();
    const p = m.parts[0];
    expect(p.indices!.length).toBe(6);
    // každý zadaný bod je ve výstupu (do tolerance)
    for (const q of pts) {
      let best = Infinity;
      for (let i = 0; i < p.positions.length; i += 3) {
        best = Math.min(best, Math.hypot(p.positions[i] - q[0], p.positions[i + 1] - q[1], p.positions[i + 2] - q[2]));
      }
      expect(best).toBeLessThan(0.002);
    }
    // konzistentní orientace: obě plochy míří stejným směrem (+z)
    const n = (t: number) => {
      const [a, b, c] = triangle(p, t);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      return u[0] * v[1] - u[1] * v[0];
    };
    expect(Math.sign(n(0))).toBe(Math.sign(n(1)));
  });
});

// ---------------------------------------------------------------------------
// Chyby a částečné výsledky
// ---------------------------------------------------------------------------

describe("parsePRC — chyby", () => {
  it("prázdná, cizí a poškozená data → ModelImportError s českou hláškou", () => {
    expect(() => parsePRC(new Uint8Array(10))).toThrow(ModelImportError);
    expect(() => parsePRC(new Uint8Array(10))).toThrow(ERR);
    const notPrc = new Uint8Array(200).fill(7);
    expect(() => parsePRC(notPrc)).toThrow(/nejde o data ve formátu PRC/);
    const badHeader = new Uint8Array(200);
    badHeader.set([0x50, 0x52, 0x43]);
    badHeader.fill(0xff, 43, 47);
    expect(() => parsePRC(badHeader)).toThrow(ERR);
  });

  it("náhodně poškozený soubor nikdy nespadne jinou chybou", () => {
    const good = writePrc(assembly());
    const rand = rng(12345);
    for (let iter = 0; iter < 150; iter++) {
      const bad = good.slice();
      const flips = 1 + Math.floor(rand() * 4);
      for (let k = 0; k < flips; k++) bad[Math.floor(rand() * bad.length)] ^= 1 << Math.floor(rand() * 8);
      try {
        const m = parsePRC(bad);
        expect(Array.isArray(m.parts)).toBe(true);
      } catch (e) {
        expect(e).toBeInstanceOf(ModelImportError);
        expect((e as Error).message).toMatch(ERR);
      }
    }
  });

  it("useknutý strom → díly bez umístění + varování", () => {
    const m = assembly();
    m.structures[0].truncateTree = 0.3;
    const res = parse(m);
    expect(res.parts.length).toBeGreaterThan(0);
    expect(res.warnings?.join(" ")).toMatch(/Strom sestavy v 3D PDF/);
  });

  it("chybějící strom → všechny tessellace bez umístění + varování", () => {
    const m = assembly();
    m.structures[0].omitTree = true;
    const res = parse(m);
    expect(res.parts).toHaveLength(3);
    expect(res.warnings).toContain("Strom sestavy v 3D PDF chybí nebo je nečitelný — díly jsou zobrazeny bez umístění.");
    // bez umístění: čtverec zůstane v počátku
    const sq = res.parts.find((p) => p.positions.length === 12 || bbox(p)[1][0] === 1);
    expect(sq).toBeDefined();
  });

  it("jen přesná geometrie (B-rep) bez tessellace → srozumitelná chyba", () => {
    const m = parse.bind(null, {
      structures: [
        {
          brepBodies: 1,
          parts: [{ name: "B-rep", items: [{ type: "brep" }] }],
          occurrences: [{ name: "Kořen", part: 0 }],
        },
      ],
    });
    expect(m).toThrow(/přesnou geometrii \(B-rep\)/);
  });

  it("skutečný soubor z Asymptote (CTAN media9, epix.prc) — B-rep bez tessellace", () => {
    const data = new Uint8Array(readFileSync(join(FIXTURES, "prc-epix-brep.prc")));
    expect(() => parsePRC(data)).toThrow(ModelImportError);
    expect(() => parsePRC(data)).toThrow(/přesnou geometrii \(B-rep\)/);
  });
});

// ---------------------------------------------------------------------------
// Výkon
// ---------------------------------------------------------------------------

describe("parsePRC — výkon", () => {
  it("~500 tisíc trojúhelníků za pár sekund", () => {
    const N = 500;
    const points: number[] = [];
    for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) points.push(x, y, Math.sin(x * 0.05) * Math.cos(y * 0.05));
    const strips: { p: number[] }[] = [];
    for (let y = 0; y < N; y++) {
      const p: number[] = [];
      for (let x = 0; x <= N; x++) p.push(y * (N + 1) + x, (y + 1) * (N + 1) + x);
      strips.push({ p });
    }
    const data = writePrc({
      structures: [
        {
          tess: [{ kind: "mesh", points, faces: [{ strips }] }],
          parts: [{ name: "Síť", items: [{ type: "polyBrep", tess: 0 }] }],
          occurrences: [{ name: "Kořen", part: 0 }],
        },
      ],
    });
    const t0 = performance.now();
    const m = parsePRC(data);
    const dt = performance.now() - t0;
    expect(m.parts[0].indices!.length / 3).toBe(2 * N * N);
    expect(dt).toBeLessThan(8000);
  }, 60_000);
});
