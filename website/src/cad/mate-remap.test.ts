/**
 * Vlna 22, bod 20 – reference vazeb po změně historie dílu (cad/mate-remap.ts): přečíslovat jen při skutečné geometrické
 * shodě; žádná shoda = ztraceno, víc možností = ztraceno (nikdy „nejbližší“ jiná plocha). Plochy jsou ze skutečného dílu
 * „Deska A“ (60 × 40 × 10 se schodem 20 × 40 × 5 – repro/20, výpis `sestava plochy`).
 */
import { describe, expect, it } from "vitest";
import { entPrint, facePrint, markLost, matchEnt, matchFace, matchLost, withFace, type FaceCand } from "./mate-remap";
import { mateLost, solveMates, type FaceGeo, type PartFace } from "./mates";
import type { CadDoc, MateRef, Vec3 } from "./types";

const P = (o: Vec3, n: Vec3): PartFace => ({ kind: "plane", origin: o, normal: n });
const C = (o: Vec3, n: Vec3, r: number, ext: [number, number]): PartFace => ({ kind: "cylinder", origin: o, normal: n, radius: r, extent: ext });
const F = (face: number, info: PartFace, area?: number): FaceCand => ({ face, info, ...(area !== undefined ? { area } : {}) });

/** Deska A se schodem (před úpravou): F1…F8 = index 0…7 */
const STEPPED: FaceCand[] = [
  F(0, P([0, 20, 2.5], [-1, 0, 0]), 200),
  F(1, P([34, 0, 4.5], [0, -1, 0]), 500),
  F(2, P([10, 20, 5], [0, 0, 1]), 800), // schod +Z ve výšce 5 – na něj vede vazba Kontakt
  F(3, P([34, 40, 4.5], [0, 1, 0]), 500),
  F(4, P([30, 20, 0], [0, 0, -1]), 2400),
  F(5, P([60, 20, 5], [1, 0, 0]), 400),
  F(6, P([40, 20, 10], [0, 0, 1]), 1600),
  F(7, P([20, 20, 7.5], [-1, 0, 0]), 200),
];
/** po `smazat "Kvádr 2"` (schod zmizel): F3 je teď boční plocha −Y – dřív se na ni vazba tiše připojila */
const FLAT: FaceCand[] = [
  F(0, P([0, 20, 5], [-1, 0, 0]), 400),
  F(1, P([60, 20, 5], [1, 0, 0]), 400),
  F(2, P([30, 0, 5], [0, -1, 0]), 600),
  F(3, P([30, 40, 5], [0, 1, 0]), 600),
  F(4, P([30, 20, 0], [0, 0, -1]), 2400),
  F(5, P([30, 20, 10], [0, 0, 1]), 2400),
];
const old = (i: number, list = STEPPED) => facePrint(list[i].info, list[i].area);

describe("matchFace – táž plocha jen při skutečné geometrické shodě", () => {
  it("žádná plocha na téže rovině → ztraceno (none), ne boční plocha se stejným číslem F3", () => {
    const m = matchFace(old(2), FLAT, 2);
    expect(m).toEqual({ state: "lost", why: "none", candidates: [] });
  });

  it("přesná shoda (rovina, střed, plocha) beze změny čísla → same / exact", () => {
    expect(matchFace(old(4), FLAT, 4)).toEqual({ state: "same", face: 4, how: "exact" });
  });

  it("přesná shoda s jiným číslem → přečíslováno (exact)", () => {
    const shuffled = [...STEPPED].reverse().map((f, i) => F(i, f.info, f.area));
    expect(matchFace(old(2), shuffled, 2)).toEqual({ state: "renumbered", face: 5, how: "exact" });
  });

  it("jediná plocha na téže rovině, jiný střed a velikost → přečíslováno (surface – táž rovina, změnila velikost)", () => {
    expect(matchFace(old(6), FLAT, 6)).toEqual({ state: "renumbered", face: 5, how: "surface" });
    expect(matchFace(old(1), FLAT, 1)).toEqual({ state: "renumbered", face: 2, how: "surface" }); // −Y: 500 mm² → 600 mm²
  });

  it("dvě plochy na téže rovině, žádná přesná → nejednoznačné = ztraceno (ambiguous), ne nejbližší", () => {
    // drážka napříč schodem rozdělí plochu F3 na dvě koplanární plochy
    const split = [...FLAT.slice(0, 5), F(5, P([5, 20, 5], [0, 0, 1]), 400), F(6, P([16, 20, 5], [0, 0, 1]), 320), F(7, P([40, 20, 10], [0, 0, 1]), 1600)];
    const m = matchFace(old(2), split, 2);
    expect(m.state).toBe("lost");
    expect(m.state === "lost" && m.why).toBe("ambiguous");
    expect(m.state === "lost" && m.candidates.sort()).toEqual([5, 6]);
  });

  it("dvě přesné shody: rozhodne jen původní číslo, jinak nejednoznačné", () => {
    const dup = [F(0, P([0, 0, 5], [0, 0, 1])), F(1, P([0, 0, 5], [0, 0, 1]))];
    expect(matchFace(facePrint(P([0, 0, 5], [0, 0, 1])), dup, 1)).toEqual({ state: "same", face: 1, how: "exact" });
    expect(matchFace(facePrint(P([0, 0, 5], [0, 0, 1])), dup, 7)).toMatchObject({ state: "lost", why: "ambiguous" });
  });

  it("opačná normála ani rovnoběžná rovina o kousek vedle nejsou táž plocha", () => {
    expect(matchFace(facePrint(P([10, 20, 5], [0, 0, -1])), FLAT, 2).state).toBe("lost");
    expect(matchFace(facePrint(P([10, 20, 5.5], [0, 0, 1])), [F(0, P([10, 20, 5], [0, 0, 1]))], 0).state).toBe("lost");
  });

  it("válec: táž osa a poloměr (i obrácená osa), jiný poloměr nebo osa → ztraceno", () => {
    // vlna 22 kolo 6 (vědomá změna dat): obrácená osa TÉŽE díry, prohloubené o 2 mm (z 10 → −2); dřív z −5 → −15 = úsek osy pod
    // deskou, který se s novým pravidlem překryvu správně nepřiřadí (případ „válec: úsek téže osy jinde“ níže)
    const holes = [F(0, C([40, 30, 10], [0, 0, -1], 5.25, [0, 12])), F(1, C([20, 15, 0], [0, 0, 1], 4.5, [0, 10]))];
    expect(matchFace(facePrint(C([40, 30, 0], [0, 0, 1], 5.25, [0, 10])), holes, 3)).toEqual({ state: "renumbered", face: 0, how: "surface" });
    expect(matchFace(facePrint(C([40, 30, 0], [0, 0, 1], 5, [0, 10])), holes, 0).state).toBe("lost");
    expect(matchFace(facePrint(C([41, 30, 0], [0, 0, 1], 5.25, [0, 10])), holes, 0).state).toBe("lost");
  });

  it("kolo 6: druhý schod na TÉŽE rovině se stejnou plochou (bez překryvu s otiskem) → ztraceno, ne přečíslováno", () => {
    // Deska 60 × 40 × 10 se dvěma schody 20 × 40 × 5 (vlevo x 0…20, vpravo x 40…60); vazba na levý schod; levý se smaže
    const B = (x0: number, x1: number, z: number): [Vec3, Vec3] => [[x0, 0, z], [x1, 40, z]];
    const left = { ...F(2, P([10, 20, 5], [0, 0, 1]), 800), box: B(0, 20, 5) };
    const after = [{ ...F(6, P([50, 20, 5], [0, 0, 1]), 800), box: B(40, 60, 5) }, { ...F(5, P([20, 20, 10], [0, 0, 1]), 1600), box: B(0, 40, 10) }];
    const o = facePrint(left.info, left.area, left.box);
    expect(o.box).toEqual(B(0, 20, 5));
    expect(matchFace(o, after, 2)).toEqual({ state: "lost", why: "none", candidates: [] });
    // bez obálek (starší otisk): kotouče o stejné ploše kolem středů [10;20;5] a [50;20;5] se neprotínají → také ztraceno
    expect(matchFace(old(2), after.map(({ box: _b, ...f }) => f), 2).state).toBe("lost");
    // táž rovina, plocha se protíná s otiskem (schod rozšířen na x 0…30) → přečíslováno (surface)
    expect(matchFace(o, [{ ...F(7, P([15, 20, 5], [0, 0, 1]), 1200), box: B(0, 30, 5) }], 2)).toEqual({ state: "renumbered", face: 7, how: "surface" });
    // plocha jen dotčená hranou (x 20…40) není překryv
    expect(matchFace(o, [{ ...F(7, P([30, 20, 5], [0, 0, 1]), 800), box: B(20, 40, 5) }], 2).state).toBe("lost");
    // dva kandidáti na téže rovině, i když jeden překrývá → nejednoznačné
    expect(matchFace(o, [{ ...F(7, P([15, 20, 5], [0, 0, 1]), 1200), box: B(0, 30, 5) }, after[0]], 2)).toMatchObject({ state: "lost", why: "ambiguous" });
    // bez plochy i obálky se překryv ověřit nedá → ztraceno (nikdy tiché připojení)
    expect(matchFace(facePrint(left.info), [F(6, P([12, 20, 5], [0, 0, 1]))], 2).state).toBe("lost");
  });

  it("kolo 6: válec – úsek téže osy jinde (rozsahy podél osy se neprotínají) → ztraceno; prodloužená díra → přečíslováno", () => {
    const o = facePrint(C([40, 30, 0], [0, 0, 1], 5.25, [0, 10])); // z 0…10
    expect(matchFace(o, [F(0, C([40, 30, -5], [0, 0, -1], 5.25, [0, 10]))], 0).state).toBe("lost"); // z −5…−15
    expect(matchFace(o, [F(0, C([40, 30, 0], [0, 0, 1], 5.25, [0, 20]))], 0)).toEqual({ state: "same", face: 0, how: "surface" }); // z 0…20
  });

  it("faceBoxes: obálka ploch ze skupin sítě", async () => {
    const { faceBoxes } = await import("./mate-remap");
    // dva trojúhelníky plochy 0 (čtverec 0…2 × 0…3 v z = 5), jeden plochy 2
    const mesh = { vertices: [0, 0, 5, 2, 0, 5, 2, 3, 5, 0, 3, 5, 9, 9, 9], triangles: [0, 1, 2, 0, 2, 3, 4, 4, 4], faceGroups: [0, 6, 0, 6, 3, 2] };
    const b = faceBoxes(mesh);
    expect(b[0]).toEqual([[0, 0, 5], [2, 3, 5]]);
    expect(b[1]).toBeUndefined();
    expect(b[2]).toEqual([[9, 9, 9], [9, 9, 9]]);
  });

  it("otisk válce = střed osy v rozsahu plochy a délka (přesná shoda podle nich)", () => {
    const p = facePrint(C([0, 0, 0], [0, 0, 1], 3, [2, 12]));
    expect(p).toMatchObject({ kind: "cylinder", origin: [0, 0, 7], length: 10, radius: 3 });
    expect(matchFace(p, [F(4, C([0, 0, 10], [0, 0, -1], 3, [-2, 8]))], 4)).toEqual({ state: "same", face: 4, how: "exact" });
  });
});

describe("matchEnt – hrany a vrcholy jen přesně", () => {
  const line = (a: Vec3, b: Vec3): PartFace => ({ kind: "line", origin: a, normal: [b[0] - a[0], b[1] - a[1], b[2] - a[2]], pts: [a, b] });
  it("táž úsečka (i obrácená) jinde v seznamu → přečíslováno; kratší úsečka na téže přímce → ztraceno", () => {
    const o = entPrint(line([0, 0, 0], [60, 0, 0]));
    expect(matchEnt(o, [{ index: 0, info: line([0, 40, 0], [60, 40, 0]) }, { index: 3, info: line([60, 0, 0], [0, 0, 0]) }], 0)).toEqual({ state: "renumbered", face: 3, how: "exact" });
    expect(matchEnt(o, [{ index: 0, info: line([0, 0, 0], [30, 0, 0]) }], 0)).toMatchObject({ state: "lost", why: "none" });
  });
  it("vrchol: stejný bod → same; dva stejné body bez původního čísla → nejednoznačné", () => {
    const v: PartFace = { kind: "point", origin: [60, 40, 10], normal: [0, 0, 1] };
    expect(matchEnt(entPrint(v), [{ index: 2, info: v }], 2)).toEqual({ state: "same", face: 2, how: "exact" });
    expect(matchEnt(entPrint(v), [{ index: 1, info: v }, { index: 5, info: v }], 2)).toMatchObject({ state: "lost", why: "ambiguous" });
  });
});

describe("ztracená reference: otisk, obnova jen přesnou shodou", () => {
  const ref: MateRef = { compId: "deska", face: 2 };
  it("markLost uloží otisk a důvod, číslo plochy zůstává jen pro text; withFace ztrátu zruší", () => {
    const r = markLost(ref, old(2), "none");
    expect(r.face).toBe(2);
    expect(r.lost).toMatchObject({ kind: "plane", origin: [10, 20, 5], normal: [0, 0, 1], area: 800, why: "none" });
    expect(markLost(ref, null, "none").lost?.why).toBe("unknown");
    expect(withFace(r, 5)).toEqual({ compId: "deska", face: 5 });
  });
  it("vrácený schod (přesná shoda) referenci obnoví; jen táž rovina jiné velikosti ne", () => {
    const lost = markLost(ref, old(2), "none").lost!;
    expect(matchLost(lost, STEPPED, null, 2)).toEqual({ state: "same", face: 2, how: "exact" });
    const wider = [F(9, P([12.5, 20, 5], [0, 0, 1]), 1000)];
    expect(matchLost(lost, wider, null, 2).state).toBe("lost");
  });
});

describe("řešič: ztracená vazba je mimo řešení – komponenta se nehýbe, stav lost (nikdy ok)", () => {
  const doc = (lost: boolean): CadDoc => ({
    app: "mnastrojarna-cad",
    version: 2,
    name: "Sestava A",
    kind: "assembly",
    material: "ocel",
    features: [],
    components: [
      { id: "deska", name: "Deska A", source: { kind: "part", doc: { app: "mnastrojarna-cad", version: 2, name: "Deska A", material: "ocel", kind: "part", features: [] } }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] }, fixed: true },
      { id: "prid", name: "Přidržovač", source: { kind: "part", doc: { app: "mnastrojarna-cad", version: 2, name: "Přidržovač", material: "ocel", kind: "part", features: [] } }, placement: { position: [40, 10, 30], rotation: [0, 0, 0] } },
    ],
    mates: [{ id: "m1", type: "mate", a: { compId: "prid", face: 4 }, b: lost ? markLost({ compId: "deska", face: 2 }, old(2), "none") : { compId: "deska", face: 2 } }],
  });
  // geometrie podle čísla plochy (jako mezipaměť) – ztracený odkaz by bez ochrany dostal boční plochu −Y (FLAT[2])
  const geo = (ref: MateRef): FaceGeo | null => (ref.lost ? null : ref.compId === "prid" ? (ref.face === 4 ? P([5, 5, 0], [0, 0, -1]) : null) : (FLAT[ref.face]?.info ?? null));
  it("bez ztráty by vazba Přidržovačem pohnula a natočila (dnešní tichá vada); se ztrátou zůstane na místě", () => {
    const silent = solveMates(doc(false), geo);
    expect(silent.moved).toEqual(["prid"]);
    const r = solveMates(doc(true), geo);
    expect(r.status.m1).toBe("lost");
    expect(r.moved).toEqual([]);
    expect(r.components.find((c) => c.id === "prid")!.placement.position).toEqual([40, 10, 30]);
    expect(mateLost(doc(true).mates![0])).toBe(true);
  });
  it("i když poskytovatel geometrie ztrátu nezná, řešič ztracenou vazbu neřeší", () => {
    const naive = (ref: MateRef): FaceGeo | null => (ref.compId === "prid" ? P([5, 5, 0], [0, 0, -1]) : (FLAT[ref.face]?.info ?? null));
    const r = solveMates(doc(true), naive);
    expect(r.status.m1).toBe("lost");
    expect(r.moved).toEqual([]);
  });
});
