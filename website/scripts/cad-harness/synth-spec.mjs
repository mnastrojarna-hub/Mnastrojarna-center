// Synthetic acceptance tool "959" (design CAD-HEADLESS-NAVRH.md 10.1): a cutting die with 19 parts (chamfered plates with
// tapped holes, die, strip rails, pillars and bushes, punches, springs, ISO 7089 washers, dowels, ISO 4762 M8/M10 screws,
// stops, shank, text plate), 70 components and 53 mates (every mate face resolved to an F-number by the first pass),
// a 40-step linear motor with collisions, 4 drawing sheets (A1 assembly in the assembly document, 3 part sheets with
// Chytré kóty in the part documents), clash check, part check and measurements.
// Pure module (no kernel): geometry layout, the text script and the ANALYTIC volumes (no value here comes from a CAD
// measurement). synth-tool.mjs resolves the hole face numbers (F…) with a first kernel pass and writes the files.
//
// Geometry rules that keep every volume analytic and the static clash list = screw × tapped hole only:
//  * plates: box − 4 vertical edge chamfers (before any hole, so the rule "svislé" sees only the 4 box edges);
//  * holes: through cylinders, counterbores, blind holes with the 118° drill tip, flat pockets (válec … odebrat);
//    holes never intersect each other or the chamfers;
//  * ISO 4762 screws are modeled with text commands (ISO 4762 dk/k/s/t): shank, head, chamfer of the tip circle and of
//    the head top circle, hexagon socket, cosmetic thread. The library screw uses chamferAll (concave shank–head edge and
//    the socket corners too, decision 15.9) – its volume is not analytic, so the harness does not use it;
//  * library parts with analytic geometry: guide pillar (circular chamfers incl. the concave collar edge), guide bush,
//    dowel ISO 8734 (two circular chamfers), compression spring (circle swept along a helix: V = πr²·L);
//  * text plate: the engraved text volume = glyph area × depth; the area is integrated exactly from the TrueType
//    outlines of Roboto Bold (Green's theorem on lines and quadratic Bézier segments, opentype.js like replicad);
//  * fits are clearances (pins Ø8 in Ø8,02, pillar Ø24 in Ø24,5 …) – a press fit would be clash.real (decision 15.8).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WEB = path.resolve(HERE, "..", "..");
const PI = Math.PI;
const TIP = 118; // drill point angle of the CAD hole (build.ts holeToolAt)
const TAP = { M8: 6.8, M10: 8.5 }; // tap drill (defaults.ts METRIC_THREADS); typed exactly so the CAD builds what is written
const ISO4762 = { M8: { d: 8, dk: 13, k: 8, s: 6, t: 4 }, M10: { d: 10, dk: 16, k: 10, s: 8, t: 5 } }; // library/tables.ts
const WASHER_M8 = { d1: 8.4, d2: 16, h: 1.6 }; // ISO 7089 (library/tables.ts WASHER.M8)
/**
 * Tapped holes: drill depth and thread depth. Every screw ends inside the thread with a margin (thread depth − engaged
 * length ≥ 0.5 mm, checked by harness.test.mjs) – a classifier that uses the thread depth instead of the hole depth for the
 * thread band (design 6.3) still sees clash.thread only.
 */
export const TAPPED = {
  baseM10: { size: "M10", depth: 30, thread: 26 },
  holderM10: { size: "M10", depth: 20, thread: 16 },
  dieM8: { size: "M8", depth: 15, thread: 14 },
  baseM8: { size: "M8", depth: 12, thread: 10 },
};

/** Czech number as the agent writes it: decimal comma, no trailing zeros */
export const n = (v) => String(Math.round(v * 1e4) / 1e4).replace(".", ",");
const cyl = (d, h) => (PI * d * d * h) / 4;
/** solid of revolution of a right triangle with legs c at a circular edge of radius r (Pappus): convex edge removes, concave adds */
const ring = (r, c, concave = false) => 2 * PI * (r + (concave ? c / 3 : -c / 3)) * (c * c) / 2;
/** blind drilled hole: cylinder + 118° cone tip (build.ts: tip depth = r / tan(59°)) */
const blind = (d, h) => cyl(d, h) + (PI * (d / 2) ** 3) / (3 * Math.tan((TIP * PI) / 360));
const cbore = (d, D, Hc, T) => cyl(D, Hc) + cyl(d, T - Hc);
/** box with the 4 vertical edges chamfered by c */
const plate = (a, b, h, c) => a * b * h - 4 * ((c * c) / 2) * h;
/** tapped blind hole from the top face z (tap drill typed explicitly = the table value, so no design 5.2 #38 warning) */
const tapped = (t, p, z) => `díra ${n(TAP[t.size])} hloubka ${t.depth} v ${p[0]} ${p[1]} ${z} závit ${t.size} hloubka-závitu ${t.thread}`;

/** formulas exported for the unit tests (harness.test.mjs checks them against independent numeric integration) */
export const formulas = { cyl, ring, blind, cbore, plate, TIP, TAP };

/* ───────────── layout (assembly coordinates, mm; base plate corner = origin, Z up) ───────────── */
export const NAMES = {
  asm: "959-01-00 Střižný nástroj",
  base: "959-01-00-01 Základová deska",
  die: "959-01-00-02 Matrice",
  stripper: "959-01-00-03 Stírací deska",
  holder: "959-01-00-04 Kotevní deska",
  backing: "959-01-00-05 Opěrná deska",
  top: "959-01-00-06 Horní deska",
  rail: "959-01-00-07 Vodicí lišta",
  stop: "959-01-00-08 Doraz",
  plate: "959-01-00-09 Štítek",
  shank: "959-01-00-10 Stopka",
  punch: "959-01-00-11 Střižník",
  m10x45: "Šroub M10x45 ISO 4762",
  m10x50: "Šroub M10x50 ISO 4762",
  m8x16: "Šroub M8x16 ISO 4762",
  // library parts (names exactly as library/*.ts make() returns them)
  pillar: "Vodicí sloupek Ø24×150",
  bush: "Vodicí pouzdro Ø24×56",
  pin: "Kolík Ø8×40 ISO 8734",
  spring: "Pružina 2,5×20×38,5",
  washer: "Podložka 8 ISO 7089",
};
export const TEXT = "959-01-00";
const PIL = [[30, 30], [290, 30], [30, 190], [290, 190]];
const DIE0 = [60, 50, 40]; // die corner
const DIE_SCR = [15, 55, 85, 115, 145, 185].flatMap((x) => [[x, 30], [x, 90]]).sort((p, q) => p[1] - q[1] || p[0] - q[0]); // die local
const PUN = [40, 70, 100, 130, 160].flatMap((x) => [[x, 45], [x, 75]]).sort((p, q) => p[1] - q[1] || p[0] - q[0]); // die local
const DIE_PIN = [[25, 60], [175, 60]];
const DIE_M8 = [[40, 10], [160, 10], [40, 110], [160, 110]]; // under the strip rails
const HOLD0 = [60, 40, 172]; // punch holder corner (backing plate above it, same footprint)
const UP_SCR = [15, 45, 75, 125, 155, 185].flatMap((x) => [[x, 10], [x, 130]]).sort((p, q) => p[1] - q[1] || p[0] - q[0]); // holder local
const SPR = [30, 170].flatMap((x) => [[x, 20], [x, 120]]).sort((p, q) => p[1] - q[1] || p[0] - q[0]); // holder local
const UP_PIN = [[10, 70], [190, 70]]; // holder local
const RAIL = { l: 200, w: 20, h: 12 };
const RAIL_Y = [50, 150]; // rails on the die edges (die local y 0…20 and 100…120, clear of the M10 counterbores at 30 ± 8,75)
const RAIL_SCR = [[40, 10], [160, 10]]; // rail local
const RAIL_CB = 8.5; // counterbore depth of the rail (M8 head k = 8 sits 0,5 below the top)
const CB10 = 10.5; // counterbore depth of the M10 screws in the die and in the top plate (head k = 10)
const STOPS = [[160, 24], [160, 196]];
const PLATE0 = [60, 182, 40];
const PLATE_SCR = [[10, 15], [70, 15]];
const Z = { base: 40, die: 70, stripper: [106, 122], holder: [172, 197], backing: 207, top: 242 };
const w = (o, p) => [o[0] + p[0], o[1] + p[1]]; // local → world (xy)

/* ───────────── text area (exact integral over the glyph outlines) ───────────── */
let fontCache = null;
function font() {
  if (!fontCache) {
    const require = createRequire(path.join(WEB, "package.json"));
    const opentype = require("opentype.js");
    const buf = fs.readFileSync(path.join(WEB, "public", "fonts", "Roboto-Bold.ttf"));
    fontCache = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }
  return fontCache;
}
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
/**
 * Area of a text in the CAD's text feature (replicad drawText: opentype getPath, M/L/Q/C/Z with exact Bézier edges).
 * Green's theorem: ∮x dy − y dx; line: P0×P1; quadratic: (2·P0×P1 + 2·P1×P2 + P0×P2)/3; cubic: (6·P0×P1 + 3·P0×P2 +
 * P0×P3 + 3·P1×P2 + 3·P1×P3 + 6·P2×P3)/10. TrueType contours are oriented (outer vs. counter), so the signed sum is the
 * filled area as long as glyphs do not overlap (true for "959-01-00" in Roboto Bold; the kernel check confirms it).
 */
export function textArea(text, size) {
  const cmds = font().getPath(text, 0, 0, size, { drawLayers: false, drawSVG: false }).commands;
  let sum = 0;
  let start = null;
  let p = null;
  for (const c of cmds) {
    if (c.type === "M") {
      if (start && p && (p[0] !== start[0] || p[1] !== start[1])) sum += cross(p, start);
      start = p = [c.x, c.y];
    } else if (c.type === "L") {
      const q = [c.x, c.y];
      sum += cross(p, q);
      p = q;
    } else if (c.type === "Q") {
      const p1 = [c.x1, c.y1];
      const q = [c.x, c.y];
      sum += (2 * cross(p, p1) + 2 * cross(p1, q) + cross(p, q)) / 3;
      p = q;
    } else if (c.type === "C") {
      const p1 = [c.x1, c.y1];
      const p2 = [c.x2, c.y2];
      const q = [c.x, c.y];
      sum += (6 * cross(p, p1) + 3 * cross(p, p2) + cross(p, q) + 3 * cross(p1, p2) + 3 * cross(p1, q) + 6 * cross(p2, q)) / 10;
      p = q;
    } else if (c.type === "Z") {
      if (start && p && (p[0] !== start[0] || p[1] !== start[1])) sum += cross(p, start);
      p = start;
      start = null;
    }
  }
  return Math.abs(sum) / 2;
}

/* ───────────── parts: text commands + analytic volume (mm³) ───────────── */
function screw(size, l) {
  const g = ISO4762[size];
  const c = 0.5; // tip and head-top chamfer (≤ (d − tap)/2 = 0,6 (M8) / 0,75 (M10), so the tip stays inside the thread band)
  if (c > (g.d - TAP[size]) / 2) throw new Error(`${size}: tip chamfer leaves the thread band`);
  const b = Math.min(2 * g.d + 6, l); // ISO 4762 thread length b (l ≤ 125); a short screw is threaded over the whole shank
  const D = Math.round(((2 * g.s) / Math.sqrt(3)) * 1e4) / 1e4; // circumscribed diameter of the socket hexagon (as typed)
  const lines = [
    `válec ${n(g.d)} ${n(l)} v 0 0 ${n(-l)}`,
    `válec ${n(g.dk)} ${n(g.k)} v 0 0 0`,
    `srazit ${n(c)} hrany spodní`,
    `srazit ${n(c)} hrany horní kruhové`,
    `skica XY odsazení ${n(g.k)}: mnohoúhelník 6 ${n(D)}`,
    `vysunout ${n(g.t)} odebrat obráceně`,
    `závit ${size} délka ${n(b)} v 0 0 ${n(-l)}`,
  ];
  const hex = ((3 * Math.sqrt(3)) / 2) * (D / 2) ** 2;
  const volume = cyl(g.d, l) + cyl(g.dk, g.k) - ring(g.d / 2, c) - ring(g.dk / 2, c) - hex * g.t;
  return { lines, volume, size, l, c, d: g.d, k: g.k };
}

export function parts() {
  const P = {};
  // 01 base plate 320 × 220 × 40: pillar pockets, M10 tapped for the die screws, slug holes, dowel holes, M8 for the name plate
  {
    const L = ["kvádr 320 220 40", "srazit 2 hrany svislé"];
    let V = plate(320, 220, 40, 2);
    for (const [x, y] of PIL) L.push(`válec 32,1 8 v ${x} ${y} 32 odebrat`), (V -= cyl(32.1, 8));
    for (const p of DIE_SCR.map((q) => w(DIE0, q))) L.push(tapped(TAPPED.baseM10, p, 40)), (V -= blind(TAP.M10, TAPPED.baseM10.depth));
    for (const p of PUN.map((q) => w(DIE0, q))) L.push(`díra 24 skrz v ${p[0]} ${p[1]} 40`), (V -= cyl(24, 40));
    for (const p of DIE_PIN.map((q) => w(DIE0, q))) L.push(`díra 8,02 hloubka 12 v ${p[0]} ${p[1]} 40`), (V -= blind(8.02, 12));
    for (const p of PLATE_SCR.map((q) => w(PLATE0, q))) L.push(tapped(TAPPED.baseM8, p, 40)), (V -= blind(TAP.M8, TAPPED.baseM8.depth));
    P.base = { lines: L, volume: V };
  }
  // 02 die plate 200 × 120 × 30: counterbored M10 screw holes, punch openings, dowel holes, M8 tapped for the strip rails
  {
    const L = ["kvádr 200 120 30", "srazit 1 hrany svislé"];
    let V = plate(200, 120, 30, 1);
    for (const [x, y] of DIE_SCR) L.push(`díra 11 skrz v ${x} ${y} 30 zahloubení 17,5 ${n(CB10)}`), (V -= cbore(11, 17.5, CB10, 30));
    for (const [x, y] of PUN) L.push(`díra 20,4 skrz v ${x} ${y} 30`), (V -= cyl(20.4, 30));
    for (const [x, y] of DIE_PIN) L.push(`díra 8,02 skrz v ${x} ${y} 30`), (V -= cyl(8.02, 30));
    for (const p of DIE_M8) L.push(tapped(TAPPED.dieM8, p, 30)), (V -= blind(TAP.M8, TAPPED.dieM8.depth));
    P.die = { lines: L, volume: V };
  }
  // 03 stripper plate 320 × 220 × 16, guided on the pillars
  {
    const L = ["kvádr 320 220 16", "srazit 2 hrany svislé"];
    let V = plate(320, 220, 16, 2);
    for (const [x, y] of PIL) L.push(`díra 24,5 skrz v ${x} ${y} 16`), (V -= cyl(24.5, 16));
    for (const p of PUN.map((q) => w(DIE0, q))) L.push(`díra 20,4 skrz v ${p[0]} ${p[1]} 16`), (V -= cyl(20.4, 16));
    P.stripper = { lines: L, volume: V };
  }
  // 04 punch holder 200 × 140 × 25: punch seats (counterbore from the top), spring pockets (from the bottom), M10 tapped
  {
    const L = ["kvádr 200 140 25", "srazit 1 hrany svislé"];
    let V = plate(200, 140, 25, 1);
    for (const p of PUN.map((q) => w(DIE0, q))) {
      const [x, y] = [p[0] - HOLD0[0], p[1] - HOLD0[1]];
      L.push(`díra 20,05 skrz v ${x} ${y} 25 zahloubení 26,1 5`);
      V -= cbore(20.05, 26.1, 5, 25);
    }
    for (const [x, y] of SPR) L.push(`válec 21 20 v ${x} ${y} 0 odebrat`), (V -= cyl(21, 20));
    for (const p of UP_SCR) L.push(tapped(TAPPED.holderM10, p, 25)), (V -= blind(TAP.M10, TAPPED.holderM10.depth));
    for (const [x, y] of UP_PIN) L.push(`díra 8,02 skrz v ${x} ${y} 25`), (V -= cyl(8.02, 25));
    P.holder = { lines: L, volume: V };
  }
  // 05 backing plate 200 × 140 × 10
  {
    const L = ["kvádr 200 140 10", "srazit 1 hrany svislé"];
    let V = plate(200, 140, 10, 1);
    for (const [x, y] of UP_SCR) L.push(`díra 11 skrz v ${x} ${y} 10`), (V -= cyl(11, 10));
    for (const [x, y] of UP_PIN) L.push(`díra 8,02 skrz v ${x} ${y} 10`), (V -= cyl(8.02, 10));
    P.backing = { lines: L, volume: V };
  }
  // 06 top plate 320 × 220 × 35: guide bush seats, counterbored M10 screw holes, dowel holes
  {
    const L = ["kvádr 320 220 35", "srazit 2 hrany svislé"];
    let V = plate(320, 220, 35, 2);
    for (const [x, y] of PIL) L.push(`díra 32,1 skrz v ${x} ${y} 35 zahloubení 40,1 8`), (V -= cbore(32.1, 40.1, 8, 35));
    for (const q of UP_SCR) {
      const [x, y] = w(HOLD0, q);
      L.push(`díra 11 skrz v ${x} ${y} 35 zahloubení 17,5 ${n(CB10)}`);
      V -= cbore(11, 17.5, CB10, 35);
    }
    for (const q of UP_PIN) {
      const [x, y] = w(HOLD0, q);
      L.push(`díra 8,02 skrz v ${x} ${y} 35`);
      V -= cyl(8.02, 35);
    }
    P.top = { lines: L, volume: V };
  }
  // 07 strip guide rail 200 × 20 × 12 with two counterbored M8 holes (ISO 4762 M8 head Ø13 × 8 in Ø14 × 8,5)
  {
    const L = [`kvádr ${RAIL.l} ${RAIL.w} ${RAIL.h}`, "srazit 1 hrany svislé"];
    let V = plate(RAIL.l, RAIL.w, RAIL.h, 1);
    for (const [x, y] of RAIL_SCR) L.push(`díra 9 skrz v ${x} ${y} ${RAIL.h} zahloubení 14 ${n(RAIL_CB)}`), (V -= cbore(9, 14, RAIL_CB, RAIL.h));
    P.rail = { lines: L, volume: V };
  }
  // 08 stop block Ø30 × 40, top edge chamfered
  P.stop = { lines: ["válec 30 40", "srazit 1 hrany horní"], volume: cyl(30, 40) - ring(15, 1) };
  // 09 name plate 80 × 30 × 5 with the engraved tool number and two M8 clearance holes (screws on ISO 7089 washers)
  {
    const area = textArea(TEXT, 6);
    const L = ["kvádr 80 30 5", "srazit 0,5 hrany svislé"];
    let V = plate(80, 30, 5, 0.5);
    for (const [x, y] of PLATE_SCR) L.push(`díra 9 skrz v ${x} ${y} 5`), (V -= cyl(9, 5));
    L.push(`text "${TEXT}" výška 6 hloubka 0,3 v 40 15 5 gravírovat`);
    V -= area * 0.3;
    P.plate = { lines: L, volume: V, textArea: area };
  }
  // 10 shank: flange Ø80 × 12 + spigot Ø40 × 50, spigot top chamfer 2
  P.shank = { lines: ["válec 80 12", "válec 40 50 v 0 0 12", "srazit 2 hrany horní"], volume: cyl(80, 12) + cyl(40, 50) - ring(20, 2) };
  // 11 punch Ø20 × 75 with a head Ø26 × 5, tip chamfer 0,5
  P.punch = { lines: ["válec 20 75", "válec 26 5 v 0 0 75", "srazit 0,5 hrany spodní"], volume: cyl(20, 75) + cyl(26, 5) - ring(10, 0.5) };
  // ISO 4762 socket head cap screws (text-modeled, see the header)
  for (const [key, size, l] of [["m10x45", "M10", 45], ["m10x50", "M10", 50], ["m8x16", "M8", 16]]) {
    const s = screw(size, l);
    P[key] = { lines: s.lines, volume: s.volume, screw: s };
  }
  // library parts (normálie)
  P.pillar = { library: "vodicí sloupek 24x150", volume: cyl(24, 150) + (cyl(32, 8) - cyl(24, 8)) - 2 * ring(16, 1) - ring(12, 1) + ring(12, 1, true) };
  P.bush = { library: "vodicí pouzdro 24x56", volume: (cyl(32, 56) - cyl(24, 56)) + (cyl(40, 8) - cyl(32, 8)) };
  P.pin = { library: "kolík 8x40 ISO 8734", volume: cyl(8, 40) - 2 * ring(4, 0.6) };
  {
    const R = 8.75, pitch = 6, turns = 6, wire = 2.5; // DIN 2095 d2,5 De20 L0 38,5 n6 → pitch (L0 − d)/n = 6
    P.spring = { library: "pružina d2,5 D20 L38,5 n6", volume: cyl(wire, turns * Math.hypot(2 * PI * R, pitch)) };
  }
  P.washer = { library: "podložka M8 ISO 7089", volume: cyl(WASHER_M8.d2, WASHER_M8.h) - cyl(WASHER_M8.d1, WASHER_M8.h) };
  for (const [k, v] of Object.entries(P)) v.name = NAMES[k];
  return P;
}

/* ───────────── components (insertion order = #index of the mates) ───────────── */
export function components() {
  const C = [];
  const put = (part, at, opts = {}) => C.push({ part, at, ...opts });
  put("base", [0, 0, 0], { fixed: true });
  put("die", DIE0);
  for (const [x, y] of PIL) put("pillar", [x, y, 32]);
  for (const y of RAIL_Y) put("rail", [60, y, Z.die]);
  for (const [x, y] of STOPS) put("stop", [x, y, Z.base]);
  put("plate", PLATE0);
  for (const q of DIE_PIN) put("pin", [...w(DIE0, q), 30]);
  for (const q of DIE_SCR) put("m10x45", [...w(DIE0, q), Z.die - CB10]);
  for (const y of RAIL_Y) for (const q of RAIL_SCR) put("m8x16", [60 + q[0], y + q[1], Z.die + RAIL.h - RAIL_CB]);
  for (const q of PLATE_SCR) put("washer", [...w(PLATE0, q), Z.base + 5]);
  for (const q of PLATE_SCR) put("m8x16", [...w(PLATE0, q), Z.base + 5 + WASHER_M8.h]);
  put("stripper", [0, 0, Z.stripper[0]]);
  put("holder", HOLD0);
  put("backing", [HOLD0[0], HOLD0[1], Z.holder[1]]);
  put("top", [0, 0, Z.backing]);
  put("shank", [160, 110, Z.top]);
  for (const [x, y] of PIL) put("bush", [x, y, Z.top - 56]);
  for (const q of PUN) put("punch", [...w(DIE0, q), Z.holder[1] - 80]);
  for (const q of SPR) put("spring", [...w(HOLD0, q), 154.25]);
  for (const q of UP_SCR) put("m10x50", [...w(HOLD0, q), Z.top - CB10]);
  for (const q of UP_PIN) put("pin", [...w(HOLD0, q), Z.holder[0]]);
  return C.map((c, i) => ({ ...c, index: i + 1 }));
}
const idx = (part) => components().filter((c) => c.part === part).map((c) => c.index);

/**
 * Face numbers resolved by the first kernel pass: component index + cylinder Ø or plane normal + point in assembly
 * coordinates. `anyXY` planes are matched by normal and height only (a large face with holes has no meaningful centre)
 * and must still be unique. EVERY plane of a mate is resolved here: a side rule such as `horní` picks the extreme face
 * but notes "F2 z 5 vyhovujících" when several faces point that way (pocket floors), which design 5.2 row 13 turns into
 * ⚠ select.ambiguous – a strict run would stop on it.
 */
export function faceLookups() {
  const comp = (part) => idx(part)[0];
  const out = [];
  const pil = idx("pillar");
  PIL.forEach(([x, y], k) => {
    out.push({ id: `basePocket${k + 1}`, comp: comp("base"), kind: "cylinder", dia: 32.1, at: [x, y] });
    out.push({ id: `baseFloor${k + 1}`, comp: comp("base"), kind: "plane", normal: [0, 0, 1], at: [x, y, 32] });
    out.push({ id: `pillarBottom${k + 1}`, comp: pil[k], kind: "plane", normal: [0, 0, -1], at: [x, y, 32] });
  });
  out.push({ id: "baseTop", comp: comp("base"), kind: "plane", normal: [0, 0, 1], at: [0, 0, Z.base], anyXY: true });
  out.push({ id: "topBottom", comp: comp("top"), kind: "plane", normal: [0, 0, -1], at: [0, 0, Z.backing], anyXY: true });
  out.push({ id: "stripperTop", comp: comp("stripper"), kind: "plane", normal: [0, 0, 1], at: [0, 0, Z.stripper[1]], anyXY: true });
  out.push({ id: "stripperBottom", comp: comp("stripper"), kind: "plane", normal: [0, 0, -1], at: [0, 0, Z.stripper[0]], anyXY: true });
  out.push({ id: "holderBottom", comp: comp("holder"), kind: "plane", normal: [0, 0, -1], at: [0, 0, Z.holder[0]], anyXY: true });
  out.push({ id: "dieTop", comp: comp("die"), kind: "plane", normal: [0, 0, 1], at: [0, 0, Z.die], anyXY: true });
  for (const k of [1, 4]) {
    const [x, y] = PIL[k - 1];
    out.push({ id: `topBush${k}`, comp: comp("top"), kind: "cylinder", dia: 32.1, at: [x, y] });
    out.push({ id: `stripperPillar${k}`, comp: comp("stripper"), kind: "cylinder", dia: 24.5, at: [x, y] });
  }
  return out;
}

/** 53 mates; the 12th is the drive (distance top plate ↔ base plate) of the linear motor */
export function mates() {
  const N = NAMES;
  const q = (s) => `"${s}"`;
  const pil = idx("pillar");
  const M = [];
  M.push(`zámek ${q(N.die)} ${q(N.base)}`);
  pil.forEach((c, k) => M.push(`souosost "#${c}" Ø24 ${q(N.base)} {F:basePocket${k + 1}}`));
  pil.forEach((c, k) => M.push(`kontakt "#${c}" {F:pillarBottom${k + 1}} ${q(N.base)} {F:baseFloor${k + 1}}`));
  M.push(`souosost ${q(N.top)} {F:topBush1} "#${pil[0]}" Ø24`);
  M.push(`souosost ${q(N.top)} {F:topBush4} "#${pil[3]}" Ø24`);
  M.push(`vzdálenost ${q(N.top)} {F:topBottom} ${q(N.base)} {F:baseTop} ${Z.backing - Z.base}`);
  M.push(`zámek ${q(N.backing)} ${q(N.top)}`, `zámek ${q(N.holder)} ${q(N.top)}`, `zámek ${q(N.shank)} ${q(N.top)}`);
  for (const c of idx("bush")) M.push(`zámek "#${c}" ${q(N.top)}`);
  for (const c of idx("punch")) M.push(`zámek "#${c}" ${q(N.holder)}`);
  for (const c of idx("spring")) M.push(`zámek "#${c}" ${q(N.holder)}`);
  for (const c of idx("m10x50")) M.push(`zámek "#${c}" ${q(N.top)}`);
  for (const c of idx("pin").slice(2)) M.push(`zámek "#${c}" ${q(N.holder)}`);
  for (const c of idx("washer")) M.push(`zámek "#${c}" ${q(N.base)}`);
  M.push(`souosost ${q(N.stripper)} {F:stripperPillar1} "#${pil[0]}" Ø24`);
  M.push(`souosost ${q(N.stripper)} {F:stripperPillar4} "#${pil[3]}" Ø24`);
  M.push(`mez vzdálenosti ${q(N.stripper)} {F:stripperTop} ${q(N.holder)} {F:holderBottom} ${LIMIT.holder[0]}..${LIMIT.holder[1]}`);
  M.push(`mez vzdálenosti ${q(N.stripper)} {F:stripperBottom} ${q(N.die)} {F:dieTop} ${LIMIT.die[0]}..${LIMIT.die[1]}`);
  return M.map((m) => `sestava vazba ${m}`);
}
export const DRIVE_MATE = 12;
export const STROKE = { from: Z.backing - Z.base, to: Z.backing - Z.base - 50, steps: 40 };
/** distance limits of the stripper: to the holder bottom (it is pushed down once the gap reaches the minimum) and to the die */
const LIMIT = { holder: [20, 60], die: [10, 200] };
/** stripper travel during the stroke: the gap stripper top ↔ holder bottom closes freely down to the limit, then pushes */
export const STRIPPER_TRAVEL = Math.max(0, STROKE.from - STROKE.to - (Z.holder[0] - Z.stripper[1] - LIMIT.holder[0]));

/**
 * parts with their own drawing sheet (one A3 sheet each, in the part document). The base plate (320 × 220) gets the
 * scale 1:2 explicitly: with `auto` the kernel also picks 1:2 but leaves out the 220 dimension ("! vynecháno: 220:
 * nevešlo se čistě na list"), which a strict run would stop on; with 1:2 typed, all 18 dimensions fit (measured).
 */
export const PART_SHEETS = ["base", "die", "holder"];
const SHEET_OPTS = { base: "A3 měřítko 1:2", die: "A3", holder: "A3" };
const LIBRARY = ["pillar", "bush", "pin", "spring", "washer"];

/* ───────────── script ───────────── */
const header = (t) => [``, `# ── ${t}`];
/** parts + assembly placement (the first kernel pass runs exactly this text) */
export function partsScript() {
  const P = parts();
  const L = [`# ${NAMES.asm} – syntetický nástroj pro zkoušku hotovosti MN CAD (scripts/cad-harness/synth-tool.mjs)`, "# 19 dílů · 70 komponent · 53 vazeb · pohyb 40 kroků s kolizemi · 4 listy výkresu"];
  const order = ["base", "die", "stripper", "holder", "backing", "top", "rail", "stop", "plate", "shank", "punch", "m10x45", "m10x50", "m8x16"];
  for (const k of order) L.push(...header(P[k].name), `nový díl "${P[k].name}"`, ...P[k].lines);
  L.push(...header("normálie"));
  for (const k of LIBRARY) L.push(`normálie ${P[k].library}`);
  L.push(...header("sestava"), `nová sestava "${NAMES.asm}"`);
  for (const c of components()) L.push(`vložit "${NAMES[c.part]}" v ${c.at.map(n).join(" ")}${c.fixed ? " ukotvit" : ""}`);
  return L.join("\n");
}
/** everything after the placement; `faces` maps lookup id → face number (1-based, as `sestava plochy` prints) */
export function restScript(faces) {
  const sub = (s) =>
    s.replace(/\{F:(\w+)\}/g, (_, id) => {
      if (!(faces?.[id] > 0)) throw new Error(`face number for ${id} is missing`);
      return `F${faces[id]}`;
    });
  const N = NAMES;
  const L = [...header("vazby (zámek skupiny, souosost na sloupky, 2× mez vzdálenosti)"), ...mates().map(sub)];
  L.push(...header("pohyb: horní díl −50 mm, stírací deska dosedne až po 30 mm"), `pohyb motor lineární vazba ${DRIVE_MATE} ${STROKE.from}..${STROKE.to} kroky ${STROKE.steps}`, "pohyb kolize");
  L.push(
    ...header("výkresy: A1 sestava + 3 listy dílů"),
    "výkres A1 pohledy přední,horní,iso",
    "výkres řez XZ odsazení 110 celý",
    "výkres kusovník ano",
    "výkres balónky ano",
    `výkres razítko název="Střižný nástroj" číslo="959-01-00" kreslil="AI" nepředepsané="ISO 2768-mK"`,
    "kótovat celkově",
  );
  // part sheets live in the PART documents (a sheet of the assembly document always projects the whole assembly):
  // three orthographic views + iso, Chytré kóty generated from the features (holes, threads, chamfers)
  for (const k of PART_SHEETS) {
    const nm = N[k].replace(/^959-01-00-\d\d /, "");
    L.push(`záložka "${N[k]}"`, `výkres ${SHEET_OPTS[k]} pohledy přední,horní,iso`, "kótovat chytře", `výkres razítko název="${nm}" číslo="${N[k].slice(0, 12)}" kreslil="AI" nepředepsané="ISO 2768-mK"`);
  }
  L.push(...header("kontrola"), `záložka "${N.asm}"`, "kolize", "kontrola sestava");
  for (const k of ["base", "die", "holder"]) L.push(`záložka "${N[k]}"`, "měřit těleso");
  L.push(`záložka "${N.asm}"`, "stav");
  return L.join("\n");
}
export const script = (faces) => `${partsScript()}\n${restScript(faces)}\n`;

/* ───────────── expected values ───────────── */
/** screw × tapped hole overlaps (union = sum − overlaps): annulus between the tap drill and d over the engaged length, minus the tip chamfer ring */
export function threadOverlaps() {
  const P = parts();
  const one = (key, engaged) => {
    const s = P[key].screw;
    const tap = TAP[s.size];
    if (s.c > (s.d - tap) / 2) throw new Error("tip chamfer leaves the thread band");
    return cyl(s.d, engaged) - cyl(tap, engaged) - ring(s.d / 2, s.c);
  };
  // engaged = hole entry (top face of the tapped part) − screw tip (head seat − length)
  const list = [
    { key: "m10x45", into: "base", hole: TAPPED.baseM10, n: DIE_SCR.length, engaged: Z.base - (Z.die - CB10 - P.m10x45.screw.l) },
    { key: "m10x50", into: "holder", hole: TAPPED.holderM10, n: UP_SCR.length, engaged: Z.holder[1] - (Z.top - CB10 - P.m10x50.screw.l) },
    { key: "m8x16", into: "die", hole: TAPPED.dieM8, n: DIE_M8.length, engaged: Z.die - (Z.die + RAIL.h - RAIL_CB - P.m8x16.screw.l) },
    { key: "m8x16", into: "base", hole: TAPPED.baseM8, n: PLATE_SCR.length, engaged: Z.base - (Z.base + 5 + WASHER_M8.h - P.m8x16.screw.l) },
  ];
  return list.map(({ hole, ...t }) => ({ ...t, engaged: Math.round(t.engaged * 1e6) / 1e6, threadDepth: hole.thread, holeDepth: hole.depth, volume: one(t.key, t.engaged) }));
}

export function expected(faces) {
  const P = parts();
  const C = components();
  const count = {};
  for (const c of C) count[c.part] = (count[c.part] ?? 0) + 1;
  const sum = C.reduce((s, c) => s + P[c.part].volume, 0);
  const ov = threadOverlaps();
  const overlap = ov.reduce((s, t) => s + t.n * t.volume, 0);
  const thread = ov.reduce((s, t) => s + t.n, 0);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return {
    v: 1,
    script: "synth-959.txt",
    lines: script(faces).trimEnd().split("\n").length,
    assembly: NAMES.asm,
    components: C.length,
    parts: Object.keys(P).length,
    mates: { total: mates().length, ok: mates().length },
    volume_cm3: r3(sum / 1000),
    volume_union_cm3: r3((sum - overlap) / 1000),
    volume_tol_cm3: 0.01,
    clashes: { total: thread, thread, real: 0, undetermined: 0 },
    sheets: 1 + PART_SHEETS.length,
    // the A1 assembly sheet lives in the assembly document, every part sheet in its part document (Chytré kóty > 0)
    sheetsByDoc: { [NAMES.asm]: 1, ...Object.fromEntries(PART_SHEETS.map((k) => [NAMES[k], 1])) },
    motion: {
      steps: STROKE.steps,
      mate: DRIVE_MATE,
      from: STROKE.from,
      to: STROKE.to,
      stroke_mm: STROKE.from - STROKE.to,
      stripperTravel_mm: STRIPPER_TRAVEL,
      // parts guided by two parallel `souosost` on the pillars: they may only move along Z, without rotation (design 7.2.4)
      guided: [NAMES.top, NAMES.stripper],
      // every step: exactly the static screw × tapped hole pairs (the screws move with their rigid lock groups)
      clashesPerStep: thread,
    },
    protocolMaxBytes: 2048,
    maxSeconds: 120,
    maxRssMB: 2048,
    strictOverheadMax: 0.25,
    faces,
    partVolumes_mm3: Object.fromEntries(Object.entries(P).map(([k, v]) => [v.name, r3(v.volume)])),
    componentCounts: Object.fromEntries(Object.entries(count).map(([k, v]) => [NAMES[k], v])),
    threadPairs: ov.map((t) => ({ screw: NAMES[t.key], part: NAMES[t.into], n: t.n, engaged_mm: t.engaged, threadDepth_mm: t.threadDepth, holeDepth_mm: t.holeDepth, overlap_mm3: r3(t.volume) })),
    textArea_mm2: r3(P.plate.textArea),
  };
}
