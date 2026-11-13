import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc, sketchPathWire } from "./build";
import { parseAgentText, parseEntity } from "./agent";
import { applySplineTangents, patchSplineTangentKey, splitSplineTangents } from "./agent-surfaces";
import { applyTangentHandle, hermitePoints, setTangent, splineDerivatives, tangentHandles, type SplineEnt } from "./spline-tangent";
import { interpolateCurve, sketchSplineEdge } from "./spline-occ";
import { entityPath, splinePoints } from "./sketch";
import { transformEntity, xfMirror, xfRotate } from "./sketch-ops";
import { emptyDoc, type Feature, type SketchEntity, type Vec2, type Vec3 } from "./types";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

const sp = (points: Vec2[], tangents?: (number | null)[], closed = false, weights?: (number | null)[]): SplineEnt => ({ id: "s", type: "spline", points, closed, ...(tangents ? { tangents } : {}), ...(weights ? { weights } : {}) });
const angleOf = (v: { x: number; y: number }) => (Math.atan2(v.y, v.x) * 180) / Math.PI;
const XYp = () => r.makePlane("XY");

/** největší odchylka 2D křivky (JS) od křivky jádra (projekce bodů na hranu) */
function maxDev(e: SplineEnt): number {
  const edge = sketchSplineEdge(e, XYp());
  const pts = hermitePoints(e, 24);
  let md = 0;
  for (const p of pts) {
    const v = r.makeVertex([p[0], p[1], 0]);
    md = Math.max(md, r.measureDistanceBetween(edge, v));
  }
  return md;
}

describe("spline s tečnami – 2D výpočet = jádro (GeomAPI_Interpolate)", () => {
  it("obě koncové tečny, jedna, vnitřní, žádná – odchylka < 1e-4 mm", () => {
    const P: Vec2[] = [[0, 0], [30, 25], [60, 10], [100, 40], [130, 0]];
    expect(maxDev(sp([[0, 0], [50, 20], [100, 0]], [30, null, -30]))).toBeLessThan(1e-4);
    expect(maxDev(sp(P, [0, null, null, null, -90]))).toBeLessThan(1e-4);
    expect(maxDev(sp(P, [0, null, null, null, null]))).toBeLessThan(1e-4);
    expect(maxDev(sp(P, [null, null, 90, null, null]))).toBeLessThan(1e-4);
    expect(maxDev(sp(P, [10, null, 90, null, null], false, [2, null, 0.5, null, null]))).toBeLessThan(1e-4);
  });
  it("uzavřená (periodická) se zadanou tečnou", () => {
    const e = sp([[0, 0], [40, -10], [60, 30], [10, 40]], [null, 45, null, null], true);
    expect(maxDev(e)).toBeLessThan(1e-4);
    const edge = sketchSplineEdge(e, XYp());
    const [a, b] = [edge.startPoint, edge.endPoint];
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(1e-6);
    const [ta, tb] = [edge.tangentAt(0), edge.tangentAt(1)];
    expect(Math.abs(angleOf(ta) - angleOf(tb))).toBeLessThan(1e-6);
  });
  it("koncová tečna hrany = zadaný směr (do 0,01°)", () => {
    const e = sp([[0, 0], [50, 20], [100, 0]], [30, null, -30]);
    const edge = sketchSplineEdge(e, XYp());
    expect(Math.abs(angleOf(edge.tangentAt(0)) - 30)).toBeLessThan(0.01);
    expect(Math.abs(angleOf(edge.tangentAt(1)) + 30)).toBeLessThan(0.01);
    // vnitřní tečna: derivace v parametru bodu p1
    const e2 = sp([[0, 0], [50, 20], [100, 0], [150, 30]], [null, -45, null, null]);
    const { t } = splineDerivatives(e2);
    const { curve } = interpolateCurve(e2.points.map((p) => [p[0], p[1], 0] as Vec3), { tangents: [null, [Math.SQRT1_2, -Math.SQRT1_2, 0], null, null] });
    const c = curve as { D1(u: number, p: unknown, v: unknown): void };
    const oc = r.getOC() as unknown as { gp_Pnt: new () => unknown; gp_Vec: new () => { X(): number; Y(): number } };
    const pp = new oc.gp_Pnt();
    const vv = new oc.gp_Vec();
    c.D1(t[1], pp, vv);
    expect(Math.abs((Math.atan2(vv.Y(), vv.X()) * 180) / Math.PI + 45)).toBeLessThan(0.01);
  });
  it("dráha tažení ze skici: jedna B-spline hrana s tečnami", () => {
    const sk = { id: "k", name: "Dráha", type: "sketch", plane: { kind: "base", name: "XZ", offset: 0 }, entities: [sp([[0, 0], [50, 20], [100, 0]], [30, null, -30])] } as Extract<Feature, { type: "sketch" }>;
    const w = sketchPathWire(sk);
    expect(w.edges.length).toBe(1);
    // XZ: osa X skici = +X, osa Y skici = +Z → tečna na konci (cos −30°, 0, sin −30°)
    const t1 = w.tangentAt(1);
    expect(Math.abs((Math.atan2(t1.z, t1.x) * 180) / Math.PI + 30)).toBeLessThan(0.01);
    expect(Math.abs(t1.y)).toBeLessThan(1e-9);
  });
  it("bez tečen se nic nemění (Catmull-Rom jako dřív)", () => {
    const e = sp([[0, 0], [50, 20], [100, 0]]);
    expect(entityPath(e).pts).toEqual(splinePoints(e.points, false, 16));
  });
});

describe("spline s tečnami – stavba modelu", () => {
  it("tažení kruhu po spline s tečnami a vysunutí uzavřeného profilu", async () => {
    const path: Feature = { id: "p", name: "Dráha", type: "sketch", plane: { kind: "base", name: "XZ", offset: 0 }, entities: [sp([[0, 0], [50, 30], [100, 0]], [80, null, -80])] };
    const sweep: Feature = { id: "w", name: "Tažení", type: "sweep", profileId: "", pathId: "p", mode: "new", frenet: false, circleRadius: 3 };
    const prof: Feature = { id: "q", name: "Profil", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [sp([[200, 0], [240, -10], [260, 30], [210, 40]], [null, 45, null, null], true)] };
    const ex: Feature = { id: "x", name: "Vysunutí", type: "extrude", sketchId: "q", distance: 10, symmetric: false, reverse: false, mode: "add" };
    const res = await buildDoc({ ...emptyDoc("T"), features: [path, sweep, prof, ex] });
    expect(res.status.map((s) => s.error ?? "")).toEqual(["", "", "", ""]);
    expect(res.metrics!.volume).toBeGreaterThan(1000);
  }, 60_000);
});

describe("spline s tečnami – úchyty a úpravy", () => {
  it("úchyt tečny: směr = úhel, délka = váha", () => {
    const e = sp([[0, 0], [50, 20], [100, 0]]);
    const hs = tangentHandles(e, splinePoints);
    expect(hs.map((h) => h.key)).toEqual(["t0", "t2"]);
    const e2 = applyTangentHandle(e, "t2", [100 + 10, -10]);
    expect(e2.tangents?.[2]).toBeCloseTo(-45, 6);
    const set = setTangent(e2, 2, null);
    expect(set.tangents).toBeUndefined();
  });
  it("otočení a zrcadlení entity otočí i tečny", () => {
    const e = sp([[0, 0], [50, 20], [100, 0]], [30, null, -30]);
    const rot = transformEntity(e, xfRotate([0, 0], 90)) as SplineEnt;
    expect(rot.tangents).toEqual([120, null, 60]);
    const mir = transformEntity(e, xfMirror([0, 0], [1, 0])) as SplineEnt;
    expect(mir.tangents).toEqual([-30, null, 30]);
  });
});

describe("spline s tečnami – text pro agenty", () => {
  it("CS / EN / DE zápis tečen", () => {
    const cs = parseEntity("spline 0 0 50 20 100 0 tečna-začátek 30 tečna-konec -30".split(" ")) as SplineEnt;
    expect(cs.points).toEqual([[0, 0], [50, 20], [100, 0]]);
    expect(cs.tangents).toEqual([30, null, -30]);
    const en = parseEntity("spline 0 0 50 20 100 0 tangent-start 30 tangent-end -30 weight-end 1,5".split(" ")) as SplineEnt;
    expect(en.tangents).toEqual([30, null, -30]);
    expect(en.weights).toEqual([null, null, 1.5]);
    const de = parseEntity("spline 0 0 50 20 100 0 tangente-anfang 30 tangente-ende -30 tangente p1 0".split(" ")) as SplineEnt;
    expect(de.tangents).toEqual([30, 0, -30]);
    const pp = parseEntity("spline 0 0 50 20 100 0 140 30 tečna p2 -90 váha p2 2 uzavřít".split(" ")) as SplineEnt;
    expect(pp.closed).toBe(true);
    expect(pp.tangents).toEqual([null, null, -90, null]);
    expect(pp.weights).toEqual([null, null, 2, null]);
  });
  it("chyby zápisu", () => {
    expect(() => parseEntity("spline 0 0 50 20 tečna p5 10".split(" "))).toThrow(/p0–p1/);
    expect(() => splitSplineTangents(["tečna-začátek"])).toThrow(/tečna-začátek 30/);
    expect(() => applySplineTangents(sp([[0, 0], [1, 1]]), [{ at: 0, weight: 2 }])).toThrow(/nejdřív zadejte tečnu/);
  });
  it("blok skici textem a úprava entity", () => {
    const prog = parseAgentText("skica XY: spline 0 0 50 20 100 0 tečna-začátek 30 tečna-konec -30");
    expect(prog.errors).toEqual([]);
    const ents = prog.ops.find((o) => o.k === "entities") as { entities: SketchEntity[] } | undefined;
    expect((ents?.entities[0] as SplineEnt).tangents).toEqual([30, null, -30]);
    const e = sp([[0, 0], [50, 20], [100, 0]], [30, null, -30]);
    const p1 = patchSplineTangentKey(e, "tečna-p1", 90)!;
    expect(p1.e.tangents).toEqual([30, 90, -30]);
    const p2 = patchSplineTangentKey(p1.e, "tečna-začátek", "vyp")!;
    expect(p2.e.tangents).toEqual([null, 90, -30]);
    expect(patchSplineTangentKey(e, "cx", 1)).toBeNull();
  });
});
