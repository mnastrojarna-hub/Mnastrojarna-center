/**
 * Vlna 22, kolo 7b, bod 13 („Video jen v aplikaci“ – CAD-M1-OPRAVY.md „Co zbývá“): `pohyb export webm | png` v CLI
 * (`mncad run`, engine bez aplikace) dřív dal ✗ host.app-only („export snímků pohybu WEBM“) a nic neuložil. Teď snímky
 * vykreslí softwarový vykreslovač (stejný jako náhled bez WebGL) se stejným časovým plánem jako aplikace: WebM = APNG se
 * stejným časováním a ⚠ motion.video-format (kodér WebM je jen v prohlížeči), PNG = ZIP se snímky a casovani.txt.
 * Na 7d72099 testy padají (soubor nevznikne, v protokolu ✗ host.app-only).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readApng } from "../apng";
import { readZip } from "../formats/zip";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import { decodePng } from "../title-logo";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../engine/host";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { formatConsole } from "../engine/protocol";
import { runScript } from "../engine/run";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");

// deska A stojí, přidržovač B jede z 57,5 na 27,15 mm za 0,5 s (10 kroků) – video 1× = 15 snímků při 30 fps
const STUDY = [
  'nový díl "Deska A"',
  "kvádr 200 100 10",
  'nový díl "Přidržovač"',
  "kvádr 200 100 10",
  'nová sestava "Studie V"',
  'vložit "Deska A" ukotvit',
  'vložit "Přidržovač" v 0 0 67,5',
  'sestava komponenta "Přidržovač" barva #4678c8',
  'sestava vazba vzdálenost "Přidržovač" spodní "Deska A" horní hodnota 57,5 název "ZDVIH"',
  'sestava vazba rovnoběžně "Přidržovač" +X "Deska A" +X',
  'sestava vazba rovnoběžně "Přidržovač" +Y "Deska A" +Y',
  'pohyb motor lineární vazba "ZDVIH" 57,5..27,15 kroky 10 čas 0,5',
  "pohyb spustit",
].join("\n");

/** těžiště modrých pixelů (přidržovač #4678c8 a jeho odstíny) ve snímku */
function blueCentroid(r: { w: number; h: number; rgba: Uint8Array }) {
  let n = 0, sy = 0;
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const o = (y * r.w + x) * 4;
      const R = r.rgba[o], G = r.rgba[o + 1], B = r.rgba[o + 2];
      if (B > R + 40 && B > G + 10) {
        n++;
        sy += y;
      }
    }
  return { n, y: n ? sy / n : -1 };
}

describe("bod 13: video a snímky pohybové studie v CLI (bez prohlížeče)", async () => {
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const hostOf = (): EngineHost & { files: ReturnType<typeof memoryFileSink> } => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });

  it("pohyb export webm: APNG se stejným časováním jako plán (15 snímků, 0,5 s), ⚠ motion.video-format, ne ✗ host.app-only", async () => {
    const host = hostOf();
    const r = await runScript(new MemoryWorkspace(), `${STUDY}\npohyb export webm`, host);
    const codes = r.entries.map((e) => e.code);
    expect(codes).not.toContain("host.app-only");
    expect(codes).toContain("motion.video-format");
    const f = host.files.files.get("Studie V-pohyb-video.png");
    expect(f?.file).toMatchObject({ format: "apng", doc: "Studie V" });
    const a = readApng(f!.data);
    expect(a.crcOk).toBe(true);
    expect(a.frames).toBe(15);
    expect(a.seconds).toBeCloseTo(0.5, 6);
    const text = formatConsole(r);
    expect(text).toMatch(/APNG/);
    expect(text).toMatch(/obraz se mění ve všech 14 snímcích s pohybem/);
    expect(text).toMatch(/anotace polohy jen v aplikaci/); // honest: text v obraze CLI nekreslí
  }, 240_000);

  it("pohyb export png: ZIP se snímky snimek-NNNN.png a casovani.txt; přidržovač se ve snímcích pohne dolů", async () => {
    const host = hostOf();
    const r = await runScript(new MemoryWorkspace(), `${STUDY}\npohyb export png rychlost 1`, host);
    expect(r.entries.map((e) => e.code)).not.toContain("host.app-only");
    const f = host.files.files.get("Studie V-pohyb-snimky.zip");
    expect(f?.file).toMatchObject({ format: "zip" });
    const zip = readZip(f!.data);
    const names = zip.map((e) => e.name);
    expect(names.filter((n) => /^snimek-\d{4}\.png$/.test(n))).toHaveLength(15);
    expect(names).toContain("casovani.txt");
    const png = async (n: string) => decodePng(await zip.find((e) => e.name === n)!.read());
    const first = blueCentroid(await png("snimek-0000.png"));
    const last = blueCentroid(await png("snimek-0014.png"));
    expect(first.n).toBeGreaterThan(500);
    expect(last.n).toBeGreaterThan(500);
    expect(last.y).toBeGreaterThan(first.y + 5); // izometrie: přidržovač sjede dolů (y obrazu roste)
    expect(formatConsole(r)).toMatch(/^✓ Snímky PNG \(15\) s časovým plánem uloženy \(ZIP\)/m);
  }, 240_000);

  it("pohled studie s řezem: snímky kreslí řez (čela komponent) – jiný obraz než bez řezu", async () => {
    const host = hostOf();
    await runScript(new MemoryWorkspace(), `${STUDY}\npohyb pohled uložit "Řez Y" řez Y 50 kamera přední\npohyb pohled "Řez Y"\npohyb export png rychlost 1`, host);
    const host2 = hostOf();
    await runScript(new MemoryWorkspace(), `${STUDY}\npohyb pohled uložit "Zepředu" kamera přední\npohyb pohled "Zepředu"\npohyb export png rychlost 1`, host2);
    const zA = readZip(host.files.files.get("Studie V-pohyb-snimky.zip")!.data);
    const zB = readZip(host2.files.files.get("Studie V-pohyb-snimky.zip")!.data);
    const a = await decodePng(await zA.find((e) => e.name === "snimek-0000.png")!.read());
    const b = await decodePng(await zB.find((e) => e.name === "snimek-0000.png")!.read());
    let diff = 0;
    for (let i = 0; i < a.rgba.length; i += 4) if (Math.abs(a.rgba[i] - b.rgba[i]) + Math.abs(a.rgba[i + 2] - b.rgba[i + 2]) > 30) diff++;
    expect(diff).toBeGreaterThan(1000);
  }, 240_000);
});
