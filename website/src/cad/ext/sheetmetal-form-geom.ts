/**
 * Tvářecí nástroje plechu – čistá 2D geometrie (bez OCCT): řez nástroje se zaoblením a tloušťkou plechu, kontrola,
 * zda se poloměry vejdou, obrys (stopa) nástroje pro rozvin a parametry nástrojů. Používá ji jádro (sheetmetal-form.ts)
 * i rozvin v UI (sheetmetal-flat.ts), aby stopa v DXF přesně odpovídala modelu.
 *
 * Řez je v rovině (s, h): h = výška nad plochou, ze které se tvaruje (plech leží v h ∈ [−t, 0]), s = vodorovná souřadnice
 * (poloměr u rotačních nástrojů). Horní plocha tvarované oblasti je lomená čára se zaoblením; spodní plocha je její
 * ekvidistanta o t (soustředné oblouky: vnitřní poloměr R, vnější R + t – stejně jako u ohybu). Na okrajích nástroje
 * pokračuje řez rovným „okrajem“ plechu (lip), aby se nástroj s plechem spojil přes rovinné plochy, ne tečně.
 */
import { tr } from "../i18n";
import type { Seg } from "../sketch";
import { pathEntities } from "../poly-close";
import { toWorld } from "../defaults";
import type { Feature, Vec2, Vec3 } from "../types";

export type FormTool = "louvre" | "dimple" | "bead" | "lance" | "bridge" | "collar" | "cardguide";
/** id prvků rozšíření tvářecích nástrojů */
export const FORM_EXT: Record<FormTool, string> = {
  louvre: "sheet.louvre",
  dimple: "sheet.dimple",
  bead: "sheet.bead",
  lance: "sheet.lance",
  bridge: "sheet.bridge",
  collar: "sheet.collar",
  cardguide: "sheet.cardguide",
};
export const formToolOf = (ext: string): FormTool | null => (Object.entries(FORM_EXT).find(([, v]) => v === ext)?.[0] as FormTool | undefined) ?? null;
export const CROSS_BREAK_EXT = "sheet.crossbreak";

export const formToolLabel = (t: FormTool): string =>
  ({
    louvre: tr("Žaluzie"),
    dimple: tr("Prolis (důlek)"),
    bead: tr("Žebro podél dráhy"),
    lance: tr("Výstřih (jazýček)"),
    bridge: tr("Můstek"),
    collar: tr("Lem díry (límec)"),
    cardguide: tr("Vodítko desky"),
  })[t];

type Data = Record<string, unknown>;
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Okraj řezu (rovný plech za tvarovanou oblastí) a štěrbina prostřihu. */
export const lipOf = (t: number) => Math.max(1, t);
export const kerfOf = (t: number) => Math.max(0.1, 0.1 * t);

// ---------------- lomená čára se zaoblením a její ekvidistanta ----------------

const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add2 = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const mul2 = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
const len2 = (a: Vec2) => Math.hypot(a[0], a[1]);
const unit2 = (a: Vec2): Vec2 => {
  const l = len2(a) || 1;
  return [a[0] / l, a[1] / l];
};
const leftN = (d: Vec2): Vec2 => [-d[1], d[0]];

type Corner = { straight: boolean; left: boolean; C: Vec2; rTop: number; rBot: number; w: number; e: number; mDir: Vec2; nl1: Vec2; nl2: Vec2 };

/** Zaoblení v rohu k: střed C (společný horní i spodní ploše), poloměry, délka tečny e (odebraná z obou sousedních úseků). */
function corner(q: Vec2, d1: Vec2, d2: Vec2, R: number, t: number): Corner {
  const nl1 = leftN(d1);
  const nl2 = leftN(d2);
  const cr = d1[0] * d2[1] - d1[1] * d2[0];
  const dt = d1[0] * d2[0] + d1[1] * d2[1];
  if (Math.abs(cr) < 1e-9 && dt > 0) return { straight: true, left: true, C: q, rTop: 0, rBot: 0, w: 0, e: 0, mDir: [0, 0], nl1, nl2 };
  const left = cr > 0;
  // levý ohyb: střed vlevo (nad materiálem) → horní plocha je vnitřní (R), spodní vnější (R + t); pravý naopak
  const rTop = left ? R : R + t;
  const rBot = left ? R + t : R;
  const w = left ? rTop : -rTop;
  const s = add2(nl1, nl2);
  const C = add2(q, mul2(s, w / (1 + dt)));
  const phi = Math.acos(Math.max(-1, Math.min(1, dt)));
  const e = rTop * Math.tan(phi / 2);
  const mDir = mul2(unit2(s), left ? -1 : 1);
  return { straight: false, left, C, rTop, rBot, w, e, mDir, nl1, nl2 };
}

export type FilletPath = {
  top: Seg[];
  bottom: Seg[];
  topStart: Vec2;
  topEnd: Vec2;
  botStart: Vec2;
  botEnd: Vec2;
  /** krajní body tvarované oblasti na horní ploše (tečné body prvního a posledního zaoblení) */
  reachStart: Vec2;
  reachEnd: Vec2;
  /** vejdou se zaoblení do úseků? */
  fits: boolean;
};

/**
 * Lomená čára `pts` (materiál vpravo od směru) se zaoblením vnitřního poloměru R a ekvidistantou o t. `lip.start` / `lip.end`
 * = první / poslední bod se posune na (tečný bod + lip) – okraj rovného plechu za zaoblením.
 */
export function filletPath(pts: Vec2[], R: number, t: number, lip: { start?: number; end?: number } = {}): FilletPath {
  if (pts.length < 2) throw new Error("filletPath: málo bodů");
  const q = pts.map((p) => [p[0], p[1]] as Vec2);
  const n = q.length;
  const dirs: Vec2[] = [];
  for (let i = 0; i < n - 1; i++) dirs.push(unit2(sub2(q[i + 1], q[i])));
  const corners: (Corner | null)[] = q.map((p, k) => (k === 0 || k === n - 1 ? null : corner(p, dirs[k - 1], dirs[k], R, t)));
  if (lip.start != null && n > 2) q[0] = sub2(q[1], mul2(dirs[0], (corners[1]?.e ?? 0) + lip.start));
  if (lip.end != null && n > 2) q[n - 1] = add2(q[n - 2], mul2(dirs[n - 2], (corners[n - 2]?.e ?? 0) + lip.end));
  let fits = true;
  for (let i = 0; i < n - 1; i++) {
    const used = (corners[i]?.e ?? 0) + (corners[i + 1]?.e ?? 0);
    if (used > len2(sub2(q[i + 1], q[i])) + 1e-9) fits = false;
  }
  const top: Seg[] = [];
  const bottom: Seg[] = [];
  const line = (out: Seg[], a: Vec2, b: Vec2) => {
    if (len2(sub2(a, b)) > 1e-9) out.push({ kind: "line", a, b });
  };
  let cur = q[0];
  let bcur = sub2(q[0], mul2(leftN(dirs[0]), t));
  const topStart = cur;
  const botStart = bcur;
  for (let k = 1; k < n - 1; k++) {
    const c = corners[k]!;
    if (c.straight) continue;
    const T1 = sub2(c.C, mul2(c.nl1, c.w));
    const T2 = sub2(c.C, mul2(c.nl2, c.w));
    const B1 = sub2(c.C, mul2(c.nl1, c.w + t));
    const B2 = sub2(c.C, mul2(c.nl2, c.w + t));
    line(top, cur, T1);
    if (c.rTop > 1e-9) top.push({ kind: "arc", a: T1, m: add2(c.C, mul2(c.mDir, c.rTop)), b: T2 });
    cur = T2;
    line(bottom, bcur, B1);
    if (c.rBot > 1e-9) bottom.push({ kind: "arc", a: B1, m: add2(c.C, mul2(c.mDir, c.rBot)), b: B2 });
    bcur = B2;
  }
  const topEnd = q[n - 1];
  const botEnd = sub2(q[n - 1], mul2(leftN(dirs[n - 2]), t));
  line(top, cur, topEnd);
  line(bottom, bcur, botEnd);
  const c1 = corners[1];
  const cl = corners[n - 2];
  const reachStart = c1 && !c1.straight ? sub2(q[1], mul2(dirs[0], c1.e)) : q[0];
  const reachEnd = cl && !cl.straight ? add2(q[n - 2], mul2(dirs[n - 2], cl.e)) : q[n - 1];
  return { top, bottom, topStart, topEnd, botStart, botEnd, reachStart, reachEnd, fits };
}

const revSeg = (s: Seg): Seg => (s.kind === "line" ? { kind: "line", a: s.b, b: s.a } : { kind: "arc", a: s.b, m: s.m, b: s.a });
const closeLine = (out: Seg[], a: Vec2, b: Vec2) => {
  if (len2(sub2(a, b)) > 1e-9) out.push({ kind: "line", a, b });
};

/** Uzavřený profil skořepiny: horní plocha → konec → spodní plocha zpět → začátek. */
export function shellLoop(p: FilletPath): Seg[] {
  const out: Seg[] = [...p.top];
  closeLine(out, p.topEnd, p.botEnd);
  out.push(...[...p.bottom].reverse().map(revSeg));
  closeLine(out, p.botStart, p.topStart);
  return out;
}
/** Uzavřený profil „pod horní plochou“ až po spodní plochu plechu (h = −t) – plné čelo nástroje (uzavřené konce žaluzie). */
export function solidLoop(p: FilletPath, t: number): Seg[] {
  const out: Seg[] = [...p.top];
  const e: Vec2 = [p.topEnd[0], -t];
  const s: Vec2 = [p.topStart[0], -t];
  closeLine(out, p.topEnd, e);
  closeLine(out, e, s);
  closeLine(out, s, p.topStart);
  return out;
}

// ---------------- řezy nástrojů ----------------

/** Parametry nástroje s výchozími hodnotami (podle tloušťky plechu). */
export type FormDims = {
  length: number;
  width: number;
  height: number;
  diameter: number;
  wallAngle: number;
  rounded: boolean;
  open: "left" | "right";
  slot: number;
  radius: number;
};
export function formDims(d: Data, t: number): FormDims {
  return {
    length: num(d.length, 40),
    width: num(d.width, 8),
    height: num(d.height, Math.max(2, 2 * t)),
    diameter: num(d.diameter, 12),
    wallAngle: num(d.wallAngle, 60),
    rounded: d.rounded !== false,
    open: d.open === "right" ? "right" : "left",
    slot: num(d.slot, 1.6),
    radius: num(d.radius, 0),
  };
}

export type FormSection = {
  /** rotační (kolem normály v bodě) nebo vysunutý (podél osy a) */
  mode: "revolve" | "extrude";
  /** skořepina tloušťky plechu včetně okrajů */
  shell: Seg[];
  /** plné čelo pod horní plochou (jen žaluzie: uzavřené konce) */
  solid?: Seg[];
  /** použitý vnitřní poloměr zaoblení */
  R: number;
  path: FilletPath;
  /** rozsah tvarované oblasti v s (od, do) – stopa nástroje */
  s0: number;
  s1: number;
  /** rozsah podél osy vysunutí (a) – délka / šířka nástroje */
  a0: number;
  a1: number;
  /** výřez materiálu před vložením skořepiny (s a a), okraje leží v polovině „lip“ */
  cut: { s0: number; s1: number; a0: number; a1: number };
  /** štěrbiny (prostřih) – úsečky v (s, a) */
  slits: [Vec2, Vec2][];
  /** souřadnice s ve směru: lokální osa nástroje u = sx·s (louvre: osa s leží napříč – viz `sAcross`) */
  sAcross: boolean;
  /** znaménko s vůči lokální ose (u nebo v): world = sSign · s */
  sSign: 1 | -1;
};

const deg = (a: number) => (a * Math.PI) / 180;
const cot = (a: number) => (Math.abs(a - 90) < 1e-9 ? 0 : 1 / Math.tan(deg(a)));

/** Lomená čára (bez zaoblení) a okraje pro daný nástroj. */
function polyOf(tool: FormTool, dm: FormDims, t: number): { pts: Vec2[]; lip: { start?: number; end?: number }; mode: "revolve" | "extrude" } {
  const m = lipOf(t);
  const H = tool === "cardguide" ? dm.slot + t : dm.height;
  const a = Math.min(90, Math.max(5, dm.wallAngle));
  switch (tool) {
    case "dimple": {
      const rb = dm.diameter / 2;
      const rt = rb - H * cot(a);
      if (!(rb > 0 && H > 0)) throw new Error(tr("Prolis: průměr a hloubka musí být kladné."));
      if (!(rt > 1e-6)) throw new Error(tr("Prolis: průměr {0} mm je pro hloubku {1} mm a úhel stěny {2}° malý – zvětšete průměr nebo úhel stěny.", fmt(dm.diameter), fmt(H), fmt(a)));
      return { pts: [[0, H], [rt, H], [rb, 0], [rb + 1, 0]], lip: { end: m }, mode: "revolve" };
    }
    case "collar": {
      const r0 = dm.diameter / 2 + t;
      if (!(dm.diameter > 0 && H > 0)) throw new Error(tr("Lem díry: průměr díry a výška límce musí být kladné."));
      return { pts: [[r0, H], [r0, 0], [r0 + 1, 0]], lip: { end: m }, mode: "revolve" };
    }
    case "louvre": {
      const W = dm.width;
      if (!(dm.length > 0 && W > 0 && H > 0)) throw new Error(tr("Žaluzie: délka, šířka a výška musí být kladné."));
      return { pts: [[-W / 2, H], [0, H], [W / 2, 0], [W / 2 + 1, 0]], lip: { end: m }, mode: "extrude" };
    }
    case "lance": {
      const L = dm.length;
      const run = H * cot(a);
      if (!(L > 0 && dm.width > 0 && H > 0)) throw new Error(tr("Výstřih: délka, šířka a výška musí být kladné."));
      if (!(L - run > 1e-6)) throw new Error(tr("Výstřih: délka {0} mm je pro výšku {1} mm a úhel {2}° krátká.", fmt(L), fmt(H), fmt(a)));
      return { pts: [[-L / 2, H], [L / 2 - run, H], [L / 2, 0], [L / 2 + 1, 0]], lip: { end: m }, mode: "extrude" };
    }
    case "bridge":
    case "cardguide": {
      const L = dm.length;
      const run = H * cot(a);
      if (!(L > 0 && dm.width > 0 && H > 0)) throw new Error(tr("Můstek: délka, šířka a výška musí být kladné."));
      if (!(L - 2 * run > 1e-6)) throw new Error(tr("Můstek: délka {0} mm je pro výšku {1} mm a úhel {2}° krátká (rovná část vychází záporná).", fmt(L), fmt(H), fmt(a)));
      return { pts: [[-L / 2 - 1, 0], [-L / 2, 0], [-L / 2 + run, H], [L / 2 - run, H], [L / 2, 0], [L / 2 + 1, 0]], lip: { start: m, end: m }, mode: "extrude" };
    }
    case "bead": {
      const W = dm.width;
      const run = H * cot(a);
      if (!(W > 0 && H > 0)) throw new Error(tr("Žebro: šířka a výška musí být kladné."));
      const top = W / 2 - run;
      if (top < -1e-6) throw new Error(tr("Žebro: šířka {0} mm je pro výšku {1} mm a úhel stěny {2}° malá.", fmt(W), fmt(H), fmt(a)));
      const pts: Vec2[] = top > 1e-6 ? [[-W / 2 - 1, 0], [-W / 2, 0], [-top, H], [top, H], [W / 2, 0], [W / 2 + 1, 0]] : [[-W / 2 - 1, 0], [-W / 2, 0], [0, H], [W / 2, 0], [W / 2 + 1, 0]];
      return { pts, lip: { start: m, end: m }, mode: "extrude" };
    }
  }
}

const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

/**
 * Největší vnitřní poloměr ≤ `want`, se kterým se zaoblení vejdou (půlením intervalu); −1 = nevejdou se ani ostré rohy.
 */
function fitRadius(pts: Vec2[], want: number, t: number, lip: { start?: number; end?: number }): number {
  if (filletPath(pts, want, t, lip).fits) return want;
  if (!filletPath(pts, 0, t, lip).fits) return -1;
  let lo = 0;
  let hi = want;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (filletPath(pts, mid, t, lip).fits) lo = mid;
    else hi = mid;
  }
  return lo * 0.98;
}

/**
 * Řez nástroje. `sheetR` = vnitřní poloměr ohybu z parametrů plechu (výchozí poloměr tvarování; „radius“ 0 = automaticky:
 * poloměr plechu, zmenšený tak, aby se vešel; zadaný poloměr se nezmenšuje – nevejde-li se, je to chyba).
 */
export function formSection(tool: FormTool, d: Data, t: number, sheetR: number): FormSection {
  const dm = formDims(d, t);
  const { pts, lip, mode } = polyOf(tool, dm, t);
  const auto = !(dm.radius > 0);
  const want = auto ? (tool === "dimple" && !dm.rounded ? 0 : sheetR) : dm.radius;
  const R = fitRadius(pts, want, t, lip);
  if (R < 0) throw new Error(tr("{0}: rozměry nástroje jsou pro tloušťku plechu {1} mm příliš malé (zaoblení se nevejdou ani s ostrými rohy).", formToolLabel(tool), fmt(t)));
  if (!auto && R < want) throw new Error(tr("{0}: vnitřní poloměr {1} mm se do nástroje nevejde – největší možný je {2} mm (nebo zadejte 0 = automaticky).", formToolLabel(tool), fmt(want), fmt(Math.floor(R * 100) / 100)));
  const path = filletPath(pts, R, t, lip);
  const shell = shellLoop(path);
  const m = lipOf(t);
  const g = kerfOf(t);
  const W = dm.width;
  const L = dm.length;
  const base = { mode, shell, R, path };
  switch (tool) {
    case "dimple":
    case "collar": {
      const r1 = path.reachEnd[0];
      return { ...base, s0: tool === "collar" ? dm.diameter / 2 : 0, s1: r1, a0: 0, a1: 0, cut: { s0: 0, s1: r1 + m / 2, a0: 0, a1: 0 }, slits: [], sAcross: false, sSign: 1 };
    }
    case "louvre": {
      // osa s napříč žaluzií (otevřená strana v s = −W/2), vysunutí podél délky; konce uzavřené plnými čely tloušťky t
      const s1 = path.reachEnd[0];
      return {
        ...base,
        solid: solidLoop(path, t),
        s0: -W / 2,
        s1,
        a0: -L / 2,
        a1: L / 2,
        cut: { s0: -W / 2 - g, s1: s1 + m / 2, a0: -L / 2 + t / 2, a1: L / 2 - t / 2 },
        slits: [[[-W / 2, -L / 2], [-W / 2, L / 2]]],
        sAcross: true,
        sSign: dm.open === "right" ? 1 : -1,
      };
    }
    case "lance": {
      // osa s podél délky (otevřený konec v s = −L/2 → ve směru +u), vysunutí přes šířku
      const s1 = path.reachEnd[0];
      return {
        ...base,
        s0: -L / 2,
        s1,
        a0: -W / 2,
        a1: W / 2,
        cut: { s0: -L / 2 - g, s1: s1 + m / 2, a0: -W / 2 - g, a1: W / 2 + g },
        slits: [
          [[-L / 2, -W / 2], [-L / 2, W / 2]],
          [[-L / 2, -W / 2], [L / 2, -W / 2]],
          [[-L / 2, W / 2], [L / 2, W / 2]],
        ],
        sAcross: false,
        sSign: -1,
      };
    }
    case "bridge":
    case "cardguide": {
      const s0 = path.reachStart[0];
      const s1 = path.reachEnd[0];
      return {
        ...base,
        s0,
        s1,
        a0: -W / 2,
        a1: W / 2,
        cut: { s0: s0 - m / 2, s1: s1 + m / 2, a0: -W / 2 - g, a1: W / 2 + g },
        slits: [
          [[-L / 2, -W / 2], [L / 2, -W / 2]],
          [[-L / 2, W / 2], [L / 2, W / 2]],
        ],
        sAcross: false,
        sSign: 1,
      };
    }
    case "bead": {
      const s0 = path.reachStart[0];
      const s1 = path.reachEnd[0];
      return { ...base, s0, s1, a0: 0, a1: 0, cut: { s0: s0 - m / 2, s1: s1 + m / 2, a0: 0, a1: 0 }, slits: [], sAcross: true, sSign: 1 };
    }
  }
}

/** Poloviční řez (s ≥ 0) symetrického řezu žebra – pro zaoblené konce (rotace o 180°). */
export function halfShell(sec: FormSection, t: number): Seg[] {
  // horní plocha od osy (s = 0) do konce, spodní zpět; žebro je souměrné podle s = 0
  const clipTop = clipFrom0(sec.path.top);
  const clipBot = clipFrom0(sec.path.bottom);
  const out: Seg[] = [...clipTop];
  const topEnd = sec.path.topEnd;
  const botEnd = sec.path.botEnd;
  closeLine(out, topEnd, botEnd);
  out.push(...[...clipBot].reverse().map(revSeg));
  const b0 = clipBot[0]?.a ?? botEnd;
  const t0 = clipTop[0]?.a ?? topEnd;
  closeLine(out, b0, t0);
  void t;
  return out;
}
/** Část lomené dráhy se s ≥ 0 (první segment se ořízne v s = 0; střed žebra leží na rovném úseku nebo ve vrcholu oblouku). */
function clipFrom0(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    if (Math.min(s.a[0], s.b[0]) >= -1e-9) {
      out.push(s);
      continue;
    }
    if (Math.max(s.a[0], s.b[0]) <= 1e-9) continue;
    if (s.kind === "line") {
      const k = (0 - s.a[0]) / (s.b[0] - s.a[0]);
      out.push({ kind: "line", a: [0, s.a[1] + k * (s.b[1] - s.a[1])], b: s.b });
    } else {
      // oblouk přes osu: vrchol (s = 0) je střed oblouku souměrného podle osy – rozdělit v něm
      const c = arcCenter(s);
      const r = c ? len2(sub2(s.a, c)) : 0;
      if (!c) continue;
      const top: Vec2 = [0, c[1] + (s.m[1] > c[1] ? r : -r)];
      const ang0 = Math.atan2(top[1] - c[1], top[0] - c[0]);
      const ang1 = Math.atan2(s.b[1] - c[1], s.b[0] - c[0]);
      const mid = (ang0 + ang1) / 2;
      out.push({ kind: "arc", a: top, m: [c[0] + r * Math.cos(mid), c[1] + r * Math.sin(mid)], b: s.b });
    }
  }
  return out;
}
function arcCenter(s: Extract<Seg, { kind: "arc" }>): Vec2 | null {
  const [a, b, c] = [s.a, s.m, s.b];
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a[0] ** 2 + a[1] ** 2;
  const b2 = b[0] ** 2 + b[1] ** 2;
  const c2 = c[0] ** 2 + c[1] ** 2;
  return [(a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d];
}

// ---------------- umístění na ploše (společné jádru i rozvinu) ----------------

/** Referenční osa nástroje v rovině plochy: průmět globální X (u ploch kolmých na X průmět Y), otočená o `rotation` kolem normály. */
export function toolAxes(n: Vec3, rotationDeg: number): { u: Vec3; v: Vec3 } {
  const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const k = ref[0] * n[0] + ref[1] * n[1] + ref[2] * n[2];
  let u0: Vec3 = [ref[0] - k * n[0], ref[1] - k * n[1], ref[2] - k * n[2]];
  const l = Math.hypot(...u0) || 1;
  u0 = [u0[0] / l, u0[1] / l, u0[2] / l];
  const v0: Vec3 = [n[1] * u0[2] - n[2] * u0[1], n[2] * u0[0] - n[0] * u0[2], n[0] * u0[1] - n[1] * u0[0]];
  const a = deg(rotationDeg || 0);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const u: Vec3 = [u0[0] * c + v0[0] * s, u0[1] * c + v0[1] * s, u0[2] * c + v0[2] * s];
  const v: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  return { u, v };
}

/** Body umístění z dat: [[x, y], [x, y, z], …] nebo jeden bod [x, y] / [x, y, z]. */
export function formPoints(v: unknown): number[][] {
  if (!Array.isArray(v) || !v.length) return [];
  if (v.every((x) => typeof x === "number")) {
    if (v.length === 2 || v.length === 3) return [v as number[]];
    throw new Error(tr("Body umístění zadejte jako [[x, y], [x, y]] nebo [[x, y, z], …]."));
  }
  return v.map((p) => {
    if (!Array.isArray(p) || (p.length !== 2 && p.length !== 3) || !p.every((x) => typeof x === "number" && Number.isFinite(x))) throw new Error(tr("Bod umístění musí mít dvě nebo tři čísla (x, y [, z])."));
    return p as number[];
  });
}

/**
 * Bod na rovině plochy (počátek o, normála n): 3D bod se promítne kolmo na rovinu; 2D bod [a, b] jsou souřadnice v globální
 * rovině nejvíc kolmé na normálu (u plochy kolmé na Z = x, y; kolmé na Y = x, z; kolmé na X = y, z) a chybějící
 * souřadnice se dopočte z roviny plochy.
 */
export function pointOnPlane(p: number[], o: Vec3, n: Vec3): Vec3 {
  if (p.length >= 3) {
    const d = (p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1] + (p[2] - o[2]) * n[2];
    return [p[0] - d * n[0], p[1] - d * n[1], p[2] - d * n[2]];
  }
  const k = [0, 1, 2].reduce((a, b) => (Math.abs(n[b]) > Math.abs(n[a]) ? b : a), 0);
  const [i, j] = k === 0 ? [1, 2] : k === 1 ? [0, 2] : [0, 1];
  const q: Vec3 = [0, 0, 0];
  q[i] = p[0];
  q[j] = p[1];
  // n·(q − o) = 0 → q[k]
  q[k] = o[k] - ((q[i] - o[i]) * n[i] + (q[j] - o[j]) * n[j]) / n[k];
  return q;
}

/**
 * Stopa nástroje pro rozvin v lokálních souřadnicích (x podél u, y podél v): obrys tvarované oblasti, štěrbiny prostřihu
 * a (lem díry) průměr díry a orientační předděr. Bez tloušťky skořepiny – jen čáry pro vrstvu FORM.
 */
export function formFootprint(tool: Exclude<FormTool, "bead">, d: Data, t: number, sheetR: number): { outline: Seg[]; slits: Seg[]; circles: { r: number; note?: string }[]; sec: FormSection; preHole?: number } {
  const sec = formSection(tool, d, t, sheetR);
  if (sec.mode === "revolve") {
    const r = sec.s1;
    const circles: { r: number; note?: string }[] = [];
    let preHole: number | undefined;
    if (tool === "collar") {
      const dm = formDims(d, t);
      // orientační předděr lemu (zachování objemu na neutrální vrstvě): d0 = dm − 2·(h − 0,43·r − 0,72·t), h = výška od spodní plochy
      const dmean = dm.diameter + t;
      const h = dm.height + t;
      preHole = Math.max(0, dmean - 2 * (h - 0.43 * sec.R - 0.72 * t));
      circles.push({ r: dm.diameter / 2 });
      if (preHole > 0) circles.push({ r: preHole / 2, note: "pre" });
    }
    return { outline: circleSegs([0, 0], r), slits: [], circles, sec, preHole };
  }
  const map = (s: number, a: number): Vec2 => (sec.sAcross ? [a, sec.sSign * s] : [sec.sSign * s, a]);
  const rect = (s0: number, s1: number, a0: number, a1: number): Seg[] => {
    const p = [map(s0, a0), map(s1, a0), map(s1, a1), map(s0, a1)];
    return p.map((q, i) => ({ kind: "line", a: q, b: p[(i + 1) % 4] }) as Seg);
  };
  const outline = rect(sec.s0, sec.s1, sec.a0, sec.a1);
  const slits: Seg[] = sec.slits.map(([a, b]) => ({ kind: "line", a: map(a[0], a[1]), b: map(b[0], b[1]) }));
  return { outline, slits, circles: [], sec };
}

export function circleSegs(c: Vec2, r: number): Seg[] {
  return [
    { kind: "arc", a: [c[0] + r, c[1]], m: [c[0], c[1] + r], b: [c[0] - r, c[1]] },
    { kind: "arc", a: [c[0] - r, c[1]], m: [c[0], c[1] - r], b: [c[0] + r, c[1]] },
  ];
}

/** Krátký popis nástroje pro tabulku a stav (např. „žaluzie 40 × 8 × 4 mm, otevřená vlevo“). */
export function formSummary(tool: FormTool, d: Data, t: number): string {
  const dm = formDims(d, t);
  switch (tool) {
    case "louvre":
      return tr("žaluzie {0} × {1} × {2} mm, otevřená {3}", fmt(dm.length), fmt(dm.width), fmt(dm.height), dm.open === "right" ? tr("vpravo") : tr("vlevo"));
    case "dimple":
      return tr("prolis Ø{0} hl. {1} mm, stěna {2}°{3}", fmt(dm.diameter), fmt(dm.height), fmt(dm.wallAngle), dm.rounded ? "" : tr(", ostrý"));
    case "bead":
      return tr("žebro š. {0} v. {1} mm, stěna {2}°", fmt(dm.width), fmt(dm.height), fmt(dm.wallAngle));
    case "lance":
      return tr("výstřih {0} × {1} mm, výška {2} mm, náběh {3}°", fmt(dm.length), fmt(dm.width), fmt(dm.height), fmt(dm.wallAngle));
    case "bridge":
      return tr("můstek {0} × {1} mm, výška {2} mm, náběh {3}°", fmt(dm.length), fmt(dm.width), fmt(dm.height), fmt(dm.wallAngle));
    case "collar":
      return tr("lem díry Ø{0} mm, výška límce {1} mm", fmt(dm.diameter), fmt(dm.height));
    case "cardguide":
      return tr("vodítko desky {0} × {1} mm, mezera {2} mm", fmt(dm.length), fmt(dm.width), fmt(dm.slot));
  }
}

// ---------------- dráha žebra ----------------

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export type PathSeg = { kind: "line"; a: Vec3; b: Vec3 } | { kind: "arc"; a: Vec3; m: Vec3; b: Vec3; c: Vec3; r: number; ccw: boolean; angle: number };
export type Chain = { segs: PathSeg[]; closed: boolean };

/** Segmenty dráhy ze skici (úsečky, lomené čáry, oblouky, kružnice), seřazené do navazujících řetězců. */
export function sketchChains(sk: Extract<Feature, { type: "sketch" }>, toFace: (p: Vec3) => Vec3, n: Vec3): Chain[] {
  const raw: PathSeg[] = [];
  const w = (p: Vec2) => toFace(toWorld(sk.plane, p));
  const arcOf = (a3: Vec3, m3: Vec3, b3: Vec3): PathSeg | null => {
    // střed kružnice třemi body v rovině plochy
    const ab = sub3(b3, a3);
    const am = sub3(m3, a3);
    const nn = cross3(am, ab);
    const den = 2 * dot3(nn, nn);
    if (den < 1e-18) return { kind: "line", a: a3, b: b3 };
    const c = add3(a3, mul3(add3(mul3(cross3(nn, am), dot3(ab, ab)), mul3(cross3(ab, nn), dot3(am, am))), 1 / den));
    const r = Math.hypot(...sub3(a3, c));
    const ccw = dot3(nn, n) > 0;
    const ang = (p: Vec3) => {
      const x = norm3(sub3(a3, c));
      const y = cross3(n, x);
      const d = sub3(p, c);
      return Math.atan2(dot3(d, y), dot3(d, x));
    };
    let angle = ang(b3);
    if (ccw && angle <= 0) angle += 2 * Math.PI;
    if (!ccw && angle >= 0) angle -= 2 * Math.PI;
    return { kind: "arc", a: a3, m: m3, b: b3, c, r, ccw, angle: Math.abs(angle) };
  };
  for (const e of pathEntities(sk.entities)) {
    if (e.construction) continue;
    if (e.type === "line") raw.push({ kind: "line", a: w(e.a), b: w(e.b) });
    else if (e.type === "polyline") {
      const ps = e.points.map(w);
      for (let i = 0; i < ps.length - 1; i++) raw.push({ kind: "line", a: ps[i], b: ps[i + 1] });
      if (e.closed && ps.length > 2) raw.push({ kind: "line", a: ps[ps.length - 1], b: ps[0] });
    } else if (e.type === "arc") {
      const s = arcOf(w(e.a), w(e.b), w(e.c));
      if (s) raw.push(s);
    } else if (e.type === "circle") {
      const P = (k: number): Vec3 => w([e.cx + e.r * Math.cos(k), e.cy + e.r * Math.sin(k)]);
      const s1 = arcOf(P(0), P(Math.PI / 2), P(Math.PI));
      const s2 = arcOf(P(Math.PI), P((3 * Math.PI) / 2), P(2 * Math.PI));
      if (s1) raw.push(s1);
      if (s2) raw.push(s2);
    } else if (e.type === "spline" || e.type === "ellipse") throw new Error(tr("Žebro: dráha může obsahovat úsečky, lomené čáry, oblouky a kružnice (spline a elipsu nahraďte oblouky)."));
  }
  if (!raw.length) throw new Error(tr("Žebro: skica dráhy neobsahuje úsečku ani oblouk."));
  const same = (p: Vec3, q: Vec3) => Math.hypot(...sub3(p, q)) < 1e-4;
  const rev = (s: PathSeg): PathSeg => (s.kind === "line" ? { kind: "line", a: s.b, b: s.a } : { ...s, a: s.b, b: s.a, ccw: !s.ccw });
  const left = [...raw];
  const chains: Chain[] = [];
  while (left.length) {
    const segs = [left.shift()!];
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const s = left[i];
        const end = segs[segs.length - 1].b;
        const start = segs[0].a;
        if (same(s.a, end)) segs.push(s);
        else if (same(s.b, end)) segs.push(rev(s));
        else if (same(s.b, start)) segs.unshift(s);
        else if (same(s.a, start)) segs.unshift(rev(s));
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    chains.push({ segs, closed: segs.length > 1 && same(segs[0].a, segs[segs.length - 1].b) });
  }
  return chains;
}

export const tangentAt = (s: PathSeg, end: boolean, n: Vec3): Vec3 => {
  if (s.kind === "line") return norm3(sub3(s.b, s.a));
  const p = end ? s.b : s.a;
  const rad = norm3(sub3(p, s.c));
  return s.ccw ? cross3(n, rad) : cross3(rad, n);
};
