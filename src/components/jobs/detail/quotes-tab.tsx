"use client";

import * as React from "react";
import {
  FilePlus2, CheckCircle2, Send, ThumbsUp, ThumbsDown, Pencil, MailCheck, CopyPlus, Archive, ArchiveRestore,
  FileSearch, Trash2, MoreHorizontal, Loader2, Sparkles, ChevronDown, Clock, CalendarDays, UserRound, BadgeCheck,
  FileText, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  approveJobQuote, markJobQuoteSent, acceptJobQuote, rejectJobQuote, newJobQuoteRevision, setJobQuoteArchived,
  deleteJobQuote,
} from "@/app/actions/jobs";
import type { ActionResult, JobDetail, JobQuote } from "@/lib/jobs/types";
import { cn, relativeTime } from "@/lib/utils";
import { useJobDetail } from "./detail-context";
import { ConfirmDialog, DialogHead, ErrorBox } from "./confirm-dialog";
import { QuoteEditorDialog } from "./quote-editor-dialog";
import { QuoteSendDialog } from "./quote-send-dialog";
import { PersonChip } from "./inline-field";
import {
  quoteActions, quoteStatusMeta, splitQuotes, quoteFormFromJob, quoteFormFromQuote, formatMoney, formatQty, longDate,
  type QuoteAction, type QuoteFormState,
} from "./detail-helpers";

export function QuoteStatusBadge({ status, className }: { status: string; className?: string }) {
  const m = quoteStatusMeta(status);
  return (
    <span title={m.hint} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", m.badge, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

type Dialogs =
  | { kind: "none" }
  | { kind: "editor"; initial: QuoteFormState; quote?: JobQuote }
  | { kind: "send"; quote: JobQuote }
  | { kind: "accept"; quote: JobQuote }
  | { kind: "reject"; quote: JobQuote }
  | { kind: "delete"; quote: JobQuote };

const MENU: Partial<Record<QuoteAction, { label: string; icon: LucideIcon; cls?: string }>> = {
  edit: { label: "Upravit nabídku", icon: Pencil },
  markSent: { label: "Označit jako odeslanou", icon: MailCheck },
  reject: { label: "Zákazník nabídku zamítl", icon: ThumbsDown },
  revision: { label: "Nová verze (stará se archivuje)", icon: CopyPlus },
  archive: { label: "Archivovat", icon: Archive },
  unarchive: { label: "Obnovit z archivu", icon: ArchiveRestore },
  delete: { label: "Smazat nabídku", icon: Trash2, cls: "text-red-600 focus:text-red-700 dark:text-red-400" },
};

function QuoteCard({
  quote, jobId, onDialog, compact,
}: { quote: JobQuote; jobId: string; onDialog: (d: Dialogs) => void; compact?: boolean }) {
  const { perms, notify, refresh } = useJobDetail();
  const [busy, setBusy] = React.useState<QuoteAction | null>(null);
  const m = quoteStatusMeta(quote.status);
  const actions = quoteActions(quote, { canDelete: perms.canDelete });
  const has = (a: QuoteAction) => actions.includes(a);
  const pdfHref = `/api/pdf/job/${jobId}?type=nabidka&quoteId=${quote.id}`;

  async function run(a: QuoteAction, fn: () => Promise<ActionResult>, ok: string) {
    if (busy) return;
    setBusy(a);
    try {
      const res = await fn();
      if (!res.ok) notify("error", res.error ?? "Akce se nepovedla.");
      else {
        notify("success", ok);
        refresh();
      }
    } catch {
      notify("error", "Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  }

  function onMenu(a: QuoteAction) {
    switch (a) {
      case "edit": return onDialog({ kind: "editor", initial: quoteFormFromQuote(quote), quote });
      case "markSent": return void run(a, () => markJobQuoteSent(quote.id), `Nabídka ${quote.number} označena jako odeslaná.`);
      case "reject": return onDialog({ kind: "reject", quote });
      case "revision": return void run(a, () => newJobQuoteRevision(quote.id), `Vytvořena nová verze nabídky ${quote.number}.`);
      case "archive": return void run(a, () => setJobQuoteArchived(quote.id, true), `Nabídka ${quote.number} archivována.`);
      case "unarchive": return void run(a, () => setJobQuoteArchived(quote.id, false), `Nabídka ${quote.number} obnovena.`);
      case "delete": return onDialog({ kind: "delete", quote });
    }
  }

  const preview = quote.items.slice(0, compact ? 2 : 4);
  const menuActions = actions.filter((a) => MENU[a]);

  return (
    <article className={cn("relative overflow-hidden rounded-xl border bg-card shadow-sm", quote.archived && "opacity-75", quote.accepted && "ring-2 ring-green-500/40")}>
      <span className={cn("absolute inset-y-0 left-0 w-1.5", m.bar)} aria-hidden />
      <div className="space-y-3 p-4 pl-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <FileText className="h-4 w-4 text-violet-500" />
              <span className="font-mono text-sm font-bold">{quote.number}</span>
              <span className="rounded bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground">rev. {quote.revision}</span>
              <QuoteStatusBadge status={quote.status} />
              {quote.accepted && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-xs font-semibold text-white">
                  <CheckCircle2 className="h-3 w-3" /> Přijatá — platí pro zakázku
                </span>
              )}
              {quote.aiGenerated && (
                <span className="inline-flex items-center gap-1 rounded-full bg-fuchsia-100 px-2 py-0.5 text-xs font-medium text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300">
                  <Sparkles className="h-3 w-3" /> AI
                </span>
              )}
              {quote.archived && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">archiv</span>}
            </div>
            {quote.title && <p className="truncate text-sm font-medium">{quote.title}</p>}
          </div>
          <div className="text-right">
            <div className="text-lg font-bold tabular-nums">
              {quote.total !== null ? formatMoney(quote.total, quote.currency) : <span className="text-sm font-normal text-amber-600">bez ceny</span>}
            </div>
            <div className="text-[11px] text-muted-foreground">bez DPH</div>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
          <div>
            <dt className="flex items-center gap-1 text-muted-foreground"><CalendarDays className="h-3 w-3 text-violet-500" /> Platnost do</dt>
            <dd className="font-medium">{longDate(quote.validUntil) ?? "—"}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-muted-foreground"><Clock className="h-3 w-3 text-violet-500" /> Dodací lhůta</dt>
            <dd className="font-medium">{quote.leadTimeDays !== null ? `${quote.leadTimeDays} dní` : "—"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="flex items-center gap-1 text-muted-foreground"><UserRound className="h-3 w-3 text-violet-500" /> Zadal</dt>
            <dd className="flex flex-wrap items-center gap-x-1">
              <PersonChip name={quote.createdBy?.name ?? "—"} className="text-xs" />
              <span className="text-muted-foreground" title={longDate(quote.createdAt) ?? undefined} suppressHydrationWarning>{relativeTime(quote.createdAt)}</span>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="flex items-center gap-1 text-muted-foreground"><BadgeCheck className="h-3 w-3 text-violet-500" /> Schválil</dt>
            <dd>
              {quote.approvedBy ? (
                <span className="flex flex-wrap items-center gap-x-1">
                  <PersonChip name={quote.approvedBy.name} className="text-xs" />
                  {quote.approvedAt && <span className="text-muted-foreground">{longDate(quote.approvedAt)}</span>}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-px font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                  čeká na schválení
                </span>
              )}
            </dd>
          </div>
        </dl>

        {preview.length > 0 && (
          <ul className="divide-y rounded-lg border bg-muted/20 text-xs">
            {preview.map((it) => (
              <li key={it.id} className="flex items-center gap-2 px-2.5 py-1.5">
                {it.drawingNumber && <span className="shrink-0 font-mono font-medium text-blue-700 dark:text-blue-400">{it.drawingNumber}</span>}
                <span className="min-w-0 flex-1 truncate">{it.name || it.description || "—"}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatQty(it.quantity)} {it.unit}</span>
                <span className="w-24 shrink-0 text-right tabular-nums">
                  {it.unitPrice !== null ? formatMoney(it.unitPrice * it.quantity, quote.currency) : <span className="text-amber-600">bez ceny</span>}
                </span>
              </li>
            ))}
            {quote.items.length > preview.length && (
              <li className="px-2.5 py-1 text-muted-foreground">a další {quote.items.length - preview.length}…</li>
            )}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {has("approve") && (
            <Button size="sm" variant="success" disabled={Boolean(busy)} onClick={() => void run("approve", () => approveJobQuote(quote.id), `Nabídka ${quote.number} schválena — můžeš ji odeslat.`)}>
              {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Schválit
            </Button>
          )}
          {has("send") && (
            <Button
              size="sm"
              variant="send"
              disabled={Boolean(busy) || (!quote.approvedBy && quote.status !== "odeslano")}
              title={!quote.approvedBy && quote.status !== "odeslano" ? "Nejdřív nabídku schval" : undefined}
              onClick={() => onDialog({ kind: "send", quote })}
            >
              <Send className="h-4 w-4" /> {quote.status === "odeslano" ? "Odeslat znovu" : "Odeslat zákazníkovi"}
            </Button>
          )}
          {has("accept") && (
            <Button size="sm" variant="outline" className="border-green-300 text-green-700 hover:bg-green-50 dark:border-green-500/40 dark:text-green-400 dark:hover:bg-green-500/10" disabled={Boolean(busy)} onClick={() => onDialog({ kind: "accept", quote })}>
              <ThumbsUp className="h-4 w-4" /> Přijata zákazníkem
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            <a href={pdfHref} target="_blank" rel="noopener noreferrer">
              <FileSearch className="h-4 w-4 text-violet-600" /> PDF náhled
            </a>
          </Button>
          {menuActions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" disabled={Boolean(busy)} aria-label="Další akce nabídky">
                  {busy && busy !== "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                  <span className="hidden sm:inline">Další</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {menuActions.map((a, i) => {
                  const item = MENU[a]!;
                  const Icon = item.icon;
                  return (
                    <React.Fragment key={a}>
                      {a === "delete" && i > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuItem onSelect={() => onMenu(a)} className={item.cls}>
                        <Icon className={cn(item.cls && "!text-current")} /> {item.label}
                      </DropdownMenuItem>
                    </React.Fragment>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {!quote.archived && quote.status !== "prijato" && quote.status !== "zamitnuto" && (
          <p className="text-[11px] text-muted-foreground">{m.hint}</p>
        )}
      </div>
    </article>
  );
}

function RejectDialog({ quote, open, onOpenChange }: { quote: JobQuote; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { notify, refresh } = useJobDetail();
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await rejectJobQuote(quote.id, reason);
      if (!res.ok) return setError(res.error ?? "Nepovedlo se.");
      notify("success", `Nabídka ${quote.number} označena jako zamítnutá.`);
      setReason("");
      onOpenChange(false);
      refresh();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className="w-[calc(100%-1.5rem)] sm:max-w-md">
        <DialogHead icon={ThumbsDown} tone="bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400" title={`Zákazník zamítl nabídku ${quote.number}`} subtitle="Důvod pomůže příště lépe nacenit (učí se z něj i AI)." />
        <form onSubmit={submit} className="space-y-4 p-5">
          <ErrorBox error={error} />
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="např. vysoká cena, dlouhý termín, objednali jinde…" autoFocus />
          <div className="flex flex-wrap gap-1.5">
            {["Vysoká cena", "Dlouhý termín", "Objednali jinde", "Projekt zrušen"].map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className="rounded-full bg-muted px-2.5 py-1 text-xs hover:bg-accent">
                {r}
              </button>
            ))}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Zpět</Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Označit jako zamítnutou
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Záložka Nabídky — nejnovější nahoře, starší verze schované v archivu. */
export function QuotesTab({ job }: { job: JobDetail }) {
  const { notify, refresh } = useJobDetail();
  const [dialog, setDialog] = React.useState<Dialogs>({ kind: "none" });
  const [showArchive, setShowArchive] = React.useState(false);
  const { current, archived } = splitQuotes(job.quotes);
  const close = (o: boolean) => !o && setDialog({ kind: "none" });
  const fallbackTo = job.customerContactEmail ?? job.customerDetail?.email ?? "";

  const newQuote = () => setDialog({ kind: "editor", initial: quoteFormFromJob(job) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Každá změna ceny = nová verze. Zákazník přijme jednu nabídku — ta určí hodnotu zakázky.
        </p>
        {current.length > 0 && (
          <Button type="button" variant="success" onClick={newQuote}>
            <FilePlus2 className="h-4 w-4" /> Nová nabídka
          </Button>
        )}
      </div>

      {current.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-violet-200 bg-violet-50/40 px-4 py-10 text-center dark:border-violet-500/20 dark:bg-violet-500/5">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
            <FileText className="h-6 w-6" />
          </span>
          <div>
            <p className="font-medium">Zatím žádná nabídka</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Vytvoř ji z položek zakázky jedním klikem — doplníš jen ceny a termín. Pak ji schválíš a odešleš zákazníkovi.
            </p>
          </div>
          <Button type="button" variant="success" onClick={newQuote}>
            <FilePlus2 className="h-4 w-4" /> {job.items.length ? `Vytvořit nabídku z ${job.items.length} ${job.items.length === 1 ? "položky" : "položek"}` : "Vytvořit nabídku"}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {current.map((q) => (
            <QuoteCard key={q.id} quote={q} jobId={job.id} onDialog={setDialog} />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowArchive((s) => !s)}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={showArchive}
          >
            <ChevronDown className={cn("h-4 w-4 transition", showArchive && "rotate-180")} />
            Starší verze ({archived.length})
          </button>
          {showArchive && (
            <div className="mt-3 space-y-3">
              {archived.map((q) => (
                <QuoteCard key={q.id} quote={q} jobId={job.id} onDialog={setDialog} compact />
              ))}
            </div>
          )}
        </div>
      )}

      <QuoteEditorDialog
        open={dialog.kind === "editor"}
        onOpenChange={close}
        initial={dialog.kind === "editor" ? dialog.initial : quoteFormFromJob(job)}
        quoteId={dialog.kind === "editor" ? dialog.quote?.id : undefined}
        quoteNumber={dialog.kind === "editor" ? dialog.quote?.number : undefined}
        approved={dialog.kind === "editor" ? Boolean(dialog.quote?.approvedBy) : false}
        currency={dialog.kind === "editor" ? dialog.quote?.currency ?? job.currency : job.currency}
      />
      {dialog.kind === "send" && (
        <QuoteSendDialog
          open
          onOpenChange={close}
          quote={dialog.quote}
          fallback={{ to: fallbackTo, jobNumber: job.number, title: job.title, contact: job.customerContact }}
        />
      )}
      {dialog.kind === "reject" && <RejectDialog quote={dialog.quote} open onOpenChange={close} />}
      {dialog.kind === "accept" && (
        <ConfirmDialog
          open
          onOpenChange={close}
          icon={ThumbsUp}
          tone="bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
          title={`Zákazník přijal nabídku ${dialog.quote.number}?`}
          confirmLabel="Ano, přijata"
          confirmVariant="success"
          onConfirm={async () => {
            const res = await acceptJobQuote(dialog.quote.id);
            if (!res.ok) return res.error ?? "Nepovedlo se.";
            notify("success", `Nabídka ${dialog.quote.number} přijata — zakázka je teď Objednávka.`);
            refresh();
            return null;
          }}
        >
          Zakázka se posune do stavu <strong className="text-foreground">Objednávka</strong>
          {dialog.quote.total !== null && <> a její hodnota bude <strong className="text-foreground">{formatMoney(dialog.quote.total, dialog.quote.currency)}</strong> bez DPH</>}.
          Objednávku zákazníka pak stačí vyfotit tlačítkem „Přidat doklad“.
        </ConfirmDialog>
      )}
      {dialog.kind === "delete" && (
        <ConfirmDialog
          open
          onOpenChange={close}
          icon={Trash2}
          tone="bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
          title={`Smazat nabídku ${dialog.quote.number}?`}
          confirmLabel="Smazat natrvalo"
          confirmVariant="destructive"
          onConfirm={async () => {
            const res = await deleteJobQuote(dialog.quote.id);
            if (!res.ok) return res.error ?? "Nepovedlo se.";
            notify("success", `Nabídka ${dialog.quote.number} smazána.`);
            refresh();
            return null;
          }}
        >
          Nabídka zmizí i s položkami. Pokud ji chceš jen schovat, použij raději <em>Archivovat</em>.
        </ConfirmDialog>
      )}
    </div>
  );
}
