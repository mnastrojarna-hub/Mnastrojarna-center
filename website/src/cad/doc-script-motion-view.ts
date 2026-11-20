/**
 * Převodník dokument → skript (doc-script.ts), část pohybové studie z vlny 22 (body 13 a 14): uložené pohledy studie (kamera a řez),
 * aktivní pohled, volby videa a vypnuté anotace jako řádky `pohyb pohled uložit …`, `pohyb pohled "…"`, `pohyb video …`,
 * `pohyb anotace vyp`. Každý řádek se přečte rozborem konzole a porovná se zapisovaným stavem; co zapsat nejde, ohlásí poznámka.
 */
import { parseAgentText } from "./agent";
import { tr } from "./i18n";
import type { AsmOut } from "./doc-script-asm";
import type { MotionStudy, MotionView, Vec3 } from "./types";

type W3 = readonly [string, string, string];
const L = (cs: string, en: string, de: string): W3 => [cs, en, de];
const WD = {
  motion: L("pohyb", "motion", "bewegung"),
  view: L("pohled", "view", "ansicht"),
  save: L("uložit", "save", "speichern"),
  camera: L("kamera", "camera", "kamera"),
  dir: L("směr", "direction", "richtung"),
  target: L("cíl", "target", "ziel"),
  height: L("výška", "height", "höhe"),
  section: L("řez", "section", "schnitt"),
  normal: L("normála", "normal", "normale"),
  point: L("bod", "point", "punkt"),
  offset: L("posun", "offset", "versatz"),
  flip: L("obráceně", "flip", "umgekehrt"),
  noSection: L("bez řezu", "no section", "ohne schnitt"),
  video: L("video", "video", "video"),
  speed: L("rychlost", "speed", "geschwindigkeit"),
  length: L("délka", "length", "länge"),
  annot: L("anotace", "annotations", "anmerkungen"),
  off: L("vyp", "off", "aus"),
};
const CAM: Record<string, W3> = {
  iso: L("iso", "iso", "iso"),
  front: L("přední", "front", "vorne"),
  back: L("zadní", "back", "hinten"),
  top: L("horní", "top", "oben"),
  bottom: L("spodní", "bottom", "unten"),
  left: L("levý", "left", "links"),
  right: L("pravý", "right", "rechts"),
};
const w = (o: AsmOut, k: keyof typeof WD) => WD[k][o.li];
type Rec = Record<string, unknown>;
/** příkaz pohledu / videa z řádku skriptu (rozbor konzole) – null = řádek se nepřečte */
const viewOp = (line: string): Rec | null => {
  try {
    const pr = parseAgentText(line);
    const op = !pr.errors.length && pr.ops.length === 1 ? (pr.ops[0] as unknown as { k: string; cmd?: Rec }) : null;
    const m = op?.k === "asm" ? (op.cmd as { k?: string; cmd?: Rec } | undefined) : undefined;
    const mc = m?.k === "motion" ? (m.cmd as { op?: string; cmd?: Rec } | undefined) : undefined;
    return mc?.op === "view" ? (mc.cmd ?? null) : null;
  } catch {
    return null;
  }
};
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const vec = (o: AsmOut, v: Vec3) => v.map(o.n).join(" ");

/** řádek `pohyb pohled uložit "<název>" …` pohledu (null = název nejde zapsat) */
function viewLine(o: AsmOut, v: MotionView): string | null {
  const q = o.q(v.name, true);
  if (!q) return null;
  let l = `${w(o, "motion")} ${w(o, "view")} ${w(o, "save")} ${q}`;
  const c = v.camera;
  if (c) {
    if (c.dir) l += ` ${w(o, "dir")} ${vec(o, c.dir)}`;
    else if (c.view) l += ` ${w(o, "camera")} ${CAM[c.view][o.li]}`;
    if (c.target) l += ` ${w(o, "target")} ${vec(o, c.target)}`;
    if (c.height !== undefined) l += ` ${w(o, "height")} ${o.n(c.height)}`;
  }
  const s = v.section;
  if (s === null) l += ` ${w(o, "noSection")}`;
  else if (s) {
    if (s.normal) {
      l += ` ${w(o, "section")} ${w(o, "normal")} ${vec(o, s.normal)}`;
      if (s.origin) l += ` ${w(o, "point")} ${vec(o, s.origin)}`;
      if (s.offset) l += ` ${w(o, "offset")} ${o.n(s.offset)}`;
    } else l += ` ${w(o, "section")} ${s.axis} ${o.n(s.offset)}`;
    if (s.flip) l += ` ${w(o, "flip")}`;
  }
  return l;
}

/**
 * Pohledy studie, aktivní pohled, volby videa a vypnuté anotace (po motorech a dynamice). Pohled s kamerou bez směru i bez
 * pojmenovaného pohledu (jen cíl / výška) se zapíše; přečtený řádek musí dát tutéž kameru a řez.
 */
export function emitMotionViews(o: AsmOut, mo: MotionStudy | undefined): void {
  if (!mo) return;
  const views = mo.views ?? [];
  views.forEach((v, i) => {
    const l = viewLine(o, v);
    const cmd = l ? viewOp(l) : null;
    const camera = v.camera && (v.camera.dir || v.camera.view || v.camera.target || v.camera.height !== undefined) ? (v.camera.dir ? { ...v.camera, view: undefined } : v.camera) : undefined;
    // obecná rovina (normála): osa se nepoužívá – porovná se normála, bod, posun a strana
    const sec = (x: unknown) => {
      const s = x as MotionView["section"];
      return s && s.normal ? { normal: s.normal, origin: s.origin ?? null, offset: s.offset, flip: !!s.flip } : s === undefined ? null : s;
    };
    const ok = !!cmd && cmd.k === "save" && cmd.name === v.name.trim() && same(cmd.camera, camera && JSON.parse(JSON.stringify(camera))) && same(sec(cmd.section), sec(v.section));
    if (l && ok) o.line(l);
    else o.note(tr("pohled studie č. {0} „{1}“ nejde zapsat příkazem pohyb pohled uložit", i + 1, v.name));
  });
  const act = mo.view ? views.findIndex((v) => v.id === mo.view) : -1;
  if (act >= 0) o.line(`${w(o, "motion")} ${w(o, "view")} ${act + 1}`);
  const vd = mo.video;
  if (vd && Object.keys(vd).length) {
    let l = `${w(o, "motion")} ${w(o, "video")}`;
    if (vd.seconds !== undefined) l += ` ${w(o, "length")} ${o.n(vd.seconds)}`;
    else if (vd.speed !== undefined) l += ` ${w(o, "speed")} ${o.n(vd.speed)}`;
    if (vd.fps !== undefined) l += ` fps ${o.n(vd.fps)}`;
    const nos = (vd.views ?? []).map((id) => views.findIndex((v) => v.id === id) + 1);
    if (nos.length && nos.every((k) => k > 0)) l += ` ${w(o, "view")} ${nos.join(" ")}`;
    else if (nos.length) o.note(tr("volby videa odkazují na pohled, který ve studii není – pohledy videa se do skriptu nepřenáší"));
    if (vd.annot === false) l += ` ${w(o, "annot")} ${w(o, "off")}`;
    if (l !== `${w(o, "motion")} ${w(o, "video")}`) {
      const cmd = viewOp(l);
      if (cmd?.k === "video") o.line(l);
      else o.note(tr("volby videa pohybové studie nejde zapsat příkazem pohyb video"));
    }
  }
  if (mo.annot?.off) o.line(`${w(o, "motion")} ${w(o, "annot")} ${w(o, "off")}`);
}
