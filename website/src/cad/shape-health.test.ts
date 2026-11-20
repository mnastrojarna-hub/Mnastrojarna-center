/**
 * Střižnice se zadním odlehčením břitu (17. vlna): řez na natočené rovině, který je tečný k sousednímu kuželu odlehčení
 * a jehož horní hrana leží přesně na stěně otvoru, se souřadnicemi zaokrouhlenými na 4–6 desetinných míst.
 *
 * Díl v testu je SYNTETICKÝ (vlastní rozměry): deska 60 × 40 × 12 s drážkou natočenou v půdorysu, břit 3 mm, pod ním
 * odlehčení 2° – kužely v zaoblených koncích a klíny podél rovných stěn na rovinách skici natočených spolu s drážkou.
 * Stejná třída závady jako u skutečného nástroje: přesné jádro tu podle úhlu natočení vrátí neplatné těleso, těleso
 * s hranou uvnitř tolerance vlastního vrcholu, řez tiše neprovede, nebo skončí chybou.
 *
 * Druhá polovina souboru hlídá to, co oprava nesmí pokazit (nálezy kontroly první verze, která dávala toleranci každé
 * operaci): skoro-dotyky, které přesně vycházejí – dvě díry s přesahem 1e-5 mm, kanál, který prorazí plochu o 1e-5 mm,
 * zkrutná pružina z knihovny, malé úběry na velkém tělese – a přiřazení varování správnému prvku.
 *
 * Test se skutečným dokumentem (zákaznická data) běží jen tehdy, když soubor existuje: `CAD_FIXTURE_959=/cesta/k/souboru`
 * nebo `website/.local/fixtures/959-dokument.json`.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc, clearBuildCache } from "./build";
import { baseFuzzy, booleanOnce, setBooleanGuard, setBooleanTolerance } from "./fastbool";
import { newExtFeature } from "./defaults";
import "./ext/index";
import { familyById } from "./library";
import { withDefaults } from "./library/types";
import { boolStats, flagInvalidBody, fuzzyLadder, invalidSince, manifoldEdges, maxVertexTolerance, microEdges } from "./shape-health";
import { emptyDoc, type CadDoc, type Feature, type FeatureStatus, type SketchEntity, type SketchPlane, type Vec3 } from "./types";
import "./feat/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

const rd = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
type P2 = [number, number];

// rozměry syntetické střižnice
const W = 60;
const D = 40;
const T = 12;
/** výška, od které nahoru je břit (pod ní odlehčení) */
const LAND = 9;
/** poloměr konců drážky a polovina vzdálenosti jejich středů */
const R = 3;
const A = 8;
/** rozšíření odlehčení na spodním konci profilu (z = −1): 10 · tg 2° na 5 míst, jak ho zapíše člověk nebo agent */
const WIDEN = rd((LAND + 1) * Math.tan((2 * Math.PI) / 180), 5);

/**
 * Deska s drážkou natočenou o `angle`° a s odlehčením břitu. `dec` = počet desetinných míst souřadnic skici a vektorů rovin,
 * `odec` = počátků rovin a délek (6 a 5 = zápis, jaký vzniká při překreslování výkresu textem).
 */
function dieDoc(angle: number, dec = 6, odec = 5): CadDoc {
  let n = 0;
  const id = () => `d${++n}`;
  const c = Math.cos((angle * Math.PI) / 180);
  const s = Math.sin((angle * Math.PI) / 180);
  const u: P2 = [c, s];
  const nn: P2 = [-s, c];
  const add = (p: P2, q: P2, k: number): P2 => [p[0] + q[0] * k, p[1] + q[1] * k];
  const q = (p: P2): P2 => [rd(p[0], dec), rd(p[1], dec)];
  const cA = add([W / 2, D / 2], u, -A);
  const cB = add([W / 2, D / 2], u, A);
  const P1 = q(add(cA, nn, R));
  const P2 = q(add(cB, nn, R));
  const P3 = q(add(cB, nn, -R));
  const P4 = q(add(cA, nn, -R));
  const sk = (name: string, plane: SketchPlane, entities: SketchEntity[]): Feature => ({ id: id(), name, type: "sketch", plane, entities });
  const features: Feature[] = [{ id: id(), name: "Deska", type: "box", size: [W, D, T], position: [0, 0, 0], centered: false, mode: "new" }];
  const opening = sk("Otvor", { kind: "base", name: "XY", offset: 0 }, [
    { id: "e1", type: "line", a: P1, b: P2 },
    { id: "e2", type: "arc", a: P2, b: q(add(cB, u, R)), c: P3 },
    { id: "e3", type: "line", a: P3, b: P4 },
    { id: "e4", type: "arc", a: P4, b: q(add(cA, u, -R)), c: P1 },
  ] as SketchEntity[]);
  features.push(opening, { id: id(), name: "Otvor skrz", type: "extrude", sketchId: opening.id, distance: T, symmetric: false, reverse: false, mode: "cut" } as Feature);
  /** kužel odlehčení v zaobleném konci: rotace profilu kolem svislé osy středem oblouku */
  const cone = (name: string, center: P2) => {
    const s1 = sk(`Skica ${name}`, { kind: "custom", origin: [rd(center[0], odec), rd(center[1], odec), 0], normal: [0, -1, 0], xDir: [1, 0, 0] }, [{ id: "e1", type: "polyline", points: [[0, -1], [rd(R + WIDEN, 5), -1], [R, LAND], [0, LAND]], closed: true }] as SketchEntity[]);
    features.push(s1, { id: id(), name, type: "revolve", sketchId: s1.id, angle: 360, axis: "y", mode: "cut" } as Feature);
  };
  /** klín odlehčení podél rovné stěny: profil na rovině kolmé ke stěně v jejím začátku, vysunutý po délce stěny */
  const wedge = (name: string, from: P2, to: P2, out: P2) => {
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const normal: Vec3 = [rd((to[0] - from[0]) / len, dec), rd((to[1] - from[1]) / len, dec), 0];
    const s1 = sk(`Skica ${name}`, { kind: "custom", origin: [rd(from[0], odec), rd(from[1], odec), 0], normal, xDir: [rd(out[0], dec), rd(out[1], dec), 0] }, [{ id: "e1", type: "polyline", points: [[-0.02, LAND], [0, LAND], [WIDEN, -1], [-0.02, -1]], closed: true }] as SketchEntity[]);
    features.push(s1, { id: id(), name, type: "extrude", sketchId: s1.id, distance: rd(len, odec), symmetric: false, reverse: false, mode: "cut" } as Feature);
  };
  cone("Kužel B", cB);
  wedge("Klín 1", P1, P2, nn);
  cone("Kužel A", cA);
  wedge("Klín 2", P3, P4, [-nn[0], -nn[1]]);
  return { ...emptyDoc("Syntetická střižnice"), features };
}

/** Objem dílu spočítaný ručně: deska − drážka skrz − odlehčení (pás šířky k·(9 − z) kolem obrysu drážky pod břitem). */
const SLOT_AREA = 2 * A * 2 * R + Math.PI * R * R;
const SLOT_PERIMETER = 2 * (2 * A) + 2 * Math.PI * R;
const K = WIDEN / (LAND + 1);
const EXPECTED = W * D * T - SLOT_AREA * T - (SLOT_PERIMETER * K * (LAND * LAND) / 2 + Math.PI * K * K * (LAND * LAND * LAND) / 3);

const build = async (doc: CadDoc) => {
  clearBuildCache();
  return buildDoc(doc);
};
type Built = Awaited<ReturnType<typeof buildDoc>>;
const statusOf = (doc: CadDoc, res: Built, name: string) => res.status.find((s) => s.id === doc.features.find((f) => f.name === name)!.id)!;
const marks = (res: Built) => res.status.map((s) => (s.ok ? (s.warning ? "⚠" : "✓") : "✗")).join("");
const notOk = (res: Built) => res.status.filter((s) => !s.ok || s.warning).map((s) => s.error ?? s.warning);
/** které prvky dokumentu těleso mění (skici jen připravují profil) */
const solidSteps = (doc: CadDoc) => doc.features.map((f, i) => (f.type === "sketch" ? -1 : i)).filter((i) => i >= 0);

// pojistka z shape-health.ts (registruje se při načtení modulu) – některé testy ji vypínají a vracejí
const guard = setBooleanGuard(null);
setBooleanGuard(guard);
afterEach(() => {
  setBooleanTolerance(null);
  setBooleanGuard(guard);
});
/** přesné jádro bez kontroly výsledku operací = stav před opravou */
const raw = () => setBooleanGuard(null);

describe("tolerance opakované operace – pravidlo", () => {
  it("roste s velikostí modelu, nejméně 1e-5 a nejvýš 1e-4 mm; opakování s tolerancí modelu, 10× a 100×", () => {
    expect(baseFuzzy(10)).toBe(1e-5);
    expect(baseFuzzy(73)).toBe(1e-5);
    expect(baseFuzzy(218)).toBeCloseTo(2.18e-5, 12);
    expect(baseFuzzy(5000)).toBe(1e-4);
    expect(baseFuzzy(0)).toBe(1e-5); // neznámá velikost = 100 mm
    expect(fuzzyLadder(218).map((f) => +f.toExponential(3))).toEqual([2.18e-5, 2.18e-4, 2.18e-3]);
  });
});

describe("syntetická střižnice – přesné jádro bez kontroly operací (stav před opravou)", () => {
  it("natočení 20°: oba klíny jádro tiše neprovede – chybí 41 mm³ odlehčení, těleso je přitom „platné“", { timeout: 120_000 }, async () => {
    raw();
    const doc = dieDoc(20);
    const res = await build(doc);
    expect(res.metrics!.valid).toBe(true);
    expect(res.status.every((s) => s.ok)).toBe(true);
    expect(res.metrics!.volume - EXPECTED).toBeGreaterThan(40);
  });

  it("natočení 7°: neplatné těleso se ohlásí u PRVNÍHO prvku, který ho způsobil; další prvky jen odkážou na původce", { timeout: 180_000 }, async () => {
    raw();
    const doc = dieDoc(7);
    const res = await build(doc);
    expect(res.metrics!.valid).toBe(false);
    // prvky před klínem jsou v pořádku
    for (const name of ["Deska", "Otvor skrz", "Kužel B"]) expect(statusOf(doc, res, name).warning).toBeUndefined();
    const st = statusOf(doc, res, "Klín 1");
    expect(st.ok).toBe(true);
    expect(st.warning).toMatch(/Výsledek má neplatnou geometrii – vznikla u prvku „Klín 1“/);
    expect(st.warning).toMatch(/Hrana E\d+ dlouhá 0,\d+ mm u bodu \[[^\]]+\] leží celá v toleranci svého vrcholu \(0,\d+ mm\)/);
    expect(st.warning).toMatch(/Co změnit: nechte profil plochu jasně protnout/);
    // původce se jmenuje jen jednou; prvky za ním na něj odkazují a žádný se za původce neoznačí sám
    expect(res.status.filter((s) => /vznikla u prvku/.test(s.warning ?? "")).length).toBe(1);
    for (const name of ["Kužel A", "Klín 2"]) {
      const later = statusOf(doc, res, name);
      expect(later.warning, name).toMatch(/Těleso je neplatné už od prvku „Klín 1“ – tento prvek na vadnou geometrii jen navazuje\. Opravte nejdřív prvek „Klín 1“\./);
      expect(later.warning, name).not.toMatch(/vznikla u prvku/);
    }
    expect(invalidSince(res.body)).toBe("Klín 1");
    // mikrohrana: celá uvnitř tolerancí svých vrcholů
    const micro = microEdges(res.body!);
    expect(micro.length).toBeGreaterThan(0);
    for (const m of micro) {
      expect(m.length).toBeLessThanOrEqual(m.tolerance);
      expect(m.length).toBeLessThan(0.05);
      expect(m.index).toBeGreaterThanOrEqual(0);
    }
    // nikdy ✓ u prvku, po kterém je těleso neplatné: stavba zkrácená po každém prvku je měřítko
    let firstInvalid = "";
    for (const i of solidSteps(doc)) {
      const part = await build({ ...doc, features: doc.features.slice(0, i + 1) });
      const last = part.status.find((s) => s.id === doc.features[i].id)!;
      const full = res.status.find((s) => s.id === doc.features[i].id)!;
      if (part.metrics!.valid === false) {
        firstInvalid ||= doc.features[i].name;
        expect(last.warning, `prvek ${doc.features[i].name}`).toMatch(/neplatnou geometrii|Těleso je neplatné už od prvku/);
        expect(full.warning, `prvek ${doc.features[i].name} v celé stavbě`).toMatch(/neplatnou geometrii|Těleso je neplatné už od prvku/);
      } else expect(last.warning, `prvek ${doc.features[i].name}`).toBeUndefined();
    }
    expect(firstInvalid).toBe("Klín 1");
  });

  it("stavba, která naváže na uložený stav (přidaný prvek), varování nepřesune: původce zůstává „Klín 1“", { timeout: 180_000 }, async () => {
    raw();
    const doc = dieDoc(7);
    const cut = doc.features.findIndex((f) => f.name === "Klín 1");
    clearBuildCache();
    // po částech, jak dokument vzniká v aplikaci: nejdřív po „Klín 1“, pak po „Kužel A“, pak celý – bez mazání mezipaměti
    const a = await buildDoc({ ...doc, features: doc.features.slice(0, cut + 1) });
    expect(statusOf(doc, a, "Klín 1").warning).toMatch(/vznikla u prvku „Klín 1“/);
    const upTo = doc.features.findIndex((f) => f.name === "Kužel A");
    const b = await buildDoc({ ...doc, features: doc.features.slice(0, upTo + 1) });
    expect(statusOf(doc, b, "Klín 1").warning).toMatch(/vznikla u prvku „Klín 1“/);
    expect(statusOf(doc, b, "Kužel A").warning).toMatch(/Těleso je neplatné už od prvku „Klín 1“/);
    const c = await buildDoc(doc);
    const fresh = await build(doc);
    expect(c.status.map((s) => s.warning ?? "")).toEqual(fresh.status.map((s) => s.warning ?? ""));
    expect(c.status.filter((s) => /vznikla u prvku/.test(s.warning ?? "")).map((s) => s.id)).toEqual([doc.features[cut].id]);
  });
});

describe("syntetická střižnice – přesně, s náhradou výsledků s příznakem vady (oprava)", () => {
  it.each([
    [7, 6, 5, 0.02, "přesně: neplatné těleso"],
    [20, 6, 5, 0.02, "přesně: klíny se neprovedou"],
    [33, 6, 5, 0.02, "přesně: neplatné těleso s mikrohranami"],
    [45, 6, 5, 0.02, "přesně: klíny se neprovedou"],
    [65, 6, 5, 0.02, "přesně: poslední klín vrátí prázdné těleso"],
    [69, 6, 5, 0.02, "přesně: poslední klín skončí chybou jádra"],
    [88, 6, 5, 0.03, "přesně: těleso zanikne"],
    [20, 5, 5, 0.03, "hrubší zaokrouhlení vektorů"],
    [65, 5, 5, 0.03, "hrubší zaokrouhlení vektorů"],
    [86, 5, 5, 0.03, "výsledky s tolerancí se liší o 0,15 % – platí ten bližší průniku"],
    [25, 4, 4, 0.2, "4 místa: přesně platné; tolerance u každé operace dávala neplatné těleso"],
    [40, 4, 4, 0.2, "4 místa: přesně platné; tolerance u každé operace dávala neplatné těleso"],
    [11, 4, 4, 0.2, "4 místa: tolerance u každé operace klín vynechala"],
    [13, 4, 4, 0.2, "4 místa: přesně se kužel neprovede (chybí 13,7 mm³)"],
  ])("natočení %i° (%i / %i desetinných míst, objem do %f mm³; %s): všechny prvky ✓, platné těleso", { timeout: 120_000 }, async (angle, dec, odec, tol) => {
    const doc = dieDoc(angle, dec, odec);
    const res = await build(doc);
    expect(notOk(res)).toEqual([]);
    expect(res.metrics!.valid).toBe(true);
    expect(res.metrics!.solids).toBe(1);
    expect(Math.abs(res.metrics!.volume - EXPECTED)).toBeLessThan(tol);
    // těleso je zdravé i jinak: žádná hrana se čtyřmi stranami ploch
    expect(manifoldEdges(res.body!)).toBe(true);
  });

  it("přesně platný díl se nemění: bez příznaku vady se žádná operace neopakuje", { timeout: 120_000 }, async () => {
    const before = { ...boolStats };
    const res = await build(dieDoc(20, 15, 15));
    expect(notOk(res)).toEqual([]);
    expect(res.metrics!.valid).toBe(true);
    // ruční výpočet objemu sedí s přesně zadaným dílem
    expect(Math.abs(res.metrics!.volume - EXPECTED)).toBeLessThan(0.002);
    expect(boolStats.retries).toBe(before.retries);
    expect(maxVertexTolerance(res.body!)).toBeLessThan(5e-4);
  });

  it("mez opravy (natočení 22°, 6 / 5 míst): kužel, který jádro neprovede přesně ani s tolerancí, dostane ⚠ – nikdy tiché ✓", { timeout: 120_000 }, async () => {
    const doc = dieDoc(22);
    const res = await build(doc);
    expect(res.metrics!.valid).toBe(true);
    expect(marks(res)).toBe("✓✓✓✓✓✓✓✓⚠✓✓");
    expect(statusOf(doc, res, "Kužel A").warning).toMatch(/Prvek objem tělesa nezměnil \(jen rozdělil plochy\).*nebo jádro operaci u téměř tečných ploch neprovedlo/);
    // chybí právě objem toho kužele; ostatní prvky sedí
    expect(res.metrics!.volume - EXPECTED).toBeGreaterThan(13);
    expect(res.metrics!.volume - EXPECTED).toBeLessThan(14.5);
  });

  it("mikrohrany: čisté těleso žádné nemá", { timeout: 60_000 }, async () => {
    const res = await build({ ...emptyDoc("Kvádr"), features: [{ id: "b", name: "Kvádr", type: "box", size: [10, 20, 30], position: [0, 0, 0], centered: false, mode: "new" }] });
    expect(microEdges(res.body!)).toEqual([]);
    expect(manifoldEdges(res.body!)).toBe(true);
  });
});

// ── skoro-dotyky, které přesně vycházejí, se nesmějí změnit (tolerance u každé operace je kazila) ──
let n = 0;
const id = () => `h${++n}`;
const plate = (size: Vec3): Feature => ({ id: id(), name: "Deska", type: "box", size, position: [0, 0, 0], centered: false, mode: "new" });
const boxF = (name: string, size: Vec3, position: Vec3, mode: "cut" | "add"): Feature => ({ id: id(), name, type: "box", size, position, centered: false, mode });
const cyl = (name: string, radius: number, height: number, position: Vec3, axis: "X" | "Y" | "Z", mode: "cut" | "add" = "cut"): Feature => ({ id: id(), name, type: "cylinder", radius, height, position, axis, mode });
const part = (features: Feature[]): CadDoc => ({ ...emptyDoc("Skoro-dotyk"), features });

describe("skoro-dotyk se nezaokrouhluje", () => {
  it("dvě díry Ø10 s přesahem 1e-5 mm (rozteč 9,99999): platné těleso, přesný objem, hned", { timeout: 120_000 }, async () => {
    const doc = part([plate([60, 40, 10]), cyl("Díra 1", 5, 12, [20, 20, -1], "Z"), cyl("Díra 2", 5, 12, [29.99999, 20, -1], "Z")]);
    const t0 = Date.now();
    const res = await build(doc);
    expect(marks(res)).toBe("✓✓✓");
    expect(res.metrics!.valid).toBe(true);
    expect(res.metrics!.solids).toBe(1);
    // dvě kruhové úseče se překrývají čočkou širokou 1e-5 mm – objem na 1e-4 mm³
    expect(Math.abs(res.metrics!.volume - (24000 - 2 * Math.PI * 25 * 10))).toBeLessThan(1e-4);
    expect(maxVertexTolerance(res.body!)).toBeLessThan(1e-6);
    expect(manifoldEdges(res.body!)).toBe(true);
    // síť zobrazení pokrývá celé těleso (objem sítě se od tělesa liší jen tětivami oblouků)
    expect(meshVolume(res)).toBeGreaterThan(res.metrics!.volume);
    expect(meshVolume(res) - res.metrics!.volume).toBeLessThan(5);
    expect(Date.now() - t0).toBeLessThan(20_000); // s tolerancí u každé operace 37 s a neplatné těleso
  });

  it("čtyři takové díry v řadě a díra dál od nich: platné, všechny ✓ (s tolerancí se stavba nedopočítala)", { timeout: 120_000 }, async () => {
    const holes = [0, 1, 2, 3].map((i) => cyl(`Díra ${i + 1}`, 5, 12, [10 + i * 9.99999, 20, -1], "Z"));
    const doc = part([plate([60, 40, 10]), ...holes, cyl("Díra dál", 3, 12, [50, 8, -1], "Z")]);
    const res = await build(doc);
    expect(marks(res)).toBe("✓✓✓✓✓✓");
    expect(res.metrics!.valid).toBe(true);
    expect(Math.abs(res.metrics!.volume - (24000 - 4 * Math.PI * 25 * 10 - Math.PI * 9 * 10))).toBeLessThan(1e-3);
  });

  it("proč tolerance není u každé operace: s ní se obě díry spojí v jedné hraně se čtyřmi stranami ploch", { timeout: 60_000 }, () => {
    const first = (r.makeBox([0, 0, 0], [60, 40, 10]) as r.Shape3D).cut(r.makeCylinder(5, 12, [20, 20, -1], [0, 0, 1])) as r.Shape3D;
    const second = r.makeCylinder(5, 12, [29.99999, 20, -1], [0, 0, 1]) as r.Shape3D;
    const exact = booleanOnce("Cut", first, [second]);
    expect(manifoldEdges(exact)).toBe(true);
    expect(maxVertexTolerance(exact)).toBeLessThan(1e-6);
    const fuzzy = booleanOnce("Cut", first, [second], 1e-5);
    expect(manifoldEdges(fuzzy)).toBe(false);
    expect(maxVertexTolerance(fuzzy)).toBeGreaterThan(5e-4);
  });

  it("kanál Ø8 podél Y, který prorazí horní plochu o 1e-5 mm: přesný objem, otevřený, další prvek na něm funguje", { timeout: 120_000 }, async () => {
    const channel = cyl("Kanál", 4, 42, [30, -1, 16.00001], "Y");
    const doc = part([plate([60, 40, 20]), channel]);
    const res = await build(doc);
    expect(marks(res)).toBe("✓✓");
    expect(res.metrics!.valid).toBe(true);
    expect(Math.abs(res.metrics!.volume - (48000 - Math.PI * 16 * 40))).toBeLessThan(1e-4);
    expect(manifoldEdges(res.body!)).toBe(true);
    // čela desky (y = 0 a y = 40) mají v síti celou plochu: 60 × 20 bez kruhu Ø8
    const ends = res.body!.faces.map((f, i) => ({ i, y: f.center.y, flat: f.geomType === "PLANE" && Math.abs(Math.abs(f.normalAt(f.center).y) - 1) < 1e-9 })).filter((f) => f.flat);
    expect(ends.length).toBe(2);
    for (const e of ends) expect(meshArea(res, e.i)).toBeGreaterThan(0.99 * (1200 - Math.PI * 16));
    // sražení všech hran 1 mm (s tolerancí u každé operace končilo chybou)
    const chamfer: Feature = { id: id(), name: "Sražení", type: "chamfer", distance: 1, edges: "all" };
    const next = await build(part([...doc.features, chamfer]));
    expect(marks(next)).toBe("✓✓✓");
    expect(next.metrics!.valid).toBe(true);
    // přes STEP: jedno těleso se stejným objemem
    const back = (await r.importSTEP(res.body!.blobSTEP())) as r.Shape3D;
    expect(back.solids.length).toBe(1);
    expect(Math.abs(r.measureVolume(back) - res.metrics!.volume)).toBeLessThan(1e-3);
  });

  it("zkrutná pružina z knihovny: ramena se spojí se závity stejně jako bez opravy", { timeout: 240_000 }, async () => {
    const f = familyById("springTorsion")!;
    // výchozí rozměr (d2 D16 n5): jedno těleso
    const a = await build(f.make(withDefaults(f, {})));
    expect(a.status.every((s) => s.ok && !s.warning)).toBe(true);
    expect(a.metrics!.solids).toBe(1);
    expect(a.metrics!.volume).toBeCloseTo(867.589, 2);
    // d3 D24 n3: s tolerancí u každé operace zbylo jen jedno rameno (212 mm³)
    const b = await build(f.make(withDefaults(f, { d: 3, D: 24, n: 3 })));
    expect(b.status.every((s) => s.ok && !s.warning)).toBe(true);
    expect(b.metrics!.volume).toBeCloseTo(1816.84, 1);
  });

  // vlna 22 (bod 22a, G2): řez se provede a těleso je platné (smysl testu z vlny 17), ale tečná špička je skrytý kanál ve stěně –
  // prvek je ⚠ thread.tip-tangent, ne ✓ (stejný případ jako kernel-check.test.ts „špička profilu tečná k povrchu…“)
  it("závit tažený po šroubovici, špička profilu tečná k povrchu trubky: řez se provede (34 886,36 mm³), prvek ⚠ thread.tip-tangent", { timeout: 180_000 }, async () => {
    const tube: Feature = { id: id(), name: "Trubka", type: "tube", outer: 42, inner: 16.4, height: 30, position: [0, 0, 0], axis: "Z", mode: "new" };
    const doc: CadDoc = { ...emptyDoc("Test"), features: [tube] };
    const thr = newExtFeature(doc, "surf.helixSweep");
    if (thr.type === "ext") thr.data = { ...thr.data, profile: "thread60", depth: 0.8, radius: 9, pitch: 1.5, turns: 12, position: [0, 0, 5], axis: "Z", mode: "cut" };
    const res = await build({ ...doc, features: [tube, thr] });
    expect(marks(res)).toBe("✓⚠");
    expect(res.status[1].warnCode).toBe("thread.tip-tangent");
    expect(res.metrics!.valid).toBe(true);
    expect(res.metrics!.volume).toBeCloseTo(34886.358, 1);
  });

  it("malý, ale skutečný úběr / přídavek na velkém tělese je ✓ – varování „objem nezměnil“ by bylo nepravdivé", { timeout: 180_000 }, async () => {
    const block = () => plate([400, 400, 250]);
    const V = 400 * 400 * 250;
    // ryska 2 × 0,1 × 0,2 zapuštěná 0,1 mm: ubere 0,02 mm³ ze 40 milionů
    const scribe = await build(part([block(), boxF("Ryska", [2, 0.1, 0.2], [100, 100, 249.9], "cut")]));
    expect(marks(scribe)).toBe("✓✓");
    expect(scribe.metrics!.volume).toBeCloseTo(V - 0.02, 4);
    // důlek kuželem a podložka 1 × 1 × 0,03
    const mark: Feature = { id: id(), name: "Důlek", type: "cone", radius1: 0.0001, radius2: 0.25, height: 0.25, position: [200, 200, 249.75], axis: "Z", mode: "cut" };
    expect(marks(await build(part([block(), mark])))).toBe("✓✓");
    expect(marks(await build(part([block(), boxF("Podložka", [1, 1, 0.03], [10, 10, 250], "add")])))).toBe("✓✓");
    // koule R5 zanořená 0,001 mm do desky: ubere 1,6e-5 mm³ – nástroj je 30milionkrát větší než úběr, ale do tělesa zasahuje
    const dip: Feature = { id: id(), name: "Koule", type: "sphere", radius: 5, position: [30, 20, 14.999], mode: "cut" };
    const dipped = await build(part([plate([60, 40, 10]), dip]));
    expect(marks(dipped)).toBe("✓✓");
    expect(24000 - dipped.metrics!.volume).toBeGreaterThan(1e-5);
  });

  it("nástroj, který se tělesa jen dotýká, dál dostane ⚠ (nic neubral)", { timeout: 120_000 }, async () => {
    const res = await build(part([plate([60, 40, 10]), boxF("Vedle", [10, 10, 5], [25, 15, 10], "cut")]));
    expect(marks(res)).toBe("✓⚠");
    expect(res.status[1].warning).toMatch(/nezměnil/);
    expect(res.metrics!.volume).toBeCloseTo(24000, 6);
  });
});

/** objem sítě zobrazení (součet čtyřstěnů k počátku) */
function meshVolume(res: Built): number {
  const m = res.mesh!;
  let v = 0;
  for (let i = 0; i < m.triangles.length; i += 3) {
    const a = m.triangles[i] * 3;
    const b = m.triangles[i + 1] * 3;
    const c = m.triangles[i + 2] * 3;
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [m.vertices[a], m.vertices[a + 1], m.vertices[a + 2], m.vertices[b], m.vertices[b + 1], m.vertices[b + 2], m.vertices[c], m.vertices[c + 1], m.vertices[c + 2]];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}
/** plocha sítě jedné plochy tělesa (skupiny sítě: začátek, počet, index plochy) */
function meshArea(res: Built, face: number): number {
  const m = res.mesh!;
  let area = 0;
  for (let k = 0; k + 2 < m.faceGroups.length; k += 3) {
    if (m.faceGroups[k + 2] !== face) continue;
    for (let i = m.faceGroups[k]; i + 2 < m.faceGroups[k] + m.faceGroups[k + 1]; i += 3) {
      const a = m.triangles[i] * 3;
      const b = m.triangles[i + 1] * 3;
      const c = m.triangles[i + 2] * 3;
      const u = [m.vertices[b] - m.vertices[a], m.vertices[b + 1] - m.vertices[a + 1], m.vertices[b + 2] - m.vertices[a + 2]];
      const w = [m.vertices[c] - m.vertices[a], m.vertices[c + 1] - m.vertices[a + 1], m.vertices[c + 2] - m.vertices[a + 2]];
      area += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
    }
  }
  return area;
}

describe("neplatné těleso bez varování u prvku – doplnění", () => {
  type Fake = { bad?: boolean };
  const shape = (bad: boolean) => ({ bad }) as unknown as r.Shape3D;
  const isValid = (s: r.Shape3D) => !(s as unknown as Fake).bad;
  const features = [
    { id: "a", name: "Kvádr", type: "box" },
    { id: "s", name: "Skica", type: "sketch" },
    { id: "b", name: "Vysunutí 1", type: "extrude" },
    { id: "c", name: "Vysunutí 2", type: "extrude" },
    { id: "s2", name: "Skica 2", type: "sketch" },
    { id: "d", name: "Zaoblení", type: "fillet" },
    { id: "e", name: "Díra", type: "hole", suppressed: true },
  ] as Pick<Feature, "id" | "name" | "type" | "suppressed">[];
  const fresh = (): FeatureStatus[] => features.map((f) => ({ id: f.id, ok: true }));
  const warningOf = (list: FeatureStatus[], fid: string) => list.find((s) => s.id === fid)!.warning;

  it("najde první uložený stav, po kterém je těleso neplatné: původce dostane varování, prvky za ním odkaz na něj", () => {
    const status = fresh();
    const steps = [1, 2, 3, 4, 5, 6, 7].map((k) => ({ n: k, shapes: [shape(k >= 4)], status: fresh().slice(0, k) }));
    const hit = flagInvalidBody(features, status, steps, isValid);
    expect(hit?.id).toBe("c");
    expect(warningOf(status, "c")).toMatch(/Výsledek má neplatnou geometrii – vznikla u prvku „Vysunutí 2“/);
    expect(warningOf(status, "d")).toMatch(/^Těleso je neplatné už od prvku „Vysunutí 2“/);
    // prvky před původcem, skica a potlačený prvek varování nedostanou
    for (const fid of ["a", "s", "b", "s2", "e"]) expect(warningOf(status, fid), fid).toBeUndefined();
    // uložené stavy stavby nesou totéž (stavba, která na ně naváže, varování neztratí) a jejich tělesa znají původce
    for (const st of steps) {
      if (st.n >= 4) {
        expect(warningOf(st.status, "c")).toBe(warningOf(status, "c"));
        expect(invalidSince(st.shapes[0])).toBe("Vysunutí 2");
      } else {
        expect(st.status.some((x) => x.warning)).toBe(false);
        expect(invalidSince(st.shapes[0])).toBeUndefined();
      }
      if (st.n >= 6) expect(warningOf(st.status, "d")).toBe(warningOf(status, "d"));
    }
    // podruhé už nic nepřidá
    const again = JSON.stringify(status);
    expect(flagInvalidBody(features, status, steps, isValid)).toBeNull();
    expect(JSON.stringify(status)).toBe(again);
  });

  it("bez uložených stavů varuje u posledního prvku, který těleso mění; hotové varování nezdvojí", () => {
    const status = fresh();
    expect(flagInvalidBody(features, status, [], isValid)?.id).toBe("e");
    const noted = fresh();
    noted[2].warning = "Výsledek má neplatnou geometrii – vznikla u prvku „Vysunutí 1“; …";
    expect(flagInvalidBody(features, noted, [{ n: 7, shapes: [shape(true)] }], isValid)).toBeNull();
    // prvek s chybou varování nedostane – přejde se na předchozí
    const failed = fresh();
    failed[6] = { id: "e", ok: false, error: "x" };
    expect(flagInvalidBody(features, failed, [], isValid)?.id).toBe("d");
  });
});

// ── skutečný nástroj (zákaznická data – soubor není v repozitáři, bez něj se test přeskočí) ──
const FIXTURE = process.env.CAD_FIXTURE_959 || path.resolve(__dirname, "../../.local/fixtures/959-dokument.json");
describe.skipIf(!fs.existsSync(FIXTURE))("skutečný nástroj 959 (jen se souborem zákazníka)", () => {
  it("27 z 27 dílů platných, žádné ⚠ ani ✗, Σ objem 5241,734 cm³ ± 0,01; střižnice 450,460 cm³ ± 0,001", { timeout: 600_000 }, async () => {
    const doc = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as CadDoc;
    const parts = new Map<string, { doc: CadDoc; count: number }>();
    for (const c of doc.components ?? []) {
      if (c.source.kind !== "part") continue;
      const key = JSON.stringify(c.source.doc.features);
      const hit = parts.get(key);
      if (hit) hit.count++;
      else parts.set(key, { doc: c.source.doc, count: 1 });
    }
    expect(parts.size).toBe(27);
    let sum = 0;
    let valid = 0;
    const notOk: string[] = [];
    let most = { features: 0, volume: 0 };
    for (const p of parts.values()) {
      const res = await build(p.doc);
      if (res.metrics?.valid) valid++;
      for (const s of res.status) if (!s.ok || s.warning) notOk.push(`${p.doc.features.findIndex((f) => f.id === s.id) + 1}: ${s.error ?? s.warning}`);
      sum += (res.metrics?.volume ?? 0) * p.count;
      if (p.doc.features.length > most.features) most = { features: p.doc.features.length, volume: res.metrics?.volume ?? 0 };
    }
    expect(notOk).toEqual([]);
    expect(valid).toBe(27);
    expect(Math.abs(sum / 1000 - 5241.734)).toBeLessThan(0.01);
    // díl s nejdelší historií = střižnice (49 prvků)
    expect(most.features).toBe(49);
    expect(Math.abs(most.volume / 1000 - 450.46)).toBeLessThan(0.001);
  });
});
