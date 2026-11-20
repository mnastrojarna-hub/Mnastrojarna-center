/**
 * Provedení pokročilých a mechanických vazeb a pohybové studie zadaných textem (cad/agent-asm.ts, cad/agent-motion.ts).
 * Entity komponent (plochy včetně koulí a obecných ploch vaček, hrany, vrcholy) se vyberou podle F/E/V čísla nebo pravidla,
 * vazba se vytvoří stejně jako v panelu sestavy (cad/mate-spec.ts) a sestava se přepočítá. Pohybová studie se počítá řešičem
 * (cad/motion.ts) nad geometrií z jádra; výsledek se drží podle dokumentu a otisku jeho stavu (cad/motion-cache.ts – panel
 * v aplikaci, `pohyb stav / krok / export`, `stav` i `window.mncad.motion()` čtou tentýž záznam; po změně dílu, polohy, vazby nebo
 * studie neplatí a nikdy se nevydává za platný).
 */
import { flattenAssembly, instanceKey, transformPoint } from "./assembly";
import { F_CIRCLE, F_LINE, F_POINT, F_SPHERE, faceArgWords, findComp, findMate, fmt, mateText, pt, type AsmCmd, type FaceSpec } from "./agent-asm";
import type { MotionCmd } from "./agent-motion";
import { conflictCode, ensureBuilt, faceInfo, geoProvider, leafId, movedText, partFaces, pathNames, solveAsm, solveNotes, STATUS_WORD, type AsmEnv, type AsmResult } from "./asm-agent";
import { tr } from "./i18n";
// kolize pohybu podle tříd (vlna 22, bod 5): zařazení při výpočtu kroku, souhrny a `pohyb krok` – cad/clash-motion.ts, clash-report.ts
import { classifyStepClashes, collideClassified, motionClashLines, stepClashLines } from "./clash-motion";
import { motionClashKv, type MotionClashStats } from "./clash-report";
import { ensureMateRefs, entKey } from "./mate-geo";
import { KIN_SPEC, accepts, entKindOf, kinDefaults, kinHasValue, type EntKind, type SlotSpec } from "./mate-spec";
import { MATE_LABEL, faceAreas, worldGeo, type FaceGeo, type KinMateType } from "./mates";
import { LINEAR_MOTOR_TYPES, ROTARY_MOTOR_TYPES } from "./mates-kin";
import { springSeatMates } from "./asm-spring";
import { defaultStudy, motionFindings, motionGroups, motionMotorNotes, motorProblem, motorText, poseDoc, runMotion, type MotionResult } from "./motion";
import { levelKv, levelLine, levelOf, studyMode } from "./motion-mode";
import { devText } from "./motion-quasi";
import { motionSlot, motionState, motionStateOf, runStored } from "./motion-cache";
import { buildMotor, fitDuration, motorCurrent, motorIsAbsolute, motorSpan } from "./motor-model";
import { fmtNum } from "./engine/protocol";
import { applyDynCmd, dynamicRun, dynStudyLine } from "./asm-agent-dyn";
import { applyMotionViewCmd, type MotionVideoSignal } from "./agent-motion-view";
// kinematická studie beze změny (cad/motion.ts), dynamická navíc s řádky / sloupci dynamiky (vlna 21)
import { isDyn, studyCsv as motionCsv, studySummary as motionSummary } from "./motion-dynamic-report";
import type { DynMotionStep } from "./motion-dynamic";
import { uid, type AsmComponent, type CadDoc, type Mate, type MateRef, type MotionMotor, type MotionStudy, type Vec3 } from "./types";

/** Pokyn pro panel pohybové studie v aplikaci. */
export type MotionSignal = { play?: boolean; loop?: boolean; stop?: boolean; step?: number; export?: "csv" | "png" | "webm"; open?: boolean; /** volby exportu (časování, pohledy, anotace) a aktivní pohled ("" = okno) – vlna 22, cad/agent-motion-view.ts */ video?: MotionVideoSignal; view?: string };

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
  const s = await solveAsm({ ...d, mates: [...(d.mates ?? []), m] }, env, null, { equilibrium: true, focus: m.id });
  const st = s.status[m.id];
  const made = s.doc.mates!.find((x) => x.id === m.id)!;
  log.push(tr("{0} vazba {1}: {2} · {3}", st === "ok" ? "✓" : "⚠", mateText(s.doc, made), STATUS_WORD(st), s.moved.length ? movedText(s.doc, s.moved) : tr("poloha beze změny")));
  if (picked.length) log.push(tr("  vybráno: {0}", picked.join(" · ")));
  if (cmd.value === undefined && kinHasValue(kind)) log.push(tr("  hodnota z geometrie: {0} – změna: sestava vazba {1} hodnota=N", fmt(m.value ?? 0, 4), s.doc.mates!.length));
  if (st === "conflict") log.push(tr("⚠ vazbu {0} nelze splnit spolu s ostatními – sestava vazby, sestava vazba {1} potlačit|smazat|obráceně", label, s.doc.mates!.length));
  if (st === "missing") log.push(tr("⚠ geometrii vazby se nepodařilo načíst z jádra – sestava vazby po dostavění dílů vazbu přepočítá"));
  log.push(...solveNotes(s.doc, s));
  return { doc: s.doc, log, changed: true, mateStatus: s.status, ...(s.conflict ? { codes: [conflictCode(s.conflict)] } : {}) };
}

/* ───────────────────────── pohybová studie ───────────────────────── */

/**
 * Spočítá pohybovou studii sestavy (geometrie z jádra, volitelně kolize). Výsledek se pamatuje pro dokument prostředí
 * (`env.motion`) a otisk jeho stavu – stejný stav = uložený výsledek, jiný stav (i jen změněná geometrie dílu, poloha uvnitř
 * podsestavy, u dynamiky materiál) = nový výpočet. Běží-li výpočet téhož stavu, volání se k němu připojí (motion-cache.ts
 * `runStored`); výpočet jiného stavu téhož dokumentu předchozí ruší; zrušený / nahrazený výpočet se neukládá.
 */
export async function motionRun(d: CadDoc, env: AsmEnv, opts: { onStep?: (k: number, n: number) => void; cancel?: () => boolean; force?: boolean } = {}): Promise<MotionResult> {
  const study = d.motion;
  // dynamika (cad/motion-dynamic.ts) motor nepotřebuje – hýbou síly pružin, gravitace a zadané síly
  if (!study?.motors.length && study?.mode !== "dynamic") throw new Error(tr("pohybová studie nemá žádný motor – pohyb motor rotační \"Klika\" 0..360"));
  const slot = motionSlot(env);
  if (!opts.force) {
    const st = motionStateOf(slot.store, slot.key, d);
    if (st.state === "ok") return st.entry.res;
  }
  return runStored(
    slot,
    d,
    async (cancel, onStep) => {
      const flat = flattenAssembly(d);
      const byLeaf = new Map(flat.map((l) => [leafId(l), l]));
      await ensureBuilt(env, flat);
      // geometrie i pro dosedací plochy pružin (pomocné „vazby“ se do dokumentu nevrací)
      const n0 = d.mates?.length ?? 0;
      const mates = (await ensureMateRefs([...(d.mates ?? []), ...springSeatMates(d)], (ref) => byLeaf.get(ref.leaf ?? ref.compId)?.key ?? null, env.geo, { face: env.mateFace, ent: env.mateEnt, cylFace: env.cylFace })).slice(0, n0);
      const doc = { ...d, mates };
      // kolize v kroku: jádro kontroluje přírůstkově (dvojice se stejnou vzájemnou polohou se nepočítají znovu); počty jdou do časů studie;
      // dvojice se hned zařadí (šroub v závitu / skutečná… – clash-motion.ts), s cestami listů a místem průniku
      const collide = collideClassified(env);
      return study!.mode === "dynamic" ? await dynamicRun(doc, env, geoProvider(doc, env), study!, { collide, onStep, cancel }) : await runMotion(doc, geoProvider(doc, env), study!, { collide, onStep, cancel });
    },
    opts.cancel,
    opts.onStep,
  );
}
/**
 * uložený výsledek, jen pokud platí pro tento dokument v jeho nynějším stavu (bez výpočtu); jinak null – starý výsledek se nikdy
 * nevrací jako platný
 */
export const motionCached = (d: CadDoc, env: Pick<AsmEnv, "motion" | "geo">): MotionResult | null => {
  const st = motionState(d, env);
  return st.state === "ok" ? st.entry.res : null;
};

/**
 * Řádky tabulky pro window.mncad.motion: krok, čas, motory, polohy a natočení komponent, stopa, kolize, pružiny. Klíč komponenty =
 * název, u stejných názvů „název #k“ / „název [přezdívka]“ (instanceKey) – 70 komponent 959 = 70 záznamů, ne 27 podle názvů.
 */
export function motionTable(d: CadDoc, res: MotionResult) {
  const name = (id: string) => instanceKey(d, id);
  return res.steps.map((s) => ({
    step: s.i,
    t: s.t,
    motors: s.motors,
    comps: Object.fromEntries(Object.entries(s.place).map(([id, p]) => [name(id), { position: p.position, rotation: p.rotation }])),
    ...(s.trace ? { trace: s.trace } : {}),
    ...(s.clashes ? { clashes: s.clashes.map((c) => `${name(c.a)} × ${name(c.b)}`) } : {}),
    ...(s.springs ? { springs: Object.fromEntries(Object.entries(s.springs).map(([id, x]) => [name(id), { length: x.length, seat: x.seat, ...(x.force !== undefined ? { force: x.force } : {}), level: x.level }])) } : {}),
    // dynamika: těžiště, rychlost [mm/s] a zrychlení [mm/s²] pohyblivých těles
    ...((s as DynMotionStep).dyn ? { dyn: Object.fromEntries(Object.entries((s as DynMotionStep).dyn!).map(([id, x]) => [name(id), x])) } : {}),
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

export { classifyStepClashes, motionClashLines, type MotionClashStats };

const signal = (doc: CadDoc, log: string[], changed: boolean, motion?: MotionSignal, codes?: AsmResult["codes"], kv?: string): AsmResult => ({ doc, log, changed, ...(motion ? { motion } : {}), ...(codes?.length ? { codes } : {}), ...(kv ? { kv } : {}) });

/**
 * Motory studie na strojovém řádku (vlna 22, bod 9 – směr a konec i ve stručném protokolu): `m<i>=<průběh>:<začátek>><konec>:<směr>`
 * na KONCI řádku, jedno pole na motor. Průběh `range` (rozsah za dobu studie) | `back` (tam a zpět: `začátek>konec>začátek`) |
 * `ranged` (rozsah × rychlost: dojede a stojí) | `open` (jen rychlost: konec = hodnota na konci studie); hodnoty v jednotkách motoru
 * (mm / °, desetinná tečka); směr `+` hodnota roste, `-` klesá, `0` stojí, tam a zpět `+-` / `-+`. Např. přesný příkaz zprávy
 * `57,5..27,15 rychlost 15,175` → `m1=ranged:57.5>27.15:-` (dřív jel opačně na 87,85 a řádek to nijak neukázal).
 */
export function motorKv(motors: readonly MotionMotor[], duration: number): string[] {
  return motors.map((mo, i) => {
    const s = motorSpan(mo, duration);
    const n = (v: number) => fmtNum(v, 4);
    const d = s.dir > 0 ? "+" : s.dir < 0 ? "-" : "0";
    const vals = s.mode === "back" ? `${n(s.start)}>${n(s.end!)}>${n(s.start)}` : `${n(s.start)}>${n(s.mode === "open" ? s.endAt : s.end!)}`;
    return `m${i + 1}=${s.mode}:${vals}:${s.mode === "back" && s.dir ? d + (s.dir > 0 ? "-" : "+") : d}`;
  });
}

/**
 * Strojový souhrn studie na JEDEN řádek (zkouška 959, B6 – protokol místo rozsahu každé komponenty):
 * `motion steps=40 t=2 motors=1 conflicts=0 travel=50mm:36,20mm:1 static=33 [rot=N] [clash.steps=41/41 thread=30 real=1 first.real=3]
 * [mode=dyn …] m1=range:0>50:+` – `travel` = zdvih tuhých skupin (`motionGroups`) s počtem komponent; motory (`motorKv`: průběh,
 * začátek > konec, směr) vždy na konci; lokalizovaný výpis zůstává v plném protokolu.
 */
export function motionKv(res: MotionResult, cl: MotionClashStats | null, duration = res.steps[res.steps.length - 1]?.t ?? 0): string {
  const g = motionGroups(res);
  const n = (v: number) => fmtNum(v, 3);
  const parts = [
    `steps=${Math.max(0, res.steps.length - 1)}`,
    `t=${n(res.steps[res.steps.length - 1]?.t ?? 0)}`,
    `motors=${res.motors.length}`,
    `conflicts=${res.conflictSteps}`,
    ...(g.moving.length ? [`travel=${g.moving.map((x) => `${n(x.travel)}mm:${x.n}`).join(",")}`] : []),
    `static=${g.still}`,
    ...(g.rotating ? [`rot=${g.rotating}`] : []),
    ...(cl ? motionClashKv(cl) : []),
    ...(isDyn(res) ? dynKv(res) : []),
    ...motorKv(res.motors, duration),
    // vlna 22, body 2 a 8 – nová pole na KONEC řádku: kroky s motorem na mezi, neplatné kroky, díly volné v mezi, úroveň simulace
    ...(stopped(res) ? [`stopped=${stopped(res)}`] : []),
    ...(invalid(res) ? [`invalid=${invalid(res)}`] : []),
    ...(res.undetermined?.length ? [`undetermined=${res.undetermined.length}`] : []),
    levelKv(res.level ?? { level: isDyn(res) ? "dynamic" : "kinematic" }),
  ];
  return `motion ${parts.join(" ")}`;
}
const stopped = (res: MotionResult) => res.steps.filter((s) => s.status === "stopped").length;
const invalid = (res: MotionResult) => res.steps.filter((s) => s.status === "invalid").length;

/**
 * Dynamika na strojovém řádku studie (vlna 21): `mode=dyn bodies=1 spring.max=85.9N@0.238s stops=2 return=0.375s
 * [drift=0.01%]` – největší síla pružiny, počet dorazů s dotykem, první návrat na doraz a kontrola energie (bez motorů).
 */
function dynKv(res: import("./motion-dynamic").DynResult): string[] {
  const d = res.dynamic;
  const n = (v: number, k = 3) => fmtNum(v, k);
  const back = d.contacts.map((c) => (c.intervals[0]?.[0] === 0 && c.intervals.length > 1 ? c.intervals[1][0] : null)).filter((t): t is number => t !== null);
  return [
    "mode=dyn",
    `bodies=${d.bodies.length}`,
    ...(d.springMax ? [`spring.max=${n(d.springMax.force, 1)}N@${n(d.springMax.t, 4)}s`] : []),
    `stops=${d.contacts.filter((c) => c.intervals.length).length}`,
    ...(back.length ? [`return=${n(Math.min(...back), 4)}s`] : []),
    ...(d.energy.drift !== null ? [`drift=${n(d.energy.drift * 100, 3)}%`] : []),
  ];
}

/** Provede příkaz „pohyb …“. */
export async function applyMotionCmd(d: CadDoc, cmd: MotionCmd, env: AsmEnv): Promise<AsmResult> {
  const log: string[] = [];
  const study: MotionStudy = d.motion ? { ...d.motion, motors: [...d.motion.motors] } : defaultStudy();
  const codes: NonNullable<AsmResult["codes"]> = [];
  let kv: string | undefined;
  const runLog = async (doc: CadDoc) => {
    const res = await motionRun(doc, env);
    const cl = res.collisionsChecked ? await motionClashLines(res, doc, env) : null;
    // upozornění k motorům jdou do protokolu jako záznamy s kódem (stručný protokol nemá výpis) – ve výpisu by byla podruhé
    log.push(...motionSummary(res, doc, { ...(cl ? { collisionLines: cl.lines } : {}), notes: false }));
    if (cl) codes.push(...cl.codes);
    for (const x of motionMotorNotes(res, doc)) codes.push({ code: x.code, args: x.args, text: x.text });
    // motor na mezi, neplatné kroky, vazbami neurčená poloha (body 2 a 8) – záznamy s kódem a celou větou
    for (const x of motionFindings(res, doc)) codes.push({ code: x.code, args: x.args, text: x.text });
    kv = motionKv(res, cl?.stats ?? null, doc.motion?.duration);
    return res;
  };
  /**
   * příkaz potřebuje výsledek a uložený pro nynější stav sestavy neplatí → přepočítá se; ℹ řekne, co se od výpočtu změnilo
   * (uživatel dřív dostal starý výsledek bez jediného slova – bod 1 zprávy)
   */
  const noteRecompute = (doc: CadDoc) => {
    const st = motionState(doc, env);
    if (st.state === "stale") codes.push({ code: "motion.recomputed", args: [st.changed.join("; ")] });
  };
  const studyLines = (doc: CadDoc) => {
    const s = doc.motion;
    if (!s) return [tr("Pohybová studie: žádná – pohyb motor rotační \"Klika\" 0..360 [krok 5] [kolize]")];
    const tc = s.trace ? doc.components?.find((c) => c.id === s.trace!.compId) : null;
    const dl = dynStudyLine(doc);
    return [
      tr("Pohybová studie: motorů {0} · kroků {1} · {2} s{3}{4}", s.motors.length, s.steps, fmt(s.duration, 3), s.collisions ? tr(" · kolize") : "", tc ? tr(" · stopa „{0}“ {1}", tc.name, pt(s.trace!.point)) : ""),
      ...s.motors.map((mo, i) => ` ${i + 1}. ${motorText(mo, doc)}`),
      ...(dl ? [dl] : []),
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
      if (d.motion?.motors.length || d.motion?.mode === "dynamic") {
        // stav = hlášení, ne výpočet: výsledek, který pro nynější sestavu neplatí, se nevypíše (žádný starý souhrn) ani tiše
        // nepřepočítá – ⚠ motion.stale řekne, co se změnilo; strojový řádek nese jen definici studie a `motion.stale=1`
        const st = motionState(d, env);
        if (st.state === "stale") {
          codes.push({ code: "motion.stale", args: [st.changed.join("; ")] });
          kv = [`motion steps=${d.motion.steps} t=${fmtNum(d.motion.duration, 3)} motors=${d.motion.motors.length} motion.stale=1`, ...motorKv(d.motion.motors, d.motion.duration)].join(" ");
        } else await runLog(d);
      }
      return signal(d, log, false, undefined, codes, kv);
    }
    case "motor": {
      let mate: Mate;
      let invert = false;
      if (cmd.mate !== undefined) mate = findMate(d, cmd.mate);
      else ({ mate, invert } = motorMate(d, findComp(d, cmd.comp!), cmd.kind));
      const p = motorProblem({ kind: cmd.kind, mate: mate.id }, d.mates ?? []);
      if (p) throw new Error(tr("motor: {0}", p));
      // význam hodnot: Vzdálenost / Drážka s polohou = hodnota vazby (absolutní – znaménko se NEobrací, ani když je komponenta B vazby:
      // mezera nezávisí na pořadí komponent); ostatní = posuv / natočení od výchozí polohy (zadáno komponentou B → opačné znaménko)
      const abs = motorIsAbsolute({ kind: cmd.kind }, mate);
      const i = study.motors.findIndex((x) => x.mate === mate.id);
      const mo = buildMotor(
        { kind: cmd.kind, ...(cmd.start === "current" ? {} : { from: cmd.from }), ...(cmd.stroke !== undefined ? { stroke: cmd.stroke } : cmd.auto ? {} : { to: cmd.to }), ...(cmd.speed !== undefined ? { speed: cmd.speed } : {}), ...(cmd.back ? { back: true } : {}) },
        { id: i >= 0 ? study.motors[i].id : uid(), mate: mate.id, abs, current: motorCurrent({ kind: cmd.kind }, mate), sign: invert ? -1 : 1 },
      );
      // chování na mezi (bod 8): výchozí stop se neukládá; „chyba“ = kroky za mezí neplatné (poslední platná poloha)
      if (cmd.atLimit === "error") mo.atLimit = "error";
      if (i >= 0) study.motors[i] = mo;
      else study.motors.push(mo);
      const idx = i >= 0 ? i : study.motors.length - 1;
      applyOpts({ ...cmd, step: undefined });
      // délka studie: rozsah × rychlost ji určuje (|do − od| / rychlost); rozpor se zadaným časem = chyba, prodloužení = ⚠
      const fit = fitDuration(study, idx, cmd.duration);
      study.duration = fit.duration;
      if (fit.note) codes.push({ code: fit.note.code, args: fit.note.args, text: fit.note.text });
      if (cmd.step !== undefined) study.steps = Math.max(1, Math.min(2000, Math.round(motorSpan(mo, study.duration).stroke / cmd.step)));
      const doc = { ...d, motion: study };
      const side = !invert ? "" : abs ? tr(" (hodnota vazby je absolutní – nezáleží na tom, že komponenta je B vazby)") : tr(" (komponenta je B vazby – hodnoty s opačným znaménkem)");
      log.push(tr("✓ motor {0}: {1}{2}", idx + 1, motorText(mo, doc), side));
      await runLog(doc);
      return signal(doc, log, true, { open: true }, codes, kv);
    }
    case "set": {
      applyOpts(cmd, study.motors[0] ? motorSpan(study.motors[0], cmd.duration ?? study.duration).stroke : undefined);
      const doc = { ...d, motion: study };
      log.push(...studyLines(doc));
      if (study.motors.length || study.mode === "dynamic") await runLog(doc);
      return signal(doc, log, true, { open: true }, codes, kv);
    }
    case "mode": {
      // režim studie (bod 2): kvazistatika = rovnováha pružin a kontaktů v každém kroku; automaticky = podle pružin v sestavě
      if (cmd.mode) study.mode = cmd.mode;
      else delete study.mode;
      const doc = { ...d, motion: study };
      log.push(tr("✓ pohybová studie: {0}", levelLine(levelOf(studyMode(doc, study)))));
      if (study.motors.length) await runLog(doc);
      return signal(doc, log, true, { open: true }, codes, kv);
    }
    case "dyn": {
      // dynamika, hmotnost, síla / moment (cad/asm-agent-dyn.ts); kódy kolizí a strojový řádek studie z `runLog` jako u ostatních
      const r = await applyDynCmd(d, cmd.cmd, study, { runLog, lines: studyLines, log });
      return signal(r.doc, r.log, r.changed, r.motion, codes, kv);
    }
    case "view":
      // pohledy studie, video s pevným časováním, anotace (vlna 22, body 13–14 – cad/agent-motion-view.ts)
      return applyMotionViewCmd(d, cmd.cmd, { run: async () => (noteRecompute(d), motionRun(d, env)), codes });
    case "run":
      log.push(...studyLines(d));
      noteRecompute(d);
      await runLog(d);
      return signal(d, log, false, { open: true }, codes, kv);
    case "play": {
      noteRecompute(d);
      const res = await motionRun(d, env);
      log.push(tr("▶ přehrávání {0} kroků ({1} s){2}", res.steps.length - 1, fmt(d.motion!.duration, 3), cmd.loop ? tr(" dokola") : ""));
      return signal(d, log, false, { open: true, play: true, loop: cmd.loop }, codes);
    }
    case "stop":
      log.push(tr("■ přehrávání zastaveno"));
      return signal(d, log, false, { stop: true });
    case "step": {
      noteRecompute(d);
      const res = await motionRun(d, env);
      const s = res.steps[Math.max(0, Math.min(res.steps.length - 1, cmd.n))];
      log.push(tr("Krok {0} (t = {1} s, motory {2}):", s.i, fmt(s.t, 4), s.motors.map((v) => fmt(v, 3)).join("; ")));
      for (const c of d.components ?? []) {
        const pl = s.place[c.id];
        if (pl) log.push(` ${c.name} ${pt(pl.position, 4)}${pl.rotation.some((x) => Math.abs(x) > 1e-9) ? ` ∠${pt(pl.rotation, 4)}` : ""}`);
      }
      if (s.trace) log.push(tr(" stopa {0}", pt(s.trace, 4)));
      // kolize kroku podle tříd (v poloze kroku, pravidla dokumentu): šroub v závitu bez ⚠ (jako `kolize`), skutečné ⚠ po dvojicích s instancí a místem
      const sc = await stepClashLines(s, d, env);
      log.push(...sc.lines);
      // dynamika kontroluje kolize jen v každém k-tém snímku (motion-dynamic.ts clashEvery)
      if (res.collisionsChecked && s.clashes === undefined) log.push(tr(" kolize v tomto snímku nekontrolována (dynamika: každý {0}. snímek – pohyb kroky N)", isDyn(res) ? (res.dynamic.clashEvery ?? 1) : 1));
      const stepCodes: NonNullable<AsmResult["codes"]> = sc.codes;
      if (s.conflicts.length) log.push(tr(" ⚠ nesplněné vazby: {0}", s.conflicts.length));
      // detail konfliktu kroku (bod 8): stav, dosažené hodnoty motorů a VŠECHNY odchylky konfliktní množiny
      if (s.status === "stopped") log.push(tr(" ⚠ motor stojí na mezi: dosaženo {0} (žádáno {1})", (s.reached ?? []).map((v) => fmt(v, 4)).join("; "), s.motors.map((v) => fmt(v, 4)).join("; ")));
      if (s.status === "invalid") log.push(tr(" ⚠ NEŘEŠITELNÝ krok – zobrazena poslední platná poloha (krok {0}), žádný kompromis", s.shows ?? 0));
      for (const x of s.devs ?? []) log.push(`  ${tr("konflikt:")} ${devText(x)}`);
      if (res.level) log.push(` ${levelLine(res.level)}`);
      return signal(d, log, false, { open: true, step: s.i }, [...codes, ...stepCodes]);
    }
    case "export": {
      noteRecompute(d);
      const res = await motionRun(d, env);
      if (cmd.format === "csv") {
        const csv = motionCsv(res, d);
        log.push(tr("CSV pohybové studie ({0} řádků):", res.steps.length));
        log.push(...csv.replace(/^﻿/, "").trimEnd().split("\r\n"));
        return signal(d, log, false, { export: "csv" }, codes);
      }
      log.push(cmd.format === "png" ? tr("Snímky PNG ({0}) se uloží z 3D okna (jen v aplikaci)", res.steps.length) : tr("Video WebM se nahraje z 3D okna (jen v aplikaci)"));
      return signal(d, log, false, { open: true, export: cmd.format }, codes);
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
export const stepDoc = (d: CadDoc, res: MotionResult, i: number) => {
  const s = res.steps[Math.max(0, Math.min(res.steps.length - 1, i))];
  return poseDoc(d, s?.place ?? {}, s?.springs);
};
