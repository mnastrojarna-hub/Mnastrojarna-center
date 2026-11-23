"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { flushOutboxAction } from "@/app/actions/mail-compose";

/**
 * Moje zprávy v „K odeslání" (selhal SMTP) se zkusí odeslat znovu samy — nejvýš jednou za 5 minut na
 * prohlížeč (majitel 23. 11.: kliknutý e-mail musí odejít). Po odeslání se stránka obnoví a lišta zmizí.
 */
export function UnsentMailRetry() {
  const router = useRouter();
  React.useEffect(() => {
    const KEY = "unsent-mail-retry-at";
    try {
      const last = Number(window.sessionStorage.getItem(KEY) ?? "0");
      if (Date.now() - last < 5 * 60_000) return;
      window.sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      // bez úložiště se zkusí při každém načtení — nevadí
    }
    let alive = true;
    flushOutboxAction().then((r) => {
      if (alive && r.ok && r.sent > 0) router.refresh();
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [router]);
  return null;
}
