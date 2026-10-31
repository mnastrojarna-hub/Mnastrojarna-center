import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildDoc } from "../build";
import type { CadDoc } from "../types";
import { involuteGearProfile, sprocketProfile } from "./gears";
import { LIBRARY, defaults, familyById, makeFromText, search, withDefaults } from "./index";
import { norm } from "./parse-util";
import { BEARINGS, CHAINS, IPE } from "./tables";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

const top = (q: string) => search(q, 3)[0];

describe("parser", () => {
  it("normalizace", () => {
    expect(norm("Šroub M8×30, L=1 000")).toBe("sroub m8x30, l=1 000");
    expect(norm("jäkl 40*40*3")).toBe("jakl 40x40x3");
  });
  const cases: [string, string, Record<string, string | number>][] = [
    ["m8x30", "iso4762", { size: "M8", l: 30 }],
    ["imbus M10 x 40", "iso4762", { size: "M10", l: 40 }],
    ["šestihranný m8x30", "iso4017", { size: "M8", l: 30 }],
    ["šroub DIN 931 M12x80", "iso4014", { size: "M12", l: 80 }],
    ["matice m10", "iso4032", { size: "M10" }],
    ["nízká matice M16", "iso4035", { size: "M16" }],
    ["podložka 8", "iso7089", { size: "M8" }],
    ["velká podložka M10", "din9021", { size: "M10" }],
    ["půlkulatá m6x16", "iso7380", { size: "M6", l: 16 }],
    ["zápustný m5x20", "iso10642", { size: "M5", l: 20 }],
    ["červík m6x10", "iso4026", { size: "M6", l: 10 }],
    ["závitová tyč M12 L1000", "din975", { size: "M12", l: 1000 }],
    ["kolík 6x30", "iso8734", { d: 6, l: 30 }],
    ["pružný kolík 8x40", "iso8752", { d: "8", l: 40 }],
    ["pero 8x7x40", "din6885", { b: "8", l: 40 }],
    ["ložisko 6205", "bearing6", { code: "6205" }],
    ["6205 2RS", "bearing6", { code: "6205", seal: "2RS" }],
    ["bearing 608zz", "bearing6", { code: "608", seal: "2Z" }],
    ["kolo m2 z24", "gear", { m: "2", z: 24 }],
    ["ozubené kolo m2 z24 b20", "gear", { m: "2", z: 24, b: 20 }],
    ["řetězka 08B z19", "sprocket", { chain: "08B", z: 19 }],
    ["sprocket 08B-1 19", "sprocket", { chain: "08B", z: 19, rows: "1" }],
    ["hřeben m2 z40", "rack", { m: "2", n: 40 }],
    ["řemenice HTD 5M 32 zubů", "htd", { profile: "5M", z: 32 }],
    ["klínová řemenice SPA 125", "vpulley", { profile: "SPA", dp: 125 }],
    ["IPE 200 1500", "ipe", { size: "200", l: 1500 }],
    ["IPE 200 L=1500", "ipe", { size: "200", l: 1500 }],
    ["HEB 100", "heb", { size: "100" }],
    ["L 50x50x5", "angle", { size: "50x50x5" }],
    ["U 100", "upn", { size: "100" }],
    ["UPN 120 L=2000", "upn", { size: "120", l: 2000 }],
    ["jäkl 40x40x3 L=1000", "hollow", { w: 40, h: 40, t: 3, l: 1000 }],
    ["jäkl 40x40x3 1000", "hollow", { w: 40, h: 40, t: 3, l: 1000 }],
    ["profil 40x40x3", "hollow", { w: 40, h: 40, t: 3 }],
    ["trubka 33.7x2.6", "chs", { D: 33.7, t: 2.6 }],
    ["plochá 40x8", "flat", { w: 40, t: 8 }],
    ["kulatina 20", "round", { d: 20 }],
    ["šestihran 17", "hexbar", { d: 17 }],
    ["pružina d1.6 D12 L40 n10", "spring", { d: 1.6, D: 12, L: 40, n: 10 }],
    ["pružina d1 D10 L30 n8", "spring", { d: 1, D: 10, L: 30, n: 8 }],
    ["o-kroužek 20x3", "oring", { d1: 20, d2: "3" }],
    ["pojistný kroužek 25", "din471", { d: "25" }],
    ["pojistný kroužek do díry 30", "din472", { d: "30" }],
    ["vodicí sloupek 24x120", "mGuidePillar", { d: "24", l: 120 }],
    ["vyhazovač 6x160", "mEjector", { d: "6", l: 160 }],
    ["vtoková vložka 16", "mSprueBush", { d: "16" }],
  ];
  for (const [q, id, vals] of cases)
    it(`„${q}“ → ${id}`, () => {
      const t = top(q);
      expect(t, `bez výsledku pro ${q}`).toBeTruthy();
      expect(t.family.id, `${q}: ${search(q, 3).map((x) => `${x.family.id}:${x.score.toFixed(2)}`).join(", ")}`).toBe(id);
      for (const [k, v] of Object.entries(vals)) expect(t.values[k], `${q} – ${k}`).toBe(v);
    });
  it("prázdný dotaz vrací rodiny, nesmysl nic", () => {
    expect(search("").length).toBeGreaterThan(5);
    expect(search("qwertz").length).toBe(0);
  });
});

async function vol(doc: CadDoc) {
  const res = await buildDoc(doc);
  const bad = res.status.filter((s) => !s.ok);
  expect(bad, `${doc.name}: ${bad.map((b) => doc.features.find((f) => f.id === b.id)?.name + " – " + b.error).join("; ")}`).toEqual([]);
  expect(res.metrics, doc.name).not.toBeNull();
  expect(res.metrics!.volume, doc.name).toBeGreaterThan(0);
  return res.metrics!;
}

describe("geometrie profilů", () => {
  it("evolventní kolo: body leží mezi patní a hlavovou kružnicí", () => {
    const m = 2;
    const z = 24;
    const pts = involuteGearProfile(m, z);
    const rr = pts.map(([x, y]) => Math.hypot(x, y));
    expect(Math.max(...rr)).toBeCloseTo(m * (z / 2 + 1), 3);
    expect(Math.min(...rr)).toBeCloseTo(m * (z / 2 - 1.25), 3);
    // každý zub má 3 body na hlavové kružnici (levý bok, střed, pravý bok)
    expect(rr.filter((v) => Math.abs(v - m * (z / 2 + 1)) < 1e-3).length).toBe(3 * z);
  });
  it("řetězové kolo 08B z19: roztečný průměr dle ISO 606", () => {
    const c = CHAINS["08B"];
    const { dp, pts } = sprocketProfile(c.p, c.d1, 19);
    expect(dp).toBeCloseTo(c.p / Math.sin(Math.PI / 19), 6);
    expect(Math.max(...pts.map(([x, y]) => Math.hypot(x, y)))).toBeLessThan(dp / 2 + c.p);
  });
});

describe("stavba dílů", () => {
  it("každá rodina se postaví s výchozími hodnotami", async () => {
    for (const f of LIBRARY) {
      const doc = f.make(defaults(f));
      expect(doc.props?.number, f.id).toBeTruthy();
      await vol(doc);
    }
  }, 300_000);

  it("šrouby a matice více velikostí", async () => {
    for (const [id, size, l] of [
      ["iso4762", "M3", 10],
      ["iso4762", "M24", 80],
      ["iso4017", "M6", 20],
      ["iso4014", "M20", 150],
      ["iso7380", "M4", 10],
      ["iso10642", "M12", 30],
      ["iso4032", "M36", 0],
      ["iso7089", "M3", 0],
    ] as const) {
      const f = familyById(id)!;
      await vol(f.make(withDefaults(f, { size, ...(l ? { l } : {}) })));
    }
  }, 120_000);

  it("IPE 200: průřez 100 × 200, délka 1500", async () => {
    const f = familyById("ipe")!;
    const m = await vol(f.make(withDefaults(f, { size: "200", l: 1500 })));
    const [a, b] = m.bbox;
    expect(b[0] - a[0]).toBeCloseTo(IPE["200"].b, 3);
    expect(b[1] - a[1]).toBeCloseTo(IPE["200"].h, 3);
    expect(b[2] - a[2]).toBeCloseTo(1500, 3);
    // plocha průřezu IPE 200 ≈ 28,5 cm²
    expect(m.volume / 1500 / 100).toBeCloseTo(28.5, 0);
  }, 60_000);

  it("ozubené kolo m2 z24: da = m(z+2), objem mezi patní a hlavovou kružnicí", async () => {
    const f = familyById("gear")!;
    const m = await vol(f.make(withDefaults(f, { m: "2", z: 24, b: 20, bore: 0 })));
    const [a, b] = m.bbox;
    expect(b[0] - a[0]).toBeCloseTo(2 * 26, 1);
    const vf = Math.PI * 21.5 ** 2 * 20;
    const va = Math.PI * 26 ** 2 * 20;
    expect(m.volume).toBeGreaterThan(vf);
    expect(m.volume).toBeLessThan(va);
  }, 60_000);

  it("ozubené kolo s dírou a drážkou pro pero, velký počet zubů", async () => {
    const f = familyById("gear")!;
    const small = await vol(f.make(withDefaults(f, { m: "2", z: 24, b: 20, bore: 0 })));
    const bored = await vol(f.make(withDefaults(f, { m: "2", z: 24, b: 20, bore: 12, keyway: true })));
    expect(bored.volume).toBeLessThan(small.volume - Math.PI * 36 * 20 * 0.99);
    await vol(f.make(withDefaults(f, { m: "1", z: 120, b: 10, bore: 20 })));
  }, 120_000);

  it("řetězové kolo 08B z19: průměr blízko da", async () => {
    const f = familyById("sprocket")!;
    const m = await vol(f.make(withDefaults(f, { chain: "08B", z: 19, bore: 0 })));
    const c = CHAINS["08B"];
    const dp = c.p / Math.sin(Math.PI / 19);
    const [a, b] = m.bbox;
    const dMeasured = b[0] - a[0];
    expect(dMeasured).toBeGreaterThan(dp);
    expect(dMeasured).toBeLessThan(dp + 1.25 * c.p);
  }, 60_000);

  it("ložisko 6205 má rozměr 25×52×15", async () => {
    const f = familyById("bearing6")!;
    const m = await vol(f.make(withDefaults(f, { code: "6205", seal: "2RS" })));
    const [a, b] = m.bbox;
    expect(b[0] - a[0]).toBeCloseTo(BEARINGS["6205"].D, 2);
    expect(b[2] - a[2]).toBeCloseTo(BEARINGS["6205"].B, 2);
  }, 60_000);

  it("makeFromText: „M8x30“ dá šroub, nesmysl null", () => {
    const r = makeFromText("M8x30");
    expect(r?.result.family.id).toBe("iso4762");
    expect(r?.doc.props?.number).toContain("M8×30");
    expect(makeFromText("xyzxyz")).toBeNull();
  });
});
