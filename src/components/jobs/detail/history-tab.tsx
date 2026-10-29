"use client";

import * as React from "react";
import {
  Sparkles, PlusCircle, PencilLine, Paperclip, FileText, MessageCircle, Mail, Send, Loader2, ArrowRight, History,
  ListChecks, UserRound, StickyNote, ShieldCheck, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StageBadge } from "@/components/jobs/stage-badge";
import { addJobComment } from "@/app/actions/jobs";
import { StateChip } from "@/components/flow-status/state-chip";
import { stageMeta } from "@/lib/jobs/stages";
import { formatTimestamp } from "@/lib/jobs/field-labels";
import { VIA_META, actorKindIcon, actorName, lostReasonLabel, stateMeta, type FlowPhase } from "@/lib/jobs/flow-status";
import type { JobEvent } from "@/lib/jobs/types";
import { cn, relativeTime } from "@/lib/utils";
import { useJobDetail } from "./detail-context";
import {
  HISTORY_PHASES, autoLabel, dedupeEvents, eventChanges, eventPhase, eventStage, eventStamp, eventTone, isNoteEvent, type HistoryPhase,
} from "./detail-helpers";

const ICONS: Record<JobEvent["type"], LucideIcon> = {
  created: PlusCircle,
  stage: ArrowRight,
  status: ListChecks,
  field: PencilLine,
  file: Paperclip,
  quote: FileText,
  comment: MessageCircle,
  ai: Sparkles,
  email: Mail,
};

type Filter = "vse" | HistoryPhase;

const STATUS_PHASE: Record<string, FlowPhase> = { inquiry_status: "inquiry", order_status: "order" };

/** Dílčí stav „z → do" jako barevné chipy (poptávka, objednávka); jinak null. */
function statusChips(e: JobEvent): { phase: FlowPhase; from: string | null; to: string | null } | null {
  if (e.type !== "status") return null;
  const phase = typeof e.data?.field === "string" ? STATUS_PHASE[e.data.field] : undefined;
  if (!phase) return null;
  const from = typeof e.data?.from === "string" ? e.data.from : null;
  const to = typeof e.data?.to === "string" ? e.data.to : null;
  return stateMeta(phase, to) || stateMeta(phase, from) ? { phase, from, to } : null;
}

/** #24: záznam přesunutý při sloučení zakázek → číslo zakázky, odkud je („ze Z-2026-014"). */
export function mergedFromNumber(e: Pick<JobEvent, "data">): string | null {
  const m = e.data?.mergedFrom;
  if (!m || typeof m !== "object") return null;
  const n = (m as { number?: unknown }).number;
  return typeof n === "string" && n.trim() ? n.trim().slice(0, 40) : null;
}

/** Kdo: ikona druhu (člověk / AI / systém) + jméno (nikdy prázdné) + způsob. */
function EventAuthor({ e }: { e: JobEvent }) {
  const stamp = eventStamp(e);
  const KindIcon = actorKindIcon(stamp.kind);
  const via = stamp.via && stamp.via !== "rucne" ? VIA_META[stamp.via] : null;
  const ViaIcon = via?.icon;
  return (
    <span className="inline-flex min-w-0 items-center gap-1 font-medium text-foreground">
      <KindIcon className={cn("h-3.5 w-3.5 shrink-0", stamp.kind === "ai" ? "text-fuchsia-600 dark:text-fuchsia-400" : "text-muted-foreground")} aria-hidden />
      <span className="truncate">{actorName(stamp)}</span>
      {via && ViaIcon && (
        <span className="inline-flex shrink-0 items-center gap-0.5 font-normal text-muted-foreground" title={`Způsob: ${via.label}`}>
          <ViaIcon className="h-3 w-3" aria-hidden />
          <span className="sr-only">{via.label}</span>
        </span>
      )}
    </span>
  );
}

function EventItem({ e, last }: { e: JobEvent; last: boolean }) {
  const st = eventStage(e);
  const Icon = st ? stageMeta(st.to).icon : ICONS[e.type] ?? PencilLine;
  const changes = e.type === "field" ? eventChanges(e.data) : [];
  const aiCorrected = Array.isArray(e.data?.aiCorrected) && (e.data.aiCorrected as unknown[]).length > 0;
  const note = st && typeof e.data?.note === "string" ? e.data.note : null;
  const auto = autoLabel(e);
  const sc = statusChips(e);
  const mergedFrom = mergedFromNumber(e);
  const mailAction = e.type === "email" && typeof e.data?.action === "string" ? e.data.action : null;
  const fromMail = mailAction === "mail_change" || mailAction === "mail_info";
  const noteEvent = isNoteEvent(e) && changes.length > 0;

  return (
    <li className="relative flex gap-3 pb-5">
      {!last && <span aria-hidden className="absolute left-[15px] top-8 h-[calc(100%-1.75rem)] w-px bg-border" />}
      <span className={cn("relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-card", eventTone(e))}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <EventAuthor e={e} />
          <span title={formatTimestamp(e.createdAt) ?? undefined} suppressHydrationWarning>{relativeTime(e.createdAt)}</span>
          {auto && <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium">⚙ {auto}</span>}
          {mergedFrom && (
            <span className="whitespace-nowrap rounded-full bg-indigo-100 px-1.5 text-[10px] font-medium text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300" title="Záznam přešel při sloučení zakázek" data-testid="event-merged-from">
              ze {mergedFrom}
            </span>
          )}
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
        ) : fromMail ? (
          <MailEventBody e={e} />
        ) : noteEvent ? (
          <ul className="mt-1 space-y-1" data-testid="history-note">
            {changes.map((c, i) => (
              <li key={`${c.field}-${i}`} className="rounded-lg rounded-tl-none border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
                <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                  <StickyNote className="h-3 w-3" /> {c.label}
                </p>
                {c.sensitive ? <p className="italic text-muted-foreground">upraveno</p> : (
                  <>
                    <p className="whitespace-pre-wrap break-words">{c.to && c.to !== "—" ? c.to : <i className="text-muted-foreground">smazáno</i>}</p>
                    {c.from && c.from !== "—" && <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted-foreground line-through decoration-muted-foreground/40">{c.from}</p>}
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : st ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
            {st.from ? <StageBadge stage={st.from} size="xs" /> : null}
            {st.from && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
            <StageBadge stage={st.to} size="sm" />
            {note && <span className="text-muted-foreground">— {note}</span>}
            {typeof e.data?.reason === "string" && <span className="text-muted-foreground">· důvod: {lostReasonLabel(e.data.reason)}</span>}
          </div>
        ) : sc ? (
          <div className="mt-1 space-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              {sc.from && stateMeta(sc.phase, sc.from) && <StateChip meta={stateMeta(sc.phase, sc.from)!} size="xs" />}
              {sc.from && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
              {sc.to && stateMeta(sc.phase, sc.to) ? <StateChip meta={stateMeta(sc.phase, sc.to)!} size="xs" /> : <span className="text-xs text-muted-foreground">bez dokladu</span>}
            </div>
            <p className="break-words text-xs text-muted-foreground">{e.message}</p>
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

/** Událost „Z e-mailu od …: …" — technická / obchodní informace z pošty k zakázce (Pošta B). */
function MailEventBody({ e }: { e: JobEvent }) {
  const d = e.data ?? {};
  const applied = d.applied === true;
  // citace z e-mailu se do historie neukládá (vidí ji jen ten, kdo smí e-mail — záložka Komunikace)
  const drawing = d.action === "mail_change" ? (typeof d.drawingValue === "string" ? d.drawingValue : "neuvádí") : null;
  return (
    <div className="mt-1 space-y-1 rounded-lg rounded-tl-none border border-fuchsia-200 bg-fuchsia-50/60 px-3 py-2 text-sm dark:border-fuchsia-500/30 dark:bg-fuchsia-500/10" data-testid="history-mail-event">
      <p className="break-words">{e.message}</p>
      {d.action === "mail_change" && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {applied && <span className="inline-flex items-center gap-1 font-semibold text-fuchsia-800 dark:text-fuchsia-300"><ShieldCheck className="h-3 w-3" /> nadřazeno výkresu</span>}
          {drawing !== null && <span>výkres: <span className={cn(applied && "line-through")}>{drawing}</span></span>}
          {typeof d.valuePrev === "string" && d.valuePrev !== "—" && d.valuePrev !== drawing && <span>před změnou: {d.valuePrev}</span>}
        </p>
      )}
    </div>
  );
}

/** Záložka Historie — kdo co kdy změnil (vždy se jménem), filtr podle fáze a osoby + komentáře kolegů. */
export function HistoryTab({ events: raw }: { events: JobEvent[] }) {
  const { jobId, notify, refresh } = useJobDetail();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>("vse");
  const [person, setPerson] = React.useState("");
  const personId = React.useId();

  const events = React.useMemo(() => dedupeEvents(raw), [raw]);
  const phases = React.useMemo(() => {
    const set = new Set(events.map((e) => eventPhase(e)));
    return HISTORY_PHASES.filter((p) => set.has(p.key));
  }, [events]);
  const people = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const e of events) {
      const n = actorName(eventStamp(e));
      map.set(n, (map.get(n) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);
  const shown = events.filter((e) => (filter === "vse" || eventPhase(e) === filter) && (!person || actorName(eventStamp(e)) === person));

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

      {(phases.length > 1 || people.length > 1) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {phases.length > 1 && (
            <div role="group" aria-label="Fáze" className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-thin">
              {([{ key: "vse", label: `Vše (${events.length})` }, ...phases] as { key: Filter; label: string }[]).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={filter === t.key}
                  onClick={() => setFilter(t.key)}
                  className={cn(
                    "min-h-9 shrink-0 rounded-full px-3 text-xs font-medium transition sm:min-h-7",
                    filter === t.key ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-accent",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          {people.length > 1 && (
            <div className="relative shrink-0">
              <label htmlFor={personId} className="sr-only">Kdo</label>
              <UserRound className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <select
                id={personId}
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                className="h-9 w-full rounded-full border border-input bg-background pl-8 pr-3 text-xs sm:w-56"
              >
                <option value="">Kdokoli</option>
                {people.map(([name, n]) => <option key={name} value={name}>{name} ({n})</option>)}
              </select>
            </div>
          )}
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
