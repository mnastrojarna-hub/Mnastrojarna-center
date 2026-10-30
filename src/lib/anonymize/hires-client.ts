/**
 * Master fotky v plném rozlišení pro anonymizaci (prohlížeč) — spec §2.3, B1.
 * Hlavní soubor fotky zůstává ≤ 2400 px (čtení AI, náhledy); ORIGINÁL z fotoaparátu jde vedle něj přímo
 * do úložiště (podepsaná URL — bajty nikdy přes funkci, Vercel 4,5 MB): dokumenty zakázky
 * (lib/jobs/upload-client → zakazky/<zakázka>/master/<uuid>), focení jednotlivě i dávkou, poptávky
 * a fotoaparát v mobilu (capture-client → capture/<uživatel>/<uuid>.hires, při uložení se přesune k zakázce).
 *  - JPEG / PNG / WebP / HEIC / HEIF do 30 MB → původní bajty (žádné nové kódování ani limit canvasu iOS;
 *    HEIC dekóduje server — libheif), telefonní fotka 3–8 MB,
 *  - jiný typ (GIF, TIFF — ten se nezmenšuje, hlavní soubor je originál) → null.
 */

export const HIRES_MAX_BYTES = 30 * 1024 * 1024;

const PASS_THROUGH = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"];

/** Typ masteru pro úložiště (prohlížeč u HEIC typ často nehlásí). */
export function hiresMime(file: { type: string; name: string }): string | null {
  const t = (file.type || "").toLowerCase();
  if (PASS_THROUGH.includes(t)) return t === "image/jpg" ? "image/jpeg" : t;
  if (!t || t === "application/octet-stream") {
    const n = (file.name || "").toLowerCase();
    if (/\.hei[cf]$/.test(n)) return n.endsWith(".heif") ? "image/heif" : "image/heic";
    if (/\.jpe?g$/.test(n)) return "image/jpeg";
    if (/\.png$/.test(n)) return "image/png";
    if (/\.webp$/.test(n)) return "image/webp";
  }
  return null;
}

/** Master k nahrání (originál beze změny), nebo null (typ, který master nepotřebuje / je moc velký). */
export function prepareHiresMaster(file: File): { blob: Blob; mime: string } | null {
  if (!file || file.size <= 0 || file.size > HIRES_MAX_BYTES) return null;
  const mime = hiresMime(file);
  return mime ? { blob: file, mime } : null;
}
