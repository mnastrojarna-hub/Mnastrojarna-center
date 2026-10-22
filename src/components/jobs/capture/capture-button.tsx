"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { CaptureDialog } from "@/components/jobs/capture/capture-dialog";
import type { CaptureDocKind, CaptureResult } from "@/lib/jobs/capture-types";

export interface CaptureButtonProps {
  /** Nahrát doklad ke konkrétní zakázce (detail). Bez jobId = AI zakázku najde / založí. */
  jobId?: string;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  /** Otevřít dialog hned po načtení (např. /orders?capture=1 z mobilní lišty). */
  autoOpen?: boolean;
  /** Nápověda pro AI, jaký doklad se čeká (např. „objednavka"). */
  expectedKind?: CaptureDocKind;
  /** Po uložení dokladu (kromě router.refresh, které dialog dělá sám). */
  onSaved?: (result: CaptureResult) => void;
}

/**
 * „📷 Vyfotit doklad" — otevře dialog: vyfotit / vybrat stránky → AI přečte →
 * kontrola → uloženo do Knihy zakázek. Bez AI stejný postup s ručním vyplněním.
 * label="" = jen ikona (řádek knihy).
 */
export function CaptureButton({
  jobId,
  label = "Vyfotit doklad",
  variant = "send",
  size,
  className,
  autoOpen,
  expectedKind,
  onSaved,
}: CaptureButtonProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const opened = React.useRef(false);

  // /orders?capture=1 → otevřít a parametr z adresy odebrat (zpět / obnovení ho znovu neotevře)
  React.useEffect(() => {
    // po odebrání parametru se příznak vrátí, další ťuknutí na foťák v liště otevře znovu
    if (!autoOpen) {
      opened.current = false;
      return;
    }
    if (opened.current) return;
    opened.current = true;
    setOpen(true);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("capture")) {
        url.searchParams.delete("capture");
        router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
      }
    } catch {
      // adresa jen kosmetika
    }
  }, [autoOpen, router]);

  const iconOnly = !label;
  const aria = jobId ? "Vyfotit doklad k zakázce" : "Vyfotit doklad";
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={iconOnly ? aria : undefined}
        title={iconOnly ? aria : undefined}
        data-testid="capture-button"
      >
        <Camera className="h-4 w-4" />
        {label}
      </Button>
      {open && <CaptureDialog open={open} onOpenChange={setOpen} jobId={jobId} expectedKind={expectedKind} onSaved={onSaved} />}
    </>
  );
}
