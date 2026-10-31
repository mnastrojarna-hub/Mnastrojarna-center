/** Spojovací materiál: šrouby, matice, podložky, závitové tyče. */
import { uid, type Feature, type Vec2 } from "../types";
import { has, length, metric, nums, score } from "./parse-util";
import { ISO10642, ISO4762, ISO7380, METRIC, METRIC_SIZES, NUT, SETSCREW, WASHER } from "./tables";
import type { Family, ParamSchema, Values } from "./types";
import { chamferAll, cyl, fmt, hexPrism, num, part, revolveProfile, str, tube } from "./util";

const sizeParam = (keys: string[] = METRIC_SIZES, def = "M8"): ParamSchema => ({ key: "size", label: "Závit", kind: "enum", options: keys.map((k) => ({ v: k, l: k })), default: def });
const lenParam = (def = 30, label = "Délka l"): ParamSchema => ({ key: "l", label, kind: "number", min: 2, max: 3000, step: 5, unit: "mm", default: def });
const gradeParam = (opts: string[], def: string): ParamSchema => ({ key: "grade", label: "Pevnost / materiál", kind: "enum", options: opts.map((o) => ({ v: o, l: o })), default: def });

const materialOf = (grade: string) => (/A2|A4|nerez/i.test(grade) ? "nerez" : "ocel");
const socket = (s: number, t: number, zTop: number): Feature[] => hexPrism("Vnitřní šestihran", s, t, zTop - t, "cut");
const cosmeticThread = (size: string, from: number, len: number): Feature => ({ id: uid(), name: `Závit ${size}`, type: "thread", designation: size, position: [0, 0, from], axis: "Z", length: len, modeled: false });

/** Délka závitu b dle ISO 4014 / ISO 4762 (částečný závit). */
const threadLen = (d: number, l: number) => Math.min(l, l <= 125 ? 2 * d + 6 : l <= 200 ? 2 * d + 12 : 2 * d + 25);

function parseScrew(q: string, words: string[], defaultScore = 0): ReturnType<NonNullable<Family["parse"]>> {
  const m = metric(q);
  const kw = has(q, ...words);
  if (!m && !kw) return null;
  if (m && !METRIC[m]) return null;
  const n = nums(q);
  // „m8x30“ → délka = číslo za závitem; „m8 30“ také
  const l = length(q) ?? (m ? n[n.indexOf(Number(m.slice(1))) + 1] : undefined);
  const values: Partial<Values> = {};
  if (m) values.size = m;
  if (l && l > 0 && l < 3000) values.l = l;
  return { values, score: score(kw, (m ? 0.25 : 0) + (l ? 0.15 : 0)) || defaultScore };
}

export const socketCap: Family = {
  id: "iso4762",
  name: "Šroub s válcovou hlavou s vnitřním šestihranem",
  group: "Spojovací materiál",
  icon: "thread",
  standards: ["ISO 4762", "DIN 912", "ČSN 02 1143"],
  keywords: ["sroub", "imbus", "inbus", "valcova hlava", "din 912", "iso 4762", "socket", "cap screw", "shcs"],
  params: [sizeParam(Object.keys(ISO4762)), lenParam(30), gradeParam(["8.8", "10.9", "12.9", "A2-70", "A4-80"], "12.9")],
  sizes: { key: "size", columns: [{ key: "d", label: "d" }, { key: "p", label: "P" }, { key: "dk", label: "dk" }, { key: "k", label: "k" }, { key: "s", label: "s" }], rows: Object.entries(ISO4762).map(([k, v]) => ({ size: k, d: METRIC[k].d, p: METRIC[k].p, ...v })) },
  parse: (q) => {
    if (has(q, "sestihran", "hex", "6hr", "pulkulat", "button", "zapust", "countersunk", "stavec", "cerv", "matice", "nut", "podloz", "washer", "tyc", "rod", "kolik", "pin")) return null;
    return parseScrew(q, ["imbus", "inbus", "valcov", "912", "4762", "socket", "sroub", "screw", "bolt"], 0.45);
  },
  describe: (v) => `ISO 4762 – ${v.size}×${fmt(num(v.l))} – ${v.grade}`,
  make: (v) => {
    const size = str(v.size, "M8");
    const g = ISO4762[size] ?? ISO4762.M8;
    const d = METRIC[size].d;
    const l = num(v.l, 30);
    return part(`Šroub ${size}×${fmt(l)} ISO 4762`, materialOf(str(v.grade)), [
      cyl("Dřík", d, l, -l, "new"),
      cyl("Hlava", g.dk, g.k, 0),
      ...socket(g.s, g.t, g.k),
      chamferAll(Math.max(0.3, d * 0.08)),
      cosmeticThread(size, -l, threadLen(d, l)),
    ], `ISO 4762 – ${size}×${fmt(l)} – ${v.grade}`, "#3a3f45");
  },
};

const hexBolt = (id: string, std: string, full: boolean): Family => ({
  id,
  name: full ? "Šroub se šestihrannou hlavou, závit po hlavu" : "Šroub se šestihrannou hlavou, částečný závit",
  group: "Spojovací materiál",
  icon: "thread",
  standards: full ? ["ISO 4017", "DIN 933", "ČSN 02 1103"] : ["ISO 4014", "DIN 931", "ČSN 02 1101"],
  keywords: ["sroub sestihranny", "sestihranna hlava", "hex bolt", "hex screw", full ? "din 933" : "din 931", std.toLowerCase()],
  params: [sizeParam(), lenParam(40), gradeParam(["5.6", "8.8", "10.9", "A2-70", "A4-70"], "8.8")],
  sizes: { key: "size", columns: [{ key: "d", label: "d" }, { key: "p", label: "P" }, { key: "s", label: "s" }, { key: "k", label: "k" }], rows: METRIC_SIZES.map((k) => ({ size: k, ...METRIC[k] })) },
  parse: (q) => {
    const kw = has(q, "sestihran", "hex", "6hr", full ? "933" : "931", std.toLowerCase().replace("iso ", ""));
    if (!kw) return null;
    if (!full && !has(q, "castecn", "931", "4014", "partial")) return parseScrew(q, ["sestihran", "hex", "6hr"]) && { ...parseScrew(q, ["sestihran", "hex", "6hr"])!, score: 0.5 };
    return parseScrew(q, ["sestihran", "hex", "6hr", full ? "933" : "931"]);
  },
  describe: (v) => `${std} – ${v.size}×${fmt(num(v.l))} – ${v.grade}`,
  make: (v) => {
    const size = str(v.size, "M8");
    const m = METRIC[size] ?? METRIC.M8;
    const l = num(v.l, 40);
    const b = full ? l : threadLen(m.d, l);
    return part(`Šroub ${size}×${fmt(l)} ${std}`, materialOf(str(v.grade)), [
      cyl("Dřík", m.d, l, -l, "new"),
      ...hexPrism("Hlava", m.s, m.k, 0),
      chamferAll(Math.min(0.6, m.d * 0.06)),
      cosmeticThread(size, -l, b),
    ], `${std} – ${size}×${fmt(l)} – ${v.grade}`, "#3a3f45");
  },
});
export const hexBoltFull = hexBolt("iso4017", "ISO 4017", true);
export const hexBoltPartial = hexBolt("iso4014", "ISO 4014", false);

export const buttonHead: Family = {
  id: "iso7380",
  name: "Šroub s půlkulatou hlavou s vnitřním šestihranem",
  group: "Spojovací materiál",
  icon: "thread",
  standards: ["ISO 7380-1"],
  keywords: ["pulkulat", "pulkulata hlava", "button head", "iso 7380", "7380", "cockova"],
  params: [sizeParam(Object.keys(ISO7380)), lenParam(20), gradeParam(["10.9", "A2-70"], "10.9")],
  sizes: { key: "size", columns: [{ key: "dk", label: "dk" }, { key: "k", label: "k" }, { key: "s", label: "s" }], rows: Object.entries(ISO7380).map(([k, v]) => ({ size: k, ...v })) },
  parse: (q) => (has(q, "pulkulat", "button", "7380", "cockov") ? parseScrew(q, ["pulkulat", "button", "7380", "cockov"]) : null),
  describe: (v) => `ISO 7380 – ${v.size}×${fmt(num(v.l))} – ${v.grade}`,
  make: (v) => {
    const size = str(v.size, "M8");
    const g = ISO7380[size] ?? ISO7380.M8;
    const d = METRIC[size].d;
    const l = num(v.l, 20);
    const R = (g.dk * g.dk) / 4 / (2 * g.k) + g.k / 2; // poloměr kulového vrchlíku
    const prof: Vec2[] = [[0, 0], [g.dk / 2, 0]];
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      const x = (g.dk / 2) * (1 - t);
      prof.push([x, R - Math.sqrt(Math.max(0, R * R - x * x)) - (R - g.k) + 0]);
    }
    // oprava: vrchlík sedí na z=0 a vrchol je v z=k
    const cap = prof.map(([x, y], i) => (i < 2 ? ([x, y] as Vec2) : ([x, g.k - (R - Math.sqrt(Math.max(0, R * R - x * x)))] as Vec2)));
    return part(`Šroub ${size}×${fmt(l)} ISO 7380`, materialOf(str(v.grade)), [
      cyl("Dřík", d, l, -l, "new"),
      ...revolveProfile("Hlava", cap, "add"),
      ...socket(g.s, g.k * 0.6, g.k),
      cosmeticThread(size, -l, l),
    ], `ISO 7380 – ${size}×${fmt(l)} – ${v.grade}`, "#3a3f45");
  },
};

export const countersunk: Family = {
  id: "iso10642",
  name: "Šroub se zápustnou hlavou s vnitřním šestihranem",
  group: "Spojovací materiál",
  icon: "thread",
  standards: ["ISO 10642", "DIN 7991"],
  keywords: ["zapustn", "zapustna hlava", "countersunk", "flat head", "din 7991", "iso 10642"],
  params: [sizeParam(Object.keys(ISO10642)), lenParam(20), gradeParam(["10.9", "A2-70"], "10.9")],
  sizes: { key: "size", columns: [{ key: "dk", label: "dk" }, { key: "k", label: "k" }, { key: "s", label: "s" }], rows: Object.entries(ISO10642).map(([k, v]) => ({ size: k, ...v })) },
  parse: (q) => (has(q, "zapust", "countersunk", "7991", "10642", "flat head") ? parseScrew(q, ["zapust", "countersunk", "7991", "10642"]) : null),
  describe: (v) => `ISO 10642 – ${v.size}×${fmt(num(v.l))} – ${v.grade}`,
  make: (v) => {
    const size = str(v.size, "M8");
    const g = ISO10642[size] ?? ISO10642.M8;
    const d = METRIC[size].d;
    const l = num(v.l, 20);
    // hlava: horní plocha v z=0, kužel 90° dolů; délka l se měří od horní plochy hlavy
    return part(`Šroub ${size}×${fmt(l)} ISO 10642`, materialOf(str(v.grade)), [
      cyl("Dřík", d, l - g.k, -l, "new"),
      ...revolveProfile("Hlava", [[0, 0], [g.dk / 2, 0], [d / 2, -g.k], [0, -g.k]], "add"),
      ...socket(g.s, g.k * 0.7, 0),
      cosmeticThread(size, -l, l - g.k),
    ], `ISO 10642 – ${size}×${fmt(l)} – ${v.grade}`, "#3a3f45");
  },
};

const setScrew = (id: string, std: string, cup: boolean): Family => ({
  id,
  name: cup ? "Stavěcí šroub s důlkem (ISO 4029)" : "Stavěcí šroub s plochým koncem (ISO 4026)",
  group: "Spojovací materiál",
  icon: "thread",
  standards: [std, cup ? "DIN 916" : "DIN 913"],
  keywords: ["stavec", "cerv", "stavecí sroub", "set screw", "grub", cup ? "dulek" : "ploch", std.toLowerCase()],
  params: [sizeParam(Object.keys(SETSCREW), "M6"), lenParam(10), gradeParam(["45H", "A2"], "45H")],
  parse: (q) => {
    if (!has(q, "stavec", "cerv", "set screw", "grub", cup ? "916" : "913", std.toLowerCase().replace("iso ", ""))) return null;
    const hit = parseScrew(q, ["stavec", "cerv", "set screw", "grub"]);
    return hit && { ...hit, score: hit.score * (cup === !!has(q, "dulek", "cup", "916") ? 1 : 0.8) };
  },
  describe: (v) => `${std} – ${v.size}×${fmt(num(v.l))} – ${v.grade}`,
  make: (v) => {
    const size = str(v.size, "M6");
    const m = METRIC[size] ?? METRIC.M6;
    const s = SETSCREW[size]?.s ?? 3;
    const l = num(v.l, 10);
    const f: Feature[] = [cyl("Tělo", m.d, l, 0, "new"), ...socket(s, Math.min(l * 0.5, m.d * 0.6), l), chamferAll(m.d * 0.08)];
    if (cup) f.push(cyl("Důlek", m.d * 0.55, m.d * 0.15, 0, "cut"));
    return part(`Stavěcí šroub ${size}×${fmt(l)}`, materialOf(str(v.grade)), f, `${std} – ${size}×${fmt(l)} – ${v.grade}`, "#3a3f45");
  },
});
export const setScrewFlat = setScrew("iso4026", "ISO 4026", false);
export const setScrewCup = setScrew("iso4029", "ISO 4029", true);

const nut = (id: string, std: string, thin: boolean): Family => ({
  id,
  name: thin ? "Šestihranná matice nízká" : "Šestihranná matice",
  group: "Spojovací materiál",
  icon: "tube",
  standards: [std, thin ? "DIN 439" : "DIN 934", "ČSN 02 1401"],
  keywords: ["matice", "nut", thin ? "nizka" : "sestihranna matice", std.toLowerCase()],
  params: [sizeParam(), gradeParam(["8", "10", "A2-70", "A4-80"], "8")],
  sizes: { key: "size", columns: [{ key: "s", label: "s" }, { key: "m", label: thin ? "m (nízká)" : "m" }], rows: METRIC_SIZES.map((k) => ({ size: k, s: METRIC[k].s, m: thin ? NUT[k].mt : NUT[k].m })) },
  parse: (q) => {
    const kw = has(q, "matice", "nut", thin ? "439" : "934", std.toLowerCase().replace("iso ", ""));
    if (!kw) return null;
    const m = metric(q);
    const isThin = !!has(q, "nizk", "thin", "439", "4035");
    if (isThin !== thin) return { values: m ? { size: m } : {}, score: 0.3 };
    return { values: m && METRIC[m] ? { size: m } : {}, score: score(kw, m ? 0.3 : 0) };
  },
  describe: (v) => `${std} – ${v.size} – ${v.grade}`,
  make: (v) => {
    const size = str(v.size, "M8");
    const m = METRIC[size] ?? METRIC.M8;
    const h = thin ? NUT[size].mt : NUT[size].m;
    return part(`Matice ${size} ${std}`, materialOf(str(v.grade)), [
      ...hexPrism("Matice", m.s, h, 0, "new"),
      cyl("Závitová díra", m.d - 1.0825 * m.p, h + 2, -1, "cut"),
      chamferAll(Math.min(0.5, m.p * 0.4)),
      cosmeticThread(size, 0, h),
    ], `${std} – ${size} – ${v.grade}`, "#3a3f45");
  },
});
export const nutIso4032 = nut("iso4032", "ISO 4032", false);
export const nutIso4035 = nut("iso4035", "ISO 4035", true);

const washer = (id: string, std: string, large: boolean): Family => ({
  id,
  name: large ? "Podložka velká" : "Podložka plochá",
  group: "Spojovací materiál",
  icon: "tube",
  standards: large ? ["DIN 9021", "ISO 7093"] : [std, "DIN 125 A", "ČSN 02 1702"],
  keywords: ["podlozka", "washer", large ? "velka" : "plocha", std.toLowerCase(), large ? "9021" : "125"],
  params: [sizeParam(), gradeParam(["200HV", "A2", "A4"], "200HV")],
  sizes: {
    key: "size",
    columns: [{ key: "d1", label: "d1" }, { key: "d2", label: "d2" }, { key: "h", label: "h" }],
    rows: METRIC_SIZES.map((k) => ({ size: k, d1: WASHER[k].d1, d2: large ? WASHER[k].D2 : WASHER[k].d2, h: large ? WASHER[k].H : WASHER[k].h })),
  },
  parse: (q) => {
    const kw = has(q, "podloz", "washer", large ? "9021" : "7089", large ? "velk" : "125");
    if (!kw) return null;
    const isLarge = !!has(q, "velk", "9021", "7093", "large", "karos");
    if (isLarge !== large) return { values: {}, score: 0.3 };
    const m = metric(q) ?? (nums(q)[0] ? `M${Math.round(nums(q)[0])}` : null);
    return { values: m && METRIC[m] ? { size: m } : {}, score: score(kw, m && METRIC[m] ? 0.3 : 0) };
  },
  describe: (v) => `${large ? "DIN 9021" : std} – ${String(v.size).replace("M", "")} – ${v.grade}`,
  make: (v) => {
    const size = str(v.size, "M8");
    const w = WASHER[size] ?? WASHER.M8;
    const [d2, h] = large ? [w.D2, w.H] : [w.d2, w.h];
    return part(`Podložka ${size.replace("M", "")} ${large ? "DIN 9021" : std}`, materialOf(str(v.grade)), [tube("Podložka", d2, w.d1, h, 0, "new")], `${large ? "DIN 9021" : std} – ${size.replace("M", "")} – ${v.grade}`, "#9aa4ad");
  },
});
export const washerIso7089 = washer("iso7089", "ISO 7089", false);
export const washerDin9021 = washer("din9021", "DIN 9021", true);

export const threadedRod: Family = {
  id: "din975",
  name: "Závitová tyč",
  group: "Spojovací materiál",
  icon: "cylinder",
  standards: ["DIN 975", "DIN 976"],
  keywords: ["zavitova tyc", "zavitovka", "threaded rod", "din 975", "din 976"],
  params: [sizeParam(), { key: "l", label: "Délka", kind: "number", min: 10, max: 3000, step: 10, unit: "mm", default: 1000 }, gradeParam(["4.8", "8.8", "A2", "A4"], "4.8")],
  parse: (q) => {
    const kw = has(q, "zavitova tyc", "zavitovka", "tyc", "rod", "975", "976");
    if (!kw) return null;
    const hit = parseScrew(q, ["tyc", "rod"]);
    return hit && { ...hit, score: score(kw, hit.values.size ? 0.3 : 0) };
  },
  describe: (v) => `DIN 975 – ${v.size}×${fmt(num(v.l))} – ${v.grade}`,
  make: (v) => {
    const size = str(v.size, "M8");
    const m = METRIC[size] ?? METRIC.M8;
    const l = num(v.l, 1000);
    return part(`Závitová tyč ${size}×${fmt(l)}`, materialOf(str(v.grade)), [cyl("Tyč", m.d, l, 0, "new"), chamferAll(m.p * 0.5), cosmeticThread(size, 0, l)], `DIN 975 – ${size}×${fmt(l)} – ${v.grade}`, "#5b6670");
  },
};

export const FASTENERS: Family[] = [socketCap, hexBoltFull, hexBoltPartial, buttonHead, countersunk, setScrewFlat, setScrewCup, nutIso4032, nutIso4035, washerIso7089, washerDin9021, threadedRod];
