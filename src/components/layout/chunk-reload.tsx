"use client";

import * as React from "react";

/**
 * Po nasazení nové verze může otevřená stránka ukazovat na JavaScript (chunky), který na serveru už není.
 * Prohlížeč pak část stránky (záložku, dialog) vůbec nevykreslí a zůstane prázdné místo (majitel 5. 11.:
 * „dvojité okno, karta zakázky utnutá pod dlaždicemi"). Takovou chybu zachytíme a stránku jednou
 * obnovíme (ne v cyklu — nejvýš jednou za 2 minuty); obnovená stránka už má aktuální soubory.
 */
const STAMP = "mn:chunk-reload";
const MIN_GAP_MS = 2 * 60 * 1000;

export function isChunkLoadError(input: unknown): boolean {
  const e = input as { name?: unknown; message?: unknown } | null | undefined;
  const name = typeof e?.name === "string" ? e.name : "";
  const msg = typeof e?.message === "string" ? e.message : typeof input === "string" ? input : "";
  return name === "ChunkLoadError"
    || /Loading (CSS )?chunk [\w-]+ failed/i.test(msg)
    || /Failed to fetch dynamically imported module/i.test(msg)
    || /Importing a module script failed/i.test(msg)
    || /error loading dynamically imported module/i.test(msg);
}

/** Obnoví stránku kvůli zastaralým souborům — nejvýš jednou za MIN_GAP_MS (bez smyčky). Vrací, zda obnovil. */
export function reloadForStaleChunks(now = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  try {
    const last = Number(window.sessionStorage.getItem(STAMP) ?? "0");
    if (now - last < MIN_GAP_MS) return false;
    window.sessionStorage.setItem(STAMP, String(now));
  } catch {
    // bez sessionStorage radši neobnovovat v cyklu
    return false;
  }
  window.location.reload();
  return true;
}

export function ChunkReload() {
  React.useEffect(() => {
    const onError = (ev: ErrorEvent) => {
      if (isChunkLoadError(ev.error) || isChunkLoadError(ev.message)) reloadForStaleChunks();
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      if (isChunkLoadError(ev.reason)) reloadForStaleChunks();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
