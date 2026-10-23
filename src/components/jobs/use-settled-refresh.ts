"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/** Do kdy musí po akci dorazit nová data, jinak se stránka načte znovu (pojistka). */
export const ARRIVAL_MS = 6000;

/**
 * Obnovení stránky po dokončené server akci. Akce s revalidatePath stránku obnoví sama, ale
 * prohlížeč občas odpověď akce přeruší (ERR_ABORTED) a nová data se nevykreslí — proto jedno
 * pozdržené router.refresh() v přechodu (staré údaje zůstanou vidět, nic neposkočí).
 *
 * S `fingerprint` (otisk toho, co se akcí změní — např. klíč dalšího kroku řádku) hlídá i dorazení:
 * když se otisk do ARRIVAL_MS nezmění a komponenta pořád žije, router přechod uvízl (Kniha po
 * časné akci po načtení) a stránka se načte znovu — uživatel nikdy nezůstane u starého stavu.
 */
export function useSettledRefresh(delayMs = 250, fingerprint?: string): () => void {
  const router = useRouter();
  const timer = React.useRef<number | null>(null);
  const guard = React.useRef<number | null>(null);
  const armedFor = React.useRef<string | null>(null);
  const current = React.useRef(fingerprint);

  React.useEffect(() => {
    current.current = fingerprint;
    // nová data dorazila → pojistka už není potřeba
    if (armedFor.current !== null && armedFor.current !== fingerprint) {
      armedFor.current = null;
      if (guard.current) window.clearTimeout(guard.current);
      guard.current = null;
    }
  }, [fingerprint]);

  React.useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
    if (guard.current) window.clearTimeout(guard.current);
  }, []);

  return React.useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      React.startTransition(() => router.refresh());
    }, delayMs);
    if (current.current === undefined) return;
    if (guard.current) window.clearTimeout(guard.current);
    armedFor.current = current.current;
    guard.current = window.setTimeout(() => {
      guard.current = null;
      if (armedFor.current !== null && armedFor.current === current.current) window.location.reload();
    }, ARRIVAL_MS);
  }, [router, delayMs]);
}
