"use client";

import * as React from "react";
import {
  Flame, Paintbrush, Hash, Layers, Ruler, Tag, CalendarClock, MapPin, Package, Banknote, Ban, FileStack, Gauge, Mail, Undo2, Check, X,
  Loader2, StickyNote, ShieldCheck, AlertTriangle, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JobMailChangeView } from "@/lib/data/job-mail";
import { cn } from "@/lib/utils";

const ICON: Record<string, LucideIcon> = {
  quantity: Hash, material: Layers, heat: Flame, surface: Paintbrush, hardness: Gauge, dimension: Ruler, tolerance: Ruler,
  marking: Tag, revision: FileStack, deadline: CalendarClock, address: MapPin, packaging: Package, price: Banknote, terms: Banknote, cancel: Ban,
};

export const STATUS_TEXT: Record<JobMailChangeView["status"], string> = {
  applied: "Propsáno do položky",
  suggested: "Návrh",
  info: "Zapsáno do historie",
  undone: "Vráceno",
  dismissed: "Zahozeno",
  superseded: "Přebito novějším e-mailem",
  replaced: "Nahrazeno ruční úpravou",
};

/** Proč jen návrh (místo automatické změny): jiná zakázka v e-mailu / „X místo Y" nesedí na položku. */
export function holdText(c: Pick<JobMailChangeView, "hold" | "holdJobNumber" | "mailOld" | "valueNew" | "valuePrev" | "status">): string | null {
  if (c.status !== "suggested") return null;
  if (c.hold === "other_job") return `E-mail jmenuje i zakázku ${c.holdJobNumber ?? "jinou"} — zkontroluj, ke které patří.`;
  if (c.hold === "mismatch" && c.mailOld) {
    const cur = c.valuePrev && c.valuePrev !== "—" ? `na položce je ${c.valuePrev}` : "na položce není nic";
    return `e-mail: ${c.valueNew ?? "—"} místo ${c.mailOld}, ${cur}`;
  }
  return null;
}

function statusText(c: Pick<JobMailChangeView, "kind" | "status">): string {
  if (c.status === "applied" && c.kind === "tag") return "Přidáno ke štítkům";
  if (c.status === "applied" && c.kind === "note") return "Přidáno do poznámky";
  return STATUS_TEXT[c.status];
}

function dateText(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
}

/**
 * Změna / upřesnění z e-mailu: co, od koho, kdy, citace; u položky odznak „Pokyn zákazníka z e-mailu
 * {datum} — nadřazeno výkresu" a přebitá hodnota výkresu přeškrtnutá; Vrátit / Potvrdit / Zahodit.
 */
export function MailChangeCard({ c, busy, onUndo, onApply, onDismiss, onOpenMail, compact }: {
  c: JobMailChangeView;
  busy?: boolean;
  onUndo?: () => void;
  onApply?: () => void;
  onDismiss?: () => void;
  onOpenMail?: () => void;
  compact?: boolean;
}) {
  const Icon = c.kind === "tag" ? Tag : c.kind === "note" ? StickyNote : ICON[c.field] ?? Mail;
  const applied = c.status === "applied";
  const suggested = c.status === "suggested";
  const muted = c.status === "undone" || c.status === "dismissed" || c.status === "superseded" || c.status === "replaced";
  const why = holdText(c);
  const tone = c.field === "cancel" ? "border-red-200 bg-red-50/60 dark:border-red-500/30 dark:bg-red-500/10"
    : applied ? "border-fuchsia-200 bg-fuchsia-50/60 dark:border-fuchsia-500/30 dark:bg-fuchsia-500/10"
      : suggested ? "border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10"
        : "bg-card";
  return (
    <li
      className={cn("rounded-xl border p-3 text-sm", tone, muted && "opacity-60")}
      data-testid={c.kind === "change" ? "mail-override" : "mail-change"}
      data-field={c.field}
      data-status={c.status}
    >
      <div className="flex items-start gap-2.5">
        <span className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          applied ? "bg-fuchsia-600 text-white" : suggested ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground",
        )}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className={cn("break-words font-medium", muted && "line-through decoration-muted-foreground/50")}>
            {c.kind === "tag" ? `${applied ? "Štítek" : "Návrh štítku"}: ${c.valueNew}` : c.kind === "note" ? `Do poznámky: ${c.summary}` : c.summary}
            {c.itemLabel && <span className="ml-1 font-normal text-muted-foreground">· {c.itemLabel}</span>}
          </p>
          {why && (
            <p className="flex w-fit max-w-full items-start gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900 dark:text-amber-200" data-testid="change-hold" data-hold={c.hold ?? ""}>
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" /> <span className="min-w-0 break-words">{why}</span>
            </p>
          )}
          {c.badge && c.kind === "change" && (applied || (suggested && !c.hold)) && (
            <p className="flex w-fit max-w-full items-start gap-1 rounded-md bg-fuchsia-600/10 px-1.5 py-0.5 text-[11px] font-semibold text-fuchsia-800 dark:text-fuchsia-300" data-testid="override-badge">
              <ShieldCheck className="mt-px h-3 w-3 shrink-0" /> <span className="min-w-0">{c.badge}</span>
            </p>
          )}
          {c.kind === "change" && (c.drawingValue !== null || c.valuePrev) && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span>
                výkres:{" "}
                <span className={cn(applied && "line-through decoration-fuchsia-500/70")} data-testid="override-drawing">{c.drawingValue ?? "neuvádí"}</span>
              </span>
              {c.valuePrev && c.valuePrev !== "—" && c.valuePrev !== c.drawingValue && (
                <span>před změnou: <span className={cn(applied && "line-through")}>{c.valuePrev}</span></span>
              )}
              {c.valueNew && <span className="font-semibold text-foreground">→ {c.valueNew}</span>}
            </p>
          )}
          {!compact && c.quote && (
            <p className="break-words border-l-2 border-muted-foreground/30 pl-2 text-xs italic text-muted-foreground">„{c.quote}“</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            {c.party === "supplier" ? "Dodavatel" : "Z e-mailu"} {c.fromName ?? ""}{c.mailAt ? ` · ${dateText(c.mailAt)}` : ""} · {statusText(c)}
            {applied && c.appliedKind === "ai" ? " automaticky" : ""}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-end gap-1.5">
        {onOpenMail && (
          <Button size="sm" variant="ghost" onClick={onOpenMail} className="h-8"><Mail className="h-3.5 w-3.5" /> E-mail</Button>
        )}
        {applied && c.kind === "change" && onUndo && (
          <Button size="sm" variant="outline" onClick={onUndo} disabled={busy} className="h-8" data-testid="override-undo">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Vrátit
          </Button>
        )}
        {(suggested || ((c.status === "undone" || c.status === "replaced") && c.kind === "change")) && onApply && (
          <Button size="sm" variant={suggested ? "success" : "outline"} onClick={onApply} disabled={busy} className="h-8" data-testid="change-apply">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {c.kind === "tag" ? "Přidat štítek" : c.kind === "note" ? "Přidat do poznámky" : suggested ? "Propsat do položky" : "Znovu propsat"}
          </Button>
        )}
        {suggested && onDismiss && (
          <Button size="sm" variant="ghost" onClick={onDismiss} disabled={busy} className="h-8" data-testid="change-dismiss" aria-label="Zahodit návrh"><X className="h-3.5 w-3.5" /> Zahodit</Button>
        )}
      </div>
    </li>
  );
}
