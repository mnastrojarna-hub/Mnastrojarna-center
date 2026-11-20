/**
 * Převodník dokument → skript (doc-script.ts), část sestavy (vlna E): přezdívky komponent (`vložit "Díl" … jako "K48"`, jinak `sestava komponenta #k přezdívka "…"`),
 * pružiny mezi díly (`sestava pružina #k mezi #i F3 #j F7 volná L0 blok Ln tuhost c vedená ano|ne` – i pružiny vzniklé
 * „Pružinou mezi díly“ do děr vzoru) a nastavení dynamiky pohybové studie (`pohyb dynamika …`, gravitace libovolným
 * směrem, dynamika uložená u kinematické studie). Každý řádek se přečte rozborem konzole a porovná; co zapsat nejde
 * (dosedací plocha v podsestavě, komponenta mimo skript), ohlásí poznámka.
 */
import { parseAgentText } from "./agent";
import { tr } from "./i18n";
import type { AsmComponent, MotionStudy, Vec3 } from "./types";

type W3 = readonly [string, string, string];
const L = (cs: string, en: string, de: string): W3 => [cs, en, de];
const WD = {
  as: L("jako", "as", "als"),
  alias: L("přezdívka", "alias", "spitzname"),
  comp: L("komponenta", "component", "komponente"),
  asm: L("sestava", "assembly", "baugruppe"),
  mate: L("vazba", "mate", "verknüpfung"),
  spring: L("pružina", "spring", "feder"),
  between: L("mezi", "between", "zwischen"),
  free: L("volná", "free", "frei"),
  solid: L("blok", "solid", "block"),
  rate: L("tuhost", "rate", "steifigkeit"),
  guided: L("vedená", "guided", "geführt"),
  yes: L("ano", "yes", "ja"),
  no: L("ne", "no", "nein"),
  motion: L("pohyb", "motion", "bewegung"),
  dynamics: L("dynamika", "dynamics", "dynamik"),
  kinematics: L("kinematika", "kinematics", "kinematik"),
  quasistatic: L("kvazistatika", "quasistatic", "quasistatisch"),
  autoMode: L("automaticky", "auto", "automatisch"),
  prefer: L("preferovat", "prefer", "bevorzugen"),
  atLimit: L("na mezi", "at limit", "an grenze"),
  limitError: L("chyba", "error", "fehler"),
  time: L("čas", "time", "zeit"),
  step: L("krok", "step", "schritt"),
  gravity: L("gravitace", "gravity", "schwerkraft"),
  off: L("vyp", "off", "aus"),
  damping: L("tlumení", "damping", "dämpfung"),
  restitution: L("odraz", "restitution", "stoßzahl"),
  frames: L("snímky", "frames", "bilder"),
};
/** výchozí integrační krok dynamiky (motion-dynamic.ts defaultDyn – hlídá test; modul se nenačítá kvůli velikosti) */
export const SCRIPT_DEFAULT_DT = 0.0005;
export type AsmOut = { li: 0 | 1 | 2; line(s: string): void; note(s: string): void; n(v: number): string; q(s: string, always?: boolean): string | null };
const w = (o: AsmOut, k: keyof typeof WD) => WD[k][o.li];
type Rec = Record<string, unknown>;
const opOf = (line: string): { k: string; cmd?: Rec; alias?: string } | null => {
  try {
    const pr = parseAgentText(line);
    return !pr.errors.length && pr.ops.length === 1 ? (pr.ops[0] as unknown as { k: string; cmd?: Rec; alias?: string }) : null;
  } catch {
    return null;
  }
};

/**
 * Přezdívka komponenty #k: konec řádku `vložit …` (` jako "K48"`; `line` = řádek bez přezdívky), a když ho rozbor s přezdívkou
 * nepřečte, část řádku `sestava komponenta #k přezdívka "…"` (`patch`) – tím se přezdívka nastavuje i ručně. Obojí se ověří
 * rozborem (`read` – v testu jiný rozbor); poznámka jen u přezdívky, kterou na řádek zapsat nejde vůbec (konec řádku v textu).
 */
export function aliasScript(o: AsmOut, cp: AsmComponent, line: string, k: number, read: typeof opOf = opOf): { tail: string; patch?: string } {
  const a = cp.alias?.trim();
  if (!a) return { tail: "" };
  const q = o.q(a, true);
  if (q) {
    const tail = ` ${w(o, "as")} ${q}`;
    if (read(line + tail)?.alias === a) return { tail };
    const patch = `${w(o, "alias")} ${q}`;
    const op = read(`${w(o, "asm")} ${w(o, "comp")} #${k} ${patch}`);
    const c = op?.k === "asm" ? (op.cmd as { k?: string; comp?: string; patch?: { alias?: string } } | undefined) : undefined;
    if (c?.k === "comp" && c.comp === `#${k}` && c.patch?.alias === a) return { tail: "", patch };
  }
  o.note(tr("přezdívku „{0}“ komponenty „{1}“ nejde zapsat na řádek skriptu", a, cp.name));
  return { tail: "" };
}

/**
 * Pružiny sestavy po vazbách (dosedací plochy čísly F podle komponent #k skriptu): L0, Ln a tuhost výslovně (stejné jako
 * v definici, i když je dává tabulka pružiny), vedení dírou / kapsou. `idx` = id komponenty → pořadí #k ve skriptu.
 */
export function emitAsmSprings(o: AsmOut, comps: AsmComponent[], idx: Map<string, number>): void {
  for (const cp of comps) {
    const sp = cp.spring;
    if (!sp) continue;
    const k = idx.get(cp.id);
    const ka = idx.get(sp.a.compId);
    const kb = idx.get(sp.b.compId);
    const what = tr("pružinu „{0}“", cp.name);
    if (k === undefined || ka === undefined || kb === undefined || sp.a.leaf || sp.b.leaf || sp.a.face < 0 || sp.b.face < 0 || sp.a.ent || sp.b.ent) {
      o.note(tr("{0} sestavy nejde zapsat textem (komponenta mimo skript nebo dosedací plocha v podsestavě) – doplňte ji: sestava pružina", what));
      continue;
    }
    let l = `${w(o, "asm")} ${w(o, "spring")} #${k} ${w(o, "between")} #${ka} F${sp.a.face + 1} #${kb} F${sp.b.face + 1} ${w(o, "free")} ${o.n(sp.free)}`;
    if (sp.solid !== undefined) l += ` ${w(o, "solid")} ${o.n(sp.solid)}`;
    if (sp.rate !== undefined) l += ` ${w(o, "rate")} ${o.n(sp.rate)}`;
    if (sp.guided !== undefined) l += ` ${w(o, "guided")} ${w(o, sp.guided ? "yes" : "no")}`;
    const op = opOf(l);
    const c = op?.k === "asm" ? op.cmd : undefined;
    const face = (f: unknown) => (f as { index?: number } | undefined)?.index;
    const ok =
      !!c &&
      c.k === "spring" &&
      c.comp === `#${k}` &&
      c.a === `#${ka}` &&
      c.b === `#${kb}` &&
      face(c.faceA) === sp.a.face &&
      face(c.faceB) === sp.b.face &&
      c.free === sp.free &&
      c.solid === sp.solid &&
      c.rate === sp.rate &&
      c.guided === sp.guided;
    if (ok) o.line(l);
    else o.note(tr("{0} sestavy nejde zapsat textem (komponenta mimo skript nebo dosedací plocha v podsestavě) – doplňte ji: sestava pružina", what));
  }
}

/** směr gravitace: jednotková osa jako -Z / +Y, jinak tři čísla, vypnutá = vyp */
function gravityText(o: AsmOut, g: Vec3 | null): string {
  if (g === null) return w(o, "off");
  const nz = g.map((v, i) => [v, i] as const).filter(([v]) => v !== 0);
  if (nz.length === 1 && Math.abs(nz[0][0]) === 1) return `${nz[0][0] < 0 ? "-" : "+"}${"XYZ"[nz[0][1]]}`;
  return g.map(o.n).join(" ");
}

/**
 * Řádek `pohyb dynamika …` z nastavení dynamiky (čas, krok, gravitace, tlumení, odraz, snímky). U kinematické studie
 * s uloženým nastavením dynamiky následuje `pohyb kinematika` (nastavení zůstane, studie zůstane kinematická).
 */
export function emitDynamics(o: AsmOut, mo: MotionStudy): void {
  const d = mo.dyn;
  if (!d) return;
  const dynamic = mo.mode === "dynamic";
  // kinematická studie bez vlastního nastavení dynamiky (jen hmotnosti / síly) – řádek dynamika netřeba
  if (!dynamic && d.gravity === undefined && !d.damping && !d.restitution && !d.frames && d.dt === SCRIPT_DEFAULT_DT) return;
  let l = `${w(o, "motion")} ${w(o, "dynamics")} ${w(o, "time")} ${o.n(mo.duration)}`;
  if (d.dt > 0) l += ` ${w(o, "step")} ${o.n(d.dt)}`;
  if (d.gravity !== undefined) l += ` ${w(o, "gravity")} ${gravityText(o, d.gravity)}`;
  if (d.damping) l += ` ${w(o, "damping")} ${o.n(d.damping)}`;
  if (d.restitution) l += ` ${w(o, "restitution")} ${o.n(d.restitution)}`;
  if (d.frames) l += ` ${w(o, "frames")} ${o.n(d.frames)}`;
  const op = opOf(l);
  const c = op?.k === "asm" ? (op.cmd as { k?: string; cmd?: Rec } | undefined) : undefined;
  const dyn = (c?.cmd as { op?: string; cmd?: Rec } | undefined)?.cmd;
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const ok = !!dyn && dyn.k === "on" && dyn.duration === mo.duration && (d.dt > 0 ? dyn.dt === d.dt : dyn.dt === undefined) && same(dyn.gravity, d.gravity) && same(dyn.damping, d.damping || undefined) && same(dyn.restitution, d.restitution || undefined) && same(dyn.frames, d.frames || undefined);
  if (!ok) {
    o.note(tr("nastavení dynamiky pohybové studie nejde zapsat příkazem pohyb dynamika (čas, krok, gravitace, tlumení, odraz, snímky mimo rozsah příkazu)"));
    return;
  }
  o.line(l);
  // zpět z dynamiky na režim studie, jak je uložený (vlna 22: kinematika / kvazistatika / automaticky)
  if (!dynamic) o.line(studyModeLine(o, mo));
}

/** řádek režimu studie (vlna 22, bod 2): `pohyb kinematika | kvazistatika | automaticky` */
export const studyModeLine = (o: AsmOut, mo: MotionStudy): string => `${w(o, "motion")} ${w(o, mo.mode === "quasistatic" ? "quasistatic" : mo.mode === "kinematic" ? "kinematics" : "autoMode")}`;

/**
 * Režim studie bez nastavení dynamiky (dynamika ho zapíše za řádkem `pohyb dynamika`), preferované strany mezí a chování motoru na
 * mezi se zapíší do skriptu (vlna 22, body 2 a 8); `mateNo` = číslo vazby ve skriptu.
 */
export function emitStudyExtras(o: AsmOut, mo: MotionStudy | undefined, mates: { id: string; prefer?: "min" | "max" }[], mateNo: Map<string, number>): void {
  for (const m of mates) {
    const no = mateNo.get(m.id);
    if (m.prefer && no !== undefined) o.line(`${w(o, "asm")} ${w(o, "mate")} ${no} ${w(o, "prefer")} ${m.prefer}`);
  }
  // s vlastním nastavením dynamiky zapíše režim `emitDynamics` za řádkem `pohyb dynamika`
  const d = mo?.dyn;
  const dynLine = !!d && !(d.gravity === undefined && !d.damping && !d.restitution && !d.frames && d.dt === SCRIPT_DEFAULT_DT);
  if (mo && mo.mode !== "dynamic" && mo.mode !== undefined && !dynLine) o.line(studyModeLine(o, mo));
}

/** dovětek motoru `na mezi chyba` (výchozí stop se nepíše) */
export const motorLimitWords = (o: AsmOut, mo: { atLimit?: "stop" | "error" }): string => (mo.atLimit === "error" ? ` ${w(o, "atLimit")} ${w(o, "limitError")}` : "");
