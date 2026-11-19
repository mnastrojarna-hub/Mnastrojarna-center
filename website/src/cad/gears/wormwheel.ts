/**
 * Šnekové kolo (`gear.wormwheel`) k válcovému šneku ZA (DIN 3975): a = m·(q + z + 2x)/2, d₂ = m·z, d_a2 = d₂ + 2·m·(1 + x),
 * d_f2 = d₂ − 2·m·(1,2 − x), d_e2 = d_a2 + m, poloměr hrdla r_k = a − d_a2/2, úhel sklonu zubů = úhel stoupání šneku γ_m.
 * Řez kola ve střední rovině je evolventní (sdružený s osovým hřebenem šneku) – přesně. Boky mimo střední rovinu jsou
 * evolventní šroubová plocha, NE obálka šneku – přiblížení.
 */
import { tr } from "../i18n";
import { bodyIssues, bodyPhrases, bodyRows, defaultsOf, discSection, fix, fmt, int, loc, mateRows, nf, num, oneOf, placeRows, rangeIssues, readBody, readPlace, row, validation, W, type Place } from "./common";
import { bodySummary, handLabel, handRow, teethRow } from "./cylindrical";
import { cylGeom, cylProfile, pointedRadius, type CylGeom, type CylInput } from "./involute";
import { DEG } from "./num";
import { MODULES } from "./tables";
import type { BodyOpts, GearData, GearDataRow, GearRow, Issue, KindDef, Vec2 } from "./types";

export type WormWheelIn = { m: number; z: number; q: number; z1: number; x: number; hand: "right" | "left"; alpha: number; jn: number; body: BodyOpts; place: Place; mateZ: number; aw: number; raw: GearData };
export type WormWheelC = {
  /** odpovídající šikmé kolo (normálný modul m·cos γ, sklon γ) s hlavou na d_a2 */
  cyl: CylInput;
  g: CylGeom;
  /** totéž s hlavou na vnějším průměru d_e2 (před vybráním hrdla) */
  cylE: CylInput;
  gE: CylGeom;
  gamma: number;
  a: number;
  d2: number;
  da2: number;
  df2: number;
  de2: number;
  rk: number;
  b: number;
  /** zkroucení čelního profilu na mm šířky (rad/mm, se znaménkem smyslu) */
  tau: number;
};

function compute(i: WormWheelIn): WormWheelC {
  const gamma = Math.atan(i.z1 / i.q);
  const cg = Math.cos(gamma);
  const mn = i.m * cg;
  const an = Math.atan(Math.tan(i.alpha * DEG) * cg) / DEG;
  const base = { m: mn, z: i.z, alpha: an, x: i.x / cg, beta: gamma / DEG, jn: i.jn, internal: false };
  const cyl: CylInput = { ...base, rack: { ha: 1 / cg, hf: 1.2 / cg, rho: 0.2 / cg }, k: 0 };
  const cylE: CylInput = { ...base, rack: { ha: 1.5 / cg, hf: 1.2 / cg, rho: 0.2 / cg }, k: 0 };
  const g = cylGeom(cyl);
  const gE = cylGeom(cylE);
  const da2 = i.m * i.z + 2 * i.m * (1 + i.x);
  const a = (i.m * (i.q + i.z + 2 * i.x)) / 2;
  return { cyl, g, cylE, gE, gamma, a, d2: i.m * i.z, da2, df2: i.m * i.z - 2 * i.m * (1.2 - i.x), de2: da2 + i.m, rk: a - da2 / 2, b: i.body.b, tau: ((i.hand === "left" ? -1 : 1) * Math.tan(gamma)) / g.r };
}

const autoB = (m: number, q: number) => Math.round(2 * m * (0.5 + Math.sqrt(q + 1)) * 10) / 10;

const rows = (): GearRow[] => [
  row("m", tr("Modul m"), "number", 2, tr("čelní modul kola = osový modul šneku (DIN 3975); d₂ = m·z"), "basic", W(["m", "modul"], ["m", "module"], ["m", "modul"]), { unit: "mm", min: 0.1, max: 50, required: true, preset: MODULES, symbol: "m" }),
  teethRow(30, 12, tr("počet zubů šnekového kola; převod i = z / z₁"), 300),
  row("q", tr("Součinitel průměru šneku q"), "number", 10, tr("musí odpovídat šneku: střední průměr šneku d_m1 = q·m"), "basic", W("q", "q", "q"), { min: 5, max: 25, required: true, symbol: "q" }),
  row("z1", tr("Počet chodů šneku z₁"), "int", 1, tr("musí odpovídat šneku – určuje úhel sklonu zubů kola"), "basic", W(["z1", "chody"], ["z1", "starts"], ["z1", "gänge"]), { min: 1, max: 6, symbol: "z₁" }),
  row("b", tr("Šířka b"), "number", 0, tr("0 = automaticky 2·m·(0,5 + √(q + 1))"), "basic", W(["b", "šířka"], ["b", "width"], ["b", "breite"]), { unit: "mm", min: 0, symbol: "b" }),
  row("x", tr("Posunutí profilu x"), "number", 0, tr("mění osovou vzdálenost: a = m·(q + z + 2x)/2"), "teeth", W(["x", "posunutí"], ["x", "shift"], ["x", "profilverschiebung"]), { min: -1, max: 1, step: 0.05, symbol: "x" }),
  handRow(tr("šnek i šnekové kolo mají stejný smysl stoupání")),
  row("alpha", tr("Úhel profilu αₓ"), "number", 20, tr("úhel boku šneku v osovém řezu (= čelní úhel záběru kola)"), "teeth", W(["úhel", "alfa", "alpha"], ["angle", "alpha"], ["winkel", "alpha"]), { unit: "°", min: 10, max: 30, symbol: "αₓ" }),
  ...bodyRows({ chamfer: false }),
  ...mateRows().filter((r) => r.key === "aw"),
  ...placeRows(),
];

const rws = rows();
export const WORMWHEEL: KindDef<WormWheelIn, WormWheelC> = {
  kind: "wormwheel",
  ext: "gear.wormwheel",
  label: tr("Šnekové kolo"),
  short: tr("šnekové"),
  standards: ["DIN 3975", "ISO 1122-2", "DIN 6885-1"],
  rows: rws,
  phrases: bodyPhrases(),
  words: W(["šnekové"], ["wormwheel", "wormgear"], ["schneckenrad"]),
  accuracy: tr("Přesně: profil ve střední rovině (evolventa sdružená s osovým profilem šneku ZA), hrdlo a průměry. Přibližně: boky mimo střední rovinu jsou evolventní šroubová plocha, ne obálka šneku – pro zástavbu a výkres, ne pro výrobu ozubení."),
  defaults: () => defaultsOf(rws),
  read: (d): WormWheelIn => {
    const m = num(d.m, 2);
    const q = num(d.q, 10);
    const b = num(d.b) > 0 ? num(d.b) : autoB(m, q);
    return { m, z: int(d.z, 30), q, z1: Math.max(1, int(d.z1, 1)), x: num(d.x), hand: oneOf(d.hand, ["right", "left"] as const, "right"), alpha: num(d.alpha, 20), jn: Math.max(0, num(d.jn)), body: readBody(d, b), place: readPlace(d), mateZ: 0, aw: Math.max(0, num(d.aw)), raw: d };
  },
  validate: (i) => {
    const out: Issue[] = rangeIssues(rws, i.raw);
    if (out.some((x) => x.level === "error")) return validation(out);
    const c = compute(i);
    const err = (key: string, code: string, text: string) => out.push({ level: "error", code, key, text });
    if (c.gamma / DEG > 45) err("z1", "gamma", tr("Úhel stoupání {0}° je větší než 45° – zmenšete počet chodů nebo zvětšete q.", nf(c.gamma / DEG, 1)));
    else {
      if (!(c.gE.thetaA > 0)) err("x", "pointed", tr("Zub je na vnějším průměru Ø{0} špičatý (boky se sejdou na Ø{1}) – zmenšete posunutí x nebo zvětšete počet zubů.", nf(c.de2, 3), nf(2 * pointedRadius(c.gE), 3)));
      if (!(c.rk > 0.5 * i.m)) err("q", "throat", tr("Poloměr hrdla vychází {0} mm – zvětšete q.", nf(c.rk, 2)));
      if (c.g.undercut) out.push({ level: "warn", code: "undercut", key: "z", text: tr("Zuby jsou podřezané (z = {0}): bez podřezání je potřeba posunutí x ≥ {1}. Model podřezání obsahuje tak, jak ho nástroj vyrobí.", i.z, nf(Math.ceil(c.g.xMin * Math.cos(c.gamma) * 100) / 100, 2)) });
      if (i.body.b > 2 * c.rk + i.m) out.push({ level: "warn", code: "wide", key: "b", text: tr("Šířka {0} mm je větší než průměr šneku – boky daleko od střední roviny se šnekem nezabírají.", nf(i.body.b)) });
      out.push(...bodyIssues(i.body, { rootR: c.df2 / 2, tipR: c.de2 / 2, m: i.m }));
    }
    if (i.jn > 0.3 * i.m) err("jn", "jn-max", tr("Boční vůle {0} mm je větší než 0,3·m – zub by byl příliš tenký.", nf(i.jn)));
    return validation(out);
  },
  compute,
  profile: (i, c) => cylProfile(c.cyl, c.g),
  blank: (i, c): Vec2[] => {
    // disk Ø d_e2 × b s hrdlem: oblouk r_k se středem ve vzdálenosti a od osy kola, ve střední rovině
    const sec = discSection(i.body, { tipR: c.de2 / 2, rootR: c.df2 / 2, m: i.m });
    const k = sec.findIndex((p, n) => Math.abs(p[0] - c.de2 / 2) < 1e-9 && Math.abs(sec[(n + 1) % sec.length][0] - c.de2 / 2) < 1e-9);
    const hz = Math.sqrt(Math.max(0, c.rk * c.rk - (c.a - c.de2 / 2) ** 2)); // polovina výšky hrdla na vnějším průměru
    if (k < 0 || !(hz > 0)) return sec;
    const n = 16;
    const arc: Vec2[] = Array.from({ length: n + 1 }, (_, j) => {
      const zz = -hz + (2 * hz * j) / n;
      return [c.a - Math.sqrt(Math.max(0, c.rk * c.rk - zz * zz)), i.body.b / 2 + zz] as Vec2;
    });
    sec.splice(k + 1, 0, ...arc);
    return sec;
  },
  dataRows: (i, c): GearDataRow[] => {
    const R = (key: string, label: string, symbol: string, value: string, unit: string, group: GearDataRow["group"]): GearDataRow => ({ key, label, ...(symbol ? { symbol } : {}), value, ...(unit ? { unit } : {}), group });
    return [
      R("m", tr("Modul"), "m", loc(fmt(i.m, 4)), "mm", "basic"),
      R("z", tr("Počet zubů"), "z₂", String(i.z), "", "basic"),
      R("z1", tr("Počet chodů šneku"), "z₁", String(i.z1), "", "pair"),
      R("q", tr("Součinitel průměru šneku"), "q", loc(fmt(i.q, 3)), "", "pair"),
      R("ratio", tr("Převod"), "i", fix(i.z / i.z1, 3), "", "pair"),
      R("alpha", tr("Úhel profilu"), "αₓ", fix(i.alpha, 2), "°", "basic"),
      R("gamma", tr("Úhel sklonu zubů"), "γ_m", fix(c.gamma / DEG, 4), "°", "basic"),
      R("hand", tr("Smysl stoupání"), "", handLabel(i.hand), "", "basic"),
      R("x", tr("Posunutí profilu"), "x", fix(i.x, 4), "", "basic"),
      R("d2", tr("Roztečný průměr"), "d₂", fix(c.d2), "mm", "geometry"),
      R("da2", tr("Hlavový průměr (v hrdle)"), "d_a2", fix(c.da2), "mm", "geometry"),
      R("de2", tr("Vnější průměr"), "d_e2", fix(c.de2), "mm", "geometry"),
      R("df2", tr("Patní průměr"), "d_f2", fix(c.df2), "mm", "geometry"),
      R("rk", tr("Poloměr hrdla"), "r_k", fix(c.rk), "mm", "geometry"),
      R("a", tr("Osová vzdálenost"), "a", fix(c.a), "mm", "pair"),
    ];
  },
  summary: (i, c) => [`${tr("šnekové")} m${nf(i.m)} z${i.z} q${nf(i.q)} z₁${i.z1} ${handLabel(i.hand)} b${nf(i.body.b)}`, `d₂ ${nf(c.d2, 3)}`, `d_e ${nf(c.de2, 3)}`, `a ${nf(c.a, 3)}`, bodySummary(i.body, i.place)].join(" · "),
  name: (i) => tr("Šnekové kolo m{0} z{1}", fmt(i.m), i.z),
};
