/** Hliníkové konstrukční profily s T-drážkou (item / Bosch Rexroth styl), T-matice a úhelníky. */
import type { Vec2 } from "../types";
import { has, length, nums, score } from "./parse-util";
import type { Family, ParamSchema } from "./types";
import { box, chamferAll, cyl, extrudePoly, fmt, num, part, rnd, str } from "./util";

const G = "Hliníkové profily";
const ALU = "hlinik";
const COLOR = "#d6d9dd";

/** Řady profilů: rastr g, drážka s, tloušťka lemu, šířka a hloubka dutiny T-drážky, středová díra (jádro závitu). */
export const TSLOT: Record<string, { g: number; s: number; lip: number; cw: number; cd: number; core: number; thread: string }> = {
  "20": { g: 20, s: 6, lip: 1.5, cw: 11, cd: 4.5, core: 4.2, thread: "M5" },
  "30": { g: 30, s: 8, lip: 2, cw: 16.5, cd: 6, core: 6.8, thread: "M8" },
  "40": { g: 40, s: 8, lip: 2.1, cw: 16.5, cd: 7.5, core: 6.8, thread: "M8" },
  "45": { g: 45, s: 10, lip: 2.5, cw: 20, cd: 9, core: 8.5, thread: "M10" },
  "50": { g: 50, s: 10, lip: 2.5, cw: 20, cd: 9, core: 8.5, thread: "M10" },
};
export const TSLOT_SIZES = ["20x20", "20x40", "30x30", "30x60", "40x40", "40x80", "40x120", "45x45", "45x90", "50x50", "80x80"];
const seriesOf = (size: string) => {
  const w = Number(size.split("x")[0]);
  return TSLOT[String(w === 80 ? 40 : w)] ?? TSLOT["40"];
};

/** Obrys průřezu W×H s T-drážkami uprostřed každé buňky rastru g na všech stranách (uzavřená lomená čára). */
export function tslotOutline(W: number, H: number, p: { g: number; s: number; lip: number; cw: number; cd: number }): Vec2[] {
  const pts: Vec2[] = [];
  const notch = (uc: number, dir: 1 | -1): [number, number][] => {
    const o: [number, number][] = [
      [-p.s / 2, 0],
      [-p.s / 2, p.lip],
      [-p.cw / 2, p.lip],
      [-p.cw / 2, p.lip + p.cd],
      [p.cw / 2, p.lip + p.cd],
      [p.cw / 2, p.lip],
      [p.s / 2, p.lip],
      [p.s / 2, 0],
    ];
    return o.map(([du, v]) => [uc + dir * du, v]);
  };
  const side = (len: number, start: number, dir: 1 | -1, map: (u: number, v: number) => Vec2) => {
    const n = Math.round(len / p.g);
    const centers = Array.from({ length: n }, (_, i) => start + dir * (p.g / 2 + i * p.g));
    pts.push(map(start, 0));
    for (const c of centers) for (const [u, v] of notch(c, dir)) pts.push(map(u, v));
    pts.push(map(start + dir * len, 0));
  };
  side(W, -W / 2, 1, (u, v) => [rnd(u, 4), rnd(H / 2 - v, 4)]); // horní
  side(H, H / 2, -1, (u, v) => [rnd(W / 2 - v, 4), rnd(u, 4)]); // pravá
  side(W, W / 2, -1, (u, v) => [rnd(u, 4), rnd(-H / 2 + v, 4)]); // dolní
  side(H, -H / 2, 1, (u, v) => [rnd(-W / 2 + v, 4), rnd(u, 4)]); // levá
  // odstranit duplicitní rohové body
  return pts.filter((q, i) => i === 0 || Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) > 1e-6);
}

export const tslotProfile: Family = {
  id: "tslot",
  name: "Hliníkový konstrukční profil s T-drážkou",
  group: G,
  icon: "box",
  standards: ["item MB", "Bosch Rexroth", "EN AW-6063 T66"],
  keywords: ["hlinikovy profil", "alu profil", "konstrukcni profil", "t-drazka", "t drazka", "item", "bosch", "rexroth", "strut profile", "t-slot", "extrusion", "drazka"],
  params: [
    { key: "size", label: "Rozměr", kind: "enum", options: TSLOT_SIZES.map((s) => ({ v: s, l: `${s.replace("x", "×")} – drážka ${seriesOf(s).s}` })), default: "40x40" },
    { key: "l", label: "Délka L", kind: "number", min: 10, max: 6000, step: 10, unit: "mm", default: 1000 },
    { key: "core", label: "Středová díra pro závit", kind: "bool", default: true },
  ],
  sizes: { key: "size", columns: [{ key: "s", label: "drážka" }, { key: "thread", label: "závit čela" }], rows: TSLOT_SIZES.map((s) => ({ size: s, s: seriesOf(s).s, thread: seriesOf(s).thread })) },
  parse: (q) => {
    const kw = has(q, "hlinik", "alu", "item", "bosch", "rexroth", "t-draz", "t draz", "drazk", "t-slot", "slot");
    if (!kw || has(q, "matice", "nut", "uhelnik", "bracket")) return null;
    const m = q.match(/(\d{2,3})\s?x\s?(\d{2,3})(?!\s?x\s?\d)/);
    let size: string | undefined;
    if (m) {
      const a = Math.min(Number(m[1]), Number(m[2]));
      const b = Math.max(Number(m[1]), Number(m[2]));
      size = TSLOT_SIZES.find((s) => s === `${a}x${b}`);
    } else {
      const n = nums(q).find((x) => TSLOT[String(x)]);
      if (n) size = `${n}x${n}`;
    }
    const l = length(q) ?? nums(q).find((x) => x >= 100 && (!m || (x !== Number(m[1]) && x !== Number(m[2]))));
    return { values: { ...(size ? { size } : {}), ...(l ? { l } : {}) }, score: score(kw, (size ? 0.3 : 0) + (l ? 0.1 : 0)) };
  },
  describe: (v) => `Profil ${String(v.size).replace("x", "×")} drážka ${seriesOf(str(v.size, "40x40")).s} – L ${fmt(num(v.l))}`,
  make: (v) => {
    const size = str(v.size, "40x40");
    const [W, H] = size.split("x").map(Number);
    const p = seriesOf(size);
    const l = num(v.l, 1000);
    const f = extrudePoly("Profil", tslotOutline(W, H, p), l, "new");
    if (v.core !== false) {
      const nx = Math.round(W / p.g);
      const ny = Math.round(H / p.g);
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) f.push(cyl(`Středová díra ${i + 1}.${j + 1}`, p.core, l + 2, -1, "cut", "Z", [-W / 2 + p.g / 2 + i * p.g, -H / 2 + p.g / 2 + j * p.g]));
    }
    return part(`Profil ${size.replace("x", "×")} L${fmt(l)}`, ALU, f, `Profil ${size.replace("x", "×")} drážka ${p.s} – L ${fmt(l)} mm`, COLOR);
  },
};

const TNUT_SLOTS: Record<string, { threads: string[]; w: number; h: number; neck: number }> = {
  "6": { threads: ["M4", "M5"], w: 10, h: 4.5, neck: 5.8 },
  "8": { threads: ["M4", "M5", "M6", "M8"], w: 16, h: 6, neck: 7.8 },
  "10": { threads: ["M5", "M6", "M8", "M10"], w: 19, h: 8, neck: 9.8 },
};
export const tNut: Family = {
  id: "tnut",
  name: "T-matice do drážky profilu",
  group: G,
  icon: "box",
  standards: ["item", "Bosch Rexroth", "DIN 508 (podobné)"],
  keywords: ["t-matice", "t matice", "matice do drazky", "kamen do drazky", "t-nut", "slot nut", "din 508"],
  params: [
    { key: "slot", label: "Drážka", kind: "enum", options: Object.keys(TNUT_SLOTS).map((k) => ({ v: k, l: `drážka ${k}` })), default: "8" },
    { key: "thread", label: "Závit", kind: "enum", options: ["M4", "M5", "M6", "M8", "M10"].map((m) => ({ v: m, l: m })), default: "M6" },
    { key: "l", label: "Délka", kind: "number", min: 8, max: 60, step: 1, unit: "mm", default: 20 },
  ],
  parse: (q) => {
    const kw = has(q, "t-matice", "t matice", "tmatice", "kamen", "t-nut", "slot nut", "din 508");
    if (!kw) return null;
    const m = (q.match(/m\s?(\d{1,2})/) ?? [])[1];
    const s = (q.match(/draz\w*\s?(\d{1,2})/) ?? [])[1] ?? (q.match(/\b(6|8|10)\b(?!\s?x)/) ?? [])[1];
    return { values: { ...(m ? { thread: `M${m}` } : {}), ...(s && TNUT_SLOTS[s] ? { slot: s } : {}) }, score: score(kw, (m ? 0.2 : 0) + (s ? 0.2 : 0)) };
  },
  describe: (v) => `T-matice drážka ${v.slot} – ${v.thread}`,
  make: (v) => {
    const s = TNUT_SLOTS[str(v.slot, "8")] ?? TNUT_SLOTS["8"];
    const l = num(v.l, 20);
    const td = Number(str(v.thread, "M6").replace("M", "")) || 6;
    return part(`T-matice ${v.slot}/${v.thread}`, "ocel", [box("Tělo", [l, s.w, s.h], [0, 0, s.h / 2], "new"), box("Krk", [l, s.neck, 2], [0, 0, s.h + 1], "add"), cyl("Závitová díra", td * 0.85, s.h + 4, -1, "cut"), chamferAll(0.5)], `T-matice drážka ${v.slot} – ${v.thread} – L${fmt(l)}`, "#5b6670");
  },
};

export const angleBracket: Family = {
  id: "alubracket",
  name: "Úhelník pro hliníkové profily",
  group: G,
  icon: "box",
  standards: ["item", "Bosch Rexroth"],
  keywords: ["uhelnik pro profil", "uhelnik", "spojovaci uhelnik", "angle bracket", "corner bracket", "gusset"],
  params: [
    { key: "size", label: "Řada", kind: "enum", options: ["20", "30", "40", "45", "80"].map((k) => ({ v: k, l: `${k} (drážka ${seriesOf(`${k}x${k}`).s})` })), default: "40" },
    { key: "w", label: "Šířka", kind: "number", min: 15, max: 160, step: 1, unit: "mm", default: 38 },
  ],
  parse: (q) => {
    const kw = has(q, "uhelnik", "bracket", "gusset");
    if (!kw || !has(q, "profil", "alu", "hlinik", "item", "bosch", "drazk", "bracket", "gusset")) return null;
    const n = nums(q).find((x) => ["20", "30", "40", "45", "80"].includes(String(x)));
    return { values: n ? { size: String(n), w: n - 2 } : {}, score: score(kw, n ? 0.3 : 0) };
  },
  describe: (v) => `Úhelník ${v.size}×${v.size} – šířka ${fmt(num(v.w))}`,
  make: (v) => {
    const a = num(v.size, 40);
    const w = num(v.w, a - 2);
    const t = Math.max(3, a * 0.12);
    const hole = seriesOf(`${a}x${a}`).thread === "M5" ? 5.5 : seriesOf(`${a}x${a}`).thread === "M8" ? 9 : 11;
    return part(`Úhelník ${a}×${a}`, ALU, [
      box("Rameno 1", [a, w, t], [a / 2, 0, t / 2], "new"),
      box("Rameno 2", [t, w, a], [t / 2, 0, a / 2], "add"),
      box("Žebro", [a - t, t, a - t], [t + (a - t) / 2, 0, t + (a - t) / 2], "add"),
      { id: "z", name: "Zkosení žebra", type: "box", size: [a, a, a], position: [t + a / 2 + (a - t) / 2 * 0.0 + 0, 0, t + a / 2], centered: true, mode: "cut" },
      cyl("Díra 1", hole, t + 2, -1, "cut", "Z", [a * 0.6, 0]),
      { id: "h2", name: "Díra 2", type: "cylinder", radius: hole / 2, height: t + 2, position: [-1, 0, a * 0.6], axis: "X", mode: "cut" },
    ], `Úhelník ${a}×${a}×${fmt(w)}`, COLOR);
  },
};

export const ALU_PROFILES: Family[] = [tslotProfile, tNut, angleBracket];
