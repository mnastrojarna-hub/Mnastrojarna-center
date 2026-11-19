/**
 * Kuželové kolo (`gear.bevel`) s přímými nebo zakřivenými (spirálními) zuby podle ISO 23509: tan δ = sin Σ / (z₂/z₁ + cos Σ),
 * R_e = d_e / (2·sin δ), přímé zuby h_ae = m·(1 + x), h_fe = m·(1,25 − x) se společným vrcholem (boky = přesné kužele nad
 * sférickou evolventou). Zakřivené zuby: stálá výška z normálného modulu ve středu šířky m_mn = (2·R_m·sin δ / z)·cos β_m,
 * stopa zubu kruhový oblouk – jmenovitá plocha (viz conic.ts).
 * Soustava: osa +Z od zadního (velkého) čela k vrcholu roztečného kužele, počátek ve vrcholu, tělo má z < 0.
 */
import { tr } from "../i18n";
import { bodyPhrases, bodyRows, boreReach, defaultsOf, fix, fmt, hubBoreText, int, loc, nf, num, oneOf, placeRows, rangeIssues, readBody, readPlace, row, validation, W, type Place } from "./common";
import { coneGeom, type ConeGeom, type ConeMember } from "./conic";
import { alphaRow, bodySummary, handLabel, handRow, teethRow } from "./cylindrical";
import { cylGeom, cylProfile } from "./involute";
import { DEG } from "./num";
import { RACKS } from "./rack";
import { MODULES } from "./tables";
import type { BodyOpts, GearData, GearDataRow, GearRow, Issue, KindDef, Profile2D, Vec2 } from "./types";

export type BevelIn = { m: number; z: number; zMate: number; sigma: number; b: number; alpha: number; x: number; jn: number; betaM: number; hand: "right" | "left"; rc: number; backL: number; body: BodyOpts; place: Place; raw: GearData };
export type BevelC = {
  member: ConeMember;
  geom: ConeGeom;
  delta: number;
  Re: number;
  b: number;
  /** normálný modul ve středu šířky (zakřivené zuby), jinak vnější čelní modul */
  mmn: number;
  hae: number;
  hfe: number;
  zv: number;
  /** tloušťka zubu na tětivě a výška hlavy nad tětivou na vnějším konci */
  sc: number;
  hc: number;
  /** montážní vzdálenost: od vrcholu roztečného kužele k zadnímu čelu (bez náboje) */
  mount: number;
};

/** poloviční řez (r, z) kuželového členu: zadní čelo → doplňkový kužel → hlavový kužel → přední kužel → přední čelo; s nábojem vzadu */
export function coneSection(m: ConeMember, g: ConeGeom, body: BodyOpts): Vec2[] {
  const tip = (R: number): Vec2 => {
    const k = m.taper ? R / m.Re : 1;
    const y = Math.atan((m.ha * k) / R);
    const s = R / Math.cos(y);
    return [s * Math.sin(m.delta + y), m.apexZ - s * Math.cos(m.delta + y)];
  };
  const out: Vec2[] = [];
  if (body.hubD > 0 && body.hubL > 0) out.push([0, g.zBack - body.hubL], [body.hubD / 2, g.zBack - body.hubL], [body.hubD / 2, g.zBack]);
  else out.push([0, g.zBack]);
  out.push([g.rBack, g.zBack], tip(m.Re), tip(g.Ri), [g.rFront, g.zFront], [0, g.zFront]);
  return out;
}

/** kontroly společné kuželovým a hypoidním členům */
export function coneIssues(m: ConeMember, g: ConeGeom, body: BodyOpts, mod: number, key: { b: string; x: string; beta: string }): Issue[] {
  const out: Issue[] = [];
  const err = (k: string, code: string, text: string) => out.push({ level: "error", code, key: k, text });
  if (!(g.Ri > 0.3 * m.Re)) {
    err(key.b, "b-max", tr("Šířka ozubení {0} mm je příliš velká – smí být nejvýš 0,7 délky površky kužele ({1} mm).", nf(m.b, 2), nf(0.7 * m.Re, 2)));
    return out;
  }
  if (!g.traceOk) {
    err(key.beta, "trace", tr("Stopu zubu s tímto úhlem sklonu a poloměrem nástroje nelze přes celou šířku postavit – zmenšete šířku nebo úhel sklonu, nebo zvětšete poloměr nástroje."));
    return out;
  }
  if (m.b > m.Re / 3 + 1e-9) out.push({ level: "warn", code: "b-third", key: key.b, text: tr("Šířka ozubení bývá nejvýš třetina délky površky kužele ({0} mm).", nf(m.Re / 3, 2)) });
  if (!(Math.min(g.tipE, g.tipI) > 0)) err(key.x, "pointed", tr("Zub je špičatý – zmenšete posunutí x nebo úhel záběru."));
  else if (Math.min(g.tipE, g.tipI) < 0.2 * mod) out.push({ level: "warn", code: "thin-tip", key: key.x, text: tr("Tloušťka zubu na hlavě je jen {0} mm (méně než 0,2·m).", nf(Math.min(g.tipE, g.tipI), 3)) });
  if (!(Math.min(g.rootE, g.rootI) > 0)) err(key.x, "space", tr("Zubová mezera je u paty příliš úzká – zvětšete počet zubů nebo zmenšete posunutí x."));
  const reach = boreReach(body);
  if (!(g.rFront > Math.max(reach, 0) + 0.5)) err(body.bore > 0 ? "bore" : key.b, "front", body.bore > 0 ? tr("Díra Ø{0} se do malého konce kola nevejde (přední čelo má Ø{1}).", nf(body.bore), nf(2 * g.rFront, 2)) : tr("Malý konec kola vychází příliš tenký (přední čelo Ø{0}) – zmenšete šířku ozubení.", nf(2 * g.rFront, 2)));
  if ((body.hubD > 0) !== (body.hubL > 0)) err(body.hubD > 0 ? "hubL" : "hubD", "hub-half", tr("Náboj potřebuje průměr i délku – doplňte obojí, nebo obojí nechte nulové."));
  else if (body.hubD > 0) {
    if (body.hubD / 2 <= reach + 0.5) err("hubD", "hub-bore", hubBoreText(body, reach));
    if (body.hubD / 2 > g.rBack + 1e-9) err("hubD", "hub-back", tr("Náboj Ø{0} je větší než zadní čelo kola (Ø{1}).", nf(body.hubD), nf(2 * g.rBack, 2)));
  }
  if (body.setScrew && !(body.hubD > 0 && body.hubL > 0)) err("setScrew", "screw-hub", tr("Stavěcí šroub potřebuje náboj – zadejte průměr a délku náboje."));
  return out;
}

function compute(i: BevelIn): BevelC {
  const sg = i.sigma * DEG;
  const delta = Math.atan2(Math.sin(sg), i.zMate / i.z + Math.cos(sg));
  const Re = (i.m * i.z) / (2 * Math.sin(delta));
  // automatická šířka zaokrouhlená DOLŮ na 0,1 mm – zaokrouhlením nahoru by přesáhla R_e/3 a kolo by varovalo samo na sebe
  const b = i.b > 0 ? i.b : Math.floor(Math.min(Re / 3, 10 * i.m) * 10 + 1e-9) / 10;
  const bm = i.betaM * DEG;
  const Rm = Re - b / 2;
  const spiral = bm > 1e-9;
  const mmn = spiral ? ((2 * Rm * Math.sin(delta)) / i.z) * Math.cos(bm) : i.m;
  const an = i.alpha * DEG;
  const at = Math.atan(Math.tan(an) / Math.cos(bm));
  const ha = mmn * (1 + i.x);
  const hf = mmn * (1.25 - i.x);
  const rm = Rm * Math.sin(delta);
  const member: ConeMember = {
    z: i.z,
    delta,
    Re,
    b,
    betaM: bm,
    // ISO 23509 / AGMA: pravý = vnější polovina zubu skloněná po směru hodin při pohledu na čelo (od vrcholu) → −1 v conic.ts
    hand: i.hand === "left" ? 1 : -1,
    rc: i.rc > 0 ? i.rc : Rm,
    alphaN: an,
    taper: !spiral,
    ha,
    hf,
    psi: (Math.PI / 2 + 2 * i.x * Math.tan(at)) / i.z - i.jn / (Math.cos(an) * Math.cos(bm)) / (2 * rm),
    rim: i.backL > 0 ? i.backL : 1.5 * i.m,
    apexZ: 0,
  };
  const geom = coneGeom(member);
  const dv = (i.m * i.z) / Math.cos(delta);
  const s = member.psi * i.m * i.z;
  return { member, geom, delta, Re, b, mmn, hae: ha, hfe: hf, zv: i.z / Math.cos(delta), sc: dv * Math.sin(s / dv), hc: ha + (dv / 2) * (1 - Math.cos(s / dv)), mount: -geom.zBack };
}

const rows = (): GearRow[] => [
  row("m", tr("Vnější čelní modul m"), "number", 2, tr("modul na velkém konci (ISO 23509): vnější roztečný průměr d_e = m·z"), "basic", W(["m", "modul"], ["m", "module"], ["m", "modul"]), { unit: "mm", min: 0.1, max: 50, required: true, preset: MODULES, symbol: "m_et" }),
  teethRow(20, 6, tr("počet zubů tohoto kola"), 300),
  row("zMate", tr("Zuby protikola"), "int", 20, tr("určuje úhel roztečného kužele: tan δ = sin Σ / (z₂/z₁ + cos Σ); stejný počet = převod 1 : 1 (δ = 45°)"), "basic", W(["protikolo", "zmate"], ["mate", "zmate"], ["gegenrad", "zmate"]), { min: 6, max: 400, required: true }),
  row("sigma", tr("Úhel os Σ"), "number", 90, tr("úhel, který svírají osy obou kol (běžně 90°)"), "basic", W(["sigma", "osy"], ["sigma", "shaftangle"], ["sigma", "achswinkel"]), { unit: "°", min: 60, max: 120, symbol: "Σ" }),
  row("b", tr("Šířka ozubení b"), "number", 0, tr("po površce kužele; 0 = automaticky menší z R_e/3 a 10·m"), "basic", W(["b", "šířka"], ["b", "width"], ["b", "breite"]), { unit: "mm", min: 0, symbol: "b" }),
  alphaRow(tr("normálný úhel záběru (běžně 20°)")),
  row("x", tr("Posunutí profilu x"), "number", 0, tr("výškové posunutí: pastorek kladné, kolo stejné záporné"), "teeth", W(["x", "posunutí"], ["x", "shift"], ["x", "profilverschiebung"]), { min: -0.6, max: 0.6, step: 0.05, symbol: "x" }),
  row("betaM", tr("Střední úhel sklonu β_m"), "number", 0, tr("0 = přímé zuby; zakřivené (spirální) zuby mívají 35° (Gleason). Tvar boku zakřivených zubů je jmenovitý, ne obálkový – pro zástavbu, hmotnost a výkres"), "teeth", W(["beta", "sklon"], ["beta", "spiral"], ["beta", "spiralwinkel"]), { unit: "°", min: 0, max: 45, symbol: "β_m" }),
  handRow(tr("smysl stoupání zakřivených zubů; spoluzabírající kolo má opačný")),
  row("rc", tr("Poloměr nástroje r_c0"), "number", 0, tr("poloměr frézovací hlavy, který určuje oblouk stopy zubu; 0 = automaticky střední délka površky R_m"), "advanced", W(["nástroj", "rc"], ["cutter", "rc"], ["messerkopf", "rc"]), { unit: "mm", min: 0 }),
  row("backL", tr("Tloušťka těla pod patou"), "number", 0, tr("tloušťka těla pod patou zubu na velkém konci – určuje polohu zadního čela (montážní vzdálenost); 0 = automaticky 1,5·m"), "body", W(["tělo", "backl"], ["back", "backl"], ["körper", "backl"]), { unit: "mm", min: 0 }),
  ...bodyRows({ holes: false, chamfer: false, web: false }).filter((r) => r.key !== "hubSide"),
  ...placeRows(),
];

/** náhled: zub virtuálního čelního kola na doplňkovém kuželi (z_v = z / cos δ) */
export function virtualProfile(m: number, zv: number, alpha: number, x: number): Profile2D {
  const ci = { m, z: Math.max(6, Math.round(zv)), alpha, x, beta: 0, rack: RACKS.A, k: 0, jn: 0, internal: false };
  return cylProfile(ci, cylGeom(ci));
}

const rws = rows();
export const BEVEL: KindDef<BevelIn, BevelC> = {
  kind: "bevel",
  ext: "gear.bevel",
  label: tr("Kuželové kolo"),
  short: tr("kuželové"),
  standards: ["ISO 23509", "ISO 1122-1", "DIN 6885-1"],
  rows: rws,
  phrases: bodyPhrases({ holes: false }),
  words: W(["kuželové", "kuželová"], ["bevel"], ["kegelrad", "kegel"]),
  accuracy: tr("Přímé zuby – přesně: sférická evolventa a úhly kuželů; přibližně: přechod do paty. Zakřivené zuby – přesně: roztečný kužel, střední úhel sklonu a oblouk stopy zubu; přibližně: tvar boku (jmenovitý, ne obálkový Gleason / Klingelnberg, bez podélné modifikace) a stálá výška zubu."),
  defaults: () => defaultsOf(rws),
  read: (d): BevelIn => ({
    m: num(d.m, 2),
    z: int(d.z, 20),
    zMate: int(d.zMate, 20),
    sigma: num(d.sigma, 90),
    b: Math.max(0, num(d.b)),
    alpha: num(d.alpha, 20),
    x: num(d.x),
    jn: Math.max(0, num(d.jn)),
    betaM: Math.abs(num(d.betaM)),
    hand: oneOf(d.hand, ["right", "left"] as const, "right"),
    rc: Math.max(0, num(d.rc)),
    backL: Math.max(0, num(d.backL)),
    body: readBody({ ...d, hubSide: "bottom", holesN: 0, webT: 0, chamfer: 0 }, 1),
    place: readPlace(d),
    raw: d,
  }),
  validate: (i) => {
    const out: Issue[] = rangeIssues(rws, i.raw);
    if (out.some((x) => x.level === "error")) return validation(out);
    const c = compute(i);
    out.push(...coneIssues(c.member, c.geom, i.body, i.m, { b: "b", x: "x", beta: "betaM" }));
    if (i.jn > 0.3 * i.m) out.push({ level: "error", code: "jn-max", key: "jn", text: tr("Boční vůle {0} mm je větší než 0,3·m – zub by byl příliš tenký.", nf(i.jn)) });
    const xMin = 1.25 - 0.38 * (1 - Math.sin(i.alpha * DEG)) - (c.zv * Math.sin(i.alpha * DEG) ** 2) / 2;
    if (i.betaM === 0 && i.x < xMin - 1e-9) out.push({ level: "warn", code: "undercut", key: "z", text: tr("Zuby by se při výrobě podřezaly (virtuální počet zubů {0}): použijte posunutí x ≥ {1}. Model podřezání nezobrazuje.", nf(c.zv, 1), nf(Math.ceil(xMin * 100) / 100, 2)) });
    return validation(out);
  },
  compute,
  profile: (i, c) => virtualProfile(i.m, c.zv, i.alpha, i.x),
  blank: (i, c) => coneSection(c.member, c.geom, i.body),
  dataRows: (i, c): GearDataRow[] => {
    const R = (key: string, label: string, symbol: string, value: string, unit: string, group: GearDataRow["group"]): GearDataRow => ({ key, label, ...(symbol ? { symbol } : {}), value, ...(unit ? { unit } : {}), group });
    const out = [
      R("m", tr("Vnější čelní modul"), "m_et", loc(fmt(i.m, 4)), "mm", "basic"),
      R("z", tr("Počet zubů"), "z", String(i.z), "", "basic"),
      R("zMate", tr("Počet zubů protikola"), "z₂", String(i.zMate), "", "pair"),
      R("sigma", tr("Úhel os"), "Σ", fix(i.sigma, 2), "°", "pair"),
      R("alpha", tr("Úhel záběru"), "αₙ", fix(i.alpha, 2), "°", "basic"),
    ];
    if (i.betaM > 0) out.push(R("betaM", tr("Střední úhel sklonu"), "β_m", fix(i.betaM, 2), "°", "basic"), R("hand", tr("Smysl stoupání"), "", handLabel(i.hand), "", "basic"), R("mmn", tr("Střední normálný modul"), "m_mn", fix(c.mmn, 4), "mm", "basic"));
    out.push(
      R("x", tr("Posunutí profilu"), "x", fix(i.x, 4), "", "basic"),
      R("delta", tr("Úhel roztečného kužele"), "δ", fix(c.delta / DEG, 4), "°", "geometry"),
      R("deltaA", tr("Úhel hlavového kužele"), "δₐ", fix(c.geom.deltaA / DEG, 4), "°", "geometry"),
      R("deltaF", tr("Úhel patního kužele"), "δ_f", fix(c.geom.deltaF / DEG, 4), "°", "geometry"),
      R("de", tr("Vnější roztečný průměr"), "d_e", fix(c.geom.de), "mm", "geometry"),
      R("dae", tr("Vnější hlavový průměr"), "d_ae", fix(c.geom.dae), "mm", "geometry"),
      R("Re", tr("Délka površky kužele"), "R_e", fix(c.Re), "mm", "geometry"),
      R("b", tr("Šířka ozubení"), "b", fix(c.b, 2), "mm", "geometry"),
      R("hae", tr("Výška hlavy (vnější)"), "h_ae", fix(c.hae), "mm", "geometry"),
      R("hfe", tr("Výška paty (vnější)"), "h_fe", fix(c.hfe), "mm", "geometry"),
      R("zv", tr("Virtuální počet zubů"), "z_v", fix(c.zv, 2), "", "check"),
      R("sc", tr("Tloušťka zubu na tětivě (vnější)"), "s̄", fix(c.sc), "mm", "check"),
      R("hc", tr("Výška hlavy nad tětivou"), "h̄ₐ", fix(c.hc), "mm", "check"),
      R("mount", tr("Montážní vzdálenost (vrchol – zadní čelo)"), "A", fix(c.mount), "mm", "geometry"),
    );
    return out;
  },
  summary: (i, c) => [`${tr("kuželové")} m${nf(i.m)} z${i.z}/${i.zMate} Σ${nf(i.sigma)}°${i.betaM > 0 ? ` β${nf(i.betaM)}° ${handLabel(i.hand)}` : ""} b${nf(c.b, 2)}`, `δ ${fix(c.delta / DEG, 2)}°`, `d_e ${nf(c.geom.de, 3)}`, `d_ae ${nf(c.geom.dae, 3)}`, bodySummary(i.body, i.place)].join(" · "),
  name: (i) => tr("Kuželové kolo m{0} z{1}", fmt(i.m), i.z),
};
