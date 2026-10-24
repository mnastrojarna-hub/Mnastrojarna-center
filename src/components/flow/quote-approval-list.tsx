"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Loader2, Send, ShieldAlert, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToastProvider, useNotify } from "@/components/jobs/detail/toast";
import { setQuoteState } from "@/app/actions/flow-status";
import type { PendingQuoteApproval } from "@/lib/data/queries";
import { cn, relativeTime } from "@/lib/utils";
import { QuoteReturnDialog } from "./quote-return-dialog";
import { QuoteApproveSendDialog } from "./quote-approve-send-dialog";
import { approvedToast } from "./quote-approval-copy";

function money(value: number | null, currency: string): string | null {
  if (value === null || value === undefined) return null;
  try {
    return new Intl.NumberFormat("cs-CZ", { style: "currency", currency: currency || "CZK", maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${Math.round(value)} ${currency}`;
  }
}

/**
 * Fronta super admina „Nabídky ke schválení“ (#25 — AI přehled a /quotes): jedním klikem „Schválit“
 * (optimistický zámek updated_at — mezitím upravenou nabídku server odmítne), „Vrátit…“ s důvodem
 * a „Otevřít“ (karta zakázky, záložka Nabídky). Nabídka bez ceny schválit nejde („bez ceny“).
 */
export function QuoteApprovalList({ items, className, stacked }: {
  items: PendingQuoteApproval[];
  className?: string;
  /** Tlačítka vždy pod textem (úzký sloupec AI přehledu). */
  stacked?: boolean;
}) {
  return (
    <ToastProvider>
      <List items={items} className={className} stacked={stacked} />
    </ToastProvider>
  );
}

function List({ items, className, stacked }: { items: PendingQuoteApproval[]; className?: string; stacked?: boolean }) {
  const router = useRouter();
  const notify = useNotify();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string[]>([]);
  const [returning, setReturning] = React.useState<PendingQuoteApproval | null>(null);
  const [sending, setSending] = React.useState<PendingQuoteApproval | null>(null);
  const shown = items.filter((i) => !done.includes(i.quoteId));

  async function approve(p: PendingQuoteApproval) {
    if (busy) return;
    setBusy(p.quoteId);
    try {
      const res = await setQuoteState(p.quoteId, "schvalena", { expectedUpdatedAt: p.updatedAt });
      if (!res.ok) {
        notify("error", res.error ?? "Nabídku se nepodařilo schválit.");
        router.refresh();
        return;
      }
      setDone((d) => [...d, p.quoteId]);
      notify("success", approvedToast(p.number, p.authorName));
      router.refresh();
    } catch {
      notify("error", "Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  }

  if (!shown.length) {
    return <p className={cn("rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground", className)}>Žádná nabídka nečeká na schválení.</p>;
  }

  return (
    <>
      <ul className={cn("divide-y overflow-hidden rounded-xl border bg-card shadow-sm", className)} aria-label="Nabídky ke schválení">
        {shown.map((p) => {
          const total = money(p.total, p.currency);
          const href = p.jobId ? `/orders/${p.jobId}?tab=nabidky` : "/quotes";
          return (
            <li key={p.quoteId} className={cn("flex flex-col gap-2 p-3", !stacked && "lg:flex-row lg:items-center lg:gap-3")} data-pending-quote={p.quoteId}>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-sm font-bold tracking-tight">{p.number ?? "Nabídka"}</span>
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-400 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-400/50"
                    title="Čeká na schválení super admina — do té doby ji nejde odeslat zákazníkovi."
                  >
                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Neschválená
                  </span>
                  {p.jobNumber && <span className="font-mono text-xs text-muted-foreground">{p.jobNumber}</span>}
                </div>
                {/* zákazník · zakázka smí být useknuté (celé v title), autor ne */}
                <p className="min-w-0 truncate text-sm" title={[p.customerName, p.jobTitle].filter(Boolean).join(" · ") || undefined}>
                  <span className="font-medium">{p.customerName ?? "Bez zákazníka"}</span>
                  {p.jobTitle && <span className="text-muted-foreground"> · {p.jobTitle}</span>}
                </p>
                <p className="break-words text-xs text-muted-foreground">připravil(a) <span className="font-medium text-foreground/80">{p.authorName ?? "—"}</span></p>
                <p className="text-xs text-muted-foreground">
                  {total ? <span className="font-semibold tabular-nums text-foreground">{total}</span> : null}
                  {/* důvod vypnutého „Schválit“ viditelně (title na dotyku nefunguje) */}
                  {p.unpriced && <span className="font-medium text-amber-700 dark:text-amber-400">{total ? " · " : ""}bez ceny — nejde schválit, chybí cena</span>}
                  {p.updatedAt && <span suppressHydrationWarning> · {relativeTime(p.updatedAt)}</span>}
                </p>
              </div>
              <div className={cn("flex flex-wrap items-center gap-2", !stacked && "lg:flex-nowrap")}>
                <Button
                  type="button"
                  size="sm"
                  variant="success"
                  className="min-h-11 flex-1 sm:min-h-9 sm:flex-none"
                  disabled={p.unpriced || Boolean(busy)}
                  title={p.unpriced ? "Nabídku s položkou bez ceny nejde schválit — autor musí doplnit ceny." : undefined}
                  onClick={() => void approve(p)}
                >
                  {busy === p.quoteId ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                  Schválit
                </Button>
                {p.jobId && !p.unpriced && (
                  <Button
                    type="button"
                    size="sm"
                    variant="send"
                    className="min-h-11 flex-1 sm:min-h-9 sm:flex-none"
                    disabled={Boolean(busy)}
                    onClick={() => setSending(p)}
                  >
                    <Send className="h-4 w-4" aria-hidden /> Schválit a odeslat
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-11 flex-1 sm:min-h-9 sm:flex-none"
                  disabled={Boolean(busy)}
                  onClick={() => setReturning(p)}
                >
                  <Undo2 className="h-4 w-4 text-rose-600 dark:text-rose-400" aria-hidden /> Vrátit…
                </Button>
                <Button asChild size="sm" variant="ghost" className="min-h-11 sm:min-h-9">
                  <Link href={href} aria-label={`Otevřít nabídku ${p.number ?? ""}`.trim()}>
                    Otevřít <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {sending?.jobId && (
        <QuoteApproveSendDialog
          open
          onOpenChange={(o) => !o && setSending(null)}
          jobId={sending.jobId}
          quoteId={sending.quoteId}
          number={sending.number}
          updatedAt={sending.updatedAt ?? null}
          onDone={(text) => {
            setDone((d) => [...d, sending.quoteId]);
            notify("success", text);
            router.refresh();
          }}
        />
      )}
      {returning && (
        <QuoteReturnDialog
          open
          onOpenChange={(o) => !o && setReturning(null)}
          quoteId={returning.quoteId}
          number={returning.number}
          author={returning.authorName}
          onDone={(text) => {
            setDone((d) => [...d, returning.quoteId]);
            notify("success", text);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
