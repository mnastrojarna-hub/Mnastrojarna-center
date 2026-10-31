"use client";

import * as React from "react";
import { Loader2, Printer } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { printabilityOf } from "@/lib/print/print-links";
import { cn } from "@/lib/utils";
import { printDocument, showPrintHint, type PrintRequest } from "./print-action";

/**
 * Tlačítko „Tisknout" (ikona tiskárny) vedle „Stáhnout" / „PDF náhled" — jedním klepnutím dialog
 * tisku s výběrem tiskárny (počítač i telefon). Soubor, který vytisknout nejde (DXF, 3D model,
 * Word…), má tlačítko vypnuté s krátkou nápovědou.
 */
export function PrintButton({
  href, filename, blob, getBlob, label = "Tisknout", showLabel = false, variant = "ghost", size, className, iconClassName, testId = "print-button", stopPropagation,
}: {
  href?: string | null;
  filename?: string | null;
  blob?: Blob | null;
  /** Obsah vytvořený až na klepnutí (náhled PDF z návrhu). */
  getBlob?: () => Promise<Blob | null>;
  label?: string;
  showLabel?: boolean;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  iconClassName?: string;
  testId?: string;
  stopPropagation?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const able = printabilityOf(filename);
  const hint = able.ok ? null : able.hint;
  const title = hint ?? (filename ? `${label}: ${filename}` : label);

  async function onClick(e: React.MouseEvent) {
    if (stopPropagation) e.stopPropagation();
    e.preventDefault();
    if (hint) return showPrintHint(hint);
    if (busy) return;
    setBusy(true);
    try {
      const req: PrintRequest = { href, filename, blob };
      if (getBlob && !blob) {
        const b = await getBlob();
        if (!b) return;
        req.blob = b;
      }
      await printDocument(req);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size ?? (showLabel ? "sm" : "icon-sm")}
      className={cn(className, hint && "cursor-not-allowed opacity-50")}
      onClick={onClick}
      aria-disabled={hint ? true : undefined}
      aria-label={hint ? `${label} — ${hint}` : label === "Tisknout" && filename ? `Tisknout ${filename}` : label}
      title={title}
      data-testid={testId}
      data-print-href={href ?? undefined}
    >
      {busy ? <Loader2 className={cn("h-4 w-4 animate-spin", iconClassName)} /> : <Printer className={cn("h-4 w-4", iconClassName)} />}
      {showLabel && <span>{label}</span>}
    </Button>
  );
}

/** Položka „Tisknout" v menu ⋯ dokumentu. */
export function PrintMenuItem({ href, filename, label = "Tisknout", testId = "print-menu-item" }: { href: string; filename?: string | null; label?: string; testId?: string }) {
  const able = printabilityOf(filename);
  return (
    <DropdownMenuItem
      disabled={!able.ok}
      onSelect={() => void printDocument({ href, filename })}
      data-testid={testId}
      title={able.ok ? undefined : able.hint}
    >
      <Printer /> {label}
      {!able.ok && <span className="ml-auto pl-2 text-[10px] text-muted-foreground">{able.hint}</span>}
    </DropdownMenuItem>
  );
}
