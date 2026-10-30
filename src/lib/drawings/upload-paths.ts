/**
 * Cesty přímého nahrání do Archivu výkresů (bucket documents, podepsaná URL — bajty nikdy přes funkci).
 * Čisté funkce: sdílí je server action (createDrawingUpload / registerDrawing) a prohlížeč.
 *   vykresy/upload/<uživatel>/<uuid>.<přípona>      originál (po uložení se přesune do vykresy/…)
 *   vykresy/upload/<uživatel>/<uuid>.ai.jpg         zmenšená kopie velké fotky jen pro čtení AI (pak se smaže)
 */

export const DRAWING_ALLOWED_MIMES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
export const DRAWING_MAX_BYTES = 50 * 1024 * 1024;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function drawingExt(mime: string): string {
  const m = String(mime ?? "").toLowerCase();
  if (m === "application/pdf") return "pdf";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  return "jpg";
}

export function drawingUploadFolder(userId: string): string {
  return `vykresy/upload/${String(userId).toLowerCase()}`;
}

export function drawingUploadPath(userId: string, uuid: string, mime: string): string {
  return `${drawingUploadFolder(userId)}/${uuid.toLowerCase()}.${drawingExt(mime)}`;
}

/** Nahraný originál patří přihlášenému uživateli (žádné ../ ani cizí složka). */
export function isDrawingUploadPath(userId: string, path: unknown): path is string {
  if (typeof path !== "string" || path.includes("..") || !new RegExp(`^${UUID}$`, "i").test(String(userId))) return false;
  return new RegExp(`^vykresy/upload/${String(userId).toLowerCase()}/${UUID}\\.(pdf|png|webp|jpg)$`).test(path);
}

/** Kopie pro AI k danému originálu (pevně odvozená z jeho cesty). */
export function drawingAiPath(uploadPath: string): string | null {
  const m = new RegExp(`^(vykresy/upload/${UUID}/${UUID})\\.(pdf|png|webp|jpg)$`, "i").exec(uploadPath ?? "");
  return m ? `${m[1].toLowerCase()}.ai.jpg` : null;
}

export function isDrawingAiPath(uploadPath: string, aiPath: unknown): aiPath is string {
  return typeof aiPath === "string" && aiPath === drawingAiPath(uploadPath);
}
