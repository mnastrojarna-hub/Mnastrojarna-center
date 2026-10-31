import type { ComponentType } from "react";
import type { DetailTab } from "./tab-keys";

/**
 * JavaScript záložek karty zakázky, které se načítají až při otevření (lazy-tabs.tsx). Tady jen odkazy
 * na jejich bloky (import() nic nepřibalí) + paměť už stažených komponent — modul je malý, ať ho může
 * načítat i layout aplikace (TabChunkPreload) a začít stahovat záložku z ?tab= hned při navigaci.
 */
// registr různých komponent (props hlídá lazy-tabs)
type AnyComponent = ComponentType<never>;
export type LazyDetailTab = Exclude<DetailTab, "prehled" | "polozky">;

const LOADERS: Record<LazyDetailTab, () => Promise<AnyComponent>> = {
  nabidky: () => import("./quotes-tab").then((m) => m.QuotesTab),
  dokumenty: () => import("./documents-tab").then((m) => m.DocumentsTab),
  historie: () => import("./history-tab").then((m) => m.HistoryTab),
  komunikace: () => import("@/components/jobs/communication/communication-tab").then((m) => m.CommunicationTab),
  vyroba: () => import("@/components/jobs/production/production-tab").then((m) => m.ProductionTab),
  nakup: () => import("@/components/jobs/purchasing/purchasing-tab").then((m) => m.PurchasingTab),
};

const loaded: Partial<Record<LazyDetailTab, AnyComponent>> = {};
const pending: Partial<Record<LazyDetailTab, Promise<unknown>>> = {};

function isLazyTab(tab: DetailTab): tab is LazyDetailTab {
  return tab in LOADERS;
}

/** Začne stahovat JS záložky (Přehled a Položky jsou v kartě vždy → nic). */
export function preloadDetailTab(tab: DetailTab | null | undefined): Promise<unknown> | undefined {
  if (!tab || !isLazyTab(tab)) return undefined;
  return (pending[tab] ??= LOADERS[tab]().then(
    (c) => {
      loaded[tab] = c;
    },
    () => {
      delete pending[tab]; // síť: zkusí se znovu při dalším otevření
    },
  ));
}

/** Už stažená komponenta záložky (vykreslí se hned, bez Suspense kostry), jinak null. */
export function loadedDetailTab(tab: LazyDetailTab): AnyComponent | null {
  return loaded[tab] ?? null;
}
