/** Normálie vstřikovacích forem (styl HASCO / Meusburger – zjednodušené geometrie). */
import { ejectorPin, guideBush, guidePillar, locatingRing } from "../assembly";
import type { Feature } from "../types";
import { dims, has, length, nums, score } from "./parse-util";
import type { Family, ParamSchema } from "./types";
import { chamferAll, cyl, fmt, num, part, revolveProfile, tube } from "./util";

const dEnum = (vals: number[], def: number, label = "Průměr d"): ParamSchema => ({ key: "d", label, kind: "enum", options: vals.map((v) => ({ v: String(v), l: `Ø${v}` })), default: String(def) });
const lParam = (def: number, min = 10, max = 600): ParamSchema => ({ key: "l", label: "Délka l", kind: "number", min, max, step: 5, unit: "mm", default: def });

function parseDL(q: string, words: string[], dVals?: number[]) {
  const kw = has(q, ...words);
  if (!kw) return null;
  const dm = dims(q);
  const n = nums(q);
  let d = dm[0] ?? n[0];
  const l = dm[1] ?? length(q) ?? n[1];
  if (d && dVals) d = dVals.reduce((a, b) => (Math.abs(b - d!) < Math.abs(a - d!) ? b : a));
  const values: Record<string, string | number> = {};
  if (d) values.d = dVals ? String(d) : d;
  if (l) values.l = l;
  return { values, score: score(kw, (d ? 0.2 : 0) + (l ? 0.2 : 0)) };
}

const PILLAR_D = [12, 16, 20, 24, 30, 40, 50];
const EJ_D = [1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20];

export const moldGuidePillar: Family = {
  id: "mGuidePillar",
  name: "Vodicí sloupek s límcem",
  group: "Normálie forem",
  icon: "cylinder",
  standards: ["HASCO Z00", "Meusburger E1000", "DIN 9825"],
  keywords: ["vodici sloupek", "sloupek", "guide pillar", "leader pin", "z00", "e1000"],
  params: [dEnum(PILLAR_D, 24), lParam(120)],
  parse: (q) => (has(q, "oper", "support") ? null : parseDL(q, ["vodici sloupek", "sloupek", "guide pillar", "leader pin", "z00"], PILLAR_D)),
  describe: (v) => `Vodicí sloupek Ø${v.d}×${fmt(num(v.l))}`,
  make: (v) => guidePillar(num(v.d, 24), num(v.l, 120)),
};

export const moldGuideBush: Family = {
  id: "mGuideBush",
  name: "Vodicí pouzdro s límcem",
  group: "Normálie forem",
  icon: "tube",
  standards: ["HASCO Z10", "Meusburger E1100", "DIN 9831"],
  keywords: ["vodici pouzdro", "pouzdro", "guide bush", "z10", "e1100"],
  params: [dEnum(PILLAR_D, 24), lParam(56)],
  parse: (q) => parseDL(q, ["vodici pouzdro", "pouzdro", "guide bush", "z10"], PILLAR_D),
  describe: (v) => `Vodicí pouzdro Ø${v.d}×${fmt(num(v.l))}`,
  make: (v) => guideBush(num(v.d, 24), num(v.l, 56)),
};

export const moldEjector: Family = {
  id: "mEjector",
  name: "Vyhazovač válcový",
  group: "Normálie forem",
  icon: "cylinder",
  standards: ["ISO 8694", "DIN 1530 A", "HASCO Z40"],
  keywords: ["vyhazovac", "vyhazovaci kolik", "ejector pin", "z40", "din 1530"],
  params: [dEnum(EJ_D, 6), lParam(160, 50, 800)],
  parse: (q) => (has(q, "vratn", "return") ? null : parseDL(q, ["vyhazovac", "ejector", "z40", "1530"], EJ_D)),
  describe: (v) => `Vyhazovač Ø${v.d}×${fmt(num(v.l))}`,
  make: (v) => ejectorPin(num(v.d, 6), num(v.l, 160)),
};

export const moldReturnPin: Family = {
  id: "mReturnPin",
  name: "Vratný kolík",
  group: "Normálie forem",
  icon: "cylinder",
  standards: ["HASCO Z41", "DIN 1530 A"],
  keywords: ["vratny kolik", "vratny", "return pin", "z41"],
  params: [dEnum([10, 12, 16, 20, 25], 16), lParam(200, 50, 800)],
  parse: (q) => parseDL(q, ["vratn", "return pin", "z41"], [10, 12, 16, 20, 25]),
  describe: (v) => `Vratný kolík Ø${v.d}×${fmt(num(v.l))}`,
  make: (v) => {
    const d = num(v.d, 16);
    const l = num(v.l, 200);
    return part(`Vratný kolík Ø${fmt(d)}×${fmt(l)}`, "1.2516", [cyl("Hlava", d + 6, 6, 0, "new"), cyl("Dřík", d, l, 6, "add"), chamferAll(0.8)], `Vratný kolík Ø${fmt(d)}×${fmt(l)}`, "#aeb6bf");
  },
};

export const moldLocatingRing: Family = {
  id: "mLocatingRing",
  name: "Středicí kroužek",
  group: "Normálie forem",
  icon: "tube",
  standards: ["HASCO K100", "Meusburger E1300"],
  keywords: ["stredici krouzek", "centrovaci krouzek", "locating ring", "k100"],
  params: [dEnum([90, 100, 110, 125, 160], 100), { key: "h", label: "Výška", kind: "number", min: 6, max: 30, step: 1, unit: "mm", default: 10 }],
  parse: (q) => {
    const hit = parseDL(q, ["stredici", "centrovaci", "locating ring", "k100"], [90, 100, 110, 125, 160]);
    return hit && { values: { d: hit.values.d, ...(hit.values.l ? { h: hit.values.l } : {}) }, score: hit.score };
  },
  describe: (v) => `Středicí kroužek Ø${v.d}×${fmt(num(v.h))}`,
  make: (v) => locatingRing(num(v.d, 100), num(v.h, 10)),
};

export const moldSprueBush: Family = {
  id: "mSprueBush",
  name: "Vtoková vložka",
  group: "Normálie forem",
  icon: "cone",
  standards: ["HASCO Z51", "Meusburger E1600", "DIN 16752"],
  keywords: ["vtokova vlozka", "vtok", "sprue bushing", "sprue bush", "z51"],
  params: [
    dEnum([12, 16, 20, 25], 16, "Průměr těla d1"),
    lParam(56, 20, 200),
    { key: "d2", label: "Vstupní průměr vtoku", kind: "enum", options: [2.5, 3, 3.5, 4, 4.5, 5, 6].map((x) => ({ v: String(x), l: `${x} mm` })), default: "3.5" },
    { key: "R", label: "Rádius dosedací plochy", kind: "enum", options: [{ v: "15.5", l: "R 15,5 (SR 15,5)" }, { v: "20", l: "R 20" }, { v: "40", l: "R 40" }], default: "15.5" },
  ],
  parse: (q) => parseDL(q, ["vtok", "sprue", "z51"], [12, 16, 20, 25]),
  describe: (v) => `Vtoková vložka Ø${v.d}×${fmt(num(v.l))} – vtok Ø${v.d2} – R${v.R}`,
  make: (v) => {
    const d = num(v.d, 16);
    const l = num(v.l, 56);
    const d2 = num(v.d2, 3.5);
    const R = num(v.R, 15.5);
    const head = d + 8;
    const hk = 8;
    const taper = Math.tan((1.5 * Math.PI) / 180); // kužel vtoku ~3° vrcholový
    const f: Feature[] = [cyl("Tělo", d, l - hk, 0, "new"), cyl("Hlava", head, hk, l - hk, "add")];
    // kuželový vtokový kanál shora dolů (vstup nahoře d2, dole širší)
    f.push({ id: "k", name: "Vtokový kanál", type: "cone", radius1: d2 / 2 + l * taper, radius2: d2 / 2, height: l + 2, position: [0, 0, -1], axis: "Z", mode: "cut" });
    // kulové sedlo trysky nahoře
    f.push({ id: "s", name: "Sedlo trysky", type: "sphere", radius: R, position: [0, 0, l + R - 1.5], mode: "cut" });
    f.push(chamferAll(0.8));
    return part(`Vtoková vložka Ø${fmt(d)}×${fmt(l)}`, "1.2343", f, `Vtoková vložka Ø${fmt(d)}×${fmt(l)} – d${fmt(d2)} – SR${fmt(R)}`, "#c9a46a");
  },
};

export const moldSupportPillar: Family = {
  id: "mSupportPillar",
  name: "Opěrný sloupek",
  group: "Normálie forem",
  icon: "cylinder",
  standards: ["HASCO Z57", "Meusburger E1500"],
  keywords: ["operny sloupek", "oper", "support pillar", "z57"],
  params: [dEnum([20, 25, 30, 40, 50, 60], 30), lParam(96, 20, 400), { key: "thread", label: "Závit", kind: "enum", options: ["M6", "M8", "M10", "M12", "M16"].map((m) => ({ v: m, l: m })), default: "M10" }],
  parse: (q) => parseDL(q, ["operny", "oper", "support pillar", "z57"], [20, 25, 30, 40, 50, 60]),
  describe: (v) => `Opěrný sloupek Ø${v.d}×${fmt(num(v.l))} – ${v.thread}`,
  make: (v) => {
    const d = num(v.d, 30);
    const l = num(v.l, 96);
    const td = Number(String(v.thread ?? "M10").replace("M", "")) || 10;
    return part(`Opěrný sloupek Ø${fmt(d)}×${fmt(l)}`, "1.1730", [cyl("Sloupek", d, l, 0, "new"), cyl("Závitová díra 1", td * 0.85, td * 2, -1, "cut"), cyl("Závitová díra 2", td * 0.85, td * 2, l - td * 2 + 1, "cut"), chamferAll(1)], `Opěrný sloupek Ø${fmt(d)}×${fmt(l)} – ${v.thread}`, "#9aa4ad");
  },
};

export const moldStopButton: Family = {
  id: "mStopButton",
  name: "Dosedka (opěrná podložka)",
  group: "Normálie forem",
  icon: "tube",
  standards: ["HASCO Z55", "Meusburger E1540"],
  keywords: ["dosedka", "operna podlozka", "stop button", "stop disc", "z55"],
  params: [dEnum([16, 20, 25, 32, 40], 25), { key: "h", label: "Výška", kind: "number", min: 3, max: 20, step: 0.5, unit: "mm", default: 6 }],
  parse: (q) => {
    const hit = parseDL(q, ["dosedk", "stop button", "stop disc", "z55"], [16, 20, 25, 32, 40]);
    return hit && { values: { d: hit.values.d, ...(hit.values.l ? { h: hit.values.l } : {}) }, score: hit.score };
  },
  describe: (v) => `Dosedka Ø${v.d}×${fmt(num(v.h))}`,
  make: (v) => {
    const d = num(v.d, 25);
    const h = num(v.h, 6);
    const prof: [number, number][] = [[0, 0], [d / 2, 0], [d / 2, h - 1], [d / 2 - 1, h], [0, h]];
    return part(`Dosedka Ø${fmt(d)}×${fmt(h)}`, "1.7131", [...revolveProfile("Dosedka", prof, "new"), tube("Zahloubení", 6.6, 0, 3, h - 3, "cut")], `Dosedka Ø${fmt(d)}×${fmt(h)}`, "#aeb6bf");
  },
};

export const MOLD_PARTS: Family[] = [moldGuidePillar, moldGuideBush, moldEjector, moldReturnPin, moldLocatingRing, moldSprueBush, moldSupportPillar, moldStopButton];
