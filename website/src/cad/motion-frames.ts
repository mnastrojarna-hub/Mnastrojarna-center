/**
 * Vlna 22, kolo 7b, bod 13 („video jen v aplikaci“): snímky a video pohybové studie BEZ prohlížeče (CLI `mncad run`,
 * `mncad serve`). Stejný časový plán jako aplikace (`videoPlan` / `stepPlan`), stejná poloha v čase (`poseAt` – interpolace
 * mezi kroky, pružiny v délce kroku), stejný softwarový vykreslovač jako náhled bez WebGL (`softRender`, čela řezu
 * komponent `softCapStyles`), stejné pohledy studie (kamera, řez; víc pohledů = synchronní dlaždice) a stejná kontrola
 * obrazu (`checkFrames`: nehybné video = ✗, nic se neuloží).
 *
 * Výstup: `pohyb export png` = ZIP se snímky `snimek-NNNN.png` (u `kroky` `krok-NNNN.png`) a `casovani.txt` jako v aplikaci;
 * `pohyb export webm` = animované PNG (APNG) se stejným časováním – kodér WebM (VP8/VP9) má jen prohlížeč, proto ⚠ s důvodem
 * a s ověřením hotového souboru (počet snímků a délka ze souboru = plán, jinak ✗). Anotaci polohy (text v obraze) kreslí
 * jen aplikace – CLI to v protokolu výslovně uvede (ℹ), časování je v `casovani.txt` / v protokolu.
 *
 * Čistý modul bez DOM: PNG kóduje `encodePng` (zlib přes CompressionStream – Node 18+ i prohlížeč).
 */
import { assembleApng, readApng } from "./apng";
import { flattenLeaves, type Leaf } from "./asm-flatten";
import type { MotionVideoSignal } from "./agent-motion-view";
import { writeZip } from "./formats/zip";
import { tr } from "./i18n";
import type { MotionResult } from "./motion";
import { poseDoc } from "./motion";
import { checkFrames, checkText, combineChecks, frameSig, planText, poseAt, poseKey, stepPlan, studySpan, videoPlan, type FrameCheck, type FrameRecord, type VideoPlan } from "./motion-video";
import { activeView, cameraDir, findView } from "./motion-views";
import { capModule, DEFAULT_COMP_HEX, softCapStyles } from "./section-cap";
import { sectionPlane, type SectionState } from "./section-plane";
import { basisOf, fitCamera, hexToRgb, softBounds, softRender, VIEW_ANGLES, type SoftCamera, type SoftClip, type SoftItem } from "./soft-render";
import { encodePng } from "./title-logo";
import type { CadDoc, MeshData, MotionView, Vec3 } from "./types";

export type NodeVideoInput = {
  doc: CadDoc;
  res: MotionResult;
  kind: "webm" | "png";
  video: MotionVideoSignal;
  /** síť listového dílu (z jádra – stavba dílů sestavy); null = díl bez sítě (vynechá se) */
  meshOf: (leaf: Leaf) => MeshData | null;
  /** základ názvu souboru (název sestavy) */
  name: string;
  /** rozměr snímku jednoho pohledu (sudý); výchozí 960 × 540 */
  tile?: { w: number; h: number };
  /** CSV studie do ZIP se snímky */
  csv?: string;
};

export type NodeVideoOut = {
  ok: boolean;
  level: "ok" | "warn" | "info" | "error";
  text: string;
  file: { name: string; data: Uint8Array; mime: string; format: string } | null;
  plan: VideoPlan | null;
  check: FrameCheck | null;
  /** délka a počet snímků přečtené z hotového souboru (APNG) */
  fileSeconds: number | null;
  frames: number;
};

const even = (v: number) => Math.max(2, Math.floor(v / 2) * 2);
const BG: [number, number, number] = [255, 255, 255];

/** báze pohledu ze směru „od cíle ke kameře“ (shodně s 3D oknem – StudyCamera.dir) */
function basisFromDir(d: Vec3) {
  return basisOf({ az: Math.atan2(d[1], d[0]), el: Math.atan2(d[2], Math.hypot(d[0], d[1])) });
}

/** položky softwarového vykreslovače pro polohu studie (komponenty sestavy se světovou maticí, čela řezu) */
function sceneAt(doc: CadDoc, res: MotionResult, t: number, meshOf: NodeVideoInput["meshOf"], withCaps: boolean) {
  const pose = poseAt(res, t);
  const leaves = flattenLeaves(poseDoc(doc, pose.place, pose.springs), { springMesh: true }).filter((l) => !l.hidden);
  const list = leaves.map((l) => ({ l, m: l.coil?.mesh ?? meshOf(l) })).filter((x): x is { l: Leaf; m: MeshData } => !!x.m && x.m.triangles.length >= 3);
  const caps = withCaps ? softCapStyles(list.map(({ l }) => ({ id: l.id, color: l.comp.color ?? DEFAULT_COMP_HEX })), "shadedEdges", capModule(list.map(({ l, m }) => ({ id: l.id, key: l.key, mesh: m, matrix: l.matrix })))) : null;
  const items: SoftItem[] = list.map(({ l, m }, i) => {
    const s = caps?.[i] ?? null;
    return {
      vertices: m.vertices,
      triangles: m.triangles,
      normals: m.normals,
      lines: m.lines,
      matrix: l.matrix,
      color: hexToRgb(l.comp.color ?? DEFAULT_COMP_HEX),
      ...(s ? { capColor: s.fill, capHatch: { angle: s.hatch.angle, stepMm: s.hatch.stepMm, width: s.hatch.width, color: s.hatch.color }, capOutline: s.outline } : {}),
    };
  });
  return { pose, items };
}

/** kamera dlaždice: pohled studie (pojmenovaný směr / směr + cíl + výška), jinak izometrie; přizpůsobená celé dráze pohybu */
export function studyViewCamera(v: MotionView | null, span: SoftItem[], w: number, h: number): SoftCamera {
  const c = v?.camera;
  const basis = c?.dir || (c?.view && c.view !== "iso") ? basisFromDir(cameraDir(c)) : c?.view === "iso" || !c ? basisOf(VIEW_ANGLES.iso) : basisFromDir(cameraDir(c));
  const fit = fitCamera(span, basis, w, h);
  if (!c || (!c.target && c.height === undefined)) return fit;
  const b = softBounds(span);
  const center = c.target ?? b?.center ?? fit.center;
  const height = c.height ?? (b ? b.radius * 2.3 : 0);
  return { ...fit, center, scale: height > 0 ? h / height : fit.scale };
}

/** Snímky / video studie bez prohlížeče (viz hlavička modulu). */
export async function renderMotionVideoNode(i: NodeVideoInput): Promise<NodeVideoOut> {
  const { doc, res, kind, video } = i;
  const fail = (text: string, plan: VideoPlan | null = null, check: FrameCheck | null = null): NodeVideoOut => ({ ok: false, level: "error", text, file: null, plan, check, fileSeconds: null, frames: 0 });
  if (!res.steps.length) return fail(tr("✗ Video neuloženo: pohybová studie nemá žádný krok"));
  const T = studySpan(res, doc.motion?.duration ?? 0);
  let plan: VideoPlan;
  try {
    plan = kind === "png" && video.perStep ? stepPlan(res, video.fps) : videoPlan(T, video);
  } catch (e) {
    return fail(`✗ ${(e as Error).message}`);
  }
  const study = doc.motion;
  const named = (video.views ?? []).map((r) => findView(study, r)).filter((v): v is MotionView => !!v);
  const views: (MotionView | null)[] = named.length ? named : [activeView(study)];
  const k = views.length;
  const cols = Math.ceil(Math.sqrt(k));
  const rows = Math.ceil(k / cols);
  const s = Math.min(1, 1920 / (cols * (i.tile?.w ?? 960)), 1080 / (rows * (i.tile?.h ?? 540)));
  const tw = even((i.tile?.w ?? 960) * s);
  const th = even((i.tile?.h ?? 540) * s);
  const W = cols * tw;
  const H = rows * th;
  // řez pohledu a pevná kamera dlaždice přes celou dráhu (první, prostřední a poslední snímek)
  const clips: (SoftClip | null)[] = views.map((v) => (v?.section ? sectionPlane(v.section as SectionState) : null));
  const spanItems = [0, Math.floor(plan.frames / 2), plan.frames - 1].flatMap((f) => sceneAt(doc, res, plan.samples[Math.max(0, Math.min(plan.samples.length - 1, f))], i.meshOf, false).items);
  if (!spanItems.length) return fail(tr("✗ Video neuloženo: sestava nemá žádnou síť k vykreslení (díly se nepostavily)"), plan);
  const cams = views.map((v) => studyViewCamera(v, spanItems, tw, th));
  const records: FrameRecord[][] = views.map(() => []);
  const pngs: { name: string; data: Uint8Array }[] = [];
  const frame = new Uint8Array(W * H * 4);
  const tile = new Uint8ClampedArray(tw * th * 4);
  const depth = new Float32Array(tw * th);
  for (let f = 0; f < plan.frames; f++) {
    const withCaps = clips.some((c) => !!c);
    const { pose, items } = sceneAt(doc, res, plan.samples[f], i.meshOf, withCaps);
    const key = poseKey(pose.place);
    for (let j = 0; j < k; j++) {
      const r = softRender({ width: tw, height: th, items, camera: cams[j], clip: clips[j], background: BG, out: tile, depth });
      records[j].push({ pose: key, sig: frameSig(r.data, tw, th) });
      const x0 = (j % cols) * tw;
      const y0 = Math.floor(j / cols) * th;
      for (let y = 0; y < th; y++) frame.set(r.data.subarray(y * tw * 4, (y + 1) * tw * 4), ((y0 + y) * W + x0) * 4);
    }
    // neprůhledné bílé pozadí (alfa 255), ať je video stejné v každém prohlížeči obrázků
    for (let p = 3; p < frame.length; p += 4) {
      if (frame[p] < 255) {
        const a = frame[p] / 255;
        frame[p - 3] = Math.round(frame[p - 3] * a + 255 * (1 - a));
        frame[p - 2] = Math.round(frame[p - 2] * a + 255 * (1 - a));
        frame[p - 1] = Math.round(frame[p - 1] * a + 255 * (1 - a));
        frame[p] = 255;
      }
    }
    pngs.push({ name: `${kind === "png" && video.perStep ? "krok" : "snimek"}-${String(f).padStart(4, "0")}.png`, data: await encodePng({ w: W, h: H, rgba: frame }) });
  }
  const check = combineChecks(records.map(checkFrames), views.map((v, j) => v?.name ?? String(j + 1)));
  if (check.verdict === "dead") return fail(`✗ ${tr("Video neuloženo")}: ${checkText(check)}`, plan, check);
  const annotNote = video.annot === false ? "" : ` · ${tr("anotace polohy jen v aplikaci (CLI ji do obrazu nekreslí; časy snímků v protokolu a v casovani.txt)")}`;
  const viewsText = named.length ? ` · ${tr("pohledy: {0}", named.map((v) => `„${v.name}“`).join(", "))}` : views[0] ? ` · ${tr("pohled: „{0}“", views[0].name)}` : ` · ${tr("pohled: izometrie (studie nemá aktivní pohled)")}`;
  if (kind === "webm") {
    const data = assembleApng(pngs.map((p) => p.data), plan.fps);
    // ověření hotového souboru jako v aplikaci: počet snímků a délka ze souboru = plán (jinak ✗, nic se neuloží)
    const a = readApng(data);
    const bad: string[] = [];
    if (!a.crcOk) bad.push(tr("poškozený soubor"));
    if (a.frames !== plan.frames || a.delays.length !== plan.frames) bad.push(tr("{0} snímků místo {1}", a.delays.length, plan.frames));
    if (Math.abs(a.seconds - plan.seconds) > 1 / plan.fps / 2) bad.push(tr("délka {0} s místo {1} s", Math.round(a.seconds * 1000) / 1000, Math.round(plan.seconds * 1000) / 1000));
    if (bad.length) return { ...fail(tr("✗ Video neuloženo: hotový soubor neodpovídá plánu ({0}) – {1}", bad.join(", "), planText(plan)), plan, check), fileSeconds: a.seconds };
    const head = tr("CLI neumí kódovat WebM (kodér VP8 / VP9 je jen v prohlížeči) – uloženo animované PNG (APNG) se stejným časováním: {0}; soubor má délku {1} s a {2} snímků", planText(plan), String(Math.round(a.seconds * 1000) / 1000), a.frames);
    return { ok: true, level: "warn", text: `⚠ ${head}${viewsText} · ${checkText(check)}${annotNote}`, file: { name: `${i.name || tr("sestava")}-pohyb-video.png`, data, mime: "image/apng", format: "apng" }, plan, check, fileSeconds: a.seconds, frames: a.frames };
  }
  const fps = plan.fps;
  const times = plan.samples.map((t, n) => `${String(n).padStart(4, "0")} | ${(n / fps).toFixed(4)} | ${t.toFixed(5)}`).join("\n");
  const readme = [
    tr("Snímky pohybové studie s pevným časováním (Mnástrojárna CAD)"),
    planText(plan),
    tr("snímek | čas videa [s] | čas studie [s]"),
    times,
    "",
    video.perStep ? "" : tr("Video ze snímků: ffmpeg -framerate {0} -i snimek-%04d.png -c:v libvpx-vp9 -pix_fmt yuv420p video.webm", fps),
  ].join("\n");
  const files = [...pngs, { name: "casovani.txt", data: new TextEncoder().encode(readme) }, ...(i.csv ? [{ name: "studie.csv", data: new TextEncoder().encode(i.csv) }] : [])];
  const level: NodeVideoOut["level"] = check.verdict === "partial" ? "warn" : check.verdict === "static" ? "info" : "ok";
  const mark = level === "ok" ? "✓" : level === "warn" ? "⚠" : "ℹ";
  return {
    ok: true,
    level,
    text: `${mark} ${tr("Snímky PNG ({0}) s časovým plánem uloženy (ZIP): {1}", plan.frames, planText(plan))}${viewsText} · ${checkText(check)}${annotNote}`,
    file: { name: `${i.name || tr("sestava")}-pohyb-snimky.zip`, data: writeZip(files), mime: "application/zip", format: "zip" },
    plan,
    check,
    fileSeconds: null,
    frames: plan.frames,
  };
}

/**
 * Živý pohled studie (kolo 7b, bod 14 – „víc živých pohledů v okně“): jeden pohled studie (kamera, řez) vykreslený
 * softwarovým vykreslovačem nad položkami aktuální polohy – stejně v aplikaci s WebGL i bez něj. `cam` = pevná kamera
 * (spočítaná při prvním snímku, ať při přehrávání neposkakuje); vrací obraz a kameru.
 */
export function renderStudyView(items: SoftItem[], view: MotionView, w: number, h: number, cam?: SoftCamera | null, out?: Uint8ClampedArray): { data: Uint8ClampedArray; cam: SoftCamera; sig: number[] } {
  const camera = cam ?? studyViewCamera(view, items, w, h);
  const clip = view.section ? sectionPlane(view.section as SectionState) : null;
  const r = softRender({ width: w, height: h, items, camera, clip, background: BG, ...(out ? { out } : {}) });
  return { data: r.data, cam: camera, sig: frameSig(r.data, w, h) };
}
