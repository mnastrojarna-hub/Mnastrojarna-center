"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive, BadgeCheck, Ban, CheckCircle2, Eye, FileText, Loader2, MoreHorizontal, Search, Send, ThumbsUp,
  CalendarX, UserRound, X, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/jobs/detail/confirm-dialog";
import { ToastProvider, useNotify } from "@/components/jobs/detail/toast";
import { StageDot } from "@/components/jobs/stage-badge";
import {
  acceptJobQuote, approveJobQuote, markJobQuoteSent, rejectJobQuote, setJobQuoteArchived,
} from "@/app/actions/jobs";
import { stageMeta } from "@/lib/jobs/stages";
import type { JobStage, QuoteStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { DocumentSendDialog } from "./document-send-dialog";
import { FlowEmpty } from "./flow-header";
import {
  czDay, filterQuotes, isQuoteExpired, quoteCounts, quoteStatusUi, QUOTE_STATUS_UI, type QuoteFilterKey,
} from "./flow-utils";

/** Nabídka pro přehled (jen čistá data ze serveru). */
export interface FlowQuote {
  id: string;
  number: string;
  revision: number;
  title: string | null;
  status: QuoteStatus;
  total: number | null;
  currency: string;
  validUntil: string | null;
  leadTimeDays: number | null;
  createdBy: { id: string; name: string } | null;
  approvedBy: { id: string; name: string } | null;
  approvedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  archived: boolean;
  accepted: boolean;
  aiGenerated: boolean;
  itemCount: number;
  job: { id: string; number: string; title: string; stage: JobStage } | null;
  customer: { id: string; name: string } | null;
}

const CHIPS: { key: QuoteFilterKey; label: string; tone: string; solid: string }[] = [
  { key: "vse", label: "Vše", tone: "bg-muted text-foreground", solid: "bg-foreground text-background" },
  { key: "ke_schvaleni", label: "Ke schválení", tone: QUOTE_STATUS_UI.ke_schvaleni.badge, solid: QUOTE_STATUS_UI.ke_schvaleni.solid },
  { key: "odeslano", label: "Odesláno", tone: QUOTE_STATUS_UI.odeslano.badge, solid: QUOTE_STATUS_UI.odeslano.solid },
  { key: "po_platnosti", label: "Po platnosti", tone: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300", solid: "bg-red-600 text-white" },
  { key: "prijato", label: "Přijato", tone: QUOTE_STATUS_UI.prijato.badge, solid: QUOTE_STATUS_UI.prijato.solid },
  { key: "zamitnuto", label: "Zamítnuto", tone: QUOTE_STATUS_UI.zamitnuto.badge, solid: QUOTE_STATUS_UI.zamitnuto.solid },
  { key: "navrh_ai", label: "Návrh AI", tone: QUOTE_STATUS_UI.navrh_ai.badge, solid: QUOTE_STATUS_UI.navrh_ai.solid },
];

function money(value: number | null, currency: string): string {
  if (value === null || value === undefined) return "bez ceny";
  try {
    return new Intl.NumberFormat("cs-CZ", { style: "currency", currency: currency || "CZK", maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${Math.round(value)} ${currency}`;
  }
}

export function QuotesBoard(props: { quotes: FlowQuote[]; today: string }) {
  return (
    <ToastProvider>
      <Board {...props} />
    </ToastProvider>
  );
}

function Board({ quotes, today }: { quotes: FlowQuote[]; today: string }) {
  const [status, setStatus] = React.useState<QuoteFilterKey>("vse");
  const [archived, setArchived] = React.useState(false);
  const [q, setQ] = React.useState("");

  const counts = React.useMemo(() => quoteCounts(quotes, archived, today), [quotes, archived, today]);
  const archivedCount = React.useMemo(() => quotes.filter((x) => x.archived).length, [quotes]);
  const shown = React.useMemo(() => filterQuotes(quotes, { status, archived, q }, today), [quotes, status, archived, q, today]);

  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-2xl border bg-card p-3 shadow-sm">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 scrollbar-thin">
          {CHIPS.filter((c) => c.key !== "navrh_ai" || counts.navrh_ai > 0).map((c) => {
            const on = status === c.key;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setStatus(c.key)}
                aria-pressed={on}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition active:scale-[0.98]",
                  on ? cn(c.solid, "shadow-sm") : cn(c.tone, "hover:brightness-95"),
                )}
              >
                {c.label}
                <span className={cn("rounded-full px-1.5 text-[10.5px] tabular-nums", on ? "bg-white/25" : "bg-background/60 dark:bg-black/20")}>
                  {counts[c.key] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Hledej číslo nabídky, zakázku, zákazníka…"
              className="h-10 pl-8"
              aria-label="Hledat v nabídkách"
            />
            {q && (
              <button type="button" aria-label="Vymazat hledání" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={archived} onCheckedChange={setArchived} aria-label="Zobrazit archivované" />
            Zobrazit archivované{archivedCount ? ` (${archivedCount})` : ""}
          </label>
        </div>
      </div>

      {shown.length === 0 ? (
        <FlowEmpty
          icon={FileText}
          iconClass="bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"
          title={quotes.length === 0 ? "Zatím žádné nabídky" : "Žádná nabídka neodpovídá filtru"}
        >
          {quotes.length === 0 ? (
            <>Nabídka vznikne v <Link href="/pricing" className="font-medium text-primary hover:underline">Nacenění</Link> tlačítkem „Vytvořit nabídku z ceny“, nebo v kartě zakázky v záložce Nabídky.</>
          ) : (
            <>Zkus jiný stav nahoře, vymaž hledání nebo zapni „Zobrazit archivované“.</>
          )}
        </FlowEmpty>
      ) : (
        <ul className="space-y-2">
          {shown.map((quote) => (
            <QuoteRow key={quote.id} quote={quote} today={today} />
          ))}
        </ul>
      )}
    </div>
  );
}

type Busy = null | "approve" | "markSent" | "archive";

function QuoteRow({ quote, today }: { quote: FlowQuote; today: string }) {
  const router = useRouter();
  const notify = useNotify();
  const [busy, setBusy] = React.useState<Busy>(null);
  const [dialog, setDialog] = React.useState<null | "send" | "accept" | "reject">(null);
  const [reason, setReason] = React.useState("");
  const ui = quoteStatusUi(quote.status);
  const expired = isQuoteExpired(quote, today);
  const open = quote.status === "navrh_ai" || quote.status === "ke_schvaleni";
  const canAccept = (quote.status === "odeslano" || quote.status === "ke_schvaleni") && !quote.accepted;
  const canReject = quote.status !== "prijato" && quote.status !== "zamitnuto";
  const canSend = !quote.archived && Boolean(quote.job) && (open || quote.status === "odeslano");
  const pdfHref = quote.job ? `/api/pdf/job/${quote.job.id}?type=nabidka&quoteId=${quote.id}` : null;
  const jobHref = quote.job ? `/orders/${quote.job.id}?tab=nabidky` : null;

  async function run(kind: Exclude<Busy, null>, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    if (busy) return;
    setBusy(kind);
    try {
      const res = await fn();
      if (!res.ok) notify("error", res.error ?? "Akce se nepovedla.");
      else {
        notify("success", done);
        router.refresh();
      }
    } catch {
      notify("error", "Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className={cn("relative overflow-hidden rounded-xl border bg-card p-3 pl-4 shadow-sm transition hover:shadow-md", quote.archived && "opacity-70")}>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", expired ? "bg-red-500" : ui.dot)} />
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-sm font-bold tracking-tight">{quote.number}</span>
            {quote.revision > 1 && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground">verze {quote.revision}</span>
            )}
            <span title={ui.hint} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", ui.badge)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", ui.dot)} /> {ui.label}
            </span>
            {quote.accepted && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-[10.5px] font-semibold text-white">
                <CheckCircle2 className="h-3 w-3" /> Přijatá nabídka zakázky
              </span>
            )}
            {expired && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10.5px] font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                <CalendarX className="h-3 w-3" /> Platnost vypršela {czDay(quote.validUntil, { short: true, today })}
              </span>
            )}
            {quote.archived && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                <Archive className="h-3 w-3" /> archiv
              </span>
            )}
          </div>
          {quote.job ? (
            <Link href={jobHref!} className="group flex min-w-0 items-center gap-1.5 text-sm hover:underline">
              <StageDot stage={quote.job.stage} />
              <span className="font-mono text-xs font-semibold">{quote.job.number}</span>
              <span className="truncate font-medium">{quote.title || quote.job.title}</span>
            </Link>
          ) : (
            <p className="truncate text-sm font-medium">{quote.title || "Nabídka bez zakázky"}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {quote.customer && <span className="font-medium text-foreground/80">{quote.customer.name}</span>}
            <span className="inline-flex items-center gap-1" title="Kdo nabídku zadal">
              <UserRound className="h-3.5 w-3.5" /> {quote.createdBy?.name ?? "—"}
            </span>
            {quote.approvedBy ? (
              <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400" title={quote.approvedAt ? `Schváleno ${czDay(quote.approvedAt)}` : "Schváleno"}>
                <BadgeCheck className="h-3.5 w-3.5" /> schválil {quote.approvedBy.name}
              </span>
            ) : open ? (
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <BadgeCheck className="h-3.5 w-3.5" /> zatím neschváleno
              </span>
            ) : null}
            {quote.sentAt && (
              <span className="inline-flex items-center gap-1">
                <Send className="h-3.5 w-3.5 text-violet-500" /> odesláno {czDay(quote.sentAt, { short: true, today })}
              </span>
            )}
            {quote.validUntil && (
              <span className={cn(expired && "font-semibold text-red-600 dark:text-red-400")}>
                platná do {czDay(quote.validUntil, { short: true, today })}
              </span>
            )}
            <span>vytvořeno {czDay(quote.createdAt, { short: true, today })}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:justify-end">
          <span className={cn("mr-auto text-base font-bold tabular-nums md:mr-2", quote.total === null && "text-sm font-medium text-amber-600 dark:text-amber-400")}>
            {money(quote.total, quote.currency)}
          </span>
          {!quote.archived && open && !quote.approvedBy && (
            <Button type="button" size="sm" variant="success" disabled={Boolean(busy)} onClick={() => void run("approve", () => approveJobQuote(quote.id), `Nabídka ${quote.number} schválena.`)}>
              {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} Schválit
            </Button>
          )}
          {canSend && quote.status !== "odeslano" && (
            <Button type="button" size="sm" variant="send" onClick={() => setDialog("send")}>
              <Send className="h-4 w-4" /> Odeslat
            </Button>
          )}
          {!quote.archived && quote.status === "odeslano" && canAccept && (
            <Button type="button" size="sm" variant="success" onClick={() => setDialog("accept")}>
              <ThumbsUp className="h-4 w-4" /> Přijata
            </Button>
          )}
          {pdfHref && (
            <Button asChild type="button" size="sm" variant="outline" title="Náhled PDF (nic se neukládá)">
              <a href={pdfHref} target="_blank" rel="noopener noreferrer">
                <Eye className="h-4 w-4 text-violet-600 dark:text-violet-400" /> PDF
              </a>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Další akce nabídky ${quote.number}`} disabled={Boolean(busy)}>
                {busy && busy !== "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Nabídka {quote.number}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {canSend && (
                <DropdownMenuItem onSelect={() => setDialog("send")}>
                  <Send className="text-red-500" /> {quote.status === "odeslano" ? "Odeslat znovu e-mailem" : "Odeslat e-mailem"}
                </DropdownMenuItem>
              )}
              {!quote.archived && open && (
                <DropdownMenuItem onSelect={() => void run("markSent", () => markJobQuoteSent(quote.id), `Nabídka ${quote.number} označena jako odeslaná.`)}>
                  <Send className="text-violet-500" /> Označit jako odeslanou (poslal jsem jinak)
                </DropdownMenuItem>
              )}
              {!quote.archived && canAccept && (
                <DropdownMenuItem onSelect={() => setDialog("accept")}>
                  <ThumbsUp className="text-green-600" /> Zákazník přijal
                </DropdownMenuItem>
              )}
              {!quote.archived && canReject && (
                <DropdownMenuItem onSelect={() => setDialog("reject")}>
                  <Ban className="text-red-500" /> Zákazník zamítl
                </DropdownMenuItem>
              )}
              {pdfHref && (
                <DropdownMenuItem asChild>
                  <a href={pdfHref} target="_blank" rel="noopener noreferrer"><Eye className="text-violet-500" /> Náhled PDF</a>
                </DropdownMenuItem>
              )}
              {jobHref && (
                <DropdownMenuItem asChild>
                  <Link href={jobHref}><ArrowRight /> Otevřít zakázku {quote.job?.number}</Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => void run(
                  "archive",
                  () => setJobQuoteArchived(quote.id, !quote.archived),
                  quote.archived ? `Nabídka ${quote.number} obnovena z archivu.` : `Nabídka ${quote.number} archivována.`,
                )}
              >
                <Archive /> {quote.archived ? "Obnovit z archivu" : "Archivovat"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {quote.job && (
        <DocumentSendDialog
          open={dialog === "send"}
          onOpenChange={(o) => setDialog(o ? "send" : null)}
          jobId={quote.job.id}
          kind="nabidka"
          quoteId={quote.id}
          title={`Odeslat nabídku ${quote.number} zákazníkovi`}
          onSent={({ to }) => {
            notify("success", `Nabídka ${quote.number} odeslána na ${to}.`);
            router.refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={dialog === "accept"}
        onOpenChange={(o) => setDialog(o ? "accept" : null)}
        icon={ThumbsUp}
        tone="bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
        title={`Zákazník přijal nabídku ${quote.number}?`}
        confirmLabel="Ano, přijata"
        confirmVariant="success"
        onConfirm={async () => {
          const res = await acceptJobQuote(quote.id);
          if (!res.ok) return res.error ?? "Nabídku se nepodařilo označit jako přijatou.";
          notify("success", `Nabídka ${quote.number} přijata — zakázka je v Objednávkách.`, quote.job ? { label: "Potvrdit objednávku", href: "/confirmations" } : undefined);
          router.refresh();
          return null;
        }}
      >
        Hodnota zakázky se nastaví podle nabídky a zakázka se posune do stavu{" "}
        <span className={cn("font-semibold", stageMeta("objednavka").text)}>Objednávka</span>. Pak stačí objednávku potvrdit.
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "reject"}
        onOpenChange={(o) => {
          setDialog(o ? "reject" : null);
          if (!o) setReason("");
        }}
        icon={Ban}
        tone="bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-300"
        title={`Zákazník zamítl nabídku ${quote.number}?`}
        confirmLabel="Označit jako zamítnutou"
        confirmVariant="destructive"
        onConfirm={async () => {
          const res = await rejectJobQuote(quote.id, reason.trim() || undefined);
          if (!res.ok) return res.error ?? "Nabídku se nepodařilo zamítnout.";
          notify("info", `Nabídka ${quote.number} zamítnuta. Zakázku můžeš v knize přepnout na „Nerealizováno“.`);
          setReason("");
          router.refresh();
          return null;
        }}
      >
        <span className="block pb-2">Proč? (nepovinné — pomůže příště s cenou)</span>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Drahé, dlouhý termín, objednali jinde…" />
      </ConfirmDialog>
    </li>
  );
}
