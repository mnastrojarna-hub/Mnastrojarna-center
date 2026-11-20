/**
 * Vlna 22, etapa A4 – bod 16 (sdílení textem) a bod 15 (stabilní id, souhrn `sestava pole`) nad skutečným jádrem
 * in-process: engine je tentýž jako v prohlížeči (`window.mncad.run`, konzole) a v CLI (`mncad run`).
 *
 *  1. tři `sdílet` v jednom běhu → tři adresy: tři výpisy `= L<n> link …` (stručný i plný protokol), `shares[]` v JSON se
 *     třemi url, plný protokol tři řádky O; dřív jen poslední (repro/16 out.txt: L10 a L12 chyběly);
 *  2. každý odkaz nese režim, platnost a obsah (`mode=`, `exp=`, `content=… comp=… sheets=… files=…`);
 *  3. `--share-store off` (úložiště vypnuté) → ℹ share.store-off ve STRUČNÉM protokolu, ne tichý dlouhý odkaz; dlouhý odkaz
 *     vede na stránku CADu (`linkPage`), ne na web nedostupného úložiště;
 *  4. `odkaz ověřit` (CS/EN/DE): funkční odkaz → ✓ + `= … ok=1 mode=link …`; useknutý → ✗ share.link-broken `truncated`,
 *     změněný → `corrupt` (odlišené od hesla / platnosti);
 *  5. stabilní id záznamů: dva běhy téhož skriptu → stejná `id` (bez čísla běhu), každé id v běhu jednou;
 *  6. `sestava pole` 19 kopií → jeden řádek se souhrnem (počet, první, poslední), ne 18 poloh (kritik: krok 4 bez testu).
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../engine/host";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { finalizeReport, formatFull, grammarKind } from "../engine/protocol";
import { runReport } from "../engine/run-protocol";
import { forgetLastLink } from "../engine/share-out";
import type { RunReport } from "../engine/protocol-types";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");
const PAGE = "https://www.mnastrojarna.cz/cad";

const PART = `nový díl "Deska A"
kvádr 120 80 10
díra 9 skrz v 20 20
`;

describe("vlna 22 A4: sdílení textem a id záznamů (skutečné jádro)", async () => {
  setLang("cs");
  const fonts = { font: async (name: string) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer };
  // jako CLI `--share-store off` (cli/job.ts installHostAssets): stránka webu CADu, žádné úložiště
  setHostAssets({ ...fonts, share: { page: PAGE, store: null, linkPage: PAGE } });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const host = (): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
  const run = async (text: string, ws = new MemoryWorkspace()): Promise<RunReport> => {
    forgetLastLink();
    return finalizeReport(await runReport(ws, text, host()), { full: true });
  };
  afterAll(() => setHostAssets({}));
  /** A4_OUT=<složka>: protokoly běhů pro ledger (důkaz výstupu) */
  const dump = (name: string, text: string) => {
    const dir = process.env.A4_OUT;
    if (dir) fs.writeFileSync(path.join(dir, name), text);
  };

  it("tři sdílet v jednom běhu → tři adresy (výpisy =, shares[], řádky O plného protokolu); obsah a režim u každého", async () => {
    const r3 = await run(`${PART}sdílet\nsdílet odkazem dní 30\nsdílet model dní 5\n`);
    dump("three-shares.short.txt", r3.protocol);
    dump("three-shares.full.txt", formatFull(r3));
    for (const rep of [r3]) for (const l of rep.protocol.split("\n")) expect(grammarKind(l), l).not.toBeNull();
    expect(r3.shares?.length).toBe(3);
    expect(new Set(r3.shares!.map((s) => s.url)).size).toBe(3);
    expect(r3.share?.url).toBe(r3.shares![2].url); // share = poslední (řádek O, kompatibilita)
    const links = r3.protocol.split("\n").filter((l) => /^= L\d+ link /.test(l));
    expect(links.map((l) => /^= (L\d+)/.exec(l)![1])).toEqual(["L4", "L5", "L6"]);
    for (const l of links) expect(l).toMatch(/ mode=link exp=\d{4}-\d{2}-\d{2} view=model pw=0 bytes=\d+ chars=\d+ content=part comp=0 parts=0 sheets=0 files=0 features=2$/);
    expect(links[1]).toMatch(/exp=(\d{4}-\d{2}-\d{2})/);
    const full = formatFull(r3);
    expect(full.split("\n").filter((l) => l.startsWith("O ")).length).toBe(3);
    for (const s of r3.shares!) {
      expect(full).toContain(s.url);
      expect(s).toMatchObject({ mode: "link", view: "model", password: false, content: { doc: "Deska A", kind: "part", sheets: 0, files: 0 } });
    }
    // JSON: každý výpis = má data s url (i když je text zkrácený)
    const data = r3.entries.filter((e) => e.level === "measure" && e.code === "link").map((e) => (e.data as { url: string }).url);
    expect(data).toEqual(r3.shares!.map((s) => s.url));
  });

  it("--share-store off → ℹ share.store-off ve stručném protokolu; dlouhý odkaz vede na stránku CADu", async () => {
    const r = await run(`${PART}sdílet\n`);
    dump("store-off.short.txt", r.protocol);
    expect(r.protocol).toMatch(/^ℹ L4 share\.store-off "Deska A": úložiště krátkých odkazů je vypnuté – dokument je celý v odkazu \(\d+ znaků\)$/m);
    expect(r.share?.url.startsWith(`${PAGE}#s=1`)).toBe(true);
    expect(r.protocol).toMatch(/^O https:\/\/www\.mnastrojarna\.cz\/cad#s=1d\.\S+ exp=\d{4}-\d{2}-\d{2} mode=link$/m);
  });

  it("odkaz ověřit (CS/EN/DE): funkční → ✓ + = … ok=1; useknutý → ✗ truncated; změněný → ✗ corrupt", async () => {
    const r = await run(`${PART}sdílet odkazem\nodkaz ověřit\nlink verify\nlink prüfen\n`);
    expect(r.counts.errors).toBe(0);
    const ver = r.protocol.split("\n").filter((l) => / link .* ok=1 /.test(l));
    expect(ver.length).toBe(3);
    for (const l of ver) expect(l).toMatch(/ ok=1 mode=link exp=\d{4}-\d{2}-\d{2} chars=\d+ content=part comp=0 parts=0 sheets=0 files=0 features=2$/);
    const url = r.share!.url;
    const cut = url.slice(0, Math.floor(url.length * 0.6));
    const i = url.length - 40;
    const bad = url.slice(0, i) + (url[i] === "A" ? "B" : "A") + url.slice(i + 1);
    const r2 = await run(`${PART}odkaz ověřit ${cut}\nodkaz ověřit ${bad}\n`);
    dump("verify-ok.short.txt", r.protocol);
    dump("verify-broken.short.txt", r2.protocol);
    const broken = r2.entries.filter((e) => e.code === "share.link-broken");
    expect(broken.length).toBe(2);
    expect(broken[0].text).toMatch(/^odkaz se neotevře \(truncated\): Odkaz je useknutý/);
    expect(broken[1].text).toMatch(/^odkaz se neotevře \(corrupt\): Odkaz je poškozený/);
    expect(r2.protocol).toMatch(/= L4 link url=\S+ ok=0 reason=truncated chars=\d+/);
    expect(r2.protocol).toMatch(/= L5 link url=\S+ ok=0 reason=corrupt chars=\d+/);
    // „nesprávné heslo“ / „nenalezeno“ se pro useknutý odkaz nikdy nevypíše
    expect(r2.protocol).not.toMatch(/Nesprávné heslo|nenalezen/);
  });

  it("stabilní id záznamů: dva běhy téhož skriptu → stejná id, v běhu jedinečná", async () => {
    const a = await run(`${PART}stav\nneznámý příkaz 1\n`);
    const b = await run(`${PART}stav\nneznámý příkaz 1\n`);
    const ids = (x: RunReport) => x.entries.map((e) => e.id);
    expect(ids(a)).toEqual(ids(b));
    expect(new Set(ids(a)).size).toBe(a.entries.length);
    for (const id of ids(a)) expect(id).toMatch(/^L(\d+|-)\.[a-z0-9.-]+(#\d+)?$/);
    expect(a.entries.find((e) => e.level === "error")?.id).toMatch(/^L5\./);
  });

  it("sestava pole 19 kopií → souhrn (počet, první, poslední), ne polohy všech kopií", async () => {
    const ws = new MemoryWorkspace();
    const r = await runReport(ws, `${PART}nový díl "Šroub"\nválec 6 20\nnová sestava "Sestava A"\nvložit "Deska A" ukotvit\nvložit "Šroub" v 10 10 10\nsestava pole "Šroub" 19 rozteč 9 směr X\n`, host());
    const text = r.console ?? "";
    dump("pattern.console.txt", text);
    const line = text.split("\n").find((l) => /pole „Šroub“/.test(l)) ?? "";
    expect(line).toMatch(/18 kopií: první „[^“]+“ \[[^\]]+\] … poslední „[^“]+“ \[[^\]]+\] \(polohy všech: sestava komponenty\)/);
    expect((line.match(/„Šroub/g) ?? []).length).toBeLessThanOrEqual(3);
    expect(line.length).toBeLessThan(400);
  });
});
