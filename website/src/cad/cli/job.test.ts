/**
 * Smyčka fáze A a závěr běhu (job.ts) bez jádra: falešné `KernelApi`, MemoryWorkspace a soubory v paměti.
 * Celé vlákno s jádrem OCCT ověřuje e2e/cad-cli.e2e.cjs na sestaveném svazku.
 */
import { afterEach, describe, expect, it } from "vitest";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../engine/host";
import type { KernelApi } from "../engine/kernel";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { registerOp, unregisterOp } from "../engine/ops/registry";
import { ReportBuilder } from "../engine/protocol";
import { emptyDoc, type CadDoc } from "../types";
import { agentExamples, finishRun, formatsFor, interimRun, opLabel, pickMain, StagingSink, strictStopper, type OutputPolicy, type RunHooks } from "./job";
import { parseAgentText } from "../agent";

const plate: CadDoc = {
  ...emptyDoc("Deska 1"),
  material: "ocel",
  features: [
    { id: "f1", name: "Kvádr 1", type: "box", size: [100, 50, 10], position: [0, 0, 0], centered: false, mode: "new" },
    { id: "f2", name: "Díra 1", type: "hole", position: [20, 20, 10], axis: "Z", flip: false, diameter: 8, depth: 0, cbDiameter: 0, cbDepth: 0 },
  ] as CadDoc["features"],
};
const enc = (o: unknown) => new TextEncoder().encode(typeof o === "string" ? o : JSON.stringify(o));

function fakeKernel(o: { failBuild?: string; featureError?: boolean; featureWarning?: boolean } = {}) {
  const calls: string[] = [];
  const k = {
    generation: () => 1,
    build: async (d: CadDoc) => {
      calls.push(`build:${d.name}`);
      if (o.failBuild) throw new Error(o.failBuild);
      return { status: d.features.map((f, i) => ({ id: f.id, ok: !(o.featureError && i === 1), ...(o.featureError && i === 1 ? { error: "díra mimo těleso" } : {}), ...(o.featureWarning && i === 1 ? { warning: "Prvek těleso nezměnil" } : {}) })), mesh: null, metrics: { volume: 49497.3, area: 1, bbox: [[0, 0, 0], [100, 50, 10]], faces: 7, edges: 15 }, ms: 1 };
    },
    exportFile: async (d: CadDoc, f: string) => {
      calls.push(`export:${f}:${d.name}`);
      return new TextEncoder().encode("ISO-10303-21;").buffer;
    },
  };
  return { kernel: k as unknown as KernelApi, calls };
}
const hooksLog = () => {
  const log: string[] = [];
  const hooks: RunHooks = { opStart: (l, op) => void log.push(`start ${l ?? "-"} ${op}`), opEnd: (l, op) => void log.push(`end ${l ?? "-"} ${op}`) };
  return { log, hooks };
};
const setup = (files: Record<string, Uint8Array> = {}, kernelOpts = {}) => {
  const ws = new MemoryWorkspace();
  const sink = memoryFileSink();
  const { kernel, calls } = fakeKernel(kernelOpts);
  const host: EngineHost = { kernel, files: sink, inputs: memoryFileSource(files), now: () => Date.now() };
  return { ws, sink, host, calls, rb: (script = "", strict = false) => new ReportBuilder({ lang: "cs", lines: script.split("\n").length, strict }) };
};
const codes = (rb: ReportBuilder) => rb.entries.map((e) => `${e.line ?? "-"} ${e.level} ${e.code}`);

afterEach(() => void unregisterOp("meta"));

describe("interimRun – smyčka fáze A (rozbor + registr enginu)", () => {
  it("operace bez obsluhy v registru = ✗ host.app-only s řádkem; chyba rozboru = ✗ parse.error; počet operací", async () => {
    const s = setup();
    const script = 'nový díl "A"\nkvádr 10 10 10\nblbost\n';
    const rb = s.rb(script);
    const { log, hooks } = hooksLog();
    await interimRun(s.ws, script, s.host, rb, { strict: false, open: [] }, hooks);
    expect(codes(rb)).toEqual(["3 error parse.error", "1 error host.app-only", "2 error host.app-only"]);
    expect(rb.entries[1].text).toBe("příkaz funguje jen v aplikaci v prohlížeči: new");
    expect(rb.entries[2].text).toMatch(/feature:box$/);
    expect(log).toEqual(["start 1 new", "end 1 new", "start 2 feature:box", "end 2 feature:box"]);
    const r = rb.finish();
    expect(r.counts).toMatchObject({ ops: 2, errors: 3 });
  });
  it("zaregistrovaná obsluha se použije místo ✗ host.app-only (B2 sem přidá obsluhy)", async () => {
    registerOp("meta", async (op, ctx) => {
      ctx.ws.commit({ ...ctx.ws.present(), ...op.patch });
    });
    const s = setup();
    const rb = s.rb();
    await interimRun(s.ws, "název Nový název\nkvádr 1 1 1", s.host, rb, { strict: false, open: [] }, hooksLog().hooks);
    expect(codes(rb)).toEqual(["2 error host.app-only"]);
    expect(s.ws.present().name).toBe("Nový název");
    expect(rb.finish().counts.ops).toBe(2);
  });
  it("přísný režim: chyba rozboru zastaví běh před provedením; jinak první ⚠/✗ (kromě výjimek) zastaví", async () => {
    const s = setup();
    const rb1 = s.rb("", true);
    await interimRun(s.ws, "kvádr 1 1 1\nblbost", s.host, rb1, { strict: true, open: [] }, hooksLog().hooks);
    expect(rb1.stopped).toEqual({ line: 2, code: "parse.error" });
    expect(codes(rb1)).toEqual(["2 error parse.error"]);
    const rb2 = s.rb("", true);
    await interimRun(s.ws, "kvádr 1 1 1\nválec 5 5", s.host, rb2, { strict: true, open: [] }, hooksLog().hooks);
    expect(rb2.stopped).toEqual({ line: 1, code: "host.app-only" });
    expect(codes(rb2)).toEqual(["1 error host.app-only"]);
    const rb3 = s.rb("", true);
    await interimRun(s.ws, "kvádr 1 1 1\nválec 5 5", s.host, rb3, { strict: { except: ["host.app-only"] }, open: [] }, hooksLog().hooks);
    expect(rb3.stopped).toBeUndefined();
    expect(strictStopper([{ line: 1, level: "note", code: "clash.thread", text: "" }], true)).toBeUndefined();
    expect(strictStopper([{ line: 1, level: "warn", code: "a.b", text: "" }], false)).toBeUndefined();
  });
  it("--open: .mncad přes FileSource do záložky; chybějící soubor, jiný formát a neplatný JSON = řádné ✗ s kódem", async () => {
    const s = setup({ "deska.mncad": enc(plate), "bad.mncad": enc("{nope"), "x.step": enc("ISO"), "nodoc.mncad": enc({ a: 1 }) });
    const rb = s.rb();
    const { log, hooks } = hooksLog();
    await interimRun(s.ws, "", s.host, rb, { strict: false, open: ["deska.mncad", "chybí.mncad", "x.step", "bad.mncad", "nodoc.mncad", "../../etc/passwd"] }, hooks);
    expect(codes(rb)).toEqual(["- ok undefined", "- error file.missing", "- error host.app-only", "- error op.failed", "- error op.failed", "- error file.missing"]);
    expect(rb.entries[1].text).toMatch(/chybí\.mncad.*bad\.mncad, deska\.mncad, nodoc\.mncad, x\.step/);
    expect(s.ws.present().name).toBe("Deska 1");
    expect(s.ws.tabs()).toHaveLength(1); // úvodní prázdný díl relace se znovu použil
    expect(log.filter((l) => l.startsWith("start"))).toHaveLength(6);
  });
  it("přísně: chybějící --open zastaví běh hned (STOP file.missing), skript ani další --open se neprovedou", async () => {
    const s = setup({ "deska.mncad": enc(plate) });
    const rb = s.rb("kvádr 1 1 1", true);
    const { log, hooks } = hooksLog();
    await interimRun(s.ws, "kvádr 1 1 1", s.host, rb, { strict: true, open: ["chybí.mncad", "deska.mncad"] }, hooks);
    expect(rb.stopped).toEqual({ line: null, code: "file.missing" });
    expect(codes(rb)).toEqual(["- error file.missing"]);
    expect(rb.entries[0].text).toBe("soubor „chybí.mncad“ není k dispozici – dostupné: deska.mncad");
    expect(log).toEqual(["start - open", "end - open"]);
    expect(s.ws.present().features).toHaveLength(0);
    // výjimka kódu: běh pokračuje
    const rb2 = s.rb("", true);
    await interimRun(s.ws, "", s.host, rb2, { strict: { except: ["file.missing"] }, open: ["chybí.mncad", "deska.mncad"] }, hooksLog().hooks);
    expect(rb2.stopped).toBeUndefined();
    expect(s.ws.present().name).toBe("Deska 1");
  });
  it("prázdný skript bez --open = ✗ parse.error", async () => {
    const s = setup();
    const rb = s.rb();
    await interimRun(s.ws, "  \n", s.host, rb, { strict: false, open: [] }, hooksLog().hooks);
    expect(codes(rb)).toEqual(["- error parse.error"]);
  });
});

describe("finishRun – souhrny, výstupy při ✗, přísný STOP", () => {
  const opened = async (kernelOpts = {}) => {
    const s = setup({ "deska.mncad": enc(plate) }, kernelOpts);
    const rb = s.rb();
    await interimRun(s.ws, "", s.host, rb, { strict: false, open: ["deska.mncad"] }, hooksLog().hooks);
    return { ...s, rb2: rb };
  };
  it("hlavní dokument se postaví; D se souhrnem; --formats auto = STEP + .mncad", async () => {
    const s = await opened();
    const { log, hooks } = hooksLog();
    const fin = await finishRun(s.ws, s.host, s.rb2, { formats: "auto", allDocs: false, noOutputOnError: false, share: false }, hooks);
    expect(fin.docs).toEqual([expect.objectContaining({ name: "Deska 1", kind: "part", main: true, features: { ok: 2, warn: 0, error: 0 }, volume_mm3: 49497.3, density: 7.85 })]);
    expect(fin.docs[0].mass_kg).toBeCloseTo(0.3885, 3);
    expect([...s.sink.files.keys()]).toEqual(["Deska 1.step", "Deska 1.mncad"]);
    expect(JSON.parse(new TextDecoder().decode(s.sink.files.get("Deska 1.mncad")!.data)).name).toBe("Deska 1");
    expect(s.calls).toEqual(["build:Deska 1", "export:step:Deska 1"]);
    expect(log).toEqual(["start - build", "end - build", "start - out:step", "end - out:step", "start - out:mncad", "end - out:mncad"]);
  });
  it("✗ ve skriptu: soubory se zapíší (run=fail značí handleRun); --no-output-on-error nezapíše nic", async () => {
    const a = await opened();
    a.rb2.code("parse.error", { line: 3, args: ["x"] });
    await finishRun(a.ws, a.host, a.rb2, { formats: ["step"], allDocs: false, noOutputOnError: false, share: false }, hooksLog().hooks);
    expect(a.sink.files.size).toBe(1);
    const b = await opened();
    b.rb2.code("parse.error", { line: 3, args: ["x"] });
    await finishRun(b.ws, b.host, b.rb2, { formats: ["step"], allDocs: false, noOutputOnError: true, share: false }, hooksLog().hooks);
    expect(b.sink.files.size).toBe(0);
  });
  it("přísný STOP → žádné výstupy --formats; dokument, jehož stavba selhala, se nezapíše (✗ feature.failed / build.failed)", async () => {
    const a = await opened();
    a.rb2.stop(2, "select.ambiguous");
    await finishRun(a.ws, a.host, a.rb2, { formats: "auto", allDocs: false, noOutputOnError: false, share: false }, hooksLog().hooks);
    expect(a.sink.files.size).toBe(0);
    const b = await opened({ featureError: true });
    const fb = await finishRun(b.ws, b.host, b.rb2, { formats: "auto", allDocs: false, noOutputOnError: false, share: false }, hooksLog().hooks);
    expect(b.sink.files.size).toBe(0);
    expect(fb.docs[0].features).toEqual({ ok: 1, warn: 0, error: 1 });
    expect(codes(b.rb2)).toContain("- error feature.failed");
    expect(b.rb2.entries.find((e) => e.code === "feature.failed")).toMatchObject({ doc: "Deska 1", text: "prvek „Díra 1“ se nepostavil: díra mimo těleso" });
    const c = await opened({ failBuild: "OCCT: chyba" });
    await finishRun(c.ws, c.host, c.rb2, { formats: "auto", allDocs: false, noOutputOnError: false, share: false }, hooksLog().hooks);
    expect(codes(c.rb2)).toContain("- error build.failed");
    expect(c.sink.files.size).toBe(0);
  });
  const pol = (o: Partial<OutputPolicy> = {}): OutputPolicy => ({ formats: "auto", allDocs: false, noOutputOnError: false, share: false, ...o });
  it("přísně: ⚠/✗ ze závěrečné stavby (feature.warning, feature.failed, build.failed) = STOP, nic se nezapíše", async () => {
    for (const [ko, code, level] of [
      [{ featureWarning: true }, "feature.warning", "warn"],
      [{ featureError: true }, "feature.failed", "error"],
      [{ failBuild: "OCCT" }, "build.failed", "error"],
    ] as const) {
      const s = await opened(ko);
      const fin = await finishRun(s.ws, s.host, s.rb2, pol({ formats: ["step"], strict: true }), hooksLog().hooks);
      expect(s.rb2.stopped, code).toEqual({ line: null, code });
      expect(s.sink.files.size, code).toBe(0);
      expect(codes(s.rb2), code).toContain(`- ${level} ${code}`);
      expect(fin.docs).toHaveLength(1); // souhrn D zůstává
    }
    // nepřísně: varování stavby nezastaví a soubory se zapíší
    const n = await opened({ featureWarning: true });
    await finishRun(n.ws, n.host, n.rb2, pol({ formats: ["step"] }), hooksLog().hooks);
    expect(n.rb2.stopped).toBeUndefined();
    expect([...n.sink.files.keys()]).toEqual(["Deska 1.step"]);
    // výjimka kódu v přísném režimu
    const e = await opened({ featureWarning: true });
    await finishRun(e.ws, e.host, e.rb2, pol({ formats: ["step"], strict: { except: ["feature.warning"] } }), hooksLog().hooks);
    expect(e.rb2.stopped).toBeUndefined();
    expect(e.sink.files.size).toBe(1);
  });
  it("přísně: ✗ při výrobě výstupů = STOP a nezapíše se ani výstup, který vznikl dřív (zápis nanečisto)", async () => {
    const s = await opened();
    const { log, hooks } = hooksLog();
    await finishRun(s.ws, s.host, s.rb2, pol({ formats: ["step", "csv"], strict: true }), hooks);
    expect(s.rb2.stopped).toEqual({ line: null, code: "host.app-only" });
    expect(s.sink.files.size).toBe(0);
    expect(s.calls).toContain("export:step:Deska 1"); // STEP vznikl, ale do paměti relace / na disk nešel
    expect(log).not.toContain("start - out:write");
    const n = await opened();
    await finishRun(n.ws, n.host, n.rb2, pol({ formats: ["step", "csv"] }), hooksLog().hooks);
    expect([...n.sink.files.keys()]).toEqual(["Deska 1.step"]);
    expect(codes(n.rb2)).toContain("- error host.app-only");
    // přísně bez ⚠/✗: odložené soubory se zapíší (pořadí, SHA-256)
    const ok = await opened();
    const h2 = hooksLog();
    await finishRun(ok.ws, ok.host, ok.rb2, pol({ strict: true }), h2.hooks);
    expect([...ok.sink.files.keys()]).toEqual(["Deska 1.step", "Deska 1.mncad"]);
    expect(ok.sink.files.get("Deska 1.step")!.file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(h2.log.slice(-2)).toEqual(["start - out:write", "end - out:write"]);
  });
  it("prázdný dokument: vyžádané výstupy a odkaz nikdy tiše – ⚠ out.empty (auto), ✗ (výslovné formáty, --share), přísně STOP", async () => {
    const empty = { ...emptyDoc("Prázdný"), features: [] } as CadDoc;
    const emptyAsm = { ...emptyDoc("Prázdná sestava"), kind: "assembly", components: [] } as unknown as CadDoc;
    const run = async (doc: CadDoc, p: Partial<OutputPolicy>, strict = false) => {
      const s = setup({ "e.mncad": enc(doc) });
      const rb = s.rb("", strict);
      await interimRun(s.ws, "", s.host, rb, { strict, open: ["e.mncad"] }, hooksLog().hooks);
      const fin = await finishRun(s.ws, s.host, rb, pol({ ...p, strict }), hooksLog().hooks);
      return { rb, fin, s, e: rb.entries.filter((x) => x.code === "out.empty") };
    };
    let r = await run(empty, {});
    expect(r.e).toEqual([expect.objectContaining({ level: "warn", doc: "Prázdný", text: "prázdný dokument – nezapsáno: STEP, .mncad" })]);
    expect(r.s.sink.files.size).toBe(0);
    r = await run(empty, { formats: ["step", "pdf"], share: { view: "model", days: 10 } });
    expect(r.e).toEqual([expect.objectContaining({ level: "error", text: "prázdný dokument – nezapsáno: STEP, PDF, odkaz" })]);
    expect(r.fin.share).toBeUndefined();
    r = await run(empty, { formats: "none", share: { view: "model", days: 10 } });
    expect(r.e).toEqual([expect.objectContaining({ level: "error", text: "prázdný dokument – nezapsáno: odkaz" })]);
    r = await run(empty, { formats: "none" });
    expect(r.e).toEqual([]); // nic nevyžádáno
    r = await run(emptyAsm, { formats: ["step"] }, true);
    expect(r.e).toEqual([expect.objectContaining({ level: "error", doc: "Prázdná sestava" })]);
    expect(r.rb.stopped).toEqual({ line: null, code: "out.empty" });
    r = await run(empty, {}, true);
    expect(r.rb.stopped).toEqual({ line: null, code: "out.empty" });
    // --all-docs: další prázdný dokument = ℹ, hlavní s obsahem se zapíše
    const s = setup({ "e.mncad": enc(emptyAsm), "deska.mncad": enc(plate) });
    const rb = s.rb();
    await interimRun(s.ws, "", s.host, rb, { strict: false, open: ["e.mncad", "deska.mncad"] }, hooksLog().hooks);
    await finishRun(s.ws, s.host, rb, pol({ formats: ["step"], allDocs: true }), hooksLog().hooks);
    expect(rb.entries.filter((x) => x.code === "out.empty").map((x) => [x.level, x.doc])).toEqual([["note", "Prázdná sestava"]]);
    expect([...s.sink.files.keys()]).toEqual(["Deska 1.step"]);
  });
  it("StagingSink: ověří název hned, zapíše až flush (údaje doplněné po zápisu nanečisto se přenesou), discard nezapíše nic", async () => {
    const sink = memoryFileSink();
    const st = new StagingSink(sink);
    const f = await st.write({ name: "a/b.pdf", mime: "application/pdf", data: new Uint8Array([1]), doc: "D", format: "pdf" });
    expect(f.name).toBe("a_b.pdf");
    f.sheets = 1;
    await expect(st.write({ name: "..", mime: "x", data: new Uint8Array(), doc: "D", format: "pdf" })).rejects.toThrow(/mimo výstupní složku/);
    expect(sink.files.size).toBe(0);
    await st.flush(() => undefined);
    expect(sink.files.get("a_b.pdf")!.file).toMatchObject({ sheets: 1, bytes: 1 });
    await st.write({ name: "c.step", mime: "x", data: new Uint8Array([2]), doc: "D", format: "step" });
    st.discard();
    await st.flush(() => undefined);
    expect([...sink.files.keys()]).toEqual(["a_b.pdf"]);
  });
  it("--doc: neznámý název = ✗ op.failed a nic se nezapíše; výběr hlavního dokumentu (sestava > aktivní)", async () => {
    const a = await opened();
    await finishRun(a.ws, a.host, a.rb2, { formats: "auto", doc: "Neni", allDocs: false, noOutputOnError: false, share: false }, hooksLog().hooks);
    expect(codes(a.rb2)).toContain("- error op.failed");
    expect(a.sink.files.size).toBe(0);
    const part = { id: "p", doc: plate };
    const asm = { id: "a", doc: { ...emptyDoc("Sestava"), kind: "assembly", components: [{ id: "c", source: { kind: "part", doc: plate } }] } as unknown as CadDoc };
    expect(pickMain([part, asm], "p")).toBe(asm);
    expect(pickMain([part], "p")).toBe(part);
    expect(pickMain([part, asm], "a", "deska 1")).toBe(part);
    expect(pickMain([part], "p", "x")).toBe("missing");
  });
  it("formatsFor – auto podle druhu dokumentu", () => {
    expect(formatsFor(plate, "auto")).toEqual(["step", "mncad"]);
    expect(formatsFor({ ...plate, drawings: [{}] } as unknown as CadDoc, "auto")).toEqual(["step", "mncad", "pdf"]);
    expect(formatsFor({ ...plate, kind: "draft" } as unknown as CadDoc, "auto")).toEqual(["mncad"]);
    expect(formatsFor(plate, "none")).toEqual([]);
    expect(formatsFor(plate, ["stl"])).toEqual(["stl"]);
  });
});

describe("příklady pro smoke test", () => {
  it("každý příkaz z AGENT_COMMANDS a každý blok kódu AGENT_GUIDE", () => {
    const ex = agentExamples();
    expect(ex.filter((e) => e.src.startsWith("AGENT_COMMANDS")).length).toBeGreaterThan(80);
    expect(ex.filter((e) => e.src.startsWith("AGENT_GUIDE")).length).toBeGreaterThanOrEqual(20);
    expect(opLabel(parseAgentText("kvádr 1 2 3").ops[0])).toBe("feature:box");
    expect(opLabel(parseAgentText("kolize").ops[0])).toBe("clash");
  });
});
