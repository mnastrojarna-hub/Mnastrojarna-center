/** Potrubí a příruby: závitové trubky EN 10255, příruby PN16 EN 1092-1, hadicové nátrubky. */
import { uid, type Feature } from "../types";
import { has, length, nums, score } from "./parse-util";
import type { Family } from "./types";
import { chamferAll, cyl, fmt, hexPrism, num, part, revolveProfile, str, tube } from "./util";

const G = "Potrubí a příruby";

/** EN 10255 (BS 1387) – závitové trubky: označení R → vnější Ø, tloušťka stěny (střední řada), DN. */
export const PIPES: Record<string, { od: number; t: number; dn: number }> = {
  "1/8": { od: 10.2, t: 2.0, dn: 6 },
  "1/4": { od: 13.5, t: 2.3, dn: 8 },
  "3/8": { od: 17.2, t: 2.3, dn: 10 },
  "1/2": { od: 21.3, t: 2.6, dn: 15 },
  "3/4": { od: 26.9, t: 2.6, dn: 20 },
  "1": { od: 33.7, t: 3.2, dn: 25 },
  "1 1/4": { od: 42.4, t: 3.2, dn: 32 },
  "1 1/2": { od: 48.3, t: 3.2, dn: 40 },
  "2": { od: 60.3, t: 3.6, dn: 50 },
  "2 1/2": { od: 76.1, t: 3.6, dn: 65 },
  "3": { od: 88.9, t: 4.0, dn: 80 },
  "4": { od: 114.3, t: 4.5, dn: 100 },
};
/** EN 1092-1 PN16 – příruby: D vnější, k roztečná, n počet děr, l průměr děr, b tloušťka, d1 těsnicí lišta, pipe Ø trubky. */
export const FLANGES: Record<string, { D: number; k: number; n: number; l: number; b: number; d1: number; pipe: number }> = {
  DN15: { D: 95, k: 65, n: 4, l: 14, b: 16, d1: 45, pipe: 21.3 },
  DN20: { D: 105, k: 75, n: 4, l: 14, b: 18, d1: 58, pipe: 26.9 },
  DN25: { D: 115, k: 85, n: 4, l: 14, b: 18, d1: 68, pipe: 33.7 },
  DN32: { D: 140, k: 100, n: 4, l: 18, b: 18, d1: 78, pipe: 42.4 },
  DN40: { D: 150, k: 110, n: 4, l: 18, b: 18, d1: 88, pipe: 48.3 },
  DN50: { D: 165, k: 125, n: 4, l: 18, b: 20, d1: 102, pipe: 60.3 },
  DN65: { D: 185, k: 145, n: 8, l: 18, b: 20, d1: 122, pipe: 76.1 },
  DN80: { D: 200, k: 160, n: 8, l: 18, b: 20, d1: 138, pipe: 88.9 },
  DN100: { D: 220, k: 180, n: 8, l: 18, b: 22, d1: 158, pipe: 114.3 },
  DN125: { D: 250, k: 210, n: 8, l: 18, b: 22, d1: 188, pipe: 139.7 },
  DN150: { D: 285, k: 240, n: 8, l: 22, b: 22, d1: 212, pipe: 168.3 },
  DN200: { D: 340, k: 295, n: 12, l: 22, b: 24, d1: 268, pipe: 219.1 },
};

const inchOf = (q: string): string | undefined => {
  const m = q.match(/(\d\s)?(1\/8|1\/4|3\/8|1\/2|3\/4)(?:\s?["”]|\s?palc)?/) ?? q.match(/\b(\d)\s?["”]/);
  if (!m) return undefined;
  if (m[1]) return `${m[1].trim()} ${m[2]}`;
  return m[2] ?? m[1];
};
const dnOf = (q: string): number | undefined => {
  const m = q.match(/\bdn\s?(\d{1,3})\b/);
  return m ? Number(m[1]) : undefined;
};

export const threadedPipe: Family = {
  id: "pipeR",
  name: "Závitová ocelová trubka (R/G)",
  group: G,
  icon: "tube",
  standards: ["EN 10255", "BS 1387", "ISO 65", "DIN 2440"],
  keywords: ["zavitova trubka", "trubka dn", "ocelova trubka", "plynarska trubka", "threaded pipe", "gas pipe", "din 2440", "en 10255", "trubka"],
  params: [
    { key: "size", label: "Jmenovitá velikost", kind: "enum", options: Object.keys(PIPES).map((k) => ({ v: k, l: `R ${k}" (DN${PIPES[k].dn}, Ø${PIPES[k].od})` })), default: "1/2" },
    { key: "l", label: "Délka L", kind: "number", min: 10, max: 6000, step: 10, unit: "mm", default: 1000 },
  ],
  sizes: { key: "size", columns: [{ key: "dn", label: "DN" }, { key: "od", label: "Ø vnější" }, { key: "t", label: "stěna" }], rows: Object.entries(PIPES).map(([k, v]) => ({ size: k, ...v })) },
  parse: (q) => {
    const kw = has(q, "zavitova trubka", "trubk", "pipe", "2440", "10255", "plynar", "dn");
    if (!kw || has(q, "prirub", "flange", "chs", "bezesv", "presn", "natrubek", "hadic", "sroubeni", "spojk", "vsuvk", "vyhazovaci", "trubkov", "z42", "pneumat")) return null;
    const inch = inchOf(q);
    const dn = dnOf(q);
    const size = inch && PIPES[inch] ? inch : dn ? Object.keys(PIPES).find((k) => PIPES[k].dn === dn) : undefined;
    if (!size && !has(q, "zavit", "palc", "dn", "plynar", "2440", "10255")) return null;
    const l = length(q) ?? nums(q).find((x) => x >= 100 && x !== dn);
    return { values: { ...(size ? { size } : {}), ...(l ? { l } : {}) }, score: score(kw || 4, (size ? 0.3 : 0) + (l ? 0.1 : 0)) };
  },
  describe: (v) => `Trubka R ${v.size}" (DN${PIPES[str(v.size)]?.dn}) – L ${fmt(num(v.l))}`,
  make: (v) => {
    const size = str(v.size, "1/2");
    const p = PIPES[size] ?? PIPES["1/2"];
    const l = num(v.l, 1000);
    return part(`Trubka R ${size}" L${fmt(l)}`, "ocel", [tube("Trubka", p.od, p.od - 2 * p.t, l, 0, "new")], `EN 10255 – R ${size}" (DN${p.dn}) × ${fmt(l)}`, "#7f8a96");
  },
};

const TYPES = [
  { v: "01", l: "01 – plochá přivařovací" },
  { v: "05", l: "05 – zaslepovací" },
  { v: "11", l: "11 – krková přivařovací" },
];
export const flangePN16: Family = {
  id: "flangePN16",
  name: "Příruba PN16 (EN 1092-1)",
  group: G,
  icon: "tube",
  standards: ["EN 1092-1", "PN16", "DIN 2573/2633"],
  keywords: ["priruba", "pn16", "pn 16", "en 1092", "flange", "zaslepovaci", "krkova", "dn50", "dn80", "dn100"],
  params: [
    { key: "dn", label: "DN", kind: "enum", options: Object.keys(FLANGES).map((k) => ({ v: k, l: `${k} (D ${FLANGES[k].D})` })), default: "DN50" },
    { key: "type", label: "Typ", kind: "enum", options: TYPES, default: "01" },
  ],
  sizes: { key: "dn", columns: [{ key: "D", label: "D" }, { key: "k", label: "k" }, { key: "n", label: "děr" }, { key: "l", label: "Ø děr" }, { key: "b", label: "b" }], rows: Object.entries(FLANGES).map(([k, v]) => ({ dn: k, ...v })) },
  parse: (q) => {
    const kw = has(q, "prirub", "flange", "pn16", "pn 16", "1092");
    if (!kw || has(q, "matice", "nut", "vozik", "lozisk")) return null;
    const dn = dnOf(q);
    const key = dn ? `DN${dn}` : undefined;
    const type = has(q, "zaslep", "blind") ? "05" : has(q, "krk", "neck") ? "11" : undefined;
    return { values: { ...(key && FLANGES[key] ? { dn: key } : {}), ...(type ? { type } : {}) }, score: score(kw, (key && FLANGES[key] ? 0.3 : 0) + (type ? 0.1 : 0)) };
  },
  describe: (v) => `Příruba ${v.dn} PN16 typ ${v.type}`,
  make: (v) => {
    const key = str(v.dn, "DN50");
    const fl = FLANGES[key] ?? FLANGES.DN50;
    const type = str(v.type, "01");
    const f: Feature[] = [cyl("Příruba", fl.D, fl.b, 0, "new"), chamferAll(1), cyl("Těsnicí lišta", fl.d1, 2, fl.b, "add")];
    if (type === "11") {
      const neckH = fl.b * 2.2;
      f.push(...revolveProfile("Krk", [[fl.pipe / 2 - 1, 0], [fl.pipe / 2 + fl.b * 0.9, 0], [fl.pipe / 2 + 4, -neckH], [fl.pipe / 2 - 1, -neckH]], "add"));
    }
    if (type !== "05") f.push(cyl("Otvor", fl.pipe + (type === "11" ? -2 * 3.2 : 1), fl.b * 4 + 10, -fl.b * 3, "cut"));
    const hole: Feature = cyl("Díra pro šroub", fl.l, fl.b + 6, -2, "cut", "Z", [fl.k / 2, 0]);
    f.push(hole, { id: uid(), name: "Díry pro šrouby", type: "pattern", featureId: hole.id, kind: "circular", count: fl.n, angle: 360, axis: "Z", center: [0, 0, 0] });
    return part(`Příruba ${key} PN16 typ ${type}`, "ocel", f, `EN 1092-1 – ${type} – ${key} – PN16`, "#7f8a96");
  },
};

const BARB: Record<string, number[]> = { "G1/4": [6, 8, 10], "G3/8": [8, 10, 13], "G1/2": [10, 13, 16, 19], "G3/4": [19, 25], G1: [25, 32] };
const G_OD: Record<string, { od: number; s: number }> = { "G1/4": { od: 13.2, s: 14 }, "G3/8": { od: 16.7, s: 17 }, "G1/2": { od: 21, s: 22 }, "G3/4": { od: 26.4, s: 27 }, G1: { od: 33.2, s: 36 } };
export const hoseBarb: Family = {
  id: "hosebarb",
  name: "Hadicový nátrubek se závitem",
  group: G,
  icon: "sweep",
  standards: ["DIN 2827 (podobné)"],
  keywords: ["hadicovy natrubek", "natrubek", "hadicova spojka", "trn", "hose barb", "hose tail", "hose fitting"],
  params: [
    { key: "thread", label: "Závit", kind: "enum", options: Object.keys(G_OD).map((k) => ({ v: k, l: k })), default: "G1/2" },
    { key: "hose", label: "Hadice Ø", kind: "number", min: 4, max: 50, step: 1, unit: "mm", default: 13 },
  ],
  parse: (q) => {
    const kw = has(q, "natrubek", "hadicov", "hose barb", "hose tail", "trn");
    if (!kw) return null;
    const t = (q.match(/\bg\s?(1\/4|3\/8|1\/2|3\/4|1)\b/) ?? [])[1];
    const hose = nums(q).find((x) => x >= 4 && x <= 50 && !/\//.test(String(x)));
    return { values: { ...(t ? { thread: `G${t}` } : {}), ...(hose ? { hose } : {}) }, score: score(kw, (t ? 0.2 : 0) + (hose ? 0.2 : 0)) };
  },
  describe: (v) => `Nátrubek ${v.thread} – hadice Ø${fmt(num(v.hose))}`,
  make: (v) => {
    const th = G_OD[str(v.thread, "G1/2")] ?? G_OD["G1/2"];
    const hose = num(v.hose, BARB[str(v.thread, "G1/2")]?.[1] ?? 13);
    const prof: [number, number][] = [[0, 0], [hose / 2 - 0.5, 0]];
    for (let i = 0; i < 3; i++) prof.push([hose / 2 + 1, 6 + i * 6], [hose / 2 - 0.5, 6 + i * 6 + 0.2], [hose / 2 - 0.5, 12 + i * 6]);
    prof.push([0, 24]);
    return part(`Nátrubek ${v.thread} Ø${fmt(hose)}`, "mosaz", [...revolveProfile("Trn", prof, "new"), ...hexPrism("Šestihran", th.s, 6, 24, "add"), cyl("Závit", th.od, 12, 30, "add"), cyl("Kanál", hose * 0.6, 50, -1, "cut")], `Nátrubek ${v.thread} – Ø${fmt(hose)}`, "#c9a46a");
  },
};

export const PIPING: Family[] = [threadedPipe, flangePN16, hoseBarb];
