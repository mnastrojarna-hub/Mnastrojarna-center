/**
 * Válcový šnek (`gear.worm`), tvar boku ZA podle DIN 3975 / ISO 1122-2: v osovém řezu přímkový (lichoběžníkový) profil,
 * bok je šroubová plocha vzniklá šroubovým pohybem osového profilu. d_m1 = q·m, p_x = π·m, p_z = z1·p_x, tan γ_m = z1/q,
 * d_a1 = d_m1 + 2·m, d_f1 = d_m1 − 2,4·m. Čelní řez šneku tvoří Archimédovy spirály (bod osového profilu (x, r) leží
 * v čelní rovině na úhlu θ = ∓2π·x/p_z).
 */
import { tr } from "../i18n";
import { bodyPhrases, boreReach, boreRootText, defaultsOf, fix, fmt, int, loc, nf, num, oneOf, placeRows, rangeIssues, readBody, readPlace, row, validation, W, type Place } from "./common";
import { handLabel, handRow } from "./cylindrical";
import { arcSweep, curveSeg, DEG, polar, segGreen, segMove, segReverse, TAU } from "./num";
import { MODULES } from "./tables";
import type { BodyOpts, GearData, GearDataRow, GearRow, Issue, KindDef, Profile2D, Seg2, Vec2 } from "./types";

export type WormIn = { m: number; q: number; z1: number; L: number; hand: "right" | "left"; alpha: number; shaftD: number; shaftL: number; jn: number; body: BodyOpts; place: Place; raw: GearData };
export type WormC = {
  px: number;
  pz: number;
  /** úhel stoupání na středním válci (rad) */
  gamma: number;
  dm: number;
  da: number;
  df: number;
  mn: number;
  /** osová tloušťka závitu na středním válci */
  sx: number;
  L: number;
  ha: number;
  hf: number;
  rho: number;
  /** vzdálenost středu zaoblení paty od osy závitu, polovina šířky dna mezery */
  xc: number;
  rootHalf: number;
};

function compute(i: WormIn): WormC {
  const px = Math.PI * i.m;
  const a = i.alpha * DEG;
  const gamma = Math.atan(i.z1 / i.q);
  const ha = i.m;
  const hf = 1.2 * i.m;
  const rho = 0.2 * i.m;
  const sx = px / 2 - i.jn / Math.cos(a);
  const xc = sx / 2 + hf * Math.tan(a) + (rho * (1 - Math.sin(a))) / Math.cos(a);
  const dm = i.q * i.m;
  return { px, pz: i.z1 * px, gamma, dm, da: dm + 2 * ha, df: dm - 2 * hf, mn: i.m * Math.cos(gamma), sx, L: i.L > 0 ? i.L : 14 * i.m, ha, hf, rho, xc, rootHalf: px / 2 - xc };
}

/** osový profil jedné rozteče (x podél osy, y nad středním válcem): závit má osu v x = 0 a x = p_x, mezera uprostřed */
export function wormAxial(i: WormIn, c: WormC): Seg2[] {
  const a = i.alpha * DEG;
  const xa = c.sx / 2 - c.ha * Math.tan(a);
  const cen: Vec2 = [c.xc, -c.hf + c.rho];
  const T: Vec2 = [cen[0] - c.rho * Math.cos(a), cen[1] - c.rho * Math.sin(a)];
  const mir = (q: Vec2): Vec2 => [c.px - q[0], q[1]];
  const mid: Seg2[] = c.rootHalf > 1e-9 ? [{ t: "line", a: [c.xc, -c.hf], b: [c.px - c.xc, -c.hf] }] : [];
  return [
    { t: "line", a: [0, c.ha], b: [xa, c.ha] },
    { t: "line", a: [xa, c.ha], b: T },
    { t: "arc", c: cen, r: c.rho, a0: Math.PI + a, a1: 1.5 * Math.PI, ccw: true },
    ...mid,
    { t: "arc", c: mir(cen), r: c.rho, a0: -Math.PI / 2, a1: -a, ccw: true },
    { t: "line", a: mir(T), b: mir([xa, c.ha]) },
    { t: "line", a: mir([xa, c.ha]), b: [c.px, c.ha] },
  ];
}

/**
 * Čelní profil šneku (z1 „zubů“; mezera závitu má střed na +X) – pro šroubové tažení v jádře. Bod osového profilu (x, y)
 * se zobrazí na poloměr r_m + y a úhel θ = ∓2π·(x − p_x/2)/p_z (pravý šnek −, levý +).
 */
export function wormTransverse(i: WormIn, c: WormC): Profile2D {
  const rm = c.dm / 2;
  const sign = i.hand === "left" ? 1 : -1;
  const map = (q: Vec2): Vec2 => polar(rm + q[1], (sign * TAU * (q[0] - c.px / 2)) / c.pz);
  // proti směru hodin: pravý šnek prochází osový profil pozpátku
  const ax = sign > 0 ? wormAxial(i, c) : wormAxial(i, c).map(segReverse).reverse();
  const tooth: Seg2[] = ax.map((s): Seg2 => {
    if (s.t === "line") {
      if (Math.abs(s.a[1] - s.b[1]) < 1e-12) {
        // hlava / dno: oblouk kružnice
        const pa = map(s.a);
        const pb = map(s.b);
        return { t: "arc", c: [0, 0], r: rm + s.a[1], a0: Math.atan2(pa[1], pa[0]), a1: Math.atan2(pb[1], pb[0]), ccw: true };
      }
      return curveSeg("spiral", (u) => map([s.a[0] + (s.b[0] - s.a[0]) * u, s.a[1] + (s.b[1] - s.a[1]) * u]), 0, 1, 8);
    }
    const sw = arcSweep(s as Extract<Seg2, { t: "arc" }>);
    const arc = s as Extract<Seg2, { t: "arc" }>;
    return curveSeg("spiral", (u) => map([arc.c[0] + arc.r * Math.cos(arc.a0 + sw * u), arc.c[1] + arc.r * Math.sin(arc.a0 + sw * u)]), 0, 1, 6);
  });
  // oblouky hlavy a dna přes ±π u jednochodého šneku: úhly držet spojité
  let area = 0;
  for (const s of tooth) area += segGreen(s);
  return { tooth, count: i.z1, circles: { ref: c.dm, tip: c.da, root: c.df }, area: Math.abs(i.z1 * area) };
}

const rows = (): GearRow[] => [
  row("m", tr("Osový modul mₓ"), "number", 2, tr("osový modul šneku = čelní modul šnekového kola (DIN 3975); osová rozteč pₓ = π·m"), "basic", W(["m", "modul"], ["m", "module"], ["m", "modul"]), { unit: "mm", min: 0.1, max: 50, required: true, preset: MODULES, symbol: "mₓ" }),
  row("q", tr("Součinitel průměru q"), "number", 10, tr("střední průměr šneku d_m1 = q·m (řada DIN 3976: 6,3 až 17, běžně 10)"), "basic", W("q", "q", "q"), { min: 5, max: 25, required: true, preset: [6.3, 8, 10, 12.5, 16], symbol: "q" }),
  row("z1", tr("Počet chodů z₁"), "int", 1, tr("počet chodů (závitů) šneku; stoupání p_z = z₁·pₓ"), "basic", W(["z1", "chody"], ["z1", "starts"], ["z1", "gänge"]), { min: 1, max: 6, symbol: "z₁" }),
  row("L", tr("Délka závitu"), "number", 0, tr("0 = automaticky 14·m; DIN 3975 doporučuje aspoň (11 + 0,06·z₂)·m"), "basic", W(["l", "délka"], ["l", "length"], ["l", "länge"]), { unit: "mm", min: 0, required: true, symbol: "L" }),
  handRow(tr("šnek i šnekové kolo mají stejný smysl stoupání")),
  row("alpha", tr("Úhel profilu αₓ"), "number", 20, tr("úhel boku v osovém řezu (tvar ZA); jiné tvary boku (ZN, ZI, ZK) ani globoidní šnek se nenabízejí"), "teeth", W(["úhel", "alfa", "alpha"], ["angle", "alpha"], ["winkel", "alpha"]), { unit: "°", min: 10, max: 30, symbol: "αₓ" }),
  row("shaftD", tr("Čepy hřídele Ø"), "number", 0, tr("průměr konců hřídele po obou stranách závitu; 0 = bez čepů"), "body", W(["hřídel-průměr", "shaftd"], ["shaft-diameter", "shaftd"], ["welle-durchmesser", "shaftd"]), { unit: "mm", min: 0 }),
  row("shaftL", tr("Čepy hřídele délka"), "number", 0, tr("délka každého konce hřídele; 0 = bez čepů"), "body", W(["hřídel-délka", "shaftl"], ["shaft-length", "shaftl"], ["welle-länge", "shaftl"]), { unit: "mm", min: 0 }),
  row("bore", tr("Díra d"), "number", 0, tr("průchozí díra (nástrčný šnek); 0 = plný"), "body", W(["díra", "bore"], "bore", ["bohrung", "bore"]), { unit: "mm", min: 0, symbol: "d" }),
  row("keyway", tr("Drážka pro pero"), "bool", false, tr("drážka v díře podle DIN 6885-1"), "body", W(["pero", "keyway"], ["keyway", "key"], ["nut", "passfeder", "keyway"])),
  ...placeRows(),
];

const rws = rows();
export const WORM: KindDef<WormIn, WormC> = {
  kind: "worm",
  ext: "gear.worm",
  label: tr("Šnek"),
  short: tr("šnek"),
  standards: ["DIN 3975", "DIN 3976", "ISO 1122-2", "DIN 6885-1"],
  rows: rws,
  phrases: [...bodyPhrases({ hub: false, holes: false }), { words: W("hřídel", "shaft", "welle"), keys: ["shaftD", "shaftL"] }],
  words: W(["šnek"], ["worm"], ["schnecke"]),
  accuracy: tr("Přesně: šroubová plocha boku tvaru ZA (přímkový osový profil) a průměry. Nenabízí se: tvary ZN / ZI / ZK a globoidní šnek; závit končí rovným čelem bez výběhu."),
  defaults: () => defaultsOf(rws),
  read: (d): WormIn => {
    const m = num(d.m, 2);
    const L = Math.max(0, num(d.L));
    return { m, q: num(d.q, 10), z1: Math.max(1, int(d.z1, 1)), L, hand: oneOf(d.hand, ["right", "left"] as const, "right"), alpha: num(d.alpha, 20), shaftD: Math.max(0, num(d.shaftD)), shaftL: Math.max(0, num(d.shaftL)), jn: Math.max(0, num(d.jn)), body: readBody({ bore: d.bore, keyway: d.keyway }, L > 0 ? L : 14 * m), place: readPlace(d), raw: d };
  },
  validate: (i) => {
    const out: Issue[] = rangeIssues(rws, i.raw);
    if (out.some((x) => x.level === "error")) return validation(out);
    const c = compute(i);
    const err = (key: string, code: string, text: string) => out.push({ level: "error", code, key, text });
    if (c.gamma / DEG > 45) err("z1", "gamma", tr("Úhel stoupání {0}° je větší než 45° – zmenšete počet chodů nebo zvětšete q.", nf(c.gamma / DEG, 1)));
    if (!(c.rootHalf > -1e-9)) err("alpha", "space", tr("Mezera závitu je u dna užší než zaoblení – zmenšete úhel profilu."));
    if (c.sx / 2 - c.ha * Math.tan(i.alpha * DEG) <= 0.05 * i.m) err("alpha", "pointed", tr("Závit šneku je na hlavě špičatý – zmenšete úhel profilu nebo boční vůli."));
    if (!(c.df > 0)) err("q", "root", tr("Patní průměr šneku vychází záporný – zvětšete q."));
    const reach = boreReach(i.body);
    if (i.body.bore > 0 && reach >= c.df / 2 - 0.5 * i.m) err("bore", "bore-root", boreRootText(i.body, nf(c.df, 3)));
    if ((i.shaftD > 0) !== (i.shaftL > 0)) err(i.shaftD > 0 ? "shaftL" : "shaftD", "shaft-half", tr("Čepy hřídele potřebují průměr i délku – doplňte obojí, nebo obojí nechte nulové."));
    else if (i.shaftD > 0 && i.shaftD / 2 <= reach) err("shaftD", "shaft-bore", tr("Čep hřídele Ø{0} musí být větší než díra.", nf(i.shaftD)));
    else if (i.shaftD > c.da) err("shaftD", "shaft-da", tr("Čep hřídele Ø{0} je větší než hlavový průměr šneku Ø{1}.", nf(i.shaftD), nf(c.da, 2)));
    if (c.L > 400 * i.m) err("L", "long", tr("Závit delší než 400·m se nepostaví – zkraťte šnek."));
    if (i.jn > 0.3 * i.m) err("jn", "jn-max", tr("Boční vůle {0} mm je větší než 0,3·m – zub by byl příliš tenký.", nf(i.jn)));
    return validation(out);
  },
  compute,
  profile: (i, c): Profile2D => {
    const tooth = wormAxial(i, c);
    const n = Math.max(1, Math.round(c.L / c.px));
    let g = 0;
    for (let k = 0; k < n; k++) for (const s of tooth) g += segGreen(segMove(s, 0, [k * c.px, 0]));
    return { tooth, count: n, pitch: c.px, circles: { ref: c.dm, tip: c.da, root: c.df }, area: Math.abs(g) };
  },
  blank: (i, c) => {
    const ra = c.da / 2;
    const sh = i.shaftD > 0 && i.shaftL > 0 ? i.shaftD / 2 : 0;
    return sh ? [[0, -i.shaftL], [sh, -i.shaftL], [sh, 0], [ra, 0], [ra, c.L], [sh, c.L], [sh, c.L + i.shaftL], [0, c.L + i.shaftL]] : [[0, 0], [ra, 0], [ra, c.L], [0, c.L]];
  },
  dataRows: (i, c): GearDataRow[] => {
    const R = (key: string, label: string, symbol: string, value: string, unit: string, group: GearDataRow["group"]): GearDataRow => ({ key, label, ...(symbol ? { symbol } : {}), value, ...(unit ? { unit } : {}), group });
    return [
      R("m", tr("Osový modul"), "mₓ", loc(fmt(i.m, 4)), "mm", "basic"),
      R("z1", tr("Počet chodů"), "z₁", String(i.z1), "", "basic"),
      R("q", tr("Součinitel průměru"), "q", loc(fmt(i.q, 3)), "", "basic"),
      R("form", tr("Tvar boku"), "", "ZA (DIN 3975)", "", "basic"),
      R("alpha", tr("Úhel profilu"), "αₓ", fix(i.alpha, 2), "°", "basic"),
      R("gamma", tr("Úhel stoupání"), "γ_m", fix(c.gamma / DEG, 4), "°", "basic"),
      R("hand", tr("Smysl stoupání"), "", handLabel(i.hand), "", "basic"),
      R("dm", tr("Střední průměr"), "d_m1", fix(c.dm), "mm", "geometry"),
      R("da", tr("Hlavový průměr"), "d_a1", fix(c.da), "mm", "geometry"),
      R("df", tr("Patní průměr"), "d_f1", fix(c.df), "mm", "geometry"),
      R("px", tr("Osová rozteč"), "pₓ", fix(c.px, 4), "mm", "geometry"),
      R("pz", tr("Stoupání"), "p_z", fix(c.pz, 4), "mm", "geometry"),
      R("L", tr("Délka závitu"), "L", fix(c.L, 2), "mm", "geometry"),
      R("mn", tr("Normálný modul"), "mₙ", fix(c.mn, 4), "mm", "check"),
      R("sx", tr("Osová tloušťka závitu"), "sₓ", fix(c.sx), "mm", "check"),
    ];
  },
  summary: (i, c) => [`${tr("šnek")} m${nf(i.m)} q${nf(i.q)} z₁${i.z1} ${handLabel(i.hand)}`, `d_m ${nf(c.dm, 3)}`, `dₐ ${nf(c.da, 3)}`, `γ ${fix(c.gamma / DEG, 2)}°`, `L ${nf(c.L, 2)}`, i.place.out === "blank" ? tr("polotovar") : i.place.out === "teeth" ? tr("zuby do tělesa") : tr("šnek")].join(" · "),
  name: (i) => tr("Šnek m{0} q{1} z{2}", fmt(i.m), fmt(i.q), i.z1),
};
