/**
 * Export snímků PNG a videa WebM pohybové studie s pevným časováním (vlna 22, body 13 a 14 zprávy).
 *
 * Žádný záznam obrazovky v reálném čase: snímek i ukáže polohu studie v čase z plánu (cad/motion-video.ts – interpolace mezi
 * vypočtenými kroky), 3D okno (WebGL i softwarový náhled bez WebGL) se vykreslí, obraz se sejme z plátna, složí s dlaždicemi
 * dalších uložených pohledů (synchronní pohledy), vypálí se anotace polohy a snímek se zakóduje s časovou značkou i/fps:
 * WebCodecs VideoEncoder (VP8 / VP9), jinak klíčové snímky VP8 z obrázku WebP, jinak snímky PNG v ZIP s časovým plánem.
 * Hotový soubor se zpětně přečte (cad/webm-mux.ts) a porovná s plánem; obraz se kontroluje, že sleduje pohyb (otisky snímků) –
 * „mrtvé“ plátno (poloha se mění, obraz ne) video neuloží a řekne proč.
 */
import { writeZip } from "@/cad/formats/zip";
import { tr } from "@/cad/i18n";
import type { MotionResult } from "@/cad/motion";
import { annotRows, cameraDir, type AnnotRow } from "@/cad/motion-views";
import { checkFrames, checkText, frameSig, planText, poseAt, poseKey, sigChanged, stepPlan, studySpan, videoPlan, type FrameCheck, type FrameRecord, type PoseAt, type VideoPlan } from "@/cad/motion-video";
import type { CadDoc, MotionAnnotSettings, MotionView, StudySection, Vec3 } from "@/cad/types";
import { checkWebm, muxWebm, readWebm, webpVp8, type WebmFrame } from "@/cad/webm-mux";
import type { NeutralCam } from "./viewport";

export type ExportHost = {
  /** zobrazí polohu studie ve 3D okně (bez zápisu do historie) */
  setPose: (p: PoseAt) => void;
  /** vykreslí 3D okno hned a vrátí jeho plátna (WebGL, nebo softwarový náhled + překryv) */
  frame: () => HTMLCanvasElement[] | null;
  camera: () => NeutralCam | null;
  setCamera: (c: NeutralCam) => void;
  /** pojmenovaný pohled s přizpůsobením modelu */
  setView: (v: NonNullable<NonNullable<MotionView["camera"]>["view"]>) => void;
  bounds: () => { center: Vec3; radius: number };
  section: () => StudySection | null;
  setSection: (s: StudySection | null) => void;
  /** pozadí pracovní plochy (CSS barva nebo přechod) */
  background: () => string;
  save: (name: string, data: BlobPart, mime: string) => void;
  progress?: (text: string) => void;
  cancelled?: () => boolean;
};
export type ExportOpts = {
  kind: "webm" | "png";
  speed?: number;
  fps?: number;
  seconds?: number;
  /** PNG: snímek na každý vypočtený krok místo časového plánu */
  perStep?: boolean;
  /** uložené pohledy (víc = synchronní dlaždice); prázdné = okno tak, jak je */
  views: MotionView[];
  annot: boolean;
  annotSettings?: MotionAnnotSettings;
  /** základ názvu souboru */
  name: string;
  /** tabulka CSV studie do ZIP se snímky */
  csv?: string;
};
export type ExportReport = {
  ok: boolean;
  level: "ok" | "warn" | "error" | "info";
  kind: "webm" | "png";
  plan: VideoPlan | null;
  encoder: "webcodecs-vp8" | "webcodecs-vp9" | "webp-vp8" | "png" | "none";
  check: FrameCheck | null;
  file: string | null;
  bytes: number;
  /** délka přečtená z hotového souboru [s] (jen WebM) */
  fileSeconds: number | null;
  text: string;
};

/* ───────────────────────── pomocné ───────────────────────── */

/** počká na vykreslení (dva snímky obrazovky; ve skryté záložce nejvýš 150 ms) */
const tick = () =>
  new Promise<void>((resolve) => {
    let done = false;
    const fin = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(fin));
    setTimeout(fin, 150);
  });
const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
const blobOf = (cv: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob | null>((r) => cv.toBlob(r, type, q));
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

/** pozadí pracovní plochy do 2D plátna: barva, svislý lineární přechod, nebo kruhový přechod (barvy a polohy z CSS) */
export function paintBackground(ctx: CanvasRenderingContext2D, css: string, x: number, y: number, w: number, h: number) {
  const stops = [...css.matchAll(/(#[0-9a-f]{3,8}|rgba?\([^)]*\))\s*(\d+(?:\.\d+)?)?%?/gi)].map((m, i, a) => ({ c: m[1], p: m[2] !== undefined ? Number(m[2]) / 100 : a.length > 1 ? i / (a.length - 1) : 0 }));
  if (stops.length < 2) {
    ctx.fillStyle = stops[0]?.c ?? "#eef2f6";
    ctx.fillRect(x, y, w, h);
    return;
  }
  const g = /radial/i.test(css) ? ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.hypot(w, h) / 2) : ctx.createLinearGradient(x, y, x, y + h);
  for (const s of stops) g.addColorStop(Math.max(0, Math.min(1, s.p)), s.c);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

/** anotace polohy do obrazu (levý horní roh): tmavý podklad, bílý text, upozornění oranžově */
export function drawAnnot(ctx: CanvasRenderingContext2D, rows: AnnotRow[], x: number, y: number, scale: number) {
  if (!rows.length) return;
  const fs = Math.round(12 * scale);
  const lh = Math.round(fs * 1.35);
  const pad = Math.round(6 * scale);
  ctx.save();
  ctx.font = `${fs}px "Roboto Mono", ui-monospace, monospace`;
  const w = Math.max(...rows.map((r) => ctx.measureText(r.text).width)) + pad * 2;
  ctx.fillStyle = "rgba(17, 24, 32, 0.72)";
  ctx.fillRect(x, y, w, rows.length * lh + pad * 2);
  ctx.textBaseline = "top";
  rows.forEach((r, i) => {
    ctx.fillStyle = r.warn ? "#ffb347" : "#ffffff";
    ctx.fillText(r.text, x + pad, y + pad + i * lh);
  });
  ctx.restore();
}

/** použije uložený pohled: kamera (směr / cíl / výška, nebo pojmenovaný pohled s přizpůsobením) a řez */
export function applyStudyView(host: Pick<ExportHost, "setCamera" | "setView" | "bounds" | "setSection">, v: MotionView) {
  const c = v.camera;
  if (c) {
    if (!c.dir && !c.target && c.height === undefined) host.setView(c.view ?? "iso");
    else {
      const b = host.bounds();
      host.setCamera({ dir: cameraDir(c), target: c.target ?? b.center, height: c.height ?? b.radius * 2.3 });
    }
  }
  if (v.section !== undefined) host.setSection(v.section);
}

type Encoder = {
  kind: ExportReport["encoder"];
  add: (cv: HTMLCanvasElement, i: number) => Promise<void>;
  finish: () => Promise<{ data: Uint8Array; mime: string; ext: string } | null>;
};

/** kodér: WebCodecs VP8 / VP9 → WebM, jinak WebP → VP8 → WebM, jinak PNG ZIP */
async function makeEncoder(kind: "webm" | "png", W: number, H: number, plan: VideoPlan, o: ExportOpts, probe: HTMLCanvasElement): Promise<Encoder> {
  const fps = plan.fps;
  const pngZip = (): Encoder => {
    const files: { name: string; data: Uint8Array }[] = [];
    return {
      kind: "png",
      add: async (cv, i) => {
        const b = await blobOf(cv, "image/png");
        // snímky po vypočtených krocích = krok-NNNN.png (jako dřív), snímky časového plánu = snimek-NNNN.png
        if (b) files.push({ name: `${o.perStep ? "krok" : "snimek"}-${String(i).padStart(4, "0")}.png`, data: await bytesOf(b) });
      },
      finish: async () => {
        if (!files.length) return null;
        const times = plan.samples.map((t, i) => `${String(i).padStart(4, "0")} | ${(i / fps).toFixed(4)} | ${t.toFixed(5)}`).join("\n");
        const readme = [
          tr("Snímky pohybové studie s pevným časováním (Mnástrojárna CAD)"),
          planText(plan),
          tr("snímek | čas videa [s] | čas studie [s]"),
          times,
          "",
          o.perStep ? "" : tr("Video ze snímků: ffmpeg -framerate {0} -i snimek-%04d.png -c:v libvpx-vp9 -pix_fmt yuv420p video.webm", fps),
        ].join("\n");
        files.push({ name: "casovani.txt", data: new TextEncoder().encode(readme) });
        if (o.csv) files.push({ name: "studie.csv", data: new TextEncoder().encode(o.csv) });
        return { data: writeZip(files), mime: "application/zip", ext: "zip" };
      },
    };
  };
  if (kind === "png") return pngZip();
  const g = globalThis as unknown as { VideoEncoder?: { new (init: { output: (c: { byteLength: number; timestamp: number; type: string; copyTo: (b: Uint8Array) => void }) => void; error: (e: Error) => void }): { configure: (c: object) => void; encode: (f: unknown, o?: { keyFrame?: boolean }) => void; flush: () => Promise<void>; close: () => void; encodeQueueSize: number }; isConfigSupported: (c: object) => Promise<{ supported?: boolean }> }; VideoFrame?: new (src: CanvasImageSource, o: { timestamp: number; duration: number }) => { close: () => void } };
  const VE = g.VideoEncoder;
  const VF = g.VideoFrame;
  if (VE && VF) {
    for (const [codec, id, ek] of [["vp8", "V_VP8", "webcodecs-vp8"], ["vp09.00.10.08", "V_VP9", "webcodecs-vp9"]] as const) {
      const cfg = { codec, width: W, height: H, bitrate: Math.round(Math.min(12e6, Math.max(6e5, W * H * fps * 0.12))), framerate: fps };
      const sup = await VE.isConfigSupported(cfg).catch(() => null);
      if (!sup?.supported) continue;
      const chunks: WebmFrame[] = [];
      let err: Error | null = null;
      const enc = new VE({
        output: (c) => {
          const b = new Uint8Array(c.byteLength);
          c.copyTo(b);
          chunks.push({ data: b, time: c.timestamp / 1000, key: c.type === "key" });
        },
        error: (e) => void (err = e),
      });
      enc.configure(cfg);
      const every = Math.max(1, Math.round(fps));
      return {
        kind: ek,
        add: async (cv, i) => {
          if (err) throw err;
          const f = new VF(cv, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
          enc.encode(f, { keyFrame: i % every === 0 });
          f.close();
          while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 4));
        },
        finish: async () => {
          await enc.flush();
          enc.close();
          if (err) throw err;
          if (!chunks.length) return null;
          chunks.sort((a, b) => a.time - b.time);
          return { data: muxWebm({ codec: id, width: W, height: H, fps, frames: chunks, duration: plan.seconds * 1000 }), mime: "video/webm", ext: "webm" };
        },
      };
    }
  }
  // WebP: ztrátový obrázek = klíčový snímek VP8 (Chrome, Edge, Firefox); bez WebP (Safari) → PNG ZIP s časovým plánem
  const test = await blobOf(probe, "image/webp", 0.9);
  if (test?.type === "image/webp" && webpVp8(await bytesOf(test))) {
    const frames: WebmFrame[] = [];
    return {
      kind: "webp-vp8",
      add: async (cv, i) => {
        const b = await blobOf(cv, "image/webp", 0.9);
        const vp8 = b ? webpVp8(await bytesOf(b)) : null;
        if (!vp8) throw new Error(tr("snímek {0}: prohlížeč nevrátil obrázek WebP", i));
        frames.push({ data: vp8, time: (i * 1000) / fps, key: true });
      },
      finish: async () => (frames.length ? { data: muxWebm({ codec: "V_VP8", width: W, height: H, fps, frames, duration: plan.seconds * 1000 }), mime: "video/webm", ext: "webm" } : null),
    };
  }
  return pngZip();
}

/* ───────────────────────── export ───────────────────────── */

/**
 * Vykreslí a uloží snímky / video studie podle plánu. Okno (kamera, řez, poloha) se po exportu vrátí, jak bylo. Výsledek
 * nese plán, kodér, kontrolu obrazu a souboru a text hlášky; ✓ jen když soubor odpovídá plánu a obraz sleduje pohyb.
 */
export async function exportMotion(res: MotionResult, doc: CadDoc, o: ExportOpts, host: ExportHost): Promise<ExportReport> {
  const T = studySpan(res, doc.motion?.duration ?? 0);
  const fail = (text: string, plan: VideoPlan | null = null): ExportReport => ({ ok: false, level: "error", kind: o.kind, plan, encoder: "none", check: null, file: null, bytes: 0, fileSeconds: null, text });
  let plan: VideoPlan;
  try {
    plan = o.kind === "png" && o.perStep ? stepPlan(res, o.fps) : videoPlan(T, o);
  } catch (e) {
    return fail(`✗ ${(e as Error).message}`);
  }
  const saved = { cam: host.camera(), sec: host.section() };
  const views: (MotionView | null)[] = o.views.length ? o.views : [null];
  /** pohled dlaždice: co pohled neurčuje (kamera, řez), je jako okno na začátku exportu – nepřenáší se z předchozí dlaždice */
  const applyTile = (v: MotionView) => {
    if (!v.camera && saved.cam) host.setCamera(saved.cam);
    applyStudyView(host, { ...v, section: v.section !== undefined ? v.section : saved.sec });
  };
  const k = views.length;
  const cols = Math.ceil(Math.sqrt(k));
  const rows = Math.ceil(k / cols);
  try {
    if (views[0]) applyTile(views[0]);
    host.setPose(poseAt(res, plan.samples[0]));
    await tick();
    const first = host.frame();
    if (!first?.length || !first[0].width) return fail(tr("✗ 3D okno nemá co sejmout (model není zobrazen) – export se nespustil"), plan);
    // velikost snímku: dlaždice v rozměru plátna, celé nejvýš 1920 × 1080 (sudé rozměry kvůli kodéru)
    const w0 = first[0].width;
    const h0 = first[0].height;
    const s = Math.min(1, 1920 / (cols * w0), 1080 / (rows * h0));
    const tw = Math.max(2, Math.floor(w0 * s));
    const th = Math.max(2, Math.floor(h0 * s));
    const W = even(cols * tw);
    const H = even(rows * th);
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return fail(tr("✗ prohlížeč nevytvořil 2D plátno pro snímky"), plan);
    const enc = await makeEncoder(o.kind, W, H, plan, o, cv);
    const records: FrameRecord[][] = views.map(() => []);
    const bg = host.background();
    const scale = Math.max(1, Math.min(2.5, H / 720));
    let prevKey = "";
    for (let i = 0; i < plan.frames; i++) {
      if (host.cancelled?.()) return { ...fail(tr("Export zrušen."), plan), level: "info" };
      host.progress?.(tr("Snímek {0} z {1}…", i + 1, plan.frames));
      const pose = poseAt(res, plan.samples[i]);
      const key = poseKey(pose.place);
      host.setPose(pose);
      for (let j = 0; j < k; j++) {
        const v = views[j];
        if (v && (k > 1 || i === 0)) applyTile(v);
        const x = (j % cols) * tw;
        const y = Math.floor(j / cols) * th;
        const prev = records[j][records[j].length - 1];
        let sig: number[] = [];
        // poloha se změnila, obraz ne → okno se možná ještě nepřekreslilo: počkat a sejmout znovu (nejvýš 3×)
        for (let tries = 0; tries < 4; tries++) {
          await tick();
          const src = host.frame();
          paintBackground(ctx, bg, x, y, tw, th);
          for (const c of src ?? []) if (c.width && c.height) ctx.drawImage(c, x, y, tw, th);
          sig = frameSig(ctx.getImageData(x, y, tw, th).data, tw, th);
          if (!prev || prev.pose === key || sigChanged(sig, prev.sig)) break;
        }
        records[j].push({ pose: key, sig });
        if (k > 1 && v) drawAnnot(ctx, [{ key: "view", text: v.name }], x + tw - Math.round(8 * scale) - Math.min(tw / 2, v.name.length * 7 * scale), y + Math.round(8 * scale), scale * 0.9);
      }
      if (o.annot) drawAnnot(ctx, annotRows({ t: pose.t, step: pose.step, steps: res.steps.length, motors: pose.motors, stepData: res.steps[pose.step] as unknown as Record<string, unknown> }, doc, { study: T, settings: o.annotSettings }), Math.round(10 * scale), Math.round(10 * scale), scale);
      await enc.add(cv, i);
      prevKey = key;
    }
    void prevKey;
    // kontrola obrazu: nejhorší dlaždice rozhoduje
    const checks = records.map(checkFrames);
    const check = checks.find((c) => c.verdict === "dead") ?? checks.find((c) => c.verdict === "partial") ?? checks[0];
    if (check.verdict === "dead") return { ...fail(`✗ ${tr("Video neuloženo")}: ${checkText(check)}`, plan), encoder: enc.kind, check };
    const out = await enc.finish();
    if (!out) return { ...fail(tr("✗ kodér nevrátil žádný snímek – nic se neuložilo"), plan), encoder: enc.kind, check };
    let fileSeconds: number | null = null;
    if (out.ext === "webm") {
      const info = readWebm(out.data);
      fileSeconds = info.duration !== null ? info.duration / 1000 : null;
      const bad = checkWebm(info, plan);
      if (bad.length) return { ...fail(tr("✗ Video neuloženo: hotový soubor neodpovídá plánu ({0}) – {1}", bad.join(", "), planText(plan)), plan), encoder: enc.kind, check, fileSeconds };
    }
    const file = `${o.name || tr("sestava")}-pohyb${o.kind === "png" || out.ext === "zip" ? "-snimky" : ""}.${out.ext}`;
    host.save(file, out.data as BlobPart, out.mime);
    const level: ExportReport["level"] = out.ext === "zip" && o.kind === "webm" ? "warn" : check.verdict === "partial" ? "warn" : check.verdict === "static" ? "info" : "ok";
    const mark = level === "ok" ? "✓" : level === "warn" ? "⚠" : "ℹ";
    const head =
      o.kind === "webm" && out.ext === "webm"
        ? tr("Video WebM uloženo ({0}): {1}; soubor má délku {2} s a {3} snímků", enc.kind === "webp-vp8" ? "VP8/WebP" : enc.kind === "webcodecs-vp9" ? "VP9" : "VP8", planText(plan), fileSeconds !== null ? (Math.round(fileSeconds * 1000) / 1000).toString() : "?", plan.frames)
        : o.kind === "webm"
          ? tr("Prohlížeč neumí kódovat video – uloženy snímky PNG s časovým plánem (ZIP, příkaz ffmpeg uvnitř): {0}", planText(plan))
          : tr("Snímky PNG ({0}) s časovým plánem uloženy (ZIP): {1}", plan.frames, planText(plan));
    const viewsText = o.views.length ? ` · ${tr("pohledy: {0}", o.views.map((v) => `„${v.name}“`).join(", "))}` : "";
    return { ok: true, level, kind: o.kind, plan, encoder: enc.kind, check, file, bytes: out.data.length, fileSeconds, text: `${mark} ${head}${viewsText} · ${checkText(check)}` };
  } catch (e) {
    return fail(`✗ ${tr("Export se nepodařil: {0}", (e as Error).message)}`, plan);
  } finally {
    host.setSection(saved.sec);
    if (saved.cam) host.setCamera(saved.cam);
  }
}
