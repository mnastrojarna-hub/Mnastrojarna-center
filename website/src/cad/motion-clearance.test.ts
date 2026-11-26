/**
 * Vlna 22, bod 6 (C2): zjemnění a spojitá kontrola pohybové studie bez jádra – falešné jádro počítá vzdálenosti analyticky
 * (kvádry rovnoběžné s osami, koule), takže se dá přesně říct, co se mezi kroky stane:
 *
 *  - nůž 1 mm × kolík Ø2 (jako korpus 74b): v krocích po 5 mm průnik není, mezi kroky 17 a 18 ano → `between`, režim continuous;
 *  - `refine: false` → režim discrete (nic se nedokazuje), bez jádra s operací `clearance` → discrete „no-kernel“;
 *  - sledovaná vůle střižník × vedení 0,01 mm: minimum, kroky pod limitem, dráha posuvu potvrdí vůli i mezi kroky;
 *  - natáčení (rameno po kružnici, krok 30°): přímá dráha nejde, půlení řešičem najde průchod překážkou mezi kroky;
 *  - díl klouže po ploše (dotyk bez objemu): dráha posuvu bez průniku úsek potvrdí (ne „nepotvrzeno“).
 */
import { describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { clearanceTracker, moveBound, stepTravel, type ClearanceEnv, type PoseAt } from "./motion-clearance";
import type { ClrDist, ClrReq, ClrRes, ClrSweep } from "./clearance-types";
import type { MotionClashes, MotionResult, MotionStep } from "./motion";
import type { AsmComponent, CadDoc, Placement, Vec3 } from "./types";
import { emptyDoc } from "./types";

setLang("cs");

type Shape = { kind: "box"; lo: Vec3; hi: Vec3 } | { kind: "sphere"; r: number };
const pl = (x: number, y = 0, z = 0, rz = 0): Placement => ({ position: [x, y, z], rotation: [0, 0, rz] });
const comp = (id: string, p: Placement): AsmComponent => ({ id, name: id, source: { kind: "part", doc: emptyDoc(id) }, placement: p }) as AsmComponent;

/** falešné jádro: tělesa = kvádry (jen posuv) nebo koule; vzdálenost analyticky, dráha posuvu = obálka kvádru přes posun */
function fakeKernel(shapes: Record<string, Shape>) {
  const calls = { dist: 0, sweep: 0 };
  const world = (id: string, p: Placement): { lo: Vec3; hi: Vec3 } | { c: Vec3; r: number } => {
    const s = shapes[id];
    if (s.kind === "sphere") return { c: p.position, r: s.r };
    return { lo: [0, 1, 2].map((i) => s.lo[i] + p.position[i]) as Vec3, hi: [0, 1, 2].map((i) => s.hi[i] + p.position[i]) as Vec3 };
  };
  const boxDist = (a: { lo: Vec3; hi: Vec3 }, b: { lo: Vec3; hi: Vec3 }) => Math.hypot(...[0, 1, 2].map((i) => Math.max(0, a.lo[i] - b.hi[i], b.lo[i] - a.hi[i])));
  const overlap = (a: { lo: Vec3; hi: Vec3 }, b: { lo: Vec3; hi: Vec3 }) => [0, 1, 2].reduce((v, i) => v * Math.max(0, Math.min(a.hi[i], b.hi[i]) - Math.max(a.lo[i], b.lo[i])), 1);
  const dist = (A: ReturnType<typeof world>, B: ReturnType<typeof world>): ClrDist => {
    if ("c" in A && "c" in B) return { d: Math.max(0, Math.hypot(...[0, 1, 2].map((i) => A.c[i] - B.c[i])) - A.r - B.r), exact: true, p1: A.c, p2: B.c };
    if ("lo" in A && "lo" in B) {
      const d = boxDist(A, B);
      const p1 = [0, 1, 2].map((i) => Math.min(Math.max(B.lo[i], A.lo[i]), A.hi[i])) as Vec3;
      const p2 = [0, 1, 2].map((i) => Math.min(Math.max(p1[i], B.lo[i]), B.hi[i])) as Vec3;
      return { d, exact: true, p1, p2, ...(overlap(A, B) > 0 ? { inside: true } : {}) };
    }
    throw new Error("kvádr × koule ve falešném jádře není");
  };
  const placeOf = (req: ClrReq, pose: number, id: string): Placement => (pose > 0 ? req.poses?.[pose - 1]?.[id] : undefined) ?? req.doc.components!.find((c) => c.id === id)!.placement;
  const clearance = async (req: ClrReq): Promise<ClrRes> => {
    const out: ClrRes = {};
    if (req.local)
      out.local = Object.fromEntries(
        req.local.map((id) => {
          const s = shapes[id];
          if (!s) return [id, null];
          const box: [Vec3, Vec3] = s.kind === "sphere" ? [[-s.r, -s.r, -s.r], [s.r, s.r, s.r]] : [s.lo, s.hi];
          const c = [0, 1, 2].map((i) => (box[0][i] + box[1][i]) / 2) as Vec3;
          return [id, { box, c, r: Math.hypot(...[0, 1, 2].map((i) => box[1][i] - c[i])) }];
        }),
      );
    out.dist = (req.dist ?? []).map((q) => {
      calls.dist++;
      return dist(world(q.a, placeOf(req, q.pose, q.a)), world(q.b, placeOf(req, q.pose, q.b)));
    });
    out.sweep = (req.sweep ?? []).map((q): ClrSweep => {
      calls.sweep++;
      const a0 = placeOf(req, q.from, q.a);
      const b0 = placeOf(req, q.from, q.b);
      const b1 = placeOf(req, q.to, q.b);
      const a1 = placeOf(req, q.to, q.a);
      if (shapes[q.a].kind !== "box" || shapes[q.b].kind !== "box") return { d: NaN, exact: false, ok: false };
      // B vůči A: posun (A se nehýbe – v testu vždy)
      const v = [0, 1, 2].map((i) => b1.position[i] - b0.position[i] - (a1.position[i] - a0.position[i])) as Vec3;
      const A = world(q.a, a0) as { lo: Vec3; hi: Vec3 };
      const B0 = world(q.b, b0) as { lo: Vec3; hi: Vec3 };
      const sw = { lo: [0, 1, 2].map((i) => B0.lo[i] + Math.min(0, v[i])) as Vec3, hi: [0, 1, 2].map((i) => B0.hi[i] + Math.max(0, v[i])) as Vec3 };
      const d = dist(A, sw);
      // jako jádro: konce bez dotyku + dotyk s dráhou = průchod (∞); konce v dotyku = rozhodne „zmenšená dráha“ (zde objem překryvu)
      return { ...d, ok: true, v, ...(d.d <= 1e-9 ? { pen: q.touch ? overlap(A, sw) : Infinity } : {}) };
    });
    return out;
  };
  return { clearance, calls };
}

/** kolize ve falešném jádře: dvojice kvádrů / koulí s průnikem (objem jen u kvádrů) */
function fakeCollide(shapes: Record<string, Shape>) {
  return async (d: CadDoc): Promise<MotionClashes> => {
    const k = fakeKernel(shapes);
    const ids = (d.components ?? []).map((c) => c.id);
    const out: MotionClashes = [];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const r = await k.clearance({ doc: d, dist: [{ a: ids[i], b: ids[j], pose: 0 }] });
        const x = r.dist![0];
        if (x.d <= 0 && x.inside) out.push({ a: ids[i], b: ids[j], volume: 1, aPath: [ids[i]], bPath: [ids[j]], cls: "real", why: "no-thread" } as MotionClashes[number]);
      }
    return out;
  };
}

/** studie po krocích: polohy z funkce, kontrola přes `tracker.step` (jako hák v motion.ts) */
async function study(doc: CadDoc, env: ClearanceEnv, n: number, at: (t: number) => Record<string, Placement>, o: { collisions?: boolean; clearance?: CadDoc["motion"] extends infer M ? M extends { clearance?: infer C } ? C : never : never; solver?: boolean } = {}) {
  const motion = { motors: [], duration: 1, steps: n, ...(o.clearance ? { clearance: o.clearance } : {}) };
  const tr = clearanceTracker(doc, motion, env, { collisions: o.collisions ?? true, steps: n })!;
  const steps: MotionStep[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const row: MotionStep = { i: k, t, motors: [t], place: at(t), conflicts: [], clashes: env.collide ? [...(await env.collide({ ...doc, components: doc.components!.map((c) => ({ ...c, placement: at(t)[c.id] ?? c.placement })) }))] : [] };
    const poseAt: PoseAt | undefined = o.solver === false ? undefined : (tm) => ({ place: at(tm), motors: [tm], t: tm });
    await tr.step(row, steps[steps.length - 1] ?? null, poseAt);
    steps.push(row);
  }
  const res = { steps, comps: [], motors: [], collision: null, collisionsChecked: o.collisions ?? true, conflictSteps: 0 } as MotionResult;
  return tr.finish(res);
}

describe("spojitá kontrola kolizí mezi kroky (vlna 22, bod 6)", () => {
  const shapes: Record<string, Shape> = { ram: { kind: "box", lo: [0, 0, 0], hi: [200, 40, 10] }, kolik: { kind: "box", lo: [-1, -1, 0], hi: [1, 1, 20] }, nuz: { kind: "box", lo: [0, 0, 0], hi: [1, 40, 10] } };
  const doc: CadDoc = { ...emptyDoc("S6"), kind: "assembly", components: [comp("ram", pl(0)), comp("kolik", pl(100, 20, 10)), comp("nuz", pl(12, 0, 10))] } as CadDoc;
  const knife = (t: number) => ({ nuz: pl(12 + 180 * t, 0, 10) });

  it("nůž 1 mm přes kolík Ø2 mezi kroky 5 mm od sebe: diskrétně nic, spojitě kontakt mezi kroky 17 a 18", async () => {
    const k = fakeKernel(shapes);
    const res = await study(doc, { clearance: k.clearance, collide: fakeCollide(shapes) }, 36, knife);
    // v krocích samotných průnik není (kolík x = 99..101, nůž v kroku 17 na 97..98, v kroku 18 na 102..103)
    expect(res.steps.every((s) => !s.clashes?.length)).toBe(true);
    expect(res.between?.length).toBe(1);
    const h = res.between![0];
    expect([h.k0, h.k1]).toEqual([17, 18]);
    expect(new Set([h.a, h.b])).toEqual(new Set(["kolik", "nuz"]));
    expect(h.pos).toBeGreaterThan(17);
    expect(h.pos).toBeLessThan(18);
    expect(h.clashes.length).toBe(1);
    // nůž klouže po rámu (dotyk bez objemu) – dráha posuvu úseky potvrdí, nic „nepotvrzeno“
    expect(res.sweep!.mode).toBe("continuous");
    expect(res.sweep!.unproven).toBe(0);
    expect(res.sweep!.swept).toBeGreaterThan(30);
    expect(res.sweep!.maxStep).toBeCloseTo(5, 9);
  });

  it("`refine: false` = jen v polohách (diskrétně, nic se mezi kroky netvrdí); bez operace jádra = diskrétně „no-kernel“", async () => {
    const k = fakeKernel(shapes);
    const off = await study(doc, { clearance: k.clearance, collide: fakeCollide(shapes) }, 36, knife, { clearance: { refine: false } });
    expect(off.sweep!.mode).toBe("discrete");
    expect(off.sweep!.why).toBe("off");
    expect(off.between).toBeUndefined();
    expect(k.calls.sweep).toBe(0);
    const none = await study(doc, { collide: fakeCollide(shapes) }, 36, knife);
    expect(none.sweep!.mode).toBe("discrete");
    expect(none.sweep!.why).toBe("no-kernel");
    expect(none.sweep!.maxStep).toBeCloseTo(5, 9);
  });

  it("jemné kroky: kontakt je v krocích samotných (kontrola kroku) – úseky s hlášeným průnikem se nepočítají jako nepotvrzené", async () => {
    const k = fakeKernel(shapes);
    const res = await study(doc, { clearance: k.clearance, collide: fakeCollide(shapes) }, 180, knife);
    expect(res.steps.some((s) => s.clashes?.length)).toBe(true);
    expect(res.sweep!.unproven).toBe(0);
    expect(res.sweep!.covered).toBeGreaterThan(0);
  });

  it("natáčení (rameno po kružnici, krok 30°): přímá dráha nejde – půlení mezipolohami najde průchod překážkou", async () => {
    const sh: Record<string, Shape> = { arm: { kind: "sphere", r: 1 }, obst: { kind: "sphere", r: 1 } };
    const R = 50;
    const at = (deg: number): Placement => pl(R * Math.cos((deg * Math.PI) / 180), R * Math.sin((deg * Math.PI) / 180), 0, deg);
    const d: CadDoc = { ...emptyDoc("R"), kind: "assembly", components: [comp("obst", at(15)), comp("arm", at(0))] } as CadDoc;
    const k = fakeKernel(sh);
    const collide = async (x: CadDoc): Promise<MotionClashes> => {
      const r = await k.clearance({ doc: x, dist: [{ a: "obst", b: "arm", pose: 0 }] });
      return r.dist![0].d <= 0 ? ([{ a: "obst", b: "arm", volume: 1, cls: "real", why: "no-thread", aPath: ["obst"], bPath: ["arm"] }] as MotionClashes) : [];
    };
    const res = await study(d, { clearance: k.clearance, collide }, 3, (t) => ({ arm: at(90 * t) }));
    expect(res.steps.every((s) => !s.clashes?.length)).toBe(true);
    expect(res.between?.length).toBe(1);
    expect([res.between![0].k0, res.between![0].k1]).toEqual([0, 1]);
    expect(res.sweep!.swept).toBe(0); // natáčení: dráha posuvu se nepoužila
  });

  it("mez posunu: vzdálené dvojice se dokážou bez dalších výpočtů (žádná dráha, žádné půlení)", async () => {
    const far: CadDoc = { ...emptyDoc("F"), kind: "assembly", components: [comp("ram", pl(0, 0, -50)), comp("nuz", pl(12, 0, 10))] } as CadDoc;
    const k = fakeKernel(shapes);
    const res = await study(far, { clearance: k.clearance, collide: fakeCollide(shapes) }, 10, knife);
    expect(res.sweep!.mode).toBe("continuous");
    expect(k.calls.sweep).toBe(0);
  });
});

describe("sledovaná vůle (vlna 22, bod 6)", () => {
  // vedení s dírou: dva kvádry vlevo a vpravo od střižníku s vůlí 0,01 mm, střižník jede po Z
  const shapes: Record<string, Shape> = { vedL: { kind: "box", lo: [-20, -20, 0], hi: [-5.01, 20, 10] }, strz: { kind: "box", lo: [-5, -5, 0], hi: [5, 5, 40] } };
  const doc: CadDoc = { ...emptyDoc("S6b"), kind: "assembly", components: [comp("vedL", pl(0)), comp("strz", pl(0, 0, -30))] } as CadDoc;
  const punch = (t: number) => ({ strz: pl(0, 0, -30 + 20 * t) });

  it("vůle 0,01 mm < limit 0,05: minimum, místo, kroky pod limitem; dráha posuvu potvrdí, že mezi kroky není menší", async () => {
    const k = fakeKernel(shapes);
    const res = await study(doc, { clearance: k.clearance }, 10, punch, { collisions: false, clearance: { pairs: [{ a: "strz", b: "vedL" }], limit: 0.05 } });
    const c = res.clearance!;
    expect(c.limit).toBe(0.05);
    expect(c.pairs.length).toBe(1);
    const p = c.pairs[0];
    expect(p.min!.d).toBeCloseTo(0.01, 9);
    expect(p.min!.exact).toBe(true);
    expect(p.min!.p1).toBeDefined();
    expect(p.below).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(p.series.length).toBe(11);
    expect(p.unproven).toBe(0);
    expect(res.sweep).toBeUndefined(); // kolize se nekontrolovaly – žádný údaj o spojitosti kolizí
  });

  it("vůle klesne mezi kroky (průjezd kolem rohu): zjemnění najde menší hodnotu než v krocích", async () => {
    // B jede po X kolem kvádru A ve vzdálenosti 0,5 mm nad ním; v krocích je nad mezerou mezi A a jeho sousedem (vzdálenost větší)
    const sh: Record<string, Shape> = { a: { kind: "box", lo: [9, 0, 0], hi: [11, 10, 10] }, b: { kind: "box", lo: [0, 0, 0], hi: [1, 10, 10] } };
    const d: CadDoc = { ...emptyDoc("X"), kind: "assembly", components: [comp("a", pl(0)), comp("b", pl(0, 0, 10.5))] } as CadDoc;
    const k = fakeKernel(sh);
    // kroky po 20 mm: B v x = 0 a 20 (vzdálenost od A v kroku 0: hypot(8, 0.5), v kroku 1: hypot(9, 0.5)); mezi nimi nad A = 0,5
    const res = await study(d, { clearance: k.clearance }, 1, (t) => ({ b: pl(20 * t, 0, 10.5) }), { collisions: false, clearance: { pairs: [{ a: "a", b: "b" }], limit: 1 } });
    const p = res.clearance!.pairs[0];
    expect(p.series[0]).toBeGreaterThan(8);
    expect(p.min!.d).toBeCloseTo(0.5, 9);
    expect(p.min!.between).toEqual([0, 1]);
  });

  it("„pohyblivé“: dvojice blíž než limit + rezerva se najdou samy", async () => {
    const k = fakeKernel(shapes);
    const res = await study(doc, { clearance: k.clearance }, 4, punch, { collisions: false, clearance: { pairs: "moving", limit: 0.05 } });
    const c = res.clearance!;
    expect(c.moving).toBe(true);
    expect(c.pairs.map((p) => [p.a, p.b].sort().join("×"))).toEqual(["strz×vedL"]);
    expect(c.pairs[0].min!.d).toBeCloseTo(0.01, 9);
  });

  // fáze 2 kolo 3 (falešná zelená): „pohyblivé“ se dřív zjišťovaly jen ve větvi zjemnění – „bez zjemnění“ = žádná dvojice
  // (souhrn „žádná dvojice blíž než 1,1 mm“, clear.pairs=0 při vůli 0,01 mm) a krok 0 se nevyhodnotil nikdy
  it("„pohyblivé“ bez zjemnění: dvojice se najde i jen v polohách, včetně kroku 0 (11 z 11 poloh)", async () => {
    const k = fakeKernel(shapes);
    const res = await study(doc, { clearance: k.clearance }, 10, punch, { collisions: false, clearance: { pairs: "moving", limit: 0.05, refine: false } });
    const c = res.clearance!;
    expect(c.pairs.map((p) => [p.a, p.b].sort().join("×"))).toEqual(["strz×vedL"]);
    const p = c.pairs[0];
    expect(p.min!.d).toBeCloseTo(0.01, 9);
    expect(p.below).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(p.series.filter((v) => v !== undefined).length).toBe(11);
    expect(k.calls.sweep).toBe(0); // bez zjemnění žádná dráha posuvu
  });

  it("„pohyblivé“ se zjemněním: krok 0 vyhodnocen (dřív „10 z 10 poloh (kroky 1–10)“), každý krok jen jednou", async () => {
    const k = fakeKernel(shapes);
    const res = await study(doc, { clearance: k.clearance }, 10, punch, { collisions: false, clearance: { pairs: "moving", limit: 0.05 } });
    const p = res.clearance!.pairs[0];
    expect(p.below).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(p.series.length).toBe(11);
  });
  // fáze 2 kolo 3 (parita 74g: Node „Střižník × Vodítko“, prohlížeč „Vodítko × Střižník“): pořadí dvojice „pohyblivé“ bylo podle
  // náhodných id komponent – nyní podle pořadí komponent v sestavě, stejně v každém běhu
  it("„pohyblivé“: pořadí dvojice podle pořadí komponent v sestavě, ne podle náhodných id", async () => {
    const named = (id: string, name: string, p: Placement) => ({ ...comp(id, p), name }) as AsmComponent;
    for (const [g, s] of [["zz9", "aa1"], ["aa1", "zz9"]] as const) {
      const sh: Record<string, Shape> = { [g]: shapes.vedL, [s]: shapes.strz };
      const d: CadDoc = { ...emptyDoc("S6c"), kind: "assembly", components: [named(g, "Vodítko", pl(0)), named(s, "Střižník", pl(0, 0, -30))] } as CadDoc;
      for (const refine of [false, true]) {
        const res = await study(d, { clearance: fakeKernel(sh).clearance }, 4, (t) => ({ [s]: pl(0, 0, -30 + 20 * t) }), { collisions: false, clearance: { pairs: "moving", limit: 0.05, refine } });
        const c = res.clearance!;
        expect(c.pairs.map((p) => [p.a, p.b])).toEqual([[g, s]]);
        expect(c.pairs[0].below).toEqual([0, 1, 2, 3, 4]);
      }
    }
  });
});

describe("pomocné výpočty", () => {
  it("moveBound: posuv = délka posunu; natočení = oblouk středu + θ·r", () => {
    const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    expect(moveBound({ R: I, t: [0, 0, 0] }, { R: I, t: [3, 4, 0] }, { c: [0, 0, 0], r: 2 })).toBeCloseTo(5, 12);
    const c90 = [0, -1, 0, 1, 0, 0, 0, 0, 1]; // 90° kolem Z
    const b = moveBound({ R: I, t: [0, 0, 0] }, { R: c90, t: [0, 0, 0] }, { c: [10, 0, 0], r: 1 });
    // střed obálky (10,0,0) → (0,10,0): tětiva 14,14 × oblouk/tětiva (π/2 / (2 sin 45°) = 1,1107) = 15,71 + θ·r 1,571
    expect(b).toBeCloseTo((Math.PI / 2) * 10 + Math.PI / 2, 6);
  });
  it("stepTravel: největší posun a natočení mezi polohami", () => {
    const t = stepTravel({ a: pl(0), b: pl(0, 0, 0, 0) }, { a: pl(3, 4), b: pl(0, 0, 0, 10) });
    expect(t.d).toBeCloseTo(5, 12);
    expect(t.turn).toBeCloseTo(10, 9);
  });
});
