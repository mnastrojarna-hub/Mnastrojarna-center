"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ArrowRight, Eye, FileText, Search, Undo2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ToastProvider, useNotify } from "@/components/jobs/detail/toast";
import { StageDot } from "@/components/jobs/stage-badge";
import { StateChip } from "@/components/flow-status/state-chip";
import { ActorStamp } from "@/components/flow-status/actor-stamp";
import { CountChips, type CountChip } from "@/components/flow-status/count-chips";
import { setJobQuoteArchived } from "@/app/actions/jobs";
import {
  FLOW_PALETTE, OPEN_QUOTE, QUOTE_ORDER, QUOTE_STATES, VIA_META, approvalReasons, lostReasonLabel, type ChangeStamp, type QuoteDisplayState,
} from "@/lib/jobs/flow-status";
import type { JobStage } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { FlowEmpty } from "./flow-header";
import { FlowActionBar, FlowProposalChip } from "./flow-actions";
import { czDay, filterQuotes } from "./flow-utils";
import { STATE_PARAM, actionPalette, parseStateParam, stateParamValue, type FlowQuoteInfo } from "./flow-state";

/** Nabídka pro přehled (čistá data ze serveru) + podrobný stav, autoři a akce. */
export interface FlowQuote extends Omit<FlowQuoteInfo, "id"> {
  id: string;
  number: string;
  revision: number;
  title: string | null;
  total: number | null;
  currency: string;
  validUntil: string | null;
  leadTimeDays: number | null;
  createdAt: string;
  archived: boolean;
  aiGenerated: boolean;
  itemCount: number;
  createdBy: { id: string; name: string } | null;
  job: { id: string; number: string; title: string; stage: JobStage } | null;
  customer: { id: string; name: string } | null;
  /** Jediná otevřená nabídka zakázky (zamítnutí zakázku uzavře). */
  onlyOpen: boolean;
}

function money(value: number | null, currency: string): string {
  if (value === null || value === undefined) return "bez ceny";
  try {
    return new Intl.NumberFormat("cs-CZ", { style: "currency", currency: currency || "CZK", maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${Math.round(value)} ${currency}`;
  }
}

/** Počty chipů: z DB (flow_counts), bez nich z načtených nabídek. */
function chipsOf(quotes: FlowQuote[], counts: Record<string, number> | null): CountChip[] {
  const local: Record<string, number> = {};
  if (!counts) for (const q of filterQuotes(quotes, { states: QUOTE_ORDER, q: "" })) local[q.display] = (local[q.display] ?? 0) + 1;
  return QUOTE_ORDER.map((k) => ({
    key: k, phase: "quote", label: QUOTE_STATES[k].label, count: counts ? counts[`quote.${k}`] ?? 0 : local[k] ?? 0,
    palette: QUOTE_STATES[k].palette, open: OPEN_QUOTE.includes(k),
  }));
}

export function QuotesBoard(props: {
  quotes: FlowQuote[]; today: string; counts: Record<string, number> | null; initialStates?: string | null;
  /** Smí do Nacenění (#25 jen super admin) — odkazy a prázdný stav podle toho. */
  canPrice?: boolean;
  /** Schvaluje nabídky (super admin) — texty „čeká na tvé schválení“. */
  approver?: boolean;
}) {
  return (
    <ToastProvider>
      <Board {...props} />
    </ToastProvider>
  );
}

function Board({
  quotes, today, counts, initialStates, canPrice = false, approver = false,
}: {
  quotes: FlowQuote[];
  today: string;
  counts: Record<string, number> | null;
  initialStates?: string | null;
  canPrice?: boolean;
  approver?: boolean;
}) {
  const [states, setStates] = React.useState<string[]>(() => parseStateParam(initialStates, QUOTE_ORDER, OPEN_QUOTE));
  const [q, setQ] = React.useState("");
  const chips = React.useMemo(() => chipsOf(quotes, counts), [quotes, counts]);
  const shown = React.useMemo(() => filterQuotes(quotes, { states, q }), [quotes, states, q]);

  function change(keys: string[]) {
    const next = keys.length ? keys : [...OPEN_QUOTE];
    setStates(next);
    try {
      const url = new URL(window.location.href);
      const value = stateParamValue(next, OPEN_QUOTE);
      if (value) url.searchParams.set(STATE_PARAM, value);
      else url.searchParams.delete(STATE_PARAM);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search.replace(/%2C/g, ",")}`);
    } catch {
      // adresa se neaktualizuje — filtr funguje dál
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-2xl border bg-card p-3 shadow-sm">
        <CountChips chips={chips} selected={states} onChange={change} label="Stav nabídky" />
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Hledej číslo nabídky, zakázku, zákazníka…"
            className="h-11 pl-8 sm:h-10"
            aria-label="Hledat v nabídkách"
          />
          {q && (
            <button type="button" aria-label="Vymazat hledání" onClick={() => setQ("")} className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <FlowEmpty
          icon={FileText}
          iconClass="bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"
          title={quotes.length === 0 ? "Zatím žádné nabídky" : "Žádná nabídka neodpovídá filtru"}
        >
          {quotes.length === 0 ? (
            canPrice ? (
              <>Nabídka vznikne v <Link href="/pricing" className="font-medium text-primary hover:underline">Nacenění</Link> tlačítkem „Vytvořit nabídku z ceny“, nebo v kartě zakázky v záložce Nabídky.</>
            ) : (
              <>Nabídka vznikne v kartě zakázky v záložce Nabídky (tlačítko „Vytvořit nabídku“ u poptávky).</>
            )
          ) : (
            <>Zkus jiný stav nahoře (uzavřené jsou ve „Více“ za posledních 30 dní) nebo vymaž hledání.</>
          )}
        </FlowEmpty>
      ) : (
        <ul className="space-y-2">
          {shown.map((quote) => <QuoteRow key={quote.id} quote={quote} today={today} canPrice={canPrice} approver={approver} />)}
        </ul>
      )}
    </div>
  );
}

/** Proč nabídka čeká na schválení (#25): vrácená autorovi, kontrola AI, nebo ji připravil kolega. */
export function approvalHint(quote: Pick<FlowQuote, "facts" | "createdBy">): string | null {
  if (quote.facts.returnedAt) return "vráceno autorovi";
  const r = approvalReasons(quote.facts);
  if (r.ai) return "kontrola AI";
  if (r.author) return quote.createdBy?.name ? `připravil(a) ${quote.createdBy.name}` : "připravil kolega";
  return null;
}

function sentVerb(s: ChangeStamp): string {
  if (s.via === "email") return "Odesláno e-mailem";
  if (s.via === "foto") return "Odesláno (z fotky)";
  if (s.via === "rucne") return "Odesláno jinak";
  return s.via ? `Odesláno ${VIA_META[s.via]?.label ?? ""}`.trim() : "Odesláno";
}

/** „Zadáno · X“, „Schváleno · Y“, „Odesláno e-mailem · Z“, „Přijato · W“, „Zamítnuto — Cena · V“. */
function stampsOf(quote: FlowQuote): { verb: string; stamp: ChangeStamp }[] {
  const s = quote.stamps;
  const out: { verb: string; stamp: ChangeStamp | null }[] = [
    { verb: quote.aiGenerated ? "Připravila AI" : "Zadáno", stamp: s.created },
    { verb: "Předáno ke schválení", stamp: quote.facts.approvalRequestedAt ? s.approvalRequested : null },
    { verb: "Schváleno", stamp: s.approved },
    { verb: s.sent ? sentVerb(s.sent) : "Odesláno", stamp: s.sent },
    { verb: "Přijato", stamp: s.accepted },
    { verb: quote.lostReason ? `Zamítnuto — ${lostReasonLabel(quote.lostReason)}` : "Zamítnuto", stamp: s.rejected },
  ];
  return out.filter((x): x is { verb: string; stamp: ChangeStamp } => Boolean(x.stamp));
}

function QuoteRow({ quote, today, canPrice, approver }: { quote: FlowQuote; today: string; canPrice: boolean; approver: boolean }) {
  const router = useRouter();
  const notify = useNotify();
  const display: QuoteDisplayState = quote.display;
  const meta = QUOTE_STATES[display];
  const pdfHref = quote.job ? `/api/pdf/job/${quote.job.id}?type=nabidka&quoteId=${quote.id}` : null;
  const jobHref = quote.job ? `/orders/${quote.job.id}?tab=nabidky` : null;
  const awaiting = display === "ke_schvaleni";
  const stamps = stampsOf(quote);

  async function toggleArchive() {
    try {
      const res = await setJobQuoteArchived(quote.id, !quote.archived);
      if (!res.ok) return notify("error", res.error ?? "Akce se nepovedla.");
      notify("success", quote.archived ? `Nabídka ${quote.number} obnovena z archivu.` : `Nabídka ${quote.number} archivována.`);
      router.refresh();
    } catch {
      notify("error", "Spojení se nepovedlo — zkus to znovu.");
    }
  }

  return (
    <li
      className={cn("relative overflow-hidden rounded-xl border bg-card p-3 pl-4 shadow-sm transition hover:shadow-md", display === "archivovana" && "opacity-75")}
      data-quote-state={display}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", awaiting ? "bg-amber-500" : FLOW_PALETTE[meta.palette].dot)} />
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-sm font-bold tracking-tight">{quote.number}</span>
            {quote.revision > 1 && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground">verze {quote.revision}</span>
            )}
            <StateChip
              meta={meta}
              ai={quote.aiGenerated}
              hint={display === "vyprsela" && quote.validUntil ? `platila do ${czDay(quote.validUntil, { short: true, today })}`
                : display === "ke_schvaleni" ? approvalHint(quote) : null}
              data-flow-state={`quote.${display}`}
            />
          </div>
          {quote.proposal && quote.job && (
            <FlowProposalChip jobId={quote.job.id} proposal={quote.proposal.value} stamp={quote.proposal.stamp} canDecide={quote.proposal.canDecide} />
          )}
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
            {quote.validUntil && (
              <span className={cn(display === "vyprsela" && "font-semibold text-rose-700 dark:text-rose-300")}>
                platná do {czDay(quote.validUntil, { short: true, today })}
              </span>
            )}
            {quote.leadTimeDays !== null && <span>lhůta {quote.leadTimeDays} dní</span>}
            {quote.facts.sentAt && !quote.stamps.sent && <span>odesláno {czDay(quote.facts.sentAt.slice(0, 10), { short: true, today })}</span>}
            {awaiting && !quote.facts.returnedAt && (
              <span className="font-medium text-amber-800 dark:text-amber-300">
                {approver ? "čeká na tvé schválení — odeslat půjde po schválení" : "čeká na schválení super admina — odeslat ji zatím nejde"}
              </span>
            )}
          </div>
          {awaiting && quote.facts.returnedAt && (
            <p className="flex min-w-0 items-start gap-1.5 text-xs text-rose-800 dark:text-rose-200">
              <Undo2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">
                <span className="font-semibold">{quote.facts.returnNote ? "Vráceno k přepracování:" : "Vráceno k přepracování"}</span>
                {quote.facts.returnNote ? ` ${quote.facts.returnNote}` : ""}
              </span>
            </p>
          )}
          {stamps.length > 0 && (
            <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5">
              {stamps.map((x) => <ActorStamp key={x.verb} stamp={x.stamp} verb={x.verb} short />)}
            </div>
          )}
          {(quote.feedback || (display === "zamitnuta" && quote.rejectedReason)) && (
            <p className="line-clamp-2 text-xs text-foreground/80">
              <span className="font-medium">{quote.feedback ? "Připomínky:" : "Poznámka:"}</span> {quote.feedback ?? quote.rejectedReason}
              {quote.competitorPrice !== null && <> · konkurence {money(quote.competitorPrice, quote.currency)}</>}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:justify-end">
          <span className={cn("mr-auto text-base font-bold tabular-nums md:mr-2", quote.total === null && "text-sm font-medium text-amber-600 dark:text-amber-400")}>
            {money(quote.total, quote.currency)}
          </span>
          {pdfHref && (
            <Button asChild type="button" size="sm" variant="outline" className="min-h-11 sm:min-h-9" title="Náhled PDF (nic se neukládá)">
              <a href={pdfHref} target="_blank" rel="noopener noreferrer" aria-label={`PDF náhled ${quote.number}`}>
                <Eye className="h-4 w-4 text-violet-600 dark:text-violet-400" /> PDF
              </a>
            </Button>
          )}
          <FlowActionBar
            target={{
              jobId: quote.job?.id ?? null, jobNumber: quote.job?.number ?? quote.number, quote: quote.facts, today,
              onlyOpenQuote: quote.onlyOpen, quoteAuthor: quote.createdBy?.name ?? null,
            }}
            canPrice={canPrice}
            next={quote.next}
            menu={quote.menu}
            palette={quote.next ? actionPalette(quote.next.key) : undefined}
            menuLabel={`Další akce nabídky ${quote.number}`}
            className="w-full md:w-auto"
            extraMenu={[
              ...(jobHref ? [{ label: `Otevřít zakázku ${quote.job?.number ?? ""}`, icon: ArrowRight, href: jobHref }] : []),
              ...(pdfHref ? [{ label: "Náhled PDF", icon: Eye, href: pdfHref, external: true }] : []),
              { label: quote.archived ? "Obnovit z archivu" : "Archivovat", icon: quote.archived ? ArchiveRestore : Archive, onSelect: () => void toggleArchive() },
            ]}
          />
        </div>
      </div>
    </li>
  );
}
