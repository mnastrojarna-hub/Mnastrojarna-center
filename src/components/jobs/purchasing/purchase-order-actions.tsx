"use client";

import * as React from "react";
import {
  Send, FileText, MoreHorizontal, Loader2, BadgeCheck, PackageCheck, PackageOpen, Ban, RotateCcw, Pencil, MailCheck, Download,
  ArchiveRestore, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { regeneratePurchaseOrderPdf, updatePurchaseOrder } from "@/app/actions/purchasing";
import { isPurchaseOrderEditable, purchaseOrderTransitions } from "@/lib/jobs/purchasing";
import type { PurchaseOrderView } from "@/lib/jobs/purchasing-types";
import type { PurchaseOrderStatus } from "@/lib/supabase/database.types";
import type { Notify } from "@/components/jobs/detail/toast";
import { ConfirmPurchaseOrderDialog, SendPurchaseOrderDialog } from "./purchase-order-dialogs";
import { CancelPurchaseOrderDialog, ReceivePurchaseOrderDialog } from "./purchase-receive-dialog";
import { TRANSITION_LABELS, purchaseNextStep } from "./purchasing-model";

const TRANSITION_ICONS: Record<PurchaseOrderStatus, LucideIcon> = {
  navrh: RotateCcw,
  vystavena: ArchiveRestore,
  odeslana: MailCheck,
  potvrzena: BadgeCheck,
  dodana: PackageCheck,
  zrusena: Ban,
};

/**
 * Akce objednávky dodavateli (záložka zakázky i přehled objednávek): hlavní další
 * krok podle stavu jako sloveso (Poslat → Dodavatel potvrdil → Převzít zboží / zbytek),
 * PDF a menu s ostatními přechody. Zrušení vždy s důvodem.
 */
export function PurchaseOrderActions({
  order, notify, onChanged, onEdit, size = "sm",
}: {
  order: PurchaseOrderView;
  notify: Notify;
  onChanged: () => void;
  /** Úprava (jen dokud objednávka neodešla) — bez ní se položka v menu neukáže. */
  onEdit?: () => void;
  size?: "sm" | "default";
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<null | "send" | "confirm" | "cancel" | "receive">(null);
  const transitions = purchaseOrderTransitions(order.status);
  const editable = isPurchaseOrderEditable(order.status);
  const pdfHref = order.fileId ? `/api/jobs/files/${order.fileId}` : `/api/pdf/purchase-order/${order.id}`;
  const supplierName = order.supplier?.name ?? null;
  /** Převzetí po položkách (jen objednávka s položkami, odeslaná / potvrzená). */
  const canReceive = (order.status === "odeslana" || order.status === "potvrzena") && order.items.some((it) => Boolean(it.id));
  const next = purchaseNextStep(order);

  async function setStatus(to: PurchaseOrderStatus, ok: string) {
    setBusy(to);
    try {
      const res = await updatePurchaseOrder(order.id, { status: to });
      if (!res.ok) notify("error", res.error ?? "Stav se nepodařilo změnit.");
      else {
        notify("success", ok);
        if (res.hint) notify("info", res.hint);
        onChanged();
      }
    } catch {
      notify("error", "Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  }

  async function regenerate() {
    setBusy("pdf");
    try {
      const res = await regeneratePurchaseOrderPdf(order.id);
      if (!res.ok || !res.fileId) notify("error", res.error ?? "PDF se nepodařilo vytvořit.");
      else {
        notify("success", `PDF objednávky ${order.number} přegenerováno.`, { label: "Otevřít PDF", href: `/api/jobs/files/${res.fileId}`, external: true });
        onChanged();
      }
    } catch {
      notify("error", "Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  }

  function runTransition(to: PurchaseOrderStatus) {
    if (to === "potvrzena") return setDialog("confirm");
    if (to === "zrusena") return setDialog("cancel");
    const msg: Record<PurchaseOrderStatus, string> = {
      navrh: `Objednávka ${order.number} je zpět v návrhu.`,
      vystavena: `Objednávka ${order.number} obnovena.`,
      odeslana: `Objednávka ${order.number} označena jako odeslaná.`,
      potvrzena: "",
      dodana: `Objednávka ${order.number} dodána k nám.`,
      zrusena: "",
    };
    void setStatus(to, msg[to]);
  }

  // hlavní další krok podle stavu (sloveso)
  let primary: React.ReactNode = null;
  let primaryTarget: PurchaseOrderStatus | null = null;
  if (next === "poslat") {
    primary = (
      <Button size={size} variant="send" onClick={() => setDialog("send")} disabled={busy !== null}>
        <Send className="h-4 w-4" /> Poslat e-mailem
      </Button>
    );
  } else if (next === "potvrzeno") {
    primaryTarget = "potvrzena";
    primary = (
      <Button size={size} variant="success" onClick={() => setDialog("confirm")} disabled={busy !== null}>
        <BadgeCheck className="h-4 w-4" /> Dodavatel potvrdil
      </Button>
    );
  } else if (next === "prevzit" || next === "prevzit_zbytek") {
    const label = next === "prevzit_zbytek" ? "Převzít zbytek" : canReceive ? "Převzít zboží" : "Dodáno k nám";
    if (!canReceive) primaryTarget = "dodana";
    primary = (
      <Button
        size={size}
        variant="success"
        onClick={() => (canReceive ? setDialog("receive") : runTransition("dodana"))}
        disabled={busy !== null}
      >
        {busy === "dodana" ? <Loader2 className="h-4 w-4 animate-spin" /> : canReceive ? <PackageOpen className="h-4 w-4" /> : <PackageCheck className="h-4 w-4" />} {label}
      </Button>
    );
  }
  const menuTransitions = transitions.filter((t) => t !== primaryTarget);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {primary}
      <Button asChild size={size} variant="outline">
        <a href={pdfHref} target="_blank" rel="noopener noreferrer" title="Otevřít PDF objednávky">
          <FileText className="h-4 w-4" /> PDF
        </a>
      </Button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button size={size === "sm" ? "icon-sm" : "icon"} variant="ghost" aria-label={`Další akce objednávky ${order.number}`} disabled={busy !== null}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {order.status !== "zrusena" && (
            <DropdownMenuItem onSelect={() => setDialog("send")}>
              <Send /> {order.sentAt ? "Poslat e-mailem znovu" : "Poslat dodavateli e-mailem"}
            </DropdownMenuItem>
          )}
          {editable && onEdit && (
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> Upravit objednávku
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <a href={`/api/pdf/purchase-order/${order.id}?download=1`}>
              <Download /> Stáhnout PDF
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void regenerate()}>
            <RotateCcw /> Přegenerovat PDF
          </DropdownMenuItem>
          {canReceive && next !== "prevzit" && next !== "prevzit_zbytek" && (
            <DropdownMenuItem onSelect={() => setDialog("receive")}>
              <PackageOpen /> Převzít zboží po položkách…
            </DropdownMenuItem>
          )}
          {menuTransitions.length > 0 && <DropdownMenuSeparator />}
          {menuTransitions.map((t) => {
            const Icon = TRANSITION_ICONS[t];
            return (
              <DropdownMenuItem
                key={t}
                onSelect={() => runTransition(t)}
                className={t === "zrusena" ? "text-red-600 focus:text-red-700 dark:text-red-400 [&_svg]:text-red-600" : undefined}
              >
                <Icon /> {t === "dodana" && canReceive ? "Dodáno k nám — přišlo vše" : t === "zrusena" ? "Zrušit objednávku…" : TRANSITION_LABELS[t]}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <SendPurchaseOrderDialog
        open={dialog === "send"}
        onOpenChange={(o) => setDialog(o ? "send" : null)}
        order={{ id: order.id, number: order.number, supplierName, fileId: order.fileId }}
        notify={notify}
        onSent={onChanged}
      />
      <ConfirmPurchaseOrderDialog
        open={dialog === "confirm"}
        onOpenChange={(o) => setDialog(o ? "confirm" : null)}
        order={order}
        notify={notify}
        onDone={onChanged}
      />
      <CancelPurchaseOrderDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => setDialog(o ? "cancel" : null)}
        order={order}
        notify={notify}
        onDone={onChanged}
      />
      {canReceive && (
        <ReceivePurchaseOrderDialog
          open={dialog === "receive"}
          onOpenChange={(o) => setDialog(o ? "receive" : null)}
          order={{ id: order.id, number: order.number, supplierName }}
          items={order.items}
          notify={notify}
          onDone={onChanged}
        />
      )}
    </div>
  );
}
