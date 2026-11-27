/**
 * Vlna 22, kolo 7, stopa a – se skutečným jádrem in-process (cesta CLI / konzole):
 *  * bod 22h: neúspěšný export zůstane v dokumentu (`exportFailures`: formát, soubor, fáze, chyba, revize) – `exporty` ho
 *    vypíše (pole `failed=`), uložený .mncad ho nese, krok Zpět ho nesmaže; dřív byl jen v seznamu relace.
 *  * bod 12: CSV pohybové studie nese revizi sestavy (poslední sloupec „Revize modelu“, řádek F `rev=`); dřív bez revize.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setHostAssets } from "../host-assets";
import { setLang } from "../i18n";
import { makeKernelClient } from "../kernel-client";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../engine/host";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { runScript } from "../engine/run";
import { carryOutputs } from "../history-outputs";
import { failuresLines } from "../export-failures";
import { formatShort } from "../engine/protocol";
import { runReport } from "../engine/run-protocol";
import { modelRev } from "../engine/result-key";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");

describe("kolo 7 (jádro): trvalý záznam neúspěšného exportu", async () => {
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const failing = { ...kernel, exportFile: async () => Promise.reject(new Error("zapisovač STEP: krok „přenos tvaru do STEP“ skončil stavem IFSelect_RetFail")) };
  const hostOf = (k = kernel): EngineHost & { files: ReturnType<typeof memoryFileSink> } => ({ kernel: k as never, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });

  it("bod 22h: `export step` selže → záznam v dokumentu, `exporty` ho vypíše s fází a příčinou, soubor nevznikl", async () => {
    setLang("cs");
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, 'nový díl "Deska A"\nkvádr 20 10 10\nexport step\nexporty', hostOf(failing));
    const d = ws.present();
    expect(d.outputs ?? []).toHaveLength(0); // není to výstup – nikdy „odpovídá modelu“
    expect(d.exportFailures).toHaveLength(1);
    expect(d.exportFailures![0]).toMatchObject({ format: "step", file: "Deska_A.step", state: "error", phase: "convert" });
    expect(d.exportFailures![0].modelRev).toMatch(/^r·[0-9a-f]{6}$/);
    expect(d.exportFailures![0].error).toMatch(/IFSelect_RetFail/);
    expect(r.console).toMatch(/Neúspěšné exporty \(1\) – soubor nevznikl:\n {2}1\. ✗ STEP „Deska_A\.step“ · z modelu r·[0-9a-f]{6} · .* – chyba ve fázi „převod do STEP“, soubor nevznikl: .*IFSelect_RetFail/);
    expect(r.console).not.toMatch(/odpovídá modelu/);
    // trvale: uložený dokument nese záznam, nové otevření ho vypíše
    const saved = JSON.parse(JSON.stringify(d));
    expect(failuresLines(saved)[1]).toMatch(/✗ STEP „Deska_A\.step“/);
    // krok Zpět záznam nesmaže (záznam skutečnosti jako export)
    expect(carryOutputs({ ...d, exportFailures: undefined }, d).exportFailures).toHaveLength(1);
  });

  it("bod 22h: úspěšný export záznam neúspěchu nepřidá; `exporty vymazat` vymaže i neúspěšné", async () => {
    setLang("cs");
    const ws = new MemoryWorkspace();
    await runScript(ws, 'nový díl "Deska A"\nkvádr 20 10 10\nexport step', hostOf(failing));
    const ok = await runScript(ws, "export step bez kontroly\nexporty", hostOf());
    expect(ws.present().exportFailures).toHaveLength(1);
    expect(ws.present().outputs).toHaveLength(1);
    expect(ok.console).toMatch(/odpovídá modelu/);
    await runScript(ws, "exporty vymazat", hostOf());
    expect(ws.present().exportFailures).toBeUndefined();
  });

  it("bod 12: `pohyb export csv` – soubor nese revizi sestavy (sloupec „Revize modelu“, F … rev=r·…)", async () => {
    setLang("cs");
    const host = hostOf();
    const ws = new MemoryWorkspace();
    const rep = await runReport(ws, 'nový díl Vodítko\nkvádr 100 20 10\nnový díl Jezdec\nkvádr 20 20 10\nnová sestava Pohyb\nvložit "Vodítko" ukotvit\nvložit "Jezdec" v 0 0 10\nsestava vazba vzdálenost "Jezdec" -X "Vodítko" -X hodnota 10\npohyb motor lineární vazba 1 10..50 kroky 4\npohyb export csv', host);
    const rev = modelRev(ws.present());
    const csv = new TextDecoder().decode(host.files.files.get("Pohyb-pohyb.csv")!.data).replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    expect(csv).toHaveLength(6);
    expect(csv[0]).toMatch(/;Revize modelu$/);
    for (const row of csv.slice(1)) expect(row.endsWith(`;${rev}`)).toBe(true);
    expect(formatShort(rep, { budget: Infinity })).toMatch(new RegExp(`^F csv "Pohyb-pohyb\\.csv" \\d+B .*rev=${rev}`, "m"));
  }, 240_000);
});
