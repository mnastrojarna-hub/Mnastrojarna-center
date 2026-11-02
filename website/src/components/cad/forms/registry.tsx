"use client";
/**
 * Registr formulářů prvků: modul může převzít formulář existujícího typu prvku bez zásahu do `props.tsx`.
 * Formulář dostane stejné pomocné hodnoty jako vestavěné větve (set, b, skici, nástrojové prvky, přepínač operace).
 */
import type { ReactNode } from "react";
import type { CadDoc, Feature, FeatureType } from "@/cad/types";

export type FeatureFormProps<T extends Feature = Feature> = {
  f: T;
  doc: CadDoc;
  /** částečná změna prvku */
  set: (patch: Record<string, unknown>) => void;
  /** klíč vazby parametru (pro `bind` u <Num>) */
  b: (path: string) => string;
  /** skici před tímto prvkem */
  sketches: Feature[];
  /** prvky s nástrojovým tělesem před tímto prvkem (pro pole) */
  toolFeatures: Feature[];
  /** přepínač Přidat / Odebrat / Průnik (pokud má prvek `mode`) */
  mode: ReactNode;
  pickHint?: string;
};

const forms = new Map<FeatureType, (p: FeatureFormProps) => ReactNode>();

export function registerFeatureForm<T extends FeatureType>(type: T, render: (p: FeatureFormProps<Extract<Feature, { type: T }>>) => ReactNode) {
  forms.set(type, render as (p: FeatureFormProps) => ReactNode);
}
export function getFeatureForm(type: FeatureType) {
  return forms.get(type);
}
