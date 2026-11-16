/**
 * Vstupní řádky tabulek pružin – jeden popis pro tabulku v průvodci, formulář úpravy, parametry prvku rozšíření (obecný příkaz
 * `prvek spring.*`, `prvek nápověda`), textový příkaz `pružina …` (slova CS / EN / DE) i převodník dokument → skript.
 */
import { tr } from "../i18n";
import { SUPPORTS, endsLabel } from "./compression";
import { DISC_SIZES } from "./disc";
import { LOOPS, loopLabel } from "./extension";
import { WIRE_MATERIALS, materialLabel } from "./materials";
import { LEGS, legLabel } from "./torsion";
import type { SpringData, SpringKind, SpringRow } from "./types";

const W = (cs: string[], en: string[], de: string[]) => ({ cs, en, de });

const wire = (): SpringRow => ({ key: "d", label: tr("průměr drátu d"), symbol: "d", kind: "number", unit: "mm", required: true, min: 0.1, max: 30, step: 0.1, hint: tr("EN 10270 – běžné průměry 0,5 · 0,8 · 1 · 1,25 · 1,6 · 2 · 2,5 · 3 · 4 · 5 mm"), group: "basic", words: W(["d", "drát", "drat"], ["d", "wire"], ["d", "draht"]) });
const dia = (): SpringRow[] => [
  { key: "De", label: tr("vnější průměr De"), symbol: "De", kind: "number", unit: "mm", alt: "dia", min: 0.5, step: 0.5, hint: tr("stačí jeden průměr: vnější De (pro otvor), střední D nebo vnitřní Di (pro trn)"), group: "basic", words: W(["De", "vnější", "vnejsi"], ["De", "od", "outer"], ["De", "außen", "aussen", "da"]) },
  { key: "D", label: tr("střední průměr D"), symbol: "D", kind: "number", unit: "mm", alt: "dia", min: 0.5, step: 0.5, hint: tr("D = De − d = Di + d"), group: "basic", words: W(["D", "střední", "stredni"], ["D", "mean"], ["D", "mittel", "dm"]) },
  { key: "Di", label: tr("vnitřní průměr Di"), symbol: "Di", kind: "number", unit: "mm", alt: "dia", min: 0.1, step: 0.5, hint: tr("vnitřní průměr – volí se podle trnu"), group: "basic", words: W(["Di", "vnitřní", "vnitrni"], ["Di", "id", "inner"], ["Di", "innen"]) },
];
const material = (): SpringRow => ({
  key: "material",
  label: tr("materiál"),
  kind: "enum",
  def: "SH",
  options: WIRE_MATERIALS.map((m) => ({ v: m, l: materialLabel(m) })),
  hint: tr("G a Rm podle EN 13906-1 a EN 10270-1/-2/-3; DH = pro dynamické zatížení"),
  group: "material",
  words: W(["materiál", "material"], ["material"], ["werkstoff", "material"]),
  enumWords: { SH: W(["SH"], ["SH"], ["SH"]), DH: W(["DH"], ["DH"], ["DH"]), VDSiCr: W(["VDSiCr"], ["VDSiCr"], ["VDSiCr"]), "1.4310": W(["1.4310", "nerez"], ["1.4310", "stainless"], ["1.4310", "edelstahl"]) },
});
const hand = (): SpringRow => ({ key: "hand", label: tr("smysl vinutí"), kind: "enum", def: "right", options: [{ v: "right", l: tr("pravé") }, { v: "left", l: tr("levé") }], hint: tr("pravé vinutí je obvyklé (EN 13906)"), group: "material", words: W(["vinutí", "vinuti"], ["hand", "winding"], ["wicklung", "windungssinn"]), enumWords: { right: W(["pravé", "prave", "pravá", "prava"], ["right"], ["rechts"]), left: W(["levé", "leve", "levá", "leva"], ["left"], ["links"]) } });
const load = (o: { L: string; F: string; unitF?: string; hintL: string; hintF: string; label: string; labelF: string; key: "1" | "2" }): SpringRow[] => [
  { key: `${o.L}${o.key}`, label: o.label, symbol: `${o.L}${o.key}`, kind: "number", unit: o.L === "a" ? "°" : "mm", min: 0, step: o.L === "a" ? 5 : 0.5, hint: o.hintL, group: "load", alt: `load${o.key}`, words: W([`${o.L}${o.key}`], [`${o.L}${o.key}`], [`${o.L}${o.key}`]) },
  { key: `${o.F}${o.key}`, label: o.labelF, symbol: `${o.F}${o.key}`, kind: "number", unit: o.unitF ?? "N", min: 0, step: 1, hint: o.hintF, group: "load", alt: `load${o.key}`, words: W([`${o.F}${o.key}`], [`${o.F}${o.key}`], [`${o.F}${o.key}`]) },
];

export function compressionRows(): SpringRow[] {
  return [
    wire(),
    ...dia(),
    { key: "L0", label: tr("volná délka L0"), symbol: "L0", kind: "number", unit: "mm", required: true, min: 1, step: 1, hint: tr("délka nezatížené pružiny (konce v 0 a L0)"), group: "basic", words: W(["L0", "délka", "delka"], ["L0", "length"], ["L0", "länge", "laenge"]) },
    { key: "n", label: tr("činné závity n"), symbol: "n", kind: "number", alt: "coils", min: 1, step: 0.5, hint: tr("pružící závity; celkem nt = n + 2 u přiložených konců (EN 13906-1)"), group: "basic", required: true, words: W(["n", "závity", "zavity"], ["n", "coils"], ["n", "windungen"]) },
    { key: "nt", label: tr("celkový počet závitů nt"), symbol: "nt", kind: "number", alt: "coils", min: 1, step: 0.5, hint: tr("místo n: celkový počet závitů včetně závěrných"), group: "basic", words: W(["nt", "celkem"], ["nt", "total"], ["nt", "gesamt"]) },
    {
      key: "ends",
      label: tr("konce"),
      kind: "enum",
      def: "ground",
      options: (["ground", "closed", "open"] as const).map((e) => ({ v: e, l: endsLabel(e) })),
      hint: tr("přiložené a broušené = rovné dosedací plochy kolmé na osu (výchozí pro střižné nástroje)"),
      group: "ends",
      words: W(["konce", "konec"], ["ends"], ["enden", "ende"]),
      enumWords: { ground: W(["broušené", "brousene", "broušený", "brouseny"], ["ground"], ["geschliffen"]), closed: W(["přiložené", "prilozene", "neobroušené", "neobrousene"], ["closed", "unground"], ["angelegt", "ungeschliffen"]), open: W(["otevřené", "otevrene"], ["open"], ["offen"]) },
    },
    material(),
    ...load({ L: "L", F: "F", key: "1", label: tr("pracovní délka L1"), labelF: tr("síla F1"), hintL: tr("předepnutá délka v nástroji (méně stlačená)"), hintF: tr("místo L1: požadovaná síla při L1") }),
    ...load({ L: "L", F: "F", key: "2", label: tr("pracovní délka L2"), labelF: tr("síla F2"), hintL: tr("nejkratší pracovní délka (konec zdvihu) – musí být ≥ Ln + Sa"), hintF: tr("místo L2: požadovaná síla při L2") }),
    { key: "nu", label: tr("uložení konců (vzpěr)"), symbol: "ν", kind: "enum", def: "0.5", options: SUPPORTS.map((s) => ({ v: s.v, l: s.l() })), hint: tr("součinitel uložení ν pro kontrolu vzpěru (EN 13906-1 obr. 5)"), group: "ends", words: W(["uložení", "ulozeni"], ["support"], ["lagerung"]) },
    hand(),
  ];
}

export function extensionRows(): SpringRow[] {
  const loopRow = (key: "loop" | "loop2", label: string, words: ReturnType<typeof W>): SpringRow => ({
    key,
    label,
    kind: "enum",
    def: "german",
    options: LOOPS.map((l) => ({ v: l, l: loopLabel(l) })),
    hint: tr("EN 13906-2: německé očko LH ≈ Di, poloviční ≈ 0,75·D − d, boční celé ≈ Di"),
    group: "ends",
    words,
    enumWords: { german: W(["německé", "nemecke", "celé", "cele"], ["german", "full"], ["deutsche", "deutsch", "ganze"]), half: W(["poloviční", "polovicni", "půl", "pul"], ["half"], ["halbe", "halb"]), side: W(["boční", "bocni"], ["side", "english"], ["seitlich", "englisch"]) },
  });
  return [
    wire(),
    ...dia(),
    { key: "n", label: tr("závity těla n"), symbol: "n", kind: "number", required: true, min: 1, step: 0.25, hint: tr("počet závitů těla; desetinná část určuje natočení oček (0,5 = 180°)"), group: "basic", words: W(["n", "závity", "zavity"], ["n", "coils"], ["n", "windungen"]) },
    { key: "F0", label: tr("předpětí F0"), symbol: "F0", kind: "number", unit: "N", def: 0, min: 0, step: 0.5, hint: tr("vnitřní předpětí těsně vinutého těla – pod F0 se pružina neprotáhne"), group: "basic", words: W(["F0", "předpětí", "predpeti"], ["F0", "preload"], ["F0", "vorspannung"]) },
    loopRow("loop", tr("očka"), W(["očko", "ocko", "očka", "ocka"], ["loop", "loops"], ["öse", "oese", "ösen", "oesen"])),
    loopRow("loop2", tr("druhé očko"), W(["očko2", "ocko2"], ["loop2"], ["öse2", "oese2"])),
    { key: "angle", label: tr("natočení oček"), kind: "enum", options: ["0", "90", "180", "270"].map((v) => ({ v, l: `${v}°` })), hint: tr("vzájemné natočení oček – upraví desetinnou část počtu závitů"), group: "ends", words: W(["natočení", "natoceni"], ["angle"], ["versatz"]) },
    material(),
    ...load({ L: "L", F: "F", key: "1", label: tr("pracovní délka L1"), labelF: tr("síla F1"), hintL: tr("délka mezi vnitřními okraji oček v 1. poloze"), hintF: tr("místo L1: síla v 1. poloze") }),
    ...load({ L: "L", F: "F", key: "2", label: tr("pracovní délka L2"), labelF: tr("síla F2"), hintL: tr("největší pracovní délka (≤ Ln)"), hintF: tr("místo L2: největší pracovní síla") }),
    hand(),
  ];
}

export function torsionRows(): SpringRow[] {
  const legRow = (key: "leg1" | "leg2", label: string, words: ReturnType<typeof W>): SpringRow => ({
    key,
    label,
    kind: "enum",
    def: "tangential",
    options: LEGS.map((l) => ({ v: l, l: legLabel(l) })),
    hint: tr("tečné = pokračuje po tečně závitu, radiální = ven od osy, osové = podél osy"),
    group: "ends",
    words,
    enumWords: { tangential: W(["tečné", "tecne", "tečná", "tecna"], ["tangential"], ["tangential"]), radial: W(["radiální", "radialni"], ["radial"], ["radial"]), axial: W(["osové", "osove", "osová", "osova", "axiální", "axialni"], ["axial"], ["axial"]) },
  });
  return [
    wire(),
    ...dia(),
    { key: "n", label: tr("závity n"), symbol: "n", kind: "number", required: true, min: 1, step: 0.25, hint: tr("počet závitů; desetinná část = úhel ramen ve volném stavu (0,25 = 90°)"), group: "basic", words: W(["n", "závity", "zavity"], ["n", "coils"], ["n", "windungen"]) },
    legRow("leg1", tr("rameno 1"), W(["rameno1"], ["leg1"], ["schenkel1"])),
    { key: "l1", label: tr("délka ramene 1"), symbol: "l1", kind: "number", unit: "mm", def: 25, min: 0, step: 1, hint: tr("přímá část ramene za ohybem"), group: "ends", words: W(["l1"], ["l1"], ["l1"]) },
    legRow("leg2", tr("rameno 2"), W(["rameno2"], ["leg2"], ["schenkel2"])),
    { key: "l2", label: tr("délka ramene 2"), symbol: "l2", kind: "number", unit: "mm", def: 25, min: 0, step: 1, hint: tr("přímá část ramene za ohybem"), group: "ends", words: W(["l2"], ["l2"], ["l2"]) },
    material(),
    ...load({ L: "a", F: "M", unitF: "N·mm", key: "1", label: tr("úhel natočení α1"), labelF: tr("moment M1"), hintL: tr("natočení ramen z volné polohy ve stupních"), hintF: tr("místo α1: moment v N·mm") }),
    ...load({ L: "a", F: "M", unitF: "N·mm", key: "2", label: tr("úhel natočení α2"), labelF: tr("moment M2"), hintL: tr("největší pracovní natočení ve stupních"), hintF: tr("místo α2: největší moment v N·mm") }),
    hand(),
  ];
}

export function discRows(): SpringRow[] {
  return [
    { key: "series", label: tr("řada DIN 2093"), kind: "enum", def: "A", options: [{ v: "A", l: tr("A – tuhá (De/t ≈ 18)") }, { v: "B", l: tr("B – střední (De/t ≈ 28)") }, { v: "C", l: tr("C – měkká (De/t ≈ 40)") }, { v: "custom", l: tr("vlastní rozměry") }], hint: tr("DIN 2093 / EN 16983 – řada určuje poměr tloušťky a výšky kužele"), group: "basic", required: true, words: W(["řada", "rada"], ["series"], ["reihe"]), enumWords: { A: W(["A"], ["A"], ["A"]), B: W(["B"], ["B"], ["B"]), C: W(["C"], ["C"], ["C"]), custom: W(["vlastní", "vlastni"], ["custom"], ["eigene"]) } },
    { key: "De", label: tr("vnější průměr De"), symbol: "De", kind: "number", unit: "mm", required: true, min: 1, step: 0.5, hint: tr("u řad A/B/C jen rozměry z DIN 2093: 8 · 10 · 12,5 · 14 · 16 · 18 · 20 · 22,5 · 25 · 28 · 31,5 · 35,5 · 40 · 45 · 50 · 56 · 63 · 71 · 80 · 90 · 100 · 112 · 125 … 250"), group: "basic", words: W(["De"], ["De"], ["De"]) },
    { key: "Di", label: tr("vnitřní průměr Di"), symbol: "Di", kind: "number", unit: "mm", min: 0.5, step: 0.1, hint: tr("jen u vlastních rozměrů"), group: "basic", when: (d) => d.series === "custom", words: W(["Di"], ["Di"], ["Di"]) },
    { key: "t", label: tr("tloušťka t"), symbol: "t", kind: "number", unit: "mm", min: 0.1, step: 0.05, hint: tr("jen u vlastních rozměrů"), group: "basic", when: (d) => d.series === "custom", words: W(["t"], ["t"], ["t"]) },
    { key: "h0", label: tr("výška kužele h0"), symbol: "h0", kind: "number", unit: "mm", min: 0.05, step: 0.05, hint: tr("jen u vlastních rozměrů (h0/t < 1,3 – průběh síly bez poklesu)"), group: "basic", when: (d) => d.series === "custom", words: W(["h0"], ["h0"], ["h0"]) },
    { key: "ns", label: tr("talířů za sebou"), symbol: "i", kind: "number", def: 1, min: 1, max: 60, step: 1, hint: tr("střídavě obrácené talíře – zvětší zdvih (sloupec)"), group: "ends", words: W(["ns", "zasebou"], ["ns", "inseries"], ["ns", "wechselsinnig"]) },
    { key: "np", label: tr("talířů v sobě (paralelně)"), symbol: "n", kind: "number", def: 1, min: 1, max: 6, step: 1, hint: tr("souhlasně vložené talíře – zvětší sílu"), group: "ends", words: W(["np", "vsobě", "vsobe"], ["np", "parallel"], ["np", "gleichsinnig"]) },
    ...load({ L: "L", F: "F", key: "1", label: tr("pracovní délka L1"), labelF: tr("síla F1"), hintL: tr("výška sloupce v 1. poloze"), hintF: tr("místo L1: síla sloupce") }),
    ...load({ L: "L", F: "F", key: "2", label: tr("pracovní délka L2"), labelF: tr("síla F2"), hintL: tr("výška sloupce na konci zdvihu (zdvih talíře ≤ 0,75 h0)"), hintF: tr("místo L2: síla sloupce") }),
  ];
}

export const rowsOf = (k: SpringKind): SpringRow[] => (k === "compression" ? compressionRows() : k === "extension" ? extensionRows() : k === "torsion" ? torsionRows() : discRows());
/** rozměry DIN 2093 pro výběr v tabulce (řada → De) */
export const discPresets = (series: string) => DISC_SIZES.filter((x) => x.s === series).map((x) => x.De);
/** řádek je vidět (podmínka `when`) */
export const rowVisible = (r: SpringRow, d: SpringData) => !r.when || r.when(d);
