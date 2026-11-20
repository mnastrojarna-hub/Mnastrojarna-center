/**
 * Která kontrola platnosti tělesa proběhla (vlna 22, bod 22a zprávy majitele): rychlá kontrola BRepCheck po stavbě (do limitu
 * ploch) nestačí na tvrzení „platné“ – v rychlé metodě se odchylka křivky hrany od plochy měří jen v několika bodech.
 * Přesná kontrola (`kontrola přesně` / `check exact` / `prüfen genau`, automaticky před exportem STEP / BREP do
 * `EXACT_AUTO_FACES` ploch, tlačítko „Přesná kontrola“ v aplikaci) ji počítá přesně. Výstup vždy říká, co proběhlo:
 * rychlá / přesná / nekontrolováno – řádek Geometrie (`stav`), řádek D (`vcheck=exact` po přesné kontrole), JSON
 * `docs[].validCheck`.
 *
 * Čistý modul (typy, meze, texty) – jádro je v `validity-kernel.ts`, paměť výsledků v `engine/validity-store.ts`.
 */
import { getLang, tr } from "./i18n";

export type ValidityMethod = "exact" | "fast" | "none";
export type ValidityResult = {
  /** která kontrola proběhla: přesná, rychlá (přesná nad limitem ploch), žádná */
  method: ValidityMethod;
  /** výsledek; null = nezkontrolováno */
  valid: boolean | null;
  faces: number;
  solids: number;
  /** ploch s vadou podle přesné kontroly */
  badFaces: number;
  ms: number;
  /** proč přesná kontrola neproběhla: ploch nad limitem, prázdný model */
  why?: "faces" | "empty";
};

/** do kolika ploch se přesná kontrola spustí sama před exportem objemového formátu (STEP, BREP) */
export const EXACT_AUTO_FACES = 400;
/** do kolika ploch proběhne přesná kontrola na vyžádání (`kontrola přesně`) */
export const EXACT_MAX_FACES = 5000;

const secs = (ms: number) => {
  const s = (Math.round(ms / 10) / 100).toFixed(2);
  return getLang() === "en" ? s : s.replace(".", ",");
};

/** označení kontroly pro řádek Geometrie: „rychlá kontrola“ / „přesná kontrola“ */
export const checkLabel = (m: "fast" | "exact"): string => (m === "exact" ? tr("přesná kontrola") : tr("rychlá kontrola"));

/**
 * Řádek výsledku přesné kontroly (příkaz `kontrola přesně`, export): „Platnost: přesná kontrola (BRepCheck přesnou metodou) –
 * platné, 19 ploch, 0,15 s“ / „… – NEPLATNÉ: 14 z 19 ploch …“ / „… neprovedena (5200 ploch > 5000) – platí rychlá kontrola …“.
 */
export function validityText(v: ValidityResult, fast?: boolean | null, limit = EXACT_MAX_FACES): string {
  if (v.method === "exact") {
    if (v.valid) return tr("přesná kontrola platnosti (BRepCheck přesnou metodou) – platné, ploch {0} · {1} s", v.faces, secs(v.ms));
    return tr("přesná kontrola platnosti (BRepCheck přesnou metodou) – NEPLATNÉ: {0} z {1} ploch má vadu (křivka hrany mimo plochu v toleranci, drát nebo orientace) – jiný CAD může těleso odmítnout; opravte prvek, po kterém vada vznikla", v.badFaces, v.faces);
  }
  if (v.why === "empty") return tr("přesná kontrola platnosti neprovedena – model nemá těleso");
  const fastText = fast === true ? tr("rychlá kontrola: platné") : fast === false ? tr("rychlá kontrola: NEPLATNÉ") : tr("rychlá kontrola neproběhla");
  return tr("přesná kontrola platnosti neprovedena ({0} ploch > {1}) – {2}", v.faces, limit, fastText);
}
