/**
 * Vlna 22, bod 12 – identita a fronta běhů (engine/run-queue.ts): jeden model pro textové běhy, úlohy exportu a `mncad serve`.
 * Repro bodu: dva běhy najednou (druhý `window.mncad.run` dřív, než doběhl první) se dřív spustily souběžně a druhý vynuloval
 * stav prvního; zrušit šlo jen výpočet v jádře; pozdní odpověď staršího výpočtu přepsala novější.
 */
import { describe, expect, it, vi } from "vitest";
import { setLang } from "../i18n";
import { emptyDoc } from "../types";
import { inputRevOf, isRunCancelled, RunCancelled, RunTracker, runStateText, SeqGuard } from "./run-queue";
import { modelRev } from "./result-key";

const tick = () => new Promise((r) => setTimeout(r, 0));
const deferred = <T = void>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("RunTracker – fronta, stavy, identita", () => {
  it("dva běhy za sebou nikdy souběžně: druhý čeká (queued), začne až po konci prvního", async () => {
    const t = new RunTracker();
    const order: string[] = [];
    const g1 = deferred();
    const a = t.enqueue({ kind: "script", source: "api", label: "A" }, async () => {
      order.push("A start");
      await g1.promise;
      order.push("A end");
      return "a";
    });
    const b = t.enqueue({ kind: "script", source: "api", label: "B" }, async () => {
      order.push("B start");
      return "b";
    });
    await tick();
    expect(a.id).toBe("r1");
    expect(b.id).toBe("r2");
    expect(t.get("r1")!.state).toBe("running");
    expect(t.get("r2")!.state).toBe("queued");
    expect(order).toEqual(["A start"]);
    g1.resolve();
    expect(await a.done).toBe("a");
    expect(await b.done).toBe("b");
    expect(order).toEqual(["A start", "A end", "B start"]);
    expect(t.list().map((e) => e.state)).toEqual(["done", "done"]);
    expect(t.busy()).toBe(false);
  });

  it("zrušení čekajícího běhu: hned „zrušeno“, práce se nikdy nespustí, done = RunCancelled", async () => {
    const t = new RunTracker();
    const g = deferred();
    t.enqueue({ kind: "script", source: "api", label: "A" }, () => g.promise);
    const work = vi.fn(async () => "x");
    const b = t.enqueue({ kind: "script", source: "api", label: "B" }, work);
    await tick();
    expect(t.cancel(b.id)).toBe(true);
    await expect(b.done).rejects.toBeInstanceOf(RunCancelled);
    expect(t.get(b.id)!.state).toBe("cancelled");
    expect(t.get(b.id)!.startedAt).toBeUndefined();
    g.resolve();
    await t.idle();
    expect(work).not.toHaveBeenCalled();
  });

  it("zrušení běžícího běhu: signál + háček onCancel (zrušení výpočtu v jádře), stav „zrušeno“", async () => {
    const t = new RunTracker();
    const onCancel = vi.fn();
    const h = t.enqueue({ kind: "script", source: "console", label: "A", onCancel }, (ctl) => new Promise((_res, rej) => ctl.signal.addEventListener("abort", () => rej(new Error("aborted")))));
    await tick();
    expect(t.cancel()).toBe(true); // bez id = běžící
    expect(onCancel).toHaveBeenCalledTimes(1);
    await expect(h.done).rejects.toSatisfy(isRunCancelled);
    expect(t.get(h.id)!.state).toBe("cancelled");
    expect(t.cancel(h.id)).toBe(false); // hotový běh už zrušit nejde
  });

  it("práce, která zrušení ohlásí sama (engine: ✗ run.cancelled a protokol), skončí „zrušeno“ i s výsledkem", async () => {
    const t = new RunTracker();
    const h = t.enqueue({ kind: "script", source: "api", label: "A" }, async (ctl) => {
      ctl.finish("cancelled");
      return "✗ Výpočet zrušen";
    });
    expect(await h.done).toBe("✗ Výpočet zrušen");
    expect(t.get(h.id)!.state).toBe("cancelled");
  });

  it("výjimka práce = „chyba“ s textem; další běh ve frontě pokračuje", async () => {
    const t = new RunTracker();
    const a = t.enqueue({ kind: "script", source: "api", label: "A" }, async () => {
      throw new Error("boom");
    });
    const b = t.enqueue({ kind: "script", source: "api", label: "B" }, async () => 2);
    await expect(a.done).rejects.toThrow("boom");
    expect(await b.done).toBe(2);
    expect(t.get(a.id)).toMatchObject({ state: "error", error: "boom" });
  });

  it("fáze a průběh: předchozí fáze se ukončí, časy fází zůstanou i po konci (seznam Exporty)", async () => {
    let now = 1000;
    const t = new RunTracker({ now: () => now });
    const h = t.enqueue({ kind: "export", source: "menu", label: "STEP" }, async (ctl) => {
      ctl.phase("model");
      ctl.progress(0, 3, "Kvádr");
      now += 50;
      ctl.phase("convert");
      now += 120;
      ctl.set({ result: { file: "a.step", bytes: 10 } });
      return 1;
    });
    await h.done;
    const e = t.get(h.id)!;
    expect(e.state).toBe("done");
    expect(e.phases.map((p) => [p.phase, p.state, p.ms])).toEqual([
      ["model", "done", 50],
      ["convert", "done", 120],
    ]);
    expect(e.phase).toBeUndefined();
    const snap = t.snapshot(e);
    expect(snap).toMatchObject({ id: "r1", kind: "export", source: "menu", state: "done", ms: 170, result: { file: "a.step", bytes: 10 } });
    expect(t.list("export")).toHaveLength(1);
    expect(t.list("script")).toHaveLength(0);
  });

  it("idle() počká na všechny čekající i běžící běhy", async () => {
    const t = new RunTracker();
    const g = deferred();
    t.enqueue({ kind: "script", source: "api", label: "A" }, () => g.promise);
    t.enqueue({ kind: "script", source: "api", label: "B" }, async () => undefined);
    let idle = false;
    void t.idle().then(() => (idle = true));
    await tick();
    expect(idle).toBe(false);
    g.resolve();
    await t.idle();
    expect(idle).toBe(true);
  });

  it("begin/start/end bez fronty (mncad serve): vlastní id, obsazené id běžícího běhu se nepoužije", () => {
    const t = new RunTracker({ prefix: "j" });
    const a = t.begin({ kind: "script", source: "http", label: "x", id: "moje" });
    expect(a.id).toBe("moje");
    const b = t.begin({ kind: "script", source: "http", label: "y", id: "moje" });
    expect(b.id).toBe("j2");
    t.start(a.id);
    t.end(a.id, "done");
    expect(t.get("moje")!.state).toBe("done");
    const c = t.begin({ kind: "script", source: "http", label: "z", id: "moje" }); // hotový běh téhož id se nahradí
    expect(c.id).toBe("moje");
    expect(t.list().filter((e) => e.id === "moje")).toHaveLength(1);
  });

  it("hotových záznamů nejvýš `keep`, běžící se nevyřadí", async () => {
    const t = new RunTracker({ keep: 2 });
    for (let i = 0; i < 5; i++) await t.enqueue({ kind: "script", source: "api", label: String(i) }, async () => i).done;
    expect(t.list().map((e) => e.label)).toEqual(["3", "4"]);
  });

  it("revize vstupu = klíč dokumentu + revize modelu (r·…), stavy česky", () => {
    setLang("cs");
    const d = emptyDoc("Deska A");
    expect(inputRevOf("k1", d)).toBe(`k1@${modelRev(d)}`);
    expect(inputRevOf("", d)).toMatch(/^-@r·[0-9a-f]{6}$/);
    expect(["queued", "running", "done", "cancelled", "error", "superseded"].map((s) => runStateText(s as never))).toEqual(["čeká", "počítá", "dokončeno", "zrušeno", "chyba", "nahrazeno"]);
  });
});

describe("SeqGuard – pozdní odpověď staršího výpočtu nepřepíše novější", () => {
  it("po startu novějšího výpočtu starší není „current“ a končí jako nahrazený", async () => {
    const g = new SeqGuard();
    const shown: string[] = [];
    const compute = async (name: string, ms: number) => {
      const tk = g.begin();
      await new Promise((r) => setTimeout(r, ms));
      if (tk.current()) shown.push(name);
      return tk.settle();
    };
    const old = compute("stará studie (10 kroků)", 30);
    const neu = compute("nová studie (40 kroků)", 5);
    expect(await neu).toBe("done");
    expect(await old).toBe("superseded");
    expect(shown).toEqual(["nová studie (40 kroků)"]);
    expect(g.superseded).toBe(1);
  });
  it("invalidate() zneplatní rozběhnuté výpočty (změna dokumentu)", () => {
    const g = new SeqGuard();
    const tk = g.begin();
    g.invalidate();
    expect(tk.current()).toBe(false);
  });
});
