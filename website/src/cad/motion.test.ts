/**
 * Pohybová studie – regresní testy balíku motion-clash (vlna 14, A3), bez jádra (syntetická geometrie ploch):
 * - drift řešiče z P7: deska vedená dvěma rovnoběžnými Souososti se smí hýbat jen podél osy, i když jsou meze v části zdvihu
 *   nesplnitelné; nesplnění = ⚠ motion.conflict s krokem (před opravou ujela deska v P7 o 808 mm, v této reprodukci o 1 746 mm
 *   a sloupky o 290 m podél osy),
 * - tuhé skupiny ze zámků (union-find, kostra, pevná skupina u ukotveného dílu) a jedna poloha na skupinu,
 * - časy studie pro protokol (Σ slow=, JSON timing) a průběh po krocích.
 */
import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import type { FaceGeo, GeoProvider } from "./mates";
import { composePose, invertPose, placementOf, poseOf, rigidGroups, solvePoses, type Pose } from "./mates-kin";
import { motionIssues, motionSummary, runMotion, type MotionResult } from "./motion";
import { emptyDoc, type AsmComponent, type CadDoc, type Mate, type MateRef, type Placement, type Vec3 } from "./types";

afterEach(() => setLang("cs"));

type Geos = Record<string, Record<string, FaceGeo>>;
const provider = (G: Geos): GeoProvider => (r) => G[r.compId]?.[`f${r.face}`] ?? null;
const P = (position: Vec3 = [0, 0, 0], rotation: Vec3 = [0, 0, 0]): Placement => ({ position, rotation });
const comp = (id: string, placement: Placement, fixed = false): AsmComponent => ({ id, name: id, source: { kind: "part", doc: emptyDoc(id) }, placement, ...(fixed ? { fixed: true } : {}) });
const f = (compId: string, face: number): MateRef => ({ compId, face });
const plane = (origin: Vec3, normal: Vec3): FaceGeo => ({ kind: "plane", origin, normal });
const cyl = (origin: Vec3, normal: Vec3, radius: number): FaceGeo => ({ kind: "cylinder", origin, normal, radius });
const Z: Vec3 = [0, 0, 1];
const NZ: Vec3 = [0, 0, -1];

/**
 * Střižný nástroj jako P7: spodní deska B (ukotvená) se dvěma sloupky P0/P3 (souosost s dírami B), horní deska U vedená oběma sloupky
 * a poháněná Vzdáleností od B (lineární motor 175 → 175 − zdvih), kotevní deska K a dva „šrouby“ N1/N2 zamčené k horní skupině,
 * matrice M zamčená k B, stírací deska S na sloupcích se dvěma mezemi (pružiny 20…50 mm pod K, nad M). Při zdvihu 60 mm jsou meze
 * od kroku 27 nesplnitelné (S nemůže být zároveň ≥ 20 mm pod K a nad M).
 */
function dieSet(): { doc: CadDoc; geo: GeoProvider } {
  const G: Geos = {
    B: { f0: cyl([20, 20, 20], Z, 12), f1: cyl([280, 180, 20], Z, 12), f2: plane([150, 100, 40], Z) },
    P0: { f0: cyl([0, 0, 80], Z, 12) },
    P3: { f0: cyl([0, 0, 80], Z, 12) },
    U: { f0: cyl([20, 20, 17.5], Z, 12.1), f1: cyl([280, 180, 17.5], Z, 12.1), f2: plane([150, 100, 0], NZ) },
    K: { f0: plane([150, 100, 0], NZ) },
    S: { f0: cyl([20, 20, 10], Z, 12.2), f1: cyl([280, 180, 10], Z, 12.2), f2: plane([150, 100, 20], Z), f3: plane([150, 100, 0], NZ) },
    M: { f0: plane([100, 60, 30], Z) },
  };
  const mates: Mate[] = [
    { id: "lm", type: "lock", a: f("M", -1), b: f("B", -1) },
    { id: "c0", type: "concentric", a: f("P0", 0), b: f("B", 0) },
    { id: "c3", type: "concentric", a: f("P3", 0), b: f("B", 1) },
    { id: "u0", type: "concentric", a: f("U", 0), b: f("P0", 0) },
    { id: "u3", type: "concentric", a: f("U", 1), b: f("P3", 0) },
    { id: "d", type: "distance", a: f("U", 2), b: f("B", 2), value: 175 },
    { id: "lk", type: "lock", a: f("K", -1), b: f("U", -1) },
    { id: "ln1", type: "lock", a: f("N1", -1), b: f("K", -1) },
    { id: "ln2", type: "lock", a: f("N2", -1), b: f("U", -1) },
    { id: "s0", type: "concentric", a: f("S", 0), b: f("P0", 0) },
    { id: "s3", type: "concentric", a: f("S", 1), b: f("P3", 0) },
    { id: "l1", type: "limitDistance", a: f("S", 2), b: f("K", 0), min: 20, max: 50 },
    { id: "l2", type: "limitDistance", a: f("S", 3), b: f("M", 0), min: 0, max: 200 },
  ];
  const doc: CadDoc = {
    ...emptyDoc("Nástroj"),
    kind: "assembly",
    components: [comp("B", P(), true), comp("M", P([50, 40, 40])), comp("P0", P([20, 20, 0])), comp("P3", P([280, 180, 0])), comp("U", P([0, 0, 215])), comp("K", P([0, 0, 150])), comp("N1", P([100, 85, 85])), comp("N2", P([45, 30, 250])), comp("S", P([0, 0, 80]))],
    mates,
  };
  return { doc, geo: provider(G) };
}
const study = (stroke: number, steps = 40) => ({ motors: [{ id: "mo", kind: "linear" as const, mate: "d", from: 175, to: 175 - stroke }], duration: 2, steps });
/** rozsah polohy (max − min) komponenty po krocích pro souřadnici k a rozsah natočení */
const span = (res: MotionResult, id: string, k: number) => {
  const v = res.steps.map((s) => s.place[id].position[k]);
  return Math.max(...v) - Math.min(...v);
};
const rotSpan = (res: MotionResult, id: string) => Math.max(...[0, 1, 2].map((k) => Math.max(...res.steps.map((s) => Math.abs(s.place[id].rotation[k])))));

describe("drift řešiče pohybu (P7) – deska vedená dvěma sloupky jen podél osy", () => {
  it("zdvih 60 mm: meze nesplnitelné v krocích 27–40 → ⚠ motion.conflict s kroky, bez bočního posunu a natočení", async () => {
    const { doc, geo } = dieSet();
    const res = await runMotion(doc, geo, study(60));
    expect(res.steps.length).toBe(41);
    // vedené desky a vše zamčené k nim: X, Y a natočení beze změny (dřív 1 746 mm / 893 mm / 11°), sloupky stojí (dřív −290 m v Z)
    for (const id of ["U", "K", "N1", "N2", "S"]) {
      expect(span(res, id, 0), id).toBeLessThan(1e-6);
      expect(span(res, id, 1), id).toBeLessThan(1e-6);
      expect(rotSpan(res, id), id).toBeLessThan(1e-6);
    }
    for (const id of ["P0", "P3", "B", "M"]) for (const k of [0, 1, 2]) expect(span(res, id, k), id).toBeLessThan(1e-6);
    // zdvih v Z: horní skupina klesá, dokud meze dovolí (pak kompromis nejmenších čtverců)
    expect(res.steps[26].place.U.position[2]).toBeCloseTo(215 - (60 * 26) / 40, 6);
    expect(res.steps[40].place.U.position[2]).toBeLessThan(res.steps[26].place.U.position[2]);
    // zámky: kotevní deska a „šrouby“ drží vzájemnou polohu (tuhá skupina; 1e-8 = zaokrouhlení umístění na 1e-9 mm a 1e-6°)
    for (const s of res.steps) {
      expect(s.place.K.position[2] - s.place.U.position[2]).toBeCloseTo(-65, 7);
      expect(s.place.N2.position[2] - s.place.U.position[2]).toBeCloseTo(35, 7);
    }
    // nesplněné vazby: jen kroky 27–40 → jeden záznam na vazbu a souvislý úsek kroků (tvar registru kódů A1), pořadí vazeb v dokumentu
    expect(res.conflictSteps).toBe(14);
    expect(res.steps.filter((s) => s.conflicts.length).map((s) => s.i)).toEqual(Array.from({ length: 14 }, (_, i) => 27 + i));
    const issues = motionIssues(res, doc);
    expect(issues.map((x) => [x.code, x.level, x.mate, x.step, x.steps])).toEqual([
      ["motion.conflict", "warn", "d", 27, [27, 40]],
      ["motion.conflict", "warn", "l1", 27, [27, 40]],
      ["motion.conflict", "warn", "l2", 27, [27, 40]],
    ]);
    expect(issues[0].t[0]).toBeCloseTo(1.35, 9);
    expect(issues[1].args).toEqual(["Mez vzdálenosti S → K", "27–40 (t = 1.35–2 s)"]);
    expect(issues[1].text).toBe("pohyb porušuje vazbu „Mez vzdálenosti S → K“ v kroku 27–40 (t = 1.35–2 s)");
    const sum = motionSummary(res, doc);
    expect(sum.join("\n")).toMatch(/⚠ nesplněné vazby v 14 krocích/);
    expect(sum.filter((l) => l.startsWith(" ⚠ motion.conflict "))).toEqual([
      " ⚠ motion.conflict pohyb porušuje vazbu „Vzdálenost U → B“ v kroku 27–40 (t = 1.35–2 s)",
      " ⚠ motion.conflict pohyb porušuje vazbu „Mez vzdálenosti S → K“ v kroku 27–40 (t = 1.35–2 s)",
      " ⚠ motion.conflict pohyb porušuje vazbu „Mez vzdálenosti S → M“ v kroku 27–40 (t = 1.35–2 s)",
    ]);
  });

  it("protokol motion.conflict nezávisí na id vazeb (uid = Math.random): pořadí podle dokumentu, stejný text", async () => {
    const texts: string[][] = [];
    // tytéž vazby s jinými id v opačném abecedním pořadí (dřív se řadilo podle id → jiné pořadí i jiné 3 vypsané vazby)
    for (const ids of [{ d: "zz9", l1: "mm5", l2: "aa1" }, { d: "aa1", l1: "zz9", l2: "mm5" }, { d: "q0", l1: "q1", l2: "q2" }] as Record<string, string>[]) {
      const { doc, geo } = dieSet();
      const ren = { ...doc, mates: doc.mates!.map((m) => ({ ...m, id: ids[m.id] ?? m.id })) };
      const res = await runMotion(ren, geo, { ...study(60, 20), motors: [{ id: "mo", kind: "linear", mate: ids.d, from: 175, to: 115 }] });
      const issues = motionIssues(res, ren);
      expect(issues.map((x) => x.mate)).toEqual([ids.d, ids.l1, ids.l2]);
      texts.push(motionSummary(res, ren).filter((l) => l.includes("motion.conflict")));
    }
    expect(texts[1]).toEqual(texts[0]);
    expect(texts[2]).toEqual(texts[0]);
    expect(texts[0].length).toBe(3);
  });

  it("zdvih 40 mm (splnitelný): žádný konflikt, deska klesne přesně o 40 mm", async () => {
    const { doc, geo } = dieSet();
    const res = await runMotion(doc, geo, study(40));
    expect(res.conflictSteps).toBe(0);
    expect(motionIssues(res, doc)).toEqual([]);
    expect(res.steps[40].place.U.position[2]).toBeCloseTo(175, 6);
    expect(res.steps[40].place.S.position[2]).toBeCloseTo(70, 6); // stírací deska dosedne 20 mm pod kotevní deskou (horní mez)
    for (const id of ["U", "S"]) expect(span(res, id, 0) + span(res, id, 1)).toBeLessThan(1e-6);
    expect(motionSummary(res, doc).join("\n")).toMatch(/Vazby splněny ve všech krocích/);
  });

  it("kód motion.conflict je stejný v cs/en/de, lokalizovaný je jen popis", async () => {
    const { doc, geo } = dieSet();
    const res = await runMotion(doc, geo, study(60, 20));
    const texts = (["cs", "en", "de"] as const).map((l) => {
      setLang(l);
      const x = motionIssues(res, doc);
      expect(x.map((i) => [i.code, i.steps, i.args[1]])).toEqual([
        ["motion.conflict", [14, 20], "14–20 (t = 1.4–2 s)"],
        ["motion.conflict", [14, 20], "14–20 (t = 1.4–2 s)"],
        ["motion.conflict", [14, 20], "14–20 (t = 1.4–2 s)"],
      ]);
      return x[1].text;
    });
    expect(new Set(texts).size).toBe(3);
    expect(texts[1]).toBe("the motion violates mate “Distance limit S → K” in step 14–20 (t = 1.4–2 s)");
    expect(texts[2]).toMatch(/^die Bewegung verletzt die Verknüpfung „.* S → K“ in Schritt 14–20 \(t = 1\.4–2 s\)$/);
  });
});

describe("velký krok pohybu: regularizace μ·|x|² nezkrátí splnitelný posuv (nález kontroly A3)", () => {
  // blok na Vzdálenosti od ukotvené desky poháněný lineárním motorem; dřív (μ = 1e-6 a doladění jen při zbytku < 1e-3) zůstal
  // posuv o 1 500 mm v jednom kroku o 1,5e-3 mm kratší → falešné „⚠ nesplněné vazby“ / motion.conflict (v přísném režimu STOP)
  const G: Geos = { B: { f0: plane([50, 50, 10], Z) }, A: { f0: plane([10, 10, 0], NZ) }, F: { f0: cyl([0, 0, 0], Z, 5) }, K: { f0: cyl([0, 0, 0], Z, 5) } };
  const blockDoc = (): CadDoc => ({ ...emptyDoc("T"), kind: "assembly", components: [comp("B", P(), true), comp("A", P([40, 40, 10]))], mates: [{ id: "dm", type: "distance", a: f("A", 0), b: f("B", 0), value: 0 }] });
  it.each([
    [1500, 1],
    [3000, 1],
    [3000, 2],
    [10000, 1],
    [-5000, 1],
    [600, 1],
  ])("posuv 0…%d mm v %d krocích: přesně, bez konfliktu, bez bočního posunu", async (D, n) => {
    const res = await runMotion(blockDoc(), provider(G), { motors: [{ id: "mo", kind: "linear", mate: "dm", from: 0, to: D }], duration: 1, steps: n });
    expect(res.conflictSteps).toBe(0);
    expect(motionIssues(res, blockDoc())).toEqual([]);
    for (const s of res.steps) {
      const p = s.place.A.position;
      expect(Math.abs(p[2] - 10 - s.motors[0]), `krok ${s.i}`).toBeLessThan(1e-6);
      expect(Math.abs(p[0] - 40) + Math.abs(p[1] - 40)).toBeLessThan(1e-9);
    }
  });

  it("natočení závěsu o 180° v jednom kroku: přesně, bez konfliktu", async () => {
    const d: CadDoc = { ...emptyDoc("T"), kind: "assembly", components: [comp("F", P(), true), comp("K", P())], mates: [{ id: "h", type: "hinge", a: f("K", 0), b: f("F", 0) }] };
    const res = await runMotion(d, provider(G), { motors: [{ id: "mo", kind: "rotary", mate: "h", from: 0, to: 180 }], duration: 1, steps: 1 });
    expect(res.conflictSteps).toBe(0);
    expect(Math.abs(Math.abs(res.steps[1].place.K.rotation[2]) - 180)).toBeLessThan(1e-6);
  });

  it("řešič: splnitelný velký posuv přesně; nesplnitelná soustava s minimem „v nekonečnu“ se ani u velkého kroku nerozjede", () => {
    // splnitelné: z = 1500, ostatní stupně volnosti beze změny
    let poses = new Map<string, Pose>([["A", poseOf(P())]]);
    let r = solvePoses(poses, [{ id: "A", pivot: [0, 0, 0] }], () => [poses.get("A")!.p[2] - 1500]);
    expect(Math.abs(poses.get("A")!.p[2] - 1500)).toBeLessThan(1e-9);
    expect(Math.abs(poses.get("A")!.p[0]) + Math.abs(poses.get("A")!.p[1])).toBeLessThan(1e-12);
    expect(r.cost).toBeLessThan(1e-18);
    // nesplnitelné: druhý zbytek 0,03·e^(−x/300) klesá k nule až pro x → ∞ (jako mírně nesouosá vedení v P7). Velký krok v Z
    // pustí doladění bez μ (zbytek < 100·μ·|x|); to smí polohu změnit jen řádově o posun vlivem μ a přijme jen krok, který cenu
    // aspoň čtyřikrát sníží – kompromis tak zůstane u výchozí polohy. Řešič bez μ (`reg: 0`, dřívější chování) ujede o stovky mm.
    const drift = (reg?: number) => {
      const q = new Map<string, Pose>([["A", poseOf(P())]]);
      const resid = () => {
        const p = q.get("A")!.p;
        return [p[2] - 1500, 0.03 * Math.exp(-p[0] / 300)];
      };
      return { cost: solvePoses(q, [{ id: "A", pivot: [0, 0, 0] }], resid, reg === undefined ? {} : { reg }).cost, p: q.get("A")!.p };
    };
    const d = drift();
    expect(Math.abs(d.p[0])).toBeLessThan(10); // nejmenší změna: kompromis μ (≈ 3 mm), ne útěk do nekonečna
    expect(Math.abs(d.p[2] - 1500)).toBeLessThan(0.01);
    expect(d.cost).toBeGreaterThan(1e-6); // zůstává konflikt (nahlásí se)
    expect(Math.abs(drift(0).p[0])).toBeGreaterThan(300);
  });
});

describe("tuhé skupiny ze zámků", () => {
  const I: Pose = poseOf(P());
  const near = (a: Pose, b: Pose) => Math.max(...a.R.map((v, i) => Math.abs(v - b.R[i])), ...a.p.map((v, i) => Math.abs(v - b.p[i])));
  it("union-find: řetěz zámků, kořen = první komponenta, polohy členů složením rel po kostře; smyčka mimo kostru", () => {
    const poses = new Map<string, Pose>([
      ["A", poseOf(P([10, 0, 0], [0, 0, 30]))],
      ["B", poseOf(P([0, 20, 5], [10, 0, 0]))],
      ["C", poseOf(P([-3, 4, 50], [0, 45, 0]))],
      ["F", I],
      ["D", poseOf(P([7, 7, 7]))],
      ["E", poseOf(P([1, 2, 3]))],
    ]);
    // rel zámku = poloha A v souřadnicích B (jako initMate)
    const lock = (id: string, a: string, b: string): Mate => ({ id, type: "lock", a: f(a, -1), b: f(b, -1), rel: placementOf(composePose(invertPose(poses.get(b)!), poses.get(a)!)) });
    const mates = [lock("ab", "B", "A"), lock("cb", "C", "B"), lock("ca", "A", "C"), lock("df", "D", "F"), { ...lock("x", "E", "A"), suppressed: true }];
    const g = rigidGroups(mates, ["A", "B", "C", "F", "D", "E"], (id) => id === "F");
    expect(g.rootOf.get("B")).toBe("A");
    expect(g.rootOf.get("C")).toBe("A");
    expect(g.rootOf.get("D")).toBe("F");
    expect(g.rootOf.has("E")).toBe(false); // potlačený zámek se nepočítá
    expect(g.fixedRoots).toEqual(new Set(["F"]));
    expect(g.tree.size).toBe(3); // ab, cb (nebo ca) a df; třetí zámek smyčky A–B–C zůstává vazbou řešiče
    expect([...g.tree].filter((id) => ["ab", "cb", "ca"].includes(id)).length).toBe(2);
    for (const m of g.members.get("A")!) expect(near(composePose(poses.get("A")!, m.rel), poses.get(m.id)!), m.id).toBeLessThan(1e-6); // rel zámku je uložen jako umístění (úhly na 1e-6°)
    expect(near(composePose(I, g.members.get("F")![0].rel), poses.get("D")!)).toBeLessThan(1e-9);
  });

  it("pohyb: jedna poloha na skupinu (méně neznámých), časy studie a průběh po krocích", async () => {
    const { doc, geo } = dieSet();
    const info: { k: number; ms: number }[] = [];
    const res = await runMotion(doc, geo, study(40, 10), { onStep: (k, _n, x) => info.push({ k, ms: x?.ms ?? -1 }) });
    // proměnné: sloupky P0, P3, horní skupina (U, K, N1, N2) a stírací deska S → 4 × 6; M je pevná skupina s B
    expect(res.timing).toMatchObject({ vars: 24, groups: 2, collideMs: 0 });
    expect(res.timing!.ms).toBeGreaterThanOrEqual(res.timing!.solveMs);
    expect(res.timing!.slowStep!.i).toBeGreaterThanOrEqual(0);
    expect(info.map((x) => x.k)).toEqual(Array.from({ length: 11 }, (_, i) => i));
    expect(info.every((x) => x.ms >= 0)).toBe(true);
  });
});
