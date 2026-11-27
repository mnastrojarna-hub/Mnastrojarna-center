/**
 * Vlna 22, balík C1 (bod 5) – test „žádné falešné zelené“. Úspěšné / uklidňující texty, kterých se třídění kolizí dotklo, a kdy
 * se NESMÍ vypsat (kontrola neproběhla, dvojice nebyla zařazena, pravidlo neplatí, průnik existuje):
 *
 *  1. panel Kolize „Bez kolizí ✓“                     – jen stav `ok`; průnik jen „šroub v závitu“ = „Kolize (N) · šroub v závitu N“
 *  2. protokol „✓ kolize: žádné (N komponent)“         – jen bez průniku; šrouby v závitu = „kolize: N – šroub v závitu N, skutečné 0“
 *  3. pohyb „Kolize: žádné ve všech krocích“           – jen bez průniku v krocích; šroub v závitu / dotyk / pracovní kontakt ne
 *  4. ℹ dotyk / ℹ pracovní kontakt / ℹ šroub v závitu – nezařazená dvojice (bez třídy z jádra) je vždy ⚠ skutečná (slabší tvrzení);
 *     dotyk jen s naměřenou tloušťkou pod tolerancí; pracovní kontakt jen v okně pravidla (mimo okno ⚠)
 *  5. bez štítku „· kolize“ u kroku / bez zvýraznění ve 3D – jen když v kroku / sestavě není závada
 *
 * Vlna 22, bod 6 (C2) – nulový průnik není „bez kolizí“ ani „nic nedře“:
 *  6. pohyb „Kolize: žádný průnik v N polohách“ vždy s tím, JAK se kontrolovalo; „spojitě i mezi polohami“ jen se spojitou
 *     kontrolou bez nepotvrzených úseků; kolize nalezená mezi kroky „žádný průnik“ vyloučí
 *  7. statika: `kolize` bez ✓ a s „vůle nekontrolována“, titulek panelu „Bez průniku · vůle nekontrolována“ (ne „Bez kolizí ✓“)
 *  8. vůle „limit dodržen v celém pohybu (spojitě …)“ jen bez kroků pod limitem, se zjemněním a bez nepotvrzených úseků
 *
 * Vlna 22, bod 4 (C3) – procesní vrstva:
 *  9. pracovní záběr procesní operace nedá „Kolize: žádný průnik“ (je tam průnik – pracovní kontakt), ani ⚠ clash.real;
 *     záběr PŘED začátkem operace zůstává ⚠ skutečnou kolizí
 * 10. úroveň „+ geometrická aproximace“ a věta „není to simulace materiálu“ jsou u každého výsledku s procesní vrstvou; bez spočtené
 *     procesní vrstvy (jádro bez operace, chyba) žádný stav „děrovaný“ ani „odebráno“ – jen „nespočítáno“ s ⚠
 *
 * Kolo 6:
 *  8c. vůle pod limitem jen MEZI kroky: nikdy „dodržen v celém pohybu“ a nikdy „pod limitem v 1 z N poloh (kroky K)“ – „mezi kroky“
 * 11. procesní vrstva: záběr možný jen mezi kroky a mezipolohy nespočítané → nikdy „nezasáhl“, „plný“ na konci ani ⚠ process-miss
 * 12. se skutečným jádrem: „limit dodržen … spojitě“ nesmí vyjít, když jemné vzorkování TÉŽE dráhy (360 kroků) najde vůli pod limitem
 */
import { describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import type { ClashDetail } from "../clash-class";
import { applyClashPolicy, staticRuleCtx, stepRuleCtx } from "../clash-rules";
import { entryClashes, faultLeafIds, firstFault, motionClashKv, motionClashSummary, stepHasFault } from "../clash-report";
import { clearanceSummaryLines } from "../clearance-report";
import type { ClearancePair, SweepInfo } from "../motion-clearance";
import { motionSigParts, motionStatusOf, motionStoreOf } from "../motion-cache";
import { clashTitle, clashTitleClasses } from "../../components/cad/clash-view";
import { countClasses } from "../clash-class";
import { memoryFileSink, memoryFileSource, type EngineHost } from "../engine/host";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { formatConsole } from "../engine/protocol";
import { runScript } from "../engine/run";
import type { KernelApi } from "../engine/kernel";
import type { AsmComponent, BuildResult, CadDoc, ComponentSource, Vec3 } from "../types";
import { emptyDoc } from "../types";
import type { MotionResult } from "../motion";
import { levelLine } from "../motion-mode";
import { processCodes, processKv, processLines, processOf, processRun, processStatusText } from "../motion-process";
import type { ProcReq, ProcRes } from "../process-types";

setLang("cs");
const part = (name: string): CadDoc => ({ ...emptyDoc(name) }) as CadDoc;
const comp = (id: string, name: string): AsmComponent => ({ id, name, source: { kind: "part", doc: part(name) }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } }) as AsmComponent;
const doc: CadDoc = { ...emptyDoc("S"), kind: "assembly", components: [comp("d", "Deska A"), comp("s", "Šroub M12"), comp("r", "Razník"), comp("pl", "Plech")] } as CadDoc;
const det = (a: string, b: string, cls: ClashDetail["cls"], extra: Partial<ClashDetail> = {}): ClashDetail => ({ a, b, volume: 250, cls, why: cls === "thread" ? "thread" : "no-thread", aPath: [a], bPath: [b], ...extra });

describe("vlna 22 C1: žádné falešné zelené u tříd kolizí (bod 5)", () => {
  it("1. panel Kolize: průnik jen „šroub v závitu“ nikdy „Bez kolizí ✓“ – titulek uvede počet a třídy", () => {
    const c = countClasses([det("d", "s", "thread"), det("d", "s", "thread")]);
    const t = clashTitleClasses("clash", 2, c);
    expect(t).toBe("Kolize (2) · šroub v závitu 2");
    expect(t).not.toMatch(/✓|Bez kolizí/);
    expect(clashTitleClasses("stale", 2, c)).toBe(clashTitle("stale", 2));
    expect(clashTitleClasses("unchecked", 0, null)).not.toMatch(/✓/);
  });

  it("2. protokol `kolize`: šrouby v závitu nedají „kolize: žádný průnik“ (dřív „✓ kolize: žádné“)", async () => {
    const result = (d: CadDoc): BuildResult => ({ status: d.features.map((f) => ({ id: f.id, ok: true })), mesh: null, metrics: d.features.length ? { volume: 1000, area: 600, bbox: [[0, 0, 0], [10, 10, 10]], faces: 6, edges: 12, valid: true, solids: 1 } : null, ms: 1 }) as unknown as BuildResult;
    const kernel = {
      generation: () => 1,
      build: async (d: CadDoc) => result(d),
      asmParts: async (parts: { key: string; source: ComponentSource }[]) => parts.map((p) => ({ key: p.key, result: result(p.source.kind === "part" ? p.source.doc : emptyDoc()) })),
      interference: async (d: CadDoc) => [{ a: d.components![0].id, b: d.components![1].id, volume: 250 }],
      clashDetail: async (_d: CadDoc, pairs: { a: string; b: string; volume: number }[]) => pairs.map((p) => ({ ...p, cls: "thread", why: "thread" })),
    } as unknown as KernelApi;
    const host: EngineHost = { kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() };
    const con = formatConsole(await runScript(new MemoryWorkspace(), 'nový díl Deska\nkvádr 10 10 10\nnový díl Šroub\nválec 5 10\nnová sestava S\nvložit "Deska" ukotvit\nvložit "Šroub"\nkolize\nstav', host));
    expect(con).toMatch(/^kolize: 1 – šroub v závitu 1, skutečné 0$/m);
    expect(con).not.toMatch(/✓ kolize: žádné|kolize: žádný průnik/);
    expect(con).toMatch(/^Kolize: 1 – šroub v závitu 1 \(zkontrolováno/m);
    expect(con).not.toMatch(/^Kolize: žádné/m);
  });

  it("3. pohyb: „Kolize: žádný průnik v N polohách“ jen bez průniku – ne při šroubu v závitu, dotyku ani pracovním kontaktu", () => {
    const st = (clashes: ClashDetail[]) => ({ steps: [0, 1, 2].map((i) => ({ i, t: i, motors: [i], clashes })), collisionsChecked: true });
    // vlna 22, bod 6: bez údaje o spojitosti = diskrétně, výslovně „mezi polohami nekontrolováno“ (dřív „žádné ve všech krocích“)
    // fáze 2 kolo 3: bez sledované vůle i výslovně „vůle nekontrolována“ (nulový průnik není provozní vůle)
    expect(motionClashSummary(st([]), doc).lines).toEqual(['Kolize: žádný průnik v 3 polohách · vůle nekontrolována (pohyb vůle "A" "B" min 0,05 | pohyb vůle pohyblivé min 0,05)', " kontrolováno jen v 3 polohách (diskrétně, bez posunu mezi polohami) – mezi polohami nekontrolováno"]);
    for (const c of [det("d", "s", "thread"), det("d", "s", "real", { depth: 0.0001 }), det("r", "pl", "real")]) {
      const d = c.a === "r" ? { ...doc, clashRules: [{ id: "r1", kind: "work" as const, a: ["r"], b: ["pl"] }] } : doc;
      const lines = motionClashSummary(st([c]), d).lines;
      expect(lines.join("\n")).not.toMatch(/žádné ve všech krocích|Kolize: žádný průnik/);
    }
  });

  it("4. nezařazená dvojice je skutečná; dotyk jen s naměřenou tloušťkou; pracovní kontakt jen v okně pravidla", () => {
    // výsledek bez zařazení z jádra (starší záznam, cizí prostředí): nikdy ℹ
    expect(entryClashes({ res: [{ a: "d", b: "s", volume: 250 }] }, doc)[0].cls).toBe("real");
    expect(applyClashPolicy([{ a: "d", b: "s", volume: 250 }], doc, staticRuleCtx(doc))[0].cls).toBe("real");
    // tloušťka neznámá → ne dotyk
    expect(applyClashPolicy([det("d", "s", "real")], doc, staticRuleCtx(doc))[0].cls).toBe("real");
    // pracovní kontakt s oknem kroků: staticky (poloha z dokumentu) neplatí, v kroku mimo okno neplatí
    const d = { ...doc, clashRules: [{ id: "r1", kind: "work" as const, a: ["r"], b: ["pl"], when: { steps: [0, 2] as [number, number] } }] };
    expect(applyClashPolicy([det("r", "pl", "real")], d, staticRuleCtx(d))[0].cls).toBe("real");
    expect(applyClashPolicy([det("r", "pl", "real")], d, stepRuleCtx(d, { i: 5, motors: [] }))[0].cls).toBe("real");
    // pravidlo závit nepřevede skutečnou kolizi (jen šroub v jádrové díře bez prvku závitu)
    const t = { ...doc, clashRules: [{ id: "r1", kind: "thread" as const, a: ["d"], b: ["s"] }] };
    expect(applyClashPolicy([det("d", "s", "real")], t, staticRuleCtx(t))[0].cls).toBe("real");
  });

  it("5. bez štítku „· kolize“ a bez zvýraznění jen tehdy, když krok / sestava nemá závadu", () => {
    expect(stepHasFault(doc, { i: 0, t: 0, motors: [], clashes: [det("d", "s", "thread")] })).toBe(false);
    expect(stepHasFault(doc, { i: 0, t: 0, motors: [], clashes: [{ a: "d", b: "s", volume: 250 }] })).toBe(true); // nezařazená
    expect(stepHasFault(doc, { i: 0, t: 0, motors: [], clashes: [det("d", "s", "undetermined")] })).toBe(true);
    expect(faultLeafIds([det("d", "s", "thread")]).size).toBe(0);
    expect([...faultLeafIds([det("d", "s", "undetermined")])].sort()).toEqual(["d", "s"]);
  });

  it("6. pohyb: „spojitě i mezi polohami“ jen se spojitou kontrolou bez nepotvrzených úseků; kolize mezi kroky vyloučí „žádný průnik“", () => {
    const steps = [0, 1, 2].map((i) => ({ i, t: i, motors: [i], clashes: [] as ClashDetail[] }));
    const sw = (p: Partial<SweepInfo>): SweepInfo => ({ mode: "continuous", poses: 3, refined: 2, bounded: 2, swept: 0, contacts: 0, covered: 0, unproven: 0, unprovenContact: 0, unprovenAt: [], maxStep: 5, maxTurn: 0, between: "solver", ...p });
    expect(motionClashSummary({ steps, collisionsChecked: true, sweep: sw({}) }, doc).lines.join("\n")).toMatch(/kontrolováno spojitě i mezi polohami/);
    for (const s of [undefined, sw({ mode: "partial", unproven: 1, unprovenAt: [1] }), sw({ mode: "discrete", why: "off" })]) {
      const t = motionClashSummary({ steps, collisionsChecked: true, ...(s ? { sweep: s } : {}) }, doc).lines.join("\n");
      expect(t).not.toMatch(/spojitě i mezi polohami/);
      expect(t).toMatch(/jen v polohách|mezi polohami nekontrolováno/);
    }
    const between = [{ k0: 0, k1: 1, pos: 0.5, t: 0.5, motors: [0.5], a: "r", b: "pl", clashes: [det("r", "pl", "real")] }];
    const hit = motionClashSummary({ steps, collisionsChecked: true, sweep: sw({ contacts: 1 }), between }, doc);
    expect(hit.lines.join("\n")).not.toMatch(/Kolize: žádný průnik/);
    expect(hit.stats.real).toBe(1);
    expect(hit.codes.map((c) => c.code)).toContain("clash.real");
    expect(motionClashKv(hit.stats).join(" ")).toMatch(/clash\.between=1 first\.between=0\.5$/);
    expect(firstFault({ steps, collisionsChecked: true, between }, doc)!.between).toEqual([0, 1]);
    // `stav` (řádek „Pohyb:“): kolize mezi kroky = stav clash, nikdy „bez průniku těles v kontrolovaných krocích“
    const md = { ...doc, motion: { motors: [{ id: "m", kind: "linear" as const, mate: "x", from: 0, to: 1 }], duration: 1, steps: 2, collisions: true } } as CadDoc;
    const store = motionStoreOf({});
    const res = { steps: steps.map((x) => ({ ...x, place: {}, conflicts: [] })), comps: [], motors: md.motion!.motors, collision: null, collisionsChecked: true, conflictSteps: 0, sweep: sw({ contacts: 1 }), between };
    store.byDoc.set("k", { ...motionSigParts(md), res: res as never, seq: 1, at: 0, doc: "S", comps: 4 });
    const line = motionStatusOf(store, "k", md)!;
    expect(line.state).toBe("clash");
    expect(line.line).toMatch(/průnik těles mezi kroky \(1×, nalezeno zjemněním\)/);
    expect(line.line).not.toMatch(/bez průniku/);
  });

  it("7. statika: `kolize` bez průniku nikdy s ✓ a vždy „vůle nekontrolována“; titulek panelu „Bez průniku“", async () => {
    const result = (d: CadDoc): BuildResult => ({ status: d.features.map((f) => ({ id: f.id, ok: true })), mesh: null, metrics: d.features.length ? { volume: 1000, area: 600, bbox: [[0, 0, 0], [10, 10, 10]], faces: 6, edges: 12, valid: true, solids: 1 } : null, ms: 1 }) as unknown as BuildResult;
    const kernel = {
      generation: () => 1,
      build: async (d: CadDoc) => result(d),
      asmParts: async (parts: { key: string; source: ComponentSource }[]) => parts.map((p) => ({ key: p.key, result: result(p.source.kind === "part" ? p.source.doc : emptyDoc()) })),
      interference: async () => [],
      clashDetail: async () => [],
    } as unknown as KernelApi;
    const host: EngineHost = { kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() };
    const con = formatConsole(await runScript(new MemoryWorkspace(), 'nový díl Deska\nkvádr 10 10 10\nnový díl Šroub\nválec 5 10\nnová sestava S\nvložit "Deska" ukotvit\nvložit "Šroub"\nkolize\nstav', host));
    expect(con).not.toMatch(/✓ kolize|Bez kolizí/);
    expect(con).toMatch(/^kolize: žádný průnik \(objem nad 0,001 mm³\) – 2 komponent · vůle nekontrolována/m);
    expect(con).toMatch(/^Kolize: žádný průnik · vůle nekontrolována \(zkontrolováno/m);
    expect(clashTitle("ok", 0)).toBe("Bez průniku · vůle nekontrolována");
    expect(clashTitle("ok", 0)).not.toMatch(/✓|Bez kolizí/);
  });

  it("8. vůle „limit dodržen v celém pohybu“ jen bez kroků pod limitem, se zjemněním a bez nepotvrzených úseků", () => {
    const steps = [0, 1].map((i) => ({ i, t: i, motors: [i], clashes: [] }));
    const pair = (p: Partial<ClearancePair>): ClearancePair => ({ a: "r", b: "pl", min: { d: 0.2, exact: true, pos: 0, t: 0, motors: [0] }, series: [0.2, 0.3], pts: [null, null], below: [], unproven: 0, ...p });
    const res = (p: ClearancePair, limit = 0.1) => ({ steps, collisionsChecked: false, clearance: { limit, moving: false, pairs: [p], poses: 2, refined: 0 } });
    const d = { ...doc, motion: { motors: [], duration: 1, steps: 1, clearance: { pairs: [{ a: "r", b: "pl" }], limit: 0.1 } } } as CadDoc;
    const GREEN = /dodržen v celém pohybu/;
    expect(clearanceSummaryLines(res(pair({})) as never, d).join("\n")).toMatch(GREEN);
    expect(clearanceSummaryLines(res(pair({ min: { d: 0.05, exact: true, pos: 1, t: 1, motors: [1] }, below: [1] })) as never, d).join("\n")).not.toMatch(GREEN);
    expect(clearanceSummaryLines(res(pair({ unproven: 1 })) as never, d).join("\n")).not.toMatch(GREEN);
    expect(clearanceSummaryLines(res(pair({})) as never, { ...d, motion: { ...d.motion!, clearance: { ...d.motion!.clearance!, refine: false } } }).join("\n")).not.toMatch(GREEN);
    expect(clearanceSummaryLines({ steps, collisionsChecked: false } as never, d)).toEqual([]); // vůle nespočítána = žádná věta
  });

  it("8c. vůle pod limitem jen mezi kroky: ne „dodržen v celém pohybu“, ne „v 1 z N poloh (kroky K)“ – zvlášť „mezi kroky 17 a 18“", () => {
    // kolo 6: dřív úsek 17–18 započten jako krok 18 („pod limitem 0,05 mm v 1 z 37 poloh (kroky 18)“, krok 18 = 1,25 mm)
    const steps = Array.from({ length: 37 }, (_, i) => ({ i, t: i / 18, motors: [12 + 5 * i], clashes: [] }));
    const series = steps.map(() => 1.25);
    const p: ClearancePair = { a: "r", b: "pl", min: { d: 0.03, exact: true, pos: 17.44, t: 0.969, motors: [99.19], between: [17, 18], sweep: true, located: true }, series, pts: series.map(() => null), below: [], belowBetween: [[17, 18]], unproven: 0 };
    const res = { steps, collisionsChecked: false, clearance: { limit: 0.05, moving: false, pairs: [p], poses: 37, refined: 36 } };
    const d = { ...doc, motion: { motors: [], duration: 2, steps: 36, clearance: { pairs: [{ a: "r", b: "pl" }], limit: 0.05 } } } as CadDoc;
    const t = clearanceSummaryLines(res as never, d).join("\n");
    expect(t).not.toMatch(/dodržen/);
    expect(t).not.toMatch(/z 37 poloh|\(kroky 18\)/);
    expect(t).toMatch(/⚠ pod limitem 0,05 mm mezi kroky 17 a 18 \(v polohách kroků nad limitem\)/);
    expect(t).toMatch(/nejmenší 0,03 mm mezi kroky 17 a 18 \(po přímé dráze: poloha 17,44, t = 0,969 s, motory 99,19\)/);
  });

  it("8b. `stav` motion=ok jen bez vůle pod limitem; „Kolize: žádný průnik“ bez sledované vůle vždy s „vůle nekontrolována“", () => {
    // fáze 2 kolo 3: dřív motion=ok, i když text stavu ⚠ vůle pod limitem měl; souhrn pohybu bez vůle neříkal „vůle nekontrolována“
    const steps = [0, 1, 2].map((i) => ({ i, t: i, motors: [i], clashes: [] as ClashDetail[], place: {}, conflicts: [] }));
    const sw: SweepInfo = { mode: "continuous", poses: 3, refined: 2, bounded: 2, swept: 0, contacts: 0, covered: 0, unproven: 0, unprovenContact: 0, unprovenAt: [], maxStep: 5, maxTurn: 0, between: "solver" };
    const plain = motionClashSummary({ steps, collisionsChecked: true, sweep: sw }, doc).lines[0];
    expect(plain).toMatch(/^Kolize: žádný průnik v 3 polohách · vůle nekontrolována/);
    const pair = (d: number, below: number[]): ClearancePair => ({ a: "r", b: "pl", min: { d, exact: true, pos: 0, t: 0, motors: [0] }, series: [d, d, d], pts: [null, null, null], below, unproven: 0 });
    const clr = (p: ClearancePair) => ({ limit: 0.05, moving: true, pairs: [p], poses: 3, refined: 0, reach: 1.1 });
    expect(motionClashSummary({ steps, collisionsChecked: true, sweep: sw, clearance: clr(pair(0.2, [])) }, doc).lines[0]).not.toMatch(/vůle nekontrolována/);
    const md = { ...doc, motion: { motors: [{ id: "m", kind: "linear" as const, mate: "x", from: 0, to: 1 }], duration: 1, steps: 2, collisions: true, clearance: { pairs: "moving" as const, limit: 0.05 } } } as CadDoc;
    const verdict = (p: ClearancePair) => {
      const store = motionStoreOf({});
      const res = { steps, comps: [], motors: md.motion!.motors, collision: null, collisionsChecked: true, conflictSteps: 0, sweep: sw, clearance: clr(p) };
      store.byDoc.set("k", { ...motionSigParts(md), res: res as never, seq: 1, at: 0, doc: "S", comps: 4 });
      return motionStatusOf(store, "k", md)!;
    };
    const low = verdict(pair(0.01, [0, 1, 2]));
    expect(low.state).toBe("warn");
    expect(low.line).toMatch(/0,01 mm < limit 0,05 mm \(⚠ 1 dvojic\)/);
    expect(verdict(pair(0.2, [])).state).toBe("ok");
  });
});

describe("vlna 22 C3: žádné falešné zelené v procesní vrstvě (bod 4)", () => {
  const pdoc = {
    ...doc,
    components: [comp("pl", "Plech"), { ...comp("r", "Razník"), placement: { position: [0, 0, 20], rotation: [0, 0, 0] } }],
    motion: { motors: [{ id: "m", kind: "linear", mate: "z", from: 0, to: 1 }], duration: 1, steps: 2, collisions: true, process: [{ id: "p", kind: "cut", tool: "r", target: "pl", at: { t: 0.5 } }] },
  } as unknown as CadDoc;
  // krok 0 bez průniku, krok 1 a 2 razník v plechu (geometricky „skutečná“ kolize z jádra)
  const res = {
    steps: [0, 1, 2].map((i) => ({ i, t: i / 2, motors: [i / 2], place: { pl: { position: [0, 0, 0], rotation: [0, 0, 0] }, r: { position: [0, 0, 20 - 10 * i], rotation: [0, 0, 0] } }, conflicts: [], clashes: i ? [det("pl", "r", "real")] : [] })),
    comps: [],
    motors: [],
    collision: null,
    collisionsChecked: true,
    conflictSteps: 0,
    level: { level: "kinematic" },
  } as unknown as MotionResult;
  const kernel = async (q: ProcReq): Promise<ProcRes> => ({
    steps: q.rels.map((m, i) => (m && i >= 1 ? { contact: true, depth: 1, through: i === 2, state: i } : { contact: false, depth: 0, through: false, state: 0 })),
    states: [{ removed: 0, volume: 100, scrap: [] }, { removed: 50, volume: 50, scrap: [] }, { removed: 50, volume: 50, scrap: [{ volume: 50, center: [0, 0, 0] }] }],
    dir: [0, 0, -1],
    thickness: 1,
    volume0: 100,
    ms: 0,
  });

  it("9. pracovní záběr procesu: ani „Kolize: žádný průnik“, ani ⚠ skutečná; před začátkem operace ⚠ zůstává", async () => {
    const out = await processRun(pdoc, res, { process: kernel });
    const sum = motionClashSummary(out, pdoc);
    expect(sum.lines.join("\n")).not.toMatch(/Kolize: žádný průnik|žádné ve všech krocích/);
    expect(sum.lines[0]).toMatch(/pracovní kontakt 1 dvojic/);
    expect(sum.codes.map((c) => c.code)).toEqual(["clash.work"]);
    expect(firstFault(out, pdoc)).toBeNull();
    // operace začne až v t = 0,7 → krok 1 (t = 0,5) je skutečná kolize
    const late = await processRun({ ...pdoc, motion: { ...pdoc.motion!, process: [{ id: "p", kind: "cut", tool: "r", target: "pl", at: { t: 0.7 } }] } }, res, { process: kernel });
    expect(motionClashSummary(late, pdoc).codes.map((c) => c.code)).toEqual(["clash.real", "clash.work"]);
    expect(stepHasFault(pdoc, late.steps[1])).toBe(true);
  });

  it("10. úroveň a věta o materiálové simulaci vždy s výsledkem; bez jádra žádný „děrovaný“, jen ⚠ nespočítáno", async () => {
    const out = await processRun(pdoc, res, { process: kernel });
    expect(levelLine(out.level!)).toMatch(/^Úroveň simulace: kinematika \+ geometrická aproximace/);
    expect(processLines(out, pdoc)[0]).toMatch(/není to simulace materiálu/);
    expect(processStatusText(out, pdoc)).toMatch(/ne simulace materiálu/);
    // bez procesní vrstvy žádné „+ geometrická aproximace“
    expect(levelLine(res.level!)).not.toMatch(/geometrická aproximace/);
    const none = await processRun(pdoc, res, {});
    expect(processOf(none)!.ops[0].contact).toBeNull();
    expect(processLines(none, pdoc).join("\n")).not.toMatch(/děrovaný|odebráno|prostřiženo/);
    expect(processStatusText(none, pdoc)).not.toMatch(/děrovaný|odebráno/);
    expect(processCodes(none, pdoc).map((c) => c.code)).toContain("motion.process-failed");
  });

  it("11. záběr možný jen mezi kroky a mezipolohy nespočítané: nikdy „nezasáhl“, „plný“ na konci ani ⚠ process-miss", async () => {
    // kolo 6: dřív „bez záběru – nástroj obrobek nezasáhl“ + „na konci plný“ vedle ℹ clash.work 314 mm³ mezi kroky
    const jump = { ...res, steps: res.steps.map((s) => ({ ...s, clashes: [] })) } as unknown as MotionResult;
    const calls: ProcReq[] = [];
    const k2 = async (q: ProcReq): Promise<ProcRes> => {
      calls.push(q);
      const base = { states: [{ removed: 0, volume: 100, scrap: [] }], dir: [0, 0, -1] as [number, number, number], thickness: null, volume0: 100, ms: 0 };
      if (q.plan) return { ...base, steps: [], gaps: [{ i: 1, n: 2 }] };
      // v polohách kroků nástroj obrobek nemá; v mezipolohách (kolik jich je navíc) prostřihne
      return { ...base, steps: q.rels.map((m, i) => (m && q.rels.length > 3 && i === 1 ? { contact: true, depth: 1, through: true, state: 1 } : { contact: false, depth: 0, through: i > 1 && q.rels.length > 3, state: i > 1 && q.rels.length > 3 ? 1 : 0 })), states: [...base.states, { removed: 50, volume: 50, scrap: [{ volume: 50, center: [0, 0, 0] }] }] };
    };
    const d0 = { ...pdoc, motion: { ...pdoc.motion!, process: [{ id: "p", kind: "cut", tool: "r", target: "pl" }] } } as unknown as CadDoc;
    const blind = await processRun(d0, jump, { process: k2 }); // bez řešiče mezipoloh (dynamika)
    const txt = [...processLines(blind, d0), processStatusText(blind, d0)].join("\n");
    expect(txt).not.toMatch(/nezasáhl/);
    expect(processStatusText(blind, d0)).not.toMatch(/plný/);
    expect(txt).toMatch(/výsledek procesu nezjištěn/);
    const codes = processCodes(blind, d0).map((c) => c.code);
    expect(codes).not.toContain("motion.process-miss");
    expect(codes).toContain("motion.process-between");
    // s mezipolohami z řešiče: požadavek s polohami navíc, výsledek po krocích studie (děrovaný od kroku 1)
    const seen = await processRun(d0, jump, { process: k2 }, { poseAt: (_k, t) => ({ place: { pl: { position: [0, 0, 0], rotation: [0, 0, 0] }, r: { position: [0, 0, 20 - 20 * t], rotation: [0, 0, 0] } } }) });
    expect(calls.some((q) => !q.plan && q.rels.length === 5)).toBe(true);
    expect(processOf(seen)!.ops[0].steps.length).toBe(3);
    expect(processOf(seen)!.ops[0].contact?.between).toEqual([0, 1]);
    expect(processStatusText(seen, d0)).toMatch(/děrovaný/);
    expect(processCodes(seen, d0).map((c) => c.code)).not.toContain("motion.process-between");
  });

  it("11b. úsek nad strop mezipoloh (tenký nástroj, dlouhý krok): nikdy „nezasáhl“ / „plný“ – ⚠ process-between „víc než 64 mezipoloh“", async () => {
    // kolo 6 oprava (oponent): plán vrátil `capped`, planSub ho nečetl – přidal 64 poloh, nástroj obrobkem dál „proskočil“ a
    // vrstva psala „bez záběru – nástroj obrobek nezasáhl“, „plný“ a ⚠ process-miss vedle ℹ clash.work mezi kroky
    const jump = { ...res, steps: res.steps.map((s) => ({ ...s, clashes: [] })) } as unknown as MotionResult;
    const calls: ProcReq[] = [];
    const k3 = async (q: ProcReq): Promise<ProcRes> => {
      calls.push(q);
      const base = { states: [{ removed: 0, volume: 100, scrap: [] }], dir: [0, 0, -1] as [number, number, number], thickness: null, volume0: 100, ms: 0 };
      if (q.plan) return { ...base, steps: [], gaps: [{ i: 1, n: 64, capped: true }] };
      return { ...base, steps: q.rels.map(() => ({ contact: false, depth: 0, through: false, state: 0 })) }; // ani 64 poloh nástroj nezachytí
    };
    const d0 = { ...pdoc, motion: { ...pdoc.motion!, process: [{ id: "p", kind: "cut", tool: "r", target: "pl" }] } } as unknown as CadDoc;
    const out = await processRun(d0, jump, { process: k3 }, { poseAt: (_k, t) => ({ place: { pl: { position: [0, 0, 0], rotation: [0, 0, 0] }, r: { position: [0, 0, 20 - 20 * t], rotation: [0, 0, 0] } } }) });
    const txt = [...processLines(out, d0), processStatusText(out, d0)].join("\n");
    expect(txt).not.toMatch(/nezasáhl/);
    expect(processStatusText(out, d0)).not.toMatch(/plný/);
    expect(txt).toMatch(/záběr jen mezi kroky – výsledek procesu nezjištěn \(úsek před krokem 1 by potřeboval víc než 64 mezipoloh\)/);
    const codes = processCodes(out, d0);
    expect(codes.map((c) => c.code)).not.toContain("motion.process-miss");
    expect(codes.find((c) => c.code === "motion.process-between")?.text).toMatch(/víc než 64 mezipoloh/);
    expect(processOf(out)!.ops[0]).toMatchObject({ unresolved: 1, unresolvedWhy: "cap" });
    // poloviční vzorek úseku se nepočítá (výsledek by byl jen zdánlivý): požadavek výpočtu jen s polohami kroků
    expect(calls.filter((q) => !q.plan).every((q) => q.rels.length === 3)).toBe(true);
  });

  it("11c. spojitá kontrola kolizí našla nástroj × obrobek mezi kroky, procesní vrstva nic: nezjištěn, ne „nezasáhl“", async () => {
    // pojistka: plán úsek nevybral (žádné mezery), jádro v polohách kroků záběr nenašlo, kontrola kolizí mezi kroky 0 a 1 ano
    const jump = { ...res, steps: res.steps.map((s) => ({ ...s, clashes: [] })), between: [{ k0: 0, k1: 1, clashes: [det("pl", "r", "real", { volume: 9.817 })] }] } as unknown as MotionResult;
    const k4 = async (q: ProcReq): Promise<ProcRes> => ({ states: [{ removed: 0, volume: 100, scrap: [] }], dir: [0, 0, -1], thickness: null, volume0: 100, ms: 0, steps: q.plan ? [] : q.rels.map(() => ({ contact: false, depth: 0, through: false, state: 0 })) });
    const d0 = { ...pdoc, motion: { ...pdoc.motion!, process: [{ id: "p", kind: "cut", tool: "r", target: "pl" }] } } as unknown as CadDoc;
    const out = await processRun(d0, jump, { process: k4 });
    const txt = [...processLines(out, d0), processStatusText(out, d0)].join("\n");
    expect(txt).not.toMatch(/nezasáhl/);
    expect(processStatusText(out, d0)).not.toMatch(/plný/);
    expect(txt).toMatch(/kontrola kolizí našla průnik před krokem 1, procesní vrstva v polohách ne/);
    const codes = processCodes(out, d0).map((c) => c.code);
    expect(codes).not.toContain("motion.process-miss");
    expect(codes).toContain("motion.process-between");
    expect(processOf(out)!.ops[0]).toMatchObject({ unresolved: 1, unresolvedWhy: "clash" });
    // stejná kolize mezi kroky, ale jiná dvojice (ne nástroj × obrobek operace): pojistka se nezapne, ⚠ process-miss zůstává
    const other = { ...jump, between: [{ k0: 0, k1: 1, clashes: [det("d", "r", "real")] }] } as unknown as MotionResult;
    const o2 = await processRun(d0, other, { process: k4 });
    expect(processCodes(o2, d0).map((c) => c.code)).toContain("motion.process-miss");
  });
  it("11d. podmínka operace splněná UPROSTŘED kroku (kolo 7): nikdy „nezasáhl“ / „plný“ – úsek začíná polohou v okamžiku začátku", async () => {
    // oponent kola 6: `při motor 1 <= 5` uprostřed jediného kroku – plán úsek přeskočil (poloha kroku 0 je před začátkem
    // neaktivní), vrstva psala „bez záběru – nástroj obrobek nezasáhl“, „plný“ a ⚠ process-miss, ač razník plech prorazil
    const one = { ...res, steps: [res.steps[0], { ...res.steps[2], i: 1 }].map((s) => ({ ...s, clashes: [] })) } as unknown as MotionResult;
    const calls: ProcReq[] = [];
    // razník v t = 0,3 nad plechem, v t ∈ (0,4; 0,6) v plechu, v kroku 1 (t = 1) pod ním – záběr jen mezi polohami
    const zAt = (t: number) => 20 - 40 * t;
    const k5 = async (q: ProcReq): Promise<ProcRes> => {
      calls.push(q);
      const base = { states: [{ removed: 0, volume: 100, scrap: [] }], dir: [0, 0, -1] as [number, number, number], thickness: null, volume0: 100, ms: 0 };
      const z = q.rels.map((m) => (m ? m[11] : null));
      if (q.plan) {
        const gaps: NonNullable<ProcRes["gaps"]> = [];
        const near: number[] = [];
        for (let i = 1; i < z.length; i++) if (z[i - 1] !== null && z[i] !== null) (near.push(i), gaps.push({ i, n: 3 }));
        return { ...base, steps: [], ...(gaps.length ? { gaps, near } : {}) };
      }
      let hit = false;
      return { ...base, steps: z.map((v) => (v !== null && v <= 4 && v >= -4 ? ((hit = true), { contact: true, depth: 1, through: true, state: 1 }) : { contact: false, depth: 0, through: hit, state: hit ? 1 : 0 })), states: [...base.states, { removed: 50, volume: 50, scrap: [{ volume: 50, center: [0, 0, 0] }] }] };
    };
    const d0 = { ...pdoc, motion: { ...pdoc.motion!, steps: 1, process: [{ id: "p", kind: "cut", tool: "r", target: "pl", at: { motor: "m", op: ">=", value: 0.3 } }] } } as unknown as CadDoc;
    const poseAt = (_k: number, t: number) => ({ place: { pl: { position: [0, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 }, r: { position: [0, 0, zAt(t)] as Vec3, rotation: [0, 0, 0] as Vec3 } } });
    const out = await processRun(d0, one, { process: k5 }, { poseAt });
    const txt = [...processLines(out, d0), processStatusText(out, d0)].join("\n");
    expect(txt).not.toMatch(/nezasáhl/);
    expect(processStatusText(out, d0)).not.toMatch(/plný/);
    expect(processStatusText(out, d0)).toMatch(/děrovaný/);
    expect(processCodes(out, d0).map((c) => c.code)).not.toContain("motion.process-miss");
    // první poloha úseku = okamžik začátku (t = 0,3), mezipolohy mezi začátkem a krokem 1 – nic před začátkem
    const o = processOf(out)!;
    expect(o.sub?.[0].t).toBeCloseTo(0.3, 9);
    expect(o.sub!.every((x) => x.t >= 0.3 - 1e-9 && x.t < 1)).toBe(true);
    expect(o.ops[0].contact?.between).toEqual([0, 1]);
    // bez řešiče mezipoloh (dynamika) a s dráhou přes obrobek: nezjištěn, nikdy „nezasáhl“ / „plný“
    const blind = await processRun(d0, one, { process: k5 });
    expect([...processLines(blind, d0), processStatusText(blind, d0)].join("\n")).not.toMatch(/nezasáhl|na konci „Plech“ plný/);
    expect(processCodes(blind, d0).map((c) => c.code)).toContain("motion.process-between");
    expect(calls.length).toBeGreaterThan(0);
  });

  it("11e. strop mezipoloh jedné operace nepřebije spočitatelnou operaci téhož úseku; odebraný objem pak jen „nejméně“ (kolo 7)", async () => {
    // NIT oponenta kola 6: `capped` platil pro úsek – i druhá operace (tlustý razník, 3 mezipolohy) psala „nezjištěn … víc než 64
    // mezipoloh“ a její výsledek se ztratil; celkový objem se pak nesmí tvrdit přesně
    const jump = { ...res, steps: res.steps.map((s) => ({ ...s, clashes: [] })) } as unknown as MotionResult;
    const kc = async (q: ProcReq): Promise<ProcRes> => {
      const base = { states: [{ removed: 0, volume: 100, scrap: [] }], dir: [0, 0, -1] as [number, number, number], thickness: null, volume0: 100, ms: 0 };
      // tenký střižník stojí v x = 5 (souřadnice nástroje v obrobku), tlustý razník v x = 0
      const thinOf = (rels: ProcReq["rels"]) => rels.find(Boolean)?.[9] === 5;
      const thin = thinOf(q.rels);
      if (q.plan) return { ...base, steps: [], gaps: [{ i: 1, n: thin ? 64 : 3, ...(thin ? { capped: true as const } : {}) }], near: [1] };
      const n = q.rels.length;
      const row = (hit: boolean) => q.rels.map((_m, i) => (hit && i === 1 ? { contact: true, depth: 1, through: true, state: 1 } : { contact: false, depth: 0, through: hit && i > 1, state: hit && i > 1 ? 1 : 0 }));
      const st = row(!thin && n > 3); // tlustý razník zachytí mezipoloha, tenký nic
      const states = [...base.states, { removed: 40, volume: 60, scrap: [{ volume: 40, center: [0, 0, 0] as Vec3 }] }];
      const comb = row(n > 3 && (!thin || !!q.others?.some((o) => !thinOf(o.rels))));
      return { ...base, steps: st, states, ...(q.others?.length ? { combined: { steps: comb.map((x) => x.state), states } } : {}) };
    };
    const two = { ...pdoc, components: [...pdoc.components!, { ...comp("s", "Střižník"), placement: { position: [5, 0, 20], rotation: [0, 0, 0] } }], motion: { ...pdoc.motion!, process: [{ id: "a", kind: "cut", tool: "r", target: "pl" }, { id: "b", kind: "cut", tool: "s", target: "pl" }] } } as unknown as CadDoc;
    const poseAt = (_k: number, t: number) => ({ place: { pl: { position: [0, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 }, r: { position: [0, 0, 20 - 20 * t] as Vec3, rotation: [0, 0, 0] as Vec3 }, s: { position: [5, 0, 20 - 20 * t] as Vec3, rotation: [0, 0, 0] as Vec3 } } });
    const out = await processRun(two, jump, { process: kc }, { poseAt });
    const ops = processOf(out)!.ops;
    expect(ops[0].unresolved).toBeUndefined(); // razník: spočítán
    expect(ops[0].contact).not.toBeNull();
    expect(ops[1]).toMatchObject({ unresolved: 1, unresolvedWhy: "cap" }); // jen střižník nezjištěn
    const lines = processLines(out, two).join("\n");
    expect(lines).not.toMatch(/celkem odebráno/);
    expect(lines).toMatch(/odebráno nejméně 40 mm³ – výsledek některé operace nezjištěn/);
    expect(processStatusText(out, two)).toMatch(/odebráno nejméně 40 mm³/);
    expect(processKv(out)).toContain("removed=40+");
  });
});

describe("vlna 22 C2 kolo 6: spojitá vůle se skutečným jádrem není větší než jemné vzorkování téže dráhy (bod 6)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { setHostAssets } = await import("../host-assets");
  const { makeKernelClient } = await import("../kernel-client");
  const { inProcessTransport } = await import("../kernel-inprocess");
  const { runReport } = await import("../engine/run-protocol");
  const { formatConsole, formatShort } = await import("../engine/protocol");
  const WASM = path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
  const FONTS = path.resolve(__dirname, "../../../public/fonts");
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const host = (): EngineHost => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() });
  const setup = fs.readFileSync(path.resolve(__dirname, "../engine/__corpus__/74h-clearance-pin-side.txt"), "utf8").split("\n").filter((l) => !/^(#|pohyb|stav)/.test(l));

  it("12. „limit dodržen … spojitě“ nevyjde, když 360 kroků téže dráhy najde vůli pod limitem (dřív 36 kroků 1,03 mm ✓, 360 kroků 0,03 mm ⚠)", async () => {
    const run = async (steps: number, pair: string) => {
      const r = await runReport(new MemoryWorkspace(), [...setup, `pohyb motor lineární vazba "POSUV" 12..192 kroky ${steps} kolize`, `pohyb vůle ${pair} min 0,05`].join("\n"), host());
      const short = formatShort(r, { budget: Infinity, notes: true });
      const min = Number(/ clear\.min=([\d.]+)/.exec(short)![1]);
      return { min, con: formatConsole(r), short };
    };
    const fine = await run(360, '"Nůž" "Kolík"');
    expect(fine.min).toBeLessThan(0.05); // jemné vzorkování: pod limitem
    for (const pair of ['"Nůž" "Kolík"', '"Kolík" "Nůž"']) {
      const coarse = await run(36, pair);
      // spojitá kontrola je nejvýš tak velká jako nejmenší vzorek téže dráhy (je to minimum přes celou dráhu)
      expect(coarse.min, pair).toBeLessThanOrEqual(fine.min + 1e-6);
      expect(coarse.con, pair).not.toMatch(/limit 0,05 mm dodržen v celém pohybu/);
      expect(coarse.short, pair).toMatch(/clash\.clearance/);
    }
  }, 600_000);
});
