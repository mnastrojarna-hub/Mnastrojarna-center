/**
 * Model motoru pohybové studie (vlna 22, body 9 a 11 zprávy; připraveno pro body 8 a 3): JEDINÉ místo, které z uloženého motoru
 * (`MotionMotor`) dělá průběh hodnoty v čase. Kinematika (cad/motion.ts `motorValue`), dynamika (cad/motion-dynamic.ts `motorAt`),
 * protokol (`motorText`), panel studie i textové příkazy čtou tentýž profil:
 *
 *   klíčové body (čas, hodnota) → úseky mezi nimi (lineárně / sinusově) → chování za posledním bodem (stojí / jede dál rychlostí)
 *
 * | zadání | úseky (`MotorLeg`: kam + za jak dlouho NEBO jak rychle) | klíče | za posledním klíčem |
 * |---|---|---|---|
 * | rozsah `od..do` | do za D | 0: od · D: do (lineárně) | stojí |
 * | `tam a zpět` | do za D/2 · od za D/2 (sinusově) | 0: od · D/2: do · D: od | stojí |
 * | jen rychlost (bez konce) | – | 0: od | jede dál rychlostí (ot/min → °/s) |
 * | **rozsah × rychlost** (`ranged`) | do rychlostí |v| | 0: od · T: do, T = |do − od| / |rychlost| | **stojí na `do`** |
 * | začátek + zdvih | ukládá se jako od / do = od + Δ → řádky výše | | |
 *
 * D = délka studie. Rozšíření dalších etap bez přepisu (plán etapy 1 balíku M, oddíl 1):
 * * **chování na mezi vazby** (bod 8, etapa M2) = vlastnost profilu `atLimit`: profil dává POŽADOVANOU hodnotu v čase, řešič podle
 *   `atLimit` při zablokovaném kroku buď drží poslední dosažitelnou hodnotu („stop“ – motor stojí na mezi), nebo dál žádá
 *   požadovanou („continue“ – dnešní chování: kompromis řešiče a ⚠ motion.conflict). M2 doplní `MotionMotor.atLimit` a čtení v řešiči;
 * * **klíčové polohy a navazující úseky** (bod 3, etapa M3) = `MotionMotor.keys` (hotové klíče) nebo úseky `MotorLeg[]`
 *   („57,5..40 rychlost 10 pak 40..27,15 čas 0,5 pak prodleva 0,2“) → `legKeys` → `profileOf`; vyhodnocení `profileAt`, zdvih a směr
 *   `motorSpan` už s libovolným počtem klíčů počítají.
 *
 * Význam hodnot (bod 11): u vazby Vzdálenost a Drážky s polohou je hodnota motoru **hodnota vazby** (absolutní mezera / poloha),
 * u Souososti, Dráhy, Šroubu, Drážky bez polohy a u všech rotačních motorů **posuv / natočení od výchozí polohy** (0 = beze změny).
 * Čisté funkce bez jádra; texty přes `tr()`.
 */
import { getLang, tr } from "./i18n";
import type { Mate, MotionLeg, MotionMotor, MotionStudy } from "./types";

/** klíčový bod motoru: čas [s] a hodnota (mm / °); `ease` = průběh úseku, který v tomto bodě KONČÍ */
export type MotorKey = { t: number; v: number; ease?: "linear" | "sine" };
/**
 * úsek zadání: kam (hodnota) a buď za jak dlouho (`time` [s]), nebo jak rychle (`speed` – velikost v jednotkách hodnoty za sekundu,
 * mm/s | °/s); úsek se stejnou hodnotou a časem = prodleva. Uložený tvar `MotionMotor.legs` (vlna 22, bod 3).
 */
export type MotorLeg = MotionLeg;
/** úsek profilu mezi dvěma klíči; `rate` = střední rychlost úseku [mm/s | °/s] se znaménkem směru */
export type MotorSegment = { t0: number; t1: number; v0: number; v1: number; ease: "linear" | "sine"; rate: number };
export type MotorProfile = {
  keys: MotorKey[];
  segments: MotorSegment[];
  /** za posledním klíčem: stojí na jeho hodnotě, nebo jede dál rychlostí `speed` (ot/min u rotačního, mm/s u lineárního) */
  after: { mode: "hold" } | { mode: "run"; speed: number; rotary: boolean };
  /**
   * chování, když požadované hodnotě brání mez vazby / doraz: „continue“ = řešič dál žádá požadovanou hodnotu (dnešní chování –
   * kompromis poloh a ⚠ motion.conflict), „stop“ = motor stojí na poslední dosažitelné hodnotě. Etapa 1 balíku M vždy „continue“; „stop“
   * a jeho čtení v řešiči doplní M2 (bod 8) z `MotionMotor.atLimit` – profil je na to připravený, vyhodnocení se nemění.
   */
  atLimit: "continue" | "stop";
  /** délka studie [s], pro kterou profil vznikl */
  duration: number;
  /** tam a zpět přes celou studii (vyhodnocuje se uzavřeným vzorcem – bitově stejně jako před zavedením klíčů) */
  back?: { from: number; to: number };
};

/** rychlost motoru v jednotkách hodnoty za sekundu: ot/min → °/s, mm/s beze změny */
export const motorRate = (mo: Pick<MotionMotor, "kind" | "speed">): number => (mo.kind === "rotary" ? (mo.speed ?? 0) * 6 : (mo.speed ?? 0));
const hasSpeed = (mo: MotionMotor) => mo.speed !== undefined && Number.isFinite(mo.speed);
/** rozsah × rychlost: motor dojede z `from` na `to` rychlostí |speed| a stojí */
export const isRanged = (mo: MotionMotor): boolean => !!mo.ranged && hasSpeed(mo) && mo.speed !== 0 && mo.to !== mo.from;
/** výchozí délka pohybové studie [s] (cad/motion.ts `defaultStudy`) – změnu jiné než výchozí délky motor ohlásí */
export const DEFAULT_STUDY_DURATION = 2;
/**
 * Uložený konec, který se nepoužívá: motor s rychlostí BEZ `ranged` (dokument ze starší verze, nebo dřívější „Rychlost místo
 * rozsahu“ v panelu) jede od začátku rychlostí bez konce a `to` vedle rychlosti se nikdy nepoužilo. Výchozí konec starého
 * zadání bez rozsahu (±10 mm / ±360°) se nepočítá. Jediné pravidlo pro protokol (`motorRangeText`), upozornění (`motorNotes`,
 * ⚠ `motion.end-unused`), načtení dokumentu (engine/verify.ts) i převod do skriptu (doc-script.ts). null = nic nepoužitého.
 */
export const unusedEnd = (mo: MotionMotor): number | null => (hasSpeed(mo) && !isRanged(mo) && mo.to !== mo.from && Math.abs(mo.to) !== (mo.kind === "rotary" ? 360 : 10) ? mo.to : null);

/**
 * Klíče z úseků zadání: začátek + úseky „kam za jak dlouho / jak rychle“ → (čas, hodnota). Úsek s rychlostí trvá |Δ| / rychlost,
 * úsek bez času i rychlosti je skok (nulová délka).
 */
export function legKeys(start: number, legs: MotorLeg[]): MotorKey[] {
  const keys: MotorKey[] = [{ t: 0, v: start }];
  let t = 0;
  let v = start;
  for (const g of legs) {
    const dt = g.time !== undefined ? g.time : g.speed ? Math.abs(g.to - v) / Math.abs(g.speed) : 0;
    t += Math.max(0, dt);
    v = g.to;
    keys.push({ t, v, ...(g.ease && g.ease !== "linear" ? { ease: g.ease } : {}) });
  }
  return keys;
}

/** Profil z klíčových bodů (seřazené podle času, první v t = 0); úseky nulové délky se vynechají. */
export function profileOf(keys: MotorKey[], after: MotorProfile["after"], duration: number, atLimit: MotorProfile["atLimit"] = "continue"): MotorProfile {
  const k = [...keys].sort((a, b) => a.t - b.t);
  const segments: MotorSegment[] = [];
  for (let i = 1; i < k.length; i++)
    if (k[i].t > k[i - 1].t) segments.push({ t0: k[i - 1].t, t1: k[i].t, v0: k[i - 1].v, v1: k[i].v, ease: k[i].ease ?? "linear", rate: (k[i].v - k[i - 1].v) / (k[i].t - k[i - 1].t) });
  return { keys: k, segments, after, atLimit, duration };
}

/** víc úseků nebo klíčových poloh (vlna 22, bod 3) – průběh není jeden rozsah */
export const isPiecewise = (mo: Pick<MotionMotor, "legs" | "keys">): boolean => !!(mo.legs?.length || (mo.keys?.length ?? 0) > 1);
/**
 * Začátek motoru [s] ve studii (vlna 22, bod 3): fáze (`phaseStart` – čas, kdy fáze začala; zná ho až výpočet), jinak časové okno
 * `window.t0`, jinak 0. Před začátkem motor nepohání (vazbu drží motor, který začal dřív, nebo nic).
 */
export const motorStartTime = (mo: Pick<MotionMotor, "window">, phaseStart?: number): number => Math.max(0, phaseStart ?? mo.window?.t0 ?? 0);

/**
 * Úseky bez času i rychlosti vyplní dobu `span` [s] (okno nebo zbytek studie) – úměrně zdvihu, tedy stejnou rychlostí (prodlevy bez
 * času dostanou podíl jako průměrný úsek); úseky s časem / rychlostí se nemění. Rychlost v jednotkách hodnoty za sekundu.
 */
export function fillLegs(start: number, legs: MotorLeg[], span: number): MotorLeg[] {
  let v = start;
  let fixed = 0;
  const free: { i: number; d: number }[] = [];
  legs.forEach((g, i) => {
    if (g.time !== undefined) fixed += g.time;
    else if (g.speed) fixed += Math.abs(g.to - v) / Math.abs(g.speed);
    else free.push({ i, d: Math.abs(g.to - v) });
    v = g.to;
  });
  if (!free.length) return legs;
  const rest = Math.max(0, span - fixed);
  const sum = free.reduce((s, x) => s + x.d, 0);
  const out = legs.map((g) => ({ ...g }));
  for (const x of free) out[x.i].time = sum > 1e-12 ? (rest * x.d) / sum : rest / free.length;
  return out;
}

/** profil posunutý o `t0` [s]: do `t0` drží první hodnotu, pak průběh */
function shifted(p: MotorProfile, t0: number): MotorProfile {
  if (!(t0 > 0)) return p;
  const keys = [{ t: 0, v: p.keys[0].v }, ...p.keys.map((k) => ({ ...k, t: k.t + t0 }))];
  return profileOf(keys, p.after, p.duration, p.atLimit);
}

/**
 * Profil motoru pro studii délky `duration` [s] – viz tabulka v hlavičce modulu. `start` = začátek motoru [s] (časové okno, fáze –
 * `motorStartTime`); s oknem `window.t1` vyplní rozsah / úseky bez času dobu okna, jinak zbytek studie.
 */
export function motorKeys(mo: MotionMotor, duration: number, start = motorStartTime(mo)): MotorProfile {
  const D = duration > 0 ? duration : 1;
  const hold = { mode: "hold" } as const;
  const t0 = Math.max(0, start);
  const t1 = mo.window?.t1 !== undefined ? Math.max(t0, mo.window.t1) : D;
  // celá studie bez okna a bez úseků: dřívější tvary beze změny (bitově stejné hodnoty)
  const whole = t0 === 0 && mo.window?.t1 === undefined;
  const span = whole ? D : Math.max(1e-9, t1 - t0);
  let p: MotorProfile;
  if (mo.keys && mo.keys.length > 1) p = profileOf(mo.keys.map((k) => ({ t: k.t, v: k.v })), hold, D);
  else if (mo.legs?.length) p = profileOf(legKeys(mo.from, fillLegs(mo.from, mo.legs, span)), hold, D);
  else if (hasSpeed(mo)) {
    if (isRanged(mo)) p = profileOf(legKeys(mo.from, [{ to: mo.to, speed: motorRate(mo) }]), hold, D);
    else p = profileOf(legKeys(mo.from, []), { mode: "run", speed: mo.speed!, rotary: mo.kind === "rotary" }, D);
  } else if (mo.back) {
    const legs: MotorLeg[] = [{ to: mo.to, time: span / 2, ease: "sine" }, { to: mo.from, time: span / 2, ease: "sine" }];
    p = whole ? { ...profileOf(legKeys(mo.from, legs), hold, D), back: { from: mo.from, to: mo.to } } : profileOf(legKeys(mo.from, legs), hold, D);
  } else p = profileOf(legKeys(mo.from, [{ to: mo.to, time: span }]), hold, D);
  return shifted(p, t0);
}

/**
 * Hodnota profilu v čase `t` [s]. `frac` = krok `k` z `n` kinematické studie (t = D·k/n): úsek přes celou studii se pak počítá
 * z `k / n` stejným výrazem jako dřív (`od + ((do − od)·k) / n`), takže dosavadní studie dávají bitově stejná čísla.
 */
export function profileAt(p: MotorProfile, t: number, frac?: { k: number; n: number }): number {
  if (p.back) {
    const { from, to } = p.back;
    if (frac) return from + ((to - from) * (1 - Math.cos((2 * Math.PI * frac.k) / Math.max(1, frac.n)))) / 2;
    const s = p.duration > 0 ? Math.min(1, Math.max(0, t / p.duration)) : 0;
    return from + ((to - from) * (1 - Math.cos(2 * Math.PI * s))) / 2;
  }
  const last = p.keys[p.keys.length - 1];
  if (!p.segments.length) {
    if (p.after.mode === "hold") return last.v;
    const dt = t - last.t;
    return last.v + (p.after.rotary ? (p.after.speed * 360 * dt) / 60 : p.after.speed * dt);
  }
  const lin = (g: MotorSegment, s: number) => g.v0 + (g.v1 - g.v0) * s;
  const one = p.segments.length === 1 ? p.segments[0] : null;
  // jediný lineární úsek přes celou studii a krok k z n: dřívější výraz kinematiky (bitově stejná čísla jako před zavedením klíčů)
  if (frac && one && one.ease === "linear" && one.t0 === 0 && one.t1 === p.duration) return one.v0 + (frac.n > 0 ? ((one.v1 - one.v0) * frac.k) / frac.n : 0);
  if (t > last.t) {
    const g = p.segments[p.segments.length - 1];
    // stojí na konci posledního úseku (stejný výraz jako úsek v s = 1 – na přechodu žádný skok ani o poslední bit)
    if (p.after.mode === "hold") return g.ease === "sine" ? g.v0 + ((g.v1 - g.v0) * (1 - Math.cos(Math.PI))) / 2 : lin(g, 1);
    const dt = t - last.t;
    return last.v + (p.after.rotary ? (p.after.speed * 360 * dt) / 60 : p.after.speed * dt);
  }
  const seg = p.segments.find((g) => t <= g.t1) ?? p.segments[p.segments.length - 1];
  if (t <= seg.t0) return seg.v0;
  const s = Math.min(1, Math.max(0, (t - seg.t0) / (seg.t1 - seg.t0)));
  return seg.ease === "sine" ? seg.v0 + ((seg.v1 - seg.v0) * (1 - Math.cos(Math.PI * s))) / 2 : lin(seg, s);
}

/** Hodnota motoru v čase `t` [s] studie délky `duration` (spojitě – dynamika). */
export const motorAt = (mo: MotionMotor, t: number, duration: number): number => profileAt(motorKeys(mo, duration), t);

/* ───────────────────────── význam hodnot, zdvih a směr ───────────────────────── */

/** Je hodnota motoru hodnotou vazby (Vzdálenost, Drážka s polohou)? Jinak je to posuv / natočení od výchozí polohy. */
export const motorIsAbsolute = (mo: Pick<MotionMotor, "kind">, m: Pick<Mate, "type" | "value"> | undefined | null): boolean =>
  !!m && mo.kind === "linear" && (m.type === "distance" || (m.type === "slot" && m.value !== undefined));

/**
 * Výchozí začátek motoru bez výpočtu: u absolutní vazby její hodnota v dokumentu (splněná vazba = aktuální mezera), jinak 0
 * (posuv / natočení od výchozí polohy). Skutečně naměřenou hodnotu ve výchozí poloze dává výsledek studie (`MotionResult.motorInfo`).
 */
export const motorCurrent = (mo: Pick<MotionMotor, "kind">, m: Pick<Mate, "type" | "value"> | undefined | null): number => (motorIsAbsolute(mo, m) ? (m!.value ?? 0) : 0);

export type MotorSpan = {
  start: number;
  /** koncová hodnota; null = bez konce (jen rychlost) */
  end: number | null;
  /** zdvih = |konec − začátek| (bez konce: dráha za dobu studie) */
  stroke: number;
  /** směr první části pohybu: +1 hodnota roste, −1 klesá, 0 stojí */
  dir: -1 | 0 | 1;
  /** doba jízdy na konec [s] (rozsah × rychlost: |zdvih| / rychlost; rozsah: délka studie) */
  time: number;
  /** rychlost [mm/s | ot/min] se znaménkem směru; u rozsahu bez rychlosti průměrná */
  speed: number;
  /** hodnota na konci studie */
  endAt: number;
  mode: "range" | "back" | "ranged" | "open" | "keys";
  /** víc úseků / klíčových poloh (`keys`): hodnoty klíčů bez prodlev a časy jejich dosažení [s] (od začátku studie) */
  values?: { t: number; v: number }[];
  /** začátek motoru [s] (časové okno; fáze začíná až ve výpočtu – tady 0) */
  t0: number;
  /** rozsah × rychlost: studie je kratší než jízda – motor na konec nedojede */
  short: boolean;
  /** rozsah × rychlost: po dojetí stojí ještě tolik sekund */
  hold: number;
};

/**
 * Začátek, konec, zdvih, směr a doba motoru ve studii délky `duration` [s] – z profilu (`motorKeys`): začátek = první klíč, konec,
 * zdvih, směr a doba = první úsek (u „tam a zpět“ cesta tam). Další úseky (klíčové polohy, etapa M3) čte volající z `motorKeys`.
 */
export function motorSpan(mo: MotionMotor, duration: number): MotorSpan {
  const D = duration > 0 ? duration : 1;
  const p = motorKeys(mo, D);
  const endAt = profileAt(p, D, { k: 1, n: 1 });
  const sgn = (v: number): -1 | 0 | 1 => (v > 1e-12 ? 1 : v < -1e-12 ? -1 : 0);
  const start = p.keys[0].v;
  const t0 = motorStartTime(mo);
  // první úsek, ve kterém se hodnota mění (okno / fáze: před začátkem motor drží začátek)
  const first = p.segments.find((g) => g.v1 !== g.v0) ?? p.segments[0];
  if (!first) {
    const speed = p.after.mode === "run" ? p.after.speed : 0;
    return { start, end: null, stroke: Math.abs(endAt - start), dir: sgn(speed), time: D, speed, endAt, mode: "open", t0, short: false, hold: 0 };
  }
  if (isPiecewise(mo)) {
    // klíčové polohy / navazující úseky: zdvih = rozpětí hodnot, směr = první pohyb, konec = poslední klíč
    const values: { t: number; v: number }[] = [];
    for (const k of p.keys) if (!values.length || Math.abs(values[values.length - 1].v - k.v) > 1e-12) values.push({ t: k.t, v: k.v });
    const vs = p.keys.map((k) => k.v);
    const last = p.keys[p.keys.length - 1];
    const dir = sgn(first.v1 - first.v0);
    return { start, end: last.v, stroke: Math.max(...vs) - Math.min(...vs), dir, time: last.t - t0, speed: 0, endAt, mode: "keys", values, t0, short: last.t > D + 1e-9, hold: Math.max(0, D - last.t) };
  }
  const stroke = Math.abs(first.v1 - first.v0);
  const dir = sgn(first.v1 - first.v0);
  const time = first.t1 - first.t0;
  const perUnit = mo.kind === "rotary" ? 6 : 1; // ot/min ↔ °/s
  if (isRanged(mo)) return { start, end: first.v1, stroke, dir, time, speed: dir * Math.abs(mo.speed!), endAt, mode: "ranged", t0, short: t0 + time > D + 1e-9, hold: Math.max(0, D - t0 - time) };
  return { start, end: first.v1, stroke, dir, time, speed: (dir * stroke) / time / perUnit, endAt, mode: mo.back ? "back" : "range", t0, short: false, hold: 0 };
}

/** číslo do textu: desetinná tečka v EN, čárka v CS / DE (jako ostatní řádky protokolu), bez zbytečných nul */
export const motorNum = (v: number, d = 4): string => {
  const s = (Math.round(v * 10 ** d) / 10 ** d || 0).toString();
  return getLang() === "en" ? s : s.replace(".", ",");
};
/** šipka směru: lineární ↑ hodnota roste / ↓ klesá, rotační ↺ kladně / ↻ záporně; tam a zpět obě */
export function motorArrow(mo: Pick<MotionMotor, "kind">, dir: -1 | 0 | 1, back = false): string {
  const a = mo.kind === "rotary" ? (dir >= 0 ? "↺" : "↻") : dir >= 0 ? "↑" : "↓";
  const b = mo.kind === "rotary" ? (dir >= 0 ? "↻" : "↺") : dir >= 0 ? "↓" : "↑";
  return dir === 0 ? "·" : back ? a + b : a;
}

/**
 * Průběh motoru slovy (protokol i panel): „57,5 → 27,15 mm ↓ zdvih 30,35 mm · 15,175 mm/s · 2 s“. Vždy uvádí začátek, konec
 * (nebo výslovně „bez koncové hodnoty“), zdvih a směr; nic se nevynechává potichu (uložený nepoužitý konec se jmenuje).
 */
export function motorRangeText(mo: MotionMotor, duration: number): string {
  const s = motorSpan(mo, duration);
  const rot = mo.kind === "rotary";
  const n = (v: number) => motorNum(v);
  const speedText = (v: number) => (rot ? tr("{0} ot/min", motorNum(Math.abs(v), 3)) : tr("{0} mm/s", motorNum(Math.abs(v), 3)));
  if (s.mode === "open") {
    const txt = rot
      ? tr("od {0}° {1} rychlostí {2} (bez koncové hodnoty – za {3} s na {4}°)", n(s.start), motorArrow(mo, s.dir), speedText(s.speed), motorNum(duration, 3), n(s.endAt))
      : tr("od {0} mm {1} rychlostí {2} (bez koncové hodnoty – za {3} s na {4} mm)", n(s.start), motorArrow(mo, s.dir), speedText(s.speed), motorNum(duration, 3), n(s.endAt));
    // starší dokument: konec uložený vedle rychlosti se nikdy nepoužíval – říct to, ne ho potichu zahodit (⚠ motion.end-unused v motorNotes)
    const end = unusedEnd(mo);
    const unused = end !== null ? tr(" · uložený konec {0} se nepoužívá", `${n(end)}${rot ? "°" : " mm"}`) : "";
    return txt + unused;
  }
  // okno / fáze: od kdy motor jede (fázi jmenuje motorText v cad/motion.ts – tady jen čas okna)
  const win = mo.window ? (mo.window.t1 !== undefined ? tr(" · okno {0}–{1} s", motorNum(s.t0, 3), motorNum(mo.window.t1, 3)) : tr(" · od {0} s", motorNum(s.t0, 3))) : "";
  if (s.mode === "keys") {
    const u = rot ? "°" : " mm";
    const vals = (s.values ?? []).map((k, i) => (i === 0 ? n(k.v) : `${n(k.v)} (${motorNum(k.t, 3)} s)`)).join(" → ");
    const vs = s.values ?? [];
    const arrows = vs.slice(1).map((k, i) => motorArrow(mo, k.v > vs[i].v ? 1 : -1)).join("");
    return (rot ? tr("{0}{1} {2} otočení {3}° · úseků {4}", vals, u, arrows, n(s.stroke), Math.max(0, vs.length - 1)) : tr("{0}{1} {2} zdvih {3} mm · úseků {4}", vals, u, arrows, n(s.stroke), Math.max(0, vs.length - 1))) + win;
  }
  const arrow = motorArrow(mo, s.dir, s.mode === "back");
  let out: string;
  if (s.mode === "back") out = rot ? tr("{0} → {1} → {0}° {2} otočení {3}° tam a zpět", n(s.start), n(s.end!), arrow, n(s.stroke)) : tr("{0} → {1} → {0} mm {2} zdvih {3} mm tam a zpět", n(s.start), n(s.end!), arrow, n(s.stroke));
  else out = rot ? tr("{0} → {1}° {2} otočení {3}°", n(s.start), n(s.end!), arrow, n(s.stroke)) : tr("{0} → {1} mm {2} zdvih {3} mm", n(s.start), n(s.end!), arrow, n(s.stroke));
  if (s.mode === "ranged") {
    out += ` · ${speedText(s.speed)} · ${motorNum(s.time, 3)} s`;
    if (s.hold > 1e-9) out += tr(" (pak stojí do konce studie {0} s)", motorNum(duration, 3));
  }
  return out + win;
}

/** Význam hodnot motoru slovy s průběhem: „hodnota vazby 57,5 → 27,15 mm ↓ zdvih 30,35 mm“ / „posuv od výchozí polohy 0 → −30 mm …“. */
export function motorMeaningText(mo: MotionMotor, abs: boolean, duration: number): string {
  const r = motorRangeText(mo, duration);
  if (abs) return tr("hodnota vazby {0}", r);
  return mo.kind === "rotary" ? tr("natočení od výchozí polohy {0}", r) : tr("posuv od výchozí polohy {0}", r);
}

/* ───────────────────────── zadání motoru (text i panel) ───────────────────────── */

/** Zadání motoru z textového příkazu / formuláře panelu – hodnoty tak, jak je uživatel napsal. */
export type MotorInput = {
  kind: "rotary" | "linear";
  /** začátek; undefined = aktuální hodnota vazby (absolutní) / 0 (od výchozí polohy) */
  from?: number;
  /** konec (hodnota), nebo zdvih (relativní posun od začátku) – právě jedno; nic = jen rychlost / výchozí zdvih */
  to?: number;
  stroke?: number;
  speed?: number;
  back?: boolean;
  /** klíčové polohy rozsahu „57,5..40..27,15“: hodnoty za začátkem (poslední = konec) – vlna 22, bod 3 */
  points?: number[];
  /** další úseky za rozsahem (`pak …`, `prodleva …`); rychlost úseku v jednotkách motoru (mm/s, ot/min) */
  extra?: MotorLeg[];
  /** klíčové polohy s časem od začátku motoru (`klíče 0:57,5 0,3:40 …`) */
  keys?: { t: number; v: number }[];
  window?: { t0?: number; t1?: number };
  phase?: string;
};

/**
 * Motor ze zadání. `current` = aktuální hodnota (absolutní vazba: mezera, jinak 0), `sign` = −1, když je motor zadaný komponentou B
 * relativní vazby (posuv / natočení se pak počítá obráceně; u absolutní vazby se znaménko NIKDY neobrací – mezera nezávisí na pořadí
 * komponent). Rozsah nebo zdvih spolu s rychlostí = rozsah × rychlost (`ranged`, rychlost je velikost; záporná rychlost proti směru
 * rozsahu je chyba). Bez rozsahu i zdvihu: s rychlostí jede od začátku bez konce, bez rychlosti výchozí zdvih +10 mm / +360°.
 */
export function buildMotor(inp: MotorInput, o: { id: string; mate: string; abs: boolean; current: number; sign?: 1 | -1 }): MotionMotor {
  const where = { ...(inp.window ? { window: inp.window } : {}), ...(inp.phase ? { phase: inp.phase } : {}) };
  if (inp.keys?.length || inp.points?.length || inp.extra?.length) return { ...buildPiecewise(inp, o), ...where };
  return { ...buildRange(inp, o), ...where };
}

/**
 * Motor s víc úseky (vlna 22, bod 3): klíčové polohy s časy (`keys`) nebo rozsah s mezipolohami (`points`) a další úseky (`extra`).
 * Úseky bez času a rychlosti vyplní okno / zbytek studie stejnou rychlostí (`fillLegs`). Uloží se jako `legs` / `keys`, `to` = konec.
 */
function buildPiecewise(inp: MotorInput, o: { id: string; mate: string; abs: boolean; current: number; sign?: 1 | -1 }): MotionMotor {
  const k = o.abs ? 1 : (o.sign ?? 1);
  const rot = inp.kind === "rotary";
  const per = rot ? 6 : 1; // ot/min → °/s
  if (inp.back) throw new Error(tr("motor: „tam a zpět“ nejde spojit s úseky – návrat zapište jako další úsek: … pak {0}", motorNum(inp.from ?? o.current)));
  if (inp.keys?.length) {
    const keys = [...inp.keys].sort((a, b) => a.t - b.t);
    if (keys.length < 2) throw new Error(tr("motor: klíčové polohy potřebují aspoň dvě dvojice čas:hodnota – klíče 0:57,5 0,3:40"));
    if (Math.abs(keys[0].t) > 1e-12) throw new Error(tr("motor: první klíčová poloha musí být v čase 0 (začátek motoru) – klíče 0:{0} …", motorNum(keys[0].v)));
    for (let i = 1; i < keys.length; i++) if (keys[i].t <= keys[i - 1].t) throw new Error(tr("motor: časy klíčových poloh musí růst – {0} s je dvakrát nebo pozpátku", motorNum(keys[i].t, 3)));
    const kk = keys.map((x) => ({ t: x.t, v: k * x.v }));
    return { id: o.id, kind: inp.kind, mate: o.mate, from: kk[0].v, to: kk[kk.length - 1].v, keys: kk };
  }
  const from = inp.from !== undefined ? k * inp.from : o.current;
  const main: MotorLeg[] = inp.points?.length
    ? inp.points.map((v) => ({ to: k * v, ...(inp.speed !== undefined ? { speed: Math.abs(inp.speed) * per } : {}) }))
    : inp.stroke !== undefined
      ? [{ to: from + k * inp.stroke, ...(inp.speed !== undefined ? { speed: Math.abs(inp.speed) * per } : {}) }]
      : inp.to !== undefined
        ? [{ to: k * inp.to, ...(inp.speed !== undefined ? { speed: Math.abs(inp.speed) * per } : {}) }]
        : [];
  const extra = (inp.extra ?? []).map((g) => ({ to: k * g.to, ...(g.time !== undefined ? { time: g.time } : {}), ...(g.speed !== undefined ? { speed: Math.abs(g.speed) * per } : {}) }));
  // prodleva zadaná bez hodnoty (to = NaN) drží předchozí hodnotu
  const legs: MotorLeg[] = [];
  let v = from;
  for (const g of [...main, ...extra]) {
    const to = Number.isFinite(g.to) ? g.to : v;
    if (g.speed !== undefined && (!Number.isFinite(g.speed) || g.speed === 0)) throw new Error(tr("motor: rychlost musí být nenulová"));
    if (g.time !== undefined && !(g.time >= 0)) throw new Error(tr("motor: čas úseku musí být kladný [s]"));
    legs.push({ ...g, to });
    v = to;
  }
  if (!legs.length) throw new Error(tr("motor: chybí konec prvního úseku – 57,5..27,15 pak 57,5"));
  if (legs.every((g) => g.to === from)) throw new Error(tr("motor: všechny úseky končí na začátku {0} – motor by se nepohnul", motorNum(from)));
  return { id: o.id, kind: inp.kind, mate: o.mate, from, to: legs[legs.length - 1].to, legs };
}

/** Motor s jedním rozsahem (dřívější tvary – rozsah, zdvih, rychlost, rozsah × rychlost, tam a zpět). */
function buildRange(inp: MotorInput, o: { id: string; mate: string; abs: boolean; current: number; sign?: 1 | -1 }): MotionMotor {
  const k = o.abs ? 1 : (o.sign ?? 1);
  const unit = inp.kind === "rotary" ? "°" : " mm";
  const from = inp.from !== undefined ? k * inp.from : o.current;
  const hasEnd = inp.to !== undefined || inp.stroke !== undefined;
  const to = inp.stroke !== undefined ? from + k * inp.stroke : inp.to !== undefined ? k * inp.to : from + (inp.kind === "rotary" ? 360 : 10);
  const base = { id: o.id, kind: inp.kind, mate: o.mate, from, to };
  if (inp.speed !== undefined) {
    if (!Number.isFinite(inp.speed) || inp.speed === 0) throw new Error(tr("motor: rychlost musí být nenulová"));
    if (inp.back) throw new Error(tr("motor: „tam a zpět“ jede sinusově přes celou studii – rychlost k němu nezadávejte (délku určuje pohyb čas T)"));
    if (!hasEnd) return { ...base, to: from, speed: k * inp.speed }; // jen rychlost: od začátku bez konce, znaménko = směr
    if (to === from) throw new Error(inp.stroke !== undefined ? tr("motor: zdvih je nulový") : tr("motor: rozsah od–do je nulový – např. 0..360"));
    // rozsah × rychlost: směr dává rozsah; záporná rychlost je přípustná jen ve směru klesajícího rozsahu (jak ji uživatel napsal)
    const userDir = inp.stroke !== undefined ? Math.sign(inp.stroke) : Math.sign((inp.to ?? 0) - (inp.from ?? (o.abs ? o.current : 0)));
    if (inp.speed < 0 && userDir > 0)
      throw new Error(tr("motor: rychlost {0} je záporná, ale rozsah {1} → {2}{3} roste – zadejte kladnou rychlost (směr určuje rozsah), nebo rozsah otočte", motorNum(inp.speed), motorNum(k * from), motorNum(k * to), unit));
    return { ...base, speed: Math.abs(inp.speed), ranged: true };
  }
  if (to === from) throw new Error(inp.stroke !== undefined ? tr("motor: zdvih je nulový") : tr("motor: rozsah od–do je nulový – např. 0..360"));
  return { ...base, ...(inp.back ? { back: true } : {}) };
}

/**
 * Upozornění k motoru: kód registru (engine/codes.ts), `args` = argumenty krátkého textu registru (nejvýš tři), `text` = celá věta
 * v aktuálním jazyce (s návodem, jak zadání opravit) – protokol i panel vypisují `text`.
 */
export type MotorNote = { code: "motion.duration-extended" | "motion.duration-set" | "motion.motor-short" | "motion.start-jump" | "motion.gap-negative" | "motion.end-unused"; args: (string | number)[]; text: string };

/**
 * Délka studie po zadání motoru `mo` (už vloženého do `study.motors` na pozici `index`). Rozsah × rychlost: doba jízdy
 * T = |do − od| / rychlost. Bez výslovně zadané délky (`explicit`): jediný motor kinematické studie → délka = T, a mění-li se tím
 * dřív nastavená (jiná než výchozí) délka, řekne to ℹ `motion.duration-set` (nikdy potichu); dynamika se nezkracuje (motor po
 * dojetí stojí, simulace běží dál); víc motorů / dynamika → délka se prodlouží na T, je-li kratší (⚠ `motion.duration-extended`),
 * delší zůstane (motor po dojetí stojí). Výslovná délka kratší než T je rozpor – chyba s vysvětlením, nic se nezahodí potichu.
 */
/**
 * Doba, kterou motor s víc úseky / klíči potřebuje [s] od začátku studie (začátek okna + úseky s časem / rychlostí, klíče);
 * null = délku studie neurčuje (úseky bez času vyplní, co zbývá; motor ve fázi začne až ve výpočtu).
 */
export function piecewiseNeed(mo: MotionMotor): number | null {
  if (!isPiecewise(mo) || mo.phase) return null;
  const t0 = motorStartTime(mo);
  if (mo.keys && mo.keys.length > 1) return t0 + mo.keys[mo.keys.length - 1].t;
  let v = mo.from;
  let T = 0;
  for (const g of mo.legs ?? []) {
    if (g.time !== undefined) T += g.time;
    else if (g.speed) T += Math.abs(g.to - v) / Math.abs(g.speed);
    else return mo.window?.t1 ?? null;
    v = g.to;
  }
  return t0 + T;
}

export function fitDuration(study: MotionStudy, index: number, explicit?: number): { duration: number; note?: MotorNote } {
  const mo = study.motors[index];
  const D = explicit ?? study.duration;
  const need = mo ? piecewiseNeed(mo) : null;
  if (need !== null) {
    // úseky s časem / rychlostí: studie musí trvat aspoň do konce posledního úseku (nikdy se nic nezkrátí potichu)
    if (explicit !== undefined) {
      if (need > explicit + 1e-9) throw new Error(tr("motor: úseky motoru {0} trvají do {1} s, zadaný čas studie {2} s nestačí – vynechte čas, nebo úseky zkraťte", index + 1, motorNum(need, 3), motorNum(explicit, 3)));
      return { duration: explicit };
    }
    if (study.motors.length === 1 && study.mode !== "dynamic" && Math.abs(study.duration - DEFAULT_STUDY_DURATION) < 1e-9) return { duration: need };
    if (need > study.duration + 1e-9) return { duration: need, note: { code: "motion.duration-extended", args: [index + 1, motorNum(study.duration, 3), motorNum(need, 3)], text: tr("délka studie prodloužena z {1} s na {2} s – motor {0} potřebuje na svůj rozsah {2} s (ostatní motory s rozsahem bez rychlosti tím zpomalí)", index + 1, motorNum(study.duration, 3), motorNum(need, 3)) } };
    return { duration: study.duration };
  }
  if (!mo || !isRanged(mo)) return { duration: D };
  const s = motorSpan(mo, D);
  const unit = mo.kind === "rotary" ? "°" : " mm";
  const speedText = mo.kind === "rotary" ? tr("{0} ot/min", motorNum(Math.abs(mo.speed!), 3)) : tr("{0} mm/s", motorNum(Math.abs(mo.speed!), 3));
  if (explicit !== undefined) {
    if (s.time > explicit + 1e-9)
      throw new Error(
        tr("motor: rozsah {0}{1} rychlostí {2} trvá {3} s, zadaný čas {4} s nestačí – vynechte čas (délka studie bude {3} s), nebo rychlost (motor projede rozsah za {4} s)", motorNum(s.stroke), unit, speedText, motorNum(s.time, 3), motorNum(explicit, 3)) +
          // skripty starších verzí: „A..B rychlost V“ dřív znamenalo jízdu od A bez konce (B se nepoužilo) – dnes rozsah × rychlost
          tr(" (skript ze starší verze: dřívější význam – jet od začátku rychlostí bez konce – zapíšete „od A rychlost V“)"),
      );
    return { duration: explicit };
  }
  if (study.motors.length === 1 && study.mode !== "dynamic") {
    const prev = study.duration;
    if (Math.abs(s.time - prev) > 1e-9 && Math.abs(prev - DEFAULT_STUDY_DURATION) > 1e-9)
      return {
        duration: s.time,
        note: { code: "motion.duration-set", args: [index + 1, motorNum(prev, 3), motorNum(s.time, 3)], text: tr("délka studie změněna z {1} s na {2} s – určuje ji doba jízdy jediného motoru {0} (rozsah × rychlost); jinou délku zadejte pohyb čas T (motor po dojetí stojí)", index + 1, motorNum(prev, 3), motorNum(s.time, 3)) },
      };
    return { duration: s.time };
  }
  if (s.time > study.duration + 1e-9)
    return { duration: s.time, note: { code: "motion.duration-extended", args: [index + 1, motorNum(study.duration, 3), motorNum(s.time, 3)], text: tr("délka studie prodloužena z {1} s na {2} s – motor {0} potřebuje na svůj rozsah {2} s (ostatní motory s rozsahem bez rychlosti tím zpomalí)", index + 1, motorNum(study.duration, 3), motorNum(s.time, 3)) } };
  return { duration: study.duration };
}

/** naměřený stav motoru ve výchozí poloze studie (cad/motion.ts): `current` = hodnota vazby (absolutní), jinak 0 */
export type MotorInfo = { abs: boolean; current: number };
/** nad tímto rozdílem [mm | °] se začátek motoru liší od aktuální hodnoty (skok v kroku 0) */
export const JUMP_EPS = 0.01;

/**
 * Upozornění k motorům studie (protokol ⚠ s kódem, panel): začátek jiný než aktuální hodnota (v kroku 0 díl přeskočí), rozsah ×
 * rychlost delší než studie (motor nedojede), mezera vazby Vzdálenost pod nulou bez kontroly kolizí (plochy se prostoupí).
 * `mates` = vazby sestavy, `info` = naměřené hodnoty z výpočtu (bez nich se skok počítá z hodnoty vazby v dokumentu).
 */
export function motorNotes(study: Pick<MotionStudy, "motors" | "duration" | "collisions">, mates: Mate[], label: (m: Mate) => string, info?: (MotorInfo | undefined)[]): MotorNote[] {
  const out: MotorNote[] = [];
  study.motors.forEach((mo, i) => {
    const m = mates.find((x) => x.id === mo.mate);
    // starší dokument: rychlost bez `ranged` a vedle ní uložený konec – motor jede bez konce (i opačným směrem), konec se nepoužije
    const end = unusedEnd(mo);
    if (end !== null) {
      const rot = mo.kind === "rotary";
      const u = (v: number) => `${motorNum(v)}${rot ? "°" : " mm"}`;
      const sp = motorSpan(mo, study.duration);
      const speed = rot ? tr("{0} ot/min", motorNum(mo.speed!, 3)) : tr("{0} mm/s", motorNum(mo.speed!, 3));
      const away = Math.sign(end - mo.from) !== 0 && Math.sign(mo.speed!) !== Math.sign(end - mo.from);
      const no = m ? mates.indexOf(m) + 1 : "?";
      const cmd = rot ? tr("pohyb motor rotační vazba {0} {1}..{2} ot/min {3}", no, motorNum(mo.from), motorNum(end), motorNum(Math.abs(mo.speed!), 3)) : tr("pohyb motor lineární vazba {0} {1}..{2} rychlost {3}", no, motorNum(mo.from), motorNum(end), motorNum(Math.abs(mo.speed!), 3));
      out.push({
        code: "motion.end-unused",
        args: [i + 1, u(end), u(sp.endAt)],
        text:
          tr("motor {0}: uložený konec {1} se nepoužívá – motor jede od {2} rychlostí {3} bez koncové hodnoty, na konci studie je na {4}", i + 1, u(end), u(mo.from), speed, u(sp.endAt)) +
          (away ? tr(" (opačným směrem, než leží konec)") : "") +
          tr("; dokument ze starší verze – dojet na konec a stát: {0} (v panelu Převést na rozsah × rychlost)", cmd),
      });
    }
    if (!m) return;
    const abs = info?.[i]?.abs ?? motorIsAbsolute(mo, m);
    const cur = info?.[i]?.current ?? motorCurrent(mo, m);
    const unit = mo.kind === "rotary" ? "°" : " mm";
    const s = motorSpan(mo, study.duration);
    // motor, který začne později (časové okno, fáze), se proti hodnotě vazby kontroluje až ve výpočtu (motion.start-jump v okamžiku začátku)
    const jump = mo.phase || motorStartTime(mo) > 0 ? 0 : Math.abs(s.start - cur);
    const u = (v: number) => `${motorNum(v)}${unit}`;
    if (jump > JUMP_EPS)
      out.push({
        code: "motion.start-jump",
        args: [i + 1, u(s.start), u(cur)],
        text: abs
          ? tr("motor {0}: začátek {1} se liší od aktuální hodnoty vazby „{2}“ {3} – v kroku 0 díl přeskočí o {4}; zdvih od aktuální hodnoty: pohyb motor … zdvih Δ", i + 1, u(s.start), label(m), u(cur), u(jump))
          : tr("motor {0}: začátek {1} není 0 – u vazby „{2}“ je hodnota motoru posuv / natočení od výchozí polohy, v kroku 0 díl přeskočí o {3}; bez skoku: 0..Δ nebo zdvih Δ", i + 1, u(s.start), label(m), u(jump)),
      });
    if (s.short) {
      const speedText = mo.kind === "rotary" ? tr("{0} ot/min", motorNum(Math.abs(mo.speed!), 3)) : tr("{0} mm/s", motorNum(Math.abs(mo.speed!), 3));
      out.push({
        code: "motion.motor-short",
        args: [i + 1, motorNum(s.time, 3), motorNum(study.duration, 3)],
        text: tr("motor {0} nedojede na konec: {1} rychlostí {2} trvá {3} s, studie má {4} s – skončí na {5}; pohyb čas {3}", i + 1, u(s.stroke), speedText, motorNum(s.time, 3), motorNum(study.duration, 3), u(s.endAt)),
      });
    }
    if (abs && m.type === "distance" && !m.flip && !study.collisions) {
      const lo = Math.min(s.start, s.endAt, s.end ?? s.endAt);
      if (lo < -1e-9) out.push({ code: "motion.gap-negative", args: [i + 1, label(m), motorNum(lo)], text: tr("motor {0}: hodnota vazby „{1}“ klesne pod nulu ({2} mm) – plochy vazby se prostoupí a díly do sebe mohou vnikat; kolize se v této studii nekontrolují (pohyb kolize)", i + 1, label(m), motorNum(lo)) });
    }
  });
  return out;
}
