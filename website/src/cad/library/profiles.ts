/** Ocelové profily a trubky (hutní materiál) – vysunuté 2D profily podél osy Z. */
import type { Vec2 } from "../types";
import { dims, has, length, nums, score } from "./parse-util";
import { ANGLES, CHS, HEA, HEB, HOLLOW, IPE, UPN, type IProfile } from "./tables";
import type { Family, ParamSchema } from "./types";
import { cyl, extrudePoly, fmt, hexPrism, nearest, num, part, rnd, str, tube } from "./util";

const lenParam = (def = 1000): ParamSchema => ({ key: "l", label: "Délka L", kind: "number", min: 1, max: 12000, step: 10, unit: "mm", default: def });
const STEEL = "ocel";
const COLOR = "#7f8a96";

/** Oblouk (zaoblení) mezi dvěma směry – body po čtvrtkružnici. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 4): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([rnd(cx + r * Math.cos(a), 4), rnd(cy + r * Math.sin(a), 4)]);
  }
  return out;
}

/** Profil I (IPE/HE) se zaoblením mezi stojinou a pásnicí. Střed průřezu v počátku. */
export function iProfile({ h, b, tw, tf, r }: IProfile): Vec2[] {
  const x1 = tw / 2;
  const y1 = h / 2 - tf;
  const right: Vec2[] = [
    [b / 2, -h / 2], [b / 2, -y1], [x1 + r, -y1],
    ...arc(x1 + r, -y1 + r, r, 270, 180),
    [x1, y1 - r],
    ...arc(x1 + r, y1 - r, r, 180, 90),
    [b / 2, y1], [b / 2, h / 2],
  ];
  const left = right.map(([x, y]) => [-x, y] as Vec2).reverse();
  return [...right, ...left];
}

/** Profil U (UPN) – rovnoběžné pásnice (zjednodušeno bez úkosu 8 %), otevřený k +X. */
export function uProfile({ h, b, tw, tf, r }: IProfile): Vec2[] {
  const y1 = h / 2 - tf;
  return [
    [0, -h / 2], [b, -h / 2], [b, -y1], [tw + r, -y1],
    ...arc(tw + r, -y1 + r, r, 270, 180),
    [tw, y1 - r],
    ...arc(tw + r, y1 - r, r, 180, 90),
    [b, y1], [b, h / 2], [0, h / 2],
  ];
}

export function lProfile(a: number, b: number, t: number, r: number): Vec2[] {
  return [[0, 0], [a, 0], [a, t], [t + r, t], ...arc(t + r, t + r, r, 270, 180), [t, b], [0, b]];
}

/** Uzavřený profil (RHS/SHS): vnější obrys s rádiusem 2t, vnitřní s rádiusem t. */
export function hollowOuter(w: number, h: number, ro: number): Vec2[] {
  const x = w / 2 - ro;
  const y = h / 2 - ro;
  return [...arc(x, -y, ro, 270, 360), ...arc(x, y, ro, 0, 90), ...arc(-x, y, ro, 90, 180), ...arc(-x, -y, ro, 180, 270)];
}

const iFamily = (id: string, name: string, table: Record<string, IProfile>, kw: string[], def: string): Family => ({
  id,
  name,
  group: "Ocelové profily a trubky",
  icon: "box",
  standards: id === "ipe" ? ["EN 10365", "DIN 1025-5"] : id === "hea" ? ["EN 10365", "DIN 1025-3"] : ["EN 10365", "DIN 1025-2"],
  keywords: [...kw, "nosnik", "profil", "beam", "i profil"],
  params: [{ key: "size", label: "Velikost", kind: "enum", options: Object.keys(table).map((k) => ({ v: k, l: `${id.toUpperCase()} ${k}` })), default: def }, lenParam()],
  sizes: { key: "size", columns: [{ key: "h", label: "h" }, { key: "b", label: "b" }, { key: "tw", label: "tw" }, { key: "tf", label: "tf" }, { key: "r", label: "r" }], rows: Object.entries(table).map(([k, v]) => ({ size: k, ...v })) },
  parse: (q) => {
    const k = has(q, ...kw);
    if (!k) return null;
    const n = nums(q);
    const size = n.find((x) => table[String(x)]);
    const l = length(q) ?? n.find((x) => x !== size && x >= 50);
    return { values: { ...(size ? { size: String(size) } : {}), ...(l ? { l } : {}) }, score: score(k, (size ? 0.3 : 0) + (l ? 0.1 : 0)) };
  },
  describe: (v) => `${id.toUpperCase()} ${v.size} – L ${fmt(num(v.l))} mm`,
  make: (v) => {
    const p = table[str(v.size, def)] ?? table[def];
    const l = num(v.l, 1000);
    return part(`${id.toUpperCase()} ${str(v.size, def)} L${fmt(l)}`, STEEL, extrudePoly(`${id.toUpperCase()} ${v.size}`, iProfile(p), l, "new"), `${id.toUpperCase()} ${str(v.size, def)} – S235JR – L=${fmt(l)}`, COLOR);
  },
});
export const ipe = iFamily("ipe", "Nosník IPE", IPE, ["ipe"], "200");
export const hea = iFamily("hea", "Nosník HEA", HEA, ["hea", "he a"], "200");
export const heb = iFamily("heb", "Nosník HEB", HEB, ["heb", "he b"], "200");

export const upn: Family = {
  id: "upn",
  name: "Profil U (UPN)",
  group: "Ocelové profily a trubky",
  icon: "box",
  standards: ["EN 10365", "DIN 1026-1"],
  keywords: ["upn", "u profil", "profil u", "unp", "u 100", "channel"],
  params: [{ key: "size", label: "Velikost", kind: "enum", options: Object.keys(UPN).map((k) => ({ v: k, l: `UPN ${k}` })), default: "100" }, lenParam()],
  sizes: { key: "size", columns: [{ key: "h", label: "h" }, { key: "b", label: "b" }, { key: "tw", label: "tw" }, { key: "tf", label: "tf" }], rows: Object.entries(UPN).map(([k, v]) => ({ size: k, ...v })) },
  parse: (q) => {
    const k = has(q, "upn", "unp", "u profil", "profil u", "channel") || (/(^|\s)u\s?\d{2,3}\b/.test(q) ? 1 : 0);
    if (!k) return null;
    const n = nums(q);
    const size = n.find((x) => UPN[String(x)]);
    const l = length(q) ?? n.find((x) => x !== size && x >= 50);
    return { values: { ...(size ? { size: String(size) } : {}), ...(l ? { l } : {}) }, score: score(k, (size ? 0.3 : 0) + (l ? 0.1 : 0)) };
  },
  describe: (v) => `UPN ${v.size} – L ${fmt(num(v.l))} mm`,
  make: (v) => {
    const p = UPN[str(v.size, "100")] ?? UPN["100"];
    const l = num(v.l, 1000);
    return part(`UPN ${str(v.size, "100")} L${fmt(l)}`, STEEL, extrudePoly("UPN", uProfile(p), l, "new"), `UPN ${str(v.size, "100")} – S235JR – L=${fmt(l)}`, COLOR);
  },
};

export const angle: Family = {
  id: "angle",
  name: "Úhelník L",
  group: "Ocelové profily a trubky",
  icon: "box",
  standards: ["EN 10056-1", "DIN 1028/1029"],
  keywords: ["uhelnik", "l profil", "profil l", "angle", "l 50x50x5"],
  params: [
    { key: "size", label: "Rozměr a×b×t", kind: "enum", options: ANGLES.map((a) => ({ v: `${a.a}x${a.b}x${a.t}`, l: `L ${a.a}×${a.b}×${a.t}` })), default: "50x50x5" },
    lenParam(),
  ],
  parse: (q) => {
    const k = has(q, "uhelnik", "l profil", "profil l", "angle") || (/(^|\s)l\s?\d{2,3}\s?x\s?\d/.test(q) ? 1 : 0);
    if (!k) return null;
    const d = dims(q);
    const values: Record<string, string | number> = {};
    if (d.length >= 2) {
      const [a, b, t] = d.length === 2 ? [d[0], d[0], d[1]] : d;
      const row = ANGLES.find((x) => x.a === a && x.b === b && x.t === t) ?? ANGLES.find((x) => x.a === a && x.b === b) ?? nearest(ANGLES, "a", a);
      values.size = `${row.a}x${row.b}x${row.t}`;
    }
    const l = length(q);
    if (l) values.l = l;
    return { values, score: score(k, (values.size ? 0.3 : 0) + (l ? 0.1 : 0)) };
  },
  describe: (v) => `L ${String(v.size).replace(/x/g, "×")} – L ${fmt(num(v.l))} mm`,
  make: (v) => {
    const [a, b, t] = str(v.size, "50x50x5").split("x").map(Number);
    const row = ANGLES.find((x) => x.a === a && x.b === b && x.t === t) ?? ANGLES[8];
    const l = num(v.l, 1000);
    return part(`L ${a}×${b}×${t} L${fmt(l)}`, STEEL, extrudePoly("Úhelník", lProfile(row.a, row.b, row.t, row.r), l, "new"), `L ${a}×${b}×${t} – S235JR – L=${fmt(l)}`, COLOR);
  },
};

export const hollow: Family = {
  id: "hollow",
  name: "Uzavřený profil (jäkl) čtvercový / obdélníkový",
  group: "Ocelové profily a trubky",
  icon: "box",
  standards: ["EN 10219", "EN 10210"],
  keywords: ["jakl", "jekl", "uzavreny profil", "ctvercovy profil", "obdelnikovy profil", "shs", "rhs", "tenkostenny", "profil 40x40"],
  params: [
    { key: "w", label: "Šířka w", kind: "number", min: 10, max: 400, step: 5, unit: "mm", default: 40 },
    { key: "h", label: "Výška h", kind: "number", min: 10, max: 400, step: 5, unit: "mm", default: 40 },
    { key: "t", label: "Tloušťka stěny t", kind: "number", min: 1, max: 16, step: 0.5, unit: "mm", default: 3 },
    lenParam(),
  ],
  sizes: { key: "w", columns: [{ key: "h", label: "h" }, { key: "t", label: "t" }], rows: HOLLOW.map(([w, h, t]) => ({ w, h, t })) },
  parse: (q) => {
    const k = has(q, "jakl", "jekl", "uzavren", "ctvercov", "obdelnik", "shs", "rhs", "tenkosten", "profil");
    const d = dims(q);
    if (!k && d.length < 3) return null;
    if (has(q, "trubk", "chs", "kulat", "ipe", "hea", "heb", "upn", "uhelnik", "ploch") && !has(q, "jakl", "jekl")) return null;
    const values: Record<string, number> = {};
    if (d.length >= 2) {
      values.w = d[0];
      values.h = d.length === 2 ? d[0] : d[1];
      values.t = d.length === 2 ? d[1] : d[2];
    }
    const l = length(q) ?? nums(q).find((x) => x >= 200 && !d.includes(x));
    if (l) values.l = l;
    return { values, score: score(k, (d.length >= 2 ? 0.3 : 0) + (l ? 0.1 : 0)) || (d.length >= 3 ? 0.35 : 0) };
  },
  describe: (v) => `Jäkl ${fmt(num(v.w))}×${fmt(num(v.h))}×${fmt(num(v.t))} – L ${fmt(num(v.l))} mm`,
  make: (v) => {
    const w = num(v.w, 40);
    const h = num(v.h, 40);
    const t = Math.min(num(v.t, 3), Math.min(w, h) / 2 - 0.5);
    const l = num(v.l, 1000);
    return part(`Jäkl ${fmt(w)}×${fmt(h)}×${fmt(t)} L${fmt(l)}`, STEEL, [...extrudePoly("Vnější obrys", hollowOuter(w, h, 2 * t), l, "new"), ...extrudePoly("Dutina", hollowOuter(w - 2 * t, h - 2 * t, t), l + 2, "cut", -1)], `${w === h ? "SHS" : "RHS"} ${fmt(w)}×${fmt(h)}×${fmt(t)} – S235JRH – L=${fmt(l)}`, COLOR);
  },
};

export const chs: Family = {
  id: "chs",
  name: "Trubka kruhová",
  group: "Ocelové profily a trubky",
  icon: "tube",
  standards: ["EN 10220", "EN 10219", "DIN 2448"],
  keywords: ["trubka", "chs", "kruhova trubka", "tube", "pipe", "roura"],
  params: [
    { key: "D", label: "Vnější průměr D", kind: "number", min: 4, max: 1000, step: 0.1, unit: "mm", default: 33.7 },
    { key: "t", label: "Tloušťka stěny t", kind: "number", min: 0.5, max: 40, step: 0.1, unit: "mm", default: 2.6 },
    lenParam(),
  ],
  sizes: { key: "D", columns: [{ key: "t", label: "t" }], rows: CHS.map(([D, t]) => ({ D, t })) },
  parse: (q) => {
    const k = has(q, "trubk", "chs", "tube", "pipe", "rour");
    if (!k) return null;
    const d = dims(q);
    const values: Record<string, number> = {};
    if (d.length >= 2) {
      values.D = d[0];
      values.t = d[1];
    } else if (nums(q)[0]) {
      const row = nearest(CHS.map(([D, t]) => ({ D, t })), "D", nums(q)[0]);
      values.D = row.D;
      values.t = row.t;
    }
    const l = length(q) ?? (d.length >= 3 ? d[2] : nums(q).find((x) => x >= 200 && !d.includes(x)));
    if (l) values.l = l;
    return { values, score: score(k, (values.D ? 0.3 : 0) + (l ? 0.1 : 0)) };
  },
  describe: (v) => `Trubka Ø${fmt(num(v.D))}×${fmt(num(v.t))} – L ${fmt(num(v.l))} mm`,
  make: (v) => {
    const D = num(v.D, 33.7);
    const t = Math.min(num(v.t, 2.6), D / 2 - 0.2);
    const l = num(v.l, 1000);
    return part(`Trubka Ø${fmt(D)}×${fmt(t)} L${fmt(l)}`, STEEL, [tube("Trubka", D, D - 2 * t, l, 0, "new")], `TR Ø${fmt(D)}×${fmt(t)} – S235JRH – L=${fmt(l)}`, COLOR);
  },
};

const bar = (id: string, name: string, kind: "flat" | "round" | "square" | "hex", kw: string[]): Family => ({
  id,
  name,
  group: "Ocelové profily a trubky",
  icon: kind === "round" ? "cylinder" : "box",
  standards: kind === "flat" ? ["EN 10058"] : kind === "round" ? ["EN 10060", "EN 10278 (h9)"] : kind === "square" ? ["EN 10059"] : ["EN 10061", "EN 10278"],
  keywords: [...kw, "tyc", "hutni material", "polotovar"],
  params:
    kind === "flat"
      ? [
          { key: "w", label: "Šířka", kind: "number", min: 10, max: 500, step: 5, unit: "mm", default: 40 },
          { key: "t", label: "Tloušťka", kind: "number", min: 2, max: 100, step: 1, unit: "mm", default: 8 },
          lenParam(),
        ]
      : [{ key: "d", label: kind === "round" ? "Průměr" : kind === "hex" ? "Otvor klíče (SW)" : "Strana", kind: "number", min: 3, max: 400, step: 1, unit: "mm", default: 20 }, lenParam(kind === "round" ? 500 : 1000)],
  parse: (q) => {
    const k = has(q, ...kw);
    if (!k) return null;
    const d = dims(q);
    const n = nums(q);
    const values: Record<string, number> = {};
    if (kind === "flat") {
      if (d.length >= 2) {
        values.w = d[0];
        values.t = d[1];
      }
    } else if (n[0]) values.d = d[0] ?? n[0];
    const l = length(q) ?? (kind === "flat" ? d[2] : d[1]) ?? n.find((x) => x >= 200 && x !== values.d);
    if (l) values.l = l;
    return { values, score: score(k, (Object.keys(values).length ? 0.3 : 0) + (l ? 0.1 : 0)) };
  },
  describe: (v) => (kind === "flat" ? `Plochá ${fmt(num(v.w))}×${fmt(num(v.t))} – L ${fmt(num(v.l))}` : `${name} ${fmt(num(v.d))} – L ${fmt(num(v.l))}`),
  make: (v) => {
    const l = num(v.l, 1000);
    if (kind === "flat") {
      const w = num(v.w, 40);
      const t = num(v.t, 8);
      return part(`Plochá ${fmt(w)}×${fmt(t)} L${fmt(l)}`, STEEL, [{ id: "b", name: "Plochá tyč", type: "box", size: [w, t, l], position: [0, 0, l / 2], centered: true, mode: "new" }], `PLO ${fmt(w)}×${fmt(t)} – S235JR – L=${fmt(l)}`, COLOR);
    }
    const d = num(v.d, 20);
    if (kind === "round") return part(`Kulatina Ø${fmt(d)} L${fmt(l)}`, STEEL, [cyl("Kulatina", d, l, 0, "new")], `KR Ø${fmt(d)} – S235JR / 11 375 – L=${fmt(l)}`, COLOR);
    if (kind === "square") return part(`Čtvercová tyč ${fmt(d)} L${fmt(l)}`, STEEL, [{ id: "b", name: "Čtvercová tyč", type: "box", size: [d, d, l], position: [0, 0, l / 2], centered: true, mode: "new" }], `4HR ${fmt(d)} – S235JR – L=${fmt(l)}`, COLOR);
    return part(`Šestihran SW${fmt(d)} L${fmt(l)}`, STEEL, hexPrism("Šestihranná tyč", d, l, 0, "new"), `6HR ${fmt(d)} – 11 375 – L=${fmt(l)}`, COLOR);
  },
});
export const flatBar = bar("flat", "Plochá tyč", "flat", ["plocha", "plochac", "plocha tyc", "pasovina", "flat bar"]);
export const roundBar = bar("round", "Kulatina", "round", ["kulatina", "kulata tyc", "round bar", "kr "]);
export const squareBar = bar("square", "Čtvercová tyč", "square", ["ctvercova tyc", "ctyrhran", "4hr", "square bar"]);
export const hexBar = bar("hexbar", "Šestihranná tyč", "hex", ["sestihran", "sestihranna tyc", "6hr", "hex bar", "sw"]);

export const PROFILES: Family[] = [ipe, hea, heb, upn, angle, hollow, chs, flatBar, roundBar, squareBar, hexBar];
