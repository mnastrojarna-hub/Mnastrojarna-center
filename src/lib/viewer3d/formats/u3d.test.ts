/**
 * Testy dekodéru U3D.
 *
 * Fixtures `__fixtures__/u3d-*.u3d` a `*.idtf` jsou ukázkové scény z referenční implementace
 * U3D Sample Software (repozitář „u3d", adresář Samples/TestScenes, licence Apache-2.0) —
 * soubory .u3d vytvořil referenční exportér (IDTFConverter), soubory .idtf jsou jejich textové
 * zdroje a slouží jako přesná referenční geometrie. Druhá polovina testů používá vlastní testovací
 * kodér (u3d-test-encoder.ts), který zrcadlí zápisovou stranu reference.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ModelImportError, type MeshPart, type ModelNode, type ParsedModel } from "../types";
import { parseU3D } from "./u3d";
import { encodeTestU3D, IDENTITY, type Mat4, type TestMesh, type TestScene } from "./u3d-test-encoder";

const fixture = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url))));
const fixtureText = (name: string) => readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8");

type V3 = [number, number, number];

// ───────────────────── minimální čtečka IDTF (referenční geometrie) ─────────────────────

interface IdtfItem {
  key: string;
  args: string[];
  body: IdtfBlock | null;
}
interface IdtfBlock {
  items: IdtfItem[];
  values: string[];
}

function parseIdtf(text: string): IdtfBlock {
  const toks: { s?: string; b?: string; w?: string }[] = [];
  const re = /"([^"]*)"|([{}])|([^\s{}"]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) toks.push(m[1] !== undefined ? { s: m[1] } : m[2] ? { b: m[2] } : { w: m[3] });
  let i = 0;
  const isKey = (t: (typeof toks)[number] | undefined) => !!t?.w && /^[A-Z_][A-Z0-9_:]*$/.test(t.w);
  const block = (): IdtfBlock => {
    const node: IdtfBlock = { items: [], values: [] };
    while (i < toks.length) {
      const t = toks[i];
      if (t.b === "}") {
        i++;
        return node;
      }
      if (isKey(t)) {
        i++;
        const item: IdtfItem = { key: t.w!, args: [], body: null };
        while (i < toks.length && !toks[i].b && !isKey(toks[i])) item.args.push(toks[i].s ?? toks[i].w!), i++;
        if (toks[i]?.b === "{") {
          i++;
          item.body = block();
        }
        node.items.push(item);
      } else {
        i++;
        if (t.b !== "{") node.values.push(t.s ?? t.w!);
      }
    }
    return node;
  };
  return block();
}

const find = (b: IdtfBlock, key: string) => b.items.find((it) => it.key === key);
const findAll = (b: IdtfBlock, key: string) => b.items.filter((it) => it.key === key);
const nums = (it: IdtfItem | undefined) => (it?.body?.values ?? []).map(Number);

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const xf = (m: Mat4, p: number[]): V3 => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

/** Světové trojúhelníky (s normálami rohů) a úsečky všech instancí modelových uzlů IDTF. */
function idtfWorld(text: string) {
  const root = parseIdtf(text);
  const nodes = findAll(root, "NODE").map((it) => {
    const b = it.body!;
    const parents = findAll(find(b, "PARENT_LIST")?.body ?? { items: [], values: [] }, "PARENT").map((p) => ({
      name: find(p.body!, "PARENT_NAME")!.args[0],
      tm: nums(find(p.body!, "PARENT_TM")),
    }));
    return { kind: it.args[0], name: find(b, "NODE_NAME")!.args[0], parents, resource: find(b, "RESOURCE_NAME")?.args[0] ?? "" };
  });
  const resources = new Map<string, IdtfBlock>();
  for (const rl of findAll(root, "RESOURCE_LIST")) {
    if (rl.args[0] !== "MODEL") continue;
    for (const r of findAll(rl.body!, "RESOURCE")) {
      const type = find(r.body!, "MODEL_TYPE")!.args[0];
      resources.set(find(r.body!, "RESOURCE_NAME")!.args[0], find(r.body!, type === "MESH" ? "MESH" : "LINE_SET")!.body!);
    }
  }
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const worlds = (n: (typeof nodes)[number]): Mat4[] =>
    n.parents.flatMap((p) => (p.name === "<NULL>" ? [p.tm] : worlds(byName.get(p.name)!).map((w) => mul(w, p.tm))));
  const tris: { node: string; p: V3[]; n: V3[] }[] = [];
  const segs: V3[][] = [];
  for (const n of nodes) {
    const res = n.kind === "MODEL" ? resources.get(n.resource) : undefined;
    if (!res) continue;
    const pos = nums(find(res, "MODEL_POSITION_LIST"));
    const nor = nums(find(res, "MODEL_NORMAL_LIST"));
    const fp = nums(find(res, "MESH_FACE_POSITION_LIST"));
    const fn = nums(find(res, "MESH_FACE_NORMAL_LIST"));
    const lp = nums(find(res, "LINE_POSITION_LIST"));
    for (const w of worlds(n)) {
      const P = (i: number) => xf(w, pos.slice(i * 3, i * 3 + 3));
      const N = (i: number): V3 => {
        const v = [nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]];
        const o = [w[0] * v[0] + w[4] * v[1] + w[8] * v[2], w[1] * v[0] + w[5] * v[1] + w[9] * v[2], w[2] * v[0] + w[6] * v[1] + w[10] * v[2]];
        const l = Math.hypot(o[0], o[1], o[2]) || 1;
        return [o[0] / l, o[1] / l, o[2] / l];
      };
      for (let f = 0; f < fp.length / 3; f++) {
        tris.push({ node: n.name, p: [P(fp[f * 3]), P(fp[f * 3 + 1]), P(fp[f * 3 + 2])], n: fn.length ? [N(fn[f * 3]), N(fn[f * 3 + 1]), N(fn[f * 3 + 2])] : [] });
      }
      for (let l = 0; l < lp.length / 2; l++) segs.push([P(lp[l * 2]), P(lp[l * 2 + 1])]);
    }
  }
  return { tris, segs };
}

// ───────────────────── pomocné funkce nad výstupem dekodéru ─────────────────────

function triangles(part: MeshPart): { p: V3[]; n: V3[] | null }[] {
  const idx = part.indices!;
  const out: { p: V3[]; n: V3[] | null }[] = [];
  const P = (v: number): V3 => [part.positions[v * 3], part.positions[v * 3 + 1], part.positions[v * 3 + 2]];
  const N = (v: number): V3 => [part.normals![v * 3], part.normals![v * 3 + 1], part.normals![v * 3 + 2]];
  for (let t = 0; t < idx.length; t += 3) {
    out.push({ p: [P(idx[t]), P(idx[t + 1]), P(idx[t + 2])], n: part.normals ? [N(idx[t]), N(idx[t + 1]), N(idx[t + 2])] : null });
  }
  return out;
}

const allTriangles = (m: ParsedModel) => m.parts.flatMap((p) => (p.indices ? triangles(p) : []));
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Každému dekódovanému trojúhelníku najde referenční se stejnými vrcholy ve stejném cyklickém
 * pořadí (zachovaná orientace). Vrací největší odchylku vrcholu a nejmenší kosinus normál.
 */
function matchTriangles(dec: { p: V3[]; n: V3[] | null }[], ref: { p: V3[]; n: V3[] }[], tol: number) {
  const used = new Uint8Array(ref.length);
  let maxErr = 0;
  let minNormalCos = 1;
  for (const t of dec) {
    let best = -1;
    let bestErr = Infinity;
    let bestRot = 0;
    ref.forEach((g, gi) => {
      if (used[gi]) return;
      for (let rot = 0; rot < 3; rot++) {
        const e = Math.max(dist(g.p[rot], t.p[0]), dist(g.p[(rot + 1) % 3], t.p[1]), dist(g.p[(rot + 2) % 3], t.p[2]));
        if (e < bestErr) {
          bestErr = e;
          best = gi;
          bestRot = rot;
        }
      }
    });
    expect(bestErr).toBeLessThan(tol);
    used[best] = 1;
    maxErr = Math.max(maxErr, bestErr);
    const g = ref[best];
    if (t.n && g.n.length) for (let k = 0; k < 3; k++) minNormalCos = Math.min(minNormalCos, dot(t.n[k], g.n[(bestRot + k) % 3]));
  }
  return { maxErr, minNormalCos };
}

function walk(node: ModelNode, depth = 0, out: string[] = []): string[] {
  out.push(`${"  ".repeat(depth)}${node.name}${node.parts.length ? ` [${node.parts.join(",")}]` : ""}`);
  for (const c of node.children) walk(c, depth + 1, out);
  return out;
}

// ───────────────────────────── referenční soubory ─────────────────────────────

describe("parseU3D — ukázkové scény referenční implementace", () => {
  it("krychle (jen progresivní blok) odpovídá zdrojovému IDTF včetně normál a barvy", () => {
    const m = parseU3D(fixture("u3d-box.u3d"));
    expect(m.format).toBe("U3D (3D PDF)");
    expect(m.warnings).toBeUndefined();
    expect(m.parts).toHaveLength(1);
    const part = m.parts[0];
    expect(part.name).toBe("Box01");
    expect(part.color![0]).toBeCloseTo(0.878431, 5);
    expect(part.color![1]).toBeCloseTo(0.560784, 5);
    expect(part.color![2]).toBeCloseTo(0.341176, 5);
    expect(part.indices).toBeInstanceOf(Uint32Array);
    const ref = idtfWorld(fixtureText("u3d-box.idtf"));
    const dec = allTriangles(m);
    expect(dec).toHaveLength(ref.tris.length);
    const r = matchTriangles(dec, ref.tris, 1e-3);
    expect(r.maxErr).toBeLessThan(1e-4);
    expect(r.minNormalCos).toBeGreaterThan(0.9999);
    expect(walk(m.root)).toEqual(["U3D", "  Box01 [0]"]);
  });

  it("síť se třemi stínováními → díly podle barvy materiálu", () => {
    const m = parseU3D(fixture("u3d-simpleBox.u3d"));
    const ref = idtfWorld(fixtureText("u3d-simpleBox.idtf"));
    expect(allTriangles(m)).toHaveLength(36);
    matchTriangles(allTriangles(m), ref.tris, 1e-3);
    const colors = m.parts.map((p) => p.color!.map((c) => Math.round(c * 100) / 100)).sort();
    expect(colors).toEqual([
      [0.69, 0.1, 0.9],
      [0.69, 0.9, 0.1],
      [0.9, 0.1, 0.1],
    ]);
    expect(m.parts.map((p) => p.name).sort()).toEqual(["Box01 (1)", "Box01 (2)", "Box01 (3)"]);
    expect(m.root.children[0].parts).toEqual([0, 1, 2]);
  });

  it("skupina se dvěma modely sdílejícími zdroj, každý s jiným shaderem", () => {
    const m = parseU3D(fixture("u3d-box_2shaders.u3d"));
    const ref = idtfWorld(fixtureText("u3d-box_2shaders.idtf"));
    matchTriangles(allTriangles(m), ref.tris, 1e-3);
    expect(walk(m.root)).toEqual(["U3D", "  Box_Group", "    Box01 [0]", "    Box02 [1]"]);
    expect(m.parts[0].color![1]).toBeCloseTo(0.560784, 5);
    expect(m.parts[1].color![1]).toBeCloseTo(0.860784, 5);
  });

  it("uzel se dvěma rodiči → dvě instance s vlastní transformací", () => {
    const m = parseU3D(fixture("u3d-mp_box.u3d"));
    const ref = idtfWorld(fixtureText("u3d-mp_box.idtf"));
    expect(m.parts).toHaveLength(2);
    expect(allTriangles(m)).toHaveLength(24);
    const r = matchTriangles(allTriangles(m), ref.tris, 1e-3);
    expect(r.minNormalCos).toBeGreaterThan(0.9999);
  });

  it("množina úseček (line set) → segmenty ve světových souřadnicích", () => {
    const m = parseU3D(fixture("u3d-lineset.u3d"));
    const ref = idtfWorld(fixtureText("u3d-lineset.idtf"));
    expect(m.parts).toHaveLength(1);
    const lines = m.parts[0].lines!;
    expect(m.parts[0].positions).toHaveLength(0);
    expect(lines.length / 6).toBe(ref.segs.length);
    const used = new Set<number>();
    for (let i = 0; i < lines.length; i += 6) {
      const a = [lines[i], lines[i + 1], lines[i + 2]];
      const b = [lines[i + 3], lines[i + 4], lines[i + 5]];
      const j = ref.segs.findIndex((s, k) => !used.has(k) && ((dist(s[0], a) < 1e-3 && dist(s[1], b) < 1e-3) || (dist(s[0], b) < 1e-3 && dist(s[1], a) < 1e-3)));
      expect(j).toBeGreaterThanOrEqual(0);
      used.add(j);
    }
  });

  it("progresivní a základní varianta téže plochy dávají stejnou geometrii", () => {
    const prog = allTriangles(parseU3D(fixture("u3d-surface.u3d")));
    const base = allTriangles(parseU3D(fixture("u3d-surface_base.u3d")));
    expect(prog).toHaveLength(960);
    expect(base).toHaveLength(960);
    // základní síť nese přesné hodnoty, progresivní je kvantovaná (Position Inverse Quant)
    const r = matchTriangles(prog, base.map((t) => ({ p: t.p, n: t.n ?? [] })), 0.01);
    expect(r.maxErr).toBeLessThan(0.002);
    // normály: kodér úmyslně nahrazuje normály bližší než 60° predikcí
    expect(r.minNormalCos).toBeGreaterThan(0.45);
  });

  it("rovina 64×64 (progresivní, s texturovými souřadnicemi) se rekonstruuje do mřížky", () => {
    const m = parseU3D(fixture("u3d-plane64x64.u3d"));
    expect(m.parts).toHaveLength(1);
    const p = m.parts[0];
    expect(p.indices!.length / 3).toBe(63 * 63 * 2);
    const step = 200 / 63;
    const set = new Set<string>();
    for (let v = 0; v < p.positions.length; v += 3) {
      const x = (p.positions[v] + 3.336568 + 100) / step;
      const y = (p.positions[v + 1] + 63.002571 + 100) / step;
      expect(Math.abs(x - Math.round(x))).toBeLessThan(0.01);
      expect(Math.abs(y - Math.round(y))).toBeLessThan(0.01);
      expect(p.positions[v + 2]).toBeCloseTo(50, 2);
      set.add(`${Math.round(x)},${Math.round(y)}`);
      expect(Math.abs(p.normals![v + 2])).toBeGreaterThan(0.999);
    }
    expect(set.size).toBe(64 * 64);
    // každá vnitřní hrana sdílená právě dvěma trojúhelníky s opačnou orientací
    const edges = new Map<string, number>();
    const key = (a: number) => `${Math.round((p.positions[a * 3] + 103.336568) / step)},${Math.round((p.positions[a * 3 + 1] + 163.002571) / step)}`;
    const idx = p.indices!;
    for (let t = 0; t < idx.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const e = `${key(idx[t + k])}>${key(idx[t + ((k + 1) % 3)])}`;
        edges.set(e, (edges.get(e) ?? 0) + 1);
      }
    }
    for (const n of edges.values()) expect(n).toBe(1);
  });

  it("síť s barvami vrcholů (progresivní barevné kontexty)", () => {
    const m = parseU3D(fixture("u3d-VertexColor.u3d"));
    expect(m.warnings).toBeUndefined();
    // zdroj má 2158 ploch, z toho 32 degenerovaných, které exportér vynechal
    expect(allTriangles(m)).toHaveLength(2126);
    expect(walk(m.root).map((s) => s.trim().split(" ")[0])).toEqual(["U3D", "Box01", "Box02", "Teapot"]);
  });

  it("soubor jen s bodovou množinou → srozumitelná chyba", () => {
    expect(() => parseU3D(fixture("u3d-pointset.u3d"))).toThrowError(ModelImportError);
    expect(() => parseU3D(fixture("u3d-pointset.u3d"))).toThrowError(/neobsahuje žádnou zobrazitelnou geometrii/);
  });
});

// ───────────────────────────── testovací kodér ─────────────────────────────

const translate = (x: number, y: number, z: number): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const rotZ90: Mat4 = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Kvádr 2×1×1 s plochými normálami (24 normál, 12 trojúhelníků, dvě stínování). */
function boxMesh(name: string): TestMesh {
  const P: V3[] = [];
  for (let i = 0; i < 8; i++) P.push([i & 1 ? 2 : 0, i & 2 ? 1 : 0, i & 4 ? 1 : 0]);
  const quads: [number, number, number, number, V3][] = [
    [0, 2, 3, 1, [0, 0, -1]],
    [4, 5, 7, 6, [0, 0, 1]],
    [0, 1, 5, 4, [0, -1, 0]],
    [2, 6, 7, 3, [0, 1, 0]],
    [0, 4, 6, 2, [-1, 0, 0]],
    [1, 3, 7, 5, [1, 0, 0]],
  ];
  const normals: V3[] = [];
  const faces: TestMesh["faces"] = [];
  quads.forEach(([a, b, c, d, n], q) => {
    const ni = normals.length;
    normals.push(n, n, n, n);
    const shading = q < 2 ? 1 : 0;
    faces.push({ shading, p: [a, b, c], n: [ni, ni + 1, ni + 2] });
    faces.push({ shading, p: [a, c, d], n: [ni, ni + 2, ni + 3] });
  });
  return { name, shadingCount: 2, positions: P, normals, faces };
}

function twoPartScene(noCompression: boolean, units?: number): TestScene {
  return {
    noCompression,
    units,
    nodes: [
      { name: "Sestava", kind: "group", parents: [{ name: "", matrix: translate(100, 0, 0) }] },
      { name: "Díl A", kind: "model", parents: [{ name: "Sestava", matrix: IDENTITY }], resource: "kvadr", shaderLists: [["ocel"], ["hlinik"]] },
      { name: "Díl B", kind: "model", parents: [{ name: "Sestava", matrix: mul(translate(0, 10, 0), rotZ90) }], resource: "kvadr", shaderLists: [["hlinik"]] },
    ],
    meshes: [boxMesh("kvadr")],
    shaders: [
      { name: "ocel", material: "Ocel" },
      { name: "hlinik", material: "Hliník" },
    ],
    materials: [
      { name: "Ocel", diffuse: [0.5, 0.5, 0.55] },
      { name: "Hliník", diffuse: [0.8, 0.2, 0.1], opacity: 0.5 },
    ],
  };
}

describe("parseU3D — testovací kodér (deterministické scény)", () => {
  for (const noCompression of [false, true]) {
    it(`dva díly s transformacemi a dvěma materiály (${noCompression ? "bez komprese" : "komprimovaně"})`, () => {
      const m = parseU3D(encodeTestU3D(twoPartScene(noCompression)));
      expect(m.warnings).toBeUndefined();
      expect(walk(m.root)).toEqual(["U3D", "  Sestava", "    Díl A [0,1]", "    Díl B [2]"]);
      const [a1, a2, b] = m.parts;
      // Díl A: dvě stínování s různými materiály → dva díly
      expect(a1.name).toBe("Díl A (1)");
      expect(a1.color).toEqual([0.5, 0.5, Math.fround(0.55)]);
      expect(a2.color).toEqual([Math.fround(0.8), Math.fround(0.2), Math.fround(0.1)]);
      expect(a2.opacity).toBe(0.5);
      expect(triangles(a1)).toHaveLength(8);
      expect(triangles(a2)).toHaveLength(4);
      // Díl B: jediný seznam shaderů platí pro všechna stínování
      expect(b.name).toBe("Díl B");
      expect(triangles(b)).toHaveLength(12);
      const bbox = (p: MeshPart) => {
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < p.positions.length; i += 3) for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], p.positions[i + k]);
          hi[k] = Math.max(hi[k], p.positions[i + k]);
        }
        return [...lo, ...hi];
      };
      expect(bbox(b)).toEqual([99, 10, 0, 100, 12, 1]);
      const ba = [a1, a2].map(bbox);
      expect(Math.min(ba[0][0], ba[1][0])).toBe(100);
      expect(Math.max(ba[0][3], ba[1][3])).toBe(102);
      // normály otočené spolu s dílem a orientace trojúhelníků souhlasí s normálou
      for (const part of [a1, a2, b]) {
        for (const t of triangles(part)) {
          const u = [t.p[1][0] - t.p[0][0], t.p[1][1] - t.p[0][1], t.p[1][2] - t.p[0][2]];
          const v = [t.p[2][0] - t.p[0][0], t.p[2][1] - t.p[0][1], t.p[2][2] - t.p[0][2]];
          const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
          const l = Math.hypot(n[0], n[1], n[2]);
          for (const vn of t.n!) expect(dot(vn, n) / l).toBeCloseTo(1, 5);
        }
      }
    });
  }

  it("komprimovaný a nekomprimovaný zápis dávají totožný výsledek", () => {
    const a = parseU3D(encodeTestU3D(twoPartScene(false)));
    const b = parseU3D(encodeTestU3D(twoPartScene(true)));
    expect(a).toEqual(b);
  });

  it("měřítko jednotek se převádí na milimetry", () => {
    const mm = parseU3D(encodeTestU3D(twoPartScene(false, 0.001)));
    const m = parseU3D(encodeTestU3D(twoPartScene(false, 1)));
    const plain = parseU3D(encodeTestU3D(twoPartScene(false)));
    expect(mm.parts[2].positions).toEqual(plain.parts[2].positions);
    for (let i = 0; i < m.parts[2].positions.length; i++) {
      expect(m.parts[2].positions[i]).toBeCloseTo(plain.parts[2].positions[i] * 1000, 2);
    }
  });

  /** Pás trojúhelníků postavený jen rozdělováním vrcholů + krok s posunutou plochou. */
  function progressiveScene(noCompression: boolean, excludeNormals: boolean, n = 12): TestScene {
    const splits: TestMesh["splits"] = [];
    const pos = (i: number): V3 => [Math.floor(i / 2) * 3 + (i & 1 ? 1.5 : 0), i & 1 ? 2 : 0, 0];
    splits.push({ split: 0, position: pos(0), newFaces: [] });
    splits.push({ split: 0, position: pos(1), newFaces: [] });
    for (let i = 2; i < n; i++) {
      // (i−2, i−1, i) s konzistentní orientací: lichý / sudý trojúhelník pásu
      splits.push({ split: i - 1, position: pos(i), newFaces: [{ shading: 0, orientation: i & 1 ? 1 : 2, third: i - 2 }] });
    }
    // posun: poslední plocha (n−3, n−2, n−1) přejde z vrcholu n−1 na nový vrchol n, přibude (n−1, n, n−2)
    splits.push({ split: n - 1, position: [pos(n - 1)[0] + 1, 4, 0.5], newFaces: [{ shading: 0, orientation: 2, third: n - 2 }], moveFaces: [n - 3] });
    return {
      noCompression,
      nodes: [{ name: "Pás", kind: "model", parents: [{ name: "", matrix: IDENTITY }], resource: "pas", shaderLists: [["s"]] }],
      meshes: [{ name: "pas", shadingCount: 1, excludeNormals, positions: [], faces: [], splits, positionIQ: 1 / 1024 }],
      shaders: [{ name: "s", material: "m" }],
      materials: [{ name: "m", diffuse: [0.2, 0.4, 0.6] }],
    };
  }

  for (const [noCompression, excludeNormals] of [
    [false, false],
    [true, false],
    [false, true],
  ] as const) {
    it(`progresivní rozdělování vrcholů včetně posunu plochy (${noCompression ? "bez komprese" : "komprimovaně"}, ${excludeNormals ? "bez normál" : "s normálami"})`, () => {
      const n = 12;
      const scene = progressiveScene(noCompression, excludeNormals, n);
      const m = parseU3D(encodeTestU3D(scene));
      expect(m.warnings).toBeUndefined();
      const tris = triangles(m.parts[0]);
      expect(tris).toHaveLength(n - 2 + 1);
      const splits = scene.meshes[0].splits!;
      const P = (i: number) => splits[i].position;
      const expected: V3[][] = [];
      for (let i = 2; i < n; i++) expected.push(i & 1 ? [P(i - 1), P(i), P(i - 2)] : [P(i), P(i - 1), P(i - 2)]);
      // posunutá plocha: roh n−1 → n
      const moved = expected[n - 3];
      expected[n - 3] = moved.map((v) => (v === P(n - 1) ? P(n) : v));
      expected.push([P(n), P(n - 1), P(n - 2)]);
      const r = matchTriangles(tris, expected.map((p) => ({ p, n: [] })), 1e-3);
      expect(r.maxErr).toBeLessThan(1 / 1024);
      if (excludeNormals) {
        expect(m.parts[0].normals ?? null).toBeNull();
      } else {
        // jediná nová normála na pozici s nulovým rozdílem = predikce z normál okolních ploch
        for (const t of tris) for (const vn of t.n!) expect(Math.hypot(vn[0], vn[1], vn[2])).toBeCloseTo(1, 5);
        expect(tris[0].n![0][2]).toBeCloseTo(1, 5);
      }
    });
  }

  it("aritmetické kódování: tisíce symbolů, escape, přeškálování histogramu i velké statické kontexty", () => {
    // 20 000 pozic → kontext indexu pozice ≥ uACMaxRange (nekomprimovaný U32 uprostřed komprimovaných dat)
    const P: V3[] = [];
    for (let i = 0; i < 20000; i++) P.push([i % 200, Math.floor(i / 200), (i * 7) % 13]);
    const shadingCount = 300;
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    const faces: TestMesh["faces"] = [];
    for (let f = 0; f < 12000; f++) {
      // šikmé rozdělení → časté i vzácné symboly (escape + přeškálování po 0x1FFF výskytech)
      const sh = rnd(4) === 0 ? rnd(shadingCount) : rnd(3);
      faces.push({ shading: sh, p: [rnd(20000), rnd(20000), rnd(20000)] });
    }
    const materials = Array.from({ length: shadingCount }, (_, i) => ({ name: `m${i}`, diffuse: [(i % 10) / 10, Math.floor(i / 10) / 30, 0.5] as V3 }));
    const scene: TestScene = {
      nodes: [{ name: "zatez", kind: "model", parents: [{ name: "", matrix: IDENTITY }], resource: "z", shaderLists: materials.map((m) => [m.name]) }],
      meshes: [{ name: "z", shadingCount, excludeNormals: true, positions: P, faces }],
      shaders: materials.map((m) => ({ name: m.name, material: m.name })),
      materials,
    };
    for (const noCompression of [false, true]) {
      const m = parseU3D(encodeTestU3D({ ...scene, noCompression }));
      expect(m.warnings).toBeUndefined();
      const byColor = new Map<string, number>();
      for (const part of m.parts) byColor.set(part.color!.map((c) => c.toFixed(4)).join(","), part.indices!.length / 3);
      const expectedCounts = new Map<string, number>();
      for (const f of faces) {
        const key = [...materials[f.shading].diffuse].map((c) => Math.fround(c).toFixed(4)).join(",");
        expectedCounts.set(key, (expectedCounts.get(key) ?? 0) + 1);
      }
      expect(byColor).toEqual(expectedCounts);
      // pořadí a hodnoty rohů ploch
      const part0 = m.parts.find((p) => p.color!.every((c, k) => c.toFixed(4) === Math.fround(materials[faces[0].shading].diffuse[k]).toFixed(4)))!;
      const t0 = triangles(part0)[0];
      expect(t0.p).toEqual(faces[0].p.map((i) => P[i]));
    }
  });

  it("jména dílů: UTF-8 podle normy, neplatné UTF-8 se čte jako windows-1250", () => {
    const scene = twoPartScene(false);
    scene.nodes[2].name = "Xroub M8";
    const bytes = encodeTestU3D(scene);
    const marker = new TextEncoder().encode("Xroub M8");
    let patched = 0;
    for (let i = 0; i + marker.length <= bytes.length; i++) {
      if (marker.every((b, k) => bytes[i + k] === b)) {
        bytes[i] = 0x8a; // „Š" ve windows-1250
        patched++;
      }
    }
    expect(patched).toBeGreaterThanOrEqual(2);
    const m = parseU3D(bytes);
    expect(m.parts.map((p) => p.name)).toEqual(["Díl A (1)", "Díl A (2)", "Šroub M8"]);
  });

  it("chybné ID stínování v základní síti → blok se přeskočí, bez geometrie chyba", () => {
    const scene = twoPartScene(false);
    scene.meshes[0].faces[3].shading = 7;
    expect(() => parseU3D(encodeTestU3D(scene))).toThrowError(/data geometrie jsou poškozená/);
  });

  it("poškozený progresivní blok → zůstane poslední úplné rozlišení a varování", () => {
    const scene = progressiveScene(false, false, 40);
    const bytes = encodeTestU3D(scene);
    const full = triangles(parseU3D(bytes).parts[0]).length;
    // přepsat konec progresivního bloku nesmyslem
    const bad = bytes.slice();
    for (let i = bad.length - 40; i < bad.length - 4; i++) bad[i] = 0xff;
    const m = parseU3D(bad);
    expect(m.warnings?.join(" ")).toMatch(/Část sítě se nepodařilo přečíst/);
    const tris = triangles(m.parts[0]);
    expect(tris.length).toBeGreaterThan(0);
    expect(tris.length).toBeLessThan(full);
  });

  it("zkrácený soubor → varování, nečitelná data → ModelImportError", () => {
    // poslední blok = základní síť nepoužitého zdroje → po zkrácení zůstanou oba díly
    const scene = twoPartScene(false);
    scene.meshes.push({ ...boxMesh("navic"), name: "navic" });
    const bytes = encodeTestU3D(scene);
    const truncated = parseU3D(bytes.slice(0, bytes.length - 100));
    expect(truncated.warnings?.join(" ")).toMatch(/zkrácený/);
    expect(truncated.parts).toHaveLength(3);
    expect(() => parseU3D(new Uint8Array(100))).toThrowError(ModelImportError);
    expect(() => parseU3D(new TextEncoder().encode("%PDF-1.7 nic"))).toThrowError(/U3D/);
    const junk = bytes.slice();
    for (let i = 60; i < junk.length; i++) junk[i] = (i * 37) & 0xff;
    expect(() => parseU3D(junk)).toThrowError(ModelImportError);
  });

  it("rychlost: 60 000 rozdělení vrcholů s normálami", () => {
    const scene = progressiveScene(false, false, 60000);
    const bytes = encodeTestU3D(scene);
    const t0 = performance.now();
    const m = parseU3D(bytes);
    const ms = performance.now() - t0;
    expect(triangles(m.parts[0])).toHaveLength(60000 - 1);
    expect(ms).toBeLessThan(15000);
  });
});
