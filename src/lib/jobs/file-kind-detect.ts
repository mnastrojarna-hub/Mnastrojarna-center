import type { JobFileKind } from "@/lib/supabase/database.types";
import { guessFileKind } from "@/lib/jobs/file-kinds";
import { cadFormatOf, drawingNumberFromFilename, isDrawingFormat } from "@/lib/jobs/capture-batch";
import { CAD_PRODUCERS } from "@/lib/anonymize/cad-producer";

/**
 * Druh souboru BEZ AI — stejná deterministika jako dávka „Přidat doklad (foto)" (capture-batch: CAD formát
 * podle obsahu, číslo výkresu z názvu, druh dokladu z názvu) + metadata PDF z CAD programu. Používá ji
 * pošta při automatickém uložení příloh k zakázce (kde se AI na roztřídění nevolá); s kontrolou
 * („Založit zakázku" / „Přidat k zakázce") třídí přílohy dávka focení s AI.
 * Dřív pošta dávala výkres jen při shodě s položkou zakázky → PDF výkresy končily v „Ostatní".
 */

/** Název obchodního dokladu s číslem („PO_4471.pdf", „FV-2026-118.pdf") — ne číslo výkresu. */
const BUSINESS_PREFIX_RE = /^(po|pv|fv|fa|fak|dl|ob|obj|nab|nb|rfq|inv|quote|offer|angebot|order|bestellung|rechnung|lieferschein|ab|av|ponuka|cenova)[\s_.-]*\d/i;
const VISUAL_RE = /\.(pdf|png|jpe?g|tiff?|gif|bmp|webp|heic|heif)$/i;
/** Fotka z telefonu / snímek obrazovky („20261103_101500.jpg", „WhatsApp Image…") — číslo v názvu není výkres. */
const CAMERA_NAME_RE = /^(whatsapp|screenshot|sn[ií]mek|photo|pxl|img|dsc|signal|telegram|image)|^\d{8}[\s_-]?\d{4,6}/i;

function latin1(bytes: Uint8Array, from: number, to: number): string {
  let s = "";
  for (let i = Math.max(0, from); i < Math.min(bytes.length, to); i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** PDF z CAD programu podle Producer / Creator (Info slovník nebo XMP; začátek a konec souboru). */
export function pdfFromCad(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || bytes.length < 8 || latin1(bytes, 0, 5) !== "%PDF-") return false;
  const text = latin1(bytes, 0, 256 * 1024) + latin1(bytes, bytes.length - 64 * 1024, bytes.length);
  const meta = [
    ...text.matchAll(/\/(?:Producer|Creator)\s*\(([^)]{1,200})\)/g),
    ...text.matchAll(/<(?:pdf:Producer|xmp:CreatorTool)>([^<]{1,200})</g),
  ].map((m) => m[1]).join(" ");
  return Boolean(meta) && CAD_PRODUCERS.test(meta);
}

export interface DetectFileKindInput {
  filename: string;
  mime?: string | null;
  /** Obsah (stačí začátek; u PDF lépe celý — metadata bývají na konci). */
  bytes?: Uint8Array | null;
  size?: number | null;
  /** Normalizovaná čísla výkresů položek zakázky (normToken). */
  itemDrawingKeys?: ReadonlySet<string>;
  /** Soubor poslal zákazník jako podklad (poptávka, objednávka, technická dokumentace…). */
  customerDocs?: boolean;
  normalize?: (v: string) => string | null;
}

/**
 * Druh souboru: CAD (obsah > přípona) → výkres / 3D model; druh dokladu z názvu (faktura, objednávka…);
 * PDF z CAD programu → výkres; PDF / obrázek pojmenovaný číslem výkresu → výkres, když číslo sedí na položku
 * zakázky nebo soubor poslal zákazník jako podklad; obrázek → fotka; jinak ostatní.
 */
export function detectFileKind(input: DetectFileKindInput): JobFileKind {
  const name = input.filename || "";
  const head = input.bytes ? input.bytes.subarray(0, 65_536) : null;
  const format = cadFormatOf(name, head, input.size ?? input.bytes?.length ?? undefined);
  if (format) return isDrawingFormat(format) ? "vykres" : "model_3d";
  const byName = guessFileKind(name, input.mime ?? undefined);
  if (byName !== "ostatni" && byName !== "foto") return byName;
  if (!VISUAL_RE.test(name) && !(input.mime ?? "").startsWith("image/") && input.mime !== "application/pdf") return byName;
  if (pdfFromCad(input.bytes)) return "vykres";
  const number = drawingNumberFromFilename(name);
  if (number && !BUSINESS_PREFIX_RE.test(name) && !CAMERA_NAME_RE.test(name)) {
    const key = input.normalize ? input.normalize(number) : number.replace(/[\s.\-/_]/g, "").toUpperCase();
    if ((key && input.itemDrawingKeys?.has(key)) || input.customerDocs) return "vykres";
  }
  return byName;
}
