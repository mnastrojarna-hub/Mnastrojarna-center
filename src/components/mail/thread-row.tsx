"use client";

import * as React from "react";
import Link from "next/link";
import { Flag, Paperclip, FolderOpen, Building2, MessageSquareText, Sparkles, Send, Check, X, HelpCircle, Loader2 } from "lucide-react";
import { MAIL_ACTION_LABEL, ROW_ACTIONS, mailActionHref, mailActionPlan, type MailActionKey } from "@/lib/email/mail-actions";
import { PrioritySelect, type PriorityValue } from "@/components/priority";
import { CategoryPicker, CategoryPill } from "@/components/mail/category-editor";
import type { EmailCategory } from "@/lib/data/types";
import { AiConfidence } from "@/components/ai-confidence";
import { categoryStyle, neutralWhileAsking } from "@/lib/email/visibility";
import { LINK_SOURCE_LABEL } from "@/lib/email/job-match";
import type { ThreadSummary } from "@/lib/email/mail-types";
import { cn, relativeTime } from "@/lib/utils";

/** Pošta B: kategorie zprávy, která čeká na otázku „Patří k …?" — neutrální, dokud člověk nerozhodne. */
export function AskingCategoryPill({ className }: { className?: string }) {
  const st = categoryStyle("K zakázce");
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11px] font-medium", st.chip, className)}
      title="Ke které zakázce zpráva patří, rozhodne odpověď na otázku"
      data-testid="category-asking"
    >
      <HelpCircle className="h-3 w-3" />
      K zakázce?
    </span>
  );
}

/**
 * Řádek vlákna: vlaječka a priorita jedním ťuknutím, odesílatel, předmět, náhled, poznámka kolegy,
 * štítek kategorie (s `onCategory` jde opravit ťuknutím — přijatá i odeslaná zpráva řádku).
 *
 * `compact` (Pošta na počítači, výchozí — majitel 3. 11.: „vidím jen 2–3 maily"): od 1024 px dvouřádkový
 * řádek jako v Outlooku — 1. řádek odesílatel · čas · vlaječka, 2. řádek předmět — náhled · štítky ·
 * priorita; hlavní akce (Vytvořit nabídku …) až po najetí myší (otevřené vlákno ji má v detailu). Jedno HTML pro
 * mobil i počítač (třídy lg:), takže mobil zůstává beze změny a nic neposkočí po načtení.
 */
export function ThreadRow({ t, active, canAi, showMailbox, onOpen, onFlag, onPriority, hideJob, onSuggestion, suggestionBusy, onCategory, onError, onAction, actionBusy, compact = false }: {
  t: ThreadSummary;
  active: boolean;
  canAi: boolean;
  showMailbox: boolean;
  onOpen: () => void;
  onFlag: () => void;
  onPriority: (v: PriorityValue | null) => void;
  /** Komunikace zakázky: chip zakázky je zbytečný. */
  hideJob?: boolean;
  /** Pošta B: odpověď na návrh „Patří k Z-…?" jedním ťuknutím. */
  onSuggestion?: (accept: boolean) => void;
  suggestionBusy?: boolean;
  /** Oprava kategorie zprávy řádku (t.emailId) — nová kategorie hned, při chybě zpět. */
  onCategory?: (c: EmailCategory) => void;
  onError?: (text: string) => void;
  /** Pošta E: hlavní akce zprávy přímo z řádku (Vytvořit nabídku, Zpracovat objednávku, Zapsat fakturu …). */
  onAction?: (key: MailActionKey) => void;
  actionBusy?: MailActionKey | null;
  /** Hustý seznam na počítači (≥ 1024 px); mobil beze změny. */
  compact?: boolean;
}) {
  // zpráva řádku čeká na otázku „Patří k …?" → do rozhodnutí neutrální „K zakázce?" (ne kategorie z pravidel)
  const asking = neutralWhileAsking(t.category, Boolean(t.suggestion?.forMessage && (!t.suggestion.emailId || t.suggestion.emailId === t.emailId)));
  const plan = mailActionPlan({ category: asking ? "K zakázce" : t.category, direction: t.direction, jobId: t.jobId });
  const rowAction = onAction && plan.main && ROW_ACTIONS.includes(plan.main) && !(t.suggestion && !t.jobId) ? plan.main : null;
  const rowHref = rowAction ? mailActionHref(rowAction, t.jobId) : null;
  const st = categoryStyle(asking ? "K zakázce" : t.category);
  const unread = t.unreadCount > 0 || Boolean(t.share?.unread);
  /** Třídy jen pro hustý řádek (od lg). */
  const c = (cls: string) => (compact ? cls : "");
  const time = relativeTime(t.lastAt);
  return (
    <div
      className={cn(
        "group relative flex overflow-hidden rounded-xl border bg-card transition-all",
        active ? "border-blue-400 shadow-md ring-2 ring-blue-500/20" : "hover:shadow-sm",
        !unread && !active && "bg-card/60",
        compact && "thread-row-compact lg:grid lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:grid-rows-[auto_auto] lg:rounded-none lg:border-x-0 lg:border-t-0 lg:hover:shadow-none",
        compact && (active ? "lg:bg-blue-50 lg:shadow-none lg:ring-0 lg:dark:bg-blue-500/15" : "lg:hover:bg-accent/60"),
      )}
      data-testid="thread-row"
      data-thread={t.threadId}
      data-unread={unread ? "1" : "0"}
      data-flagged={t.flagged ? "1" : "0"}
      data-priority={t.priority}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", t.priority <= 1 ? "bg-red-600" : t.priority === 2 ? "bg-orange-500" : st.bar)} aria-hidden />
      <div className={cn("min-w-0 flex-1", c("lg:contents"))}>
        <button
          type="button" onClick={onOpen}
          className={cn("block w-full min-w-0 p-3 pb-2 pl-4 text-left", c("lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:py-1 lg:pl-3 lg:pr-2"))}
          aria-current={active ? "true" : undefined}
        >
          <div className={cn("flex items-center gap-2", c("lg:gap-1.5"))}>
            {unread && <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background", st.dot, c("lg:h-2 lg:w-2 lg:ring-0"))} aria-label="Nepřečtené" />}
            {t.direction === "out" && <Send className={cn("h-3.5 w-3.5 shrink-0 text-cyan-600", c("lg:h-3 lg:w-3"))} aria-label="Odeslané" />}
            <span className={cn("truncate text-sm", unread ? "font-bold" : "font-medium text-foreground/80", c("lg:text-[13px] lg:leading-[18px]"))}>{t.from}</span>
            {t.messageCount > 1 && <span className={cn("shrink-0 rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground", c("lg:text-[10px] lg:leading-4"))} aria-label={`${t.messageCount} zpráv`}>{t.messageCount}</span>}
            <span className={cn("ml-auto shrink-0 text-xs text-muted-foreground", c("lg:hidden"))} suppressHydrationWarning>{time}</span>
          </div>
          <p className={cn("mt-1 truncate text-sm", unread ? "font-semibold" : "text-foreground/80", c("lg:mt-0 lg:text-[13px] lg:leading-[18px]"))}>
            {t.subject || "(bez předmětu)"}
            {compact && t.preview && <span className="hidden font-normal text-muted-foreground lg:inline"> — {t.preview}</span>}
          </p>
          <p className={cn("mt-0.5 truncate text-xs text-muted-foreground", c("lg:hidden"))}>{t.preview}</p>
          {t.suggestion && (!t.jobNumber || t.suggestion.forMessage) && (
            <p className={cn("mt-1 flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-amber-500/10 dark:text-amber-200", c("lg:mt-0.5 lg:py-0.5 lg:text-[11px]"))} data-testid="row-suggestion">
              <HelpCircle className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {t.suggestion.forMessage ? `Zpráva jmenuje ${t.suggestion.jobNumber} — patří k ní?` : `Patří k ${t.suggestion.jobNumber}?`}
                {t.suggestion.jobTitle ? ` ${t.suggestion.jobTitle}` : ""}
              </span>
            </p>
          )}
          {t.share && (
            <p className={cn("mt-1 flex items-start gap-1 rounded-md bg-violet-50 px-2 py-1 text-xs text-violet-800 dark:bg-violet-500/10 dark:text-violet-200", c("lg:mt-0.5 lg:py-0.5 lg:text-[11px]"))} data-testid="row-share">
              <MessageSquareText className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="min-w-0 truncate"><b>Od {t.share.by ?? "kolegy"}</b>{t.share.note ? `: ${t.share.note}` : ""}</span>
            </p>
          )}
        </button>
        {/* hustý řádek: čas vpravo nahoře (mimo tlačítko řádku — vedle vlaječky) */}
        {compact && (
          <span className="hidden self-center whitespace-nowrap px-1 text-right text-[11px] tabular-nums text-muted-foreground lg:col-start-2 lg:row-start-1 lg:block" suppressHydrationWarning data-testid="row-time">
            {time}
          </span>
        )}
        {/* štítky mimo tlačítko řádku (štítek kategorie je samostatné tlačítko — oprava jedním ťuknutím) */}
        <div
          className={cn(
            "flex flex-wrap items-center gap-1.5 px-3 pb-3 pl-4",
            c("lg:col-start-2 lg:row-start-2 lg:flex-nowrap lg:justify-end lg:gap-1 lg:self-center lg:px-1 lg:pb-0 lg:pl-1"),
          )}
          data-testid="row-chips"
        >
          {asking
            ? <AskingCategoryPill className={c("lg:py-0 lg:text-[10px] lg:leading-4")} />
            : onCategory
              ? <CategoryPicker emailId={t.emailId} category={t.category} direction={t.direction} onChange={onCategory} onError={onError} className={c("lg:min-h-0 lg:py-0 lg:text-[10px] lg:leading-4")} labelClassName={c("thread-cat-label")} />
              : <CategoryPill category={t.category} className={c("lg:py-0 lg:text-[10px] lg:leading-4")} labelClassName={c("thread-cat-label")} />}
          {t.customer && (
            <span className={cn("inline-flex max-w-[12rem] items-center gap-1 truncate rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-800 dark:bg-green-500/10 dark:text-green-300", c("lg:hidden"))}>
              <Building2 className="h-3 w-3 shrink-0" /> <span className="truncate">{t.customer}</span>
            </span>
          )}
          {t.jobNumber && !hideJob && (
            <span
              className={cn("inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary", c("lg:whitespace-nowrap lg:py-0 lg:text-[10px] lg:leading-4"))}
              title={t.jobLinkSource ? `Přiřazeno: ${LINK_SOURCE_LABEL[t.jobLinkSource] ?? t.jobLinkSource}${t.jobLinkActor === "ai" ? " (automaticky)" : ""}` : undefined}
              data-testid="row-job-chip"
            >
              <FolderOpen className="h-3 w-3" /> {t.jobNumber}
              {t.jobLinkActor === "ai" && <Sparkles className="h-2.5 w-2.5" aria-label="přiřadila AI" />}
            </span>
          )}
          {t.hasAttachments && <Paperclip className="h-3.5 w-3.5 text-muted-foreground" aria-label="Přílohy" />}
          {showMailbox && t.mailboxEmail && <span className={cn("truncate text-[11px] text-muted-foreground", c("lg:hidden"))}>→ {t.mailboxEmail}</span>}
          {canAi && t.hasDraft && (
            <span className={cn("inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px]", c("lg:px-1 lg:py-0.5"))} title="Návrh odpovědi připraven">
              <Sparkles className="h-3 w-3" /> <span className={c("lg:hidden")}>Návrh připraven</span>
            </span>
          )}
          {canAi && t.aiConfidence > 0 && <AiConfidence value={t.aiConfidence} className={cn("ml-auto", c("lg:hidden"))} />}
          {rowAction && (rowHref ? (
            <Link
              href={rowHref} className={cn("ml-auto inline-flex min-h-7 items-center gap-1 rounded-full bg-emerald-600 px-2.5 text-[11px] font-semibold text-white hover:bg-emerald-700", compactAction(compact, false))}
              data-testid="row-action" data-action={rowAction}
            >
              {MAIL_ACTION_LABEL[rowAction]}
            </Link>
          ) : (
            <button
              type="button" onClick={() => onAction?.(rowAction)} disabled={Boolean(actionBusy)}
              className={cn("ml-auto inline-flex min-h-7 items-center gap-1 rounded-full bg-emerald-600 px-2.5 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60", compactAction(compact, Boolean(actionBusy)))}
              data-testid="row-action" data-action={rowAction}
            >
              {actionBusy === rowAction && <Loader2 className="h-3 w-3 animate-spin" />}
              {MAIL_ACTION_LABEL[rowAction]}
            </button>
          ))}
        </div>
      </div>
      {t.suggestion && (!t.jobNumber || t.suggestion.forMessage) && onSuggestion && (
        <div className={cn("flex shrink-0 flex-col justify-center gap-1 py-2", c("lg:col-start-4 lg:row-span-2 lg:row-start-1 lg:gap-0.5 lg:py-1 lg:pr-1"))}>
          <button
            type="button" onClick={() => onSuggestion(true)} disabled={suggestionBusy}
            className={cn("flex h-9 items-center gap-1 rounded-full bg-emerald-600 px-2.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50", c("lg:h-6 lg:px-2 lg:text-[11px]"))}
            aria-label={`Ano, patří k ${t.suggestion.jobNumber}`} title={`Ano, patří k ${t.suggestion.jobNumber}`} data-testid="row-suggestion-yes"
          >
            <Check className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Ano</span>
          </button>
          <button
            type="button" onClick={() => onSuggestion(false)} disabled={suggestionBusy}
            className={cn("flex h-9 items-center justify-center gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50", c("lg:h-6 lg:px-2 lg:text-[11px]"))}
            aria-label="Ne, nepatří" title="Ne, nepatří" data-testid="row-suggestion-no"
          >
            <X className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Ne</span>
          </button>
        </div>
      )}
      <div className={cn("flex shrink-0 flex-col items-center gap-1 py-2 pr-2", c("lg:contents"))}>
        <button
          type="button"
          onClick={onFlag}
          aria-pressed={t.flagged}
          aria-label={t.flagged ? "Zrušit vlaječku" : "Označit vlaječkou"}
          title={t.flagged ? "Zrušit vlaječku" : "Označit vlaječkou"}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full transition-colors", t.flagged ? "text-red-600" : "text-muted-foreground/50 hover:bg-accent hover:text-foreground",
            // hustý řádek: vlaječka jen u označených, jinak až po najetí myší (místo pro text)
            c("lg:col-start-3 lg:row-start-1 lg:mr-1 lg:mt-0.5 lg:h-[18px] lg:w-6 lg:self-center"),
            compact && !t.flagged && "lg:opacity-0 lg:focus-visible:opacity-100 lg:group-hover:opacity-100",
          )}
          data-testid="row-flag"
        >
          <Flag className={cn("h-4 w-4", t.flagged && "fill-current", c("lg:h-3.5 lg:w-3.5"))} />
        </button>
        <PrioritySelect
          value={t.priority} manual={t.priorityManual} onChange={onPriority}
          className={c("lg:col-start-3 lg:row-start-2 lg:mr-1 lg:min-h-0 lg:self-center lg:justify-self-center lg:[&>span]:px-1.5 lg:[&>span]:py-0 lg:[&>span]:text-[10px] lg:[&>span]:leading-4")}
        />
      </div>
    </div>
  );
}

/**
 * Hlavní akce v hustém řádku (počítač): plovoucí tlačítko vpravo — jen po najetí myší / fokusu v řádku
 * nebo když běží (jinak by zakrývalo předmět; otevřené vlákno má stejnou akci v detailu).
 */
function compactAction(compact: boolean, shown: boolean): string {
  if (!compact) return "";
  return cn(
    "lg:absolute lg:right-14 lg:top-1/2 lg:z-10 lg:min-h-6 lg:-translate-y-1/2 lg:shadow-md lg:ring-2 lg:ring-background",
    shown ? "lg:inline-flex" : "lg:hidden lg:group-focus-within:inline-flex lg:group-hover:inline-flex",
  );
}
