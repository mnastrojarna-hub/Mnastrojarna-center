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
import { compositionOf, isValidShape, solidComposition, solidsVolume } from "./check";
import { importBREP } from "./formats/kernel-import";
import type { CadDoc, Vec3 } from "./types";

/**
 * Míry tvaru pro kontrolu exportu: `volume` jen z objemových těles (22c – pseudoobjem skořepin a ploch se nepočítá),
 * složení (tělesa, skořepiny, uzavřené, volné skořepiny a z nich uzavřené, plochy mimo skořepiny, plochy mimo tělesa) a platnost BRepCheck
 * (rychlá metoda – přesná vzniká až čtečkou STEP i u platného modelu, viz 22a; přesně jen `kontrola přesně`).
 */
export type KernelShapeStats = { solids: number; volume: number; bbox: [Vec3, Vec3]; shells: number; closedShells: number; freeShells: number; closedFree: number; freeFaces: number; free: number; valid: boolean | null };

/** nad kolik ploch se platnost souboru při kontrole exportu nekontroluje (drahé) – `valid: null` */
export const EXPORT_VALID_FACES = 3000;

const free = (s: unknown) => {
  try {
    (s as { delete?: () => void } | null)?.delete?.();
  } catch {
    /* už uvolněno */
  }
};

/** objem těles (přesně z B-rep), obálka (přesná – fastbox), složení a platnost */
export function shapeStats(s: r.AnyShape): KernelShapeStats {
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
  return { solids: c.solids, volume, bbox: [[b[0][0], b[0][1], b[0][2]], [b[1][0], b[1][1], b[1][2]]], shells: c.shells, closedShells: c.closedShells, freeShells: c.freeShells, closedFree: c.closedFree, freeFaces: c.freeFaces, free, valid };
}

/** Model (díl / sestava) a znovu načtený soubor STEP / BREP – míry pro porovnání (`exportCheck` v agent-out.ts). */
export async function exportStats(doc: CadDoc, bytes: Uint8Array, format: "step" | "brep"): Promise<{ model: KernelShapeStats; file: KernelShapeStats }> {
  const body = await shapeOfDoc(doc);
  if (!body) throw new Error(tr("Model je prázdný."));
  let model: KernelShapeStats;
  try {
    model = shapeStats(body);
  } finally {
    if (doc.kind === "assembly") free(body); // složené těleso sestavy vzniká pro každé volání; těleso dílu patří mezipaměti stavby
  }
  let file: r.AnyShape | null = null;
  try {
    file = format === "step" ? await r.importSTEP(new Blob([bytes as BlobPart])) : importBREP(new TextDecoder().decode(bytes));
    if (!file || (file as { isNull?: boolean }).isNull) throw new Error(tr("soubor neobsahuje žádný tvar"));
    return { model, file: shapeStats(file) };
  } finally {
    free(file);
  }
}
