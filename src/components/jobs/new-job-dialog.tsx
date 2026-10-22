"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button, type ButtonProps } from "@/components/ui/button";
import { JobForm, type JobFormInitial, type JobFormValues } from "@/components/jobs/job-form";
import { createJob } from "@/app/actions/jobs";
import type { JobFormOptions } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";

/**
 * „+ Nová zakázka" — ruční založení celé zakázky. Po uložení otevře detail.
 * Rozepsaný formulář se nezavře omylem (klik mimo, Esc v hledání zákazníka).
 */
export function NewJobDialog({
  options,
  initial,
  label = "Nová zakázka",
  variant = "default",
  size,
  className,
  defaultOpen = false,
  autoOpen = false,
}: {
  options: JobFormOptions;
  initial?: JobFormInitial;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  defaultOpen?: boolean;
  /** Otevřít po načtení a odebrat `?new=1` z adresy (⌘K „Nová zakázka"). */
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(defaultOpen);
  const [dirty, setDirty] = React.useState(false);
  const [navigating, setNavigating] = React.useState(false);
  const opened = React.useRef(false);

  React.useEffect(() => {
    if (!autoOpen) {
      opened.current = false;
      return;
    }
    if (opened.current) return;
    opened.current = true;
    setOpen(true);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("new")) {
        url.searchParams.delete("new");
        router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
      }
    } catch {
      // adresa jen kosmetika
    }
  }, [autoOpen, router]);

  function requestClose() {
    if (navigating) return;
    if (dirty && !window.confirm("Zahodit rozepsanou zakázku?")) return;
    setOpen(false);
    setDirty(false);
  }

  async function submit(values: JobFormValues) {
    const res = await createJob(values);
    if (!res.ok || !res.id) return { ok: false, error: res.error ?? "Zakázku se nepodařilo založit." };
    setNavigating(true);
    setDirty(false);
    router.push(`/orders/${res.id}`);
    return { ok: true };
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setNavigating(false);
          setOpen(true);
        } else requestClose();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant={variant} size={size} className={className}>
          <Plus /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        onInteractOutside={(e) => {
          if (dirty || navigating) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          // Esc v otevřeném hledání (zákazník, dodavatel) zavře jen seznam
          const el = document.activeElement;
          if (el instanceof HTMLElement && el.closest("[data-combobox-open]")) e.preventDefault();
        }}
        className={cn(
          "top-0 flex h-[100dvh] max-w-4xl flex-col overflow-hidden rounded-none",
          "sm:top-[3vh] sm:h-auto sm:max-h-[94vh] sm:w-[calc(100%-2rem)] sm:rounded-xl",
        )}
      >
        <div className="flex items-start gap-3 border-b px-4 py-3 pr-12 sm:px-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
            <Plus className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <DialogTitle>Nová zakázka</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Vyplň, co víš — zbytek doplníš kdykoli později.{" "}
              <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
                <Camera className="h-3 w-3" /> Rychlejší je vyfotit doklad.
              </span>
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pt-4 scrollbar-thin sm:px-6">
          <JobForm
            options={options}
            initial={initial}
            onSubmit={submit}
            onCancel={requestClose}
            onDirtyChange={setDirty}
            busy={navigating}
            submitLabel={navigating ? "Otevírám zakázku…" : "Založit zakázku"}
            stickyFooter
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
