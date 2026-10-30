"use client";

import * as React from "react";
import Link from "next/link";
import { Check, FolderOpen, FolderPlus, HelpCircle, Link2, Link2Off, Loader2, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { confirmJobSuggestionAction, rejectJobSuggestionAction, searchJobsForMailAction, setThreadJobAction, type JobPick } from "@/app/actions/mail-jobs";
import { LINK_SOURCE_LABEL } from "@/lib/email/job-match";
import type { JobSuggestionRef } from "@/lib/email/mail-types";
import { isJobStage, stageMeta } from "@/lib/jobs/stages";
import { cn } from "@/lib/utils";

export interface JobLinkChange {
  jobId: string | null;
  jobNumber?: string;
  /** Návrh vyřízen (přijat / zamítnut). */
  suggestionDone?: boolean;
  text: string;
}

/**
 * Zakázka vlákna (Pošta B): chip zakázky + jak ji přiřadila AI / kdo, změnit nebo odpojit jedním ťuknutím;
 * bez zakázky návrh „Patří k Z-…?" (Ano / Ne / Jiná…), jinak Založit zakázku / Přiřadit k zakázce.
 */
export function JobLinkBar({ threadId, jobId, jobNumber, jobTitle, linkSource, linkActor, suggestion, canCreate, createDisabled, creating, onCreate, onChanged, onError }: {
  threadId: string;
  jobId?: string | null;
  jobNumber?: string | null;
  jobTitle?: string | null;
  linkSource?: string | null;
  linkActor?: string | null;
  suggestion?: JobSuggestionRef | null;
  canCreate: boolean;
  /** Založit zakázku zatím nejde (vlákno se načítá / bez příchozí zprávy). */
  createDisabled?: boolean;
  creating: boolean;
  onCreate: () => void;
  onChanged: (c: JobLinkChange) => void;
  onError: (text: string) => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [picker, setPicker] = React.useState(false);

  const run = async <T extends { ok: boolean; error?: string }>(key: string, fn: () => Promise<T>, done: (r: T) => void) => {
    setBusy(key);
    try {
      const r = await fn();
      if (!r.ok) onError(r.error ?? "Nepodařilo se.");
      else done(r);
    } catch {
      onError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  };
  const pick = (j: JobPick) => {
    setPicker(false);
    void run("pick", () => setThreadJobAction(threadId, j.id), (r) => onChanged({
      jobId: r.jobId ?? j.id, jobNumber: r.jobNumber ?? j.number, suggestionDone: true,
      text: `Vlákno přiřazeno k ${r.jobNumber ?? j.number}${r.changes ? ` — z e-mailu zapsáno ${r.changes} změn(y)` : ""}.`,
    }));
  };

  return (
    <div className="space-y-2" data-testid="job-link-bar">
      {jobId ? (
        <div className="space-y-1.5 rounded-xl border border-primary/20 bg-primary/5 p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="success" size="sm">
              <Link href={`/orders/${jobId}?tab=komunikace`} data-testid="thread-job-open"><FolderOpen className="h-4 w-4" /> {jobNumber ?? "Zakázka"}</Link>
            </Button>
            <span className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="outline" onClick={() => setPicker(true)} disabled={busy !== null} data-testid="thread-job-change">Změnit</Button>
              <Button
                size="sm" variant="ghost" disabled={busy !== null} data-testid="thread-job-unlink" aria-label="Odpojit od zakázky" title="Odpojit od zakázky"
                onClick={() => void run("unlink", () => setThreadJobAction(threadId, null), () => onChanged({ jobId: null, text: "Vlákno odpojeno od zakázky." }))}
              >
                {busy === "unlink" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2Off className="h-4 w-4" />}<span className="hidden sm:inline">Odpojit</span>
              </Button>
            </span>
          </div>
          {(jobTitle || linkSource) && (
            <p className="min-w-0 text-xs text-muted-foreground">
              {jobTitle && <span className="block truncate font-medium text-foreground">{jobTitle}</span>}
              {linkSource && (
                <span className="inline-flex items-center gap-1" data-testid="thread-job-source">
                  {linkActor === "ai" ? <Sparkles className="h-3 w-3 text-fuchsia-600" /> : <Link2 className="h-3 w-3" />}
                  přiřazeno {linkActor === "ai" ? "automaticky" : "ručně"} · {LINK_SOURCE_LABEL[linkSource] ?? linkSource}
                </span>
              )}
            </p>
          )}
          {suggestion && suggestion.jobId !== jobId && (
            // odpověď ve vlákně jmenuje jinou zakázku: ta zpráva zůstala nepřiřazená, změny z ní se nepropsaly
            <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2 dark:border-amber-500/40 dark:bg-amber-500/10" data-testid="thread-message-suggestion">
              <p className="flex items-start gap-2 text-sm font-medium text-amber-900 dark:text-amber-100">
                <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span className="min-w-0 break-words">
                  Zpráva ve vlákně jmenuje <span className="whitespace-nowrap">{suggestion.jobNumber}</span> — patří k {suggestion.jobNumber}?
                  <span className="block text-xs font-normal">Změny z ní se zatím nepropsaly nikam.</span>
                </span>
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm" variant="success" disabled={busy !== null} data-testid="thread-message-suggestion-yes"
                  onClick={() => void run("yes", () => confirmJobSuggestionAction(suggestion.id), (r) => onChanged({
                    jobId: r.jobId ?? suggestion.jobId, jobNumber: r.jobNumber ?? suggestion.jobNumber, suggestionDone: true,
                    text: `Zpráva přiřazena k ${r.jobNumber ?? suggestion.jobNumber}${r.changes ? ` — z e-mailu zapsáno ${r.changes} změn(y)` : ""}.`,
                  }))}
                >
                  {busy === "yes" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Ano, k {suggestion.jobNumber}
                </Button>
                <Button
                  size="sm" variant="ghost" disabled={busy !== null} data-testid="thread-message-suggestion-no"
                  onClick={() => void run("no", () => rejectJobSuggestionAction(suggestion.id), () => onChanged({
                    jobId, jobNumber: jobNumber ?? undefined, suggestionDone: true, text: `Dobře, zpráva patří k ${jobNumber ?? "zakázce vlákna"} — změny z ní čekají jako návrhy.`,
                  }))}
                >
                  <X className="h-4 w-4" /> Ne, k {jobNumber ?? "této"}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : suggestion ? (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-500/40 dark:bg-amber-500/10" data-testid="thread-suggestion">
          <p className="flex items-start gap-2 text-sm font-medium text-amber-900 dark:text-amber-100">
            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span className="min-w-0 break-words">
              Patří k <span className="whitespace-nowrap">{suggestion.jobNumber}</span>?{suggestion.jobTitle && <span className="font-normal"> {suggestion.jobTitle}</span>}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm" variant="success" disabled={busy !== null} data-testid="thread-suggestion-yes"
            onClick={() => void run("yes", () => confirmJobSuggestionAction(suggestion.id), (r) => onChanged({
              jobId: r.jobId ?? suggestion.jobId, jobNumber: r.jobNumber ?? suggestion.jobNumber, suggestionDone: true,
              text: `Přiřazeno k ${r.jobNumber ?? suggestion.jobNumber}${r.changes ? ` — z e-mailu zapsáno ${r.changes} změn(y)` : ""}.`,
            }))}
          >
            {busy === "yes" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Ano
          </Button>
          <Button
            size="sm" variant="ghost" disabled={busy !== null} data-testid="thread-suggestion-no"
            onClick={() => void run("no", () => rejectJobSuggestionAction(suggestion.id), () => onChanged({ jobId: null, suggestionDone: true, text: "Dobře, k té zakázce nepatří." }))}
          >
            <X className="h-4 w-4" /> Ne
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPicker(true)} disabled={busy !== null}>Jiná…</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {canCreate && (
            <Button variant="success" size="sm" onClick={onCreate} disabled={creating || createDisabled || busy !== null}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />} Založit zakázku
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setPicker(true)} disabled={busy !== null} data-testid="thread-job-assign">
            {busy === "pick" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Přiřadit k zakázce
          </Button>
        </div>
      )}
      <JobPicker open={picker} onClose={() => setPicker(false)} onPick={pick} currentId={jobId ?? null} threadId={threadId} />
    </div>
  );
}

function JobPicker({ open, onClose, onPick, currentId, threadId }: {
  open: boolean; onClose: () => void; onPick: (j: JobPick) => void; currentId: string | null; threadId: string;
}) {
  const [q, setQ] = React.useState("");
  const [list, setList] = React.useState<JobPick[] | null>(null);
  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(() => {
      void searchJobsForMailAction(q, threadId).then((r) => { if (alive) setList(r); });
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open, threadId]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100%-1.5rem)] max-w-md space-y-3 p-4 sm:p-5" data-testid="job-picker">
        <DialogTitle className="pr-8">Přiřadit k zakázce</DialogTitle>
        <p className="-mt-1 text-xs text-muted-foreground">Nahoře otevřené zakázky firmy odesílatele.</p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Číslo, název, objednávka zákazníka…" className="pl-9" data-testid="job-picker-search" />
        </div>
        <ul className="max-h-[50vh] space-y-1 overflow-y-auto" data-testid="job-picker-list">
          {list === null ? (
            <li className="flex items-center gap-2 p-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Hledám…</li>
          ) : list.length === 0 ? (
            <li className="p-2 text-sm text-muted-foreground">Nic nenalezeno.</li>
          ) : list.map((j) => {
            const meta = isJobStage(j.stage) ? stageMeta(j.stage) : null;
            return (
              <li key={j.id}>
                <button
                  type="button" onClick={() => onPick(j)} disabled={j.id === currentId}
                  className={cn("flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50")}
                  data-testid="job-picker-item"
                >
                  <span className="font-semibold tabular-nums">{j.number}</span>
                  <span className="min-w-0 flex-1 truncate">{j.title}{j.customer ? <span className="text-muted-foreground"> · {j.customer}</span> : null}</span>
                  {meta && <span className="shrink-0 text-[11px] text-muted-foreground">{meta.label}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
