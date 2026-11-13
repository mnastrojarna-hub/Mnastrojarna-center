/**
 * Směr vyhození (= směr otevírání formy) ve formařských nástrojích – platí i pro vyhazovače a chlazení.
 * `pull` je vždy jednotkový vektor pro výpočty (analýza úkosů, vyhazovače, chlazení); `pullRaw` = vektor tak, jak ho uživatel
 * zadal a jak ho ukazuje pole. Složky vektoru se potvrzují po jedné – kdyby se do pole vracel znormovaný vektor, každá další
 * složka by se přidala k už přeškálovaným (2; 1; 0 zadané postupně by dalo 0,667; 0,745; 0 místo 0,894; 0,447; 0).
 * `pullDef` = odkaz (normála plochy / hrana / dva body), ze kterého se `pull` znovu vyřeší po změně modelu, `pullFlip` = odkaz obráceně.
 */
import type { Direction } from "@/cad/refs";
import type { Vec3 } from "@/cad/types";
import { unitVec } from "./unit-vec";

export type DraftSetup = { on: boolean; pull: Vec3; minDeg: number; pullDef?: Direction; pullFlip?: boolean; pullRaw?: Vec3 };

/** vektor zobrazený v poli směru (zadání uživatele, jinak jednotkový směr) */
export const pullShown = (d: DraftSetup): Vec3 => d.pullRaw ?? d.pull;

/**
 * Nový stav po změně pole směru: zadání se uloží beze změny, jednotkový směr se z něj spočítá; nulový vektor rozpracovaného
 * zadání do výpočtů nepouští (zůstane poslední platný směr). `showMap` = změna na kartě Úkosy zapne barevnou mapu.
 */
export function pullChange(draft: DraftSetup, v: Vec3, def: Direction | undefined, flip: boolean | undefined, showMap: boolean): DraftSetup {
  return { ...draft, on: showMap ? true : draft.on, pull: unitVec(v) ?? draft.pull, pullRaw: v, pullDef: def, pullFlip: flip };
}
