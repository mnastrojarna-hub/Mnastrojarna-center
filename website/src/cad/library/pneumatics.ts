/** Pneumatika: válce ISO 15552 a ISO 6432, nástrčné šroubení (zjednodušené geometrie). */
import { uid, type Feature } from "../types";
import { has, nums, score } from "./parse-util";
import type { Family } from "./types";
import { box, chamferAll, cyl, fmt, hexPrism, num, part, str, tube } from "./util";

const G = "Pneumatika a hydraulika";

/** ISO 15552 – profilové válce: AM (čtverec tělesa), MM (pístnice), tie (táhla), cap (délka víka), KK (závit pístnice). */
export const ISO15552: Record<number, { AM: number; MM: number; tie: number; cap: number; KK: string; port: string }> = {
  32: { AM: 45.5, MM: 12, tie: 6, cap: 20, KK: "M10×1,25", port: "G1/8" },
  40: { AM: 54, MM: 16, tie: 6, cap: 22, KK: "M12×1,25", port: "G1/4" },
  50: { AM: 65, MM: 20, tie: 8, cap: 25, KK: "M16×1,5", port: "G1/4" },
  63: { AM: 75, MM: 20, tie: 8, cap: 25, KK: "M16×1,5", port: "G3/8" },
  80: { AM: 93, MM: 25, tie: 10, cap: 30, KK: "M20×1,5", port: "G3/8" },
  100: { AM: 110, MM: 25, tie: 10, cap: 32, KK: "M20×1,5", port: "G1/2" },
  125: { AM: 140, MM: 32, tie: 12, cap: 38, KK: "M27×2", port: "G1/2" },
};
/** ISO 6432 – kruhové miniválce: OD těla, pístnice, závit pístnice. */
export const ISO6432: Record<number, { OD: number; MM: number; KK: string }> = {
  8: { OD: 14, MM: 4, KK: "M4" },
  10: { OD: 16, MM: 4, KK: "M4" },
  12: { OD: 18, MM: 6, KK: "M6" },
  16: { OD: 22, MM: 6, KK: "M6" },
  20: { OD: 26, MM: 8, KK: "M8" },
  25: { OD: 32, MM: 10, KK: "M10×1,25" },
};

function parseCyl(q: string, bores: number[], words: string[]) {
  const kw = has(q, ...words);
  if (!kw) return null;
  const m = q.match(/(\d{1,3})\s?x\s?(\d{2,4})/);
  const n = nums(q).filter((x) => !/15552|6432/.test(String(x)));
  const bore = m ? Number(m[1]) : n.find((x) => bores.includes(x));
  const stroke = m ? Number(m[2]) : (q.match(/(?:zdvih|stroke|z)\s?=?\s?(\d+)/) ?? [])[1] ? Number((q.match(/(?:zdvih|stroke|z)\s?=?\s?(\d+)/) ?? [])[1]) : n.find((x) => x !== bore && x >= 25);
  const values: Record<string, string | number> = {};
  if (bore && bores.includes(bore)) values.bore = String(bore);
  if (stroke) values.stroke = stroke;
  return { values, score: score(kw, (values.bore ? 0.25 : 0) + (stroke ? 0.15 : 0)) };
}

export const cylinderIso15552: Family = {
  id: "cyl15552",
  name: "Pneumatický válec ISO 15552 (profilový)",
  group: G,
  icon: "cylinder",
  standards: ["ISO 15552", "VDMA 24562", "DIN ISO 6431"],
  keywords: ["pneumaticky valec", "pneumaticky", "valec iso 15552", "15552", "vdma", "6431", "pneumatic cylinder", "festo dsbc", "smc"],
  params: [
    { key: "bore", label: "Průměr pístu", kind: "enum", options: Object.keys(ISO15552).map((k) => ({ v: k, l: `Ø${k} (${ISO15552[Number(k)].AM} mm)` })), default: "50" },
    { key: "stroke", label: "Zdvih", kind: "number", min: 10, max: 2000, step: 5, unit: "mm", default: 100 },
    { key: "extended", label: "Vysunutá pístnice", kind: "bool", default: false },
  ],
  sizes: { key: "bore", columns: [{ key: "AM", label: "AM" }, { key: "MM", label: "pístnice" }, { key: "KK", label: "závit" }, { key: "port", label: "přípoj" }], rows: Object.entries(ISO15552).map(([k, v]) => ({ bore: k, ...v })) },
  parse: (q) => (has(q, "6432", "mini", "kruhov", "kulat") ? null : parseCyl(q, Object.keys(ISO15552).map(Number), ["pneumat", "valec", "15552", "vdma", "6431", "cylinder", "dsbc", "dnc"])),
  describe: (v) => `Válec ISO 15552 Ø${v.bore}×${fmt(num(v.stroke))}`,
  make: (v) => {
    const bore = num(v.bore, 50);
    const c = ISO15552[bore] ?? ISO15552[50];
    const stroke = num(v.stroke, 100);
    const L = stroke + 2 * c.cap;
    const ext = v.extended ? stroke : 0;
    const f: Feature[] = [
      { id: uid(), name: "Tělo (profil)", type: "cylinder", radius: bore / 2 + 4, height: stroke, position: [0, 0, c.cap], axis: "Z", mode: "new" },
      box("Víko zadní", [c.AM, c.AM, c.cap], [0, 0, c.cap / 2], "add"),
      box("Víko přední", [c.AM, c.AM, c.cap], [0, 0, L - c.cap / 2], "add"),
    ];
    const o = c.AM / 2 - c.tie;
    for (const [i, [x, y]] of [[-o, -o], [o, -o], [o, o], [-o, o]].entries()) f.push(cyl(`Táhlo ${i + 1}`, c.tie, L, 0, "add", "Z", [x, y]), cyl(`Matice táhla ${i + 1}`, c.tie * 1.6, c.tie * 0.8, L, "add", "Z", [x, y]));
    f.push(cyl("Pístnice", c.MM, c.cap + 10 + ext, L - 2, "add"), cyl("Vedení pístnice", c.MM + 8, 6, L, "add"));
    f.push({ id: uid(), name: "Přípoj 1", type: "cylinder", radius: 5, height: c.AM / 2 + 1, position: [0, 0, c.cap / 2], axis: "Y", mode: "cut" }, { id: uid(), name: "Přípoj 2", type: "cylinder", radius: 5, height: c.AM / 2 + 1, position: [0, 0, L - c.cap / 2], axis: "Y", mode: "cut" });
    f.push(chamferAll(1));
    return part(`Válec ISO 15552 Ø${bore}×${fmt(stroke)}`, "hlinik", f, `ISO 15552 – Ø${bore}×${fmt(stroke)} – ${c.KK} – ${c.port}`, "#d6d9dd");
  },
};

export const cylinderIso6432: Family = {
  id: "cyl6432",
  name: "Pneumatický miniválec ISO 6432 (kruhový)",
  group: G,
  icon: "cylinder",
  standards: ["ISO 6432", "CETOP RP 52 P"],
  keywords: ["minivalec", "kruhovy valec", "valec iso 6432", "6432", "mini cylinder", "round cylinder", "dsnu"],
  params: [
    { key: "bore", label: "Průměr pístu", kind: "enum", options: Object.keys(ISO6432).map((k) => ({ v: k, l: `Ø${k}` })), default: "20" },
    { key: "stroke", label: "Zdvih", kind: "number", min: 10, max: 500, step: 5, unit: "mm", default: 50 },
    { key: "extended", label: "Vysunutá pístnice", kind: "bool", default: false },
  ],
  sizes: { key: "bore", columns: [{ key: "OD", label: "Ø těla" }, { key: "MM", label: "pístnice" }, { key: "KK", label: "závit" }], rows: Object.entries(ISO6432).map(([k, v]) => ({ bore: k, ...v })) },
  parse: (q) => {
    if (!has(q, "6432", "mini", "kruhov", "kulat", "dsnu")) return null;
    return parseCyl(q, Object.keys(ISO6432).map(Number), ["pneumat", "valec", "6432", "mini", "cylinder", "dsnu", "kruhov"]);
  },
  describe: (v) => `Miniválec ISO 6432 Ø${v.bore}×${fmt(num(v.stroke))}`,
  make: (v) => {
    const bore = num(v.bore, 20);
    const c = ISO6432[bore] ?? ISO6432[20];
    const stroke = num(v.stroke, 50);
    const cap = c.OD * 0.8;
    const L = stroke + 2 * cap;
    const ext = v.extended ? stroke : 0;
    return part(`Miniválec ISO 6432 Ø${bore}×${fmt(stroke)}`, "nerez", [
      cyl("Tělo", c.OD, L, 0, "new"),
      cyl("Víko zadní", c.OD + 2, cap, 0, "add"),
      cyl("Víko přední", c.OD + 2, cap, L - cap, "add"),
      cyl("Závit zadní", c.MM + 2, c.OD * 0.5, -c.OD * 0.5, "add"),
      cyl("Pístnice", c.MM, c.OD * 0.8 + ext, L, "add"),
      { id: uid(), name: "Přípoj 1", type: "cylinder", radius: 2.5, height: c.OD / 2 + 2, position: [0, 0, cap / 2], axis: "Y", mode: "cut" },
      { id: uid(), name: "Přípoj 2", type: "cylinder", radius: 2.5, height: c.OD / 2 + 2, position: [0, 0, L - cap / 2], axis: "Y", mode: "cut" },
      chamferAll(0.5),
    ], `ISO 6432 – Ø${bore}×${fmt(stroke)} – ${c.KK}`, "#b9c2cc");
  },
};

const FIT_THREADS: Record<string, { od: number; s: number }> = { M5: { od: 5, s: 8 }, "G1/8": { od: 9.7, s: 12 }, "G1/4": { od: 13.2, s: 14 }, "G3/8": { od: 16.7, s: 17 }, "G1/2": { od: 21, s: 22 } };
export const pushInFitting: Family = {
  id: "pushfit",
  name: "Nástrčné šroubení přímé (push-in)",
  group: G,
  icon: "tube",
  standards: ["ISO 14743"],
  keywords: ["nastrcne sroubeni", "sroubeni", "nastrcna spojka", "push-in fitting", "push in", "fitting", "qs"],
  params: [
    { key: "tube", label: "Hadice Ø", kind: "enum", options: [4, 6, 8, 10, 12].map((x) => ({ v: String(x), l: `Ø${x}` })), default: "8" },
    { key: "thread", label: "Závit", kind: "enum", options: Object.keys(FIT_THREADS).map((k) => ({ v: k, l: k })), default: "G1/4" },
  ],
  parse: (q) => {
    const kw = has(q, "sroubeni", "nastrcn", "push-in", "push in", "fitting", "qs");
    if (!kw) return null;
    const t = (q.match(/\bg\s?(1\/8|1\/4|3\/8|1\/2)/) ?? [])[1];
    const m5 = /\bm5\b/.test(q);
    const tube = nums(q).find((x) => [4, 6, 8, 10, 12].includes(x));
    return { values: { ...(tube ? { tube: String(tube) } : {}), ...(t ? { thread: `G${t}` } : m5 ? { thread: "M5" } : {}) }, score: score(kw, (tube ? 0.2 : 0) + (t || m5 ? 0.2 : 0)) };
  },
  describe: (v) => `Šroubení Ø${v.tube} – ${v.thread}`,
  make: (v) => {
    const t = num(v.tube, 8);
    const th = FIT_THREADS[str(v.thread, "G1/4")] ?? FIT_THREADS["G1/4"];
    const bodyD = t + 6;
    return part(`Šroubení Ø${t} ${v.thread}`, "mosaz", [
      cyl("Závit", th.od, 8, 0, "new"),
      ...hexPrism("Šestihran", th.s, 5, 8, "add"),
      cyl("Tělo", bodyD, 10, 13, "add"),
      tube("Uvolňovací kroužek", t + 4, t + 0.2, 3, 23, "add"),
      cyl("Kanál", t * 0.65, 30, -1, "cut"),
      chamferAll(0.4),
    ], `Šroubení push-in Ø${t} – ${v.thread}`, "#c9a46a");
  },
};

export const PNEUMATICS: Family[] = [cylinderIso15552, cylinderIso6432, pushInFitting];
