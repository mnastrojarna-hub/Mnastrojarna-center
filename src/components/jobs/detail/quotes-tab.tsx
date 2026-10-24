"use client";

import * as React from "react";
import {
  FilePlus2, CheckCircle2, Send, ThumbsUp, ThumbsDown, Pencil, MailCheck, CopyPlus, Archive, ArchiveRestore,
  FileSearch, Trash2, MoreHorizontal, Loader2, ChevronDown, Clock, CalendarDays, UserRound, BadgeCheck,
  FileText, ShieldQuestion, MessageSquareWarning, CalendarPlus, Undo, Undo2, Hand, Lock, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { newJobQuoteRevision, setJobQuoteArchived, deleteJobQuote } from "@/app/actions/jobs";
import { setQuoteState } from "@/app/actions/flow-status";
import { StateChip } from "@/components/flow-status/state-chip";
import { ActorStamp } from "@/components/flow-status/actor-stamp";
import {
  FLOW_PALETTE, QUOTE_STATES, VIA_META, approvalReasons, canApproveQuote, lostReasonLabel, quoteSendBlock, sendViewerOf,
  type FlowActionKey,
} from "@/lib/jobs/flow-status";
import { QuoteApprovalFlag } from "@/components/flow-status/quote-approval-flag";
import { approvedToast, returnedSuffix } from "@/components/flow/quote-approval-copy";
import { quoteApprovedStamp, quoteCardFlag } from "./approval";
import type { ActionResult, JobDetail, JobQuote } from "@/lib/jobs/types";
import { cn, relativeTime } from "@/lib/utils";
import { useJobDetail } from "./detail-context";
import { ConfirmDialog } from "./confirm-dialog";
import { QuoteEditorDialog } from "./quote-editor-dialog";
import { QuoteSendDialog } from "./quote-send-dialog";
import { PersonChip } from "./inline-field";
import { useFlowActions } from "./flow-actions";
import {
  quoteActions, quoteDisplayOf, splitQuotes, quoteFormFromJob, quoteFormFromQuote, formatMoney, formatQty, longDate,
  type QuoteAction, type QuoteFormState,
} from "./detail-helpers";

/** Podrobný stav nabídky jako chip (QUOTE_STATES — jediná definice stavů nabídky). */
export function QuoteStateBadge({ quote, className }: { quote: JobQuote; className?: string }) {
  const shown = quoteDisplayOf(quote);
  return <StateChip meta={QUOTE_STATES[shown]} ai={quote.aiGenerated} className={className} />;
}

type Dialogs =
  | { kind: "none" }
  | { kind: "editor"; initial: QuoteFormState; quote?: JobQuote }
  | { kind: "send"; quote: JobQuote }
  | { kind: "accept"; quote: JobQuote }
  | { kind: "delete"; quote: JobQuote };

const MENU: Partial<Record<QuoteAction, { label: string; icon: LucideIcon; cls?: string }>> = {
  edit: { label: "Upravit nabídku", icon: Pencil },
  returnToAuthor: { label: "Vrátit k přepracování…", icon: Undo2 },
  markSent: { label: "Odesláno jinak…", icon: MailCheck },
  feedback: { label: "Zákazník má připomínky…", icon: MessageSquareWarning },
  answerNoChange: { label: "Odpovědět bez změny", icon: Send },
  extend: { label: "Prodloužit platnost…", icon: CalendarPlus },
  unapprove: { label: "Vrátit k úpravě…", icon: Undo },
  reopen: { label: "Zákazník se vrátil", icon: ThumbsUp },
  revision: { label: "Nová verze (stará se archivuje)", icon: CopyPlus },
  archive: { label: "Archivovat", icon: Archive },
  unarchive: { label: "Obnovit z archivu", icon: ArchiveRestore },
  reject: { label: "Zákazník nabídku zamítl…", icon: ThumbsDown, cls: "text-red-600 focus:text-red-700 dark:text-red-400" },
  propose: { label: "Navrhnout zamítnutí…", icon: Hand, cls: "text-red-600 focus:text-red-700 dark:text-red-400" },
  delete: { label: "Smazat nabídku", icon: Trash2, cls: "text-red-600 focus:text-red-700 dark:text-red-400" },
};

/** Akce nabídky, které otevírá sdílený dialog toku (stejný jako z hlavičky karty). */
const FLOW_KEY: Partial<Record<QuoteAction, FlowActionKey>> = {
  markSent: "quote.markSent",
  feedback: "quote.feedback",
  answerNoChange: "quote.answerNoChange",
  extend: "quote.extend",
  unapprove: "quote.unapprove",
  reopen: "quote.reopen",
  reject: "quote.reject",
  propose: "quote.propose",
  requestApproval: "quote.requestApproval",
  approve: "quote.approve",
  returnToAuthor: "quote.returnToAuthor",
};

function QuoteCard({
  quote, jobId, onDialog, compact,
}: { quote: JobQuote; jobId: string; onDialog: (d: Dialogs) => void; compact?: boolean }) {
  const { perms, notify, refresh } = useJobDetail();
  const flow = useFlowActions();
  const [busy, setBusy] = React.useState<QuoteAction | null>(null);
  const shown = quoteDisplayOf(quote);
  const meta = QUOTE_STATES[shown];
  const facts = flow?.quotes.find((q) => q.id === quote.id) ?? null;
  const canApprove = facts && flow ? canApproveQuote(facts, flow.ctx, approvalReasons(facts)) : perms.margins;
  const approver = flow ? flow.ctx.can("quote_approval") : undefined;
  // #25: odeslat podle stejných pravidel jako server (schválení + kdo smí); bez kontextu toku starší pravidlo
  const sendBlock = facts && flow ? quoteSendBlock(facts, sendViewerOf(flow.ctx)) : undefined;
  const actions = quoteActions(quote, {
    canDelete: perms.canDelete, margins: perms.margins, canApprove, approver, sendBlock, canReturn: approver,
  });
  const has = (a: QuoteAction) => actions.includes(a);
  const awaiting = !quote.archived && shown === "ke_schvaleni";
  const returned = awaiting && Boolean(quote.returnedAt);
  const flag = awaiting ? quoteCardFlag(quote) : null;
  const stamp = quoteApprovedStamp(quote);
  // super admin schvaluje sám — „po schválení super adminem“ by mu radilo čekat na sebe
  const sendLockText = approver ?"Nejdřív schval — pak půjde odeslat." : "Odeslat půjde po schválení super adminem.";
  const pdfHref = `/api/pdf/job/${jobId}?type=nabidka&quoteId=${quote.id}`;
  const runFlow = (a: QuoteAction) => {
    const key = FLOW_KEY[a];
    if (key && flow) flow.run(key, { quoteId: quote.id });
  };

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
      case "revision": return void run(a, () => newJobQuoteRevision(quote.id), `Vytvořena nová verze nabídky ${quote.number}.`);
      case "archive": return void run(a, () => setJobQuoteArchived(quote.id, true), `Nabídka ${quote.number} archivována.`);
      case "unarchive": return void run(a, () => setJobQuoteArchived(quote.id, false), `Nabídka ${quote.number} obnovena.`);
      case "delete": return onDialog({ kind: "delete", quote });
      default: return runFlow(a);
    }
  }

  const preview = quote.items.slice(0, compact ? 2 : 4);
  const menuActions = actions.filter((a) => MENU[a] && a !== "requestApproval" && a !== "returnToAuthor");

  return (
    <article className={cn("relative overflow-hidden rounded-xl border bg-card shadow-sm", quote.archived && "opacity-75", quote.accepted && "ring-2 ring-green-500/40")}>
      <span className={cn("absolute inset-y-0 left-0 w-1.5", FLOW_PALETTE[meta.palette].dot)} aria-hidden />
      <div className="space-y-3 p-4 pl-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <FileText className="h-4 w-4 text-violet-500" />
              <span className="font-mono text-sm font-bold">{quote.number}</span>
              <span className="rounded bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground">rev. {quote.revision}</span>
              {/* #25: čekající nabídku označuje výrazný štítek pod číslem — fialový chip by „Neschválená“ jen opakoval */}
              {!(flag && flag.kind === "pending") && <QuoteStateBadge quote={quote} />}
              {quote.accepted && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-xs font-semibold text-white">
                  <CheckCircle2 className="h-3 w-3" /> Přijatá — platí pro zakázku
                </span>
              )}
            </div>
            {flag && flag.kind === "pending" && <QuoteApprovalFlag flag={flag} wrap />}
            {!awaiting && stamp && <QuoteApprovalFlag flag={{ kind: "approved", quoteId: quote.id, number: quote.number, label: stamp }} />}
            {quote.title && <p className="truncate text-sm font-medium">{quote.title}</p>}
            <ActorStamp stamp={quote.stateStamp} verb={meta.label} short className="max-w-full" />
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
              {quote.approvedBy && !awaiting ? (
                <span className="flex flex-wrap items-center gap-x-1">
                  <PersonChip name={quote.approvedBy.name} className="text-xs" />
                  {quote.approvedAt && <span className="text-muted-foreground">{longDate(quote.approvedAt)}</span>}
                </span>
              ) : returned ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-1.5 py-px font-medium text-rose-900 dark:bg-rose-500/15 dark:text-rose-200">
                  vráceno autorovi k přepracování
                </span>
              ) : awaiting ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-px font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
                  {approver ? "čeká na tvé schválení" : "čeká na schválení super admina"}
                </span>
              ) : (
                <span className="text-muted-foreground">{quote.sentAt ? "bez schválení" : "nevyžaduje se"}</span>
              )}
            </dd>
          </div>
        </dl>

        {returned && (
          // #25: super admin vrátil nabídku autorovi — důvod, kdo a kdy
          <div role="note" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
            <Undo2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p className="min-w-0 whitespace-pre-wrap break-words">
              <strong className="font-semibold">{quote.returnNote ? "Vráceno k přepracování:" : "Vráceno k přepracování"}</strong>
              {quote.returnNote ? ` ${quote.returnNote}` : ""}
              {returnedSuffix(quote.returnedBy?.name ?? null, quote.returnedAt ?? null) && (
                <span className="text-rose-800/80 dark:text-rose-200/80"> {returnedSuffix(quote.returnedBy?.name ?? null, quote.returnedAt ?? null)}</span>
              )}
            </p>
          </div>
        )}

        {(quote.sentAt || quote.feedback || quote.rejectedReason || quote.lostReason) && (
          <div className="space-y-1 text-xs">
            {quote.sentAt && (
              <p className="text-muted-foreground">
                Odesláno {longDate(quote.sentAt)}
                {quote.sentBy && <> · {quote.sentBy.name}</>}
                {quote.sentVia && quote.sentVia !== "rucne" ? ` · ${VIA_META[quote.sentVia]?.label ?? quote.sentVia}` : quote.sentVia === "rucne" ? " · jinak než e-mailem" : ""}
              </p>
            )}
            {shown === "pripominky" && quote.feedback && (
              <p className="whitespace-pre-wrap rounded-lg bg-rose-50 px-2.5 py-1.5 text-rose-900 dark:bg-rose-500/10 dark:text-rose-100">
                <MessageSquareWarning className="mr-1 inline h-3.5 w-3.5" aria-hidden />{quote.feedback}
              </p>
            )}
            {shown === "zamitnuta" && (quote.lostReason || quote.rejectedReason) && (
              <p className="text-muted-foreground">
                Důvod: {quote.lostReason ? lostReasonLabel(quote.lostReason) : ""}{quote.rejectedReason ? `${quote.lostReason ? " — " : ""}${quote.rejectedReason}` : ""}
              </p>
            )}
          </div>
        )}

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
            <Button
              size="sm"
              variant="success"
              disabled={Boolean(busy)}
              onClick={() => void run(
                "approve",
                () => setQuoteState(quote.id, "schvalena", { expectedUpdatedAt: quote.updatedAt ?? null }),
                approvedToast(quote.number, quote.createdBy?.name ?? null, { authorId: quote.createdBy?.id ?? null, userId: flow?.ctx.userId ?? null }),
              )}
            >
              {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Schválit
            </Button>
          )}
          {has("approve") && flow && quote.total !== null && (
            // #25: rovnou schválit, vystavit PDF a odeslat (dialog s návrhem e-mailu)
            <Button size="sm" variant="send" disabled={Boolean(busy)} onClick={() => flow.run("quote.approveSend", { quoteId: quote.id })}>
              <Send className="h-4 w-4" /> Schválit a odeslat
            </Button>
          )}
          {has("returnToAuthor") && (
            <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => runFlow("returnToAuthor")}>
              <Undo2 className="h-4 w-4 text-rose-600" /> Vrátit k přepracování…
            </Button>
          )}
          {awaiting && !has("send") && (
            // #25: neschválenou nabídku nejde odeslat — zamčené tlačítko s vysvětlením (i na dotyku)
            <span className="inline-flex" title={sendLockText}>
              <Button size="sm" variant="outline" disabled aria-describedby={`send-lock-${quote.id}`}>
                <Lock className="h-4 w-4" /> Odeslat zákazníkovi
              </Button>
            </span>
          )}
          {has("requestApproval") && !has("send") && (
            <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run("requestApproval", () => setQuoteState(quote.id, "ke_schvaleni"), `Nabídka ${quote.number} předána ke schválení.`)}>
              {busy === "requestApproval" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldQuestion className="h-4 w-4 text-violet-600" />} Předat ke schválení
            </Button>
          )}
          {has("send") && (
            <Button size="sm" variant="send" disabled={Boolean(busy)} onClick={() => onDialog({ kind: "send", quote })}>
              <Send className="h-4 w-4" /> {quote.sentAt ? "Odeslat znovu" : "Odeslat zákazníkovi"}
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
        {awaiting && !has("send") ? (
          <p id={`send-lock-${quote.id}`} className="flex items-center gap-1 text-[11px] font-medium text-amber-800 dark:text-amber-300">
            <Lock className="h-3 w-3 shrink-0" aria-hidden /> {sendLockText}
          </p>
        ) : !quote.archived && shown !== "prijata" && shown !== "zamitnuta" && (
          <p className="text-[11px] text-muted-foreground">{meta.description}</p>
        )}
      </div>
    </article>
  );
}

/** Záložka Nabídky — nejnovější nahoře, starší verze schované v archivu. */
export function QuotesTab({ job }: { job: JobDetail }) {
  const { notify, refresh } = useJobDetail();
  const flow = useFlowActions();
  const [dialog, setDialog] = React.useState<Dialogs>({ kind: "none" });
  // „Vytvořit nabídku" z hlavičky karty → rovnou editor
  const signal = flow?.newQuoteSignal ?? 0;
  const [seenSignal, setSeenSignal] = React.useState(signal);
  if (signal !== seenSignal) {
    setSeenSignal(signal);
    setDialog({ kind: "editor", initial: quoteFormFromJob(job) });
  }
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
            const res = await setQuoteState(dialog.quote.id, "prijata");
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
