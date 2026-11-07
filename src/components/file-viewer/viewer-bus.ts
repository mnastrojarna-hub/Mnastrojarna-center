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
