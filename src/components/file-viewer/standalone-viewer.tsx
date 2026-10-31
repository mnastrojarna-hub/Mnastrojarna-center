"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileViewer } from "./file-viewer";
import { safeViewerSrc } from "./viewer-links";

/** Prohlížeč přes celou obrazovku na vlastní adrese (/view?src=…). Zpět = předchozí stránka, jinak Dokumenty. */
export function StandaloneViewer({ src, name }: { src: string | null; name: string | null }) {
  const router = useRouter();
  const safe = safeViewerSrc(src);
  const back = React.useCallback(() => {
    const sameOrigin = typeof document !== "undefined" && document.referrer.startsWith(window.location.origin);
    if (window.history.length > 1 && sameOrigin) router.back();
    else router.push("/documents");
  }, [router]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background">
      {safe ? (
        <FileViewer request={{ href: safe, filename: name }} onBack={back} standalone />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="font-semibold">Neplatný odkaz na dokument.</p>
          <button type="button" onClick={back} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Zpět</button>
        </div>
      )}
    </div>
  );
}
