"use client";

/**
 * Lišta přehrávání pohybové studie ukotvená dole ve 3D okně a anotace aktuální polohy (vlna 22, bod 14 zprávy).
 *
 * Kompaktní pracovní prostředí: ▶ / pauza, časová osa, čas a krok, rychlost přehrání (skutečný čas × rychlost), smyčka,
 * uložené pohledy studie (kamera + rovina řezu – výběr je použije, „Uložit pohled“ uloží okno), anotace v okně, export
 * snímků PNG a videa WebM s pevným časováním (nastavení: rychlost / ruční délka, FPS, pohledy vedle sebe, anotace, náhled plánu)
 * a přepnutí na plný panel studie. Lišta i anotace jsou běžné prvky stránky nad 3D oknem i nad softwarovým náhledem bez WebGL.
 * Stav pro automatizaci: `data-motion-player`, `data-player-*`, `data-motion-hud`, `data-video-*`.
 */
import { useMemo, useState } from "react";
import { tr } from "@/cad/i18n";
import type { MotionResult } from "@/cad/motion";
import { activeView, annotRows, findView, removeView, sectionText, upsertView } from "@/cad/motion-views";
import { planText, studySpan, videoPlan, VIDEO_FPS } from "@/cad/motion-video";
import { uid, type CadDoc, type MotionStudy, type MotionVideoSettings, type MotionView, type StudySection } from "@/cad/types";
import { cn } from "@/lib/cn";
import { CadIcon } from "./cad-icons";
import type { ExportReport } from "./motion-export";
import type { NeutralCam } from "./viewport";

/** ovládání okna pro pohledy a export (cad-app → panel studie → lišta) */
export type PlayerHost = {
  camera: () => NeutralCam | null;
  setCamera: (c: NeutralCam) => void;
  setView: (v: NonNullable<NonNullable<MotionView["camera"]>["view"]>) => void;
  bounds: () => { center: [number, number, number]; radius: number };
  section: () => StudySection | null;
  setSection: (s: StudySection | null) => void;
  frame: () => HTMLCanvasElement[] | null;
  background: () => string;
};

const SPEEDS = [2, 1, 0.5, 0.25, 0.1];
const nf = (v: number, d = 3) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d });
/** kamera k uložení: směr na 5 míst, cíl a výška na setiny mm (skript ji zapíše a přečte beze ztráty) */
const roundCam = (c: NeutralCam): NeutralCam => ({ dir: c.dir.map((v) => Math.round(v * 1e5) / 1e5) as NeutralCam["dir"], target: c.target.map((v) => Math.round(v * 100) / 100) as NeutralCam["target"], height: Math.round(c.height * 100) / 100 });
const roundSec = (s: StudySection | null): StudySection | null => (s ? { axis: s.axis, offset: Math.round(s.offset * 1000) / 1000, flip: !!s.flip, ...(s.normal ? { normal: s.normal.map((v) => Math.round(v * 1e5) / 1e5) as StudySection["normal"] } : {}), ...(s.origin ? { origin: s.origin.map((v) => Math.round(v * 1000) / 1000) as StudySection["origin"] } : {}) } : null);

export function MotionPlayer({
  doc,
  study,
  res,
  state,
  step,
  playing,
  loop,
  speed,
  compact,
  host,
  busy,
  report,
  onStep,
  onPlay,
  onLoop,
  onSpeed,
  onCompact,
  onCompute,
  onStudy,
  onExport,
  onCancel,
  onApplyView,
  onClose,
}: {
  doc: CadDoc;
  study: MotionStudy;
  res: MotionResult | null;
  state: "ok" | "stale" | "unchecked" | "running";
  step: number;
  playing: boolean;
  loop: boolean;
  speed: number;
  compact: boolean;
  host?: PlayerHost;
  /** probíhá export (text průběhu) */
  busy: string | null;
  report: ExportReport | null;
  onStep: (i: number) => void;
  onPlay: (on: boolean) => void;
  onLoop: (on: boolean) => void;
  onSpeed: (s: number) => void;
  onCompact: (on: boolean) => void;
  onCompute: () => void;
  onStudy: (s: Partial<MotionStudy>) => void;
  onExport: (kind: "png" | "webm") => void;
  /** zrušit probíhající export */
  onCancel: () => void;
  onApplyView: (id: string) => void;
  /** zavřít studii (lišta i panel) */
  onClose: () => void;
}) {
  const [naming, setNaming] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const T = studySpan(res, study.duration);
  const cur = res?.steps[step];
  const act = activeView(study);
  const annotOn = !study.annot?.off;
  const rows = useMemo(
    () => (res && cur && annotOn ? annotRows({ t: cur.t, step: cur.i, steps: res.steps.length, motors: cur.motors, stepData: cur as unknown as Record<string, unknown> }, doc, { study: T, view: act?.name, settings: study.annot }) : []),
    [res, cur, annotOn, doc, T, act?.name, study.annot],
  );
  const video: MotionVideoSettings = study.video ?? {};
  const plan = useMemo(() => {
    try {
      return { p: videoPlan(T || study.duration, video), err: null as string | null };
    } catch (e) {
      return { p: null, err: (e as Error).message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [T, study.duration, JSON.stringify(video)]);
  const setVideo = (v: Partial<MotionVideoSettings>) => {
    const next: MotionVideoSettings = { ...video, ...v };
    for (const k of Object.keys(next) as (keyof MotionVideoSettings)[]) if (next[k] === undefined) delete next[k];
    onStudy({ video: next });
  };
  const saveView = (name: string) => {
    const nm = name.trim();
    if (!nm || !host) return;
    const cam = host.camera();
    const r = upsertView(study, { name: nm, ...(cam ? { camera: roundCam(cam) } : {}), section: roundSec(host.section()) }, uid);
    onStudy({ views: r.study.views, view: r.view.id });
    setNaming(null);
  };
  const btn = "rounded border border-[#cfd6de] bg-white px-2 py-1 text-[11.5px] hover:bg-[#f3f6f9] disabled:opacity-50";
  return (
    <>
      {/* anotace aktuální polohy v okně – stejné řádky se vypálí do exportu PNG / WebM */}
      {rows.length > 0 && (
        <div data-motion-hud className="pointer-events-none absolute bottom-[68px] left-3 z-20 rounded bg-[#111820]/70 px-2 py-1 font-mono text-[11.5px] leading-snug text-white shadow">
          {rows.map((r, i) => (
            <div key={i} data-hud-row={r.key} className={cn(r.warn && "text-[#ffb347]")}>
              {r.text}
            </div>
          ))}
        </div>
      )}
      <div
        data-motion-player
        data-motion-compact={compact ? "1" : "0"}
        data-player-state={state}
        data-player-view={act?.id ?? ""}
        className="absolute bottom-3 left-1/2 z-30 w-[min(860px,calc(100%-24px))] -translate-x-1/2 rounded-md border border-[#cfd6de] bg-white/95 px-2 py-1.5 text-[12px] shadow-xl backdrop-blur"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <CadIcon name="transform" tone="pattern" className="h-4 w-4 shrink-0" />
          {res && cur ? (
            <>
              <button type="button" data-player-play aria-label={playing ? tr("Pauza") : tr("Přehrát")} onClick={() => onPlay(!playing)} className="rounded border border-[#cfd6de] bg-white px-2.5 py-0.5 text-[12px] font-semibold hover:bg-[#f3f6f9]">
                {playing ? "❚❚" : "▶"}
              </button>
              <input type="range" data-player-scrub aria-label={tr("Časová osa")} min={0} max={res.steps.length - 1} step={1} value={step} onChange={(e) => onStep(Number(e.target.value))} className="min-w-[90px] flex-1 accent-[#E03930]" />
              <span data-player-time className="whitespace-nowrap font-mono text-[11px] text-[#4a5664]">
                {tr("t = {0} / {1} s · krok {2}/{3}", nf(cur.t), nf(T), cur.i, res.steps.length - 1)}
              </span>
            </>
          ) : (
            <>
              <button type="button" data-player-compute disabled={state === "running" || (!study.motors.length && study.mode !== "dynamic")} onClick={onCompute} className="rounded bg-brand px-2.5 py-0.5 text-[12px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                {state === "running" ? tr("Počítám…") : state === "stale" ? tr("Vypočítat pohyb znovu") : tr("Vypočítat pohyb")}
              </button>
              <span className="flex-1 text-[11px] text-[#6b7785]">{state === "stale" ? tr("Výsledek neplatí – sestava nebo studie se změnila.") : tr("Nezkontrolováno – pohyb se pro tento stav nepočítal.")}</span>
            </>
          )}
          {/* rychlost přehrání: skutečný čas studie × rychlost (při hustých krocích se kroky přeskakují, nezpomaluje se) */}
          <select data-player-speed aria-label={tr("Rychlost přehrání")} value={String(speed)} onChange={(e) => onSpeed(Number(e.target.value))} className="rounded border border-[#cfd6de] bg-white px-1 py-0.5 text-[11.5px]">
            {SPEEDS.map((s) => (
              <option key={s} value={String(s)}>
                {nf(s, 2)}×
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-[11px]" title={tr("Smyčka")}>
            <input type="checkbox" data-player-loop className="accent-[#E03930]" checked={loop} onChange={(e) => onLoop(e.target.checked)} />⟲
          </label>
          {/* uložené pohledy studie: kamera + řez */}
          <select data-player-views aria-label={tr("Pohled studie")} value={act?.id ?? ""} onChange={(e) => (e.target.value ? onApplyView(e.target.value) : onStudy({ view: undefined }))} className="max-w-[150px] rounded border border-[#cfd6de] bg-white px-1 py-0.5 text-[11.5px]">
            <option value="">{tr("Pohled: okno")}</option>
            {(study.views ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          {naming === null ? (
            <button type="button" data-player-save-view disabled={!host} title={tr("Uloží kameru a řez okna jako pohled studie")} onClick={() => setNaming(act?.name ?? tr("Pohled {0}", (study.views?.length ?? 0) + 1))} className={btn}>
              {tr("Uložit pohled")}
            </button>
          ) : (
            <span className="flex items-center gap-1">
              <input data-player-view-name autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => (e.key === "Enter" ? saveView(naming) : e.key === "Escape" ? setNaming(null) : undefined)} className="w-[120px] rounded border border-[#cfd6de] px-1 py-0.5 text-[11.5px]" />
              <button type="button" data-player-view-ok onClick={() => saveView(naming)} className={btn}>
                OK
              </button>
            </span>
          )}
          {act && (
            <button type="button" data-player-view-delete title={tr("Odebrat pohled „{0}“", act.name)} onClick={() => {
                const r = removeView(study, act.id);
                onStudy({ views: r.views, view: r.view, video: r.video });
              }} className="rounded p-1 text-[#6b7785] hover:text-brand">
              <CadIcon name="trash" className="h-3.5 w-3.5" />
            </button>
          )}
          <label className="flex items-center gap-1 text-[11px]" title={tr("Anotace polohy v okně a v exportu")}>
            <input type="checkbox" data-player-annot className="accent-[#E03930]" checked={annotOn} onChange={(e) => onStudy({ annot: e.target.checked ? undefined : { ...(study.annot ?? {}), off: true } })} />
            {tr("Anotace")}
          </label>
          <button type="button" data-player-export="png" disabled={!res || !!busy} onClick={() => onExport("png")} className={btn}>
            PNG
          </button>
          <button type="button" data-player-export="webm" disabled={!res || !!busy} onClick={() => onExport("webm")} className={btn}>
            {busy ?? tr("Video")}
          </button>
          {busy && (
            <button type="button" data-player-export-cancel onClick={onCancel} className={btn}>
              {tr("Zrušit")}
            </button>
          )}
          <button type="button" data-player-video-settings aria-pressed={settings} title={tr("Nastavení videa")} onClick={() => setSettings((v) => !v)} className={cn("rounded p-1 text-[#4a5664] hover:bg-[#eef2f6]", settings && "bg-[#eef2f6]")}>
            <CadIcon name="settings" className="h-3.5 w-3.5" />
          </button>
          <button type="button" data-player-compact aria-pressed={compact} title={compact ? tr("Zobrazit plný panel studie") : tr("Skrýt panel studie (jen lišta)")} onClick={() => onCompact(!compact)} className={btn}>
            {compact ? tr("Panel ▴") : tr("Lišta ▾")}
          </button>
          <button type="button" data-player-close aria-label={tr("Zavřít")} onClick={onClose} className="rounded p-1 text-[#6b7785] hover:bg-[#eef2f6]">
            <CadIcon name="x" className="h-3.5 w-3.5" />
          </button>
        </div>
        {settings && (
          <div data-video-settings className="mt-1.5 grid gap-1.5 border-t border-[#e3e8ee] pt-1.5 sm:grid-cols-[auto_auto_auto_1fr]">
            <label className="flex items-center gap-1 text-[11.5px]">
              {tr("Rychlost")}
              <select data-video-speed value={video.seconds !== undefined ? "len" : String(video.speed ?? 1)} onChange={(e) => (e.target.value === "len" ? setVideo({ seconds: Math.round((T / (video.speed ?? 1)) * 100) / 100 || 1, speed: undefined }) : setVideo({ speed: Number(e.target.value), seconds: undefined }))} className="rounded border border-[#cfd6de] bg-white px-1 py-0.5">
                {[1, 0.5, 0.25, 0.1].map((s) => (
                  <option key={s} value={String(s)}>
                    {nf(s, 2)}×
                  </option>
                ))}
                {video.speed !== undefined && ![1, 0.5, 0.25, 0.1].includes(video.speed) && <option value={String(video.speed)}>{nf(video.speed, 3)}×</option>}
                <option value="len">{tr("ruční délka")}</option>
              </select>
            </label>
            {video.seconds !== undefined ? (
              <label className="flex items-center gap-1 text-[11.5px]">
                {tr("Délka videa")}
                <input type="number" data-video-seconds min={0.1} step={0.1} value={video.seconds} onChange={(e) => Number(e.target.value) > 0 && setVideo({ seconds: Number(e.target.value) })} className="w-[70px] rounded border border-[#cfd6de] px-1 py-0.5" />s
              </label>
            ) : (
              <label className="flex items-center gap-1 text-[11.5px]">
                {tr("Vlastní")}
                <input type="number" data-video-custom-speed min={0.01} step={0.05} value={video.speed ?? 1} onChange={(e) => Number(e.target.value) > 0 && setVideo({ speed: Number(e.target.value) })} className="w-[64px] rounded border border-[#cfd6de] px-1 py-0.5" />×
              </label>
            )}
            <label className="flex items-center gap-1 text-[11.5px]">
              FPS
              <select data-video-fps value={String(video.fps ?? VIDEO_FPS)} onChange={(e) => setVideo({ fps: Number(e.target.value) === VIDEO_FPS ? undefined : Number(e.target.value) })} className="rounded border border-[#cfd6de] bg-white px-1 py-0.5">
                {[10, 15, 24, 25, 30, 50, 60].map((f) => (
                  <option key={f} value={String(f)}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11.5px]">
              <input type="checkbox" data-video-annot className="accent-[#E03930]" checked={video.annot !== false} onChange={(e) => setVideo({ annot: e.target.checked ? undefined : false })} />
              {tr("Anotace ve videu")}
            </label>
            {(study.views?.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-[11.5px] sm:col-span-4" data-video-views>
                <span className="text-[#6b7785]">{tr("Pohledy ve videu (víc = vedle sebe, synchronně):")}</span>
                {study.views!.map((v) => (
                  <label key={v.id} className="flex items-center gap-1" title={sectionText(v.section)}>
                    <input
                      type="checkbox"
                      data-video-view={v.id}
                      className="accent-[#E03930]"
                      checked={!!video.views?.includes(v.id)}
                      onChange={(e) => {
                        const list = (video.views ?? []).filter((x) => x !== v.id && findView(study, x));
                        if (e.target.checked) list.push(v.id);
                        setVideo({ views: list.length ? study.views!.filter((x) => list.includes(x.id)).map((x) => x.id) : undefined });
                      }}
                    />
                    {v.name}
                  </label>
                ))}
              </div>
            )}
            <p data-video-plan data-plan-seconds={plan.p ? String(plan.p.seconds) : ""} data-plan-frames={plan.p ? String(plan.p.frames) : ""} className={cn("rounded px-2 py-1 font-mono text-[10.5px] sm:col-span-4", plan.err ? "bg-brand/10 text-brand-600" : "bg-[#f3f6f9] text-[#39424d]")}>
              {plan.p ? planText(plan.p) : plan.err}
            </p>
          </div>
        )}
        {report && (
          <p
            data-video-report
            data-video-level={report.level}
            data-video-kind={report.kind}
            data-video-encoder={report.encoder}
            data-video-seconds={report.plan ? String(report.plan.seconds) : ""}
            data-video-study={report.plan ? String(report.plan.study) : ""}
            data-video-frames={report.plan ? String(report.plan.frames) : ""}
            data-video-file-seconds={report.fileSeconds !== null ? String(report.fileSeconds) : ""}
            data-video-verdict={report.check?.verdict ?? ""}
            data-video-still={report.check?.still?.join("|") ?? ""}
            data-video-moving={report.check ? String(report.check.moving) : ""}
            data-video-changed={report.check ? String(report.check.changed) : ""}
            data-video-distinct={report.check ? String(report.check.distinct) : ""}
            className={cn("mt-1 rounded px-2 py-1 text-[11px] leading-snug", report.level === "ok" ? "bg-[#eef7ee] text-[#2f6b35]" : report.level === "error" ? "bg-brand/10 text-brand-600" : report.level === "warn" ? "bg-[#fff4e5] text-[#8a5300]" : "bg-[#f3f6f9] text-[#4a5664]")}
          >
            {report.text}
          </p>
        )}
      </div>
    </>
  );
}
