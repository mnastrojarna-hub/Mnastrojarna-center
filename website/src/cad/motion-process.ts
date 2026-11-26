/**
 * Procesní vrstva pohybové studie (vlna 22, bod 4 zprávy majitele – „pohybová studie neukazovala vznik střihu a otisku“).
 *
 * | prvek | význam |
 * |---|---|
 * | `MotionStudy.process[]` (`ProcessOp`) | operace: `cut` střih / děrování, `imprint` otisk / ražení; nástroj, obrobek, hloubka, začátek, odpad |
 * | začátek `at` | podmínka studie (`MotionCond`: čas, hodnota motoru, hodnota vazby poháněné motorem) nebo začátek fáze (`{ phase }`); bez podmínky = od dotyku (poloha) |
 * | jádro (cad/process-kernel.ts) | v každém kroku původní obrobek ∩ nástroj v poloze kroku, sjednocení (odebraný objem roste), stav = obrobek − odebrané |
 * | výsledek `processOf(res)` | ODVOZENÝ výsledek studie (ukládá se s výsledkem pohybu): po krocích záběr, hloubka, prostřižení, stav obrobku; odpad |
 * | stav výrobku | plný → v záběru → děrovaný (odpad oddělen) / označený (otisk) / naříznutý (nástřih); vždy z kroku – krok 0 = plný |
 * | kolize | pracovní kontakt nástroj × obrobek od začátku operace = třída `work` (ℹ `clash.work`, jediný model pravidel C1), nikdy ⚠ clash.real |
 * | úroveň | `level.geo` = „+ geometrická aproximace“; protokol, panel i anotace videa říkají, že booleovské odebrání NENÍ simulace materiálu |
 *
 * Dokument se přehráním nemění: restart / krok 0 = plný obrobek. Prohlížeč, konzole i CLI používají tentýž výpočet (`processRun`
 * v `motionRun`, cad/asm-agent-kin.ts) – jen sítě pro zobrazení si prohlížeč vyžádá zvlášť (components/cad/process-meshes.ts).
 */
import { rotMatrix, sourceKey } from "./assembly";
import { isFault } from "./clash-rules";
import { nf } from "./clash-report";
import { tr } from "./i18n";
import type { MotionCollision, MotionResult, MotionStep } from "./motion";
import type { MotionEvent } from "./motion-phases";
import { condText } from "./motion-phases";
import type { ProcReq, ProcRes, ProcStep } from "./process-types";
import type { CadDoc, MotionCond, MotionStudy, Placement, ProcessOp, Vec3 } from "./types";

/* ───────────────────────── výsledek ───────────────────────── */

/** krok a čas události operace */
export type ProcAt = { step: number; t: number };
/** výsledek jedné operace (z jádra + okno operace) */
export type ProcOpResult = {
  id: string;
  kind: ProcessOp["kind"];
  tool: string;
  target: string;
  /** začátek operace (podmínka); null = podmínka do konce studie nenastala */
  start: ProcAt | null;
  /** první záběr, prostřižení (jen střih) */
  contact: ProcAt | null;
  through: ProcAt | null;
  /** po krocích (záběr, hloubka, prostřiženo, stav obrobku) – délka = kroky studie */
  steps: ProcStep[];
  /** stavy obrobku (0 = plný): odebraný objem, objem zbytku, odpad */
  states: ProcRes["states"];
  /** poloha nástroje v souřadnicích obrobku po krocích (posun; pravidlo polohy odpadu) */
  toolAt: (Vec3 | null)[];
  dir: Vec3 | null;
  thickness: number | null;
  volume0: number;
  /** konečná hloubka zásahu, odebraný objem, odpad */
  depth: number;
  removed: number;
  scrap: { volume: number; center: Vec3 }[];
  scrapRule: NonNullable<ProcessOp["scrap"]>;
  approx?: { contact: number; computed: number };
  error?: string;
  /**
   * stav obrobku po VŠECH operacích na něm (jen poslední operace obrobku s víc operacemi): v kroku k index do `states`;
   * společný objem operací (druhý střih do téže díry) jen jednou. `missing` = jádro kombinaci nevrátilo (stav jen jako dolní mez).
   */
  combined?: { steps: number[]; states: { removed: number; volume: number; scrap: { volume: number; center: Vec3 }[] }[]; error?: string } | { missing: true };
  ms: number;
};
export type ProcessResult = { ops: ProcOpResult[]; ms: number; /** jádro procesní operaci nemá (zkušební náhrada) / nelze spočítat */ unavailable?: string };
/** rozšíření výsledku studie (motion.ts `MotionResult` se nemění – pole přidává tento modul, jako vůle C2) */
export type ProcessExt = { process?: ProcessResult };
export const processOf = (res: MotionResult | null | undefined): ProcessResult | null => ((res ?? {}) as ProcessExt).process ?? null;
/** krok s hloubkou zásahu pro anotaci (motion-views.ts `cutDepthAt`, balík V1) */
export type CutRow = { label: string; depth: number };
export type MotionStepCut = MotionStep & { cut?: CutRow[] };

/* ───────────────────────── geometrie bez jádra ───────────────────────── */

/** výchozí pravidlo odpadu a parametry pádu (jednoduché pravidlo zobrazení, ne fyzika) */
export const SCRAP_FALL_MAX = 150;
export const GRAVITY_MM_S2 = 9810;

/**
 * Poloha nástroje v souřadnicích obrobku: 12 čísel [R po řádcích, t] = (A⁻¹·B), zaokrouhleno na mřížku 1e-7 jako `relOf`
 * v jádře (stejné matice → stejné průniky jako kontrola kolizí; mezipaměť jádra se trefí).
 */
export function relMatrix(target: Placement, tool: Placement): number[] {
  const A = rotMatrix(target.rotation);
  const B = rotMatrix(tool.rotation);
  const R = new Array<number>(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[i * 3 + j] = A[i] * B[j] + A[3 + i] * B[3 + j] + A[6 + i] * B[6 + j];
  const d = [tool.position[0] - target.position[0], tool.position[1] - target.position[1], tool.position[2] - target.position[2]];
  const t = [0, 1, 2].map((i) => A[i] * d[0] + A[3 + i] * d[1] + A[6 + i] * d[2]);
  return [...R, ...t].map((v) => Math.round(v * 1e7) / 1e7 || 0);
}

/** umístění komponenty v kroku (krok nemusí nést všechny – pak z dokumentu) */
const placeAt = (doc: CadDoc, s: Pick<MotionStep, "place">, id: string): Placement | null => s.place[id] ?? doc.components?.find((c) => c.id === id)?.placement ?? null;

/**
 * Začátek operace v krocích studie: bez podmínky krok 0 (pak rozhoduje dotyk); čas → první krok s t ≥ T; motor → první krok,
 * kde hodnota motoru splní podmínku; vazba → hodnota motoru, který ji pohání (jinak nelze – chyba s nápovědou); fáze → krok
 * začátku fáze. Okamžik mezi kroky se odhadne lineárně (jako začátek fáze, motion-phases.ts `crossTime`). null = nenastal.
 */
export function opStart(op: Pick<ProcessOp, "at">, res: Pick<MotionResult, "steps" | "phases">, study: Pick<MotionStudy, "motors">): ProcAt | null {
  const S = res.steps;
  if (!S.length) return null;
  const c = op.at;
  if (!c) return { step: S[0].i, t: S[0].t };
  if ("phase" in c) {
    const ph = res.phases?.find((p) => p.id === c.phase);
    if (!ph?.reached || ph.step === undefined) return null;
    return { step: ph.step, t: ph.t ?? S.find((s) => s.i === ph.step)?.t ?? 0 };
  }
  const val = condValueAt(c, study);
  for (let k = 0; k < S.length; k++) {
    const v = val(S[k]);
    if (v === null) continue;
    const met = "t" in c ? v >= c.t - 1e-9 : c.op === "<=" ? v <= c.value + 1e-9 : v >= c.value - 1e-9;
    if (!met) continue;
    let t = S[k].t;
    if (k > 0 && !("t" in c)) {
      const v0 = val(S[k - 1]);
      if (v0 !== null && Math.abs(v - v0) > 1e-12) t = S[k - 1].t + Math.min(1, Math.max(0, (c.value - v0) / (v - v0))) * (S[k].t - S[k - 1].t);
    } else if ("t" in c) t = Math.max(c.t, S[0].t);
    return { step: S[k].i, t };
  }
  return null;
}
/** hodnota podmínky v kroku: čas, hodnota motoru, hodnota vazby přes motor, který ji pohání */
function condValueAt(c: MotionCond, study: Pick<MotionStudy, "motors">): (s: Pick<MotionStep, "t" | "motors">) => number | null {
  if ("t" in c) return (s) => s.t;
  if ("motor" in c) {
    const i = study.motors.findIndex((m) => m.id === c.motor);
    return (s) => (i >= 0 && s.motors[i] !== undefined ? s.motors[i] : null);
  }
  const i = study.motors.findIndex((m) => m.mate === c.mate);
  return (s) => (i >= 0 && s.motors[i] !== undefined ? s.motors[i] : null);
}
/** podmínka vazby bez motoru na ní: procesní vrstva hodnotu vazby po krocích nemá – chyba s nápovědou (null = v pořádku) */
export function condProblem(op: Pick<ProcessOp, "at">, study: Pick<MotionStudy, "motors" | "phases">): string | null {
  const c = op.at;
  if (!c || "t" in c) return null;
  if ("phase" in c) return study.phases?.some((p) => p.id === c.phase) ? null : tr("fáze operace ve studii není");
  if ("motor" in c) return study.motors.some((m) => m.id === c.motor) ? null : tr("motor podmínky ve studii není");
  return study.motors.some((m) => m.mate === c.mate) ? null : tr("podmínka vazby: vazbu nepohání žádný motor – zadejte motor, čas nebo fázi (fáze \"…\")");
}

/* ───────────────────────── stav výrobku (čistý automat) ───────────────────────── */

/** stav operace v kroku: idle = nic odebráno (plný), engaged = nástroj v záběru, cut = prostřiženo (odpad oddělen), imprinted = otisk hotov, notched = nástřih hotov */
export type OpPhase = "idle" | "engaged" | "cut" | "imprinted" | "notched";
export function opPhase(kind: ProcessOp["kind"], s: ProcStep | undefined): OpPhase {
  if (!s || s.state === 0) return "idle";
  if (kind === "cut" && s.through) return "cut";
  if (s.contact) return "engaged";
  return kind === "imprint" ? "imprinted" : "notched";
}
/** stav výrobku: složení stavů operací téhož obrobku */
/**
 * Stav výrobku v kroku. `exact: false` = víc operací na obrobku bez kombinovaného stavu z jádra: `removed` je jen dolní mez
 * (největší z operací) – součet by společný objem počítal dvakrát (dřív druhý střih do téže díry = 628 mm³ místo 314 mm³).
 */
export type ProductState = { target: string; phase: "full" | "engaged" | "pierced" | "imprinted" | "notched" | "pierced+imprinted"; scrap: number; removed: number; depth: number; ops: number; exact?: false };
/** kombinovaný stav obrobku `target` (operace, která ho nese) */
const combinedFor = (ops: readonly ProcOpResult[]) => {
  for (let i = ops.length - 1; i >= 0; i--) {
    const c = ops[i].combined;
    if (c && !("missing" in c)) return c;
  }
  return null;
};
export function productStates(proc: ProcessResult | null, k: number): ProductState[] {
  if (!proc) return [];
  const by = new Map<string, ProcOpResult[]>();
  for (const o of proc.ops) by.set(o.target, [...(by.get(o.target) ?? []), o]);
  const out: ProductState[] = [];
  for (const [target, ops] of by) {
    const ph = ops.map((o) => opPhase(o.kind, o.steps[k]));
    const stOf = (o: ProcOpResult) => o.states[o.steps[k]?.state ?? 0];
    const depth = Math.max(0, ...ops.map((o) => o.steps[k]?.depth ?? 0));
    const cut = ph.includes("cut");
    const imp = ph.includes("imprinted");
    const phase: ProductState["phase"] = ph.includes("engaged") ? "engaged" : cut && imp ? "pierced+imprinted" : cut ? "pierced" : imp ? "imprinted" : ph.includes("notched") ? "notched" : "full";
    const comb = ops.length > 1 ? combinedFor(ops) : null;
    if (ops.length === 1) {
      const o = ops[0];
      out.push({ target, phase, scrap: ph[0] === "cut" ? Math.max(1, stOf(o)?.scrap.length ?? 0) : 0, removed: stOf(o)?.removed ?? 0, depth, ops: 1 });
    } else if (comb) {
      const st = comb.states[comb.steps[k] ?? 0] ?? comb.states[0];
      out.push({ target, phase, scrap: cut ? Math.max(1, st.scrap.length) : 0, removed: st.removed, depth, ops: ops.length, ...(comb.error ? { exact: false as const } : {}) });
    } else {
      // bez kombinace z jádra: jen dolní mez (největší operace), odpad nejméně 1 – nikdy součet
      out.push({ target, phase, scrap: cut ? 1 : 0, removed: Math.max(0, ...ops.map((o) => stOf(o)?.removed ?? 0)), depth, ops: ops.length, exact: false });
    }
  }
  return out;
}
export function phaseWord(p: ProductState["phase"]): string {
  switch (p) {
    case "full":
      return tr("plný");
    case "engaged":
      return tr("v záběru");
    case "pierced":
      return tr("děrovaný");
    case "imprinted":
      return tr("označený");
    case "notched":
      return tr("naříznutý");
    default:
      return tr("děrovaný + označený");
  }
}

/* ───────────────────────── odpad: poloha podle jednoduchého pravidla ───────────────────────── */

/**
 * Posun odpadu v souřadnicích obrobku v kroku `k` (odpad se ukazuje od prostřižení na místě, kde byl materiál):
 *  - `fall` (výchozí): jede s nástrojem, dokud nástroj postupuje ve směru střihu; jakmile se zastaví nebo vrací, odpad padá dál
 *    ve směru střihu ½·g·t² (nejvýš 150 mm) – jednoduché pravidlo zobrazení, ne fyzika;
 *  - `tool`: drží na nástroji (i při zpětném zdvihu); `stay`: zůstane, kde se oddělil.
 * null = odpad v kroku není (neprostřiženo).
 */
export function scrapOffset(o: Pick<ProcOpResult, "through" | "toolAt" | "dir" | "scrapRule">, steps: readonly Pick<MotionStep, "t">[], k: number): Vec3 | null {
  if (!o.through || k < o.through.step) return null;
  const k0 = o.through.step;
  const p0 = o.toolAt[k0];
  if (!p0 || o.scrapRule === "stay") return [0, 0, 0];
  const d = o.dir ?? [0, 0, -1];
  if (o.scrapRule === "tool") {
    const p = o.toolAt[k] ?? p0;
    return [p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]];
  }
  let adv = 0;
  let rel: number | null = null;
  for (let j = k0 + 1; j <= k; j++) {
    const p = o.toolAt[j];
    if (!p) continue;
    const a = (p[0] - p0[0]) * d[0] + (p[1] - p0[1]) * d[1] + (p[2] - p0[2]) * d[2];
    if (a > adv + 1e-9) adv = a;
    else {
      rel = steps[j - 1]?.t ?? steps[j]?.t ?? 0;
      break;
    }
  }
  const fall = rel === null ? 0 : Math.min(SCRAP_FALL_MAX, 0.5 * GRAVITY_MM_S2 * Math.max(0, (steps[k]?.t ?? 0) - rel) ** 2);
  const s = adv + fall;
  return [d[0] * s, d[1] * s, d[2] * s];
}
/** světové umístění odpadu (síť je v souřadnicích obrobku): poloha obrobku v kroku + posun v jeho souřadnicích */
export function scrapPlacement(target: Placement, off: Vec3): Placement {
  const A = rotMatrix(target.rotation);
  const w: Vec3 = [A[0] * off[0] + A[1] * off[1] + A[2] * off[2], A[3] * off[0] + A[4] * off[1] + A[5] * off[2], A[6] * off[0] + A[7] * off[1] + A[8] * off[2]];
  return { position: [target.position[0] + w[0], target.position[1] + w[1], target.position[2] + w[2]], rotation: target.rotation };
}

/* ───────────────────────── požadavek do jádra a výpočet ───────────────────────── */

/** požadavek jádra pro operaci (stejný v CLI i v prohlížeči – sítě si prohlížeč vyžádá se stejným klíčem) */
export function processRequest(doc: CadDoc, res: Pick<MotionResult, "steps">, op: ProcessOp, start: ProcAt | null, mesh?: number[]): ProcReq {
  const comp = (id: string) => doc.components?.find((c) => c.id === id);
  const T = comp(op.target);
  const P = comp(op.tool);
  if (!T || !P) throw new Error(tr("procesní operace: komponenta „{0}“ v sestavě není", !T ? op.target : op.tool));
  if (T.source.kind === "asm") throw new Error(tr("procesní operace: obrobek „{0}“ musí být díl, ne podsestava", T.name));
  if (P.source.kind === "asm") throw new Error(tr("procesní operace: nástroj „{0}“ musí být díl, ne podsestava", P.name));
  const rels = res.steps.map((s) => {
    if (!start || s.i < start.step) return null;
    const a = placeAt(doc, s, op.target);
    const b = placeAt(doc, s, op.tool);
    return a && b ? relMatrix(a, b) : null;
  });
  return {
    target: { key: sourceKey(T.source), source: T.source },
    tool: { key: sourceKey(P.source), source: P.source },
    kind: op.kind,
    ...(op.depth !== undefined ? { depth: op.depth } : {}),
    rels,
    ...(mesh?.length ? { mesh } : {}),
  };
}

/**
 * Požadavek operace `op` s ostatními operacemi na TÉMŽE obrobku (jen poslední operace obrobku – její odpověď nese kombinovaný stav
 * obrobku, `ProcRes.combined`); `startOf` = začátek operace. Stejný v CLI i v prohlížeči (sítě kombinovaného stavu).
 */
export function processRequestWith(doc: CadDoc, res: Pick<MotionResult, "steps">, op: ProcessOp, startOf: (op: ProcessOp) => ProcAt | null, mesh?: number[], meshCombined?: number[]): ProcReq {
  const req = processRequest(doc, res, op, startOf(op), mesh);
  const all = doc.motion?.process ?? [];
  const same = all.filter((x) => x.target === op.target);
  if (same.length < 2 || same[same.length - 1].id !== op.id) return req;
  const others: NonNullable<ProcReq["others"]> = [];
  for (const x of same.slice(0, -1)) {
    try {
      const q = processRequest(doc, res, x, startOf(x));
      others.push({ tool: q.tool, kind: q.kind, ...(q.depth !== undefined ? { depth: q.depth } : {}), rels: q.rels });
    } catch {
      /* operace s chybou požadavku (podsestava…) – hlásí ji vlastní řádek; do kombinace nepatří */
    }
  }
  return others.length ? { ...req, others, ...(meshCombined?.length ? { meshCombined } : {}) } : req;
}

export type ProcessEnv = { process?: (req: ProcReq) => Promise<ProcRes> };

/**
 * Procesní vrstva nad hotovým výsledkem studie (volá `motionRun` po výpočtu poloh – výsledek se uloží s ním): pro každou operaci
 * okno, jádro, výsledek; pracovní kontakt nástroj × obrobek v okně = třída `work`; úroveň + geometrická aproximace; hloubka
 * zásahu v kroku pro anotaci; události na časové ose. Bez operací vrací výsledek beze změny.
 */
export async function processRun<R extends MotionResult>(doc: CadDoc, res: R, env: ProcessEnv): Promise<R> {
  const study = doc.motion;
  const ops = study?.process ?? [];
  if (!study || !ops.length || !res.steps.length) return res;
  const t0 = Date.now();
  const out: ProcOpResult[] = [];
  let unavailable: string | undefined;
  const starts = new Map(ops.map((op) => [op.id, opStart(op, res, study)] as const));
  for (const op of ops) {
    const start = starts.get(op.id) ?? null;
    const base = { id: op.id, kind: op.kind, tool: op.tool, target: op.target, start, scrapRule: op.scrap ?? "fall" } as const;
    const empty: ProcOpResult = { ...base, contact: null, through: null, steps: res.steps.map(() => ({ contact: false, depth: 0, through: false, state: 0 })), states: [{ removed: 0, volume: 0, scrap: [] }], toolAt: res.steps.map(() => null), dir: null, thickness: null, volume0: 0, depth: 0, removed: 0, scrap: [], ms: 0 };
    if (!env.process) {
      unavailable = tr("jádro bez procesní operace");
      out.push({ ...empty, error: unavailable });
      continue;
    }
    let req: ProcReq;
    try {
      req = processRequestWith(doc, res, op, (x) => starts.get(x.id) ?? null);
    } catch (e) {
      out.push({ ...empty, error: (e as Error).message });
      continue;
    }
    let k: ProcRes;
    try {
      k = await env.process(req);
    } catch (e) {
      out.push({ ...empty, error: (e as Error)?.message ?? String(e) });
      continue;
    }
    const at = (pred: (s: ProcStep) => boolean): ProcAt | null => {
      const i = k.steps.findIndex(pred);
      return i >= 0 ? { step: res.steps[i].i, t: res.steps[i].t } : null;
    };
    const last = k.steps[k.steps.length - 1];
    const fin = k.states[last?.state ?? 0];
    out.push({
      ...base,
      contact: at((s) => s.contact),
      through: op.kind === "cut" ? at((s) => s.through) : null,
      steps: k.steps,
      states: k.states,
      toolAt: req.rels.map((m) => (m ? ([m[9], m[10], m[11]] as Vec3) : null)),
      dir: k.dir,
      thickness: k.thickness,
      volume0: k.volume0,
      depth: last?.depth ?? 0,
      removed: fin?.removed ?? 0,
      scrap: fin?.scrap ?? [],
      ...(k.approx ? { approx: k.approx } : {}),
      ...(k.error ? { error: k.error } : {}),
      // víc operací na obrobku: kombinovaný stav z jádra (bez něj jen dolní mez – productStates)
      ...(req.others?.length ? { combined: k.combined ? { steps: k.combined.steps, states: k.combined.states.map((x) => ({ removed: x.removed, volume: x.volume, scrap: x.scrap })), ...(k.combined.error ? { error: k.combined.error } : {}) } : { missing: true as const } } : {}),
      ms: k.ms,
    });
  }
  const proc: ProcessResult = { ops: out, ms: Date.now() - t0, ...(unavailable ? { unavailable } : {}) };
  // hloubka zásahu v kroku (anotace přehrávání a videa – adaptér V1 `cutDepthAt`)
  const steps = res.steps.map((s, i) => {
    const cut: CutRow[] = out.flatMap((o) => (o.steps[i]?.state ? [{ label: opShort(o, doc), depth: o.steps[i].depth }] : []));
    return cut.length ? ({ ...s, cut } as MotionStepCut) : s;
  });
  // pracovní kontakt operace = třída work (jeden model C1: pravidlo „work“, zde odvozené z operace a jejího okna)
  const work = workClassifier(doc, out);
  const reclass = (k: number, list: MotionCollision[] | undefined) => (list ? list.map((c) => work(k, c)) : list);
  const steps2 = steps.map((s) => (s.clashes?.length ? { ...s, clashes: reclass(s.i, s.clashes)! } : s));
  const ext = res as R & { between?: { k0: number; k1: number; clashes: MotionCollision[] }[] };
  const between = ext.between?.map((h) => ({ ...h, clashes: reclass(h.k1, h.clashes)! }));
  let collision: MotionResult["collision"] = null;
  for (const s of steps2) {
    const hit = s.clashes?.find((c) => isFault(c.cls));
    if (hit) {
      collision = { ...hit, step: s.i, t: s.t };
      break;
    }
  }
  const events: MotionEvent[] = [...(res.events ?? [])];
  for (const o of out) {
    if (o.contact) events.push({ kind: "process", id: o.id, what: "contact", step: o.contact.step, t: o.contact.t });
    if (o.through) events.push({ kind: "process", id: o.id, what: "through", step: o.through.step, t: o.through.t });
  }
  events.sort((a, b) => a.t - b.t);
  return {
    ...res,
    steps: steps2,
    ...(between ? { between } : {}),
    collision: res.collisionsChecked ? collision : res.collision,
    level: { ...(res.level ?? { level: "kinematic" }), geo: true },
    events,
    process: proc,
  };
}

/** dvojice nástroj × obrobek v okně operace → třída `work` (místo skutečné / nevyhodnotitelné / dotyku) */
function workClassifier(doc: CadDoc, ops: ProcOpResult[]): (k: number, c: MotionCollision) => MotionCollision {
  return (k, c) => {
    if (!(c.cls === undefined || c.cls === "real" || c.cls === "undetermined" || c.cls === "touch")) return c;
    const A = c.aPath?.[0] ?? c.a;
    const B = c.bPath?.[0] ?? c.b;
    const o = ops.find((x) => x.start && k >= x.start.step && ((x.tool === A && x.target === B) || (x.tool === B && x.target === A)));
    if (!o) return c;
    return { ...c, cls: "work", why: "work-rule", rule: tr("proces {0}", opShort(o, doc)) } as MotionCollision;
  };
}

/* ───────────────────────── texty ───────────────────────── */

const cname = (doc: CadDoc, id: string) => doc.components?.find((c) => c.id === id)?.name ?? id;
export const kindWord = (k: ProcessOp["kind"]) => (k === "cut" ? tr("střih") : tr("otisk"));
/** „střih 1“ */
export function opShort(o: Pick<ProcOpResult, "id" | "kind">, doc: CadDoc): string {
  const i = (doc.motion?.process ?? []).findIndex((x) => x.id === o.id);
  const op = doc.motion?.process?.[i];
  return op?.name ?? `${kindWord(o.kind)} ${i + 1}`;
}
/** popis začátku operace */
export function startText(op: ProcessOp, doc: CadDoc): string {
  const c = op.at;
  if (!c) return tr("od dotyku nástroje");
  if ("phase" in c) return tr("se začátkem fáze „{0}“", doc.motion?.phases?.find((p) => p.id === c.phase)?.name ?? c.phase);
  return tr("od {0}", condText(c, doc, doc.motion ?? { motors: [] }, 1));
}
const scrapWord = (s: ProcessOp["scrap"]) => (s === "tool" ? tr("drží na nástroji") : s === "stay" ? tr("zůstane na místě") : tr("s nástrojem, pak padá"));
/** definice operace: „1. střih „Razník“ → „Plech“ · do prostřižení · od dotyku nástroje · odpad: s nástrojem, pak padá“ */
export function opText(op: ProcessOp, i: number, doc: CadDoc): string {
  const parts = [`${i + 1}. ${op.name ? `${op.name} (${kindWord(op.kind)})` : kindWord(op.kind)} „${cname(doc, op.tool)}“ → „${cname(doc, op.target)}“`];
  parts.push(op.depth !== undefined ? tr("hloubka {0} mm", nf(op.depth, 4)) : op.kind === "cut" ? tr("do prostřižení") : tr("hloubka podle nástroje"));
  parts.push(startText(op, doc));
  if (op.kind === "cut") parts.push(tr("odpad: {0}", scrapWord(op.scrap)));
  return parts.join(" · ");
}

/** věta úrovně procesní vrstvy (protokol, panel, anotace) – booleovské odebrání NENÍ simulace materiálu */
export const processLevelSentence = (): string =>
  tr("Procesní vrstva: geometrická aproximace – booleovské odebrání objemu nástroje z obrobku; není to simulace materiálu (žádné síly, otřep, odpružení ani tok materiálu)");

const at = (a: ProcAt) => tr("kroku {0} (t = {1} s)", a.step, nf(a.t, 3));
/** souhrn procesní vrstvy pro protokol studie (řádky; varování jdou zvlášť jako kódy – `processCodes`) */
export function processLines(res: MotionResult, doc: CadDoc): string[] {
  const proc = processOf(res);
  if (!proc) return [];
  const out = [processLevelSentence()];
  for (const o of proc.ops) {
    const head = `${opShort(o, doc)} „${cname(doc, o.tool)}“ → „${cname(doc, o.target)}“`;
    if (o.error && !o.contact) {
      out.push(` ${head}: ${tr("nespočítáno – {0}", o.error)}`);
      continue;
    }
    if (!o.start) {
      out.push(` ${head}: ${tr("začátek operace nenastal – obrobek beze změny")}`);
      continue;
    }
    if (!o.contact) {
      out.push(` ${head}: ${tr("bez záběru – nástroj obrobek nezasáhl, obrobek beze změny")}`);
      continue;
    }
    const parts = [tr("záběr od {0}", at(o.contact))];
    if (o.kind === "cut") parts.push(o.through ? tr("prostřiženo v {0}", at(o.through)) : tr("neprostřiženo"));
    parts.push(tr("odebráno {0} mm³", nf(o.removed, 3)));
    parts.push(tr("hloubka {0} mm", nf(o.depth, 3)));
    if (o.through) parts.push(tr("odpad {0} ks, {1} mm³ ({2})", Math.max(1, o.scrap.length), nf(o.scrap.reduce((s, x) => s + x.volume, 0) || o.removed, 3), scrapWord(o.scrapRule)));
    out.push(` ${head}: ${parts.join(" · ")}`);
  }
  // víc operací na témže obrobku: celkový odebraný objem = sjednocení (společný objem jednou), součet operací jen pro srovnání
  const last = res.steps.length - 1;
  for (const p of productStates(proc, last)) {
    if (p.ops < 2) continue;
    const sum = proc.ops.filter((o) => o.target === p.target).reduce((s, o) => s + o.removed, 0);
    out.push(
      p.exact === false
        ? tr(" „{0}“: {1} operací, odebráno nejméně {2} mm³ – sjednocení operací nespočítáno (součet {3} mm³ by společný objem počítal dvakrát)", cname(doc, p.target), p.ops, nf(p.removed, 3), nf(sum, 3))
        : tr(" „{0}“: {1} operací, celkem odebráno {2} mm³ (sjednocení – společný objem operací jen jednou; součet operací {3} mm³)", cname(doc, p.target), p.ops, nf(p.removed, 3), nf(sum, 3)),
    );
  }
  out.push(...productTimeline(proc, res, doc));
  return out;
}
/** průběh stavu výrobku po krocích: „Stav výrobku „Plech“: plný (kroky 0–4) → v záběru (5) → děrovaný (6–36)“ */
export function productTimeline(proc: ProcessResult, res: Pick<MotionResult, "steps">, doc: CadDoc): string[] {
  const targets = [...new Set(proc.ops.map((o) => o.target))];
  return targets.map((target) => {
    const runs: { p: ProductState["phase"]; a: number; b: number }[] = [];
    res.steps.forEach((s, k) => {
      const p = productStates(proc, k).find((x) => x.target === target)?.phase ?? "full";
      const last = runs[runs.length - 1];
      if (last && last.p === p) last.b = s.i;
      else runs.push({ p, a: s.i, b: s.i });
    });
    const span = (r: { a: number; b: number }) => (r.a === r.b ? tr("krok {0}", r.a) : tr("kroky {0}", `${r.a}–${r.b}`));
    return tr("Stav výrobku „{0}“: {1}", cname(doc, target), runs.map((r) => `${phaseWord(r.p)} (${span(r)})`).join(" → "));
  });
}
/** stav výrobku v kroku (`pohyb krok N`, panel, `stav`): „„Plech“: děrovaný · odpad 1 oddělen · odebráno 314,159 mm³“ */
export function productLines(res: MotionResult, doc: CadDoc, k: number): string[] {
  const proc = processOf(res);
  if (!proc) return [];
  return productStates(proc, k).map((p) => {
    const extra = [p.removed > 0 ? (p.exact === false ? tr("odebráno nejméně {0} mm³", nf(p.removed, 3)) : tr("odebráno {0} mm³", nf(p.removed, 3))) : "", p.depth > 0 ? tr("hloubka {0} mm", nf(p.depth, 3)) : "", p.scrap ? tr("odpad {0} oddělen", p.scrap) : ""].filter(Boolean);
    return tr(" stav výrobku „{0}“: {1}{2}", cname(doc, p.target), phaseWord(p.phase), extra.length ? ` · ${extra.join(" · ")}` : "");
  });
}

export type ProcessCode = { code: string; args: string[]; text: string };
/** nálezy procesní vrstvy (záznamy s kódem): bez záběru ⚠, neprostřiženo ℹ, podvzorkováno ℹ, chyba ⚠ */
export function processCodes(res: MotionResult, doc: CadDoc): ProcessCode[] {
  const proc = processOf(res);
  if (!proc) return [];
  const out: ProcessCode[] = [];
  if (proc.unavailable) out.push({ code: "motion.process-failed", args: ["-", proc.unavailable], text: tr("procesní operace {0}: booleovská operace selhala ({1}) – výsledek jen do posledního platného stavu", "-", proc.unavailable) });
  for (const o of proc.ops) {
    const name = opShort(o, doc);
    const T = cname(doc, o.target);
    const P = cname(doc, o.tool);
    if (o.error && o.error !== proc.unavailable) out.push({ code: "motion.process-failed", args: [name, o.error], text: tr("procesní operace {0}: booleovská operace selhala ({1}) – výsledek jen do posledního platného stavu", name, o.error) });
    else if (!o.contact && !o.error) out.push({ code: "motion.process-miss", args: [name, P, T], text: tr("procesní operace {0}: nástroj „{1}“ obrobek „{2}“ v okně operace nezasáhl – obrobek beze změny", name, P, T) });
    else if (o.kind === "cut" && o.contact && !o.through) out.push({ code: "motion.process-partial", args: [name, T, nf(o.depth, 3)], text: tr("procesní operace {0}: obrobek „{1}“ neprostřižen – hloubka {2} mm", name, T, nf(o.depth, 3)) });
    const cmb = o.combined;
    if (cmb && "missing" in cmb) out.push({ code: "motion.process-failed", args: [name, tr("jádro nevrátilo stav obrobku po všech operacích")], text: tr("procesní operace {0}: booleovská operace selhala ({1}) – výsledek jen do posledního platného stavu", name, tr("jádro nevrátilo stav obrobku po všech operacích")) });
    else if (cmb?.error) out.push({ code: "motion.process-failed", args: [name, cmb.error], text: tr("procesní operace {0}: booleovská operace selhala ({1}) – výsledek jen do posledního platného stavu", name, cmb.error) });
    if (o.approx) out.push({ code: "motion.process-approx", args: [name, String(o.approx.computed), String(o.approx.contact)], text: tr("procesní operace {0}: booleovsky spočítáno {1} z {2} kroků se záběrem (strop výkonu) – mezikroky převzaty", name, o.approx.computed, o.approx.contact) });
  }
  return out;
}

/** počet ⚠ procesní vrstvy (verdikt `stav` – motion-cache.ts `motionVerdict`) */
export const processWarnCount = (res: MotionResult, doc: CadDoc): number => processCodes(res, doc).filter((c) => c.code === "motion.process-miss" || c.code === "motion.process-failed").length;
/** stav výrobku na konci studie pro řádek „Pohyb:“ v `stav`: „procesní vrstva (geometrická aproximace): „Plech“ děrovaný, odebráno 314,159 mm³, odpad 1“ */
export function processStatusText(res: MotionResult, doc: CadDoc): string {
  const proc = processOf(res);
  if (!proc) return "";
  const last = res.steps.length - 1;
  const parts = productStates(proc, last).map((p) => `„${cname(doc, p.target)}“ ${phaseWord(p.phase)}${p.removed > 0 ? (p.exact === false ? tr(", odebráno nejméně {0} mm³", nf(p.removed, 3)) : tr(", odebráno {0} mm³", nf(p.removed, 3))) : ""}${p.scrap ? tr(", odpad {0}", p.scrap) : ""}`);
  return tr("procesní vrstva (geometrická aproximace, ne simulace materiálu): na konci {0}", parts.join("; "));
}

/** strojová pole procesní vrstvy na KONEC řádku `= … motion …`: `proc=<n> removed=<mm³> scrap=<ks> through=<krok>` */
export function processKv(res: MotionResult): string[] {
  const proc = processOf(res);
  if (!proc) return [];
  const n = (v: number) => String(Math.round(v * 1000) / 1000);
  // po obrobcích (víc operací na obrobku = sjednocení, ne součet – dřív druhý střih do téže díry removed=628.319 místo 314.159)
  const fin = productStates(proc, Math.max(0, res.steps.length - 1));
  const removed = fin.reduce((s, p) => s + p.removed, 0);
  const scrap = fin.reduce((s, p) => s + p.scrap, 0);
  const inexact = fin.some((p) => p.exact === false);
  const thr = proc.ops.find((o) => o.through)?.through;
  return [`proc=${proc.ops.length}`, `removed=${n(removed)}${inexact ? "+" : ""}`, `scrap=${scrap}`, ...(thr ? [`through=${thr.step}`] : [])];
}

/**
 * Sloupce CSV studie pro procesní vrstvu (na konci řádku, za vůlí): za každý obrobek stav výrobku a odebraný objem v kroku
 * (víc operací na obrobku = sjednocení; dolní mez s „+“). Dřív CSV procesní vrstvu nemělo vůbec.
 */
export function processCsvHead(res: MotionResult, doc: CadDoc): string[] {
  const proc = processOf(res);
  if (!proc) return [];
  return [...new Set(proc.ops.map((o) => o.target))].flatMap((t) => [tr("Stav výrobku {0}", cname(doc, t)), tr("Odebráno {0} [mm³]", cname(doc, t))]);
}
export function processCsvCells(res: MotionResult, k: number): string[] {
  const proc = processOf(res);
  if (!proc) return [];
  const st = productStates(proc, k);
  return [...new Set(proc.ops.map((o) => o.target))].flatMap((t) => {
    const p = st.find((x) => x.target === t);
    if (!p) return ["", ""];
    return [p.phase, `${String(Math.round(p.removed * 1000) / 1000).replace(".", ",")}${p.exact === false ? "+" : ""}`];
  });
}

/** API `window.mncad.motion().process` – operace a stav výrobku po krocích */
export function processApi(res: MotionResult, doc: CadDoc) {
  const proc = processOf(res);
  if (!proc) return null;
  return {
    level: "geometric-approximation",
    ops: proc.ops.map((o) => ({ id: o.id, kind: o.kind, tool: cname(doc, o.tool), target: cname(doc, o.target), start: o.start, contact: o.contact, through: o.through, removed: o.removed, depth: o.depth, scrap: o.scrap.map((s) => s.volume), ...(o.error ? { error: o.error } : {}), ...(o.approx ? { approx: o.approx } : {}) })),
    steps: res.steps.map((s, k) => ({ step: s.i, states: productStates(proc, k).map((p) => ({ target: cname(doc, p.target), state: p.phase, removed: p.removed, depth: p.depth, scrap: p.scrap, ...(p.exact === false ? { exact: false } : {}) })) })),
  };
}
