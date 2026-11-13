"use client";

/**
 * Pohybová studie (karta Sestava): motory na vazbách, délka a počet kroků, kolize, stopa bodu; výpočet řešičem (cad/motion.ts),
 * časová osa s přehráváním / pauzou / posuvníkem a smyčkou, souhrn (první kolize, nesplněné vazby) a export tabulky CSV,
 * snímků PNG (ZIP) a videa WebM (MediaRecorder). Poloha komponent v kroku se zobrazí bez zápisu do historie (`motionView`).
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { fmt } from "@/cad/agent-asm";
import { motionCached, motionRun, type MotionSignal } from "@/cad/asm-agent-kin";
import type { AsmEnv } from "@/cad/asm-agent";
import { writeZip } from "@/cad/formats/zip";
import { tr } from "@/cad/i18n";
import { MATE_LABEL } from "@/cad/mates";
import { LINEAR_MOTOR_TYPES, ROTARY_MOTOR_TYPES } from "@/cad/mates-kin";
import { defaultStudy, motionCsv, motionSummary, type MotionResult } from "@/cad/motion";
import { uid, type CadDoc, type MotionMotor, type MotionStudy, type Placement, type Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";
import { CadIcon } from "./cad-icons";
import { Num, Vec } from "./props";
import { FloatPanel } from "./ui";

/* ───────────────────────── sdílený stav zobrazení (poloha kroku, stopa) a pokyny z textových příkazů ───────────────────────── */

type View = { pose: Record<string, Placement> | null; trace: Vec3[] | null };
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

export function MotionPanel({
  doc,
  env,
  onDoc,
  onClose,
  snapshot,
  canvas,
  flash,
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
}) {
  const study: MotionStudy = doc.motion ?? defaultStudy();
  const mates = useMemo(() => (doc.mates ?? []).filter((m) => !m.suppressed && (ROTARY_MOTOR_TYPES.has(m.type) || LINEAR_MOTOR_TYPES.has(m.type))), [doc.mates]);
  const [res, setRes] = useState<MotionResult | null>(() => motionCached(doc));
  const [busy, setBusy] = useState<{ k: number; n: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(!!study.loop);
  const [rec, setRec] = useState<string | null>(null);
  const cancel = useRef(false);
  const [draft, setDraft] = useState<{ kind: "rotary" | "linear"; mate: string; from: number; to: number; speed?: number }>({ kind: "rotary", mate: "", from: 0, to: 360 });
  const setStudy = (s: Partial<MotionStudy>) => onDoc({ ...doc, motion: { ...study, ...s } });
  const name = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? "?";
  const mateName = (id: string) => {
    const m = doc.mates?.find((x) => x.id === id);
    return m ? `${(doc.mates ?? []).indexOf(m) + 1}. ${m.name ?? tr(MATE_LABEL[m.type])} · ${name(m.a.compId)} → ${name(m.b.compId)}` : tr("(vazba chybí)");
  };
  const okMates = (kind: "rotary" | "linear") => mates.filter((m) => (kind === "rotary" ? ROTARY_MOTOR_TYPES : LINEAR_MOTOR_TYPES).has(m.type));
  const draftMate = okMates(draft.kind).some((m) => m.id === draft.mate) ? draft.mate : (okMates(draft.kind)[0]?.id ?? "");
  // výsledek patří k aktuální sestavě a studii – po změně se zahodí
  const resDoc = useRef<CadDoc | null>(null);
  useEffect(() => {
    const hit = motionCached(doc);
    if (hit !== res) {
      setRes(hit);
      setPlaying(false);
      setStep(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);
  // zobrazení kroku v 3D okně
  useEffect(() => {
    if (!res) {
      motionView.set({ pose: null, trace: null });
      return;
    }
    const s = res.steps[Math.min(step, res.steps.length - 1)];
    const trace = res.steps.slice(0, step + 1).flatMap((x) => (x.trace ? [x.trace] : []));
    motionView.set({ pose: s?.place ?? null, trace: trace.length > 1 ? trace : null });
  }, [res, step]);
  useEffect(() => () => motionView.set({ pose: null, trace: null }), []);
  const compute = useCallback(async (): Promise<MotionResult | null> => {
    setErr(null);
    cancel.current = false;
    setBusy({ k: 0, n: study.steps });
    try {
      const r = await motionRun(doc, env(), { onStep: (k, n) => setBusy({ k, n }), cancel: () => cancel.current });
      resDoc.current = doc;
      setRes(r);
      setStep(0);
      return r;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }, [doc, env, study.steps]);
  // přehrávání: krok za dobu studie / počet kroků (nejméně 30 ms), smyčka
  useEffect(() => {
    if (!playing || !res) return;
    const dt = Math.max(30, (1000 * study.duration) / Math.max(1, res.steps.length - 1));
    const t = setInterval(() => {
      setStep((s) => {
        if (s + 1 < res.steps.length) return s + 1;
        if (loop) return 0;
        setPlaying(false);
        return s;
      });
    }, dt);
    return () => clearInterval(t);
  }, [playing, res, loop, study.duration]);
  const exportPng = async (r: MotionResult) => {
    const files: { name: string; data: Uint8Array }[] = [];
    for (let i = 0; i < r.steps.length; i++) {
      setStep(i);
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
      setStep(i);
      await new Promise((ok) => setTimeout(ok, 1000 / fps));
    }
    mr.stop();
    await done;
    setRec(null);
    stream.getTracks().forEach((t) => t.stop());
    save(`${doc.name || "sestava"}-pohyb.webm`, new Blob(chunks, { type }), "video/webm");
    flash(tr("Video WebM uloženo ({0} snímků, {1} fps).", r.steps.length, fps));
  };
  const runExport = async (kind: "csv" | "png" | "webm") => {
    const r = res ?? (await compute());
    if (!r) return;
    setPlaying(false);
    if (kind === "csv") save(`${doc.name || "sestava"}-pohyb.csv`, motionCsv(r, doc), "text/csv;charset=utf-8");
    else if (kind === "png") await exportPng(r);
    else await exportWebm(r);
  };
  // pokyny z textových příkazů „pohyb přehrát / krok / export“
  const handlers = useRef({ compute, runExport });
  handlers.current = { compute, runExport };
  useEffect(() => {
    const drain = async () => {
      while (queue.length) {
        const s = queue.shift()!;
        if (s.stop) setPlaying(false);
        if (s.play || s.step !== undefined || s.export) {
          const r = motionCached(doc) ?? (await handlers.current.compute());
          if (!r) continue;
          setRes(r);
          if (s.step !== undefined) {
            setPlaying(false);
            setStep(s.step);
          }
          if (s.play) {
            if (s.loop) setLoop(true);
            setStep(0);
            setPlaying(true);
          }
          if (s.export && s.export !== "csv") await handlers.current.runExport(s.export);
        } else if (s.open) setRes(motionCached(doc));
      }
    };
    void drain();
    const fn = () => void drain();
    sigSubs.add(fn);
    return () => void sigSubs.delete(fn);
  }, [doc]);
  const addMotor = () => {
    if (!draftMate) return;
    const mo: MotionMotor = { id: uid(), kind: draft.kind, mate: draftMate, from: draft.from, to: draft.to, ...(draft.speed !== undefined ? { speed: draft.speed } : {}) };
    const i = study.motors.findIndex((x) => x.mate === draftMate);
    setStudy({ motors: i >= 0 ? study.motors.map((x, k) => (k === i ? { ...mo, id: x.id } : x)) : [...study.motors, mo] });
  };
  const cur = res?.steps[Math.min(step, (res?.steps.length ?? 1) - 1)];
  const summary = res ? motionSummary(res, doc) : [];
  return (
    <FloatPanel title={tr("Pohybová studie")} icon="transform" tone="pattern" width={352} initial={{ x: 12, y: 56 }} onClose={onClose}>
      <div data-motion-panel className="max-h-[70vh] space-y-3 overflow-y-auto p-3 text-[12px]">
        <div>
          <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#4a5664]">{tr("Motory")}</p>
          {study.motors.length ? (
            <ul className="space-y-1" data-motion-motors>
              {study.motors.map((mo, i) => (
                <li key={mo.id} data-motor={mo.id} className="flex items-center gap-1.5 rounded border border-[#d5dbe2] bg-white px-2 py-1">
                  <CadIcon name={mo.kind === "rotary" ? "revolve" : "extrude"} className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{mo.kind === "rotary" ? tr("Rotační") : tr("Lineární")} · {mateName(mo.mate)}</span>
                    <span className="block font-mono text-[10.5px] text-[#6b7785]">
                      {mo.speed !== undefined ? (mo.kind === "rotary" ? tr("{0} ot/min", f(mo.speed, 3)) : tr("{0} mm/s", f(mo.speed, 3))) : `${f(mo.from)} … ${f(mo.to)} ${mo.kind === "rotary" ? "°" : "mm"}`}
                    </span>
                  </span>
                  <button type="button" title={tr("Odebrat motor")} onClick={() => setStudy({ motors: study.motors.filter((_, k) => k !== i) })} className="text-[#6b7785] hover:text-brand">
                    <CadIcon name="trash" className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-[#6b7785]">{tr("Zatím žádný motor. Rotační motor otáčí komponentou na vazbě Závěs / Souosost / Šroub, lineární ji posouvá na vazbě Vzdálenost / Drážka / Dráha / Souosost.")}</p>
          )}
          <div className="mt-2 space-y-1.5 rounded border border-dashed border-[#cfd6de] p-2" data-motion-add>
            <div className="flex rounded-md bg-[#eef2f6] p-0.5">
              {(["rotary", "linear"] as const).map((k) => (
                <button key={k} type="button" data-motor-kind={k} onClick={() => setDraft({ kind: k, mate: "", from: 0, to: k === "rotary" ? 360 : 10 })} className={cn("flex-1 rounded px-2 py-0.5 text-[11.5px]", draft.kind === k ? "bg-white shadow-sm" : "text-[#5b6776]")}>
                  {k === "rotary" ? tr("Rotační") : tr("Lineární")}
                </button>
              ))}
            </div>
            {okMates(draft.kind).length ? (
              <select data-motor-mate aria-label={tr("Vazba motoru")} value={draftMate} onChange={(e) => setDraft({ ...draft, mate: e.target.value })} className="w-full rounded border border-[#cfd6de] bg-white px-2 py-1 text-[12px]">
                {okMates(draft.kind).map((m) => (
                  <option key={m.id} value={m.id}>
                    {mateName(m.id)}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-[11px] text-brand-600">{draft.kind === "rotary" ? tr("Sestava nemá vazbu Závěs, Souosost ani Šroub.") : tr("Sestava nemá vazbu Vzdálenost, Drážka, Dráha, Souosost ani Šroub.")}</p>
            )}
            <label className="flex items-center gap-2 text-[11.5px]">
              <input type="checkbox" className="accent-[#E03930]" checked={draft.speed !== undefined} onChange={(e) => setDraft({ ...draft, speed: e.target.checked ? (draft.kind === "rotary" ? 60 : 10) : undefined })} />
              {draft.kind === "rotary" ? tr("Rychlost (ot/min) místo rozsahu") : tr("Rychlost (mm/s) místo rozsahu")}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Num label={tr("Začátek")} value={draft.from} step={draft.kind === "rotary" ? 15 : 1} suffix={draft.kind === "rotary" ? "°" : "mm"} onChange={(v) => setDraft({ ...draft, from: v })} />
              {draft.speed !== undefined ? (
                <Num label={tr("Rychlost")} value={draft.speed} step={draft.kind === "rotary" ? 10 : 1} suffix={draft.kind === "rotary" ? tr("ot/min") : "mm/s"} onChange={(v) => setDraft({ ...draft, speed: v })} />
              ) : (
                <Num label={tr("Konec")} value={draft.to} step={draft.kind === "rotary" ? 15 : 1} suffix={draft.kind === "rotary" ? "°" : "mm"} onChange={(v) => setDraft({ ...draft, to: v })} />
              )}
            </div>
            <button type="button" data-motor-add disabled={!draftMate} onClick={addMotor} className="w-full rounded border border-[#cfd6de] bg-white py-1 text-[12px] hover:bg-[#f3f6f9] disabled:opacity-50">
              {tr("Přidat motor")}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Num label={tr("Délka studie")} value={study.duration} step={0.5} min={0.01} suffix="s" onChange={(v) => v > 0 && setStudy({ duration: v })} />
          <Num label={tr("Počet kroků")} value={study.steps} step={6} min={1} suffix="" onChange={(v) => setStudy({ steps: Math.max(1, Math.min(2000, Math.round(v))) })} />
        </div>
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
          <button type="button" data-motion-run disabled={!study.motors.length || !!busy} onClick={() => void compute()} className="flex-1 rounded bg-brand py-1.5 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
            {busy ? tr("Počítám krok {0} z {1}…", busy.k, busy.n) : tr("Vypočítat pohyb")}
          </button>
          {busy && (
            <button type="button" onClick={() => (cancel.current = true)} className="rounded border border-[#cfd6de] px-2 text-[12px]">
              {tr("Zrušit")}
            </button>
          )}
        </div>
        {err && <p className="rounded bg-brand/10 p-2 text-[11.5px] text-brand-600">{err}</p>}
        {res && cur && (
          <div data-motion-result className="space-y-2 border-t border-[#e3e8ee] pt-2">
            <div className="flex items-center gap-2">
              <button type="button" data-motion-play aria-label={playing ? tr("Pauza") : tr("Přehrát")} onClick={() => (playing ? setPlaying(false) : (step >= res.steps.length - 1 && setStep(0), setPlaying(true)))} className="rounded border border-[#cfd6de] bg-white px-2.5 py-1 text-[12px] font-semibold hover:bg-[#f3f6f9]">
                {playing ? "❚❚" : "▶"}
              </button>
              <input type="range" data-motion-scrub aria-label={tr("Časová osa")} min={0} max={res.steps.length - 1} step={1} value={step} onChange={(e) => (setPlaying(false), setStep(Number(e.target.value)))} className="min-w-0 flex-1 accent-[#E03930]" />
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
            <ul data-motion-summary className="space-y-0.5 text-[11px] leading-snug text-[#4a5664]">
              {summary.map((l, i) => (
                <li key={i} className={cn(l.startsWith("⚠") && "text-brand-600")}>
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
