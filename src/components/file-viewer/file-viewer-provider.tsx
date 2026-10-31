"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { FileViewer, type ViewerRequest } from "./file-viewer";
import { filenameFromAnchor, isViewableName, isViewerPath } from "./viewer-links";
import { FILE_VIEWER_EVENT, markFileViewerReady } from "./viewer-bus";

/**
 * Otevírání dokumentů v aplikaci: klik na PDF / výkres / 3D model / fotku (odkazy na /api/…)
 * otevře prohlížeč přes celou obrazovku ve STEJNÉ kartě. Otevření přidá záznam do historie,
 * takže tlačítko „Zpět" v prohlížeči i systémové zpět na telefonu (gesto, tlačítko Androidu)
 * prohlížeč zavře a vrátí uživatele přesně tam, kde byl (stránka pod ním zůstává načtená).
 * Ctrl / Cmd / Shift / prostřední klik dál otevírá novou kartu.
 *
 * Prohlížeč je vrstvený dialog (Radix) — funguje i nad otevřeným dialogem (náhled PDF
 * při odesílání nabídky): Esc a klikání patří prohlížeči, dialog pod ním zůstane, jak byl.
 */

interface Ctx {
  open: (req: ViewerRequest) => void;
  close: () => void;
}

const FileViewerContext = React.createContext<Ctx | null>(null);

export function useFileViewer(): Ctx | null {
  return React.useContext(FileViewerContext);
}

const STATE_KEY = "__mnFileViewer";

export function FileViewerProvider({ children }: { children: React.ReactNode }) {
  const [req, setReq] = React.useState<ViewerRequest | null>(null);
  const pushed = React.useRef(false);
  const reqRef = React.useRef<ViewerRequest | null>(null);
  reqRef.current = req;

  const open = React.useCallback((r: ViewerRequest) => {
    if (!reqRef.current) {
      try {
        const cur = (window.history.state ?? {}) as Record<string, unknown>;
        window.history.pushState({ ...cur, [STATE_KEY]: Date.now() }, "");
        pushed.current = true;
      } catch {
        pushed.current = false;
      }
    }
    setReq(r);
  }, []);

  const close = React.useCallback(() => {
    if (pushed.current) {
      // zavře popstate níže (stejně jako systémové zpět)
      window.history.back();
      return;
    }
    setReq(null);
  }, []);

  // systémové / prohlížečové zpět zavře prohlížeč
  React.useEffect(() => {
    const onPop = () => {
      if (!reqRef.current) return;
      pushed.current = false;
      setReq(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // otevření z kódu (náhled PDF vytvořený na serveru apod.)
  React.useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<ViewerRequest>).detail;
      if (detail?.href || detail?.blob) open(detail);
    };
    window.addEventListener(FILE_VIEWER_EVENT, onOpen);
    const unmark = markFileViewerReady();
    return () => {
      window.removeEventListener(FILE_VIEWER_EVENT, onOpen);
      unmark();
    };
  }, [open]);

  // kliky na odkazy dokumentů → prohlížeč
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.hasAttribute("download") || a.hasAttribute("data-no-viewer")) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin || !isViewerPath(url.pathname)) return;
      if (url.searchParams.get("download") === "1") return;
      const filename = filenameFromAnchor(a);
      if (isViewableName(filename) === false) return;
      e.preventDefault();
      open({ href: url.pathname + url.search, filename });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open]);

  const value = React.useMemo(() => ({ open, close }), [open, close]);

  return (
    <FileViewerContext.Provider value={value}>
      {children}
      <DialogPrimitive.Root open={!!req} onOpenChange={(o) => !o && close()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-0 z-[60] flex flex-col bg-background outline-none"
            onOpenAutoFocus={(e) => e.preventDefault()}
            data-testid="file-viewer-layer"
          >
            <DialogPrimitive.Title className="sr-only">Prohlížeč dokumentu</DialogPrimitive.Title>
            {req && <FileViewer key={req.href} request={req} onBack={close} />}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </FileViewerContext.Provider>
  );
}
