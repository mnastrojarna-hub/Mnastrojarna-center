/**
 * Panel Kusovník v aplikaci (vlna 22, bod 22g, kolo 6): upozornění pod tabulkou (`bomNotesOf`) dávají TYTÉŽ texty jako
 * příkaz `kusovník` (asm-agent.ts `bomCodes`) – u zastaralé kopie, jejíž díl v záložce materiál / číslo má, rada
 * `sestava obnovit #N`, ne „materiál 1.2379 v dílu“ (dřív `bomWarnings(rows)` bez rad, recenze kola 6).
 */
import { describe, expect, it } from "vitest";
import { bomCodes } from "@/cad/asm-agent";
import { computeBom } from "@/cad/assembly";
import { bomPartInfo } from "@/cad/bom-model";
import { memoryFileSink, memoryFileSource, type EngineHost } from "@/cad/engine/host";
import type { KernelApi } from "@/cad/engine/kernel";
import { MemoryWorkspace } from "@/cad/engine/memory-workspace";
import { runScript } from "@/cad/engine/run";
import { emptyDoc, type BuildResult, type CadDoc, type ComponentSource } from "@/cad/types";
import { bomNotesOf } from "./asm-supply";

const result = (d: CadDoc): BuildResult =>
  ({ status: d.features.map((f) => ({ id: f.id, ok: true })), mesh: null, metrics: d.features.length ? { volume: 20000, area: 600, bbox: [[0, 0, 0], [10, 10, 10]], faces: 6, edges: 12, valid: true, solids: 1 } : null, ms: 1 }) as unknown as BuildResult;
const kernel = {
  generation: () => 1,
  build: async (d: CadDoc) => result(d),
  check: async (d: CadDoc) => ({ status: d.features.map((f) => ({ id: f.id, ok: true })), paramErrors: [], solid: true }),
  asmParts: async (parts: { key: string; source: ComponentSource }[]) => parts.map((p) => ({ key: p.key, result: result(p.source.kind === "part" ? p.source.doc : emptyDoc()) })),
  interference: async () => Object.assign([], { stats: { pairs: 0, culled: 0, exact: 0, reused: 0, undetermined: 0 } }),
  clashDetail: async () => [],
  stepSplit: async () => null,
} as unknown as KernelApi;
const host = (): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });

describe("panel Kusovník – upozornění u zastaralé kopie (bod 22g, kolo 6)", () => {
  it("rada `sestava obnovit #1` místo „materiál 1.2379 v dílu“; texty = příkaz kusovník", async () => {
    const ws = new MemoryWorkspace();
    await runScript(ws, 'nový díl "Deska A"\nkvádr 100 60 20\nnový díl "Přidržovač"\nkvádr 40 30 10\nnová sestava "Nástroj"\nvložit "Deska A" ukotvit\nvložit "Přidržovač" v 10 10 20', host());
    const r = await runScript(ws, 'záložka "Deska A"\nmateriál 1.2379\nvýkres razítko číslo="DA-001"\nzáložka "Nástroj"\nkusovník', host());
    const asm = ws.docOf!(ws.tabs().find((t) => t.title === "Nástroj")!.id)!;
    const partOf = (n: string) => ws.findPart(n) ?? null;
    const rows = computeBom(asm, (c) => bomPartInfo(c, null));
    const notes = bomNotesOf(asm, rows, partOf);
    const texts = notes.map((n) => n.text);
    // repro z recenze: panel ukazoval „… (jen třída): Deska A, Přidržovač – materiál 1.2379 v dílu“
    expect(texts.join("\n")).not.toMatch(/Deska A[^\n]*– materiál 1\.2379 v dílu/);
    expect(texts.join("\n")).not.toMatch(/bez čísla výkresu: Deska A/);
    expect(texts).toContain("vyráběné díly bez označení materiálu (jen třída): Přidržovač – materiál 1.2379 v dílu");
    expect(texts).toContain("Deska A: v kusovníku chybí číslo DA-001, materiál 1.2379 – díl v záložce je má, kopie v sestavě je starší: sestava obnovit #1");
    expect(notes.filter((n) => n.stale).map((n) => n.text)).toEqual(["komponenta „Deska A“ je starší než díl „Deska A“ v záložce (číslo, materiál, výkres) – obnovit: sestava obnovit #1; kusovník a výkres ukazují údaje z vložení"]);
    // stejné texty jako příkaz `kusovník` (engine) i jako `bomCodes` (window.mncad.bom)
    expect(texts).toEqual(bomCodes(asm, rows, { partOf }).map((x) => x.text));
    const engine = r.entries.filter((e) => e.code === "asm.stale-copy" || e.code === "bom.make-incomplete").filter((e) => e.line === 5).map((e) => e.text);
    expect(engine).toEqual(texts);
  });

  it("bez zastaralé kopie: rada doplnit v dílu zůstává (díl údaj nemá)", async () => {
    const ws = new MemoryWorkspace();
    await runScript(ws, 'nový díl "Deska A"\nkvádr 100 60 20\nnová sestava "Nástroj"\nvložit "Deska A" ukotvit', host());
    const asm = ws.docOf!(ws.tabs().find((t) => t.title === "Nástroj")!.id)!;
    const rows = computeBom(asm, (c) => bomPartInfo(c, null));
    const texts = bomNotesOf(asm, rows, (n) => ws.findPart(n) ?? null).map((n) => n.text);
    expect(texts).toContain("vyráběné díly bez označení materiálu (jen třída): Deska A – materiál 1.2379 v dílu");
    expect(texts.join("\n")).not.toMatch(/sestava obnovit/);
  });
});
