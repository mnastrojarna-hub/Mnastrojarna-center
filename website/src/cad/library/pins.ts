/** Kolíky, pera, pojistné kroužky, O-kroužky, pružiny. */
import { uid, type Feature, type Vec2 } from "../types";
import { dims, has, length, nums, score, tagged } from "./parse-util";
import { KEYS, ORING_CS, RINGS, SPRING_PIN, keyByWidth } from "./tables";
import type { Family, ParamSchema } from "./types";
import { box, chamferAll, cyl, fmt, nearest, num, part, revolveProfile, sketch, str, tube, XY } from "./util";

const dParam = (def: number, label = "Průměr d"): ParamSchema => ({ key: "d", label, kind: "number", min: 1, max: 100, step: 1, unit: "mm", default: def });
const lParam = (def: number): ParamSchema => ({ key: "l", label: "Délka l", kind: "number", min: 2, max: 1000, step: 2, unit: "mm", default: def });

function parsePin(q: string, words: string[]) {
  const kw = has(q, ...words);
  if (!kw) return null;
  const dm = dims(q);
  const n = nums(q);
  const d = dm[0] ?? tagged(q, "d") ?? n[0];
  const l = dm[1] ?? length(q) ?? n[1];
  const values: Record<string, number> = {};
  if (d) values.d = d;
  if (l) values.l = l;
  return { values, score: score(kw, (d ? 0.2 : 0) + (l ? 0.2 : 0)) };
}

const dowel = (id: string, std: string, name: string, extraKw: string[], round: boolean): Family => ({
  id,
  name,
  group: "Kolíky a pera",
  icon: "cylinder",
  standards: [std],
  keywords: ["kolik", "valcovy kolik", "dowel", "pin", ...extraKw],
  params: [dParam(6), lParam(30)],
  parse: (q) => {
    if (has(q, "pruzn", "spring pin", "8752", "zavlac", "roll pin")) return null;
    const hit = parsePin(q, ["kolik", "dowel", "pin", ...extraKw]);
    return hit && { ...hit, score: hit.score * (has(q, ...extraKw) ? 1 : id === "iso8734" ? 0.95 : 0.8) };
  },
  describe: (v) => `${std} – ${fmt(num(v.d))}×${fmt(num(v.l))}${id === "iso8734" ? " – m6" : id === "iso2338" ? " – h8" : ""}`,
  make: (v) => {
    const d = num(v.d, 6);
    const l = num(v.l, 30);
    return part(`Kolík Ø${fmt(d)}×${fmt(l)} ${std}`, id === "din6325" ? "1.7131" : "ocel", [cyl("Kolík", d, l, 0, "new"), chamferAll(round ? d * 0.15 : Math.min(0.6, d * 0.1))], `${std} – ${fmt(d)}×${fmt(l)}`, "#aeb6bf");
  },
});
export const dowelIso8734 = dowel("iso8734", "ISO 8734", "Válcový kolík kalený (m6)", ["8734", "kaleny", "6325"], false);
export const dowelIso2338 = dowel("iso2338", "ISO 2338", "Válcový kolík nekalený (h8)", ["2338", "nekaleny", "din 7"], true);

export const springPin: Family = {
  id: "iso8752",
  name: "Pružný kolík (válcový, štěrbinový)",
  group: "Kolíky a pera",
  icon: "tube",
  standards: ["ISO 8752", "DIN 1481"],
  keywords: ["pruzny kolik", "sterbinovy", "spring pin", "roll pin", "iso 8752", "din 1481"],
  params: [{ key: "d", label: "Průměr d", kind: "enum", options: Object.keys(SPRING_PIN).map((k) => ({ v: k, l: `Ø${k}` })), default: "6" }, lParam(30)],
  parse: (q) => {
    const hit = parsePin(q, ["pruzn", "sterbin", "spring pin", "roll pin", "8752", "1481"]);
    if (!hit) return null;
    const d = hit.values.d ? String(nearest(Object.keys(SPRING_PIN).map((k) => ({ d: Number(k) })), "d", hit.values.d).d) : undefined;
    return { values: { ...(d ? { d } : {}), ...(hit.values.l ? { l: hit.values.l } : {}) }, score: hit.score };
  },
  describe: (v) => `ISO 8752 – ${v.d}×${fmt(num(v.l))}`,
  make: (v) => {
    const d = num(v.d, 6);
    const l = num(v.l, 30);
    const s = SPRING_PIN[d] ?? d * 0.2;
    const gap = Math.max(0.5, d * 0.25);
    return part(`Pružný kolík Ø${fmt(d)}×${fmt(l)}`, "ocel", [tube("Kolík", d, d - 2 * s, l, 0, "new"), box("Štěrbina", [gap, d, l + 2], [0, d / 2, l / 2], "cut"), chamferAll(Math.min(s * 0.5, 0.4))], `ISO 8752 – ${fmt(d)}×${fmt(l)}`, "#5b6670");
  },
};

export const key6885: Family = {
  id: "din6885",
  name: "Těsné pero",
  group: "Kolíky a pera",
  icon: "box",
  standards: ["DIN 6885", "ČSN 02 2562"],
  keywords: ["pero", "tesne pero", "klin", "key", "feather key", "din 6885", "6885"],
  params: [
    { key: "form", label: "Tvar", kind: "enum", options: [{ v: "A", l: "A – zaoblené konce" }, { v: "B", l: "B – rovné konce" }, { v: "C", l: "C – jeden konec zaoblený" }], default: "A" },
    { key: "b", label: "Šířka b", kind: "enum", options: KEYS.map((k) => ({ v: String(k.b), l: `${k.b}×${k.h} (hřídel ${k.from}–${k.to})` })), default: "8" },
    { key: "l", label: "Délka l", kind: "number", min: 6, max: 400, step: 2, unit: "mm", default: 40 },
  ],
  sizes: { key: "b", columns: [{ key: "h", label: "h" }, { key: "t1", label: "t1 hřídel" }, { key: "t2", label: "t2 náboj" }, { key: "shaft", label: "hřídel d" }], rows: KEYS.map((k) => ({ b: String(k.b), h: k.h, t1: k.t1, t2: k.t2, shaft: `${k.from}–${k.to}` })) },
  parse: (q) => {
    const kw = has(q, "pero", "tesne", "key", "6885", "klin");
    if (!kw || has(q, "pruzin", "kolik")) return null;
    const dm = dims(q);
    const values: Record<string, string | number> = {};
    if (dm.length >= 2 && keyByWidth(dm[0])) {
      values.b = String(dm[0]);
      if (dm[2]) values.l = dm[2];
      else if (dm[1] > 12) values.l = dm[1];
    } else if (dm[0] && keyByWidth(dm[0])) values.b = String(dm[0]);
    const l = length(q);
    if (l) values.l = l;
    if (has(q, "tvar b", "form b", "rovn")) values.form = "B";
    return { values, score: score(kw, (values.b ? 0.25 : 0) + (values.l ? 0.15 : 0)) };
  },
  describe: (v) => `DIN 6885 – ${v.form} ${v.b}×${keyByWidth(num(v.b))?.h ?? ""}×${fmt(num(v.l))}`,
  make: (v) => {
    const k = keyByWidth(num(v.b)) ?? KEYS[5];
    const l = num(v.l, 40);
    const form = str(v.form, "A");
    const f: Feature[] = [];
    if (form === "B") f.push(box("Pero", [l, k.b, k.h], [0, 0, k.h / 2], "new"));
    else {
      const sk = sketch("Pero – profil", XY(0), form === "A" ? [{ id: uid(), type: "slot", cx: 0, cy: 0, length: l, width: k.b, angle: 0 }] : [{ id: uid(), type: "polyline", closed: true, points: cForm(l, k.b) }]);
      f.push(sk, { id: uid(), name: "Pero", type: "extrude", sketchId: sk.id, distance: k.h, symmetric: false, reverse: false, mode: "new" });
    }
    f.push(chamferAll(Math.min(0.4, k.h * 0.06)));
    return part(`Pero ${form} ${k.b}×${k.h}×${fmt(l)}`, "ocel", f, `DIN 6885 – ${form} ${k.b}×${k.h}×${fmt(l)}`, "#aeb6bf");
  },
};
/** Tvar C: jeden konec zaoblený (půlkruh z úseček). */
function cForm(l: number, b: number): Vec2[] {
  const pts: Vec2[] = [[-l / 2, -b / 2], [l / 2 - b / 2, -b / 2]];
  for (let i = 1; i < 12; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 12;
    pts.push([l / 2 - b / 2 + (b / 2) * Math.cos(a), (b / 2) * Math.sin(a)]);
  }
  pts.push([l / 2 - b / 2, b / 2], [-l / 2, b / 2]);
  return pts;
}

const ring = (id: string, std: string, external: boolean): Family => ({
  id,
  name: external ? "Pojistný kroužek pro hřídel" : "Pojistný kroužek pro díru",
  group: "Pojistné kroužky",
  icon: "tube",
  standards: [std, external ? "ČSN 02 2930" : "ČSN 02 2931"],
  keywords: ["pojistny krouzek", "segrovka", "seeger", "circlip", "retaining ring", std.toLowerCase(), external ? "hridel" : "dira"],
  params: [{ key: "d", label: external ? "Průměr hřídele d" : "Průměr díry D", kind: "enum", options: RINGS.map((r) => ({ v: String(r.d), l: `${r.d}` })), default: "25" }],
  sizes: { key: "d", columns: [{ key: "s", label: "s" }, { key: "b", label: "b" }, { key: "g", label: external ? "d2 drážka" : "D2 drážka" }], rows: RINGS.map((r) => ({ d: String(r.d), s: r.s, b: r.b, g: external ? r.d2 : r.D2 })) },
  parse: (q) => {
    const kw = has(q, "pojistn", "segrov", "seeger", "circlip", "retaining", std.toLowerCase().replace("din ", ""));
    if (!kw) return null;
    const wantInt = !!has(q, "dir", "vnitrn", "bore", "472", "internal");
    if (wantInt === external) return { values: {}, score: 0.3 };
    const n = nums(q).find((x) => x >= 8 && x <= 100);
    return { values: n ? { d: String(nearest(RINGS, "d", n).d) } : {}, score: score(kw, n ? 0.3 : 0) };
  },
  describe: (v) => `${std} – ${v.d}×${RINGS.find((r) => String(r.d) === String(v.d))?.s ?? ""}`,
  make: (v) => {
    const r = RINGS.find((x) => String(x.d) === String(v.d)) ?? RINGS[6];
    const inner = external ? r.d2 : r.D2 - 2 * r.b;
    const outer = external ? r.d2 + 2 * r.b : r.D2;
    const gap = outer * 0.22;
    const earD = r.b * 1.5;
    const earR = external ? inner / 2 - earD / 2 + 0.2 : outer / 2 + earD / 2 - 0.2;
    const f: Feature[] = [
      tube("Kroužek", outer, inner, r.s, 0, "new"),
      box("Rozevření", [gap, outer, r.s + 2], [0, external ? -outer / 2 + 1 : -outer / 2 + 1, r.s / 2], "cut"),
    ];
    for (const sgn of [-1, 1]) {
      const x = sgn * (gap / 2 + earD / 2);
      const y = -Math.sqrt(Math.max(0, earR * earR - x * x));
      f.push(cyl("Ouško", earD, r.s, 0, "add", "Z", [x, y]), cyl("Otvor ouška", earD * 0.4, r.s + 2, -1, "cut", "Z", [x, y]));
    }
    return part(`Pojistný kroužek ${r.d} ${std}`, "ocel", f, `${std} – ${r.d}×${r.s}`, "#3a3f45");
  },
});
export const ringDin471 = ring("din471", "DIN 471", true);
export const ringDin472 = ring("din472", "DIN 472", false);

export const oRing: Family = {
  id: "oring",
  name: "O-kroužek",
  group: "Pružiny a těsnění",
  icon: "tube",
  standards: ["ISO 3601", "DIN 3771"],
  keywords: ["o-krouzek", "okrouzek", "o krouzek", "oring", "o-ring", "tesneni", "iso 3601"],
  params: [
    { key: "d1", label: "Vnitřní průměr d1", kind: "number", min: 1, max: 500, step: 0.5, unit: "mm", default: 20 },
    { key: "d2", label: "Průřez d2", kind: "enum", options: ORING_CS.map((c) => ({ v: String(c), l: String(c) })), default: "3" },
    { key: "mat", label: "Materiál", kind: "enum", options: ["NBR 70", "FKM (Viton) 75", "EPDM 70", "silikon 60"].map((m) => ({ v: m, l: m })), default: "NBR 70" },
  ],
  parse: (q) => {
    const kw = has(q, "o-krouzek", "okrouzek", "o krouzek", "oring", "o-ring", "tesnici krouzek");
    if (!kw) return null;
    const dm = dims(q);
    const values: Record<string, string | number> = {};
    if (dm[0]) values.d1 = dm[0];
    if (dm[1]) values.d2 = String(nearest(ORING_CS.map((c) => ({ c })), "c", dm[1]).c);
    return { values, score: score(kw, (dm[0] ? 0.2 : 0) + (dm[1] ? 0.2 : 0)) };
  },
  describe: (v) => `O-kroužek ${fmt(num(v.d1))}×${v.d2} ${v.mat}`,
  make: (v) => {
    const d1 = num(v.d1, 20);
    const d2 = num(v.d2, 3);
    const sk = sketch("Průřez", { kind: "base", name: "XZ", offset: 0 }, [{ id: uid(), type: "circle", cx: d1 / 2 + d2 / 2, cy: 0, r: d2 / 2 }]);
    return part(`O-kroužek ${fmt(d1)}×${fmt(d2)}`, "pom", [sk, { id: uid(), name: "O-kroužek", type: "revolve", sketchId: sk.id, angle: 360, axis: "y", mode: "new" }], `ISO 3601 – ${fmt(d1)}×${fmt(d2)} – ${v.mat}`, "#222222");
  },
};

export const compressionSpring: Family = {
  id: "spring",
  name: "Tlačná šroubová pružina",
  group: "Pružiny a těsnění",
  icon: "sweep",
  standards: ["DIN 2095", "EN 13906-1"],
  keywords: ["pruzina", "tlacna pruzina", "spring", "compression spring", "din 2095"],
  params: [
    { key: "d", label: "Průměr drátu d", kind: "number", min: 0.2, max: 20, step: 0.1, unit: "mm", default: 1.6 },
    { key: "D", label: "Vnější průměr De", kind: "number", min: 1, max: 300, step: 0.5, unit: "mm", default: 12 },
    { key: "L", label: "Volná délka L0", kind: "number", min: 2, max: 1000, step: 1, unit: "mm", default: 40 },
    { key: "n", label: "Počet činných závitů n", kind: "number", min: 1, max: 60, step: 0.5, unit: "", default: 8 },
  ],
  parse: (q) => {
    const kw = has(q, "pruzin", "spring", "2095");
    if (!kw || has(q, "podloz", "kolik", "pin")) return null;
    const values: Record<string, number> = {};
    // „d1.6 D12“ – po normalizaci jsou obě malá: menší = drát, větší = vnější průměr
    const ds = [...q.matchAll(/(?:^|[^a-z])de?\s?=?\s?(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    const dm = dims(q);
    if (ds.length >= 2) {
      values.d = Math.min(...ds);
      values.D = Math.max(...ds);
    } else if (ds.length === 1) {
      if (ds[0] < 4) values.d = ds[0];
      else values.D = ds[0];
    } else if (dm.length >= 2) {
      values.d = dm[0];
      values.D = dm[1];
      if (dm[2]) values.L = dm[2];
    }
    const L = tagged(q, "l0") ?? tagged(q, "l");
    const n = tagged(q, "n");
    if (L) values.L = L;
    if (n) values.n = n;
    return { values, score: score(kw, Math.min(0.4, Object.keys(values).length * 0.1)) };
  },
  describe: (v) => `Pružina ${fmt(num(v.d))}×${fmt(num(v.D))}×${fmt(num(v.L))} – n=${v.n}`,
  make: (v) => {
    const d = num(v.d, 1.6);
    const D = num(v.D, 12);
    const L = num(v.L, 40);
    const n = Math.max(1, num(v.n, 8));
    const pitch = Math.max(d * 1.05, (L - d) / n);
    return part(`Pružina ${fmt(d)}×${fmt(D)}×${fmt(L)}`, "ocel", [{ id: uid(), name: "Pružina", type: "spring", radius: (D - d) / 2, pitch, turns: n, wire: d, position: [0, 0, 0], axis: "Z", mode: "new" }], `DIN 2095 – ${fmt(d)}×${fmt(D)}×${fmt(L)} – n ${n}`, "#5b6670");
  },
};

export const PINS: Family[] = [dowelIso8734, dowelIso2338, springPin, key6885, ringDin471, ringDin472, oRing, compressionSpring];
