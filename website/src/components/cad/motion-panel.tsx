"use client";

/**
 * Pohybová studie (karta Sestava): motory na vazbách, délka a počet kroků, kolize, stopa bodu; výpočet řešičem (cad/motion.ts),
 * časová osa s přehráváním / pauzou / posuvníkem a smyčkou, souhrn (první kolize, nesplněné vazby) a export tabulky CSV,
 * snímků PNG (ZIP) a videa WebM (MediaRecorder). Poloha komponent v kroku se zobrazí bez zápisu do historie (`motionView`).
 *
 * Stav panelu se řídí výsledkem uloženým pro TENTO dokument v jeho nynějším stavu (cad/motion-cache.ts, vlna 22):
 * `data-motion-state` = ok (výsledek platí – souhrn, časová osa, poloha kroku ve 3D) | stale (sestava, díl nebo studie se od
 * výpočtu změnily – „Výsledek neplatí“, žádný starý souhrn) | unchecked (pro tuto sestavu se nepočítalo) | running. Po změně
 * modelu, přepnutí záložky ani po změně studie tak panel nikdy neukáže souhrn jiného stavu. Pokyny z textových příkazů
 * (`pohyb přehrát / krok / export`) se zpracují až po doběhnutí běhu, tedy nad dokumentem, který běh zapsal.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { fmt } from "@/cad/agent-asm";
import { motionCached, motionRun, motorCheck, type MotionSignal } from "@/cad/asm-agent-kin";
import { reachHighlight, reachText, type MotorConflict, type MotorReach } from "@/cad/motion-reach";
import type { AsmEnv } from "@/cad/asm-agent";
import { cadLocale, tr } from "@/cad/i18n";
import { MATE_LABEL } from "@/cad/mates";
import { LINEAR_MOTOR_TYPES, ROTARY_MOTOR_TYPES } from "@/cad/mates-kin";
import { defaultStudy, motionFindings, motionMotorNotes, stepsWord, type MotionResult } from "@/cad/motion";
import { levelLine, levelOf, studyMode } from "@/cad/motion-mode";
import { devText } from "@/cad/motion-quasi";
import { MotionSuperseded, motionRunning, motionSig, motionSlot, motionState, motionVerdict, subscribeMotionStore, type MotionState } from "@/cad/motion-cache";
import { stepHasFault } from "@/cad/clash-report"; // štítek kroku jen u skutečné kolize (vlna 22, bod 5)
import { buildMotor, fitDuration, motorArrow, motorCurrent, motorIsAbsolute, motorMeaningText, motorNotes, motorRangeText, motorSpan, type MotorInput } from "@/cad/motor-model";
import { isDyn, studyCsv as motionCsv, studySummary as motionSummary } from "@/cad/motion-dynamic-report";
import { DynChart, DynamicSettings, MotionModeSwitch } from "./motion-dynamic-panel";
import { MotionPhases, PhaseTimeline } from "./motion-phases-panel";
import { ClearanceResult, ClearanceSettings } from "./motion-clearance-panel"; // vůle a spojitá kontrola (vlna 22, bod 6)
import { ProcessSettings, ProcessState } from "./motion-process-panel"; // procesní vrstva: střih / otisk (vlna 22, bod 4)
import { ensureProcessMeshes } from "./process-meshes";
import { processOf } from "@/cad/motion-process";
import type { SpringStep } from "@/cad/asm-spring";
import { uid, type CadDoc, type MotionMotor, type MotionStudy, type Placement, type Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";
import { CadIcon } from "./cad-icons";
import { Num, Vec } from "./props";
import { FloatPanel } from "./ui";
// vlna 22 (body 13–14): lišta přehrávání, uložené pohledy, anotace, export s pevným časováním
import { findView } from "@/cad/motion-views";
import { studySpan } from "@/cad/motion-video";
import { applyStudyView, exportMotion, type ExportHost, type ExportReport } from "./motion-export";
import { MotionPlayer, type PlayerHost } from "./motion-player";
import { MotionDockButton, useMotionDockTarget } from "./motion-dock"; // ukotvení plného panelu (kolo 7, bod 14)
import { appRuns } from "./run-host";
import { motionRunOf, trackedMotion } from "./motion-runs";
import { modelRev } from "@/cad/engine/result-key";

/* ───────────────────────── sdílený stav zobrazení (poloha kroku, stopa) a pokyny z textových příkazů ───────────────────────── */

/** `springs` = délky pružin v kroku (cad/asm-spring.ts) – zobrazení protáhne síť volné pružiny */
type View = { pose: Record<string, Placement> | null; trace: Vec3[] | null; springs?: Record<string, SpringStep> | null; /** neplatný krok (bod 8): zobrazená poloha je poslední platného kroku `shows` – 3D okno ho výrazně označí */ invalid?: { step: number; shows: number } | null; /** procesní vrstva (vlna 22, bod 4): výsledek a krok (index do `res.steps`), jehož stav obrobku a odpad 3D okno ukáže */ proc?: { res: MotionResult; k: number } | null };
let view: View = { pose: null, trace: null };
const subs = new Set<() => void>();
const EMPTY: View = { pose: null, trace: null };
export const motionView = {
  get: () => view,
  set(v: View) {
    view = v;
    subs.forEach((f) => f());
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
};
/** poloha komponent a stopa aktuálního kroku studie (null = studie se nezobrazuje) */
export function useMotionView(): View {
  return useSyncExternalStore(motionView.subscribe, motionView.get, () => EMPTY);
}
/**
 * Zvýraznění motoru ve 3D okně (vlna 22, bod 10): komponenty, které motor skutečně pohání (zkušební posun – cad/motion-reach.ts),
 * řízená vazba a osa se šipkou směru (čáry + popisek; WebGL i softwarový náhled je kreslí jako překryv měření).
 */
export type MotorHighlight = { motor: number | "draft"; mate: string; comps: string[]; lines: [Vec3, Vec3][]; label: { pos: Vec3; text: string } | null };
let hl: MotorHighlight | null = null;
const hlSubs = new Set<() => void>();
export const motorHighlight = {
  get: () => hl,
  set(v: MotorHighlight | null) {
    hl = v;
    hlSubs.forEach((f) => f());
  },
  subscribe(f: () => void) {
    hlSubs.add(f);
    return () => void hlSubs.delete(f);
  },
};
export function useMotorHighlight(): MotorHighlight | null {
  return useSyncExternalStore(motorHighlight.subscribe, motorHighlight.get, () => null);
}
const queue: MotionSignal[] = [];
const sigSubs = new Set<() => void>();
/** pokyn z textového příkazu „pohyb …“ (přehrát, krok, export) – panel si ho vyzvedne */
export function pushMotionSignal(s: MotionSignal) {
  queue.push(s);
  sigSubs.forEach((f) => f());
}

/* ───────────────────────── panel ───────────────────────── */

/** číslo bez zbytečných nul, desetinná čárka podle jazyka (jako protokol textových příkazů) */
const f = (v: number, d = 2) => fmt(v, d);
function save(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
/** kompaktní režim (jen lišta přehrávání) – pamatuje se v prohlížeči */
const COMPACT_KEY = "mncad.motion.compact";
const readCompact = () => {
  try {
    return localStorage.getItem(COMPACT_KEY) === "1";
  } catch {
    return false;
  }
};


/** stav výsledku pro otisk dokumentu `sig` (starší stav se při vykreslení jiného dokumentu nepoužije ani na jeden snímek) */
type Live = { sig: string; key: string; st: MotionState; running: boolean };
/** rozpracovaný motor formuláře: nevyplněná pole (undefined) se berou z vazby – začátek = aktuální hodnota, konec = začátek + výchozí zdvih */
type Draft = {
  kind: "rotary" | "linear";
  mate: string;
  from?: number;
  to?: number;
  stroke?: number;
  end: "to" | "stroke";
  mode: "range" | "ranged" | "open";
  speed?: number;
  back?: boolean;
  /** navazující úseky (vlna 22, bod 3): kam + čas NEBO rychlost (ot/min u rotačního); s úseky se konec / zdvih nepoužije */
  legs?: { to: number; by: "time" | "speed"; value: number }[];
  /** časové okno [s] a fáze, se kterou motor začne */
  t0?: number;
  t1?: number;
  phase?: string;
  atLimit?: "stop" | "error";
};
const newDraft = (kind: "rotary" | "linear"): Draft => ({ kind, mate: "", end: "to", mode: "range" });
/** formulář z uloženého motoru (Upravit vybraný motor) – klíčové polohy se upravují jako úseky s časem */
function draftOf(mo: MotionMotor): Draft {
  const per = mo.kind === "rotary" ? 6 : 1;
  const legs = mo.keys && mo.keys.length > 1
    ? mo.keys.slice(1).map((k, i) => ({ to: k.v, by: "time" as const, value: k.t - mo.keys![i].t }))
    : mo.legs?.map((g) => ({ to: g.to, by: g.speed !== undefined && g.time === undefined ? ("speed" as const) : ("time" as const), value: g.speed !== undefined && g.time === undefined ? g.speed / per : (g.time ?? 0) }));
  return {
    kind: mo.kind,
    mate: mo.mate,
    from: mo.from,
    to: mo.to,
    end: "to",
    mode: mo.ranged ? "ranged" : mo.speed !== undefined && !legs ? "open" : "range",
    ...(mo.speed !== undefined ? { speed: mo.ranged ? Math.abs(mo.speed) : mo.speed } : {}),
    ...(mo.back ? { back: true } : {}),
    ...(legs?.length ? { legs } : {}),
    ...(mo.window?.t0 !== undefined ? { t0: mo.window.t0 } : {}),
    ...(mo.window?.t1 !== undefined ? { t1: mo.window.t1 } : {}),
    ...(mo.phase ? { phase: mo.phase } : {}),
    ...(mo.atLimit ? { atLimit: mo.atLimit } : {}),
  };
}

export function MotionPanel({
  doc,
  env,
  onDoc,
  onClose,
  flash,
  liveViews,
  engineBusy,
  player,
}: {
  doc: CadDoc;
  env: () => AsmEnv;
  /** změna definice studie (uloží se do sestavy) */
  onDoc: (d: CadDoc) => void;
  onClose: () => void;
  /** PNG 3D okna (data URL) – od vlny 22 nepoužito (export přes `player`, motion-export.ts) */
  snapshot?: () => string | null;
  /** plátno 3D okna – od vlny 22 nepoužito (dřív záznam videa v reálném čase) */
  canvas?: () => HTMLCanvasElement | null;
  flash: (t: string) => void;
  /** živé pohledy studie (kolo 7b, bod 14 – `motion-live-views.tsx`): vykreslí je aplikace, panel je jen umístí */
  liveViews?: import("react").ReactNode;
  /** běží běh textových příkazů (dokument běhu se zapisuje až na jeho konci) – pokyny a výpočet panelu na něj počkají */
  engineBusy?: () => boolean;
  /** okno pro pohledy studie a export snímků (kamera, řez, sejmutí plátna – WebGL i softwarový náhled) */
  player?: PlayerHost;
}) {
  const study: MotionStudy = doc.motion ?? defaultStudy();
  const mates = useMemo(() => (doc.mates ?? []).filter((m) => !m.suppressed && (ROTARY_MOTOR_TYPES.has(m.type) || LINEAR_MOTOR_TYPES.has(m.type))), [doc.mates]);
  const [busy, setBusy] = useState<{ k: number; n: number } | null>(null);
  /** chyba výpočtu i s dokumentem a stavem, pro který vznikla (klíč dokumentu + otisk) – u jiného dokumentu / stavu se neukáže */
  const [err, setErr] = useState<{ key: string; sig: string; text: string } | null>(null);
  const [loop, setLoop] = useState(!!study.loop);
  const [rec, setRec] = useState<string | null>(null);
  const cancel = useRef(false);
  const [speed, setSpeed] = useState(1);
  const [compact, setCompactState] = useState(readCompact);
  const dockTarget = useMotionDockTarget();
  const setCompact = (on: boolean) => {
    setCompactState(on);
    try {
      localStorage.setItem(COMPACT_KEY, on ? "1" : "0");
    } catch {
      /* bez úložiště jen pro tuto relaci */
    }
  };
  const [report, setReport] = useState<ExportReport | null>(null);
  const exportCancel = useRef(false);
  /** otisk dokumentu, který se právě počítá (změní-li se dokument, výpočet zastaralého vstupu se zruší) */
  const computing = useRef<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => newDraft("rotary"));
  /**
   * formulář motoru (vlna 22, bod 10): zavřený, „Nový motor“, nebo „Upravit vybraný motor N“ (předvyplněný, Uložit / Zrušit).
   * Dřív byl pod seznamem trvale otevřený formulář „Přidat motor“ a motor na téže vazbě se potichu nahradil.
   */
  const [editor, setEditor] = useState<{ mode: "new" } | { mode: "edit"; i: number } | null>(null);
  const openNew = () => {
    setDraft(newDraft(draft.kind));
    setEditor({ mode: "new" });
  };
  const openEdit = (i: number) => {
    const mo = study.motors[i];
    if (!mo) return;
    setDraft(draftOf(mo));
    setEditor({ mode: "edit", i });
  };
  const setStudy = (s: Partial<MotionStudy>) => onDoc({ ...doc, motion: { ...study, ...s } });
  const name = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? "?";
  const mateLabel = (m: { name?: string; type: keyof typeof MATE_LABEL }) => m.name ?? tr(MATE_LABEL[m.type]);
  const mateName = (id: string) => {
    const m = doc.mates?.find((x) => x.id === id);
    return m ? `${(doc.mates ?? []).indexOf(m) + 1}. ${mateLabel(m)} · ${name(m.a.compId)} → ${name(m.b.compId)}` : tr("(vazba chybí)");
  };
  const okMates = (kind: "rotary" | "linear") => mates.filter((m) => (kind === "rotary" ? ROTARY_MOTOR_TYPES : LINEAR_MOTOR_TYPES).has(m.type));
  const draftMate = okMates(draft.kind).some((m) => m.id === draft.mate) ? draft.mate : (okMates(draft.kind)[0]?.id ?? "");

  /* ───────── výsledek: jen ten, který platí pro tento dokument v jeho nynějším stavu ───────── */
  const sig = useMemo(() => motionSig(doc), [doc]);
  const docRef = useRef(doc);
  docRef.current = doc;
  const envRef = useRef(env);
  envRef.current = env;
  /**
   * běh textových příkazů probíhá nebo ČEKÁ ve frontě běhů (run-host.ts `appRuns`): `window.mncad.run(…)` běh jen zařadí a engine
   * začne až v další mikroúloze – klik na „Vypočítat pohyb“ hned po zařazení by jinak spočítal dokument PŘED během (fáze 2, bod 12)
   */
  const busyRef = useRef<(() => boolean) | undefined>(undefined);
  busyRef.current = () => !!engineBusy?.() || appRuns.pending().some((e) => e.kind === "script");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);
  const [live, setLive] = useState<Live | null>(null);
  // před vykreslením: stav z úložiště pro tento dokument; znovu při každé změně úložiště (výpočet doběhl, výsledek zahozen)
  useLayoutEffect(() => {
    const read = () => {
      const e = envRef.current();
      setLive({ sig: motionSig(docRef.current), key: motionSlot(e).key, st: motionState(docRef.current, e), running: motionRunning(e) });
    };
    read();
    return subscribeMotionStore(read);
  }, [doc]);
  const st: MotionState = live && live.sig === sig ? live.st : { state: "unchecked" };
  const res: MotionResult | null = st.state === "ok" ? st.entry.res : null;
  const state: "ok" | "stale" | "unchecked" | "running" = busy || (live?.sig === sig && live.running) ? "running" : st.state;
  // poloha časové osy a přehrávání patří jednomu výsledku – s jiným výsledkem začínají od začátku
  const [pos, setPos] = useState<{ res: MotionResult; i: number } | null>(null);
  const [play, setPlay] = useState<MotionResult | null>(null);
  const step = res && pos?.res === res ? Math.min(pos.i, res.steps.length - 1) : 0;
  const playing = !!res && play === res;
  // dokument se změnil během výpočtu → výpočet zastaralého vstupu zrušit (jeho výsledek by se stejně nezobrazil)
  useEffect(() => {
    if (computing.current && computing.current !== sig) cancel.current = true;
  }, [sig]);
  // zobrazení kroku v 3D okně – jen u platného výsledku
  useEffect(() => {
    if (!res) {
      motionView.set({ pose: null, trace: null });
      return;
    }
    const s = res.steps[step];
    const trace = res.steps.slice(0, step + 1).flatMap((x) => (x.trace ? [x.trace] : []));
    motionView.set({ pose: s?.place ?? null, trace: trace.length > 1 ? trace : null, springs: s?.springs ?? null, invalid: s?.status === "invalid" ? { step: s.i, shows: s.shows ?? 0 } : null, proc: processOf(res) ? { res, k: step } : null });
  }, [res, step]);
  // sítě procesní vrstvy (obrobek po operaci, odpad) – načtou se jednou po výsledku; 3D okno je pak čte synchronně
  useEffect(() => {
    if (res && processOf(res)) void ensureProcessMeshes(res, docRef.current, envRef.current().process);
  }, [res]);
  useEffect(() => () => motionView.set({ pose: null, trace: null }), []);
  const compute = useCallback(async (): Promise<MotionResult | null> => {
    const d = docRef.current;
    const n = (d.motion ?? defaultStudy()).steps;
    const e0 = envRef.current();
    const at = { key: motionSlot(e0).key, sig: motionSig(d) };
    setErr(null);
    cancel.current = false;
    computing.current = at.sig;
    setBusy({ k: 0, n });
    try {
      // výsledek se uloží pod otiskem `d`; platí-li pak pro zobrazený dokument, panel ho ukáže sám (stav z úložiště)
      // záznam ve sdíleném modelu výpočtů (id v…, revize vstupu, stavy – vlna 22, bod 12): týž jako window.mncad.motion()
      return (await trackedMotion(d, () => motionRun(d, e0, { onStep: (k, nn) => setBusy({ k, n: nn }), cancel: () => cancel.current }))).res;
    } catch (e) {
      // chyba patří dokumentu a stavu, pro který se počítalo – nad jinou sestavou / po změně se neukáže
      if (!(e instanceof MotionSuperseded)) setErr({ ...at, text: (e as Error).message });
      return null;
    } finally {
      computing.current = null;
      setBusy(null);
    }
  }, []);
  /**
   * Běh textových příkazů zapisuje svůj dokument až na konci: výpočet a export spuštěné z panelu během běhu na něj počkají
   * (hláška řekne proč) a pracují pak s dokumentem, který běh zapsal – nikdy se stavem před během. false = panel mezitím zavřen.
   */
  const engineWait = useRef<Promise<boolean> | null>(null);
  const waitEngine = (): Promise<boolean> => {
    if (!busyRef.current?.()) return Promise.resolve(true);
    if (!engineWait.current) {
      flash(tr("Probíhá běh textových příkazů – panel počká na jeho dokončení a pak počítá s dokumentem, který běh zapíše."));
      engineWait.current = (async () => {
        while (busyRef.current?.() && alive.current) await new Promise((r) => setTimeout(r, 80));
        engineWait.current = null;
        return alive.current;
      })();
    }
    return engineWait.current;
  };
  const runCompute = async () => {
    // dvojí klik během čekání nespustí dva výpočty
    if ((await waitEngine()) && !computing.current) void compute();
  };
  // přehrávání ve skutečném čase × rychlost (vlna 22, bod 13): krok = poslední krok s časem ≤ uplynulý čas studie; při hustých
  // krocích se kroky přeskakují – přehrávání se dřív (krok nejméně 30 ms) potichu zpomalovalo
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    if (!playing || !res) return;
    const S = res.steps;
    const T = studySpan(res, study.duration);
    let t0 = S[Math.min(stepRef.current, S.length - 1)]?.t ?? 0;
    if (t0 >= T) t0 = 0;
    let start = performance.now();
    let raf = 0;
    const tickPlay = (now: number) => {
      let t = t0 + ((now - start) / 1000) * speed;
      if (t >= T) {
        if (!loop) {
          setPos({ res, i: S.length - 1 });
          setPlay(null);
          return;
        }
        t0 = 0;
        start = now;
        t = 0;
      }
      let i = 0;
      while (i + 1 < S.length && S[i + 1].t <= t) i++;
      if (i !== stepRef.current) setPos({ res, i });
      raf = requestAnimationFrame(tickPlay);
    };
    raf = requestAnimationFrame(tickPlay);
    return () => cancelAnimationFrame(raf);
  }, [playing, res, loop, study.duration, speed]);
  /** poloha kroku ve 3D okně (po exportu se okno vrátí na zobrazený krok) */
  const showStep = (r: MotionResult, i: number) => {
    const st = r.steps[i];
    const trace = r.steps.slice(0, i + 1).flatMap((x) => (x.trace ? [x.trace] : []));
    motionView.set({ pose: st?.place ?? null, trace: trace.length > 1 ? trace : null, springs: st?.springs ?? null, proc: processOf(r) ? { res: r, k: i } : null });
  };
  /**
   * Snímky PNG / video WebM s pevným časováním (motion-export.ts): bez záznamu obrazovky, délka = délka studie / rychlost
   * (± 1 snímek), anotace polohy vypálené do obrazu, uložené pohledy (víc = vedle sebe). PNG bez voleb = snímek na krok.
   */
  const exportFrames = async (r: MotionResult, kind: "png" | "webm", sig?: MotionSignal["video"]) => {
    const d = docRef.current;
    const st = d.motion ?? study;
    if (!player) return flash(tr("Export snímků potřebuje 3D okno."));
    // volby z textového příkazu už obsahují uložené volby studie (agent-motion-view.ts mergeVideo) – jinak volby studie
    const v = sig ?? st.video ?? {};
    const ids = sig?.views ?? st.video?.views ?? (st.view ? [st.view] : []);
    const views = ids.flatMap((id) => {
      const f = findView(st, id);
      return f ? [f] : [];
    });
    const host: ExportHost = {
      ...player,
      // procesní vrstva: stav obrobku a odpad podle kroku před zobrazeným časem (sítě musí být načtené – viz níže)
      setPose: (p) => motionView.set({ pose: p.place, trace: p.trace, springs: p.springs, proc: processOf(r) ? { res: r, k: p.k } : null }),
      save,
      progress: (t) => setRec(t),
      cancelled: () => exportCancel.current,
    };
    exportCancel.current = false;
    setRec(tr("Připravuji snímky…"));
    await ensureProcessMeshes(r, d, envRef.current().process); // exportované snímky obsahují obrobek po střihu / otisku
    try {
      const rep = await exportMotion(r, d, { kind, speed: v.speed, fps: v.fps, seconds: v.seconds, perStep: kind === "png" && (sig ? !!sig.perStep : true), views, annot: v.annot !== false && !st.annot?.off, annotSettings: st.annot, name: d.name, csv: motionCsv(r, d) }, host);
      setReport(rep);
      flash(rep.text);
    } finally {
      setRec(null);
      if (alive.current) showStep(r, stepRef.current);
    }
  };
  /** použije uložený pohled studie (kamera a řez okna) */
  const applyView = (id: string, store: boolean) => {
    const d = docRef.current;
    const v = findView(d.motion, id);
    if (!v) return;
    if (player) applyStudyView(player, v);
    if (store && d.motion?.view !== v.id) onDoc({ ...d, motion: { ...(d.motion ?? study), view: v.id } });
  };
  /** export jen z výsledku, který platí pro zobrazený dokument – jinak se nejdřív spočítá */
  const runExport = async (kind: "csv" | "png" | "webm", video?: MotionSignal["video"]) => {
    if (!(await waitEngine())) return;
    const d = docRef.current;
    const r = motionCached(d, envRef.current()) ?? (await compute());
    if (!r || motionCached(docRef.current, envRef.current()) !== r) return;
    setPlay(null);
    if (kind === "csv") save(`${d.name || "sestava"}-pohyb.csv`, motionCsv(r, d), "text/csv;charset=utf-8");
    else await exportFrames(r, kind, video);
  };
  // pokyny z textových příkazů „pohyb přehrát / krok / export“: až po doběhnutí běhu (dokument běhu se zapisuje na jeho konci –
  // dřív panel pokyn zpracoval se STARÝM dokumentem a spočítal a přehrál původní studii, bod 12 zprávy)
  const handlers = useRef({ compute, runExport, applyView });
  handlers.current = { compute, runExport, applyView };
  const draining = useRef(false);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const drain = async () => {
      if (draining.current) return;
      draining.current = true;
      try {
        while (queue.length && alive) {
          if (busyRef.current?.()) {
            timer = setTimeout(() => void drain(), 60);
            return;
          }
          const s = queue.shift()!;
          if (s.stop) setPlay(null);
          // `pohyb pohled "…"`: dokument s aktivním pohledem už zapsal běh – okno převezme kameru a řez pohledu
          if (s.view) handlers.current.applyView(s.view, false);
          // tabulku CSV textového příkazu zapisuje engine sám (protokol / soubor) – panel pro ni nic nepočítá
          if (s.play || s.step !== undefined || (s.export && s.export !== "csv")) {
            // výsledek platný pro dokument, který je teď v záložce (běh ho už zapsal); jinak se spočítá pro něj
            const r = motionCached(docRef.current, envRef.current()) ?? (await handlers.current.compute());
            if (!r) continue;
            if (s.step !== undefined) {
              setPlay(null);
              setPos({ res: r, i: s.step });
            }
            if (s.play) {
              if (s.loop) setLoop(true);
              setPos({ res: r, i: 0 });
              setPlay(r);
            }
            if (s.export) await handlers.current.runExport(s.export, s.video);
          }
        }
      } finally {
        draining.current = false;
      }
    };
    void drain();
    const fn = () => void drain();
    sigSubs.add(fn);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      sigSubs.delete(fn);
    };
  }, []);

  /* ───────── formulář motoru: význam hodnot, zdvih a směr, rozsah × rychlost (cad/motor-model.ts) ───────── */
  const dMate = doc.mates?.find((m) => m.id === draftMate);
  const dAbs = motorIsAbsolute({ kind: draft.kind }, dMate);
  const dCur = motorCurrent({ kind: draft.kind }, dMate);
  const rot = draft.kind === "rotary";
  const unit = rot ? "°" : "mm";
  const defStroke = rot ? 360 : 10;
  const dFrom = draft.from ?? dCur;
  const dStroke = draft.end === "stroke" ? (draft.stroke ?? defStroke) : (draft.to ?? dFrom + defStroke) - dFrom;
  const dTo = draft.end === "stroke" ? dFrom + dStroke : (draft.to ?? dFrom + defStroke);
  const dSpeed = draft.speed ?? (rot ? 60 : 10);
  const dWindow = draft.t0 !== undefined || draft.t1 !== undefined ? { ...(draft.t0 !== undefined ? { t0: draft.t0 } : {}), ...(draft.t1 !== undefined ? { t1: draft.t1 } : {}) } : undefined;
  const dInput: MotorInput = draft.legs?.length
    ? { kind: draft.kind, from: dFrom, extra: draft.legs.map((g) => ({ to: g.to, ...(g.by === "speed" ? { speed: g.value } : { time: g.value }) })), ...(dWindow ? { window: dWindow } : {}), ...(draft.phase ? { phase: draft.phase } : {}) }
    : { kind: draft.kind, from: dFrom, ...(draft.mode === "open" ? {} : draft.end === "stroke" ? { stroke: dStroke } : { to: dTo }), ...(draft.mode !== "range" ? { speed: dSpeed } : {}), ...(draft.back && draft.mode === "range" ? { back: true } : {}), ...(dWindow ? { window: dWindow } : {}), ...(draft.phase ? { phase: draft.phase } : {}) };
  /** upravovaný motor (index) nebo motor na téže vazbě se stejným začátkem, který by nový motor nahradil (nikdy potichu) */
  const editIdx = editor?.mode === "edit" ? editor.i : -1;
  const startKey = (x: { window?: { t0?: number }; phase?: string }) => `${x.phase ?? ""}|${x.window?.t0 ?? 0}`;
  const sameIdx = editor?.mode === "new" && dMate ? study.motors.findIndex((x) => x.mate === dMate.id && startKey(x) === startKey({ ...(dWindow ? { window: dWindow } : {}), ...(draft.phase ? { phase: draft.phase } : {}) })) : -1;
  // náhled motoru, délky studie a upozornění ještě před uložením
  const preview = useMemo(() => {
    if (!dMate) return null;
    try {
      const i = editIdx >= 0 ? editIdx : sameIdx;
      const mo = buildMotor(dInput, { id: i >= 0 ? study.motors[i].id : "draft", mate: dMate.id, abs: dAbs, current: dCur });
      if (draft.atLimit === "error") mo.atLimit = "error";
      const motors = i >= 0 ? study.motors.map((x, k) => (k === i ? mo : x)) : [...study.motors, mo];
      const fit = fitDuration({ ...study, motors }, i >= 0 ? i : motors.length - 1);
      const notes = motorNotes({ motors: [mo], duration: fit.duration, collisions: study.collisions }, doc.mates ?? [], (m) => m.name ?? tr(MATE_LABEL[m.type]));
      return { mo, motors, index: i >= 0 ? i : motors.length - 1, duration: fit.duration, extended: fit.note?.text ?? null, notes, error: null as string | null };
    } catch (e) {
      return { mo: null, motors: null, index: -1, duration: study.duration, extended: null, notes: [], error: (e as Error).message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dMate, JSON.stringify(dInput), dAbs, dCur, study, editIdx, sameIdx, draft.atLimit]);
  const addMotor = () => {
    if (!preview?.mo || !preview.motors) return;
    setStudy({ motors: preview.motors.map((m) => (m.id === "draft" ? { ...m, id: uid() } : m)), duration: preview.duration });
    if (preview.extended) flash(preview.extended);
    if (sameIdx >= 0) flash(tr("Motor {0} na vazbě „{1}“ nahrazen.", sameIdx + 1, dMate ? mateLabel(dMate) : ""));
    setEditor(null);
  };
  /** „Navázat úsek za motor N“: formulář přejde na úpravu motoru N s dalším úsekem do zadaného konce */
  const appendTo = (i: number) => {
    const mo = study.motors[i];
    if (!mo) return;
    const d = draftOf(mo);
    const per = mo.kind === "rotary" ? 6 : 1;
    const base = d.legs ?? [{ to: mo.to, by: mo.ranged && mo.speed ? ("speed" as const) : ("time" as const), value: mo.ranged && mo.speed ? Math.abs(mo.speed) : motorSpan(mo, study.duration).time / (mo.ranged ? per : 1) }];
    setDraft({ ...d, mode: "range", back: undefined, legs: [...base, { to: dTo, by: "time", value: Math.max(0.1, study.duration / 4) }] });
    setEditor({ mode: "edit", i });
  };
  /** úseky z jednoduchého zadání: první úsek = nynější rozsah, druhý návrat na začátek */
  const toLegs = () => {
    const first = { to: dTo, by: draft.mode === "ranged" ? ("speed" as const) : ("time" as const), value: draft.mode === "ranged" ? dSpeed : Math.max(0.1, study.duration / 2) };
    setDraft({ ...draft, mode: "range", back: undefined, legs: [first, { to: dFrom, by: "time", value: Math.max(0.1, study.duration / 2) }] });
  };
  /* ───────── co motor pohání, konflikt s jiným motorem (zkušební posun řešičem – cad/motion-reach.ts) a zvýraznění ve 3D ───────── */
  const [check, setCheck] = useState<{ key: string; reach: MotorReach | null; conflicts: MotorConflict[] } | null>(null);
  const checkDoc = editor && preview?.motors ? { ...doc, motion: { ...study, motors: preview.motors.map((m) => (m.id === "draft" ? { ...m, id: "draft" } : m)) } } : null;
  const checkIdx = editor && preview?.motors ? preview.index : -1;
  const checkKey = checkDoc ? `${sig}|${JSON.stringify(checkDoc.motion.motors)}|${checkIdx}` : "";
  useEffect(() => {
    if (!checkDoc || checkIdx < 0) return;
    let alive2 = true;
    const t = setTimeout(() => {
      void motorCheck(checkDoc, envRef.current(), checkIdx).then((r) => alive2 && setCheck({ key: checkKey, ...r }));
    }, 250);
    return () => {
      alive2 = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey]);
  const chk = check && check.key === checkKey ? check : null;
  // zvýraznění: řízený díl a díly, které s ním jdou, a osa se šipkou směru (jen dokud je formulář otevřený)
  useEffect(() => {
    const r = chk?.reach;
    const h = r ? reachHighlight(r, 40) : null;
    if (!editor || !h || !dMate) {
      motorHighlight.set(null);
      return;
    }
    const sp = preview?.mo ? motorSpan(preview.mo, preview.duration) : null;
    const arrow = sp ? motorArrow({ kind: draft.kind }, sp.dir) : "";
    motorHighlight.set({ motor: editIdx >= 0 ? editIdx : "draft", mate: dMate.id, comps: h.comps, lines: h.lines, label: r?.axis ? { pos: h.tip, text: `${mateLabel(dMate)} ${arrow}` } : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chk, editor, dMate?.id]);
  useEffect(() => () => motorHighlight.set(null), []);
  const cur = res?.steps[step];
  // upozornění k motorům zvlášť (i bez výpočtu – níže), v souhrnu výsledku by byla podruhé
  // souhrn po tuhých skupinách (vlna 22, bod 15); po dílech jen na vyžádání („Detail po dílech“)
  const [detail, setDetail] = useState(false);
  const summary = res ? motionSummary(res, doc, { notes: false, detail }) : [];
  // motor na mezi, neplatné kroky, vazbami neurčená poloha (vlna 22, body 2 a 8) – v panelu jako upozornění s kódem
  const findings = res && !isDyn(res) ? motionFindings(res, doc) : [];
  // úroveň simulace: z výsledku, jinak co by zvolil výpočet (studie bez výslovného režimu = automaticky)
  const levelNow = res?.level ?? levelOf(studyMode(doc, study));
  const notes = res ? motionMotorNotes(res, doc) : motorNotes(study, doc.mates ?? [], (m) => m.name ?? tr(MATE_LABEL[m.type]));
  // verdikt platného výsledku (jako pole `motion=` příkazu `stav`): ok jen po kontrole kolizí bez průniku a bez upozornění
  const verdict = res ? motionVerdict(res, doc).state : "";
  const errText = err && err.sig === sig && err.key === (live?.key ?? err.key) ? err.text : null;
  /**
   * starší dokument: motor s rychlostí a nepoužitým uloženým koncem (⚠ motion.end-unused) → rozsah × rychlost (dojede na uložený
   * konec a stojí); délka studie podle doby jízdy jako u textového `pohyb motor … A..B rychlost V`
   */
  const toRanged = (i: number) => {
    const mo = study.motors[i];
    if (!mo || mo.speed === undefined) return;
    const motors = study.motors.map((x, k) => (k === i ? { ...x, speed: Math.abs(mo.speed!), ranged: true as const } : x));
    try {
      const fit = fitDuration({ ...study, motors }, i);
      setStudy({ motors, duration: fit.duration });
      if (fit.note) flash(fit.note.text);
    } catch (e) {
      flash((e as Error).message);
    }
  };
  const fromLabel = dAbs ? tr("Začátek – hodnota vazby") : rot ? tr("Začátek – natočení od výchozí polohy") : tr("Začátek – posuv od výchozí polohy");
  const toLabel = dAbs ? tr("Konec – hodnota vazby") : rot ? tr("Konec – natočení od výchozí polohy") : tr("Konec – posuv od výchozí polohy");
  const time = (ms: number) => new Date(ms).toLocaleTimeString(cadLocale(), { hour: "2-digit", minute: "2-digit" });
  return (
    <>
    {/* kompaktní režim (vlna 22, bod 14): jen lišta přehrávání dole ve 3D okně, plný panel skrytý */}
    {!compact && (
    <FloatPanel title={tr("Pohybová studie")} icon="transform" tone="pattern" width={352} initial={{ x: 12, y: 56 }} onClose={onClose} dock={dockTarget} extra={<MotionDockButton />}>
      <div data-motion-panel data-motion-state={state} data-motion-verdict={verdict} data-motion-doc={doc.name} data-motion-key={live?.key ?? ""} className="max-h-[70vh] space-y-3 overflow-y-auto p-3 text-[12px]">
        {liveViews}
        {/* kinematika (motory) / dynamika (síly pružin, gravitace – cad/motion-dynamic.ts) */}
        <MotionModeSwitch study={study} onStudy={setStudy} doc={doc} />
        {/* úroveň simulace: kinematika × kvazistatika × dynamika (vlna 22, bod 2) – co výpočet počítá a proč */}
        <p data-motion-level={levelNow.level} data-motion-level-auto={levelNow.auto ? "1" : "0"} className="rounded bg-[#f3f6f9] px-2 py-1 text-[11px] leading-snug text-[#4a5664]">
          {levelLine(levelNow)}
        </p>
        <div>
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#4a5664]">{tr("Motory")}</p>
          {study.motors.length ? (
            <ul className="space-y-1" data-motion-motors>
              {study.motors.map((mo, i) => {
                const mm = doc.mates?.find((x) => x.id === mo.mate);
                const abs = motorIsAbsolute(mo, mm);
                return (
                  <li key={mo.id} data-motor={mo.id} data-motor-meaning={abs ? "absolute" : "relative"} data-motor-selected={editIdx === i ? "1" : undefined} className={cn("flex items-center gap-1.5 rounded border bg-white px-2 py-1", editIdx === i ? "border-brand ring-1 ring-brand/30" : "border-[#d5dbe2]")}>
                    <CadIcon name={mo.kind === "rotary" ? "revolve" : "extrude"} className="h-3.5 w-3.5 shrink-0" />
                    {/* klik na motor = Upravit vybraný motor (předvyplněný formulář) – oddělené od „Nový motor“ (vlna 22, bod 10) */}
                    <button type="button" data-motor-edit={i + 1} title={tr("Upravit motor {0}", i + 1)} onClick={() => openEdit(i)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate font-medium">{tr("Motor {0}", i + 1)} · {mo.kind === "rotary" ? tr("Rotační") : tr("Lineární")} · {mateName(mo.mate)}</span>
                      {/* začátek → konec, zdvih, směr, rychlost a doba – stejný text jako protokol (motorText) */}
                      <span data-motor-range className="block font-mono text-[10.5px] text-[#6b7785]">
                        {motorMeaningText(mo, abs, study.duration)}
                        {mo.phase ? tr(" · začne s fází „{0}“", study.phases?.find((p) => p.id === mo.phase)?.name ?? "?") : ""}
                      </span>
                    </button>
                    {/* chování na mezi (bod 8): stop = motor stojí na poslední dosažitelné hodnotě, chyba = kroky za mezí neplatné */}
                    <select data-motor-atlimit={mo.id} aria-label={tr("Motor na mezi")} title={tr("Motor na mezi: stop = stojí na poslední dosažitelné hodnotě · neplatný krok = kroky za mezí se neřeší, zůstane poslední platná poloha")} value={mo.atLimit ?? "stop"} onChange={(e) => setStudy({ motors: study.motors.map((x, k) => (k === i ? (e.target.value === "error" ? { ...x, atLimit: "error" as const } : withoutAtLimit(x)) : x)) })} className="w-[74px] shrink-0 rounded border border-[#cfd6de] bg-white px-1 py-0.5 text-[10.5px]">
                      <option value="stop">{tr("na mezi: stop")}</option>
                      <option value="error">{tr("na mezi: chyba")}</option>
                    </select>
                    <button type="button" data-motor-remove={i + 1} title={tr("Odebrat motor")} onClick={() => (setStudy({ motors: study.motors.filter((_, k) => k !== i) }), editIdx === i && setEditor(null))} className="text-[#6b7785] hover:text-brand">
                      <CadIcon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[11px] text-[#6b7785]">{tr("Zatím žádný motor. Rotační motor otáčí komponentou na vazbě Závěs / Souosost / Šroub, lineární ji posouvá na vazbě Vzdálenost / Drážka / Dráha / Souosost.")}</p>
          )}
          {!editor && (
            <button type="button" data-motor-new onClick={openNew} className="mt-2 w-full rounded border border-[#cfd6de] bg-white py-1 text-[12px] font-medium hover:bg-[#f3f6f9]">
              {tr("+ Nový motor")}
            </button>
          )}
          {editor && (
          <div className={cn("mt-2 space-y-1.5 rounded border p-2", editor.mode === "edit" ? "border-brand/60 bg-[#fffaf9]" : "border-dashed border-[#cfd6de]")} data-motion-add data-motor-form={editor.mode} data-motor-meaning={dAbs ? "absolute" : "relative"}>
            <p className="text-[11.5px] font-semibold text-[#26303b]">{editor.mode === "edit" ? tr("Upravit motor {0}", editor.i + 1) : tr("Nový motor")}</p>
            {editor.mode === "new" && (
              <div className="flex rounded-md bg-[#eef2f6] p-0.5">
                {(["rotary", "linear"] as const).map((k) => (
                  <button key={k} type="button" data-motor-kind={k} onClick={() => setDraft(newDraft(k))} className={cn("flex-1 rounded px-2 py-0.5 text-[11.5px]", draft.kind === k ? "bg-white shadow-sm" : "text-[#5b6776]")}>
                    {k === "rotary" ? tr("Rotační") : tr("Lineární")}
                  </button>
                ))}
              </div>
            )}
            {okMates(draft.kind).length ? (
              <select data-motor-mate aria-label={tr("Vazba motoru")} value={draftMate} onChange={(e) => setDraft({ ...newDraft(draft.kind), mode: draft.mode, end: draft.end, speed: draft.speed, mate: e.target.value })} className="w-full rounded border border-[#cfd6de] bg-white px-2 py-1 text-[12px]">
                {okMates(draft.kind).map((m) => (
                  <option key={m.id} value={m.id}>
                    {mateName(m.id)}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-[11px] text-brand-600">{draft.kind === "rotary" ? tr("Sestava nemá vazbu Závěs, Souosost ani Šroub.") : tr("Sestava nemá vazbu Vzdálenost, Drážka, Dráha, Souosost ani Šroub.")}</p>
            )}
            {/* význam hodnot: hodnota vazby (Vzdálenost, Drážka s polohou) × posuv / natočení od výchozí polohy */}
            {dMate && (
              <p data-motor-meaning-text className="text-[10.5px] leading-snug text-[#6b7785]">
                {dAbs
                  ? tr("Začátek a konec jsou hodnoty vazby „{0}“ (teď {1} mm) – ne zdvih. Zdvih = konec − začátek.", mateLabel(dMate), f(dCur, 4))
                  : rot
                    ? tr("Začátek a konec jsou natočení od výchozí polohy (0 = jak díl teď stojí).")
                    : tr("Začátek a konec jsou posuv od výchozí polohy (0 = jak díl teď stojí), ne hodnota vazby.")}
              </p>
            )}
            {/* vazba už má motor se stejným začátkem: uložení ho NAHRADÍ – nebo navázat další úsek (vlna 22, body 3 a 10) */}
            {sameIdx >= 0 && (
              <div data-motor-same={sameIdx + 1} className="rounded bg-[#fff4e5] px-2 py-1 text-[11px] leading-snug text-[#8a5300]">
                ⚠ {tr("Vazba „{0}“ už má motor {1} – uložením ho nahradíte. Další pohyb na téže vazbě zapište jako navazující úsek, nebo motoru dejte jiné časové okno / fázi.", dMate ? mateLabel(dMate) : "", sameIdx + 1)}
                <button type="button" data-motor-append={sameIdx + 1} onClick={() => appendTo(sameIdx)} className="ml-1 underline">
                  {tr("Navázat úsek za motor {0}", sameIdx + 1)}
                </button>
              </div>
            )}
            {/* co motor pohání: řízený díl + díly spojené zámkem / pevnou vazbou, osa a směr (zvýrazněno ve 3D okně) */}
            {chk?.reach && (
              <p data-motor-reach={chk.reach.comps.length} className="rounded bg-[#eef4fb] px-2 py-1 text-[10.5px] leading-snug text-[#24476b]">
                {reachText(chk.reach, doc)}
                {chk.reach.locked.length ? <span className="block">{tr("Díly spojené pevnou vazbou (zámkem) se pohybují společně s řízeným dílem – motor nedávejte každému zvlášť.")}</span> : null}
              </p>
            )}
            {chk?.conflicts.map((c, k) => (
              <p key={k} data-motor-conflict={c.kind} className="rounded bg-brand/10 px-2 py-1 text-[11px] leading-snug text-brand-600">
                ⚠ {c.text}
              </p>
            ))}
            {!draft.legs?.length && (
            <div className="flex rounded-md bg-[#eef2f6] p-0.5" role="group" aria-label={tr("Průběh motoru")}>
              {(["range", "ranged", "open"] as const).map((k) => (
                <button key={k} type="button" data-motor-mode={k} aria-pressed={draft.mode === k} onClick={() => setDraft({ ...draft, mode: k })} className={cn("flex-1 rounded px-1 py-0.5 text-[10.5px] leading-tight", draft.mode === k ? "bg-white shadow-sm" : "text-[#5b6776]")}>
                  {k === "range" ? tr("Rozsah za dobu studie") : k === "ranged" ? tr("Rozsah rychlostí") : tr("Rychlost bez konce")}
                </button>
              ))}
            </div>
            )}
            {draft.mode === "range" && !draft.legs?.length && (
              <label className="flex items-center gap-2 text-[11.5px]">
                <input type="checkbox" data-motor-back className="accent-[#E03930]" checked={!!draft.back} onChange={(e) => setDraft({ ...draft, back: e.target.checked })} />
                {tr("Tam a zpět (sinusově, jako lis)")}
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div data-motor-field="from">
                <Num label={fromLabel} value={dFrom} step={rot ? 15 : 1} suffix={unit} onChange={(v) => setDraft({ ...draft, from: v })} />
              </div>
              {draft.mode !== "open" && !draft.legs?.length &&
                (draft.end === "stroke" ? (
                  // key: pole zdvihu a konce jsou různá pole – bez klíče React znovu použije číselné pole konce i s jeho
                  // rozepsaným textem (po přepnutí ukázalo −5 místo zdvihu −25; kolo 6, nestabilní e2e bodu 11)
                  <div key="stroke" data-motor-field="stroke">
                    <Num label={rot ? tr("Otočení (od začátku, ±)") : tr("Zdvih (od začátku, ±)")} value={dStroke} step={rot ? 15 : 1} suffix={unit} onChange={(v) => setDraft({ ...draft, stroke: v })} />
                  </div>
                ) : (
                  <div key="to" data-motor-field="to">
                    <Num label={toLabel} value={dTo} step={rot ? 15 : 1} suffix={unit} onChange={(v) => setDraft({ ...draft, to: v })} />
                  </div>
                ))}
              {draft.mode !== "range" && !draft.legs?.length && (
                <div data-motor-field="speed">
                  <Num label={draft.mode === "open" ? tr("Rychlost (± = směr)") : tr("Rychlost")} value={dSpeed} step={rot ? 10 : 1} suffix={rot ? tr("ot/min") : "mm/s"} onChange={(v) => setDraft({ ...draft, speed: v })} />
                </div>
              )}
            </div>
            {/* navazující úseky / klíčové polohy (vlna 22, bod 3): kam + čas nebo rychlost; prodleva = stejná hodnota s časem */}
            {draft.legs?.length ? (
              <div data-motor-legs={draft.legs.length} className="space-y-1">
                <p className="text-[10.5px] font-semibold uppercase tracking-wider text-[#4a5664]">{tr("Úseky (klíčové polohy)")}</p>
                {draft.legs.map((g, k) => (
                  <div key={k} data-motor-leg={k + 1} className="grid grid-cols-[1fr_74px_1fr_20px] items-end gap-1">
                    <Num label={tr("{0}. do", k + 1)} value={g.to} step={rot ? 15 : 1} suffix={unit} onChange={(v) => setDraft({ ...draft, legs: draft.legs!.map((x, j) => (j === k ? { ...x, to: v } : x)) })} />
                    <select aria-label={tr("Úsek {0}: čas nebo rychlost", k + 1)} value={g.by} onChange={(e) => setDraft({ ...draft, legs: draft.legs!.map((x, j) => (j === k ? { ...x, by: e.target.value as "time" | "speed" } : x)) })} className="rounded border border-[#cfd6de] bg-white px-1 py-1 text-[11px]">
                      <option value="time">{tr("za čas")}</option>
                      <option value="speed">{tr("rychlostí")}</option>
                    </select>
                    <Num label={g.by === "time" ? tr("čas") : tr("rychlost")} value={g.value} step={g.by === "time" ? 0.1 : rot ? 10 : 1} min={0} suffix={g.by === "time" ? "s" : rot ? tr("ot/min") : "mm/s"} onChange={(v) => setDraft({ ...draft, legs: draft.legs!.map((x, j) => (j === k ? { ...x, value: v } : x)) })} />
                    <button type="button" data-motor-leg-remove={k + 1} title={tr("Odebrat úsek")} onClick={() => setDraft({ ...draft, legs: draft.legs!.filter((_, j) => j !== k) })} className="pb-1 text-[#6b7785] hover:text-brand">
                      <CadIcon name="x" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-1.5">
                  <button type="button" data-motor-leg-add onClick={() => setDraft({ ...draft, legs: [...draft.legs!, { to: draft.legs![draft.legs!.length - 1].to, by: "time", value: 0.2 }] })} className="flex-1 rounded border border-[#cfd6de] bg-white py-0.5 text-[11px] hover:bg-[#f3f6f9]">
                    {tr("+ úsek")}
                  </button>
                  <button type="button" data-motor-leg-return onClick={() => setDraft({ ...draft, legs: [...draft.legs!, { to: dFrom, by: "time", value: 0.3 }] })} className="flex-1 rounded border border-[#cfd6de] bg-white py-0.5 text-[11px] hover:bg-[#f3f6f9]">
                    {tr("+ návrat na začátek")}
                  </button>
                </div>
              </div>
            ) : draft.mode !== "open" ? (
              <button type="button" data-motor-to-legs onClick={toLegs} className="w-full rounded border border-dashed border-[#cfd6de] py-0.5 text-[11px] text-[#4a5664] hover:bg-[#f3f6f9]">
                {tr("+ další úsek / návratový zdvih (klíčové polohy)")}
              </button>
            ) : null}
            {/* časové okno a fáze: od kdy motor jede (vlna 22, bod 3) */}
            <div className="grid grid-cols-3 gap-1.5" data-motor-window>
              <Num label={tr("Začátek [s]")} value={draft.t0 ?? 0} step={0.1} min={0} suffix="s" onChange={(v) => setDraft({ ...draft, t0: v > 0 ? v : undefined })} />
              <Num label={tr("Konec okna [s]")} value={draft.t1 ?? 0} step={0.1} min={0} suffix="s" onChange={(v) => setDraft({ ...draft, t1: v > 0 ? v : undefined })} />
              <label className="block text-[10.5px] text-[#4a5664]">
                {tr("Začne s fází")}
                <select data-motor-phase value={draft.phase ?? ""} onChange={(e) => setDraft({ ...draft, phase: e.target.value || undefined })} className="mt-0.5 w-full rounded border border-[#cfd6de] bg-white px-1 py-1 text-[11px]">
                  <option value="">{tr("(od začátku)")}</option>
                  {(study.phases ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {draft.mode !== "open" && !draft.legs?.length && (
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-[#6b7785]">{tr("Zadat")}</span>
                {(["to", "stroke"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    data-motor-end={k}
                    aria-pressed={draft.end === k}
                    // přepnutí zachová průběh: konec ↔ zdvih se přepočtou z právě zobrazených hodnot
                    onClick={() => setDraft({ ...draft, end: k, from: dFrom, ...(k === "stroke" ? { stroke: dStroke } : { to: dTo }) })}
                    className={cn("rounded border px-1.5 py-0.5", draft.end === k ? "border-[#E03930] bg-white font-medium" : "border-[#cfd6de] text-[#5b6776]")}
                  >
                    {k === "to" ? tr("konec (hodnotu)") : tr("zdvih (relativní posun)")}
                  </button>
                ))}
              </div>
            )}
            {/* vypočtený zdvih, směr a doba – vždy vidět před přidáním */}
            {preview?.mo && (
              <p data-motor-computed className="rounded bg-[#f3f6f9] px-2 py-1 font-mono text-[10.5px] leading-snug text-[#39424d]">
                {motorRangeText(preview.mo, preview.duration)}
                {Math.abs(preview.duration - study.duration) > 1e-9 ? ` · ${tr("délka studie bude {0} s", f(preview.duration, 3))}` : ""}
              </p>
            )}
            {preview?.error && (
              <p data-motor-error className="rounded bg-brand/10 px-2 py-1 text-[11px] text-brand-600">
                {preview.error}
              </p>
            )}
            {preview?.notes.map((x, i) => (
              <p key={i} data-motor-warning={x.code} className="rounded bg-[#fff4e5] px-2 py-1 text-[11px] leading-snug text-[#8a5300]">
                ⚠ {x.text}
                {x.code === "motion.start-jump" && (
                  <button type="button" data-motor-use-current onClick={() => setDraft({ ...draft, from: undefined, ...(draft.end === "to" ? { to: dCur + dStroke } : {}) })} className="ml-1 underline">
                    {tr("Začít od aktuální hodnoty {0} {1}", f(dCur, 4), unit)}
                  </button>
                )}
              </p>
            ))}
            <div className="flex gap-1.5">
              <button type="button" data-motor-add data-motor-save={editor.mode} disabled={!preview?.mo} onClick={addMotor} className="flex-1 rounded bg-brand py-1 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                {editor.mode === "edit" ? tr("Uložit motor {0}", editor.i + 1) : sameIdx >= 0 ? tr("Nahradit motor {0}", sameIdx + 1) : tr("Přidat motor")}
              </button>
              <button type="button" data-motor-cancel onClick={() => setEditor(null)} className="rounded border border-[#cfd6de] bg-white px-2 text-[12px] hover:bg-[#f3f6f9]">
                {tr("Zrušit")}
              </button>
            </div>
          </div>
          )}
        </div>
        {/* fáze studie (vlna 22, bod 3): nájezd, sevření, střih, návrat v jedné časové ose – kinematika / kvazistatika */}
        {study.mode !== "dynamic" && <MotionPhases doc={doc} study={study} onStudy={setStudy} flash={flash} />}
        <div className="grid grid-cols-2 gap-2">
          <Num label={tr("Délka studie")} value={study.duration} step={study.mode === "dynamic" ? 0.1 : 0.5} min={0.01} suffix="s" onChange={(v) => v > 0 && setStudy({ duration: v })} />
          {study.mode !== "dynamic" && <Num label={tr("Počet kroků")} value={study.steps} step={6} min={1} suffix="" onChange={(v) => setStudy({ steps: Math.max(1, Math.min(2000, Math.round(v))) })} />}
        </div>
        {/* upozornění k uloženým motorům pro nynější délku studie (motor nedojede, začátek ≠ aktuální hodnota) – i bez výpočtu */}
        {notes.map((x, i) => (
          <p key={i} data-motion-note={x.code} className="rounded bg-[#fff4e5] px-2 py-1 text-[11px] leading-snug text-[#8a5300]">
            ⚠ {x.text}
            {x.code === "motion.end-unused" && (
              <button type="button" data-motor-to-ranged={Number(x.args[0])} onClick={() => toRanged(Number(x.args[0]) - 1)} className="ml-1 underline">
                {tr("Převést na rozsah × rychlost")}
              </button>
            )}
          </p>
        ))}
        {study.mode === "dynamic" && <DynamicSettings doc={doc} study={study} onStudy={setStudy} env={env} />}
        <label className="flex items-center gap-2">
          <input type="checkbox" data-motion-collisions className="accent-[#E03930]" checked={!!study.collisions} onChange={(e) => setStudy({ collisions: e.target.checked || undefined })} />
          {tr("Kontrolovat kolize v pohybu (pomalejší)")}
        </label>
        <ClearanceSettings doc={doc} study={study} onStudy={setStudy} />
        <ProcessSettings doc={doc} study={study} onStudy={setStudy} />
        <div>
          <label className="flex items-center gap-2">
            <input type="checkbox" data-motion-trace className="accent-[#E03930]" checked={!!study.trace} onChange={(e) => setStudy({ trace: e.target.checked ? { compId: doc.components?.find((c) => !c.fixed)?.id ?? doc.components?.[0]?.id ?? "", point: [0, 0, 0] } : undefined })} />
            {tr("Stopa bodu komponenty")}
          </label>
          {study.trace && (
            <div className="mt-1 space-y-1.5 pl-5">
              <select aria-label={tr("Komponenta stopy")} value={study.trace.compId} onChange={(e) => setStudy({ trace: { ...study.trace!, compId: e.target.value } })} className="w-full rounded border border-[#cfd6de] bg-white px-2 py-1 text-[12px]">
                {(doc.components ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Vec label={tr("Bod v souřadnicích komponenty [mm]")} value={study.trace.point} onChange={(v: Vec3) => setStudy({ trace: { ...study.trace!, point: v } })} />
            </div>
          )}
        </div>
        <div className="flex gap-1.5">
          <button type="button" data-motion-run disabled={(!study.motors.length && study.mode !== "dynamic") || !!busy} onClick={() => void runCompute()} className="flex-1 rounded bg-brand py-1.5 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
            {busy ? tr("Počítám krok {0} z {1}…", busy.k, busy.n) : st.state === "stale" ? tr("Vypočítat pohyb znovu") : tr("Vypočítat pohyb")}
          </button>
          {busy && (
            <button type="button" onClick={() => (cancel.current = true)} className="rounded border border-[#cfd6de] px-2 text-[12px]">
              {tr("Zrušit")}
            </button>
          )}
        </div>
        {errText && (
          <p data-motion-error className="rounded bg-brand/10 p-2 text-[11.5px] text-brand-600">
            {errText}
          </p>
        )}
        {/* stav výsledku: pro který dokument a stav platí – nebo že neplatí / nepočítalo se (nikdy starý souhrn) */}
        <p data-motion-status data-motion-rev={st.state === "ok" ? modelRev(doc) : ""} data-motion-run-id={st.state === "ok" ? (motionRunOf(st.entry.sig)?.id ?? "") : ""} className={cn("rounded px-2 py-1 text-[11px] leading-snug", state === "ok" ? "bg-[#eef7ee] text-[#2f6b35]" : state === "stale" ? "bg-[#fff4e5] text-[#8a5300]" : "bg-[#f3f6f9] text-[#4a5664]")}>
          {state === "running"
            ? tr("Počítám pohyb sestavy „{0}“…", doc.name)
            : st.state === "ok"
              ? // revize modelu (táž funkce jako panel Kolize – engine/result-key.ts) a id výpočtu (vlna 22, body 1 a 12)
                tr("Výsledek platí pro „{0}“ v nynějším stavu · {1} komponent · {2} · {3}{4} · spočítáno {5}", st.entry.doc, st.entry.comps, stepsWord(st.entry.res.steps.length - 1), modelRev(doc), motionRunOf(st.entry.sig) ? tr(" · výpočet {0}", motionRunOf(st.entry.sig)!.id) : "", time(st.entry.at))
              : st.state === "stale"
                ? tr("Výsledek neplatí – od výpočtu se změnilo: {0}. Nezkontrolováno; spusťte Vypočítat pohyb znovu.", st.changed.join("; "))
                : study.motors.length || study.mode === "dynamic"
                  ? tr("Nezkontrolováno – pro sestavu „{0}“ v tomto stavu se pohyb ještě nepočítal.", doc.name)
                  : tr("Nezkontrolováno – studie nemá motor.")}
        </p>
        {res && cur && (
          <div data-motion-result className="space-y-2 border-t border-[#e3e8ee] pt-2">
            {/* pásy fází nad časovou osou: skutečný okamžik začátku každé fáze (klik = první krok fáze) */}
            <PhaseTimeline res={res} onStep={(i) => (setPlay(null), setPos({ res, i }))} />
            <div className="flex items-center gap-2">
              <button type="button" data-motion-play aria-label={playing ? tr("Pauza") : tr("Přehrát")} onClick={() => (playing ? setPlay(null) : (step >= res.steps.length - 1 && setPos({ res, i: 0 }), setPlay(res)))} className="rounded border border-[#cfd6de] bg-white px-2.5 py-1 text-[12px] font-semibold hover:bg-[#f3f6f9]">
                {playing ? "❚❚" : "▶"}
              </button>
              <input type="range" data-motion-scrub aria-label={tr("Časová osa")} min={0} max={res.steps.length - 1} step={1} value={step} onChange={(e) => (setPlay(null), setPos({ res, i: Number(e.target.value) }))} className="min-w-0 flex-1 accent-[#E03930]" />
              <label className="flex items-center gap-1 text-[11px]">
                <input type="checkbox" data-motion-loop className="accent-[#E03930]" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
                {tr("Smyčka")}
              </label>
            </div>
            <p data-motion-step className="font-mono text-[11px] text-[#4a5664]">
              {tr("krok {0}/{1} · t = {2} s · motory {3}", cur.i, res.steps.length - 1, f(cur.t, 3), cur.motors.map((v, i) => `${f(v)}${res.motors[i]?.kind === "rotary" ? "°" : " mm"}`).join(", "))}
              {cur.phase !== undefined && res.phases?.[cur.phase] ? <span data-motion-step-phase={cur.phase + 1}> · {tr("fáze {0} „{1}“", cur.phase + 1, res.phases[cur.phase].name)}</span> : null}
              {stepHasFault(doc, cur) ? <span className="text-brand"> · {tr("kolize")}</span> : null}
              {cur.conflicts.length ? <span className="text-brand"> · {tr("nesplněno {0}", cur.conflicts.length)}</span> : null}
              {/* krok s konfliktem (bod 8): motor stojí na mezi / neřešitelný krok s poslední platnou polohou */}
              {cur.status === "stopped" ? (
                <span data-motion-step-status="stopped" className="text-brand">
                  {" "}· {tr("motor stojí na mezi: {0}", (cur.reached ?? []).map((v, i) => `${f(v)}${res.motors[i]?.kind === "rotary" ? "°" : " mm"}`).join(", "))}
                </span>
              ) : cur.status === "invalid" ? (
                <span data-motion-step-status="invalid" className="font-semibold text-brand">
                  {" "}· {tr("NEŘEŠITELNÝ krok – zobrazen krok {0}", cur.shows ?? 0)}
                </span>
              ) : null}
            </p>
            {cur.devs?.length ? (
              <ul data-motion-step-devs className="space-y-0.5 rounded bg-[#fff4e5] px-2 py-1 text-[10.5px] leading-snug text-[#8a5300]">
                {cur.devs.map((x) => (
                  <li key={x.id}>{devText(x)}</li>
                ))}
              </ul>
            ) : null}
            <DynChart res={res} doc={doc} step={step} />
            {findings.map((x, i) => (
              <p key={i} data-motion-finding={x.code} data-motion-finding-steps={x.steps ? `${x.steps[0]}-${x.steps[1]}` : ""} className="rounded bg-[#fff4e5] px-2 py-1 text-[11px] leading-snug text-[#8a5300]">
                ⚠ {x.text}
              </p>
            ))}
            <ClearanceResult res={res} doc={doc} step={step} onStep={(i) => (setPlay(null), setPos({ res, i: Math.max(0, Math.min(res.steps.length - 1, i)) }))} />
            <ProcessState res={res} doc={doc} step={step} />
            <label className="flex items-center gap-1.5 text-[11px] text-[#4a5664]">
              <input type="checkbox" data-motion-detail className="accent-[#E03930]" checked={detail} onChange={(e) => setDetail(e.target.checked)} />
              {tr("Detail po dílech (jinak tuhé skupiny)")}
            </label>
            <ul data-motion-summary data-motion-summary-mode={detail ? "detail" : "groups"} className="space-y-0.5 text-[11px] leading-snug text-[#4a5664]">
              {summary.map((l, i) => (
                <li key={i} className={cn((l.startsWith("⚠") || l.startsWith(" ⚠")) && "text-brand-600")}>
                  {l}
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-3 gap-1.5">
              <button type="button" data-motion-export="csv" onClick={() => void runExport("csv")} className="rounded border border-[#cfd6de] py-1 text-[11.5px] hover:bg-[#f3f6f9]">
                {tr("Tabulka CSV")}
              </button>
              <button type="button" data-motion-export="png" onClick={() => void runExport("png")} className="rounded border border-[#cfd6de] py-1 text-[11.5px] hover:bg-[#f3f6f9]">
                {tr("Snímky PNG")}
              </button>
              <button type="button" data-motion-export="webm" onClick={() => void runExport("webm")} className="rounded border border-[#cfd6de] py-1 text-[11.5px] hover:bg-[#f3f6f9]">
                {rec ?? tr("Video WebM")}
              </button>
            </div>
          </div>
        )}
      </div>
    </FloatPanel>
    )}
    <MotionPlayer
      doc={doc}
      study={study}
      res={res}
      state={state}
      step={step}
      playing={playing}
      loop={loop}
      speed={speed}
      compact={compact}
      host={player}
      busy={rec}
      report={report}
      onStep={(i) => res && (setPlay(null), setPos({ res, i }))}
      onPlay={(on) => res && (on ? (step >= res.steps.length - 1 && setPos({ res, i: 0 }), setPlay(res)) : setPlay(null))}
      onLoop={setLoop}
      onSpeed={setSpeed}
      onCompact={setCompact}
      onCompute={() => void runCompute()}
      onStudy={setStudy}
      onExport={(k) => void runExport(k)}
      onCancel={() => (exportCancel.current = true)}
      onApplyView={(id) => applyView(id, true)}
      onClose={onClose}
    />
    </>
  );
}

/** motor bez volby „na mezi“ (výchozí stop se neukládá) */
function withoutAtLimit<T extends { atLimit?: unknown }>(x: T): Omit<T, "atLimit"> {
  const y = { ...x };
  delete y.atLimit;
  return y;
}
