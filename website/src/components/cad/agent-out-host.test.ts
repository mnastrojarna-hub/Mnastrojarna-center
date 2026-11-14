import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CadDoc } from "@/cad/types";

// jádro a stažení souboru: bez workeru a bez stránky
const exportFile = vi.fn(async () => new TextEncoder().encode("ISO-10303-21; …").buffer as ArrayBuffer);
const exportStats = vi.fn(async () => ({
  model: { solids: 1, volume: 6000, bbox: [[0, 0, 0], [30, 20, 10]] as [[number, number, number], [number, number, number]] },
  file: { solids: 1, volume: 6000.000001, bbox: [[0, 0, 0], [30, 20, 10]] as [[number, number, number], [number, number, number]] },
}));
vi.mock("@/cad/client", () => ({ cad: { exportFile: (...a: unknown[]) => exportFile(...(a as [])), exportStats: (...a: unknown[]) => exportStats(...(a as [])) } }));
const writeSaved = vi.fn(async () => undefined);
vi.mock("@/lib/save-file", () => ({ writeSaved: (...a: unknown[]) => writeSaved(...(a as [])) }));

const { export3d, runOutCmd } = await import("./agent-out-host");
const { blobStats } = await import("@/cad/blobs");

const part = (name: string, x = 30): CadDoc => ({ app: "mnastrojarna-cad", version: 2, name, material: "ocel", features: [{ id: "b1", name: "Kvádr 1", type: "box", size: [x, 20, 10], origin: [0, 0, 0] } as never] });
const host = { sketch: () => null };

beforeEach(() => {
  exportFile.mockClear();
  exportStats.mockClear();
  writeSaved.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe("export STEP z konzole – kontrola", () => {
  it("revize: kontrola jde přes jádro bez sítě (exportStats), bajty nezůstávají v úložišti importů", async () => {
    const before = blobStats();
    const r = await export3d(part("Deska"), "step", undefined, host);
    expect(exportStats).toHaveBeenCalledTimes(1);
    expect(r.check?.ok).toBe(true);
    expect(r.log[1]).toMatch(/^  ✓ kontrola STEP: soubor znovu načten jádrem – těles: 1/);
    expect(blobStats()).toEqual(before);
  });

  it("revize: opakovaný export nezměněného modelu kontrolu nepočítá znovu; změna modelu ano", async () => {
    const d = part("Opakovane", 31);
    await export3d(d, "step", undefined, host);
    const again = await export3d(JSON.parse(JSON.stringify(d)) as CadDoc, "step", "jiny-nazev", host);
    expect(exportStats).toHaveBeenCalledTimes(1);
    expect(exportFile).toHaveBeenCalledTimes(2); // soubor se stáhne vždy
    expect(again.log[1]).toMatch(/věrná kopie modelu \(model od minulé kontroly beze změny\)$/);
    await export3d(part("Opakovane", 32), "step", undefined, host);
    expect(exportStats).toHaveBeenCalledTimes(2);
    // jiný formát = vlastní kontrola
    await export3d(d, "brep", undefined, host);
    expect(exportStats).toHaveBeenCalledTimes(3);
  });

  it("revize: „export step bez kontroly“ kontrolu vynechá a řekne to", async () => {
    const log = await runOutCmd({ kind: "export", format: "step", check: false }, part("Bez", 40), host);
    expect(exportStats).not.toHaveBeenCalled();
    expect(writeSaved).toHaveBeenCalledTimes(1);
    expect(log[0]).toMatch(/^✓ export STEP: Bez\.step/);
    expect(log[1]).toBe("  – kontrola STEP vynechána („bez kontroly“)");
  });

  it("neúspěšná kontrola se nepamatuje (další export ji zkusí znovu)", async () => {
    exportStats.mockImplementationOnce(async () => {
      throw new Error("Failed to load STEP file");
    });
    const d = part("Chyba", 50);
    const a = await export3d(d, "step", undefined, host);
    expect(a.check?.ok).toBe(false);
    expect(a.log[1]).toMatch(/^  ✗ kontrola STEP: soubor se nepodařilo znovu načíst – Failed to load STEP file/);
    const b = await export3d(d, "step", undefined, host);
    expect(b.check?.ok).toBe(true);
    expect(exportStats).toHaveBeenCalledTimes(2);
  });
});
