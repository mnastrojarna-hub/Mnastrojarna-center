/**
 * Kontrola exportu v jádře (worker) pro příkaz konzole `export step|brep`: stažený soubor se znovu načte jádrem a změří
 * (počet objemových těles, objem, obálka) a změří se i těleso modelu (z mezipaměti stavby – export ho právě postavil).
 *
 * Záměrně BEZ sítě a BEZ úložiště importů: dřívější cesta (prepareImport → díl s prvkem Import → asmParts) soubor
 * zasíťovala jako díl k zobrazení a jeho bajty nechala navždy v úložišti importů v UI i v jádře – u desky 330 ploch to
 * trvalo 10 s místo 0,4 s exportu a paměť rostla s každým exportem. Tady se načtené těleso po změření hned uvolní.
 */
import * as r from "replicad";
import { tr } from "./i18n";
import { shapeOfDoc } from "./asm-kernel";
import { compositionOf, exactCheck, isValidShape, solidComposition, solidsVolume } from "./check";
import { importBREP } from "./formats/kernel-import";
import type { CadDoc, Vec3 } from "./types";
import { EXACT_AUTO_FACES } from "./validity";

/**
 * Míry tvaru pro kontrolu exportu: `volume` jen z objemových těles (22c – pseudoobjem skořepin a ploch se nepočítá),
 * složení (tělesa, skořepiny, uzavřené, volné skořepiny a z nich uzavřené, plochy mimo skořepiny, plochy mimo tělesa) a platnost BRepCheck
 * (rychlá metoda). `validExact` = přesná metoda BRepCheck (vlna 22, bod 22a, fáze 2): u souboru vždy do `EXACT_AUTO_FACES`
 * ploch – čtečka STEP umí nastavit tolerance hran menší než skutečná odchylka křivek, takže soubor přesně platného modelu
 * po zpětném načtení přesnou kontrolou neprojde; „věrná kopie“ se pak napsat nesmí. `null` = přesná kontrola neproběhla
 * (ploch nad mez), `badFaces` = vadných ploch podle přesné kontroly, `faces` = počet ploch.
 */
export type KernelShapeStats = { solids: number; volume: number; bbox: [Vec3, Vec3]; shells: number; closedShells: number; freeShells: number; closedFree: number; freeFaces: number; free: number; valid: boolean | null; faces: number; validExact: boolean | null; badFaces?: number };

/** nad kolik ploch se platnost souboru při kontrole exportu nekontroluje (drahé) – `valid: null` */
export const EXPORT_VALID_FACES = 3000;

const free = (s: unknown) => {
  try {
    (s as { delete?: () => void } | null)?.delete?.();
  } catch {
    /* už uvolněno */
  }
};

/** objem těles (přesně z B-rep), obálka (přesná – fastbox), složení a platnost; `exact` = i přesná kontrola (do `EXACT_AUTO_FACES` ploch) */
export function shapeStats(s: r.AnyShape, exact = false): KernelShapeStats {
  let volume = 0;
  try {
    volume = solidsVolume(s); // jen tělesa – skořepina / plocha objem nemá
  } catch {
    volume = 0;
  }
  const b = (s as r.Shape3D).boundingBox.bounds as [Vec3, Vec3];
  const c = solidComposition(s);
  const free = compositionOf(s).free;
  const valid = c.faces <= EXPORT_VALID_FACES ? isValidShape(s) : null;
  const x = exact && c.faces <= EXACT_AUTO_FACES ? exactCheck(s) : null;
  return { solids: c.solids, volume, bbox: [[b[0][0], b[0][1], b[0][2]], [b[1][0], b[1][1], b[1][2]]], shells: c.shells, closedShells: c.closedShells, freeShells: c.freeShells, closedFree: c.closedFree, freeFaces: c.freeFaces, free, valid, faces: c.faces, validExact: x ? x.valid : null, ...(x && !x.valid ? { badFaces: x.badFaces } : {}) };
}

/**
 * Model (díl / sestava) a znovu načtený soubor STEP / BREP – míry pro porovnání (`exportCheck` v agent-out.ts). Soubor se
 * kontroluje i přesnou metodou (do `EXACT_AUTO_FACES` ploch, 22a); model přesně jen tehdy, když soubor přesnou kontrolou
 * neprojde (aby hláška rozlišila „vadu přinesl soubor“ od „model je vadný už sám“) – u platného souboru se čas neplýtvá.
 */
export async function exportStats(doc: CadDoc, bytes: Uint8Array, format: "step" | "brep"): Promise<{ model: KernelShapeStats; file: KernelShapeStats }> {
  const body = await shapeOfDoc(doc);
  if (!body) throw new Error(tr("Model je prázdný."));
  let file: r.AnyShape | null = null;
  try {
    file = format === "step" ? await r.importSTEP(new Blob([bytes as BlobPart])) : importBREP(new TextDecoder().decode(bytes));
    if (!file || (file as { isNull?: boolean }).isNull) throw new Error(tr("soubor neobsahuje žádný tvar"));
    const fileStats = shapeStats(file, true);
    return { model: shapeStats(body, fileStats.validExact === false), file: fileStats };
  } finally {
    free(file);
    if (doc.kind === "assembly") free(body); // složené těleso sestavy vzniká pro každé volání; těleso dílu patří mezipaměti stavby
  }
}
