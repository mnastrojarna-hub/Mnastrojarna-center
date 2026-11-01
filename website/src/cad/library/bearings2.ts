/** Ložiska 2: kuželíková, axiální, jehlová, ložisková tělesa UCP a kluzná pouzdra. */
import { uid, type Feature, type Vec2 } from "../types";
import { has, nums, score } from "./parse-util";
import type { Family } from "./types";
import { box, chamferAll, cyl, fmt, nearest, num, part, revolveProfile, str, tube } from "./util";

/** ISO 355 / DIN 720 – kuželíková ložiska: d, D, T (celková šířka), B (vnitřní kroužek), C (vnější kroužek). */
export const TAPERED: Record<string, { d: number; D: number; T: number; B: number; C: number }> = {
  30203: { d: 17, D: 40, T: 13.25, B: 12, C: 11 },
  30204: { d: 20, D: 47, T: 15.25, B: 14, C: 12 },
  30205: { d: 25, D: 52, T: 16.25, B: 15, C: 13 },
  30206: { d: 30, D: 62, T: 17.25, B: 16, C: 14 },
  30207: { d: 35, D: 72, T: 18.25, B: 17, C: 15 },
  30208: { d: 40, D: 80, T: 19.75, B: 18, C: 16 },
  30209: { d: 45, D: 85, T: 20.75, B: 19, C: 16 },
  30210: { d: 50, D: 90, T: 21.75, B: 20, C: 17 },
  30211: { d: 55, D: 100, T: 22.75, B: 21, C: 18 },
  30212: { d: 60, D: 110, T: 23.75, B: 22, C: 19 },
  32205: { d: 25, D: 52, T: 22, B: 22, C: 18 },
  32206: { d: 30, D: 62, T: 21.25, B: 20, C: 17 },
  32207: { d: 35, D: 72, T: 24.25, B: 23, C: 19 },
  32208: { d: 40, D: 80, T: 24.75, B: 23, C: 19 },
  32210: { d: 50, D: 90, T: 24.75, B: 23, C: 19 },
};

/** ISO 104 – axiální kuličková ložiska 511xx/512xx: d, D, H. */
export const THRUST: Record<string, { d: number; D: number; H: number }> = {
  51100: { d: 10, D: 24, H: 9 },
  51102: { d: 15, D: 28, H: 9 },
  51104: { d: 20, D: 35, H: 10 },
  51105: { d: 25, D: 42, H: 11 },
  51106: { d: 30, D: 47, H: 11 },
  51107: { d: 35, D: 52, H: 12 },
  51108: { d: 40, D: 60, H: 13 },
  51109: { d: 45, D: 65, H: 14 },
  51110: { d: 50, D: 70, H: 14 },
  51111: { d: 55, D: 78, H: 16 },
  51112: { d: 60, D: 85, H: 17 },
  51204: { d: 20, D: 40, H: 14 },
  51205: { d: 25, D: 47, H: 15 },
  51206: { d: 30, D: 52, H: 16 },
  51208: { d: 40, D: 68, H: 19 },
  51210: { d: 50, D: 78, H: 22 },
};

/** ISO 3245 – jehlová ložiska s tenkým pouzdrem HK: Fw (hřídel), D, C (šířka). */
export const NEEDLE: Record<string, { Fw: number; D: number; C: number }> = {
  HK0608: { Fw: 6, D: 10, C: 8 },
  HK0810: { Fw: 8, D: 12, C: 10 },
  HK1010: { Fw: 10, D: 14, C: 10 },
  HK1012: { Fw: 10, D: 14, C: 12 },
  HK1210: { Fw: 12, D: 16, C: 10 },
  HK1212: { Fw: 12, D: 16, C: 12 },
  HK1312: { Fw: 13, D: 17, C: 12 },
  HK1412: { Fw: 14, D: 20, C: 12 },
  HK1512: { Fw: 15, D: 21, C: 12 },
  HK1612: { Fw: 16, D: 22, C: 12 },
  HK1712: { Fw: 17, D: 23, C: 12 },
  HK2012: { Fw: 20, D: 26, C: 12 },
  HK2016: { Fw: 20, D: 26, C: 16 },
  HK2516: { Fw: 25, D: 32, C: 16 },
  HK3016: { Fw: 30, D: 37, C: 16 },
  HK3516: { Fw: 35, D: 42, C: 16 },
  HK4016: { Fw: 40, D: 47, C: 16 },
};

/** Ložisková tělesa stojatá UCP (JIS B 1559): d, a (délka), e (rozteč šroubů), b (šířka patky), h (výška osy), s (díra), D/B vložky. */
export const UCP: Record<string, { d: number; a: number; e: number; b: number; h: number; s: number; D: number; B: number; g: number }> = {
  UCP204: { d: 20, a: 127, e: 95, b: 38, h: 33.3, s: 13, D: 47, B: 31, g: 65 },
  UCP205: { d: 25, a: 140, e: 105, b: 38, h: 36.5, s: 13, D: 52, B: 34.1, g: 71 },
  UCP206: { d: 30, a: 165, e: 121, b: 48, h: 42.9, s: 17, D: 62, B: 38.1, g: 83 },
  UCP207: { d: 35, a: 167, e: 127, b: 48, h: 47.6, s: 17, D: 72, B: 42.9, g: 93 },
  UCP208: { d: 40, a: 184, e: 137, b: 54, h: 49.2, s: 17, D: 80, B: 49.2, g: 100 },
  UCP209: { d: 45, a: 190, e: 146, b: 54, h: 54, s: 17, D: 85, B: 49.2, g: 106 },
  UCP210: { d: 50, a: 206, e: 159, b: 60, h: 57.2, s: 20, D: 90, B: 51.6, g: 113 },
};

/** ISO 4379 – kluzná pouzdra (bronz): d → D, délky. */
export const BUSHINGS: Record<number, { D: number; l: number; Dc: number }> = {
  8: { D: 12, l: 10, Dc: 15 },
  10: { D: 14, l: 10, Dc: 18 },
  12: { D: 16, l: 12, Dc: 20 },
  14: { D: 18, l: 14, Dc: 22 },
  15: { D: 19, l: 15, Dc: 23 },
  16: { D: 20, l: 16, Dc: 24 },
  18: { D: 22, l: 18, Dc: 26 },
  20: { D: 25, l: 20, Dc: 30 },
  22: { D: 28, l: 22, Dc: 32 },
  25: { D: 30, l: 25, Dc: 35 },
  28: { D: 34, l: 28, Dc: 40 },
  30: { D: 36, l: 30, Dc: 42 },
  35: { D: 41, l: 35, Dc: 47 },
  40: { D: 46, l: 40, Dc: 52 },
  45: { D: 51, l: 45, Dc: 58 },
  50: { D: 56, l: 50, Dc: 64 },
};

const enumOf = (keys: string[], label: (k: string) => string) => keys.map((k) => ({ v: k, l: label(k) }));

export const taperedBearing: Family = {
  id: "bearingTapered",
  name: "Kuželíkové ložisko jednořadé",
  group: "Ložiska",
  icon: "cone",
  standards: ["ISO 355", "DIN 720", "ČSN 02 4720"],
  keywords: ["kuzelikove lozisko", "kuzelik", "tapered roller bearing", "taper bearing", "30206", "32208"],
  params: [
    { key: "code", label: "Označení", kind: "enum", options: enumOf(Object.keys(TAPERED), (k) => `${k} (${TAPERED[k].d}×${TAPERED[k].D}×${TAPERED[k].T})`), default: "30206" },
    { key: "rollers", label: "Modelovat kuželíky", kind: "bool", default: true, hint: "vypněte u velkých sestav" },
  ],
  sizes: { key: "code", columns: [{ key: "d", label: "d" }, { key: "D", label: "D" }, { key: "T", label: "T" }, { key: "B", label: "B" }, { key: "C", label: "C" }], rows: Object.entries(TAPERED).map(([k, v]) => ({ code: k, ...v })) },
  parse: (q) => {
    const kw = has(q, "kuzelik", "tapered", "taper");
    const code = (q.match(/\b(3[02][0-3]\d{2})\b/) ?? [])[1];
    if (!kw && !code) return null;
    if (code && !TAPERED[code]) return kw ? { values: {}, score: 0.5 } : null;
    return { values: code ? { code } : {}, score: score(kw, code ? 0.4 : 0) || 0.6 };
  },
  describe: (v) => `Kuželíkové ložisko ${v.code} (${TAPERED[str(v.code)]?.d}×${TAPERED[str(v.code)]?.D}×${TAPERED[str(v.code)]?.T})`,
  make: (v) => {
    const code = str(v.code, "30206");
    const b = TAPERED[code] ?? TAPERED["30206"];
    const h = (b.D - b.d) / 2;
    const a = (12 * Math.PI) / 180; // úhel dráhy
    const t = Math.tan(a);
    // vnitřní kroužek (s kuželovou oběžnou dráhou), vnější kroužek (kužel) – profily (r, z) kolem osy Z
    const ri = b.d / 2;
    const rm = ri + h * 0.48; // střed průřezu
    const inner: Vec2[] = [[ri, 0], [rm + 0.5, 0], [rm - 1.2 + b.B * t * 0.3, b.B * 0.15], [rm - 1.2 - b.B * t * 0.3, b.B * 0.85], [rm + 1.2, b.B], [ri, b.B]];
    const ro = b.D / 2;
    const outer: Vec2[] = [[rm + 1.4 + b.C * t * 0.3, b.T - b.C], [ro, b.T - b.C], [ro, b.T], [rm + 1.4 - b.C * t * 0.3, b.T]];
    const f: Feature[] = [...revolveProfile("Vnitřní kroužek", inner, "new"), ...revolveProfile("Vnější kroužek", outer, "add")];
    if (v.rollers !== false) {
      const dw = h * 0.45;
      const lw = b.B * 0.62;
      const z = Math.max(9, Math.round((Math.PI * 2 * rm) / (dw * 1.7)));
      const roller: Feature = { id: uid(), name: "Kuželík", type: "cone", radius1: dw / 2, radius2: dw / 2 + lw * t * 0.5, height: lw, position: [rm, 0, b.B * 0.2], axis: "Z", mode: "add" };
      f.push(roller, { id: uid(), name: "Kuželíky", type: "pattern", featureId: roller.id, kind: "circular", count: z, angle: 360, axis: "Z", center: [0, 0, 0] });
    }
    f.push(chamferAll(Math.min(0.6, h * 0.06)));
    return part(`Kuželíkové ložisko ${code}`, "ocel", f, `${code} – ${b.d}×${b.D}×${b.T}`, "#b9c2cc");
  },
};

export const thrustBearing: Family = {
  id: "bearingThrust",
  name: "Axiální kuličkové ložisko",
  group: "Ložiska",
  icon: "tube",
  standards: ["ISO 104", "DIN 711", "ČSN 02 4730"],
  keywords: ["axialni lozisko", "axialni", "thrust bearing", "thrust ball bearing", "51105", "51208"],
  params: [
    { key: "code", label: "Označení", kind: "enum", options: enumOf(Object.keys(THRUST), (k) => `${k} (${THRUST[k].d}×${THRUST[k].D}×${THRUST[k].H})`), default: "51105" },
    { key: "balls", label: "Modelovat kuličky", kind: "bool", default: true },
  ],
  sizes: { key: "code", columns: [{ key: "d", label: "d" }, { key: "D", label: "D" }, { key: "H", label: "H" }], rows: Object.entries(THRUST).map(([k, v]) => ({ code: k, ...v })) },
  parse: (q) => {
    const kw = has(q, "axial", "thrust");
    const code = (q.match(/\b(51[12]\d{2})\b/) ?? [])[1];
    if (!kw && !code) return null;
    if (code && !THRUST[code]) return kw ? { values: {}, score: 0.5 } : null;
    return { values: code ? { code } : {}, score: score(kw, code ? 0.4 : 0) || 0.6 };
  },
  describe: (v) => `Axiální ložisko ${v.code} (${THRUST[str(v.code)]?.d}×${THRUST[str(v.code)]?.D}×${THRUST[str(v.code)]?.H})`,
  make: (v) => {
    const code = str(v.code, "51105");
    const b = THRUST[code] ?? THRUST["51105"];
    const w = b.H * 0.36; // tloušťka kroužku
    const dw = b.H * 0.5;
    const dm = (b.d + b.D) / 2;
    const f: Feature[] = [tube("Hřídelový kroužek", b.D - 1, b.d, w, 0, "new"), tube("Tělesový kroužek", b.D, b.d + 1, w, b.H - w, "add")];
    if (v.balls !== false) {
      const z = Math.max(8, Math.round((Math.PI * dm) / (dw * 1.5)));
      const ball: Feature = { id: uid(), name: "Kulička", type: "sphere", radius: dw / 2, position: [dm / 2, 0, b.H / 2], mode: "add" };
      f.push(ball, { id: uid(), name: "Kuličky", type: "pattern", featureId: ball.id, kind: "circular", count: z, angle: 360, axis: "Z", center: [0, 0, 0] });
    }
    return part(`Axiální ložisko ${code}`, "ocel", f, `${code} – ${b.d}×${b.D}×${b.H}`, "#b9c2cc");
  },
};

export const needleBearing: Family = {
  id: "bearingNeedle",
  name: "Jehlové ložisko s tenkým pouzdrem HK",
  group: "Ložiska",
  icon: "tube",
  standards: ["ISO 3245", "DIN 618"],
  keywords: ["jehlove lozisko", "jehlove", "needle bearing", "needle roller", "hk"],
  params: [
    { key: "code", label: "Označení", kind: "enum", options: enumOf(Object.keys(NEEDLE), (k) => `${k} (${NEEDLE[k].Fw}×${NEEDLE[k].D}×${NEEDLE[k].C})`), default: "HK1612" },
    { key: "needles", label: "Modelovat jehly", kind: "bool", default: true },
  ],
  sizes: { key: "code", columns: [{ key: "Fw", label: "Fw" }, { key: "D", label: "D" }, { key: "C", label: "C" }], rows: Object.entries(NEEDLE).map(([k, v]) => ({ code: k, ...v })) },
  parse: (q) => {
    const kw = has(q, "jehl", "needle");
    const code = (q.match(/\bhk\s?(\d{4})\b/) ?? [])[1];
    const key = code ? `HK${code}` : undefined;
    if (!kw && !key) return null;
    if (key && !NEEDLE[key]) return kw ? { values: {}, score: 0.5 } : null;
    return { values: key ? { code: key } : {}, score: score(kw, key ? 0.4 : 0) || 0.6 };
  },
  describe: (v) => `Jehlové ložisko ${v.code} (${NEEDLE[str(v.code)]?.Fw}×${NEEDLE[str(v.code)]?.D}×${NEEDLE[str(v.code)]?.C})`,
  make: (v) => {
    const code = str(v.code, "HK1612");
    const b = NEEDLE[code] ?? NEEDLE.HK1612;
    const t = (b.D - b.Fw) / 2;
    const dn = t * 0.6; // průměr jehly
    const f: Feature[] = [tube("Pouzdro", b.D, b.Fw + dn * 1.1, b.C, 0, "new"), tube("Lem 1", b.D, b.Fw, t * 0.5, 0, "add"), tube("Lem 2", b.D, b.Fw, t * 0.5, b.C - t * 0.5, "add")];
    if (v.needles !== false) {
      const rm = b.Fw / 2 + dn / 2 + 0.05;
      const z = Math.max(10, Math.round((Math.PI * 2 * rm) / (dn * 1.35)));
      const n: Feature = cyl("Jehla", dn, b.C - t, t * 0.5, "add", "Z", [rm, 0]);
      f.push(n, { id: uid(), name: "Jehly", type: "pattern", featureId: n.id, kind: "circular", count: z, angle: 360, axis: "Z", center: [0, 0, 0] });
    }
    return part(`Jehlové ložisko ${code}`, "ocel", f, `${code} – ${b.Fw}×${b.D}×${b.C}`, "#b9c2cc");
  },
};

export const plummerBlock: Family = {
  id: "ucp",
  name: "Ložiskové těleso stojaté UCP s vložkou",
  group: "Ložiska",
  icon: "box",
  standards: ["JIS B 1559", "ISO 3228"],
  keywords: ["lozniskove teleso", "loziskove teleso", "ucp", "domek", "loziskovy domek", "plummer block", "pillow block", "stojate"],
  params: [{ key: "code", label: "Označení", kind: "enum", options: enumOf(Object.keys(UCP), (k) => `${k} (d ${UCP[k].d})`), default: "UCP205" }],
  sizes: { key: "code", columns: [{ key: "d", label: "d" }, { key: "a", label: "a" }, { key: "e", label: "e" }, { key: "h", label: "h" }, { key: "b", label: "b" }], rows: Object.entries(UCP).map(([k, v]) => ({ code: k, ...v })) },
  parse: (q) => {
    const kw = has(q, "ucp", "domek", "domecek", "teleso", "plummer", "pillow");
    if (!kw) return null;
    const code = (q.match(/\bucp\s?(2(?:04|05|06|07|08|09|10))\b/) ?? [])[1];
    const d = nums(q).find((x) => Object.values(UCP).some((u) => u.d === x));
    const key = code ? `UCP${code}` : d ? Object.keys(UCP).find((k) => UCP[k].d === d) : undefined;
    return { values: key ? { code: key } : {}, score: score(kw, key ? 0.4 : 0) };
  },
  describe: (v) => `Ložiskové těleso ${v.code} – hřídel Ø${UCP[str(v.code)]?.d}`,
  make: (v) => {
    const code = str(v.code, "UCP205");
    const u = UCP[code] ?? UCP.UCP205;
    const baseT = u.h * 0.45;
    const f: Feature[] = [
      box("Patka", [u.a, u.b, baseT], [0, 0, baseT / 2], "new"),
      box("Stojina", [u.g * 0.9, u.B + 4, u.h - baseT], [0, 0, baseT + (u.h - baseT) / 2], "add"),
      { id: uid(), name: "Těleso ložiska", type: "cylinder", radius: u.D / 2 + 6, height: u.B + 4, position: [0, -(u.B + 4) / 2, u.h], axis: "Y", mode: "add" },
      { id: uid(), name: "Otvor pro vložku", type: "cylinder", radius: u.D / 2 + 0.2, height: u.B + 6, position: [0, -(u.B + 6) / 2, u.h], axis: "Y", mode: "cut" },
      // vložka (kuličkové ložisko se širokým vnitřním kroužkem) – jako součást tělesa
      { id: uid(), name: "Vložka – vnější kroužek", type: "tube", outer: u.D, inner: u.D - (u.D - u.d) * 0.4, height: u.B, position: [0, -u.B / 2, u.h], axis: "Y", mode: "add" },
      { id: uid(), name: "Vložka – vnitřní kroužek", type: "tube", outer: u.d + (u.D - u.d) * 0.4, inner: u.d, height: u.B + 8, position: [0, -u.B / 2 - 4, u.h], axis: "Y", mode: "add" },
      cyl("Díra 1", u.s, baseT + 2, -1, "cut", "Z", [-u.e / 2, 0]),
      cyl("Díra 2", u.s, baseT + 2, -1, "cut", "Z", [u.e / 2, 0]),
      { id: uid(), name: "Maznice", type: "cylinder", radius: 3, height: 10, position: [0, 0, u.h + u.D / 2 + 2], axis: "Z", mode: "add" },
      chamferAll(1),
    ];
    return part(`Ložiskové těleso ${code}`, "ocel", f, `${code} – Ø${u.d} – rozteč ${u.e}`, "#7f8a96");
  },
};

export const bronzeBushing: Family = {
  id: "bushing",
  name: "Kluzné pouzdro (bronz)",
  group: "Ložiska",
  icon: "tube",
  standards: ["ISO 4379", "DIN 1850"],
  keywords: ["kluzne pouzdro", "kluzne", "bronzove pouzdro", "pouzdro", "plain bearing", "sleeve bearing", "bushing", "bronze"],
  params: [
    { key: "d", label: "Vnitřní průměr d", kind: "enum", options: Object.keys(BUSHINGS).map((k) => ({ v: k, l: `Ø${k} (D ${BUSHINGS[Number(k)].D})` })), default: "20" },
    { key: "l", label: "Délka l", kind: "number", min: 5, max: 200, step: 1, unit: "mm", default: 20 },
    { key: "collar", label: "S límcem (tvar F)", kind: "bool", default: false },
    { key: "mat", label: "Materiál", kind: "enum", options: ["CuSn7Zn4Pb7 (bronz)", "CuSn12", "ocel/PTFE (bezúdržbové)", "POM"].map((m) => ({ v: m, l: m })), default: "CuSn7Zn4Pb7 (bronz)" },
  ],
  sizes: { key: "d", columns: [{ key: "D", label: "D" }, { key: "l", label: "l" }, { key: "Dc", label: "D límce" }], rows: Object.entries(BUSHINGS).map(([k, v]) => ({ d: k, ...v })) },
  parse: (q) => {
    const kw = has(q, "kluzn", "bronz", "plain bearing", "sleeve", "bushing");
    if (!kw || has(q, "vodici", "guide", "lozisk")) return null;
    const n = nums(q);
    const values: Record<string, string | number | boolean> = {};
    if (n[0]) values.d = String(nearest(Object.keys(BUSHINGS).map((k) => ({ d: Number(k) })), "d", n[0]).d);
    if (n[1]) values.l = n[1];
    if (has(q, "limc", "collar", "flange", "tvar f")) values.collar = true;
    return { values, score: score(kw, (n[0] ? 0.2 : 0) + (n[1] ? 0.2 : 0)) };
  },
  describe: (v) => `Kluzné pouzdro Ø${v.d}×${BUSHINGS[num(v.d)]?.D}×${fmt(num(v.l))}${v.collar ? " F" : ""}`,
  make: (v) => {
    const d = num(v.d, 20);
    const b = BUSHINGS[d] ?? BUSHINGS[20];
    const l = num(v.l, b.l);
    const f: Feature[] = [tube("Pouzdro", b.D, d, l, 0, "new")];
    if (v.collar) f.push(tube("Límec", b.Dc, d, Math.max(2, (b.D - d) / 2), l - Math.max(2, (b.D - d) / 2), "add"));
    f.push(chamferAll(0.5));
    return part(`Kluzné pouzdro Ø${d}×${b.D}×${fmt(l)}`, /ocel|POM/.test(str(v.mat)) ? (str(v.mat).startsWith("POM") ? "pom" : "ocel") : "mosaz", f, `ISO 4379 – ${v.collar ? "F" : "C"} ${d}×${b.D}×${fmt(l)}`, "#c9a46a");
  },
};

export const BEARINGS2: Family[] = [taperedBearing, thrustBearing, needleBearing, plummerBlock, bronzeBushing];
