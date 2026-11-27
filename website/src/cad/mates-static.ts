/**
 * Statický přepočet vazeb sestavy pro text i aplikaci (vlna 22, body 2 a 8 zprávy) – JEDEN řešič pro `solveAsm` (engine, CLI,
 * konzole) i `resolveMates` (panel sestavy v aplikaci):
 *
 * 1. sekvenční + globální řešič vazeb (cad/mates.ts `solveMates`) jako dřív;
 * 2. **konflikt** (vazby nelze splnit spolu): kompromis nejmenších čtverců (ujeté a naklopené díly) se do dokumentu NEZAPÍŠE –
 *    polohy zůstanou, stav vazeb platí pro dokument, jak je, a `conflict` řekne, které vazby si odporují, jejich odchylky a – u
 *    upravené vazby (`focus`) – nejbližší dosažitelnou hodnotu (cad/motion-quasi.ts `solveStep` s prioritou tvrdé ≫ upravená vazba);
 * 3. **rovnováha** (`equilibrium`, jen při úpravách – ne při načtení ani při zjišťování stavu): díly, které vazby neurčují (volné
 *    v mezi), posune do rovnováhy pružin (předpětí drží přidržovač u meze) a preferované strany meze. Dokument je tak stejný
 *    nezávisle na historii úprav (dřív ho „nejmenší změna“ nechávala tam, kam ho naposledy dotlačila mez).
 */
import { kinCluster, kinCtx, memoGeo, solveMates, type GeoProvider, type MateStatus, type SolveResult } from "./mates";
import { dofValue, kinResidual, pivotOf, placementOf, poseOf, rigidGroups, type Pose } from "./mates-kin";
import { devText, isLimitMate, limitGap, mateDev, mateName, mateTerm, preferTerms, solveStep, springDev, springEnergyTerm, springStopTerm, springTerms, type MateDev, type Term } from "./motion-quasi";
import { getLang, tr } from "./i18n";
import type { AsmComponent, CadDoc, Mate, Placement } from "./types";

/** Konflikt statického přepočtu: vazby, které si odporují, jejich odchylky a u upravené vazby nejbližší dosažitelná hodnota. */
export type StaticConflict = {
  /** id vazeb (a dorazů pružin `spring:<id>`) konfliktní množiny */
  ids: string[];
  devs: MateDev[];
  /** upravená vazba: zadaná a nejbližší dosažitelná hodnota (ostatní vazby splněné) */
  focus?: { id: string; want: number; reach: number; unit: "mm" | "°" };
  /** `motor` = upravená vazba žádá hodnotu, kterou ostatní nedovolí; `mates` = vazby si odporují samy */
  cause: "motor" | "mates";
};
export type StaticResult = SolveResult & {
  conflict?: StaticConflict;
  /** komponenty, které posunula rovnováha pružin / preference (podmnožina `moved`) */
  eqMoved: string[];
};

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 || 0;
const samePl = (a: Placement, b: Placement) => a.position.every((v, k) => Math.abs(v - b.position[k]) < 1e-9) && a.rotation.every((v, k) => Math.abs(v - b.rotation[k]) < 1e-7);

/** ukotvené komponenty jako ve statickém řešiči (příznak, vazba Ukotvit, přesunutá komponenta; bez ukotvení první komponenta) */
function fixedTest(doc: CadDoc, anchorId?: string | null): (id: string) => boolean {
  const comps = doc.components ?? [];
  const fixed = new Set(comps.filter((c) => c.fixed).map((c) => c.id));
  for (const m of doc.mates ?? []) if (m.type === "fixed" && !m.suppressed) fixed.add(m.a.compId);
  const any = fixed.size > 0;
  return (id) => !comps.some((c) => c.id === id) || id === anchorId || fixed.has(id) || (!any && anchorId == null && comps[0]?.id === id);
}

/** Proměnné globálního řešiče (kořeny tuhých skupin) pro shluk vazeb okolo `seeds`. */
function clusterVars(doc: CadDoc, mates: Mate[], seeds: Set<string>, isFixed: (id: string) => boolean, ctx: ReturnType<typeof kinCtx>) {
  const comps = doc.components ?? [];
  const cl = kinCluster(mates, seeds, isFixed);
  const groups = rigidGroups(mates, comps.map((c) => c.id), isFixed);
  const roots = new Set<string>();
  for (const id of cl.vars) {
    const root = groups.rootOf.get(id) ?? id;
    if (!groups.fixedRoots.has(root) && !isFixed(root)) roots.add(root);
  }
  const ids = (root: string) => new Set([root, ...(groups.members.get(root) ?? []).map((m) => m.id)]);
  const vars = [...roots].map((id) => ({ id, pivot: pivotOf(id, cl.mates, ctx, groups.members.get(id)?.length ? ids(id) : undefined) }));
  return { cl, groups, roots, vars };
}

/**
 * Vysvětlení konfliktu v poloze dokumentu `doc` (polohy se nemění): konfliktní množina s odchylkami; u upravené vazby `focus`
 * (Vzdálenost, Úhel, Drážka s polohou) nejbližší hodnota, kterou ostatní vazby dovolí – a polohy, ve kterých ji mají.
 */
export function explainConflict(doc: CadDoc, geo: GeoProvider, mates: Mate[], conflictIds: string[], o: { focus?: string; anchorId?: string | null } = {}): { conflict: StaticConflict; reachPoses?: Map<string, Pose> } | null {
  const comps = doc.components ?? [];
  const poses = new Map<string, Pose>(comps.map((c) => [c.id, poseOf(c.placement)] as const));
  const g = memoGeo(geo);
  const ctx = kinCtx(poses, g);
  const isFixed = fixedTest({ ...doc, mates }, o.anchorId);
  const active = mates.filter((m) => !m.suppressed);
  const focus = o.focus ? active.find((m) => m.id === o.focus && (m.type === "distance" || m.type === "angle" || (m.type === "slot" && m.value !== undefined))) : undefined;
  const seeds = new Set([...conflictIds, ...(focus ? [focus.id] : [])].flatMap((id) => {
    const m = active.find((x) => x.id === id);
    return m ? [m.a, m.b, m.c, m.d].flatMap((r) => (r ? [r.compId] : [])) : [];
  }));
  if (!seeds.size) return null;
  const { groups, vars } = clusterVars(doc, active, seeds, isFixed, ctx);
  const nm = (id: string) => comps.find((c) => c.id === id)?.name ?? id;
  const byId = new Map(active.map((m) => [m.id, m] as const));
  const hardOf = (m: Mate): number[] => {
    if (m !== focus || m.type === "angle") return m === focus ? [] : (kinResidual(m, ctx) ?? []);
    const v = dofValue(m, "linear", ctx);
    return kinResidual(v === null ? m : { ...m, value: v }, ctx) ?? [];
  };
  const value = (m: Mate): number | null => (m.type === "angle" ? (mateDev(m, ctx, "").value ?? null) : dofValue(m, "linear", ctx));
  const hard: Term[] = active.filter((m) => !groups.tree.has(m.id) && m.type !== "fixed").map((m) => mateTerm(m, ctx, () => hardOf(m)));
  const springs = springTerms(doc, ctx).filter((s) => s.solid !== undefined);
  hard.push(...springs.map(springStopTerm));
  const drive: Term[] = focus ? [{ id: focus.id, r: () => (focus.type === "angle" ? (kinResidual(focus, ctx) ?? [0]) : [(value(focus) ?? 0) - (focus.value ?? 0)]) }] : [];
  const describe = (ids: string[], short: string[]): MateDev[] => {
    const out: MateDev[] = [];
    for (const id of [...short, ...ids.filter((x) => !short.includes(x))]) {
      const m = byId.get(id);
      if (m) out.push(mateDev(m, ctx, mateName(m, nm)));
      else if (id.startsWith("spring:")) {
        const s = springs.find((x) => `spring:${x.id}` === id);
        if (s) out.push(springDev(s, s.name));
      }
    }
    return out;
  };
  const out = solveStep(poses, vars, { hard, drive, soft: [] }, { groups, atLimit: "stop", maxIter: 80, describe });
  if (out.status === "ok") return null;
  const ids = [...new Set([...out.short, ...out.blocking])];
  const conflict: StaticConflict = { ids, devs: (out.info as MateDev[] | undefined) ?? [], cause: out.cause ?? "mates" };
  if (out.status === "stopped" && focus) {
    const reach = value(focus);
    if (reach !== null) conflict.focus = { id: focus.id, want: focus.type === "angle" ? Math.abs(focus.value ?? 0) : (focus.value ?? 0), reach, unit: focus.type === "angle" ? "°" : "mm" };
    return { conflict, reachPoses: poses };
  }
  return { conflict };
}

/** Řádek konfliktu do protokolu / panelu: „nejbližší dosažitelná hodnota 37,5 mm (zadáno 37,15 mm) – brání: …“ / „vazby si odporují: …“. */
export function conflictText(c: StaticConflict): string {
  const n = (v: number) => (getLang() === "en" ? String(Math.round(v * 1e4) / 1e4 || 0) : String(Math.round(v * 1e4) / 1e4 || 0).replace(".", ","));
  const list = c.devs.filter((d) => d.id !== c.focus?.id).map(devText).join("; ") || tr("(nezjištěno)");
  if (c.focus) return tr("nejbližší dosažitelná hodnota {0} (zadáno {1}) – brání: {2}", `${n(c.focus.reach)}${c.focus.unit === "°" ? "°" : " mm"}`, `${n(c.focus.want)}${c.focus.unit === "°" ? "°" : " mm"}`, list);
  return tr("vazby si odporují: {0}", c.devs.map(devText).join("; ") || tr("(nezjištěno)"));
}

/** stav vazeb pro polohy dokumentu, jak jsou (konflikt = zbytek nad 1e-3), u chybějící plochy a potlačení podle řešiče */
function statusAt(doc: CadDoc, geo: GeoProvider, mates: Mate[], solved: Record<string, MateStatus>): Record<string, MateStatus> {
  const poses = new Map<string, Pose>((doc.components ?? []).map((c) => [c.id, poseOf(c.placement)] as const));
  const ctx = kinCtx(poses, memoGeo(geo));
  const out: Record<string, MateStatus> = {};
  for (const m of mates) {
    if (solved[m.id] === "missing" || solved[m.id] === "suppressed") {
      out[m.id] = solved[m.id];
      continue;
    }
    if (m.type === "fixed") {
      out[m.id] = solved[m.id] ?? "ok";
      continue;
    }
    const r = kinResidual(m, ctx);
    out[m.id] = !r ? "missing" : Math.sqrt(r.reduce((s, v) => s + v * v, 0)) > 1e-3 ? "conflict" : "ok";
  }
  return out;
}

/**
 * Uplatnila se preferovaná strana meze v polohách dokumentu? (vlna 22, bod 2 – kolo 6) Rovnováha pružin a preferencí je měkká:
 * pružina s předpětím ji může přebít (přidržovač zůstane u druhé meze). `null` = mez bez preference nebo bez geometrie.
 */
export function preferOutcome(doc: CadDoc, geo: GeoProvider, m: Mate): { met: boolean; g: number; side: "min" | "max"; at?: "min" | "max"; spring: boolean } | null {
  if (!m.prefer || !isLimitMate(m)) return null;
  const poses = new Map<string, Pose>((doc.components ?? []).map((c) => [c.id, poseOf(c.placement)] as const));
  const ctx = kinCtx(poses, memoGeo(geo));
  const x = limitGap(m, ctx);
  if (!x) return null;
  const want = m.prefer === "min" ? x.min : x.max;
  if (want === undefined) return null;
  const tol = 1e-3;
  const at = x.min !== undefined && Math.abs(x.g - x.min) < tol ? "min" : x.max !== undefined && Math.abs(x.g - x.max) < tol ? "max" : undefined;
  const ids = new Set([m.a.compId, m.b.compId]);
  const spring = springTerms(doc, ctx).some((sp) => sp.seats.some((id) => ids.has(id)) || ids.has(sp.id));
  return { met: Math.abs(x.g - want) < tol, g: x.g, side: m.prefer, ...(at ? { at } : {}), spring };
}

/**
 * Rovnováha pružin a preferovaných stran mezí nad vyřešenými polohami `comps` (statický přepočet při úpravě): pohne jen díly
 * shluku vazeb, na které dosedá pružina nebo které mají mez s preferencí; tvrdé vazby a doraz Ln zůstávají přesně splněné.
 * Vrací nové polohy pohnutých komponent (prázdné = nic).
 */
export function equilibrate(doc: CadDoc, geo: GeoProvider, mates: Mate[], comps: AsmComponent[], anchorId?: string | null): Map<string, Placement> {
  const active = mates.filter((m) => !m.suppressed);
  const poses = new Map<string, Pose>(comps.map((c) => [c.id, poseOf(c.placement)] as const));
  const ctx = kinCtx(poses, memoGeo(geo));
  const d = { ...doc, components: comps, mates };
  const isFixed = fixedTest(d, anchorId);
  const springs = springTerms(d, ctx);
  const prefer = active.filter((m) => m.prefer && isLimitMate(m));
  const seeds = new Set([...springs.flatMap((s) => [...s.seats, s.id]), ...prefer.flatMap((m) => [m.a.compId, m.b.compId])]);
  if (!seeds.size) return new Map();
  const { groups, roots, vars } = clusterVars(d, active, seeds, isFixed, ctx);
  if (!vars.length) return new Map();
  const rootOf = (id: string) => groups.rootOf.get(id) ?? id;
  const live = springs.filter((s) => s.seats.some((id) => roots.has(rootOf(id))) || roots.has(rootOf(s.id)));
  const soft = [...live.map(springEnergyTerm), ...preferTerms(active, ctx)];
  if (!soft.length) return new Map();
  const hard: Term[] = [...active.filter((m) => !groups.tree.has(m.id) && m.type !== "fixed").map((m) => mateTerm(m, ctx)), ...live.filter((s) => s.solid !== undefined).map(springStopTerm)];
  const out = solveStep(poses, vars, { hard, drive: [], soft }, { groups, maxIter: 80 });
  const next = new Map<string, Placement>();
  if (out.status !== "ok") return next;
  for (const c of comps) {
    const P = poses.get(c.id);
    if (!P) continue;
    const pl = placementOf(P);
    const rounded = { position: pl.position.map(r6) as Placement["position"], rotation: pl.rotation };
    if (!samePl(rounded, c.placement)) next.set(c.id, rounded);
  }
  return next;
}

/**
 * Statický přepočet: `solveMates` + konflikt bez zápisu kompromisu (`keepOnConflict`, výchozí ano) + rovnováha pružin a preferencí
 * (`equilibrium`, jen při úpravách). `focus` = upravená vazba (nejbližší dosažitelná hodnota v hlášení konfliktu).
 */
export function solveStatic(doc: CadDoc, geo: GeoProvider, anchorId?: string | null, o: { equilibrium?: boolean; keepOnConflict?: boolean; focus?: string } = {}): StaticResult {
  const r = solveMates(doc, geo, anchorId);
  const mates = r.mates ?? doc.mates ?? [];
  const conflicts = Object.entries(r.status)
    .filter(([, s]) => s === "conflict")
    .map(([id]) => id);
  if (conflicts.length && o.keepOnConflict !== false) {
    const ex = explainConflict({ ...doc, mates }, geo, mates, conflicts, { focus: o.focus, anchorId });
    // dokument zůstává: stav vazeb pro polohy, jak jsou (ne pro kompromis řešiče)
    const status = statusAt({ ...doc, mates }, geo, mates, r.status);
    return { components: (doc.components ?? []).map((c) => ({ ...c })), status, moved: [], ...(r.mates ? { mates: r.mates } : {}), eqMoved: [], ...(ex ? { conflict: ex.conflict } : {}) };
  }
  if (!o.equilibrium) return { ...r, eqMoved: [] };
  const eq = equilibrate(doc, geo, mates, r.components, anchorId);
  if (!eq.size) return { ...r, eqMoved: [] };
  const components = r.components.map((c) => (eq.has(c.id) ? { ...c, placement: eq.get(c.id)! } : c));
  const eqMoved = [...eq.keys()];
  return { ...r, components, moved: [...new Set([...r.moved, ...eqMoved])], eqMoved };
}
