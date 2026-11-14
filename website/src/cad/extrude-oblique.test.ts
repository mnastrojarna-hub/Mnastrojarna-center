/**
 * Šikmé vysunutí (směr vektorem / sklonem / odkazem, výška kolmo), úkos dovnitř / ven s břitem a ostrými rohy, odlehčení
 * střižnice – objemy z jádra proti analytickým vzorcům (komolý jehlan / kužel, Cavalieri). Textové příkazy jako v konzoli.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "./build";
import { docFromText } from "./drawing-dims-harness";
import { resolveRefNames } from "./agent-extr";
import { draftedExtrusion } from "./extrude-draft";
import { emptyDoc, type CadDoc, type Feature, type Vec3 } from "./types";
import "./ext/index";
import "./feat/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"), print: () => undefined, printErr: () => undefined });
  r.setOC(oc as never);
}, 60_000);

const rad = (deg: number) => (deg * Math.PI) / 180;
const k2 = Math.tan(rad(2));
/** komolý jehlan obdélníku a × b, každá strana se mění o 2·s na jednotku výšky (s > 0 rozšiřuje), ostré rohy */
const prismoid = (a: number, b: number, h: number, s: number) => a * b * h + (a + b) * s * h * h + (4 / 3) * s * s * h * h * h;
/** totéž se zaoblenými rozšiřujícími se rohy (poloměr = odsazení s·t): odečte (4 − π)·(s·t)² */
const prismoidRound = (a: number, b: number, h: number, s: number) => prismoid(a, b, h, s) - ((4 - Math.PI) * s * s * h * h * h) / 3;
/** komolý kužel */
const frustum = (r1: number, r2: number, h: number) => (Math.PI * h * (r1 * r1 + r1 * r2 + r2 * r2)) / 3;

async function run(text: string) {
  const d = await docFromText(text);
  const res = await buildDoc(d);
  const bad = res.status.filter((s) => !s.ok);
  return { d, res, bad, vol: res.metrics?.volume ?? NaN, bbox: res.metrics?.bbox };
}
const ok = (x: Awaited<ReturnType<typeof run>>) => expect(x.bad, JSON.stringify(x.bad)).toEqual([]);

describe("šikmé vysunutí (propad)", () => {
  it("sklon 25° k +X: objem = plocha × výška kolmo, posun konce o délku·sin", async () => {
    const x = await run("skica XY: obdélník 20 10\nvysunout 20 sklon 25 k +X");
    ok(x);
    expect(x.vol).toBeCloseTo(200 * 20 * Math.cos(rad(25)), 3);
    expect(x.bbox![1][0]).toBeCloseTo(10 + 20 * Math.sin(rad(25)), 4);
    expect(x.bbox![1][2]).toBeCloseTo(20 * Math.cos(rad(25)), 4);
  });
  it("obráceně u sklonu k +X: na druhou stranu skici, sklon k +X zůstane (konec posunutý k +X)", async () => {
    const x = await run("skica XY: obdélník 20 10\nvysunout výška 10 obráceně sklon 25 k +X");
    ok(x);
    expect(x.vol).toBeCloseTo(200 * 10, 3);
    expect(x.bbox![0][2]).toBeCloseTo(-10, 5);
    expect(x.bbox![1][0]).toBeCloseTo(10 + 10 * Math.tan(rad(25)), 4);
    expect(x.bbox![0][0]).toBeCloseTo(-10, 5);
  });
  it("„výška 20“ = 20 kolmo na skicu (délka podél směru 20 / cos)", async () => {
    const x = await run("skica XY: obdélník 20 10\nvysunout výška 20 sklon 25 k +X");
    ok(x);
    expect(x.vol).toBeCloseTo(200 * 20, 3);
    expect(x.bbox![1][2]).toBeCloseTo(20, 5);
    expect(x.bbox![1][0]).toBeCloseTo(10 + 20 * Math.tan(rad(25)), 4);
  });
  it("sklon k +Y a k vektoru 1 1 0 (průmět do roviny skici); bez „k“ = k ose X skici", async () => {
    const y = await run("skica XY: obdélník 20 10\nvysunout výška 10 sklon 30 k +Y");
    ok(y);
    expect(y.bbox![1][1]).toBeCloseTo(5 + 10 * Math.tan(rad(30)), 4);
    expect(y.bbox![1][0]).toBeCloseTo(10, 5);
    const v = await run("skica XY: obdélník 20 10\nvysunout výška 10 sklon 30 k 1 1 5");
    ok(v);
    const s = (10 * Math.tan(rad(30))) / Math.SQRT2;
    expect(v.bbox![1][0]).toBeCloseTo(10 + s, 4);
    expect(v.bbox![1][1]).toBeCloseTo(5 + s, 4);
    const dflt = await run("skica XY: obdélník 20 10\nvysunout výška 10 sklon 30");
    ok(dflt);
    expect(dflt.bbox![1][0]).toBeCloseTo(10 + 10 * Math.tan(rad(30)), 4);
  });
  it("směr vektorem 1 0 1: délka podél směru; ve směru v rovině skici = srozumitelná chyba", async () => {
    const x = await run("skica XY: obdélník 20 10\nvysunout 20 směr 1 0 1");
    ok(x);
    expect(x.vol).toBeCloseTo(200 * 20 * Math.SQRT1_2, 3);
    const bad = await run("skica XY: obdélník 20 10\nvysunout 20 směr 1 0 0");
    expect(bad.bad[0]?.error).toMatch(/nesmí ležet v rovině skici/);
  });
  it("odebrat skrz šikmo: propad deskou pod 25° (rovnoběžník v řezu), plocha × tloušťka", async () => {
    const x = await run("kvádr 80 60 20\nskica XY odsazení 20: obdélník 20 10 v 30 30\nvysunout skrz odebrat obráceně sklon 25 k +X");
    ok(x);
    expect(x.vol).toBeCloseTo(80 * 60 * 20 - 200 * 20, 2);
  });
  it("odebrat šikmo „k tělesu“: projde jen první deskou ve směru vysunutí", async () => {
    const x = await run("kvádr 80 60 10\nkvádr 80 60 10 v 0 0 20\nskica XY odsazení 30: obdélník 20 10 v 40 30\nvysunout odebrat obráceně k tělesu sklon 20 k +X");
    ok(x);
    expect(x.vol).toBeCloseTo(2 * 48000 - 200 * 10, 2);
  });
  it("k vrcholu u šikmého směru s výškou kolmo (text): konec v rovině bodu rovnoběžné se skicou", async () => {
    const d: CadDoc = { ...emptyDoc("T"), features: [
      { id: "s", name: "Skica", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "e1", type: "rect", cx: 0, cy: 0, w: 20, h: 10, r: 0, angle: 0 }] },
      { id: "x", name: "Vysunutí", type: "extrude", sketchId: "s", distance: 1, symmetric: false, reverse: false, mode: "new", dir: { kind: "angle", deg: 25, toward: [1, 0, 0] }, normalHeight: true, extent: { kind: "toVertex", ref: { kind: "xyz", p: [100, 0, 15] } } },
    ] as Feature[] };
    const res = await buildDoc(d);
    expect(res.status.every((s) => s.ok), JSON.stringify(res.status)).toBe(true);
    expect(res.metrics!.volume).toBeCloseTo(200 * 15, 3);
  });
  it("k vrcholu u šikmého směru ve starším dokumentu (bez normalHeight): průmět do směru jako na f5f10c5", async () => {
    // dokument z kontroly: V1 = [50; 50; 20], směr 1 0 1 → t = 70·cos 45° = 49,5 podél směru = výška 35 → 6 000 + 200·35 = 9 cm³
    const d: CadDoc = { ...emptyDoc("T"), features: [
      { id: "b", name: "Kvádr", type: "box", size: [10, 10, 20], position: [50, 50, 0], centered: false, mode: "new" },
      { id: "s", name: "Skica", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "e1", type: "rect", cx: 0, cy: 0, w: 20, h: 10, r: 0, angle: 0 }] },
      { id: "x", name: "Vysunutí", type: "extrude", sketchId: "s", distance: 10, symmetric: false, reverse: false, mode: "new", dir: { kind: "vector", v: [1, 0, 1] }, extent: { kind: "toVertex", ref: { kind: "xyz", p: [50, 50, 20] } } },
    ] as Feature[] };
    const old = await buildDoc(d);
    expect(old.status.every((s) => s.ok), JSON.stringify(old.status)).toBe(true);
    expect(old.metrics!.volume).toBeCloseTo(2000 + 200 * 35, 2);
    // text „k vrcholu“ šikmo nastaví výšku kolmo → konec v rovině z = 20
    const now = await buildDoc({ ...d, features: d.features.map((f) => (f.type === "extrude" ? { ...f, normalHeight: true } : f)) as Feature[] });
    expect(now.metrics!.volume).toBeCloseTo(2000 + 200 * 20, 2);
  });
  it("sklon bez „k“ + obráceně = totéž jako „k +X“ u skici XY (strana sklonu zůstane)", async () => {
    const a = await run("kvádr 100 100 30\nskica XY odsazení 30: obdélník 20 20 v 50 50\nvysunout skrz odebrat obráceně sklon 25");
    const b = await run("kvádr 100 100 30\nskica XY odsazení 30: obdélník 20 20 v 50 50\nvysunout skrz odebrat obráceně sklon 25 k +X");
    ok(a);
    ok(b);
    expect(a.vol).toBeCloseTo(b.vol, 4);
    expect(a.vol).toBeCloseTo(300000 - 400 * 30, 2);
    // tvar stejný: dolní ústí posunuté k +X v obou zápisech (obálka samostatného hranolu)
    const p = await run("skica XY: obdélník 20 20\nvysunout výška 10 obráceně sklon 25");
    const q = await run("skica XY: obdélník 20 20\nvysunout výška 10 obráceně sklon 25 k +X");
    expect(p.bbox).toEqual(q.bbox);
    expect(p.bbox![1][0]).toBeCloseTo(10 + 10 * Math.tan(rad(25)), 4);
    expect(p.bbox![0][2]).toBeCloseTo(-10, 6);
  });
  it("směr podél pomocné osy zadané názvem (resolveRefNames) a podél dvou bodů", async () => {
    const feats: Feature[] = [
      { id: "a1", name: "Osa 1", type: "datumAxis", def: { kind: "twoPoints", a: { kind: "xyz", p: [0, 0, 0] }, b: { kind: "xyz", p: [1, 0, 1] } }, length: 50 },
      { id: "s", name: "Skica", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "e1", type: "circle", cx: 0, cy: 0, r: 5 }] },
    ];
    const ex = { id: "x", name: "Vysunutí", type: "extrude", sketchId: "s", distance: 20, symmetric: false, reverse: false, mode: "new", dir: { kind: "edge", ref: { kind: "datumAxis", featureId: "osa 1" } } } as Feature;
    resolveRefNames(ex, feats);
    expect((ex as { dir: { ref: { featureId: string } } }).dir.ref.featureId).toBe("a1");
    const res = await buildDoc({ ...emptyDoc("T"), features: [...feats, ex] });
    expect(res.status.every((s) => s.ok), JSON.stringify(res.status)).toBe(true);
    expect(res.metrics!.volume).toBeCloseTo(Math.PI * 25 * 20 * Math.SQRT1_2, 2);
    expect(() => resolveRefNames({ ...ex, dir: { kind: "edge", ref: { kind: "datumAxis", featureId: "Osa 9" } } } as Feature, feats)).toThrow(/Osa 9.*Osa 1/);
  });
});

describe("úkos dovnitř / ven – znaménko, otvory, rohy", () => {
  const h = 10;
  const s = h * k2;
  it("čtverec 20: dovnitř (+) = zúžený a ven (−) = rozšířený komolý jehlan (ostré rohy); zaoblené rohy = starší chování", async () => {
    const i = await run("skica XY: obdélník 20 20\nvysunout 10 úkos 2 dovnitř");
    ok(i);
    expect(i.vol).toBeCloseTo(prismoid(20, 20, h, -k2), 3);
    expect(i.bbox![1][2]).toBeCloseTo(10, 6);
    const o = await run("skica XY: obdélník 20 20\nvysunout 10 úkos 2 ven");
    ok(o);
    expect(o.vol).toBeCloseTo(prismoid(20, 20, h, k2), 3);
    expect(o.bbox![1][0]).toBeCloseTo(10 + s, 4);
    // zaoblené rohy: rozšiřující se rohy se zaoblí (přímkové plochy) – objem mezi ideálním zaobleným a ostrým jehlanem ± 0,5 mm³
    const round = await run("skica XY: obdélník 20 20\nvysunout 10 úkos 2 ven zaoblené rohy");
    ok(round);
    expect(round.vol).toBeCloseTo(4140.675, 2); // = starší dokument s draftAngle −2 (viz níže)
    expect(Math.abs(round.vol - prismoidRound(20, 20, h, k2))).toBeLessThan(0.5);
    // „úkos -2“ = „úkos 2 ven“, slovo má přednost před znaménkem
    const neg = await run("skica XY: obdélník 20 20\nvysunout 10 úkos -2");
    expect(neg.vol).toBeCloseTo(o.vol, 6);
    const word = await run("skica XY: obdélník 20 20\nvysunout 10 úkos -2 dovnitř");
    expect(word.vol).toBeCloseTo(i.vol, 6);
  });
  it("kruh Ø20: komolý kužel dovnitř i ven", async () => {
    const i = await run("skica XY: kružnice 20\nvysunout 10 úkos 2");
    ok(i);
    expect(i.vol).toBeCloseTo(frustum(10, 10 - s, h), 2);
    const o = await run("skica XY: kružnice 20\nvysunout 10 úkos 2 ven");
    ok(o);
    expect(o.vol).toBeCloseTo(frustum(10, 10 + s, h), 2);
  });
  it("otvor v profilu jde opačně: dovnitř = vnější obrys se zužuje, otvor rozšiřuje", async () => {
    const x = await run("skica XY: obdélník 40 40; kružnice 20\nvysunout 10 úkos 2 dovnitř");
    ok(x);
    expect(x.vol).toBeCloseTo(prismoid(40, 40, h, -k2) - frustum(10, 10 + s, h), 2);
    const y = await run("skica XY: obdélník 40 40; kružnice 20\nvysunout 10 úkos 2 ven");
    ok(y);
    expect(y.vol).toBeCloseTo(prismoid(40, 40, h, k2) - frustum(10, 10 - s, h), 2);
  });
  it("starší dokument (draftAngle bez nových polí) se postaví stejně jako před změnou", async () => {
    const base = { id: "s", name: "Skica", type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: [{ id: "e1", type: "rect", cx: 0, cy: 0, w: 20, h: 20, r: 0, angle: 0 }] } as Feature;
    const ex = (draftAngle: number) => ({ id: "x", name: "V", type: "extrude", sketchId: "s", distance: 10, symmetric: false, reverse: false, mode: "new", draftAngle }) as Feature;
    // hodnoty naměřené na f5f10c5 (před úpravou)
    expect((await buildDoc({ ...emptyDoc("T"), features: [base, ex(2)] })).metrics!.volume).toBeCloseTo(3861.943, 2);
    expect((await buildDoc({ ...emptyDoc("T"), features: [base, ex(-2)] })).metrics!.volume).toBeCloseTo(4140.675, 2);
  });
  it("úkos u šikmého vysunutí: stejný objem jako kolmé (Cavalieri), konec posunutý", async () => {
    const x = await run("skica XY: obdélník 20 20\nvysunout výška 10 sklon 25 k +X úkos 2 dovnitř");
    ok(x);
    expect(x.vol).toBeCloseTo(prismoid(20, 20, h, -k2), 3);
    expect(x.bbox![1][0]).toBeCloseTo(10 - s + 10 * Math.tan(rad(25)), 3); // konec: zúžený o s a posunutý o výška·tan 25°
  });
  it("symetricky s úkosem: obrys skici v rovině skici, obě poloviny se zužují (dřív jednostranně posunuto)", async () => {
    const t5 = Math.tan(rad(5));
    const x = await run("skica XY: obdélník 20 20\nvysunout 20 symetricky úkos 5");
    ok(x);
    expect(x.vol).toBeCloseTo(2 * prismoid(20, 20, 10, -t5), 3); // 7 320,502
    expect(x.vol).toBeCloseTo(7320.502, 2);
    expect(x.bbox![0][2]).toBeCloseTo(-10, 6);
    expect(x.bbox![1][2]).toBeCloseTo(10, 6);
    expect(x.bbox![1][0]).toBeCloseTo(10, 6); // nejširší v rovině skici
    // s břitem: každá polovina má rovných 4 mm od roviny skici
    const y = await run("skica XY: obdélník 20 20\nvysunout 20 symetricky úkos 5 ven břit 4");
    ok(y);
    expect(y.vol).toBeCloseTo(2 * (400 * 4 + prismoid(20, 20, 6, t5)), 3);
    // starší dokument (bez draftCorners) se staví jako na f5f10c5: jednostranný úkos posunutý o polovinu délky
    const old = await buildDoc({ ...x.d, features: x.d.features.map((f) => (f.type === "extrude" ? { ...f, draftCorners: undefined } : f)) as Feature[] });
    expect(old.metrics!.volume).toBeCloseTo(prismoid(20, 20, 20, -t5), 3); // 6 681,827
    // šikmo symetricky: Cavalieri
    const z = await run("skica XY: obdélník 20 20\nvysunout výška 20 symetricky sklon 20 k +X úkos 5");
    ok(z);
    expect(z.vol).toBeCloseTo(2 * prismoid(20, 20, 10, -t5), 3);
  });
  it("chyby: břit delší než výška, úkos 45°", async () => {
    const land = await run("skica XY: kružnice 20\nvysunout 5 úkos 2 ven břit 6");
    expect(land.bad[0]?.error).toMatch(/Břit/);
    const big = await docFromText("skica XY: kružnice 20\nvysunout 5").then((d) => ({ ...d, features: d.features.map((f) => (f.type === "extrude" ? { ...f, draftAngle: 45 } : f)) as Feature[] }));
    const res = await buildDoc(big);
    expect(res.status.find((x) => !x.ok)?.error).toMatch(/45°/);
  });
});

describe("střižnice – otvor s břitem a odlehčením", () => {
  it("kruhový otvor Ø20 deskou 20: břit 3 válcově, pak 2° ven (otvor se rozšiřuje od střižné plochy)", async () => {
    const x = await run("kvádr 60 60 20\nskica XY odsazení 20: kružnice 20 v 30 30\nvysunout skrz odebrat obráceně úkos 2 ven břit 3");
    ok(x);
    const removed = Math.PI * 100 * 3 + frustum(10, 10 + 17 * k2, 17);
    expect(72000 - x.vol).toBeCloseTo(removed, 1);
  });
  it("obdélníkový otvor 20 × 10 s ostrými rohy: břit 3 + komolý jehlan 17 mm", async () => {
    const x = await run("kvádr 60 60 20\nskica XY odsazení 20: obdélník 20 10 v 30 30\nvysunout skrz odebrat obráceně úkos 2 ven břit 3");
    ok(x);
    expect(72000 - x.vol).toBeCloseTo(200 * 3 + prismoid(20, 10, 17, k2), 1);
  });
  it("příklad z návodu pro AI: deska 120 × 80 × 25, otvor 40 × 20, břit 3, odlehčení 2° → odebráno 21 031,4 mm³", async () => {
    const x = await run("nový díl Střižnice\nkvádr 120 80 25 název Deska\nskica XY odsazení 25: obdélník 40 20 v 60 40\nvysunout skrz odebrat obráceně úkos 2 ven břit 3");
    ok(x);
    expect(240000 - x.vol).toBeCloseTo(21031.4, 1);
  });
  it("ostré rohy = rovinné stěny (měřit ukáže normálu a úhel, skica na stěně, STEP s rovinami)", async () => {
    const P: [number, number, number][] = [[40, 30, 25], [80, 30, 25], [80, 50, 25], [40, 50, 25]];
    const wire = r.assembleWire(P.map((p, i) => r.makeLine(p, P[(i + 1) % 4])));
    const s = draftedExtrusion([{ wire, depth: 0 }], { dir: [0, 0, -1], n0: [0, 0, 1], dist: 25, draft: -2, land: 3, sharp: true });
    expect(s.faces.map((f) => f.geomType)).toEqual(Array(10).fill("PLANE"));
    expect(r.measureVolume(s)).toBeCloseTo(800 * 3 + prismoid(40, 20, 22, k2), 3);
    // stěna odlehčení svírá se směrem vysunutí 2°
    const relief = s.faces.find((f) => {
      const n = f.normalAt();
      return Math.abs(n.z) > 1e-3 && Math.abs(n.z) < 0.5;
    })!;
    expect(Math.asin(Math.abs(relief.normalAt().z)) * (180 / Math.PI)).toBeCloseTo(2, 6);
    // symetricky a šikmo také roviny; zaoblené rohy zůstanou přímkovým loftem (starší chování)
    const sym = draftedExtrusion([{ wire: wire.clone(), depth: 0 }], { dir: [0.4226182617, 0, 0.906307787], n0: [0, 0, 1], dist: 10, back: 10, draft: 3, sharp: true });
    expect(sym.faces.every((f) => f.geomType === "PLANE")).toBe(true);
    const round = draftedExtrusion([{ wire: wire.clone(), depth: 0 }], { dir: [0, 0, -1], n0: [0, 0, 1], dist: 25, draft: -2 });
    expect(round.faces.some((f) => f.geomType !== "PLANE")).toBe(true);
  });
  it("úkos dovnitř skrz malým otvorem: nástroj končí za deskou (dřív se na dlouhém nástroji profil zúžil do ztracena)", async () => {
    const x = await run("kvádr 60 60 20\nskica XY odsazení 20: kružnice 6 v 30 30\nvysunout skrz odebrat obráceně úkos 5 dovnitř");
    ok(x);
    expect(72000 - x.vol).toBeCloseTo(frustum(3, 3 - 20 * Math.tan(rad(5)), 20), 2);
  });
});

describe("úkos s ukončením odkazem (k ploše / rovině / dalšímu / tělesu, skrz)", () => {
  it("k ploše F5 odsazení 5 s úkosem dovnitř i ven = slepé vysunutí 25 (dřív falešné „odsadil o 15,495 mm“)", async () => {
    const pre = "kvádr 100 100 30\nskica XY odsazení 30: obdélník 20 20 v 50 50\n";
    const ref = await run(pre + "vysunout 25 odebrat obráceně úkos 2");
    ok(ref);
    expect(ref.vol).toBeCloseTo(300000 - prismoid(20, 20, 25, -k2), 2); // 290 847,614
    const x = await run(pre + "vysunout odebrat obráceně k ploše F5 odsazení 5 úkos 2");
    ok(x);
    expect(x.vol).toBeCloseTo(ref.vol, 3);
    const out = await run(pre + "vysunout odebrat obráceně k ploše F5 odsazení 5 úkos 2 ven");
    ok(out);
    expect(out.vol).toBeCloseTo(300000 - prismoid(20, 20, 25, k2), 3);
    const noOff = await run(pre + "vysunout odebrat obráceně k ploše F5 úkos 2");
    ok(noOff);
    expect(noOff.vol).toBeCloseTo(300000 - prismoid(20, 20, 30, -k2), 3);
  });
  it("k šikmé rovině s úkosem: nástroj jen kousek za rovinu, rovina ho přesně ořízne", async () => {
    const d = await docFromText("skica XY: obdélník 20 10\nvysunout 40 úkos 3");
    const ex = d.features.find((f) => f.type === "extrude")!;
    const t3 = Math.tan(rad(3));
    const run2 = async (normal: Vec3) => {
      const pl: Feature = { id: "p", name: "Rovina 1", type: "datum", origin: [0, 0, 15], normal, xDir: [1, 0, 0], size: 50 };
      const e = { ...ex, extent: { kind: "toFace", ref: { kind: "datum", featureId: "Rovina 1" } } } as Feature;
      resolveRefNames(e, [pl]);
      return buildDoc({ ...d, features: [pl, ...d.features.filter((f) => f.type !== "extrude"), e] });
    };
    const par = await run2([0, 0, 1]);
    expect(par.status.every((s) => s.ok), JSON.stringify(par.status)).toBe(true);
    expect(par.metrics!.volume).toBeCloseTo(prismoid(20, 10, 15, -t3), 3); // 2 658,607
    const tilt = await run2([0.2, 0, 1]);
    expect(tilt.status.every((s) => s.ok), JSON.stringify(tilt.status)).toBe(true);
    // rovina z = 15 − 0,2·x; nejvýš je levá zúžená stěna x = −10 + h·tan 3°: h = 17 / (1 + 0,2·tan 3°)
    expect(tilt.metrics!.bbox[1][2]).toBeCloseTo(17 / (1 + 0.2 * t3), 3);
  });
  it("k dalšímu / k tělesu s úkosem přidá výstupek po další desku (dřív „odsadil o 24,925 mm“)", async () => {
    const pre = "kvádr 100 100 10\nkvádr 100 100 10 v 0 0 60\nskica XY odsazení 10: obdélník 10 10 v 50 50\n";
    const t3 = Math.tan(rad(3));
    const ref = await run(pre + "vysunout 50 úkos 3");
    ok(ref);
    expect(ref.vol).toBeCloseTo(200000 + prismoid(10, 10, 50, -t3), 3); // 202 837,374
    for (const end of ["k dalšímu", "k tělesu"]) {
      const x = await run(pre + `vysunout ${end} úkos 3`);
      ok(x);
      expect(x.vol, end).toBeCloseTo(ref.vol, 2);
    }
    // odebrání k dalšímu s úkosem: projde jen první deskou
    const cut = await run("kvádr 100 100 10\nkvádr 100 100 10 v 0 0 20\nskica XY odsazení 30: obdélník 20 20 v 50 50\nvysunout odebrat obráceně k dalšímu úkos 2 ven");
    ok(cut);
    expect(cut.vol).toBeCloseTo(200000 - prismoid(20, 20, 10, k2), 3);
  });
  it("skrz s úkosem ve směru od tělesa = srozumitelná chyba s radou „obráceně“", async () => {
    const x = await run("kvádr 120 80 25\nskica XY odsazení 25: obdélník 40 20 v 60 40\nvysunout skrz odebrat úkos 2");
    expect(x.bad[0]?.error).toMatch(/míří od tělesa.*obráceně/);
  });
  it("skrz s břitem delším než deska: rovný otvor (dřív chyba s vnitřní délkou 2,5 mm)", async () => {
    const x = await run("kvádr 60 40 1,5\nskica XY odsazení 1,5: obdélník 20 10 v 30 20\nvysunout skrz odebrat obráceně úkos 2 ven břit 3");
    ok(x);
    expect(x.vol).toBeCloseTo(3600 - 300, 3);
  });
  it("úkos a ukončení k zakřivené ploše = chyba (dřív se úkos tiše vynechal)", async () => {
    // vodorovný válec podél X, skica nad ním, vysunutí dolů k plášti válce
    const pre = "válec 40 100 osa X\nskica XY odsazení 50: obdélník 10 10 v 50 0\n";
    const errs: string[] = [];
    for (const i of [1, 2, 3]) errs.push((await run(pre + `vysunout obráceně k ploše F${i} úkos 2`)).bad[0]?.error ?? "");
    // F1 = plášť válce (F2, F3 = čela rovnoběžná se směrem)
    expect(errs.filter((e) => /Úkos nelze kombinovat s ukončením k zakřivené ploše/.test(e))).toHaveLength(1);
  });
});
