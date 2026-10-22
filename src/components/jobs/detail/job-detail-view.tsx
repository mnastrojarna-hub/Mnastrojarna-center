"use client";

import * as React from "react";
import { LayoutDashboard, Factory, Package, FileText, ShoppingBag, Paperclip, History, type LucideIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { JobDetail, JobFormOptions } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";
import { JobDetailProvider, type DetailPerms } from "./detail-context";
import { JobToolbar, JobHeader } from "./job-header";
import { StageTimeline } from "./stage-timeline";
import { DeadlinePanel } from "./deadline-panel";
import { OverviewTab } from "./overview-tab";
import { ItemsTab } from "./items-tab";
import { QuotesTab } from "./quotes-tab";
import { DocumentsTab } from "./documents-tab";
import { HistoryTab } from "./history-tab";
import { UploadQueue } from "./upload-controls";
import { isDetailTab, type DetailTab } from "./detail-helpers";
import { ProductionTab, type JobProductionData } from "@/components/jobs/production/production-tab";
import { PurchasingTab } from "@/components/jobs/purchasing/purchasing-tab";
import type { JobPurchasing } from "@/lib/jobs/purchasing-types";

const TABS: { key: DetailTab; label: string; icon: LucideIcon; tone: string; count: string }[] = [
  { key: "prehled", label: "Přehled", icon: LayoutDashboard, tone: "text-sky-600 dark:text-sky-400", count: "" },
  { key: "vyroba", label: "Výroba", icon: Factory, tone: "text-yellow-600 dark:text-yellow-400", count: "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300" },
  { key: "polozky", label: "Položky", icon: Package, tone: "text-blue-600 dark:text-blue-400", count: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300" },
  { key: "nabidky", label: "Nabídky", icon: FileText, tone: "text-violet-600 dark:text-violet-400", count: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300" },
  { key: "nakup", label: "Nákup & marže", icon: ShoppingBag, tone: "text-lime-600 dark:text-lime-400", count: "bg-lime-100 text-lime-800 dark:bg-lime-500/20 dark:text-lime-300" },
  { key: "dokumenty", label: "Dokumenty", icon: Paperclip, tone: "text-rose-600 dark:text-rose-400", count: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300" },
  { key: "historie", label: "Historie", icon: History, tone: "text-slate-600 dark:text-slate-400", count: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300" },
];

/**
 * Karta zakázky (/orders/[id]) — vše k jedné zakázce na jednom místě:
 * hlavička se stavem, časová osa, termíny a záložky.
 */
export function JobDetailView({
  job, options, perms, initialTab, production, purchasing,
}: {
  job: JobDetail;
  options: JobFormOptions;
  perms: DetailPerms;
  initialTab?: string;
  /** Výrobní postup a konec toku (dokud se nenačte, záložka ukáže prázdný stav). */
  production?: JobProductionData | null;
  /** Nákup a marže — jen pro role s právem „margins" (jinak null → záložka se skryje). */
  purchasing?: JobPurchasing | null;
}) {
  const tabs = TABS.filter((t) => t.key !== "nakup" || Boolean(purchasing));
  const [tab, setTab] = React.useState<DetailTab>(
    isDetailTab(initialTab) && tabs.some((t) => t.key === initialTab) ? initialTab : "prehled",
  );
  const [itemsDirty, setItemsDirty] = React.useState(false);

  function changeTab(next: string) {
    if (!isDetailTab(next) || !tabs.some((t) => t.key === next)) return;
    setTab(next);
    // záložka v adrese (sdílení odkazu, zpět) bez nového načtení stránky
    try {
      const url = new URL(window.location.href);
      if (next === "prehled") url.searchParams.delete("tab");
      else url.searchParams.set("tab", next);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      // adresa je jen pohodlí
    }
  }

  const counts: Record<DetailTab, number> = {
    prehled: 0,
    vyroba: production?.summary.total ?? 0,
    polozky: job.items.length,
    nabidky: job.quotes.filter((q) => !q.archived).length,
    nakup: (purchasing?.supplierQuotes.length ?? 0) + (purchasing?.purchaseOrders.length ?? 0),
    dokumenty: job.files.filter((f) => !f.archived).length,
    historie: job.events.length,
  };

  return (
    <JobDetailProvider jobId={job.id} perms={perms} options={options}>
      <div className="space-y-4">
        <JobToolbar job={job} />
        <JobHeader job={job} />
        {tab !== "dokumenty" && <UploadQueue />}
        <StageTimeline job={job} />
        <DeadlinePanel job={job} />

        <Tabs value={tab} onValueChange={changeTab} className="pt-1">
          <div className="-mx-4 overflow-x-auto px-4 scrollbar-thin sm:mx-0 sm:px-0">
            <TabsList className="h-auto w-max gap-1 rounded-xl p-1 sm:w-auto">
              {tabs.map((t) => {
                const Icon = t.icon;
                const n = counts[t.key];
                return (
                  <TabsTrigger key={t.key} value={t.key} className="gap-1.5 rounded-lg px-3 py-1.5">
                    <Icon className={cn("h-4 w-4", t.tone)} />
                    {t.label}
                    {t.key === "polozky" && itemsDirty && <span className="h-2 w-2 rounded-full bg-amber-500" title="Neuložené změny" />}
                    {t.key !== "prehled" && n > 0 && (
                      <span className={cn("min-w-[1.25rem] rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums", t.count)}>{n}</span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          <TabsContent value="prehled">
            <OverviewTab job={job} />
          </TabsContent>
          <TabsContent value="vyroba">
            <ProductionTab job={job} data={production ?? null} />
          </TabsContent>
          {/* položky zůstávají připojené, ať se neuložené změny při přepnutí záložky neztratí */}
          <TabsContent value="polozky" forceMount className="data-[state=inactive]:hidden">
            <ItemsTab items={job.items} currency={job.currency} onDirtyChange={setItemsDirty} />
          </TabsContent>
          <TabsContent value="nabidky">
            <QuotesTab job={job} />
          </TabsContent>
          {purchasing && (
            <TabsContent value="nakup">
              <PurchasingTab job={job} data={purchasing} />
            </TabsContent>
          )}
          <TabsContent value="dokumenty">
            <DocumentsTab files={job.files} quotes={job.quotes} />
          </TabsContent>
          <TabsContent value="historie">
            <HistoryTab events={job.events} />
          </TabsContent>
        </Tabs>
      </div>
    </JobDetailProvider>
  );
}
