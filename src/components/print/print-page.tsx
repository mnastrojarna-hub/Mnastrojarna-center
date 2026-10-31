"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PRINT_MSG, safePrintSrc, type PrintMessage } from "@/lib/print/print-links";
import { PrintDocument, type PrintEvent } from "./print-document";

/**
 * Tisková stránka /print?src=…: náhled stran, „Tisknout" (systémový dialog — výběr tiskárny, AirPrint,
 * Android tisk / Uložit jako PDF) a „Zpět". Tisk se po vykreslení otevře sám. `embed` = skrytý rám
 * z aplikace na počítači (stav posílá rodičovské stránce).
 */
export function PrintPage({ src, name, embed }: { src: string | null; name: string | null; embed: boolean }) {
  const router = useRouter();
  const safe = safePrintSrc(src);

  const back = React.useCallback(() => {
    // otevřeno v nové kartě (Safari na počítači) → zavřít kartu
    if (window.opener && !window.opener.closed) {
      window.close();
      return;
    }
    const sameOrigin = document.referrer.startsWith(window.location.origin);
    if (window.history.length > 1 && sameOrigin) router.back();
    else router.push("/documents");
  }, [router]);

  const onEvent = React.useCallback(
    (e: PrintEvent) => {
      if (!embed || window.parent === window) return;
      window.parent.postMessage({ source: PRINT_MSG, ...e } as PrintMessage, window.location.origin);
    },
    [embed],
  );

  // stránka (ne rám) nemá vlastní pozadí aplikace → šedé pozadí za stranami
  React.useEffect(() => {
    document.body.classList.add("mn-print-body");
    return () => document.body.classList.remove("mn-print-body");
  }, []);

  const source = React.useMemo(() => ({ src: safe, name }), [safe, name]);

  React.useEffect(() => {
    if (!safe) onEvent({ type: "error", message: "Neplatný odkaz na dokument." });
  }, [safe, onEvent]);

  if (!safe) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center" data-testid="print-invalid">
        <p className="font-semibold">Neplatný odkaz na dokument.</p>
        <button type="button" onClick={back} className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
          <ArrowLeft className="h-5 w-5" /> Zpět
        </button>
      </div>
    );
  }
  return <PrintDocument source={source} mode={embed ? "embed" : "page"} onBack={embed ? undefined : back} onEvent={onEvent} />;
}
