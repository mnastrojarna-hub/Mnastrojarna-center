/**
 * Pohybová studie sestavy: motory (rotační na Souososti / Závěsu / Šroubu, lineární na Vzdálenosti / Drážce / Dráze / Souososti),
 * délka a počet kroků. V každém kroku se nastaví hodnota motorů a globální řešič (cad/mates-kin.ts) najde polohy všech komponent
 * při splnění všech vazeb včetně mechanických (Ozubení, Hřeben, Šroub, Vačka, Kardan) a mezí. Kroky navazují (výchozí poloha
 * = předchozí krok), úhly se rozbalují – motor tak umí i více otáček. Volitelně kontrola kolizí v každém kroku (callback do jádra)
 * a stopa bodu komponenty. Výsledek = tabulka poloh a natočení po krocích (CSV).
 * Čisté funkce bez jádra (geometrii ploch dodá volající jako v řešiči vazeb).
 */
import type { InterferenceStats } from "./asm-kernel";
import { clashCsvCell, motionClashSummary } from "./clash-report";
import { isFault, type MaybeClassified } from "./clash-rules";
import { instanceKey, rotMatrix } from "./assembly";
import { springComps, springMotionLines, springSteps, type SpringStep } from "./asm-spring";
import { getLang, tr } from "./i18n";
import { kinCluster, kinCtx, mateLost, memoGeo, MATE_LABEL, solveMates, type GeoProvider } from "./mates";
import { DEG, LINEAR_MOTOR_TYPES, ROTARY_MOTOR_TYPES, dofValue, initMate, kinResidual, L, pivotOf, placementOf, poseOf, rigidGroups, syncGroups, toWorld, wrap, type Pose } from "./mates-kin";
import { DEFAULT_STUDY_DURATION, JUMP_EPS, motorIsAbsolute, motorKeys, motorMeaningText, motorNotes, motorNum, motorStartTime, profileAt, type MotorInfo, type MotorNote } from "./motor-model";
import { levelLine, levelOf, studyMode, type LevelInfo, type StudyMode } from "./motion-mode";
import { condMet, condValue, crossTime, phaseFindings, phaseLines, phaseProblems, type CondProbe, type MotionEvent, type PhaseRun } from "./motion-phases";
import { groupLines, rigidMotionGroups } from "./motion-groups";
import { devText, eqResidual, freeLimits, isLimitMate, limitGap, mateDev, mateName, mateTerm, preferTerms, solveStep, springDev, springEnergyTerm, springStopTerm, springTerms, type MateDev, type Term } from "./motion-quasi";
import type { PoseAt } from "./motion-clearance";
import { clearanceCsvCells, clearanceCsvHead, clearanceSummaryLines } from "./clearance-report";
import type { CadDoc, Mate, MotionMotor, MotionStudy, Placement, Vec3 } from "./types";

/** dvojice kolize kroku (a, b = komponenty nejvyšší úrovně; cesty listů v podsestavách, místo průniku, třída – clash-rules.ts) */
export type MotionCollision = MaybeClassified;
/** Výsledek kontroly kolizí v kroku; `stats` = počty přesných / znovupoužitých / odfiltrovaných dvojic z jádra (přírůstková kontrola). */
export type MotionClashes = MotionCollision[] & { stats?: InterferenceStats };
/** Časy výpočtu studie [ms] pro protokol (Σ slow=, JSON timing) a průběh. */
export type MotionTiming = {
  ms: number;
  /** řešič vazeb (všechny kroky) */
  solveMs: number;
  /** kontrola kolizí (všechny kroky, včetně přenosu do jádra) */
  collideMs: number;
  /** nejpomalejší krok */
  slowStep: { i: number; ms: number } | null;
  /** neznámé řešiče (poloh na krok) a počet tuhých skupin ze zámků */
  vars: number;
  groups: number;
  /** součet počtů kontroly kolizí přes kroky (přesné průniky, znovupoužité, odfiltrované obálkou, nevyhodnotitelné) */
  clash?: InterferenceStats;
};
/**
 * Nález studie pro protokol: ⚠ `motion.conflict` ve tvaru registru kódů (engine/codes.ts, balík A1): klíč
 * „pohyb porušuje vazbu „{0}“ v kroku {1}“ s `args` = [vazba, krok nebo úsek kroků s časem, např. „27–40 (t = 1.35–2 s)“],
 * `text` = tentýž text v aktuálním jazyce (`codeEntry("motion.conflict", { args })` dá totéž). Jeden záznam na vazbu a souvislý
 * úsek kroků (`steps`, `t`), `step` = první krok; `mate` = id vazby („motor:…“ = motor nedosáhl hodnoty).
 */
export type MotionIssue = { code: "motion.conflict"; level: "warn"; step: number; steps: [number, number]; t: [number, number]; mate: string; args: [string, string]; text: string };
export type MotionStep = {
  i: number;
  /** čas [s] */
  t: number;
  /** hodnoty motorů v pořadí `study.motors` (° / mm, jak byly zadány) */
  motors: number[];
  /** umístění komponent nejvyšší úrovně */
  place: Record<string, Placement>;
  /** vazby (id), které se v kroku nepodařilo splnit; „motor:…“ = motor nedosáhl hodnoty */
  conflicts: string[];
  /** stopa bodu (světové souřadnice) */
  trace?: Vec3;
  /** kolize v kroku (jen při kontrole kolizí) */
  clashes?: MotionCollision[];
  /** pružiny (cad/asm-spring.ts): délka podle dosedacích ploch v kroku, síla, stav – id komponenty → stav */
  springs?: Record<string, SpringStep>;
  /**
   * stav kroku s konfliktem (vlna 22, bod 8; cad/motion-quasi.ts): „stopped“ = motor stojí na mezi (poloha je fyzikální, motor
   * nedosáhl hodnoty – `reached`), „invalid“ = neřešitelný krok: `place` je poslední platná poloha (krok `shows`), nikdy kompromis
   */
  status?: "stopped" | "invalid";
  /** proč krok neprošel: motor žádá hodnotu za mezí (`motor`), nebo si vazby odporují i bez motoru (`mates`) */
  cause?: "motor" | "mates";
  /** dosažené hodnoty motorů (krok, kde motor stojí na mezi) */
  reached?: number[];
  /** odchylky konfliktní množiny (vazby, dorazy pružin, motory) v poloze konfliktu – všechny (detail kroku) */
  devs?: MateDev[];
  /** neplatný krok: číslo kroku, jehož polohu ukazuje (poslední platný) */
  shows?: number;
  /** fáze studie, která v kroku platí (pořadí od 0; vlna 22, bod 3) */
  phase?: number;
};
/** motor, který začal později (okno, fáze) a hodnota vazby v okamžiku začátku se liší od jeho začátku – ⚠ motion.start-jump */
export type MotorStart = { motor: number; step: number; t: number; value: number; from: number };
/** Díl, jehož polohu vazby neurčují (volný v mezi): kinematika ho nechává, kde byl (⚠ motion.undetermined). */
export type MotionUndetermined = { comp: string; mates: string[]; springs: string[] };
export type MotionResult = {
  steps: MotionStep[];
  comps: { id: string; name: string }[];
  motors: MotionMotor[];
  /** první kolize (krok, čas, dvojice komponent) */
  collision: (MotionCollision & { step: number; t: number }) | null;
  collisionsChecked: boolean;
  /** počet kroků s nesplněnou vazbou */
  conflictSteps: number;
  /** vazby se doplněným výchozím stavem (uložit do dokumentu) */
  mates?: Mate[];
  /** časy výpočtu (protokol, průběh) */
  timing?: MotionTiming;
  /**
   * motory ve výchozí poloze studie (pořadí `motors`): je hodnota motoru hodnotou vazby (`abs`) a kolik vazba měří před pohybem
   * (`current`; u posuvu / natočení od výchozí polohy 0) – z toho ⚠ `motion.start-jump`, když začátek motoru neodpovídá (bod 11)
   */
  motorInfo?: MotorInfo[];
  /** úroveň simulace (cad/motion-mode.ts) – vypisuje se v každém protokolu studie */
  level?: LevelInfo;
  /** díly volné v mezi (vazbami neurčená poloha) – ⚠ motion.undetermined */
  undetermined?: MotionUndetermined[];
  /** průběh fází (vlna 22, bod 3; cad/motion-phases.ts) a časová osa událostí (začátky fází; procesní události doplní C3) */
  phases?: PhaseRun[];
  events?: MotionEvent[];
  /** motory, které začaly později se skokem hodnoty (⚠ motion.start-jump) */
  starts?: MotorStart[];
};

export const defaultStudy = (): MotionStudy => ({ motors: [], duration: DEFAULT_STUDY_DURATION, steps: 36 });

/**
 * Hodnota motoru v kroku `k` z `n`: profil motoru (cad/motor-model.ts `motorKeys` – rozsah „od–do“, tam a zpět, rychlost od hodnoty
 * „od“ bez konce, rozsah × rychlost se zastavením na „do“) v čase kroku.
 */
export function motorValue(mo: MotionMotor, k: number, n: number, duration: number): number {
  const t = n > 0 ? (duration * k) / n : 0;
  return profileAt(motorKeys(mo, duration), t, { k, n });
}

/** Proč motor nejde použít s danou vazbou (null = jde). */
export function motorProblem(mo: Pick<MotionMotor, "kind" | "mate">, mates: Mate[]): string | null {
  const m = mates.find((x) => x.id === mo.mate);
  if (!m) return tr("vazba motoru v sestavě není");
  if (m.suppressed) return tr("vazba motoru je potlačená");
  if (mateLost(m)) return tr("vazba motoru má ztracenou referenci plochy (díl se změnil) – vyberte plochu znovu: sestava vazby");
  const ok = mo.kind === "rotary" ? ROTARY_MOTOR_TYPES.has(m.type) : LINEAR_MOTOR_TYPES.has(m.type);
  if (!ok)
    return mo.kind === "rotary"
      ? tr("rotační motor potřebuje vazbu Souosost, Závěs nebo Šroub – vazba „{0}“ je {1}", m.name ?? tr(MATE_LABEL[m.type]), tr(MATE_LABEL[m.type]))
      : tr("lineární motor potřebuje vazbu Vzdálenost, Drážka, Dráha, Souosost nebo Šroub – vazba „{0}“ je {1}", m.name ?? tr(MATE_LABEL[m.type]), tr(MATE_LABEL[m.type]));
  return null;
}

/** Ukotvené komponenty (jako v řešiči vazeb): příznak, vazba Ukotvit, jinak první komponenta. */
function fixedOf(doc: CadDoc): (id: string) => boolean {
  const comps = doc.components ?? [];
  const fixed = new Set(comps.filter((c) => c.fixed).map((c) => c.id));
  for (const m of doc.mates ?? []) if (m.type === "fixed" && !m.suppressed) fixed.add(m.a.compId);
  if (!fixed.size && comps[0]) fixed.add(comps[0].id);
  return (id) => fixed.has(id) || !comps.some((c) => c.id === id);
}

/**
 * Výpočet pohybové studie. `collide` = kontrola kolizí sestavy v poloze kroku (jádro), volá se jen při `study.collisions`.
 * `onStep` hlásí průběh; `cancel()` = true výpočet ukončí (vrátí hotové kroky).
 */
export async function runMotion(
  doc: CadDoc,
  geo: GeoProvider,
  study: MotionStudy,
  opts: {
    collide?: (d: CadDoc) => Promise<MotionClashes>;
    onStep?: (k: number, n: number, info?: { ms: number; solveMs: number; collideMs: number }) => void;
    cancel?: () => boolean;
    /** po každém kroku: vůle a spojitá kontrola úseku (předchozí krok → tento) s mezipolohami z řešiče (vlna 22, bod 6 – motion-clearance.ts) */
    between?: (row: MotionStep, prev: MotionStep | null, poseAt: PoseAt) => Promise<void>;
  } = {},
): Promise<MotionResult> {
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const tStart = now();
  const comps = doc.components ?? [];
  const n = Math.max(1, Math.min(2000, Math.round(study.steps || 1)));
  const duration = study.duration > 0 ? study.duration : 1;
  // 1) výchozí stav: vyřešená sestava (zachytí i výchozí stav mechanických vazeb)
  const s0 = solveMates(doc, geo);
  const allMates = s0.mates ?? doc.mates ?? [];
  const phases = study.phases ?? [];
  // vazby, které některá fáze zapne, smí nést motor i podmínku, i když jsou v dokumentu potlačené
  const enabledLater = new Set(phases.flatMap((p) => p.enable ?? []));
  const usable = allMates.filter((m) => !m.suppressed || enabledLater.has(m.id)).map((m) => (m.suppressed ? { ...m, suppressed: false } : m));
  for (const mo of study.motors) {
    const p = motorProblem(mo, usable);
    if (p) throw new Error(tr("motor {0}: {1}", study.motors.indexOf(mo) + 1, p));
  }
  if (!study.motors.length) throw new Error(tr("pohybová studie nemá žádný motor – přidejte rotační nebo lineární motor"));
  for (const p of phaseProblems(study, allMates)) throw new Error(p);
  const g = memoGeo(geo);
  const poses = new Map<string, Pose>(s0.components.map((c) => [c.id, poseOf(c.placement)] as const));
  // 2) rozbalování úhlů: stav z předchozího kroku, nové hodnoty se zapíší jen při záznamu kroku
  let state = new Map<string, number>();
  let rec: Map<string, number> | null = null;
  const ctx = kinCtx(poses, g, (k, d) => {
    const prev = state.get(k);
    const v = prev === undefined ? wrap(d) : prev + wrap(d - prev);
    rec?.set(k, v);
    return v;
  });
  const isFixed = fixedOf(doc);
  // vazby v čase (fáze je zapínají / potlačují; zapnutá vazba zachytí nynější polohu) – definice podle id
  const defs = new Map(usable.map((m) => [m.id, m] as const));
  // ztracená reference plochy = vazba mimo pohyb (vlna 22, bod 20); motor na ní ohlásí motorProblem
  const off = new Set(allMates.filter((m) => m.suppressed || mateLost(m)).map((m) => m.id));
  const activeMates = () => allMates.filter((m) => !off.has(m.id)).map((m) => defs.get(m.id) ?? m);
  // motory: výchozí hodnota stupně volnosti (natočení vůči začátku, posuv) a vazba, kterou pohánějí; `start` = čas začátku
  // (null = motor fáze, která ještě nezačala); vazbu pohání motor, který na ní začal nejpozději (a už začal)
  const motors = study.motors.map((mo) => {
    const m = defs.get(mo.mate)!;
    const abs = motorIsAbsolute(mo, m);
    const v0 = dofValue(m, mo.kind, ctx);
    if (v0 === null) throw new Error(tr("motor {0}: chybí geometrie vazby „{1}“", study.motors.indexOf(mo) + 1, m.name ?? tr(MATE_LABEL[m.type])));
    const start: number | null = mo.phase ? null : motorStartTime(mo);
    return { mo, m, abs, v0, key: `motor:${mo.id}`, target: 0, start, prof: motorKeys(mo, duration, start ?? 0), started: false };
  });
  type Mo = (typeof motors)[number];
  let tNow = 0;
  const active = (x: Mo) => x.start !== null && x.start <= tNow + 1e-9 && !motors.some((y) => y !== x && y.m.id === x.m.id && y.start !== null && y.start > x.start! + 1e-12 && y.start <= tNow + 1e-9);
  const isDriven = (id: string) => motors.some((x) => x.abs && x.m.id === id && active(x));
  // členy kroku s prioritou (cad/motion-quasi.ts): tvrdé = vazby (u vazby, jejíž hodnotu motor přepisuje – Vzdálenost, Drážka
  // s polohou – jen její orientace, hodnota je pohon) a doraz Ln pružin; pohon = hodnota motoru; měkké = energie pružin (kvazistatika)
  // a preferovaná strana meze
  const hardOf = (m: Mate): number[] => {
    if (!isDriven(m.id)) return kinResidual(m, ctx) ?? [];
    const v = dofValue(m, "linear", ctx);
    return kinResidual(v === null ? m : { ...m, value: v }, ctx) ?? [];
  };
  /** hodnota stupně volnosti motoru (hodnota vazby / posuv / natočení od výchozí polohy) v nynější poloze */
  const motorNow = (x: Mo): number | null => {
    const v = dofValue(x.m, x.mo.kind, ctx);
    if (v === null) return null;
    if (x.abs) return v;
    return x.mo.kind === "rotary" ? ctx.ang(x.key, v - x.v0) * DEG : v - x.v0;
  };
  const driveTerms: Term[] = motors.map((x) => ({
    id: x.abs ? x.m.id : x.key,
    r: () => {
      const v = dofValue(x.m, x.mo.kind, ctx);
      if (v === null) return [0];
      // motor, který nepohání (ještě nezačal / vazbu převzal pozdější motor): žádný člen – úhel se ale dál rozbaluje
      if (!active(x)) {
        if (!x.abs && x.mo.kind === "rotary") ctx.ang(x.key, v - x.v0);
        return [0];
      }
      if (x.abs) return [v - x.target];
      if (x.mo.kind === "rotary") return [(ctx.ang(x.key, v - x.v0) - x.target / DEG) * L];
      return [v - x.v0 - x.target];
    },
  }));
  const comp = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? id;
  const timing: MotionTiming = { ms: 0, solveMs: 0, collideMs: 0, slowStep: null, vars: 0, groups: 0 };
  /**
   * Model kroku pro nynější množinu vazeb a režim (fáze ho mění): shluk řešiče, tuhé skupiny ze zámků (jedna poloha na skupinu –
   * méně neznámých a přesně neměnná vzájemná poloha; skupina zamčená k ukotvenému dílu je pevná), neznámé, pružiny a členy.
   */
  const build = (mode: { mode: StudyMode; auto: boolean; why?: string }) => {
    const mates = activeMates();
    const quasi = mode.mode === "quasistatic";
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
    const groupIds = (root: string) => new Set([root, ...(groups.members.get(root) ?? []).map((m) => m.id)]);
    const vars = [...roots].map((id) => ({ id, pivot: pivotOf(id, cl.mates, ctx, groups.members.get(id)?.length ? groupIds(id) : undefined) }));
    const rootOf = (id: string) => groups.rootOf.get(id) ?? id;
    const moving = (id: string) => roots.has(rootOf(id));
    const springs = springTerms(doc, ctx).filter((sp) => sp.seats.some(moving) || moving(sp.id));
    const solvedMates = mates.filter((m) => !groups.tree.has(m.id)); // zámky kostry skupin jsou splněné z definice
    const terms = {
      hard: [...solvedMates.map((m) => mateTerm(m, ctx, () => hardOf(m))), ...springs.filter((sp) => sp.solid !== undefined).map(springStopTerm)],
      drive: driveTerms,
      soft: [...(quasi ? springs.map(springEnergyTerm) : []), ...preferTerms(mates, ctx)],
    };
    timing.vars = Math.max(timing.vars, vars.length * 6);
    timing.groups = Math.max(timing.groups, [...groups.members.values()].filter((m) => m.length).length);
    return { mates, quasi, mode, groups, vars, rootOf, moving, springs, solvedMates, terms, mateById: new Map(mates.map((m) => [m.id, m] as const)) };
  };
  // režim a úroveň (cad/motion-mode.ts): kvazistatika = rovnováha pružin v každém kroku; kinematika = jen vazby (+ preference)
  const mode0 = studyMode(doc, study);
  let M = build(mode0);
  const motorOfTerm = (id: string) => motors.find((x) => (x.abs ? x.m.id : x.key) === id);
  /** odchylky konfliktní množiny v poloze konfliktu: vazby, dorazy pružin, motory (žádaná × dosažená hodnota) */
  const devsOf = (ids: string[], short: string[]): MateDev[] => {
    const out: MateDev[] = [];
    for (const id of short) {
      const x = motorOfTerm(id);
      if (!x) continue;
      const label = tr("motor {0}", motors.indexOf(x) + 1);
      const mi = motors.indexOf(x);
      if (x.abs) out.push({ ...mateDev({ ...x.m, value: x.target }, ctx, `${label}: ${mateName(x.m, comp)}`), id, motor: mi });
      else {
        const v = dofValue(x.m, x.mo.kind, ctx);
        const got = v === null ? NaN : x.mo.kind === "rotary" ? wrap(v - x.v0) * DEG : v - x.v0;
        out.push({ id, label, kind: "value", value: got, want: x.target, dev: got - x.target, unit: x.mo.kind === "rotary" ? "°" : "mm", motor: mi });
      }
    }
    for (const id of ids) {
      if (short.includes(id)) continue;
      const m = M.mateById.get(id);
      if (m) out.push(mateDev(m, ctx, mateName(m, comp)));
      else if (id.startsWith("spring:")) {
        const sp = M.springs.find((x) => `spring:${x.id}` === id);
        if (sp) out.push(springDev(sp, sp.name));
      }
    }
    return out;
  };
  /* ───── fáze (cad/motion-phases.ts): podmínky v poloze kroku, okamžik začátku, nastavení od začátku fáze ───── */
  const runs: PhaseRun[] = phases.map((ph, i) => ({ id: ph.id, name: ph.name, index: i, reached: false, mode: studyMode(doc, study, ph).mode, conflictSteps: 0, stopped: 0, invalid: 0 }));
  const events: MotionEvent[] = [];
  let cur = -1;
  /** hodnota vazby podmínky: Vzdálenost / Drážka s polohou = hodnota vazby, jinak posuv / natočení od výchozí polohy */
  const mate0 = new Map<string, number>();
  const mateNow = (id: string): number | null => {
    const m = defs.get(id);
    if (!m) return null;
    const rot = m.type === "angle" || m.type === "hinge" || m.type === "limitAngle";
    const v = dofValue(m, rot ? "rotary" : "linear", ctx);
    if (v === null) return null;
    if (motorIsAbsolute({ kind: "linear" }, m) || m.type === "limitDistance") return v;
    if (!mate0.has(id)) return 0;
    return rot ? wrap(v - mate0.get(id)!) * DEG : v - mate0.get(id)!;
  };
  for (const m of usable) {
    const rot = m.type === "angle" || m.type === "hinge" || m.type === "limitAngle";
    const v = dofValue(m, rot ? "rotary" : "linear", ctx);
    if (v !== null) mate0.set(m.id, v);
  }
  const probe = (t: number): CondProbe => ({
    t,
    mate: mateNow,
    motor: (id) => {
      const x = motors.find((y) => y.mo.id === id);
      return x ? motorNow(x) : null;
    },
  });
  /** konec poslední klíčové polohy motorů fáze `i` [s] (fáze bez podmínky začne, až dojedou) */
  const phaseMotorsEnd = (i: number): number | null => {
    const own = motors.filter((x) => x.mo.phase === phases[i]?.id);
    if (!own.length) return null;
    if (own.some((x) => x.start === null)) return Infinity;
    return Math.max(...own.map((x) => (x.prof.after.mode === "hold" ? x.prof.keys[x.prof.keys.length - 1].t : Infinity)));
  };
  /** začátek fáze `i` v kroku `k` v čase `t`: zapnout / potlačit vazby (zapnutá vazba zachytí nynější polohu), režim, motory fáze */
  const startPhase = (i: number, k: number, t: number) => {
    const ph = phases[i];
    cur = i;
    runs[i].reached = true;
    runs[i].step = k;
    runs[i].t = t;
    events.push({ kind: "phase", id: ph.id, step: k, t });
    for (const id of ph.suppress ?? []) off.add(id);
    for (const id of ph.enable ?? []) {
      off.delete(id);
      const m = defs.get(id);
      if (!m) continue;
      // zapnutá vazba drží díly tak, jak právě jsou: zámek si vezme nynější vzájemnou polohu, Vzdálenost nynější mezeru
      const base: Mate = { ...m, suppressed: false, rel: undefined, phase: undefined };
      if (m.type === "distance") {
        const v = dofValue(m, "linear", ctx);
        if (v !== null) base.value = v;
      }
      defs.set(id, initMate(base, ctx));
    }
    for (const x of motors) if (x.mo.phase === ph.id && x.start === null) {
      x.start = t;
      x.prof = motorKeys(x.mo, duration, t);
    }
    M = build(studyMode(doc, study, ph));
  };
  /** výpočet polohy v čase `t` z nynějších poloh (krok `frac` = bitově stejné hodnoty motorů jako dřív) */
  const solveAt = (t: number, frac?: { k: number; n: number }) => {
    tNow = t;
    // motor, který právě začíná (okno): hodnota vazby v okamžiku začátku proti začátku motoru (skok = ⚠ motion.start-jump)
    for (const x of motors)
      if (!x.started && active(x)) {
        x.started = true;
        const v = motorNow(x);
        const want = profileAt(x.prof, x.start!);
        if (t > 0 && v !== null && Math.abs(v - want) > JUMP_EPS) starts.push({ motor: motors.indexOf(x), step: frac?.k ?? -1, t: x.start!, value: v, from: want });
      }
    const vals = motors.map((x) => profileAt(x.prof, t, frac));
    motors.forEach((x, i) => (x.target = vals[i]));
    // krok s prioritou tvrdé ≫ motor ≫ měkké; motor na mezi: stop (stojí) / error (krok neplatný, poslední platná poloha)
    const out = solveStep(poses, M.vars, M.terms, {
      groups: M.groups,
      maxIter: 60,
      atLimit: (short) => (short.some((id) => motorOfTerm(id)?.mo.atLimit === "error") ? "error" : "stop"),
      describe: devsOf,
    });
    return { out, vals };
  };
  /** poloha a čas předchozího kroku (zpřesnění okamžiku začátku fáze mezi kroky) */
  let prevPoses: Map<string, Pose> | null = null;
  let tPrev = 0;
  /**
   * časové podmínky / „po dojetí motorů“ před výpočtem kroku `k`: okamžik τ mezi předchozím a tímto krokem se spočítá přesně
   * (poloha v τ, teprve pak se zapnou / potlačí vazby – zámek zachytí polohu v okamžiku začátku fáze, ne v nejbližším kroku)
   */
  const timeAdvance = (k: number, t: number) => {
    for (let guard = 0; guard < phases.length && cur + 1 < phases.length; guard++) {
      const i = cur + 1;
      const c = phases[i].start;
      let tau: number | null = null;
      if (!c) {
        const endPrev = i === 0 ? 0 : phaseMotorsEnd(i - 1);
        // první fáze bez podmínky: od začátku; další: až dojedou motory předchozí fáze (bez motorů hned další krok)
        if (i === 0) tau = 0;
        else if (endPrev === null) tau = k > (runs[i - 1].step ?? 0) ? t : null;
        else tau = endPrev <= t + 1e-9 ? Math.max(endPrev, runs[i - 1].t ?? 0) : null;
      } else if ("t" in c) tau = c.t <= t + 1e-9 ? Math.max(c.t, runs[i - 1]?.t ?? 0) : null;
      if (tau === null) break;
      if (k > 0 && tau > tPrev + 1e-9 && tau < t - 1e-9) solveAt(tau);
      startPhase(i, k, tau);
    }
  };
  const prevVal = new Map<number, { t: number; v: number }>();
  /**
   * podmínka hodnoty po výpočtu kroku `k`: splněná → okamžik τ se zpřesní sečnami mezi předchozím krokem a tímto (poloha v τ do
   * 0,001 mm / °), fáze začne v τ (zapnuté vazby zachytí polohu v τ) a krok `k` se spočítá znovu už s nastavením fáze; vrací true
   */
  const valueAdvance = (k: number, t: number): boolean => {
    let changed = false;
    for (let guard = 0; guard < phases.length && cur + 1 < phases.length; guard++) {
      const i = cur + 1;
      const c = phases[i].start;
      if (!c || "t" in c) break;
      const v = condValue(c, probe(t));
      if (v !== null) {
        const best = runs[i].value;
        runs[i].value = best === undefined ? v : c.op === "<=" ? Math.min(best, v) : Math.max(best, v);
      }
      if (!condMet(c, probe(t))) {
        if (v !== null) prevVal.set(i, { t, v });
        break;
      }
      let tau = t;
      const a0 = prevVal.get(i);
      if (a0 && v !== null && prevPoses && k > 0) {
        let a = a0;
        let b = { t, v };
        tau = crossTime(c, a, b);
        let solved = NaN;
        for (let it = 0; it < 6; it++) {
          for (const [id, P] of prevPoses) poses.set(id, P);
          solveAt(tau);
          solved = tau;
          const vm = condValue(c, probe(tau));
          if (vm === null || Math.abs(vm - c.value) < 1e-3 || b.t - a.t < 1e-9) break;
          if (condMet(c, probe(tau))) b = { t: tau, v: vm };
          else a = { t: tau, v: vm };
          const next = crossTime(c, a, b);
          if (Math.abs(next - tau) < 1e-12) break;
          tau = next;
        }
        if (solved !== tau) {
          for (const [id, P] of prevPoses) poses.set(id, P);
          solveAt(tau);
        }
        tau = Math.max(runs[i - 1]?.t ?? 0, tau);
      }
      runs[i].value = condValue(c, probe(tau)) ?? v ?? undefined;
      startPhase(i, k, tau);
      changed = true;
    }
    return changed;
  };
  const starts: MotorStart[] = [];
  const steps: MotionStep[] = [];
  let collision: MotionResult["collision"] = null;
  let conflictSteps = 0;
  let lastValid = 0;
  const trace = study.trace && poses.has(study.trace.compId) ? study.trace : undefined;
  const hasSprings = springComps(doc).length > 0;
  let undetermined: MotionUndetermined[] = [];
  /**
   * mezipoloha v čase `tm` pro zjemnění úseku (vlna 22, bod 6): řešič z polohy `seed` (předchozí krok) s motory v čase `tm`, úhly
   * se rozbalují vůči stavu posledního kroku; stav řešiče (polohy, cíle motorů) se pak obnoví. Nesplněné vazby → null.
   */
  const solveAt = (tm: number, seed: Record<string, Placement>): ReturnType<PoseAt> => {
    const keep = new Map(poses);
    const targets = motors.map((x) => x.target);
    try {
      for (const [id, pl] of Object.entries(seed)) if (poses.has(id)) poses.set(id, poseOf(pl));
      const vals = motors.map((x) => profileAt(x.prof, tm, { k: (tm / duration) * n, n }));
      motors.forEach((x, i) => (x.target = vals[i]));
      // týž krok s prioritou jako krok studie (motion-quasi.ts solveStep, vlna 22 bod 8); mezipoloha jen ze splněného kroku
      const out = solveStep(poses, vars, terms, { groups, maxIter: 60, atLimit: "error" });
      if (out.status !== "ok") return null;
      const place: Record<string, Placement> = {};
      for (const c of comps) {
        const P = poses.get(c.id);
        if (P) place[c.id] = placementOf(P);
      }
      return { place, motors: vals, t: tm };
    } finally {
      poses.clear();
      for (const [id, P] of keep) poses.set(id, P);
      motors.forEach((x, i) => (x.target = targets[i]));
    }
  };
  for (let k = 0; k <= n; k++) {
    if (opts.cancel?.()) break;
    const t = (duration * k) / n;
    const tStep = now();
    if (phases.length) timeAdvance(k, t);
    let { out, vals } = solveAt(t, { k, n });
    // podmínky hodnot v poloze kroku: fáze začne v přesném okamžiku a krok se spočítá znovu s jejím nastavením
    if (phases.length && valueAdvance(k, t)) ({ out, vals } = solveAt(t, { k, n }));
    timing.solveMs += now() - tStep;
    // díly volné v mezi (vazby jejich polohu neurčují): jednou na studii v poloze kroku 0
    if (k === 0) undetermined = findUndetermined();
    // záznam kroku: rozbalené úhly → stav pro další krok (vyhodnocení všech členů v poloze kroku zapíše rozbalené úhly motorů
    // a mechanických vazeb – Ozubení, Šroub, Hřeben – jako dřívější kontrola zbytků)
    rec = new Map();
    for (const t2 of M.terms.hard) t2.r();
    for (const t2 of M.terms.drive) t2.r();
    const conflicts = out.status === "ok" ? [] : [...new Set([...out.short.map((id) => (motorOfTerm(id)?.abs ? id : `motor:${motorOfTerm(id)?.mo.id ?? id}`)), ...out.blocking.filter((id) => M.mateById.get(id)?.type !== "fixed")])];
    const reached = out.status === "stopped" ? motors.map((x) => motorNow(x) ?? NaN) : undefined;
    state = new Map([...state, ...rec]);
    rec = null;
    if (conflicts.length) conflictSteps++;
    if (out.status !== "invalid") lastValid = k;
    const place: Record<string, Placement> = {};
    for (const c of comps) {
      const P = poses.get(c.id);
      if (P) place[c.id] = placementOf(P);
    }
    const row: MotionStep = { i: k, t, motors: vals, place, conflicts };
    if (out.status !== "ok") {
      row.status = out.status;
      if (out.cause) row.cause = out.cause;
      if (out.info) row.devs = out.info as MateDev[];
      if (reached) row.reached = reached;
      if (out.status === "invalid") row.shows = lastValid;
    }
    if (cur >= 0) {
      row.phase = cur;
      const r = runs[cur];
      r.end = k;
      if (conflicts.length) r.conflictSteps++;
      if (out.status === "stopped") r.stopped++;
      if (out.status === "invalid") r.invalid++;
    }
    if (trace) row.trace = toWorld(poses.get(trace.compId)!, trace.point);
    // pružiny: délka sleduje vzdálenost dosedacích ploch v poloze kroku (kolize pak s pružinou v této délce)
    if (hasSprings) row.springs = springSteps(poseDoc(doc, place), g);
    let collideMs = 0;
    if (study.collisions && opts.collide) {
      const tc = now();
      const clashes = await opts.collide(poseDoc(doc, place, row.springs));
      collideMs = now() - tc;
      timing.collideMs += collideMs;
      if (clashes.stats) {
        const a = (timing.clash ??= { pairs: 0, culled: 0, exact: 0, reused: 0, undetermined: 0 });
        for (const k2 of ["pairs", "culled", "exact", "reused", "undetermined"] as const) a[k2] += clashes.stats[k2] ?? 0;
      }
      row.clashes = clashes.map((c) => ({ ...c })); // i cesty listů (podsestavy), místo a třída (vlna 22, bod 5)
      const hit = row.clashes.find((c) => isFault(c.cls)); // první SKUTEČNÁ kolize (šroub v závitu není kolize)
      if (hit && !collision) collision = { ...hit, step: k, t };
    }
    // vůle a spojitá kontrola úseku (k−1, k) – mezipolohy řešičem (vlna 22, bod 6)
    if (opts.between) {
      const prev = steps[steps.length - 1] ?? null;
      await opts.between(row, prev, (tm) => solveAt(tm, prev?.place ?? place));
    }
    steps.push(row);
    if (phases.length) {
      prevPoses = new Map(poses);
      tPrev = t;
    }
    const stepMs = now() - tStep;
    if (!timing.slowStep || stepMs > timing.slowStep.ms) timing.slowStep = { i: k, ms: stepMs };
    opts.onStep?.(k, n, { ms: stepMs, solveMs: stepMs - collideMs, collideMs });
  }
  /**
   * Meze, jejichž hodnotu ostatní vazby a motory neurčují (cad/motion-quasi.ts freeLimits) a které neurčuje ani preference, ani –
   * v kvazistatice – pružina dosedající na tentýž díl (tuhou skupinu): poloha dílu v mezi je jen „kde zůstal“. Seskupeno po dílech.
   */
  function findUndetermined(): MotionUndetermined[] {
    const cand = M.mates.filter((m) => isLimitMate(m) && !m.prefer && [m.a, m.b].some((r) => M.moving(r.compId)));
    if (!cand.length) return [];
    const eq = () => [...M.solvedMates.flatMap((m) => (isLimitMate(m) ? eqResidual(m, ctx) : hardOf(m))), ...driveTerms.flatMap((d) => d.r())];
    const free = new Set(freeLimits(poses, M.vars, eq, cand.map((m) => ({ id: m.id, g: () => limitGap(m, ctx)?.g ?? 0 })), M.groups));
    const by = new Map<string, MotionUndetermined>();
    for (const m of cand) {
      if (!free.has(m.id)) continue;
      const own = M.moving(m.a.compId) ? m.a.compId : m.b.compId;
      const root = M.rootOf(own);
      const touching = M.springs.filter((sp) => sp.seats.some((id) => M.rootOf(id) === root) || M.rootOf(sp.id) === root);
      if (M.quasi && touching.length) continue; // pružina polohu určuje (rovnováha)
      const u = by.get(root) ?? { comp: own, mates: [], springs: touching.map((sp) => sp.name) };
      u.mates.push(m.id);
      by.set(root, u);
    }
    return [...by.values()];
  }
  timing.ms = now() - tStart;
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
    // fáze s jiným režimem: úroveň studie = nejvyšší použitá (kvazistatika > kinematika); po fázích ji uvádí řádek každé fáze
    level: runs.some((r) => r.reached && r.mode !== mode0.mode) ? { level: runs.some((r) => r.reached && r.mode === "quasistatic") || mode0.mode === "quasistatic" ? "quasistatic" : mode0.mode } : levelOf(mode0),
    ...(undetermined.length ? { undetermined } : {}),
    ...(runs.length ? { phases: runs, events } : {}),
    ...(starts.length ? { starts } : {}),
  };
}

/** Sestava s polohami komponent z kroku studie (zobrazení, kolize, export); `springs` = délky pružin v kroku. */
export function poseDoc(doc: CadDoc, place: Record<string, Placement>, springs?: Record<string, Pick<SpringStep, "length" | "offset"> & { seat?: number }> | null): CadDoc {
  return {
    ...doc,
    components: (doc.components ?? []).map((c) => {
      const p = place[c.id] ? { ...c, placement: place[c.id] } : c;
      const sp = springs?.[c.id];
      return sp && p.spring ? { ...p, spring: { ...p.spring, length: sp.length, offset: sp.offset, ...(sp.seat !== undefined ? { seat: sp.seat } : {}) } } : p;
    }),
  };
}

/** číslo do CSV (středník, desetinná čárka pro Excel) */
const num = (v: number, d = 4) => (Math.round(v * 10 ** d) / 10 ** d || 0).toString().replace(".", ",");
/** číslo do protokolu a popisu motoru: desetinná tečka v EN, čárka v CS / DE (souhrn dynamiky motion-dynamic-report.ts stejně) */
const txt = (v: number, d = 4) => {
  const s = (Math.round(v * 10 ** d) / 10 ** d || 0).toString();
  return getLang() === "en" ? s : s.replace(".", ",");
};

/**
 * Popis motoru: „lineární motor · ZDVIH „Deska A“ → „Rám“ · hodnota vazby 57,5 → 27,15 mm ↓ zdvih 30,35 mm · 15,175 mm/s · 2 s“ –
 * vždy začátek, konec (nebo výslovně „bez koncové hodnoty“), zdvih, směr a význam hodnot (hodnota vazby × posuv / natočení od
 * výchozí polohy); cad/motor-model.ts `motorMeaningText`. `duration` = délka studie (výchozí ze studie dokumentu).
 */
export function motorText(mo: MotionMotor, doc: CadDoc, duration = doc.motion?.duration ?? defaultStudy().duration): string {
  const m = doc.mates?.find((x) => x.id === mo.mate);
  const comp = (id?: string) => doc.components?.find((c) => c.id === id)?.name ?? "?";
  // motor fáze (vlna 22, bod 3): začne s fází – jmenovat ji
  const ph = mo.phase ? doc.motion?.phases?.find((p) => p.id === mo.phase) : undefined;
  const phase = mo.phase ? tr(" · začne s fází „{0}“", ph?.name ?? "?") : "";
  return `${mo.kind === "rotary" ? tr("rotační motor") : tr("lineární motor")} · ${m ? `${m.name ?? tr(MATE_LABEL[m.type])} „${comp(m.a.compId)}“ → „${comp(m.b.compId)}“` : tr("(vazba chybí)")} · ${motorMeaningText(mo, motorIsAbsolute(mo, m), duration)}${phase}`;
}

/**
 * Upozornění k motorům výsledku (⚠ s kódem – cad/motor-model.ts `motorNotes`): začátek jiný než aktuální hodnota vazby, motor
 * s rozsahem × rychlostí nedojede, mezera vazby pod nulou bez kontroly kolizí. Protokol je vypíše jako záznamy s kódem, panel
 * a `window.mncad.motion().summary` jako řádky souhrnu.
 */
export function motionMotorNotes(res: MotionResult, doc: CadDoc): MotorNote[] {
  const mates = res.mates ?? doc.mates ?? [];
  const duration = doc.motion?.duration ?? res.steps[res.steps.length - 1]?.t ?? 0;
  return motorNotes({ motors: res.motors, duration, collisions: res.collisionsChecked }, mates, (m) => m.name ?? tr(MATE_LABEL[m.type]), res.motorInfo);
}

/** Tabulka studie jako CSV (středník, desetinná čárka, BOM pro Excel): krok, čas, motory, poloha a natočení komponent, stopa, kolize. */
export function motionCsv(res: MotionResult, doc: CadDoc): string {
  const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = [tr("Krok"), tr("Čas [s]"), ...res.motors.map((mo, i) => `${tr("Motor {0}", i + 1)} [${mo.kind === "rotary" ? "°" : "mm"}]`)];
  // sloupce podle instance (stejné názvy „název #k“ / „název [přezdívka]“ – jinak by se sloupce nedaly rozlišit)
  const key = (id: string, fallback: string) => (doc.components?.some((c) => c.id === id) ? instanceKey(doc, id) : fallback);
  for (const c of res.comps) head.push(...["X", "Y", "Z", "RX", "RY", "RZ"].map((a) => `${key(c.id, c.name)} ${a}`));
  const hasTrace = res.steps.some((s) => s.trace);
  if (hasTrace) head.push(tr("Stopa X"), tr("Stopa Y"), tr("Stopa Z"));
  if (res.collisionsChecked) head.push(tr("Kolize"));
  head.push(tr("Nesplněné vazby"));
  // pružiny na konci řádku (dřívější sloupce zůstávají na svých místech): délka a síla
  const springIds = [...new Set(res.steps.flatMap((s) => Object.keys(s.springs ?? {})))];
  for (const id of springIds) head.push(`${key(id, id)} L [mm]`, `${key(id, id)} F [N]`);
  const clrHead = clearanceCsvHead(res, doc); // vůle sledovaných dvojic na konci řádku (vlna 22, bod 6)
  head.push(...clrHead);
  const lines = res.steps.map((s) => {
    const row = [String(s.i), num(s.t, 6), ...s.motors.map((v) => num(v, 6))];
    for (const c of res.comps) {
      const p = s.place[c.id];
      row.push(...(p ? [...p.position, ...p.rotation].map((v) => num(v, 6)) : ["", "", "", "", "", ""]));
    }
    if (hasTrace) row.push(...(s.trace ? s.trace.map((v) => num(v, 6)) : ["", "", ""]));
    // dynamika kontroluje kolize jen v každém k-tém snímku – ostatní „nekontrolováno“ (prázdná buňka = bez kolize)
    if (res.collisionsChecked) row.push(clashCsvCell(doc, s)); // dvojice s instancí a třídou (clash-report.ts)
    row.push(String(s.conflicts.length));
    for (const id of springIds) {
      const sp = s.springs?.[id];
      row.push(sp ? num(sp.length, 6) : "", sp?.force !== undefined ? num(sp.force, 3) : "");
    }
    if (clrHead.length) row.push(...clearanceCsvCells(res, s.i));
    return row.map(esc).join(";");
  });
  return "﻿" + [head.map(esc).join(";"), ...lines].join("\r\n") + "\r\n";
}

/** pod tímto úhlem [°] se komponenta za natáčenou nepovažuje (šum řešiče je řádově 1e-12°) */
export const ROT_EPS_DEG = 1e-4;
/**
 * Úhel [°] mezi dvěma natočeními zadanými Eulerovými úhly XYZ (jako `Placement.rotation`): 2·asin(‖R₁ − R₂‖_F / 2√2) – přesné i pro
 * malé úhly a nezávislé na zápisu (180 0 0 = −180 0 0 = 0 180 180).
 */
export function rotationAngleDeg(a: Vec3, b: Vec3): number {
  const A = rotMatrix(a);
  const B = rotMatrix(b);
  let f = 0;
  for (let i = 0; i < 9; i++) f += (A[i] - B[i]) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(f) / (2 * Math.SQRT2))) * 180) / Math.PI;
}

/** Souhrn výsledku do protokolu: kroky, rozsah pohybu komponent, kolize, nesplněné vazby. */
/**
 * `o.collisionLines`: řádky kolizí podle tříd (clash-thread.ts, asm-agent-kin.ts) místo řádku „první kolize“; `o.notes: false` =
 * bez řádků upozornění k motorům (protokol textových příkazů je vypíše jako záznamy s kódem – ne dvakrát)
 */
export function motionSummary(res: MotionResult, doc: CadDoc, o: { collisionLines?: string[]; notes?: boolean; detail?: boolean } = {}): string[] {
  const out: string[] = [];
  const last = res.steps[res.steps.length - 1];
  const first = res.steps[0];
  out.push(tr("Pohybová studie: {0} kroků · {1} s · motory: {2}", res.steps.length - 1, txt(last?.t ?? 0, 3), res.motors.map((m) => motorText(m, doc)).join("; ")));
  // úroveň simulace v každém protokolu studie (vlna 22, bod 2): kinematika × kvazistatika × dynamika
  if (res.level) out.push(levelLine(res.level));
  // fáze (vlna 22, bod 3): rozsah kroků, začátek, režim a nesplněné vazby po fázích
  if (res.phases?.length) out.push(...phaseLines(res.phases, doc, { motors: res.motors, phases: doc.motion?.phases }, (i) => res.steps[i]?.t ?? 0).map((l) => ` ${l}`));
  // výchozí výstup = jeden řádek na tuhou skupinu (vlna 22, bod 15); po dílech jen na vyžádání (`pohyb detail`)
  if (first && last && !o.detail) {
    const nm = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? res.comps.find((c) => c.id === id)?.name ?? id;
    out.push(...groupLines(rigidMotionGroups(res, doc), nm));
  }
  if (first && last && o.detail)
    for (const c of res.comps) {
      const pts = res.steps.map((s) => s.place[c.id]?.position).filter((p): p is Vec3 => !!p);
      if (!pts.length) continue;
      const span = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k])));
      // natočení vůči VÝCHOZÍMU stavu (krok 0, jinak poloha v dokumentu) jako úhel mezi maticemi – Eulerovy úhly ±180° (otočení 180 0 0)
      // jsou tatáž poloha, porovnání po složkách by hlásilo „natáčí se“ i u čistého posuvu (B11)
      const init = first.place[c.id]?.rotation ?? doc.components?.find((x) => x.id === c.id)?.placement.rotation;
      const turn = init ? Math.max(0, ...res.steps.map((s) => (s.place[c.id] ? rotationAngleDeg(init, s.place[c.id].rotation) : 0))) : 0;
      const rot = turn > ROT_EPS_DEG;
      if (span.every((v) => v < 1e-6) && !rot) continue;
      out.push(tr(" {0}: rozsah pohybu X {1} · Y {2} · Z {3} mm{4} · konec {5}", c.name, txt(span[0], 3), txt(span[1], 3), txt(span[2], 3), rot ? `${tr(" · natáčí se")} ${txt(turn, 3)}°` : "", `[${last.place[c.id].position.map((v) => txt(v, 3)).join("; ")}]`));
    }
  if (res.collisionsChecked && o.collisionLines) out.push(...o.collisionLines);
  // bez řádků od volajícího (panel pohybu): kolize podle tříd z výsledku (dvojice zařazené při výpočtu – clash-motion.ts)
  else if (res.collisionsChecked) out.push(...motionClashSummary(res, doc, { every: (res as { dynamic?: { clashEvery?: number } }).dynamic?.clashEvery }).lines);
  // „Vazby splněny“ jen tam, kde vazby polohu určují: díl volný v mezi (kinematika ho nechává, kde byl) = ⚠, ne výsledek (bod 2)
  const nm = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? id;
  out.push(...clearanceSummaryLines(res, doc)); // vůle sledovaných dvojic (vlna 22, bod 6 – clearance-report.ts)
  out.push(
    res.conflictSteps
      ? tr("⚠ nesplněné vazby v {0} krocích (mechanismus se zasekl nebo motor překročil meze)", res.conflictSteps)
      : res.undetermined?.length
        ? tr("⚠ vazby splněny ve všech krocích, ale polohu {0} neurčují – zobrazená poloha není fyzikální výsledek (motion.undetermined)", res.undetermined.map((u) => `„${nm(u.comp)}“`).join(", "))
        : tr("Vazby splněny ve všech krocích"),
  );
  if (res.steps.some((s) => s.springs)) out.push(...springMotionLines(doc, res.steps).map((l) => ` ${l}`)); // pružiny: délka, síla, doraz
  const issues = motionIssues(res, doc);
  for (const x of issues.slice(0, 4)) out.push(` ⚠ ${x.code} ${x.text}`);
  if (issues.length > 4) out.push(tr(" … a další úseky s nesplněnými vazbami: {0}", issues.length - 4));
  // motor na mezi, neřešitelné kroky, vazbami neurčená poloha (body 2 a 8) – protokol textových příkazů je vypíše jako záznamy s kódem
  if (o.notes !== false) for (const x of motionFindings(res, doc)) out.push(` ⚠ ${x.code} ${x.text}`);
  if (o.notes !== false) for (const x of motionMotorNotes(res, doc)) out.push(` ⚠ ${x.code} ${x.text}`);
  return out;
}

/** Nález studie s kódem (vlna 22, body 2 a 8): motor na mezi, neřešitelné kroky, vazbami neurčená poloha. */
export type MotionFinding = { code: "motion.motor-limit" | "motion.invalid" | "motion.undetermined" | "motion.phase-unreached" | "motion.start-jump"; args: string[]; text: string; steps?: [number, number] };

/** nejvýš tolik odchylek v souhrnném řádku (všechny vypíše `pohyb krok N`) */
const DEV_SUMMARY = 3;

/**
 * Nálezy studie: ⚠ `motion.motor-limit` (motor stojí na mezi – úsek kroků, žádaná × dosažená hodnota, co brání, příčina), ⚠
 * `motion.invalid` (neřešitelné kroky – zobrazena poslední platná poloha, konfliktní vazby s odchylkami, příčina) a ⚠
 * `motion.undetermined` (díl volný v mezi – vazby jeho polohu neurčují). Jeden řádek na souvislý úsek kroků se stejným stavem;
 * odchylky souhrnně (nejvýš tři), všechny vypíše `pohyb krok N`.
 */
export function motionFindings(res: MotionResult, doc: CadDoc): MotionFinding[] {
  const out: MotionFinding[] = [];
  const unitOf = (i: number) => (res.motors[i]?.kind === "rotary" ? "°" : " mm");
  const sec = (v: number) => String(Math.round(v * 1000) / 1000 || 0);
  const span = (a: MotionStep, b: MotionStep) => (a.i === b.i ? `${a.i} (t = ${sec(a.t)} s)` : `${a.i}–${b.i} (t = ${sec(a.t)}–${sec(b.t)} s)`);
  const key = (s: MotionStep) => (s.status ? `${s.status}|${s.cause}|${[...s.conflicts].sort().join(",")}` : "");
  let i = 0;
  while (i < res.steps.length) {
    const s0 = res.steps[i];
    if (!s0.status) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < res.steps.length && key(res.steps[j + 1]) === key(s0)) j++;
    const s1 = res.steps[j];
    const devs = s0.devs ?? [];
    const other = devs.filter((d) => d.motor === undefined);
    const list = (ds: typeof devs) => (ds.length ? ds.slice(0, DEV_SUMMARY).map(devText).join("; ") + (ds.length > DEV_SUMMARY ? tr(" … a další {0} (pohyb krok {1})", ds.length - DEV_SUMMARY, s0.i) : "") : tr("(nezjištěno)"));
    const when = span(s0, s1);
    if (s0.status === "stopped") {
      const k = res.motors.findIndex((_m, mi) => s0.reached && Math.abs(s0.reached[mi] - s0.motors[mi]) > 1e-3);
      const mi = k >= 0 ? k : 0;
      const want = s0.motors[mi] === s1.motors[mi] ? `${txt(s0.motors[mi], 3)}${unitOf(mi)}` : `${txt(s0.motors[mi], 3)} → ${txt(s1.motors[mi], 3)}${unitOf(mi)}`;
      const got = `${txt(s0.reached?.[mi] ?? NaN, 3)}${unitOf(mi)}`;
      const args = [String(mi + 1), when, list(other)];
      out.push({
        code: "motion.motor-limit",
        args,
        steps: [s0.i, s1.i],
        text: tr("motor {0} stojí na mezi v krocích {1}: žádáno {2}, dosaženo {3} – brání: {4}; příčina: motor žádá hodnotu, kterou tvrdé podmínky (meze, dorazy, pevné vazby) nedovolí – díly zůstávají fyzikálně (motor na mezi: stop; neplatné kroky místo zastavení: pohyb motor … na mezi chyba)", mi + 1, when, want, got, list(other)),
      });
    } else {
      const shows = s0.shows ?? 0;
      const cause =
        s0.cause === "mates"
          ? tr("vazby si odporují i bez motoru – opravte nebo potlačte některou z nich (sestava vazba N potlačit | hodnota)")
          : tr("motor žádá hodnotu, kterou tvrdé podmínky nedovolí (motor na mezi: chyba; zastavení motoru: pohyb motor … na mezi stop)");
      out.push({
        code: "motion.invalid",
        args: [when, String(shows), list(devs)],
        steps: [s0.i, s1.i],
        text: tr("neřešitelné kroky {0} – zobrazena poslední platná poloha (krok {1}), žádný kompromis; konflikt: {2}; příčina: {3}", when, shows, list(devs), cause),
      });
    }
    i = j + 1;
  }
  const mates = res.mates ?? doc.mates ?? [];
  const nm = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? id;
  const quasi = res.level?.level === "quasistatic";
  for (const u of res.undetermined ?? []) {
    const lim = u.mates
      .map((id) => mates.find((m) => m.id === id))
      .filter((m): m is Mate => !!m)
      .map((m) => {
        const no = mates.indexOf(m) + 1;
        const b = `⟨${m.min !== undefined ? txt(m.min, 3) : "−∞"}; ${m.max !== undefined ? txt(m.max, 3) : "∞"}⟩`;
        return tr("„{0}“ {1} (vazba {2})", m.name ?? tr(MATE_LABEL[m.type]), m.type === "slot" ? "" : b, no).replace("  ", " ");
      });
    const firstNo = (mates.findIndex((m) => m.id === u.mates[0]) + 1) || 1;
    const tail = quasi
      ? tr("bez pružiny a bez preferované strany zůstává, kde byla – sestava vazba {0} preferovat min|max", firstNo)
      : u.springs.length
        ? tr("kinematika ji nechává, kde byla (posune ji jen doraz meze) – pružina „{0}“ by ji tlačila: fyzikální poloha = pohyb kvazistatika (nebo sestava vazba {1} preferovat min|max)", u.springs[0], firstNo)
        : tr("kinematika ji nechává, kde byla (posune ji jen doraz meze), a výsledek závisí na předchozím pohybu – sestava vazba {0} preferovat min|max, nebo pružina a pohyb kvazistatika", firstNo);
    out.push({ code: "motion.undetermined", args: [nm(u.comp), lim.join(", ")], text: tr("poloha „{0}“ není vazbami určena (volná v mezi {1}) – {2}", nm(u.comp), lim.join(", "), tail) });
  }
  // fáze, které nenastaly, a motory, které začaly později se skokem (vlna 22, bod 3)
  if (res.phases?.length) for (const f of phaseFindings(res.phases, doc, { motors: res.motors, phases: doc.motion?.phases })) out.push(f);
  for (const x of res.starts ?? []) {
    const mo = res.motors[x.motor];
    const u = (v: number) => `${motorNum(v)}${mo?.kind === "rotary" ? "°" : " mm"}`;
    out.push({
      code: "motion.start-jump",
      args: [String(x.motor + 1), u(x.from), u(x.value)],
      steps: [x.step, x.step],
      text: tr("motor {0} začíná v {1} s (krok {2}) na {3}, vazba je v tu chvíli na {4} – díl přeskočí o {5}; začátek motoru nastavte na hodnotu v okamžiku začátku", x.motor + 1, motorNum(x.t, 3), x.step, u(x.from), u(x.value), u(Math.abs(x.value - x.from))),
    });
  }
  return out;
}

/**
 * Tuhé skupiny pohybu pro jeden souhrnný řádek studie (zkouška 959, B6: „36 komp. 50 mm · 1 komp. 20 mm · 33 stojí“
 * místo rozsahu každé komponenty): komponenty s neměnnou vzájemnou polohou (cad/motion-groups.ts – tolerance, ne zaokrouhlení)
 * a bez natočení tvoří skupinu; `travel` = největší vzdálenost od výchozí polohy. Natáčející se komponenty se počítají zvlášť
 * (`rotating`). Skupiny podle počtu komponent sestupně, pak podle zdvihu.
 */
export function motionGroups(res: MotionResult, doc?: CadDoc): { moving: { n: number; travel: number }[]; still: number; rotating: number } {
  // tuhé skupiny s tolerancí (cad/motion-groups.ts) místo zaokrouhleného posunutí – jedna skupina se už nerozpadne na „58 + 1“
  const g = rigidMotionGroups(res, doc);
  const rot = g.moving.filter((x) => x.turn > ROT_EPS_DEG);
  const moving = g.moving.filter((x) => x.turn <= ROT_EPS_DEG).map((x) => ({ n: x.n, travel: x.travel }));
  return { moving, still: g.still.length, rotating: rot.reduce((s2, x) => s2 + x.n, 0) };
}

/** Popis vazby pro hlášení (uvnitř uvozovek klíče): „Mez vzdálenosti Stírací deska → Kotevní deska“; motor: „motor 1: Vzdálenost …“. */
function mateLabel(id: string, res: MotionResult, doc: CadDoc): string {
  const mates = res.mates ?? doc.mates ?? [];
  const nm = (cid: string) => doc.components?.find((c) => c.id === cid)?.name ?? cid;
  const label = (m: Mate) => `${m.name ?? tr(MATE_LABEL[m.type])} ${nm(m.a.compId)} → ${nm(m.b.compId)}`;
  if (id.startsWith("motor:")) {
    const k = res.motors.findIndex((m) => m.id === id.slice(6));
    const m = mates.find((x) => x.id === res.motors[k]?.mate);
    return tr("motor {0}", k + 1) + (m ? `: ${label(m)}` : "");
  }
  if (id.startsWith("spring:")) {
    const c = doc.components?.find((x) => x.id === id.slice(7));
    return tr("doraz pružiny „{0}“ (délka na doraz Ln)", c?.name ?? id.slice(7));
  }
  const m = mates.find((x) => x.id === id);
  return m ? label(m) : id;
}

/**
 * Nesplněné vazby po krocích pro protokol: ⚠ `motion.conflict` (viz `MotionIssue`) – jeden záznam na vazbu a souvislý úsek kroků,
 * v pořadí prvního kroku a pak pořadí vazby v dokumentu (motory za vazbami). Nezávisí na id vazeb (náhodná `uid()`), takže stejný
 * skript dá vždy stejný protokol. Prázdné, když jsou vazby splněné ve všech krocích.
 */
export function motionIssues(res: MotionResult, doc: CadDoc): MotionIssue[] {
  const mates = res.mates ?? doc.mates ?? [];
  const order = new Map<string, number>(mates.map((m, i) => [m.id, i]));
  res.motors.forEach((m, i) => order.set(`motor:${m.id}`, mates.length + i));
  const rank = (id: string) => order.get(id) ?? Number.MAX_SAFE_INTEGER;
  const byRank = (a: string, b: string) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
  const out: MotionIssue[] = [];
  let open = new Map<string, MotionIssue>();
  for (const s of res.steps) {
    const next = new Map<string, MotionIssue>();
    for (const id of [...new Set(s.conflicts)].sort(byRank)) {
      const cur = open.get(id);
      if (cur && cur.steps[1] === s.i - 1) {
        cur.steps[1] = s.i;
        cur.t[1] = s.t;
        next.set(id, cur);
        continue;
      }
      const x: MotionIssue = { code: "motion.conflict", level: "warn", step: s.i, steps: [s.i, s.i], t: [s.t, s.t], mate: id, args: ["", ""], text: "" };
      out.push(x);
      next.set(id, x);
    }
    open = next;
  }
  // čísla v argumentech s tečkou (gramatika protokolu, stejné ve všech jazycích); lokalizovaný je jen název druhu vazby a klíč
  const sec = (v: number) => String(Math.round(v * 1000) / 1000 || 0);
  for (const x of out) {
    const when = x.steps[0] === x.steps[1] ? `${x.steps[0]} (t = ${sec(x.t[0])} s)` : `${x.steps[0]}–${x.steps[1]} (t = ${sec(x.t[0])}–${sec(x.t[1])} s)`;
    x.args = [mateLabel(x.mate, res, doc), when];
    x.text = tr("pohyb porušuje vazbu „{0}“ v kroku {1}", x.args[0], x.args[1]);
  }
  return out;
}
