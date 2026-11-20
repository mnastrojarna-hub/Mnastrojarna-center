/**
 * Výstupy textem se skutečným jádrem in-process (balík B3) – stejná cesta jako CLI / `mncad serve` (FileSink v paměti):
 * `uložit`, `export step` s kontrolou znovunačtením a se stejnými bajty při opakování, `… base64`, `výkres export pdf
 * dokument` = jedno PDF všech listů včetně výkresů dílů z komponent (každý díl jednou; stránek = listů), sestava
 * s kusovníkem a balónky na listu, `--formats` (`writeDocFormat`), `sdílet` bez úložiště (⚠ + řádek O) a `odkaz`.
 * STEP dílu i sestavy navíc projde NEZÁVISLOU kontrolou (scripts/cad-harness/step-check.ts, vlna 22 bod 22c).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import type { CadDoc } from "../types";
import { documentSheets, sheetCacheScope, writeDocFormat, type OutNote } from "./files";
import { memoryFileSink, memoryFileSource, sha256Hex, type EngineHost } from "./host";
import { MemoryWorkspace } from "./memory-workspace";
import { formatShort, GRAMMAR } from "./protocol";
import { runScript } from "./run";
import { clearDrawingMemo } from "./sheet-eval";
import { stepCheck, stepCheckProblems } from "../../../scripts/cad-harness/step-check";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");
/** počet stránek PDF (objekty /Type /Page, ne /Pages) – jako e2e cad-w13-docs */
const pdfPages = (u: Uint8Array) => (Buffer.from(u).toString("latin1").match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;

describe("výstupy textem se skutečným jádrem (B3)", async () => {
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const hostOf = (): EngineHost & { files: ReturnType<typeof memoryFileSink> } => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });

  it("uložit, export step (kontrola, stejné bajty při opakování), export step base64, výkres export pdf", async () => {
    const host = hostOf();
    const script = ["nový díl Deska", "kvádr 80 60 10", "díra 10,5 skrz v 40 30", "uložit", "export step", "export step jako Deska-2", "export step base64", "výkres A3 na šířku pohledy přední,horní", "výkres nepředepsané ISO 2768-mK", "výkres export pdf"].join("\n");
    const r = await runScript(new MemoryWorkspace(), script, host);
    const bad = r.entries.filter((e) => e.level === "error" || e.level === "warn");
    expect(bad, JSON.stringify(bad)).toEqual([]);
    const f = host.files.files;
    expect([...f.keys()].sort()).toEqual(["Deska-2.step", "Deska.mncad", "Deska.step", "Deska_vykres.pdf"]);
    const step = f.get("Deska.step")!;
    expect(step.file.check).toMatchObject({ ok: true });
    expect(step.file.check!.text).toMatch(/^kontrola STEP: soubor znovu načten jádrem – těles: 1, objem/);
    expect(f.get("Deska-2.step")!.file.check!.text).toMatch(/\(model od minulé kontroly beze změny\)$/);
    // nezávislá kontrola (vlna 22, 22c – vlastní kontrola aplikace dřív prošla i se 0 solidy): jiná instance OCCT, prostá
    // čtečka STEP, přesný BRepCheck – 1 těleso, žádné volné skořepiny / plochy, platné
    expect(stepCheckProblems(await stepCheck(step.data), { solids: 1 })).toEqual([]);
    // stejný model → stejné bajty (pevný čas v hlavičce STEP)
    expect(step.file.sha256).toBe(f.get("Deska-2.step")!.file.sha256);
    expect(Buffer.from(step.data).toString("latin1")).toMatch(/FILE_NAME\('[^']*','2000-01-01T00:00:00'/);
    expect(Buffer.from(f.get("Deska-2.step")!.data).toString("latin1")).toMatch(/PRODUCT\('Open CASCADE STEP translator [\d.]+ 1'/); // pořadí exportu v procesu → 1
    // base64: soubor se nezapsal, obsah je v záznamu `= … file` (detail + data) a v konzoli řádek BASE64
    const b = r.entries.find((e) => e.code === "file")!;
    const data = b.data as { name: string; bytes: number; sha256: string; base64: string };
    expect(data.name).toBe("Deska.step");
    expect(data.sha256).toBe(step.file.sha256);
    expect(Buffer.from(data.base64, "base64")).toEqual(Buffer.from(step.data));
    expect(b.detail).toBe(data.base64);
    expect(b.text).toBe(`name="Deska.step" format=step bytes=${data.bytes} sha256=${data.sha256} base64=${data.base64.length}`);
    expect(r.console).toMatch(new RegExp(`^BASE64 "Deska\\.step" ${data.bytes}B [A-Za-z0-9+/=]+$`, "m"));
    const short = formatShort(r);
    expect(short).toContain(`= L7 file "Deska" name="Deska.step" format=step bytes=${data.bytes}`);
    expect(short).not.toContain(data.base64.slice(0, 40)); // base64 jen v plném protokolu a JSON
    // konzole: tytéž řádky jako w11
    expect(r.console).toMatch(/^✓ uloženo: Deska\.mncad · [\d,]+ (B|kB) · projekt Mnástrojárna CAD \(\.mncad\) – staženo \(bez dialogu\)$/m);
    expect(r.console).toMatch(/^ {2}✓ kontrola STEP: soubor znovu načten jádrem – těles: 1, .* → věrná kopie modelu$/m);
    expect(r.console).toMatch(/^✓ výkres PDF: Deska_vykres\.pdf · [\d,]+ kB · výkres PDF – staženo \(bez dialogu\)$/m);
    expect(pdfPages(f.get("Deska_vykres.pdf")!.data)).toBe(1);
  }, 240_000);

  it("sestava: export step – kontrola aplikace i NEZÁVISLÁ kontrola STEP (3 tělesa, bez volných ploch, přesně platné)", async () => {
    const host = hostOf();
    const script = ["nový díl Deska", "kvádr 80 60 10", "nový díl Čep", "válec 10 30", "nová sestava Uložení", 'vložit "Deska" ukotvit', 'vložit "Čep" v 100 0 0', 'vložit "Čep" v 150 0 0', "export step"].join("\n");
    const r = await runScript(new MemoryWorkspace(), script, host);
    expect(r.entries.filter((e) => e.level === "error" || e.level === "warn")).toEqual([]);
    const step = [...host.files.files.values()].find((x) => x.file.format === "step")!; // název souboru bez diakritiky (plainName)
    expect(step.file.check).toMatchObject({ ok: true });
    expect(step.file.check!.text).toMatch(/těles: 3, .* → věrná kopie modelu$/);
    const c = await stepCheck(step.data);
    expect(stepCheckProblems(c, { solids: 3 })).toEqual([]);
    expect(c.freeShells + c.freeFaces).toBe(0);
  }, 240_000);

  it("sestava: výkres export pdf dokument i vše = list sestavy + výkresy dílů z komponent (každý díl jednou), stránek = listů; list 1 = jen list sestavy", async () => {
    const host = hostOf();
    const ws = new MemoryWorkspace();
    const script = [
      "nový díl Deska",
      "kvádr 80 60 10",
      "výkres A4",
      "nový díl Čep",
      "válec 10 30",
      "výkres A4",
      "nová sestava Uložení",
      'vložit "Deska" ukotvit',
      'vložit "Čep" v 100 0 0',
      'vložit "Čep" v 150 0 0',
      "výkres A3 na šířku",
      "výkres export pdf dokument",
      "výkres export pdf vše jako Vse",
      "výkres export pdf list 1",
      "výkres export dxf dokument",
    ].join("\n");
    const r = await runScript(ws, script, host);
    expect(r.entries.filter((e) => e.level === "error"), JSON.stringify(r.entries.filter((e) => e.level === "error"))).toEqual([]);
    const all = host.files.files.get("Ulozeni_vykresy.pdf")!;
    expect(all, [...host.files.files.keys()].join(", ")).toBeTruthy();
    expect(pdfPages(all.data)).toBe(3);
    expect(all.file.sheets).toBe(3);
    expect(r.console).toMatch(/^✓ výkres PDF, listů 3: Ulozeni_vykresy\.pdf · /m);
    // „vše“ u sestavy s výkresy dílů = všechny listy (kontrakt B3: vícestránkové PDF), ne jen list sestavy
    expect(pdfPages(host.files.files.get("Vse.pdf")!.data)).toBe(3);
    expect(r.console).toMatch(/^✓ výkres PDF, listů 3: Vse\.pdf · /m);
    const one = [...host.files.files.values()].find((x) => !["Ulozeni_vykresy.pdf", "Vse.pdf"].includes(x.file.name) && x.file.format === "pdf")!;
    expect(pdfPages(one.data)).toBe(1);
    // DXF všech listů: ZIP „<základ>_dxf.zip“ (bez „_vykres_dxf_listy“)
    expect(host.files.files.get("Ulozeni_vykresy_dxf.zip")?.file.sheets).toBe(3);
    // list sestavy s kusovníkem a balónky (doplňky razítka z postavených dílů) – víc textů než bez nich
    const asm = ws.present();
    expect(asm.kind).toBe("assembly");
    const sheets = await documentSheets({ kernel, ws }, asm);
    expect(sheets.map((s) => s.label)).toEqual(["Uložení", "Deska", "Čep"]);
    const texts = sheets[0].out.texts.map((t) => t.s);
    expect(texts).toEqual(expect.arrayContaining(["Deska", "Čep"]));
    const { renderSheet } = await import("../drawing-export");
    const bare = await renderSheet(asm, 0, (d, m, o) => kernel.drawing(d, m, o));
    expect(sheets[0].out.texts.length).toBeGreaterThan(bare.out.texts.length);
    // CLI --formats (writeDocFormat): STEP s kontrolou, jedno PDF všech listů (3 stránky), kusovník CSV, .mncad
    const sink = memoryFileSink();
    const notes: OutNote[] = [];
    const out = [];
    for (const fmt of ["step", "pdf", "csv", "mncad"] as const) out.push(...(await writeDocFormat({ kernel, files: sink }, ws, asm, fmt, (n) => notes.push(n))));
    expect(out.map((f) => f.name)).toEqual(["Uložení.step", "Uložení výkres.pdf", "Uložení kusovník.csv", "Uložení.mncad"]);
    expect(out[0].check?.ok).toBe(true);
    expect(out[1].sheets).toBe(3);
    expect(pdfPages(sink.files.get("Uložení výkres.pdf")!.data)).toBe(3);
    expect(new TextDecoder().decode(sink.files.get("Uložení kusovník.csv")!.data)).toMatch(/Čep;[^;]*;2;/);
    // vlna 22, bod 19 (D1): výstup výkresu i kusovníku sestavy shrne výrobní dokumentaci (ℹ bom.docs) a vyráběné díly bez čísla
    // výkresu (⚠ bom.make-incomplete) – Deska a Čep tu číslo nemají; nic jiného (STEP, .mncad) hlášku nepřidá
    const docNotes = [{ code: "bom.docs", args: ["vyráběné 2, normálie 0, nakupované 0"] }, { code: "bom.make-incomplete", args: ["Deska (bez čísla), Čep (bez čísla)"] }];
    expect(notes.filter((n) => n.code !== "drawing.warning")).toEqual([...docNotes, ...docNotes]);
    // opakovaný STEP sestavy: stejné bajty
    const again = await writeDocFormat({ kernel, files: sink }, ws, asm, "step", () => undefined);
    if (process.env.MNCAD_PROBE_DIR) {
      fs.writeFileSync(path.join(process.env.MNCAD_PROBE_DIR, "asm-a.step"), sink.files.get(out[0].name)!.data);
      fs.writeFileSync(path.join(process.env.MNCAD_PROBE_DIR, "asm-b.step"), sink.files.get(again[0].name)!.data);
    }
    expect(again[0].sha256).toBe(out[0].sha256);
    expect(await sha256Hex(sink.files.get(again[0].name)!.data)).toBe(out[0].sha256);
  }, 300_000);

  it("regrese: listy spočítané v běhu (sheetCacheScope) převezme další výstup téhož dokumentu; mimo rozsah se počítají znovu", async () => {
    const ws = new MemoryWorkspace();
    await runScript(ws, "nový díl Deska\nkvádr 80 60 10\nvýkres A4", hostOf());
    const d = ws.present();
    clearDrawingMemo(); // list vyhodnocený na konci běhu (drawing-track.ts) by jinak první výpočet převzal z paměti jádra
    let calls = 0;
    const counting = new Proxy(kernel, {
      get(t, p) {
        if (p === "drawing") return (...a: Parameters<typeof kernel.drawing>) => (calls++, t.drawing(...a));
        const v = (t as unknown as Record<string | symbol, unknown>)[p];
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const close = sheetCacheScope();
    let first = 0;
    try {
      await documentSheets({ kernel: counting, ws }, d);
      first = calls;
      expect(first).toBeGreaterThan(0);
      await writeDocFormat({ kernel: counting, files: memoryFileSink() }, ws, d, "pdf", () => undefined);
      expect(calls).toBe(first); // --formats pdf po `výkres export pdf dokument`: bez druhého výpočtu
      clearDrawingMemo(); // tatáž geometrie by si výsledek jádra vzala z drawingMemo – tady jde o paměť hotových listů
      await documentSheets({ kernel: counting, ws }, { ...d, name: "Deska 2" });
      expect(calls).toBe(2 * first); // jiný dokument = nový výpočet
    } finally {
      close();
    }
    // výsledky jádra pro list si pamatuje i drawingMemo (sheet-eval.ts, klíč = geometrie + popis + volby listu – vyhodnocení
    // bloku `výkres …` a export téhož listu); tady jde o hotové listy (razítko, šablona) mimo rozsah běhu
    clearDrawingMemo();
    await documentSheets({ kernel: counting, ws }, d);
    expect(calls).toBe(3 * first); // mimo rozsah (prohlížeč) se hotové listy nedrží
  }, 120_000);

  it("regrese: --formats pdf bez výkresu = ⚠ drawing.default-sheet (jako `výkres export pdf`); DXF dokumentu s jedním listem = „<základ>.dxf“", async () => {
    const host = hostOf();
    const ws = new MemoryWorkspace();
    // nepředepsané tolerance v razítku – bez nich export listu hlásí ⚠ drawing.warning (vlna 15, razítko)
    const r = await runScript(ws, "nový díl Deska\nkvádr 80 60 10\nvýkres A4\nvýkres nepředepsané ISO 2768-mK\nvýkres export pdf dokument\nvýkres export dxf dokument", host);
    expect(r.entries.filter((e) => e.level === "error" || e.level === "warn")).toEqual([]);
    expect([...host.files.files.keys()].sort()).toEqual(["Deska_vykresy.dxf", "Deska_vykresy.pdf"]);
    const ws2 = new MemoryWorkspace();
    await runScript(ws2, "nový díl Kostka\nkvádr 20 20 20", hostOf());
    const notes: OutNote[] = [];
    const out = await writeDocFormat({ kernel, files: memoryFileSink() }, ws2, ws2.present(), "pdf", (n) => notes.push(n));
    expect(out.map((f) => f.sheets)).toEqual([1]);
    // výchozí list nemá nepředepsané tolerance – ⚠ drawing.warning jako u `výkres export pdf` (vlna 15, razítko)
    expect(notes.map((n) => n.code)).toEqual(["drawing.default-sheet", "drawing.warning"]);
  }, 120_000);

  it("regrese: 2D výkres s entitami jde sdílet; výkres export / export step na 2D výkresu = ✗ s důvodem", async () => {
    const host = hostOf();
    const r = await runScript(new MemoryWorkspace(), "2d nový Plech\n2d čára 0,0 100,0 @0,50 @-100,0 uzavřít\nsdílet odkazem\nvýkres export pdf\nexport step", host);
    const bad = r.entries.filter((e) => e.level === "error" || e.level === "warn");
    expect(bad.map((e) => `${e.line}:${e.code}`)).toEqual(["4:op.failed", "5:op.failed"]);
    expect(bad[0].text).toMatch(/„Plech“ je 2D výkres – exportuje se příkazem „2d export dxf“/);
    expect(bad[1].text).toMatch(/2D výkres nemá 3D model pro STEP/);
    expect(r.share?.mode).toBe("link");
  }, 120_000);

  it("sdílet bez nastaveného úložiště: dlouhý odkaz, řádek O mode=link; sdílet úložiště = ✗ share.store-unavailable; odkaz = řádek O", async () => {
    const r = await runScript(new MemoryWorkspace(), "nový díl Deska\nkvádr 80 60 10\nsdílet\nsdílet úložiště\nodkaz", hostOf());
    expect(r.entries.filter((e) => e.level === "error" || e.level === "warn").map((e) => `${e.line}:${e.code}`)).toEqual(["4:share.store-unavailable"]);
    expect(r.share?.mode).toBe("link");
    const short = formatShort(r);
    expect(short).toMatch(/^O \S+#s=1d\.\S+ exp=\d{4}-\d{2}-\d{2} mode=link$/m);
    for (const l of short.split("\n")) expect(Object.values(GRAMMAR).some((re) => re.test(l)), l).toBe(true);
    expect(r.console).toMatch(/^✓ sdílený odkaz vytvořen – „Deska“ \(model\), platí do: .*, bez hesla, .* v odkazu$/m);
    expect(r.console).toMatch(/^✓ poslední sdílený odkaz – „Deska“/m);
    // bez schránky (CLI) žádný řádek o schránce
    expect(r.console).not.toMatch(/schránk/);
  }, 120_000);

  it("prázdný díl, PNG v Node a dokument bez výkresu: ✗ s kódem / ⚠ drawing.default-sheet", async () => {
    const host = hostOf();
    const r = await runScript(new MemoryWorkspace(), "nový díl Kostka\nkvádr 20 20 20\nvýkres export png\nvýkres export pdf\nexport step jako ../../ven", host);
    const codes = r.entries.filter((e) => e.level === "error" || e.level === "warn").map((e) => `${e.line}:${e.code}`);
    // výchozí list nemá nepředepsané tolerance – export to řekne ⚠ drawing.warning (vlna 15, razítko)
    expect(codes).toEqual(["3:host.app-only", "4:drawing.default-sheet", "4:drawing.warning"]);
    expect([...host.files.files.keys()].sort()).toEqual(["Kostka_vykres.pdf", "_.._ven.step"]); // název bez cesty (jako w11), soubor zůstal ve výstupu
    const empty = await runScript(new MemoryWorkspace(), "nový díl Prázdný\nexport step\nuložit\nsdílet", hostOf());
    expect(empty.entries.filter((e) => e.level === "error").map((e) => `${e.line}:${e.code}`)).toEqual(["2:op.failed", "4:op.failed"]);
    void (null as unknown as CadDoc);
  }, 120_000);
});
