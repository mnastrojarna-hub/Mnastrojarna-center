/**
 * Parita enginu v Node (CAD-HEADLESS-NAVRH.md kap. 2.4, balík B2): každý skript korpusu `__corpus__/*.txt` běží přes
 * `runScript` nad `MemoryWorkspace` se skutečným jádrem in-process (stejný klient jádra a stejné obsluhy operací jako
 * v prohlížeči) a jeho protokol konzole se po normalizaci porovná se zlatým snímkem z prohlížeče (dnešní smyčka
 * `runAgentText`, commit 1). Jediné povolené rozdíly: řádky aplikace, které v Node nemají kde běžet (3D okno, stažení) –
 * Node místo nich vypíše ℹ `ui.no-view` / ✗ `host.app-only`; jejich počet pro skript je pevný (`APP_ONLY`).
 *
 * Korpus smlouvy B2 `__corpus__/cross/*.txt` (víc běhů nad týmž prostorem: záložky dřívějších běhů, přejmenování, stav
 * vazeb a kolizí podle dokumentu): zlatý snímek je výstup Node (`CROSS_UPDATE=1` ho zapíše) a e2e v prohlížeči
 * (cad-engine-parity.e2e.cjs) musí dát totéž.
 *
 *   PARITY_ONLY=<regex>  jen vybrané skripty · PARITY_OUT=<složka>  zapsat výsledky Node pro porovnání
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./host";
import { MemoryWorkspace } from "./memory-workspace";
import { greenThenRed } from "./accept";
import { formatConsole } from "./protocol";
import { runScript } from "./run";

type Script = { name: string; runs: string[] };
type Parity = {
  listCorpus(filter?: string): Script[];
  listCross(filter?: string): Script[];
  joinCross(outputs: string[], tabs: string[]): string;
  readCrossGolden(name: string): string | null;
  writeCrossGolden(name: string, text: string): void;
  joinRuns(outputs: string[]): string;
  /** `node: true` = výstup Node (přepíše jediný záměrný rozdíl hostitelů na text prohlížeče, bod 22j) */
  normalize(text: string, o?: { node?: boolean }): string;
  readGolden(name: string): string | null;
  compareNode(golden: string, actual: string): { ok: boolean; subst: number; text: string };
};
const P = createRequire(import.meta.url)("../../../e2e/lib/engine-parity.cjs") as Parity;

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");

/**
 * Počet řádků, které Node nahradí řádkem ℹ ui.no-view / ✗ host.app-only (příkazy jen pro aplikaci: pohled, zobrazení,
 * řez, výběr, otevření výkresu). Výstupy textem (uložit, export) běží od balíku B3 i v Node přes FileSink – 33-ui-out
 * dává v Node tytéž řádky jako aplikace.
 */
const APP_ONLY: Record<string, number> = {
  "21-drawing-open": 1,
  "32-ui-view-api": 8,
};

/**
 * Řádky skriptů korpusu, které dnes smějí mít ✓ i ✗ – dva nezávislé výsledky jednoho příkazu, ne přijetí a pak selhání
 * (každá výjimka je vyjmenovaná, aby nová nepřibyla bez povšimnutí).
 */
const RED_GREEN: Record<string, number[]> = {};

describe("parita enginu v Node (korpus vs. zlaté snímky z prohlížeče)", async () => {
  setLang("cs");
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const out = process.env.PARITY_OUT;
  if (out) fs.mkdirSync(out, { recursive: true });

  for (const sc of P.listCorpus(process.env.PARITY_ONLY)) {
    it(sc.name, async () => {
      const ws = new MemoryWorkspace();
      const host: EngineHost = { kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() };
      const outs: string[] = [];
      for (const text of sc.runs) {
        const r = await runScript(ws, text, host);
        // vlna 22 (22i): žádný řádek žádného skriptu korpusu nemá ✓ a zároveň ✗ (přijetí příkazu je ℹ, výsledek až po výpočtu)
        expect(greenThenRed(r.entries), `${sc.name}: řádky s ✓ i ✗`).toEqual(RED_GREEN[sc.name] ?? []);
        outs.push(formatConsole(r));
      }
      const norm = P.normalize(P.joinRuns(outs), { node: true });
      if (out) fs.writeFileSync(path.join(out, `${sc.name}.node.txt`), norm + "\n");
      const golden = P.readGolden(sc.name);
      expect(golden, "zlatý snímek").not.toBeNull();
      const cmp = P.compareNode(golden!, norm);
      expect(cmp.ok, `${sc.name}: rozdíl proti zlatému snímku\n${cmp.text}`).toBe(true);
      expect(cmp.subst, `${sc.name}: řádky jen pro aplikaci`).toBe(APP_ONLY[sc.name] ?? 0);
    }, 240_000);
  }

  for (const sc of P.listCross(process.env.PARITY_ONLY)) {
    it(`smlouva B2 (prohlížeč = Node): ${sc.name}`, async () => {
      const ws = new MemoryWorkspace();
      const host: EngineHost = { kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() };
      const outs: string[] = [];
      for (const text of sc.runs) outs.push(formatConsole(await runScript(ws, text, host)));
      const norm = P.normalize(P.joinCross(outs, ws.tabs().filter((t) => t.kind !== "drawing").map((t) => t.title)), { node: true });
      if (out) fs.writeFileSync(path.join(out, `${sc.name}.cross.txt`), norm + "\n");
      if (process.env.CROSS_UPDATE) P.writeCrossGolden(sc.name, norm);
      const golden = P.readCrossGolden(sc.name);
      expect(golden, "zlatý snímek (CROSS_UPDATE=1)").not.toBeNull();
      expect(norm).toBe(golden);
    }, 240_000);
  }
});
