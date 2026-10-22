"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Eye, FileOutput, Loader2, Send, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { generateJobDocument, type JobDocumentKind } from "@/app/actions/job-documents";
import { FILE_KINDS } from "@/lib/jobs/file-kinds";
import { stageMeta } from "@/lib/jobs/stages";
import type { JobStage } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { DocumentSendDialog } from "./document-send-dialog";
import { FlowCombo, type ComboItem } from "./flow-combo";
import { ISSUABLE_KINDS } from "./flow-utils";

export interface IssueJob {
  id: string;
  number: string;
  title: string;
  customerName: string | null;
  stage: JobStage;
  hasQuote: boolean;
}

/** Jaký doklad se k zakázce v daném stavu nejspíš hodí. */
export function suggestedKind(stage: JobStage): JobDocumentKind {
  if (stage === "poptavka" || stage === "naceneni" || stage === "nabidka") return "nabidka";
  if (stage === "objednavka" || stage === "potvrzeno") return "potvrzeni";
  if (stage === "dodano_zakaznikovi" || stage === "fakturovano" || stage === "dokonceno") return "faktura";
  return "dodaci_list";
}

const ACCUSATIVE: Record<JobDocumentKind, string> = {
  nabidka: "nabídku", potvrzeni: "potvrzení objednávky", dodaci_list: "dodací list", faktura: "fakturu",
};

const SELECTED: Record<JobDocumentKind, string> = {
  nabidka: "border-violet-400 ring-2 ring-violet-400/40 dark:border-violet-500",
  potvrzeni: "border-indigo-400 ring-2 ring-indigo-400/40 dark:border-indigo-500",
  dodaci_list: "border-green-400 ring-2 ring-green-400/40 dark:border-green-500",
  faktura: "border-emerald-500 ring-2 ring-emerald-500/40 dark:border-emerald-500",
};

/**
 * „Vystavit doklad ze zakázky": vyber zakázku a druh → PDF se uloží do Dokumentů
 * zakázky (nová verze, stará do archivu) a jde rovnou poslat zákazníkovi.
 */
export function IssueDocumentPanel({ jobs }: { jobs: IssueJob[] }) {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [kind, setKind] = React.useState<JobDocumentKind>("faktura");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ fileId: string; filename: string; number: string; version: number; kind: JobDocumentKind; jobId: string } | null>(null);
  const [sending, setSending] = React.useState(false);

  const job = jobs.find((j) => j.id === jobId) ?? null;
  const items: ComboItem[] = React.useMemo(
    () => jobs.map((j) => ({
      id: j.id,
      label: `${j.number} — ${j.title || "bez názvu"}`,
      sub: [j.customerName, stageMeta(j.stage).label].filter(Boolean).join(" · "),
      dot: stageMeta(j.stage).dot,
    })),
    [jobs],
  );

  async function issue(force = false) {
    if (!job || busy) return;
    if (kind === "nabidka" && !job.hasQuote) {
      setError("Zakázka zatím nemá nabídku — vytvoř ji v Nacenění („Vytvořit nabídku z ceny“) nebo v kartě zakázky.");
      return;
    }
    setBusy(true);
    setError(null);
    setWarning(null);
    setDone(null);
    try {
      const res = await generateJobDocument(job.id, kind, force ? { force: true } : undefined);
      if (!res.ok || !res.fileId) {
        if (res.unpriced) setWarning(res.error ?? "Některé položky nemají cenu.");
        else setError(res.error ?? "Doklad se nepodařilo vystavit.");
        return;
      }
      setDone({ fileId: res.fileId, filename: res.filename ?? "doklad.pdf", number: res.number ?? "", version: res.version ?? 1, kind, jobId: job.id });
      router.refresh();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  const previewType = ISSUABLE_KINDS.find((k) => k.kind === kind)?.preview ?? "faktura";

  return (
    <div className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">1. Zakázka</span>
        <FlowCombo
          items={items}
          text={text}
          selectedId={jobId}
          onChange={(t, id) => {
            setText(t);
            setJobId(id);
            setDone(null);
            setWarning(null);
            setError(null);
            const picked = id ? jobs.find((j) => j.id === id) : null;
            if (picked) setKind(suggestedKind(picked.stage));
          }}
          placeholder="Hledej číslo zakázky, název nebo zákazníka…"
          max={10}
        />
      </label>

      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">2. Druh dokladu</span>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {ISSUABLE_KINDS.map((k) => {
            const m = FILE_KINDS[k.kind];
            const Icon = m.icon;
            const on = kind === k.kind;
            const noQuote = k.kind === "nabidka" && job !== null && !job.hasQuote;
            return (
              <button
                key={k.kind}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setKind(k.kind);
                  setDone(null);
                  setWarning(null);
                  setError(null);
                }}
                className={cn(
                  "flex items-start gap-2 rounded-xl border bg-background p-2.5 text-left transition hover:bg-accent/50",
                  on && SELECTED[k.kind],
                )}
              >
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", m.badge)}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-tight">{k.label}</span>
                  <span className={cn("block text-[11px] leading-snug text-muted-foreground", noQuote && "text-amber-700 dark:text-amber-400")}>
                    {noQuote ? "zakázka nemá nabídku" : k.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <ErrorBox error={error} />
      {warning && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <p className="flex items-start gap-2 font-medium">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> {warning}
          </p>
          <div className="flex flex-wrap gap-2">
            {job && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/orders/${job.id}?tab=polozky`}>Doplnit ceny</Link>
              </Button>
            )}
            <Button type="button" size="sm" onClick={() => void issue(true)} disabled={busy}>Přesto vystavit</Button>
          </div>
        </div>
      )}
      {done && (
        <div role="status" className="flex flex-col gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-100 sm:flex-row sm:items-center">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
          <p className="min-w-0 flex-1">
            Hotovo: <span className="font-semibold">{ISSUABLE_KINDS.find((k) => k.kind === done.kind)?.label} {done.number}</span>
            {done.version > 1 ? ` (verze ${done.version}, starší je v archivu)` : ""} — uloženo v Dokumentech zakázky.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <a href={`/api/jobs/files/${done.fileId}`} target="_blank" rel="noopener noreferrer">
                Otevřít PDF <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
            <Button type="button" size="sm" variant="send" onClick={() => setSending(true)}>
              <Send className="h-4 w-4" /> Poslat zákazníkovi
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        {job && (
          <Button asChild variant="ghost">
            <a href={`/api/pdf/job/${job.id}?type=${previewType}`} target="_blank" rel="noopener noreferrer">
              <Eye className="h-4 w-4" /> Náhled bez uložení
            </a>
          </Button>
        )}
        <Button type="button" onClick={() => void issue()} disabled={!job || busy} className="bg-emerald-600 text-white shadow-sm hover:bg-emerald-600/90">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileOutput className="h-4 w-4" />}
          Vystavit PDF
        </Button>
      </div>

      {done && (
        <DocumentSendDialog
          open={sending}
          onOpenChange={setSending}
          jobId={done.jobId}
          kind={done.kind}
          fileId={done.fileId}
          filename={done.filename}
          title={`Poslat ${ACCUSATIVE[done.kind]} ${done.number} zákazníkovi`}
          onSent={() => {
            setSending(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
