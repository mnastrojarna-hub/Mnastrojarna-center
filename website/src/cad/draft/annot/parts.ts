/**
 * BALÍK 2 (annot) – interní druh „annotpart“: jen uvnitř primitiva `sub` poznámky (nikdy v modelu, v DWG / DXF ani ve
 * výběru) – díl s vlastní barvou / tloušťkou / typem čáry (DIMCLRD, DIMCLRT, barevné znaky MTEXT…) a hotovými
 * primitivy. Renderer jádra kopíruje vnořené entity na hladině 0 při každém snímku (převzetí hladiny rodiče); kopie běžného
 * dílu by znovu počítala geometrii (sazbu MTEXT), díl „annotpart“ jen vrátí uložená primitiva.
 */
import { tr } from "../../i18n";
import { kindOf, registerKind, type KindCtx, type Prim } from "../kinds";
import type { DraftEntity } from "../model";
import { compactPrims } from "./util";

type AnnotPart = DraftEntity & { prims: Prim[] };
registerKind({
  type: "annotpart" as never,
  label: () => tr("Díl poznámky"),
  curves: () => [],
  prims: (e: AnnotPart) => e.prims,
  bbox: () => null,
  snaps: () => [],
  grips: () => [],
  transform: () => null,
  info: () => [],
  fields: () => [],
  setField: (e: AnnotPart) => e,
} as never);

/** díl s vlastním stylem → interní díl s hotovými primitivy (stejné id, hladina a styl) */
export function partPrimsEntity(t: DraftEntity, ctx: KindCtx): DraftEntity {
  const { id, layer, color, lineweight, linetype, ltscale } = t;
  return { id, layer, type: "annotpart", prims: compactPrims(kindOf(t)?.prims(t, ctx) ?? []), ...(color !== undefined ? { color } : {}), ...(lineweight !== undefined ? { lineweight } : {}), ...(linetype !== undefined ? { linetype } : {}), ...(ltscale !== undefined ? { ltscale } : {}) } as unknown as DraftEntity;
}
