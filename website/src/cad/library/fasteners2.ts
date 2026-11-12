/** Spojovací materiál 2: šrouby s křížovou drážkou, pojistné a přírubové matice, pružné/zubové/těžké podložky, závrtné šrouby, křídlové a očkové díly, nýty, samořezné šrouby. */
import { tr } from "../i18n";
import { uid, type Feature, type Vec2 } from "../types";
import { has, length, metric, nums, score } from "./parse-util";
import { METRIC, METRIC_SIZES, NUT, WASHER } from "./tables";
import type { Family, ParamSchema, Values } from "./types";
import { box, chamferAll, cyl, fmt, hexPrism, num, part, revolveProfile, str, tube } from "./util";

const G = "Spojovací materiál";
const sizeParam = (keys: string[], def = "M6"): ParamSchema => ({ key: "size", label: tr("Závit"), kind: "enum", options: keys.map((k) => ({ v: k, l: k })), default: def });
const lenParam = (def: number): ParamSchema => ({ key: "l", label: tr("Délka l"), kind: "number", min: 2, max: 500, step: 1, unit: "mm", default: def });
const grade = (opts: string[], def: string): ParamSchema => ({ key: "grade", label: tr("Pevnost / materiál"), kind: "enum", options: opts.map((o) => ({ v: o, l: tr(o) })), default: def });
const mat = (g: string) => (/A2|A4|nerez/i.test(g) ? "nerez" : "ocel");
const thread = (size: string, from: number, len: number): Feature => ({ id: uid(), name: `Závit ${size}`, type: "thread", designation: size, position: [0, 0, from], axis: "Z", length: len, modeled: false });
const cross = (dk: number, k: number, zTop: number): Feature[] => {
  const w = Math.max(0.6, dk * 0.12);
  const depth = k * 0.6;
  return [box(tr("Kříž 1"), [dk * 0.6, w, depth], [0, 0, zTop - depth / 2], "cut"), box(tr("Kříž 2"), [w, dk * 0.6, depth], [0, 0, zTop - depth / 2], "cut")];
};

function parseSized(q: string, words: string[], withLength = true) {
  const kw = has(q, ...words);
  if (!kw) return null;
  const m = metric(q);
  const n = nums(q);
  const l = withLength ? (length(q) ?? (m ? n[n.indexOf(Number(m.slice(1))) + 1] : undefined)) : undefined;
  const values: Partial<Values> = {};
  if (m && METRIC[m]) values.size = m;
  else if (!m && n[0] && METRIC[`M${Math.round(n[0])}`]) values.size = `M${Math.round(n[0])}`;
  if (l && l > 0 && l < 500) values.l = l;
  return { values, score: score(kw, (values.size ? 0.25 : 0) + (l ? 0.15 : 0)) };
}

// ---------------- šrouby s křížovou drážkou ----------------

const PAN: Record<string, { dk: number; k: number }> = { M2: { dk: 4, k: 1.6 }, "M2.5": { dk: 5, k: 2 }, M3: { dk: 5.6, k: 2.4 }, M4: { dk: 8, k: 3.1 }, M5: { dk: 9.5, k: 3.7 }, M6: { dk: 12, k: 4.6 }, M8: { dk: 16, k: 6 }, M10: { dk: 20, k: 7.5 } };
const CSK: Record<string, { dk: number; k: number }> = { M2: { dk: 3.8, k: 1.2 }, "M2.5": { dk: 4.7, k: 1.5 }, M3: { dk: 5.5, k: 1.65 }, M4: { dk: 8.4, k: 2.7 }, M5: { dk: 9.3, k: 2.7 }, M6: { dk: 11.3, k: 3.3 }, M8: { dk: 15.8, k: 4.65 }, M10: { dk: 18.3, k: 5 } };
const dOf = (size: string) => METRIC[size]?.d ?? Number(size.replace("M", ""));

export const panHeadCross: Family = {
  id: "iso7045",
  name: "Šroub s půlkulatou hlavou s křížovou drážkou",
  group: G,
  icon: "thread",
  standards: ["ISO 7045", "DIN 7985"],
  keywords: ["krizova drazka", "krizovy", "phillips", "pozidriv", "pan head", "iso 7045", "din 7985", "7985"],
  params: [sizeParam(Object.keys(PAN), "M4"), lenParam(12), grade(["4.8", "8.8", "A2-70"], "4.8")],
  sizes: { key: "size", columns: [{ key: "dk", label: "dk" }, { key: "k", label: "k" }], rows: Object.entries(PAN).map(([k, v]) => ({ size: k, ...v })) },
  parse: (q) => (has(q, "zapust", "countersunk", "7046", "965") ? null : parseSized(q, ["kriz", "phillips", "pozidriv", "pan head", "7045", "7985"])),
  describe: (v) => `ISO 7045 – ${v.size}×${fmt(num(v.l))} – ${v.grade}`,
  make: (v) => {
    const size = str(v.size, "M4");
    const g = PAN[size] ?? PAN.M4;
    const d = dOf(size);
    const l = num(v.l, 12);
    const R = ((g.dk * g.dk) / 4 + (g.k * 0.6) ** 2) / (2 * g.k * 0.6);
    const cap: Vec2[] = [[0, 0], [g.dk / 2, 0], [g.dk / 2, g.k * 0.4]];
    for (let i = 1; i <= 6; i++) {
      const x = (g.dk / 2) * (1 - i / 6);
      cap.push([x, g.k * 0.4 + (g.k * 0.6 - (R - Math.sqrt(Math.max(0, R * R - x * x))))]);
    }
    return part(tr("Šroub {0}×{1} ISO 7045", size, fmt(l)), mat(str(v.grade)), [cyl(tr("Dřík"), d, l, -l, "new"), chamferAll(Math.max(0.2, d * 0.06)), ...revolveProfile("Hlava", cap, "add"), ...cross(g.dk, g.k, g.k), thread(size, -l, l)], tr("ISO 7045 – {0}×{1} – {2}", size, fmt(l), v.grade), "#3a3f45");
  },
};

export const countersunkCross: Family = {
  id: "iso7046",
  name: "Šroub se zápustnou hlavou s křížovou drážkou",
  group: G,
  icon: "thread",
  standards: ["ISO 7046", "DIN 965"],
  keywords: ["zapustna krizova", "zapustny kriz", "countersunk phillips", "iso 7046", "din 965", "965"],
  params: [sizeParam(Object.keys(CSK), "M4"), lenParam(12), grade(["4.8", "8.8", "A2-70"], "4.8")],
  sizes: { key: "size", columns: [{ key: "dk", label: "dk" }, { key: "k", label: "k" }], rows: Object.entries(CSK).map(([k, v]) => ({ size: k, ...v })) },
  parse: (q) => {
    if (!has(q, "7046", "965") && !(has(q, "zapust", "countersunk") && has(q, "kriz", "phillips", "pozidriv"))) return null;
    return parseSized(q, ["zapust", "countersunk", "7046", "965"]);
  },
  describe: (v) => `ISO 7046 – ${v.size}×${fmt(num(v.l))} – ${v.grade}`,
  make: (v) => {
    const size = str(v.size, "M4");
    const g = CSK[size] ?? CSK.M4;
    const d = dOf(size);
    const l = num(v.l, 12);
    return part(tr("Šroub {0}×{1} ISO 7046", size, fmt(l)), mat(str(v.grade)), [cyl(tr("Dřík"), d, l - g.k, -l, "new"), ...revolveProfile("Hlava", [[0, 0], [g.dk / 2, 0], [d / 2, -g.k], [0, -g.k]], "add"), ...cross(g.dk, g.k, 0), thread(size, -l, l - g.k)], tr("ISO 7046 – {0}×{1} – {2}", size, fmt(l), v.grade), "#3a3f45");
  },
};

// ---------------- matice ----------------

const LOCKNUT: Record<string, number> = { M3: 4, M4: 5, M5: 5, M6: 6, M8: 8, M10: 10, M12: 12, M14: 14, M16: 16, M20: 20, M24: 24, M30: 30, M36: 36 };
export const lockNut: Family = {
  id: "din985",
  name: "Pojistná matice s nylonovou vložkou",
  group: G,
  icon: "tube",
  standards: ["ISO 7040", "DIN 985", "ISO 10511"],
  keywords: ["pojistna matice", "samojistna", "nylonova vlozka", "nyloc", "lock nut", "din 985", "iso 7040"],
  params: [sizeParam(Object.keys(LOCKNUT), "M8"), grade(["8", "10", "A2"], "8")],
  sizes: { key: "size", columns: [{ key: "s", label: "s" }, { key: "h", label: "h" }], rows: Object.keys(LOCKNUT).map((k) => ({ size: k, s: METRIC[k].s, h: LOCKNUT[k] })) },
  parse: (q) => parseSized(q, ["pojistna matice", "samojist", "nylon", "nyloc", "lock nut", "985", "7040", "10511"], false),
  describe: (v) => `DIN 985 – ${v.size} – ${v.grade}`,
  make: (v) => {
    const size = str(v.size, "M8");
    const m = METRIC[size] ?? METRIC.M8;
    const h = LOCKNUT[size] ?? m.d;
    const hh = h * 0.65;
    return part(tr("Pojistná matice {0}", size), mat(str(v.grade)), [...hexPrism("Matice", m.s, hh, 0, "new"), chamferAll(Math.min(0.5, m.p * 0.4)), cyl(tr("Límec vložky"), m.s * 0.95, h - hh, hh, "add"), cyl(tr("Nylonová vložka"), m.d * 0.92, h - hh + 0.1, hh, "cut"), cyl(tr("Závitová díra"), m.d - 1.0825 * m.p, hh + 2, -1, "cut"), thread(size, 0, hh)], tr("DIN 985 – {0} – {1}", size, v.grade), "#3a3f45");
  },
};

const FLANGE_NUT: Record<string, { dc: number; m: number }> = { M5: { dc: 11.8, m: 5 }, M6: { dc: 14.2, m: 6 }, M8: { dc: 17.9, m: 8 }, M10: { dc: 21.8, m: 10 }, M12: { dc: 26, m: 12 }, M14: { dc: 29.9, m: 14 }, M16: { dc: 34.5, m: 16 }, M20: { dc: 42.8, m: 20 } };
export const flangeNut: Family = {
  id: "din6923",
  name: "Šestihranná matice s přírubou",
  group: G,
  icon: "tube",
  standards: ["DIN 6923", "ISO 4161"],
  keywords: ["prirubova matice", "matice s prirubou", "flange nut", "din 6923", "iso 4161"],
  params: [sizeParam(Object.keys(FLANGE_NUT), "M8"), grade(["8", "10", "A2"], "8"), { key: "serr", label: tr("Ozubená příruba"), kind: "bool", default: false }],
  sizes: { key: "size", columns: [{ key: "s", label: "s" }, { key: "dc", label: "dc" }, { key: "m", label: "m" }], rows: Object.keys(FLANGE_NUT).map((k) => ({ size: k, s: METRIC[k].s, ...FLANGE_NUT[k] })) },
  parse: (q) => parseSized(q, ["prirubova matice", "s prirubou", "flange nut", "6923", "4161"], false),
  describe: (v) => `DIN 6923 – ${v.size} – ${v.grade}`,
  make: (v) => {
    const size = str(v.size, "M8");
    const m = METRIC[size] ?? METRIC.M8;
    const g = FLANGE_NUT[size] ?? FLANGE_NUT.M8;
    const fl = m.p * 0.8;
    return part(tr("Přírubová matice {0}", size), mat(str(v.grade)), [...revolveProfile(tr("Příruba"), [[0, 0], [g.dc / 2, 0], [g.dc / 2, fl * 0.5], [m.s / 2, fl * 2.2], [0, fl * 2.2]], "new"), ...hexPrism("Matice", m.s, g.m, 0, "add"), cyl(tr("Závitová díra"), m.d - 1.0825 * m.p, g.m + 2, -1, "cut"), thread(size, 0, g.m)], tr("DIN 6923 – {0} – {1}", size, v.grade), "#3a3f45");
  },
};

const WING: Record<string, { d: number; w: number; h: number }> = { M4: { d: 10, w: 23, h: 10 }, M5: { d: 12, w: 27, h: 12 }, M6: { d: 14, w: 32, h: 14 }, M8: { d: 18, w: 40, h: 18 }, M10: { d: 21, w: 47, h: 21 }, M12: { d: 24, w: 55, h: 24 } };
export const wingNut: Family = {
  id: "din315",
  name: "Křídlová matice",
  group: G,
  icon: "tube",
  standards: ["DIN 315", "ČSN 02 1462"],
  keywords: ["kridlova matice", "kridlova", "wing nut", "din 315"],
  params: [sizeParam(Object.keys(WING), "M6"), grade(["ocel", "A2"], "ocel")],
  parse: (q) => parseSized(q, ["kridl", "wing nut", "din 315"], false),
  describe: (v) => `DIN 315 – ${v.size}`,
  make: (v) => {
    const size = str(v.size, "M6");
    const m = METRIC[size] ?? METRIC.M6;
    const g = WING[size] ?? WING.M6;
    const t = g.d * 0.22;
    return part(tr("Křídlová matice {0}", size), mat(str(v.grade)), [cyl(tr("Náboj"), g.d, g.h * 0.6, 0, "new"), box(tr("Křídlo 1"), [g.w / 2 - g.d * 0.3, t, g.h], [g.w / 4 + g.d * 0.15, 0, g.h / 2], "add"), box(tr("Křídlo 2"), [g.w / 2 - g.d * 0.3, t, g.h], [-g.w / 4 - g.d * 0.15, 0, g.h / 2], "add"), cyl(tr("Závitová díra"), m.d - 1.0825 * m.p, g.h + 2, -1, "cut"), chamferAll(0.4), thread(size, 0, g.h * 0.6)], tr("DIN 315 – {0}", size), "#3a3f45");
  },
};

// ---------------- podložky ----------------

const SPRING_W: Record<string, { d1: number; d2: number; s: number }> = { M3: { d1: 3.1, d2: 6.2, s: 0.8 }, M4: { d1: 4.1, d2: 7.6, s: 0.9 }, M5: { d1: 5.1, d2: 9.2, s: 1.2 }, M6: { d1: 6.1, d2: 11.8, s: 1.6 }, M8: { d1: 8.1, d2: 14.8, s: 2 }, M10: { d1: 10.2, d2: 18.1, s: 2.2 }, M12: { d1: 12.2, d2: 21.1, s: 2.5 }, M14: { d1: 14.2, d2: 24.1, s: 3 }, M16: { d1: 16.2, d2: 27.4, s: 3.5 }, M20: { d1: 20.2, d2: 33.6, s: 4 }, M24: { d1: 24.5, d2: 40, s: 5 }, M30: { d1: 30.5, d2: 48.2, s: 6 } };
export const springWasher: Family = {
  id: "din127",
  name: "Pružná podložka",
  group: G,
  icon: "tube",
  standards: ["DIN 127 B", "ISO 7092? (ne)", "ČSN 02 1740"],
  keywords: ["pruzna podlozka", "perova podlozka", "spring washer", "lock washer", "din 127", "127"],
  params: [sizeParam(Object.keys(SPRING_W), "M8"), grade(["pružinová ocel", "A2"], tr("pružinová ocel"))],
  sizes: { key: "size", columns: [{ key: "d1", label: "d1" }, { key: "d2", label: "d2" }, { key: "s", label: "s" }], rows: Object.entries(SPRING_W).map(([k, v]) => ({ size: k, ...v })) },
  parse: (q) => parseSized(q, ["pruzna podloz", "perova podloz", "spring washer", "lock washer", "din 127"], false),
  describe: (v) => `DIN 127 – B ${String(v.size).replace("M", "")}`,
  make: (v) => {
    const size = str(v.size, "M8");
    const w = SPRING_W[size] ?? SPRING_W.M8;
    return part(tr("Pružná podložka {0}", size.replace("M", "")), mat(str(v.grade)), [tube(tr("Podložka"), w.d2, w.d1, w.s, 0, "new"), box(tr("Rozříznutí"), [w.s * 0.8, w.d2, w.s + 2], [0, w.d2 / 2 - (w.d2 - w.d1) / 4, w.s / 2], "cut")], tr("DIN 127 – B {0}", size.replace("M", "")), "#5b6670");
  },
};

const TOOTH_W: Record<string, { d1: number; d2: number; s: number }> = { M3: { d1: 3.2, d2: 6, s: 0.4 }, M4: { d1: 4.3, d2: 8, s: 0.5 }, M5: { d1: 5.3, d2: 10, s: 0.6 }, M6: { d1: 6.4, d2: 11, s: 0.7 }, M8: { d1: 8.4, d2: 15, s: 0.8 }, M10: { d1: 10.5, d2: 18, s: 0.9 }, M12: { d1: 13, d2: 20.5, s: 1 }, M16: { d1: 17, d2: 26, s: 1.2 }, M20: { d1: 21, d2: 33, s: 1.4 } };
export const toothWasher: Family = {
  id: "din6798",
  name: "Zubová (vějířová) podložka s vnějším ozubením",
  group: G,
  icon: "tube",
  standards: ["DIN 6798 A", "ČSN 02 1745"],
  keywords: ["zubova podlozka", "vejirova podlozka", "ozubena podlozka", "tooth washer", "serrated washer", "din 6798", "6798"],
  params: [sizeParam(Object.keys(TOOTH_W), "M6"), grade(["pružinová ocel", "A2"], tr("pružinová ocel"))],
  sizes: { key: "size", columns: [{ key: "d1", label: "d1" }, { key: "d2", label: "d2" }, { key: "s", label: "s" }], rows: Object.entries(TOOTH_W).map(([k, v]) => ({ size: k, ...v })) },
  parse: (q) => parseSized(q, ["zubov", "vejir", "ozubena podloz", "tooth washer", "serrated", "6798"], false),
  describe: (v) => `DIN 6798 – A ${String(v.size).replace("M", "")}`,
  make: (v) => {
    const size = str(v.size, "M6");
    const w = TOOTH_W[size] ?? TOOTH_W.M6;
    const n = 12;
    const slot: Feature = box(tr("Zářez"), [(w.d2 - w.d1) * 0.45, Math.max(0.5, (Math.PI * w.d2) / n / 3), w.s + 2], [w.d2 / 2 - (w.d2 - w.d1) * 0.2, 0, w.s / 2], "cut");
    return part(tr("Zubová podložka {0}", size.replace("M", "")), mat(str(v.grade)), [tube(tr("Podložka"), w.d2, w.d1, w.s, 0, "new"), slot, { id: uid(), name: "Zuby", type: "pattern", featureId: slot.id, kind: "circular", count: n, angle: 360, axis: "Z", center: [0, 0, 0] }], tr("DIN 6798 – A {0}", size.replace("M", "")), "#5b6670");
  },
};

const HEAVY_W: Record<string, { d1: number; d2: number; s: number }> = { M4: { d1: 4.3, d2: 9, s: 1 }, M5: { d1: 5.3, d2: 11, s: 1.6 }, M6: { d1: 6.4, d2: 12, s: 1.6 }, M8: { d1: 8.4, d2: 17, s: 2 }, M10: { d1: 10.5, d2: 21, s: 2.5 }, M12: { d1: 13, d2: 24, s: 4 }, M16: { d1: 17, d2: 30, s: 4 }, M20: { d1: 21, d2: 37, s: 5 }, M24: { d1: 25, d2: 44, s: 6 } };
export const heavyWasher: Family = {
  id: "din7349",
  name: "Podložka pro šrouby s těžkými pružnými kolíky (silná)",
  group: G,
  icon: "tube",
  standards: ["DIN 7349"],
  keywords: ["tezka podlozka", "silna podlozka", "heavy washer", "thick washer", "din 7349", "7349"],
  params: [sizeParam(Object.keys(HEAVY_W), "M8"), grade(["ocel", "A2"], "ocel")],
  sizes: { key: "size", columns: [{ key: "d1", label: "d1" }, { key: "d2", label: "d2" }, { key: "s", label: "s" }], rows: Object.entries(HEAVY_W).map(([k, v]) => ({ size: k, ...v })) },
  parse: (q) => parseSized(q, ["tezk", "siln", "heavy washer", "thick washer", "7349"], false),
  describe: (v) => `DIN 7349 – ${String(v.size).replace("M", "")}`,
  make: (v) => {
    const size = str(v.size, "M8");
    const w = HEAVY_W[size] ?? HEAVY_W.M8;
    return part(tr("Podložka {0} DIN 7349", size.replace("M", "")), mat(str(v.grade)), [tube(tr("Podložka"), w.d2, w.d1, w.s, 0, "new"), chamferAll(Math.min(0.5, w.s * 0.2))], tr("DIN 7349 – {0}", size.replace("M", "")), "#9aa4ad");
  },
};

// ---------------- závrtné, očkové, nýty, samořezné ----------------

const studBolt = (id: string, std: string, bFactor: number): Family => ({
  id,
  name: tr("Závrtný šroub ({0}, b1 = {1}d)", std, bFactor),
  group: G,
  icon: "cylinder",
  standards: [std, bFactor === 1 ? "ISO 8676?" : "ČSN 02 1176"],
  keywords: ["zavrtny sroub", "zavrtny", "stud", "stud bolt", std.toLowerCase(), bFactor === 1 ? "938" : "939"],
  params: [sizeParam(METRIC_SIZES.filter((k) => Number(k.slice(1)) >= 6 && Number(k.slice(1)) <= 24), "M10"), lenParam(50), grade(["5.8", "8.8", "A2-70"], "8.8")],
  parse: (q) => {
    const hit = parseSized(q, ["zavrtn", "stud", bFactor === 1 ? "938" : "939"]);
    return hit && { ...hit, score: hit.score * (has(q, bFactor === 1 ? "938" : "939") || (!has(q, "938", "939") && bFactor === 1) ? 1 : 0.85) };
  },
  describe: (v) => `${std} – ${v.size}×${fmt(num(v.l))} – ${v.grade}`,
  make: (v) => {
    const size = str(v.size, "M10");
    const m = METRIC[size] ?? METRIC.M10;
    const l = num(v.l, 50);
    const b1 = m.d * bFactor;
    const b2 = Math.min(l - b1 - 2, 2 * m.d + 6);
    return part(tr("Závrtný šroub {0}×{1}", size, fmt(l)), mat(str(v.grade)), [cyl(tr("Šroub"), m.d, l, 0, "new"), chamferAll(m.p * 0.5), thread(size, 0, b1), thread(size, l - b2, b2)], `${std} – ${size}×${fmt(l)} – ${v.grade}`, "#5b6670");
  },
});
export const studDin938 = studBolt("din938", "DIN 938", 1);
export const studDin939 = studBolt("din939", "DIN 939", 1.25);

const EYE: Record<string, { D: number; d2: number; b: number }> = { M6: { D: 20, d2: 8, b: 13 }, M8: { D: 20, d2: 8, b: 13 }, M10: { D: 25, d2: 10, b: 17 }, M12: { D: 30, d2: 12, b: 20.5 }, M16: { D: 35, d2: 14, b: 27 }, M20: { D: 40, d2: 16, b: 30 }, M24: { D: 50, d2: 20, b: 36 } };
export const eyeBolt: Family = {
  id: "din580",
  name: "Šroub s okem (závěsné oko)",
  group: G,
  icon: "tube",
  standards: ["DIN 580", "ISO 3266"],
  keywords: ["sroub s okem", "ockovy sroub", "zavesne oko", "eye bolt", "lifting eye", "din 580"],
  params: [sizeParam(Object.keys(EYE), "M12"), grade(["C15E", "A4"], "C15E")],
  parse: (q) => parseSized(q, ["s okem", "ockov", "zavesne oko", "eye bolt", "lifting", "din 580"], false),
  describe: (v) => `DIN 580 – ${v.size}`,
  make: (v) => {
    const size = str(v.size, "M12");
    const m = METRIC[size] ?? METRIC.M12;
    const e = EYE[size] ?? EYE.M12;
    const ring: Vec2[] = [];
    const rc = e.D / 2 + e.d2 / 2; // střed prstence
    for (let i = 0; i < 20; i++) ring.push([rc + (e.d2 / 2) * Math.cos((2 * Math.PI * i) / 20), e.b + e.D / 2 + e.d2 / 2 + (e.d2 / 2) * Math.sin((2 * Math.PI * i) / 20)]);
    const sk = { id: uid(), name: "Oko – průřez", type: "sketch" as const, plane: { kind: "base" as const, name: "XZ" as const, offset: 0 }, entities: [{ id: uid(), type: "polyline" as const, closed: true, points: ring }] };
    return part(tr("Šroub s okem {0}", size), mat(str(v.grade)), [cyl(tr("Dřík"), m.d, e.b, 0, "new"), cyl(tr("Límec"), e.d2 * 2.2, e.b * 0.3, e.b * 0.7, "add"), sk, { id: uid(), name: "Oko", type: "revolve", sketchId: sk.id, angle: 360, axis: "x", mode: "add" }, chamferAll(m.p * 0.4), thread(size, 0, e.b * 0.7)], tr("DIN 580 – {0}", size), "#5b6670");
  },
};

export const rivet: Family = {
  id: "din660",
  name: "Nýt s půlkulatou hlavou",
  group: G,
  icon: "cylinder",
  standards: ["DIN 660", "ISO 1051"],
  keywords: ["nyt", "nyty", "pulkulaty nyt", "rivet", "din 660", "iso 1051"],
  params: [
    { key: "d", label: tr("Průměr d"), kind: "enum", options: [2, 2.5, 3, 4, 5, 6, 8, 10].map((x) => ({ v: String(x), l: `Ø${x}` })), default: "4" },
    lenParam(12),
    grade(["ocel", "hliník", "měď", "A2"], "ocel"),
  ],
  parse: (q) => {
    const kw = has(q, "nyt", "rivet", "din 660", "1051");
    if (!kw) return null;
    const n = nums(q);
    const values: Record<string, string | number> = {};
    if (n[0]) values.d = String([2, 2.5, 3, 4, 5, 6, 8, 10].reduce((a, b) => (Math.abs(b - n[0]) < Math.abs(a - n[0]) ? b : a)));
    const l = length(q) ?? n[1];
    if (l) values.l = l;
    return { values, score: score(kw, (n[0] ? 0.2 : 0) + (l ? 0.2 : 0)) };
  },
  describe: (v) => `DIN 660 – ${v.d}×${fmt(num(v.l))} – ${v.grade}`,
  make: (v) => {
    const d = num(v.d, 4);
    const l = num(v.l, 12);
    const dk = 1.8 * d;
    const k = 0.65 * d;
    const R = ((dk * dk) / 4 + k * k) / (2 * k);
    const cap: Vec2[] = [[0, 0], [dk / 2, 0]];
    for (let i = 1; i <= 8; i++) {
      const x = (dk / 2) * (1 - i / 8);
      cap.push([x, k - (R - Math.sqrt(Math.max(0, R * R - x * x)))]);
    }
    const g = str(v.grade);
    return part(tr("Nýt Ø{0}×{1}", fmt(d), fmt(l)), /hlin/i.test(g) ? "hlinik" : /měď|med/i.test(g) ? "med" : mat(g), [cyl(tr("Dřík"), d, l, -l, "new"), ...revolveProfile("Hlava", cap, "add"), chamferAll(d * 0.08)], tr("DIN 660 – {0}×{1} – {2}", fmt(d), fmt(l), g), "#9aa4ad");
  },
};

const ST: Record<string, { d: number; dk: number; k: number; p: number }> = { "ST2.9": { d: 2.9, dk: 5.6, k: 2.4, p: 1.1 }, "ST3.5": { d: 3.5, dk: 6.9, k: 2.6, p: 1.3 }, "ST3.9": { d: 3.9, dk: 7.5, k: 2.8, p: 1.3 }, "ST4.2": { d: 4.2, dk: 8.2, k: 3.1, p: 1.4 }, "ST4.8": { d: 4.8, dk: 9.5, k: 3.7, p: 1.6 }, "ST5.5": { d: 5.5, dk: 10.8, k: 4, p: 1.8 }, "ST6.3": { d: 6.3, dk: 12.5, k: 4.6, p: 1.8 } };
export const selfTapping: Family = {
  id: "din7981",
  name: "Samořezný šroub s půlkulatou hlavou a křížem (do plechu)",
  group: G,
  icon: "thread",
  standards: ["DIN 7981", "ISO 7049"],
  keywords: ["samorezny sroub", "samorezny", "do plechu", "self tapping", "tapping screw", "din 7981", "iso 7049"],
  params: [{ key: "size", label: tr("Velikost"), kind: "enum", options: Object.keys(ST).map((k) => ({ v: k, l: k })), default: "ST4.2" }, lenParam(16), grade(["ocel pozink", "A2"], tr("ocel pozink"))],
  parse: (q) => {
    const kw = has(q, "samorez", "do plechu", "self tapping", "tapping", "7981", "7049");
    if (!kw) return null;
    const m = (q.match(/st\s?(\d(?:\.\d)?)/) ?? [])[1];
    const n = nums(q);
    const size = m ? `ST${m}` : n[0] ? Object.keys(ST).reduce((a, b) => (Math.abs(ST[b].d - n[0]) < Math.abs(ST[a].d - n[0]) ? b : a)) : undefined;
    const l = length(q) ?? (n.length >= 2 ? n[n.length - 1] : undefined);
    return { values: { ...(size && ST[size] ? { size } : {}), ...(l ? { l } : {}) }, score: score(kw, (size ? 0.2 : 0) + (l ? 0.2 : 0)) };
  },
  describe: (v) => `DIN 7981 – ${v.size}×${fmt(num(v.l))}`,
  make: (v) => {
    const size = str(v.size, "ST4.2");
    const g = ST[size] ?? ST["ST4.2"];
    const l = num(v.l, 16);
    return part(tr("Samořezný šroub {0}×{1}", size, fmt(l)), mat(str(v.grade)), [{ id: uid(), name: "Špička", type: "cone", radius1: 0.2, radius2: g.d / 2, height: g.d * 0.9, position: [0, 0, -l], axis: "Z", mode: "new" }, cyl(tr("Dřík"), g.d, l - g.d * 0.9, -l + g.d * 0.9, "add"), cyl("Hlava", g.dk, g.k, 0, "add"), ...cross(g.dk, g.k, g.k), chamferAll(0.2)], tr("DIN 7981 – {0}×{1}", size, fmt(l)), "#3a3f45");
  },
};

export const FASTENERS2: Family[] = [panHeadCross, countersunkCross, lockNut, flangeNut, wingNut, springWasher, toothWasher, heavyWasher, studDin938, studDin939, eyeBolt, rivet, selfTapping];
export const _nut = NUT;
export const _washer = WASHER;
