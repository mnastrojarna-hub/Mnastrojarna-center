/**
 * Výsledky pohybové studie podle dokumentu a jeho stavu (vlna 22, bod 1 a 12 zprávy – „žádné falešně zelené“):
 *
 * * **otisk vstupu** `motionSig(doc)`: komponenty (poloha, ukotvení, skrytí, pružina), **obsah podsestav** (polohy, ukotvení, skrytí,
 *   pružiny a vazby vnořených komponent do libovolné hloubky), **geometrie listových dílů** (`sourceKey` – prvky, proměnné, vazby
 *   parametrů a konfigurace dílu; i dílů v podsestavách), vazby a definice studie; u dynamiky navíc **materiál každého listového
 *   dílu** (hmotnost = objem × hustota). Výsledek platí jen pro otisk, pro který vznikl – po změně dílu, polohy (i uvnitř
 *   podsestavy), vazby, studie nebo materiálu (dynamika) je `stale`, v jiném dokumentu `unchecked`;
 * * **úložiště podle pracovního prostoru a dokumentu** (`motionStoreOf(ws.asm)` → klíč dokumentu `Workspace.docKey`): výsledek
 *   jedné sestavy se nikdy neukáže u jiné (ani u sestavy téhož názvu nebo se stejnými id komponent);
 * * **jeden výpočet na dokument**: výpočet JINÉHO vstupu předchozí ruší (`MotionSuperseded`); druhé volání se STEJNÝM vstupem
 *   (panel + textový příkaz, dvakrát `window.mncad.motion()`) se k běžícímu výpočtu připojí a dostane tentýž výsledek. Výsledek se
 *   uloží jen pod otiskem SVÉHO vstupu a nikdy přes novější záznam – opožděná odpověď staršího výpočtu nic nepřepíše.
 *
 * Panel studie, příkazy `pohyb …`, `stav` i `window.mncad.motion()` čtou stav odtud (`motionState`). Otisk je místní funkce –
 * společná identita výsledků (engine/result-key.ts, balík A) ji může nahradit beze změny volajících.
 */
import { flattenAssembly, MAX_DEPTH } from "./assembly";
import { stepHasFault } from "./clash-report";
import { betweenFaultCount, clearanceBelowCount, clearanceStatusText } from "./clearance-report";
import { tr } from "./i18n";
import { motionMotorNotes, type MotionResult } from "./motion";
import { clearanceOf } from "./motion-clearance";
import { massMaterialId } from "./motion-mass";
import { processStatusText, processWarnCount } from "./motion-process";
import type { CadDoc, MotionStudy } from "./types";

/**
 * části otisku (pro hlášení, CO se od výpočtu změnilo): `nested` = obsah podsestav nejvyšší úrovně (id komponenty → klíč obsahu),
 * `mass` = materiál listových dílů (jen dynamika – kinematika na hmotnosti nezávisí)
 */
export type MotionSigParts = { study: string; mates: string; place: string; geo: [path: string, key: string, hidden: 0 | 1][]; nested: [id: string, key: string][]; mass: [path: string, material: string][] };
export type MotionEntry = {
  sig: string;
  parts: MotionSigParts;
  res: MotionResult;
  /** pořadí výpočtu (novější = vyšší) */
  seq: number;
  /** čas dokončení [ms] */
  at: number;
  /** název dokumentu a počet komponent, pro které výpočet proběhl */
  doc: string;
  comps: number;
};
/**
 * běžící výpočet: `waiters` = dotazy na zrušení všech volajících (výpočet se zruší, až když ho zruší všichni), `listeners` = průběh
 * pro všechny připojené volající, `promise` = sdílený výsledek
 */
type Running = { sig: string; seq: number; superseded: boolean; waiters: ((() => boolean) | null)[]; listeners: Set<(k: number, n: number) => void>; promise: Promise<MotionResult> };
export type MotionStore = { byDoc: Map<string, MotionEntry>; running: Map<string, Running>; seq: number };
/** přístup k úložišti z prostředí sestavy (`AsmEnv.motion`): úložiště pracovního prostoru a klíč dokumentu */
export type MotionSlot = { key: string; store: MotionStore };

/** výpočet nahradil novější výpočet téže sestavy (jiný vstup) – jeho výsledek se zahazuje */
export class MotionSuperseded extends Error {
  constructor() {
    // jen výpočet JINÉHO vstupu (nebo zahozený dokument) – stejný vstup se k běžícímu výpočtu připojí (`runStored`)
    super(tr("výpočet pohybové studie nahradil novější výpočet (sestava nebo studie se mezitím změnila)"));
    this.name = "MotionSuperseded";
  }
}

/** nejvýš tolik dokumentů s uloženým výsledkem na pracovní prostor (nejstarší výpočty se zahazují → „nezkontrolováno“) */
const MAX_DOCS = 12;
const stores = new WeakMap<object, MotionStore>();
/** úložiště výsledků pro vlastníka (pracovní prostor `ws.asm`; v testech mezipaměť geometrie prostředí) */
export function motionStoreOf(owner: object): MotionStore {
  let s = stores.get(owner);
  if (!s) stores.set(owner, (s = { byDoc: new Map(), running: new Map(), seq: 0 }));
  return s;
}
/** úložiště a klíč dokumentu prostředí; prostředí bez nich (jednotkové testy) má vlastní úložiště s jedním dokumentem */
export const motionSlot = (env: { motion?: MotionSlot; geo: object }): MotionSlot => env.motion ?? { key: "", store: motionStoreOf(env.geo) };

/* ───────── změny úložiště (panel studie se překreslí) ───────── */
let version = 0;
const subs = new Set<() => void>();
const bump = () => {
  version++;
  subs.forEach((f) => f());
};
export const motionStoreVersion = () => version;
export function subscribeMotionStore(f: () => void): () => void {
  subs.add(f);
  return () => void subs.delete(f);
}

/* ───────── otisk vstupu ───────── */

/** definice studie pro otisk: kinematika nezávisí na nastavení dynamiky, přehrávání ve smyčce na výsledek nemá vliv */
function studyKey(s: MotionStudy | undefined): string {
  if (!s) return "";
  // pohledy, video a anotace (vlna 22, bod 13–14) jsou jen zobrazení – po jejich změně výsledek dál platí
  const { loop: _loop, dyn, views: _v, view: _a, video: _vi, annot: _an, ...rest } = s;
  void [_loop, _v, _a, _vi, _an];
  return JSON.stringify(s.mode === "dynamic" ? { ...rest, dyn } : rest);
}
/**
 * Klíč obsahu podsestavy: polohy, ukotvení, skrytí a pružiny vnořených komponent, vazby podsestavy, rekurzivně (posun dílu UVNITŘ
 * podsestavy změní polohu listu v sestavě – dřív otisk znal jen polohy komponent nejvyšší úrovně a výsledek dál „platil“).
 * Geometrii listových dílů nese `geo` (`sourceKey`).
 */
function subKey(d: CadDoc, depth: number): string {
  if (depth > MAX_DEPTH) return "cycle";
  return JSON.stringify({
    c: (d.components ?? []).map((c) => [c.id, c.placement, c.fixed ?? null, c.hidden ?? null, c.spring ?? null, c.source.kind === "asm" ? subKey(c.source.doc, depth + 1) : null]),
    m: d.mates ?? [],
  });
}
const memo = new WeakMap<CadDoc, { sig: string; parts: MotionSigParts }>();
/** otisk a jeho části pro dokument (pamatuje se podle objektu dokumentu – dokumenty se nemění na místě) */
export function motionSigParts(d: CadDoc): { sig: string; parts: MotionSigParts } {
  const hit = memo.get(d);
  if (hit) return hit;
  const flat = flattenAssembly(d);
  const parts: MotionSigParts = {
    study: studyKey(d.motion),
    mates: JSON.stringify(d.mates ?? []),
    place: JSON.stringify((d.components ?? []).map((c) => [c.id, c.placement, c.fixed, c.hidden, c.spring ?? null])),
    geo: flat.map((l) => [l.path.join("/"), l.key, l.hidden ? 1 : 0]),
    nested: (d.components ?? []).flatMap((c): [string, string][] => (c.source.kind === "asm" ? [[c.id, subKey(c.source.doc, 1)]] : [])),
    // dynamika: hmotnost listu = objem × hustota materiálu (motion-mass.ts massMaterialId – táž definice jako výpočet hmotností)
    mass: d.motion?.mode === "dynamic" ? flat.map((l): [string, string] => [l.path.join("/"), massMaterialId(l.comp)]) : [],
  };
  const out = { sig: JSON.stringify(parts), parts };
  memo.set(d, out);
  return out;
}
/** Otisk vstupu pohybové studie: jiný otisk = uložený výsledek pro tento stav sestavy neplatí. */
export const motionSig = (d: CadDoc): string => motionSigParts(d).sig;

/** Co se od výpočtu změnilo (slovy, v aktuálním jazyce): geometrie dílů jmenovitě, polohy, vazby, definice studie. */
export function motionChanges(before: MotionSigParts, d: CadDoc): string[] {
  const now = motionSigParts(d).parts;
  const out: string[] = [];
  // geometrie = klíč obsahu dílu (skrytí patří k poloze / stavu komponent níže)
  const old = new Map(before.geo.map(([p, k]) => [p, k]));
  const cur = new Map(now.geo.map(([p, k]) => [p, k]));
  const name = (path: string) => {
    let comps = d.components ?? [];
    let n = path;
    for (const id of path.split("/")) {
      const c = comps.find((x) => x.id === id);
      if (!c) break;
      n = c.name;
      comps = c.source.kind === "asm" ? (c.source.doc.components ?? []) : [];
    }
    return n;
  };
  const list = (names: string[]) => names.slice(0, 4).map((n) => `„${n}“`).join(", ") + (names.length > 4 ? tr(" a dalších {0}", names.length - 4) : "");
  /** cesty, jejichž hodnota se změnila (jen ty, které jsou před i po) */
  const diff = (a: [string, string][], b: [string, string][]) => {
    const was = new Map(a);
    return [...new Set(b.filter(([p, v]) => was.has(p) && was.get(p) !== v).map(([p]) => name(p)))];
  };
  const changed = diff([...old], [...cur]);
  if (changed.length) out.push(tr("geometrie dílu {0}", list(changed)));
  if (cur.size !== old.size || [...cur.keys()].some((p) => !old.has(p))) out.push(tr("počet dílů ({0} → {1})", old.size, cur.size));
  if (before.place !== now.place) out.push(tr("poloha, ukotvení nebo skrytí komponent"));
  // starší záznam bez nových částí otisku (stejný běh aplikace – jen pro jistotu) se bere jako prázdný
  const subs = diff(before.nested ?? [], now.nested);
  if (subs.length) out.push(tr("poloha, ukotvení, skrytí nebo vazby komponent v podsestavě {0}", list(subs)));
  const mats = diff(before.mass ?? [], now.mass);
  if (mats.length) out.push(tr("materiál dílu {0} (hmotnost v dynamice)", list(mats)));
  if (before.mates !== now.mates) out.push(tr("vazby"));
  if (before.study !== now.study) out.push(tr("definice studie (motory, délka, kroky)"));
  return out.length ? out : [tr("stav sestavy")];
}

/* ───────── stav výsledku ───────── */

export type MotionState = { state: "ok"; entry: MotionEntry } | { state: "stale"; entry: MotionEntry; changed: string[] } | { state: "unchecked" };

/** Stav uloženého výsledku pro dokument `d` pod klíčem `key`: platí / neplatí (a co se změnilo) / nespočítáno. */
export function motionStateOf(store: MotionStore, key: string, d: CadDoc): MotionState {
  const e = store.byDoc.get(key);
  if (!e) return { state: "unchecked" };
  if (e.sig === motionSig(d)) return { state: "ok", entry: e };
  return { state: "stale", entry: e, changed: motionChanges(e.parts, d) };
}
export const motionState = (d: CadDoc, env: { motion?: MotionSlot; geo: object }): MotionState => {
  const { store, key } = motionSlot(env);
  return motionStateOf(store, key, d);
};
/** běží právě výpočet studie tohoto dokumentu? */
export const motionRunning = (env: { motion?: MotionSlot; geo: object }): boolean => {
  const { store, key } = motionSlot(env);
  return store.running.has(key);
};

/** Zahodí výsledek dokumentu (dokument pod klíčem nahradil jiný – JSON na místě, zavřená záložka). */
export function dropMotion(store: MotionStore, key: string): void {
  const run = store.running.get(key);
  if (run) run.superseded = true;
  if (store.byDoc.delete(key)) bump();
}

/**
 * Jeden výpočet studie dokumentu: `compute(cancel, onStep)` dostane dotaz na zrušení (novější výpočet jiného vstupu, nebo zrušení
 * všemi volajícími) a hlášení průběhu (rozešle se všem připojeným volajícím). Běží-li už výpočet TÉHOŽ vstupu (stejný otisk),
 * volání se k němu připojí a dostane jeho výsledek – druhý výpočet téhož vstupu nikoho neruší (dřív starší volající dostal
 * nepravdivé „sestava nebo studie se mezitím změnila“). Výpočet jiného vstupu běžící výpočet nahradí (`MotionSuperseded`).
 * Výsledek se uloží pod otiskem vstupu `d`, jen když výpočet doběhl celý (nezrušili ho všichni volající), nebyl nahrazen a v úložišti
 * není novější záznam.
 */
/**
 * Záznam skutečného výpočtu studie ve sdíleném modelu výpočtů aplikace (vlna 22, bod 12 – kolo 6): aplikace sem zaregistruje
 * `RunTracker` (components/cad/motion-runs.ts) – každý NOVÝ výpočet (panel, `window.mncad.motion()`, textový příkaz) dostane id
 * a revizi vstupu, připojení k běžícímu výpočtu téhož vstupu ani výsledek z mezipaměti nový záznam nezaloží. CLI hook nemá.
 */
export type MotionRunHook = (d: CadDoc, key: string) => { end: (state: "done" | "superseded" | "cancelled" | "error", error?: string) => void };
let runHook: MotionRunHook | null = null;
export const setMotionRunHook = (h: MotionRunHook | null) => {
  runHook = h;
};

export async function runStored(
  slot: MotionSlot,
  d: CadDoc,
  compute: (cancel: () => boolean, onStep: (k: number, n: number) => void) => Promise<MotionResult>,
  userCancel?: () => boolean,
  onStep?: (k: number, n: number) => void,
): Promise<MotionResult> {
  const { store, key } = slot;
  const { sig, parts } = motionSigParts(d);
  const prev = store.running.get(key);
  if (prev && prev.sig === sig && !prev.superseded) {
    // stejný vstup: připojit se (vlastní dotaz na zrušení se přidá – výpočet se zruší, až když ho zruší všichni)
    prev.waiters.push(userCancel ?? null);
    if (onStep) prev.listeners.add(onStep);
    try {
      return await prev.promise;
    } finally {
      if (onStep) prev.listeners.delete(onStep);
    }
  }
  if (prev) prev.superseded = true; // nový výpočet jiného vstupu ruší předchozí
  const me: Running = { sig, seq: ++store.seq, superseded: false, waiters: [userCancel ?? null], listeners: new Set(onStep ? [onStep] : []), promise: null! };
  /** zrušení: novější výpočet, nebo všichni připojení volající (volající bez možnosti zrušení výpočet nikdy nezruší) */
  const cancelled = () => me.waiters.every((w) => !!w?.());
  store.running.set(key, me);
  bump();
  const rec = runHook?.(d, key);
  me.promise = (async () => {
    try {
      const res = await compute(
        () => me.superseded || cancelled(),
        (k, n) => me.listeners.forEach((f) => f(k, n)),
      );
      if (me.superseded) throw new MotionSuperseded();
      rec?.end(cancelled() ? "cancelled" : "done");
      if (!cancelled()) {
        const cur = store.byDoc.get(key);
        if (!cur || cur.seq < me.seq) {
          store.byDoc.set(key, { sig, parts, res, seq: me.seq, at: Date.now(), doc: d.name, comps: (d.components ?? []).length });
          // zavřené záložky se z úložiště neodhlašují – držet jen několik posledních dokumentů (výsledek velké sestavy má megabajty)
          while (store.byDoc.size > MAX_DOCS) {
            const oldest = [...store.byDoc].reduce((a, b) => (a[1].seq <= b[1].seq ? a : b));
            store.byDoc.delete(oldest[0]);
          }
        }
      }
      return res;
    } catch (e) {
      rec?.end(e instanceof MotionSuperseded || me.superseded ? "superseded" : (e as { name?: string })?.name === "CadCancelled" || cancelled() ? "cancelled" : "error", e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      if (store.running.get(key) === me) store.running.delete(key);
      bump();
    }
  })();
  return me.promise;
}

/* ───────── stav pro `stav` (textový stav dokumentu a strojový řádek) ───────── */

/**
 * Verdikt platného výsledku (strojové pole `motion=` příkazu `stav`, panel `data-motion-verdict`) – „ok“ jen tehdy, když se
 * opravdu všechno zkontrolovalo a nic nevadí:
 * `conflict` nesplněné vazby v některém kroku > `clash` průnik těles v některém kroku > `warn` upozornění k motorům (⚠ začátek ≠
 * aktuální hodnota, motor nedojede, mezera pod nulou, nepoužitý uložený konec; ⚠ procesní vrstvy; sledovaná vůle pod limitem) > `mates-ok` vazby splněny, ale kolize se
 * nekontrolovaly > `ok` vazby splněny a kolize zkontrolovány bez průniku.
 */
export type MotionVerdict = "ok" | "mates-ok" | "warn" | "conflict" | "clash";
export function motionVerdict(res: MotionResult, d: CadDoc): { state: MotionVerdict; hit: number; notes: number } {
  const hit = res.steps.filter((x) => stepHasFault(d, x)).length; // jen skutečná kolize (vlna 22, bod 5)
  // upozornění k motorům + ⚠ procesní vrstvy (nástroj obrobek nezasáhl, booleovská operace selhala – vlna 22, bod 4)
  const notes = motionMotorNotes(res, d).length + processWarnCount(res, d);
  const mid = betweenFaultCount(res, d); // průnik nalezený zjemněním mezi kroky (vlna 22, bod 6) = také kolize
  // sledovaná vůle pod limitem (⚠ clash.clearance) = upozornění – dřív `motion=ok`, i když text stavu ⚠ vůle měl (vlna 22, bod 6)
  const below = clearanceBelowCount(res);
  const state: MotionVerdict = res.conflictSteps ? "conflict" : hit || mid ? "clash" : notes || below ? "warn" : !res.collisionsChecked ? "mates-ok" : "ok";
  return { state, hit, notes };
}

export type MotionStatus = { state: MotionVerdict | "stale" | "unchecked"; line: string };

/**
 * Řádek „Pohyb: …“ textového stavu sestavy se studií a hodnota `motion=` strojového řádku: platný výsledek (kroky, vazby, průniky
 * těles v krocích – nebo výslovně, že se kolize nekontrolovaly – a počet upozornění k motorům), výsledek, který pro nynější stav
 * sestavy NEPLATÍ (a co se změnilo), nebo nespočítáno. Stav platného výsledku = `motionVerdict` (`ok` jen po skutečné kontrole
 * kolizí bez průniku, bez nesplněných vazeb a bez upozornění). Sestava bez studie → undefined.
 */
export function motionStatusOf(store: MotionStore, key: string, d: CadDoc): MotionStatus | undefined {
  if (d.kind !== "assembly" || !(d.motion?.motors.length || d.motion?.mode === "dynamic")) return undefined;
  const st = motionStateOf(store, key, d);
  if (st.state === "unchecked") return { state: "unchecked", line: tr("Pohyb: nespočítáno – „pohyb spustit“ nebo Vypočítat pohyb v panelu studie") };
  if (st.state === "stale") return { state: "stale", line: tr("Pohyb: výsledek NEPLATÍ – od výpočtu se změnilo: {0}; přepočítá „pohyb spustit“", st.changed.join("; ")) };
  const r = st.entry.res;
  const v = motionVerdict(r, d);
  const steps = Math.max(0, r.steps.length - 1);
  // jen kroky se SKUTEČNOU kolizí (vlna 22, bod 5 – clash-report.ts, motionVerdict); šroub v závitu / dotyk / pracovní kontakt kolizí nejsou
  // kolize nalezené zjemněním MEZI kroky (vlna 22, bod 6) – jinak by `stav` hlásil „bez průniku“ při průchodu mezi kroky
  const mid = betweenFaultCount(r, d);
  const other = !v.hit && !mid && r.steps.some((x) => x.clashes?.length);
  const mates = r.conflictSteps ? tr("nesplněné vazby v {0} krocích", r.conflictSteps) : tr("vazby splněny");
  const clash = !r.collisionsChecked ? tr("kolize nekontrolovány") : v.hit ? tr("průnik těles v {0} krocích", v.hit) : mid ? tr("průnik těles mezi kroky ({0}×, nalezeno zjemněním)", mid) : other ? tr("bez skutečné kolize v kontrolovaných krocích (jen šroub v závitu, dotyk nebo pracovní kontakt)") : tr("bez průniku těles v kontrolovaných krocích");
  // vůle (bod 6; bez sledované vůle u „bez průniku“ výslovně „vůle nekontrolována“ – nulový průnik není provozní vůle), stav výrobku (bod 4)
  const clrText = clearanceStatusText(r, d) || (r.collisionsChecked && !v.hit && !mid && !clearanceOf(r).clearance ? tr("vůle nekontrolována") : "");
  const clr = [clrText, processStatusText(r, d)].filter(Boolean).join(", ");
  const warn = v.notes ? tr(", ⚠ upozornění k motorům: {0}", v.notes) : "";
  return { state: v.state, line: tr("Pohyb: výsledek platí pro tento stav sestavy – {0} kroků, {1}, {2} (podrobně pohyb stav)", steps, mates, (clr ? `${clash}, ${clr}` : clash) + warn) };
}
