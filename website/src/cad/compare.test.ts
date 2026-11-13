/**
 * Porovnání modelu s referenčním modelem (compare.ts) – úkol P2-11 z reportu 604200.001.
 *
 * Zkušební pár: model = oběžné kolo B (fixtures/impeller-B.mncad.json); reference = jeho varianta BEZ 16 otvorů Ø13
 * a S drážkou R8 navíc (půlkruhová drážka do spodní rovinné plochy z = −10,7 na poloměru 195,35), uložená do STEP
 * exportem jádra a znovu načtená. Očekávané hodnoty jsou známé nezávisle:
 *  – drážka: V = π² · 195,35 · 8² = 123 393,75 mm³ (Pappus: půlkruh πr²/2 s těžištěm souměrně kolem poloměru 195,35),
 *  – otvory: objem varianty bez otvorů − objem modelu (obojí měřeno jádrem na samostatně postavených dílech).
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc, clearBuildCache } from "./build";
import { clearCompareCache, compareShapes, compareTransferables, compareWithReference, importReference, mapMeshTolerance, placeShape, type CompareResult, type CompareStep } from "./compare";
import { exportShape } from "./formats/export";
import { boxSize, placementFor, transformBox, type Box } from "./mesh-distance";
import { emptyDoc, type CadDoc, type Feature } from "./types";
import "./ext/index";
import "./feat/index";

type Shape = r.Shape3D;

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

const fixture = (name: string): CadDoc => JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures", name), "utf8")) as CadDoc;
const doc = (features: Feature[]): CadDoc => ({ ...emptyDoc("Test"), features });
const cm3 = (mm3: number) => mm3 / 1000;

// ── oběžné kolo: model B a reference (bez otvorů Ø13, s drážkou R8) ──
const GROOVE_R = 8;
const GROOVE_AT = 195.35;
const GROOVE_Z = -10.7;
const GROOVE_VOLUME = Math.PI ** 2 * GROOVE_AT * GROOVE_R ** 2; // 123 393,75 mm³
const HOLE_IDS = ["js8o3rv", "6eb96aq"]; // Díra 1 (Ø13 skrz od z = 29) + Pole 1 (16×)
const groove: Feature[] = [
  { id: "gs", name: "Skica drážky", type: "sketch", plane: { kind: "base", name: "XZ", offset: 0 }, entities: [{ id: "gc", type: "circle", cx: GROOVE_AT, cy: GROOVE_Z, r: GROOVE_R }] },
  { id: "gr", name: "Drážka R8", type: "revolve", sketchId: "gs", angle: 360, axis: "y", mode: "cut" },
];

let model: Shape;
let modelVolume = 0;
let modelFaces = 0;
let refBody: Shape;
let refVolume = 0;
let holesVolume = 0;
let stepBytes: ArrayBuffer;
let res: CompareResult;
const steps: CompareStep[] = [];

describe("porovnání s referencí – oběžné kolo 604200.001", () => {
  beforeAll(async () => {
    const B = fixture("impeller-B.mncad.json");
    const m = await buildDoc(B);
    model = m.body!;
    modelVolume = m.metrics!.volume;
    modelFaces = m.metrics!.faces;
    const noHoles = await buildDoc({ ...B, features: B.features.filter((f) => !HOLE_IDS.includes(f.id)) });
    holesVolume = noHoles.metrics!.volume - modelVolume;
    const ref = await buildDoc({ ...B, features: [...B.features.filter((f) => !HOLE_IDS.includes(f.id)), ...groove] });
    expect(ref.status.filter((s) => !s.ok)).toEqual([]);
    refBody = ref.body!;
    refVolume = ref.metrics!.volume;
    stepBytes = await exportShape(refBody, "step", "reference");
    clearCompareCache();
    res = await compareWithReference(model, { data: stepBytes, format: "step", fileName: "impeller-ref.step" }, { tolerance: 0.1 }, (s) => steps.push(s));
    const t = res.ms;
    console.log(
      `porovnání oběžného kola: celkem ${t.total} ms (načtení STEP ${t.import}, zarovnání ${t.align}, reference ${t.reference}, rozdíly ${t.booleans} [navíc ${res.extra?.ms}, chybí ${res.missing?.ms}], mapa ${t.map}) · ` +
        `síť modelu ${res.map!.mesh.triangles.length / 3} trojúhelníků / ${res.map!.distances.length} bodů, krok ${res.map!.step.toFixed(2)} mm, síť reference ${res.map!.refTriangles} trojúhelníků, tolerance sítě ${res.map!.meshTolerance} mm`,
    );
  }, 600_000);

  it("zkušební pár: očekávané objemy z nezávislých staveb", () => {
    expect(cm3(modelVolume)).toBeCloseTo(4338.095, 2);
    expect(holesVolume).toBeGreaterThan(120_000); // 16 otvorů Ø13 × ~57,8 mm
    expect(holesVolume).toBeLessThan(124_000);
    expect(refVolume).toBeCloseTo(modelVolume + holesVolume - GROOVE_VOLUME, 0);
  });

  it("objemy obou těles a jejich rozdíl", () => {
    expect(res.model.volume).toBeCloseTo(modelVolume, 3);
    expect(res.model.faces).toBe(modelFaces);
    expect(res.model.solids).toBe(1);
    expect(res.reference.volume).toBeCloseTo(refVolume, 1); // STEP tam a zpět
    expect(res.reference.solids).toBe(1);
    expect(res.reference.valid).toBe(true);
    expect(res.reference).toMatchObject({ format: "step", fileName: "impeller-ref.step" });
    expect(res.volumeDiff).toBeCloseTo(modelVolume - refVolume, 1);
    expect(res.volumeDiff).toBeCloseTo(GROOVE_VOLUME - holesVolume, 0);
    expect(res.transform).toMatchObject({ mode: "none", identity: true, rot: [0, 0, 0], t: [0, 0, 0] });
    expect(res.warnings).toEqual([]);
  });

  it("materiál navíc (model − reference) = drážka R8: objem podle Pappa, jedna oblast, anuloid r 8", () => {
    const e = res.extra!;
    expect(e.volume).toBeCloseTo(GROOVE_VOLUME, 0); // ±0,5 mm³ ze 123 394
    expect(Math.abs(e.volume - GROOVE_VOLUME) / GROOVE_VOLUME).toBeLessThan(1e-5);
    expect(e.regions.length).toBe(1);
    expect(e.noise).toEqual({ count: 0, volume: 0 });
    const g = e.regions[0];
    expect(g.side).toBe("extra");
    expect(g.volume).toBeCloseTo(GROOVE_VOLUME, 0);
    // prstenec Ø(195,35 ± 8) × 8 na ose Z
    expect(g.size[0]).toBeCloseTo(2 * (GROOVE_AT + GROOVE_R), 2);
    expect(g.size[1]).toBeCloseTo(2 * (GROOVE_AT + GROOVE_R), 2);
    expect(g.size[2]).toBeCloseTo(GROOVE_R, 3);
    expect(g.center[0]).toBeCloseTo(0, 3);
    expect(g.center[1]).toBeCloseTo(0, 3);
    expect(g.center[2]).toBeCloseTo(GROOVE_Z + GROOVE_R / 2, 3);
    const torus = g.surfaces.find((s) => s.kind === "torus")!;
    expect(torus.r).toBeCloseTo(GROOVE_R, 6);
    expect(torus.R).toBeCloseTo(GROOVE_AT, 6);
    expect(g.surfaces.some((s) => s.kind === "plane")).toBe(true);
    expect(g.mesh!.triangles.length).toBeGreaterThan(100);
  });

  it("chybějící materiál (reference − model) = 16 otvorů Ø13: součet podle nezávislé stavby, 16 stejných oblastí na roztečné kružnici Ø125,2", () => {
    const m = res.missing!;
    expect(m.volume).toBeCloseTo(holesVolume, 0);
    expect(m.regions.length).toBe(16);
    expect(m.noise.count).toBe(0);
    for (const h of m.regions) {
      expect(h.side).toBe("missing");
      expect(h.volume).toBeCloseTo(holesVolume / 16, 1);
      expect(Math.hypot(h.center[0], h.center[1])).toBeCloseTo(62.6, 2);
      expect(h.size[0]).toBeCloseTo(13, 2);
      expect(h.size[1]).toBeCloseTo(13, 2);
      expect(h.bbox[1][2]).toBeCloseTo(29, 3); // otvor začíná na ploše z = 29
      const cyl = h.surfaces.find((s) => s.kind === "cylinder")!;
      expect(cyl.r).toBeCloseTo(6.5, 6);
    }
    // seřazeno od největší oblasti
    const all = [...res.extra!.regions, ...res.missing!.regions];
    expect(all.every((x) => x.volume > 1)).toBe(true);
    expect(res.missing!.regions.map((x) => x.volume)).toEqual([...res.missing!.regions.map((x) => x.volume)].sort((a, b) => b - a));
  });

  it("kontrola: objem navíc − objem chybí = rozdíl objemů (zbytek pod 1 mm³)", () => {
    expect(Math.abs(res.residual!)).toBeLessThan(1);
    expect(res.extra!.volume - res.missing!.volume).toBeCloseTo(res.volumeDiff, 0);
  });

  it("mapa odchylek: síť modelu se stejnými plochami, vzdálenosti ~0 na nezměněných plochách, hloubka drážky u drážky, otvory uvnitř reference", () => {
    const map = res.map!;
    const { mesh, distances } = map;
    expect(distances.length).toBe(mesh.vertices.length / 3);
    expect(mesh.normals.length).toBe(mesh.vertices.length);
    expect(map.meshTolerance).toBeCloseTo(0.025, 6); // tolerance 0,1 / 4
    expect(map.accuracy).toBeCloseTo(0.05, 6);
    expect(map.capped).toBe(false);
    expect(mesh.triangles.length / 3).toBeLessThanOrEqual(400_000);
    // skupiny ploch: každá plocha modelu jednou, indexy v rozsahu, pokrývají celou síť
    const groups = mesh.faceGroups;
    const faceIds = Array.from(groups).filter((_, i) => i % 3 === 2);
    expect(new Set(faceIds).size).toBe(modelFaces);
    expect(Math.min(...faceIds)).toBe(0);
    expect(Math.max(...faceIds)).toBe(modelFaces - 1);
    let covered = 0;
    for (let g = 0; g < groups.length; g += 3) covered += groups[g + 1];
    expect(covered).toBe(mesh.triangles.length);

    // plochy modelu podle druhu: stěny otvorů Ø13 (válec r 6,5 mimo osu), plocha s drážkou (rovina z = −10,7 mezi Ø365,4 a Ø416), ostatní
    const faces = model.faces;
    const kind = faces.map((f) => {
      const c = f.center;
      if (f.geomType === "CYLINDRE" && Math.abs(Math.hypot(c.x, c.y) - 62.6) < 7 && c.z < 29 && c.z > -28.83) return "hole";
      if (f.geomType === "PLANE" && Math.abs(c.z - GROOVE_Z) < 1e-6) return "groove";
      return "same";
    });
    expect(kind.filter((k) => k === "hole").length).toBe(16);
    expect(kind.filter((k) => k === "groove").length).toBe(1);
    const stat = { same: { n: 0, max: 0 }, hole: { n: 0, max: 0, min: 0 }, groove: { n: 0, max: 0, min: 0 } };
    let grooveBottom = 0; // největší odchylka bodů plochy nad dnem drážky (poloměr 195,35 ± 1)
    let grooveOutside = 0; // body téže plochy mimo drážku
    for (let g = 0; g < groups.length; g += 3) {
      const k = kind[groups[g + 2]] as "same" | "hole" | "groove";
      for (let i = groups[g]; i < groups[g] + groups[g + 1]; i++) {
        const v = mesh.triangles[i];
        const d = distances[v];
        stat[k].n++;
        if (k === "same") stat.same.max = Math.max(stat.same.max, Math.abs(d));
        else {
          stat[k].max = Math.max(stat[k].max, d);
          stat[k].min = Math.min(stat[k].min, d);
        }
        if (k === "groove") {
          const rad = Math.hypot(mesh.vertices[v * 3], mesh.vertices[v * 3 + 1]);
          if (Math.abs(rad - GROOVE_AT) < 1) grooveBottom = Math.max(grooveBottom, d);
          if (Math.abs(rad - GROOVE_AT) > GROOVE_R + 0.05) grooveOutside = Math.max(grooveOutside, Math.abs(d));
        }
      }
    }
    console.log(`mapa: nezměněné plochy max |d| = ${stat.same.max.toFixed(4)} mm (${stat.same.n} vrcholů trojúhelníků), drážka max ${stat.groove.max.toFixed(3)} mm, otvory min ${stat.hole.min.toFixed(3)} mm, v toleranci ${(map.stats.withinArea! * 100).toFixed(1)} % plochy (${(map.stats.within * 100).toFixed(1)} % bodů)`);
    // nezměněné plochy: odchylka pod uváděnou přesností mapy (a hluboko pod tolerancí 0,1 mm)
    expect(stat.same.n).toBeGreaterThan(100_000);
    expect(stat.same.max).toBeLessThan(map.accuracy);
    // plocha s drážkou: nad dnem drážky je k referenci 8 mm (hloubka drážky), kladně = model je vně reference (materiál navíc)
    expect(grooveBottom).toBeGreaterThan(GROOVE_R - 0.15);
    expect(grooveBottom).toBeLessThanOrEqual(GROOVE_R + 0.01);
    expect(stat.groove.max).toBeLessThanOrEqual(GROOVE_R + 0.01);
    expect(stat.groove.min).toBeGreaterThan(-map.accuracy);
    expect(grooveOutside).toBeLessThan(map.accuracy);
    // stěny otvorů leží uvnitř reference (materiál chybí): záporně, nejvýš polovina délky otvoru 57,83 / 2
    expect(stat.hole.min).toBeLessThan(-28);
    expect(stat.hole.min).toBeGreaterThan(-28.92);
    expect(stat.hole.max).toBeLessThan(map.accuracy);
    // souhrn
    expect(map.stats.maxOut).toBeCloseTo(stat.groove.max, 6);
    expect(map.stats.maxIn).toBeCloseTo(stat.hole.min, 6);
    expect(map.stats.max).toBeCloseTo(-stat.hole.min, 6);
    // podíl plochy v toleranci: mimo jsou stěny 16 otvorů (16 × π·13·57,8 ≈ 37 800 mm²) a pás nad drážkou (π(203,35² − 187,35²) ≈ 19 600 mm²) z 451 343 mm²
    expect(map.stats.area!).toBeCloseTo(451_343, -3);
    expect(map.stats.withinArea!).toBeGreaterThan(0.86);
    expect(map.stats.withinArea!).toBeLessThan(0.885);
    faces.forEach((f) => f.delete());
  });

  it("síť mapy má plochy ve stejném pořadí jako zobrazovací síť modelu (výběr ploch funguje i s mapou)", async () => {
    const shown = (await buildDoc(fixture("impeller-B.mncad.json"))).mesh!;
    const boxOf = (m: { vertices: Float32Array; triangles: Uint32Array; faceGroups: Int32Array }) => {
      const out = new Map<number, number[]>();
      for (let g = 0; g < m.faceGroups.length; g += 3) {
        const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (let i = m.faceGroups[g]; i < m.faceGroups[g] + m.faceGroups[g + 1]; i++)
          for (let k = 0; k < 3; k++) {
            const v = m.vertices[m.triangles[i] * 3 + k];
            b[k] = Math.min(b[k], v);
            b[k + 3] = Math.max(b[k + 3], v);
          }
        out.set(m.faceGroups[g + 2], b);
      }
      return out;
    };
    const a = boxOf(shown);
    const b = boxOf(res.map!.mesh);
    expect(b.size).toBe(a.size);
    for (const [face, ba] of a) {
      const bb = b.get(face)!;
      for (let k = 0; k < 6; k++) expect(Math.abs(bb[k] - ba[k])).toBeLessThan(0.7); // hrubší síť má krajní body o tětivu jinde (tolerance 0,31 mm)
    }
    expect(Array.from(res.map!.mesh.edgeGroups).filter((_, i) => i % 3 === 2).every((e) => e >= 0)).toBe(true);
  }, 120_000);

  it("průběh po krocích, časy a přenos polí", () => {
    expect(steps.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(steps.every((s) => s.total === 7 && s.name.length > 3)).toBe(true);
    expect(res.ms.total).toBeLessThan(120_000); // běžně ~7 s; rezerva pro zatížený stroj
    const bufs = compareTransferables(res);
    expect(bufs.length).toBe(new Set(bufs).size);
    expect(bufs.length).toBe(3 + 3 * 17 + 7); // průhledná reference, 17 oblastí, síť mapy + vzdálenosti
    expect(res.ghost!.triangles.length).toBeGreaterThan(1000);
  });

  it("reference v jiné poloze (otočená o 90° kolem X a posunutá): automatické zarovnání dá stejné rozdíly", async () => {
    const moved = placeShape(refBody, { rot: [90, 0, 0], t: [100, -50, 30] });
    const bytes = await exportShape(moved, "step", "moved");
    moved.delete();
    const asIs = await compareWithReference(model, { data: bytes, format: "step", fileName: "moved.step" }, { map: false, booleans: "never" });
    expect(asIs.booleansSkipped).toBe("off");
    expect(asIs.extra).toBeNull();
    expect(asIs.map).toBeNull();
    expect(asIs.reference.volume).toBeCloseTo(refVolume, 1); // objem na poloze nezávisí
    expect(asIs.reference.bbox[1][1] - asIs.reference.bbox[0][1]).toBeCloseTo(168.59, 1); // osa kola teď míří ve směru Y
    const auto = await compareWithReference(model, { data: bytes, format: "step", fileName: "moved.step" }, { align: { mode: "auto" }, tolerance: 0.1 });
    expect(auto.transform.identity).toBe(false);
    expect(auto.transform.tried).toBeGreaterThan(1);
    expect(auto.transform.score!).toBeLessThan(auto.transform.asIsScore! / 10);
    expect(auto.reference.bbox[0][2]).toBeCloseTo(-55.59, 2);
    expect(auto.reference.bbox[1][2]).toBeCloseTo(113, 2);
    expect(auto.extra!.volume).toBeCloseTo(GROOVE_VOLUME, 0);
    expect(auto.missing!.volume).toBeCloseTo(holesVolume, 0);
    expect(auto.extra!.regions.length).toBe(1);
    expect(auto.missing!.regions.length).toBe(16);
    expect(auto.map!.stats.maxOut).toBeCloseTo(res.map!.stats.maxOut, 1);
    expect(auto.warnings).toEqual([]);
    console.log(`automatické zarovnání: otočení ${auto.transform.rot.join(" / ")}°, posun ${auto.transform.t.map((v) => v.toFixed(2)).join(" / ")} mm, skóre ${auto.transform.score!.toFixed(4)} (jak je ${auto.transform.asIsScore!.toFixed(2)}), ${auto.ms.align} ms z ${auto.ms.total} ms`);
    // ruční zadání téže polohy: otočení zpět o 270° kolem X + středy kvádrů
    const manual = await compareWithReference(model, { data: bytes, format: "step", fileName: "moved.step" }, { align: { mode: "center", rotate: [270, 0, 0] }, map: false });
    expect(manual.extra!.volume).toBeCloseTo(GROOVE_VOLUME, 0);
    expect(manual.missing!.volume).toBeCloseTo(holesVolume, 0);
    // špatná poloha (bez zarovnání) se pozná: varování a velké rozdíly
    const wrong = await compareWithReference(model, { data: bytes, format: "step", fileName: "moved.step" }, { map: false });
    expect(wrong.extra!.volume + wrong.missing!.volume).toBeGreaterThan(0.5 * modelVolume);
    expect(wrong.warnings.join(" ")).toMatch(/jinak umístěná/);
  }, 600_000);

  it("placeShape odpovídá matici umístění (otočení X → Y → Z kolem počátku, potom posun)", () => {
    const b0 = refBody.boundingBox.bounds as unknown as Box;
    for (const rot of [[90, 0, 0], [0, 90, 0], [0, 0, 90], [90, 180, 270], [270, 90, 180]] as [number, number, number][]) {
      const p = placementFor(false, rot, [12.5, -40, 7], b0, b0);
      const s = placeShape(refBody, p);
      const got = s.boundingBox.bounds as unknown as Box;
      const want = transformBox(b0, p.m, p.t);
      for (let k = 0; k < 3; k++) {
        expect(got[0][k]).toBeCloseTo(want[0][k], 3);
        expect(got[1][k]).toBeCloseTo(want[1][k], 3);
      }
      s.delete();
    }
    // středy kvádrů na sebe: reference posunutá mimo se vrátí na model
    const far = placeShape(refBody, { rot: [0, 0, 0], t: [1000, 2000, -500] });
    const fb = far.boundingBox.bounds as unknown as Box;
    const p = placementFor(true, [0, 0, 0], [0, 0, 0], model.boundingBox.bounds as unknown as Box, fb);
    expect(p.t[0]).toBeCloseTo(-1000, 3);
    expect(p.t[1]).toBeCloseTo(-2000, 3);
    expect(p.t[2]).toBeCloseTo(500, 3);
    expect(boxSize(fb)[2]).toBeCloseTo(168.59, 2);
    far.delete();
  });
});

describe("porovnání s referencí – malé díly, formáty a chybové stavy", () => {
  const plate = (extra: Feature[] = []): CadDoc => doc([{ id: "b", name: "Deska", type: "box", size: [100, 60, 20], position: [0, 0, 0], centered: false, mode: "new" }, ...extra]);
  const hole = (id: string, x: number, y: number, d: number): Feature => ({ id, name: id, type: "hole", position: [x, y, 20], axis: "Z", flip: false, diameter: d, depth: 0, cbDiameter: 0, cbDepth: 0 });
  let plain: Shape;
  let holed: Shape;

  beforeAll(async () => {
    clearBuildCache();
    plain = (await buildDoc(plate())).body!;
    holed = (await buildDoc(plate([hole("h1", 30, 30, 10), hole("h2", 70, 30, 6)]))).body!;
  }, 120_000);

  it("BREP: deska bez děr proti desce se dvěma dírami – dvě oblasti „navíc“ (Ø10 a Ø6), nic nechybí", async () => {
    const brep = await exportShape(holed, "brep", "ref");
    const c = await compareWithReference(plain, { data: brep, format: "brep", fileName: "ref.brep" }, { tolerance: 0.05 });
    const v10 = Math.PI * 25 * 20;
    const v6 = Math.PI * 9 * 20;
    expect(c.model.volume).toBeCloseTo(120_000, 3);
    expect(c.reference.volume).toBeCloseTo(120_000 - v10 - v6, 2);
    expect(c.volumeDiff).toBeCloseTo(v10 + v6, 2);
    expect(c.extra!.volume).toBeCloseTo(v10 + v6, 2);
    expect(c.extra!.regions.map((g) => Math.round(g.volume * 100) / 100)).toEqual([Math.round(v10 * 100) / 100, Math.round(v6 * 100) / 100]);
    expect(c.extra!.regions.map((g) => g.center.map((v) => Math.round(v * 1000) / 1000))).toEqual([[30, 30, 10], [70, 30, 10]]);
    expect(c.extra!.regions.map((g) => g.surfaces.find((s) => s.kind === "cylinder")!.r)).toEqual([5, 3]);
    expect(c.missing!.volume).toBeLessThan(1e-6);
    expect(c.missing!.regions).toEqual([]);
    // mapa: horní stěna desky nad dírou Ø10 je 5 mm od stěny díry (střed díry), mimo díry 0
    expect(c.map!.stats.maxOut).toBeGreaterThan(4.5);
    expect(c.map!.stats.maxOut).toBeLessThanOrEqual(5.001);
    expect(c.map!.stats.maxIn).toBeGreaterThan(-c.map!.accuracy);
    expect(c.map!.meshTolerance).toBeCloseTo(0.0125, 6);
  }, 120_000);

  it("obráceně (model s dírami, reference bez): dvě oblasti „chybí“, mapa záporná na stěnách děr", async () => {
    const step = await exportShape(plain, "step", "ref");
    const c = await compareWithReference(holed, { data: step, format: "step", fileName: "plain.step" });
    expect(c.extra!.regions).toEqual([]);
    expect(c.missing!.regions.length).toBe(2);
    expect(c.missing!.volume).toBeCloseTo(Math.PI * (25 + 9) * 20, 2);
    expect(c.map!.stats.maxIn).toBeLessThan(-9.9); // stěna díry v polovině tloušťky 20 mm
    expect(c.map!.stats.maxOut).toBeLessThan(c.map!.accuracy);
  }, 120_000);

  it("stejné těleso: žádné rozdíly, vše v toleranci", async () => {
    const step = await exportShape(holed, "step", "same");
    const c = await compareWithReference(holed, { data: step, format: "step", fileName: "same.step" }, { tolerance: 0.01 });
    expect(Math.abs(c.volumeDiff)).toBeLessThan(1e-3);
    expect(c.extra!.regions).toEqual([]);
    expect(c.missing!.regions).toEqual([]);
    expect(c.extra!.volume + c.missing!.volume).toBeLessThan(1e-3);
    expect(c.map!.stats.within).toBe(1);
    expect(c.map!.stats.withinArea).toBe(1);
    expect(c.map!.stats.max).toBeLessThan(0.01);
    expect(c.warnings).toEqual([]);
  }, 120_000);

  it("středy kvádrů + ruční posun: reference posunutá o [200, −80, 15] se zarovná; posun 0,5 mm v X dá slupky 0,5 × 60 × 20", async () => {
    const moved = placeShape(holed, { rot: [0, 0, 0], t: [200, -80, 15] });
    const bytes = await exportShape(moved, "step", "moved");
    moved.delete();
    const centered = await compareWithReference(holed, { data: bytes, format: "step", fileName: "m.step" }, { align: { mode: "center" }, map: false });
    expect(centered.transform.t.map((v) => Math.round(v * 1000) / 1000)).toEqual([-200, 80, -15]);
    expect(centered.extra!.volume + centered.missing!.volume).toBeLessThan(1e-3);
    const shifted = await compareWithReference(holed, { data: bytes, format: "step", fileName: "m.step" }, { align: { mode: "center", offset: [0.5, 0, 0] }, tolerance: 0.1 });
    expect(shifted.transform.t[0]).toBeCloseTo(-199.5, 6);
    // deska: slupka 0,5 × 60 × 20 na každé straně; díry: srpky o objemu ≈ průměr × posun × tloušťka
    const crescents = (10 + 6) * 0.5 * 20;
    expect(shifted.extra!.volume).toBeCloseTo(600 + crescents, -1);
    expect(shifted.missing!.volume).toBeCloseTo(600 + crescents, -1);
    expect(Math.abs(shifted.residual!)).toBeLessThan(0.01);
    expect(shifted.extra!.regions.length).toBe(3); // slupka desky + dva srpky
    expect(shifted.map!.stats.max).toBeCloseTo(0.5, 2);
    expect(shifted.map!.stats.within).toBeLessThan(1);
  }, 120_000);

  it("práh šumu: drobná tělesa a tenké slupky jdou do numerického šumu, ne do seznamu", async () => {
    const moved = placeShape(holed, { rot: [0, 0, 0], t: [0.004, 0, 0] }); // posun o 4 µm → slupky 0,004 mm (4,8 mm³)
    const c = compareShapes(holed, moved, { map: false });
    moved.delete();
    expect(c.extra!.regions).toEqual([]);
    expect(c.extra!.noise.count).toBeGreaterThanOrEqual(1);
    expect(c.extra!.noise.volume).toBeCloseTo(0.004 * 60 * 20 + (10 + 6) * 0.004 * 20, 1);
    expect(c.extra!.volume).toBeCloseTo(c.extra!.noise.volume, 6);
    // bez prahů se totéž vypíše jako oblasti
    const all = compareShapes(holed, placeShape(holed, { rot: [0, 0, 0], t: [0.004, 0, 0] }), { map: false, noiseVolume: 0, noiseThickness: 0 });
    expect(all.extra!.regions.length).toBeGreaterThanOrEqual(1);
    expect(all.extra!.noise.count).toBe(0);
    // malé těleso pod objemovým prahem: díra Ø0,8 × 1 (0,5 mm³)
    const tiny = (await buildDoc(plate([{ id: "t", name: "t", type: "hole", position: [50, 30, 20], axis: "Z", flip: false, diameter: 0.8, depth: 1, cbDiameter: 0, cbDepth: 0 }]))).body!;
    const t = compareShapes(plain, tiny, { map: false });
    expect(t.extra!.regions).toEqual([]);
    expect(t.extra!.noise.count).toBe(1);
    expect(t.extra!.noise.volume).toBeGreaterThan(0.4);
    expect(t.extra!.noise.volume).toBeLessThan(0.7);
    expect(compareShapes(plain, tiny, { map: false, noiseVolume: 0.1 }).extra!.regions.length).toBe(1);
  }, 120_000);

  it("STL (síťová reference): objemy a mapa platí; rozdílová tělesa se u mnoha ploch vynechají s varováním", async () => {
    const cyl = (await buildDoc(doc([{ id: "c", name: "Válec", type: "cylinder", radius: 20, height: 30, position: [0, 0, 0], axis: "Z", mode: "new" }]))).body!;
    const stl = await exportShape(cyl, "stl", "ref");
    const c = await compareWithReference(cyl, { data: stl, format: "stl", fileName: "ref.stl" }, { tolerance: 0.1, maxBooleanFaces: 20 });
    expect(c.booleansSkipped).toBe("faces");
    expect(c.extra).toBeNull();
    expect(c.missing).toBeNull();
    expect(c.residual).toBeNull();
    expect(c.warnings.join(" ")).toMatch(/síťový model/);
    // vepsaný mnohostěn: objem reference o něco menší, odchylka do tětivy sítě STL
    expect(c.volumeDiff).toBeGreaterThan(0);
    expect(c.volumeDiff / c.model.volume).toBeLessThan(0.01);
    expect(c.map!.stats.max).toBeLessThan(0.05);
    expect(c.map!.stats.within).toBe(1);
    // vynucené rozdíly: jen tenké slupky mezi válcem a mnohostěnem → šum, žádné oblasti
    const forced = await compareWithReference(cyl, { data: stl, format: "stl", fileName: "ref.stl" }, { map: false, booleans: "always", maxBooleanFaces: 20 });
    expect(forced.booleansSkipped).toBeUndefined();
    expect(forced.extra!.volume).toBeCloseTo(c.volumeDiff, 0);
    expect(forced.extra!.regions.filter((g) => g.volume > 5)).toEqual([]);
  }, 180_000);

  it("chybové stavy: nečitelný soubor, reference bez objemu, mezipaměť reference", async () => {
    await expect(importReference({ data: new TextEncoder().encode("toto není STEP"), format: "step", fileName: "x.step" })).rejects.toThrow(/STEP se nepodařilo načíst|neobsahuje/);
    await expect(importReference({ data: new TextEncoder().encode("xxx"), format: "brep", fileName: "x.brep" })).rejects.toThrow();
    await expect(importReference({ data: new Uint8Array(4), format: "iges" as never, fileName: "x.igs" })).rejects.toThrow(/IGES/);
    // stejná data podruhé → stejné těleso z mezipaměti (soubor se nečte znovu)
    const brep = await exportShape(holed, "brep", "ref");
    const a = await importReference({ data: brep, format: "brep", fileName: "a.brep" });
    const b = await importReference({ data: new Uint8Array(brep.slice(0)), format: "brep", fileName: "b.brep" });
    expect(b).toBe(a);
    clearCompareCache();
    const c = await importReference({ data: brep, format: "brep", fileName: "a.brep" });
    expect(c).not.toBe(a);
  }, 120_000);

  it("mapMeshTolerance: čtvrtina tolerance v mezích ⟨úhlopříčka / 100 000 (≥ 1 µm); síť pro zobrazení⟩", () => {
    expect(mapMeshTolerance(630, 0.1)).toBeCloseTo(0.025, 9);
    expect(mapMeshTolerance(630, 0.01)).toBeCloseTo(0.0063, 9); // dolní mez u velkého dílu
    expect(mapMeshTolerance(630, 10)).toBeCloseTo(0.315, 9); // ne hrubší než zobrazení
    expect(mapMeshTolerance(50, 0.001)).toBeCloseTo(0.001, 9);
    expect(mapMeshTolerance(630, 0.1, 0.05)).toBeCloseTo(0.05, 9);
  });
});

describe("reference s více než 1000 plochami (zrychlená cesta shapeResult pro velká tělesa)", () => {
  it("shodný hranol s 1100 obloukovými stranami: nulový rozdíl objemů, bez varování o nepřesné booleovské operaci, platnost zkontrolována", () => {
    const model = r.drawPolysides(50, 1100, -0.02).sketchOnPlane("XY").extrude(20) as Shape;
    const ref = model.clone() as Shape;
    const exact = r.measureVolume(model);
    const c = compareShapes(model, ref, { map: false });
    expect(c.reference.faces).toBeGreaterThan(1000);
    expect(c.reference.volume).toBeCloseTo(exact, 6);
    expect(Math.abs(c.volumeDiff)).toBeLessThan(1e-6 * exact);
    expect(c.reference.area).toBeCloseTo(c.model.area, 6);
    expect(c.reference.valid).toBe(true);
    expect(c.warnings.join(" ")).not.toMatch(/nepřesná|nesedí/);
  }, 240_000);
});
