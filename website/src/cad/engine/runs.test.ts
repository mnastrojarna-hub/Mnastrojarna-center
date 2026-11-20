/**
 * Vlna E, balík runs – engine: opakovaný běh téhož skriptu (idempotence, engine/runs.ts), řádek D každého dokumentu běhu
 * s čísly (engine/run-summary.ts), relace CLI `--resume` se stejným pravidlem, B1 / B2 (prázdná sestava, 27 záložek).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import { emptyDoc, type BuildResult, type CadDoc, type ComponentSource } from "../types";
import { engineRun, finishRun, type RunHooks } from "../cli/job";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./host";
import type { KernelApi } from "./kernel";
import { loadWorkspace, MemoryWorkspace } from "./memory-workspace";
import { docLine, finalizeReport, formatConsole, GRAMMAR, mergeTakeovers, ReportBuilder, shortProtocol } from "./protocol";
import type { RunReport } from "./protocol-types";
import { runScript } from "./run";
import { checkRunOptions, formatRun, runReport, scriptLineCount } from "./run-protocol";
import { scriptLines } from "../cli/watchdog";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");

const result = (d: CadDoc): BuildResult =>
  ({ status: d.features.map((f) => ({ id: f.id, ok: true })), mesh: null, metrics: d.features.length ? { volume: 1000 * d.features.length, area: 600, bbox: [[0, 0, 0], [10, 10, 10 * d.features.length]], faces: 6, edges: 12, valid: true, solids: 1 } : null, ms: 1 }) as unknown as BuildResult;
const fake = {
  generation: () => 1,
  build: async (d: CadDoc) => result(d),
  check: async (d: CadDoc) => ({ status: d.features.map((f) => ({ id: f.id, ok: true })), paramErrors: [], solid: true }),
  asmParts: async (parts: { key: string; source: ComponentSource }[]) => parts.map((p) => ({ key: p.key, result: result(p.source.kind === "part" ? p.source.doc : emptyDoc()) })),
  interference: async () => [],
  asmEnvelope: async () => null,
} as unknown as KernelApi;
const hostOf = (kernel: KernelApi = fake): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
const titles = (ws: MemoryWorkspace) => ws.tabs().map((t) => `${t.title}:${t.kind}`);
const codes = (r: RunReport, code: string) => r.entries.filter((e) => e.code === code);
const THREE = 'nový díl "Deska"\nkvádr 100 50 10\nnový díl "Čep"\nválec 5 30\nnová sestava "S"\nvložit "Deska" v 0 0 0\nvložit "Čep" v 20 20 10';

const noHooks: RunHooks = { opStart: () => undefined, opEnd: () => undefined };
/** běh jako `mncad run - --formats none` (cli/job.ts handleRun bez vlákna): engine + závěr CLI → RunReport */
async function cliRun(ws: MemoryWorkspace, script: string, host: EngineHost, o: { resume?: boolean } = {}): Promise<RunReport> {
  const rb = new ReportBuilder({ lang: "cs", lines: scriptLines(script), strict: false });
  if (o.resume) rb.code("session.history");
  await engineRun(ws, script, host, rb, { strict: false, open: [], allowEmpty: !!o.resume }, noHooks);
  const fin = await finishRun(ws, host, rb, { formats: "none", allDocs: false, noOutputOnError: false, share: false, strict: false }, noHooks);
  return rb.finish({ docs: fin.docs, files: [] });
}

describe("opakovaný běh – nový díl \"A\" použije záložku dřívějšího běhu (engine/runs.ts)", () => {
  it("3 dokumenty dvakrát: stejné záložky, ℹ doc.reused u každého, prvky nezdvojené, zpět vrátí obsah 1. běhu", async () => {
    const ws = new MemoryWorkspace();
    const r1 = await runScript(ws, THREE, hostOf());
    expect(titles(ws)).toEqual(["Deska:part", "Čep:part", "S:assembly"]);
    expect(codes(r1, "doc.reused")).toHaveLength(0);
    const r2 = await runScript(ws, THREE, hostOf());
    expect(titles(ws)).toEqual(["Deska:part", "Čep:part", "S:assembly"]);
    expect(codes(r2, "doc.reused").map((e) => `L${e.line} ${e.doc}`)).toEqual(["L1 Deska", "L3 Čep", "L5 S"]);
    expect(formatConsole(r2)).toMatch(/✓ nový díl „Deska“ – znovu použitá záložka z dřívějšího běhu\nℹ řádek 1: záložka „Deska“ z dřívějšího běhu použita znovu/);
    // dokumenty: jeden prvek, sestava se dvěma komponentami (ne čtyřmi), komponenty míří na díly tohoto běhu
    const docs = ws.tabs().map((t) => ws.docOf(t.id)!);
    expect(docs.map((d) => d.features.length)).toEqual([1, 1, 0]);
    expect(docs[2].components?.map((c) => c.name)).toEqual(["Deska", "Čep"]);
    expect(r2.counts.errors).toBe(0);
    // jeden krok historie na převzatou záložku: zpět = obsah 1. běhu (sestava je aktivní)
    expect(ws.historyDepth().undo).toBe(1);
    ws.undo(1);
    expect(ws.present().components).toHaveLength(2);
    expect(ws.present().components![0].source.kind).toBe("part");
  });

  it("třetí běh s `nový` = nová záložka; `znovu` převezme i záložku, kterou běh nezaložil; cizí záložka jinak zůstane (ℹ doc.name-taken)", async () => {
    const ws = new MemoryWorkspace();
    await runScript(ws, 'nový díl "A"\nkvádr 1 1 1', hostOf());
    const rn = await runScript(ws, 'nový díl "A" nový\nkvádr 2 2 2', hostOf());
    expect(titles(ws)).toEqual(["A:part", "A:part"]);
    expect(codes(rn, "doc.reused")).toHaveLength(0);
    // záložka otevřená mimo běh (soubor, ruční práce) – stejný název
    const ws2 = new MemoryWorkspace();
    await ws2.openInTab({ ...emptyDoc("B"), features: [{ id: "u1", name: "Kvádr 1", type: "box", size: [5, 5, 5], position: [0, 0, 0], centered: false, mode: "new" }] as CadDoc["features"] });
    const rt = await runScript(ws2, 'nový díl "B"\nkvádr 1 1 1', hostOf());
    expect(titles(ws2)).toEqual(["B:part", "B:part"]);
    expect(codes(rt, "doc.name-taken").map((e) => e.line)).toEqual([1]);
    expect(ws2.docOf(ws2.tabs()[0].id)!.features[0].id).toBe("u1"); // obsah uživatele beze změny
    const ws3 = new MemoryWorkspace();
    await ws3.openInTab({ ...emptyDoc("C"), features: [{ id: "u2", name: "Kvádr 1", type: "box", size: [5, 5, 5], position: [0, 0, 0], centered: false, mode: "new" }] as CadDoc["features"] });
    const rz = await runScript(ws3, 'nový díl "C" znovu\nkvádr 1 1 1', hostOf());
    expect(titles(ws3)).toEqual(["C:part"]);
    expect(codes(rz, "doc.reused")).toHaveLength(1);
    expect(ws3.present().features.map((f) => f.id)).not.toContain("u2");
  });

  it("dvakrát `nový díl \"A\"` v jednom skriptu = dvě záložky i po opakování; jiný druh (sestava „A“) se nepřevezme; bez názvu vždy nový", async () => {
    const ws = new MemoryWorkspace();
    const twice = 'nový díl "A"\nkvádr 1 1 1\nnový díl "A"\nkvádr 2 2 2';
    await runScript(ws, twice, hostOf());
    await runScript(ws, twice, hostOf());
    expect(titles(ws)).toEqual(["A:part", "A:part"]);
    await runScript(ws, 'nová sestava "A"', hostOf());
    expect(titles(ws)).toEqual(["A:part", "A:part", "A:assembly"]);
    await runScript(ws, "nový díl\nkvádr 1 1 1", hostOf());
    await runScript(ws, "nový díl\nkvádr 1 1 1", hostOf());
    expect(titles(ws).slice(3)).toEqual(["Nový díl:part", "Nový díl 2:part"]);
  });

  it("CLI --resume: relace nese záložky běhů (`made`) – druhý běh nad relací má 3 dokumenty, ne 6; starší relace bez `made` = nové záložky", async () => {
    const ws = new MemoryWorkspace();
    const r1 = await cliRun(ws, THREE, hostOf());
    expect(r1.docs.map((d) => d.name)).toEqual(["Deska", "Čep", "S"]);
    const saved = ws.save();
    expect(JSON.parse(new TextDecoder().decode(saved)).made).toEqual([0, 1, 2]);
    const ws2 = loadWorkspace(saved);
    const r2 = await cliRun(ws2, THREE, hostOf(), { resume: true });
    expect(r2.docs.map((d) => d.name)).toEqual(["Deska", "Čep", "S"]);
    expect(codes(r2, "doc.reused")).toHaveLength(3);
    // relace z dřívější verze (bez pole `made`): nic se nepřevezme, dokument v nové záložce + ℹ doc.name-taken
    const old = JSON.parse(new TextDecoder().decode(saved));
    delete old.made;
    const ws3 = loadWorkspace(new TextEncoder().encode(JSON.stringify(old)));
    const r3 = await cliRun(ws3, THREE, hostOf(), { resume: true });
    expect(r3.docs).toHaveLength(6);
    expect(codes(r3, "doc.name-taken")).toHaveLength(3);
  });

  it("B1: prázdná sestava běhu je vlastní záložka a má řádek D; B2: 27× nový díl = 27 záložek a 27 řádků D s čísly", async () => {
    const ws = new MemoryWorkspace();
    const r1 = await cliRun(ws, 'nová sestava "Prázdná"', hostOf());
    expect(r1.docs.map(docLine)).toEqual(['D "Prázdná" asm comp=0 parts=0 V.sum=-']);
    const r2 = await cliRun(ws, 'nový díl "Po"\nkvádr 1 1 1', hostOf());
    expect(titles(ws)).toEqual(["Prázdná:assembly", "Po:part"]);
    expect(r2.docs.map((d) => d.name)).toEqual(["Po"]); // prázdná sestava dřívějšího běhu bez změny = bez řádku D
    const ws2 = new MemoryWorkspace();
    const r = await cliRun(ws2, Array.from({ length: 27 }, (_, i) => `nový díl D${i + 1}\nkvádr 1 1 ${i + 1}`).join("\n"), hostOf());
    expect(ws2.tabs()).toHaveLength(27);
    expect(r.docs).toHaveLength(27);
    for (const d of r.docs) expect(docLine(d), d.name).toMatch(/^D "D\d+" part feat=1\/0\/0 V=1cm3 m=0\.008kg bbox=10x10x10 solids=1 valid=1$/);
  });
});

describe("protokol v prohlížeči = CLI (engine/run-protocol.ts)", () => {
  it("scriptLineCount = CLI scriptLines; neznámý protokol = chyba; console = text konzole", async () => {
    for (const t of ["", "a", "a\n", "a\nb", "a\r\nb\r\n", "\n\n"]) expect(scriptLineCount(t), JSON.stringify(t)).toBe(scriptLines(t));
    const r = await runReport(new MemoryWorkspace(), 'nový díl "P"\nkvádr 10 10 10', hostOf());
    expect(formatRun(r)).toBe(r.console);
    expect(() => formatRun(r, { protocol: "brief" as never })).toThrow(/neznámý protokol „brief“ – console, short, full, json/);
    const short = formatRun(r, { protocol: "short" });
    for (const l of short.split("\n")) expect(Object.values(GRAMMAR).some((re) => re.test(l)), l).toBe(true);
    expect(short).toMatch(/^MNCAD\/1 OK lines=2 ops=2 err=0 warn=0 note=\d+ t=[\d.]+\nD "P" part feat=1\/0\/0 V=1cm3 m=0\.008kg bbox=10x10x10 solids=1 valid=1\nΣ docs=1 V=1cm3 m=0\.008kg files=0 t=/);
    const j = JSON.parse(formatRun(r, { protocol: "json" })) as RunReport;
    expect(j.protocol).toBe(short);
    expect(j.full).toBe(formatRun(r, { protocol: "full" }));
    expect(j).not.toHaveProperty("console");
  });
});

/* ───────── recenze vlny E: idempotence všech dokumentů běhu, původ záložky, viditelnost, volby, vedlejší dokument bez tělesa ───────── */
const box = (id: string, n = 5): CadDoc["features"] => [{ id, name: "Kvádr 1", type: "box", size: [n, n, n], position: [0, 0, 0], centered: false, mode: "new" }] as CadDoc["features"];
const fileHost = (files: Record<string, CadDoc>): EngineHost => ({ ...hostOf(), inputs: memoryFileSource(Object.fromEntries(Object.entries(files).map(([k, d]) => [k, new TextEncoder().encode(JSON.stringify(d))]))) });
const NORM = 'nový díl "Deska"\nkvádr 100 60 20\nnormálie kolík 8x40 ISO 8734\nnormálie podložka M8 ISO 7089\nnová sestava "Sestava"\nvložit "Deska" ukotvit\nvložit "Kolík Ø8×40 ISO 8734" v 20 20 20\nvložit "Podložka 8 ISO 7089" v 50 20 20';

describe("recenze (nález 2): opakovaný běh je idempotentní i pro normálie, otevřít a JSON dokumenty", () => {
  it("normálie dvakrát (prohlížeč i CLI --resume): 4 záložky, ne 6; ✓ normálie „… – znovu použitá záložka“ + ℹ doc.reused", async () => {
    const ws = new MemoryWorkspace();
    await runScript(ws, NORM, hostOf());
    expect(titles(ws)).toEqual(["Deska:part", "Kolík Ø8×40 ISO 8734:part", "Podložka 8 ISO 7089:part", "Sestava:assembly"]);
    const r2 = await runScript(ws, NORM, hostOf());
    expect(titles(ws)).toEqual(["Deska:part", "Kolík Ø8×40 ISO 8734:part", "Podložka 8 ISO 7089:part", "Sestava:assembly"]);
    expect(codes(r2, "doc.reused").map((e) => `L${e.line} ${e.doc}`)).toEqual(["L1 Deska", "L3 Kolík Ø8×40 ISO 8734", "L4 Podložka 8 ISO 7089", "L5 Sestava"]);
    expect(formatConsole(r2)).toContain("✓ normálie „ISO 8734 – 8×40 – m6“ – znovu použitá záložka z dřívějšího běhu");
    expect(ws.present().components?.map((c) => c.name)).toEqual(["Deska", "Kolík Ø8×40 ISO 8734", "Podložka 8 ISO 7089"]);
    // CLI: relace → --resume → stejné dokumenty (dřív Σ docs 4 → 6)
    const c1 = new MemoryWorkspace();
    const a = await cliRun(c1, NORM, hostOf());
    const b = await cliRun(loadWorkspace(c1.save()), NORM, hostOf(), { resume: true });
    expect(a.docs).toHaveLength(4);
    expect(b.docs.map((d) => d.name)).toEqual(a.docs.map((d) => d.name));
  });

  it("`otevřít \"Deska.mncad\"` dvakrát = jedna záložka (CLI --resume: Σ docs 3 → 3, ne 5); JSON dokument dvakrát = jedna záložka", async () => {
    const host = fileHost({ "Deska.mncad": { ...emptyDoc("Deska"), features: box("f1", 50) } });
    const script = 'otevřít "Deska.mncad"\nnormálie kolík 8x40 ISO 8734\nnová sestava "S"\nvložit "Deska"\nvložit "Kolík Ø8×40 ISO 8734" v 10 10 10';
    const ws = new MemoryWorkspace();
    const a = await cliRun(ws, script, host);
    const saved = ws.save();
    expect(JSON.parse(new TextDecoder().decode(saved))).toMatchObject({ made: [1, 2], opened: [0] });
    const b = await cliRun(loadWorkspace(saved), script, host, { resume: true });
    expect(a.docs).toHaveLength(3);
    expect(b.docs.map((d) => d.name)).toEqual(["Deska", "Kolík Ø8×40 ISO 8734", "S"]);
    expect(codes(b, "doc.reused")).toHaveLength(3);
    const json = JSON.stringify({ ...emptyDoc("Agent"), features: box("j1") });
    const wj = new MemoryWorkspace();
    await runScript(wj, json, hostOf());
    const rj = await runScript(wj, json, hostOf());
    expect(titles(wj)).toEqual(["Agent:part"]);
    // vlna 22 (22i): načtení dokumentu s prvky je přijetí (→ … výsledek po výpočtu), výsledek dá ověřovací stavba
    expect(formatConsole(rj)).toContain("→ dokument „Agent“ (1 prvků) – nahradí záložku téhož názvu z dřívějšího běhu – výsledek po výpočtu níže");
    expect(formatConsole(rj)).toContain("✓ dokument „Agent“ postaven: prvků 1, bez ⚠ a ✗");
  });

  it("dokument s výchozím názvem se nikdy nepřevezme (dva různé nepojmenované JSON dokumenty = dvě záložky)", async () => {
    const ws = new MemoryWorkspace();
    await runScript(ws, JSON.stringify({ ...emptyDoc(), features: box("a1") }), hostOf());
    await runScript(ws, JSON.stringify({ ...emptyDoc(), features: box("b1", 7) }), hostOf());
    expect(titles(ws)).toEqual(["Nový díl:part", "Nový díl:part"]);
    expect(ws.docOf(ws.tabs()[0].id)!.features[0].id).toBe("a1");
  });
});

describe("recenze (nález 3): dokument, který běh OTEVŘEL, `nový díl` téhož názvu nepřepíše", () => {
  it("`otevřít` → `nový díl \"Deska\"` (i přes relaci CLI): nová záložka + ℹ doc.name-taken, otevřený dokument zůstane", async () => {
    const host = fileHost({ "Deska.mncad": { ...emptyDoc("Deska"), features: box("f1", 50) } });
    const ws = new MemoryWorkspace();
    await cliRun(ws, 'otevřít "Deska.mncad"', host);
    const ws2 = loadWorkspace(ws.save());
    const r = await cliRun(ws2, 'nový díl "Deska"\nkvádr 10 10 10', host, { resume: true });
    expect(titles(ws2)).toEqual(["Deska:part", "Deska:part"]);
    expect(codes(r, "doc.name-taken")).toHaveLength(1);
    expect(codes(r, "doc.reused")).toHaveLength(0);
    expect(ws2.docOf(ws2.tabs()[0].id)!.features[0].id).toBe("f1");
    // opačně: `otevřít` nepřepíše záložku, kterou založil `nový díl` téhož názvu
    const ws3 = new MemoryWorkspace();
    await runScript(ws3, 'nový díl "Deska"\nkvádr 10 10 10', host);
    const r3 = await runScript(ws3, 'otevřít "Deska.mncad"', host);
    expect(titles(ws3)).toEqual(["Deska:part", "Deska:part"]);
    expect(codes(r3, "doc.name-taken")).toHaveLength(1);
  });

  it("JSON / setDocument „Ručně“ → `nový díl \"Ručně\"` = nová záložka + ℹ doc.name-taken; `znovu` ji převezme a příště je to záložka běhu", async () => {
    const ws = new MemoryWorkspace();
    await runScript(ws, JSON.stringify({ ...emptyDoc("Ručně"), features: [] }), hostOf());
    const r = await runScript(ws, 'nový díl "Ručně"\nkvádr 3 3 3', hostOf());
    expect(titles(ws)).toEqual(["Ručně:part", "Ručně:part"]);
    expect(codes(r, "doc.name-taken").map((e) => e.line)).toEqual([1]);
    const ws2 = new MemoryWorkspace();
    await runScript(ws2, JSON.stringify({ ...emptyDoc("R2"), features: box("u1") }), hostOf());
    await runScript(ws2, 'nový díl "R2" znovu\nkvádr 3 3 3', hostOf());
    const r2 = await runScript(ws2, 'nový díl "R2"\nkvádr 4 4 4', hostOf());
    expect(titles(ws2)).toEqual(["R2:part"]);
    expect(codes(r2, "doc.reused")).toHaveLength(1);
  });
});

describe("recenze (nález 6): převzetí záložky je vidět i ve stručném protokolu bez --notes", () => {
  it("ℹ doc.reused / doc.name-taken ve stručném protokolu, Σ reused= / name-taken=; ostatní ℹ dál jen s notes", async () => {
    const ws = new MemoryWorkspace();
    await runScript(ws, THREE, hostOf());
    const rep = await cliRun(ws, THREE, hostOf());
    const short = finalizeReport(rep).protocol;
    // víc převzatých záložek = jeden řádek (počet ×N, řádky skriptu, názvy) – 20 hlášek po 200 B by se do 2 kB nevešlo
    expect(short).toContain("\nℹ L1,L3,L5 ×3 doc.reused záložky z dřívějšího běhu použité znovu – obsah nahrazen (volba „nový“ = nová záložka): „Deska“, „Čep“, „S“\n");
    expect(short.match(/doc\.reused/g)).toHaveLength(1);
    expect(short).toMatch(/\nΣ docs=3 comp=2 .* files=0 reused=3 t=/);
    for (const l of short.split("\n")) expect(Object.values(GRAMMAR).some((re) => re.test(l)), l).toBe(true);
    // s notes každá hláška zvlášť (a ostatní ℹ); plný protokol a JSON také
    const withNotes = shortProtocol(rep, { notes: true }).text;
    expect(withNotes).toMatch(/\nℹ L1 doc\.reused "Deska": záložka „Deska“ z dřívějšího běhu použita znovu/);
    expect(withNotes).toMatch(/\nℹ L5 doc\.reused "S": /);
    expect(withNotes).toMatch(/\nℹ L2 op\.accepted /); // vlna 22 (22i): přijetí příkazu má vlastní kód (dřív msg.note)
    expect(rep.entries.filter((e) => e.code === "doc.reused")).toHaveLength(3);
    // jedna převzatá záložka = obyčejný řádek s názvem dokumentu
    const one = new MemoryWorkspace();
    await runScript(one, 'nový díl "Deska"\nkvádr 1 1 1', hostOf());
    expect(finalizeReport(await cliRun(one, 'nový díl "Deska"\nkvádr 2 2 2', hostOf())).protocol).toMatch(/\nℹ L1 doc\.reused "Deska": záložka „Deska“ z dřívějšího běhu použita znovu/);
    const w2 = new MemoryWorkspace();
    await w2.openInTab({ ...emptyDoc("U"), features: box("u1") });
    const s2 = finalizeReport(await cliRun(w2, 'nový díl "U"\nkvádr 1 1 1', hostOf())).protocol;
    expect(s2).toMatch(/\nℹ L1 doc\.name-taken "U": /);
    expect(s2).toMatch(/ name-taken=1 /);
    // první běh: žádné převzetí – protokol beze změny proti dřívějšku (bez ℹ, bez reused=)
    const s3 = finalizeReport(await cliRun(new MemoryWorkspace(), THREE, hostOf())).protocol;
    expect(s3).not.toMatch(/ℹ|reused=|name-taken=/);
  });

  it("mnoho převzatých záložek (nástroj se 30 díly): jeden řádek ℹ ×30 se do 2 kB vejde vedle ostatních řádků, Σ reused=30", async () => {
    const script = Array.from({ length: 30 }, (_, i) => `nový díl "900-01-00-${String(i + 1).padStart(2, "0")} Deska nástroje"\nkvádr 10 10 ${i + 1}`).join("\n");
    const ws = new MemoryWorkspace();
    await runScript(ws, script, hostOf());
    const rep = await cliRun(ws, script, hostOf());
    const p = shortProtocol(rep);
    expect(p.bytes).toBeLessThanOrEqual(2048);
    const line = p.text.split("\n").find((l) => l.includes("doc.reused"))!;
    expect(line).toMatch(/^ℹ L1-L59 ×30 doc\.reused záložky z dřívějšího běhu použité znovu – obsah nahrazen \(volba „nový“ = nová záložka\): „900-01-00-01 Deska nástroje“, .*…$/);
    expect(GRAMMAR.msg.test(line)).toBe(true);
    expect(p.text).toMatch(/ reused=30 /);
    expect(mergeTakeovers(rep.entries).filter((e) => e.code === "doc.reused")).toEqual([expect.objectContaining({ line: 1, count: 30, level: "note" })]);
  });
});

describe("recenze (nález 7): volby window.mncad.run se kontrolují, nikdy tiše", () => {
  it("název protokolu místo objektu; překlep, budget mimo rozsah / ne-číslo, notes ne-boolean a volby bez účinku = chyba", () => {
    expect(checkRunOptions(undefined)).toEqual({});
    expect(checkRunOptions("short")).toEqual({ protocol: "short" });
    expect(checkRunOptions({ protocol: "short", budget: 512, notes: true })).toEqual({ protocol: "short", budget: 512, notes: true });
    expect(checkRunOptions({ protocol: "json", budget: 1048576 })).toEqual({ protocol: "json", budget: 1048576 });
    expect(checkRunOptions({ protocol: "full", notes: false })).toEqual({ protocol: "full", notes: false });
    expect(() => checkRunOptions("brief")).toThrow(/neznámý protokol „brief“/);
    expect(() => checkRunOptions({ protocoll: "short" })).toThrow(/neznámá volba „protocoll“ – protocol, budget, notes/);
    for (const b of [-5, 0, 1048577, 2.5, "abc", NaN, null]) expect(() => checkRunOptions({ protocol: "short", budget: b }), String(b)).toThrow(/budget musí být celé číslo 1–1048576/);
    expect(() => checkRunOptions({ budget: 500 })).toThrow(/budget platí jen pro protokol short/);
    expect(() => checkRunOptions({ protocol: "full", budget: 500 })).toThrow(/budget platí jen pro protokol short/);
    expect(() => checkRunOptions({ protocol: "short", notes: "ano" })).toThrow(/notes musí být true nebo false/);
    expect(() => checkRunOptions({ notes: true })).toThrow(/notes platí jen pro protokol short, full a json/);
    expect(() => checkRunOptions(["short"])).toThrow(/volby musí být objekt/);
    expect(() => checkRunOptions(5)).toThrow(/volby musí být objekt/);
  });
});

describe("se skutečným jádrem: řádky D všech dokumentů běhu, objemy po opakování, prohlížeč = CLI", async () => {
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const strip = (s: string) => s.replace(/ t=[\d.]+/g, "").replace(/ slow=\S+/g, "").replace(/ mem=\d+MB/g, "");

  it("díl + sestava: řádek D dílu má feat/V/m/bbox (dřív `V=- bbox=-`)", async () => {
    const r = await cliRun(new MemoryWorkspace(), 'nový díl Deska\nkvádr 100 50 10\nnová sestava S\nvložit "Deska" v 0 0 0\n', hostOf(kernel));
    expect(r.docs.map(docLine)).toEqual(['D "Deska" part feat=1/0/0 V=50cm3 m=0.392kg bbox=100x50x10 solids=1 valid=1', 'D "S" asm comp=1 parts=1 V.sum=50cm3 m=0.39kg bbox=100x50x10']);
  }, 240_000);

  it("3 dokumenty dvakrát (CLI --resume): stejné řádky D a objemy", async () => {
    const ws = new MemoryWorkspace();
    const r1 = await cliRun(ws, THREE, hostOf(kernel));
    const r2 = await cliRun(loadWorkspace(ws.save()), THREE, hostOf(kernel), { resume: true });
    const lines = r1.docs.map(docLine);
    expect(lines[0]).toBe('D "Deska" part feat=1/0/0 V=50cm3 m=0.392kg bbox=100x50x10 solids=1 valid=1');
    expect(lines[1]).toMatch(/^D "Čep" part feat=1\/0\/0 V=0\.59cm3 m=0\.005kg bbox=5x5x30 solids=1 valid=1$/);
    expect(lines[2]).toBe('D "S" asm comp=2 parts=2 V.sum=50.59cm3 m=0.4kg bbox=100x50x40');
    expect(r2.docs.map(docLine)).toEqual(r1.docs.map(docLine));
  }, 240_000);

  it("recenze (nález 4): soubory skriptu (export step, výkres export pdf) = řádky F a Σ files= v prohlížeči jako v CLI", async () => {
    const cliFiles = async (script: string) => {
      const sink = memoryFileSink();
      const h: EngineHost = { ...hostOf(kernel), files: sink };
      const rb = new ReportBuilder({ lang: "cs", lines: scriptLines(script), strict: false });
      const ws = new MemoryWorkspace();
      await engineRun(ws, script, h, rb, { strict: false, open: [] }, noHooks);
      const fin = await finishRun(ws, h, rb, { formats: "none", allDocs: false, noOutputOnError: false, share: false, strict: false }, noHooks);
      const files = [...sink.files.values()].map((x) => x.file);
      if (rb.count("error") > 0) for (const f of files) f.run = "fail";
      return finalizeReport(rb.finish({ docs: fin.docs, files })).protocol;
    };
    for (const script of ['nový díl "E"\nkvádr 10 10 10\nexport step', 'nový díl "E2"\nkvádr 10 10 10\nvýkres A4 pohledy přední\nkótovat\nvýkres export pdf', 'nový díl "E3"\nkvádr 10 10 10\nexport step\nblbost']) {
      const cli = await cliFiles(script);
      const web = formatRun(await runReport(new MemoryWorkspace(), script, hostOf(kernel)), { protocol: "short" });
      expect(strip(web), script).toBe(strip(cli));
      expect(web).toMatch(/\nF (step|pdf) "E\d?(_vykres)?\.(step|pdf)" \d+B/);
      expect(web).toMatch(/ files=1 /);
    }
    const w = formatRun(await runReport(new MemoryWorkspace(), 'nový díl "E"\nkvádr 10 10 10\nexport step', hostOf(kernel)), { protocol: "short" });
    // řádek F nese revizi modelu, ze které soubor vznikl (vlna 22, A3 – bod 12/22h); stejná v prohlížeči i v CLI (fáze 2)
    expect(w).toMatch(/\nF step "E\.step" \d+B check=ok rev=r·[0-9a-f]{6}\n/);
    const j = JSON.parse(formatRun(await runReport(new MemoryWorkspace(), 'nový díl "E"\nkvádr 10 10 10\nexport step', hostOf(kernel)), { protocol: "json" })) as RunReport;
    expect(j.files[0]).toMatchObject({ name: "E.step", format: "step", check: { ok: true }, modelRev: expect.stringMatching(/^r·[0-9a-f]{6}$/) });
    expect(j.files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  }, 480_000);

  it("recenze (nález 8): vedlejší dokument běhu jen se skicou není ✗ build.failed (běh OK jako dřív); hlavní dokument bez tělesa ano", async () => {
    const r = await cliRun(new MemoryWorkspace(), 'nový díl "Profil"\nskica XY\nobdélník 40 20\nnový díl "Pevný"\nkvádr 10 10 10\n', hostOf(kernel));
    expect(codes(r, "build.failed")).toEqual([]);
    expect(r.counts.errors).toBe(0);
    expect(finalizeReport(r).protocol).toMatch(/^MNCAD\/1 OK /);
    // vlna 22 (úrovně stavu): díl s tělesem nese solids= valid=, díl bez tělesa ne
    expect(r.docs.map(docLine)).toEqual(['D "Profil" part feat=1/0/0 V=- bbox=-', 'D "Pevný" part feat=1/0/0 V=1cm3 m=0.008kg bbox=10x10x10 solids=1 valid=1']);
    const main = await cliRun(new MemoryWorkspace(), 'nový díl "Profil"\nskica XY\nobdélník 40 20\n', hostOf(kernel));
    expect(codes(main, "build.failed").map((e) => e.doc)).toEqual(["Profil"]);
  }, 240_000);

  it("stručný protokol enginu (prohlížeč) = CLI `--formats none` kromě t= / slow= / mem=", async () => {
    for (const script of [THREE, `${THREE}\nkolize\nstav`, "nový díl A\nkvádr 10 10 10\nzaoblit 50 hrany svislé\nnový díl B\nválec 5 10", 'nová sestava "E"']) {
      const cli = finalizeReport(await cliRun(new MemoryWorkspace(), script, hostOf(kernel))).protocol;
      const web = formatRun(await runReport(new MemoryWorkspace(), script, hostOf(kernel)), { protocol: "short" });
      expect(strip(web), script).toBe(strip(cli));
    }
  }, 480_000);
});
