"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Reply, ReplyAll, Forward, Share2, Flag, MailOpen, FolderOpen, FolderPlus, Loader2, Paperclip, Sparkles,
  ChevronDown, ChevronRight, Building2, CheckCircle2, AlertTriangle, Send, MessageSquareText, MoreHorizontal,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PrioritySelect, type PriorityValue } from "@/components/priority";
import { CategoryEditor, CategoryPill } from "@/components/mail/category-editor";
import { ShareDialog } from "@/components/mail/share-dialog";
import type { ComposeRequest } from "@/components/mail/compose-dialog";
import { createJobFromEmail } from "@/app/actions/mail";
import { markThreadReadAction, openThreadAction, runAiOnThreadAction, setThreadFlagAction, setThreadPriorityAction } from "@/app/actions/mail-inbox";
import { sentCopyLabel } from "@/lib/email/mail-folders";
import type { ThreadDetail, ThreadMessage, ThreadSummary } from "@/lib/email/mail-types";
import { categoryStyle } from "@/lib/email/visibility";
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
}

export function ThreadView({ summary, canAi, onBack, onPatch, onCompose, version }: {
  summary: ThreadSummary;
  canAi: boolean;
  onBack: () => void;
  onPatch: (threadId: string, patch: ThreadPatch) => void;
  onCompose: (r: ComposeRequest) => void;
  /** Změna = načíst vlákno znovu (po odeslání, živá pošta). */
  version: number;
}) {
  const router = useRouter();
  const [detail, setDetail] = React.useState<ThreadDetail | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ ok: boolean; text: string } | null>(null);
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
  const createJob = async () => {
    if (!target) return;
    setBusy("job");
    const res = await createJobFromEmail(target.id);
    if (res.ok && res.id) {
      onPatch(threadId, { jobId: res.id, jobNumber: res.number });
      router.push(`/orders/${res.id}`);
    } else {
      setBusy(null);
      setNotice({ ok: false, text: res.error ?? "Zakázku se nepodařilo založit." });
    }
  };
  const runAi = async () => {
    setBusy("ai");
    const r = await runAiOnThreadAction(threadId);
    setBusy(null);
    setNotice(r.ok ? { ok: true, text: `AI roztřídila ${r.done ?? 0} e-mail(ů).` } : { ok: false, text: r.error ?? "AI selhala." });
    if (r.ok) setDetail(await openThreadAction(threadId, { markRead: false }));
  };

  const st = categoryStyle(target?.category ?? summary.category);
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
              <CategoryPill category={target?.category ?? summary.category} />
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
                {busy === "ai" || busy === "unread" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
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
            <span className="min-w-0 break-words">{notice.text}</span>
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
              />
            ))}
          </ol>
        )}

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed bg-muted/30 p-3">
          {jobId ? (
            <Button asChild variant="success" size="sm">
              <Link href={`/orders/${jobId}`}><FolderOpen className="h-4 w-4" /> Otevřít zakázku {jobNumber ?? ""}</Link>
            </Button>
          ) : (
            <Button variant="success" size="sm" onClick={createJob} disabled={busy !== null || !lastIn}>
              {busy === "job" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />} Založit zakázku
            </Button>
          )}
          {lastIn && (
            <CategoryEditor
              emailId={lastIn.id}
              category={lastIn.category}
              canAi={canAi}
              onSaved={(c) => {
                setDetail((d) => (d?.messages ? { ...d, messages: d.messages.map((m) => (m.id === lastIn.id ? { ...m, category: c } : m)) } : d));
                onPatch(threadId, { category: c });
              }}
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

function MessageItem({ m, open, onToggle, onReply, onForward }: { m: ThreadMessage; open: boolean; onToggle: () => void; onReply: () => void; onForward: () => void }) {
  const out = m.direction === "out";
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
          {out && m.bccEmail && <p className="text-xs text-muted-foreground">Skrytá kopie: {m.bccEmail}</p>}
          <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 text-sm leading-relaxed scrollbar-thin" data-testid="message-body">
            {m.body.trim() || "(prázdný e-mail)"}
          </div>
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
