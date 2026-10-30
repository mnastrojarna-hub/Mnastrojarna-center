"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Inbox, Loader2, Mail, MessagesSquare, Paperclip, PenSquare, Sparkles, Check, X, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThreadRow } from "@/components/mail/thread-row";
import { ThreadView, type ThreadPatch } from "@/components/mail/thread-view";
import { ComposeDialog, type ComposeRequest } from "@/components/mail/compose-dialog";
import { useAccess } from "@/components/access-provider";
import { useJobDetail } from "@/components/jobs/detail/detail-context";
import { setThreadFlagAction, setThreadPriorityAction } from "@/app/actions/mail-inbox";
import { confirmJobSuggestionAction, copyThreadAttachmentsAction, rejectJobSuggestionAction } from "@/app/actions/mail-jobs";
import type { ThreadSummary } from "@/lib/email/mail-types";
import type { JobDetail } from "@/lib/jobs/types";
import { relativeTime } from "@/lib/utils";
import { useJobMail } from "./job-mail-context";
import { MailChangeCard } from "./mail-change-card";
import { useMailChangeActions } from "./use-mail-change-actions";

/**
 * Záložka Komunikace (zakázka i poptávka): vlákna přiřazené pošty (příchozí i odeslané, nejnovější
 * nahoře, nepřečtené / vlaječka / priorita jako v poště), otevřít vlákno, odpovědět / přeposlat /
 * nová zpráva předvyplněná na kontakt zakázky, návrhy „Patří sem?", změny a upřesnění z e-mailů.
 */
export function CommunicationTab({ job }: { job: Pick<JobDetail, "id" | "number" | "title"> }) {
  const mail = useJobMail();
  const { can } = useAccess();
  const canAi = can("dashboard");
  const { notify, refresh } = useJobDetail();
  const actions = useMailChangeActions();
  const data = mail?.data ?? null;
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState(0);
  const [compose, setCompose] = React.useState<ComposeRequest | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [threads, setThreads] = React.useState<ThreadSummary[]>(data?.threads ?? []);
  const [lastData, setLastData] = React.useState(data);
  if (data !== lastData) {
    setLastData(data);
    setThreads(data?.threads ?? []);
  }

  if (!data) {
    return <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">Komunikaci se nepodařilo načíst.</p>;
  }
  const open = openId ? threads.find((t) => t.threadId === openId) ?? null : null;
  const changes = data.changes.filter((c) => c.status !== "dismissed");
  const pendingChanges = changes.filter((c) => c.status === "suggested");

  const patch = (threadId: string, p: ThreadPatch) => setThreads((list) => list.map((t) => (t.threadId === threadId ? {
    ...t,
    ...(p.flagged !== undefined ? { flagged: p.flagged } : {}),
    ...(p.priority !== undefined ? { priority: p.priority } : {}),
    ...(p.priorityManual !== undefined ? { priorityManual: p.priorityManual } : {}),
    ...(p.unreadCount !== undefined ? { unreadCount: p.unreadCount } : {}),
    ...(p.category ? { category: p.category } : {}),
  } : t)));

  const after = async (text: string) => {
    notify("success", text);
    await mail?.refresh();
    refresh();
  };
  const confirm = async (id: string) => {
    setBusy(id);
    const r = await confirmJobSuggestionAction(id);
    setBusy(null);
    if (!r.ok) return notify("error", r.error ?? "Nepodařilo se přiřadit.");
    await after(r.changes ? `Přiřazeno k ${job.number} — z e-mailu zapsáno ${r.changes} změn(y).` : `Přiřazeno k ${job.number}.`);
  };
  const reject = async (id: string) => {
    setBusy(id);
    const r = await rejectJobSuggestionAction(id);
    setBusy(null);
    if (!r.ok) return notify("error", r.error ?? "Nepodařilo se.");
    await after("Dobře — tohle vlákno sem nepatří.");
  };
  const copyFiles = async () => {
    setBusy("files");
    let copied = 0;
    for (const t of threads.filter((x) => x.hasAttachments)) {
      const r = await copyThreadAttachmentsAction(t.threadId);
      copied += r.copied ?? 0;
    }
    setBusy(null);
    await after(copied ? `Uloženo do dokumentů: ${copied}` : "Přílohy už v dokumentech jsou.");
  };
  const newMessage = () => setCompose({
    mode: "new", jobId: job.id, to: data.contact.email ? [data.contact.email] : [],
    subject: `${job.number}${job.title ? ` — ${job.title}` : ""}`,
  });

  return (
    <div className="space-y-4" data-testid="job-communication">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Pošta k této zakázce se přiřazuje sama (vlákno, naše čísla, čísla výkresů, firma). Technické změny z e-mailů se zapíšou do historie —
          <strong className="font-semibold text-foreground"> pokyn zákazníka z e-mailu je nadřazený výkresu</strong>.
        </p>
        {data.canMail && (
          <Button size="sm" variant="send" onClick={newMessage} data-testid="job-compose">
            <PenSquare className="h-4 w-4" /> Nová zpráva{data.contact.name ? ` — ${data.contact.name}` : ""}
          </Button>
        )}
      </div>

      {data.suggestions.length > 0 && (
        <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/10" data-testid="job-mail-suggestions">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200"><Sparkles className="h-4 w-4" /> Možná patří sem</h3>
          <ul className="space-y-2">
            {data.suggestions.map((s) => (
              <li key={s.id} className="flex flex-col gap-2 rounded-lg border bg-background/80 p-2.5 text-sm sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.subject || "(bez předmětu)"}</p>
                  <p className="truncate text-xs text-muted-foreground"><span suppressHydrationWarning>{s.from} · {relativeTime(s.at)}</span>{s.reasons.length ? ` · ${s.reasons.slice(0, 2).join(" · ")}` : ""}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="success" onClick={() => void confirm(s.id)} disabled={busy !== null} data-testid="suggestion-yes">
                    {busy === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Patří sem
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void reject(s.id)} disabled={busy !== null} aria-label="Nepatří sem"><X className="h-4 w-4" /> Ne</Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {changes.length > 0 && (
        <section className="space-y-2" data-testid="job-mail-changes">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Info className="h-4 w-4 text-fuchsia-600 dark:text-fuchsia-400" /> Změny a upřesnění z e-mailů
            {pendingChanges.length > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white">{pendingChanges.length} čeká</span>}
          </h3>
          <ul className="grid gap-2 lg:grid-cols-2">
            {changes.slice(0, 40).map((c) => (
              <MailChangeCard
                key={c.id}
                c={c}
                busy={actions.busy === c.id}
                onUndo={() => void actions.undo(c.id)}
                onApply={() => void actions.apply(c.id)}
                onDismiss={() => void actions.dismiss(c.id)}
                onOpenMail={c.threadId ? () => { setOpenId(c.threadId); setVersion((v) => v + 1); } : undefined}
              />
            ))}
          </ul>
        </section>
      )}

      {!data.canMail ? (
        <p className="flex items-start gap-2 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          <Mail className="mt-0.5 h-4 w-4 shrink-0" /> Poštu vidí jen ten, komu patří schránka (a kolegové, kterým ji předá). Změny z e-mailů výše a historie jsou vidět všem.
        </p>
      ) : open ? (
        <div className="space-y-2">
          <Button size="sm" variant="ghost" onClick={() => setOpenId(null)} data-testid="job-thread-back"><ArrowLeft className="h-4 w-4" /> Zpět na komunikaci</Button>
          <ThreadView
            key={open.threadId}
            summary={open}
            canAi={canAi}
            version={version}
            onBack={() => setOpenId(null)}
            onPatch={patch}
            onCompose={(r) => setCompose({ ...r, jobId: job.id })}
          />
        </div>
      ) : threads.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground" data-testid="job-mail-empty">
          <Inbox className="h-7 w-7 opacity-50" />
          <p>K zakázce zatím není přiřazená žádná pošta.</p>
          <p className="text-xs">Odpovědi na naši nabídku, objednávku dodavateli i e-maily s číslem {job.number} se sem přiřadí samy. Jiný e-mail přiřadíš v poště tlačítkem „Přiřadit k zakázce“.</p>
          <Button asChild size="sm" variant="outline"><Link href="/inbox?slozka=jobs"><MessagesSquare className="h-4 w-4" /> Pošta K zakázkám</Link></Button>
        </div>
      ) : (
        <section className="space-y-2" data-testid="job-threads">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Vlákna ({threads.length})</h3>
            {data.pendingFiles > 0 && (
              <Button size="sm" variant="outline" onClick={() => void copyFiles()} disabled={busy !== null} data-testid="job-mail-files">
                {busy === "files" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />} Uložit přílohy do dokumentů ({data.pendingFiles})
              </Button>
            )}
          </div>
          {threads.map((t) => (
            <ThreadRow
              key={t.threadId}
              t={t}
              active={false}
              canAi={canAi}
              showMailbox={false}
              hideJob
              onOpen={() => { setOpenId(t.threadId); setVersion((v) => v + 1); }}
              onFlag={() => {
                patch(t.threadId, { flagged: !t.flagged });
                void setThreadFlagAction(t.threadId, !t.flagged).then((r) => { if (!r.ok) patch(t.threadId, { flagged: t.flagged }); });
              }}
              onPriority={(v) => {
                if (v !== null) patch(t.threadId, { priority: v, priorityManual: true });
                void setThreadPriorityAction(t.threadId, v);
              }}
            />
          ))}
        </section>
      )}

      <ComposeDialog
        request={compose}
        onClose={() => setCompose(null)}
        onSent={(r) => {
          setCompose(null);
          notify(r.sentCopy === "failed" ? "error" : "success", `Odesláno${r.fromAddress ? ` z ${r.fromAddress}` : ""}. ${r.sentCopyText ?? ""}`.trim());
          setVersion((v) => v + 1);
          void mail?.refresh();
          refresh();
        }}
      />
    </div>
  );
}
