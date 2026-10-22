"use client";

import * as React from "react";
import { Loader2, AlertCircle, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Hlavička dialogu s barevnou ikonou (styl aplikace). */
export function DialogHead({
  icon: Icon, tone, title, subtitle,
}: { icon: LucideIcon; tone: string; title: string; subtitle?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b px-5 py-4 pr-12">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", tone)}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <DialogTitle>{title}</DialogTitle>
        {subtitle && <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div>}
      </div>
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{error}</span>
    </div>
  );
}

/**
 * Potvrzovací dialog. onConfirm vrací chybu (zůstane otevřený) nebo null (zavře se).
 */
export function ConfirmDialog({
  open, onOpenChange, icon, tone, title, children, confirmLabel, confirmVariant = "default", onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon: LucideIcon;
  tone: string;
  title: string;
  children?: React.ReactNode;
  confirmLabel: string;
  confirmVariant?: ButtonProps["variant"];
  onConfirm: () => Promise<string | null>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const err = await onConfirm();
      if (err) setError(err);
      else onOpenChange(false);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!busy) {
          setError(null);
          onOpenChange(o);
        }
      }}
    >
      <DialogContent aria-describedby={undefined} className="w-[calc(100%-1.5rem)] sm:max-w-md">
        <DialogHead icon={icon} tone={tone} title={title} />
        <div className="space-y-4 p-5">
          {children && <div className="text-sm leading-relaxed text-muted-foreground">{children}</div>}
          <ErrorBox error={error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Zpět</Button>
            <Button type="button" variant={confirmVariant} onClick={() => void run()} disabled={busy} autoFocus>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
