import type { ViewerRequest } from "./file-viewer";
import type { ViewerSetEntry } from "@/lib/jobs/drawing-set";

/** Otevření prohlížeče souborů z běžného kódu (mimo React strom) — přes událost okna. */
export const FILE_VIEWER_EVENT = "mn:file-viewer";

let ready = 0;

/** Volá FileViewerProvider; vrací úklid. */
export function markFileViewerReady(): () => void {
  ready++;
  return () => {
    ready--;
  };
}

/** Je v aplikaci prohlížeč (přihlášená část)? */
export function hasFileViewer(): boolean {
  return ready > 0;
}

/** Otevře soubor v prohlížeči; false = prohlížeč tu není (volající použije náhradní cestu). */
export function openFileViewer(req: ViewerRequest): boolean {
  if (!hasFileViewer() || typeof window === "undefined") return false;
  window.dispatchEvent(new CustomEvent<ViewerRequest>(FILE_VIEWER_EVENT, { detail: req }));
  return true;
}

/**
 * Sady dokumentů k listování (výkresy zakázky): karta zakázky zaregistruje, které odkazy k sobě patří.
 * Otevření kteréhokoli z nich (klik kdekoli v kartě) pak v prohlížeči dovolí swipe / šipky na další.
 */
export type ViewerSetResolver = (href: string) => { list: ViewerSetEntry[]; index: number } | null;

const resolvers = new Set<ViewerSetResolver>();

/** Zaregistruje sadu; vrací úklid. */
export function registerViewerSet(resolve: ViewerSetResolver): () => void {
  resolvers.add(resolve);
  return () => {
    resolvers.delete(resolve);
  };
}

/** Sada, do které odkaz patří (poslední zaregistrovaná vyhrává); null = otevře se samostatně. */
export function resolveViewerSet(href: string): { list: ViewerSetEntry[]; index: number } | null {
  const all = [...resolvers].reverse();
  for (const r of all) {
    const hit = r(href);
    if (hit && hit.list.length > 0 && hit.index >= 0 && hit.index < hit.list.length) return hit;
  }
  return null;
}

/**
 * Je prohlížeč právě otevřený? Obnovení stránky na pozadí (router.refresh — fronta anonymizace výkresů
 * v Dokumentech každých 6 s) se odloží až po zavření: odpověď z nového nasazení (jiné buildId) nebo chyba
 * serveru by Next.js vyřešil tvrdým načtením stránky a prohlížeč by uživateli zmizel pod rukama
 * (majitel 10. 11.: „otevřu PDF, točím kolečkem a zavře se to").
 */
let viewerOpen = false;
const afterClose = new Set<() => void>();

/** Volá FileViewerProvider při otevření / zavření prohlížeče. */
export function setFileViewerOpen(open: boolean): void {
  if (viewerOpen === open) return;
  viewerOpen = open;
  if (open) return;
  const pending = [...afterClose];
  afterClose.clear();
  for (const fn of pending) {
    try {
      fn();
    } catch {
      // odložené obnovení nesmí shodit zavírání prohlížeče
    }
  }
}

export function isFileViewerOpen(): boolean {
  return viewerOpen;
}

/** Spustí `fn` hned, nebo (je-li prohlížeč otevřený) jednou po jeho zavření — stejná funkce se nezdvojí. */
export function runWhenFileViewerClosed(fn: () => void): void {
  if (viewerOpen) afterClose.add(fn);
  else fn();
}
