/**
 * Pohybová studie textem (čistý parser – provedení cad/asm-agent-kin.ts):
 * - `pohyb` / `pohyb stav` – definice studie a výsledek;
 * - `pohyb motor rotační|lineární "<Komponenta>"|vazba <N|"název"> <od>..<do> [krok S | kroky N] [čas T] [ot/min R | rychlost V] [kolize] [stopa "<X>" [bod x y z]]`
 *   – přidá / nahradí motor na vazbě a studii spočítá;
 * - `pohyb kroky N`, `pohyb čas T`, `pohyb kolize [vyp]`, `pohyb stopa "<X>" [bod x y z] | vyp`, `pohyb spustit`, `pohyb přehrát|zastavit`,
 *   `pohyb krok N`, `pohyb export csv|png|webm`, `pohyb motor smazat N`, `pohyb smazat`.
 * Česky, anglicky (motion, motor, rotary, linear, play, export) i německy (bewegung, antrieb, dreh, linear, abspielen).
 */
import { tr } from "./i18n";
import { AsmCursor, asmIsNum, asmNum, asmTokens, asmWords as W } from "./agent-asm";
import type { Vec3 } from "./types";

export type MotionCmd =
  | { op: "status" }
  | {
      op: "motor";
      kind: "rotary" | "linear";
      /** komponenta (motor na její vazbě Souosost / Závěs …) nebo vazba číslem / názvem */
      comp?: string;
      mate?: string;
      from: number;
      to: number;
      speed?: number;
      /** krok v jednotkách motoru (° / mm) → počet kroků */
      step?: number;
      steps?: number;
      duration?: number;
      collisions?: boolean;
      trace?: { comp: string; point?: Vec3 } | null;
    }
  | { op: "set"; steps?: number; step?: number; duration?: number; collisions?: boolean; trace?: { comp: string; point?: Vec3 } | null }
  | { op: "run" }
  | { op: "play"; loop?: boolean }
  | { op: "stop" }
  | { op: "step"; n: number }
  | { op: "export"; format: "csv" | "png" | "webm" }
  | { op: "removeMotor"; n: number }
  | { op: "clear" };

const K = {
  status: W("stav", "status", "zustand", "info"),
  motor: W("motor", "pohon", "antrieb", "drive"),
  rotary: W("rotační", "rotacni", "otočný", "rotary", "rotation", "rotational", "dreh", "rotativ", "drehantrieb"),
  linear: W("lineární", "posuvný", "linear", "linearantrieb", "translatorisch"),
  mate: W("vazba", "vazbě", "mate", "constraint", "verknüpfung", "verknuepfung", "bedingung"),
  step: W("krok", "step", "schritt"),
  steps: W("kroky", "kroků", "steps", "schritte", "počet"),
  time: W("čas", "doba", "time", "duration", "dauer", "zeit"),
  rpm: W("ot/min", "otáček", "otacek", "rpm", "u/min", "umdrehungen"),
  speed: W("rychlost", "speed", "velocity", "geschwindigkeit", "mm/s"),
  from: W("od", "from", "von"),
  to: W("do", "to", "bis"),
  clash: W("kolize", "kolizí", "collisions", "collision", "interference", "kollision", "kollisionen"),
  off: W("vyp", "vypnout", "ne", "off", "no", "aus"),
  on: W("zap", "zapnout", "ano", "on", "yes", "ein"),
  trace: W("stopa", "trajektorie", "trace", "path-trace", "spur", "bahnkurve"),
  point: W("bod", "point", "punkt"),
  run: W("spustit", "vypočítat", "spočítat", "run", "compute", "calculate", "start", "berechnen", "starten"),
  play: W("přehrát", "prehrat", "přehrávat", "play", "animate", "abspielen", "animieren"),
  loop: W("smyčka", "dokola", "loop", "schleife"),
  stop: W("zastavit", "stop", "pause", "pauza", "anhalten"),
  export: W("export", "exportovat", "uložit", "exportieren"),
  del: W("smazat", "zrušit", "odstranit", "delete", "remove", "clear", "löschen", "loeschen", "entfernen"),
};
const FORMATS: Record<string, "csv" | "png" | "webm"> = { csv: "csv", tabulka: "csv", table: "csv", tabelle: "csv", png: "png", snímky: "png", snimky: "png", frames: "png", bilder: "png", webm: "webm", video: "webm", animace: "webm", animation: "webm" };

export const MOTION_USE = () =>
  tr("pohyb motor rotační|lineární \"<komponenta>\"|vazba <N> <od>..<do> [krok S | kroky N] [čas T] [ot/min R | rychlost V] [kolize] [stopa \"<X>\" [bod x y z]] · pohyb stav|spustit|přehrát|zastavit|krok N|export csv|png|webm|smazat");

/** rozsah „0..360“, „0…360“, „od 0 do 360“ nebo dvě čísla „0 360“ */
function range(c: AsmCursor): [number, number] | null {
  const t = c.peek();
  if (!t || t.q) return null;
  const m = /^([+-]?\d+(?:[.,]\d+)?)(?:\.\.|…|-(?=\d))([+-]?\d+(?:[.,]\d+)?)(°|mm)?$/.exec(t.t);
  if (m) {
    c.i++;
    return [asmNum(m[1]), asmNum(m[2])];
  }
  if (c.is(K.from)) {
    c.i++;
    const a = c.num(tr("od"));
    if (c.is(K.to)) c.i++;
    return [a, c.num(tr("do"))];
  }
  if (asmIsNum(t.t) && asmIsNum(c.peek(1)?.t ?? "") && !c.peek(1)!.q) {
    const a = c.num(tr("od"));
    return [a, c.num(tr("do"))];
  }
  return null;
}

/** stopa: „stopa "Ojnice" [bod x y z]“ nebo „stopa vyp“ */
function traceArg(c: AsmCursor): { comp: string; point?: Vec3 } | null {
  if (c.is(K.off)) {
    c.i++;
    return null;
  }
  const t = c.next();
  if (!t) throw new Error(tr("stopa: zadejte komponentu – stopa \"Ojnice\" [bod x y z] (bod v souřadnicích komponenty)"));
  const out: { comp: string; point?: Vec3 } = { comp: t.t.trim() };
  if (c.is(K.point)) {
    c.i++;
    out.point = c.vec(tr("bod"));
  }
  return out;
}

/** společné volby studie (kroky, čas, kolize, stopa) – vrací false u neznámého slova */
function studyOpt(c: AsmCursor, o: { steps?: number; step?: number; duration?: number; collisions?: boolean; trace?: { comp: string; point?: Vec3 } | null }): boolean {
  if (c.is(K.steps)) {
    c.i++;
    o.steps = Math.round(c.num(tr("kroky")));
    if (!(o.steps >= 1 && o.steps <= 2000)) throw new Error(tr("počet kroků: 1 až 2000"));
  } else if (c.is(K.step)) {
    c.i++;
    o.step = c.num(tr("krok"));
    if (!(o.step > 0)) throw new Error(tr("krok musí být kladný"));
  } else if (c.is(K.time)) {
    c.i++;
    o.duration = c.num(tr("čas"));
    if (!(o.duration > 0)) throw new Error(tr("čas studie musí být kladný [s]"));
  } else if (c.is(K.clash)) {
    c.i++;
    o.collisions = true;
    if (c.is(K.off)) {
      c.i++;
      o.collisions = false;
    } else if (c.is(K.on)) c.i++;
  } else if (c.is(K.trace)) {
    c.i++;
    o.trace = traceArg(c);
  } else return false;
  return true;
}

/** Rozbor řádku „pohyb …“ (včetně prvního slova). */
export function parseMotionText(line: string): MotionCmd {
  const c = new AsmCursor(asmTokens(line).slice(1));
  if (c.done || c.is(K.status)) return { op: "status" };
  if (c.is(K.motor)) {
    c.i++;
    if (c.is(K.del)) {
      c.i++;
      return { op: "removeMotor", n: Math.round(c.num(tr("číslo motoru"))) };
    }
    let kind: "rotary" | "linear" = "rotary";
    if (c.is(K.rotary)) c.i++;
    else if (c.is(K.linear)) {
      kind = "linear";
      c.i++;
    }
    const out: Extract<MotionCmd, { op: "motor" }> = { op: "motor", kind, from: 0, to: kind === "rotary" ? 360 : 10 };
    if (c.is(K.mate)) {
      c.i++;
      const t = c.next();
      if (!t) throw new Error(tr("motor: vazba číslem nebo názvem – pohyb motor rotační vazba 3 0..360"));
      out.mate = t.t.replace(/^#/, "").trim();
    } else {
      const t = c.next();
      if (!t) throw new Error(tr("motor: chybí komponenta nebo vazba – {0}", MOTION_USE()));
      out.comp = t.t.trim();
    }
    let ranged = false;
    while (!c.done) {
      const r = !ranged ? range(c) : null;
      if (r) {
        [out.from, out.to] = r;
        ranged = true;
      } else if (c.is(K.rpm) || c.is(K.speed)) {
        c.i++;
        out.speed = c.num(tr("rychlost"));
      } else if (!studyOpt(c, out)) throw new Error(tr("pohyb motor: neznámá volba „{0}“ – {1}", c.peek()!.t, MOTION_USE()));
    }
    if (out.speed === undefined && out.from === out.to) throw new Error(tr("motor: rozsah od–do je nulový – např. 0..360"));
    return out;
  }
  if (c.is(K.run)) return { op: "run" };
  if (c.is(K.play)) {
    c.i++;
    return { op: "play", ...(c.is(K.loop) ? { loop: true } : {}) };
  }
  if (c.is(K.stop)) return { op: "stop" };
  if (c.is(K.export)) {
    c.i++;
    const f = FORMATS[c.word()];
    if (!f) throw new Error(tr("pohyb export: csv | png | webm"));
    return { op: "export", format: f };
  }
  if (c.is(K.del)) return { op: "clear" };
  if (c.is(K.step) && asmIsNum(c.peek(1)?.t ?? "")) {
    c.i++;
    return { op: "step", n: Math.round(c.num(tr("krok"))) };
  }
  const o: Extract<MotionCmd, { op: "set" }> = { op: "set" };
  while (!c.done) if (!studyOpt(c, o)) throw new Error(tr("pohyb: neznámý podpříkaz „{0}“ – {1}", c.peek()!.t, MOTION_USE()));
  return o;
}
