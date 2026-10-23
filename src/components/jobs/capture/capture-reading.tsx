"use client";

import * as React from "react";
import { Building2, Check, FileSearch, FileText, LayoutGrid, Link2, Loader2, ScanText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PHASES = [
  { icon: ScanText, text: "Čtu doklad…" },
  { icon: FileSearch, text: "Rozpoznávám, co je to za doklad a kdo ho vystavil…" },
  { icon: Building2, text: "Hledám zákazníka…" },
  { icon: Link2, text: "Páruji se zakázkou v knize…" },
  { icon: Sparkles, text: "Připravuji návrh ke kontrole…" },
];

const BATCH_PHASES = [
  { icon: ScanText, text: "Prohlížím všechny stránky…" },
  { icon: LayoutGrid, text: "Třídím stránky na doklady…" },
  { icon: FileSearch, text: "Rozpoznávám druh a vystavitele každého dokladu…" },
  { icon: Building2, text: "Čtu údaje dokladů…" },
  { icon: Sparkles, text: "Připravuji roztřídění ke kontrole…" },
];

const EXTRACT_PHASES = [
  { icon: ScanText, text: "Čtu údaje dokladu…" },
  { icon: Building2, text: "Hledám zákazníka a dodavatele…" },
  { icon: Link2, text: "Páruji se zakázkou v knize…" },
  { icon: Sparkles, text: "Připravuji návrh ke kontrole…" },
];

const PHASE_MS = 2600;

/** „Třídím 7 stránek a 2 soubory…" */
export function batchReadingTitle(pages: number, files: number): string {
  const parts: string[] = [];
  if (pages || !files) parts.push(`${pages} ${pages === 1 ? "stránku" : pages > 1 && pages < 5 ? "stránky" : "stránek"}`);
  if (files) parts.push(`${files} ${files === 1 ? "soubor" : files < 5 ? "soubory" : "souborů"}`);
  return `Třídím ${parts.join(" a ")}…`;
}

export interface ReadingBatchInfo {
  /** "batch" = roztřídění dávky, "extract" = čtení jednoho dokladu dávky (přeskočené Roztřídění). */
  mode: "batch" | "extract";
  pages: number;
  files: number;
  /** Místní náhledy dalších stránek (pruh miniatur). */
  thumbs: string[];
}

/**
 * Krok 2 — AI čte. Animace skenu nad první stránkou a postupné kroky
 * (skutečný průběh server nehlásí — kroky jen ukazují, co se děje).
 */
export function CaptureReading({
  previewUrl,
  isPdf,
  ai,
  onCancel,
  batch = null,
}: {
  previewUrl: string | null;
  isPdf: boolean;
  /** false = bez AI (jen se připravuje formulář). */
  ai: boolean;
  onCancel: () => void;
  batch?: ReadingBatchInfo | null;
}) {
  const phases = batch?.mode === "batch" ? BATCH_PHASES : batch?.mode === "extract" ? EXTRACT_PHASES : PHASES;
  const [phase, setPhase] = React.useState(0);
  const [progress, setProgress] = React.useState(4);

  React.useEffect(() => {
    const t = window.setInterval(() => setPhase((p) => Math.min(p + 1, phases.length - 1)), PHASE_MS);
    // průběh se blíží 95 %, dokud server neodpoví
    const p = window.setInterval(() => setProgress((x) => x + (95 - x) * 0.06), 400);
    return () => {
      window.clearInterval(t);
      window.clearInterval(p);
    };
  }, [phases.length]);

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center gap-6 py-6 sm:flex-row sm:gap-10">
      <style>{`@keyframes mn-capture-scan{0%{top:2%}50%{top:94%}100%{top:2%}}`}</style>
      <div className="relative h-56 w-44 shrink-0 overflow-hidden rounded-xl border-4 border-white bg-muted shadow-xl ring-1 ring-black/5 dark:border-slate-800 sm:h-72 sm:w-56">
        {previewUrl && !isPdf ? (
          // eslint-disable-next-line @next/next/no-img-element -- místní náhled
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col gap-2 p-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <span key={i} className={cn("h-2 rounded bg-foreground/10", i % 3 === 0 ? "w-2/3" : "w-full")} />
            ))}
          </div>
        )}
        {ai && (
          <span
            className="absolute inset-x-0 h-8 bg-gradient-to-b from-fuchsia-500/0 via-fuchsia-500/40 to-fuchsia-500/0"
            style={{ animation: "mn-capture-scan 2.4s ease-in-out infinite" }}
          >
            <span className="absolute inset-x-0 top-1/2 h-0.5 bg-fuchsia-500 shadow-[0_0_12px_2px] shadow-fuchsia-500/60" />
          </span>
        )}
      </div>

      <div className="w-full max-w-sm" aria-live="polite">
        <p className="flex items-center gap-2 text-lg font-semibold">
          {ai ? <Sparkles className="h-5 w-5 text-fuchsia-500" /> : <Loader2 className="h-5 w-5 animate-spin text-sky-500" />}
          {batch?.mode === "batch"
            ? (ai ? batchReadingTitle(batch.pages, batch.files) : "Připravuji roztřídění…")
            : ai ? "AI čte doklad" : "Připravuji formulář…"}
        </p>
        {batch && batch.thumbs.length > 1 && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin" aria-hidden>
            {batch.thumbs.slice(0, 12).map((src, i) => (
              <span key={i} className="relative h-12 w-9 shrink-0 overflow-hidden rounded-md border bg-muted">
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element -- místní miniatura
                  <img src={src} alt="" className="h-full w-full object-cover" />
                ) : (
                  <FileText className="m-auto mt-3 h-5 w-5 text-muted-foreground" />
                )}
              </span>
            ))}
          </div>
        )}
        {ai && (
          <>
            <ol className="mt-4 space-y-2.5">
              {phases.map((p, i) => {
                const Icon = p.icon;
                const done = i < phase;
                const now = i === phase;
                return (
                  <li key={p.text} className={cn("flex items-center gap-2.5 text-sm transition", i > phase && "opacity-40")}>
                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                        done ? "bg-emerald-500 text-white" : now ? "bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-500/20 dark:text-fuchsia-300" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {done ? <Check className="h-4 w-4" /> : now ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                    </span>
                    <span className={cn(now && "font-medium")}>{p.text}</span>
                  </li>
                );
              })}
            </ol>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-gradient-to-r from-rose-500 via-fuchsia-500 to-violet-500 transition-all duration-500" style={{ width: `${Math.round(progress)}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Obvykle 10–40 sekund. Telefon můžeš zatím odložit.</p>
          </>
        )}
        <Button type="button" variant="ghost" size="sm" className="mt-4 text-muted-foreground" onClick={onCancel}>
          Zrušit
        </Button>
      </div>
    </div>
  );
}
