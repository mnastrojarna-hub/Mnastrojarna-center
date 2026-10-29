"use client";

import * as React from "react";
import { Flag, Paperclip, FolderOpen, Building2, MessageSquareText, Sparkles, Send } from "lucide-react";
import { PrioritySelect, type PriorityValue } from "@/components/priority";
import { CategoryPill } from "@/components/mail/category-editor";
import { AiConfidence } from "@/components/ai-confidence";
import { categoryStyle } from "@/lib/email/visibility";
import type { ThreadSummary } from "@/lib/email/mail-types";
import { cn, relativeTime } from "@/lib/utils";

/** Řádek vlákna: vlaječka a priorita jedním ťuknutím, odesílatel, předmět, náhled, poznámka kolegy. */
export function ThreadRow({ t, active, canAi, showMailbox, onOpen, onFlag, onPriority }: {
  t: ThreadSummary;
  active: boolean;
  canAi: boolean;
  showMailbox: boolean;
  onOpen: () => void;
  onFlag: () => void;
  onPriority: (v: PriorityValue | null) => void;
}) {
  const st = categoryStyle(t.category);
  const unread = t.unreadCount > 0 || Boolean(t.share?.unread);
  return (
    <div
      className={cn(
        "relative flex overflow-hidden rounded-xl border bg-card transition-all",
        active ? "border-blue-400 shadow-md ring-2 ring-blue-500/20" : "hover:shadow-sm",
        !unread && !active && "bg-card/60",
      )}
      data-testid="thread-row"
      data-thread={t.threadId}
      data-unread={unread ? "1" : "0"}
      data-flagged={t.flagged ? "1" : "0"}
      data-priority={t.priority}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", t.priority <= 1 ? "bg-red-600" : t.priority === 2 ? "bg-orange-500" : st.bar)} aria-hidden />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 p-3 pl-4 text-left" aria-current={active ? "true" : undefined}>
        <div className="flex items-center gap-2">
          {unread && <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background", st.dot)} aria-label="Nepřečtené" />}
          {t.direction === "out" && <Send className="h-3.5 w-3.5 shrink-0 text-cyan-600" aria-label="Odeslané" />}
          <span className={cn("truncate text-sm", unread ? "font-bold" : "font-medium text-foreground/80")}>{t.from}</span>
          {t.messageCount > 1 && <span className="shrink-0 rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground" aria-label={`${t.messageCount} zpráv`}>{t.messageCount}</span>}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground" suppressHydrationWarning>{relativeTime(t.lastAt)}</span>
        </div>
        <p className={cn("mt-1 truncate text-sm", unread ? "font-semibold" : "text-foreground/80")}>{t.subject || "(bez předmětu)"}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{t.preview}</p>
        {t.share && (
          <p className="mt-1 flex items-start gap-1 rounded-md bg-violet-50 px-2 py-1 text-xs text-violet-800 dark:bg-violet-500/10 dark:text-violet-200" data-testid="row-share">
            <MessageSquareText className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="min-w-0 truncate"><b>Od {t.share.by ?? "kolegy"}</b>{t.share.note ? `: ${t.share.note}` : ""}</span>
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <CategoryPill category={t.category} />
          {t.customer && (
            <span className="inline-flex max-w-[12rem] items-center gap-1 truncate rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-800 dark:bg-green-500/10 dark:text-green-300">
              <Building2 className="h-3 w-3 shrink-0" /> <span className="truncate">{t.customer}</span>
            </span>
          )}
          {t.jobNumber && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              <FolderOpen className="h-3 w-3" /> {t.jobNumber}
            </span>
          )}
          {t.hasAttachments && <Paperclip className="h-3.5 w-3.5 text-muted-foreground" aria-label="Přílohy" />}
          {showMailbox && t.mailboxEmail && <span className="truncate text-[11px] text-muted-foreground">→ {t.mailboxEmail}</span>}
          {canAi && t.hasDraft && (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px]"><Sparkles className="h-3 w-3" /> Návrh připraven</span>
          )}
          {canAi && t.aiConfidence > 0 && <AiConfidence value={t.aiConfidence} className="ml-auto" />}
        </div>
      </button>
      <div className="flex shrink-0 flex-col items-center gap-1 py-2 pr-2">
        <button
          type="button"
          onClick={onFlag}
          aria-pressed={t.flagged}
          aria-label={t.flagged ? "Zrušit vlaječku" : "Označit vlaječkou"}
          title={t.flagged ? "Zrušit vlaječku" : "Označit vlaječkou"}
          className={cn("flex h-9 w-9 items-center justify-center rounded-full transition-colors", t.flagged ? "text-red-600" : "text-muted-foreground/50 hover:bg-accent hover:text-foreground")}
          data-testid="row-flag"
        >
          <Flag className={cn("h-4 w-4", t.flagged && "fill-current")} />
        </button>
        <PrioritySelect value={t.priority} manual={t.priorityManual} onChange={onPriority} />
      </div>
    </div>
  );
}
