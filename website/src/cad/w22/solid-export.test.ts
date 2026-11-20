/**
 * Vlna 22, bod 22c – pravidla objemového exportu bez jádra (solid-export.ts, agent-out.ts exportCheck, řádek D, GUI kontrola):
 *  – soubor / model bez objemového tělesa = ✗ out.no-solid, nikdy „věrná kopie modelu“ (ani když soubor odpovídá modelu z ploch);
 *  – volné skořepiny / plochy vedle tělesa = ⚠ out.free-surfaces s počty a jmény komponent sestavy;
 *  – soubor po načtení neplatný, model platný = ⚠ out.check-failed;
 *  – řádek D bez tělesa `V=- m=-`; GUI (export z menu) dává tutéž větu jako textový export.
 * Na starém kódu (adf391b, G2 4c0961a): exportCheck(model 0/0, file 0/0) → ok:true „těles: 0 … → věrná kopie modelu“.
 */
import { afterEach, describe, expect, it } from "vitest";
import { exportCheck, type ShapeStats } from "../agent-out";
import { docKv } from "../engine/protocol";
import { setLang } from "../i18n";
import { compositionText, isVolumeFormat, solidsOfLeaves, solidVerdict } from "../solid-export";
import { guiExportCheck } from "../../components/cad/export-solid-check";
import type { CadDoc, Vec3 } from "../types";

afterEach(() => setLang("cs"));

const bb: [Vec3, Vec3] = [
  [-20, -15, 0],
  [20, 15, 20],
];
/** C2 „Deska A“: uzavřená skořepina 6 ploch bez „Uzavřít do tělesa“ – model i soubor stejné, objem jen z těles = 0 */
const shell: ShapeStats = { solids: 0, volume: 0, bbox: bb, shells: 1, closedShells: 1, freeShells: 1, closedFree: 1, freeFaces: 0, free: 6, valid: true };
/** C3 „Deska B“: kvádr + otevřená plocha */
const boxFree: ShapeStats = { solids: 1, volume: 24000, bbox: [[-10, -30, 0], [50, 30, 20]], shells: 2, closedShells: 1, freeShells: 1, closedFree: 0, freeFaces: 0, free: 1, valid: true };
/** C4 „Deska C“: platné těleso */
const solid: ShapeStats = { solids: 1, volume: 476356.381, bbox: [[-60, -50, 0], [60, 50, 40]], shells: 1, closedShells: 1, freeShells: 0, closedFree: 0, freeFaces: 0, free: 0, valid: true };

describe("exportCheck – „věrná kopie“ jen s objemovým tělesem", () => {
  it("skořepina bez tělesa: model = soubor, přesto ✗ out.no-solid, ne ✓ věrná kopie (dřív ok:true, těles: 0)", () => {
    const c = exportCheck(shell, { ...shell }, "STEP");
    expect(c.ok).toBe(false);
    expect(c.level).toBe("error");
    expect(c.code).toBe("out.no-solid");
    expect(c.line).toMatch(/^✗ kontrola STEP: soubor neobsahuje objemové těleso \(těles 0, volných skořepin 1 \(uzavřených 1\), volných ploch 0\)/);
    expect(c.line).toMatch(/Uzavřít do tělesa, prvek surf\.close/);
    expect(c.line).not.toMatch(/věrná kopie/);
  });
  it("otevřená plocha (C1): ✗ out.no-solid, žádné uzavřené skořepiny v textu", () => {
    const open: ShapeStats = { solids: 0, volume: 0, bbox: [[0, 0, 0], [50, 30, 20]], shells: 1, closedShells: 0, freeShells: 1, closedFree: 0, freeFaces: 0, free: 2, valid: true };
    const c = exportCheck(open, open, "BREP");
    expect(c).toMatchObject({ ok: false, level: "error", code: "out.no-solid" });
    expect(c.line).toMatch(/^✗ kontrola BREP: soubor neobsahuje objemové těleso \(těles 0, volných skořepin 1, volných ploch 0\)/);
  });
  it("těleso + volná plocha (C3): ⚠ out.free-surfaces s počty, ne věrná kopie", () => {
    const c = exportCheck(boxFree, { ...boxFree }, "STEP");
    expect(c).toMatchObject({ ok: false, level: "warn", code: "out.free-surfaces" });
    expect(c.line).toMatch(/^⚠ kontrola STEP: soubor obsahuje vedle těles \(1\) i plochy mimo tělesa \(volných skořepin 1, volných ploch 0\) – nejsou objemem/);
    expect(c.line).not.toMatch(/věrná kopie/);
  });
  it("platné těleso (C4): ✓ věrná kopie modelu (beze změny dřívějšího textu)", () => {
    const c = exportCheck(solid, { ...solid }, "STEP");
    expect(c).toMatchObject({ ok: true, level: "ok" });
    expect(c.code).toBeUndefined();
    expect(c.line).toMatch(/^✓ kontrola STEP: soubor znovu načten jádrem – těles: 1, objem 476[\s ]356 mm³ \(rozdíl 0,0000 %\), .* → věrná kopie modelu$/);
  });
  it("soubor se liší: jiný počet ploch mimo tělesa / neplatný po načtení → ⚠ out.check-failed", () => {
    const a = exportCheck(solid, { ...solid, free: 2, freeFaces: 2 }, "STEP");
    expect(a).toMatchObject({ ok: false, level: "warn", code: "out.check-failed" });
    expect(a.line).toMatch(/ploch mimo tělesa 2 \(model 0\)/);
    const b = exportCheck(solid, { ...solid, valid: false }, "STEP");
    expect(b).toMatchObject({ ok: false, code: "out.check-failed" });
    expect(b.line).toMatch(/po načtení neplatné \(BRepCheck\), model platný/);
    // model sám neplatný → neplatnost souboru není rozdíl (hlásí ji kontrola platnosti modelu)
    expect(exportCheck({ ...solid, valid: false }, { ...solid, valid: false }, "STEP").ok).toBe(true);
    // jiný počet těles
    expect(exportCheck({ ...solid, solids: 2 }, solid, "STEP").line).toMatch(/těles 1 \(model 2\)/);
  });
  it("sestava: jména komponent bez tělesa / s volnými plochami v hlášce", () => {
    const c = exportCheck({ ...solid, solids: 2 }, { ...solid, solids: 2 }, "STEP", { noSolid: ["Plech 1"], free: ["Deska B"] });
    expect(c).toMatchObject({ ok: false, code: "out.free-surfaces" });
    expect(c.line).toMatch(/komponenty bez tělesa: Plech 1; komponenty s volnými plochami: Deska B$/);
  });
  it("starší míry bez složení (falešná jádra testů): beze změny – těleso = věrná kopie", () => {
    const old = { solids: 1, volume: 6000, bbox: [[0, 0, 0], [30, 20, 10]] as [Vec3, Vec3] };
    expect(exportCheck(old, old, "STEP").ok).toBe(true);
    expect(exportCheck({ ...old, solids: 0 }, { ...old, solids: 0 }, "STEP")).toMatchObject({ ok: false, code: "out.no-solid" });
  });
});

describe("solidVerdict / složení", () => {
  it("formáty: STEP, BREP, STL, 3MF jsou objemové; OBJ, glTF, VRML ne", () => {
    expect(["step", "brep", "stl", "3mf"].every(isVolumeFormat)).toBe(true);
    expect(["obj", "glb", "wrl", "mncad", "pdf"].some(isVolumeFormat)).toBe(false);
  });
  it("model bez tělesa → ✗, s plochami mimo tělesa → ⚠, jen tělesa → null", () => {
    expect(solidVerdict({ solids: 0, free: 6 }, "STL", "model")).toMatchObject({ level: "error", code: "out.no-solid" });
    expect(solidVerdict({ solids: 0, free: 6 }, "STL", "model")!.text).toMatch(/^STL: model nemá objemové těleso \(těles 0, ploch mimo tělesa 6\)/);
    expect(solidVerdict({ solids: 1, free: 1 }, "3MF", "model")).toMatchObject({ level: "warn", code: "out.free-surfaces" });
    expect(solidVerdict({ solids: 3, free: 0 }, "STL", "model")).toBeNull();
  });
  it("text složení: uzavřené jen z volných skořepin (plášť tělesa se nepočítá)", () => {
    expect(compositionText({ solids: 1, freeShells: 1, closedFree: 0, closedShells: 1, freeFaces: 0 })).toBe("volných skořepin 1, volných ploch 0");
    expect(compositionText({ solids: 0, freeShells: 2, closedFree: 1, freeFaces: 3 })).toBe("volných skořepin 2 (uzavřených 1), volných ploch 3");
  });
  it("sestava z listů: součty, jména, skryté komponenty se neexportují, nepostavené díly = null", () => {
    const leaf = (id: string, name: string, hidden = false) => ({ id, key: id, hidden, path: [name], comp: { name } });
    const m: Record<string, { solids: number; free?: number }> = { a: { solids: 1 }, b: { solids: 0, free: 6 }, c: { solids: 1, free: 2 }, d: { solids: 0 } };
    const r = solidsOfLeaves([leaf("a", "Deska"), leaf("b", "Plech"), leaf("c", "Kryt"), leaf("d", "Skrytý", true)], (k) => m[k]);
    expect(r).toEqual({ solids: 2, free: 8, parts: { noSolid: ["Plech"], free: ["Kryt"] } });
    expect(solidsOfLeaves([leaf("x", "X")], () => undefined)).toBeNull();
    expect(solidVerdict(r!, "STEP", "model", r!.parts)!.text).toMatch(/komponenty bez tělesa: Plech; komponenty s volnými plochami: Kryt$/);
  });
});

describe("řádek D bez tělesa", () => {
  it("díl bez tělesa: V=- m=- (dřív V=24cm3 m=0.188kg z pseudoobjemu skořepiny)", () => {
    expect(docKv({ ref: "Deska A", name: "Deska A", kind: "part", features: { ok: 7, warn: 0, error: 0 }, bbox: bb, solids: 0, free: 6, valid: true })).toBe("part feat=7/0/0 V=- m=- bbox=40x30x20 solids=0 valid=1 free=6");
    expect(docKv({ ref: "B", name: "B", kind: "part", features: { ok: 3, warn: 0, error: 0 }, volume_mm3: 24000, mass_kg: 0.1884, bbox: bb, solids: 1, free: 1, valid: true })).toBe("part feat=3/0/0 V=24cm3 m=0.188kg bbox=40x30x20 solids=1 valid=1 free=1");
  });
});

describe("export z menu aplikace = textový export (guiExportCheck)", () => {
  const doc = { app: "mnastrojarna-cad", version: 2, name: "Deska A", material: "ocel", features: [] } as unknown as CadDoc;
  it("STEP skořepiny → error se stejnou větou jako exportCheck; STEP tělesa → ok „věrná kopie“", async () => {
    const cad = { exportStats: async () => ({ model: { ...shell } as never, file: { ...shell } as never }) };
    const g = await guiExportCheck(cad, doc, "step", new Uint8Array(1), { solids: 0, free: 6 });
    expect(g).toMatchObject({ level: "error", format: "step" });
    expect(g!.text).toBe(exportCheck(shell, shell, "STEP").line);
    const ok = await guiExportCheck({ exportStats: async () => ({ model: { ...solid } as never, file: { ...solid } as never }) }, doc, "step", new Uint8Array(1), null);
    expect(ok).toMatchObject({ level: "ok" });
    expect(ok!.text).toMatch(/věrná kopie modelu$/);
  });
  it("STL bez tělesa → ✗ model nemá objemové těleso; OBJ se nekontroluje; chyba čtení → ✗ kontrola se nepodařila", async () => {
    const never = { exportStats: async () => Promise.reject(new Error("nečte")) };
    expect(await guiExportCheck(never, doc, "stl", new Uint8Array(1), { solids: 0, free: 2 })).toMatchObject({ level: "error", text: expect.stringMatching(/^✗ STL: model nemá objemové těleso/) });
    expect(await guiExportCheck(never, doc, "stl", new Uint8Array(1), { solids: 1, free: 0 })).toBeNull();
    expect(await guiExportCheck(never, doc, "obj", new Uint8Array(1), { solids: 0, free: 2 })).toBeNull();
    expect(await guiExportCheck(never, doc, "brep", new Uint8Array(1), null)).toMatchObject({ level: "error", text: expect.stringMatching(/^✗ kontrola BREP: soubor se nepodařilo znovu načíst – nečte/) });
  });
  it("EN / DE: přeložené věty (ne česky)", () => {
    setLang("en");
    const en = exportCheck(shell, shell, "STEP").line;
    setLang("de");
    const de = exportCheck(shell, shell, "STEP").line;
    setLang("cs");
    expect(en).toMatch(/^✗ /);
    expect(en).not.toMatch(/soubor neobsahuje/);
    expect(en).toMatch(/solid/i);
    expect(de).not.toMatch(/soubor neobsahuje/);
    expect(de).toMatch(/Volumenkörper/);
  });
});
