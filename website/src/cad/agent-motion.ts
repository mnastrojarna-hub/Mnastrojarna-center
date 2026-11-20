/**
 * Pohybová studie textem (čistý parser – provedení cad/asm-agent-kin.ts):
 * - `pohyb` / `pohyb stav` – definice studie a výsledek;
 * - `pohyb motor rotační|lineární "<Komponenta>"|vazba <N|"název"> <od>..<do> | [od <A>] zdvih <Δ> | [od <A>] [krok S | kroky N] [čas T] [ot/min R | rychlost V] [kolize] [stopa "<X>" [bod x y z]]`
 *   – přidá / nahradí motor na vazbě a studii spočítá. Význam (vlna 22, cad/motor-model.ts): rozsah nebo zdvih + rychlost = rozsah ×
 *   rychlost (dojede na konec a stojí, doba = |do − od| / rychlost); jen rychlost = od začátku bez konce; `zdvih Δ` = konec o Δ od
 *   začátku; bez `od` začíná na aktuální hodnotě vazby (Vzdálenost, Drážka s polohou), jinak na 0 (posuv od výchozí polohy);
 * - `pohyb kroky N`, `pohyb čas T`, `pohyb kolize [vyp]`, `pohyb stopa "<X>" [bod x y z] | vyp`, `pohyb spustit`, `pohyb přehrát|zastavit`,
 *   `pohyb krok N`, `pohyb export csv|png|webm`, `pohyb motor smazat N`, `pohyb smazat`.
 * Česky, anglicky (motion, motor, rotary, linear, play, export) i německy (bewegung, antrieb, dreh, linear, abspielen).
 */
import { tr } from "./i18n";
import { AsmCursor, asmIsNum, asmNum, asmTokens, asmWords as W } from "./agent-asm";
import { backArg, parseDynText, type DynCmd } from "./agent-motion-dyn";
import { parsePhaseText, type PhaseCmd } from "./agent-motion-phases";
import type { MotorLeg } from "./motor-model";
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
      /** začátek nezadán → aktuální hodnota vazby (absolutní) / 0 (od výchozí polohy); `from` je pak jen výplň */
      start?: "current";
      /** relativní posun od začátku místo konce (`zdvih Δ`, EN stroke, DE hub) */
      stroke?: number;
      /** konec ani zdvih nezadán (jen rychlost, nebo výchozí zdvih +360° / +10 mm) – `to` je jen výplň */
      auto?: true;
      speed?: number;
      /** rozsah nebo zdvih SPOLU s rychlostí = rozsah × rychlost: motor dojede na konec rychlostí |speed| a stojí */
      ranged?: true;
      /** krok v jednotkách motoru (° / mm) → počet kroků */
      step?: number;
      steps?: number;
      duration?: number;
      collisions?: boolean;
      trace?: { comp: string; point?: Vec3 } | null;
      /** tam a zpět (cad/agent-motion-dyn.ts) */
      back?: boolean;
      /** chování na mezi (vlna 22, bod 8): `na mezi stop` (výchozí – motor stojí) | `na mezi chyba` (krok neplatný) */
      atLimit?: "stop" | "error";
      /** vlna 22, bod 3: mezipolohy rozsahu „57,5..40..27,15“ (hodnoty za začátkem, poslední = konec) */
      points?: number[];
      /** další úseky `pak A..B [čas T | rychlost V]`, `prodleva T` (to = NaN → drží předchozí hodnotu) */
      extra?: MotorLeg[];
      /** klíčové polohy `klíče 0:57,5 0,3:40 …` (čas od začátku motoru) */
      keys?: { t: number; v: number }[];
      /** časové okno `okno 0,2..0,6` / `od 0,2 s do 0,6 s` */
      window?: { t0?: number; t1?: number };
      /** motor začne s fází (číslo nebo název) */
      phase?: string;
      /** `navázat`: úseky se připojí za motor, který už na vazbě je (jinak ho motor nahradí – s ℹ, nikdy potichu) */
      append?: true;
    }
  /** fáze studie (vlna 22, bod 3; cad/motion-phases.ts): přidat / upravit / smazat / posunout / vypsat */
  | { op: "phase"; cmd: PhaseCmd }
  /** souhrn studie po dílech místo tuhých skupin (`pohyb detail`, `pohyb stav detail`) */
  | { op: "detail" }
  /** režim studie (vlna 22, bod 2): `pohyb kvazistatika` | `pohyb automaticky` (null); `pohyb kinematika` = dynamika vypnuta → kinematika */
  | { op: "mode"; mode: "quasistatic" | null }
  | { op: "dyn"; cmd: DynCmd }
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
  stroke: W("zdvih", "posun", "otočení", "otoceni", "pootočení", "stroke", "offset", "turn", "hub", "versatz", "weg", "drehung"),
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
  // režim studie a chování motoru na mezi (vlna 22, body 2 a 8)
  quasi: W("kvazistatika", "kvazistatiku", "kvazistatický", "kvazistaticky", "quasistatic", "quasi-static", "quasistatics", "quasistatik", "quasistatisch"),
  auto: W("automaticky", "automatický", "auto", "automatic", "automatisch"),
  at: W("na", "at", "an"),
  limit: W("mezi", "limit", "grenze"),
  stopL: W("stop", "stát", "stat", "zastavit", "stopp", "halt"),
  error: W("chyba", "neplatný", "neplatny", "error", "invalid", "fehler", "ungültig", "ungueltig"),
  // vlna 22, bod 3: úseky, klíčové polohy, okno, fáze, navázání
  then: W("pak", "potom", "then", "dann", "danach"),
  dwell: W("prodleva", "výdrž", "vydrz", "dwell", "hold", "pause", "verweilen", "haltezeit"),
  keys: W("klíče", "klice", "klíčové", "klicove", "keys", "keyframes", "schlüssel", "schluessel", "stützpunkte", "stuetzpunkte"),
  window: W("okno", "window", "fenster", "zeitfenster"),
  sec: W("s", "sec", "sek", "sekund", "seconds"),
  phase: W("fáze", "faze", "fázi", "fazi", "phase"),
  event: W("událost", "udalost", "event", "ereignis"),
  append: W("navázat", "navazat", "připojit", "pripojit", "append", "anhängen", "anhaengen"),
  detail: W("detail", "podrobně", "podrobne", "detailně", "detailne", "details", "ausführlich", "ausfuehrlich"),
};
const MULTI = /^([+-]?\d+(?:[.,]\d+)?)((?:(?:\.\.|…)[+-]?\d+(?:[.,]\d+)?){2,})(°|mm)?$/;
/** „57,5..40..27,15“ → [57,5; 40; 27,15] (aspoň tři hodnoty) */
function multiRange(c: AsmCursor): number[] | null {
  const t = c.peek();
  if (!t || t.q) return null;
  const m = MULTI.exec(t.t);
  if (!m) return null;
  c.i++;
  return [m[1], ...m[2].split(/\.\.|…/).filter(Boolean)].map(asmNum);
}
/** hodnoty úseku za „pak“: „27,15..57,5“, „40..27,15..57,5“ nebo jedno číslo (konec) – první hodnota rozsahu = začátek úseku */
function thenValues(c: AsmCursor): number[] {
  const multi = multiRange(c);
  if (multi) return multi;
  const t = c.peek();
  if (t && !t.q) {
    const m = /^([+-]?\d+(?:[.,]\d+)?)(?:\.\.|…)([+-]?\d+(?:[.,]\d+)?)(°|mm)?$/.exec(t.t);
    if (m) {
      c.i++;
      return [asmNum(m[1]), asmNum(m[2])];
    }
  }
  return [c.num(tr("pak"))];
}
/** „0:57,5“ / „0,3:40“ → klíč */
const KEY_RE = /^([+-]?\d+(?:[.,]\d+)?):([+-]?\d+(?:[.,]\d+)?)$/;
const FORMATS: Record<string, "csv" | "png" | "webm"> = { csv: "csv", tabulka: "csv", table: "csv", tabelle: "csv", png: "png", snímky: "png", snimky: "png", frames: "png", bilder: "png", webm: "webm", video: "webm", animace: "webm", animation: "webm" };

export const MOTION_USE = () =>
  tr("pohyb motor rotační|lineární \"<komponenta>\"|vazba <N> <od>..<do> | <A>..<B>..<C> | [od <A>] zdvih <Δ> | klíče t:v … [pak <B> [čas T | rychlost V]] [prodleva T] [okno T0..T1] [fáze N] [navázat] [krok S | kroky N] [čas T] [ot/min R | rychlost V] [na mezi stop|chyba] [kolize] [stopa \"<X>\" [bod x y z]] · pohyb fáze \"<název>\" [při vazba N <=|>= v | od T s] [zapnout|potlačit vazba N] [kinematika|kvazistatika] · pohyb kinematika|kvazistatika|dynamika|automaticky · pohyb stav [detail]|spustit|přehrát|zastavit|krok N|export csv|png|webm|smazat");

/** rozsah „0..360“, „0…360“, „od 0 do 360“ nebo dvě čísla „0 360“; „od 57,5“ bez konce = jen začátek (konec dá zdvih / rychlost) */
function range(c: AsmCursor): { from: number; to?: number } | null {
  const t = c.peek();
  if (!t || t.q) return null;
  const m = /^([+-]?\d+(?:[.,]\d+)?)(?:\.\.|…|-(?=\d))([+-]?\d+(?:[.,]\d+)?)(°|mm)?$/.exec(t.t);
  if (m) {
    c.i++;
    return { from: asmNum(m[1]), to: asmNum(m[2]) };
  }
  if (c.is(K.from)) {
    c.i++;
    const a = c.num(tr("od"));
    if (c.is(K.to)) {
      c.i++;
      return { from: a, to: c.num(tr("do")) };
    }
    const n = c.peek();
    return n && !n.q && asmIsNum(n.t) ? { from: a, to: c.num(tr("do")) } : { from: a };
  }
  if (asmIsNum(t.t) && asmIsNum(c.peek(1)?.t ?? "") && !c.peek(1)!.q) {
    const a = c.num(tr("od"));
    return { from: a, to: c.num(tr("do")) };
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
  if (c.is(K.detail) || (c.is(K.status) && c.is(K.detail, 1))) return { op: "detail" };
  if (c.done || c.is(K.status)) return { op: "status" };
  // režim: kvazistatika / automaticky (kinematika a dynamika – cad/agent-motion-dyn.ts)
  if (c.is(K.quasi) && c.peek(1) === undefined) return { op: "mode", mode: "quasistatic" };
  if (c.is(K.auto) && c.peek(1) === undefined) return { op: "mode", mode: null };
  // dynamika, hmotnost, síla / moment na vazbě (cad/agent-motion-dyn.ts)
  const dyn = parseDynText(c);
  if (dyn) return { op: "dyn", cmd: dyn };
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
    // rozsah (od..do | od A), zdvih Δ, rychlost – každé nejvýš jednou; co chybí, doplní provedení (cad/motor-model.ts buildMotor)
    let rng: { from: number; to?: number } | null = null;
    let r2: number[] | null = null;
    while (!c.done) {
      const r: { from: number; to?: number } | null = !rng ? range(c) : null;
      if (r) rng = r;
      else if (c.is(K.stroke)) {
        c.i++;
        out.stroke = c.num(tr("zdvih"));
      } else if (c.is(K.rpm) || c.is(K.speed)) {
        c.i++;
        out.speed = c.num(tr("rychlost"));
      } else if (!rng && !out.keys && (r2 = multiRange(c))) {
        rng = { from: r2[0], to: r2[r2.length - 1] };
        out.points = r2.slice(1);
      } else if (c.is(K.keys)) {
        // klíčové polohy: klíče 0:57,5 0,3:40 0,6:27,15 (čas od začátku motoru : hodnota)
        c.i++;
        const keys: { t: number; v: number }[] = [];
        while (!c.done && !c.peek()!.q && KEY_RE.test(c.peek()!.t)) {
          const m = KEY_RE.exec(c.next()!.t)!;
          keys.push({ t: asmNum(m[1]), v: asmNum(m[2]) });
        }
        if (keys.length < 2) throw new Error(tr("motor: klíče čas:hodnota aspoň dva – klíče 0:57,5 0,3:40 0,6:27,15"));
        out.keys = keys;
      } else if (c.is(K.then)) {
        // další úsek: pak 27,15..57,5 [čas 0,3 | rychlost 20] – začátek úseku musí navazovat na konec předchozího
        c.i++;
        const vals = thenValues(c);
        const prev = out.extra?.length ? out.extra[out.extra.length - 1].to : out.points?.length ? out.points[out.points.length - 1] : (rng?.to ?? rng?.from);
        const tos = vals.length > 1 ? vals.slice(1) : vals;
        if (vals.length > 1 && prev !== undefined && Number.isFinite(prev) && Math.abs(vals[0] - prev) > 1e-9)
          throw new Error(tr("motor: úsek „pak {0}..“ nenavazuje na konec předchozího úseku {1} – zapište pak {1}..{2}", vals[0], prev, vals[vals.length - 1]));
        const legs: MotorLeg[] = tos.map((to) => ({ to }));
        if (c.is(K.time)) {
          c.i++;
          const T = c.num(tr("čas úseku"));
          if (!(T > 0)) throw new Error(tr("motor: čas úseku musí být kladný [s]"));
          // čas platí pro celý úsek „pak …“ (víc mezipoloh: rozdělí se úměrně zdvihu)
          let v0 = prev ?? 0;
          const d = tos.map((to) => {
            const x = Math.abs(to - v0);
            v0 = to;
            return x;
          });
          const sum = d.reduce((a, b) => a + b, 0);
          legs.forEach((g, i) => (g.time = sum > 1e-12 ? (T * d[i]) / sum : T / legs.length));
        } else if (c.is(K.speed) || c.is(K.rpm)) {
          c.i++;
          const V = c.num(tr("rychlost úseku"));
          legs.forEach((g) => (g.speed = V));
        }
        (out.extra ??= []).push(...legs);
      } else if (c.is(K.dwell)) {
        c.i++;
        const T = c.num(tr("prodleva"));
        if (!(T > 0)) throw new Error(tr("motor: prodleva musí být kladná [s]"));
        if (c.is(K.sec)) c.i++;
        (out.extra ??= []).push({ to: NaN, time: T });
      } else if (c.is(K.window)) {
        // časové okno: okno 0,2..0,6 (s)
        c.i++;
        const t = c.peek();
        const m = t && !t.q ? /^([+-]?\d+(?:[.,]\d+)?)(?:\.\.|…)([+-]?\d+(?:[.,]\d+)?)s?$/.exec(t.t) : null;
        if (m) {
          c.i++;
          out.window = { t0: asmNum(m[1]), t1: asmNum(m[2]) };
        } else out.window = { t0: c.num(tr("okno")) };
        if (c.is(K.sec)) c.i++;
      } else if (rng && c.is(K.from) && asmIsNum(c.peek(1)?.t ?? "") && c.is(K.sec, 2)) {
        // časové okno slovy: od 0,2 s [do 0,6 s]
        c.i++;
        const t0 = c.num(tr("od"));
        c.i++;
        out.window = { t0 };
        if (c.is(K.to)) {
          c.i++;
          out.window.t1 = c.num(tr("do"));
          if (c.is(K.sec)) c.i++;
        }
      } else if (c.is(K.phase)) {
        c.i++;
        out.phase = c.str(tr("fáze"));
      } else if (c.is(K.append)) {
        c.i++;
        out.append = true;
      } else if (backArg(c)) out.back = true;
      else if (c.is(K.at) && c.is(K.limit, 1)) {
        // na mezi stop | chyba (EN at limit stop | error, DE an grenze stopp | fehler)
        c.i += 2;
        if (c.is(K.stopL)) out.atLimit = "stop";
        else if (c.is(K.error)) out.atLimit = "error";
        else throw new Error(tr("motor: na mezi stop | chyba – stop = motor stojí na poslední dosažitelné hodnotě, chyba = kroky za mezí jsou neplatné"));
        c.i++;
      } else if (!studyOpt(c, out)) throw new Error(tr("pohyb motor: neznámá volba „{0}“ – {1}", c.peek()!.t, MOTION_USE()));
    }
    if (rng) out.from = rng.from;
    else out.start = "current";
    if (rng?.to !== undefined) out.to = rng.to;
    if (out.stroke !== undefined && rng?.to !== undefined) throw new Error(tr("motor: zadejte konec (od..do), nebo zdvih – ne obojí"));
    if (out.stroke === 0) throw new Error(tr("motor: zdvih je nulový"));
    if (rng?.to !== undefined && out.from === out.to) throw new Error(tr("motor: rozsah od–do je nulový – např. 0..360 (jen rychlost od hodnoty: od 5 rychlost 3)"));
    if (out.speed === 0) throw new Error(tr("motor: rychlost musí být nenulová"));
    if (out.window && (!(out.window.t0! >= 0) || (out.window.t1 !== undefined && !(out.window.t1 > out.window.t0!))))
      throw new Error(tr("motor: časové okno od–do [s] musí začít v čase ≥ 0 a skončit později – okno 0,2..0,6"));
    if (out.keys && (rng || out.extra?.length || out.stroke !== undefined)) throw new Error(tr("motor: klíče čas:hodnota zadávají celý průběh – bez rozsahu, zdvihu a pak"));
    if (out.keys) {
      out.from = out.keys[0].v;
      out.to = out.keys[out.keys.length - 1].v;
      delete out.start;
      return out;
    }
    if (out.window && out.speed !== undefined && !rng?.to && out.stroke === undefined) throw new Error(tr("motor: časové okno potřebuje rozsah nebo zdvih – okno 0,2..0,6 s rychlostí bez konce nejde"));
    const hasEnd = rng?.to !== undefined || out.stroke !== undefined;
    if (!hasEnd) out.auto = true;
    // rozsah / zdvih + rychlost = rozsah × rychlost (dojede na konec a stojí) – dřív se konec potichu zahodil (bod 9 zprávy)
    if (hasEnd && out.speed !== undefined && !out.points && !out.extra) out.ranged = true;
    if (out.points || out.extra) {
      if (!hasEnd && !(rng && out.extra?.some((g) => Number.isFinite(g.to)))) throw new Error(tr("motor: úseky „pak“ / „prodleva“ navazují na rozsah – zadejte nejdřív konec prvního úseku (57,5..27,15 pak 57,5) nebo začátek (od 57,5 pak 27,15 čas 0,4)"));
      if (out.back) throw new Error(tr("motor: „tam a zpět“ nejde spojit s úseky – návrat zapište jako další úsek: … pak <začátek>"));
    }
    return out;
  }
  if (c.is(K.phase)) {
    c.i++;
    return { op: "phase", cmd: parsePhaseText(c) };
  }
  // událost = fáze bez vlastního názvu („pohyb událost při vazba "ZDVIH" <= 30 zapnout vazba 2“) – název doplní provedení
  if (c.is(K.event)) {
    c.i++;
    return { op: "phase", cmd: parsePhaseText(c, { event: true }) };
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
