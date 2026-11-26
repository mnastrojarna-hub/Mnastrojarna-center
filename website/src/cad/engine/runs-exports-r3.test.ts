/**
 * Vlna 22, fáze 2, kolo 3 – body 12 a 22h se skutečným jádrem in-process (stejná cesta jako CLI, `mncad serve` a konzole):
 *  * bod 12: zrušený běh po `nový díl` uprostřed skriptu – záložka, kterou běh do zrušení založil, se zavře; zapsal-li běh
 *    před zrušením do jiné záložky, hláška to řekne (✗ run.cancelled-partial), nikdy „dokument zůstal beze změny“;
 *  * bod 12: soubor STEP nese revizi modelu v hlavičce (FILE_DESCRIPTION) – stejnou jako řádek F a .mncad; zpětné načtení
 *    souboru s revizí projde kontrolou;
 *  * bod 22h: záznam exportu v dokumentu nese úlohu (stav, čas, fáze, kontrola) – zůstane s dokumentem, `exporty` ho vypíše;
 *  * bod 22h: selhání převodu = diagnostika (fáze, zpráva jádra, stav modelu), ne holá chyba jádra.
 * Repro textem: korpus `__corpus__/54-export-job.txt`.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setHostAssets } from "../host-assets";
import { setLang } from "../i18n";
import { makeKernelClient } from "../kernel-client";
import { emptyDoc, type CadDoc, type Feature } from "../types";
import { convertError, ExportConvertError, runExportJob } from "./export-job";
import { stampStepRev, stepRevOf } from "./files";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./host";
import { MemoryWorkspace } from "./memory-workspace";
import { runScript } from "./run";
import { runReport } from "./run-protocol";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");

describe("kolo 3: zrušení běhu, revize ve STEP, záznam úlohy exportu", async () => {
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const hostOf = (): EngineHost & { files: ReturnType<typeof memoryFileSink> } => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
  /** zrušení běhu po dokončení řádku `line` (jako tlačítko Zrušit běh uprostřed skriptu) */
  const cancelAt = (line: number) => {
    const ac = new AbortController();
    return { signal: ac.signal, hooks: { opEnd: (l: number | null) => void (l === line && ac.abort()) } };
  };

  it("bod 12: zrušení po `nový díl` – záložka založená během se zavře, aktivní je původní, „beze změny“ je pravda", async () => {
    setLang("cs");
    const ws = new MemoryWorkspace();
    const before = ws.tabs().map((t) => t.id);
    const r = await runScript(ws, 'nový díl "Deska B"\nkvádr 20 10 10\nnový díl "Deska C"\nkvádr 10 10 10', hostOf(), cancelAt(3));
    expect(r.entries.filter((e) => e.code?.startsWith("run.cancelled")).map((e) => e.code)).toEqual(["run.cancelled"]);
    expect(ws.tabs().map((t) => t.id)).toEqual(before); // „Deska B“ (zapsaná při přechodu na „Deska C“) už není
    expect(ws.tabs().some((t) => t.title === "Deska B" || t.title === "Deska C")).toBe(false);
    expect(r.console).toMatch(/✗ Výpočet zrušen – dokument zůstal beze změny\. Dokumenty založené během \(„Deska B“\) se zahodily\./);
  });

  it("bod 12: zrušení po zápisu do existující záložky – ✗ run.cancelled-partial ji vyjmenuje, nikdy „beze změny“", async () => {
    setLang("cs");
    const ws = new MemoryWorkspace();
    await runScript(ws, 'nový díl "Deska A"\nkvádr 20 10 10', hostOf()); // dřívější běh: záložka „Deska A“
    const r = await runScript(ws, 'kvádr 5 5 5 v 0 0 10\nnový díl "Deska D"\nkvádr 10 10 10', hostOf(), cancelAt(2));
    const e = r.entries.find((x) => x.code?.startsWith("run.cancelled"));
    expect(e?.code).toBe("run.cancelled-partial");
    expect(e?.level).toBe("error");
    expect(r.console).not.toMatch(/beze změny/);
    // „Deska D“ ještě záložku neměla (zrušeno dřív, než se zapsala) – nic se nezavíralo
    expect(r.console).toMatch(/✗ Výpočet zrušen – rozpracovaný dokument se nezapsal, ale změny zapsané před zrušením zůstaly v „Deska A“ \(Zpět je vrátí\)\.\n/);
    expect(ws.tabs().some((t) => t.title === "Deska D")).toBe(false);
    expect(ws.tabs().find((t) => t.active)?.title).toBe("Deska A");
    expect(ws.present().features.length).toBe(2); // zapsaný krok zůstal – a hláška to říká
  });

  it("bod 12: STEP nese revizi modelu v hlavičce = řádek F `rev=`; zpětné načtení s revizí projde (✓ kontrola)", async () => {
    setLang("cs");
    const ws = new MemoryWorkspace();
    const host = hostOf();
    const r = await runReport(ws, 'nový díl "Deska A"\nkvádr 20 10 10\nexport step', host);
    const f = r.files?.find((x) => x.format === "step");
    expect(f?.modelRev).toMatch(/^r·[0-9a-f]{6}$/);
    const bytes = host.files.files.get(f!.name)!.data;
    expect(stepRevOf(bytes)).toBe(f!.modelRev);
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2000));
    expect(head).toMatch(/FILE_DESCRIPTION\(\('Open CASCADE Model','MNCAD model revision r\\X\\B7[0-9a-f]{6}'\),'2;1'\)/);
    expect(f?.check?.ok).toBe(true); // soubor s revizí v hlavičce jde znovu načíst a sedí s modelem
  });

  it("bod 12: označení revize je idempotentní a soubor bez FILE_DESCRIPTION zůstane beze změny", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const a = enc("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('Open CASCADE Model'),'2;1');\nENDSEC;\n");
    const once = stampStepRev(a, "r·abc123");
    expect(stampStepRev(once, "r·abc123")).toBe(once);
    expect(stepRevOf(once)).toBe("r·abc123");
    const none = enc("ISO-10303-21;\nHEADER;\nENDSEC;\n");
    expect(stampStepRev(none, "r·abc123")).toBe(none);
    expect(stepRevOf(none)).toBeNull();
  });

  it("bod 22h: textový `export step` zapíše do dokumentu úlohu (stav, čas, fáze, kontrola) – `exporty` ji vypíše", async () => {
    setLang("cs");
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, 'nový díl "Deska A"\nkvádr 20 10 10\nexport step\nexporty', hostOf());
    const rec = ws.present().outputs?.at(-1);
    expect(rec?.job).toMatchObject({ state: "done", check: { ok: true } });
    expect(rec?.job?.phases?.map((p) => p.phase)).toEqual(["model", "convert", "write", "verify"]);
    expect(typeof rec?.job?.ms).toBe("number");
    expect(r.console).toMatch(/STEP „Deska_A\.step“ · z modelu r·[0-9a-f]{6} \([^)]*\) · úloha: dokončeno ⏱ [\d,]+ s · kontrola ✓ – odpovídá modelu/);
  });

  it("bod 22h (greens): `exporty` bez kontroly zpětným načtením nepíše „kontrola ✓“", async () => {
    setLang("cs");
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, 'nový díl "Deska A"\nkvádr 20 10 10\nexport step bez kontroly\nexporty', hostOf());
    expect(ws.present().outputs?.at(-1)?.job?.check).toBeUndefined();
    expect(r.console).toMatch(/úloha: dokončeno ⏱ [\d,]+ s – odpovídá modelu/);
    expect(r.console).not.toMatch(/kontrola ✓/);
  });

  it("bod 22h: selhání převodu = diagnostika – fáze, zpráva jádra, stav modelu z přestavby (těleso, prvky s chybou)", async () => {
    setLang("cs");
    const d: CadDoc = { ...emptyDoc("Deska A"), features: [{ id: "f1", name: "Kvádr", type: "box", size: [20, 10, 10], position: [0, 0, 0] } as unknown as Feature] };
    const failing = { check: kernel.check, exportStats: kernel.exportStats, exportFile: async () => Promise.reject(new Error("zapisovač STEP: Transfer failed")) };
    const job = runExportJob(d, "step", { kernel: failing as never, write: async () => 0 });
    const e = await job.catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ExportConvertError);
    const m = (e as Error).message;
    expect(m).toMatch(/^převod do STEP selhal ve fázi „převod do STEP“: zapisovač STEP: Transfer failed · model má těleso$/);
    expect((e as ExportConvertError).diag).toMatchObject({ phase: "convert", format: "step", kernel: "zapisovač STEP: Transfer failed", solid: true, failed: [] });
    // model s chybným prvkem: diagnostika ho jmenuje
    const bad = convertError(new Error("x"), d, "step", { status: [{ id: "f1", ok: false, error: "nulový objem" }], paramErrors: [], solid: false });
    expect((bad as Error).message).toMatch(/model NEMÁ těleso · prvky s chybou: „Kvádr“ \(nulový objem\)/);
    // EN
    setLang("en");
    expect((convertError(new Error("x"), d, "step", { status: [], paramErrors: [], solid: true }) as Error).message).toMatch(/^STEP conversion failed in phase /);
    setLang("cs");
  });
});
