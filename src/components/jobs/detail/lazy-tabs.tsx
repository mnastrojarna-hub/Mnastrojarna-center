"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { loadedDetailTab, type LazyDetailTab } from "./tab-chunks";
import { isChunkLoadError, reloadForStaleChunks } from "@/components/layout/chunk-reload";

/**
 * Záložky karty zakázky mimo Přehled a Položky se načítají až při otevření (menší JavaScript karty,
 * rychlejší první vykreslení hlavně na mobilu).
 *
 * Záložka otevřená odkazem (?tab=… z Knihy, toků, pošty, upozornění, „Vytvořit nabídku") se ale nesmí
 * ukázat jako kostra:
 *  - při načtení stránky ji vykreslí server (next/dynamic s SSR; PreloadChunks přidá preload jejího JS),
 *    hydratace serverové HTML ponechá,
 *  - při navigaci v aplikaci začne její JS stahovat layout (TabChunkPreload) hned se změnou adresy,
 *    souběžně s daty karty — karta pak záložku vykreslí rovnou (bez React.lazy → bez kostry).
 * Kostru (TabLoading) tak uvidí jen ten, kdo záložku poprvé otevře kliknutím.
 */
function TabLoading() {
  return <div className="h-40 animate-pulse rounded-xl border bg-muted/40" aria-busy="true" aria-label="Načítám záložku…" />;
}

/**
 * Chyba uvnitř záložky (vykreslení, nebo JavaScript záložky se nepodařilo stáhnout — třeba po nasazení nové
 * verze) nesmí nechat prázdné místo: česká hláška s důvodem a „Zkusit znovu"; zastaralé soubory → stránka se
 * obnoví sama (ChunkReload).
 */
class TabErrorBoundary extends React.Component<{ children: React.ReactNode; tab: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    if (isChunkLoadError(error)) reloadForStaleChunks();
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isChunkLoadError(error);
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100" role="alert" data-testid={`tab-error-${this.props.tab}`}>
        <p className="font-semibold">{stale ? "Aplikace má novou verzi — obnovuji stránku…" : "Záložku se nepodařilo zobrazit."}</p>
        <p className="mt-1 break-words font-mono text-xs opacity-80">{error.message}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent" onClick={() => this.setState({ error: null })}>Zkusit znovu</button>
          <button type="button" className="rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent" onClick={() => window.location.reload()}>Obnovit stránku</button>
        </div>
      </div>
    );
  }
}

/**
 * `Dyn` = next/dynamic BEZ `loading` (bez vlastní Suspense — stejná struktura na serveru i klientu),
 * už stažený modul (tab-chunks) se vykreslí přímo.
 */
function lazyTab<P extends object>(key: LazyDetailTab, Dyn: React.ComponentType<P>) {
  function Tab(props: P) {
    // volba platí po celou dobu připojení — přepnutí typu komponenty by záložku znovu připojilo (ztráta stavu)
    const [C] = React.useState<React.ComponentType<P>>(() => (loadedDetailTab(key) as unknown as React.ComponentType<P> | null) ?? Dyn);
    return (
      <TabErrorBoundary tab={key}>
        <React.Suspense fallback={<TabLoading />}>
          <C {...props} />
        </React.Suspense>
      </TabErrorBoundary>
    );
  }
  Tab.displayName = `LazyTab(${key})`;
  return Tab;
}

export const QuotesTab = lazyTab("nabidky", dynamic(() => import("./quotes-tab").then((m) => m.QuotesTab)));
export const DocumentsTab = lazyTab("dokumenty", dynamic(() => import("./documents-tab").then((m) => m.DocumentsTab)));
export const HistoryTab = lazyTab("historie", dynamic(() => import("./history-tab").then((m) => m.HistoryTab)));
export const CommunicationTab = lazyTab(
  "komunikace",
  dynamic(() => import("@/components/jobs/communication/communication-tab").then((m) => m.CommunicationTab)),
);
export const ProductionTab = lazyTab(
  "vyroba",
  dynamic(() => import("@/components/jobs/production/production-tab").then((m) => m.ProductionTab)),
);
export const PurchasingTab = lazyTab(
  "nakup",
  dynamic(() => import("@/components/jobs/purchasing/purchasing-tab").then((m) => m.PurchasingTab)),
);
