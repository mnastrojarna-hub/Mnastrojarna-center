/**
 * Pohybová studie sestavy: motory (rotační na Souososti / Závěsu / Šroubu, lineární na Vzdálenosti / Drážce / Dráze / Souososti),
 * délka a počet kroků. V každém kroku se nastaví hodnota motorů a globální řešič (cad/mates-kin.ts) najde polohy všech komponent
 * při splnění všech vazeb včetně mechanických (Ozubení, Hřeben, Šroub, Vačka, Kardan) a mezí. Kroky navazují (výchozí poloha
 * = předchozí krok), úhly se rozbalují – motor tak umí i více otáček. Volitelně kontrola kolizí v každém kroku (callback do jádra)
 * a stopa bodu komponenty. Výsledek = tabulka poloh a natočení po krocích (CSV).
 * Čisté funkce bez jádra (geometrii ploch dodá volající jako v řešiči vazeb).
 */
import type { InterferenceStats } from "./asm-kernel";
import { tr } from "./i18n";
import { kinCluster, kinCtx, memoGeo, MATE_LABEL, solveMates, type GeoProvider } from "./mates";
import { DEG, LINEAR_MOTOR_TYPES, ROTARY_MOTOR_TYPES, dofValue, kinResidual, L, pivotOf, placementOf, poseOf, resNorm, rigidGroups, solvePoses, syncGroups, toWorld, wrap, type Pose } from "./mates-kin";
import type { CadDoc, Mate, MotionMotor, MotionStudy, Placement, Vec3 } from "./types";

export type MotionCollision = { a: string; b: string; volume: number };
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
};

export const defaultStudy = (): MotionStudy => ({ motors: [], duration: 2, steps: 36 });

/** Hodnota motoru v kroku `k` z `n`: rozsah „od–do“, nebo rychlost (ot/min → °, mm/s → mm) od hodnoty „od“. */
export function motorValue(mo: MotionMotor, k: number, n: number, duration: number): number {
  const t = n > 0 ? (duration * k) / n : 0;
  if (mo.speed !== undefined && Number.isFinite(mo.speed)) return mo.from + (mo.kind === "rotary" ? (mo.speed * 360 * t) / 60 : mo.speed * t);
  return mo.from + (n > 0 ? ((mo.to - mo.from) * k) / n : 0);
}

/** Proč motor nejde použít s danou vazbou (null = jde). */
export function motorProblem(mo: Pick<MotionMotor, "kind" | "mate">, mates: Mate[]): string | null {
  const m = mates.find((x) => x.id === mo.mate);
  if (!m) return tr("vazba motoru v sestavě není");
  if (m.suppressed) return tr("vazba motoru je potlačená");
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
  const mates = (s0.mates ?? doc.mates ?? []).filter((m) => !m.suppressed);
  for (const mo of study.motors) {
    const p = motorProblem(mo, mates);
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
    const abs = mo.kind === "linear" && (m.type === "distance" || (m.type === "slot" && m.value !== undefined));
    const v0 = dofValue(m, mo.kind, ctx);
    if (v0 === null) throw new Error(tr("motor {0}: chybí geometrie vazby „{1}“", study.motors.indexOf(mo) + 1, m.name ?? tr(MATE_LABEL[m.type])));
    return { mo, m, abs, v0, key: `motor:${mo.id}`, target: 0 };
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
  for (let k = 0; k <= n; k++) {
    if (opts.cancel?.()) break;
    const t = (duration * k) / n;
    const vals = motors.map((x) => motorValue(x.mo, k, n, duration));
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
    let collideMs = 0;
    if (study.collisions && opts.collide) {
      const tc = now();
      const clashes = await opts.collide(poseDoc(doc, place));
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
  };
}

/** Sestava s polohami komponent z kroku studie (zobrazení, kolize, export). */
export function poseDoc(doc: CadDoc, place: Record<string, Placement>): CadDoc {
  return { ...doc, components: (doc.components ?? []).map((c) => (place[c.id] ? { ...c, placement: place[c.id] } : c)) };
}

const num = (v: number, d = 4) => (Math.round(v * 10 ** d) / 10 ** d || 0).toString().replace(".", ",");

/** Popis motoru: „rotační · Závěs „Klika“ · 0…360°“. */
export function motorText(mo: MotionMotor, doc: CadDoc): string {
  const m = doc.mates?.find((x) => x.id === mo.mate);
  const comp = (id?: string) => doc.components?.find((c) => c.id === id)?.name ?? "?";
  const unit = mo.kind === "rotary" ? "°" : " mm";
  const range = mo.speed !== undefined ? `${mo.kind === "rotary" ? tr("{0} ot/min", num(mo.speed, 3)) : tr("{0} mm/s", num(mo.speed, 3))}${mo.from ? tr(" od {0}{1}", num(mo.from), unit) : ""}` : `${num(mo.from)}…${num(mo.to)}${unit}`;
  return `${mo.kind === "rotary" ? tr("rotační motor") : tr("lineární motor")} · ${m ? `${m.name ?? tr(MATE_LABEL[m.type])} „${comp(m.a.compId)}“ → „${comp(m.b.compId)}“` : tr("(vazba chybí)")} · ${range}`;
}

/** Tabulka studie jako CSV (středník, desetinná čárka, BOM pro Excel): krok, čas, motory, poloha a natočení komponent, stopa, kolize. */
export function motionCsv(res: MotionResult, doc: CadDoc): string {
  const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = [tr("Krok"), tr("Čas [s]"), ...res.motors.map((mo, i) => `${tr("Motor {0}", i + 1)} [${mo.kind === "rotary" ? "°" : "mm"}]`)];
  for (const c of res.comps) head.push(...["X", "Y", "Z", "RX", "RY", "RZ"].map((a) => `${c.name} ${a}`));
  const hasTrace = res.steps.some((s) => s.trace);
  if (hasTrace) head.push(tr("Stopa X"), tr("Stopa Y"), tr("Stopa Z"));
  if (res.collisionsChecked) head.push(tr("Kolize"));
  head.push(tr("Nesplněné vazby"));
  const name = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? id;
  const lines = res.steps.map((s) => {
    const row = [String(s.i), num(s.t, 6), ...s.motors.map((v) => num(v, 6))];
    for (const c of res.comps) {
      const p = s.place[c.id];
      row.push(...(p ? [...p.position, ...p.rotation].map((v) => num(v, 6)) : ["", "", "", "", "", ""]));
    }
    if (hasTrace) row.push(...(s.trace ? s.trace.map((v) => num(v, 6)) : ["", "", ""]));
    if (res.collisionsChecked) row.push((s.clashes ?? []).map((x) => `${name(x.a)} × ${name(x.b)}`).join(", "));
    row.push(String(s.conflicts.length));
    return row.map(esc).join(";");
  });
  return "﻿" + [head.map(esc).join(";"), ...lines].join("\r\n") + "\r\n";
}

/** Souhrn výsledku do protokolu: kroky, rozsah pohybu komponent, kolize, nesplněné vazby. */
export function motionSummary(res: MotionResult, doc: CadDoc): string[] {
  const out: string[] = [];
  const last = res.steps[res.steps.length - 1];
  const first = res.steps[0];
  out.push(tr("Pohybová studie: {0} kroků · {1} s · motory: {2}", res.steps.length - 1, num(last?.t ?? 0, 3), res.motors.map((m) => motorText(m, doc)).join("; ")));
  if (first && last)
    for (const c of res.comps) {
      const pts = res.steps.map((s) => s.place[c.id]?.position).filter((p): p is Vec3 => !!p);
      if (!pts.length) continue;
      const span = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k])));
      const rot = [0, 1, 2].some((k) => res.steps.some((s) => Math.abs((s.place[c.id]?.rotation[k] ?? 0) - (first.place[c.id]?.rotation[k] ?? 0)) > 1e-6));
      if (span.every((v) => v < 1e-6) && !rot) continue;
      out.push(tr(" {0}: rozsah pohybu X {1} · Y {2} · Z {3} mm{4} · konec {5}", c.name, num(span[0], 3), num(span[1], 3), num(span[2], 3), rot ? tr(" · natáčí se") : "", `[${last.place[c.id].position.map((v) => num(v, 3)).join("; ")}]`));
    }
  if (res.collisionsChecked) {
    const nm = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? id;
    out.push(res.collision ? tr("⚠ první kolize v kroku {0} (t = {1} s): „{2}“ × „{3}“ ({4} mm³)", res.collision.step, num(res.collision.t, 3), nm(res.collision.a), nm(res.collision.b), num(res.collision.volume, 3)) : tr("Kolize: žádné ve všech krocích"));
  }
  out.push(res.conflictSteps ? tr("⚠ nesplněné vazby v {0} krocích (mechanismus se zasekl nebo motor překročil meze)", res.conflictSteps) : tr("Vazby splněny ve všech krocích"));
  const issues = motionIssues(res, doc);
  for (const x of issues.slice(0, 4)) out.push(` ⚠ ${x.code} ${x.text}`);
  if (issues.length > 4) out.push(tr(" … a další úseky s nesplněnými vazbami: {0}", issues.length - 4));
  return out;
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
