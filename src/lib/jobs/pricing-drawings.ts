import { extensionOf } from "@/lib/viewer3d/sniff";

/**
 * Výkresy k položkám na Nacenění: vazba job_files.order_item_id, jinak číslo výkresu v názvu
 * souboru (stejné pravidlo jako přílohy objednávky dodavateli — poAttachmentPlan). Interně se
 * otevírá originál (/api/jobs/files/<id>) — stejně jako karta zakázky.
 */

/** Soubor výkresu / modelu zakázky (ze serveru, jen nearchivované). */
export interface PricingDrawingSource {
  id: string;
  kind: string;
  filename: string;
  mimeType: string | null;
  itemId: string | null;
  createdAt: string;
}

export type PricingDrawingView = "pdf" | "image" | "model" | "other";

/** Výkres položky pro UI. */
export interface PricingDrawing {
  id: string;
  filename: string;
  view: PricingDrawingView;
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);
const MODEL_EXT = new Set(["step", "stp", "iges", "igs", "stl", "3mf", "dxf", "dwg", "obj", "gltf", "glb", "brep", "brp"]);

export function drawingView(filename: string, mimeType?: string | null, kind?: string | null): PricingDrawingView {
  const ext = extensionOf(filename);
  const mime = (mimeType ?? "").toLowerCase();
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (IMAGE_EXT.has(ext) || (!ext && mime.startsWith("image/"))) return "image";
  if (MODEL_EXT.has(ext) || kind === "model_3d") return "model";
  return "other";
}

/** = normDrawing (po-deviations): velká písmena bez mezer, teček, pomlček, lomítek a podtržítek. */
function norm(v: string | null | undefined): string {
  return String(v ?? "").toUpperCase().replace(/[\s.\-/_]/g, "");
}

const RANK: Record<PricingDrawingView, number> = { pdf: 0, image: 1, model: 2, other: 3 };

/** Adresa souboru pro prohlížeč / miniaturu (originál, kontrola přístupu na serveru). */
export function drawingHref(id: string): string {
  return `/api/jobs/files/${id}`;
}

/**
 * Výkresy po položkách (id položky → soubory; první = hlavní k náhledu: PDF, obrázek, pak model).
 * Soubor s vazbou na jinou položku se podle názvu nikdy nepřiřadí; při shodě názvu s více
 * položkami vyhraje nejdelší číslo výkresu („H-200" před „H-20").
 */
export function drawingsForItems(
  items: readonly { id: string; drawingNumber: string | null }[],
  files: readonly PricingDrawingSource[],
): Record<string, PricingDrawing[]> {
  const ids = new Set(items.map((i) => i.id));
  const keyed = items.map((i) => ({ id: i.id, n: norm(i.drawingNumber) })).filter((i) => i.n.length >= 3);
  const buckets = new Map<string, { f: PricingDrawingSource; view: PricingDrawingView }[]>();
  for (const f of files) {
    let target: string | null = null;
    if (f.itemId) {
      target = ids.has(f.itemId) ? f.itemId : null;
    } else {
      const flat = norm(f.filename.replace(/\.[a-z0-9_]{1,8}$/i, ""));
      let best = 0;
      for (const it of keyed) {
        if (it.n.length > best && flat.includes(it.n)) {
          best = it.n.length;
          target = it.id;
        }
      }
    }
    if (!target) continue;
    const list = buckets.get(target) ?? [];
    list.push({ f, view: drawingView(f.filename, f.mimeType, f.kind) });
    buckets.set(target, list);
  }
  const out: Record<string, PricingDrawing[]> = {};
  for (const [id, list] of buckets) {
    out[id] = list
      .sort((a, b) => RANK[a.view] - RANK[b.view] || b.f.createdAt.localeCompare(a.f.createdAt))
      .map(({ f, view }) => ({ id: f.id, filename: f.filename, view }));
  }
  return out;
}
