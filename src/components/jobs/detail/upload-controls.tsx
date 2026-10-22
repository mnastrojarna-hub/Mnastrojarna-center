"use client";

import * as React from "react";
import { Upload, CloudUpload, CheckCircle2, AlertTriangle, Loader2, X } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { FILE_KINDS, FILE_KIND_ORDER, JOB_FILE_ACCEPT, JOB_FILE_MAX_BYTES } from "@/lib/jobs/file-kinds";
import type { JobFileKind } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { useJobDetail, UPLOAD_PHASE_LABELS, type UploadEntryPhase } from "./detail-context";
import { formatBytes } from "./detail-helpers";

/** Tlačítko „Nahrát soubory" (výběr více souborů najednou). */
export function UploadButton({
  label = "Nahrát soubory", variant = "outline", size, className, kind, compact,
}: {
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  kind?: JobFileKind;
  /** Na mobilu jen ikona. */
  compact?: boolean;
}) {
  const { startUpload } = useJobDetail();
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={() => ref.current?.click()} aria-label={label} title={label}>
        <Upload className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        <span className={cn(compact && "hidden sm:inline")}>{label}</span>
      </Button>
      <input
        ref={ref}
        type="file"
        multiple
        accept={JOB_FILE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void startUpload(files, { kind });
        }}
      />
    </>
  );
}

/** Výběr druhu dokumentu (barevné odznaky v nativním selectu nejdou — text + tečka). */
export function KindSelect({
  value, onChange, allowAuto, id, className,
}: { value: JobFileKind | "auto"; onChange: (v: JobFileKind | "auto") => void; allowAuto?: boolean; id?: string; className?: string }) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as JobFileKind | "auto")}
      className={cn("h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
    >
      {allowAuto && <option value="auto">✨ Poznat podle názvu</option>}
      {FILE_KIND_ORDER.map((k) => (
        <option key={k} value={k}>{FILE_KINDS[k].label}</option>
      ))}
    </select>
  );
}

/** Zóna „přetáhni sem" na záložce Dokumenty. */
export function UploadDropzone() {
  const { startUpload } = useJobDetail();
  const [kind, setKind] = React.useState<JobFileKind | "auto">("auto");
  const [over, setOver] = React.useState(false);
  const depth = React.useRef(0);
  const ref = React.useRef<HTMLInputElement>(null);
  const kindId = React.useId();

  function handle(files: File[]) {
    void startUpload(files, { kind: kind === "auto" ? undefined : kind });
  }

  return (
    <div
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        handle(Array.from(e.dataTransfer.files ?? []));
      }}
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-5 text-center transition sm:flex-row sm:text-left",
        over
          ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
          : "border-muted-foreground/25 bg-muted/20 hover:border-emerald-400/60",
      )}
    >
      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", over ? "bg-emerald-500 text-white" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300")}>
        <CloudUpload className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{over ? "Pusť soubory sem…" : "Přetáhni sem soubory nebo je vyber"}</p>
        <p className="text-xs text-muted-foreground">
          PDF, fotky, výkresy (DXF/DWG), 3D modely (STEP/STL), Excel, e-maily · max. {Math.round(JOB_FILE_MAX_BYTES / 1024 / 1024)} MB.
          Stejný název = nová verze, stará se archivuje.
        </p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
        <label htmlFor={kindId} className="sr-only">Druh dokumentu</label>
        <KindSelect id={kindId} value={kind} onChange={setKind} allowAuto />
        <Button type="button" variant="success" onClick={() => ref.current?.click()}>
          <Upload className="h-4 w-4" /> Vybrat soubory
        </Button>
        <input
          ref={ref}
          type="file"
          multiple
          accept={JOB_FILE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            handle(files);
          }}
        />
      </div>
    </div>
  );
}

const PROGRESS: Record<UploadEntryPhase, number> = {
  ceka: 4, zmenseni: 25, nahravani: 60, ukladani: 88, hotovo: 100, chyba: 100,
};

/** Fronta nahrávání (fáze po souborech). Bez nahrávání se nevykreslí. */
export function UploadQueue({ className }: { className?: string }) {
  const { uploads, clearUploads } = useJobDetail();
  if (!uploads.length) return null;
  const running = uploads.some((u) => u.phase !== "hotovo" && u.phase !== "chyba");
  return (
    <div className={cn("rounded-xl border bg-card p-3 shadow-sm", className)} aria-live="polite">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-semibold">
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
          {running ? "Nahrávám dokumenty…" : "Nahrávání dokončeno"}
        </span>
        {!running && (
          <button type="button" onClick={clearUploads} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Skrýt">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <ul className="space-y-2">
        {uploads.map((u) => {
          const k = FILE_KINDS[u.kind] ?? FILE_KINDS.ostatni;
          const Icon = k.icon;
          const failed = u.phase === "chyba";
          return (
            <li key={u.id} className="flex items-center gap-2.5">
              <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", k.badge)}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium">{u.name}</span>
                  <span className={cn("shrink-0", failed ? "text-red-600 dark:text-red-400" : u.phase === "hotovo" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                    {failed ? <AlertTriangle className="inline h-3 w-3" /> : null} {UPLOAD_PHASE_LABELS[u.phase]}
                    {u.phase === "ceka" && u.size ? ` · ${formatBytes(u.size)}` : ""}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full transition-all duration-500", failed ? "bg-red-500" : u.phase === "hotovo" ? "bg-emerald-500" : "bg-emerald-400")}
                    style={{ width: `${PROGRESS[u.phase]}%` }}
                  />
                </div>
                {failed && u.error && <p className="mt-0.5 text-[11px] text-red-600 dark:text-red-400">{u.error}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
