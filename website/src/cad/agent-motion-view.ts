/**
 * Pohledy pohybové studie, časování videa a anotace textem (vlna 22, body 13 a 14 zprávy). Rozbor i provedení; háček
 * v `parseMotionText` (cad/agent-motion.ts) a v `applyMotionCmd` (cad/asm-agent-kin.ts):
 *
 * - `pohyb pohled uložit "<název>" [kamera iso|přední|zadní|horní|spodní|levý|pravý] [směr dx dy dz] [cíl x y z] [výška H]
 *   [řez X|Y|Z <poloha> [obráceně] | řez normála nx ny nz [bod x y z] [posun d] [obráceně] | bez řezu]` – pohled do studie
 *   (stejný název = nahradí); `pohyb pohled "<název>"|N` – aktivní pohled (přehrávání a export ho použijí), `pohyb pohled okno`
 *   – bez pohledu; `pohyb pohled smazat "<název>"|N`; `pohyb pohledy` – výpis;
 * - `pohyb video [rychlost 0,5 | 0,5×] [fps 30] [délka 5] [pohled "<A>" ["<B>" …] | pohledy vše | pohledy vyp] [anotace zap|vyp]` –
 *   uloží volby exportu videa do studie a vypíše časový plán (délka videa, poměr ke studii, snímky);
 * - `pohyb export png|webm [tytéž volby] [kroky]` – export s časovým plánem (v aplikaci soubor, v CLI ✗ host.app-only + plán);
 * - `pohyb anotace zap|vyp` – anotace aktuální polohy v okně i v exportu.
 * Anglicky (motion view save / views / video / annotations, speed, length, section, camera) i německy (bewegung ansicht
 * speichern, ansichten, video, anmerkungen, geschwindigkeit, länge, schnitt, kamera).
 */
import { asmIsNum, asmNum, asmWords as W, fmt, type AsmCursor } from "./agent-asm";
import type { AsmResult } from "./asm-agent";
import { tr } from "./i18n";
import { activeView, cameraText, checkSection, findView, removeView, sectionText, upsertView, viewText, type CamView } from "./motion-views";
import { planKv, planText, studySpan, videoPlan, type VideoOpts } from "./motion-video";
import type { MotionResult } from "./motion";
import { uid, type CadDoc, type MotionStudy, type MotionVideoSettings, type StudyCamera, type StudySection, type Vec3 } from "./types";

/** volby exportu z textu: časování, pohledy (id), anotace, snímky po krocích (jen PNG) */
export type MotionVideoSignal = VideoOpts & { views?: string[]; annot?: boolean; perStep?: boolean };
type VideoArgs = { speed?: number; fps?: number; seconds?: number; views?: string[] | "all" | "none"; annot?: boolean; perStep?: boolean };

export type MotionViewCmd =
  | { k: "save"; name: string; camera?: StudyCamera; section?: StudySection | null }
  | { k: "use"; ref: string | null }
  | { k: "remove"; ref: string }
  | { k: "list" }
  | { k: "video"; args: VideoArgs }
  | { k: "export"; format: "png" | "webm"; args: VideoArgs }
  | { k: "annot"; on: boolean };

const K = {
  view: W("pohled", "view", "ansicht"),
  views: W("pohledy", "views", "ansichten"),
  save: W("uložit", "ulozit", "save", "store", "speichern"),
  del: W("smazat", "odstranit", "odebrat", "delete", "remove", "löschen", "loeschen", "entfernen"),
  window: W("okno", "vyp", "žádný", "zadny", "window", "none", "off", "fenster", "keine", "aus"),
  video: W("video", "videa"),
  export: W("export", "exportovat", "exportieren"),
  annot: W("anotace", "popisky", "annotations", "annotation", "labels", "anmerkungen", "beschriftung"),
  on: W("zap", "zapnout", "ano", "on", "yes", "ein", "ja"),
  off: W("vyp", "vypnout", "ne", "off", "no", "aus", "nein"),
  speed: W("rychlost", "tempo", "speed", "rate", "geschwindigkeit"),
  fps: W("fps", "snímků/s", "frames/s"),
  length: W("délka", "delka", "length", "länge", "laenge"),
  all: W("vše", "vse", "všechny", "vsechny", "all", "alle"),
  steps: W("kroky", "po-krocích", "steps", "schritte"),
  camera: W("kamera", "camera", "kamera"),
  dir: W("směr", "smer", "direction", "dir", "richtung"),
  target: W("cíl", "cil", "target", "ziel"),
  height: W("výška", "vyska", "height", "höhe", "hoehe"),
  section: W("řez", "rez", "řezu", "section", "cut", "schnitt"),
  normal: W("normála", "normala", "normal", "normale"),
  point: W("bod", "point", "punkt"),
  offset: W("posun", "offset", "versatz"),
  flip: W("obráceně", "obracene", "otočit", "flip", "reversed", "umgekehrt"),
  without: W("bez", "no", "without", "ohne"),
};
const VIEWS: Record<string, CamView> = {
  iso: "iso", izometrie: "iso", isometric: "iso", isometrie: "iso",
  predni: "front", front: "front", vorne: "front", vorderansicht: "front",
  zadni: "back", back: "back", hinten: "back",
  horni: "top", top: "top", oben: "top", draufsicht: "top",
  spodni: "bottom", bottom: "bottom", unten: "bottom",
  levy: "left", left: "left", links: "left",
  pravy: "right", right: "right", rechts: "right",
};
const FORMATS: Record<string, "png" | "webm"> = { png: "png", snimky: "png", frames: "png", bilder: "png", webm: "webm", video: "webm", animace: "webm", animation: "webm" };

export const MOTION_VIEW_USE = () =>
  tr("pohyb pohled uložit \"<název>\" [kamera přední|horní|…] [směr dx dy dz] [cíl x y z] [výška H] [řez X|Y|Z <poloha> [obráceně] | bez řezu] · pohyb pohled \"<název>\"|okno · pohyb pohledy · pohyb video [rychlost 0,5] [fps 30] [délka 5] [pohled \"<A>\" …|pohledy vše] [anotace vyp] · pohyb export webm|png [volby videa] · pohyb anotace zap|vyp");

/** rychlost „0,5“, „0,5×“, „0.5x“, „1×“ (znak × nebo x za číslem) */
function speedTok(t: string | undefined): number | null {
  const m = /^(\d+(?:[.,]\d+)?|[.,]\d+)\s*[×x]?$/i.exec(t ?? "");
  return m ? asmNum(m[1]) : null;
}

/** volby videa (rychlost, fps, délka, pohledy, anotace, kroky) – vrací false u neznámého slova */
function videoArg(c: AsmCursor, o: VideoArgs): boolean {
  const t = c.peek();
  if (!t) return false;
  if (c.is(K.speed)) {
    c.i++;
    const v = speedTok(c.next()?.t);
    if (v === null || !(v > 0)) throw new Error(tr("rychlost videa: kladné číslo, např. 1, 0,5 nebo 0,25×"));
    o.speed = v;
  } else if (!t.q && /[×x]$/i.test(t.t) && speedTok(t.t) !== null) {
    c.i++;
    o.speed = speedTok(t.t)!;
  } else if (c.is(K.fps)) {
    c.i++;
    o.fps = c.num("fps");
  } else if (!t.q && /^\d+(?:[.,]\d+)?fps$/i.test(t.t)) {
    c.i++;
    o.fps = asmNum(t.t);
  } else if (c.is(K.length)) {
    c.i++;
    o.seconds = asmNum((c.next()?.t ?? "").replace(/s$/i, ""));
    if (!(o.seconds > 0)) throw new Error(tr("délka videa: kladné číslo v sekundách"));
  } else if (c.is(K.views)) {
    c.i++;
    if (c.is(K.all)) o.views = "all";
    else if (c.is(K.off) || c.is(K.window)) o.views = "none";
    else throw new Error(tr("pohledy vše | pohledy vyp"));
    c.i++;
  } else if (c.is(K.view)) {
    c.i++;
    const list: string[] = [];
    while (c.peek()?.q || (c.peek() && /^#?\d+$/.test(c.peek()!.t) && !c.is(K.fps, 1))) list.push(c.next()!.t.trim());
    if (!list.length) throw new Error(tr("pohled: zadejte název uloženého pohledu v uvozovkách nebo číslo"));
    o.views = list;
  } else if (c.is(K.annot)) {
    c.i++;
    o.annot = true;
    if (c.is(K.off)) {
      c.i++;
      o.annot = false;
    } else if (c.is(K.on)) c.i++;
  } else if (c.is(K.steps)) {
    c.i++;
    o.perStep = true;
  } else return false;
  return true;
}

function vec(c: AsmCursor, what: string): Vec3 {
  // „1 0 0“ i „1; 0; 0“ (středníky se vypustí jako samostatné tokeny i na konci čísla)
  const out: number[] = [];
  while (out.length < 3) {
    const t = c.next();
    if (!t) throw new Error(tr("{0}: čekám tři čísla", what));
    for (const p of t.t.split(";").map((x) => x.trim()).filter(Boolean)) {
      if (!asmIsNum(p)) throw new Error(tr("{0}: čekám číslo, ne „{1}“", what, p));
      out.push(asmNum(p));
    }
  }
  return [out[0], out[1], out[2]];
}

/** kamera a řez za `pohled uložit "<název>"` */
function viewArgs(c: AsmCursor, out: Extract<MotionViewCmd, { k: "save" }>) {
  const cam: StudyCamera = {};
  while (!c.done) {
    if (c.is(K.camera)) {
      c.i++;
      const v = VIEWS[c.word()];
      if (!v) throw new Error(tr("kamera: iso | přední | zadní | horní | spodní | levý | pravý"));
      c.i++;
      cam.view = v;
    } else if (VIEWS[c.word()] && !c.is(K.section)) {
      cam.view = VIEWS[c.word()];
      c.i++;
    } else if (c.is(K.dir)) {
      c.i++;
      cam.dir = vec(c, tr("směr"));
      if (!(Math.hypot(...cam.dir) > 1e-9)) throw new Error(tr("směr kamery nesmí být nulový vektor"));
    } else if (c.is(K.target)) {
      c.i++;
      cam.target = vec(c, tr("cíl"));
    } else if (c.is(K.height)) {
      c.i++;
      cam.height = c.num(tr("výška"));
      if (!(cam.height > 0)) throw new Error(tr("výška záběru musí být kladná [mm]"));
    } else if (c.is(K.without) && c.is(K.section, 1)) {
      c.i += 2;
      out.section = null;
    } else if (c.is(K.section)) {
      c.i++;
      let s: StudySection;
      if (c.is(K.normal)) {
        c.i++;
        s = { axis: "Z", offset: 0, flip: false, normal: vec(c, tr("normála")) };
      } else {
        const ax = c.word().toUpperCase();
        if (ax !== "X" && ax !== "Y" && ax !== "Z") throw new Error(tr("řez: X | Y | Z <poloha> nebo řez normála nx ny nz"));
        c.i++;
        s = { axis: ax, offset: c.num(tr("poloha řezu")), flip: false };
      }
      while (!c.done) {
        if (c.is(K.flip)) {
          c.i++;
          s.flip = true;
        } else if (s.normal && c.is(K.point)) {
          c.i++;
          s.origin = vec(c, tr("bod"));
        } else if (s.normal && c.is(K.offset)) {
          c.i++;
          s.offset = c.num(tr("posun"));
        } else break;
      }
      out.section = checkSection(s);
    } else throw new Error(tr("pohyb pohled uložit: neznámá volba „{0}“ – {1}", c.peek()!.t, MOTION_VIEW_USE()));
  }
  if (cam.view || cam.dir || cam.target || cam.height !== undefined) out.camera = cam;
}

/**
 * Rozbor podpříkazů pohledů, videa a anotací (`c` stojí za slovem „pohyb“). Jiný podpříkaz → null (rozbor pokračuje v
 * cad/agent-motion.ts). `pohyb export csv` zůstává původnímu rozboru.
 */
export function parseMotionViewText(c: AsmCursor): MotionViewCmd | null {
  if (c.is(K.views) && c.peek(1) === undefined) return { k: "list" };
  if (c.is(K.view)) {
    c.i++;
    if (c.is(K.save)) {
      c.i++;
      const t = c.next();
      if (!t || !t.t.trim()) throw new Error(tr("pohled uložit: zadejte název – pohyb pohled uložit \"Řez pružinami\" řez Y 50 kamera přední"));
      const out: Extract<MotionViewCmd, { k: "save" }> = { k: "save", name: t.t.trim() };
      viewArgs(c, out);
      return out;
    }
    if (c.is(K.del)) {
      c.i++;
      const t = c.next();
      if (!t) throw new Error(tr("pohled smazat: zadejte název nebo číslo pohledu"));
      return { k: "remove", ref: t.t.trim() };
    }
    if (c.is(K.window)) return { k: "use", ref: null };
    const t = c.next();
    if (!t) return { k: "list" };
    if (!c.done) throw new Error(tr("pohyb pohled: neznámá volba „{0}“ – {1}", c.peek()!.t, MOTION_VIEW_USE()));
    return { k: "use", ref: t.t.trim() };
  }
  if (c.is(K.video)) {
    c.i++;
    const args: VideoArgs = {};
    while (!c.done) if (!videoArg(c, args)) throw new Error(tr("pohyb video: neznámá volba „{0}“ – {1}", c.peek()!.t, MOTION_VIEW_USE()));
    return { k: "video", args };
  }
  if (c.is(K.annot)) {
    c.i++;
    const on = !c.is(K.off);
    if (!c.done) c.i++;
    return { k: "annot", on };
  }
  if (c.is(K.export)) {
    const f = FORMATS[c.word(1)];
    if (!f) return null;
    c.i += 2;
    const args: VideoArgs = {};
    while (!c.done) if (!videoArg(c, args)) throw new Error(tr("pohyb export {0}: neznámá volba „{1}“ – {2}", f, c.peek()!.t, MOTION_VIEW_USE()));
    return { k: "export", format: f, args };
  }
  return null;
}

/* ───────────────────────── provedení ───────────────────────── */

type Codes = NonNullable<AsmResult["codes"]>;
const result = (doc: CadDoc, log: string[], changed: boolean, motion?: AsmResult["motion"], codes?: Codes, kv?: string): AsmResult => ({ doc, log, changed, ...(motion ? { motion } : {}), ...(codes?.length ? { codes } : {}), ...(kv ? { kv } : {}) });

/** pohledy z voleb (názvy / čísla → id); neznámý pohled = chyba s výpisem uložených */
function resolveViews(study: MotionStudy, v: VideoArgs["views"]): string[] | undefined {
  if (v === undefined || v === "none") return v === "none" ? [] : undefined;
  if (v === "all") {
    if (!study.views?.length) throw new Error(tr("studie nemá uložené pohledy – pohyb pohled uložit \"<název>\" …"));
    return study.views.map((x) => x.id);
  }
  return v.map((ref) => {
    const f = findView(study, ref);
    if (!f) throw new Error(tr("pohled „{0}“ ve studii není – uložené: {1}", ref, (study.views ?? []).map((x, i) => `${i + 1}. ${x.name}`).join(", ") || tr("žádné")));
    return f.id;
  });
}

/** volby videa ze zadání přes uložené nastavení studie (ruční délka zruší rychlost a naopak) */
export function mergeVideo(saved: MotionVideoSettings | undefined, args: VideoArgs, study: MotionStudy): MotionVideoSettings {
  const out: MotionVideoSettings = { ...(saved ?? {}) };
  if (args.speed !== undefined) {
    out.speed = args.speed;
    delete out.seconds;
  }
  if (args.seconds !== undefined) {
    out.seconds = args.seconds;
    delete out.speed;
  }
  if (args.fps !== undefined) out.fps = args.fps;
  const views = resolveViews(study, args.views);
  if (views !== undefined) {
    if (views.length) out.views = views;
    else delete out.views;
  }
  if (args.annot !== undefined) {
    if (args.annot) delete out.annot;
    else out.annot = false;
  }
  return out;
}

const viewNames = (study: MotionStudy, ids: string[] | undefined) => (ids ?? []).map((id) => study.views?.find((v) => v.id === id)?.name ?? "?");

/**
 * Provede podpříkaz pohledů / videa / anotací. `run` spočítá (nebo z mezipaměti vrátí) výsledek studie – jen export ho
 * potřebuje (panel aplikace pak exportuje z výsledku, který platí pro tento stav sestavy).
 */
export async function applyMotionViewCmd(d: CadDoc, cmd: MotionViewCmd, opts: { run: () => Promise<MotionResult>; codes?: Codes }): Promise<AsmResult> {
  const log: string[] = [];
  const codes: Codes = [...(opts.codes ?? [])];
  const study: MotionStudy | undefined = d.motion;
  const need = () => {
    if (!study) throw new Error(tr("sestava nemá pohybovou studii – pohyb motor …"));
    return study;
  };
  switch (cmd.k) {
    case "list": {
      const s = need();
      const act = activeView(s);
      if (!s.views?.length) log.push(tr("Pohledy studie: žádné – pohyb pohled uložit \"<název>\" [řez Y 50] [kamera přední]"));
      else log.push(tr("Pohledy studie ({0}), aktivní: {1}", s.views.length, act ? `„${act.name}“` : tr("okno")), ...s.views.map((v, i) => viewText(v, i, v.id === act?.id)));
      return result(d, log, false, undefined, codes);
    }
    case "save": {
      const s = need();
      const r = upsertView(s, { name: cmd.name, ...(cmd.camera ? { camera: cmd.camera } : {}), ...(cmd.section !== undefined ? { section: cmd.section } : {}) }, uid);
      const doc = { ...d, motion: r.study };
      log.push(tr("✓ pohled studie „{0}“ {1}: {2} · {3}", r.view.name, r.replaced ? tr("nahrazen") : tr("uložen"), cameraText(r.view.camera), sectionText(r.view.section)));
      if (!cmd.camera) log.push(tr("  kamera neuložena – při použití pohledu zůstane kamera okna (v aplikaci tlačítko „Uložit pohled“ uloží i kameru)"));
      return result(doc, log, true, undefined, codes);
    }
    case "use": {
      const s = need();
      if (cmd.ref === null) {
        const out: MotionStudy = { ...s };
        delete out.view;
        log.push(tr("✓ přehrávání a export bez uloženého pohledu (kamera a řez okna)"));
        return result({ ...d, motion: out }, log, s.view !== undefined, { view: "" }, codes);
      }
      const v = findView(s, cmd.ref);
      if (!v) throw new Error(tr("pohled „{0}“ ve studii není – uložené: {1}", cmd.ref, (s.views ?? []).map((x, i) => `${i + 1}. ${x.name}`).join(", ") || tr("žádné")));
      log.push(tr("✓ aktivní pohled studie „{0}“: {1} · {2} (použije se při přehrávání a exportu)", v.name, cameraText(v.camera), sectionText(v.section)));
      return result({ ...d, motion: { ...s, view: v.id } }, log, s.view !== v.id, { open: true, view: v.id }, codes);
    }
    case "remove": {
      const s = need();
      const v = findView(s, cmd.ref);
      if (!v) throw new Error(tr("pohled „{0}“ ve studii není", cmd.ref));
      log.push(tr("✓ pohled studie „{0}“ odebrán", v.name));
      return result({ ...d, motion: removeView(s, v.id) }, log, true, undefined, codes);
    }
    case "annot": {
      const s = need();
      const annot = { ...(s.annot ?? {}) };
      if (cmd.on) delete annot.off;
      else annot.off = true;
      const out: MotionStudy = { ...s, annot };
      if (!Object.keys(annot).length) delete out.annot;
      log.push(cmd.on ? tr("✓ anotace polohy zapnuté (čas, krok, motory{0}) – v okně i v exportu PNG / WebM", "") : tr("✓ anotace polohy vypnuté"));
      return result({ ...d, motion: out }, log, !!s.annot?.off !== !cmd.on, undefined, codes);
    }
    case "video": {
      const s = need();
      const video = mergeVideo(s.video, cmd.args, s);
      const plan = videoPlan(s.duration, video);
      const changed = JSON.stringify(video) !== JSON.stringify(s.video ?? {});
      const out: MotionStudy = { ...s, video };
      if (!Object.keys(video).length) delete out.video;
      log.push(tr("Video studie: {0}", planText(plan)));
      if (video.views?.length) log.push(tr("  pohledy: {0}{1}", viewNames(s, video.views).map((x) => `„${x}“`).join(", "), video.views.length > 1 ? tr(" (synchronně vedle sebe)") : ""));
      if (video.annot === false) log.push(tr("  anotace: vypnuté"));
      return result({ ...d, motion: out }, log, changed, undefined, codes, planKv(plan));
    }
    case "export": {
      const s = need();
      const video = mergeVideo(s.video, cmd.args, s);
      const res = await opts.run();
      const T = studySpan(res, s.duration);
      // PNG bez voleb časování = snímek na každý vypočtený krok (jako dřív); s volbami (nebo `kroky` u videa) podle plánu
      const timed = cmd.args.speed !== undefined || cmd.args.seconds !== undefined || cmd.args.fps !== undefined;
      const perStep = cmd.format === "png" ? cmd.args.perStep || !timed : false;
      if (cmd.format === "webm" && cmd.args.perStep) throw new Error(tr("pohyb export webm: volba „kroky“ platí jen pro snímky PNG"));
      const plan = videoPlan(T, video);
      const signal: MotionVideoSignal = { ...(video.speed !== undefined ? { speed: video.speed } : {}), ...(video.seconds !== undefined ? { seconds: video.seconds } : {}), ...(video.fps !== undefined ? { fps: video.fps } : {}), ...(video.views?.length ? { views: video.views } : {}), ...(video.annot === false ? { annot: false } : {}), ...(perStep ? { perStep: true } : {}) };
      if (perStep) log.push(tr("Snímky PNG: {0} snímků po vypočtených krocích (t = 0 … {1} s), anotace {2}", res.steps.length, fmt(T, 3), video.annot === false ? tr("vypnuté") : tr("zapnuté")));
      else log.push(tr("{0} s pevným časováním: {1}", cmd.format === "webm" ? tr("Video WebM") : tr("Snímky PNG"), planText(plan)));
      if (video.views?.length) log.push(tr("  pohledy: {0}{1}", viewNames(s, video.views).map((x) => `„${x}“`).join(", "), video.views.length > 1 ? tr(" (synchronně vedle sebe)") : ""));
      else if (activeView(s)) log.push(tr("  pohled: „{0}“", activeView(s)!.name));
      return result(d, log, false, { open: true, export: cmd.format, video: signal }, codes, perStep ? undefined : planKv(plan));
    }
  }
}
