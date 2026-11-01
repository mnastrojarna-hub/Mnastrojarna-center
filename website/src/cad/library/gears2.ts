/** Ozubení 2: šikmá kola (šablonování natočených evolventních profilů), kuželová kola, šnek a šnekové kolo. */
import { uid, type Feature, type Vec2 } from "../types";
import { involuteGearProfile } from "./gears";
import { has, nums, score, tagged } from "./parse-util";
import { keyForShaft } from "./tables";
import type { Family, ParamSchema } from "./types";
import { chamferAll, cyl, fmt, keywayCut, num, part, rnd, sketch, str, XY } from "./util";

const DEG = Math.PI / 180;
const MODULES = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8].map((x) => ({ v: String(x), l: String(x) }));

const boreParams: ParamSchema[] = [
  { key: "bore", label: "Díra d", kind: "number", min: 0, max: 300, step: 1, unit: "mm", default: 0, hint: "0 = plný" },
  { key: "keyway", label: "Drážka pro pero DIN 6885", kind: "bool", default: true },
];

function boreFeatures(bore: number, keyway: boolean, height: number, z0 = 0): Feature[] {
  if (!(bore > 0)) return [];
  const f: Feature[] = [cyl("Díra", bore, height + 2, z0 - 1, "cut")];
  if (keyway) {
    const k = keyForShaft(bore);
    f.push(keywayCut(bore, k.b, k.t2, height, z0));
  }
  return f;
}

const rot = (pts: Vec2[], a: number): Vec2[] => pts.map(([x, y]) => [rnd(x * Math.cos(a) - y * Math.sin(a), 5), rnd(x * Math.sin(a) + y * Math.cos(a), 5)]);

/** Skici natočených profilů v rovinách XY(z_i) + šablonování (hladké) → šikmé ozubení. */
function helicalFeatures(name: string, profile: Vec2[], b: number, twistRad: number, sections: number, mode: "new" | "add" = "new"): Feature[] {
  const f: Feature[] = [];
  const ids: string[] = [];
  for (let i = 0; i < sections; i++) {
    const t = i / (sections - 1);
    const sk = sketch(`${name} – řez ${i + 1}`, XY(rnd(b * t, 4)), [{ id: uid(), type: "polyline", closed: true, points: rot(profile, twistRad * t) }]);
    f.push(sk);
    ids.push(sk.id);
  }
  f.push({ id: uid(), name, type: "loft", sketchIds: ids, ruled: false, mode });
  return f;
}

export const helicalGear: Family = {
  id: "gearHelical",
  name: "Čelní ozubené kolo se šikmými zuby",
  group: "Ozubení a řetězy",
  icon: "settings",
  standards: ["ISO 53", "DIN 3960", "ČSN 01 4607"],
  keywords: ["sikme ozubeni", "sikme kolo", "sikmymi zuby", "helical gear", "uhel sklonu", "beta"],
  params: [
    { key: "mn", label: "Normálný modul mn", kind: "enum", options: MODULES, default: "2" },
    { key: "z", label: "Počet zubů z", kind: "number", min: 10, max: 120, step: 1, unit: "", default: 20 },
    { key: "beta", label: "Úhel sklonu β", kind: "number", min: 5, max: 45, step: 1, unit: "°", default: 15 },
    { key: "hand", label: "Smysl stoupání", kind: "enum", options: [{ v: "R", l: "pravý (R)" }, { v: "L", l: "levý (L)" }], default: "R" },
    { key: "b", label: "Šířka b", kind: "number", min: 2, max: 200, step: 1, unit: "mm", default: 20 },
    ...boreParams,
  ],
  parse: (q) => {
    const kw = has(q, "sikm", "helical", "sklon");
    if (!kw || has(q, "kuzel", "bevel", "snek", "worm")) return null;
    const m = tagged(q, "mn") ?? tagged(q, "m") ?? tagged(q, "modul");
    const z = tagged(q, "z");
    const betaM = q.match(/(?:β|beta|sklon\w*)\s?=?\s?(\d+(?:\.\d+)?)/) ?? q.match(/(\d+(?:\.\d+)?)\s*(?:°|st\b|deg)/);
    const beta = betaM ? Number(betaM[1]) : null;
    const b = tagged(q, "b");
    const values: Record<string, string | number> = {};
    if (m) values.mn = String(m);
    if (z) values.z = z;
    if (beta) values.beta = beta;
    if (b) values.b = b;
    if (has(q, "lev", "left")) values.hand = "L";
    return { values, score: score(kw, (m ? 0.15 : 0) + (z ? 0.15 : 0) + (beta ? 0.1 : 0)) };
  },
  describe: (v) => `Šikmé kolo mn${v.mn} z${v.z} β${fmt(num(v.beta))}°${v.hand} b${fmt(num(v.b))}`,
  make: (v) => {
    const mn = num(v.mn, 2);
    const z = Math.max(10, Math.round(num(v.z, 20)));
    const beta = Math.max(0, num(v.beta, 15)) * DEG;
    const b = num(v.b, 20);
    const mt = mn / Math.cos(beta); // čelní modul
    const profile = involuteGearProfile(mt, z, 20, 0, 3);
    const rp = (mt * z) / 2;
    const twist = ((v.hand === "L" ? -1 : 1) * (b * Math.tan(beta))) / rp; // rad – otočení profilu po šířce
    const sections = Math.max(3, Math.min(6, Math.ceil(Math.abs(twist) / 0.12) + 1));
    const bore = v.bore === undefined ? Math.round(mt * z * 0.25) : num(v.bore);
    return part(`Šikmé kolo mn${fmt(mn)} z${z} β${fmt(num(v.beta, 15))}°`, "ocel", [...helicalFeatures("Šikmé ozubení", profile, b, twist, sections), ...boreFeatures(bore, v.keyway !== false, b)], `Šikmé kolo mn${fmt(mn)} z${z} β${fmt(num(v.beta, 15))}°${v.hand ?? "R"} b${fmt(b)} – d ${fmt(mt * z)}`, "#c9a46a");
  },
};

export const bevelGear: Family = {
  id: "gearBevel",
  name: "Kuželové ozubené kolo s přímými zuby",
  group: "Ozubení a řetězy",
  icon: "cone",
  standards: ["ISO 23509", "DIN 3971"],
  keywords: ["kuzelove kolo", "kuzelove ozubeni", "bevel gear", "miter gear", "kuzelovy prevod"],
  params: [
    { key: "m", label: "Modul m (vnější)", kind: "enum", options: MODULES, default: "2" },
    { key: "z", label: "Počet zubů z", kind: "number", min: 10, max: 100, step: 1, unit: "", default: 20 },
    { key: "delta", label: "Úhel roztečného kužele δ", kind: "number", min: 10, max: 80, step: 1, unit: "°", default: 45, hint: "45° = soukolí 1:1 (miter)" },
    { key: "b", label: "Šířka ozubení b", kind: "number", min: 2, max: 100, step: 1, unit: "mm", default: 12 },
    ...boreParams,
  ],
  parse: (q) => {
    const kw = has(q, "kuzel", "bevel", "miter");
    if (!kw || has(q, "snek", "worm", "lozisk", "kolik", "pin")) return null;
    const m = tagged(q, "m") ?? tagged(q, "modul");
    const z = tagged(q, "z");
    const d = (q.match(/(\d+(?:\.\d+)?)\s*(?:°|st|deg)/) ?? [])[1];
    const values: Record<string, string | number> = {};
    if (m) values.m = String(m);
    if (z) values.z = z;
    if (d) values.delta = Number(d);
    return { values, score: score(kw, (m ? 0.15 : 0) + (z ? 0.15 : 0)) };
  },
  describe: (v) => `Kuželové kolo m${v.m} z${v.z} δ${fmt(num(v.delta))}°`,
  make: (v) => {
    const m = num(v.m, 2);
    const z = Math.max(10, Math.round(num(v.z, 20)));
    const delta = num(v.delta, 45) * DEG;
    const b = num(v.b, 12);
    const re = (m * z) / 2 / Math.sin(delta); // vnější délka kužele
    const bb = Math.min(b, re * 0.3);
    const scale = (re - bb) / re; // vnitřní profil zmenšený
    const outer = involuteGearProfile(m, z, 20, 0, 3);
    const inner = outer.map(([x, y]) => [rnd(x * scale, 5), rnd(y * scale, 5)] as Vec2);
    const h = bb * Math.cos(delta); // osová výška ozubené části
    const s1 = sketch("Vnější profil", XY(0), [{ id: uid(), type: "polyline", closed: true, points: outer }]);
    const s2 = sketch("Vnitřní profil", XY(rnd(h, 4)), [{ id: uid(), type: "polyline", closed: true, points: inner }]);
    const hubH = Math.max(m * 2, bb * 0.6);
    const hubD = m * (z - 2.5) * scale * 0.9;
    const bore = v.bore === undefined ? Math.round(m * z * 0.2) : num(v.bore);
    return part(`Kuželové kolo m${fmt(m)} z${z}`, "ocel", [
      s1,
      s2,
      { id: uid(), name: "Kuželové ozubení", type: "loft", sketchIds: [s1.id, s2.id], ruled: true, mode: "new" },
      cyl("Náboj", hubD, hubH, h, "add"),
      ...boreFeatures(bore, v.keyway !== false, h + hubH),
    ], `Kuželové kolo m${fmt(m)} z${z} δ${fmt(num(v.delta, 45))}° b${fmt(bb)}`, "#c9a46a");
  },
};

export const worm: Family = {
  id: "worm",
  name: "Šnek (válcový, jednochodý)",
  group: "Ozubení a řetězy",
  icon: "sweep",
  standards: ["DIN 3975", "ISO 1122"],
  keywords: ["snek", "sneky", "worm", "worm shaft", "snekovy prevod"],
  params: [
    { key: "m", label: "Modul m (osový)", kind: "enum", options: MODULES, default: "2" },
    { key: "q", label: "Součinitel průměru q", kind: "number", min: 6, max: 20, step: 1, unit: "", default: 10, hint: "d1 = m·q" },
    { key: "starts", label: "Počet chodů", kind: "number", min: 1, max: 4, step: 1, unit: "", default: 1 },
    { key: "l", label: "Délka ozubené části", kind: "number", min: 5, max: 300, step: 1, unit: "mm", default: 40 },
    { key: "shaft", label: "Průměr hřídele", kind: "number", min: 0, max: 100, step: 1, unit: "mm", default: 0, hint: "0 = bez hřídelových konců" },
    { key: "shaftL", label: "Délka hřídelových konců", kind: "number", min: 0, max: 300, step: 1, unit: "mm", default: 30 },
  ],
  parse: (q) => {
    const kw = has(q, "snek", "worm");
    if (!kw || has(q, "kolo", "wheel", "gear")) return null;
    const m = tagged(q, "m") ?? tagged(q, "modul");
    const qq = tagged(q, "q");
    const l = tagged(q, "l");
    const values: Record<string, string | number> = {};
    if (m) values.m = String(m);
    if (qq) values.q = qq;
    if (l) values.l = l;
    return { values, score: score(kw, (m ? 0.2 : 0) + (qq ? 0.1 : 0) + (l ? 0.1 : 0)) };
  },
  describe: (v) => `Šnek m${v.m} q${v.q} z${v.starts} – d1 ${fmt(num(v.m) * num(v.q))}`,
  make: (v) => {
    const m = num(v.m, 2);
    const qf = num(v.q, 10);
    const starts = Math.max(1, Math.round(num(v.starts, 1)));
    const l = num(v.l, 40);
    const d1 = m * qf;
    const df = d1 - 2.5 * m;
    const wire = 1.7 * m; // zjednodušení: závit jako kruhový průřez (místo lichoběžníku ZA)
    const pitch = Math.PI * m * starts;
    const f: Feature[] = [cyl("Jádro", df + 0.2 * m, l, 0, "new")];
    for (let s = 0; s < starts; s++) {
      f.push({ id: uid(), name: `Chod ${s + 1}`, type: "spring", radius: d1 / 2, pitch, turns: Math.max(1, (l - wire) / pitch), wire, position: [0, 0, wire / 2 + (s * pitch) / starts], axis: "Z", mode: "add" });
    }
    // oříznutí závitu na délku l (konce stoupání)
    f.push(cyl("Ořez dole", d1 + 3 * m, l, -l, "cut"), cyl("Ořez nahoře", d1 + 3 * m, l, l, "cut"));
    const shaft = num(v.shaft, 0);
    const sl = num(v.shaftL, 30);
    if (shaft > 0 && sl > 0) f.push(cyl("Hřídel 1", shaft, sl, -sl, "add"), cyl("Hřídel 2", shaft, sl, l, "add"), chamferAll(0.5));
    return part(`Šnek m${fmt(m)} q${fmt(qf)}`, "ocel", f, `Šnek m${fmt(m)} q${fmt(qf)} z${starts} d1 ${fmt(d1)} L${fmt(l)}`, "#c9a46a");
  },
};

export const wormWheel: Family = {
  id: "wormWheel",
  name: "Šnekové kolo",
  group: "Ozubení a řetězy",
  icon: "settings",
  standards: ["DIN 3975", "ISO 1122"],
  keywords: ["snekove kolo", "worm wheel", "worm gear", "kolo pro snek"],
  params: [
    { key: "m", label: "Modul m", kind: "enum", options: MODULES, default: "2" },
    { key: "z", label: "Počet zubů z2", kind: "number", min: 20, max: 120, step: 1, unit: "", default: 30 },
    { key: "q", label: "Součinitel q šneku", kind: "number", min: 6, max: 20, step: 1, unit: "", default: 10, hint: "pro zakřivení (hrdlo) zubů" },
    { key: "b", label: "Šířka b", kind: "number", min: 4, max: 100, step: 1, unit: "mm", default: 16 },
    ...boreParams,
  ],
  parse: (q) => {
    const kw = has(q, "snekove kolo", "snekove", "worm wheel", "worm gear");
    if (!kw) return null;
    const m = tagged(q, "m") ?? tagged(q, "modul");
    const z = tagged(q, "z") ?? tagged(q, "z2");
    const values: Record<string, string | number> = {};
    if (m) values.m = String(m);
    if (z) values.z = z;
    return { values, score: score(kw, (m ? 0.2 : 0) + (z ? 0.2 : 0)) };
  },
  describe: (v) => `Šnekové kolo m${v.m} z${v.z} b${fmt(num(v.b))}`,
  make: (v) => {
    const m = num(v.m, 2);
    const z = Math.max(20, Math.round(num(v.z, 30)));
    const qf = num(v.q, 10);
    const b = num(v.b, 16);
    // zjednodušení: válcové šnekové kolo = šikmé kolo s úhlem sklonu = úhel stoupání šneku γ (tan γ = 1/q), bez hrdla
    const gamma = Math.atan(1 / qf);
    const profile = involuteGearProfile(m, z, 20, 0, 3);
    const rp = (m * z) / 2;
    const twist = (b * Math.tan(gamma)) / rp;
    const bore = v.bore === undefined ? Math.round(m * z * 0.2) : num(v.bore);
    return part(`Šnekové kolo m${fmt(m)} z${z}`, "mosaz", [...helicalFeatures("Ozubení", profile, b, twist, 2), ...boreFeatures(bore, v.keyway !== false, b)], `Šnekové kolo m${fmt(m)} z${z} b${fmt(b)} – d2 ${fmt(m * z)} γ${fmt(gamma / DEG)}°`, "#c9a46a");
  },
};

export const GEARS2: Family[] = [helicalGear, bevelGear, worm, wormWheel];

/** export pro testy */
export const _helicalTwist = (mn: number, z: number, betaDeg: number, b: number) => (b * Math.tan(betaDeg * DEG)) / ((mn / Math.cos(betaDeg * DEG)) * z / 2);
export const _nums = nums;
export const _str = str;
