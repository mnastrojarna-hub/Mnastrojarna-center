import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelLoadError, WATCHDOG_MS, loadModel } from "./load-model";
import type { WorkerResponse } from "@/lib/viewer3d/worker-protocol";

/** Falešný worker: odpovědi řídí test (nebo mlčí — spadlý / zaseknutý worker). */
class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((ev: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  id = 0;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(msg: { id: number }) {
    this.id = msg.id;
  }
  terminate() {
    this.terminated = true;
  }
  send(msg: Record<string, unknown>) {
    this.onmessage?.({ data: { id: this.id, ...msg } } as MessageEvent<WorkerResponse>);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("window", { location: { origin: "http://localhost" } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const src = () => ({ format: "step" as const, bytes: new ArrayBuffer(8), name: "a.stp" });

describe("hlídání workeru prohlížeče 3D", () => {
  it("worker bez odezvy (tiše spadl na paměť) → chyba místo nekonečného kolečka", async () => {
    const p = loadModel(src(), () => {});
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS + 10);
    const e = await caught;
    expect(e).toBeInstanceOf(ModelLoadError);
    expect((e as ModelLoadError).kind).toBe("timeout");
    expect((e as Error).message).toMatch(/zasekl/);
    expect(FakeWorker.last!.terminated).toBe(true);
  });

  it("průběh posouvá hlídání; krok s limitem (OpenCascade čte celý soubor) smí trvat déle", async () => {
    const seen: unknown[] = [];
    const p = loadModel(src(), (pr) => seen.push(pr));
    let settled = false;
    p.then(() => (settled = true), () => (settled = true));
    const w = FakeWorker.last!;
    w.send({ type: "progress", stage: "parse", done: 10, total: 100 });
    await vi.advanceTimersByTimeAsync(WATCHDOG_MS - 1000);
    w.send({ type: "progress", stage: "parse", budgetMs: 5 * WATCHDOG_MS });
    await vi.advanceTimersByTimeAsync(3 * WATCHDOG_MS);
    expect(settled).toBe(false);
    expect(seen[0]).toEqual({ stage: "parse", done: 10, total: 100, budgetMs: undefined });
    w.send({ type: "error", error: "STEP se nepodařilo načíst" });
    await expect(p).rejects.toMatchObject({ kind: "import", message: "STEP se nepodařilo načíst" });
  });

  it("pád workeru (onerror) → srozumitelná chyba", async () => {
    const p = loadModel(src(), () => {});
    FakeWorker.last!.onerror?.({ message: "" } as ErrorEvent);
    await expect(p).rejects.toMatchObject({ kind: "crash" });
  });
});
