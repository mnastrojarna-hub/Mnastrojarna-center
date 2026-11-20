/**
 * Engine bez Reactu (balík B2): smlouva smyčky `runScript` nad `MemoryWorkspace` s falešným jádrem – dokumenty běhu
 * nikdy nepřepíší záložku, jeden nový dokument = jedna záložka, příkazy aplikace bez okna (ℹ ui.no-view / ✗ host.app-only),
 * `otevřít` přes FileSource, protokol konzole vs. JSON, generace jádra a nové postavení dílu pro plochy vazeb.
 * Parita se skutečným jádrem: parity.test.ts.
 */
import { describe, expect, it } from "vitest";
import { parseOpenLine } from "../agent-open";
import type { BuildResult, CadDoc, ComponentSource } from "../types";
import { emptyDoc } from "../types";
import { checkKernelGeneration, makeAsmEnv } from "./asm-env";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./host";
import type { KernelApi } from "./kernel";
import { MemoryWorkspace } from "./memory-workspace";
import { presentStatusText } from "./asm-status";
import { finalizeReport, formatConsole, formatFull, formatShort, GRAMMAR } from "./protocol";
import type { RunReport } from "./protocol-types";
import { runScript } from "./run";

const result = (d: CadDoc): BuildResult =>
  ({ status: d.features.map((f) => ({ id: f.id, ok: true })), mesh: null, metrics: d.features.length ? { volume: 1000, area: 600, bbox: [[0, 0, 0], [10, 10, 10]], faces: 6, edges: 12, valid: true, solids: 1 } : null, ms: 1 }) as unknown as BuildResult;

function fakeKernel(over: Partial<Record<string, unknown>> = {}) {
  const calls: string[] = [];
  const k = {
    generation: () => 1,
    build: async (d: CadDoc) => (calls.push(`build:${d.name}`), result(d)),
    asmParts: async (parts: { key: string; source: ComponentSource }[]) => (calls.push(`asmParts:${parts.length}`), parts.map((p) => ({ key: p.key, result: result(p.source.kind === "part" ? p.source.doc : emptyDoc()) }))),
    stepSplit: async () => null,
    ...over,
  };
  return { kernel: k as unknown as KernelApi, calls };
}
const hostOf = (kernel: KernelApi, files: Record<string, Uint8Array> = {}): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource(files), now: () => Date.now() });
const titles = (ws: MemoryWorkspace) => ws.tabs().map((t) => t.title);

describe("runScript – dokumenty běhu a záložky", () => {
  it("dokument vytvořený během nikdy nepřepíše záložku (prázdná sestava zůstane, 5.2 č. 14)", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, "nová sestava S\nnový díl A\nkvádr 1 1 1\nnový díl B\nkvádr 2 2 2", hostOf(fakeKernel().kernel));
    expect(titles(ws)).toEqual(["S", "A", "B"]);
    expect(r.counts.errors).toBe(0);
    expect(ws.findPart("a")?.features).toHaveLength(1);
  });
  it("nový dokument dostane jednu záložku i po zápisu uprostřed běhu (výkres) a dalších změnách", async () => {
    const ws = new MemoryWorkspace();
    await runScript(ws, "nový díl X\nkvádr 1 1 1\nvýkres\nválec 2 2", hostOf(fakeKernel().kernel));
    expect(titles(ws)).toEqual(["X"]);
    expect(ws.present().features.map((f) => f.type)).toEqual(["box", "cylinder"]);
    expect(ws.history().undo).toBe(2); // úvodní prázdný díl → X (výkres) → X s válcem
  });
  it("vložit: díl z běhu i ze záložky; neznámý díl = ✗ op.failed se seznamem dílů", async () => {
    const ws = new MemoryWorkspace();
    const host = hostOf(fakeKernel().kernel);
    await runScript(ws, "nový díl Deska\nkvádr 10 10 2", host);
    const r = await runScript(ws, 'nový díl Čep\nválec 2 5\nnová sestava S\nvložit "Deska" ukotvit\nvložit "Čep"\nvložit "Nic"', host);
    expect(ws.present().components?.map((c) => c.name)).toEqual(["Deska", "Čep"]);
    const e = r.entries.find((x) => x.code === "op.failed")!;
    expect(e).toMatchObject({ line: 6, level: "error", doc: "S" });
    expect(e.text).toMatch(/„Nic“ není mezi otevřenými záložkami – otevřené díly: Čep, Deska/);
  });
});

describe("runScript – protokol konzole a záznamy s kódem", () => {
  it("text konzole jako dřív (řádky podle řádků skriptu, výsledky po stavbě, stav) a JSON bez textu konzole", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, "nový díl P\nblbost\nkvádr 10 10 10", hostOf(fakeKernel().kernel));
    const text = formatConsole(r);
    const rows = text.split("\n");
    expect(rows[0]).toBe("✓ nový díl „P“ – nová záložka");
    expect(rows[1]).toMatch(/^✗ řádek 2: neznámý příkaz „blbost“ – příkazy: nový díl, /);
    expect(rows.slice(2, 5)).toEqual(["→ Kvádr 1 (box) přidán – výsledek po výpočtu níže", "✓ Kvádr 1 (box)", ""]);
    expect(text).toMatch(/^Dokument: „P“ · díl/m);
    expect(r.entries.map((e) => `${e.line} ${e.level} ${e.code ?? ""}`)).toEqual(["2 error parse.error", "1 ok ", "3 note op.accepted", "3 ok "]);
    expect(r.timing.map((t) => t.op).sort()).toEqual(["feature", "new"]);
    expect(finalizeReport(r).console).toBeUndefined();
    expect(JSON.parse(JSON.stringify(finalizeReport(r)))).not.toHaveProperty("console");
  });
  it("bez aplikace: pohled / zobrazení / výkres = ℹ ui.no-view, analýzy = ✗ host.app-only; uložit = soubor přes FileSink (B3)", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, "nový díl V\nkvádr 4 4 4\nzobraz iso\nřez X 1\nuložit\nanalýza tloušťky\nvýkres", hostOf(fakeKernel().kernel));
    expect(r.entries.filter((e) => e.code === "ui.no-view" || e.code === "host.app-only").map((e) => `${e.line} ${e.code}`)).toEqual(["3 ui.no-view", "4 ui.no-view", "6 host.app-only", "7 ui.no-view"]);
    expect(formatConsole(r)).toMatch(/^ℹ řádek 3: bez 3D okna nemá příkaz účinek: pohled iso$/m);
    expect(formatConsole(r)).toMatch(/^✓ uloženo: V\.mncad · \d+ B · projekt Mnástrojárna CAD \(\.mncad\) – staženo \(bez dialogu\)$/m);
  });
  it("„stav“ jako poslední příkaz = vyžádaný výpis = (status) se závěrečným stavem", async () => {
    const r = await runScript(new MemoryWorkspace(), "nový díl S\nkvádr 1 1 1\nstav", hostOf(fakeKernel().kernel));
    const st = r.entries.find((e) => e.level === "measure" && e.code === "status")!;
    expect(st.line).toBe(3);
    // strojová část (kap. 4.2) v textu, lokalizovaný stav v `detail`
    expect(st.text).toBe("part feat=1/0/0 V=1cm3 m=0.008kg bbox=10x10x10 solids=1 valid=1");
    expect(st.detail).toMatch(/^Dokument: „S“/);
    expect(formatShort(r)).toMatch(/^= L3 status "S" part feat=1\/0\/0 V=1cm3 m=0\.008kg bbox=10x10x10 solids=1 valid=1$/m);
    expect(formatFull(r)).toMatch(/^= L3 status "S" part feat=.*\n {2}Dokument: „S“ · díl/m);
  });
  it("výpis bez strojových údajů: první řádek `lines=<n>`, řádky výpisu jako pokračovací řádky (kap. 4.2)", async () => {
    const ws = new MemoryWorkspace();
    await runScript(ws, "nový díl A\nkvádr 1 1 1", hostOf(fakeKernel().kernel));
    const r = await runScript(ws, "kvádr 2 2 2\nzáložky", hostOf(fakeKernel().kernel));
    const short = formatShort(r);
    expect(short).toMatch(/^= L2 asm "A" lines=2\n {2}Záložky \(1\):\n {2}1\. A · díl · aktivní$/m);
    for (const l of short.split("\n")) expect(Object.values(GRAMMAR).some((re) => re.test(l)), l).toBe(true);
  });
});

/** falešné jádro sestavy: díly postaví, kolize jen v sestavě „A“ (první dvě komponenty) */
function asmKernel(gen = { n: 1 }) {
  return fakeKernel({
    generation: () => gen.n,
    interference: async (d: CadDoc) => (d.name === "A" ? [{ a: d.components![0].id, b: d.components![1].id, volume: 16000 }] : []),
    // zařazení dvojic (vlna 22, bod 5): skutečná kolize – stav vypíše instance „Blok #1 × Blok #2“ a třídy `clash=1(thread=0,real=1)`
    clashDetail: async (_d: CadDoc, pairs: { a: string; b: string; volume: number }[]) => pairs.map((p) => ({ ...p, cls: "real", why: "no-thread" })),
  }).kernel;
}
const ASM2 = 'nový díl Blok\nkvádr 40 40 40\nnová sestava A\nvložit "Blok" ukotvit\nvložit "Blok" v 30 0 0\nnová sestava B\nvložit "Blok" ukotvit\nvložit "Blok" v 100 0 0';
const clashLine = (r: RunReport) => /^Kolize: .*$/m.exec(formatConsole(r))?.[0];

describe("stav vazeb a kolizí podle dokumentu (klíč = id dokumentu záložky)", () => {
  it("kolize sestavy A se nepřenese do stavu sestavy B; přejmenování stav nezahodí", async () => {
    const ws = new MemoryWorkspace();
    const host = hostOf(asmKernel());
    await runScript(ws, ASM2, host);
    expect(clashLine(await runScript(ws, 'záložka "A"\nkolize', host))).toMatch(/^Kolize: 1 – skutečné 1: Blok #1 × Blok #2 \(16.000,0 mm³\)/);
    expect(clashLine(await runScript(ws, 'záložka "B"\nstav', host))).toMatch(/^Kolize: nezkontrolováno/);
    expect(clashLine(await runScript(ws, 'záložka "A"\nnázev "Přejmenováno"\nstav', host))).toMatch(/^Kolize: 1 – skutečné 1: Blok #1 × Blok #2/);
    // klíč je id dokumentu záložky, ne název: sestava téhož názvu v jiné záložce stav nepřebírá
    const r = await runScript(ws, "nová sestava Přejmenováno\nstav", host);
    expect(clashLine(r)).toMatch(/^Kolize: nezkontrolováno/);
  });
  it("sestava vytvořená v témže běhu: stav s objemem Σ a výsledkem kolize i bez dalšího běhu (ensureLeaves)", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, 'nový díl Blok\nkvádr 40 40 40\nnová sestava A\nvložit "Blok" ukotvit\nvložit "Blok" v 30 0 0\nkolize\nstav', hostOf(asmKernel()));
    expect(formatConsole(r)).toMatch(/^Sestava: 2 komponent \(2 dílů po rozložení podsestav\) · obálka 40 × 10 × 10 mm · objem Σ 2 cm³ · hmotnost Σ 0,016 kg$/m);
    expect(clashLine(r)).toMatch(/^Kolize: 1 – skutečné 1: Blok #1 × Blok #2/);
    expect(r.entries.find((e) => e.code === "status")!.text).toBe("asm comp=2 parts=1 V.sum=2cm3 m=0.02kg bbox=40x10x10 clash=1(thread=0,real=1)");
  });
  it("window.mncad.status() = `stav` (presentStatusText: díly postavené, kolize pod klíčem aktivní záložky)", async () => {
    const ws = new MemoryWorkspace();
    const host = hostOf(asmKernel());
    await runScript(ws, ASM2.replace("nová sestava B", "kolize\nnová sestava B"), host);
    const stav = (await runScript(ws, "stav", host)).entries.find((e) => e.code === "status")!.detail!;
    expect(await presentStatusText(ws, host.kernel)).toBe(stav);
    await ws.activate(ws.tabs().find((t) => t.title === "A")!.id);
    expect(await presentStatusText(ws, host.kernel)).toMatch(/^Kolize: 1 – skutečné 1: Blok #1 × Blok #2/m);
  });
  it("restart jádra mezi běhy: stav, kolize i výkres vypíší ℹ asm.kernel-restarted (mezipaměti vyprázdněné a znovu postavené)", async () => {
    const gen = { n: 1 };
    const ws = new MemoryWorkspace();
    const host = hostOf(asmKernel(gen));
    await runScript(ws, ASM2, host);
    expect(ws.asm.cache.size).toBe(1);
    const restarted = (r: RunReport) => r.entries.filter((e) => e.code === "asm.kernel-restarted").map((e) => e.line);
    gen.n = 2;
    const st = await runScript(ws, "stav", host);
    expect(restarted(st)).toEqual([1]);
    expect(formatConsole(st)).toMatch(/^ℹ řádek 1: jádro se restartovalo – mezipaměti sestavy vyprázdněny$/m);
    expect(ws.asm.cache.size).toBe(1); // znovu postaveno
    gen.n = 3;
    expect(restarted(await runScript(ws, "kolize", host))).toEqual([1]);
    gen.n = 4;
    expect(restarted(await runScript(ws, "výkres A4 pohledy přední", host))).toEqual([1]);
    gen.n = 5;
    const end = await runScript(ws, "název B", host); // jen závěrečný stav: ℹ bez řádku (L-)
    expect(restarted(end)).toEqual([null]);
  });
});

describe("otevřít \"soubor\" (FileSource)", () => {
  it("rozbor CS / EN / DE", () => {
    expect(parseOpenLine('otevřít "deska.mncad"')).toBe("deska.mncad");
    expect(parseOpenLine("open plate.step")).toBe("plate.step");
    expect(parseOpenLine("öffnen „Platte 2.mncad“")).toBe("Platte 2.mncad");
    expect(parseOpenLine("kvádr 1 2 3")).toBeNull();
    expect(() => parseOpenLine("otevřít")).toThrow(/chybí název souboru/);
    expect(() => parseOpenLine('open ""')).toThrow(/chybí název souboru/);
  });
  it(".mncad do nové záložky, chybějící soubor = ✗ file.missing, STEP bez hlavičky = ✗ op.failed", async () => {
    const plate: CadDoc = { ...emptyDoc("Deska 1"), features: [{ id: "b", name: "Kvádr 1", type: "box", size: [5, 5, 5], position: [0, 0, 0], centered: false, mode: "new" } as CadDoc["features"][number]] };
    const ws = new MemoryWorkspace();
    const files = { "deska.mncad": new TextEncoder().encode(JSON.stringify(plate)), "x.step": new TextEncoder().encode("nic") };
    const r = await runScript(ws, 'otevřít "deska.mncad"\nzaoblit 1\nopen "chybí.mncad"\notevřít x.step', hostOf(fakeKernel().kernel, files));
    expect(ws.present()).toMatchObject({ name: "Deska 1", features: [{ type: "box" }, { type: "fillet" }] });
    expect(r.entries.filter((e) => e.level === "error").map((e) => `${e.line} ${e.code}`)).toEqual(["3 file.missing", "4 op.failed"]);
    // vlna 22 (22i): otevření dokumentu s prvky je přijetí (→ … výsledek po výpočtu níže), ne ✓ – výsledek dá ověřovací stavba
    expect(formatConsole(r)).toMatch(/^→ otevřeno „deska\.mncad“ – dokument „Deska 1“ v nové záložce – výsledek po výpočtu níže$/m);
    // … a protože řádek 2 dokument hned změnil, stav „po otevření“ se samostatně nestavěl: ℹ op.superseded, žádné ✓ za něj
    expect(r.entries.filter((e) => e.line === 1).map((e) => `${e.level}:${e.code ?? ""}`)).toEqual(["note:op.accepted", "note:op.superseded"]);
    expect(r.entries.some((e) => e.level === "ok" && /postaven/.test(e.text))).toBe(false);
  });
  it("STEP: díl jako prvek Import (data v úložišti blobů), velká sestava se dělí jádrem hostitele (kernel.stepSplit)", async () => {
    const step = "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n#1=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\nEND-ISO-10303-21;\n";
    const { kernel } = fakeKernel();
    const ws = new MemoryWorkspace();
    await runScript(ws, 'otevřít "díl.step"', hostOf(kernel, { "díl.step": new TextEncoder().encode(step) }));
    const f = ws.present().features[0] as { type: string; format: string; data: string; fileName: string };
    expect(ws.present().name).toBe("díl");
    expect(f).toMatchObject({ type: "import", format: "step", fileName: "díl.step" });
    expect(f.data).toMatch(/^mnblob:/);
  });
});

describe("prostředí sestavy nad ws (asm-env.ts)", () => {
  const src: ComponentSource = { kind: "part", doc: { ...emptyDoc("Díl"), features: [{ id: "b", name: "Kvádr 1", type: "box", size: [1, 1, 1], position: [0, 0, 0], centered: false, mode: "new" } as CadDoc["features"][number]] } };
  it("generace jádra: nový prostor jen převezme generaci; po restartu jádra se mezipaměti vyprázdní (ℹ asm.kernel-restarted)", () => {
    const ws = new MemoryWorkspace();
    let gen = 1;
    const k = { generation: () => gen } as KernelApi;
    expect(checkKernelGeneration(ws, k)).toBe(false); // generace 0 → 1, mezipaměti prázdné
    ws.asm.cache.set("k1", result(emptyDoc()));
    ws.asm.geo.set("k1:0", { kind: "plane", origin: [0, 0, 0], normal: [0, 0, 1] });
    expect(checkKernelGeneration(ws, k)).toBe(false);
    gen = 2;
    let restarted = 0;
    makeAsmEnv(ws, k, { onRestart: () => restarted++ });
    expect(restarted).toBe(1);
    expect(ws.asm.cache.size + ws.asm.geo.size).toBe(0);
    expect(ws.asm.generation).toBe(2);
  });
  it("mateFace null u známého dílu → díl se v jádře postaví znovu a dotaz se zopakuje; nejde-li postavit → ✗ asm.face-missing", async () => {
    const ws = new MemoryWorkspace();
    const face = { kind: "plane" as const, origin: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
    let lost = true;
    let builds = 0;
    const { kernel } = fakeKernel({
      mateFace: async () => (lost ? null : face),
      asmParts: async (parts: { key: string; source: ComponentSource }[]) => {
        builds++;
        lost = false;
        return parts.map((p) => ({ key: p.key, result: result(emptyDoc()) }));
      },
    });
    const missing: string[] = [];
    const env = makeAsmEnv(ws, kernel, { onFaceMissing: (m) => missing.push(`${m.name} F${m.index + 1}`) });
    await env.parts([{ key: "k", source: src }]);
    lost = true; // jádro díl vyřadilo (LRU / restart), klientská mezipaměť ho zná
    expect(await env.mateFace("k", 0)).toEqual(face);
    expect(builds).toBe(2);
    expect(missing).toEqual([]);
    const { kernel: k2 } = fakeKernel({ mateFace: async () => null, asmParts: async (parts: { key: string }[]) => parts.map((p) => ({ key: p.key, result: null })) });
    const ws2 = new MemoryWorkspace();
    ws2.asm.cache.set("k", result(emptyDoc()));
    const env2 = makeAsmEnv(ws2, k2, { onFaceMissing: (m) => missing.push(`${m.name} F${m.index + 1}`) });
    await env2.parts([{ key: "k", source: src }]); // klíč známý – jádro se neptá
    expect(await env2.mateFace("k", 2)).toBeNull();
    expect(missing).toEqual(["Díl F3"]);
  });
});

describe("2D výkres textem: soubor příkazu doručí hostitel", () => {
  it("`2d export dxf` zapíše soubor přes FileSink (dřív ✓ bez souboru v CLI i v enginu prohlížeče)", async () => {
    const ws = new MemoryWorkspace();
    const host = hostOf(fakeKernel().kernel);
    const r = await runScript(ws, "2d nový Obrys\n2d čára 0,0 100,0 @0,50\n2d export dxf verze R12", host);
    expect(r.counts.errors).toBe(0);
    const files = [...(host.files as ReturnType<typeof memoryFileSink>).files.values()];
    expect(files.map((f) => f.file.format)).toEqual(["dxf"]);
    expect(files[0].file.doc).toBe("Obrys");
    const text = new TextDecoder().decode(files[0].data);
    expect(text).toMatch(/SECTION/);
    expect(text).toMatch(/LINE/);
  });
  it("výstup DXF / DWG 2D výkresu (`--formats dxf,dwg`) zapíše exportér 2D výkresu, PDF zůstává ✗ host.app-only", async () => {
    const ws = new MemoryWorkspace();
    const host = hostOf(fakeKernel().kernel);
    await runScript(ws, "2d nový Obrys\n2d čára 0,0 100,0 @0,50", host);
    const { writeDocFormat } = await import("./files");
    const notes: string[] = [];
    const d = ws.present();
    const files = [...(await writeDocFormat({ ...host, files: host.files }, ws, d, "dxf", (n) => notes.push(n.code))), ...(await writeDocFormat({ ...host, files: host.files }, ws, d, "dwg", (n) => notes.push(n.code)))];
    expect(files.map((f) => f.name)).toEqual(["Obrys.dxf", "Obrys.dwg"]);
    expect(files.every((f) => f.bytes > 500)).toBe(true);
    expect(await writeDocFormat({ ...host, files: host.files }, ws, d, "pdf", (n) => notes.push(n.code))).toEqual([]);
    expect(notes).toEqual(["host.app-only"]);
  });
});
