/**
 * Kola a ozubení textem přes engine se skutečným jádrem (stejná cesta jako konzole i CLI `mncad run`): `kolo …` postaví
 * těleso, `kolo tabulka` vypíše tabulku ozubení bez UI, `soukolí …` založí díly a sestavu s vazbou, výkres s tabulkou
 * ozubení (SVG / DXF), `stav` a dokument → skript tam a zpět (stejný objem).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { docToScript } from "./doc-script";
import { setHostAssets } from "./host-assets";
import { makeKernelClient } from "./kernel-client";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./engine/host";
import { MemoryWorkspace } from "./engine/memory-workspace";
import { formatConsole } from "./engine/protocol";
import { runScript } from "./engine/run";

const WASM = path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../public/fonts");

describe("kola a ozubení přes engine (jádro v procesu)", async () => {
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("./kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const hostOf = (): EngineHost & { files: ReturnType<typeof memoryFileSink> } => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
  const text = (host: ReturnType<typeof hostOf>, name: string) => new TextDecoder().decode(host.files.files.get(name)!.data);

  it("kolo čelní + kolo tabulka + stav + výkres s tabulkou ozubení (SVG, DXF)", async () => {
    const host = hostOf();
    const ws = new MemoryWorkspace();
    const t0 = Date.now();
    const r = await runScript(ws, "nový díl Kolo\nkolo čelní m 2 z 24 b 20 díra 20 pero\nkolo tabulka\nstav\nvýkres A3 tabulka ozubení ano\nvýkres stav\nvýkres export svg\nvýkres export dxf", host);
    const ms = Date.now() - t0;
    const out = formatConsole(r);
    expect(r.counts.errors, out).toBe(0);
    expect(out).toMatch(/Tabulka ozubení – Ozubené kolo m2 z24 \(Čelní kolo s přímými zuby\)/);
    expect(out).toMatch(/Rozměr přes zuby W3\s+= 15,433 mm/);
    expect(out).toMatch(/Rozměr přes kuličky M_dK\s+= 52,951 mm/);
    expect(out).toMatch(/čelní m2 z24 x0 b20 · d 48 · dₐ 52 · W3 15,433 · díra 20 pero · kolo/);
    expect(out).toMatch(/Tabulka ozubení: Ozubené kolo m2 z24 – mₙ 2 mm, z 24/);
    const files = [...host.files.files.keys()];
    const svg = text(host, files.find((f) => f.endsWith(".svg"))!);
    expect(svg).toContain("Tabulka ozubení – Ozubené kolo m2 z24");
    expect(svg).toContain("15,433 mm");
    expect(svg).toContain("52,951 mm");
    const dxf = text(host, files.find((f) => f.endsWith(".dxf"))!);
    expect(dxf).toContain("15,433 mm");
    // výkon: celý běh (stavba kola, výkres, dva exporty) – volná mez
    expect(ms).toBeLessThan(60_000);
    console.info(`[w19-text] kolo + tabulka + výkres + 2 exporty: ${ms} ms`);
  }, 240_000);

  it("kolo tabulka bez kola = ✗ s důvodem; s názvem / vše; EN a DE příkazy", async () => {
    const ws = new MemoryWorkspace();
    const r1 = await runScript(ws, "nový díl Prázdný\nkvádr 10 10 10\nkolo tabulka", hostOf());
    expect(formatConsole(r1)).toMatch(/✗.*není žádné kolo/);
    const ws2 = new MemoryWorkspace();
    const r2 = await runScript(ws2, 'nový díl Dvě\ngear spur m 1 z 30 b 5\nrad kettenrad 08B z 15 bei 80 0 0\nkolo tabulka "Ozubené kolo m1 z30"\ngear table all', hostOf());
    const out = formatConsole(r2);
    expect(r2.counts.errors, out).toBe(0);
    expect(out.match(/Tabulka ozubení – /g)?.length).toBe(3);
    expect(out).toMatch(/Řetěz ISO 606\s+= 08B/);
  }, 240_000);

  it("soukolí čelní m 2 z1 20 z2 60 a 81 → dva díly, sestava se 2 komponentami a vazbou ozubení (splněná)", async () => {
    const ws = new MemoryWorkspace();
    const t0 = Date.now();
    const r = await runScript(ws, "soukolí čelní m 2 z1 20 z2 60 a 81\nstav", hostOf());
    const ms = Date.now() - t0;
    const out = formatConsole(r);
    expect(r.counts.errors, out).toBe(0);
    expect(out).toMatch(/Soukolí „Soukolí m2 z20\/z60“/);
    expect(out).toMatch(/Vazby: 1 \(1 ok\)/);
    const asm = ws.present();
    expect(asm.kind).toBe("assembly");
    expect(asm.components).toHaveLength(2);
    expect(asm.mates?.[0]?.type).toBe("gear");
    console.info(`[w19-text] soukolí + stav: ${ms} ms`);
  }, 240_000);

  it("dokument → skript → engine: kola `kolo …` dají stejný objem", async () => {
    const ws = new MemoryWorkspace();
    await runScript(ws, "nový díl Kola\nkolo šikmé m 1,5 z 30 b 12 beta 15 levé díra 10\nkolo řetězové 08B z 17 v 70 0 0", hostOf());
    const doc = ws.present();
    const sc = docToScript(doc);
    expect(sc.stats.byType.ext, sc.text).toEqual({ dedicated: 2, generic: 0, json: 0 });
    const ws2 = new MemoryWorkspace();
    const r = await runScript(ws2, sc.text, hostOf());
    expect(r.counts.errors, formatConsole(r)).toBe(0);
    const a = await kernel.build(doc);
    const b = await kernel.build(ws2.present());
    expect(b.metrics!.volume).toBeCloseTo(a.metrics!.volume, 3);
    expect(ws2.present().features.map((f) => f.name)).toEqual(doc.features.map((f) => f.name));
  }, 240_000);

  it("příklady z návodu pro AI (kapitola Kola a ozubení) se provedou bez ✗ – včetně pohybové studie soukolí", async () => {
    const { AGENT_GUIDE } = await import("./agent-guide");
    const at = AGENT_GUIDE.indexOf("### Kola a ozubení");
    const chapter = AGENT_GUIDE.slice(at, AGENT_GUIDE.indexOf("\n### ", at + 10));
    const blocks = [...chapter.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]);
    const outs: string[] = [];
    for (const b of blocks) {
      const host = hostOf();
      const t0 = Date.now();
      const r = await runScript(new MemoryWorkspace(), b, host);
      const out = formatConsole(r);
      expect(r.counts.errors, `${b}\n---\n${out}`).toBe(0);
      outs.push(out);
      console.info(`[w19-text] příklad ${outs.length}: ${Date.now() - t0} ms, souborů ${host.files.files.size}`);
    }
    expect(outs[0]).toMatch(/Rozměr přes zuby W3\s+= 15,433 mm/);
    expect(outs[0]).toMatch(/Tabulka ozubení: Kolo z24|Tabulka ozubení: Ozubené kolo m2 z24/);
    expect(outs[1]).toMatch(/x₁ 0,3668|x1 0,3668|0,3668/);
    expect(outs[2]).toMatch(/Řetěz ISO 606\s+= 08B-2/);
  }, 480_000);

  it("tabulka ozubení, která se na list nevejde vedle pohledů, = ⚠ s pohledy (A4, měřítko 1:1, velké kolo)", async () => {
    const r = await runScript(new MemoryWorkspace(), "nový díl Velké\nkolo čelní m 3 z 50 b 30\nvýkres A4 měřítko 1:1 tabulka ozubení ano\nvýkres stav", hostOf());
    const out = formatConsole(r);
    expect(out).toMatch(/Tabulka ozubení překrývá pohled|nevejdou na list/);
    expect(out).toMatch(/Tabulka ozubení: Ozubené kolo m3 z50 – mₙ 3 mm, z 50/);
  }, 240_000);
});

