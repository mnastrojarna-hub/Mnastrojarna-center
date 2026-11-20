/**
 * Kolize pohybové studie podle tříd (vlna 22, bod 5): zařazení dvojic už PŘI výpočtu kroku (geometricky v jádře – `clashDetail`,
 * clash-class.ts) a souhrny pro protokol z čistého modulu clash-report.ts. Výsledek studie v mezipaměti (cad/motion-cache.ts)
 * tak nese třídy dvojic a panel pohybu, `window.mncad.motion()`, CSV i textový protokol čtou totéž – dřív panel a API četly
 * surové průniky (šroub v závitu = „první kolize v kroku 0“) a pohyb uvnitř podsestavy ztrácel cesty listů (→ falešný
 * ⚠ nevyhodnotitelné „Horní skupina × Horní skupina“).
 */
import type { AsmEnv, AsmResult } from "./asm-agent";
import { classifyClashes as classifyGeo, type ClashClass, type ClashPair } from "./clash-class";
import { motionClashSummary, stepClashReport, type ClashStep, type MotionClashStats } from "./clash-report";
import { classifyClashes as estimateClashes } from "./clash-thread";
import type { MotionClashes, MotionResult } from "./motion";
import { clearanceOf } from "./motion-clearance";
import type { CadDoc } from "./types";

/** zařazená dvojice kolize kroku */
export type StepClash = ClashPair & { cls: ClashClass };

/**
 * Zařazení dvojic kolize kroku stejně jako `kolize` (engine/ops/clash.ts): geometricky v jádře (`clashDetail` – výsledek
 * dvojice se stejnou vzájemnou polohou si jádro pamatuje, statické šrouby se tak počítají jednou), bez jádra (testy, prostředí
 * bez operace) odhad z prvků (clash-thread.ts) se stejnými třídami. Cesty listů, místo a tloušťka průniku zůstávají.
 */
export async function classifyStepClashes(env: Pick<AsmEnv, "clashDetail"> | undefined, doc: CadDoc, pairs: readonly ClashPair[]): Promise<StepClash[]> {
  if (!pairs.length) return [];
  const clashDetail = env?.clashDetail;
  if (clashDetail) return (await classifyGeo({ clashDetail }, doc, pairs)).list;
  return estimateClashes(doc, pairs).list.map((x, i) => ({ ...pairs[i], ...x }));
}

/**
 * Kontrola kolizí jednoho kroku studie: průniky v jádře (přírůstkově) a jejich zařazení. Dvojice nesou cesty listů (podsestavy),
 * místo průniku a třídu z jádra; pravidla dokumentu (pracovní kontakt, dotyk) se uplatní až v souhrnu (clash-report.ts – okno
 * kroků zná jen souhrn). Bez `interference` v prostředí undefined (studie se pak počítá bez kolizí).
 */
export function collideClassified(env: Pick<AsmEnv, "interference" | "clashDetail">): ((x: CadDoc) => Promise<MotionClashes>) | undefined {
  if (!env.interference) return undefined;
  return async (x: CadDoc) => {
    const res = (await env.interference!(x)) as Awaited<ReturnType<NonNullable<AsmEnv["interference"]>>> & { stats?: MotionClashes["stats"] };
    const pairs: ClashPair[] = res.map((c) => ({ ...c }));
    const list = env.clashDetail && pairs.length ? await classifyStepClashes(env, x, pairs) : [];
    const out: MotionClashes = list.length === pairs.length ? list.map((c) => ({ ...c })) : pairs;
    if (res.stats) out.stats = res.stats;
    return out;
  };
}

/** doplní třídy krokům, jejichž dvojice zařazené nejsou (výsledek spočítaný dřív, prostředí bez `clashDetail` při výpočtu) */
async function ensureClassified(res: MotionResult, d: CadDoc, env?: Pick<AsmEnv, "clashDetail">): Promise<ClashStep[]> {
  const { poseDoc } = await import("./motion");
  const out: ClashStep[] = [];
  for (const s of res.steps) {
    if (!s.clashes?.length || s.clashes.every((c) => (c as { cls?: ClashClass }).cls)) {
      out.push(s);
      continue;
    }
    const list = await classifyStepClashes(env, poseDoc(d, s.place), s.clashes);
    out.push({ ...s, clashes: list });
  }
  return out;
}

/**
 * Kolize pohybové studie podle tříd pro protokol (`= … motion …`, `pohyb stav`): řádky souhrnu, záznamy s kódem a počty.
 * „Kroků se skutečnou kolizí“ počítá jen kroky se závadou; šrouby v závitu, dotyk a pracovní kontakt zvlášť.
 */
export async function motionClashLines(res: MotionResult, d: CadDoc, env?: Pick<AsmEnv, "clashDetail">): Promise<{ lines: string[]; codes: NonNullable<AsmResult["codes"]>; stats: MotionClashStats }> {
  const steps = await ensureClassified(res, d, env);
  const every = (res as { dynamic?: { clashEvery?: number } }).dynamic?.clashEvery;
  // spojitost kontroly a kontakty nalezené mezi kroky (vlna 22, bod 6 – motion-clearance.ts)
  const { sweep, between } = clearanceOf(res);
  return motionClashSummary({ steps, collisionsChecked: res.collisionsChecked, ...(sweep ? { sweep } : {}), ...(between ? { between } : {}) }, d, every !== undefined ? { every } : {});
}

/** kolize kroku pro `pohyb krok N`: řádky (šroub v závitu, pracovní kontakt, dotyk) a ⚠ závady s instancí a místem */
export async function stepClashLines(s: MotionResult["steps"][number], d: CadDoc, env?: Pick<AsmEnv, "clashDetail">): Promise<{ lines: string[]; codes: NonNullable<AsmResult["codes"]> }> {
  const [step] = await ensureClassified({ steps: [s], collisionsChecked: true } as MotionResult, d, env);
  return stepClashReport(d, step);
}
