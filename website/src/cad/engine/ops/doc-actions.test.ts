/**
 * Integrace vlny 21: `pružina tabulka` (= akce `spring.table`) provádí engine sám – stejně v aplikaci i v CLI, bez okna
 * aplikace (dřív akce UI → v CLI ✗ host.app-only). Text dává `springTableLines` (agent-springs.ts), strojový řádek
 * `= … api … springs=1 name=… R=…N/mm …` doc-actions.ts. Ruční hodnoty EN 13906-1 (d 2 · De 20 · L0 50 · n 8, SH):
 * D = 18, R = 81 500·16 / (8·18³·8) = 3,4937 N/mm, Ln = 10·2 = 20 mm, Fn = R·30 = 104,8 N.
 */
import { describe, expect, it } from "vitest";
import "../../ext"; // registr rozšíření jako v CLI (akce `spring.table`, `sheet.svg`)
import type { BuildResult, CadDoc, ComponentSource } from "../../types";
import { emptyDoc } from "../../types";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../host";
import type { KernelApi } from "../kernel";
import { MemoryWorkspace } from "../memory-workspace";
import { formatShort } from "../protocol";
import { runScript } from "../run";
import { docAction } from "./doc-actions";

const result = (d: CadDoc): BuildResult =>
  ({ status: d.features.map((f) => ({ id: f.id, ok: true })), mesh: null, metrics: d.features.length ? { volume: 1000, area: 600, bbox: [[0, 0, 0], [10, 10, 10]], faces: 6, edges: 12, valid: true, solids: 1 } : null, ms: 1 }) as unknown as BuildResult;
const kernel = {
  generation: () => 1,
  build: async (d: CadDoc) => result(d),
  asmParts: async (parts: { key: string; source: ComponentSource }[]) => parts.map((p) => ({ key: p.key, result: result(p.source.kind === "part" ? p.source.doc : emptyDoc()) })),
  stepSplit: async () => null,
} as unknown as KernelApi;
/** hostitel bez aplikace (CLI): žádné `ui` */
const cli = (): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });

describe("pružina tabulka v enginu (bez aplikace)", () => {
  it("spočtené údaje poslední pružiny + strojový řádek, žádné host.app-only", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, "nový díl P\npružina tlačná d 2 De 20 L0 50 n 8 konce broušené\npružina tabulka", cli());
    expect(r.counts.errors).toBe(0);
    expect(r.entries.some((e) => e.code === "host.app-only")).toBe(false);
    const short = formatShort(r);
    expect(short).toMatch(/= L3 api "P" springs=1 name="Tlačná pružina 1" kind=compression d=2mm De=20mm L0=50mm n=8 R=3\.4937N\/mm Ln=20mm Fn=104\.8N/);
    const e = r.entries.find((x) => x.line === 3)!;
    expect(e.detail).toMatch(/tuhost R: 3,494 N\/mm/);
    expect(e.detail).toMatch(/délka na doraz Ln: 20 mm/);
  });

  it("pojmenovaná a všechny pružiny; neznámý název = ✗ u řádku; `akce spring.table` totéž", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, 'nový díl P\npružina tlačná d 2 De 20 L0 50 n 8 název "A"\npružina tlačná d 3 De 24 L0 60 n 6 název "B"\npružina tabulka "A"\npružina tabulka vše\npružina tabulka "C"\nakce spring.table', cli());
    const at = (n: number) => r.entries.filter((x) => x.line === n);
    expect(at(4)[0].text ?? at(4)[0].detail).toBeDefined();
    expect(formatShort(r)).toMatch(/= L4 api "P" springs=1 name=A /);
    expect(formatShort(r)).toMatch(/= L5 api "P" springs=2 names="A, B"/);
    expect(at(6).some((x) => x.level === "error" && /pružina „C“ v dílu není – pružiny: A, B/.test(x.text ?? ""))).toBe(true);
    expect(formatShort(r)).toMatch(/= L7 api "P" springs=1 name=B /);
    expect(r.entries.some((e) => e.code === "host.app-only")).toBe(false);
  });

  it("jiné akce dál provádí aplikace (CLI ✗ host.app-only)", async () => {
    expect(docAction("spring.table")).not.toBeNull();
    expect(docAction("weld.weldTable")).toBeNull();
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, "nový díl P\nkvádr 10 10 10\nakce sheet.svg", cli());
    expect(r.entries.some((e) => e.code === "host.app-only")).toBe(true);
  });
});
