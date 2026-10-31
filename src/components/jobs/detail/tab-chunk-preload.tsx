"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { detailTabOf } from "./tab-keys";
import { preloadDetailTab } from "./tab-chunks";

/**
 * V layoutu aplikace: jakmile adresa míří na kartu zakázky se záložkou (/orders/…?tab=nabidky), začne
 * stahovat JS té záložky — při navigaci se to děje hned s kostrou stránky, souběžně s daty karty,
 * takže karta záložku vykreslí rovnou (viz lazy-tabs.tsx). Nic nevykresluje.
 */
export function TabChunkPreload() {
  const pathname = usePathname();
  const tab = useSearchParams()?.get("tab") ?? null;
  const onJob = /^\/orders\/[^/]+$/.test(pathname ?? "");
  React.useEffect(() => {
    if (onJob) void preloadDetailTab(detailTabOf(tab));
  }, [onJob, tab]);
  return null;
}
