/**
 * Kolize šroub × závit geometricky (CAD-HEADLESS-NAVRH.md kap. 6.3, balík B5): pravidlo (čisté funkce) a P9 – 10 případů
 * + pojistka prstence pod hlavou se skutečným jádrem in-process (operace `clashDetail` nad výsledkem `interference`).
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import { emptyAssembly, partComponent } from "./assembly";
import { classifyClashes, countClasses, decideBand, matchTapHoles, nominalDiameter, tappedFeatures, worstClass, type ClashClass } from "./clash-class";
import { makeKernelClient } from "./kernel-client";
import { makeFromText } from "./library";
import { emptyDoc, type CadDoc, type Feature, type Vec3 } from "./types";

const WASM = path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");

const partOf = (name: string, text: string): CadDoc => {
  const d = emptyDoc(name);
  for (const op of parseAgentText(text).ops) if (op.k === "feature") d.features.push(op.feature as Feature);
  return d;
};

describe("pravidlo zařazení (bez jádra)", () => {
  it("jmenovitý průměr z označení bez tabulky: M10, M10x1, M10×1,25, MF10x1, M8-6H; jiné označení = null", () => {
    expect(nominalDiameter("M10")).toBe(10);
    expect(nominalDiameter("M10x1")).toBe(10);
    expect(nominalDiameter("M10×1,25")).toBe(10);
    expect(nominalDiameter("MF10x1")).toBe(10);
    expect(nominalDiameter("M8-6H")).toBe(8);
    expect(nominalDiameter(" m6 ")).toBe(6);
    expect(nominalDiameter("M2,5")).toBe(2.5);
    for (const x of ["G1/4", "UNC 1/4-20", "Tr20x4", "NPT 1/2", "", undefined, "M", "Mx10"]) expect(nominalDiameter(x)).toBeNull();
  });

  it("rozhodnutí podle objemů: šum = závit, malý prstenec u vstupu = pod hlavou, hluboko / velký zbytek = skutečná", () => {
    expect(decideBand({ volume: 544.9, band: 544.9, rest: 0, restDepth: 0, D: 10 })).toEqual({ cls: "thread", why: "thread" });
    expect(decideBand({ volume: 555, band: 544.9, rest: 10.1, restDepth: 0.8, D: 10 })).toEqual({ cls: "underhead", why: "underhead" });
    expect(decideBand({ volume: 555, band: 544.9, rest: 10.1, restDepth: 1.5, D: 10 })).toEqual({ cls: "real", why: "rest-deep" });
    expect(decideBand({ volume: 889, band: 544.9, rest: 344.5, restDepth: 25, D: 10 })).toEqual({ cls: "real", why: "rest-large" });
    expect(decideBand({ volume: 40, band: 0, rest: 40, restDepth: 2, D: 10 })).toEqual({ cls: "real", why: "outside-band" });
    // zbytek do 1 mm³ i u malého pásma (M3)
    expect(decideBand({ volume: 20.8, band: 20, rest: 0.8, restDepth: 0.2, D: 3 }).cls).toBe("underhead");
    expect(worstClass(["thread", "underhead"])).toBe("underhead");
    expect(worstClass(["thread", "real", "undetermined"])).toBe("real");
    expect(worstClass(["thread"])).toBe("thread");
    expect(countClasses([{ cls: "thread" }, { cls: "thread" }, { cls: "real" }])).toEqual({ total: 3, thread: 2, underhead: 0, real: 1, undetermined: 0 });
  });

  it("závitové prvky dílu a jejich díry: poloha souřadnicemi = bod na ose, poloha odkazem / polem = průměr vrtáku", () => {
    const plate = partOf("Deska", "kvádr 100 40 20\ndíra 8,5 hloubka 15 v 20 20 20 v 80 20 20 závit M10\ndíra 6,8 hloubka 12 v 50 20 20 závit M8\ndíra 9 skrz v 50 5 20");
    const feats = tappedFeatures(plate);
    expect(feats.map((f) => [f.designation, f.D, f.drillR, f.points?.length])).toEqual([
      ["M10", 10, 4.25, 2],
      ["M8", 8, 3.4, 1],
    ]);
    const z: Vec3 = [0, 0, 1];
    const geo = (x: number, y: number, r: number) => ({ r, axis: z, entry: [x, y, 20] as Vec3, drill: [0, 0, -1] as Vec3, length: 15, through: false });
    const holes = matchTapHoles(feats, [geo(20, 20, 4.25), geo(80, 20, 4.25), geo(50, 20, 3.4), geo(50, 5, 4.5)]);
    expect(holes.map((h) => [h.designation, h.entry[0], h.entry[1]])).toEqual([
      ["M10", 20, 20],
      ["M10", 80, 20],
      ["M8", 50, 20],
    ]);
    // pole díry: polohy neznámé bez stavby → podle průměru vrtáku
    const pat = { ...plate, features: [...plate.features, { id: "p1", name: "Pole", type: "pattern", featureId: plate.features[1].id, kind: "linear", count: 2, spacing: 30, direction: [0, 1, 0] } as Feature] };
    expect(tappedFeatures(pat)[0].points).toBeNull();
    expect(matchTapHoles(tappedFeatures(pat), [geo(20, 50, 4.25)]).map((h) => h.designation)).toEqual(["M10"]);
  });
});

type Case = { name: string; plate: string; screw: () => CadDoc; at: Vec3; expect: ClashClass };
/** šroub s válcovou hlavou postavený jako před rozhodnutím 15.9 (dřík, hlava, sražení všech hran → prstenec pod hlavou) */
const oldScrew = (d: number, l: number, dk: number, k: number): CadDoc => ({
  ...emptyDoc("Šroub starý"),
  features: [
    { id: "s1", name: "Dřík", type: "cylinder", radius: d / 2, height: l, position: [0, 0, -l], axis: "Z", mode: "new" },
    { id: "s2", name: "Hlava", type: "cylinder", radius: dk / 2, height: k, position: [0, 0, 0], axis: "Z", mode: "add" },
    { id: "s3", name: "Sražení", type: "chamfer", distance: Math.max(0.3, d * 0.08), edges: "all" },
  ] as Feature[],
});
/** P9 (kap. 6.3): 10 případů, očekávání podle návrhu (knihovní ISO 4762 po rozhodnutí 15.9 bez prstence) + pojistka pod hlavou */
const P9: Case[] = [
  { name: "M10 do Ø8,5 (vrták)", plate: "kvádr 40 40 30\ndíra 8,5 hloubka 25 v 20 20 30 závit M10", screw: () => partOf("Šroub", "válec 10 25"), at: [20, 20, 5], expect: "thread" },
  { name: "M8 do Ø6,8", plate: "kvádr 40 40 30\ndíra 6,8 hloubka 20 v 20 20 30 závit M8", screw: () => partOf("Šroub", "válec 8 20"), at: [20, 20, 10], expect: "thread" },
  { name: "M10x1 jemný do Ø9,0", plate: "kvádr 40 40 30\ndíra 9 hloubka 25 v 20 20 30 závit M10x1", screw: () => partOf("Šroub", "válec 10 25"), at: [20, 20, 5], expect: "thread" },
  { name: "M10 do Ø8,376 (ISO D1)", plate: "kvádr 40 40 30\ndíra 8,376 hloubka 25 v 20 20 30 závit M10", screw: () => partOf("Šroub", "válec 10 25"), at: [20, 20, 5], expect: "thread" },
  // knihovní ISO 4762 po rozhodnutí 15.9: hlava sražená dřív, než se přidá dřík – bez prstence pod hlavou = jen závit
  { name: "ISO 4762 M10x30 (hlava, sražení, kosm. závit) do M10 hl. 32", plate: "kvádr 40 40 40\ndíra 8,5 hloubka 32 v 20 20 40 závit M10", screw: () => makeFromText("M10x30")!.doc, at: [20, 20, 40], expect: "thread" },
  // pojistka (rozhodnutí 15.9): šroub uložený starší verzí knihovny – sražení všech hran i na vyduté hraně dřík–hlava
  { name: "ISO 4762 M10x30 starší (prstenec pod hlavou) do M10 hl. 32", plate: "kvádr 40 40 40\ndíra 8,5 hloubka 32 v 20 20 40 závit M10", screw: () => oldScrew(10, 30, 16, 10), at: [20, 20, 40], expect: "underhead" },
  { name: "ISO 4762 M10x30 do M10 hl. 25 (šroub dosedne do plného)", plate: "kvádr 40 40 30\ndíra 8,5 hloubka 25 v 20 20 30 závit M10", screw: () => makeFromText("M10x30")!.doc, at: [20, 20, 30], expect: "real" },
  { name: "kolík Ø8 do hladké Ø7,9 (přesah)", plate: "kvádr 40 40 30\ndíra 7,9 hloubka 20 v 20 20 30", screw: () => partOf("Kolík", "válec 8 20"), at: [20, 20, 10], expect: "real" },
  { name: "M10 mimo osu o 0,3 mm", plate: "kvádr 40 40 30\ndíra 8,5 hloubka 25 v 20 20 30 závit M10", screw: () => partOf("Šroub", "válec 10 25"), at: [20.3, 20, 5], expect: "real" },
  { name: "M10 delší než díra (+5 mm do plného)", plate: "kvádr 40 40 30\ndíra 8,5 hloubka 25 v 20 20 30 závit M10", screw: () => partOf("Šroub", "válec 10 30"), at: [20, 20, 0], expect: "real" },
  { name: "M12 šroub do M10 díry", plate: "kvádr 40 40 30\ndíra 8,5 hloubka 25 v 20 20 30 závit M10", screw: () => partOf("Šroub", "válec 12 25"), at: [20, 20, 5], expect: "real" },
];

describe("P9: šroub × závit se skutečným jádrem (10 případů)", async () => {
  const { inProcessTransport } = await import("./kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const asmOf = (c: Case, swap = false): CadDoc => {
    const plate = partComponent(partOf("Deska", c.plate), { position: [0, 0, 0] }, { name: "Deska" });
    const screw = partComponent(c.screw(), { position: c.at }, { name: "Šroub" });
    return { ...emptyAssembly("P9"), components: swap ? [screw, plate] : [plate, screw] };
  };

  for (const c of P9)
    it(c.name, async () => {
      const doc = asmOf(c);
      const pairs = await kernel.interference(doc);
      expect(pairs).toHaveLength(1);
      const t0 = Date.now();
      const { list, counts } = await classifyClashes(kernel, doc, pairs);
      const ms = Date.now() - t0;
      if (process.env.P9_LOG) console.log(`${c.name}: ${JSON.stringify({ ...list[0], aPath: undefined, bPath: undefined })} ${ms} ms`);
      expect(list[0].cls, JSON.stringify(list[0])).toBe(c.expect);
      expect(counts.total).toBe(1);
      expect(counts[c.expect]).toBe(1);
      if (c.expect === "thread" || c.expect === "underhead") {
        expect(list[0].holeIn).toBe("a");
        expect(list[0].hole?.designation).toMatch(/^M\d/);
        expect(list[0].band).toBeGreaterThan(100);
      }
      if (c.expect === "underhead") expect(list[0].rest).toBeGreaterThan(1);
      if (c.name.startsWith("ISO 4762 M10x30 (hlava")) expect(list[0].rest ?? 0).toBeLessThan(0.01); // knihovní šroub: nic mimo pásmo závitu
      // pořadí komponent v sestavě nemění výsledek (díra se hledá v obou dílech dvojice)
      const doc2 = asmOf(c, true);
      const r2 = await classifyClashes(kernel, doc2, await kernel.interference(doc2));
      expect(r2.list[0].cls).toBe(c.expect);
      expect(ms).toBeLessThan(15_000);
    }, 120_000);

  it("neznámé označení závitu (G 1/4) souosé s průnikem → nevyhodnotitelné; opakované zařazení z mezipaměti", async () => {
    // trubkový závit G 1/4 jako vnitřní závit na hladké díře (jádro ho nepostaví, označení ale nese)
    const plate = partOf("Deska", "kvádr 40 40 30\ndíra 11,445 hloubka 25 v 20 20 30");
    plate.features.push({ id: "g14", name: "Závit G1/4", type: "thread", designation: "G1/4", position: [20, 20, 30], axis: "Z", length: 20, modeled: false, internal: true } as Feature);
    const doc = { ...emptyAssembly("G"), components: [partComponent(plate, {}, { name: "Deska" }), partComponent(partOf("Šroub", "válec 13 25"), { position: [20, 20, 5] }, { name: "Šroub" })] };
    const pairs = await kernel.interference(doc);
    const a = await classifyClashes(kernel, doc, pairs);
    expect(a.list[0]).toMatchObject({ cls: "undetermined", why: "unknown-designation" });
    const t0 = Date.now();
    const b = await classifyClashes(kernel, doc, pairs);
    expect(b.list[0].cls).toBe("undetermined");
    expect(Date.now() - t0).toBeLessThan(2000);
  }, 120_000);
});
