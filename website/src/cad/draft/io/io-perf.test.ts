/**
 * Balík 4 (io) – výkon: import 10 MB DXF < 5 s (CAD-2D-NAVRH.md kap. 10) a 20 MB DWG < 15 s (zadání vlny 9),
 * zápis velkého DWG lineárně (oprava acad-ts). Výkresy se generují (smíšené entity jako v reálném výkresu: křivky
 * s mnoha vrcholy, úsečky, texty, kružnice, oblouky, vložení bloku) – bez velkých binárních souborů v repozitáři.
 * Těžký test (pár set MB paměti) – spouštět samostatně: npx vitest run src/cad/draft/io/io-perf.test.ts
 * IO_PERF_OUT=<složka> uloží vygenerované soubory (big-10mb.dxf, big-20mb.dwg) pro e2e (e2e/cad-w9-io.e2e.cjs).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import "../index";
import { bigModel } from "./__fixtures__/big-model";
import { draftFromFile, draftToDwgFile, draftToDxfFile } from "./files";

describe("výkon importu a exportu", () => {
  it("DXF ≈ 10 MB: zápis a import < 5 s", () => {
    const m = bigModel(3800);
    let t = performance.now();
    const f = draftToDxfFile(m);
    const tw = performance.now() - t;
    if (process.env.IO_PERF_OUT) writeFileSync(join(process.env.IO_PERF_OUT, "big-10mb.dxf"), f.data);
    const mb = f.data.length / 1048576;
    t = performance.now();
    const r = draftFromFile("big.dxf", f.data);
    const tr = performance.now() - t;
    console.log(`DXF ${mb.toFixed(1)} MB, ${m.entities.length} entit: zápis ${(tw / 1000).toFixed(2)} s, import ${(tr / 1000).toFixed(2)} s`);
    expect(mb).toBeGreaterThan(9.5);
    expect(r.model.entities.length).toBe(m.entities.length);
    expect(tr).toBeLessThan(5000);
  }, 120000);
  it("DWG ≈ 20 MB: import < 15 s (zápis lineárně)", () => {
    // křivky po 150 vrcholech + úsečky, texty, kružnice, oblouky, vložení: ≈ 120 000 entit
    let m: ReturnType<typeof bigModel> | null = bigModel(17000, 150);
    const count = m.entities.length;
    let t = performance.now();
    const f = draftToDwgFile(m, "R2018");
    const tw = performance.now() - t;
    if (process.env.IO_PERF_OUT) writeFileSync(join(process.env.IO_PERF_OUT, "big-20mb.dwg"), f.data);
    m = null;
    const mb = f.data.length / 1048576;
    t = performance.now();
    let steps = 0;
    const r = draftFromFile("big.dwg", f.data, () => void steps++);
    const tr = performance.now() - t;
    console.log(`DWG ${mb.toFixed(1)} MB, ${count} entit: zápis ${(tw / 1000).toFixed(2)} s, import ${(tr / 1000).toFixed(2)} s, hlášení průběhu ${steps}`);
    expect(mb).toBeGreaterThan(19);
    expect(r.model.entities.length).toBe(count);
    expect(steps).toBeGreaterThan(10);
    expect(tr).toBeLessThan(15000);
  }, 300000);
});
