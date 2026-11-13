"use client";
/**
 * Tlačítka pásu karet pro tvary 7. vlny (skupina Úpravy): zaoblení se setbackem, eliptické zaoblení a úkos s dělicí křivkou.
 * Vytvoří běžný prvek „fillet“ / „draft“ s předvoleným druhem – formulář a stavba jsou v forms/fillet-form.tsx,
 * forms/pattern-form.tsx, src/cad/feat/fillet-shapes.ts a src/cad/feat/draft-parting.ts.
 */
import { tr } from "@/cad/i18n";
import type { CadDoc, Feature } from "@/cad/types";
import type { RItem } from "./ribbon";

export type ShapePreset = "setback" | "conic" | "parting";

/** Název nového prvku podle druhu (Zaoblení se setbackem 1, Eliptické zaoblení 2, Úkos s dělicí křivkou 1). */
function presetName(doc: CadDoc, base: string, same: (f: Feature) => boolean) {
  return `${base} ${doc.features.filter(same).length + 1}`;
}

/** Doplní název a výchozí hodnoty předvolby (dělicí křivka = poslední skica, tah +Z). */
export function presetFor(doc: CadDoc, preset: Partial<Feature>): Partial<Feature> {
  const p = preset as Record<string, unknown>;
  if (p.kind === "setback") return { ...preset, name: presetName(doc, tr("Zaoblení se setbackem"), (f) => f.type === "fillet" && f.kind === "setback") } as Partial<Feature>;
  if (p.kind === "conic") return { ...preset, name: presetName(doc, tr("Eliptické zaoblení"), (f) => f.type === "fillet" && f.kind === "conic") } as Partial<Feature>;
  if (p.partingSketchId !== undefined) {
    const last = [...doc.features].reverse().find((f) => f.type === "sketch");
    return { pull: { kind: "axis", axis: "Z" }, ...preset, partingSketchId: (p.partingSketchId as string) || last?.id || "", name: presetName(doc, tr("Úkos s dělicí křivkou"), (f) => f.type === "draft" && f.partingSketchId !== undefined) } as Partial<Feature>;
  }
  return preset;
}

/** Položky pásu karet (malá tlačítka skupiny Úpravy). */
export function shapePresetItems({ add }: { add: (type: "fillet" | "draft", preset: Partial<Feature>) => void }): RItem[] {
  return [
    { id: "filletSetback", label: tr("Zaoblení se setbackem"), icon: "filletSetback", tone: "feature", hint: tr("roh tří a více hran uzavře hladká záplata"), onClick: () => add("fillet", { kind: "setback", radius: 3, setback: 6 } as Partial<Feature>) },
    { id: "filletConic", label: tr("Eliptické zaoblení"), icon: "filletConic", tone: "feature", hint: tr("dvě vzdálenosti D1 × D2, elipsa nebo kuželosečka (rho)"), onClick: () => add("fillet", { kind: "conic", radius: 4, r2: 2 } as Partial<Feature>) },
    { id: "draftParting", label: tr("Úkos s dělicí křivkou"), icon: "draftParting", tone: "feature", hint: tr("obě strany od dělicí čáry, i stupňovitý"), onClick: () => add("draft", { partingSketchId: "" } as Partial<Feature>) },
  ];
}
