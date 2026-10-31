"use client";

import * as React from "react";
import type { JobRfqData } from "@/lib/rfq/store";
import type { OperationKind } from "@/lib/jobs/operations";
import { rfqSummary } from "@/lib/rfq/model";

/**
 * Poptávky dodavatelům na kartě zakázky: data kol + „Poptat dodavatele" odkudkoli (hlavička, Technologie, Nákup,
 * krok technologie, odkaz z Poptávek / Nacenění ?akce=rfq.create).
 */

export interface RfqOpenOptions {
  /** Jen tyto položky (krok technologie). */
  itemIds?: string[] | null;
  /** Poptat jen operaci (např. kalení). */
  kinds?: OperationKind[] | null;
}

interface RfqContextValue {
  jobId: string;
  data: JobRfqData | null;
  canRfq: boolean;
  open: (opts?: RfqOpenOptions) => void;
  /** Krátké shrnutí posledního otevřeného kola („Poptáno: 3 · odpověděli 1"). */
  summary: { number: string; text: string; asked: number; answered: number; offers: number } | null;
}

const RfqContext = React.createContext<RfqContextValue | null>(null);

export function useRfq(): RfqContextValue | null {
  return React.useContext(RfqContext);
}

const RfqDialog = React.lazy(() => import("./rfq-dialog").then((m) => ({ default: m.RfqDialog })));

export function RfqProvider({ jobId, data, canRfq, initialOpen = false, children }: {
  jobId: string;
  data: JobRfqData | null;
  canRfq: boolean;
  initialOpen?: boolean;
  children: React.ReactNode;
}) {
  const [state, setState] = React.useState<{ open: boolean; opts: RfqOpenOptions }>({ open: canRfq && initialOpen, opts: {} });
  const open = React.useCallback((opts: RfqOpenOptions = {}) => setState({ open: true, opts }), []);
  const summary = React.useMemo(() => {
    const live = data?.rounds.find((r) => r.status === "otevrene") ?? data?.rounds[0] ?? null;
    if (!live) return null;
    return { number: live.number, ...rfqSummary(live) };
  }, [data]);
  const value = React.useMemo(() => ({ jobId, data, canRfq, open, summary }), [jobId, data, canRfq, open, summary]);
  return (
    <RfqContext.Provider value={value}>
      {children}
      {canRfq && state.open && (
        <React.Suspense fallback={null}>
          <RfqDialog jobId={jobId} opts={state.opts} onClose={() => setState((s) => ({ ...s, open: false }))} />
        </React.Suspense>
      )}
    </RfqContext.Provider>
  );
}
