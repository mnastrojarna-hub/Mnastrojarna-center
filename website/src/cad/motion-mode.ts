/**
 * Režim pohybové studie a úroveň simulace (vlna 22, bod 2 zprávy – jediná definice pro celou vlnu):
 *
 * | režim (`MotionStudy.mode`) | co počítá | úroveň výsledku |
 * |---|---|---|
 * | `kinematic` | polohy jen z vazeb a motorů; pružiny se měří, ale netlačí; díl, kterého poloha vazbami určena není (volný v mezi), zůstává, kde byl – ⚠ `motion.undetermined` | `kinematic` |
 * | `quasistatic` | v každém kroku rovnováha pružin a jednostranných kontaktů (meze vazeb, délka pružiny na doraz Ln) – nezávisle na předchozím kroku, směru přehrávání i historii úprav (cad/motion-quasi.ts) | `quasistatic` |
 * | `dynamic` | přechodový děj s hmotnostmi, gravitací a silami (cad/motion-dynamic.ts) | `dynamic` |
 * | nezadáno = automaticky | kvazistatika, když pružina dosedá na pohyblivou komponentu; jinak kinematika | podle volby |
 *
 * Úroveň `animation` = výměna / zobrazení bez výpočtu poloh (fáze studie, etapa M3); příznak `geo` doplní procesní vrstva (C3:
 * „+ geometrická aproximace“). Etapa M3 volá `studyMode(doc, study, phase)` po fázích – fáze s vlastním režimem ho přebije.
 * Úroveň se tiskne v každém protokolu studie (`levelLine`, strojově `level=` na konci řádku `= … motion …`) a v panelu.
 */
import { springComps } from "./asm-spring";
import { tr } from "./i18n";
import type { CadDoc, MotionStudy } from "./types";

export type StudyMode = NonNullable<MotionStudy["mode"]>;
export type SimLevel = "animation" | "kinematic" | "quasistatic" | "dynamic";
/** úroveň výsledku: `auto` = režim zvolil program (studie bez výslovného režimu), `why` = proč; `geo` = + geometrická aproximace (C3) */
export type LevelInfo = { level: SimLevel; auto?: boolean; why?: string; geo?: boolean };

/** komponenty, se kterými může pohnout řešič: nejsou ukotvené (příznak ani vazba Ukotvit) a mají aktivní vazbu */
function movable(doc: CadDoc): Set<string> {
  const mates = (doc.mates ?? []).filter((m) => !m.suppressed);
  const fixed = new Set((doc.components ?? []).filter((c) => c.fixed).map((c) => c.id));
  for (const m of mates) if (m.type === "fixed") fixed.add(m.a.compId);
  const out = new Set<string>();
  for (const m of mates) if (m.type !== "fixed") for (const r of [m.a, m.b, m.c, m.d]) if (r && !fixed.has(r.compId)) out.add(r.compId);
  return out;
}

/** Pružiny, které by v kvazistatice tlačily: dosedají na komponentu, se kterou může pohnout řešič. */
export function activeSprings(doc: CadDoc): { id: string; name: string }[] {
  const mov = movable(doc);
  return springComps(doc)
    .filter((c) => mov.has(c.spring!.a.compId) || mov.has(c.spring!.b.compId))
    .map((c) => ({ id: c.id, name: c.name }));
}

/**
 * Režim studie (fáze `phase` s vlastním režimem ho přebije – etapa M3). Bez výslovného režimu: kvazistatika, když na pohyblivou
 * komponentu dosedá pružina (předpětí pak určuje polohu volného dílu), jinak kinematika.
 */
export function studyMode(doc: CadDoc, study: Pick<MotionStudy, "mode"> | undefined, phase?: { mode?: StudyMode }): { mode: StudyMode; auto: boolean; why?: string } {
  const explicit = phase?.mode ?? study?.mode;
  if (explicit) return { mode: explicit, auto: false };
  const sp = activeSprings(doc);
  if (sp.length) return { mode: "quasistatic", auto: true, why: tr("sestava má pružinu „{0}“ na pohyblivé komponentě", sp[0].name) };
  return { mode: "kinematic", auto: true, why: tr("sestava nemá pružinu na pohyblivé komponentě") };
}

/** úroveň simulace výsledku podle režimu */
export const levelOf = (m: { mode: StudyMode; auto: boolean; why?: string }): LevelInfo => ({ level: m.mode, ...(m.auto ? { auto: true } : {}), ...(m.why ? { why: m.why } : {}) });

/** název úrovně: „kinematika“, „kvazistatika“, „dynamika“, „animace“ (+ „ + geometrická aproximace“) */
export function levelName(l: Pick<LevelInfo, "level" | "geo">): string {
  const n = l.level === "kinematic" ? tr("kinematika") : l.level === "quasistatic" ? tr("kvazistatika") : l.level === "dynamic" ? tr("dynamika") : tr("animace");
  return l.geo ? tr("{0} + geometrická aproximace", n) : n;
}

/** jedna věta, co úroveň počítá (protokol, panel, návod) */
export function levelMeaning(level: SimLevel): string {
  switch (level) {
    case "kinematic":
      return tr("polohy jen z vazeb a motorů – pružiny se měří, ale netlačí; díl, kterého polohu vazby neurčují, zůstává, kde byl");
    case "quasistatic":
      return tr("v každém kroku rovnováha pružin a kontaktů (meze vazeb, délka pružiny na doraz) – nezávisle na předchozím kroku a směru pohybu");
    case "dynamic":
      return tr("přechodový děj s hmotnostmi, gravitací a silami pružin v čase");
    default:
      return tr("jen zobrazení (výměna dílů) bez výpočtu poloh");
  }
}

/** Řádek protokolu: „Úroveň simulace: kvazistatika – … (zvoleno automaticky: …; jiná: pohyb kinematika|dynamika)“. */
export function levelLine(l: LevelInfo): string {
  const how = l.auto ? tr(" (zvoleno automaticky: {0}; jiný režim: pohyb kinematika | kvazistatika | dynamika)", l.why ?? "") : "";
  return tr("Úroveň simulace: {0} – {1}{2}", levelName(l), levelMeaning(l.level), how);
}

/** strojová podoba úrovně na konci řádku `= … motion …`: `level=kin|quasi|dyn|anim` (+ `+geo`) */
export function levelKv(l: Pick<LevelInfo, "level" | "geo">): string {
  const k = l.level === "kinematic" ? "kin" : l.level === "quasistatic" ? "quasi" : l.level === "dynamic" ? "dyn" : "anim";
  return `level=${k}${l.geo ? "+geo" : ""}`;
}

/** popis režimu pro přepínač panelu (jedna věta) */
export function modeHelp(mode: StudyMode | "auto"): string {
  if (mode === "auto") return tr("Automaticky: kvazistatika, když na pohyblivý díl dosedá pružina, jinak kinematika.");
  return `${levelName({ level: mode })}: ${levelMeaning(mode)}.`;
}
