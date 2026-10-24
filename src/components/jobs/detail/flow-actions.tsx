"use client";

import * as React from "react";
import { CalendarPlus, GitCompare, Hand, Loader2, Mail, RefreshCw, UserRoundCheck } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAccess } from "@/components/access-provider";
import { ReasonDialog, type ReasonDialogResult } from "@/components/flow-status/reason-dialog";
import { ProposalChip } from "@/components/flow-status/proposal-chip";
import { ActorStamp } from "@/components/flow-status/actor-stamp";
import { StagePickerDialog } from "@/components/jobs/stage-select";
import { ConfirmOrderDialog, MismatchList } from "@/components/flow/confirm-order-dialog";
import { DeliveryDialog } from "@/components/jobs/production/delivery-dialog";
import { PaymentDialog } from "@/components/jobs/production/payment-dialog";
import { canUndoDirect, decideProposal, isDirectAction, runDirectAction, undoDirectAction, type DirectResult } from "@/components/jobs/flow-direct";
import {
  decideOrderChange, proposeFlowChange, registerOrderChange, requestOrderFix, setInquiryStatus, setOrderStatus,
  setQuoteState,
} from "@/app/actions/flow-status";
import { extendQuoteValidity } from "@/app/actions/job-flow";
import {
  FLOW_ACTIONS, QUICK_NOTES, deriveFlow, isOurReason, lostReasonsFor, menuActions, nextAction, pragueToday, stageEffect, stageEffectText,
  type ActionCtx, type FlowActionKey, type FlowFacts, type FlowSnapshot, type JobStamps, type LostReason, type QuoteFacts,
} from "@/lib/jobs/flow-status";
import type { Feature } from "@/lib/auth/permissions";
import type { JobDetail, JobQuote } from "@/lib/jobs/types";
import type { OrderMismatchKind, UserRole } from "@/lib/supabase/database.types";
import type { OrderRevision } from "@/lib/data/flow-status";
import { cn } from "@/lib/utils";
import { useJobDetail } from "./detail-context";
import { ConfirmDialog, DialogHead, ErrorBox } from "./confirm-dialog";
import { QuoteSendDialog } from "./quote-send-dialog";
import { QuoteReturnDialog } from "@/components/flow/quote-return-dialog";
import { QuoteApproveSendDialog } from "@/components/flow/quote-approve-send-dialog";
import { approvedToast } from "@/components/flow/quote-approval-copy";
import { DETAIL_TABS_ID, addDaysIso, type DetailTab } from "./detail-helpers";
import { useSettledRefresh } from "@/components/jobs/use-settled-refresh";

/**
 * Akce podrobných stavů na kartě zakázky: jeden poskytovatel drží fakta toku (deriveFlow),
 * další krok (nextAction), menu „⋯" (menuActions) a všechny dialogy. Hlavička, záložka Nabídky
 * i odkaz z Knihy (?akce=…) spouštějí akce přes run(key) — stejný dialog odkudkoli.
 */

export interface FlowAccess {
  features: Feature[];
  userId: string | null;
  role: UserRole | null;
}

type Next = { key: FlowActionKey; label: string } | null;

interface FlowActionsValue {
  facts: FlowFacts | null;
  snapshot: FlowSnapshot | null;
  quotes: QuoteFacts[];
  ctx: ActionCtx;
  next: Next;
  menu: FlowActionKey[];
  stamps: JobStamps | null;
  /** Spustí akci: přímá se provede (s oznámením), jinak se otevře její dialog / záložka. */
  run: (key: FlowActionKey, opts?: { quoteId?: string }) => void;
  /** Přímá akce s výsledkem (tlačítko dalšího kroku s „Vrátit"). */
  runDirect: (key: FlowActionKey, opts?: { quoteId?: string }) => Promise<DirectResult | null>;
  undo: ((key: FlowActionKey) => Promise<DirectResult>) | null;
  canUndo: (key: FlowActionKey) => boolean;
  /** Počítadlo pokynů „Vytvořit nabídku" (záložka Nabídky otevře editor). */
  newQuoteSignal: number;
  /** Toast po „Schválit“ aktivní nabídky (§13: „Nabídka {č.} schválena — {autor} ji teď může odeslat.“). */
  approveToast: string;
}

const FlowActionsContext = React.createContext<FlowActionsValue | null>(null);

export function useFlowActions(): FlowActionsValue | null {
  return React.useContext(FlowActionsContext);
}

type DialogState = { key: FlowActionKey; quoteId?: string } | null;

const MISMATCH_KINDS: { kind: OrderMismatchKind; label: string }[] = [
  { kind: "cena", label: "Cena" },
  { kind: "mnozstvi", label: "Množství" },
  { kind: "revize_vykresu", label: "Revize výkresu" },
  { kind: "termin", label: "Termín" },
  { kind: "chybi_polozka", label: "Chybí položka" },
  { kind: "polozka_navic", label: "Položka navíc" },
  { kind: "platebni_podminky", label: "Platební podmínky" },
  { kind: "jine", label: "Jiné" },
];

/** Záložka, kam vede odkazová akce (v kartě se přepne bez načtení stránky). */
const TAB_OF: Partial<Record<FlowActionKey, DetailTab>> = {
  "pricing.open": "polozky",
  "pricing.supplierPrice": "nakup",
  "quote.create": "nabidky",
  "quote.edit": "nabidky",
  "production.plan": "vyroba",
  "delivery.confirmNote": "vyroba",
  "payment.invoice": "vyroba",
};

const DIRECT_OK: Partial<Record<FlowActionKey, string>> = {
  "inquiry.take": "Poptávka převzata — řešíš ji ty.",
  "inquiry.resume": "Podklady máme — poptávka je zase v řešení.",
  "inquiry.reopen": "Poptávka obnovena.",
  "quote.requestApproval": "Nabídka předána ke schválení.",
  "quote.approve": "Nabídka schválena — můžeš ji odeslat.",
  "quote.answerNoChange": "Odpověď bez změny nabídky zapsána.",
  "quote.accept": "Zákazník objednal — nabídka je přijatá.",
  "quote.reopen": "Zákazník se vrátil — nabídka je zase odeslaná.",
  "quote.newRevision": "Vytvořena nová verze nabídky (stará se archivovala).",
  "order.reopen": "Objednávka obnovena.",
};

/** Toast po schválení z karty: „Nabídka {č.} schválena — {autor} ji teď může odeslat.“ */
function approvedToastOf(q: JobQuote | null): string {
  return approvedToast(q?.number ?? null, q?.createdBy?.name ?? null);
}

export function FlowActionsProvider({
  job, stamps, revisions, access, setTab, initialAction, children,
}: {
  job: JobDetail;
  stamps: JobStamps | null;
  revisions?: OrderRevision[];
  access?: FlowAccess | null;
  setTab: (tab: DetailTab) => void;
  /** Akce z odkazu (?akce=…) — otevře se po načtení. */
  initialAction?: string | null;
  children: React.ReactNode;
}) {
  const { jobId, notify, perms } = useJobDetail();
  const settle = useSettledRefresh();
  const client = useAccess();
  const [dialog, setDialog] = React.useState<DialogState>(null);
  const [confirmTake, setConfirmTake] = React.useState<string | null>(null);
  const [newQuoteSignal, setNewQuoteSignal] = React.useState(0);

  const features = access?.features?.length ? access.features : client.features;
  const userId = access?.userId ?? client.userId ?? "";
  const role = access?.role ?? client.role;
  const ctx = React.useMemo<ActionCtx>(() => ({
    can: (f) => features.includes(f),
    userId,
    isSuperAdmin: role === "super_admin",
    assigneeId: job.assignee?.id ?? null,
    assigneeName: job.assignee?.name ?? null,
    ownerId: job.owner?.id ?? null,
    // karta umí dialog „Vrátit k přepracování…“ (#25)
    withReturn: true,
  }), [features, userId, role, job.assignee, job.owner]);

  const facts = React.useMemo(() => (job.flow ? { ...job.flow, stage: job.stage } : null), [job.flow, job.stage]);
  const quotes = React.useMemo(() => job.flowQuotes ?? [], [job.flowQuotes]);
  const snapshot = React.useMemo(() => (facts ? deriveFlow(facts, quotes, pragueToday()) : null), [facts, quotes]);
  const next = facts && snapshot ? nextAction(facts, snapshot, ctx) : null;
  const menu = React.useMemo(() => {
    if (!facts || !snapshot) return [];
    // „Potvrdit objednávku" je primární tlačítko s vlastním dialogem; ostatní bez duplicity s primárním
    return menuActions(facts, snapshot, ctx).filter((k) => k !== next?.key);
  }, [facts, snapshot, ctx, next?.key]);

  const activeQuoteId = snapshot?.activeQuote?.id ?? null;
  const directCtx = React.useCallback((quoteId?: string, force?: boolean) => ({
    jobId,
    quoteId: quoteId ?? activeQuoteId,
    reopenOrderTo: facts?.orderConfirmedRevision ? "potvrzena" as const : "dorucena" as const,
    waitingNote: facts?.waitingNote ?? null,
    force,
    // „Schválit“ projde jen nabídka, jakou uživatel na kartě vidí (mezitím upravenou server odmítne)
    expectedUpdatedAt: quotes.find((q) => q.id === (quoteId ?? activeQuoteId))?.updatedAt ?? null,
  }), [jobId, activeQuoteId, facts?.orderConfirmedRevision, facts?.waitingNote, quotes]);

  const runDirect = React.useCallback(async (key: FlowActionKey, opts: { quoteId?: string } = {}) => {
    const res = await runDirectAction(key, directCtx(opts.quoteId));
    if (res?.needsConfirm) {
      setConfirmTake(res.needsConfirm);
      return { ok: true, needsConfirm: res.needsConfirm };
    }
    if (res?.ok) settle();
    return res;
  }, [directCtx, settle]);

  const run = React.useCallback((key: FlowActionKey, opts: { quoteId?: string } = {}) => {
    const tab = TAB_OF[key];
    if (tab) {
      setTab(tab === "nakup" && !perms.margins ? "polozky" : tab);
      if (key === "quote.create") setNewQuoteSignal((n) => n + 1);
      // vždy viditelná odezva: posun na cílovou kartu / záložky (na mobilu jsou daleko pod hlavičkou)
      const target = key === "delivery.confirmNote" || key === "payment.invoice" ? "konec-toku" : DETAIL_TABS_ID;
      window.setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      return;
    }
    if (FLOW_ACTIONS[key].kind === "direct" && isDirectAction(key)) {
      void runDirect(key, opts).then((res) => {
        if (!res) return;
        if (!res.ok) notify("error", res.error ?? "Akce se nepovedla.");
        else if (key === "quote.approve") notify("success", approvedToastOf(job.quotes.find((q) => q.id === (opts.quoteId ?? activeQuoteId)) ?? null));
        else if (DIRECT_OK[key] && !res.needsConfirm) notify("success", DIRECT_OK[key]!);
      }).catch(() => notify("error", "Spojení se nepovedlo — zkus to znovu."));
      return;
    }
    setDialog({ key, quoteId: opts.quoteId });
  }, [setTab, perms.margins, runDirect, notify, job.quotes, activeQuoteId]);

  const undo = React.useCallback(async (key: FlowActionKey) => {
    const res = await undoDirectAction(key, directCtx());
    if (res.ok) settle();
    return res;
  }, [directCtx, settle]);

  // akce z odkazu Knihy / tabule (?akce=…) — jednou po načtení
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (opened.current || !initialAction || !(initialAction in FLOW_ACTIONS)) return;
    opened.current = true;
    const key = initialAction as FlowActionKey;
    if (!ctx.can(FLOW_ACTIONS[key].feature) || !features.length) {
      if (!features.length) opened.current = false;
      return;
    }
    run(key);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("akce");
      url.searchParams.delete("nova");
      // bez stavu Next.js → router si novou adresu převezme (jinak by ji router.refresh vrátil i s ?nova=1
      // a obnovení stránky by editor / dialog otevřelo znovu)
      window.history.replaceState(null, "", url.toString());
    } catch {
      // adresa je jen pohodlí
    }
  }, [initialAction, ctx, features.length, run]);

  const approveToast = approvedToastOf(job.quotes.find((q) => q.id === activeQuoteId) ?? null);
  const value = React.useMemo<FlowActionsValue>(() => ({
    facts, snapshot, quotes, ctx, next, menu, stamps, run, runDirect, undo, canUndo: canUndoDirect, newQuoteSignal, approveToast,
  }), [facts, snapshot, quotes, ctx, next, menu, stamps, run, runDirect, undo, newQuoteSignal, approveToast]);

  const close = (o: boolean) => !o && setDialog(null);
  const quoteOf = (id?: string | null): JobQuote | null => job.quotes.find((q) => q.id === (id ?? activeQuoteId)) ?? null;
  const done = (message: string) => {
    notify("success", message);
    settle();
  };

  return (
    <FlowActionsContext.Provider value={value}>
      {children}
      {dialog && facts && (
        <FlowDialog
          key={`${dialog.key}:${dialog.quoteId ?? ""}`}
          state={dialog}
          job={job}
          facts={facts}
          quotes={quotes}
          revisions={revisions ?? []}
          quote={quoteOf(dialog.quoteId)}
          margins={perms.margins}
          onClose={close}
          onDone={done}
          onSwitch={(key) => setDialog({ key, quoteId: dialog.quoteId })}
          setTab={setTab}
        />
      )}
      <ConfirmDialog
        open={confirmTake !== null}
        onOpenChange={(o) => !o && setConfirmTake(null)}
        icon={UserRoundCheck}
        tone="bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
        title={confirmTake ?? "Převzít poptávku?"}
        confirmLabel="Ano, převzít"
        onConfirm={async () => {
          const res = await runDirectAction("inquiry.take", directCtx(undefined, true));
          if (!res?.ok) return res?.error ?? "Převzetí se nepovedlo.";
          done(DIRECT_OK["inquiry.take"]!);
          return null;
        }}
      >
        Poptávku teď řeší někdo jiný. Po převzetí budeš řešitelem ty a v historii bude „převzato od…“.
      </ConfirmDialog>
    </FlowActionsContext.Provider>
  );
}

// ── Dialogy akcí ────────────────────────────────────────────
interface ReasonConfig {
  title: string;
  description?: string;
  phase?: "inquiry" | "quote" | "order" | "job";
  to?: string;
  reasons?: LostReason[];
  requireNote?: boolean;
  noteLabel?: string;
  notePlaceholder?: string;
  quickNotes?: readonly string[];
  destructive?: boolean;
  confirmLabel: string;
  effect?: string[];
  run: (v: ReasonDialogResult) => Promise<{ ok: boolean; error?: string }>;
  success: string;
}

function FlowDialog({
  state, job, facts, quotes, revisions, quote, margins, onClose, onDone, onSwitch, setTab,
}: {
  state: { key: FlowActionKey; quoteId?: string };
  job: JobDetail;
  facts: FlowFacts;
  quotes: QuoteFacts[];
  revisions: OrderRevision[];
  quote: JobQuote | null;
  margins: boolean;
  onClose: (open: boolean) => void;
  onDone: (message: string) => void;
  onSwitch: (key: FlowActionKey) => void;
  setTab: (tab: DetailTab) => void;
}) {
  const jobId = job.id;
  const key = state.key;
  const qid = quote?.id ?? null;
  const qLabel = quote ? `${quote.number}${quote.revision > 1 && !/-R?\d+$/i.test(quote.number) ? ` r${quote.revision}` : ""}` : "nabídka";
  const others = quotes.filter((q) => q.id !== qid && !q.archived && (q.status === "navrh_ai" || q.status === "ke_schvaleni" || q.status === "odeslano"));
  const effectOf = (change: Parameters<typeof stageEffect>[2]) => stageEffectText(stageEffect(facts, quotes, change));

  const confirmJob = {
    id: job.id, number: job.number, title: job.title, customerName: job.customer?.name ?? null,
    customerOrderNumber: job.customerOrderNumber, customerRequiredDate: job.customerRequiredDate, dueDate: job.dueDate,
    email: job.customerContactEmail ?? job.customerDetail?.email ?? null, orderStatus: facts.orderStatus, orderRevision: facts.orderRevision,
  };

  const reason: Partial<Record<FlowActionKey, ReasonConfig>> = {
    "inquiry.wait": {
      title: "Čeká na podklady", description: "Napiš, co chybí. Stav skončí sám, jakmile k zakázce přijde výkres, model, poptávka nebo foto.",
      reasons: [], requireNote: true, noteLabel: "Co chybí", notePlaceholder: "Ťukni nebo dopiš, např. výkres ve STEP", quickNotes: QUICK_NOTES.waiting, destructive: false,
      confirmLabel: "Čeká na podklady", run: ({ note }) => setInquiryStatus(jobId, "ceka_na_podklady", { note }), success: "Poptávka čeká na podklady.",
    },
    "inquiry.decline": {
      title: "Odmítnout poptávku", description: "Odmítáme my (nevyrábíme, kapacita…). Zakázka se uzavře jako nerealizovaná.",
      phase: "inquiry", to: "odmitnuta", confirmLabel: "Odmítnout poptávku", effect: effectOf({ kind: "inquiry", to: "odmitnuta" }),
      run: ({ reason: r, note }) => setInquiryStatus(jobId, "odmitnuta", { reason: r, note }), success: "Poptávka odmítnuta.",
    },
    "inquiry.withdraw": {
      title: "Zákazník poptávku stáhl", description: "Zákazník už nemá zájem nebo neodpovídá.",
      phase: "inquiry", to: "stazena", confirmLabel: "Poptávka stažena", effect: effectOf({ kind: "inquiry", to: "stazena" }),
      run: ({ reason: r, note }) => setInquiryStatus(jobId, "stazena", { reason: r, note }), success: "Poptávka označena jako stažená.",
    },
    "inquiry.propose": {
      title: "Navrhnout odmítnutí poptávky", description: "Rozhodne obchodník nebo admin — uvidí tvůj návrh u zakázky s ✓ / ✕.",
      phase: "inquiry", reasons: lostReasonsFor("inquiry"), destructive: false, confirmLabel: "Odeslat návrh",
      run: ({ reason: r, note }) => proposeFlowChange(jobId, { phase: "inquiry", to: r && isOurReason(r) ? "odmitnuta" : "stazena", reason: r, note }),
      success: "Návrh odeslán — rozhodne obchodník.",
    },
    "quote.markSent": {
      title: `Odesláno jinak — ${qLabel}`, description: "Nabídka odešla osobně, poštou nebo z jiné schránky.",
      reasons: [], destructive: false, noteLabel: "Jak a komu", notePlaceholder: "např. předáno osobně p. Novákovi", confirmLabel: "Označit jako odeslanou",
      run: ({ note }) => setQuoteState(qid ?? "", "odeslana", { note }), success: `Nabídka ${qLabel} označena jako odeslaná.`,
    },
    "quote.feedback": {
      title: `Připomínky zákazníka — ${qLabel}`, reasons: [], requireNote: true, destructive: false, noteLabel: "Co zákazník připomínkuje",
      confirmLabel: "Zapsat připomínky", run: ({ note }) => setQuoteState(qid ?? "", "pripominky", { feedback: note }),
      success: "Připomínky zapsány — další krok je nová verze nabídky.",
    },
    "quote.unapprove": {
      title: `Vrátit k úpravě — ${qLabel}`,
      description: quote?.adminApprovalRequired || quote?.aiGenerated
        ? "Schválení se zruší — nabídka bude zase neschválená a odeslat ji půjde až po novém schválení."
        : "Schválení se zruší, nabídka bude zase rozpracovaná.",
      reasons: [], destructive: false, noteLabel: "Co upravit", confirmLabel: "Vrátit k úpravě",
      run: ({ note }) => setQuoteState(qid ?? "", "rozpracovana", { note }), success: "Nabídka vrácena k úpravě.",
    },
    "quote.reject": {
      title: `Zákazník nabídku zamítl — ${qLabel}`, description: "Důvod pomůže příště lépe nacenit (učí se z něj i AI).",
      phase: "quote", to: "zamitnuta", confirmLabel: "Zamítnuta",
      effect: others.length ? [`Zakázka zůstává otevřená (další verze: ${others.length})`] : ["Zakázka → Nerealizováno (žádná jiná otevřená nabídka)"],
      run: ({ reason: r, note }) => setQuoteState(qid ?? "", "zamitnuta", { reason: r, note }), success: `Nabídka ${qLabel} zamítnuta.`,
    },
    "quote.propose": {
      title: `Navrhnout zamítnutí — ${qLabel}`, description: "Rozhodne obchodník nebo admin.",
      phase: "quote", to: "zamitnuta", destructive: false, confirmLabel: "Odeslat návrh",
      run: ({ reason: r, note }) => proposeFlowChange(jobId, { phase: "quote", to: "zamitnuta", quoteId: qid, reason: r, note }),
      success: "Návrh odeslán — rozhodne obchodník.",
    },
    "order.confirmOther": {
      title: "Potvrzeno jinak", description: "Objednávku jsme potvrdili telefonem, osobně nebo z jiné schránky — bez dokladu z aplikace.",
      reasons: [], requireNote: true, destructive: false, noteLabel: "Jak bylo potvrzeno", notePlaceholder: "Ťukni nebo dopiš, např. p. Dvořákovi",
      quickNotes: QUICK_NOTES.confirmedHow, confirmLabel: "Potvrzeno",
      run: ({ note }) => setOrderStatus(jobId, "potvrzena", { note }), success: "Objednávka potvrzena.",
    },
    "order.requestFix": {
      title: "Požádat zákazníka o opravu", description: "Chip pak ukáže, kolik dní čekáme na opravenou objednávku.",
      reasons: [], destructive: false, noteLabel: "Co opravit", confirmLabel: "Zapsat žádost o opravu",
      run: ({ note }) => requestOrderFix(jobId, { note }), success: "Žádost o opravu zapsána.",
    },
    "order.registerChange": {
      title: "Zákazník změnil objednávku", description: "Vznikne nová revize; položky se nepřepíšou — změnu pak potvrdíš nebo odmítneš.",
      reasons: [], requireNote: true, destructive: false, noteLabel: "Co se mění", notePlaceholder: "Ťukni nebo dopiš, např. 120 → 150 ks",
      quickNotes: QUICK_NOTES.orderChange,
      confirmLabel: "Zapsat změnu", run: ({ note }) => registerOrderChange(jobId, { note }), success: "Změna objednávky zapsána (nová revize).",
    },
    "order.rejectChange": {
      title: `Změnu nepřijímáme (rev ${facts.orderRevision})`, description: "Platí dál potvrzená verze. Zákazník důvod uvidí v potvrzení.",
      reasons: [], requireNote: true, destructive: false, noteLabel: "Proč", confirmLabel: "Změnu nepřijímáme",
      run: ({ note }) => decideOrderChange(jobId, false, { note }), success: "Změna odmítnuta — platí potvrzená verze.",
    },
    "order.cancel": {
      title: "Stornovat objednávku", description: "Zákazník objednávku zrušil.",
      phase: "order", to: "stornovana", confirmLabel: "Stornovat", effect: effectOf({ kind: "order", to: "stornovana" }),
      run: ({ reason: r, note }) => setOrderStatus(jobId, "stornovana", { reason: r, note }), success: "Objednávka stornována.",
    },
    "order.propose": {
      title: "Navrhnout storno objednávky", description: "Rozhodne obchodník nebo admin.",
      phase: "order", to: "stornovana", destructive: false, confirmLabel: "Odeslat návrh",
      run: ({ reason: r, note }) => proposeFlowChange(jobId, { phase: "order", to: "stornovana", reason: r, note }),
      success: "Návrh odeslán — rozhodne obchodník.",
    },
  };

  const cfg = reason[key];
  if (cfg) {
    return (
      <ReasonDialog
        open
        onOpenChange={onClose}
        title={cfg.title}
        description={cfg.description}
        phase={cfg.phase}
        to={cfg.to}
        reasons={cfg.reasons}
        requireNote={cfg.requireNote}
        noteLabel={cfg.noteLabel}
        notePlaceholder={cfg.notePlaceholder}
        quickNotes={cfg.quickNotes}
        destructive={cfg.destructive ?? true}
        confirmLabel={cfg.confirmLabel}
        effect={cfg.effect}
        onConfirm={async (v) => {
          const res = await cfg.run(v);
          if (res.ok) onDone(cfg.success);
          return res;
        }}
      />
    );
  }

  const latest = [...revisions].sort((a, b) => b.revision - a.revision)[0] ?? null;

  switch (key) {
    case "quote.approveSend":
      // #25: schválení + PDF + e-mail jedním krokem na serveru (zavřením se nic neschválí)
      return quote ? (
        <QuoteApproveSendDialog open onOpenChange={onClose} jobId={jobId} quoteId={quote.id} number={qLabel} updatedAt={quote.updatedAt ?? null} onDone={onDone} />
      ) : <MissingQuote onClose={onClose} />;
    case "quote.send":
      if (!quote) return <MissingQuote onClose={onClose} />;
      return (
        <QuoteSendDialog
          open
          onOpenChange={onClose}
          quote={quote}
          fallback={{ to: job.customerContactEmail ?? job.customerDetail?.email ?? "", jobNumber: job.number, title: job.title, contact: job.customerContact }}
        />
      );
    case "quote.extend":
      return quote ? <ExtendDialog quote={quote} onClose={onClose} onDone={onDone} /> : <MissingQuote onClose={onClose} />;
    case "quote.returnToAuthor":
      return quote ? (
        <QuoteReturnDialog
          open
          onOpenChange={onClose}
          quoteId={quote.id}
          number={qLabel}
          author={quote.createdBy?.name ?? null}
          onDone={onDone}
        />
      ) : <MissingQuote onClose={onClose} />;
    case "order.confirm":
    case "order.sendConfirmation":
      return (
        <ConfirmOrderDialog
          open
          onOpenChange={onClose}
          job={confirmJob}
          mode={key === "order.sendConfirmation" || facts.orderStatus === "potvrzena" ? "send" : "confirm"}
          mismatch={facts.orderStatus === "rozpor" ? facts.orderMismatch?.items ?? null : null}
          onDone={() => onDone(key === "order.confirm" ? "Objednávka potvrzena." : "Potvrzení odesláno.")}
        />
      );
    case "order.resolveMismatch":
      return <ResolveMismatchDialog facts={facts} jobId={jobId} onClose={onClose} onDone={onDone} onSwitch={onSwitch} />;
    case "order.flagMismatch":
      return <FlagMismatchDialog jobId={jobId} onClose={onClose} onDone={onDone} />;
    case "order.decideChange":
      return (
        <ReasonDialog
          open
          onOpenChange={onClose}
          title={`Potvrdit změnu objednávky (rev ${facts.orderRevision})`}
          description="Změnu přijmeme a objednávka bude zase potvrzená. Položky se samy nepřepíšou — uprav je podle změny (záložka Položky), pak odešli nové potvrzení."
          reasons={[]}
          destructive={false}
          confirmLabel="Potvrdit změnu"
          onConfirm={async ({ note }) => {
            const res = await decideOrderChange(jobId, true, { note });
            if (res.ok) {
              onDone(`Změna potvrzena — uprav položky podle rev ${facts.orderRevision}, pak odešli potvrzení.`);
              onSwitch("order.sendConfirmation");
            }
            return res;
          }}
        >
          {latest && <RevisionSummary revision={latest} />}
          <button type="button" onClick={() => onSwitch("order.rejectChange")} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">
            Změnu nepřijímáme…
          </button>
        </ReasonDialog>
      );
    case "delivery.record":
    case "delivery.closeShort":
    case "delivery.partialNote":
      return (
        <DeliveryDialog
          open
          onOpenChange={onClose}
          jobId={jobId}
          items={job.items}
          mode={key === "delivery.closeShort" ? "closeShort" : key === "delivery.partialNote" ? "partialNote" : "record"}
          onDone={onDone}
          onSplitItems={() => setTab("polozky")}
        />
      );
    case "payment.record":
    case "payment.settle":
      return (
        <PaymentDialog
          open
          onOpenChange={onClose}
          jobId={jobId}
          margins={margins}
          settle={key === "payment.settle"}
          value={job.value}
          paidSoFar={facts.paidSoFar}
          currency={job.currency}
          onDone={onDone}
        />
      );
    case "job.correct":
      return (
        <StagePickerDialog open onOpenChange={onClose} jobId={jobId} stage={job.stage} flow={facts} quotes={quotes} onDone={() => onDone("Stav opraven.")} />
      );
    case "proposal.decide":
      return facts.proposal ? (
        <Dialog open onOpenChange={onClose}>
          <DialogContent aria-describedby={undefined} className="w-[calc(100%-1.5rem)] sm:max-w-md">
            <DialogHead icon={Hand} tone="bg-muted text-muted-foreground" title="Rozhodnout návrh" subtitle="✓ provede navrženou změnu s poznámkou „na návrh: …“, ✕ návrh zahodí." />
            <div className="p-5">
              <ProposalChip
                proposal={facts.proposal}
                canDecide
                onDecide={async (accept) => {
                  const res = await decideProposal(jobId, accept);
                  if (res.ok) {
                    onDone(accept ? "Návrh přijat a proveden." : "Návrh zamítnut.");
                    onClose(false);
                  }
                  return res;
                }}
              />
            </div>
          </DialogContent>
        </Dialog>
      ) : null;
    default:
      return null;
  }
}

function MissingQuote({ onClose }: { onClose: (o: boolean) => void }) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent aria-describedby={undefined} className="w-[calc(100%-1.5rem)] sm:max-w-md">
        <DialogHead icon={Mail} tone="bg-muted text-muted-foreground" title="Zakázka nemá aktivní nabídku" />
        <p className="p-5 text-sm text-muted-foreground">Vytvoř nabídku v záložce Nabídky.</p>
      </DialogContent>
    </Dialog>
  );
}

function RevisionSummary({ revision }: { revision: OrderRevision }) {
  const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
  return (
    <div className="space-y-1 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 text-sm dark:border-indigo-500/30 dark:bg-indigo-500/10">
      <p className="flex items-center gap-1.5 font-medium text-indigo-900 dark:text-indigo-100">
        <RefreshCw className="h-4 w-4" aria-hidden /> Rev {revision.revision}
        {revision.customerOrderNumber && <span className="font-mono text-xs">· {revision.customerOrderNumber}</span>}
      </p>
      {revision.changes.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {revision.changes.map((c, i) => (
            <li key={`${c.field}-${i}`}>
              <span className="font-medium">{c.label}:</span> <span className="text-muted-foreground line-through">{fmt(c.from)}</span> → {fmt(c.to)}
            </li>
          ))}
        </ul>
      )}
      {revision.note && <p className="whitespace-pre-wrap text-xs">{revision.note}</p>}
      <ActorStamp stamp={revision.created} verb="Zápis změny" />
    </div>
  );
}

function ResolveMismatchDialog({
  facts, jobId, onClose, onDone, onSwitch,
}: {
  facts: FlowFacts;
  jobId: string;
  onClose: (o: boolean) => void;
  onDone: (m: string) => void;
  onSwitch: (k: FlowActionKey) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const items = facts.orderMismatch?.items ?? [];
  return (
    <Dialog open onOpenChange={(o) => !busy && onClose(o)}>
      <DialogContent aria-describedby={undefined} className="top-[3%] w-[calc(100%-1rem)] sm:top-[10%] sm:max-w-lg">
        <DialogHead icon={GitCompare} tone="bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" title="Vyřešit rozpor s nabídkou" />
        <div className="space-y-4 p-4 sm:p-5">
          {items.length > 0 && <MismatchList items={items} />}
          <ErrorBox error={error} />
          <div className="grid gap-2">
            <Button type="button" variant="success" className="h-11 justify-start" disabled={busy} onClick={() => onSwitch("order.confirm")}>
              Přijmout, jak je — potvrdit objednávku
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 justify-start"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const res = await setOrderStatus(jobId, "dorucena").catch(() => ({ ok: false, error: "Spojení se nepovedlo." }));
                setBusy(false);
                if (!res.ok) return setError(res.error ?? "Nepovedlo se.");
                onDone("Opravená objednávka přišla — znovu k potvrzení.");
                onClose(false);
              }}
            >
              {busy && <Loader2 className="animate-spin" />} Přišla opravená objednávka
            </Button>
            <Button type="button" variant="ghost" className="h-11 justify-start" disabled={busy} onClick={() => onSwitch("order.requestFix")}>
              <Mail /> Požádat zákazníka o opravu…
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FlagMismatchDialog({ jobId, onClose, onDone }: { jobId: string; onClose: (o: boolean) => void; onDone: (m: string) => void }) {
  const [kinds, setKinds] = React.useState<OrderMismatchKind[]>([]);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const noteId = React.useId();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!kinds.length) return setError("Vyber, v čem se objednávka liší.");
    setBusy(true);
    setError(null);
    try {
      const items = kinds.map((k) => ({ kind: k, label: MISMATCH_KINDS.find((m) => m.kind === k)?.label ?? "Rozdíl", order: note.trim() || null }));
      const res = await setOrderStatus(jobId, "rozpor", { mismatch: { items } });
      if (!res.ok) return setError(res.error ?? "Nepovedlo se.");
      onDone("Rozpor s nabídkou zapsán.");
      onClose(false);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !busy && onClose(o)}>
      <DialogContent aria-describedby={undefined} className="top-[3%] w-[calc(100%-1rem)] sm:top-[10%] sm:max-w-lg">
        <DialogHead icon={GitCompare} tone="bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" title="Rozpor objednávky s nabídkou" />
        <form onSubmit={submit} className="space-y-4 p-4 sm:p-5">
          <ErrorBox error={error} />
          <div role="group" aria-label="V čem se liší" className="grid grid-cols-2 gap-2">
            {MISMATCH_KINDS.map((m) => {
              const on = kinds.includes(m.kind);
              return (
                <button
                  key={m.kind}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setKinds((k) => (on ? k.filter((x) => x !== m.kind) : [...k, m.kind]))}
                  className={cn("min-h-11 rounded-lg border px-3 text-left text-sm", on ? "border-foreground bg-foreground text-background" : "hover:bg-accent")}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          <div className="space-y-1">
            <label htmlFor={noteId} className="text-xs font-medium text-muted-foreground">Podrobnosti (nepovinné)</label>
            <Textarea id={noteId} rows={2} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="např. objednáno 150 ks místo 120" />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" className="h-11 sm:h-9" onClick={() => onClose(false)} disabled={busy}>Zpět</Button>
            <Button type="submit" variant="destructive" className="h-11 sm:h-9" disabled={busy || !kinds.length}>
              {busy && <Loader2 className="animate-spin" />} Zapsat rozpor
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ExtendDialog({ quote, onClose, onDone }: { quote: JobQuote; onClose: (o: boolean) => void; onDone: (m: string) => void }) {
  const base = quote.validUntil && quote.validUntil > pragueToday() ? quote.validUntil : pragueToday();
  const [date, setDate] = React.useState(addDaysIso(base, 14));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  return (
    <Dialog open onOpenChange={(o) => !busy && onClose(o)}>
      <DialogContent aria-describedby={undefined} className="w-[calc(100%-1.5rem)] sm:max-w-sm">
        <DialogHead icon={CalendarPlus} tone="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" title={`Prodloužit platnost ${quote.number}`} />
        <form
          className="space-y-3 p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const res = await extendQuoteValidity(quote.id, date).catch(() => ({ ok: false, error: "Spojení se nepovedlo." }));
            setBusy(false);
            if (!res.ok) return setError(res.error ?? "Nepovedlo se.");
            onDone("Platnost nabídky prodloužena.");
            onClose(false);
          }}
        >
          <ErrorBox error={error} />
          <div className="flex flex-wrap gap-1.5">
            {[7, 14, 30].map((d) => (
              <button key={d} type="button" onClick={() => setDate(addDaysIso(base, d))} className="min-h-9 rounded-full bg-muted px-3 text-xs hover:bg-accent">+{d} dní</button>
            ))}
          </div>
          <label htmlFor={id} className="block text-xs font-medium text-muted-foreground">Platnost do</label>
          <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 sm:h-10" required />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onClose(false)} disabled={busy}>Zpět</Button>
            <Button type="submit" disabled={busy || !date}>{busy && <Loader2 className="animate-spin" />} Prodloužit</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
