/**
 * Vlna 22, balík C2 (bod 6 zprávy majitele – „Bez kolizí“ není kontrola provozní vůle) se skutečným jádrem in-process, engine
 * stejný jako v prohlížeči a v CLI. Repro skripty = korpus 74b / 74c (src/cad/engine/__corpus__):
 *
 *  - 74b: nůž 1 mm přejede přes kolík Ø2 mezi kroky 5 mm od sebe → dřív „Kolize: žádné ve všech krocích“, teď ⚠ clash.real
 *    „mezi kroky 17 a 18“ (spojitá kontrola); `pohyb kolize diskrétně` → výslovně „mezi polohami nekontrolováno“;
 *  - 74c: střižník Ø10 ve vedení Ø10,02 → `kolize` bez ✓ („vůle nekontrolována“), `pohyb vůle … min 0,05` → ⚠ clash.clearance
 *    0,01 mm v krocích 0–10 s místem, strojová pole `clear.*`, limit 0,005 mm dodržen „v celém pohybu (spojitě)“.
 *
 *   C2_OUT=<složka>  zapsat protokoly (důkaz pro ledger)
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../engine/host";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { formatConsole, formatShort } from "../engine/protocol";
import { runReport } from "../engine/run-protocol";
import type { RunReport } from "../engine/protocol-types";
import { clearanceTracker, type PoseAt } from "../motion-clearance";
import type { MotionResult, MotionStep } from "../motion";
import type { CadDoc, Placement } from "../types";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");
const CORPUS = path.resolve(__dirname, "../engine/__corpus__");
const corpus = (name: string) => fs.readFileSync(path.join(CORPUS, `${name}.txt`), "utf8");
const lines = (t: string, re: RegExp) => t.split("\n").filter((l) => re.test(l));

describe("vlna 22 C2: vůle a spojitá kontrola kolizí v pohybu (bod 6)", async () => {
  setLang("cs");
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const host = (): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
  const out = process.env.C2_OUT;
  if (out) fs.mkdirSync(out, { recursive: true });
  const run = async (name: string, text: string): Promise<{ r: RunReport; short: string; con: string }> => {
    const r = await runReport(new MemoryWorkspace(), text, host());
    const res = { r, short: formatShort(r, { budget: Infinity, notes: true }), con: formatConsole(r) };
    if (out) {
      fs.writeFileSync(path.join(out, `${name}.short.txt`), res.short + "\n");
      fs.writeFileSync(path.join(out, `${name}.console.txt`), res.con + "\n");
    }
    return res;
  };

  it("74b: nůž přes kolík mezi kroky 17 a 18 – spojitá kontrola najde průchod, diskrétní výslovně nic netvrdí", async () => {
    const { short, con } = await run("74b", corpus("74b-clearance-knife-pin"));
    // 36 kroků po 5 mm: v krocích samotných průnik není, mezi kroky 17 a 18 ano (dřív „Kolize: žádné ve všech krocích“)
    const m36 = lines(short, /^= L\d+ asm "Sestava 6" motion steps=36 /);
    expect(m36.length).toBe(4); // motor, pohyb stav, diskrétně, spojitě
    expect(m36[0]).toMatch(/ clash\.steps=0\/37 thread=0 real=1 clash\.mode=continuous clash\.poses=37 clash\.refined=\d+ clash\.maxstep=5mm clash\.between=1 first\.between=17\.\d+ m1=range:/); // pole spojitosti končí first.between=, dál následují pole motoru a úrovně (M)
    expect(short).toMatch(/clash\.real "Sestava 6": v pohybu „Kolík“ × „Nůž“ mezi kroky 17 a 18 \(zjemněno: poloha 17,\d+/);
    expect(con).not.toMatch(/Kolize: žádné ve všech krocích/);
    expect(con).toMatch(/^Kolize v pohybu: kroků s kolizí 0 z 37 .* skutečné: 1 dvojic dílů jen mezi kroky \(nalezeno zjemněním\) · mezi kroky \(zjemněno\) 1×\n kontrolováno spojitě i mezi polohami \(37 poloh \+ \d+ mezipoloh ze zjemnění; úseky: dráha posuvu \d+/m);
    // diskrétně: žádné tvrzení o úsecích mezi polohami, ℹ clash.discrete s posunem 5 mm
    expect(con).toMatch(/Kolize: žádný průnik v 37 polohách\n {1,2}kontrolováno jen v 37 polohách \(diskrétně, posun mezi polohami až 5 mm\) – mezi polohami nekontrolováno \(spojitá kontrola vypnuta/);
    expect(short).toMatch(/clash\.discrete "Sestava 6": kontrolováno jen v 37 polohách \(diskrétně/);
    expect(short).toMatch(/^= L\d+ asm "Sestava 6" motion steps=36 .* clash\.mode=discrete clash\.poses=37 clash\.refined=0 clash\.maxstep=5mm m1=range:/m); // diskrétně: bez clash.between, hned pole motoru (M)
    // spojitě znovu + 180 kroků: průnik v krocích 87–88, kontrola pořád spojitá
    expect(short).toMatch(/^= L\d+ asm "Sestava 6" motion steps=180 .* clash\.steps=2\/181 thread=0 real=1 first\.real=87 clash\.mode=continuous/m);
  }, 300_000);

  it("jádro `clearance`: dráha posuvu najde průchod nože kolíkem v OBOU pořadích dvojice; klouzání po rámu není průnik", async () => {
    const ws = new MemoryWorkspace();
    const setup = corpus("74b-clearance-knife-pin").split("\n").filter((l) => !/^(#|pohyb)/.test(l)).join("\n");
    await runReport(ws, setup, host());
    const d = ws.present();
    const id = (n: string) => d.components!.find((c) => c.name === n)!.id;
    const nuz = d.components!.find((c) => c.name === "Nůž")!;
    const at = (x: number) => ({ ...nuz.placement, position: [x, 0, 10] as [number, number, number] });
    const doc17 = { ...d, components: d.components!.map((c) => (c.id === nuz.id ? { ...c, placement: at(97) } : c)) };
    const r = await kernel.clearance({
      doc: doc17,
      poses: [{ [nuz.id]: at(102) }],
      dist: [{ a: id("Kolík"), b: id("Nůž"), pose: 0 }, { a: id("Kolík"), b: id("Nůž"), pose: 1 }],
      sweep: [
        { a: id("Kolík"), b: id("Nůž"), from: 0, to: 1 },
        { a: id("Nůž"), b: id("Kolík"), from: 0, to: 1 },
        { a: id("Rám"), b: id("Nůž"), from: 0, to: 1, touch: true },
        { a: id("Nůž"), b: id("Rám"), from: 0, to: 1, touch: true },
      ],
      local: [id("Nůž")],
    });
    expect(r.dist!.map((x) => +x.d.toFixed(6))).toEqual([1, 1]); // v krocích 17 a 18 vůle 1 mm
    expect(r.sweep![0]).toMatchObject({ ok: true, d: 0 });
    expect(r.sweep![0].pen).toBe(Infinity);
    expect(r.sweep![1]).toMatchObject({ ok: true, d: 0 });
    expect(r.sweep![1].pen).toBe(Infinity);
    expect(r.sweep![2]).toMatchObject({ ok: true, d: 0, pen: 0 }); // nůž klouže po rámu
    expect(r.sweep![3]).toMatchObject({ ok: true, d: 0, pen: 0 });
    expect(r.local![id("Nůž")]!.r).toBeCloseTo(Math.hypot(0.5, 20, 5), 6);
  }, 120_000);

  it("pouzdro klouže po sloupku bez vůle (Ø24 v Ø24): dráha posuvu úsek dokáže v OBOU pořadích dvojice – žádné „nepotvrzeno“", async () => {
    // Fáze 2: syntetický nástroj hlásil ⚠ clash.uncertain „nepotvrzeny v 653 úsecích“ jen při jednom pořadí náhodných id
    // (B = duté pouzdro: zmenšení k středu obálky zúží díru → dráha „zajede“ do sloupku → zbytečné půlení vyčerpalo rozpočet).
    const ws = new MemoryWorkspace();
    await runReport(ws, ["nový díl Sloupek", "válec 24 100", "nový díl Pouzdro", "kvádr 40 40 30", "díra 24 skrz v 20 20", "nová sestava Vedení", 'vložit "Pouzdro" v -20 -20 0', 'vložit "Sloupek" ukotvit v 0 0 -50'].join("\n"), host());
    const d = ws.present();
    const src = (n: string) => d.components!.find((c) => c.name === n)!;
    for (const [sl, po] of [["a-sloupek", "z-pouzdro"], ["z-sloupek", "a-pouzdro"]] as const) {
      const doc: CadDoc = { ...d, components: [{ ...src("Sloupek"), id: sl }, { ...src("Pouzdro"), id: po }], mates: [] };
      const at = (t: number): Record<string, Placement> => ({ [po]: { ...src("Pouzdro").placement, position: [-20, -20, 20 * t] } });
      const tr = clearanceTracker(doc, { motors: [], duration: 1, steps: 4 } as never, { clearance: (q) => kernel.clearance(q), collide: async () => [] }, { collisions: true, steps: 4 })!;
      const steps: MotionStep[] = [];
      for (let k = 0; k <= 4; k++) {
        const row = { i: k, t: k / 4, motors: [k / 4], place: at(k / 4), conflicts: [], clashes: [] } as unknown as MotionStep;
        const poseAt: PoseAt = (tm) => ({ place: at(tm), motors: [tm], t: tm });
        await tr.step(row, steps[steps.length - 1] ?? null, poseAt);
        steps.push(row);
      }
      const res = tr.finish({ steps, comps: [], motors: [], collision: null, collisionsChecked: true, conflictSteps: 0 } as unknown as MotionResult);
      expect(res.sweep, `${sl} × ${po}`).toMatchObject({ mode: "continuous", unproven: 0 });
      expect(res.sweep!.swept, `${sl} × ${po}`).toBe(4); // každý úsek dokázán dráhou posuvu
      expect(res.sweep!.refined, `${sl} × ${po}`).toBeLessThanOrEqual(4); // bez půlení (jen mezipoloha úseku)
      expect(res.between ?? []).toEqual([]);
    }
  }, 300_000);

  it("74c: střižník ve vedení – vůle 0,01 mm pod limitem 0,05 (⚠ s místem a kroky), `kolize` bez ✓", async () => {
    const { r, short, con } = await run("74c", corpus("74c-clearance-guide"));
    // statická kontrola: žádné ✓ a výslovně „vůle nekontrolována“
    expect(con).not.toMatch(/✓ kolize: žádné/);
    expect(con).toMatch(/^kolize: žádný průnik \(objem nad 0,001 mm³\) – 2 komponent · vůle nekontrolována/m);
    // sledovaná vůle: ⚠ clash.clearance s hodnotou, limitem, kroky a místem
    const w = lines(short, /clash\.clearance/);
    expect(w.length).toBeGreaterThanOrEqual(1);
    expect(w[0]).toMatch(/vůle „Střižník“ × „Vodítko“ 0,01 mm < 0,05 mm v krocích 0–10 \(nejmenší v kroku \d+ \(t = [\d,]+ s\)\) – místo \[/);
    expect(short).toMatch(/^= L\d+ asm "Sestava 6b" motion steps=10 .* clear\.min=0\.01 clear\.limit=0\.05 clear\.below=11\/11 clear\.at=\d+ clear\.pairs=1$/m);
    expect(con).toMatch(/Vůle „Střižník“ × „Vodítko“: nejmenší 0,01 mm v kroku \d+ \(t = [\d,]+ s\) – místo \[[^\]]+\] ↔ \[[^\]]+\] · ⚠ pod limitem 0,05 mm v 11 z 11 poloh \(kroky 0–10\)/);
    // krok: vůle v kroku s body
    expect(con).toMatch(/^ vůle „Střižník“ × „Vodítko“: 0,01 mm ⚠ pod limitem 0,05 mm – \[/m);
    // menší limit: dodržen v celém pohybu (spojitě – dráha posuvu po ose)
    expect(con).toMatch(/· limit 0,005 mm dodržen v celém pohybu \(spojitě i mezi polohami\)/);
    // JSON: záznam s kódem (úroveň ⚠, text s dvojicí, vůlí a limitem)
    const e = r.entries.find((x) => x.code === "clash.clearance")!;
    expect(e.level).toBe("warn");
    expect(e.text).toMatch(/„Střižník“ × „Vodítko“ 0,01 mm < 0,05 mm/);
  }, 300_000);
});
