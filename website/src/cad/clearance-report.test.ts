/**
 * Vlna 22, bod 6 (C2): výstupy vůle a spojitosti kontroly – štítek režimu, strojová pole, záznamy s kódem, CSV, krok, úsečka 3D.
 */
import { describe, expect, it } from "vitest";
import { clearanceCodes, clearanceCsvCells, clearanceCsvHead, clearanceKv, clearanceStepLines, clearanceSummaryLines, gapAt, stepRanges, sweepKv, sweepLabel } from "./clearance-report";
import { setLang } from "./i18n";
import type { ClearancePair, ClearanceResult, SweepInfo } from "./motion-clearance";
import type { AsmComponent, CadDoc, Placement, Vec3 } from "./types";
import { emptyDoc } from "./types";

setLang("cs");
const comp = (id: string, name: string): AsmComponent => ({ id, name, source: { kind: "part", doc: emptyDoc(name) }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] } }) as AsmComponent;
const doc: CadDoc = { ...emptyDoc("S"), kind: "assembly", components: [comp("v", "Vodítko"), comp("s", "Střižník")], motion: { motors: [], duration: 2, steps: 10, clearance: { pairs: [{ a: "s", b: "v" }], limit: 0.05 } } } as CadDoc;
const pl = (x: number): Placement => ({ position: [x, 0, 0], rotation: [0, 0, 0] });
const steps = (n: number, dx = 5) => Array.from({ length: n + 1 }, (_, i) => ({ i, t: i / n, motors: [i], place: { s: pl(i * dx) }, clashes: [] as unknown[] }));
const sweep = (p: Partial<SweepInfo>): SweepInfo => ({ mode: "continuous", poses: 11, refined: 4, bounded: 6, swept: 4, contacts: 0, covered: 0, unproven: 0, unprovenContact: 0, unprovenAt: [], maxStep: 5, maxTurn: 0, between: "solver", ...p });
const pair = (p: Partial<ClearancePair>): ClearancePair => ({ a: "s", b: "v", min: { d: 0.01, exact: true, pos: 3, t: 0.3, motors: [3], p1: [25, 20, 10] as Vec3, p2: [25.01, 20, 10] as Vec3 }, series: Array(11).fill(0.01), pts: Array(11).fill([[25, 20, 10], [25.01, 20, 10]]), below: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], unproven: 0, ...p });
const clr = (p: Partial<ClearanceResult>): ClearanceResult => ({ limit: 0.05, moving: false, pairs: [pair({})], poses: 11, refined: 0, ...p });

describe("spojitost kontroly kolizí – štítek a strojová pole", () => {
  it("spojitě / částečně / diskrétně (i výsledek bez údaje = diskrétně s posunem mezi polohami)", () => {
    expect(sweepLabel({ steps: steps(10), collisionsChecked: true, sweep: sweep({}) } as never)).toMatch(/^kontrolováno spojitě i mezi polohami \(11 poloh \+ 4 mezipoloh ze zjemnění; úseky: mez posunu 6, dráha posuvu 4\)$/);
    expect(sweepLabel({ steps: steps(10), collisionsChecked: true, sweep: sweep({ mode: "partial", unproven: 3, unprovenContact: 2, unprovenAt: [4, 5] }) } as never)).toMatch(/^spojitě jen částečně: .* nepotvrzeno v 3 úsecích \(od kroku 4, 5; dotyk bez objemu v poloze 2×, mez zjemnění 1×\) – tam jen v polohách$/);
    const old = { steps: steps(10), collisionsChecked: true };
    expect(sweepLabel(old as never)).toBe("kontrolováno jen v 11 polohách (diskrétně, posun mezi polohami až 5 mm) – mezi polohami nekontrolováno");
    expect(sweepKv(old as never)).toEqual(["clash.mode=discrete", "clash.poses=11", "clash.refined=0", "clash.maxstep=5mm"]);
    expect(sweepKv({ steps: steps(10), collisionsChecked: true, sweep: sweep({ mode: "partial", unproven: 2 }) } as never)).toEqual(["clash.mode=partial", "clash.poses=11", "clash.refined=4", "clash.maxstep=5mm", "clash.unproven=2"]);
  });
  it("záznamy s kódem: ℹ clash.discrete jen diskrétně, ⚠ clash.uncertain jen částečně, nic u spojité kontroly", () => {
    expect(clearanceCodes({ steps: steps(10), collisionsChecked: true } as never, { ...doc, motion: undefined }).map((c) => c.code)).toEqual(["clash.discrete"]);
    expect(clearanceCodes({ steps: steps(10), collisionsChecked: true, sweep: sweep({ mode: "partial", unproven: 1, unprovenAt: [3] }) } as never, { ...doc, motion: undefined }).map((c) => c.code)).toEqual(["clash.uncertain"]);
    expect(clearanceCodes({ steps: steps(10), collisionsChecked: true, sweep: sweep({}) } as never, { ...doc, motion: undefined })).toEqual([]);
    expect(clearanceCodes({ steps: steps(10), collisionsChecked: false } as never, { ...doc, motion: undefined })).toEqual([]);
  });
});

describe("sledovaná vůle – souhrn, kód, strojová pole, CSV, krok, úsečka", () => {
  const res = { steps: steps(10), collisionsChecked: false, clearance: clr({}) };
  it("pod limitem: ⚠ v souhrnu i kódu s místem a kroky; strojová pole clear.*", () => {
    const l = clearanceSummaryLines(res as never, doc);
    expect(l).toEqual(["Vůle „Střižník“ × „Vodítko“: nejmenší 0,01 mm v kroku 3 (t = 0,3 s) – místo [25; 20; 10] ↔ [25,01; 20; 10] · ⚠ pod limitem 0,05 mm v 11 z 11 poloh (kroky 0–10)"]);
    const c = clearanceCodes(res as never, doc);
    expect(c.map((x) => x.code)).toEqual(["clash.clearance"]);
    expect(c[0].args).toEqual(["Střižník", "Vodítko", "0,01", "0,05"]);
    expect(c[0].text).toMatch(/^vůle „Střižník“ × „Vodítko“ 0,01 mm < 0,05 mm v krocích 0–10 \(nejmenší v kroku 3 \(t = 0,3 s\)\) – místo /);
    expect(clearanceKv(res as never)).toEqual(["clear.min=0.01", "clear.limit=0.05", "clear.below=11/11", "clear.at=3", "clear.pairs=1"]);
  });
  it("nad limitem: „dodržen v celém pohybu (spojitě)“ jen se zjemněním bez nepotvrzených úseků, jinak jen „v N polohách“", () => {
    const ok = { ...res, clearance: clr({ limit: 0.005, pairs: [pair({ below: [] })] }) };
    expect(clearanceSummaryLines(ok as never, doc)[0]).toMatch(/· limit 0,005 mm dodržen v celém pohybu \(spojitě i mezi polohami\)$/);
    const unproven = { ...res, clearance: clr({ limit: 0.005, pairs: [pair({ below: [], unproven: 1 })] }) };
    expect(clearanceSummaryLines(unproven as never, doc)[0]).toMatch(/· limit 0,005 mm dodržen v 11 polohách \(mezi polohami nepotvrzeno\)$/);
    const off = { ...res, clearance: clr({ limit: 0.005, pairs: [pair({ below: [] })] }) };
    const dOff = { ...doc, motion: { ...doc.motion!, clearance: { ...doc.motion!.clearance!, refine: false } } };
    expect(clearanceSummaryLines(off as never, dOff)[0]).toMatch(/dodržen v 11 polohách \(mezi polohami nepotvrzeno\)$/);
    expect(clearanceCodes(ok as never, doc)).toEqual([]);
  });
  it("minimum mezi kroky (dráha posuvu) a dolní mez z obálek", () => {
    const sw = { ...res, clearance: clr({ pairs: [pair({ min: { d: 0.004, exact: true, pos: 3.5, t: 0.35, motors: [3.5], between: [3, 4], sweep: true } })] }) };
    expect(clearanceSummaryLines(sw as never, doc)[0]).toMatch(/nejmenší 0,004 mm mezi kroky 3 a 4 \(po přímé dráze\)/);
    expect(clearanceKv(sw as never)).toContain("clear.at=3-4");
    const lb = { ...res, clearance: clr({ limit: null, pairs: [pair({ min: { d: 2.5, exact: false, pos: 0, t: 0, motors: [0] }, below: [] })] }) };
    expect(clearanceSummaryLines(lb as never, doc)[0]).toMatch(/nejmenší nejméně 2,5 mm \(obálky\) v kroku 0/);
    expect(clearanceKv(lb as never)[0]).toBe("clear.min=2.5+");
  });
  it("CSV sloupec vůle, `pohyb krok N`, úsečka pro 3D", () => {
    expect(clearanceCsvHead(res as never, doc)).toEqual(["Vůle Střižník × Vodítko [mm]"]);
    expect(clearanceCsvCells(res as never, 4)).toEqual(["0,01"]);
    expect(clearanceStepLines(res as never, doc, 4)).toEqual([" vůle „Střižník“ × „Vodítko“: 0,01 mm ⚠ pod limitem 0,05 mm – [25; 20; 10] ↔ [25,01; 20; 10]"]);
    const g = gapAt(res as never, doc, 3)!;
    expect(g.below).toBe(true);
    expect(g.min).toBe(true);
    expect(g.label).toBe("min 0,01 mm");
    expect(gapAt(res as never, doc, 4)!.min).toBe(false);
    expect(gapAt({ steps: steps(10), collisionsChecked: true } as never, doc, 3)).toBeNull();
  });
  it("úseky kroků", () => {
    expect(stepRanges([0, 1, 2, 5, 7, 8])).toBe("0–2, 5, 7–8");
    expect(stepRanges([])).toBe("");
  });
});
