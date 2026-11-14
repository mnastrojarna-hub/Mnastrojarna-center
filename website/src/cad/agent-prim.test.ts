/** Primitiva textem (12. vlna): poloha číslem i odkazem, osa libovolným směrem, operace, pružina – CS / EN / DE, stav, jádro. */
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "./build";
import { docStatusText, featureSummary, parseAgentText } from "./agent";
import { resolveDatumNames } from "./agent-prim";
import { setLang } from "./i18n";
import { emptyDoc, type CadDoc, type Feature } from "./types";
import "./ext/index";
import "./feat/index";

afterEach(() => setLang("cs"));

type Any = Feature & { dirDef?: unknown; positionRef?: unknown };
const feat = (text: string): Any => {
  const p = parseAgentText(text);
  expect(p.errors, text).toEqual([]);
  const op = p.ops[0] as { k: string; feature: Any };
  expect(op.k).toBe("feature");
  return op.feature;
};
const err = (text: string) => parseAgentText(text).errors[0]?.message ?? "";

describe("primitiva – poloha, osa a operace textem (CS)", () => {
  it("kužel: poloha, odebrat a šikmá osa vektorem (dřív se „směr“ tiše ignoroval)", () => {
    expect(feat("kužel 20 0 15 v 0 0 20 odebrat osa 0 0,5 -0,866")).toMatchObject({ type: "cone", radius1: 10, radius2: 0, height: 15, position: [0, 0, 20], mode: "cut", axis: "Z", dirDef: { kind: "vector", v: [0, 0.5, -0.866] } });
    expect(feat("kužel 20 0 15 směr 1 0 1")).toMatchObject({ dirDef: { kind: "vector", v: [1, 0, 1] } });
    expect(feat("kužel 20 10 30 osa -Z")).toMatchObject({ axis: "Z", dirDef: { kind: "vector", v: [0, 0, -1] } });
    expect(feat("kužel 20 10 30 osa X")).toMatchObject({ axis: "X" });
    expect(feat("kužel 20 10 30 osa X").dirDef).toBeUndefined();
    expect(feat("kužel 20 10 30 obráceně")).toMatchObject({ dirDef: { kind: "vector", v: [0, 0, -1] } });
  });
  it("poloha odkazem: vrchol, střed hrany, střed kružnice, střed plochy, začátek / konec hrany, pomocný bod, mezi body, počátek", () => {
    expect(feat("válec 10 50 na V3")).toMatchObject({ positionRef: { kind: "vertex", index: 2 }, position: [0, 0, 0] });
    expect(feat("válec 10 50 střed hrany E2")).toMatchObject({ positionRef: { kind: "edge", index: 1, at: "mid" } });
    expect(feat("válec 10 50 v E2")).toMatchObject({ positionRef: { kind: "edge", index: 1, at: "mid" } });
    expect(feat("kužel 12 0 6 na střed kružnice E5 osa plocha F7 odebrat")).toMatchObject({ positionRef: { kind: "edge", index: 4, at: "center" }, dirDef: { kind: "faceNormal", ref: { kind: "face", index: 6 } }, mode: "cut" });
    expect(feat("trubka 20 10 5 na střed plochy F3")).toMatchObject({ positionRef: { kind: "face", index: 2 } });
    expect(feat("válec 4 10 na začátek hrany E1")).toMatchObject({ positionRef: { kind: "edge", index: 0, at: "start" } });
    expect(feat("válec 4 10 na konec E1")).toMatchObject({ positionRef: { kind: "edge", index: 0, at: "end" } });
    expect(feat('kvádr 10 20 30 střed na bod "Bod 1" osa X')).toMatchObject({ centered: true, positionRef: { kind: "datumPoint", featureId: "Bod 1" }, dirDef: { kind: "axis", axis: "X" } });
    expect(feat("válec 8 30 na mezi V1 V5 osa body V1 V5")).toMatchObject({ positionRef: { kind: "derived", op: "mid", args: [{ kind: "vertex", index: 0 }, { kind: "vertex", index: 4 }] }, dirDef: { kind: "twoPoints", a: { kind: "vertex", index: 0 }, b: { kind: "vertex", index: 4 } } });
    expect(feat("koule 10 na počátek")).toMatchObject({ positionRef: { kind: "csys" } });
    expect(feat("koule 10 na bod 1 2 3 odebrat")).toMatchObject({ position: [1, 2, 3], mode: "cut" });
    expect(feat("koule 10 na bod 1 2 3").positionRef).toBeUndefined();
  });
  it("osa odkazem: hrana, plocha, pomocná osa názvem, dva body, „obráceně“ u dvou bodů", () => {
    expect(feat("válec 6 40 osa hrana E3")).toMatchObject({ dirDef: { kind: "edge", ref: { kind: "edge", index: 2 } } });
    expect(feat("válec 6 40 osa E3")).toMatchObject({ dirDef: { kind: "edge", ref: { kind: "edge", index: 2 } } });
    expect(feat('válec 6 40 osa "Osa 1" odebrat')).toMatchObject({ dirDef: { kind: "edge", ref: { kind: "datumAxis", featureId: "Osa 1" } }, mode: "cut" });
    expect(feat('válec 6 40 směr osa "Osa 1"')).toMatchObject({ dirDef: { kind: "edge", ref: { kind: "datumAxis", featureId: "Osa 1" } } });
    expect(feat("válec 6 40 osa body V1 V2 obráceně")).toMatchObject({ dirDef: { kind: "twoPoints", a: { kind: "vertex", index: 1 }, b: { kind: "vertex", index: 0 } } });
    expect(feat("válec 6 40 osa 1 0 1 obráceně")).toMatchObject({ dirDef: { kind: "vector", v: [-1, 0, -1] } });
  });
  it("kvádr: střed v bodě, osa Z kvádru směrem; průnik a nové těleso", () => {
    expect(feat("kvádr 20 20 20 střed v 50 50 50")).toMatchObject({ type: "box", size: [20, 20, 20], centered: true, position: [50, 50, 50], mode: "add" });
    expect(feat("kvádr 20 20 20 střed v 50 50 50").dirDef).toBeUndefined();
    expect(feat("kvádr 10 20 30 osa 0 1 1 průnik")).toMatchObject({ dirDef: { kind: "vector", v: [0, 1, 1] }, mode: "intersect" });
    expect(feat('kužel 20 10 30 nové těleso "Kolík"')).toMatchObject({ mode: "new", body: "Kolík" });
    expect(feat('trubka 20 10 30 v 1 2 3 průnik název "Pouzdro"')).toMatchObject({ mode: "intersect", name: "Pouzdro", position: [1, 2, 3] });
  });
  it("pružina: nový textový příkaz (dřív jen prvek spring …)", () => {
    expect(feat("pružina 20 stoupání 5 závity 8 drát 2 v 0 0 10 osa X")).toMatchObject({ type: "spring", radius: 10, pitch: 5, turns: 8, wire: 2, position: [0, 0, 10], axis: "X", mode: "add" });
    expect(feat("pružina 20 stoupání 5 délka 40 drát 2 odebrat")).toMatchObject({ turns: 8, mode: "cut" });
    expect(err("pružina 20 stoupání 5")).toMatch(/pružina potřebuje průměr, stoupání, počet závitů/);
    expect(err("pružina 20 stoupání 5 závity 8 délka 40 drát 2")).toMatch(/buď počet závitů, nebo délku/);
  });
  it("závit: poloha odkazem a osa směrem (vnitřní závit v díře shora)", () => {
    expect(feat("závit M8 délka 10 na střed kružnice E3 osa -Z vnitřní")).toMatchObject({ type: "thread", designation: "M8", length: 10, internal: true, positionRef: { kind: "edge", index: 2, at: "center" }, dirDef: { kind: "vector", v: [0, 0, -1] } });
    expect(feat("závit M18x1,5 délka 20 v 0 0 10 vnitřní modelovat")).toMatchObject({ type: "thread", designation: "M18×1,5", length: 20, position: [0, 0, 10], axis: "Z", internal: true, modeled: true });
    expect(err("závit M8 délka 10 odebrat")).toMatch(/závit nemá operaci/);
  });
  it("dřívější zápisy dávají stejné prvky", () => {
    expect(feat("kvádr 100 60 20")).toMatchObject({ type: "box", size: [100, 60, 20], position: [0, 0, 0], centered: false, mode: "add" });
    expect(feat("válec 20 30 osa X v 1 2 3 odebrat")).toMatchObject({ type: "cylinder", radius: 10, height: 30, axis: "X", position: [1, 2, 3], mode: "cut" });
    expect(feat("koule 10 v 1 2 3 odebrat")).toMatchObject({ type: "sphere", radius: 5, position: [1, 2, 3], mode: "cut" });
    expect(feat("trubka 20 10 30")).toMatchObject({ type: "tube", outer: 20, inner: 10, height: 30, axis: "Z" });
    expect(err("kvádr 1")).toBe("kvádr potřebuje tři kladné rozměry: kvádr X Y Z");
    for (const t of ["kvádr 1 2 3", "válec 1 2", "koule 1", "kužel 2 1 3", "trubka 3 2 1"]) {
      const f = feat(t);
      expect(f.dirDef, t).toBeUndefined();
      expect(f.positionRef, t).toBeUndefined();
    }
  });
  it("neznámá nebo nepatřičná slova jsou chyba (dřív se tiše ignorovala)", () => {
    expect(err("kužel 20 10 30 směr")).toMatch(/osa \/ směr potřebuje hodnotu/);
    expect(err("válec 10 50 hrany E2")).toMatch(/válec: volba „hrany“ sem nepatří/);
    expect(err("koule 10 osa X")).toMatch(/koule nemá osu/);
    expect(err("kvádr 10 10 10 V3")).toMatch(/kvádr: neznámé slovo „V3“/);
    expect(err("válec 10 20 v 1 2 3 na V3")).toMatch(/poloha je zadaná dvakrát/);
    expect(err("kužel 20 10 30 40")).toMatch(/příliš mnoho čísel/);
    expect(err("válec 10 20 osa hrana E3 obráceně")).toMatch(/„obráceně“ jde jen/);
    expect(err("válec 10 20 na nic")).toMatch(/„na nic“ není poloha/);
    expect(err("kvádr 10 10 10 skrz")).toMatch(/kvádr: volba „skrz“ sem nepatří/);
    expect(err("válec 10 20 osa odebrat")).toMatch(/osa \/ směr potřebuje hodnotu/);
    expect(err("válec 10 20 na F0")).toMatch(/začínají 1/);
  });
});

describe("primitiva – EN / DE", () => {
  it("anglicky", () => {
    setLang("en");
    expect(feat("cone 20 0 15 at mid edge E2 axis edge E3 cut")).toMatchObject({ type: "cone", positionRef: { kind: "edge", index: 1, at: "mid" }, dirDef: { kind: "edge", ref: { kind: "edge", index: 2 } }, mode: "cut" });
    expect(feat("cylinder 10 20 at center circle E5 axis face F7 intersect")).toMatchObject({ positionRef: { kind: "edge", index: 4, at: "center" }, dirDef: { kind: "faceNormal", ref: { kind: "face", index: 6 } }, mode: "intersect" });
    expect(feat("spring 20 pitch 5 turns 8 wire 2 direction 1 1 0")).toMatchObject({ type: "spring", radius: 10, pitch: 5, turns: 8, wire: 2, dirDef: { kind: "vector", v: [1, 1, 0] } });
    expect(feat('box 10 10 10 center at point "Point 1"')).toMatchObject({ centered: true, positionRef: { kind: "datumPoint", featureId: "Point 1" } });
    expect(feat("tube 20 10 5 at center face F3 axis points V1 V2 newbody")).toMatchObject({ positionRef: { kind: "face", index: 2 }, dirDef: { kind: "twoPoints" }, mode: "new" });
    expect(feat("thread M8 length 10 at center circle E3 axis -Z internal")).toMatchObject({ type: "thread", internal: true, positionRef: { kind: "edge", index: 2, at: "center" } });
    expect(err("sphere 10 axis X")).toMatch(/sphere has no axis/i);
  });
  it("německy", () => {
    setLang("de");
    expect(feat("kegel 20 0 15 bei mitte kante E2 achse kante E3 abziehen")).toMatchObject({ type: "cone", positionRef: { kind: "edge", index: 1, at: "mid" }, dirDef: { kind: "edge", ref: { kind: "edge", index: 2 } }, mode: "cut" });
    expect(feat("zylinder 10 20 bei mittelpunkt kreis E5 achse fläche F7")).toMatchObject({ positionRef: { kind: "edge", index: 4, at: "center" }, dirDef: { kind: "faceNormal" } });
    expect(feat("feder 20 steigung 5 windungen 8 draht 2 richtung 0 0 -1")).toMatchObject({ type: "spring", turns: 8, dirDef: { kind: "vector", v: [0, 0, -1] } });
    expect(feat('quader 10 10 10 mitte bei punkt "Punkt 1"')).toMatchObject({ centered: true, positionRef: { kind: "datumPoint", featureId: "Punkt 1" } });
    expect(feat("rohr 20 10 5 bei anfang kante E1 achse punkte V1 V2 schnittmenge")).toMatchObject({ positionRef: { kind: "edge", index: 0, at: "start" }, dirDef: { kind: "twoPoints" }, mode: "intersect" });
    expect(err("kugel 10 achse X")).toMatch(/Kugel hat keine Achse/i);
  });
});

describe("stav a pomocná geometrie názvem", () => {
  it("stav ukáže polohu a osu (číslem i odkazem)", () => {
    const f = feat("kužel 12 0 6 na střed kružnice E5 osa plocha F7 odebrat");
    expect(featureSummary(f)).toBe("Ø12→Ø0 × 6 mm, cut, podstava střed kružnice E5, osa plocha F7");
    expect(featureSummary(feat("válec 10 20 v 1 2 3 osa 0 0,5 -0,866"))).toBe("Ø10 × 20 mm, add, podstava [1; 2; 3], osa [0; 0,5; -0,866]");
    expect(featureSummary(feat("kvádr 20 20 20 střed v 50 50 50"))).toBe("20 × 20 × 20 mm (střed), add, střed [50; 50; 50]");
    expect(featureSummary(feat("pružina 20 stoupání 5 závity 8 drát 2"))).toBe("Ø20, stoupání 5, závitů 8, drát Ø2 (délka 40 mm), add, začátek [0; 0; 0], osa Z");
    const doc: CadDoc = { ...emptyDoc("t"), features: [{ id: "p1", name: "Bod 1", type: "datumPoint", ref: { kind: "xyz", p: [1, 2, 3] } }, { ...feat('koule 10 na bod "Bod 1"'), id: "k" }] };
    resolveDatumNames(doc.features[1], doc.features.slice(0, 1));
    expect(docStatusText(doc, null)).toMatch(/Koule 1 \[sphere, id k\] ✓ – Ø10 mm, add, střed bod „Bod 1“/);
  });
  it("resolveDatumNames: název → id, neznámý název = chyba s výčtem (nebo beze změny, není-li přísné)", () => {
    const list: Feature[] = [
      { id: "a1", name: "Osa 1", type: "datumAxis", def: { kind: "global", axis: "X" }, length: 50 },
      { id: "p1", name: "Bod 1", type: "datumPoint", ref: { kind: "xyz", p: [0, 0, 0] } },
    ];
    const f = feat('válec 6 40 na bod "bod 1" osa "Osa 1"') as Extract<Feature, { type: "cylinder" }>;
    resolveDatumNames(f, list);
    expect(f.positionRef).toEqual({ kind: "datumPoint", featureId: "p1" });
    expect(f.dirDef).toEqual({ kind: "edge", ref: { kind: "datumAxis", featureId: "a1" } });
    const g = feat('válec 6 40 osa "Osa 9"');
    expect(() => resolveDatumNames(g, list)).toThrow(/„Osa 9“ v historii není – k dispozici: Osa 1/);
    resolveDatumNames(g, list, false);
    expect(g).toMatchObject({ dirDef: { ref: { featureId: "Osa 9" } } });
  });
});

describe("primitiva textem – jádro (objemy)", () => {
  beforeAll(async () => {
    const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"), print: () => undefined, printErr: () => undefined });
    r.setOC(oc as never);
  }, 60_000);
  const build = async (...features: Feature[]) => {
    const res = await buildDoc({ ...emptyDoc("t"), features: features.map((f, i) => ({ ...f, id: f.id || `f${i}` })) });
    expect(res.status.every((s) => s.ok), JSON.stringify(res.status)).toBe(true);
    return res;
  };
  const plate = (x: number, y: number, z: number, at: [number, number, number] = [0, 0, 0]): Feature => ({ id: "plate", name: "Deska", type: "box", size: [x, y, z], position: at, centered: false, mode: "new" });

  it("kužel odebraný v poloze na šikmé ose: objem = deska − πr²h/3; průnik dá těleso kuželu se sklopenou obálkou", async () => {
    const vCone = (Math.PI * 100 * 15) / 3;
    const cut = await build(plate(100, 100, 60, [-50, -50, 0]), feat("kužel 20 0 15 v 0 0 40 osa 0 0,5 -0,866 odebrat"));
    expect(cut.metrics!.volume).toBeCloseTo(100 * 100 * 60 - vCone, 0);
    // průnik s velkým kvádrem = samotný kužel: Ø20 → špička, osa 30° od +Z k +Y, podstava v počátku
    const s = Math.sin(Math.PI / 6);
    const c = Math.cos(Math.PI / 6);
    const inter = await build(plate(200, 200, 200, [-100, -100, -100]), feat(`kužel 20 0 30 osa 0 ${s} ${c} průnik`));
    expect(inter.metrics!.volume).toBeCloseTo((Math.PI * 100 * 30) / 3, 0);
    const [lo, hi] = inter.metrics!.bbox;
    expect(lo[0]).toBeCloseTo(-10, 1);
    expect(hi[0]).toBeCloseTo(10, 1);
    expect(lo[1]).toBeCloseTo(-10 * c, 1);
    expect(hi[1]).toBeCloseTo(30 * s, 1);
    expect(lo[2]).toBeCloseTo(-10 * s, 1);
    expect(hi[2]).toBeCloseTo(30 * c, 1);
  }, 60_000);

  it("válec odebraný podél vektoru 1 0 1 deskou tloušťky 20: odebráno πr²·t/cos45°", async () => {
    const res = await build(plate(200, 200, 20, [-100, -100, 0]), feat("válec 10 150 v -50 0 -40 osa 1 0 1 odebrat"));
    expect(res.metrics!.volume).toBeCloseTo(200 * 200 * 20 - Math.PI * 25 * 20 * Math.SQRT2, 0);
    // stejný otvor po ose X: odebráno πr²·200
    const x = await build(plate(200, 200, 20, [-100, -100, 0]), feat("válec 10 300 v -150 0 10 osa X odebrat"));
    expect(x.metrics!.volume).toBeCloseTo(200 * 200 * 20 - Math.PI * 25 * 200, 0);
  }, 60_000);

  it("kvádr vystředěný v bodě, na středu plochy (odkazem) a na pomocném bodu názvem", async () => {
    const a = await build(feat("kvádr 20 20 20 střed v 50 50 50"));
    a.metrics!.bbox.flat().forEach((v, i) => expect(v).toBeCloseTo(i < 3 ? 40 : 60, 5));
    // střed horní plochy desky 100 × 60 × 20 = [50; 30; 20] → přidaný vystředěný kvádr 10³ zvedne obálku na z = 25
    const base = plate(100, 60, 20);
    const hits: number[] = [];
    for (let k = 1; k <= 6; k++) {
      const res = await buildDoc({ ...emptyDoc("t"), features: [base, { ...feat(`kvádr 10 10 10 střed na střed plochy F${k}`), id: "b" }] });
      const [lo, hi] = res.metrics!.bbox;
      const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
      if (res.status.every((s) => s.ok) && near(hi[2], 25) && near(lo[0], 0) && near(hi[0], 100) && near(hi[1], 60)) hits.push(k);
    }
    expect(hits).toHaveLength(1);
    const pt: Feature = { id: "p1", name: "Bod 1", type: "datumPoint", ref: { kind: "xyz", p: [50, 30, 20] } };
    const g = feat('kvádr 10 10 10 střed na bod "Bod 1" odebrat');
    resolveDatumNames(g, [base, pt]);
    const res = await build(base, pt, g);
    expect(res.metrics!.volume).toBeCloseTo(100 * 60 * 20 - 10 * 10 * 5, 3);
  }, 120_000);

  it("pružina textem: objem drátu ≈ π(d/2)²·délka šroubovice, osa X", async () => {
    const res = await build(feat("pružina 20 stoupání 5 závity 4 drát 2 osa X"));
    const helix = 4 * Math.hypot(2 * Math.PI * 10, 5);
    expect(Math.abs(res.metrics!.volume - Math.PI * helix) / (Math.PI * helix)).toBeLessThan(0.01);
    const [lo, hi] = res.metrics!.bbox;
    expect(hi[0] - lo[0]).toBeGreaterThan(19);
    expect(hi[0] - lo[0]).toBeLessThan(23);
    expect(hi[2] - lo[2]).toBeCloseTo(22, 0);
  }, 60_000);
});
