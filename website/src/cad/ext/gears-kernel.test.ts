/**
 * Kola a ozubení – jádro (OCCT v Node): platná tělesa všech 14 druhů, objemy proti analytickým odhadům, průměry hlavy a paty
 * na tělese, odchylka evolventní hrany, šroubová plocha šikmého kola, výstupy (kolo / polotovar / zuby do tělesa), volby těla,
 * umístění a záběr soukolí ve 12 polohách jedné rozteče (žádný průnik, boční vůle podle zadání).
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildShape } from "../build";
import { checkShape, isValidShape } from "../check";
import { isInside } from "../direct";
import { GEAR_KINDS, KINDS, gearCompute, gearProfile, solvePair, type GearData, type PairKind, type Seg2, type Vec2 } from "../gears";
import { boreArea, readBody, revolveVolume } from "../gears/common";
import { cylGeom, cylProfile, flankAngle } from "../gears/involute";
import { RACKS } from "../gears/rack";
import { emptyDoc, type CadDoc, type Feature, type Vec3 } from "../types";
import { liftXY, prism, profileWire, revolveSection, sectorPattern, segEdge } from "./gears-kernel";
import "./index";
import "../feat/index";

type Shape = r.Shape3D;
type OC = any;

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"), print: () => undefined, printErr: () => undefined });
  r.setOC(oc as never);
}, 60_000);

let nid = 0;
const gear = (ext: string, data: GearData, name = "Kolo"): Feature => ({ id: `g${++nid}`, name, type: "ext", ext, data } as unknown as Feature);
const doc = (...features: Feature[]): CadDoc => ({ ...emptyDoc("Test"), features });
async function build(...features: Feature[]) {
  const res = await buildShape(doc(...features), Infinity, { noCache: true });
  const bad = res.status.find((s) => !s.ok);
  if (bad) throw new Error(`${bad.id}: ${bad.error}`);
  if (!res.body) throw new Error("bez tělesa");
  return { body: res.body as Shape, status: res.status };
}
const wheel = async (kind: string, data: GearData = {}) => (await build(gear(`gear.${kind}`, data))).body;
const vol = (s: Shape) => r.measureVolume(s);
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const at = (rad: number, ang: number, z: number): Vec3 => [rad * Math.cos(ang), rad * Math.sin(ang), z];
/** b z výchozích hodnot (druhy se šířkou kola v `body.b` nebo v `b`) */
const widthOf = (kind: string, data: GearData = {}) => {
  const def = KINDS[kind as keyof typeof KINDS];
  const i = def.read({ ...def.defaults(), ...data }) as { body?: { b: number }; b?: number };
  return i.body?.b ?? i.b ?? 0;
};

/** první SOLID tělesa (výsledek booleovské operace bývá složenina s jedním tělesem – sonda `isInside` potřebuje SOLID) */
function solidOf(s: Shape): Shape {
  const oc = r.getOC() as OC;
  const ex = new oc.TopExp_Explorer(s.wrapped, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try {
    return ex.More() ? (r.cast(ex.Current()) as Shape) : s;
  } finally {
    ex.delete();
  }
}
const inside = (s: Shape, p: Vec3) => isInside(solidOf(s), p);
/** nejmenší vzdálenost dvou těles (0 = dotyk nebo průnik) */
function distance(a: Shape, b: Shape): number {
  const oc = r.getOC() as OC;
  const q = new oc.BRepExtrema_DistShapeShape();
  try {
    q.LoadS1(a.wrapped);
    q.LoadS2(b.wrapped);
    q.Perform(new oc.Message_ProgressRange());
    return q.IsDone() ? Number(q.Value()) : NaN;
  } finally {
    q.delete();
  }
}
/** objem průniku dvou těles (0 = nepronikají) */
const overlap = (a: Shape, b: Shape) => {
  const s = a.intersect(b);
  try {
    return Math.abs(r.measureVolume(s));
  } catch {
    return 0;
  }
};
/** umístění komponenty jako sestava (R = Rx·Ry·Rz, °) */
const placed = (s: Shape, p: { at: Vec3; rot: Vec3 }) => {
  let o = s.clone() as Shape;
  if (p.rot[2]) o = o.rotate(p.rot[2], [0, 0, 0], [0, 0, 1]) as Shape;
  if (p.rot[1]) o = o.rotate(p.rot[1], [0, 0, 0], [0, 1, 0]) as Shape;
  if (p.rot[0]) o = o.rotate(p.rot[0], [0, 0, 0], [1, 0, 0]) as Shape;
  return o.translate(p.at) as Shape;
};

describe("každý druh s výchozími hodnotami", () => {
  it("jedno platné objemové těleso (BRepCheck i nad 400 ploch), kolo i polotovar", async () => {
    for (const k of GEAR_KINDS) {
      for (const out of ["wheel", "blank"]) {
        const s = await wheel(k, { out });
        const c = checkShape(s);
        expect(c.valid, `${k}/${out}`).toBe(true);
        expect(c.solids, `${k}/${out}`).toBe(1);
        expect(vol(s), `${k}/${out}`).toBeGreaterThan(0);
      }
    }
  }, 300_000);
  it("hranolová kola: objem = přesná plocha profilu × šířka (odchylka proložení evolventy pod 2·10⁻⁵)", async () => {
    for (const k of ["spur", "cycloid", "ratchet", "cyclodisc", "rack"]) {
      const s = await wheel(k);
      expect(rel(vol(s), gearProfile(`gear.${k}`, {}).area * widthOf(k)), k).toBeLessThan(2e-5);
    }
    // vnitřní ozubení: kruh věnce minus otvor s profilem zubů
    const c = gearCompute("gear.internal", {});
    const ring = Math.PI * (c.rimD / 2) ** 2 - gearProfile("gear.internal", {}).area;
    expect(rel(vol(await wheel("internal")), ring * widthOf("internal"))).toBeLessThan(2e-5);
  }, 120_000);
  it("polotovar = rotační objem polovičního řezu (bez děr)", async () => {
    for (const k of ["spur", "helical", "sprocket", "bevel", "worm", "wormwheel"]) {
      const def = KINDS[k as keyof typeof KINDS];
      const i = def.read(def.defaults());
      expect(rel(vol(await wheel(k, { out: "blank" })), revolveVolume(def.blank(i, def.compute(i)))), k).toBeLessThan(1e-3);
    }
  }, 120_000);
});

describe("čelní kolo m 2 z 24 b 20 – rozměry na tělese", () => {
  it("hlava Ø52 na ose zubu, pata Ø43 v ose mezery (sonda ±0,01 mm), obálka Ø52 × 20", async () => {
    const s = await wheel("spur");
    const half = Math.PI / 24;
    expect(inside(s, at(26 - 0.01, 0, 10))).toBe(true);
    expect(inside(s, at(26 + 0.01, 0, 10))).toBe(false);
    expect(inside(s, at(21.5 - 0.01, half, 10))).toBe(true);
    expect(inside(s, at(21.5 + 0.01, half, 10))).toBe(false);
    const [[x0, y0, z0], [x1, y1, z1]] = s.boundingBox.bounds;
    expect(x1 - x0).toBeCloseTo(52, 1);
    expect(y1 - y0).toBeGreaterThan(51.5);
    expect(z1 - z0).toBeCloseTo(20, 6);
  }, 60_000);
  it("evolventní hrana jádra se odchyluje od evolventy nejvýš 1·10⁻⁴ mm (200 bodů, m 10 z 12 a m 10 z 200)", () => {
    for (const z of [12, 200]) {
      const ci = { m: 10, z, alpha: 20, x: z < 17 ? 0.35 : 0, beta: 0, rack: RACKS.A, k: 0, jn: 0, internal: false };
      const g = cylGeom(ci);
      const flanks = cylProfile(ci, g).tooth.filter((s): s is Extract<Seg2, { t: "curve" }> => s.t === "curve" && s.kind === "involute");
      expect(flanks.length).toBe(2);
      let worst = 0;
      for (const f of flanks) {
        const e = segEdge(f, liftXY(0));
        for (let k = 0; k <= 200; k++) {
          const p = e.pointAt(k / 200);
          const ry = Math.hypot(p.x, p.y);
          const dAng = Math.abs(Math.abs(Math.atan2(p.y, p.x)) - flankAngle(g, ry));
          worst = Math.max(worst, ry * dAng * (g.rb / ry)); // obvodová odchylka × cos α_y = odchylka po normále
        }
      }
      expect(worst, `z ${z}`).toBeLessThan(1e-4);
    }
  });
});

describe("šikmé kolo – šroubová plocha", () => {
  it("objem = plocha × b, boky nejsou rovinné (rovinná jsou jen dvě čela), řez v b/2 = profil pootočený o τ·b/2, smysl", async () => {
    for (const hand of ["right", "left"] as const) {
      const s = await wheel("helical", { hand });
      const c = gearCompute("gear.helical", { hand });
      expect(rel(vol(s), gearProfile("gear.helical", {}).area * 20)).toBeLessThan(1e-4);
      expect(s.faces.filter((f) => f.geomType === "PLANE").length).toBe(2);
      const tw = ((hand === "left" ? -1 : 1) * Math.tan(c.be) * 10) / c.r; // pootočení v z = 10
      // hlava zubu a dno mezery v pootočené poloze (±0,001 mm), bok na roztečné kružnici (±0,002 mm po obvodu)
      expect(inside(s, at(c.ra - 0.001, tw, 10))).toBe(true);
      expect(inside(s, at(c.ra + 0.001, tw, 10))).toBe(false);
      expect(inside(s, at(c.rf + 0.001, tw + Math.PI / 24, 10))).toBe(false);
      expect(inside(s, at(c.rf - 0.001, tw + Math.PI / 24, 10))).toBe(true);
      const g = cylGeom({ m: 2, z: 24, alpha: 20, x: 0, beta: 15, rack: RACKS.A, k: 0, jn: 0, internal: false });
      const fa = flankAngle(g, g.r);
      expect(inside(s, at(g.r, tw + fa - 0.002 / g.r, 10))).toBe(true);
      expect(inside(s, at(g.r, tw + fa + 0.002 / g.r, 10))).toBe(false);
    }
  }, 120_000);
  it("šípové kolo: obě poloviny se sejdou ve střední rovině, objem = plocha × b", async () => {
    const s = await wheel("herringbone");
    expect(isValidShape(s)).toBe(true);
    expect(rel(vol(s), gearProfile("gear.herringbone", {}).area * 20)).toBeLessThan(1e-4);
  }, 60_000);
});

describe("jeden zub + kruhové pole (sectorPattern)", () => {
  it("rotační nástroj na zubech: výseč + pole + lepení dá totéž těleso jako odebrání z celého kola (čelní z 24, sražení hlav)", async () => {
    const p = gearProfile("gear.spur", {});
    const tool = revolveSection([[25, -0.5], [27, -0.5], [27, 1.5]]);
    const full = prism(profileWire(p), [], 20).cut(tool) as Shape;
    const pat = sectorPattern(p, 20, 18, [], (sec) => sec.cut(tool) as Shape);
    expect(pat).not.toBeNull();
    expect(isValidShape(pat!)).toBe(true);
    expect(checkShape(pat!)).toEqual(checkShape(full));
    expect(rel(vol(pat!), vol(full))).toBeLessThan(1e-9);
    // oblouk jádra nad patou by zasáhl do zubů → null (volající odebere nástroj z celého kola)
    expect(sectorPattern(p, 20, 22, [], (sec) => sec)).toBeNull();
    // řetězové kolo s bočním odlehčením zubů (staví se výsečí) je platné a má hlavu i patu podle ISO 606
    const sp = await wheel("sprocket", { z: 40 });
    expect(isValidShape(sp)).toBe(true);
    const c = gearCompute("gear.sprocket", { z: 40 });
    expect(inside(sp, at(c.da / 2 - 0.01, 0, c.bf1 / 2))).toBe(true);
    expect(inside(sp, at(c.da / 2 + 0.01, 0, c.bf1 / 2))).toBe(false);
    expect(inside(sp, at(c.df / 2 + 0.01, Math.PI / 40, c.bf1 / 2))).toBe(false);
    expect(inside(sp, at(c.df / 2 - 0.01, Math.PI / 40, c.bf1 / 2))).toBe(true);
    // triplex: tři řady lepené s rozpěrkami = jedno platné těleso šířky (n − 1)·p_t + b_f1
    const tri = await wheel("sprocket", { z: 19, rows: 3, bore: 20, keyway: true });
    expect(checkShape(tri)).toMatchObject({ valid: true, solids: 1 });
    const c3 = gearCompute("gear.sprocket", { z: 19, rows: 3 });
    const [[, , zz0], [, , zz1]] = tri.boundingBox.bounds;
    expect(zz1 - zz0).toBeCloseTo(c3.b, 6);
  }, 120_000);
});

describe("pořadí ploch a čepy šneku", () => {
  it("kola výchozího soukolí z 20/60 mají pod 400 ploch (pata zubu = jeden oblouk na zub) – sestava načte celé kolo bez ⚠ asm.faces-truncated", async () => {
    // nález revize: kolo z 60 mělo 424 ploch (pata rozdělená na rozhraní roztečí) → ⚠ v každém skriptu soukolí a STOP v přísném režimu
    for (const k of ["spur", "helical"] as const) {
      const s = await wheel(k, { z: 60, bore: 15 });
      expect(s.faces.length, k).toBeLessThanOrEqual(400);
      expect(isValidShape(s)).toBe(true);
      // obrys beze změny: objem = plocha profilu × b (bez díry)
      const A = gearProfile(`gear.${k}`, { z: 60 }).area;
      expect(rel(vol(s), (A - Math.PI * 7.5 ** 2) * 20)).toBeLessThan(2e-5);
    }
  }, 120_000);
  it("díra je první plochou kola (sestava čte pro vazby jen prvních 400 ploch) – čelní z 80, šikmé z 80 s nábojem", async () => {
    for (const [k, d] of [["spur", { z: 80, bore: 30 }], ["helical", { z: 80, bore: 30, hubD: 60, hubL: 10 }]] as const) {
      const s = await wheel(k, d);
      expect(s.faces.length).toBeGreaterThan(400);
      const f0 = s.faces[0];
      expect(f0.geomType).toBe("CYLINDRE");
      const [[x0], [x1]] = f0.boundingBox.bounds;
      expect(x1 - x0).toBeCloseTo(30, 3);
      expect(isValidShape(s)).toBe(true);
    }
  }, 120_000);
  it("věnec s vnitřním ozubením z 140: vnější plášť (plocha vazby soukolí) je první plochou, ne za 400. plochou", async () => {
    // nález revize: hlavy a paty zubů věnce jsou souosé válce menší než plášť – řazení jen podle poloměru dalo plášť na F421
    const data = { z: 140, m: 1 };
    const s = await wheel("internal", data);
    expect(s.faces.length).toBeGreaterThan(400);
    const rimD = gearCompute("gear.internal", data).rimD;
    const f0 = s.faces[0];
    expect(f0.geomType).toBe("CYLINDRE");
    const [[x0], [x1]] = f0.boundingBox.bounds;
    expect(x1 - x0).toBeCloseTo(rimD, 3);
    expect(isValidShape(s)).toBe(true);
    // vazba soukolí míří právě na tento průměr
    const pair = solvePair({ kind: "internal", values: { z1: 30, z2: 140, m: 1 } });
    expect(pair.mate.faceB).toBe(`Ø${String(Math.round(rimD * 1000) / 1000).replace(".", ",")}`);
  }, 120_000);
  it("čepy hřídele šneku přišité do pláště: objem = závit + 2·π·r²·l, platné, i s dírou a perem", async () => {
    const plain = vol(await wheel("worm"));
    const j = await wheel("worm", { shaftD: 15, shaftL: 10 });
    expect(isValidShape(j)).toBe(true);
    expect(rel(vol(j) - plain, 2 * Math.PI * 7.5 ** 2 * 10)).toBeLessThan(1e-6);
    const jb = await wheel("worm", { shaftD: 15, shaftL: 10, bore: 6, keyway: true });
    expect(checkShape(jb)).toMatchObject({ valid: true, solids: 1 });
    const [[, , z0], [, , z1]] = jb.boundingBox.bounds;
    expect(z1 - z0).toBeCloseTo(28 + 20, 6);
  }, 120_000);
});

describe("výstupy a volby těla", () => {
  it("zuby vyříznuté do válce Ø dₐ × b dají stejný objem jako hotové kolo", async () => {
    const cyl: Feature = { id: "c", name: "Válec", type: "cylinder", radius: 26, height: 20, position: [0, 0, 0], axis: "Z", mode: "new" } as unknown as Feature;
    const cut = await build(cyl, gear("gear.spur", { out: "teeth" }));
    expect(rel(vol(cut.body), vol(await wheel("spur")))).toBeLessThan(1e-4);
    // bez tělesa srozumitelná chyba
    const res = await buildShape(doc(gear("gear.spur", { out: "teeth" })), Infinity, { noCache: true });
    expect(res.status[0].ok).toBe(false);
    expect(res.status[0].error).toMatch(/polotovar/);
  }, 60_000);
  it("díra s drážkou, náboj, odlehčovací díry, stojina, sražení a stavěcí šroub – objemy podle vzorců", async () => {
    const A = gearProfile("gear.spur", {}).area;
    const o = readBody({ bore: 20, keyway: true }, 20);
    const bored = await wheel("spur", { bore: 20, keyway: true });
    expect(rel(vol(bored), (A - boreArea(o)) * 20)).toBeLessThan(2e-5);
    const hub = await wheel("spur", { bore: 20, keyway: true, hubD: 32, hubL: 10 });
    expect(rel(vol(hub), (A - boreArea(o)) * 20 + (Math.PI * 16 ** 2 - boreArea(o)) * 10)).toBeLessThan(2e-5);
    const both = await wheel("spur", { bore: 20, hubD: 32, hubL: 10, hubSide: "both" });
    expect(both.boundingBox.bounds[0][2]).toBeCloseTo(-10, 6);
    expect(both.boundingBox.bounds[1][2]).toBeCloseTo(30, 6);
    const A40 = gearProfile("gear.spur", { z: 40 }).area;
    const holes = await wheel("spur", { z: 40, holesN: 6, holesD: 8 });
    expect(rel(vol(holes), (A40 - 6 * Math.PI * 16) * 20)).toBeLessThan(2e-5);
    const web = await wheel("spur", { z: 40, webT: 8 });
    const wo = 37.5 - 6; // věnec 3·m pod patou
    expect(rel(vol(web), A40 * 20 - 2 * Math.PI * wo * wo * 6)).toBeLessThan(2e-5);
    const plain = vol(await wheel("spur"));
    const ch = await wheel("spur", { chamfer: 0.5 });
    expect(isValidShape(ch)).toBe(true);
    expect(vol(ch)).toBeLessThan(plain);
    expect(vol(ch)).toBeGreaterThan(plain * 0.98);
    const screw = await wheel("spur", { bore: 20, keyway: true, hubD: 32, hubL: 10, setScrew: "M5" });
    expect(isValidShape(screw)).toBe(true);
    expect(vol(screw)).toBeLessThan(vol(hub));
  }, 180_000);
  it("operace Přidat na hřídel Ø20 a umístění bodem + osou X", async () => {
    const shaft: Feature = { id: "s", name: "Hřídel", type: "cylinder", radius: 10, height: 60, position: [0, 0, -20], axis: "Z", mode: "new" } as unknown as Feature;
    const both = await build(shaft, gear("gear.spur", { bore: 20, mode: "add" }));
    expect(checkShape(both.body).solids).toBe(1);
    const w = vol(await wheel("spur", { bore: 20 }));
    expect(rel(vol(both.body), w + Math.PI * 100 * 60)).toBeLessThan(1e-4);
    const moved = await wheel("spur", { position: [100, 0, 0], axis: "X" });
    const [[x0, y0], [x1, y1]] = moved.boundingBox.bounds;
    expect(x0).toBeCloseTo(100, 4);
    expect(x1).toBeCloseTo(120, 4);
    expect(y1 - y0).toBeGreaterThan(51.5);
  }, 60_000);
  it("mezipaměť těles vydává nezávislé kopie: kolo přidané na hřídel a pak stejné kolo odebrané z jiného tělesa je platné", async () => {
    // nález revize: clone() sdílel topologii s mezipamětí, sjednocení s hřídelí ji porušilo a další díl se stejným kolem
    // (tentýž klíč mezipaměti) dostal neplatné těleso
    const shaft: Feature = { id: "s2", name: "Hřídel", type: "cylinder", radius: 10, height: 60, position: [0, 0, -20], axis: "Z", mode: "new" } as unknown as Feature;
    const plate: Feature = { id: "p2", name: "Deska", type: "cylinder", radius: 40, height: 10, position: [0, 0, 0], axis: "Z", mode: "new" } as unknown as Feature;
    const data = { m: 2, z: 23, b: 10 };
    const added = await build(shaft, gear("gear.spur", { ...data, mode: "add" }));
    expect(isValidShape(added.body)).toBe(true);
    const cut = await build(plate, gear("gear.spur", { ...data, mode: "cut" }));
    expect(isValidShape(cut.body)).toBe(true);
    const fresh = await build(gear("gear.spur", { ...data, b: 10.0001 }));
    expect(rel(vol(cut.body), Math.PI * 40 * 40 * 10 - vol(fresh.body) / 1.00001)).toBeLessThan(1e-4);
    // tentýž dokument: kolo na hřídeli, pak stejné kolo odebrané z druhého tělesa
    const same = await build(shaft, gear("gear.spur", { ...data, z: 27, mode: "add" }), { ...plate, id: "p3", position: [0, 0, 40] } as unknown as Feature, gear("gear.spur", { ...data, z: 27, position: [0, 0, 40], mode: "cut" }));
    expect(isValidShape(same.body)).toBe(true);
  }, 120_000);
});

describe("záběr soukolí – vazba ve 12 polohách jedné rozteče", () => {
  /** obě kola z výsledku soukolí, v místní soustavě a s polohou sestavy */
  async function pairShapes(kind: PairKind, values: GearData) {
    const res = solvePair({ kind, values });
    expect(res.ok, JSON.stringify(res.issues)).toBe(true);
    const shapes = await Promise.all(res.wheels.map((w) => build(gear(w.ext, w.data)).then((x) => x.body)));
    return { res, shapes };
  }
  it("čelní m 2, z 17/25, b 2, jₙ 0,08: žádný průnik, vůle na boku 0,04 (± 10 %)", async () => {
    const { res, shapes } = await pairShapes("spur", { z1: 17, z2: 25, m: 2, b: 2, jn: 0.08, bore1: 6, bore2: 8 });
    const z1 = 17;
    const z2 = 25;
    for (let k = 0; k < 12; k++) {
      const ph = (360 / z1) * (k / 12);
      const a = placed(shapes[0], { at: res.placement[0].at, rot: [0, 0, res.placement[0].rot[2] + ph] });
      const b = placed(shapes[1], { at: res.placement[1].at, rot: [0, 0, res.placement[1].rot[2] - (ph * z1) / z2] });
      expect(overlap(a, b), `poloha ${k}`).toBeLessThan(1e-6);
      const d = distance(a, b);
      expect(d, `poloha ${k}`).toBeGreaterThan(0.45 * 0.08);
      expect(d, `poloha ${k}`).toBeLessThan(0.55 * 0.08);
    }
  }, 300_000);
  it("soukolí s posunutím profilu (a_w 81), vnitřní soukolí a pastorek s hřebenem: bez průniku ve 4 polohách", async () => {
    const cases: { kind: PairKind; v: GearData; turn: (ph: number, z1: number, z2: number) => [number, number, Vec3] }[] = [
      { kind: "spur", v: { z1: 20, z2: 60, m: 2, a: 81, b: 4 }, turn: (ph, z1, z2) => [ph, (-ph * z1) / z2, [0, 0, 0]] },
      { kind: "internal", v: { z1: 20, z2: 60, m: 2, b: 4 }, turn: (ph, z1, z2) => [ph, (ph * z1) / z2, [0, 0, 0]] },
      { kind: "rack", v: { z1: 20, z2: 12, m: 2, b: 4, h: 12 }, turn: (ph) => [ph, 0, [(-ph * Math.PI * 40) / 360, 0, 0]] },
    ];
    for (const c of cases) {
      const { res, shapes } = await pairShapes(c.kind, c.v);
      const [z1, z2] = res.mate.teeth ?? [20, 60];
      for (let k = 0; k < 4; k++) {
        const ph = (360 / z1) * (k / 4);
        const [t1, t2, shift] = c.turn(ph, z1, z2);
        const p0 = res.placement[0];
        // pastorek se točí kolem své osy: u hřebene je osa pastorku ∥ Y (natočení kolem místní Z před umístěním)
        const a = placed(shapes[0].clone().rotate(t1, [0, 0, 0], [0, 0, 1]) as Shape, p0);
        const b = placed(shapes[1].clone().rotate(t2, [0, 0, 0], [0, 0, 1]) as Shape, { at: [res.placement[1].at[0] + shift[0], res.placement[1].at[1], res.placement[1].at[2]], rot: res.placement[1].rot });
        expect(overlap(a, b), `${c.kind} poloha ${k}`).toBeLessThan(1e-4);
      }
    }
  }, 300_000);
  it("šípové soukolí b 8: pastorek i kolo stejně široké, žádný průnik ve 3 polohách, vůle na boku jₙ/2 (dřív 2–3 mm³ přesahu)", async () => {
    const { res, shapes } = await pairShapes("herringbone", { b: 8 });
    const [z1, z2] = res.mate.teeth!;
    for (let k = 0; k < 3; k++) {
      const ph = (360 / z1) * (k / 3);
      const a = placed(shapes[0].clone().rotate(ph, [0, 0, 0], [0, 0, 1]) as Shape, res.placement[0]);
      const b = placed(shapes[1].clone().rotate((-ph * z1) / z2, [0, 0, 0], [0, 0, 1]) as Shape, res.placement[1]);
      expect(overlap(a, b), `poloha ${k}`).toBeLessThan(1e-6);
      const d = distance(a, b);
      expect(d, `poloha ${k}`).toBeGreaterThan(0.9 * 0.04);
      expect(d, `poloha ${k}`).toBeLessThan(1.1 * 0.04);
    }
  }, 600_000);
  it("vnitřní soukolí z 25/40 (rozdíl 15 zubů): automaticky zkrácená hlava věnce – žádný průnik v 6 polohách (dřív přesah ve 11 z 12)", async () => {
    const { res, shapes } = await pairShapes("internal", { z1: 25, z2: 40, b: 4 });
    for (let k = 0; k < 6; k++) {
      const ph = (360 / 25) * (k / 6);
      const a = placed(shapes[0].clone().rotate(ph, [0, 0, 0], [0, 0, 1]) as Shape, res.placement[0]);
      const b = placed(shapes[1].clone().rotate((ph * 25) / 40, [0, 0, 0], [0, 0, 1]) as Shape, res.placement[1]);
      expect(overlap(a, b), `poloha ${k}`).toBeLessThan(1e-7);
      expect(distance(a, b), `poloha ${k}`).toBeGreaterThan(0.85 * 0.04);
    }
  }, 300_000);
  it("kuželové soukolí 1 : 1 (z 20/20) bez průniku; hypoidní pár – jen zpráva o mezeře / přesahu (boky nejsou sdružené)", async () => {
    const { res, shapes } = await pairShapes("bevel", { z1: 20, z2: 20, m: 2 });
    for (let k = 0; k < 2; k++) {
      const ph = (360 / 20) * (k / 2);
      const a = placed(shapes[0].clone().rotate(ph, [0, 0, 0], [0, 0, 1]) as Shape, res.placement[0]);
      const b = placed(shapes[1].clone().rotate(-ph, [0, 0, 0], [0, 0, 1]) as Shape, res.placement[1]);
      expect(overlap(a, b), `poloha ${k}`).toBeLessThan(1e-3);
    }
    // spirální kuželové soukolí (β_m 35°, pastorek pravý, kolo levý): jmenovité boky, průnik jen v setinách mm³
    const sp = await pairShapes("bevel", { z1: 16, z2: 32, m: 2, betaM: 35 });
    const spOv = overlap(placed(sp.shapes[0], sp.res.placement[0]), placed(sp.shapes[1], sp.res.placement[1]));
    console.info(`spirální kuželové z16/32 β35: přesah ${spOv.toFixed(4)} mm³`);
    expect(spOv).toBeLessThan(0.5);
    const hy = await pairShapes("hypoid", {});
    const a = placed(hy.shapes[0], hy.res.placement[0]);
    const b = placed(hy.shapes[1], hy.res.placement[1]);
    const ov = overlap(a, b);
    const gap = ov > 1e-6 ? 0 : distance(a, b);
    console.info(`hypoid z11/41 E25: přesah ${ov.toFixed(4)} mm³, nejmenší mezera ${gap.toFixed(4)} mm (m_mn ${hy.res.rows.find((x) => x.key === "mmn")?.value})`);
    expect(Number.isFinite(ov) && Number.isFinite(gap)).toBe(true);
  }, 300_000);
});
