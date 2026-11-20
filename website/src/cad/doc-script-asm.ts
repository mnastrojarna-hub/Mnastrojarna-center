/**
 * Převodník dokument → skript (doc-script.ts), část sestavy (vlna E): přezdívky komponent (`vložit "Díl" … jako "K48"`, jinak `sestava komponenta #k přezdívka "…"`),
 * pružiny mezi díly (`sestava pružina #k mezi #i F3 #j F7 volná L0 blok Ln tuhost c vedená ano|ne` – i pružiny vzniklé
 * „Pružinou mezi díly“ do děr vzoru) a nastavení dynamiky pohybové studie (`pohyb dynamika …`, gravitace libovolným
 * směrem, dynamika uložená u kinematické studie). Každý řádek se přečte rozborem konzole a porovná; co zapsat nejde
 * (dosedací plocha v podsestavě, komponenta mimo skript), ohlásí poznámka.
 */
import { parseAgentText } from "./agent";
import { tr } from "./i18n";
import type { AsmComponent, MotionMotor, MotionStudy, Vec3 } from "./types";

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
  // vlna 22, bod 3: úseky motoru, klíčové polohy, okno, fáze
  from: L("od", "from", "von"),
  then: L("pak", "then", "dann"),
  dwell: L("prodleva", "dwell", "verweilen"),
  keys: L("klíče", "keys", "schlüssel"),
  window: L("okno", "window", "fenster"),
  phase: L("fáze", "phase", "phase"),
  speed: L("rychlost", "speed", "geschwindigkeit"),
  rpm: L("ot/min", "rpm", "u/min"),
  when: L("při", "when", "wenn"),
  motor: L("motor", "motor", "antrieb"),
  enable: L("zapnout", "enable", "aktivieren"),
  suppress: L("potlačit", "suppress", "unterdrücken"),
  edit: L("upravit", "edit", "bearbeiten"),
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

/* ───────────────────────── fáze a úseky motorů (vlna 22, bod 3) ───────────────────────── */

/** motor s víc úseky / klíčovými polohami / oknem / fází se zapisuje touto cestou (jinak dřívější tvar řádku) */
export const motorIsPiecewise = (m: MotionMotor): boolean => !!(m.legs?.length || (m.keys?.length ?? 0) > 1);

/**
 * Průběh motoru s úseky do skriptu: `od A pak B čas T pak C rychlost V prodleva P …` (každý úsek se svým časem / rychlostí –
 * rychlost u rotačního v ot/min), klíčové polohy `klíče 0:A 0,3:B …`; za tím okno `okno T0..T1` a fáze `fáze "Název"`.
 */
export function motorPieceWords(o: AsmOut, m: MotionMotor, phaseName?: string): string {
  const per = m.kind === "rotary" ? 6 : 1;
  let s = "";
  if (m.keys && m.keys.length > 1) s = `${w(o, "keys")} ${m.keys.map((k) => `${o.n(k.t)}:${o.n(k.v)}`).join(" ")}`;
  else {
    s = `${w(o, "from")} ${o.n(m.from)}`;
    let v = m.from;
    for (const g of m.legs ?? []) {
      if (g.to === v && g.time !== undefined) s += ` ${w(o, "dwell")} ${o.n(g.time)}`;
      else {
        s += ` ${w(o, "then")} ${o.n(g.to)}`;
        if (g.time !== undefined) s += ` ${w(o, "time")} ${o.n(g.time)}`;
        else if (g.speed !== undefined) s += ` ${w(o, m.kind === "rotary" ? "rpm" : "speed")} ${o.n(g.speed / per)}`;
      }
      v = g.to;
    }
  }
  return s + windowWords(o, m, phaseName);
}
/** okno a fáze motoru (i u motoru s jedním rozsahem) */
export function windowWords(o: AsmOut, m: MotionMotor, phaseName?: string): string {
  let s = "";
  if (m.window) s += ` ${w(o, "window")} ${m.window.t1 !== undefined ? `${o.n(m.window.t0 ?? 0)}..${o.n(m.window.t1)}` : o.n(m.window.t0 ?? 0)}`;
  if (m.phase && phaseName !== undefined) s += ` ${w(o, "phase")} ${o.q(phaseName, true)}`;
  return s;
}

/**
 * Fáze studie do skriptu (před motory – motory se na fáze odkazují názvem): `pohyb fáze "Sevření" při vazba 7 <= 0 potlačit
 * vazba 6 zapnout vazba 7 kvazistatika`. Podmínka na motor jde až za motory (`pohyb fáze N upravit při motor 1 >= 10` – vrací
 * tyto řádky volajícímu). Vazba mimo skript = poznámka.
 */
export function emitPhases(o: AsmOut, mo: MotionStudy, mateNo: Map<string, number>): string[] {
  const later: string[] = [];
  (mo.phases ?? []).forEach((ph, i) => {
    let l = `${w(o, "motion")} ${w(o, "phase")} ${o.q(ph.name, true)}`;
    const c = ph.start;
    if (c && "t" in c) l += ` ${w(o, "from")} ${o.n(c.t)} s`;
    else if (c && "mate" in c) {
      const no = mateNo.get(c.mate);
      if (no === undefined) o.note(tr("podmínka fáze „{0}“ míří na vazbu, která ve skriptu není – fáze se zapíše bez podmínky", ph.name));
      else l += ` ${w(o, "when")} ${w(o, "mate")} ${no} ${c.op} ${o.n(c.value)}`;
    } else if (c && "motor" in c) {
      const k = mo.motors.findIndex((m) => m.id === c.motor);
      if (k >= 0) later.push(`${w(o, "motion")} ${w(o, "phase")} ${i + 1} ${w(o, "edit")} ${w(o, "when")} ${w(o, "motor")} ${k + 1} ${c.op} ${o.n(c.value)}`);
    }
    const refs = (ids?: string[]) => (ids ?? []).map((id) => mateNo.get(id)).filter((n): n is number => n !== undefined);
    const en = refs(ph.enable);
    const su = refs(ph.suppress);
    if (en.length < (ph.enable?.length ?? 0) || su.length < (ph.suppress?.length ?? 0)) o.note(tr("fáze „{0}“ zapíná / potlačuje vazbu, která ve skriptu není – ve skriptu chybí", ph.name));
    if (su.length) l += ` ${w(o, "suppress")} ${su.map((n) => `${w(o, "mate")} ${n}`).join(" ")}`;
    if (en.length) l += ` ${w(o, "enable")} ${en.map((n) => `${w(o, "mate")} ${n}`).join(" ")}`;
    if (ph.mode) l += ` ${w(o, ph.mode === "quasistatic" ? "quasistatic" : ph.mode === "kinematic" ? "kinematics" : "dynamics")}`;
    o.line(l);
  });
  return later;
}
