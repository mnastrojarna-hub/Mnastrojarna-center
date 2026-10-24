/**
 * Master fotky v plném rozlišení pro anonymizaci (prohlížeč) — spec §2.3, B1.
 * Hlavní soubor fotky zůstává ≤ 2400 px (čtení AI); master se nahrává paralelně do
 * capture/<uid>/hires/… a server ho při uložení dávky přesune do anon_source_path.
 *  - JPEG / PNG / WebP do 30 MB → původní bajty (žádné nové kódování, žádný limit canvasu iOS),
 *  - HEIC / HEIF, který prohlížeč umí dekódovat (Safari) → JPEG q0,92, ≤ 16 MPx a ≤ 6000 px,
 *  - jinak (HEIC v Chrome) master nevznikne (null).
 * Háček do upload-client / capture-client dělá balík HOOKS.
 */

export const HIRES_MAX_BYTES = 30 * 1024 * 1024;
export const HIRES_MAX_PIXELS = 16_000_000;
export const HIRES_MAX_SIDE = 6000;

const PASS_THROUGH = ["image/jpeg", "image/png", "image/webp"];

export function hiresDims(w: number, h: number): { w: number; h: number } {
  if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
  const s = Math.min(1, HIRES_MAX_SIDE / Math.max(w, h), Math.sqrt(HIRES_MAX_PIXELS / (w * h)));
  return { w: Math.max(1, Math.floor(w * s)), h: Math.max(1, Math.floor(h * s)) };
}

function isHeic(file: { type: string; name: string }): boolean {
  return /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

/** Master k nahrání, nebo null (soubor nejde / nemá smysl). */
export async function prepareHiresMaster(file: File): Promise<Blob | null> {
  if (!file || file.size <= 0) return null;
  if (PASS_THROUGH.includes(file.type.toLowerCase())) return file.size <= HIRES_MAX_BYTES ? file : null;
  if (!isHeic(file)) return null;
  const g = globalThis as { createImageBitmap?: typeof createImageBitmap; document?: Document };
  if (!g.createImageBitmap || !g.document) return null;
  try {
    const bmp = await g.createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const d = hiresDims(bmp.width, bmp.height);
    const canvas = g.document.createElement("canvas");
    canvas.width = d.w;
    canvas.height = d.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, d.w, d.h);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92));
    return blob && blob.size <= HIRES_MAX_BYTES ? blob : null;
  } catch {
    return null; // HEIC v Chrome — master nevznikne (soubor zůstane unsupported jako dnes)
  }
}

/** Název masteru (bezpečný pro cestu). */
export function hiresName(filename: string, mime: string): string {
  const base = filename.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60) || "foto";
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return `${base}.${ext}`;
}
