/**
 * Dynamická pohybová studie (Pohybová studie › Dynamika): síly pružin, gravitace, tlumení a zadané síly hýbou díly po stupních
 * volnosti, které nechávají vazby sestavy (posuv po Souososti / Drážce / mezi rovinami, natočení na Závěsu …), motory na jiných
 * vazbách pohánějí zbytek jako v kinematické studii (cad/motion.ts – ta zůstává výchozí a beze změny).
 *
 * Model: tuhá tělesa = tuhé skupiny ze zámků (kořen + členové, jako řešič vazeb); hmotnost, těžiště a tenzor setrvačnosti z objemu
 * × hustoty dílů (cad/motion-mass.ts, ručně přepsatelné). Stav = poloha a rychlost těžiště a úhlová rychlost každého tělesa.
 * Vazby (rovnosti) a motory (rovnosti závislé na čase) se drží projekcí:
 * - poloha: řešič vazeb `solvePoses` z předpovězené polohy (nejmenší změna, meze jako zbytky jen při překročení),
 * - rychlost: hmotnostně vážená projekce do prostoru dovolených rychlostí J·v = −∂r/∂t (Gramova–Schmidtova ortogonalizace řádků
 *   J·𝓛⁻ᵀ, M = 𝓛·𝓛ᵀ; nadbytečné vazby – dva vodicí sloupky – se vyřadí).
 * Integrace s pevným krokem (RATTLE – rychlostní Verlet s vazbami): v½ = Pᵥ(v + M⁻¹F·dt/2) (polovina rázu už s reakcemi vazeb),
 * x' = x + v½·dt + δ, kde δ = M⁻¹·Jᵀ·λ je hmotnostně vážená oprava polohy (SHAKE, J z počátku kroku) na vazby a motory v čase
 * t + dt, v½ += δ/dt, v' = Pᵥ(v½ + M⁻¹F(x')·dt/2) v nové poloze i s dotyky na mezích. Oprava polohy jde stejným směrem jako reakce
 * vazby (M⁻¹·Jᵀ), takže poloha zůstává integrálem rychlosti i u natočení na čepu se zatížením mimo těžiště (kyvadlo, páka, moment
 * na Závěsu) – symplektický krok 2. řádu: chyba periody (ω·dt)²/24, energie kolísá o ~(ω·dt)²/8 bez driftu. Jen když SHAKE
 * nekonverguje (rozpor vazeb s motorem), nastoupí nevážený řešič vazeb `solvePoses` a jeho oprava rychlost nemění. Překročené meze
 * se vrátí hmotnostně váženou opravou polohy (bez změny rychlosti – doraz neodpruží).
 * Dorazy: meze vazeb (Mez vzdálenosti min/max, Mez úhlu, konce Drážky) a délka pružiny na doraz Ln jsou jednostranné vazby –
 * poloha se vrátí na mez, rychlost směrem do meze se nahradí odrazem −e·v (e = součinitel odrazu; pod 1 mm/s nebo u trvajícího
 * dotyku bez odrazu, takže doraz při e = 0 drží).
 * Síly: gravitace m·g, pružina F = c·(L0 − L) jen při dosednutí (L < L0) působící na dosedací plochy A (−u) a B (+u), tlumič
 * paralelně k pružině −c_d·L̇, síla / moment na vazbě (kladná zvětšuje hodnotu vazby), gyroskopický člen −ω×(I·ω). Pružina bez
 * zadané tuhosti dostane tuhost z geometrie dílu (EN 13906-1 R = G·d⁴ / (8·D³·n), `springRateOf`), jinak v dynamice nepůsobí
 * a protokol to hlásí ⚠.
 * Kontrola energie: polohová energie tíže od výchozí polohy těžišť (nezávisí na umístění modelu), odchylka bilance vztažená
 * k největší kinetické energii (nebo práci sil / ztrátě tlumením, je-li větší) – ne k celkové energii, která by chybu skryla.
 * Jednotky uvnitř: mm, s, kg (síla kg·mm/s² = 10⁻³ N, energie 10⁻⁶ J). Čisté funkce bez jádra (geometrii a hmotnosti dodá volající).
 */
import { apply3, mul3, type Mat3 } from "./assembly";
import { isFault } from "./clash-rules";
import { springComps, springSteps, solidOf } from "./asm-spring";
import { springRateOf } from "./asm-spring-check";
import { springGeom, type SpringGeom } from "./asm-spring-geom";
import { getLang, tr } from "./i18n";
import { kinCluster, kinCtx, MATE_LABEL, mateLost, memoGeo, solveMates, type GeoProvider } from "./mates";
import { DEG, L, add, cross, dot, expRot, kinResidual, len, pivotOf, placementOf, poseOf, resNorm, rigidGroups, scale, solvePoses, sub, syncGroups, unit, wrap, worldOf, dofValue, type Pose } from "./mates-kin";
import type { CompInertia, M3, MassSource } from "./motion-mass";
import { motorProblem, poseDoc, rotationAngleDeg, runMotion, START0_EPS, type MotionClashes, type MotionResult, type MotionStep, type MotionTiming } from "./motion";
import type { MateDev } from "./motion-quasi";
import { JUMP_EPS, motorAt as modelMotorAt, motorIsAbsolute } from "./motor-model";
import type { AsmComponent, CadDoc, Mate, MateRef, MotionDynamic, MotionMotor, MotionStudy, Placement, Vec3 } from "./types";

/** gravitační zrychlení [mm/s²] */
export const G_ACC = 9810;
/** síla N → vnitřní jednotka kg·mm/s² */
const N = 1000;
/** nejmenší hmotnost tělesa [kg] (díl bez objemu – náhrada, aby soustava nebyla singulární) */
const MIN_MASS = 1e-3;
/** pod touto rychlostí nárazu [mm/s] se neodráží (dotyk v klidu) */
const V_REST = 1;

export const defaultDyn = (): MotionDynamic => ({ dt: 0.0005 });

/**
 * Hodnota motoru v čase t (spojitě; jako `motorValue` v cad/motion.ts): profil motoru z cad/motor-model.ts – rozsah od–do, tam
 * a zpět, rychlost bez konce, rozsah × rychlost se zastavením na konci.
 */
export function motorAt(mo: MotionMotor, t: number, duration: number): number {
  return modelMotorAt(mo, t, duration);
}

/** Těleso dynamické studie: kořen tuhé skupiny a jeho členové, hmotnost [kg], těžiště v souřadnicích kořene, tenzor k těžišti [kg·mm²]. */
export type DynBody = { id: string; name: string; ids: string[]; mass: number; c: Vec3; I: M3; source: MassSource };
/** Dotyk na dorazu: úseky [od, do] v s a nárazy (čas, rychlost nárazu mm/s, u Meze úhlu rad/s). */
export type DynContact = { id: string; label: string; bound: "min" | "max"; limit: number; intervals: [number, number][]; impacts: { t: number; v: number }[]; unit: "mm" | "°" };
export type DynEnergy = {
  /** mechanická energie na začátku a na konci [J] */
  e0: number;
  end: number;
  /** končí-li výpočet neplatnými kroky (motor „na mezi chyba“ za mezí): `end` je energie posledního PLATNÉHO integračního kroku
   * v čase `endT` [s] – stav za mezí je nefyzikální (kolo 7) */
  endT?: number;
  /** práce zadaných sil, ztráta tlumením a ztráta při dotycích / nárazech [J] */
  applied: number;
  damping: number;
  contacts: number;
  /** relativní odchylka bilance mimo kroky s dotykem (jen bez motorů), jinak null */
  drift: number | null;
  /** největší kinetická energie [J] */
  kinMax: number;
  /** vztažná energie odchylky [J]: největší kinetická energie, práce zadaných sil nebo ztráta tlumením (největší z nich) */
  ref: number;
};
/** Největší rychlost [mm/s] a zrychlení [mm/s²] těžiště za celý výpočet (každý PLATNÝ integrační krok, ne jen zaznamenané); zrychlení
 * bez nárazů na doraz (ráz = skok rychlosti v jednom kroku, jeho „zrychlení“ by záviselo na kroku dt). */
export type DynPeak = { v: number; tv: number; a: number; ta: number };
/** Stav těles v kroku (těžiště ve světě): poloha [mm], rychlost [mm/s], zrychlení [mm/s²]. */
export type DynStepBody = { p: Vec3; v: Vec3; a: Vec3 };
/** `dyn` chybí u neplatného snímku (status „invalid“): stav integrátoru za mezí je nefyzikální – CSV má prázdné buňky, graf mezeru. */
export type DynMotionStep = MotionStep & { dyn?: Record<string, DynStepBody> };
export type DynInfo = {
  dt: number;
  /** počet integračních kroků a záznam každého k-tého */
  n: number;
  every: number;
  /** kolize (je-li zapnutá) v každém k-tém zaznamenaném snímku a v posledním – počet snímků s kontrolou = kroky studie + 1 */
  clashEvery?: number;
  gravity: Vec3 | null;
  damping: number;
  restitution: number;
  bodies: DynBody[];
  contacts: DynContact[];
  energy: DynEnergy;
  /** největší síla pružiny [N] (s tlumičem) a kdy */
  springMax: { id: string; force: number; t: number } | null;
  /** špičky rychlosti a zrychlení těles (id kořene → špička) */
  peaks: Record<string, DynPeak>;
  /** pružiny: tuhost použitá v dynamice [N/mm] a odkud (zadaná / z geometrie dílu / žádná – pružina nepůsobí) */
  springRates: { id: string; rate: number | null; source: "def" | "geometry" | "none" }[];
  ms: number;
};
export type DynResult = MotionResult & { steps: DynMotionStep[]; dynamic: DynInfo };

/* ───────────────────────── malá lineární algebra ───────────────────────── */

const T3 = (m: Mat3 | M3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
const mv = (m: ArrayLike<number>, v: Vec3): Vec3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
/** Choleského rozklad 3×3 (dolní trojúhelník po řádcích) s regularizací – tenzor setrvačnosti může být téměř singulární (tenký díl) */
function chol3(A: ArrayLike<number>): Mat3 {
  const eps = 1e-9 * Math.max(1e-6, A[0] + A[4] + A[8]);
  const a = [A[0] + eps, A[1], A[2], A[3], A[4] + eps, A[5], A[6], A[7], A[8] + eps];
  const l00 = Math.sqrt(Math.max(a[0], eps));
  const l10 = a[3] / l00;
  const l20 = a[6] / l00;
  const l11 = Math.sqrt(Math.max(a[4] - l10 * l10, eps));
  const l21 = (a[7] - l20 * l10) / l11;
  const l22 = Math.sqrt(Math.max(a[8] - l20 * l20 - l21 * l21, eps));
  return [l00, 0, 0, l10, l11, 0, l20, l21, l22];
}
/** řeší L·y = b (L dolní trojúhelník) */
const fwd = (Lm: Mat3, b: Vec3): Vec3 => {
  const y0 = b[0] / Lm[0];
  const y1 = (b[1] - Lm[3] * y0) / Lm[4];
  return [y0, y1, (b[2] - Lm[6] * y0 - Lm[7] * y1) / Lm[8]];
};
/** řeší Lᵀ·x = y */
const bwd = (Lm: Mat3, y: Vec3): Vec3 => {
  const x2 = y[2] / Lm[8];
  const x1 = (y[1] - Lm[7] * x2) / Lm[4];
  return [(y[0] - Lm[3] * x1 - Lm[6] * x2) / Lm[0], x1, x2];
};
/* ───────────────────────── výpočet ───────────────────────── */

/** Ukotvené komponenty (jako v řešiči vazeb a v cad/motion.ts). */
function fixedOf(doc: CadDoc): (id: string) => boolean {
  const comps = doc.components ?? [];
  const fixed = new Set(comps.filter((c) => c.fixed).map((c) => c.id));
  for (const m of doc.mates ?? []) if (m.type === "fixed" && !m.suppressed) fixed.add(m.a.compId);
  if (!fixed.size && comps[0]) fixed.add(comps[0].id);
  return (id) => fixed.has(id) || !comps.some((c) => c.id === id);
}

type Limit = { id: string; label: string; value: () => number | null; min?: number; max?: number; scale: number; unit: "mm" | "°" };
type DynSpring = { c: AsmComponent; g: SpringGeom; a: MateRef; b: MateRef; free: number; solid?: number; rate?: number; rateSource: "def" | "geometry" | "none" };
/** řádek rovnosti J·V = b; `i` = index zbytku eqRes (oprava polohy SHAKE) */
type EqRow = { j: Float64Array; b: number; i: number };

/**
 * Výpočet dynamické studie. `inertia(id)` = hmotnostní vlastnosti komponenty nejvyšší úrovně v jejích souřadnicích (z dílů; null =
 * neznámé – náhradní 1 g); ručně zadané hmotnosti `study.dyn.masses` už musí být započtené (cad/asm-agent-kin.ts).
 */
export async function runDynamic(
  doc: CadDoc,
  geo: GeoProvider,
  study: MotionStudy,
  opts: { inertia: (compId: string) => CompInertia | null; collide?: (d: CadDoc) => Promise<MotionClashes>; onStep?: (k: number, n: number, info?: { ms: number; solveMs: number; collideMs: number }) => void; cancel?: () => boolean; maxFrames?: number },
): Promise<DynResult> {
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const tStart = now();
  const D = { ...defaultDyn(), ...(study.dyn ?? {}) };
  const dt = Math.min(0.05, Math.max(1e-6, D.dt > 0 ? D.dt : 0.0005));
  const duration = study.duration > 0 ? study.duration : 1;
  const nSteps = Math.max(1, Math.min(400000, Math.round(duration / dt)));
  const every = Math.max(1, Math.ceil(nSteps / Math.max(10, opts.maxFrames ?? D.frames ?? 400)));
  // kolize (jádro, ~1 s na snímek u pružin v nové délce): jen v `study.steps` rovnoměrně rozložených snímcích jako kinematická
  // studie (+ první a poslední), ne ve všech zaznamenaných – 400 snímků × přesné průniky překročí časový limit CLI (recenze vlny 21)
  const frameCount = 1 + Math.floor(nSteps / every) + (nSteps % every ? 1 : 0);
  const clashEvery = Math.max(1, Math.ceil((frameCount - 1) / Math.max(1, Math.round(study.steps) || 1)));
  const gDir = D.gravity === null ? null : unit(D.gravity ?? [0, 0, -1]);
  const cDamp = Math.max(0, D.damping ?? 0);
  const eRest = Math.min(1, Math.max(0, D.restitution ?? 0));
  const comps = doc.components ?? [];
  const name = (id: string) => comps.find((c) => c.id === id)?.name ?? id;

  // 1) výchozí stav: vyřešená sestava (jako kinematická studie)
  const s0 = solveMates(doc, geo);
  const mates = (s0.mates ?? doc.mates ?? []).filter((m) => !m.suppressed && !mateLost(m)); // ztracená reference = mimo pohyb (bod 20)
  for (const mo of study.motors) {
    const p = motorProblem(mo, s0.mates ?? doc.mates ?? []); // ztracená reference: vlastní hláška (bod 20)
    if (p) throw new Error(tr("motor {0}: {1}", study.motors.indexOf(mo) + 1, p));
  }
  for (const ld of D.loads ?? []) if (!mates.some((m) => m.id === ld.mate)) throw new Error(tr("síla na vazbě: vazba v sestavě není (smazaná nebo potlačená)"));
  const g = memoGeo(geo);
  const poses = new Map<string, Pose>(s0.components.map((c) => [c.id, poseOf(c.placement)] as const));
  // start integrátoru z KVAZISTATICKÉ rovnováhy v okamžiku začátku motorů (vlna 22, bod 2 – kolo 6): motor, jehož začátek není
  // hodnota vazby v dokumentu (deska „přeskočí“), by jinak začal s pružinou mimo rovnováhu (přidržovač na Ln) – ráz a „největší
  // síla pružiny“, které jsou jen artefaktem startu. Krok 0 dynamiky = krok 0 kvazistatiky. Bez motoru nebo bez pružin beze změny
  // (volný kmit z polohy dokumentu zůstává zkouškou dynamiky).
  // JEN když začátek motoru skáče (oponent kola 6: dřív vždy, s motorem a pružinou – zmizel skutečný přechodový děj z polohy
  // dokumentu, např. puštění přidržovače na doraz meze, a to bez ⚠). Bez skoku startuje integrátor z polohy dokumentu; když ho
  // start z rovnováhy přesune, výsledek to řekne (`start0`, ⚠ motion.start-jump s příčinou „skok motoru“).
  const start0: NonNullable<MotionResult["start0"]> = [];
  // hodnoty vazeb motorů v poloze DOKUMENTU (výchozí stav motorů – u přírůstkového motoru základ přírůstku; start z rovnováhy ho nemění)
  const c0 = kinCtx(poses, g, (_k, d) => wrap(d));
  const docV = study.motors.map((mo) => {
    const m = mates.find((x) => x.id === mo.mate);
    return m ? dofValue(m, mo.kind, c0) : null;
  });
  const motorJumps = study.motors.some((mo, i) => {
    const m = mates.find((x) => x.id === mo.mate);
    if (!m) return false;
    const want = motorAt(mo, 0, duration);
    if (!motorIsAbsolute(mo, m)) return Math.abs(want) > JUMP_EPS;
    const v = docV[i];
    return v !== null && Math.abs(v - want) > JUMP_EPS;
  });
  if (motorJumps && springComps(doc).length) {
    try {
      const q = await runMotion(doc, geo, { motors: study.motors, duration, steps: 1, mode: "quasistatic" });
      const p0 = q.steps[0]?.status ? null : q.steps[0]?.place;
      if (p0)
        for (const [id, pl] of Object.entries(p0)) {
          const P = poses.get(id);
          if (!P) continue;
          const was = placementOf(P);
          const d = Math.hypot(pl.position[0] - was.position[0], pl.position[1] - was.position[1], pl.position[2] - was.position[2]);
          const deg = rotationAngleDeg(was.rotation, pl.rotation);
          if (d > START0_EPS || deg > START0_EPS) start0.push({ comp: id, d, deg, cause: "motor" });
          poses.set(id, poseOf(pl));
        }
    } catch {
      // rovnováhu nejde spočítat (motor mimo vazby …) – start z polohy dokumentu jako dřív; výpočet níže řekne své
    }
  }
  let state = new Map<string, number>();
  let rec: Map<string, number> | null = null;
  const ctx = kinCtx(poses, g, (k, d) => {
    const prev = state.get(k);
    const v = prev === undefined ? wrap(d) : prev + wrap(d - prev);
    rec?.set(k, v);
    return v;
  });
  const isFixed = fixedOf(doc);
  // motory (jako v cad/motion.ts): Vzdálenost / Drážka s hodnotou = hodnota vazby, jinak přírůstek stupně volnosti od výchozího stavu
  const motors = study.motors.map((mo) => {
    const m = mates.find((x) => x.id === mo.mate)!;
    const abs = motorIsAbsolute(mo, m);
    const v0 = docV[study.motors.indexOf(mo)] ?? dofValue(m, mo.kind, ctx);
    if (v0 === null) throw new Error(tr("motor {0}: chybí geometrie vazby „{1}“", study.motors.indexOf(mo) + 1, m.name ?? tr(MATE_LABEL[m.type])));
    return { mo, m, abs, v0, target: 0 };
  });
  // motor na mezi v dynamice (vlna 22, bod 8 – kolo 6): mez vazby, kterou předepsaný pohyb motoru porušuje (doraz v rozporu
  // s motorem), = „stop“ (výchozí): motory od toho okamžiku drží hodnotu posledního platného snímku; „chyba“: snímky za mezí jsou
  // neplatné (zobrazí poslední platnou polohu). Dřív se volba přijala a v dynamice neměla účinek.
  // Volba platí PRO KAŽDÝ MOTOR zvlášť (kolo 6, oponent: dřív jedna volba pro celou studii). Zastavení je směrové: motor stojí jen,
  // dokud profil žádá dál ZA mez (týž směr jako při zastavení); jakmile profil couvne zpět na dosažitelnou stranu (zpětný zdvih),
  // motor ho zase sleduje – dřív zůstal zmrazený do konce studie a hlásil „brání: Mez“ i při návratu nahoru.
  const frozen: (number | null)[] = study.motors.map(() => null);
  const frozenDir: number[] = study.motors.map(() => 0);
  const limitMode = (i: number): "stop" | "error" => (study.motors[i]?.atLimit === "error" ? "error" : "stop");
  const anyFrozen = () => frozen.some((f) => f !== null);
  const setTime = (t: number) =>
    motors.forEach((x, i) => {
      const w = motorAt(x.mo, t, duration);
      const f = frozen[i];
      if (f !== null && Math.sign(w - f) !== frozenDir[i]) frozen[i] = null; // profil couvl na dosažitelnou stranu meze
      x.target = frozen[i] ?? w;
    });
  /**
   * motory, kterých se porušená mez týká: pohánějí díl (tuhé těleso) některé z porušených mezí; když žádný (mez porušená přes řetěz
   * dalších dílů), všechny – volba „na mezi“ jednoho motoru tak neplatí pro motor, který s mezí nesouvisí
   */
  const involved = (ids: string[]): Set<number> => {
    const bs = new Set<number>();
    for (const id of ids) {
      const m = live.find((x) => x.id === id);
      for (const c of m ? [m.a.compId, m.b.compId] : []) if (bodyOf.has(c)) bs.add(bodyOf.get(c)!);
    }
    const out = new Set<number>();
    motors.forEach((x, i) => [x.m.a.compId, x.m.b.compId].some((c) => bs.has(bodyOf.get(c) ?? -1)) && out.add(i));
    return out.size ? out : new Set(motors.map((_, i) => i));
  };
  /** motory „stop“ dotčené mezemi `ids`, které v tomto kroku jely (cíl se změnil), zastaví na hodnotě `prev` ve směru, kterým jely */
  const freezeMoving = (prev: number[], ids: string[]): boolean => {
    let any = false;
    const inv = involved(ids);
    motors.forEach((x, i) => {
      if (!inv.has(i) || limitMode(i) !== "stop" || frozen[i] !== null) return;
      const d = x.target - prev[i];
      if (Math.abs(d) <= 1e-12) return;
      frozen[i] = prev[i];
      frozenDir[i] = Math.sign(d);
      any = true;
    });
    return any;
  };
  const absMate = new Map(motors.filter((x) => x.abs).map((x) => [x.m.id, x]));
  const seeds = new Set(mates.flatMap((m) => [m.a, m.b, m.c, m.d].flatMap((r) => (r ? [r.compId] : []))));
  const cl = kinCluster(mates, seeds, isFixed);
  const groups = rigidGroups(mates, comps.map((c) => c.id), isFixed);
  const inCluster = new Set(cl.vars);
  syncGroups(poses, groups, [...groups.fixedRoots].filter((r) => groups.members.get(r)!.some((m) => inCluster.has(m.id))));
  const roots = new Set<string>();
  for (const id of cl.vars) {
    const root = groups.rootOf.get(id) ?? id;
    if (!groups.fixedRoots.has(root) && !isFixed(root)) roots.add(root);
  }
  const groupIds = (root: string) => [root, ...(groups.members.get(root) ?? []).map((m) => m.id)];
  const vars = [...roots].map((id) => ({ id, pivot: pivotOf(id, cl.mates, ctx, groups.members.get(id)?.length ? new Set(groupIds(id)) : undefined) }));

  // 2) tělesa: hmotnostní vlastnosti skupiny v souřadnicích kořene
  const bodies: DynBody[] = vars.map((v) => {
    const P = poses.get(v.id)!;
    const RtP = T3(P.R);
    let m = 0;
    const mom: Vec3 = [0, 0, 0];
    const parts: { mass: number; com: Vec3; I: M3 }[] = [];
    let source: MassSource = "volume";
    for (const id of groupIds(v.id)) {
      const ci = opts.inertia(id);
      const Q = poses.get(id);
      if (!ci || !Q || !(ci.mass > 0)) continue;
      if (ci.source === "manual") source = "manual";
      // komponenta → kořen: Rr = Pᵀ·Q, x_r = Pᵀ·(Q·x + q − p)
      const Rr = mul3(RtP, Q.R);
      const com = mv(RtP, sub(add(mv(Q.R, ci.com), Q.p), P.p));
      const I = mul3(mul3(Rr, ci.I as unknown as Mat3), T3(Rr)) as unknown as M3;
      parts.push({ mass: ci.mass, com, I });
      m += ci.mass;
      for (let k = 0; k < 3; k++) mom[k] += ci.mass * com[k];
    }
    if (!(m > 0)) return { id: v.id, name: name(v.id), ids: groupIds(v.id), mass: MIN_MASS, c: [0, 0, 0], I: [10 * MIN_MASS, 0, 0, 0, 10 * MIN_MASS, 0, 0, 0, 10 * MIN_MASS] as M3, source: "default" };
    const c: Vec3 = scale(mom, 1 / m);
    const I = [0, 0, 0, 0, 0, 0, 0, 0, 0] as M3;
    for (const x of parts) {
      const d = sub(x.com, c);
      const d2 = dot(d, d);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[i * 3 + j] += x.I[i * 3 + j] + x.mass * ((i === j ? d2 : 0) - d[i] * d[j]);
    }
    return { id: v.id, name: name(v.id), ids: groupIds(v.id), mass: m, c, I, source };
  });
  const nb = bodies.length;
  const nv = nb * 6;
  const bodyOf = new Map<string, number>();
  bodies.forEach((b, i) => b.ids.forEach((id) => bodyOf.set(id, i)));

  // 3) zbytky vazeb (rovnosti – meze odděleně), motory, meze a pružiny
  const live = mates.filter((m) => m.type !== "fixed" && !groups.tree.has(m.id));
  const eqOf = (m: Mate): number[] | null => {
    const mm = absMate.has(m.id) ? { ...m, value: absMate.get(m.id)!.target } : m;
    const r = kinResidual(mm, ctx);
    if (!r) return null;
    // meze nejsou rovnosti: Mez vzdálenosti = jen rovnoběžnost rovin, Mez úhlu nic, Drážka bez polohy = bez konců drážky
    if (m.type === "limitDistance" || (m.type === "slot" && mm.value === undefined)) return r.slice(0, -1);
    if (m.type === "limitAngle") return [];
    return r;
  };
  const driveRes = (): number[] =>
    motors.flatMap((x) => {
      if (x.abs) return [];
      const v = dofValue(x.m, x.mo.kind, ctx);
      if (v === null) return [];
      if (x.mo.kind === "rotary") return [(ctx.ang(`motor:${x.mo.id}`, v - x.v0) - x.target / DEG) * L];
      return [v - x.v0 - x.target];
    });
  const eqRes = (): number[] => [...live.flatMap((m) => eqOf(m) ?? []), ...driveRes()];

  const limits: Limit[] = [];
  const mLabel = (m: Mate) => `${m.name ?? tr(MATE_LABEL[m.type])} ${name(m.a.compId)} → ${name(m.b.compId)}`;
  for (const m of live) {
    if (m.type === "limitDistance" && (m.min !== undefined || m.max !== undefined))
      limits.push({
        id: m.id,
        label: mLabel(m),
        min: m.min,
        max: m.max,
        scale: 1,
        unit: "mm",
        value: () => {
          const A = ctx.pose(m.a.compId) && g(m.a) ? worldOf(ctx.pose(m.a.compId)!, g(m.a)!) : null;
          const B = ctx.pose(m.b.compId) && g(m.b) ? worldOf(ctx.pose(m.b.compId)!, g(m.b)!) : null;
          return A && B ? dot(sub(A.origin, B.origin), B.normal) : null;
        },
      });
    else if (m.type === "limitAngle" && (m.min !== undefined || m.max !== undefined))
      limits.push({
        id: m.id,
        label: mLabel(m),
        min: m.min !== undefined ? m.min / DEG : undefined,
        max: m.max !== undefined ? m.max / DEG : undefined,
        scale: L,
        unit: "°",
        value: () => {
          const A = ctx.pose(m.a.compId) && g(m.a) ? worldOf(ctx.pose(m.a.compId)!, g(m.a)!) : null;
          const B = ctx.pose(m.b.compId) && g(m.b) ? worldOf(ctx.pose(m.b.compId)!, g(m.b)!) : null;
          return A && B ? Math.atan2(len(cross(A.normal, B.normal)), dot(A.normal, B.normal)) : null;
        },
      });
    else if (m.type === "slot" && m.value === undefined && !absMate.has(m.id)) {
      // konce drážky: poloha t ∈ ⟨0, l⟩ podél drážky (konce b a c jsou na téže komponentě – délka se nemění)
      const B = ctx.pose(m.b.compId) && g(m.b) ? worldOf(ctx.pose(m.b.compId)!, g(m.b)!) : null;
      const C = m.c && ctx.pose(m.c.compId) && g(m.c) ? worldOf(ctx.pose(m.c.compId)!, g(m.c)!) : null;
      if (!B || !C) continue;
      const n = B.normal;
      const perp = (v: Vec3) => sub(v, scale(n, dot(v, n)));
      const l = len(sub(perp(C.origin), perp(B.origin)));
      limits.push({ id: m.id, label: mLabel(m), min: 0, max: l, scale: 1, unit: "mm", value: () => dofValue(m, "linear", ctx) });
    }
  }
  // pružiny: dosedací plochy, délka na doraz jako jednostranná vazba
  const springs: DynSpring[] = [];
  for (const c of springComps(doc)) {
    const sg = c.source.kind === "part" ? springGeom(c.source.doc) : null;
    if (!sg || !c.spring) continue;
    // tuhost: zadaná v definici pružiny, jinak z geometrie dílu (drát, střední průměr, činné závity) – bez ní by pružina tiše nepůsobila
    const geoRate = c.spring.rate === undefined && c.source.kind === "part" ? springRateOf(c.source.doc) : null;
    const rate = c.spring.rate ?? geoRate ?? undefined;
    springs.push({ c, g: sg, a: c.spring.a, b: c.spring.b, free: c.spring.free, solid: solidOf(c), rate, rateSource: c.spring.rate !== undefined ? "def" : geoRate !== null ? "geometry" : "none" });
  }
  /** dosedací body pružiny ve světě: začátek osy P0, směr u, poloha ploch A / B po ose (tA < tB) */
  const seatOf = (s: DynSpring): { P0: Vec3; u: Vec3; tA: number; tB: number } | null => {
    const P = poses.get(s.c.id);
    if (!P) return null;
    const P0 = add(apply3(P.R, s.g.base), P.p);
    const u = unit(apply3(P.R, s.g.axis));
    const tOf = (ref: MateRef): number | null => {
      const Q = poses.get(ref.compId);
      const loc = g(ref);
      if (!Q || !loc) return null;
      const w = worldOf(Q, loc);
      if (w.kind === "plane") {
        const den = dot(u, w.normal);
        if (Math.abs(den) < 0.05) return null;
        return dot(sub(w.origin, P0), w.normal) / den;
      }
      return dot(sub(w.origin, P0), u);
    };
    const tA = tOf(s.a);
    const tB = tOf(s.b);
    return tA === null || tB === null ? null : { P0, u, tA, tB };
  };
  for (const s of springs)
    if (s.solid !== undefined) {
      const sp = s;
      limits.push({ id: `spring:${s.c.id}`, label: tr("pružina „{0}“ na doraz Ln {1} mm", s.c.name, fmt(s.solid!, 3)), min: s.solid, scale: 1, unit: "mm", value: () => { const x = seatOf(sp); return x ? x.tB - x.tA : null; } });
    }
  const boundRes = (list: Limit[]): number[] =>
    list.map((l) => {
      const v = l.value();
      if (v === null) return 0;
      return (l.min !== undefined && v < l.min ? v - l.min : l.max !== undefined && v > l.max ? v - l.max : 0) * l.scale;
    });
  // priorita při rozporu: vazby a motory > meze vazeb > délka pružin na doraz
  const mateLimits = limits.filter((l) => !l.id.startsWith("spring:"));
  const posRes = () => [...eqRes(), ...boundRes(limits)];
  const posResMates = () => [...eqRes(), ...boundRes(mateLimits)];
  const ok = (r: number[]) => resNorm(r) < 1e-4;
  /** největší překročení meze (mm, u úhlu rad·L) */
  const violation = () =>
    limits.reduce((mx, l) => {
      const v = l.value();
      if (v === null) return mx;
      const e = l.min !== undefined && v < l.min ? l.min - v : l.max !== undefined && v > l.max ? v - l.max : 0;
      return Math.max(mx, e * l.scale);
    }, 0);

  // 4) stav těles: rychlost těžiště a úhlová rychlost (6 na těleso)
  const com = (i: number): Vec3 => {
    const P = poses.get(bodies[i].id)!;
    return add(apply3(P.R, bodies[i].c), P.p);
  };
  const Iw = (i: number): Mat3 => {
    const R = poses.get(bodies[i].id)!.R;
    return mul3(mul3(R, bodies[i].I as unknown as Mat3), T3(R));
  };
  const sync = () => syncGroups(poses, groups, bodies.map((b) => b.id));
  const snapshot = () => bodies.map((b) => poses.get(b.id)!);
  const restore = (s: Pose[]) => {
    bodies.forEach((b, i) => poses.set(b.id, s[i]));
    sync();
  };
  /** posun těles o rychlost × h (těžiště přímo, natočení kolem těžiště) */
  const drift = (V: Float64Array, h: number) => {
    bodies.forEach((b, i) => {
      const P = poses.get(b.id)!;
      const c0 = add(apply3(P.R, b.c), P.p);
      const c1 = add(c0, [V[i * 6] * h, V[i * 6 + 1] * h, V[i * 6 + 2] * h]);
      const R1 = mul3(expRot([V[i * 6 + 3] * h, V[i * 6 + 4] * h, V[i * 6 + 5] * h]), P.R);
      poses.set(b.id, { R: R1, p: sub(c1, apply3(R1, b.c)) });
    });
    sync();
  };
  const EPS_T = 1e-5;
  const EPS_R = 1e-7;
  /** Jacobiho matice funkce f podle rychlostí těles (dopředné diference: posuv těžiště, natočení kolem těžiště); řádky × nv */
  const jac = (f: () => number[], f0: number[]): Float64Array => {
    const m = f0.length;
    const J = new Float64Array(m * nv);
    const s = snapshot();
    for (let i = 0; i < nb; i++)
      for (let k = 0; k < 6; k++) {
        const P = s[i];
        const e: Vec3 = [0, 0, 0];
        if (k < 3) {
          e[k] = EPS_T;
          poses.set(bodies[i].id, { R: P.R, p: add(P.p, e) });
        } else {
          e[k - 3] = EPS_R;
          const c0 = add(apply3(P.R, bodies[i].c), P.p);
          const R1 = mul3(expRot(e), P.R);
          poses.set(bodies[i].id, { R: R1, p: sub(c0, apply3(R1, bodies[i].c)) });
        }
        sync();
        const r = f();
        const h = k < 3 ? EPS_T : EPS_R;
        for (let j = 0; j < m; j++) J[j * nv + i * 6 + k] = ((r[j] ?? 0) - f0[j]) / h;
        poses.set(bodies[i].id, P);
      }
    restore(s);
    // šum dopředné diference (zaokrouhlení souřadnic ~1e-13 / krok) pod 1e-7 největšího prvku řádku = nula – jinak by se
    // z nadbytečných řádků (dva sloupky, doraz v rozporu s motorem) stal „nezávislý“ řádek s obří rychlostí ve volném směru
    for (let j = 0; j < m; j++) {
      let mx = 0;
      for (let a = 0; a < nv; a++) mx = Math.max(mx, Math.abs(J[j * nv + a]));
      for (let a = 0; a < nv; a++) if (Math.abs(J[j * nv + a]) < 1e-7 * mx) J[j * nv + a] = 0;
    }
    return J;
  };
  /** hmotnost: Choleského faktory těles (translace √m, rotace L·Lᵀ = I_w) */
  const factors = () => bodies.map((b, i) => ({ sm: Math.sqrt(b.mass), Lr: chol3(Iw(i)) }));
  /**
   * Hmotnostně vážená projekce rychlosti: nejbližší V' (v metrice M) s J_i·V' = b_i pro všechny řádky. Řádky J·𝓛⁻ᵀ se postupně
   * ortogonalizují (dvakrát – numerická stabilita); řádek, ze kterého zbude < 1e-6 jeho velikosti, je nadbytečný a vypadne.
   */
  const project = (V: Float64Array, rows: { j: Float64Array; b: number }[]): Float64Array => {
    if (!rows.length || !nv) return V;
    const F = factors();
    // W = 𝓛ᵀ·V
    const W = new Float64Array(nv);
    for (let i = 0; i < nb; i++) {
      const v: Vec3 = [V[i * 6], V[i * 6 + 1], V[i * 6 + 2]];
      const w: Vec3 = [V[i * 6 + 3], V[i * 6 + 4], V[i * 6 + 5]];
      const Lr = F[i].Lr;
      const lw: Vec3 = [Lr[0] * w[0] + Lr[3] * w[1] + Lr[6] * w[2], Lr[4] * w[1] + Lr[7] * w[2], Lr[8] * w[2]];
      for (let k = 0; k < 3; k++) {
        W[i * 6 + k] = F[i].sm * v[k];
        W[i * 6 + 3 + k] = lw[k];
      }
    }
    const Q: { q: Float64Array; beta: number }[] = [];
    for (const r of rows) {
      // K = J·𝓛⁻ᵀ: translace J/√m, rotace (𝓛⁻¹·Jᵀ)ᵀ
      const k = new Float64Array(nv);
      for (let i = 0; i < nb; i++) {
        for (let a = 0; a < 3; a++) k[i * 6 + a] = r.j[i * 6 + a] / F[i].sm;
        const y = fwd(F[i].Lr, [r.j[i * 6 + 3], r.j[i * 6 + 4], r.j[i * 6 + 5]]);
        for (let a = 0; a < 3; a++) k[i * 6 + 3 + a] = y[a];
      }
      let n0 = 0;
      for (let a = 0; a < nv; a++) n0 += k[a] * k[a];
      n0 = Math.sqrt(n0);
      if (!(n0 > 1e-300)) continue;
      let b = r.b;
      for (let pass = 0; pass < 2; pass++)
        for (const x of Q) {
          let d = 0;
          for (let a = 0; a < nv; a++) d += k[a] * x.q[a];
          for (let a = 0; a < nv; a++) k[a] -= d * x.q[a];
          b -= d * x.beta;
        }
      let n1 = 0;
      for (let a = 0; a < nv; a++) n1 += k[a] * k[a];
      n1 = Math.sqrt(n1);
      // nadbytečný řádek (i v mezích šumu numerické derivace): jinak by protichůdný cíl (motor tlačí pružinu na doraz) dal
      // obrovskou rychlost b / n1
      if (n1 < 1e-4 * n0) continue;
      // téměř závislý řádek s nesouhlasným cílem (doraz proti motoru) by dal rychlost řádově vyšší než všechno ostatní – takový
      // řádek je rozpor, ne vazba: vypustí se (motor a vazby mají přednost, doraz se nahlásí jako porušený)
      const scaleV = Math.abs(r.b) / n0 + W.reduce((m, x) => Math.max(m, Math.abs(x)), 0) + 1;
      if (Math.abs(b / n1) > 1e3 * scaleV) continue;
      for (let a = 0; a < nv; a++) k[a] /= n1;
      Q.push({ q: k, beta: b / n1 });
    }
    for (const x of Q) {
      let d = 0;
      for (let a = 0; a < nv; a++) d += x.q[a] * W[a];
      const c = d - x.beta;
      for (let a = 0; a < nv; a++) W[a] -= c * x.q[a];
    }
    // V = 𝓛⁻ᵀ·W
    const out = new Float64Array(nv);
    for (let i = 0; i < nb; i++) {
      const w = bwd(F[i].Lr, [W[i * 6 + 3], W[i * 6 + 4], W[i * 6 + 5]]);
      for (let k = 0; k < 3; k++) {
        out[i * 6 + k] = W[i * 6 + k] / F[i].sm;
        out[i * 6 + 3 + k] = w[k];
      }
    }
    return out;
  };
  /** řádky rovností v aktuálním stavu a čase t: J·V = −∂r/∂t */
  const eqRows = (t: number): EqRow[] => {
    setTime(t);
    const r0 = eqRes();
    const J = jac(eqRes, r0);
    const dtt = Math.max(1e-7, dt * 1e-3);
    setTime(t + dtt);
    const r1 = eqRes();
    setTime(t);
    const rows: EqRow[] = [];
    for (let i = 0; i < r0.length; i++) {
      const j = J.subarray(i * nv, (i + 1) * nv);
      let any = false;
      for (let a = 0; a < nv; a++) if (Math.abs(j[a]) > 1e-9) any = true;
      if (any) rows.push({ j: Float64Array.from(j), b: -((r1[i] ?? 0) - r0[i]) / dtt, i });
    }
    return rows;
  };
  const ZERO = new Float64Array(nv);
  /**
   * SHAKE: hmotnostně vážená oprava polohy na vazby a motory (rovnosti) – Newtonovy kroky δ = M⁻¹·Jᵀ·λ se stálou J z počátku kroku
   * (zbytek po předpovědi je O(dt²), každý krok ho zmenší o O(ω·dt)). Vrací součet posunutí (posuv těžiště, natočení kolem těžiště),
   * null = nekonverguje (rozpor vazeb nebo motoru) – volající pak použije řešič vazeb.
   */
  const shake = (rows: EqRow[]): Float64Array | null => {
    const total = new Float64Array(nv);
    for (let it = 0; it < 16; it++) {
      const r = eqRes();
      if (resNorm(r) < 1e-10) return total;
      const d = project(ZERO, rows.map((x) => ({ j: x.j, b: -(r[x.i] ?? 0) })));
      drift(d, 1);
      for (let a = 0; a < nv; a++) total[a] += d[a];
    }
    return resNorm(eqRes()) < 1e-7 ? total : null;
  };
  const gradOf = (l: Limit): Float64Array | null => {
    const v0 = l.value();
    if (v0 === null) return null;
    return jac(() => [l.value() ?? v0], [v0]);
  };
  const dotV = (j: Float64Array, V: Float64Array) => {
    let s = 0;
    for (let a = 0; a < nv; a++) s += j[a] * V[a];
    return s;
  };

  // síly (vnitřní jednotky): gravitace, pružiny + tlumiče, zadané síly / momenty, gyroskopický člen
  const loads = (D.loads ?? []).map((ld) => ({ ld, m: mates.find((x) => x.id === ld.mate)! }));
  let springNow: { id: string; force: number }[] = [];
  const forces = (V: Float64Array, acc?: { dampP: number; loadP: number }): Float64Array => {
    const F = new Float64Array(nv);
    const coms = bodies.map((_, i) => com(i));
    const vAt = (i: number, p: Vec3): Vec3 => add([V[i * 6], V[i * 6 + 1], V[i * 6 + 2]], cross([V[i * 6 + 3], V[i * 6 + 4], V[i * 6 + 5]], sub(p, coms[i])));
    const push = (i: number | undefined, f: Vec3, p: Vec3) => {
      if (i === undefined) return;
      const tq = cross(sub(p, coms[i]), f);
      for (let k = 0; k < 3; k++) {
        F[i * 6 + k] += f[k];
        F[i * 6 + 3 + k] += tq[k];
      }
    };
    if (gDir) bodies.forEach((b, i) => push(i, scale(gDir, b.mass * G_ACC), coms[i]));
    springNow = [];
    for (const s of springs) {
      if (s.rate === undefined) continue;
      const x = seatOf(s);
      if (!x) continue;
      const Lnow = x.tB - x.tA;
      if (!(Lnow < s.free)) {
        springNow.push({ id: s.c.id, force: 0 });
        continue;
      }
      const pA = add(x.P0, scale(x.u, x.tA));
      const pB = add(x.P0, scale(x.u, x.tB));
      const iA = bodyOf.get(s.a.compId);
      const iB = bodyOf.get(s.b.compId);
      const vA = iA !== undefined ? vAt(iA, pA) : ([0, 0, 0] as Vec3);
      const vB = iB !== undefined ? vAt(iB, pB) : ([0, 0, 0] as Vec3);
      const Ldot = dot(x.u, sub(vB, vA));
      const f = s.rate * (s.free - Lnow) - cDamp * Ldot; // N
      springNow.push({ id: s.c.id, force: f });
      if (acc) acc.dampP += cDamp * Ldot * Ldot * N; // ztrátový výkon tlumiče
      push(iA, scale(x.u, -f * N), pA);
      push(iB, scale(x.u, f * N), pB);
    }
    for (const { ld, m } of loads) {
      const PA = ctx.pose(m.a.compId);
      const PB = ctx.pose(m.b.compId);
      const gA = g(m.a);
      const gB = g(m.b);
      if (!PA || !PB || !gA || !gB) continue;
      const A = worldOf(PA, gA);
      const B = worldOf(PB, gB);
      const iA = bodyOf.get(m.a.compId);
      const iB = bodyOf.get(m.b.compId);
      const n = unit(B.normal);
      if (ld.kind === "force") {
        const f = scale(n, ld.value * N);
        push(iA, f, A.origin);
        push(iB, scale(f, -1), A.origin);
        if (acc) acc.loadP += dot(f, sub(iA !== undefined ? vAt(iA, A.origin) : [0, 0, 0], iB !== undefined ? vAt(iB, A.origin) : [0, 0, 0]));
      } else {
        const tq = scale(n, ld.value * 1e6); // N·m → kg·mm²/s²
        for (const [i, s] of [[iA, 1], [iB, -1]] as const) {
          if (i === undefined) continue;
          for (let k = 0; k < 3; k++) F[i * 6 + 3 + k] += s * tq[k];
        }
        const wA: Vec3 = iA !== undefined ? [V[iA * 6 + 3], V[iA * 6 + 4], V[iA * 6 + 5]] : [0, 0, 0];
        const wB: Vec3 = iB !== undefined ? [V[iB * 6 + 3], V[iB * 6 + 4], V[iB * 6 + 5]] : [0, 0, 0];
        if (acc) acc.loadP += dot(tq, sub(wA, wB));
      }
    }
    // gyroskopický člen −ω × (I·ω)
    bodies.forEach((_, i) => {
      const w: Vec3 = [V[i * 6 + 3], V[i * 6 + 4], V[i * 6 + 5]];
      const gy = cross(w, mv(Iw(i), w));
      for (let k = 0; k < 3; k++) F[i * 6 + 3 + k] -= gy[k];
    });
    return F;
  };
  /** zrychlení bez vazeb: M⁻¹·F */
  const accel = (V: Float64Array, acc?: { dampP: number; loadP: number }): Float64Array => {
    const F = forces(V, acc);
    const A = new Float64Array(nv);
    bodies.forEach((b, i) => {
      const Lr = chol3(Iw(i));
      const w = bwd(Lr, fwd(Lr, [F[i * 6 + 3], F[i * 6 + 4], F[i * 6 + 5]]));
      for (let k = 0; k < 3; k++) {
        A[i * 6 + k] = F[i * 6 + k] / b.mass;
        A[i * 6 + 3 + k] = w[k];
      }
    });
    return A;
  };
  let c0s: Vec3[] = [];
  const energy = (V: Float64Array): number => {
    let e = 0;
    bodies.forEach((b, i) => {
      const v: Vec3 = [V[i * 6], V[i * 6 + 1], V[i * 6 + 2]];
      const w: Vec3 = [V[i * 6 + 3], V[i * 6 + 4], V[i * 6 + 5]];
      e += 0.5 * b.mass * dot(v, v) + 0.5 * dot(w, mv(Iw(i), w));
      // tíže od výchozí polohy těžiště – bilance i vztažná energie nezávisí na tom, kde v prostoru model leží
      if (gDir) e -= b.mass * G_ACC * dot(gDir, sub(com(i), c0s[i] ?? com(i)));
    });
    for (const s of springs) {
      if (s.rate === undefined) continue;
      const x = seatOf(s);
      if (!x) continue;
      const d = s.free - (x.tB - x.tA);
      if (d > 0) e += 0.5 * s.rate * d * d * N;
    }
    return e * 1e-6; // J
  };
  const kinetic = (V: Float64Array) => bodies.reduce((s, b, i) => s + 0.5 * b.mass * (V[i * 6] ** 2 + V[i * 6 + 1] ** 2 + V[i * 6 + 2] ** 2) + 0.5 * dot([V[i * 6 + 3], V[i * 6 + 4], V[i * 6 + 5]], mv(Iw(i), [V[i * 6 + 3], V[i * 6 + 4], V[i * 6 + 5]])), 0) * 1e-6;

  // 5) výchozí stav: poloha na vazbách a mezích, rychlost podle motorů
  setTime(0);
  if (nb) solvePoses(poses, vars, posRes, { maxIter: 60, groups });
  rec = new Map();
  eqRes();
  state = new Map([...state, ...rec]);
  rec = null;
  c0s = bodies.map((_, i) => com(i));
  // řádky rovností na začátku kroku (J pro polovinu rázu a SHAKE) – po každém kroku řádky v nové poloze
  let rowsEq: EqRow[] = nb ? eqRows(0) : [];
  let V: Float64Array = nb ? project(new Float64Array(nv), rowsEq) : new Float64Array(0);
  const atBound = (l: Limit, v: number | null): "min" | "max" | null => {
    if (v === null) return null;
    const tol = 1e-6 * Math.max(1, Math.abs(l.min ?? l.max ?? 0));
    if (l.min !== undefined && v <= l.min + tol) return "min";
    if (l.max !== undefined && v >= l.max - tol) return "max";
    return null;
  };
  const contacts: DynContact[] = [];
  const openC = new Map<string, DynContact>();
  const prevBound = new Map<string, "min" | "max" | null>(limits.map((l) => [l.id, atBound(l, l.value())]));
  const contactOf = (l: Limit, side: "min" | "max", t: number) => {
    const k = `${l.id}:${side}`;
    let c = openC.get(k);
    if (!c) {
      c = contacts.find((x) => x.id === l.id && x.bound === side);
      if (!c) {
        c = { id: l.id, label: l.label, bound: side, limit: ((side === "min" ? l.min : l.max) ?? 0) * (l.unit === "°" ? DEG : 1), intervals: [], impacts: [], unit: l.unit };
        contacts.push(c);
      }
      c.intervals.push([t, t]);
      openC.set(k, c);
    }
    c.intervals[c.intervals.length - 1][1] = t;
  };
  for (const l of limits) {
    const s = prevBound.get(l.id);
    if (s) contactOf(l, s, 0);
  }

  // 6) integrace
  const timing: MotionTiming = { ms: 0, solveMs: 0, collideMs: 0, slowStep: null, vars: nv, groups: [...groups.members.values()].filter((m) => m.length).length };
  const steps: DynMotionStep[] = [];
  let collision: MotionResult["collision"] = null;
  let conflictSteps = 0;
  const e0 = energy(V);
  let eApplied = 0;
  let eDamp = 0;
  let eContact = 0;
  let driftMax = 0;
  let kinMax = kinetic(V);
  let springMax: DynInfo["springMax"] = null;
  const hasMotors = motors.length > 0;
  const hasSprings = springs.length > 0;
  let A0 = nb ? accel(V) : new Float64Array(0);
  let lastA = new Float64Array(nv);
  const peaks: Record<string, DynPeak> = Object.fromEntries(bodies.map((b, i) => [b.id, { v: Math.hypot(V[i * 6], V[i * 6 + 1], V[i * 6 + 2]), tv: 0, a: 0, ta: 0 }]));
  let frame = 0;
  const limitBroken = (l: Limit) => {
    const v = l.value();
    return v !== null && ((l.min !== undefined && v < l.min - 1e-3) || (l.max !== undefined && v > l.max + 1e-3));
  };
  let lastValid: DynMotionStep | null = null;
  let frozenBy: Limit[] = [];
  let lastTargets: number[] | null = null;
  /**
   * Neplatný (nefyzikální) INTEGRAČNÍ krok (kolo 7, oponent): porušená mez vazby a motor „na mezi chyba“, který ji pohání a žádá jinou
   * hodnotu než v posledním platném integračním kroku (jede, nebo po dojezdu stojí za mezí); bez platného předchůdce (porušeno už
   * v t = 0) vždy. Integrátor tělo za mezí protlačí (přednost má motor), takže poloha, rychlost, zrychlení, dotyky a síly pružin
   * v takovém kroku nejsou fyzikální: do špiček, dotyků, největší síly pružiny ani konečné energie nejdou a snímek nemá `dyn`.
   * Dřív se neplatnost určovala jen u snímků (`place` = poslední platný), statistiky dynamiky ale braly stav integrátoru –
   * „zdvih Z 30,35 mm“ a „dotyk 0,659–2 s“ vedle „ΔZ −15,205 mm“ téhož tělesa. Stejný příznak určuje i stav snímku (record).
   */
  let validTgt: number[] | null = null;
  let stepInvalid = false;
  const invalidAt = (prev: number[] | null): boolean => {
    if (!hasMotors) return false;
    const br = limits.filter((l) => !l.id.startsWith("spring:") && limitBroken(l));
    if (!br.length) return false;
    const inv = involved(br.map((l) => l.id));
    return motors.some((x, i) => inv.has(i) && limitMode(i) === "error" && (!validTgt || Math.abs(x.target - validTgt[i]) > 1e-9 || (prev !== null && Math.abs(x.target - prev[i]) > 1e-12)));
  };
  const markStep = (prev: number[] | null) => {
    stepInvalid = invalidAt(prev);
    if (!stepInvalid) validTgt = motors.map((x) => x.target);
  };
  const record = async (k: number, t: number, Vn: Float64Array, Aac: Float64Array, stepMs: number) => {
    const conflicts = live.filter((m) => resNorm(eqOf(m)) > 1e-3).map((m) => m.id);
    driveRes().forEach((r, i) => {
      if (Math.abs(r) > 1e-3) conflicts.push(`motor:${motors.filter((x) => !x.abs)[i]?.mo.id}`);
    });
    const broken: MateDev[] = [];
    for (const l of limits) {
      const v = l.value();
      // mez vazby porušená (doraz v rozporu s motorem); pružinu pod Ln hlásí souhrn pružin (✗ pod délkou na doraz)
      if (!l.id.startsWith("spring:") && v !== null && ((l.min !== undefined && v < l.min - 1e-3) || (l.max !== undefined && v > l.max + 1e-3))) {
        conflicts.push(l.id);
        const bound = l.min !== undefined && v < l.min ? l.min : l.max!;
        broken.push({ id: l.id, label: l.label, kind: "limit", value: v, ...(l.min !== undefined ? { min: l.min } : {}), ...(l.max !== undefined ? { max: l.max } : {}), dev: v - bound, unit: l.unit });
      }
    }
    const place: Record<string, Placement> = {};
    for (const c of comps) {
      const P = poses.get(c.id);
      if (P) place[c.id] = placementOf(P);
    }
    // motor na mezi (kolo 6): porušená mez při předepsaném pohybu motoru
    const wanted = hasMotors ? motors.map((x) => motorAt(x.mo, t, duration)) : [];
    // motor „chyba“, který žádá jinou hodnotu než v posledním platném kroku (jede, NEBO po dojezdu stojí za mezí), a porušená
    // mez = neplatný snímek (`stepInvalid` integračního kroku snímku, invalidAt); motory „stop“ zastaví. Dřív (kolo 6b) jen motor,
    // který v tomto snímku jel: motor, který dojel za mez a tam stál (rychlost 30.35 → zdvih skončí v 1 s), dal kroky 6–12 s Deskou A
    // 10,35 mm v přidržovači jako běžné polohy (oponent kola 6). Snímek bez platného předchůdce (porušeno už v kroku 0) je neplatný vždy.
    let status: MotionStep["status"];
    if (hasMotors && (broken.length || anyFrozen())) {
      if (broken.length && stepInvalid) status = "invalid";
      else {
        if (broken.length && freezeMoving(lastTargets ?? motors.map((x) => x.target), broken.map((b) => b.id))) frozenBy = limits.filter((l) => broken.some((b) => b.id === l.id));
        if (frozen.some((f, i) => f !== null && Math.abs(wanted[i] - f) > 1e-3)) status = "stopped";
      }
    }
    if (!anyFrozen()) frozenBy = [];
    // zastavený motor nedosáhl žádané hodnoty = nesplněný pohon, stejně jako v kinematice (motion.ts: `out.short` → vazba motoru /
    // `motor:id`). Dřív dynamika u zastavení na mezi psala „Vazby splněny ve všech krocích“ a conflicts=0, kinematika téhož
    // dokumentu „nesplněné vazby v N krocích“ + motion.conflict (oponent kola 6)
    if (status === "stopped")
      motors.forEach((x, i) => {
        const f = frozen[i];
        if (f === null || Math.abs(wanted[i] - f) <= 1e-3) return;
        const id = x.abs ? x.m.id : `motor:${x.mo.id}`;
        if (!conflicts.includes(id)) conflicts.push(id);
      });
    if (conflicts.length) conflictSteps++;
    if (status === "invalid" && lastValid) for (const id of Object.keys(place)) place[id] = lastValid.place[id] ?? place[id];
    const row: DynMotionStep = { i: frame++, t, motors: hasMotors && (anyFrozen() || status) ? wanted : motors.map((x) => x.target), place, conflicts };
    // neplatný snímek bez `dyn`: stav integrátoru za mezí (těleso protlačené dorazem) není poloha ani rychlost dílu (kolo 7)
    if (status !== "invalid") {
      const dyn: Record<string, DynStepBody> = {};
      bodies.forEach((b, i) => {
        dyn[b.id] = { p: com(i), v: [Vn[i * 6], Vn[i * 6 + 1], Vn[i * 6 + 2]], a: [Aac[i * 6], Aac[i * 6 + 1], Aac[i * 6 + 2]] };
      });
      row.dyn = dyn;
    }
    if (status) {
      row.status = status;
      row.cause = "motor";
      if (broken.length) row.devs = broken;
      else if (status === "stopped" && frozenBy.length)
        // mez, která motor zastavila (v poloze snímku na mezi = splněná) – „brání“ v motion.motor-limit
        row.devs = frozenBy.flatMap((l) => {
          const v = l.value();
          if (v === null) return [];
          const bound = l.min !== undefined && (l.max === undefined || Math.abs(v - l.min) <= Math.abs(v - l.max)) ? l.min : l.max!;
          return [{ id: l.id, label: l.label, kind: "limit" as const, value: v, ...(l.min !== undefined ? { min: l.min } : {}), ...(l.max !== undefined ? { max: l.max } : {}), dev: Math.abs(v - bound) <= 1e-3 ? 0 : v - bound, unit: l.unit }];
        });
      if (status === "stopped") row.reached = motors.map((x, i) => frozen[i] ?? x.target);
      if (status === "invalid") row.shows = lastValid?.i ?? 0;
    } else {
      lastValid = row;
      lastTargets = motors.map((x) => x.target);
    }
    // neplatný snímek: pružiny posledního platného (délka i síla – síla integrátoru za mezí je nefyzikální)
    if (hasSprings && status === "invalid" && lastValid?.springs) row.springs = { ...lastValid.springs };
    else if (hasSprings) {
      row.springs = springSteps(poseDoc(doc, place), g);
      // síla v kroku = pružina + tlumič (stejně jako v integraci)
      // (i pružina bez zadané tuhosti – tuhost z geometrie dílu)
      for (const s of springNow) if (row.springs[s.id]) row.springs[s.id] = { ...row.springs[s.id], force: s.force };
    }
    let collideMs = 0;
    if (study.collisions && opts.collide && (row.i % clashEvery === 0 || row.i === frameCount - 1)) {
      const tc = now();
      const clashes = await opts.collide(poseDoc(doc, place, row.springs));
      collideMs = now() - tc;
      timing.collideMs += collideMs;
      if (clashes.stats) {
        const a = (timing.clash ??= { pairs: 0, culled: 0, exact: 0, reused: 0, undetermined: 0 });
        for (const k2 of ["pairs", "culled", "exact", "reused", "undetermined"] as const) a[k2] += clashes.stats[k2] ?? 0;
      }
      row.clashes = clashes.map((c) => ({ ...c })); // i cesty listů (podsestavy), místo a třída (vlna 22, bod 5)
      const hit = row.clashes.find((c) => isFault(c.cls)); // první SKUTEČNÁ kolize
      if (hit && !collision) collision = { ...hit, step: row.i, t };
    }
    steps.push(row);
    if (!timing.slowStep || stepMs > timing.slowStep.ms) timing.slowStep = { i: row.i, ms: stepMs };
    opts.onStep?.(k, nSteps, { ms: stepMs, solveMs: stepMs - collideMs, collideMs });
  };
  forces(V); // síly pružin pro první záznam
  markStep(null);
  let eValid = e0;
  let tValid = 0;
  if (stepInvalid)
    bodies.forEach((b) => {
      peaks[b.id] = { v: 0, tv: 0, a: 0, ta: 0 };
    });
  await record(0, 0, V, new Float64Array(nv), 0);
  let lastYield = now();
  for (let k = 1; k <= nSteps; k++) {
    if (opts.cancel?.()) break;
    const t1 = k * dt;
    const tStep = now();
    if (!nb) {
      const prevT = motors.map((x) => x.target);
      setTime(t1);
      markStep(prevT);
      if (k % every === 0 || k === nSteps) await record(k, t1, V, new Float64Array(0), 0);
      continue;
    }
    const eBefore = energy(V);
    const pw = { dampP: 0, loadP: 0 };
    // polovina rázu s reakcemi vazeb (hmotnostně vážená projekce v poloze x, motory v čase t), posun
    let Vh: Float64Array = new Float64Array(nv);
    for (let a = 0; a < nv; a++) Vh[a] = V[a] + 0.5 * dt * A0[a];
    Vh = project(Vh, rowsEq);
    drift(Vh, dt);
    const tPrevTargets = motors.map((x) => x.target);
    setTime(t1);
    // oprava polohy na vazby a motory v čase t1: SHAKE (směr reakce vazby M⁻¹·Jᵀ) a stejná oprava do rychlosti v½ (RATTLE)
    const pred = snapshot();
    const dq = shake(rowsEq);
    if (dq) for (let a = 0; a < nv; a++) Vh[a] += dq[a] / dt;
    else restore(pred);
    const shook = snapshot();
    // překročené meze (doraz, Ln pružiny): hmotnostně vážená oprava polohy bez změny rychlosti; priorita vazby a motory > meze
    // vazeb > délka pružin na doraz (řádky v tomto pořadí, rozporný řádek projekce vypustí); bez pokroku (rozpor) se přestane
    let fixed = !!dq;
    if (dq && violation() > 1e-9) {
      let last = Infinity;
      for (let it = 0; it < 16; it++) {
        const e = violation();
        if (e <= 1e-9 || e > 0.5 * last) break;
        last = e;
        const r = eqRes();
        const list: { j: Float64Array; b: number }[] = rowsEq.map((x) => ({ j: x.j, b: -(r[x.i] ?? 0) }));
        for (const l of limits) {
          const v = l.value();
          if (v === null) continue;
          const to = l.min !== undefined && v < l.min ? l.min : l.max !== undefined && v > l.max ? l.max : null;
          const j = to === null ? null : gradOf(l);
          if (j) list.push({ j, b: to! - v });
        }
        drift(project(ZERO, list), 1);
      }
      fixed = ok(posResMates());
    }
    if (!fixed) {
      // řešič vazeb (nevážená nejmenší změna) – doraz v rozporu s vazbami / motorem (lis tlačí pružinu pod Ln): přednost mají
      // vazby a motor, pak meze vazeb; porušená délka pružiny na doraz se nahlásí (✗ pod délkou na doraz). Kompromis řešiče se
      // zahodí (naklonil by desky a pootočil je ve volném směru). Oprava polohy tu rychlost NEMĚNÍ.
      const base = shook;
      restore(base);
      vars.forEach((v, i) => (v.pivot = com(i)));
      solvePoses(poses, vars, posRes, { maxIter: 40, groups, reg: 1e-4 });
      if (!ok(posResMates())) {
        restore(base);
        solvePoses(poses, vars, posResMates, { maxIter: 40, groups, reg: 1e-4 });
        if (!ok(eqRes())) {
          restore(base);
          solvePoses(poses, vars, eqRes, { maxIter: 40, groups, reg: 1e-4 });
        }
      }
    }
    // rychlost v nové poloze: hmotnostně vážená projekce (vazby a motory v čase t1), pak druhá polovina rázu a dotyky na mezích
    const rowsN = eqRows(t1);
    const rows: { j: Float64Array; b: number }[] = [...rowsN];
    const Vp = project(Vh, rowsN);
    const A1 = accel(Vp, pw);
    let Vn: Float64Array = new Float64Array(nv);
    for (let a = 0; a < nv; a++) Vn[a] = Vp[a] + 0.5 * dt * A1[a];
    let touching = false;
    // platnost kroku v konečné poloze kroku (dál se mění jen rychlost) – neplatný krok nezapisuje dotyky ani nárazy (kolo 7)
    markStep(tPrevTargets);
    // ráz: příjezd na doraz (skok rychlosti v jednom kroku) – zrychlení kroku se nepočítá (drží se předchozí, do špičky nejde)
    let jolt = false;
    for (const l of limits) {
      const v = l.value();
      const side = atBound(l, v);
      const was = prevBound.get(l.id) ?? null;
      prevBound.set(l.id, side);
      if (!side) {
        for (const s of ["min", "max"] as const) openC.delete(`${l.id}:${s}`);
        continue;
      }
      const j = gradOf(l);
      if (!j) continue;
      const sgn = side === "min" ? 1 : -1; // dovolený směr: od meze
      const vn = sgn * dotV(j, Vn);
      const vPre = sgn * dotV(j, V); // rychlost před nárazem: na konci minulého kroku (po projekci – bez síly, kterou drží jiný doraz)
      // neplatný krok: dotyk se nezapíše a otevřený úsek se uzavře (těleso „na dorazu“ je za ním protlačené motorem)
      if (stepInvalid) for (const s of ["min", "max"] as const) openC.delete(`${l.id}:${s}`);
      else contactOf(l, side, t1);
      touching = true;
      if (vn >= 0 && was === side) continue; // trvající dotyk, odjíždí – bez omezení
      const impact = was !== side && vPre < -V_REST;
      if (impact && !stepInvalid) openC.get(`${l.id}:${side}`)!.impacts.push({ t: t1, v: -vPre * (l.unit === "°" ? DEG : 1) });
      const target = impact ? -eRest * vPre : Math.max(0, vn);
      if (vn < target || impact) {
        rows.push({ j, b: sgn * target });
        // příjezd na doraz, nebo znovu dopad v témže kroku (těleso od dorazu odskočilo – vPre > 0 – a síla ho vrátila): ráz;
        // klidový dotyk (vPre ≈ 0) jen ruší sílu do dorazu – zrychlení kroku platí
        if ((was !== side && vPre < 0) || Math.abs(vPre) > V_REST) jolt = true;
      }
    }
    Vn = project(Vn, rows);
    // záznam úhlů pro rozbalování, energie, zrychlení
    rec = new Map();
    eqRes();
    state = new Map([...state, ...rec]);
    rec = null;
    A0 = accel(Vn);
    rowsEq = rowsN;
    // zrychlení kroku = změna rychlosti / dt; v kroku s nárazem (ráz = skok rychlosti, „zrychlení“ by bylo Δv/dt podle kroku)
    // zůstane zrychlení předchozího kroku a do špičky se nepočítá
    const Aac = jolt ? Float64Array.from(lastA) : new Float64Array(nv);
    if (!jolt) for (let a = 0; a < nv; a++) Aac[a] = (Vn[a] - V[a]) / dt;
    lastA = Aac;
    V = Vn;
    // motor na mezi „stop“ (výchozí): mez vazby porušená předepsaným pohybem → motory drží hodnotu předchozího kroku (kolo 6)
    const brokenNow = hasMotors ? limits.filter((l) => !l.id.startsWith("spring:") && limitBroken(l)) : [];
    if (brokenNow.length && freezeMoving(tPrevTargets, brokenNow.map((l) => l.id))) frozenBy = brokenNow;
    eApplied += pw.loadP * dt * 1e-6;
    eDamp += pw.dampP * dt * 1e-6;
    const eAfter = energy(V);
    const stepErr = eAfter - eBefore - pw.loadP * dt * 1e-6 + pw.dampP * dt * 1e-6;
    if (touching) eContact -= stepErr;
    else driftMax = Math.max(driftMax, Math.abs(eAfter + eDamp + eContact - eApplied - e0));
    // špičky, největší síla pružiny a konečná energie jen z platných kroků (kolo 7)
    if (!stepInvalid) {
      kinMax = Math.max(kinMax, kinetic(V));
      eValid = eAfter;
      tValid = t1;
      for (const s of springNow) if (!springMax || Math.abs(s.force) > Math.abs(springMax.force)) springMax = { id: s.id, force: s.force, t: t1 };
      bodies.forEach((b, i) => {
        const pk = peaks[b.id];
        const vv = Math.hypot(V[i * 6], V[i * 6 + 1], V[i * 6 + 2]);
        const aa = Math.hypot(Aac[i * 6], Aac[i * 6 + 1], Aac[i * 6 + 2]);
        if (vv > pk.v) Object.assign(pk, { v: vv, tv: t1 });
        if (!jolt && aa > pk.a) Object.assign(pk, { a: aa, ta: t1 });
      });
    }
    const stepMs = now() - tStep;
    timing.solveMs += stepMs;
    if (k % every === 0 || k === nSteps) await record(k, t1, V, Aac, stepMs);
    // prohlížeč: občas uvolnit vlákno (průběh, zrušení)
    if (now() - lastYield > 100) {
      lastYield = now();
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  timing.ms = now() - tStart;
  // končí-li výpočet neplatným krokem, „na konci“ = poslední platný krok (stav integrátoru za mezí je nefyzikální)
  const eEnd = stepInvalid ? eValid : energy(V);
  // vztažná energie: pohybová energie (nebo práce sil / ztráta tlumením) – ne celková energie s polohovou energií tíže nebo
  // předpětím pružin, která by odchylku zmenšila podle toho, kde model leží
  const scaleE = Math.max(kinMax, Math.abs(eApplied), eDamp, 1e-12);
  const info: DynInfo = {
    dt,
    n: nSteps,
    every,
    ...(study.collisions && opts.collide ? { clashEvery } : {}),
    gravity: gDir,
    damping: cDamp,
    restitution: eRest,
    bodies,
    contacts,
    energy: { e0, end: eEnd, ...(stepInvalid ? { endT: tValid } : {}), applied: eApplied, damping: eDamp, contacts: eContact, drift: hasMotors ? null : driftMax / scaleE, kinMax, ref: scaleE },
    springMax,
    peaks,
    springRates: springs.map((s) => ({ id: s.c.id, rate: s.rate ?? null, source: s.rateSource })),
    ms: timing.ms,
  };
  return {
    steps,
    comps: comps.map((c) => ({ id: c.id, name: c.name })),
    motors: study.motors,
    collision,
    collisionsChecked: !!(study.collisions && opts.collide),
    conflictSteps,
    ...(s0.mates ? { mates: s0.mates } : {}),
    timing,
    motorInfo: motors.map((x) => ({ abs: x.abs, current: x.abs ? x.v0 : 0 })),
    ...(start0.length ? { start0 } : {}),
    dynamic: info,
  };
}

/** číslo do protokolu: desetinná tečka v EN, čárka v CS / DE */
const fmt = (v: number, d = 2) => {
  const s = String(Math.round(v * 10 ** d) / 10 ** d || 0);
  return getLang() === "en" ? s : s.replace(".", ",");
};
