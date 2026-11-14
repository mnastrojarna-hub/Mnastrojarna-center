/**
 * Textové příkazy primitiv (CS / EN / DE) – kvádr, válec, koule, kužel, trubka, pružina, závit. Stejné volby jako formulář
 * (forms/more-forms.tsx): poloha číslem i odkazem, osa libovolným směrem, operace a cílové těleso. Čisté funkce bez jádra
 * (testy v Node); agent.ts je volá před běžnými příkazy.
 *
 *   kvádr X Y Z [střed] · válec D H · koule D · kužel D1 D2 H · trubka D d H
 *   pružina D stoupání P (závity N | délka L) drát d · závit M8 délka L [vnitřní] [modelovat]
 *   poloha:  v x y z | na V3 | na střed hrany E2 | na střed kružnice E5 | na střed plochy F3 | na začátek|konec hrany E2
 *            | na bod "Bod 1" | na mezi V1 V5 | na počátek          (EN at … mid edge E2 / center circle E5, DE bei … mitte kante E2)
 *   osa:     osa X|Y|Z|-Z | osa x y z | osa hrana E3 | osa plocha F2 | osa "Osa 1" | osa body V1 V2 [obráceně]   (směr … = totéž)
 *   operace: přidat | odebrat | průnik | nové [těleso "Název"] · těleso "Název" · název "…"
 *
 * Čísla F/E/V jsou popisky pro výběr (F1 = první plocha; window.mncad.hints(), měřit) – odkaz se řeší při stavbě na tělese
 * před prvkem, takže zůstává asociativní. Pomocná osa / bod názvem se v aplikaci převede na id (`resolveDatumNames`).
 */
import { tr } from "./i18n";
import { threadByName, threadLabel } from "./defaults";
import type { Direction, Ref } from "./refs";
import { uid, type Axis, type Feature, type Vec3 } from "./types";

type PrimType = "box" | "cylinder" | "sphere" | "cone" | "tube" | "spring" | "thread";
type PrimF = Extract<Feature, { type: PrimType }>;
/** volby z obecného rozboru agent.ts (`parseOpts`) */
export type OptsLike = { flags: Set<string>; nums: Record<string, number[]>; words: Record<string, string[]>; free: number[]; strings: string[] };
export type PrimOp = { k: "feature"; feature: Feature; line: number };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/−/g, "-");
const set = (...w: string[]) => new Set(w.map(fold));
const isNum = (t: string | undefined) => t !== undefined && /^[+-]?ø?(\d+[.,]?\d*|[.,]\d+)(mm|°)?$/i.test(t.replace(/^[øØ]/, ""));
const num = (t: string) => {
  const m = /^([+-]?)(\d+[.,]?\d*|[.,]\d+)/.exec(t.replace(/^[øØ]/, ""));
  return m ? (m[1] === "-" ? -1 : 1) * parseFloat(m[2].replace(",", ".")) : NaN;
};
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 || 0;

/** příkazy (kanonický tvar z agent.ts nebo složené slovo) → typ prvku */
const CMD: Record<string, PrimType> = { box: "box", cylinder: "cylinder", sphere: "sphere", cone: "cone", tube: "tube", thread: "thread", spring: "spring", pruzina: "spring", feder: "spring", druckfeder: "spring" };
const AT = set("v", "na", "at", "bei", "an", "poloha", "position", "pos");
const MID = set("střed", "stred", "středem", "mid", "midpoint", "middle", "center", "centre", "mitte", "mittelpunkt", "zentrum");
const START = set("začátek", "zacatek", "start", "begin", "anfang");
const END = set("konec", "end", "ende");
const EDGE = set("hrana", "hrany", "hranu", "edge", "kante");
const CIRCLE = set("kružnice", "kruznice", "kruhu", "kruh", "oblouku", "oblouk", "díry", "diry", "circle", "arc", "hole", "kreis", "kreises", "bogen", "bohrung");
const FACE = set("plocha", "plochy", "plochu", "face", "fläche", "flaeche");
const POINT = set("bod", "bodu", "point", "punkt");
const BETWEEN = set("mezi", "between", "zwischen");
const ORIGIN = set("počátek", "pocatek", "počátku", "pocatku", "origin", "ursprung", "nullpunkt");
const AXISW = set("osa", "osou", "kolem", "axis", "achse", "um");
const DIRW = set("směr", "smer", "podél", "podel", "direction", "dir", "along", "richtung", "entlang");
const POINTS = set("body", "points", "punkte");
const PITCH = set("stoupání", "stoupani", "pitch", "steigung");
const TURNS = set("závity", "zavity", "závitů", "zavitu", "turns", "windungen");
const WIRE = set("drát", "drat", "drátu", "dratu", "wire", "draht", "drahtdurchmesser");
const ENT = /^([efv])(\d+)$/i;
const AXIS_TOKEN = /^([+-]?)([xyz])$/i;

/**
 * Cílové těleso z vlastního rozboru řádku (ne z rozboru celého řádku v agent.ts: české „osa body V1 V5“ = dva body, anglicky
 * „body“ = těleso). „těleso 2“ → „Těleso 2“; „nové“ bez názvu → `$new` (další volný název doplní aplikace); jinak "".
 */
export function bodyOfOpts(o: OptsLike): string {
  const t = (o.words.body ?? []).join(" ").trim();
  if (t) return /^\d+$/.test(t) ? `Těleso ${t}` : t;
  return o.flags.has("newbody") ? "$new" : "";
}
const OPS = ["add", "cut", "intersect", "newbody"] as const;
/** Booleovská operace z příznaků; dvě různé operace v jednom řádku = chyba (dřív vyhrála první v pořadí odebrat > průnik > nové). */
export function opOfOpts(o: OptsLike, said: (canonical: string) => string, what: string): "add" | "cut" | "intersect" | "new" | null {
  const ops = OPS.filter((k) => o.flags.has(k));
  if (ops.length > 1) throw new Error(tr("{0}: operace „{1}“ a „{2}“ se vylučují – zadejte jen jednu: přidat | odebrat | průnik | nové", what, said(ops[0]), said(ops[1])));
  return ops[0] === "newbody" ? "new" : (ops[0] ?? null);
}

/** název příkazu v jazyce rozhraní (do chybových hlášek) */
const word = (t: PrimType): string => ({ box: tr("kvádr"), cylinder: tr("válec"), sphere: tr("koule"), cone: tr("kužel"), tube: tr("trubka"), spring: tr("pružina"), thread: tr("závit") })[t];

/** úplný zápis voleb polohy, osy a operace (nápověda, chybové hlášky) */
export const primPlaceUsage = (withMode = true) =>
  tr("[v x y z | na V3 | na střed hrany E2 | na střed kružnice E5 | na střed plochy F3 | na začátek|konec hrany E2 | na bod \"Bod 1\" | na mezi V1 V5] [osa X|Y|Z|-Z | osa x y z | osa hrana E3 | osa plocha F2 | osa \"Osa 1\" | osa body V1 V2] [obráceně]") + (withMode ? tr(" [přidat|odebrat|průnik|nové] [těleso \"Název\"]") : "");
/** zápis příkazu podle typu */
export const primUsage = (t: PrimType): string => {
  const head: Record<PrimType, string> = {
    box: tr("kvádr X Y Z [střed]"),
    cylinder: tr("válec D H"),
    sphere: tr("koule D [v x y z | na …] [přidat|odebrat|průnik|nové]"),
    cone: tr("kužel D1 D2 H"),
    tube: tr("trubka D d H"),
    spring: tr("pružina D stoupání P (závity N | délka L) drát d"),
    thread: tr("závit M18×1,5 délka L [vnitřní] [modelovat]"),
  };
  return t === "sphere" ? head.sphere : `${head[t]} ${primPlaceUsage(t !== "thread")}`;
};

const refOf = (t: string | undefined): Ref | null => {
  const m = t ? ENT.exec(t) : null;
  if (!m) return null;
  const i = Number(m[2]) - 1;
  if (i < 0) throw new Error(tr("čísla ploch, hran a vrcholů začínají 1 (F1, E1, V1) – „{0}“", t!));
  const k = m[1].toLowerCase();
  return k === "f" ? { kind: "face", index: i } : k === "e" ? { kind: "edge", index: i } : { kind: "vertex", index: i };
};
const edgeRef = (t: string | undefined, at: "mid" | "center" | "start" | "end"): Ref | null => {
  const r = refOf(t);
  return r && r.kind === "edge" ? { kind: "edge", index: r.index, at } : null;
};

/**
 * Bod odkazem od indexu `j`: V3 · E2 (střed hrany) · F3 (střed plochy) · střed hrany E2 · střed kružnice E5 · střed plochy F3 ·
 * začátek / konec hrany E2 · bod "Bod 1" (pomocný bod názvem) · mezi V1 V5 · počátek. `null` = na indexu odkaz není.
 */
export function readPointRef(tk: string[], j: number): { ref: Ref; used: number } | null {
  const t = tk[j];
  if (t === undefined) return null;
  const w = fold(t);
  const direct = refOf(t);
  if (direct) return { ref: direct.kind === "edge" ? { ...direct, at: "mid" } : direct, used: 1 };
  if (ORIGIN.has(w)) return { ref: { kind: "csys" }, used: 1 };
  const n1 = tk[j + 1];
  const w1 = fold(n1 ?? "");
  if (MID.has(w) || START.has(w) || END.has(w)) {
    const at = MID.has(w) ? "mid" : START.has(w) ? "start" : "end";
    if (MID.has(w) && BETWEEN.has(w1)) {
      const b = readPointRef(tk, j + 1);
      return b ? { ref: b.ref, used: 1 + b.used } : null;
    }
    if (EDGE.has(w1) || (CIRCLE.has(w1) && at === "mid") || (FACE.has(w1) && at === "mid")) {
      const want = FACE.has(w1) ? "face" : "edge";
      const r = refOf(tk[j + 2]);
      if (!r || r.kind !== want) throw new Error(FACE.has(w1) ? tr("střed plochy potřebuje číslo plochy: na střed plochy F3") : tr("{0} potřebuje číslo hrany: na střed hrany E2 · na střed kružnice E5 · na začátek hrany E2", t));
      if (r.kind === "face") return { ref: r, used: 3 };
      return { ref: { kind: "edge", index: r.index, at: CIRCLE.has(w1) ? "center" : at }, used: 3 };
    }
    const r = edgeRef(n1, at);
    if (r) return { ref: r, used: 2 };
    if (at === "mid") {
      const o = refOf(n1);
      if (o) return { ref: o, used: 2 };
    }
    return null; // „střed“ bez odkazu = volba „vystředit“ (kvádr)
  }
  if (EDGE.has(w) || CIRCLE.has(w) || FACE.has(w)) {
    const r = refOf(n1);
    if (!r || r.kind !== (FACE.has(w) ? "face" : "edge")) return null;
    return { ref: r.kind === "edge" ? { ...r, at: CIRCLE.has(w) ? "center" : "mid" } : r, used: 2 };
  }
  if (POINT.has(w)) {
    if (n1 === undefined) throw new Error(tr("bod potřebuje název pomocného bodu nebo souřadnice: na bod \"Bod 1\" · v x y z"));
    if (isNum(n1)) {
      const xs = [n1, tk[j + 2], tk[j + 3]];
      if (!xs.every(isNum)) throw new Error(tr("bod potřebuje tři souřadnice: na bod 10 20 5"));
      return { ref: { kind: "xyz", p: xs.map((x) => num(x!)) as Vec3 }, used: 4 };
    }
    const r = refOf(n1);
    if (r) return { ref: r.kind === "edge" ? { ...r, at: "mid" } : r, used: 2 };
    return { ref: { kind: "datumPoint", featureId: n1 }, used: 2 };
  }
  if (BETWEEN.has(w)) {
    const a = readPointRef(tk, j + 1);
    const b = a ? readPointRef(tk, j + 1 + a.used) : null;
    if (!a || !b) throw new Error(tr("mezi potřebuje dva body: na mezi V1 V5 · na mezi střed hrany E1 V7"));
    return { ref: { kind: "derived", op: "mid", args: [a.ref, b.ref] }, used: 1 + a.used + b.used };
  }
  return null;
}

/** Osa / směr od indexu `j`: ±X|Y|Z · x y z · hrana E3 / E3 · plocha F2 / F2 (normála, u válce osa) · body V1 V2 · "Osa 1" · osa "Osa 1". */
export function readAxis(tk: string[], j: number, isKey: (t: string) => boolean): { dir: Direction; used: number } {
  const t = tk[j];
  const usage = () => tr("osa X|Y|Z|-Z · osa 1 0 1 · osa hrana E3 · osa plocha F2 · osa \"Osa 1\" · osa body V1 V5");
  if (t === undefined) throw new Error(tr("osa / směr potřebuje hodnotu: {0}", usage()));
  const ax = AXIS_TOKEN.exec(fold(t));
  if (ax) {
    const axis = ax[2].toUpperCase() as Axis;
    if (ax[1] !== "-") return { dir: { kind: "axis", axis }, used: 1 };
    const v: Vec3 = [0, 0, 0];
    v["XYZ".indexOf(axis)] = -1;
    return { dir: { kind: "vector", v }, used: 1 };
  }
  if (isNum(t)) {
    if (!isNum(tk[j + 1]) || !isNum(tk[j + 2])) throw new Error(tr("osa vektorem potřebuje tři čísla: osa 1 0 1"));
    const v: Vec3 = [num(t), num(tk[j + 1]), num(tk[j + 2])];
    if (!(Math.hypot(...v) > 1e-12)) throw new Error(tr("směr nesmí být nulový vektor"));
    return { dir: { kind: "vector", v }, used: 3 };
  }
  const w = fold(t);
  const direct = refOf(t);
  if (direct && direct.kind !== "vertex") return { dir: direct.kind === "face" ? { kind: "faceNormal", ref: direct } : { kind: "edge", ref: direct }, used: 1 };
  if (EDGE.has(w) || FACE.has(w)) {
    const r = refOf(tk[j + 1]);
    if (!r || r.kind !== (FACE.has(w) ? "face" : "edge")) throw new Error(EDGE.has(w) ? tr("osa hrana potřebuje číslo hrany: osa hrana E3 (přímá hrana nebo kruhová – osa kružnice)") : tr("osa plocha potřebuje číslo plochy: osa plocha F2 (normála rovinné plochy, osa válcové)"));
    return { dir: r.kind === "face" ? { kind: "faceNormal", ref: r } : { kind: "edge", ref: r }, used: 2 };
  }
  if (POINTS.has(w) || direct?.kind === "vertex") {
    const k = POINTS.has(w) ? j + 1 : j;
    const a = readPointRef(tk, k);
    const b = a ? readPointRef(tk, k + a.used) : null;
    if (!a || !b) throw new Error(tr("osa dvěma body: osa body V1 V5 (od prvního ke druhému)"));
    return { dir: { kind: "twoPoints", a: a.ref, b: b.ref }, used: k - j + a.used + b.used };
  }
  if (AXISW.has(w)) {
    const n = tk[j + 1];
    if (n === undefined || isKey(n)) throw new Error(tr("osa potřebuje název pomocné osy: osa \"Osa 1\""));
    return { dir: { kind: "edge", ref: { kind: "datumAxis", featureId: n } }, used: 2 };
  }
  if (isKey(t)) throw new Error(tr("osa / směr potřebuje hodnotu: {0}", usage()));
  // pomocná osa (nebo osa Z souřadného systému) názvem – id doplní aplikace (resolveDatumNames)
  return { dir: { kind: "edge", ref: { kind: "datumAxis", featureId: t } }, used: 1 };
}

type Scan = { rest: string[]; posRef?: Ref; dir?: Direction; pitch?: number; turns?: number; wire?: number };

/** Vybere z příkazu polohu odkazem, osu / směr a volby pružiny; ostatní slova vrátí v `rest` pro `parseOpts`. */
function scan(type: PrimType, tk: string[], isKey: (t: string) => boolean): Scan {
  const out: Scan = { rest: [] };
  const take = (what: string, j: number) => {
    if (!isNum(tk[j])) throw new Error(tr("{0} potřebuje číslo", what));
    return num(tk[j]);
  };
  for (let i = 0; i < tk.length; i++) {
    const t = tk[i];
    const w = fold(t);
    if (AT.has(w) && tk[i + 1] !== undefined && !isNum(tk[i + 1])) {
      const p = readPointRef(tk, i + 1);
      if (!p) throw new Error(tr("„{0} {1}“ není poloha – {2}", t, tk[i + 1], primPlaceUsage()));
      if (out.posRef) throw new Error(tr("poloha je zadaná dvakrát"));
      out.posRef = p.ref;
      i += p.used;
      continue;
    }
    // kvádr: „střed“ bez předchozího „v / na“ = vystředit; odkaz hned za ním je poloha středu („kvádr 10 10 10 střed F1“ = střed
    // kvádru ve středu plochy F1, dřív se „střed“ přečetl jako část odkazu a kvádr stál rohem v bodě); „na střed plochy F1“ = roh
    if (type === "box" && MID.has(w)) {
      out.rest.push(t);
      const p = readPointRef(tk, i + 1);
      if (p) {
        if (out.posRef) throw new Error(tr("poloha je zadaná dvakrát"));
        out.posRef = p.ref;
        i += p.used;
      }
      continue;
    }
    if (MID.has(w) || START.has(w) || END.has(w) || POINT.has(w) || BETWEEN.has(w) || ORIGIN.has(w)) {
      const p = readPointRef(tk, i);
      if (p) {
        if (out.posRef) throw new Error(tr("poloha je zadaná dvakrát"));
        out.posRef = p.ref;
        i += p.used - 1;
        continue;
      }
    }
    if (AXISW.has(w) || DIRW.has(w)) {
      if (type === "sphere") throw new Error(tr("koule nemá osu – zadejte jen průměr a polohu: {0}", primUsage("sphere")));
      if (out.dir) throw new Error(tr("osa / směr je zadaná dvakrát"));
      const d = readAxis(tk, i + 1, isKey);
      // číslo hned za osou vektorem (4. složka) – dřív se připojilo k poloze a hláška mířila na „v x y z“
      if (isNum(tk[i + 1]) && isNum(tk[i + 1 + d.used])) throw new Error(tr("osa vektorem má tři složky – číslo „{0}“ za „{1} {2}“ je navíc (rozměry pište hned za příkaz)", tk[i + 1 + d.used], t, tk.slice(i + 1, i + 1 + d.used).join(" ")));
      out.dir = d.dir;
      i += d.used;
      continue;
    }
    if (type === "spring" && (PITCH.has(w) || TURNS.has(w) || WIRE.has(w))) {
      const v = take(t, i + 1);
      if (PITCH.has(w)) out.pitch = v;
      else if (TURNS.has(w)) out.turns = v;
      else out.wire = v;
      i++;
      continue;
    }
    out.rest.push(t);
  }
  return out;
}

const FLAGS_OK: Record<PrimType, string[]> = {
  box: ["center", "reverse", "cut", "add", "intersect", "newbody"],
  cylinder: ["reverse", "cut", "add", "intersect", "newbody"],
  sphere: ["cut", "add", "intersect", "newbody"],
  cone: ["reverse", "cut", "add", "intersect", "newbody"],
  tube: ["reverse", "cut", "add", "intersect", "newbody"],
  spring: ["reverse", "cut", "add", "intersect", "newbody"],
  thread: ["reverse", "internal", "modeled"],
};
const NUMS_OK: Record<PrimType, string[]> = { box: ["at"], cylinder: ["at"], sphere: ["at"], cone: ["at"], tube: ["at"], spring: ["at", "length", "diameter"], thread: ["at", "length"] };
const FREE: Record<PrimType, number> = { box: 3, cylinder: 2, sphere: 1, cone: 3, tube: 3, spring: 1, thread: 1 };

/** obecný rozbor voleb z agent.ts: `parse` = parseOpts, `canon` = kanonický název slova, `isKey` = slovo je volba / příznak (nesmí se číst jako název pomocné osy) */
export type PrimParse = { parse: (t: string[]) => OptsLike; canon: (t: string) => string; isKey: (t: string) => boolean };
/** Primitivum z textu; `null` = jiný příkaz. `named` = název prvku (číslování podle typu, případně zadaný název). */
export function parsePrimLine(cmd: string, tokens: string[], opts: PrimParse, named: (type: PrimType, given?: string) => string, line: number): PrimOp | null {
  const type = CMD[cmd];
  if (!type) return null;
  const s = scan(type, tokens, opts.isKey);
  const o = opts.parse(s.rest);
  const said = (canonical: string) => s.rest.find((t) => opts.canon(t) === canonical) ?? canonical; // slovo tak, jak ho uživatel napsal
  const usage = primUsage(type);
  // ── nic nesmí zůstat nepřečtené (dřív se neznámá slova tiše ignorovala – „kužel … směr 1 0 1“ pak stál svisle)
  const strings = type === "thread" ? o.strings.filter((x) => !/^m\d/i.test(x)) : o.strings;
  if (strings.length) throw new Error(tr("{0}: neznámé slovo „{1}“ – {2}", word(type), strings[0], usage));
  if (type === "thread" && (o.flags.has("cut") || o.flags.has("intersect") || o.flags.has("add") || o.flags.has("newbody"))) throw new Error(tr("závit nemá operaci – kosmetický je jen ve výkrese, „modelovat“ vyřízne drážky: {0}", usage));
  const badFlag = [...o.flags].find((f) => !FLAGS_OK[type].includes(f));
  if (badFlag) throw new Error(tr("{0}: volba „{1}“ sem nepatří – {2}", word(type), said(badFlag), usage));
  const badNum = Object.keys(o.nums).find((k) => !NUMS_OK[type].includes(k));
  if (badNum) throw new Error(tr("{0}: volba „{1}“ sem nepatří – {2}", word(type), said(badNum), usage));
  const badWord = Object.keys(o.words).find((k) => k !== "name" && k !== "body" && !(type === "thread" && k === "thread"));
  if (badWord) throw new Error(tr("{0}: volba „{1}“ sem nepatří – {2}", word(type), said(badWord), usage));
  if (o.free.length > FREE[type]) throw new Error(tr("{0}: příliš mnoho čísel ({1}) – {2}", word(type), o.free.length, usage));
  // ── poloha: čísla nebo odkaz (ne obojí)
  const at = o.nums.at ?? [];
  if (at.length > 3) throw new Error(tr("poloha má tři souřadnice: v x y z"));
  if (at.length && s.posRef) throw new Error(tr("poloha je zadaná dvakrát (čísly i odkazem) – použijte jedno"));
  let position: Vec3 = [at[0] ?? 0, at[1] ?? 0, at[2] ?? 0];
  let positionRef: Ref | undefined = s.posRef;
  if (positionRef?.kind === "xyz") {
    position = positionRef.p;
    positionRef = undefined;
  }
  // ── osa: X / Y / Z jako pole `axis`, ostatní jako `dirDef`; „obráceně“ otočí směr
  let dir = s.dir;
  if (o.flags.has("reverse")) {
    const d = dir ?? { kind: "axis", axis: "Z" };
    if (d.kind === "axis") {
      const v: Vec3 = [0, 0, 0];
      v["XYZ".indexOf(d.axis)] = -1;
      dir = { kind: "vector", v };
    } else if (d.kind === "vector") dir = { kind: "vector", v: d.v.map((x) => r6(-x)) as Vec3 };
    else if (d.kind === "twoPoints") dir = { kind: "twoPoints", a: d.b, b: d.a };
    else throw new Error(tr("„obráceně“ jde jen s osou X|Y|Z, vektorem nebo dvěma body – směr hranou / plochou otočte zápisem osa body … nebo vektorem"));
  }
  const axisPart = (): { axis: Axis; dirDef?: Direction } => (!dir ? { axis: "Z" } : dir.kind === "axis" ? { axis: dir.axis } : { axis: "Z", dirDef: dir });
  const ref = positionRef ? { positionRef } : {};
  const mode = opOfOpts(o, said, word(type)) ?? "add";
  const nm = o.words.name?.join(" ");
  const base = { id: uid(), name: named(type, nm) };
  let f: PrimF;
  switch (type) {
    case "box": {
      const [x, y, z] = o.free;
      if (!(x > 0 && y > 0 && z > 0)) throw new Error(tr("kvádr potřebuje tři kladné rozměry: kvádr X Y Z"));
      f = { ...base, type, size: [x, y, z], position, centered: o.flags.has("center"), mode, ...ref, ...(dir ? { dirDef: dir } : {}) };
      break;
    }
    case "cylinder": {
      const [d, h] = o.free;
      if (!(d > 0 && h > 0)) throw new Error(tr("válec potřebuje průměr a výšku: válec D H"));
      f = { ...base, type, radius: d / 2, height: h, position, mode, ...axisPart(), ...ref };
      break;
    }
    case "sphere": {
      const [d] = o.free;
      if (!(d > 0)) throw new Error(tr("koule potřebuje průměr: koule D"));
      f = { ...base, type, radius: d / 2, position, mode, ...ref };
      break;
    }
    case "cone": {
      const [d1, d2, h] = o.free;
      if (!(d1 >= 0 && d2 >= 0 && d1 + d2 > 0 && h > 0)) throw new Error(tr("kužel potřebuje dolní průměr, horní průměr a výšku: kužel D1 D2 H"));
      f = { ...base, type, radius1: d1 / 2, radius2: d2 / 2, height: h, position, mode, ...axisPart(), ...ref };
      break;
    }
    case "tube": {
      const [D, d, h] = o.free;
      if (!(D > 0 && d >= 0 && D > d && h > 0)) throw new Error(tr("trubka potřebuje vnější průměr, vnitřní průměr a výšku: trubka D d H"));
      f = { ...base, type, outer: D, inner: d, height: h, position, mode, ...axisPart(), ...ref };
      break;
    }
    case "spring": {
      const D = o.free[0] ?? o.nums.diameter?.[0];
      const P = s.pitch;
      const L = o.nums.length?.[0];
      const N = s.turns ?? (L !== undefined && P ? L / P : undefined);
      if (!(D !== undefined && D > 0) || !(P !== undefined && P > 0) || !(N !== undefined && N > 0) || !(s.wire !== undefined && s.wire > 0)) throw new Error(tr("pružina potřebuje průměr, stoupání, počet závitů (nebo délku) a průměr drátu: {0}", usage));
      if (s.turns !== undefined && L !== undefined) throw new Error(tr("pružina: zadejte buď počet závitů, nebo délku (délka = stoupání × závity)"));
      f = { ...base, type, radius: D / 2, pitch: P, turns: r6(N), wire: s.wire, position, mode, ...axisPart(), ...ref };
      break;
    }
    case "thread": {
      const des = (o.strings.find((w) => /^m\d/i.test(w)) ?? o.words.thread?.[0] ?? "").replace(/,/g, ".");
      const t = threadByName(des);
      if (!t) throw new Error(tr("závit potřebuje označení M2 až M48 (hrubé nebo jemné stoupání, např. M18×1,5): závit M18×1,5 délka 20 v 0 0 10 [osa Z] [vnitřní] [modelovat]{0}", des ? ` – „${des}“ není metrický závit` : ""));
      const L = o.nums.length?.[0] ?? o.free[0];
      if (!(L > 0)) throw new Error(tr("závit potřebuje délku: závit M18×1,5 délka 20"));
      f = { ...base, type, designation: t.name, position, length: L, modeled: o.flags.has("modeled"), ...axisPart(), ...ref };
      if (o.flags.has("internal")) f.internal = true;
      break;
    }
  }
  const body = bodyOfOpts(o);
  if (body) f.body = body;
  return { k: "feature", feature: f, line };
}

/* ───────────── stav: poloha a osa primitiv ───────────── */

/** „6,650“ → „6,65“, „20,000“ → „20“ */
const trimZeros = (s: string) => s.replace(/([.,]\d*?)0+$/, "$1").replace(/[.,]$/, "");

/** Odkaz na bod textem (stejným zápisem, jakým se zadává). */
export function pointRefText(r: Ref, fmt: (n: number, d?: number) => string, name: (id: string) => string = (x) => x): string {
  switch (r.kind) {
    case "xyz":
      return `[${r.p.map((v) => fmt(v)).join("; ")}]`;
    case "vertex":
      return `V${r.index + 1}`;
    case "face":
      return tr("střed plochy F{0}", r.index + 1);
    case "edge":
      if (r.at === "center") return tr("střed kružnice E{0}", r.index + 1);
      if (r.at === "start") return tr("začátek hrany E{0}", r.index + 1);
      if (r.at === "end") return tr("konec hrany E{0}", r.index + 1);
      if (r.at && typeof r.at === "object") return tr("E{0} v {1} %", r.index + 1, fmt(r.at.t * 100));
      return tr("střed hrany E{0}", r.index + 1);
    case "datumPoint":
      return tr("bod „{0}“", name(r.featureId));
    case "datumAxis":
      return tr("osa „{0}“", name(r.featureId));
    case "csys":
      return r.axis ? tr("osa {0}", r.axis) : tr("počátek");
    case "derived":
      return r.op === "mid" ? tr("mezi {0}", r.args.map((a) => pointRefText(a, fmt, name)).join(" ")) : `${r.op}(${r.args.map((a) => pointRefText(a, fmt, name)).join(", ")})`;
    default:
      return r.kind;
  }
}

/** Osa / směr textem. */
export function axisText(d: Direction, fmt: (n: number, d?: number) => string, name: (id: string) => string = (x) => x): string {
  switch (d.kind) {
    case "axis":
      return d.axis;
    case "vector":
      return `[${d.v.map((v) => trimZeros(fmt(Math.round(v * 1e6) / 1e6, 6))).join("; ")}]`;
    case "edge":
      return d.ref.kind === "datumAxis" ? tr("pomocná osa „{0}“", name(d.ref.featureId)) : d.ref.kind === "edge" ? tr("hrana E{0}", d.ref.index + 1) : pointRefText(d.ref, fmt, name);
    case "faceNormal":
      return d.ref.kind === "face" ? tr("plocha F{0}", d.ref.index + 1) : pointRefText(d.ref, fmt, name);
    case "twoPoints":
      return `${pointRefText(d.a, fmt, name)} → ${pointRefText(d.b, fmt, name)}`;
    default:
      return d.kind;
  }
}

/** Souhrn primitiva pro stav (rozměry, operace, poloha, osa); `null` = jiný prvek. Rozměry a polohy na tisíciny mm (jádro M8 6,647). */
export function primSummary(f: Feature, fmt0: (n: number, d?: number) => string, name: (id: string) => string = (x) => x): string | null {
  if (!(f.type in { box: 1, cylinder: 1, sphere: 1, cone: 1, tube: 1, spring: 1, thread: 1 })) return null;
  const fmt = (n: number, d = 3) => trimZeros(fmt0(n, Math.max(d, 3)));
  const g = f as PrimF;
  const pos = g.positionRef ? pointRefText(g.positionRef, fmt, name) : `[${g.position.map((v) => fmt(v)).join("; ")}]`;
  const dd = "dirDef" in g ? g.dirDef : undefined;
  const ax = dd ? axisText(dd, fmt, name) : "axis" in g ? g.axis : "";
  switch (g.type) {
    case "box":
      return tr("{0} mm{1}, {2}, {3} {4}{5}", g.size.map((v) => fmt(v)).join(" × "), g.centered ? tr(" (střed)") : "", g.mode, g.centered ? tr("střed") : tr("roh"), pos, dd ? tr(", osa Z kvádru {0}", ax) : "");
    case "cylinder":
      return tr("Ø{0} × {1} mm, {2}, podstava {3}, osa {4}", fmt(2 * g.radius), fmt(g.height), g.mode, pos, ax);
    case "sphere":
      return tr("Ø{0} mm, {1}, střed {2}", fmt(2 * g.radius), g.mode, pos);
    case "cone":
      return tr("Ø{0}→Ø{1} × {2} mm, {3}, podstava {4}, osa {5}", fmt(2 * g.radius1), fmt(2 * g.radius2), fmt(g.height), g.mode, pos, ax);
    case "tube":
      return tr("Ø{0}/Ø{1} × {2} mm, {3}, podstava {4}, osa {5}", fmt(g.outer), fmt(g.inner), fmt(g.height), g.mode, pos, ax);
    case "spring":
      return tr("Ø{0}, stoupání {1}, závitů {2}, drát Ø{3} (délka {4} mm), {5}, začátek {6}, osa {7}", fmt(2 * g.radius), fmt(g.pitch, 2), fmt(g.turns, 2), fmt(g.wire, 2), fmt(g.pitch * g.turns), g.mode, pos, ax);
    case "thread":
      return tr("{0} délka {1} mm, {2}, {3}, začátek {4}, osa {5}", threadLabel(g.designation), fmt(g.length), g.internal ? tr("vnitřní (v díře)") : tr("vnější (na válci)"), g.modeled ? tr("modelované drážky") : tr("kosmetický (jen výkres)"), pos, ax);
  }
}

/* ───────────── pomocná geometrie názvem → id ───────────── */
const DATUM_TYPES: Record<string, string[]> = { datum: ["datum"], datumAxis: ["datumAxis", "csys"], datumPoint: ["datumPoint", "csys"] };
/**
 * Odkazy na pomocnou osu / bod / rovinu zadané textem názvem („Osa 1“, „Bod 1“) převede na id prvku (kdekoli v prvku).
 * Neexistující název: `strict` = chyba s výčtem dostupných, jinak se odkaz nechá (stavba ohlásí chybějící pomocnou geometrii).
 * Mění prvek na místě; odkaz, jehož id v dokumentu existuje, nechá být.
 */
export function resolveDatumNames(f: Feature, features: Feature[], strict = true): void {
  const fold2 = (s: string) => fold(s).trim();
  const visit = (v: unknown): void => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(visit);
    const o = v as Record<string, unknown>;
    const types = typeof o.kind === "string" ? DATUM_TYPES[o.kind] : undefined;
    if (types && typeof o.featureId === "string" && !features.some((x) => x.id === o.featureId)) {
      const q = fold2(o.featureId);
      const hit = [...features].reverse().find((x) => types.includes(x.type) && fold2(x.name) === q);
      if (!hit) {
        if (!strict) return;
        const avail = features.filter((x) => types.includes(x.type)).map((x) => x.name);
        throw new Error(tr("„{0}“ v historii není – k dispozici: {1}", o.featureId, avail.join(", ") || "—"));
      }
      o.featureId = hit.id;
    }
    for (const k of Object.keys(o)) if (k !== "featureId") visit(o[k]);
  };
  for (const [k, v] of Object.entries(f)) if (k !== "id" && k !== "name" && k !== "type") visit(v);
}
