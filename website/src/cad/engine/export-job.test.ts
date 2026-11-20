/**
 * Vlna 22, bod 22h – export jako úloha s pojmenovanými fázemi (engine/export-job.ts), bez skutečného jádra (náhrada).
 * Repro bodu: GUI ukazovalo jen „Připravuji STEP AP214…“ – nešlo odlišit přestavbu modelu, převod, kontrolu a zápis; export
 * z menu nedělal kontrolu zpětným načtením; CLI tisklo fázi sítě jako „build 3/2“.
 */
import { describe, expect, it, vi } from "vitest";
import { CadCancelled } from "../kernel-client";
import { setLang } from "../i18n";
import { emptyDoc, type CadDoc, type Feature } from "../types";
import { exportModelRev, exportPhaseText, runExportJob, type ExportPhase } from "./export-job";
import { resetExportChecks } from "./files";
import { projectJson } from "./project-json";

const part = (name = "Deska A", h = 10): CadDoc => ({ ...emptyDoc(name), features: [{ id: "f1", name: "Kvádr", type: "box", size: [20, 10, h], position: [0, 0, 0] } as unknown as Feature] });
const stats = { solids: 1, volume: 2000, bbox: [[0, 0, 0], [20, 10, 10]] as [[number, number, number], [number, number, number]] };

function fakeKernel(o: { exportBytes?: string; fileStats?: typeof stats; hang?: Promise<never> } = {}) {
  const calls: string[] = [];
  return {
    calls,
    kernel: {
      check: vi.fn(async () => {
        calls.push("check");
        return { status: [], paramErrors: [], solid: true };
      }),
      exportFile: vi.fn(async () => {
        calls.push("exportFile");
        if (o.hang) await o.hang;
        return new TextEncoder().encode(o.exportBytes ?? "ISO-10303-21;\nHEADER;\nENDSEC;\n").buffer;
      }),
      exportStats: vi.fn(async () => {
        calls.push("exportStats");
        return { model: stats, file: o.fileStats ?? stats };
      }),
    },
  };
}

describe("export jako úloha – fáze, kontrola zpětným načtením, revize modelu", () => {
  it("STEP dílu: přestavba → převod → kontrola → zápis (zápis až po kontrole); časy fází; revize = revize .mncad", async () => {
    resetExportChecks();
    const { kernel, calls } = fakeKernel();
    const phases: ExportPhase[] = [];
    const write = vi.fn(async (data: Uint8Array) => data.length);
    const d = part();
    const r = await runExportJob(d, "step", { kernel: kernel as never, write, phase: (p) => phases.push(p) });
    expect(phases).toEqual(["model", "convert", "verify", "write"]);
    expect(calls).toEqual(["check", "exportFile", "exportStats"]);
    expect(write).toHaveBeenCalledTimes(1);
    expect(r.check?.ok).toBe(true);
    expect(r.phases.map((p) => p.phase)).toEqual(["model", "convert", "verify", "write"]);
    expect(r.modelRev).toMatch(/^r·[0-9a-f]{6}$/);
    expect(r.modelRev).toBe(projectJson(d).modelRev); // jedna definice revize: soubor .mncad i export
    expect(r.modelRev).toBe(exportModelRev(d));
    expect(r.modelRev).not.toBe(exportModelRev(part("Deska A", 12))); // jiná geometrie = jiná revize
  });

  it("textové `export step` (pořadí řádků protokolu jako dřív): zápis před kontrolou", async () => {
    resetExportChecks();
    const { kernel } = fakeKernel();
    const phases: ExportPhase[] = [];
    await runExportJob(part(), "step", { kernel: kernel as never, write: async () => 0, phase: (p) => phases.push(p) }, { verifyFirst: false });
    expect(phases).toEqual(["model", "convert", "write", "verify"]);
  });

  it("STL bez kontroly; sestava bez samostatné přestavby (skládá se při převodu); `bez kontroly` vynechá kontrolu", async () => {
    const { kernel } = fakeKernel();
    const ph1: ExportPhase[] = [];
    await runExportJob(part(), "stl", { kernel: kernel as never, write: async () => 0, phase: (p) => ph1.push(p) });
    expect(ph1).toEqual(["model", "convert", "write"]);
    const asm: CadDoc = { ...emptyDoc("Sestava"), kind: "assembly", components: [{ id: "c1", name: "A", source: { kind: "part", doc: part() }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } } as never] };
    const ph2: ExportPhase[] = [];
    await runExportJob(asm, "step", { kernel: kernel as never, write: async () => 0, phase: (p) => ph2.push(p) }, { check: false });
    expect(ph2).toEqual(["convert", "write"]);
  });

  it("kontrola, která v souboru nenajde těleso, se ohlásí (✗), ne ✓", async () => {
    resetExportChecks();
    const { kernel } = fakeKernel({ fileStats: { solids: 0, volume: 0, bbox: stats.bbox } });
    const r = await runExportJob(part("Prázdný soubor"), "step", { kernel: kernel as never, write: async () => 0 });
    expect(r.check?.ok).toBe(false);
    expect(r.check?.line).toMatch(/^✗/);
  });

  it("zrušení mezi fázemi: CadCancelled, nic se nezapíše", async () => {
    const { kernel } = fakeKernel();
    const ac = new AbortController();
    const write = vi.fn(async () => 0);
    await expect(
      runExportJob(part(), "step", {
        kernel: kernel as never,
        write,
        signal: ac.signal,
        phase: (p) => {
          if (p === "convert") ac.abort(); // Zrušit během převodu → další fáze už nezačne
        },
      }),
    ).rejects.toBeInstanceOf(CadCancelled);
    expect(write).not.toHaveBeenCalled();
  });

  it("prázdný model: bez přestavby, srozumitelná chyba převodu (jako dřív)", async () => {
    const { kernel, calls } = fakeKernel();
    await expect(runExportJob(emptyDoc("Nic"), "step", { kernel: kernel as never, write: async () => 0 })).rejects.toThrow(/prázdný/);
    expect(calls).toEqual([]);
  });

  it("názvy fází pro člověka a CLI (cs)", () => {
    setLang("cs");
    expect(["model", "convert", "verify", "write"].map((p) => exportPhaseText(p, "step"))).toEqual(["přestavba modelu", "převod do STEP", "kontrola zpětným načtením", "zápis souboru"]);
  });
});
