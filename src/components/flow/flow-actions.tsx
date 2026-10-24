"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ellipsis, Loader2, ThumbsUp, Undo2, UserRoundCheck, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/jobs/detail/confirm-dialog";
import { useNotify } from "@/components/jobs/detail/toast";
import { ReasonDialog } from "@/components/flow-status/reason-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProposalChip } from "@/components/flow-status/proposal-chip";
import {
  decideFlowProposal, decideOrderChange, proposeFlowChange, registerOrderChange, requestOrderFix, setInquiryStatus,
  setOrderStatus, setQuoteState, takeInquiry,
} from "@/app/actions/flow-status";
import { newJobQuoteRevision } from "@/app/actions/jobs";
import { extendQuoteValidity } from "@/app/actions/flow-pages";
import { UNDO_MS } from "@/components/flow-status/next-action-button";
import {
  FLOW_ACTIONS, FLOW_PALETTE, QUICK_NOTES, isOurReason, quoteLabel, stageEffect, stageEffectText,
  type ChangeStamp, type FlowActionKey, type FlowFacts, type PaletteKey, type QuoteFacts,
} from "@/lib/jobs/flow-status";
import { stageMeta } from "@/lib/jobs/stages";
import type { FlowProposal, LostReason } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { ConfirmOrderDialog, type ConfirmJob, type ConfirmMode } from "./confirm-order-dialog";
import { DocumentSendDialog } from "./document-send-dialog";
import { DecideChangeDialog, ExtendQuoteDialog, MismatchEditDialog, ProposalDecisionDialog, ResolveMismatchDialog } from "./order-dialogs";
import { flowActionHref, pageMenu, type NextStep, type OrderRevisionView } from "./flow-state";
import { QuoteReturnDialog } from "./quote-return-dialog";
import { QuoteApproveSendDialog } from "./quote-approve-send-dialog";
import { approvedToast } from "./quote-approval-copy";

/**
 * Akce řádku stránky toku: jedno primární tlačítko (sloveso dalšího kroku) + menu „⋯“.
 * Přímé akce se provedou hned a 8 s jdou vrátit, ostatní otevřou dialog (důvod jedním
 * ťuknutím, náhled dopadu). Bez práva se místo rozhodnutí nabízí „Navrhnout…“. Autora
 * každé změny zapíše DB z hlaviček serverové akce.
 */

type Result = { ok: boolean; error?: string };

export interface FlowActionTarget {
  jobId: string | null;
  jobNumber: string;
  /** Nabídka, které se akce nabídky týkají (řádek přehledu nebo aktivní nabídka zakázky). */
  quote?: QuoteFacts | null;
  /** Fakta zakázky (náhled dopadu, poznámka čekání, rozpor). */
  facts?: FlowFacts | null;
  /** Všechny nabídky zakázky (náhled dopadu odmítnutí). */
  quotes?: QuoteFacts[];
  /** Údaje pro dialog potvrzení objednávky. */
  confirm?: ConfirmJob | null;
  /** Poslední změna objednávky (rev N). */
  revision?: OrderRevisionView | null;
  /** Kdo zapsal poslední změnu objednávky. */
  orderChangeStamp?: ChangeStamp | null;
  proposal?: { value: FlowProposal; stamp: ChangeStamp | null; canDecide: boolean } | null;
  /** Jediná otevřená nabídka zakázky — zamítnutí zakázku uzavře. */
  onlyOpenQuote?: boolean;
  /** Autor nabídky (toast schválení / vrácení — #25). */
  quoteAuthor?: string | null;
  today: string;
}

type DialogKey = FlowActionKey | "take.confirm" | "order.acceptAsIs" | "order.sendAfterChange";

const DIRECT_DONE: Partial<Record<FlowActionKey, string>> = {
  "inquiry.take": "Poptávka převzata — je v řešení.",
  "inquiry.resume": "Podklady máme — poptávka je zase v řešení.",
  "inquiry.reopen": "Poptávka obnovena.",
  "quote.requestApproval": "Nabídka předána ke schválení.",
  "quote.approve": "Nabídka schválena — můžeš ji odeslat.",
  "quote.answerNoChange": "Odpověď bez změny nabídky zapsána.",
  "quote.reopen": "Zákazník se vrátil — nabídka je zase odeslaná.",
  "quote.newRevision": "Vytvořena nová verze nabídky (stará je v archivu).",
  "order.reopen": "Objednávka obnovena.",
};

/** Doplňková položka menu (PDF, otevřít zakázku, archivovat). */
export interface ExtraMenuItem {
  label: string;
  icon: LucideIcon;
  href?: string;
  /** Odkaz do nového panelu (PDF). */
  external?: boolean;
  onSelect?: () => void;
}

export function FlowActionBar({
  target, next, menu, exclude = [], palette, size = "sm", className, extraMenu = [], menuLabel, canPrice = false,
}: {
  /** Smí do Nacenění (#25 jen super admin) — „Vytvořit nabídku“ jinak vede rovnou do editoru nabídky. */
  canPrice?: boolean;
  target: FlowActionTarget;
  next: NextStep;
  menu: FlowActionKey[];
  /** Akce, které stránka řeší jinak (např. Nacenění vlastním panelem). */
  exclude?: FlowActionKey[];
  /** Barva primárního tlačítka v odstínu fáze. */
  palette?: PaletteKey;
  size?: "sm" | "default";
  className?: string;
  /** Položky menu mimo stavy (na konci). */
  extraMenu?: ExtraMenuItem[];
  /** Název tlačítka menu pro čtečky (výchozí „Další akce <číslo>“). */
  menuLabel?: string;
}) {
  const router = useRouter();
  const notify = useNotify();
  const [dialog, setDialog] = React.useState<DialogKey | null>(null);
  const [pending, setPending] = React.useState<FlowActionKey | null>(null);
  const [undo, setUndo] = React.useState<{ key: FlowActionKey; run: () => Promise<Result> } | null>(null);
  const [takeQuestion, setTakeQuestion] = React.useState<string | null>(null);
  const [changeNumber, setChangeNumber] = React.useState("");
  const [competitor, setCompetitor] = React.useState("");
  const timer = React.useRef<number | null>(null);
  React.useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const jobId = target.jobId;
  const q = target.quote ?? null;
  const items = pageMenu(menu, exclude);
  const primary = next && !exclude.includes(next.key) ? next : null;
  const f = target.facts ?? null;

  function refresh(text?: string) {
    if (text) notify("success", text);
    router.refresh();
  }

  async function guard(res: Result | void, text?: string): Promise<Result> {
    const r = res ?? { ok: true };
    if (!r.ok) notify("error", r.error ?? "Akce se nepovedla.");
    else refresh(text);
    return r;
  }

  function offerUndo(key: FlowActionKey, run: () => Promise<Result>) {
    setUndo({ key, run });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setUndo(null), UNDO_MS);
  }

  /** Přímé akce (jeden zápis). */
  async function direct(key: FlowActionKey): Promise<void> {
    if (!jobId && !q) return;
    setPending(key);
    try {
      let res: Result = { ok: false, error: "Akci tu nejde provést." };
      let back: (() => Promise<Result>) | null = null;
      if (key === "inquiry.take" && jobId) {
        const r = await takeInquiry(jobId);
        if (!r.ok && r.needsConfirm) {
          setTakeQuestion(r.needsConfirm);
          setDialog("take.confirm");
          return;
        }
        res = r;
      } else if (key === "inquiry.resume" && jobId) {
        res = await setInquiryStatus(jobId, "v_reseni");
        const waiting = f?.waitingNote?.trim() || "Podklady stále chybí.";
        back = () => setInquiryStatus(jobId, "ceka_na_podklady", { note: waiting });
      } else if (key === "inquiry.reopen" && jobId) {
        res = await setInquiryStatus(jobId, "v_reseni");
      } else if (key === "order.reopen" && jobId) {
        res = await setOrderStatus(jobId, "dorucena");
      } else if (q && key === "quote.requestApproval") {
        res = await setQuoteState(q.id, "ke_schvaleni");
        back = () => setQuoteState(q.id, "rozpracovana");
      } else if (q && key === "quote.approve") {
        const before = q.state;
        res = await setQuoteState(q.id, "schvalena", { expectedUpdatedAt: q.updatedAt ?? null });
        back = async () => {
          const r = await setQuoteState(q.id, "rozpracovana");
          if (r.ok && before === "ke_schvaleni" && r.quoteState === "rozpracovana") return setQuoteState(q.id, "ke_schvaleni");
          return r;
        };
      } else if (q && (key === "quote.answerNoChange" || key === "quote.reopen")) {
        res = await setQuoteState(q.id, "odeslana");
      } else if (q && key === "quote.newRevision") {
        res = await newJobQuoteRevision(q.id);
      }
      const text = key === "quote.approve" && q ? approvedToast(q.number, target.quoteAuthor ?? null) : DIRECT_DONE[key];
      const r = await guard(res, text);
      if (r.ok && back) offerUndo(key, back);
    } catch {
      notify("error", "Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setPending(null);
    }
  }

  const DIRECT_KEYS: FlowActionKey[] = [
    "inquiry.take", "inquiry.resume", "inquiry.reopen", "order.reopen", "quote.requestApproval", "quote.approve",
    "quote.answerNoChange", "quote.reopen", "quote.newRevision",
  ];

  function open(key: FlowActionKey) {
    setUndo(null);
    if (DIRECT_KEYS.includes(key)) return void direct(key);
    if (key === "order.registerChange") setChangeNumber("");
    if (key === "quote.reject") setCompetitor("");
    setDialog(key);
  }

  const close = (o: boolean) => {
    if (o) return;
    // navazující dialog po už provedeném zápisu (schváleno → odeslat, změna potvrzena → potvrzení): obnovit až teď
    if (dialog === "order.sendAfterChange") router.refresh();
    setDialog(null);
  };
  const effectOf = (change: Parameters<typeof stageEffect>[2]): string[] => {
    if (!f) return [];
    const e = stageEffect(f, target.quotes ?? [], change);
    const lines = stageEffectText(e);
    return e.stage ? [`Zakázka → ${stageMeta(e.stage).label}`, ...lines] : lines;
  };

  const confirmMode: ConfirmMode = dialog === "order.sendConfirmation" || dialog === "order.sendAfterChange" ? "send" : "confirm";
  const qName = q ? quoteLabel(q) : "";
  const primaryMeta = primary ? FLOW_ACTIONS[primary.key] : null;
  const href = primary && jobId ? flowActionHref(primary.key, jobId, { canPrice }) : null;
  // hover celým literálem palety → twMerge přebije hover:bg-foreground/90 výchozí varianty
  const tone = palette ? FLOW_PALETTE[palette] : null;
  const btnCls = cn("min-h-11 w-full gap-1.5 sm:min-h-9 sm:w-auto", tone && cn(tone.solid, tone.hover));
  const PrimaryIcon = primaryMeta?.icon;
  const safeItems = items.filter((k) => FLOW_ACTIONS[k].intent !== "danger");
  const dangerItems = items.filter((k) => FLOW_ACTIONS[k].intent === "danger");
  const menuItem = (k: FlowActionKey) => {
    const a = FLOW_ACTIONS[k];
    const Icon = a.icon;
    const to = jobId ? flowActionHref(k, jobId, { canPrice }) : null;
    return (
      <DropdownMenuItem
        key={k}
        className={cn("min-h-10", a.intent === "danger" && "text-red-600 focus:text-red-700 dark:text-red-400 [&_svg]:text-red-600 dark:[&_svg]:text-red-400")}
        onSelect={() => (to ? router.push(to) : open(k))}
      >
        <Icon aria-hidden />
        {a.label}
      </DropdownMenuItem>
    );
  };

  return (
    <div className={cn("flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap", className)}>
      {undo ? (
        <span className="inline-flex min-h-11 flex-1 items-center justify-between gap-2 rounded-md border px-3 text-sm sm:min-h-9 sm:flex-none" role="status">
          Hotovo
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-9 sm:min-h-7"
            onClick={async () => {
              const u = undo;
              setUndo(null);
              await guard(await u.run(), "Vráceno.");
            }}
          >
            <Undo2 className="h-4 w-4" aria-hidden /> Vrátit
          </Button>
        </span>
      ) : primary && primaryMeta && PrimaryIcon ? (
        href ? (
          <Button asChild size={size} className={cn(btnCls, "flex-1 sm:flex-none")}>
            <Link href={href}><PrimaryIcon className="h-4 w-4" aria-hidden /> {primary.label}</Link>
          </Button>
        ) : (
          <Button type="button" size={size} className={cn(btnCls, "flex-1 sm:flex-none")} disabled={Boolean(pending)} onClick={() => open(primary.key)}>
            {pending === primary.key ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PrimaryIcon className="h-4 w-4" aria-hidden />}
            {primary.label}
          </Button>
        )
      ) : null}
      {(items.length > 0 || extraMenu.length > 0) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={Boolean(pending)}>
            <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0 sm:h-9 sm:w-9" aria-label={menuLabel ?? `Další akce ${target.jobNumber}`}>
              <Ellipsis className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-2rem)]">
            {safeItems.map(menuItem)}
            {dangerItems.length > 0 && safeItems.length > 0 && <DropdownMenuSeparator />}
            {dangerItems.map(menuItem)}
            {extraMenu.length > 0 && items.length > 0 && <DropdownMenuSeparator />}
            {extraMenu.map((x) => {
              const Icon = x.icon;
              if (x.href) {
                return (
                  <DropdownMenuItem key={x.label} asChild className="min-h-10">
                    {x.external
                      ? <a href={x.href} target="_blank" rel="noopener noreferrer"><Icon aria-hidden /> {x.label}</a>
                      : <Link href={x.href}><Icon aria-hidden /> {x.label}</Link>}
                  </DropdownMenuItem>
                );
              }
              return (
                <DropdownMenuItem key={x.label} className="min-h-10" onSelect={() => x.onSelect?.()}>
                  <Icon aria-hidden /> {x.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* ── Poptávka ── */}
      {jobId && (
        <>
          <ConfirmDialog
            open={dialog === "take.confirm"}
            onOpenChange={close}
            icon={UserRoundCheck}
            tone="bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
            title={takeQuestion ?? "Převzít poptávku?"}
            confirmLabel="Převzít"
            onConfirm={async () => {
              const r = await takeInquiry(jobId, { force: true });
              if (!r.ok) return r.error ?? "Poptávku se nepodařilo převzít.";
              refresh("Poptávka převzata — je v řešení.");
              return null;
            }}
          >
            Řešitelem budeš ty — historie zachová, od koho poptávka přešla.
          </ConfirmDialog>
          <ReasonDialog
            open={dialog === "inquiry.wait"}
            onOpenChange={close}
            title={`Čeká na podklady — ${target.jobNumber}`}
            description="Napiš, co chybí. Stav skončí sám, jakmile k zakázce přibude výkres, model nebo e-mail."
            reasons={[]}
            requireNote
            destructive={false}
            noteLabel="Co chybí"
            notePlaceholder="Ťukni nebo dopiš, např. výkres v PDF"
            quickNotes={QUICK_NOTES.waiting}
            confirmLabel="Čeká na podklady"
            onConfirm={async ({ note }) => guard(await setInquiryStatus(jobId, "ceka_na_podklady", { note }), "Poptávka čeká na podklady.")}
          />
          {(["inquiry.decline", "inquiry.withdraw"] as const).map((key) => {
            const to = key === "inquiry.decline" ? "odmitnuta" : "stazena";
            return (
              <ReasonDialog
                key={key}
                open={dialog === key}
                onOpenChange={close}
                title={key === "inquiry.decline" ? `Odmítnout poptávku ${target.jobNumber}` : `Zákazník stáhl poptávku ${target.jobNumber}`}
                description="Vyber důvod jedním ťuknutím — pomůže to příště s cenou i kapacitou."
                phase="inquiry"
                to={to}
                confirmLabel={key === "inquiry.decline" ? "Odmítnout" : "Poptávka stažena"}
                effect={effectOf({ kind: "inquiry", to })}
                onConfirm={async ({ reason, note }) => guard(await setInquiryStatus(jobId, to, { reason, note }), key === "inquiry.decline" ? "Poptávka odmítnuta." : "Poptávka označena jako stažená.")}
              />
            );
          })}
          <ReasonDialog
            open={dialog === "inquiry.propose"}
            onOpenChange={close}
            title={`Navrhnout odmítnutí ${target.jobNumber}`}
            description="Rozhodne obchodník nebo vedení — uvidí tvůj návrh u zakázky."
            phase="inquiry"
            confirmLabel="Navrhnout"
            onConfirm={async ({ reason, note }) => {
              const to = isOurReason(reason as LostReason | null) ? "odmitnuta" : "stazena";
              return guard(await proposeFlowChange(jobId, { phase: "inquiry", to, reason, note }), "Návrh odeslán ke schválení.");
            }}
          />
        </>
      )}

      {/* ── Nabídka ── */}
      {q && (
        <>
          {jobId && (
            <DocumentSendDialog
              open={dialog === "quote.send"}
              onOpenChange={close}
              jobId={jobId}
              kind="nabidka"
              quoteId={q.id}
              title={`Odeslat nabídku ${q.number ?? ""} zákazníkovi`}
              onSent={({ to }) => refresh(`Nabídka ${q.number ?? ""} odeslána na ${to}.`)}
            />
          )}
          {jobId && dialog === "quote.approveSend" && (
            // #25: schválení + vystavení PDF + e-mail jedním krokem na serveru (zavřením se nic neschválí)
            <QuoteApproveSendDialog
              open
              onOpenChange={close}
              jobId={jobId}
              quoteId={q.id}
              number={qName}
              updatedAt={q.updatedAt ?? null}
              onDone={(text) => refresh(text)}
            />
          )}
          <QuoteReturnDialog
            open={dialog === "quote.returnToAuthor"}
            onOpenChange={close}
            quoteId={q.id}
            number={qName}
            author={target.quoteAuthor ?? null}
            onDone={(text) => refresh(text)}
          />
          <ReasonDialog
            open={dialog === "quote.markSent"}
            onOpenChange={close}
            title={`Odesláno jinak — ${qName}`}
            description="Nabídka odešla osobně, poštou nebo z jiné schránky."
            reasons={[]}
            destructive={false}
            noteLabel="Jak odešla"
            notePlaceholder="Osobně na schůzce, poštou…"
            confirmLabel="Označit jako odeslanou"
            onConfirm={async ({ note }) => guard(await setQuoteState(q.id, "odeslana", { note }), `${qName} označena jako odeslaná.`)}
          />
          <ReasonDialog
            open={dialog === "quote.unapprove"}
            onOpenChange={close}
            title={`Vrátit k úpravě — ${qName}`}
            reasons={[]}
            requireNote
            destructive={false}
            noteLabel="Co upravit"
            confirmLabel="Vrátit k úpravě"
            onConfirm={async ({ note }) => guard(await setQuoteState(q.id, "rozpracovana", { note }), `${qName} vrácena k úpravě.`)}
          />
          <ReasonDialog
            open={dialog === "quote.feedback"}
            onOpenChange={close}
            title={`Připomínky zákazníka — ${qName}`}
            description="Co zákazník chce změnit? Pak připravíš novou verzi, nebo odpovíš bez změny."
            reasons={[]}
            requireNote
            destructive={false}
            noteLabel="Připomínky"
            confirmLabel="Zapsat připomínky"
            onConfirm={async ({ note }) => guard(await setQuoteState(q.id, "pripominky", { feedback: note }), "Připomínky zapsány.")}
          />
          <ConfirmDialog
            open={dialog === "quote.accept"}
            onOpenChange={close}
            icon={ThumbsUp}
            tone="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
            title={`Zákazník objednal podle ${qName}?`}
            confirmLabel="Ano, objednal"
            confirmVariant="success"
            onConfirm={async () => {
              const r = await setQuoteState(q.id, "prijata");
              if (!r.ok) return r.error ?? "Nabídku se nepodařilo označit jako přijatou.";
              notify("success", `${qName} přijata — zakázka čeká na potvrzení objednávky.`, { label: "Potvrdit objednávku", href: "/confirmations" });
              router.refresh();
              return null;
            }}
          >
            Hodnota zakázky se nastaví podle nabídky, ostatní verze se archivují a zakázka se posune do stavu{" "}
            <span className={cn("font-semibold", stageMeta("objednavka").text)}>Objednávka</span>.
          </ConfirmDialog>
          <ReasonDialog
            open={dialog === "quote.reject"}
            onOpenChange={close}
            title={`Zamítnout nabídku ${qName}`}
            description="Proč zákazník nabídku nepřijal?"
            phase="quote"
            to="zamitnuta"
            confirmLabel="Zamítnout"
            effect={target.onlyOpenQuote && target.jobId ? ["Zakázka se uzavře jako Nerealizovaná (jiná otevřená nabídka není)."] : []}
            onConfirm={async ({ reason, note }) => {
              const price = competitor.trim() ? Number(competitor.replace(/\s/g, "").replace(",", ".")) : null;
              if (price !== null && (!Number.isFinite(price) || price < 0)) return { ok: false, error: "Neplatná cena konkurence." };
              return guard(await setQuoteState(q.id, "zamitnuta", { reason, note, competitorPrice: price }), `${qName} zamítnuta.`);
            }}
          >
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Cena konkurence bez DPH (nepovinné)</span>
              <Input inputMode="decimal" value={competitor} onChange={(e) => setCompetitor(e.target.value)} placeholder="např. 125 000" className="h-11 sm:h-9" />
            </label>
          </ReasonDialog>
          {jobId && (
            <ReasonDialog
              open={dialog === "quote.propose"}
              onOpenChange={close}
              title={`Navrhnout zamítnutí ${qName}`}
              description="Rozhodne obchodník nebo vedení."
              phase="quote"
              to="zamitnuta"
              confirmLabel="Navrhnout"
              onConfirm={async ({ reason, note }) => guard(await proposeFlowChange(jobId, { phase: "quote", to: "zamitnuta", quoteId: q.id, reason, note }), "Návrh odeslán ke schválení.")}
            />
          )}
          <ExtendQuoteDialog
            open={dialog === "quote.extend"}
            onOpenChange={close}
            quoteNumber={qName}
            validUntil={q.validUntil}
            today={target.today}
            onConfirm={async (date) => guard(await extendQuoteValidity(q.id, date), `Platnost ${qName} prodloužena.`)}
          />
        </>
      )}

      {/* ── Objednávka ── */}
      {jobId && (
        <>
          {target.confirm && (
            <ConfirmOrderDialog
              open={dialog === "order.confirm" || dialog === "order.acceptAsIs" || dialog === "order.sendConfirmation" || dialog === "order.sendAfterChange"}
              onOpenChange={close}
              job={target.confirm}
              mode={confirmMode}
              mismatch={dialog === "order.acceptAsIs" || (dialog === "order.confirm" && f?.orderStatus === "rozpor") ? f?.orderMismatch?.items ?? null : null}
              revision={f && f.orderRevision > 1 ? target.revision ?? null : null}
            />
          )}
          <ReasonDialog
            open={dialog === "order.confirmOther"}
            onOpenChange={close}
            title={`Potvrzeno jinak — ${target.jobNumber}`}
            description="Potvrzení proběhlo telefonem, osobně nebo podpisem — zapíše se s tvým jménem."
            reasons={[]}
            requireNote
            destructive={false}
            noteLabel="Jak jsme potvrdili"
            notePlaceholder="Ťukni nebo dopiš, např. s p. Novákem, termín 21. 11."
            quickNotes={QUICK_NOTES.confirmedHow}
            confirmLabel="Potvrzeno"
            onConfirm={async ({ note }) => guard(await setOrderStatus(jobId, "potvrzena", { note }), "Objednávka potvrzena.")}
          />
          <MismatchEditDialog
            open={dialog === "order.flagMismatch"}
            onOpenChange={close}
            jobNumber={target.jobNumber}
            onConfirm={async (list) => guard(await setOrderStatus(jobId, "rozpor", { mismatch: { items: list } }), "Rozpor s nabídkou zapsán.")}
          />
          <ResolveMismatchDialog
            open={dialog === "order.resolveMismatch"}
            onOpenChange={close}
            jobNumber={target.jobNumber}
            mismatch={f?.orderMismatch ?? null}
            fixRequested={f?.orderMismatch?.fix_requested_at ?? null}
            onAccept={() => (target.confirm ? setDialog("order.acceptAsIs") : setDialog("order.confirmOther"))}
            onFixed={async () => guard(await setOrderStatus(jobId, "dorucena", { note: "přišla opravená objednávka" }), "Objednávka je zase doručená — potvrď ji.")}
            onRequestFix={async (note) => guard(await requestOrderFix(jobId, { note }), "Žádost o opravu zapsána.")}
          />
          <ReasonDialog
            open={dialog === "order.requestFix"}
            onOpenChange={close}
            title={`Požádat o opravu objednávky ${target.jobNumber}`}
            reasons={[]}
            destructive={false}
            noteLabel="Co má zákazník opravit"
            confirmLabel="Požádáno o opravu"
            onConfirm={async ({ note }) => guard(await requestOrderFix(jobId, { note }), "Žádost o opravu zapsána.")}
          />
          <ReasonDialog
            open={dialog === "order.registerChange"}
            onOpenChange={close}
            title={`Zákazník změnil objednávku ${target.jobNumber}`}
            description="Zapíše se nová revize objednávky. Položky se samy nepřepíšou — o změně rozhodneš (potvrdit / nepřijmout)."
            reasons={[]}
            requireNote
            destructive={false}
            noteLabel="Co se změnilo"
            notePlaceholder="Ťukni nebo dopiš, např. VK-12 ze 100 na 120 ks"
            quickNotes={QUICK_NOTES.orderChange}
            confirmLabel="Zapsat změnu"
            onConfirm={async ({ note }) => {
              const r = await registerOrderChange(jobId, { note, customerOrderNumber: changeNumber.trim() || null });
              return guard(r, r.ok && r.revision ? `Změna objednávky zapsána (rev ${r.revision}).` : "Změna objednávky zapsána.");
            }}
          >
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Číslo objednávky zákazníka (je-li nové)</span>
              <Input value={changeNumber} onChange={(e) => setChangeNumber(e.target.value)} maxLength={120} className="h-11 sm:h-9" />
            </label>
          </ReasonDialog>
          <DecideChangeDialog
            open={dialog === "order.decideChange"}
            onOpenChange={(o) => { if (!o && dialog === "order.decideChange") setDialog(null); }}
            jobNumber={target.jobNumber}
            revision={target.revision ?? null}
            stamp={target.orderChangeStamp ?? null}
            onAccept={async () => {
              const r = await decideOrderChange(jobId, true);
              if (!r.ok) return r;
              notify("success", "Změna potvrzena — pošli zákazníkovi nové potvrzení.");
              // řádek po obnovení z fronty „K potvrzení“ zmizí — obnovit až po dialogu potvrzení
              if (target.confirm) window.setTimeout(() => setDialog("order.sendAfterChange"), 0);
              else router.refresh();
              return r;
            }}
            onReject={async (note) => guard(await decideOrderChange(jobId, false, { note }), "Změna nepřijata — objednávka platí v potvrzené revizi.")}
          />
          <ReasonDialog
            open={dialog === "order.rejectChange"}
            onOpenChange={close}
            title={`Změnu nepřijímáme — ${target.jobNumber}`}
            reasons={[]}
            requireNote
            noteLabel="Proč (uvidí zákazník v potvrzení)"
            confirmLabel="Změnu nepřijímáme"
            onConfirm={async ({ note }) => guard(await decideOrderChange(jobId, false, { note }), "Změna nepřijata.")}
          />
          <ReasonDialog
            open={dialog === "order.cancel"}
            onOpenChange={close}
            title={`Stornovat objednávku ${target.jobNumber}`}
            description="Proč zákazník objednávku zrušil?"
            phase="order"
            to="stornovana"
            confirmLabel="Stornovat"
            effect={effectOf({ kind: "order", to: "stornovana" })}
            onConfirm={async ({ reason, note }) => guard(await setOrderStatus(jobId, "stornovana", { reason, note }), "Objednávka stornována.")}
          />
          <ReasonDialog
            open={dialog === "order.propose"}
            onOpenChange={close}
            title={`Navrhnout storno ${target.jobNumber}`}
            description="Rozhodne obchodník nebo vedení."
            phase="order"
            to="stornovana"
            confirmLabel="Navrhnout"
            onConfirm={async ({ reason, note }) => guard(await proposeFlowChange(jobId, { phase: "order", to: "stornovana", reason, note }), "Návrh odeslán ke schválení.")}
          />
          <ProposalDecisionDialog
            open={dialog === "proposal.decide"}
            onOpenChange={close}
            proposal={target.proposal?.value ?? f?.proposal ?? null}
            stamp={target.proposal?.stamp ?? null}
            onDecide={async (accept) => guard(await decideFlowProposal(jobId, accept), accept ? "Návrh přijat a proveden." : "Návrh zamítnut.")}
          />
        </>
      )}
    </div>
  );
}

/** Čekající návrh změny u řádku: „Návrh: Odmítnout poptávku — Kapacita · Pavel Dílna“ + ✓ / ✕. */
export function FlowProposalChip({
  jobId, proposal, stamp, canDecide, className,
}: {
  jobId: string;
  proposal: FlowProposal;
  stamp: ChangeStamp | null;
  canDecide: boolean;
  className?: string;
}) {
  const router = useRouter();
  const notify = useNotify();
  return (
    <ProposalChip
      proposal={proposal}
      stamp={stamp}
      canDecide={canDecide}
      className={className}
      onDecide={async (accept) => {
        const r = await decideFlowProposal(jobId, accept);
        if (!r.ok) return r;
        notify("success", accept ? "Návrh přijat a proveden." : "Návrh zamítnut.");
        router.refresh();
        return r;
      }}
    />
  );
}
