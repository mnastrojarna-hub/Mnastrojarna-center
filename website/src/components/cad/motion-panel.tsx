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
import { motionCached, motionRun, type MotionSignal } from "@/cad/asm-agent-kin";
import type { AsmEnv } from "@/cad/asm-agent";
import { writeZip } from "@/cad/formats/zip";
import { cadLocale, tr } from "@/cad/i18n";
import { MATE_LABEL } from "@/cad/mates";
import { LINEAR_MOTOR_TYPES, ROTARY_MOTOR_TYPES } from "@/cad/mates-kin";
import { defaultStudy, motionMotorNotes, type MotionResult } from "@/cad/motion";
import { MotionSuperseded, motionRunning, motionSig, motionSlot, motionState, subscribeMotionStore, type MotionState } from "@/cad/motion-cache";
import { buildMotor, fitDuration, motorCurrent, motorIsAbsolute, motorMeaningText, motorNotes, motorRangeText, type MotorInput } from "@/cad/motor-model";
import { studyCsv as motionCsv, studySummary as motionSummary } from "@/cad/motion-dynamic-report";
import { DynChart, DynamicSettings, MotionModeSwitch } from "./motion-dynamic-panel";
import type { SpringStep } from "@/cad/asm-spring";
import { uid, type CadDoc, type MotionStudy, type Placement, type Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";
import { CadIcon } from "./cad-icons";
import { Num, Vec } from "./props";
import { FloatPanel } from "./ui";

/* ───────────────────────── sdílený stav zobrazení (poloha kroku, stopa) a pokyny z textových příkazů ───────────────────────── */

/** `springs` = délky pružin v kroku (cad/asm-spring.ts) – zobrazení protáhne síť volné pružiny */
type View = { pose: Record<string, Placement> | null; trace: Vec3[] | null; springs?: Record<string, SpringStep> | null };
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
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
const b64ToU8 = (d: string) => Uint8Array.from(atob(d.split(",")[1] ?? ""), (ch) => ch.charCodeAt(0));


/** stav výsledku pro otisk dokumentu `sig` (starší stav se při vykreslení jiného dokumentu nepoužije ani na jeden snímek) */
type Live = { sig: string; key: string; st: MotionState; running: boolean };
/** rozpracovaný motor formuláře: nevyplněná pole (undefined) se berou z vazby – začátek = aktuální hodnota, konec = začátek + výchozí zdvih */
type Draft = { kind: "rotary" | "linear"; mate: string; from?: number; to?: number; stroke?: number; end: "to" | "stroke"; mode: "range" | "ranged" | "open"; speed?: number; back?: boolean };
const newDraft = (kind: "rotary" | "linear"): Draft => ({ kind, mate: "", end: "to", mode: "range" });

export function MotionPanel({
  doc,
  env,
  onDoc,
  onClose,
  snapshot,
  canvas,
  flash,
  engineBusy,
}: {
  doc: CadDoc;
  env: () => AsmEnv;
  /** změna definice studie (uloží se do sestavy) */
  onDoc: (d: CadDoc) => void;
  onClose: () => void;
  /** PNG 3D okna (data URL) */
  snapshot: () => string | null;
  /** plátno 3D okna (video WebM) */
  canvas: () => HTMLCanvasElement | null;
  flash: (t: string) => void;
  /** běží běh textových příkazů (dokument běhu se zapisuje až na jeho konci) – pokyny a výpočet panelu na něj počkají */
  engineBusy?: () => boolean;
}) {
  const study: MotionStudy = doc.motion ?? defaultStudy();
  const mates = useMemo(() => (doc.mates ?? []).filter((m) => !m.suppressed && (ROTARY_MOTOR_TYPES.has(m.type) || LINEAR_MOTOR_TYPES.has(m.type))), [doc.mates]);
  const [busy, setBusy] = useState<{ k: number; n: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loop, setLoop] = useState(!!study.loop);
  const [rec, setRec] = useState<string | null>(null);
  const cancel = useRef(false);
  /** otisk dokumentu, který se právě počítá (změní-li se dokument, výpočet zastaralého vstupu se zruší) */
  const computing = useRef<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => newDraft("rotary"));
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
  const busyRef = useRef(engineBusy);
  busyRef.current = engineBusy;
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
    motionView.set({ pose: s?.place ?? null, trace: trace.length > 1 ? trace : null, springs: s?.springs ?? null });
  }, [res, step]);
  useEffect(() => () => motionView.set({ pose: null, trace: null }), []);
  const compute = useCallback(async (): Promise<MotionResult | null> => {
    const d = docRef.current;
    const n = (d.motion ?? defaultStudy()).steps;
    setErr(null);
    cancel.current = false;
    computing.current = motionSig(d);
    setBusy({ k: 0, n });
    try {
      // výsledek se uloží pod otiskem `d`; platí-li pak pro zobrazený dokument, panel ho ukáže sám (stav z úložiště)
      return await motionRun(d, envRef.current(), { onStep: (k, nn) => setBusy({ k, n: nn }), cancel: () => cancel.current });
    } catch (e) {
      if (!(e instanceof MotionSuperseded)) setErr((e as Error).message);
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
  // přehrávání: krok za dobu studie / počet kroků (nejméně 30 ms), smyčka
  useEffect(() => {
    if (!playing || !res) return;
    const dt = Math.max(30, (1000 * study.duration) / Math.max(1, res.steps.length - 1));
    const t = setInterval(() => {
      setPos((p) => {
        const i = p?.res === res ? p.i : 0;
        if (i + 1 < res.steps.length) return { res, i: i + 1 };
        if (loop) return { res, i: 0 };
        setPlay(null);
        return { res, i };
      });
    }, dt);
    return () => clearInterval(t);
  }, [playing, res, loop, study.duration]);
  const exportPng = async (r: MotionResult) => {
    const files: { name: string; data: Uint8Array }[] = [];
    for (let i = 0; i < r.steps.length; i++) {
      setPos({ res: r, i });
      await frame();
      const png = snapshot();
      if (png) files.push({ name: `krok-${String(i).padStart(4, "0")}.png`, data: b64ToU8(png) });
    }
    if (!files.length) return flash(tr("Snímek 3D okna se nepodařilo pořídit."));
    files.push({ name: "studie.csv", data: new TextEncoder().encode(motionCsv(r, doc)) });
    save(`${doc.name || "sestava"}-pohyb-snimky.zip`, writeZip(files) as BlobPart, "application/zip");
    flash(tr("Uloženo {0} snímků PNG (ZIP) a tabulka CSV.", files.length - 1));
  };
  const exportWebm = async (r: MotionResult) => {
    const cv = canvas();
    const Rec = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
    if (!cv || !Rec || !cv.captureStream) return flash(tr("Prohlížeč neumí nahrát video z 3D okna – použijte snímky PNG."));
    const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => Rec.isTypeSupported?.(t)) ?? "video/webm";
    const fps = Math.max(5, Math.min(30, Math.round((r.steps.length - 1) / Math.max(0.1, study.duration))));
    const stream = cv.captureStream(fps);
    const chunks: Blob[] = [];
    const mr = new Rec(stream, { mimeType: type });
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((ok) => (mr.onstop = () => ok()));
    setRec(tr("Nahrávám video…"));
    mr.start();
    for (let i = 0; i < r.steps.length; i++) {
      setPos({ res: r, i });
      await new Promise((ok) => setTimeout(ok, 1000 / fps));
    }
    mr.stop();
    await done;
    setRec(null);
    stream.getTracks().forEach((t) => t.stop());
    save(`${doc.name || "sestava"}-pohyb.webm`, new Blob(chunks, { type }), "video/webm");
    flash(tr("Video WebM uloženo ({0} snímků, {1} fps).", r.steps.length, fps));
  };
  /** export jen z výsledku, který platí pro zobrazený dokument – jinak se nejdřív spočítá */
  const runExport = async (kind: "csv" | "png" | "webm") => {
    if (!(await waitEngine())) return;
    const d = docRef.current;
    const r = motionCached(d, envRef.current()) ?? (await compute());
    if (!r || motionCached(docRef.current, envRef.current()) !== r) return;
    setPlay(null);
    if (kind === "csv") save(`${d.name || "sestava"}-pohyb.csv`, motionCsv(r, d), "text/csv;charset=utf-8");
    else if (kind === "png") await exportPng(r);
    else await exportWebm(r);
  };
  // pokyny z textových příkazů „pohyb přehrát / krok / export“: až po doběhnutí běhu (dokument běhu se zapisuje na jeho konci –
  // dřív panel pokyn zpracoval se STARÝM dokumentem a spočítal a přehrál původní studii, bod 12 zprávy)
  const handlers = useRef({ compute, runExport });
  handlers.current = { compute, runExport };
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
            if (s.export) await handlers.current.runExport(s.export);
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
  const dInput: MotorInput = { kind: draft.kind, from: dFrom, ...(draft.mode === "open" ? {} : draft.end === "stroke" ? { stroke: dStroke } : { to: dTo }), ...(draft.mode !== "range" ? { speed: dSpeed } : {}), ...(draft.back && draft.mode === "range" ? { back: true } : {}) };
  // náhled motoru, délky studie a upozornění ještě před přidáním
  const preview = useMemo(() => {
    if (!dMate) return null;
    try {
      const i = study.motors.findIndex((x) => x.mate === dMate.id);
      const mo = buildMotor(dInput, { id: i >= 0 ? study.motors[i].id : "draft", mate: dMate.id, abs: dAbs, current: dCur });
      const motors = i >= 0 ? study.motors.map((x, k) => (k === i ? mo : x)) : [...study.motors, mo];
      const fit = fitDuration({ ...study, motors }, i >= 0 ? i : motors.length - 1);
      const notes = motorNotes({ motors: [mo], duration: fit.duration, collisions: study.collisions }, doc.mates ?? [], (m) => m.name ?? tr(MATE_LABEL[m.type]));
      return { mo, motors, duration: fit.duration, extended: fit.note?.text ?? null, notes, error: null as string | null };
    } catch (e) {
      return { mo: null, motors: null, duration: study.duration, extended: null, notes: [], error: (e as Error).message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dMate, JSON.stringify(dInput), dAbs, dCur, study]);
  const addMotor = () => {
    if (!preview?.mo || !preview.motors) return;
    setStudy({ motors: preview.motors.map((m) => (m.id === "draft" ? { ...m, id: uid() } : m)), duration: preview.duration });
    if (preview.extended) flash(preview.extended);
  };
  const cur = res?.steps[step];
  // upozornění k motorům zvlášť (i bez výpočtu – níže), v souhrnu výsledku by byla podruhé
  const summary = res ? motionSummary(res, doc, { notes: false }) : [];
  const notes = res ? motionMotorNotes(res, doc) : motorNotes(study, doc.mates ?? [], (m) => m.name ?? tr(MATE_LABEL[m.type]));
  const fromLabel = dAbs ? tr("Začátek – hodnota vazby") : rot ? tr("Začátek – natočení od výchozí polohy") : tr("Začátek – posuv od výchozí polohy");
  const toLabel = dAbs ? tr("Konec – hodnota vazby") : rot ? tr("Konec – natočení od výchozí polohy") : tr("Konec – posuv od výchozí polohy");
  const time = (ms: number) => new Date(ms).toLocaleTimeString(cadLocale(), { hour: "2-digit", minute: "2-digit" });
  return (
    <FloatPanel title={tr("Pohybová studie")} icon="transform" tone="pattern" width={352} initial={{ x: 12, y: 56 }} onClose={onClose}>
      <div data-motion-panel data-motion-state={state} data-motion-doc={doc.name} data-motion-key={live?.key ?? ""} className="max-h-[70vh] space-y-3 overflow-y-auto p-3 text-[12px]">
        {/* kinematika (motory) / dynamika (síly pružin, gravitace – cad/motion-dynamic.ts) */}
        <MotionModeSwitch study={study} onStudy={setStudy} />
        <div>
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#4a5664]">{tr("Motory")}</p>
          {study.motors.length ? (
            <ul className="space-y-1" data-motion-motors>
              {study.motors.map((mo, i) => {
                const mm = doc.mates?.find((x) => x.id === mo.mate);
                const abs = motorIsAbsolute(mo, mm);
                return (
                  <li key={mo.id} data-motor={mo.id} data-motor-meaning={abs ? "absolute" : "relative"} className="flex items-center gap-1.5 rounded border border-[#d5dbe2] bg-white px-2 py-1">
                    <CadIcon name={mo.kind === "rotary" ? "revolve" : "extrude"} className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{mo.kind === "rotary" ? tr("Rotační") : tr("Lineární")} · {mateName(mo.mate)}</span>
                      {/* začátek → konec, zdvih, směr, rychlost a doba – stejný text jako protokol (motorText) */}
                      <span data-motor-range className="block font-mono text-[10.5px] text-[#6b7785]">
                        {motorMeaningText(mo, abs, study.duration)}
                      </span>
                    </span>
                    <button type="button" title={tr("Odebrat motor")} onClick={() => setStudy({ motors: study.motors.filter((_, k) => k !== i) })} className="text-[#6b7785] hover:text-brand">
                      <CadIcon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[11px] text-[#6b7785]">{tr("Zatím žádný motor. Rotační motor otáčí komponentou na vazbě Závěs / Souosost / Šroub, lineární ji posouvá na vazbě Vzdálenost / Drážka / Dráha / Souosost.")}</p>
          )}
          <div className="mt-2 space-y-1.5 rounded border border-dashed border-[#cfd6de] p-2" data-motion-add data-motor-meaning={dAbs ? "absolute" : "relative"}>
            <div className="flex rounded-md bg-[#eef2f6] p-0.5">
              {(["rotary", "linear"] as const).map((k) => (
                <button key={k} type="button" data-motor-kind={k} onClick={() => setDraft(newDraft(k))} className={cn("flex-1 rounded px-2 py-0.5 text-[11.5px]", draft.kind === k ? "bg-white shadow-sm" : "text-[#5b6776]")}>
                  {k === "rotary" ? tr("Rotační") : tr("Lineární")}
                </button>
              ))}
            </div>
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
            <div className="flex rounded-md bg-[#eef2f6] p-0.5" role="group" aria-label={tr("Průběh motoru")}>
              {(["range", "ranged", "open"] as const).map((k) => (
                <button key={k} type="button" data-motor-mode={k} aria-pressed={draft.mode === k} onClick={() => setDraft({ ...draft, mode: k })} className={cn("flex-1 rounded px-1 py-0.5 text-[10.5px] leading-tight", draft.mode === k ? "bg-white shadow-sm" : "text-[#5b6776]")}>
                  {k === "range" ? tr("Rozsah za dobu studie") : k === "ranged" ? tr("Rozsah rychlostí") : tr("Rychlost bez konce")}
                </button>
              ))}
            </div>
            {draft.mode === "range" && (
              <label className="flex items-center gap-2 text-[11.5px]">
                <input type="checkbox" data-motor-back className="accent-[#E03930]" checked={!!draft.back} onChange={(e) => setDraft({ ...draft, back: e.target.checked })} />
                {tr("Tam a zpět (sinusově, jako lis)")}
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div data-motor-field="from">
                <Num label={fromLabel} value={dFrom} step={rot ? 15 : 1} suffix={unit} onChange={(v) => setDraft({ ...draft, from: v })} />
              </div>
              {draft.mode !== "open" &&
                (draft.end === "stroke" ? (
                  <div data-motor-field="stroke">
                    <Num label={rot ? tr("Otočení (od začátku, ±)") : tr("Zdvih (od začátku, ±)")} value={dStroke} step={rot ? 15 : 1} suffix={unit} onChange={(v) => setDraft({ ...draft, stroke: v })} />
                  </div>
                ) : (
                  <div data-motor-field="to">
                    <Num label={toLabel} value={dTo} step={rot ? 15 : 1} suffix={unit} onChange={(v) => setDraft({ ...draft, to: v })} />
                  </div>
                ))}
              {draft.mode !== "range" && (
                <div data-motor-field="speed">
                  <Num label={draft.mode === "open" ? tr("Rychlost (± = směr)") : tr("Rychlost")} value={dSpeed} step={rot ? 10 : 1} suffix={rot ? tr("ot/min") : "mm/s"} onChange={(v) => setDraft({ ...draft, speed: v })} />
                </div>
              )}
            </div>
            {draft.mode !== "open" && (
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
            <button type="button" data-motor-add disabled={!preview?.mo} onClick={addMotor} className="w-full rounded border border-[#cfd6de] bg-white py-1 text-[12px] hover:bg-[#f3f6f9] disabled:opacity-50">
              {tr("Přidat motor")}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Num label={tr("Délka studie")} value={study.duration} step={study.mode === "dynamic" ? 0.1 : 0.5} min={0.01} suffix="s" onChange={(v) => v > 0 && setStudy({ duration: v })} />
          {study.mode !== "dynamic" && <Num label={tr("Počet kroků")} value={study.steps} step={6} min={1} suffix="" onChange={(v) => setStudy({ steps: Math.max(1, Math.min(2000, Math.round(v))) })} />}
        </div>
        {/* upozornění k uloženým motorům pro nynější délku studie (motor nedojede, začátek ≠ aktuální hodnota) – i bez výpočtu */}
        {notes.map((x, i) => (
          <p key={i} data-motion-note={x.code} className="rounded bg-[#fff4e5] px-2 py-1 text-[11px] leading-snug text-[#8a5300]">
            ⚠ {x.text}
          </p>
        ))}
        {study.mode === "dynamic" && <DynamicSettings doc={doc} study={study} onStudy={setStudy} env={env} />}
        <label className="flex items-center gap-2">
          <input type="checkbox" data-motion-collisions className="accent-[#E03930]" checked={!!study.collisions} onChange={(e) => setStudy({ collisions: e.target.checked || undefined })} />
          {tr("Kontrolovat kolize v každém kroku (pomalejší)")}
        </label>
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
        {err && <p className="rounded bg-brand/10 p-2 text-[11.5px] text-brand-600">{err}</p>}
        {/* stav výsledku: pro který dokument a stav platí – nebo že neplatí / nepočítalo se (nikdy starý souhrn) */}
        <p data-motion-status className={cn("rounded px-2 py-1 text-[11px] leading-snug", state === "ok" ? "bg-[#eef7ee] text-[#2f6b35]" : state === "stale" ? "bg-[#fff4e5] text-[#8a5300]" : "bg-[#f3f6f9] text-[#4a5664]")}>
          {state === "running"
            ? tr("Počítám pohyb sestavy „{0}“…", doc.name)
            : st.state === "ok"
              ? tr("Výsledek platí pro „{0}“ v nynějším stavu · {1} komponent · {2} kroků · spočítáno {3}", st.entry.doc, st.entry.comps, st.entry.res.steps.length - 1, time(st.entry.at))
              : st.state === "stale"
                ? tr("Výsledek neplatí – od výpočtu se změnilo: {0}. Nezkontrolováno; spusťte Vypočítat pohyb znovu.", st.changed.join("; "))
                : study.motors.length || study.mode === "dynamic"
                  ? tr("Nezkontrolováno – pro sestavu „{0}“ v tomto stavu se pohyb ještě nepočítal.", doc.name)
                  : tr("Nezkontrolováno – studie nemá motor.")}
        </p>
        {res && cur && (
          <div data-motion-result className="space-y-2 border-t border-[#e3e8ee] pt-2">
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
              {cur.clashes?.length ? <span className="text-brand"> · {tr("kolize")}</span> : null}
              {cur.conflicts.length ? <span className="text-brand"> · {tr("nesplněno {0}", cur.conflicts.length)}</span> : null}
            </p>
            <DynChart res={res} doc={doc} step={step} />
            <ul data-motion-summary className="space-y-0.5 text-[11px] leading-snug text-[#4a5664]">
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
  );
}
