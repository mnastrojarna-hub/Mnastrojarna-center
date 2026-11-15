/**
 * Válcová evolventní kola: čelní s přímými zuby (`gear.spur`), šikmými (`gear.helical`), šípovými (`gear.herringbone`)
 * a vnitřní ozubení (`gear.internal`). Řádky tabulky, kontrola zadání, výpočet a tabulka ozubení; geometrie v `involute.ts`.
 */
import { tr } from "../i18n";
import { bodyIssues, bodyPhrases, bodyRows, bool, defaultsOf, discSection, fix, fmt, loc, mateRows, num, int, oneOf, placeRows, rangeIssues, readBody, readPlace, row, validation, W, type Place } from "./common";
import { cylGeom, cylProfile, pointedRadius, type CylGeom, type CylInput } from "./involute";
import { ballAuto, overBalls, spanMeasurable, spanTeeth, spanW } from "./measure";
import { DEG } from "./num";
import { RACK_OPTIONS, rackName, rackOf, rackRhoMax } from "./rack";
import { MODULES } from "./tables";
import type { BodyOpts, GearData, GearDataRow, GearExt, GearKind, GearRow, Issue, KindDef, Vec2 } from "./types";

export type CylKind = "spur" | "helical" | "herringbone" | "internal";
export type CylIn = CylInput & {
  kind: CylKind;
  hand: "right" | "left";
  rackType: string;
  ballD: number;
  /** šípové: šířka drážky uprostřed */
  gap: number;
  /** vnitřní: vnější průměr věnce (0 = automaticky) */
  rimD: number;
  body: BodyOpts;
  place: Place;
  mateZ: number;
  aw: number;
  raw: GearData;
};
export type CylC = CylGeom & {
  /** rozměr přes k zubů */
  k: number;
  W: number;
  Wok: boolean;
  /** průměr kuličky, rozměr přes kuličky, průměr kružnice středů kuliček */
  dM: number;
  M: number;
  dK: number;
  /** vnější průměr věnce (vnitřní kolo) */
  rimD: number;
  /** zkroucení čelního profilu přes šířku b (°, se znaménkem smyslu) */
  twist: number;
};

const HAND = { right: W(["pravé", "pravý", "pravá"], ["right", "rh"], ["rechts", "rechtssteigend"]), left: W(["levé", "levý", "levá"], ["left", "lh"], ["links", "linkssteigend"]) };
export const handRow = (hint: string): GearRow =>
  row("hand", tr("Smysl stoupání"), "enum", "right", hint, "teeth", W(["smysl", "hand"], "hand", ["steigung", "hand"]), { options: [{ v: "right", l: tr("Pravé") }, { v: "left", l: tr("Levé") }], enumWords: HAND });

export const moduleRow = (label: string, hint: string, def = 2): GearRow => row("m", label, "number", def, hint, "basic", W(["m", "modul"], ["m", "module"], ["m", "modul"]), { unit: "mm", min: 0.1, max: 50, required: true, preset: MODULES, symbol: "mₙ" });
export const teethRow = (def: number, min: number, hint: string, max = 400): GearRow => row("z", tr("Počet zubů z"), "int", def, hint, "basic", W("z", "z", "z"), { min, max, required: true, symbol: "z" });
export const alphaRow = (hint = tr("úhel záběru základního profilu; ISO 53 a DIN 867: 20°")): GearRow => row("alpha", tr("Úhel záběru αₙ"), "number", 20, hint, "teeth", W(["úhel", "alfa", "alpha"], ["angle", "alpha"], ["winkel", "alpha"]), { unit: "°", min: 10, max: 30, preset: [14.5, 20, 25], symbol: "αₙ" });
export const widthRow = (def: number, hint = tr("šířka ozubeného věnce")): GearRow => row("b", tr("Šířka b"), "number", def, hint, "basic", W(["b", "šířka"], ["b", "width"], ["b", "breite"]), { unit: "mm", min: 0.1, symbol: "b" });

function rows(kind: CylKind): GearRow[] {
  const helical = kind === "helical" || kind === "herringbone";
  const out: GearRow[] = [
    moduleRow(tr("Modul mₙ"), helical ? tr("normálný modul (ISO 54); roztečný průměr d = mₙ·z / cos β") : tr("modul (ISO 54); roztečný průměr d = m·z")),
    teethRow(kind === "internal" ? 60 : 24, kind === "internal" ? 20 : 5, kind === "internal" ? tr("počet zubů věnce; pastorek by měl mít aspoň o 10 zubů méně") : tr("pod 17 zubů se zuby bez posunutí profilu podřezávají – tabulka nabídne potřebné x")),
    widthRow(20),
  ];
  if (helical) out.push(row("beta", tr("Úhel sklonu β"), "number", 15, tr("úhel sklonu zubů na roztečném válci; stoupání šroubovice p_z = π·d / tan β"), "basic", W(["beta", "sklon"], ["beta", "helix"], ["beta", "schrägung"]), { unit: "°", min: 0, max: 45, required: true, symbol: "β" }));
  if (kind === "internal") {
    out.push(row("beta", tr("Úhel sklonu β"), "number", 0, tr("0 = přímé zuby; šikmé vnitřní ozubení má stejný smysl stoupání jako pastorek"), "teeth", W(["beta", "sklon"], ["beta", "helix"], ["beta", "schrägung"]), { unit: "°", min: 0, max: 45, symbol: "β" }));
    out.push(row("rimD", tr("Vnější průměr věnce"), "number", 0, tr("0 = automaticky patní průměr + 2·max(2,5·m; 8 mm)"), "basic", W(["věnec", "rimd"], ["rim", "rimd"], ["kranz", "rimd"]), { unit: "mm", min: 0, required: true }));
  }
  if (helical || kind === "internal") out.push(handRow(kind === "internal" ? tr("u vnitřního soukolí mají věnec i pastorek stejný smysl stoupání") : tr("spoluzabírající vnější kola mají opačný smysl stoupání")));
  if (kind === "herringbone") out.push(row("gap", tr("Drážka uprostřed"), "number", 0, tr("šířka odlehčovací drážky mezi oběma polovinami šípového ozubení; 0 = bez drážky (ostrý hrot)"), "teeth", W(["drážka", "gap"], ["groove", "gap"], ["rille", "gap"]), { unit: "mm", min: 0 }));
  out.push(
    alphaRow(),
    row("x", tr("Posunutí profilu x"), "number", 0, kind === "internal" ? tr("kladné = zuby věnce dál od osy (větší patní i hlavový průměr)") : tr("kladné = silnější pata a větší hlavový průměr (odstraní podřezání); režim Soukolí ho dopočítá z osové vzdálenosti"), "teeth", W(["x", "posunutí"], ["x", "shift"], ["x", "profilverschiebung"]), { min: -1, max: 1.2, step: 0.05, symbol: "x" }),
    row("rack", tr("Základní profil"), "enum", "A", tr("základní hřeben ISO 53 (typ A = DIN 867): výška paty a zaoblení paty nástroje"), "advanced", W(["profil", "rack"], ["rackprofile", "rack"], ["bezugsprofil", "rack"]), { options: RACK_OPTIONS() }),
    row("ha", tr("Výška hlavy h_aP*"), "number", 1, tr("jen vlastní profil: výška hlavy zubu v modulech"), "advanced", W("ha", "ha", "ha"), { min: 0.5, max: 1.5, when: (d) => d.rack === "custom" }),
    row("hf", tr("Výška paty h_fP*"), "number", 1.25, tr("jen vlastní profil: výška paty zubu v modulech"), "advanced", W("hf", "hf", "hf"), { min: 0.8, max: 2, when: (d) => d.rack === "custom" }),
    row("rho", tr("Zaoblení paty ρ_fP*"), "number", 0.38, tr("jen vlastní profil: poloměr zaoblení hlavy nástroje v modulech"), "advanced", W("rho", "rho", "rho"), { min: 0.05, max: 0.5, when: (d) => d.rack === "custom" }),
    row("k", tr("Zkrácení hlavy k"), "number", 0, tr("zkrácení hlavy zubu v modulech; režim Soukolí jím drží hlavovou vůli 0,25·m"), "advanced", W(["k", "zkrácení"], ["k", "tipshort"], ["k", "kopfkürzung"]), { min: 0, max: 0.3, step: 0.01, symbol: "k" }),
    row("ballD", tr("Průměr kuliček D_M"), "number", 0, tr("průměr měřicích kuliček / válečků pro rozměr M; 0 = automaticky 1,728·mₙ zaokrouhleno na 0,25 mm"), "advanced", W(["kulička", "balld"], ["ball", "balld"], ["kugel", "balld"]), { unit: "mm", min: 0, symbol: "D_M" }),
  );
  if (kind !== "internal") out.push(...bodyRows());
  out.push(...mateRows(), ...placeRows());
  return out;
}

const LABEL: Record<CylKind, () => string> = {
  spur: () => tr("Čelní kolo s přímými zuby"),
  helical: () => tr("Čelní kolo se šikmými zuby"),
  herringbone: () => tr("Čelní kolo se šípovými zuby"),
  internal: () => tr("Vnitřní ozubení (věnec)"),
};
const SHORT: Record<CylKind, () => string> = { spur: () => tr("čelní"), helical: () => tr("šikmé"), herringbone: () => tr("šípové"), internal: () => tr("vnitřní") };
const WORDS: Record<CylKind, ReturnType<typeof W>> = {
  spur: W(["čelní", "přímé"], ["spur", "straight"], ["stirnrad", "gerade"]),
  helical: W(["šikmé", "šikmá"], ["helical"], ["schräg", "schrägverzahnt"]),
  herringbone: W(["šípové", "šípová"], ["herringbone", "doublehelical"], ["pfeil", "pfeilverzahnt"]),
  internal: W(["vnitřní"], ["internal", "ring"], ["innen", "hohlrad"]),
};

function read(kind: CylKind, d: GearData): CylIn {
  const rackType = oneOf(d.rack, ["A", "B", "C", "D", "custom"] as const, "A");
  const m = num(d.m, 2);
  const helical = kind !== "spur";
  return {
    kind,
    m,
    z: int(d.z, 24),
    alpha: num(d.alpha, 20),
    x: num(d.x),
    beta: helical ? Math.abs(num(d.beta)) : 0,
    hand: oneOf(d.hand, ["right", "left"] as const, "right"),
    rack: rackOf(rackType, { ha: num(d.ha, 1), hf: num(d.hf, 1.25), rho: num(d.rho, 0.38) }),
    rackType,
    k: Math.max(0, num(d.k)),
    jn: Math.max(0, num(d.jn)),
    internal: kind === "internal",
    ballD: Math.max(0, num(d.ballD)),
    gap: kind === "herringbone" ? Math.max(0, num(d.gap)) : 0,
    rimD: Math.max(0, num(d.rimD)),
    body: kind === "internal" ? readBody({}, num(d.b, 20)) : readBody(d, num(d.b, 20)),
    place: readPlace(d),
    mateZ: Math.max(0, int(d.mateZ)),
    aw: Math.max(0, num(d.aw)),
    raw: d,
  };
}

function compute(i: CylIn): CylC {
  const g = cylGeom(i);
  const dM = i.ballD > 0 ? i.ballD : ballAuto(i.m);
  const { k } = i.internal ? { k: 0 } : spanTeeth(i, g);
  const Wk = i.internal ? NaN : spanW(i, g, k);
  const ob = overBalls(i, g, dM);
  const sign = i.hand === "left" ? -1 : 1;
  return {
    ...g,
    k,
    W: Wk,
    Wok: !i.internal && spanMeasurable(i, g, Wk, i.kind === "herringbone" ? (i.body.b - i.gap) / 2 : i.body.b),
    dM,
    M: ob.M,
    dK: ob.dK,
    rimD: i.internal ? (i.rimD > 0 ? i.rimD : g.df + 2 * Math.max(2.5 * i.m, 8)) : 0,
    twist: g.be > 1e-12 ? (sign * (i.kind === "herringbone" ? i.body.b / 2 : i.body.b) * Math.tan(g.be)) / g.r / DEG : 0,
  };
}

function validate(def: { rows: GearRow[] }, i: CylIn): ReturnType<typeof validation> {
  const out: Issue[] = rangeIssues(def.rows, i.raw);
  if (out.some((x) => x.level === "error")) return validation(out);
  const err = (key: string, code: string, text: string) => out.push({ level: "error", code, key, text });
  const warn = (key: string, code: string, text: string) => out.push({ level: "warn", code, key, text });
  const rhoMax = rackRhoMax(i.rack.hf, i.alpha);
  if (i.rack.rho > rhoMax + 1e-9) {
    err(i.rackType === "custom" ? "rho" : "alpha", "rho-max", tr("Zaoblení paty ρ = {0}·m se do základního profilu s úhlem {1}° a patou {2}·m nevejde (nejvýš {3}·m).", fmt(i.rack.rho), fmt(i.alpha), fmt(i.rack.hf), fmt(rhoMax, 3)));
    return validation(out);
  }
  if (i.jn > 0.3 * i.m) err("jn", "jn-max", tr("Boční vůle {0} mm je větší než 0,3·m – zub by byl příliš tenký.", fmt(i.jn)));
  const g = compute(i);
  if (i.internal) {
    if (g.tipLimited) out.push({ level: "info", code: "tip-limited", key: "z", text: tr("Hlavová kružnice věnce je zvětšena na Ø{0} (základní kružnice + 0,1·m), aby zuby končily na evolventě.", fmt(g.da, 3)) });
    if (!(g.rf - g.ra > 0.5 * i.m)) err("x", "int-depth", tr("Zub věnce vychází příliš nízký ({0} mm) – zmenšete posunutí x nebo zvětšete počet zubů.", fmt(g.rf - g.ra, 2)));
    if (!(g.san > 0)) err("x", "pointed", tr("Zub věnce je špičatý – zmenšete posunutí x."));
    if (!(g.rimD / 2 > g.rf + 0.5 * i.m)) err("rimD", "rim", tr("Vnější průměr věnce Ø{0} musí být větší než patní průměr Ø{1} aspoň o 1·m.", fmt(g.rimD), fmt(g.df, 2)));
    if (!(i.body.b > 0)) err("b", "b", tr("Šířka kola musí být kladná."));
    return validation(out);
  }
  if (!(g.xiC > -1e-9)) err("jn", "space", tr("Zubová mezera je u paty širší než rozteč – zmenšete boční vůli."));
  if (!(g.rf > 0.2 * i.m)) err("z", "root", tr("Patní průměr vychází záporný – zvětšete počet zubů nebo posunutí x."));
  const rp = pointedRadius(g);
  if (!(g.thetaA > 0)) err("x", "pointed", tr("Zub je špičatý – hlavová kružnice Ø{0} leží nad průsečíkem boků (Ø{1}). Zmenšete posunutí x nebo zvětšete zkrácení hlavy k.", fmt(g.da, 3), fmt(2 * rp, 3)));
  else if (g.san < 0.25 * i.m) warn("x", "thin-tip", tr("Tloušťka zubu na hlavě je jen {0} mm (méně než 0,25·m) – hlava se může vylomit; zmenšete x nebo zkraťte hlavu (k).", fmt(g.san, 3)));
  if (g.ra - g.rFf < 0.3 * i.m && g.thetaA > 0) err("x", "no-flank", tr("Z evolventního boku skoro nic nezbylo (začíná na Ø{0}, hlava je Ø{1}) – zvětšete posunutí x nebo počet zubů.", fmt(g.dFf, 3), fmt(g.da, 3)));
  if (g.undercut) warn("z", "undercut", tr("Zuby jsou podřezané (z = {0}): bez podřezání je potřeba posunutí x ≥ {1}. Model podřezání obsahuje tak, jak ho nástroj vyrobí.", i.z, fmt(Math.ceil(g.xMin * 100) / 100, 2)));
  if (i.kind === "herringbone") {
    if (i.gap > i.body.b / 3) err("gap", "gap", tr("Drážka uprostřed smí být nejvýš třetina šířky kola ({0} mm).", fmt(i.body.b / 3, 2)));
  }
  if (g.be > 1e-9 && !g.Wok && Number.isFinite(g.W)) out.push({ level: "info", code: "wk-width", key: "b", text: tr("Rozměr přes zuby W{0} nelze na takto úzkém šikmém kole změřit (potřebná šířka {1} mm) – použijte rozměr přes kuličky.", g.k, fmt(g.W * Math.sin(g.bb) + 1.2 * i.m, 1)) });
  out.push(...bodyIssues(i.body, { rootR: g.rf, tipR: g.ra, m: i.m }));
  return validation(out);
}

export const handLabel = (h: string) => (h === "left" ? tr("levý") : tr("pravý"));

function dataRows(i: CylIn, c: CylC): GearDataRow[] {
  const R = (key: string, label: string, symbol: string, value: string, unit: string, group: GearDataRow["group"]): GearDataRow => ({ key, label, ...(symbol ? { symbol } : {}), value, ...(unit ? { unit } : {}), group });
  const out: GearDataRow[] = [
    R("m", tr("Modul"), "mₙ", loc(fmt(i.m, 4)), "mm", "basic"),
    R("z", tr("Počet zubů"), "z", String(i.z), "", "basic"),
    R("rack", tr("Základní profil"), "", rackName(i.rackType), "", "basic"),
    R("alpha", tr("Úhel záběru"), "αₙ", fix(i.alpha, 2), "°", "basic"),
  ];
  if (i.beta > 0) out.push(R("beta", tr("Úhel sklonu"), "β", `${fix(i.beta, 3)} ${handLabel(i.hand)}`, "°", "basic"));
  out.push(R("x", tr("Posunutí profilu"), "x", fix(i.x, 4), "", "basic"));
  if (i.k > 0) out.push(R("k", tr("Zkrácení hlavy"), "k", fix(i.k, 4), "", "basic"));
  out.push(
    R("d", tr("Roztečný průměr"), "d", fix(c.d), "mm", "geometry"),
    R("da", tr("Hlavový průměr"), "dₐ", fix(c.da), "mm", "geometry"),
    R("df", tr("Patní průměr"), "d_f", fix(c.df), "mm", "geometry"),
    R("db", tr("Základní průměr"), "d_b", fix(c.db), "mm", "geometry"),
    R("h", tr("Výška zubu"), "h", fix(c.h), "mm", "geometry"),
    R("p", tr("Rozteč"), "p", fix(c.pn), "mm", "geometry"),
  );
  if (i.beta > 0) out.push(R("pz", tr("Stoupání šroubovice"), "p_z", fix(c.pz, 2), "mm", "geometry"));
  if (i.internal) out.push(R("rimD", tr("Vnější průměr věnce"), "D", fix(c.rimD), "mm", "geometry"));
  out.push(R("sn", tr("Tloušťka zubu"), "sₙ", fix(c.sn), "mm", "check"));
  if (!i.internal) out.push(R("Wk", tr("Rozměr přes zuby"), `W${c.k}`, `${fix(c.W)}${c.Wok ? "" : " *"}`, "mm", "check"), R("k", tr("Počet měřených zubů"), "k", String(c.k), "", "check"));
  out.push(R("MdK", i.internal ? tr("Rozměr mezi kuličkami") : tr("Rozměr přes kuličky"), "M_dK", fix(c.M), "mm", "check"), R("dM", tr("Průměr kuličky"), "D_M", fix(c.dM, 3), "mm", "check"));
  if (i.jn > 0) out.push(R("jn", tr("Boční vůle – podíl kola"), "jₙ", fix(i.jn, 3), "mm", "check"));
  if (i.mateZ > 0) out.push(R("mateZ", tr("Počet zubů protikola"), "z₂", String(i.mateZ), "", "pair"));
  if (i.aw > 0) out.push(R("aw", tr("Osová vzdálenost"), "a_w", fix(i.aw), "mm", "pair"));
  return out;
}

/** popis těla pro souhrn (`díra 20 pero`, `náboj 40×15`) a způsobu výstupu */
export function bodySummary(o: BodyOpts, p: Place): string {
  const parts: string[] = [];
  if (o.bore > 0) parts.push(tr("díra {0}{1}", fmt(o.bore), o.keyway ? tr(" pero") : ""));
  if (o.hubD > 0 && o.hubL > 0) parts.push(tr("náboj {0}×{1}", fmt(o.hubD), fmt(o.hubL)));
  if (o.holesN > 0) parts.push(tr("díry {0}×Ø{1}", o.holesN, fmt(o.holesD)));
  parts.push(p.out === "blank" ? tr("polotovar") : p.out === "teeth" ? tr("zuby do tělesa") : tr("kolo"));
  return parts.join(" · ");
}

function make(kind: CylKind): KindDef<CylIn, CylC> {
  const rws = rows(kind);
  const def: KindDef<CylIn, CylC> = {
    kind: kind as GearKind,
    ext: `gear.${kind}` as GearExt,
    label: LABEL[kind](),
    short: SHORT[kind](),
    standards: ["ISO 53", "ISO 54", "ISO 21771", "DIN 3960", "DIN 6885-1"],
    rows: rws,
    phrases: kind === "internal" ? [] : bodyPhrases(),
    words: WORDS[kind],
    accuracy:
      kind === "internal"
        ? tr("Přesně: evolventní boky a průměry. Přibližně: zaoblení paty (oblouk 0,3·m – skutečné závisí na obrážecím noži); kontrola kolize hlav se spoluzabírajícím pastorkem je jen orientační.")
        : kind === "spur"
          ? tr("Přesně: evolventa, přechodová křivka paty (trochoida základního hřebene se zaoblením ρ), podřezání, kružnice. Nemodeluje se: modifikace hlavy a podélná modifikace zubu.")
          : tr("Přesně: evolventa, přechodová křivka paty, podřezání a šroubová plocha boku (proložená, odchylka pod 0,0002 mm). Nemodeluje se: modifikace zubu; u šípového ozubení výběh nástroje ve hrotu."),
    defaults: () => defaultsOf(rws),
    read: (d) => read(kind, d),
    validate: (i) => validate(def, i),
    compute,
    profile: (i, c) => cylProfile(i, c),
    blank: (i, c): Vec2[] => {
      if (i.internal) return [[c.ra, 0], [c.rimD / 2, 0], [c.rimD / 2, i.body.b], [c.ra, i.body.b]];
      const sec = discSection(i.body, { tipR: c.ra, rootR: c.rf, m: i.m });
      if (i.gap > 0) {
        // odlehčovací drážka šípového ozubení: zapuštěná 0,3·m pod patní kružnici
        const k = sec.findIndex((p, n) => Math.abs(p[0] - c.ra) < 1e-9 && Math.abs(sec[(n + 1) % sec.length][0] - c.ra) < 1e-9);
        const rg = c.rf - 0.3 * i.m;
        if (k >= 0) sec.splice(k + 1, 0, [c.ra, (i.body.b - i.gap) / 2], [rg, (i.body.b - i.gap) / 2], [rg, (i.body.b + i.gap) / 2], [c.ra, (i.body.b + i.gap) / 2]);
      }
      return sec;
    },
    dataRows,
    summary: (i, c) =>
      [
        `${SHORT[kind]()} m${fmt(i.m)} z${i.z}${i.beta > 0 ? ` β${fmt(i.beta)}° ${handLabel(i.hand)}` : ""} x${fmt(i.x, 4)} b${fmt(i.body.b)}`,
        `d ${fmt(c.d, 3)}`,
        `dₐ ${fmt(c.da, 3)}`,
        i.internal ? `M ${fix(c.M)}` : `W${c.k} ${fix(c.W)}`,
        i.internal ? tr("věnec Ø{0}", fmt(c.rimD, 2)) + (i.place.out === "wheel" ? "" : ` · ${i.place.out === "blank" ? tr("polotovar") : tr("zuby do tělesa")}`) : bodySummary(i.body, i.place),
      ].join(" · "),
    name: (i) => (kind === "internal" ? tr("Vnitřní ozubení m{0} z{1}", fmt(i.m), i.z) : tr("Ozubené kolo m{0} z{1}", fmt(i.m), i.z)),
  };
  return def;
}

export const SPUR = make("spur");
export const HELICAL = make("helical");
export const HERRINGBONE = make("herringbone");
export const INTERNAL = make("internal");
/** pomocné pro ostatní druhy (šnekové kolo) */
export { bool };
