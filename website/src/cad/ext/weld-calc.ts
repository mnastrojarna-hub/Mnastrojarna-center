/**
 * Svary – čistá (bez OCCT) část 8. vlny: tvary úprav svarových ploch podle ISO 9692-1 (I, V, Y, X, U, 2U, ½V, ½Y, K, J, 2J),
 * průřez svarového kovu včetně převýšení housenky a kořene, koutový svar a ↔ z (z = a·√2), děrový / žlábkový a bodový svar,
 * hmotnost svarového kovu a odhad přídavného materiálu (hmotnost / účinnost navaření podle metody ISO 4063).
 *
 * Souřadnice průřezu drážky (rovina kolmá na spoj): x = kolmo na spojovanou plochu, kladně do připravovaného dílu A,
 * x = 0 je střed mezery (souměrné úpravy V, X, U…) nebo povrch druhého dílu B (jednostranné úpravy ½V, K, J…);
 * y = přes tloušťku plechu, 0 = strana kořene, t = strana svaru (šipky). Běží v UI i v jádře.
 */
import { cadLocale, tr } from "../i18n";
import type { Vec2, Vec3 } from "../types";

const fmt = (n: number, d = 2) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString(cadLocale(), { maximumFractionDigits: d });
const RAD = Math.PI / 180;

// ---------------- úpravy svarových ploch ----------------

export type GroovePrep = "I" | "V" | "Y" | "X" | "U" | "UU" | "HV" | "HY" | "K" | "J" | "JJ";
export type JointKind = "butt" | "T" | "corner";

export type PrepDef = {
  v: GroovePrep;
  l: string;
  /** obě spojované části upravené (souměrně kolem středu mezery) */
  both: boolean;
  /** oboustranná úprava (X, 2U, K, 2J) – svar z obou stran */
  double: boolean;
  /** zaoblené dno (U, J) */
  curved: boolean;
  /** výchozí úhel: V/Y/X = celkový úhel rozevření α, ostatní = úhel úkosu / boku β */
  angle: number;
  /** výchozí otupení c a mezera b [mm] (ISO 9692-1) */
  c: number;
  g: number;
  /** výchozí poloměr dna R (U, J) */
  R: number;
  /** číslo úpravy v ISO 9692-1 tab. 1 */
  iso: string;
};

export const PREPS: PrepDef[] = [
  { v: "I", l: tr("I – bez úpravy (mezera)"), both: true, double: false, curved: false, angle: 0, c: 0, g: 2, R: 0, iso: "1.2" },
  { v: "V", l: tr("V – jednostranný V"), both: true, double: false, curved: false, angle: 60, c: 1, g: 2, R: 0, iso: "1.3" },
  { v: "Y", l: tr("Y – V s velkým otupením"), both: true, double: false, curved: false, angle: 60, c: 3, g: 1, R: 0, iso: "1.5" },
  { v: "X", l: tr("X – oboustranný V"), both: true, double: true, curved: false, angle: 60, c: 2, g: 2, R: 0, iso: "2.5" },
  { v: "U", l: tr("U – jednostranný U"), both: true, double: false, curved: true, angle: 10, c: 2, g: 0, R: 6, iso: "1.9" },
  { v: "UU", l: tr("2U – oboustranný U"), both: true, double: true, curved: true, angle: 10, c: 2, g: 0, R: 6, iso: "2.7" },
  { v: "HV", l: tr("½V – jednostranný úkos (HV)"), both: false, double: false, curved: false, angle: 45, c: 1, g: 2, R: 0, iso: "1.6" },
  { v: "HY", l: tr("½Y – úkos s velkým otupením (HY)"), both: false, double: false, curved: false, angle: 45, c: 3, g: 1, R: 0, iso: "1.8" },
  { v: "K", l: tr("K – oboustranný úkos"), both: false, double: true, curved: false, angle: 45, c: 2, g: 2, R: 0, iso: "2.8" },
  { v: "J", l: tr("J – jednostranný J"), both: false, double: false, curved: true, angle: 10, c: 2, g: 0, R: 6, iso: "1.11" },
  { v: "JJ", l: tr("2J – oboustranný J"), both: false, double: true, curved: true, angle: 10, c: 2, g: 0, R: 6, iso: "2.10" },
];
export const prepDef = (p: string): PrepDef | undefined => PREPS.find((x) => x.v === p);
/** úhel rozevření α (V, Y, X) – ostatní úpravy mají úhel boku / úkosu β */
export const isOpeningAngle = (p: GroovePrep) => p === "V" || p === "Y" || p === "X";

export type GrooveSpec = {
  prep: GroovePrep;
  /** tloušťka připravovaného dílu (svaru) */
  t: number;
  /** otupení c */
  c: number;
  /** mezera b (kořenová) */
  g: number;
  /** α (V, Y, X) nebo β (ostatní) [°] */
  angle: number;
  /** poloměr dna (U, J) */
  R: number;
  /** převýšení housenky (líc; u oboustranných úprav obě strany) */
  cap: number;
  /** převýšení kořene (jednostranné úpravy s mezerou > 0) */
  root: number;
  /** trvalá podložka pod kořenem (místo převýšení kořene) */
  backing: boolean;
  /** přesah housenky přes hranu úkosu na každou stranu */
  overlap: number;
};

/** bod obrysu; `arc` = úsek od předchozího bodu je oblouk procházející bodem `arc` */
export type CPt = { p: Vec2; arc?: Vec2 };

/** Zkontroluje rozměry úpravy – chybová hláška česky, nebo null. */
export function grooveError(s: GrooveSpec): string | null {
  const d = prepDef(s.prep);
  if (!d) return tr("Neznámá úprava svarových ploch „{0}“ – {1}.", s.prep, PREPS.map((x) => x.v).join(", "));
  if (!(s.t > 0)) return tr("Tloušťka svařovaného dílu musí být kladná.");
  if (s.g < 0 || s.c < 0 || s.cap < 0 || s.root < 0) return tr("Mezera, otupení i převýšení musí být nezáporné.");
  if (s.prep !== "I" && s.c >= s.t) return tr("Otupení {0} mm musí být menší než tloušťka {1} mm.", fmt(s.c), fmt(s.t));
  if (s.prep === "I" && s.g <= 0) return tr("Svar I potřebuje mezeru větší než 0.");
  if (s.prep !== "I") {
    const max = isOpeningAngle(s.prep) ? 150 : 75;
    if (!(s.angle > 0 && s.angle <= max)) return tr("Úhel úpravy musí být v rozsahu 0–{0}°.", max);
  }
  if (d.curved && !(s.R > 0)) return tr("Úprava {0} potřebuje poloměr dna R > 0.", s.prep);
  return null;
}

/** úhel jedné strany (od roviny spoje) v radiánech */
const sideAngle = (s: GrooveSpec) => (isOpeningAngle(s.prep) ? s.angle / 2 : s.angle) * RAD;

/**
 * Bok úpravy od hrany otupení (x0, 0) k povrchu (·, H) v souřadnicích (x, s), s = vzdálenost od otupení k povrchu.
 * Úkos = přímka pod úhlem β od roviny spoje; U / J = oblouk R (střed nad otupením) tečně navazující na bok β.
 */
function flank(s: GrooveSpec, x0: number, H: number): CPt[] {
  if (H <= 1e-9) return [];
  const d = prepDef(s.prep)!;
  if (s.prep === "I") return [{ p: [x0, H] }];
  const b = sideAngle(s);
  if (!d.curved) return [{ p: [x0 + H * Math.tan(b), H] }];
  const R = s.R;
  const sAt = (th: number): Vec2 => [x0 + R * Math.cos(th), R + R * Math.sin(th)];
  const tangentS = R * (1 - Math.sin(b));
  if (H <= tangentS + 1e-9) {
    const te = Math.asin(Math.max(-1, Math.min(1, (H - R) / R)));
    return [{ p: [sAt(te)[0], H], arc: sAt((-Math.PI / 2 + te) / 2) }];
  }
  const P = sAt(-b);
  return [{ p: P, arc: sAt((-Math.PI / 2 - b) / 2) }, { p: [P[0] + (H - P[1]) * Math.tan(b), H] }];
}

const mapPts = (pts: CPt[], f: (q: Vec2) => Vec2): CPt[] => pts.map((q) => ({ p: f(q.p), ...(q.arc ? { arc: f(q.arc) } : {}) }));

/** Kus drážky mezi rovinou spoje x = x0 a bokem úpravy od otupení (výška y0) k povrchu (y0 ± H); `down` = bok jde dolů. */
function bevelPiece(s: GrooveSpec, x0: number, y0: number, H: number, down: boolean): CPt[] | null {
  if (H <= 1e-9 || s.prep === "I") return null;
  const sg = down ? -1 : 1;
  const wall = mapPts(flank(s, x0, H), ([x, q]) => [x, y0 + sg * q]);
  return [{ p: [x0, y0] }, ...wall, { p: [x0, y0 + sg * H] }];
}

const mirrorX = (q: Vec2): Vec2 => [-q[0], q[1]];
const rect = (x0: number, y0: number, x1: number, y1: number): CPt[] => [{ p: [x0, y0] }, { p: [x1, y0] }, { p: [x1, y1] }, { p: [x0, y1] }];
/** Kruhová úseč nad tětivou A→B vyklenutá o výšku h na stranu `dir` (+1 = +y, −1 = −y). */
const capPiece = (A: Vec2, B: Vec2, h: number, dir: number): CPt[] => [{ p: A }, { p: B, arc: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2 + dir * h] }];

export type GrooveProfile = {
  /** kusy drážky (mezera + úkosy) – odeberou se ze spojovaných dílů; navzájem se nepřekrývají */
  groove: CPt[][];
  /** převýšení: housenka (líc), druhá housenka (oboustranné úpravy) nebo převýšení kořene */
  caps: { piece: CPt[]; chord: number; h: number }[];
  /** podložka (obdélník pod kořenem), je-li */
  backing?: Vec2[];
  /** šířka drážky na povrchu (straně svaru) */
  width: number;
  /** krajní body drážky na povrchu (pro kótu / značku) */
  top: [Vec2, Vec2];
};

/** Obrys drážky a svarového kovu v rovině průřezu (viz hlavička souboru) jako nepřekrývající se kusy. */
export function grooveProfile(s: GrooveSpec): GrooveProfile {
  const err = grooveError(s);
  if (err) throw new Error(err);
  const d = prepDef(s.prep)!;
  const g = s.g;
  const t = s.t;
  const x0 = d.both ? g / 2 : g;
  const right: CPt[][] = [];
  if (!d.double) {
    const p = bevelPiece(s, x0, s.c, t - s.c, false);
    if (p) right.push(p);
  } else {
    const h1 = (t - s.c) / 2;
    const up = bevelPiece(s, x0, h1 + s.c, t - s.c - h1, false);
    const lo = bevelPiece(s, x0, h1, h1, true);
    if (up) right.push(up);
    if (lo) right.push(lo);
  }
  const groove: CPt[][] = [];
  if (g > 1e-9) groove.push(d.both ? rect(-g / 2, 0, g / 2, t) : rect(0, 0, g, t));
  groove.push(...right);
  if (d.both) groove.push(...right.map((pc) => mapPts(pc, mirrorX)));
  // šířka na povrchu (y = t) a dole (y = 0)
  const xAt = (y: number) => {
    let x = x0;
    for (const pc of right) for (const q of pc) if (Math.abs(q.p[1] - y) < 1e-9) x = Math.max(x, q.p[0]);
    return x;
  };
  const xt = xAt(t);
  const xb = xAt(0);
  const ov = Math.max(0, s.overlap);
  const L = (x: number) => (d.both ? -x - ov : 0);
  const caps: GrooveProfile["caps"] = [];
  const topA: Vec2 = [xt + ov, t];
  const topB: Vec2 = [L(xt), t];
  if (s.cap > 1e-9) caps.push({ piece: capPiece(topA, topB, s.cap, 1), chord: topA[0] - topB[0], h: s.cap });
  if (d.double) {
    if (s.cap > 1e-9) {
      const a: Vec2 = [L(xb), 0];
      const b: Vec2 = [xb + ov, 0];
      caps.push({ piece: capPiece(a, b, s.cap, -1), chord: b[0] - a[0], h: s.cap });
    }
  } else if (!s.backing && g > 1e-9 && s.root > 1e-9) {
    const a: Vec2 = [L(g / 2 + (d.both ? 0 : g / 2)), 0];
    const b: Vec2 = [(d.both ? g / 2 : g) + ov, 0];
    caps.push({ piece: capPiece(a, b, s.root, -1), chord: b[0] - a[0], h: s.root });
  }
  const out: GrooveProfile = { groove, caps, width: d.both ? 2 * xt : xt, top: [[d.both ? -xt : 0, t], [xt, t]] };
  if (s.backing && !d.double) {
    const bw = Math.max(25, g + 20);
    const cx = d.both ? 0 : g / 2;
    out.backing = [[cx - bw / 2, 0], [cx + bw / 2, 0], [cx + bw / 2, -5], [cx - bw / 2, -5]];
  }
  return out;
}

/** Lomená čára obrysu (oblouky rozdělené na `seg` úseků) – pro plochu a náhled. */
export function contourPoints(c: CPt[], seg = 48): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < c.length; i++) {
    const cur = c[i];
    const prev = c[(i - 1 + c.length) % c.length].p;
    if (cur.arc && i > 0) out.push(...arcPoints(prev, cur.arc, cur.p, seg).slice(1, -1));
    else if (cur.arc && i === 0) out.push(...arcPoints(c[c.length - 1].p, cur.arc, cur.p, seg).slice(1, -1));
    out.push(cur.p);
  }
  return out;
}

/** body kruhového oblouku A → M → B */
export function arcPoints(A: Vec2, M: Vec2, B: Vec2, seg = 48): Vec2[] {
  const c = circumcenter(A, M, B);
  if (!c) return [A, B];
  const r = Math.hypot(A[0] - c[0], A[1] - c[1]);
  const a0 = Math.atan2(A[1] - c[1], A[0] - c[0]);
  const am = Math.atan2(M[1] - c[1], M[0] - c[0]);
  const a1 = Math.atan2(B[1] - c[1], B[0] - c[0]);
  const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // směr: přes M
  let sweep = norm(a1 - a0);
  if (norm(am - a0) > sweep) sweep -= 2 * Math.PI;
  const out: Vec2[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + (sweep * i) / seg;
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return out;
}
function circumcenter(A: Vec2, B: Vec2, C: Vec2): Vec2 | null {
  const d = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = A[0] * A[0] + A[1] * A[1];
  const b2 = B[0] * B[0] + B[1] * B[1];
  const c2 = C[0] * C[0] + C[1] * C[1];
  return [(a2 * (B[1] - C[1]) + b2 * (C[1] - A[1]) + c2 * (A[1] - B[1])) / d, (a2 * (C[0] - B[0]) + b2 * (A[0] - C[0]) + c2 * (B[0] - A[0])) / d];
}

/** plocha mnohoúhelníku (absolutní) */
export function polyArea(p: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}
export const contourArea = (c: CPt[]) => polyArea(contourPoints(c, 256));

/** Plocha kruhové úseče s tětivou w a výškou h. */
export function segmentArea(w: number, h: number): number {
  if (!(w > 0 && h > 0)) return 0;
  const R = (w * w) / 4 / (2 * h) + h / 2;
  const phi = Math.atan2(w / 2, R - h);
  return R * R * (phi - Math.sin(phi) * Math.cos(phi));
}

/** plocha jedné strany U / J nad otupením do hloubky H (vpravo od hrany otupení) */
function uHalfArea(H: number, R: number, b: number): number {
  const tangentS = R * (1 - Math.sin(b));
  const arc = (te: number) => ((R * R) / 2) * (te + Math.PI / 2 + Math.sin(te) * Math.cos(te));
  if (H <= tangentS) return arc(Math.asin(Math.max(-1, Math.min(1, (H - R) / R))));
  const Hf = H - tangentS;
  return arc(-b) + R * Math.cos(b) * Hf + (Hf * Hf * Math.tan(b)) / 2;
}

/**
 * Plocha drážky podle vzorců (bez převýšení): I: b·t; V/Y: b·t + (t−c)²·tg(α/2); X: b·t + 2·h²·tg(α/2), h = (t−c)/2;
 * ½V/½Y: b·t + (t−c)²·tg β / 2; K: b·t + h²·tg β; U: b·t + 2·U(t−c); 2U: b·t + 4·U(h); J: b·t + U(t−c); 2J: b·t + 2·U(h),
 * kde U(H) = R²/2·(π/2 − β − sin β·cos β) + R·cos β·H' + H'²·tg β / 2, H' = H − R·(1 − sin β).
 */
export function grooveAreaFormula(s: GrooveSpec): number {
  const g = s.g;
  const t = s.t;
  const H = t - s.c;
  const h = (t - s.c) / 2;
  const a2 = Math.tan(((isOpeningAngle(s.prep) ? s.angle / 2 : s.angle) * Math.PI) / 180);
  const b = (s.angle * Math.PI) / 180;
  switch (s.prep) {
    case "I":
      return g * t;
    case "V":
    case "Y":
      return g * t + H * H * a2;
    case "X":
      return g * t + 2 * h * h * a2;
    case "HV":
    case "HY":
      return g * t + (H * H * a2) / 2;
    case "K":
      return g * t + h * h * a2;
    case "U":
      return g * t + 2 * uHalfArea(H, s.R, b);
    case "UU":
      return g * t + 4 * uHalfArea(h, s.R, b);
    case "J":
      return g * t + uHalfArea(H, s.R, b);
    case "JJ":
      return g * t + 2 * uHalfArea(h, s.R, b);
  }
}

/** Šířka drážky na povrchu (líc). */
export function grooveTopWidth(s: GrooveSpec): number {
  return grooveProfile(s).width;
}

/** Plocha převýšení: housenka (a druhá housenka / převýšení kořene) jako kruhové úseče nad tětivou šířky drážky + přesah. */
export function reinforcementArea(s: GrooveSpec): number {
  return grooveProfile(s).caps.reduce((a, c) => a + segmentArea(c.chord, c.h), 0);
}

/** Plocha kusů obrysu (lomené čáry s oblouky) – kontrola proti vzorcům. */
export const piecesArea = (pieces: CPt[][]) => pieces.reduce((a, pc) => a + contourArea(pc), 0);

/** Celá plocha průřezu svarového kovu podle vzorců (drážka + převýšení). */
export const weldAreaFormula = (s: GrooveSpec) => grooveAreaFormula(s) + reinforcementArea(s);

// ---------------- data prvku tupého svaru ----------------

const numOr = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

export type GrooveData = {
  faces: number[];
  edges: number[];
  prep: GroovePrep;
  angle: number;
  c: number;
  g: number;
  R: number;
  cap: number;
  root: number;
  backing: boolean;
  t: number;
  flip: boolean;
  field: boolean;
  process: string;
  eff: number;
};
/** Data prvku tupého svaru s výchozími hodnotami podle úpravy (ISO 9692-1). */
export function grooveData(data: Record<string, unknown>): GrooveData {
  const prep = (PREPS.some((p) => p.v === data.prep) ? data.prep : "V") as GroovePrep;
  const d = prepDef(prep)!;
  return {
    faces: Array.isArray(data.faces) ? (data.faces as number[]) : [],
    edges: Array.isArray(data.edges) ? (data.edges as number[]) : [],
    prep,
    angle: numOr(data.angle, d.angle),
    c: numOr(data.rootFace, d.c),
    g: numOr(data.gap, d.g),
    R: numOr(data.radius, d.R),
    cap: numOr(data.cap, 1.5),
    root: numOr(data.root, 0),
    backing: !!data.backing,
    t: numOr(data.t, 0),
    flip: !!data.flip,
    field: !!data.field,
    process: String(data.process ?? "135"),
    eff: numOr(data.eff, 0),
  };
}

// ---------------- koutový svar ----------------

/** Koutový svar: rameno z a účinná tloušťka a pro úhel koutu θ (90° = z = a·√2), plocha průřezu (rovnoramenný trojúhelník). */
export function filletSize(size: number, measure: "a" | "z", angleDeg = 90): { z: number; a: number; area: number } {
  const th = angleDeg * RAD;
  const k = Math.cos(th / 2);
  const z = measure === "z" ? size : size / k;
  const a = z * k;
  return { z, a, area: (z * z * Math.sin(th)) / 2 };
}

/** Délka přerušovaného svaru na hraně délky L: počet úseků a jejich součet (úseky od začátku po roztečí). */
export function intermittent(L: number, segLen: number, pitch: number): { count: number; length: number; spans: [number, number][] } {
  const spans: [number, number][] = [];
  if (!(pitch > 0 && segLen > 0)) return { count: 1, length: L, spans: [[0, L]] };
  for (let s = 0; s < L - 1e-6; s += pitch) spans.push([s, Math.min(segLen, L - s)]);
  return { count: spans.length, length: spans.reduce((a, x) => a + x[1], 0), spans };
}

// ---------------- děrový, žlábkový, bodový ----------------

/** Plocha otvoru děrového (d) nebo žlábkového (délka l ≥ d, šířka d, půlkruhové konce) svaru. */
export const plugArea = (d: number, l = 0) => (l > d ? (l - d) * d + (Math.PI * d * d) / 4 : (Math.PI * d * d) / 4);
/** Objem kulového vrchlíku výšky h nad kružnicí průměru d. */
export const domeVolume = (d: number, h: number) => (h > 0 ? (Math.PI * h * (3 * (d / 2) ** 2 + h * h)) / 6 : 0);

/** Polohy bodů v řadě: n bodů s roztečí p vystředěných kolem 0 (posun `shift`). */
export function rowPositions(n: number, pitch: number, shift = 0): number[] {
  const k = Math.max(1, Math.round(n));
  return Array.from({ length: k }, (_, i) => shift + (i - (k - 1) / 2) * pitch);
}

// ---------------- metody svařování (ISO 4063) a svarový kov ----------------

export type ProcessDef = { v: string; l: string; eff: number; filler: boolean };
export const PROCESSES: ProcessDef[] = [
  { v: "111", l: tr("111 – obalená elektroda (MMA)"), eff: 0.6, filler: true },
  { v: "121", l: tr("121 – pod tavidlem (SAW)"), eff: 0.99, filler: true },
  { v: "131", l: tr("131 – MIG"), eff: 0.9, filler: true },
  { v: "135", l: tr("135 – MAG"), eff: 0.9, filler: true },
  { v: "136", l: tr("136 – MAG plněnou elektrodou"), eff: 0.85, filler: true },
  { v: "138", l: tr("138 – MAG kovovým práškem"), eff: 0.92, filler: true },
  { v: "141", l: tr("141 – TIG"), eff: 0.98, filler: true },
  { v: "21", l: tr("21 – bodové odporové"), eff: 1, filler: false },
];
export const processDef = (v: unknown) => PROCESSES.find((p) => p.v === String(v ?? "").trim());
/** účinnost navaření: zadaná (0–1], jinak podle metody, jinak 0,9 (MAG 135) */
export function depositionEff(process: unknown, eff?: unknown): number {
  if (typeof eff === "number" && eff > 0 && eff <= 1) return eff;
  return processDef(process)?.eff ?? 0.9;
}

/** Hustoty tříd materiálu [g/cm³] (shodné s MATERIALS v lib/mesh-metrics.ts – tady bez závislostí, běží i v jádře). */
const DENSITY: Record<string, number> = { ocel: 7.85, nerez: 7.95, hlinik: 2.7, mosaz: 8.5, med: 8.96, titan: 4.43, pom: 1.41, "1.2343": 7.8 };
/** hustota svarového kovu = hustota materiálu dílu (známá třída), jinak ocel 7,85 g/cm³ */
export const materialDensity = (material: unknown) => DENSITY[String(material ?? "")] ?? 7.85;

/** Hmotnost svarového kovu [kg] z objemu [mm³] a hustoty [g/cm³]; přídavný materiál = hmotnost / účinnost navaření. */
export function weldMetal(volumeMm3: number, density: number, eff: number, filler = true): { mass: number; filler: number } {
  const mass = volumeMm3 * density * 1e-6;
  return { mass, filler: filler && eff > 0 ? mass / eff : 0 };
}

// ---------------- výsledek svaru (stav prvku, tabulka, výkres) ----------------

export type WeldKind = "fillet" | "groove" | "plug" | "slot" | "spot";

/** Kotva značky na výkrese: bod svaru na straně šipky, směr spoje, směr ven ze svaru (kam vede šipka). */
export type WeldAnchor = { p: Vec3; dir: Vec3; out: Vec3; /** vzdálenost k druhé straně spoje proti `out` (tupý svar: t + převýšení) – šipka z druhé strany */ depth?: number };

/** Výsledek stavby svaru – ukládá se do stavu prvku (`status.data.weld`). */
export type WeldInfo = {
  kind: WeldKind;
  /** úprava (tupé svary) */
  prep?: GroovePrep;
  joint?: JointKind | "lap";
  /** název tělesa svarového kovu */
  body?: string;
  /** a (koutový), s (tupý = hloubka průvaru), d (děrový / bodový) [mm] */
  size: number;
  sizeLabel: "a" | "z" | "s" | "d";
  /** koutový: rameno a účinná tloušťka */
  z?: number;
  a?: number;
  /** tupý: úhel, otupení, mezera (skutečná), poloměr dna, tloušťka */
  angle?: number;
  c?: number;
  g?: number;
  R?: number;
  t?: number;
  cap?: number;
  root?: number;
  backing?: boolean;
  /** celková délka svaru (součet úseků; děrový / bodový = 0) */
  length: number;
  /** počet úseků / děr / bodů */
  count: number;
  /** přerušovaný: délka úseku a rozteč; bodový / děrový: rozteč */
  segLen?: number;
  pitch?: number;
  /** žlábkový: délka žlábku */
  slotLen?: number;
  both?: boolean;
  allAround?: boolean;
  field?: boolean;
  process?: string;
  /** průřez svarového kovu [mm²] (děrový: plocha otvoru) */
  area: number;
  /** objem [mm³], hmotnost [kg], přídavný materiál [kg], hustota [g/cm³], účinnost navaření */
  volume: number;
  mass: number;
  filler: number;
  density: number;
  eff: number;
  anchors: WeldAnchor[];
};

const PREP_SYM: Record<GroovePrep, string> = { I: "I", V: "V", Y: "Y", X: "X", U: "U", UU: "2U", HV: "½V", HY: "½Y", K: "K", J: "J", JJ: "2J" };
export const prepLabel = (p: GroovePrep) => PREP_SYM[p] ?? p;

/** Krátký popis typu svaru (tabulka, stav). */
export function weldTypeText(w: Pick<WeldInfo, "kind" | "prep" | "joint" | "both" | "allAround" | "count" | "segLen" | "pitch" | "slotLen" | "field">): string {
  const extra = [w.both ? tr("oboustranný") : "", w.allAround ? tr("kolem") : "", w.field ? tr("montážní") : ""].filter(Boolean).join(", ");
  let base: string;
  switch (w.kind) {
    case "fillet":
      base = w.segLen && w.pitch ? tr("koutový přerušovaný {0}×{1} ({2})", w.count, fmt(w.segLen), fmt(w.pitch)) : tr("koutový");
      break;
    case "groove":
      base = tr("tupý {0}{1}", prepLabel(w.prep ?? "V"), w.joint === "T" ? tr(" (T spoj)") : w.joint === "corner" ? tr(" (rohový spoj)") : "");
      break;
    case "plug":
      base = tr("děrový {0}×", w.count);
      break;
    case "slot":
      base = tr("žlábkový {0}× l {1}", w.count, fmt(w.slotLen ?? 0));
      break;
    case "spot":
      base = tr("bodový {0}×{1}", w.count, w.pitch ? ` (${fmt(w.pitch)})` : "");
      break;
  }
  return extra ? `${base} – ${extra}` : base;
}

/** Velikost svaru pro tabulku: „a5 (z7,07)“, „s10“, „Ø12“. */
export function weldSizeText(w: Pick<WeldInfo, "kind" | "size" | "sizeLabel" | "z" | "a">): string {
  if (w.kind === "fillet") return w.sizeLabel === "z" ? `z${fmt(w.z ?? w.size, 1)} (a${fmt(w.a ?? 0, 1)})` : `a${fmt(w.a ?? w.size, 1)} (z${fmt(w.z ?? 0, 1)})`;
  if (w.sizeLabel === "d") return `Ø${fmt(w.size, 1)}`;
  return `s${fmt(w.size, 1)}`;
}

/** Řádek stavu prvku (✓ … ve stromu, `stav`, window.mncad.status()). */
export function weldInfoText(w: WeldInfo): string {
  const parts = [`${weldTypeText(w)} ${weldSizeText(w)}`];
  if (w.kind === "groove") parts.push(tr("{0}{1}{2}t {3}", w.angle ? `${fmt(w.angle, 1)}° ` : "", w.c ? tr("otupení {0} ", fmt(w.c, 1)) : "", w.g ? tr("mezera {0} ", fmt(w.g, 2)) : "", fmt(w.t ?? 0, 1)));
  if (w.length > 0) parts.push(tr("délka {0} mm", fmt(w.length, 1)));
  if (w.kind !== "spot") {
    parts.push(tr("průřez {0} mm²", fmt(w.area, 2)));
    parts.push(tr("objem {0} cm³", fmt(w.volume / 1000, 3)));
    parts.push(tr("svarový kov {0} kg", fmt(w.mass, 4)));
    if (w.filler > 0) parts.push(tr("přídavný materiál ≈ {0} kg ({1}, η {2})", fmt(w.filler, 4), w.process ?? "135", fmt(w.eff, 2)));
  } else parts.push(tr("bez přídavného materiálu"));
  if (w.body) parts.push(tr("těleso „{0}“", w.body));
  return parts.join(" · ");
}
