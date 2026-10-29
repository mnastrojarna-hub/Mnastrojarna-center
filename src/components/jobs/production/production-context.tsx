"use client";

import * as React from "react";
import type { OperationKind } from "@/lib/jobs/operations";
import type { JobOperation } from "@/lib/jobs/production-types";
import type { JobEvent } from "@/lib/jobs/types";
import type { HandoffKind } from "@/lib/jobs/production-handoff-types";
import type { JobStage } from "@/lib/supabase/database.types";
import { useJobDetail } from "@/components/jobs/detail/detail-context";

/**
 * Sdílený stav záložky „Výroba": operace (optimisticky), dnešek, dodavatelé,
 * otevírání dialogů a spouštění akcí (spinner, česká chyba, obnovení stránky).
 */

export type DialogState =
  | { type: "add"; at?: number; kind?: OperationKind }
  | { type: "edit"; op: JobOperation }
  | { type: "note"; op: JobOperation; mode: "problem" | "note" }
  | { type: "delete"; op: JobOperation }
  | { type: "template"; key: string }
  | { type: "complete" }
  /** Předání do výroby (kdo + termín + objednávka) — všechny druhy. */
  | { type: "handoff"; kind?: HandoffKind; operationId?: string; existingPurchaseOrderId?: string; target?: JobStage | null; replan?: boolean }
  | null;

/** Co smí uživatel v předání do výroby (ceny, potvrzení termínu, odeslání objednávek). */
export interface HandoffAccess {
  canSeePrices: boolean;
  canConfirmCustomerDate: boolean;
  canReceive: boolean;
  canSend: boolean;
  canCancelSent: boolean;
}

export interface ProductionCtxValue {
  jobId: string;
  /** Dnešek v Praze (RRRR-MM-DD). */
  today: string;
  ops: JobOperation[];
  setOps: React.Dispatch<React.SetStateAction<JobOperation[]>>;
  suppliers: { id: string; name: string }[];
  /** Historie zakázky — kdo co posunul / změnil. */
  events: JobEvent[];
  /** Smí mazat cokoli (super admin). */
  canDeleteAll: boolean;
  userId: string | null;
  open: (d: DialogState) => void;
  /** Stav zakázky (předání do výroby / posun / ukončení). */
  stage?: JobStage;
  /** Práva předání (bez nich žádné ceny ani odeslání). */
  permissions?: HandoffAccess | null;
  /** Konečný termín (zákazník). */
  finalDate?: { date: string | null; source: "due_date" | "customer_required_date" | null; maxTolerated: string | null } | null;
  /** Díly zakázky (rozsah kroku „Díly: 1 ze 2"). */
  items?: { id: string; drawingNumber: string | null; name: string | null }[];
}

const ProductionContext = React.createContext<ProductionCtxValue | null>(null);

export function ProductionProvider({ value, children }: { value: ProductionCtxValue; children: React.ReactNode }) {
  return <ProductionContext.Provider value={value}>{children}</ProductionContext.Provider>;
}

export function useProduction(): ProductionCtxValue {
  const ctx = React.useContext(ProductionContext);
  if (!ctx) throw new Error("useProduction mimo ProductionProvider");
  return ctx;
}

type Result = { ok: boolean; error?: string };

export interface RunOptions<T extends Result> {
  /** Text oznámení po úspěchu (null = bez oznámení). */
  success?: string | null | ((res: T) => string | null);
  /** Vrátit optimistickou změnu. */
  rollback?: () => void;
  /** Bez obnovení stránky (např. hned navazuje další akce). */
  noRefresh?: boolean;
}

/** Spouštění akcí: běžící klíče (spinnery), oznámení, router.refresh() po úspěchu. */
export function useRunner() {
  const { notify, refresh } = useJobDetail();
  const [busy, setBusy] = React.useState<Record<string, boolean>>({});

  const run = React.useCallback(
    async <T extends Result>(key: string, fn: () => Promise<T>, opts: RunOptions<T> = {}): Promise<T | null> => {
      setBusy((b) => ({ ...b, [key]: true }));
      try {
        const res = await fn();
        if (!res || !res.ok) {
          opts.rollback?.();
          notify("error", res?.error ?? "Nepovedlo se — zkus to znovu.");
          return null;
        }
        const msg = typeof opts.success === "function" ? opts.success(res) : opts.success;
        if (msg) notify("success", msg);
        if (!opts.noRefresh) refresh();
        return res;
      } catch {
        opts.rollback?.();
        notify("error", "Spojení se nepovedlo — zkus to znovu.");
        return null;
      } finally {
        setBusy((b) => {
          const next = { ...b };
          delete next[key];
          return next;
        });
      }
    },
    [notify, refresh],
  );

  const isBusy = React.useCallback((key: string) => Boolean(busy[key]), [busy]);
  return { run, isBusy, anyBusy: Object.keys(busy).length > 0 };
}
