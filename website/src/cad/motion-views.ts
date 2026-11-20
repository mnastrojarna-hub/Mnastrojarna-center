/**
 * Pracovní prostředí přehrávání pohybové studie (vlna 22, bod 14 zprávy): uložené pohledy studie (kamera + rovina řezu) a
 * anotace aktuální polohy. Čistá logika bez prohlížeče – používá ji panel a lišta přehrávání (components/cad/motion-player.tsx),
 * export snímků a videa (components/cad/motion-export.ts), textové příkazy `pohyb pohled …` (cad/agent-motion-view.ts) i převodník
 * dokument → skript.
 *
 * Kamera pohledu je nezávislá na způsobu kreslení (WebGL perspektiva / pravoúhlé promítání, softwarový náhled bez WebGL):
 * směr od cíle ke kameře, cíl a viditelná výška v mm. Pohled zadaný jen jménem („přední“) se přizpůsobí modelu.
 */
import { getLang, tr } from "./i18n";
import { isFault } from "./clash-rules";
import type { ClashClass } from "./clash-class";
import type { CadDoc, MotionAnnotSettings, MotionStudy, MotionView, StudyCamera, StudySection, Vec3 } from "./types";

export type CamView = NonNullable<StudyCamera["view"]>;
/** směry pojmenovaných pohledů (od cíle ke kameře) – shodné se 3D oknem a softwarovým náhledem (soft-render.ts VIEW_ANGLES) */
export const VIEW_DIRS: Record<CamView, Vec3> = {
  iso: [1, -1.15, 0.85],
  front: [0, -1, 0],
  back: [0, 1, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
};
const unit = (v: Vec3): Vec3 | null => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-12 && Number.isFinite(l) ? [v[0] / l, v[1] / l, v[2] / l] : null;
};
/** jednotkový směr kamery pohledu (směr, nebo pojmenovaný pohled, jinak izometrie) */
export function cameraDir(c: StudyCamera | undefined | null): Vec3 {
  return (c?.dir && unit(c.dir)) || unit(VIEW_DIRS[c?.view ?? "iso"])!;
}

/** pohled studie podle názvu (bez ohledu na velikost písmen), čísla `#2` / `2` nebo id */
export function findView(study: Pick<MotionStudy, "views"> | undefined, ref: string): MotionView | null {
  const list = study?.views ?? [];
  const r = ref.trim();
  const n = /^#?(\d+)$/.exec(r);
  if (n) return list[Number(n[1]) - 1] ?? null;
  const low = r.toLocaleLowerCase();
  return list.find((v) => v.id === r || v.name.toLocaleLowerCase() === low) ?? null;
}

/** Pohled přidá, nebo nahradí pohled stejného názvu (id zůstane). Vrací novou studii a pohled. */
export function upsertView(study: MotionStudy, v: Omit<MotionView, "id"> & { id?: string }, newId: () => string): { study: MotionStudy; view: MotionView; replaced: boolean } {
  const list = [...(study.views ?? [])];
  const i = list.findIndex((x) => x.name.toLocaleLowerCase() === v.name.trim().toLocaleLowerCase());
  const view: MotionView = { id: i >= 0 ? list[i].id : (v.id ?? newId()), name: v.name.trim(), ...(v.camera ? { camera: v.camera } : {}), ...(v.section !== undefined ? { section: v.section } : {}) };
  if (i >= 0) list[i] = view;
  else list.push(view);
  return { study: { ...study, views: list }, view, replaced: i >= 0 };
}

/** Pohled odebere (a zruší ho jako aktivní i z voleb videa). */
export function removeView(study: MotionStudy, id: string): MotionStudy {
  const views = (study.views ?? []).filter((v) => v.id !== id);
  const out: MotionStudy = { ...study, views };
  if (!views.length) delete out.views;
  if (out.view === id) delete out.view;
  if (out.video?.views) {
    const vv = out.video.views.filter((x) => x !== id);
    out.video = { ...out.video, ...(vv.length ? { views: vv } : {}) };
    if (!vv.length) delete out.video.views;
  }
  return out;
}

/** aktivní pohled studie (null = okno tak, jak je) */
export const activeView = (study: MotionStudy | undefined): MotionView | null => (study?.view ? (study.views ?? []).find((v) => v.id === study.view) ?? null : null);

const n = (v: number, d = 2): string => {
  const s = String(Math.round(v * 10 ** d) / 10 ** d || 0);
  return getLang() === "en" ? s : s.replace(".", ",");
};
const v3 = (v: Vec3, d = 3) => v.map((x) => n(x, d)).join("; ");
const VIEW_LABEL: Record<CamView, string> = { iso: "izometrie", front: "přední", back: "zadní", top: "horní", bottom: "spodní", left: "levý", right: "pravý" };
export const viewLabel = (v: CamView) => tr(VIEW_LABEL[v]);

/** popis roviny řezu („řez Y 50“, „řez normála 1; 0; 1 bod … posun 5“, „bez řezu“) */
export function sectionText(s: StudySection | null | undefined): string {
  if (!s) return tr("bez řezu");
  const flip = s.flip ? tr(" obráceně") : "";
  if (s.normal) return tr("řez normála {0}{1} posun {2} mm{3}", v3(s.normal), s.origin && s.origin.some((x) => x !== 0) ? tr(" bod {0}", v3(s.origin)) : "", n(s.offset), flip);
  return tr("řez {0} {1} mm{2}", s.axis, n(s.offset), flip);
}
/** popis kamery („kamera přední“, „směr …, cíl …, výška 120 mm“, „kamera přizpůsobit“) */
export function cameraText(c: StudyCamera | undefined): string {
  if (!c || (!c.view && !c.dir && !c.target && c.height === undefined)) return tr("kamera podle okna");
  const parts: string[] = [];
  if (c.dir) parts.push(tr("směr {0}", v3(c.dir)));
  else parts.push(tr("kamera {0}", viewLabel(c.view ?? "iso")));
  if (c.target) parts.push(tr("cíl {0}", v3(c.target, 2)));
  if (c.height !== undefined) parts.push(tr("výška {0} mm", n(c.height)));
  return parts.join(" · ");
}
/** řádek pohledu do výpisu `pohyb pohledy` / stavu studie */
export function viewText(v: MotionView, i: number, active: boolean): string {
  return `${active ? "▸" : " "} ${i + 1}. „${v.name}“ · ${cameraText(v.camera)} · ${sectionText(v.section)}`;
}

/** Ověření roviny řezu (osa, konečná poloha, nenulová normála) – chyba s českou zprávou. */
export function checkSection(s: StudySection): StudySection {
  if (!["X", "Y", "Z"].includes(s.axis)) throw new Error(tr("řez: osa X, Y nebo Z"));
  if (!Number.isFinite(s.offset)) throw new Error(tr("řez: poloha musí být číslo"));
  if (s.normal && !unit(s.normal)) throw new Error(tr("řez: normála nesmí být nulový vektor"));
  return s;
}

/* ───────────────────────── anotace aktuální polohy ───────────────────────── */

export type AnnotRow = { key: "t" | "step" | "motors" | "clearance" | "cut" | "flags" | "view"; text: string; warn?: boolean };
/**
 * Vůle v kroku z kontroly minimální vůle studie (balík C2 – `MotionStudy.clearance`). Dokud kontrola vůle neexistuje / neproběhla,
 * vrací null a řádek se nezobrazí (anotace nikdy nepíše vůli, která se nepočítala).
 */
export type ClearanceRow = { a: string; b: string; min: number; limit?: number };
export function clearanceAt(step: unknown): ClearanceRow[] | null {
  const c = (step as { clearance?: ClearanceRow[] } | null)?.clearance;
  return Array.isArray(c) && c.length ? c : null;
}
/**
 * Hloubka geometrického zásahu nástroje (procesní vrstva, balík C3): místo pro hodnotu, kterou doplní procesní vrstva studie.
 * Dokud studie procesní vrstvu nemá, vrací null a řádek se nezobrazí.
 */
export function cutDepthAt(step: unknown): { label: string; depth: number }[] | null {
  const c = (step as { cut?: { label: string; depth: number }[] } | null)?.cut;
  return Array.isArray(c) && c.length ? c : null;
}

/** vstup anotace: poloha (čas, nejbližší krok, hodnoty motorů) a krok výsledku s příznaky */
export type AnnotPose = { t: number; step: number; steps: number; motors: number[]; stepData?: { conflicts?: string[]; clashes?: unknown[] } & Record<string, unknown> };

/** Řádky anotace aktuální polohy – stejné v okně (DOM) i ve vypáleném obrazu exportu (PNG / WebM). */
export function annotRows(pose: AnnotPose, doc: Pick<CadDoc, "mates" | "motion">, o: { study?: number; view?: string; settings?: MotionAnnotSettings } = {}): AnnotRow[] {
  const hide = new Set(o.settings?.hide ?? []);
  const rows: AnnotRow[] = [];
  const study = doc.motion;
  if (!hide.has("t")) rows.push({ key: "t", text: o.study !== undefined ? tr("t = {0} s / {1} s", n(pose.t, 3), n(o.study, 3)) : tr("t = {0} s", n(pose.t, 3)) });
  if (!hide.has("step")) rows.push({ key: "step", text: tr("krok {0}/{1}", pose.step, Math.max(0, pose.steps - 1)) });
  if (!hide.has("motors") && study?.motors.length) {
    const label = (i: number) => {
      const mo = study.motors[i];
      const m = mo ? doc.mates?.find((x) => x.id === mo.mate) : null;
      return m?.name ?? tr("motor {0}", i + 1);
    };
    rows.push({ key: "motors", text: pose.motors.map((v, i) => `${label(i)} ${n(v, 2)}${study.motors[i]?.kind === "rotary" ? "°" : " mm"}`).join(" · ") });
  }
  const cl = hide.has("clearance") ? null : clearanceAt(pose.stepData);
  if (cl) for (const c of cl.slice(0, 4)) rows.push({ key: "clearance", text: tr("vůle {0} × {1}: {2} mm{3}", c.a, c.b, n(c.min, 3), c.limit !== undefined ? tr(" (min. {0})", n(c.limit, 3)) : ""), warn: c.limit !== undefined && c.min < c.limit });
  const cut = hide.has("cut") ? null : cutDepthAt(pose.stepData);
  if (cut) for (const c of cut.slice(0, 4)) rows.push({ key: "cut", text: tr("zásah {0}: {1} mm", c.label, n(c.depth, 3)) });
  // procesní vrstva (C3, vlna 22 bod 4): úroveň výslovně – booleovské odebrání, ne simulace materiálu
  if (cut) rows.push({ key: "cut", text: tr("geometrická aproximace – ne simulace materiálu") });
  const flags: string[] = [];
  // jen závada (skutečná / nevyhodnotitelná kolize) – pracovní kontakt procesní operace, šroub v závitu ani dotyk nejsou ⚠ kolize
  if (pose.stepData?.clashes?.some((c) => isFault((c as { cls?: ClashClass }).cls))) flags.push(tr("kolize"));
  if (pose.stepData?.conflicts?.length) flags.push(tr("nesplněno {0}", pose.stepData.conflicts.length));
  if (flags.length) rows.push({ key: "flags", text: `⚠ ${flags.join(" · ")}`, warn: true });
  if (o.view) rows.push({ key: "view", text: tr("pohled „{0}“", o.view) });
  return rows;
}
