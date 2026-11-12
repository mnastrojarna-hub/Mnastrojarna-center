"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, GraduationCap, Loader2, Mail, Pencil, Sparkles, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AiConfidence } from "@/components/ai-confidence";
import {
  changeStageSignalAction, confirmStageSignalAction, getApprovalStageSignalAction, getStageSignalAction, getThreadStageSignalsAction,
  undoStageSignalAction, type StageChoice,
} from "@/app/actions/mail-stage";
import type { MailStageView } from "@/lib/email/mail-stage-store";
import { MAIL_STAGE_META, type MailStageKind } from "@/lib/email/mail-stage-signal";
import { CLAIM_REASONS, CLAIM_REASON_ORDER } from "@/lib/jobs/flow-exceptions";
import { LOST_REASONS, lostReasonsFor } from "@/lib/jobs/flow-status";
import { stageMeta } from "@/lib/jobs/stages";
import { cn, relativeTime } from "@/lib/utils";

/**
 * Pošta → speciální stav zakázky (majitel 9. 11., „samozřejmě s korekcí"): návrh ve vlákně a ve frontě
 * ke schválení (stav a důvod jde před potvrzením změnit, nebo „Žádná změna"), po přepnutí „Vrátit" a
 * „Změnit…" (vlákno i historie zakázky). Každá korekce se AI naučí.
 */

const SELECT = "h-10 w-full rounded-md border bg-background px-3 text-sm";

function initialChoice(v: MailStageView): StageChoice {
  return { kind: v.finalKind ?? v.kind, reason: v.reason, lostReason: v.lostReason, claimReason: v.claimReason };
}

/** Výběr stavu (+ „Žádná změna"), důvod a u uzavření důvod prohry / u reklamace druh vady. */
export function StageChoiceEditor({ view, value, onChange, allowNone = true, idPrefix }: {
  view: MailStageView; value: StageChoice; onChange: (v: StageChoice) => void; allowNone?: boolean; idPrefix: string;
}) {
  const kind = value.kind;
  const lost = kind === "nerealizovano" || kind === "zruseno" ? lostReasonsFor("job", kind) : [];
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-testid="stage-choice-editor">
      <label className="space-y-1 text-xs font-medium text-muted-foreground" htmlFor={`${idPrefix}-kind`}>
        Stav zakázky
        <select
          id={`${idPrefix}-kind`} className={SELECT} value={kind} data-testid="stage-choice-kind"
          onChange={(e) => onChange({ ...value, kind: e.target.value as MailStageKind | "none" })}
        >
          {view.options.map((k) => <option key={k} value={k}>{MAIL_STAGE_META[k].label}</option>)}
          {allowNone && <option value="none">Žádná změna (e-mail to nenaznačuje)</option>}
        </select>
      </label>
      {kind === "reklamace" && (
        <label className="space-y-1 text-xs font-medium text-muted-foreground" htmlFor={`${idPrefix}-claim`}>
          Co zákazník reklamuje
          <select id={`${idPrefix}-claim`} className={SELECT} value={value.claimReason ?? "jine"} onChange={(e) => onChange({ ...value, claimReason: e.target.value })}>
            {CLAIM_REASON_ORDER.map((r) => <option key={r} value={r}>{CLAIM_REASONS[r]}</option>)}
          </select>
        </label>
      )}
      {lost.length > 0 && (
        <label className="space-y-1 text-xs font-medium text-muted-foreground" htmlFor={`${idPrefix}-lost`}>
          Důvod
          <select id={`${idPrefix}-lost`} className={SELECT} value={value.lostReason && lost.includes(value.lostReason as never) ? value.lostReason : "jine"} onChange={(e) => onChange({ ...value, lostReason: e.target.value })}>
            {lost.map((r) => <option key={r} value={r}>{LOST_REASONS[r].label}</option>)}
          </select>
        </label>
      )}
      {kind !== "none" && (
        <label className="space-y-1 text-xs font-medium text-muted-foreground sm:col-span-2" htmlFor={`${idPrefix}-reason`}>
          Poznámka k zakázce (z e-mailu)
          <Textarea id={`${idPrefix}-reason`} rows={2} value={value.reason ?? ""} onChange={(e) => onChange({ ...value, reason: e.target.value })} className="bg-background text-sm" data-testid="stage-choice-reason" />
        </label>
      )}
    </div>
  );
}

type Busy = "confirm" | "reject" | "undo" | "change" | null;

/** Návrh (pending) nebo použité přepnutí (applied) — jeden řádek s akcemi. */
export function MailStageCard({ view, onDone, onError, compact }: {
  view: MailStageView; onDone: (text: string) => void; onError: (text: string) => void; compact?: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [choice, setChoice] = React.useState<StageChoice>(() => initialChoice(view));
  const [busy, setBusy] = React.useState<Busy>(null);
  const kind = view.finalKind ?? view.kind;
  const meta = MAIL_STAGE_META[kind];
  const pending = view.status === "pending";

  const run = async (key: Exclude<Busy, null>, fn: () => Promise<{ ok: boolean; error?: string; stage?: string }>, text: (stage?: string) => string) => {
    setBusy(key);
    try {
      const r = await fn();
      if (r.ok) onDone(text(r.stage));
      else onError(r.error ?? "Nepodařilo se.");
    } catch {
      onError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  };
  const stageText = (s?: string) => (s ? stageMeta(s as never).label : "");
  const learnedNote = " AI se z opravy poučí.";

  const confirm = () => void run("confirm", () => confirmStageSignalAction(view.id, editing ? choice : { kind: view.kind, reason: view.reason, lostReason: view.lostReason, claimReason: view.claimReason }),
    (s) => (editing && choice.kind === "none" ? `Dobře, stav zakázky se nemění.${learnedNote}` : `Zakázka ${view.jobNumber ?? ""} je teď ${stageText(s)}.`));
  const reject = () => void run("reject", () => confirmStageSignalAction(view.id, { kind: "none" }), () => `Dobře, stav zakázky se nemění.${learnedNote}`);
  const undo = () => void run("undo", () => undoStageSignalAction(view.id), (s) => `Vráceno na ${stageText(s)}.${learnedNote}`);
  const change = () => void run("change", () => changeStageSignalAction(view.id, choice),
    (s) => (choice.kind === "none" ? `Vráceno na ${stageText(s)}.${learnedNote}` : `Opraveno — zakázka je ${stageText(s)}.${learnedNote}`));

  return (
    <div
      className={cn("space-y-2 rounded-lg border p-2.5", pending
        ? "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10"
        : "border-fuchsia-200 bg-fuchsia-50/60 dark:border-fuchsia-500/30 dark:bg-fuchsia-500/10")}
      data-testid={pending ? "mail-stage-pending" : "mail-stage-applied"} data-kind={kind}
    >
      <div className="flex items-start gap-2 text-sm">
        {pending ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> : <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-fuchsia-600" />}
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {pending
              ? <>E-mail naznačuje: <span className="whitespace-nowrap">{meta.label}</span>{view.jobNumber ? <> · {view.jobNumber}</> : null}</>
              : <>{view.auto ? "AI přepnula" : "Přepnuto"} podle e-mailu: {view.fromStage ? stageText(view.fromStage) : ""} <ArrowRight className="inline h-3 w-3" /> {view.toStage ? stageText(view.toStage) : meta.label}</>}
          </p>
          {!compact && <p className="break-words text-xs text-muted-foreground">„{view.reason}“{view.from ? ` — ${view.from}` : ""}</p>}
        </div>
        {pending && <AiConfidence value={view.confidence} />}
      </div>

      {editing && (
        <StageChoiceEditor view={view} value={choice} onChange={setChoice} idPrefix={`stage-${view.id}`} />
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {pending ? (
          <>
            <Button size="sm" variant="success" disabled={busy !== null} onClick={confirm} data-testid="mail-stage-confirm">
              {busy === "confirm" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {editing ? (choice.kind === "none" ? "Uložit — žádná změna" : choice.kind !== view.kind ? MAIL_STAGE_META[choice.kind as MailStageKind].action : "Potvrdit") : meta.action}
            </Button>
            {!editing && (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setEditing(true)} data-testid="mail-stage-edit">
                <Pencil className="h-4 w-4" /> Upravit…
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={editing ? () => { setEditing(false); setChoice(initialChoice(view)); } : reject} data-testid="mail-stage-reject">
              {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} {editing ? "Zrušit" : "Ne, žádná změna"}
            </Button>
          </>
        ) : view.undoable ? (
          editing ? (
            <>
              <Button size="sm" variant="success" disabled={busy !== null} onClick={change} data-testid="mail-stage-change-save">
                {busy === "change" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Uložit opravu
              </Button>
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { setEditing(false); setChoice(initialChoice(view)); }}>Zrušit</Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={undo} data-testid="mail-stage-undo" title="Vrátit zakázku do stavu před přepnutím">
                {busy === "undo" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Vrátit
              </Button>
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setEditing(true)} data-testid="mail-stage-change">
                <Pencil className="h-4 w-4" /> Změnit…
              </Button>
            </>
          )
        ) : (
          <span className="text-xs text-muted-foreground">Stav zakázky se od té doby změnil — opravit jde v „Korekce stavu…“.</span>
        )}
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <GraduationCap className="h-3 w-3" /> opravy se AI učí
        </span>
      </div>
    </div>
  );
}

/** Lišta zakázky ve vlákně: rozpoznané stavy z pošty (návrh / přepnuto). */
export function MailStageSignals({ threadId, jobId, onChanged, onError }: {
  threadId: string; jobId: string; onChanged: (text: string) => void; onError: (text: string) => void;
}) {
  const [list, setList] = React.useState<MailStageView[]>([]);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    void getThreadStageSignalsAction(threadId, jobId).then((r) => { if (alive) setList(r); }).catch(() => undefined);
    return () => { alive = false; };
  }, [threadId, jobId, tick]);
  if (!list.length) return null;
  return (
    <div className="space-y-1.5" data-testid="mail-stage-signals">
      {list.map((v) => (
        <MailStageCard key={`${v.id}-${v.status}-${v.toStage}`} view={v} onError={onError} onDone={(t) => { onChanged(t); setTick((x) => x + 1); }} />
      ))}
    </div>
  );
}

/** Řádek fronty ke schválení „Stav zakázky z pošty" (návrh se načte podle položky fronty). */
export function MailStageApproval({ approvalId, title, createdAt, onResolved }: {
  approvalId: string; title: string; createdAt: string; onResolved: (id: string) => void;
}) {
  const [view, setView] = React.useState<MailStageView | null | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    void getApprovalStageSignalAction(approvalId).then((v) => { if (alive) setView(v); }).catch(() => { if (alive) setView(null); });
    return () => { alive = false; };
  }, [approvalId]);
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3" data-testid="approval-job-stage">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Mail className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">Stav zakázky z pošty</Badge>
            {view?.jobId && (
              <Link href={`/orders/${view.jobId}?tab=komunikace`} className="inline-flex min-h-8 items-center gap-0.5 font-medium text-foreground/80 hover:underline">
                {view.jobNumber ?? "Zakázka"} <ArrowRight className="h-3 w-3" />
              </Link>
            )}
            {view?.threadId && (
              <Link href={`/inbox?vlakno=${encodeURIComponent(view.threadId)}&detail=1`} className="inline-flex min-h-8 items-center gap-0.5 font-medium text-foreground/80 hover:underline">
                E-mail <ArrowRight className="h-3 w-3" />
              </Link>
            )}
            <span>· připravil ✨ AI · {relativeTime(createdAt)}</span>
          </div>
        </div>
      </div>
      {view === undefined ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Načítám…</p>
      ) : view === null ? (
        <p className="text-xs text-muted-foreground">Návrh už neexistuje.</p>
      ) : done ? (
        <p className="text-sm text-success">{done}</p>
      ) : view.status !== "pending" ? (
        <p className="text-xs text-muted-foreground">Návrh už je vyřízený (ve vlákně nebo jinde).</p>
      ) : (
        <MailStageCard
          view={view} compact={false} onError={setError}
          onDone={(t) => { setDone(t); setError(null); setTimeout(() => onResolved(approvalId), 900); }}
        />
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** Historie zakázky: u události „Z e-mailu … přepnuto" Vrátit / Změnit… a odkaz na e-mail. */
export function MailStageHistoryActions({ signalId, threadId, onDone, onError }: {
  signalId: string; threadId: string | null; onDone: (text: string) => void; onError: (text: string) => void;
}) {
  const [view, setView] = React.useState<MailStageView | null | undefined>(undefined);
  React.useEffect(() => {
    let alive = true;
    void getStageSignalAction(signalId).then((v) => { if (alive) setView(v); }).catch(() => { if (alive) setView(null); });
    return () => { alive = false; };
  }, [signalId]);
  return (
    <div className="space-y-1.5" data-testid="history-mail-stage">
      {threadId && (
        <Link href={`/inbox?vlakno=${encodeURIComponent(threadId)}&detail=1`} className="inline-flex items-center gap-1 text-xs font-medium text-foreground/80 underline-offset-2 hover:underline" data-testid="history-mail-stage-email">
          <Mail className="h-3 w-3" /> Otevřít e-mail
        </Link>
      )}
      {view && view.status === "applied" && <MailStageCard view={view} compact onDone={onDone} onError={onError} />}
    </div>
  );
}
