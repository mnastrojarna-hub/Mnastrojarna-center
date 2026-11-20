/**
 * Procesní vrstva pohybové studie (vlna 22, bod 4) – čisté části bez jádra: okno operace (poloha / čas / motor / vazba / fáze),
 * stavový automat výrobku (plný → v záběru → děrovaný / označený / naříznutý), pravidlo polohy odpadu, matice nástroje v souřadnicích
 * obrobku, zařazení pracovního kontaktu (ℹ work, nikdy ⚠ real), texty s úrovní a strojová pole. Jádro nahrazuje zkušební `process`.
 */
import { describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { motionCsv, type MotionResult, type MotionStep } from "./motion";
import { opPhase, opStart, processCodes, processKv, processLines, processRun, productLines, productStates, relMatrix, scrapOffset, condProblem, processOf, processStatusText, type ProcOpResult } from "./motion-process";
import type { ProcReq, ProcRes, ProcStep } from "./process-types";
import type { CadDoc, MotionStudy, ProcessOp } from "./types";

setLang("cs");

const part = (name: string): CadDoc => ({ app: "mnastrojarna-cad", version: 2, name, material: "ocel", features: [] });
/** sestava: plech ukotvený v z 10, razník nad ním; razník jede dolů 20 → 8 po 1 mm (13 kroků) a zpět */
function setup(ops: ProcessOp[] = [{ id: "p1", kind: "cut", tool: "R", target: "P" }]): { doc: CadDoc; res: MotionResult } {
  const study: MotionStudy = { motors: [{ id: "m1", kind: "linear", mate: "Z", from: 10, to: -2 }], duration: 2, steps: 16, process: ops, phases: [{ id: "f1", name: "Střih", start: { t: 1 } }] };
  const doc: CadDoc = {
    app: "mnastrojarna-cad",
    version: 2,
    name: "Lis",
    kind: "assembly",
    material: "ocel",
    features: [],
    components: [
      { id: "P", name: "Plech", source: { kind: "part", doc: part("Plech") }, placement: { position: [10, 10, 10], rotation: [0, 0, 0] }, fixed: true },
      { id: "R", name: "Razník", source: { kind: "part", doc: part("Razník") }, placement: { position: [50, 50, 20], rotation: [0, 0, 0] } },
    ],
    mates: [{ id: "Z", type: "distance", a: { compId: "R", face: 0 }, b: { compId: "P", face: 0 }, value: 10, name: "ZDVIH" }],
    motion: study,
  } as unknown as CadDoc;
  const zs = [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 12, 16, 20, 20];
  const steps: MotionStep[] = zs.map((z, i) => ({
    i,
    t: (2 * i) / 16,
    motors: [z - 10],
    place: { P: { position: [10, 10, 10], rotation: [0, 0, 0] }, R: { position: [50, 50, z], rotation: [0, 0, 0] } },
    conflicts: [],
    // průnik razník × plech, dokud spodek razníku (z) je pod horní plochou plechu (11) a nad spodní (10) nebo v průchodu
    ...(z < 11 ? { clashes: [{ a: "P", b: "R", volume: 314.159, cls: "real" as const, why: "no-thread" as const }] } : { clashes: [] }),
  }));
  const res = { steps, comps: [], motors: study.motors, collision: { a: "P", b: "R", volume: 314.159, step: 10, t: 1.25 }, collisionsChecked: true, conflictSteps: 0, phases: [{ id: "f1", name: "Střih", index: 0, reached: true, step: 8, t: 1, mode: "kinematic", conflictSteps: 0, stopped: 0, invalid: 0 }] } as unknown as MotionResult;
  return { doc, res };
}
/** zkušební jádro: záběr od z < 11 (z = 10: celá tloušťka, ale hrot ještě v rovině spodní plochy), prostřiženo od z = 9 */
function fakeKernel(calls: ProcReq[] = []) {
  return async (req: ProcReq): Promise<ProcRes> => {
    calls.push(req);
    const states: ProcRes["states"] = [{ removed: 0, volume: 6400, scrap: [] }];
    let st = 0;
    let depth = 0;
    let through = false;
    const steps: ProcStep[] = req.rels.map((m) => {
      if (!m) return { contact: false, depth, through, state: st };
      const z = m[11] + 10; // poloha razníku v souřadnicích plechu → svět
      if (z >= 11) return { contact: false, depth, through, state: st };
      const pen = Math.min(1, 11 - z);
      const lim = req.depth !== undefined ? Math.min(pen, req.depth) : pen;
      if (lim > depth) {
        depth = lim;
        through = req.kind === "cut" && req.depth === undefined && 11 - z > 1 + 1e-3;
        states.push({ removed: 314.159 * depth, volume: 6400 - 314.159 * depth, scrap: through ? [{ volume: 314.159, center: [40, 40, 0.5] }] : [] });
        st = states.length - 1;
      } else if (req.kind === "cut" && req.depth === undefined && 11 - z > 1 + 1e-3 && !through) {
        through = true;
        states.push({ ...states[st], scrap: [{ volume: 314.159, center: [40, 40, 0.5] }] });
        st = states.length - 1;
      }
      return { contact: true, depth, through, state: st };
    });
    return { steps, states, dir: [0, 0, -1], thickness: 1, volume0: 6400, ms: 1 };
  };
}

describe("procesní vrstva – okno operace", () => {
  const { doc, res } = setup();
  it("bez podmínky = od začátku (rozhoduje dotyk)", () => {
    expect(opStart({}, res, doc.motion!)).toEqual({ step: 0, t: 0 });
  });
  it("čas: první krok s t ≥ T", () => {
    expect(opStart({ at: { t: 0.6 } }, res, doc.motion!)).toEqual({ step: 5, t: 0.6 });
  });
  it("motor: první krok, kdy hodnota splní podmínku; okamžik lineárně mezi kroky", () => {
    const s = opStart({ at: { motor: "m1", op: "<=", value: 0.5 } }, res, doc.motion!)!;
    expect(s.step).toBe(10);
    expect(s.t).toBeCloseTo(1.1875, 6);
  });
  it("vazba poháněná motorem = hodnota motoru; vazba bez motoru = chyba s nápovědou", () => {
    expect(opStart({ at: { mate: "Z", op: "<=", value: 2 } }, res, doc.motion!)!.step).toBe(8);
    expect(condProblem({ at: { mate: "X", op: "<=", value: 2 } }, doc.motion!)).toMatch(/nepohání žádný motor/);
    expect(condProblem({ at: { motor: "m1", op: "<=", value: 2 } }, doc.motion!)).toBeNull();
  });
  it("fáze: krok začátku fáze; nedosažená fáze = null (operace nezačne)", () => {
    expect(opStart({ at: { phase: "f1" } }, res, doc.motion!)).toEqual({ step: 8, t: 1 });
    const r2 = { ...res, phases: [{ ...res.phases![0], reached: false, step: undefined }] } as MotionResult;
    expect(opStart({ at: { phase: "f1" } }, r2, doc.motion!)).toBeNull();
  });
  it("podmínka, která nenastane → null", () => {
    expect(opStart({ at: { motor: "m1", op: "<=", value: -50 } }, res, doc.motion!)).toBeNull();
  });
});

describe("procesní vrstva – stavový automat výrobku", () => {
  const s = (p: Partial<ProcStep>): ProcStep => ({ contact: false, depth: 0, through: false, state: 0, ...p });
  it("plný → v záběru → děrovaný (střih); otisk po odjetí nástroje = označený; nástřih = naříznutý", () => {
    expect(opPhase("cut", s({}))).toBe("idle");
    expect(opPhase("cut", s({ contact: true, state: 1, depth: 0.5 }))).toBe("engaged");
    expect(opPhase("cut", s({ contact: true, state: 2, through: true }))).toBe("cut");
    expect(opPhase("cut", s({ contact: false, state: 2, through: true }))).toBe("cut");
    expect(opPhase("imprint", s({ contact: false, state: 1 }))).toBe("imprinted");
    expect(opPhase("cut", s({ contact: false, state: 1 }))).toBe("notched");
    expect(opPhase("cut", undefined)).toBe("idle");
  });
});

describe("procesní vrstva – výpočet nad výsledkem (zkušební jádro)", async () => {
  const { doc, res } = setup();
  const calls: ProcReq[] = [];
  const out = await processRun(doc, res, { process: fakeKernel(calls) });
  const proc = processOf(out)!;
  it("matice nástroje v souřadnicích obrobku po krocích; před začátkem operace null", async () => {
    expect(calls[0].rels).toHaveLength(17);
    expect(calls[0].rels[0]!.slice(9)).toEqual([40, 40, 10]);
    expect(relMatrix({ position: [10, 10, 10], rotation: [0, 0, 90] }, { position: [10, 20, 10], rotation: [0, 0, 90] }).slice(9).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([10, 0, 0]);
    const late = await processRun({ ...doc, motion: { ...doc.motion!, process: [{ id: "p1", kind: "cut", tool: "R", target: "P", at: { t: 1 } }] } }, res, { process: fakeKernel(calls) });
    expect(calls[calls.length - 1].rels.slice(0, 8).every((m) => m === null)).toBe(true);
    expect(processOf(late)!.ops[0].start).toEqual({ step: 8, t: 1 });
  });
  it("záběr, prostřižení, odebraný objem, odpad; krok 0 = plný (dokument se nemění)", () => {
    const o = proc.ops[0];
    expect(o.contact?.step).toBe(10);
    expect(o.through?.step).toBe(11);
    expect(o.removed).toBeCloseTo(314.159, 3);
    expect(productStates(proc, 0)[0].phase).toBe("full");
    expect(productStates(proc, 10)[0].phase).toBe("engaged");
    expect(productStates(proc, 11)[0]).toMatchObject({ phase: "pierced", scrap: 1 });
    expect(productStates(proc, 16)[0].phase).toBe("pierced");
    expect(doc.components![0].source).toEqual({ kind: "part", doc: part("Plech") });
  });
  it("pracovní záběr nástroje do obrobku = třída work (pravidlo procesu), nikdy real; první skutečná kolize zmizí", () => {
    const cls = out.steps.flatMap((s) => (s.clashes ?? []).map((c) => c.cls));
    expect(cls.length).toBeGreaterThan(0);
    expect(cls.every((c) => c === "work")).toBe(true);
    expect(out.collision).toBeNull();
    expect((out.steps[11].clashes![0] as { rule?: string }).rule).toMatch(/^proces střih 1/);
  });
  it("záběr PŘED začátkem operace zůstává skutečnou kolizí", async () => {
    const r = await processRun({ ...doc, motion: { ...doc.motion!, process: [{ id: "p1", kind: "cut", tool: "R", target: "P", at: { t: 1.4 } }] } }, res, { process: fakeKernel() });
    expect(r.steps[10].clashes![0].cls).toBe("real");
    expect(r.steps[12].clashes![0].cls).toBe("work");
    expect(r.collision?.step).toBe(10);
  });
  it("úroveň + geometrická aproximace, věta „není to simulace materiálu“, stav výrobku po krocích", () => {
    expect(out.level?.geo).toBe(true);
    const lines = processLines(out, doc);
    expect(lines[0]).toMatch(/geometrická aproximace – booleovské odebrání .*není to simulace materiálu \(žádné síly, otřep, odpružení ani tok materiálu\)/);
    expect(lines.join("\n")).toMatch(/střih 1 „Razník“ → „Plech“: záběr od kroku 10 .* prostřiženo v kroku 11 .* odebráno 314,159 mm³ · hloubka 1 mm · odpad 1 ks/);
    expect(lines.join("\n")).toMatch(/Stav výrobku „Plech“: plný \(kroky 0–9\) → v záběru \(krok 10\) → děrovaný \(kroky 11–16\)/);
    expect(productLines(out, doc, 0)).toEqual([" stav výrobku „Plech“: plný"]);
    expect(processStatusText(out, doc)).toMatch(/geometrická aproximace, ne simulace materiálu\): na konci „Plech“ děrovaný, odebráno 314,159 mm³, odpad 1/);
  });
  // fáze 2 kolo 3: dvě operace na TÉMŽE obrobku se nesčítají (dřív removed=628.319 scrap=2 pro druhý střih do téže díry)
  it("dvě operace na témže obrobku: požadavek nese ostatní operace; bez kombinace z jádra jen dolní mez „+“ a ⚠, nikdy součet", async () => {
    const two: ProcessOp[] = [{ id: "p1", kind: "cut", tool: "R", target: "P" }, { id: "p2", kind: "cut", tool: "R", target: "P" }];
    const reqs: ProcReq[] = [];
    const r = await processRun({ ...doc, motion: { ...doc.motion!, process: two } }, res, { process: fakeKernel(reqs) });
    expect(reqs[0].others).toBeUndefined(); // první operace sama
    expect(reqs[1].others).toHaveLength(1); // poslední operace obrobku nese ostatní → kombinovaný stav
    const kv = processKv(r);
    expect(kv).toContain("removed=314.159+");
    expect(kv).not.toContain("removed=628.318");
    expect(kv).toContain("scrap=1");
    expect(processCodes(r, doc).map((c) => c.code)).toContain("motion.process-failed");
    expect(processLines(r, doc).join("\n")).toMatch(/„Plech“: 2 operací, odebráno nejméně 314,159 mm³ – sjednocení operací nespočítáno/);
    // s kombinací z jádra: stav obrobku po obou operacích (sjednocení)
    const comb = async (q: ProcReq): Promise<ProcRes> => {
      const base = await fakeKernel()(q);
      if (!q.others?.length) return base;
      return { ...base, combined: { steps: base.steps.map((x) => x.state), states: base.states } };
    };
    const c = await processRun({ ...doc, motion: { ...doc.motion!, process: two } }, res, { process: comb });
    expect(processKv(c)).toEqual(["proc=2", "removed=314.159", "scrap=1", "through=11"]);
    expect(processCodes(c, doc).map((x) => x.code)).not.toContain("motion.process-failed");
    expect(processLines(c, doc).join("\n")).toMatch(/„Plech“: 2 operací, celkem odebráno 314,159 mm³ \(sjednocení – společný objem operací jen jednou; součet operací 628,318 mm³\)/);
    // CSV: stav výrobku a odebraný objem po krocích (dřív CSV procesní vrstvu nemělo)
    const csv = motionCsv(c, { ...doc, motion: { ...doc.motion!, process: two } }).split("\r\n");
    expect(csv[0]).toMatch(/;Stav výrobku Plech;Odebráno Plech \[mm³\]$/);
    expect(csv[1]).toMatch(/;full;0$/);
    expect(csv[12]).toMatch(/;pierced;314,159$/);
  });
  it("strojová pole na konci řádku a hloubka zásahu v kroku pro anotaci", () => {
    expect(processKv(out)).toEqual(["proc=1", "removed=314.159", "scrap=1", "through=11"]);
    expect((out.steps[10] as MotionStep & { cut?: unknown }).cut).toEqual([{ label: "střih 1", depth: 1 }]);
    expect((out.steps[0] as MotionStep & { cut?: unknown }).cut).toBeUndefined();
  });
  it("otisk s hloubkou: bez odpadu, neprostřižen; nástroj mimo obrobek = ⚠ motion.process-miss", async () => {
    const r = await processRun({ ...doc, motion: { ...doc.motion!, process: [{ id: "i1", kind: "imprint", tool: "R", target: "P", depth: 0.3 }] } }, res, { process: fakeKernel() });
    const o = processOf(r)!.ops[0];
    expect(o.depth).toBeCloseTo(0.3, 9);
    expect(o.through).toBeNull();
    expect(productStates(processOf(r)!, 16)[0].phase).toBe("imprinted");
    const miss = await processRun({ ...doc, motion: { ...doc.motion!, process: [{ id: "c1", kind: "cut", tool: "R", target: "P", at: { motor: "m1", op: "<=", value: -50 } }] } }, res, { process: fakeKernel() });
    expect(processLines(miss, doc).join("\n")).toMatch(/začátek operace nenastal/);
    const none = await processRun(doc, res, { process: async (q) => ({ ...(await fakeKernel()(q)), steps: q.rels.map(() => ({ contact: false, depth: 0, through: false, state: 0 })), states: [{ removed: 0, volume: 6400, scrap: [] }] }) });
    expect(processCodes(none, doc).map((c) => c.code)).toEqual(["motion.process-miss"]);
  });
  it("jádro bez operace / chyba jádra: nespočítáno (⚠), žádné tvrzení o stavu výrobku", async () => {
    const r = await processRun(doc, res, {});
    expect(processCodes(r, doc).map((c) => c.code)).toContain("motion.process-failed");
    expect(processLines(r, doc).join("\n")).toMatch(/nespočítáno/);
    const e = await processRun(doc, res, { process: async () => Promise.reject(new Error("boom")) });
    expect(processOf(e)!.ops[0].error).toBe("boom");
    expect(processLines(e, doc).join("\n")).not.toMatch(/děrovaný/);
  });
  it("bez operací se výsledek nemění", async () => {
    const { doc: d0, res: r0 } = setup([]);
    expect(await processRun(d0, r0, { process: fakeKernel() })).toBe(r0);
  });
});

describe("procesní vrstva – odpad podle pravidla", () => {
  const steps = Array.from({ length: 10 }, (_, i) => ({ t: i * 0.1 }));
  const base: Pick<ProcOpResult, "through" | "toolAt" | "dir" | "scrapRule"> = {
    through: { step: 3, t: 0.3 },
    // nástroj jede dolů (−Z) do kroku 5, pak zpět nahoru
    toolAt: [10, 9, 8, 7, 6, 5, 6, 7, 8, 9].map((z) => [0, 0, z] as [number, number, number]),
    dir: [0, 0, -1],
    scrapRule: "fall",
  };
  it("před prostřižením odpad není", () => {
    expect(scrapOffset(base, steps, 2)).toBeNull();
  });
  it("padá: s nástrojem, dokud jede vpřed; pak volný pád ½·g·t² (nejvýš 150 mm)", () => {
    expect(scrapOffset(base, steps, 5)).toEqual([0, 0, -2]);
    const k7 = scrapOffset(base, steps, 7)!;
    expect(k7[2]).toBeCloseTo(-152, 6); // ½·9810·0,2² = 196 mm → strop 150 mm
    const fast = Array.from({ length: 10 }, (_, i) => ({ t: i * 0.01 }));
    expect(scrapOffset(base, fast, 7)![2]).toBeCloseTo(-(2 + 0.5 * 9810 * 0.02 ** 2), 6);
    expect(scrapOffset(base, fast, 9)![2]).toBeCloseTo(-(2 + 0.5 * 9810 * 0.04 ** 2), 6);
  });
  it("s nástrojem: drží na nástroji i při zpětném zdvihu; zůstane: stojí", () => {
    expect(scrapOffset({ ...base, scrapRule: "tool" }, steps, 8)).toEqual([0, 0, 1]);
    expect(scrapOffset({ ...base, scrapRule: "stay" }, steps, 8)).toEqual([0, 0, 0]);
  });
});
