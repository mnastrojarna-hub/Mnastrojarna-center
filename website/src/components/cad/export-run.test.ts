/**
 * Vlna 22, bod 22h – export z menu / `window.mncad.exportFile` jako úloha RunTrackeru (export-run.ts) a zrušení bez prázdného
 * souboru po dialogu „Uložit jako“ (File System Access API): dialog založí soubor hned, zrušená úloha ho musí odstranit
 * (`handle.remove()`), jinak to záznam úlohy řekne. Jádro a dialog jsou náhrady (bez prohlížeče).
 */
import { describe, expect, it, vi } from "vitest";
import { CadCancelled } from "@/cad/kernel-client";
import { RunTracker, isRunCancelled } from "@/cad/engine/run-queue";
import { resetExportChecks } from "@/cad/engine/files";
import { emptyDoc, type CadDoc, type Feature } from "@/cad/types";
import { exportLine, exportState, modelId } from "@/cad/doc-outputs";
import { discardTarget, exportRun, recordExportJob, type ExportRunDeps, type ExportTarget } from "./export-run";

const doc = (): CadDoc => ({ ...emptyDoc("Deska A"), features: [{ id: "f1", name: "Kvádr", type: "box", size: [20, 10, 10], position: [0, 0, 0] } as unknown as Feature] });
const stats = { solids: 1, volume: 2000, bbox: [[0, 0, 0], [20, 10, 10]] as [[number, number, number], [number, number, number]] };

/** jádro, jehož převod čeká na `release` (nebo skončí CadCancelled po `cancelKernel`) */
function deps(o: { hold?: boolean } = {}) {
  let release!: () => void;
  let fail!: (e: unknown) => void;
  const held = new Promise<void>((res, rej) => {
    release = res;
    fail = rej;
  });
  const writes: { target: ExportTarget; bytes: number }[] = [];
  const d: ExportRunDeps = {
    kernel: {
      check: vi.fn(async () => ({ status: [], paramErrors: [], solid: true })) as never,
      exportFile: vi.fn(async () => {
        if (o.hold) await held;
        return new TextEncoder().encode("ISO-10303-21;\nHEADER;\nENDSEC;\n").buffer;
      }) as never,
      exportStats: vi.fn(async () => ({ model: stats, file: stats })) as never,
    },
    doc,
    docKey: () => "k1",
    write: vi.fn(async (target: ExportTarget, data: Uint8Array) => void writes.push({ target, bytes: data.length })),
    cancelKernel: vi.fn(() => fail(new CadCancelled())),
  };
  return { d, release, writes };
}
const handle = (removable = true) => ({ remove: removable ? vi.fn(async () => undefined) : undefined, kind: "file" });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("export jako úloha v aplikaci", () => {
  it("hotový export: fáze přestavba → převod → kontrola → zápis, výsledek zůstane v seznamu (soubor, velikost, kontrola, revize)", async () => {
    resetExportChecks();
    const t = new RunTracker();
    const { d, writes } = deps();
    const h = exportRun(t, { format: "step", label: "STEP · Deska A.step", source: "menu", target: { name: "Deska A.step", handle: handle() } }, d);
    const r = await h.done;
    const e = t.get(h.id)!;
    expect(e.kind).toBe("export");
    expect(e.state).toBe("done");
    expect(e.phases.map((p) => p.phase)).toEqual(["model", "convert", "verify", "write"]);
    expect(e.result).toMatchObject({ file: "Deska A.step", format: "step", written: true, ok: true, check: { ok: true } });
    expect(e.result?.modelRev).toBe(r.modelRev);
    expect(e.inputRev).toMatch(/^k1@r·[0-9a-f]{6}$/);
    expect(writes).toHaveLength(1);
  });

  it("zrušení běžícího exportu po dialogu „Uložit jako“: nic se nezapíše a prázdný soubor z dialogu se odstraní", async () => {
    const t = new RunTracker();
    const { d, writes } = deps({ hold: true });
    const target = { name: "Deska A.step", handle: handle() };
    const h = exportRun(t, { format: "step", label: "STEP", source: "menu", target }, d);
    await tick();
    await tick();
    expect(t.get(h.id)!.phase).toBe("convert");
    expect(t.cancel(h.id)).toBe(true);
    await expect(h.done).rejects.toSatisfy((e: unknown) => isRunCancelled(e) || e instanceof CadCancelled);
    expect(d.cancelKernel).toHaveBeenCalled();
    expect(writes).toHaveLength(0);
    expect(target.handle.remove).toHaveBeenCalledTimes(1);
    const e = t.get(h.id)!;
    expect(e.state).toBe("cancelled");
    expect(e.result).toMatchObject({ written: false, removed: true });
    expect(e.phases.at(-1)).toMatchObject({ phase: "convert", state: "cancelled" });
  });

  it("zrušení čekajícího exportu (fronta běhů): úloha nezačne, prázdný soubor z dialogu se také odstraní", async () => {
    const t = new RunTracker();
    let go!: () => void;
    t.enqueue({ kind: "script", source: "console", label: "dlouhý skript" }, () => new Promise<void>((r) => (go = r)));
    const { d, writes } = deps();
    const target = { name: "Deska A.step", handle: handle() };
    const h = exportRun(t, { format: "step", label: "STEP", source: "menu", target }, d);
    await tick();
    expect(t.get(h.id)!.state).toBe("queued");
    t.cancel(h.id);
    await expect(h.done).rejects.toSatisfy(isRunCancelled);
    await tick();
    expect(target.handle.remove).toHaveBeenCalledTimes(1);
    expect(t.get(h.id)!.result).toMatchObject({ written: false, removed: true });
    go();
    await t.idle();
    expect(writes).toHaveLength(0);
    expect(d.kernel.exportFile).not.toHaveBeenCalled();
  });

  it("prohlížeč bez handle.remove: záznam řekne „soubor nebyl zapsán (0 B)“ – nikdy tiché ✓", async () => {
    const t = new RunTracker();
    const { d } = deps({ hold: true });
    const h = exportRun(t, { format: "step", label: "STEP", source: "menu", target: { name: "x.step", handle: handle(false) } }, d);
    await tick();
    await tick();
    t.cancel(h.id);
    await h.done.catch(() => undefined);
    const e = t.get(h.id)!;
    expect(e.result).toMatchObject({ written: false, removed: false, ok: false });
    expect(e.result?.note).toMatch(/0 B/);
    expect(e.result?.check).toBeUndefined();
  });

  it("window.mncad.exportFile (bez cíle): data volajícímu, žádný zápis, stav úlohy a fáze v trackeru", async () => {
    resetExportChecks();
    const t = new RunTracker();
    const { d, writes } = deps();
    const h = exportRun(t, { format: "step", label: "STEP", source: "api", target: null }, d);
    const r = await h.done;
    expect(r.data.length).toBeGreaterThan(0);
    expect(writes).toHaveLength(0);
    expect(t.snapshot(t.get(h.id)!)).toMatchObject({ kind: "export", source: "api", state: "done", phases: [{ phase: "model" }, { phase: "convert" }, { phase: "verify" }, { phase: "write" }] });
  });

  it("kolo 3 (body 12, 22h – falešná zelená): model změněný BĚHEM exportu → záznam nese revizi exportovaného modelu a je zastaralý, ne „odpovídá modelu“", async () => {
    resetExportChecks();
    const t = new RunTracker();
    let cur = doc(); // dokument aplikace – úloha si ho vezme při startu
    const { d, release } = deps({ hold: true });
    d.doc = () => cur;
    const h = exportRun(t, { format: "step", label: "STEP", source: "menu", target: { name: "Deska A.step", handle: handle() } }, d);
    await tick();
    await tick();
    expect(t.get(h.id)!.phase).toBe("convert");
    // uživatel mezitím změní rozměr kvádru (převod v jádře běží dál nad původním modelem)
    cur = { ...cur, features: cur.features.map((f) => ({ ...f, size: [20, 10, 25] }) as unknown as Feature) };
    release();
    const r = await h.done;
    const out = recordExportJob(cur, { format: "step", file: "Deska A.step", job: r, id: h.id, ms: t.get(h.id)!.ms });
    expect(out.changed).toBe(true);
    expect(out.rec.modelRev).toBe(r.modelRev);
    expect(out.rec.modelRev).not.toBe(modelId(cur).rev);
    expect(exportState(out.doc, out.rec)).toBe("stale");
    expect(exportLine(out.doc, out.rec)).not.toMatch(/odpovídá modelu/);
    expect(exportLine(out.doc, out.rec)).toMatch(/ZASTARALÝ/);
  });

  it("kolo 3 (bod 22h): úplný záznam úlohy zůstane v dokumentu – id, stav, čas, fáze, kontrola; nezměněný model = „odpovídá modelu“", async () => {
    resetExportChecks();
    const t = new RunTracker();
    const { d } = deps();
    const cur = doc();
    d.doc = () => cur;
    const h = exportRun(t, { format: "step", label: "STEP", source: "menu", target: { name: "Deska A.step", handle: handle() } }, d);
    const r = await h.done;
    const out = recordExportJob(cur, { format: "step", file: "Deska A.step", job: r, id: h.id, ms: 1234 });
    expect(out.changed).toBe(false);
    expect(out.rec.job).toMatchObject({ id: h.id, state: "done", ms: 1234, check: { ok: true } });
    expect(out.rec.job?.phases?.map((p) => p.phase)).toEqual(["model", "convert", "verify", "write"]);
    expect(out.doc.outputs?.at(-1)?.job?.id).toBe(h.id); // v dokumentu (uloží se s ním), ne jen v relaci
    const line = exportLine(out.doc, out.rec);
    expect(line).toMatch(/úloha: dokončeno ⏱ 1,2 s · kontrola ✓ – odpovídá modelu$/);
  });

  it("discardTarget: odstraní jen cíl s handle.remove", async () => {
    expect(await discardTarget(null)).toBe(false);
    expect(await discardTarget({ name: "a", handle: null })).toBe(false);
    expect(await discardTarget({ name: "a", handle: handle() })).toBe(true);
    expect(await discardTarget({ name: "a", handle: { remove: async () => Promise.reject(new Error("x")) } })).toBe(false);
  });
});
