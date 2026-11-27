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
import { PROC_MAX_SUB, type ProcReq, type ProcRes, type ProcStep } from "./process-types";
import { motorKeys, motorStartTime, profileAt, type MotorProfile } from "./motor-model";
import type { CadDoc, MotionCond, MotionStudy, Placement, ProcessOp, Vec3 } from "./types";

/* ───────────────────────── výsledek ───────────────────────── */

/** krok a čas události operace; `between` = událost v mezipoloze úseku (k0 → k1), `step` je pak k1 (kolo 6) */
export type ProcAt = { step: number; t: number; between?: [number, number]; est?: true };
/**
 * mezipoloha procesní vrstvy (kolo 6): v úseku před krokem `k` (čas `t`) umístění komponent z řešiče studie – razník, který mezi
 * dvěma kroky projde plechem, se tak spočítá jako střih (dřív „bez záběru – nezasáhl“ vedle ℹ clash.work 314 mm³ mezi kroky)
 */
export type SubPose = { k: number; t: number; place: Record<string, Placement> };
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
  /**
   * první krok, před kterým mohl nástroj obrobek zasáhnout jen MEZI polohami a mezipolohy nešly spočítat (bez řešiče – dynamika,
   * řešič mezipolohu nenašel): od něj je výsledek procesu nezjištěn (⚠ motion.process-between, stav „nezjištěn“, nikdy „plný“)
   */
  unresolved?: number;
  /**
   * proč nezjištěn (kolo 6 oprava): `pose` = řešič mezipolohu nedal (výchozí), `cap` = úsek by potřeboval víc než PROC_MAX_SUB
   * mezipoloh (tenký nástroj, dlouhý krok – 64 poloh by nástroj obrobkem stále „proskočil“), `clash` = spojitá kontrola kolizí
   * našla průnik nástroj × obrobek mezi kroky, procesní vrstva v polohách žádný záběr; `start` = podmínka začátku mohla nastat mezi
   * kroky (průběh motoru mezi kroky neznámý – profil nesedí na kroky, kolo 7 oprava)
   */
  unresolvedWhy?: "pose" | "cap" | "clash" | "start";
  ms: number;
};
export type ProcessResult = {
  ops: ProcOpResult[];
  ms: number;
  /** jádro procesní operaci nemá (zkušební náhrada) / nelze spočítat */
  unavailable?: string;
  /** mezipolohy, které procesní vrstva doplnila mezi kroky (požadavek jádra je z kroků + mezipoloh – stejný v CLI i prohlížeči) */
  sub?: SubPose[];
};
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
 * Začátek operace: bez podmínky krok 0 (pak rozhoduje dotyk); čas → první krok s t ≥ T; motor → první okamžik, kdy hodnota
 * motoru splní podmínku; vazba → hodnota motoru, který ji pohání (jinak nelze – chyba s nápovědou); fáze → krok začátku fáze.
 * `step` = krok, který úsek se začátkem uzavírá; `t` = okamžik začátku. null = nenastal.
 *
 * Kolo 7 oprava (oponent): hodnota motoru MEZI kroky se počítá z profilu motoru (cad/motor-model.ts `motorKeys` – tentýž profil,
 * ze kterého řešič počítá kroky: okno, začátek fáze z výsledku, tam a zpět s kosinovým průběhem), ne z hodnot v krocích. Dřív se
 * podmínka zkoušela jen v krocích: „tam a zpět“ s dolní úvratí mezi kroky (`při motor 1 <= -45`) „nenastal“ – obrobek „plný“ a
 * ⚠ process-miss, ač razník plechem prošel – a okamžik začátku se odhadoval lineárně (kotva mezipolohy mimo hodnotu podmínky).
 * Profil se napřed porovná s hodnotami motoru ve všech krocích; nesedí-li (dynamika se zastaveným motorem …), průběh mezi kroky
 * znám není: okamžik mezi kroky je jen lineární odhad (`est`) a úsek, ve kterém podmínka v žádném z obou kroků neplatí, je
 * `unsure` – začátek tam nejde vyloučit (slabší tvrzení „nezjištěn“, nikdy „nenastal“).
 */
export type StartCheck = { start: ProcAt | null; unsure?: number };
type StartStudy = Pick<MotionStudy, "motors"> & Partial<Pick<MotionStudy, "duration" | "steps">>;
export function opStartCheck(op: Pick<ProcessOp, "at">, res: Pick<MotionResult, "steps" | "phases">, study: StartStudy): StartCheck {
  const S = res.steps;
  if (!S.length) return { start: null };
  const c = op.at;
  if (!c) return { start: { step: S[0].i, t: S[0].t } };
  if ("phase" in c) {
    const ph = res.phases?.find((p) => p.id === c.phase);
    if (!ph?.reached || ph.step === undefined) return { start: null };
    return { start: { step: ph.step, t: ph.t ?? S.find((s) => s.i === ph.step)?.t ?? 0 } };
  }
  const val = condValueAt(c, study);
  if ("t" in c) {
    for (const s of S) if (s.t >= c.t - 1e-9) return { start: { step: s.i, t: Math.max(c.t, S[0].t) } };
    return { start: null };
  }
  const met = (v: number) => (c.op === "<=" ? v <= c.value + 1e-9 : v >= c.value - 1e-9);
  const tr0 = motorTrack(study, res, condMotor(c, study));
  let unsure: number | undefined;
  for (let k = 0; k < S.length; k++) {
    const v = val(S[k]);
    if (k === 0 || !tr0) {
      if (v !== null && met(v)) {
        if (k === 0) return { start: { step: S[0].i, t: S[0].t } };
        // bez profilu jen lineární odhad okamžiku (kotva mezipolohy se z něj nebere – planSub)
        const v0 = val(S[k - 1]);
        let t = S[k].t;
        if (v0 !== null && Math.abs(v - v0) > 1e-12) t = S[k - 1].t + Math.min(1, Math.max(0, (c.value - v0) / (v - v0))) * (S[k].t - S[k - 1].t);
        return { start: { step: S[k].i, t, ...(t < S[k].t - 1e-9 ? { est: true as const } : {}) }, ...(unsure !== undefined ? { unsure } : {}) };
      }
      // úsek bez profilu, podmínka v žádném z obou kroků: mezi nimi ji vyloučit nejde
      if (k > 0 && unsure === undefined) unsure = S[k].i;
      continue;
    }
    const tau = crossIn(tr0, S[k - 1].t, S[k].t, met, (v) => (c.op === "<=" ? v <= c.value : v >= c.value));
    if (tau !== null) return { start: { step: S[k].i, t: tau > S[k].t - 1e-9 ? S[k].t : tau } };
  }
  return { start: null, ...(unsure !== undefined ? { unsure } : {}) };
}
export function opStart(op: Pick<ProcessOp, "at">, res: Pick<MotionResult, "steps" | "phases">, study: StartStudy): ProcAt | null {
  return opStartCheck(op, res, study).start;
}
/** index motoru podmínky (motor, nebo motor, který vazbu pohání); −1 = žádný */
function condMotor(c: MotionCond, study: Pick<MotionStudy, "motors">): number {
  if ("t" in c || "phase" in c) return -1;
  return "motor" in c ? study.motors.findIndex((m) => m.id === c.motor) : study.motors.findIndex((m) => m.mate === c.mate);
}
/**
 * Průběh hodnoty motoru `i` v čase (kolo 7 oprava): profil z cad/motor-model.ts stejně jako řešič (motion.ts – před začátkem fáze
 * profil od 0, od začátku fáze profil posunutý na okamžik začátku; krok `frac` jako mezipoloha `poseAtTime`). `breaks` = okamžiky,
 * mezi kterými je průběh monotónní (klíče úseků, obrat „tam a zpět“, začátek fáze). null = profil nesedí na hodnoty v krocích.
 */
type Track = { at: (t: number) => number; breaks: number[] };
function motorTrack(study: StartStudy, res: Pick<MotionResult, "steps" | "phases">, i: number): Track | null {
  const mo = study.motors[i];
  if (!mo || study.duration === undefined) return null;
  const D = study.duration > 0 ? study.duration : 1;
  const n = Math.max(1, Math.min(2000, Math.round(study.steps || 1)));
  let tPh: number | null = null;
  if (mo.phase) {
    const ph = res.phases?.find((p) => p.id === mo.phase);
    tPh = ph?.reached && ph.t !== undefined ? ph.t : null;
  }
  let p0: MotorProfile;
  let p1: MotorProfile | null;
  try {
    p0 = motorKeys(mo, D, mo.phase ? 0 : motorStartTime(mo));
    p1 = tPh !== null ? motorKeys(mo, D, tPh) : null;
  } catch {
    return null;
  }
  const at = (t: number) => profileAt(p1 && t >= tPh! - 1e-12 ? p1 : p0, t, { k: (t / D) * n, n });
  // shoda s hodnotami motoru v krocích (řešič je počítá z téhož profilu – jinak průběh mezi kroky neznáme)
  for (const s of res.steps) {
    const v = s.motors[i];
    if (v === undefined) continue;
    if (!(Math.abs(at(s.t) - v) <= 1e-6 * (1 + Math.abs(v)))) return null;
  }
  const breaks = [p0, ...(p1 ? [p1] : [])].flatMap((p) => [...p.segments.flatMap((g) => [g.t0, g.t1]), ...(p.back ? [p.duration / 2] : [])]);
  if (tPh !== null) breaks.push(tPh);
  return { at, breaks };
}
/** zlomy profilu uvnitř (a, b), ve kterých motor mění směr nebo se zastaví / rozjede (krajní hodnoty; jen jiná rychlost ne) */
function turnsIn(tr0: Track, a: number, b: number): number[] {
  const e = Math.max(1e-6, (b - a) * 1e-4);
  return tr0.breaks.filter((x) => x > a + e && x < b - e).filter((x) => {
    const d0 = tr0.at(x) - tr0.at(x - e);
    const d1 = tr0.at(x + e) - tr0.at(x);
    // stejný směr před i za zlomem (jen jiná rychlost) ani stání = žádný obrat; začátek / konec prodlevy ano (krajní hodnota)
    const s0 = Math.abs(d0) > 1e-12 ? Math.sign(d0) : 0;
    const s1 = Math.abs(d1) > 1e-12 ? Math.sign(d1) : 0;
    return s0 !== s1;
  });
}
/** první okamžik v (a, b], kdy hodnota splní podmínku (průběh je mezi zlomy monotónní – půlení intervalu); null = v úseku ne */
function crossIn(tr0: Track, a: number, b: number, met: (v: number) => boolean, exact?: (v: number) => boolean): number | null {
  const pts = [a, ...tr0.breaks.filter((x) => x > a + 1e-12 && x < b - 1e-12).sort((x, y) => x - y), b];
  for (let j = 1; j < pts.length; j++) {
    let lo = pts[j - 1];
    let hi = pts[j];
    if (!met(tr0.at(hi))) continue;
    if (met(tr0.at(lo))) return lo;
    // okamžik přesného přechodu hodnoty (tolerance 1e-9 jen pro uznání podmínky v krajním bodě – úvrať přesně na hodnotě)
    const f = exact && exact(tr0.at(hi)) ? exact : met;
    for (let q = 0; q < 80 && hi - lo > 1e-12; q++) {
      const m = (lo + hi) / 2;
      if (f(tr0.at(m))) hi = m;
      else lo = m;
    }
    return hi;
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
export type ProductState = {
  target: string;
  /** `unknown` = nástroj obrobek mezi kroky mohl zasáhnout, mezipolohy ale nešly spočítat – výsledek procesu nezjištěn (kolo 6) */
  phase: "full" | "engaged" | "pierced" | "imprinted" | "notched" | "pierced+imprinted" | "unknown";
  scrap: number;
  removed: number;
  depth: number;
  ops: number;
  exact?: false;
  /** jiná operace téhož obrobku je v kroku v záběru, hotový výsledek (děrovaný / označený) má přednost – „děrovaný + v záběru“ */
  engaged?: true;
};
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
    const notch = ph.includes("notched");
    const eng = ph.includes("engaged");
    // hotový výsledek operace (prostřiženo / otisk / nástřih) má přednost před záběrem jiné operace – „děrovaný + v záběru“
    // (dřív dva střihy, druhý v záběru: „v záběru“ i v kroku, kde první už prostřihl; jedna operace: krok = děrovaný)
    const done: ProductState["phase"] | null = cut && imp ? "pierced+imprinted" : cut ? "pierced" : imp ? "imprinted" : notch ? "notched" : null;
    // záběr jen mezi kroky bez spočítaných mezipoloh (kolo 6): výsledek nezjištěn – nikdy „plný“
    const unknown = !done && !eng && ops.some((o) => o.unresolved !== undefined && k >= o.unresolved);
    const phase: ProductState["phase"] = done ?? (eng ? "engaged" : unknown ? "unknown" : "full");
    const flag = done && eng ? { engaged: true as const } : {};
    // kolo 7: jiná operace obrobku má výsledek nezjištěn (strop mezipoloh, poloha nešla spočítat) – odebraný objem je jen dolní mez
    const lower = phase !== "unknown" && ops.some((o) => o.unresolved !== undefined && k >= o.unresolved) ? { exact: false as const } : {};
    const comb = ops.length > 1 ? combinedFor(ops) : null;
    if (ops.length === 1) {
      const o = ops[0];
      out.push({ target, phase, scrap: ph[0] === "cut" ? Math.max(1, stOf(o)?.scrap.length ?? 0) : 0, removed: stOf(o)?.removed ?? 0, depth, ops: 1, ...lower });
    } else if (comb) {
      const st = comb.states[comb.steps[k] ?? 0] ?? comb.states[0];
      out.push({ target, phase, scrap: cut ? Math.max(1, st.scrap.length) : 0, removed: st.removed, depth, ops: ops.length, ...(comb.error ? { exact: false as const } : lower), ...flag });
    } else {
      // bez kombinace z jádra: jen dolní mez (největší operace), odpad nejméně 1 – nikdy součet
      out.push({ target, phase, scrap: cut ? 1 : 0, removed: Math.max(0, ...ops.map((o) => stOf(o)?.removed ?? 0)), depth, ops: ops.length, exact: false, ...flag });
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
    case "unknown":
      return tr("nezjištěn (záběr jen mezi kroky)");
    default:
      return tr("děrovaný + označený");
  }
}
/** stav výrobku slovem včetně záběru jiné operace: „děrovaný + v záběru“ */
export const stateWord = (p: Pick<ProductState, "phase" | "engaged">): string => (p.engaged ? tr("{0} + v záběru", phaseWord(p.phase)) : phaseWord(p.phase));

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

/** poloha procesní vrstvy: krok studie (`sub: false`) nebo mezipoloha před krokem `k` (úsek k0 → k) */
export type ProcPos = { k: number; k0: number; t: number; place: Record<string, Placement>; sub: boolean };
/** polohy procesní vrstvy v pořadí: mezipolohy úseku a za nimi krok (bez mezipoloh = kroky studie) */
export function procPositions(res: Pick<MotionResult, "steps">, sub?: readonly SubPose[]): ProcPos[] {
  const S = res.steps;
  if (!sub?.length) return S.map((s) => ({ k: s.i, k0: s.i, t: s.t, place: s.place, sub: false }));
  const by = new Map<number, SubPose[]>();
  for (const x of sub) by.set(x.k, [...(by.get(x.k) ?? []), x]);
  const out: ProcPos[] = [];
  S.forEach((s, j) => {
    const k0 = j > 0 ? S[j - 1].i : s.i;
    for (const x of (by.get(s.i) ?? []).sort((a, b) => a.t - b.t)) out.push({ k: s.i, k0, t: x.t, place: x.place, sub: true });
    out.push({ k: s.i, k0, t: s.t, place: s.place, sub: false });
  });
  return out;
}
/** index polohy kroku `j` (index do `res.steps`) v polohách procesní vrstvy */
const stepIndexes = (pos: readonly ProcPos[]): number[] => pos.flatMap((p, i) => (p.sub ? [] : [i]));

/** požadavek jádra pro operaci (stejný v CLI i v prohlížeči – sítě si prohlížeč vyžádá se stejným klíčem) */
export function processRequest(doc: CadDoc, res: Pick<MotionResult, "steps">, op: ProcessOp, start: ProcAt | null, mesh?: number[], sub: readonly SubPose[] | undefined = processOf(res as MotionResult)?.sub): ProcReq {
  const comp = (id: string) => doc.components?.find((c) => c.id === id);
  const T = comp(op.target);
  const P = comp(op.tool);
  if (!T || !P) throw new Error(tr("procesní operace: komponenta „{0}“ v sestavě není", !T ? op.target : op.tool));
  if (T.source.kind === "asm") throw new Error(tr("procesní operace: obrobek „{0}“ musí být díl, ne podsestava", T.name));
  if (P.source.kind === "asm") throw new Error(tr("procesní operace: nástroj „{0}“ musí být díl, ne podsestava", P.name));
  // mezipoloha úseku před krokem začátku platí od odhadnutého okamžiku začátku (podmínka splněná mezi kroky)
  const active = (p: ProcPos) => !!start && (p.sub ? p.k > start.step || (p.k === start.step && p.t >= start.t - 1e-9) : p.k >= start.step);
  const rels = procPositions(res, sub).map((p) => {
    if (!active(p)) return null;
    const a = placeAt(doc, p, op.target);
    const b = placeAt(doc, p, op.tool);
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
export function processRequestWith(doc: CadDoc, res: Pick<MotionResult, "steps">, op: ProcessOp, startOf: (op: ProcessOp) => ProcAt | null, mesh?: number[], meshCombined?: number[], sub: readonly SubPose[] | undefined = processOf(res as MotionResult)?.sub): ProcReq {
  const req = processRequest(doc, res, op, startOf(op), mesh, sub);
  const all = doc.motion?.process ?? [];
  const same = all.filter((x) => x.target === op.target);
  if (same.length < 2 || same[same.length - 1].id !== op.id) return req;
  const others: NonNullable<ProcReq["others"]> = [];
  for (const x of same.slice(0, -1)) {
    try {
      const q = processRequest(doc, res, x, startOf(x), undefined, sub);
      others.push({ tool: q.tool, kind: q.kind, ...(q.depth !== undefined ? { depth: q.depth } : {}), rels: q.rels });
    } catch {
      /* operace s chybou požadavku (podsestava…) – hlásí ji vlastní řádek; do kombinace nepatří */
    }
  }
  return others.length ? { ...req, others, ...(meshCombined?.length ? { meshCombined } : {}) } : req;
}

export type ProcessEnv = { process?: (req: ProcReq) => Promise<ProcRes> };
/** mezipoloha studie pro úsek před krokem `k` v čase `t` (řešič vazeb kinematiky); null = nejde */
export type ProcessPoseAt = (k: number, t: number) => { place: Record<string, Placement> } | null;

/**
 * Mezipolohy procesní vrstvy (kolo 6): plán z jádra (`ProcReq.plan` – úseky, kde by nástroj obrobkem mezi polohami „proskočil“)
 * pro každou operaci, mezipolohy z řešiče studie. `unresolved` = operace → první krok s úsekem, který potřeboval mezipolohy a
 * řešič je nedal (dynamika, řešič bez řešení) – výsledek procesu tam nezjištěn.
 *
 * Kolo 7: (a) začátek operace MEZI kroky (podmínka `při motor 1 <= 5` splněná uprostřed kroku) – první činný úsek začíná polohou
 * v okamžiku začátku (kotva z řešiče), plán i mezipolohy jsou z úseku kotva → krok (dřív plán úsek přeskočil, protože poloha
 * předchozího kroku je před začátkem neaktivní, a vrstva tvrdila „nezasáhl“, „plný“ – razník přitom plech prorazil); bez kotvy
 * (dynamika, řešič bez řešení) a s dráhou nástroje přes obrobek je výsledek bez záběru „nezjištěn“, nikdy „nezasáhl“.
 * (b) strop mezipoloh platí pro operaci, ne pro úsek: jiná operace v témže úseku dostane své mezipolohy i výsledek.
 */
type Unresolved = { k: number; why: NonNullable<ProcOpResult["unresolvedWhy"]>; ifMiss?: true };
type Seg = { j: number; ta: number; tb: number; n: number };
async function planSub(doc: CadDoc, res: MotionResult, ops: readonly ProcessOp[], starts: Map<string, ProcAt | null>, env: Required<ProcessEnv>, poseAt: ProcessPoseAt | undefined): Promise<{ sub: SubPose[]; unresolved: Map<string, Unresolved> }> {
  const S = res.steps;
  const study = doc.motion;
  const jOf = new Map(S.map((s, j) => [s.i, j] as const));
  const sub: SubPose[] = [];
  const unresolved = new Map<string, Unresolved>();
  const segs = new Map<string, Seg>(); // úsek (index kroku + začátek) → nejvíc potřebných mezipoloh
  const opSegs = new Map<string, { key: string; j: number; capped: boolean }[]>();
  // obraty motorů uvnitř úseků (kolo 7 oprava): plán jádra posuzuje dráhu nástroje mezi DVĚMA polohami (obálka obou poloh) – motor
  // „tam a zpět“, který se otočí mezi kroky (1 krok přes celou studii: obě polohy nahoře, razník mezi nimi plechem projde), by úsek
  // přeskočil. Poloha v každém obratu motoru (zlom profilu uvnitř úseku) se proto přidá jako mezipoloha – mezi sousedními polohami
  // je pak hodnota každého motoru monotónní. Obrat bez polohy z řešiče = úsek nezjištěn pro operace, které v něm mohou zasáhnout.
  const turns: SubPose[] = [];
  const turnFail = new Set<number>(); // index úseku j (S[j−1] → S[j]), kde řešič polohu obratu nedal
  if (poseAt && study) {
    const tracks = study.motors.map((_m, i) => motorTrack(study, res, i)).filter((x): x is Track => !!x);
    for (let j = 1; j < S.length; j++) {
      const a = S[j - 1].t;
      const b = S[j].t;
      const ts = [...new Set(tracks.flatMap((x) => turnsIn(x, a, b)).map((t) => Math.round(t * 1e9) / 1e9))].sort((x, y) => x - y).slice(0, PROC_MAX_SUB);
      for (const t of ts) {
        const m = poseAt(S[j].i, t);
        if (m) turns.push({ k: S[j].i, t, place: m.place });
        else turnFail.add(j);
      }
    }
  }
  for (const op of ops) {
    const start = starts.get(op.id) ?? null;
    // začátek uprostřed úseku j−1 → j: kotva = poloha v okamžiku začátku
    const js = start ? (jOf.get(start.step) ?? -1) : -1;
    const mid = !!start && js > 0 && start.t > S[js - 1].t + 1e-9 && start.t < S[js].t - 1e-9;
    let anchor: SubPose[] = [];
    let planStart = start;
    if (mid) {
      // okamžik jen lineárně odhadnutý (profil motoru nesedí na kroky): poloha v odhadu by nebyla polohou začátku – bez kotvy
      const m = start!.est ? null : poseAt?.(S[js].i, start!.t);
      if (m) anchor = [{ k: S[js].i, t: start!.t, place: m.place }];
      // bez kotvy: plán z polohy předchozího kroku (nadmnožina dráhy) – zda nástroj v úseku obrobek vůbec může zasáhnout
      else planStart = { step: S[js - 1].i, t: S[js - 1].t };
    }
    // obraty před začátkem operace (poloha neaktivní) ani v okamžiku kotvy nepřidávat
    const pre = [...anchor, ...turns.filter((x) => !anchor.some((y) => Math.abs(y.t - x.t) < 1e-9))];
    let req: ProcReq;
    try {
      req = processRequest(doc, res, op, planStart, undefined, pre);
    } catch {
      continue; // chybu požadavku ohlásí výpočet operace
    }
    let plan: ProcRes;
    try {
      plan = await env.process({ ...req, plan: true });
    } catch {
      continue;
    }
    const pos = procPositions(res, pre);
    // kotva jen tam, kde dráha nástroje v úseku začátku zasahuje obrobek (jinak poloha v okamžiku začátku na výsledku nic nemění)
    const nearStart = (plan.near ?? []).some((i) => jOf.get(pos[i]?.k ?? -1) === js);
    if (anchor.length && nearStart) sub.push(...anchor);
    // obrat jen tam, kde dráha nástroje k němu nebo od něj zasahuje obrobek
    const nearIdx = new Set(plan.near ?? []);
    for (let i = 0; i < pos.length; i++) {
      const p = pos[i];
      if (!p.sub || !(nearIdx.has(i) || nearIdx.has(i + 1))) continue;
      const tp = turns.find((x) => x.k === p.k && Math.abs(x.t - p.t) < 1e-9);
      if (tp) sub.push(tp);
    }
    const list: { key: string; j: number; capped: boolean }[] = [];
    for (const g of plan.gaps ?? []) {
      const p0 = pos[g.i - 1];
      const p1 = pos[g.i];
      const j = p1 ? jOf.get(p1.k) : undefined;
      if (!p0 || !p1 || j === undefined || j < 1) continue;
      if (mid && !anchor.length && j === js) {
        // úsek začátku bez kotvy: mezipolohy z celého úseku by počítaly i dobu před začátkem – nezjištěn
        list.push({ key: "", j, capped: false });
        continue;
      }
      const key = `${j}|${p0.t}`;
      if (!g.capped) segs.set(key, { j, ta: p0.t, tb: p1.t, n: Math.max(segs.get(key)?.n ?? 0, g.n) });
      list.push({ key, j, capped: !!g.capped });
    }
    // obrat motoru bez polohy z řešiče v činném úseku operace, jehož obálka kroků obrobek zasahuje: nezjištěn
    for (const j of turnFail) {
      const act = !!start && S[j].i >= start.step;
      if (act && (plan.near ?? []).some((i) => jOf.get(pos[i]?.k ?? -1) === j)) list.push({ key: "", j, capped: false });
    }
    opSegs.set(op.id, list);
    // bez kotvy a bez potřeby mezipoloh: dráha úseku začátku přes obrobek – bez záběru v polohách výsledek nezjištěn (ne „nezasáhl“)
    if (mid && !anchor.length && !list.some((x) => x.j === js) && nearStart) unresolved.set(op.id, { k: S[js].i, why: "pose", ifMiss: true });
  }
  const failed = new Set<string>([""]);
  for (const [key, g] of [...segs.entries()].sort((a, b) => a[1].j - b[1].j || a[1].ta - b[1].ta)) {
    const got: SubPose[] = [];
    for (let q = 1; q <= g.n && poseAt; q++) {
      const t = g.ta + ((g.tb - g.ta) * q) / (g.n + 1);
      const m = poseAt(S[g.j].i, t);
      if (!m) break;
      got.push({ k: S[g.j].i, t, place: m.place });
    }
    if (got.length < g.n) failed.add(key);
    else sub.push(...got);
  }
  for (const [id, list] of opSegs) {
    const bad = list.filter((x) => x.capped || failed.has(x.key));
    if (!bad.length) continue;
    const first = bad.reduce((a, b) => (b.j < a.j ? b : a));
    unresolved.set(id, { k: S[first.j].i, why: first.capped ? "cap" : "pose" });
  }
  // jen umístění obrobků a nástrojů (výsledek se ukládá s mezipolohami – bez zbytečných komponent); stejný čas jen jednou
  const keep = new Set(ops.flatMap((o) => [o.tool, o.target]));
  const seen = new Set<string>();
  const uniq = sub.filter((x) => {
    const k = `${x.k}|${Math.round(x.t * 1e9)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { sub: uniq.map((x) => ({ ...x, place: Object.fromEntries(Object.entries(x.place).filter(([id]) => keep.has(id))) })), unresolved };
}

/** nejistý začátek (`StartCheck.unsure`) před nalezeným začátkem → výsledek nezjištěn od toho úseku (`why: "start"`) */
function startUnsure(c: StartCheck | undefined, k: number | undefined): Pick<ProcOpResult, "unresolved" | "unresolvedWhy"> | Record<string, never> {
  const u = c?.unsure;
  if (u === undefined || (c!.start && u >= c!.start.step) || (k !== undefined && k <= u)) return {};
  return { unresolved: u, unresolvedWhy: "start" };
}

/**
 * Procesní vrstva nad hotovým výsledkem studie (volá `motionRun` po výpočtu poloh – výsledek se uloží s ním): pro každou operaci
 * okno, jádro, výsledek; pracovní kontakt nástroj × obrobek v okně = třída `work`; úroveň + geometrická aproximace; hloubka
 * zásahu v kroku pro anotaci; události na časové ose. Bez operací vrací výsledek beze změny. `opts.poseAt` = mezipolohy řešiče:
 * úseky, ve kterých by nástroj obrobkem mezi kroky „proskočil“, se doplní mezipolohami (kolo 6).
 */
export async function processRun<R extends MotionResult>(doc: CadDoc, res: R, env: ProcessEnv, opts: { poseAt?: ProcessPoseAt } = {}): Promise<R> {
  const study = doc.motion;
  const ops = study?.process ?? [];
  if (!study || !ops.length || !res.steps.length) return res;
  const t0 = Date.now();
  const out: ProcOpResult[] = [];
  let unavailable: string | undefined;
  const checks = new Map(ops.map((op) => [op.id, opStartCheck(op, res, study)] as const));
  const starts = new Map([...checks].map(([id, c]) => [id, c.start] as const));
  const { sub, unresolved } = env.process ? await planSub(doc, res, ops, starts, env as Required<ProcessEnv>, opts.poseAt) : { sub: [] as SubPose[], unresolved: new Map<string, Unresolved>() };
  const pos = procPositions(res, sub);
  const idx = stepIndexes(pos);
  const posAt = (i: number): ProcAt => {
    const p = pos[i];
    return { step: p.k, t: p.t, ...(p.sub ? { between: [p.k0, p.k] as [number, number] } : {}) };
  };
  for (const op of ops) {
    const start = starts.get(op.id) ?? null;
    const base = { id: op.id, kind: op.kind, tool: op.tool, target: op.target, start, scrapRule: op.scrap ?? "fall" } as const;
    // podmínka v žádném kroku, mezi kroky nezjištěna: bez výpočtu jádra (není začátek), výsledek od úseku nezjištěn – ne „nenastal“
    if (!start && checks.get(op.id)?.unsure !== undefined && env.process) {
      out.push({ ...base, contact: null, through: null, steps: res.steps.map(() => ({ contact: false, depth: 0, through: false, state: 0 })), states: [{ removed: 0, volume: 0, scrap: [] }], toolAt: res.steps.map(() => null), dir: null, thickness: null, volume0: 0, depth: 0, removed: 0, scrap: [], ms: 0, ...startUnsure(checks.get(op.id), undefined) });
      continue;
    }
    const empty: ProcOpResult = { ...base, contact: null, through: null, steps: res.steps.map(() => ({ contact: false, depth: 0, through: false, state: 0 })), states: [{ removed: 0, volume: 0, scrap: [] }], toolAt: res.steps.map(() => null), dir: null, thickness: null, volume0: 0, depth: 0, removed: 0, scrap: [], ms: 0 };
    if (!env.process) {
      unavailable = tr("jádro bez procesní operace");
      out.push({ ...empty, error: unavailable });
      continue;
    }
    let req: ProcReq;
    try {
      req = processRequestWith(doc, res, op, (x) => starts.get(x.id) ?? null, undefined, undefined, sub);
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
      return i >= 0 ? posAt(i) : null;
    };
    const last = k.steps[k.steps.length - 1];
    const fin = k.states[last?.state ?? 0];
    const un = unresolved.get(op.id);
    out.push({
      ...base,
      contact: at((s) => s.contact),
      through: op.kind === "cut" ? at((s) => s.through) : null,
      // po krocích studie (mezipolohy úseku se promítnou do stavu kroku, který úsek uzavírá)
      steps: idx.map((i) => k.steps[i] ?? { contact: false, depth: 0, through: false, state: 0 }),
      states: k.states,
      toolAt: idx.map((i) => {
        const m = req.rels[i];
        return m ? ([m[9], m[10], m[11]] as Vec3) : null;
      }),
      dir: k.dir,
      thickness: k.thickness,
      volume0: k.volume0,
      depth: last?.depth ?? 0,
      removed: fin?.removed ?? 0,
      scrap: fin?.scrap ?? [],
      ...(k.approx ? { approx: k.approx } : {}),
      ...(k.error ? { error: k.error } : {}),
      // víc operací na obrobku: kombinovaný stav z jádra (bez něj jen dolní mez – productStates)
      ...(req.others?.length ? { combined: k.combined ? { steps: idx.map((i) => k.combined!.steps[i] ?? 0), states: k.combined.states.map((x) => ({ removed: x.removed, volume: x.volume, scrap: x.scrap })), ...(k.combined.error ? { error: k.combined.error } : {}) } : { missing: true as const } } : {}),
      // bez kotvy začátku (kolo 7): nezjištěn jen tehdy, když vrstva v polohách záběr nenašla
      ...(un && !(un.ifMiss && k.steps.some((s) => s.contact)) ? { unresolved: un.k, unresolvedWhy: un.why } : {}),
      // začátek mohl nastat mezi kroky dřív, než ho vrstva našla (průběh motoru mezi kroky neznámý – kolo 7 oprava)
      ...startUnsure(checks.get(op.id), un && !(un.ifMiss && k.steps.some((s) => s.contact)) ? un.k : undefined),
      ms: k.ms,
    });
  }
  const proc: ProcessResult = { ops: out, ms: Date.now() - t0, ...(unavailable ? { unavailable } : {}), ...(sub.length ? { sub } : {}) };
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
  // pojistka (kolo 6 oprava): spojitá kontrola kolizí našla pracovní kontakt nástroj × obrobek MEZI kroky, procesní vrstva
  // v žádné své poloze záběr nenašla → výsledek procesu nezjištěn, nikdy „nezasáhl, obrobek beze změny“ (ať plán úsek vynechal
  // z jakéhokoli důvodu – obálka, natočení, strop)
  for (const o of out) {
    if (o.contact || o.error || !o.start || o.unresolved !== undefined) continue;
    const pair = (c: MotionCollision) => {
      const A = c.aPath?.[0] ?? c.a;
      const B = c.bPath?.[0] ?? c.b;
      return (A === o.tool && B === o.target) || (A === o.target && B === o.tool);
    };
    const h = between?.find((x) => x.k1 >= o.start!.step && x.clashes.some((c) => c.cls === "work" && pair(c)));
    if (h) Object.assign(o, { unresolved: h.k1, unresolvedWhy: "clash" as const });
  }
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

/** „od kroku 19 (t = …)“ / „od mezipolohy mezi kroky 0 a 1 (t = …)“ (2. pád) */
const at = (a: ProcAt) => (a.between ? tr("mezipolohy mezi kroky {0} a {1} (t = {2} s)", a.between[0], a.between[1], nf(a.t, 3)) : tr("kroku {0} (t = {1} s)", a.step, nf(a.t, 3)));
/** „v kroku 21 (t = …)“ / „v mezipoloze mezi kroky 0 a 1 (t = …)“ (6. pád) */
const atIn = (a: ProcAt) => (a.between ? tr("mezipoloze mezi kroky {0} a {1} (t = {2} s)", a.between[0], a.between[1], nf(a.t, 3)) : tr("kroku {0} (t = {1} s)", a.step, nf(a.t, 3)));
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
    if (!o.start && o.unresolvedWhy === "start") {
      out.push(` ${head}: ${unresolvedText(o)}`);
      continue;
    }
    if (!o.start) {
      out.push(` ${head}: ${tr("začátek operace nenastal – obrobek beze změny")}`);
      continue;
    }
    if (!o.contact && o.unresolved !== undefined) {
      out.push(` ${head}: ${unresolvedText(o)}`);
      continue;
    }
    if (!o.contact) {
      out.push(` ${head}: ${tr("bez záběru – nástroj obrobek nezasáhl, obrobek beze změny")}`);
      continue;
    }
    const parts = [tr("záběr od {0}", at(o.contact))];
    if (o.kind === "cut") parts.push(o.through ? tr("prostřiženo v {0}", atIn(o.through)) : tr("neprostřiženo"));
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
    // kolo 7: dolní mez kvůli operaci s nezjištěným výsledkem (ne kvůli chybějícímu sjednocení)
    const unk = proc.ops.some((o) => o.target === p.target && o.unresolved !== undefined && last >= o.unresolved);
    const comb = combinedFor(proc.ops.filter((o) => o.target === p.target));
    out.push(
      p.exact === false && unk && comb && !comb.error
        ? tr(" „{0}“: {1} operací, odebráno nejméně {2} mm³ – výsledek některé operace nezjištěn (sjednocení spočítaných operací; jejich součet {3} mm³)", cname(doc, p.target), p.ops, nf(p.removed, 3), nf(sum, 3))
        : p.exact === false
        ? tr(" „{0}“: {1} operací, odebráno nejméně {2} mm³ – sjednocení operací nespočítáno (součet {3} mm³ by společný objem počítal dvakrát)", cname(doc, p.target), p.ops, nf(p.removed, 3), nf(sum, 3))
        : tr(" „{0}“: {1} operací, celkem odebráno {2} mm³ (sjednocení – společný objem operací jen jednou; součet operací {3} mm³)", cname(doc, p.target), p.ops, nf(p.removed, 3), nf(sum, 3)),
    );
  }
  out.push(...productTimeline(proc, res, doc));
  return out;
}
/** proč je výsledek operace nezjištěn (protokol): řešič bez mezipolohy / strop mezipoloh / průnik jen v kontrole kolizí */
function unresolvedText(o: ProcOpResult): string {
  if (o.unresolvedWhy === "start")
    return o.start
      ? tr("začátek operace mohl nastat už mezi kroky před krokem {0} (průběh motoru mezi kroky neznámý) – výsledek procesu nezjištěn", o.unresolved)
      : tr("začátek operace nenastal v žádném kroku, mezi kroky od kroku {0} nezjištěn (průběh motoru mezi kroky neznámý) – výsledek procesu nezjištěn", o.unresolved);
  if (o.unresolvedWhy === "cap") return tr("záběr jen mezi kroky – výsledek procesu nezjištěn (úsek před krokem {0} by potřeboval víc než {1} mezipoloh)", o.unresolved, PROC_MAX_SUB);
  if (o.unresolvedWhy === "clash") return tr("záběr jen mezi kroky – výsledek procesu nezjištěn (kontrola kolizí našla průnik před krokem {0}, procesní vrstva v polohách ne)", o.unresolved);
  return tr("záběr jen mezi kroky – výsledek procesu nezjištěn (mezipolohy od kroku {0} nešly spočítat)", o.unresolved);
}
/** průběh stavu výrobku po krocích: „Stav výrobku „Plech“: plný (kroky 0–4) → v záběru (5) → děrovaný (6–36)“ */
export function productTimeline(proc: ProcessResult, res: Pick<MotionResult, "steps">, doc: CadDoc): string[] {
  const targets = [...new Set(proc.ops.map((o) => o.target))];
  return targets.map((target) => {
    const runs: { p: string; a: number; b: number }[] = [];
    res.steps.forEach((s, k) => {
      const st = productStates(proc, k).find((x) => x.target === target);
      const p = st ? stateWord(st) : phaseWord("full");
      const last = runs[runs.length - 1];
      if (last && last.p === p) last.b = s.i;
      else runs.push({ p, a: s.i, b: s.i });
    });
    const span = (r: { a: number; b: number }) => (r.a === r.b ? tr("krok {0}", r.a) : tr("kroky {0}", `${r.a}–${r.b}`));
    return tr("Stav výrobku „{0}“: {1}", cname(doc, target), runs.map((r) => `${r.p} (${span(r)})`).join(" → "));
  });
}
/** stav výrobku v kroku (`pohyb krok N`, panel, `stav`): „„Plech“: děrovaný · odpad 1 oddělen · odebráno 314,159 mm³“ */
export function productLines(res: MotionResult, doc: CadDoc, k: number): string[] {
  const proc = processOf(res);
  if (!proc) return [];
  return productStates(proc, k).map((p) => {
    const extra = [p.removed > 0 ? (p.exact === false ? tr("odebráno nejméně {0} mm³", nf(p.removed, 3)) : tr("odebráno {0} mm³", nf(p.removed, 3))) : "", p.depth > 0 ? tr("hloubka {0} mm", nf(p.depth, 3)) : "", p.scrap ? tr("odpad {0} oddělen", p.scrap) : ""].filter(Boolean);
    return tr(" stav výrobku „{0}“: {1}{2}", cname(doc, p.target), stateWord(p), extra.length ? ` · ${extra.join(" · ")}` : "");
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
    else if (!o.contact && !o.error && o.unresolved === undefined) out.push({ code: "motion.process-miss", args: [name, P, T], text: tr("procesní operace {0}: nástroj „{1}“ obrobek „{2}“ v okně operace nezasáhl – obrobek beze změny", name, P, T) });
    else if (o.kind === "cut" && o.contact && !o.through) out.push({ code: "motion.process-partial", args: [name, T, nf(o.depth, 3)], text: tr("procesní operace {0}: obrobek „{1}“ neprostřižen – hloubka {2} mm", name, T, nf(o.depth, 3)) });
    else if (o.kind === "imprint" && o.contact) {
      // otisk mělčí než zadaná hloubka (nástroj se zastavil dřív) – jako neprostřižený střih (kolo 6: hloubka 0,1 z 0,3 mm bez upozornění)
      const want = (doc.motion?.process ?? []).find((x) => x.id === o.id)?.depth;
      if (want !== undefined && o.depth < want - Math.max(1e-3, want * 0.01))
        out.push({ code: "motion.process-partial", args: [name, T, nf(o.depth, 3), nf(want, 3)], text: tr("procesní operace {0}: otisk do „{1}“ {2} mm z požadovaných {3} mm", name, T, nf(o.depth, 3), nf(want, 3)) });
    }
    if (o.unresolved !== undefined && !o.error)
      out.push({
        code: "motion.process-between",
        args: [name, P, T],
        text:
          o.unresolvedWhy === "start"
            ? tr("procesní operace {0}: začátek operace mohl nastat mezi kroky (průběh motoru mezi kroky neznámý) – výsledek procesu „{1}“ → „{2}“ nezjištěn (jemnější kroky: pohyb kroky N)", name, P, T)
            : o.unresolvedWhy === "cap"
            ? tr("procesní operace {0}: nástroj „{1}“ mohl obrobek „{2}“ zasáhnout jen mezi kroky – úsek by potřeboval víc než {3} mezipoloh, výsledek procesu nezjištěn (jemnější kroky: pohyb kroky N)", name, P, T, PROC_MAX_SUB)
            : o.unresolvedWhy === "clash"
              ? tr("procesní operace {0}: kontrola kolizí našla průnik nástroje „{1}“ s obrobkem „{2}“ mezi kroky, procesní vrstva v polohách ne – výsledek procesu nezjištěn (jemnější kroky: pohyb kroky N)", name, P, T)
              : tr("procesní operace {0}: nástroj „{1}“ mohl obrobek „{2}“ zasáhnout jen mezi kroky – mezipolohy nešly spočítat, výsledek procesu nezjištěn (jemnější kroky: pohyb kroky N)", name, P, T),
      });
    const cmb = o.combined;
    if (cmb && "missing" in cmb) out.push({ code: "motion.process-failed", args: [name, tr("jádro nevrátilo stav obrobku po všech operacích")], text: tr("procesní operace {0}: booleovská operace selhala ({1}) – výsledek jen do posledního platného stavu", name, tr("jádro nevrátilo stav obrobku po všech operacích")) });
    else if (cmb?.error) out.push({ code: "motion.process-failed", args: [name, cmb.error], text: tr("procesní operace {0}: booleovská operace selhala ({1}) – výsledek jen do posledního platného stavu", name, cmb.error) });
    if (o.approx) out.push({ code: "motion.process-approx", args: [name, String(o.approx.computed), String(o.approx.contact)], text: tr("procesní operace {0}: booleovsky spočítáno {1} z {2} kroků se záběrem (strop výkonu) – mezikroky převzaty", name, o.approx.computed, o.approx.contact) });
  }
  return out;
}

/** počet ⚠ procesní vrstvy (verdikt `stav` – motion-cache.ts `motionVerdict`) */
export const processWarnCount = (res: MotionResult, doc: CadDoc): number => processCodes(res, doc).filter((c) => c.code === "motion.process-miss" || c.code === "motion.process-failed" || c.code === "motion.process-between").length;
/** stav výrobku na konci studie pro řádek „Pohyb:“ v `stav`: „procesní vrstva (geometrická aproximace): „Plech“ děrovaný, odebráno 314,159 mm³, odpad 1“ */
export function processStatusText(res: MotionResult, doc: CadDoc): string {
  const proc = processOf(res);
  if (!proc) return "";
  const last = res.steps.length - 1;
  const parts = productStates(proc, last).map((p) => `„${cname(doc, p.target)}“ ${stateWord(p)}${p.removed > 0 ? (p.exact === false ? tr(", odebráno nejméně {0} mm³", nf(p.removed, 3)) : tr(", odebráno {0} mm³", nf(p.removed, 3))) : ""}${p.scrap ? tr(", odpad {0}", p.scrap) : ""}`);
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
