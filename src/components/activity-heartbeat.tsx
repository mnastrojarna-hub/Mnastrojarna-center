"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { createActivityThrottle } from "@/lib/activity";

/** Odeslání tepu — nikdy neblokuje, chyby tiše (tep je jen doplněk). */
function sendBeat(path: string, keepalive = false): void {
  try {
    void fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
      keepalive,
      credentials: "same-origin",
    }).catch(() => undefined);
  } catch {
    // starý prohlížeč / odchod ze stránky — nevadí
  }
}

/**
 * Poslední aktivita (9. 11.): po skutečné akci uživatele (kliknutí / dotyk / klávesa) pošle „tep" se stránkou,
 * nejvýš 1× za minutu. Samotná otevřená karta, polling ani realtime tep neposílají. Akce během minuty, která ještě
 * neodešla, se dožene při skrytí karty (keepalive). Návrat na kartu nic nepošle — až první další akce (hned).
 * Super admin to vidí ve Správě uživatelů („Naposledy aktivní").
 */
export function ActivityHeartbeat() {
  const pathname = usePathname();
  // stránka, na které uživatel právě je (kliknutí na odkaz = ještě stará stránka — tam kliknul)
  const pathRef = React.useRef(pathname);
  React.useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  React.useEffect(() => {
    const throttle = createActivityThrottle();
    const onInteract = (e: Event) => {
      if (!e.isTrusted || document.visibilityState === "hidden") return;
      if (throttle.interaction(Date.now())) sendBeat(pathRef.current);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") throttle.visible();
      else if (throttle.flush(Date.now())) sendBeat(pathRef.current, true);
    };
    const onPageHide = () => {
      if (throttle.flush(Date.now())) sendBeat(pathRef.current, true);
    };
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    window.addEventListener("pointerdown", onInteract, opts);
    window.addEventListener("keydown", onInteract, opts);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pointerdown", onInteract, opts);
      window.removeEventListener("keydown", onInteract, opts);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  return null;
}
