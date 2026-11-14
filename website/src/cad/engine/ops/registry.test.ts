/** Registr operací: registrace, jeden vlastník, provedení s časem do reportu, neznámý druh = false, chyby se nepolykají. */
import { afterEach, describe, expect, it } from "vitest";
import type { AgentOp } from "../../agent";
import { emptyDoc } from "../../types";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../host";
import type { KernelApi } from "../kernel";
import { MemoryWorkspace } from "../memory-workspace";
import { ReportBuilder } from "../protocol";
import { hasOp, registerOp, registeredOps, runEngineOp, unregisterOp, type OpCtx } from "./registry";

afterEach(() => {
  for (const k of registeredOps()) unregisterOp(k);
});

function ctx(clock: { t: number }): OpCtx {
  const host: EngineHost = { kernel: {} as KernelApi, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => clock.t };
  return { ws: new MemoryWorkspace(), host, opts: {}, report: new ReportBuilder({ lang: "cs", lines: 10, now: () => clock.t }), run: { doc: emptyDoc(), changed: false, openNew: false }, line: 0 };
}

describe("registr operací", () => {
  it("registerOp + runEngineOp: obsluha dostane zúžený typ operace, ctx.line a čas jde do reportu", async () => {
    const clock = { t: 1000 };
    const c = ctx(clock);
    registerOp("meta", async (op, x) => {
      x.run.doc = { ...x.run.doc, ...op.patch } as typeof x.run.doc; // op: Extract<AgentOp, { k: "meta" }>
      x.run.changed = true;
      x.report.ok(x.line, `název ${op.patch.name}`);
      clock.t += 250;
    });
    expect(hasOp("meta")).toBe(true);
    expect(registeredOps()).toEqual(["meta"]);
    const op: AgentOp = { k: "meta", patch: { name: "Deska" }, line: 7 };
    expect(await runEngineOp(op, c)).toBe(true);
    expect(c.line).toBe(7);
    expect(c.run).toMatchObject({ changed: true, doc: { name: "Deska" } });
    const r = c.report.finish();
    expect(r.timing).toEqual([{ line: 7, op: "meta", ms: 250 }]);
    expect(r.counts.ops).toBe(1);
    expect(r.entries).toEqual([{ line: 7, level: "ok", text: "název Deska" }]);
  });
  it("neregistrovaný druh = false a nic se nezapíše", async () => {
    const c = ctx({ t: 0 });
    expect(await runEngineOp({ k: "pop", line: 3 }, c)).toBe(false);
    expect(c.report.finish().counts.ops).toBe(0);
  });
  it("jeden vlastník na druh operace", () => {
    registerOp("view", async () => undefined);
    expect(() => registerOp("view", async () => undefined)).toThrow(/view/);
    expect(unregisterOp("view")).toBe(true);
    expect(() => registerOp("view", async () => undefined)).not.toThrow();
  });
  it("chyba obsluhy projde ke smyčce, čas operace se zapíše i tak", async () => {
    const clock = { t: 0 };
    const c = ctx(clock);
    registerOp("status", async () => {
      clock.t += 5;
      throw new Error("bum");
    });
    await expect(runEngineOp({ k: "status", line: 2 }, c)).rejects.toThrow("bum");
    expect(c.report.finish().timing).toEqual([{ line: 2, op: "status", ms: 5 }]);
  });
});
