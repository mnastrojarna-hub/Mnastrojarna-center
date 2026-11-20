/**
 * Balík B5 (CAD-HEADLESS-NAVRH.md kap. 6): `kontrola` (P4 jako test – tabulka děr se sloučenými souosými úseky, závit,
 * zahloubení, dno; ⚠ check.hole-missing), `kontrola sestava` (V.sum i V.union, kolize po třídách), `kolize` s geometrickým
 * zařazením šroub × závit a `porovnat` (vlastní STEP = shoda, změněný díl = ⚠ / s přísně ✗, chybějící soubor ✗) – vše
 * skutečným jádrem in-process přes engine (`runScript`), strojová část výpisů stejná v cs / en / de.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCheckLine } from "../agent-check";
import { parseAgentText } from "../agent";
import { getLang, setLang, type CadLang } from "../i18n";
import { setHostAssets } from "../host-assets";
import { LONG_OPS, makeKernelClient } from "../kernel-client";
import { summarize } from "../cli/job";
import { emptyDoc, type AsmComponent, type CadDoc, type Vec3 } from "../types";
import { clashSig, clashStale } from "../clash-class";
import type { CompareResult } from "../compare";
import { booleansInexact } from "../compare-report";
import { CliFileSource } from "../cli/file-sink";
import { attachmentStore } from "./attachments";
import { compareKv, compareOk } from "./compare-text";
import { matchInputName, memoryFileSink, memoryFileSource, type EngineHost, type FileSource } from "./host";
import { MemoryWorkspace } from "./memory-workspace";
import { docLine, formatShort, GRAMMAR, ReportBuilder } from "./protocol";
import type { RunReport } from "./protocol-types";
import { runScript } from "./run";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");

describe("rozbor kontrola / porovnat (cs, en, de)", () => {
  it("kontrola: cíle, díry, polohy; EN check, DE prüfen; neznámá volba = chyba; kontrola kót patří předloze", () => {
    expect(parseCheckLine("kontrola")).toEqual({ k: "check", cmd: { target: "active", holes: false, positions: false } });
    expect(parseCheckLine('kontrola díl "Spodní deska" díry')).toEqual({ k: "check", cmd: { target: { part: "Spodní deska" }, holes: true, positions: false } });
    expect(parseCheckLine("check assembly holes positions")).toEqual({ k: "check", cmd: { target: "assembly", holes: true, positions: true } });
    expect(parseCheckLine("prüfen alle")).toEqual({ k: "check", cmd: { target: "all", holes: false, positions: false } });
    expect(parseCheckLine("prüfen teil „Platte 1“ positionen")).toEqual({ k: "check", cmd: { target: { part: "Platte 1" }, holes: true, positions: true } });
    expect(() => parseCheckLine("kontrola nesmysl")).toThrow(/neznámá volba „nesmysl“/);
    expect(() => parseCheckLine("kontrola sestava vše")).toThrow(/jen jeden cíl/);
    expect(parseCheckLine("kontrola kót pohled přední")).toBeNull();
    expect(parseCheckLine("porovnat předloha pohled přední")).toBeNull();
    expect(parseCheckLine("kvádr 10 20 30")).toBeNull();
    // celý skript: řádek kontroly je operace `check` s číslem řádku
    expect(parseAgentText("kvádr 10 20 30\nkontrola díry").ops[1]).toEqual({ k: "check", cmd: { target: "active", holes: true, positions: false }, line: 2 });
  });

  it("porovnat: soubor, tolerance s čárkou, zarovnat, cíl, mapa, přísně; EN compare, DE vergleichen", () => {
    expect(parseCheckLine('porovnat "ref díl.step"')).toEqual({ k: "compare", cmd: { file: "ref díl.step", tolerance: 0.1, align: "none", target: "active", map: true, strict: false } });
    expect(parseCheckLine('porovnat ref.step tolerance 0,05 zarovnat střed díl "A" mapa ne přísně')).toEqual({ k: "compare", cmd: { file: "ref.step", tolerance: 0.05, align: "center", target: { part: "A" }, map: false, strict: true } });
    expect(parseCheckLine("compare ref.stp tolerance 0.02 align none assembly map no strict")).toEqual({ k: "compare", cmd: { file: "ref.stp", tolerance: 0.02, align: "none", target: "assembly", map: false, strict: true } });
    expect(parseCheckLine("vergleichen ref.step toleranz 0,2 ausrichten mitte baugruppe karte nein streng")).toEqual({ k: "compare", cmd: { file: "ref.step", tolerance: 0.2, align: "center", target: "assembly", map: false, strict: true } });
    expect(parseCheckLine("porovnat ref.step zarovnat jak je")?.cmd).toMatchObject({ align: "none" });
    expect(parseCheckLine("porovnat ref.step zarovnat auto")?.cmd).toMatchObject({ align: "auto" });
    expect(() => parseCheckLine("porovnat")).toThrow(/chybí soubor/);
    expect(() => parseCheckLine("porovnat a.step tolerance -1")).toThrow(/kladné číslo/);
    expect(() => parseCheckLine("porovnat a.step zarovnat bokem")).toThrow(/auto, střed nebo ne/);
    expect(() => parseCheckLine("porovnat a.step barva")).toThrow(/neznámá volba „barva“/);
  });

  it("porovnání: nespolehlivé booleovské operace (složené těleso sestavy) – shodu určí objem a mapa, ne falešné oblasti", () => {
    const region = { side: "extra" as const, volume: 29_000, area: 900, bbox: [[0, 0, 0], [10, 10, 10]] as [Vec3, Vec3], size: [10, 10, 10] as Vec3, center: [5, 5, 5] as Vec3, centroid: null, faces: 6, surfaces: [] };
    const side = (v: number, regions = [region]) => ({ volume: v, regions, more: { count: 0, volume: 0 }, noise: { count: 0, volume: 0 }, ms: 0 });
    const stats = (max: number) => ({ count: 100, max, maxOut: max, maxIn: -max / 3, mean: 0, rms: 0, within: 1, withinArea: 1 });
    const base = (o: Partial<CompareResult>): CompareResult =>
      ({
        model: { volume: 2_000_000, area: 1, bbox: [[0, 0, 0], [1, 1, 1]], faces: 1, solids: 40 },
        reference: { volume: 1_999_999.95, area: 1, bbox: [[0, 0, 0], [1, 1, 1]], faces: 1, solids: 40, format: "step", fileName: "sestava.step" },
        transform: { rot: [0, 0, 0], m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], mode: "none", identity: true },
        volumeDiff: 0.05,
        extra: side(30_000),
        missing: side(500, []),
        residual: 0.05 - (30_000 - 500),
        map: { stats: stats(0.028), accuracy: 0.01 } as CompareResult["map"],
        ghost: null,
        warnings: [],
        ms: { import: 0, align: 0, reference: 0, booleans: 0, map: 0, total: 0 },
        ...o,
      }) as CompareResult;
    // vlastní STEP velké sestavy: objemy sedí na 0,05 mm³, mapa v toleranci, booleovská kontrola nesedí o 29 500 mm³ → shoda
    const own = base({});
    expect(booleansInexact(own)).toBe(true);
    expect(compareOk(own, 0.1)).toBe(true);
    expect(compareKv(own, { tolerance: 0.1, align: "none" }, true)).toBe("ref=sestava.step ok=1 tol=0.1 dV=+0% dV.mm3=0.05 extra=- missing=- regions=- dev=+0.028/-0.009mm within=100% align=none booleans=inexact");
    // nespolehlivé oblasti, ale skutečný rozdíl: mapa mimo toleranci nebo rozdíl objemů nad šumem → neshoda
    expect(compareOk(base({ map: { stats: stats(0.6), accuracy: 0.01 } as CompareResult["map"] }), 0.1)).toBe(false);
    expect(compareOk(base({ volumeDiff: -900 }), 0.1)).toBe(false);
    // bez mapy rozhodne jen objem
    expect(compareOk(base({ map: null }), 0.1)).toBe(true);
    // spolehlivé booleovské operace (kontrola sedí): oblast nad prahem šumu = neshoda jako dřív
    const exact = base({ residual: 0.01, volumeDiff: 29_000, extra: side(29_000), missing: side(0, []) });
    expect(booleansInexact(exact)).toBe(false);
    expect(compareOk(exact, 0.1)).toBe(false);
    expect(compareKv(exact, { tolerance: 0.1, align: "none" }, false)).toMatch(/ extra=29000mm3 missing=0mm3 regions=1 .* align=none$/);
  });

  it("vstupní soubory: v prohlížeči, CLI i HTTP stejné pravidlo – přesně, bez cesty, bez ohledu na velikost písmen", async () => {
    expect(matchInputName("deska.step", ["deska.step"])).toBe("deska.step");
    expect(matchInputName("refs/deska.step", ["deska.step"])).toBe("deska.step");
    expect(matchInputName("C:\\data\\DESKA.STEP", ["deska.step", "jiny.step"])).toBe("deska.step");
    expect(matchInputName("DESKA.STEP", ["Deska.step", "deska.step"])).toBeNull(); // nejednoznačné
    expect(matchInputName("x.step", ["deska.step"])).toBeNull();
    // HTTP (body.files)
    const mem = memoryFileSource({ "deska.step": new Uint8Array([1]) });
    expect((await mem.read("DESKA.STEP")).name).toBe("deska.step");
    expect((await mem.read("refs/deska.step")).data).toEqual(new Uint8Array([1]));
    await expect(mem.read("jiny.step")).rejects.toThrow(/jiny\.step.*deska\.step/);
    // prohlížeč (přiložené soubory)
    const att = attachmentStore();
    att.add("deska.step", new Uint8Array([2]));
    expect((await att.read("DESKA.STEP")).data).toEqual(new Uint8Array([2]));
    expect((await att.read("refs/deska.step")).data).toEqual(new Uint8Array([2]));
    // CLI (--files DIR / složka skriptu): podsložka i jiná velikost písmen; ven ze složky nikdy
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "b5-files-"));
    try {
      fs.mkdirSync(path.join(root, "refs"));
      fs.writeFileSync(path.join(root, "refs", "deska.step"), "ref");
      fs.writeFileSync(path.join(root, "skript.txt"), "x");
      const cli = new CliFileSource([path.join(root, "refs"), root]);
      expect(new TextDecoder().decode((await cli.read("DESKA.STEP")).data)).toBe("ref");
      expect(new TextDecoder().decode((await cli.read("refs/deska.step")).data)).toBe("ref");
      expect(new TextDecoder().decode((await cli.read("jinde/deska.step")).data)).toBe("ref");
      const scriptDir = new CliFileSource([root]);
      expect(new TextDecoder().decode((await scriptDir.read("refs/deska.step")).data)).toBe("ref");
      await expect(scriptDir.read("DESKA.STEP")).rejects.toThrow(/DESKA\.STEP/); // jen soubory kořene (podsložky se neprohledávají)
      await expect(cli.read("../../etc/passwd")).rejects.toThrow(/passwd/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("třídění kolizí je dlouhá operace jádra (průběh a Zrušit v prohlížeči)", () => {
    expect(LONG_OPS.has("clashDetail")).toBe(true);
    expect(LONG_OPS.has("interference")).toBe(true);
  });

  it("otisk sestavy pro výsledek kontroly kolizí: změna polohy / vložení / skrytí = neplatný výsledek", () => {
    const d = emptyDoc("S");
    d.kind = "assembly";
    const comp = (id: string, x: number): AsmComponent => ({ id, name: id, source: { kind: "part", doc: emptyDoc(id) }, placement: { position: [x, 0, 0], rotation: [0, 0, 0] } }) as AsmComponent;
    d.components = [comp("a", 0), comp("b", 10)];
    const entry = { sig: clashSig(d) };
    expect(clashStale(entry, d)).toBe(false);
    expect(clashStale(entry, { ...d, components: [comp("a", 0), comp("b", 11)] })).toBe(true);
    expect(clashStale(entry, { ...d, components: [...d.components, comp("c", 20)] })).toBe(true);
    expect(clashStale(entry, { ...d, components: [comp("a", 0), { ...comp("b", 10), hidden: true }] })).toBe(true);
    expect(clashStale({}, { ...d, components: [] })).toBe(false); // výsledek bez otisku (starší) se nehodnotí
  });

  it("přiložené soubory: stejný název nahradí, chybějící = MissingInputError se seznamem", async () => {
    const s = attachmentStore();
    s.add("C:\\data\\Ref.step", new Uint8Array([1, 2, 3]));
    s.add("ref.STEP", new Uint8Array([4]));
    expect(s.entries()).toEqual([{ name: "ref.STEP", bytes: 1 }]);
    expect((await s.read("REF.step")).data).toEqual(new Uint8Array([4]));
    await expect(s.read("x.step")).rejects.toThrow(/x.step.*ref.STEP/);
    expect(s.remove("ref.step")).toBe(true);
    expect(s.list()).toEqual([]);
  });
});

/** P4 (kap. 1.1): deska s dírami – závit M10, průchozí Ø25, slepá Ø8, zahloubení */
const P4 = `nový díl Spodní deska
kvádr 300 200 40
díra 8,5 hloubka 25 v 30 25 40 v 90 25 40 v 150 25 40 v 210 25 40 závit M10 hloubka-závitu 20
díra 25 skrz v 15 100 40 v 285 100 40
díra 8 hloubka 20 v 60 60 40 v 240 60 40
díra 11 skrz v 150 100 40 zahloubení 18 11`;

const measures = (r: RunReport) =>
  formatShort(r, { budget: Infinity })
    .split("\n")
    .filter((l) => l.startsWith("= ") || l.startsWith("  "));

describe("kontrola, kolize, porovnat se skutečným jádrem (engine)", async () => {
  const lang0 = getLang();
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const hostOf = (inputs: FileSource = memoryFileSource({})): EngineHost & { files: ReturnType<typeof memoryFileSink> } => ({ kernel, files: memoryFileSink(), inputs, now: () => Date.now() });

  it("P4: tabulka děr – souosé úseky sloučené (zahloubení + průchod), závit a hloubka závitu, dno; stejná v cs / en / de", async () => {
    const out: Partial<Record<CadLang, string[]>> = {};
    let console0 = "";
    try {
      for (const lang of ["cs", "en", "de"] as const) {
        setLang(lang);
        const r = await runScript(new MemoryWorkspace(), `${P4}\nkontrola polohy`, hostOf(), { lang });
        out[lang] = measures(r);
        for (const l of formatShort(r, { budget: Infinity }).split("\n")) expect(Object.values(GRAMMAR).some((re) => re.test(l)), l).toBe(true);
        expect(r.counts.errors).toBe(0);
        expect(r.entries.filter((e) => e.level === "warn")).toEqual([]);
        if (lang === "cs") console0 = r.console ?? "";
      }
    } finally {
      setLang(lang0);
    }
    const cs = out.cs!;
    expect(out.en).toEqual(cs);
    expect(out.de).toEqual(cs);
    // objem: 300·200·40 − díry (vrták M10 s hrotem, 2× Ø25, 2× Ø8 s hrotem, Ø11 + zahloubení Ø18×11)
    expect(cs[0]).toMatch(/^= L7 check "Spodní deska" part V=2\d{3}\.\d+cm3 m=1\d\.\d+kg rho=7\.85 bbox=0,0,0\.\.300,200,40 solids=1 valid=1 holes=9$/);
    expect(cs[1]).toBe('= L7 check "Spodní deska" holes=9 rows=4');
    expect(cs.slice(2)).toEqual([
      "  hole d=8 depth=20 bottom=cone tip=118 n=2 at=60,60,40;240,60,40 dir=-Z",
      "  hole d=8.5 depth=25 bottom=cone tip=118 thread=M10 tdepth=20 n=4 at=30,25,40;90,25,40;150,25,40;210,25,40 dir=-Z",
      "  hole d=11 through=1 cbore=18x11 n=1 at=150,100,40 dir=-Z",
      "  hole d=25 through=1 n=2 at=15,100,40;285,100,40 dir=-Z",
    ]);
    // konzole: lokalizovaný text (desetinná čárka), tabulka děr se značkami
    expect(console0).toMatch(/Kontrola „Spodní deska“: objem 2\s?\d{3},\d+ cm³ · hmotnost 1\d,\d+ kg \(hustota 7,85 g\/cm³\) · obálka 300 × 200 × 40 mm/);
    expect(console0).toMatch(/^ {2}4× M10 ↧20 · Ø8,5 ↧25 · dno kužel 118° · směr -Z · polohy \[30; 25; 40\]/m);
    expect(console0).toMatch(/^ {2}Ø11 skrz · zahloubení Ø18 ↧11 · směr -Z/m);
    // JSON data: díl, objem, hustota, díry
    const r = await runScript(new MemoryWorkspace(), `${P4}\nkontrola`, hostOf());
    const e = r.entries.find((x) => x.code === "check" && x.data)!;
    expect(e.data).toMatchObject({ part: "Spodní deska", density: 7.85, densityAssumed: false, solids: 1, valid: true });
    expect((e.data as { holes: unknown[] }).holes).toHaveLength(4);
  }, 240_000);

  // označení bez rozpoznané třídy (B4 materialClass: EN AW-* = hliník, 1.4xxx = nerez … nastaví hustotu) – hustota zůstává předpokládaná
  it("⚠ check.hole-missing: díra zakrytá pozdějším prvkem; materiál jen označením → rho.assumed", async () => {
    const r = await runScript(new MemoryWorkspace(), "nový díl Blok\nmateriál Hardox 450\nkvádr 50 50 20\ndíra 6 hloubka 10 v 10 10 20 v 40 40 20\nkvádr 20 20 20 v 0 0 0\nkontrola", hostOf());
    const w = r.entries.filter((x) => x.code === "check.hole-missing");
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ level: "warn", line: 6, doc: "Blok" });
    expect(w[0].text).toMatch(/1 z 2 poloh/);
    expect(measures(r)[0]).toMatch(/ rho=7\.85 rho\.assumed=1 /);
  }, 240_000);

  it("kolize a kontrola sestava: šroub v závitu = ℹ clash.thread (ne ⚠), kolík v hladké díře = ⚠ clash.real; V.union = V.sum − průniky; D řádek s třídami", async () => {
    const script = `nový díl Deska
kvádr 40 40 30
díra 8,5 hloubka 25 v 20 20 30 závit M10
díra 7,9 hloubka 20 v 10 10 30
nový díl Šroub
válec 10 25
nový díl Kolík
válec 8 20
nová sestava Spoj
vložit "Deska" ukotvit
vložit "Šroub" v 20 20 5
vložit "Kolík" v 10 10 10
kolize
kontrola sestava díry`;
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, script, hostOf());
    const m = measures(r);
    expect(m[0]).toBe('= L13 clash "Spoj" total=2 thread=1 underhead=0 real=1 undetermined=0');
    // kolize + kontrola sestava hlásí tutéž dvojici: jeden sloučený záznam se dvěma řádky
    const real = r.entries.filter((e) => e.code === "clash.real");
    expect(real).toHaveLength(1);
    expect(real[0]).toMatchObject({ level: "warn", lines: [13, 14], count: 2 });
    expect(real[0].text).toMatch(/„Deska“ × „Kolík“/);
    expect(formatShort(r)).toMatch(/^⚠ L13,L14 ×2 clash\.real "Spoj": kolize „Deska“ × „Kolík“/m);
    const thread = r.entries.filter((e) => e.code === "clash.thread");
    expect(thread).toHaveLength(1);
    expect(thread[0].count).toBe(2);
    expect(thread[0]).toMatchObject({ level: "note", data: { holeIn: "a", hole: { designation: "M10", D: 10, r: 4.25 } } });
    const head = m.find((l) => l.startsWith("= L14 check"))!;
    const vs = Number(/V\.sum=([\d.]+)cm3/.exec(head)![1]);
    const vu = Number(/V\.union=([\d.]+)cm3/.exec(head)![1]);
    expect(head).toMatch(/^= L14 check "Spoj" asm comp=3 parts=3 V\.sum=[\d.]+cm3 V\.union=[\d.]+cm3 m=[\d.]+kg bbox=0,0,0\.\.40,40,30 clash=2\(thread=1,underhead=0,real=1,undetermined=0\) valid=3\/3$/);
    expect(vs - vu).toBeGreaterThan(0.5); // průnik šroubu (544,9 mm³) a kolíku
    expect(m.some((l) => /^ {2}part "Deska" n=1 V=[\d.]+cm3 /.test(l))).toBe(true);
    expect(m.some((l) => /^ {2}hole d=8\.5 depth=25 bottom=cone tip=118 thread=M10 n=1 dir=-Z$/.test(l))).toBe(true);
    // řádek D v CLI: třídy kolizí
    const d = await summarize(ws.present(), kernel, new ReportBuilder({ lang: "cs", lines: 1 }), true, ws, ws.docKey());
    expect(docLine(d.summary)).toMatch(/ V\.sum=[\d.]+cm3 V\.union=[\d.]+cm3 m=[\d.]+kg bbox=[\d.x]+ clash=2\(thread=1,real=1\)$/);
  }, 240_000);

  it("kolize po změně sestavy: stav = clash.stale=1, CLI souhrn přepočítá (ℹ clash.rechecked, ⚠ clash.real, D i V.union konečného stavu)", async () => {
    const script = `nový díl Deska
kvádr 40 40 30
díra 8,5 hloubka 25 v 20 20 30 závit M10
nový díl Šroub
válec 10 25
nový díl Kolík
válec 8 20
nová sestava Spoj
vložit "Deska" ukotvit
vložit "Šroub" v 20 20 5
kolize
vložit "Kolík" v 10 10 10
sestava komponenta "Šroub" v 21 20 5
stav`;
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, script, hostOf());
    const m = measures(r);
    expect(m[0]).toBe('= L11 clash "Spoj" total=1 thread=1 underhead=0 real=0 undetermined=0');
    expect(m.find((l) => l.startsWith("= L14 status"))).toMatch(/ clash=1\(thread=\d+,real=\d+(,undetermined=\d+)?\) clash\.stale=1$/); // vlna 22, bod 5: třídy jako v řádku D
    expect(r.console).toMatch(/Kolize: 1 – .* NEPLATÍ: sestava se od kontroly změnila/);
    const rb = new ReportBuilder({ lang: "cs", lines: 14 });
    const d = await summarize(ws.present(), kernel, rb, true, ws, ws.docKey());
    expect(docLine(d.summary)).toMatch(/ V\.sum=49\.5cm3 V\.union=47\.92cm3 m=[\d.]+kg bbox=[\d.x]+ clash=2\(thread=0,real=2\)$/);
    expect(rb.entries.find((e) => e.code === "clash.rechecked")).toMatchObject({ level: "note", doc: "Spoj", text: expect.stringMatching(/\(L11\)/) });
    expect(rb.entries.filter((e) => e.code === "clash.real").map((e) => e.text)).toEqual([expect.stringMatching(/„Deska“ × „Šroub“/), expect.stringMatching(/„Deska“ × „Kolík“/)]);
    // podruhé (beze změny) se nic nepřepočítává
    const rb2 = new ReportBuilder({ lang: "cs", lines: 14 });
    await summarize(ws.present(), kernel, rb2, true, ws, ws.docKey());
    expect(rb2.entries.filter((e) => e.code?.startsWith("clash."))).toEqual([]);
  }, 240_000);

  it("kontrola / porovnat díl „B“ z jiné záložky a komponenty: výpis i JSON patří dílu B, ne aktivní záložce", async () => {
    const beta = emptyDoc("Beta");
    for (const op of parseAgentText("kvádr 50 50 50").ops) if (op.k === "feature") beta.features.push(op.feature as never);
    const inputs = memoryFileSource({ "beta.step": new Uint8Array(await kernel.exportFile(beta, "step")) });
    const r = await runScript(new MemoryWorkspace(), 'nový díl Alfa\nkvádr 10 10 10\nnový díl Beta\nkvádr 50 50 50\nzáložka "Alfa"\nkontrola díl "Beta"\nporovnat "beta.step" díl "Beta"', hostOf(inputs));
    const m = measures(r);
    expect(m[0]).toMatch(/^= L6 check "Beta" part V=125cm3 /);
    expect(m[1]).toMatch(/^= L7 compare "Beta" ref=beta\.step ok=1 /);
    expect(r.entries.filter((e) => e.level === "measure").map((e) => e.doc)).toEqual(["Beta", "Beta"]);
    // komponenta sestavy (#n): název komponenty
    const a = await runScript(new MemoryWorkspace(), 'nový díl Deska\nkvádr 40 40 30\nnový díl Šroub\nválec 10 25\nnová sestava Spoj\nvložit "Deska" ukotvit\nvložit "Šroub" v 20 20 30\nvložit "Šroub" v 10 10 30\nkontrola díl "#3"', hostOf());
    expect(measures(a)[0]).toMatch(/^= L9 check "Šroub" part V=1\.963cm3 /);
  }, 240_000);

  it("⚠ check.hole-missing v sestavě patří dílu (doc = díl, data s dílem a prvkem)", async () => {
    const r = await runScript(new MemoryWorkspace(), 'nový díl Deska A\nkvádr 50 50 20\ndíra 6 hloubka 10 v 10 10 20\nnový díl Deska B\nkvádr 50 50 20\ndíra 6 hloubka 10 v 10 10 20\nkvádr 20 20 20 v 0 0 0\nnová sestava S\nvložit "Deska A" ukotvit\nvložit "Deska B" v 100 0 0\nkontrola vše', hostOf());
    const w = r.entries.filter((e) => e.code === "check.hole-missing");
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ level: "warn", line: 11, doc: "Deska B", data: { part: "Deska B", missing: 1, expected: 1 } });
    expect(formatShort(r)).toMatch(/^⚠ L11 check\.hole-missing "Deska B": prvek díry „Díra \d+“ nemá v geometrii díru$/m);
  }, 240_000);

  it("průchozí díra: vstup na straně polohy prvku a jeho směr; JSON díry s klíčem axis (kap. 6.1)", async () => {
    const r = await runScript(new MemoryWorkspace(), "nový díl Bok\nkvádr 40 10 40\ndíra 8,5 skrz v 20 0 20 směr 0 1 0 závit M10\ndíra 6 hloubka 5 v 10 0 10 směr 0 1 0\ndíra 5 skrz v 30 10 30 směr 0 -1 0\nkontrola polohy", hostOf());
    expect(measures(r).slice(2)).toEqual(["  hole d=5 through=1 n=1 at=30,10,30 dir=-Y", "  hole d=6 depth=5 bottom=cone tip=118 n=1 at=10,0,10 dir=+Y", "  hole d=8.5 through=1 thread=M10 n=1 at=20,0,20 dir=+Y"]);
    const holes = (r.entries.find((e) => e.code === "check" && e.data)!.data as { holes: Record<string, unknown>[] }).holes;
    expect(holes.map((h) => h.axis)).toEqual([[0, -1, 0], [0, 1, 0], [0, 1, 0]]);
    expect(holes.every((h) => !("drill" in h) && Array.isArray(h.positions))).toBe(true);
    expect(holes[2]).toMatchObject({ d: 8.5, through: true, thread: "M10", n: 1, positions: [[20, 0, 20]] });
  }, 240_000);

  it("šrouby ISO 4762 a ISO 4017 z knihovny i ze šroubového spoje: bez prstence pod hlavou – v průchozí díře a na podložce žádná kolize", async () => {
    const plates = `nový díl Horní
kvádr 60 40 10
díra 11 skrz v 20 20 10
díra 11 skrz v 40 20 10
nový díl Spodní
kvádr 60 40 30
díra 8,5 hloubka 25 v 20 20 30 závit M10
díra 8,5 hloubka 25 v 40 20 30 závit M10
nová sestava S
vložit "Spodní" ukotvit
vložit "Horní" v 0 0 30`;
    // šroubový spoj (sestava šroub): šroub ISO 4762 + podložka; jen šroub v závitu
    const j = await runScript(new MemoryWorkspace(), `${plates}\nsestava šroub "Horní" Ø11\nkolize`, hostOf());
    expect(measures(j).find((l) => l.startsWith("= L13 clash"))).toMatch(/ total=(\d+) thread=\1 underhead=0 real=0 undetermined=0$/);
    expect(j.entries.filter((e) => e.code === "clash.real")).toEqual([]);
    // normálie z knihovny v průchozí díře Ø11
    const n = await runScript(new MemoryWorkspace(), `${plates}\nnormálie M10x30 v 20 20 40\nnormálie šroub šestihranný M10x30 v 40 20 40\nkolize`, hostOf());
    expect(measures(n).find((l) => l.startsWith("= L14 clash"))).toBe('= L14 clash "S" total=2 thread=2 underhead=0 real=0 undetermined=0');
    expect(n.entries.filter((e) => e.code === "clash.real")).toEqual([]);
  }, 240_000);

  it("porovnat: vlastní STEP = shoda; změněný díl = ⚠ compare.mismatch (s přísně ✗); chybějící soubor = ✗ file.missing; sestava = složené těleso", async () => {
    const part = (t: string): CadDoc => {
      const d = emptyDoc("Deska");
      for (const op of parseAgentText(t).ops) if (op.k === "feature") d.features.push(op.feature as never);
      return d;
    };
    const plate = part("kvádr 60 40 10\ndíra 8 skrz v 20 20 10");
    const stepOf = async (d: CadDoc) => new Uint8Array(await kernel.exportFile(d, "step"));
    const inputs = memoryFileSource({ "deska.step": await stepOf(plate) });
    const same = await runScript(new MemoryWorkspace(), 'nový díl Deska\nkvádr 60 40 10\ndíra 8 skrz v 20 20 10\nporovnat "deska.step" tolerance 0,05', hostOf(inputs));
    const eq = measures(same)[0];
    expect(eq).toMatch(/^= L4 compare "Deska" ref=deska\.step ok=1 tol=0\.05 dV=[+-]0(\.\d+)?% dV\.mm3=-?[\d.]+ extra=0mm3 missing=0mm3 regions=0 dev=\+[\d.]+\/-[\d.]+mm within=100% align=none$/);
    expect(same.entries.filter((e) => e.level === "warn" || e.level === "error")).toEqual([]);
    // díra Ø10 místo Ø8 → materiál chybí oproti referenci
    const diff = await runScript(new MemoryWorkspace(), "nový díl Deska\nkvádr 60 40 10\ndíra 10 skrz v 20 20 10\nporovnat deska.step", hostOf(inputs));
    expect(measures(diff)[0]).toMatch(/ ok=0 .* regions=1 /);
    const w = diff.entries.find((e) => e.code === "compare.mismatch")!;
    expect(w.level).toBe("warn");
    expect(w.text).toMatch(/chybí 0,28\d? cm³ u \[20; 20; 5\]/);
    if (process.env.B5_LOG) fs.writeFileSync(process.env.B5_LOG, `${formatShort(diff)}\n`);
    const strict = await runScript(new MemoryWorkspace(), "nový díl Deska\nkvádr 60 40 10\ndíra 10 skrz v 20 20 10\nporovnat deska.step přísně", hostOf(inputs));
    expect(strict.entries.find((e) => e.code === "compare.mismatch")?.level).toBe("error");
    const miss = await runScript(new MemoryWorkspace(), "nový díl Deska\nkvádr 60 40 10\nporovnat jiny.step", hostOf(inputs));
    expect(miss.entries.find((e) => e.level === "error")).toMatchObject({ code: "file.missing", line: 3 });
    expect(formatShort(miss)).toMatch(/✗ L3 file\.missing .*jiny\.step.*deska\.step/);
    // sestava proti vlastnímu STEP sestavy
    const asmScript = `nový díl Deska\nkvádr 60 40 10\nnový díl Kostka\nkvádr 10 10 10\nnová sestava Dvojice\nvložit "Deska" ukotvit\nvložit "Kostka" v 70 0 0`;
    const ws = new MemoryWorkspace();
    await runScript(ws, asmScript, hostOf());
    const asmStep = await stepOf(ws.present());
    const ar = await runScript(ws, "porovnat dvojice.step sestava zarovnat ne", hostOf(memoryFileSource({ "dvojice.step": asmStep })));
    expect(measures(ar)[0]).toMatch(/^= L1 compare "Dvojice" ref=dvojice\.step ok=1 .* align=none$/);
  }, 240_000);
});
