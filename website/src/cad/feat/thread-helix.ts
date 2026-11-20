/**
 * Skutečná šroubovice závitu (profil Závit 60°) – jedno jádro pro Tažení po šroubovici (`surf.helixSweep`, ext/surface.ts)
 * i pro prvek Závit se šroubovicí (`závit M18×1,5 délka 20 šroubovice`, build.ts) – vlna 22, bod 22d „propojit cesty“.
 *
 * A kontrola, že drážka opravdu řeže povrch, na kterém závit má vzniknout (bod 22a: „Špička profilu tečná k povrchu“ dávala
 * tichý ✓; 22b případ H: drážka celá ve stěně díry = skrytý kanál s ✓). `threadReach` vezme těleso PŘED prvkem a v ~12 místech
 * šroubovice zjistí, kde leží základna a špička profilu (uvnitř materiálu / ve vzduchu, vzdálenost špičky od povrchu):
 *  – odebrání: základna má být ve vzduchu (0,15 mm nad povrchem), špička v materiálu;
 *    špička do 0,01 mm od povrchu → ⚠ `thread.tip-tangent`; základna i špička v materiálu → ⚠ `thread.no-reach`
 *    („drážka nezasahuje do válcové plochy díry“); základna v materiálu a špička ve vzduchu → ⚠ `thread.wrong-side`
 *    (drážka ústí do povrchu jen špičkou – obrácená strana);
 *  – přidání (hřbet): základna má být v materiálu, špička ve vzduchu – tečná špička / hřbet přichycený jen špičkou → ⚠.
 * Rada v hlášce (side=…, radius=…) vychází z nalezeného poloměru povrchu (hledání podél paprsku profilu).
 * Doplňkově `build.ts` hlídá očekávaný výsledek modelem úrovní G1: drážka závitu má odebrat jen ČÁST nástroje; „celý nástroj“
 * = skrytý kanál → ⚠ `thread.no-reach`, i když sonda neproběhla.
 */
import * as r from "replicad";
import { getLang, tr } from "../i18n";
import { countSub, type Shape } from "../check";
import type { MetricThread } from "../defaults";
import { noteFeatureWarning } from "../feature-notes";
import { helixThreadDims } from "../thread-spec";
import type { Feature, Vec3 } from "../types";

type OC = {
  BRepExtrema_DistShapeShape: new () => { LoadS1(s: unknown): void; LoadS2(s: unknown): void; Perform(p: unknown): boolean; IsDone(): boolean; Value(): number; InnerSolution(): boolean; delete(): void };
  Message_ProgressRange: new () => unknown;
};
const oc = () => r.getOC() as unknown as OC;
const DEG = Math.PI / 180;
const vec = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const scaleV = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const addV = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** zadání drážky: poloměr povrchu R, hloubka do materiálu, stoupání, otáčky, střed začátku, osa, strana a operace */
export type GrooveSpec = { R: number; depth: number; pitch: number; turns: number; center: Vec3; dir: Vec3; lefthand: boolean; internal: boolean; removing: boolean };
export type Groove = {
  /** těleso drážky (nástroj) */
  groove: Shape;
  helix: r.Wire;
  /** bod šroubovice v otáčce `u` (0…turns): osová souřadnice a jednotkový radiální směr */
  helixAt: (u: number) => { z: number; rad: Vec3 };
  /** směr od povrchu do materiálu (+1 = ven od osy, −1 = k ose) – u odebrání; u přidání opačně */
  inward: number;
  /** poloměr základny profilu (0,15 mm za povrchem) a špičky (v hloubce) */
  baseR: number;
  tipR: number;
};

/** Profil Závit 60° u začátku šroubovice (trojúhelník: základna 0,15 mm za povrchem, špička v hloubce `depth`). */
export function threadProfileWire(helix: r.Wire, s: Pick<GrooveSpec, "center" | "dir" | "depth" | "pitch" | "internal" | "removing">): r.Wire {
  const { center, dir, pitch: p } = s;
  const start = vec(helix.startPoint);
  const radial = norm([start[0] - center[0], start[1] - center[1], start[2] - center[2]].map((v, i) => v - dir[i] * (dir[0] * (start[0] - center[0]) + dir[1] * (start[1] - center[1]) + dir[2] * (start[2] - center[2]))) as Vec3);
  const h = s.depth;
  if (!(h > 0)) throw new Error(tr("Hloubka závitu musí být kladná."));
  const half = Math.min(p * 0.45, h * Math.tan(30 * DEG) + 0.05 * p);
  // Trojúhelník profilu: základna 0,15 mm „za“ povrchem (ve vzduchu u odebrání, v materiálu u přidání), špička v hloubce h.
  // Vnější závit: materiál uvnitř poloměru R (válec) → odebrání směřuje dovnitř, přidání ven.
  // Vnitřní závit: materiál vně poloměru R (díra) → odebrání směřuje ven (do stěny díry), přidání dovnitř.
  const inward = (s.removing ? -1 : 1) * (s.internal ? -1 : 1);
  const P = (rad: number, ax: number): Vec3 => addV(addV(start, scaleV(radial, rad)), scaleV(dir, ax));
  const a = P(-0.15 * inward, -half);
  const b = P(-0.15 * inward, half);
  const c = P(h * inward, 0);
  return r.assembleWire([r.makeLine(a, b), r.makeLine(b, c), r.makeLine(c, a)]);
}

/** tažení profilu po šroubovici (Frenet – profil zůstává v rovině procházející osou) */
export function sweepOnHelix(helix: r.Wire, wire: r.Wire): Shape {
  let solid: Shape;
  try {
    solid = r.genericSweep(wire, helix, { frenet: true }, false) as Shape;
  } catch {
    throw new Error(tr("Tažení po šroubovici se nepodařilo – profil se nesmí protínat sám se sebou (zmenšete profil nebo zvětšete stoupání)."));
  }
  if (!(Math.abs(r.measureVolume(solid)) > 1e-6)) throw new Error(tr("Tažení po šroubovici nevytvořilo objem – profil musí být uzavřený."));
  return solid;
}

/** šroubovice a funkce bodu na ní (sdílí drážka, náběh i kontrola) */
export function helixOf(s: Pick<GrooveSpec, "R" | "pitch" | "turns" | "center" | "dir" | "lefthand">): { helix: r.Wire; helixAt: Groove["helixAt"] } {
  const { R, pitch: p, turns: t, center, dir } = s;
  const helix = r.makeHelix(p, p * t, R, center, dir, s.lefthand);
  const helixAt = (u: number) => {
    const P = vec(helix.pointAt(Math.max(0, Math.min(1, u / t))));
    const rel: Vec3 = [P[0] - center[0], P[1] - center[1], P[2] - center[2]];
    const z = rel[0] * dir[0] + rel[1] * dir[1] + rel[2] * dir[2];
    return { z, rad: norm([rel[0] - dir[0] * z, rel[1] - dir[1] * z, rel[2] - dir[2] * z]) };
  };
  return { helix, helixAt };
}

/** Drážka (nebo hřbet) závitu po šroubovici – nástroj, šroubovice a poloměry profilu. */
export function threadGroove(s: GrooveSpec): Groove {
  if (!(s.R > 0 && s.pitch > 0 && s.turns > 0)) throw new Error(tr("Poloměr, stoupání i počet závitů musí být kladné."));
  if (s.turns > 200) throw new Error(tr("Nejvýš 200 závitů."));
  const { helix, helixAt } = helixOf(s);
  const groove = sweepOnHelix(helix, threadProfileWire(helix, s));
  const inward = (s.removing ? -1 : 1) * (s.internal ? -1 : 1);
  return { groove, helix, helixAt, inward, baseR: s.R - 0.15 * inward, tipR: s.R + s.depth * inward };
}

/* ───────────────────────── kontrola: drážka řeže povrch ───────────────────────── */

export type ReachKind = "ok" | "tip-tangent" | "no-reach" | "wrong-side";
export type Reach = {
  kind: ReachKind;
  /** počet míst šroubovice, kde profil zasahuje do tělesa (bez míst mimo těleso – např. za koncem válce) */
  relevant: number;
  bad: number;
  /** nalezený poloměr povrchu (paprsek profilu) – pro radu v hlášce */
  surfaceR?: number;
  /** jak daleko za povrch sahá špička u „wrong-side“ (mm) */
  cross?: number;
};
const TANGENT_TOL = 0.01;
const BAD_SHARE = 0.3;

function withDist<T>(load: unknown, p: Vec3, f: (q: InstanceType<OC["BRepExtrema_DistShapeShape"]>) => T, dflt: T): T {
  const o = oc();
  const v = r.makeVertex(p);
  const q = new o.BRepExtrema_DistShapeShape();
  try {
    q.LoadS1(load);
    q.LoadS2(v.wrapped);
    q.Perform(new o.Message_ProgressRange());
    return q.IsDone() ? f(q) : dflt;
  } catch {
    return dflt;
  } finally {
    q.delete();
    v.delete();
  }
}

/** Sonda tělesa: bod uvnitř materiálu? a vzdálenost bodu od povrchu tělesa (ploch). */
export function bodyProbe(body: Shape): { inside: (p: Vec3) => boolean; dist: (p: Vec3) => number; dispose: () => void } {
  const solids = body.solids.map((s) => s.wrapped);
  const faces = r.makeCompound(body.faces);
  return {
    inside: (p) => solids.some((s) => withDist(s, p, (q) => q.Value() < 1e-7 && q.InnerSolution(), false)),
    dist: (p) => withDist(faces.wrapped, p, (q) => Number(q.Value()), Infinity),
    dispose: () => {
      try {
        faces.delete();
      } catch {
        /* už uvolněno */
      }
    },
  };
}

/**
 * Leží drážka závitu na povrchu, který má řezat? `body` = těleso před prvkem. Vrací druh nálezu, počty míst a nalezený
 * poloměr povrchu. `faces` = počet ploch tělesa (u velkých těles méně míst – cena kontroly).
 */
export function threadReach(body: Shape, s: GrooveSpec, g: Pick<Groove, "helixAt" | "baseR" | "tipR" | "inward">, faces = 0): Reach {
  const probe = bodyProbe(body);
  try {
    const t = s.turns;
    const [u0, u1] = t > 1 ? [0.5, t - 0.5] : [0.15 * t, 0.85 * t];
    const n = Math.max(3, Math.min(faces > 400 ? 6 : 12, Math.ceil(t * 4) + 2));
    const at = (u: number, rr: number): Vec3 => {
      const { z, rad } = g.helixAt(u);
      return addV(addV(s.center, scaleV(rad, rr)), scaleV(s.dir, z));
    };
    let relevant = 0;
    const count = { tangent: 0, buried: 0, wrong: 0 };
    let first: { u: number; kind: keyof typeof count } | null = null;
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? (u0 + u1) / 2 : u0 + ((u1 - u0) * k) / (n - 1);
      const bIn = probe.inside(at(u, g.baseR));
      const tIn = probe.inside(at(u, g.tipR));
      const tD = probe.dist(at(u, g.tipR));
      if (!(bIn || tIn || tD <= TANGENT_TOL)) continue; // tady profil s tělesem nesouvisí (za koncem válce, mimo těleso)
      relevant++;
      let kind: keyof typeof count | null = null;
      if (tD <= TANGENT_TOL) kind = "tangent";
      else if (s.removing && bIn && tIn) kind = "buried";
      else if (s.removing ? bIn && !tIn : !bIn && tIn) kind = "wrong";
      if (kind) {
        count[kind]++;
        first ??= { u, kind };
      }
    }
    const share = (c: number) => relevant > 0 && c / relevant >= BAD_SHARE;
    const kind: ReachKind = share(count.tangent) ? "tip-tangent" : share(count.buried) ? "no-reach" : share(count.wrong) ? "wrong-side" : "ok";
    const bad = kind === "tip-tangent" ? count.tangent : kind === "no-reach" ? count.buried : kind === "wrong-side" ? count.wrong : 0;
    if (kind === "ok" || !first) return { kind, relevant, bad };
    // poloměr povrchu podél paprsku profilu v místě prvního nálezu
    const u = first.u;
    const inR = (rr: number) => probe.inside(at(u, rr));
    const bisect = (a: number, b: number) => {
      // a = v materiálu, b = ve vzduchu
      for (let i = 0; i < 30 && Math.abs(b - a) > 1e-4; i++) {
        const m = (a + b) / 2;
        if (inR(m)) a = m;
        else b = m;
      }
      return (a + b) / 2;
    };
    let surfaceR: number | undefined;
    let cross: number | undefined;
    if (kind === "tip-tangent") surfaceR = g.tipR;
    else if (kind === "wrong-side") {
      surfaceR = s.removing ? bisect(g.baseR, g.tipR) : bisect(g.tipR, g.baseR);
      cross = Math.abs(g.tipR - surfaceR);
    } else {
      // skrytý kanál: povrch hledat od základny na stranu „vzduchu“ (proti směru do materiálu)
      const away = -g.inward;
      const step = Math.max(0.05, s.depth / 2);
      let a = g.baseR;
      for (let i = 1; i <= 60; i++) {
        const b = g.baseR + away * step * i;
        if (b <= 1e-3) break;
        if (!inR(b)) {
          surfaceR = bisect(a, b);
          break;
        }
        a = b;
      }
    }
    return { kind, relevant, bad, ...(surfaceR !== undefined ? { surfaceR } : {}), ...(cross !== undefined ? { cross } : {}) };
  } finally {
    probe.dispose();
  }
}

const mm = (v: number, digits = 3) => {
  const k = 10 ** digits;
  const s = String(Math.round(v * k) / k);
  return getLang() === "en" ? s : s.replace(".", ",");
};
/** poloměr / průměr nalezeného povrchu pro radu (hledání podél paprsku má přesnost ~0,001 mm – rada na setiny) */
const mm2 = (v: number) => mm(v, 2);

/**
 * Hláška ⚠ k nálezu kontroly (null u „ok“). `designation` = drážka z katalogového označení (prvek Závit se šroubovicí,
 * Tažení po šroubovici s `thread=`): rada pak mluví o průměru díry / válce, ne o poloměru šroubovice.
 */
export function reachNote(reach: Reach, s: GrooveSpec, designation?: { name: string; d: number; tap: number }): { code: string; text: string } | null {
  if (reach.kind === "ok") return null;
  let hint: string;
  if (designation) {
    hint = s.internal
      ? tr("Vnitřní závit {0} potřebuje díru vrtanou na Ø{1} (vrták závitu) – zkontrolujte průměr díry a polohu závitu.", designation.name, mm(designation.tap))
      : tr("Vnější závit {0} patří na válec Ø{1} – zkontrolujte průměr válce a polohu závitu.", designation.name, mm(designation.d));
  } else if (reach.surfaceR !== undefined && s.removing) {
    const sR = reach.surfaceR;
    // ve všech třech nálezech leží základna profilu v materiálu: základna dál od osy než povrch = materiál vně = díra (vnitřní závit)
    const inward = (s.removing ? -1 : 1) * (s.internal ? -1 : 1);
    const isHole = s.R - 0.15 * inward > sR;
    hint = tr("Závit {0} Ø{1}: zadejte side={2} a radius={3} (poloměr povrchu, na kterém závit začíná; hloubka jde do materiálu).", isHole ? tr("v díře") : tr("na válci"), mm2(2 * sR), isHole ? "internal" : "external", mm2(sR));
  } else hint = tr("Poloměr musí být poloměr povrchu, na kterém závit začíná (válec u side=external, díra u side=internal); hloubka jde do materiálu.");
  if (reach.kind === "tip-tangent") return { code: "thread.tip-tangent", text: tr("špička profilu závitu je tečná k povrchu Ø{0} – drážka do materiálu nezasahuje, vznikne skrytý kanál, ne závit. {1}", mm2(2 * (reach.surfaceR ?? s.R)), hint) };
  if (reach.kind === "no-reach") return { code: "thread.no-reach", text: tr("drážka závitu nezasahuje do válcové plochy díry ani válce – leží celá v materiálu (skrytý kanál, ústí jen do čel). {0}", hint) };
  return { code: "thread.wrong-side", text: tr("drážka závitu ústí do povrchu Ø{0} jen špičkou ({1} mm z hloubky {2} mm), zbytek leží v materiálu – profil míří na opačnou stranu. {3}", mm2(2 * (reach.surfaceR ?? s.R)), mm(reach.cross ?? 0), mm(s.depth), hint) };
}

/**
 * Prvek Závit se šroubovicí (`závit M18×1,5 délka 20 šroubovice`): drážka z označení (thread-spec.ts `helixThreadDims` –
 * stejná čísla jako Tažení po šroubovici s `thread=`), profil celý v délce závitu L (šroubovice začíná o půl šířky profilu
 * za začátkem a končí o půl šířky před koncem), u tělesa kontrola, že drážka řeže povrch. `at` / `dir` = vyřešená poloha a osa.
 */
export function threadHelixTool(f: Extract<Feature, { type: "thread" }>, t: MetricThread, body: Shape | null, at: Vec3, dir0: Vec3): Shape {
  const internal = !!f.internal;
  const dims = helixThreadDims(t, internal);
  const dir = norm(dir0);
  const half = Math.min(dims.pitch * 0.45, dims.depth * Math.tan(30 * DEG) + 0.05 * dims.pitch);
  const turns = (f.length - 2 * half) / dims.pitch;
  if (!(turns > 0.05)) throw new Error(tr("Závit {0} je kratší než jeden profil ({1} mm) – zadejte delší závit.", t.name, mm(2 * half)));
  const center = addV(at, scaleV(dir, half));
  const spec: GrooveSpec = { R: dims.radius, depth: dims.depth, pitch: dims.pitch, turns, center, dir, lefthand: false, internal, removing: true };
  const g = threadGroove(spec);
  if (body) {
    const note = reachNote(threadReach(body, spec, g, countSub(body, "FACE")), spec, { name: t.name, d: t.d, tap: t.tap });
    if (note) noteFeatureWarning(note.text, note.code);
  }
  return g.groove;
}

/** text záchranné kontroly v build.ts: drážka závitu odebrala celý nástroj (model úrovní G1 – očekávaná „část nástroje“) */
export const hiddenGrooveText = (): string =>
  tr("drážka závitu odebrala celý nástroj – leží celá v materiálu a nezasahuje do válcové plochy díry ani válce (skrytý kanál, ne závit); poloměr = povrch, na kterém závit začíná (válec u vnějšího, díra u vnitřního).");
