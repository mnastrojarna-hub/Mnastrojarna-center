/**
 * Registr stavitelů prvků: modul může převzít stavbu existujícího typu prvku (zaoblení, pole, tažení…)
 * bez zásahu do `build.ts`. Stavitel vrací NOVÉ TĚLESO (null = těleso beze změny), stejně jako `ExtDef.build`.
 */
import type * as r from "replicad";
import type { BoolMode, CadDoc, Feature, FeatureType } from "../types";

type Shape = r.Shape3D;
type SketchF = Extract<Feature, { type: "sketch" }>;

export type FeatCtx = {
  body: Shape | null;
  sketches: Map<string, SketchF>;
  /** prvky dokumentu (vyřešené skici / pomocné roviny nahrazují původní) */
  features: Feature[];
  /** nástrojová tělesa dřívějších prvků (pro pole / zrcadlení) */
  tools: Map<string, { tool: Shape; mode: BoolMode }>;
  index: number;
  doc: CadDoc;
};

export type FeatBuilder<T extends Feature = Feature> = (f: T, ctx: FeatCtx) => Shape | null | Promise<Shape | null>;

const builders = new Map<FeatureType, FeatBuilder>();

export function registerFeatureBuilder<T extends FeatureType>(type: T, fn: FeatBuilder<Extract<Feature, { type: T }>>) {
  builders.set(type, fn as FeatBuilder);
}
export function getFeatureBuilder(type: FeatureType): FeatBuilder | undefined {
  return builders.get(type);
}
