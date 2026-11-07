import { extensionOf } from "@/lib/viewer3d/sniff";
import { fileItemMatcher } from "./pricing-drawings";

/**
 * Výkresy zakázky v prohlížeči (majitel 7. 11.): otevřený výkres jde swipem / šipkami přepnout na další
 * výkres téže zakázky, nahoře číslo výkresu, název, počet kusů a materiál z navázané položky.
 * V sadě jsou jen AKTUÁLNÍ 2D výkresy (druh „vykres": PDF, obrázek, TIFF / HEIC) — 3D modely
 * a obchodní doklady se otevírají samostatně. Žádné ceny (vidí to i uživatel bez práva na ceny).
 */

/** Údaje položky k výkresu v hlavičce prohlížeče. */
export interface DrawingInfo {
  drawingNumber: string | null;
  revision: string | null;
  name: string | null;
  quantity: number | null;
  unit: string | null;
  material: string | null;
}

/** Jeden výkres sady prohlížeče. */
export interface ViewerSetEntry {
  href: string;
  filename: string;
  info: DrawingInfo | null;
}

/** Obrázkové formáty, které prohlížeč (Chrome, Android) sám nevykreslí — převede je server (?view=image). */
const SERVER_RASTER_EXT = new Set(["tif", "tiff", "heic", "heif"]);
const SERVER_RASTER_MIME = /^image\/(tiff|heic|heif)/i;
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"]);

/** TIFF / HEIC — náhled přes server (PNG / JPEG). */
export function isServerRasterName(filename: string | null | undefined, mimeType?: string | null): boolean {
  const ext = extensionOf(filename);
  if (ext) return SERVER_RASTER_EXT.has(ext);
  return SERVER_RASTER_MIME.test(mimeType ?? "");
}

/** Druh 2D výkresu pro prohlížeč; null = do sady nepatří (model, Word, DXF…). */
export function drawingSheetKind(filename: string, mimeType?: string | null): "pdf" | "image" | "raster" | null {
  const ext = extensionOf(filename);
  const mime = (mimeType ?? "").toLowerCase();
  if (ext === "pdf" || (!ext && mime === "application/pdf")) return "pdf";
  if (isServerRasterName(filename, mimeType)) return "raster";
  if (IMAGE_EXT.has(ext) || (!ext && mime.startsWith("image/") && !mime.includes("svg"))) return "image";
  return null;
}

export interface DrawingSetFile {
  id: string;
  kind: string;
  filename: string;
  mimeType: string | null;
  archived: boolean;
  createdAt: string;
  version: number;
  locked?: unknown;
  orderItemId?: string | null;
  drawingNumber?: string | null;
}

export interface DrawingSetItem {
  id: string;
  position: number;
  drawingNumber: string | null;
  revision: string | null;
  name: string | null;
  description?: string | null;
  material: string | null;
  quantity: number;
  unit: string;
}

/** Patří soubor do sady výkresů (aktuální, nezamčený 2D výkres)? */
export function isSwipeDrawing(f: DrawingSetFile): boolean {
  return f.kind === "vykres" && !f.archived && !f.locked && drawingSheetKind(f.filename, f.mimeType) !== null;
}

/** Údaje položky pro hlavičku (bez cen). */
export function drawingInfoOfItem(it: DrawingSetItem): DrawingInfo {
  const t = (v: string | null | undefined) => (v ?? "").trim() || null;
  const q = Number(it.quantity);
  return {
    drawingNumber: t(it.drawingNumber),
    revision: t(it.revision),
    name: t(it.name) ?? t(it.description),
    quantity: Number.isFinite(q) && q > 0 ? q : null,
    unit: t(it.unit) ?? "ks",
    material: t(it.material),
  };
}

export const fileHref = (id: string) => `/api/jobs/files/${id}`;

/**
 * Sada výkresů zakázky v pořadí jako v Dokumentech (nejnovější nahoře), ke každému údaje navázané
 * položky (vazba položky, jinak číslo výkresu — stejné pravidlo jako miniatury na Nacenění).
 */
export function jobDrawingSet(files: readonly DrawingSetFile[], items: readonly DrawingSetItem[]): ViewerSetEntry[] {
  const itemOf = fileItemMatcher(items);
  const byId = new Map(items.map((i) => [i.id, i]));
  return files
    .filter(isSwipeDrawing)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.version - a.version)
    .map((f) => {
      const itemId = itemOf({ itemId: f.orderItemId ?? null, filename: f.filename, drawingNumber: f.drawingNumber ?? null });
      const item = itemId ? byId.get(itemId) : undefined;
      return { href: fileHref(f.id), filename: f.filename, info: item ? drawingInfoOfItem(item) : null };
    });
}

/** Cesta bez dotazu (?download=1 apod.) — porovnání odkazu se sadou. */
function pathOf(href: string): string {
  const i = href.search(/[?#]/);
  return i < 0 ? href : href.slice(0, i);
}

/** Pozice odkazu v sadě (-1 = odkaz do sady nepatří). */
export function viewerSetIndex(list: readonly ViewerSetEntry[], href: string): number {
  const p = pathOf(href);
  return list.findIndex((e) => pathOf(e.href) === p);
}

const qtyFmt = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 3 });

/** Počet kusů „25 ks" (null = neuvedeno). */
export function drawingQuantityText(info: DrawingInfo | null | undefined): string | null {
  if (!info || info.quantity === null) return null;
  return `${qtyFmt.format(info.quantity)} ${info.unit ?? "ks"}`;
}

/** „4711-02 rev. B" (null = výkres bez čísla). */
export function drawingNumberText(info: DrawingInfo | null | undefined): string | null {
  if (!info?.drawingNumber) return null;
  return info.revision ? `${info.drawingNumber} rev. ${info.revision}` : info.drawingNumber;
}

/** Další / předchozí v kruhu (na konci zpět na začátek). */
export function stepIndex(index: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return 0;
  return (((index + dir) % count) + count) % count;
}
