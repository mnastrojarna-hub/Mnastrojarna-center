"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { FileViewer, type ViewerRequest } from "./file-viewer";
import { filenameFromAnchor, isViewableName, isViewerPath } from "./viewer-links";
import { FILE_VIEWER_EVENT, markFileViewerReady, resolveViewerSet, setFileViewerOpen } from "./viewer-bus";
import { stepIndex, type DrawingInfo, type ViewerSetEntry } from "@/lib/jobs/drawing-set";

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
 *
 * Otevřený prohlížeč přežije načtení stránky znovu (majitel 10. 11., Windows 7 + Chrome: „otevřu PDF
 * v Dokumentech, točím kolečkem a zavře se to"). Karta zakázky během anonymizace výkresů obnovuje data
 * (router.refresh každých 6 s); když odpověď přijde z novějšího nasazení nebo s chybou, Next.js stránku
 * načte celou znovu — a prohlížeč, který je jen stav v paměti, zmizel. Teď (1) se obnovení na pozadí
 * odloží, dokud je prohlížeč otevřený (viewer-bus), a (2) kdyby se stránka přesto načetla znovu (nové
 * nasazení, F5), prohlížeč se na stejné adrese otevře zase (sessionStorage této karty).
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
/** Otevřený dokument této karty (sessionStorage) — obnova prohlížeče po načtení stránky znovu. */
export const VIEWER_RESTORE_KEY = "mn:file-viewer:open";
/** Obnovit jen po rychlém návratu (načtení znovu), ne když se uživatel na adresu vrátí později. */
export const VIEWER_RESTORE_MS = 60_000;

export interface SavedViewer {
  /** Adresa stránky, nad kterou byl prohlížeč otevřený (celá, i s parametry). */
  url: string;
  href: string;
  filename: string | null;
  info: DrawingInfo | null;
  /** Kdy stránka odešla (pagehide) — null = prohlížeč je otevřený na živé stránce. */
  hiddenAt: number | null;
}

/** Uložený záznam → požadavek k obnově (jen stejná adresa a nedávný odchod), jinak null. */
export function restorableViewer(raw: string | null, url: string, now: number): ViewerRequest | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SavedViewer> | null;
    if (!v || typeof v.href !== "string" || !v.href.startsWith("/api/") || v.url !== url) return null;
    if (typeof v.hiddenAt !== "number" || now - v.hiddenAt > VIEWER_RESTORE_MS || v.hiddenAt - now > 5_000) return null;
    return { href: v.href, filename: typeof v.filename === "string" ? v.filename : null, info: v.info ?? null };
  } catch {
    return null;
  }
}

function session(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

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

  // obnova po načtení stránky znovu (nové nasazení / chyba obnovení → Next načte stránku celou, F5)
  React.useEffect(() => {
    const store = session();
    if (!store) return;
    let restore: ViewerRequest | null = null;
    try {
      restore = restorableViewer(store.getItem(VIEWER_RESTORE_KEY), window.location.href, Date.now());
      store.removeItem(VIEWER_RESTORE_KEY);
    } catch {
      return;
    }
    if (!restore || reqRef.current) return;
    const st = (window.history.state ?? {}) as Record<string, unknown>;
    if (st[STATE_KEY]) {
      // záznam historie prohlížeče přežil načtení → „Zpět" ho opustí jako dřív
      pushed.current = true;
      reqRef.current = restore;
      setSet(resolveViewerSet(restore.href));
      setReq(restore);
    } else {
      open(restore);
    }
  }, [open]);

  // otevřený dokument do sessionStorage (blob / vlastní tlačítka se obnovit nedají — bez nich)
  const hadReq = React.useRef(false);
  React.useEffect(() => {
    setFileViewerOpen(!!req);
    const store = session();
    if (!store) return;
    try {
      if (req && !req.blob) {
        hadReq.current = true;
        const saved: SavedViewer = { url: window.location.href, href: req.href, filename: req.filename ?? null, info: req.info ?? null, hiddenAt: null };
        store.setItem(VIEWER_RESTORE_KEY, JSON.stringify(saved));
      } else if (hadReq.current) {
        store.removeItem(VIEWER_RESTORE_KEY);
      }
    } catch {
      // plné / zakázané úložiště — jen bez obnovy
    }
  }, [req]);
  React.useEffect(() => () => setFileViewerOpen(false), []);

  // odchod ze stránky s otevřeným prohlížečem: čas odchodu (obnoví se jen při rychlém návratu)
  React.useEffect(() => {
    const onHide = () => {
      const store = session();
      if (!store || !reqRef.current || reqRef.current.blob) return;
      try {
        const raw = store.getItem(VIEWER_RESTORE_KEY);
        const v = raw ? (JSON.parse(raw) as SavedViewer) : null;
        if (v) store.setItem(VIEWER_RESTORE_KEY, JSON.stringify({ ...v, url: window.location.href, hiddenAt: Date.now() }));
      } catch {
        // bez obnovy
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
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
