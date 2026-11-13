"use client";

/**
 * Pole automatického formuláře prvků rozšíření pro parametry druhu „direction“ (směr) a „axis“ (osa) a nápověda
 * u starších prvků, které jen opakují vestavěný prvek. Směr a osa se zadávají stejně jako u vysunutí / pole / rotace;
 * starší uložené hodnoty („X“, [x, y, z], „x“ / „y“ osy skici) se zobrazí převedené a uloží se v novém tvaru až po změně.
 */
import { tr } from "@/cad/i18n";
import { toAxisDef, toDirection } from "@/cad/ext/place";
import type { ExtParam } from "@/cad/ext/registry";
import { AXIS_KINDS, type AxisDef, type Direction } from "@/cad/refs";
import type { Feature } from "@/cad/types";
import { AxisField, DirectionField } from "./ref-field";

/** druhy směru pro prvky rozšíření (bez „pod úhlem“, který potřebuje rovinu skici – ten jen u parametrů s normálou) */
const DIR_KINDS: Direction["kind"][] = ["axis", "vector", "edge", "faceNormal", "twoPoints", "tangent"];
/** osy bez os skici (pro parametr bez skici) */
const MODEL_AXES = AXIS_KINDS.map((k) => k.v).filter((k) => k !== "sketchX" && k !== "sketchY" && k !== "sketchLine");

const Hint = ({ text }: { text?: string }) => (text ? <p className="mt-1 text-[11px] text-ink-700/45">{text}</p> : null);

export function ExtDirectionParam({ p, value, onChange }: { p: Extract<ExtParam, { kind: "direction" }>; value: unknown; onChange: (d: Direction | null) => void }) {
  const d = toDirection(value);
  // „kolmo na skicu“ (prázdné) jen u parametrů s normálou; jinak výchozí osa Z (jako dřívější výchozí „Z“)
  const shown: Direction | undefined = d && d.kind !== "normal" ? d : p.allowNormal ? undefined : { kind: "axis", axis: "Z" };
  return (
    <div data-ext-param={p.key} data-ext-kind="direction">
      <DirectionField label={p.label} value={shown} allowNormal={!!p.allowNormal} kinds={p.allowNormal ? [...DIR_KINDS, "angle"] : DIR_KINDS} onChange={(x) => onChange(x ?? null)} />
      <Hint text={p.hint} />
    </div>
  );
}

export function ExtAxisParam({ p, value, sketch, onChange }: { p: Extract<ExtParam, { kind: "axis" }>; value: unknown; sketch: Feature | undefined; onChange: (a: AxisDef) => void }) {
  const withSketch = !!p.sketchKey;
  const a: AxisDef = toAxisDef(value) ?? (withSketch ? { kind: "sketchY" } : { kind: "global", axis: "Z" });
  return (
    <div data-ext-param={p.key} data-ext-kind="axis">
      <AxisField label={p.label} value={a} sketch={sketch} kinds={withSketch ? undefined : MODEL_AXES} onChange={(x) => onChange(x ?? { kind: "sketchY" })} />
      <Hint text={p.hint} />
    </div>
  );
}

/** Jednořádková nápověda u staršího prvku: kde je vestavěná náhrada s bohatším zadáním. */
export function LegacyHint({ text }: { text: string }) {
  return (
    <p data-legacy-hint className="rounded-lg border border-amber-300/70 bg-amber-50 px-2.5 py-1.5 text-[12px] leading-snug text-amber-900">
      <span className="font-semibold">{tr("Starší prvek.")}</span> {text}
    </p>
  );
}
