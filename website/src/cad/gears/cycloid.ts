/**
 * Cykloidní (hodinové) ozubení (`gear.cycloid`): hlava zubu = epicykloida (tvořicí kružnice ρ_a se valí vně roztečné
 * kružnice), pata = hypocykloida (ρ_f uvnitř; ρ_f = r/2 dává radiální přímý bok). Kolo a pastorek „s lístky“.
 *   epicykloida:  P(t) = (R + ρ)·(cos t, sin t) − ρ·(cos((R + ρ)t/ρ), sin((R + ρ)t/ρ))
 *   hypocykloida: P(t) = (R − ρ)·(cos t, sin t) + ρ·(cos((R − ρ)t/ρ), −sin((R − ρ)t/ρ))
 * Poměry (tloušťka zubu, výška hlavy a paty) jsou výchozí hodnoty podle BS 978-2, jak se běžně tabelují – dají se přepsat.
 * Pastorek má podle BS 978-2 hlavu z kruhových oblouků (střed na roztečné kružnici): 6–7 lístků r = 1,05·m, 8–9 r = 0,70·m,
 * 10 a více r = 0,525·m.
 */
import { tr } from "../i18n";
import { bodyIssues, bodyPhrases, bodyRows, defaultsOf, discSection, fix, fmt, int, loc, num, oneOf, placeRows, rangeIssues, readBody, readPlace, row, validation, W, type Place } from "./common";
import { bodySummary, moduleRow, teethRow, widthRow } from "./cylindrical";
import { ang, bisect, circleX, curveSeg, polar, rot2, segMirrorRev, tiledArea } from "./num";
import type { BodyOpts, GearData, GearDataRow, GearRow, Issue, KindDef, Profile2D, Seg2, Vec2 } from "./types";

/** počet úseků proložení jedné cykloidy (odchylka splinu od přesné křivky pod 1·10⁻⁴ mm i u m = 10) */
const CYC_N = 24;

export type CycloidIn = { m: number; z: number; zMate: number; type: "wheel" | "pinion"; rollA: number; rollF: number; fa: number; ff: number; sw: number; tip: "auto" | "ogival" | "round"; body: BodyOpts; place: Place; raw: GearData };
export type CycloidC = {
  R: number;
  d: number;
  /** tvořicí kružnice hlavy a paty */
  rhoA: number;
  rhoF: number;
  /** tloušťka zubu na roztečné kružnici, výška hlavy a paty */
  s: number;
  ha: number;
  hf: number;
  da: number;
  df: number;
  /** hlava z kruhových oblouků (pastorek): poloměr oblouku; 0 = epicykloida */
  arcR: number;
  /** výška, ve které by se boky hlavy sešly do špičky */
  hPointed: number;
  /** převod s protikolem */
  ratio: number;
};

const epi = (R: number, rho: number, t: number): Vec2 => {
  const k = (R + rho) / rho;
  return [(R + rho) * Math.cos(t) - rho * Math.cos(k * t), (R + rho) * Math.sin(t) - rho * Math.sin(k * t)];
};
const hypo = (R: number, rho: number, t: number): Vec2 => {
  const k = (R - rho) / rho;
  return [(R - rho) * Math.cos(t) + rho * Math.cos(k * t), (R - rho) * Math.sin(t) - rho * Math.sin(k * t)];
};

/** výška špičky epicykloidní hlavy: bok začíná na roztečné kružnici v úhlu −ψ a dojde na osu zubu */
function pointedHeight(R: number, rho: number, psi: number): number {
  const f = (t: number) => {
    const p = epi(R, rho, t);
    return Math.atan2(p[1], p[0]) - psi;
  };
  const tMax = (Math.PI * rho) / R; // půl oblouku epicykloidy (nejvyšší bod)
  if (f(tMax) <= 0) return 2 * rho; // boky se nesejdou – hlava by byla celý oblouk
  const t = bisect(f, 1e-9, tMax);
  return Math.hypot(...epi(R, rho, t)) - R;
}

/** výchozí hlava kola podle BS 978-2: 0,95 × výška špičky, nejvýš 1,40·m */
const wheelAddendum = (m: number, z: number, zPinion: number, s: number) => Math.min(1.4 * m, 0.95 * pointedHeight((m * z) / 2, (m * zPinion) / 4, s / (m * z)));

function compute(i: CycloidIn): CycloidC {
  const R = (i.m * i.z) / 2;
  const pinion = i.type === "pinion";
  const s = i.sw > 0 ? i.sw : pinion ? (i.z >= 10 ? 1.25 : 1.05) * i.m : 1.57 * i.m;
  const psi = s / (2 * R);
  const rhoA = i.rollA > 0 ? i.rollA : (i.m * i.zMate) / 4;
  const rhoF = i.rollF > 0 ? i.rollF : R / 2;
  const round = i.tip === "round" || (i.tip === "auto" && pinion);
  const arcR = round ? (i.z <= 7 ? 1.05 : i.z <= 9 ? 0.7 : 0.525) * i.m : 0;
  // špička: kruhové oblouky se středem na roztečné kružnici ve vzdálenosti arcR od bodu boku / epicykloida
  const hPointed = round ? (2 * arcR >= s ? Math.sqrt(arcR * arcR - (arcR - s / 2) ** 2) : arcR) : pointedHeight(R, rhoA, psi);
  const haAuto = round ? (i.z <= 7 ? 0.855 : i.z <= 9 ? 0.67 : 0.525) * i.m : Math.min(1.4 * i.m, 0.95 * hPointed);
  const ha = i.fa > 0 ? i.fa * i.m : Math.min(haAuto, hPointed);
  // pata: kolo 1,57·m; pastorek = hlava kola + vůle 0,4·m
  const hf = i.ff > 0 ? i.ff * i.m : pinion ? wheelAddendum(i.m, i.zMate, i.z, 1.57 * i.m) + 0.4 * i.m : 1.57 * i.m;
  return { R, d: 2 * R, rhoA, rhoF, s, ha, hf, da: 2 * (R + ha), df: 2 * (R - hf), arcR, hPointed, ratio: i.zMate / i.z };
}

function profile(i: CycloidIn, c: CycloidC): Profile2D {
  const { R } = c;
  const half = Math.PI / i.z;
  const psi = c.s / (2 * R);
  const ra = R + c.ha;
  const rf = R - c.hf;
  const P0 = polar(R, -psi); // bod dolního boku na roztečné kružnici
  const low: Seg2[] = [];
  // pata: radiální přímka, nebo hypocykloida (parametr u = −t², aby derivace v hrotu křivky nebyla nulová)
  let rootA: number;
  if (Math.abs(c.rhoF - R / 2) < 1e-9 * R) {
    rootA = -psi;
    low.push({ t: "line", a: polar(rf, -psi), b: P0 });
  } else {
    const rho = c.rhoF;
    const cosv = (rf * rf - (R - rho) ** 2 - rho * rho) / (2 * rho * (R - rho));
    const tf = (rho / R) * Math.acos(Math.max(-1, Math.min(1, cosv)));
    const f = (u: number): Vec2 => rot2(hypo(R, rho, -Math.sqrt(Math.max(0, -u))), -psi);
    const d1 = rot2([((R - rho) * R) / rho / 2, 0], -psi);
    const sg = curveSeg("hypocycloid", f, -tf * tf, 0, CYC_N);
    sg.params = Array.from({ length: CYC_N + 1 }, (_, k) => -(((tf * (CYC_N - k)) / CYC_N) ** 2));
    sg.pts = sg.params.map(f);
    sg.d1 = d1;
    sg.d0 = numD(f, sg.params[0]);
    low.push(sg);
    rootA = ang(sg.pts[0]);
  }
  // hlava: kruhový oblouk (pastorek) nebo epicykloida (parametr u = t²)
  let tipA: number;
  if (c.arcR > 0) {
    const C = polar(R, -psi + c.arcR / R); // střed oblouku na roztečné kružnici (obloukem o arcR dovnitř zubu)
    const cen: Vec2 = [P0[0] + (C[0] - P0[0]) * (c.arcR / Math.hypot(C[0] - P0[0], C[1] - P0[1])), P0[1] + (C[1] - P0[1]) * (c.arcR / Math.hypot(C[0] - P0[0], C[1] - P0[1]))];
    // první průsečík oblouku s hlavovou kružnicí (menší úhel od osy kola); leží-li až za osou zubu, je zub špičatý
    let end = circleX(cen, c.arcR, [0, 0], ra).sort((p1, p2) => ang(p1) - ang(p2))[0];
    if (!end || end[1] > -1e-9) end = [cen[0] + Math.sqrt(Math.max(0, c.arcR ** 2 - cen[1] ** 2)), 0];
    low.push({ t: "arc", c: cen, r: c.arcR, a0: ang(P0, cen), a1: ang(end, cen), ccw: true });
    tipA = ang(end);
  } else {
    const rho = c.rhoA;
    const cosv = ((R + rho) ** 2 + rho * rho - ra * ra) / (2 * rho * (R + rho));
    const ta = (rho / R) * Math.acos(Math.max(-1, Math.min(1, cosv)));
    const f = (u: number): Vec2 => rot2(epi(R, rho, Math.sqrt(Math.max(0, u))), -psi);
    const sg = curveSeg("epicycloid", f, 0, ta * ta, CYC_N);
    sg.params = Array.from({ length: CYC_N + 1 }, (_, k) => ((ta * k) / CYC_N) ** 2);
    sg.pts = sg.params.map(f);
    sg.d0 = rot2([((R + rho) * R) / rho / 2, 0], -psi);
    sg.d1 = numD(f, sg.params[CYC_N]);
    low.push(sg);
    tipA = ang(sg.pts[CYC_N]);
  }
  const tooth: Seg2[] = [];
  if (half + rootA > 1e-9) tooth.push({ t: "arc", c: [0, 0], r: rf, a0: -half, a1: rootA, ccw: true });
  tooth.push(...low);
  if (-tipA > 1e-9) tooth.push({ t: "arc", c: [0, 0], r: Math.hypot(...endOf(low[low.length - 1])), a0: tipA, a1: -tipA, ccw: true });
  tooth.push(...low.map(segMirrorRev).reverse());
  if (half + rootA > 1e-9) tooth.push({ t: "arc", c: [0, 0], r: rf, a0: -rootA, a1: half, ccw: true });
  return { tooth, count: i.z, circles: { ref: c.d, tip: c.da, root: c.df }, area: tiledArea(tooth, i.z) };
}
const endOf = (s: Seg2): Vec2 => (s.t === "line" ? s.b : s.t === "arc" ? [s.c[0] + s.r * Math.cos(s.a1), s.c[1] + s.r * Math.sin(s.a1)] : s.pts[s.pts.length - 1]);
/** derivace středovou diferencí (uvnitř intervalu parametru) */
function numD(f: (u: number) => Vec2, u: number): Vec2 {
  const h = Math.max(1e-9, Math.abs(u) * 1e-5);
  const a = f(u - h);
  const b = f(u + h);
  return [(b[0] - a[0]) / (2 * h), (b[1] - a[1]) / (2 * h)];
}

const rows = (): GearRow[] => [
  { ...moduleRow(tr("Modul m"), tr("modul; roztečný průměr d = m·z (hodinové ozubení podle BS 978-2)"), 1), symbol: "m" },
  teethRow(30, 6, tr("počet zubů kola, nebo počet lístků pastorku"), 400),
  row("zMate", tr("Zuby protikola"), "int", 8, tr("počet zubů spoluzabírajícího kola – určuje tvořicí kružnici hlavy (polovina roztečné kružnice protikola → radiální boky protikola)"), "basic", W(["protikolo", "zmate"], ["mate", "zmate"], ["gegenrad", "zmate"]), { min: 6, max: 400, required: true }),
  widthRow(3),
  row("type", tr("Typ"), "enum", "wheel", tr("kolo (hnací, hlava z epicykloidy) nebo pastorek s lístky (hlava z kruhových oblouků podle BS 978-2)"), "basic", W(["typ", "type"], "type", ["typ", "type"]), {
    options: [{ v: "wheel", l: tr("Kolo") }, { v: "pinion", l: tr("Pastorek (lístky)") }],
    enumWords: { wheel: W("kolo", "wheel", "rad"), pinion: W(["pastorek", "lístky"], ["pinion", "leaves"], ["trieb", "ritzel"]) },
  }),
  row("rollA", tr("Poloměr tvořicí kružnice hlavy"), "number", 0, tr("0 = automaticky m·z_protikola / 4 (protikolo pak má radiální boky pat)"), "teeth", W(["tvořicí-hlava", "rolla"], ["roll-addendum", "rolla"], ["rollkreis-kopf", "rolla"]), { unit: "mm", min: 0 }),
  row("rollF", tr("Poloměr tvořicí kružnice paty"), "number", 0, tr("0 = automaticky čtvrtina roztečného průměru (radiální přímé boky pat)"), "teeth", W(["tvořicí-pata", "rollf"], ["roll-dedendum", "rollf"], ["rollkreis-fuß", "rollf"]), { unit: "mm", min: 0 }),
  row("fa", tr("Součinitel výšky hlavy"), "number", 0, tr("výška hlavy v modulech; 0 = automaticky (kolo 0,95 × výška špičky, nejvýš 1,40; pastorek 0,855 / 0,67 / 0,525 podle počtu lístků)"), "teeth", W("fa", "fa", "fa"), { min: 0, max: 2 }),
  row("ff", tr("Součinitel výšky paty"), "number", 0, tr("výška paty v modulech; 0 = automaticky (kolo 1,57; pastorek = hlava kola + vůle 0,4)"), "teeth", W("ff", "ff", "ff"), { min: 0, max: 3 }),
  row("sw", tr("Tloušťka zubu"), "number", 0, tr("tloušťka zubu na roztečné kružnici; 0 = automaticky (kolo 1,57·m, pastorek 1,05·m, od 10 lístků 1,25·m)"), "teeth", W(["tloušťka", "sw"], ["thickness", "sw"], ["dicke", "sw"]), { unit: "mm", min: 0 }),
  row("tip", tr("Tvar hlavy"), "enum", "auto", tr("automaticky: kolo epicykloida, pastorek kruhové oblouky; lze vynutit"), "teeth", W(["hlava", "tip"], "tip", ["kopf", "tip"]), {
    options: [{ v: "auto", l: tr("Automaticky") }, { v: "ogival", l: tr("Epicykloida (lomený oblouk)") }, { v: "round", l: tr("Kruhové oblouky") }],
    enumWords: { ogival: W("epicykloida", "ogival", "spitzbogen"), round: W("kruhová", "round", "rund") },
  }),
  ...bodyRows(),
  ...placeRows().filter((r) => r.key !== "jn"),
];

const rws = rows();
export const CYCLOID: KindDef<CycloidIn, CycloidC> = {
  kind: "cycloid",
  ext: "gear.cycloid",
  label: tr("Cykloidní (hodinové) kolo"),
  short: tr("cykloidní"),
  standards: ["BS 978-2", "DIN 6885-1"],
  rows: rws,
  phrases: bodyPhrases(),
  words: W(["cykloidní", "hodinové"], ["cycloidal", "cycloid", "clock"], ["zykloid", "zykloidenrad", "uhrenrad"]),
  accuracy: tr("Přesně: epicykloida hlavy a hypocykloida / radiální bok paty. Poměry zubu (tloušťka, výšky) jsou výchozí hodnoty podle BS 978-2 – ověřte je podle normy nebo protikola a případně přepište."),
  defaults: () => defaultsOf(rws),
  read: (d): CycloidIn => ({
    m: num(d.m, 1),
    z: int(d.z, 30),
    zMate: int(d.zMate, 8),
    type: oneOf(d.type, ["wheel", "pinion"] as const, "wheel"),
    rollA: Math.max(0, num(d.rollA)),
    rollF: Math.max(0, num(d.rollF)),
    fa: Math.max(0, num(d.fa)),
    ff: Math.max(0, num(d.ff)),
    sw: Math.max(0, num(d.sw)),
    tip: oneOf(d.tip, ["auto", "ogival", "round"] as const, "auto"),
    body: readBody(d, num(d.b, 3)),
    place: readPlace(d),
    raw: d,
  }),
  validate: (i) => {
    const out: Issue[] = rangeIssues(rws, i.raw);
    if (out.some((x) => x.level === "error")) return validation(out);
    const c = compute(i);
    const err = (key: string, code: string, text: string) => out.push({ level: "error", code, key, text });
    if (!(c.s < 0.9 * Math.PI * i.m)) err("sw", "s", tr("Tloušťka zubu {0} mm je větší než rozteč – zmenšete ji.", fmt(c.s, 3)));
    if (!(c.df > 0.2 * i.m)) err("ff", "root", tr("Patní průměr vychází záporný – zvětšete počet zubů nebo zmenšete výšku paty."));
    if (c.ha > c.hPointed + 1e-9) err("fa", "pointed", tr("Hlava {0} mm je vyšší než špička zubu ({1} mm) – boky se sejdou dřív.", fmt(c.ha, 3), fmt(c.hPointed, 3)));
    if (c.arcR === 0 && c.ha >= 2 * c.rhoA) err("rollA", "roll", tr("Hlava {0} mm je vyšší než průměr tvořicí kružnice ({1} mm).", fmt(c.ha, 3), fmt(2 * c.rhoA, 3)));
    if (Math.abs(c.rhoF - c.R / 2) > 1e-9 && c.R - c.hf < Math.abs(c.R - 2 * c.rhoF) + 1e-9) err("rollF", "roll-f", tr("Hypocykloida s tvořicí kružnicí {0} mm nedosáhne na patní kružnici – zmenšete výšku paty.", fmt(c.rhoF, 3)));
    if (!out.some((x) => x.level === "error")) out.push(...bodyIssues(i.body, { rootR: c.df / 2, tipR: c.da / 2, m: i.m }));
    return validation(out);
  },
  compute,
  profile,
  blank: (i, c) => discSection(i.body, { tipR: c.da / 2, rootR: c.df / 2, m: i.m }),
  dataRows: (i, c): GearDataRow[] => {
    const R = (key: string, label: string, symbol: string, value: string, unit: string, group: GearDataRow["group"]): GearDataRow => ({ key, label, ...(symbol ? { symbol } : {}), value, ...(unit ? { unit } : {}), group });
    return [
      R("m", tr("Modul"), "m", loc(fmt(i.m, 4)), "mm", "basic"),
      R("z", i.type === "pinion" ? tr("Počet lístků") : tr("Počet zubů"), "z", String(i.z), "", "basic"),
      R("zMate", tr("Počet zubů protikola"), "z₂", String(i.zMate), "", "pair"),
      R("ratio", tr("Převod"), "i", fix(c.ratio, 4), "", "pair"),
      R("d", tr("Roztečný průměr"), "d", fix(c.d), "mm", "geometry"),
      R("da", tr("Hlavový průměr"), "dₐ", fix(c.da), "mm", "geometry"),
      R("df", tr("Patní průměr"), "d_f", fix(c.df), "mm", "geometry"),
      R("s", tr("Tloušťka zubu"), "s", fix(c.s), "mm", "check"),
      c.arcR > 0 ? R("arcR", tr("Poloměr oblouku hlavy"), "r", fix(c.arcR), "mm", "geometry") : R("rhoA", tr("Tvořicí kružnice hlavy"), "ρₐ", fix(c.rhoA), "mm", "geometry"),
      R("rhoF", tr("Tvořicí kružnice paty"), "ρ_f", fix(c.rhoF), "mm", "geometry"),
    ];
  },
  summary: (i, c) => [`${tr("cykloidní")} ${i.type === "pinion" ? tr("pastorek") : tr("kolo")} m${fmt(i.m)} z${i.z}/${i.zMate} b${fmt(i.body.b)}`, `d ${fmt(c.d, 3)}`, `dₐ ${fmt(c.da, 3)}`, bodySummary(i.body, i.place)].join(" · "),
  name: (i) => (i.type === "pinion" ? tr("Cykloidní pastorek m{0} z{1}", fmt(i.m), i.z) : tr("Cykloidní kolo m{0} z{1}", fmt(i.m), i.z)),
};
