import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { placementMatrix } from "../assembly";
import { blobOf, putBlob } from "../blobs";
import { partEntry } from "../asm-kernel";
import { decodeStepString, indexStep, stepTree, StepFormatError, typeOf } from "./step-tree";
import { assemblyDocFromSplit, leafCount, placementOfMatrix, splitStepAssembly } from "./step-assembly";
import { stepHasAssembly, stepIsComplete } from "./step-check";
import { importSTEPBody } from "./kernel-import";
import { prepareImport } from "./import";
// generátor zátěžových sestav (stejný jako pro e2e) – tady malá sestava ~1 MB
// @ts-expect-error – skript .mjs bez typů
import { generateBigStep } from "../../../scripts/gen-big-step.mjs";
import type { CadDoc } from "../types";

let asm: Uint8Array;
let asmM: Uint8Array;

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
  // generátor má vlastní instanci jádra (vlastní setOC) – po generování se vrátí naše
  asm = (await generateBigStep({ mb: 1.2, seed: 3 })).data as Uint8Array;
  asmM = (await generateBigStep({ mb: 1.2, seed: 3, unit: "m" })).data as Uint8Array;
  r.setOC(oc as never);
}, 240_000);

const enc = new TextEncoder();
/** ruční minimální sestava: kořen v metrech, dva výskyty dílu (druhý otočený o 90° kolem Z, posunutý o 2 m), rep_1/rep_2 prohozené u druhého */
const MINI = (end = true) =>
  enc.encode(`ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('mini','',(''),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1=PRODUCT('ROOT','Sestava \\X2\\010D\\X0\\','',(#9));
#2=PRODUCT_DEFINITION_FORMATION('','',#1);
#3=PRODUCT_DEFINITION('design','',#2,#8);
#4=PRODUCT('P1','Hřídel''s','',(#9));
#5=PRODUCT_DEFINITION_FORMATION('','',#4);
#6=PRODUCT_DEFINITION('design','',#5,#8);
#8=PRODUCT_DEFINITION_CONTEXT('',#7,'design');
#7=APPLICATION_CONTEXT('x');
#9=PRODUCT_CONTEXT('',#7,'mechanical');
#10=PRODUCT_DEFINITION_SHAPE('','',#3);
#11=PRODUCT_DEFINITION_SHAPE('','',#6);
#12=SHAPE_DEFINITION_REPRESENTATION(#10,#14);
#13=SHAPE_DEFINITION_REPRESENTATION(#11,#15);
#14=SHAPE_REPRESENTATION('',(#20),#40);
#15=SHAPE_REPRESENTATION('',(#20),#41);
#20=AXIS2_PLACEMENT_3D('',#21,#22,#23);
#21=CARTESIAN_POINT('',(0.,0.,0.));
#22=DIRECTION('',(0.,0.,1.));
#23=DIRECTION('',(1.,0.,0.));
#24=AXIS2_PLACEMENT_3D('',#25,#22,#26);
#25=CARTESIAN_POINT('',(2.,0.5,0.));
#26=DIRECTION('',(0.,1.,0.));
#30=NEXT_ASSEMBLY_USAGE_OCCURRENCE('1','a','',#3,#6,$);
#31=NEXT_ASSEMBLY_USAGE_OCCURRENCE('2','b','',#3,#6,$);
#32=PRODUCT_DEFINITION_SHAPE('','',#30);
#33=PRODUCT_DEFINITION_SHAPE('','',#31);
#34=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#36,#32);
#35=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#37,#33);
#36=( REPRESENTATION_RELATIONSHIP('','',#15,#14) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#38) SHAPE_REPRESENTATION_RELATIONSHIP() );
#37=( REPRESENTATION_RELATIONSHIP('','',#14,#15) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#39) SHAPE_REPRESENTATION_RELATIONSHIP() );
#38=ITEM_DEFINED_TRANSFORMATION('','',#20,#20);
#39=ITEM_DEFINED_TRANSFORMATION('','',#24,#20);
#40=( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNIT_ASSIGNED_CONTEXT((#42)) REPRESENTATION_CONTEXT('','') );
#41=( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNIT_ASSIGNED_CONTEXT((#43)) REPRESENTATION_CONTEXT('','') );
#42=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.) );
#43=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );
/* komentář ; s odkazem #99 */
ENDSEC;
${end ? "END-ISO-10303-21;" : ""}
`);

describe("čtení struktury STEP (bez jádra)", () => {
  it("index, typy, řetězce, jednotky a matice výskytů (metry → mm, prohozené rep_1/rep_2)", () => {
    const ix = indexStep(MINI());
    expect(ix.complete).toBe(true);
    expect(ix.count).toBe(36);
    expect(ix.schema).toContain("AUTOMOTIVE_DESIGN");
    expect(typeOf(ix, 36)).toBe("REPRESENTATION_RELATIONSHIP REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION SHAPE_REPRESENTATION_RELATIONSHIP");
    expect(decodeStepString("Sestava \\X2\\010D\\X0\\")).toBe("Sestava č");
    const t = stepTree(ix)!;
    expect(t.roots).toEqual([3]);
    const root = t.products.get(3)!;
    expect(root.name).toBe("Sestava č");
    expect(root.unitMm).toBe(1000);
    expect(t.products.get(6)!.name).toBe("Hřídel's");
    expect(t.products.get(6)!.unitMm).toBe(1);
    expect(t.leafInstances).toBe(2);
    const [a, b] = root.children;
    expect(a.matrix.slice(12, 15)).toEqual([0, 0, 0]);
    // druhý výskyt: dítě je rep_2 → umístění = item_1 · item_2⁻¹ = #24 (posun 2 m, 0,5 m; X → Y)
    const inv = placementOfMatrix(b.matrix);
    const fwd = placementMatrix(inv);
    // zpětná kontrola: matice z umístění = matice výskytu
    fwd.forEach((v, i) => expect(v).toBeCloseTo(b.matrix[i], 6));
    expect(Math.abs(inv.rotation[2])).toBeCloseTo(90, 6);
    expect(Math.hypot(b.matrix[12], b.matrix[13])).toBeCloseTo(Math.hypot(2000, 500), 6);
  });

  it("useknutý soubor: index bez poslední entity, `complete: false`; ne-STEP vyhodí StepFormatError", () => {
    const full = MINI();
    const cut = full.subarray(0, Math.floor(full.length * 0.7));
    const ix = indexStep(cut);
    expect(ix.complete).toBe(false);
    expect(ix.count).toBeLessThan(36);
    expect(stepIsComplete(cut)).toBe(false);
    expect(stepIsComplete(MINI(false))).toBe(false);
    expect(stepIsComplete(full)).toBe(true);
    expect(() => indexStep(enc.encode("nic"))).toThrow(StepFormatError);
    expect(stepHasAssembly(full)).toBe(true);
    expect(stepHasAssembly(enc.encode("ISO-10303-21; DATA; #1=PRODUCT('a');"))).toBe(false);
  });
});

describe("sestava STEP → sestava komponent", () => {
  it("strom výrobku vygenerované sestavy: podsestavy, instance, názvy, barvy", () => {
    const split = splitStepAssembly(asm)!;
    expect(split).not.toBeNull();
    expect(split.incomplete).toBe(false);
    expect(split.parts.length).toBeGreaterThanOrEqual(6);
    expect(split.leafInstances).toBeGreaterThan(split.parts.length); // díly vložené vícekrát
    const names = split.parts.map((p) => p.name);
    expect(names).toContain("Podelnik_3000");
    expect(names.some((n) => /^Deska_/.test(n))).toBe(true);
    expect(split.nodes.map((n) => n.name)).toEqual(expect.arrayContaining(["Stroj_MN-4500", "Ram_svarenec", "Stanice_01"]));
    expect(split.parts.every((p) => /^#[0-9a-f]{6}$/.test(p.color ?? ""))).toBe(true);
    // každý vyříznutý díl je samostatný platný STEP
    for (const p of split.parts) expect(stepIsComplete(p.bytes) && /FILE_SCHEMA/.test(new TextDecoder().decode(p.bytes.subarray(0, 400)))).toBe(true);
  });

  it("dokument sestavy: podsestavy sdílí dokument, opakované díly sdílí data, rám 3 m daleko od počátku", () => {
    const split = splitStepAssembly(asm)!;
    const refs = new Map(split.parts.map((p) => [p.pd, putBlob(p.bytes)]));
    const doc = assemblyDocFromSplit(split, "stroj.step", (pd) => refs.get(pd)!);
    expect(doc.kind).toBe("assembly");
    expect(doc.name).toBe("Stroj_MN-4500");
    expect(leafCount(doc)).toBe(split.leafInstances);
    const frame = doc.components!.find((c) => c.name === "Ram_svarenec")!;
    expect(frame.source.kind).toBe("asm");
    const beams = (frame.source as { doc: CadDoc }).doc.components!.filter((c) => c.name === "Podelnik_3000");
    expect(beams.length).toBe(4);
    expect(new Set(beams.map((c) => (c.source as { data: string }).data)).size).toBe(1); // 4 výskyty, jedna data
    expect(Math.min(...beams.map((c) => c.placement.position[0]))).toBeCloseTo(2000, 6);
    // sloupky jsou svislé: otočení kolem Y o −90° (osa X dílu → Z sestavy)
    const post = (frame.source as { doc: CadDoc }).doc.components!.find((c) => c.name === "Sloupek_1200")!;
    const m = placementMatrix(post.placement);
    expect(m[2]).toBeCloseTo(1, 6);
  });

  it("díly ze sestavy: přesná tělesa, umístění = celek (objem a obálka shodné s přečtením celého souboru)", async () => {
    const split = splitStepAssembly(asm)!;
    const refs = new Map(split.parts.map((p) => [p.pd, putBlob(p.bytes)]));
    const doc = assemblyDocFromSplit(split, "stroj.step", (pd) => refs.get(pd)!);
    const whole = importSTEPBody(asm, "stroj.step");
    const vWhole = r.measureVolume(whole);
    let vSum = 0;
    const walk = async (d: CadDoc, depth = 0): Promise<void> => {
      for (const c of d.components ?? []) {
        if (c.source.kind === "asm") await walk(c.source.doc, depth + 1);
        else if (c.source.kind === "file") {
          const e = await partEntry(`t:${c.source.data}`, c.source);
          expect(e.result.status.every((s) => s.ok)).toBe(true);
          vSum += r.measureVolume(e.body!);
        }
      }
    };
    await walk(doc);
    expect(vSum / vWhole).toBeCloseTo(1, 4);
  }, 240_000);

  it("sestava v metrech: stejné posuny v mm jako v milimetrech", () => {
    const a = splitStepAssembly(asm)!;
    const b = splitStepAssembly(asmM)!;
    const pos = (s: typeof a) => s.nodes.flatMap((n) => n.children.map((c) => c.matrix.slice(12, 15))).flat();
    const pa = pos(a);
    const pb = pos(b);
    expect(pb.length).toBe(pa.length);
    pa.forEach((v, i) => expect(pb[i]).toBeCloseTo(v, 3));
  });

  it("malý STEP s jedním dílem zůstává prvkem Import; sestava ≥ 1 MB se otevře jako sestava", async () => {
    const one = enc.encode(new TextDecoder().decode(MINI()).replace(/#3[01]=NEXT_ASSEMBLY_USAGE_OCCURRENCE[^;]*;/g, ""));
    const r1 = await prepareImport(new File([one as BlobPart], "jeden.step"));
    expect(r1.kind).toBe("body");
    expect(r1.kind === "body" && r1.data.startsWith("mnblob:")).toBe(true);
    const r2 = await prepareImport(new File([asm as BlobPart], "stroj.step"), async (bytes) => splitStepAssembly(bytes));
    expect(r2.kind).toBe("assembly");
    expect(r2.kind === "assembly" && leafCount(r2.doc)).toBeGreaterThan(10);
    const cut = asm.subarray(0, Math.floor(asm.length / 2));
    const r3 = await prepareImport(new File([cut as BlobPart], "useknuty.step"), async () => {
      throw new Error("nemá se volat");
    });
    expect(r3.kind).toBe("unsupported");
    expect(r3.kind === "unsupported" && r3.message).toMatch(/je neúplný – chybí konec souboru STEP/);
  });
});

describe("chybové cesty jádra (STEP)", () => {
  it("useknutý STEP → srozumitelná chyba, ne prázdné těleso", () => {
    expect(() => importSTEPBody(asm.subarray(0, asm.length - 300), "a.step")).toThrow(/neúplný/);
  });
  it("STEP bez geometrie → chyba „neobsahuje…“", () => {
    expect(() => importSTEPBody(MINI(), "prazdny.step")).toThrow(/neobsahuje|nepodařilo přečíst/);
  });
  it("poškozený obsah → chyba čtení nebo „neobsahuje“", () => {
    const bad = enc.encode("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=GARBAGE((((;\nENDSEC;\nEND-ISO-10303-21;\n");
    expect(() => importSTEPBody(bad, "zly.step")).toThrow(/STEP|neobsahuje/);
  });
  it("data importu uložená v úložišti se čtou podle odkazu", () => {
    const ref = putBlob(asm);
    expect(blobOf(ref)).toBe(asm);
  });
});
