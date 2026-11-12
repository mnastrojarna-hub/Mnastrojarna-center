/** Lineární technika: profilové kolejnice a vozíky (HIWIN HG), kuličkové šrouby SFU, vodicí tyče W, domečky SHF, kuličková pouzdra LM, tělesa SC. */
import { tr } from "../i18n";
import { uid, type Feature } from "../types";
import { has, length, nums, score } from "./parse-util";
import type { Family } from "./types";
import { box, chamferAll, cyl, fmt, num, part, str, tube } from "./util";

const G = "Lineární technika";
const COLOR = "#aeb6bf";

export const HGR: Record<string, { W: number; H: number; P: number; d: number; D: number; h: number }> = {
  "15": { W: 15, H: 15, P: 60, d: 4.5, D: 7.5, h: 5.3 },
  "20": { W: 20, H: 17.5, P: 60, d: 6, D: 9.5, h: 8.5 },
  "25": { W: 23, H: 22, P: 60, d: 7, D: 11, h: 9 },
  "30": { W: 28, H: 26, P: 80, d: 9, D: 15, h: 12 },
  "35": { W: 34, H: 29, P: 80, d: 9, D: 15, h: 12 },
};
export const HGH: Record<string, { H: number; W: number; L: number; B: number; C: number; M: number; H1: number }> = {
  "15": { H: 28, W: 34, L: 61.4, B: 26, C: 26, M: 4, H1: 4.3 },
  "20": { H: 30, W: 44, L: 77.5, B: 32, C: 36, M: 5, H1: 4.6 },
  "25": { H: 40, W: 48, L: 84, B: 35, C: 35, M: 6, H1: 5.5 },
  "30": { H: 45, W: 60, L: 97.4, B: 40, C: 40, M: 8, H1: 6 },
  "35": { H: 55, W: 70, L: 112.4, B: 50, C: 50, M: 8, H1: 7.5 },
};
export const HGW: Record<string, { H: number; W: number; L: number; B: number; C: number; M: number; H1: number }> = {
  "15": { H: 24, W: 47, L: 61.4, B: 38, C: 30, M: 5, H1: 4.3 },
  "20": { H: 30, W: 63, L: 77.5, B: 53, C: 40, M: 6, H1: 4.6 },
  "25": { H: 36, W: 70, L: 84, B: 57, C: 45, M: 8, H1: 5.5 },
  "30": { H: 42, W: 90, L: 97.4, B: 72, C: 52, M: 10, H1: 6 },
  "35": { H: 48, W: 100, L: 112.4, B: 82, C: 62, M: 10, H1: 7.5 },
};
export const SFU: Record<string, { d: number; p: number; nutD: number; flange: number; nutL: number; ft: number }> = {
  "1204": { d: 12, p: 4, nutD: 22, flange: 42, nutL: 35, ft: 8 },
  "1605": { d: 16, p: 5, nutD: 28, flange: 48, nutL: 42, ft: 10 },
  "1610": { d: 16, p: 10, nutD: 28, flange: 48, nutL: 55, ft: 10 },
  "2005": { d: 20, p: 5, nutD: 36, flange: 58, nutL: 42, ft: 10 },
  "2010": { d: 20, p: 10, nutD: 36, flange: 58, nutL: 58, ft: 10 },
  "2505": { d: 25, p: 5, nutD: 40, flange: 62, nutL: 46, ft: 10 },
  "2510": { d: 25, p: 10, nutD: 40, flange: 62, nutL: 62, ft: 10 },
  "3205": { d: 32, p: 5, nutD: 50, flange: 80, nutL: 52, ft: 12 },
  "3210": { d: 32, p: 10, nutD: 50, flange: 80, nutL: 70, ft: 12 },
};
export const SHF: Record<string, { W: number; H: number; L: number; P: number; s: number }> = {
  "8": { W: 42, H: 20, L: 14, P: 32, s: 5.5 },
  "10": { W: 42, H: 20, L: 14, P: 32, s: 5.5 },
  "12": { W: 42, H: 20, L: 14, P: 32, s: 5.5 },
  "16": { W: 48, H: 27, L: 20, P: 38, s: 5.5 },
  "20": { W: 60, H: 31, L: 20, P: 45, s: 6.6 },
  "25": { W: 70, H: 35, L: 24, P: 56, s: 6.6 },
  "30": { W: 84, H: 42, L: 28, P: 64, s: 9 },
  "40": { W: 106, H: 50, L: 32, P: 80, s: 11 },
};
export const LM: Record<string, { d: number; D: number; L: number }> = {
  "8": { d: 8, D: 15, L: 24 },
  "10": { d: 10, D: 19, L: 29 },
  "12": { d: 12, D: 21, L: 30 },
  "13": { d: 13, D: 23, L: 32 },
  "16": { d: 16, D: 28, L: 37 },
  "20": { d: 20, D: 32, L: 42 },
  "25": { d: 25, D: 40, L: 59 },
  "30": { d: 30, D: 45, L: 64 },
  "35": { d: 35, D: 52, L: 70 },
  "40": { d: 40, D: 60, L: 80 },
};
export const SC: Record<string, { W: number; H: number; L: number; px: number; py: number }> = {
  "8": { W: 34, H: 22, L: 30, px: 24, py: 18 },
  "10": { W: 40, H: 26, L: 35, px: 28, py: 21 },
  "12": { W: 42, H: 28, L: 36, px: 30, py: 26 },
  "16": { W: 50, H: 32, L: 44.5, px: 36, py: 26 },
  "20": { W: 54, H: 36, L: 50, px: 40, py: 32 },
  "25": { W: 76, H: 47, L: 61, px: 54, py: 39 },
};

const sizeEnum = (keys: string[], prefix: string, def: string) => ({ key: "size", label: tr("Velikost"), kind: "enum" as const, options: keys.map((k) => ({ v: k, l: `${prefix}${k}` })), default: def });
const lenParam = (def: number, max = 4000) => ({ key: "l", label: tr("Délka L"), kind: "number" as const, min: 10, max, step: 10, unit: "mm", default: def });

export const linearRail: Family = {
  id: "hgr",
  name: "Profilová kolejnice lineárního vedení HGR",
  group: G,
  icon: "box",
  standards: ["HIWIN HGR", "DIN 645"],
  keywords: ["kolejnice", "linearni vedeni", "linearni kolejnice", "hgr", "hiwin", "linear rail", "linear guide", "profilova kolejnice"],
  params: [sizeEnum(Object.keys(HGR), "HGR", "20"), lenParam(500)],
  sizes: { key: "size", columns: [{ key: "W", label: "W" }, { key: "H", label: "H" }, { key: "P", label: tr("rozteč") }, { key: "d", label: tr("díra") }], rows: Object.entries(HGR).map(([k, v]) => ({ size: k, ...v })) },
  parse: (q) => {
    const kw = has(q, "kolejnic", "linearni veden", "hgr", "hiwin", "linear rail", "linear guide", "rail");
    const m = (q.match(/\bhgr\s?(15|20|25|30|35)/) ?? [])[1];
    if (!kw && !m) return null;
    if (has(q, "vozik", "block", "hgh", "hgw", "carriage")) return null;
    const size = m ?? nums(q).find((x) => HGR[String(x)]);
    const l = length(q) ?? nums(q).find((x) => x >= 100 && String(x) !== String(size));
    return { values: { ...(size ? { size: String(size) } : {}), ...(l ? { l } : {}) }, score: score(kw || 4, (size ? 0.3 : 0) + (l ? 0.1 : 0)) };
  },
  describe: (v) => `Kolejnice HGR${v.size} – L ${fmt(num(v.l))}`,
  make: (v) => {
    const r = HGR[str(v.size, "20")] ?? HGR["20"];
    const l = num(v.l, 500);
    const f: Feature[] = [box("Kolejnice", [r.W, l, r.H], [0, l / 2, r.H / 2], "new")];
    // vodicí drážky na bocích
    f.push(box(tr("Drážka L"), [r.W * 0.12, l + 2, r.H * 0.22], [-r.W / 2 + r.W * 0.06, l / 2, r.H * 0.55], "cut"), box(tr("Drážka P"), [r.W * 0.12, l + 2, r.H * 0.22], [r.W / 2 - r.W * 0.06, l / 2, r.H * 0.55], "cut"));
    const n = Math.max(1, Math.floor((l - 20) / r.P) + 1);
    const y0 = (l - (n - 1) * r.P) / 2;
    for (let i = 0; i < n; i++) f.push({ id: uid(), name: `Díra ${i + 1}`, type: "hole", position: [0, y0 + i * r.P, r.H], axis: "Z", flip: false, diameter: r.d, depth: 0, cbDiameter: r.D, cbDepth: r.h, kind: "counterbore" });
    f.push(chamferAll(0.5));
    return part(tr("Kolejnice HGR{0} L{1}", v.size, fmt(l)), "ocel", f, `HGR${v.size}R${fmt(l)}`, COLOR);
  },
};

const block = (id: string, name: string, table: typeof HGH, flange: boolean): Family => ({
  id,
  name,
  group: G,
  icon: "box",
  standards: [flange ? "HIWIN HGW…CC" : "HIWIN HGH…CA"],
  keywords: ["vozik", "linearni vozik", "vozik vedeni", flange ? "hgw" : "hgh", "hiwin", "linear block", "carriage", flange ? "prirubovy" : "uzky"],
  params: [sizeEnum(Object.keys(table), flange ? "HGW" : "HGH", "20")],
  sizes: { key: "size", columns: [{ key: "H", label: "H" }, { key: "W", label: "W" }, { key: "L", label: "L" }, { key: "B", label: "B" }, { key: "C", label: "C" }], rows: Object.entries(table).map(([k, v]) => ({ size: k, ...v })) },
  parse: (q) => {
    const m = (q.match(flange ? /\bhgw\s?(15|20|25|30|35)/ : /\bhgh\s?(15|20|25|30|35)/) ?? [])[1];
    const kw = has(q, "vozik", "carriage", "block", flange ? "hgw" : "hgh");
    if (!kw && !m) return null;
    if (!m && has(q, flange ? "hgh" : "hgw")) return null;
    const size = m ?? nums(q).find((x) => table[String(x)]);
    const other = flange ? !!has(q, "prirub", "flange", "hgw") : !has(q, "prirub", "flange", "hgw");
    return { values: size ? { size: String(size) } : {}, score: score(kw || 3, size ? 0.35 : 0) * (other || m ? 1 : 0.85) };
  },
  describe: (v) => `Vozík ${flange ? "HGW" : "HGH"}${v.size}${flange ? "CC" : "CA"}`,
  make: (v) => {
    const s = str(v.size, "20");
    const b = table[s] ?? table["20"];
    const r = HGR[s] ?? HGR["20"];
    const f: Feature[] = [box(tr("Vozík"), [b.W, b.L, b.H - b.H1], [0, 0, b.H1 + (b.H - b.H1) / 2], "new"), chamferAll(0.5), box(tr("Kanál kolejnice"), [r.W + 0.6, b.L + 2, r.H - b.H1 + 0.3], [0, 0, b.H1 + (r.H - b.H1 + 0.3) / 2 - 0.3], "cut")];
    for (const [x, y] of [[-b.B / 2, -b.C / 2], [b.B / 2, -b.C / 2], [-b.B / 2, b.C / 2], [b.B / 2, b.C / 2]]) f.push(cyl(tr("Závitová díra"), b.M * 0.85, flange ? b.H - b.H1 + 1 : b.M * 1.5 + 1, flange ? b.H1 - 0.5 : b.H - b.M * 1.5, "cut", "Z", [x, y]));
    f.push(box(tr("Koncovka 1"), [b.W * 0.98, 4, b.H - b.H1 - 1], [0, -b.L / 2 + 2, b.H1 + (b.H - b.H1) / 2], "add"), box(tr("Koncovka 2"), [b.W * 0.98, 4, b.H - b.H1 - 1], [0, b.L / 2 - 2, b.H1 + (b.H - b.H1) / 2], "add"));
    return part(tr("Vozík {0}{1}", flange ? "HGW" : "HGH", s), "ocel", f, `${flange ? "HGW" : "HGH"}${s}${flange ? "CC" : "CA"}`, COLOR);
  },
});
export const blockHGH = block("hgh", tr("Vozík lineárního vedení HGH (úzký)"), HGH, false);
export const blockHGW = block("hgw", tr("Vozík lineárního vedení HGW (přírubový)"), HGW, true);

export const ballScrew: Family = {
  id: "sfu",
  name: "Kuličkový šroub s přírubovou maticí SFU",
  group: G,
  icon: "cylinder",
  standards: ["DIN 69051", "ISO 3408", "SFU/DFU"],
  keywords: ["kulickovy sroub", "kulickovy", "sfu", "dfu", "ball screw", "ballscrew", "kulickova matice"],
  params: [sizeEnum(Object.keys(SFU), "SFU", "1605"), lenParam(500, 3000), { key: "nutPos", label: tr("Poloha matice"), kind: "number", min: 0, max: 3000, step: 10, unit: "mm", default: 100 }, { key: "ends", label: tr("Obrobené konce (osazení)"), kind: "bool", default: true }],
  sizes: { key: "size", columns: [{ key: "d", label: "d" }, { key: "p", label: tr("stoupání") }, { key: "nutD", label: tr("matice Ø") }, { key: "flange", label: tr("příruba Ø") }, { key: "nutL", label: tr("matice L") }], rows: Object.entries(SFU).map(([k, v]) => ({ size: k, ...v })) },
  parse: (q) => {
    const kw = has(q, "kulickov", "sfu", "dfu", "ball screw", "ballscrew");
    const m = (q.match(/\b[sd]fu\s?(\d{4})/) ?? [])[1];
    if (!kw && !m) return null;
    const size = m && SFU[m] ? m : undefined;
    const l = length(q) ?? nums(q).find((x) => x >= 100 && String(x) !== m);
    return { values: { ...(size ? { size } : {}), ...(l ? { l } : {}) }, score: score(kw || 3, (size ? 0.3 : 0) + (l ? 0.1 : 0)) };
  },
  describe: (v) => `Kuličkový šroub SFU${v.size} – L ${fmt(num(v.l))}`,
  make: (v) => {
    const s = str(v.size, "1605");
    const b = SFU[s] ?? SFU["1605"];
    const l = num(v.l, 500);
    const np = Math.min(l - b.nutL - 20, Math.max(20, num(v.nutPos, 100)));
    const f: Feature[] = [cyl(tr("Hřídel"), b.d, l, 0, "new")];
    if (v.ends !== false) f.push(cyl(tr("Osazení 1"), b.d + 2, 15, -15, "cut"), cyl(tr("Konec 1"), b.d * 0.6, 15, -15, "add"), cyl(tr("Konec 2"), b.d * 0.6, 15, l, "add"));
    f.push(cyl("Matice", b.nutD, b.nutL, np, "add"), cyl(tr("Příruba matice"), b.flange, b.ft, np + b.nutL - b.ft - 2, "add"));
    const hole: Feature = cyl(tr("Díra příruby"), b.ft * 0.65, b.ft + 2, np + b.nutL - b.ft - 3, "cut", "Z", [(b.flange + b.nutD) / 4, 0]);
    f.push(hole, { id: uid(), name: "Díry příruby", type: "pattern", featureId: hole.id, kind: "circular", count: 6, angle: 360, axis: "Z", center: [0, 0, 0] }, chamferAll(0.5));
    return part(tr("Kuličkový šroub SFU{0} L{1}", s, fmt(l)), "ocel", f, tr("SFU{0}-{1} + matice DIN 69051", s, fmt(l)), COLOR);
  },
};

export const linearShaft: Family = {
  id: "shaftW",
  name: "Vodicí tyč kalená broušená W (h6)",
  group: G,
  icon: "cylinder",
  standards: ["ISO 286 h6", "Cf53 / 1.1213 kalená"],
  keywords: ["vodici tyc", "tyc h6", "kalena tyc", "brousena tyc", "linear shaft", "hardened shaft", "w8", "w12", "w16", "w20"],
  params: [sizeEnum(Object.keys(LM), "W", "16"), lenParam(500, 3000)],
  parse: (q) => {
    const kw = has(q, "vodici tyc", "kalena tyc", "brousena", "linear shaft", "hardened shaft", "h6");
    const m = (q.match(/\bw\s?(8|10|12|13|16|20|25|30|35|40)\b/) ?? [])[1];
    if (!kw && !m) return null;
    if (has(q, "sloupek", "pillar")) return null;
    const size = m ?? nums(q).find((x) => LM[String(x)]);
    const l = length(q) ?? nums(q).find((x) => x >= 100 && String(x) !== String(size));
    return { values: { ...(size ? { size: String(size) } : {}), ...(l ? { l } : {}) }, score: score(kw || 3, (size ? 0.3 : 0) + (l ? 0.1 : 0)) };
  },
  describe: (v) => `Vodicí tyč W${v.size} h6 – L ${fmt(num(v.l))}`,
  make: (v) => {
    const d = num(v.size, 16);
    const l = num(v.l, 500);
    return part(tr("Vodicí tyč W{0} L{1}", d, fmt(l)), "ocel", [cyl(tr("Tyč"), d, l, 0, "new"), chamferAll(Math.min(1, d * 0.06))], tr("W{0} h6 × {1} – kalená 60 HRC", d, fmt(l)), "#c9d1d9");
  },
};

export const shaftSupport: Family = {
  id: "shf",
  name: "Domeček vodicí tyče SHF (přírubový)",
  group: G,
  icon: "box",
  standards: ["SHF", "SK"],
  keywords: ["domecek tyce", "domecek", "drzak tyce", "shf", "sk", "shaft support", "rod support"],
  params: [sizeEnum(Object.keys(SHF), "SHF", "16")],
  sizes: { key: "size", columns: [{ key: "W", label: "W" }, { key: "H", label: tr("výška osy") }, { key: "L", label: tr("tloušťka") }, { key: "P", label: tr("rozteč") }], rows: Object.entries(SHF).map(([k, v]) => ({ size: k, ...v })) },
  parse: (q) => {
    const kw = has(q, "domecek", "drzak tyce", "shaft support", "rod support", "shf");
    const m = (q.match(/\bshf\s?(8|10|12|16|20|25|30|40)\b/) ?? [])[1];
    if (!kw && !m) return null;
    if (has(q, "lozisk", "ucp")) return null;
    const size = m ?? nums(q).find((x) => SHF[String(x)]);
    return { values: size ? { size: String(size) } : {}, score: score(kw || 3, size ? 0.35 : 0) };
  },
  describe: (v) => `Domeček SHF${v.size}`,
  make: (v) => {
    const s = str(v.size, "16");
    const h = SHF[s] ?? SHF["16"];
    const d = Number(s);
    const top = h.H + d / 2 + 6;
    return part(tr("Domeček SHF{0}", s), "hlinik", [
      box("Patka", [h.W, h.L, 6], [0, 0, 3], "new"),
      box("Stojina", [d + 14, h.L, top - 6], [0, 0, 6 + (top - 6) / 2], "add"),
      chamferAll(0.5),
      { id: uid(), name: "Díra tyče", type: "cylinder", radius: d / 2, height: h.L + 2, position: [0, -h.L / 2 - 1, h.H], axis: "Y", mode: "cut" },
      box(tr("Rozříznutí"), [1.2, h.L + 2, top - h.H], [0, 0, h.H + (top - h.H) / 2], "cut"),
      { id: uid(), name: "Stahovací šroub", type: "cylinder", radius: h.s / 2, height: d + 16, position: [-(d + 16) / 2, 0, h.H + d / 2 + 3], axis: "X", mode: "cut" },
      cyl(tr("Díra 1"), h.s, 8, -1, "cut", "Z", [-h.P / 2, 0]),
      cyl(tr("Díra 2"), h.s, 8, -1, "cut", "Z", [h.P / 2, 0]),
    ], tr("SHF{0} – rozteč {1}", s, h.P), "#d6d9dd");
  },
};

export const linearBushing: Family = {
  id: "lm",
  name: "Lineární kuličkové pouzdro LM…UU",
  group: G,
  icon: "tube",
  standards: ["LM…UU", "ISO 10285"],
  keywords: ["linearni pouzdro", "kulickove pouzdro", "linearni lozisko", "lm", "lmuu", "linear bearing", "linear bushing"],
  params: [sizeEnum(Object.keys(LM), "LM", "16")],
  sizes: { key: "size", columns: [{ key: "d", label: "d" }, { key: "D", label: "D" }, { key: "L", label: "L" }], rows: Object.entries(LM).map(([k, v]) => ({ size: k, ...v })) },
  parse: (q) => {
    const kw = has(q, "linearni pouzdro", "kulickove pouzdro", "linearni lozisko", "linear bearing", "linear bushing", "lmuu");
    const m = (q.match(/\blm\s?(8|10|12|13|16|20|25|30|35|40)\s?(?:uu|luu)?\b/) ?? [])[1];
    if (!kw && !m) return null;
    const size = m ?? nums(q).find((x) => LM[String(x)]);
    return { values: size ? { size: String(size) } : {}, score: score(kw || 3, size ? 0.35 : 0) };
  },
  describe: (v) => `Pouzdro LM${v.size}UU (${LM[str(v.size)]?.d}×${LM[str(v.size)]?.D}×${LM[str(v.size)]?.L})`,
  make: (v) => {
    const s = str(v.size, "16");
    const b = LM[s] ?? LM["16"];
    const g = Math.max(0.5, b.D * 0.03);
    return part(tr("Pouzdro LM{0}UU", s), "ocel", [tube("Pouzdro", b.D, b.d, b.L, 0, "new"), tube(tr("Drážka 1"), b.D + 2, b.D - 2 * g, g, b.L * 0.12, "cut"), tube(tr("Drážka 2"), b.D + 2, b.D - 2 * g, g, b.L * 0.88 - g, "cut"), chamferAll(0.4)], tr("LM{0}UU – {1}×{2}×{3}", s, b.d, b.D, b.L), COLOR);
  },
};

export const bearingHousingSC: Family = {
  id: "scuu",
  name: "Těleso lineárního pouzdra SC…UU",
  group: G,
  icon: "box",
  standards: ["SC…UU", "SCS"],
  keywords: ["teleso pouzdra", "scuu", "sc8uu", "sc12uu", "sc16uu", "linear bearing housing", "pillow block linear"],
  params: [sizeEnum(Object.keys(SC), "SC", "16")],
  parse: (q) => {
    const kw = has(q, "scuu", "sc uu", "teleso pouzdra", "linear bearing housing", "linear pillow");
    const m = (q.match(/\bsc\s?(8|10|12|16|20|25)\s?uu\b/) ?? [])[1];
    if (!kw && !m) return null;
    const size = m ?? nums(q).find((x) => SC[String(x)]);
    return { values: size ? { size: String(size) } : {}, score: score(kw || 3, size ? 0.35 : 0) };
  },
  describe: (v) => `Těleso SC${v.size}UU`,
  make: (v) => {
    const s = str(v.size, "16");
    const b = SC[s] ?? SC["16"];
    const lm = LM[s] ?? LM["16"];
    const f: Feature[] = [box(tr("Těleso"), [b.W, b.L, b.H], [0, 0, b.H / 2], "new"), chamferAll(0.8), { id: uid(), name: "Otvor pouzdra", type: "cylinder", radius: lm.D / 2 + 0.1, height: b.L + 2, position: [0, -b.L / 2 - 1, b.H * 0.55], axis: "Y", mode: "cut" }];
    for (const [x, y] of [[-b.px / 2, -b.py / 2], [b.px / 2, -b.py / 2], [-b.px / 2, b.py / 2], [b.px / 2, b.py / 2]]) f.push(cyl(tr("Díra"), 5.5, b.H + 2, -1, "cut", "Z", [x, y]));
    return part(tr("Těleso SC{0}UU", s), "hlinik", f, `SC${s}UU`, "#d6d9dd");
  },
};

export const LINEAR: Family[] = [linearRail, blockHGH, blockHGW, ballScrew, linearShaft, shaftSupport, linearBushing, bearingHousingSC];
