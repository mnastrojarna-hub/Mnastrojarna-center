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
import type { AsmComponent, BuildResult, CadDoc, ComponentSource } from "../types";
import { emptyDoc } from "../types";
import type { MotionResult } from "../motion";
import { levelLine } from "../motion-mode";
import { processCodes, processLines, processOf, processRun, processStatusText } from "../motion-process";
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
    expect(motionClashSummary(st([]), doc).lines).toEqual(["Kolize: žádný průnik v 3 polohách", " kontrolováno jen v 3 polohách (diskrétně, bez posunu mezi polohami) – mezi polohami nekontrolováno"]);
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
});
