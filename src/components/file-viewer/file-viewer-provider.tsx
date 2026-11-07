"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { FileViewer, type ViewerRequest } from "./file-viewer";
import { filenameFromAnchor, isViewableName, isViewerPath } from "./viewer-links";
import { FILE_VIEWER_EVENT, markFileViewerReady, resolveViewerSet } from "./viewer-bus";
import { stepIndex, type ViewerSetEntry } from "@/lib/jobs/drawing-set";

/**
 * Otevírání dokumentů v aplikaci: klik na PDF / výkres / 3D model / fotku (odkazy na /api/…)
 * otevře prohlížeč přes celou obrazovku ve STEJNÉ kartě. Otevření přidá záznam do historie,
 * takže tlačítko „Zpět" v prohlížeči i systémové zpět na telefonu (gesto, tlačítko Androidu)
 * prohlížeč zavře a vrátí uživatele přesně tam, kde byl (stránka pod ním zůstává načtená).
 * Ctrl / Cmd / Shift / prostřední klik dál otevírá novou kartu.
 *
 * Prohlížeč je vrstvený dialog (Radix) — funguje i nad otevřeným dialogem (náhled PDF
 * při odesílání nabídky): Esc a klikání patří prohlížeči, dialog pod ním zůstane, jak byl.
 *
 * Výkres zakázky (sada z registerViewerSet) jde swipem / ‹ › / šipkami přepnout na další výkres
 * bez zavření; přepnutí historii nemění (jedno „Zpět" prohlížeč zavře).
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
  const [set, setSet] = React.useState<{ list: ViewerSetEntry[]; index: number } | null>(null);
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
    // výkres zakázky → sada k listování (jen u odkazu bez vlastního obsahu / tlačítek)
    const hit = r.blob || r.toolbar ? null : resolveViewerSet(r.href);
    setSet(hit);
    const entry = hit?.list[hit.index];
    setReq(entry ? { ...r, filename: r.filename || entry.filename, info: r.info ?? entry.info } : r);
  }, []);

  const setRef = React.useRef(set);
  setRef.current = set;
  const go = React.useCallback((dir: 1 | -1) => {
    const cur = setRef.current;
    if (!cur || cur.list.length < 2 || !reqRef.current) return;
    const index = stepIndex(cur.index, cur.list.length, dir);
    const e = cur.list[index];
    setSet({ ...cur, index });
    setReq({ href: e.href, filename: e.filename, info: e.info });
  }, []);

  const close = React.useCallback(() => {
    if (pushed.current) {
      // zavře popstate níže (stejně jako systémové zpět)
      window.history.back();
      return;
    }
    setReq(null);
    setSet(null);
  }, []);

  // systémové / prohlížečové zpět zavře prohlížeč — jen když historie opravdu opustila jeho položku
  // (vpřed zpátky na ni ho nechá otevřený). Gesta prohlížeče „zpět" z přetažení obsahu (touchpad, Magic Mouse,
  // tažení na telefonu) jsou vypnutá v globals.css (overscroll-behavior: none na html/body).
  React.useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (!reqRef.current) return;
      const state = e.state as Record<string, unknown> | null;
      if (state && state[STATE_KEY]) return;
      pushed.current = false;
      setReq(null);
      setSet(null);
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
            className="fixed inset-0 z-[60] flex flex-col overscroll-contain bg-background outline-none"
            onOpenAutoFocus={(e) => e.preventDefault()}
            data-testid="file-viewer-layer"
          >
            <DialogPrimitive.Title className="sr-only">Prohlížeč dokumentu</DialogPrimitive.Title>
            {req && (
              <FileViewer
                key={req.href}
                request={req}
                onBack={close}
                nav={set && set.list.length > 1 ? { index: set.index, count: set.list.length, prev: () => go(-1), next: () => go(1) } : undefined}
              />
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </FileViewerContext.Provider>
  );
}
