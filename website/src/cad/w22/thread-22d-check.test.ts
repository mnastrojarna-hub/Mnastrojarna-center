/**
 * Vlna 22, bod 22d (fáze 2): Tažení po šroubovici s katalogovým označením (`thread=M18×1,5`) je závit i pro kontrolu dílu
 * (tabulka děr), kontrolu kót a kóty výkresu – stejně jako prvek Závit. Dřív kontrola u matice se závitem šroubovicí vypsala
 * „hole d=16.5 through=1 cbore=16.5x19.576“: bez thread= a s nesmyslným zahloubením (drážka šroubovice dělí válcovou plochu
 * díry na kusy téhož průměru, které se četly jako zahloubení).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { expectedDims } from "../dim-check";
import { setLang } from "../i18n";
import type { EngineHost } from "../engine/host";
import { holeTable } from "../engine/check";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { finalizeReport } from "../engine/protocol";
import { runReport } from "../engine/run-protocol";
import type { MeasureCyl } from "../measure";
import { emptyDoc, type CadDoc, type Feature } from "../types";
import { realHost } from "./real-host";
import { getExt } from "../ext/registry";
import "../ext/surface";

let host: () => EngineHost;
beforeAll(async () => {
  setLang("cs");
  host = await realHost();
}, 120_000);

const run = async (text: string) => finalizeReport(await runReport(new MemoryWorkspace(), text, host(), { lang: "cs" }), { full: true });
const helix = (data: Record<string, unknown>): Feature => ({ id: "h1", type: "ext", ext: "surf.helixSweep", name: "Tažení po šroubovici 1", data } as unknown as Feature);

describe("22d: Tažení po šroubovici s thread= je závit v kontrole dílu, kontrole kót a výkresu", () => {
  it("kontrola matice: díra Ø16,5 s thread=M18x1.5 tdepth=18, bez nesmyslného zahloubení (repro „Matice B“)", { timeout: 240_000 }, async () => {
    const r = await run('nový díl "Matice B"\ntrubka 30 16.5 20\nprvek surf.helixSweep profile=thread60 thread=M18 x 1,5 side=internal turns=12 mode=cut\nkontrola');
    const holes = (r.full ?? "").split("\n").filter((l) => /^\s*hole d=/.test(l));
    expect(holes, r.full).toHaveLength(1);
    expect(holes[0]).toMatch(/^ {2}hole d=16\.5 through=1 thread=M18x1\.5 tdepth=18 n=1 /);
    expect(holes[0]).not.toMatch(/cbore=/);
  });

  it("tabulka děr (čistá funkce): úseky téhož průměru nejsou zahloubení; větší průměr ano", () => {
    const seg = (from: [number, number, number], to: [number, number, number], diameter: number): MeasureCyl => ({ from, to, diameter, axis: [0, 0, 1], drill: [0, 0, -1], entry: from, through: true, length: Math.abs(to[2] - from[2]) } as unknown as MeasureCyl);
    const doc: CadDoc = { ...emptyDoc(), features: [helix({ profile: "thread60", thread: "M18×1,5", side: "internal", turns: 12, mode: "cut" })] };
    // díra Ø16,5 rozdělená drážkou na dva kusy téhož průměru
    const same = holeTable(doc, [seg([0, 0, 20], [0, 0, 10], 16.5), seg([0, 0, 10.2], [0, 0, 0], 16.5)]).holes;
    expect(same).toHaveLength(1);
    expect(same[0].cbore).toBeUndefined();
    expect(same[0]).toMatchObject({ d: 16.5, through: true, thread: "M18×1,5", threadDepth: 18 });
    // skutečné zahloubení (větší průměr) zůstává
    const cb = holeTable({ ...emptyDoc(), features: [] }, [seg([0, 0, 20], [0, 0, 14], 18), seg([0, 0, 14], [0, 0, 0], 11)]).holes;
    expect(cb[0].cbore).toEqual([18, 6]);
  });

  it("kontrola kót: očekávaný závit z označení M18×1,5 i bez čísel poloměru / stoupání (doplní je až stavba)", () => {
    const doc: CadDoc = { ...emptyDoc(), features: [helix({ profile: "thread60", thread: "M18×1,5", side: "external", turns: 10, mode: "cut" })] };
    const th = expectedDims(doc, null).filter((e) => e.kind === "thread");
    expect(th).toHaveLength(1);
    expect(th[0].value).toBe(18);
    expect(th[0].label).toMatch(/^M18×1,5/);
  });

  it("kolo 6: popisky kontroly kót v jazyce běhu – EN bez „délka“, „hl.“, „skrz“, „dl.“ (dřív natvrdo česky mimo tr())", () => {
    const thread: Feature = { id: "t1", type: "thread", name: "Thread 1", designation: "M18×1,5", length: 18 } as unknown as Feature;
    const legacy = helix({ profile: "thread60", radius: 10, pitch: 1.5, depth: 0.9, side: "external", turns: 10, mode: "cut" });
    const holes: Feature[] = [
      { id: "d1", type: "hole", name: "Hole 1", diameter: 8, depth: 0, through: true, position: [0, 0, 10], axis: "Z" } as unknown as Feature,
      { id: "d2", type: "hole", name: "Hole 2", diameter: 6, depth: 12, through: false, position: [20, 0, 10], axis: "Z" } as unknown as Feature,
    ];
    const labels = (d: CadDoc) => expectedDims(d, null).map((e) => e.label);
    try {
      setLang("en");
      const en = [...labels({ ...emptyDoc(), features: [helix({ profile: "thread60", thread: "M18×1,5", side: "internal", turns: 12, mode: "cut" })] }), ...labels({ ...emptyDoc(), features: [thread, legacy, ...holes] })];
      expect(en.join(" | ")).not.toMatch(/délka|hl\.|skrz|dl\./);
      expect(en).toContain("M18×1,5 length 18");
      expect(en).toContain("M20×1,5 (length 15)");
      expect(en).toContain("Ø8 thru");
      expect(en).toContain("Ø6 depth 12");
      setLang("de");
      expect(labels({ ...emptyDoc(), features: [thread] })).toContain("M18×1,5 Länge 18");
    } finally {
      setLang("cs");
    }
    const cs = labels({ ...emptyDoc(), features: [thread, legacy, ...holes] });
    expect(cs).toContain("M18×1,5 délka 18");
    expect(cs).toContain("Ø8 skrz");
    expect(cs).toContain("Ø6 hl. 12");
    expect(cs).toContain("M20×1,5 (15 dl.)");
  });

  it("kolo 6: EN běh „feature surf.helixSweep … drawing check dims“ – řádek kontroly kót celý anglicky (délka i název prvku)", { timeout: 300_000 }, async () => {
    const text = 'new part "Nut E"\ntube 30 16.5 20\nfeature surf.helixSweep profile=thread60 thread=M18x1.5 side=internal turns=12 mode=cut\ndrawing A4\ndrawing dimension\ndrawing check dims';
    try {
      setLang("en");
      const r = finalizeReport(await runReport(new MemoryWorkspace(), text, host(), { lang: "en" }), { full: true });
      const full = r.full ?? "";
      expect(full).toMatch(/M18×1,5 length 18 \(Helical sweep\)/);
      expect(full).not.toMatch(/délka|Tažení po šroubovici/);
    } finally {
      setLang("cs");
    }
  });

  it("kóty výkresu: vnější závit šroubovicí z označení má kótu „M18×1,5“, ne „Ø18“", { timeout: 300_000 }, async () => {
    const r = await run('nový díl "Čep C"\nválec 18 30\nprvek surf.helixSweep profile=thread60 thread=M18×1,5 side=external turns=10 mode=cut position=0,0,10\nvýkres A3\nkótovat\nvýkres stav');
    expect(r.full ?? "").toMatch(/M18×1,5/);
    expect((r.full ?? "").split("\n").filter((l) => /kót/i.test(l) && /Ø18(?![,\d])/.test(l))).toEqual([]);
  });

  it("formulář Tažení po šroubovici: čísla z označení živě (derive) – stejná jako stavba; strana mění poloměr / hloubku", () => {
    // dřív: formulář ukazoval uložená čísla (poloměr 10, stoupání 5), stavba ale brala katalog – nyní derive = jediný zdroj pro formulář
    const def = getExt("surf.helixSweep");
    expect(def?.derive, "derive u Tažení po šroubovici").toBeTypeOf("function");
    const ext = def!.derive!({ profile: "thread60", thread: "M18 x 1,5", side: "external", radius: 10, pitch: 5, depth: 1.2 });
    expect(ext?.source).toBe("M18×1,5");
    expect(ext?.values).toMatchObject({ radius: 9, pitch: 1.5 });
    expect(ext?.values.depth).toBeCloseTo(0.920145, 5);
    const int = def!.derive!({ profile: "thread60", thread: "M18×1,5", side: "internal" });
    expect(int?.values.radius).toBeCloseTo(8.188101, 5);
    expect(int?.values.depth).toBeCloseTo(0.811899, 5);
    expect(int?.values.pitch).toBe(1.5);
    // bez označení / jiný profil / neznámé označení: nic se neodvozuje (platí uložená čísla, neznámé označení odmítne stavba)
    expect(def!.derive!({ profile: "thread60", thread: "" })).toBeNull();
    expect(def!.derive!({ profile: "circle", thread: "M18×1,5" })).toBeNull();
    expect(def!.derive!({ profile: "thread60", thread: "M999" })).toBeNull();
  });
});
