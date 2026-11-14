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
import { countSub } from "./check";
import { importBREP } from "./formats/kernel-import";
import type { CadDoc, Vec3 } from "./types";

export type KernelShapeStats = { solids: number; volume: number; bbox: [Vec3, Vec3] };

const free = (s: unknown) => {
  try {
    (s as { delete?: () => void } | null)?.delete?.();
  } catch {
    /* už uvolněno */
  }
};

/** objem (přesně z B-rep), obálka (přesná – fastbox) a počet objemových těles */
export function shapeStats(s: r.AnyShape): KernelShapeStats {
  let volume = 0;
  try {
    volume = Math.abs(r.measureVolume(s as r.Shape3D));
  } catch {
    volume = 0; // otevřené těleso / jen plochy
  }
  const b = (s as r.Shape3D).boundingBox.bounds as [Vec3, Vec3];
  return { solids: countSub(s, "SOLID"), volume, bbox: [[b[0][0], b[0][1], b[0][2]], [b[1][0], b[1][1], b[1][2]]] };
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
