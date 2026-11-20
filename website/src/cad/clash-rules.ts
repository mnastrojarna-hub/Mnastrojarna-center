/**
 * Pravidla kontroly kolizí sestavy (vlna 22, bod 5 zprávy majitele) – JEDEN model `doc.clashRules` pro pracovní kontakt
 * operace i pro pozdější procesní vrstvu (střih / otisk, balík C3), a tolerance numerického dotyku `doc.clashTol`.
 *
 * Kontrola kolizí v jádře zařadí dvojice geometricky (clash-class.ts + clash-detail.ts: šroub v závitu, prstenec pod hlavou,
 * skutečná, nevyhodnotitelná, šroub v jádrové díře bez prvku závitu). Tento modul je čistá „politika“ dokumentu, která se
 * nad uloženým geometrickým zařazením uplatní ŽIVĚ (panel Kolize, `stav`, řádek D, souhrn pohybu):
 *
 *  1. dotyk – průnik tenčí než `clashTol` (výchozí 0,01 mm; tloušťka 2·V/S nejtlustšího kusu z `interference`) → ℹ `touch`
 *     (přesah 0,0001 mm dvou desek není kolize, ale ani se neztratí – počítá se a panel ho ukáže ve třídě Dotyk);
 *  2. pravidlo `thread` – šroub v hladké jádrové díře (import bez prvku závitu) je závitový záběr; třída podle pásma
 *     (`bandCls` z jádra: závit / pod hlavou / skutečná, když hlava nebo konec dříku vězí v plném materiálu);
 *  3. pravidlo `work` – pracovní kontakt nástroj × plech v okně operace (kroky studie / hodnota motoru vazby) → ℹ `work`;
 *     mimo okno zůstává ⚠ skutečná kolize. Nikdy se nevypíná kontrola celé dvojice ani celé sestavy.
 *
 * Změna pravidla tedy uložený výsledek nezneplatní (geometrie se nezměnila), jen ho jinak roztřídí. Bez jádra a Reactu –
 * stejný v prohlížeči i v CLI.
 */
import type { ClashClass, ClashDetail, ClashPair, ClashWhy } from "./clash-class";
import type { CadDoc, ClashRule } from "./types";

/** výchozí tolerance dotyku [mm] */
export const CLASH_TOUCH_TOL = 0.01;
/** tolerance dotyku dokumentu [mm] */
export const touchTol = (doc: Pick<CadDoc, "clashTol">): number => (doc.clashTol !== undefined && doc.clashTol >= 0 ? doc.clashTol : CLASH_TOUCH_TOL);

/**
 * Kontext, ve kterém se pravidla vyhodnocují: krok pohybové studie (`step`) a hodnota motoru na vazbě (`motorValue(id vazby)`).
 * Statická kontrola (poloha z dokumentu) krok nemá – pravidlo s oknem kroků v ní neplatí; okno hodnoty motoru se porovná
 * s hodnotou vazby v dokumentu.
 */
export type RuleCtx = { step?: number; motorValue?: (mateId: string) => number | undefined };

/** kontext statické kontroly: hodnoty vazeb z dokumentu */
export function staticRuleCtx(doc: Pick<CadDoc, "mates">): RuleCtx {
  return { motorValue: (id) => doc.mates?.find((m) => m.id === id)?.value };
}
/** kontext kroku studie: hodnota motoru, který pohání vazbu (jinak hodnota vazby v dokumentu) */
export function stepRuleCtx(doc: Pick<CadDoc, "mates" | "motion">, step: { i: number; motors: readonly number[] }): RuleCtx {
  return {
    step: step.i,
    motorValue: (id) => {
      const k = doc.motion?.motors.findIndex((m) => m.mate === id) ?? -1;
      return k >= 0 && step.motors[k] !== undefined ? step.motors[k] : doc.mates?.find((m) => m.id === id)?.value;
    },
  };
}

const startsWith = (path: readonly string[], pre: readonly string[]) => pre.length > 0 && pre.length <= path.length && pre.every((x, i) => path[i] === x);

/** dvojice spadá pod pravidlo (cesty listů začínají cestami pravidla, v libovolném pořadí; bez `b` = s čímkoli) */
export function ruleMatches(rule: Pick<ClashRule, "a" | "b">, p: Pick<ClashPair, "a" | "b" | "aPath" | "bPath">): boolean {
  const A = p.aPath ?? [p.a];
  const B = p.bPath ?? [p.b];
  const m = (x: readonly string[], y: readonly string[]) => startsWith(x, rule.a) && (!rule.b?.length || startsWith(y, rule.b));
  return m(A, B) || m(B, A);
}

/** platí pravidlo v kontextu `ctx`? (bez okna vždy; okno kroků jen v kroku studie; okno hodnoty motoru podle hodnoty) */
export function ruleActive(rule: Pick<ClashRule, "when">, ctx: RuleCtx): boolean {
  const w = rule.when;
  if (!w) return true;
  if (w.steps) {
    const [k0, k1] = w.steps[0] <= w.steps[1] ? w.steps : [w.steps[1], w.steps[0]];
    return ctx.step !== undefined && ctx.step >= k0 && ctx.step <= k1;
  }
  if (w.mate !== undefined) {
    const v = ctx.motorValue?.(w.mate);
    if (v === undefined || !Number.isFinite(v)) return false;
    const lo = Math.min(w.from ?? -Infinity, w.to ?? Infinity);
    const hi = Math.max(w.from ?? -Infinity, w.to ?? Infinity);
    const eps = 1e-9 * Math.max(1, Math.abs(v));
    return v >= lo - eps && v <= hi + eps;
  }
  return true;
}

/** dvojice, kterou jádro ještě nezařadilo (`cls` chybí) – bere se jako skutečná (slabší tvrzení) */
export type MaybeClassified = ClashPair & Partial<Omit<ClashDetail, keyof ClashPair>>;

/** třídy, které znamenají závadu (⚠): skutečná kolize a nevyhodnotitelná dvojice */
export const isFault = (c: ClashClass | undefined): boolean => c === undefined || c === "real" || c === "undetermined";

/**
 * Výsledné třídy dvojic po pravidlech dokumentu (pořadí a počet beze změny): dotyk → pravidlo závit → pracovní kontakt.
 * Nezařazená dvojice (bez `cls`) = skutečná.
 */
export function applyClashPolicy(list: readonly MaybeClassified[], doc: Pick<CadDoc, "clashRules" | "clashTol">, ctx: RuleCtx): ClashDetail[] {
  const tol = touchTol(doc);
  const rules = doc.clashRules ?? [];
  return list.map((x0) => {
    let x: ClashDetail = x0.cls ? (x0 as ClashDetail) : { ...x0, cls: "real", why: (x0.why ?? "no-thread") as ClashWhy };
    if ((x.cls === "real" || x.cls === "undetermined") && x.why !== "no-thread-feature" && x.depth !== undefined && x.depth < tol) x = { ...x, cls: "touch", why: "touch" };
    if (x.why === "no-thread-feature") {
      const r = rules.find((q) => q.kind === "thread" && ruleMatches(q, x) && ruleActive(q, ctx));
      if (r) x = { ...x, cls: x.bandCls ?? "thread", why: "thread-rule", rule: r.id };
    }
    if (x.cls === "real" || x.cls === "undetermined" || x.cls === "touch") {
      const r = rules.find((q) => q.kind === "work" && ruleMatches(q, x) && ruleActive(q, ctx));
      if (r) x = { ...x, cls: "work", why: "work-rule", rule: r.id };
    }
    return x;
  });
}

/** nové id pravidla (`r1`, `r2`… – krátké, stabilní v dokumentu) */
export function nextRuleId(doc: Pick<CadDoc, "clashRules">): string {
  const used = new Set((doc.clashRules ?? []).map((r) => r.id));
  for (let k = 1; ; k++) if (!used.has(`r${k}`)) return `r${k}`;
}

/** dokument s přidaným / odebraným pravidlem (čisté) */
export function withRule<T extends CadDoc>(doc: T, rule: Omit<ClashRule, "id"> & { id?: string }): T {
  const id = rule.id ?? nextRuleId(doc);
  return { ...doc, clashRules: [...(doc.clashRules ?? []), { ...rule, id }] };
}
export function withoutRule<T extends CadDoc>(doc: T, id: string): T {
  const rest = (doc.clashRules ?? []).filter((r) => r.id !== id);
  const { clashRules: _old, ...base } = doc;
  void _old;
  return (rest.length ? { ...base, clashRules: rest } : base) as T;
}
