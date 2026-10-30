/**
 * Rozhodnutí o stavu anonymizace (spec §5.3) — čistá funkce.
 * Bezpečnostní zásada: odeslat se dá jen to, co prokazatelně prošlo kontrolou. Při jakékoli
 * pochybnosti je výsledkem `review`, nikdy tiché `done`.
 */

import type { AnonMethod, AnonPagesAcc, AnonStatus, AnonUsage, AnonWarning } from "./types";

export interface DecideInput {
  mode: "full" | "approval";
  method: AnonMethod | null;
  /** Detekce použila AI a odpověděl požadovaný model. */
  aiUsed: boolean;
  modelFallback: boolean;
  confidence: number;
  /** Všechny zásahy pravidel jsou pokryté vypálenými oblastmi. */
  ruleHitsCovered: boolean;
  /** Výstupní kontroly (únik textu, inkoust ponechaného textu, zbytky) prošly. */
  outputChecksPassed: boolean;
  /** Fotka: ověření přepisem bez nálezu (null = neověřovalo se — vektor / sken s vysokou jistotou). */
  verifyClean: boolean | null;
  /** Fotka: keep hodnoty (číslo výkresu…) jsou v přepisu. */
  verifyKeepPresent: boolean | null;
  /** Fotka: odhad px/mm (null = nevíme / netýká se). */
  pxPerMm: number | null;
  isPhoto: boolean;
  hasMaster: boolean;
  /** Varování z detekce / oblastí (§2.4) a pravidel. */
  warnings: AnonWarning[];
  customerStandard: boolean;
  termInKeep: boolean;
  titleBlockFound: boolean;
  /** Výstup se nevytvořil (selhání) — důvod. */
  failure?: string | null;
  /** Žádná stránka není výkres. */
  notDrawing?: boolean;
  unsupported?: string | null;
  /** Denní limit automatiky vyčerpán (jen automatika). */
  budgetExceeded?: boolean;
}

export interface Decision {
  status: AnonStatus;
  reason: string | null;
  warnings: AnonWarning[];
}

export const DONE_MIN_CONFIDENCE = 0.85;
export const NO_TITLE_MIN_CONFIDENCE = 0.9;
export const MIN_PX_PER_MM = 6;

/** Varování, která sama o sobě znamenají review. */
const REVIEW_CODES = new Set<AnonWarning["code"]>([
  "no_ai", "model_fallback", "coords_out_of_image", "low_resolution", "no_master", "low_px_per_mm", "customer_standard",
  "term_in_keep", "area_cap", "keep_overlap", "verify_leak", "verify_keep_missing", "verify_new_graphic", "no_title_block",
  "dxf_graphics", "dxf_layer_term", "step_suspicious", "residue", "ai_failed", "approval_mode", "low_confidence",
  "text_layer_untrusted", "ai_removed_text", "truncated", "no_terms", "cut_uncertain", "hidden_text", "plot_stamp", "nothing_found",
]);

/** Fakta jedné dávky stránek PDF (pdf-pipeline → service). */
export interface PdfBatchFacts {
  warnings: AnonWarning[];
  residue: boolean;
  outputOk: boolean;
  customerStandard: boolean;
  termInKeep: boolean;
  /** Jistota AI dávky (min přes stránky s AI). */
  confidence: number;
  /** Každá zahrnutá stránka dávky měla AI. */
  aiUsed: boolean;
  /** Dávka měla aspoň jednu zahrnutou stránku. */
  hasIncluded: boolean;
  fallback: boolean;
  titleBlockFound: boolean;
  verifyClean: boolean | null;
  verifyKeepMissing: boolean;
  detected?: Partial<Record<string, string>>;
  usage?: AnonUsage | null;
}

function sumUsage(a: AnonUsage | null | undefined, b: AnonUsage | null | undefined): AnonUsage | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return {
    input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite,
    usd: Math.round((a.usd + b.usd) * 10000) / 10000, calls: a.calls + b.calls,
  };
}

/**
 * Sloučí dávku stránek do průběžného stavu (navazování PDF > 10 stran): varování a zbytky se nesmí
 * ztratit, „AI u všech stránek" a „razítko na všech stránkách" platí jen když platí v každé dávce,
 * jistota = minimum. Čistá funkce.
 */
export function mergeBatch(prev: AnonPagesAcc | null | undefined, b: PdfBatchFacts, extra: { manualBy?: string | null } = {}): AnonPagesAcc {
  const p: AnonPagesAcc = prev ?? {
    warnings: [], residue: false, outputOk: true, customerStandard: false, termInKeep: false, minConfidence: 1, allAi: true,
    fallback: false, allTitleBlock: true, verifyClean: null, verifyKeepMissing: false, usage: null,
  };
  const seen = new Set(p.warnings.map((w) => `${w.code}:${w.page ?? ""}:${w.message}`));
  const warnings = [...p.warnings];
  for (const w of b.warnings) {
    const k = `${w.code}:${w.page ?? ""}:${w.message}`;
    if (!seen.has(k) && warnings.length < 200) { seen.add(k); warnings.push(w); }
  }
  return {
    warnings,
    residue: p.residue || b.residue,
    outputOk: p.outputOk && b.outputOk,
    customerStandard: p.customerStandard || b.customerStandard,
    termInKeep: p.termInKeep || b.termInKeep,
    minConfidence: b.hasIncluded && b.aiUsed ? Math.min(p.minConfidence, b.confidence) : p.minConfidence,
    allAi: p.allAi && (b.aiUsed || !b.hasIncluded),
    fallback: p.fallback || b.fallback,
    allTitleBlock: p.allTitleBlock && (b.titleBlockFound || !b.hasIncluded),
    verifyClean: p.verifyClean === false || b.verifyClean === false ? false : (p.verifyClean ?? b.verifyClean),
    verifyKeepMissing: p.verifyKeepMissing || b.verifyKeepMissing,
    detected: p.detected && Object.keys(p.detected).length ? p.detected : (b.detected as AnonPagesAcc["detected"]),
    manualBy: extra.manualBy !== undefined ? extra.manualBy : (p.manualBy ?? null),
    usage: sumUsage(p.usage, b.usage),
  };
}

/** Průběžný stav → vstup rozhodnutí (bez režimu). */
export function accToDecide(acc: AnonPagesAcc, base: { method: AnonMethod; failure?: string | null; notDrawing?: boolean }): Omit<DecideInput, "mode"> {
  return {
    method: base.method, aiUsed: acc.allAi, modelFallback: acc.fallback, confidence: acc.minConfidence,
    ruleHitsCovered: !acc.residue, outputChecksPassed: acc.outputOk, verifyClean: acc.verifyClean,
    verifyKeepPresent: acc.verifyKeepMissing ? false : null, pxPerMm: null, isPhoto: false, hasMaster: false,
    warnings: [...acc.warnings], customerStandard: acc.customerStandard, termInKeep: acc.termInKeep,
    titleBlockFound: acc.allTitleBlock || (acc.allAi && acc.minConfidence >= NO_TITLE_MIN_CONFIDENCE),
    failure: base.failure ?? null, notDrawing: base.notDrawing ?? false,
  };
}

export function decideAnonStatus(i: DecideInput): Decision {
  const warnings = [...i.warnings];
  if (i.unsupported) return { status: "unsupported", reason: i.unsupported, warnings };
  if (i.failure) return { status: "failed", reason: i.failure, warnings };
  if (i.budgetExceeded) return { status: "pending", reason: "Denní limit AI pro automatiku je vyčerpán — pokračuje zítra (nebo spusť ručně).", warnings };
  if (i.notDrawing) return { status: "skipped", reason: "Není výkres", warnings };

  const add = (code: AnonWarning["code"], message: string) => {
    if (!warnings.some((w) => w.code === code)) warnings.push({ code, message });
  };
  if (i.mode === "approval") add("approval_mode", "Režim se schválením — zkontroluj anonymizaci.");
  if (!i.aiUsed) add("no_ai", "Bez AI (jen pravidla) — zkontroluj logo, podpisy a název firmy.");
  if (i.modelFallback) add("model_fallback", "Odpověděl záložní model — výsledek ke kontrole.");
  if (i.aiUsed && i.confidence < DONE_MIN_CONFIDENCE) add("low_confidence", "AI si není jistá — zkontroluj.");
  if (!i.ruleHitsCovered) add("residue", "Některé nalezené údaje se nepodařilo spolehlivě zakrýt.");
  if (!i.outputChecksPassed) add("residue", "Kontrola výstupu našla zbytky — zkontroluj.");
  if (i.isPhoto) {
    if (!i.hasMaster) add("no_master", "Fotka v nízkém rozlišení — zkontroluj (příště vyfoť v plném rozlišení).");
    if (i.verifyClean === false) add("verify_leak", "Ověření našlo nezakrytý údaj — zkontroluj.");
    if (i.verifyKeepPresent === false) add("verify_keep_missing", "Po anonymizaci není čitelné číslo výkresu nebo materiál — zkontroluj.");
    if (i.verifyClean === null) add("verify_leak", "Fotka nebyla ověřena přepisem — zkontroluj.");
    if (i.pxPerMm !== null && i.pxPerMm < MIN_PX_PER_MM) add("low_px_per_mm", "Písmo na fotce je malé — vyfoť razítko zblízka (druhá fotka) nebo naskenuj.");
  }
  if (i.customerStandard) add("customer_standard", "Výkres odkazuje na podnikovou normu zákazníka — rozhodni, zda ji ponechat.");
  if (i.termInKeep) add("term_in_keep", "Číslo výkresu obsahuje zkratku firmy — rozhodni.");
  if (!i.titleBlockFound && !(i.aiUsed && i.confidence >= NO_TITLE_MIN_CONFIDENCE)) add("no_title_block", "Razítko se nepodařilo najít — zkontroluj.");
  if (i.method === "dxf") add("dxf_graphics", "DXF: zkontroluj logo a grafiku v razítku (v1 vždy ke kontrole).");

  const review = warnings.filter((w) => REVIEW_CODES.has(w.code));
  if (review.length) return { status: "review", reason: review[0].message, warnings };
  return { status: "done", reason: null, warnings };
}
