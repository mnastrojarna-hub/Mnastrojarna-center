/**
 * Ozubený hřeben (`gear.rack`) – „lineární kolo“: profil = základní hřeben ISO 53 (úsečky + oblouky zaoblení paty ρ_fP, přesně).
 * Šikmý hřeben: normálný profil vysunutý ve směru zubů a oříznutý do kvádru (boky jsou roviny – přesně).
 * Soustava: roztečná přímka podél +X ve výšce h − h_a nad dnem (dno z = 0), šířka y ∈ [0, b], mezera 0 má střed v x = p/2.
 */
import { tr } from "../i18n";
import { alphaRow, handLabel, handRow, moduleRow, widthRow } from "./cylindrical";
import { defaultsOf, fix, fmt, int, loc, num, oneOf, placeRows, rangeIssues, readPlace, row, validation, W, type Place } from "./common";
import { ballAuto, rackPin } from "./measure";
import { DEG, segGreen, segMove } from "./num";
import { RACK_OPTIONS, rackName, rackOf, rackRhoMax, type RackSpec } from "./rack";
import type { GearData, GearDataRow, GearRow, Issue, KindDef, Profile2D, Seg2, Vec2 } from "./types";

export type RackIn = { m: number; z: number; len: number; b: number; h: number; alpha: number; beta: number; hand: "right" | "left"; rackType: string; rack: RackSpec; ballD: number; jn: number; place: Place; raw: GearData };
export type RackC = {
  /** rozteč podél pohybu (čelní) a normálná */
  p: number;
  pn: number;
  n: number;
  L: number;
  ha: number;
  hf: number;
  /** výška roztečné přímky nad dnem */
  h0: number;
  dM: number;
  /** rozměr přes váleček v mezeře od dna */
  M: number;
  /** tloušťka zubu na roztečné přímce (normálná) */
  sn: number;
  /** vzdálenost středu zaoblení paty od osy zubu a polovina šířky dna mezery */
  xc: number;
  rootHalf: number;
};

const rows = (): GearRow[] => [
  moduleRow(tr("Modul mₙ"), tr("normálný modul (ISO 54); rozteč podél hřebene p = π·mₙ / cos β")),
  { ...row("z", tr("Počet zubů"), "int", 40, tr("počet zubů; délka hřebene L = z·p (nebo zadejte délku níže)"), "basic", W("z", "z", "z"), { min: 1, max: 2000, required: true, symbol: "z" }) },
  row("len", tr("Délka L"), "number", 0, tr("0 = z·p; jinak se z délky dopočítá počet zubů z = round(L / p)"), "basic", W(["délka", "len"], ["length", "len"], ["länge", "len"]), { unit: "mm", min: 0 }),
  widthRow(20, tr("šířka hřebene (délka zubu)")),
  row("h", tr("Výška celkem h"), "number", 20, tr("od dna hřebene po hlavu zubu"), "basic", W(["h", "výška"], ["h", "height"], ["h", "höhe"]), { unit: "mm", min: 0.1, required: true, symbol: "h" }),
  alphaRow(),
  row("beta", tr("Úhel sklonu β"), "number", 0, tr("0 = přímé zuby; šikmý hřeben zabírá se šikmým kolem stejného úhlu a opačného smyslu"), "teeth", W(["beta", "sklon"], ["beta", "helix"], ["beta", "schrägung"]), { unit: "°", min: 0, max: 45, symbol: "β" }),
  handRow(tr("smysl sklonu zubů šikmého hřebene")),
  row("rack", tr("Základní profil"), "enum", "A", tr("základní hřeben ISO 53 (typ A = DIN 867): výška paty a zaoblení paty"), "advanced", W(["profil", "rack"], ["rackprofile", "rack"], ["bezugsprofil", "rack"]), { options: RACK_OPTIONS() }),
  row("ha", tr("Výška hlavy h_aP*"), "number", 1, tr("jen vlastní profil: výška hlavy zubu v modulech"), "advanced", W("ha", "ha", "ha"), { min: 0.5, max: 1.5, when: (d) => d.rack === "custom" }),
  row("hf", tr("Výška paty h_fP*"), "number", 1.25, tr("jen vlastní profil: výška paty zubu v modulech"), "advanced", W("hf", "hf", "hf"), { min: 0.8, max: 2, when: (d) => d.rack === "custom" }),
  row("rho", tr("Zaoblení paty ρ_fP*"), "number", 0.38, tr("jen vlastní profil: poloměr zaoblení paty v modulech"), "advanced", W("rho", "rho", "rho"), { min: 0.05, max: 0.5, when: (d) => d.rack === "custom" }),
  row("ballD", tr("Průměr válečku D_M"), "number", 0, tr("průměr měřicího válečku v mezeře; 0 = automaticky 1,728·mₙ zaokrouhleno na 0,25 mm"), "advanced", W(["váleček", "balld"], ["pin", "balld"], ["rolle", "balld"]), { unit: "mm", min: 0, symbol: "D_M" }),
  ...placeRows(),
];

function compute(i: RackIn): RackC {
  const a = i.alpha * DEG;
  const be = i.beta * DEG;
  const pn = Math.PI * i.m;
  const p = pn / Math.cos(be);
  const n = i.len > 0 ? Math.max(1, Math.round(i.len / p)) : i.z;
  const ha = i.rack.ha * i.m;
  const hf = i.rack.hf * i.m;
  const rho = i.rack.rho * i.m;
  const sn = pn / 2 - i.jn / Math.cos(a);
  const xc = sn / 2 + hf * Math.tan(a) + (rho * (1 - Math.sin(a))) / Math.cos(a);
  const dM = i.ballD > 0 ? i.ballD : ballAuto(i.m);
  const h0 = i.h - ha;
  return { p, pn, n, L: n * p, ha, hf, h0, dM, M: rackPin(i.m, i.alpha, dM, h0, i.jn).M, sn, xc, rootHalf: pn / 2 - xc };
}

/** normálný profil jedné rozteče (x podél hřebene po normále k zubům, y výška nad roztečnou přímkou), zleva doprava */
export function rackTooth(i: RackIn, c: RackC): Seg2[] {
  const a = i.alpha * DEG;
  const rho = i.rack.rho * i.m;
  const xa = c.sn / 2 - c.ha * Math.tan(a);
  const cen: Vec2 = [c.xc, -c.hf + rho];
  const T: Vec2 = [cen[0] - rho * Math.cos(a), cen[1] - rho * Math.sin(a)];
  const left: Seg2[] = [
    { t: "line", a: [0, c.ha], b: [xa, c.ha] },
    { t: "line", a: [xa, c.ha], b: T },
    { t: "arc", c: cen, r: rho, a0: Math.PI + a, a1: 1.5 * Math.PI, ccw: true },
  ];
  const mir = (q: Vec2): Vec2 => [c.pn - q[0], q[1]];
  const right: Seg2[] = [
    { t: "arc", c: mir(cen), r: rho, a0: -Math.PI / 2, a1: -a, ccw: true },
    { t: "line", a: mir(T), b: mir([xa, c.ha]) },
    { t: "line", a: mir([xa, c.ha]), b: [c.pn, c.ha] },
  ];
  const mid: Seg2[] = c.rootHalf > 1e-9 ? [{ t: "line", a: [c.xc, -c.hf], b: [c.pn - c.xc, -c.hf] }] : [];
  return [...left, ...mid, ...right];
}

function profile(i: RackIn, c: RackC): Profile2D {
  const tooth = rackTooth(i, c);
  // plocha celého řezu (všechny zuby + tělo až ke dnu): horní obrys zleva doprava + pravý bok, dno, levý bok
  const W_ = c.n * c.pn;
  let g = 0;
  for (let k = 0; k < c.n; k++) for (const s of tooth) g += segGreen(segMove(s, 0, [k * c.pn, 0]));
  const close: Seg2[] = [
    { t: "line", a: [W_, c.ha], b: [W_, -c.h0] },
    { t: "line", a: [W_, -c.h0], b: [0, -c.h0] },
    { t: "line", a: [0, -c.h0], b: [0, c.ha] },
  ];
  for (const s of close) g += segGreen(s);
  return { tooth, count: c.n, pitch: c.pn, circles: { ref: 0, tip: 2 * c.ha, root: -2 * c.hf }, area: Math.abs(g) };
}

function validate(def: { rows: GearRow[] }, i: RackIn) {
  const out: Issue[] = rangeIssues(def.rows, i.raw);
  if (out.some((x) => x.level === "error")) return validation(out);
  const rhoMax = rackRhoMax(i.rack.hf, i.alpha);
  if (i.rack.rho > rhoMax + 1e-9) out.push({ level: "error", code: "rho-max", key: i.rackType === "custom" ? "rho" : "alpha", text: tr("Zaoblení paty ρ = {0}·m se do základního profilu s úhlem {1}° a patou {2}·m nevejde (nejvýš {3}·m).", fmt(i.rack.rho), fmt(i.alpha), fmt(i.rack.hf), fmt(rhoMax, 3)) });
  const c = compute(i);
  if (i.h < c.ha + c.hf + 0.5 * i.m) out.push({ level: "error", code: "h", key: "h", text: tr("Výška hřebene {0} mm je menší než výška zubu s tělem ({1} mm).", fmt(i.h), fmt(c.ha + c.hf + 0.5 * i.m, 2)) });
  if (i.jn > 0.3 * i.m) out.push({ level: "error", code: "jn-max", key: "jn", text: tr("Boční vůle {0} mm je větší než 0,3·m – zub by byl příliš tenký.", fmt(i.jn)) });
  if (c.sn / 2 - c.ha * Math.tan(i.alpha * DEG) <= 0) out.push({ level: "error", code: "pointed", key: "alpha", text: tr("Zub hřebene je špičatý – zmenšete úhel záběru nebo výšku hlavy.") });
  if (i.len > 0 && Math.abs(i.len - c.L) > 1e-6) out.push({ level: "info", code: "len", key: "len", text: tr("Délka se zaokrouhlí na celý počet zubů: {0} zubů = {1} mm.", c.n, fmt(c.L, 3)) });
  if (c.n > 400) out.push({ level: "warn", code: "many", key: "z", text: tr("Hřeben s {0} zuby se bude stavět dlouho – zvažte kratší díl.", c.n) });
  return validation(out);
}

function dataRows(i: RackIn, c: RackC): GearDataRow[] {
  const R = (key: string, label: string, symbol: string, value: string, unit: string, group: GearDataRow["group"]): GearDataRow => ({ key, label, ...(symbol ? { symbol } : {}), value, ...(unit ? { unit } : {}), group });
  const out = [R("m", tr("Modul"), "mₙ", loc(fmt(i.m, 4)), "mm", "basic"), R("z", tr("Počet zubů"), "z", String(c.n), "", "basic"), R("rack", tr("Základní profil"), "", rackName(i.rackType), "", "basic"), R("alpha", tr("Úhel záběru"), "αₙ", fix(i.alpha, 2), "°", "basic")];
  if (i.beta > 0) out.push(R("beta", tr("Úhel sklonu"), "β", `${fix(i.beta, 3)} ${handLabel(i.hand)}`, "°", "basic"));
  out.push(
    R("p", tr("Rozteč podél hřebene"), "p", fix(c.p, 4), "mm", "geometry"),
    R("L", tr("Délka ozubení"), "L", fix(c.L), "mm", "geometry"),
    R("h", tr("Výška celkem"), "h", fix(i.h), "mm", "geometry"),
    R("h0", tr("Výška roztečné přímky"), "h₀", fix(c.h0), "mm", "geometry"),
    R("hz", tr("Výška zubu"), "h_z", fix(c.ha + c.hf), "mm", "geometry"),
    R("sn", tr("Tloušťka zubu"), "sₙ", fix(c.sn), "mm", "check"),
    R("M", tr("Rozměr přes váleček"), "M", fix(c.M), "mm", "check"),
    R("dM", tr("Průměr válečku"), "D_M", fix(c.dM), "mm", "check"),
  );
  return out;
}

const rws = rows();
export const RACK: KindDef<RackIn, RackC> = {
  kind: "rack",
  ext: "gear.rack",
  label: tr("Ozubený hřeben"),
  short: tr("hřeben"),
  standards: ["ISO 53", "ISO 54", "DIN 867"],
  rows: rws,
  phrases: [],
  words: W(["hřeben", "hřebenové"], ["rack"], ["zahnstange"]),
  accuracy: tr("Přesně: celý profil základního hřebene ISO 53 (rovinné boky, kruhové zaoblení paty), i u šikmého hřebene."),
  defaults: () => defaultsOf(rws),
  read: (d): RackIn => {
    const rackType = oneOf(d.rack, ["A", "B", "C", "D", "custom"] as const, "A");
    return {
      m: num(d.m, 2),
      z: Math.max(1, int(d.z, 40)),
      len: Math.max(0, num(d.len)),
      b: num(d.b, 20),
      h: num(d.h, 20),
      alpha: num(d.alpha, 20),
      beta: Math.abs(num(d.beta)),
      hand: oneOf(d.hand, ["right", "left"] as const, "right"),
      rackType,
      rack: rackOf(rackType, { ha: num(d.ha, 1), hf: num(d.hf, 1.25), rho: num(d.rho, 0.38) }),
      ballD: Math.max(0, num(d.ballD)),
      jn: Math.max(0, num(d.jn)),
      place: readPlace(d),
      raw: d,
    };
  },
  validate: (i) => validate(RACK, i),
  compute,
  profile,
  /** boční pohled polotovaru: tyč L × h (šířka b) */
  blank: (i, c) => [[0, 0], [c.L, 0], [c.L, i.h], [0, i.h]],
  dataRows,
  summary: (i, c) => [`${tr("hřeben")} m${fmt(i.m)} z${c.n}${i.beta > 0 ? ` β${fmt(i.beta)}° ${handLabel(i.hand)}` : ""} b${fmt(i.b)} h${fmt(i.h)}`, `L ${fmt(c.L, 3)}`, `p ${fmt(c.p, 4)}`, `M ${fix(c.M)}`, i.place.out === "blank" ? tr("polotovar") : i.place.out === "teeth" ? tr("zuby do tělesa") : tr("hřeben")].join(" · "),
  name: (i) => tr("Ozubený hřeben m{0} z{1}", fmt(i.m), i.len > 0 ? Math.max(1, Math.round(i.len / ((Math.PI * i.m) / Math.cos(i.beta * DEG)))) : i.z),
};
