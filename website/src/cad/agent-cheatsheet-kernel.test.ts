/**
 * Tahák pro agenty ve skutečném jádře (oprava po recenzi vlny E): příkazy taháku jdou za sebou jako JEDEN skript –
 * `cheatSequence(lang)` proběhne enginem se skutečným jádrem bez jediného ✗ a ⚠, česky, anglicky i německy, a dá ve všech
 * třech jazycích stejný výsledek (deska s dírami, čep, sestava s vazbami, pružinou, motorem a šroubem, výkres dílu na dvou
 * listech, soubory). Zvlášť se zkouší ukázky za „Jinde:“ – každá ve vlastním malém kontextu.
 *
 * Proč nestačí rozbor (agent-cheatsheet.test.ts): anglické `insert "Plate" at 0 0 0 fix as "D1"` se přečetlo, ale při běhu
 * skončilo ✗ (engine zná `fixed`); `výkres řez XZ` na desce od Y = 0 minul těleso; přejmenování přezdívky uprostřed taháku
 * rozbilo další řádky; lineární motor mířil na vazbu Kontakt; funkční rozměr 26,5 na dílu nebyl; vazba ve skice čekala úsečku.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cheatElsewhere, cheatSequence, type CheatLang } from "./agent-cheatsheet";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./engine/host";
import { MemoryWorkspace } from "./engine/memory-workspace";
import { formatShort } from "./engine/protocol";
import type { RunReport } from "./engine/protocol-types";
import { runScript } from "./engine/run";
import { setHostAssets } from "./host-assets";
import { getLang, setLang } from "./i18n";
import { makeKernelClient } from "./kernel-client";

const WASM = path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../public/fonts");
const LANGS: CheatLang[] = ["cs", "en", "de"];

/** ✗ a ⚠ běhu jako „řádek skriptu: kód – text“ (prázdné pole = čistý běh) */
const problems = (r: RunReport, script: string[]) =>
  r.entries.filter((e) => e.level === "error" || e.level === "warn").map((e) => `${e.level === "error" ? "✗" : "⚠"} L${e.line} ${script[(e.line ?? 1) - 1] ?? ""} → ${e.code}: ${String(e.text).slice(0, 160)}`);

describe("tahák pro agenty ve skutečném jádře", async () => {
  const lang0 = getLang();
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("./kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const hostOf = (): EngineHost & { files: ReturnType<typeof memoryFileSink> } => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
  /** souhrn běhu nezávislý na jazyce: řádky D bez názvů dokumentů a počty souborů podle formátu */
  const summary: Partial<Record<CheatLang, string>> = {};

  it.each(LANGS)(
    "%s: příkazy taháku jdou za sebou jako jeden skript bez ✗ a ⚠",
    async (lang) => {
      const script = cheatSequence(lang);
      const host = hostOf();
      try {
        setLang(lang);
        const r = await runScript(new MemoryWorkspace(), script.join("\n"), host, { lang });
        expect(problems(r, script)).toEqual([]);
        expect(r.counts.errors).toBe(0);
        expect(r.counts.warnings).toBe(0);
        const short = formatShort(r, { budget: Infinity });
        const eq = short.split("\n").filter((l) => l.startsWith("= "));
        // díl: 13 prvků bez chyby (sražení se po ukázce smazalo), jedno platné těleso 100 × 60 × 12
        expect(eq.find((l) => / status /.test(l))).toMatch(/ part feat=\d+\/0\/0 .* bbox=100x60x12 .*solids=1 valid=1/);
        expect(eq.find((l) => / measure .* holes=/.test(l))).toMatch(/ holes=\d+ d=.*21x1/);
        // sestava při kontrole: deska + čep, obě vazby splněné, bez kolizí
        expect(eq.find((l) => / check .* asm /.test(l))).toMatch(/ asm comp=2 parts=2 .*mates=2\/2 clash=0\(/);
        // pohyb: lineární motor na vazbě Vzdálenost, bez konfliktu vazeb a bez kolizí v krocích
        expect(eq.find((l) => / motion /.test(l))).toMatch(/ motion steps=\d+ .*motors=1 conflicts=0 .*clash\.steps=0\//);
        // výkres dílu má dva listy (hlavní a „Detail“) a stav obou
        expect(eq.filter((l) => / drawing /.test(l)).join("\n")).toMatch(/ sheet=2\/2 /);
        // soubory: PDF výkresu, projekt, STEP se zpětnou kontrolou, textový skript, DWG 2D výkresu
        const files = [...host.files.files.values()].map((x) => x.file.format).sort();
        expect(files).toEqual(["dwg", "mncad", "pdf", "script", "step"]);
        // hledání v nápovědě z taháku vrací výsledky
        expect(eq.filter((l) => / help hits=[1-8]/.test(l)).length).toBeGreaterThanOrEqual(2);
        // odkaz ke sdílení: řádek `= L<n> link` je v každém jazyce, url nese model; délka url / bytes / chars závisí na
        // jazykových názvech prvků a popiscích děr ve sdíleném dokumentu (Kvádr 1 / Box 1, Ø9 skrz / Ø9 thru, desetinná čárka)
        const links = eq.filter((l) => / link /.test(l));
        expect(links.length).toBeGreaterThanOrEqual(1);
        for (const l of links) expect(l).toMatch(/ url=\/cad#s=\S+ mode=link .* bytes=[1-9]\d* chars=[1-9]\d* .*features=\d+/);
        /** jen tyto tři délkové údaje se nahradí – vše ostatní na řádku (mode, exp, view, pw, content, comp, parts, sheets, files, features) se porovnává */
        const linkNorm = (l: string) => (/ link /.test(l) ? l.replace(/ url=\S+/, " url=…").replace(/ bytes=\d+/, " bytes=…").replace(/ chars=\d+/, " chars=…") : l);
        // souhrn nezávislý na jazyce: strojové řádky výpisů bez názvů a bez nápovědy, soubory, počet ✓
        // `groups=<n>:<osy>:<jméno>` (kolo 7, bod 15) nese jméno vedoucí komponenty – v taháku je jazykové (Čep / Pin / Stift)
        const groupsNorm = (l: string) => l.replace(/ groups=\S+/, (g) => g.replace(/:[^:,]+(?=,|$)/g, ":…"));
        summary[lang] = [...eq.filter((l) => !/ help /.test(l)).map((l) => groupsNorm(linkNorm(l.replace(/"[^"]*"/g, '"…"')))), files.join(","), `ok=${r.entries.filter((e) => e.level === "ok").length}`].join("\n");
      } finally {
        setLang(lang0);
      }
    },
    240_000,
  );

  it("cs / en / de: stejný výsledek (dokumenty, objemy, vazby, soubory, počet ✓)", () => {
    expect(summary.cs).toBeTruthy();
    expect(summary.en).toBe(summary.cs);
    expect(summary.de).toBe(summary.cs);
  });

  /** ukázky za „Jinde:“ podle pořadí v taháku (stejné ve všech jazycích) – kontext česky (engine čte cs / en / de v každém běhu) */
  const SAMPLE = { closeTab: 0, cylinderAt: 1, sketchXZ: 2, revolve: 3, circular: 4, mirror: 5, library: 6, spring: 7, undo: 8, contact: 9, rotary: 10, drawingBom: 11, shareDays: 12, stepLink: 13, compare: 14, reference: 15, refCheck: 16 } as const;

  it.each(LANGS)(
    "%s: samostatné ukázky za „Jinde:“ fungují ve svém kontextu",
    async (lang) => {
      const e = cheatElsewhere(lang);
      expect(e).toHaveLength(Object.keys(SAMPLE).length);
      const script = [
        'nový díl "Ukázka"',
        "kvádr 100 60 12",
        e[SAMPLE.cylinderAt],
        "díra 9 skrz v 80 30",
        e[SAMPLE.circular],
        e[SAMPLE.mirror],
        'nový díl "Rotační"',
        e[SAMPLE.sketchXZ],
        e[SAMPLE.revolve],
        "stav",
        e[SAMPLE.library],
        'nový díl "Pružina"',
        e[SAMPLE.spring],
        'nový díl "Deska"',
        "kvádr 100 60 12",
        "díra 21 hloubka 8 dno ploché v 25 30",
        'nový díl "Čep"',
        "válec 20 30",
        'nová sestava "Sestava"',
        'vložit "Deska" v 0 0 0 ukotvit jako "D1"',
        'vložit "Čep" v 25 30 12 jako "K48"',
        'sestava vazba souosost "K48" Ø20 "D1" Ø21',
        e[SAMPLE.contact],
        e[SAMPLE.rotary],
        "výkres A3 pohledy přední,iso",
        e[SAMPLE.drawingBom],
        e[SAMPLE.closeTab],
      ];
      try {
        setLang(lang);
        const r = await runScript(new MemoryWorkspace(), script.join("\n"), hostOf(), { lang });
        expect(problems(r, script)).toEqual([]);
        // rotace obdélníku 10 × 30 kolem Z = válec Ø20 × 30
        expect(formatShort(r, { budget: Infinity })).toMatch(/^= L10 status "Rotační" part feat=2\/0\/0 V=9\.42cm3 .* bbox=20x20x30/m);
      } finally {
        setLang(lang0);
      }
      // mimo zkoušku zůstávají jen ukázky, které potřebují něco mimo engine: historii předchozího běhu, úložiště odkazů
      // na síti a vstupní soubory zákazníka – jejich zápis hlídá rozbor (agent-cheatsheet.test.ts)
      expect([SAMPLE.undo, SAMPLE.shareDays, SAMPLE.stepLink, SAMPLE.compare, SAMPLE.reference, SAMPLE.refCheck].map((i) => typeof e[i])).toEqual(Array(6).fill("string"));
    },
    240_000,
  );
});
