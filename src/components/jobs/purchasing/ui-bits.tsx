"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import type { PurchaseOrderStatus } from "@/lib/supabase/database.types";
import { PURCHASE_ORDER_STATUS_META } from "@/lib/jobs/purchasing";
import { cn } from "@/lib/utils";

/** Dialog přes celou obrazovku na mobilu, na počítači velký uprostřed. */
export const FULLSCREEN_DIALOG =
  "left-0 top-0 h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 overflow-y-auto rounded-none border-0 sm:left-1/2 sm:top-[4%] sm:h-auto sm:max-h-[92vh] sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:rounded-xl sm:border";

/** Popisek políčka s barevnou ikonou. */
export function Field({
  label, icon: Icon, iconClass = "text-lime-600", children, hint, className,
}: {
  label: string;
  icon: LucideIcon;
  iconClass?: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className={cn("h-3.5 w-3.5", iconClass)} /> {label}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Barevný odznak stavu objednávky dodavateli. */
export function PurchaseOrderStatusBadge({ status, className }: { status: PurchaseOrderStatus; className?: string }) {
  const m = PURCHASE_ORDER_STATUS_META[status];
  return (
    <span title={m.description} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", m.badge, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

/** Nadpis sekce záložky s barevnou dlaždicí. */
export function SectionTitle({
  icon: Icon, tone, title, count, subtitle, actions,
}: {
  icon: LucideIcon;
  tone: string;
  title: string;
  count?: number;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", tone)}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            {title}
            {count !== undefined && count > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">{count}</span>
            )}
          </h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Otevře PDF z odpovědi (náhled návrhu) v nové záložce; okno se otevře hned kvůli blokování vyskakovacích oken. */
export async function openPdfPreview(url: string, body: unknown): Promise<string | null> {
  const win = typeof window !== "undefined" ? window.open("", "_blank") : null;
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      win?.close();
      let msg = "Náhled PDF se nepodařilo vytvořit.";
      try {
        const j = (await res.json()) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        // tělo není JSON
      }
      return msg;
    }
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    if (win) win.location.href = href;
    else {
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      a.click();
    }
    window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
    return null;
  } catch {
    win?.close();
    return "Spojení se nepovedlo — zkus to znovu.";
  }
}
