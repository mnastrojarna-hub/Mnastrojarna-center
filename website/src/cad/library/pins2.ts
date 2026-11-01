/** Kolíky a pera 2: kuželové a rýhované kolíky, úsečová pera, hřídelové čepy, závlačky. */
import { uid, type Feature } from "../types";
import { dims, has, length, nums, score } from "./parse-util";
import type { Family, ParamSchema } from "./types";
import { box, chamferAll, cyl, fmt, nearest, num, part, str, tube } from "./util";

const G = "Kolíky a pera";
const dEnum = (vals: number[], def: number, label = "Průměr d"): ParamSchema => ({ key: "d", label, kind: "enum", options: vals.map((v) => ({ v: String(v), l: `Ø${v}` })), default: String(def) });
const lParam = (def: number): ParamSchema => ({ key: "l", label: "Délka l", kind: "number", min: 4, max: 400, step: 2, unit: "mm", default: def });

function parseDL(q: string, words: string[], dVals: number[]) {
  const kw = has(q, ...words);
  if (!kw) return null;
  const dm = dims(q);
  const n = nums(q);
  const d0 = dm[0] ?? n[0];
  const l = dm[1] ?? length(q) ?? n[1];
  const values: Record<string, string | number> = {};
  if (d0) values.d = String(nearest(dVals.map((d) => ({ d })), "d", d0).d);
  if (l) values.l = l;
  return { values, score: score(kw, (d0 ? 0.2 : 0) + (l ? 0.2 : 0)) };
}

const TAPER_D = [2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20];
export const taperPin: Family = {
  id: "iso2339",
  name: "Kuželový kolík (1:50)",
  group: G,
  icon: "cone",
  standards: ["ISO 2339", "DIN 1 B", "ČSN 02 2153"],
  keywords: ["kuzelovy kolik", "kuzelovy", "taper pin", "iso 2339", "din 1"],
  params: [dEnum(TAPER_D, 6, "Průměr d (menší konec)"), lParam(40)],
  parse: (q) => (has(q, "kolo", "lozisk", "gear") ? null : parseDL(q, ["kuzelovy kolik", "kuzelov", "taper pin", "2339"], TAPER_D)),
  describe: (v) => `ISO 2339 – ${v.d}×${fmt(num(v.l))}`,
  make: (v) => {
    const d = num(v.d, 6);
    const l = num(v.l, 40);
    return part(`Kuželový kolík Ø${fmt(d)}×${fmt(l)}`, "ocel", [{ id: uid(), name: "Kolík", type: "cone", radius1: d / 2, radius2: d / 2 + l / 100, height: l, position: [0, 0, 0], axis: "Z", mode: "new" }, chamferAll(Math.min(0.5, d * 0.1))], `ISO 2339 – ${fmt(d)}×${fmt(l)} – 1:50`, "#aeb6bf");
  },
};

const GROOVE_D = [2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16];
const groovedPin = (id: string, std: string, name: string, half: boolean): Family => ({
  id,
  name,
  group: G,
  icon: "cylinder",
  standards: [std, half ? "ISO 8745" : "ISO 8740"],
  keywords: ["ryhovany kolik", "ryhovany", "grooved pin", std.toLowerCase(), half ? "8745" : "8740"],
  params: [dEnum(GROOVE_D, 6), lParam(30)],
  parse: (q) => {
    const hit = parseDL(q, ["ryhov", "grooved", std.toLowerCase().replace("din ", ""), half ? "8745" : "8740"], GROOVE_D);
    return hit && { ...hit, score: hit.score * (half === !!has(q, "polovi", "half", "1474", "8745") ? 1 : 0.85) };
  },
  describe: (v) => `${std} – ${v.d}×${fmt(num(v.l))}`,
  make: (v) => {
    const d = num(v.d, 6);
    const l = num(v.l, 30);
    const gl = half ? l / 2 : l * 0.9;
    const groove: Feature = box("Rýha", [d * 0.12, d * 0.18, gl], [0, d / 2, l - gl / 2 - (half ? 0 : l * 0.05)], "cut");
    return part(`Rýhovaný kolík Ø${fmt(d)}×${fmt(l)}`, "ocel", [cyl("Kolík", d, l, 0, "new"), groove, { id: uid(), name: "Rýhy", type: "pattern", featureId: groove.id, kind: "circular", count: 3, angle: 360, axis: "Z", center: [0, 0, 0] }, chamferAll(Math.min(0.5, d * 0.1))], `${std} – ${fmt(d)}×${fmt(l)}`, "#aeb6bf");
  },
});
export const groovedDin1473 = groovedPin("din1473", "DIN 1473", "Rýhovaný kolík s rýhami po celé délce", false);
export const groovedDin1474 = groovedPin("din1474", "DIN 1474", "Rýhovaný kolík s rýhami na polovině délky", true);

/** DIN 6888 – úsečová (Woodruff) pera: b × d1, h. */
export const WOODRUFF: { b: number; d1: number; h: number }[] = [
  { b: 2, d1: 7, h: 2.6 },
  { b: 2.5, d1: 10, h: 3.7 },
  { b: 3, d1: 13, h: 5 },
  { b: 4, d1: 13, h: 5 },
  { b: 4, d1: 16, h: 6.5 },
  { b: 5, d1: 16, h: 6.5 },
  { b: 5, d1: 19, h: 7.5 },
  { b: 6, d1: 22, h: 9 },
  { b: 6, d1: 25, h: 10 },
  { b: 8, d1: 28, h: 11 },
  { b: 10, d1: 32, h: 13 },
];
export const woodruffKey: Family = {
  id: "din6888",
  name: "Úsečové pero (Woodruff)",
  group: G,
  icon: "box",
  standards: ["DIN 6888", "ISO 3912"],
  keywords: ["usecove pero", "usecove", "woodruff", "pulmesic", "din 6888", "6888"],
  params: [{ key: "size", label: "b × d1", kind: "enum", options: WOODRUFF.map((w) => ({ v: `${w.b}x${w.d1}`, l: `${w.b}×${w.d1} (h ${w.h})` })), default: "5x16" }],
  sizes: { key: "size", columns: [{ key: "b", label: "b" }, { key: "d1", label: "d1" }, { key: "h", label: "h" }], rows: WOODRUFF.map((w) => ({ size: `${w.b}x${w.d1}`, ...w })) },
  parse: (q) => {
    const kw = has(q, "usecov", "woodruff", "pulmesic", "6888");
    if (!kw) return null;
    const dm = dims(q);
    const hit = dm.length >= 2 ? WOODRUFF.find((w) => w.b === dm[0] && w.d1 === dm[1]) : undefined;
    return { values: hit ? { size: `${hit.b}x${hit.d1}` } : {}, score: score(kw, hit ? 0.4 : 0) };
  },
  describe: (v) => `DIN 6888 – ${String(v.size).replace("x", "×")}`,
  make: (v) => {
    const [b, d1] = str(v.size, "5x16").split("x").map(Number);
    const w = WOODRUFF.find((x) => x.b === b && x.d1 === d1) ?? WOODRUFF[5];
    // kotouč Ø d1 šířky b (osa Y), seříznutý na výšku h
    return part(`Úsečové pero ${w.b}×${w.d1}`, "ocel", [{ id: uid(), name: "Kotouč", type: "cylinder", radius: w.d1 / 2, height: w.b, position: [0, -w.b / 2, 0], axis: "Y", mode: "new" }, box("Seříznutí", [w.d1 + 2, w.b + 2, w.d1], [0, 0, w.h - w.d1 / 2 - w.d1 / 2 + 0], "cut"), chamferAll(0.2)], `DIN 6888 – ${w.b}×${w.d1}`, "#aeb6bf");
  },
};

const CLEVIS_D = [6, 8, 10, 12, 14, 16, 18, 20, 24, 30, 36, 40];
const clevisPin = (id: string, std: string, name: string, head: boolean): Family => ({
  id,
  name,
  group: G,
  icon: "cylinder",
  standards: [std, head ? "ISO 2341 B" : "ISO 2340 B"],
  keywords: ["cep", "hridelovy cep", "cep s hlavou", "clevis pin", std.toLowerCase(), head ? "1444" : "1443"],
  params: [dEnum(CLEVIS_D, 12), lParam(60), { key: "groove", label: "Drážky pro pojistný kroužek", kind: "bool", default: true }],
  parse: (q) => {
    if (has(q, "kolik", "pero", "retez", "lozisk", "m20", "zavit")) return null;
    if (has(q, "sikm", "angle pin", "cam pin", "celist", "slider")) return null;
    const hit = parseDL(q, ["cep", "clevis", std.toLowerCase().replace("din ", ""), head ? "2341" : "2340"], CLEVIS_D);
    return hit && { ...hit, score: hit.score * (head === !!has(q, "s hlavou", "hlav", "head", "1444", "2341") || !has(q, "s hlavou", "hlav", "head", "bez hlavy", "1443", "1444", "2340", "2341") ? 1 : 0.85) };
  },
  describe: (v) => `${std} – ${v.d}×${fmt(num(v.l))}`,
  make: (v) => {
    const d = num(v.d, 12);
    const l = num(v.l, 60);
    const f: Feature[] = [cyl("Čep", d, l, 0, "new")];
    if (head) f.push(cyl("Hlava", d * 1.5, d * 0.5, l, "add"));
    if (v.groove !== false) {
      const w = Math.max(0.8, d * 0.1);
      const dg = d - 2 * Math.max(0.4, d * 0.05);
      f.push(tube("Drážka 1", d + 2, dg, w, d * 0.5, "cut"));
      if (!head) f.push(tube("Drážka 2", d + 2, dg, w, l - d * 0.5 - w, "cut"));
    }
    f.push(chamferAll(Math.min(1, d * 0.08)));
    return part(`Čep Ø${fmt(d)}×${fmt(l)} ${std}`, "ocel", f, `${std} – ${fmt(d)}×${fmt(l)}`, "#aeb6bf");
  },
});
export const clevisDin1444 = clevisPin("din1444", "DIN 1444", "Čep s hlavou (hřídelový čep)", true);
export const clevisDin1443 = clevisPin("din1443", "DIN 1443", "Čep bez hlavy", false);

const SPLIT_D = [1, 1.2, 1.6, 2, 2.5, 3.2, 4, 5, 6.3, 8];
export const splitPin: Family = {
  id: "iso1234",
  name: "Závlačka",
  group: G,
  icon: "sweep",
  standards: ["ISO 1234", "DIN 94", "ČSN 02 1781"],
  keywords: ["zavlacka", "split pin", "cotter pin", "iso 1234", "din 94"],
  params: [dEnum(SPLIT_D, 3.2), lParam(25)],
  parse: (q) => parseDL(q, ["zavlac", "split pin", "cotter", "1234", "din 94"], SPLIT_D),
  describe: (v) => `ISO 1234 – ${v.d}×${fmt(num(v.l))}`,
  make: (v) => {
    const d = num(v.d, 3.2);
    const l = num(v.l, 25);
    const w = d / 2; // průměr jedné větve (půlkruhový drát zjednodušen na kruh)
    const f: Feature[] = [
      cyl("Větev 1", w, l, 0, "new", "Z", [-w / 2, 0]),
      cyl("Větev 2", w, l, 0, "add", "Z", [w / 2, 0]),
      { id: uid(), name: "Oko", type: "tube", outer: d * 2.2, inner: d * 2.2 - 2 * w, height: w, position: [0, -w / 2, l + d * 1.1 - w * 0.3], axis: "Y", mode: "add" },
    ];
    return part(`Závlačka ${fmt(d)}×${fmt(l)}`, "ocel", f, `ISO 1234 – ${fmt(d)}×${fmt(l)}`, "#aeb6bf");
  },
};

export const PINS2: Family[] = [taperPin, groovedDin1473, groovedDin1474, woodruffKey, clevisDin1444, clevisDin1443, splitPin];
