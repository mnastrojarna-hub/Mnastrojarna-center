/**
 * Otisky výběru indexy (pick-fields.ts, pick-sigs.ts) a ukončení díry „k tělesu“.
 * Scénář: prvek vybere hranu/plochu na kvádru, potom se PŘED něj vloží díra – ta přečísluje hrany i plochy. S otiskem prvek zasáhne stejnou
 * geometrickou entitu jako předtím, bez otisku (starý dokument) jinou – oba případy se ověřují objemem a polohou výsledku.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { featureSummary, parseAgentText } from "./agent";
import { buildDoc, buildShape } from "./build";
import { entityInfo } from "./inspect";
import { hasPickSigs, mergePicks, pickFieldsOf, picksKey, rekey } from "./pick-fields";
import { resolvePicks, SigTable, sigsOf, stampPicks } from "./pick-sigs";
import { findBySig, sigOf } from "./ref-resolve";
import { emptyDoc, type CadDoc, type Feature, type Vec3 } from "./types";
import "./ext/index";
import "./feat/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"), print: () => undefined, printErr: () => undefined });
  r.setOC(oc as never);
}, 60_000);

type FilletF = Extract<Feature, { type: "fillet" }>;
const doc = (...features: Feature[]): CadDoc => ({ ...emptyDoc("Test"), features });
const bodyOf = async (...fs: Feature[]) => (await buildShape(doc(...fs), Infinity, { noCache: true })).body!;
/** kvádr 80 × 50 × 30 v počátku: hrana 4 = svislá hrana x = 80, y = 0 (délka 30); po díře je na indexu 4 vodorovná hrana délky 80 */
const box: Feature = { id: "b", name: "Kvádr", type: "box", size: [80, 50, 30], position: [0, 0, 0], centered: false, mode: "new" };
const hole: Feature = { id: "h", name: "Díra", type: "hole", position: [20, 25, 30], axis: "Z", flip: false, diameter: 10, depth: 0, cbDiameter: 0, cbDepth: 0 };
const V_BOX = 80 * 50 * 30;
const V_HOLE = Math.PI * 25 * 30;
/** objem odebraný zaoblením R na rovné hraně délky L */
const vFillet = (R: number, L: number) => (1 - Math.PI / 4) * R * R * L;
const fillet = (extra: Partial<FilletF> = {}): FilletF => ({ id: "f", name: "Zaoblení", type: "fillet", radius: 5, edges: [4], ...extra });
const statusOf = (res: Awaited<ReturnType<typeof buildDoc>>, id: string) => res.status.find((s) => s.id === id)!;

describe("otisky výběru – tabulka otisků odpovídá sigOf / findBySig", () => {
  it("SigTable.at = sigOf a SigTable.find = findBySig pro plochy, hrany i vrcholy", async () => {
    const body = await bodyOf(box, hole);
    for (const kind of ["face", "edge", "vertex"] as const) {
      const t = new SigTable(body, kind);
      expect(t.count).toBeGreaterThan(5);
      for (let i = 0; i < t.count; i++) {
        const s = sigOf(body, kind, i);
        expect(t.at(i), `${kind} ${i}`).toEqual(s);
        expect(t.find(s!)).toBe(findBySig(body, kind, s!));
        // posunutý otisk (pod toleranci i nad ní) – stejné rozhodnutí jako findBySig
        for (const dx of [0.3, 5]) {
          const moved = { ...s!, c: [s!.c[0] + dx, s!.c[1], s!.c[2]] as Vec3 };
          expect(t.find(moved), `${kind} ${i} +${dx}`).toBe(findBySig(body, kind, moved));
        }
      }
      expect(sigsOf(body, kind, [0, t.count])).toEqual([sigOf(body, kind, 0), null]);
    }
  }, 120_000);
});

describe("zaoblení s otiskem přežije přečíslování hran", () => {
  it("díra vložená před zaoblení: s otiskem stejná hrana, bez otisku jiná", async () => {
    const stamped = stampPicks(fillet(), await bodyOf(box));
    expect(stamped.changed).toBe(true);
    const withSig = stamped.feature as FilletF;
    expect(Object.keys(withSig.edgeSigs ?? {})).toEqual(["4"]);
    expect(withSig.edgeSigs!["4"].s).toBeCloseTo(30, 6);
    // před vložením díry: zaoblená svislá hrana délky 30
    const a = await buildDoc(doc(box, withSig));
    expect(a.metrics!.volume).toBeCloseTo(V_BOX - vFillet(5, 30), 2);
    // díra PŘED zaoblením přečísluje hrany (index 4 je teď vodorovná hrana délky 80)
    const body2 = await bodyOf(box, hole);
    expect(sigOf(body2, "edge", 4)!.s).toBeCloseTo(80, 6);
    const b = await buildDoc(doc(box, hole, withSig));
    expect(statusOf(b, "f")).toEqual(expect.objectContaining({ ok: true }));
    expect(statusOf(b, "f").warning).toBeUndefined();
    expect(b.metrics!.volume).toBeCloseTo(V_BOX - V_HOLE - vFillet(5, 30), 2);
    // zaoblení leží na stejném místě: kromě stěny díry (osa x = 20, y = 25) je jediná válcová plocha R5 s osou x = 75, y = 5
    const sh = (await buildShape(doc(box, hole, withSig), Infinity, { noCache: true })).body!;
    const cyl = sh.faces.map((_, i) => entityInfo(sh, { kind: "face", index: i })).filter((x) => x.surface === "CYLINDRE" && Math.abs((x.radius ?? 0) - 5) < 1e-6);
    const axes = cyl.map((x) => x.axis!.origin.slice(0, 2).map((v) => Math.round(v * 1000) / 1000).join(";")).sort();
    expect(axes).toEqual(["20;25", "75;5"]);
    // starý dokument bez otisku: index 4 zasáhne jinou hranu (délka 80) – stavba přesně jako dřív
    const legacy = fillet();
    expect(resolvePicks(legacy, body2).feature).toBe(legacy);
    const c = await buildDoc(doc(box, hole, legacy));
    expect(c.metrics!.volume).toBeCloseTo(V_BOX - V_HOLE - vFillet(5, 80), 2);
    expect(Math.abs(c.metrics!.volume - b.metrics!.volume)).toBeGreaterThan(200);
  }, 120_000);

  it("proměnné zaoblení: poloměr klíčovaný indexem hrany se po přečíslování přenese na znovunalezenou hranu", async () => {
    const f = stampPicks(fillet({ kind: "variable", radius: 2, radii: { "4": 6 } }), await bodyOf(box)).feature as FilletF;
    const res = await buildDoc(doc(box, hole, f));
    expect(statusOf(res, "f").ok).toBe(true);
    expect(res.metrics!.volume).toBeCloseTo(V_BOX - V_HOLE - vFillet(6, 30), 2);
    const resolved = resolvePicks(f, await bodyOf(box, hole));
    expect(resolved.changed).toBe(true);
    const fe = resolved.feature as FilletF;
    expect(fe.edges).toEqual([5]); // svislá hrana x = 80, y = 0 má po díře index 5
    expect(fe.radii).toEqual({ "5": 6 });
  }, 120_000);

  it("nenalezená entita: varování ⚠ a původní index; index mimo rozsah = srozumitelná chyba", async () => {
    // otisk orazítkovaný na kvádru (12 hran); po díře má těleso 15 hran – topologie se změnila a otisk se nenajde
    const far = { t: "LINE", c: [500, 500, 500] as Vec3, s: 30, n: 12 };
    const lost = await buildDoc(doc(box, hole, fillet({ edgeSigs: { "4": far } })));
    const s = statusOf(lost, "f");
    expect(s.ok).toBe(true);
    expect(s.warning).toMatch(/Hrana 5 se po změně modelu nenašla podle otisku – použit původní index/);
    expect(lost.metrics!.volume).toBeCloseTo(V_BOX - V_HOLE - vFillet(5, 80), 2);
    // starší otisk bez počtu entit a na indexu hrana stejného typu: index platí bez varování (jako před zavedením otisků)
    const legacyFar = { t: far.t, c: far.c, s: far.s };
    const old = await buildDoc(doc(box, hole, fillet({ edgeSigs: { "4": legacyFar } })));
    expect(statusOf(old, "f").warning).toBeUndefined();
    expect(old.metrics!.volume).toBeCloseTo(V_BOX - V_HOLE - vFillet(5, 80), 2);
    const gone = await buildDoc(doc(box, hole, fillet({ edges: [40], edgeSigs: { "40": far } })));
    const g = statusOf(gone, "f");
    expect(g.ok).toBe(false);
    expect(g.error).toMatch(/Hrana 41 se po změně modelu nenašla podle otisku a těleso ji už nemá \(hran: 15\)/);
  }, 120_000);
});

describe("skořepina a prvek rozšíření s otiskem plochy", () => {
  it("skořepina otevírá stejnou plochu (+X) i po vložení díry", async () => {
    const shell = (faces: number[], extra: Record<string, unknown> = {}): Feature => ({ id: "s", name: "Skořepina", type: "shell", thickness: 2, faces, ...extra }) as Feature;
    const plusX = (b: r.Shape3D) => b.faces.findIndex((_, i) => Math.abs(sigOf(b, "face", i)!.c[0] - 80) < 1e-6);
    const b1 = await bodyOf(box);
    const b2 = await bodyOf(box, hole);
    expect(plusX(b1)).toBe(1);
    expect(plusX(b2)).not.toBe(1);
    const withSig = stampPicks(shell([1]), b1).feature;
    expect(hasPickSigs(withSig)).toBe(true);
    const got = await buildDoc(doc(box, hole, withSig));
    const ref = await buildDoc(doc(box, hole, shell([plusX(b2)])));
    const legacy = await buildDoc(doc(box, hole, shell([1])));
    expect(statusOf(got, "s").ok, JSON.stringify(got.status)).toBe(true);
    expect(statusOf(ref, "s").ok).toBe(true);
    expect(got.metrics!.volume).toBeCloseTo(ref.metrics!.volume, 3);
    expect(Math.abs(legacy.metrics!.volume - ref.metrics!.volume)).toBeGreaterThan(100);
  }, 120_000);

  it("prvek rozšíření (adv.dome, parametr ploch): kopule zůstane na ploše +X", async () => {
    const dome = (faces: number[], extra: Record<string, unknown> = {}): Feature => ({ id: "d", name: "Kopule", type: "ext", ext: "adv.dome", data: { faces, height: 10, radius: 8, mode: "add", ...extra } });
    expect(pickFieldsOf(dome([1])).map((x) => x.sigPath.join("."))).toEqual(["data.facesSigs"]);
    const withSig = stampPicks(dome([1]), await bodyOf(box)).feature as Extract<Feature, { type: "ext" }>;
    expect(Object.keys(withSig.data.facesSigs as object)).toEqual(["1"]);
    const got = await buildDoc(doc(box, hole, withSig));
    expect(statusOf(got, "d").ok, JSON.stringify(got.status)).toBe(true);
    expect(got.metrics!.bbox[1][0]).toBeCloseTo(90, 3); // kopule výšky 10 na ploše x = 80
    expect(got.metrics!.bbox[0][1]).toBeCloseTo(0, 3);
    const legacy = await buildDoc(doc(box, hole, dome([1])));
    expect(legacy.metrics!.bbox[1][0]).toBeCloseTo(80, 3); // bez otisku jiná plocha (−Y)
    expect(legacy.metrics!.bbox[0][1]).toBeCloseTo(-10, 3);
  }, 120_000);

  it("sražení vrcholu indexem s otiskem srazí stejný roh", async () => {
    const corner = (b: r.Shape3D, p: Vec3) => {
      const t = new SigTable(b, "vertex");
      for (let i = 0; i < t.count; i++) if (Math.hypot(...t.at(i)!.c.map((v, k) => v - p[k])) < 1e-4) return i;
      return -1;
    };
    const b1 = await bodyOf(box);
    const b2 = await bodyOf(box, hole);
    // roh kvádru, jehož index díra změní
    const P = ([0, 80].flatMap((x) => [0, 50].flatMap((y) => [0, 30].map((z): Vec3 => [x, y, z])))).find((p) => corner(b1, p) !== corner(b2, p))!;
    expect(P).toBeDefined();
    const i1 = corner(b1, P);
    expect(i1).toBeGreaterThanOrEqual(0);
    const ch = (vertices: number[]): Feature => ({ id: "c", name: "Sražení", type: "chamfer", distance: 4, edges: [], kind: "vertex", vertices });
    const withSig = stampPicks(ch([i1]), b1).feature;
    expect(Object.keys((withSig as { vertexSigs?: object }).vertexSigs ?? {})).toEqual([String(i1)]);
    const got = await buildDoc(doc(box, hole, withSig));
    expect(statusOf(got, "c").ok, JSON.stringify(got.status)).toBe(true);
    expect(got.metrics!.volume).toBeCloseTo(V_BOX - V_HOLE - (4 * 4 * 4) / 6, 2);
    // roh [80, 50, 30] je sražený: bod rohu už v tělese není (obálka ale zůstává – ostatní rohy jsou celé)
    const sh = (await buildShape(doc(box, hole, withSig), Infinity, { noCache: true })).body!;
    expect(corner(sh, P)).toBe(-1);
  }, 120_000);
});

describe("razítkování výběru (UI) a pomocné funkce", () => {
  it("stampPicks: doplní chybějící otisky, přepíše přečíslované indexy, nechá otisk nenalezené entity, vynechá odebrané", async () => {
    const b1 = await bodyOf(box);
    const b2 = await bodyOf(box, hole);
    const s4 = sigOf(b1, "edge", 4)!;
    const far = { t: "LINE", c: [500, 500, 500] as Vec3, s: 30, n: 12 };
    // hrana 4 s otiskem z kvádru (po díře je to hrana 5), hrana 2 bez otisku, hrana 7 s neexistujícím otiskem, mrtvý otisk hrany 9
    const f = fillet({ edges: [4, 2, 7], edgeSigs: { "4": s4, "7": far, "9": far } });
    const res = stampPicks(f, b2);
    expect(res.changed).toBe(true);
    const out = res.feature as FilletF;
    expect(out.edges).toEqual([5, 2, 7]);
    expect(Object.keys(out.edgeSigs!).sort()).toEqual(["2", "5", "7"]);
    // nové otisky nesou počet hran tělesa (15), podle kterého se pozná změna rozměru bez změny topologie
    expect(out.edgeSigs!["5"]).toEqual({ ...sigOf(b2, "edge", 5), n: 15 });
    expect(out.edgeSigs!["2"]).toEqual({ ...sigOf(b2, "edge", 2), n: 15 });
    expect(out.edgeSigs!["7"]).toEqual(far);
    expect(res.warnings.join(" ")).toMatch(/Hrana 8 se po změně modelu nenašla/);
    // podruhé už není co měnit (žádné zbytečné zápisy do dokumentu)
    const again = stampPicks(out, b2);
    expect(again.changed).toBe(false);
    expect(again.feature).toBe(out);
    // „všechny hrany“ a prvky bez výběru se nemění
    const all = fillet({ edges: "all" });
    expect(stampPicks(all, b2).feature).toBe(all);
  }, 120_000);

  it("mergePicks přenese jen výběr, picksKey se změní s výběrem i otisky, rekey přečísluje mapu", () => {
    const cur = fillet({ radius: 7, edges: [4] });
    const from = fillet({ radius: 5, edges: [5], edgeSigs: { "5": { t: "LINE", c: [80, 0, 15], s: 30 } }, radii: { "5": 3 } });
    const m = mergePicks(cur, from) as FilletF;
    expect(m.radius).toBe(7);
    expect(m.edges).toEqual([5]);
    expect(m.radii).toEqual({ "5": 3 });
    expect(picksKey(m)).not.toBe(picksKey(cur));
    expect(picksKey(fillet({ radius: 1 }))).toBe(picksKey(fillet({ radius: 2 })));
    expect(rekey({ "4": 6, "2": 1 }, new Map([[4, 5]]))).toEqual({ "5": 6, "2": 1 });
    expect(rekey({ "4": 6, "5": 1 }, new Map([[4, 5], [5, 4]]))).toEqual({ "5": 6, "4": 1 });
  });
});

describe("díra – ukončení k tělesu", () => {
  // dutý profil: kvádr 60 × 40 × 40 s průchozím otvorem podél Y (x 10…50, z 10…30) → horní stěna z 30…40, dolní z 0…10
  const frame: Feature[] = [
    { id: "b", name: "Kvádr", type: "box", size: [60, 40, 40], position: [0, 0, 0], centered: false, mode: "new" },
    { id: "o", name: "Otvor", type: "box", size: [40, 60, 20], position: [10, -10, 10], centered: false, mode: "cut" },
  ];
  const V0 = 60 * 40 * 40 - 40 * 40 * 20;
  const drill = (end: Extract<Feature, { type: "hole" }>["end"], depth = 0): Feature => ({ id: "h", name: "Díra", type: "hole", position: [30, 20, 40], axis: "Z", flip: false, diameter: 10, depth, cbDiameter: 0, cbDepth: 0, end });

  it("díra k tělesu projde jen první stěnou ve směru vrtání (skrz projde obě)", async () => {
    const toBody = await buildDoc(doc(...frame, drill({ kind: "toBody" })));
    expect(statusOf(toBody, "h").ok, JSON.stringify(toBody.status)).toBe(true);
    expect(toBody.metrics!.volume).toBeCloseTo(V0 - Math.PI * 25 * 10, 2);
    const through = await buildDoc(doc(...frame, drill({ kind: "throughAll" })));
    expect(through.metrics!.volume).toBeCloseTo(V0 - 2 * Math.PI * 25 * 10, 2);
    // dolní stěna zůstala celá: bod na ose díry uvnitř dolní stěny je v tělese
    const sh = (await buildShape(doc(...frame, drill({ kind: "toBody" })), Infinity, { noCache: true })).body!;
    const faces = sh.faces.map((_, i) => entityInfo(sh, { kind: "face", index: i }));
    const cyl = faces.filter((x) => x.surface === "CYLINDRE");
    expect(cyl.length).toBe(1);
    expect(cyl[0].center![2]).toBeCloseTo(35, 3); // válcová stěna díry jen v horní stěně (z 30…40)
    // bez tělesa: srozumitelná chyba
    const empty = await buildDoc(doc(drill({ kind: "toBody" })));
    expect(statusOf(empty, "h").ok).toBe(false);
  }, 120_000);

  it("textový příkaz: díra … k tělesu / to body / bis Körper", () => {
    for (const line of ["díra 10 k tělesu v 30 20 40", "hole 10 to body at 30 20 40", "bohrung 10 bis Körper bei 30 20 40"]) {
      const p = parseAgentText(line);
      expect(p.errors, line).toEqual([]);
      const op = p.ops[0];
      expect(op.k, line).toBe("feature");
      const f = (op as { feature: Feature }).feature as Extract<Feature, { type: "hole" }>;
      expect(f.end, line).toEqual({ kind: "toBody" });
      expect(f.depth).toBe(0);
      expect(f.body, line).toBeUndefined();
      expect(f.position).toEqual([30, 20, 40]);
    }
    const plain = (parseAgentText("díra 10 skrz v 30 20 40").ops[0] as { feature: Extract<Feature, { type: "hole" }> }).feature;
    expect(plain.end).toBeUndefined();
    // textový stav dokumentu popisuje ukončení (ne „skrz“)
    const tb = (parseAgentText("díra 10 k tělesu v 30 20 40").ops[0] as { feature: Feature }).feature;
    expect(featureSummary(tb)).toMatch(/^Ø10 k tělesu v \[30; 20; 40\]/);
    expect(featureSummary(plain)).toMatch(/^Ø10 skrz v/);
  });
});
