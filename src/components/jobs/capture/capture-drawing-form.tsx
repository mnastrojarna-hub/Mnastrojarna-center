"use client";

import * as React from "react";
import { AlertTriangle, Archive } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AI_FIELD, AiMark, ConfidenceMeter, DuplicateNotice, FieldLabel, ItemLinkSelect, ToggleRow,
} from "@/components/jobs/capture/capture-parts";
import { CaptureDrawingSpec } from "@/components/jobs/capture/capture-drawing-spec";
import type { BatchDocReview, DrawingReviewState, ItemOption } from "@/lib/jobs/capture-batch-types";
import { initialSpecState, recomputeSpecEstimate, resolveMaterialGroup, type DrawingSpecState } from "@/lib/jobs/drawing-spec";
import { cn } from "@/lib/utils";

type DrawingReview = Extract<BatchDocReview, { kind: "drawing" }>;
type TextKey = "drawingNumber" | "revision" | "title" | "material" | "dimensions" | "generalTolerance" | "tightestTolerance" | "quantity";

const FIELDS: { key: TextKey; label: string; cls?: string; mono?: boolean; inputMode?: "decimal" }[] = [
  { key: "drawingNumber", label: "Číslo výkresu", mono: true },
  { key: "revision", label: "Revize" },
  { key: "title", label: "Název dílu", cls: "sm:col-span-2" },
  { key: "material", label: "Materiál (označení z výkresu)" },
  { key: "dimensions", label: "Rozměry" },
  { key: "generalTolerance", label: "Obecné tolerance" },
  { key: "tightestTolerance", label: "Nejpřesnější tolerance" },
  { key: "quantity", label: "Počet kusů", inputMode: "decimal" },
];

/** Odkud je počet kusů / název (objednávka > nabídka > poptávka > výkres) — dokud ho člověk nezmění. */
function sourceOf(doc: DrawingReview, state: DrawingReviewState, key: TextKey): string {
  const src = key === "quantity" ? doc.sources?.quantity : key === "title" ? doc.sources?.title : undefined;
  return src && state[key].trim() === doc.initial[key].trim() ? src : "";
}

/** Hodnota z AI pro porovnání (✨ dokud ji člověk nezmění). */
function aiValue(doc: DrawingReview, key: TextKey): string {
  if (!doc.aiUsed) return "";
  const v = doc.drawing[key];
  if (typeof v === "number") return v > 0 ? String(v) : "";
  return String(v ?? "").trim();
}

/**
 * Sekce výkresu: údaje z rohového razítka, vazba na položku zakázky a zápis do archivu
 * výkresů (přepínač jen s právem „Archiv výkresů", jinak se zapíše potichu).
 */
export function CaptureDrawingForm({
  doc, state, onChange, itemOptions, drawingsAccess, idPrefix, disabled,
}: {
  doc: DrawingReview;
  state: DrawingReviewState;
  onChange: (s: DrawingReviewState) => void;
  itemOptions: ItemOption[];
  drawingsAccess: boolean;
  idPrefix: string;
  disabled?: boolean;
}) {
  // starší stav bez sekce materiálu → návrh z vytěžení
  const fallbackSpec = React.useMemo(
    () => doc.initial.spec ?? initialSpecState(doc.drawing, { aiUsed: doc.aiUsed, title: doc.initial.title, quantity: doc.initial.quantity }),
    [doc],
  );
  const spec: DrawingSpecState = state.spec ?? fallbackSpec;
  const set = (patch: Partial<DrawingReviewState>) => {
    const next: DrawingReviewState = { ...state, ...patch };
    // materiál / rozměry / název / počet → přepočet odhadu polotovaru (a skupiny, dokud ji člověk nezvolil)
    if ("material" in patch || "dimensions" in patch || "title" in patch || "quantity" in patch) {
      let sp = next.spec ?? spec;
      if ("material" in patch && !sp.manual.includes("material_group")) {
        sp = { ...sp, materialGroup: resolveMaterialGroup(next.material, doc.drawing.materialGroup ?? null) };
      }
      next.spec = recomputeSpecEstimate(sp, {
        material: next.material, dimensions: next.dimensions, title: next.title, quantity: next.quantity,
        overallDims: doc.drawing.overallDims, shapeHint: doc.drawing.shapeHint, blankDimensions: doc.drawing.blankDimensions,
      });
    }
    onChange(next);
  };
  const setSpec = (sp: DrawingSpecState) => {
    // ručně změněná skupina mění hustotu → přepočítat odhad
    const next = sp.materialGroup !== spec.materialGroup
      ? recomputeSpecEstimate(sp, {
        material: state.material, dimensions: state.dimensions, title: state.title, quantity: state.quantity,
        overallDims: doc.drawing.overallDims, shapeHint: doc.drawing.shapeHint, blankDimensions: doc.drawing.blankDimensions,
      })
      : sp;
    onChange({ ...state, spec: next });
  };
  return (
    <div className="space-y-3">
      {doc.aiUsed ? (
        <div className="space-y-1.5">
          {doc.drawing.confidence > 0 && <ConfidenceMeter value={doc.drawing.confidence} />}
          {doc.drawing.summary && <p className="text-sm text-foreground/80">{doc.drawing.summary}</p>}
        </div>
      ) : (
        doc.reason && <p className="text-xs text-sky-800 dark:text-sky-200">{doc.reason}</p>
      )}
      {doc.drawing.needsClarification.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          {doc.drawing.needsClarification.map((t, i) => (
            <li key={i} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />{t}</li>
          ))}
        </ul>
      )}
      {doc.duplicateOf && <DuplicateNotice dup={doc.duplicateOf} value={state.onDuplicate} onChange={(onDuplicate) => set({ onDuplicate })} />}

      <div className="grid gap-2.5 sm:grid-cols-2">
        {FIELDS.map((f) => {
          const id = `${idPrefix}-${f.key}`;
          const ai = aiValue(doc, f.key);
          const isAi = Boolean(ai) && state[f.key].trim() === ai;
          const src = sourceOf(doc, state, f.key);
          return (
            <div key={f.key} className={f.cls}>
              <FieldLabel htmlFor={id} extra={isAi ? <AiMark /> : undefined}>{f.label}</FieldLabel>
              <Input
                id={id}
                value={state[f.key]}
                inputMode={f.inputMode}
                maxLength={f.key === "title" ? 300 : 120}
                onChange={(e) => set({ [f.key]: e.target.value } as Partial<DrawingReviewState>)}
                className={cn(f.mono && "font-mono", isAi && AI_FIELD)}
                autoComplete="off"
                disabled={disabled}
              />
              {src && <p className="mt-0.5 text-[11px] text-sky-700 dark:text-sky-300" data-testid={`capture-drawing-${f.key}-source`}>{src}</p>}
            </div>
          );
        })}
      </div>

      {(doc.drawing.drawingNumbers?.length ?? 0) > 1 && (
        <p className="text-xs text-muted-foreground" data-testid="capture-drawing-numbers">
          Čísla na výkresu: <span className="font-mono">{doc.drawing.drawingNumbers!.join(" · ")}</span>
        </p>
      )}
      <CaptureDrawingSpec
        spec={spec}
        initial={doc.initial.spec ?? null}
        aiUsed={doc.aiUsed}
        onChange={setSpec}
        idPrefix={`${idPrefix}-spec`}
        disabled={disabled}
      />

      {doc.drawing.customerName && (
        <p className="text-xs text-muted-foreground" data-testid="capture-drawing-author">
          Kreslil (z razítka): {doc.drawing.customerName} — jen informace, zákazník se bere ze zakázky.
        </p>
      )}

      <div>
        <FieldLabel htmlFor={`${idPrefix}-link`}>Patří k položce</FieldLabel>
        <ItemLinkSelect id={`${idPrefix}-link`} value={state.link} options={itemOptions} onChange={(link) => set({ link })} disabled={disabled} />
      </div>

      {doc.archiveConflict && (
        <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" /> {doc.archiveConflict}
        </p>
      )}
      {drawingsAccess && (
        <ToggleRow
          id={`${idPrefix}-archive`}
          label={<span className="inline-flex items-center gap-1.5"><Archive className="h-3.5 w-3.5" /> Zapsat do archivu výkresů</span>}
          hint="Výkres půjde najít podle čísla, zákazníka i materiálu."
          checked={state.archive}
          onChange={(archive) => set({ archive })}
          disabled={disabled || !state.drawingNumber.trim()}
        />
      )}

      <div>
        <FieldLabel htmlFor={`${idPrefix}-note`}>Poznámka</FieldLabel>
        <Textarea id={`${idPrefix}-note`} value={state.note} onChange={(e) => set({ note: e.target.value })} rows={2} maxLength={2000} className="min-h-[38px]" disabled={disabled} />
      </div>
    </div>
  );
}
