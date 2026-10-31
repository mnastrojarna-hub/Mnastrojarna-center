import { extensionOf, MODEL_EXTENSIONS } from "@/lib/viewer3d/sniff";

/**
 * Které odkazy otevírat v prohlížeči souborů (místo nové karty / stažení) — dokumenty zakázek,
 * přílohy e-mailů, faktury dodavatelů, vygenerovaná PDF, náhledy anonymizace.
 */

const VIEWER_PATH = /^\/api\/(?:jobs\/files\/[^/]+|emails\/attachment\/[^/]+|supplier-invoices\/files\/[^/]+|pdf\/.+|drawings\/anonymize\/[^/]+\/(?:preview|download))$/;

export function isViewerPath(pathname: string): boolean {
  return VIEWER_PATH.test(pathname);
}

const VIEWABLE = new Set([
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "txt", "csv", "log", "json", "xml",
  ...Object.keys(MODEL_EXTENSIONS),
]);

/** Soubory, které prohlížeč neumí — klik nechá výchozí chování (stažení / nová karta). */
const NOT_VIEWABLE = new Set([
  "doc", "docx", "xls", "xlsx", "xlsm", "ppt", "pptx", "odt", "ods", "zip", "rar", "7z", "msg", "eml",
  "dwg", "dxf", "x_t", "x_b", "sldprt", "sldasm", "slddrw", "catpart", "catproduct", "catdrawing", "prt", "asm",
  "ipt", "iam", "idw", "par", "psm", "jt", "sat", "3dm", "f3d", "heic", "heif", "tif", "tiff",
]);

/** Dá se soubor s tímto názvem zobrazit? (null = nevíme → rozhodne obsah). */
export function isViewableName(filename: string | null | undefined): boolean | null {
  const ext = extensionOf(filename);
  if (!ext) return null;
  if (VIEWABLE.has(ext)) return true;
  if (NOT_VIEWABLE.has(ext)) return false;
  return null;
}

const FILENAME_RE = /([^\s/\\:*?"<>|]+\.[a-z0-9_]{1,8})\s*$/i;

/** Název souboru z odkazu: data-filename, aria-label „Otevřít X", title, text odkazu. */
export function filenameFromAnchor(a: { getAttribute(n: string): string | null; textContent: string | null }): string | null {
  const direct = a.getAttribute("data-filename");
  if (direct) return direct;
  for (const v of [a.getAttribute("aria-label"), a.getAttribute("title"), a.textContent]) {
    const m = v ? FILENAME_RE.exec(v.trim()) : null;
    if (m) return m[1];
  }
  return null;
}

/** Odkaz „otevřít v novém okně" na samostatnou stránku prohlížeče. */
export function standaloneViewerHref(href: string, filename?: string | null): string {
  const q = new URLSearchParams({ src: href });
  if (filename) q.set("name", filename);
  return `/view?${q.toString()}`;
}

/** Zdroj pro samostatnou stránku: jen vlastní /api/ cesty (žádné cizí adresy). */
export function safeViewerSrc(src: string | null | undefined): string | null {
  if (!src || !src.startsWith("/api/") || src.startsWith("//")) return null;
  try {
    const u = new URL(src, "https://x.invalid");
    if (u.origin !== "https://x.invalid") return null;
    return isViewerPath(u.pathname) ? u.pathname + u.search : null;
  } catch {
    return null;
  }
}

/** URL ke stažení (u souborů z úložiště ?download=1 vrátí původní název). */
export function downloadHref(href: string): string {
  if (/^\/api\/(jobs\/files|supplier-invoices\/files)\//.test(href) || /^\/api\/pdf\/job\//.test(href)) {
    return href + (href.includes("?") ? "&" : "?") + "download=1";
  }
  return href;
}
