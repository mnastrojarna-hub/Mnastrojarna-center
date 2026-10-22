"use client";

import * as React from "react";
import {
  Sparkles, PlusCircle, PencilLine, Paperclip, FileText, MessageCircle, Mail, Send, Loader2, ArrowRight, History,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StageBadge } from "@/components/jobs/stage-badge";
import { addJobComment } from "@/app/actions/jobs";
import { stageMeta } from "@/lib/jobs/stages";
import { formatTimestamp } from "@/lib/jobs/field-labels";
import type { JobEvent } from "@/lib/jobs/types";
import { cn, relativeTime } from "@/lib/utils";
import { useJobDetail } from "./detail-context";
import { PersonChip } from "./inline-field";
import { eventChanges, eventStage, eventTone, EVENT_TYPE_LABELS } from "./detail-helpers";

const ICONS: Record<JobEvent["type"], LucideIcon> = {
  created: PlusCircle,
  stage: ArrowRight,
  field: PencilLine,
  file: Paperclip,
  quote: FileText,
  comment: MessageCircle,
  ai: Sparkles,
  email: Mail,
};

type Filter = "vse" | JobEvent["type"];

function EventItem({ e, last }: { e: JobEvent; last: boolean }) {
  const st = eventStage(e);
  const Icon = st ? stageMeta(st.to).icon : ICONS[e.type] ?? PencilLine;
  const changes = e.type === "field" ? eventChanges(e.data) : [];
  const aiCorrected = Array.isArray(e.data?.aiCorrected) && (e.data.aiCorrected as unknown[]).length > 0;
  const note = st && typeof e.data?.note === "string" ? e.data.note : null;

  return (
    <li className="relative flex gap-3 pb-5">
      {!last && <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-1.75rem)] w-px bg-border" />}
      <span className={cn("relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-card", eventTone(e))}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {e.actor ? <PersonChip name={e.actor.name} className="text-xs font-medium text-foreground" /> : <span className="font-medium">Systém</span>}
          <span title={formatTimestamp(e.createdAt) ?? undefined} suppressHydrationWarning>{relativeTime(e.createdAt)}</span>
          {e.type === "ai" && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-fuchsia-100 px-1.5 text-[10px] font-medium text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300">
              <Sparkles className="h-2.5 w-2.5" /> AI
            </span>
          )}
          {aiCorrected && (
            <span className="rounded-full bg-fuchsia-100 px-1.5 text-[10px] font-medium text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300" title="Oprava údaje, který vyplnila AI — AI se z ní učí">
              oprava AI
            </span>
          )}
        </div>

        {e.type === "comment" ? (
          <div className="mt-1 whitespace-pre-wrap rounded-lg rounded-tl-none bg-blue-50 px-3 py-2 text-sm dark:bg-blue-500/10">{e.message}</div>
        ) : st ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
            {st.from ? <StageBadge stage={st.from} size="xs" /> : null}
            {st.from && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
            <StageBadge stage={st.to} size="sm" />
            {note && <span className="text-muted-foreground">— {note}</span>}
          </div>
        ) : changes.length > 0 ? (
          <div className="mt-1 text-sm">
            {changes.length > 1 && <p className="font-medium">{e.message}</p>}
            <ul className="mt-1 space-y-0.5 rounded-lg border bg-muted/20 px-2.5 py-1.5 text-xs">
              {changes.map((c, i) => (
                <li key={`${c.field}-${i}`} className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="text-muted-foreground">{c.label}:</span>
                  {c.sensitive ? (
                    <span className="italic text-muted-foreground">upraveno</span>
                  ) : (
                    <>
                      <span className="text-muted-foreground line-through decoration-muted-foreground/40">{c.from}</span>
                      <ArrowRight className="h-3 w-3 self-center text-muted-foreground" />
                      <span className="font-medium">{c.to}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-0.5 break-words text-sm">{e.message}</p>
        )}
      </div>
    </li>
  );
}

/** Záložka Historie — kdo co kdy změnil + komentáře kolegů. */
export function HistoryTab({ events }: { events: JobEvent[] }) {
  const { jobId, notify, refresh } = useJobDetail();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>("vse");

  const types = React.useMemo(() => {
    const set = new Set(events.map((e) => e.type));
    return (Object.keys(EVENT_TYPE_LABELS) as JobEvent["type"][]).filter((t) => set.has(t));
  }, [events]);
  const shown = filter === "vse" ? events : events.filter((e) => e.type === filter);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const res = await addJobComment(jobId, text);
      if (!res.ok) {
        notify("error", res.error ?? "Komentář se nepodařilo uložit.");
        return;
      }
      setText("");
      refresh();
    } catch {
      notify("error", "Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="rounded-xl border bg-card p-3 shadow-sm">
        <label htmlFor="job-comment" className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <MessageCircle className="h-3.5 w-3.5 text-blue-500" /> Napiš kolegům komentář
        </label>
        <Textarea
          id="job-comment"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="např. Dodavatel hlásí zpoždění materiálu o 5 dní."
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="hidden text-[11px] text-muted-foreground sm:inline">Ctrl + Enter odešle</span>
          <Button type="submit" size="sm" disabled={busy || !text.trim()} className="ml-auto">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Přidat komentář
          </Button>
        </div>
      </form>

      {types.length > 1 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-thin">
          {(["vse", ...types] as Filter[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilter(t)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition",
                filter === t ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-accent",
              )}
            >
              {t === "vse" ? `Vše (${events.length})` : EVENT_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          <History className="h-6 w-6" />
          Zatím tu nic není — každá změna zakázky se sem zapíše sama.
        </div>
      ) : (
        <ol className="rounded-xl border bg-card p-4 pb-0 shadow-sm">
          {shown.map((e, i) => (
            <EventItem key={e.id} e={e} last={i === shown.length - 1} />
          ))}
        </ol>
      )}
    </div>
  );
}
