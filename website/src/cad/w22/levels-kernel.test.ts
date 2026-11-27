/**
 * Úrovně stavu prvku se skutečným jádrem (vlna 22, body 22b a 22a–c zprávy majitele): účinek booleovské operace proti
 * nástroji (žádný / částečný / celý nástroj), kontrola účinku i nad 400 ploch, očekávaný typ výsledku u každého prvku
 * objemového typu a „nezkontrolováno“ místo ✓, když se platnost tělesa nekontrolovala (nad 400 / 2000 ploch).
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { docStatusText } from "../agent";
import { buildDoc, buildShape, clearBuildCache, noSolidError } from "../build";
import { statusKv } from "../engine/kv";
import { registerExt } from "../ext/registry";
import { featureState, levelsText } from "../feature-levels";
import { emptyDoc, type CadDoc, type Feature } from "../types";
import "../ext/index";
import "../feat/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"), print: () => undefined, printErr: () => undefined });
  r.setOC(oc as never);
  // zkušební prvky rozšíření: mřížka kvádrů (velké těleso bez dlouhého výpočtu) a prvek objemového typu, který vrátí jen plášť
  registerExt({ ext: "w22test.grid", label: "Mřížka", tab: "create", group: "Test", make: () => ({ n: 80, mode: "new" }), build: (d) => r.makeCompound(Array.from({ length: Number(d.n) }, (_, i) => r.makeBaseBox(4, 4, 4).translate([(i % 20) * 6, Math.floor(i / 20) * 6, 0]))) as never });
  registerExt({ ext: "w22test.shell", label: "Plášť", tab: "surface", group: "Test", make: () => ({ mode: "add" }), build: () => r.makeCompound(r.makeBaseBox(10, 10, 10).faces) as never });
  // prvek mimo kartu Plochy BEZ pole `mode` (jako plech / svařence): i od něj se čeká těleso; `leak` = těleso + volná plocha navíc
  registerExt({ ext: "w22test.sheet", label: "Plech", tab: "sheet", group: "Test", make: () => ({}), build: (d, ctx) => (d.leak ? r.makeCompound([ctx.body!.clone(), r.makeBaseBox(3, 3, 3).translate([40, 0, 0]).faces[0]]) : r.makeCompound(r.makeBaseBox(10, 10, 1).faces)) as never });
}, 60_000);

let n = 0;
const id = () => `g${++n}`;
const doc = (...features: Feature[]): CadDoc => ({ ...emptyDoc("Deska A"), features });
const box = (size: [number, number, number], position: [number, number, number] = [0, 0, 0], mode: "new" | "add" | "cut" = "new"): Feature => ({ id: id(), name: `Kvádr ${n}`, type: "box", size, position, centered: false, mode }) as Feature;
const hole = (x: number, y: number): Feature => ({ id: id(), name: `Díra ${n}`, type: "hole", diameter: 8, depth: 0, through: true, position: [x, y, 10], axis: "Z" }) as unknown as Feature;
const ext = (e: string, data: Record<string, unknown>): Feature => ({ id: id(), name: `Prvek ${n}`, type: "ext", ext: e, data }) as Feature;
const of = (res: { status: { id: string }[] }, f: Feature) => res.status.find((s) => s.id === f.id)! as Awaited<ReturnType<typeof buildDoc>>["status"][number];

describe("účinek booleovské operace (22b)", () => {
  it("první těleso, díra (část nástroje), kapsa (celý nástroj) – čísla z jádra a platné těleso", { timeout: 60_000 }, async () => {
    const b = box([100, 50, 10]);
    const h = hole(20, 25);
    const pocket = box([20, 20, 5], [60, 15, 5], "cut");
    const res = await buildDoc(doc(b, h, pocket));
    expect(of(res, b)).toMatchObject({ ok: true, effect: { op: "new", level: "changed" }, body: { solids: 1, free: 0, valid: true } });
    expect(of(res, b).effect!.dV).toBeCloseTo(50_000, 3);
    const eh = of(res, h).effect!;
    expect(eh).toMatchObject({ op: "cut", level: "partial" });
    expect(eh.dV).toBeCloseTo(-Math.PI * 16 * 10, 2); // Ø8 skrz 10 mm
    expect(eh.tool!).toBeGreaterThan(-eh.dV); // nástroj je delší než deska
    expect(of(res, pocket).effect).toMatchObject({ op: "cut", level: "full" });
    expect(of(res, pocket).effect!.dV).toBeCloseTo(-2000, 3);
    expect(levelsText(of(res, pocket))).toBe("úběr 2000 mm³ (celý nástroj) · těleso platné");
    expect(res.status.every((s) => featureState(s) === "ok")).toBe(true);
  });
  it("nástroj ležící plochou na tělese: účinek žádný → ⚠, ne ✓", { timeout: 60_000 }, async () => {
    const b = box([100, 50, 10]);
    const tool = box([20, 20, 5], [40, 15, 10], "cut");
    const res = await buildDoc(doc(b, tool));
    expect(of(res, tool).warning).toMatch(/těleso nezměnil/);
    expect(of(res, tool).effect).toMatchObject({ op: "cut", level: "none" });
    expect(featureState(of(res, tool))).toBe("warn");
  });
  it("těleso nad 400 ploch: účinek se posoudí i tam – žádný = ⚠, podezřele malý se ověří přesným průnikem", { timeout: 120_000 }, async () => {
    const grid = ext("w22test.grid", { n: 80, mode: "new" }); // 480 ploch
    const idle = box([1.5, 2, 8], [2.25, -1, -2], "cut"); // v mezeře mezi kvádry (x 2…4): bez společného objemu
    const r1 = await buildDoc(doc(grid, idle));
    expect(of(r1, grid).body).toMatchObject({ solids: 80, free: 0 });
    expect(of(r1, idle).warning).toMatch(/nezměnil/);
    expect(featureState(of(r1, idle))).toBe("warn");
    // obří nástroj, který z rohu jednoho kvádru ubere 0,04 mm³ (pod tisícinu svého objemu): dřív nad 400 ploch bez kontroly
    const sliver = box([1000, 1000, 1000], [-1000, -1000, -1000 + 0.01], "cut");
    clearBuildCache();
    const r2 = await buildDoc(doc(grid, sliver));
    const e = of(r2, sliver).effect!;
    expect(e.dV).toBeCloseTo(-0.04, 4);
    expect(e.expected).toBeDefined(); // ověřeno přesným průnikem tělesa s nástrojem
    expect(e.expected!).toBeCloseTo(e.dV, 4);
    expect(e.level).toBe("partial"); // skutečný, i když proti nástroji nepatrný úběr – ne „žádný“
    expect(levelsText(of(r2, sliver))).toMatch(/^úběr 0,04 mm³ \(<1 % nástroje\)/);
    expect(of(r2, sliver).warning).toBeUndefined();
  });
});

describe("odebrání celého tělesa (22b, kolo 6)", () => {
  it("kvádr 10 10 10 a pak kvádr 10 10 10 odebrat: ✗ „nástroj ubral celé těleso“, ne věta o dráze a profilu tažení", { timeout: 60_000 }, async () => {
    const b = box([10, 10, 10]);
    const all = box([10, 10, 10], [0, 0, 0], "cut");
    clearBuildCache();
    const res = await buildDoc(doc(b, all));
    expect(of(res, all).ok).toBe(false);
    expect(of(res, all).error).toMatch(/^Nástroj ubral celé těleso – po odebrání nezůstal žádný materiál/);
    expect(of(res, all).error).not.toMatch(/dráha|profil|jádro selhalo/);
    expect(res.metrics?.solids).toBe(1); // těleso před prvkem zůstane
  });
  it("věta o dráze a profilu jen u tažení; průnik bez překryvu = prázdný průnik; jiný prvek = obecná věta", () => {
    const empty = { solids: 0, shells: 0, faces: 0, valid: false } as never;
    const shellOnly = { solids: 0, shells: 1, faces: 3, valid: false } as never;
    expect(noSolidError(ext("surf.sweep", { mode: "cut" }), shellOnly)).toMatch(/dráha se nesmí protínat/);
    expect(noSolidError({ ...box([1, 1, 1]), mode: "intersect" } as Feature, empty, "disjoint")).toMatch(/^Průnik s nástrojem je prázdný/);
    expect(noSolidError(hole(0, 0), empty, "covered")).toMatch(/^Nástroj ubral celé těleso/);
    // oponentura kola 6: prázdný výsledek bez ověřené příčiny (jádro mohlo vrátit prázdný tvar i při selhání) = obecná věta
    // „jádro selhalo“, ne jistá rada „Nástroj ubral celé těleso“ / „průnik je prázdný“
    expect(noSolidError(hole(0, 0), empty)).toMatch(/^Operace nevrátila objemové těleso \(.*\) – jádro selhalo; změňte parametry prvku/);
    expect(noSolidError({ ...box([1, 1, 1]), mode: "intersect" } as Feature, empty)).toMatch(/jádro selhalo/);
    const other = noSolidError(box([1, 1, 1], [0, 0, 0], "add"), shellOnly);
    expect(other).toMatch(/^Operace nevrátila objemové těleso \(žádné objemové těleso – jen 1 plášť \(3 ploch\)\)/);
    expect(other).not.toMatch(/dráha|profil/);
  });
});

describe("příčina prázdného výsledku je ověřená proti tělesu před operací (22b, kolo 6 – oponentura)", () => {
  it("emptyResultCause: nástroj pokrývá těleso = covered; menší nástroj / dutý nástroj kolem tělesa = null; jiný výsledek = null", { timeout: 60_000 }, async () => {
    // dřív: „Nástroj ubral celé těleso“ stálo jen na prázdném výsledku a režimu odebrání – bez ověření, že nástroj těleso pokrývá
    const { beginFeatureOps, emptyResultCause } = await import("../shape-health");
    const { cutAll } = await import("../fastbool");
    const body = r.makeBaseBox(10, 10, 10) as never as r.Shape3D;
    beginFeatureOps();
    const gone = cutAll(body, [r.makeBaseBox(10, 10, 10) as never]);
    expect(emptyResultCause(gone)).toBe("covered");
    beginFeatureOps();
    const bigger = cutAll(body, [r.makeBaseBox(30, 30, 30).translate([-10, -10, -10]) as never]);
    expect(emptyResultCause(bigger)).toBe("covered");
    beginFeatureOps();
    const part = cutAll(body, [r.makeBaseBox(4, 4, 20).translate([0, 0, -5]) as never]);
    expect(emptyResultCause(part)).toBeNull(); // obálka nástroje těleso nepokrývá
    // dutý nástroj (trubka kolem tělesa): obálka tělesa je uvnitř obálky nástroje, vrcholy tělesa ale v nástroji neleží
    const tube = r.makeCylinder(30, 30, [5, 5, -10]).cut(r.makeCylinder(20, 30, [5, 5, -10]) as never) as never as r.Shape3D;
    beginFeatureOps();
    const around = cutAll(body, [tube]);
    expect(emptyResultCause(around)).toBeNull();
    expect(emptyResultCause(r.makeBaseBox(1, 1, 1) as never)).toBeNull(); // výsledek, který není z deníku operací
  });
  it("kolo 7: „covered“ jen s přesným průnikem celého objemu – dva nástroje, mezi nimiž zůstane pás tělesa (vrcholy v nástrojích, obálka nástrojů těleso pokrývá), NENÍ covered", { timeout: 60_000 }, async () => {
    // dřív stačila obálka + vrcholy: obě podmínky platí, a přesto nástroje těleso nepokrývají (pás Z 4…6 zůstane)
    const { beginFeatureOps, emptyResultCause } = await import("../shape-health");
    const { cutAll } = await import("../fastbool");
    const body = r.makeBaseBox(10, 10, 10) as never as r.Shape3D;
    // těleso = makeBaseBox(10, 10, 10) = [-5…5] × [-5…5] × [0…10]; nástroj = kvádr [-20…20]² × [-10…20] s dutinou [-2…2]² × [3…7]
    const hollow = r.makeBox([-20, -20, -10], [20, 20, 20]).cut(r.makeBox([-2, -2, 3], [2, 2, 7]) as never) as never as r.Shape3D;
    beginFeatureOps();
    const slab = cutAll(body, [r.makeBox([-20, -20, -10], [20, 20, 4]) as never, r.makeBox([-20, -20, 6], [20, 20, 20]) as never]);
    expect(emptyResultCause(slab)).toBeNull();
    // nástroj s vnitřní dutinou uvnitř tělesa: také ne covered
    beginFeatureOps();
    expect(emptyResultCause(cutAll(body, [hollow]))).toBeNull();
    // kontrola: plný nástroj stejné obálky je dál covered (důkaz objemem projde)
    beginFeatureOps();
    expect(emptyResultCause(cutAll(body, [r.makeBox([-20, -20, -10], [20, 20, 20]) as never]))).toBe("covered");
  });
  it("kolo 7: průnik – obálky se překrývají, tělesa ne (koule u rohu kvádru): „disjoint“ z nejkratší vzdálenosti; dotyk / překryv = null", { timeout: 60_000 }, async () => {
    const { beginFeatureOps, emptyResultCause } = await import("../shape-health");
    const body = r.makeBaseBox(10, 10, 10) as never as r.Shape3D;
    beginFeatureOps();
    // kvádr [-5…5]² × [0…10]; koule se středem [8; 8; 13] a poloměrem 4: obálka [4…12]² × [9…17] zasahuje do obálky kvádru,
    // nejkratší vzdálenost od rohu [5; 5; 10] je √27 − 4 = 1,196 mm
    const apart = body.intersect(r.makeSphere(4).translate([8, 8, 13]) as never) as never as r.Shape3D;
    expect(emptyResultCause(apart)).toBe("disjoint");
    beginFeatureOps();
    const overlap = body.intersect(r.makeSphere(4).translate([6, 6, 11]) as never) as never as r.Shape3D; // roh kvádru v kouli
    expect(emptyResultCause(overlap)).toBeNull();
  });
});

describe("konečné těleso – nezkontrolováno není ✓", () => {
  it("nad 400 ploch se platnost po prvku nekontroluje (ℹ), závěrečná kontrola stavby ji doplní (✓)", { timeout: 120_000 }, async () => {
    const grid = ext("w22test.grid", { n: 80, mode: "new" });
    const cut = box([2, 2, 2], [1, 1, 1], "cut");
    clearBuildCache();
    const mid = await buildShape(doc(grid, cut)); // stavba bez závěrečné kontroly (přísný režim po operaci)
    const s = mid.status.find((x) => x.id === cut.id)!;
    expect(s.body).toMatchObject({ valid: null, why: "feature-faces" });
    expect(featureState(s)).toBe("unchecked");
    expect(levelsText(s)).toMatch(/těles, platnost nezkontrolována \(\d+ ploch > 400 – platnost se ověří na konci stavby\)/);
    const res = await buildDoc(doc(grid, cut));
    expect(res.metrics).toMatchObject({ valid: true, solids: 80 });
    expect(of(res, cut).body).toMatchObject({ valid: true, solids: 80 });
    expect(featureState(of(res, cut))).toBe("ok");
  });
  it("velké těleso (nad 1000 ploch) se nekontroluje ani na konci: stav prvku, řádek Geometrie i valid= říkají „nezkontrolováno“", { timeout: 120_000 }, async () => {
    const grid = ext("w22test.grid", { n: 170, mode: "new" }); // 1020 ploch
    const d = doc(grid);
    clearBuildCache();
    const res = await buildDoc(d);
    expect(res.metrics?.valid).toBeUndefined();
    expect(res.metrics?.solids).toBe(170);
    expect(of(res, grid).body).toMatchObject({ valid: null, why: "approx", faces: 1020 });
    expect(featureState(of(res, grid))).toBe("unchecked");
    const text = docStatusText(d, res);
    expect(text).toMatch(/Geometrie: nezkontrolováno \(velké těleso, 1020 ploch – měřeno ze sítě, platnost se nekontroluje\) · 170 těles/);
    expect(text).not.toMatch(/Geometrie: platná/);
    expect(text).toMatch(/prvků 1 \(0 ✓, 1 ℹ nezkontrolováno, 0 ✗\)/);
    expect(text).toMatch(/ℹ přidáno .* · 170 těles, platnost nezkontrolována \(velké těleso, 1020 ploch/);
    expect(statusKv(d, res)).toMatch(/feat=0\/0\/0 .* solids=170 valid=unchecked unchecked=1$/); // prvek bez kontroly není mezi ✓
  });
});

describe("očekávaný typ výsledku u každého prvku objemového typu (ne jen u závitu)", () => {
  it("prvek s operací, který vrátí jen plášť, je ✗ u toho prvku – i jako první prvek dílu", { timeout: 60_000 }, async () => {
    const bad = ext("w22test.shell", { mode: "add" });
    clearBuildCache();
    const res = await buildDoc(doc(bad));
    expect(of(res, bad).ok).toBe(false);
    expect(of(res, bad).error).toMatch(/má dát objemové těleso, ale výsledek je jen plocha \/ plášť \(6 volných ploch, žádné těleso\)/);
    // na existujícím tělese: těleso zůstane, prvek je ✗
    const b = box([20, 20, 10]);
    const res2 = await buildDoc(doc(b, bad));
    expect(of(res2, b).ok).toBe(true);
    expect(of(res2, bad).ok).toBe(false);
    expect(res2.metrics?.solids).toBe(1);
  });
  it("prvek rozšíření mimo kartu Plochy bez pole mode (plech, svařence …): plášť nebo volné plochy navíc = ✗ u prvku", { timeout: 60_000 }, async () => {
    const sheet = ext("w22test.sheet", {});
    clearBuildCache();
    const res = await buildDoc(doc(sheet));
    expect(of(res, sheet).ok).toBe(false);
    expect(of(res, sheet).error).toMatch(/má dát objemové těleso, ale výsledek je jen plocha \/ plášť/);
    const b = box([20, 20, 10]);
    const leak = ext("w22test.sheet", { leak: true });
    const res2 = await buildDoc(doc(b, leak));
    expect(of(res2, leak).ok).toBe(false);
    expect(of(res2, leak).error).toMatch(/vedle tělesa zůstaly volné plochy \(1 navíc\)/);
    expect(res2.metrics).toMatchObject({ solids: 1 }); // těleso zůstalo jako před prvkem
    expect(res2.metrics?.free).toBeUndefined();
  });
  it("volné plochy vedle tělesa, které tam dal prvek ploch, nese stav prvku i souhrn dokumentu (free=N)", { timeout: 60_000 }, async () => {
    const sk: Feature = { id: id(), name: "Skica", type: "sketch", plane: { kind: "base", name: "XY", offset: 30 }, entities: [{ id: "e1", type: "rect", cx: 0, cy: 0, w: 20, h: 10, r: 0, angle: 0 }] } as unknown as Feature;
    const face = ext("surf.planar", { sketchId: sk.id });
    const b = box([20, 20, 10]);
    clearBuildCache();
    const d = doc(b, sk, face); // těleso a nad ním volná rovinná plocha (prvek ploch plochu dát smí)
    const res = await buildDoc(d);
    expect(res.status.map((s) => s.ok)).toEqual([true, true, true]);
    expect(res.metrics).toMatchObject({ solids: 1, free: 1 });
    expect(of(res, face).body).toMatchObject({ solids: 1, free: 1 });
    expect(levelsText(of(res, face))).toMatch(/\+ 1 volná plocha$/);
    expect(statusKv(d, res)).toMatch(/solids=1 valid=1 free=1$/);
  });
  it("prvek ploch (bez operace) plochu dát smí – stav řekne „žádné objemové těleso“, ne „těleso platné“", { timeout: 60_000 }, async () => {
    const sk: Feature = { id: id(), name: "Skica", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "e1", type: "rect", cx: 0, cy: 0, w: 20, h: 10, r: 0, angle: 0 }] } as unknown as Feature;
    const face = ext("surf.planar", { sketchId: sk.id });
    clearBuildCache();
    const res = await buildDoc(doc(sk, face));
    expect(of(res, face).ok).toBe(true);
    expect(of(res, face).body).toMatchObject({ solids: 0 });
    expect(levelsText(of(res, face))).toBe("žádné objemové těleso");
  });
});
