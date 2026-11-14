/**
 * Poloha roviny řezu A–A výkresu (`výkres řez XZ|YZ|XY odsazení N`, Řez A–A ve výkresovém prostředí).
 *
 * Od vlny 15 se odsazení měří STEJNĚ JAKO U SKICI (`skica XZ odsazení N`, replicad `makePlane(name, N)`): podél normály
 * roviny skici – XY: z = +N, YZ: x = +N, XZ: y = −N (normála roviny XZ míří do −Y). Řez se tak dá zadat stejným číslem
 * jako skica v téže rovině. Uložené řezy bez příznaku `normal` (dokumenty před vlnou 15) mají v `offset` přímo souřadnici
 * na ose (y u XZ) – čtou se podle verze a staví se beze změny; nové řezy (text i výkresové prostředí) příznak nesou.
 *
 * Čisté funkce bez jádra (testovatelné v Node); řez počítá cad/drawing.ts (`makeDrawing` převede řez na souřadnici
 * funkcí `absoluteSection` hned na začátku – vše další pracuje se souřadnicí na ose).
 */
import { cadLocale, tr } from "./i18n";
import type { SectionOpt } from "./drawing";
import type { PlaneName, Vec3 } from "./types";

/** osa kolmá na rovinu řezu (0 = X, 1 = Y, 2 = Z) */
export const SECTION_AXIS: Record<PlaneName, 0 | 1 | 2> = { YZ: 0, XZ: 1, XY: 2 };
/** smysl normály roviny jako u skici (replicad): XY +Z, XZ −Y, YZ +X */
export const SKETCH_NORMAL_SIGN: Record<PlaneName, 1 | -1> = { XY: 1, XZ: -1, YZ: 1 };
const AXIS_NAME = ["X", "Y", "Z"] as const;

const fmt = (n: number) => (Math.round(n * 1000) / 1000 || 0).toLocaleString(cadLocale(), { useGrouping: false, maximumFractionDigits: 3 });
const clean = (n: number) => (Object.is(n, -0) ? 0 : n);

/** Souřadnice roviny řezu na ose kolmé k rovině (y u XZ) – podle verze uloženého řezu. */
export function sectionCoord(sec: Pick<SectionOpt, "plane" | "offset" | "normal">): number {
  return clean(sec.normal ? SKETCH_NORMAL_SIGN[sec.plane] * sec.offset : sec.offset);
}

/** Nový řez (konvence skici) v rovině `plane` procházející souřadnicí `coord` na ose kolmé k rovině. */
export function sectionAt(plane: PlaneName, coord: number, kind?: SectionOpt["kind"]): SectionOpt {
  return { plane, offset: clean(SKETCH_NORMAL_SIGN[plane] * coord), normal: true, ...(kind ? { kind } : {}) };
}

/** Řez se souřadnicí na ose v `offset` (bez příznaku) – tvar, se kterým počítá jádro výkresu. */
export function absoluteSection(sec: SectionOpt): SectionOpt {
  const { normal: _n, ...rest } = sec;
  void _n;
  return { ...rest, offset: sectionCoord(sec) };
}

/** Převede uložený řez na konvenci skici (stejná rovina v prostoru, příznak `normal`) – pro úpravy ve výkresovém prostředí. */
export function sectionToSketchConvention(sec: SectionOpt): SectionOpt {
  return sec.normal ? sec : sectionAt(sec.plane, sec.offset, sec.kind);
}

/** „XZ odsazení 57 (rovina Y = −57)“ – popis řezu do protokolu a stavu výkresu. */
export function sectionText(sec: SectionOpt): string {
  const k = SECTION_AXIS[sec.plane];
  return tr("{0} odsazení {1} (rovina {2} = {3})", sec.plane, fmt(sec.offset), AXIS_NAME[k], fmt(sectionCoord(sec)));
}

/**
 * Popis řezu do stavu výkresu: u staršího řezu (bez příznaku, `offset` = souřadnice) odsazení v DNEŠNÍ konvenci a označení
 * „starší řez“ – odsazení ze stavu tak jde zkopírovat do příkazu `výkres řez …` a dá stejnou rovinu.
 */
export function sectionStatusText(sec: SectionOpt, kind: string): string {
  if (sec.normal) return tr("řez {0} {1}", sectionText(sec), kind);
  const now = sectionAt(sec.plane, sec.offset);
  return tr("řez {0} {1}", sectionText(now), kind) + tr(" – starší řez uložený souřadnicí {0} = {1}; týž řez příkazem: výkres řez {2} odsazení {3}", AXIS_NAME[SECTION_AXIS[sec.plane]], fmt(sec.offset), sec.plane, fmt(now.offset));
}

/** Rozsah odsazení (konvence skici), pro který rovina protne obálku tělesa `bbox` – [min, max]. */
export function sectionOffsetRange(plane: PlaneName, bbox: [Vec3, Vec3]): [number, number] {
  const k = SECTION_AXIS[plane];
  const s = SKETCH_NORMAL_SIGN[plane];
  const a = clean(s * bbox[0][k]);
  const b = clean(s * bbox[1][k]);
  return [Math.min(a, b), Math.max(a, b)];
}

/**
 * Rovina řezu mimo těleso (jádro pak řez nevytvoří): null = protíná obálku, jinak text hlášky s rozsahem tělesa na ose
 * a otevřeným rozsahem odsazení, které by řez dal („rovina Y = 57 leží mimo těleso (Y −308…0) – … větší než 0 a menší než 308 …,
 * např. 154“).
 * Rovina na hranici obálky se počítá jako mimo (shodně s jádrem – řez by neměl plochu).
 */
export function sectionMiss(sec: SectionOpt, bbox: [Vec3, Vec3]): string | null {
  const k = SECTION_AXIS[sec.plane];
  const c = sectionCoord(sec);
  const lo = bbox[0][k];
  const hi = bbox[1][k];
  if (c > lo + 1e-9 && c < hi - 1e-9) return null;
  const ax = AXIS_NAME[k];
  // starší řez: odsazení je přímo souřadnice na ose
  // rozsah je otevřený: rovina v krajní hodnotě leží na ploše tělesa a řez by neměl plochu – proto i příklad uvnitř
  if (!sec.normal) return tr("rovina řezu {0} = {1} leží mimo těleso ({0} {2}…{3}) – u tohoto (staršího) řezu je odsazení souřadnicí {0}; řez protne těleso pro odsazení větší než {2} a menší než {3} (krajní hodnoty leží na ploše tělesa), např. {4}", ax, fmt(c), fmt(lo), fmt(hi), fmt((lo + hi) / 2));
  const [o0, o1] = sectionOffsetRange(sec.plane, bbox);
  return tr("rovina řezu {0} = {1} leží mimo těleso ({0} {2}…{3}) – odsazení {4} se měří podél normály roviny {5} jako u skici; řez protne těleso pro odsazení větší než {6} a menší než {7} (krajní hodnoty leží na ploše tělesa), např. {8}", ax, fmt(c), fmt(lo), fmt(hi), fmt(sec.offset), sec.plane, fmt(o0), fmt(o1), fmt((o0 + o1) / 2));
}
