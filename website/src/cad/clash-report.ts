/**
 * Zařazené kolize pro všechny výstupy (vlna 22, bod 5 zprávy majitele): protokol `kolize`, `stav`, řádek D, panel Kolize,
 * zvýraznění ve 3D, souhrn pohybové studie, `window.mncad.motion()`. Dřív zařazoval jen protokol enginu – panel, zvýraznění,
 * souhrn pohybu a `stav` pracovaly se surovými dvojicemi (šroub v závitu = „kolize“, „Horní skupina × Horní skupina“).
 *
 * Čisté funkce (bez jádra a Reactu), stejné v prohlížeči i v CLI:
 *  - popis instance listu: „Šroub M12 [S2]“ (přezdívka), „Šroub M12 #4“ (pořadí, když je název vícekrát), v podsestavě
 *    „Horní skupina › Šroub M12 [S1]“ – ne název komponenty nejvyšší úrovně;
 *  - místo průniku: těžiště a obálka ve světových souřadnicích (z `interference`, asm-kernel.ts);
 *  - výsledné třídy po pravidlech dokumentu (clash-rules.ts) a počty tříd;
 *  - seskupení opakovaných nálezů: stejná třída, stejné díly (bez instance), objem v toleranci 2 % → jedna skupina
 *    „4× „Přidržovač“ × „Šroub M12“ [#3, #4, #5, #6]“ (instance a místa zůstávají v položkách skupiny);
 *  - kolize pohybu po krocích: kroky se SKUTEČNOU kolizí, šrouby v závitu zvlášť, první skutečná kolize.
 */
import { fmtNum } from "@/lib/mesh-metrics";
import { countClasses, type ClashClass, type ClashCounts, type ClashDetail } from "./clash-class";
import { applyClashPolicy, isFault, staticRuleCtx, stepRuleCtx, touchTol, type MaybeClassified } from "./clash-rules";
import { getLang, tr } from "./i18n";
import type { AsmComponent, CadDoc, ClashRule, Placement, Vec3 } from "./types";
import type { BetweenHit, SweepInfo } from "./motion-clearance";
import { lostSpringComps } from "./spring-lost";
import { sweepKv, sweepLabel } from "./clearance-report";
import { fmtNum as kvNum } from "./engine/protocol";

/* ───────────────────────── popisy a čísla ───────────────────────── */

/** číslo podle jazyka bez zbytečných nul (souřadnice, rozměry) */
export const nf = (n: number, d = 2): string => {
  if (!Number.isFinite(n)) return "–";
  const s = String(Math.round(n * 10 ** d) / 10 ** d || 0);
  return getLang() === "en" ? s : s.replace(".", ",");
};
/** bod „[50; 30; 31,5]“ */
export const fmtPt = (v: Vec3, d = 2): string => `[${v.map((x) => nf(x, d)).join("; ")}]`;
/**
 * objem jako dřív v protokolu kolizí („365,2“, „1 135,2“); desetinný oddělovač podle jazyka (EN „365.2“ – dřív i v EN čárka,
 * kolo 6), seskupení tisíců mezerou ve všech jazycích
 */
export const fmtVol = (v: number): string => {
  const s = fmtNum(v, 1);
  return getLang() === "en" ? s.replace(",", ".") : s;
};

/** komponenta v seznamu sourozenců: „název [přezdívka]“, „název #k“ (stejný název vícekrát), jinak název */
function compLabel(comps: readonly AsmComponent[], c: AsmComponent): string {
  if (c.alias) return `${c.name} [${c.alias}]`;
  return comps.filter((x) => x.name === c.name).length > 1 ? `${c.name} #${comps.indexOf(c) + 1}` : c.name;
}

/** komponenty po cestě id (nejvyšší úroveň → list v podsestavě) */
function walk(doc: CadDoc, path: readonly string[]): { comps: readonly AsmComponent[]; c: AsmComponent }[] {
  const out: { comps: readonly AsmComponent[]; c: AsmComponent }[] = [];
  let comps: readonly AsmComponent[] = doc.components ?? [];
  for (const id of path) {
    const c = comps.find((x) => x.id === id);
    if (!c) break;
    out.push({ comps, c });
    comps = c.source.kind === "asm" ? (c.source.doc.components ?? []) : [];
  }
  return out;
}

/**
 * Popis instance listu sestavy: „Šroub M12 [S2]“, „Blok #2“, v podsestavě „Horní skupina › Šroub M12 [S1]“ (dřív u podsestavy
 * „Horní skupina“ × „Horní skupina“). Neznámá cesta = id.
 */
export function leafLabel(doc: CadDoc, path: readonly string[]): string {
  const w = walk(doc, path);
  if (!w.length) return path.join("/");
  return w.map((x) => compLabel(x.comps, x.c)).join(" › ");
}
/** název listu bez instance (klíč seskupení): „Horní skupina › Šroub M12“ */
export function leafName(doc: CadDoc, path: readonly string[]): string {
  const w = walk(doc, path);
  return w.length ? w.map((x) => x.c.name).join(" › ") : path.join("/");
}
/** cesta listu dvojice (bez cest z jádra = komponenta nejvyšší úrovně) */
export const pathA = (x: Pick<ClashDetail, "a" | "aPath">): string[] => x.aPath ?? [x.a];
export const pathB = (x: Pick<ClashDetail, "b" | "bPath">): string[] => x.bPath ?? [x.b];
/** id listu jako v `flattenLeaves` (cesta id „top/…/list“) – zvýraznění ve 3D */
export const leafIdOf = (path: readonly string[]): string => path.join("/");

/** popis místa průniku: „[50; 30; 31,5] · obálka 18 × 18 × 3 mm“ (bez údaje prázdné) */
export function placeText(x: Pick<ClashDetail, "at" | "box">): string {
  if (!x.at) return "";
  const b = x.box;
  const dims = b ? ` · ${tr("obálka {0} × {1} × {2} mm", nf(b[1][0] - b[0][0]), nf(b[1][1] - b[0][1]), nf(b[1][2] - b[0][2]))}` : "";
  return `${fmtPt(x.at)}${dims}`;
}

/** název třídy pro výpisy a panel */
export function className(c: ClashClass): string {
  switch (c) {
    case "real":
      return tr("skutečná kolize");
    case "undetermined":
      return tr("nevyhodnotitelné");
    case "thread":
      return tr("šroub v závitu");
    case "underhead":
      return tr("pod hlavou šroubu");
    case "touch":
      return tr("dotyk");
    case "work":
      return tr("pracovní kontakt");
  }
}
/** pořadí tříd ve výpisech (závady první) */
export const CLASS_ORDER: readonly ClashClass[] = ["real", "undetermined", "work", "touch", "underhead", "thread"];

/* ───────────────────────── výsledek statické kontroly ───────────────────────── */

/** záznam kontroly v `ws.asm.clash` (engine/workspace.ts) – jen to, co výstupy potřebují */
export type ClashEntryLike = { res: readonly MaybeClassified[]; list?: readonly MaybeClassified[] };

/**
 * Výsledné dvojice uložené kontroly po pravidlech dokumentu (poloha z dokumentu): geometrické zařazení z jádra (`list`), bez
 * něj surové dvojice jako nezařazené (= skutečné – slabší tvrzení, nikdy „šroub v závitu“ bez kontroly geometrie).
 */
export function entryClashes(entry: ClashEntryLike | null | undefined, doc: CadDoc): ClashDetail[] {
  if (!entry) return [];
  const base = entry.list && entry.list.length === entry.res.length ? entry.list : entry.res;
  return applyClashPolicy(base, doc, staticRuleCtx(doc));
}
/** počty tříd uložené kontroly po pravidlech dokumentu */
export const entryCounts = (entry: ClashEntryLike | null | undefined, doc: CadDoc): ClashCounts => countClasses(entryClashes(entry, doc));

/** listy (id „top/…/list“) a komponenty bez cesty, které mají ve 3D svítit jako kolize: jen závady (skutečné, nevyhodnotitelné) */
export function faultLeafIds(list: readonly ClashDetail[]): Set<string> {
  const out = new Set<string>();
  for (const x of list) {
    if (!isFault(x.cls)) continue;
    out.add(leafIdOf(pathA(x)));
    out.add(leafIdOf(pathB(x)));
  }
  return out;
}

/* ───────────────────────── seskupení ───────────────────────── */

export type ClashItem = ClashDetail & { la: string; lb: string; na: string; nb: string };
export type ClashGroup = {
  cls: ClashClass;
  why: ClashDetail["why"];
  /** díly bez instance (stejné u všech položek) */
  a: string;
  b: string;
  items: ClashItem[];
  /** největší / nejmenší objem položek (mm³) */
  volume: number;
  vmin: number;
  /** rozlišení instancí položek: „[S2]“, „#4“ (strana, kde se instance liší) */
  refs: string[];
};

/** relativní tolerance objemu pro seskupení „drobně odlišných“ nálezů */
const VOL_REL = 0.02;
const VOL_ABS = 0.05;
/** rozlišení instance z popisu: „Šroub M12 [S2]“ → „S2“, „Blok #2“ → „#2“ (bez rozlišení celý popis) */
const refOf = (label: string, name: string) => {
  const l = label.split(" › ").pop() ?? label;
  const n = name.split(" › ").pop() ?? name;
  const r = l.startsWith(n) ? l.slice(n.length).trim() : "";
  return r ? r.replace(/^\[(.*)\]$/, "$1") : l;
};

/**
 * Seskupí opakované nálezy: stejná třída a důvod, stejné díly (bez instance) a objem v toleranci 2 % (min. 0,05 mm³). Skupiny
 * jsou v pořadí tříd (závady první) a prvního výskytu.
 */
export function groupClashes(list: readonly ClashDetail[], doc: CadDoc): ClashGroup[] {
  const groups: ClashGroup[] = [];
  for (const x of list) {
    let la = leafLabel(doc, pathA(x));
    let lb = leafLabel(doc, pathB(x));
    let na = leafName(doc, pathA(x));
    let nb = leafName(doc, pathB(x));
    let y: ClashDetail = x;
    if (na.localeCompare(nb) > 0 || (na === nb && la.localeCompare(lb) > 0)) {
      [la, lb, na, nb] = [lb, la, nb, na];
      y = { ...x, a: x.b, b: x.a, ...(x.bPath ? { aPath: x.bPath } : {}), ...(x.aPath ? { bPath: x.aPath } : {}) };
      if (!x.bPath) delete y.aPath;
      if (!x.aPath) delete y.bPath;
    }
    const item: ClashItem = { ...y, la, lb, na, nb };
    const g = groups.find((q) => q.cls === y.cls && q.why === y.why && q.a === na && q.b === nb && Math.abs(q.items[0].volume - y.volume) <= Math.max(VOL_ABS, VOL_REL * q.items[0].volume));
    if (g) {
      g.items.push(item);
      g.volume = Math.max(g.volume, y.volume);
      g.vmin = Math.min(g.vmin, y.volume);
    } else groups.push({ cls: y.cls, why: y.why, a: na, b: nb, items: [item], volume: y.volume, vmin: y.volume, refs: [] });
  }
  for (const g of groups) {
    const ia = new Set(g.items.map((i) => i.la));
    const ib = new Set(g.items.map((i) => i.lb));
    // instance se liší na straně s více různými popisy (4 šrouby × 1 deska → reference šroubů)
    g.refs = g.items.length > 1 ? (ib.size >= ia.size ? g.items.map((i) => refOf(i.lb, i.nb)) : g.items.map((i) => refOf(i.la, i.na))) : [];
  }
  const ord = (c: ClashClass) => CLASS_ORDER.indexOf(c);
  return groups.map((g, i) => ({ g, i })).sort((p, q) => ord(p.g.cls) - ord(q.g.cls) || p.i - q.i).map((p) => p.g);
}

/** „„Přidržovač“ × „Šroub M12 [S2]““ nebo u skupiny „„Přidržovač“ × „Šroub M12“ [#3, #4]“ */
export function groupPairText(g: ClashGroup): string {
  if (g.items.length === 1) return `„${g.items[0].la}“ × „${g.items[0].lb}“`;
  return `„${g.a}“ × „${g.b}“ [${g.refs.join(", ")}]`;
}
/** objem skupiny: „365,2“ nebo „363,9–365,2“ */
export const groupVolText = (g: ClashGroup): string => (g.vmin < g.volume - 0.05 ? `${fmtVol(g.vmin)}–${fmtVol(g.volume)}` : fmtVol(g.volume));
/** místa položek skupiny: první s obálkou, další jen těžiště (nejvýš `max`) */
export function groupPlaces(g: ClashGroup, max = 3): string {
  const withAt = g.items.filter((i) => i.at);
  if (!withAt.length) return "";
  const pl = [placeText(withAt[0]), ...withAt.slice(1, max).map((i) => fmtPt(i.at!))];
  return withAt.length > max ? `${pl.join("; ")}; …` : pl.join("; ");
}

/** proč dvojici nejde vyhodnotit (text pro protokol a panel) */
export function undeterminedWhy(x: Pick<ClashDetail, "why" | "hole" | "note">): string {
  switch (x.why) {
    case "unknown-designation":
      return tr("neznámé označení závitu „{0}“ (jmenovitý průměr jen z označení M…)", x.hole?.designation ?? x.note ?? "");
    case "missing-component":
      return tr("komponenta dvojice v sestavě není");
    case "no-thread-feature":
      return tr("šroub Ø{0} v díře Ø{1} bez prvku závitu – zadejte díru se závitem (díra … závit {2}), nebo dvojici označte pravidlem „kolize pravidlo závit“", nf(x.hole?.D ?? 0), nf(2 * (x.hole?.r ?? 0)), x.hole?.designation ?? "M");
    default:
      return x.note ? `${tr("booleovská operace jádra selhala")} (${x.note})` : tr("booleovská operace jádra selhala");
  }
}

/**
 * Text jednoho nálezu (skupiny) do protokolu a panelu: „4× kolize „Přidržovač“ × „Šroub M12“ [#3, #4, #5, #6] (365,2 mm³) –
 * místo [15; 30; 31,5]; …“.
 */
/**
 * Pružina se ztracenou dosedací plochou (⚠ spring.lost) stojí v NEOVĚŘENÉ délce – kolize s ní to řekne u dvojice (bod 7, kolo 7:
 * dřív „kolize „Deska A“ × „Pružina“ (445,6 mm³)“ bez souvislosti s tím, že délka pružiny se nekontrolovala). Jen komponenty
 * nejvyšší úrovně (pružina sestavy). Bez takové pružiny prázdné.
 */
export function lostSpringNote(d: CadDoc, items: readonly Pick<ClashDetail, "a" | "b" | "aPath" | "bPath">[]): string {
  const lost = new Set(lostSpringComps(d).map((c) => c.id));
  if (!lost.size) return "";
  // pružina jako instance („Pružina #3“, „Pružina [P2]“) – víc pružin stejného názvu se rozliší (oponent kola 7: dřív holý název)
  const names = new Set(items.flatMap((x) => [pathA(x), pathB(x)].flatMap((p) => (p.length === 1 && lost.has(p[0]) ? [leafLabel(d, p)] : []))));
  return [...names].map((n) => tr(" · pružina „{0}“ v neověřené délce (ztracená dosedací plocha – spring.lost)", n)).join("");
}

export function groupText(g: ClashGroup, doc: CadDoc): string {
  const n = g.items.length > 1 ? `${g.items.length}× ` : "";
  const where = groupPlaces(g);
  const place = (where ? ` – ${tr("místo")} ${where}` : "") + (isFault(g.cls) ? lostSpringNote(doc, g.items) : "");
  const pair = groupPairText(g);
  switch (g.cls) {
    case "real":
      return `${n}${tr("kolize {0} ({1} mm³)", pair, groupVolText(g))}${place}`;
    case "undetermined":
      return `${n}${tr("kolizi {0} nelze vyhodnotit", pair)}: ${undeterminedWhy(g.items[0])}${place}`;
    case "work": {
      const r = (doc.clashRules ?? []).find((q) => q.id === g.items[0].rule);
      return `${n}${tr("pracovní kontakt {0} ({1} mm³) – pravidlo {2}", pair, groupVolText(g), r ? ruleText(doc, r) : (g.items[0].rule ?? "?"))}${place}`;
    }
    case "touch":
      return `${n}${tr("dotyk {0} – přesah {1} mm pod tolerancí {2} mm", pair, nf(Math.max(...g.items.map((i) => i.depth ?? 0)), 4), nf(touchTol(doc), 6))}${place}`;
    case "underhead":
      return `${n}${tr("prstenec pod hlavou šroubu {0}", pair)}`;
    case "thread":
      return `${n}${tr("šroub v závitu {0}", pair)}${g.why === "thread-rule" ? ` (${tr("pravidlo závit")})` : ""}`;
  }
}

/* ───────────────────────── stav a souhrny ───────────────────────── */

/**
 * počty tříd ve tvaru řádku D a `stav` (`5(thread=3,real=2)`; pod hlavou, nevyhodnotitelné, dotyk a pracovní kontakt jen
 * nenulové – stejný tvar jako `clash=` řádku D v engine/protocol.ts)
 */
export const clashCountsKv = (c: ClashCounts): string =>
  `${c.total}(thread=${c.thread}${c.underhead ? `,underhead=${c.underhead}` : ""},real=${c.real}${c.undetermined ? `,undetermined=${c.undetermined}` : ""}${c.touch ? `,touch=${c.touch}` : ""}${c.work ? `,work=${c.work}` : ""})`;

/** „skutečné 2 · šroub v závitu 3 · dotyk 1“ – jen nenulové třídy, závady první (prázdné = „žádné“) */
export function countsText(c: ClashCounts): string {
  const parts: string[] = [];
  const add = (n: number | undefined, label: string) => {
    if (n) parts.push(`${label} ${n}`);
  };
  add(c.real, tr("skutečné"));
  add(c.undetermined, tr("nevyhodnotitelné"));
  add(c.work, tr("pracovní kontakt"));
  add(c.touch, tr("dotyk"));
  add(c.underhead, tr("pod hlavou"));
  add(c.thread, tr("šroub v závitu"));
  return parts.join(" · ") || tr("žádné");
}

/**
 * Řádky stavu dokumentu (`stav`, AsmStatus.clash.pairs): nejdřív závady po skupinách s instancí a místem, pak počty ostatních tříd.
 * Šrouby v závitu seznam nezahltí – jen počet.
 */
export function statusPairs(list: readonly ClashDetail[], doc: CadDoc, max = 12): string[] {
  const groups = groupClashes(list, doc);
  const faults = groups.filter((g) => isFault(g.cls));
  const c = countClasses(list);
  const out: string[] = [];
  // „Blok #1 × Blok #2 (16 000,0 mm³) v [35; 20; 20]“, skupina „4× Přidržovač × Šroub M12 [#3, #4, #5, #6] (365,2 mm³) v […]“
  const one = (g: ClashGroup) => {
    const i = g.items[0];
    const pair = g.items.length > 1 ? `${g.items.length}× ${g.a} × ${g.b} [${g.refs.join(", ")}]` : `${i.la} × ${i.lb}`;
    return `${pair} (${groupVolText(g)} mm³)${i.at ? ` ${tr("v místě {0}", fmtPt(i.at))}` : ""}${g.cls === "undetermined" ? ` – ${tr("nelze vyhodnotit")}` : ""}`;
  };
  const fl = faults.slice(0, max).map(one);
  if (faults.length > max) fl.push(tr("… a další {0}", faults.length - max));
  const head = [c.real ? tr("skutečné {0}", c.real) : "", c.undetermined ? tr("nevyhodnotitelné {0}", c.undetermined) : ""].filter(Boolean).join(", ");
  if (fl.length) out.push(`${head}: ${fl[0]}`, ...fl.slice(1));
  const rest = countsText({ ...c, real: 0, undetermined: 0 });
  if (rest !== tr("žádné")) out.push(rest);
  return out;
}

/* ───────────────────────── pravidla – texty ───────────────────────── */

/** text pravidla: „r1 pracovní kontakt „Razník“ × „Plech“ v krocích 10–20“ */
export function ruleText(doc: CadDoc, r: ClashRule): string {
  const a = leafLabel(doc, r.a);
  const b = r.b?.length ? leafLabel(doc, r.b) : tr("cokoli");
  const kind = r.kind === "work" ? tr("pracovní kontakt") : tr("závit bez prvku");
  const w = r.when;
  let when = tr("vždy");
  if (w?.steps) when = tr("v krocích {0}–{1}", w.steps[0], w.steps[1]);
  else if (w?.mate !== undefined) {
    const m = doc.mates?.find((x) => x.id === w.mate);
    when = tr("při hodnotě vazby „{0}“ {1}–{2}", m?.name ?? w.mate, nf(w.from ?? -Infinity, 3), nf(w.to ?? Infinity, 3));
  }
  return `${r.id} ${kind} „${a}“ × „${b}“ ${when}${r.note ? ` (${r.note})` : ""}`;
}

/* ───────────────────────── pohybová studie ───────────────────────── */

/**
 * krok studie s kolizemi (jen to, co souhrn potřebuje – MotionStep z cad/motion.ts); `between` = mezipoloha ze zjemnění úseku
 * (kontakt nalezený mezi kroky, vlna 22 bod 6 – `i` je pak zlomek kroku)
 */
export type ClashStep = { i: number; t: number; motors: readonly number[]; clashes?: readonly MaybeClassified[]; place?: Record<string, Placement>; between?: [number, number] };
/** výsledek studie (MotionResult z cad/motion.ts); `sweep` / `between` = spojitost kontroly a kontakty mezi kroky (motion-clearance.ts) */
export type ClashStudy = { steps: readonly ClashStep[]; collisionsChecked: boolean; sweep?: SweepInfo; between?: readonly BetweenHit[]; /** sledovaná vůle (motion-clearance.ts) – bez ní souhrn říká „vůle nekontrolována“ */ clearance?: unknown };
/** kontakty mezi kroky jako mezipolohy s kolizemi (seřazené podle polohy) */
export const betweenSteps = (res: ClashStudy): ClashStep[] => (res.between ?? []).map((h) => ({ i: h.pos, t: h.t, motors: h.motors, clashes: h.clashes, between: [h.k0, h.k1] as [number, number] }));

/** výsledné třídy dvojic kroku po pravidlech dokumentu (okno kroků / hodnota motoru) */
export const stepClashes = (doc: CadDoc, s: ClashStep): ClashDetail[] => (s.clashes?.length ? applyClashPolicy(s.clashes, doc, stepRuleCtx(doc, s)) : []);
/** má krok závadu (skutečnou / nevyhodnotitelnou kolizi)? – štítek kroku v panelu pohybu */
export const stepHasFault = (doc: CadDoc, s: ClashStep | undefined): boolean => !!s && stepClashes(doc, s).some((x) => isFault(x.cls));

/** první závada studie: krok, čas, dvojice s popisy instancí, třída, místo (window.mncad.motion().collision) */
export function firstFault(res: ClashStudy, doc: CadDoc): { step: number; t: number; a: string; b: string; volume: number; cls: ClashClass; at?: Vec3; aPath?: string[]; bPath?: string[]; between?: [number, number] } | null {
  // kroky i kontakty nalezené mezi kroky (zjemnění, vlna 22 bod 6) podle polohy
  for (const s of [...res.steps, ...betweenSteps(res)].sort((x, y) => x.i - y.i)) {
    const x = stepClashes(doc, s).find((y) => isFault(y.cls));
    if (x) return { step: s.i, t: s.t, a: leafLabel(doc, pathA(x)), b: leafLabel(doc, pathB(x)), volume: x.volume, cls: x.cls, ...(x.at ? { at: x.at } : {}), ...(x.aPath ? { aPath: x.aPath } : {}), ...(x.bPath ? { bPath: x.bPath } : {}), ...(s.between ? { between: s.between } : {}) };
  }
  return null;
}

/** počty kolizí studie pro strojový řádek `= … motion …` (kroky se ZÁVADOU, šrouby v závitu zvlášť, dotyk / pracovní kontakt) */
export type MotionClashStats = {
  steps: number;
  of: number;
  thread: number;
  real: number;
  firstReal: number | null;
  touch?: number;
  work?: number;
  /** spojitost kontroly (vlna 22, bod 6): pole `clash.mode= clash.poses= clash.refined= clash.maxstep= [clash.unproven=]` */
  sweep?: string[];
  /** kontakty se závadou nalezené mezi kroky a poloha prvního (zlomek kroku) */
  between?: number;
  firstBetween?: number;
};
/** strojová část kolizí řádku pohybu (stejná v cs/en/de); dotyk / pracovní kontakt, spojitost a kontakty mezi kroky na konci */
export const motionClashKv = (cl: MotionClashStats): string[] => [
  `clash.steps=${cl.steps}/${cl.of}`,
  `thread=${cl.thread}`,
  `real=${cl.real}`,
  ...(cl.firstReal !== null ? [`first.real=${cl.firstReal}`] : []),
  ...(cl.touch ? [`touch=${cl.touch}`] : []),
  ...(cl.work ? [`work=${cl.work}`] : []),
  ...(cl.sweep ?? []),
  ...(cl.between ? [`clash.between=${cl.between}`, `first.between=${kvNum(cl.firstBetween ?? 0, 3)}`] : []),
];

/** záznam s kódem pro protokol (AsmResult.codes) */
export type ClashCode = { code: string; args?: unknown[]; text?: string };

/**
 * Kolize pohybové studie podle tříd: šroub v závitu = ℹ `clash.thread` (jeden záznam za studii), skutečná / nevyhodnotitelná
 * kolize = ⚠ za každou skupinu dílů (první krok, počet kroků, instance, místo, největší průnik), pracovní kontakt = ℹ `clash.work`,
 * dotyk = ℹ `clash.touch`. „Kroků se skutečnou kolizí“ počítá jen kroky se závadou (dřív i kroky se šroubem v závitu).
 */
export function motionClashSummary(res: ClashStudy, d: CadDoc, o: { every?: number } = {}): { lines: string[]; codes: ClashCode[]; stats: MotionClashStats } {
  const checked = res.steps.filter((s) => s.clashes !== undefined).length;
  const of = checked || res.steps.length;
  const sampled = of < res.steps.length && o.every !== undefined;
  const sample = sampled ? tr(" kolize kontrolovány v {0} snímcích z {1} (každý {2}. a poslední) – hustotu určuje pohyb kroky N", of, res.steps.length, o.every) : null;
  // jak se kontrolovalo (vlna 22, bod 6): diskrétně v polohách × spojitě i mezi nimi × částečně – nikdy „ve všech krocích“ bez kvalifikace
  const how = ` ${sweepLabel({ steps: res.steps, collisionsChecked: res.collisionsChecked, ...(res.sweep ? { sweep: res.sweep } : {}) } as never)}`;
  const threadPairs = new Set<string>();
  const threadSteps: number[] = [];
  type G = { cls: ClashClass; na: string; nb: string; step: number; t: number; steps: Set<number>; pairs: Map<string, { la: string; lb: string }>; volume: number; at?: Vec3; rule?: string; between?: [number, number]; motors?: readonly number[] };
  const groups = new Map<string, G>();
  const faultSteps = new Set<number>();
  const quiet = { touch: new Set<string>(), work: new Set<string>() };
  // kroky a kontakty nalezené mezi kroky (zjemnění úseku) podle polohy
  const mids = betweenSteps(res);
  let betweenFaults = 0;
  let firstBetween: number | null = null;
  for (const s of [...res.steps, ...mids].sort((x, y) => x.i - y.i)) {
    if (!s.clashes?.length) continue;
    let midFault = false;
    for (const c of stepClashes(d, s)) {
      const pk = `${leafIdOf(pathA(c))}|${leafIdOf(pathB(c))}`;
      if (c.cls === "thread" || c.cls === "underhead") {
        threadPairs.add(pk);
        if (!s.between && threadSteps[threadSteps.length - 1] !== s.i) threadSteps.push(s.i);
        continue;
      }
      if (c.cls === "touch" || c.cls === "work") quiet[c.cls].add(pk);
      if (isFault(c.cls)) {
        if (s.between) midFault = true;
        else faultSteps.add(s.i);
      }
      let [na, nb] = [leafName(d, pathA(c)), leafName(d, pathB(c))];
      let [la, lb] = [leafLabel(d, pathA(c)), leafLabel(d, pathB(c))];
      if (na.localeCompare(nb) > 0) [na, nb, la, lb] = [nb, na, lb, la];
      const k = `${c.cls}\u0000${na}\u0000${nb}`;
      const g = groups.get(k) ?? { cls: c.cls, na, nb, step: s.i, t: s.t, steps: new Set<number>(), pairs: new Map(), volume: 0, ...(c.at ? { at: c.at } : {}), ...(c.rule ? { rule: c.rule } : {}), ...(s.between ? { between: s.between, motors: s.motors } : {}) };
      if (!s.between) g.steps.add(s.i);
      g.pairs.set(pk, { la, lb });
      if (c.volume > g.volume) g.volume = c.volume;
      groups.set(k, g);
    }
    if (midFault) {
      betweenFaults++;
      if (firstBetween === null) firstBetween = s.i;
    }
  }
  const n3 = (v: number) => nf(v, 3);
  const span = (list: number[]) => (list.length ? (list.length > 1 ? `${list[0]}–${list[list.length - 1]}` : String(list[0])) : "");
  const range = span(threadSteps);
  const all = [...groups.values()].sort((x, y) => x.step - y.step || x.na.localeCompare(y.na));
  const faults = all.filter((g) => isFault(g.cls));
  const first = faults.find((g) => !g.between) ?? null;
  const stats: MotionClashStats = {
    steps: faultSteps.size,
    of,
    thread: threadPairs.size,
    real: faults.length,
    firstReal: first ? first.step : null,
    ...(quiet.touch.size ? { touch: quiet.touch.size } : {}),
    ...(quiet.work.size ? { work: quiet.work.size } : {}),
    sweep: sweepKv({ steps: res.steps, collisionsChecked: res.collisionsChecked, ...(res.sweep ? { sweep: res.sweep } : {}) } as never),
    ...(betweenFaults ? { between: betweenFaults, firstBetween: firstBetween ?? 0 } : {}),
  };
  // „žádný průnik v N polohách“ + jak se kontrolovalo (dřív „Kolize: žádné ve všech krocích“ i při průchodu mezi kroky)
  // bez sledované vůle výslovně „vůle nekontrolována“ (vlna 22, bod 6 – nulový průnik není provozní vůle; jako statická `kolize`)
  const clrNote = res.clearance ? "" : tr(" · vůle nekontrolována (pohyb vůle \"A\" \"B\" min 0,05 | pohyb vůle pohyblivé min 0,05)");
  if (!all.length && !threadPairs.size) return { lines: [(sampled ? tr("Kolize: žádný průnik v kontrolovaných snímcích") : tr("Kolize: žádný průnik v {0} polohách", of)) + clrNote, ...(sample ? [sample] : []), how], codes: [], stats };
  const extra = [quiet.work.size ? tr(" · pracovní kontakt {0} dvojic", quiet.work.size) : "", quiet.touch.size ? tr(" · dotyk {0} dvojic", quiet.touch.size) : "", betweenFaults ? tr(" · mezi kroky (zjemněno) {0}×", betweenFaults) : ""].join("");
  const lines = [
    // „kroků s kolizí“ = kroky se SKUTEČNOU (nebo nevyhodnotitelnou) kolizí; šrouby v závitu jsou v textu zvlášť (vlna 22, bod 5)
    `${tr("Kolize v pohybu: kroků s kolizí {0} z {1} · šroub v závitu {2} dvojic{3} · skutečné: {4}", faultSteps.size, of, threadPairs.size, range ? tr(" (kroky {0})", range) : "", faults.length ? (first ? tr("{0} dvojic dílů v {1} krocích, první v kroku {2}", faults.length, faultSteps.size, first.step) : tr("{0} dvojic dílů jen mezi kroky (nalezeno zjemněním)", faults.length)) : tr("žádné"))}${extra}`,
    ...(sample ? [sample] : []),
    how,
  ];
  const codes: ClashCode[] = [];
  if (threadPairs.size) codes.push({ code: "clash.thread", text: tr("šroub v závitu: {0} dvojic v krocích {1}", threadPairs.size, range) });
  const pairText = (g: G) => {
    const ps = [...g.pairs.values()];
    if (ps.length === 1) return { a: ps[0].la, b: ps[0].lb };
    const refsB = new Set(ps.map((p) => p.lb));
    const refs = refsB.size >= new Set(ps.map((p) => p.la)).size ? ps.map((p) => refOf(p.lb, g.nb)) : ps.map((p) => refOf(p.la, g.na));
    return { a: g.na, b: `${g.nb} [${refs.join(", ")}]` };
  };
  const MAX = 8;
  for (const g of faults.slice(0, MAX)) {
    const p = pairText(g);
    const code = g.cls === "undetermined" ? "clash.undetermined" : "clash.real";
    if (g.between) {
      // kontakt nalezený zjemněním mezi kroky (diskrétní kontrola by ho minula)
      const place = g.at ? ` – ${tr("místo")} ${fmtPt(g.at)}` : "";
      codes.push({ code, text: `${tr("v pohybu „{0}“ × „{1}“ mezi kroky {2} a {3} (zjemněno: poloha {4}, t = {5} s, motory {6}): průnik {7} mm³ – v krocích samotných není", p.a, p.b, g.between[0], g.between[1], n3(g.step), n3(g.t), (g.motors ?? []).map((v) => n3(v)).join("; "), n3(g.volume))}${place}` });
      continue;
    }
    const place = g.at ? ` – ${tr("místo")} ${fmtPt(g.at)} ${tr("v kroku {0}", g.step)}` : "";
    codes.push({ code, text: `${tr("v pohybu „{0}“ × „{1}“ od kroku {2} (t = {3} s): kroků {4}, dvojic komponent {5}, největší průnik {6} mm³", p.a, p.b, g.step, n3(g.t), g.steps.size, g.pairs.size, n3(g.volume))}${place}` });
  }
  if (faults.length > MAX) codes.push({ code: "clash.real", text: tr("v pohybu další dvojice dílů s kolizí: {0} – pohyb krok N je vypíše", faults.length - MAX) });
  for (const g of all.filter((x) => x.cls === "work")) {
    const steps = [...g.steps].sort((x, y) => x - y);
    // kontakt jen mezi kroky (zjemnění): „mezi kroky 0 a 1“ – dřív „v krocích mezi kroky“
    if (!steps.length && g.between) codes.push({ code: "clash.work", text: tr("pracovní kontakt „{0}“ × „{1}“ mezi kroky {2} a {3} (pravidlo {4}), největší průnik {5} mm³", g.na, g.nb, g.between[0], g.between[1], g.rule ?? "?", n3(g.volume)) });
    else codes.push({ code: "clash.work", text: tr("pracovní kontakt „{0}“ × „{1}“ v krocích {2} (pravidlo {3}), největší průnik {4} mm³", g.na, g.nb, span(steps) || tr("mezi kroky"), g.rule ?? "?", n3(g.volume)) });
  }
  if (quiet.touch.size) codes.push({ code: "clash.touch", text: tr("dotyk pod tolerancí {0} mm: {1} dvojic", nf(touchTol(d), 6), quiet.touch.size) });
  return { lines, codes, stats };
}

/** buňka „Kolize“ CSV studie: dvojice s instancí a třídou (prázdné = bez kolize, „nekontrolováno“ = snímek bez kontroly) */
export function clashCsvCell(d: CadDoc, s: ClashStep): string {
  if (s.clashes === undefined) return tr("nekontrolováno");
  return stepClashes(d, s)
    .map((x) => `${leafLabel(d, pathA(x))} × ${leafLabel(d, pathB(x))} (${className(x.cls)})`)
    .join(", ");
}

/** kolize kroků pro `window.mncad.motion()`: dvojice s popisy instancí, třídou, objemem a místem */
export function apiStepClashes(d: CadDoc, s: ClashStep): { a: string; b: string; cls: ClashClass; volume: number; at?: Vec3 }[] {
  return stepClashes(d, s).map((x) => ({ a: leafLabel(d, pathA(x)), b: leafLabel(d, pathB(x)), cls: x.cls, volume: x.volume, ...(x.at ? { at: x.at } : {}) }));
}

/** řádky a kódy kolizí jednoho kroku (`pohyb krok N`): závady ⚠ po dvojicích s instancí a místem, ostatní třídy jako řádek */
export function stepClashReport(d: CadDoc, s: ClashStep): { lines: string[]; codes: ClashCode[] } {
  const list = stepClashes(d, s);
  const lines: string[] = [];
  const codes: ClashCode[] = [];
  const by = (c: ClashClass) => list.filter((x) => x.cls === c).map((x) => `${leafLabel(d, pathA(x))} × ${leafLabel(d, pathB(x))}`);
  const thr = [...by("thread"), ...by("underhead")];
  if (thr.length) lines.push(tr(" kolize šroub v závitu: {0}", thr.join(", ")));
  if (by("work").length) lines.push(tr(" pracovní kontakt: {0}", by("work").join(", ")));
  if (by("touch").length) lines.push(tr(" dotyk: {0}", by("touch").join(", ")));
  for (const x of list.filter((y) => isFault(y.cls))) {
    const a = leafLabel(d, pathA(x));
    const b = leafLabel(d, pathB(x));
    const place = (x.at ? ` – ${tr("místo")} ${placeText(x)}` : "") + lostSpringNote(d, [x]);
    if (x.cls === "real") codes.push({ code: "clash.real", args: [a, b, fmtVol(x.volume)], text: `${tr("kolize „{0}“ × „{1}“ ({2} mm³)", a, b, fmtVol(x.volume))}${place}` });
    else codes.push({ code: "clash.undetermined", args: [a, b], text: `${tr("kolizi „{0}“ × „{1}“ nelze vyhodnotit", a, b)}: ${undeterminedWhy(x)}${place}` });
  }
  return { lines, codes };
}
