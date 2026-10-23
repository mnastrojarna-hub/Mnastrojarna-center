"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/jobs/book/native-select";
import { FileKindBadge } from "@/components/jobs/stage-badge";
import { FieldLabel } from "@/components/jobs/capture/capture-parts";
import { FILE_KINDS, FILE_KIND_ORDER } from "@/lib/jobs/file-kinds";
import type { FileReviewState } from "@/lib/jobs/capture-batch-types";

/** Sekce fotky / jiného souboru: druh dokumentu zakázky, název a poznámka. */
export function CaptureFileForm({
  state, onChange, idPrefix, disabled,
}: {
  state: FileReviewState;
  onChange: (s: FileReviewState) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const set = (patch: Partial<FileReviewState>) => onChange({ ...state, ...patch });
  return (
    <div className="grid gap-2.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      <div>
        <FieldLabel htmlFor={`${idPrefix}-kind`} extra={<FileKindBadge kind={state.fileKind} className="px-1.5 py-0 text-[10px]" />}>Druh dokumentu</FieldLabel>
        <NativeSelect id={`${idPrefix}-kind`} value={state.fileKind} onChange={(e) => set({ fileKind: e.target.value as FileReviewState["fileKind"] })} disabled={disabled}>
          {FILE_KIND_ORDER.map((k) => <option key={k} value={k}>{FILE_KINDS[k].label}</option>)}
        </NativeSelect>
      </div>
      <div>
        <FieldLabel htmlFor={`${idPrefix}-title`}>Název</FieldLabel>
        <Input id={`${idPrefix}-title`} value={state.title} maxLength={300} onChange={(e) => set({ title: e.target.value })} autoComplete="off" disabled={disabled} />
      </div>
      <div className="sm:col-span-2">
        <FieldLabel htmlFor={`${idPrefix}-note`}>Poznámka</FieldLabel>
        <Textarea id={`${idPrefix}-note`} value={state.note} onChange={(e) => set({ note: e.target.value })} rows={2} maxLength={2000} className="min-h-[38px]" disabled={disabled} />
      </div>
    </div>
  );
}
