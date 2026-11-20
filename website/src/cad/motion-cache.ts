/**
 * Výsledky pohybové studie podle dokumentu a jeho stavu (vlna 22, bod 1 a 12 zprávy – „žádné falešně zelené“):
 *
 * * **otisk vstupu** `motionSig(doc)`: komponenty (poloha, ukotvení, skrytí, pružina), **geometrie listových dílů** (`sourceKey` –
 *   prvky, proměnné, vazby parametrů a konfigurace dílu; i dílů v podsestavách), vazby a definice studie. Výsledek platí jen pro
 *   otisk, pro který vznikl – po změně dílu, polohy, vazby nebo studie je `stale`, v jiném dokumentu `unchecked`;
 * * **úložiště podle pracovního prostoru a dokumentu** (`motionStoreOf(ws.asm)` → klíč dokumentu `Workspace.docKey`): výsledek
 *   jedné sestavy se nikdy neukáže u jiné (ani u sestavy téhož názvu nebo se stejnými id komponent);
 * * **jeden výpočet na dokument**: nový výpočet předchozí ruší (`MotionSuperseded`), výsledek se uloží jen pod otiskem SVÉHO
 *   vstupu a nikdy přes novější záznam – opožděná odpověď staršího výpočtu nic nepřepíše.
 *
 * Panel studie, příkazy `pohyb …`, `stav` i `window.mncad.motion()` čtou stav odtud (`motionState`). Otisk je místní funkce –
 * společná identita výsledků (engine/result-key.ts, balík A) ji může nahradit beze změny volajících.
 */
import { flattenAssembly } from "./assembly";
import { stepHasFault } from "./clash-report";
import { betweenFaultCount, clearanceStatusText } from "./clearance-report";
import { tr } from "./i18n";
import type { MotionResult } from "./motion";
import type { CadDoc, MotionStudy } from "./types";

/** části otisku (pro hlášení, CO se od výpočtu změnilo) */
export type MotionSigParts = { study: string; mates: string; place: string; geo: [path: string, key: string, hidden: 0 | 1][] };
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
type Running = { sig: string; seq: number; superseded: boolean };
export type MotionStore = { byDoc: Map<string, MotionEntry>; running: Map<string, Running>; seq: number };
/** přístup k úložišti z prostředí sestavy (`AsmEnv.motion`): úložiště pracovního prostoru a klíč dokumentu */
export type MotionSlot = { key: string; store: MotionStore };

/** výpočet nahradil novější výpočet téže sestavy (jiný vstup) – jeho výsledek se zahazuje */
export class MotionSuperseded extends Error {
  constructor() {
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
  const { loop: _loop, dyn, ...rest } = s;
  void _loop;
  return JSON.stringify(s.mode === "dynamic" ? { ...rest, dyn } : rest);
}
const memo = new WeakMap<CadDoc, { sig: string; parts: MotionSigParts }>();
/** otisk a jeho části pro dokument (pamatuje se podle objektu dokumentu – dokumenty se nemění na místě) */
export function motionSigParts(d: CadDoc): { sig: string; parts: MotionSigParts } {
  const hit = memo.get(d);
  if (hit) return hit;
  const parts: MotionSigParts = {
    study: studyKey(d.motion),
    mates: JSON.stringify(d.mates ?? []),
    place: JSON.stringify((d.components ?? []).map((c) => [c.id, c.placement, c.fixed, c.hidden, c.spring ?? null])),
    geo: flattenAssembly(d).map((l) => [l.path.join("/"), l.key, l.hidden ? 1 : 0]),
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
  const changed = [...new Set([...cur].filter(([p, k]) => old.has(p) && old.get(p) !== k).map(([p]) => name(p)))];
  if (changed.length) out.push(tr("geometrie dílu {0}", changed.slice(0, 4).map((n) => `„${n}“`).join(", ") + (changed.length > 4 ? tr(" a dalších {0}", changed.length - 4) : "")));
  if (cur.size !== old.size || [...cur.keys()].some((p) => !old.has(p))) out.push(tr("počet dílů ({0} → {1})", old.size, cur.size));
  if (before.place !== now.place) out.push(tr("poloha, ukotvení nebo skrytí komponent"));
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
 * Jeden výpočet studie dokumentu: `compute(cancel)` dostane dotaz na zrušení (uživatel nebo novější výpočet). Výsledek se uloží
 * pod otiskem vstupu `d`, jen když výpočet doběhl celý, nebyl nahrazen a v úložišti není novější záznam. Nahrazený výpočet
 * skončí chybou `MotionSuperseded`.
 */
export async function runStored(slot: MotionSlot, d: CadDoc, compute: (cancel: () => boolean) => Promise<MotionResult>, userCancel?: () => boolean): Promise<MotionResult> {
  const { store, key } = slot;
  const { sig, parts } = motionSigParts(d);
  const prev = store.running.get(key);
  if (prev) prev.superseded = true; // nový výpočet ruší předchozí
  const me: Running = { sig, seq: ++store.seq, superseded: false };
  store.running.set(key, me);
  bump();
  try {
    const res = await compute(() => me.superseded || !!userCancel?.());
    if (me.superseded) throw new MotionSuperseded();
    if (!userCancel?.()) {
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
  } finally {
    if (store.running.get(key) === me) store.running.delete(key);
    bump();
  }
}

/* ───────── stav pro `stav` (textový stav dokumentu a strojový řádek) ───────── */

export type MotionStatus = { state: "ok" | "conflict" | "clash" | "stale" | "unchecked"; line: string };

/**
 * Řádek „Pohyb: …“ textového stavu sestavy se studií a hodnota `motion=` strojového řádku: platný výsledek (kroky, vazby, průniky
 * těles v krocích – nebo výslovně, že se kolize nekontrolovaly), výsledek, který pro nynější stav sestavy NEPLATÍ (a co se změnilo),
 * nebo nespočítáno. Stav: `conflict` = nesplněné vazby, `clash` = průnik těles v některém kroku (nezařazený – podrobně `pohyb stav`),
 * `ok` jen bez obojího. Sestava bez studie → undefined.
 */
export function motionStatusOf(store: MotionStore, key: string, d: CadDoc): MotionStatus | undefined {
  if (d.kind !== "assembly" || !(d.motion?.motors.length || d.motion?.mode === "dynamic")) return undefined;
  const st = motionStateOf(store, key, d);
  if (st.state === "unchecked") return { state: "unchecked", line: tr("Pohyb: nespočítáno – „pohyb spustit“ nebo Vypočítat pohyb v panelu studie") };
  if (st.state === "stale") return { state: "stale", line: tr("Pohyb: výsledek NEPLATÍ – od výpočtu se změnilo: {0}; přepočítá „pohyb spustit“", st.changed.join("; ")) };
  const r = st.entry.res;
  const steps = Math.max(0, r.steps.length - 1);
  // jen kroky se SKUTEČNOU kolizí (vlna 22, bod 5 – clash-report.ts); šroub v závitu / dotyk / pracovní kontakt kolizí nejsou
  const hit = r.steps.filter((x) => stepHasFault(d, x)).length;
  // kolize nalezené zjemněním MEZI kroky (vlna 22, bod 6) – jinak by `stav` hlásil „bez průniku“ při průchodu mezi kroky
  const mid = betweenFaultCount(r, d);
  const other = !hit && r.steps.some((x) => x.clashes?.length);
  const mates = r.conflictSteps ? tr("nesplněné vazby v {0} krocích", r.conflictSteps) : tr("vazby splněny");
  const clash = !r.collisionsChecked ? tr("kolize nekontrolovány") : hit ? tr("průnik těles v {0} krocích", hit) : mid ? tr("průnik těles mezi kroky ({0}×, nalezeno zjemněním)", mid) : other ? tr("bez skutečné kolize v kontrolovaných krocích (jen šroub v závitu, dotyk nebo pracovní kontakt)") : tr("bez průniku těles v kontrolovaných krocích");
  const clr = clearanceStatusText(r, d); // vůle sledovaných dvojic (vlna 22, bod 6)
  return { state: r.conflictSteps ? "conflict" : hit || mid ? "clash" : "ok", line: tr("Pohyb: výsledek platí pro tento stav sestavy – {0} kroků, {1}, {2} (podrobně pohyb stav)", steps, mates, clr ? `${clash}, ${clr}` : clash) };
}
