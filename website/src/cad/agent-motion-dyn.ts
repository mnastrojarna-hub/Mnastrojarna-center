/**
 * Dynamika pohybové studie textem (čistý parser – provedení cad/asm-agent-dyn.ts, výpočet cad/motion-dynamic.ts):
 * - `pohyb dynamika [čas T] [krok dt] [gravitace -Z|+Y|vyp] [tlumení c] [odraz e] [snímky N]` – zapne dynamiku a spočítá ji,
 * - `pohyb kinematika` – zpět na kinematickou studii (nastavení dynamiky zůstává),
 * - `pohyb hmotnost "<komponenta>" <kg>|auto` – ruční hmotnost (auto = z objemu × hustoty),
 * - `pohyb síla vazba <N|"název"> <N>|smazat`, `pohyb moment vazba <N> <N·m>|smazat` – síla / moment na vazbě,
 * - u motoru `tam a zpět` (od → do → od sinusově).
 * Česky, anglicky (dynamics, kinematics, mass, force, torque, gravity, damping, restitution, there and back) i německy
 * (dynamik, kinematik, masse, kraft, moment, schwerkraft, dämpfung, stoß, hin und zurück).
 */
import { AsmCursor, asmIsNum, asmWords as W } from "./agent-asm";
import { tr } from "./i18n";
import type { Vec3 } from "./types";

export type DynCmd =
  | { k: "on"; duration?: number; dt?: number; gravity?: Vec3 | null; damping?: number; restitution?: number; frames?: number }
  | { k: "off" }
  | { k: "mass"; comp: string; kg: number | null }
  | { k: "load"; kind: "force" | "torque"; mate: string; value: number | null };

const K = {
  dyn: W("dynamika", "dynamiku", "dynamický", "dynamicka", "dynamics", "dynamic", "dynamik", "dynamisch"),
  kin: W("kinematika", "kinematiku", "kinematics", "kinematic", "kinematik", "kinematisch"),
  mass: W("hmotnost", "hmota", "mass", "masse", "gewicht"),
  force: W("síla", "sila", "force", "kraft"),
  torque: W("moment", "torque", "drehmoment"),
  mate: W("vazba", "vazbě", "vazbu", "mate", "constraint", "verknüpfung", "verknuepfung", "bedingung"),
  time: W("čas", "doba", "time", "duration", "dauer", "zeit"),
  step: W("krok", "step", "schritt", "dt"),
  gravity: W("gravitace", "tíže", "tize", "gravity", "schwerkraft", "gravitation"),
  damping: W("tlumení", "tlumeni", "tlumič", "damping", "dämpfung", "daempfung"),
  rest: W("odraz", "restituce", "restitution", "bounce", "stoß", "stoss", "stoßzahl", "stosszahl"),
  frames: W("snímky", "snimky", "snímků", "frames", "bilder"),
  off: W("vyp", "vypnout", "ne", "off", "no", "none", "aus", "keine"),
  auto: W("auto", "automaticky", "objem", "volume", "automatisch"),
  del: W("smazat", "zrušit", "odebrat", "delete", "remove", "clear", "löschen", "loeschen", "entfernen"),
  back: W("tam", "zpět", "zpet", "tam-a-zpět", "back", "there", "there-and-back", "and-back", "hin", "zurück", "zurueck", "hin-und-zurück"),
  and: W("a", "and", "und"),
};

export const DYN_USE = () =>
  tr("pohyb dynamika [čas T] [krok dt] [gravitace -Z|vyp] [tlumení c] [odraz e] · pohyb kinematika · pohyb hmotnost \"<komponenta>\" <kg>|auto · pohyb síla vazba <N> <N>|smazat · pohyb moment vazba <N> <N·m>|smazat");

/** směr gravitace: „-Z“, „+y“, „z“, „−Z“, tři čísla, nebo vyp */
function gravityArg(c: AsmCursor): Vec3 | null {
  if (c.is(K.off)) {
    c.i++;
    return null;
  }
  const w = (c.peek()?.t ?? "").replace("−", "-").trim().toLowerCase();
  const m = /^([+-]?)([xyz])$/.exec(w);
  if (m) {
    c.i++;
    const v: Vec3 = [0, 0, 0];
    v["xyz".indexOf(m[2])] = m[1] === "-" ? -1 : 1;
    return v;
  }
  if (asmIsNum(c.peek()?.t ?? "")) return c.vec(tr("gravitace"));
  throw new Error(tr("gravitace: směr -Z / +Y / X…, tři čísla, nebo vyp"));
}

/** `tam a zpět` za rozsahem motoru (true = slovo spotřebováno) */
export function backArg(c: AsmCursor): boolean {
  if (!c.is(K.back)) return false;
  // „tam a zpět“, „there and back“, „hin und zurück“, „back“, „zpět“
  while (!c.done && (c.is(K.back) || (c.is(K.and) && c.is(K.back, 1)))) c.i++;
  return true;
}

/** Rozbor podpříkazu dynamiky za slovem „pohyb“ (null = není to příkaz dynamiky). */
export function parseDynText(c: AsmCursor): DynCmd | null {
  if (c.is(K.kin) && c.peek(1) === undefined) return { k: "off" };
  if (c.is(K.dyn)) {
    c.i++;
    if (c.is(K.off)) return { k: "off" };
    const o: Extract<DynCmd, { k: "on" }> = { k: "on" };
    while (!c.done) {
      if (c.is(K.time)) {
        c.i++;
        o.duration = c.num(tr("čas"));
        if (!(o.duration > 0 && o.duration <= 600)) throw new Error(tr("čas dynamické studie: 0 až 600 s"));
      } else if (c.is(K.step)) {
        c.i++;
        o.dt = c.num(tr("krok"));
        if (!(o.dt >= 1e-6 && o.dt <= 0.05)) throw new Error(tr("integrační krok: 0,000001 až 0,05 s (např. krok 0,0005)"));
      } else if (c.is(K.gravity)) {
        c.i++;
        o.gravity = gravityArg(c);
      } else if (c.is(K.damping)) {
        c.i++;
        o.damping = c.num(tr("tlumení"));
        if (!(o.damping >= 0)) throw new Error(tr("tlumení musí být ≥ 0 [N·s/mm]"));
      } else if (c.is(K.rest)) {
        c.i++;
        o.restitution = c.num(tr("odraz"));
        if (!(o.restitution >= 0 && o.restitution <= 1)) throw new Error(tr("odraz: součinitel 0 (bez odrazu) až 1 (pružný odraz)"));
      } else if (c.is(K.frames)) {
        c.i++;
        o.frames = Math.round(c.num(tr("snímky")));
        if (!(o.frames >= 10 && o.frames <= 5000)) throw new Error(tr("snímky: 10 až 5000"));
      } else throw new Error(tr("pohyb dynamika: neznámá volba „{0}“ – {1}", c.peek()!.t, DYN_USE()));
    }
    return o;
  }
  if (c.is(K.mass)) {
    c.i++;
    const t = c.next();
    if (!t || !t.t.trim()) throw new Error(tr("hmotnost: zadejte komponentu a kg – pohyb hmotnost \"Stírací deska\" 2,4"));
    if (c.is(K.auto) || c.is(K.del)) {
      c.i++;
      return { k: "mass", comp: t.t.trim(), kg: null };
    }
    const kg = c.num(tr("hmotnost"));
    if (!(kg > 0)) throw new Error(tr("hmotnost musí být kladná [kg]"));
    return { k: "mass", comp: t.t.trim(), kg };
  }
  if (c.is(K.force) || c.is(K.torque)) {
    const kind = c.is(K.force) ? "force" : "torque";
    c.i++;
    if (c.is(K.mate)) c.i++;
    const t = c.next();
    if (!t || !t.t.trim()) throw new Error(tr("{0}: zadejte vazbu číslem nebo názvem – pohyb síla vazba 3 120", kind === "force" ? tr("síla") : tr("moment")));
    const mate = t.t.replace(/^#/, "").trim();
    if (c.is(K.del) || c.is(K.off)) {
      c.i++;
      return { k: "load", kind, mate, value: null };
    }
    return { k: "load", kind, mate, value: c.num(kind === "force" ? tr("síla [N]") : tr("moment [N·m]")) };
  }
  return null;
}
