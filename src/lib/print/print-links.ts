import { extensionOf, MODEL_EXTENSIONS } from "@/lib/viewer3d/sniff";

/**
 * Tisk dokumentů přímo ze systému (nabídky, DL, faktury, objednávky, výkresy, přílohy…).
 *
 * Tisková stránka /print?src=… stáhne dokument STEJNOU cestou jako prohlížeč souborů / stažení
 * (vlastní /api/… routy s jejich kontrolou oprávnění — žádný nový přístup k souborům), PDF vykreslí
 * přes pdf.js po stranách do obrázků v tiskovém rozlišení a otevře systémový tisk (výběr tiskárny).
 * Obrázky (strany) místo PDF v rámu: tisk PDF v <iframe> na iOS Safari a v mnoha prohlížečích
 * Androidu nefunguje nebo tiskne prázdnou stranu.
 */

/** Routy, jejichž obsah smí tisková stránka stáhnout (= routy prohlížeče + anonymní kopie pro dodavatele). */
const PRINT_PATH = /^\/api\/(?:jobs\/files\/[^/]+|emails\/attachment\/[^/]+|supplier-invoices\/files\/[^/]+|pdf\/.+|drawings\/anonymize\/[^/]+\/(?:preview|download))$/;

/** Náhled z rout anonymizace (PNG po stranách: ?page=n) — tiskne se jako sada obrázků. */
const RASTER_PREVIEW = /^\/api\/drawings\/anonymize\/([^/]+)\/preview$/;

export function isPrintPath(pathname: string): boolean {
  return PRINT_PATH.test(pathname);
}

/**
 * Zdroj tisku: jen vlastní /api/ cesty z PRINT_PATH (žádné cizí adresy, žádné //host, žádné zpětné
 * lomítko). `download=1` se zahodí (tiskne se obsah, ne příloha); `original=1` (originál bez
 * anonymizace pro dodavatele, s auditem) tisk nedovolí — pro dodavatele se tiskne anonymní kopie.
 */
export function safePrintSrc(src: string | null | undefined): string | null {
  if (!src || typeof src !== "string" || !src.startsWith("/api/") || src.startsWith("//") || src.includes("\\")) return null;
  try {
    const u = new URL(src, "https://x.invalid");
    if (u.origin !== "https://x.invalid" || !isPrintPath(u.pathname)) return null;
    if (u.searchParams.get("original") === "1") return null;
    u.searchParams.delete("download");
    const q = u.searchParams.toString();
    return u.pathname + (q ? `?${q}` : "");
  } catch {
    return null;
  }
}

/** Adresa tiskové stránky. `embed` = skrytý rám na počítači (tisk bez opuštění stránky). */
export function printPageHref(src: string, opts: { name?: string | null; embed?: boolean } = {}): string {
  const q = new URLSearchParams({ src });
  if (opts.name) q.set("name", opts.name);
  if (opts.embed) q.set("embed", "1");
  return `/print?${q.toString()}`;
}

/** Je zdroj serverový náhled po stranách (PNG, ?page=n)? */
export function isRasterPreview(src: string): boolean {
  try {
    return RASTER_PREVIEW.test(new URL(src, "https://x.invalid").pathname);
  } catch {
    return false;
  }
}

/** URL strany serverového náhledu (`w` = delší strana v px; route vrací max. 2400). */
export function rasterPageUrl(src: string, page: number, w = 2400): string {
  const u = new URL(src, "https://x.invalid");
  u.searchParams.set("page", String(page));
  u.searchParams.set("w", String(w));
  return u.pathname + "?" + u.searchParams.toString();
}

/**
 * Náhradní cesta pro obrázky, které prohlížeč sám nevykreslí (HEIC v Chrome, TIFF): serverový
 * PNG náhled anonymizace — tatáž kontrola práv jako otevření dokumentu zakázky (job_files).
 */
export function rasterFallbackSrc(src: string): string | null {
  const m = /^\/api\/jobs\/files\/([^/?#]+)/.exec(src);
  return m ? `/api/drawings/anonymize/${m[1]}/preview?table=job_files` : null;
}

export type Printability = { ok: true } | { ok: false; hint: string };

const CAD_2D = new Set(["dxf", "dwg"]);
const OFFICE = new Set(["doc", "docx", "xls", "xlsx", "xlsm", "ppt", "pptx", "odt", "ods", "rtf"]);
const ARCHIVE = new Set(["zip", "rar", "7z", "msg", "eml"]);
const NATIVE_CAD = new Set(["x_t", "x_b", "sldprt", "sldasm", "slddrw", "catpart", "catproduct", "catdrawing", "prt", "asm", "ipt", "iam", "idw", "par", "psm", "jt", "sat", "3dm", "f3d"]);

/** Dá se soubor vytisknout z tiskové stránky? (podle názvu; neznámá přípona = rozhodne obsah). */
export function printabilityOf(filename: string | null | undefined): Printability {
  const ext = extensionOf(filename);
  if (!ext) return { ok: true };
  if (CAD_2D.has(ext)) return { ok: false, hint: `${ext.toUpperCase()} vytiskneš po uložení jako PDF` };
  if (ext in MODEL_EXTENSIONS) return { ok: false, hint: "3D model: otevři ho a použij „Tisknout pohled“" };
  if (NATIVE_CAD.has(ext)) return { ok: false, hint: "Výkres z CAD vytiskneš po uložení jako PDF" };
  if (OFFICE.has(ext)) return { ok: false, hint: "Tento soubor vytiskni z programu, který ho umí (Word, Excel…)" };
  if (ARCHIVE.has(ext)) return { ok: false, hint: "Archiv nebo e-mail nejde vytisknout — otevři soubory v něm" };
  return { ok: true };
}

/** Rozlišení tisku: telefon méně (paměť), počítač ~200 dpi. */
export function printDpi(mobile: boolean): number {
  return mobile ? 150 : 200;
}

/** Největší plátno jedné strany (px²): iOS víc nevykreslí, telefon šetří paměť. */
export function maxPagePixels(mobile: boolean): number {
  return mobile ? 8_000_000 : 16_000_000;
}

/** Měřítko pdf.js (1 = 72 dpi) pro stranu `w × h` bodů: cílové dpi, omezené počtem pixelů. */
export function pageRenderScale(widthPt: number, heightPt: number, dpi: number, maxPixels: number): number {
  const want = dpi / 72;
  const area = Math.max(1, widthPt * heightPt);
  return Math.max(0.1, Math.min(want, Math.sqrt(maxPixels / area)));
}

export type Orientation = "portrait" | "landscape";

export function orientationOf(width: number, height: number): Orientation {
  return width > height * 1.02 ? "landscape" : "portrait";
}

const PAPERS: [string, number, number][] = [
  ["A5", 148, 210], ["A4", 210, 297], ["A3", 297, 420], ["A2", 420, 594], ["A1", 594, 841], ["A0", 841, 1189], ["Letter", 215.9, 279.4],
];

/** „A4 na výšku", „A3 na šířku" (podle rozměru strany v bodech PDF; jinak rozměr v mm). */
export function paperLabel(widthPt: number, heightPt: number): string {
  const mm = (pt: number) => (pt * 25.4) / 72;
  const a = Math.min(mm(widthPt), mm(heightPt));
  const b = Math.max(mm(widthPt), mm(heightPt));
  const or = orientationOf(widthPt, heightPt) === "landscape" ? "na šířku" : "na výšku";
  const hit = PAPERS.find(([, w, h]) => Math.abs(a - w) <= 4 && Math.abs(b - h) <= 4);
  return hit ? `${hit[0]} ${or}` : `${Math.round(mm(widthPt))} × ${Math.round(mm(heightPt))} mm`;
}

/**
 * Jak tisknout z běžné stránky aplikace:
 *  - "page": telefon / tablet → přejít na tiskovou stránku (vlastní tlačítko Tisknout a Zpět),
 *  - "tab": Safari na počítači → tisková stránka v nové kartě (tisk z rámu Safari nespolehlivý),
 *  - "iframe": Chrome / Edge / Firefox na počítači → skrytý rám s tiskovou stránkou, dialog tisku hned.
 */
export function printModeFor(ua: string, maxTouchPoints = 0): "page" | "tab" | "iframe" {
  const mobile = /iPhone|iPad|iPod|Android|Mobile|Silk|Kindle|Opera Mini/i.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  if (mobile) return "page";
  const safari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|OPR\/|Firefox\/|CriOS|FxiOS/.test(ua);
  return safari ? "tab" : "iframe";
}

/** Telefon / tablet (nižší dpi, šetrnost k paměti). */
export function isMobileUa(ua: string, maxTouchPoints = 0): boolean {
  return printModeFor(ua, maxTouchPoints) === "page";
}

/** Zprávy ze skrytého tiskového rámu rodičovské stránce. */
export const PRINT_MSG = "mn-print";
export type PrintMessage =
  | { source: typeof PRINT_MSG; type: "progress"; done: number; total: number }
  | { source: typeof PRINT_MSG; type: "ready"; pages: number }
  | { source: typeof PRINT_MSG; type: "printed" }
  | { source: typeof PRINT_MSG; type: "error"; message: string };

export function isPrintMessage(v: unknown): v is PrintMessage {
  return Boolean(v) && typeof v === "object" && (v as { source?: unknown }).source === PRINT_MSG && typeof (v as { type?: unknown }).type === "string";
}
