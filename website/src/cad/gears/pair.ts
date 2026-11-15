/**
 * Soukolí: z jedné tabulky (z₁, z₂, modul, osová vzdálenost, posunutí…) spočítá obě kola, jejich polohu v sestavě a vazbu.
 *
 * Válcová soukolí (ISO 21771 / DIN 3960): a = m_t·(z₁ + z₂)/2, inv α_wt = inv α_t + 2·tan α_n·(x₁ + x₂)/(z₁ + z₂),
 * a_w = a·cos α_t / cos α_wt; zadaná a_w → Σx = (z₁ + z₂)·(inv α_wt − inv α_t)/(2·tan α_n). Rozdělení Σx podle DIN 3992
 * (jak ho uvádí Roloff/Matek): x₁ = Σx/2 + (0,5 − Σx/2)·lg(u)/lg(z₁·z₂/100), u = z₂/z₁. Zkrácení hlavy k = Σx − (a_w − a)/mₙ
 * drží hlavovou vůli 0,25·m. ε_α = [√(r_a1² − r_b1²) + √(r_a2² − r_b2²) − a_w·sin α_wt] / p_bt, ε_β = b·sin β/(π·mₙ).
 * Vnitřní soukolí: (z₂ − z₁) a (x₂ − x₁) místo součtů.
 */
import { eulerXYZ, type Mat3 } from "../assembly";
import { tr } from "../i18n";
import type { Vec3 } from "../types";
import { fix, fmt, int, loc, num, oneOf, row, W } from "./common";
import { alphaRow, handRow, moduleRow, widthRow } from "./cylindrical";
import { cylGeom, type CylInput } from "./involute";
import { DEG, inv, invInverse } from "./num";
import { RACKS } from "./rack";
import { KINDS, type AnyKind } from "./registry";
import { CHAIN_NAMES, CHAINS, BELT_NAMES, HTD, TBELTS } from "./tables";
import type { GearData, GearDataRow, GearExt, GearRow, Issue, PairInput, PairKind, PairResult, PairWheel } from "./types";

const z1Row = (def: number, hint: string) => row("z1", tr("Zuby kola 1 (z₁)"), "int", def, hint, "basic", W("z1", "z1", "z1"), { min: 1, max: 400, required: true, symbol: "z₁" });
const z2Row = (def: number, hint: string) => row("z2", tr("Zuby kola 2 (z₂)"), "int", def, hint, "basic", W("z2", "z2", "z2"), { min: 0, max: 2000, required: true, symbol: "z₂" });
const ratioRow = () => row("i", tr("Převod i"), "number", 0, tr("když není zadané z₂: z₂ = zaokrouhlené i·z₁ (0 = použít z₂)"), "basic", W(["i", "převod"], ["i", "ratio"], ["i", "übersetzung"]), { min: 0, symbol: "i" });
const jnRow = () => row("jn", tr("Boční vůle celkem"), "number", 0, tr("normálná boční vůle soukolí; 0 = automaticky 0,04·mₙ (polovina na každé kolo)"), "advanced", W(["vůle", "jn"], ["backlash", "jn"], ["spiel", "jn"]), { unit: "mm", min: 0, symbol: "jₙ" });
const boreRows = () => [
  row("bore1", tr("Díra kola 1"), "number", 0, tr("0 = automaticky asi čtvrtina roztečného průměru (řada 5, 6, 8, 10, 12, 16, 20, 25, 30…)"), "body", W(["díra1", "bore1"], "bore1", ["bohrung1", "bore1"]), { unit: "mm", min: 0 }),
  row("bore2", tr("Díra kola 2"), "number", 0, tr("0 = automaticky asi čtvrtina roztečného průměru"), "body", W(["díra2", "bore2"], "bore2", ["bohrung2", "bore2"]), { unit: "mm", min: 0 }),
];
const aRow = (hint: string) => row("a", tr("Osová vzdálenost a"), "number", 0, hint, "basic", W(["a", "osová"], ["a", "centre", "center"], ["a", "achsabstand"]), { unit: "mm", min: 0, symbol: "a_w" });

const cylRows = (kind: "spur" | "helical" | "herringbone" | "internal"): GearRow[] => [
  z1Row(20, kind === "internal" ? tr("počet zubů pastorku") : tr("počet zubů pastorku (menšího kola)")),
  z2Row(60, kind === "internal" ? tr("počet zubů věnce s vnitřním ozubením") : tr("počet zubů kola")),
  ratioRow(),
  moduleRow(tr("Modul mₙ"), tr("normálný modul (ISO 54), společný oběma kolům")),
  ...(kind === "spur" ? [] : [row("beta", tr("Úhel sklonu β"), "number", kind === "internal" ? 0 : 15, tr("úhel sklonu zubů; vnější kola mají opačný smysl stoupání, vnitřní soukolí stejný"), "basic", W(["beta", "sklon"], ["beta", "helix"], ["beta", "schrägung"]), { unit: "°", min: 0, max: 45, symbol: "β" }), handRow(tr("smysl stoupání kola 1"))]),
  aRow(tr("0 = spočítat z posunutí; zadaná hodnota → součet posunutí Σx se dopočítá a rozdělí na obě kola")),
  row("x1", tr("Posunutí x₁"), "number", 0, tr("posunutí profilu kola 1 (při automatickém rozdělení se přepíše)"), "teeth", W("x1", "x1", "x1"), { min: -1, max: 1.2, step: 0.05, symbol: "x₁" }),
  row("x2", tr("Posunutí x₂"), "number", 0, tr("posunutí profilu kola 2 (při automatickém rozdělení se přepíše)"), "teeth", W("x2", "x2", "x2"), { min: -1, max: 1.2, step: 0.05, symbol: "x₂" }),
  row("xAuto", tr("Posunutí rozdělit automaticky"), "bool", true, tr("rozdělí Σx podle DIN 3992 a u malých počtů zubů odstraní podřezání"), "teeth", W(["auto", "xauto"], ["auto", "xauto"], ["auto", "xauto"])),
  alphaRow(),
  jnRow(),
  widthRow(20, tr("šířka kola 2; pastorek je o 0,5·m širší")),
  ...boreRows(),
];

/** řádky tabulky soukolí podle druhu */
export const PAIR_ROWS: Record<PairKind, GearRow[]> = {
  spur: cylRows("spur"),
  helical: cylRows("helical"),
  herringbone: cylRows("herringbone"),
  internal: cylRows("internal"),
  rack: [z1Row(20, tr("počet zubů pastorku")), z2Row(40, tr("počet zubů hřebene")), moduleRow(tr("Modul mₙ"), tr("normálný modul (ISO 54)")), row("beta", tr("Úhel sklonu β"), "number", 0, tr("0 = přímé zuby"), "teeth", W(["beta", "sklon"], ["beta", "helix"], ["beta", "schrägung"]), { unit: "°", min: 0, max: 45 }), handRow(tr("smysl stoupání pastorku (hřeben má opačný)")), row("x1", tr("Posunutí x₁"), "number", 0, tr("posunutí profilu pastorku – zvedne osu pastorku nad hřeben o x·m"), "teeth", W("x1", "x1", "x1"), { min: -1, max: 1.2 }), alphaRow(), jnRow(), widthRow(20, tr("šířka hřebene; pastorek je o 0,5·m širší")), row("h", tr("Výška hřebene h"), "number", 20, tr("od dna hřebene po hlavu zubu"), "basic", W(["h", "výška"], ["h", "height"], ["h", "höhe"]), { unit: "mm", min: 1 }), boreRows()[0]],
  bevel: [
    z1Row(16, tr("počet zubů pastorku")),
    z2Row(32, tr("počet zubů kola")),
    row("m", tr("Vnější čelní modul m"), "number", 2, tr("modul na velkém konci (ISO 23509)"), "basic", W(["m", "modul"], ["m", "module"], ["m", "modul"]), { unit: "mm", min: 0.1, max: 50, required: true }),
    row("sigma", tr("Úhel os Σ"), "number", 90, tr("úhel, který svírají osy obou kol"), "basic", W(["sigma", "osy"], ["sigma", "shaftangle"], ["sigma", "achswinkel"]), { unit: "°", min: 60, max: 120 }),
    row("betaM", tr("Střední úhel sklonu β_m"), "number", 0, tr("0 = přímé zuby; zakřivené zuby mívají 35°"), "teeth", W(["beta", "sklon"], ["beta", "spiral"], ["beta", "spiralwinkel"]), { unit: "°", min: 0, max: 45 }),
    handRow(tr("smysl stoupání pastorku (kolo má opačný)")),
    row("x1", tr("Posunutí x₁"), "number", 0, tr("výškové posunutí pastorku; kolo dostane stejné záporné"), "teeth", W("x1", "x1", "x1"), { min: -0.6, max: 0.6 }),
    alphaRow(),
    jnRow(),
    row("b", tr("Šířka ozubení b"), "number", 0, tr("0 = automaticky menší z R_e/3 a 10·m"), "basic", W(["b", "šířka"], ["b", "width"], ["b", "breite"]), { unit: "mm", min: 0 }),
    ...boreRows(),
  ],
  hypoid: [
    z1Row(11, tr("počet zubů pastorku")),
    z2Row(41, tr("počet zubů talířového kola")),
    row("de2", tr("Vnější roztečný Ø kola"), "number", 200, tr("vnější roztečný průměr talířového kola"), "basic", W(["de2", "průměr"], ["de2", "diameter"], ["de2", "durchmesser"]), { unit: "mm", min: 10, required: true }),
    row("b", tr("Šířka ozubení kola b"), "number", 0, tr("0 = automaticky 0,15·d_e2"), "basic", W(["b", "šířka"], ["b", "width"], ["b", "breite"]), { unit: "mm", min: 0 }),
    row("E", tr("Přesazení os E"), "number", 25, tr("vzdálenost mimoběžných os"), "basic", W(["e", "přesazení"], ["e", "offset"], ["e", "achsversatz"]), { unit: "mm", min: 0, required: true }),
    row("betaM1", tr("Střední úhel sklonu pastorku"), "number", 45, tr("úhel sklonu zubů pastorku ve středu šířky"), "teeth", W(["beta", "sklon"], ["beta", "spiral"], ["beta", "spiralwinkel"]), { unit: "°", min: 20, max: 55 }),
    handRow(tr("smysl stoupání pastorku (kolo má opačný)")),
    alphaRow(),
    jnRow(),
    ...boreRows(),
  ],
  worm: [
    row("m", tr("Modul m"), "number", 2, tr("osový modul šneku = čelní modul kola (DIN 3975)"), "basic", W(["m", "modul"], ["m", "module"], ["m", "modul"]), { unit: "mm", min: 0.1, max: 50, required: true }),
    row("q", tr("Součinitel průměru q"), "number", 10, tr("střední průměr šneku d_m1 = q·m"), "basic", W("q", "q", "q"), { min: 5, max: 25, required: true }),
    row("z1", tr("Počet chodů šneku z₁"), "int", 1, tr("počet chodů šneku"), "basic", W(["z1", "chody"], ["z1", "starts"], ["z1", "gänge"]), { min: 1, max: 6, required: true }),
    z2Row(30, tr("počet zubů šnekového kola; převod i = z₂/z₁")),
    row("x", tr("Posunutí profilu x"), "number", 0, tr("posunutí kola: a = m·(q + z₂ + 2x)/2"), "teeth", W(["x", "posunutí"], ["x", "shift"], ["x", "profilverschiebung"]), { min: -1, max: 1 }),
    handRow(tr("smysl stoupání (šnek i kolo stejný)")),
    alphaRow(tr("úhel profilu šneku v osovém řezu")),
    jnRow(),
    row("L", tr("Délka závitu šneku"), "number", 0, tr("0 = automaticky (11 + 0,06·z₂)·m"), "basic", W(["l", "délka"], ["l", "length"], ["l", "länge"]), { unit: "mm", min: 0 }),
    row("bore2", tr("Díra kola"), "number", 0, tr("0 = automaticky asi čtvrtina roztečného průměru"), "body", W(["díra2", "bore2"], "bore2", ["bohrung2", "bore2"]), { unit: "mm", min: 0 }),
  ],
  cycloid: [z1Row(8, tr("počet lístků pastorku")), z2Row(60, tr("počet zubů kola")), { ...moduleRow(tr("Modul m"), tr("modul hodinového ozubení (BS 978-2)"), 1), symbol: "m" }, widthRow(3, tr("šířka kola; pastorek je dvakrát širší")), ...boreRows()],
  cyclodisc: [
    row("N", tr("Počet čepů N"), "int", 10, tr("počet čepů věnce; převod je N − 1"), "basic", W(["n", "čepy"], ["n", "pins"], ["n", "bolzen"]), { min: 4, max: 120, required: true }),
    row("pinCircle", tr("Roztečný Ø čepů D_p"), "number", 60, tr("průměr kružnice os čepů"), "basic", W(["dp", "rozteč"], ["dp", "pincircle"], ["dp", "teilkreis"]), { unit: "mm", min: 5, required: true }),
    row("pinD", tr("Ø čepu d_p"), "number", 6, tr("průměr čepu věnce"), "basic", W(["čep", "pind"], ["pin", "pind"], ["bolzen-d", "pind"]), { unit: "mm", min: 0.5, required: true }),
    row("e", tr("Výstřednost e"), "number", 1.5, tr("výstřednost hřídele (kotouč je posunutý o e)"), "basic", W(["e", "výstřednost"], ["e", "eccentricity"], ["e", "exzentrizität"]), { unit: "mm", min: 0.05, required: true }),
    widthRow(10, tr("tloušťka kotouče a věnce")),
    row("centerD", tr("Ø díry pro ložisko"), "number", 0, tr("středová díra kotouče; 0 = automaticky třetina patního průměru"), "body", W(["ložisko", "centerd"], ["bearing", "centerd"], ["lager", "centerd"]), { unit: "mm", min: 0 }),
  ],
  sprocket: [
    row("chain", tr("Řetěz"), "enum", "08B", tr("válečkový řetěz podle ISO 606"), "basic", W(["řetěz", "chain"], "chain", ["kette", "chain"]), { required: true, options: CHAIN_NAMES.map((k) => ({ v: k, l: k })) }),
    z1Row(19, tr("počet zubů malého kola")),
    z2Row(38, tr("počet zubů velkého kola")),
    row("rows", tr("Počet řad"), "int", 1, tr("simplex 1, duplex 2, triplex 3"), "basic", W(["řady", "rows"], ["strands", "rows"], ["reihen", "rows"]), { min: 1, max: 3 }),
    aRow(tr("0 = automaticky asi 40 roztečí; skutečná vzdálenost se upraví na sudý počet článků řetězu")),
    ...boreRows(),
  ],
  pulley: [
    row("profile", tr("Profil řemene"), "enum", "5M", tr("HTD 3M–14M nebo T5 / T10"), "basic", W(["profil", "řemen"], ["profile", "belt"], ["profil", "riemen"]), { required: true, options: BELT_NAMES.map((k) => ({ v: k, l: HTD[k] ? `HTD ${k}` : k })) }),
    z1Row(20, tr("počet zubů malé řemenice")),
    z2Row(40, tr("počet zubů velké řemenice")),
    row("w", tr("Šířka řemene"), "number", 15, tr("šířka řemene"), "basic", W(["w", "šířka"], ["w", "width"], ["w", "breite"]), { unit: "mm", min: 2 }),
    aRow(tr("0 = automaticky; skutečná vzdálenost se upraví na celý počet zubů řemene")),
    ...boreRows(),
  ],
};

const BORES = [3, 4, 5, 6, 8, 10, 12, 15, 16, 20, 25, 30, 35, 40, 50, 60, 70, 80, 100, 120, 140, 160];
/** výchozí díra: největší z řady nepřesahující čtvrtinu roztečného průměru (a s rezervou pod patou zubu) */
export function autoBore(d: number, rootD: number, m: number): number {
  const lim = Math.min(0.25 * d + 1e-9, rootD - 5 * m);
  const ok = BORES.filter((b) => b <= lim);
  return ok.length ? ok[ok.length - 1] : 0;
}

const R = (key: string, label: string, symbol: string, value: string, unit: string, group: GearDataRow["group"] = "pair"): GearDataRow => ({ key, label, ...(symbol ? { symbol } : {}), value, ...(unit ? { unit } : {}), group });
const rotOf = (cols: [Vec3, Vec3, Vec3]): Vec3 => {
  const [x, y, z] = cols;
  const m: Mat3 = [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
  return eulerXYZ(m).map((v) => Math.round(v * 1e4) / 1e4 || 0) as Vec3;
};
const r4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;

/** jedno kolo páru: výchozí data druhu + změny; `label` = název dílu (záložky) bez označení velikosti */
function wheel(kind: AnyKind, patch: GearData, label: string): PairWheel {
  // jen klíče, které druh zná (např. β u čelního pastorku vnitřního soukolí) – `prvek gear.*` by jiné odmítl
  const base = kind.defaults();
  const data: GearData = { ...base };
  for (const [k, v] of Object.entries(patch)) if (k in base) data[k] = v;
  // označení velikosti převzít z názvu prvku („Ozubené kolo m2 z20“ → „m2 z20“)
  const size = /(\S*\d.*)$/u.exec(String(kind.name(kind.read(data))))?.[1] ?? "";
  return { ext: kind.ext as GearExt, name: `${label} ${size}`.trim(), data };
}
/** hlášky jednoho kola do hlášek soukolí (chyby a varování s označením kola) */
function wheelIssues(kind: AnyKind, w: PairWheel, n: number, keyMap: Record<string, string>): Issue[] {
  return kind.validate(kind.read(w.data)).issues.filter((x) => x.level !== "info").map((x) => ({ ...x, key: x.key ? (keyMap[x.key] ?? x.key) : undefined, text: tr("Kolo {0}: {1}", n, x.text) }));
}
const fail = (issues: Issue[], asmName: string): PairResult => ({ ok: false, issues, rows: [], wheels: [{ ext: "gear.spur", name: "", data: {} }, { ext: "gear.spur", name: "", data: {} }], placement: [{ at: [0, 0, 0], rot: [0, 0, 0] }, { at: [0, 0, 0], rot: [0, 0, 0] }], mate: { kind: "gear", flip: false, faceA: "", faceB: "" }, asmName });
const done = (issues: Issue[], rows: GearDataRow[], wheels: [PairWheel, PairWheel], placement: PairResult["placement"], mate: PairResult["mate"], asmName: string): PairResult => ({ ok: !issues.some((x) => x.level === "error"), issues, rows, wheels, placement, mate, asmName });
const err = (key: string, code: string, text: string): Issue => ({ level: "error", code, key, text });
const warn = (key: string, code: string, text: string): Issue => ({ level: "warn", code, key, text });

/** z₂ ze zadání: zadaný převod i > 0 má přednost (z₂ = zaokrouhlené i·z₁), jinak z₂ */
const teeth2 = (v: GearData, z1: number) => (num(v.i) > 0 ? Math.max(1, Math.round(num(v.i) * z1)) : int(v.z2));

// ---------------- válcová soukolí ----------------

export type CylPair = {
  a0: number;
  aw: number;
  alphaWt: number;
  sumX: number;
  x1: number;
  x2: number;
  k: number;
  y: number;
  dw1: number;
  dw2: number;
  epsA: number;
  epsB: number;
  /** hlavová vůle (menší z obou) */
  c: number;
};
/** mez podřezání jednoho kola (základní profil ISO 53 A) */
const xMinOf = (z: number, an: number, be: number) => {
  const at = Math.atan(Math.tan(an) / Math.cos(be));
  return 1.25 - 0.38 * (1 - Math.sin(an)) - (z * Math.sin(at) ** 2) / (2 * Math.cos(be));
};

/** Výpočet válcového soukolí (vnější i vnitřní). `aw` > 0 = zadaná osová vzdálenost. */
export function cylPair(o: { z1: number; z2: number; m: number; alpha: number; beta: number; internal: boolean; aw: number; x1: number; x2: number; auto: boolean; b: number }): CylPair {
  const an = o.alpha * DEG;
  const be = o.beta * DEG;
  const at = Math.atan(Math.tan(an) / Math.cos(be));
  const mt = o.m / Math.cos(be);
  const zs = o.internal ? o.z2 - o.z1 : o.z1 + o.z2;
  const a0 = (mt * zs) / 2;
  let x1 = o.x1;
  let x2 = o.x2;
  let sumX: number; // vnější: x₁ + x₂; vnitřní: x₂ − x₁
  let awt: number;
  let aw: number;
  if (o.aw > 0) {
    aw = o.aw;
    awt = Math.acos(Math.max(-1, Math.min(1, (a0 * Math.cos(at)) / aw)));
    sumX = (zs * (inv(awt) - inv(at))) / (2 * Math.tan(an));
    if (o.internal) {
      if (o.auto) x1 = 0;
      x2 = sumX + x1;
    } else if (o.auto) {
      const u = o.z2 / o.z1;
      x1 = u > 1 && o.z1 * o.z2 > 100 ? sumX / 2 + ((0.5 - sumX / 2) * Math.log10(u)) / Math.log10((o.z1 * o.z2) / 100) : sumX / 2;
      x1 = Math.max(x1, Math.min(xMinOf(o.z1, an, be), sumX - xMinOf(o.z2, an, be)));
      x2 = sumX - x1;
    } else x2 = sumX - x1;
  } else {
    if (o.auto && !o.internal) {
      // bez zadané osové vzdálenosti: jen odstranit podřezání pastorku, kolo dostane opačné posunutí (osová vzdálenost se nemění)
      x1 = Math.max(0, Math.ceil(xMinOf(o.z1, an, be) * 100) / 100);
      x2 = Math.max(-x1, Math.ceil(xMinOf(o.z2, an, be) * 100) / 100);
    } else if (o.auto) {
      x1 = Math.max(0, Math.ceil(xMinOf(o.z1, an, be) * 100) / 100);
      x2 = x1;
    }
    sumX = o.internal ? x2 - x1 : x1 + x2;
    awt = invInverse(inv(at) + (2 * Math.tan(an) * sumX) / zs);
    aw = (a0 * Math.cos(at)) / Math.cos(awt);
  }
  const y = (aw - a0) / o.m;
  const k = o.internal ? 0 : Math.max(0, sumX - y);
  const g1 = cylGeom({ m: o.m, z: o.z1, alpha: o.alpha, x: x1, beta: o.beta, rack: RACKS.A, k, jn: 0, internal: false });
  const g2 = cylGeom({ m: o.m, z: o.z2, alpha: o.alpha, x: x2, beta: o.beta, rack: RACKS.A, k: 0, jn: 0, internal: o.internal });
  const ra2 = o.internal ? g2.ra : g2.ra - k * o.m;
  const t1 = Math.sqrt(Math.max(0, g1.ra ** 2 - g1.rb ** 2));
  const t2 = Math.sqrt(Math.max(0, ra2 ** 2 - g2.rb ** 2));
  const epsA = (o.internal ? t1 - t2 + aw * Math.sin(awt) : t1 + t2 - aw * Math.sin(awt)) / g1.pbt;
  const c = o.internal ? Math.min(g2.rf - aw - g1.ra, aw + g1.rf - ra2) : Math.min(aw - g1.ra - g2.rf, aw - ra2 - g1.rf);
  return { a0, aw, alphaWt: awt, sumX, x1, x2, k, y, dw1: o.internal ? (2 * aw * o.z1) / zs : (2 * aw * o.z1) / zs, dw2: (2 * aw * o.z2) / zs, epsA, epsB: (o.b * Math.sin(be)) / (Math.PI * o.m), c };
}

function solveCyl(kind: "spur" | "helical" | "herringbone" | "internal", v: GearData): PairResult {
  const z1 = int(v.z1, 20);
  const z2 = teeth2(v, z1);
  const m = num(v.m, 2);
  const alpha = num(v.alpha, 20);
  const beta = kind === "spur" ? 0 : Math.abs(num(v.beta, kind === "internal" ? 0 : 15));
  const hand = oneOf(v.hand, ["right", "left"] as const, "right");
  const internal = kind === "internal";
  const b = num(v.b, 20);
  const asmName = tr("Soukolí m{0} z{1}/z{2}", fmt(m), z1, z2);
  const issues: Issue[] = [];
  if (!(m > 0)) issues.push(err("m", "m", tr("Modul musí být kladný.")));
  if (!(z1 >= 5)) issues.push(err("z1", "z1", tr("Kolo 1 musí mít aspoň 5 zubů.")));
  if (!(z2 >= 5)) issues.push(err("z2", "z2", tr("Kolo 2 musí mít aspoň 5 zubů (zadejte z₂ nebo převod i).")));
  if (internal && z2 - z1 < 1) issues.push(err("z2", "int", tr("Věnec musí mít víc zubů než pastorek.")));
  if (!(b > 0)) issues.push(err("b", "b", tr("Šířka kola musí být kladná.")));
  const a0 = ((m / Math.cos(beta * DEG)) * (internal ? z2 - z1 : z1 + z2)) / 2;
  const awIn = num(v.a);
  if (awIn > 0 && Math.abs(awIn - a0) > 1.5 * m) issues.push(err("a", "a-range", tr("Osová vzdálenost {0} mm je příliš daleko od jmenovité {1} mm – posunutím profilu lze upravit nejvýš asi ±1,5·m.", fmt(awIn, 3), fmt(a0, 3))));
  if (issues.length) return fail(issues, asmName);
  const p = cylPair({ z1, z2, m, alpha, beta, internal, aw: awIn, x1: num(v.x1), x2: num(v.x2), auto: v.xAuto === undefined ? true : v.xAuto === true || v.xAuto === "true", b });
  const jn = num(v.jn) > 0 ? num(v.jn) : 0.04 * m;
  const K1 = KINDS[internal ? "spur" : kind];
  const K2 = KINDS[kind];
  const hand2 = internal ? hand : hand === "right" ? "left" : "right";
  const common = { m, alpha, ...(kind === "spur" ? {} : { beta }), jn: r4(jn / 2), aw: r4(p.aw) };
  const d1 = (m * z1) / Math.cos(beta * DEG);
  const d2 = (m * z2) / Math.cos(beta * DEG);
  const g1 = cylGeom({ m, z: z1, alpha, x: p.x1, beta, rack: RACKS.A, k: p.k, jn: 0, internal: false });
  const g2 = cylGeom({ m, z: z2, alpha, x: p.x2, beta, rack: RACKS.A, k: p.k, jn: 0, internal });
  const bore1 = num(v.bore1) > 0 ? num(v.bore1) : autoBore(d1, g1.df, m);
  const bore2 = internal ? 0 : num(v.bore2) > 0 ? num(v.bore2) : autoBore(d2, g2.df, m);
  // vnitřní pastorek je čelní kolo (u šikmého vnitřního soukolí šikmé se stejným smyslem)
  const Kp = internal && beta > 0 ? KINDS.helical : K1;
  const w1 = wheel(Kp, { ...common, ...(internal && beta > 0 ? { beta } : {}), z: z1, x: r4(p.x1), k: r4(p.k), b: b + 0.5 * m, bore: bore1, mateZ: z2, ...(Kp.kind !== "spur" ? { hand } : {}) }, tr("Pastorek"));
  const w2 = wheel(K2, { ...common, z: z2, x: r4(p.x2), k: internal ? 0 : r4(p.k), b, ...(internal ? {} : { bore: bore2 }), mateZ: z1, ...(kind === "spur" ? {} : { hand: hand2 }) }, internal ? tr("Věnec") : tr("Kolo"));
  issues.push(...wheelIssues(Kp, w1, 1, { x: "x1", z: "z1", bore: "bore1", k: "x1" }), ...wheelIssues(K2, w2, 2, { x: "x2", z: "z2", bore: "bore2", k: "x2" }));
  if (p.epsA < 1) issues.push(err("z1", "eps", tr("Součinitel záběru profilu ε_α = {0} je menší než 1 – zuby by ztrácely záběr. Zvětšete počty zubů nebo zmenšete posunutí.", fix(p.epsA, 3))));
  else if (p.epsA < 1.2) issues.push(warn("z1", "eps-low", tr("Součinitel záběru profilu ε_α = {0} je menší než 1,2 – chod bude hlučnější.", fix(p.epsA, 3))));
  if (p.c < 0.15 * m - 1e-9) issues.push(warn("a", "clearance", tr("Hlavová vůle {0} mm je menší než 0,15·m.", fix(p.c, 3))));
  if (internal && z2 - z1 < 10) issues.push(warn("z2", "int-diff", tr("Rozdíl počtů zubů věnce a pastorku je menší než 10 – hrozí kolize hlav zubů (přesně se nekontroluje).")));
  if (!internal) {
    // kolize hlavy jednoho kola s přechodovou křivkou druhého: začátek činného profilu d_A ≥ d_Ff
    const awt = p.alphaWt;
    const chk = (ga: typeof g1, gb: typeof g2, za: number, zb: number, n: number, key: string) => {
      const tA = Math.tan(awt) - (zb / za) * (Math.tan(Math.acos(Math.min(1, gb.rb / gb.ra))) - Math.tan(awt));
      const dA = tA <= 0 ? ga.db : ga.db / Math.cos(Math.atan(tA));
      if (dA < ga.dFf - 1e-6) issues.push(warn(key, "interference", tr("Kolo {0}: hlava protikola zasahuje pod začátek evolventy (Ø{1} < Ø{2}) – hrozí kolize v patě. Zvětšete posunutí tohoto kola.", n, fix(dA, 3), fix(ga.dFf, 3))));
    };
    chk(g1, g2, z1, z2, 1, "x1");
    chk(g2, g1, z2, z1, 2, "x2");
  }
  const rows: GearDataRow[] = [
    R("i", tr("Převod"), "i", fix(z2 / z1, 4), ""),
    R("a0", tr("Osová vzdálenost bez posunutí"), "a", fix(p.a0), "mm"),
    R("aw", tr("Osová vzdálenost"), "a_w", fix(p.aw), "mm"),
    R("alphaW", tr("Provozní úhel záběru"), "α_wt", fix(p.alphaWt / DEG, 4), "°"),
    R("sumX", internal ? tr("Rozdíl posunutí x₂ − x₁") : tr("Součet posunutí"), "Σx", fix(p.sumX, 4), ""),
    R("x1", tr("Posunutí kola 1"), "x₁", fix(p.x1, 4), ""),
    R("x2", tr("Posunutí kola 2"), "x₂", fix(p.x2, 4), ""),
    R("k", tr("Zkrácení hlavy"), "k", fix(p.k, 4), ""),
    R("dw1", tr("Valivý průměr kola 1"), "d_w1", fix(p.dw1), "mm"),
    R("dw2", tr("Valivý průměr kola 2"), "d_w2", fix(p.dw2), "mm"),
    R("epsA", tr("Součinitel záběru profilu"), "ε_α", fix(p.epsA, 4), "", "check"),
    ...(beta > 0 ? [R("epsB", tr("Součinitel záběru krokem"), "ε_β", fix(p.epsB, 4), "", "check")] : []),
    R("c", tr("Hlavová vůle"), "c", fix(p.c), "mm", "check"),
    R("jn", tr("Boční vůle"), "jₙ", fix(jn), "mm", "check"),
  ];
  const mate = { kind: "gear" as const, teeth: [z1, z2] as [number, number], flip: internal, faceA: `Ø${loc(fmt(bore1, 3))}`, faceB: internal ? `Ø${loc(fmt(num(w2.data.rimD) || (g2.df + 2 * Math.max(2.5 * m, 8)), 3))}` : `Ø${loc(fmt(bore2, 3))}` };
  // vnější: zub 0 kola 1 míří na +X, kolo 2 v (a_w, 0, 0) otočené tak, aby na −X mířila mezera; vnitřní: věnec v počátku, pastorek v (a_w, 0, 0)
  const placement: PairResult["placement"] = internal ? [{ at: [r4(p.aw), 0, 0], rot: [0, 0, 0] }, { at: [0, 0, 0], rot: [0, 0, 0] }] : [{ at: [0, 0, 0], rot: [0, 0, 0] }, { at: [r4(p.aw), 0, 0], rot: [0, 0, r4(180 - 180 / z2)] }];
  if (!bore1 || (!internal && !bore2)) issues.push(warn(!bore1 ? "bore1" : "bore2", "no-bore", tr("Kolo je bez díry – vazba ozubení potřebuje válcovou plochu (díru); zadejte průměr díry.")));
  return done(issues, rows, [w1, w2], placement, mate, asmName);
}

// ---------------- hřeben ----------------

function solveRack(v: GearData): PairResult {
  const z1 = int(v.z1, 20);
  const n = Math.max(1, int(v.z2, 40));
  const m = num(v.m, 2);
  const beta = Math.abs(num(v.beta));
  const hand = oneOf(v.hand, ["right", "left"] as const, "right");
  const alpha = num(v.alpha, 20);
  const b = num(v.b, 20);
  const h = num(v.h, 20);
  const x1 = num(v.x1);
  const jn = num(v.jn) > 0 ? num(v.jn) : 0.04 * m;
  const asmName = tr("Pastorek s hřebenem m{0} z{1}", fmt(m), z1);
  if (!(m > 0) || !(z1 >= 5)) return fail([err(!(m > 0) ? "m" : "z1", "in", tr("Zadejte kladný modul a aspoň 5 zubů pastorku."))], asmName);
  const Kp = beta > 0 ? KINDS.helical : KINDS.spur;
  const d1 = (m * z1) / Math.cos(beta * DEG);
  const g1 = cylGeom({ m, z: z1, alpha, x: x1, beta, rack: RACKS.A, k: 0, jn: 0, internal: false });
  const bore1 = num(v.bore1) > 0 ? num(v.bore1) : autoBore(d1, g1.df, m);
  const b1 = b + 0.5 * m;
  const w1 = wheel(Kp, { m, z: z1, alpha, x: x1, ...(beta > 0 ? { beta, hand } : {}), b: b1, bore: bore1, jn: r4(jn / 2) }, tr("Pastorek"));
  const w2 = wheel(KINDS.rack, { m, z: n, alpha, beta, hand: hand === "right" ? "left" : "right", b, h, jn: r4(jn / 2) }, tr("Hřeben"));
  const issues = [...wheelIssues(Kp, w1, 1, { x: "x1", z: "z1", bore: "bore1" }), ...wheelIssues(KINDS.rack, w2, 2, { z: "z2" })];
  const pt = (Math.PI * m) / Math.cos(beta * DEG);
  const h0 = h - m;
  const y0 = (b - b1) / 2;
  // směr zubů hřebene (s·sin β, cos β): pravý hřeben s = +1; hřeben má opačný smysl než pastorek
  const s = hand === "right" ? -1 : 1;
  const at: Vec3 = [r4(pt / 2 + s * Math.tan(beta * DEG) * y0), r4(y0), r4(h0 + d1 / 2 + x1 * m)];
  // pastorek: osa (místní +Z) → +Y, zub 0 (místní +X) → −Z (dolů do mezery hřebene)
  const rot = rotOf([[0, 0, -1], [-1, 0, 0], [0, 1, 0]]);
  const rows = [R("i", tr("Posuv hřebene na otáčku"), "", fix(Math.PI * d1), "mm"), R("d1", tr("Roztečný průměr pastorku"), "d", fix(d1), "mm"), R("p", tr("Rozteč podél hřebene"), "p", fix(pt, 4), "mm"), R("ah", tr("Výška osy pastorku nade dnem hřebene"), "", fix(at[2]), "mm"), R("L", tr("Délka hřebene"), "L", fix(n * pt), "mm"), R("jn", tr("Boční vůle"), "jₙ", fix(jn), "mm", "check")];
  if (!bore1) issues.push(warn("bore1", "no-bore", tr("Kolo je bez díry – vazba ozubení potřebuje válcovou plochu (díru); zadejte průměr díry.")));
  return done(issues, rows, [w1, w2], [{ at, rot }, { at: [0, 0, 0], rot: [0, 0, 0] }], { kind: "rack", module: r4(m / Math.cos(beta * DEG)), teeth: [z1, n], flip: false, faceA: `Ø${loc(fmt(bore1, 3))}`, faceB: tr("spodní") }, asmName);
}

// ---------------- kuželové, hypoidní, šnekové ----------------

function solveBevel(v: GearData): PairResult {
  const z1 = int(v.z1, 16);
  const z2 = teeth2(v, z1);
  const m = num(v.m, 2);
  const sigma = num(v.sigma, 90);
  const hand = oneOf(v.hand, ["right", "left"] as const, "right");
  const jn = num(v.jn) > 0 ? num(v.jn) : 0.05 * m;
  const asmName = tr("Kuželové soukolí m{0} z{1}/z{2}", fmt(m), z1, z2);
  const base = { m, sigma, alpha: num(v.alpha, 20), betaM: Math.abs(num(v.betaM)), jn: r4(jn / 2) };
  const K = KINDS.bevel;
  // společná šířka: menší z automatických šířek obou kol
  const bOf = (z: number, zm: number) => (K.compute(K.read({ ...K.defaults(), ...base, z, zMate: zm })) as { b: number }).b;
  const b = num(v.b) > 0 ? num(v.b) : Math.min(bOf(z1, z2), bOf(z2, z1));
  const mk = (z: number, zm: number, x: number, hnd: string, boreIn: number, label: string) => {
    const pre = { ...K.defaults(), ...base, z, zMate: zm, x, hand: hnd, b };
    const c = K.compute(K.read(pre)) as { geom: { rFront: number } };
    const lim = 2 * c.geom.rFront - 3 * m;
    const auto = BORES.filter((q) => q <= Math.min(0.25 * m * z, lim));
    return wheel(K, { ...base, z, zMate: zm, x, hand: hnd, b, bore: boreIn > 0 ? boreIn : (auto[auto.length - 1] ?? 0) }, label);
  };
  const w1 = mk(z1, z2, num(v.x1), hand, num(v.bore1), tr("Pastorek"));
  const w2 = mk(z2, z1, -num(v.x1), hand === "right" ? "left" : "right", num(v.bore2), tr("Kolo"));
  const issues = [...wheelIssues(K, w1, 1, { x: "x1", z: "z1", bore: "bore1" }), ...wheelIssues(K, w2, 2, { x: "x1", z: "z2", bore: "bore2" })];
  const c1 = K.compute(K.read(w1.data)) as { delta: number; Re: number };
  const c2 = K.compute(K.read(w2.data)) as { delta: number };
  const rows = [R("i", tr("Převod"), "i", fix(z2 / z1, 4), ""), R("sigma", tr("Úhel os"), "Σ", fix(sigma, 2), "°"), R("delta1", tr("Úhel roztečného kužele pastorku"), "δ₁", fix(c1.delta / DEG, 4), "°"), R("delta2", tr("Úhel roztečného kužele kola"), "δ₂", fix(c2.delta / DEG, 4), "°"), R("Re", tr("Délka površky kužele"), "R_e", fix(c1.Re), "mm"), R("b", tr("Šířka ozubení"), "b", fix(b, 2), "mm"), R("jn", tr("Boční vůle"), "jₙ", fix(jn), "mm", "check")];
  // oba vrcholy v počátku; kolo 2 otočené kolem Y o −Σ a kolem vlastní osy tak, aby na společné površce ležela mezera
  const placement: PairResult["placement"] = [{ at: [0, 0, 0], rot: [0, 0, 0] }, { at: [0, 0, 0], rot: [0, r4(-sigma), r4(180 - 180 / z2)] }];
  const b1 = num(w1.data.bore);
  const b2 = num(w2.data.bore);
  if (!b1 || !b2) issues.push(warn(!b1 ? "bore1" : "bore2", "no-bore", tr("Kolo je bez díry – vazba ozubení potřebuje válcovou plochu (díru); zadejte průměr díry.")));
  return done(issues, rows, [w1, w2], placement, { kind: "gear", teeth: [z1, z2], flip: false, faceA: `Ø${loc(fmt(b1, 3))}`, faceB: `Ø${loc(fmt(b2, 3))}` }, asmName);
}

function solveHypoid(v: GearData): PairResult {
  const K = KINDS.hypoid;
  const z1 = int(v.z1, 11);
  const z2 = teeth2(v, z1);
  const base = { z1, z2, de2: num(v.de2, 200), b: Math.max(0, num(v.b)), E: num(v.E, 25), betaM1: num(v.betaM1, 45), hand: oneOf(v.hand, ["right", "left"] as const, "right"), alpha: num(v.alpha, 20) };
  const asmName = tr("Hypoidní soukolí z{0}/z{1}", z1, z2);
  const pre = K.compute(K.read({ ...K.defaults(), ...base })) as { mean: { mmn: number; P: Vec3; apex1: Vec3; apex2: Vec3 } | null };
  if (!pre.mean) return fail(K.validate(K.read({ ...K.defaults(), ...base })).issues, asmName);
  const jn = num(v.jn) > 0 ? num(v.jn) : 0.06 * pre.mean.mmn;
  const mk = (member: string, boreIn: number, label: string) => {
    const d0 = { ...K.defaults(), ...base, member, jn: r4(jn / 2) };
    const c = K.compute(K.read(d0)) as { geom: { rFront: number; de: number } | null };
    const lim = c.geom ? 2 * c.geom.rFront - 3 * pre.mean!.mmn : 0;
    const auto = BORES.filter((q) => q <= Math.min(0.25 * (c.geom?.de ?? 0), lim));
    return wheel(K, { ...base, member, jn: r4(jn / 2), bore: boreIn > 0 ? boreIn : (auto[auto.length - 1] ?? 0) }, label);
  };
  const w1 = mk("pinion", num(v.bore1), tr("Pastorek"));
  const w2 = mk("wheel", num(v.bore2), tr("Talířové kolo"));
  const issues = [...wheelIssues(K, w1, 1, { bore: "bore1" }), ...wheelIssues(K, w2, 2, { bore: "bore2" })];
  const mean = pre.mean;
  // soustava soukolí: osa kola Z přes počátek, osa pastorku ∥ X přes (0, E, 0). Místní +Z každého členu míří od zadního čela k vrcholu.
  const zw = mean.apex2[2] >= mean.P[2] ? 1 : -1; // kolo: místní +Z = ±Z
  const xp = mean.apex1[0] >= mean.P[0] ? 1 : -1; // pastorek: místní +Z = ±X
  // fáze: střední bod P leží na ose zubu pastorku a v mezeře kola (pootočení kolem vlastní osy)
  const phiP = Math.atan2(mean.P[1], mean.P[0]);
  const th = zw > 0 ? phiP - Math.PI / z2 : phiP + Math.PI / z2;
  const rotW: Vec3 = zw > 0 ? [0, 0, r4(th / DEG)] : rotOf([[Math.cos(th), Math.sin(th), 0], [Math.sin(th), -Math.cos(th), 0], [0, 0, -1]]);
  // pastorek: místní Z → ±X, místní X → směr od osy pastorku k P
  const q: Vec3 = [0, mean.P[1] - base.E, mean.P[2]];
  const ql = Math.hypot(q[1], q[2]) || 1;
  const xl: Vec3 = [0, q[1] / ql, q[2] / ql];
  const zl: Vec3 = [xp, 0, 0];
  const yl: Vec3 = [zl[1] * xl[2] - zl[2] * xl[1], zl[2] * xl[0] - zl[0] * xl[2], zl[0] * xl[1] - zl[1] * xl[0]];
  const rows = [R("i", tr("Převod"), "u", fix(z2 / z1, 4), ""), R("E", tr("Přesazení os"), "E", fix(base.E), "mm"), R("mmn", tr("Střední normálný modul"), "m_mn", fix(mean.mmn, 4), "mm"), R("jn", tr("Boční vůle"), "jₙ", fix(jn), "mm", "check")];
  issues.push({ level: "info", code: "hypoid-approx", text: tr("Boky hypoidních zubů jsou jmenovité (nejsou sdružené) – mimo střední bod záběru čekejte několik setin mm mezery nebo přesahu.") });
  const b1 = num(w1.data.bore);
  const b2 = num(w2.data.bore);
  if (!b1 || !b2) issues.push(warn(!b1 ? "bore1" : "bore2", "no-bore", tr("Kolo je bez díry – vazba ozubení potřebuje válcovou plochu (díru); zadejte průměr díry.")));
  return done(issues, rows, [w1, w2], [{ at: [0, r4(base.E), 0], rot: rotOf([xl, yl, zl]) }, { at: [0, 0, 0], rot: rotW }], { kind: "gear", teeth: [z1, z2], flip: false, faceA: `Ø${loc(fmt(b1, 3))}`, faceB: `Ø${loc(fmt(b2, 3))}` }, asmName);
}

function solveWorm(v: GearData): PairResult {
  const m = num(v.m, 2);
  const q = num(v.q, 10);
  const z1 = Math.max(1, int(v.z1, 1));
  const z2 = int(v.z2, 30);
  const x = num(v.x);
  const hand = oneOf(v.hand, ["right", "left"] as const, "right");
  const alpha = num(v.alpha, 20);
  const jn = num(v.jn) > 0 ? num(v.jn) : 0.04 * m;
  const asmName = tr("Šnekové soukolí m{0} z{1}/z{2}", fmt(m), z1, z2);
  const L = num(v.L) > 0 ? num(v.L) : Math.round((11 + 0.06 * z2) * m);
  const df1 = q * m - 2.4 * m;
  const shaftD = Math.max(2, Math.floor(df1 - 0.5));
  const w1 = wheel(KINDS.worm, { m, q, z1, L, hand, alpha, jn: r4(jn / 2), shaftD, shaftL: Math.round(2 * m) }, tr("Šnek"));
  const a = (m * (q + z2 + 2 * x)) / 2;
  const d2 = m * z2;
  const bore2 = num(v.bore2) > 0 ? num(v.bore2) : autoBore(d2, d2 - 2.4 * m, m);
  const w2 = wheel(KINDS.wormwheel, { m, z: z2, q, z1, x, hand, alpha, jn: r4(jn / 2), bore: bore2, aw: r4(a) }, tr("Šnekové kolo"));
  const issues = [...wheelIssues(KINDS.worm, w1, 1, {}), ...wheelIssues(KINDS.wormwheel, w2, 2, { bore: "bore2", z: "z2" })];
  const bw = num((KINDS.wormwheel.read(w2.data) as { body: { b: number } }).body.b);
  // kolo v počátku (osa Z, střední rovina z = b/2); šnek: osa ∥ Y ve vzdálenosti a na +X, střed délky závitu ve střední rovině kola
  // šnek: osa (místní +Z) → +Y, mezera závitu ve středu délky (místní +X) → −X, ke kolu
  const rot = rotOf([[-1, 0, 0], [0, 0, 1], [0, 1, 0]]);
  const rows = [R("i", tr("Převod"), "i", fix(z2 / z1, 3), ""), R("a", tr("Osová vzdálenost"), "a", fix(a), "mm"), R("gamma", tr("Úhel stoupání"), "γ_m", fix(Math.atan(z1 / q) / DEG, 4), "°"), R("L", tr("Délka závitu šneku"), "L", fix(L, 1), "mm"), R("jn", tr("Boční vůle"), "jₙ", fix(jn), "mm", "check")];
  if (!bore2) issues.push(warn("bore2", "no-bore", tr("Kolo je bez díry – vazba ozubení potřebuje válcovou plochu (díru); zadejte průměr díry.")));
  return done(issues, rows, [w1, w2], [{ at: [r4(a), r4(-L / 2), r4(bw / 2)], rot }, { at: [0, 0, 0], rot: [0, 0, 0] }], { kind: "gear", teeth: [z1, z2], flip: false, faceA: `Ø${loc(fmt(shaftD, 3))}`, faceB: `Ø${loc(fmt(bore2, 3))}` }, asmName);
}

// ---------------- cykloidní, řetěz, řemen ----------------

function solveCycloid(v: GearData): PairResult {
  const zp = int(v.z1, 8);
  const zw = teeth2(v, zp);
  const m = num(v.m, 1);
  const b = num(v.b, 3);
  const K = KINDS.cycloid;
  const asmName = tr("Cykloidní soukolí m{0} z{1}/z{2}", fmt(m), zp, zw);
  const dp = m * zp;
  const dw = m * zw;
  const w1 = wheel(K, { m, z: zp, zMate: zw, type: "pinion", b: 2 * b, bore: num(v.bore1) > 0 ? num(v.bore1) : autoBore(dp, dp - 4 * m, m) }, tr("Pastorek"));
  const w2 = wheel(K, { m, z: zw, zMate: zp, type: "wheel", b, bore: num(v.bore2) > 0 ? num(v.bore2) : autoBore(dw, dw - 4 * m, m) }, tr("Kolo"));
  const issues = [...wheelIssues(K, w1, 1, { z: "z1", bore: "bore1" }), ...wheelIssues(K, w2, 2, { z: "z2", bore: "bore2" })];
  const a = (dp + dw) / 2;
  const rows = [R("i", tr("Převod"), "i", fix(zw / zp, 4), ""), R("a", tr("Osová vzdálenost"), "a", fix(a), "mm")];
  const b1 = num(w1.data.bore);
  const b2 = num(w2.data.bore);
  if (!b1 || !b2) issues.push(warn(!b1 ? "bore1" : "bore2", "no-bore", tr("Kolo je bez díry – vazba ozubení potřebuje válcovou plochu (díru); zadejte průměr díry.")));
  return done(issues, rows, [w1, w2], [{ at: [0, 0, r4(-b / 2)], rot: [0, 0, 0] }, { at: [r4(a), 0, 0], rot: [0, 0, r4(180 - 180 / zw)] }], { kind: "gear", teeth: [zp, zw], flip: false, faceA: `Ø${loc(fmt(b1, 3))}`, faceB: `Ø${loc(fmt(b2, 3))}` }, asmName);
}

function solveCycloDisc(v: GearData): PairResult {
  const K = KINDS.cyclodisc;
  const base = { N: int(v.N, 10), pinCircle: num(v.pinCircle, 60), pinD: num(v.pinD, 6), e: num(v.e, 1.5), b: num(v.b, 10) };
  const asmName = tr("Cykloidní reduktor N{0}", base.N);
  const df = base.pinCircle - 2 * base.e - base.pinD;
  const centerD = num(v.centerD) > 0 ? num(v.centerD) : Math.max(0, Math.round(df / 3));
  const w1 = wheel(K, { ...base, part: "disc", centerD }, tr("Kotouč"));
  const w2 = wheel(K, { ...base, part: "ring" }, tr("Věnec"));
  const issues = [...wheelIssues(K, w1, 1, {}), ...wheelIssues(K, w2, 2, {})];
  const c = K.compute(K.read(w2.data)) as { ringD: number };
  const rows = [R("i", tr("Převod (věnec stojí)"), "i", String(base.N - 1), ""), R("e", tr("Výstřednost"), "e", fix(base.e), "mm")];
  issues.push({ level: "info", code: "cyclo-mate", text: tr("Kotouč je vložen posunutý o výstřednost e; výstředníkový hřídel a unašeč doplňte jako další díly a spojte je vazbami sami.") });
  void c;
  // kotouč posunutý o e ve směru +X: jeho údolí na +X dosedne na čep 0 věnce; vazbu (planetový pohyb) si uživatel doplní sám
  return done(issues, rows, [w1, w2], [{ at: [r4(base.e), 0, 0], rot: [0, 0, 0] }, { at: [0, 0, 0], rot: [0, 0, 0] }], { kind: "gear", ratio: base.N - 1, flip: true, faceA: "", faceB: "" }, asmName);
}

function solveFlex(kind: "sprocket" | "pulley", v: GearData): PairResult {
  const z1 = int(v.z1, kind === "sprocket" ? 19 : 20);
  const z2 = teeth2(v, z1);
  const K = KINDS[kind];
  const chain = String(v.chain ?? "08B").toUpperCase();
  const profile = String(v.profile ?? "5M").toUpperCase().replace(/^HTD\s*/, "");
  const p = kind === "sprocket" ? (CHAINS[chain]?.p ?? 12.7) : (HTD[profile]?.p ?? TBELTS[profile]?.p ?? 5);
  const base = kind === "sprocket" ? { chain: CHAINS[chain] ? chain : "08B", rows: Math.min(3, Math.max(1, int(v.rows, 1))) } : { profile, w: num(v.w, 15) };
  const asmName = kind === "sprocket" ? tr("Řetězový převod {0} z{1}/z{2}", base.chain as string, z1, z2) : tr("Řemenový převod {0} z{1}/z{2}", profile, z1, z2);
  const dOf = (z: number) => (kind === "sprocket" ? p / Math.sin(Math.PI / z) : (z * p) / Math.PI);
  const mk = (z: number, zm: number, boreIn: number, label: string) => wheel(K, { ...base, z, ...(kind === "sprocket" ? { mateZ: zm } : {}), bore: boreIn > 0 ? boreIn : autoBore(dOf(z), dOf(z) - 2 * p, p / Math.PI) }, label);
  // délka řetězu / řemene v roztečích: X = 2a/p + (z₁ + z₂)/2 + ((z₂ − z₁)/(2π))²·p/a → zaokrouhlit (řetěz na sudý počet) a dopočítat a
  const aIn = num(v.a) > 0 ? num(v.a) : (kind === "sprocket" ? 40 : 30) * p + (dOf(z2) - dOf(z1)) / 2;
  const kk = ((z2 - z1) / (2 * Math.PI)) ** 2;
  const X0 = (2 * aIn) / p + (z1 + z2) / 2 + (kk * p) / aIn;
  const X = kind === "sprocket" ? 2 * Math.round(X0 / 2) : Math.round(X0);
  const q = X - (z1 + z2) / 2;
  const a = (p / 4) * (q + Math.sqrt(Math.max(0, q * q - 8 * kk)));
  const w1 = mk(z1, z2, num(v.bore1), kind === "sprocket" ? tr("Malé kolo") : tr("Malá řemenice"));
  const w2 = mk(z2, z1, num(v.bore2), kind === "sprocket" ? tr("Velké kolo") : tr("Velká řemenice"));
  if (kind === "sprocket") {
    w1.data.aw = r4(a);
    w2.data.aw = r4(a);
  }
  const issues = [...wheelIssues(K, w1, 1, { z: "z1", bore: "bore1" }), ...wheelIssues(K, w2, 2, { z: "z2", bore: "bore2" })];
  if (a < (dOf(z1) + dOf(z2)) / 2 + p) issues.push(err("a", "a-min", tr("Osová vzdálenost {0} mm je příliš malá – kola by se dotýkala.", fix(a, 2))));
  const rows = [R("i", tr("Převod"), "i", fix(z2 / z1, 4), ""), R("a", tr("Osová vzdálenost"), "a", fix(a), "mm"), R("X", kind === "sprocket" ? tr("Počet článků řetězu") : tr("Počet zubů řemene"), "X", String(X), ""), R("Lp", kind === "sprocket" ? tr("Délka řetězu") : tr("Délka řemene"), "L", fix(X * p, 2), "mm")];
  const b1 = num(w1.data.bore);
  const b2 = num(w2.data.bore);
  if (!b1 || !b2) issues.push(warn(!b1 ? "bore1" : "bore2", "no-bore", tr("Kolo je bez díry – vazba ozubení potřebuje válcovou plochu (díru); zadejte průměr díry.")));
  return done(issues, rows, [w1, w2], [{ at: [0, 0, 0], rot: [0, 0, 0] }, { at: [r4(a), 0, 0], rot: [0, 0, 0] }], { kind: "gear", teeth: [z1, z2], flip: true, faceA: `Ø${loc(fmt(b1, 3))}`, faceB: `Ø${loc(fmt(b2, 3))}` }, asmName);
}

/** Vyřeší soukolí: kontrola, výsledné řádky, data obou kol, poloha v sestavě a vazba. */
export function solvePair(input: PairInput): PairResult {
  // chybějící řádky = výchozí hodnoty tabulky soukolí (prázdné z₂ při zadaném převodu i řeší `teeth2`)
  const v: GearData = { ...pairDefaults(input.kind), ...(input.values ?? {}) };
  switch (input.kind) {
    case "spur":
    case "helical":
    case "herringbone":
    case "internal":
      return solveCyl(input.kind, v);
    case "rack":
      return solveRack(v);
    case "bevel":
      return solveBevel(v);
    case "hypoid":
      return solveHypoid(v);
    case "worm":
      return solveWorm(v);
    case "cycloid":
      return solveCycloid(v);
    case "cyclodisc":
      return solveCycloDisc(v);
    case "sprocket":
    case "pulley":
      return solveFlex(input.kind, v);
    default:
      return fail([err("", "kind", tr("Neznámý druh soukolí „{0}“.", String(input.kind)))], "");
  }
}
/** výchozí hodnoty tabulky soukolí */
export const pairDefaults = (kind: PairKind): GearData => Object.fromEntries(PAIR_ROWS[kind].map((r) => [r.key, r.def]));
export type { CylInput };
