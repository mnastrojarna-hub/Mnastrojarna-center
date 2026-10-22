"use client";

import * as React from "react";
import {
  Send, FileText, MoreHorizontal, Loader2, BadgeCheck, PackageCheck, Ban, RotateCcw, Pencil, MailCheck, Download, ArchiveRestore,
  type LucideIcon,
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
import { ConfirmDialog } from "@/components/jobs/detail/confirm-dialog";
import { ConfirmPurchaseOrderDialog, SendPurchaseOrderDialog } from "./purchase-order-dialogs";
import { TRANSITION_LABELS } from "./purchasing-model";

type Order = Omit<PurchaseOrderView, "items">;

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
 * krok podle stavu (poslat → potvrzeno → dodáno), PDF a menu s ostatními přechody.
 */
export function PurchaseOrderActions({
  order, notify, onChanged, onEdit, size = "sm",
}: {
  order: Order;
  notify: Notify;
  onChanged: () => void;
  /** Úprava (jen dokud objednávka neodešla) — bez ní se položka v menu neukáže. */
  onEdit?: () => void;
  size?: "sm" | "default";
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<null | "send" | "confirm" | "cancel">(null);
  const transitions = purchaseOrderTransitions(order.status);
  const editable = isPurchaseOrderEditable(order.status);
  const pdfHref = order.fileId ? `/api/jobs/files/${order.fileId}` : `/api/pdf/purchase-order/${order.id}`;
  const supplierName = order.supplier?.name ?? null;

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

  // hlavní další krok podle stavu
  let primary: React.ReactNode = null;
  if (order.status === "navrh" || order.status === "vystavena") {
    primary = (
      <Button size={size} variant="send" onClick={() => setDialog("send")} disabled={busy !== null}>
        <Send className="h-4 w-4" /> Poslat e-mailem
      </Button>
    );
  } else if (order.status === "odeslana") {
    primary = (
      <Button size={size} variant="success" onClick={() => setDialog("confirm")} disabled={busy !== null}>
        <BadgeCheck className="h-4 w-4" /> Dodavatel potvrdil
      </Button>
    );
  } else if (order.status === "potvrzena") {
    primary = (
      <Button size={size} variant="success" onClick={() => runTransition("dodana")} disabled={busy !== null}>
        {busy === "dodana" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} Dodáno k nám
      </Button>
    );
  }
  const primaryTarget: PurchaseOrderStatus | null =
    order.status === "odeslana" ? "potvrzena" : order.status === "potvrzena" ? "dodana" : null;
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
          {menuTransitions.length > 0 && <DropdownMenuSeparator />}
          {menuTransitions.map((t) => {
            const Icon = TRANSITION_ICONS[t];
            return (
              <DropdownMenuItem
                key={t}
                onSelect={() => runTransition(t)}
                className={t === "zrusena" ? "text-red-600 focus:text-red-700 dark:text-red-400 [&_svg]:text-red-600" : undefined}
              >
                <Icon /> {TRANSITION_LABELS[t]}
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
      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => setDialog(o ? "cancel" : null)}
        icon={Ban}
        tone="bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
        title={`Zrušit objednávku ${order.number}?`}
        confirmLabel="Zrušit objednávku"
        confirmVariant="destructive"
        onConfirm={async () => {
          const res = await updatePurchaseOrder(order.id, { status: "zrusena" });
          if (!res.ok) return res.error ?? "Objednávku se nepodařilo zrušit.";
          notify("success", `Objednávka ${order.number} zrušena — do nákladů se už nepočítá.`);
          onChanged();
          return null;
        }}
      >
        Zrušená objednávka se nezapočítává do nákupu zakázky — marže a provize se přepočítají.
        {order.sentAt ? " Dodavateli to dej vědět — objednávka už odešla." : ""}
      </ConfirmDialog>
    </div>
  );
}
