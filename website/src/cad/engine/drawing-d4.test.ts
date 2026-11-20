/**
 * Vlna 22, etapa D4 (body 17 a 22j) v enginu se skutečným jádrem in-process (stejná cesta jako CLI / konzole):
 *  * 30 dílů na A3 s kusovníkem: dřív měřítko 1:200, pozice na hromadě, bez ⚠ (repro S/w22/repro/17/repro.txt) – teď
 *    měřítko ≥ 1:2, kusovník ve sloupcích, žádný překryv, řádek D `overlaps=0`;
 *  * 100 dílů na A1: kusovník (101 řádků) dřív přes horní rám – teď ve sloupcích, nic nechybí, pozice ve více pohledech,
 *    žádný překryv (akceptace bodu 17);
 *  * zamčená pozice drží polohu po změně modelu, přiřazení pohledu zůstává; ruční odsazení vygenerované kóty přežije přepočet;
 *  * list jen s kusovníkem; ⚠ drawing.bom-overflow, když se kusovník nevejde; ⚠ zmenšení kvůli tabulkám;
 *  * logo názvem souboru ze vstupů hostitele (CLI --files), logo SVG jako vektor, šablona hlavičky v .mncad / skriptu.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { docToScript } from "../doc-script";
import { setHostAssets } from "../host-assets";
import { setLang } from "../i18n";
import { makeKernelClient } from "../kernel-client";
import { loadSettings, saveSettings } from "../settings";
import type { CadDoc } from "../types";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./host";
import { MemoryWorkspace } from "./memory-workspace";
import { docLine, formatConsole } from "./protocol";
import type { RunReport } from "./protocol-types";
import { runScript } from "./run";
import { clearDrawingMemo, sheetOverlapsOf } from "./sheet-eval";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");

const codes = (r: RunReport, code: string) => r.entries.filter((e) => e.code === code);
const lines = (r: RunReport, re: RegExp) => formatConsole(r).split("\n").filter((l) => re.test(l));

/** n dílů (desky) v poli 10 × ⌈n/10⌉ a sestava; výkres sestavy s kusovníkem a balónky */
function grid(n: number, sheet: string): string {
  const L: string[] = [];
  for (let i = 1; i <= n; i++) L.push(`nový díl Deska ${i}`, `kvádr 20 10 ${4 + (i % 5)}`);
  L.push("nová sestava Nástroj");
  for (let i = 1; i <= n; i++) {
    const x = ((i - 1) % 10) * 25;
    const y = Math.floor((i - 1) / 10) * 15;
    L.push(i === 1 ? `vložit "Deska 1" ukotvit` : `vložit "Deska ${i}" v ${x} ${y} ${(i % 3) * 12}`);
  }
  L.push(`výkres ${sheet} na šířku pohledy přední,horní,iso`, "výkres kusovník ano", "výkres balónky ano");
  return L.join("\n");
}

describe("bod 17 + 22j (čitelný výkres sestavy, šablona hlavičky s logem) – engine se skutečným jádrem", async () => {
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const hostOf = (files: Record<string, Uint8Array> = {}): EngineHost & { files: ReturnType<typeof memoryFileSink> } => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource(files), now: () => Date.now() });
  const docOf = (ws: MemoryWorkspace, name: string): CadDoc => {
    const t = ws.tabs().find((x) => x.title === name)!;
    return ws.docOf!(t.id)!;
  };
  afterEach(() => {
    setLang("cs");
    clearDrawingMemo();
  });

  it("30 dílů na A3: měřítko ≥ 1:2 (dřív 1:200), kusovník ve sloupcích, pozice bez překryvů, D overlaps=0", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, `${grid(30, "A3")}\nvýkres stav`, hostOf());
    const st = formatConsole(r);
    const scale = /měřítko (\d+):(\d+)/.exec(lines(r, /^\s*Výkres „List 1“/)[0])!;
    expect(Number(scale[1]) / Number(scale[2])).toBeGreaterThanOrEqual(0.5);
    expect(st).toMatch(/Kusovník: 30 řádků · ve \d sloupcích/);
    expect(st).toMatch(/Pozice: 30 \(/);
    expect(st).toMatch(/nevešlo se 0/);
    expect(st).toMatch(/Překryvy na listu: 0 \(zkontrolováno/);
    expect(codes(r, "drawing.overlap")).toEqual([]);
    expect(codes(r, "drawing.bom-overflow")).toEqual([]);
    // řádek D `overlaps=` (CLI summarize) bere součet z kontroly listů na konci běhu – jen když proběhla nad všemi listy
    expect(sheetOverlapsOf(docOf(ws, "Nástroj"))).toBe(0);
    expect(docLine({ ref: "Nástroj", name: "Nástroj", kind: "assembly", sheets: 1, overlaps: 0 })).toMatch(/ overlaps=0$/);
    expect(docLine({ ref: "Nástroj", name: "Nástroj", kind: "assembly", sheets: 1 })).not.toMatch(/overlaps=/);
  }, 600_000);

  it("100 dílů na A1 (akceptace): kusovník 100 řádků ve sloupcích bez chybějících, pozice ve více pohledech, překryvy 0", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, `${grid(100, "A1")}\nvýkres stav`, hostOf());
    const st = formatConsole(r);
    expect(st).toMatch(/Kusovník: 100 řádků · ve [2-9] sloupcích/);
    expect(st).not.toMatch(/řádků se nevešlo/);
    expect(st).toMatch(/Pozice: 100 \([^)]*, [^)]*\)/); // aspoň dva pohledy
    expect(st).toMatch(/nevešlo se 0/);
    expect(st).toMatch(/Překryvy na listu: 0 \(/);
    expect(codes(r, "drawing.bom-overflow")).toEqual([]);
  }, 900_000);

  it("zámek pozice a přiřazení pohledu přežijí změnu modelu; posun; odemknout; ruční odsazení vygenerované kóty zůstane", async () => {
    const ws = new MemoryWorkspace();
    const host = hostOf();
    await runScript(ws, `${grid(12, "A3")}\nvýkres pozice pohled horní 1-3\nvýkres pozice zamknout 5\nvýkres vygenerované posun pos:6 0 5`, host);
    const lock0 = (docOf(ws, "Nástroj").drawings![0].options as { genEdit?: { lock?: Record<string, number[]> } }).genEdit?.lock?.["pos:5"];
    expect(lock0).toHaveLength(2);
    const r = await runScript(ws, `záložka "Nástroj"\nvložit "Deska 12" v 0 -40 0\nvýkres pozice`, host);
    const st = formatConsole(r);
    expect(st).toMatch(/přiřazené ručně 3 · posunuté 1 · zamčené 1/);
    expect(st).toMatch(/horní: 1–3/);
    const o = docOf(ws, "Nástroj").drawings![0].options as { genEdit?: { lock?: Record<string, number[]> }; balloonViews?: Record<string, string> };
    expect(o.genEdit?.lock?.["pos:5"]).toEqual(lock0);
    expect(o.balloonViews).toEqual({ "1": "top", "2": "top", "3": "top" });
    const u = await runScript(ws, `záložka "Nástroj"\nvýkres pozice odemknout 5\nvýkres pozice pohled auto`, host);
    expect(formatConsole(u)).toMatch(/přiřazené ručně 0 · posunuté 1 · zamčené 0/);
    // díl: odsazení 30 vygenerované kóty „100“ po změně délky na 110 (dřív zpět na 15)
    const k = await runScript(ws, 'nový díl "Deska K"\nkvádr 100 60 20\nvýkres A4 na šířku pohledy přední,horní\nvýkres upravit "100" odsazení=30\nupravit "Kvádr 1" size.0=110\nvýkres stav', host);
    expect(formatConsole(k)).toMatch(/upraveno a\d+: 100 → 100 \(odsazení 30\)/);
    const dim = docOf(ws, "Deska K").drawings![0].annotations.find((a) => a.auto === "ov:x") as { offset?: number; placed?: string } | undefined;
    expect(dim?.offset).toBe(30);
    expect(dim?.placed).toBe("user");
  }, 600_000);

  it("kusovník na samostatném listu (list jen s kusovníkem) a ve sloupcích; skript z dokumentu je zapíše", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, `${grid(12, "A3")}\nvýkres pozice pohled horní 1-2\nvýkres vygenerované zamknout pos:4\nvýkres kusovník list\nvýkres listy\nvýkres list 2\nvýkres stav`, hostOf());
    const st = formatConsole(r);
    expect(st).toMatch(/✓ kusovník na samostatném listu 2 „Kusovník“/);
    expect(st).toMatch(/Kusovník: 12 řádků · list jen s kusovníkem \(1 sloupců\)/);
    expect(st).toMatch(/List jen s kusovníkem – pohledy ani kóty nemá/);
    const d = docOf(ws, "Nástroj");
    expect((d.drawings![0].options as { bomPlace?: string }).bomPlace).toBe("sheet");
    expect((d.drawings![1].options as { bomOnly?: boolean }).bomOnly).toBe(true);
    const s = docToScript(d).text;
    expect(s).toMatch(/^výkres pozice pohled horní 1-2$/m);
    expect(s).toMatch(/^výkres vygenerované zamknout pos:4 [\d.]+ [\d.]+ odshora$/m);
    expect(s).toMatch(/^výkres kusovník list$/m);
    expect(s).toMatch(/^výkres list "Kusovník"$/m);
  }, 600_000);

  it("kusovník, který se nevejde ani ve sloupcích: ⚠ drawing.bom-overflow s počtem chybějících řádků (nikdy tiše)", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, `${grid(80, "A4")}\nvýkres stav`, hostOf());
    const w = codes(r, "drawing.bom-overflow");
    expect(w.length).toBeGreaterThanOrEqual(1);
    expect(w[0].text).toMatch(/Kusovník \(80 řádků\) se na list A4 nevejde ani ve sloupcích – \d+ řádků chybí/);
    expect(formatConsole(r)).toMatch(/⚠ \d+ řádků se nevešlo/);
  }, 900_000);

  it("logo názvem souboru ze vstupů hostitele (CLI --files) a logo SVG jako vektor v SVG exportu; šablona hlavičky v .mncad a skriptu", async () => {
    saveSettings({ ...loadSettings(), titleTemplates: [], titleTemplateDefault: undefined });
    const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="40" height="40" fill="#e03930"/></svg>');
    const ws = new MemoryWorkspace();
    const host = hostOf({ "logo.png": png, "znak.svg": svg });
    const r = await runScript(ws, 'nový díl "Deska L"\nkvádr 100 60 20\nvýkres A4 na šířku pohledy přední,horní\nvýkres razítko logo="logo.png"\nvýkres hlavička uložit "Firma" logo="znak.svg" firma="F s.r.o."\nvýkres hlavička použít "Firma"\nvýkres export svg\nexport mncad "L"', host);
    const txt = formatConsole(r);
    expect(txt).toMatch(/✓ razítko: logo „logo\.png“/);
    expect(txt).toMatch(/✓ šablona hlavičky „Firma“ .*logo SVG/);
    const svgOut = [...host.files.files.values()].find((f) => f.file.name.endsWith(".svg"));
    expect(new TextDecoder().decode(svgOut!.data)).toContain("data:image/svg+xml");
    const mnc = [...host.files.files.values()].find((f) => f.file.name.endsWith(".mncad"));
    const j = JSON.parse(new TextDecoder().decode(mnc!.data));
    const doc = (j.doc ?? j) as CadDoc;
    expect(doc.titleTemplates?.[0].logo?.svg).toMatch(/^data:image\/svg\+xml/);
    expect((doc.drawings![0].meta as { titleTpl?: string }).titleTpl).toBe("Firma");
    const s = docToScript(docOf(ws, "Deska L")).text;
    expect(s).toMatch(/^výkres hlavička uložit "Firma" .*logo="data:image\/svg\+xml;base64,/m);
    expect(s).toMatch(/^výkres hlavička použít "Firma"$/m);
  }, 600_000);
});
