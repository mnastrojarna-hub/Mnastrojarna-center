"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Building2, Sparkles, Camera, Mail, Trash2, MoreHorizontal, Banknote, Package, FileText, Paperclip,
  Hash, Loader2, Import, Bot, Flag, Combine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { StageBadge } from "@/components/jobs/stage-badge";
import { StageSelect } from "@/components/jobs/stage-select";
import { CaptureButton } from "@/components/jobs/capture/capture-button";
import { deleteJob } from "@/app/actions/jobs";
import { stageMeta } from "@/lib/jobs/stages";
import type { PriorityLevel } from "@/lib/supabase/database.types";
import type { JobDetail } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";
import { useJobDetail } from "./detail-context";
import { InlineEditor, PersonChip, useOptimisticValue } from "./inline-field";
import { UploadButton } from "./upload-controls";
import { DocumentsMenu } from "./documents-menu";
import { currentDeliveryNotes } from "@/lib/jobs/delivery-notes";
import { ConfirmDialog } from "./confirm-dialog";
import { MergeJobDialog } from "./merge-job-dialog";
import { PRIORITY_META, PRIORITY_ORDER, formatMoney, formatQty } from "./detail-helpers";
import { ProductionHeaderBadges } from "@/components/jobs/production/production-chip";
import { FlowActionBar, FlowNextHint, FlowProposalLine, FlowStageChip, FlowTrail, StageStamp } from "./flow-header";
import { QuoteApprovalFlag } from "@/components/flow-status/quote-approval-flag";
import { approvalHint, jobApprovalFlag } from "./approval";
import { useAccess } from "@/components/access-provider";
import { quoteApproverWhoFor } from "@/lib/jobs/flow-status";

/** Lepicí lišta nahoře: zpět, číslo + stav, hlavní akce (na mobilu jen ikony). */
/** Čip DL v hlavičce: číslo z delivery_notes (jediný zdroj čísla DL); starší data bez řádku → ze souborů. */
function headerDeliveryNote(job: JobDetail): { id: string; number: string } | null {
  const fromDb = job.deliveryNotes?.find((n) => n.id);
  if (fromDb?.id) return { id: fromDb.id, number: fromDb.number };
  return currentDeliveryNotes(job.files ?? [])[0] ?? null;
}

export function JobToolbar({ job }: { job: JobDetail }) {
  const { perms } = useJobDetail();
  const { quoteApprovers } = useAccess();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [mergeOpen, setMergeOpen] = React.useState(false);
  const approval = jobApprovalFlag(job.flowQuotes, job.quotes, quoteApprovers);
  return (
    // -top-5 = horní odsazení <main> (pt-5): lišta se přilepí bez mezery, kterou by prosvítal obsah
    <div className="sticky -top-5 z-30 -mx-4 border-b bg-background/95 px-4 py-2 shadow-sm backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
          <Button asChild variant="ghost" size="icon-sm" className="shrink-0">
            <Link href="/orders" aria-label="Zpět do Knihy zakázek" title="Kniha zakázek">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          {/* číslo se raději zkrátí (celé v title), štítek schválení zůstane vždy vidět */}
          <span className="min-w-0 truncate font-mono text-sm font-bold tracking-tight" title={job.number}>{job.number}</span>
          <StageBadge stage={job.stage} size="xs" short className="hidden min-[400px]:inline-flex sm:hidden" />
          <StageBadge stage={job.stage} size="sm" className="hidden sm:inline-flex" />
          {approval && approval.flag.kind !== "approved" && (
            <>
              {/* mobil: jen ikona (text v title / pro čtečky), od sm krátký text — nikdy useknutý */}
              <QuoteApprovalFlag flag={approval.flag} size="xs" iconOnly className="shrink-0 sm:hidden" />
              <QuoteApprovalFlag flag={approval.flag} size="xs" short className="hidden shrink-0 sm:inline-flex" />
            </>
          )}
          <span className="hidden min-w-0 truncate text-sm text-muted-foreground lg:inline">{job.title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <CaptureButton jobId={job.id} label="Foto" size="sm" className="sm:hidden" />
          <CaptureButton jobId={job.id} label="Přidat doklad (foto)" size="sm" className="hidden sm:inline-flex" />
          <UploadButton size="sm" compact className="px-2.5 sm:px-3" />
          <DocumentsMenu quotes={job.quotes} acceptedQuoteId={job.acceptedQuoteId} items={job.items} files={job.files} documented={job.deliveryDocumented} invoiceNumber={job.invoiceNumber} size="sm" compact className="px-2.5 sm:px-3" />
          {(perms.canDelete || perms.canMerge) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" aria-label="Další akce">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {perms.canMerge && (
                  <DropdownMenuItem onSelect={() => setMergeOpen(true)}>
                    <Combine /> Sloučit s jinou zakázkou…
                  </DropdownMenuItem>
                )}
                {perms.canDelete && (
                  <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-red-600 focus:text-red-700 dark:text-red-400">
                    <Trash2 className="!text-current" /> Smazat zakázku
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {perms.canDelete && <DeleteJobDialog job={job} open={confirmDelete} onOpenChange={setConfirmDelete} />}
      {perms.canMerge && <MergeJobDialog job={job} open={mergeOpen} onOpenChange={setMergeOpen} />}
    </div>
  );
}

function DeleteJobDialog({ job, open, onOpenChange }: { job: JobDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { notify } = useJobDetail();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={Trash2}
      tone="bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
      title={`Smazat zakázku ${job.number}?`}
      confirmLabel="Ano, smazat natrvalo"
      confirmVariant="destructive"
      onConfirm={async () => {
        const res = await deleteJob(job.id);
        if (!res.ok) return res.error ?? "Zakázku se nepodařilo smazat.";
        notify("success", `Zakázka ${job.number} smazána.`);
        router.push("/orders");
        router.refresh();
        return null;
      }}
    >
      Smaže se zakázka <strong className="text-foreground">{job.title}</strong> včetně položek,{" "}
      {job.quotes.length} {job.quotes.length === 1 ? "nabídky" : "nabídek"}, {job.files.length} dokumentů a celé historie.
      Tohle nejde vrátit. Když zakázka jen neproběhla, raději ji přepni do stavu <em>Nerealizováno</em> nebo <em>Zrušeno</em>.
    </ConfirmDialog>
  );
}

/** Přepínač priority (tři barevné volby, uloží se hned). */
function PrioritySwitch({ value }: { value: PriorityLevel }) {
  const { save, notify } = useJobDetail();
  const [saving, setSaving] = React.useState(false);
  const { shown, setPending } = useOptimisticValue(value, saving);

  async function pick(p: PriorityLevel) {
    if (p === shown || saving) return;
    setPending(p);
    setSaving(true);
    const err = await save({ priority: p });
    setSaving(false);
    if (err) {
      setPending(undefined);
      notify("error", err);
    }
  }

  return (
    <div role="radiogroup" aria-label="Priorita" className="inline-flex items-center gap-0.5 rounded-full border bg-background/70 p-0.5">
      <Flag className="ml-1.5 mr-0.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      {PRIORITY_ORDER.map((p) => {
        const m = PRIORITY_META[p];
        const on = shown === p;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => void pick(p)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition",
              on ? m.active : "text-muted-foreground hover:bg-muted",
            )}
          >
            {!on && <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />}
            {m.label}
          </button>
        );
      })}
      {saving && <Loader2 className="mx-1 h-3 w-3 animate-spin text-muted-foreground" />}
    </div>
  );
}

function SourceBadge({ job }: { job: JobDetail }) {
  const map = {
    foto: { icon: Camera, label: "Z fotky dokladu", cls: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300" },
    email: { icon: Mail, label: "Z e-mailu", cls: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300" },
    import: { icon: Import, label: "Import", cls: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300" },
    ai: { icon: Bot, label: "Založila AI", cls: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300" },
  } as const;
  if (job.source === "manual") return null;
  const m = map[job.source];
  if (!m) return null;
  const Icon = m.icon;
  const inner = (
    <>
      <Icon className="h-3 w-3" /> {m.label}
    </>
  );
  const cls = cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", m.cls);
  return job.source === "email" && job.emailId ? (
    <Link href="/inbox" className={cn(cls, "hover:brightness-95")} title="Zakázka vznikla z e-mailu — otevřít poštu">{inner}</Link>
  ) : (
    <span className={cls}>{inner}</span>
  );
}

function Stat({ icon: Icon, tone, label, children }: { icon: typeof Banknote; tone: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg bg-background/70 px-2.5 py-1.5 ring-1 ring-border/60 sm:gap-2.5 sm:px-3 sm:py-2">
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md sm:h-8 sm:w-8", tone)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-[11px]">{label}</div>
        <div className="truncate text-sm font-semibold tabular-nums">{children}</div>
      </div>
    </div>
  );
}

/**
 * Hlavička karty: barva stavu, číslo, název (upravitelný), zákazník, stav s autorem poslední změny,
 * jediné primární tlačítko (sloveso dalšího kroku) + menu „⋯", řádek průběhu fází, priorita.
 */
export function JobHeader({ job }: { job: JobDetail }) {
  const { save } = useJobDetail();
  const { quoteApprovers } = useAccess();
  const approval = jobApprovalFlag(job.flowQuotes, job.quotes, quoteApprovers);
  // 31. 10.: kdo čekající nabídku schválí (schvalovatelé kromě autora + super admin)
  const approvalWho = quoteApproverWhoFor(job.flowQuotes?.find((q) => q.id === approval?.flag.quoteId), quoteApprovers);
  const m = stageMeta(job.stage);
  const currentQuotes = job.quotes.filter((q) => !q.archived).length;
  const currentFiles = job.files.filter((f) => !f.archived).length;

  return (
    <section
      aria-label="Zakázka"
      className={cn("relative overflow-hidden rounded-xl border bg-card shadow-sm", m.ring)}
      style={{ backgroundImage: `linear-gradient(135deg, ${m.hex}26 0%, ${m.hex}0d 45%, transparent 75%)` }}
    >
      <div className={cn("h-1.5 w-full", m.bar)} />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-sm font-bold", m.badge)}>
                <Hash className="h-3.5 w-3.5" />
                {job.number}
              </span>
              <SourceBadge job={job} />
              {job.aiFilled && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-fuchsia-100 px-2 py-0.5 text-xs font-medium text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300"
                  title="Údaje předvyplnila AI z dokladu — zkontroluj je. Každou opravu si AI zapamatuje."
                >
                  <Sparkles className="h-3 w-3" /> Vyplnila AI
                  {job.aiConfidence !== null && <span className="opacity-75">· {Math.round(job.aiConfidence * 100)} %</span>}
                </span>
              )}
            </div>
            <InlineEditor
              label="Název zakázky"
              hideLabel
              size="xl"
              value={job.title}
              placeholder="Pojmenuj zakázku"
              onSave={(v) => (v.trim() ? save({ title: v }) : Promise.resolve("Název nesmí být prázdný."))}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {job.customer ? (
                <Link
                  href={`/customers/${job.customer.id}`}
                  className="inline-flex min-w-0 items-center gap-1.5 font-medium text-sky-700 hover:underline dark:text-sky-400"
                >
                  <Building2 className="h-4 w-4 shrink-0" />
                  <span className="truncate">{job.customer.name}</span>
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Building2 className="h-4 w-4" /> Bez zákazníka — doplň v Přehledu
                </span>
              )}
              {job.customer?.customerNumber && (
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground" title="Naše číslo zákazníka">
                  zák. č. {job.customer.customerNumber}
                </span>
              )}
              {job.customerOrderNumber && (
                <span className="text-xs text-muted-foreground">obj. zákazníka <strong className="font-mono text-foreground">{job.customerOrderNumber}</strong></span>
              )}
              {job.owner && <PersonChip name={job.owner.name} className="text-xs text-muted-foreground" />}
            </div>
          </div>

          <div className="flex flex-col items-start gap-2 lg:items-end">
            <div className="flex flex-col items-start gap-0.5 lg:items-end">
              <StageSelect jobId={job.id} stage={job.stage} flow={job.flow} quotes={job.flowQuotes} />
              <StageStamp className="max-w-[18rem]" />
            </div>
            <FlowStageChip hidePendingQuote={approval?.flag.kind === "pending"} deliveryNote={headerDeliveryNote(job)} />
            {approval && (
              // #25: neschválenou nabídku vidí všichni, ale výrazně označenou; po schválení razítko kdo a kdy
              <QuoteApprovalFlag flag={approval.flag} suffix={approval.suffix} wrap className="lg:self-end" />
            )}
            <FlowProposalLine className="lg:justify-end" />
            <FlowActionBar className="lg:justify-end" />
            <ProductionHeaderBadges job={job} className="lg:justify-end" />
            <FlowNextHint fallback={approvalHint(approval?.flag.kind, approvalWho) ?? m.description} className="max-w-xs text-xs text-muted-foreground lg:text-right" />
            <PrioritySwitch value={job.priority} />
          </div>
        </div>

        <FlowTrail />

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat icon={Banknote} tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" label="Hodnota (bez DPH)">
            {job.value !== null ? formatMoney(job.value, job.currency) : <span className="font-normal text-muted-foreground">nenaceněno</span>}
          </Stat>
          <Stat icon={Package} tone="bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" label="Položky">
            {job.itemCount ? `${job.itemCount} · ${formatQty(job.totalQuantity)} ks` : <span className="font-normal text-muted-foreground">žádné</span>}
          </Stat>
          <Stat icon={FileText} tone="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" label="Nabídky">
            {currentQuotes || <span className="font-normal text-muted-foreground">žádná</span>}
          </Stat>
          <Stat icon={Paperclip} tone="bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" label="Dokumenty">
            {currentFiles || <span className="font-normal text-muted-foreground">žádné</span>}
          </Stat>
        </div>
      </div>
    </section>
  );
}
