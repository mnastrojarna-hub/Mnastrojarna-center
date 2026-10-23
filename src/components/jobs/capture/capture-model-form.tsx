"use client";

import * as React from "react";
import { Box } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DuplicateNotice, FieldLabel, ItemLinkSelect, TONES } from "@/components/jobs/capture/capture-parts";
import type { BatchDocReview, ItemOption, ModelReviewState } from "@/lib/jobs/capture-batch-types";
import { cn } from "@/lib/utils";

type ModelReview = Extract<BatchDocReview, { kind: "model" }>;

/** Sekce 3D modelu: formát (jen štítek), číslo dílu, revize, název a vazba na položku. */
export function CaptureModelForm({
  doc, state, onChange, itemOptions, idPrefix, disabled,
}: {
  doc: ModelReview;
  state: ModelReviewState;
  onChange: (s: ModelReviewState) => void;
  itemOptions: ItemOption[];
  idPrefix: string;
  disabled?: boolean;
}) {
  const set = (patch: Partial<ModelReviewState>) => onChange({ ...state, ...patch });
  const format = state.format ?? doc.meta.format;
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm">
        <Box className="h-4 w-4 text-purple-600 dark:text-purple-400" />
        3D model
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", TONES.violet)}>{format ?? "neznámý formát"}</span>
      </p>
      {doc.duplicateOf && <DuplicateNotice dup={doc.duplicateOf} value={state.onDuplicate} onChange={(onDuplicate) => set({ onDuplicate })} />}
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div>
          <FieldLabel htmlFor={`${idPrefix}-number`}>Číslo dílu / výkresu</FieldLabel>
          <Input id={`${idPrefix}-number`} value={state.drawingNumber} maxLength={120} onChange={(e) => set({ drawingNumber: e.target.value })} className="font-mono" autoComplete="off" disabled={disabled} />
        </div>
        <div>
          <FieldLabel htmlFor={`${idPrefix}-rev`}>Revize</FieldLabel>
          <Input id={`${idPrefix}-rev`} value={state.revision} maxLength={40} onChange={(e) => set({ revision: e.target.value })} autoComplete="off" disabled={disabled} />
        </div>
        <div className="sm:col-span-2">
          <FieldLabel htmlFor={`${idPrefix}-title`}>Název dílu</FieldLabel>
          <Input id={`${idPrefix}-title`} value={state.title} maxLength={300} onChange={(e) => set({ title: e.target.value })} autoComplete="off" disabled={disabled} />
        </div>
      </div>
      <div>
        <FieldLabel htmlFor={`${idPrefix}-link`}>Patří k položce</FieldLabel>
        <ItemLinkSelect id={`${idPrefix}-link`} value={state.link} options={itemOptions} onChange={(link) => set({ link })} disabled={disabled} />
      </div>
      <div>
        <FieldLabel htmlFor={`${idPrefix}-note`}>Poznámka</FieldLabel>
        <Textarea id={`${idPrefix}-note`} value={state.note} onChange={(e) => set({ note: e.target.value })} rows={2} maxLength={2000} className="min-h-[38px]" disabled={disabled} />
      </div>
    </div>
  );
}
