import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
// generátor velké sestavy (bez závislostí) — tentýž používá E2E 48
import { writeStepAssembly } from "../../../tools/e2e/gen-step-assembly.mjs";
import { decodeStepString, indexStep, parseEntity, readPoint, typeName } from "./step-index";
import { IDENTITY, buildUnitStep, invert, isRigid, mul, planStepSplit, type SplitNode } from "./step-split";
import { bakeAssembly, hydrateTopology, transformTopology, type UnitResult } from "./step-assembly";
import { occtToModel, type OcctResult } from "./occt";
import { computeTopology } from "./topology";
import type { MeshPart } from "./types";

const require = createRequire(import.meta.url);
type Occt = { ReadStepFile: (b: Uint8Array, p: unknown) => OcctResult };
let occt: Occt;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "step-split-"));
const CAXIF = path.join(path.dirname(require.resolve("occt-import-js/package.json")), "test/testfiles/cax-if");

beforeAll(async () => {
  const factory = require("occt-import-js") as (o?: object) => Promise<Occt>;
  occt = await factory({ print: () => {}, printErr: () => {} });
});
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

const enc = (s: string) => new TextEncoder().encode(s);

function bbox(parts: MeshPart[]) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    for (let i = 0; i < p.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        b[k] = Math.min(b[k], p.positions[i + k]);
        b[k + 3] = Math.max(b[k + 3], p.positions[i + k]);
      }
    }
  }
  return b;
}

/** Rozdělené čtení (jako worker): každý díl zvlášť + složení výskytů. */
function readSplit(bytes: Uint8Array, lazy = false) {
  const ix = indexStep(bytes)!;
  const plan = planStepSplit(ix)!;
  const results: (UnitResult | null)[] = plan.units.map((u) => {
    if (u.empty) return null;
    const r = occt.ReadStepFile(buildUnitStep(ix, u), { linearUnit: "millimeter", linearDeflectionType: "absolute_value", linearDeflection: plan.avgSize * 0.001, angularDeflection: 0.35 });
    if (!r.success || !r.meshes?.length) return null;
    const m = occtToModel(r, "STEP");
    return { parts: m.parts, topology: m.parts.map((p) => computeTopology({ positions: p.positions, indices: p.indices, faces: p.faces })) };
  });
  return { ix, plan, ...bakeAssembly(plan, results, "STEP", true, lazy) };
}

function readWhole(bytes: Uint8Array) {
  const r = occt.ReadStepFile(bytes, { linearUnit: "millimeter", linearDeflectionType: "bounding_box_ratio", linearDeflection: 0.001, angularDeflection: 0.35 });
  return occtToModel(r, "STEP");
}

function generated(mb: number, seed: number) {
  const file = path.join(TMP, `a-${mb}-${seed}.stp`);
  const info = writeStepAssembly(file, { targetMB: mb, seed });
  return { bytes: new Uint8Array(fs.readFileSync(file)), info };
}

describe("index STEP", () => {
  it("entity, typy, odkazy; řetězce a komentáře nerozbijí středníky", () => {
    const src = "ISO-10303-21;\nHEADER;\nFILE_NAME('a;b','#9');\nENDSEC;\nDATA;\n#1=PRODUCT('x;y''z','#5',$,(#2));\n/* #77=NIC; */\n#2 = (A()B(#1,#3));\n#3=CARTESIAN_POINT('',(1.5,-2.E1,3.));\nENDSEC;\nEND-ISO-10303-21;\n";
    const ix = indexStep(enc(src))!;
    expect(ix.count).toBe(3);
    expect([...ix.ids.subarray(0, 3)]).toEqual([1, 2, 3]);
    expect(typeName(ix, 0)).toBe("PRODUCT");
    expect(typeName(ix, 1)).toBe(""); // komplexní
    expect([...ix.refs.subarray(ix.refStart[0], ix.refStart[1])]).toEqual([2]);
    expect([...ix.refs.subarray(ix.refStart[1], ix.refStart[2])]).toEqual([1, 3]);
    const pt = [0, 0, 0];
    expect(readPoint(ix, 2, pt)).toBe(3);
    expect(pt).toEqual([1.5, -20, 3]);
    const [rec] = parseEntity(ix, 0);
    expect(rec.name).toBe("PRODUCT");
    expect(rec.args[0]).toEqual({ k: "str", v: "x;y'z" });
    expect(parseEntity(ix, 1).map((r) => r.name)).toEqual(["A", "B"]);
  });

  it("názvy: \\X2\\ (UTF-16) i přímé UTF-8", () => {
    expect(decodeStepString(enc("P\\X2\\0159\\X0\\\\X2\\00ED\\X0\\ruba"))).toBe("Příruba");
    expect(decodeStepString(enc("Příruba"))).toBe("Příruba");
  });

  it("nesmysl → null (načte se celý soubor najednou)", () => {
    expect(indexStep(enc("nic tu není"))).toBeNull();
  });
});

describe("matice", () => {
  it("inverze, skládání, tuhost", () => {
    const m = new Float64Array([0, -1, 0, 10, 1, 0, 0, 20, 0, 0, 1, 30]);
    const r = mul(m, invert(m));
    for (let k = 0; k < 12; k++) expect(r[k]).toBeCloseTo(IDENTITY[k]);
    expect(isRigid(m)).toBe(true);
    expect(isRigid(new Float64Array([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0]))).toBe(false);
  });
});

describe("rozdělení sestavy na díly = totéž jako celý soubor najednou", () => {
  it("vygenerovaná sestava: počet dílů, obálka, názvy, strom", () => {
    const { bytes, info } = generated(0.6, 11);
    const whole = readWhole(bytes);
    const { plan, model, topology } = readSplit(bytes);
    expect(plan.units.length).toBe(info.parts);
    expect(plan.occurrences).toBe(info.instances);
    expect(plan.totalFaces).toBe(info.faces);
    expect(model.parts.length).toBe(whole.parts.length);
    expect(topology.length).toBe(model.parts.length);
    const a = bbox(model.parts), b = bbox(whole.parts);
    for (let k = 0; k < 6; k++) expect(a[k]).toBeCloseTo(b[k], 1);
    // stejné díly na stejných místech (pořadí výskytů je v obou čteních stejné)
    for (let i = 0; i < model.parts.length; i += 7) {
      const pa = bbox([model.parts[i]]), pb = bbox([whole.parts[i]]);
      expect(model.parts[i].name).toBe(whole.parts[i].name);
      for (let k = 0; k < 6; k++) expect(pa[k]).toBeCloseTo(pb[k], 1);
    }
    expect(model.root.name).toBe("SESTAVA-084");
    expect(model.root.children.map((c) => c.name)).toContain("PODSESTAVA-1");
    // barva dílu (STYLED_ITEM) se přenesla
    expect(model.parts.every((p) => p.color)).toBe(true);
  });

  it("palce: umístění i geometrie se převedou na mm", () => {
    const { bytes } = generated(0.3, 5);
    // délková jednotka kontextu (#5) → palec
    const text = new TextDecoder("latin1").decode(bytes).replace(
      "#5=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));",
      "#5=(CONVERSION_BASED_UNIT('INCH',#900001)LENGTH_UNIT()NAMED_UNIT(#900002));\n#900002=DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.);\n#900001=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#900003);\n#900003=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));",
    );
    const inch = Uint8Array.from(text, (c) => c.charCodeAt(0));
    const whole = readWhole(inch);
    const { model } = readSplit(inch);
    const a = bbox(model.parts), b = bbox(whole.parts), mmBox = bbox(readWhole(bytes).parts);
    for (let k = 0; k < 6; k++) expect(a[k]).toBeCloseTo(b[k], 0);
    expect(a[3] - a[0]).toBeCloseTo((mmBox[3] - mmBox[0]) * 25.4, -1);
  });

  it("skutečné sestavy z CAx-IF (CATIA, Pro/E, UG): stejné díly a obálka", () => {
    for (const f of ["as1-oc-214.stp", "as1-tu-203.stp", "as1_pe_203.stp", "dm1-id-214.stp"]) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(CAXIF, f)));
      const whole = readWhole(bytes);
      const { model, plan } = readSplit(bytes);
      expect(plan.warnings, f).toEqual([]);
      expect(plan.uncoveredSolids, f).toBe(0);
      expect(model.parts.length, f).toBe(whole.parts.length);
      const a = bbox(model.parts), b = bbox(whole.parts);
      for (let k = 0; k < 6; k++) expect(Math.abs(a[k] - b[k]), `${f} [${k}]`).toBeLessThan(0.5);
    }
  });

  it("MAPPED_ITEM (výskyty přes REPRESENTATION_MAP, otočení) = jako OpenCascade", () => {
    const { bytes } = generated(0.2, 4);
    const ix = indexStep(bytes)!;
    let t = new TextDecoder("latin1").decode(buildUnitStep(ix, planStepSplit(ix)!.units[0]));
    const rep = t.match(/#(\d+)=ADVANCED_BREP_SHAPE_REPRESENTATION\('',\(#\d+\),#9\);/)![1];
    // díl jen jako zdroj mapování (bez vlastního produktu) + kořen se dvěma výskyty
    t = t.replace(/#\d+=SHAPE_DEFINITION_REPRESENTATION\(#\d+,#\d+\);\n/, "");
    const extra = [
      "#900001=AXIS2_PLACEMENT_3D('',#10,#11,#13);", "#900002=CARTESIAN_POINT('',(500.,0.,0.));", "#900008=DIRECTION('',(0.,1.,0.));",
      "#900003=AXIS2_PLACEMENT_3D('',#900002,#11,#900008);", `#900004=REPRESENTATION_MAP(#900001,#${rep});`,
      "#900005=MAPPED_ITEM('m1',#900004,#900001);", "#900006=MAPPED_ITEM('m2',#900004,#900003);",
      "#900007=SHAPE_REPRESENTATION('',(#900005,#900006,#900001),#9);", "#900010=APPLICATION_CONTEXT('x');",
      "#900011=PRODUCT_CONTEXT('',#900010,'mechanical');", "#900012=PRODUCT('ROOT','ROOT','',(#900011));",
      "#900013=PRODUCT_DEFINITION_FORMATION('','',#900012);", "#900014=PRODUCT_DEFINITION_CONTEXT('part definition',#900010,'design');",
      "#900015=PRODUCT_DEFINITION('design','',#900013,#900014);", "#900016=PRODUCT_DEFINITION_SHAPE('','',#900015);",
      "#900017=SHAPE_DEFINITION_REPRESENTATION(#900016,#900007);",
    ].join("\n");
    t = t.replace("ENDSEC;\nEND-ISO", `${extra}\nENDSEC;\nEND-ISO`);
    const mapped = Uint8Array.from(t, (c) => c.charCodeAt(0));
    const { plan, model } = readSplit(mapped);
    const whole = readWhole(mapped);
    expect(plan.units.length).toBe(1);
    expect(plan.occurrences).toBe(2);
    expect(model.parts.length).toBe(whole.parts.length);
    for (let i = 0; i < 2; i++) {
      const a = bbox([model.parts[i]]), b = bbox([whole.parts[i]]);
      for (let k = 0; k < 6; k++) expect(a[k]).toBeCloseTo(b[k], 1);
    }
  });

  it("drátová geometrie bez ploch se nečte (není to chyba dílu)", () => {
    const ix = indexStep(new Uint8Array(fs.readFileSync(path.join(CAXIF, "as1_pe_203.stp"))))!;
    const plan = planStepSplit(ix)!;
    const empty = plan.units.filter((u) => u.empty);
    expect(empty.length).toBeGreaterThan(0);
    expect(empty.every((u) => u.items.every((it) => typeName(ix, it) === "GEOMETRIC_SET"))).toBe(true);
  });

  it("soubor dílu je samostatný STEP jen s potřebnými entitami", () => {
    const { bytes } = generated(0.3, 9);
    const ix = indexStep(bytes)!;
    const plan = planStepSplit(ix)!;
    const unit = buildUnitStep(ix, plan.units[0]);
    expect(unit.length).toBeLessThan(bytes.length / 4);
    const text = new TextDecoder().decode(unit);
    expect(text.startsWith("ISO-10303-21;")).toBe(true);
    expect(text).toMatch(/SHAPE_DEFINITION_REPRESENTATION/);
    expect(text).toMatch(/STYLED_ITEM/);
    expect(text).not.toMatch(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/);
    const r = occt.ReadStepFile(unit, null);
    expect(r.success && r.meshes!.length).toBe(1);
  });
});

describe("výskyty dílu", () => {
  it("topologie přepočtená maticí = spočítaná znovu z posunuté sítě", () => {
    const { bytes } = generated(0.2, 3);
    const ix = indexStep(bytes)!;
    const plan = planStepSplit(ix)!;
    const r = occt.ReadStepFile(buildUnitStep(ix, plan.units[0]), null);
    const part = occtToModel(r, "STEP").parts[0];
    const topo = computeTopology({ positions: part.positions, indices: part.indices, faces: part.faces });
    const m = new Float64Array([0, -1, 0, 100, 1, 0, 0, -50, 0, 0, 1, 7]);
    const moved = new Float32Array(part.positions.length);
    for (let i = 0; i < moved.length; i += 3) {
      const [x, y, z] = [part.positions[i], part.positions[i + 1], part.positions[i + 2]];
      moved[i] = m[0] * x + m[1] * y + m[2] * z + m[3];
      moved[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
      moved[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
    }
    const direct = computeTopology({ positions: moved, indices: part.indices, faces: part.faces });
    const fast = transformTopology(topo, m, false);
    expect(fast.curves.length).toBe(direct.curves.length);
    expect(fast.faces.length).toBe(direct.faces.length);
    const circles = (t: typeof fast) => t.curves.filter((c) => c.kind === "circle").map((c) => c.center!.map((v) => Math.round(v * 100) / 100).join(",")).sort();
    expect(circles(fast)).toEqual(circles(direct));
    // původní topologie zůstala beze změny (kopie)
    expect(topo.edgeSegments[0]).toBe(computeTopology({ positions: part.positions, indices: part.indices, faces: part.faces }).edgeSegments[0]);
  });

  it("líná topologie: křivky a plochy až při čtení, stejné jako přímý přepočet", () => {
    const { bytes } = generated(0.3, 21);
    const eager = readSplit(bytes, false);
    const lazy = readSplit(bytes, true);
    expect(lazy.prototypes!.length).toBeLessThan(lazy.topology.length);
    expect(lazy.topology.every((t) => t.lazy && t.curves.length === 0)).toBe(true);
    // přenos z workeru = structured clone (gettery se nepřenesou, jen data)
    const hydrated = hydrateTopology(structuredClone(lazy.topology), structuredClone(lazy.prototypes));
    for (let i = 0; i < hydrated.length; i += 5) {
      expect(hydrated[i].curves.length).toBe(eager.topology[i].curves.length);
      expect(hydrated[i].faces.length).toBe(eager.topology[i].faces.length);
      const c1 = hydrated[i].curves.find((c) => c.center), c2 = eager.topology[i].curves.find((c) => c.center);
      if (c1 && c2) c1.center!.forEach((v, k) => expect(v).toBeCloseTo(c2.center![k], 3));
      expect([...hydrated[i].edgeSegments.subarray(0, 6)]).toEqual([...eager.topology[i].edgeSegments.subarray(0, 6)]);
    }
  });

  it("strom: díl použitý vícekrát je jedna jednotka s více výskyty", () => {
    const { bytes, info } = generated(0.3, 2);
    const plan = planStepSplit(indexStep(bytes)!)!;
    const counts = new Map<number, number>();
    const walk = (n: SplitNode) => {
      n.units.forEach((u) => counts.set(u.unit, (counts.get(u.unit) ?? 0) + 1));
      n.children.forEach(walk);
    };
    walk(plan.root);
    expect([...counts.values()].reduce((s, c) => s + c, 0)).toBe(info.instances);
    expect(Math.max(...counts.values())).toBeGreaterThan(1);
  });
});
