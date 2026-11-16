/**
 * Engine se skutečným jádrem in-process (oprava po recenzi B2): strojová část výpisů `=` stejná v cs/en/de (měření, stav,
 * výkres), stav vazeb sestavy otevřené bez příkazu vazby (stav i řádek D v CLI), stav nové sestavy v témže běhu
 * (`= status` = řádek D), `pohyb export csv` bez aplikace = soubor.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getLang, setLang, type CadLang } from "../i18n";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import { summarize } from "../cli/job";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./host";
import { MemoryWorkspace } from "./memory-workspace";
import { docLine, formatConsole, formatShort, GRAMMAR, ReportBuilder } from "./protocol";
import type { RunReport } from "./protocol-types";
import { runScript } from "./run";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");

const PARTS = "nový díl Deska\nkvádr 80 60 10\ndíra 10,5 skrz v 40 30\nnový díl Čep\nválec 10 30";
const ASM = `${PARTS}\nnová sestava Uložení\nvložit "Deska" ukotvit\nvložit "Čep" v 100 0 0\nsestava vazba souosost "Čep" Ø10 "Deska" Ø10,5\nsestava vazba kontakt "Čep" spodní "Deska" horní`;
/** první řádky výpisů `=` stručného protokolu */
const measures = (r: RunReport) =>
  formatShort(r, { budget: Infinity })
    .split("\n")
    .filter((l) => l.startsWith("= "));

describe("engine se skutečným jádrem (recenze B2)", async () => {
  const lang0 = getLang();
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const hostOf = (): EngineHost & { files: ReturnType<typeof memoryFileSink> } => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });

  it("výpisy `=` (měření, stav, výkres): strojová část bajtově stejná v cs / en / de, čísla s tečkou, každý řádek projde gramatikou", async () => {
    const script = `${ASM}\nměřit Čep:těleso\nměřit Deska:F7 Deska:F3\nvýkres A3 na šířku pohledy přední,horní\nvýkres stav\nstav`;
    const out: Partial<Record<CadLang, string[]>> = {};
    try {
      for (const lang of ["cs", "en", "de"] as const) {
        setLang(lang);
        const r = await runScript(new MemoryWorkspace(), script, hostOf(), { lang });
        out[lang] = measures(r);
        for (const l of formatShort(r, { budget: Infinity }).split("\n")) expect(Object.values(GRAMMAR).some((re) => re.test(l)), l).toBe(true);
      }
    } finally {
      setLang(lang0);
    }
    const cs = out.cs!;
    expect(out.en).toEqual(cs);
    expect(out.de).toEqual(cs);
    expect(cs[0]).toBe('= L11 measure "Uložení" comp="Čep" V=2.356cm3 m=0.0185kg area=1099.557mm2 bbox=10x10x30 min=35,25,10 max=45,35,40 com=40,30,25 rho=7.85 faces=3 edges=3 vertices=2 solids=1');
    expect(cs[1]).toMatch(/^= L12 measure "Uložení" a=Deska:F7 b=Deska:F3 dist=0mm .* angle=90deg angle\.kind=linePlane parallel=0 perpendicular=1$/);
    expect(cs[2]).toBe('= L14 drawing "Uložení" sheet=1/1 format=A3 orient=landscape scale=auto');
    expect(cs[3]).toBe('= L15 status "Uložení" asm comp=2 parts=2 mates=2/2 V.sum=49.49cm3 m=0.39kg bbox=80x60x40 sheets=1 clash=-');
    expect(cs).toHaveLength(4);
    for (const l of cs) expect(l.replace(/=[\d.,-]+(?= |$)/g, "")).not.toMatch(/\d,\d/); // desetinná čárka nikde (čárka jen mezi složkami vektoru)
  }, 240_000);

  it("nová sestava v témže běhu: `= status` a řádek D CLI mají stejné vazby, objem Σ a hmotnost; konzole stav s vazbami a Σ", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, `${ASM}\nkolize\nstav`, hostOf());
    expect(formatConsole(r)).toMatch(/^Vazby: 2 \(2 ok\)\nSestava: 2 komponent \(2 dílů po rozložení podsestav\) · obálka 80 × 60 × 40 mm · objem Σ 49,49 cm³ · hmotnost Σ 0,388 kg\nKolize: žádné/m);
    const st = r.entries.find((e) => e.code === "status")!;
    const d = await summarize(ws.present(), kernel, new ReportBuilder({ lang: "cs", lines: 1 }), true, ws, ws.docKey());
    // po `kolize` nese řádek D i třídy kolizí (balík B5); stav má počet kolizí `clash=N` za obálkou
    expect(docLine(d.summary)).toBe('D "Uložení" asm comp=2 parts=2 mates=2/2 V.sum=49.49cm3 V.union=49.49cm3 m=0.39kg bbox=80x60x40 clash=0(thread=0,real=0)');
    expect(st.text.startsWith(docLine(d.summary).replace(/^D "Uložení" /, "").replace(/ V\.union=\S+/, "").replace(/ clash=\S+$/, ""))).toBe(true);
  }, 240_000);

  it("sestava otevřená z JSON bez příkazu vazby: stav vazeb se přepočítá (stav i řádek D CLI s mates=)", async () => {
    const ws0 = new MemoryWorkspace();
    await runScript(ws0, ASM, hostOf());
    const json = JSON.stringify(ws0.present());
    const ws = new MemoryWorkspace();
    await runScript(ws, json, hostOf());
    const r = await runScript(ws, "stav", hostOf());
    expect(formatConsole(r)).toMatch(/^Vazby: 2 \(2 ok\)$/m);
    const ws2 = new MemoryWorkspace();
    await runScript(ws2, json, hostOf());
    const d = await summarize(ws2.present(), kernel, new ReportBuilder({ lang: "cs", lines: 1 }), true, ws2, ws2.docKey());
    expect(d.summary.mates).toEqual({ total: 2, ok: 2, conflict: 0, missing: 0, suppressed: 0 });
  }, 240_000);

  it("`pohyb export csv` bez aplikace: soubor <sestava>-pohyb.csv (řádek F), výpis CSV v protokolu zůstává", async () => {
    const host = hostOf();
    const r = await runScript(new MemoryWorkspace(), 'nový díl Vodítko\nkvádr 100 20 10\nnový díl Jezdec\nkvádr 20 20 10\nnová sestava Pohyb\nvložit "Vodítko" ukotvit\nvložit "Jezdec" v 0 0 10\nsestava vazba vzdálenost "Jezdec" -X "Vodítko" -X hodnota 10\npohyb motor lineární vazba 1 10..50 kroky 4\npohyb export csv', host);
    const f = host.files.files.get("Pohyb-pohyb.csv");
    expect(f?.file).toMatchObject({ format: "csv", doc: "Pohyb" });
    const csv = new TextDecoder().decode(f!.data).replace(/^﻿/, "");
    expect(csv.trimEnd().split("\r\n")).toHaveLength(6); // hlavička + 5 kroků
    expect(formatConsole(r)).toMatch(/^CSV pohybové studie \(5 řádků\):$/m);
  }, 240_000);
});
