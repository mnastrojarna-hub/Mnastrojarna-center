/**
 * Provedení pokročilých a mechanických vazeb a pohybové studie zadaných textem (cad/agent-asm.ts, cad/agent-motion.ts).
 * Entity komponent (plochy včetně koulí a obecných ploch vaček, hrany, vrcholy) se vyberou podle F/E/V čísla nebo pravidla,
 * vazba se vytvoří stejně jako v panelu sestavy (cad/mate-spec.ts) a sestava se přepočítá. Pohybová studie se počítá řešičem
 * (cad/motion.ts) nad geometrií z jádra; výsledek se drží v mezipaměti (panel v aplikaci i `pohyb stav / export` ho sdílí).
 */
import { flattenAssembly, transformPoint } from "./assembly";
import { F_CIRCLE, F_LINE, F_POINT, F_SPHERE, faceArgWords, findComp, findMate, fmt, mateText, pt, type AsmCmd, type FaceSpec } from "./agent-asm";
import type { MotionCmd } from "./agent-motion";
import { ensureBuilt, faceInfo, geoProvider, leafId, movedText, partFaces, pathNames, solveAsm, STATUS_WORD, type AsmEnv, type AsmResult } from "./asm-agent";
import { tr } from "./i18n";
import { ensureMateRefs, entKey } from "./mate-geo";
import { KIN_SPEC, accepts, entKindOf, kinDefaults, kinHasValue, type EntKind, type SlotSpec } from "./mate-spec";
import { MATE_LABEL, faceAreas, worldGeo, type FaceGeo, type KinMateType } from "./mates";
import { LINEAR_MOTOR_TYPES, ROTARY_MOTOR_TYPES } from "./mates-kin";
import { defaultStudy, motionCsv, motionSummary, motorProblem, motorText, poseDoc, runMotion, type MotionResult } from "./motion";
import { uid, type AsmComponent, type CadDoc, type Mate, type MateRef, type MotionMotor, type MotionStudy, type Vec3 } from "./types";

/** Pokyn pro panel pohybové studie v aplikaci. */
export type MotionSignal = { play?: boolean; loop?: boolean; stop?: boolean; step?: number; export?: "csv" | "png" | "webm"; open?: boolean };

/* ───────────────────────── entity komponent ───────────────────────── */

/** Entita komponenty ve světových souřadnicích: plocha / hrana / vrchol listového dílu. */
export type EntRow = { leafId: string; part?: string; index: number; ent?: "edge" | "vertex"; kind: EntKind; g: FaceGeo; size: number };
const LIMIT = 400;

/** Entity komponenty nejvyšší úrovně (u podsestavy všech jejích dílů): plochy (i obecné), hrany a vrcholy podle potřeby. */
export async function compEntRows(doc: CadDoc, compId: string, env: AsmEnv, want: { face?: boolean; anyFace?: boolean; edge?: boolean; vertex?: boolean }): Promise<EntRow[]> {
  const leaves = flattenAssembly(doc).filter((l) => l.path[0] === compId);
  const built = await ensureBuilt(env, leaves);
  const rows: EntRow[] = [];
  for (const l of leaves) {
    const r = built.get(l.key);
    const part = l.path.length > 1 ? pathNames(doc, l.path).slice(1).join(" › ") : undefined;
    const base = { leafId: leafId(l), ...(part ? { part } : {}) };
    if (want.face) {
      const pf = await partFaces(env, l.key, r);
      const seen = new Set<number>();
      for (const f of pf.faces) {
        seen.add(f.face);
        rows.push({ ...base, index: f.face, kind: entKindOf(f.info), g: worldGeo(l.placement, f.info), size: f.area ?? (f.info.radius ?? 0) });
      }
      if (want.anyFace) {
        const areas = r?.mesh ? faceAreas(r.mesh) : [];
        for (let i = 0; i < Math.min(r?.metrics?.faces ?? 0, LIMIT); i++) {
          if (seen.has(i)) continue;
          const info = await faceInfo(env, l.key, i);
          if (info) rows.push({ ...base, index: i, kind: "face", g: worldGeo(l.placement, info), size: areas[i] ?? 0 });
        }
      }
    }
    if (want.edge && env.mateEnt) {
      for (let i = 0; i < Math.min(r?.metrics?.edges ?? 0, LIMIT); i++) {
        const k = entKey(l.key, { face: i, ent: "edge" });
        let info = env.geo.get(k) ?? null;
        if (!info) {
          info = await env.mateEnt(l.key, i, "edge").catch(() => null);
          if (info) env.geo.set(k, info);
        }
        if (info) rows.push({ ...base, index: i, ent: "edge", kind: entKindOf(info), g: { ...worldGeo(l.placement, info), pts: info.pts?.map((p) => transformPoint(l.placement, p)) }, size: (info as { length?: number }).length ?? 0 });
      }
    }
    if (want.vertex && r?.vertices) {
      const v = r.vertices;
      for (let i = 0; i * 3 + 2 < v.length && i < LIMIT; i++)
        rows.push({ ...base, index: i, ent: "vertex", kind: "vertex", g: { kind: "point", origin: transformPoint(l.placement, [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]]), normal: [0, 0, 1] }, size: 0 });
    }
  }
  return rows;
}

const KIND_TEXT: Record<EntKind, string> = { plane: "rovinná", cylinder: "válcová", sphere: "kulová", face: "plocha", line: "úsečka", circle: "kružnice", curve: "křivka", edge: "hrana", vertex: "vrchol" };
/** „F3 válcová Ø10“, „E5 kružnice Ø40“, „V2 [0; 0; 10]“ */
export const entText = (r: EntRow) => {
  const id = `${r.ent === "edge" ? "E" : r.ent === "vertex" ? "V" : "F"}${r.index + 1}${r.part ? `@${r.part.split(" › ").pop()}` : ""}`;
  const d = r.g.radius ? ` Ø${fmt(2 * r.g.radius)}` : "";
  return r.kind === "vertex" ? `${id} ${pt(r.g.origin)}` : `${id} ${tr(KIND_TEXT[r.kind])}${d}`;
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const kindsText = (kinds: EntKind[]) => kinds.map((k) => tr(KIND_TEXT[k])).join(" / ");

/**
 * Výběr entity pro krok vazby: číslo (F12 / E5 / V3), pravidlo (směr, druh, průměr, největší) nebo – bez zadání – jediná vhodná,
 * preferovaná (`prefer`) nebo u os největší válec. Chyba vyjmenuje entity, které by šly použít.
 */
export function pickEnt(spec: FaceSpec | undefined, rows: EntRow[], kinds: EntKind[], compName: string, what: string, prefer?: (r: EntRow) => boolean): EntRow {
  const ok = rows.filter((r) => accepts(kinds, r.kind));
  const offer = () => {
    const l = ok.slice(0, 12).map(entText).join(", ");
    return l ? tr("vhodné: {0}{1}", l, ok.length > 12 ? tr(" … (celkem {0})", ok.length) : "") : tr("žádná vhodná entita ({0})", kindsText(kinds));
  };
  if (spec?.index !== undefined) {
    const hit = rows.filter((r) => r.index === spec.index && r.ent === spec.ent && (!spec.leaf || (r.part ?? "").toLowerCase().endsWith(spec.leaf.toLowerCase())));
    if (!hit.length) throw new Error(tr("{0}komponenta „{1}“ nemá {2} – {3}", what, compName, spec.raw, offer()));
    if (!accepts(kinds, hit[0].kind)) throw new Error(tr("{0}{1} komponenty „{2}“ je {3} – vazba potřebuje {4}; {5}", what, spec.raw, compName, tr(KIND_TEXT[hit[0].kind]), kindsText(kinds), offer()));
    return hit[0];
  }
  let list = ok;
  if (spec) {
    const W = faceArgWords();
    let side: Vec3 | null = null;
    let order: "largest" | "smallest" | null = null;
    for (const w of spec.rule) {
      if (W.plane.has(w)) list = list.filter((r) => r.kind === "plane");
      else if (W.cyl.has(w)) list = list.filter((r) => r.kind === "cylinder");
      else if (F_SPHERE.has(w)) list = list.filter((r) => r.kind === "sphere");
      else if (F_CIRCLE.has(w)) list = list.filter((r) => r.kind === "circle");
      else if (F_LINE.has(w)) list = list.filter((r) => r.kind === "line");
      else if (F_POINT.has(w)) list = list.filter((r) => r.kind === "vertex");
      else if (W.side[w]) {
        // směr: přednostně rovinné plochy s touto normálou, jinak osy (válec, úsečka) v tomto směru, body se jen řadí
        const s = W.side[w];
        side = s;
        const planes = list.filter((r) => r.kind === "plane" && dot(r.g.normal, s) > 0.999);
        list = planes.length ? planes : list.filter((r) => (r.kind === "vertex" || r.kind === "sphere" || r.kind === "face" ? true : r.kind !== "plane" && Math.abs(dot(r.g.normal, s)) > 0.999));
      } else if (W.largest.has(w)) order = "largest";
      else if (W.smallest.has(w)) order = "smallest";
    }
    if (spec.diameter !== undefined || spec.radius !== undefined) {
      const d = spec.diameter ?? 2 * spec.radius!;
      list = list.filter((r) => r.g.radius !== undefined && Math.abs(2 * r.g.radius - d) <= Math.max(0.05, d * 0.005));
    }
    if (!list.length) throw new Error(tr("{0}komponenta „{1}“: nic neodpovídá „{2}“ – {3}", what, compName, spec.raw, offer()));
    if (order) return [...list].sort((a, b) => (order === "largest" ? b.size - a.size : a.size - b.size) || a.index - b.index)[0];
    if (side) {
      const s = side;
      return [...list].sort((a, b) => dot(b.g.origin, s) - dot(a.g.origin, s) || a.index - b.index)[0];
    }
    return [...list].sort((a, b) => b.size - a.size || a.index - b.index)[0];
  }
  if (list.length === 1) return list[0];
  const pref = prefer ? list.filter(prefer) : [];
  if (pref.length) return pref[0];
  if (list.length && kinds.every((k) => k === "cylinder" || k === "line")) return [...list].filter((r) => r.kind === "cylinder").sort((a, b) => (b.g.radius ?? 0) - (a.g.radius ?? 0) || a.index - b.index)[0] ?? list[0];
  if (list.length && kinds.includes("face") && kinds.length === 1) return [...list].filter((r) => r.kind !== "plane").sort((a, b) => b.size - a.size)[0] ?? list[0];
  throw new Error(tr("{0}chybí entita komponenty „{1}“ ({2}) – zadejte F-číslo / E-číslo / V-číslo (sestava plochy \"{1}\", měřit) nebo pravidlo; {3}", what, compName, kindsText(kinds), offer()));
}

/* ───────────────────────── vazba textem ───────────────────────── */

type MateCmd = Extract<AsmCmd, { k: "mate" }>;

/** Vytvoří pokročilou / mechanickou vazbu podle textového příkazu a sestavu přepočítá. */
export async function applyKinMate(d: CadDoc, cmd: MateCmd, env: AsmEnv): Promise<AsmResult> {
  const kind = cmd.kind as KinMateType;
  const spec = KIN_SPEC[kind];
  const label = tr(MATE_LABEL[kind]);
  const A = findComp(d, cmd.a);
  const B = findComp(d, cmd.b!);
  if (A.id === B.id) throw new Error(tr("vazba potřebuje dvě různé komponenty – „{0}“ je A i B", A.name));
  const C = cmd.c ? findComp(d, cmd.c) : B;
  const log: string[] = [];
  const m: Mate = { id: uid(), type: kind, a: { compId: A.id, face: -1 }, b: { compId: B.id, face: -1 } };
  const picked: string[] = [];
  const geos: Partial<Record<"a" | "b", FaceGeo>> = {};
  if (kind !== "lock") {
    // text → krok vazby: A [2. plocha A] B [2. plocha B] [rovina C]
    const textOf = (s: SlotSpec): { spec?: FaceSpec; comp: AsmComponent } => {
      if (s.key === "a") return { spec: cmd.faceA, comp: A };
      if (s.key === "b") return { spec: cmd.faceB, comp: B };
      if (kind === "symmetric") return { spec: cmd.faceC, comp: C };
      if (s.side === "self") return { spec: cmd.faceA2, comp: A };
      return { spec: cmd.faceB2, comp: B };
    };
    // osa komponenty z její vazby Souosost / Závěs (kolo, hřídel) – výchozí pro Ozubení, Šroub, Kardan
    const axisOf = (compId: string) => new Set((d.mates ?? []).filter((x) => (x.type === "concentric" || x.type === "hinge") && !x.suppressed).flatMap((x) => [x.a, x.b].filter((r) => r.compId === compId && !r.ent).map((r) => `${r.leaf ?? r.compId}:${r.face}`)));
    const cache = new Map<string, EntRow[]>();
    for (const s of spec.slots) {
      const { spec: fs, comp } = textOf(s);
      if (!fs && s.optional) continue;
      if (!fs && kind === "hinge" && (s.key === "c" || s.key === "d")) continue;
      if (s.key === "c" && kind === "width" && !fs) continue;
      const want = { face: s.kinds.some((k) => k === "plane" || k === "cylinder" || k === "sphere" || k === "face"), anyFace: s.kinds.includes("face"), edge: s.kinds.some((k) => k === "edge" || k === "line" || k === "circle" || k === "curve"), vertex: s.kinds.includes("vertex") || fs?.ent === "vertex" };
      if (fs?.ent === "edge") want.edge = true;
      const ck = `${comp.id}:${JSON.stringify(want)}`;
      if (!cache.has(ck)) cache.set(ck, await compEntRows(d, comp.id, env, want));
      const axes = axisOf(comp.id);
      const row = pickEnt(fs, cache.get(ck)!, s.kinds, comp.name, `${tr(s.label)}: `, (r) => axes.has(`${r.leafId}:${r.index}`));
      const ref: MateRef = { compId: comp.id, ...(row.leafId !== comp.id ? { leaf: row.leafId } : {}), face: row.index, ...(row.ent ? { ent: row.ent } : {}) };
      m[s.key] = ref;
      if (s.key === "a" || s.key === "b") geos[s.key] = row.g;
      picked.push(`${s.key.toUpperCase()} ${entText(row)}`);
    }
    if (kind === "width" && m.a && !m.c && geos.a?.kind !== "cylinder") throw new Error(tr("vazba Šířka: jazýček potřebuje dvě rovinné plochy (nebo čep) – sestava vazba šířka \"A\" F1 F2 \"B\" F3 F4"));
    if (kind === "hinge" && !!m.c !== !!m.d) throw new Error(tr("vazba Závěs: dosedací roviny zadejte obě (A i B), nebo žádnou"));
  }
  if (cmd.value !== undefined) m.value = cmd.value;
  else if (kinHasValue(kind)) m.value = kinDefaults(kind, geos.a ?? null, geos.b ?? null).value;
  if (cmd.min !== undefined) m.min = cmd.min;
  if (cmd.max !== undefined) m.max = cmd.max;
  if (cmd.flip) m.flip = true;
  if (cmd.name) m.name = cmd.name;
  const s = await solveAsm({ ...d, mates: [...(d.mates ?? []), m] }, env);
  const st = s.status[m.id];
  const made = s.doc.mates!.find((x) => x.id === m.id)!;
  log.push(tr("{0} vazba {1}: {2} · {3}", st === "ok" ? "✓" : "⚠", mateText(s.doc, made), STATUS_WORD(st), s.moved.length ? movedText(s.doc, s.moved) : tr("poloha beze změny")));
  if (picked.length) log.push(tr("  vybráno: {0}", picked.join(" · ")));
  if (cmd.value === undefined && kinHasValue(kind)) log.push(tr("  hodnota z geometrie: {0} – změna: sestava vazba {1} hodnota=N", fmt(m.value ?? 0, 4), s.doc.mates!.length));
  if (st === "conflict") log.push(tr("⚠ vazbu {0} nelze splnit spolu s ostatními – sestava vazby, sestava vazba {1} potlačit|smazat|obráceně", label, s.doc.mates!.length));
  if (st === "missing") log.push(tr("⚠ geometrii vazby se nepodařilo načíst z jádra – sestava vazby po dostavění dílů vazbu přepočítá"));
  return { doc: s.doc, log, changed: true, mateStatus: s.status };
}

/* ───────────────────────── pohybová studie ───────────────────────── */

let last: { sig: string; res: MotionResult } | null = null;
const studySig = (d: CadDoc) => JSON.stringify({ c: (d.components ?? []).map((c) => [c.id, c.placement, c.fixed, c.hidden]), m: d.mates, s: d.motion });

/** Spočítá pohybovou studii sestavy (geometrie z jádra, volitelně kolize); výsledek se pamatuje pro stejnou sestavu a studii. */
export async function motionRun(d: CadDoc, env: AsmEnv, opts: { onStep?: (k: number, n: number) => void; cancel?: () => boolean; force?: boolean } = {}): Promise<MotionResult> {
  const study = d.motion;
  if (!study?.motors.length) throw new Error(tr("pohybová studie nemá žádný motor – pohyb motor rotační \"Klika\" 0..360"));
  const sig = studySig(d);
  if (!opts.force && last?.sig === sig) return last.res;
  const flat = flattenAssembly(d);
  const byLeaf = new Map(flat.map((l) => [leafId(l), l]));
  await ensureBuilt(env, flat);
  const mates = await ensureMateRefs(d.mates ?? [], (ref) => byLeaf.get(ref.leaf ?? ref.compId)?.key ?? null, env.geo, { face: env.mateFace, ent: env.mateEnt, cylFace: env.cylFace });
  const doc = { ...d, mates };
  const collide = env.interference ? async (x: CadDoc) => (await env.interference!(x)).map((c) => ({ a: c.a, b: c.b, volume: c.volume })) : undefined;
  const res = await runMotion(doc, geoProvider(doc, env), study, { collide, onStep: opts.onStep, cancel: opts.cancel });
  if (!opts.cancel?.()) last = { sig, res };
  return res;
}
/** poslední spočtený výsledek pro tuto sestavu (bez výpočtu) */
export const motionCached = (d: CadDoc): MotionResult | null => (last && last.sig === studySig(d) ? last.res : null);

/** Řádky tabulky pro window.mncad.motion: krok, čas, motory, polohy a natočení komponent podle názvu, stopa, kolize. */
export function motionTable(d: CadDoc, res: MotionResult) {
  const name = (id: string) => d.components?.find((c) => c.id === id)?.name ?? id;
  return res.steps.map((s) => ({
    step: s.i,
    t: s.t,
    motors: s.motors,
    comps: Object.fromEntries(Object.entries(s.place).map(([id, p]) => [name(id), { position: p.position, rotation: p.rotation }])),
    ...(s.trace ? { trace: s.trace } : {}),
    ...(s.clashes ? { clashes: s.clashes.map((c) => `${name(c.a)} × ${name(c.b)}`) } : {}),
    conflicts: s.conflicts.length,
  }));
}

/** Vazba, na které motor komponenty běží: rotační Závěs > Souosost > Šroub, lineární Vzdálenost > Drážka > Dráha > Souosost > Šroub; ukotvený protějšek má přednost. */
export function motorMate(d: CadDoc, comp: AsmComponent, kind: "rotary" | "linear"): { mate: Mate; invert: boolean } {
  const order = kind === "rotary" ? ["hinge", "concentric", "screw"] : ["distance", "slot", "path", "concentric", "screw"];
  const set = kind === "rotary" ? ROTARY_MOTOR_TYPES : LINEAR_MOTOR_TYPES;
  const fixed = (id: string) => !!d.components?.find((c) => c.id === id)?.fixed || (d.mates ?? []).some((m) => m.type === "fixed" && !m.suppressed && m.a.compId === id);
  const list = (d.mates ?? []).filter((m) => !m.suppressed && set.has(m.type) && (m.a.compId === comp.id || m.b.compId === comp.id));
  if (!list.length)
    throw new Error(
      kind === "rotary"
        ? tr("komponenta „{0}“ nemá vazbu Závěs, Souosost ani Šroub – rotační motor potřebuje osu (sestava vazba závěs \"{0}\" … \"Rám\" …)", comp.name)
        : tr("komponenta „{0}“ nemá vazbu Vzdálenost, Drážka, Dráha, Souosost ani Šroub – lineární motor potřebuje posuvnou vazbu", comp.name),
    );
  const other = (m: Mate) => (m.a.compId === comp.id ? m.b.compId : m.a.compId);
  const best = [...list].sort((x, y) => Number(fixed(other(y))) - Number(fixed(other(x))) || order.indexOf(x.type) - order.indexOf(y.type))[0];
  return { mate: best, invert: best.b.compId === comp.id };
}

const signal = (doc: CadDoc, log: string[], changed: boolean, motion?: MotionSignal): AsmResult => ({ doc, log, changed, ...(motion ? { motion } : {}) });

/** Provede příkaz „pohyb …“. */
export async function applyMotionCmd(d: CadDoc, cmd: MotionCmd, env: AsmEnv): Promise<AsmResult> {
  const log: string[] = [];
  const study: MotionStudy = d.motion ? { ...d.motion, motors: [...d.motion.motors] } : defaultStudy();
  const runLog = async (doc: CadDoc) => {
    const res = await motionRun(doc, env);
    log.push(...motionSummary(res, doc));
    return res;
  };
  const studyLines = (doc: CadDoc) => {
    const s = doc.motion;
    if (!s) return [tr("Pohybová studie: žádná – pohyb motor rotační \"Klika\" 0..360 [krok 5] [kolize]")];
    const tc = s.trace ? doc.components?.find((c) => c.id === s.trace!.compId) : null;
    return [
      tr("Pohybová studie: motorů {0} · kroků {1} · {2} s{3}{4}", s.motors.length, s.steps, fmt(s.duration, 3), s.collisions ? tr(" · kolize") : "", tc ? tr(" · stopa „{0}“ {1}", tc.name, pt(s.trace!.point)) : ""),
      ...s.motors.map((mo, i) => ` ${i + 1}. ${motorText(mo, doc)}`),
    ];
  };
  const applyOpts = (o: { steps?: number; step?: number; duration?: number; collisions?: boolean; trace?: { comp: string; point?: Vec3 } | null }, span?: number) => {
    if (o.steps !== undefined) study.steps = o.steps;
    if (o.step !== undefined) study.steps = Math.max(1, Math.min(2000, Math.round(Math.abs(span ?? 360) / o.step)));
    if (o.duration !== undefined) study.duration = o.duration;
    if (o.collisions !== undefined) study.collisions = o.collisions || undefined;
    if (o.trace === null) delete study.trace;
    else if (o.trace) {
      const c = findComp(d, o.trace.comp);
      study.trace = { compId: c.id, point: o.trace.point ?? [0, 0, 0] };
    }
  };
  switch (cmd.op) {
    case "status": {
      log.push(...studyLines(d));
      if (d.motion?.motors.length) await runLog(d);
      return signal(d, log, false);
    }
    case "motor": {
      let mate: Mate;
      let invert = false;
      if (cmd.mate !== undefined) mate = findMate(d, cmd.mate);
      else ({ mate, invert } = motorMate(d, findComp(d, cmd.comp!), cmd.kind));
      const p = motorProblem({ kind: cmd.kind, mate: mate.id }, d.mates ?? []);
      if (p) throw new Error(tr("motor: {0}", p));
      const k = invert ? -1 : 1;
      const mo: MotionMotor = { id: uid(), kind: cmd.kind, mate: mate.id, from: k * cmd.from, to: k * cmd.to, ...(cmd.speed !== undefined ? { speed: k * cmd.speed } : {}) };
      const i = study.motors.findIndex((x) => x.mate === mate.id);
      if (i >= 0) study.motors[i] = { ...mo, id: study.motors[i].id };
      else study.motors.push(mo);
      applyOpts(cmd, cmd.to - cmd.from);
      const doc = { ...d, motion: study };
      log.push(tr("✓ motor {0}: {1}{2}", i >= 0 ? i + 1 : study.motors.length, motorText(i >= 0 ? study.motors[i] : mo, doc), invert ? tr(" (komponenta je B vazby – hodnoty s opačným znaménkem)") : ""));
      await runLog(doc);
      return signal(doc, log, true, { open: true });
    }
    case "set": {
      applyOpts(cmd, study.motors[0] ? study.motors[0].to - study.motors[0].from : undefined);
      const doc = { ...d, motion: study };
      log.push(...studyLines(doc));
      if (study.motors.length) await runLog(doc);
      return signal(doc, log, true, { open: true });
    }
    case "run":
      log.push(...studyLines(d));
      await runLog(d);
      return signal(d, log, false, { open: true });
    case "play": {
      const res = await motionRun(d, env);
      log.push(tr("▶ přehrávání {0} kroků ({1} s){2}", res.steps.length - 1, fmt(d.motion!.duration, 3), cmd.loop ? tr(" dokola") : ""));
      return signal(d, log, false, { open: true, play: true, loop: cmd.loop });
    }
    case "stop":
      log.push(tr("■ přehrávání zastaveno"));
      return signal(d, log, false, { stop: true });
    case "step": {
      const res = await motionRun(d, env);
      const s = res.steps[Math.max(0, Math.min(res.steps.length - 1, cmd.n))];
      log.push(tr("Krok {0} (t = {1} s, motory {2}):", s.i, fmt(s.t, 4), s.motors.map((v) => fmt(v, 3)).join("; ")));
      for (const c of d.components ?? []) {
        const pl = s.place[c.id];
        if (pl) log.push(` ${c.name} ${pt(pl.position, 4)}${pl.rotation.some((x) => Math.abs(x) > 1e-9) ? ` ∠${pt(pl.rotation, 4)}` : ""}`);
      }
      if (s.trace) log.push(tr(" stopa {0}", pt(s.trace, 4)));
      if (s.clashes?.length) log.push(tr(" ⚠ kolize: {0}", s.clashes.map((x) => `${d.components?.find((c) => c.id === x.a)?.name} × ${d.components?.find((c) => c.id === x.b)?.name}`).join(", ")));
      if (s.conflicts.length) log.push(tr(" ⚠ nesplněné vazby: {0}", s.conflicts.length));
      return signal(d, log, false, { open: true, step: s.i });
    }
    case "export": {
      const res = await motionRun(d, env);
      if (cmd.format === "csv") {
        const csv = motionCsv(res, d);
        log.push(tr("CSV pohybové studie ({0} řádků):", res.steps.length));
        log.push(...csv.replace(/^﻿/, "").trimEnd().split("\r\n"));
        return signal(d, log, false, { export: "csv" });
      }
      log.push(cmd.format === "png" ? tr("Snímky PNG ({0}) se uloží z 3D okna (jen v aplikaci)", res.steps.length) : tr("Video WebM se nahraje z 3D okna (jen v aplikaci)"));
      return signal(d, log, false, { open: true, export: cmd.format });
    }
    case "removeMotor": {
      if (!study.motors[cmd.n - 1]) throw new Error(tr("motor {0} ve studii není – motorů: {1}", cmd.n, study.motors.length));
      study.motors.splice(cmd.n - 1, 1);
      log.push(tr("✓ motor {0} odebrán", cmd.n));
      return signal({ ...d, motion: study }, log, true);
    }
    case "clear": {
      const doc = { ...d };
      delete doc.motion;
      log.push(tr("✓ pohybová studie smazána"));
      return signal(doc, log, true, { stop: true });
    }
  }
}

/** Sestava v poloze kroku studie (pro zobrazení v panelu). */
export const stepDoc = (d: CadDoc, res: MotionResult, i: number) => poseDoc(d, res.steps[Math.max(0, Math.min(res.steps.length - 1, i))]?.place ?? {});
