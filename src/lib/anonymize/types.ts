/**
 * Anonymizace výkresů — společné typy (čistý modul, bez serverových závislostí).
 * Souřadnice oblastí jsou vždy NORMALIZOVANÉ 0..1 vůči stránce / obrazu PO orientaci
 * (počátek vlevo nahoře, osový obal), aby přežily změnu rozlišení renderu.
 */

export type AnonStatus = "pending" | "processing" | "done" | "review" | "failed" | "unsupported" | "skipped";
export type AnonMethod = "raster_pdf" | "image" | "image_pdf" | "dxf" | "step";
export type AnonCategory =
  | "company" | "logo" | "person" | "signature" | "path" | "contact" | "code" | "copyright_owner" | "custom" | "other";
export type RegionSource = "rule" | "ai" | "manual" | "cache";
export type Zone = "title_block" | "frame" | "revisions" | "body";
export type KeepField = "drawingNumber" | "revision" | "material" | "scale" | "title" | "other";
export type AnonVia = "automaticky" | "rucne" | "foto" | "email" | "import" | "cron" | "backfill";

export const ANON_CATEGORIES: readonly AnonCategory[] = [
  "company", "logo", "person", "signature", "path", "contact", "code", "copyright_owner", "custom", "other",
];
export const ANON_STATUSES: readonly AnonStatus[] = ["pending", "processing", "done", "review", "failed", "unsupported", "skipped"];

/** Čtyřúhelník x1,y1,…,x4,y4 (normalizovaně), pořadí bodů po obvodu. */
export type Quad = [number, number, number, number, number, number, number, number];

export interface AnonRegion {
  id: string;
  /** 1..n */
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Otočený obdélník (fotka) — vyplňuje se polygon. */
  quad?: Quad;
  category: AnonCategory;
  source: RegionSource;
  zone: Zone;
  /** sha256(normalizovaný text) — žádný čitelný text v job_files. */
  textHash?: string;
  confidence?: number;
  /** Ruční sada má přednost: "removed" = ručně zrušený zásah (i pravidla), "added" = ručně přidaný. */
  manual?: "added" | "removed";
}

export interface KeepBox {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  field: KeepField;
  /** Hodnota keep pole (jen v paměti — pro kontrolu přepisu, do DB se neukládá). */
  value?: string;
}

/** Osový obdélník (v libovolných jednotkách — podle kontextu body / px / normalizovaně). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Textová položka (z PDF textové vrstvy, anotace nebo OCR) v bodech stránky (vlevo nahoře). */
export interface TextItem {
  id: string;
  page: number;
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Výška písma v bodech (em). */
  fontSize: number;
  /** Natočení písma ve stupních (0 = vodorovně). */
  rot: number;
  source: "text" | "annotation" | "ocr";
  fontName?: string;
  /** Počátek účaří (body stránky, vlevo nahoře) — pro podřetězce u natočeného textu. */
  ox?: number;
  oy?: number;
  /** Délka položky ve směru textu (body). */
  adv?: number;
  /** Čtyřúhelník položky (OCR fotky), body/px zdroje. */
  quad?: Quad;
}

/** Úsek řádku patřící jedné položce. */
export interface LineSpan {
  itemId: string;
  /** Rozsah znaků v textu řádku [start, end). */
  start: number;
  end: number;
  /** Posun prvního znaku v textu položky. */
  offset: number;
}

export interface TextLine {
  /** „p1:L17" */
  id: string;
  page: number;
  text: string;
  spans: LineSpan[];
  /** Obal řádku v bodech. */
  box: Box;
  fontSize: number;
  rot: number;
  zone: Zone;
}

/** Zásah pravidla nebo AI v řádku. */
export interface LineHit {
  lineId: string;
  start: number;
  end: number;
  category: AnonCategory;
  /** Krátké id pravidla / důvod (bez textu). */
  rule: string;
  source: RegionSource;
  /** Smaže se celá položka (plot stamp s cestou). */
  wholeItem?: boolean;
  confidence?: number;
}

/** Výsledek detekce jedné stránky / obrazu. */
export interface PageDetection {
  page: number;
  isDrawing: boolean | null;
  regions: AnonRegion[];
  keep: KeepBox[];
  warnings: AnonWarning[];
}

export type AnonWarningCode =
  | "no_ai" | "model_fallback" | "coords_out_of_image" | "low_resolution" | "no_master" | "low_px_per_mm"
  | "customer_standard" | "term_in_keep" | "area_cap" | "keep_overlap" | "verify_leak" | "verify_keep_missing"
  | "verify_new_graphic" | "no_title_block" | "dxf_graphics" | "dxf_layer_term" | "step_suspicious" | "residue"
  | "text_layer_untrusted" | "ai_failed" | "budget" | "too_large" | "approval_mode" | "low_confidence"
  | "scan_page" | "excluded_pages" | "mixed_content" | "ai_removed_text" | "truncated" | "no_terms" | "cut_uncertain";

export interface AnonWarning {
  code: AnonWarningCode;
  /** Česká hláška pro UI (bez citlivých textů). */
  message: string;
  page?: number;
}

/** Počty po kategoriích + varování (UI „co se smazalo"). */
export interface AnonSummary {
  counts: Partial<Record<AnonCategory, number>>;
  total: number;
  warnings: AnonWarning[];
  pages?: { total: number; included: number[]; excluded: { page: number; why: string }[] };
  /** Metoda + čas zpracování (ms). */
  method?: AnonMethod;
  ms?: number;
  aiCalls?: number;
}

export interface AnonPages {
  total: number;
  included: number[];
  excluded: { page: number; why: "not_drawing" | "blank" }[];
  /** Další stránka ke zpracování (navazování po dávkách). */
  next?: number | null;
  parts?: string[];
  /** Průběžný stav rozhodnutí přes dávky stránek (navazování) — sloučí se do konečného rozhodnutí. */
  acc?: AnonPagesAcc;
}

/** Souhrn dávek stránek pro rozhodnutí (decide.ts mergeBatch). */
export interface AnonPagesAcc {
  warnings: AnonWarning[];
  residue: boolean;
  outputOk: boolean;
  customerStandard: boolean;
  termInKeep: boolean;
  /** Nejnižší jistota AI přes stránky s AI (1 = žádná). */
  minConfidence: number;
  /** Každá zahrnutá stránka měla výsledek AI (volání nebo cache). */
  allAi: boolean;
  fallback: boolean;
  /** Každá zahrnutá stránka má nalezené razítko (nebo AI s jistotou ≥ 0,9). */
  allTitleBlock: boolean;
  /** Sken/vision stránky: false = některá neprošla ověřením přepisem; null = žádná. */
  verifyClean: boolean | null;
  verifyKeepMissing: boolean;
  /** Číslo výkresu / revize z první stránky, kde se našly. */
  detected?: Partial<Record<KeepField, string>>;
  /** Ruční uložení editoru — navazující dávky běží za stejného uživatele bez AI. */
  manualBy?: string | null;
  /** Usage AI sečtená přes dávky. */
  usage?: AnonUsage | null;
}

/** Usage AI jednoho běhu (pro denní limit). */
export interface AnonUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  usd: number;
  calls: number;
}
