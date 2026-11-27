/**
 * Vlna 22, balík C3 (bod 4 zprávy majitele – „pohybová studie neukazovala vznik střihu a otisku“) se skutečným jádrem in-process,
 * engine stejný jako v prohlížeči a v CLI. Repro = korpus 74d / 74e (src/cad/engine/__corpus__):
 *
 *  - 74d: razník Ø20 projde plechem 1 mm → postupný střih (0,5 mm → 1 mm → prostřiženo), odebráno π·10²·1 = 314,16 mm³ (± 1 %),
 *    odpad 1 kus, stav výrobku plný → v záběru → děrovaný, pracovní záběr ℹ clash.work (dřív ⚠ clash.real), úroveň
 *    „kinematika + geometrická aproximace“ s větou o materiálové simulaci, krok 0 = plný plech, dokument beze změny;
 *  - 74e: otisk s hloubkou 0,3 mm (π·5²·0,3 = 23,562 mm³), začátek podmínkou motoru, ⚠ motion.process-miss (EN / DE příkazy);
 *  - přímo operace jádra `process`: odpad oddělený jako samostatné těleso se svým objemem a těžištěm, sítě stavů, mezipaměť,
 *    strop booleovských operací (podvzorkování ohlášené).
 *
 *   C3_OUT=<složka>  zapsat protokoly (důkaz pro ledger)
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import { setHostAssets } from "../host-assets";
import { makeKernelClient } from "../kernel-client";
import { sourceKey } from "../assembly";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../engine/host";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { formatConsole, formatShort } from "../engine/protocol";
import { runReport } from "../engine/run-protocol";
import { relMatrix } from "../motion-process";
import type { ProcReq } from "../process-types";
import type { CadDoc } from "../types";

const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../../public/fonts");
const CORPUS = path.resolve(__dirname, "../engine/__corpus__");
const corpus = (name: string) => fs.readFileSync(path.join(CORPUS, `${name}.txt`), "utf8").replace(/^#--- run\n/m, "");
const PI_R2_T = Math.PI * 10 * 10 * 1; // 314,159 mm³

describe("vlna 22 C3: procesní vrstva – střih a otisk během pohybu (bod 4)", async () => {
  setLang("cs");
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("../kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const host = (): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
  const out = process.env.C3_OUT;
  if (out) fs.mkdirSync(out, { recursive: true });
  const run = async (name: string, text: string) => {
    const ws = new MemoryWorkspace();
    const r = await runReport(ws, text, host());
    const res = { ws, r, short: formatShort(r, { budget: Infinity, notes: true }), con: formatConsole(r) };
    if (out) {
      fs.writeFileSync(path.join(out, `${name}.short.txt`), res.short + "\n");
      fs.writeFileSync(path.join(out, `${name}.console.txt`), res.con + "\n");
    }
    return res;
  };

  it("74d: postupný střih Ø20 × 1 mm – 314,16 mm³ ± 1 %, odpad, stav výrobku, ℹ clash.work místo ⚠ clash.real, úroveň", async () => {
    const { short, con } = await run("74d", corpus("74d-process-cut"));
    // před procesní operací: pracovní záběr = skutečná kolize (dnešní stav) – po ní pracovní kontakt
    const motion = short.split("\n").filter((l) => /^= L\d+ asm "Lis" motion /.test(l));
    expect(motion[0]).toMatch(/ real=1 first\.real=19 /);
    expect(motion[0]).toMatch(/ level=kin /);
    const m = /^= L19 asm "Lis" motion .* real=0 work=1 .* level=kin\+geo .* proc=1 removed=([\d.]+) scrap=1 through=21$/m.exec(short);
    expect(m, short).not.toBeNull();
    expect(Math.abs(Number(m![1]) - PI_R2_T) / PI_R2_T).toBeLessThan(0.01);
    // operace L19 nemá ⚠ clash.real (záběr je pracovní kontakt), ale má ℹ clash.work s pravidlem procesu
    expect(short).not.toMatch(/^⚠ L19[ ,].*clash\.real/m);
    expect(short).toMatch(/clash\.work "Lis": pracovní kontakt „Plech“ × „Razník“ v krocích 19–\d+ \(pravidlo proces střih 1\)/);
    expect(con).toMatch(/Úroveň simulace: kinematika \+ geometrická aproximace/);
    expect(con).toMatch(/Procesní vrstva: geometrická aproximace – booleovské odebrání objemu nástroje z obrobku; není to simulace materiálu/);
    expect(con).toMatch(/střih 1 „Razník“ → „Plech“: záběr od kroku 19 \(t = 0,792 s\) · prostřiženo v kroku 21 \(t = 0,875 s\) · odebráno 314,1\d* mm³ · hloubka 1 mm · odpad 1 ks/);
    expect(con).toMatch(/Stav výrobku „Plech“: plný \(kroky 0–18\) → v záběru \(kroky 19–20\) → děrovaný \(kroky 21–48\)/);
    // postupně: krok 19 = půl tloušťky, krok 21 prostřiženo, krok 0 = plný (restart), krok 48 po návratu stále děrovaný
    expect(con).toMatch(/Krok 0 \(t = 0 s[^\n]*\n(?: [^\n]*\n)* stav výrobku „Plech“: plný\n/);
    expect(con).toMatch(/ stav výrobku „Plech“: v záběru · odebráno 157,0\d* mm³ · hloubka 0,5 mm/);
    expect(con).toMatch(/ stav výrobku „Plech“: děrovaný · odebráno 314,1\d* mm³ · hloubka 1 mm · odpad 1 oddělen/);
    expect(con).toMatch(/ zásah střih 1: 0,5 mm \(geometrická aproximace\)/);
    // `stav`: stav výrobku na konci a dokument beze změny (objem plechu 6,4 cm³)
    expect(con).toMatch(/procesní vrstva \(geometrická aproximace, ne simulace materiálu\): na konci „Plech“ děrovaný, odebráno 314,1\d* mm³, odpad 1/);
    expect(short).toMatch(/^D "Lis" asm .*V\.sum=115\.76cm3 /m); // Σ objemů dílů vč. plechu 6,4 cm³ – přehrání dokument nemění
    // po smazání operací je záběr zase skutečná kolize (pravidlo nebylo trvalé vypnutí kontroly)
    expect(motion[motion.length - 1]).toMatch(/ real=1 first\.real=19 .* level=kin groups=/);
  }, 240_000);

  it("74e: otisk s řízenou hloubkou 0,3 mm (23,562 mm³), začátek podmínkou motoru, EN / DE, ⚠ nástroj mimo obrobek", async () => {
    const { short, con } = await run("74e", corpus("74e-process-imprint-en-de"));
    const m = /^= L19 asm "Značení" motion .* level=kin\+geo .* proc=1 removed=([\d.]+) scrap=0$/m.exec(short);
    expect(m, short).not.toBeNull();
    const want = Math.PI * 25 * 0.3;
    expect(Math.abs(Number(m![1]) - want) / want).toBeLessThan(0.01);
    expect(con).toMatch(/otisk 1 „Razidlo“ → „Štítek“: záběr od kroku 5 .* · hloubka 0,3 mm/);
    expect(short).toMatch(/motion\.process-miss "Značení": procesní operace otisk 2: nástroj „Kolík“ obrobek „Štítek“ v okně operace nezasáhl/);
    expect(short).toMatch(/✗ L23 .*fáze „Neexistuje“ ve studii není/);
    expect(con).toMatch(/✓ procesní operace smazána: 2\. otisk „Kolík“/);
  }, 240_000);

  it("operace jádra: odpad jako samostatné těleso, objem zbytku, sítě stavů, mezipaměť, strop operací", async () => {
    const { ws } = await run("74d-kernel", corpus("74d-process-cut").split("\npohyb motor")[0]);
    const asm = ws.listDocs().find((d) => d.doc.kind === "assembly")!.doc as CadDoc;
    const P = asm.components!.find((c) => c.name === "Plech")!;
    const R = asm.components!.find((c) => c.name === "Razník")!;
    const zs = [20, 10.5, 10, 9.5, 8, 20];
    const req: ProcReq = {
      target: { key: sourceKey(P.source), source: P.source },
      tool: { key: sourceKey(R.source), source: R.source },
      kind: "cut",
      rels: zs.map((z) => relMatrix(P.placement, { position: [50, 50, z], rotation: [0, 0, 0] })),
    };
    const res = await kernel.process({ ...req, mesh: [1, 2, 3] });
    expect(res.steps.map((s) => s.contact)).toEqual([false, true, true, true, true, false]);
    expect(res.steps.map((s) => s.through)).toEqual([false, false, false, true, true, true]);
    expect(res.steps[1].depth).toBeCloseTo(0.5, 3);
    expect(res.dir).toEqual([0, 0, -1]);
    expect(res.thickness).toBeCloseTo(1, 3);
    const last = res.states[res.steps[5].state];
    expect(Math.abs(last.removed - PI_R2_T) / PI_R2_T).toBeLessThan(0.01);
    expect(last.volume).toBeCloseTo(6400 - PI_R2_T, 0);
    // odpad = oddělený kus s vlastním objemem a těžištěm (v souřadnicích plechu: střed díry, polovina tloušťky)
    expect(last.scrap).toHaveLength(1);
    expect(Math.abs(last.scrap[0].volume - PI_R2_T) / PI_R2_T).toBeLessThan(0.01);
    expect(last.scrap[0].center.map((v) => Math.round(v * 100) / 100)).toEqual([40, 40, 0.5]);
    // sítě: stav 3 = plech s dírou + odpad; stav 1 (v záběru) bez odpadu
    expect(res.states[3].mesh?.triangles.length).toBeGreaterThan(0);
    expect(res.states[3].scrapMesh?.triangles.length).toBeGreaterThan(0);
    expect(res.states[1].scrapMesh ?? null).toBeNull();
    // stejný požadavek = mezipaměť jádra (bez přepočtu)
    expect((await kernel.process(req)).cached).toBe(true);
    // otisk 0,3 mm: odebráno π·10²·0,3, nikdy prostřiženo, bez odpadu
    const imp = await kernel.process({ ...req, kind: "imprint", depth: 0.3 });
    expect(imp.steps.some((s) => s.through)).toBe(false);
    expect(imp.states[imp.steps[4].state].removed).toBeCloseTo(Math.PI * 100 * 0.3, 1);
    expect(imp.states[imp.steps[4].state].scrap).toEqual([]);
    // strop booleovských operací: 4 kroky se záběrem, strop 2 → podvzorkováno a ohlášeno
    const cap = await kernel.process({ ...req, maxOps: 2 });
    expect(cap.approx).toEqual({ contact: 4, computed: 2 });
    expect(cap.steps.filter((s) => s.skipped).length).toBe(2);
    // fáze 2 kolo 3: dvě operace na TÉMŽE obrobku – kombinovaný stav = sjednocení (druhý střih do téže díry nic nepřidá);
    // dřív se každá počítala z původního plechu a protokol sčítal 2 × 314,159 mm³
    const both = await kernel.process({ ...req, others: [{ tool: req.tool, kind: "cut", rels: req.rels }], meshCombined: [1] });
    const cs = both.combined!;
    expect(cs.steps).toHaveLength(6);
    expect(cs.steps[0]).toBe(0);
    const fin = cs.states[cs.steps[5]];
    expect(Math.abs(fin.removed - PI_R2_T) / PI_R2_T).toBeLessThan(0.01);
    expect(fin.volume).toBeCloseTo(6400 - PI_R2_T, 0);
    expect(fin.scrap).toHaveLength(1);
    expect(cs.states[1].mesh?.triangles.length).toBeGreaterThan(0);
    // různé díry: sjednocení = součet, odpad 2 kusy
    const apart = await kernel.process({ ...req, others: [{ tool: req.tool, kind: "cut", rels: zs.map((z) => relMatrix(P.placement, { position: [30, 30, z], rotation: [0, 0, 0] })) }] });
    const fa = apart.combined!.states[apart.combined!.steps[5]];
    expect(Math.abs(fa.removed - 2 * PI_R2_T) / PI_R2_T).toBeLessThan(0.02);
    expect(fa.scrap).toHaveLength(2);
  }, 240_000);

  it("kolo 6 · 74i: střižník projde plechem během jednoho kroku – mezipolohy z řešiče, střih 314,159 mm³, ne „nezasáhl“ / „plný“", async () => {
    // dřív: proc=1 removed=0, „bez záběru – nástroj obrobek nezasáhl“, ⚠ motion.process-miss vedle ℹ clash.work 314,159 mm³
    const { short, con } = await run("74i", corpus("74i-process-between"));
    const kv = short.split("\n").find((l) => /^= L\d+ asm "Lis" motion .* proc=1 /.test(l))!;
    const m = / proc=1 removed=([\d.]+) scrap=(\d+) through=1$/.exec(kv)!;
    expect(m, kv).toBeTruthy();
    expect(Math.abs(Number(m[1]) - PI_R2_T) / PI_R2_T).toBeLessThan(0.01);
    expect(m[2]).toBe("1");
    expect(short).not.toMatch(/motion\.process-miss|nezasáhl/);
    expect(con).toMatch(/střih 1 „Střižník“ → „Plech“: záběr od mezipolohy mezi kroky 0 a 1 \(t = [\d,]+ s\) · prostřiženo v mezipoloze mezi kroky 0 a 1/);
    expect(con).toMatch(/Stav výrobku „Plech“: plný \(krok 0\) → děrovaný \(krok 1\)/);
    expect(con).toMatch(/^ stav výrobku „Plech“: děrovaný · odebráno 314,1\d+ mm³/m);
    expect(con).toMatch(/na konci „Plech“ děrovaný, odebráno 314,1\d+ mm³, odpad 1/);
    // ℹ clash.work jednotně „mezi kroky 0 a 1“ (dřív „v krocích mezi kroky“)
    expect(short).toMatch(/clash\.work "Lis": pracovní kontakt „Plech“ × „Střižník“ mezi kroky 0 a 1 \(pravidlo proces střih 1\)/);
    expect(short).not.toMatch(/v krocích mezi kroky/);
  }, 240_000);

  it("kolo 6 · 74k: tenký střižník (0,2 mm) projde plechem během kroku, úsek nad strop mezipoloh – nezjištěn, ne „nezasáhl“ / „plný“", async () => {
    // oponent kola 6: plán vrátil `capped`, procesní vrstva ho nečetla – 64 mezipoloh, nástroj plechem dál „proskočil“:
    // proc=1 removed=0, „bez záběru – nástroj obrobek nezasáhl“, „plný (kroky 0–1)“, ⚠ process-miss vedle ℹ clash.work 9,817 mm³
    const { ws, short, con } = await run("74k", corpus("74k-process-capped"));
    expect(short).not.toMatch(/motion\.process-miss|nezasáhl/);
    expect(short).toMatch(/motion\.process-between "Lis": procesní operace střih 1: nástroj „Střižník“ mohl obrobek „Plech“ zasáhnout jen mezi kroky – úsek by potřeboval víc než 64 mezipoloh/);
    expect(con).toMatch(/střih 1 „Střižník“ → „Plech“: záběr jen mezi kroky – výsledek procesu nezjištěn \(úsek před krokem 1 by potřeboval víc než 64 mezipoloh\)/);
    expect(con).toMatch(/Stav výrobku „Plech“: plný \(krok 0\) → nezjištěn \(záběr jen mezi kroky\) \(krok 1\)/);
    expect(con).toMatch(/na konci „Plech“ nezjištěn/);
    expect(con).not.toMatch(/na konci „Plech“ plný/);
    // plán jádra: úsek přes strop (61 mm posunu, nástroj 0,2 mm → polovina 0,1 mm → 609 mezipoloh) = capped
    const asm = ws.listDocs().find((d) => d.doc.kind === "assembly")!.doc as CadDoc;
    const P = asm.components!.find((c) => c.name === "Plech")!;
    const R = asm.components!.find((c) => c.name === "Střižník")!;
    const at = (z: number) => relMatrix(P.placement, { position: [50, 50, z], rotation: [0, 0, 0] });
    const plan = await kernel.process({ target: { key: sourceKey(P.source), source: P.source }, tool: { key: sourceKey(R.source), source: R.source }, kind: "cut", rels: [at(20), at(-41)], plan: true });
    expect(plan.gaps).toEqual([{ i: 1, n: 64, capped: true }]);
  }, 240_000);

  it("kolo 6 · 74j: otisk 0,1 mm z požadovaných 0,3 mm = ℹ process-partial; otisk + prostřižený střih = „děrovaný + v záběru“", async () => {
    const { short, con } = await run("74j", corpus("74j-process-imprint-depth"));
    // dřív removed=31.416 a hloubka 0,1 mm bez upozornění
    expect(short).toMatch(/motion\.process-partial "Lis": procesní operace otisk 1: otisk do „Plech“ 0,1 mm z požadovaných 0,3 mm/);
    // dřív „Stav výrobku „Plech“: plný (kroky 0–4) → v záběru (kroky 5–6)“, přitom through=6 scrap=1
    expect(short).toMatch(/^= L\d+ asm "Lis B" motion .* proc=2 removed=[\d.]+ scrap=1 through=6$/m);
    expect(con).toMatch(/Stav výrobku „Plech“: plný \(kroky 0–4\) → v záběru \(krok 5\) → děrovaný \+ v záběru \(krok 6\)/);
    expect(con).toMatch(/^ stav výrobku „Plech“: děrovaný \+ v záběru · odebráno 314,1\d+ mm³ · hloubka 1 mm · odpad 1 oddělen/m);
  }, 240_000);

  it("kolo 6 · plán jádra: úsek, kde by nástroj obrobkem proskočil, chce mezipolohy; jemné kroky ne", async () => {
    const { ws } = await run("plan", corpus("74d-process-cut").split("\npohyb motor")[0]);
    const asm = ws.listDocs().find((d) => d.doc.kind === "assembly")!.doc as CadDoc;
    const P = asm.components!.find((c) => c.name === "Plech")!;
    const R = asm.components!.find((c) => c.name === "Razník")!;
    const at = (z: number) => relMatrix(P.placement, { position: [50, 50, z], rotation: [0, 0, 0] });
    const base: ProcReq = { target: { key: sourceKey(P.source), source: P.source }, tool: { key: sourceKey(R.source), source: R.source }, kind: "cut", rels: [at(20), at(-35)] };
    const jump = await kernel.process({ ...base, plan: true });
    expect(jump.gaps).toEqual([{ i: 1, n: 2 }]); // 55 mm posunu, razník 40 mm → polovina 20 mm → 2 mezipolohy
    expect(jump.steps).toEqual([]); // plán bez booleovských operací
    const fine = await kernel.process({ ...base, rels: [at(20), at(10.5), at(10), at(9.5)], plan: true });
    expect(fine.gaps ?? []).toEqual([]);
    // mimo obálku obrobku (vedle plechu) mezipolohy netřeba
    const aside = await kernel.process({ ...base, rels: [relMatrix(P.placement, { position: [200, 50, 20], rotation: [0, 0, 0] }), relMatrix(P.placement, { position: [200, 50, -35], rotation: [0, 0, 0] })], plan: true });
    expect(aside.gaps ?? []).toEqual([]);
  }, 240_000);

  it("74f: dva střihy do téže díry = 314,159 mm³ jednou (dřív removed=628.319 scrap=2); dvě různé díry = součet 392,699 mm³ a 2 kusy odpadu", async () => {
    const { short, con } = await run("74f", corpus("74f-process-two-ops"));
    const kv = short.split("\n").filter((l) => /^= L\d+ asm "Lis" motion .* proc=2 /.test(l));
    expect(kv.length, short).toBeGreaterThanOrEqual(2);
    const same = / proc=2 removed=([\d.]+) scrap=(\d+)/.exec(kv[0])!;
    expect(Math.abs(Number(same[1]) - PI_R2_T) / PI_R2_T).toBeLessThan(0.01);
    expect(same[2]).toBe("1");
    expect(con).toMatch(/„Plech“: 2 operací, celkem odebráno 314,1\d+ mm³ \(sjednocení – společný objem operací jen jednou; součet operací 628,\d+ mm³\)/);
    const two = / proc=2 removed=([\d.]+) scrap=(\d+)/.exec(kv[kv.length - 1])!;
    const want = PI_R2_T + Math.PI * 25; // Ø20 + Ø10 × 1 mm
    expect(Math.abs(Number(two[1]) - want) / want).toBeLessThan(0.01);
    expect(two[2]).toBe("2");
    expect(short).not.toMatch(/motion\.process-failed/);
  }, 240_000);
});
