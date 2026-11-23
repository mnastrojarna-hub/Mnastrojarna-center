/**
 * Fáze pohybové studie (vlna 22, bod 3 zprávy): jeden dokument, jedna časová osa – nájezd, sevření, pracovní zdvih, značení,
 * návrat. Model:
 *
 * | prvek | význam |
 * |---|---|
 * | `MotionStudy.phases[]` | fáze v pořadí; každá trvá od svého začátku do začátku další |
 * | `MotionPhase.start` (`MotionCond`) | čas `{ t }`, hodnota vazby `{ mate, op, value }` nebo motoru `{ motor, op, value }`; bez podmínky: první fáze v t = 0, další fáze, až dojedou motory předchozí fáze |
 * | `MotionPhase.enable / suppress` | od začátku fáze zapnout (zachytí NYNĚJŠÍ polohu – zámek, mezera vzdálenosti) / potlačit vazby |
 * | `MotionPhase.mode` | režim fáze (kinematika / kvazistatika; cad/motion-mode.ts `studyMode(doc, study, phase)`) |
 * | `MotionMotor.phase` | motor začne v okamžiku začátku fáze (polohové okno); `MotionMotor.window` = časové okno |
 * | pravidlo motorů | vazbu pohání motor, který na ní začal NEJPOZDĚJI (a už začal); před začátkem motor nepohání; po posledním klíči stojí |
 *
 * Podmínka hodnoty se vyhodnocuje v poloze kroku (po výpočtu kroku); okamžik se odhadne lineárně mezi krokem k−1 a k (`tEst`)
 * a nastavení fáze platí od dalšího kroku; časová podmínka platí už pro krok, ve kterém nastane. Restart = vždy z dokumentu.
 *
 * **Rozšíření pro procesní vrstvu (balík C, bod 4):** procesní událost (střih, otisk, stav výrobku) se váže na tutéž podmínku
 * `MotionCond` (`condMet`, `condText`) a výsledek nese časovou osu událostí `MotionResult.events` (`{ kind: "phase", … }`) – C3 přidá
 * `{ kind: "process", … }` se stejným krokem / časem; hodnoty vazeb v kroku dodá `CondProbe` výpočtu.
 */
import { tr } from "./i18n";
import { MATE_LABEL } from "./mates";
import type { StudyMode } from "./motion-mode";
import { levelName } from "./motion-mode";
import { motorNum } from "./motor-model";
import { uid, type CadDoc, type Mate, type MotionCond, type MotionPhase, type MotionStudy } from "./types";

/** průběh fáze ve výsledku studie */
export type PhaseRun = {
  id: string;
  name: string;
  /** pořadí fáze (od 0) */
  index: number;
  /** fáze nastala; jinak podmínka nebyla do konce studie splněna (⚠ motion.phase-unreached) */
  reached: boolean;
  /** první krok fáze (nastavení fáze platí od něj) a čas začátku [s] (u podmínky hodnoty odhad mezi kroky) */
  step?: number;
  t?: number;
  /** poslední krok fáze */
  end?: number;
  mode: StudyMode;
  /** kroky s nesplněnou vazbou / motorem na mezi / neplatné ve fázi */
  conflictSteps: number;
  stopped: number;
  invalid: number;
  /** hodnota podmínky v kroku, kdy nastala (nebo nejbližší dosažená hodnota, když nenastala) */
  value?: number;
};
/** událost časové osy studie: začátek fáze (C3 přidá procesní události) */
export type MotionEvent = { kind: "phase"; id: string; step: number; t: number } | { kind: "process"; id: string; what: "contact" | "through"; step: number; t: number };

/** hodnoty, které podmínky čtou v poloze kroku (dodá výpočet studie) */
export type CondProbe = { t: number; mate: (id: string) => number | null; motor: (id: string) => number | null };

/** hodnota podmínky v kroku (null = nelze změřit) */
export function condValue(c: MotionCond, p: CondProbe): number | null {
  if ("t" in c) return p.t;
  if ("mate" in c) return p.mate(c.mate);
  return p.motor(c.motor);
}
/** je podmínka splněná (tolerance 1e-9) */
export function condMet(c: MotionCond, p: CondProbe): boolean {
  const v = condValue(c, p);
  if (v === null) return false;
  if ("t" in c) return v >= c.t - 1e-9;
  return c.op === "<=" ? v <= c.value + 1e-9 : v >= c.value - 1e-9;
}
/** lineární odhad okamžiku splnění podmínky hodnoty mezi dvěma kroky */
export function crossTime(c: MotionCond, a: { t: number; v: number }, b: { t: number; v: number }): number {
  if ("t" in c) return c.t;
  const target = c.value;
  if (Math.abs(b.v - a.v) < 1e-12) return b.t;
  const s = Math.min(1, Math.max(0, (target - a.v) / (b.v - a.v)));
  return a.t + s * (b.t - a.t);
}

/** popis vazby pro podmínku: „ZDVIH“ / „Vzdálenost Přidržovač → Deska A“ */
function mateWord(m: Mate | undefined, doc: CadDoc): string {
  if (!m) return "?";
  const nm = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? id;
  return m.name ?? `${tr(MATE_LABEL[m.type])} ${nm(m.a.compId)} → ${nm(m.b.compId)}`;
}

/** Podmínka slovy: „t ≥ 0,4 s“, „vazba „ZDVIH“ ≤ 30“, „motor 1 ≥ 10“, „po dojetí motorů předchozí fáze“. */
export function condText(c: MotionCond | undefined, doc: CadDoc, study: Pick<MotionStudy, "motors">, index: number): string {
  if (!c) return index === 0 ? tr("od začátku studie") : tr("po dojetí motorů předchozí fáze");
  if ("t" in c) return tr("t ≥ {0} s", motorNum(c.t, 3));
  const op = c.op === "<=" ? "≤" : "≥";
  if ("mate" in c) return tr("vazba „{0}“ {1} {2}", mateWord(doc.mates?.find((m) => m.id === c.mate), doc), op, motorNum(c.value));
  const i = study.motors.findIndex((m) => m.id === c.motor);
  return tr("motor {0} {1} {2}", i >= 0 ? i + 1 : "?", op, motorNum(c.value));
}

/** popis fáze do definice studie (`pohyb stav`, panel): „2. Sevření · při vazba „PŘIDRŽ“ ≤ 0 · zapnout: Zámek … · kvazistatika“ */
export function phaseText(ph: MotionPhase, i: number, doc: CadDoc, study: Pick<MotionStudy, "motors">): string {
  const mates = doc.mates ?? [];
  const ml = (id: string) => {
    const m = mates.find((x) => x.id === id);
    return m ? `${mates.indexOf(m) + 1}. ${mateWord(m, doc)}` : id;
  };
  const motors = study.motors.map((m, k) => (m.phase === ph.id ? k + 1 : 0)).filter(Boolean);
  const parts = [`${i + 1}. ${ph.name}`, condText(ph.start, doc, study, i)];
  if (ph.enable?.length) parts.push(tr("zapnout: {0}", ph.enable.map(ml).join(", ")));
  if (ph.suppress?.length) parts.push(tr("potlačit: {0}", ph.suppress.map(ml).join(", ")));
  if (ph.mode) parts.push(levelName({ level: ph.mode }));
  if (motors.length) parts.push(tr("motory: {0}", motors.join(", ")));
  return parts.join(" · ");
}

/**
 * Řádky protokolu po fázích (výsledek): „Fáze 2 „Sevření“: kroky 8–16 · t = 0,412–0,8 s · začátek: vazba „PŘIDRŽ“ ≤ 0 · režim
 * kvazistatika · nesplněné vazby 0“ – nebo „⚠ fáze 3 „Střih“ nenastala – podmínka … do konce studie nesplněna (nejblíž 31,2)“.
 */
export function phaseLines(runs: PhaseRun[], doc: CadDoc, study: Pick<MotionStudy, "motors" | "phases">, stepT: (i: number) => number): string[] {
  const out: string[] = [];
  for (const r of runs) {
    const ph = study.phases?.find((p) => p.id === r.id);
    const cond = condText(ph?.start, doc, study, r.index);
    if (!r.reached) {
      out.push(tr("⚠ fáze {0} „{1}“ nenastala – podmínka {2} do konce studie nesplněna{3}", r.index + 1, r.name, cond, r.value !== undefined ? tr(" (nejblíž {0})", motorNum(r.value)) : ""));
      continue;
    }
    // fáze bez vlastního kroku (začala i skončila mezi dvěma kroky): jen krok začátku
    const end = r.end ?? r.step;
    const steps = r.step === end ? String(r.step) : `${r.step}–${end}`;
    const tEnd = r.end === undefined ? (r.t ?? 0) : stepT(r.end);
    const bad = r.conflictSteps ? tr("nesplněné vazby v {0} krocích", r.conflictSteps) : tr("nesplněné vazby 0");
    const extra = [r.stopped ? tr("motor na mezi v {0} krocích", r.stopped) : "", r.invalid ? tr("neplatné kroky {0}", r.invalid) : ""].filter(Boolean).join(" · ");
    out.push(
      tr("Fáze {0} „{1}“: kroky {2} · t = {3}–{4} s · začátek: {5} · {6} · {7}", r.index + 1, r.name, steps, motorNum(r.t ?? 0, 3), motorNum(tEnd, 3), cond, levelName({ level: r.mode }), bad) + (extra ? ` · ${extra}` : ""),
    );
  }
  return out;
}

/** fáze, které nenastaly – ⚠ motion.phase-unreached (protokol s kódem, panel) */
export function phaseFindings(runs: PhaseRun[], doc: CadDoc, study: Pick<MotionStudy, "motors" | "phases">): { code: "motion.phase-unreached"; args: string[]; text: string }[] {
  return runs
    .filter((r) => !r.reached)
    .map((r) => {
      const cond = condText(study.phases?.find((p) => p.id === r.id)?.start, doc, study, r.index);
      const near = r.value !== undefined ? motorNum(r.value) : "?";
      return {
        code: "motion.phase-unreached",
        args: [r.name, cond, near],
        text: tr("fáze „{0}“ nenastala: podmínka {1} se do konce studie nesplnila (nejbližší hodnota {2}) – upravte podmínku (pohyb fáze N upravit při …) nebo prodlužte pohyb motoru", r.name, cond, near),
      };
    });
}

/** strojové pole řádku `= … motion …`: `phases=<nastalé>/<všechny>` (jen se studií s fázemi) */
export const phaseKv = (runs: PhaseRun[] | undefined): string[] => (runs?.length ? [`phases=${runs.filter((r) => r.reached).length}/${runs.length}`] : []);

/* ───────────────────────── úpravy fází (text i panel) ───────────────────────── */

/** fáze podle čísla (od 1) nebo názvu */
export function findPhase(study: Pick<MotionStudy, "phases">, ref: string): { ph: MotionPhase; i: number } {
  const list = study.phases ?? [];
  const n = /^\d+$/.test(ref) ? Number(ref) : NaN;
  const i = Number.isFinite(n) ? n - 1 : list.findIndex((p) => p.name.toLowerCase() === ref.toLowerCase());
  if (!list[i]) throw new Error(tr("fáze „{0}“ ve studii není – fáze: {1}", ref, list.length ? list.map((p, k) => `${k + 1}. ${p.name}`).join(", ") : tr("žádné")));
  return { ph: list[i], i };
}

/** nová fáze s jedinečným id */
export const newPhase = (name: string, rest: Partial<Omit<MotionPhase, "id" | "name">> = {}): MotionPhase => ({ id: uid(), name, ...rest });

/** posun fáze v pořadí (−1 nahoru, +1 dolů); první fáze bez podmínky začíná v t = 0 */
export function movePhase(phases: MotionPhase[], i: number, dir: -1 | 1): MotionPhase[] {
  const j = i + dir;
  if (j < 0 || j >= phases.length) return phases;
  const out = [...phases];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/**
 * Smazání fáze: motory vázané na fázi ji ztratí (začnou v t = 0 – nebo okně) a podmínky na ni nemíří – vrací studii a počet
 * motorů, které fázi ztratily (protokol to řekne).
 */
export function removePhase(study: MotionStudy, i: number): { study: MotionStudy; motors: number } {
  const ph = study.phases?.[i];
  if (!ph) return { study, motors: 0 };
  let n = 0;
  const motors = study.motors.map((m) => {
    if (m.phase !== ph.id) return m;
    n++;
    const x = { ...m };
    delete x.phase;
    return x;
  });
  const phases = (study.phases ?? []).filter((_, k) => k !== i);
  const out: MotionStudy = { ...study, motors, phases };
  if (!phases.length) delete out.phases;
  return { study: out, motors: n };
}

/** Kontrola definice fází (text i panel): neznámé vazby / motory podmínek, dynamika ve fázi kinematické studie. */
export function phaseProblems(study: MotionStudy, mates: Mate[]): string[] {
  const out: string[] = [];
  (study.phases ?? []).forEach((ph, i) => {
    const c = ph.start;
    if (c && "mate" in c && !mates.some((m) => m.id === c.mate)) out.push(tr("fáze {0} „{1}“: vazba podmínky v sestavě není", i + 1, ph.name));
    if (c && "motor" in c && !study.motors.some((m) => m.id === c.motor)) out.push(tr("fáze {0} „{1}“: motor podmínky ve studii není", i + 1, ph.name));
    for (const id of [...(ph.enable ?? []), ...(ph.suppress ?? [])]) if (!mates.some((m) => m.id === id)) out.push(tr("fáze {0} „{1}“: vazba {2} v sestavě není", i + 1, ph.name, id));
    if (ph.mode === "dynamic" || (study.mode === "dynamic" && (study.phases?.length ?? 0) > 0))
      out.push(tr("fáze {0} „{1}“: dynamika po fázích zatím není – fáze počítá kinematika nebo kvazistatika (dynamika = celá studie bez fází)", i + 1, ph.name));
  });
  return out;
}
