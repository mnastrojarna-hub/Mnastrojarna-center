/**
 * Pohybová studie sestavy: motory (rotační na Souososti / Závěsu / Šroubu, lineární na Vzdálenosti / Drážce / Dráze / Souososti),
 * délka a počet kroků. V každém kroku se nastaví hodnota motorů a globální řešič (cad/mates-kin.ts) najde polohy všech komponent
 * při splnění všech vazeb včetně mechanických (Ozubení, Hřeben, Šroub, Vačka, Kardan) a mezí. Kroky navazují (výchozí poloha
 * = předchozí krok), úhly se rozbalují – motor tak umí i více otáček. Volitelně kontrola kolizí v každém kroku (callback do jádra)
 * a stopa bodu komponenty. Výsledek = tabulka poloh a natočení po krocích (CSV).
 * Čisté funkce bez jádra (geometrii ploch dodá volající jako v řešiči vazeb).
 */
import { tr } from "./i18n";
import { kinCluster, kinCtx, memoGeo, MATE_LABEL, solveMates, type GeoProvider } from "./mates";
import { DEG, LINEAR_MOTOR_TYPES, ROTARY_MOTOR_TYPES, dofValue, kinResidual, L, pivotOf, placementOf, poseOf, resNorm, solvePoses, toWorld, wrap, type Pose } from "./mates-kin";
import type { CadDoc, Mate, MotionMotor, MotionStudy, Placement, Vec3 } from "./types";

export type MotionCollision = { a: string; b: string; volume: number };
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
  opts: { collide?: (d: CadDoc) => Promise<MotionCollision[]>; onStep?: (k: number, n: number) => void; cancel?: () => boolean } = {},
): Promise<MotionResult> {
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
  const vars = cl.vars.map((id) => ({ id, pivot: pivotOf(id, cl.mates, ctx) }));
  const steps: MotionStep[] = [];
  let collision: MotionResult["collision"] = null;
  let conflictSteps = 0;
  const trace = study.trace && poses.has(study.trace.compId) ? study.trace : undefined;
  for (let k = 0; k <= n; k++) {
    if (opts.cancel?.()) break;
    const t = (duration * k) / n;
    const vals = motors.map((x) => motorValue(x.mo, k, n, duration));
    motors.forEach((x, i) => (x.target = vals[i]));
    const ms = active();
    const resid = () => [...ms.flatMap((m) => kinResidual(m, ctx) ?? []), ...driveRes()];
    solvePoses(poses, vars, resid, { maxIter: 60 });
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
    if (study.collisions && opts.collide) {
      const clashes = await opts.collide(poseDoc(doc, place));
      row.clashes = clashes;
      if (clashes.length && !collision) collision = { ...clashes[0], step: k, t };
    }
    steps.push(row);
    opts.onStep?.(k, n);
  }
  return {
    steps,
    comps: comps.map((c) => ({ id: c.id, name: c.name })),
    motors: study.motors,
    collision,
    collisionsChecked: !!(study.collisions && opts.collide),
    conflictSteps,
    ...(s0.mates ? { mates: s0.mates } : {}),
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
  return out;
}
