/** Knihovna normálií 2 – nové rodiny (ozubení, ložiska, spojovací materiál, kolíky, profily, lineární technika, pneumatika, potrubí, pružiny, formy). */
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "../build";
import type { CadDoc } from "../types";
import { tslotOutline, TSLOT } from "./alu-profiles";
import { _helicalTwist } from "./gears2";
import { GROUPS, LIBRARY, byGroup, defaults, familyById, makeFromText, search, withDefaults } from "./index";
import { FLANGES, PIPES } from "./piping";
import { DISC } from "./springs2";

const TIMES = path.resolve(__dirname, "../../../.vitest-libtimes.txt");

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

const top = (q: string) => search(q, 3)[0];

describe("registr", () => {
  it("≥ 100 rodin, unikátní id, každá má normu, klíčová slova a skupinu z GROUPS", () => {
    expect(LIBRARY.length).toBeGreaterThanOrEqual(100);
    const ids = LIBRARY.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of LIBRARY) {
      expect(f.standards.length, f.id).toBeGreaterThan(0);
      expect(f.keywords.length, f.id).toBeGreaterThan(0);
      expect(GROUPS, f.id).toContain(f.group);
    }
    const groups = byGroup().map((g) => g.group);
    for (const g of ["Lineární technika", "Pneumatika a hydraulika", "Hliníkové profily", "Potrubí a příruby"]) expect(groups).toContain(g);
  });
});

describe("parser 2", () => {
  const cases: [string, string, Record<string, string | number>][] = [
    // ozubení
    ["šikmé kolo m2 z30 β15", "gearHelical", { mn: "2", z: 30, beta: 15 }],
    ["helical gear m3 z20 beta 20 b30", "gearHelical", { mn: "3", z: 20, beta: 20, b: 30 }],
    ["kuželové kolo m2 z20", "gearBevel", { m: "2", z: 20 }],
    ["bevel gear m3 z25", "gearBevel", { m: "3", z: 25 }],
    ["šnek m2 z1", "worm", { m: "2" }],
    ["šnekové kolo m2 z30", "wormWheel", { m: "2", z: 30 }],
    // ložiska
    ["kuželíkové ložisko 30206", "bearingTapered", { code: "30206" }],
    ["30206", "bearingTapered", { code: "30206" }],
    ["axiální ložisko 51105", "bearingThrust", { code: "51105" }],
    ["jehlové ložisko HK1210", "bearingNeedle", { code: "HK1210" }],
    ["HK2516", "bearingNeedle", { code: "HK2516" }],
    ["ložiskový domek UCP205", "ucp", { code: "UCP205" }],
    ["UCP 206", "ucp", { code: "UCP206" }],
    ["kluzné pouzdro 20x60", "bushing", { d: "20", l: 60 }],
    // spojovací materiál
    ["šroub s křížovou drážkou M4x16", "iso7045", { size: "M4", l: 16 }],
    ["pan head M5x10", "iso7045", { size: "M5", l: 10 }],
    ["zápustný křížový M4x20", "iso7046", { size: "M4", l: 20 }],
    ["DIN 965 M3x8", "iso7046", { size: "M3", l: 8 }],
    ["pojistná matice M8", "din985", { size: "M8" }],
    ["nyloc nut M10", "din985", { size: "M10" }],
    ["přírubová matice M6", "din6923", { size: "M6" }],
    ["křídlová matice M6", "din315", { size: "M6" }],
    ["pružná podložka 8", "din127", { size: "M8" }],
    ["zubová podložka M6", "din6798", { size: "M6" }],
    ["těžká podložka M10", "din7349", { size: "M10" }],
    ["závrtný šroub M10x40", "din938", { size: "M10", l: 40 }],
    ["DIN 939 M12x50", "din939", { size: "M12", l: 50 }],
    ["šroub s okem M10", "din580", { size: "M10" }],
    ["nýt 4x10", "din660", { d: "4", l: 10 }],
    ["samořezný ST4.2x13", "din7981", { size: "ST4.2", l: 13 }],
    ["Z31 M8x30", "iso4762", { size: "M8", l: 30 }],
    // kolíky a pera
    ["kuželový kolík 6x40", "iso2339", { d: "6", l: 40 }],
    ["rýhovaný kolík 5x30", "din1473", { d: "5", l: 30 }],
    ["DIN 1474 6x30", "din1474", { d: "6", l: 30 }],
    ["úsečové pero 3x13", "din6888", { size: "3x13" }],
    ["čep s hlavou 10x50", "din1444", { d: "10", l: 50 }],
    ["DIN 1443 12x60", "din1443", { d: "12", l: 60 }],
    ["závlačka 3.2x25", "iso1234", { d: "3.2", l: 25 }],
    // hliníkové profily
    ["profil 40x40 drážka 8 L=1000", "tslot", { size: "40x40", l: 1000 }],
    ["hliníkový profil 30x30 L=500", "tslot", { size: "30x30", l: 500 }],
    ["T-matice M8 drážka 8", "tnut", { slot: "8", thread: "M8" }],
    ["úhelník pro profil 40", "alubracket", { size: "40" }],
    // pneumatika
    ["pneumatický válec ISO 15552 50x200", "cyl15552", { bore: "50", stroke: 200 }],
    ["válec ISO 6432 20x50", "cyl6432", { bore: "20", stroke: 50 }],
    ["nástrčné šroubení 8 G1/4", "pushfit", { tube: "8", thread: "G1/4" }],
    // lineární technika
    ["HGR20 L500", "hgr", { size: "20", l: 500 }],
    ["kolejnice HGR15 L=300", "hgr", { size: "15", l: 300 }],
    ["vozík HGH20", "hgh", { size: "20" }],
    ["HGW25CC", "hgw", { size: "25" }],
    ["kuličkový šroub SFU1605 L=800", "sfu", { size: "1605", l: 800 }],
    ["vodicí tyč W16 L=500", "shaftW", { size: "16", l: 500 }],
    ["domeček SHF20", "shf", { size: "20" }],
    ["lineární pouzdro LM16UU", "lm", { size: "16" }],
    ["SC12UU", "scuu", { size: "12" }],
    // potrubí
    ['závitová trubka 1/2" L=1000', "pipeR", { size: "1/2", l: 1000 }],
    ["trubka DN25 L=500", "pipeR", { size: "1", l: 500 }],
    ["příruba PN16 DN80", "flangePN16", { dn: "DN80" }],
    ["zaslepovací příruba DN50", "flangePN16", { dn: "DN50", type: "05" }],
    ["hadicový nátrubek G1/2 13", "hosebarb", { thread: "G1/2", hose: 13 }],
    // pružiny
    ["tažná pružina d1.6 D12 L40 n20", "springExt", { d: 1.6, D: 12, L: 40, n: 20 }],
    ["zkrutná pružina d2 D16 n5", "springTorsion", { d: 2, D: 16, n: 5 }],
    ["talířová pružina 20x10.2x1", "din2093", { size: "A-20x10.2x1.1" }],
    ["plynová vzpěra 8/19 zdvih 100", "gasstrut", { size: "8/19", stroke: 100 }],
    // normálie forem
    ["vodicí sloupek Z00 24x150", "mGuidePillar", { d: "24", l: 150 }],
    ["E1000 24x150", "mGuidePillar", { d: "24", l: 150 }],
    ["sloupek Z01 24x150", "mPillarZ01", { d: "24", l: 150 }],
    ["pouzdro Z11 24x50", "mBushZ11", { d: "24", l: 50 }],
    ["Z40 6x160", "mEjector", { d: "6", l: 160 }],
    ["vyhazovací trubka 8x4x160", "mEjectorSleeve", { d: "8", di: 4, l: 160 }],
    ["plochý vyhazovač 2x6 L=160", "mFlatEjector", { size: "2x6", l: 160 }],
    ["šikmý čep 16x120 15°", "mAngledPin", { d: "16", l: 120, angle: "15" }],
    ["temperační spojka G1/4", "mCoolingPlug", { thread: "G1/4" }],
    ["datumovka 8", "mDateStamp", { d: "8" }],
  ];
  for (const [q, id, vals] of cases)
    it(`„${q}“ → ${id}`, () => {
      const t = top(q);
      expect(t, `bez výsledku pro ${q}`).toBeTruthy();
      expect(t.family.id, `${q}: ${search(q, 3).map((x) => `${x.family.id}:${x.score.toFixed(2)}`).join(", ")}`).toBe(id);
      for (const [k, v] of Object.entries(vals)) expect(t.values[k], `${q} – ${k}`).toBe(v);
    });
  it("původní dotazy nejsou novými rodinami přebity", () => {
    for (const [q, id] of [
      ["m8x30", "iso4762"],
      ["matice m10", "iso4032"],
      ["podložka 8", "iso7089"],
      ["pero 8x7x40", "din6885"],
      ["pružina d1.6 D12 L40 n10", "spring"],
      ["profil 40x40x3", "hollow"],
      ["trubka 33.7x2.6", "chs"],
      ["vodicí sloupek 24x120", "mGuidePillar"],
      ["vodicí pouzdro 24x56", "mGuideBush"],
      ["ložisko 6205", "bearing6"],
      ["kolo m2 z24", "gear"],
      ["kolík 6x30", "iso8734"],
      ["pojistný kroužek 25", "din471"],
      ["vyhazovač 6x160", "mEjector"],
    ])
      expect(top(q).family.id, q).toBe(id);
  });
  it("makeFromText vrací díl s číslem", () => {
    const m = makeFromText("kuličkový šroub SFU1605 L=800");
    expect(m?.result.family.id).toBe("sfu");
    expect(m?.doc.props?.number).toContain("SFU1605");
  });
});

describe("geometrie 2", () => {
  it("helical: úhel natočení profilu po šířce odpovídá tan β · b / rp", () => {
    // mn 2, z 20, β 15°, b 20 → rp = mn·z/(2·cos β)
    const rp = (2 * 20) / (2 * Math.cos((15 * Math.PI) / 180));
    expect(_helicalTwist(2, 20, 15, 20)).toBeCloseTo((20 * Math.tan((15 * Math.PI) / 180)) / rp, 9);
  });
  it("T-drážkový obrys 40×40: 4 drážky, uzavřený, uvnitř rastru", () => {
    const pts = tslotOutline(40, 40, TSLOT["40"]);
    expect(pts.length).toBe(4 + 4 * 8);
    for (const [x, y] of pts) {
      expect(Math.abs(x)).toBeLessThanOrEqual(20.001);
      expect(Math.abs(y)).toBeLessThanOrEqual(20.001);
    }
    const pts2 = tslotOutline(40, 80, TSLOT["40"]);
    expect(pts2.length).toBe(4 + 6 * 8);
  });
  it("tabulky: PN16 DN80 8 děr Ø18 na k160; EN 10255 1/2\" = Ø21,3; DIN 2093 A 20×10,2×1,1", () => {
    expect(FLANGES.DN80).toMatchObject({ n: 8, l: 18, k: 160 });
    expect(PIPES["1/2"].od).toBe(21.3);
    expect(DISC.find((d) => d.s === "A" && d.De === 20)).toMatchObject({ Di: 10.2, t: 1.1 });
  });
});

async function vol(doc: CadDoc) {
  const t0 = Date.now();
  const res = await buildDoc(doc);
  const ms = Date.now() - t0;
  appendFileSync(TIMES, `${ms}\t${doc.name}\n`);
  const bad = res.status.filter((s) => !s.ok);
  expect(bad, `${doc.name}: ${bad.map((b) => doc.features.find((f) => f.id === b.id)?.name + " – " + b.error).join("; ")}`).toEqual([]);
  expect(res.metrics, doc.name).not.toBeNull();
  expect(res.metrics!.volume, doc.name).toBeGreaterThan(0);
  return { ...res.metrics!, ms };
}

const build = (id: string, v: Record<string, string | number | boolean>) => {
  const f = familyById(id);
  expect(f, id).toBeTruthy();
  return vol(f!.make(withDefaults(f!, v)));
};

describe("stavba dílů 2 (více velikostí)", () => {
  it("výchozí díly nových rodin se postaví do 4 s (cíl ~2 s)", async () => {
    writeFileSync(TIMES, "");
    const from = LIBRARY.findIndex((f) => f.id === "iso7045");
    for (const f of [...LIBRARY.slice(from).filter((x) => !["iso8734", "iso2338", "iso8752", "din6885", "din471", "din472", "oring", "spring", "bearing6"].includes(x.id))]) {
      if (!["gearHelical", "gearBevel", "worm", "wormWheel", "bearingTapered", "bearingThrust", "bearingNeedle", "ucp", "bushing", "tslot", "tnut", "alubracket", "cyl15552", "cyl6432", "pushfit", "hgr", "hgh", "hgw", "sfu", "shaftW", "shf", "lm", "scuu", "pipeR", "flangePN16", "hosebarb", "springExt", "springTorsion", "din2093", "gasstrut", "mPillarZ01", "mBushZ11", "mEjectorSleeve", "mFlatEjector", "mAngledPin", "mCoolingPlug", "mDateStamp", "iso7045", "iso7046", "din985", "din6923", "din315", "din127", "din6798", "din7349", "din938", "din939", "din580", "din660", "din7981", "iso2339", "din1473", "din1474", "din6888", "din1444", "din1443", "iso1234"].includes(f.id)) continue;
      const m = await vol(f.make(defaults(f)));
      expect(m.ms, `${f.id} trvá ${m.ms} ms`).toBeLessThan(4000);
    }
  }, 300_000);

  it("ozubení", async () => {
    await build("gearHelical", { mn: "3", z: 16, beta: 20, hand: "L", b: 25, bore: 15 });
    await build("gearBevel", { m: "2.5", z: 24, b: 15, bore: 12 });
    await build("worm", { m: "3", starts: 2, l: 50, shaft: 12, shaftL: 40 });
    await build("wormWheel", { m: "3", z: 24, bore: 12 });
  }, 120_000);

  it("ložiska", async () => {
    await build("bearingTapered", { code: "32208" });
    await build("bearingTapered", { code: "30203", rollers: false });
    await build("bearingThrust", { code: "51208" });
    await build("bearingNeedle", { code: "HK0608" });
    await build("ucp", { code: "UCP210" });
    await build("bushing", { d: "40", l: 50, collar: true });
  }, 120_000);

  it("spojovací materiál", async () => {
    await build("iso7045", { size: "M2.5", l: 6 });
    await build("iso7046", { size: "M8", l: 40 });
    await build("din985", { size: "M3" });
    await build("din985", { size: "M24" });
    await build("din6923", { size: "M12", serr: true });
    await build("din315", { size: "M12" });
    await build("din127", { size: "M20" });
    await build("din6798", { size: "M3" });
    await build("din7349", { size: "M16" });
    await build("din938", { size: "M20", l: 80 });
    await build("din939", { size: "M6", l: 30 });
    await build("din580", { size: "M30" });
    await build("din660", { d: "8", l: 30 });
    await build("din7981", { size: "ST2.9", l: 9.5 });
  }, 180_000);

  it("kolíky, pera, pružiny", async () => {
    await build("iso2339", { d: "10", l: 80 });
    await build("din1473", { d: "3", l: 16 });
    await build("din1474", { d: "12", l: 60 });
    await build("din6888", { size: "6x19" });
    await build("din1444", { d: "25", l: 100 });
    await build("din1443", { d: "6", l: 30, groove: false });
    await build("iso1234", { d: "8", l: 63 });
    await build("springExt", { d: 3, D: 25, L: 80, n: 15 });
    await build("springTorsion", { d: 1, D: 10, n: 8, leg: 20, angle: 180 });
    await build("din2093", { size: "B-40x20.4x1.5", count: 4, stack: "series" });
    await build("din2093", { size: "A-50x25.4x3", count: 2, stack: "parallel" });
    await build("gasstrut", { size: "14/28", stroke: 250, extended: false });
  }, 180_000);

  it("hliníkové profily, lineární technika, pneumatika", async () => {
    await build("tslot", { size: "20x20", l: 200 });
    await build("tslot", { size: "40x80", l: 300 });
    await build("tslot", { size: "45x45", l: 100, core: false });
    await build("tnut", { slot: "10", thread: "M10", l: 25 });
    await build("alubracket", { size: "20" });
    await build("hgr", { size: "35", l: 1000 });
    await build("hgh", { size: "15" });
    await build("hgw", { size: "35" });
    await build("sfu", { size: "3210", l: 1200, nutPos: 400 });
    await build("sfu", { size: "1204", l: 200, ends: false });
    await build("shaftW", { size: "40", l: 1500 });
    await build("shf", { size: "8" });
    await build("lm", { size: "40" });
    await build("scuu", { size: "8" });
    await build("cyl15552", { bore: "125", stroke: 500, extended: true });
    await build("cyl15552", { bore: "32", stroke: 25 });
    await build("cyl6432", { bore: "8", stroke: 10, extended: true });
    await build("pushfit", { tube: "4", thread: "M5" });
  }, 240_000);

  it("potrubí a normálie forem", async () => {
    await build("pipeR", { size: "4", l: 300 });
    await build("pipeR", { size: "1 1/4", l: 500 });
    await build("flangePN16", { dn: "DN200", type: "01" });
    await build("flangePN16", { dn: "DN15", type: "05" });
    await build("flangePN16", { dn: "DN100", type: "11" });
    await build("hosebarb", { thread: "G1", hose: 25 });
    await build("mPillarZ01", { d: "60", l: 400 });
    await build("mBushZ11", { d: "12", l: 25 });
    await build("mEjectorSleeve", { d: "20", di: 12, l: 400 });
    await build("mFlatEjector", { size: "5x16", d: "20", l: 300, lf: 100 });
    await build("mAngledPin", { d: "30", l: 250, angle: "25" });
    await build("mCoolingPlug", { thread: "G3/8", hose: "13" });
    await build("mDateStamp", { d: "20", l: 40 });
  }, 180_000);
});
