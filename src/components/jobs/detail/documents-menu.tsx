"use client";

import * as React from "react";
import { ChevronDown, FileText, BadgeCheck, Truck, ReceiptText, Loader2, FileOutput, AlertTriangle, type LucideIcon } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { generateJobDocument, type JobDocumentKind } from "@/app/actions/job-documents";
import type { JobFile, JobItem, JobQuote } from "@/lib/jobs/types";
import { currentDeliveryNotes, isDeliveryNoteFile, remainingQty } from "@/lib/jobs/delivery-notes";
import { DeliveryDialog } from "@/components/jobs/production/delivery-dialog";
import { useFlowActions } from "./flow-actions";
import { quoteApprovalBlock } from "@/lib/jobs/flow-status";
import { cn } from "@/lib/utils";
import { useJobDetail } from "./detail-context";
import { primaryQuote } from "./detail-helpers";
import { ConfirmDialog } from "./confirm-dialog";

const DOCS: { kind: JobDocumentKind; label: string; hint: string; icon: LucideIcon; tone: string }[] = [
  { kind: "nabidka", label: "Nabídka", hint: "PDF z aktuální nabídky", icon: FileText, tone: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" },
  { kind: "potvrzeni", label: "Potvrzení objednávky", hint: "s potvrzeným termínem", icon: BadgeCheck, tone: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" },
  { kind: "dodaci_list", label: "Dodací list", hint: "položky a množství", icon: Truck, tone: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300" },
  { kind: "faktura", label: "Faktura", hint: "s QR platbou", icon: ReceiptText, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
];

type DeliveryItem = Pick<JobItem, "id" | "drawingNumber" | "name" | "description" | "quantity" | "unit" | "deliveredQuantity" | "deliveryClosed" | "deliveryClosedReason">;

/**
 * „Doklady ▾" — vygeneruje PDF doklad ze zakázky a uloží ho do Dokumentů. Dodací list: zakázka
 * bez dodávek → DL na všechny položky (jako dřív); dodáno bez DL → „DL na dodané zboží"; s DL
 * dodávek → stáhnout je a „DL na zbývající položky" (zapíše dodání zbytku a vystaví další DL —
 * nikdy nové číslo pro stejný DL).
 */
export function DocumentsMenu({
  quotes, acceptedQuoteId, variant = "outline", size, className, compact, items, files,
}: {
  /** Položky a dokumenty zakázky (dodací listy dodávek, zbývá dodat). */
  items?: DeliveryItem[];
  files?: JobFile[];
  quotes: (Pick<JobQuote, "id" | "number" | "archived" | "createdAt" | "revision" | "status">
    & Partial<Pick<JobQuote, "state" | "adminApprovalRequired" | "approvalRequired" | "approvedBy" | "sentAt">>)[];
  acceptedQuoteId: string | null;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  /** Na mobilu jen ikona. */
  compact?: boolean;
}) {
  const { jobId, notify, refresh } = useJobDetail();
  const flow = useFlowActions();
  const [busy, setBusy] = React.useState<JobDocumentKind | null>(null);
  const [remainder, setRemainder] = React.useState(false);
  const deliveryNotes = currentDeliveryNotes((files ?? []).filter(isDeliveryNoteFile));
  const anyDelivered = (items ?? []).some((i) => (i.deliveredQuantity ?? 0) > 0);
  const canDeliver = flow ? flow.ctx.can("workflow") : true;
  const hasRemainder = canDeliver && (deliveryNotes.length > 0 || anyDelivered) && (items ?? []).some((i) => remainingQty(i) > 0);
  // potvrzení / faktura s neoceněnými položkami → „Přesto vystavit"
  const [unpriced, setUnpriced] = React.useState<{ kind: JobDocumentKind; message: string } | null>(null);
  const quote = primaryQuote(quotes, acceptedQuoteId);
  // #25: PDF neschválené nabídky k odeslání nejde vystavit (server to odmítne také) — náhled s vodoznakem ano
  const quoteBlocked = Boolean(quote) && quoteApprovalBlock({
    adminApprovalRequired: quote!.adminApprovalRequired, approvalRequired: quote!.approvalRequired,
    approvedBy: quote!.approvedBy ?? null, sentAt: quote!.sentAt ?? null, state: quote!.state ?? null,
  }) !== null;

  /** Vrací chybu (pro dialog „Přesto vystavit") nebo null. */
  async function generate(kind: JobDocumentKind, force = false): Promise<string | null> {
    if (busy) return null;
    setBusy(kind);
    try {
      const opts = { ...(kind === "nabidka" && quote ? { quoteId: quote.id } : {}), ...(force ? { force: true } : {}) };
      const res = await generateJobDocument(jobId, kind, Object.keys(opts).length ? opts : undefined);
      if (!res.ok || !res.fileId) {
        const message = res.error ?? "Doklad se nepodařilo vytvořit.";
        if (!force && (res.unpriced ?? 0) > 0) {
          setUnpriced({ kind, message });
          return null;
        }
        if (force) return message;
        notify("error", message);
        return null;
      }
      notify("success", `${DOCS.find((d) => d.kind === kind)?.label ?? "Doklad"} ${res.number ?? ""} je hotový a uložený v Dokumentech.`.replace(/\s+/g, " "), {
        label: "Otevřít PDF", href: `/api/jobs/files/${res.fileId}`, external: true,
      });
      refresh();
      return null;
    } catch {
      if (force) return "Spojení se nepovedlo — zkus to znovu.";
      notify("error", "Spojení se nepovedlo — zkus to znovu.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
    <ConfirmDialog
      open={Boolean(unpriced)}
      onOpenChange={(o) => { if (!o) setUnpriced(null); }}
      icon={AlertTriangle}
      tone="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
      title="Doklad má položky bez ceny"
      confirmLabel="Přesto vystavit"
      onConfirm={async () => (unpriced ? generate(unpriced.kind, true) : null)}
    >
      <p className="text-sm text-muted-foreground">
        {unpriced?.message} Neoceněné položky budou v dokladu bez ceny.
      </p>
    </ConfirmDialog>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant={variant} size={size} className={className} disabled={Boolean(busy)} aria-label="Doklady (PDF)" title="Vytvořit PDF doklad">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileOutput className="h-4 w-4 text-violet-600 dark:text-violet-400" />}
          <span className={cn(compact && "hidden sm:inline")}>Doklady</span>
          <ChevronDown className={cn("h-3.5 w-3.5 opacity-60", compact && "hidden sm:block")} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Vytvořit PDF a uložit k zakázce</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {DOCS.map((d) => {
          const Icon = d.icon;
          if (d.kind === "dodaci_list" && (deliveryNotes.length > 0 || anyDelivered)) {
            return (
              <React.Fragment key={d.kind}>
                {deliveryNotes.map((n) => (
                  <DropdownMenuItem key={n.id} asChild className="items-center gap-2.5 py-2">
                    <a href={`/api/jobs/files/${n.id}`} target="_blank" rel="noopener noreferrer">
                      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", d.tone)}>
                        <Icon className="!size-4 !text-current" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium leading-tight">Dodací list {n.number}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{n.label ? `${n.label} · ` : ""}stáhnout PDF</span>
                      </span>
                    </a>
                  </DropdownMenuItem>
                ))}
                {deliveryNotes.length === 0 && (
                  <DropdownMenuItem onSelect={() => void generate(d.kind)} className="items-center gap-2.5 py-2">
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", d.tone)}>
                      <Icon className="!size-4 !text-current" />
                    </span>
                    <span className="min-w-0 flex-1">
                      {/* dodáno bez DL → DL na to, co už odešlo (ne na objednané množství) */}
                      <span className="block text-sm font-medium leading-tight">DL na dodané zboží</span>
                      <span className="block truncate text-[11px] text-muted-foreground">co už odešlo — dodáno bez dodacího listu</span>
                    </span>
                  </DropdownMenuItem>
                )}
                {hasRemainder && (
                  <DropdownMenuItem onSelect={() => setRemainder(true)} className="items-center gap-2.5 py-2">
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", d.tone)}>
                      <Truck className="!size-4 !text-current" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-tight">DL na zbývající položky</span>
                      <span className="block truncate text-[11px] text-muted-foreground">zapíše dodání zbytku a vystaví další DL</span>
                    </span>
                  </DropdownMenuItem>
                )}
              </React.Fragment>
            );
          }
          const needsQuote = d.kind === "nabidka" && !quote;
          const unapproved = d.kind === "nabidka" && quoteBlocked;
          return (
            <DropdownMenuItem
              key={d.kind}
              disabled={needsQuote || unapproved}
              title={unapproved ? "Odeslat půjde po schválení super adminem." : undefined}
              onSelect={() => void generate(d.kind)}
              className="items-center gap-2.5 py-2"
            >
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", d.tone)}>
                <Icon className="!size-4 !text-current" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium leading-tight">{d.label}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {needsQuote
                    ? "Nejdřív vytvoř nabídku (záložka Nabídky)"
                    : unapproved ? "Neschválená — vystavíš po schválení super adminem"
                    : d.kind === "nabidka" && quote ? `z nabídky ${quote.number}` : d.hint}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
    {items && items.length > 0 && (
      <DeliveryDialog
        open={remainder}
        onOpenChange={setRemainder}
        jobId={jobId}
        items={items}
        prefill="remaining"
        onDone={(message) => { notify("success", message); refresh(); }}
      />
    )}
    </>
  );
}
