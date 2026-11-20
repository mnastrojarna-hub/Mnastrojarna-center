/**
 * Vlna 22, bod 12 – identita běhu v protokolu a soubor s revizí modelu:
 *  * `RunReport.run = { id, inputRev, state }` (JSON, HTTP, prohlížeč), Σ `run=<id>` na konci řádku; hlavička MNCAD/1 beze změny
 *    (gramatika je ukotvená – dnešní parsery ji čtou dál), řádek F `rev=r·…`;
 *  * zrušený běh (signál – Zrušit běh v konzoli, `window.mncad.cancelRun`, `run(text, { signal })`) skončí ✗ run.cancelled
 *    a dokument se nezmění;
 *  * projekt .mncad nese `modelRev` (uložení z jasně určeného stavu – kritik: krok 5 bodu 12 neměl test).
 */
import { describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import { embedBlobs } from "../blobs";
import { emptyDoc, type CadDoc, type Feature } from "../types";
import { projectFile } from "./files";
import type { EngineHost } from "./host";
import { memoryFileSink, memoryFileSource } from "./host";
import { MemoryWorkspace } from "./memory-workspace";
import { fileLine, finalizeReport, grammarKind, ReportBuilder, sigmaLine } from "./protocol";
import { projectJson, savedModelRev, savedRevMismatch, stripModelRev } from "./project-json";
import { modelRev } from "./result-key";
import { runScript } from "./run";
import { checkRunOptions } from "./run-protocol";

const part = (h = 10): CadDoc => ({ ...emptyDoc("Deska A"), features: [{ id: "f1", name: "Kvádr", type: "box", size: [20, 10, h], position: [0, 0, 0] } as unknown as Feature] });

describe("identita běhu v protokolu", () => {
  it("Σ končí run=<id>, hlavička beze změny, každý řádek projde gramatikou; JSON nese run.inputRev", () => {
    setLang("cs");
    const rb = new ReportBuilder({ lang: "cs", lines: 1 });
    rb.run = { id: "r12", inputRev: "k1@r·a1b2c3", state: "done" };
    const r = finalizeReport(rb.finish({ docs: [], files: [{ name: "a.step", format: "step", bytes: 10, sha256: "00", doc: "A", modelRev: "r·a1b2c3", check: { ok: true, text: "ok" } }] }));
    const lines = r.protocol.split("\n");
    expect(lines[0]).toMatch(/^MNCAD\/1 OK lines=1 ops=0 err=0 warn=0 note=0 t=[\d.]+$/);
    expect(lines.at(-1)).toMatch(/^Σ docs=0 files=1 .*run=r12$/);
    expect(lines.find((l) => l.startsWith("F "))).toBe('F step "a.step" 10B check=ok rev=r·a1b2c3');
    for (const l of lines) expect(grammarKind(l), l).not.toBeNull();
    expect(r.run).toEqual({ id: "r12", inputRev: "k1@r·a1b2c3", state: "done" });
    expect(JSON.parse(JSON.stringify(r)).run.inputRev).toBe("k1@r·a1b2c3");
  });

  it("bez identity (starší volající) se Σ ani F nemění", () => {
    const r = new ReportBuilder({ lang: "cs", lines: 1 }).finish({});
    expect(sigmaLine(r)).not.toMatch(/run=/);
    expect(fileLine({ name: "a.step", format: "step", bytes: 1, sha256: "", doc: "" })).toBe('F step "a.step" 1B');
  });

  it("run(text, { signal }) – volba se kontroluje (jiný objekt = chyba, ne tiché ignorování)", () => {
    const ac = new AbortController();
    expect(checkRunOptions({ signal: ac.signal }).signal).toBe(ac.signal);
    expect(() => checkRunOptions({ signal: {} })).toThrow(/AbortSignal/);
    expect(() => checkRunOptions({ protocoll: "short" })).toThrow(/protocol, budget, notes, signal/);
  });
});

describe("zrušený běh (signál)", () => {
  it("zrušení před první operací: ✗ run.cancelled, žádný řádek se neprovede, dokument beze změny", async () => {
    setLang("cs");
    const ws = new MemoryWorkspace();
    const before = JSON.stringify(ws.present());
    const host: EngineHost = { kernel: {} as never, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => 0 };
    const ac = new AbortController();
    ac.abort();
    const r = await runScript(ws, 'nový díl "Deska A"\nkvádr 20 10 10', host, { signal: ac.signal });
    expect(r.entries.some((e) => e.code === "run.cancelled")).toBe(true);
    expect(r.entries.some((e) => e.level === "ok")).toBe(false); // žádné ✓ za neprovedené řádky
    expect(r.console).toMatch(/✗ Výpočet zrušen – dokument zůstal beze změny\./);
    expect(JSON.stringify(ws.present())).toBe(before);
  });
});

describe("projekt .mncad s revizí modelu", () => {
  it("soubor nese modelRev = revize modelu, stejná v textovém `uložit` (projectFile) i v aplikaci (projectJson)", () => {
    const d = part();
    const p = projectJson(d);
    const saved = JSON.parse(p.json);
    expect(savedModelRev(saved)).toBe(p.modelRev);
    expect(p.modelRev).toBe(modelRev(embedBlobs(d) as unknown as CadDoc));
    const f = projectFile(d, "Deska A.mncad");
    expect(f.modelRev).toBe(p.modelRev);
    expect(new TextDecoder().decode(f.data)).toBe(p.json);
    expect(projectJson(part(12)).modelRev).not.toBe(p.modelRev);
  });
  it("při otevření se revize z dokumentu odebere; ručně upravený soubor se pozná", () => {
    const p = JSON.parse(projectJson(part()).json);
    const opened = stripModelRev(p);
    expect("modelRev" in opened).toBe(false);
    expect(savedRevMismatch(p)).toBeNull();
    p.features[0].size = [20, 10, 99];
    expect(savedRevMismatch(p)).toMatchObject({ saved: savedModelRev(p) });
    // opakované uložení otevřeného souboru dá znovu správnou revizi (stará se nepřenese)
    expect(projectJson({ ...p } as CadDoc).modelRev).toBe(modelRev(stripModelRev(p) as CadDoc));
  });
});
