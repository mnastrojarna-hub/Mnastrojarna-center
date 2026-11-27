/**
 * Vlna 22, bod 20 – etapa D2 v enginu se skutečným jádrem in-process (stejná cesta jako CLI / `mncad serve` / konzole):
 *  * `výkres vydat` zapíše revizi modelu; po změně modelu ⚠ drawing.stale ve `výkres stav`, `stav`, na konci běhu, při
 *    exportu se stejným písmenem (přísný režim ✗ a soubor se nezapíše), řádek D `rev=` / `stale=drawing,export`, JSON;
 *  * záznamy exportů v dokumentu (`exporty`), zastaralé po změně, uložené s dokumentem (.mncad);
 *  * `výstupy zastaralé` a `přepočítat vše` (list sestavy s kusovníkem z kopie dílu → D1 `sestava obnovit vše`);
 *  * patička razítka / PDF Info / DXF komentář nesou revizi modelu; skript z dokumentu zapíše `výkres vydat A`;
 *  * EN / DE příkazy.
 * Repro: korpus `__corpus__/77-drawing-issue-stale.txt`, `78-outputs-recompute.txt`.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { modelId } from "../doc-outputs";
import { setHostAssets } from "../host-assets";
import { setLang } from "../i18n";
import { makeKernelClient } from "../kernel-client";
import type { CadDoc } from "../types";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./host";
import { MemoryWorkspace } from "./memory-workspace";
import { formatConsole } from "./protocol";
import type { RunReport } from "./protocol-types";
import { runScript } from "./run";
import { runReport } from "./run-protocol";
import { clearDrawingMemo } from "./sheet-eval";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");

const codes = (r: RunReport, code: string) => r.entries.filter((e) => e.code === code);
const PART = ['nový díl "Deska A"', "kvádr 60 40 10", "výkres A4", "výkres nepředepsané ISO 2768-mK"].join("\n");

describe("bod 20 (výkresy a výstupy) – engine se skutečným jádrem", async () => {
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const hostOf = (): EngineHost & { files: ReturnType<typeof memoryFileSink> } => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
  const docOf = (ws: MemoryWorkspace, name: string): CadDoc => {
    const t = ws.tabs().find((x) => x.title === name)!;
    return ws.docOf!(t.id)!;
  };
  afterEach(() => {
    setLang("cs");
    clearDrawingMemo();
  });

  it("vydání → změna modelu → výkres stav / stav / konec běhu ⚠ drawing.stale; řádek D rev= stale=drawing (repro bod 20)", async () => {
    const ws = new MemoryWorkspace();
    const host = hostOf();
    const r1 = await runScript(ws, `${PART}\nvýkres vydat\nvýkres stav`, host);
    expect(codes(r1, "drawing.stale")).toEqual([]);
    const c1 = formatConsole(r1);
    // vydání = příkaz výkresu: přijato (→, 22i), list se pak vyhodnotí (✓ listu); ✗ žádné
    expect(c1).toMatch(/→ list „List 1“ vydán jako rev\. A z modelu r·[0-9a-f]{6} \(.+\) · do tabulky revizí přidána revize A „první vydání“ – výsledek po vyhodnocení listu níže/);
    expect(c1).toMatch(/✓ výkres: list „List 1“ vyhodnocen bez nálezů/);
    expect(r1.entries.filter((e) => e.level === "error")).toEqual([]);
    expect(c1).toMatch(/Vydání: rev\. A z modelu r·[0-9a-f]{6} \(.+\) – odpovídá modelu/);
    const d1 = docOf(ws, "Deska A");
    expect(d1.drawings![0].issued).toMatchObject({ rev: "A", modelRev: modelId(d1).rev });
    // změna modelu v dalším běhu: konec běhu hlásí zastaralý vydaný list (dokument běh změnil)
    const r2 = await runScript(ws, 'záložka "Deska A"\nupravit "Kvádr 1" size=30;40;10', host);
    expect(codes(r2, "drawing.stale").map((e) => [e.line ?? null, e.level])).toEqual([[null, "warn"]]);
    expect(codes(r2, "drawing.stale")[0].text).toMatch(/^vydaný výkres neodpovídá modelu: list „List 1“ vydán jako rev\. A z modelu r·\w{6} \(.+\), model je teď r·\w{6} – vydejte novou revizi: výkres vydat B$/);
    // výkres stav + stav: ⚠ na řádku (jednou za běh), řádek „⚠ Vydání …“, strojově drawing.stale=1, D rev= stale=drawing
    const r3 = await runReport(ws, 'záložka "Deska A"\nvýkres stav\nstav', host);
    expect(codes(r3, "drawing.stale").map((e) => e.line)).toEqual([2]);
    expect(r3.console).toMatch(/⚠ Vydání: rev\. A z modelu r·\w{6} \(.+\) – model je teď r·\w{6}: list je ZASTARALÝ – vydejte novou revizi: výkres vydat B/);
    expect(r3.entries.find((e) => e.code === "status")?.text).toMatch(/ drawing\.stale=1$/);
    const d = r3.docs.find((x) => x.name === "Deska A")!;
    expect(d.rev).toBe(modelId(docOf(ws, "Deska A")).rev);
    expect(d.stale).toEqual(["drawing"]);
    // nová revize B: nic zastaralého, stav bez ⚠
    const r4 = await runReport(ws, 'záložka "Deska A"\nvýkres vydat\nstav', host);
    expect(r4.console).toMatch(/→ list „List 1“ vydán jako rev\. B z modelu r·\w{6} .* revize B „změna modelu r·\w{6} → r·\w{6}“ – výsledek po vyhodnocení listu níže/);
    expect(r4.console).toMatch(/✓ výkres: list „List 1“ vyhodnocen bez nálezů/);
    expect(codes(r4, "drawing.stale")).toEqual([]);
    expect(r4.docs.find((x) => x.name === "Deska A")!.stale).toBeUndefined();
  }, 240_000);

  it("export listu se stejným písmenem po změně: ⚠ (normálně soubor zapíše), přísně ✗ a soubor se nezapíše", async () => {
    const ws = new MemoryWorkspace();
    const host = hostOf();
    await runScript(ws, `${PART}\nvýkres vydat A`, host);
    await runScript(ws, 'záložka "Deska A"\nupravit "Kvádr 1" size=30;40;10', host);
    const r = await runScript(ws, 'záložka "Deska A"\nvýkres export pdf', host);
    expect(codes(r, "drawing.stale").map((e) => [e.line, e.level])).toEqual([[2, "warn"]]);
    expect(codes(r, "drawing.stale")[0].text).toMatch(/se exportuje s revizí A, ale rev\. A byla vydána z modelu r·\w{6} a model je teď r·\w{6}/);
    expect([...host.files.files.keys()]).toEqual(["Deska_A_vykres.pdf"]);
    const strictHost = hostOf();
    const rs = await runScript(ws, 'záložka "Deska A"\nvýkres export pdf jako přísný', strictHost, { strict: true });
    expect(codes(rs, "drawing.stale").map((e) => e.level)).toEqual(["error"]);
    expect([...strictHost.files.files.keys()]).toEqual([]);
  }, 240_000);

  it("záznamy exportů: revize modelu, uloženy s dokumentem, po změně zastaralé; výstupy zastaralé; řádek D stale=export", async () => {
    const ws = new MemoryWorkspace();
    const host = hostOf();
    const r1 = await runScript(ws, `${PART}\nexport step\nvýkres export pdf\nexporty`, host);
    expect(r1.entries.find((e) => e.code === "out" && /exports=2 stale=0/.test(e.text))).toBeTruthy();
    const d1 = docOf(ws, "Deska A");
    expect(d1.outputs!.map((o) => [o.what, o.format, o.file, o.modelRev])).toEqual([
      ["model", "step", "Deska_A.step", modelId(d1).rev],
      ["drawing", "pdf", "Deska_A_vykres.pdf", modelId(d1).rev],
    ]);
    // .mncad nese záznamy (uložit po exportech)
    const r2 = await runScript(ws, 'záložka "Deska A"\nuložit', host);
    expect(codes(r2, "out.lost-imports")).toEqual([]);
    const saved = JSON.parse(Buffer.from(host.files.files.get("Deska_A.mncad")!.data).toString("utf8")) as CadDoc;
    expect(saved.outputs?.length).toBe(2);
    const r3 = await runReport(ws, 'záložka "Deska A"\nupravit "Kvádr 1" size=30;40;10\nexporty\nvýstupy zastaralé', host);
    expect(r3.console).toMatch(/Exporty \(2, zastaralých 2\)/);
    expect(r3.console).toMatch(/⚠ STEP „Deska_A\.step“ .* ZASTARALÝ: model je teď r·\w{6}, exportujte znovu: export step/);
    expect(r3.console).toMatch(/Zastaralé výstupy \(2\) · model je teď r·\w{6}:/);
    expect(r3.docs.find((x) => x.name === "Deska A")!.stale).toEqual(["export"]);
    // nic se samo nepřepisuje: přepočítat vše export jen vypíše jako úkol pro člověka
    const r4 = await runScript(ws, 'záložka "Deska A"\npřepočítat vše', host);
    expect(formatConsole(r4)).toMatch(/Zbývá udělat ručně \(2\) – program to sám neudělá:/);
    expect(formatConsole(r4)).toMatch(/→ export step/);
  }, 240_000);

  it("přepočítat vše: list sestavy s kusovníkem z kopie dílu se obnoví funkcí D1 (sestava obnovit vše)", async () => {
    const ws = new MemoryWorkspace();
    const host = hostOf();
    await runScript(ws, 'nový díl "Deska A"\nkvádr 100 60 20\nnový díl "Přidržovač"\nkvádr 40 30 10', host);
    await runScript(ws, 'nová sestava "Nástroj"\nvložit "Deska A" ukotvit\nvložit "Přidržovač" v 10 10 20\nvýkres A3\nvýkres vydat', host);
    // číslo a materiál dílu doplněné po vložení → kopie v sestavě je starší (D1)
    await runScript(ws, 'záložka "Deska A"\nmateriál 1.2379\nvýkres razítko číslo="DA-001"', host);
    const r = await runScript(ws, 'záložka "Nástroj"\nvýstupy zastaralé\npřepočítat vše\nkusovník', host);
    const c = formatConsole(r);
    expect(c).toMatch(/⚠ Deska A – komponenta „Deska A“ je starší než díl „Deska A“ v záložce .* → sestava obnovit #1 \(přepočítat vše\)/);
    expect(c).toMatch(/✓ kopie dílů v sestavě obnoveny z dílů \(sestava obnovit vše\)/);
    expect(c).toMatch(/✓ list „List 1“ přepočten z modelu r·\w{6}/);
    expect(c).toMatch(/1 \| Deska A \| DA-001 \| 1 \| 1\.2379 \|/);
    // číslo / materiál geometrii nemění (revize modelu r·… zůstala), ale kusovník vydaného listu sestavy ano → vydaný list je
    // zastaralý a nová revize je úkol pro člověka (vlna 22, bod 20 – kolo 3; dřív „Zbývá: nic … odpovídají modelu“ = falešně zelené)
    expect(c).not.toMatch(/Zbývá: nic/);
    expect(c).toMatch(/Zbývá udělat ručně \(1\) – program to sám neudělá:\n  ⚠ list „List 1“ rev\. A – vydán z modelu (r·\w{6}), model je teď \1 se změněnými údaji dílu \(název, číslo, materiál, druh položky\) → výkres vydat B/);
    expect(codes(r, "drawing.stale").length).toBeGreaterThan(0);
  }, 240_000);

  it("kolo 3: změna jen materiálu / čísla dílu zneplatní vydaný list a export výkresu / CSV kusovníku, ne STEP (bod 20)", async () => {
    const ws = new MemoryWorkspace();
    const host = hostOf();
    const r1 = await runScript(ws, `${PART}\nvýkres vydat\nexport step\nvýkres export pdf`, host);
    expect(codes(r1, "drawing.stale")).toEqual([]);
    const rev = modelId(docOf(ws, "Deska A")).rev;
    // před opravou: geometrie stejná → „Vydání: rev. A … – odpovídá modelu“ i s jiným materiálem v razítku (falešně zelené)
    const r2 = await runReport(ws, 'záložka "Deska A"\nmateriál 1.2379\nvýkres stav\nexporty', host);
    expect(modelId(docOf(ws, "Deska A")).rev).toBe(rev);
    expect(r2.console).not.toMatch(/Vydání: rev\. A .* – odpovídá modelu/);
    expect(r2.console).toMatch(new RegExp(`⚠ Vydání: rev\\. A z modelu ${rev} \\(.+\\) – model je teď ${rev} se změněnými údaji dílu \\(název, číslo, materiál, druh položky\\): list je ZASTARALÝ – vydejte novou revizi: výkres vydat B`));
    expect(r2.console).toMatch(/PDF „Deska_A_vykres\.pdf“ .* ZASTARALÝ: model je teď r·\w{6} se změněnými údaji dílu/);
    // STEP nese jen geometrii – materiál ho nezneplatní
    expect(r2.console).toMatch(/STEP „Deska_A\.step“ .* – odpovídá modelu/);
    expect(r2.docs.find((x) => x.name === "Deska A")!.stale).toEqual(expect.arrayContaining(["drawing", "export"]));
    // nové vydání: popis „změna údajů dílu“, pak list i stav zase odpovídají
    const r3 = await runReport(ws, 'záložka "Deska A"\nvýkres vydat\nvýkres stav', host);
    expect(r3.console).toMatch(/do tabulky revizí přidána revize B „změna údajů dílu \(název, číslo, materiál, druh položky\)“/);
    expect(r3.console).toMatch(/Vydání: rev\. B z modelu r·\w{6} \(.+\) – odpovídá modelu/);
    // starší záznam vydání bez otisku údajů (dokument z dřívější verze) se po upgradu nehlásí jako zastaralý
    const d = docOf(ws, "Deska A");
    const { data: _d, ...old } = d.drawings![0].issued!;
    void _d;
    const { sheetState } = await import("../doc-outputs");
    expect(sheetState(d, { issued: old })).toBe("current");
  }, 240_000);

  it("razítko a metadata souborů nesou revizi modelu; skript z dokumentu zapíše výkres vydat A", async () => {
    const ws = new MemoryWorkspace();
    const host = hostOf();
    const r = await runScript(ws, `${PART}\nvýkres vydat\nvýkres export pdf\nvýkres export dxf\nexport skript`, host);
    expect(r.entries.filter((e) => e.level === "error")).toEqual([]);
    const d = docOf(ws, "Deska A");
    const rev = modelId(d).rev;
    const pdf = Buffer.from(host.files.files.get("Deska_A_vykres.pdf")!.data).toString("latin1");
    // Info PDF: předmět „Model r·… · rev. A“ a klíčová slova model=… rev=A (jsPDF je zapisuje jako řetězce Info)
    expect(pdf).toContain("/Subject");
    expect(pdf).toContain("/Keywords");
    const dxf = Buffer.from(host.files.files.get("Deska_A_vykres.dxf")!.data).toString("utf8");
    expect(dxf.startsWith(`999\nMnastrojarna CAD model ${rev.replace("·", "-")} rev A\n`)).toBe(true);
    expect(dxf).toContain(`Model r\\U+00B7${rev.slice(2)}`); // patička razítka (TEXT v DXF, · jako \U+00B7)
    const script = Buffer.from(host.files.files.get("Deska_A.mncad.txt")!.data).toString("utf8");
    expect(script).toMatch(/^výkres vydat A$/m);
  }, 240_000);

  it("EN / DE: drawing issue, exports, recompute all · zeichnung freigeben, ausgaben veraltet, alles neu berechnen", async () => {
    setLang("en");
    const ws = new MemoryWorkspace();
    const host = hostOf();
    const r = await runScript(ws, 'new part "Plate A"\nbox 60 40 10\ndrawing A4\ndrawing issue\nedit "Box 1" size=30;40;10\noutputs stale\nrecompute all', host);
    const c = formatConsole(r);
    expect(c).toMatch(/→ sheet “Sheet 1” issued as rev\. A from model r·\w{6}.* – result after the sheet is evaluated below/);
    expect(c).toMatch(/Outdated outputs \(1\) · the model is now r·\w{6}:/);
    expect(c).toMatch(/Recompute all – document “Plate A”, model revision r·\w{6}:/);
    setLang("de");
    const ws2 = new MemoryWorkspace();
    // kolo 7 (22i): Blatt ohne Allgemeintoleranzen ist kein „✓ ohne Befund“ mehr (ℹ) – Eingabe mit Toleranzen, Prüfung unverändert
    const r2 = await runScript(ws2, 'neu teil "Platte A"\nquader 60 40 10\nzeichnung A4\nzeichnung allgemein ISO 2768-mK\nzeichnung freigeben\nausgaben veraltet\nalles neu berechnen', host);
    const c2 = formatConsole(r2);
    expect(c2).toMatch(/→ Blatt „Blatt 1“ als Rev\. A aus Modell r·\w{6} freigegeben.* – Ergebnis nach der Auswertung des Blatts unten/);
    expect(c2).toMatch(/✓ Zeichnung: Blatt „Blatt 1“ ohne Befund ausgewertet/);
    expect(c2).toMatch(/Veraltete Ausgaben: keine/);
  }, 240_000);
});
