import type { ViewerRequest } from "./file-viewer";

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
