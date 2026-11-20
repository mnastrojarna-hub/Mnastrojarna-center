/**
 * Vůle a spojitá kontrola kolizí v pohybové studii (vlna 22, bod 6 zprávy majitele – „Bez kolizí“ není kontrola provozní vůle).
 *
 * Dřív se kolize kontrolovaly jen v polohách kroků: nůž tloušťky 1 mm projel kolíkem Ø2 mezi kroky 5 mm od sebe a studie hlásila
 * „Kolize: žádné ve všech krocích“. Tento modul (čistý, jádro dodá `ClearanceEnv.clearance` – cad/clearance-kernel.ts) dělá pro
 * každý úsek mezi dvěma polohami:
 *
 *  1. **výběr dvojic**: komponenty nejvyšší úrovně se vzájemným pohybem v úseku, jejichž obálky dráhy (polohy na koncích a v půlce
 *     úseku, zvětšené o průhyb oblouku při natáčení) se mohou dotknout; sledované dvojice vůle (`MotionStudy.clearance.pairs`) vždy;
 *  2. **mez posunu** (konzervativní postup): bod B se vůči A posune nejvýš o δ = |Δ středu obálky B| · (oblouk / tětiva) + θ · r_B
 *     (přes polovinu úseku, je-li k dispozici); je-li δ < d(začátek) + d(konec), dvojice se v úseku dotknout nemůže a vzdálenost
 *     v úseku je nejméně (d₁ + d₂ − δ) / 2 – spojitě dokázáno bez dalších výpočtů;
 *  3. **čistý posuv** (stejné vzájemné natočení na koncích i v půlce, půlka na úsečce): jádro spočítá přesnou nejmenší vzdálenost od
 *     dráhy B (hranoly ploch) – průchod tenkého dílu mezi polohami se tím najde vždy;
 *  4. **jinak půlení**: mezipoloha z řešiče (kinematika; v dynamice zaznamenaný snímek), do hloubky `depth` a v rozpočtu poloh;
 *     co se nepotvrdí, je výslovně „nepotvrzeno“ (výsledek nikdy neříká „spojitě“, když to neplatí);
 *  5. **kontakt mezi polohami**: první mezipoloha s průnikem se zkontroluje kolizemi (`collide` – třída a místo jako v krocích) a jde
 *     do `between` (⚠ v souhrnu „mezi kroky 17 a 18“).
 *
 * Sledovaná vůle: vzdálenost dvojice v každé poloze, zjemnění tam, kde by mezi polohami mohla být menší (rychlý pokles, přehození
 * stran), nejmenší hodnota s místem (body), krokem / polohou, časem a motory, polohy pod limitem.
 */
import { rotMatrix } from "./assembly";
import type { ClrDist, ClrLocal, ClrPose, ClrReq, ClrRes } from "./clearance-types";
import type { MotionClashes, MotionCollision, MotionResult, MotionStep } from "./motion";
import type { CadDoc, MotionStudy, Placement, Vec3 } from "./types";

/* ───────────────────────── typy výsledku ───────────────────────── */

/** nejmenší vůle dvojice: vzdálenost, poloha (krok, u zjemnění zlomek kroku), čas, motory, nejbližší body ve světě, cesty listů */
export type ClearanceMin = {
  d: number;
  exact: boolean;
  /** poloha v krocích (17,5 = v půlce mezi kroky 17 a 18) */
  pos: number;
  t: number;
  motors: number[];
  p1?: Vec3;
  p2?: Vec3;
  aPath?: string[];
  bPath?: string[];
  /** minimum leží mezi dvěma kroky (zjemnění / dráha posuvu) */
  between?: [number, number];
  /** z dráhy posuvu (přesné minimum po přímé dráze, poloha v úseku nezjištěna) */
  sweep?: boolean;
};
export type ClearancePair = {
  a: string;
  b: string;
  min: ClearanceMin | null;
  /** vzdálenost v krocích (index = krok; null = nepočítáno – dvojice se v kroku nepohnula / mimo dosah) */
  series: (number | null)[];
  /** nejbližší body v krocích (úsečka vůle ve 3D) */
  pts: ([Vec3, Vec3] | null)[];
  /** kroky pod limitem */
  below: number[];
  /** průnik v některé poloze (vzdálenost 0) */
  contact?: boolean;
  /** úseky, kde zjemnění nepotvrdilo, že vůle mezi polohami neklesne pod nalezené minimum (mez hloubky / rozpočtu) */
  unproven: number;
};
export type ClearanceResult = {
  /** limit [mm]; null = jen nejmenší vůle bez limitu */
  limit: number | null;
  /** „moving“ = pohyblivé vůči ostatním (dvojice blíž než limit + rezerva) */
  moving: boolean;
  pairs: ClearancePair[];
  /** kontrolované polohy (kroky / snímky) a polohy navíc ze zjemnění */
  poses: number;
  refined: number;
  /** vzdálenost, do které se dvojice „pohyblivých“ počítaly přesně (dál = vůle nejméně tolik) */
  reach?: number;
};
/** spojitost kontroly kolizí: continuous = všechny úseky dokázány; partial = některé nepotvrzeny; discrete = jen v polohách */
export type SweepInfo = {
  mode: "continuous" | "partial" | "discrete";
  /** proč diskrétně: vypnuto (`kolize diskrétně`), jádro bez operace */
  why?: "off" | "no-kernel";
  /** kontrolované polohy (kroky / snímky s kontrolou) a polohy navíc ze zjemnění */
  poses: number;
  refined: number;
  /** úseky: dokázané mezí posunu, dráhou posuvu, s nalezeným kontaktem, s průnikem hlášeným už v kroku, nepotvrzené */
  bounded: number;
  swept: number;
  contacts: number;
  covered: number;
  unproven: number;
  /** nepotvrzené úseky: kvůli dotyku v poloze (posuvné vedení v dotyku), mezi zjemnění / rozpočtu */
  unprovenContact: number;
  /** první nepotvrzené úseky (začátek úseku) */
  unprovenAt: number[];
  /** největší posun komponenty mezi sousedními polohami [mm] a natočení [°] */
  maxStep: number;
  maxTurn: number;
  /** mezipolohy: řešič (kinematika) / zaznamenané snímky (dynamika) / jen konce úseku */
  between: "solver" | "frames" | "none";
  /** rozpočet zjemnění vyčerpán */
  budget?: boolean;
};
/** kontakt nalezený mezi polohami: úsek, poloha (zlomek kroku), čas, motory, dvojice a zařazené kolize v té poloze */
export type BetweenHit = { k0: number; k1: number; pos: number; t: number; motors: number[]; a: string; b: string; p?: Vec3; clashes: MotionCollision[] };
/** rozšíření výsledku studie (motion.ts `MotionResult` se nemění – pole přidává tento modul) */
export type ClearanceExt = { clearance?: ClearanceResult; sweep?: SweepInfo; between?: BetweenHit[] };
export type MotionResultC = MotionResult & ClearanceExt;
export const clearanceOf = (res: MotionResult | null | undefined): ClearanceExt => (res ?? {}) as ClearanceExt;

/** jádro a kolize pro kontrolu (AsmEnv) */
export type ClearanceEnv = { clearance?: (req: ClrReq) => Promise<ClrRes>; collide?: (d: CadDoc) => Promise<MotionClashes> };
/** mezipoloha úseku v čase t: řešič vazeb (kinematika) nebo zaznamenaný snímek (dynamika); null = nejde */
export type PoseAt = (t: number) => { place: Record<string, Placement>; motors: number[]; t?: number } | null;

/* ───────────────────────── geometrie polohy ───────────────────────── */

type Rt = { R: number[]; t: Vec3 };
const rtOfPl = (p: Placement): Rt => ({ R: rotMatrix(p.rotation) as unknown as number[], t: [p.position[0], p.position[1], p.position[2]] });
const apR = (R: number[], v: Vec3): Vec3 => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const apRT = (R: number[], v: Vec3): Vec3 => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
/** A⁻¹∘B */
function relRt(A: Rt, B: Rt): Rt {
  const R = new Array<number>(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[i * 3 + j] = A.R[i] * B.R[j] + A.R[3 + i] * B.R[3 + j] + A.R[6 + i] * B.R[6 + j];
  return { R, t: apRT(A.R, [B.t[0] - A.t[0], B.t[1] - A.t[1], B.t[2] - A.t[2]]) };
}
/** úhel mezi dvěma natočeními [rad] */
function angleBetween(A: number[], B: number[]): number {
  let tr = 0;
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) tr += A[k * 3 + i] * B[k * 3 + i];
  return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
}
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
type Box = [Vec3, Vec3];
function worldBox([lo, hi]: Box, m: Rt): Box {
  const out: Box = [
    [Infinity, Infinity, Infinity],
    [-Infinity, -Infinity, -Infinity],
  ];
  for (let c = 0; c < 8; c++) {
    const v = apR(m.R, [c & 1 ? hi[0] : lo[0], c & 2 ? hi[1] : lo[1], c & 4 ? hi[2] : lo[2]]);
    for (let i = 0; i < 3; i++) {
      const w = v[i] + m.t[i];
      if (w < out[0][i]) out[0][i] = w;
      if (w > out[1][i]) out[1][i] = w;
    }
  }
  return out;
}
const growBox = (a: Box, b: Box): Box => [
  [Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1]), Math.min(a[0][2], b[0][2])],
  [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1]), Math.max(a[1][2], b[1][2])],
];
const padBox = (b: Box, e: number): Box => [
  [b[0][0] - e, b[0][1] - e, b[0][2] - e],
  [b[1][0] + e, b[1][1] + e, b[1][2] + e],
];
function boxGap(a: Box, b: Box): number {
  let s = 0;
  for (let i = 0; i < 3; i++) {
    const g = Math.max(0, a[0][i] - b[1][i], b[0][i] - a[1][i]);
    s += g * g;
  }
  return Math.sqrt(s);
}

/**
 * Mez posunu bodů B vůči A mezi dvěma vzájemnými polohami (`r0` → `r1`, B v souřadnicích A): posun středu obálky B (tětiva ×
 * poměr oblouku k tětivě při natočení θ) + θ · r (oblouk bodu na obálce). Pro přímý posuv přesná, pro natáčení horní mez za
 * předpokladu, že se pohyb mezi polohami nevrací (proto se úseky měří přes polovinu).
 */
export function moveBound(r0: Rt, r1: Rt, sphere: { c: Vec3; r: number }): number {
  const th = angleBetween(r0.R, r1.R);
  const c0 = apR(r0.R, sphere.c);
  const c1 = apR(r1.R, sphere.c);
  const chord = len([c1[0] + r1.t[0] - c0[0] - r0.t[0], c1[1] + r1.t[1] - c0[1] - r0.t[1], c1[2] + r1.t[2] - c0[2] - r0.t[2]]);
  const arc = th > 1e-9 ? th / 2 / Math.sin(th / 2) : 1;
  return chord * arc + th * sphere.r;
}

/* ───────────────────────── vzorek (poloha) ───────────────────────── */

/** poloha studie: krok nebo mezipoloha (`pos` = zlomek kroku), umístění komponent, motory, změřené vzdálenosti dvojic */
type Sample = { pos: number; t: number; place: Record<string, Placement>; motors: number[]; dist: Map<string, ClrDist>; /** dvojice s kolizí zjištěnou kontrolou kroku (průnik je už hlášen) */ clash?: Set<string>; rt?: Map<string, Rt> };
const pairKey = (a: string, b: string) => `${a}\u0000${b}`;

/** největší posun a natočení komponenty mezi dvěma polohami (popis „diskrétně po 5 mm“) */
export function stepTravel(a: Record<string, Placement>, b: Record<string, Placement>): { d: number; turn: number } {
  let d = 0;
  let turn = 0;
  for (const id of Object.keys(b)) {
    const p = a[id];
    const q = b[id];
    if (!p || !q) continue;
    d = Math.max(d, len(sub(q.position, p.position)));
    turn = Math.max(turn, (angleBetween(rotMatrix(p.rotation) as unknown as number[], rotMatrix(q.rotation) as unknown as number[]) * 180) / Math.PI);
  }
  return { d, turn };
}

/* ───────────────────────── kontrola ───────────────────────── */

export type ClearanceOptions = {
  /** kontrolovat kolize spojitě mezi polohami (studie s kolizemi) */
  collisions: boolean;
  cancel?: () => boolean;
  /** nejvyšší hloubka půlení úseku (výchozí 6 = 1/64 kroku) */
  depth?: number;
  /** nejvýš tolik mezipoloh za studii (výchozí max(64, 4 × kroků)) */
  budget?: number;
  /** počet kroků studie (rozpočet) */
  steps?: number;
};

/** sledovače studie: `step` po každém kroku (kinematika – mezipolohy z řešiče), `finish` připojí výsledek */
export type ClearanceTracker = {
  /** krok `row` (předchozí `prev`); `poseAt` = mezipoloha úseku (prev, row) */
  step(row: MotionStep, prev: MotionStep | null, poseAt?: PoseAt): Promise<void>;
  /** výsledek studie s poli `clearance`, `sweep`, `between` */
  finish<R extends MotionResult>(res: R): R & ClearanceExt;
};

/**
 * Sledovač vůle a spojité kontroly pro jednu studii; null = nic ke kontrole (bez sledované vůle a bez kolizí). Bez jádra
 * s operací `clearance` nebo s `refine: false` se kolize kontrolují jen v polohách a výsledek to výslovně uvede (`sweep.mode`).
 */
export function clearanceTracker(doc: CadDoc, study: Pick<MotionStudy, "clearance" | "steps">, env: ClearanceEnv, o: ClearanceOptions): ClearanceTracker | null {
  const cfg = study.clearance ?? {};
  const refine = cfg.refine !== false;
  const kernel = env.clearance;
  const wantClr = !!cfg.pairs && (cfg.pairs === "moving" || cfg.pairs.length > 0);
  const wantCC = o.collisions;
  if (!wantClr && !wantCC) return null;
  const limit = cfg.limit !== undefined && cfg.limit >= 0 ? cfg.limit : null;
  const depthMax = o.depth ?? 6;
  let budget = o.budget ?? Math.max(64, 4 * (o.steps ?? study.steps ?? 36));
  const comps = (doc.components ?? []).filter((c) => !c.hidden);
  /** pružiny mění tvar s polohou – spojitě se nekontrolují (jen v polohách), sledovat je jako dvojici vůle lze */
  const springs = new Set(comps.filter((c) => c.spring).map((c) => c.id));
  const docPl = new Map(comps.map((c) => [c.id, c.placement] as const));
  const ids = comps.map((c) => c.id);
  const explicit = Array.isArray(cfg.pairs) ? cfg.pairs.filter((p) => docPl.has(p.a) && docPl.has(p.b) && p.a !== p.b) : [];
  const moving = cfg.pairs === "moving";
  /** „pohyblivé“: přesně do limitu + rezervy, dál stačí dolní mez z obálek */
  const reach = moving ? Math.max(1, (limit ?? 0) * 2 + 1) : Infinity;
  const tolC = Math.max(1e-4, 0.01 * (limit ?? 0.1));
  const local = new Map<string, ClrLocal>();
  const pairs = new Map<string, ClearancePair>();
  for (const p of explicit) pairs.set(pairKey(p.a, p.b), { a: p.a, b: p.b, min: null, series: [], pts: [], below: [], unproven: 0 });
  const between: BetweenHit[] = [];
  const info: SweepInfo = { mode: "continuous", poses: 0, refined: 0, bounded: 0, swept: 0, contacts: 0, covered: 0, unproven: 0, unprovenContact: 0, unprovenAt: [], maxStep: 0, maxTurn: 0, between: "none" };
  if (!refine) Object.assign(info, { mode: "discrete", why: "off" } satisfies Partial<SweepInfo>);
  else if (!kernel) Object.assign(info, { mode: "discrete", why: "no-kernel" } satisfies Partial<SweepInfo>);
  const cc = wantCC && refine && !!kernel;
  let prevSample: Sample | null = null;
  let clrPoses = 0;
  let clrRefined = 0;

  const plOf = (s: Sample, id: string): Placement => s.place[id] ?? docPl.get(id)!;
  const rtAt = (s: Sample, id: string): Rt => {
    const m = (s.rt ??= new Map());
    let v = m.get(id);
    if (!v) m.set(id, (v = rtOfPl(plOf(s, id))));
    return v;
  };
  const rel = (s: Sample, a: string, b: string): Rt => relRt(rtAt(s, a), rtAt(s, b));
  const sphere = (id: string) => local.get(id) ?? null;
  /** mez posunu B vůči A z `s0` do `s1` (menší z obou pohledů – obě jsou platné) */
  const bound = (s0: Sample, s1: Sample, a: string, b: string): number => {
    const la = sphere(a);
    const lb = sphere(b);
    if (!la || !lb) return Infinity;
    const ab = moveBound(rel(s0, a, b), rel(s1, a, b), lb);
    const ba = moveBound(rel(s0, b, a), rel(s1, b, a), la);
    return Math.min(ab, ba);
  };
  const boxAt = (s: Sample, id: string): Box | null => {
    const l = sphere(id);
    return l ? worldBox(l.box, rtAt(s, id)) : null;
  };
  /** obálka dráhy komponenty přes polohy (zvětšená o průhyb oblouku při natočení) */
  const pathBox = (ss: Sample[], id: string): Box | null => {
    const l = sphere(id);
    if (!l) return null;
    let out: Box | null = null;
    for (let i = 0; i < ss.length; i++) {
      const b = boxAt(ss[i], id)!;
      out = out ? growBox(out, b) : b;
      if (i > 0) {
        const th = angleBetween(rtAt(ss[i - 1], id).R, rtAt(ss[i], id).R);
        if (th > 1e-9) out = padBox(out, l.r * (1 - Math.cos(Math.min(Math.PI, th) / 2)) + 1e-9);
      }
    }
    return out;
  };
  const moved = (s0: Sample, s1: Sample, a: string, b: string): boolean => {
    const r0 = rel(s0, a, b);
    const r1 = rel(s1, a, b);
    return len(sub(r1.t, r0.t)) > 1e-9 || angleBetween(r0.R, r1.R) > 1e-9;
  };

  /** dotaz do jádra: vzdálenosti dvojic ve vzorcích (dávkou), místní obálky napoprvé */
  const measure = async (want: { s: Sample; a: string; b: string; cutoff: number }[]): Promise<void> => {
    const need = want.filter((w) => !w.s.dist.has(pairKey(w.a, w.b)));
    const first = local.size === 0;
    if (!need.length && !first) return;
    // vzorky jako polohy požadavku: první = dokument požadavku (poloha 0), ostatní = `poses`
    const samples: Sample[] = [];
    for (const w of need) if (!samples.includes(w.s)) samples.push(w.s);
    const base = samples[0] ?? prevSample;
    const req: ClrReq = {
      doc: base ? { ...doc, components: (doc.components ?? []).map((c) => (base.place[c.id] ? { ...c, placement: base.place[c.id] } : c)) } : doc,
      poses: samples.slice(1).map((s) => s.place as ClrPose),
      ...(first ? { local: ids } : {}),
      dist: need.map((w) => ({ a: w.a, b: w.b, pose: Math.max(0, samples.indexOf(w.s)), cutoff: w.cutoff })),
    };
    const res = await kernel!(req);
    if (res.local) for (const [id, l] of Object.entries(res.local)) local.set(id, l);
    need.forEach((w, i) => {
      const d = res.dist?.[i];
      if (d) w.s.dist.set(pairKey(w.a, w.b), d);
    });
  };
  const sweepOf = async (s0: Sample, s1: Sample, a: string, b: string, cutoff: number, touch: boolean) => {
    const req: ClrReq = {
      doc: { ...doc, components: (doc.components ?? []).map((c) => (s0.place[c.id] ? { ...c, placement: s0.place[c.id] } : c)) },
      poses: [s1.place],
      sweep: [{ a, b, from: 0, to: 1, cutoff, ...(touch ? { touch: true } : {}) }],
    };
    return (await kernel!(req)).sweep?.[0] ?? null;
  };
  const sampleOf = (r: { i: number; t: number; place: Record<string, Placement>; motors: readonly number[]; clashes?: readonly MotionCollision[] }): Sample => ({
    pos: r.i,
    t: r.t,
    place: r.place,
    motors: [...r.motors],
    dist: new Map(),
    ...(r.clashes?.length ? { clash: new Set(r.clashes.flatMap((c) => [pairKey(c.a, c.b), pairKey(c.b, c.a)])) } : {}),
  });
  /** mezipoloha z řešiče / snímku; null = mimo rozpočet / nejde */
  const midOf = (s0: Sample, s1: Sample, poseAt: PoseAt | undefined): Sample | null => {
    if (!poseAt || budget <= 0 || o.cancel?.()) return null;
    const t = (s0.t + s1.t) / 2;
    const m = poseAt(t);
    if (!m) return null;
    budget--;
    info.refined++;
    const tt = m.t ?? t;
    const f = s1.t > s0.t ? (tt - s0.t) / (s1.t - s0.t) : 0.5;
    return { pos: s0.pos + (s1.pos - s0.pos) * f, t: tt, place: m.place, motors: m.motors, dist: new Map() };
  };

  /** zaznamená vzdálenost sledované dvojice ve vzorku (krok: řada a limit; mezipoloha: jen minimum) */
  const recordPair = (pk: string, s: Sample, step: number | null, between?: [number, number]) => {
    const p = pairs.get(pk);
    const d = s.dist.get(pk);
    if (!p || !d) return;
    if (step !== null) {
      p.series[step] = d.d;
      p.pts[step] = d.p1 && d.p2 ? [d.p1, d.p2] : null;
      if (limit !== null && d.d < limit) p.below.push(step);
    }
    if (d.d <= 0) p.contact = true;
    if (!p.min || d.d < p.min.d - 1e-12 || (Math.abs(d.d - p.min.d) <= 1e-12 && !d.exact && p.min.exact === false))
      p.min = { d: d.d, exact: d.exact, pos: s.pos, t: s.t, motors: s.motors, ...(d.p1 ? { p1: d.p1 } : {}), ...(d.p2 ? { p2: d.p2 } : {}), ...(d.aPath ? { aPath: d.aPath } : {}), ...(d.bPath ? { bPath: d.bPath } : {}), ...(between ? { between } : {}) };
  };

  /**
   * kontakt mezi polohami: kolize ve vzorku (třída, místo) → `between`; true = zapsáno (průnik s objemem), false = jen dotyk
   * bez objemu (průnik je jinde v úseku – půlí se dál)
   */
  const contactAt = async (s: Sample, k0: number, k1: number, a: string, b: string): Promise<boolean> => {
    if (between.some((h) => h.k0 === k0 && ((h.a === a && h.b === b) || (h.a === b && h.b === a)))) return true;
    const d = s.dist.get(pairKey(a, b));
    let clashes: MotionCollision[] = [];
    if (env.collide) {
      const all = await env.collide({ ...doc, components: (doc.components ?? []).map((c) => (s.place[c.id] ? { ...c, placement: s.place[c.id] } : c)) });
      s.clash = new Set(all.flatMap((c) => [pairKey(c.a, c.b), pairKey(c.b, c.a)]));
      clashes = all.filter((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a)).map((c) => ({ ...c }));
      if (!clashes.length) return false;
    }
    between.push({ k0, k1, pos: s.pos, t: s.t, motors: s.motors, a, b, ...(d?.p1 ? { p: d.p1 } : {}), clashes });
    info.contacts++;
    return true;
  };
  const unprovenCC = (k0: number, contact: boolean) => {
    info.unproven++;
    if (contact) info.unprovenContact++;
    if (info.unprovenAt.length < 8 && !info.unprovenAt.includes(k0)) info.unprovenAt.push(k0);
  };

  /**
   * Úsek s0 → s1 pro dvojice `list`: dokázat (mez posunu / dráha posuvu), nebo půlit. `cc` = hledá se kontakt (kolize),
   * jinak jen menší vůle mezi polohami. Vrací počet nepotvrzených dvojic.
   */
  const interval = async (s0: Sample, s1: Sample, list: { a: string; b: string; cc: boolean; clr: boolean }[], poseAt: PoseAt | undefined, depth: number, k0: number, k1: number): Promise<void> => {
    if (!list.length || o.cancel?.()) return;
    const cut = (x: { a: string; b: string; clr: boolean }) => (x.clr && !moving ? Infinity : x.clr ? reach : 1e-6);
    await measure(list.flatMap((x) => [{ s: s0, a: x.a, b: x.b, cutoff: cut(x) }, { s: s1, a: x.a, b: x.b, cutoff: cut(x) }]));
    // mezipoloha (jednou pro úsek): mez posunu přes ni (pohyb tam a zpět v úseku), přímost posuvu
    let mid: Sample | null | undefined;
    const getMid = () => (mid === undefined ? (mid = midOf(s0, s1, poseAt)) : mid);
    const split: typeof list = [];
    for (const x of list) {
      const pk = pairKey(x.a, x.b);
      const d0 = s0.dist.get(pk);
      const d1 = s1.dist.get(pk);
      if (!d0 || !d1) continue;
      const touch0 = d0.d <= 1e-9;
      const touch1 = d1.d <= 1e-9;
      // průnik na konci úseku, který kontrola kroku našla (dvojice je už hlášena – třída, místo): mezi polohami nic nového
      if (x.cc && ((touch0 && s0.clash?.has(pk)) || (touch1 && s1.clash?.has(pk)))) {
        info.covered++;
        continue;
      }
      // dotyk bez objemu na konci úseku (díl klouže po ploše, posuvné vedení v dotyku): mez posunu nepomůže – jen dráha posuvu
      const touching = x.cc && (touch0 || touch1);
      const m = getMid();
      if (!touching) {
        const delta = m ? bound(s0, m, x.a, x.b) + bound(m, s1, x.a, x.b) : bound(s0, s1, x.a, x.b) * 1.05;
        const lower = (d0.d + d1.d - delta) / 2;
        const needCC = x.cc && lower <= 1e-9;
        const best = pairs.get(pk)?.min?.d ?? Infinity;
        const needClr = x.clr && lower < Math.min(d0.d, d1.d, best) - tolC;
        if (!needCC && !needClr) {
          if (x.cc) info.bounded++;
          continue;
        }
      }
      // čistý posuv (stejné natočení na koncích a v půlce, půlka na úsečce) → přesná dráha z jádra
      const r0 = rel(s0, x.a, x.b);
      const r1 = rel(s1, x.a, x.b);
      let straight = !springs.has(x.a) && !springs.has(x.b) && angleBetween(r0.R, r1.R) < 1e-9;
      if (straight && m) {
        const rm = rel(m, x.a, x.b);
        const f = s1.t > s0.t ? (m.t - s0.t) / (s1.t - s0.t) : 0.5;
        const on: Vec3 = [r0.t[0] + (r1.t[0] - r0.t[0]) * f, r0.t[1] + (r1.t[1] - r0.t[1]) * f, r0.t[2] + (r1.t[2] - r0.t[2]) * f];
        // poloha v půlce musí ležet na úsečce (jinak jde o posuv po oblouku – rovnoběžník)
        const dev = len(sub(rm.t, on));
        straight = angleBetween(r0.R, rm.R) < 1e-9 && dev <= Math.max(1e-6, 1e-4 * len(sub(r1.t, r0.t)));
      } else if (straight && !m && poseAt) straight = false; // přímost nejde ověřit – půlit
      if (straight) {
        const swCut = x.clr && !moving ? Infinity : x.clr ? reach : 1e-6;
        let sw = await sweepOf(s0, s1, x.a, x.b, swCut, touching);
        // Konce v dotyku: dráhu počítá jádro pro B zmenšené k středu obálky. U dutého B (pouzdro na sloupku, deska s dírou)
        // zmenšení zúží díru a dráha „zajede“ do A i při čistém klouzání. Stejně platný důkaz klouzání je dráha zmenšeného A
        // vůči B (obrácené pořadí dvojice) – stačí jeden z obou; skutečný průchod tělesem najdou oba. Bez toho výsledek závisel na
        // pořadí id komponent (náhodné) a zbytečné půlení vyčerpalo rozpočet zjemnění (clash.uncertain v syntetickém nástroji).
        if (touching && x.cc && sw?.ok && sw.d <= 1e-9 && (sw.pen ?? Infinity) > 1e-3) {
          const rv = await sweepOf(s0, s1, x.b, x.a, swCut, true);
          if (rv?.ok && Number.isFinite(rv.d) && !(rv.d <= 1e-9 && (rv.pen ?? Infinity) > 1e-3)) {
            // body a cesty listů zpět do pořadí dvojice (a, b)
            const { p1, p2, aPath, bPath, ...rest } = rv;
            sw = { ...rest, ...(p2 ? { p1: p2 } : {}), ...(p1 ? { p2: p1 } : {}), ...(bPath ? { aPath: bPath } : {}), ...(aPath ? { bPath: aPath } : {}) };
          }
        }
        if (sw?.ok && Number.isFinite(sw.d)) {
          if (x.clr && sw.exact && sw.d < Math.min(d0.d, d1.d) - tolC) {
            // menší vůle uvnitř úseku (po přímé dráze): přesná hodnota a body, poloha v úseku neurčena
            const p = pairs.get(pk);
            if (p && (!p.min || sw.d < p.min.d))
              p.min = { d: sw.d, exact: true, pos: (s0.pos + s1.pos) / 2, t: (s0.t + s1.t) / 2, motors: s0.motors.map((v, i) => (v + (s1.motors[i] ?? v)) / 2), ...(sw.p1 ? { p1: sw.p1 } : {}), ...(sw.p2 ? { p2: sw.p2 } : {}), ...(sw.aPath ? { aPath: sw.aPath } : {}), ...(sw.bPath ? { bPath: sw.bPath } : {}), between: [k0, k1], sweep: true };
            if (p && limit !== null && sw.d < limit && !p.below.includes(k1) && !p.below.includes(k0)) p.below.push(k1);
          }
          // bez dotyku dráhy, nebo dotyk bez objemu (klouzání po ploše) = dokázáno; průchod tělesem → najít polohu půlením
          const pass = sw.d <= 1e-9 && (sw.pen ?? Infinity) > 1e-3;
          if (!x.cc || !pass) {
            if (x.cc) info.swept++;
            continue;
          }
        }
      }
      if (touching && !straight) {
        // klouzání s natáčením: průnik mezi polohami nejde vyloučit ani potvrdit (jen v polohách)
        unprovenCC(k0, true);
        if (!x.clr) continue;
      }
      split.push(x);
    }
    if (!split.length) return;
    const m = getMid();
    if (!m || depth >= depthMax) {
      for (const x of split.filter((y) => y.cc)) unprovenCC(k0, false);
      for (const x of split.filter((y) => y.clr)) {
        const p = pairs.get(pairKey(x.a, x.b));
        if (p) p.unproven++;
      }
      if (!m && budget <= 0) info.budget = true;
      return;
    }
    clrRefined++;
    await measure(split.map((x) => ({ s: m, a: x.a, b: x.b, cutoff: cut(x) })));
    const left: typeof split = [];
    for (const x of split) {
      const pk = pairKey(x.a, x.b);
      const dm = m.dist.get(pk);
      if (x.clr) recordPair(pk, m, null, [k0, k1]);
      // průnik v mezipoloze: kolize mezi kroky (jen dotyk bez objemu → půlí se dál, průnik je jinde v úseku)
      if (x.cc && dm && dm.d <= 1e-9 && (await contactAt(m, k0, k1, x.a, x.b)) && !x.clr) continue;
      left.push(x);
    }
    await interval(s0, m, left, poseAt, depth + 1, k0, k1);
    await interval(m, s1, left, poseAt, depth + 1, k0, k1);
  };

  /** dvojice úseku: sledované + (u kolizí) všechny se vzájemným pohybem, jejichž obálky dráhy se mohou dotknout */
  const candidates = (s0: Sample, s1: Sample, mid: Sample | null): { a: string; b: string; cc: boolean; clr: boolean }[] => {
    const out = new Map<string, { a: string; b: string; cc: boolean; clr: boolean }>();
    for (const p of explicit) if (moved(s0, s1, p.a, p.b) || (mid && moved(s0, mid, p.a, p.b))) out.set(pairKey(p.a, p.b), { a: p.a, b: p.b, cc: false, clr: true });
    if (!cc && !moving) return [...out.values()];
    const path = new Map<string, Box | null>();
    const ss = mid ? [s0, mid, s1] : [s0, s1];
    const pb = (id: string) => {
      if (!path.has(id)) path.set(id, pathBox(ss, id));
      return path.get(id)!;
    };
    const movedIds = ids.filter((id) => {
      const a = plOf(s0, id);
      const b = plOf(s1, id);
      const m = mid ? plOf(mid, id) : b;
      return a.position.some((v, i) => Math.abs(v - b.position[i]) > 1e-9 || Math.abs(v - m.position[i]) > 1e-9) || a.rotation.some((v, i) => Math.abs(v - b.rotation[i]) > 1e-9 || Math.abs(v - m.rotation[i]) > 1e-9);
    });
    if (!movedIds.length) return [...out.values()];
    const movedSet = new Set(movedIds);
    for (const a of movedIds)
      for (const b of ids) {
        if (a === b || (movedSet.has(b) && b < a)) continue;
        if (!moved(s0, s1, a, b) && !(mid && moved(s0, mid, a, b))) continue;
        const ba = pb(a);
        const bb = pb(b);
        if (!ba || !bb) continue;
        const g = boxGap(ba, bb);
        const wantCc = cc && !springs.has(a) && !springs.has(b) && g <= 1e-6;
        const wantMv = moving && g <= reach;
        if (!wantCc && !wantMv) continue;
        const [x, y] = a < b ? [a, b] : [b, a];
        const pk = pairKey(x, y);
        const cur = out.get(pk) ?? out.get(pairKey(y, x));
        if (cur) {
          cur.cc ||= wantCc;
          continue;
        }
        out.set(pk, { a: x, b: y, cc: wantCc, clr: wantMv });
        if (wantMv && !pairs.has(pk)) pairs.set(pk, { a: x, b: y, min: null, series: [], pts: [], below: [], unproven: 0 });
      }
    return [...out.values()];
  };

  return {
    async step(row, prev, poseAt) {
      if (o.cancel?.()) return;
      const s1 = sampleOf(row);
      info.poses++;
      clrPoses++;
      if (poseAt && info.between === "none") info.between = "solver";
      if (prev) {
        const tv = stepTravel(prev.place, row.place);
        info.maxStep = Math.max(info.maxStep, tv.d);
        info.maxTurn = Math.max(info.maxTurn, tv.turn);
      }
      if (!kernel) return;
      // sledované dvojice: vzdálenost v každé poloze (přesně)
      if (explicit.length) {
        await measure(explicit.map((p) => ({ s: s1, a: p.a, b: p.b, cutoff: Infinity })));
        for (const p of explicit) recordPair(pairKey(p.a, p.b), s1, row.i);
      } else if (local.size === 0) await measure([]);
      if (prev && (cc || moving || explicit.length) && refine) {
        const s0 = prevSample && prevSample.pos === prev.i ? prevSample : sampleOf(prev);
        // mezipoloha jednou na úsek (obálka dráhy přes ni – pohyb tam a zpět v úseku); dvojice podle obálek dráhy
        const pre = cc ? midOf(s0, s1, poseAt) : null;
        const list = candidates(s0, s1, pre);
        if (list.length) {
          const pa: PoseAt | undefined = pre ? (t) => (Math.abs(t - pre.t) < 1e-12 ? { place: pre.place, motors: pre.motors, t: pre.t } : (poseAt?.(t) ?? null)) : poseAt;
          if (pre) {
            // mezipoloha už spočítaná – neplatit ji v rozpočtu dvakrát
            budget++;
            info.refined--;
          }
          await interval(s0, s1, list, pa, 0, prev.i, row.i);
        }
        // „pohyblivé“: řada a limit v tomto kroku pro dvojice v dosahu
        if (moving) for (const x of list) if (x.clr) recordPair(pairKey(x.a, x.b), s1, row.i);
      } else if (moving && !prev) {
        /* krok 0: pohyblivé dvojice ještě nejsou známé (určí je první úsek) */
      }
      prevSample = s1;
    },
    finish(res) {
      if (info.mode === "continuous" && info.unproven) info.mode = "partial";
      const out = res as typeof res & ClearanceExt;
      if (wantCC) out.sweep = info;
      if (wantClr)
        out.clearance = {
          limit,
          moving,
          pairs: [...pairs.values()].filter((p) => p.min || p.series.some((v) => v !== null && v !== undefined)).sort((x, y) => (x.min?.d ?? Infinity) - (y.min?.d ?? Infinity)),
          poses: clrPoses,
          refined: clrRefined,
          ...(moving ? { reach } : {}),
        };
      if (between.length) out.between = between.sort((x, y) => x.pos - y.pos);
      return out;
    },
  };
}

/**
 * Dynamika (cad/motion-dynamic.ts) nemá řešič mezipoloh: kontrola po doběhnutí nad zaznamenanými snímky – úseky mezi snímky
 * s kontrolou kolizí (každý k-tý), mezipolohy = zaznamenané snímky uvnitř úseku. Mezi sousedními snímky jen mez posunu / dráha posuvu.
 */
export async function clearancePost<R extends MotionResult>(res: R, tracker: ClearanceTracker): Promise<R & ClearanceExt> {
  const steps = res.steps;
  const checked = steps.filter((s) => s.clashes !== undefined || !res.collisionsChecked);
  let prev: MotionStep | null = null;
  for (const s of checked.length ? checked : steps) {
    const p = prev;
    const inside = p ? steps.filter((x) => x.t > p.t && x.t < s.t) : [];
    const poseAt: PoseAt | undefined = inside.length
      ? (t) => {
          const f = inside.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
          return { place: f.place, motors: f.motors, t: f.t };
        }
      : undefined;
    await tracker.step(s, p, poseAt);
    prev = s;
  }
  const out = tracker.finish(res);
  if (out.sweep) out.sweep.between = steps.length > checked.length ? "frames" : "none";
  return out;
}
