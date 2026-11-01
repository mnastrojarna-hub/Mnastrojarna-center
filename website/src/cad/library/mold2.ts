/** Normálie forem 2 (HASCO / Meusburger styl): sloupky a pouzdra bez límce, vyhazovací trubky, ploché vyhazovače, šikmé čepy, temperační spojky, datumovky. */
import { uid, type Feature } from "../types";
import { dims, has, length, nums, score } from "./parse-util";
import type { Family, ParamSchema } from "./types";
import { box, chamferAll, cyl, fmt, hexPrism, nearest, num, part, revolveProfile, str, tube } from "./util";

const G = "Normálie forem";
const dEnum = (vals: number[], def: number, label = "Průměr d"): ParamSchema => ({ key: "d", label, kind: "enum", options: vals.map((v) => ({ v: String(v), l: `Ø${v}` })), default: String(def) });
const lParam = (def: number, min = 10, max = 600): ParamSchema => ({ key: "l", label: "Délka l", kind: "number", min, max, step: 5, unit: "mm", default: def });

function parseDL(q: string, words: string[], dVals?: number[]) {
  const kw = has(q, ...words);
  if (!kw) return null;
  const dm = dims(q);
  const n = nums(q).filter((x) => ![0, 1, 10, 11, 17, 18, 40, 42, 46, 81, 170].includes(x) || dm.includes(x));
  let d = dm[0] ?? n[0];
  const l = dm[1] ?? length(q) ?? n[1];
  if (d && dVals) d = nearest(dVals.map((x) => ({ d: x })), "d", d).d;
  const values: Record<string, string | number> = {};
  if (d) values.d = dVals ? String(d) : d;
  if (l) values.l = l;
  return { values, score: score(kw, (d ? 0.2 : 0) + (l ? 0.2 : 0)) };
}

/** HASCO Z01 – vodicí sloupky bez límce (nalisované): d → d1 (osazení pro lisování) */
const Z01_D = [12, 16, 20, 24, 30, 40, 50, 60];
export const guidePillarZ01: Family = {
  id: "mPillarZ01",
  name: "Vodicí sloupek bez límce (nalisovaný)",
  group: G,
  icon: "cylinder",
  standards: ["HASCO Z01", "Meusburger E1010", "DIN 9825 A"],
  keywords: ["vodici sloupek bez limce", "sloupek bez limce", "z01", "e1010", "guide pillar without collar", "leader pin plain"],
  params: [dEnum(Z01_D, 24), lParam(150, 30, 600)],
  sizes: { key: "d", columns: [{ key: "d1", label: "d1 (lisovací)" }], rows: Z01_D.map((d) => ({ d: String(d), d1: d + 4 })) },
  parse: (q) => (!has(q, "z01", "bez limce", "without collar", "e1010", "plain") || has(q, "z00", "pouzdr", "bush") ? null : parseDL(q, ["sloupek", "pillar", "z01", "e1010"], Z01_D)),
  describe: (v) => `Vodicí sloupek Z01 Ø${v.d}×${fmt(num(v.l))}`,
  make: (v) => {
    const d = num(v.d, 24);
    const l = num(v.l, 150);
    const fit = Math.min(l * 0.3, 1.5 * d);
    return part(`Vodicí sloupek Z01 Ø${fmt(d)}×${fmt(l)}`, "1.7131", [cyl("Lisovací část", d + 4, fit, 0, "new"), cyl("Vodicí část", d, l - fit, fit, "add"), chamferAll(Math.min(1.5, d * 0.08)), tube("Zápich", d + 1, d - 1.5, 1.5, fit - 1.5, "cut")], `Z01 / ${fmt(d)} × ${fmt(l)}`, "#d6d9dd");
  },
};

export const guideBushZ11: Family = {
  id: "mBushZ11",
  name: "Vodicí pouzdro bez límce",
  group: G,
  icon: "tube",
  standards: ["HASCO Z11", "Meusburger E1110", "DIN 9831 A"],
  keywords: ["vodici pouzdro bez limce", "pouzdro bez limce", "z11", "e1110", "guide bush plain"],
  params: [dEnum(Z01_D, 24), lParam(50, 15, 300)],
  parse: (q) => (!has(q, "z11", "bez limce", "without collar", "e1110", "plain") || has(q, "sloupek", "pillar", "z01") ? null : parseDL(q, ["pouzdro", "bush", "z11", "e1110"], Z01_D)),
  describe: (v) => `Vodicí pouzdro Z11 Ø${v.d}×${fmt(num(v.l))}`,
  make: (v) => {
    const d = num(v.d, 24);
    const l = num(v.l, 50);
    return part(`Vodicí pouzdro Z11 Ø${fmt(d)}×${fmt(l)}`, "1.7131", [tube("Pouzdro", d + 8, d, l, 0, "new"), chamferAll(Math.min(1, d * 0.05))], `Z11 / ${fmt(d)} × ${fmt(l)}`, "#c9a46a");
  },
};

const SLEEVE_D = [4, 5, 6, 8, 10, 12, 16, 20];
export const ejectorSleeve: Family = {
  id: "mEjectorSleeve",
  name: "Vyhazovací trubka",
  group: G,
  icon: "tube",
  standards: ["HASCO Z42", "Meusburger E1760", "DIN 16756"],
  keywords: ["vyhazovaci trubka", "trubkovy vyhazovac", "ejector sleeve", "z42", "e1760"],
  params: [dEnum(SLEEVE_D, 8, "Vnější průměr d"), { key: "di", label: "Vnitřní průměr d1", kind: "number", min: 1, max: 18, step: 0.5, unit: "mm", default: 4 }, lParam(160, 50, 500)],
  parse: (q) => {
    const hit = parseDL(q, ["vyhazovaci trubk", "trubkov", "ejector sleeve", "z42", "e1760"], SLEEVE_D);
    return hit && { values: { ...hit.values, ...(dims(q)[2] ? { l: dims(q)[2], di: dims(q)[1] } : {}) }, score: hit.score };
  },
  describe: (v) => `Vyhazovací trubka Ø${v.d}/${fmt(num(v.di))}×${fmt(num(v.l))}`,
  make: (v) => {
    const d = num(v.d, 8);
    const di = Math.min(d - 1, num(v.di, d / 2));
    const l = num(v.l, 160);
    return part(`Vyhazovací trubka Ø${fmt(d)}/${fmt(di)}×${fmt(l)}`, "1.2516", [tube("Hlava", d + 6, di, 4, 0, "new"), tube("Trubka", d, di, l, 4, "add"), chamferAll(0.3)], `Z42 / ${fmt(d)} / ${fmt(di)} × ${fmt(l)}`, "#aeb6bf");
  },
};

const FLAT = [[1, 4], [1.5, 5], [2, 6], [2.5, 8], [3, 10], [4, 12], [5, 16]];
export const flatEjector: Family = {
  id: "mFlatEjector",
  name: "Plochý vyhazovač",
  group: G,
  icon: "box",
  standards: ["HASCO Z46", "Meusburger E1720"],
  keywords: ["plochy vyhazovac", "plochy", "flat ejector", "blade ejector", "z46", "e1720"],
  params: [
    { key: "size", label: "Průřez a × b", kind: "enum", options: FLAT.map(([a, b]) => ({ v: `${a}x${b}`, l: `${a}×${b}` })), default: "2x6" },
    { key: "d", label: "Průměr dříku d", kind: "enum", options: [4, 5, 6, 8, 10, 12, 16, 20].map((x) => ({ v: String(x), l: `Ø${x}` })), default: "8" },
    lParam(160, 50, 500),
    { key: "lf", label: "Délka ploché části", kind: "number", min: 10, max: 200, step: 5, unit: "mm", default: 50 },
  ],
  parse: (q) => {
    const kw = has(q, "plochy vyhazov", "flat ejector", "blade", "z46", "e1720");
    if (!kw) return null;
    const dm = dims(q);
    const size = dm.length >= 2 ? FLAT.find(([a, b]) => a === dm[0] && b === dm[1]) : undefined;
    const l = length(q) ?? dm[2];
    return { values: { ...(size ? { size: `${size[0]}x${size[1]}` } : {}), ...(l ? { l } : {}) }, score: score(kw, (size ? 0.25 : 0) + (l ? 0.15 : 0)) };
  },
  describe: (v) => `Plochý vyhazovač ${String(v.size).replace("x", "×")} / Ø${v.d} × ${fmt(num(v.l))}`,
  make: (v) => {
    const [a, b] = str(v.size, "2x6").split("x").map(Number);
    const d = Math.max(b, num(v.d, 8));
    const l = num(v.l, 160);
    const lf = Math.min(l - 10, num(v.lf, 50));
    return part(`Plochý vyhazovač ${a}×${b}×${fmt(l)}`, "1.2516", [cyl("Hlava", d + 6, 4, 0, "new"), cyl("Dřík", d, l - lf, 4, "add"), box("Plochá část", [a, b, lf], [0, 0, 4 + l - lf + lf / 2], "add"), chamferAll(0.3)], `Z46 / ${a} × ${b} / ${fmt(d)} × ${fmt(l)}`, "#aeb6bf");
  },
};

const ANGLE_D = [12, 16, 20, 25, 30];
export const angledPin: Family = {
  id: "mAngledPin",
  name: "Šikmý čep (pro posuvné čelisti)",
  group: G,
  icon: "cylinder",
  standards: ["HASCO Z01/… šikmý", "Meusburger E1400"],
  keywords: ["sikmy cep", "sikmy kolik", "cep pro celisti", "angle pin", "cam pin", "e1400"],
  params: [dEnum(ANGLE_D, 16), lParam(120, 30, 300), { key: "angle", label: "Úhel", kind: "enum", options: [10, 15, 20, 25].map((a) => ({ v: String(a), l: `${a}°` })), default: "15" }],
  parse: (q) => {
    const hit = parseDL(q, ["sikmy cep", "sikmy", "angle pin", "cam pin", "e1400"], ANGLE_D);
    if (!hit) return null;
    const a = (q.match(/(\d{2})\s?(?:°|st|deg)/) ?? [])[1];
    return { values: { ...hit.values, ...(a && [10, 15, 20, 25].includes(Number(a)) ? { angle: a } : {}) }, score: hit.score };
  },
  describe: (v) => `Šikmý čep Ø${v.d}×${fmt(num(v.l))} – ${v.angle}°`,
  make: (v) => {
    const d = num(v.d, 16);
    const l = num(v.l, 120);
    const a = (num(v.angle, 15) * Math.PI) / 180;
    // hlava je kolmá na osu čepu; zkosení konce odpovídá úhlu
    const prof: [number, number][] = [[0, 0], [d / 2 + 3, 0], [d / 2 + 3, 6], [d / 2, 6], [d / 2, l - d * Math.tan(a) * 0.5], [d / 2 - d * 0.35, l], [0, l]];
    return part(`Šikmý čep Ø${fmt(d)}×${fmt(l)} ${v.angle}°`, "1.7131", [...revolveProfile("Čep", prof, "new"), chamferAll(0.5)], `Šikmý čep Ø${fmt(d)} × ${fmt(l)} – ${v.angle}°`, "#d6d9dd");
  },
};

const COOL_THREADS: Record<string, { od: number; s: number }> = { "G1/8": { od: 9.7, s: 12 }, "G1/4": { od: 13.2, s: 14 }, "G3/8": { od: 16.7, s: 17 } };
export const coolingPlug: Family = {
  id: "mCoolingPlug",
  name: "Temperační spojka (rychlospojka – vsuvka)",
  group: G,
  icon: "tube",
  standards: ["HASCO Z81", "Meusburger E2000", "DME"],
  keywords: ["temperacni spojka", "temperacni", "chladici spojka", "rychlospojka", "vsuvka", "cooling plug", "cooling nipple", "z81", "e2000"],
  params: [{ key: "thread", label: "Závit", kind: "enum", options: Object.keys(COOL_THREADS).map((k) => ({ v: k, l: k })), default: "G1/4" }, { key: "hose", label: "Hadice Ø", kind: "enum", options: [6, 9, 13].map((x) => ({ v: String(x), l: `Ø${x}` })), default: "9" }],
  parse: (q) => {
    const kw = has(q, "temperac", "chladici spoj", "rychlospoj", "vsuvk", "cooling plug", "cooling nipple", "z81", "e2000");
    if (!kw) return null;
    const t = (q.match(/\bg\s?(1\/8|1\/4|3\/8)\b/) ?? [])[1];
    const h = nums(q).find((x) => [6, 9, 13].includes(x));
    return { values: { ...(t ? { thread: `G${t}` } : {}), ...(h ? { hose: String(h) } : {}) }, score: score(kw, (t ? 0.2 : 0) + (h ? 0.2 : 0)) };
  },
  describe: (v) => `Temperační spojka ${v.thread} – hadice Ø${v.hose}`,
  make: (v) => {
    const th = COOL_THREADS[str(v.thread, "G1/4")] ?? COOL_THREADS["G1/4"];
    const hose = num(v.hose, 9);
    return part(`Temperační spojka ${v.thread}`, "mosaz", [cyl("Závit", th.od, 10, 0, "new"), chamferAll(0.4), ...hexPrism("Šestihran", th.s, 6, 10, "add"), ...revolveProfile("Vsuvka", [[0, 16], [hose / 2 + 1.5, 16], [hose / 2 + 1.5, 20], [hose / 2 + 3, 22], [hose / 2 + 3, 25], [hose / 2 + 1, 27], [hose / 2 + 1, 32], [0, 32]], "add"), cyl("Kanál", hose * 0.6, 40, -1, "cut")], `Z81 / ${v.thread} / Ø${hose}`, "#c9a46a");
  },
};

export const dateStamp: Family = {
  id: "mDateStamp",
  name: "Datumovka (vložka s datem)",
  group: G,
  icon: "tube",
  standards: ["HASCO Z170", "Meusburger E2440"],
  keywords: ["datumovka", "datova vlozka", "date stamp", "date insert", "z170", "e2440"],
  params: [dEnum([4, 6, 8, 10, 12, 16, 20], 8), { key: "l", label: "Délka", kind: "number", min: 10, max: 80, step: 1, unit: "mm", default: 20 }],
  parse: (q) => parseDL(q, ["datumovk", "datova vlozk", "date stamp", "date insert", "z170", "e2440"], [4, 6, 8, 10, 12, 16, 20]),
  describe: (v) => `Datumovka Ø${v.d}×${fmt(num(v.l))}`,
  make: (v) => {
    const d = num(v.d, 8);
    const l = num(v.l, 20);
    const f: Feature[] = [cyl("Pouzdro", d, l, 0, "new"), chamferAll(0.2), cyl("Šipka – vložka", d * 0.5, 0.3, l, "add"), tube("Mezikruží", d * 0.95, d * 0.55, 0.3, l - 0.3, "cut")];
    for (let i = 0; i < 12; i++) f.push({ id: uid(), name: `Měsíc ${i + 1}`, type: "cylinder", radius: d * 0.05, height: 0.4, position: [(d * 0.37) * Math.cos((2 * Math.PI * i) / 12), (d * 0.37) * Math.sin((2 * Math.PI * i) / 12), l - 0.3], axis: "Z", mode: "cut" });
    return part(`Datumovka Ø${fmt(d)}`, "nerez", f, `Z170 / ${fmt(d)} × ${fmt(l)}`, "#b9c2cc");
  },
};

export const MOLD2: Family[] = [guidePillarZ01, guideBushZ11, ejectorSleeve, flatEjector, angledPin, coolingPlug, dateStamp];
export const _box = box;
export const _uid = uid;
