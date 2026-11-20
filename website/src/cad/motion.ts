/**
 * Pohybová studie sestavy: motory (rotační na Souososti / Závěsu / Šroubu, lineární na Vzdálenosti / Drážce / Dráze / Souososti),
 * délka a počet kroků. V každém kroku se nastaví hodnota motorů a globální řešič (cad/mates-kin.ts) najde polohy všech komponent
 * při splnění všech vazeb včetně mechanických (Ozubení, Hřeben, Šroub, Vačka, Kardan) a mezí. Kroky navazují (výchozí poloha
 * = předchozí krok), úhly se rozbalují – motor tak umí i více otáček. Volitelně kontrola kolizí v každém kroku (callback do jádra)
 * a stopa bodu komponenty. Výsledek = tabulka poloh a natočení po krocích (CSV).
 * Čisté funkce bez jádra (geometrii ploch dodá volající jako v řešiči vazeb).
 */
import type { InterferenceStats } from "./asm-kernel";
import { instanceKey, rotMatrix } from "./assembly";
import { springComps, springMotionLines, springSteps, type SpringStep } from "./asm-spring";
import { getLang, tr } from "./i18n";
import { kinCluster, kinCtx, mateLost, memoGeo, MATE_LABEL, solveMates, type GeoProvider } from "./mates";
import { DEG, LINEAR_MOTOR_TYPES, ROTARY_MOTOR_TYPES, dofValue, kinResidual, L, pivotOf, placementOf, poseOf, resNorm, rigidGroups, solvePoses, syncGroups, toWorld, wrap, type Pose } from "./mates-kin";
import { motorIsAbsolute, motorKeys, motorMeaningText, motorNotes, profileAt, type MotorInfo, type MotorNote } from "./motor-model";
import type { CadDoc, Mate, MotionMotor, MotionStudy, Placement, Vec3 } from "./types";

/** dvojice kolize kroku (a, b = komponenty nejvyšší úrovně; cesty listů v podsestavách – zařazení šroub × závit) */
export type MotionCollision = { a: string; b: string; volume: number; aPath?: string[]; bPath?: string[] };
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
};
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
};

export const defaultStudy = (): MotionStudy => ({ motors: [], duration: 2, steps: 36 });

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
  opts: { collide?: (d: CadDoc) => Promise<MotionClashes>; onStep?: (k: number, n: number, info?: { ms: number; solveMs: number; collideMs: number }) => void; cancel?: () => boolean } = {},
): Promise<MotionResult> {
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const tStart = now();
  const comps = doc.components ?? [];
  const n = Math.max(1, Math.min(2000, Math.round(study.steps || 1)));
  const duration = study.duration > 0 ? study.duration : 1;
  // 1) výchozí stav: vyřešená sestava (zachytí i výchozí stav mechanických vazeb)
  const s0 = solveMates(doc, geo);
  const mates = (s0.mates ?? doc.mates ?? []).filter((m) => !m.suppressed && !mateLost(m)); // ztracená reference = mimo pohyb (bod 20)
  for (const mo of study.motors) {
    const p = motorProblem(mo, s0.mates ?? doc.mates ?? []);
    if (p) throw new Error(tr("motor {0}: {1}", study.motors.indexOf(mo) + 1, p));
  }
  if (!study.motors.length) throw new Error(tr("pohybová studie nemá žádný motor – přidejte rotační nebo lineární motor"));
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
  // motory: výchozí hodnota stupně volnosti (natočení vůči začátku, posuv) a vazba, kterou pohánějí
  const motors = study.motors.map((mo) => {
    const m = mates.find((x) => x.id === mo.mate)!;
    const abs = motorIsAbsolute(mo, m);
    const v0 = dofValue(m, mo.kind, ctx);
    if (v0 === null) throw new Error(tr("motor {0}: chybí geometrie vazby „{1}“", study.motors.indexOf(mo) + 1, m.name ?? tr(MATE_LABEL[m.type])));
    return { mo, m, abs, v0, key: `motor:${mo.id}`, target: 0, prof: motorKeys(mo, duration) };
  });
  // vazby, jejichž hodnotu motor přepisuje (Vzdálenost, Drážka s polohou) – motor nahradí jejich hodnotu
  const valueOf = new Map<string, () => number>();
  for (const x of motors) if (x.abs) valueOf.set(x.m.id, () => x.target);
  const active = () => mates.map((m) => (valueOf.has(m.id) ? { ...m, value: valueOf.get(m.id)!() } : m));
  const driveRes = (): number[] =>
    motors.flatMap((x) => {
      if (x.abs) return [];
      const v = dofValue(x.m, x.mo.kind, ctx);
      if (v === null) return [];
      if (x.mo.kind === "rotary") return [(ctx.ang(x.key, v - x.v0) - x.target / DEG) * L];
      return [v - x.v0 - x.target];
    });
  const seeds = new Set(mates.flatMap((m) => [m.a, m.b, m.c, m.d].flatMap((r) => (r ? [r.compId] : []))));
  const cl = kinCluster(mates, seeds, isFixed);
  // tuhé skupiny ze zámků: jedna poloha na skupinu (kořen), členové se odvodí – méně neznámých a přesně neměnná vzájemná poloha
  // (podmínka znovupoužití dvojic v přírůstkové kontrole kolizí); skupina zamčená k ukotvenému dílu je pevná
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
  const timing: MotionTiming = { ms: 0, solveMs: 0, collideMs: 0, slowStep: null, vars: vars.length * 6, groups: [...groups.members.values()].filter((m) => m.length).length };
  const steps: MotionStep[] = [];
  let collision: MotionResult["collision"] = null;
  let conflictSteps = 0;
  const trace = study.trace && poses.has(study.trace.compId) ? study.trace : undefined;
  const hasSprings = springComps(doc).length > 0;
  for (let k = 0; k <= n; k++) {
    if (opts.cancel?.()) break;
    const t = (duration * k) / n;
    const vals = motors.map((x) => profileAt(x.prof, t, { k, n }));
    motors.forEach((x, i) => (x.target = vals[i]));
    const tStep = now();
    const ms = active();
    // zámky kostry skupin jsou splněné z definice – řešič je nevyhodnocuje (kontrola konfliktů níže ano)
    const solved = ms.filter((m) => !groups.tree.has(m.id));
    const resid = () => [...solved.flatMap((m) => kinResidual(m, ctx) ?? []), ...driveRes()];
    solvePoses(poses, vars, resid, { maxIter: 60, groups });
    timing.solveMs += now() - tStep;
    // záznam kroku: rozbalené úhly → stav pro další krok
    rec = new Map();
    const conflicts = ms.filter((m) => m.type !== "fixed" && resNorm(kinResidual(m, ctx)) > 1e-3).map((m) => m.id);
    driveRes().forEach((r, i) => {
      if (Math.abs(r) > 1e-3) conflicts.push(`motor:${motors.filter((x) => !x.abs)[i]?.mo.id}`);
    });
    state = new Map([...state, ...rec]);
    rec = null;
    if (conflicts.length) conflictSteps++;
    const place: Record<string, Placement> = {};
    for (const c of comps) {
      const P = poses.get(c.id);
      if (P) place[c.id] = placementOf(P);
    }
    const row: MotionStep = { i: k, t, motors: vals, place, conflicts };
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
      row.clashes = clashes.map((c) => ({ a: c.a, b: c.b, volume: c.volume }));
      if (row.clashes.length && !collision) collision = { ...row.clashes[0], step: k, t };
    }
    steps.push(row);
    const stepMs = now() - tStep;
    if (!timing.slowStep || stepMs > timing.slowStep.ms) timing.slowStep = { i: k, ms: stepMs };
    opts.onStep?.(k, n, { ms: stepMs, solveMs: stepMs - collideMs, collideMs });
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
  return `${mo.kind === "rotary" ? tr("rotační motor") : tr("lineární motor")} · ${m ? `${m.name ?? tr(MATE_LABEL[m.type])} „${comp(m.a.compId)}“ → „${comp(m.b.compId)}“` : tr("(vazba chybí)")} · ${motorMeaningText(mo, motorIsAbsolute(mo, m), duration)}`;
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
  const name = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? id;
  const lines = res.steps.map((s) => {
    const row = [String(s.i), num(s.t, 6), ...s.motors.map((v) => num(v, 6))];
    for (const c of res.comps) {
      const p = s.place[c.id];
      row.push(...(p ? [...p.position, ...p.rotation].map((v) => num(v, 6)) : ["", "", "", "", "", ""]));
    }
    if (hasTrace) row.push(...(s.trace ? s.trace.map((v) => num(v, 6)) : ["", "", ""]));
    // dynamika kontroluje kolize jen v každém k-tém snímku – ostatní „nekontrolováno“ (prázdná buňka = bez kolize)
    if (res.collisionsChecked) row.push(s.clashes ? s.clashes.map((x) => `${name(x.a)} × ${name(x.b)}`).join(", ") : tr("nekontrolováno"));
    row.push(String(s.conflicts.length));
    for (const id of springIds) {
      const sp = s.springs?.[id];
      row.push(sp ? num(sp.length, 6) : "", sp?.force !== undefined ? num(sp.force, 3) : "");
    }
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
export function motionSummary(res: MotionResult, doc: CadDoc, o: { collisionLines?: string[]; notes?: boolean } = {}): string[] {
  const out: string[] = [];
  const last = res.steps[res.steps.length - 1];
  const first = res.steps[0];
  out.push(tr("Pohybová studie: {0} kroků · {1} s · motory: {2}", res.steps.length - 1, txt(last?.t ?? 0, 3), res.motors.map((m) => motorText(m, doc)).join("; ")));
  if (first && last)
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
  else if (res.collisionsChecked) {
    const nm = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? id;
    out.push(res.collision ? tr("⚠ první kolize v kroku {0} (t = {1} s): „{2}“ × „{3}“ ({4} mm³)", res.collision.step, txt(res.collision.t, 3), nm(res.collision.a), nm(res.collision.b), txt(res.collision.volume, 3)) : tr("Kolize: žádné ve všech krocích"));
  }
  out.push(res.conflictSteps ? tr("⚠ nesplněné vazby v {0} krocích (mechanismus se zasekl nebo motor překročil meze)", res.conflictSteps) : tr("Vazby splněny ve všech krocích"));
  if (res.steps.some((s) => s.springs)) out.push(...springMotionLines(doc, res.steps).map((l) => ` ${l}`)); // pružiny: délka, síla, doraz
  const issues = motionIssues(res, doc);
  for (const x of issues.slice(0, 4)) out.push(` ⚠ ${x.code} ${x.text}`);
  if (issues.length > 4) out.push(tr(" … a další úseky s nesplněnými vazbami: {0}", issues.length - 4));
  if (o.notes !== false) for (const x of motionMotorNotes(res, doc)) out.push(` ⚠ ${x.code} ${x.text}`);
  return out;
}

/**
 * Tuhé skupiny pohybu pro jeden souhrnný řádek studie (zkouška 959, B6: „36 komp. 50 mm · 1 komp. 20 mm · 33 stojí“
 * místo rozsahu každé komponenty): komponenty se stejným posunutím ve všech krocích (zaokrouhleno na 0,001 mm) a bez
 * natočení tvoří skupinu; `travel` = největší vzdálenost od výchozí polohy. Natáčející se komponenty se počítají zvlášť
 * (`rotating`). Skupiny podle počtu komponent sestupně, pak podle zdvihu.
 */
export function motionGroups(res: MotionResult): { moving: { n: number; travel: number }[]; still: number; rotating: number } {
  const first = res.steps[0];
  const groups = new Map<string, { n: number; travel: number }>();
  let still = 0;
  let rotating = 0;
  if (!first) return { moving: [], still: res.comps.length, rotating: 0 };
  for (const c of res.comps) {
    const p0 = first.place[c.id];
    if (!p0) continue;
    let travel = 0;
    let rot = false;
    const sig: string[] = [];
    for (const s of res.steps) {
      const p = s.place[c.id];
      if (!p) continue;
      const d = [0, 1, 2].map((k) => p.position[k] - p0.position[k]);
      travel = Math.max(travel, Math.hypot(d[0], d[1], d[2]));
      // natočení vůči výchozímu kroku jako úhel mezi maticemi (B11, `rotationAngleDeg` – jako souhrn studie výše), ne po složkách
      // Eulerových úhlů: [180, 0, 0] a [-180, 0, 0] je tatáž poloha
      if (!rot && rotationAngleDeg(p0.rotation, p.rotation) > ROT_EPS_DEG) rot = true;
      sig.push(d.map((v) => Math.round(v * 1000)).join(","));
    }
    if (rot) rotating++;
    else if (travel < 1e-3) still++;
    else {
      const key = sig.join(";");
      const g = groups.get(key) ?? { n: 0, travel };
      g.n++;
      groups.set(key, g);
    }
  }
  return { moving: [...groups.values()].sort((a, b) => b.n - a.n || b.travel - a.travel), still, rotating };
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
