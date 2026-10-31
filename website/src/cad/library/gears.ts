/** Ozubení: čelní kola s evolventou, vnitřní ozubení, hřebeny, řetězová kola, ozubené a klínové řemenice. */
import type { Feature, Vec2 } from "../types";
import { has, nums, score, tagged } from "./parse-util";
import { CHAINS, HTD, keyForShaft } from "./tables";
import type { Family, ParamSchema } from "./types";
import { chamferAll, cyl, extrudePoly, fmt, keywayCut, num, part, revolveProfile, rnd, str } from "./util";

const DEG = Math.PI / 180;
const inv = (a: number) => Math.tan(a) - a;

/** Body evolventního ozubení (vnější kolo) – uzavřená lomená čára se všemi zuby. */
export function involuteGearProfile(m: number, z: number, alphaDeg = 20, x = 0, samples = 7): Vec2[] {
  const a = alphaDeg * DEG;
  const rp = (m * z) / 2;
  const rb = rp * Math.cos(a);
  const ra = m * (z / 2 + 1 + x);
  const rf = m * (z / 2 - 1.25 + x);
  const psiP = (Math.PI / 2 + 2 * x * Math.tan(a)) / z; // poloviční úhlová tloušťka zubu na roztečné kružnici
  const half = (r: number) => psiP + inv(a) - inv(Math.acos(Math.min(1, rb / r)));
  // špičatý zub (velká korekce / málo zubů): hlavovou kružnici snížit, aby zůstala hlava zubu
  let raEff = ra;
  while (half(raEff) < 0.004 && raEff > rp) raEff -= 0.02 * m;
  const pts: Vec2[] = [];
  const rStart = Math.max(rb, rf);
  const n = z > 100 ? Math.max(4, samples - 3) : samples;
  const polar = (r: number, th: number): Vec2 => [rnd(r * Math.cos(th), 5), rnd(r * Math.sin(th), 5)];
  const foot = half(rStart) + (rf < rb ? 0.012 : 0); // úhel paty zubu na rf
  const step = (2 * Math.PI) / z;
  for (let i = 0; i < z; i++) {
    const th0 = step * i;
    // dno mezery na rf: od paty předchozího zubu k patě tohoto
    const a0 = th0 - step + foot;
    const a1 = th0 - foot;
    for (let k = 1; k <= 3; k++) pts.push(polar(rf, a0 + ((a1 - a0) * k) / 3));
    if (rf < rb) pts.push(polar(rb, th0 - half(rb)));
    for (let k = 1; k <= n; k++) {
      const r = rStart + ((raEff - rStart) * k) / n;
      pts.push(polar(r, th0 - half(r)));
    }
    pts.push(polar(raEff, th0));
    for (let k = n; k >= 0; k--) {
      const r = rStart + ((raEff - rStart) * k) / n;
      pts.push(polar(r, th0 + half(r)));
    }
    if (rf < rb) pts.push(polar(rf, th0 + foot));
  }
  return pts;
}

/** Profil ozubeného hřebenu (lichoběžníkové zuby 20°), délka n·π·m, výška h. */
export function rackProfile(m: number, n: number, h: number, alphaDeg = 20): Vec2[] {
  const p = Math.PI * m;
  const ha = m;
  const hf = 1.25 * m;
  const dx = Math.tan(alphaDeg * DEG);
  const pts: Vec2[] = [[0, -h], [0, 0]];
  for (let i = 0; i < n; i++) {
    const x0 = i * p;
    // mezera od x0 do x0+p/2 (na roztečné přímce), zub od x0+p/2 do x0+p
    pts.push([x0 + hf * dx, -hf], [x0 + p / 2 - hf * dx, -hf], [x0 + p / 2 + ha * dx, ha], [x0 + p - ha * dx, ha]);
  }
  pts.push([n * p, 0], [n * p, -h]);
  return pts;
}

/** Profil řetězového kola podle ISO 606 (zjednodušený tvar: sedlo válečku + přímkové boky). */
export function sprocketProfile(p: number, d1: number, z: number): { pts: Vec2[]; dp: number; da: number; df: number } {
  const dp = p / Math.sin(Math.PI / z);
  const df = dp - d1;
  const da = dp + 1.25 * p - d1 - 0.6 * p * (1 - Math.min(1, z / 60)); // mezi ISO min a max
  const ri = 0.505 * d1 + 0.069 * Math.cbrt(d1); // poloměr sedla
  const alpha = (140 - 90 / z) * DEG; // úhel sedla
  const pts: Vec2[] = [];
  const polar = (r: number, th: number): Vec2 => [rnd(r * Math.cos(th), 5), rnd(r * Math.sin(th), 5)];
  for (let i = 0; i < z; i++) {
    const th = (2 * Math.PI * i) / z; // střed mezery (osa válečku)
    const c: Vec2 = [(dp / 2) * Math.cos(th), (dp / 2) * Math.sin(th)];
    // sedlo: oblouk kolem c od (th + π + α/2) do (th + π − α/2) přes střed kola
    const n = 8;
    for (let k = 0; k <= n; k++) {
      const a = th + Math.PI + alpha / 2 - (alpha * k) / n;
      pts.push([rnd(c[0] + ri * Math.cos(a), 5), rnd(c[1] + ri * Math.sin(a), 5)]);
    }
    // bok k hlavě zubu (střed zubu je na th + π/z)
    const tipHalf = Math.min(Math.PI / z / 3, (0.1 * p) / (da / 2));
    pts.push(polar(da / 2, th + Math.PI / z - tipHalf), polar(da / 2, th + Math.PI / z + tipHalf));
  }
  return { pts, dp, da, df };
}

const boreParams: ParamSchema[] = [
  { key: "bore", label: "Díra d", kind: "number", min: 0, max: 300, step: 1, unit: "mm", default: 0, hint: "0 = plný" },
  { key: "keyway", label: "Drážka pro pero DIN 6885", kind: "bool", default: true },
  { key: "hub", label: "Náboj Ø", kind: "number", min: 0, max: 500, step: 1, unit: "mm", default: 0, hint: "0 = bez náboje" },
  { key: "hubL", label: "Délka náboje", kind: "number", min: 0, max: 300, step: 1, unit: "mm", default: 0 },
];

function boreFeatures(bore: number, keyway: boolean, hub: number, hubL: number, width: number): Feature[] {
  const f: Feature[] = [];
  if (hub > 0 && hubL > 0) f.push(cyl("Náboj", hub, hubL, width, "add"));
  const total = width + (hub > 0 ? hubL : 0);
  if (bore > 0) {
    f.push(cyl("Díra", bore, total + 2, -1, "cut"));
    if (keyway) {
      const k = keyForShaft(bore);
      f.push(keywayCut(bore, k.b, k.t2, total, 0));
    }
  }
  return f;
}

const autoBore = (dRef: number) => Math.max(0, Math.round(dRef * 0.25));

export const spurGear: Family = {
  id: "gear",
  name: "Čelní ozubené kolo s přímými zuby",
  group: "Ozubení a řetězy",
  icon: "settings",
  standards: ["ISO 53", "DIN 867", "ČSN 01 4607"],
  keywords: ["ozubene kolo", "ozubeni", "kolo", "gear", "spur gear", "pastorek", "pinion", "modul"],
  params: [
    { key: "m", label: "Modul m", kind: "enum", options: [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((x) => ({ v: String(x), l: String(x) })), default: "2" },
    { key: "z", label: "Počet zubů z", kind: "number", min: 8, max: 200, step: 1, unit: "", default: 24 },
    { key: "b", label: "Šířka b", kind: "number", min: 1, max: 300, step: 1, unit: "mm", default: 20 },
    { key: "x", label: "Korekce x", kind: "number", min: -0.5, max: 0.8, step: 0.05, unit: "", default: 0 },
    { key: "alpha", label: "Úhel záběru", kind: "enum", options: [{ v: "20", l: "20°" }, { v: "14.5", l: "14,5°" }, { v: "25", l: "25°" }], default: "20" },
    ...boreParams,
  ],
  parse: (q) => {
    const kw = has(q, "ozuben", "gear", "pastorek", "pinion", "modul", "kolo");
    if (!kw || has(q, "retez", "sprocket", "remen", "pulley", "hreben", "rack", "vnitrn", "internal")) return null;
    const m = tagged(q, "m") ?? tagged(q, "modul");
    const z = tagged(q, "z");
    const b = tagged(q, "b");
    const d = tagged(q, "d");
    const values: Record<string, string | number> = {};
    if (m) values.m = String(m);
    if (z) values.z = z;
    if (b) values.b = b;
    if (d) values.bore = d;
    if (!m && !z) {
      const n = nums(q);
      if (n[0] && n[0] <= 10) values.m = String(n[0]);
      if (n[1] && n[1] >= 8) values.z = n[1];
    }
    return { values, score: score(kw, (values.m ? 0.15 : 0) + (values.z ? 0.15 : 0) + (b ? 0.1 : 0)) };
  },
  describe: (v) => `Ozubené kolo m${v.m} z${v.z} b${fmt(num(v.b))} – da ${fmt(num(v.m) * (num(v.z) + 2 + 2 * num(v.x)))}`,
  make: (v) => {
    const m = num(v.m, 2);
    const z = Math.max(8, Math.round(num(v.z, 24)));
    const b = num(v.b, 10 * m);
    const bore = v.bore === undefined ? autoBore(m * z) : num(v.bore);
    const pts = involuteGearProfile(m, z, num(v.alpha, 20), num(v.x, 0));
    return part(`Ozubené kolo m${fmt(m)} z${z}`, "ocel", [...extrudePoly("Ozubení", pts, b, "new"), ...boreFeatures(bore, v.keyway !== false, num(v.hub), num(v.hubL), b)], `Ozubené kolo m${fmt(m)} z${z} b${fmt(b)} α${v.alpha ?? 20}° x${fmt(num(v.x))}`, "#c9a46a");
  },
};

export const internalGear: Family = {
  id: "gearInternal",
  name: "Kolo s vnitřním ozubením (věnec)",
  group: "Ozubení a řetězy",
  icon: "tube",
  standards: ["ISO 53", "DIN 867"],
  keywords: ["vnitrni ozubeni", "venec", "internal gear", "ring gear", "planetov"],
  params: [
    { key: "m", label: "Modul m", kind: "enum", options: [1, 1.25, 1.5, 2, 2.5, 3, 4, 5].map((x) => ({ v: String(x), l: String(x) })), default: "2" },
    { key: "z", label: "Počet zubů z", kind: "number", min: 20, max: 200, step: 1, unit: "", default: 60 },
    { key: "b", label: "Šířka b", kind: "number", min: 1, max: 300, step: 1, unit: "mm", default: 20 },
    { key: "rim", label: "Tloušťka věnce", kind: "number", min: 2, max: 100, step: 1, unit: "mm", default: 8 },
  ],
  parse: (q) => {
    const kw = has(q, "vnitrni ozub", "venec", "internal gear", "ring gear", "planet");
    if (!kw) return null;
    const m = tagged(q, "m");
    const z = tagged(q, "z");
    return { values: { ...(m ? { m: String(m) } : {}), ...(z ? { z } : {}) }, score: score(kw, (m ? 0.15 : 0) + (z ? 0.15 : 0)) };
  },
  describe: (v) => `Věnec m${v.m} z${v.z} b${fmt(num(v.b))}`,
  make: (v) => {
    const m = num(v.m, 2);
    const z = Math.max(20, Math.round(num(v.z, 60)));
    const b = num(v.b, 20);
    const rim = num(v.rim, 8);
    // mezery vnitřního kola = „zuby“ vnějšího profilu s prohozeným hlavovým/patním převýšením
    const cutter = involuteGearProfile(m, z, 20, 0.25);
    const outer = m * (z / 2 + 1.25) * 2 + 2 * rim;
    return part(`Věnec m${fmt(m)} z${z}`, "ocel", [cyl("Věnec", outer, b, 0, "new"), ...extrudePoly("Vnitřní ozubení", cutter, b + 2, "cut", -1)], `Vnitřní ozubení m${fmt(m)} z${z} b${fmt(b)}`, "#c9a46a");
  },
};

export const rack: Family = {
  id: "rack",
  name: "Ozubený hřeben",
  group: "Ozubení a řetězy",
  icon: "table",
  standards: ["DIN 867"],
  keywords: ["hreben", "ozubeny hreben", "rack", "gear rack"],
  params: [
    { key: "m", label: "Modul m", kind: "enum", options: [1, 1.5, 2, 2.5, 3, 4, 5, 6].map((x) => ({ v: String(x), l: String(x) })), default: "2" },
    { key: "n", label: "Počet zubů", kind: "number", min: 2, max: 500, step: 1, unit: "", default: 40 },
    { key: "b", label: "Šířka b", kind: "number", min: 2, max: 200, step: 1, unit: "mm", default: 20 },
    { key: "h", label: "Výška tělesa", kind: "number", min: 2, max: 200, step: 1, unit: "mm", default: 20 },
  ],
  parse: (q) => {
    const kw = has(q, "hreben", "rack");
    if (!kw) return null;
    const m = tagged(q, "m");
    const n = tagged(q, "z") ?? tagged(q, "n");
    const l = tagged(q, "l");
    const values: Record<string, string | number> = {};
    if (m) values.m = String(m);
    if (n) values.n = n;
    else if (l && m) values.n = Math.round(l / (Math.PI * m));
    return { values, score: score(kw, (m ? 0.15 : 0) + (values.n ? 0.15 : 0)) };
  },
  describe: (v) => `Hřeben m${v.m} × ${v.n} zubů, L=${fmt(Math.PI * num(v.m) * num(v.n))}`,
  make: (v) => {
    const m = num(v.m, 2);
    const n = Math.max(2, Math.round(num(v.n, 40)));
    return part(`Hřeben m${fmt(m)} ${n} zubů`, "ocel", [...extrudePoly("Hřeben", rackProfile(m, n, num(v.h, 20)), num(v.b, 20), "new")], `Ozubený hřeben m${fmt(m)} L${fmt(Math.PI * m * n)} b${fmt(num(v.b, 20))}`, "#c9a46a");
  },
};

export const sprocket: Family = {
  id: "sprocket",
  name: "Řetězové kolo pro válečkový řetěz",
  group: "Ozubení a řetězy",
  icon: "settings",
  standards: ["ISO 606", "DIN 8187/8188", "ČSN 01 4811"],
  keywords: ["retezove kolo", "retezka", "retez", "sprocket", "chain wheel", "08b", "10b", "12b", "16b"],
  params: [
    { key: "chain", label: "Řetěz", kind: "enum", options: Object.keys(CHAINS).map((k) => ({ v: k, l: `${k} (p=${CHAINS[k].p})` })), default: "08B" },
    { key: "z", label: "Počet zubů z", kind: "number", min: 7, max: 150, step: 1, unit: "", default: 19 },
    { key: "rows", label: "Řady", kind: "enum", options: [{ v: "1", l: "jednořadý (-1)" }, { v: "2", l: "dvouřadý (-2)" }, { v: "3", l: "třířadý (-3)" }], default: "1" },
    ...boreParams,
  ],
  sizes: { key: "chain", columns: [{ key: "p", label: "p" }, { key: "d1", label: "d1 váleček" }, { key: "b1", label: "b1" }], rows: Object.entries(CHAINS).map(([k, v]) => ({ chain: k, ...v })) },
  parse: (q) => {
    const kw = has(q, "retez", "sprocket", "chain");
    const chain = (q.match(/\b(0?5b|06b|08b|10b|12b|16b|20b|24b)(?:-\d)?\b/) ?? [])[1] ?? (kw ? (q.match(/\b(35|40|50|60|80)\b/) ?? [])[1] : undefined);
    if (!kw && !chain) return null;
    const rows = (q.match(/\b(?:0?5b|06b|08b|10b|12b|16b|20b|24b|35|40|50|60|80)-(\d)\b/) ?? [])[1];
    const z = tagged(q, "z") ?? (chain ? nums(q.replace(chain, "")).find((n) => n >= 7 && n <= 150 && Number.isInteger(n)) : undefined);
    const values: Record<string, string | number> = {};
    if (chain) values.chain = chain.toUpperCase().replace(/^5B$/, "05B");
    if (z) values.z = z;
    if (rows) values.rows = rows;
    return { values, score: score(kw, (chain ? 0.25 : 0) + (z ? 0.15 : 0)) || 0.5 };
  },
  describe: (v) => {
    const c = CHAINS[str(v.chain)] ?? CHAINS["08B"];
    return `Řetězové kolo ${v.chain}-${v.rows ?? 1} z${v.z} – dp ${fmt(c.p / Math.sin(Math.PI / num(v.z, 19)))}`;
  },
  make: (v) => {
    const code = str(v.chain, "08B");
    const c = CHAINS[code] ?? CHAINS["08B"];
    const z = Math.max(7, Math.round(num(v.z, 19)));
    const rows = Math.max(1, Math.round(num(v.rows, 1)));
    const { pts, dp } = sprocketProfile(c.p, c.d1, z);
    const bf = rnd(0.93 * c.b1, 2); // šířka zubu (simplex)
    const pt = c.p * 1.1 + 0.4 * c.p; // rozteč řad (přibližně)
    const f: Feature[] = [];
    for (let i = 0; i < rows; i++) {
      f.push(...extrudePoly(`Ozubení${rows > 1 ? " " + (i + 1) : ""}`, pts, bf, i === 0 ? "new" : "add", i * pt));
      if (i < rows - 1) f.push(cyl("Mezikus", dp - c.d1 - 2 * c.p * 0.2, pt - bf, i * pt + bf, "add"));
    }
    const width = (rows - 1) * pt + bf;
    const bore = v.bore === undefined ? autoBore(dp) : num(v.bore);
    const hub = num(v.hub);
    const hubL = num(v.hubL);
    f.push(...boreFeatures(bore, v.keyway !== false, hub, hubL, width));
    if (c.p >= 12.7) f.push(chamferAll(Math.min(0.5, c.p * 0.03)));
    return part(`Řetězové kolo ${code}-${rows} z${z}`, "ocel", f, `ISO 606 – ${code}-${rows} z${z}`, "#9aa4ad");
  },
};

export const htdPulley: Family = {
  id: "htd",
  name: "Ozubená řemenice HTD",
  group: "Řemenice",
  icon: "settings",
  standards: ["ISO 13050", "HTD"],
  keywords: ["ozubena remenice", "remenice htd", "htd", "timing pulley", "5m", "8m", "gt2"],
  params: [
    { key: "profile", label: "Profil", kind: "enum", options: Object.keys(HTD).map((k) => ({ v: k, l: `HTD ${k}` })), default: "5M" },
    { key: "z", label: "Počet zubů z", kind: "number", min: 10, max: 200, step: 1, unit: "", default: 32 },
    { key: "w", label: "Šířka řemene", kind: "enum", options: [9, 15, 20, 25, 30, 50, 85].map((x) => ({ v: String(x), l: `${x} mm` })), default: "15" },
    { key: "flanges", label: "Bočnice", kind: "bool", default: true },
    ...boreParams,
  ],
  parse: (q) => {
    const kw = has(q, "remenic", "pulley", "htd", "ozuben", "gt2");
    const prof = (q.match(/\b(3m|5m|8m|14m)\b/) ?? [])[1];
    if (!kw && !prof) return null;
    if (!prof && !has(q, "htd", "ozubena remenic", "timing")) return null;
    const z = tagged(q, "z") ?? nums(q.replace(/\b\d+m\b/g, "")).find((n) => n >= 10 && n <= 200 && Number.isInteger(n));
    const values: Record<string, string | number> = {};
    if (prof) values.profile = prof.toUpperCase();
    if (z) values.z = z;
    return { values, score: score(kw, (prof ? 0.25 : 0) + (z ? 0.15 : 0)) || 0.5 };
  },
  describe: (v) => `Řemenice HTD ${v.profile} – ${v.z} zubů – šířka ${v.w}`,
  make: (v) => {
    const h = HTD[str(v.profile, "5M")] ?? HTD["5M"];
    const z = Math.max(10, Math.round(num(v.z, 32)));
    const w = num(v.w, 15) + (h.p >= 8 ? 3 : 2);
    const dp = (z * h.p) / Math.PI;
    const da = dp - 2 * h.pld;
    const f: Feature[] = [cyl("Tělo", da, w, 0, "new")];
    const groove: Feature = cyl("Zub", h.r * 2, w + 2, -1, "cut", "Z", [da / 2 - h.h + h.r, 0]);
    f.push(groove, { id: groove.id + "p", name: "Zuby", type: "pattern", featureId: groove.id, kind: "circular", count: z, angle: 360, axis: "Z", center: [0, 0, 0] });
    if (v.flanges !== false) {
      const fd = da + 2 * h.h + 2;
      f.push(cyl("Bočnice 1", fd, 1.2, -1.2, "add"), cyl("Bočnice 2", fd, 1.2, w, "add"));
    }
    const bore = v.bore === undefined ? autoBore(dp) : num(v.bore);
    f.push(...boreFeatures(bore, v.keyway !== false, num(v.hub), num(v.hubL), w + (v.flanges !== false ? 1.2 : 0)));
    return part(`Řemenice HTD ${str(v.profile, "5M")} z${z}`, "hlinik", f, `HTD ${str(v.profile, "5M")}-${z}-${v.w}`, "#d6d9dd");
  },
};

const VBELT: Record<string, { bw: number; h: number; e: number; f: number }> = {
  SPZ: { bw: 8.5, h: 11, e: 12, f: 8 },
  SPA: { bw: 11, h: 14, e: 15, f: 10 },
  SPB: { bw: 14, h: 18, e: 19, f: 12.5 },
  SPC: { bw: 19, h: 24, e: 25.5, f: 17 },
};

export const vPulley: Family = {
  id: "vpulley",
  name: "Klínová řemenice",
  group: "Řemenice",
  icon: "settings",
  standards: ["ISO 4183", "DIN 2211"],
  keywords: ["klinova remenice", "remenice", "v-belt pulley", "spz", "spa", "spb", "spc"],
  params: [
    { key: "profile", label: "Profil řemene", kind: "enum", options: Object.keys(VBELT).map((k) => ({ v: k, l: k })), default: "SPA" },
    { key: "dp", label: "Výpočtový průměr dp", kind: "number", min: 50, max: 1000, step: 5, unit: "mm", default: 125 },
    { key: "grooves", label: "Počet drážek", kind: "number", min: 1, max: 8, step: 1, unit: "", default: 2 },
    ...boreParams,
  ],
  parse: (q) => {
    const kw = has(q, "klinova remenic", "remenic", "pulley", "spz", "spa", "spb", "spc");
    const prof = (q.match(/\b(spz|spa|spb|spc)\b/) ?? [])[1];
    if (!kw || (has(q, "htd", "ozuben", "timing") && !prof)) return null;
    const dp = tagged(q, "dp") ?? tagged(q, "d") ?? nums(q).find((n) => n >= 50);
    const g = (q.match(/(\d)\s*(?:draz|groov)/) ?? [])[1];
    const values: Record<string, string | number> = {};
    if (prof) values.profile = prof.toUpperCase();
    if (dp) values.dp = dp;
    if (g) values.grooves = Number(g);
    return { values, score: score(kw, (prof ? 0.2 : 0) + (dp ? 0.15 : 0)) };
  },
  describe: (v) => `Řemenice ${v.profile} dp${fmt(num(v.dp))} × ${v.grooves} drážky`,
  make: (v) => {
    const p = VBELT[str(v.profile, "SPA")] ?? VBELT.SPA;
    const dp = num(v.dp, 125);
    const n = Math.max(1, Math.round(num(v.grooves, 2)));
    const width = 2 * p.f + (n - 1) * p.e;
    const da = dp + 2 * (p.h * 0.2);
    const prof: Vec2[] = [[0, 0], [da / 2, 0]];
    const half = Math.tan((34 / 2) * DEG);
    for (let i = 0; i < n; i++) {
      const zc = p.f + i * p.e;
      const top = p.bw / 2 + 0.2 * p.h * half;
      prof.push([da / 2, zc - top], [da / 2 - p.h, zc - top + p.h * half], [da / 2 - p.h, zc + top - p.h * half], [da / 2, zc + top]);
    }
    prof.push([da / 2, width], [0, width]);
    const bore = v.bore === undefined ? autoBore(dp) : num(v.bore);
    return part(`Řemenice ${str(v.profile, "SPA")} dp${fmt(dp)}`, "ocel", [...revolveProfile("Řemenice", prof, "new"), ...boreFeatures(bore, v.keyway !== false, num(v.hub), num(v.hubL), width)], `Řemenice ${str(v.profile, "SPA")} ${fmt(dp)}×${n}`, "#7f8a96");
  },
};

export const GEARS: Family[] = [spurGear, internalGear, rack, sprocket, htdPulley, vPulley];
