"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { loadedDetailTab, type LazyDetailTab } from "./tab-chunks";

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
 * `Dyn` = next/dynamic BEZ `loading` (bez vlastní Suspense — stejná struktura na serveru i klientu),
 * už stažený modul (tab-chunks) se vykreslí přímo.
 */
function lazyTab<P extends object>(key: LazyDetailTab, Dyn: React.ComponentType<P>) {
  function Tab(props: P) {
    // volba platí po celou dobu připojení — přepnutí typu komponenty by záložku znovu připojilo (ztráta stavu)
    const [C] = React.useState<React.ComponentType<P>>(() => (loadedDetailTab(key) as unknown as React.ComponentType<P> | null) ?? Dyn);
    return (
      <React.Suspense fallback={<TabLoading />}>
        <C {...props} />
      </React.Suspense>
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
