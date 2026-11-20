/**
 * Dynamika pohybové studie v sestavě: hmotnostní vlastnosti komponent z dílů postavených v jádře (objem × hustota materiálu,
 * těžiště a tenzor ze sítě – cad/motion-mass.ts, ruční hmotnost má přednost), výpočet (cad/motion-dynamic.ts) a provedení textových
 * příkazů `pohyb dynamika | kinematika | hmotnost | síla | moment` (parser cad/agent-motion-dyn.ts).
 */
import { composePlacement, flattenAssembly, invertPlacement, rotMatrix } from "./assembly";
import type { DynCmd } from "./agent-motion-dyn";
import { findComp, findMate, fmt } from "./agent-asm";
import { ensureBuilt, type AsmEnv, type AsmResult } from "./asm-agent";
import type { MotionSignal } from "./asm-agent-kin";
import { tr } from "./i18n";
import type { GeoProvider } from "./mates";
import { MATE_LABEL } from "./mates";
import { defaultDyn, runDynamic, type DynResult } from "./motion-dynamic";
import { massMaterialId, partMassProps, sumMass, transformMass, withMass, type CompInertia, type MassProps } from "./motion-mass";
import type { MotionClashes } from "./motion";
import type { CadDoc, MotionDynamic, MotionStudy, Vec3 } from "./types";
import { MATERIALS } from "@/lib/mesh-metrics";

/** Hmotnostní vlastnosti komponent nejvyšší úrovně (v jejich souřadnicích) z postavených dílů; ruční hmotnost `study.dyn.masses`. */
export async function compInertias(doc: CadDoc, env: AsmEnv, masses: Record<string, number> = {}): Promise<Map<string, CompInertia>> {
  const flat = flattenAssembly(doc);
  const built = await ensureBuilt(env, flat);
  const byTop = new Map<string, MassProps[]>();
  for (const l of flat) {
    const r = built.get(l.key);
    const top = doc.components?.find((c) => c.id === l.path[0]);
    if (!r?.metrics || !top) continue;
    const matId = massMaterialId(l.comp); // jedna definice s otiskem vstupu studie (motion-cache.ts)
    const density = (MATERIALS.find((m) => m.id === matId) ?? MATERIALS[0]).density;
    const mp = partMassProps({ volume: r.metrics.volume, density, bbox: r.metrics.bbox, vertices: r.mesh?.vertices, triangles: r.mesh?.triangles });
    if (!mp) continue;
    // list → souřadnice komponenty nejvyšší úrovně
    const rel = composePlacement(invertPlacement(top.placement), l.placement);
    byTop.set(top.id, [...(byTop.get(top.id) ?? []), transformMass(mp, rotMatrix(rel.rotation), rel.position)]);
  }
  const out = new Map<string, CompInertia>();
  for (const c of doc.components ?? []) {
    const mp = sumMass(byTop.get(c.id) ?? []);
    const kg = masses[c.id];
    if (kg !== undefined && kg > 0) out.set(c.id, { ...withMass(mp, kg), source: "manual" });
    else if (mp) out.set(c.id, { ...mp, source: "volume" });
  }
  return out;
}

/** Dynamická studie sestavy (geometrie a díly z jádra). */
export async function dynamicRun(doc: CadDoc, env: AsmEnv, geo: GeoProvider, study: MotionStudy, opts: { collide?: (d: CadDoc) => Promise<MotionClashes>; onStep?: (k: number, n: number) => void; cancel?: () => boolean } = {}): Promise<DynResult> {
  const inert = await compInertias(doc, env, study.dyn?.masses ?? {});
  return runDynamic(doc, geo, study, { inertia: (id) => inert.get(id) ?? null, collide: opts.collide, onStep: opts.onStep, cancel: opts.cancel });
}

const AX = ["X", "Y", "Z"];
const gText = (g: Vec3 | null | undefined) => (g === null ? tr("vyp") : g === undefined ? "−Z" : g.map((v, k) => (Math.abs(v) > 0.999 ? `${v < 0 ? "−" : "+"}${AX[k]}` : "")).join("") || `[${g.join("; ")}]`);

/** Řádek definice dynamiky pro `pohyb stav`. */
export function dynStudyLine(doc: CadDoc): string | null {
  const s = doc.motion;
  if (s?.mode !== "dynamic") return null;
  const D = { ...defaultDyn(), ...(s.dyn ?? {}) };
  const nm = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? id;
  const mates = doc.mates ?? [];
  const mt = (id: string) => {
    const i = mates.findIndex((m) => m.id === id);
    return i < 0 ? "?" : `${i + 1} ${mates[i].name ?? tr(MATE_LABEL[mates[i].type])}`;
  };
  const extra = [
    ...Object.entries(D.masses ?? {}).map(([id, kg]) => tr("hmotnost „{0}“ {1} kg", nm(id), fmt(kg, 4))),
    ...(D.loads ?? []).map((l) => (l.kind === "force" ? tr("síla vazba {0}: {1} N", mt(l.mate), fmt(l.value, 3)) : tr("moment vazba {0}: {1} N·m", mt(l.mate), fmt(l.value, 4)))),
  ];
  return tr("Dynamika: krok {0} s · gravitace {1} · tlumení {2} N·s/mm · odraz {3}{4}", fmt(D.dt, 6), gText(D.gravity), fmt(D.damping ?? 0, 4), fmt(D.restitution ?? 0, 3), extra.length ? ` · ${extra.join(" · ")}` : "");
}

/**
 * Provede podpříkaz dynamiky. `runLog` spočítá studii a přidá protokol (sdílené s ostatními příkazy `pohyb`), `lines` = řádky
 * definice studie.
 */
export async function applyDynCmd(d: CadDoc, cmd: DynCmd, study: MotionStudy, ctx: { runLog: (doc: CadDoc) => Promise<unknown>; lines: (doc: CadDoc) => string[]; log: string[] }): Promise<AsmResult & { motion?: MotionSignal }> {
  const log = ctx.log;
  const dyn: MotionDynamic = { ...defaultDyn(), ...(study.dyn ?? {}) };
  const done = async (next: MotionStudy, run: boolean) => {
    const doc = { ...d, motion: next };
    log.push(...ctx.lines(doc));
    if (run && (next.motors.length || next.mode === "dynamic")) await ctx.runLog(doc);
    return { doc, log, changed: true, motion: { open: true } as MotionSignal };
  };
  switch (cmd.k) {
    case "on": {
      if (cmd.dt !== undefined) dyn.dt = cmd.dt;
      if (cmd.gravity !== undefined) dyn.gravity = cmd.gravity;
      if (cmd.damping !== undefined) dyn.damping = cmd.damping;
      if (cmd.restitution !== undefined) dyn.restitution = cmd.restitution;
      if (cmd.frames !== undefined) dyn.frames = cmd.frames;
      const next: MotionStudy = { ...study, mode: "dynamic", dyn, ...(cmd.duration !== undefined ? { duration: cmd.duration } : {}) };
      return done(next, true);
    }
    case "off": {
      // výslovná kinematika (vlna 22, bod 2: režim studie – cad/motion-mode.ts); automatický režim = pohyb automaticky
      const next: MotionStudy = { ...study, mode: "kinematic" };
      log.push(tr("✓ pohybová studie: kinematika (nastavení dynamiky zůstává pro „pohyb dynamika“)"));
      return done(next, !!next.motors.length);
    }
    case "mass": {
      const c = findComp(d, cmd.comp);
      const masses = { ...(dyn.masses ?? {}) };
      if (cmd.kg === null) delete masses[c.id];
      else masses[c.id] = cmd.kg;
      dyn.masses = masses;
      log.push(cmd.kg === null ? tr("✓ hmotnost „{0}“: z objemu × hustoty", c.name) : tr("✓ hmotnost „{0}“: {1} kg", c.name, fmt(cmd.kg, 4)));
      return done({ ...study, dyn }, study.mode === "dynamic");
    }
    case "load": {
      const m = findMate(d, cmd.mate);
      const loads = (dyn.loads ?? []).filter((l) => !(l.mate === m.id && l.kind === cmd.kind));
      if (cmd.value !== null) loads.push({ mate: m.id, kind: cmd.kind, value: cmd.value });
      dyn.loads = loads;
      const label = `${m.name ?? tr(MATE_LABEL[m.type])}`;
      log.push(cmd.value === null ? tr("✓ {0} na vazbě „{1}“ odebrána", cmd.kind === "force" ? tr("síla") : tr("moment"), label) : cmd.kind === "force" ? tr("✓ síla {0} N na vazbě „{1}“ (kladná zvětšuje hodnotu vazby)", fmt(cmd.value, 3), label) : tr("✓ moment {0} N·m na vazbě „{1}“ (kladný zvětšuje natočení)", fmt(cmd.value, 4), label));
      return done({ ...study, dyn }, study.mode === "dynamic");
    }
  }
}

/** Text pro `window.mncad.motion({...})`: objekt nastavení → řádky příkazů `pohyb …` (bez slova pohyb). */
export function motionApiLines(o: { mode?: "dynamic" | "kinematic"; duration?: number; dt?: number; gravity?: Vec3 | "off" | null | string; damping?: number; restitution?: number; frames?: number; masses?: Record<string, number | null>; forces?: { mate: string | number; value: number | null }[]; torques?: { mate: string | number; value: number | null }[]; run?: string }): string[] {
  const out: string[] = [];
  const q = (s: string) => `"${s.replace(/"/g, "")}"`;
  for (const [name, kg] of Object.entries(o.masses ?? {})) out.push(`hmotnost ${q(name)} ${kg === null ? "auto" : kg}`);
  for (const f of o.forces ?? []) out.push(`síla vazba ${typeof f.mate === "number" ? f.mate : q(f.mate)} ${f.value === null ? "smazat" : f.value}`);
  for (const f of o.torques ?? []) out.push(`moment vazba ${typeof f.mate === "number" ? f.mate : q(f.mate)} ${f.value === null ? "smazat" : f.value}`);
  if (o.mode === "kinematic") out.push("kinematika");
  else if (o.mode === "dynamic" || o.dt !== undefined || o.gravity !== undefined || o.damping !== undefined || o.restitution !== undefined) {
    const g = o.gravity === undefined ? "" : o.gravity === null || o.gravity === "off" ? " gravitace vyp" : Array.isArray(o.gravity) ? ` gravitace ${o.gravity.join(" ")}` : ` gravitace ${o.gravity}`;
    out.push(`dynamika${o.duration !== undefined ? ` čas ${o.duration}` : ""}${o.dt !== undefined ? ` krok ${o.dt}` : ""}${g}${o.damping !== undefined ? ` tlumení ${o.damping}` : ""}${o.restitution !== undefined ? ` odraz ${o.restitution}` : ""}${o.frames !== undefined ? ` snímky ${o.frames}` : ""}`);
  }
  if (o.run) out.push(o.run);
  return out;
}
