/** Pružiny 2: tažné (s očky), zkrutné, talířové DIN 2093, plynové vzpěry. */
import { uid, type Feature, type Vec2 } from "../types";
import { dims, has, nums, score, tagged } from "./parse-util";
import type { Family } from "./types";
import { chamferAll, cyl, fmt, num, part, revolveProfile, str, tube } from "./util";

const G = "Pružiny a těsnění";

/** Kruhová smyčka (torus) s osou X: skica v rovině XY(z) s kružnicí, rotace kolem osy x skici. */
function loopX(name: string, z: number, Rm: number, wire: number, mode: "add" | "new" = "add"): Feature[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < 16; i++) pts.push([(wire / 2) * Math.cos((2 * Math.PI * i) / 16), Rm + (wire / 2) * Math.sin((2 * Math.PI * i) / 16)]);
  const sk: Feature = { id: uid(), name: `${name} – průřez`, type: "sketch", plane: { kind: "base", name: "XY", offset: z }, entities: [{ id: uid(), type: "polyline", closed: true, points: pts }] };
  return [sk, { id: uid(), name, type: "revolve", sketchId: sk.id, angle: 360, axis: "x", mode }];
}

function parseSpring(q: string, words: string[]) {
  const kw = has(q, ...words);
  if (!kw) return null;
  const values: Record<string, number> = {};
  const ds = [...q.matchAll(/(?:^|[^a-z])de?\s?=?\s?(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const dm = dims(q);
  if (ds.length >= 2) {
    values.d = Math.min(...ds);
    values.D = Math.max(...ds);
  } else if (dm.length >= 2) {
    values.d = dm[0];
    values.D = dm[1];
    if (dm[2]) values.L = dm[2];
  }
  const L = tagged(q, "l0") ?? tagged(q, "l") ?? tagged(q, "lk");
  const n = tagged(q, "n");
  if (L) values.L = L;
  if (n) values.n = n;
  return { values, score: score(kw, Math.min(0.4, Object.keys(values).length * 0.1)) };
}

export const extensionSpring: Family = {
  id: "springExt",
  name: "Tažná šroubová pružina s očky",
  group: G,
  icon: "sweep",
  standards: ["DIN 2097", "EN 13906-2"],
  keywords: ["tazna pruzina", "tazna", "pruzina s ocky", "extension spring", "tension spring", "din 2097"],
  params: [
    { key: "d", label: "Průměr drátu d", kind: "number", min: 0.2, max: 12, step: 0.1, unit: "mm", default: 1.6 },
    { key: "D", label: "Vnější průměr De", kind: "number", min: 1, max: 200, step: 0.5, unit: "mm", default: 12 },
    { key: "L", label: "Délka těla Lk", kind: "number", min: 2, max: 1000, step: 1, unit: "mm", default: 40 },
    { key: "n", label: "Počet závitů n", kind: "number", min: 1, max: 200, step: 1, unit: "", default: 20 },
  ],
  parse: (q) => parseSpring(q, ["tazna", "s ocky", "extension spring", "tension spring", "2097"]),
  describe: (v) => `Tažná pružina ${fmt(num(v.d))}×${fmt(num(v.D))}×${fmt(num(v.L))} – n=${v.n}`,
  make: (v) => {
    const d = num(v.d, 1.6);
    const D = num(v.D, 12);
    const L = num(v.L, 40);
    const n = Math.max(1, num(v.n, 20));
    const Rm = (D - d) / 2;
    const pitch = Math.max(d * 1.02, (L - d) / n);
    return part(`Tažná pružina ${fmt(d)}×${fmt(D)}×${fmt(L)}`, "ocel", [
      { id: uid(), name: "Tělo pružiny", type: "spring", radius: Rm, pitch, turns: n, wire: d, position: [0, 0, d / 2], axis: "Z", mode: "new" },
      ...loopX("Očko 1", -Rm + d, Rm, d),
      ...loopX("Očko 2", L + Rm - d, Rm, d),
    ], `DIN 2097 – ${fmt(d)}×${fmt(D)}×${fmt(L)} – n ${n}`, "#5b6670");
  },
};

export const torsionSpring: Family = {
  id: "springTorsion",
  name: "Zkrutná šroubová pružina",
  group: G,
  icon: "sweep",
  standards: ["DIN 2088", "EN 13906-3"],
  keywords: ["zkrutna pruzina", "zkrutna", "torzni pruzina", "torsion spring", "din 2088"],
  params: [
    { key: "d", label: "Průměr drátu d", kind: "number", min: 0.2, max: 12, step: 0.1, unit: "mm", default: 2 },
    { key: "D", label: "Vnější průměr De", kind: "number", min: 2, max: 200, step: 0.5, unit: "mm", default: 16 },
    { key: "n", label: "Počet závitů n", kind: "number", min: 1, max: 60, step: 0.5, unit: "", default: 5 },
    { key: "leg", label: "Délka ramen", kind: "number", min: 2, max: 300, step: 1, unit: "mm", default: 30 },
    { key: "angle", label: "Úhel ramen", kind: "number", min: 0, max: 180, step: 15, unit: "°", default: 90 },
  ],
  parse: (q) => {
    const hit = parseSpring(q, ["zkrutn", "torzn", "torsion", "2088"]);
    if (!hit) return null;
    const leg = tagged(q, "r") ?? tagged(q, "rameno");
    return { ...hit, values: { ...hit.values, ...(leg ? { leg } : {}) } };
  },
  describe: (v) => `Zkrutná pružina ${fmt(num(v.d))}×${fmt(num(v.D))} – n=${v.n} – ramena ${fmt(num(v.leg))}`,
  make: (v) => {
    const d = num(v.d, 2);
    const D = num(v.D, 16);
    const n = Math.max(1, num(v.n, 5));
    const leg = num(v.leg, 30);
    const a = (num(v.angle, 90) * Math.PI) / 180;
    const Rm = (D - d) / 2;
    const pitch = d * 1.05;
    const L = pitch * n;
    return part(`Zkrutná pružina ${fmt(d)}×${fmt(D)} n${n}`, "ocel", [
      { id: uid(), name: "Závity", type: "spring", radius: Rm, pitch, turns: n, wire: d, position: [0, 0, d / 2], axis: "Z", mode: "new" },
      { id: uid(), name: "Rameno 1", type: "cylinder", radius: d / 2, height: leg, position: [Rm, 0, d / 2], axis: "Y", mode: "add" },
      // druhé rameno: tangenta na konci vinutí (úhel n·360 + angle)
      { id: uid(), name: "Rameno 2", type: "cylinder", radius: d / 2, height: leg, position: [Rm * Math.cos(a), Rm * Math.sin(a), L - d / 2], axis: "Y", mode: "add" },
    ], `DIN 2088 – ${fmt(d)}×${fmt(D)} – n ${n}`, "#5b6670");
  },
};

/** DIN 2093 – talířové pružiny, řada A (De, Di, t, h0) a B. */
export const DISC: { s: "A" | "B"; De: number; Di: number; t: number; h0: number }[] = [
  { s: "A", De: 8, Di: 4.2, t: 0.4, h0: 0.2 },
  { s: "A", De: 10, Di: 5.2, t: 0.5, h0: 0.25 },
  { s: "A", De: 12.5, Di: 6.2, t: 0.7, h0: 0.3 },
  { s: "A", De: 16, Di: 8.2, t: 0.9, h0: 0.35 },
  { s: "A", De: 20, Di: 10.2, t: 1.1, h0: 0.45 },
  { s: "A", De: 25, Di: 12.2, t: 1.5, h0: 0.55 },
  { s: "A", De: 31.5, Di: 16.3, t: 1.75, h0: 0.7 },
  { s: "A", De: 40, Di: 20.4, t: 2.25, h0: 0.9 },
  { s: "A", De: 50, Di: 25.4, t: 3, h0: 1.1 },
  { s: "A", De: 63, Di: 31, t: 3.5, h0: 1.4 },
  { s: "A", De: 80, Di: 41, t: 5, h0: 1.7 },
  { s: "A", De: 100, Di: 51, t: 6, h0: 2.2 },
  { s: "B", De: 20, Di: 10.2, t: 0.8, h0: 0.6 },
  { s: "B", De: 25, Di: 12.2, t: 0.9, h0: 0.7 },
  { s: "B", De: 31.5, Di: 16.3, t: 1.25, h0: 0.9 },
  { s: "B", De: 40, Di: 20.4, t: 1.5, h0: 1.15 },
  { s: "B", De: 50, Di: 25.4, t: 2, h0: 1.4 },
  { s: "B", De: 63, Di: 31, t: 2.5, h0: 1.75 },
];
const discKey = (x: (typeof DISC)[number]) => `${x.s}-${x.De}x${x.Di}x${x.t}`;
export const discSpring: Family = {
  id: "din2093",
  name: "Talířová pružina",
  group: G,
  icon: "cone",
  standards: ["DIN 2093", "EN 16983"],
  keywords: ["talirova pružina", "talirova", "talir", "disc spring", "belleville", "din 2093"],
  params: [
    { key: "size", label: "Řada – De×Di×t", kind: "enum", options: DISC.map((x) => ({ v: discKey(x), l: `${x.s}  ${x.De}×${x.Di}×${x.t} (h0 ${x.h0})` })), default: "A-20x10.2x1.1" },
    { key: "count", label: "Počet v sloupci", kind: "number", min: 1, max: 20, step: 1, unit: "", default: 1 },
    { key: "stack", label: "Řazení", kind: "enum", options: [{ v: "series", l: "za sebou (střídavě)" }, { v: "parallel", l: "vedle sebe (do sebe)" }], default: "series" },
  ],
  sizes: { key: "size", columns: [{ key: "De", label: "De" }, { key: "Di", label: "Di" }, { key: "t", label: "t" }, { key: "h0", label: "h0" }], rows: DISC.map((x) => ({ size: discKey(x), ...x })) },
  parse: (q) => {
    const kw = has(q, "talir", "disc spring", "belleville", "2093");
    if (!kw) return null;
    const dm = dims(q);
    let hit: (typeof DISC)[number] | undefined;
    if (dm.length >= 1) {
      const cands = DISC.filter((x) => Math.abs(x.De - dm[0]) < 0.01 && (dm.length < 2 || Math.abs(x.Di - dm[1]) < 0.3));
      hit = cands.find((x) => dm.length < 3 || Math.abs(x.t - dm[2]) < 0.15) ?? cands[0];
    }
    const count = (q.match(/(\d+)\s?(?:ks|x\s?$|kus)/) ?? [])[1];
    return { values: { ...(hit ? { size: discKey(hit) } : {}), ...(count ? { count: Number(count) } : {}) }, score: score(kw, hit ? 0.4 : 0) };
  },
  describe: (v) => `DIN 2093 – ${String(v.size).replace(/^.-/, "").replace(/x/g, "×")}${num(v.count) > 1 ? ` ×${v.count}` : ""}`,
  make: (v) => {
    const x = DISC.find((d) => discKey(d) === str(v.size)) ?? DISC[4];
    const n = Math.max(1, Math.round(num(v.count, 1)));
    const parallel = str(v.stack) === "parallel";
    const f: Feature[] = [];
    let z = 0;
    for (let i = 0; i < n; i++) {
      const up = parallel || i % 2 === 0;
      const prof: Vec2[] = up ? [[x.Di / 2, z + x.h0], [x.De / 2, z], [x.De / 2, z + x.t], [x.Di / 2, z + x.h0 + x.t]] : [[x.Di / 2, z], [x.De / 2, z + x.h0], [x.De / 2, z + x.h0 + x.t], [x.Di / 2, z + x.t]];
      f.push(...revolveProfile(`Talíř ${i + 1}`, prof, i === 0 ? "new" : "add"));
      z += parallel ? x.t : x.t + x.h0;
    }
    return part(`Talířová pružina ${x.De}×${x.Di}×${x.t}`, "ocel", f, `DIN 2093 – ${x.s} ${x.De}×${x.Di}×${x.t}${n > 1 ? ` – ${n}× ${parallel ? "vedle sebe" : "za sebou"}` : ""}`, "#5b6670");
  },
};

const GAS: Record<string, { rod: number; cyl: number }> = { "6/15": { rod: 6, cyl: 15 }, "8/19": { rod: 8, cyl: 19 }, "10/22": { rod: 10, cyl: 22 }, "14/28": { rod: 14, cyl: 28 }, "20/40": { rod: 20, cyl: 40 } };
export const gasStrut: Family = {
  id: "gasstrut",
  name: "Plynová vzpěra",
  group: G,
  icon: "cylinder",
  standards: ["Stabilus / Suspa (rozměrová řada)"],
  keywords: ["plynova vzpera", "plynova", "vzpera", "gas spring", "gas strut", "stabilus"],
  params: [
    { key: "size", label: "Pístnice/válec", kind: "enum", options: Object.keys(GAS).map((k) => ({ v: k, l: `Ø${k.replace("/", " / Ø")}` })), default: "8/19" },
    { key: "stroke", label: "Zdvih", kind: "number", min: 20, max: 600, step: 5, unit: "mm", default: 100 },
    { key: "force", label: "Síla", kind: "number", min: 50, max: 5000, step: 10, unit: "N", default: 300 },
    { key: "extended", label: "Vysunutá", kind: "bool", default: true },
  ],
  parse: (q) => {
    const kw = has(q, "plynov", "vzper", "gas spring", "gas strut", "stabilus");
    if (!kw) return null;
    const m = q.match(/(\d{1,2})\s?\/\s?(\d{2})/);
    const size = m ? Object.keys(GAS).find((k) => k === `${m[1]}/${m[2]}`) : undefined;
    const stroke = tagged(q, "zdvih") ?? nums(q).find((x) => x >= 20 && x <= 600 && (!m || (x !== Number(m[1]) && x !== Number(m[2]))));
    const force = (q.match(/(\d{2,4})\s?n\b/) ?? [])[1];
    return { values: { ...(size ? { size } : {}), ...(stroke ? { stroke } : {}), ...(force ? { force: Number(force) } : {}) }, score: score(kw, (size ? 0.2 : 0) + (stroke ? 0.1 : 0) + (force ? 0.1 : 0)) };
  },
  describe: (v) => `Plynová vzpěra Ø${String(v.size).replace("/", "/Ø")} – zdvih ${fmt(num(v.stroke))} – ${v.force} N`,
  make: (v) => {
    const g = GAS[str(v.size, "8/19")] ?? GAS["8/19"];
    const stroke = num(v.stroke, 100);
    const ext = v.extended !== false ? stroke : 0;
    const body = stroke + 30;
    const eye = g.cyl * 0.9;
    return part(`Plynová vzpěra ${v.size} z${fmt(stroke)}`, "ocel", [
      cyl("Válec", g.cyl, body, 0, "new"),
      cyl("Pístnice", g.rod, 15 + ext, body, "add"),
      { id: uid(), name: "Oko 1", type: "tube", outer: eye, inner: eye * 0.4, height: g.rod, position: [0, -g.rod / 2, -eye / 2 + 1], axis: "Y", mode: "add" },
      { id: uid(), name: "Oko 2", type: "tube", outer: eye, inner: eye * 0.4, height: g.rod, position: [0, -g.rod / 2, body + 15 + ext + eye / 2 - 1], axis: "Y", mode: "add" },
      chamferAll(0.5),
    ], `Plynová vzpěra ${v.size} – zdvih ${fmt(stroke)} – ${v.force} N`, "#3a3f45");
  },
};

export const SPRINGS2: Family[] = [extensionSpring, torsionSpring, discSpring, gasStrut];
export const _tube = tube;
