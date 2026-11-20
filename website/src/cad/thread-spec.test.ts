/**
 * Jedna cesta k závitu (vlna 22, bod 22d) – bez jádra: označení s mezerami, ISO 261, čísla šroubovice z katalogu, jednotný
 * pohled na závit (prvek Závit i Tažení po šroubovici s označením) pro výkres a kolize, text CS/EN/DE a převod do skriptu tam
 * a zpět. Geometrie (objemy proti ručnímu výpočtu, přesná BRepCheck) je v w22/thread-g2.test.ts.
 */
import { describe, expect, it } from "vitest";
import { parseAgentText, type AgentOp } from "./agent";
import { screwOf, threadBand, threadHoles } from "./clash-thread";
import { tappedFeatures } from "./clash-class";
import { threadByName } from "./defaults";
import { docToScript } from "./doc-script";
import { threadsOfDoc } from "./drawing-doc";
import { setLang } from "./i18n";
import { H1, H3, helixThreadDims, isIsoPitch, mergeThreadText, mergeThreadTokens, pitchNote, threadOfFeature } from "./thread-spec";
import type { AsmComponent, CadDoc, Feature } from "./types";
import "./ext/index";
import "./feat/index";

const part = (name: string, features: Feature[]): CadDoc => ({ app: "mnastrojarna-cad", version: 2, name, material: "ocel", kind: "part", features });
const featsOf = (text: string): Feature[] => {
  const p = parseAgentText(text);
  expect(p.errors.map((e) => `${e.line}: ${e.message}`)).toEqual([]);
  return (p.ops as AgentOp[]).flatMap((o) => (o.k === "feature" || o.k === "select" ? [o.feature] : o.k === "features" ? o.features : []));
};

describe("označení závitu s mezerami („m18 x 1,5“) – jedno slovo", () => {
  it("mergeThreadTokens: × / x / X, mezery kolem oddělovače, čárka i tečka; ostatní slova beze změny", () => {
    expect(mergeThreadTokens(["m18", "x", "1,5", "délka", "10"])).toEqual(["m18×1,5", "délka", "10"]);
    expect(mergeThreadTokens(["M18", "×", "1.5"])).toEqual(["M18×1.5"]);
    expect(mergeThreadTokens(["M18", "X", "1.5"])).toEqual(["M18×1.5"]);
    expect(mergeThreadTokens(["M18", "×1,5"])).toEqual(["M18×1,5"]);
    expect(mergeThreadTokens(["M18×", "1,5"])).toEqual(["M18×1,5"]);
    expect(mergeThreadTokens(["thread=M18", "x", "1.5"])).toEqual(["thread=M18×1.5"]);
    expect(mergeThreadTokens(["M18", "délka", "20"])).toEqual(["M18", "délka", "20"]);
    expect(mergeThreadTokens(["kvádr", "10", "x", "20"])).toEqual(["kvádr", "10", "x", "20"]); // „x“ mimo označení zůstane
    expect(mergeThreadText(" profile=thread60 thread=M18 x 1,5 side=internal")).toBe(" profile=thread60 thread=M18×1,5 side=internal");
  });
  it("text CS / EN / DE: závit, díra se závitem i thread= u Tažení po šroubovici", () => {
    for (const [line, exp] of [
      ["závit m18 x 1,5 délka 10 v 0 0 15", "M18×1,5"],
      ["závit M18 × 1.5 délka 10", "M18×1,5"],
      ["thread m18 X 1.5 length 10 at 0 0 5", "M18×1,5"],
      ["gewinde M18 x 1,5 länge 10 bei 0 0 5", "M18×1,5"],
    ] as const) {
      const f = featsOf(line)[0];
      expect(f.type === "thread" && f.designation, line).toBe(exp);
    }
    const h = featsOf("díra závit m18 x 1,5 hloubka 15 v 20 20")[0];
    expect(h.type === "hole" && h.thread).toBe("M18×1,5");
    expect(h.type === "hole" && h.diameter).toBeCloseTo(16.5, 6);
    const s = featsOf("prvek surf.helixSweep profile=thread60 thread=M18 x 1,5 side=internal turns=12 mode=cut")[0];
    expect(s.type === "ext" && s.data.thread).toBe("M18×1,5");
  });
  it("„šroubovice“ / helix / Schraubenlinie = modelovaný závit se skutečnou šroubovicí; bez volby kosmetický, „modelovat“ = drážky", () => {
    const g = (line: string) => featsOf(line)[0] as Extract<Feature, { type: "thread" }>;
    expect(g("závit M18×1,5 délka 20 šroubovice")).toMatchObject({ modeled: true, helix: true });
    expect(g("thread M18x1.5 length 20 internal helix")).toMatchObject({ modeled: true, helix: true, internal: true });
    expect(g("gewinde M18x1,5 länge 20 schraubenlinie")).toMatchObject({ modeled: true, helix: true });
    expect(g("závit M18×1,5 délka 20 modelovat").helix).toBeUndefined();
    expect(g("závit M18×1,5 délka 20")).toMatchObject({ modeled: false });
  });
});

describe("ISO 261 – stoupání mimo řadu je ⚠, ne ticho", () => {
  it("řada M18 = 2,5 / 2 / 1,5 / 1; M18×3 a M18×1,25 dostanou hlášku, katalogové ne", () => {
    expect(isIsoPitch(18, 1.5)).toBe(true);
    expect(isIsoPitch(18, 1)).toBe(true);
    expect(isIsoPitch(18, 3)).toBe(false);
    setLang("cs");
    expect(pitchNote(threadByName("M18×1,5"))).toBeNull();
    expect(pitchNote(threadByName("M18"))).toBeNull();
    expect(pitchNote(threadByName("M10×1,25"))).toBeNull();
    expect(pitchNote(threadByName("M18x3"))).toBe("stoupání 3 mm není pro M18 v ISO 261 (řada: 2,5 / 2 / 1,5 / 1) – závit M18×3 se postaví, ale je nestandardní (nástroj, kalibr a protikus nejsou běžné).");
    expect(pitchNote(threadByName("M18x1.25"))).toMatch(/^stoupání 1,25 mm není pro M18 v ISO 261/);
    setLang("en");
    expect(pitchNote(threadByName("M18x3"))).toMatch(/^pitch 3 mm is not in ISO 261 for M18 \(series: 2\.5 \/ 2 \/ 1\.5 \/ 1\)/);
    setLang("cs");
  });
});

describe("čísla šroubovice z označení (sdílí prvek Závit i Tažení po šroubovici)", () => {
  it("vnější: povrch d/2, hloubka h3 = 0,6134·P; vnitřní: povrch D1/2, hloubka H1 – špička na d/2", () => {
    const t = threadByName("M18×1,5")!;
    expect(helixThreadDims(t, false)).toEqual({ radius: 9, depth: Math.round(H3 * 1.5 * 1e6) / 1e6, pitch: 1.5 });
    const i = helixThreadDims(t, true);
    expect(i.radius).toBeCloseTo((18 - 1.082532 * 1.5) / 2, 5); // 8,188
    expect(i.radius + i.depth).toBeCloseTo(9, 6);
    expect(i.depth).toBeCloseTo(H1 * 1.5, 3);
    // vrtaná díra Ø16,5 (vrták závitu) leží mezi povrchem drážky a špičkou → drážka ji protne
    expect(i.radius).toBeLessThan(t.tap / 2);
    expect(i.radius + i.depth).toBeGreaterThan(t.tap / 2);
  });
});

describe("jednotný pohled na závit: výkres a kolize poznají šroubovici z označení stejně jako prstence", () => {
  const thr = (extra: Partial<Extract<Feature, { type: "thread" }>>): Feature => ({ id: "t", name: "Závit 1", type: "thread", designation: "M18×1,5", position: [0, 0, 0], axis: "Z", length: 18, modeled: true, internal: true, ...extra }) as Feature;
  const sweep: Feature = { id: "s", name: "Tažení po šroubovici", type: "ext", ext: "surf.helixSweep", data: { profile: "thread60", thread: "M18×1,5", side: "internal", turns: 12, position: [0, 0, 0], axis: { kind: "axis", axis: "Z" }, mode: "cut" } };
  it("threadOfFeature: Závit (drážky / šroubovice) i Tažení po šroubovici s thread= → totéž označení, strana, délka, osa", () => {
    expect(threadOfFeature(thr({}))).toMatchObject({ designation: "M18×1,5", internal: true, length: 18, geometry: "rings", source: "thread" });
    expect(threadOfFeature(thr({ helix: true }))).toMatchObject({ geometry: "helix" });
    expect(threadOfFeature(sweep)).toMatchObject({ designation: "M18×1,5", internal: true, length: 18, geometry: "helix", source: "helixSweep", dirDef: { kind: "axis", axis: "Z" } });
    expect(threadOfFeature({ ...sweep, data: { ...(sweep as Extract<Feature, { type: "ext" }>).data, thread: undefined } } as Feature)).toBeNull(); // bez označení = odvozené z čísel (drawing-doc)
    expect(threadOfFeature({ ...thr({}), suppressed: true } as Feature)).toBeNull();
  });
  it("výkres: označení „M18×1,5 dl. 18“ na kružnici díry vrtáku – šroubovice z označení stejně jako prstence", () => {
    const tube: Feature = { id: "b", name: "Trubka", type: "tube", outer: 30, inner: 16.5, height: 20, position: [0, 0, 0], axis: "Z", mode: "new" };
    const rings = threadsOfDoc(part("A", [tube, thr({})]));
    expect(threadsOfDoc(part("B", [tube, thr({ helix: true })]))).toEqual(rings);
    expect(threadsOfDoc(part("C", [tube, sweep]))).toEqual(rings);
    expect(rings).toEqual([{ r: 8.25, label: "M18×1,5 dl. 18" }]);
  });
  it("kolize: šroub M18 a matice se šroubovicí z označení – stejné pásmo závitu i osa jako u prstenců", () => {
    const tube: Feature = { id: "b", name: "Trubka", type: "tube", outer: 30, inner: 16.5, height: 20, position: [0, 0, 0], axis: "Z", mode: "new" };
    const comp = (doc: CadDoc): AsmComponent => ({ id: doc.name, name: doc.name, source: { kind: "part", doc }, position: [0, 0, 0], rotation: [0, 0, 0] }) as unknown as AsmComponent;
    const band = threadBand(comp(part("A", [tube, thr({})])), 18, 20);
    expect(band).toBeGreaterThan(0);
    expect(threadBand(comp(part("B", [tube, sweep])), 18, 20)).toBeCloseTo(band, 6);
    expect(threadHoles(comp(part("B", [tube, sweep])), 18)[0].line).toEqual({ p: [0, 0, 0], d: [0, 0, 1] });
    const bolt: Feature = { id: "v", name: "Válec", type: "cylinder", radius: 9, height: 30, position: [0, 0, 0], axis: "Z", mode: "new" };
    const ext: Feature = { ...sweep, id: "e", data: { ...(sweep as Extract<Feature, { type: "ext" }>).data, side: "external" } } as Feature;
    expect(screwOf(comp(part("Čep", [bolt, ext])))).toEqual({ d: 18, length: 18 });
    const tapped = tappedFeatures(part("B", [tube, sweep]));
    expect(tapped).toEqual([{ id: "s", name: "Tažení po šroubovici", designation: "M18×1,5", D: 18, drillR: null, dir: [0, 0, 1], points: [[0, 0, 0]] }]);
  });
});

describe("dokument → skript → dokument (doc-script.ts)", () => {
  it("závit se šroubovicí a Tažení po šroubovici s thread= projdou tam a zpět v CS / EN / DE", () => {
    const tube: Feature = { id: "b", name: "Trubka 1", type: "tube", outer: 30, inner: 16.5, height: 20, position: [0, 0, 0], axis: "Z", mode: "new" };
    const doc = part("Matice", [tube, { id: "t", name: "Závit 1", type: "thread", designation: "M18×1,5", position: [0, 0, 0], axis: "Z", length: 18, modeled: true, internal: true, helix: true }, { id: "s", name: "Tažení po šroubovici", type: "ext", ext: "surf.helixSweep", data: { profile: "thread60", thread: "M18×1,5", side: "internal", turns: 12, position: [0, 0, 0], axis: { kind: "axis", axis: "Z" }, mode: "cut" } }]);
    for (const lang of ["cs", "en", "de"] as const) {
      const text = docToScript(doc, { lang }).text;
      expect(text, lang).toMatch(lang === "cs" ? /šroubovice/ : lang === "en" ? /helix/ : /schraubenlinie/);
      const back = featsOf(text);
      const t = back.find((f) => f.type === "thread") as Extract<Feature, { type: "thread" }>;
      expect(t, lang).toMatchObject({ designation: "M18×1,5", modeled: true, helix: true, internal: true, length: 18 });
      const s = back.find((f) => f.type === "ext") as Extract<Feature, { type: "ext" }>;
      expect(s.data.thread, lang).toBe("M18×1,5");
      expect(threadOfFeature(s), lang).toMatchObject({ designation: "M18×1,5", internal: true });
    }
  });
});
