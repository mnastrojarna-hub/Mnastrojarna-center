/**
 * Časování videa a snímků pohybové studie (vlna 22, bod 13 zprávy): oddělený čas studie, rychlost přehrání, FPS videa a počet
 * snímků. Čistá matematika bez prohlížeče – plán exportu, poloha v libovolném čase studie (interpolace mezi vypočtenými kroky)
 * a kontrola, že se obraz snímků opravdu mění (žádné „mrtvé“ plátno).
 *
 * Dřív se video nahrávalo v reálném čase z plátna (MediaRecorder, FPS = počet kroků / délka oříznuté na 5–30, `setTimeout`
 * mezi kroky): studie 0,65 s / 112 kroků dala video 2,9–3,8 s podle rychlosti vykreslení. Nyní: snímek i má pevnou časovou
 * značku i/fps, ukazuje polohu studie v čase T·i/(N−1) (první snímek = začátek, poslední = konec studie) a délka videa
 * N/fps se od zadání (délka studie / rychlost, nebo ruční délka) liší nejvýš o půl snímku zaokrouhlením počtu snímků.
 */
import { eulerXYZ, rotMatrix, type Mat3 } from "./assembly";
import { getLang, tr } from "./i18n";
import type { MotionResult, MotionStep } from "./motion";
import type { SpringStep } from "./asm-spring";
import type { MotionStudy, Placement, Vec3 } from "./types";

/** volby časování: rychlost (1 = skutečná, 0,25 = 4× zpomaleně), FPS videa, ruční délka videa [s] (má přednost před rychlostí) */
export type VideoOpts = { speed?: number; fps?: number; seconds?: number };
export type VideoPlan = {
  /** délka studie [s] */
  study: number;
  /** rychlost přehrání (délka studie / délka videa) */
  speed: number;
  fps: number;
  /** počet snímků */
  frames: number;
  /** délka videa [s] = frames / fps */
  seconds: number;
  /** požadovaná délka (studie / rychlost, nebo ruční) – od `seconds` se liší nejvýš o půl snímku */
  target: number;
  /** poměr délky videa ku délce studie */
  ratio: number;
  /** tolerance délky: ±1 snímek [s] */
  tol: number;
  /** čas studie každého snímku [s] (0 … study) */
  samples: number[];
  /** délka zadaná ručně (rychlost z ní spočtena) */
  manual: boolean;
};

export const VIDEO_FPS = 30;
export const VIDEO_MAX_FRAMES = 3600;
export const VIDEO_SPEEDS = [1, 0.5, 0.25, 0.1] as const;

const num = (v: number, d = 3): string => {
  if (!Number.isFinite(v)) return "–";
  const s = String(Math.round(v * 10 ** d) / 10 ** d || 0);
  return getLang() === "en" ? s : s.replace(".", ",");
};

/** Délka studie z výsledku: čas posledního kroku (dynamika i kinematika), jinak zadaná délka. */
export function studySpan(res: Pick<MotionResult, "steps"> | null | undefined, fallback = 0): number {
  const last = res?.steps[res.steps.length - 1];
  return last && last.t > 0 ? last.t : fallback;
}

/**
 * Plán exportu: počet snímků, jejich časy ve studii a délka videa. Chybné zadání (záporná rychlost, FPS mimo 1–120, víc než
 * 3600 snímků, studie bez délky) → Error s českou zprávou (protokol ji vypíše jako ✗, video nevznikne).
 */
export function videoPlan(study: number, o: VideoOpts = {}): VideoPlan {
  if (!(study > 0) || !Number.isFinite(study)) throw new Error(tr("video: studie nemá délku – nejdřív pohyb čas T"));
  const fps = o.fps ?? VIDEO_FPS;
  if (!(fps >= 1 && fps <= 120) || !Number.isFinite(fps)) throw new Error(tr("video: FPS 1 až 120 (zadáno {0})", num(fps)));
  let speed: number;
  let target: number;
  const manual = o.seconds !== undefined;
  if (manual) {
    if (!(o.seconds! > 0) || !Number.isFinite(o.seconds!)) throw new Error(tr("video: délka videa musí být kladná [s]"));
    target = o.seconds!;
    speed = study / target;
  } else {
    speed = o.speed ?? 1;
    if (!(speed > 0) || !Number.isFinite(speed)) throw new Error(tr("video: rychlost musí být kladná (1 = skutečná, 0,25 = 4× zpomaleně)"));
    target = study / speed;
  }
  const frames = Math.max(2, Math.round(target * fps));
  if (frames > VIDEO_MAX_FRAMES) throw new Error(tr("video: {0} snímků je moc (nejvýš {1}) – zvyšte rychlost, zkraťte délku nebo snižte FPS", frames, VIDEO_MAX_FRAMES));
  const seconds = frames / fps;
  const samples = Array.from({ length: frames }, (_, i) => (i === frames - 1 ? study : (study * i) / (frames - 1)));
  return { study, speed, fps, frames, seconds, target, ratio: seconds / study, tol: 1 / fps, samples, manual };
}

/** Plán snímků PNG po vypočtených krocích (jeden snímek na krok, časy kroků) – výchozí export snímků bez voleb časování. */
export function stepPlan(res: Pick<MotionResult, "steps">, fps = VIDEO_FPS): VideoPlan {
  const study = studySpan(res, 0);
  const samples = res.steps.map((s) => s.t);
  const frames = samples.length;
  const seconds = frames / fps;
  return { study, speed: study > 0 ? study / seconds : 1, fps, frames, seconds, target: seconds, ratio: study > 0 ? seconds / study : 1, tol: 1 / fps, samples, manual: false };
}

/** Řádek protokolu s časováním: délka videa, poměr ke studii, rychlost, FPS, snímky a tolerance. */
export function planText(p: VideoPlan): string {
  return tr("video {0} s = {1} × délka studie {2} s · rychlost {3}× · {4} fps · {5} snímků (tolerance ±1 snímek = ±{6} s)", num(p.seconds), num(p.ratio, 2), num(p.study), num(p.speed, 3), num(p.fps, 2), p.frames, num(p.tol));
}

/** Krátký strojový zápis plánu (`video seconds=… fps=… frames=… speed=… ratio=…`) pro řádek `=` stručného protokolu. */
export function planKv(p: VideoPlan): string {
  const f = (v: number, d: number) => String(Math.round(v * 10 ** d) / 10 ** d);
  return `video seconds=${f(p.seconds, 3)} study=${f(p.study, 3)} fps=${f(p.fps, 2)} frames=${p.frames} speed=${f(p.speed, 3)} ratio=${f(p.ratio, 3)}`;
}

/** časový plán pro `window.mncad.motion()` (vlna 22): délka videa, poměr, snímky, pohledy a anotace z uložených voleb studie */
export type MotionVideoApi = { seconds: number; study: number; fps: number; frames: number; speed: number; ratio: number; tol: number; views: string[]; annot: boolean; text: string } | { error: string };
export function videoApi(res: Pick<MotionResult, "steps"> | null, study: MotionStudy | undefined): MotionVideoApi {
  try {
    const v = study?.video ?? {};
    const p = videoPlan(studySpan(res, study?.duration ?? 0), v);
    const views = (v.views ?? []).map((id) => study?.views?.find((x) => x.id === id)?.name ?? id);
    return { seconds: p.seconds, study: p.study, fps: p.fps, frames: p.frames, speed: p.speed, ratio: p.ratio, tol: p.tol, views, annot: v.annot !== false && !study?.annot?.off, text: planText(p) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ───────────────────────── poloha v čase studie ───────────────────────── */

type Quat = [number, number, number, number];
/** čtveřice z rotační matice 3×3 (po řádcích) */
function quatOf(m: Mat3): Quat {
  const [a, b, c, d, e, f, g, h, k] = m;
  const tr3 = a + e + k;
  if (tr3 > 0) {
    const s = Math.sqrt(tr3 + 1) * 2;
    return [s / 4, (h - f) / s, (c - g) / s, (d - b) / s];
  }
  if (a > e && a > k) {
    const s = Math.sqrt(1 + a - e - k) * 2;
    return [(h - f) / s, s / 4, (b + d) / s, (c + g) / s];
  }
  if (e > k) {
    const s = Math.sqrt(1 + e - a - k) * 2;
    return [(c - g) / s, (b + d) / s, s / 4, (f + h) / s];
  }
  const s = Math.sqrt(1 + k - a - e) * 2;
  return [(d - b) / s, (c + g) / s, (f + h) / s, s / 4];
}
function matOf([w, x, y, z]: Quat): Mat3 {
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}
function slerp(a: Quat, b0: Quat, t: number): Quat {
  let b = b0;
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (cos < 0) {
    cos = -cos;
    b = [-b[0], -b[1], -b[2], -b[3]];
  }
  let k0 = 1 - t;
  let k1 = t;
  if (cos < 0.9999999) {
    const om = Math.acos(Math.min(1, cos));
    const so = Math.sin(om);
    k0 = Math.sin((1 - t) * om) / so;
    k1 = Math.sin(t * om) / so;
  }
  const q: Quat = [a[0] * k0 + b[0] * k1, a[1] * k0 + b[1] * k1, a[2] * k0 + b[2] * k1, a[3] * k0 + b[3] * k1];
  const l = Math.hypot(...q) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const same3 = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Natočení mezi dvěma polohami (Eulerovy úhly XYZ ve stupních) po nejkratší cestě – bez skoku přes ±180°. */
export function slerpRotation(a: Vec3, b: Vec3, t: number): Vec3 {
  if (same3(a, b) || t <= 0) return a;
  if (t >= 1) return b;
  return eulerXYZ(matOf(slerp(quatOf(rotMatrix(a)), quatOf(rotMatrix(b)), t)));
}

export function lerpPlacement(a: Placement, b: Placement, t: number): Placement {
  return { position: lerp3(a.position, b.position, t), rotation: slerpRotation(a.rotation, b.rotation, t) };
}

/** Poloha studie v čase t: interpolace mezi sousedními kroky (poloha lineárně, natočení po kouli, délky pružin lineárně). */
export type PoseAt = {
  t: number;
  /** nejbližší vypočtený krok (číslo kroku, příznaky kolize / nesplněných vazeb) */
  step: number;
  /** kroky, mezi kterými se interpoluje, a podíl */
  k: number;
  alpha: number;
  place: Record<string, Placement>;
  springs: Record<string, SpringStep> | null;
  motors: number[];
  trace: Vec3[] | null;
};

/** index posledního kroku s časem ≤ t (kroky jsou podle času vzestupně) */
function stepBefore(steps: MotionStep[], t: number): number {
  let lo = 0;
  let hi = steps.length - 1;
  if (t <= steps[0].t) return 0;
  if (t >= steps[hi].t) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (steps[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function poseAt(res: Pick<MotionResult, "steps">, t: number): PoseAt {
  const S = res.steps;
  if (!S.length) return { t, step: 0, k: 0, alpha: 0, place: {}, springs: null, motors: [], trace: null };
  const k = stepBefore(S, t);
  const a = S[k];
  const b = S[Math.min(S.length - 1, k + 1)];
  const span = b.t - a.t;
  const alpha = b === a || !(span > 0) ? 0 : Math.max(0, Math.min(1, (t - a.t) / span));
  const place: Record<string, Placement> = {};
  for (const [id, pa] of Object.entries(a.place)) {
    const pb = b.place[id];
    place[id] = pb && alpha > 0 ? lerpPlacement(pa, pb, alpha) : pa;
  }
  let springs: Record<string, SpringStep> | null = null;
  if (a.springs) {
    springs = {};
    for (const [id, sa] of Object.entries(a.springs)) {
      const sb = b.springs?.[id];
      springs[id] = sb && alpha > 0 ? { ...(alpha < 0.5 ? sa : sb), length: lerp(sa.length, sb.length, alpha), offset: lerp(sa.offset, sb.offset, alpha), ...(sa.force !== undefined && sb.force !== undefined ? { force: lerp(sa.force, sb.force, alpha) } : {}) } : sa;
    }
  }
  const motors = a.motors.map((v, i) => (alpha > 0 && b.motors[i] !== undefined ? lerp(v, b.motors[i], alpha) : v));
  const tr0 = S.slice(0, k + 1).flatMap((x) => (x.trace ? [x.trace] : []));
  if (alpha > 0 && a.trace && b.trace) tr0.push(lerp3(a.trace, b.trace, alpha));
  return { t, step: alpha < 0.5 ? a.i : b.i, k, alpha, place, springs, motors, trace: tr0.length > 1 ? tr0 : null };
}

/** Otisk polohy (zaokrouhlené polohy a natočení všech komponent) – podle něj se pozná, že se mezi snímky něco pohnulo. */
export function poseKey(place: Record<string, Placement>): string {
  const r = (v: number, d: number) => Math.round(v * d) / d;
  return Object.keys(place)
    .sort()
    .map((id) => {
      const p = place[id];
      return `${id}:${p.position.map((v) => r(v, 1e4)).join(",")}/${p.rotation.map((v) => r(v, 1e3)).join(",")}`;
    })
    .join("|");
}

/* ───────────────────────── kontrola obrazu snímků ───────────────────────── */

/** Otisk obrazu: průměrný jas buněk mřížky `grid × grid` (RGBA po řádcích). Shodné obrázky = shodný otisk. */
export function frameSig(data: ArrayLike<number>, width: number, height: number, grid = 24): number[] {
  const cells = new Array<number>(grid * grid).fill(0);
  const counts = new Array<number>(grid * grid).fill(0);
  if (!(width > 0 && height > 0)) return cells;
  const stepX = Math.max(1, Math.floor(width / (grid * 4)));
  const stepY = Math.max(1, Math.floor(height / (grid * 4)));
  for (let y = 0; y < height; y += stepY) {
    const gy = Math.min(grid - 1, Math.floor((y * grid) / height));
    for (let x = 0; x < width; x += stepX) {
      const gx = Math.min(grid - 1, Math.floor((x * grid) / width));
      const o = (y * width + x) * 4;
      const a = data[o + 3] ?? 255;
      // průhledné pixely (pozadí plátna WebGL) = 0; jas váženě podle krytí
      const lum = ((0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) * a) / 255;
      cells[gy * grid + gx] += lum;
      counts[gy * grid + gx]++;
    }
  }
  return cells.map((v, i) => (counts[i] ? Math.round(v / counts[i]) : 0));
}

/** Liší se dva otisky obrazu? (nejméně jedna buňka o víc než `eps` úrovní jasu) */
export function sigChanged(a: number[] | null | undefined, b: number[] | null | undefined, eps = 1): boolean {
  if (!a || !b || a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > eps) return true;
  return false;
}

export type FrameRecord = { pose: string; sig: number[] };
export type FrameCheck = {
  frames: number;
  /** snímky, ve kterých se poloha proti předchozímu změnila */
  moving: number;
  /** snímky, ve kterých se obraz proti předchozímu změnil */
  changed: number;
  /** pohyb bez změny obrazu (díl schovaný řezem / mimo záběr, nebo nepřekreslené plátno) */
  stuck: number;
  /** počet navzájem různých obrazů */
  distinct: number;
  /** ok = obraz sleduje pohyb; partial = část snímků se nezměnila; dead = poloha se mění, obraz nikdy; static = studie se nehýbe */
  verdict: "ok" | "partial" | "dead" | "static";
};

/** Vyhodnocení snímků exportu: mění se obraz tam, kde se mění poloha? */
export function checkFrames(list: FrameRecord[]): FrameCheck {
  let moving = 0;
  let changed = 0;
  let stuck = 0;
  const seen = new Set<string>();
  list.forEach((f, i) => {
    seen.add(f.sig.join(","));
    if (!i) return;
    const mv = f.pose !== list[i - 1].pose;
    const ch = sigChanged(f.sig, list[i - 1].sig);
    if (mv) moving++;
    if (ch) changed++;
    if (mv && !ch) stuck++;
  });
  const verdict: FrameCheck["verdict"] = moving === 0 ? "static" : changed === 0 ? "dead" : stuck > 0 ? "partial" : "ok";
  return { frames: list.length, moving, changed, stuck, distinct: seen.size, verdict };
}

/** Text kontroly obrazu do hlášky exportu (nikdy „ok“, když kontrola neproběhla nebo obraz stál). */
export function checkText(c: FrameCheck): string {
  if (c.verdict === "dead") return tr("✗ obraz se mezi snímky nezměnil, přestože se poloha měnila v {0} snímcích – 3D okno se nepřekreslilo, video by bylo nehybné", c.moving);
  if (c.verdict === "static") return tr("ℹ poloha se ve studii nemění – všechny snímky ukazují totéž");
  if (c.verdict === "partial") return tr("⚠ obraz se změnil v {0} z {1} snímků s pohybem (zbytek: pohyblivý díl mimo záběr nebo schovaný řezem?)", c.moving - c.stuck, c.moving);
  return tr("obraz se mění ve všech {0} snímcích s pohybem ({1} různých snímků)", c.moving, c.distinct);
}
