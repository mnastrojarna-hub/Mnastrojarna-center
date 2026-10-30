"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft, Reply, ReplyAll, Forward, Share2, Flag, MailOpen, Scissors, Loader2, Paperclip, Sparkles,
  ChevronDown, ChevronRight, Building2, CheckCircle2, AlertTriangle, Send, MessageSquareText, MoreHorizontal, PenLine,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PrioritySelect, type PriorityValue } from "@/components/priority";
import { CategoryEditor, CategoryPicker, CategoryPill } from "@/components/mail/category-editor";
import { ShareDialog } from "@/components/mail/share-dialog";
import { JobLinkBar } from "@/components/mail/job-link-bar";
import type { ComposeRequest } from "@/components/mail/compose-dialog";
import { splitFromThreadAction, type OrderChoice } from "@/app/actions/mail-actions";
import { useMailActionRunner, type MailActionNotice } from "@/components/mail/mail-action-runner";
import type { MailActionKey } from "@/lib/email/mail-actions";
import { markThreadReadAction, openThreadAction, runAiOnThreadAction, setThreadFlagAction, setThreadPriorityAction } from "@/app/actions/mail-inbox";
import { sentCopyLabel } from "@/lib/email/mail-folders";
import type { ThreadDetail, ThreadMessage, ThreadSummary } from "@/lib/email/mail-types";
import { categoryStyle, neutralWhileAsking } from "@/lib/email/visibility";
import { AskingCategoryPill } from "@/components/mail/thread-row";
import type { EmailCategory } from "@/lib/data/types";
import { cn, formatDate } from "@/lib/utils";

function initials(name: string): string {
  const parts = name.split(/[\s.@_-]+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function timeOf(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatDate(d)} ${d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}`;
}

function fmtSize(n: number | null | undefined): string {
  if (!n) return "";
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`;
}

/** „2 zprávy ve vlákně" / „5 zpráv ve vlákně". */
export function messageCountLabel(n: number): string {
  return `${n} ${n === 1 ? "zpráva" : n >= 2 && n <= 4 ? "zprávy" : "zpráv"} ve vlákně`;
}

export interface ThreadPatch {
  flagged?: boolean;
  priority?: number;
  priorityManual?: boolean;
  unreadCount?: number;
  category?: EmailCategory;
  jobId?: string;
  jobNumber?: string;
  shareUnread?: boolean;
  /** Pošta B: vlákno odpojeno od zakázky / návrh vyřízen. */
  jobCleared?: boolean;
  suggestionDone?: boolean;
}

export function ThreadView({ summary, canAi, onBack, onPatch, onCompose, version, onSplit }: {
  summary: ThreadSummary;
  canAi: boolean;
  onBack: () => void;
  onPatch: (threadId: string, patch: ThreadPatch) => void;
  onCompose: (r: ComposeRequest) => void;
  /** Změna = načíst vlákno znovu (po odeslání, živá pošta). */
  version: number;
  /** Zpráva oddělena do vlastního vlákna (seznam se obnoví). */
  onSplit?: () => void;
}) {
  const [detail, setDetail] = React.useState<ThreadDetail | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<MailActionNotice | null>(null);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [flagged, setFlagged] = React.useState(summary.flagged);
  const [priority, setPriority] = React.useState({ value: summary.priority, manual: summary.priorityManual });
  const threadId = summary.threadId;

  React.useEffect(() => {
    setFlagged(summary.flagged);
    setPriority({ value: summary.priority, manual: summary.priorityManual });
  }, [summary.flagged, summary.priority, summary.priorityManual]);

  React.useEffect(() => {
    let alive = true;
    void openThreadAction(threadId).then((d) => {
      if (!alive) return;
      setDetail(d);
      if (d.ok && d.messages?.length) {
        setExpanded((prev) => (prev.size && version ? prev : new Set([d.messages![d.messages!.length - 1].id])));
        if (summary.unreadCount || summary.share?.unread) onPatch(threadId, { unreadCount: 0, shareUnread: false });
      }
    }).catch(() => alive && setDetail({ ok: false, error: "Vlákno se nepodařilo načíst." }));
    return () => {
      alive = false;
    };
  }, [threadId, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const messages = detail?.messages ?? [];
  const last = messages[messages.length - 1];
  const lastIn = [...messages].reverse().find((m) => m.direction === "in");
  const target = lastIn ?? last;
  const jobId = detail?.jobId ?? summary.jobId;
  const jobNumber = [...messages].reverse().find((m) => m.jobNumber)?.jobNumber ?? summary.jobNumber;
  const aiPending = messages.some((m) => m.direction === "in" && m.aiPending);
  const myShares = (detail?.shares ?? []);
  const compose = (mode: ComposeRequest["mode"], m?: ThreadMessage) => onCompose({ mode, source: m ?? target ?? null, myAddresses: detail?.myAddresses ?? [], jobId });

  const toggleFlag = async () => {
    const next = !flagged;
    setFlagged(next);
    onPatch(threadId, { flagged: next });
    const r = await setThreadFlagAction(threadId, next);
    if (!r.ok) {
      setFlagged(!next);
      onPatch(threadId, { flagged: !next });
      setNotice({ ok: false, text: r.error ?? "Vlaječku se nepodařilo uložit." });
    }
  };
  const changePriority = async (v: PriorityValue | null) => {
    const prev = priority;
    const nextVal = v ?? prev.value;
    setPriority({ value: nextVal, manual: v !== null });
    onPatch(threadId, { priority: nextVal, priorityManual: v !== null });
    const r = await setThreadPriorityAction(threadId, v);
    if (!r.ok) {
      setPriority(prev);
      onPatch(threadId, { priority: prev.value, priorityManual: prev.manual });
      setNotice({ ok: false, text: r.error ?? "Prioritu se nepodařilo uložit." });
    } else if (v === null) {
      const d = await openThreadAction(threadId, { markRead: false });
      const p = Math.min(...(d.messages ?? []).filter((m) => m.direction === "in").map((m) => m.priority), 5);
      setPriority({ value: Number.isFinite(p) ? p : 3, manual: false });
      onPatch(threadId, { priority: Number.isFinite(p) ? p : 3, priorityManual: false });
    }
  };
  const markUnread = async () => {
    setBusy("unread");
    const r = await markThreadReadAction(threadId, false);
    setBusy(null);
    if (r.ok) {
      onPatch(threadId, { unreadCount: 1 });
      onBack();
    } else setNotice({ ok: false, text: r.error ?? "Chyba" });
  };
  // Pošta E: hlavní akce podle kategorie (Vytvořit nabídku, Zpracovat objednávku, Zapsat fakturu …)
  const [choices, setChoices] = React.useState<OrderChoice[] | null>(null);
  const actions = useMailActionRunner({
    onLinked: (tid, id, number) => onPatch(tid, { jobId: id, jobNumber: number }),
    onNotice: (n) => setNotice(n),
    onChoices: (_tid, c) => setChoices(c),
  });
  const runAction = (key: MailActionKey) => {
    if (!target) return;
    setNotice(null);
    void actions.run(key, { threadId, emailId: target.id, jobId });
  };
  // „Oddělit z vlákna": zpráva, která do vlákna nepatří (jen podobný předmět)
  const split = async (m: ThreadMessage) => {
    if (!window.confirm(`Oddělit zprávu „${m.subject || "(bez předmětu)"}“ od ${m.fromName || m.fromEmail} do samostatného vlákna?`)) return;
    setBusy("split");
    const r = await splitFromThreadAction(m.id).catch(() => ({ ok: false as const, error: "Spojení se nepovedlo — zkus to znovu." }));
    setBusy(null);
    if (!r.ok) return setNotice({ ok: false, text: r.error });
    setNotice({ ok: true, text: `Zpráva oddělena do samostatného vlákna${r.unlinked ? " a odpojena od zakázky vlákna (posoudí se znovu)" : ""}.` });
    onSplit?.();
    setDetail(await openThreadAction(threadId, { markRead: false }));
  };
  const runAi = async () => {
    setBusy("ai");
    const r = await runAiOnThreadAction(threadId);
    setBusy(null);
    setNotice(r.ok ? { ok: true, text: `AI roztřídila ${r.done ?? 0} e-mail(ů).` } : { ok: false, text: r.error ?? "AI selhala." });
    if (r.ok) setDetail(await openThreadAction(threadId, { markRead: false }));
  };

  // zpráva čeká na otázku „Patří k …?" (odpověď jmenuje jinou zakázku) → do rozhodnutí neutrální „K zakázce?"
  const question = detail ? detail.suggestion ?? null : summary.suggestion ?? null;
  const asking = neutralWhileAsking(target?.category ?? summary.category, Boolean(
    question?.forMessage && (question.emailId ? question.emailId === (target?.id ?? summary.emailId) : true) && !target?.jobId,
  ));
  const st = categoryStyle(asking ? "K zakázce" : target?.category ?? summary.category);
  // oprava kategorie jedné zprávy (přijaté i odeslané): vlákno hned, řádek seznamu, je-li to jeho zpráva
  const setMessageCategory = (id: string, c: EmailCategory) => {
    setDetail((d) => (d?.messages ? { ...d, messages: d.messages.map((m) => (m.id === id ? { ...m, category: c } : m)) } : d));
    if (id === summary.emailId || id === target?.id) onPatch(threadId, { category: c });
  };
  const categoryError = (text: string) => setNotice({ ok: false, text });
  return (
    <Card className="overflow-hidden" data-testid="thread-view">
      <div className={cn("h-1.5 w-full", st.bar)} aria-hidden />
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start gap-2">
          <Button size="icon-sm" variant="ghost" onClick={onBack} className="lg:hidden" aria-label="Zpět na seznam">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-base font-semibold leading-snug sm:text-lg" data-testid="thread-subject">{detail?.subject || summary.subject || "(bez předmětu)"}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {asking
                ? <AskingCategoryPill />
                : target
                  ? <CategoryPicker emailId={target.id} category={target.category} direction={target.direction} onChange={(c) => setMessageCategory(target.id, c)} onError={categoryError} />
                  : <CategoryPill category={summary.category} />}
              {(target?.customer ?? summary.customer) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-800 dark:bg-green-500/10 dark:text-green-300">
                  <Building2 className="h-3 w-3" /> {target?.customer ?? summary.customer}
                </span>
              )}
              {messages.length > 1 && <span className="text-xs text-muted-foreground">{messageCountLabel(messages.length)}</span>}
              <span className="inline-flex items-center gap-1.5" data-testid="thread-priority">
                <span className="text-xs font-medium text-muted-foreground">Priorita</span>
                <PrioritySelect inline value={priority.value} manual={priority.manual} onChange={changePriority} />
              </span>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-10 w-10 shrink-0 rounded-full text-muted-foreground" aria-label="Další akce" title="Další akce" data-testid="thread-more" disabled={busy !== null}>
                {busy === "ai" || busy === "unread" || busy === "split" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => void markUnread()} data-testid="thread-mark-unread">
                <MailOpen className="h-4 w-4" /> Označit jako nepřečtené
              </DropdownMenuItem>
              {canAi && aiPending && (
                <DropdownMenuItem onSelect={() => void runAi()} data-testid="thread-run-ai">
                  <Sparkles className="h-4 w-4" /> Roztřídit AI
                </DropdownMenuItem>
              )}
              {/* zpráva, která do vlákna nepatří (jen podobný předmět) → samostatné vlákno */}
              {messages.length > 1 && [...messages].reverse().slice(0, 8).map((m) => (
                <DropdownMenuItem key={`split-${m.id}`} onSelect={() => void split(m)} data-testid="thread-split" data-email={m.id}>
                  <Scissors className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">Oddělit z vlákna: {m.direction === "out" ? "odeslaná" : m.fromName || m.fromEmail} · {timeOf(m.receivedAt)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={toggleFlag}
            aria-pressed={flagged}
            aria-label={flagged ? "Zrušit vlaječku" : "Označit vlaječkou"}
            title={flagged ? "Zrušit vlaječku" : "Označit vlaječkou"}
            className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors", flagged ? "bg-red-50 text-red-600 dark:bg-red-500/15" : "text-muted-foreground hover:bg-accent")}
            data-testid="thread-flag"
          >
            <Flag className={cn("h-5 w-5", flagged && "fill-current")} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="send" onClick={() => compose("reply")} disabled={!target} data-testid="btn-reply">
            <Reply className="h-4 w-4" /> Odpovědět
          </Button>
          <Button size="sm" variant="outline" onClick={() => compose("replyAll")} disabled={!target} data-testid="btn-reply-all" aria-label="Odpovědět všem" title="Odpovědět všem">
            <ReplyAll className="h-4 w-4" /><span className="hidden 2xl:inline">Odpovědět všem</span>
          </Button>
          {/* přeposílá se poslední PŘIJATÁ zpráva (s výkresem zákazníka), ne vlastní odpověď */}
          <Button size="sm" variant="outline" onClick={() => compose("forward")} disabled={!target} data-testid="btn-forward" aria-label="Přeposlat" title="Přeposlat">
            <Forward className="h-4 w-4" /><span className="hidden 2xl:inline">Přeposlat</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShareOpen(true)} data-testid="btn-share" title="Předat kolegovi s poznámkou">
            <Share2 className="h-4 w-4" /><span className="hidden sm:inline">Předat kolegovi</span><span className="sm:hidden">Předat</span>
          </Button>
        </div>

        {notice && (
          <p className={cn("flex items-start gap-1.5 rounded-md px-2.5 py-2 text-sm", notice.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")} role="status">
            {notice.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="min-w-0 break-words" data-testid="thread-notice">
              {notice.text}
              {notice.href && <> <Link href={notice.href} className="font-medium underline underline-offset-4">{notice.hrefLabel ?? "Otevřít"}</Link></>}
            </span>
          </p>
        )}

        {myShares.length > 0 && (
          <ul className="space-y-1.5" data-testid="thread-shares">
            {myShares.map((s) => (
              <li key={s.id} className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm dark:border-violet-500/30 dark:bg-violet-500/10">
                <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300" />
                <span className="min-w-0 break-words">
                  <b>Od {s.by ?? "kolegy"}</b>{s.to ? <> → {s.to}</> : null}: {s.note || <i className="text-muted-foreground">bez poznámky</i>}
                  <span className="ml-1 text-xs text-muted-foreground" suppressHydrationWarning>· {timeOf(s.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {canAi && (target?.aiSummary ?? summary.aiSummary) && (
          <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-3 text-sm dark:border-violet-500/30 dark:from-violet-500/10 dark:to-fuchsia-500/10">
            <div className="flex items-center gap-2 font-semibold text-violet-700 dark:text-violet-300"><Sparkles className="h-4 w-4" /> Co AI zjistila</div>
            <p className="mt-1 text-muted-foreground">{target?.aiSummary ?? summary.aiSummary}</p>
            {(target?.hasDraft ?? summary.hasDraft) && (
              <p className="mt-1 text-xs">Návrh odpovědi čeká ve frontě ke schválení — <Link href="/dashboard" className="text-primary underline-offset-4 hover:underline">zkontrolovat a odeslat</Link>.</p>
            )}
          </div>
        )}

        {detail === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Načítám vlákno…</p>
        ) : !detail.ok ? (
          <p className="text-sm text-destructive">{detail.error}</p>
        ) : (
          <ol className="space-y-2" data-testid="thread-messages">
            {messages.map((m) => (
              <MessageItem
                key={m.id}
                m={m}
                open={expanded.has(m.id)}
                onToggle={() => setExpanded((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}
                onReply={() => compose("reply", m)}
                onForward={() => compose("forward", m)}
                onCategory={(c) => setMessageCategory(m.id, c)}
                onCategoryError={categoryError}
              />
            ))}
          </ol>
        )}

        <div className="space-y-2 rounded-xl border border-dashed bg-muted/30 p-3">
          <JobLinkBar
            threadId={threadId}
            jobId={jobId}
            jobNumber={jobNumber}
            jobTitle={detail?.jobTitle ?? summary.jobTitle}
            linkSource={[...messages].reverse().find((m) => m.jobId)?.jobLinkSource ?? summary.jobLinkSource}
            linkActor={[...messages].reverse().find((m) => m.jobId)?.jobLinkActor ?? summary.jobLinkActor}
            suggestion={detail ? detail.suggestion ?? null : summary.suggestion ?? null}
            category={asking ? "K zakázce" : target?.category ?? summary.category}
            direction={target?.direction ?? summary.direction}
            actionsDisabled={!target}
            busyAction={actions.busy?.threadId === threadId ? actions.busy.key : null}
            onAction={runAction}
            choices={choices}
            onChoicesDone={() => setChoices(null)}
            onError={(text) => setNotice({ ok: false, text })}
            onChanged={(c) => {
              setNotice({ ok: true, text: c.text });
              onPatch(threadId, c.jobId ? { jobId: c.jobId, jobNumber: c.jobNumber, suggestionDone: true } : { jobCleared: true, suggestionDone: c.suggestionDone });
              void openThreadAction(threadId, { markRead: false }).then(setDetail);
            }}
          />
          {lastIn && (
            <CategoryEditor
              emailId={lastIn.id}
              category={lastIn.category}
              canAi={canAi}
              onSaved={(c) => setMessageCategory(lastIn.id, c)}
            />
          )}
        </div>
      </CardContent>
      <ShareDialog
        threadId={threadId}
        subject={detail?.subject ?? summary.subject}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        onShared={(n) => {
          setShareOpen(false);
          setNotice({ ok: true, text: n === 1 ? "Předáno kolegovi — uvidí to ve své poště." : `Předáno ${n} kolegům — uvidí to ve své poště.` });
          void openThreadAction(threadId, { markRead: false }).then(setDetail);
        }}
      />
    </Card>
  );
}

function MessageItem({ m, open, onToggle, onReply, onForward, onCategory, onCategoryError }: {
  m: ThreadMessage; open: boolean; onToggle: () => void; onReply: () => void; onForward: () => void;
  onCategory: (c: EmailCategory) => void; onCategoryError: (text: string) => void;
}) {
  const out = m.direction === "out";
  const [asSent, setAsSent] = React.useState(false);
  const who = out ? (m.senderName || m.fromName || m.fromEmail || "Já") : (m.fromName || m.fromEmail || "—");
  return (
    <li className={cn("rounded-xl border", out ? "border-cyan-200 bg-cyan-50/40 dark:border-cyan-500/20 dark:bg-cyan-500/5" : "bg-card")} data-testid="thread-message" data-direction={m.direction}>
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 p-3 text-left" aria-expanded={open}>
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white", out ? "bg-cyan-600" : categoryStyle(m.category).dot)}>
          {out ? <Send className="h-4 w-4" /> : initials(who)}
        </span>
        <span className="min-w-0 flex-1">
          {/* úzký panel: datum a „odesláno" se zalomí na druhý řádek, jméno se neusekne na „S…" */}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="min-w-0 max-w-full truncate text-sm font-semibold" data-testid="message-who">{who}</span>
            {out && <span className="shrink-0 rounded bg-cyan-100 px-1.5 text-[10px] font-semibold uppercase text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-200">odesláno</span>}
            <span className="ml-auto shrink-0 text-xs text-muted-foreground" suppressHydrationWarning>{timeOf(m.receivedAt)}</span>
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {out ? `Komu: ${m.toEmail || "—"}` : m.fromEmail}{m.ccEmail ? ` · Kopie: ${m.ccEmail}` : ""}
          </span>
          {!open && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{m.body.replace(/\s+/g, " ").slice(0, 160)}</span>}
        </span>
        {open ? <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          <div className="flex flex-wrap items-center gap-2" data-testid="message-meta">
            <CategoryPicker emailId={m.id} category={m.category} direction={m.direction} onChange={onCategory} onError={onCategoryError} />
            {out && m.signedHtml && (
              <button
                type="button"
                onClick={() => setAsSent((v) => !v)}
                aria-pressed={asSent}
                className="inline-flex min-h-7 items-center gap-1 rounded-full border px-2 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                data-testid="message-as-sent"
              >
                <PenLine className="h-3 w-3" /> {asSent ? "Zobrazit text" : "Jak odešla (s podpisem)"}
              </button>
            )}
          </div>
          {out && m.bccEmail && <p className="text-xs text-muted-foreground">Skrytá kopie: {m.bccEmail}</p>}
          {asSent && m.signedHtml ? (
            <SentHtmlFrame html={m.signedHtml} />
          ) : (
            <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 text-sm leading-relaxed scrollbar-thin" data-testid="message-body">
              {m.body.trim() || "(prázdný e-mail)"}
            </div>
          )}
          {m.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {m.attachments.map((a) => (
                <a key={a.id} href={`/api/emails/attachment/${a.id}`} className="inline-flex max-w-full items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent" data-testid="message-attachment">
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> <span className="truncate">{a.filename}</span>
                  {a.sizeBytes ? <span className="text-muted-foreground">· {fmtSize(a.sizeBytes)}</span> : null}
                </a>
              ))}
            </div>
          )}
          {out && m.sentCopy && (
            <p className={cn("text-xs", m.sentCopy === "failed" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{sentCopyLabel(m.sentCopy, m.sentCopyError)}</p>
          )}
          <div className="flex flex-wrap justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={onReply} data-testid="message-reply"><Reply className="h-4 w-4" /> Odpovědět na tuto zprávu</Button>
            <Button size="sm" variant="ghost" onClick={onForward} data-testid="message-forward"><Forward className="h-4 w-4" /> Přeposlat</Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Odeslaná zpráva tak, jak odešla (HTML s grafickým podpisem) — izolovaný rám bez skriptů, výška podle obsahu. */
function SentHtmlFrame({ html }: { html: string }) {
  const ref = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState(260);
  const measure = () => {
    const d = ref.current?.contentDocument;
    if (d?.documentElement) setHeight(Math.min(900, Math.max(120, Math.ceil(d.documentElement.scrollHeight) + 4)));
  };
  return (
    <div className="overflow-hidden rounded-lg border bg-white" data-testid="message-sent-html">
      <iframe
        ref={ref}
        title="Zpráva, jak odešla"
        sandbox="allow-same-origin"
        srcDoc={html}
        onLoad={measure}
        className="block w-full border-0 bg-white"
        style={{ height }}
      />
    </div>
  );
}
