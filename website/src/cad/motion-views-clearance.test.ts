/**
 * Vlna 22, bod 14 (fáze 2): vůle v anotaci přehrávání a exportu ze SKUTEČNÉHO výsledku kontroly vůle (cad/motion-clearance.ts,
 * balík C2), ne z vymyšleného tvaru kroku. Na 4a46d82 adaptér `clearanceAt` četl `step.clearance`, které žádný kód nezapisuje –
 * řádek vůle se v okně ani ve videu nikdy neobjevil, i když studie vůli spočítala (`res.clearance.pairs[].series`).
 *
 * Repro: Razník (kvádr 10 mm) sjíždí po Z do Vodítka s vůlí 0,3 mm po stranách; sledovaná dvojice Razník × Vodítko, limit 0,5 mm.
 * Falešné jádro počítá vzdálenost kvádrů analyticky (přesně), takže hodnota v každém kroku je známá:
 *  - krok 0 (razník 5 mm nad vodítkem, 0,3 mm stranou): vůle √(5² + 0,3²) = 5,009 mm; krok 2 (zajetý): 0,3 mm ⚠ pod limitem 0,5 mm.
 * Očekávaný výsledek: anotace kroku 2 = „⚠ vůle Razník × Vodítko: 0,3 mm (min. 0,5)“ (warn), krok 0 = „… 5,009 mm (min. 0,5)“ bez ⚠,
 * snímek videa mezi kroky = hodnota výslovně „· v kroku N“; studie s vůlí bez výsledku vůle = „vůle: nezkontrolováno“ (⚠).
 */
import { describe, expect, it } from "vitest";
import type { ClrDist, ClrReq, ClrRes } from "./clearance-types";
import { setLang } from "./i18n";
import type { MotionResult, MotionStep } from "./motion";
import { clearanceTracker } from "./motion-clearance";
import { annotRows, clearanceAt } from "./motion-views";
import { emptyDoc, type AsmComponent, type CadDoc, type MotionStudy, type Placement, type Vec3 } from "./types";

setLang("cs");

type Box = { lo: Vec3; hi: Vec3 };
const pl = (x: number, y = 0, z = 0): Placement => ({ position: [x, y, z], rotation: [0, 0, 0] });
const comp = (id: string, name: string, p: Placement): AsmComponent => ({ id, name, source: { kind: "part", doc: emptyDoc(name) }, placement: p }) as AsmComponent;

/** analytické jádro: kvádry rovnoběžné s osami (jen posuv), vzdálenost přesně; `inexact` = dvojice vrací jen dolní mez */
function boxKernel(shapes: Record<string, Box>, inexact = false) {
  const world = (id: string, p: Placement): Box => ({ lo: [0, 1, 2].map((i) => shapes[id].lo[i] + p.position[i]) as Vec3, hi: [0, 1, 2].map((i) => shapes[id].hi[i] + p.position[i]) as Vec3 });
  const dist = (a: Box, b: Box): ClrDist => {
    const d = Math.hypot(...[0, 1, 2].map((i) => Math.max(0, a.lo[i] - b.hi[i], b.lo[i] - a.hi[i])));
    return inexact ? { d, exact: false } : { d, exact: true, p1: a.lo, p2: b.lo };
  };
  const placeOf = (req: ClrReq, pose: number, id: string): Placement => (pose > 0 ? req.poses?.[pose - 1]?.[id] : undefined) ?? req.doc.components!.find((c) => c.id === id)!.placement;
  return async (req: ClrReq): Promise<ClrRes> => ({
    ...(req.local ? { local: Object.fromEntries(req.local.map((id) => [id, { box: [shapes[id].lo, shapes[id].hi] as [Vec3, Vec3], c: [0, 0, 0] as Vec3, r: 50 }])) } : {}),
    dist: (req.dist ?? []).map((q) => dist(world(q.a, placeOf(req, q.pose, q.a)), world(q.b, placeOf(req, q.pose, q.b)))),
    sweep: (req.sweep ?? []).map(() => ({ d: NaN, exact: false, ok: false })),
  });
}

/** Vodítko = dvě čelisti (jedna komponenta = jeden kvádr zleva; druhá strana zrcadlově by dala totéž) */
const shapes: Record<string, Box> = { raz: { lo: [0, 0, 0], hi: [10, 10, 30] }, vod: { lo: [10.3, 0, 0], hi: [20, 10, 20] } };
const docOf = (clearance: MotionStudy["clearance"]): CadDoc =>
  ({ ...emptyDoc("Sestava"), kind: "assembly", components: [comp("raz", "Razník", pl(0, 0, 25)), comp("vod", "Vodítko", pl(0))], mates: [], motion: { motors: [], duration: 1, steps: 2, collisions: false, ...(clearance ? { clearance } : {}) } }) as CadDoc;
/** razník: z = 25 → 0 (krok 0 nad vodítkem: svisle 5 mm; kroky 1, 2 zajetý: vodorovně 0,3 mm) */
const zAt = [25, 10, 0];

async function study(doc: CadDoc, inexact = false): Promise<MotionResult> {
  const tracker = clearanceTracker(doc, doc.motion!, { clearance: boxKernel(shapes, inexact) }, { collisions: false, steps: 2 })!;
  const steps: MotionStep[] = [];
  for (let k = 0; k <= 2; k++) {
    const row = { i: k, t: k / 2, motors: [zAt[k]], place: { raz: pl(0, 0, zAt[k]), vod: pl(0) }, conflicts: [] } as unknown as MotionStep;
    await tracker.step(row, steps[k - 1] ?? null);
    steps.push(row);
  }
  return tracker.finish({ steps, comps: [], motors: [], collision: null, collisionsChecked: false, conflictSteps: 0 } as unknown as MotionResult);
}
const clRows = (rows: ReturnType<typeof annotRows>) => rows.filter((r) => r.key === "clearance");

describe("bod 14: vůle v anotaci přehrávání / exportu ze skutečné kontroly vůle", () => {
  const cfg = { pairs: [{ a: "raz", b: "vod" }], limit: 0.5, refine: false };

  it("regrese 4a46d82: řádek vůle v kroku z res.clearance (dřív se nikdy nezobrazil)", async () => {
    const doc = docOf(cfg);
    const res = await study(doc);
    expect((res as { clearance?: { pairs: { series: number[] }[] } }).clearance!.pairs[0].series).toEqual([Math.hypot(5, 0.3), 0.3, 0.3].map((v) => expect.closeTo(v, 9)));
    const pose = (k: number) => ({ t: k / 2, step: k, steps: 3, motors: [zAt[k]], stepData: res.steps[k] as unknown as Record<string, unknown> });
    expect(clRows(annotRows(pose(2), doc, { res }))).toEqual([{ key: "clearance", text: "⚠ vůle Razník × Vodítko: 0,3 mm (min. 0,5)", warn: true }]);
    expect(clRows(annotRows(pose(0), doc, { res }))).toEqual([{ key: "clearance", text: "vůle Razník × Vodítko: 5,009 mm (min. 0,5)", warn: false }]);
    // snímek videa mezi kroky 1 a 2: hodnota patří ke kroku, ne k zobrazené mezipoloze – řečeno výslovně
    expect(clRows(annotRows({ ...pose(2), between: true }, doc, { res }))[0].text).toBe("⚠ vůle Razník × Vodítko: 0,3 mm (min. 0,5) · v kroku 2");
    // skrytí řádku v nastavení anotací
    expect(clRows(annotRows(pose(2), doc, { res, settings: { hide: ["clearance"] } }))).toEqual([]);
  });

  it("dolní mez z obálek se píše „nejméně …“, ne jako přesná vůle", async () => {
    const doc = docOf(cfg);
    const res = await study(doc, true);
    const at = clearanceAt(res, doc, 2);
    expect(at).not.toBe("unchecked");
    expect(at && at !== "unchecked" && at.rows[0]).toMatchObject({ a: "Razník", b: "Vodítko", lower: true });
    expect(clRows(annotRows({ t: 1, step: 2, steps: 3, motors: [0] }, doc, { res }))[0].text).toBe("⚠ vůle Razník × Vodítko: nejméně 0,3 mm (min. 0,5)");
  });

  it("EN: stejný řádek přeložený", async () => {
    const doc = docOf(cfg);
    const res = await study(doc);
    setLang("en");
    try {
      expect(clRows(annotRows({ t: 1, step: 2, steps: 3, motors: [0] }, doc, { res }))[0].text).toMatch(/^⚠ clearance Razník × Vodítko: 0.3 mm/);
    } finally {
      setLang("cs");
    }
  });
});
